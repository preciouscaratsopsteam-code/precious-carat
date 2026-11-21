/**
 * HTML -> readable plain text. Used by scripts/build-knowledge.mjs (store pages)
 * and by the Worker for blog article bodies. No dependencies, regex only: the
 * inputs are the store's own pages, not arbitrary HTML.
 */

const NAMED: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  ndash: '–', mdash: '—', hellip: '…', middot: '·', bull: '•',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
  rarr: '→', larr: '←', times: '×', deg: '°', copy: '©', reg: '®', trade: '™',
  rupee: '₹', frac12: '½', frac14: '¼', frac34: '¾',
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ' ';
    }
    return NAMED[body.toLowerCase()] ?? whole;
  });
}

/** The page's own content: everything inside <main>…</main>, or the input unchanged. */
export function extractMain(html: string): string {
  const open = html.search(/<main\b/i);
  const close = html.lastIndexOf('</main>');
  if (open < 0 || close <= open) return html;
  return html.slice(html.indexOf('>', open) + 1, close);
}

export function htmlToText(html: string): string {
  let h = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|svg|noscript|template|iframe|select)\b[\s\S]*?<\/\1>/gi, ' ');
  h = h
    .replace(/<h([1-6])\b[^>]*>/gi, (_m, n: string) => `\n\n${'#'.repeat(Math.min(Number(n), 4))} `)
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<\/t[dh]>/gi, ' | ')
    .replace(/<(br|hr)\b[^>]*>/gi, '\n')
    .replace(/<\/?(p|div|section|article|header|footer|main|aside|nav|tr|table|ul|ol|dl|dt|dd|summary|details|blockquote|figure|figcaption|h[1-6]|li)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  const lines = decodeEntities(h)
    .replace(/[ \t\r\f\v ]+/g, ' ')
    .split('\n')
    .map((l) => l.trim().replace(/\s+\|$/, ''))
    .filter((l) => l && l !== '-' && !/^#+$/.test(l));
  return lines.join('\n').replace(/\n(#{1,4} )/g, '\n\n$1').trim();
}
