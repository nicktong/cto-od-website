import { test, expect } from '@playwright/test';

/**
 * E2E tests for /book.
 * See plan-book-page.md Decision #23 for the coverage matrix.
 */

/* Brief form now posts to our own serverless function at /api/book
   (which forwards to HubSpot Contacts API server-side). Tests intercept
   that endpoint directly so they run without needing `vercel dev`. */
const API_URL = /\/api\/book$/;

async function clearStorageAndConsent(page: import('@playwright/test').Page) {
  // Decline consent so the banner isn't covering form fields in subsequent tests.
  // Tests that specifically need the banner clear localStorage in their own block.
  await page.addInitScript(() => {
    try {
      localStorage.setItem('ctoondemand_analytics_consent', JSON.stringify({
        choice: 'declined',
        savedAt: new Date().toISOString(),
      }));
    } catch (e) { /* ignore */ }
  });
}

async function fillValidForm(page: import('@playwright/test').Page, overrides: Record<string, string> = {}) {
  await page.fill('#bfName', overrides.name ?? 'Test User');
  await page.fill('#bfEmail', overrides.email ?? 'test@example.com');
  await page.fill('#bfCompany', overrides.company ?? 'Acme Inc');
  await page.selectOption('#bfStage', overrides.stage ?? 'Seed');
  await page.fill('#bfSituation', overrides.situation ?? 'Test brief description.');
}

test.describe('/book — brief form', () => {

  test('1: form_happy_path — submit fills CRM via /api/book and shows success card', async ({ page }) => {
    await clearStorageAndConsent(page);
    // Mock /api/book to return 200.
    await page.route(API_URL, route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, contactId: 'test-contact-id' }),
    }));

    await page.goto('/book/');
    await fillValidForm(page);
    await page.click('button[type="submit"]');

    await expect(page.locator('#briefFormSuccess')).toBeVisible();
    await expect(page.locator('#briefFormSuccess h3')).toHaveText("Thanks. I'll be in touch.");
    // Form should be hidden after success
    await expect(page.locator('#briefForm')).toBeHidden();
  });

  test('2: form_validation_empty_required — empty submit focuses first invalid field', async ({ page }) => {
    await clearStorageAndConsent(page);
    await page.goto('/book/');
    await page.click('button[type="submit"]');

    // Form should still be visible, success/error hidden
    await expect(page.locator('#briefForm')).toBeVisible();
    await expect(page.locator('#briefFormSuccess')).toBeHidden();

    // First required field gets the has-error class
    await expect(page.locator('.form-field').first()).toHaveClass(/has-error/);
  });

  test('3: form_draft_restore — values pre-fill from recent localStorage draft', async ({ page }) => {
    await clearStorageAndConsent(page);
    await page.addInitScript(() => {
      localStorage.setItem('ctoondemand_book_form_draft', JSON.stringify({
        values: {
          name: 'Draft User',
          email: 'draft@test.com',
          company: 'Draft Co',
          stage: 'Series A',
          situation: 'Picked up from last visit.',
        },
        savedAt: new Date().toISOString(),
      }));
    });

    await page.goto('/book/');

    await expect(page.locator('#draftRestoredNote')).toBeVisible();
    await expect(page.locator('#bfName')).toHaveValue('Draft User');
    await expect(page.locator('#bfEmail')).toHaveValue('draft@test.com');
    await expect(page.locator('#bfStage')).toHaveValue('Series A');
    await expect(page.locator('#bfSituation')).toHaveValue('Picked up from last visit.');
  });

  test('4: form_draft_expiry — stale draft (>24h) silently discarded', async ({ page }) => {
    await clearStorageAndConsent(page);
    await page.addInitScript(() => {
      const stale = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
      localStorage.setItem('ctoondemand_book_form_draft', JSON.stringify({
        values: { name: 'Stale User' },
        savedAt: stale,
      }));
    });

    await page.goto('/book/');

    await expect(page.locator('#draftRestoredNote')).toBeHidden();
    await expect(page.locator('#bfName')).toHaveValue('');
    // Stale draft should have been removed from storage on load.
    const remaining = await page.evaluate(() =>
      localStorage.getItem('ctoondemand_book_form_draft')
    );
    expect(remaining).toBeNull();
  });

  test('5: form_honeypot_blocks_bot — fake-success shown, no network call', async ({ page }) => {
    await clearStorageAndConsent(page);
    let apiCalled = false;
    await page.route(API_URL, route => {
      apiCalled = true;
      route.fulfill({ status: 200, body: '{}' });
    });

    await page.goto('/book/');
    await fillValidForm(page);
    // Fill the honeypot the way a bot would.
    await page.evaluate(() => {
      const h = document.querySelector('input[name="_gotcha"]') as HTMLInputElement | null;
      if (h) h.value = 'bot-filled';
    });
    await page.click('button[type="submit"]');

    // Honeypot triggers a fake success path locally, no /api/book fetch.
    await expect(page.locator('#briefFormSuccess')).toBeVisible();
    expect(apiCalled).toBe(false);
  });

  test('6: form_api_4xx_error — error banner shown, form preserved', async ({ page }) => {
    await clearStorageAndConsent(page);
    await page.route(API_URL, route => route.fulfill({
      status: 422,
      contentType: 'application/json',
      body: JSON.stringify({ ok: false, error: 'validation_error', fields: ['email'] }),
    }));

    await page.goto('/book/');
    await fillValidForm(page);
    await page.click('button[type="submit"]');

    await expect(page.locator('#briefFormError')).toBeVisible();
    await expect(page.locator('#briefForm')).toBeVisible();
    // Submit button re-enabled
    await expect(page.locator('button[type="submit"]')).toBeEnabled();
    // Values preserved
    await expect(page.locator('#bfName')).toHaveValue('Test User');
  });

  test('7: form_network_offline — error banner shown when fetch rejects', async ({ page, context }) => {
    await clearStorageAndConsent(page);
    // Abort all API requests at the network layer to simulate offline.
    await page.route(API_URL, route => route.abort('failed'));

    await page.goto('/book/');
    await fillValidForm(page);
    await page.click('button[type="submit"]');

    await expect(page.locator('#briefFormError')).toBeVisible();
    await expect(page.locator('#briefForm')).toBeVisible();
  });

  test('8: calcom_embed_loads — iframe appears and skeleton class removed', async ({ page }) => {
    await clearStorageAndConsent(page);
    await page.goto('/book/');

    // Cal.com embed iframe should appear inside #calcom-embed
    const iframe = page.locator('#calcom-embed iframe');
    await expect(iframe).toBeAttached({ timeout: 15_000 });
    // Once loaded, the .calcom-skeleton class is removed by the MutationObserver
    await expect(page.locator('#calcom-embed')).not.toHaveClass(/calcom-skeleton/, { timeout: 15_000 });
  });

  test('9: calcom_fallback_on_script_block — fallback link visible when embed.js fails', async ({ page }) => {
    await clearStorageAndConsent(page);
    // Block cal.com's embed loader at the network level.
    await page.route('**/app.cal.com/embed/embed.js', route => route.abort());

    await page.goto('/book/');

    // Wait for the 10s fallback timer in book/index.html to fire and reveal #calcomFallback.
    await expect(page.locator('#calcomFallback')).toBeVisible({ timeout: 12_000 });
    await expect(page.locator('#calcomFallback')).toContainText(/book directly at cal\.com/i);
  });

  test('10: consent_banner_accept_loads_ga4 — Accept injects gtag', async ({ page }) => {
    // Don't pre-seed consent here — we want the banner to appear.
    await page.goto('/');
    const banner = page.locator('.consent-banner');
    await expect(banner).toBeVisible();
    await page.click('[data-consent="accept"]');
    await expect(banner).toBeHidden();
    // GA4 script tag should now be in the DOM
    await expect(page.locator('script[src*="googletagmanager.com/gtag"]')).toHaveCount(1, { timeout: 5_000 });
    // gtag function should be defined
    const gtagExists = await page.evaluate(() => typeof window.gtag === 'function');
    expect(gtagExists).toBe(true);
  });

  test('11: consent_banner_decline_no_ga4 — Decline never loads GA4', async ({ page }) => {
    await page.goto('/');
    const banner = page.locator('.consent-banner');
    await expect(banner).toBeVisible();
    await page.click('[data-consent="decline"]');
    await expect(banner).toBeHidden();
    // GA4 script should NOT be in the DOM
    await expect(page.locator('script[src*="googletagmanager.com/gtag"]')).toHaveCount(0);
    const gtagExists = await page.evaluate(() => typeof (window as any).gtag === 'function');
    expect(gtagExists).toBe(false);
  });
});

// Augment Window type for gtag check above
declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
  }
}
