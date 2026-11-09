const puppeteer = require('/private/tmp/claude-501/-Users-shreyajain-Devbox-precious-carat/032a2444-4fe3-4ab4-8aa0-26de862795fa/scratchpad/audit-tools/node_modules/puppeteer-core');
const fs = require('fs'); const path = require('path');
const OUT = __dirname + '/html';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new' });
  const pg = await browser.newPage(); await pg.setUserAgent(UA); await pg.setRequestInterception(true);
  pg.on('request', r => (['image','media','font','stylesheet','script'].includes(r.resourceType()) ? r.abort() : r.continue()));
  async function get(url) { for (let a = 0; a < 4; a++) { try { const r = await pg.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }); const st = r ? r.status() : 0; if (st === 429 || st === 430) { await sleep(15000 * (a + 1)); continue; } return { st, title: await pg.title(), html: await pg.content() }; } catch (e) { await sleep(8000); } } return { st: 'ERR', title: '', html: '' }; }
  const articles = new Set(JSON.parse(fs.readFileSync(__dirname + '/articles.json')));
  // finish the listing (page 61 onwards)
  for (let n = 61; n <= 90; n++) {
    const r = await get('https://www.preciouscarats.com/blogs/gems?page=' + n);
    let added = 0;
    for (const m of r.html.matchAll(/href="\/blogs\/gems\/([^\/?#"]+)"/g)) if (m[1] !== 'tagged' && !articles.has(m[1])) { articles.add(m[1]); added++; }
    console.log('list page', n, r.st, 'total', articles.size); if (!added) break; await sleep(2000);
  }
  fs.writeFileSync(__dirname + '/articles.json', JSON.stringify([...articles], null, 1));
  for (const h of articles) { if (fs.existsSync(path.join(OUT, h + '.html'))) continue; const r = await get('https://www.preciouscarats.com/blogs/gems/' + h); if (r.st === 200) fs.writeFileSync(path.join(OUT, h + '.html'), r.html); else console.log('article fetch', h, r.st); await sleep(2000); }
  console.log('articles saved', fs.readdirSync(OUT).length);
  // all internal destinations again (cheap, local), then check only the unresolved ones
  const links = {};
  for (const f of fs.readdirSync(OUT)) {
    const s = fs.readFileSync(path.join(OUT, f), 'utf8');
    const m = s.match(/<div class="article-page__content rte">([\s\S]*?)<\/div>\s*(?:<div class="article-page__tags|<footer|<section|<aside)/);
    for (const mm of (m ? m[1] : '').matchAll(/href="([^"]+)"/g)) {
      let h = mm[1].replace(/&amp;/g, '&');
      if (/^(mailto:|tel:|#|javascript:|whatsapp:)/i.test(h)) continue;
      if (/^https?:\/\//i.test(h) && !/preciouscarats\.com/i.test(h)) continue;
      h = h.replace(/^https?:\/\/(www\.)?preciouscarats\.com/i, ''); if (!h.startsWith('/')) h = '/blogs/gems/' + h; h = h.split('#')[0];
      (links[h] = links[h] || []).push(f.slice(0, -5));
    }
  }
  const prev = JSON.parse(fs.readFileSync(__dirname + '/broken-links.json'));
  const okBefore = new Set(Object.keys(JSON.parse(fs.readFileSync(__dirname + '/checked-ok.json', 'utf8') || '{}')));
  const todo = Object.keys(links).filter(u => prev[u] || !okBefore.has(u));
  console.log('destinations total', Object.keys(links).length, 'to (re)check', todo.length);
  const bad = {}, ok = {};
  for (const u of todo) { const r = await get('https://www.preciouscarats.com' + u); if (r.st >= 400 || r.st === 'ERR' || /not found|404/i.test(r.title)) bad[u] = { status: r.st, title: r.title, in: [...new Set(links[u])] }; else ok[u] = r.st; await sleep(2500); }
  fs.writeFileSync(__dirname + '/broken-links-final.json', JSON.stringify(bad, null, 1));
  console.log('still broken', Object.keys(bad).length); for (const [u, v] of Object.entries(bad)) console.log(v.status, u, '| in', v.in.length, v.in.slice(0, 4).join(', '));
  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
