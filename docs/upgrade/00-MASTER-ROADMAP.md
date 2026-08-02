# 00 — StayBid Complete UI/UX Upgrade — MASTER ROADMAP

> **This folder is the program's memory.** Any future session (any agent, any human)
> must read this file + `99-PROGRESS-LEDGER.md` FIRST, then continue exactly where the
> ledger says. Never work from chat memory alone.
>
> Program owner: Sachin (sachinhelpline@gmail.com). Started: 2026-08-02.
> Working branch family: `claude/staybid-ui-ux-*`. All work ships as draft PRs to `main`.

---

## 1. Vision (locked with owner)

Upgrade the COMPLETE application — every panel, every page, every state — to a
modern, ultra-premium standard, defined by these references:

- **Airbnb** — cleanliness: generous whitespace, container-less cards, calm hierarchy.
- **Netflix** — dark drama: cinematic imagery, dark surfaces that let media glow.
- **Apple** — premium minimalism: restraint, one accent at a time, motion with purpose.
- **StayBid itself** — keep its own identity (serif display voice, reverse-auction
  personality, Indian-market warmth). This is an upgrade, not a re-skin into a clone.

Hard requirements (owner):
1. **Light AND dark mode 100% perfect on every surface** — including admin/agent/partner
   (which today are single-mode). Token-driven, never per-selector patches.
2. **Every device class**: Android/iOS phones (280px Fold → 430px Pro Max), tablets
   (768/1024 portrait+landscape), laptops/desktops (1280→2560 ultrawide), Windows/Mac.
   Verified by the existing `responsive-audit/` harness extended per phase.
3. **100% surface coverage** — all 139 pages, all panels, all modals/empty/loading/error
   states. Tracked in the coverage matrix (`01-INVENTORY.md` is the census).
4. **Presentation-only**: money engines, bid lifecycle, security gates, API contracts,
   Circle legal disclosures — STRICTLY untouched.
5. **Owner picks visuals**: before each visually-new direction ships, present 2–3
   mood-boards / sample screens; owner chooses; then implement the chosen one.
6. New tooling is pre-approved by owner where needed for high-level branding
   (icon library, next/font, visual-regression tooling, etc.). Additive only.

## 2. Locked owner decisions (2026-08-02)

| # | Decision | Answer |
|---|---|---|
| 1 | Visual direction | Explore via 2–3 mood-boards each round; owner chooses. |
| 2 | "Modern" references | Airbnb + Netflix + Apple + StayBid identity. |
| 3 | Emoji | UI chrome → professional icon set (lucide). Emoji kept only for celebration/personality moments (🎉 success, season badges). |
| 4 | Fonts | One pair app-wide: Cormorant Garamond (display) + Inter (body); admin/agent migrate off Syne+DM Sans. Serif identity stays. |
| 5 | Bottom nav | 7 → 5: Home · Explore · **Bid (center, highlighted)** · Reels · You. Wishlist → inside You; Hotels → Explore. |
| 6 | Reels CTA | Context-based primary: deal-strong hotel → "Book Now" primary; bidding hotel → "Place a Bid" primary. Never two equal CTAs. |
| 7 | Panel themes | Admin/agent: dark-first but FULL dual-mode. Partner: dual-mode. Everything dual-mode. |
| 8 | Legacy routes | ALL upgraded — model3/model4, kiosk, order, everything. Nothing dropped. |
| 9 | Traffic reality | ZERO real traffic — testing mode, all data is demo. (Rollout can be bold; still keep quality gates.) |
| 10 | Release style | Incremental — each phase merges to `main` when its gates pass. |
| 11 | Version badge | KEEP visible (needed during testing). |
| 12 | Language | English everywhere user-facing. Sweep ALL Hinglish (incl. partner services, errors). ONLY exception: support/complaint chat bot may offer Hinglish as a chat language option. |
| 13 | Logic | Money/payments/bids/security STRICTLY untouched — presentation only. |
| 14 | Pace | Quality-first, phased, stop at phase boundaries for owner "continue". |

## 3. Phase plan

Every phase has: (a) entry criteria, (b) deliverables, (c) EXIT GATES that must all
pass before merge, (d) ledger update. No phase starts until the previous one's gates
are green and the owner has said "continue".

### Phase R — Roadmap (THIS phase)
- R1 inventory (done → `01-INVENTORY.md`), R2 this roadmap + `02-FOUNDATION-SPEC.md`,
  R3 double-verify (invariant map §5, adversarial completeness review), R4 owner sign-off.
- Exit: owner approves roadmap + picks Phase-0 mood-board direction.

### Phase 0 — Foundation (no visual change users notice; everything after gets cheaper)
1. **Mood-boards v1**: 2–3 full visual directions as sample screens (home + flash card +
   admin table in each direction, light+dark). Owner picks one → becomes `02-FOUNDATION-SPEC.md`
   final palette.
2. `components/ui/` primitives: `Button`, `Card`, `Input`, `Modal`, `Table`, `Badge`,
   `PanelShell`, `Skeleton` — variant-driven (extend `.btn-3d`'s proven model).
3. Type scale tokens (~9 steps) into `@theme`; kill the 100 ad-hoc sizes going forward.
4. Icon system: install `lucide-react`; codemod top-40 UI-chrome emoji (≈70% of 4,275 uses);
   personality emoji whitelist documented.
5. Font consolidation: 2 families via `next/font` self-hosting (perf + no render-blocking
   Google `@import`); admin/agent migrate; dead `DM Sans` var removed.
6. Token adoption codemod: top-20 repeated raw hexes → existing `var(--*)`; delete the
   per-selector dark patches they made necessary.
7. Pre-existing bug fixes (already found in audit): flash card double-discount mismatch,
   stale `deal.discount` fallback render, hero "In season now" eyebrow on out-of-season slides.
8. Hinglish sweep pass 1 (customer + partner user-facing strings; chat-bot exception).
- Exit gates: `tsc` + `next build` clean · security suite green · responsive-audit
  (customer sample) green light+dark · no visual regression on unmigrated surfaces ·
  badge bump · ledger updated.

### Phase 1 — Customer core surfaces (highest impact)
- Reels overlay: ~34 → ~12-15 elements; single trust strip; context CTA (decision #6);
  compact creator cluster; remove duplicate score chip.
- Flash deals page: 3-level hierarchy; "Ends in 11h 26m" countdown; rooms-left beside CTA;
  micro-text band consolidation (9 elements @0.46–0.66rem → ≤4).
- Home ("Stage"): resolve flash-deal duplication (ticker vs rail); 3 trip-choosers → 1;
  CTA vocabulary 17 → ~6 standard labels; hero polish.
- Bottom nav 7 → 5 (decision #5) + Explore surface absorbing Hotels+Wishlist entry points.
- Hotels list + hotel detail (most complex page) + bid arena + my-bids + bookings + auth +
  profile/passport surfaces on the new foundation.
- Each visual milestone: 2–3 samples → owner picks → implement.
- Exit gates: full responsive-audit customer surface, light+dark, 8+ devices · CWV budget
  (LCP < 2.5s mid-tier Android) · a11y sweep (contrast AA, tap targets, focus) · ledger.

### Phase 2 — Panels, easy → hard (each its own PR series)
Order: worker → trade → agent(+support components) → influencer → onboard → host →
circle → partner → admin.
- Every panel: migrate to shared primitives + tokens + 2 fonts + icons + dual theme.
- Admin (42 pages, 1,747 inline styles) and partner (3,719-line dashboard, 26 tabs,
  global `<style>` tag) are XL — split into sub-series per section/tab-group;
  incremental extraction, never big-bang rewrites of those two files.
- Hinglish sweep pass 2 (admin/circle/onboard remainder).
- Exit gates per panel: responsive-audit (that surface) · dual-theme visual check ·
  zero regression in panel workflows (manual smoke on demo data) · ledger.

### Phase 3 — Motion & premium polish
- Motion language rollout (GSAP already installed): page transitions, staggered reveals,
  press states, number roll-ups — all `prefers-reduced-motion` safe.
- Skeleton coverage 100% (no blank flashes anywhere).
- Depth/elevation unification (259 gradients → token'd elevation + accent system).
- Imagery treatment pass (consistent crops, gradients, duotones per chosen direction).

### Phase 4 — Dark/light perfection + device certification
- Full-matrix certification: every route × light+dark × device matrix via extended
  `responsive-audit/` + visual-regression snapshots. Fix everything found.
- Samsung force-dark / iOS safe-area / fold posture edge cases.
- The coverage matrix in the ledger reaches 100% green — this is the "100%" proof.

### Phase 5 — Final QA + cleanup
- Delete dead CSS (unused selectors from migrated namespaces), dead theme patches,
  duplicated token blocks (generate the `prefers-color-scheme` mirror from source).
- Docs: update CLAUDE.md current-state; archive this program's ledger as history.

## 4. Verification machinery (every phase)

1. `npx tsc --noEmit` + `npm run build` (both — build catches what tsc can't).
2. `npm run test:security` — must stay green (we never touch auth/money, this proves it).
3. `responsive-audit/run.sh` for the touched surface, light AND dark, 8+ device profiles.
4. Headless GEOMETRY assertions, not screenshots (sandbox blocks media CDNs — measure
   computed styles; known gotchas documented in CLAUDE.md).
5. Ship checklist: badge bump (`SB_BUILD` + visible chip) · `sw.js HTML_CACHE` bump only
   when HTML/UI changed · draft PR via GitHub MCP · ledger entry.

## 5. Invariant protection map (from CLAUDE.md — what each phase must NOT break)

| Invariant | At-risk phases | Protection |
|---|---|---|
| `InstagramHotelFeed` ≤2 styled-jsx blocks (SWC panic) | 1 | New styles go to globals.css; long-term extract subcomponents |
| `.sbh-*` layering contract (globals unlayered beats desktop.css) | 1 | Keep dual-viewport modules single-file unlayered; document in each PR |
| `useSearchParams` needs `<Suspense>` | all | build gate catches |
| No `tailwind.config.js`; `@theme` only | 0 | Foundation edits stay in `@theme` |
| sw.js cache discipline (no cache-nuke) | all | Only `HTML_CACHE` bumps |
| Bid expiry/`parseDbTime`/pay-window logic | 1 | UI reads only via existing `lib/bid-expiry.ts` helpers |
| Flash `/api/flash/near` stale `discount` never rendered | 1 | Derive badges from printed prices (`offPct`) — also fixes existing bug |
| Circle legal framing (no "guaranteed/ROI" on public surfaces) | 1,2 | Copy changes only via `lib/circle/disclosure.ts` constants |
| Reel-dedup 5-hop chain | 1 | Overlay redesign touches presentation, never post/feed data flow |
| Money engines / 4-key verify / tamper-safe checkout | never | No edits to `app/api/**` money routes, `lib/*/engine.ts` |
| Admin/cron auth gates (v621/v622 LOCKED) | 2 | Admin redesign = markup/styles only; `requireVerifiedAdmin` untouched |
| Tap targets ≥24×24 (WCAG 2.5.8) | all | Audit harness asserts |
| Reduced-motion guard | 3 | Every animation behind the existing guard |
| One-deal-one-colour (discount badge = printed-price derived) | 1 | Spec'd in flash redesign |
| English-only user copy (+ chat-bot Hinglish option) | all | Hinglish sweep + PR review check |

## 6. Risk register

| Risk | Mitigation |
|---|---|
| `partner/dashboard/page.tsx` (3,719 lines, global `<style>`) breaks mid-migration | Tab-by-tab extraction; global style block kept until last tab migrated |
| `InstagramHotelFeed.tsx` (5,148 lines) styled-jsx ceiling | Extract overlay subcomponents into new files before restyling |
| Dark-mode regressions on unmigrated pages during token codemods | Codemod only exact-value hex→var swaps; visual-regression snapshots before/after |
| Session context loss over months | This folder + ledger IS the memory; every PR updates the ledger |
| Scope creep into logic | Decision #13 quoted in every PR description; security suite as tripwire |

## 7. Cadence contract with owner

- Before anything visually new: 2–3 samples → owner picks (decision #1/note).
- Stop at every phase boundary; wait for "continue".
- Every PR: draft, with before/after evidence and ledger diff.
