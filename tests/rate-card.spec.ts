import { test, expect } from '@playwright/test';

/**
 * E2E tests for the AI Brain rate card modal on /ai-brain.
 *
 * The modal POSTs JSON to /api/rate-card (Vercel serverless function that
 * upserts a HubSpot contact with lead_source = "ai-brain-rate-card").
 * Tests intercept that endpoint so they run without `vercel dev`.
 */
const API_URL = /\/api\/rate-card$/;

async function declineConsent(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('ctoondemand_analytics_consent', JSON.stringify({
        choice: 'declined',
        savedAt: new Date().toISOString(),
      }));
    } catch (e) { /* ignore */ }
  });
}

async function openModal(page: import('@playwright/test').Page) {
  await page.goto('/ai-brain/');
  await page.click('#rateCardOpen');
  await expect(page.locator('#rateCardModal')).toHaveClass(/is-open/);
}

test.describe('/ai-brain — rate card modal', () => {

  test('1: happy_path — submits JSON to /api/rate-card and shows success', async ({ page }) => {
    await declineConsent(page);

    let capturedRequest: { method: string; contentType: string | null; body: any } | null = null;
    await page.route(API_URL, async route => {
      const req = route.request();
      capturedRequest = {
        method: req.method(),
        contentType: req.headers()['content-type'] || null,
        body: req.postDataJSON(),
      };
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, contactId: 'test-contact-id' }),
      });
    });

    await openModal(page);
    await page.fill('#rcName', 'Jane Smith');
    await page.fill('#rcEmail', 'jane@example.com');
    await page.fill('#rcCompany', 'Acme Inc');
    await page.click('#rateCardSubmit');

    await expect(page.locator('#rateCardSuccess')).toBeVisible();
    await expect(page.locator('#rateCardForm')).toBeHidden();

    expect(capturedRequest).not.toBeNull();
    expect(capturedRequest!.method).toBe('POST');
    expect(capturedRequest!.contentType).toMatch(/application\/json/);
    expect(capturedRequest!.body).toMatchObject({
      name: 'Jane Smith',
      email: 'jane@example.com',
      company: 'Acme Inc',
    });
    // Honeypot always included, empty when human-submitted.
    expect(capturedRequest!.body._gotcha).toBe('');
  });

  test('2: validation_empty_required — empty submit blocked by native validation, no API call', async ({ page }) => {
    await declineConsent(page);
    let apiCalled = false;
    await page.route(API_URL, route => {
      apiCalled = true;
      route.fulfill({ status: 200, body: '{}' });
    });

    await openModal(page);
    await page.click('#rateCardSubmit');

    // Native required validation should keep the form visible.
    await expect(page.locator('#rateCardForm')).toBeVisible();
    await expect(page.locator('#rateCardSuccess')).toBeHidden();
    expect(apiCalled).toBe(false);
  });

  test('3: optional_company_omitted — submission works without company', async ({ page }) => {
    await declineConsent(page);

    let capturedBody: any = null;
    await page.route(API_URL, async route => {
      capturedBody = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, contactId: 'abc' }),
      });
    });

    await openModal(page);
    await page.fill('#rcName', 'Solo Founder');
    await page.fill('#rcEmail', 'solo@example.com');
    await page.click('#rateCardSubmit');

    await expect(page.locator('#rateCardSuccess')).toBeVisible();
    expect(capturedBody.company).toBe('');
  });

  test('4: api_error — error banner shown, form preserved, button re-enabled', async ({ page }) => {
    await declineConsent(page);
    await page.route(API_URL, route => route.fulfill({
      status: 502,
      contentType: 'application/json',
      body: JSON.stringify({ ok: false, error: 'hubspot_error', status: 500 }),
    }));

    await openModal(page);
    await page.fill('#rcName', 'Jane Smith');
    await page.fill('#rcEmail', 'jane@example.com');
    await page.click('#rateCardSubmit');

    await expect(page.locator('#rateCardError')).toBeVisible();
    await expect(page.locator('#rateCardForm')).toBeVisible();
    await expect(page.locator('#rateCardSubmit')).toBeEnabled();
    // Values preserved so the user can retry.
    await expect(page.locator('#rcName')).toHaveValue('Jane Smith');
    await expect(page.locator('#rcEmail')).toHaveValue('jane@example.com');
  });

  test('5: api_ok_false_payload — body says ok:false → treated as error', async ({ page }) => {
    await declineConsent(page);
    // 200 status but ok:false in body — still an error from the client's POV.
    await page.route(API_URL, route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: false, error: 'validation_error', fields: ['email'] }),
    }));

    await openModal(page);
    await page.fill('#rcName', 'Jane Smith');
    await page.fill('#rcEmail', 'jane@example.com');
    await page.click('#rateCardSubmit');

    await expect(page.locator('#rateCardError')).toBeVisible();
    await expect(page.locator('#rateCardSuccess')).toBeHidden();
  });

  test('6: network_offline — aborted fetch shows error banner', async ({ page }) => {
    await declineConsent(page);
    await page.route(API_URL, route => route.abort('failed'));

    await openModal(page);
    await page.fill('#rcName', 'Jane Smith');
    await page.fill('#rcEmail', 'jane@example.com');
    await page.click('#rateCardSubmit');

    await expect(page.locator('#rateCardError')).toBeVisible();
    await expect(page.locator('#rateCardForm')).toBeVisible();
  });

  test('7: form_action_attribute — points at /api/rate-card, not Formspree', async ({ page }) => {
    await declineConsent(page);
    await page.goto('/ai-brain/');
    const action = await page.locator('#rateCardForm').getAttribute('action');
    expect(action).toBe('/api/rate-card');
    expect(action).not.toContain('formspree');
  });
});
