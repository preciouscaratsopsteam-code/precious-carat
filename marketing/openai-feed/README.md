# OpenAI Ads product feed (SFTP)

OpenAI Ads does not fetch a feed URL. The catalogue has to be **pushed as a CSV over SFTP** to a location
that the Ads API creates for the feed. Everything for that lives here, in one dependency-free Python script
that runs with the `python3` already on the Mac.

| Piece | What it is |
|---|---|
| `templates/collection.openai-feed.liquid` | The theme renders the catalogue as CSV at `https://www.preciouscarats.com/collections/all?view=openai-feed&page=N` (250 rows a page). Always current, no Admin API needed. |
| `marketing/openai-product-feed.csv` | The last file built from those pages and uploaded. One row per product, `item_id` = SKU. |
| `marketing/openai-feed/openai_feed.py` | `build` / `setup` / `upload` / `status` / `all` (see below). |
| `.env` at the repo root (git-ignored) | `OPENAI_ADS_API_KEY`, and after setup `OPENAI_ADS_FEED_ID` + `OPENAI_FEED_SFTP_HOST/PORT/USER/PASSWORD`. Never commit these. |

## One-time setup

1. In **OpenAI Ads Manager → Settings → API keys** (<https://ads.openai.com/settings>), create an **Advertiser API key** for the Precious Carats ad
   account and paste it into `.env` as `OPENAI_ADS_API_KEY=...`.
   (The `OPENAI_CAPI_*` keys already in `.env` are Conversions API keys for the pixel; the Ads API rejects them with 403.)
2. Run, from the repo root:
   ```
   python3 marketing/openai-feed/openai_feed.py setup
   ```
   This creates the feed ("Precious Carats catalogue", country IN) if it does not exist, asks OpenAI for an SFTP
   **password** login, and saves `OPENAI_ADS_FEED_ID`, `OPENAI_FEED_SFTP_HOST/PORT/USER/PASSWORD` to `.env`.
   The upload then drives `/usr/bin/sftp` through `expect` (both ship with macOS).
   `setup --auth ssh_key` is also implemented (generates `~/.ssh/openai_feed_ed25519` and registers the public half),
   but on 2026-10-03 OpenAI's SFTP server (Azure SFTP on port 443) refused the key both with and without its comment,
   while the password login worked first time. Stick with password unless OpenAI says key auth is fixed.
   Note: creating SFTP access again replaces the previous login.
3. First upload:
   ```
   python3 marketing/openai-feed/openai_feed.py all
   ```

## Refreshing the feed

Whenever prices, stock or products change (weekly is a sensible minimum):
```
python3 marketing/openai-feed/openai_feed.py all
```
`all` = `build` (download the live pages, fix duplicate SKUs, validate against the OpenAI schema, write the CSV)
→ `upload` (replace `openai-product-feed.csv` in the SFTP root) → `status --wait` (poll until OpenAI reports
`completed`, print accepted/rejected rows and diagnostics).

Rules that the script enforces, from the OpenAI docs:
- Same filename every upload, placed in the SFTP root with no sub-folders.
- The file is the **complete** catalogue; out-of-stock items stay in it as `out_of_stock` / `is_ads_eligible=false`.
- `item_id` never changes for a product. Two products sharing a SKU: the lower variant id keeps the bare SKU, the other becomes `SKU-<variant id>`.
- Lowercase `true`/`false`, UTF-8, prices as `12345.00 INR`, title ≤ 150 and description ≤ 5000 chars, https URLs only.
- Image URLs: the deployed template still emits Shopify's protocol-relative `//www.preciouscarats.com/cdn/shop/...`; `build` rewrites them to https. The repo copy of the template (Oct 3 2026) emits https itself once the theme is deployed.
- It refuses to write or upload a file under 1,000 rows (a broken render would otherwise wipe the catalogue). Override with `--allow-small`.

## If something fails

| Symptom | Meaning |
|---|---|
| `403 Unauthorized to read ads data` | Wrong key type. Use an Advertiser API key, not a Conversions API key. |
| `POST /feeds` fails | Product-feed API access is not enabled on the account (ask the OpenAI account team), or IN is not an allowed country for the ad account. |
| upload `status` = `completed_with_errors` / `failed` | Read the printed diagnostics: `missing_required_column`, `invalid_value` (field named), `invalid_sftp_directory_layout` (file not in the root). |
| `build` says the page rendered as HTML | The theme template is not deployed on the live theme. |

Pause uploads without touching campaigns: `POST /v1/feeds/{feed_id}/sftp_access/pause` (and `/activate`).
Docs: https://developers.openai.com/ads/product-feeds and the schema at
https://developers.openai.com/commerce/specs/file-upload/products
