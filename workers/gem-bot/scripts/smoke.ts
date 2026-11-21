/**
 * Live check of the catalogue and Journal lookups against the real store.
 * Read-only, public data, no API key and no model call:  npm run smoke
 */
import { getProduct, readArticle, searchArticles, searchProducts } from '../src/storefront.ts';
import type { Env } from '../src/types.ts';

const env = { ANTHROPIC_API_KEY: '', STORE_URL: process.env.STORE_URL } as Env;
let failed = 0;

async function check(name: string, fn: () => Promise<string>): Promise<void> {
  const t = Date.now();
  try {
    const detail = await fn();
    console.log(`ok   ${name} — ${detail} [${Date.now() - t}ms]`);
  } catch (err) {
    failed++;
    console.log(`FAIL ${name}: ${err instanceof Error ? err.message : err}`);
  }
}
const expect = (cond: unknown, msg: string): void => {
  if (!cond) throw new Error(msg);
};
type P = { handle: string; title: string; gem_type: string; price_inr: number; in_stock: boolean; carat: number | null; ratti?: number };
const list = (s: Record<string, unknown>): P[] => s.products as P[];

let sampleHandle = '';

await check('gem type + budget, cheapest first', async () => {
  const r = await searchProducts(env, { gem_type: 'ruby', max_price: 40000, min_price: 10000, sort: 'price_low_to_high', limit: 5 });
  const p = list(r.summary);
  expect(p.length === 5, `wanted 5, got ${p.length}: ${JSON.stringify(r.summary).slice(0, 300)}`);
  expect(p.every((x) => x.gem_type === 'Ruby'), `non-ruby in results: ${p.map((x) => x.gem_type)}`);
  expect(p.every((x) => x.price_inr >= 10000 && x.price_inr <= 40000), `price out of range: ${p.map((x) => x.price_inr)}`);
  expect(p.every((x, i) => i === 0 || x.price_inr >= p[i - 1]!.price_inr), 'not sorted by price');
  expect(p.every((x) => x.in_stock), 'sold-out stone returned');
  expect(r.cards.length === 5 && r.cards.every((c) => c.url.startsWith('https://') && c.image), 'cards incomplete');
  sampleHandle = p[0]!.handle;
  return `${p.length} rubies ₹${p[0]!.price_inr}–₹${p.at(-1)!.price_inr}, total ${r.summary.total_matching}`;
});

await check('Hindi name as a search word', async () => {
  const r = await searchProducts(env, { query: 'neelam', limit: 3 });
  const p = list(r.summary);
  expect(p.length === 3 && p.every((x) => x.gem_type === 'Blue Sapphire'), `got ${p.map((x) => x.gem_type)}`);
  return p.map((x) => x.title).join(' | ');
});

await check('weight band in ratti', async () => {
  const r = await searchProducts(env, { gem_type: 'yellow sapphire', min_weight: 5, max_weight: 5.5, weight_unit: 'ratti', limit: 4 });
  const p = list(r.summary);
  expect(p.length > 0, `no stones: ${JSON.stringify(r.summary).slice(0, 300)}`);
  expect(p.every((x) => x.gem_type === 'Yellow Sapphire'), 'wrong gem type');
  expect(p.every((x) => (x.ratti ?? 0) >= 5 && (x.ratti ?? 99) <= 5.5), `ratti out of band: ${p.map((x) => x.ratti)}`);
  return `${p.map((x) => `${x.ratti}r/${x.carat}ct`).join(', ')} — ${r.summary.note}`;
});

await check('weight band in carats + origin + treatment', async () => {
  const r = await searchProducts(env, { gem_type: 'Blue Sapphire', origin: 'sri lanka', treatment: 'unheated', min_weight: 4, max_weight: 6, limit: 4 });
  const p = list(r.summary);
  expect(!r.summary.error, `filter error: ${JSON.stringify(r.summary)}`);
  expect(p.every((x) => x.carat !== null && x.carat >= 4 && x.carat <= 6), `carat out of band: ${p.map((x) => x.carat)}`);
  return `${p.length} stones: ${p.map((x) => `${x.title} ₹${x.price_inr}`).join(' | ')}`;
});

await check('unknown origin returns the valid list', async () => {
  const r = await searchProducts(env, { gem_type: 'ruby', origin: 'atlantis' });
  expect(typeof r.summary.error === 'string', 'expected an error');
  const valid = r.summary.valid_origin_values as string[];
  expect(Array.isArray(valid) && valid.length > 3, 'no valid origins listed');
  return `valid origins: ${valid.join(', ')}`;
});

await check('unknown gem type returns the valid list', async () => {
  const r = await searchProducts(env, { gem_type: 'unobtainium' });
  const valid = r.summary.valid_gem_type_values as string[];
  expect(Array.isArray(valid) && valid.includes('Ruby'), 'no valid gem types listed');
  return `${valid.length} gem types`;
});

await check('nothing matches an impossible budget', async () => {
  const r = await searchProducts(env, { gem_type: 'ruby', max_price: 1 });
  expect(list(r.summary).length === 0 && typeof r.summary.hint === 'string', 'expected an empty result with a hint');
  return 'empty with hint';
});

await check('product details', async () => {
  const r = await getProduct(env, sampleHandle);
  expect(r, `product ${sampleHandle} not found`);
  expect(r!.card.price > 0 && r!.card.url.includes(sampleHandle), 'card incomplete');
  expect(typeof r!.detail.description === 'string', 'no description');
  return `${r!.detail.title} ₹${r!.detail.price_inr} in_stock=${r!.detail.in_stock}`;
});

await check('missing product', async () => {
  expect((await getProduct(env, 'this-handle-does-not-exist-000')) === null, 'expected null');
  return 'null';
});

await check('journal search and read', async () => {
  const s = await searchArticles(env, 'which finger pukhraj');
  expect(s.articles.length > 0, 'no articles');
  const a = await readArticle(env, s.articles[0]!.blog, s.articles[0]!.handle);
  expect(a && a.text.length > 500, 'article body too short');
  return `${s.total} hits; read "${a!.title}" (${a!.text.length} chars)`;
});

console.log(failed ? `\n${failed} check(s) failed` : '\nAll live checks passed');
process.exit(failed ? 1 : 0);
