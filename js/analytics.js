/* ============================================================
   Sitewide analytics shim.

   Exposes window.track(eventName, props) which dispatches to:
     - Vercel Analytics (auto-injected by Vercel; window.va when present)
     - GA4 via gtag (only loaded after consent — see consent-banner.js)

   Safe to call before either backend is ready — calls are silently
   buffered? No — we just no-op. Pages don't need to defensively
   check; they can call window.track('event', {...}) on init.
   ============================================================ */

(function () {
  'use strict';

  function fireVercel(eventName, props) {
    /* Vercel Analytics auto-injects window.va when deployed; manual call sites
       use `window.va('event', { name: '...', ...props })`. */
    if (typeof window.va === 'function') {
      try {
        window.va('event', Object.assign({ name: eventName }, props || {}));
      } catch (e) { /* swallow */ }
    }
  }

  function fireGA4(eventName, props) {
    if (typeof window.gtag === 'function') {
      try {
        window.gtag('event', eventName, props || {});
      } catch (e) { /* swallow */ }
    }
  }

  window.track = function (eventName, props) {
    if (!eventName) return;
    fireVercel(eventName, props);
    fireGA4(eventName, props);
  };
})();
