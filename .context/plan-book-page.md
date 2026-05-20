# Plan — /book booking page

**Branch:** `claude/magical-payne-fcfac3`
**Author:** Nick Tong (via /plan-design-review)
**Status:** In review

## Goal

Create `ctoondemand.co.uk/book` as a single dedicated landing page that gives a
visitor two paths to start working with Nick:

1. **Send a brief** — short qualifying form that lands in HubSpot CRM.
2. **Pick a time** — embedded cal.com calendar; visitor books a slot directly.

Cold visitors (who landed here without seeing the rest of the site) also get a
short "Who is Nick" strip with photo, three stats, and links into `/about`,
`/method`, `/services` for depth.

## Why this page

- Today every "Book a Call" CTA across the site links straight out to
  `cal.com/nick-tong-cto`. Visitors who would rather send context first have
  nowhere to do that. Visitors who want a slot keep what they have.
- The site can't currently measure the booking funnel — no analytics. We don't
  know which pages drive bookings, which pages have CTAs that never convert, or
  whether the form-first or calendar-first path is preferred.
- Briefs that arrive by email are unstructured and don't make it into HubSpot.
  Moving them into CRM means follow-ups, stage-tracking, and pipeline reporting
  all work out of the box.

## Locked decisions

| # | Decision | Choice | Rationale |
|---|---|---|---|
| 1 | Page hierarchy | **Form first, embedded calendar second** | Visitor who wants to give context gets it above the fold. Visitor who knows they just want a slot scrolls one screen. |
| 2 | Cal.com presentation | **Inline embed** (cal.com's official embed script) | Visitor never leaves `ctoondemand.co.uk` to book. Single page, one funnel, one set of analytics events. |
| 3 | Form backend | **Custom-styled form → HubSpot Forms API** (`api.hsforms.com/submissions/v3/integrations/submit/{portalId}/{formId}`) | Keeps the existing visual language (rate-card form style). Contact lands in HubSpot CRM, not just email. Needs portal ID + form GUID — Nick to provide before implementation. |
| 4 | Form fields | **Qualified set** — name, email, company, stage (Pre-seed / Seed / Series A / Scale-up / Other), what's going on (textarea) | ~5 fields. Enough to triage; few enough to keep submission rate up. |
| 5 | About-Nick strip | **One-paragraph + photo + 3 stats + "Read more about Nick →"** | Mirrors `/about` hero in miniature. Cold visitor gets credibility in 5 seconds without competing with `/about`. |
| 6 | Sitewide CTA routing | **All "Book a Call" CTAs route through `/book`** | Single funnel. Every CTA lands on the page where the visitor can choose. Updates topbar, site-header, every page CTA, every footer link. |
| 7 | Analytics | **Vercel Analytics + GA4** | Vercel gives no-cookie pageview/event data fast; GA4 gives funnel + acquisition + Search Console linkage. One consent banner. |
| 8 | Hosting | **Move from GitHub Pages to Vercel** (implied by Vercel Analytics + Vercel MCP already wired) | Required for Vercel Analytics. CNAME `ctoondemand.co.uk` re-points. Confirm before flipping DNS. |
| 9 | Hero proportions | **Calm hero — form starts just below the fold** | Matches the editorial rhythm of /about, /method, /services. Hero padding `clamp(4rem, 7vw, 6rem)` top, `clamp(3rem, 5vw, 5rem)` bottom (same as /index hero). Visitor sees eyebrow + h1 + lead on first paint; scrolls once to the form. |
| 10 | Form draft persistence | **Save all form values to localStorage on input; restore on load; clear on successful submit** | Standard pattern. ~30 lines of JS in `/js/book-form.js`. Restored draft shows a small grey "Draft restored" note above the form with a "Clear" link. Cleared key: `ctoondemand_book_form_draft`. Cleared automatically on `book_form_submit_success`. |
| 11 | Cookie banner | **Minimal bottom strip, "Accept / Decline" pill buttons** | Single line: "We use cookies for analytics. Accept / Decline." Bottom-of-viewport, ~60px desktop, ~80px mobile, white bg with `--shadow-md` lift, navy text. Vercel Analytics fires on every visit (privacy-friendly aggregate, no consent needed under UK GDPR). GA4 script only loads on Accept. Choice stored in `localStorage` key `ctoondemand_analytics_consent` (`accepted` / `declined`). Re-show after 12 months. |
| 12 | HubSpot 429 / error UX | **Standard error treatment — banner above form, ask user to retry** | "We couldn't send this. Check your connection and try again, or email Nick directly." Same path for network errors, 5xx, and 429. Visitor retries manually. HubSpot rate-limit is 10 req/sec per portal — never expected to hit it. |
| 13 | Content-Security-Policy | **No CSP in v1** | Deferred to TODOs.md (see end of plan). Static HTML, no user-generated content displayed on the page, low XSS surface in v1. Add later in Report-Only mode for safe rollout. |
| 14 | GA4 + Vercel Analytics load order | **Vercel Analytics in HTML statically; GA4 injected dynamically by consent banner JS on Accept** | Guarantees zero GA4 hits before consent. Consent-banner JS owns the GA4 `<script>` tag injection. Vercel Analytics is privacy-friendly aggregate, fires unconditionally. **GA4 measurement ID: `G-7V1DS9J7KJ`** (O2 closed). |
| 15 | GH Pages → Vercel migration | **No legacy URL redirects** | `nicktong.github.io/cto-od-website/*` was never canonical — `ctoondemand.co.uk` always was. DNS flip is silent. |
| 16 | Form draft privacy | **Save all fields, auto-expire after 24h, "Clear draft" link visible on restore** | `localStorage` key stores `{ values: {…}, savedAt: ISO8601 }`. On load, discard silently if `Date.now() - savedAt > 86400_000`. Mitigates shared-computer privacy risk while preserving the "I refreshed by accident" use case. ~5 extra lines vs Decision #10's original. |
| 17 | GA4 event names | **GA4 recommended names where they exist; custom names elsewhere** | `book_form_submit_success` and `book_calendar_slot_selected` → `generate_lead` (with `form_type` parameter to distinguish). `book_page_view` → `page_view` (GA4 fires this automatically). Custom events stay custom: `book_form_focus_first_field`, `book_form_submit_attempt`, `book_form_submit_error`, `book_calendar_loaded`, `book_cta_click_*`. |
| 18 | localStorage unavailable (private browsing) | **Wrap all localStorage in try/catch via `/js/storage.js` helper; degrade silently** | `safeGet(key)`, `safeSet(key, value)`, `safeRemove(key)` swallow exceptions. Consent banner re-shows every visit (acceptable). Draft doesn't save (acceptable). Page still works. ~15-line helper module. Used by both `/js/consent-banner.js` and `/js/book-form.js`. |
| 19 | `.form-row` lift | **Move to shared `.form-row` in styles.css; update rate-card to use new class** | DRY win. Before/after screenshot of rate-card modal in `/services` to verify no visual diff. Inline `<style>` block in [services/index.html:257-272](services/index.html:257) removed. |
| 20 | JS module pattern | **IIFE + `defer` (matches `js/site-chrome.js`)** | Each new JS file is `(function(){ 'use strict'; ... })();`. Globals exposed: `window.BOOK_CONFIG`, `window.track`, `window.consent`. Load order in HTML `<head>`: `book-config.js` → `storage.js` → `consent-banner.js` → `analytics.js` → `book-form.js`, all `defer`. |
| 21 | Cal.com iframe CLS | **Skeleton placeholder with locked height: 620px desktop, 560px mobile** | Matches plan's responsive table. Iframe replaces skeleton in-place with no reflow. CLS contribution ~0 for the calendar section. Skeleton uses cream alt bg + a subtle pulsing rectangle to signal loading. |
| 22 | Form draft debounce | **500ms** | Standard autosave cadence. Visitor types a sentence, save fires once after the pause. Implementation: `lodash.debounce` would be overkill — hand-roll with `setTimeout` / `clearTimeout` (~6 lines). |
| 23 | Test infrastructure | **Playwright with 12 E2E tests for /book + CTA reroute** | First test infra on the site. Introduces: `package.json`, `node_modules/`, `playwright.config.ts`, `tests/book.spec.ts`, `.github/workflows/playwright.yml`, `package-lock.json`. CI runs on every PR. Test coverage matrix below. |

### Playwright E2E test coverage (locked decision #23)

| # | Test name | What it verifies | File |
|---|---|---|---|
| 1 | `form_happy_path` | Fill 5 valid fields → submit → success card visible → scrolled into view → no console errors | `tests/book.spec.ts` |
| 2 | `form_validation_empty_required` | Submit empty form → error summary visible → first invalid field focused → submit re-enabled | `tests/book.spec.ts` |
| 3 | `form_draft_restore` | Fill 3 fields → reload page → "Draft restored" note visible → fields pre-filled | `tests/book.spec.ts` |
| 4 | `form_draft_expiry` | Set `savedAt` to >24h ago in localStorage → reload → draft silently discarded → no note | `tests/book.spec.ts` |
| 5 | `form_honeypot_blocks_bot` | Fill `_gotcha` via JS → submit → fake success shown → no network call to HubSpot endpoint | `tests/book.spec.ts` |
| 6 | `form_hubspot_4xx_error` | Mock HubSpot to return 422 → submit → error banner visible → fields retain values | `tests/book.spec.ts` |
| 7 | `form_network_offline` | `page.context().setOffline(true)` → submit → error banner visible | `tests/book.spec.ts` |
| 8 | `calcom_embed_loads` | Wait for cal.com iframe → assert `[data-cal-namespace]` exists → `book_calendar_loaded` event fires | `tests/book.spec.ts` |
| 9 | `calcom_fallback_on_script_block` | Block `app.cal.com/embed/embed.js` → assert fallback link "Calendar didn't load…" visible | `tests/book.spec.ts` |
| 10 | `consent_banner_accept_loads_ga4` | First visit (localStorage cleared) → banner visible → click Accept → GA4 script tag injected | `tests/book.spec.ts` |
| 11 | `consent_banner_decline_no_ga4` | First visit → click Decline → banner dismissed → no GA4 script tag | `tests/book.spec.ts` |
| 12 | `cta_reroute_all_pages` | For each of `/`, `/about/`, `/services/`, `/method/`, `/ai-brain/` — click every "Book a Call" link, assert target is `/book` (NOT `cal.com`) | `tests/cta-reroute.spec.ts` |

**CI workflow** (`.github/workflows/playwright.yml`): runs on every PR + every push to `main`. Uses Playwright's official action. Matrix: chromium only in v1 (firefox/webkit later if cross-browser bugs surface). Reports uploaded as artifacts on failure.

## Page structure (final)

```
┌─ <site-topbar>  ─────────────────────────────────────────────────┐
│  "2 fractional CTO slots open for Q2."  →  Book a call           │
├─ <site-header current="book">  ──────────────────────────────────┤
│  CTO on Demand        Method · How I Work · AI Brain · About · Blog    [Book a Call] │
├─ HERO  ──────────────────────────────────────────────────────────┤
│   eyebrow: "Let's talk"                                          │
│   h1:       Send a brief, or pick a time.                        │
│   lead:     A 30-minute discovery call. No pitch, no deck —      │
│             an honest read on whether and how I can help.        │
├─ FORM SECTION (section, primary)  ───────────────────────────────┤
│   h2: Tell me what's going on (.hi on "what's going on")         │
│   Brief form (single column, max-width ~560px, centred):         │
│     • Name *                                                      │
│     • Email *                                                     │
│     • Company *                                                   │
│     • Stage * (select: Pre-seed / Seed / Series A / Scale-up /    │
│       Other)                                                      │
│     • What's the situation? * (textarea, ~6 rows)                 │
│     • Honeypot (hidden)                                           │
│     [Send the brief]  ←  .btn-primary                            │
│   Below CTA, small grey: "I read every brief myself. You'll       │
│   hear back within one working day."                             │
├─ DIVIDER  ───────────────────────────────────────────────────────┤
│   "Or grab a slot directly →"  (visual rule + label)             │
├─ CALENDAR SECTION (section-alt)  ────────────────────────────────┤
│   h2: Pick a time that works (.hi on "works")                    │
│   lead: 30 minutes. Wherever you are in the world.               │
│   [ Cal.com inline embed — full width within container,          │
│     min-height ~620px, light theme matching cream bg ]           │
├─ ABOUT-NICK STRIP (section)  ────────────────────────────────────┤
│   2-col grid (stacks on mobile):                                  │
│     LEFT  → photo (rounded, same treatment as /about)            │
│              3 stats below: 25+ Years · Seed–A · Tech for good   │
│     RIGHT → "If you've landed here cold" h3                      │
│              one-paragraph bio: 25+ years, Unmind, Vault,        │
│              fractional now, tech-for-good focus                 │
│              Three pill-links: About Nick → /about               │
│                                The Method → /method              │
│                                How I Work → /services            │
├─ <site-footer>  ─────────────────────────────────────────────────┤
└──────────────────────────────────────────────────────────────────┘
```

## Information architecture

**What the visitor sees in the first 5 seconds:**
1. Eyebrow "Let's talk" → confirms they're in the right place.
2. h1 "Send a brief, or pick a time." → states the two paths immediately.
3. Lead → reframes "what is this call" so they know what they're signing up for.
4. Above the fold on most viewports: the start of the form.

**What they see in 30 seconds of scanning:**
- Form → calendar → about-Nick. Each section has one job (Krug: trunk test
  passes — cover everything except the section heading and you can still tell
  what each section does).

**What they see if they came cold:**
- Hero gives just enough framing to know it's a CTO booking page.
- About-Nick strip after the two CTAs gives the credibility hit, with three
  clear paths into the rest of the site.
- The dominant cold-arrival route is a LinkedIn DM linking directly to
  `/book` — designed for that case first, with the rest of the site (`/about`,
  `/method`, `/services`) one click away via the about-strip pill-links.

**About-strip pill-link order (intentional):**
1. **About Nick →** first — answers the most likely cold-visitor question:
   "who am I about to book?"
2. **The Method →** second — answers the next question: "how does he work?"
3. **How I Work →** third — pricing / ladder / engagement shape; only the
   self-qualified visitor clicks this far.

**Mobile reflow order** (top to bottom on a 390px viewport): topbar → header
→ hero → form → divider → embedded calendar → about-Nick (photo on top,
text below, pill-links full-width stacked) → footer. Order is identical to
desktop; only column counts change.

## Interaction states

| Surface | Loading | Empty | Error | Success | Partial |
|---|---|---|---|---|---|
| Brief form (before submit) | n/a | Placeholder labels visible; clear required-field asterisks | Inline per-field error in red below input: "Please enter your email" — `aria-describedby` linked. Error summary banner above submit on validation fail (focus moves to summary, accessibility) | Submit button shows spinner + "Sending…" (disabled), then form swap → success card | If HubSpot API returns non-200: "We couldn't deliver this — please email Nick directly at [obfuscated address]. Your message: [textarea contents preserved]" |
| Brief form (during submit) | Submit button shows inline spinner + "Sending…" text, button is `disabled` (prevents double-submit). All form fields are also `disabled` while in-flight. Submit takes ~300–800ms typical | n/a | If `fetch` rejects (offline, network drop, CORS): same error treatment as 500 — banner above form: "We couldn't send this. Check your connection and try again, or email Nick directly." Form fields remain editable; submit re-enabled | n/a | n/a |
| Brief form (after submit, success) | n/a | n/a | n/a | Form replaced in-place with a checkmark card: thin SVG line-icon check in `--clr-accent` (matching DESIGN.md §9 — no generic filled-circle tick), "Thanks. I'll be in touch within one working day. — Nick" body, role="status" + aria-live="polite". Below: a soft "Want a slot in the meantime?" with an anchor link `#calendar` that scrolls to the embedded calendar. **On submit success, scroll the page so the success card top is in view** — `success-card.scrollIntoView({ behavior: 'smooth', block: 'start' })` — otherwise mobile visitors with the submit button below the fold see no change | n/a |
| Cal.com embed | Skeleton placeholder (cream background, same height as the loaded embed — prevents layout shift). Cal.com's own loading state shows inside the iframe once it boots | Cal.com handles "no availability" state itself (their UI) | If the embed script fails to load (network/CSP blocked), show a fallback: "Calendar didn't load — book directly at cal.com/nick-tong-cto →" | Cal.com handles confirmation inside the iframe | If cal.com is rate-limited / slow, our skeleton stays visible; we don't have a 10-second timeout fallback in v1 |
| About-Nick strip | n/a (static) | n/a | n/a | n/a | If photo fails to load: photo placeholder div keeps its dimensions, no broken-image icon (`onerror="this.style.display='none'"` on the parent, fall back to initials avatar) |
| Analytics consent | First-visit cookie banner (Vercel Analytics doesn't need consent; GA4 does under UK GDPR). "Accept" / "Decline" / "Settings" | n/a | If GA4 blocked by content-blocker, page still works, Vercel Analytics still fires | Banner dismissed; consent stored in `localStorage`; GA4 script loads | If declined: GA4 never loads; Vercel Analytics continues (privacy-friendly aggregate only) |

## User journey & emotional arc

| Step | User does | User feels | Plan supports it with |
|---|---|---|---|
| 1 | Clicks "Book a Call" from any site CTA, or lands on `/book` direct from a LinkedIn DM | "Right, let's see what this is" | Hero immediately frames the page: two paths, no pitch |
| 2 | Decides between form vs calendar | "How do I want to start?" | Form is visible first (default path); divider explicitly offers the other route. Both equally valid, neither hidden |
| 3a | Fills the form | "Am I being asked the right amount?" | 5 fields. Stage select pre-qualifies without being intrusive. Textarea label is "What's the situation?" not "How can we help you?" — direct, like the rest of the site |
| 3b | Picks a slot | "Just give me a time" | Calendar loads inline. No second click out to another domain. Visitor stays on `ctoondemand.co.uk` end-to-end |
| 4 | Submits / books | "Did it work?" | Form: in-place success card with personal sign-off. Calendar: cal.com's own confirmation + email |
| 5 (cold visitor only) | Wonders who Nick is | "Should I trust this person?" | About-Nick strip earns the click: stats, one-paragraph credibility, three pill-links to /about, /method, /services |

**5-second visceral:** "This is a real person, two clear paths, looks the same
as the site I just came from."
**5-minute behavioural:** form submitted or slot booked, expectation set for
follow-up.
**5-year reflective:** "I booked Nick because that page felt like him." Tone
match matters.

**After the visitor leaves /book:** HubSpot's workflow sends an
acknowledgement email on form submit; cal.com sends a calendar invite +
confirmation on slot selection. We don't own that surface — we trust those
defaults in v1, and revisit if the visitor's next experience feels off-tone.

## Visual treatment (DESIGN.md alignment)

Reusing the existing system (see starter DESIGN.md being written in parallel):

- **Background**: `--clr-bg` (#F8F4ED warm cream) for HERO + FORM + ABOUT.
  `--clr-section-alt` (#F2ECDE) for CALENDAR section to give the embed a calm
  surface that contrasts with the form above it.
- **Typography**: h1/h2 in Frank Ruhl Libre (display), body in DM Sans, all per
  existing scale. `.hi` highlight on one phrase per h2.
- **Buttons**: `.btn-primary` for "Send the brief". Pill links in About-Nick
  strip use `.btn-ghost` style.
- **Form**: Reuse the rate-card form CSS pattern from `services/index.html:257`
  (`.rc-form-row` lookalikes; lift into shared `.form-row` in `styles.css` so
  both forms share it).
- **Photo**: Same `.about-photo` treatment as `/about`, but at ~240px square
  (vs ~360px on /about). Crop matches the existing `/images/nick-tong.jpg`;
  no second photo asset needed in v1. The size delta is the cue that "this
  is a teaser, /about is the full thing."
- **Cal.com embed**: Set `cal.com` config to use light theme, brand colour
  `#1756E8` (the site accent), Inter (DM Sans not available in cal.com themer,
  closest match), no dark border. Disable cal.com's `hide_event_type_details`
  default styling pills where the embed config allows. We accept that the
  inside of the iframe will never match our brand 100% — the surrounding
  page carries the identity.
- **Form-success icon**: Thin 24×24 SVG line-icon check (2px stroke,
  `currentColor`) in `--clr-accent`. Lives in a 56×56 circle with
  `background: var(--clr-accent-bg)`. Same line-icon language as the rest of
  the site (DESIGN.md §9). Never a filled-circle green tick.

## SEO

- `title`: "Book a Call | Nick Tong, Fractional CTO" — keep it short, in line
  with other page titles.
- `description`: "Send a brief or pick a time. 30-minute discovery call with
  Nick Tong, fractional CTO. UK-based, tech-for-good focus."
- `canonical`: `https://ctoondemand.co.uk/book/`
- `og:type`: "website"; og:title/description mirror; og:image: reuse
  `/og-image.png`.
- Add to `sitemap.xml`: `<url><loc>https://ctoondemand.co.uk/book/</loc><changefreq>monthly</changefreq><priority>0.95</priority></url>` — second-highest priority after homepage.
- `<script type="application/ld+json">` with `ContactPoint` schema:
  `{"@type":"ContactPoint","contactType":"sales","email":"web@ctoondemand.co.uk","availableLanguage":"en"}` nested under the existing Person schema.

## Analytics events

Fired on both Vercel Analytics (`window.va('event', …)`) and GA4
(`gtag('event', …)`) where consent is granted.

| Event | Trigger | Properties |
|---|---|---|
| `book_page_view` | Page loaded | `referrer_path` (e.g. `/services/`), `source` (utm if present) |
| `book_form_focus_first_field` | First focus on any form field | — |
| `book_form_submit_attempt` | Submit clicked | `field_count`, `stage` (if selected) |
| `book_form_submit_success` | HubSpot API returns 200 | `stage` |
| `book_form_submit_error` | HubSpot API returns non-200, or network fail | `error_code`, `error_kind` (`validation` / `network` / `server`) |
| `book_calendar_loaded` | Cal.com embed `iframe.onload` fires | — |
| `book_calendar_slot_selected` | cal.com postMessage `bookingSuccessful` | `event_type` (cal.com event slug) |
| `book_cta_click_about` / `_method` / `_services` | Click any about-strip pill-link | `link_target` |

GA4 funnel to set up post-launch: `page_view (/services or /method or /)` →
`page_view (/book)` → `book_form_focus_first_field` → `book_form_submit_success`
**OR** `book_calendar_slot_selected`.

## Responsive + accessibility

| Viewport | Layout | Notes |
|---|---|---|
| ≥1024px (desktop) | Single-column page, container `1200px`, form max-width 560px centred, calendar embed full container width | Standard treatment |
| 768–1023px (tablet) | Same as desktop; container narrows naturally | About-Nick strip: 2-col grid stays |
| <768px (mobile) | Form fields stack vertically; calendar embed `min-height: 560px` (let cal.com scroll internally if its grid needs more — don't grow the iframe taller than the viewport); about-Nick strip stacks (photo top, text below, pill-links full-width) | Touch targets 44px min on all buttons and pill links |

**Form controls:** Stage field uses native `<select>` — better mobile UX
(uses the OS picker) and free a11y. No custom dropdown component in v1.

**Cookie banner mobile UX:** Fixed bottom-of-viewport strip, full-bleed,
white background, navy text, two pill buttons ("Accept" / "Decline") right-
aligned. Max-height ~25% of viewport. Doesn't cover the topbar; does cover
the bottom of the footer until dismissed. Stores choice in `localStorage`,
not a cookie.

**Keyboard:** Tab order: nav → hero → form fields (in document order) →
submit → "Or grab a slot directly" link (anchors to calendar) → calendar
iframe → about-Nick pill-links → footer.
**Screen readers:** Form labels visible (not placeholder-as-label); submit
button has accessible label; success card has `role="status"` + `aria-live="polite"`.
**Reduced motion:** Honour `prefers-reduced-motion: reduce` — disable
form-to-success transition crossfade, no scroll-in animations on this page.
**Contrast:** All text passes WCAG AA on cream background (verified by existing
`/about` page using same tokens).

## NOT in scope

- **No multi-step form / wizard.** A single-screen form is what fits this
  page. If submission rate drops below ~30%, revisit.
- **No calendar custom theming beyond brand colour.** Cal.com's themer doesn't
  let us load Frank Ruhl Libre; we accept Inter inside the iframe and trust
  the surrounding page to carry brand identity.
- **No instant Slack/email notification UX changes.** HubSpot's own workflow
  handles notifying Nick; we don't build a second notification channel.
- **No cookie consent platform (e.g. Cookiebot, Iubenda).** Ship a minimal
  hand-rolled banner. If we need granular vendor consent later, swap it in.
- **No A/B test of form-first vs calendar-first.** We make the call, ship,
  measure with analytics, revisit in 60 days.
- **No HubSpot meeting embed instead of cal.com.** Nick's calendar is on
  cal.com; we don't migrate it.
- **No live chat / Intercom widget.** Out of scope. Form + calendar only.

## What already exists (and we reuse)

- `<site-topbar>` + `<site-header current="book">` web components from
  `js/site-chrome.js`. **Explicit decision: `/book` does NOT go in the
  `NAV_ITEMS` array.** It lives only as the header CTA pill button (which
  now routes to `/book` instead of `cal.com` directly). The `current="book"`
  attribute is still set on the header for future-proofing (if we ever
  decide to add it to the nav, the active-state styling already works), and
  the comment at `js/site-chrome.js:12` ("Valid values: home, method,
  services, ai-brain, about, blog") gets updated to include `book`.
- Form CSS pattern from `services/index.html:257-292` — generalise into
  `.form-row` in `styles.css` (small refactor; both forms benefit).
- `.about-photo` treatment from `about/index.html:74-92` — same image
  `/images/nick-tong.jpg` (or smaller crop), same rounded-corner mask.
- `.btn-primary` / `.btn-ghost` / `.hi` / `.eyebrow` / `.section` /
  `.section-alt` / `.section-header` — all reused as-is.
- Footer block from any existing page — copy verbatim.
- Schema.org Person + sameAs from `about/index.html:29-53` — extend with
  ContactPoint.

## Open implementation details (Nick to confirm before build)

| # | Detail | Who |
|---|---|---|
| O1 | HubSpot portal ID + form GUID for `/book` form | Nick provides |
| O2 | GA4 measurement ID (`G-XXXXXXXXXX`) | Nick provides or creates |
| O3 | Confirm Vercel deploy plan: move CNAME / DNS from GitHub Pages → Vercel; or set up Vercel as alongside (Vercel pulls from same repo) | Nick confirms before flip |
| O4 | Cal.com event slug — confirm the right cal.com link is `cal.com/nick-tong-cto/30min` (or whichever) for the embed | Nick confirms |
| O5 | Cookie banner copy + decline-keeps-Vercel-on rule | Nick confirms (Plan recommends: "We use cookies for analytics. Accept / Decline." — minimal copy, decline still allows aggregate Vercel Analytics) |

Implementation can stub these with placeholder constants in a single
`/js/book-config.js` file so the rest of the build doesn't block.

## Implementation Tasks

Synthesized from this review's findings. Each task derives from a specific
finding above. Run with Claude Code or Codex; checkbox as you ship.

- [ ] **T1 (P1, human: ~30min / CC: ~5min)** — `/js/site-chrome.js` — Reroute every sitewide "Book a Call" CTA to `/book`
  - Surfaced by: Locked decision #6 — single funnel through `/book`
  - Files: [js/site-chrome.js](js/site-chrome.js), [index.html](index.html), [about/index.html](about/index.html), [services/index.html](services/index.html), [method/index.html](method/index.html), [ai-brain/index.html](ai-brain/index.html), [blog/*](blog/) (any page with a `cal.com/nick-tong-cto` link)
  - Verify: `grep -rn "cal.com/nick-tong-cto" .` returns zero hits outside the new `/book/index.html` cal.com embed config; topbar, header, footer, in-page CTAs all link to `/book`
- [ ] **T2 (P1, human: ~20min / CC: ~3min)** — `/styles.css` — Lift `.rc-form-row` into a shared `.form-row` class
  - Surfaced by: Pass 5 — Design System Alignment; DESIGN.md §5 v2 open item
  - Files: [styles.css](styles.css), [services/index.html:257-292](services/index.html:257) (replace inline `<style>` with the new shared class)
  - Verify: rate-card form still renders identically; new class is used by /book form
- [ ] **T3 (P1, human: ~3h / CC: ~25min)** — `/book/index.html` — Build the page shell (hero, form, divider, calendar section, about-strip, footer)
  - Surfaced by: Locked decisions #1, #2, #5, #9; the wireframe in this plan
  - Files: new file [book/index.html](book/index.html)
  - Verify: page loads at `/book/`, matches DESIGN.md tokens, passes Lighthouse a11y > 95
- [ ] **T4 (P1, human: ~2h / CC: ~20min)** — `/book/index.html` + `/js/book-form.js` — Wire brief form to HubSpot Forms API
  - Surfaced by: Locked decision #3; needs O1 (HubSpot portal ID + form GUID)
  - Files: new file [book/index.html](book/index.html), new file [js/book-form.js](js/book-form.js), new file [js/book-config.js](js/book-config.js)
  - Verify: form submission lands in HubSpot CRM as a new contact with all 5 fields mapped; honeypot field blocks bot submissions
- [ ] **T5 (P1, human: ~1h / CC: ~15min)** — `/book/index.html` — Embed cal.com inline with brand colour
  - Surfaced by: Locked decision #2; needs O4 (cal.com event slug confirmed)
  - Files: [book/index.html](book/index.html), [js/book-config.js](js/book-config.js)
  - Verify: calendar grid loads inline, brand colour `#1756E8`, light theme, `book_calendar_loaded` event fires on iframe `onload`
- [ ] **T6 (P1, human: ~1h / CC: ~10min)** — Form interaction states (loading, error, success, draft persistence)
  - Surfaced by: Pass 2 — Interaction State Coverage; Locked decision #10
  - Files: [js/book-form.js](js/book-form.js), [styles.css](styles.css) (new `.success-card`, `.draft-restored-note`)
  - Verify: submit shows spinner + disabled state; offline submit shows error banner; success card replaces form + scrolls into view; localStorage draft restored across refresh; draft cleared on submit success
- [ ] **T7 (P1, human: ~1.5h / CC: ~15min)** — Analytics — Vercel Analytics + GA4 + consent banner
  - Surfaced by: Locked decisions #7 and #11; needs O2 (GA4 measurement ID)
  - Files: new file [js/analytics.js](js/analytics.js), new file [js/consent-banner.js](js/consent-banner.js), [styles.css](styles.css) (banner styles), all page HTML files (analytics include in `<head>`)
  - Verify: Vercel Analytics fires on every visit; GA4 only loads after Accept; all 8 events in the plan fire correctly; consent stored in localStorage; banner re-shows after 12 months
- [ ] **T8 (P1, human: ~45min / CC: ~10min)** — Deploy to Vercel + DNS cutover
  - Surfaced by: Locked decision #8; needs O3 (Nick confirms before DNS flip)
  - Files: new file [vercel.json](vercel.json) (clean URLs config), Vercel project setup via Vercel MCP
  - Verify: site loads at preview URL with no regressions; analytics fire on preview; after DNS cutover, `ctoondemand.co.uk` loads from Vercel; Vercel Analytics dashboard receives data
- [ ] **T9 (P2, human: ~20min / CC: ~3min)** — SEO updates
  - Surfaced by: Pass 1 + SEO section of plan
  - Files: [sitemap.xml](sitemap.xml) (add `/book/` entry, priority 0.95), [book/index.html](book/index.html) (canonical, OG, ContactPoint schema)
  - Verify: sitemap valid XML, Search Console fetches `/book/` successfully, OG preview correct on LinkedIn/Twitter
- [ ] **T10 (P2, human: ~30min / CC: ~5min)** — About-Nick strip + photo crop
  - Surfaced by: Locked decision #5; Pass 5 fix
  - Files: [book/index.html](book/index.html), reuses `/images/nick-tong.jpg` at 240px square (CSS sizing only; no new image asset in v1)
  - Verify: photo, three stats, paragraph, three pill-links all match the about-strip wireframe; on mobile, photo stacks above text; pill-links full-width
- [ ] **T11 (P2, human: ~30min / CC: ~5min)** — Responsive QA across viewports
  - Surfaced by: Pass 6 — Responsive & Accessibility
  - Files: no source changes — verification only via browser
  - Verify: 1366×768, 1024×768, 768×1024, 390×844 all render correctly; calendar embed `min-height: 560px` on mobile lets cal.com scroll internally; cookie banner doesn't cover the topbar
- [ ] **T12 (P2, human: ~30min / CC: ~5min)** — Accessibility QA
  - Surfaced by: Pass 6 — Responsive & Accessibility
  - Files: no source changes — verification only
  - Verify: Lighthouse a11y > 95; keyboard tab order matches plan; success card announces via `role="status"` `aria-live="polite"`; `prefers-reduced-motion` disables crossfade; native `<select>` for stage; visible focus rings on all interactive elements
- [ ] **T13 (P3, human: ~15min / CC: ~3min)** — Update DESIGN.md open items
  - Surfaced by: DESIGN.md §12 — the `.form-row` lift (T2) and `book` chrome update (T1) tick off two of the open items
  - Files: [DESIGN.md](DESIGN.md) — strike-through or remove the resolved v2 open items
  - Verify: DESIGN.md reflects the new shared `.form-row` and the updated `site-chrome.js` valid-current-values comment

### Eng review additions (T14–T20)

- [ ] **T14 (P1, human: ~30min / CC: ~5min)** — `/js/storage.js` — Shared safe-localStorage helper
  - Surfaced by: Eng review Q4 — localStorage unavailable (private browsing); Decision #18
  - Files: new file [js/storage.js](js/storage.js) (`safeGet(key)`, `safeSet(key, value)`, `safeRemove(key)` — all try/catch, return null/false on failure)
  - Verify: in DevTools console, disable localStorage (`Object.defineProperty(window, 'localStorage', { get: () => { throw new Error('blocked'); } })`), reload page, confirm no JS exceptions thrown and form still functions
- [ ] **T15 (P1, human: ~20min / CC: ~5min)** — Form draft polish — 24h expiry + Clear-draft link + 500ms debounce
  - Surfaced by: Eng review Q2 (privacy) + P4 (debounce); Decisions #16 and #22
  - Files: [js/book-form.js](js/book-form.js), [styles.css](styles.css) (`.draft-restored-note` styling)
  - Verify: fill draft, manually edit localStorage `savedAt` to >24h ago, reload, confirm draft silently discarded; type continuously, confirm `setItem` fires ~once per 500ms; click "Clear draft" link, confirm form empties and localStorage entry removed
- [ ] **T16 (P1, human: ~20min / CC: ~5min)** — Cal.com skeleton placeholder with locked CLS-safe height
  - Surfaced by: Eng review P2 — CLS prevention; Decision #21
  - Files: [book/index.html](book/index.html), [styles.css](styles.css) (`.calcom-skeleton` with `min-height: 620px` desktop / `560px` mobile)
  - Verify: Lighthouse CLS score < 0.1 on `/book/`; visually no jump when cal.com iframe replaces the skeleton
- [ ] **T17 (P1, human: ~15min / CC: ~3min)** — Migrate analytics event names to GA4-recommended where applicable
  - Surfaced by: Eng review Q3; Decision #17
  - Files: [js/analytics.js](js/analytics.js), [js/book-form.js](js/book-form.js) (event-firing call sites)
  - Verify: GA4 DebugView shows `generate_lead` event firing with `form_type=brief` parameter on form submit success; `generate_lead` with `form_type=calendar` on cal.com slot selection; custom `book_form_*` events still fire for the funnel-internal steps
- [ ] **T18 (P1, human: ~30min / CC: ~5min)** — Set up Node tooling on the site (first time)
  - Surfaced by: Eng review TODO #2; Decision #23
  - Files: new file [package.json](package.json) (devDependencies only — `@playwright/test`), new file [.gitignore](/.gitignore) entries (`node_modules/`, `test-results/`, `playwright-report/`), new file [package-lock.json](package-lock.json) (committed)
  - Verify: `npm install` succeeds with no warnings beyond peer-dep noise; `node_modules/` is gitignored; `npx playwright --version` returns expected version
- [ ] **T19 (P1, human: ~3h / CC: ~25min)** — Write 12 Playwright E2E tests
  - Surfaced by: Eng review Decision #23; Test coverage table in plan
  - Files: new file [playwright.config.ts](playwright.config.ts) (chromium only, baseURL from env, traces on retry), new file [tests/book.spec.ts](tests/book.spec.ts) (11 tests), new file [tests/cta-reroute.spec.ts](tests/cta-reroute.spec.ts) (1 test iterating across 5 pages)
  - Verify: `npx playwright test` runs all 12 tests against a local dev server (`python3 -m http.server 8000 &` or Vercel dev) and all pass; failure messages are informative; HubSpot interactions use Playwright route mocking (don't hit real HubSpot in tests)
- [ ] **T20 (P1, human: ~30min / CC: ~5min)** — GitHub Actions CI workflow for Playwright
  - Surfaced by: Eng review Decision #23
  - Files: new file [.github/workflows/playwright.yml](.github/workflows/playwright.yml) (runs on PR + push to main, uses `actions/setup-node@v4` + `npx playwright install --with-deps chromium` + `npx playwright test`, uploads `playwright-report/` on failure)
  - Verify: open a test PR, confirm the workflow runs, confirm a deliberate test failure surfaces in the PR check + report artifact is downloadable

### Eng review test coverage matrix (after T19)

After T19 lands, the test coverage diagram from this review goes from `0/45 → 24/45` (53%). Remaining gaps:
- 21 unit-worthy paths inside `/js/*.js` helpers — not covered by E2E. Acceptable: the E2E tests exercise the integration. If we ever add Vitest later, those unit tests would be straightforward to add.

The eng-review test coverage budget is intentionally biased toward **integration / E2E over unit** because /book's bugs will be integration bugs (HubSpot schema, cal.com embed quirks, consent ordering, CTA reroute) far more than logic bugs in a 100-line helper.

### Unresolved Decisions

None. All 11 locked decisions are documented above; the three remaining items (O1–O5 in "Open implementation details") are external dependencies (HubSpot IDs, GA4 ID, Vercel/DNS confirmation), not design ambiguities.

### Approved Mockups

| Screen / Section | Mockup Path | Direction | Notes |
|---|---|---|---|
| `/book` page | _pending — OpenAI org verification propagating, see Task #2_ | _TBD_ | Brief fully specified in this plan. Run `~/.claude/skills/gstack/design/dist/design variants --brief "<brief from Step 0.5>" --count 3 --output-dir ~/.gstack/projects/nicktong-cto-od-website/designs/book-page-20260519/` once verified. |

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | Not run. Scope was locked by user intent + design + eng reviews; CEO review optional and not recommended for a narrow page-launch plan. |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | — | Not run. Codex CLI not installed locally. Skipped at outside-voice step; available if user installs `codex` later. |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | CLEAR (PLAN) | 17 issues across 4 sections, all resolved. 12 new locked decisions (#12–#23). Scope held as 1 PR with explicit user approval. Test infra added: Playwright + CI (Decision #23). |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 | CLEAR (PLAN) | Initial design completeness: 3/10. After 7 passes + 11 locked decisions: 9/10. All 7 dimensions rated ≥8/10. No design ambiguities remain. Mockups still pending OpenAI org verification. |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | Not run. No developer-facing surface in this plan (no API, no SDK). Skip. |

- **CROSS-MODEL:** Outside voice declined (Codex not available locally; same-model subagent would be weak signal). Strong recommendation: install `codex` and run `/codex consult` on this plan if you want true cross-model challenge before implementation.
- **UNRESOLVED:** 0 design decisions, 0 architecture decisions. 4 external dependencies remain: O1 (HubSpot portal ID + form GUID), O3 (Vercel DNS confirmation), O4 (cal.com event slug confirmation), O5 (cookie banner copy approval — current draft: "We use cookies for analytics. Accept / Decline."). **O2 (GA4 measurement ID) closed:** `G-7V1DS9J7KJ`.
- **TODOS:** 1 item in TODOS.md (CSP hardening, deferred from eng review).
- **VERDICT:** **CEO N/A · DESIGN + ENG CLEARED · READY TO IMPLEMENT.** Plan is shipping-ready pending the 4 external dependencies above. Run `/ship` when implementation is done.

