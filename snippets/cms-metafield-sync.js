/**
 * PreciousCarats CMS → Shopify Metafield Sync Script
 *
 * Run this script after each Shopify theme deploy (or on a schedule).
 * It fetches all published collections from the CMS and writes each section
 * to the corresponding Shopify collection metafield so the storefront
 * never makes live HTTP calls at render time.
 *
 * Usage:
 *   CMS_URL=https://your-cms.vercel.app \
 *   SHOPIFY_STORE=your-store.myshopify.com \
 *   SHOPIFY_TOKEN=shpat_xxx \
 *   node snippets/cms-metafield-sync.js
 *
 * Required env vars:
 *   CMS_URL            — base URL of the CMS (no trailing slash)
 *   SHOPIFY_STORE      — e.g. precious-carats.myshopify.com
 *   SHOPIFY_TOKEN      — Admin API access token with write_metafields scope
 *
 * Metafield namespace: "cms"
 * Metafield keys match CMS section names:
 *   cms.about, cms.why, cms.benefits, cms.pricing, cms.care_guide, cms.faq,
 *   cms.hero_body_html, cms.meta_title, cms.meta_description
 */

const CMS_URL = process.env.CMS_URL;
const SHOPIFY_STORE = process.env.SHOPIFY_STORE;
const SHOPIFY_TOKEN = process.env.SHOPIFY_TOKEN;

if (!CMS_URL || !SHOPIFY_STORE || !SHOPIFY_TOKEN) {
  console.error("Missing required env vars: CMS_URL, SHOPIFY_STORE, SHOPIFY_TOKEN");
  process.exit(1);
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch failed: ${url} → ${res.status}`);
  return res.json();
}

async function shopifyRequest(path, method, body) {
  const res = await fetch(`https://${SHOPIFY_STORE}/admin/api/2025-01/${path}`, {
    method,
    headers: {
      "X-Shopify-Access-Token": SHOPIFY_TOKEN,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Shopify API error ${res.status}: ${text}`);
  }
  return res.json();
}

async function getShopifyCollectionId(handle) {
  const data = await shopifyRequest(
    `custom_collections.json?handle=${handle}&fields=id,handle`,
    "GET"
  );
  const col = data.custom_collections?.[0];
  if (col) return col.id;
  // Try smart collections
  const data2 = await shopifyRequest(
    `smart_collections.json?handle=${handle}&fields=id,handle`,
    "GET"
  );
  return data2.smart_collections?.[0]?.id ?? null;
}

async function setMetafields(ownerId, ownerResource, fields) {
  // Shopify supports bulk metafield set via metafields.json
  for (const [key, value] of Object.entries(fields)) {
    await shopifyRequest("metafields.json", "POST", {
      metafield: {
        namespace: "cms",
        key,
        value: typeof value === "string" ? value : JSON.stringify(value),
        type: "multi_line_text_field",
        owner_id: ownerId,
        owner_resource: ownerResource,
      },
    });
  }
}

async function syncCollection(slug) {
  console.log(`  Syncing ${slug}…`);
  const col = await fetchJson(`${CMS_URL}/api/collections/${slug}`);

  const collectionId = await getShopifyCollectionId(slug);
  if (!collectionId) {
    console.warn(`  No Shopify collection found for handle "${slug}" — skipping`);
    return;
  }

  const metafields = {
    hero_body_html: col.heroBodyTextHtml ?? "",
    about_html: col.aboutHtml ?? "",
    why_html: col.whyHtml ?? "",
    benefits: JSON.stringify(col.benefits ?? []),
    pricing_html: col.pricingHtml ?? "",
    care_guide_html: col.careGuideHtml ?? "",
    faq: JSON.stringify(col.faqWithHtml ?? []),
    meta_title: col.metaTitle ?? "",
    meta_description: col.metaDescription ?? "",
    tagline: col.tagline ?? "",
    updated_at: col.updatedAt,
  };

  await setMetafields(collectionId, "collection", metafields);
  console.log(`  ✓ ${slug} synced (${Object.keys(metafields).length} fields)`);
}

async function main() {
  console.log("Fetching published collections from CMS…");
  const collections = await fetchJson(`${CMS_URL}/api/collections`);
  console.log(`Found ${collections.length} published collections`);

  for (const { slug } of collections) {
    try {
      await syncCollection(slug);
    } catch (e) {
      console.error(`  ✗ ${slug}: ${e.message}`);
    }
  }

  console.log("Sync complete.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
