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

  /* Vercel Web Analytics auto-injects the tracking script only when the project
     uses a supported framework (Next.js, Nuxt, SvelteKit, Astro, Remix). For
     plain static sites — what we are — we need to inject it ourselves. The
     script is served from the project's own origin at /_vercel/insights/script.js
     when Web Analytics is enabled in the Vercel dashboard. Outside Vercel
     (localhost, GitHub Pages) the script 404s harmlessly and window.va stays
     undefined — track() then no-ops cleanly. */
  function injectVercelAnalytics() {
    if (typeof window.va === 'function') return; // already auto-injected
    if (document.querySelector('script[src*="/_vercel/insights"]')) return; // already injected
    /* Define the stub Vercel's snippet uses so any track() calls fired before
       the script loads are queued and replayed once it does. */
    window.va = window.va || function () {
      (window.vaq = window.vaq || []).push(arguments);
    };
    const s = document.createElement('script');
    s.defer = true;
    s.src = '/_vercel/insights/script.js';
    document.head.appendChild(s);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectVercelAnalytics);
  } else {
    injectVercelAnalytics();
  }

  function fireVercel(eventName, props) {
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
