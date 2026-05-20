/* ============================================================
   Site chrome — shared topbar, header, and mobile nav.
   Single source of truth for navigation across every page.

   Usage on any page:
     <script src="/js/site-chrome.js" defer></script>
     <site-topbar></site-topbar>
     <site-header current="home"></site-header>

   The `current` attribute on <site-header> highlights the active
   nav item. Valid values: home, method, services, ai-brain,
   about, blog, book. (`book` is intentionally NOT in the primary
   NAV_ITEMS array — it lives only as the header CTA pill — but
   the attribute is accepted for future-proofing.)
   Omit on pages with no match.
   ============================================================ */

(function () {
  'use strict';

  // Single source of truth for the nav structure.
  // Add or rename items in one place; every page updates.
  const NAV_ITEMS = [
    { id: 'method',   href: '/method/',    label: 'Method' },
    { id: 'services', href: '/services/',  label: 'How I Work' },
    { id: 'ai-brain', href: '/ai-brain/',  label: 'AI Brain' },
    { id: 'about',    href: '/about/',     label: 'About' },
    { id: 'blog',     href: '/blog/',      label: 'Blog' }
  ];

  /* Single funnel: every "Book a Call" CTA routes through /book where the
     visitor can either send a brief or pick a cal.com slot. The fallback
     cal.com link still exists inside /book/index.html itself if the embed
     fails to load. */
  const BOOK_URL = '/book/';

  // ── <site-topbar> ─────────────────────────────────────────
  class SiteTopbar extends HTMLElement {
    connectedCallback() {
      this.innerHTML = `
        <div class="topbar" role="region" aria-label="Availability announcement">
          <div class="container topbar-inner">
            <span class="topbar-dot" aria-hidden="true"></span>
            <span class="topbar-text">
              <strong>2 fractional CTO slots open for Q2.</strong> Booking discovery calls now.
            </span>
            <a href="${BOOK_URL}" class="topbar-cta">
              Book a call <span aria-hidden="true">→</span>
            </a>
          </div>
        </div>
      `;
    }
  }

  // ── <site-header> ─────────────────────────────────────────
  class SiteHeader extends HTMLElement {
    connectedCallback() {
      const current = this.getAttribute('current') || '';

      const desktopLinks = NAV_ITEMS.map(item => {
        const activeClass = item.id === current ? ' class="nav-active"' : '';
        return `<a href="${item.href}"${activeClass}>${item.label}</a>`;
      }).join('\n        ');

      const mobileLinks = NAV_ITEMS.map(item => {
        return `<a href="${item.href}" class="mobile-link">${item.label}</a>`;
      }).join('\n      ');

      this.innerHTML = `
        <header class="site-header" id="top">
          <div class="container header-inner">
            <a href="/" class="logo" aria-label="CTO on Demand – home">
              <span class="logo-tagline">CTO on Demand</span>
            </a>

            <nav class="nav-desktop" aria-label="Primary navigation">
              ${desktopLinks}
              <a href="${BOOK_URL}" class="btn btn-nav">Book a Call</a>
            </nav>

            <button class="hamburger" id="menuToggle" aria-label="Open navigation menu" aria-expanded="false" aria-controls="mobileMenu">
              <span></span><span></span><span></span>
            </button>
          </div>

          <nav class="nav-mobile" id="mobileMenu" aria-label="Mobile navigation">
            ${mobileLinks}
            <a href="${BOOK_URL}" class="mobile-link mobile-cta">Book a 30-minute Call</a>
          </nav>
        </header>
      `;

      // Wire up the mobile hamburger toggle.
      const toggle = this.querySelector('#menuToggle');
      const menu = this.querySelector('#mobileMenu');
      if (toggle && menu) {
        toggle.addEventListener('click', () => {
          const isOpen = menu.classList.toggle('is-open');
          toggle.classList.toggle('is-open', isOpen);
          toggle.setAttribute('aria-expanded', String(isOpen));
        });
        this.querySelectorAll('.mobile-link').forEach(link => {
          link.addEventListener('click', () => {
            menu.classList.remove('is-open');
            toggle.classList.remove('is-open');
            toggle.setAttribute('aria-expanded', 'false');
          });
        });
      }

      // Sticky header shadow on scroll.
      const header = this.querySelector('.site-header');
      if (header) {
        window.addEventListener('scroll', () => {
          header.classList.toggle('scrolled', window.scrollY > 8);
        }, { passive: true });
      }
    }
  }

  customElements.define('site-topbar', SiteTopbar);
  customElements.define('site-header', SiteHeader);
})();
