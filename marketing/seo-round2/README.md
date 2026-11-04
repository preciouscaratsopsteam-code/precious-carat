# SEO Work – Round 2 ("Rajat Work" tab), 4 Nov 2026

Source: Google Doc "Precious Carats – SEO Work - Round 2"
(1SRePUVC9WB0J1YAJou9NTr3ZpxpmCWMTKzT2IyrZuFs). Only the Rajat Work tab is
covered here; the "Need Gitanshu Approval" tab is untouched.

## Scripts

All scripts mint a 24 h Admin token from `SHOPIFY_CLIENT_ID` /
`SHOPIFY_CLIENT_SECRET` in `.env` (`shopify_api.py`). That app has
`write_products` but **no** content, redirect, publication or theme scopes, so
articles, redirects and the blog title were changed through the Claude Shopify
connector instead.

| script | what it does |
| --- | --- |
| `hide_sold_from_collections.py` | Action 2. Adds "Inventory stock > 0" and switches to *all conditions* on every automated collection whose rule set can be AND-ed (136 of 164). Writes `collection-rules-backup-<date>.json`; `--revert <file>` restores. 28 OR-of-many hub collections cannot carry the rule (listed by the dry run). Applied 4 Nov 2026. |
| `alt_text_backfill.py` | Action 6, catalogue half. Builds Appendix G alt text (same as `snippets/product-image-alt.liquid`) for every product image whose admin alt is blank or a file name, writes `alt-text-plan.csv`; `--apply` writes them with `productUpdateMedia`. **Not applied** – owner approval needed before a 37k-image write. |
| `scan_article_links.py` | Action 1, step 1. Reads the headless-Chrome crawl of all 431 articles (Shopify 429s plain curl; the Atom feed ignores `?page=`), maps every broken `/blogs/gems/*` destination and old URL to its fix (`FIXES` dict) and writes `article-link-fixes.json` (92 articles). |
| `patch_article_bodies.py` | Action 1, step 2. Applies the fixes to the fetched article bodies (topaz links by anchor text, `http://(www.)PreciousCarats.com` → `https://www.preciouscarats.com`, `/blogs` → `/blogs/gems`) and writes one patched body per article plus an index. |
| `push_article_bodies.py` | Action 1, step 3. `articleUpdate` per patched body, then re-fetch and compare. Needs `write_content`, which the app does not have, so the 92 bodies were pushed through the Claude Shopify connector instead (one mutation each) and verified the same way. |

## What changed on 4 Nov 2026

Theme (one file per commit, GitHub-synced):
- `templates/robots.txt.liquid` – `Disallow: /search` back in the `*` group.
- `layout/theme.liquid` – a single `<meta name="robots">` per page: Shopify's
  `noindex,nofollow` (from the `seo.hidden` metafield) is removed from
  `content_for_header` whenever the theme emits `noindex, follow`. Also
  re-applied commit 5748832 (blog/article meta descriptions, home title) that
  the 1 Nov "Update from Shopify" write-back had dropped.
- `snippets/product-image-alt.liquid` – alt text never cuts a certificate
  number or view label; treatment text is shortened first.
- `snippets/our-promise.liquid`, `templates/index.json`,
  `templates/page.llms-txt.liquid` – `/pages/transparent-operations` →
  `/pages/treatment-disclosure`.
- `sections/footer.liquid` – padparadscha handle.
- `sections/main-product.liquid` – FAQ answer links `/pages/how-we-photograph-our-gems`.
- `sections/site-footer.liquid` – Upratnas group links `/pages/green-onyx-gem-guide`.

Store data (Shopify connector):
- Redirect `/collections/all-sapphires` → `/collections/sapphire` created
  (`/collections/padparadsha-sapphire` → padparadscha already existed;
  `/pages/transparent-operations` already 301s).
- Blog `gems` title renamed **Journal** (handle unchanged, so breadcrumbs,
  BlogPosting `isPartOf`/`articleSection` and the blog H1 follow).

Articles (Shopify connector, 4 Nov 2026):
- 92 article bodies updated: 53 had broken or old links, 39 only had
  `http://www.preciouscarats.com` links. Every live body was re-fetched and
  compared with its patched file: 89 identical, 3 differ only because Shopify
  stores the Hindi letter ख़ as KHA + NUKTA instead of the precomposed KHHA
  (same text, same links). No `transparent-operations`, `padparadsha-sapphire`,
  `all-sapphires`, `http://` or bare `/blogs` link is left in any of them.
- Broken destinations whose intended article does not exist (Pokhraj,
  Pushparag) were unlinked rather than pointed at the home page.

## Findings worth keeping

- The duplicate robots tag was not an app: Shopify itself writes
  `<meta name="robots" content="noindex,nofollow">` into `content_for_header`
  for any resource with `seo.hidden = 1`. The theme's `noindex, follow` tag
  was the second one.
- Shopify's default robots.txt no longer carries `Disallow: /search` for this
  store, so the theme adds it explicitly.
- The 166 "orphan" products are all active, in stock and inside their gem
  collections (positions 20–700 of manually sorted grids, 15 per page). Crab
  did not follow `?page=N` links; the paginated pages are self-canonical and
  crawlable. Nothing to fix on the product side; the two info pages got links.
- 38 active products have inventory 0 (sold). 212 products are draft.
- Rendered alt text was already in place via the theme; the "missing alt"
  crawl count comes from decorative `alt=""` icons (compare scale, menu gem
  icons, hidden duplicate menu tiles), which is the correct treatment.
