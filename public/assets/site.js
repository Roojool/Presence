/**
 * Presence. — Shared Site Script (Worker A Foundation)
 * Injects responsive header and footer into placeholders;
 * manages accessible mobile disclosure, Escape, focus trapping,
 * active route indicators, and editorial UI utilities.
 * Plain JS, zero dependencies, no fetching partials.
 */

(function () {
  'use strict';

  function getCurrentPage() {
    if (document.body && document.body.dataset && document.body.dataset.page) {
      return document.body.dataset.page.toLowerCase();
    }
    const path = window.location.pathname.toLowerCase().replace(/\/$/, '') || '/';
    if (path === '' || path === '/' || path.endsWith('/index.html')) return 'home';
    if (path.startsWith('/book')) return 'book';
    if (path.startsWith('/about')) return 'about';
    if (path.startsWith('/apply')) return 'apply';
    if (path.startsWith('/admin')) return 'admin';
    return '';
  }

  function buildHeaderHTML(activePage) {
    const isHome = activePage === 'home';
    const isBook = activePage === 'book';
    const isAbout = activePage === 'about';

    return `
      <a href="#main-content" class="skip-link" id="site-skip-link">Skip to main content</a>
      <div class="site-header-container">
        <a href="/" class="site-brand" aria-label="Presence — Home">
          <span class="site-brand-mark">
            <img src="/assets/lily-mark.svg" alt="" width="32" height="32" aria-hidden="true" />
          </span>
          <span class="site-brand-text">Presence<span class="brand-dot">.</span></span>
        </a>

        <nav class="site-nav" id="site-desktop-nav" aria-label="Primary Navigation">
          <ul class="site-nav-list">
            <li>
              <a href="/" class="site-nav-link ${isHome ? 'is-active' : ''}" data-nav="home" ${isHome ? 'aria-current="page"' : ''}>Home</a>
            </li>
            <li>
              <a href="/book" class="site-nav-link ${isBook ? 'is-active' : ''}" data-nav="book" ${isBook ? 'aria-current="page"' : ''}>Book an Hour</a>
            </li>
            <li>
              <a href="/about" class="site-nav-link ${isAbout ? 'is-active' : ''}" data-nav="about" ${isAbout ? 'aria-current="page"' : ''}>About</a>
            </li>
          </ul>
        </nav>

        <div class="site-header-actions">
          <a href="/book" class="btn btn-sm btn-primary site-header-cta">Book</a>
          <button type="button" class="site-menu-btn" id="site-menu-btn" aria-expanded="false" aria-controls="site-drawer" aria-label="Open navigation menu">
            <span class="site-menu-bar" aria-hidden="true"></span>
            <span class="site-menu-bar" aria-hidden="true"></span>
          </button>
        </div>
      </div>

      <div class="site-drawer" id="site-drawer" aria-label="Mobile Navigation" aria-hidden="true" role="dialog" aria-modal="true" inert>
        <div class="site-drawer-header">
          <a href="/" class="site-brand" aria-label="Presence — Home">
            <span class="site-brand-mark">
              <img src="/assets/lily-mark.svg" alt="" width="26" height="26" aria-hidden="true" />
            </span>
            <span class="site-brand-text">Presence<span class="brand-dot">.</span></span>
          </a>
          <button type="button" class="site-drawer-close" id="site-drawer-close" aria-label="Close navigation menu">
            <span aria-hidden="true">&times;</span>
          </button>
        </div>
        <nav class="site-drawer-nav">
          <ul class="site-drawer-list">
            <li>
              <a href="/" class="site-drawer-link ${isHome ? 'is-active' : ''}" data-nav="home" ${isHome ? 'aria-current="page"' : ''}>
                <span>Home</span>
                <span aria-hidden="true">&rarr;</span>
              </a>
            </li>
            <li>
              <a href="/book" class="site-drawer-link ${isBook ? 'is-active' : ''}" data-nav="book" ${isBook ? 'aria-current="page"' : ''}>
                <span>Book an Hour</span>
                <span aria-hidden="true">&rarr;</span>
              </a>
            </li>
            <li>
              <a href="/about" class="site-drawer-link ${isAbout ? 'is-active' : ''}" data-nav="about" ${isAbout ? 'aria-current="page"' : ''}>
                <span>About</span>
                <span aria-hidden="true">&rarr;</span>
              </a>
            </li>
          </ul>
        </nav>
        <div class="site-drawer-footer">
          <a href="/book" class="btn btn-primary btn-block">Book an Hour</a>
          <p class="site-drawer-note">Companion Service &middot; Fashion &amp; Brand Inquiries</p>
        </div>
      </div>
      <div class="site-backdrop" id="site-backdrop" aria-hidden="true"></div>
    `;
  }

  function buildFooterHTML() {
    const year = new Date().getFullYear();
    return `
      <div class="site-footer-container">
        <div class="site-footer-top">
          <div class="site-footer-brand">
            <a href="/" class="site-brand" aria-label="Presence — Home">
              <span class="site-brand-mark">
                <img src="/assets/lily-mark.svg" alt="" width="28" height="28" aria-hidden="true" />
              </span>
              <span class="site-brand-text">Presence<span class="brand-dot">.</span></span>
            </a>
            <p class="site-footer-tagline">
              Bespoke companion service and fashion/brand modeling inquiries.
            </p>
          </div>
        </div>
        <div class="site-footer-bottom">
          <p class="site-footer-copy">&copy; ${year} Presence. All rights reserved.</p>
          <p class="site-footer-status">
            <span class="status-dot" aria-hidden="true"></span>
            <span>Private &amp; Deliberate</span>
          </p>
        </div>
      </div>
    `;
  }

  function initHeader() {
    const header = document.getElementById('site-header');
    if (!header) return;

    const activePage = getCurrentPage();
    header.innerHTML = buildHeaderHTML(activePage);

    // Setup accessible skip-to-main link without breaking existing main-content ids
    const skipLink = document.getElementById('site-skip-link');
    const main = document.querySelector('main');
    if (main) {
      const targetId = main.id || 'main-content';
      if (!main.id) {
        main.id = targetId;
      }
      if (skipLink) {
        skipLink.setAttribute('href', '#' + targetId);
        skipLink.addEventListener('click', function () {
          if (!main.hasAttribute('tabindex')) {
            main.setAttribute('tabindex', '-1');
          }
          main.focus();
        });
      }
    }

    const menuBtn = document.getElementById('site-menu-btn');
    const drawer = document.getElementById('site-drawer');
    const drawerClose = document.getElementById('site-drawer-close');
    const backdrop = document.getElementById('site-backdrop');

    if (!menuBtn || !drawer || !backdrop) return;

    // Ensure mobile drawer is inert while closed initially
    drawer.setAttribute('inert', '');
    drawer.inert = true;

    let previousActiveElement = null;

    function openMenu() {
      previousActiveElement = document.activeElement;
      menuBtn.setAttribute('aria-expanded', 'true');
      menuBtn.setAttribute('aria-label', 'Close navigation menu');
      drawer.removeAttribute('inert');
      drawer.inert = false;
      drawer.setAttribute('aria-hidden', 'false');
      drawer.classList.add('is-open');
      backdrop.classList.add('is-active');
      document.body.classList.add('nav-open');

      if (drawerClose) {
        setTimeout(function () {
          drawerClose.focus();
        }, 50);
      }
    }

    function closeMenu(returnFocus) {
      if (returnFocus === void 0) returnFocus = true;
      menuBtn.setAttribute('aria-expanded', 'false');
      menuBtn.setAttribute('aria-label', 'Open navigation menu');
      drawer.setAttribute('aria-hidden', 'true');
      drawer.classList.remove('is-open');
      drawer.setAttribute('inert', '');
      drawer.inert = true;
      backdrop.classList.remove('is-active');
      document.body.classList.remove('nav-open');

      if (returnFocus && previousActiveElement && typeof previousActiveElement.focus === 'function') {
        previousActiveElement.focus();
      }
    }

    menuBtn.addEventListener('click', function () {
      const isOpen = menuBtn.getAttribute('aria-expanded') === 'true';
      if (isOpen) {
        closeMenu(true);
      } else {
        openMenu();
      }
    });

    if (drawerClose) {
      drawerClose.addEventListener('click', function () {
        closeMenu(true);
      });
    }

    backdrop.addEventListener('click', function () {
      closeMenu(true);
    });

    const drawerLinks = drawer.querySelectorAll('a');
    drawerLinks.forEach(function (link) {
      link.addEventListener('click', function () {
        closeMenu(false);
      });
    });

    document.addEventListener('keydown', function (e) {
      if (menuBtn.getAttribute('aria-expanded') !== 'true') return;

      if (e.key === 'Escape' || e.key === 'Esc') {
        e.preventDefault();
        closeMenu(true);
        return;
      }

      if (e.key === 'Tab') {
        const focusables = drawer.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
        if (!focusables.length) return;

        const firstEl = focusables[0];
        const lastEl = focusables[focusables.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === firstEl) {
            e.preventDefault();
            lastEl.focus();
          }
        } else {
          if (document.activeElement === lastEl) {
            e.preventDefault();
            firstEl.focus();
          }
        }
      }
    });

    window.addEventListener('resize', function () {
      if (window.innerWidth >= 860 && menuBtn.getAttribute('aria-expanded') === 'true') {
        closeMenu(false);
      }
    });

    let ticking = false;
    function onScroll() {
      if (!ticking) {
        window.requestAnimationFrame(function () {
          if (window.scrollY > 15) {
            header.classList.add('is-scrolled');
          } else {
            header.classList.remove('is-scrolled');
          }
          ticking = false;
        });
        ticking = true;
      }
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  function initFooter() {
    const footer = document.getElementById('site-footer');
    if (!footer) return;
    footer.innerHTML = buildFooterHTML();
  }

  const PresenceUI = {
    toast: function (message, type, durationMs) {
      if (type === void 0) type = 'info';
      if (durationMs === void 0) durationMs = 4000;

      let container = document.getElementById('presence-toast-container');
      if (!container) {
        container = document.createElement('div');
        container.id = 'presence-toast-container';
        container.setAttribute('aria-live', 'polite');
        document.body.appendChild(container);
      }

      const toast = document.createElement('div');
      toast.className = 'presence-toast notice-' + (type || 'info');
      toast.textContent = message;

      container.appendChild(toast);

      setTimeout(function () {
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
        toast.style.transform = 'translateY(8px)';
        setTimeout(function () {
          if (toast.parentNode) toast.parentNode.removeChild(toast);
        }, 320);
      }, durationMs);
    },

    setFieldError: function (fieldOrId, message) {
      const el = typeof fieldOrId === 'string' ? document.getElementById(fieldOrId) : fieldOrId;
      if (!el) return;

      el.setAttribute('aria-invalid', 'true');
      const parent = el.closest('.field, .form-group') || el.parentElement;
      if (parent) {
        parent.classList.add('has-error');
        let errEl = parent.querySelector('.field-error, .err');
        if (!errEl) {
          errEl = document.createElement('div');
          errEl.className = 'field-error';
          parent.appendChild(errEl);
        }
        errEl.textContent = message;
      }
    },

    clearFieldError: function (fieldOrId) {
      const el = typeof fieldOrId === 'string' ? document.getElementById(fieldOrId) : fieldOrId;
      if (!el) return;

      el.removeAttribute('aria-invalid');
      const parent = el.closest('.field, .form-group') || el.parentElement;
      if (parent) {
        parent.classList.remove('has-error');
        const errEl = parent.querySelector('.field-error, .err');
        if (errEl) errEl.textContent = '';
      }
    },

    clearAllErrors: function (scopeEl) {
      const root = scopeEl || document;
      root.querySelectorAll('[aria-invalid="true"]').forEach(function (el) {
        el.removeAttribute('aria-invalid');
      });
      root.querySelectorAll('.has-error').forEach(function (el) {
        el.classList.remove('has-error');
      });
      root.querySelectorAll('.field-error, .err').forEach(function (el) {
        el.textContent = '';
      });
    }
  };

  window.PresenceUI = PresenceUI;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      initHeader();
      initFooter();
    });
  } else {
    initHeader();
    initFooter();
  }
})();
