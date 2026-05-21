/* ============================================================
   /book — configuration constants.

   Edit the placeholder values below before going live.
   ============================================================ */

(function () {
  'use strict';

  window.BOOK_CONFIG = {
    /* HubSpot CRM (informational only — actual submit goes through
       /api/book which authenticates server-side with HUBSPOT_TOKEN env
       var set in Vercel. See api/book.js for the contract). */
    hubspot: {
      portalId: '245450210',
      region:   'na2'
    },

    /* Cal.com inline embed — confirm slug (Open item O4). */
    calcom: {
      namespace: '30min',
      slug: 'nick-tong-cto/30min',
      brandColor: '#1756E8',
      layout: 'month_view',
      theme: 'light'
    },

    /* Analytics. */
    ga4: {
      measurementId: 'G-7V1DS9J7KJ'
    },

    /* localStorage keys. */
    storageKeys: {
      formDraft: 'ctoondemand_book_form_draft',
      consent:   'ctoondemand_analytics_consent'
    },

    /* Form draft retention (ms). */
    draftMaxAgeMs: 24 * 60 * 60 * 1000,

    /* Consent re-prompt cadence (ms). */
    consentMaxAgeMs: 365 * 24 * 60 * 60 * 1000
  };
})();
