/* ============================================================
   Safe localStorage helper.

   Wraps every localStorage call in try/catch so the page keeps
   working in private browsing, when storage is disabled, or
   when the quota is exceeded. Stores JSON values transparently.

   Exposes: window.SafeStorage.{get, set, remove, available}.
   ============================================================ */

(function () {
  'use strict';

  function get(key) {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw === null) return null;
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  function set(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      return false;
    }
  }

  function remove(key) {
    try {
      window.localStorage.removeItem(key);
      return true;
    } catch (e) {
      return false;
    }
  }

  function available() {
    try {
      const probe = '__cto_storage_probe__';
      window.localStorage.setItem(probe, '1');
      window.localStorage.removeItem(probe);
      return true;
    } catch (e) {
      return false;
    }
  }

  window.SafeStorage = { get: get, set: set, remove: remove, available: available };
})();
