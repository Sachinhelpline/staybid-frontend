# 02 — Foundation Spec (design system contract)

> Status: DRAFT — palette/direction sections finalize AFTER the owner picks a
> Phase-0 mood-board. Everything else here is locked engineering contract.

## 1. Token architecture (single source of truth)

Three tiers, all in `app/globals.css` (Tailwind 4 `@theme` + `:root` semantics):

1. **Primitives** — raw scales (`--color-*-50…950`), never referenced by components.
2. **Semantic tokens** — the ONLY thing components may use:
   `--bg-page / --bg-card / --bg-elevated / --bg-input / --bg-pill`
   `--text-base / --text-soft / --text-muted / --text-inverse`
   `--border-soft / --border-strong` · `--accent / --accent-soft / --link`
   `--shadow-soft / --shadow-card` · NEW: `--success / --warning / --danger / --deal / --bid`
   (the report's token list, mapped onto the existing cozy system — extend, don't replace).
3. **Surface overrides** — a panel may re-tint semantics under a scope class
   (e.g. `.adm-root { --bg-page: … }`) but NEVER invent parallel families.
   `--sbc-*`, `--trd-*`, admin literals all migrate into this model over Phase 2.

Dark mode: `[data-theme="dark"]` re-values semantic tokens ONLY. The
`prefers-color-scheme` mirror block becomes build-generated or scripted-checked
(byte-identical assertion in CI-lite) — no more hand-syncing.

## 2. Type scale (kills the 100 ad-hoc sizes)

`@theme` size tokens (fluid where marked):

| Token | Size | Use |
|---|---|---|
| `--text-display` | clamp(2.1rem→3.4rem) | Hero/display serif |
| `--text-title` | clamp(1.45rem→1.9rem) | Page titles (serif) |
| `--text-heading` | 1.2rem | Card/section titles |
| `--text-body` | 1rem | Default |
| `--text-support` | 0.875rem | Secondary copy |
| `--text-caption` | 0.78rem | Meta/labels |
| `--text-micro` | 0.68rem | Chips/badges — THE FLOOR. Nothing below 0.68rem ever again. |
| `--text-price-lg` | clamp(1.6rem→2.4rem) | Price hero |
| `--text-price` | 1.15rem | Inline prices |

Weight rule: emphasis comes from size+color first; ≥800 weight reserved for prices
and primary CTAs (fixes the inverted small-end hierarchy found in the audit).

## 3. Fonts

- `next/font` self-hosted: **Cormorant Garamond** (400/500/600/700 + italic 400) and
  **Inter** (400/500/600/700). Space Grotesk, Syne, DM Sans retired.
- Exposed as `--font-display` / `--font-body`; the Google `@import` in globals.css
  and the admin/agent `<link>` tags are removed in the same PR that swaps consumers.

## 4. Icons

- `lucide-react` (tree-shaken, `currentColor`, stroke-consistent).
- Shared `<Icon name size>` wrapper for consistent sizing grid (16/20/24).
- Emoji policy: chrome (nav, tabs, tables, buttons, sidebar) = icons ONLY.
  Personality whitelist (allowed): celebration (🎉), passport rank glyphs, season
  badges on the hero, chat/social user content. Everything else migrates.

## 5. Primitives (`components/ui/`)

| Component | Variants | Notes |
|---|---|---|
| `Button` | primary / secondary / ghost / destructive / success · sm/md/lg · loading/disabled | Wraps the proven `.btn-3d` mechanics; ONE gradient token per variant (47 CTA gradients → 5) |
| `Card` | flat / elevated / media | Depth on media tile per `.sbh` learning |
| `Input`, `Select`, `Stepper` | default/error/disabled | Replaces per-panel `.inp-p`, `input-luxury`, bare inputs |
| `Modal` / `Sheet` | center / bottom-sheet | Replaces ~34 hand-built modals over time |
| `Table` | dense / comfortable | Admin/partner/influencer converge |
| `Badge` / `Chip` | info/success/warn/deal/bid | One chip system for the micro-text band |
| `PanelShell` | sidebar / topbar / tabs | 7 hand-built shells converge |
| `Skeleton` | text/card/media rows | 100% loading coverage target |
| `Icon` | — | lucide wrapper |

Rules: primitives use semantic tokens only (zero raw hex), ship with light+dark
verified, and land WITHOUT visual change to existing pages (adoption is per-surface
in later phases).

## 6. Motion language (Phase 3, GSAP + CSS)

- Durations: 120ms (press) / 240ms (reveal) / 400ms (page transition). One easing set.
- Allowed: staggered list reveals, count-ups, press scale, sheet slides, hero crossfade.
- Forbidden: auto-scrolling rails (except the owner-approved ticker), scroll-jacking.
- Everything behind `prefers-reduced-motion` (existing guard block extended).

## 7. Device + quality gates (every phase)

- Device matrix: 280 (Fold) · 360 · 390 · 430 · 768 · 1024 · 1280 · 1920 · 2560,
  portrait+landscape for tablets, notch/safe-area profiles, × light+dark.
- Budgets: LCP < 2.5s (mid-tier Android), CLS < 0.1, no layout jank on rails.
- A11y: AA contrast (both themes), tap targets ≥24px (≥44px for primary), visible
  focus, aria labels on icon-only controls.

## 8. Approved new tooling (owner pre-approved; additive only)

- `lucide-react` (icons) — Phase 0.
- `next/font` (built into Next — no new dep) — Phase 0.
- Playwright visual-regression snapshots (Playwright already in devDeps) — Phase 0/4.
- Optional later, only if needed: `clsx` + `class-variance-authority` for primitive
  variant APIs (tiny, zero-runtime-risk).
- NEVER: `npm audit fix --force`, framework swaps, tailwind.config.js.
