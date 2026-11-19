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

## 19 Nov 2026: re-check of the Rajat Work tab (doc unchanged since 5 Nov)

Every item was checked again on the live site (headless Chrome; plain curl
still gets 429).

Still in place: the four Pukhraj links (item 1), both canonicals and their
self-canonical targets (items 5/6), the three DRAFT orphan products (still
unpublished), rendered alt text on products uploaded after the backfill.

Article links re-scanned (item 1): all 431 articles from
`sitemap_articles_1.xml` read, 337 unique internal destinations fetched,
**0 broken**; no article has been edited since 7 Nov. `scripts/recheck.js`
does both re-checks (`node recheck.js <orphan csv> A|B|AB`, needs
`puppeteer-core` and local Chrome; run with `PACE=2500`, the storefront
throttles anything faster after about 230 requests).

Found and fixed in the theme:
- **Purple Sapphire links (item 5).** The canonical was right but five link
  sources still used `/collections/purple-sapphire`: the header Specials menu
  (every page), the breadcrumb / Explore / "View all" links on the 42 purple
  sapphire product pages, the Sapphire hub tile (the hub's
  `custom.child_collections` metafield lists both collections), the purple
  sapphire gem guide and the article "Shop" links, and `page.sitemap.liquid`.
  New `snippets/preferred-collection-handle.liquid` returns the collection
  named in `custom.canonical_url`; `gem-collection-handle` and
  `collection-children` call it (tiles are de-duplicated), `gem-guide-map`
  maps purple sapphire to khooni-neelam, the header entry reads
  "Khooni Neelam (Purple Sapphire)". Product breadcrumbs therefore read
  Home › Blue Sapphire › Khooni Neelam (the parent set on khooni-neelam).
- **Ruby strands had no collection link (item 2).** Gem listings hide strand
  products, and Strand Edit builds its sections from `collection.products`,
  which stops at 50 outside a paginate block. Its 6 Ruby strands sit at
  positions 57–62 of 63, so the Ruby section was dropped and those products
  (5 of them in Appendix A) were linked only from
  `/collections/strand-edit?filter.p.m.custom.gem_type=Ruby`, a page nothing
  linked to. The grouped view is now wrapped in `paginate … by 250` for
  Strand Edit and Sanctum (50, as before, for the other hubs).
- **Blog topic titles (item 4): written, not pushed.** `/blogs/gems/tagged/<tag>`
  would read "Blue Sapphire – Journal – Precious Carats" instead of
  `Journal – tagged "blue sapphire" – …`. Titles are already unique per tag
  and per page number; H1 and meta description are shared by all topic pages.
  The edit is in `layout/theme.liquid`, which is held back: see the drift
  note below.

**Live theme has drifted from the repo (found 19 Nov).** Six files on the live
theme carry their pre-currency content (identical to commit 78c71a5), all
rewritten at 17:08–17:09 UTC on 15 Nov, when the delayed WebP push finished:
`layout/theme.liquid`, `assets/theme.js`, `config/settings_schema.json`,
`snippets/facets.liquid`, `snippets/price-inr.liquid`,
`snippets/product-card.liquid`. The other nine files of the currency commit
35403e1 are live. Effect: `pc-currency.js` is never loaded and
`window.PCCurrency` is undefined, so visitors outside India still see rupees.
Shopify only applies files a push changes, so these six need a real change
(or Actions → Reset to last commit on the theme card) to come back; pushing
`layout/theme.liquid` alone would load the script while product cards still
render the old price markup.

Deployed 19 Nov, 12:44–12:51 UTC (checksums match the repo) and checked on 12
live pages: no link to `/collections/purple-sapphire` is left on the home
page, the Sapphire hub, a purple sapphire product page, the gem guide or the
collection pages; Strand Edit shows a Ruby section (6 items, 4 cards + View
All) and went from 17 to 21 product links; no Liquid errors.

Evidence refreshed: `orphan-products-collection-links.csv` — 141 products on
the same page as on 9 Nov, 13 moved a page (new URL recorded), 4 Ruby strands
now on `/collections/strand-edit` itself and 1 on its Ruby View All page,
3 DRAFT.

Open:
- **Alt text has regressed for new uploads (item 3).** 331 products were
  created after 9 Nov and their admin alt text is the file name again
  (`ITLGR_131433_FRONT.png`); the storefront still renders the Appendix G text
  from `snippets/product-image-alt.liquid`. `alt_text_backfill.py --apply`
  fixes it (it only touches file-name alts) and has to be re-run after every
  catalogue upload, or the uploader should write the alt itself.
- `/collections/khooni-neelam` has no SEO description; the consolidated
  duplicate `purple-sapphire` carries one that is written about Khooni Neelam.
- Owner-side items as listed above (authors, article→collection mapping).
