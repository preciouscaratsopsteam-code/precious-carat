# Google Merchant Center supplemental feed (treatment · ratti · certification)

**Status 8 Oct 2026:** theme template + stitch/upload script built; not yet deployed or registered.

The Google & YouTube channel keeps syncing products. This supplemental feed only *adds* to those offers:

- **title** → `{product title} / {ratti} Ratti, {treatment}, {lab} Certified`, e.g.
  `Sri Lankan Blue Sapphire 6.52 Carat / 7.25 Ratti, Unheated and Untreated, ITLGR Certified`
- **product_detail** ×5 → Treatment, Weight (ratti), Weight (carat), Certification (lab + report no.), Origin
- **custom_label_0..4** → treatment, lab, gem type, ratti band (`7 ratti`), origin — for campaign splits

Origin uses `snippets/origin-clean.liquid`, so "Origin not specified / Others" never appears.

## Files
- `templates/collection.google-supplemental-feed.liquid` — renders the TSV at
  `/collections/all?view=google-supplemental-feed&page=N` (250 rows per page, header on every page).
- `google_supplemental_feed.py` — `build` stitches the pages into `marketing/google-supplemental-feed.tsv`
  and validates; `upload` pushes it to Merchant Center over SFTP; `all --if-changed` for a scheduled job.

## To go live
1. Deploy the template to the live (GoKwik) theme — it is on `main` and `gokwik-theme-sync`.
2. Merchant Center → Settings → **SFTP**: create a login. Put it in `.env`:
   `GMC_SFTP_USER`, `GMC_SFTP_PASSWORD` (host `partnerupload.google.com`, port `19321`, file `google-supplemental-feed.tsv` are the defaults).
3. Merchant Center → Products → Feeds → **Add supplemental feed** → input method SFTP, file name `google-supplemental-feed.tsv`;
   link it to the channel's primary feed. (Scheduled fetch is not used because the catalogue spans ~20 pages.)
4. Check one offer id in Merchant Center. The channel uses `shopify_IN_{product id}_{variant id}`; if yours differ,
   change `offer_prefix` at the top of the template.
5. `python3 marketing/google-feed/google_supplemental_feed.py all` — then add it to the same launchd schedule as the
   OpenAI feed (every 15 min with `--if-changed`), or run it after catalogue changes.
