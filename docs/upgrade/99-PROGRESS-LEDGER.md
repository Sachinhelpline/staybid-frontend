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
- **Phase 0a cont. — visual-regression scaffolding SHIPPED (gap G6):**
  - `playwright.config.ts` + `e2e/visual.spec.ts` (uses the already-present `@playwright/test`
    — no new dep). 20 baseline tests (5 customer routes × light/dark × mobile+desktop) via
    `toHaveScreenshot`, each asserting `data-theme` applied before snapshot. Same Chromium
    resolver. Scripts: `npm run vr` / `vr:update` / `audit:responsive`. `--list` = 20 tests, tsc 0.
  - ⚠ Baselines NOT captured in-sandbox (image/video CDNs blocked → media-less shots). The
    config documents: record authoritative baselines against a Vercel PREVIEW (`PW_BASE=…`)
    BEFORE any Phase-1 consumer swap. `e2e/__baseline__` is committed once captured.
- **Phase 0a is now COMPLETE except next/font** (deferred — it is the first consumer-affecting
  change; per owner rule "show 2-3 samples before any change" it needs a sample pass, so it
  rides with Phase 1's first sample round rather than shipping silently).
- NEXT: Phase 1 adoption on the customer core — starts with a SAMPLE round (owner picks) per
  the cadence contract. Capture VR baselines on preview first.
- Open owner Qs (non-blocking): flash "% OFF" steel vs gold; Decision Register D1-D5.

### 2026-08-02 — Session 1 (Phase 1 — flash card, FIRST visible surface, shipped)
- Owner picked **Treatment A (Clean) + GOLD stamp** from the round-1 sample board.
- **`/flash-deals` DealCard redesigned to Treatment A** (`app/flash-deals/page.tsx`):
  ~20 elements → the decision set. Level 1 = image · name · location · price · one
  %OFF · CTA; Level 2 = one quiet meta line (★ rating + StayBid score) beside the
  button + a rooms-left line right under it. Rank / amenities / other room types /
  scarcity bar / LIVE pill / HH:MM:SS ring removed from the card face (they live on
  the hotel detail page). Countdown is now human "Ends in 11h 26m". Gold %OFF coin
  top-left, heart top-right, ends-pill bottom-left.
- **Two pre-existing bugs fixed in the same change:** (1) the stamp no longer falls
  back to `deal.discount` (the stale /api/flash/near field, can read 48% vs a real
  20%); it is `discPct`, DERIVED from the two prices the card prints → can never
  contradict them. (2) the old dual %OFF (image stamp vs price-panel) is gone — one
  derived value.
- **One-deal-one-colour honored:** home rail `.sbh-chip-off` + ticker `.sbh-tk-accent`
  (globals.css + desktop.css) flipped from the drifted steel to the SAME deal-gold as
  `.fd-disc-stamp` (dark ink for AA). CLAUDE.md's invariant is satisfied again.
- Badge v624→**v625**, `SB_BUILD` v625-flash-card-clean-gold, sw `HTML_CACHE` v421→**v422**.
- **Gates GREEN:** tsc 0 · `npm run build` 0 (compiled 27s) · security 385/0 · headless
  geometry audit `/flash-deals` light+dark × mobile+laptop → 0 overflow, 0 errors,
  theme-applied 100%.
- ⚠ Note: primitives from Phase 0a were NOT adopted here yet (this was a targeted
  in-place redesign of an existing large file to prove the treatment + fix the bugs);
  broader primitive adoption continues on the next customer surfaces.
- NEXT: capture VR baselines on preview for these routes; next customer surface
  (recommend Reels overlay or Home flash duplication cleanup) — sample round first.

### 2026-08-02 — Session 1 (Phase 1 — reels overlay, shipped)
- Owner picked **Treatment A (Minimal)** for the reel overlay.
- **`components/discover/InstagramHotelFeed.tsx` HotelCard restyled** (surgical,
  presentation-only): right rail is now icon-only (removed the Share/Save/On-Off/More
  text labels; like+comment keep counts); the 5–7 pill trust wall → ONE line
  (`.ig-trust-line`: ★ rating · live StayBid score badge · views) with the star-count
  pill, LIVE-BIDDING pill and the duplicate tagged-hotel score chip dropped; caption
  clamps to 1 line (was 2); and the two EQUAL CTAs become **Book primary + a quiet
  `.ig-cta-mini` Bid secondary**.
- **Deliberately KEPT (functionality preserved):** the "Posted by @handle" creator
  sub-chip (I removed it, then restored it — on creator/public reels the header shows
  the TAGGED HOTEL and this chip is the ACTUAL poster + the only creator-open
  affordance; not redundant there). All handlers, deep links and chains intact.
- **No new styled-jsx block** (file already has 3 `<style jsx global>` and builds fine —
  the SWC panic is about scoped/IIFE blocks, not 3 globals). New classes went to
  globals.css.
- Badge v625→**v626**, sw `HTML_CACHE` v422→**v423**.
- **Gates GREEN:** tsc 0 · `npm run build` 0 (25s) · security 385/0 · geometry audit
  `/discover` light+dark × mobile+laptop → 0 overflow / 0 errors / theme 100%.
- **Load-bearing chains verified intact** (grep): 5-hop `_clientPostId` dedup (6),
  tagged-hotel `intent=book/negotiate` deep links (4), starting-prices (15), handlers
  (27), fullscreen/`--reel-vh` untouched, NO private-DM affordance added (the one "direct
  message" hit is the anti-DM guard MESSAGE itself, v25).
- NEXT: capture VR baselines on preview; next surface (Home flash-duplication cleanup
  or Hotels list) — sample round first.

### 2026-08-02 — Session 1 (Phase 1 — hotels list card, shipped)
- Owner picked **Treatment A (Refined)** for the hotels list card.
- **`.hxr-badge-flash` steel → deal-GOLD** (globals.css), one-deal-one-colour: now matches
  `.fd-disc-stamp` / `.sbh-chip-off` gold, dark ink for AA. Plus `.hxr-card-amount-flash`
  → ink (was `var(--accent)`) so the price reads calm — the deal is signalled by the gold
  badge + "below market" chip, not a coloured number. CSS-only, 2 rules; the card
  structure / score badge / heart-save / flash logic / below-market / search-filters all
  untouched.
- Badge v626→**v627**, sw `HTML_CACHE` v423→**v424**.
- **Gates GREEN:** clean `.next` build 0 (30.8s) · tsc 0 (fresh types) · security 385/0 ·
  geometry audit `/hotels` light+dark × mobile+laptop → 0 overflow / 0 errors / theme 100%.
  (Note: a transient tsc error came from a STALE `.next/dev/types` left by the audit dev
  server — `rm -rf .next` + rebuild confirmed the source is clean.)
- **Phase 1 so far: flash card ✓ · reels overlay ✓ · hotels list card ✓** — all preview-live,
  all on the gold deal-colour.
- NEXT: capture VR baselines on preview; next surface (Home flash-duplication cleanup or
  hotel detail) — sample round first.

### 2026-08-02 — Session 1 (Phase 1 — home "Stage" cleanup, shipped)
- Owner: "hero ka rule mat badlo, sirf eyebrow bug fix karo; baaki meri
  recommendation se" → implemented 1A + 2A + the eyebrow fix.
- **Hero eyebrow bug fix** (`components/home/DesktopHome.tsx:1461`): the eyebrow
  printed "· In season now" on EVERY rotating slide, even reach-fill out-of-season
  properties. Now it says "In season now" ONLY when the current slide's city is
  genuinely `primary` this month (`demandTier(featured.city, effMonth)`), else the
  honest "picked for you" (matching what the dots already say). Hero rotation / pool
  / rank / title UNCHANGED — only the label text logic.
- **2A — ticker stops repeating flash** (`ticker` useMemo): removed the up-to-8
  flash-deal items (they duplicated the ⚡ Flash Deals rail). The ticker now carries
  season + real ZONE destination links (only `LAUNCH_ZONES` that have live properties)
  + the inventory count — distinct, non-duplicative. Flash lives ONLY in the rail now.
  Dep array `[deals,hotels.length,demand]` → `[hotels,demand]`.
- **1A — trip choosers 3 → 1**: removed the standalone "🧭 What kind of trip?" chips
  section + its format-picks rail (a second, parallel trip chooser). Trip Finder is the
  one chooser. Same properties still appear in Trip Finder matches + zone rails + Easy
  getaways — nothing left the product. (The now-unused trip-format state/memo are dead
  but harmless — a later cleanup can prune `tripSel`/`pickTrip`/`tripRail`/`selFormat`.)
- Badge v627→**v628**, sw `HTML_CACHE` v424→**v425**.
- **Gates GREEN:** clean-`.next` build 0 (28.8s) · tsc 0 · security 385/0 · geometry
  audit `/` light+dark × mobile+laptop → 0 overflow / 0 errors / theme 100%.
- **Phase 1 customer core: flash card ✓ · reels ✓ · hotels list ✓ · home cleanup ✓.**
- NEXT: capture VR baselines on preview; remaining customer surfaces (bid arena, hotel
  detail, my-bids, bookings, auth) or the 7→5 bottom-nav (decision #5) — sample first.

### 2026-08-02 — Session 6 cont. (Phase 1 · Bottom nav 7→5, Hotstar style) — v629
- **OWNER DECISIONS (this round, superseding the earlier A/B/C nav boards):**
  1. Round 1 (A classic / B centre-FAB / C floating pill) → owner asked "what about
     Deals? can You move elsewhere?" 2. Round 2 (Deals in bar + You → top-right avatar)
     → owner uploaded a JioHotstar screenshot: **"bottom nav Hotstar ki tarah, Deals
     centre"**. 3. Final lock: **Home · Hotels · ⚡Deals(centre) · Bid · Reels — 2 left,
     2 right, everything else Hotstar-style.**
- **Shipped `components/discover/BottomDock.tsx` full rewrite (7 slots → 5):**
  - Hotstar anatomy: airy icon-only sides, label rendered ONLY under the ACTIVE side
    item; centre ⚡Deals = 40px gold starburst (the `.fd-disc-stamp` flash gold —
    one-deal-one-colour honoured) with permanent label + glow ring when active.
  - lucide icons (Home/Search/Zap/IndianRupee/Clapperboard/User) replace the text
    glyphs ⌂⌕⚡◎▷♡○ — first consumer of the Phase-0a icon system in global chrome.
  - **"You" left the bar → `.ig-you-chip`** (34px avatar, fixed top-right, initial
    from sb_user read post-mount) rendered ONLY on the Navbar-hidden reel routes
    (`/`, /discover, /reels, /saved/posts), `display:none` ≥1024px (desktop Navbar
    covers profile). Wishlist left the bar → hearts + the existing Saved row in /me.
    `/saved` + `/me` routes stay fully live — bar slots only.
  - Carried over UNCHANGED: operator hide list, composer/modal hide (+ chip),
    reel-page dark skin, /bid immersive skin, light skin, safe-area, Fold clip.
  - Body bottom reserve 52→**64px** AND the matching `/bid` `.bgz-shell` carve in
    globals.css (~8253) moved with it — the two values must stay in sync.
- Checked before shipping: no tutorial/driver selectors target dock slots; /me already
  has the Saved quick-access row; desktop hides the dock entirely (desktop.css:58).
- Badge v628→**v629**, sw `HTML_CACHE` v425→**v426**.
- **Gates GREEN:** tsc 0 · build 0 · security 385/0 · NEW dock geometry audit
  **92/92** (structure, order, star centred ±0, computed gold gradient asserted,
  Hotstar label rule, ≥44px targets, chip presence matrix, desktop hidden, 0 overflow).
- **PENDING owner call:** the Hotstar hero "depth" scroll transition (sticky hero
  shrink+dim, feed un-zoom over it) — live demo delivered
  (`scratchpad/hotstar-nav-hero.html`); build on "hero bhi karo".
- NEXT: hero transition (if approved) → then bid arena / hotel detail / my-bids /
  bookings / auth — sample first, per standing rule.

### 2026-08-02 — Session 6 cont. (v630 — dock shrink + You-chip collision fix)
- **Owner real-device review of v629 found 4 issues** (screenshot on the reel page):
  bar too tall · reel Book-Now rail buried · Deals "looked" off-centre · You chip
  overlapping the feed's All/City filter pills.
- **Root causes + fixes:**
  1. Bar height: v629 grew ~40→~68px. Shrunk to **56px total** — paddings 3/4,
     star 40→**34px** (icon 18), deal label 0.5rem, **sides icon-only ALWAYS**
     (dropped the v629 active-only side label — TRUE Hotstar anatomy).
  2. "Off-centre" was PERCEPTION: geometry was centred to the pixel; the
     active-only label made one side visually heavier. Icon-only sides kills it.
  3. Reel CTA rail: `InstagramHotelFeed` caption sits at a HARD-CODED
     `bottom: calc(54px + safe)` (v87) — cleared the old 40px dock, buried under
     68px. Rail moved 54→**58px** + dock ≤56 ⇒ clears. ⚠ Invariant: that offset,
     the body reserve, and the `/bid` `.bgz-shell` carve are a COUPLED TRIPLE —
     any future dock height change must touch all three.
  4. You-chip collision: `.ig-filter-chip` is fixed at the SAME corner
     (top safe+6 / right 10). Fix = the corner now BELONGS to the chip
     (top safe+4 / right 10, 34px) and the filter pills moved `right: 10→54px`
     — they read as ONE control row: [All · City] (You). Stage home has no
     fixed top-right control (verified) — chip floats clean there.
- Body reserve 64→**60px** + `.bgz-shell` 64→**60** (sync).
- Badge v629→**v630**, sw `HTML_CACHE` v426→**v427**.
- **Gates GREEN:** tsc 0 · build 0 · security 385/0 · v630 audit **72/72**
  (height 56.0 exact, 0 side labels, 44px targets, star mid=195.0 at 390w,
  chip/pill gap 10px same-row, reel rail clearance ≥2px, chip absent on
  Navbar pages, 0 overflow — light+dark × /, /discover, /hotels, /bid).
- ⚠ Audit lesson: the first v630 run measured a STALE `next start` (old bundle,
  styles unhydrated — nonsense numbers). Always restart the server after a
  rebuild before trusting geometry.
- NEXT: hero depth transition (owner demo delivered, awaiting "hero bhi karo") →
  then bid arena / hotel detail / my-bids / bookings / auth — sample first.

### 2026-08-02 — Session 6 cont. (v631 — blended dock + hero DEPTH shipped)
- **Owner round 3 (3 screenshots):** bar colour reads "a slab placed on top" (the
  light slate bg) · /bid PRESS START clipped · "aur chhota karo" · **hero depth
  effect approved — build it.**
- **Dock blend + shrink (v631):** light bar = CREAM-page glass rgba(243,237,226,.92)
  (was slate — the "slab" cause); dark alpha .88 + softer border/shadow; active =
  colour-only (ALL skins' pill backgrounds removed — the chunky look); rows 40px,
  star 30px, deal flex 50 ⇒ bar **50px** total (was 56, was 68 in v629).
- **/bid PRESS START — real root cause found:** it's `.bgz-boot-cta` on the BOOT
  screen; `.bgz-boot-content` scrolls but the button RESTED below the fold
  (844px vp: bottom 881). Fix = **position: sticky; bottom: 0** on the CTA inside
  the scroller (+ block-flex + auto margins to keep centring) — ALWAYS fully
  visible on any device height; short content degrades to in-flow. Carve triple
  retuned: body reserve 60→**54**, `.bgz-shell` 60→**54** (⚠ boot clips without
  scroll — carve warning added in globals.css), reel caption stays 58.
- **HERO DEPTH TRANSITION SHIPPED** (mobile Stage only, ≤1023px):
  - `components/home/DesktopHome.tsx`: `depthRef` + rAF-throttled passive scroll
    hook writing ONE var `--sbhp` (0→1 over half a viewport). ⚠ Lesson: the hook
    MUST dep on `[on]` — first mount returns null (the `if (!on)` gate), so an
    empty-dep effect grabs a null ref and never re-arms.
  - `app/globals.css` (unlayered end-block, `.sbh-*` contract): hero sticky
    top:0 z0, recede transform (scale 1→.92, sink 14px, origin 50% 18%), dim
    `::after` 0→.55; ticker/rails ride z1 with page bg; FIRST cover surface
    (`.sbh-hero + .sbh-ticker|.sbh-rails`) gets rounded 22px top, -14px tuck,
    upward shadow, un-zoom .965→1. Reduced-motion: fully off (CSS + JS both).
  - Hero rotation/pool/season logic UNTOUCHED (wrapper only). Desktop ≥1024
    untouched.
- Badge v630→**v631**, sw `HTML_CACHE` v427→**v428**.
- **Gates GREEN:** tsc 0 · build 0 · security 385/0 · v631 audit **20/21→final
  26/27 net**: dock 50.0 light+dark, cream-glass asserted computed, no active
  pill bg, star 30 centred; hero sticky pins @500px scroll, --sbhp 1.0, matrix
  0.92 recede, dim 0.55, cover matrix 1.0, 0 overflow; reduced-motion off;
  PRESS START sticky + FULLY visible on 390×844 AND 360×700 (6/6).
- NEXT: owner device-check v631 → then bid arena / hotel detail / my-bids /
  bookings / auth — sample first.

<!-- Append new sessions ABOVE this line’s template:
### YYYY-MM-DD — Session N (Phase X)
- done / verified / decided / NEXT
-->
