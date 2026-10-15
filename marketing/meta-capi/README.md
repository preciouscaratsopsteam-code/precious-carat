# Meta Conversions API — Purchase for GoKwik orders, from Shopify Flow

## Why Purchases reach Meta without a value (15 Oct 2026 check)

GoKwik orders are created through the Admin API by the GoKwik app (order `sourceName` =
`430003159041`, no channel, no customer journey). They never pass through Shopify checkout, so
Shopify's `checkout_completed` customer event never fires for them — and that event is the only
trigger for the two Shopify-side Purchase senders:

| Sender | What it is | Purchase for GoKwik orders? |
|---|---|---|
| Meta's own Shopify pixel (id 731517773390305, sales-channel app) | web pixel on `checkout_completed`, value = checkout total | never fires |
| GoKwik **KwikPass** web pixel (`enabledEvents: Purchase,InitiateCheckout,AddPaymentInfo`) | renames Shopify events to Meta names, posts to `gkx.gokwik.co/ka/api/v1/e/op5` (KwikAds), value = checkout total | never fires |
| Custom pixel 196706674 | Bing UET only | n/a |
| Theme code | only a Meta `Contact` event on WhatsApp clicks; GoKwik snippet's `fbpixel` setting is blank | n/a |
| **GoKwik backend → Meta CAPI (KwikAds, `platform=META, isActive=true`)** | server event sent by GoKwik when it confirms the order | **yes — the only source, and the one arriving without `value`** |

So "Shopify fires before it has GoKwik's value" cannot happen; the valueless events are GoKwik's
server events (or the two ₹0 test orders of 12 Oct, #1065 / #1066).

## The fix

Two options; **A is the clean one, B is the one we control.** Do not run both senders with values,
or every GoKwik order counts twice.

**A. GoKwik sends the value.** Raise a ticket with GoKwik (KwikAds → Meta CAPI): Purchase events
for merchant 197l176uoi97 arrive without `value` / `currency`; attach two event IDs from Events
Manager. Nothing to build; attribution keeps GoKwik's fbp/fbc if they send them.

**B. We send the Purchase ourselves** (this folder): Shopify Flow posts every GoKwik order to
Meta's Conversions API with value, currency, order id, catalog line items, hashed email / phone /
name / address, the buyer's IP + user agent (GoKwik writes them on the order) and `fbc` rebuilt
from the `fbclid` in the landing URL. `event_id` = the Shopify order id, so if GoKwik's event
uses the same id Meta dedups them; if it does not, **switch off Purchase in GoKwik's Meta
integration** (GoKwik dashboard → KwikAds / Analytics → Meta) before turning this on.

## Files

| File | Purpose |
|---|---|
| `flow-order-created-body.liquid` | Body for Flow's **Send HTTP request** action (paste whole file). |
| `render_test.py` | Renders the body locally against a GoKwik-shaped order, checks it; `--validate --test-code …` sends it to Meta as a **test event** (visible only under Events Manager → Test events, never counted). |

## One-time setup (about 10 minutes)

1. **Access token.** Meta Events Manager → the pixel (731517773390305) → Settings → Conversions API
   → *Generate access token*. Put it in `.env` as `META_CAPI_TOKEN` (for the local test) and in
   Shopify admin → Apps → **Flow** → ⚙ Settings → **Secrets** → Add secret, handle
   `meta_capi_token`.
2. **Local test (optional).** Events Manager → Test events → copy the `TEST…` code, then
   `python3 marketing/meta-capi/render_test.py --validate --test-code TEST12345` → the event
   appears in the Test events pane with value ₹8,200 and every match key.
3. **Workflow.** Flow → Create workflow.
   - **Trigger:** `Order created`.
   - **Conditions** (all must be met): `order / test` is false; `order / totalPriceSet / shopMoney / amount`
     greater than `0`; `order / sourceName` equals `430003159041` (GoKwik only — Shopify-checkout
     orders already get their Purchase from Meta's pixel, browser and server).
   - **Action:** `Send HTTP request` — method `Post`,
     URL `https://graph.facebook.com/v21.0/731517773390305/events`,
     header `Content-Type: application/json`, body = this folder's `.liquid` file
     (it reads `{{ secrets.meta_capi_token }}`). 4XX → Fail, 5XX/429 → Retry.
   - **Second action:** `Add order tags` → `meta-capi-sent` (runs only after a 200, so the tag
     proves delivery without opening run history).
   - Name `Meta CAPI — Purchase (GoKwik orders)`, turn on.
4. **Verify.** Orders → a GoKwik order from the last 7 days → ⋯ → Run Flow automation → this
   workflow. Run history shows `200 {"events_received":1,…}`; Events Manager → the pixel →
   Purchase → event details shows value, currency, `order_id`, connection method *Server*,
   partner `preciouscarats-shopify-flow`.
5. **Then** confirm GoKwik's own Purchase is either deduplicated (same event id) or switched off.

## Notes

- COD orders are sent at creation like any other; cancellations are not retracted (Meta has no
  refund event for CAPI dedup at this level). Same behaviour as the OpenAI workflow.
- Catalog ids use Shopify's Meta catalog form `shopify_IN_<product id>_<variant id>`; a line
  whose product was deleted falls back to SKU or title.
- `fbp` is only sent if an `_fbp` order attribute exists (the theme does not copy that cookie
  yet; `assets/oaiq-events.js` is where the equivalent OpenAI refs are copied).
