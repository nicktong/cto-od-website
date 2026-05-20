# Changelog

All notable changes to ctoondemand.co.uk are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
versioned as `MAJOR.MINOR.PATCH.MICRO` (4-digit) per the gstack convention.

## [0.2.0.0] - 2026-05-20

### Added
- **`/book` booking page** at `ctoondemand.co.uk/book`. Single landing destination
  that gives visitors two paths: send a structured brief, or pick a cal.com slot
  directly. Cold visitors get a one-paragraph "About Nick" strip with photo,
  three stats, and pill-links into `/about`, `/method`, `/services` for depth.
- **Brief form** with five fields (name, email, company, stage, situation) that
  posts to the **HubSpot Forms API** so leads land in the CRM, not an inbox.
  Honeypot blocks bots; validation focuses the first invalid field; submit
  disables the button during the in-flight request.
- **Inline cal.com embed** in the calendar section — visitors pick a slot without
  leaving `ctoondemand.co.uk`. Skeleton placeholder locks the iframe height to
  prevent layout shift, with a fallback link if the embed script fails to load.
- **Draft persistence** for the brief form: typed values save to `localStorage`
  with a 500ms debounce, restore on page load if less than 24 hours old, and
  display a "Draft restored" note with a one-click "Clear it" link.
- **Vercel Analytics + GA4** sitewide. Vercel Analytics fires unconditionally
  (privacy-friendly aggregate); GA4 (`G-7V1DS9J7KJ`) loads dynamically only
  after the visitor accepts the consent banner. Funnel events use GA4's
  recommended `generate_lead` for both form-submit-success and
  calendar-slot-selected paths.
- **Minimal cookie consent banner** — bottom-of-viewport strip with Accept /
  Decline pills. Choice persists in `localStorage` for 12 months.
- **Playwright E2E test infrastructure** (first time on this site). 12 tests
  covering form happy/error paths, draft restore/expiry, honeypot, cal.com
  embed + fallback, consent accept/decline, and the sitewide CTA reroute.
  GitHub Actions workflow runs the suite on every PR and push to main.
- **DESIGN.md** documenting the existing visual system: colour tokens,
  typography scale, button styles, `.hi` highlight pattern, photo treatment,
  form patterns, motion, accessibility baseline, and the AI-slop blacklist of
  patterns we deliberately don't use.
- **TODOS.md** with a CSP (Content-Security-Policy) hardening entry, deferred
  from the eng review as a P2 follow-up.
- **`vercel.json`** with clean URLs, basic security headers
  (X-Content-Type-Options, Referrer-Policy, Permissions-Policy), and cache
  headers for static assets.
- **`/book/` sitemap entry** at priority `0.95` — second only to the home page.

### Changed
- **Every "Book a Call" CTA across the site** now routes through `/book/`
  instead of jumping straight out to `cal.com/nick-tong-cto`. Topbar, sticky
  header, mobile menu, in-page CTAs across `/`, `/about`, `/services`,
  `/method`, `/ai-brain`, and every blog post — all rerouted. Single funnel,
  measurable from day one.
- **`.rc-form-row` inline CSS lifted** into a shared `.form-field` class in
  `styles.css`. The rate-card modal on `/services` now uses the same class as
  the `/book` brief form. Pixel-identical to before; DRY win.
- **`<site-header current="…">` accepts `"book"`** as a valid value. The
  attribute is set on `/book/index.html` for future-proofing; `/book` is
  intentionally NOT in the primary `NAV_ITEMS` array — it lives only as the
  header CTA pill button.

### Open follow-ups
- HubSpot portal ID and form GUID need to be filled into `js/book-config.js`
  before launch.
- Vercel deploy + DNS cutover from GitHub Pages.
- Confirm the cal.com event slug (currently `nick-tong-cto/30min`, which
  cal.com normalises to the event picker — exact event slug TBD).
