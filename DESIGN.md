# DESIGN.md — CTO on Demand

> The source of truth for visual and interaction design across
> `ctoondemand.co.uk`. Reverse-engineered from the live site as it stands
> today (May 2026). Treat this as v1: a snapshot to build on, not a
> straitjacket. Run `/design-consultation` or `/plan-design-review` against
> this file to evolve it.

---

## 1. Brand position

A senior fractional CTO consultancy for funded UK startups, with a tech-for-good
focus. The visual language should feel like the person behind it:

- **Confident, not loud.** Editorial weight, restrained colour, no hype.
- **Warm, not cold.** Cream paper, not enterprise white. Yellow highlighter,
  not corporate purple.
- **Premium, not flashy.** Serif headlines, generous spacing, real photography.
  Composition does the work; effects don't.
- **Honest, not glossy.** Direct copy. No filler. The product is judgment, so
  the page must demonstrate it.

If a design decision could appear on any SaaS landing page in 2026, it's
probably wrong.

---

## 2. Colour system

All colours are CSS custom properties in `styles.css:13-28`. **Never hardcode
hex values in HTML or component CSS — always reference the token.**

### Surfaces

| Token | Value | Use |
|---|---|---|
| `--clr-bg` | `#F8F4ED` | Warm cream. Main page background. Default for `.section`. |
| `--clr-bg-alt` | `#FFFFFF` | White. Hover states, card lifts. |
| `--clr-section-alt` | `#F2ECDE` | Deeper cream. Alternating `.section-alt` background — used to break visual rhythm without a hard contrast change. |
| `--clr-surface` | `#FFFFFF` | Card surfaces that "float" on cream. |

### Text

| Token | Value | Use |
|---|---|---|
| `--clr-dark` | `#0B1829` | Near-navy. All headings, logo, dark backgrounds. |
| `--clr-body` | `#2C3A4F` | Body copy. |
| `--clr-muted` | `#5A6B84` | Secondary body, captions, fine print. |
| `--clr-border` | `#E8DFCE` | Warm-toned borders to match cream. |

### Accent

| Token | Value | Use |
|---|---|---|
| `--clr-accent` | `#1756E8` | Electric blue. Primary CTA, links, focus rings, eyebrow text. The brand colour. |
| `--clr-accent-dk` | `#1145C4` | Hover state for `.btn-primary`. |
| `--clr-accent-bg` | `#EBF0FD` | Soft blue tint. Nav hover, ghost-button hover. |
| `--clr-accent-hi` | `#6BA3FF` | Lighter blue for use on dark backgrounds (hero panel icons, etc.). |
| `--clr-accent-nav` | `#0B1829` | Reuses `--clr-dark` for the nav CTA button. |

### Highlight

| Token | Value | Use |
|---|---|---|
| `--clr-highlight` | `#FFE066` | Yellow highlighter. Used **once per heading** via `<span class="hi">` to mark the key phrase. Also used in topbar dot + cta border. Never use for backgrounds, never for body text. |

### Status / semantic

We don't have a formal success/warning/error palette yet. Today:
- **Error** (used in `.nfy-x`): `rgba(220,38,38,0.1)` background, `#dc2626` mark.
- **Available** (hero panel availability row): `rgba(34,197,94,.07)` background, `#22c55e` dot.

Action for v2: name these as tokens (`--clr-error`, `--clr-success-bg`, etc.)
the next time a page needs them.

---

## 3. Typography

Three families, each with a job. Loaded from Google Fonts (`<link>` in every
page `<head>`).

| Family | Token | Weights | Use |
|---|---|---|---|
| **Frank Ruhl Libre** | `--font-display` | 400, 500, 700, 900 | All `<h1>` and `<h2>`. Editorial serif — does almost all the brand work. |
| **DM Sans** | `--font` | 300–700 (variable) | Body text, `<h3>`–`<h5>`, UI labels, buttons. |
| **Syne** | `--font-display-alt` | 600, 700, 800 | Reserved for occasional accent (currently unused). Available if a treatment needs a different display voice. |

### Scale

| Element | Size | Source |
|---|---|---|
| `h1` | `clamp(2.5rem, 5.2vw, 4rem)` · 700 · -0.02em · line-height 1.1 | Display, fluid |
| `h2` | `clamp(2rem, 4vw, 3rem)` · 700 · -0.015em | Display, fluid |
| `h3` | `1.125rem` · 600 | Section/card titles |
| `h4` | `1rem` · 600 | Sub-titles |
| body `p` | `1rem` · 400 · line-height 1.7 · `max-width: 68ch` | Default reading column |
| `.section-lead` | `1.0625rem` · `--clr-muted` · `max-width: 54ch` · centred | Section intro sentence |
| `.eyebrow` | `0.6875rem` · 700 · uppercase · letter-spacing 0.1em | Pill above h1 |
| `.section-tag` | `0.6875rem` · 700 · uppercase · letter-spacing 0.12em · accent colour | Plain eyebrow above h2 |
| `.btn` | `0.9375rem` · 600 · line-height 1 | All buttons |

### Highlighting

Use `<span class="hi">key phrase</span>` to mark one phrase per heading.
The CSS uses a linear-gradient to mimic a felt-tip highlighter pen sitting at
~35% from the top:

```css
.hi {
  background: linear-gradient(180deg,
    transparent 0%, transparent 35%,
    var(--clr-highlight) 35%, var(--clr-highlight) 92%,
    transparent 92%);
  padding: 0 0.12em;
  box-decoration-break: clone;
}
```

**Rules:**
- One `.hi` per heading. Never more.
- Pick the phrase that carries the meaning, not the most decorative one.
- Don't use `.hi` on body copy unless it's a deliberate quote callout (see
  the testimonial pull-quotes in `/about`).
- Never use `.hi` on a dark background — the contrast inverts and looks
  broken. Use `--clr-accent-hi` colour change instead.

---

## 4. Layout

### Container

```css
.container {
  width: 100%;
  max-width: var(--container-w);   /* 1200px */
  margin-inline: auto;
  padding-inline: var(--container-px);  /* 1.5rem */
}
```

Every meaningful block lives inside a `.container`. No exceptions.

### Section rhythm

`.section` and `.section-alt` alternate down the page to create visual cadence:

```css
.section, .section-alt {
  padding-block: var(--section-py);  /* clamp(4rem, 8vw, 7rem) */
}
.section-alt { background: var(--clr-section-alt); }
```

**Rule:** never put two `.section` in a row, and never two `.section-alt`. The
rhythm is the design.

### Section headers

```html
<header class="section-header">
  <h2>Heading with <span class="hi">highlight</span></h2>
  <p class="section-lead">One-sentence framing of the section.</p>
</header>
```

`.section-header` is centred by default; add `.align-left` for left-aligned
content sections.

---

## 5. Components

### Buttons

| Class | Use | Visual |
|---|---|---|
| `.btn .btn-primary` | Single most important action per section | Solid `--clr-accent`, white text, navy-tinted shadow |
| `.btn .btn-ghost` | Secondary actions, "view more" | Transparent, navy text, warm-cream border, hovers to accent |
| `.btn .btn-nav` | Header CTA button only | Solid navy, white text, smaller (0.65em 1.2em padding) |
| `.btn-full` | Modifier that fills width | Used in form CTAs and rate-card form |

All buttons are pill-shaped (`border-radius: 9999px`), 0.85em 1.6em padding,
0.5em icon gap. On hover they lift 1px (`transform: translateY(-1px)`).
On focus they get the keyboard-only ring (2.5px solid accent, 3px offset).

**Rule:** at most **one** `.btn-primary` per section. Anything else competes.

### Topbar

The thin dark strip at the top of every page (`<site-topbar>` web component
in `js/site-chrome.js:31-47`). Announces availability, pulses the highlighter
dot, links to the booking page. Never decorate it — copy and pulse only.

### Site header

`<site-header current="…">` web component. Sticky, blur background, gains a
shadow on scroll. `current` attribute highlights the active nav item.

Valid `current` values today: `home`, `method`, `services`, `ai-brain`,
`about`, `blog`. **Add new values as new pages ship** — see
`js/site-chrome.js:54-57`.

### Eyebrow / pill above headings

```html
<span class="eyebrow">
  <span class="eyebrow-dot" aria-hidden="true"></span>
  Let's talk
</span>
```

Use sparingly — once per major hero, never twice on the same page.

### Photos

The about page (`about/index.html:74-92`) shows the canonical treatment:
rounded photo on the left, stats grid on the right, max-width ~520px on the
photo, mobile stacks photo on top.

**Rule:** real photos only. Initials avatars (`.testimonial-avatar`) for
testimonials where a photo isn't available. Never AI-generated, never stock.

### Forms

Shared `.form-field` class in `styles.css` is the canonical pattern. One
field per row, label stacked above input. Used by `/services` rate-card
modal and `/book` brief form. (Note: `.form-row` is a *different* existing
class on the home page contact form — it's a 2-col grid pairing two
`.form-group` siblings side-by-side. Don't confuse the two.)

```html
<div class="form-field">
  <label for="emailInput">Email <span class="required" aria-hidden="true">*</span></label>
  <input type="email" id="emailInput" name="email" required />
</div>
```

```css
/* See styles.css:230 — applies to input, select, and textarea children. */
.form-field { display: flex; flex-direction: column; gap: 0.4rem; margin-bottom: 1rem; }
.form-field label { font-size: 0.85rem; font-weight: var(--fw-semibold); }
.form-field input,
.form-field select,
.form-field textarea {
  padding: 0.65rem 0.85rem;
  border: 1px solid #d4d4d4;
  border-radius: 0.5rem;
  font: inherit;
}
.form-field.has-error input { border-color: #dc2626; }
```

**Always include a honeypot** — see the `_gotcha` field at
`services/index.html:275` and `book/index.html`.

**Submission:** static-site forms POST directly from the browser to a
third-party endpoint. Rate-card form uses Formspree
(`formspree.io/f/xpqydglp`). `/book` brief form uses HubSpot Forms API
(`api.hsforms.com/submissions/v3/integrations/submit/{portalId}/{formId}`)
so the contact lands in the CRM. Both wrap the fetch in try/catch and
show an inline error banner on failure.

### Cards

We don't have a generic "card" component. Card-shaped content (testimonials,
impact items, hero panel) each have their own bespoke class. **Don't
introduce a generic `.card`** — every card surface on the site earns its own
class because each has different content rules. Generic cards are the AI
slop signal #1.

---

## 6. Shape language

| Token | Value | Use |
|---|---|---|
| `--radius-sm` | `0.375rem` | Small inputs, focus rings, nav links |
| `--radius-md` | `0.75rem` | Form fields, small cards |
| `--radius-lg` | `1.25rem` | Section cards, large panels |
| (buttons) | `9999px` | All pill-shaped CTAs |

No mixed radius scales. No "bubbly" border-radius. Pills for buttons, soft
rectangles for everything else.

### Shadows

Navy-tinted for brand coherence (no plain `rgba(0,0,0,…)`).

| Token | Use |
|---|---|
| `--shadow-sm` | Sticky header on scroll |
| `--shadow-card` | Floating card surfaces |
| `--shadow-md` | Hover states |
| `--shadow-lg` | Modals, lifted panels |

---

## 7. Motion

```css
--ease: 0.25s cubic-bezier(0.16, 1, 0.3, 1);
```

Use this single ease for every transition. Two motion patterns in use:

1. **Hover lift**: `transform: translateY(-1px)` on buttons.
2. **Scroll-in**: `[data-animate]` elements gain `.is-visible` via
   IntersectionObserver. Defined per page in inline script. Stagger via
   `data-delay="0|1|2|3"`.

**Topbar pulse** is the only continuous motion on the site
(`@keyframes topbar-pulse`). Don't add a second continuous animation without
a strong reason — it competes with the dot for attention.

**Reduced motion:** honour `prefers-reduced-motion: reduce` on every new
animation or scroll-in. Today the `IntersectionObserver` pattern does NOT
respect this — fix the next time it's touched.

---

## 8. Accessibility baseline

- **Focus ring:** keyboard-only via `:focus-visible` (2.5px solid accent,
  3px offset, `border-radius: var(--radius-sm)`). Never disable.
- **Contrast:** all body text passes WCAG AA on cream. Verify any new
  combination with a contrast checker.
- **Touch targets:** 44px minimum on mobile (buttons already meet this via
  default padding; verify any custom hit-area).
- **Semantic landmarks:** `<header>`, `<main>`, `<footer>`, `<nav>`,
  `<section>` with `aria-labelledby` pointing to its `<h2>`. See
  `about/index.html` for the canonical pattern.
- **Email obfuscation:** every email reference uses the base64 obfuscation
  pattern (`.email-obf` + inline script in each page). Never write the
  literal address.
- **No placeholder-as-label.** Labels always visible. Placeholders only as
  examples (e.g. "jane@company.com").

---

## 9. Iconography

SVG line icons, 24x24 viewBox, 2px stroke, `currentColor` for fill/stroke
so they inherit the text colour. Examples: LinkedIn icon and email icon in
the footer; check icons inline.

**Rule:** no emoji as design elements. The previous version of the site had
emoji card icons; commit `7ba6dc5` replaced them with line-icon SVG. Don't
regress.

---

## 10. Patterns we deliberately don't use

These are flagged because they're tempting defaults — especially under AI
generation pressure — that would dilute the brand.

1. **Three-column feature grids** with icon-in-circle + bold title + 2-line
   description. The single most recognisable AI-generated SaaS layout.
2. **Purple/violet/indigo gradients.** The "AI design" colour signal.
3. **Centred-everything pages.** Heroes can centre; sections should breathe
   left-aligned where it serves hierarchy.
4. **Decorative blobs / floating circles / wavy SVG dividers.** If a section
   feels empty, the copy is wrong, not the decoration.
5. **Coloured left-border cards** (`border-left: 3px solid accent`).
6. **Generic hero copy** ("Welcome to…", "Unlock the power of…").
7. **Uniform bubbly border-radius** on every element.
8. **`system-ui` / `-apple-system`** as a primary display font. We have
   Frank Ruhl Libre for a reason.
9. **AI-generated photography / illustration.** Always real.

---

## 11. Where this lives in code

- **Tokens:** `styles.css:13-58`
- **Buttons + section / container utilities:** `styles.css:115-228`
- **Topbar:** `styles.css:274-317` + `js/site-chrome.js:31-47`
- **Header / nav:** `styles.css:319-453` + `js/site-chrome.js:50-117`
- **Form pattern:** `services/index.html:257-292` (lift into `styles.css` v2)
- **Photo / stats treatment:** `about/index.html:69-138`
- **Testimonials:** `about/index.html:140-190`
- **Section header utility:** `styles.css:130-142`

---

## 12. Open items for v2

- ~~Lift `.rc-form-row` from `services/index.html` into a shared `.form-row` in
  `styles.css`.~~ **Done** as `.form-field` in `styles.css:230` (the name
  `.form-row` was already taken by the home page contact form's 2-col grid,
  so the lifted class is `.form-field` — one field with stacked label + input).
  Both `/services` rate card and `/book` brief form use it. (2026-05-20)
- ~~Decide whether `/book` belongs in the primary nav array or stays as a
  header-CTA-only destination.~~ **Done.** `/book` is header-CTA-only;
  `current="book"` is accepted by `<site-header>` but `book` is intentionally
  absent from `NAV_ITEMS` in `js/site-chrome.js`. (2026-05-20)
- ~~Make site-chrome.js `BOOK_URL` route to `/book/`~~ **Done.**
  Single funnel: topbar, header, footer, and every in-page "Book a Call"
  CTA across the site routes through `/book/`. Two intentional cal.com
  fallback links remain inside `/book/index.html` itself for embed-load
  failure. (2026-05-20)
- Name the success/error/warning palette as tokens. Still open.
- Make `IntersectionObserver` scroll-in honour `prefers-reduced-motion`.
  Still open.
- Add a section to this doc on photography direction once we have a
  second commissioned photo beyond `nick-tong.jpg`.
- Add a section on email/newsletter visual treatment if/when we ship a
  newsletter.
- **New (from /book build):** decide a colour token for form input borders.
  Currently hard-coded `#d4d4d4` in `.form-field` — would be cleaner as
  `--clr-input-border` so light + dark form contexts can both reference it.
