/* ========== Compare App - Global ========== */
window.CompareApp = (function() {
  var STORAGE_KEY = 'precious_carats_compare';
  var MAX_PRODUCTS = 4;

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
        handle: handle,
        title: btn.getAttribute('data-product-title') || '',
        url: btn.getAttribute('data-product-url') || '',
        price: btn.getAttribute('data-product-price') || '',
        image: btn.getAttribute('data-product-image') || '',
        variant_id: btn.getAttribute('data-variant-id') || '',
        available: btn.getAttribute('data-product-available') || 'true',
        type: btn.getAttribute('data-product-type') || '',
        vendor: btn.getAttribute('data-product-vendor') || ''
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

  function renderPage() {
    var items = getItems();
    var emptyEl = document.getElementById('compare-empty');
    var tableWrap = document.getElementById('compare-table-wrap');
    var actionsEl = document.getElementById('compare-actions');
    var countEl = document.getElementById('compare-count-text');

    if (!emptyEl) return;

    countEl.textContent = items.length + ' product' + (items.length !== 1 ? 's' : '');

    if (items.length === 0) {
      emptyEl.style.display = '';
      tableWrap.style.display = 'none';
      actionsEl.style.display = 'none';
      return;
    }

    emptyEl.style.display = 'none';
    tableWrap.style.display = '';
    actionsEl.style.display = '';

    var thead = document.getElementById('compare-thead');
    var tbody = document.getElementById('compare-tbody');

    // Header row: product titles as column headers (like the reference)
    var titleRow = '<tr><th></th>';
    for (var i = 0; i < items.length; i++) {
      titleRow += '<th class="compare-col-header">' +
        '<a class="compare-product-title" href="' + items[i].url + '">' + items[i].title + '</a>' +
        '</th>';
    }
    titleRow += '</tr>';
    thead.innerHTML = titleRow;

    // Body rows: image row, then attribute rows
    var tbodyHtml = '';

    // Image row
    tbodyHtml += '<tr><td></td>';
    for (var p = 0; p < items.length; p++) {
      tbodyHtml += '<td class="compare-img-cell">' +
        '<img class="compare-product-img" src="' + items[p].image + '" alt="' + items[p].title + '">' +
        '</td>';
    }
    tbodyHtml += '</tr>';

    // Attribute rows
    var rows = [
      { label: 'Price', key: 'price' },
      { label: 'Availability', key: 'available' },
      { label: 'Type', key: 'type' },
      { label: 'Vendor', key: 'vendor' }
    ];

    for (var r = 0; r < rows.length; r++) {
      var row = rows[r];
      tbodyHtml += '<tr><td>' + row.label + '</td>';
      for (var q = 0; q < items.length; q++) {
        var val = items[q][row.key] || '\u2014';
        if (row.key === 'available') {
          val = (val === 'true' || val === true)
            ? '<span class="compare-available">In Stock</span>'
            : '<span class="compare-unavailable">Sold Out</span>';
        }
        if (row.key === 'price') {
          val = '<span class="compare-price">' + val + '</span>';
        }
        tbodyHtml += '<td>' + val + '</td>';
      }
      tbodyHtml += '</tr>';
    }

    // Action row: View Details + Remove
    tbodyHtml += '<tr class="compare-actions-row"><td></td>';
    for (var a = 0; a < items.length; a++) {
      tbodyHtml += '<td>' +
        '<a class="compare-view-btn" href="' + items[a].url + '">VIEW DETAILS</a>' +
        '<button class="compare-remove-btn" onclick="CompareApp.remove(\'' + items[a].handle + '\')">' +
        '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
        ' REMOVE</button>' +
        '</td>';
    }
    tbodyHtml += '</tr>';

    tbody.innerHTML = tbodyHtml;
  }

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

  // Initialize on DOMContentLoaded
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
    clearAll: clearAll,
    getItems: getItems,
    renderPage: renderPage,
    highlightButtons: highlightButtons,
    updateHeaderBadge: updateHeaderBadge
  };
})();
