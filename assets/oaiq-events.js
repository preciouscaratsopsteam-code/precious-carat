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
 */
(function () {
  'use strict';

  function currency() {
    return (window.Shopify && window.Shopify.currency && window.Shopify.currency.active) || 'INR';
  }

  function measure(name, data) {
    if (window.oaiq) window.oaiq('measure', name, data);
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
})();
