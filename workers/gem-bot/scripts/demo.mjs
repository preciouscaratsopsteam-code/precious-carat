#!/usr/bin/env node
/**
 * Local demo of the Gem Assistant:  npm run demo
 *
 * Starts the Worker locally and serves a stand-in store page that renders the
 * REAL theme files — snippets/pc-chat.liquid, snippets/whatsapp-fab.liquid,
 * assets/pc-chat.js, assets/pc-chat.css, assets/base.css — so what you see is
 * what the storefront will show. Product and Journal lookups hit the live store
 * (read-only). Nothing is deployed and nothing on the store changes.
 *
 * Replies:
 *   - .dev.vars has ANTHROPIC_API_KEY=…   -> real answers from Claude (costs a few rupees)
 *   - no key                              -> scripted replies from scripts/demo-model.mjs
 * Order lookup and lead saving also need the SHOPIFY_* values in .dev.vars.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Liquid } from 'liquidjs';
import { startDemoModel } from './demo-model.mjs';

const botDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const themeDir = path.join(botDir, '..', '..');
const WORKER = 8787;
const PAGE = 8788;
const MODEL = 8799;
const STORE = 'https://www.preciouscarats.com';
const workerUrl = `http://127.0.0.1:${WORKER}`;
const pageUrl = `http://127.0.0.1:${PAGE}`;

const devVars = path.join(botDir, '.dev.vars');
const devVarsText = existsSync(devVars) ? readFileSync(devVars, 'utf8') : '';
const hasKey = /^\s*ANTHROPIC_API_KEY\s*=\s*["']?[^\s"']{10,}/m.test(devVarsText);
const hasShopify = /^\s*SHOPIFY_CLIENT_SECRET\s*=\s*["']?\S+/m.test(devVarsText);

const children = [];
const servers = [];
function shutdown(code = 0) {
  for (const c of children) c.kill();
  for (const s of servers) s.close();
  process.exit(code);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

// ── model: real key, or the scripted stand-in ───────────────────────────────
const envFiles = [];
if (devVarsText) envFiles.push(devVars);
if (!hasKey) {
  try {
    servers.push(await startDemoModel(MODEL));
  } catch (err) {
    console.error(`Could not start the demo model on port ${MODEL}: ${err.message}`);
    shutdown(1);
  }
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'pc-gem-bot-')), 'demo.env');
  writeFileSync(file, `ANTHROPIC_API_KEY=demo-mode-no-real-key\nANTHROPIC_BASE_URL=http://127.0.0.1:${MODEL}\n`);
  envFiles.push(file);
}

// ── worker ───────────────────────────────────────────────────────────────────
const wrangler = spawn(
  path.join(botDir, 'node_modules', '.bin', 'wrangler'),
  ['dev', '--port', String(WORKER), '--ip', '127.0.0.1', '--show-interactive-dev-session=false', ...envFiles.flatMap((f) => ['--env-file', f])],
  { cwd: botDir, stdio: ['ignore', 'pipe', 'pipe'] },
);
children.push(wrangler);
const relay = (chunk) => {
  for (const line of String(chunk).split('\n')) {
    // Chat log lines and problems only; wrangler's own banner is noise here.
    if (/"event":"chat"|error|Error|✘|tool .* failed/.test(line)) console.log(`  worker: ${line.trim()}`);
  }
};
wrangler.stdout.on('data', relay);
wrangler.stderr.on('data', relay);
wrangler.on('exit', (code) => {
  console.error(`The local Worker stopped (exit ${code}).`);
  shutdown(1);
});

// ── a real product, so the product-page view has something true to talk about ─
let sample = null;
try {
  const res = await fetch(`${STORE}/api/2026-10/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: `{ search(query: "blue sapphire", first: 1, types: PRODUCT) { nodes { ... on Product { handle title featuredImage { url(transform: { maxWidth: 900 }) } priceRange { minVariantPrice { amount } } } } } }`,
    }),
    signal: AbortSignal.timeout(8000),
  });
  sample = (await res.json()).data.search.nodes[0] ?? null;
} catch {
  /* the demo still works without it */
}

// ── the stand-in store page ──────────────────────────────────────────────────
const liquid = new Liquid({ strictFilters: true });
liquid.registerFilter('asset_url', (name) => `/assets/${name}`);
// Shopify's json filter escapes <, > and & so its output is safe inside <script>.
liquid.registerFilter('json', (v) => JSON.stringify(v ?? null).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026'));
const snippet = (name) => readFile(path.join(themeDir, 'snippets', `${name}.liquid`), 'utf8');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const inr = (n) => '₹' + Math.round(Number(n)).toLocaleString('en-IN');

async function page(view) {
  const product = view === 'product' && sample;
  const template = product ? 'product' : 'collection';
  const ctx = {
    settings: { chat_bot_endpoint: workerUrl, chat_bot_enabled: true, business_whatsapp: '919908190811' },
    request: { path: product ? `/products/${sample.handle}` : '/collections/blue-sapphire' },
    template: { name: template },
    product: product ? { handle: sample.handle } : null,
    collection: product ? null : { handle: 'blue-sapphire', title: 'Blue Sapphire (Neelam)' },
  };
  const [chat, fab] = await Promise.all([
    liquid.parseAndRender(await snippet('pc-chat'), ctx),
    liquid.parseAndRender(await snippet('whatsapp-fab'), ctx),
  ]);
  const mode = hasKey
    ? `Real AI answers (your key in .dev.vars). Order lookup and leads: ${hasShopify ? 'connected' : 'not connected — add the SHOPIFY_* values to .dev.vars'}.`
    : 'Scripted replies — no ANTHROPIC_API_KEY in workers/gem-bot/.dev.vars. The chat window, streaming and product cards are real; the words are canned.';
  const body = product
    ? `<div class="d-pdp"><img src="${esc(sample.featuredImage?.url ?? '')}" alt=""><div><h1>${esc(sample.title)}</h1><p class="d-price">${inr(sample.priceRange.minVariantPrice.amount)}</p><p>Stand-in product page. Open the chat and try “Tell me about this stone”.</p></div></div>
       <div class="d-sticky" id="d-sticky"><b>${esc(sample.title)}</b><span>Add to cart</span></div>
       <script>document.documentElement.style.setProperty('--pdp-sticky-h', document.getElementById('d-sticky').offsetHeight + 'px')</script>`
    : `<h1>Blue Sapphire (Neelam)</h1><div class="d-grid">${'<div></div>'.repeat(12)}</div>`;
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${product ? esc(sample.title) : 'Blue Sapphire (Neelam)'} – Precious Carats (local demo)</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;600;700&family=Inter:wght@300;400;500;600;700&family=Outfit:wght@300;400;500;600;700&display=swap">
<link rel="stylesheet" href="/assets/base.css">
<style>
  .d-note{background:#231F20;color:#DCCFB4;font:13px/1.5 Inter,sans-serif;padding:10px 20px}
  .d-note b{color:#fff} .d-note a{color:#fff;text-decoration:underline;margin-left:10px}
  .d-head{position:sticky;top:0;z-index:1000;background:#fff;border-bottom:1px solid #E6DDCF;padding:16px 20px;font-family:var(--font-heading);font-size:26px}
  main{padding:20px;max-width:1200px;margin:0 auto}
  .d-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:14px;margin-top:20px}
  .d-grid div{aspect-ratio:1;background:#F6EFE4;border-radius:6px}
  .d-pdp{display:grid;gap:24px;grid-template-columns:minmax(0,420px) 1fr;align-items:start}
  .d-pdp img{width:100%;height:auto;border-radius:8px;background:#F6EFE4}
  .d-price{font-size:22px;font-weight:600;margin:10px 0}
  .d-sticky{position:fixed;left:0;right:0;bottom:0;z-index:70;display:flex;justify-content:space-between;align-items:center;gap:12px;padding:14px 20px;background:#fff;box-shadow:0 -10px 30px -14px rgba(120,96,58,.45);font:14px Inter,sans-serif}
  .d-sticky span{background:#231F20;color:#fff;padding:10px 18px;border-radius:4px;white-space:nowrap}
  @media (max-width:700px){.d-pdp{grid-template-columns:1fr}}
</style>
</head>
<body class="template-${template}">
<div class="d-note"><b>Local demo.</b> ${esc(mode)}
  <a href="/">Collection page</a>${sample ? '<a href="/?view=product">Product page</a>' : ''}</div>
<div class="d-head">Precious Carats</div>
<main>${body}</main>
${fab}
${chat}
</body></html>`;
}

const TYPES = { '.js': 'text/javascript', '.css': 'text/css' };
const site = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, pageUrl);
    if (url.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(await page(url.searchParams.get('view')));
      return;
    }
    // Theme assets by bare file name only — no directories, nothing but .js/.css.
    const m = /^\/assets\/([a-z0-9][a-z0-9.-]*\.(?:js|css))$/.exec(url.pathname);
    if (m) {
      res.writeHead(200, { 'content-type': TYPES[path.extname(m[1])], 'cache-control': 'no-store' });
      res.end(await readFile(path.join(themeDir, 'assets', m[1])));
      return;
    }
    res.writeHead(404).end('Not found');
  } catch (err) {
    res.writeHead(500).end(String(err?.message ?? err));
  }
});
site.once('error', (err) => {
  console.error(`Could not start the demo page on port ${PAGE}: ${err.message}`);
  shutdown(1);
});
site.listen(PAGE, '127.0.0.1');
servers.push(site);

// ── ready? ───────────────────────────────────────────────────────────────────
let up = false;
for (let i = 0; i < 80 && !up; i++) {
  await new Promise((r) => setTimeout(r, 500));
  try {
    up = (await fetch(`${workerUrl}/health`, { signal: AbortSignal.timeout(1500) })).ok;
  } catch {
    /* not yet */
  }
}
if (!up) {
  console.error('The local Worker did not start within 40 seconds.');
  shutdown(1);
}

console.log(`
Gem Assistant demo is running.

  Open:     ${pageUrl}
  Replies:  ${hasKey ? 'real (Claude, using the key in .dev.vars)' : 'SCRIPTED — add ANTHROPIC_API_KEY=… to workers/gem-bot/.dev.vars and restart for real answers'}
  Orders:   ${hasShopify ? 'connected' : 'not connected (optional: SHOPIFY_SHOP, SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET in .dev.vars)'}
  Catalogue and Journal lookups are live and read-only.

Press Ctrl+C to stop.
`);
if (process.argv.includes('--open')) spawn('open', [pageUrl], { stdio: 'ignore' }).on('error', () => {});
