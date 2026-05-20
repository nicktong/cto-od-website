/* ============================================================
   Sitewide cookie consent banner.

   Behaviour:
     - First visit (or expired choice) → banner appears bottom of viewport.
     - "Accept"  → store choice, inject GA4 gtag.js dynamically.
     - "Decline" → store choice, banner dismissed; GA4 never loads.
     - Vercel Analytics fires either way (no third-party cookies).
     - Choice re-prompts after BOOK_CONFIG.consentMaxAgeMs (default 12mo).

   localStorage shape:
     ctoondemand_analytics_consent = { choice: "accepted"|"declined", savedAt: ISO }
   ============================================================ */

(function () {
  'use strict';

  const cfg = window.BOOK_CONFIG;
  const storage = window.SafeStorage;
  if (!cfg || !cfg.storageKeys || !cfg.ga4) return;

  const KEY = cfg.storageKeys.consent;
  const MAX_AGE = cfg.consentMaxAgeMs;
  const GA4_ID = cfg.ga4.measurementId;

  function readChoice() {
    if (!storage) return null;
    const v = storage.get(KEY);
    if (!v || !v.choice || !v.savedAt) return null;
    const savedAt = new Date(v.savedAt).getTime();
    if (isNaN(savedAt) || Date.now() - savedAt > MAX_AGE) {
      storage.remove(KEY);
      return null;
    }
    return v.choice;
  }

  function writeChoice(choice) {
    if (!storage) return;
    storage.set(KEY, { choice: choice, savedAt: new Date().toISOString() });
  }

  function injectGA4() {
    if (window.gtag || !GA4_ID || GA4_ID.indexOf('G-') !== 0) return;
    const s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(GA4_ID);
    document.head.appendChild(s);
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    window.gtag('config', GA4_ID, { anonymize_ip: true });
  }

  function buildBanner() {
    const wrap = document.createElement('div');
    wrap.className = 'consent-banner';
    wrap.setAttribute('role', 'region');
    wrap.setAttribute('aria-label', 'Cookie consent');
    wrap.innerHTML =
      '<div class="consent-banner-inner">' +
      '  <p class="consent-banner-text">We use cookies for analytics.</p>' +
      '  <div class="consent-banner-actions">' +
      '    <button type="button" class="btn btn-ghost btn-sm" data-consent="decline">Decline</button>' +
      '    <button type="button" class="btn btn-primary btn-sm" data-consent="accept">Accept</button>' +
      '  </div>' +
      '</div>';
    return wrap;
  }

  function show() {
    const banner = buildBanner();
    document.body.appendChild(banner);
    banner.querySelector('[data-consent="accept"]').addEventListener('click', function () {
      writeChoice('accepted');
      injectGA4();
      banner.remove();
      if (typeof window.track === 'function') window.track('consent_accepted', {});
    });
    banner.querySelector('[data-consent="decline"]').addEventListener('click', function () {
      writeChoice('declined');
      banner.remove();
      if (typeof window.track === 'function') window.track('consent_declined', {});
    });
  }

  function init() {
    const choice = readChoice();
    if (choice === 'accepted') {
      injectGA4();
    } else if (choice === 'declined') {
      /* Honour declined — never load GA4 this session. */
    } else {
      show();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
