/*
 * pc-currency.js — display-only US$ pricing for visitors outside India.
 *
 * Why this exists: the store sells in INR only (a single "India" market and no
 * Shopify Payments, so Shopify Markets cannot present a second currency). Every
 * price the theme renders is marked up as
 *     <span class="pc-money" data-paise="N">…INR…</span>
 * (snippets/price-inr.liquid emits that; JS-rendered prices call PCMoney.html()).
 *
 * This script
 *   1. decides the display currency: the visitor's explicit INR/USD choice wins,
 *      otherwise the country of their IP address (Cloudflare's /cdn-cgi/trace,
 *      then Shopify's /browsing_context_suggestions.json, then the browser
 *      timezone) — anyone outside India gets USD;
 *   2. gets a live INR→USD rate (Frankfurter/ECB, then ExchangeRate-API), cached
 *      in localStorage for 12 h, falling back to the fixed rate in Theme settings
 *      → Currency;
 *   3. rewrites every .pc-money element (and the ₹ price-filter chips), watching
 *      the DOM so quick view, wishlist, cart and customiser updates are covered;
 *   4. drives the [data-pc-currency-toggle] buttons in the header and drawer.
 *
 * Checkout, order history, analytics and structured data stay in INR — the
 * .pc-money__note elements (shown only in USD mode via CSS) say so.
 * Config comes from window.PCCurrency, set in layout/theme.liquid.
 */
(function () {
  'use strict';

  var cfg = window.PCCurrency || {};
  var ENABLED = cfg.enabled !== false;
  var HOME = String(cfg.homeCountry || 'IN').toUpperCase();

  var KEY_MODE = 'pc_currency';   // localStorage: explicit choice, 'INR' | 'USD'
  var KEY_GEO = 'pc_geo';         // localStorage: {c: 'US', ts} — detected country, trusted for 24 h, re-checked each page
  var KEY_RATE = 'pc_fx_inr_usd'; // localStorage: {rate, ts} — USD per INR, 12 h
  var GEO_TTL_MS = 24 * 60 * 60 * 1000;
  var RATE_TTL_MS = 12 * 60 * 60 * 1000;

  var MONEY_SEL = '.pc-money[data-paise]';
  var CHIP_SEL = '.plp-chip[data-min], .facets__price-preset[data-min], .toolbar-price-preset[data-min]';
  var TOGGLE_SEL = '[data-pc-currency-toggle]';

  var html = document.documentElement;
  var state = { mode: 'INR', want: 'INR', rate: null, rateSource: 'none', noRate: false };

  // ---- storage helpers (private mode / blocked storage must never throw) ---
  function lsGet(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  function lsSet(key, val) { try { localStorage.setItem(key, val); } catch (e) {} }
  function lsJson(key) { try { return JSON.parse(lsGet(key) || 'null'); } catch (e) { return null; } }

  // ---- formatting ----------------------------------------------------------
  // Same output as snippets/price-inr.liquid: ₹ + Indian digit grouping, no paise.
  function inrGroup(rupees) {
    var s = String(Math.round(Math.abs(rupees)));
    if (s.length <= 3) return s;
    var head = s.slice(0, -3);
    return head.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + s.slice(-3);
  }
  function inrText(paise) { return '₹' + inrGroup((parseInt(paise, 10) || 0) / 100); }
  function inrInner(paise) { return '<span class="price-inr__sym">₹</span>' + inrGroup((parseInt(paise, 10) || 0) / 100); }
  function inrHtml(paise) { return '<span class="price-inr">' + inrInner(paise) + '</span>'; }

  function usdValue(paise) {
    if (!state.rate) return null;
    var buffer = 1 + (parseFloat(cfg.bufferPct) || 0) / 100;
    return ((parseInt(paise, 10) || 0) / 100) * state.rate * buffer;
  }
  function usdNumber(v) {
    return v < 1
      ? v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : v.toLocaleString('en-US', { maximumFractionDigits: 0 });
  }
  function usdText(paise) { var v = usdValue(paise); return v == null ? '' : 'US$' + usdNumber(v); }
  function usdInner(paise) { var v = usdValue(paise); return v == null ? inrInner(paise) : '<span class="price-inr__sym">US$</span>' + usdNumber(v); }

  function usdActive() { return state.mode === 'USD' && !!state.rate; }

  // Markup for a JS-rendered price in the current display currency. The span
  // carries data-paise so a later currency switch can re-render it.
  function moneyHtml(paise) {
    paise = parseInt(paise, 10) || 0;
    if (usdActive()) {
      return '<span class="price-inr pc-money is-converted" data-paise="' + paise + '" title="' + inrText(paise) + '">' + usdInner(paise) + '</span>';
    }
    return '<span class="price-inr pc-money" data-paise="' + paise + '">' + inrInner(paise) + '</span>';
  }
  function moneyText(paise) { return usdActive() ? usdText(paise) : inrText(paise); }

  // ---- DOM conversion ------------------------------------------------------
  function convertEl(el) {
    var paise = parseInt(el.getAttribute('data-paise'), 10);
    if (isNaN(paise)) return;
    if (usdActive()) {
      if (el.classList.contains('is-converted') && el.__pcRate === state.rate) return; // no-op keeps the observer quiet
      if (el.__pcInr === undefined && !el.classList.contains('is-converted')) el.__pcInr = el.innerHTML;
      el.innerHTML = usdInner(paise);
      el.setAttribute('title', inrText(paise));
      el.classList.add('is-converted');
      el.__pcRate = state.rate;
    } else if (el.classList.contains('is-converted')) {
      el.innerHTML = el.__pcInr !== undefined ? el.__pcInr : inrInner(paise);
      el.removeAttribute('title');
      el.classList.remove('is-converted');
      el.__pcRate = null;
    }
  }

  // Price-filter chips are hard-wired to rupee bands (data-min/max in rupees);
  // in USD mode their labels show the approximate dollar band instead.
  function roundUsd(v) {
    var step = v < 100 ? 5 : v < 1000 ? 10 : v < 10000 ? 50 : 100;
    return Math.round(v / step) * step;
  }
  function chipLabel(minRupees, maxRupees) {
    var lo = minRupees > 0 ? '$' + roundUsd(usdValue(minRupees * 100)).toLocaleString('en-US') : null;
    var hi = maxRupees > 0 ? '$' + roundUsd(usdValue(maxRupees * 100)).toLocaleString('en-US') : null;
    if (lo && hi) return lo + ' – ' + hi;
    if (hi) return 'Under ' + hi;
    if (lo) return 'Above ' + lo;
    return null;
  }
  function firstTextNode(el) {
    for (var i = 0; i < el.childNodes.length; i++) {
      var n = el.childNodes[i];
      if (n.nodeType === 3 && /\S/.test(n.nodeValue)) return n;
    }
    return null;
  }
  function relabelChip(chip) {
    var tn = firstTextNode(chip);
    if (!tn) return;
    if (usdActive()) {
      if (chip.__pcMode === 'USD' && chip.__pcRate === state.rate) return;
      if (chip.__pcInr === undefined) chip.__pcInr = tn.nodeValue;
      var label = chipLabel(parseFloat(chip.getAttribute('data-min')) || 0, parseFloat(chip.getAttribute('data-max')) || 0);
      if (label) tn.nodeValue = label;
      chip.__pcMode = 'USD';
      chip.__pcRate = state.rate;
    } else if (chip.__pcMode === 'USD') {
      tn.nodeValue = chip.__pcInr;
      chip.__pcMode = 'INR';
    }
  }

  function convertAll(root) {
    root = root || document;
    var moneyEls = root.querySelectorAll ? root.querySelectorAll(MONEY_SEL) : [];
    for (var i = 0; i < moneyEls.length; i++) convertEl(moneyEls[i]);
    var chips = root.querySelectorAll ? root.querySelectorAll(CHIP_SEL) : [];
    for (var j = 0; j < chips.length; j++) relabelChip(chips[j]);
  }

  function observe() {
    if (!('MutationObserver' in window) || !document.body) return;
    var scheduled = false;
    new MutationObserver(function () {
      if (!usdActive() || scheduled) return;
      scheduled = true;
      requestAnimationFrame(function () { scheduled = false; convertAll(); });
    }).observe(document.body, { childList: true, subtree: true });
  }

  // ---- toggles ---------------------------------------------------------------
  function updateToggles() {
    var toggles = document.querySelectorAll(TOGGLE_SEL);
    for (var i = 0; i < toggles.length; i++) {
      var btn = toggles[i];
      if (!ENABLED || state.noRate) { btn.hidden = true; continue; }
      btn.hidden = false;
      var label = btn.querySelector('[data-pc-currency-label]') || btn;
      label.textContent = state.mode;
      btn.setAttribute('data-mode', state.mode);
      btn.setAttribute('aria-label', state.mode === 'USD'
        ? 'Prices shown in US dollars. Switch to Indian rupees'
        : 'Prices shown in Indian rupees. Switch to US dollars');
    }
  }
  function bindToggles() {
    document.addEventListener('click', function (e) {
      var btn = e.target && e.target.closest ? e.target.closest(TOGGLE_SEL) : null;
      if (!btn) return;
      e.preventDefault();
      setMode(state.mode === 'USD' ? 'INR' : 'USD', true);
    });
  }

  // ---- mode ------------------------------------------------------------------
  function applyMode(mode) {
    state.mode = mode;
    html.setAttribute('data-pc-currency', mode);
    convertAll();
    updateToggles();
    try {
      document.dispatchEvent(new CustomEvent('pc:currency', { detail: { mode: mode, rate: state.rate, source: state.rateSource } }));
    } catch (e) {}
  }

  function setMode(mode, persist) {
    if (persist) lsSet(KEY_MODE, mode);
    state.want = mode;
    if (mode !== 'USD') return applyMode('INR');
    if (state.rate) return applyMode('USD');
    // Hold unconverted INR prices (CSS on html[data-pc-currency="USD"]) while the rate loads.
    html.setAttribute('data-pc-currency', 'USD');
    getRate(function (rate, source) {
      state.rateSource = source;
      if (!(rate > 0)) { state.rate = null; state.noRate = true; return applyMode('INR'); }
      state.rate = rate;
      if (state.want === 'USD') applyMode('USD'); // not if INR was asked for while the rate loaded
    });
  }

  // ---- geolocation ------------------------------------------------------------
  // Where is the visitor? Two independent lookups of their IP address, both on
  // the store's own domain, tried in order:
  //   1. Cloudflare's edge trace (/cdn-cgi/trace answers "loc=US"): the country
  //      of the IP itself, whatever markets the store sells to;
  //   2. Shopify's /browsing_context_suggestions.json (detected_values.country).
  // If neither answers within 2.5 s the browser timezone decides, and a late
  // answer still corrects that guess.
  function timezoneGuess() {
    try {
      var tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
      if (!tz) return HOME;
      return /^Asia\/(Kolkata|Calcutta)$/.test(tz) ? HOME : 'XX';
    } catch (e) { return HOME; }
  }
  function countryFromTrace() {
    return fetch('/cdn-cgi/trace', { credentials: 'omit', cache: 'no-store' })
      .then(function (r) { return r.ok ? r.text() : ''; })
      .then(function (t) {
        var m = /^loc=([A-Za-z0-9]{2})\s*$/m.exec(t || '');
        var c = m ? m[1].toUpperCase() : '';
        return /^[A-Z]{2}$/.test(c) && c !== 'XX' ? c : null; // XX = unknown, T1 = Tor
      });
  }
  function countryFromShopify() {
    return fetch('/browsing_context_suggestions.json?country%5Benabled%5D=true', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        var c = j && j.detected_values && j.detected_values.country && j.detected_values.country.handle;
        return c ? String(c).toUpperCase() : null;
      });
  }
  // Resolves with a country code, or null when neither lookup gave one.
  function lookupCountry() {
    return countryFromTrace()
      .catch(function () { return null; })
      .then(function (c) { return c || countryFromShopify().catch(function () { return null; }); });
  }
  // cb(code) runs once with the best answer available, and again only if a
  // later lookup finds a different country.
  function detectCountry(cb) {
    var reported = null;
    function report(code, save) {
      code = String(code || '').toUpperCase() || HOME;
      if (save) lsSet(KEY_GEO, JSON.stringify({ c: code, ts: Date.now() }));
      if (code === reported) return;
      reported = code;
      cb(code);
    }
    if (typeof fetch !== 'function' || typeof Promise !== 'function') return report(timezoneGuess(), true);

    // The country seen in the last 24 h is used at once (theme.liquid reads the
    // same entry before first paint) and re-checked on every page, so a visitor
    // whose location changed (travel, VPN on or off) is not held to the old one.
    var cached = lsJson(KEY_GEO);
    var timer = null;
    if (cached && cached.c && (Date.now() - cached.ts) < GEO_TTL_MS) report(cached.c, false);
    else timer = setTimeout(function () { report(timezoneGuess(), true); }, 2500);

    lookupCountry().then(function (code) {
      clearTimeout(timer);
      if (code) report(code, true);
      else if (reported === null) report(timezoneGuess(), true);
    });
  }

  // ---- exchange rate (USD per INR) --------------------------------------------
  function fallbackRate() {
    var inrPerUsd = parseFloat(cfg.fallbackInrPerUsd);
    return inrPerUsd > 0 ? 1 / inrPerUsd : null;
  }
  function fetchJson(url) {
    return fetch(url, { mode: 'cors' }).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
  }
  function fetchLiveRate() {
    var sources = [
      function () { return fetchJson('https://api.frankfurter.dev/v2/rates?base=INR&quotes=USD').then(function (j) { return j && j[0] && j[0].rate; }); },
      function () { return fetchJson('https://api.frankfurter.dev/v1/latest?base=INR&symbols=USD').then(function (j) { return j && j.rates && j.rates.USD; }); },
      function () { return fetchJson('https://open.er-api.com/v6/latest/INR').then(function (j) { return j && j.rates && j.rates.USD; }); }
    ];
    var i = 0;
    function next() {
      if (i >= sources.length) return Promise.reject(new Error('no rate source answered'));
      return sources[i++]().then(function (rate) {
        rate = parseFloat(rate);
        // Sanity band: US$1 between ₹20 and ₹200.
        if (!(rate > 0.005 && rate < 0.05)) throw new Error('implausible rate');
        return rate;
      }).catch(next);
    }
    return next();
  }
  function getRate(cb) {
    var cached = lsJson(KEY_RATE);
    var fresh = cached && cached.rate > 0 && (Date.now() - cached.ts) < RATE_TTL_MS;
    if (fresh) return cb(cached.rate, 'cache');
    if (cfg.live === false || typeof fetch !== 'function') return cb(fallbackRate(), 'fixed');
    fetchLiveRate().then(function (rate) {
      lsSet(KEY_RATE, JSON.stringify({ rate: rate, ts: Date.now() }));
      cb(rate, 'live');
    }).catch(function () {
      if (cached && cached.rate > 0) return cb(cached.rate, 'stale-cache');
      cb(fallbackRate(), 'fixed');
    });
  }

  // ---- public API --------------------------------------------------------------
  window.PCMoney = {
    html: moneyHtml,     // <span class="price-inr pc-money" data-paise> in the display currency
    text: moneyText,     // plain text in the display currency
    inrHtml: inrHtml,    // always-INR <span class="price-inr"> (no pc-money, never converted)
    inrText: inrText,
    usdText: usdText,
    mode: function () { return state.mode; },
    rate: function () { return state.rate; },
    convert: convertAll,
    set: function (mode) { setMode(mode === 'USD' ? 'USD' : 'INR', true); }
  };

  // ---- boot ----------------------------------------------------------------------
  bindToggles();
  observe();
  if (!ENABLED) { applyMode('INR'); return; }
  var choice = lsGet(KEY_MODE);
  if (choice === 'USD' || choice === 'INR') { setMode(choice, false); return; }
  detectCountry(function (code) {
    var chosen = lsGet(KEY_MODE); // a toggle click made while a lookup was in flight wins
    if (chosen === 'USD' || chosen === 'INR') return;
    setMode(code && code !== HOME ? 'USD' : 'INR', false);
  });
})();
