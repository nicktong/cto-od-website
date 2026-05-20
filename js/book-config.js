/* ============================================================
   /book — configuration constants.

   Edit the placeholder values below before going live.
   ============================================================ */

(function () {
  'use strict';

  window.BOOK_CONFIG = {
    /* HubSpot Forms API.
       Region: na2 (informational — api.hsforms.com handles routing).
       Form check link: https://424ule.share-na2.hsforms.com/2fahT77mmRS2fJBGdK1rTLg */
    hubspot: {
      portalId: '245450210',
      formGuid: '7da853ef-b9a6-452d-9f24-119d2b5ad32e',
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
