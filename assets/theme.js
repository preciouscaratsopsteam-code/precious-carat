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

      // Hide nav bar on scroll down, show on scroll up
      if (navBar && currentScrollY > 200 && !navBar.classList.contains('is-open')) {
        if (currentScrollY > lastScrollY) {
          navBar.style.transform = 'translateY(-100%)';
          navBar.style.transition = 'transform 0.3s ease';
        } else {
          navBar.style.transform = 'translateY(0)';
        }
      } else if (navBar) {
        navBar.style.transform = 'translateY(0)';
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

    function openModal(handle) {
      qvModal.classList.add('is-open');
      document.body.style.overflow = 'hidden';
      
      // Show loading
      qvContent.innerHTML = '<div class="quick-view-modal__loading"><div class="spinner"></div></div>';

      fetch(`/products/${handle}.js`)
        .then(res => res.json())
        .then(product => {
          renderQuickView(product);
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

    function renderQuickView(product) {
      const price = (product.price / 100).toLocaleString('en-IN', {
        style: 'currency',
        currency: 'INR',
        minimumFractionDigits: 0
      });

      const media = product.media || [];
      const description = product.description ? product.description.replace(/<[^>]*>?/gm, '').substring(0, 200) + '...' : '';

      // Generate Media HTML helper
      const getMediaHtml = (item) => {
        if (item.media_type === 'video') {
          return `<video src="${item.sources[0].url}" controls autoplay loop class="qv-video"></video>`;
        } else if (item.media_type === 'external_video') {
          const videoUrl = item.host === 'youtube' 
            ? `https://www.youtube.com/embed/${item.external_id}?autoplay=1`
            : `https://player.vimeo.com/video/${item.external_id}?autoplay=1`;
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
            <div class="qv-description">${description}</div>
            <div class="qv-actions">
              <a href="${product.url}" class="btn btn--primary qv-btn">VIEW FULL DETAILS</a>
              <button class="btn btn--secondary qv-btn" onclick="WishlistApp.addToCart('${product.variants[0].id}', this)">ADD TO CART</button>
            </div>
          </div>
        </div>
      `;

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
        openModal(handle);
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
    console.log('Wishlist toggle clicked', btn.getAttribute('data-product-id'));
    var id = btn.getAttribute('data-product-id');
    var items = getItems();
    var idx = findIndex(id);

    if (idx > -1) {
      items.splice(idx, 1);
      toast('Removed from wishlist');
    } else {
      items.push({
        id: id,
        title: btn.getAttribute('data-product-title'),
        url: btn.getAttribute('data-product-url'),
        price: btn.getAttribute('data-product-price'),
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
      var id = btn.getAttribute('data-product-id');
      if (ids.indexOf(id) > -1) {
        btn.classList.add('is-wishlisted');
      } else {
        btn.classList.remove('is-wishlisted');
      }
    });
  }

  function renderPage() {
    var grid = document.getElementById('wishlist-grid');
    var empty = document.getElementById('wishlist-empty');
    var actions = document.getElementById('wishlist-actions');
    var countText = document.getElementById('wishlist-count-text');

    if (!grid) return; // not on wishlist page

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

    // Filter out stale/corrupted entries that have null title (saved before data-attrs fix)
    items = items.filter(function(item) { return item.title && item.title !== 'null'; });

    // If filtering emptied the list, update storage and show empty state
    if (items.length === 0) {
      saveItems([]);
      grid.style.display = 'none';
      empty.style.display = 'block';
      if (actions) actions.style.display = 'none';
      if (countText) countText.textContent = '0 items';
      return;
    }

    var html = '';
    items.forEach(function(item) {
      var title = item.title || 'Product';
      var url   = item.url   || '#';
      var price = item.price || '';
      var imgHtml = (item.image && item.image !== 'null')
        ? '<img src="' + item.image + '" alt="' + title + '" loading="lazy">'
        : '<div class="product-card__placeholder"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#ccc" stroke-width="1"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg></div>';

      var variantId = item.variantId || '';
      html += '<div class="product-card wishlist-card" data-wishlist-card="' + item.id + '">'
        + '<div class="product-card__image-wrapper">'
        + '<a href="' + url + '" class="product-card__link" aria-label="' + title + '">'
        + '<div class="product-card__image">' + imgHtml + '</div>'
        + '</a>'
        + '<button class="wishlist-card__remove" onclick="WishlistApp.remove(\'' + item.id + '\')" aria-label="Remove from wishlist" title="Remove from wishlist">'
        + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>'
        + '</button>'
        + '</div>'
        + '<div class="product-card__info">'
        + '<a href="' + url + '" class="product-card__title-link"><h3 class="product-card__title">' + title + '</h3></a>'
        + '<div class="product-card__price">' + price + '</div>'
        + '<div class="product-card__actions">'
        + (variantId
            ? '<button class="btn btn--primary wishlist-card__atc" onclick="WishlistApp.addToCart(\'' + variantId + '\', this)" data-variant-id="' + variantId + '">ADD TO CART</button>'
            : '')
        + '<a href="' + url + '" class="btn btn--details">VIEW DETAILS</a>'
        + '</div>'
        + '</div>'
        + '</div>';
    });

    grid.innerHTML = html;
  }

  // Init on DOM ready
  function initWishlist() {
    updateHeaderCount();
    syncButtons();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initWishlist);
  } else {
    initWishlist();
  }

  function addToCart(variantId, btn) {
    if (!variantId) return;
    var originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Adding...';

    fetch('/cart/add.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: variantId, quantity: 1 })
    })
    .then(function(res) { return res.json(); })
    .then(function() {
      btn.textContent = 'Added!';
      btn.style.background = '#27ae60';
      // Update cart count in header
      fetch('/cart.js')
        .then(function(r) { return r.json(); })
        .then(function(cart) {
          var cartCount = document.querySelector('.header__cart-count');
          if (cartCount) { cartCount.textContent = cart.item_count; cartCount.style.display = 'flex'; }
        });
      setTimeout(function() {
        btn.textContent = originalText;
        btn.style.background = '';
        btn.disabled = false;
      }, 2000);
    })
    .catch(function() {
      btn.textContent = 'Error';
      setTimeout(function() { btn.textContent = originalText; btn.disabled = false; }, 2000);
    });
  }

  // Expose globally
  window.WishlistApp = {
    toggle: toggle,
    remove: remove,
    clearAll: clearAll,
    getItems: getItems,
    renderPage: renderPage,
    syncButtons: syncButtons,
    updateHeaderCount: updateHeaderCount,
    addToCart: addToCart
  };

})();
