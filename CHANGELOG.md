# Changelog

All notable changes to ctoondemand.co.uk are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
versioned as `MAJOR.MINOR.PATCH.MICRO` (4-digit) per the gstack convention.

## [0.3.0.0] - 2026-05-28

Marketing system + course Cohort 1 pre-launch. Reviewed via /office-hours,
/plan-ceo-review (SELECTIVE EXPANSION), and /plan-eng-review.

### Added
- **`MARKETING.md`** — AI knowledge base for the sales agent, covering all three ICPs (fractional CTO, AI Brain build-out, AI training course), pricing, objection handling, conversion paths.
- **`/api/sales-agent.js`** — Vercel serverless agent with two modes dispatched by HubSpot webhook type. Mode 1: lead qualification (classify + score + draft follow-up email, `[sales-agent-v1]` Note). Mode 2: Sprint pipeline auto-routing on course graduation (reads private repo via GitHub Contents API, scores Sprint-readiness, `[sprint-pipeline-v1]` Note, private to Nick). HMAC v3 verification, idempotency via Note markers, MARKETING.md system prompt with prompt caching.
- **`lib/claude.js`** — shared Claude API helpers (call, MARKETING.md loader, system-prompt builder, JSON parser with bounded fallback, XML escaping) used by the agent and the case-study script.
- **`/course/` pre-launch waitlist page** — hero, who-it's-for, what-you-get, pricing (£1,500 Cohort 1 pilot / £2,250 Cohort 2, 10 places, Sprint upgrade credit), FAQ, GDPR-consent waitlist form. Wired to `/api/waitlist.js`.
- **`/api/waitlist.js`** — course waitlist capture, sets `lead_source=course_waitlist` + `course_interest=true`, honeypot.
- **`/api/rate-card.js`** — migrates the AI Brain rate card from Formspree to HubSpot (`lead_source=ai_brain_rate_card`), so rate-card leads reach the sales agent.
- **`scripts/draft-case-study.js`** — generates long-form case-study drafts from a graduate's repo via Claude in Nick's voice.
- **`scripts/brain-health-check.js` + `.github/workflows/brain-health.yml`** — daily cron polling opted-in alumni repos for stagnation, Slack alert on >60 days, degrades silently on failure.
- **`docs/operations/graduation-flow.md`** — consent-first graduation sequence (GDPR posture).
- **66-test unit suite** (`tests/unit/`, `node:test`, zero new deps) covering HMAC, dispatch routing, marker idempotency, GitHub failure modes, stagnation thresholds, Slack degradation, and the lib/claude parser. New `npm run test:unit` script.
- **`/course` added to site nav, sitemap, and llms.txt.**

### Changed
- `api/prompts.js` sets `lead_source=prompt_library`; `api/book.js` sets `lead_source=cto_services` — both now flow through the sales agent. `/book` is the highest-intent channel and was previously invisible to it.

## [0.2.1.0] - 2026-05-20

### Added
- **Robots + Googlebot meta on every page** with `max-snippet:-1, max-image-preview:large, max-video-preview:-1`. These are what Google's "Optimizing your website for generative AI features on Google Search" guide explicitly references as the controls for AI Overviews and AI Mode. Without them, snippets are truncated and large images never surface in AI results.
- **Sitemap rebuilt** to include all 18 URLs (4 blog posts and `/book/` were previously missing) with `<lastmod>` derived from `git log` so freshness signals reflect reality.
- **robots.txt expanded** with explicit allow-list for Googlebot, Googlebot-Image, AdsBot-Google, Google-Extended (Gemini grounding/training), Bingbot, OAI-SearchBot, GPTBot, ClaudeBot, PerplexityBot, Applebot, Applebot-Extended, Meta-ExternalAgent. We want to be in every major AI assistant's index.
- **Organization + WebSite JSON-LD** on the homepage, interlinked by `@id` with the existing Person schema, for Knowledge Graph eligibility.
- **BreadcrumbList JSON-LD** on every inner page and blog post. AI Overviews use breadcrumbs for hierarchy when summarising sources.
- **`vercel.json`** with security headers (HSTS preload, X-Content-Type-Options, Referrer-Policy, Permissions-Policy), `X-Robots-Tag` mirroring per-page meta, content-type rules for `/sitemap.xml`, `/robots.txt`, `/llms.txt`, `/llms-full.txt`, immutable 1-year cache for fonts and `/logos`, and a permanent `www.` → apex redirect to consolidate ranking signals on the canonical host.
- **`/llms.txt` + `/llms-full.txt`** following the llmstxt.org spec. No major AI crawler honours this yet — Anthropic, OpenAI, Google, and Perplexity have all said publicly they parse HTML, not llms.txt. Treated as speculative insurance with near-zero maintenance cost.
- **`/docs/gstack/`** mirrors `~/.gstack/projects/nicktong-cto-od-website/` (eng-review test plans, design-review tasks, review logs). A PostToolUse hook in `.claude/settings.json` keeps the mirror current after every Bash tool call so future gstack artefacts land in the repo automatically.

### Changed
- `/book/index.html` extended with the same SEO treatment: robots/googlebot meta + `BreadcrumbList` JSON-LD.

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
