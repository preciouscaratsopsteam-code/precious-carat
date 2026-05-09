/* ========== Compare App - Global ========== */
window.CompareApp = (function() {
  var STORAGE_KEY = 'precious_carats_compare';
  var MAX_PRODUCTS = 4;
  var productCache = {};

  function getItems() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
    } catch(e) { return []; }
  }

  function saveItems(items) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  }

  function updateHeaderBadge() {
    var count = getItems().length;
    var badge = document.getElementById('header-compare-count');
    if (!badge) return;
    if (count > 0) {
      badge.textContent = count;
      badge.style.display = '';
    } else {
      badge.style.display = 'none';
    }
  }

  function toast(msg) {
    var el = document.getElementById('compare-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'compare-toast';
      el.className = 'compare-toast';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add('is-visible');
    clearTimeout(window._compareToastTimer);
    window._compareToastTimer = setTimeout(function() { el.classList.remove('is-visible'); }, 2200);
  }

  function toggle(btn) {
    var handle = btn.getAttribute('data-product-handle');
    if (!handle) return;

    var items = getItems();
    var idx = -1;
    for (var i = 0; i < items.length; i++) {
      if (items[i].handle === handle) { idx = i; break; }
    }

    if (idx > -1) {
      items.splice(idx, 1);
      btn.classList.remove('is-active');
      toast('Removed from comparison');
    } else {
      if (items.length >= MAX_PRODUCTS) {
        toast('Maximum ' + MAX_PRODUCTS + ' products can be compared');
        return;
      }
      items.push({
        id: btn.getAttribute('data-product-id') || handle,
        handle: handle,
        title: btn.getAttribute('data-product-title') || '',
        url: btn.getAttribute('data-product-url') || '',
        price: btn.getAttribute('data-product-price') || '',
        image: btn.getAttribute('data-product-image') || '',
        variant_id: btn.getAttribute('data-variant-id') || '',
        type: btn.getAttribute('data-product-type') || '',
        vendor: btn.getAttribute('data-product-vendor') || '',
        gemType: btn.getAttribute('data-gem-type') || '',
        origin: btn.getAttribute('data-gem-origin') || '',
        weightCarats: btn.getAttribute('data-gem-weight-carats') || '',
        weightRatti: btn.getAttribute('data-gem-weight-ratti') || '',
        shapeCut: btn.getAttribute('data-gem-shape-cut') || '',
        cuttingStyle: btn.getAttribute('data-gem-cutting-style') || '',
        transparency: btn.getAttribute('data-gem-transparency') || '',
        color: btn.getAttribute('data-gem-color') || '',
        planet: btn.getAttribute('data-gem-planet') || '',
        certLab: btn.getAttribute('data-gem-cert-lab') || '',
        certNumber: btn.getAttribute('data-gem-cert-number') || '',
        certLink: btn.getAttribute('data-gem-cert-link') || '',
        treatment: btn.getAttribute('data-gem-treatment') || '',
        dimensions: btn.getAttribute('data-gem-dimensions') || '',
        species: btn.getAttribute('data-gem-species') || ''
      });
      btn.classList.add('is-active');
      toast('Added to comparison (' + items.length + '/' + MAX_PRODUCTS + ')');
    }
    saveItems(items);
    highlightButtons();
    updateHeaderBadge();
  }

  function highlightButtons() {
    var items = getItems();
    var handles = [];
    for (var i = 0; i < items.length; i++) {
      handles.push(items[i].handle);
    }
    var btns = document.querySelectorAll('.product-card__compare');
    for (var j = 0; j < btns.length; j++) {
      var h = btns[j].getAttribute('data-product-handle');
      if (handles.indexOf(h) > -1) {
        btns[j].classList.add('is-active');
      } else {
        btns[j].classList.remove('is-active');
      }
    }
  }

  /* ========== Fetch full product data from Shopify ========== */
  function fetchProductData(handle, callback) {
    if (productCache[handle]) {
      callback(productCache[handle]);
      return;
    }

    var jsonRequest = fetch('/products/' + handle + '.json')
      .then(function(r) { return r.json(); })
      .then(function(data) { return data.product || data; })
      .catch(function() { return null; });

    var pageRequest = fetch('/products/' + handle)
      .then(function(r) { return r.text(); })
      .then(parseProductPageSpecs)
      .catch(function() { return {}; });

    Promise.all([jsonRequest, pageRequest])
      .then(function(results) {
        var p = results[0] || {};
        p.pageSpecs = results[1] || {};
        productCache[handle] = p;
        callback(p);
      })
      .catch(function() {
        callback(null);
      });
  }

  /* ========== Parse product body_html for gem attributes ========== */
  function parseLiValue(html, label) {
    if (!html) return '';
    /* Match patterns like: <li>Weight Carat : 0.38</li> or Weight Carat: 0.38 */
    var regex = new RegExp(label + '\\s*[:\\-]\\s*([^<\\n]+)', 'i');
    var match = html.match(regex);
    return match ? match[1].trim() : '';
  }

  function itemValue(item, key) {
    return item && item[key] ? item[key] : '';
  }

  function cleanText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function normalizeSpecLabel(label) {
    return cleanText(label).toLowerCase().replace(/[^a-z0-9]+/g, '');
  }

  function parseProductPageSpecs(html) {
    var specs = {};
    if (!html || typeof DOMParser === 'undefined') return specs;

    var labelMap = {
      gemtype: 'gemType',
      origin: 'origin',
      weight: 'weight',
      shapecut: 'shapeCut',
      shapedescription: 'shapeDescription',
      transparency: 'transparency',
      color: 'color',
      certification: 'certification',
      planet: 'planet',
      specialfeatures: 'specialFeatures',
      speciesvariety: 'species',
      refractiveindexri: 'refractiveIndex',
      specificgravitysg: 'specificGravity',
      internalcharacteristics: 'internalCharacteristics',
      dimensions: 'dimensions',
      treatmentstatus: 'treatment'
    };

    var doc = new DOMParser().parseFromString(html, 'text/html');

    function addSpec(labelEl, valueEl) {
      if (!labelEl || !valueEl) return;
      var key = labelMap[normalizeSpecLabel(labelEl.textContent)];
      var value = cleanText(valueEl.textContent);
      if (key && value && !specs[key]) specs[key] = value;
    }

    var cards = doc.querySelectorAll('.product-page__spec-item');
    for (var i = 0; i < cards.length; i++) {
      addSpec(cards[i].querySelector('.product-page__spec-label'), cards[i].querySelector('.product-page__spec-value'));
    }

    var rows = doc.querySelectorAll('.product-page__specs-row');
    for (var j = 0; j < rows.length; j++) {
      addSpec(rows[j].querySelector('.product-page__specs-label'), rows[j].querySelector('.product-page__specs-val'));
    }

    return specs;
  }

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, function(c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  function escapeAttr(value) {
    return escapeHtml(value);
  }

  function extractAttrs(product, item) {
    var variant = (product && product.variants && product.variants[0]) ? product.variants[0] : {};
    var body = (product && (product.body_html || product.description)) ? (product.body_html || product.description) : '';
    var pageSpecs = (product && product.pageSpecs) ? product.pageSpecs : {};

    /* SKU */
    var sku = variant.sku || itemValue(item, 'sku');

    /* Weight — try body_html first */
    var weightCarat = itemValue(item, 'weightCarats') || parseLiValue(body, 'Weight Carat');
    var weightRatti = itemValue(item, 'weightRatti') || parseLiValue(body, 'Weight Ratti');
    var weight = pageSpecs.weight || '';
    if (!weight && weightCarat) {
      weight = weightCarat + ' cts';
      if (weightRatti) weight += ' / ' + weightRatti + ' ratti';
    } else if (!weight && variant.weight && variant.weight > 0) {
      weight = variant.weight + ' ' + (variant.weight_unit || 'g');
    }

    /* Shape & Cut */
    var shape = itemValue(item, 'shapeCut') || parseLiValue(body, 'Shape');
    var cut = itemValue(item, 'cuttingStyle') || parseLiValue(body, 'Cut');
    var shapeCut = pageSpecs.shapeCut || '';

    /* Dimensions — try to find NxNxN mm pattern */
    var dimensions = pageSpecs.dimensions || '';
    if (body) {
      var dMatch = body.match(/([\d.]+)\s*[xX×]\s*([\d.]+)\s*[xX×]\s*([\d.]+)\s*mm/i);
      if (!dimensions && dMatch) {
        dimensions = dMatch[0];
      } else if (!dimensions) {
        var dimVal = itemValue(item, 'dimensions') || parseLiValue(body, 'Approx Dim');
        if (!dimVal) dimVal = parseLiValue(body, 'Dimension');
        dimensions = dimVal;
      }
    } else if (!dimensions) {
      dimensions = itemValue(item, 'dimensions');
    }

    /* Composition / Quality */
    var gemType = pageSpecs.gemType || itemValue(item, 'gemType') || item.type || (product ? product.product_type : '');
    var composition = pageSpecs.species || itemValue(item, 'species') || parseLiValue(body, 'Composition');
    var quality = parseLiValue(body, 'Quality');
    if (!quality) quality = parseLiValue(body, 'Quality Grade');

    /* Treatment */
    var treatment = pageSpecs.treatment || itemValue(item, 'treatment') || parseLiValue(body, 'Treatment');

    /* Transparency */
    var transparency = pageSpecs.transparency || itemValue(item, 'transparency') || parseLiValue(body, 'Transparency');

    /* Certificate */
    var certificate = itemValue(item, 'certNumber') || parseLiValue(body, 'Certificate Number');
    if (!certificate) certificate = parseLiValue(body, 'Certificate No');

    /* Certification Lab */
    var certLab = itemValue(item, 'certLab') || parseLiValue(body, 'Certification Lab');

    /* Image */
    var imgSrc = item.image;
    if (product && product.images && product.images.length > 0) {
      var firstImg = product.images[0];
      imgSrc = typeof firstImg === 'string' ? firstImg : (firstImg.src || item.image);
    }

    return {
      name: (product && product.title) ? product.title : item.title,
      sku: sku,
      gemType: gemType,
      weight: weight,
      shape: shape,
      cut: cut,
      shapeCut: shapeCut,
      dimensions: dimensions,
      composition: composition,
      quality: quality,
      treatment: treatment,
      transparency: transparency,
      certificate: certificate,
      certLab: certLab,
      certification: pageSpecs.certification || '',
      origin: pageSpecs.origin || itemValue(item, 'origin') || parseLiValue(body, 'Origin'),
      color: pageSpecs.color || itemValue(item, 'color') || parseLiValue(body, 'Color'),
      planet: pageSpecs.planet || itemValue(item, 'planet') || parseLiValue(body, 'Planet'),
      id: itemValue(item, 'id') || item.handle,
      variant_id: itemValue(item, 'variant_id'),
      image: imgSrc,
      price: item.price,
      url: item.url || ('/products/' + item.handle),
      type: item.type || (product ? product.product_type : ''),
      vendor: item.vendor || (product ? product.vendor : '')
    };
  }

  /* ========== Render Compare Page (card layout) ========== */
  function renderPage() {
    var items = getItems();
    var emptyEl = document.getElementById('compare-empty');
    var cardsEl = document.getElementById('compare-cards');
    var actionsEl = document.getElementById('compare-actions');
    var shareBtn = document.getElementById('compare-share-btn');

    if (!emptyEl) return;

    if (items.length === 0) {
      emptyEl.style.display = '';
      if (cardsEl) cardsEl.style.display = 'none';
      if (actionsEl) actionsEl.style.display = 'none';
      if (shareBtn) shareBtn.style.display = 'none';
      return;
    }

    emptyEl.style.display = 'none';
    if (cardsEl) cardsEl.style.display = '';
    if (actionsEl) actionsEl.style.display = '';
    if (shareBtn) shareBtn.style.display = '';

    /* Show loading state */
    var loadingHtml = '';
    for (var l = 0; l < items.length; l++) {
      loadingHtml += buildCardHTML(l + 1, {
        name: items[l].title, sku: '...', weight: '...', shape: '', cut: '',
        dimensions: '...', composition: '', quality: '...', treatment: '',
        transparency: '', certificate: '', certLab: '',
        image: items[l].image, price: items[l].price, url: items[l].url
      }, items[l].handle);
    }
    cardsEl.innerHTML = loadingHtml;
    if (window.WishlistApp && typeof window.WishlistApp.syncButtons === 'function') {
      window.WishlistApp.syncButtons();
    }

    /* Fetch real data for each */
    var loaded = 0;
    var allAttrs = new Array(items.length);

    for (var i = 0; i < items.length; i++) {
      (function(idx) {
        fetchProductData(items[idx].handle, function(product) {
          allAttrs[idx] = extractAttrs(product, items[idx]);
          loaded++;
          if (loaded === items.length) {
            var html = '';
            for (var j = 0; j < allAttrs.length; j++) {
              html += buildCardHTML(j + 1, allAttrs[j], items[j].handle);
            }
            cardsEl.innerHTML = html;
            if (window.WishlistApp && typeof window.WishlistApp.syncButtons === 'function') {
              window.WishlistApp.syncButtons();
            }
          }
        });
      })(i);
    }
  }

  function attrRow(label, value) {
    if (!value) return '';
    return '<span class="compare-card__attr"><strong>' + escapeHtml(label) + ':</strong> ' + escapeHtml(value) + '</span>';
  }

  function buildCardHTML(num, attrs, handle) {
    /* Build attribute rows — only show fields that have values */
    var specs = '';
    if (attrs.sku) specs += attrRow('Item #', attrs.sku);
    if (attrs.gemType) specs += attrRow('Gem Type', attrs.gemType);
    if (attrs.origin) specs += attrRow('Origin', attrs.origin);
    if (attrs.weight) specs += attrRow('Weight', attrs.weight);
    if (attrs.shapeCut) {
      specs += attrRow('Shape / Cut', attrs.shapeCut);
    } else {
      if (attrs.shape) specs += attrRow('Shape', attrs.shape);
      if (attrs.cut) specs += attrRow('Cut', attrs.cut);
    }
    if (attrs.transparency) specs += attrRow('Transparency', attrs.transparency);
    if (attrs.planet) specs += attrRow('Planet', attrs.planet);
    if (attrs.composition) specs += attrRow('Composition', attrs.composition);
    if (attrs.dimensions) specs += attrRow('Dimensions', attrs.dimensions);
    if (attrs.color) specs += attrRow('Color', attrs.color);
    if (attrs.treatment) specs += attrRow('Treatment', attrs.treatment);
    if (attrs.quality) specs += attrRow('Quality Grade', attrs.quality);
    if (attrs.certification) specs += attrRow('Certification', attrs.certification);
    if (attrs.certLab) specs += attrRow('Certification Lab', attrs.certLab);
    if (attrs.certificate) specs += attrRow('Certificate No', attrs.certificate);

    return '<div class="compare-card">' +
      '<div class="compare-card__header">' +
        '<span class="compare-card__label">Gemstone ' + num + '</span>' +
        '<button class="compare-card__change-btn" onclick="CompareApp.openPopup(\'' + handle + '\')">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>' +
          ' Change Gemstone' +
        '</button>' +
      '</div>' +
      '<div class="compare-card__body">' +
        '<div class="compare-card__image-wrap">' +
          '<img class="compare-card__image" src="' + escapeAttr(attrs.image) + '" alt="' + escapeAttr(attrs.name) + '">' +
        '</div>' +
        '<div class="compare-card__content">' +
          '<div class="compare-card__content-head">' +
            '<a class="compare-card__product-name" href="' + escapeAttr(attrs.url) + '">' + escapeHtml(attrs.name) + '</a>' +
            '<button class="compare-card__wishlist-btn" aria-label="Add to wishlist" data-wishlist-toggle ' +
              'data-product-id="' + escapeAttr(attrs.id) + '" data-product-title="' + escapeAttr(attrs.name) + '" data-product-url="' + escapeAttr(attrs.url) + '" ' +
              'data-product-price="' + escapeAttr(attrs.price) + '" data-product-image="' + escapeAttr(attrs.image) + '" data-variant-id="' + escapeAttr(attrs.variant_id || '') + '" ' +
              'onclick="event.preventDefault(); event.stopPropagation(); if (window.WishlistApp) WishlistApp.toggle(this);">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>' +
            '</button>' +
          '</div>' +
          '<div class="compare-card__specs">' + specs + '</div>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  /* ========== Compare Popup / Drawer ========== */
  var _activeSlotHandle = null;

  function openPopup(slotHandle) {
    _activeSlotHandle = slotHandle || null;
    var overlay = document.getElementById('compare-popup-overlay');
    var popup = document.getElementById('compare-popup');
    var grid = document.getElementById('compare-popup-grid');
    if (!popup) return;

    var items = getItems();
    var html = '';
    for (var i = 0; i < items.length; i++) {
      html += buildPopupCard(items[i]);
    }
    if (items.length === 0) {
      html = '<div style="grid-column:1/-1;text-align:center;padding:40px 0;color:#aaa;">No gemstones in your compare list.</div>';
    }
    grid.innerHTML = html;

    overlay.style.display = '';
    popup.style.display = '';
    popup.offsetHeight; /* trigger reflow */
    popup.classList.add('is-open');
    document.body.style.overflow = 'hidden';
  }

  function closePopup() {
    var overlay = document.getElementById('compare-popup-overlay');
    var popup = document.getElementById('compare-popup');
    if (!popup) return;

    popup.classList.remove('is-open');
    document.body.style.overflow = '';
    setTimeout(function() {
      overlay.style.display = 'none';
      popup.style.display = 'none';
    }, 300);
  }

  function buildPopupCard(item) {
    return '<div class="compare-popup-card">' +
      '<div class="compare-popup-card__img-wrap">' +
        '<button class="compare-popup-card__delete" onclick="CompareApp.removeAndRefreshPopup(\'' + item.handle + '\')" aria-label="Remove">' +
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>' +
        '</button>' +
        '<img class="compare-popup-card__img" src="' + item.image + '" alt="' + item.title + '">' +
      '</div>' +
      '<div class="compare-popup-card__info">' +
        '<a class="compare-popup-card__name" href="' + item.url + '">' + item.title + '</a>' +
        '<p class="compare-popup-card__price">Price: ' + item.price + '</p>' +
        '<button class="compare-popup-card__add-btn" onclick="CompareApp.selectForSlot(\'' + item.handle + '\')">SELECT FOR COMPARE</button>' +
      '</div>' +
    '</div>';
  }

  /* Remove from popup and refresh */
  function removeAndRefreshPopup(handle) {
    remove(handle);
    openPopup(_activeSlotHandle);
  }

  /* Select a product for the active slot — swaps it if a slotHandle was given */
  function selectForSlot(handle) {
    closePopup();
    /* Navigate to the product so user can see it in detail */
    var items = getItems();
    for (var i = 0; i < items.length; i++) {
      if (items[i].handle === handle) {
        /* Already in list, just close popup and scroll to the card */
        toast(items[i].title + ' is in your compare list');
        return;
      }
    }
  }

  /* ========== Share ========== */
  function shareCompare() {
    var items = getItems();
    if (items.length === 0) {
      toast('No items to share');
      return;
    }
    var handles = [];
    for (var i = 0; i < items.length; i++) handles.push(items[i].handle);
    var url = window.location.origin + '/pages/compare?items=' + handles.join(',');

    if (navigator.share) {
      navigator.share({ title: 'Compare Gemstones', url: url });
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(url).then(function() {
        toast('Link copied to clipboard!');
      });
    } else {
      toast('Share not supported');
    }
  }

  /* ========== Remove / Clear ========== */
  function remove(handle) {
    var items = getItems();
    var filtered = [];
    for (var i = 0; i < items.length; i++) {
      if (items[i].handle !== handle) filtered.push(items[i]);
    }
    saveItems(filtered);
    renderPage();
    highlightButtons();
    updateHeaderBadge();
  }

  function clearAll() {
    saveItems([]);
    renderPage();
    highlightButtons();
    updateHeaderBadge();
  }

  /* ========== Initialize ========== */
  document.addEventListener('DOMContentLoaded', function() {
    highlightButtons();
    updateHeaderBadge();
    if (document.getElementById('compare-page')) {
      renderPage();
    }
  });

  return {
    toggle: toggle,
    remove: remove,
    removeAndRefreshPopup: removeAndRefreshPopup,
    clearAll: clearAll,
    getItems: getItems,
    renderPage: renderPage,
    highlightButtons: highlightButtons,
    updateHeaderBadge: updateHeaderBadge,
    openPopup: openPopup,
    closePopup: closePopup,
    selectForSlot: selectForSlot,
    shareCompare: shareCompare
  };
})();
