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

## 7–9 Nov 2026: doc re-verified 5 Nov, remaining items

Theme (one file per commit, all checksum/live-verified):
- `layout/theme.liquid` – `rel=canonical` honours a new collection metafield
  `custom.canonical_url` (type url, definition created 7 Nov). Set on
  `purple-sapphire` → `/collections/khooni-neelam` and `certified-gemstones` →
  `/collections/all-gemstones` (items 5/6). Both targets stay self-canonical
  and indexable (no `seo.hidden`, not in the theme's noindex list).
- Internal links moved to the preferred URLs: header mega-menu entry
  ("Khooni Neelam (Purple Sapphire)"), footer Sapphires group, home gem tile
  (`templates/index.json` up_27), sapphire hub child tiles
  (`snippets/collection-children.liquid`); footer "Certified Gemstones" link
  removed (All Gemstones is the browse hub).
- `snippets/facets.liquid` + `sections/main-collection.liquid` – not SEO, but
  found the same day: adding a second filter after a weight bucket kept only
  the first of the bucket's exact weight values (per-value `params.has(key)`
  check), so e.g. 6–7 ct + Sri Lanka showed 0 pieces and the hub tiles.
  Fixed; hub tiles now need `all_products_count == 0`.

Store data:
- Article `names-of-pukhraj-in-indian-languages`: the four
  `href="Pokhraj%20/%20Pushparag"` links (Bengali, Tamil, Telugu, Kannada
  rows) now link to `/collections/yellow-sapphire` (connector `articleUpdate`).
- Full article scan finished: 431 articles crawled with puppeteer
  (`scripts/article_crawl.js` + `article_recheck.js`), 338 unique internal
  destinations fetched, **0 return 404** (a first pass flagged 35 but they
  were 429 rate-limits; the sequential recheck cleared all).
- Khooni Neelam collection rule changed from "title contains Khooni" (11
  products) to `custom.gem_type = Purple Sapphire` + inventory > 0 (42,
  identical to Purple Sapphire) so the consolidated page carries the full
  range. Old rule in `khooni-neelam-rules-backup-2026-11-07.json`.
- Orphan products (Appendix A, 162): `orphan-products-collection-links.csv`
  gives, per product, the collection, its position in the collection order and
  the exact `?page=N` URL on which the product card was seen in the rendered
  page. 147 verified at once; 12 ACTIVE products had **no metafields at all**
  (no gem_type/origin), so no gem collection matched them and they were only
  in All Gemstones / Sacred Essentials. Store-wide scan: 20 active products
  lacked `custom.gem_type`; 19 backfilled from `productType` (+ origin from
  the title where a catalogue origin value matched), see
  `gem-type-backfill-2026-11-09.json`; the 20th is the ₹500 service-charge
  product. 3 of the 162 are DRAFT (blue-sapphire 11.41 / 11.42, neelam 6.24):
  not published, so not linkable until the owner publishes them.
- Alt text (item 3, approved by the owner 7 Nov): `alt_text_backfill.py
  --apply` over 5,108 active products / 36,973 images. Runs stop on token
  expiry (24 h) or connection resets; `shopify_api.py` now re-mints on 401 and
  retries URLError, and a re-run only touches images whose alt is still a
  file name, so it is safe to relaunch until "done" prints. **Finished 9 Nov
  2026**: three runs wrote 36,979 images in total; the final dry run reports
  0 images left with a file-name alt across 5,108 active products.

Still owner-side: author names + bios for item 4 (/pages/our-gemmologists,
bylines, BlogPosting author), article→collection link mapping, and the
"Need Gitanshu Approval" tab (rashi stone lists, per-collection copy).
