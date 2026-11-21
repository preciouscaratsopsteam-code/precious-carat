/**
 * Live catalogue and journal access through Shopify's Storefront API.
 *
 * The store allows tokenless Storefront access, so nothing here needs a secret.
 * Tokenless access cannot read metafields or inventory counts; full specs come
 * from the Admin API (admin.ts) when its credentials are configured.
 *
 * Filtering: only the filters enabled in Shopify Search & Discovery take effect
 * (price and the custom.* metafields). `productType` and `available` are
 * silently ignored by this store's search, so gem type is filtered through the
 * custom.gem_type metafield and stock is checked on the results.
 */
import { htmlToText } from './html.ts';
import { storeUrl } from './types.ts';
import type { Env, ProductCard } from './types.ts';
import { clip, matchFacetValues, parseCarat, parseRatti, rupees } from './util.ts';

const API_VERSION = '2026-10';
const PAGE_SIZE = 100;
const MAX_SCAN_PAGES = 6;
const FACET_TTL_MS = 60 * 60 * 1000;

export class StorefrontError extends Error {}

async function sf<T>(env: Env, query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const url = `${storeUrl(env)}/api/${API_VERSION}/graphql.json`;
  let lastStatus = 0;
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(9000),
    });
    lastStatus = res.status;
    if (res.status === 429 || res.status >= 500) {
      await new Promise((r) => setTimeout(r, 600));
      continue;
    }
    if (!res.ok) break;
    const json = (await res.json()) as { data?: T; errors?: { message: string }[] };
    if (json.errors?.length) throw new StorefrontError(`Storefront API: ${json.errors.map((e) => e.message).join('; ')}`);
    if (!json.data) throw new StorefrontError('Storefront API returned no data');
    return json.data;
  }
  throw new StorefrontError(`Storefront API HTTP ${lastStatus}`);
}

// ── Facets: the store's own filter values, fetched once an hour per isolate ──

interface FacetValue {
  label: string;
  count: number;
  input: string; // JSON for a ProductFilter, as Shopify hands it out
}
type FacetCatalog = Record<string, FacetValue[]>;

interface RawFilter {
  id: string;
  values: FacetValue[];
}

const facetKey = (id: string): string => id.replace(/^filter\.(p\.m\.custom\.|v\.)/, '');
const toCatalog = (filters: RawFilter[]): FacetCatalog =>
  Object.fromEntries(filters.map((f) => [facetKey(f.id), f.values]));

let facetCache: { at: number; store: string; catalog: FacetCatalog } | null = null;

export async function facetCatalog(env: Env): Promise<FacetCatalog> {
  const store = storeUrl(env);
  if (facetCache && facetCache.store === store && Date.now() - facetCache.at < FACET_TTL_MS) return facetCache.catalog;
  const data = await sf<{ search: { productFilters: RawFilter[] } }>(
    env,
    `{ search(query: "", first: 1, types: PRODUCT) { productFilters { id values { label count input } } } }`,
  );
  const catalog = toCatalog(data.search.productFilters);
  facetCache = { at: Date.now(), store, catalog };
  return catalog;
}

// ── Product search ───────────────────────────────────────────────────────────

export interface SearchArgs {
  query?: string;
  gem_type?: string;
  origin?: string;
  treatment?: string;
  min_price?: number;
  max_price?: number;
  min_weight?: number;
  max_weight?: number;
  weight_unit?: 'carat' | 'ratti';
  sort?: 'relevance' | 'price_low_to_high' | 'price_high_to_low';
  include_sold_out?: boolean;
  limit?: number;
}

interface ProductNode {
  handle: string;
  title: string;
  productType: string;
  availableForSale: boolean;
  description: string;
  onlineStoreUrl: string | null;
  featuredImage: { url: string } | null;
  priceRange: { minVariantPrice: { amount: string } };
  compareAtPriceRange: { minVariantPrice: { amount: string } };
}

const PRODUCT_FIELDS = `
  handle title productType availableForSale
  description(truncateAt: 260)
  onlineStoreUrl
  featuredImage { url(transform: { maxWidth: 240 }) }
  priceRange { minVariantPrice { amount } }
  compareAtPriceRange { minVariantPrice { amount } }`;

const SEARCH_QUERY = `
query BotSearch($q: String!, $first: Int!, $after: String, $filters: [ProductFilter!], $sortKey: SearchSortKeys, $reverse: Boolean) {
  search(query: $q, first: $first, after: $after, types: PRODUCT, productFilters: $filters, sortKey: $sortKey, reverse: $reverse) {
    totalCount
    pageInfo { hasNextPage endCursor }
    nodes { ... on Product { ${PRODUCT_FIELDS} } }
    productFilters { id values { label count input } }
  }
}`;

interface SearchPage {
  search: {
    totalCount: number;
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: Partial<ProductNode>[];
    productFilters: RawFilter[];
  };
}

export function toCard(env: Env, p: ProductNode): ProductCard {
  const compare = rupees(p.compareAtPriceRange?.minVariantPrice?.amount);
  const price = rupees(p.priceRange?.minVariantPrice?.amount);
  return {
    handle: p.handle,
    title: p.title.replace(/\s+/g, ' ').trim(),
    url: p.onlineStoreUrl || `${storeUrl(env)}/products/${p.handle}`,
    image: p.featuredImage?.url ?? null,
    price,
    compare_at: compare > price ? compare : null,
    available: p.availableForSale,
    type: p.productType,
  };
}

/**
 * Ratti as the listing states it; when a listing gives only carats, converted
 * with the factor the store's own converter page uses (1 ratti = 0.91 carat).
 */
function weightInRatti(p: Pick<ProductNode, 'title' | 'description'>): number | null {
  const listed = parseRatti(p.description);
  if (listed != null) return listed;
  const ct = parseCarat(p.title, p.description);
  return ct == null ? null : Math.round((ct / 0.91) * 100) / 100;
}

export interface SearchResult {
  /** What the model reads. */
  summary: Record<string, unknown>;
  /** What the widget can draw. */
  cards: ProductCard[];
}

const topValues = (values: FacetValue[] | undefined, n = 10): string[] =>
  (values ?? [])
    .filter((v) => v.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, n)
    .map((v) => `${v.label} (${v.count})`);

export async function searchProducts(env: Env, args: SearchArgs): Promise<SearchResult> {
  const limit = Math.min(Math.max(Math.trunc(args.limit ?? 6), 1), 8);
  const filters: unknown[] = [];
  const catalog = args.gem_type || args.origin || args.treatment ? await facetCatalog(env) : {};

  // Resolve the free-text filters against the store's real filter values.
  const wanted: [key: string, label: string, text: string | undefined][] = [
    ['gem_type', 'gem type', args.gem_type],
    ['origin', 'origin', args.origin],
    ['treatment_status', 'treatment', args.treatment],
  ];
  for (const [key, label, text] of wanted) {
    if (!text?.trim()) continue;
    const all = catalog[key] ?? [];
    const hits = matchFacetValues(all, text);
    if (!hits.length) {
      return {
        cards: [],
        summary: {
          error: `No ${label} in the catalogue matches "${text}".`,
          [`valid_${key}_values`]: all.map((v) => v.label),
          hint: `Retry with one of these values, or drop the ${label} filter and put the word in "query" instead.`,
        },
      };
    }
    for (const h of hits) filters.push(JSON.parse(h.input));
  }

  if (args.min_price != null || args.max_price != null) {
    const price: Record<string, number> = {};
    if (args.min_price != null) price.min = Math.max(0, args.min_price);
    if (args.max_price != null) price.max = Math.max(0, args.max_price);
    filters.push({ price });
  }

  const sortKey = args.sort && args.sort !== 'relevance' ? 'PRICE' : 'RELEVANCE';
  const reverse = args.sort === 'price_high_to_low';
  const q = (args.query ?? '').trim().slice(0, 120);
  const hasWeightRange = args.min_weight != null || args.max_weight != null;
  const minWt = args.min_weight ?? 0;
  const maxWt = args.max_weight ?? Infinity;

  const matches: ProductNode[] = [];
  let after: string | null = null;
  let total = 0;
  let scanned = 0;
  let exhausted = false;
  let facets: FacetCatalog = {};

  for (let page = 0; page < MAX_SCAN_PAGES && matches.length < limit; page++) {
    const data: SearchPage = await sf<SearchPage>(env, SEARCH_QUERY, {
      q,
      first: PAGE_SIZE,
      after,
      filters: filters.length ? filters : null,
      sortKey,
      reverse,
    });
    const s = data.search;
    if (page === 0) {
      total = s.totalCount;
      facets = toCatalog(s.productFilters);
    }
    for (const node of s.nodes) {
      if (!node.handle || !node.title) continue; // not a product
      const p = node as ProductNode;
      scanned++;
      if (!args.include_sold_out && !p.availableForSale) continue;
      if (hasWeightRange) {
        const wt = args.weight_unit === 'ratti' ? weightInRatti(p) : parseCarat(p.title, p.description);
        if (wt == null || wt < minWt || wt > maxWt) continue;
      }
      matches.push(p);
      if (matches.length >= limit) break;
    }
    exhausted = !s.pageInfo.hasNextPage;
    if (exhausted) break;
    after = s.pageInfo.endCursor;
  }

  const cards = matches.map((p) => toCard(env, p));
  const products = matches.map((p, i) => {
    const card = cards[i]!;
    const ratti = parseRatti(p.description);
    return {
      handle: p.handle,
      title: card.title,
      gem_type: p.productType,
      price_inr: card.price,
      ...(card.compare_at ? { was_inr: card.compare_at } : {}),
      in_stock: p.availableForSale,
      carat: parseCarat(p.title, p.description),
      ...(ratti ? { ratti } : {}),
      ...(p.description ? { about: clip(p.description, 260) } : {}),
    };
  });

  const summary: Record<string, unknown> = { returned: products.length, products };
  if (hasWeightRange) {
    summary.note = exhausted
      ? `Weight was checked on all ${scanned} stones that met the other filters; these are all the matches.`
      : matches.length >= limit
        ? `These are the first ${limit} matches in the chosen order; more stones in this weight band may exist.`
        : `Weight was checked on the first ${scanned} of about ${total} stones that met the other filters. Narrow by gem type or price for a complete answer.`;
  } else {
    summary.total_matching = total >= 1000 ? '1000+' : total;
  }
  if (!products.length) summary.hint = 'Nothing matched. Loosen a filter (price, weight, origin, treatment) or try a different search word.';
  summary.in_this_result_set = {
    origins: topValues(facets.origin),
    treatments: topValues(facets.treatment_status),
    labs: topValues(facets.cert_lab),
    ...(args.gem_type ? {} : { gem_types: topValues(facets.gem_type, 12) }),
  };
  return { summary, cards };
}

// ── One product ──────────────────────────────────────────────────────────────

interface ProductDetail extends ProductNode {
  collections: { nodes: { handle: string; title: string }[] };
}

export async function getProduct(env: Env, handle: string): Promise<{ detail: Record<string, unknown>; card: ProductCard } | null> {
  const data = await sf<{ product: ProductDetail | null }>(
    env,
    `query BotProduct($h: String!) {
      product(handle: $h) {
        handle title productType availableForSale description onlineStoreUrl
        featuredImage { url(transform: { maxWidth: 240 }) }
        priceRange { minVariantPrice { amount } }
        compareAtPriceRange { minVariantPrice { amount } }
        collections(first: 6) { nodes { handle title } }
      }
    }`,
    { h: handle },
  );
  const p = data.product;
  if (!p) return null;
  const card = toCard(env, p);
  const ratti = parseRatti(p.description);
  return {
    card,
    detail: {
      handle: p.handle,
      title: card.title,
      url: card.url,
      gem_type: p.productType,
      price_inr: card.price,
      ...(card.compare_at ? { was_inr: card.compare_at } : {}),
      in_stock: p.availableForSale,
      carat: parseCarat(p.title, p.description),
      ...(ratti ? { ratti } : {}),
      description: clip(p.description || '', 1500),
      collections: p.collections.nodes.map((c) => c.title),
    },
  };
}

// ── Journal (blog) ───────────────────────────────────────────────────────────

export interface ArticleHit {
  blog: string;
  handle: string;
  title: string;
  published: string;
  preview: string;
  url: string;
}

export async function searchArticles(env: Env, query: string, limit = 6): Promise<{ total: number; articles: ArticleHit[] }> {
  const data = await sf<{
    search: {
      totalCount: number;
      nodes: {
        handle?: string;
        title?: string;
        publishedAt?: string;
        excerpt?: string | null;
        content?: string;
        onlineStoreUrl?: string | null;
        blog?: { handle: string };
      }[];
    };
  }>(
    env,
    `query BotArticles($q: String!, $first: Int!) {
      search(query: $q, first: $first, types: ARTICLE) {
        totalCount
        nodes { ... on Article { handle title publishedAt excerpt(truncateAt: 220) content(truncateAt: 220) onlineStoreUrl blog { handle } } }
      }
    }`,
    { q: query.trim().slice(0, 120), first: Math.min(Math.max(limit, 1), 8) },
  );
  const articles = data.search.nodes
    .filter((n) => n.handle && n.title && n.blog)
    .map((n) => ({
      blog: n.blog!.handle,
      handle: n.handle!,
      title: n.title!,
      published: (n.publishedAt ?? '').slice(0, 10),
      preview: (n.excerpt || n.content || '').replace(/\s+/g, ' ').trim(),
      url: n.onlineStoreUrl || `${storeUrl(env)}/blogs/${n.blog!.handle}/${n.handle}`,
    }));
  return { total: data.search.totalCount, articles };
}

export async function readArticle(
  env: Env,
  blog: string,
  handle: string,
): Promise<{ title: string; url: string; published: string; text: string } | null> {
  const data = await sf<{
    blog: { articleByHandle: { title: string; publishedAt: string; onlineStoreUrl: string | null; contentHtml: string } | null } | null;
  }>(
    env,
    `query BotArticle($b: String!, $h: String!) {
      blog(handle: $b) { articleByHandle(handle: $h) { title publishedAt onlineStoreUrl contentHtml } }
    }`,
    { b: blog, h: handle },
  );
  const a = data.blog?.articleByHandle;
  if (!a) return null;
  return {
    title: a.title,
    url: a.onlineStoreUrl || `${storeUrl(env)}/blogs/${blog}/${handle}`,
    published: a.publishedAt.slice(0, 10),
    text: clip(htmlToText(a.contentHtml), 9000),
  };
}
