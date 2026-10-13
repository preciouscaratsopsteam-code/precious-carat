/**
 * OpenAI pixel — funnel events beyond page views.
 *
 * items_added: every add-to-cart in the theme goes through fetch('/cart/add.js')
 * (product page, quick view, compare, wishlist cards), so one fetch wrapper
 * covers them all and reads the added line items from Shopify's response.
 *
 * checkout_started: callers use window.oaiqCheckoutStarted(); it throttles
 * itself and attaches the current cart contents. Call sites: the /cart form,
 * Buy Now in theme.js / compare.js / main-product.liquid, a Navigation API
 * catch-all for /checkout, and — because GoKwik clones every checkout / Buy Now
 * button and swallows its click — a pointerdown/keydown hook on GoKwik's
 * ".gokwik-marge" buttons (GoKwik opens its checkout in a popup, no navigation).
 *
 * order_created: the purchase happens inside GoKwik's checkout, which the
 * storefront never sees, so it is reported SERVER-SIDE: a Shopify Flow
 * workflow (Order created → Send HTTP request) posts it to OpenAI's
 * Conversions API — see marketing/openai-capi/README.md. That event carries
 * id "order_<order id>", the same event_id the browser path below uses, so
 * OpenAI dedups if both ever fire. What this file still does for it:
 *   - attribution hand-off: the pixel stores OpenAI's click id (?oppref=…)
 *     in the __oppref cookie and a browser reference in __obref; Flow can only
 *     see the order, so at add-to-cart and checkout start we copy both onto the
 *     cart as private attributes (_oaiq_oppref / _oaiq_obref — the leading
 *     underscore hides them from the customer) and they ride along to the
 *     order's customAttributes.
 *   - legacy browser path for Shopflo's in-storefront thank-you page
 *     (/pages/order-status, "shopflo:orderConfirmationLoaded"); inert unless
 *     Shopflo is active again.
 */
(function () {
  'use strict';

  // Must match the pixelId in the oaiq("init", …) call in layout/theme.liquid.
  var PIXEL_ID = 'KsuZ4be3mKakGLLBexox2n';

  function currency() {
    return (window.Shopify && window.Shopify.currency && window.Shopify.currency.active) || 'INR';
  }

  function measure(name, data, options) {
    if (!window.oaiq) return;
    if (options) window.oaiq('measure', name, data, options);
    else window.oaiq('measure', name, data);
  }

  function lineToContent(item) {
    return {
      id: String(item.sku || item.product_id || item.variant_id || ''),
      name: item.product_title || item.title || '',
      content_type: 'product',
      quantity: item.quantity || 1,
      amount: item.final_price != null ? item.final_price : item.price || 0,
      currency: currency()
    };
  }

  function isFeeLine(item) {
    return item.properties && item.properties._fee_line;
  }

  function storageGet(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  function storageSet(key, value) { try { localStorage.setItem(key, value); } catch (e) {} }

  var origFetch = window.fetch;

  // ---------- attribution hand-off (click id + browser ref → cart attributes) ----------

  var OPPREF_TTL_MS = 30 * 24 * 60 * 60 * 1000; // same 30 days as the pixel's __oppref cookie

  function cookie(name) {
    var m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    try { return m ? decodeURIComponent(m[1]) : ''; } catch (e) { return m ? m[1] : ''; }
  }

  // Remember ?oppref= from the landing URL ourselves too, so a blocked pixel
  // (ad blocker) still leaves the server-side event something to attribute.
  function rememberOpprefFromUrl() {
    try {
      var v = new URL(window.location.href).searchParams.get('oppref');
      if (v) storageSet('oaiq_oppref', JSON.stringify({ v: v, t: Date.now() }));
    } catch (e) {}
  }

  function storedOppref() {
    try {
      var rec = JSON.parse(storageGet('oaiq_oppref') || 'null');
      return rec && rec.v && Date.now() - rec.t < OPPREF_TTL_MS ? rec.v : '';
    } catch (e) { return ''; }
  }

  function attributionAttributes() {
    var attrs = {};
    var oppref = cookie('__oppref') || storedOppref();
    var obref = cookie('__obref');
    if (oppref) attrs._oaiq_oppref = oppref;
    if (obref) attrs._oaiq_obref = obref;
    return attrs;
  }

  var attrSyncInFlight = false;
  // `cartAttributes` = the cart's current attributes when the caller already has them;
  // otherwise a localStorage marker avoids re-posting the same values.
  function syncAttributionToCart(cartAttributes) {
    var attrs = attributionAttributes();
    var keys = Object.keys(attrs);
    if (!keys.length || attrSyncInFlight) return;
    var sig = keys.map(function (k) { return k + '=' + attrs[k]; }).join('&');
    if (cartAttributes) {
      var same = keys.every(function (k) { return cartAttributes[k] === attrs[k]; });
      if (same) { storageSet('oaiq_attr_synced', sig); return; }
    } else if (storageGet('oaiq_attr_synced') === sig) {
      return;
    }
    attrSyncInFlight = true;
    origFetch('/cart/update.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ attributes: attrs })
    })
      .then(function (r) { if (r.ok) storageSet('oaiq_attr_synced', sig); })
      .catch(function () {})
      .then(function () { attrSyncInFlight = false; });
  }

  rememberOpprefFromUrl();

  // ---------- items_added ----------

  function fireItemsAdded(payload) {
    var items = (payload.items || [payload]).filter(function (it) { return it && !isFeeLine(it); });
    if (!items.length) return;
    var contents = items.map(lineToContent);
    var total = contents.reduce(function (sum, c) { return sum + c.amount * c.quantity; }, 0);
    measure('items_added', { type: 'contents', amount: total, currency: currency(), contents: contents });
    syncAttributionToCart();
  }

  window.fetch = function (input) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    var promise = origFetch.apply(this, arguments);
    if (url.indexOf('/cart/add') !== -1) {
      promise
        .then(function (res) {
          if (res.ok) res.clone().json().then(fireItemsAdded).catch(function () {});
        })
        .catch(function () {});
    }
    return promise;
  };

  // ---------- checkout_started ----------

  var lastCheckoutFire = 0;
  window.oaiqCheckoutStarted = function () {
    var now = Date.now();
    if (now - lastCheckoutFire < 60000) return;
    lastCheckoutFire = now;
    origFetch('/cart.js')
      .then(function (r) { return r.json(); })
      .then(function (cart) {
        var contents = (cart.items || []).filter(function (it) { return !isFeeLine(it); }).map(lineToContent);
        measure('checkout_started', {
          type: 'contents',
          amount: cart.total_price || 0,
          currency: cart.currency || currency(),
          contents: contents
        });
        syncAttributionToCart(cart.attributes || {});
      })
      .catch(function () {
        measure('checkout_started', { type: 'contents' });
        syncAttributionToCart();
      });
  };

  // Catch-all for checkout navigations the explicit call sites miss
  if ('navigation' in window) {
    navigation.addEventListener('navigate', function (event) {
      try {
        var u = new URL(event.destination.url);
        if (u.pathname === '/checkout' || u.pathname.indexOf('/checkouts') === 0) {
          window.oaiqCheckoutStarted();
        }
      } catch (e) {}
    });
  }

  // GoKwik: its snippet replaces checkout / Buy Now buttons with clones carrying
  // class "gokwik-marge" + data-gokwik-function, handles the click in the capture
  // phase and stops propagation, then opens its checkout popup without navigating.
  // pointerdown/keydown are not intercepted, so they are our signal.
  function gokwikButtonFrom(target) {
    if (!target || typeof target.closest !== 'function') return null;
    var btn = target.closest('.gokwik-marge, [data-gokwik-function]');
    return btn && !btn.classList.contains('gokwik-sold-out') && !btn.disabled ? btn : null;
  }
  document.addEventListener('pointerdown', function (e) {
    if (gokwikButtonFrom(e.target)) window.oaiqCheckoutStarted();
  }, true);
  document.addEventListener('keydown', function (e) {
    if ((e.key === 'Enter' || e.key === ' ') && gokwikButtonFrom(e.target)) window.oaiqCheckoutStarted();
  }, true);

  // ---------- order_created (legacy browser path, Shopflo thank-you page only) ----------

  var ORDER_STATUS_PATH = /\/pages\/order-status/;
  var firedOrders = {};

  // Shopflo stores this at checkout start and its own thank-you analytics require it,
  // so an order-status link opened elsewhere (another device, a support agent) won't count.
  function orderPlacedInThisBrowser() { return !!storageGet('flo-checkout-token-id'); }

  // Shopify order prices are decimal strings ("12500.00"); the pixel wants minor units.
  function paise(decimal) { return Math.round(parseFloat(decimal || 0) * 100) || 0; }

  function sha256Hex(text) {
    if (!(window.crypto && window.crypto.subtle && window.TextEncoder)) return Promise.reject(new Error('no crypto'));
    return window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)).then(function (buf) {
      return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
    });
  }

  // Hashed email/phone improve matching; raw values never leave the page.
  // Phone: digits only, leading zeroes stripped (E.164 without the plus).
  function identifyBuyer(order, sfDetails) {
    var addr = (sfDetails && sfDetails.shipping_address && sfDetails.shipping_address.data) || {};
    var email = String(order.email || order.contact_email || (order.customer && order.customer.email) || addr.email || '').trim().toLowerCase();
    var phone = String(order.phone || (order.shipping_address && order.shipping_address.phone) || (order.billing_address && order.billing_address.phone) || addr.phone || '')
      .replace(/[^0-9]/g, '').replace(/^0+/, '');
    var jobs = [];
    if (email) jobs.push(sha256Hex(email).then(function (h) { return ['email_sha256', h]; }));
    if (phone.length >= 8 && phone.length <= 15) jobs.push(sha256Hex(phone).then(function (h) { return ['phone_number_sha256', h]; }));
    if (!jobs.length) return Promise.resolve();
    return Promise.all(jobs).then(function (pairs) {
      var user = {};
      pairs.forEach(function (p) { user[p[0]] = p[1]; });
      if (window.oaiq) window.oaiq('init', { pixelId: PIXEL_ID, user: user });
    });
  }

  function fireOrderCreated(order, sfDetails) {
    if (!order || !order.id) return;
    var key = 'oaiq_order_' + order.id;
    if (firedOrders[key] || storageGet(key)) return;
    firedOrders[key] = true;

    var cur = order.currency || currency();
    var contents = (order.line_items || []).map(function (li) {
      return {
        id: String(li.sku || li.product_id || li.variant_id || li.id || ''),
        name: li.title || li.name || '',
        content_type: 'product',
        quantity: li.quantity || 1,
        amount: paise(li.price),
        currency: cur
      };
    });
    var data = { type: 'contents', amount: paise(order.total_price), currency: cur, contents: contents };
    // Same id the Flow → Conversions API event uses, so OpenAI keeps only one.
    var options = { event_id: 'order_' + order.id };

    function send() {
      measure('order_created', data, options);
      storageSet(key, String(Date.now()));
    }
    identifyBuyer(order, sfDetails).then(send, send);
  }

  document.addEventListener('shopflo:orderConfirmationLoaded', function (event) {
    var detail = event.detail || {};
    fireOrderCreated(detail.order, detail.sfDetails);
  });

  // Fallback: if Shopflo populated window.Shopflo before this listener attached.
  if (ORDER_STATUS_PATH.test(window.location.pathname)) {
    var pollStarted = Date.now();
    (function poll() {
      var s = window.Shopflo;
      if (s && s.order && s.order.id) {
        if (orderPlacedInThisBrowser()) fireOrderCreated(s.order, s.sfDetails);
        return;
      }
      if (Date.now() - pollStarted < 60000) setTimeout(poll, 500);
    })();
  }
})();
