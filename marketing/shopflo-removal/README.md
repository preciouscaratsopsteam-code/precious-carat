# Shopflo removal (unpublished GoKwik theme)

Removes every Shopflo hook from a Shopify theme while leaving the rest of the theme
untouched. Built for **"GoKwik Theme <> 01/10/26"** (theme id `194276589938`,
unpublished). The live theme `precious-carat/main` is refused by the script; if
Shopflo should ever come out of the live theme too, run `local` against the repo and
push to `main` instead.

## What changes

| File | Edit |
|---|---|
| `layout/theme.liquid` | drop the (already commented-out) `/cart` → Shopflo drawer intercept, the `bridge.shopflo.com` bundle `<script>`, and `{% render 'shopflo-sso-add-button' %}` |
| `snippets/shopflo-sso-add-button.liquid` | **deleted** (Shopflo header login icon + Account/Logout drawer). The plain `/account` link in the header shows instead |
| `sections/header.liquid` | cart icon goes back to `href="/cart"` (was `onclick="handleFloCartBtn()"`), `flo-cart-icon-bubble` class removed |
| `sections/main-cart.liquid` | CHECKOUT HERE is the native `<form action="/cart" method="post">` + `<button name="checkout">` again, firing `oaiqCheckoutStarted` on submit (replaces `pcCartCheckout()` / `handleFloCheckoutBtn`) |
| `sections/main-product.liquid` | Buy It Now is `type="submit" name="checkout" data-buy-now` inside the product form; the theme's add-to-cart interceptor already routes `isBuyNow` to `/checkout` after adding the gem + fee line. Shopflo `handleFloBuyNowBtn` / `PCFeeReconcile` wrapper removed; post-add redirects go to `/cart` |
| `assets/theme.js` | quick-view add-to-cart redirects to `/cart` after 800 ms (was `handleFloCartBtn()`) |
| `assets/base.css` | `.flo-buy-now-btn` rule removed |
| `config/settings_schema.json` | fee-product help text no longer says "(Shopflo included)" |
| `sections/site-header.liquid` | same cart-link edits, applied only if the file exists (it does not in the GoKwik theme) |

Left alone on purpose: `assets/oaiq-events.js` (its `order_created` listener waits for
Shopflo's thank-you event and is simply dormant without Shopflo) and the comment in
`snippets/bing-uet.liquid`.

Every edit is anchored on an exact string that must match exactly once; the script
refuses to write anything if a file has drifted, and it checks Liquid block balance,
`<script>`/`<form>` balance, CSS braces, JSON validity and `node --check` on JS.

## What was actually done on 6 Oct 2026

The theme was updated through the claude.ai Shopify connector (Admin GraphQL), not
with this script's `apply`, because no Theme Access token existed. Record of the
procedure, for the next sync:

1. Inventory: `theme.files` (filenames filter, 250 per page) gave checksums +
   `updatedAt` for every text file. Files touched after the Oct 1 copy were GoKwik's
   (`snippets/gokwik.liquid`, `layout/theme.liquid` head lines, the Gokwik group in
   `settings_schema.json`, GoKwik values in `settings_data.json`). Everything else
   matched git 2e6facd (Sep 29).
2. 93 files changed on main since then were pushed with `themeFilesUpsert` using
   `body.type = URL` pointing at `raw.githubusercontent.com/<owner>/<repo>/<sha>/<path>`
   (the repo is public). Shopify fetches these asynchronously, about one file every
   3 s, and `upsertedThemeFiles` comes back empty: verify with a checksum query.
   JSON templates / section groups that reference a section file fail silently when
   that section has not landed yet: send them again afterwards.
3. The Shopflo-edited files (this script's `local` output, trailing whitespace
   stripped) went as `body.type = TEXT`, except `sections/main-product.liquid`
   (173 KB, too large for one call): that one came from branch
   `gokwik-theme-sync` (commit c19b9cb) via a raw GitHub URL. That branch is
   main 0e08118 + the Shopflo-free files + the theme's `settings_data.json`.
4. `themeFilesDelete` is blocked by the connector, so
   `snippets/shopflo-sso-add-button.liquid` was overwritten with a comment stub.
   Delete it from Edit code when convenient.
5. `settings_data.json` and `snippets/gokwik.liquid` were left untouched.

## Run

```sh
# 1. Dry run against the Oct 1 git state the GoKwik theme was copied from
git show 072caeb:layout/theme.liquid > /tmp/base/layout/theme.liquid   # … etc, or use the scratch copy
python3 marketing/shopflo-removal/remove_shopflo.py local --src /tmp/base --out /tmp/out

# 2. Pull the real files from the theme, transform, write a diff; changes nothing
python3 marketing/shopflo-removal/remove_shopflo.py plan --theme 194276589938 --out /tmp/plan

# 3. Write them back (themeFilesUpsert + themeFilesDelete on that theme only)
python3 marketing/shopflo-removal/remove_shopflo.py apply --theme 194276589938 --out /tmp/plan --yes
```

Review `/tmp/plan/changes.diff` between steps 2 and 3.

### Auth

`plan`/`apply` need, in the environment or `.env`:

- `SHOPIFY_SHOP=y1cavk-gh.myshopify.com`
- `SHOPIFY_THEME_TOKEN` = a **Theme Access** app password (`shptka_…`, Shopify admin →
  Apps → Theme Access → create password) or an Admin API token from a custom app with
  `read_themes` + `write_themes`. Falls back to `SHOPIFY_TOKEN`; the one in `.env` as of
  2026-10-06 returns 401 and must be replaced.

Alternative without a token: the claude.ai Shopify connector (once re-authorised) can
read the theme files and run the same two mutations; `local` mode produces the file
bodies to send.

## After applying

1. Preview: `https://www.preciouscarats.com/?preview_theme_id=194276589938`. Check:
   header cart icon opens `/cart`; CHECKOUT HERE and Buy It Now are picked up by GoKwik
   (its integration claims `button[name="checkout"]`); account icon goes to `/account`.
2. Test a customised-gem order end to end. GoKwik's Buy It Now reads only the variant
   id + quantity from the product form, so it bypasses the theme's interceptor that adds
   line-item properties (weight, origin, certification) and the fee product line. Add to
   cart → cart → CHECKOUT HERE keeps the properties; confirm with GoKwik what they
   want for Buy It Now.
3. `order_created` for the OpenAI pixel (and the Bing UET purchase goal) relied on
   Shopflo's thank-you page. With GoKwik the order lands on Shopify's own order-status
   page, so that event needs a Shopify customer-events pixel or GoKwik's post-order hook.
4. Uninstall the Shopflo app only after the GoKwik theme is published and the live theme
   no longer loads the bundle; until then the live theme still depends on it.
