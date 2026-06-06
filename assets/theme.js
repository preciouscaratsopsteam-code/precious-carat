/**
 * Precious Carats Theme - Main JavaScript
 * Handles scroll animations, header behavior, and interactive elements
 */

(function() {
  'use strict';

  // =============================================
  // Scroll Reveal Animation
  // =============================================
  function initScrollReveal() {
    const revealElements = document.querySelectorAll('.reveal');
    if (!revealElements.length) return;

    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('revealed');
          observer.unobserve(entry.target);
        }
      });
    }, {
      threshold: 0.1,
      rootMargin: '0px 0px -50px 0px'
    });

    revealElements.forEach(el => observer.observe(el));
  }

  // =============================================
  // Sticky Header with Scroll Behavior
  // =============================================
  function initStickyHeader() {
    const header = document.getElementById('site-header');
    const navBar = document.getElementById('nav-bar');
    if (!header) return;

    let lastScrollY = 0;
    let ticking = false;

    function onScroll() {
      const currentScrollY = window.scrollY;

      if (currentScrollY > 100) {
        header.style.boxShadow = '0 2px 20px rgba(0, 0, 0, 0.08)';
      } else {
        header.style.boxShadow = '0 1px 4px rgba(0, 0, 0, 0.04)';
      }


      lastScrollY = currentScrollY;
      ticking = false;
    }

    window.addEventListener('scroll', () => {
      if (!ticking) {
        requestAnimationFrame(onScroll);
        ticking = true;
      }
    }, { passive: true });
  }

  // =============================================
  // Smooth Scroll for Anchor Links
  // =============================================
  function initSmoothScroll() {
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
      anchor.addEventListener('click', function(e) {
        const target = document.querySelector(this.getAttribute('href'));
        if (target) {
          e.preventDefault();
          const headerHeight = document.getElementById('site-header')?.offsetHeight || 0;
          const navHeight = document.getElementById('nav-bar')?.offsetHeight || 0;
          const offset = headerHeight + navHeight + 20;

          window.scrollTo({
            top: target.offsetTop - offset,
            behavior: 'smooth'
          });
        }
      });
    });
  }

  // =============================================
  // Image Lazy Loading Enhancement
  // =============================================
  function initLazyImages() {
    if ('loading' in HTMLImageElement.prototype) return; // Native support

    const lazyImages = document.querySelectorAll('img[loading="lazy"]');
    const imageObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const img = entry.target;
          if (img.dataset.src) {
            img.src = img.dataset.src;
          }
          imageObserver.unobserve(img);
        }
      });
    });

    lazyImages.forEach(img => imageObserver.observe(img));
  }

  // =============================================
  // Purpose Item Interaction
  // =============================================
  function initPurposeItems() {
    const items = document.querySelectorAll('.purpose-item');
    items.forEach(item => {
      item.addEventListener('click', function(e) {
        // Remove active from all
        items.forEach(i => i.classList.remove('purpose-item--active'));
        // Add active to clicked
        this.classList.add('purpose-item--active');
      });
    });
  }

  // =============================================
  // Nav Active State
  // =============================================
  function initNavActiveState() {
    const navLinks = document.querySelectorAll('.nav-bar__link');
    const currentPath = window.location.pathname;

    navLinks.forEach(link => {
      const href = link.getAttribute('href');
      if (href && href !== '#' && currentPath.includes(href)) {
        navLinks.forEach(l => l.classList.remove('nav-bar__link--active'));
        link.classList.add('nav-bar__link--active');
      }
    });
  }

  // =============================================
  // Add to Cart Animation
  // =============================================
  function initAddToCart() {
    document.querySelectorAll('.product-page__add-to-cart').forEach(btn => {
      btn.addEventListener('click', function() {
        const originalText = this.textContent;
        this.textContent = 'ADDING...';
        this.style.opacity = '0.7';
        
        setTimeout(() => {
          this.textContent = '✓ ADDED TO CART';
          this.style.opacity = '1';
          this.style.backgroundColor = '#27ae60';
          this.style.borderColor = '#27ae60';
          
          setTimeout(() => {
            this.textContent = originalText;
            this.style.backgroundColor = '';
            this.style.borderColor = '';
          }, 2000);
        }, 800);
      });
    });
  }

  // =============================================
  // Announcement Bar Close
  // =============================================
  function initAnnouncementBar() {
    const bar = document.getElementById('announcement-bar');
    if (!bar) return;

    // Auto-hide after 10 seconds (optional)
    // setTimeout(() => {
    //   bar.style.maxHeight = '0';
    //   bar.style.overflow = 'hidden';
    //   bar.style.padding = '0';
    //   bar.style.transition = 'all 0.4s ease';
    // }, 10000);
  }

  // =============================================
  // Mobile Menu Toggle
  // =============================================
  function initMobileMenu() {
    const menuToggle = document.querySelector('.header__menu-toggle');
    const navBar = document.getElementById('nav-bar');

    if (menuToggle && navBar) {
      menuToggle.addEventListener('click', function(e) {
        e.stopPropagation();
        navBar.classList.toggle('is-open');
        const isOpen = navBar.classList.contains('is-open');
        this.setAttribute('aria-expanded', isOpen);

        // Change icon based on open state
        const iconSvg = this.querySelector('svg');
        if (isOpen) {
          iconSvg.innerHTML = '<line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>';
        } else {
          iconSvg.innerHTML = '<line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="18"></line>';
        }
      });

      // Close mobile menu on outside click
      document.addEventListener('click', function(e) {
        if (navBar.classList.contains('is-open') && !e.target.closest('.nav-bar') && !e.target.closest('.header__menu-toggle')) {
          navBar.classList.remove('is-open');
          menuToggle.setAttribute('aria-expanded', 'false');
          const iconSvg = menuToggle.querySelector('svg');
          if (iconSvg) {
            iconSvg.innerHTML = '<line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="18"></line>';
          }
        }
      });
    }
  }

  // =============================================
  // Init All
  // =============================================
  function init() {
    initScrollReveal();
    initStickyHeader();
    initSmoothScroll();
    initLazyImages();
    initPurposeItems();
    initNavActiveState();
    initAddToCart();
    initAnnouncementBar();
    initMobileMenu();
    initQuickView();
  }

  // Run on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // =============================================
  // Quick View Modal
  // =============================================
  function initQuickView() {
    const qvButtons = document.querySelectorAll('[data-quick-view]');
    const qvModal = document.getElementById('QuickViewModal');
    const qvContent = document.getElementById('QuickViewContent');
    const qvClose = document.querySelectorAll('[data-quick-view-close]');

    if (!qvModal || !qvContent) return;

    function openModal(handle, gemData) {
      qvModal.classList.add('is-open');
      document.body.style.overflow = 'hidden';

      // Show loading
      qvContent.innerHTML = '<div class="quick-view-modal__loading"><div class="spinner"></div></div>';

      fetch(`/products/${handle}.js`)
        .then(res => res.json())
        .then(product => {
          renderQuickView(product, gemData || {});
        })
        .catch(err => {
          qvContent.innerHTML = '<p class="error">Failed to load product details.</p>';
          console.error('Quick View Error:', err);
        });
    }

    function closeModal() {
      qvModal.classList.remove('is-open');
      document.body.style.overflow = '';
      setTimeout(() => {
        qvContent.innerHTML = '';
      }, 300);
    }

    function renderQuickView(product, gem) {
      gem = gem || {};
      const price = (product.price / 100).toLocaleString('en-IN', {
        style: 'currency',
        currency: 'INR',
        minimumFractionDigits: 0
      });

      const media = product.media || [];
      const description = product.description || '';

      // Build gem specs grid from data-* attributes set on the card's quick-view button
      const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
      const specRow = (label, value) => {
        if (value === undefined || value === null || value === '') return '';
        return `<div class="qv-spec-item"><span class="qv-spec-label">${esc(label)}</span><span class="qv-spec-value">${value}</span></div>`;
      };

      let weight = '';
      if (gem.weightCarats) weight += `${esc(gem.weightCarats)} Carat`;
      if (gem.weightRatti) weight += `${weight ? ' / ' : ''}${esc(parseFloat(gem.weightRatti).toFixed(2))} Ratti`;

      let shape = '';
      if (gem.shapeCut) shape = esc(gem.shapeCut);
      if (gem.cuttingStyle) shape += shape ? ` (${esc(gem.cuttingStyle)})` : esc(gem.cuttingStyle);

      let cert = '';
      if (gem.certLab) {
        cert = esc(gem.certLab);
        if (gem.certNumber) cert += ` : ${esc(gem.certNumber)}`;
        if (gem.certLink) cert += ` (<a href="${esc(gem.certLink)}" target="_blank" rel="noopener" style="color:var(--color-gold);text-decoration:underline;">Verify</a>)`;
      }

      const specsHtml = [
        specRow('Gem Type', gem.gemType ? esc(gem.gemType) : ''),
        specRow('Origin', gem.gemOrigin ? esc(gem.gemOrigin) : ''),
        specRow('Weight', weight),
        specRow('Shape / Cut', shape),
        specRow('Transparency', gem.transparency ? esc(gem.transparency) : ''),
        specRow('Color', gem.color ? esc(gem.color) : ''),
        specRow('Planet', gem.planet ? esc(gem.planet) : ''),
        specRow('Treatment', gem.treatment ? esc(gem.treatment) : ''),
        specRow('Dimensions', gem.dimensions ? `${esc(gem.dimensions)} mm` : ''),
        specRow('Species & Variety', gem.species ? esc(gem.species) : ''),
        specRow('Certification', cert)
      ].filter(Boolean).join('');

      // Generate Media HTML helper
      const getMediaHtml = (item) => {
        if (item.media_type === 'video') {
          return `<video src="${item.sources[0].url}" controls autoplay loop class="qv-video"></video>`;
        } else if (item.media_type === 'external_video') {
          const videoUrl = item.host === 'youtube' 
            ? `https://www.youtube.com/embed/${item.external_id}?autoplay=1`
            : `https://player.vimeo.com/video/${item.external_id}?autoplay=1&outro=nothing`;
          return `<iframe src="${videoUrl}" frameborder="0" allow="autoplay; fullscreen" allowfullscreen class="qv-video"></iframe>`;
        } else {
          const src = item.src || item.preview_image.src;
          return `<img src="${src}" alt="${item.alt || product.title}">`;
        }
      };

      // Initial media (all slides for carousel)
      let mediaItemsHtml = '';
      if (media.length > 0) {
        media.forEach(item => {
          mediaItemsHtml += `<div class="qv-media-item">${getMediaHtml(item)}</div>`;
        });
      } else {
        mediaItemsHtml = '<div class="qv-media-item"><div class="qv-placeholder">No Image</div></div>';
      }

      // Thumbnails
      let thumbsHtml = '';
      if (media.length > 1) {
        thumbsHtml = '<div class="qv-thumbs">';
        media.forEach((item, index) => {
          const thumbSrc = item.preview_image ? item.preview_image.src : item.src;
          const isVideo = item.media_type === 'video' || item.media_type === 'external_video';
          thumbsHtml += `
            <div class="qv-thumb ${index === 0 ? 'is-active' : ''} ${isVideo ? 'qv-thumb-video-icon' : ''}" data-index="${index}">
              <img src="${thumbSrc}" alt="Thumbnail ${index + 1}">
            </div>
          `;
        });
        thumbsHtml += '</div>';
      }

      qvContent.innerHTML = `
        <div class="qv-product animate-fadeIn">
          <div class="qv-media">
            <div class="qv-main-media" id="QVMainMedia">
              ${mediaItemsHtml}
            </div>
            ${thumbsHtml}
          </div>
          <div class="qv-details">
            <h2 class="qv-title">${product.title}</h2>
            <div class="qv-price">${price}</div>
            ${description ? `<div class="qv-description">${description}</div>` : ''}
            ${specsHtml ? `<div class="qv-specs-grid">${specsHtml}</div>` : ''}
            <div class="qv-actions">
              <a href="${product.url}" class="btn btn--primary qv-btn">VIEW FULL DETAILS</a>
              <button type="button" class="btn btn--secondary qv-btn" id="QVAddToCart">ADD TO CART</button>
            </div>
          </div>
        </div>
      `;

      // Add to Cart — same flow as the product page (POST to /cart/add.js with
      // the gem properties), instead of the wishlist selection flow that needs a
      // ring-size card that doesn't exist in the quick view.
      const qvAddBtn = qvContent.querySelector('#QVAddToCart');
      if (qvAddBtn) {
        qvAddBtn.addEventListener('click', function() {
          const variant = product.variants && product.variants[0];
          if (!variant) return;

          const properties = {};
          if (gem.weightCarats) {
            properties['Weight'] = `${gem.weightCarats} Carat`;
          } else if (gem.weightRatti) {
            properties['Weight (Ratti)'] = `${parseFloat(gem.weightRatti).toFixed(2)} Ratti`;
          }
          if (gem.gemOrigin) properties['Origin'] = gem.gemOrigin;
          if (gem.gemType) properties['Gem Type'] = gem.gemType;
          if (gem.shapeCut) properties['Shape / Cut'] = gem.shapeCut;
          if (gem.treatment) properties['Treatment'] = gem.treatment;
          if (gem.certLab) properties['_certification_lab'] = gem.certLab;

          const originalText = this.textContent;
          this.disabled = true;
          this.textContent = 'ADDING...';

          fetch('/cart/add.js', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items: [{ id: Number(variant.id), quantity: 1, properties: properties }] })
          })
            .then(res => { if (!res.ok) throw new Error('cart'); return res.json(); })
            .then(() => {
              this.textContent = '✓ ADDED TO CART';
              this.style.backgroundColor = '#27ae60';
              this.style.borderColor = '#27ae60';
              setTimeout(() => { window.location.href = '/cart'; }, 800);
            })
            .catch(err => {
              console.error('Quick View cart error:', err);
              this.textContent = 'Error — try again';
              this.disabled = false;
              setTimeout(() => { this.textContent = originalText; this.style.backgroundColor = ''; this.style.borderColor = ''; }, 2000);
            });
        });
      }

      // Carousel sync logic
      const mainMedia = qvContent.querySelector('#QVMainMedia');
      const thumbs = qvContent.querySelectorAll('.qv-thumb');
      if (!mainMedia) return;

      // Handle thumbnail clicks -> Scroll carousel
      thumbs.forEach(thumb => {
        thumb.addEventListener('click', function() {
          const index = parseInt(this.getAttribute('data-index'));
          const scrollWidth = mainMedia.offsetWidth;
          mainMedia.scrollTo({
            left: index * scrollWidth,
            behavior: 'smooth'
          });
        });
      });

      // Handle carousel scroll -> Sync thumbnails
      mainMedia.addEventListener('scroll', () => {
        const index = Math.round(mainMedia.scrollLeft / mainMedia.offsetWidth);
        thumbs.forEach((t, i) => {
          if (i === index) {
            t.classList.add('is-active');
            t.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
          } else {
            t.classList.remove('is-active');
          }
        });
      }, { passive: true });
    }

    // Delegation to handle dynamically loaded products
    document.body.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-quick-view]');
      if (btn) {
        e.preventDefault();
        const handle = btn.getAttribute('data-product-handle');
        // Pull gem metafield data that the card stamped onto the button.
        const gemData = {
          gemType: btn.dataset.gemType,
          gemOrigin: btn.dataset.gemOrigin,
          weightCarats: btn.dataset.gemWeightCarats,
          weightRatti: btn.dataset.gemWeightRatti,
          shapeCut: btn.dataset.gemShapeCut,
          cuttingStyle: btn.dataset.gemCuttingStyle,
          transparency: btn.dataset.gemTransparency,
          color: btn.dataset.gemColor,
          planet: btn.dataset.gemPlanet,
          certLab: btn.dataset.gemCertLab,
          certNumber: btn.dataset.gemCertNumber,
          certLink: btn.dataset.gemCertLink,
          treatment: btn.dataset.gemTreatment,
          dimensions: btn.dataset.gemDimensions,
          species: btn.dataset.gemSpecies,
        };
        openModal(handle, gemData);
      }
    });

    qvClose.forEach(btn => btn.addEventListener('click', closeModal));
  }

  // Expose utility functions globally
  window.PreciousCarats = {
    init: init,
    initScrollReveal: initScrollReveal
  };

})();

// =============================================
// Wishlist (localStorage-based)
// =============================================
(function() {
  'use strict';

  var STORAGE_KEY = 'precious_carats_wishlist';
  var REQUEST_PRICE_THRESHOLD = 100000000;
  var PREMIUM_FIXED_PAISE = 3500000;
  var METAL_ADD_PANCH = 300000;
  var METAL_ADD_COPPER = 300000;
  var METAL_ADD_SILVER = 400000;

  function getItems() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
    } catch(e) {
      return [];
    }
  }

  function saveItems(items) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    updateHeaderCount();
    syncButtons();
  }

  function findIndex(id) {
    var items = getItems();
    for (var i = 0; i < items.length; i++) {
      if (String(items[i].id) === String(id)) return i;
    }
    return -1;
  }

  function escapeWishlistHtml(s) {
    return String(s || '').replace(/[&<>"']/g, function(c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  function escapeWishlistAttr(s) {
    return escapeWishlistHtml(s);
  }

  function handleFromUrl(url) {
    var m = String(url || '').match(/\/products\/([^/?#]+)/);
    return m ? decodeURIComponent(m[1]) : '';
  }

  function parseMoneyToPaise(display) {
    if (!display) return null;
    var n = parseFloat(String(display).replace(/[^\d.]/g, ''));
    if (isNaN(n)) return null;
    return Math.round(n * 100);
  }

  function formatInrFromPaise(paise) {
    if (paise == null || isNaN(paise)) return '';
    var rupees = Math.round(paise) / 100;
    return 'Rs. ' + rupees.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function isPremiumMetal(metal) {
    return metal === 'gold' || metal === 'whitegold18' || metal === 'platinum950';
  }

  function computeQuotedTotalPaise(basePaise, metal) {
    if (basePaise == null || isNaN(basePaise)) return null;
    if (basePaise > REQUEST_PRICE_THRESHOLD) return basePaise;
    if (isPremiumMetal(metal)) return PREMIUM_FIXED_PAISE;
    if (metal === 'panchdhatu') return basePaise + METAL_ADD_PANCH;
    if (metal === 'copper') return basePaise + METAL_ADD_COPPER;
    if (metal === 'silver925') return basePaise + METAL_ADD_SILVER;
    return basePaise;
  }

  function buildMetalSelectHtml() {
    return ''
      + '<label class="wishlist-card__label">Mount metal</label>'
      + '<select class="wishlist-card__metal" aria-label="Mount metal">'
      + '<option value="panchdhatu">Panchdhatu (+ Rs. 3,000)</option>'
      + '<option value="copper">Copper (+ Rs. 3,000)</option>'
      + '<option value="silver925">Silver (925) (+ Rs. 4,000)</option>'
      + '<option value="gold">Gold (14K / 18K / 22K) — Rs. 35,000 flat fee</option>'
      + '<option value="whitegold18">White Gold (18K) — Rs. 35,000 flat fee</option>'
      + '<option value="platinum950">Platinum (950) — Rs. 35,000 flat fee</option>'
      + '</select>';
  }

  function buildRingSizeSelectHtml() {
    var sizes = [
      [8, 48.0], [9, 49.1], [10, 50.2], [11, 51.3], [12, 52.4], [13, 53.5], [14, 54.6], [15, 55.7],
      [16, 56.8], [17, 57.9], [18, 59.0], [19, 60.1], [20, 61.2], [21, 62.3], [22, 63.4], [23, 64.5], [24, 65.6], [25, 66.7], [26, 67.8]
    ];
    var o = '<label class="wishlist-card__label">Ring size</label>'
      + '<select class="wishlist-card__ring" aria-label="Ring size">'
      + '<option value="">Select ring size</option>';
    for (var i = 0; i < sizes.length; i++) {
      var sz = sizes[i][0];
      var mm = sizes[i][1].toFixed(1);
      var val = 'Indian size ' + sz + ' — inner circumference ' + mm + ' mm';
      o += '<option value="' + escapeWishlistAttr(val) + '">Size ' + sz + ' (' + mm + ' mm)</option>';
    }
    o += '</select>';
    return o;
  }

  function toast(msg) {
    var el = document.getElementById('wishlist-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'wishlist-toast';
      el.className = 'wishlist-toast';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add('is-visible');
    clearTimeout(window._wishlistToastTimer);
    window._wishlistToastTimer = setTimeout(function() {
      el.classList.remove('is-visible');
    }, 2000);
  }

  function toggle(btn) {
    var id = btn.getAttribute('data-product-id');
    var items = getItems();
    var idx = findIndex(id);
    var vp = btn.getAttribute('data-variant-price');
    var pricePaise = vp ? parseInt(vp, 10) : null;
    if (pricePaise == null || isNaN(pricePaise)) {
      pricePaise = parseMoneyToPaise(btn.getAttribute('data-product-price'));
    }

    if (idx > -1) {
      items.splice(idx, 1);
      toast('Removed from wishlist');
    } else {
      items.push({
        id: id,
        handle: btn.getAttribute('data-product-handle') || '',
        title: btn.getAttribute('data-product-title'),
        url: btn.getAttribute('data-product-url'),
        price: btn.getAttribute('data-product-price'),
        pricePaise: pricePaise,
        image: btn.getAttribute('data-product-image'),
        variantId: btn.getAttribute('data-variant-id'),
        addedAt: Date.now()
      });
      toast('Added to wishlist');
    }

    saveItems(items);
  }

  function remove(id) {
    var items = getItems();
    var idx = findIndex(id);
    if (idx > -1) {
      items.splice(idx, 1);
      saveItems(items);
    }
    renderPage();
  }

  function clearAll() {
    if (confirm('Remove all items from your wishlist?')) {
      saveItems([]);
      renderPage();
    }
  }

  function updateHeaderCount() {
    var count = getItems().length;
    var badge = document.getElementById('header-wishlist-count');
    if (badge) {
      badge.textContent = count;
      badge.style.display = count > 0 ? 'flex' : 'none';
    }
  }

  function syncButtons() {
    var items = getItems();
    var ids = items.map(function(item) { return String(item.id); });
    var buttons = document.querySelectorAll('[data-wishlist-toggle]');

    buttons.forEach(function(btn) {
      var bid = btn.getAttribute('data-product-id');
      if (ids.indexOf(bid) > -1) {
        btn.classList.add('is-wishlisted');
      } else {
        btn.classList.remove('is-wishlisted');
      }
    });
  }

  function resolveBasePaiseForItem(item, callback) {
    if (item.pricePaise != null && !isNaN(item.pricePaise)) {
      callback(item.pricePaise);
      return;
    }
    var h = item.handle || handleFromUrl(item.url);
    if (!h || !item.variantId) {
      callback(parseMoneyToPaise(item.price));
      return;
    }
    fetch('/products/' + encodeURIComponent(h) + '.js')
      .then(function(r) { return r.json(); })
      .then(function(data) {
        var p = data.product || data;
        var vs = (p && p.variants) ? p.variants : [];
        var vid = String(item.variantId);
        for (var i = 0; i < vs.length; i++) {
          if (String(vs[i].id) === vid) {
            callback(vs[i].price);
            return;
          }
        }
        callback(vs[0] ? vs[0].price : parseMoneyToPaise(item.price));
      })
      .catch(function() {
        callback(parseMoneyToPaise(item.price));
      });
  }

  function updateCardDisplayPrice(card) {
    var base = parseInt(card.getAttribute('data-base-paise'), 10);
    var live = card.querySelector('.wishlist-card__price-live');
    if (!live) return;
    live.textContent = !isNaN(base) ? formatInrFromPaise(base) : (card.getAttribute('data-fallback-price') || '');
  }

  function bindWishlistGridOnce() {
    var grid = document.getElementById('wishlist-grid');
    if (!grid || grid._wishlistDelegated) return;
    grid._wishlistDelegated = true;
    grid.addEventListener('change', function(e) {
      var t = e.target;
      if (!t.classList.contains('wishlist-card__metal') && !t.classList.contains('wishlist-card__ring')) return;
      var card = t.closest('.wishlist-card');
      if (card) updateCardDisplayPrice(card);
    });
  }

  function buildWishlistCardHtml(item, basePaise) {
    var title = item.title || 'Product';
    var url = item.url || '#';
    var fallbackPrice = item.price || '';
    var imgHtml = (item.image && item.image !== 'null')
      ? '<img src="' + escapeWishlistAttr(item.image) + '" alt="' + escapeWishlistAttr(title) + '" loading="lazy">'
      : '<div class="product-card__placeholder"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#ccc" stroke-width="1"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg></div>';

    var variantId = item.variantId || '';
    var isRequest = basePaise != null && basePaise > REQUEST_PRICE_THRESHOLD;
    var baseStr = basePaise != null && !isNaN(basePaise) ? String(basePaise) : '';
    var cardClass = 'product-card wishlist-card' + (isRequest ? ' wishlist-card--request' : '');

    var fieldsHtml = '';

    var actionsHtml = '<div class="wishlist-card__actions-row">'
      + (variantId && !isRequest
        ? '<button type="button" class="btn wishlist-card__buy">BUY NOW</button>'
        : '')
      + '<a href="' + escapeWishlistAttr(url) + '" class="btn btn--details">VIEW DETAILS</a>'
      + '</div>';

    return ''
      + '<div class="' + cardClass + '" data-wishlist-card="' + escapeWishlistAttr(item.id) + '" data-variant-id="' + escapeWishlistAttr(variantId) + '" data-base-paise="' + baseStr + '" data-fallback-price="' + escapeWishlistAttr(fallbackPrice) + '">'
      + '<div class="product-card__image-wrapper">'
      + '<a href="' + escapeWishlistAttr(url) + '" class="product-card__link" aria-label="' + escapeWishlistAttr(title) + '">'
      + '<div class="product-card__image">' + imgHtml + '</div></a>'
      + '<button type="button" class="wishlist-card__remove" onclick="WishlistApp.remove(\'' + escapeWishlistAttr(item.id) + '\')" aria-label="Remove from wishlist" title="Remove from wishlist">'
      + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>'
      + '</button></div>'
      + '<div class="product-card__info">'
      + '<a href="' + escapeWishlistAttr(url) + '" class="product-card__title-link"><h3 class="product-card__title">' + escapeWishlistHtml(title) + '</h3></a>'
      + '<div class="product-card__price wishlist-card__price-live">' + (basePaise != null ? formatInrFromPaise(basePaise) : fallbackPrice) + '</div>'
      + fieldsHtml
      + actionsHtml
      + '</div></div>';
  }

  function renderPage() {
    var grid = document.getElementById('wishlist-grid');
    var empty = document.getElementById('wishlist-empty');
    var actions = document.getElementById('wishlist-actions');
    var countText = document.getElementById('wishlist-count-text');

    if (!grid) return;

    bindWishlistGridOnce();

    var items = getItems();

    if (countText) {
      countText.textContent = items.length + (items.length === 1 ? ' item' : ' items');
    }

    if (items.length === 0) {
      grid.style.display = 'none';
      empty.style.display = 'block';
      if (actions) actions.style.display = 'none';
      return;
    }

    empty.style.display = 'none';
    grid.style.display = 'grid';
    if (actions) actions.style.display = 'flex';

    items = items.filter(function(item) { return item.title && item.title !== 'null'; });

    if (items.length === 0) {
      saveItems([]);
      grid.style.display = 'none';
      empty.style.display = 'block';
      if (actions) actions.style.display = 'none';
      if (countText) countText.textContent = '0 items';
      return;
    }

    var tasks = items.map(function(item) {
      return new Promise(function(resolve) {
        resolveBasePaiseForItem(item, function(paise) {
          resolve({ item: item, basePaise: paise });
        });
      });
    });

    Promise.all(tasks).then(function(rows) {
      var all = getItems();
      var changed = false;
      for (var k = 0; k < rows.length; k++) {
        var idx = findIndex(rows[k].item.id);
        if (idx > -1 && rows[k].basePaise != null && (all[idx].pricePaise == null || isNaN(all[idx].pricePaise))) {
          all[idx].pricePaise = rows[k].basePaise;
          if (!all[idx].handle) all[idx].handle = rows[k].item.handle || handleFromUrl(all[idx].url);
          changed = true;
        }
      }
      if (changed) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
      }

      var html = '';
      for (var i = 0; i < rows.length; i++) {
        html += buildWishlistCardHtml(rows[i].item, rows[i].basePaise);
      }
      grid.innerHTML = html;
      var cards = grid.querySelectorAll('.wishlist-card');
      for (var j = 0; j < cards.length; j++) {
        updateCardDisplayPrice(cards[j]);
      }

      grid.querySelectorAll('.wishlist-card__buy').forEach(function(btn) {
        btn.addEventListener('click', function() { handleBuyNow(btn); });
      });
    });
  }

  function initWishlist() {
    updateHeaderCount();
    syncButtons();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initWishlist);
  } else {
    initWishlist();
  }

  function readSelectionsFromCard(btn) {
    var card = btn.closest('.wishlist-card');
    if (!card) return null;
    var variantId = card.getAttribute('data-variant-id');
    var metalEl = card.querySelector('.wishlist-card__metal');
    var ringEl = card.querySelector('.wishlist-card__ring');
    var metal = metalEl ? metalEl.value : 'panchdhatu';
    var ring = ringEl ? ringEl.value : '';
    var base = parseInt(card.getAttribute('data-base-paise'), 10);
    return { card: card, variantId: variantId, metal: metal, ring: ring, basePaise: base };
  }

  function metalLabel(metal) {
    var map = {
      panchdhatu: 'Panchdhatu',
      copper: 'Copper',
      silver925: 'Silver (925)',
      gold: 'Gold (14K / 18K / 22K)',
      whitegold18: 'White Gold (18K)',
      platinum950: 'Platinum (950)'
    };
    return map[metal] || metal;
  }

  function postCartAdd(variantId, properties, btn, buyNow) {
    var originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = buyNow ? 'Redirecting…' : 'Adding…';

    fetch('/cart/add.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: [{ id: Number(variantId), quantity: 1, properties: properties }] })
    })
      .then(function(res) {
        if (!res.ok) throw new Error('cart');
        return res.json();
      })
      .then(function() {
        if (buyNow) {
          window.location.href = '/checkout';
          return;
        }
        btn.textContent = 'Added!';
        btn.style.background = '#27ae60';
        fetch('/cart.js')
          .then(function(r) { return r.json(); })
          .then(function(cart) {
            var cartCount = document.querySelector('.header__cart-count');
            if (cartCount) {
              cartCount.textContent = cart.item_count;
              cartCount.style.display = 'flex';
            }
          });
        setTimeout(function() {
          btn.textContent = originalText;
          btn.style.background = '';
          btn.disabled = false;
        }, 2000);
      })
      .catch(function() {
        btn.textContent = 'Error';
        setTimeout(function() {
          btn.textContent = originalText;
          btn.disabled = false;
        }, 2000);
      });
  }

  function handleAddToCart(btn) {
    var sel = readSelectionsFromCard(btn);
    if (!sel || !sel.variantId) return;
    if (!sel.ring) {
      toast('Please select a ring size');
      return;
    }
    var quoted = computeQuotedTotalPaise(sel.basePaise, sel.metal);
    var props = {
      'Metal': String(metalLabel(sel.metal)),
      'Ring size': String(sel.ring),
      'Quoted total (INR)': quoted != null ? String(formatInrFromPaise(quoted).replace(/^Rs\.\s*/, '')) : ''
    };
    if (isPremiumMetal(sel.metal)) {
      props['Payment note'] = 'Rs. 35,000 advance only. Balance per quotation on WhatsApp.';
    }
    postCartAdd(sel.variantId, props, btn, false);
  }

  function handleBuyNow(btn) {
    var sel = readSelectionsFromCard(btn);
    if (!sel || !sel.variantId) return;
    postCartAdd(sel.variantId, {}, btn, true);
  }

  function addToCart(variantId, btn) {
    if (!variantId || !btn) return;
    handleAddToCart(btn);
  }

  window.WishlistApp = {
    toggle: toggle,
    remove: remove,
    clearAll: clearAll,
    getItems: getItems,
    renderPage: renderPage,
    syncButtons: syncButtons,
    updateHeaderCount: updateHeaderCount,
    addToCart: addToCart,
    handleAddToCart: handleAddToCart,
    handleBuyNow: handleBuyNow
  };

})();
