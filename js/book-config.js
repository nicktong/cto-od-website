/* ============================================================
   /book — configuration constants.

   Edit the placeholder values below before going live.
   ============================================================ */

(function () {
  'use strict';

  window.BOOK_CONFIG = {
    /* HubSpot Forms API — fill these before launch (Open item O1). */
    hubspot: {
      portalId: 'REPLACE_WITH_HUBSPOT_PORTAL_ID',
      formGuid: 'REPLACE_WITH_HUBSPOT_FORM_GUID'
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
