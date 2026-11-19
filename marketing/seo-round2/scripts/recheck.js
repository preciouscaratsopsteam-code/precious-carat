// Re-verification, 19 Nov 2026:
//  A. Appendix A orphan products: is each product still linked from the collection page recorded in the CSV?
//     If not, find the page it is on now.
//  B. All journal articles: every internal link in the article body must resolve (no 4xx/5xx).
// Usage: PACE=2500 node recheck.js <orphan csv> [A|B|AB]   (needs puppeteer-core + local Chrome; writes its results next to this file)
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const csvPath = process.argv[2]; const parts = process.argv[3] || 'AB';
const B = 'https://www.preciouscarats.com'; const PER = 15;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const sleep = ms => new Promise(r => setTimeout(r, ms)); const PACE = +(process.env.PACE || 650);
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
(async () => {
  const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new' });
  const pg = await browser.newPage(); await pg.setUserAgent(UA); await pg.setRequestInterception(true);
  pg.on('request', r => (['image', 'media', 'font', 'stylesheet', 'script'].includes(r.resourceType()) ? r.abort() : r.continue()));
  for (let a = 0; a < 5; a++) { const r = await pg.goto(B + '/pages/about', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => null); if (r && r.status() === 200) break; await sleep(15000); }
  let n = 0;
  async function get(u, wantText) {
    for (let a = 0; a < 6; a++) {
      let r = null;
      try { r = await pg.evaluate(async (u, wantText) => { const ac = new AbortController(); setTimeout(() => ac.abort(), 45000); const r = await fetch(u, { redirect: 'follow', credentials: 'same-origin', signal: ac.signal }); return { st: r.status, url: r.url, text: wantText ? await r.text() : '' }; }, u, wantText); } catch (e) { r = null; }
      n++;
      if (r && r.st !== 429 && r.st !== 430 && r.st < 500) { await sleep(PACE); return r; }
      await sleep(12000 * (a + 1));
    }
    return { st: 'ERR', url: u, text: '' };
  }

  if (parts.includes('A')) {
    const lines = fs.readFileSync(csvPath, 'utf8').trim().split('\n'); const head = lines.shift();
    const pageCache = {}; const collCache = {};
    const pageText = async url => (pageCache[url] = pageCache[url] || (await get(url.replace(B, ''), true)).text);
    const has = (text, h) => new RegExp('/products/' + esc(h) + '["\'?#]').test(text);
    async function handlesOf(ch) {
      if (collCache[ch]) return collCache[ch];
      const hs = [];
      for (let p = 1; p <= 30; p++) {
        const r = await get(`/collections/${ch}/products.json?limit=250&page=${p}`, true);
        let ps = []; try { ps = JSON.parse(r.text).products || []; } catch (e) {}
        ps.forEach(x => hs.push(x.handle)); if (ps.length < 250) break;
      }
      console.log('  collection', ch, hs.length); return (collCache[ch] = hs);
    }
    const out = [head + ',recheck,current_position,current_page_url'];
    let same = 0, moved = 0, gone = 0, skipped = 0;
    for (const line of lines) {
      const f = line.split(','); const [h, status, , coll, , url, result, all] = f;
      if (result !== 'verified on page') { out.push(line + ',not rechecked (' + status + '),,'); skipped++; continue; }
      if (has(await pageText(url), h)) { out.push(line + ',still on the same page,' + f[4] + ',' + url); same++; continue; }
      // look for it in the recorded collection first, then the product's other collections
      let found = null;
      const tryColls = [coll, ...all.split('|').filter(c => c && c !== coll)].slice(0, 6);
      for (const ch of tryColls) {
        const hs = await handlesOf(ch); const i = hs.indexOf(h); if (i < 0) continue;
        const p0 = Math.floor(i / PER) + 1;
        for (const p of [p0, p0 - 1, p0 + 1, p0 - 2, p0 + 2]) {
          if (p < 1) continue;
          const u = `${B}/collections/${ch}` + (p > 1 ? `?page=${p}` : '');
          if (has(await pageText(u), h)) { found = { pos: i + 1, u }; break; }
        }
        if (found) break;
      }
      if (found) { out.push(line + ',moved,' + found.pos + ',' + found.u); moved++; console.log('  moved', h, '->', found.u); }
      else { out.push(line + ',NOT FOUND in a collection page,,'); gone++; console.log('  NOT FOUND', h); }
    }
    fs.writeFileSync(__dirname + '/orphan-recheck.csv', out.join('\n') + '\n');
    console.log(`A done: same page ${same}, moved ${moved}, not found ${gone}, not rechecked ${skipped}; requests ${n}`);
  }

  if (parts.includes('B')) {
    const sm = await get('/sitemap.xml', true);
    const blogMaps = [...sm.text.matchAll(/<loc>([^<]*sitemap_(?:blogs|articles)[^<]*)<\/loc>/g)].map(m => m[1].replace(/&amp;/g, '&'));
    const arts = new Set();
    for (const u of blogMaps) { const r = await get(u.replace(B, ''), true); for (const m of r.text.matchAll(/<loc>https:\/\/www\.preciouscarats\.com(\/blogs\/[^<\/]+\/[^<]+)<\/loc>/g)) arts.add(m[1]); }
    console.log('B: blog sitemaps', blogMaps.length, 'articles', arts.size);
    const links = {}; let noBody = []; let fetched = 0; const artStatus = {};
    for (const a of arts) {
      const r = await get(a, true); fetched++; if (r.st !== 200) artStatus[a] = r.st;
      const m = r.text.match(/<div class="article-page__content rte">([\s\S]*?)<\/div>\s*(?:<div class="article-page__tags|<footer|<section|<aside)/);
      if (!m) { noBody.push(a); continue; }
      for (const mm of m[1].matchAll(/href="([^"]+)"/g)) {
        let h = mm[1].replace(/&amp;/g, '&').trim();
        if (/^(mailto:|tel:|#|javascript:|whatsapp:)/i.test(h) || h === '') continue;
        if (/^(https?:)?\/\//i.test(h) && !/^(https?:)?\/\/(www\.)?preciouscarats\.com/i.test(h)) continue;
        h = h.replace(/^(https?:)?\/\/(www\.)?preciouscarats\.com/i, ''); if (h === '') h = '/';
        if (!h.startsWith('/')) h = a.replace(/[^\/]+$/, '') + h; // relative hrefs resolve against the article URL
        h = h.split('#')[0];
        (links[h] = links[h] || new Set()).add(a);
      }
      if (fetched % 25 === 0) console.log('  articles read', fetched, 'unique destinations', Object.keys(links).length);
    }
    const dests = Object.keys(links); console.log('B: articles read', fetched, 'without a parsed body', noBody.length, 'unique internal destinations', dests.length);
    const bad = {}; let c = 0;
    for (const d of dests) {
      const r = await get(d, false); c++;
      if (r.st === 'ERR' || r.st >= 400) bad[d] = { status: r.st, in: [...links[d]] };
      if (c % 50 === 0) console.log('  destinations checked', c, 'broken so far', Object.keys(bad).length);
    }
    fs.writeFileSync(__dirname + '/article-links-recheck.json', JSON.stringify({ articles: arts.size, noBody, artStatus, destinations: dests.length, broken: bad }, null, 1));
    console.log(`B done: ${arts.size} articles, ${dests.length} destinations, broken ${Object.keys(bad).length}; requests ${n}`);
    for (const [d, v] of Object.entries(bad)) console.log('  BROKEN', v.status, d, '| in', v.in.length, v.in.slice(0, 3).join(' '));
    if (noBody.length) console.log('  no body parsed:', noBody.slice(0, 10).join(' '));
  }
  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
