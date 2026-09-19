/**
 * OpenAI pixel — funnel events beyond page views.
 *
 * items_added: every add-to-cart in the theme goes through fetch('/cart/add.js')
 * (product page, quick view, compare, wishlist cards), so one fetch wrapper
 * covers them all and reads the added line items from Shopify's response.
 *
 * checkout_started: the store has no /cart page — the Shopflo drawer IS the
 * checkout flow — so drawer-open and /checkout navigations both count.
 * Callers use window.oaiqCheckoutStarted(); it throttles itself and attaches
 * the current cart contents.
 *
 * order_created: payment happens inside Shopflo, but Shopflo renders its
 * thank-you page at /pages/order-status INSIDE the storefront, so this file runs
 * there. Once Shopflo's post-order call returns, its bundle sets
 * window.Shopflo.order (the Shopify order) and dispatches the document event
 * "shopflo:orderConfirmationLoaded" with {order, sfDetails} — only in the
 * browser that placed the order (it checks the flo-checkout-token-id it stored
 * at checkout). We fire once per order id, pass event_id "order_<id>" so OpenAI
 * dedups on its side too, and re-init the pixel with hashed email/phone first
 * so the conversion matches better (the docs allow a second init for that).
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

  // ---------- items_added ----------

  function fireItemsAdded(payload) {
    var items = (payload.items || [payload]).filter(function (it) { return it && !isFeeLine(it); });
    if (!items.length) return;
    var contents = items.map(lineToContent);
    var total = contents.reduce(function (sum, c) { return sum + c.amount * c.quantity; }, 0);
    measure('items_added', { type: 'contents', amount: total, currency: currency(), contents: contents });
  }

  var origFetch = window.fetch;
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
      })
      .catch(function () {
        measure('checkout_started', { type: 'contents' });
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

  // ---------- order_created ----------

  var ORDER_STATUS_PATH = /\/pages\/order-status/;
  var firedOrders = {};

  function storageGet(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  function storageSet(key, value) { try { localStorage.setItem(key, value); } catch (e) {} }

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
