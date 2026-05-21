# CLAUDE.md — agent guide for ctoondemand.co.uk

Project conventions, gotchas, and workflows for any Claude session working on this repo.

## What this site is

Static HTML marketing site for **CTO on Demand**, Nick Tong's fractional/interim CTO practice. Deployed to **Vercel** (CNAME `ctoondemand.co.uk` → Vercel). No framework, no build step for the pages themselves — just hand-edited HTML + a single `styles.css` + a small JS layer in `js/` (mostly the shared topbar/header custom elements, the booking form, consent banner, and analytics).

`/book` has a Playwright E2E suite and a Vercel serverless function (`api/book.js`) that proxies the HubSpot Contacts API. Everything else is purely static.

## When you change site content, run the SEO regen

Sitemap and `llms-full.txt` are **not auto-generated**. They are hand-built files that mirror the current site state. There is no build step that updates them.

After any of:
- adding a new HTML page (top-level or subdirectory),
- adding a new blog post under `/blog/`,
- rewriting the body copy of an existing page,
- significant page content edits,

run:

```bash
python3 scripts/regen-seo.py
```

This rebuilds:
- `sitemap.xml` — every URL with `<lastmod>` from `git log`.
- `llms-full.txt` — concatenated `<main>` content from every page, for AI grounding.

If you added a new top-level page or subdirectory, also:
1. Add an entry to the `PAGES` list near the top of `scripts/regen-seo.py`.
2. Add a one-line description under the relevant section of `llms.txt` (hand-curated).

The script will warn you when `llms.txt` is missing a page that's now in the sitemap.

To verify CI-style without writing changes:

```bash
python3 scripts/regen-seo.py --check
```

Exits non-zero if any of the three files are stale.

## SEO baseline (do not regress)

The site is optimised for Google AI Overviews / AI Mode per Google's [generative AI features guide](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide). When editing any HTML page, preserve:

- `<meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1">` and the matching `googlebot` variant, immediately after the viewport meta. **Removing these breaks AI Overview snippet quality.**
- `<link rel="canonical">` to the absolute URL of that page.
- The page's existing JSON-LD block — Article/Service/HowTo/FAQPage/Organization as appropriate.
- The `BreadcrumbList` JSON-LD on inner pages and blog posts.

Open Graph + Twitter cards on every page. `og:image` should remain `https://www.ctoondemand.co.uk/og-image.png` unless you generate a per-page image.

## Files that AI crawlers and Vercel care about

| File | Purpose | When to update |
|---|---|---|
| `sitemap.xml` | Google + every search engine | Run `regen-seo.py` after content changes |
| `robots.txt` | Crawler allow-list (Googlebot, Google-Extended, GPTBot, ClaudeBot, PerplexityBot, Applebot, etc.) | Only when adding/removing whole sections of the site |
| `llms.txt` | Hand-curated index for AI assistants (llmstxt.org spec) | When adding/removing pages — manual one-line descriptions |
| `llms-full.txt` | Concatenated content for AI grounding | Run `regen-seo.py` after content changes |
| `vercel.json` | Cache headers, security headers, redirects, content-type rules | When changing routes, hosts, or cache policy |

## /book booking page

`book/index.html` + `js/book-form.js` + `api/book.js` (Vercel serverless). Form posts to the serverless function which calls HubSpot's Contacts API. Cal.com inline embed for direct calendar booking. Required env vars in Vercel:

- `HUBSPOT_ACCESS_TOKEN` — Private app token with `crm.objects.contacts.write` scope.

If you touch the booking flow, run the Playwright tests:

```bash
npm install
npx playwright install --with-deps chromium
npm test
```

Tests live in `tests/`. They expect the dev server on port 4173 (Playwright config auto-starts `npx serve`).

## Working tree conventions

- **Commits**: imperative mood, `type(scope): summary`. Conventional Commits-ish — `feat`, `fix`, `chore`, `docs`, `refactor`. Versions follow `MAJOR.MINOR.PATCH.MICRO` per gstack.
- **Branches**: feature work on `claude/<slug>` or `feat/<slug>`, fixes on `fix/<slug>`. Land via PR to `main`. No direct pushes to `main`.
- **VERSION + CHANGELOG**: bump in the same PR that ships the change. CHANGELOG entry under `## [X.Y.Z.W]` with `### Added`/`### Changed`/`### Fixed` subsections.
- **package.json `version`** must match `VERSION` exactly.

## /docs/gstack auto-mirror

`/docs/gstack/` mirrors `~/.gstack/projects/nicktong-cto-od-website/` — eng-review test plans, design-review tasks, review JSONL logs. A PostToolUse hook in `.claude/settings.json` runs `.claude/hooks/sync-gstack-docs.sh` after every Bash tool call, so new gstack artefacts land in the repo automatically. Nothing to do — just be aware files may appear under `/docs/gstack/` without explicit edits.

## Skill routing

When the user's request matches an available gstack skill, invoke it via the Skill tool. When in doubt, invoke the skill.

Key routing rules:
- Product ideas/brainstorming → `/office-hours`
- Strategy/scope → `/plan-ceo-review`
- Architecture → `/plan-eng-review`
- Design system/plan review → `/design-consultation` or `/plan-design-review`
- Full review pipeline → `/autoplan`
- Bugs/errors → `/investigate`
- QA/testing site behaviour → `/qa` or `/qa-only`
- Code review/diff check → `/review`
- Visual polish → `/design-review`
- Ship/deploy/PR → `/ship` or `/land-and-deploy`
- Save progress → `/context-save`
- Resume context → `/context-restore`
