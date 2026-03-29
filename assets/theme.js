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
      menuToggle.addEventListener('click', function() {
        navBar.classList.toggle('is-open');
        
        // Change icon based on open state
        const iconSvg = this.querySelector('svg');
        if (navBar.classList.contains('is-open')) {
          iconSvg.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"></path>';
        } else {
          iconSvg.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" d="M4 6h16M4 12h16m-7 6h7"></path>';
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
  }

  // Run on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Expose utility functions globally
  window.PreciousCarats = {
    init: init,
    initScrollReveal: initScrollReveal
  };

})();
