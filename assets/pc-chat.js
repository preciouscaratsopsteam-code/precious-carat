/*
 * pc-chat.js — Gem Assistant chat widget (storefront side).
 *
 * snippets/pc-chat.liquid renders the launcher button and a JSON config; this
 * script builds the panel on first open, loads assets/pc-chat.css then, and
 * talks to the Cloudflare Worker in workers/gem-bot:
 *
 *   POST {endpoint}/chat  { messages: [{role, content}], page: {...} }
 *   <- Server-Sent Events: status | delta | reset | products | error | done
 *
 * The conversation lives in sessionStorage, so it survives the visitor clicking
 * through to a product and back, and ends with the browser tab. Nothing the
 * assistant writes is ever inserted as HTML: replies are parsed into text
 * nodes, and only **bold**, lists, links to this store / WhatsApp and
 * [[product:handle]] cards are given any markup.
 */
(function () {
  'use strict';

  var root = document.getElementById('pc-chat');
  var cfgEl = document.getElementById('pc-chat-config');
  if (!root || !cfgEl || !window.fetch || !window.ReadableStream || !window.TextDecoder || !window.AbortController) return;

  var cfg;
  try { cfg = JSON.parse(cfgEl.textContent); } catch (e) { return; }
  var ENDPOINT = String(cfg.endpoint || '').trim().replace(/\/+$/, '').replace(/\/chat$/, '');
  if (!/^https:\/\/|^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/.test(ENDPOINT)) return;

  var launcher = root.querySelector('.pcc-launch');
  if (!launcher) return;
  root.hidden = false;

  // Where the visitor is, so "this stone" means something to the assistant.
  // The title is read from the document rather than printed into the config.
  var PAGE = cfg.page && typeof cfg.page === 'object' ? cfg.page : {};
  PAGE.title = document.title;

  var STORE_KEY = 'pc_chat_v1';
  var MAX_STORED = 30;   // messages kept in sessionStorage
  var MAX_SENT = 24;     // messages sent to the Worker (it enforces the same cap)
  var MAX_INPUT = 2000;
  var NAME = String(cfg.name || 'Gem Assistant');
  var WA = 'https://wa.me/' + String(cfg.whatsapp || '').replace(/\D+/g, '');
  var WA_HELP = WA + '?text=' + encodeURIComponent('Hi, I was chatting with the ' + NAME + ' on Precious Carats and would like to speak to a gem expert.');
  var LINK_HOSTS = [location.hostname, 'www.preciouscarats.com', 'preciouscarats.com', 'wa.me', 'api.whatsapp.com'];
  var MARKER = /^\[\[product:([a-z0-9][a-z0-9-]*)\]\]$/;

  var state = { messages: [], products: {}, open: false };
  var busy = false;
  var panel = null;
  var els = {};
  var controller = null;
  var cssReady = null;

  // ── storage (private mode / blocked storage must never throw) ─────────────
  function load() {
    try {
      var saved = JSON.parse(sessionStorage.getItem(STORE_KEY) || 'null');
      if (!saved || !Array.isArray(saved.messages)) return;
      state.messages = saved.messages.filter(function (m) {
        return m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content;
      });
      if (saved.products && typeof saved.products === 'object') state.products = saved.products;
      state.open = saved.open === true;
    } catch (e) {}
  }
  function save() {
    try {
      var messages = state.messages.slice(-MAX_STORED);
      var text = messages.map(function (m) { return m.content; }).join('\n');
      var products = {};
      Object.keys(state.products).forEach(function (h) {
        if (text.indexOf('[[product:' + h + ']]') !== -1) products[h] = state.products[h];
      });
      sessionStorage.setItem(STORE_KEY, JSON.stringify({ messages: messages, products: products, open: state.open && isWide() }));
    } catch (e) {}
  }

  function isWide() { return window.matchMedia('(min-width: 600px)').matches; }

  function track(action) {
    try {
      document.dispatchEvent(new CustomEvent('pc:chat', { detail: { action: action } }));
      if (typeof window.clarity === 'function') window.clarity('event', 'chat_' + action);
      if (typeof window.gtag === 'function') window.gtag('event', 'chat_' + action);
    } catch (e) {}
  }

  // ── DOM helpers ────────────────────────────────────────────────────────────
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  // Static, hand-written SVG only — never called with model or visitor text.
  function icon(svg) {
    var span = el('span');
    span.setAttribute('aria-hidden', 'true');
    span.style.display = 'flex';
    span.innerHTML = svg;
    return span;
  }
  var ICON_CLOSE = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  var ICON_NEW = '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12a8 8 0 1 0 2.6-5.9"/><path d="M4 4.5V9h4.5"/></svg>';
  var ICON_SEND = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="M5.5 11.5L12 5l6.5 6.5"/></svg>';
  var ICON_WA = '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38c1.45.79 3.08 1.21 4.74 1.21 5.46 0 9.91-4.45 9.91-9.91S17.5 2 12.04 2m0 1.67c4.54 0 8.24 3.7 8.24 8.24s-3.7 8.24-8.24 8.24c-1.48 0-2.93-.4-4.19-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.2 8.2 0 0 1-1.26-4.38c0-4.54 3.7-8.24 8.24-8.24"/></svg>';

  function safeUrl(href) {
    try {
      var u = new URL(href, location.origin);
      if (u.protocol === 'https:' && LINK_HOSTS.indexOf(u.hostname) !== -1) return u;
      if (u.origin === location.origin) return u;
    } catch (e) {}
    return null;
  }

  // ── rendering a reply ──────────────────────────────────────────────────────
  function inline(parent, text) {
    var re = /\*\*([^*\n]+)\*\*|\[([^\]\n]+)\]\(([^)\s]+)\)/g;
    var last = 0;
    var m;
    while ((m = re.exec(text))) {
      if (m.index > last) parent.appendChild(document.createTextNode(text.slice(last, m.index)));
      if (m[1] != null) {
        parent.appendChild(el('strong', '', m[1]));
      } else {
        var url = safeUrl(m[3]);
        if (url) {
          var a = el('a', '', m[2]);
          a.href = url.href;
          if (url.hostname !== location.hostname) { a.target = '_blank'; a.rel = 'noopener'; }
          parent.appendChild(a);
        } else {
          parent.appendChild(document.createTextNode(m[2])); // a link to anywhere else is shown as plain words
        }
      }
      last = re.lastIndex;
    }
    if (last < text.length) parent.appendChild(document.createTextNode(text.slice(last)));
  }

  function inrGroup(rupees) {
    var s = String(Math.round(Math.abs(rupees)));
    if (s.length <= 3) return s;
    return s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + s.slice(-3);
  }
  function priceNode(rupees) {
    var span = el('span', 'pcc-card__price');
    var paise = Math.round(Number(rupees) * 100) || 0;
    // The theme's own money helper shows US$ to visitors abroad (assets/pc-currency.js).
    // Its input here is a number and its output is the theme's markup.
    if (window.PCMoney && typeof window.PCMoney.html === 'function') span.innerHTML = window.PCMoney.html(paise);
    else span.textContent = '₹' + inrGroup(paise / 100);
    return span;
  }

  function card(handle) {
    var p = state.products[handle];
    var a = el('a', 'pcc-card');
    a.href = '/products/' + encodeURIComponent(handle);
    if (p && typeof p.image === 'string' && /^https:\/\//.test(p.image)) {
      var img = el('img', 'pcc-card__img');
      img.src = p.image;
      img.alt = '';
      img.width = 64;
      img.height = 64;
      img.loading = 'lazy';
      a.appendChild(img);
    }
    var body = el('span', 'pcc-card__body');
    body.appendChild(el('span', 'pcc-card__title', p && p.title ? String(p.title) : 'View this stone'));
    var meta = el('span', 'pcc-card__meta');
    if (p) {
      meta.appendChild(priceNode(p.price));
      if (p.available === false) meta.appendChild(el('span', 'pcc-card__sold', 'Sold'));
    }
    meta.appendChild(el('span', 'pcc-card__go', 'View →'));
    body.appendChild(meta);
    a.appendChild(body);
    a.addEventListener('click', function () { track('product_click'); save(); });
    return a;
  }

  function renderReply(node, text, streaming) {
    node.textContent = '';
    if (streaming) {
      // Do not flash half-arrived markup: an unfinished [[product:…]] or [link](…
      text = text.replace(/\[\[[^\]\n]*\]?$/, '').replace(/\[[^\]\n]*(\]\([^)\n]*)?$/, '');
    }
    text = text.replace(/[ \t]*(\[\[product:[a-z0-9][a-z0-9-]*\]\])[ \t]*/g, '\n$1\n');
    var para = [];
    var list = null;
    function flush() {
      if (!para.length) return;
      var p = el('p');
      para.forEach(function (line, i) {
        if (i) p.appendChild(el('br'));
        inline(p, line);
      });
      node.appendChild(p);
      para = [];
    }
    text.split('\n').forEach(function (raw) {
      var line = raw.trim();
      var m;
      if (!line) { flush(); list = null; return; }
      if ((m = MARKER.exec(line))) { flush(); list = null; node.appendChild(card(m[1])); return; }
      if ((m = /^(?:[-*•]|\d+[.)])\s+(.*)$/.exec(line))) {
        flush();
        if (!list) { list = el('ul'); node.appendChild(list); }
        var li = el('li');
        inline(li, m[1]);
        list.appendChild(li);
        return;
      }
      list = null;
      para.push(line.replace(/^#{1,6}\s+/, ''));
    });
    flush();
  }

  function plainText(text) {
    return text.replace(/\[\[product:[^\]]*\]\]/g, '').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/\s+/g, ' ').trim();
  }

  function isPinned() { return els.log.scrollHeight - els.log.scrollTop - els.log.clientHeight < 80; }
  function scrollEnd() { els.log.scrollTop = els.log.scrollHeight; }

  function messageNode(msg) {
    if (msg.role === 'user') return el('div', 'pcc-msg pcc-msg--user', msg.content);
    var node = el('div', 'pcc-msg pcc-msg--bot' + (msg.error ? ' pcc-msg--error' : ''));
    renderReply(node, msg.content, false);
    return node;
  }

  function chips() {
    var wrap = el('div', 'pcc-chips');
    var prompts = [];
    if (PAGE.product_handle) prompts.push('Tell me about this stone');
    prompts.push('Help me choose a gemstone', 'Is every stone certified?', 'How do returns work?', 'Track my order');
    prompts.slice(0, 4).forEach(function (text) {
      var b = el('button', 'pcc-chip', text);
      b.type = 'button';
      b.addEventListener('click', function () { send(text); });
      wrap.appendChild(b);
    });
    return wrap;
  }

  function renderAll() {
    els.log.textContent = '';
    var hello = el('div', 'pcc-msg pcc-msg--bot');
    renderReply(hello, String(cfg.greeting || 'How can I help?'), false);
    els.log.appendChild(hello);
    if (!state.messages.length) {
      els.chips = chips();
      els.log.appendChild(els.chips);
    }
    state.messages.forEach(function (m) { els.log.appendChild(messageNode(m)); });
    scrollEnd();
  }

  // ── status line ("Searching the collection…") ─────────────────────────────
  function setStatus(label) {
    if (!label) {
      if (els.status) { els.status.remove(); els.status = null; }
      return;
    }
    if (!els.status) {
      els.status = el('div', 'pcc-status');
      var dots = el('span', 'pcc-dots');
      dots.appendChild(el('i')); dots.appendChild(el('i')); dots.appendChild(el('i'));
      els.status.appendChild(dots);
      els.statusText = el('span');
      els.status.appendChild(els.statusText);
    }
    els.statusText.textContent = label;
    els.log.appendChild(els.status); // keeps it last
    scrollEnd();
  }

  function setBusy(on) {
    busy = on;
    els.send.disabled = on;
    if (!on) setStatus('');
  }

  // ── talking to the Worker ──────────────────────────────────────────────────
  function history() {
    return state.messages
      .filter(function (m) { return !m.error && m.content; })
      .slice(-MAX_SENT)
      .map(function (m) { return { role: m.role, content: m.content }; });
  }

  function send(text) {
    text = String(text || '').trim().slice(0, MAX_INPUT);
    if (!text || busy || !panel) return;
    if (els.chips) { els.chips.remove(); els.chips = null; }

    var userMsg = { role: 'user', content: text };
    state.messages.push(userMsg);
    els.log.appendChild(messageNode(userMsg));
    els.input.value = '';
    grow();
    setBusy(true);
    setStatus('Thinking…');
    track('message');

    var reply = { role: 'assistant', content: '' };
    var node = null;
    var failure = null;
    var frame = 0;

    function paint() {
      frame = 0;
      if (!reply.content) { if (node) { node.remove(); node = null; } return; }
      var pinned = isPinned();
      if (!node) { node = el('div', 'pcc-msg pcc-msg--bot'); els.log.appendChild(node); }
      renderReply(node, reply.content, true);
      if (els.status) els.log.appendChild(els.status);
      if (pinned) scrollEnd();
    }
    function schedule() { if (!frame) frame = window.requestAnimationFrame(paint); }

    function onEvent(type, data) {
      if (type === 'delta' && typeof data.text === 'string') {
        if (!reply.content) setStatus('');
        reply.content += data.text;
        schedule();
      } else if (type === 'status' && typeof data.label === 'string') {
        setStatus(data.label);
      } else if (type === 'products' && Array.isArray(data.items)) {
        data.items.forEach(function (p) { if (p && typeof p.handle === 'string') state.products[p.handle] = p; });
        schedule();
      } else if (type === 'reset') {
        reply.content = '';
        schedule();
      } else if (type === 'error') {
        failure = String(data.message || '');
      }
    }

    function onFrame(block) {
      var type = 'message';
      var data = '';
      block.split('\n').forEach(function (line) {
        if (line.indexOf('event:') === 0) type = line.slice(6).trim();
        else if (line.indexOf('data:') === 0) data += line.slice(5).trim();
      });
      if (!data) return;
      try { onEvent(type, JSON.parse(data)); } catch (e) {}
    }

    controller = new AbortController();
    var mine = controller;
    var timer = setTimeout(function () { mine.abort(); }, 120000);

    fetch(ENDPOINT + '/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: history(), page: PAGE }),
      signal: mine.signal
    }).then(function (res) {
      if (!res.ok || !res.body) {
        return res.json().catch(function () { return {}; }).then(function (j) {
          failure = (j && typeof j.error === 'string' && j.error) || 'unavailable';
        });
      }
      var reader = res.body.getReader();
      var decoder = new TextDecoder();
      var buffer = '';
      function pump() {
        return reader.read().then(function (chunk) {
          if (chunk.done) return;
          buffer += decoder.decode(chunk.value, { stream: true });
          var cut;
          while ((cut = buffer.indexOf('\n\n')) !== -1) {
            onFrame(buffer.slice(0, cut));
            buffer = buffer.slice(cut + 2);
          }
          return pump();
        });
      }
      return pump();
    }).catch(function () {
      if (!failure) failure = 'unavailable';
    }).then(function () {
      clearTimeout(timer);
      if (mine !== controller) return; // "New chat" was pressed while this was streaming
      controller = null;
      if (frame) { window.cancelAnimationFrame(frame); frame = 0; }
      var pinned = isPinned();

      if (reply.content.trim()) {
        if (!node) { node = el('div', 'pcc-msg pcc-msg--bot'); els.log.appendChild(node); }
        renderReply(node, reply.content, false);
        state.messages.push(reply);
        els.live.textContent = plainText(reply.content);
      } else if (node) {
        node.remove();
      }
      if (failure || !reply.content.trim()) {
        var words = failure && failure !== 'unavailable' ? failure : 'Sorry, I could not reach the assistant just now. Please try again.';
        var err = { role: 'assistant', error: true, content: words + ' You can also [chat with our team on WhatsApp](' + WA_HELP + ').' };
        els.log.appendChild(messageNode(err));
        els.live.textContent = plainText(err.content);
        track('error');
      }
      setBusy(false);
      save();
      if (pinned) scrollEnd();
    });
  }

  // ── panel ──────────────────────────────────────────────────────────────────
  function grow() {
    els.input.style.height = 'auto';
    els.input.style.height = Math.min(els.input.scrollHeight + 2, 120) + 'px';
  }

  function fit() {
    if (!panel) return;
    var vv = window.visualViewport;
    if (state.open && vv && !isWide()) {
      panel.style.setProperty('--pcc-h', vv.height + 'px');
      panel.style.setProperty('--pcc-top', vv.offsetTop + 'px');
    } else {
      panel.style.removeProperty('--pcc-h');
      panel.style.removeProperty('--pcc-top');
    }
  }

  function loadCss() {
    if (cssReady) return cssReady;
    cssReady = new Promise(function (resolve) {
      var link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = cfg.css;
      link.onload = resolve;
      link.onerror = resolve;
      setTimeout(resolve, 2500);
      document.head.appendChild(link);
    });
    return cssReady;
  }

  function build() {
    panel = el('section', 'pcc');
    panel.id = 'pcc-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', NAME);

    var head = el('div', 'pcc__head');
    var heading = el('div', 'pcc__heading');
    heading.appendChild(el('h2', 'pcc__title', NAME));
    heading.appendChild(el('p', 'pcc__sub', 'AI assistant · Precious Carats'));
    head.appendChild(heading);
    var fresh = el('button', 'pcc__hbtn');
    fresh.type = 'button';
    fresh.setAttribute('aria-label', 'Start a new chat');
    fresh.title = 'Start a new chat';
    fresh.appendChild(icon(ICON_NEW));
    fresh.addEventListener('click', reset);
    head.appendChild(fresh);
    els.close = el('button', 'pcc__hbtn');
    els.close.type = 'button';
    els.close.setAttribute('aria-label', 'Close chat');
    els.close.appendChild(icon(ICON_CLOSE));
    els.close.addEventListener('click', close);
    head.appendChild(els.close);
    panel.appendChild(head);

    els.log = el('div', 'pcc__log');
    els.log.setAttribute('tabindex', '0');
    els.log.setAttribute('aria-label', 'Conversation');
    panel.appendChild(els.log);

    // Finished replies are announced once from here, instead of the log
    // announcing every streamed fragment.
    els.live = el('div', 'pcc-sr');
    els.live.setAttribute('aria-live', 'polite');
    panel.appendChild(els.live);

    var form = el('form', 'pcc__form');
    form.setAttribute('novalidate', '');
    var label = el('label', 'pcc-sr', 'Your message');
    label.htmlFor = 'pcc-input';
    form.appendChild(label);
    els.input = el('textarea', 'pcc__input');
    els.input.id = 'pcc-input';
    els.input.rows = 1;
    els.input.maxLength = MAX_INPUT;
    els.input.placeholder = 'Ask about a gemstone or an order…';
    els.input.setAttribute('enterkeyhint', 'send');
    els.input.setAttribute('autocomplete', 'off');
    els.input.addEventListener('input', grow);
    els.input.addEventListener('keydown', function (e) {
      // isComposing: Hindi and other IME input confirms a word with Enter.
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) {
        e.preventDefault();
        send(els.input.value);
      }
    });
    form.appendChild(els.input);
    els.send = el('button', 'pcc__send');
    els.send.type = 'submit';
    els.send.setAttribute('aria-label', 'Send');
    els.send.appendChild(icon(ICON_SEND));
    form.appendChild(els.send);
    form.addEventListener('submit', function (e) { e.preventDefault(); send(els.input.value); });
    panel.appendChild(form);

    var foot = el('div', 'pcc__foot');
    foot.appendChild(el('span', '', 'AI answers can be wrong. Check the product page before you buy.'));
    var wa = el('a', 'pcc__wa');
    wa.href = WA_HELP;
    wa.target = '_blank';
    wa.rel = 'noopener';
    wa.appendChild(icon(ICON_WA));
    wa.appendChild(el('span', '', 'Talk to an expert'));
    foot.appendChild(wa);
    panel.appendChild(foot);

    panel.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
    document.body.appendChild(panel);
    renderAll();
  }

  function open() {
    loadCss().then(function () {
      if (!panel) build();
      state.open = true;
      panel.classList.add('is-open');
      document.documentElement.classList.add('pcc-is-open');
      launcher.setAttribute('aria-expanded', 'true');
      fit();
      scrollEnd();
      // On a phone, focusing the box would raise the keyboard over the greeting.
      if (isWide()) els.input.focus(); else els.close.focus();
      save();
    });
  }

  function close() {
    if (!panel) return;
    state.open = false;
    panel.classList.remove('is-open');
    document.documentElement.classList.remove('pcc-is-open');
    launcher.setAttribute('aria-expanded', 'false');
    fit();
    save();
    launcher.focus();
  }

  function reset() {
    if (controller) { var c = controller; controller = null; c.abort(); }
    state.messages = [];
    state.products = {};
    setBusy(false);
    renderAll();
    save();
    if (isWide()) els.input.focus();
  }

  launcher.addEventListener('click', function () { track('open'); open(); });
  launcher.addEventListener('pointerenter', loadCss, { once: true });
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', fit);
    window.visualViewport.addEventListener('scroll', fit);
  }

  load();
  // On desktop the panel sits beside the page, so keep it open across page loads.
  if (state.open && isWide()) open(); else state.open = false;
})();
