import { test, expect } from '@playwright/test';

/**
 * Single E2E test verifying every "Book a Call" CTA across the site
 * routes through /book/ — never directly to cal.com.
 *
 * The two intentional cal.com fallback links live ONLY inside /book/
 * itself (noscript + JS fallback for when the embed fails). Every
 * other page must have zero cal.com/nick-tong-cto references.
 *
 * See plan-book-page.md Decision #6 (sitewide CTA routing).
 */

const PAGES = ['/', '/about/', '/services/', '/method/', '/ai-brain/', '/blog/'];

test('12: cta_reroute_all_pages — every Book a Call CTA on every page routes through /book/', async ({ page }) => {
  for (const path of PAGES) {
    await page.goto(path);

    // Find every Book a Call link by visible text — case-insensitive, partial match.
    const candidates = page.getByRole('link', { name: /book a call/i });
    const count = await candidates.count();
    expect(count, `${path} should have at least one "Book a Call" link`).toBeGreaterThan(0);

    for (let i = 0; i < count; i++) {
      const link = candidates.nth(i);
      const href = await link.getAttribute('href');
      expect(href, `${path} link #${i} ("Book a Call") href`).toBeTruthy();
      // Must NOT point to cal.com directly
      expect(href, `${path} link #${i}`).not.toContain('cal.com');
      // Must point to /book/ (absolute or relative)
      expect(href).toMatch(/^\/book\/?$|book\/?$/);
    }

    // Belt and braces: page source must have zero cal.com/nick-tong-cto strings
    const html = await page.content();
    expect(html, `${path} should have no cal.com/nick-tong-cto references`)
      .not.toContain('cal.com/nick-tong-cto');
  }
});
