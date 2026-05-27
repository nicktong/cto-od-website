# TODOs

Deferred work captured from reviews. Each item has enough context to pick up
cold months later. Tick off when shipped.

---

## Funding stage as a structured HubSpot property (currently embedded in message)

**Status:** Open
**Deferred from:** /book serverless-bypass fix on 2026-05-20
**Surfaced by:** HubSpot MCP doesn't expose custom-property creation
**Priority:** P3 — quality-of-life, the data is captured either way

### What
Today /api/book writes the visitor's stage into the contact `message` field as
a `[Stage: Seed]\n\n…` prefix. That's a workaround. If we create
`funding_stage` as a custom contact property in HubSpot, /api/book can write
it as a first-class field, which makes it filterable in HubSpot views and
reportable in dashboards.

### How to do it
1. HubSpot → Settings → Properties → Create property → Object: Contact.
2. Label `Funding stage`, internal name `funding_stage`, type `Dropdown
   select`, options `Pre-seed`, `Seed`, `Series A`, `Scale-up`, `Other`.
3. In `api/book.js`, add `funding_stage: fields.stage` to the `properties`
   object inside `upsertContact()`.
4. Remove the `composeMessage()` stage prefix (or keep it as belt-and-braces).
5. Re-deploy.

### Trigger to revisit
The first time you find yourself wanting to filter contacts by funding stage
in HubSpot lists / reports.

---

## CSP (Content-Security-Policy) hardening

**Status:** Open
**Deferred from:** `/plan-eng-review` of /book on 2026-05-20
**Surfaced by:** Architecture review, finding A2 (cal.com iframe CSP risk)
**Priority:** P2 — security defence-in-depth, not blocking ship

### What

Add a Content-Security-Policy HTTP header to the site, scoped initially in
`Report-Only` mode for one week of telemetry, then flipped to enforce.

Header value (starting point — verify domains before enforcing):

```
Content-Security-Policy:
  default-src 'self';
  script-src 'self' 'unsafe-inline' app.cal.com cal.com *.googletagmanager.com vitals.vercel-insights.com;
  connect-src 'self' api.hsforms.com app.cal.com cal.com *.google-analytics.com vitals.vercel-insights.com;
  frame-src app.cal.com cal.com;
  img-src 'self' data: *.google-analytics.com;
  style-src 'self' 'unsafe-inline' fonts.googleapis.com;
  font-src 'self' fonts.gstatic.com;
  report-uri /api/csp-report;
```

Set via `vercel.json` headers config or via a Vercel Edge Function that
appends the header to every response.

### Why

Defence-in-depth against XSS. If any third-party script (HubSpot, cal.com,
GA4) is ever compromised, CSP limits what an attacker can exfiltrate or
inject. Today there is no XSS surface (no user-generated content rendered on
the page), but `/book` accepts a freeform textarea — that data only leaves
via HubSpot, but the surface area for future regressions is real.

### Pros

- Standard hardening for production web apps.
- Lighthouse "Best Practices" score improvement.
- Future-proofs the site against XSS regressions when we add more
  user-input surfaces.

### Cons

- Risk of breaking third-party widgets if a domain isn't whitelisted.
- Maintenance: every new third-party script needs a CSP update.
- The initial whitelist requires verification against actual cal.com /
  HubSpot / Vercel domains.

### Context

Deferred from /plan-eng-review because v1 of /book was already large (23
locked decisions, 13 implementation tasks, plus 12 Playwright tests).
Visiting later is safer once we have telemetry to confirm which domains the
site actually loads, and once the booking page is stable.

### How to approach when picking this up

1. Inventory all third-party domains the site loads today — DevTools →
   Network → group by domain. Cross-reference against the starting CSP above.
2. Add the header in `Report-Only` mode via `vercel.json`. Set up a small
   `/api/csp-report` edge function to log violations to a file or external
   service.
3. Watch reports for one week. Any unexpected domains → either whitelist
   them or remove the script.
4. Flip from `Content-Security-Policy-Report-Only` to
   `Content-Security-Policy` to enforce.
5. Add a Playwright test that asserts the CSP header is present and
   contains the key directives.

### Depends on / blocked by

- Vercel hosting must be live (after T8 in plan-book-page.md).
- Confirmed list of third-party domains in actual production use.

---

## Shared HubSpot upsert utility

**Status:** Open
**Deferred from:** /plan-ceo-review of marketing system on 2026-05-26
**Surfaced by:** Code quality review — three independent upsert implementations
**Priority:** P3 — not blocking, refactor when a fourth API lands

### What
`api/book.js`, `api/prompts.js`, and `api/waitlist.js` (new) each implement the
same HubSpot upsert pattern: POST contact, handle 409 with a GET+PATCH to merge.
Three copies of the pattern diverge over time. Extract to `api/_lib/hubspot.js`
as a shared utility callable by all serverless functions.

### How to do it
1. Create `api/_lib/hubspot.js` with `upsertContact(token, properties, mergeStrategy)`.
2. `mergeStrategy` handles the 409+PATCH per caller (prompts appends to message; book overwrites; waitlist sets new properties). Pass as a callback.
3. Update `api/book.js`, `api/prompts.js`, `api/waitlist.js` to import from `_lib`.
4. Run Playwright tests to verify book flow still works.

### Trigger to revisit
When a fourth API endpoint needs to write to HubSpot contacts.

---

## Rate limiting on api/waitlist.js

**Status:** Open
**Deferred from:** /plan-ceo-review of marketing system on 2026-05-26
**Surfaced by:** Security review — waitlist endpoint exposed to ad traffic
**Priority:** P3 — add before running paid ads at scale

### What
`api/waitlist.js` has a `_gotcha` honeypot for bot detection but no rate limiting.
A programmatic flood (e.g. from a scraped form URL) could create thousands of fake
HubSpot contacts. Add IP-based rate limiting via Vercel Edge Middleware.

### How to do it
1. Create `middleware.js` at repo root with a rate limiter for `/api/waitlist`.
2. Use `@vercel/kv` (Redis-backed) to track request count per IP per minute.
3. Return 429 after 20 requests/minute from same IP (conservative for ad traffic).
4. Alternative: add reCAPTCHA v3 to the course page form (no UX friction).

### Trigger to revisit
When monthly LinkedIn ad spend exceeds £500 or when HubSpot shows contact creation spikes.

---
