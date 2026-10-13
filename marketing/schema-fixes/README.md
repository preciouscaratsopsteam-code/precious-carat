# Schema fixes — 13 October 2026

Implements the six fixes in *Precious Carats — Schema fixes* (live check,
13 Oct 2026). Theme changes live in the theme folders; this folder holds the
data pipeline behind fix 4.

| # | Fix | Where it landed |
|---|-----|-----------------|
| 1 | Remove the JewelryStore block | `snippets/store-jsonld.liquid` deleted, its render in `snippets/meta-tags.liquid` and the "Delhi store" theme settings removed. Organization (with the registered-office address) stays on every page. |
| 2 | Full breadcrumb trail on child collections | `sections/main-collection.liquid`: the parent's own parent is resolved through `snippets/crumb-parent.liquid` (metafield `custom.parent_collection` first, then the Navratna / Upratnas / Sacred Essentials hub lists and handle inference). Visible trail and BreadcrumbList both gain the grandparent. No metafield has to be filled for the existing hierarchy; filling it overrides the inference. |
| 3 | Blog author = Organization | `sections/main-article.liquid`: byline defaults to the brand; the schema author is the `…/#organization` reference whenever the byline is the brand or the Shopify author is just the store name. Switch the section setting to "Article author" once posts carry real gemmologist names. |
| 4 | Video fields | `snippets/meta-tags.liquid` VideoObject: `uploadDate` is full ISO 8601 with a colon offset (new `snippets/iso-datetime.liquid`), `thumbnailUrl` is Vimeo's own frame (or the product's main photo on the Shopify CDN as fallback, never vumbnail.com), `duration` is emitted when known. Real per-video values come from the `custom.video_meta` metafield filled by `vimeo_video_meta.py` (below). Unlisted `ID/HASH` links now get `?h=` on the embed URL; videos Vimeo no longer serves get no VideoObject. |
| 5 | All product images in schema | `limit: 6` dropped from the `Product.image` loop. |
| 6 | Site-name signals | `layout/theme.liquid`: homepage `<title>` from Theme settings → Business details → "Homepage title tag" (default "Precious Carats — Certified natural gemstones, every treatment disclosed"); page-title suffix and `og:site_name` use the brand name "Precious Carats" instead of the store name "PreciousCarats". |

## Fix 4 data pipeline: `vimeo_video_meta.py`

Shopify does not know a Vimeo video's upload date, length or thumbnail, so the
script asks Vimeo's public oEmbed (no API key) once per video and stores the
answer on the product as `custom.video_meta` (JSON, definition created 13 Oct
2026):

```json
{"1234921584": {"duration": 16, "uploadDate": "2026-10-12T08:03:55+05:30",
                "thumbnailUrl": "https://i.vimeocdn.com/video/2211034420-…-d_1280?region=us"},
 "1232141836": {"broken": true}}
```

* Vimeo's `upload_date` has no offset and is US Eastern time (verified against
  the account RSS feed, whose `pubDate` carries `-0400`); the script converts it
  to Asia/Kolkata.
* `broken: true` = oEmbed 404/403 (deleted, failed upload, or unlisted without
  its hash). The theme skips those instead of advertising a dead video.
* Product list comes from the daily export on branch `product-sheet-data`
  (`marketing/product-sheet/data/products-N.csv`, columns "Shopify Product ID",
  "Status", "Vimeo Video [custom.video]"). Only ACTIVE products are written
  unless `--include-draft`.

### Run (no Admin token — the claude.ai Shopify connector does the two API calls)

```bash
git fetch origin product-sheet-data
python3 marketing/schema-fixes/vimeo_video_meta.py fetch --from-branch origin/product-sheet-data   # ~20 min for 5.9k videos
python3 marketing/schema-fixes/vimeo_video_meta.py build --from-branch origin/product-sheet-data   # -> data/video-meta.jsonl
# connector: stagedUploadsCreate(input:[{resource: BULK_MUTATION_VARIABLES, filename:"video-meta.jsonl", mimeType:"text/jsonl", httpMethod: POST}])
#            save stagedTargets[0] as staged-target.json
python3 marketing/schema-fixes/vimeo_video_meta.py upload --staged staged-target.json               # prints stagedUploadPath
# connector: bulkOperationRunMutation(mutation: <MUTATION in the script>, stagedUploadPath: <printed key>)
# connector: currentBulkOperation(type: MUTATION) until COMPLETED
```

With `SHOPIFY_SHOP` + `SHOPIFY_ADMIN_TOKEN` (write_products) in the
environment, `apply` does the staging, upload, bulk run and polling itself.

Re-running `fetch` only asks Vimeo about videos not in `data/vimeo-oembed.json`
(add `--recheck-broken` to retry the 404s). New products need a fresh
`build` + bulk run; products without an entry simply fall back to the
publish date + cover photo in the schema, so nothing breaks in between.

### Last run

See `data/video-meta-summary.json` (written by `build`) and the session notes
in the commit message.

## Test after release

Run each through https://search.google.com/test/rich-results and expect 0 errors:
homepage, `/collections/yellow-sapphire-7-ratti`, one product page with a
video, one blog post, `/pages/contact-us`. Then view-source the homepage for
the new `<title>` and `og:site_name`.
