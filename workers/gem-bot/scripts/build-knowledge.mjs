#!/usr/bin/env node
/**
 * Builds src/knowledge.json — the store pages the assistant answers from.
 *
 * Why a build step: the policy pages and the 30-odd gem guides are rendered by
 * the theme (the gem guides have no body in Shopify admin at all), so the only
 * faithful source is the page a customer actually sees. Shopify throttles
 * storefront HTML requests from datacentre IPs, so the Worker must not scrape
 * at chat time; this script does it once, slowly, from your machine.
 *
 * Run it again (then `npm run deploy`) whenever a policy or gem guide changes:
 *     npm run knowledge
 *
 * Products, prices, stock and blog articles are NOT in this file — the Worker
 * reads those live from the Storefront API on every question.
 */
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { htmlToText, extractMain } from '../src/html.ts';

const STORE = process.env.STORE_URL || 'https://www.preciouscarats.com';
const API_VERSION = '2026-10';
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'knowledge.json');
const DELAY_MS = 1500;

// Pages that are app shells or duplicates, not knowledge.
const SKIP = new Set([
  'wishlist', 'compare', 'search-results-page', 'order-status', 'track', 'kp-account',
  'how-we-photograph-our-gems', 'sitemap', 'llms-txt', 'coming-soon',
]);

// Short, high-traffic pages that go straight into the system prompt so the
// commonest questions need no lookup. Everything else is read on demand.
const CORE = new Set([
  'contact-us', 'easy-returns-money-back', 'treatment-disclosure', 'verifiable-certificates',
  'worldwide-shipping', 'certified-by-12-world-class-labs', 'honest-unfiltered-visuals',
  'customised-jewellery',
]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function listPages() {
  const res = await fetch(`${STORE}/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: '{ pages(first: 250) { nodes { handle title } } }' }),
  });
  if (!res.ok) throw new Error(`Storefront API ${res.status}`);
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data.pages.nodes;
}

async function fetchPage(handle) {
  const url = `${STORE}/pages/${handle}`;
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'pc-gem-bot-knowledge-build/1.0', Accept: 'text/html' },
      redirect: 'follow',
    });
    if (res.status === 429 || res.status >= 500) {
      const wait = Math.min(60, Number(res.headers.get('retry-after')) || 5 * 2 ** attempt);
      process.stderr.write(`  ${handle}: HTTP ${res.status}, waiting ${wait}s\n`);
      await sleep(wait * 1000);
      continue;
    }
    if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
    return res.text();
  }
  throw new Error(`${url} kept failing`);
}

function kindOf(handle) {
  if (handle.endsWith('-gem-guide')) return 'gem-guide';
  if (/polic|terms|privacy|returns|shipping/.test(handle)) return 'policy';
  return 'info';
}

const pages = (await listPages()).filter((p) => !SKIP.has(p.handle));
const docs = [];
const skipped = [];
for (const [i, p] of pages.entries()) {
  if (i) await sleep(DELAY_MS);
  const html = await fetchPage(p.handle);
  const text = htmlToText(extractMain(html));
  if (text.length < 200) {
    skipped.push(`${p.handle} (${text.length} chars)`);
    continue;
  }
  docs.push({
    id: p.handle,
    title: p.title.trim(),
    url: `${STORE}/pages/${p.handle}`,
    kind: kindOf(p.handle),
    core: CORE.has(p.handle),
    text,
  });
  process.stderr.write(`  ${String(i + 1).padStart(2)}/${pages.length} ${p.handle} — ${text.length} chars\n`);
}

docs.sort((a, b) => a.id.localeCompare(b.id));
// No timestamp in the file: it feeds the system prompt, and an unchanged site
// must produce a byte-identical prompt so the prompt cache keeps hitting.
await writeFile(OUT, JSON.stringify({ source: STORE, docs }, null, 1) + '\n');

const total = docs.reduce((n, d) => n + d.text.length, 0);
const core = docs.filter((d) => d.core).reduce((n, d) => n + d.text.length, 0);
console.log(`\nWrote ${docs.length} pages (${total} chars; ${core} chars inline in the prompt) to ${OUT}`);
if (skipped.length) console.log(`Skipped as empty: ${skipped.join(', ')}`);
const missingCore = [...CORE].filter((h) => !docs.some((d) => d.id === h));
if (missingCore.length) console.log(`WARNING: core pages not found on the site: ${missingCore.join(', ')}`);
