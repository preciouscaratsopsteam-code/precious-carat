/** Small pure helpers. Everything here is unit-tested in test/util.test.ts. */

export const clip = (s: string, max: number): string => (s.length <= max ? s : s.slice(0, max - 1).trimEnd() + '…');

/** Carat weight from a product title ("Burma Ruby 4.33 Carat") or its description ("weighing 4.33 ct"). */
export function parseCarat(title: string, description = ''): number | null {
  const fromTitle = /(\d+(?:\.\d+)?)\s*-?\s*(?:carats?|cts?)\b/i.exec(title);
  const m = fromTitle ?? /weigh(?:s|ing)\s+(\d+(?:\.\d+)?)\s*(?:ct|carats?)\b/i.exec(description);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Ratti weight, which the store prints in brackets after the carat weight: "4.33 ct (4.82 ratti)". */
export function parseRatti(description: string): number | null {
  const m = /(\d+(?:\.\d+)?)\s*ratti\b/i.exec(description);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export const digitsOnly = (s: string): string => s.replace(/\D+/g, '');

/** Last ten digits — how two Indian mobile numbers are compared regardless of +91 / 0 / spaces. */
export function phoneKey(s: string | null | undefined): string | null {
  const d = digitsOnly(s ?? '');
  return d.length >= 10 ? d.slice(-10) : null;
}

export const emailKey = (s: string | null | undefined): string | null => {
  const e = (s ?? '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null;
};

/**
 * E.164 for Shopify. Ten digits are taken as an Indian mobile; anything written
 * with a country code is kept. Returns null when it cannot be a phone number.
 */
export function toE164(raw: string): string | null {
  const trimmed = raw.trim();
  let d = digitsOnly(trimmed);
  if (trimmed.startsWith('+') || trimmed.startsWith('00')) {
    if (trimmed.startsWith('00')) d = d.slice(2);
    return d.length >= 8 && d.length <= 15 ? `+${d}` : null;
  }
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  if (d.length === 10 && /^[6-9]/.test(d)) return `+91${d}`;
  if (d.length === 12 && d.startsWith('91') && /^[6-9]/.test(d.slice(2))) return `+${d}`;
  return null;
}

/** "#1131", "1131", "order 1131" -> "1131". Null when there is no number in it. */
export function orderDigits(raw: string): string | null {
  const d = digitsOnly(raw);
  return d.length >= 1 && d.length <= 12 ? d : null;
}

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

/**
 * Match free text from the model ("africa", "unheated", "cat's eye") against the
 * live filter values of the store. Exact matches win, together with near-twins
 * the store's data entry has produced ("Africa" / "African", "Sri Lanka" /
 * "Srilanka"); otherwise any value that has the text at the start of a word, so
 * "sapphire" finds every sapphire while "heated" does not find "Unheated".
 */
export function matchFacetValues<T extends { label: string }>(values: T[], text: string): T[] {
  const want = norm(text);
  if (!want) return [];
  if (values.some((v) => norm(v.label) === want)) {
    return values.filter((v) => {
      const have = norm(v.label);
      return have.startsWith(want) && have.length - want.length <= 2;
    });
  }
  const words = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  if (!words.length) return [];
  const pattern = new RegExp('(^|[^a-z0-9])' + words.join('[^a-z0-9]*'));
  return values.filter((v) => pattern.test(v.label.toLowerCase()));
}

export const rupees = (amount: string | number | null | undefined): number => {
  const n = Math.round(Number(amount));
  return Number.isFinite(n) ? n : 0;
};

/** A Shopify handle, and nothing that could alter a URL or a query. */
export const isHandle = (s: unknown): s is string => typeof s === 'string' && /^[a-z0-9][a-z0-9-]{0,200}$/.test(s);
