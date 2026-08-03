# 03 — Gap Remediation (adversarial roadmap review, 2026-08-02)

> An adversarial completeness review cross-checked the roadmap against the repo and
> found 30 gaps. Each is resolved below and folded into the plan. This doc is the
> authority where it corrects 00/01/02.

## P0 — Coverage holes (fixes the "100%" claim)

- **G1 — 14+ pages in no phase.** Customer count is **39, not ~25**. The following now
  belong to **Phase 1 (customer, expanded)**: `/discover`, `/complaints`, `/verification`,
  `/verification/record`, `/upgrade`, `/saved`, `/saved/posts`, `/me`, `/me/posts`,
  `/social/feed`, `/social/upload`, `/social/profile/[username]`, `/tag/[name]`,
  `/u/[username]`, `/u/[username]/posts`, `/trust`, `/privacy-policy`, `/r/[code]`,
  `/hotels/[id]/reviews`, `/hotels/[id]/feedback`, `/passport`, `/bookings/*`.
  `/kiosk`, `/kiosk/book`, `/kiosk/display`, `/order/[outlet]` → **Phase 2** (own-chrome
  surfaces, grouped with panels). **Rule: the coverage matrix, not prose, is the
  authority — a page is "in scope" iff it has a matrix row.** `gen-inventory.sh` output
  IS the row set; every one of the 139 must reach green.
- **G2 — global chrome layer owned by nobody → NEW Phase 0.5 "Global Chrome".** These 14
  always-on mounts (`app/layout.tsx:232-275`) migrate together, BEFORE per-page work, so
  no upgraded page sits under un-upgraded chrome: `RouteProgress`, `StatusBarColor`,
  `ServerStatus`, `Navbar` (912 L), `BackChip`, `BottomDock`, `NotificationToast`,
  `PushOptIn`, `PanelSwitcher` (307 L — the cross-panel door), `SupportWidget`,
  `WelcomeStory`, `TutorialHelpButton`, `TutorialTriggerMount`, `AutoNextMount`. Plus the
  heavy shared overlays each get an explicit owner phase: `CreateFlow.tsx` (~4.2k, composer)
  → Phase 1; `BookingChat`, `BookingReview`, `PostsScrollFeed` (1,827), `ActiveBidConflictSheet`
  → Phase 1.
- **G3 — matrix is page-only.** Coverage matrix gains a **component axis**: each phase's
  ledger entry lists the components it migrated (not just pages), with the same
  light/dark/device/icons columns. `components/partner` (22 files/11k L) and
  `components/discover` (11.6k L) are the bulk behind their thin page counts.

## P1 — Verification machinery to BUILD (these are Phase 0 work items, not assumptions)

- **G4 — audit harness has no dark mode.** Phase 0 work item: extend
  `responsive-audit/audit.mjs` to set `sb_theme` (source of truth `lib/theme-store.tsx`)
  and run every route twice (light+dark). Until this lands, no dual-theme gate is real.
- **G5 — half the panels have no route manifest.** Phase 0: add circle/host/trade/worker/
  agent/kiosk/order to `responsive-audit/routes.mjs` `SURFACES`; extend `CUSTOMER_ROUTES`
  with `/passport`, `/bookings/*`, `/trust`, `/verification/record`, `/hotels/*/reviews`,
  `/hotels/*/feedback`, `/discover`, `/me`, `/saved`.
- **G6 — visual-regression has no config/baseline.** Phase 0, FIRST commit before any
  codemod: add `playwright.config.ts` + `e2e/` snapshot capture and **record pre-upgrade
  baselines**. After Phase 0 the pre-upgrade look is otherwise unrecoverable.
- **G7 — `prefers-color-scheme` mirror check.** Add to §4 gates: a script asserting the
  `[data-theme="dark"]` block and the `prefers-color-scheme` mirror stay byte-identical
  (currently 5 mirror blocks + 156 `data-theme` selectors — hand-drift is the #1 dual-theme
  risk).
- **G8 — §4 missing ship-checklist items.** Add: commit trailers, draft PR via
  `mcp__github__` (never `gh`), **never put the model identifier in any commit/PR/artifact**,
  and the additive-only rule (no delete/rename of existing fields/routes) — which the nav
  7→5 merge and Phase 5 dead-CSS pass must honour (redirect, don't delete, live routes).

## P2 — Invariants added to the §5 protection map

- **G9 — driver.js tour selectors (biggest silent breaker).** `lib/tutorial/tutorial-content.ts`
  pins **129 CSS selectors** across 20 tours + `AutoNextMount` depends on **49
  `data-autonext*` attributes**. RULE: any renamed class/id on a toured surface (home
  `.sbh-*`, hotel `.hx-*`, `#availability-picker`, `.hsb`) MUST be updated in
  `tutorial-content.ts` in the same PR. Add a grep-gate: every selector in `PAGE_TOURS`
  must resolve in the rendered DOM.
- **G10 — animation utility contract.** Exactly 10 `.sb-*` + 4 `.hx-*` + `<CountUp>`.
  Phase 3 motion rollout must EXTEND via new primitives, never add an 11th `.sb-*` or
  rename one (used across 19 pages).
- **G11 — `<CountUp>` descendant trap.** Phase 0 type-scale codemod must scope every
  size rule with `>` where it could reach a `<CountUp>` span (documented shipped-invisible
  bug). Add to the codemod checklist.
- **G12 — reels invariants.** `--reel-vh` from `visualViewport.height`; keep immersive
  `requestFullscreen()`; **NO private-DM affordance on any reel surface (v25 anti-bypass)**
  — the "compact creator cluster" must not add a "message host" chip.
- **G13 — copy/legal beyond Circle.** Never show "floor price" in customer UI (show the
  number); partner counters stay the structured `lib/counter-addons.ts` catalog (no
  free-text). Both are in a redesign's blast radius.
- **G14 — passport reads `/api/passport`** (`lib/passport/engine.ts`), never recompute.
- **G15 — `NEXT_PUBLIC_MOBILE_HOME="0"` revert switch** must survive the home redesign
  (`StatusBarColor.tsx:44-52` branches on `.sbh-root`).
- **G16 — chrome-suppression path lists + the new "Explore" route.** Decision #5's
  **Explore is a NEW route** (no `app/explore/` today). Creating it + the nav change must
  update every hard-coded path list: `BottomDock`, `Navbar`, `SupportWidget`, `PushOptIn`,
  `TutorialHelpButton`, and `StatusBarColor.tsx:27 REEL_ROUTES`.
- **G17 — ScrollRail / headless blind spot.** Scrollbars are unverifiable headless
  (CLAUDE.md). Any Phase 3/4 change near `<ScrollRail/>` gets an explicit "reason or ask
  owner, do NOT measure headless" carve-out in that PR.
- **G18 — a11y gate misses zoom.** `app/layout.tsx:43-44` sets `maximumScale:1,
  userScalable:false` (WCAG 1.4.4 fail). Foundation §7 a11y gate now includes: allow
  pinch-zoom (remove the lock) — an owner-facing change flagged for decision.

## P3 — PWA / native (new coverage)

- **G19 — 3 disagreeing theme-colour sources.** `manifest.json` (`#FAF5EB`),
  `app/layout.tsx:39 viewport.themeColor` (`#07060e`), and `StatusBarColor.tsx:27-31`
  runtime hexes must all be driven from the chosen palette tokens. Added to Foundation §1.
  StatusBarColor also keys off `.sbh-root`/`.fdeal-rail-wrap` class names Phase 1 rewrites.
- **G20 — shipped Play-Store TWA (`assetlinks.json`, `com.staybid`).** Consequences:
  (a) manifest `name`/`theme_color`/`background_color` bake into the **TWA splash** at
  Play-build time — a palette change needs a **new Android release**, not just a Vercel
  deploy (OWNER OPS item, flagged). (b) `manifest.json "orientation":"portrait"`
  **contradicts** hard-requirement #2 (tablet landscape) for installed users — decision
  needed: relax to `any` or accept portrait-lock on installed app.
- **G21 — `sw.js HTML_CACHE` bump tied to evidence.** Each UI phase that changes HTML
  bumps `HTML_CACHE` as part of the ship-checklist evidence step. Branding-icon changes
  (`/icons/icon-192.png` etc. referenced in `sw.js` push handler) are an explicit item if
  the icon set changes.

## P4 — Factual corrections

- **G22 — `InstagramHotelFeed.tsx` already has 3 `<style jsx global>` blocks** (lines
  799, 1519, 3844), not ≤2; in-file comment cites a stale pair. §5 row-1 corrected: the
  ceiling rule needs re-validation. **Before Phase 1 restyles this file, first confirm
  the real SWC-panic trigger** (3 global blocks currently build fine — the documented
  ceiling may be about `<style jsx>` scoped blocks / IIFE-JSX, not global blocks).
- **G23 — CLAUDE.md current-state is stale** (says v571/HTML v372; real is
  `SB_BUILD v624`, `HTML_CACHE staybid-html-v421`). Treat `app/layout.tsx` + `sw.js` as
  the version truth, not CLAUDE.md's narrative. CLAUDE.md refresh moved EARLIER (end of
  Phase 0, not Phase 5).
- **G24 — count fixes.** Partner dashboard = **24 tabs** (23 static + conditional
  `myrooms`), not 26. Gradient scope repo-wide = **576 CSS + 633 TSX = ~1,200**, not 259 —
  Phase 3 elevation scope corrected (~4-5× larger).
- **G25 — dead file + missing live file.** `components/DialerNav.tsx` (736 L) is
  **retired (v80), mounted nowhere** — REMOVE from the Hinglish sweep; add a **dead-code
  pass** to Phase 5 (currently only dead CSS). The **tutorial layer** (`tutorial-content.ts`,
  1,175 L, **20 `hi:` Hinglish locale blocks** + globally-mounted `LanguageToggle.tsx`
  EN⇄Hinglish toggle) is an **unresolved decision #12 conflict** → see Decision Register.
- **G26 — 9 files import Google Fonts**, not 3. Full list added to Foundation §3:
  `globals.css:4`, `admin/layout.tsx:86,106`, `admin/login:78`, `agent/layout.tsx:44,81`,
  `agent/login:103`, `partner/page.tsx:114`, `partner/staff:42`, `partner/dashboard:1017`,
  `order/[outlet]:100`.
- **G27 — `/redeem` route does not exist.** Real shells: `/points/redeem`, `/points`,
  `/wallet`, `/my-codes`. Inventory §F corrected.

## P5 — Plan contradictions resolved

- **G28 — Phase 0 "no visual change" is false.** RESOLUTION: Phase 0 split.
  **Phase 0a (invisible foundation):** primitives, tokens, type-scale, harness/VR tooling,
  font infra — no consumer swapped, truly invisible. **Phase 0b (intentional visible
  fixes):** emoji→icon chrome codemod, hex→token codemod, the 3 pre-existing bug fixes,
  Hinglish sweep — these ARE visible and that's fine (zero real traffic, decision #9).
  The "no visual regression" gate applies to 0a only; 0b changes are owner-reviewed via
  before/after evidence.
- **G29 — nav 7→5 drops Flash Deals entry.** RESOLUTION: Flash Deals lives INSIDE Explore
  (Explore = browse hub: Hotels + Flash Deals + search + Wishlist entry). Confirmed as the
  Explore surface's job. Bid stays center. Decision #5 stands with this clarification.
- **G30 — admin/agent fonts scheduled twice.** RESOLUTION: font INFRASTRUCTURE (next/font
  setup, family swap in `globals.css`) is Phase 0a; per-panel CONSUMER migration
  (admin/agent `<link>` removal + class swaps) happens in that panel's Phase 2 slot. No
  double-work; Phase 0 does not restyle admin pages.

## Decision Register (owner input needed — not blocking mood boards)

| ID | Question | Default if silent |
|---|---|---|
| D1 | Tutorial Hinglish (`hi:` tour locale + `LanguageToggle`): kill Hindi tours (English-only), OR keep as a 2nd decision-#12 exception like the chat bot? | Keep toggle (parity with chat-bot exception) until owner says otherwise |
| D2 | `manifest.json` orientation portrait-lock vs tablet landscape (#2)? | Relax to `any` for tablet landscape |
| D3 | Remove `userScalable:false` (enable pinch-zoom, WCAG)? | Remove the lock |
| D4 | Palette change → new Play-Store TWA release (owner ops)? | Flag as owner-ops when palette lands |
| D5 | Admin/agent: full dual-mode confirmed (decision #7) — includes light mode for a dark-console panel? | Yes per #7 |
