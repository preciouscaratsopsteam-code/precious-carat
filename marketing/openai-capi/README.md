# OpenAI Conversions API (ChatGPT ads) — `order_created` from Shopify Flow

Purchases on preciouscarats.com happen inside GoKwik's checkout popup, which the storefront
(and so the OpenAI browser pixel) never sees. Since the GoKwik theme went live on 8 Oct 2026 no
`order_created` has reached OpenAI. This folder fixes that **server-side, with no server of ours**:
Shopify Flow sees every order and posts it straight to OpenAI's Conversions API.

| Event | How it reaches OpenAI | Status |
|---|---|---|
| `page_viewed`, `contents_viewed` | browser pixel, `layout/theme.liquid` | live |
| `items_added` | browser pixel, `assets/oaiq-events.js` | live |
| `checkout_started` | browser pixel, `assets/oaiq-events.js` | **broken under GoKwik until the theme file below is deployed** (GoKwik swallows the button click) |
| `order_created` | **Shopify Flow → Conversions API** (this README) | needs the workflow created once in admin |

The other three events have no server-side trigger in Shopify (nothing fires on a page view or an
add-to-cart outside the browser), and calling the Conversions API from the browser would publish the
API key, so they stay on the pixel. That is the normal split: the Conversions API exists for the
conversion the server knows about, the purchase.

## Files

| File | Purpose |
|---|---|
| `flow-order-created-body.liquid` | The request body for Flow's **Send HTTP request** action. Builds the OpenAI event from the order: id `order_<order id>`, paise amounts, line items (customisation-fee line dropped), SHA-256 email / phone / name, city / region / postcode / country, IP + user agent (GoKwik writes them on the order), the ChatGPT click id. |
| `render_test.py` | Renders that template locally against a GoKwik-shaped sample order, checks the JSON, and with `--validate` sends it to OpenAI with `validate_only: true` (nothing stored). Last run 13 Oct 2026: `{"accepted_events":1}`. |
| `../../assets/oaiq-events.js` | Theme side: copies the click id (`__oppref` cookie / `?oppref=`) and browser ref (`__obref`) onto the cart as `_oaiq_oppref` / `_oaiq_obref` so Flow can forward them, and fires `checkout_started` when a GoKwik button is pressed. |

Keys: the four `sk-svcacct-…` keys in the briefing PDF are the ones already in `.env`
(`OPENAI_CAPI_KEY` = the "Order Created" one). Keys are issued per pixel, not per event, so any one of
them sends every event type. Never commit them; the PDF itself should stay private.

## One-time setup in Shopify admin (about 10 minutes)

Store plan is **Grow**, which includes Flow's Send HTTP request action (Grow / Advanced / Plus only).

1. **Secret.** Shopify admin → Apps → **Flow** → ⚙ Settings → **Secrets** → Add secret.
   Handle `openai_capi_key`, value = `OPENAI_CAPI_KEY` from `.env` (the Order Created key).
2. **Workflow.** Flow → Create workflow.
   - **Trigger:** `Order created`.
   - **Condition** (add both, "all conditions must be met"):
     `order / test` **is false**, and `order / totalPriceSet / shopMoney / amount` **greater than** `0`
     (keeps GoKwik's ₹0 test orders out).
   - **Action:** `Send HTTP request`
     - HTTP method: `Post`
     - URL: `https://bzr.openai.com/v1/events?pid=KsuZ4be3mKakGLLBexox2n`
     - Headers:
       `Authorization` = `Bearer {{secrets.openai_capi_key}}`
       `Content-Type` = `application/json`
     - Body: paste the whole of `flow-order-created-body.liquid`.
     - On client error (4XX): `Fail` (a bad body will not get better by retrying).
     - On server error (5XX or 429): `Retry`.
   - **Second action** (optional but recommended): `Add order tags` → `oai-capi-sent`. Flow only runs it after
     the HTTP step succeeded, so the tag on an order proves the event went out without opening run history
     (and it is visible through the Admin API, which run history is not).
   - Name it `OpenAI CAPI — order_created`, **Turn on workflow**.
3. **Test on a real order.** Admin → Orders → open any order from the **last 7 days** (OpenAI rejects
   older timestamps) → ⋯ More actions → **Run Flow automation** → pick the workflow → Run.
   Then Flow → the workflow → **Run history**: the HTTP step should show `200` and
   `{"accepted_events":1}`. Re-running on the same order is harmless: OpenAI keeps the first event
   with a given id and ignores the rest.
   To rehearse without recording anything, change `"validate_only": false` to `true` in the body
   first, run, then set it back to `false`.
4. **Check in OpenAI.** Ads Manager → Conversions → the pixel's event stream: `order_created` with
   source `server_to_server` (the pixel's own events show `pixel_sdk`). The "Order Created"
   conversion event (`6a994400…`) is already attached to the campaign; nothing to change there.
   Note: the briefing PDF lists the same conversion-event ID for "Item Added" and "Checkout started";
   those IDs are only used to attach an event type to a campaign, never sent in a payload, but worth
   re-checking in Ads Manager.

## Deploying the theme file

The live theme ("GoKwik Theme <> 01/10/26") is not connected to GitHub, so pushes do not deploy.
Either paste `assets/oaiq-events.js` into Online Store → Themes → current theme → Edit code →
`assets/oaiq-events.js`, or connect branch `gokwik-theme-sync` as a theme and publish it
(see the deploy notes in the repo memory). The file is self-contained; nothing else changes.

Smoke test after deploy: open `https://www.preciouscarats.com/?oppref=test123`, add a gem to the
cart, then in the console run `fetch('/cart.js').then(r=>r.json()).then(c=>console.log(c.attributes))`
→ `_oaiq_oppref: "test123"` and `_oaiq_obref: "…"`. Press Checkout: with `debug:true` in the pixel
init you would see `checkout_started` in the console; in Ads Manager it appears in the event stream.

## How attribution works

- OpenAI appends `?oppref=…` to ad landing URLs. The pixel stores it in the `__oppref` cookie
  (30 days) and creates a `__obref` browser reference (365 days).
- The theme copies both onto the cart at add-to-cart and at checkout start. Shopify / GoKwik carry
  cart attributes onto the order as `customAttributes`; the Flow body reads `_oaiq_oppref` →
  event `oppref` and `_oaiq_obref` → `user.obref`.
- Fallback: GoKwik records the page the checkout started from as `full_url`; if that URL still has
  `oppref=` the template takes it from there (GoKwik's Buy Now bypasses the cart, so this is the
  only route for those orders).
- Matching also uses hashed email/phone/name and raw city/region/postcode/country/IP/user agent,
  all normalised exactly as OpenAI's CAPI docs specify.
- If a browser `order_created` ever fires again (Shopflo thank-you page), it uses the same
  `event_id` (`order_<id>`), so OpenAI deduplicates.

## Troubleshooting

| Symptom in Flow run history | Cause / fix |
|---|---|
| `400` | Body did not validate. Run `python3 marketing/openai-capi/render_test.py --validate` locally; usual culprits are an edited template or an order older than 7 days (Run Flow automation on a recent one). |
| `401` | Wrong or revoked key in the secret. |
| `403` `error code: 1010` | OpenAI's edge blocks some user agents. Shopify-style UAs were tested fine on 13 Oct 2026; only `Python-urllib` was blocked. |
| `timestamp_ms` empty in the rendered body | Flow's `date` filter did not parse `order.createdAt`. Replace `order.createdAt | date: "%s"` with `"now" | date: "%s"` in the template (Flow runs within seconds of the order anyway). |
| Event missing in Ads Manager but Flow shows 200 | The event stream shows the last ~15 minutes only; check Insights for attributed conversions later. `validate_only: true` events never appear. |
