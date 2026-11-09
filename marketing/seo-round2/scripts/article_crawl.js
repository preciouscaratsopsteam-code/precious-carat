const puppeteer = require('/private/tmp/claude-501/-Users-shreyajain-Devbox-precious-carat/032a2444-4fe3-4ab4-8aa0-26de862795fa/scratchpad/audit-tools/node_modules/puppeteer-core');
const fs = require('fs'); const path = require('path');
const OUT = __dirname + '/html'; fs.mkdirSync(OUT, { recursive: true });
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
(async () => {
  const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new' });
  async function newPage() { const p = await browser.newPage(); await p.setUserAgent(UA); await p.setRequestInterception(true); p.on('request', r => (['image','media','font','stylesheet'].includes(r.resourceType()) ? r.abort() : r.continue())); return p; }
  const p0 = await newPage();
  const articles = new Set();
  for (let n = 1; n <= 60; n++) {
    const r = await p0.goto('https://www.preciouscarats.com/blogs/gems?page=' + n, { waitUntil: 'domcontentloaded', timeout: 60000 });
    const links = await p0.$$eval('a[href*="/blogs/gems/"]', as => as.map(a => a.getAttribute('href')));
    let added = 0;
    links.forEach(h => { const m = h && h.match(/^\/blogs\/gems\/([^\/?#]+)$/); if (m && m[1] !== 'tagged' && !articles.has(m[1])) { articles.add(m[1]); added++; } });
    console.log('list page', n, 'status', r.status(), 'total', articles.size);
    if (!added) break;
  }
  const list = [...articles]; fs.writeFileSync(__dirname + '/articles.json', JSON.stringify(list, null, 1));
  // fetch articles, 4 at a time
  const queue = list.slice(); const pages = await Promise.all([1,2,3,4].map(newPage));
  await Promise.all(pages.map(async pg => { while (queue.length) { const h = queue.shift(); try { await pg.goto('https://www.preciouscarats.com/blogs/gems/' + h, { waitUntil: 'domcontentloaded', timeout: 60000 }); fs.writeFileSync(path.join(OUT, h + '.html'), await pg.content()); } catch (e) { console.log('ERR', h, e.message); } } }));
  console.log('articles saved', fs.readdirSync(OUT).length);
  // collect internal links from article bodies
  const links = {};
  for (const f of fs.readdirSync(OUT)) {
    const s = fs.readFileSync(path.join(OUT, f), 'utf8');
    const m = s.match(/<div class="article-page__content rte">([\s\S]*?)<\/div>\s*(?:<div class="article-page__tags|<footer|<section|<aside)/);
    const body = m ? m[1] : '';
    for (const mm of body.matchAll(/href="([^"]+)"/g)) {
      let h = mm[1].replace(/&amp;/g, '&');
      if (/^(mailto:|tel:|#|javascript:|whatsapp:)/i.test(h)) continue;
      if (/^https?:\/\//i.test(h) && !/preciouscarats\.com/i.test(h)) continue;
      h = h.replace(/^https?:\/\/(www\.)?preciouscarats\.com/i, '');
      if (!h.startsWith('/')) h = '/blogs/gems/' + h; // relative hrefs resolve against the article URL
      h = h.split('#')[0];
      (links[h] = links[h] || []).push(f.slice(0, -5));
    }
  }
  const uniq = Object.keys(links); console.log('unique internal destinations', uniq.length);
  const bad = {}; const q2 = uniq.slice();
  await Promise.all(pages.map(async pg => { while (q2.length) { const u = q2.shift(); try { const r = await pg.goto('https://www.preciouscarats.com' + u, { waitUntil: 'domcontentloaded', timeout: 60000 }); const st = r ? r.status() : 0; const title = await pg.title(); if (st >= 400 || /not found|404/i.test(title)) bad[u] = { status: st, title, in: [...new Set(links[u])] }; } catch (e) { bad[u] = { status: 'ERR', title: e.message.slice(0, 80), in: [...new Set(links[u])] }; } } }));
  fs.writeFileSync(__dirname + '/broken-links.json', JSON.stringify(bad, null, 1));
  console.log('broken destinations', Object.keys(bad).length); console.log(JSON.stringify(bad, null, 1).slice(0, 4000));
  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
