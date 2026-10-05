# OpenAI Ads product feed (SFTP)

OpenAI Ads does not fetch a feed URL. The catalogue has to be **pushed as a CSV over SFTP** to a location
that the Ads API creates for the feed. Everything for that lives here, in one dependency-free Python script
that runs with the `python3` already on the Mac.

| Piece | What it is |
|---|---|
| `templates/collection.openai-feed.liquid` | The theme renders the catalogue as CSV at `https://www.preciouscarats.com/collections/all?view=openai-feed&page=N` (250 rows a page). Always current, no Admin API needed. |
| `marketing/openai-product-feed.csv` | The last file built from those pages and uploaded. One row per product, `item_id` = SKU. |
| `marketing/openai-feed/openai_feed.py` | `build` / `setup` / `upload` / `status` / `all` (see below). |
| `.github/workflows/openai-feed.yml` | GitHub Actions run that does `build` + `upload` whenever Shopify Flow pings it (see *Automatic sync*). |
| `.env` at the repo root (git-ignored) | `OPENAI_ADS_API_KEY`, and after setup `OPENAI_ADS_FEED_ID` + `OPENAI_FEED_SFTP_HOST/PORT/USER/PASSWORD`; `upload` also stamps `OPENAI_FEED_LAST_UPLOAD_AT` so `status` only reports that upload. Never commit these. |

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
`completed`, print accepted/rejected rows and diagnostics). The upload record only appears about six minutes after the
file lands and completes a minute or so later; OpenAI also drops a small `status.json` in the SFTP root (its own marker, leave it).

**Nothing runs by itself.** OpenAI never pulls the feed, so until a scheduled job runs `all`, the feed is only as
current as the last time someone ran it.

Rules that the script enforces, from the OpenAI docs:
- Same filename every upload, placed in the SFTP root with no sub-folders.
- The file is the **complete** catalogue; out-of-stock items stay in it as `out_of_stock` / `is_ads_eligible=false`.
- `item_id` never changes for a product. Two products sharing a SKU: the lower variant id keeps the bare SKU, the other becomes `SKU-<variant id>`.
- Lowercase `true`/`false`, UTF-8, prices as `12345.00 INR`, title ≤ 150 and description ≤ 5000 chars, https URLs only.
- Image URLs: the deployed template still emits Shopify's protocol-relative `//www.preciouscarats.com/cdn/shop/...`; `build` rewrites them to https. The repo copy of the template (Oct 3 2026) emits https itself once the theme is deployed.
- It refuses to write or upload a file under 1,000 rows (a broken render would otherwise wipe the catalogue). Override with `--allow-small`.

## Automatic sync: every product add or stock change pushes the feed

OpenAI never pulls, so something has to notice changes and push. Two paths run side by side:

| Path | What it does | State |
|---|---|---|
| **Scheduled job on the owner's Mac** (`launchd`, label `com.preciouscarats.openai-feed`) | Every 15 minutes: `openai_feed.py all --if-changed --no-wait`, i.e. rebuild from the live store and upload **only if the catalogue differs from the last upload**. Log: `~/Library/Logs/preciouscarats-openai-feed.log`. Runs whenever the Mac is awake; a missed slot runs on wake. | **Primary. Live since 2026-10-05.** |
| **GitHub Actions** `.github/workflows/openai-feed.yml` | Hourly, on a Shopify Flow ping, or by hand (*Run workflow*, with a *force* option): same build-and-upload-if-changed. GitHub runners sit on shared datacenter IP ranges that Shopify throttles (HTTP 429), so this path often cannot read the store; when that happens it logs a warning and uploads nothing. | **Secondary / best effort.** Secrets set, workflow on `main`. |
| **Shopify Flow** (built into Shopify, Basic plan and up) | Would start the GitHub run the moment a product is added or stock changes. Only useful once GitHub can read the store reliably, which needs a Shopify Admin or Storefront API token instead of the public pages. | **Not set up.** Steps below, for when that token exists. |

Latency today: a change is picked up within 15 minutes, the upload takes about a minute, OpenAI ingests about seven
minutes after the file lands, so a sold gem stops being ads-eligible within roughly 25 minutes.

### Where to see the result
- `~/Library/Logs/preciouscarats-openai-feed.log` on the Mac: one block per run, "nothing to push" or "Upload finished".
- The repo's **Actions** tab: https://github.com/preciouscaratsopsteam-code/precious-carat/actions/workflows/openai-feed.yml
- OpenAI Ads Manager, products page of the account: https://ads.openai.com/manage/products?act=adacct_6a980885d860819cb3347f20ee4a3ac5
- From the repo root: `python3 marketing/openai-feed/openai_feed.py status`

### Mac job: pause, resume, remove
```
launchctl bootout gui/$(id -u)/com.preciouscarats.openai-feed          # stop
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.preciouscarats.openai-feed.plist   # start again
launchctl kickstart -k gui/$(id -u)/com.preciouscarats.openai-feed      # run now
```
If the repo moves or `.env` is rotated, nothing else changes: the job reads both from `~/Devbox/precious-carat`.

### Finishing the Flow side (browser only; only worth it once GitHub can read the store)

**1. A GitHub token for Flow to call.** GitHub → your avatar → Settings → Developer settings → Personal access tokens →
Fine-grained tokens → Generate new token. Resource owner `preciouscaratsopsteam-code`; *Only select repositories* →
`precious-carat`; Repository permissions → **Contents: Read and write** (this is what `repository_dispatch` needs);
expiry one year (set a reminder). Copy the token; it is shown once. Do not reuse a personal token with wider access.

**2. Two Shopify Flow workflows** (Shopify admin → Apps → Flow → Create workflow).

*Workflow A — "OpenAI feed: product added"*
- Trigger: **Product added to store**
- Action: **Send HTTP request**
  - HTTP method: `POST`
  - URL: `https://api.github.com/repos/preciouscaratsopsteam-code/precious-carat/dispatches`
  - Headers:
    - `Authorization` → `Bearer <the token from step 1>`
    - `Accept` → `application/vnd.github+json`
    - `X-GitHub-Api-Version` → `2022-11-28`
    - `Content-Type` → `application/json`
  - Body:
    ```
    {"event_type":"catalog-changed","client_payload":{"trigger":"product-added","handle":"{{ product.handle }}"}}
    ```

*Workflow B — "OpenAI feed: inventory changed"*
- Trigger: **Inventory quantity changed**
- Action: identical to A, body:
    ```
    {"event_type":"catalog-changed","client_payload":{"trigger":"inventory-changed"}}
    ```

GitHub answers `204 No Content` on success. Turn both workflows on, then add a test product or set one gem's stock to 0
and watch a run start in the Actions tab within a minute.

### GitHub secrets (already set on 2026-10-05)
Six repository secrets, same names and values as the `.env` lines: `OPENAI_ADS_API_KEY`, `OPENAI_ADS_FEED_ID`,
`OPENAI_FEED_SFTP_HOST`, `OPENAI_FEED_SFTP_PORT`, `OPENAI_FEED_SFTP_USER`, `OPENAI_FEED_SFTP_PASSWORD`.
If the Advertiser API key or the SFTP password is ever rotated, update both `.env` and the secrets. With the GitHub CLI
logged in, from the repo root:
```
for k in OPENAI_ADS_API_KEY OPENAI_ADS_FEED_ID OPENAI_FEED_SFTP_HOST OPENAI_FEED_SFTP_PORT OPENAI_FEED_SFTP_USER OPENAI_FEED_SFTP_PASSWORD; do
  grep "^$k=" .env | cut -d= -f2- | gh secret set "$k"; done
```

### Running cost
The repository is public, so GitHub Actions minutes are free and unlimited. An unchanged check takes under a minute,
an upload run about two.

### Checking that it works
- Actions tab: an upload run's log shows the OpenAI result of the *previous* upload (`completed`, rows accepted and
  rejected) and ends with `Upload finished`; an unchanged run just says so.
- Or from the repo root at any time: `python3 marketing/openai-feed/openai_feed.py status`.

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
