const puppeteer = require('/private/tmp/claude-501/-Users-shreyajain-Devbox-precious-carat/032a2444-4fe3-4ab4-8aa0-26de862795fa/scratchpad/audit-tools/node_modules/puppeteer-core');
const fs = require('fs'); const path = require('path'); const S = __dirname; const PER = 15;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const info = JSON.parse(fs.readFileSync(path.join(S, 'stage1.json')));
  const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new' });
  const pg = await browser.newPage(); await pg.setUserAgent(UA); await pg.setRequestInterception(true);
  pg.on('request', r => (['image','media','font','stylesheet'].includes(r.resourceType()) ? r.abort() : r.continue()));
  await pg.goto('https://www.preciouscarats.com/collections/all-gemstones', { waitUntil: 'domcontentloaded', timeout: 60000 });
  const cache = {};
  async function handlesOf(ch) {
    if (cache[ch]) return cache[ch];
    const hs = [];
    for (let page = 1; page <= 14; page++) {
      let d = null;
      for (let a = 0; a < 4 && !d; a++) { try { d = await pg.evaluate(u => fetch(u).then(r => r.ok ? r.json() : null), `/collections/${ch}/products.json?limit=250&page=${page}`); } catch (e) {} if (!d) await sleep(8000); }
      const ps = (d && d.products) || []; ps.forEach(p => hs.push(p.handle)); if (ps.length < 250) break; await sleep(1500);
    }
    cache[ch] = hs; console.log('collection', ch, hs.length); return hs;
  }
  async function pageHas(ch, n, h) {
    const url = `https://www.preciouscarats.com/collections/${ch}` + (n > 1 ? `?page=${n}` : '');
    for (let a = 0; a < 4; a++) { try { const r = await pg.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }); if (r && (r.status() === 429 || r.status() === 430)) { await sleep(15000); continue; } const html = await pg.content(); return { url, ok: html.includes(`/products/${h}`) }; } catch (e) { await sleep(5000); } }
    return { url, ok: false };
  }
  const rows = [['product_handle', 'status', 'inventory', 'collection', 'position', 'collection_page_url', 'result', 'all_collections']];
  for (const [h, p] of Object.entries(info)) {
    if (!p) { rows.push([h, 'NOT FOUND', '', '', '', '', '', '']); continue; }
    if (!p.pick) { rows.push([h, p.status, p.inventory, '', '', '', 'in no visible collection', p.all.join('|')]); continue; }
    const hs = await handlesOf(p.pick); const i = hs.indexOf(h);
    if (i < 0) { rows.push([h, p.status, p.inventory, p.pick, '', '', 'not in products.json', p.all.join('|')]); continue; }
    const guess = Math.floor(i / PER) + 1; let found = null;
    for (const n of [guess, guess + 1, guess - 1, guess + 2].filter(n => n >= 1)) { const r = await pageHas(p.pick, n, h); await sleep(1500); if (r.ok) { found = r.url; break; } }
    rows.push([h, p.status, p.inventory, p.pick, i + 1, found || `https://www.preciouscarats.com/collections/${p.pick}?page=${guess}`, found ? 'verified on page' : 'NOT SEEN on pages ' + Math.max(1, guess - 1) + '-' + (guess + 2), p.all.join('|')]);
    if (rows.length % 20 === 0) console.log('progress', rows.length - 1);
  }
  fs.writeFileSync(path.join(S, 'orphan-products-collection-links.csv'), rows.map(r => r.map(v => /[",|]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : v).join(',')).join('\n') + '\n');
  console.log('verified', rows.filter(r => r[6] === 'verified on page').length, 'of', rows.length - 1);
  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
