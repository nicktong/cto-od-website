/* ============================================================
   /book — brief form logic.

   Responsibilities:
     - Restore form draft from localStorage on load (24h expiry)
     - Debounced auto-save on input (500ms)
     - Clear-draft link
     - HubSpot Forms API submit with error / loading / success states
     - Success card replaces form in-place + scrolls into view
     - Honeypot bot check
     - Fires analytics events via window.track (no-op if absent)
   ============================================================ */

(function () {
  'use strict';

  const cfg = window.BOOK_CONFIG;
  const storage = window.SafeStorage;
  const FIELD_NAMES = ['name', 'email', 'company', 'stage', 'situation'];

  function track(event, props) {
    if (typeof window.track === 'function') {
      window.track(event, props || {});
    }
  }

  function debounce(fn, wait) {
    let t;
    return function () {
      const ctx = this;
      const args = arguments;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(ctx, args); }, wait);
    };
  }

  function getFormValues(form) {
    const v = {};
    FIELD_NAMES.forEach(function (name) {
      const el = form.elements[name];
      if (el) v[name] = el.value;
    });
    return v;
  }

  function setFormValues(form, values) {
    FIELD_NAMES.forEach(function (name) {
      const el = form.elements[name];
      if (el && typeof values[name] === 'string') el.value = values[name];
    });
  }

  function saveDraft(form) {
    if (!storage) return;
    const values = getFormValues(form);
    const hasContent = Object.keys(values).some(function (k) { return values[k] && values[k].trim(); });
    if (!hasContent) {
      storage.remove(cfg.storageKeys.formDraft);
      return;
    }
    storage.set(cfg.storageKeys.formDraft, { values: values, savedAt: new Date().toISOString() });
  }

  function restoreDraft(form) {
    if (!storage) return false;
    const draft = storage.get(cfg.storageKeys.formDraft);
    if (!draft || !draft.values || !draft.savedAt) return false;
    const savedAt = new Date(draft.savedAt).getTime();
    if (isNaN(savedAt) || Date.now() - savedAt > cfg.draftMaxAgeMs) {
      storage.remove(cfg.storageKeys.formDraft);
      return false;
    }
    setFormValues(form, draft.values);
    return true;
  }

  function clearDraft() {
    if (storage) storage.remove(cfg.storageKeys.formDraft);
  }

  function showRestoredNote(container) {
    if (!container) return;
    container.hidden = false;
  }

  function hideRestoredNote(container) {
    if (!container) return;
    container.hidden = true;
  }

  function validateForm(form) {
    const errors = [];
    FIELD_NAMES.forEach(function (name) {
      const el = form.elements[name];
      if (!el) return;
      const row = el.closest('.form-field');
      if (row) row.classList.remove('has-error');
      if (el.required && !el.value.trim()) {
        errors.push({ name: name, el: el, message: 'This field is required.' });
        if (row) row.classList.add('has-error');
      } else if (el.type === 'email' && el.value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(el.value)) {
        errors.push({ name: name, el: el, message: 'Please enter a valid email.' });
        if (row) row.classList.add('has-error');
      }
    });
    return errors;
  }

  /* POST to our Vercel Serverless Function at /api/book. The function
     writes directly to HubSpot Contacts API with a Private App token
     (server-side env var). See api/book.js for the contract. */
  async function submitBrief(values) {
    const payload = {
      name: values.name || '',
      email: values.email || '',
      company: values.company || '',
      stage: values.stage || '',
      situation: values.situation || ''
    };
    const res = await fetch('/api/book', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const data = await res.json().catch(function () { return {}; });
      const err = new Error('Brief submit failed: ' + res.status);
      err.status = res.status;
      err.body = data;
      throw err;
    }
    return res.json().catch(function () { return null; });
  }

  function showSuccessCard(form, successCard, errorBanner) {
    if (errorBanner) errorBanner.hidden = true;
    if (form) form.hidden = true;
    if (successCard) {
      successCard.hidden = false;
      try { successCard.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
      catch (e) { successCard.scrollIntoView(); }
    }
  }

  function showErrorBanner(errorBanner) {
    if (!errorBanner) return;
    errorBanner.hidden = false;
    try { errorBanner.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    catch (e) { /* no-op */ }
  }

  function init() {
    const form = document.getElementById('briefForm');
    if (!form) return;
    const submitBtn = form.querySelector('[type="submit"]');
    const restoredNote = document.getElementById('draftRestoredNote');
    const clearLink = document.getElementById('clearDraftLink');
    const errorBanner = document.getElementById('briefFormError');
    const successCard = document.getElementById('briefFormSuccess');

    /* Restore draft if present + recent. */
    if (restoreDraft(form)) {
      showRestoredNote(restoredNote);
      track('book_form_draft_restored', {});
    }

    /* Auto-save on input, debounced. */
    const save = debounce(function () { saveDraft(form); }, 500);
    form.addEventListener('input', save);

    /* Clear-draft link. */
    if (clearLink) {
      clearLink.addEventListener('click', function (e) {
        e.preventDefault();
        FIELD_NAMES.forEach(function (n) {
          const el = form.elements[n];
          if (el) el.value = '';
        });
        clearDraft();
        hideRestoredNote(restoredNote);
        form.elements['name'].focus();
      });
    }

    /* First-field focus tracking. */
    let firstFocusTracked = false;
    form.addEventListener('focusin', function () {
      if (firstFocusTracked) return;
      firstFocusTracked = true;
      track('book_form_focus_first_field', {});
    });

    /* Submit. */
    form.addEventListener('submit', async function (e) {
      e.preventDefault();

      /* Honeypot — silent fake-success if bot fills it. */
      const honey = form.elements['_gotcha'];
      if (honey && honey.value) {
        showSuccessCard(form, successCard, errorBanner);
        clearDraft();
        return;
      }

      const values = getFormValues(form);

      /* Validate. */
      const errors = validateForm(form);
      if (errors.length > 0) {
        track('book_form_submit_attempt', { invalid: true, stage: values.stage || '' });
        if (errors[0].el && typeof errors[0].el.focus === 'function') errors[0].el.focus();
        return;
      }

      track('book_form_submit_attempt', { invalid: false, stage: values.stage || '' });

      /* Lock UI. */
      const originalLabel = submitBtn ? submitBtn.textContent : '';
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Sending…';
      }
      FIELD_NAMES.forEach(function (n) {
        const el = form.elements[n];
        if (el) el.disabled = true;
      });
      if (errorBanner) errorBanner.hidden = true;

      try {
        await submitBrief(values);
        clearDraft();
        track('generate_lead', { form_type: 'brief', stage: values.stage || '' });
        track('book_form_submit_success', { stage: values.stage || '' });
        showSuccessCard(form, successCard, errorBanner);
      } catch (err) {
        track('book_form_submit_error', {
          error_code: err.status || 0,
          error_kind: err.status ? (err.status >= 500 ? 'server' : 'validation') : 'network'
        });
        showErrorBanner(errorBanner);
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = originalLabel || 'Send the brief';
        }
        FIELD_NAMES.forEach(function (n) {
          const el = form.elements[n];
          if (el) el.disabled = false;
        });
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
