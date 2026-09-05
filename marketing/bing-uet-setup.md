# Microsoft Advertising (Bing) UET — setup & enhanced conversions

Added 2026-09-05. Theme code: `snippets/bing-uet.liquid`, rendered from `layout/theme.liquid`
right after the Clarity tag; enabled by **Theme settings → Tracking → UET tag ID**.

## Enable (storefront pages)

1. Microsoft Advertising → Tools → **UET tag** → copy the numeric tag ID.
2. Shopify admin → Online Store → Themes → Customize → **Theme settings → Tracking** → paste it → Save.
3. Check with the **UET Tag Helper** browser extension: the page-load event should show
   `pid` populated once you are logged in (Shopflo login signs you into your Shopify account)
   or after submitting the newsletter/contact form.

If UET was already installed as a Shopify custom pixel (Settings → Customer events), leave the
theme setting blank; two base tags double-count page views.

## What the theme sends

`uetq.push('set', { pid: { em, ph } })` before every event on the page, **only when both email and
phone are known**. If either is missing nothing is sent; the known half is kept in the tab until the
other arrives. UET hashes both values (SHA-256) in the browser; nothing is sent in plain text.

| Source | When |
|---|---|
| `customer.email` / `customer.phone` (Liquid) | Every page while logged in |
| Newsletter, contact, login, register forms | On submit; kept in `sessionStorage` (`uet_pid_v1`) for the rest of the tab |
| `window.uetSetPid({ email, phone })` | For KwikPass / Shopflo login callbacks to call directly |

Phones are normalised to E.164; a bare 10-digit number is assumed Indian (`+91`).

## Purchase goal — not covered by the theme

Checkout completes inside Shopflo, off-theme, so the theme tag never sees the order. The
enhanced-conversions `pid` has to be set in whatever context fires the purchase event:

- **Shopflo** — check Shopflo dashboard → Integrations for a Microsoft Ads / Bing pixel option and
  enter the same tag ID there, or
- **Shopify custom pixel** (Settings → Customer events → Add custom pixel), which fires on the
  order-status page. Unverified whether Shopflo orders reach that page; test one order first.

```js
// Shopify custom pixel — replace TAG_ID
(function(w,d,t,r,u){var f,n,i;w[u]=w[u]||[],f=function(){var o={ti:"TAG_ID",enableAutoSpaTracking:true};o.q=w[u],w[u]=new UET(o),w[u].push("pageLoad")},n=d.createElement(t),n.src=r,n.async=1,n.onload=n.onreadystatechange=function(){var s=this.readyState;s&&s!=="loaded"&&s!=="complete"||(f(),n.onload=n.onreadystatechange=null)},i=d.getElementsByTagName(t)[0],i.parentNode.insertBefore(n,i)})(window,document,"script","//bat.bing.com/bat.js","uetq");

analytics.subscribe('checkout_completed', (event) => {
  const c = event.data.checkout;
  const phone = c.phone || (c.billingAddress && c.billingAddress.phone) || (c.shippingAddress && c.shippingAddress.phone) || '';
  const email = (c.email || '').trim().toLowerCase();
  window.uetq = window.uetq || [];
  if (email && phone) window.uetq.push('set', { pid: { em: email, ph: phone } }); // both or nothing
  window.uetq.push('event', 'purchase', {
    event_category: 'ecommerce',
    revenue_value: Number(c.totalPrice && c.totalPrice.amount) || 0,
    currency: c.currencyCode || 'INR',
    transaction_id: c.order && c.order.id
  });
});
```

The Microsoft Ads conversion goal must then be an **Event** goal matching `purchase`
(category `ecommerce`) with "Enhanced conversions" turned on, as it already is.
