# 99 — Progress Ledger (update after EVERY work session / PR)

> Read `00-MASTER-ROADMAP.md` first. This file says where we ARE.

## Coverage matrix (summary — detail per panel added as phases run)

| Surface | Pages | Redesigned | Light ✓ | Dark ✓ | Devices ✓ | Icons ✓ | English ✓ |
|---|---|---|---|---|---|---|---|
| customer core | ~25 | — | — | — | — | — | — |
| admin | 42 | — | — | n/a→pending | — | — | — |
| partner | 4 | — | — | — | — | — | — |
| circle | 19 | — | — | — | — | — | — |
| host | 11 | — | — | — | — | — | — |
| influencer | 9 | — | — | — | — | — | — |
| onboard | 5 | — | — | — | — | — | — |
| trade | 4 | — | — | — | — | — | — |
| agent+support | 4 | — | — | — | — | — | — |
| worker | 2 | — | — | — | — | — | — |

## Session log

### 2026-08-02 — Session 1 (Phase R)
- Full codebase audit completed (5 parallel deep audits: reels overlay, flash card,
  home, design system, all 9 panels). External screenshot report verified: ~75-80%
  accurate; understated on density (reels ~34 elements), outdated on theme (steel-blue,
  not gold), blind to panel fragmentation (6 token systems).
- 3 pre-existing bugs logged for Phase 0: flash double-discount mismatch
  (`app/flash-deals/page.tsx` headlineDisc vs discPct), stale `deal.discount` fallback
  render (same file ~:743), hero "In season now" eyebrow on out-of-season slides
  (`components/home/DesktopHome.tsx:1459-1463`).
- Repo scope verified via GitHub: upgrade = `staybid-frontend` ONLY; `staybid-Live`
  protected (API-only); 4 abandoned repos never touched.
- Owner locked all 14 decisions (see roadmap §2).
- Hinglish confirmed real (partner dashboard :1801) — sweep scoped in inventory §E.
- Created: 00-MASTER-ROADMAP, 01-INVENTORY (+gen script), 02-FOUNDATION-SPEC, this ledger.
- R3 double-verify DONE: adversarial roadmap review found 30 gaps → all folded into
  `03-GAP-REMEDIATION.md` (coverage holes, global-chrome phase, dark-mode harness to build,
  driver.js tour-selector invariant, PWA/TWA theme colours, Phase-0 split, factual fixes).
  5 owner decisions parked in the Decision Register (D1-D5) — non-blocking.
- Draft PR #536 opened + Vercel preview Ready (docs-only, clean).
- NEXT: mood-boards v1 (3 directions × home + flash card + admin table, light+dark).

### 2026-08-02 — Session 1 (Phase 0a — invisible foundation, shipped)
- Owner locked **Direction A (Refined Pewter)** with the EXACT live palette (no colour
  change) → `04-DIRECTION-LOCKED.md`. Round-2 home-screen board delivered + approved-to-proceed.
- **Phase 0a foundation shipped (additive/invisible — no existing surface changed):**
  - `app/globals.css`: appended "UI UPGRADE — FOUNDATION LAYER" — `--fs-*` type scale
    (9 steps; `--fs-*` NOT `@theme --text-*` to avoid Tailwind utility collision),
    radius/elevation tokens, `--sbui-btn-primary-bg` = exact live pewter gradient,
    `--sbui-success/warning/danger` (light+dark), and `.sbui-*` primitive styles.
  - `components/ui/`: `Button`, `Card`, `Badge`, `Skeleton`, `Icon` (+ `APP_ICONS` curated
    map), `index.ts` barrel, `README.md`. All token-driven, light+dark, RSC-safe, UNUSED
    (adoption is later phases).
  - Installed `lucide-react` (owner-approved icon lib; verified genuine, React 19 peer).
- **Gates GREEN:** `tsc --noEmit` 0 · `npm run build` 0 (full route tree) · `npm run
  test:security` 385/0. Baseline tsc confirmed clean BEFORE changes.
- Design tokens exist but are consumed by nothing yet → zero visual change (verified by
  clean build parsing globals.css + no `.sbui-*`/`--fs-*` reference on any existing element).
- **Phase 0a cont. — dark-mode audit harness SHIPPED (gaps G4/G5):**
  - `responsive-audit/audit.mjs`: `--theme light|dark|both` (default both). Forces the
    theme by seeding `sb_theme` before first paint (verified real key: `app/layout.tsx:160`
    no-FOUC bootstrap; the adversarial review's `lib/theme-store.tsx:42` line ref was
    approximate). Records `themeApplied` (reads back `data-theme`) so a theme that didn't
    apply is flagged. Screenshots + report gain a theme axis. Added a Chromium
    `executablePath` resolver (managed runners pin a build number Playwright can't
    auto-download; `playwright install` is blocked) — env override → `chromium` symlink →
    `chromium-<n>` glob → default.
  - `responsive-audit/routes.mjs`: added the 7 missing surfaces (circle 18 · host 11 ·
    trade 4 · worker 2 · agent 4 · kiosk 3 · order 1) + missing customer routes (passport,
    trust, privacy-policy, verification/record, hotel reviews/feedback, r/[code]). Now 12
    surfaces / 125 route-entries (was 5 / ~50). `ALL_SURFACES` export added.
  - **PROVEN:** smoke run `--only / --theme both` → home rendered in light AND dark,
    `themeApplied` == requested for both, 0 overflow, 0 errors, chromium resolved.
- NEXT (Phase 0a cont.): (1) Playwright visual-regression config + pre-upgrade baselines
  BEFORE any consumer swap (G6); (2) next/font infra. THEN Phase 1 adoption.
- Open owner Qs (non-blocking): flash "% OFF" steel vs gold; Decision Register D1-D5.

<!-- Append new sessions ABOVE this line’s template:
### YYYY-MM-DD — Session N (Phase X)
- done / verified / decided / NEXT
-->
