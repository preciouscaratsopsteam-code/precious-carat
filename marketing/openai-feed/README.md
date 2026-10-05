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

OpenAI never pulls, so a listener and a runner are needed. Neither is a server we operate:

| Piece | Role |
|---|---|
| **Shopify Flow** (built into Shopify, Basic plan and up) | Listens for *Product added to store* and *Inventory quantity changed* and sends one HTTP request to GitHub per event. |
| **GitHub Actions** `.github/workflows/openai-feed.yml` | Runs `build` + `upload` on that request, plus a safety-net run at 06:00 and 18:00 IST, plus a manual "Run workflow" button. One run at a time; bursts (a 200-gem import) collapse into at most one running + one queued run. A run is never cancelled mid-upload. |

Latency: Flow fires within seconds, the run takes about two minutes, OpenAI ingests about seven minutes after the
file lands. A sold gem stops being ads-eligible roughly ten minutes after the sale.

### One-time setup

**1. GitHub secrets** (repo → Settings → Secrets and variables → Actions → New repository secret). Six secrets, values
copied from the same-named lines of `.env`:
`OPENAI_ADS_API_KEY`, `OPENAI_ADS_FEED_ID`, `OPENAI_FEED_SFTP_HOST`, `OPENAI_FEED_SFTP_PORT`, `OPENAI_FEED_SFTP_USER`, `OPENAI_FEED_SFTP_PASSWORD`.
With the GitHub CLI logged in (`gh auth login`), this does all six from the repo root:
```
for k in OPENAI_ADS_API_KEY OPENAI_ADS_FEED_ID OPENAI_FEED_SFTP_HOST OPENAI_FEED_SFTP_PORT OPENAI_FEED_SFTP_USER OPENAI_FEED_SFTP_PASSWORD; do
  grep "^$k=" .env | cut -d= -f2- | gh secret set "$k"; done
```
Then open the repo's **Actions** tab → *OpenAI product feed sync* → **Run workflow** once and check the log ends with
"Upload finished".

**2. A GitHub token for Flow to call.** GitHub → your avatar → Settings → Developer settings → Personal access tokens →
Fine-grained tokens → Generate new token. Resource owner `preciouscaratsopsteam-code`; *Only select repositories* →
`precious-carat`; Repository permissions → **Contents: Read and write** (this is what `repository_dispatch` needs);
expiry one year (set a reminder). Copy the token; it is shown once.

**3. Two Shopify Flow workflows** (Shopify admin → Apps → Flow → Create workflow).

*Workflow A — "OpenAI feed: product added"*
- Trigger: **Product added to store**
- Action: **Send HTTP request**
  - HTTP method: `POST`
  - URL: `https://api.github.com/repos/preciouscaratsopsteam-code/precious-carat/dispatches`
  - Headers:
    - `Authorization` → `Bearer <the token from step 2>`
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
  (The `handle` field is only a label in the run log; the run always rebuilds the whole catalogue. If you want it here
  too, add Flow's variable for the affected product's handle; if Flow rejects the variable, leave it out.)

GitHub answers `204 No Content` on success. Turn both workflows on, then add a test product or set one gem's stock to 0
and watch a run start in the Actions tab within a minute.

### Running cost
A run is about two minutes of GitHub Actions time. The free allowance for a private repository is 2,000 minutes a
month, so roughly 30 event-driven runs a day fit. If gems are added in daily bulk imports that is fine; if the Actions
tab shows runs queuing all day, say so and the Flow triggers can be narrowed (for example, inventory changes only when
the quantity reaches 0).

### Checking that it works
- Actions tab: every run's log begins with the OpenAI result of the *previous* upload (`completed`, rows accepted and
  rejected) and ends with `Upload finished`.
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
