# Product Metafields sheet — data branch

This orphan branch (`product-sheet-data`) holds nothing but the data behind the
**Product Metafields** Google Sheet. Do not merge it into `main`.

The Google Sheet does not store the rows itself: its first tab stacks
`IMPORTDATA(...)` calls over the CSV chunks in `data/`, served raw from GitHub, so
every push to this branch shows up in the sheet within about an hour (Sheets
re-fetches IMPORTDATA sources roughly hourly and on open).

## Files (all under `marketing/product-sheet/`)

| File | What it is |
|---|---|
| `build_products_csv.py` | Builds `data/products-N.csv` + `data/manifest.json` from a Shopify bulk export and the Drive inventory. Standard library only. |
| `metafield-definitions.json` | Product metafield definitions (namespace, key, display name, type). Decides column names and order. |
| `data/products-1.csv` … `products-N.csv` | The sheet rows. Chunk 1 carries the header; later chunks are header-less continuations. Rows are split evenly into exactly 8 chunks (~0.7 MB each today) so the sheet formula stays valid; Sheets rejects IMPORTDATA sources above ~2 MB. |
| `data/manifest.json` | Row/column/chunk counts and Drive match statistics for the last build. |
| `data/drive-videos.csv` | Every video file in the Google Drive: `video_id,parent_id,title,mime_type,created_time`. |
| `data/drive-folders.csv` | SKU folders in the shared drive (`0AKNNl94GBEKbUk9PVA`): `folder_id,title,created_time`. Folder title = SKU. |
| `data/drive-state.json` | `last_video_sweep_at`, used by the daily routine to fetch only new videos. |
| `data/unresolved-parents.txt` | Folder ids that hold videos but are missing from `drive-folders.csv` (should be empty). |
| `ROUTINE.md` | The prompt the scheduled Claude routine runs every day at 05:00 IST. |

## Columns

Shopify Product ID, Variant ID, SKU, Title, Handle, Status, Product Type, Vendor, Tags,
Price, Compare At Price, Inventory Qty, Product URL, Admin URL, Featured Image,
one column per product metafield (`Display Name [namespace.key]`, definition order,
unused definitions dropped), Drive Video Link, Drive Video File, Drive SKU Folder,
Updated At.

A product gets a Drive video when a folder whose title equals the product's SKU
(variant SKU, falling back to `custom.sku_number`) contains a video file. Several
videos are joined with ` | `.

## Rebuild by hand

```bash
# 1. Shopify bulk export (Admin GraphQL, via the Shopify connector or an Admin token)
#    mutation: bulkOperationRunQuery(query: <see ROUTINE.md>) → poll currentBulkOperation → curl url
# 2. Drive inventory: see ROUTINE.md (search mimeType contains 'video/', resolve parent folders)
# 3. Build
python3 marketing/product-sheet/build_products_csv.py \
  --bulk /tmp/products.jsonl \
  --videos marketing/product-sheet/data/drive-videos.csv \
  --folders marketing/product-sheet/data/drive-folders.csv \
  --defs marketing/product-sheet/metafield-definitions.json \
  --out-dir marketing/product-sheet/data
git add marketing/product-sheet && git commit -m "data: product sheet refresh" && git push origin product-sheet-data
```

## Sheet formula

Tab `Products`, cell A1 (one IMPORTDATA per chunk, in order):

```
=VSTACK(IMPORTDATA("https://raw.githubusercontent.com/preciouscaratsopsteam-code/precious-carat/product-sheet-data/marketing/product-sheet/data/products-1.csv"),
        IMPORTDATA(".../products-2.csv"), ... IMPORTDATA(".../products-8.csv"))
```

If a chunk is added or removed, extend or shorten the formula accordingly.
IMPORT functions only run once the spreadsheet has been opened in a browser; API
exports of a never-opened sheet show `#REF!` for them.

## Option B: plain values via Apps Script (`apps-script/Code.gs`)

If you would rather have editable, sortable values than formula output: open the
sheet, Extensions > Apps Script, paste `apps-script/Code.gs`, run
`setupDailyTrigger()` once and authorise. It fills a tab `Products (values)` from the
same CSV chunks and re-runs every day at 05:00 IST, about 30 minutes after the
routine has pushed fresh data.

## Caveats

* The repository is public, so everything on this branch (including draft and
  archived products) is readable by anyone with the URL. Export only active
  products if that matters.
* Multi-line metafield values are flattened to one line (` | ` between lines).
* IMPORTDATA parses values like the Sheets UI: numeric-looking text becomes numbers.
