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

### 2026-08-02 — Session 6 cont. (v632 — cover unified, fade-glass bar, boot fits)
- **Owner round 4 (3 screenshots):** hero cover = ugly white ticker band + gap +
  no curve · bar = "colour change nahi bola tha, TRANSLUCENT fade bolna tha" ·
  /bid still scrolls + content hides behind sticky CTA · desktop flash rank chip
  under Grab-now · home flash chip still old hh:mm:ss.
- **Hero cover UNIFIED:** the v631 mistake was styling the TICKER as a separate
  cover sibling (white band floating on the hero + see-through margin gap).
  Ticker JSX moved INSIDE `.sbh-rails` (first child, markup unchanged) — the
  cover is ONE continuous panel: 22px rounded top, -18px tuck, upward shadow,
  bg = the root's layered gradient (never flat --bg-page). Un-zoom softened
  0.965→**0.985** (0.965 on the full panel exposed page-bg side strips = the
  "white background").
- **Bar = FADE-GLASS:** original skin colours as a vertical gradient — bottom
  solid → top fully transparent + blur; border-top/box-shadow REMOVED in all 4
  skins (those hard lines were the "slab"). Light slate / dark graphite / reel
  near-black / bid cocoa all fade now.
- **/bid boot NO-SCROLL fit — two cascade traps found + fixed:**
  1. The compression block sat BEFORE the base `.bgz-boot-*` rules AND before a
     `(max-width:380px)` block — equal specificity ⇒ source order ⇒ silently
     dead. Block MOVED to after everything (warning comment added).
  2. Measured driver: step rows were EYEBROW-limited (46px disc + 69px text =
     121px × 5); real classes `.bgz-boot-step-eye-title/-eye-sub` (not the
     container). Disc 32px + type cuts + 88px column + card trims ⇒ boot fits
     with **0px internal scroll at 844 / 780 / 700** heights, PRESS START in
     flow (sticky now inert, kept as short-device safety).
- **Flash cards:** `.fd-foot-right` column — RANK chip stacked ABOVE Grab now
  (desktop overlap gone; fills the mobile dead space). Home FlashCard chip now
  prints the SAME "Ends in Xh Ym" as /flash-deals (`endsLabelFromClock`).
- Badge v631→**v632**, sw `HTML_CACHE` v428→**v429**.
- **Gates GREEN:** tsc 0 · build 0 · security 385/0 · v632 audit 28/30 → boot
  fit rerun **3/3** (net all green): ticker-inside-rails, 22px curve, 0.985→1.0
  cover, dim .55, fade-gradient asserted computed in both themes, no border/
  shadow, bar 49px, rank-above-button both breakpoints, 0 overflow.
- NEXT: owner device-check v632 → next surface samples.

### 2026-08-02 — Session 6 cont. (v633 — depth grammar rebuilt "last chance" pass)
- **Owner round 5 (final warning):** hero still ugly · dock icons illegible ·
  /bid over-compressed (dead space both ends) · a "second bar" behind the /bid
  dock — demanded root-cause study + references before building.
- **THE MISSING GRAMMAR (researched: Hotstar/Netflix/Disney+ pattern):** the
  seam was the flaw — every streaming app hides it with **TONAL CONTINUITY**:
  the hero artwork's FOOT fades into the page background colour, so the cover
  panel emerges from its own colour, never off a raw photo cliff.
- **Hero v633 (full rebuild of the block, end of globals.css):**
  ① `.sbh-hero::before` FOOT FADE (bottom 26% → var(--bg-page)) at **z:1 —
  above photo+scrim, BELOW .sbh-hero-inner (z:2)** ⇒ hero's white text/CTAs
  never sit on a cream fade in light theme. ② recede softened to premium
  values: scale 1→0.94, sink 10px, dim 0.45 (6% shrink reads premium, 8% read
  cartoon). ③ cover: radius 24, padding-top 14 (chips off the radius), tuck
  -24px so the panel edge RESTS INSIDE the faded zone at rest — seam soft at
  every frame; dark-theme shadow variant. Reduced-motion: motion off, foot
  fade STAYS (composition, not motion).
- **Dock legibility:** fade steepened — transparent only in the top 18%
  (0.72@18% → 0.93@45% → 0.96); icons sit at 29% (inside the ≥0.72 zone);
  inactive light ink deepened #33465c; theme-matched drop-shadow halos.
  The soft "melt" top edge is preserved.
- **/bid "second bar" ROOT CAUSE:** the v614 shell carve strip (54px) exposes
  the UNDERLYING page (cream) through the glass dock's transparent top — the
  old opaque dock hid it by accident. Fix: `body.sb-bid-immersive::after`
  fixed dark underlay (#0d0a05 = the same family as the CTA-rail gradient +
  the existing #sb-safe-top-fill precedent), **z:59 under the z:60 dock**,
  mobile-only, auto-removed on route leave. rail→strip→glass = one dark foot.
- **/bid boot FLUID fit (replaces v632 fixed micro-compression):** every
  vertical spender = clamp(min, svh, max) — tall phones relax to comfortable
  sizes, short compress; content ≈ fills shell. Verified: **0px scroll +
  ~97% fill at 700/780/844/915** heights (both dead-space AND overflow gone).
  ≤800h drops the tracker sub-line; ≤720h micro-step. Documented floor:
  640px-class (<2% devices) scrolls 28px with the sticky-CTA safety net.
- Badge v632→**v633**, sw `HTML_CACHE` v429→**v430**.
- **Gates GREEN:** tsc 0 · build 0 · security 385/0 · v633 audit **42/43 →
  final fit 4/4 target heights** (foot-fade computed both themes, z-order
  1<2 asserted, tuck 24, recede matrix 0.94/10, dim 0.45, dock stops+halos
  computed, underlay 59<60, reduced-motion split verified).
- ⚠ CSS-cascade lesson bank (bit us twice today): equal-specificity override
  blocks MUST sit after their base rules AND after any later media blocks;
  and a python splice needs a brace-count check (one stray `}` broke build).
- NEXT: owner verdict on v633 → next surface samples.

### 2026-08-02 — Session 6 cont. (v634 — hero LAG-EXIT + 3D flash cards)
- **Owner round 6 (2 Hotstar reference screenshots + 1 flash-card ss):** the
  real Hotstar hero motion is NOT a pin — the hero **exits INTO the top**
  ("top se andar chala gaya") while the next surface overtakes it. Plus:
  flash card dead space, bottom line, wants 3D raised shadow + scroll motion.
- **Hero motion corrected (v633 sticky pin → v634 LAG-EXIT):** hero is
  `position: relative` again and counter-translates +22vh over the
  transition ⇒ it leaves at **~56% of scroll speed** (measured 168px per
  300px scroll), shrinking toward the TOP edge (origin 50% 0%), dimming,
  while the cover overtakes from below. A pinned hero "waits"; Hotstar's
  hero "leaves" — that distinction was the missing feel. Foot fade, cover
  panel, reduced-motion split all carried over.
- **Flash card 3D (owner spec, `/flash-deals` DealCard):** border REMOVED
  (the "bottom line"); depth = 4-layer ambient shadow (long cast + mid
  bloom + contact edge + inset top highlight), light + dark variants.
  Body/foot/urgency spacing tightened (~18px dead height shed) + image
  158/174px. **Scroll-linked entrance** via the house `useReveal` IO hook
  (NOT a new utility — the v134 pattern): cards start translateY(26px)
  scale(.975) opacity 0 and rise+settle on viewport entry, 50ms column
  stagger. ⚠ `.fd-card-skel` shares the class — forced visible or the
  loading grid vanishes. Reduced-motion: hook + CSS both bail.
- Badge v633→**v634**, sw `HTML_CACHE` v430→**v431**.
- **Gates GREEN:** tsc 0 · build 0 · security 385/0 · v634 audit **27/27**
  (lag ratio 56% in-band both themes, origin top, dim mid-exit, cover owns
  screen at 700px, borderless + 4 shadow layers computed, below-fold card
  hidden→rises on entry, skeleton guard, reduced-motion).
- ⚠ Audit lesson: computed styles normalise (`50%`→`195px`, shadow lists
  reformat, transitions mid-flight) — assert against computed FORMS, and
  prefer relational signals (cover position) over absolute rects on pages
  whose height varies with data warm-up.
- NEXT: owner verdict on v634 → next surface samples.

### 2026-08-02 — Session 6 cont. (v635 — motion smoothness + flash 2-col compact)
- **Owner round 7:** home swipe "atak raha" (janky) · flash card circled dead
  space (band right of name/price + hole between price and rating) · same
  compaction on desktop · card motion tuned to swipe speed.
- **JANK ROOT CAUSE (found, control-proven):** the cover panel's per-frame
  un-zoom scale re-rasterised the ENTIRE page subtree on every scroll frame.
  Fix: the panel is now **STATIC** (⚠ never put a scroll-linked transform
  back on `.sbh-rails` — rule comment in globals.css); the depth read
  survives fully on the hero's own lag/shrink/dim (one small composited
  layer: `translate3d` + `will-change: transform`, dim `::after`
  `will-change: opacity`). **Control probe:** /hotels (no effect) 0-1 long
  frames vs / (effect) 1-2 in 30 synthetic scroll frames — at baseline.
- **Flash card 2-COLUMN body (kills the circled dead space structurally):**
  right column (rank chip over Grab now) moved UP beside the text block —
  left = name·loc·price·rating, right = rank/CTA centred, urgency line
  spans. Works identically at 390w and 1440w (CTA beside text asserted at
  both). Body height 169px mobile / 205 desktop (was ~200+ with holes).
- **Swipe-speed reveal tune:** IO pre-triggers 15% below the fold
  (threshold 0, rootMargin "0 0 15% 0") so fast swipes never land on empty
  slots; settle 0.5s, rise 20px, 40ms column stagger.
- Badge v634→**v635**, sw `HTML_CACHE` v431→**v432**.
- **Gates GREEN:** tsc 0 · build 0 · security 385/0 · v635 audit **19/19**
  (static cover, GPU layers, jank probe ≤1 vs control, 2-col geometry both
  breakpoints, rank/CTA stack, body heights, 0.5s settle, 0 overflow).
- NEXT: owner verdict on v635 → next surface samples.

### 2026-08-02 — Session 6 cont. (v636 — HOTEL DETAIL Treatment A, phase 1 of the page)
- **Owner picked A (booking-first) from the 3-treatment board.** Scope shipped:
  the top-of-page band merge + room-card depth/reveal. Presentation only —
  every bid/pay/negotiate path untouched.
- **NEW `components/hotel/HotelTrustStrip.tsx`:** ONE 4-cell strip (Rating ·
  SB Score · Rooms left · vs OTA + quiet live caption) replaces THREE stacked
  bands — the v133 live pill, the v123 HotelStatsRibbon, the v128.1 medal
  block. Content-aware cells (no data ⇒ no cell). **The Score cell embeds
  `HotelScoreBadge variant="compact"` UNCHANGED** — its own fetch +
  tap-for-breakdown modal survive the merge. `HotelStatsRibbon.tsx` stays in
  the repo, just unused by this page.
- **Room cards:** borderless 4-layer 3D shadow (v634 grammar; flash/selected
  keep their accent as a box-shadow RING so geometry never shifts) + per-card
  scroll reveal via `RevealCard` (useReveal). ⚠ **v238 history honoured:** the
  old SHARED `.hx-reveal-io` observer was banned from this section (stale-dep
  observer left late-mounted cards invisible). This wrapper differs on both
  counts — per-card observer + a CSS **FAILSAFE keyframe** (`hxIoFailsafe`,
  1.4s) that forces visibility even if IO never fires. Audit PROVES 0 cards
  hidden after 2.3s. The room list can never be lost to an animation bug.
- **Pre-existing bug found & fixed:** /hotels/[id] had 88-125px of
  document-level horizontal overflow at 390w (ambient backdrop + hero-swipe
  slides + mosaic peek tiles — v123/v159 era, never audited). Fix:
  `overflow-x: clip` on `.hx-shell` (clip, NOT hidden — no new scroll
  container; internal galleries keep scrolling in their own boxes).
- Rooms rise: first card top now ~711px (< 1 viewport of scroll; was ~3 bands
  deeper). Badge v635→**v636**, sw `HTML_CACHE` v432→**v433**.
- **Gates GREEN:** tsc 0 · build 0 · security 385/0 · v636 audit **20/20**
  light+dark (strip cells content-aware, badge-in-cell, old bands absent,
  borderless+4-layer+inset computed, failsafe armed + 0 hidden, overflow 0).
- **Hotel-detail REMAINING (later passes, sample-first as needed):** emoji
  chrome → lucide across the deep flows (status chips/pickers/drawer),
  About/Reviews tab polish, sticky desktop rail re-skin, gallery/calendar
  modals. This pass = the owner-picked top + cards core.
- NEXT: owner device-check v636.

### 2026-08-02 — Session 6 cont. (v637 — medal restored + 3D photo tiles)
- **Owner device review of v636:** the compact score badge OVERFLOWED its
  strip cell ("91/100" spilling past the pill) — "scorecard same waise hi,
  wahi jagah, mobile+desktop same". Plus: photos ko bhi room-card wala 3D.
- **Scorecard:** the v128.1 medal block restored VERBATIM at its original
  position (right below the strip), `HotelScoreBadge variant="hero"` + text
  — identical mobile/desktop. The strip is now 3 content-aware cells
  (Rating · Rooms left · vs OTA) with NO badge inside (dead `.hx-ts-cell-
  score` CSS removed; a do-not-re-embed note added in the component).
- **Photos 3D:** `.hx-mosaic-strip-tile` gets the room-card depth grammar —
  raised layered shadow + inset top lit-edge, light + dark variants.
- Badge v636→**v637**, sw `HTML_CACHE` v433→**v434**.
- **Gates GREEN:** tsc 0 · build 0 · security 385/0 · audit **15/15** at
  390w light+dark AND 1440w (3 cells + no badge in strip, no cell-content
  overflow, hero medal present, tile shadows computed, 0 page overflow).
- NEXT: owner verdict → hotel-detail later passes or next surface.

### 2026-08-02 — Session 6 cont. (v638 — hotel-detail remaining passes: deep-flow lucide + rail 3D)
- **Owner commission:** "Hotel-detail baaki passes: deep-flow emoji→lucide
  (status chips, pickers, drawer), About/Reviews tab polish, desktop sticky
  rail re-skin, gallery/calendar modals."
- **Deep-flow emoji→lucide (~28 JSX-chrome swaps)** in `app/hotels/[id]/
  page.tsx` via lucide imports + a small `InIc` inline-icon helper: flash
  banner ⚡→Zap, cooldown/pending ⏳→Hourglass, 💎→Gem, 🔒→Lock, status chips
  (Price Locked / Bid Pending / Upgrade — Lock/AlarmClock at 17px), Pay CTAs
  💰→Wallet, reviews OTA-compare 🏆→Trophy, about-map 📍→MapPin, every picker/
  teaser/dates 📅→Calendar icon, upgrade modal 💎→Gem.
- **KEEP list (deliberate, documented honestly):** template-string labels that
  flow through plain-text renderers (`🔒 Hold…`, `💰 Save Big` pick label,
  `⏳ Submitting`, `💎 Upgrade & Pay` string forms), the amenity emoji map,
  score-ladder rank glyphs (👑⭐✨), 🎉 celebration, and `glyph="🏨"` — these
  are content vocabulary, not chrome, or live in string contexts where a JSX
  node can't go.
- **Desktop sticky rail re-skin:** `.hx-sticky-card` joins the v634 borderless
  4-layer 3D grammar (long cast + mid bloom + contact edge + inset top
  highlight) + `[data-theme="dark"]` variant — the 1px-border flat card was
  the last hotel-detail surface off-grammar.
- **About/Reviews polish:** Trophy/MapPin icon swaps (above); assessed the
  tabs as otherwise consistent — no structural change needed.
- **Gallery/calendar modals — assessed, deliberately untouched:** both are
  self-contained dark-luxe surfaces (PhotoGallery lightbox is conventionally
  dark in both themes with its own data-driven category-chip vocabulary; the
  lux-cal sheet already matches the premium grammar). No change = the honest
  call; re-skinning them would be churn, not polish.
- Badge v637→**v638** (`SB_BUILD v638-detail-deepflow-lucide-rail3d`), sw
  `HTML_CACHE` v434→**v435**.
- **Gates GREEN:** tsc 0 · build 0 · security 385/0 · audit **11/11** —
  1440w light (sticky borderless + 4-layer + inset, room-card grammar
  intact, 9 lucide svgs, 0 overflow), 390w light (swapped-zone emoji scan
  clean, 0 overflow), 1440w dark (sticky black-cast 4-layer variant applies).
- NEXT: owner device-check v638 → next surface (recommend /my-bids — the Pay
  conversion path) or Phase 2 panels.

### 2026-08-02 — Session 6 cont. (v639 — /my-bids: 3D cards + lucide chrome)
- **Owner commission:** "my-bids page. go ahead." Presentation-only — every
  bid/pay/counter/cancel handler byte-identical; the Pay conversion path
  (BookingReview → Razorpay → /api/bids/:id/pay) untouched.
- **Card grammar:** `.mb-card` (bid cards + summary chips + skeletons +
  empty-state discs) re-skinned from 1px-border flat to the borderless
  4-layer 3D grammar + `[data-theme="dark"]` variant; hover deepen now
  wrapped in `@media (hover:hover)` (no sticky-hover on touch); accent
  hover ring is box-shadow-only (geometry never shifts).
- **Root-cause fix found during study:** the `#bid-<id>` highlight ring
  (`mbHighlightRing … both`) retained its final all-zero keyframe forever,
  permanently flattening the card's base shadow after the 2.5s ring. Fill
  mode dropped — the ring plays, then the card returns to its 3D shadow.
- **Chrome emoji→lucide:** section toggle (Building2/Target), flow pill,
  ⚡ Flash pill→Zap, 🔑 room pill→KeyRound, ⏱ countdown→Timer (tone-
  coloured), 🎁 perks→Gift, 💰 Pay CTA→Wallet, ✕ cancel→X, empty states
  👑/🎯/🏨→Crown/Target/Building2. **KEEP list:** 🎉/🎊 celebration
  vocabulary (overlay, accepted glyph, confetti), notify() title strings,
  BookingReview flowLabel strings, Razorpay description strings.
- Badge v638→**v639** (`SB_BUILD v639-mybids-3dcards-lucide`), sw
  `HTML_CACHE` v435→**v436**.
- **Gates GREEN:** tsc 0 · build 0 · security 385/0 · audit **12/12** with
  REAL CARDS rendered via Playwright route-interception of `/api/bids/my`
  (fake auth + PENDING/COUNTER/ACCEPTED fixtures): 390w light (borderless
  + 4-layer + inset computed on a bid card, chrome-emoji scan clean, 14
  lucide svgs, counter panel + room pill render, section flip → Pay CTA
  carries the Wallet svg, 0 overflow), 1280w dark (black-cast 4-layer,
  3-col grid, 0 overflow), empty state (Crown, no 👑). New audit
  technique for auth-gated surfaces recorded here for reuse.
- NEXT: owner device-check v639 → /bookings (same account cluster) or
  Phase 2 panels.

### 2026-08-03 — Session 6 cont. (v640 — /bookings: 3D ticket cards + lucide chrome)
- **Owner commission:** "bookings. go ahead." Presentation-only — hold/
  pay-balance (HoldBanner → Razorpay → /api/holds/:id/balance), feedback
  submit, and BookingChat logic all byte-identical.
- **Card grammar:** `.bk-card` (booking tickets + empty-state disc)
  re-skinned from 1px-border flat to the borderless 4-layer 3D grammar +
  dark variant; hover deepen wrapped in `@media (hover:hover)`. The 3px
  gradient ticket-top strip and the drawn `<Barcode/>` kept — they ARE the
  ticket identity.
- **Chrome emoji→lucide (~24 swaps):** room pills 🔑→KeyRound, pay-at-hotel
  🏨→Building2, price-locked 🔒→Lock, hold-expired ⏰→AlarmClock, pay-balance
  CTA ✅→Wallet (and ⏳ dropped from the loading label), feedback-thanks
  ✅→Check, rate-stay ⭐→Star, StayPoints 🎁→Gift/⭐→Star (banners + program
  card + hero chip), report 🚩→Flag, expand ▼→ChevronDown (rotate pattern
  kept), InfoRow 📍📞✉️🛏🗓→MapPin/Phone/Mail/BedDouble/CalendarDays
  (InfoRow `icon` prop widened string→ReactNode), action buttons 🗺📱💬→
  Map/Phone/MessageCircle, hero chips 🎫🗓⭐→Ticket/CalendarDays/Star,
  empty state 📋→ClipboardList. **Shared `components/BookingChat.tsx`**
  (renders inside the card, customer + partner modes) — its two 💬 chrome
  glyphs → MessageCircle; both modes get the same icon.
- **KEEP list:** ★/☆ rating glyphs (rating vocabulary), 😊 smiley-composer
  reference (the product IS the smiley feedback), 👋 in chat empty copy,
  Razorpay description strings, brand-coloured action buttons (blue/
  emerald/WhatsApp-green are deliberate brand-action colours).
- Badge v639→**v640** (`SB_BUILD v640-bookings-3dcards-lucide`), sw
  `HTML_CACHE` v436→**v437**.
- **Gates GREEN:** tsc 0 · build 0 · security 385/0 · audit **11/11** via
  route-intercepted fixtures (CONFIRMED + CHECKED_OUT bookings): 390w
  light (borderless 4-layer + inset computed, emoji scan clean, room pill
  + credited + rate-stay render, expand → info rows with 26 lucide svgs,
  0 overflow), 1440w dark (black-cast 4-layer, 2-col grid, 0 overflow),
  empty state clean. First audit run caught the leftover 💬 inside the
  shared BookingChat — fixed at source, fresh server, re-audited green.
- NEXT: owner device-check v639+v640 together (my-bids → bookings is one
  journey) → /passport or Phase 2 panels.

### 2026-08-03 — Session 6 cont. (v641 — /passport hub: 3D cards + lucide chrome)
- **Owner commission:** "passport". Presentation-only — redemption/wallet/
  family APIs and the redeem money-flow untouched.
- **Card grammar:** NEW shared `.ppx-card` in globals.css (borderless
  4-layer + dark variant — the `.hx-*` placement pattern). Applied to the
  hub's generic flat cards: rewards balance strip, reward catalog rows,
  confirm/success modal panels, tx rows, wallet-credit strip, code cards,
  empty-passport card — plus the two flat section shells in components
  (`FamilyPassport` no-family card + add-member card, `HowItGrows`
  container). **The passport BOOK, medals, member card, detail sheet and
  the dark wallet balance card keep their own custom depth** — the class
  comment forbids flattening them onto it. Tab bar stays a control
  (border kept, like `.mb-seg`).
- **Chrome emoji→lucide:** tab icons 🛂💳✨🎟️→BookUser/CreditCard/
  Sparkles/Ticket (TABS array now carries components), 👤 profile→
  UserRound (+aria-label), empty states 🛂💳✨🎟️→icons, ✨ Redeem/🎟️
  Codes shortcut buttons, 🔒 locked-redeem→Lock, 💰 wallet credit→Wallet.
  Section headings in components: 🛂 Your Stamps→Stamp, 🏅 Achievements→
  Medal, 🎁 Stamp Rewards→Gift, 👨‍👩‍👧 Family Passport→Users (+ family
  empty hero). **KEEP:** kindIcon()/rule.icon reward glyphs (data-driven
  medal vocabulary in PassportMedal + modals), HowItGrows medal glyphs,
  🎉 celebration, ✓ ticks, rank emoji, every glyph inside the book/stamps/
  badges internals. Navbar's ✨ Creator item is GLOBAL chrome — out of
  scope here, belongs to the global-chrome phase.
- Badge v640→**v641** (`SB_BUILD v641-passport-3dcards-lucide`), sw
  `HTML_CACHE` v437→**v438**.
- **Gates GREEN:** tsc 0 · build 0 · security 385/0 · audit **15/15** via
  full fixtures (passport profile + rank + wallet txns + active code +
  family:null): all 4 tabs at 390w light (ppx-card 4-layer computed on
  FamilyPassport/HowItGrows/tx-row/balance-strip/credit/code cards, 4
  lucide tab icons, page-scoped emoji scan clean excluding medal nodes,
  dark balance card identity intact, 0 overflow) + 1440w dark (black-cast
  4-layer, 0 overflow). Audit gotcha recorded: page.evaluate drops JS
  closures — pass the needle as an evaluate ARG, never a closure.
- NEXT: owner device-check v639-v641 → /auth (careful: admin-intent
  fail-closed logic) or Phase 2 panels.

### 2026-08-03 — Session 6 cont. (v642 — /auth: 3D card shells + lucide chrome)
- **Owner commission:** "auth". The most security-sensitive customer page
  — v622 admin-intent fail-closed + claim minimization + v620 bulletproof
  provider sign-in all live here. **Every handler, ordering, and auth
  contract byte-identical**; the pass touched ONLY presentational
  classNames/glyphs. Security suite (which scans this file's fail-closed
  ordering) re-run green.
- **Study finding (blind-build avoided):** initial "white cards in dark"
  hunch was WRONG — the v458 `.auth-root` bridge in globals.css already
  tokenizes the whole page for dark (bg-white→bg-card, borders, provider
  tints, error box, text bridge). Dark was already correct at the cause,
  so the pass narrowed to exactly two grammar deltas.
- **Card grammar:** new `.auth-root .au-card` (globals, inside the v458
  block) — borderless 4-layer + dark variant; the 5 card shells
  (`bg-white rounded-3xl border border-luxury-100 shadow-luxury` ×
  options/phone/phone-otp/whatsapp/whatsapp-otp) → `au-card rounded-3xl`.
  The bridge keeps handling inputs/pills/tints/text underneath.
- **Chrome swaps (2 only):** ⚠ ErrorBox → TriangleAlert; ← back buttons
  (4×) → ArrowLeft. **KEEP:** Google/Facebook/WhatsApp/Phone SVGs (brand
  marks, not emoji), the brand monogram/wordmark, • OTP placeholder dots.
- Badge v641→**v642** (`SB_BUILD v642-auth-3dcards-lucide`), sw
  `HTML_CACHE` v438→**v439**.
- **Gates GREEN:** tsc 0 · build 0 · security **385/0** (auth ordering
  scans pass) · audit **8/8**: 390w light (au-card 4-layer computed,
  provider CTAs render, glyph scan clean, WhatsApp sub-screen opens with
  ArrowLeft lucide + 4-layer card, 0 overflow) + 1440w dark (black-cast
  4-layer, card surface rgb(27,33,42) ≠ white — bridge intact, 0
  overflow).
- **Customer core COMPLETE** (home/flash/hotel-detail/my-bids/bookings/
  passport/auth all on the locked grammar). NEXT: owner device-check →
  Phase 2 panels (partner → admin → circle → trade → host → onboard →
  influencer → worker) or /bid climber deep polish.

### 2026-08-03 — Session 6 cont. (v643 — hotel-detail flow sheets: picker · calendar · arena · book-now)
- **Owner commission (4 screenshots):** the picker sheet ("Pick dates to
  Negotiate"), the LuxuryCalendar ("Select your stay"), the AI Bidding
  Arena, and the Instant Booking modal. ⚠ Screenshots showed badge v624 —
  owner's device was on an old preview; the 📅 red-calendar emojis in ss1
  were ALREADY fixed in v638. This pass took the still-live items.
- **Picker sheet:** 🔍 disc→Search, 👤/👦/🧒 guest labels→UserRound/
  PersonStanding/Baby, "Pick dates above ↑"→ArrowUp.
- **LuxuryCalendar (shared component):** ✕→X, leg →→ArrowRight, month
  ‹/›→ChevronLeft/Right; `.lux-cal-close`/`.lux-cal-navbtn` given flex
  centering for the svg (they centered text glyphs before). Benefits every
  consumer (/bid, flash-deals, hotel page modal + desktop inline).
- **Bidding Arena:** ⚡ header/CTA→Zap, 👥 guests→Users, ⏱→Timer, 🤖 Live
  AI→Bot, quick chips restructured to carry {Ic,label} (Wallet/Star/Zap),
  ⏳ loading label de-emoji'd, submit-success ✅→Check (🎉 auto-confirm
  KEPT). Flash modal's "⚡ Confirm Booking"→Zap. Room-card 👥 dates-chip
  →Users (v638 miss caught by the audit's over-wide first scan). **KEEP:**
  `aiTips` LIVE-AI ticker strings (🔥👀📈⭐ — rotating content vocabulary).
- **Instant Booking modal:** assessed already consistent (SecIcon check/
  building since earlier passes; tiles fine) — untouched, verified.
- **⚠ Honest follow-up flagged (NOT built):** `.picker-*` and `.lux-cal-*`
  have NO dark-mode variants at all (hardcoded light surfaces even in dark
  theme, ~100 rules). Full dark conversion of the calendar/picker system
  is a separate owner-approved deep pass — too much regression surface on
  a booking-critical component to sneak into a chrome pass.
- Badge v642→**v643** (`SB_BUILD v643-hotel-flowsheets-lucide`), sw
  `HTML_CACHE` v439→**v440**.
- **Gates GREEN:** tsc 0 · build 0 · security 385/0 · audit **10/10** via
  a REAL interaction chain at 390w (deep-link `?intent=negotiate` →
  picker probe → Check-in tile → calendar probe (backdrop-scoped) → 2
  dates + Apply → Continue → arena probe (innermost-match, ticker
  excluded) → fresh `?intent=book` chain → Instant Booking probe; 0
  overflow) + 1440w dark (inline calendar carries lucide nav, 0 overflow).
- **Audit technique notes:** ①`?intent=negotiate|book` deep links open the
  picker WITHOUT the auth-gated CTA click (withBackendAuth needs a real
  session; a fake token 401s the hotel fetch itself — signed-out deep link
  is the deterministic path). ②Ancestor-text `find()` grabs the OUTERMOST
  match — take the LAST match for the innermost container. ③The hidden
  desktop-inline calendar's buttons exist in mobile DOM — scope modal
  probes to `.lux-cal-backdrop`.
- NEXT: owner device-check on the CURRENT preview (v643) → Phase 2 panels.

### 2026-08-03 — Session 6 cont. (v644 — /bid climber: step sheets + map discs lucide)
- **Owner commission (7 screenshots, "rule sabhi wahi — 14 locked"):** the
  climber's 7 step sheets (city, property, calendar, guests, price,
  review, pay). Screenshots again showed v624 — calendar sheet chrome was
  already fixed in v643 (shared LuxuryCalendar). Presentation-only; bid
  submit/pay/conflict logic byte-identical.
- **Type widening:** `BidCard.icon`/`doneLabel` string→ReactNode
  (components/BidCardStack.tsx) so lucide slots into the sheet header AND
  the map milestone discs from ONE field.
- **ClimberMilestoneMap:** node/peak 🔒→Lock, 🚩→Flag, sheet ✕→X, default
  "✓ Done"→Check+Done. Map disc glyphs now render the cards' lucide icons
  (Globe/Building2/CalendarDays/Users/Wallet/Search/CreditCard).
- **Step sheets (app/bid/page.tsx, ~30 swaps):** city search 🔎→Search +
  ✕→X + show-all ▾▴→Chevrons + 🤖 AI Insight→Bot + summary 📍 dropped;
  property tally ✓→Check; date buttons 📅→CalendarDays; guests auto-fit
  notes ✨/⚠️→Sparkles/TriangleAlert + 🏨 concierge→Building2; price
  presets 💰⭐⚡→Wallet/Star/Zap (icon field →ReactNode) + 🤖 presets
  label→Bot + doneLabel "🚀 Launch Bid"→Rocket+text ("⏳"dropped);
  review heroes 🎯/⚠️/⏳→Target/TriangleAlert/Hourglass + 👀→Eye +
  🔄→RotateCw + notes ✓/💳→Check/CreditCard; pay sheet 💳→CreditCard;
  LiveBidCard 💰 Pay Now & Grab→Wallet. `finalCtaLabel` de-emoji'd.
- **KEEP (game/content vocabulary):** boot storyboard mock pills + ⚡
  brand bolt + ▶ PRESS START (owner-approved v632 boot untouched),
  `emojiForCount` morphing character counters (THE gaming feature),
  property-type disc glyphs (data vocabulary), city avatars, node ✓ done
  badge, climber map art.
- Badge v643→**v644** (`SB_BUILD v644-bid-stepsheets-lucide`), sw
  `HTML_CACHE` v440→**v441**.
- **Gates GREEN:** tsc 0 · build 0 · security 385/0 · audit **6/6** via
  the real game chain at 390w: boot (bolt+start kept) → PRESS START →
  map (7 discs, 7 lucide glyphs, 0 emoji) → city sheet (header/close/
  search svgs, emoji-free) → city pick → property sheet (Done carries
  Check svg, type discs kept) → 0 overflow.
- NEXT: owner device-check v644 → Phase 2 panels.

### 2026-08-03 — Session 6 cont. (v645 — flash drawer chrome + GuestFavourite verified & 3D)
- **Owner commission (2 screenshots):** ① the flash-deal drawer, ② "Guest
  Favourite — check it's still where it was, we didn't remove it, and
  upgrade it."
- **✅ GuestFavourite POSITION VERIFIED UNTOUCHED:** still exactly where
  v509 put it — directly AFTER the Amenities section in the hotel-detail
  About column (`app/hotels/[id]/page.tsx` ~4349). No pass ever moved or
  removed it; measured in DOM order on a qualifying hotel
  (hco-seed-goa — the badge is exclusivity-gated: top ~10% city
  percentile + overall ≥85, so it only renders on genuinely top-tier
  stays; the jaipur audit fixture doesn't qualify, which is correct
  behaviour, not a regression).
- **GuestFavourite upgrade:** card shell → borderless 4-layer 3D + dark
  variant (styled-jsx `:global([data-theme="dark"]) .gf`). The laurel
  identity (🌿 + serif number) untouched — it IS the badge.
- **Flash drawer (`app/flash-deals/page.tsx` DealDrawer):** rules list
  🕒🛏️🚫💳↩️→Clock/BedDouble/Ban/CreditCard/Undo2, 🏨 View hotel→
  Building2 (+ img fallback), ⚡ Grab this stay→Zap. Room picker rows
  untouched (selectable-control grammar with accent ring — correct as-is).
- Badge v644→**v645** (`SB_BUILD v645-flashdrawer-guestfav`), sw
  `HTML_CACHE` v441→**v442**.
- **Gates GREEN:** tsc 0 · build 0 · security 385/0 · audit **9/9** —
  flash drawer opened via a real Grab-now tap (5 rule svgs, emoji-free,
  both CTAs carry lucide, rooms intact, 0 overflow) + GuestFavourite
  measured on a QUALIFYING hotel in light AND dark (after-Amenities DOM
  position, laurels kept, 4-layer/black-cast computed). Audit note: the
  qualification gate means fixture choice matters — probe scorecards to
  find a qualifying hotel before asserting presence.
- NEXT: owner device-check v645 → Phase 2 panels.

### 2026-08-03 — Session 6 cont. (v646 — menu drawer · panel switcher re-theme · /me chrome · /upgrade)
- **Owner commission (4 screenshots):** ① /me profile, ② /upgrade, ③ the
  Menu drawer + "kis-kis destination ko kar liya" status, ④ the Switch
  experience sheet — "abhi bhi old theme, slate rebrand se bhi chhoot
  gaya tha; light AND dark dono".
- **PanelSwitcher FULL RE-THEME (the ss4 must-do):** the v322 fixed
  walnut/champagne palette (#241E12/#1A150C hardcoded) → app tokens
  (--bg-card/--bg-pill/--text-*/--border-soft/--accent) with
  [data-theme="dark"] shadow deepening — measured light rgb(254,254,254)
  / dark rgb(27,33,42), walnut gone. Joined-chip now the house pewter
  gradient. Panel tiles + splash icon → lucide via a PANEL_ICONS map
  keyed on panel.key (panels.ts untouched — emoji strings remain as
  fallback), ✕→X. Still an overlay with its own scrim so it reads on the
  dark admin canvas too.
- **Menu drawer (+ Navbar dropdown, shared source):** lib/user-links
  .ts→.tsx, `icon` → ReactNode with lucide (ClipboardList/Ticket/
  Bookmark/Star/BookUser/Flag/BadgeCheck/Sparkles/Building2/Settings);
  drawer-local rows ⇅/❓/🎧/↶/→ → ArrowUpDown/CircleHelp/Headphones/
  LogOut/LogIn. Desktop Navbar dropdown inherits automatically.
- **/me profile chrome:** tabs ▦/▶ → Grid3x3/Play, ☰ ×2 → Menu icon,
  ↑ upgrade links ×2 → ArrowUp. Highlight-circle emojis KEPT (user
  content categories, not chrome).
- **/upgrade:** path-card tiles ✨/🏨 → Sparkles/Building2, feature-list
  ✓ → Check, signed-out 🔒 → Lock. (UpgradeSection shared with /profile
  — both get it.)
- **📋 MENU DESTINATIONS STATUS (owner asked):** DONE on house grammar —
  My Bids (v639) · Bookings (v640) · Passport & Wallet (v641) · the
  switcher itself (v646). NOT yet upgraded (pending queue): **/saved,
  /trust, /complaints, /verification, /profile (Account settings),
  /influencer (Creator Hub)** — plus the /trust destination pages. These
  are the next customer-surface batch before Phase 2 panels.
- Badge v645→**v646** (`SB_BUILD v646-menu-switcher-me-upgrade`), sw
  `HTML_CACHE` v442→**v443**.
- **Gates GREEN:** tsc 0 · build 0 · security 385/0 · audit **7/7** —
  /me light (2 tab svgs, drawer 12 lucide rows emoji-free, switcher
  tokenized light + 9 lucide tiles + X, 0 overflow), /me dark (switcher
  dark tokens), /upgrade signed-out (Lock, no emoji).
- NEXT: owner device-check v646 → the pending menu-destination batch
  (saved/trust/complaints/verification/profile) or Phase 2 panels.

### 2026-08-03 — Session 6 cont. (v647 — menu-destination batch: saved · trust · complaints · verification · profile)
- **Owner commission:** "pending menu-destination batch
  (saved/trust/complaints/verification/profile)" — the five customer
  surfaces the v646 status report flagged as NOT-yet-upgraded. House
  grammar (borderless 4-layer 3D card, lucide chrome, light AND dark).
- **CARD GRAMMAR via scoped .card-luxury override** (new block in
  globals.css, before the v641 .ppx-card marker): `.lux-soft .card-luxury,
  .trust-root .card-luxury, .verif-root .card-luxury, .upg-root
  .card-luxury` → `border:none` + the house 4-layer light shadow, with a
  `[data-theme="dark"]` deepen (rgba(0,0,0,0.7/0.48/0.38) + inset). Scopes:
  /saved + /complaints already carry `.lux-soft`; /trust `.trust-root`,
  /verification `.verif-root`; /upgrade `.upg-root` (root added). Measured
  4 shadow layers + borderless in BOTH themes on every page.
- **/saved:** TABS icon type → ReactNode, Bookmark/Clapperboard/Building2/
  Sparkles/Zap; header Bookmark; ❓→CircleHelp; media fallbacks 🎬/🏨→
  Clapperboard/Building2; ▶ views→Play; ⚡ Flash label→Zap; the two remove
  buttons ✕→X (lucide).
- **/trust:** value-card glyphs → BadgeCheck(#7F9269)/Trophy(#c9a24a)/
  Star(#8198ae). NOTE: 🏆 still appears in-page but it is the
  HotelScoreBadge compact RANK glyph (`hsb-cp-icon`, score-ladder KEEP
  vocabulary) on the hotel rows — NOT chrome; deliberately kept.
- **/complaints:** TYPE_LABEL 8 icons → CalendarDays/CreditCard/Banknote/
  Building2/Target/Video/FileText (type widened `icon: string`→ReactNode);
  quick-link + ref-chip glyphs 🎯/📅/🎥/💸 → Target/CalendarDays/Video/
  Banknote.
- **/verification:** ↻→RotateCw, 🎬→Clapperboard. Tier-ladder medals
  🥈🥇💎 KEPT (content vocabulary).
- **/profile:** 💎→Gem, ✏️→Pencil, ✨→Sparkles, 🔒→Lock, 🎯 Reward
  Milestones→Target. KEPT: 🥈🥇💎 TIERS medals, MILESTONES reward icons
  (🥇⭐💎🏨🎁✈), glyph="📭"/"🙌" SbState, ★ rating, ✓ ticks.
- Badge v646→**v647** (`SB_BUILD v647-menu-destinations-lucide`), sw
  `HTML_CACHE` v443→**v444**.
- **Gates GREEN:** tsc 0 · build 0 · security 385/0 · headless audit
  **23/23** — every page: scoped .card-luxury 4-layer borderless in LIGHT
  and DARK (injected-probe node for the empty-state pages so the same
  scoped rule is measured), lucide svgs present, page-root-scoped chrome
  emoji scan clean (KEEP vocabulary excluded), 0 horizontal overflow.
- NEXT: /influencer (Creator Hub) — the last pending menu destination —
  then Phase 2 panels (partner → admin → circle → trade → host → onboard →
  worker) + the Hinglish sweep. Deferred (owner approval): lux-cal/picker
  dark-mode deep pass; global-chrome phase (Navbar ✨).

### 2026-08-03 — Session 6 cont. (v648 — /influencer Creator Hub → lucide + house cards)
- **SCOPE:** the LAST pending menu destination — the whole Creator Hub surface
  (`/influencer`: layout + dashboard/upload/bookings/referrals/earnings/profile
  + `public/[id]`). Owner ask: "influencer (Creator Hub)". Presentation-only.
- **STUDY FIRST (no blind build):** `.inf-root` ALREADY carries a full
  dark-mode token bridge from an earlier era (globals.css ~L807: `.inf-root
  .card-luxury`/`.bg-white`/`.bg-luxury-*`/`.border-luxury-*` remap +
  `[data-theme="dark"]` handling). So the hub was already theme-aware — it only
  lacked the house borderless 4-layer 3D card grammar. A parallel Explore-agent
  chrome inventory + a python emoji scan mapped every glyph across all 9 files.
- **CARD GRAMMAR:** added `.inf-root .card-luxury` to the v647 scoped 4-layer
  block (globals.css, light + `[data-theme="dark"]` deepen). One CSS edit covers
  every hub `.card-luxury` (dashboard hero/KPIs/KYC/commissions, upload
  form/tips, referrals, earnings, profile, AND `public/[id]` — which renders its
  OWN `.lux-bg inf-root` root, so it's covered too). Measured 4 layers +
  borderless in BOTH themes on dashboard, upload, and public.
- **layout.tsx:** 6 nav-tab emoji (📊🎬📋🔗💸👤) → LayoutDashboard/Clapperboard/
  ClipboardList/Link2/Wallet/UserRound (TABS type widened `icon:ReactNode`);
  header ✨ → Sparkles.
- **dashboard:** KYC chips ✅/⏳ → CircleCheck/Hourglass.
- **upload:** header 🎬→Clapperboard, dropzone 📹→Video, thumb 🖼️→ImageIcon,
  CTA 🚀→Rocket, likes ❤️→Heart. KEEP: the 5 "Tips for great reels" string
  emoji (🌅📱🎵🏷️💬) — editorial marketing copy, same precedent as the KEPT
  hotel-page aiTips ticker strings; and the ✅ inside the success-status string.
- **public/[id]:** not-found 🔍→Search, section 🎬→Clapperboard, views ▶→Play,
  likes ❤→Heart, Follow button ✓/+ → Check/UserPlus. KEEP: ★ rating, inline
  "Open feed →" link arrow.
- **KEEP — referrals page untouched (deliberate):** the share-message TEMPLATES
  (🏨👇👆👉) are content strings; the "Link copied ✓"/"Shared ✓" toasts are tick
  vocabulary; and the 📲💬📸✈️𝕏🔗 share buttons are BRAND-channel identifiers
  (WhatsApp/Instagram/Telegram/X) — lucide ships no brand icons, and mixing
  lucide+emoji in one button row would look worse than a consistent emoji set.
  `ShareBtn icon:string` left as-is (no lucide passed). earnings 🎉/✓/∞ and the
  bookings `•` list bullets + `→` date separator also KEPT (celebration / tick /
  data value / neutral typography).
- Badge v647→**v648** (`SB_BUILD v648-creator-hub-lucide`), sw `HTML_CACHE`
  v444→**v445**.
- **Gates GREEN:** tsc 0 · build 0 · security 385/0 · headless audit **21/21** —
  dashboard/upload/public each: `.inf-root .card-luxury` 4-layer borderless in
  LIGHT and DARK (dark verified via a FRESH load with `sb_theme=dark` in the
  no-FOUC init script — a post-load `setAttribute` was reset by the theme-store
  on the standalone public page, so the fresh-load approach is the reliable one),
  `.inf-root`-scoped lucide svgs present, swapped chrome emoji absent (KEEP
  vocabulary excluded), 0 horizontal overflow.
- NEXT: menu destinations COMPLETE. Phase 2 panels (partner → admin → circle →
  trade → host → onboard → worker) + the Hinglish sweep. Deferred (owner
  approval): lux-cal/picker dark-mode deep pass; global-chrome phase (Navbar ✨).

### 2026-08-03 — Session 6 cont. (v649 — Phase 2 START: partner panel DARK FOUNDATION + shell/overview lucide)
- **PHASE 2 BEGINS (panels).** Owner "go ahead" → partner is first. Study
  found the partner surface is a DIFFERENT beast from the customer pages:
  ~15k lines across 24 files (dashboard shell 3,719 + ~20 tab components), a
  SELF-CONTAINED `.pdash-*`/`.card-p`/`.hub-tile`/`.btn`/`.inp-p` design system
  in an in-component <style> block, and ZERO dark mode (all hardcoded light
  hex) — no `.lux-bg`/token bridge to build on. Owner picked **"Foundation
  first, then tabs"** (AskUserQuestion): tokenize the shared system + add a
  `.pdash-root` dark bridge + shell/overview chrome, then sweep tabs later.
- **DARK FOUNDATION (globals.css, new `.pdash-root` block, modeled on the
  `.fd-root` v486 pattern):** DARK-ONLY overrides
  (`[data-theme="dark"] .pdash-root …`) so LIGHT stays byte-identical — the
  panel never had dark, so nothing light is touched, only the missing dark
  surfaces are supplied. Covers the design-system classes (`.card-p`,
  `.hub-tile`+hover, `.btn-ghost`+hover, `.inp-p`+focus+placeholder,
  `.sec-title`) + the neutral Tailwind utilities used across shell+tabs
  (`.bg-white`/`.bg-white/95`, `.bg-luxury-50/100`, `.text-luxury-900…400`,
  `.border-luxury-*`, `.divide-luxury-100`) + a `.pdash-kpi` class fix for the
  4 overview KPI cards (they carry an inline light tint that CSS must beat with
  `!important` only in dark). **DESIGN CALL:** the panel KEEPS its own refined,
  data-dense card identity (subtle border + soft shadow) — NOT the consumer
  borderless-4-layer grammar, which reads heavy at this density; the bridge
  just makes it dark-aware. Colored per-tab status tints (bg-emerald-50 / amber
  / sky …) are the later per-tab sweep, not this foundation.
- **SHELL + OVERVIEW LUCIDE (app/partner/dashboard/page.tsx):** added a
  lucide import + a `PICON` id→icon map (shared by the TABS row + the
  quick-launch hub, same ids) + a `pIcon(id,fallback,size,color)` renderer
  (emoji fallback for any unmapped id) + a `DIc` inline helper. Swapped: the
  top nav (🏨 property / ▾ switcher / ✓ active / 🏨 Operated ×2 / ❓ App Tour /
  🎧 Help / ⇄ Switch / ↶ Sign out), the full TAB BAR (~24 tab icons via PICON)
  + its 🔒 locks, the 4 overview KPI cards (📩💬✅💰 → Inbox/MessageSquareReply/
  CircleCheck/Wallet), the ~18 quick-launch hub tiles (via PICON, colored by
  each tile's accent) + 🔒, and the overview "Today" panel (🏨 Front Desk, ➕
  New Walk-in, 🗓️ Availability, 🌅 Today, 🛬🛫🏨 count pills + the 3 column
  headers Arriving/Departing/Staying, ⚡ Active Flash Deals). KEEP: 👋 greeting.
- **SCOPE HONESTY:** this is the FOUNDATION — the design-system dark bridge +
  the persistent nav/tab-bar + the overview. Every tab now inherits the dark
  surfaces + neutral-utility flips, so tabs are already substantially
  dark-correct. The deeper per-tab inline chrome (Bids/Rooms/Flash/Bookings/
  Availability/walk-in & bid-detail modals/Redeem scanner still IN this file,
  L1660+, plus the ~20 separate tab components) + their colored status tints are
  the NEXT sweeps, tab-group by tab-group.
- Badge v648→**v649** (`SB_BUILD v649-partner-dark-foundation`), sw `HTML_CACHE`
  v445→**v446**.
- **Gates GREEN:** tsc 0 · build 0 · security 385/0 · headless audit **10/10**
  (partner fixture = fake `sb_partner_token` + mocked `/api/partner/*`): LIGHT
  `.card-p` byte-identical white (rgb 250,251,252 = the unchanged KPI tint) +
  81 lucide in the shell + shell chrome emoji GONE + 0 overflow; DARK `.card-p`
  → `--bg-card` rgb(27,33,42), page bg → #13171c, 81 lucide, 0 overflow.
- NEXT (partner tab sweeps): Bids inbox + bid-detail/counter arena → Rooms &
  Pricing → Flash → Bookings/Reservations/Availability → the standalone tab
  components (Channel/Billing/Guests/Staff/Circle/AgentAuction/etc.) → their
  colored status tints. Then the rest of Phase 2 (admin → circle → trade → host
  → onboard → worker) + Hinglish sweep.

### 2026-08-03 — Session 6 cont. (v650 — partner Bids sweep + panel-wide status-tint dark layer)
- **First partner TAB SWEEP (after the v649 foundation).** Scope: the Bids
  inbox + the bid-action/counter-pricing arena modal + the booking-detail modal
  (shared, opens from overview + bids) + the `SourceBadge` attribution chips.
- **STATUS-TINT DARK LAYER (globals.css, panel-wide, one block):** the panel
  colour-codes state with Tailwind `bg-<c>-50` chips + `-100/-200` borders +
  `-600/-700` text across EVERY tab, and those pastel `-50` fills stayed bright
  in dark. Added a DARK-ONLY layer that flips emerald/amber/blue/orange/red/
  sky/purple `-50` → a translucent tint of the same hue (colour coding kept,
  surface dark), softens the borders, and lifts the label text to a `-300`
  shade; gold routes through the champagne token. LIGHT untouched
  (byte-identical). One block → every partner tab's status chips read correctly
  in dark (not just Bids) — efficient foundation-adjacent win for the whole
  panel.
- **Bids/modal chrome → lucide:** inbox card (🛏️ rooms→BedDouble, ⚠️
  mismatch→TriangleAlert, 📋 copy→Copy, 💬 message→MessageCircle, ✓
  confirmed→Check); bid-action modal (✕→X, the 3-way ✅💬❌ selector →
  CircleCheck/MessageCircle/Ban, submit CTA ✅/💬/❌ → Check/MessageCircle/Ban,
  done-state 🎉/💬/✓ → PartyPopper/MessageCircle/Check); counter arena (⚡
  header→Zap, quick-picks ❤️⭐⚡ → Heart/Star/Zap); booking-detail modal (✕→X,
  🛬🛫→PlaneLanding/PlaneTakeoff, 🌙→Moon, 🏨→BedDouble, ⚠️→TriangleAlert,
  👤→UserRound, 📱→Phone, ✉️→Mail, 💰→Wallet, 📝→FileText, 📞 Call→Phone, 💬
  WhatsApp→MessageCircle, ✓ Paid→Check); `SOURCE_STYLE` badges (🔗✨🏨⚡• →
  Link2/Sparkles/Hotel/Zap/CircleDot).
- **KEEP:** the COUNTER_ADDONS amenity glyphs (lib catalog — amenity
  vocabulary), the addon checkbox ✓ + the "✓ Copied"/"✓ Room assigned" JS
  toast/alert strings (tick/string vocabulary), the "Respond to Bid →" inline
  text arrow, and the ◆ AI / ▼ Floor slider markers (geometric markers,
  consistent with the CSS-triangle floor marker — not emoji chrome).
- **NOTE (for the Hinglish phase):** the Rooms tab carries Hinglish copy
  ("Abhi koi room category nahi hai" / "Pehla room type add karke…") — left
  for the dedicated Hinglish sweep, not this presentation pass.
- Badge v649→**v650** (`SB_BUILD v650-partner-bids-tints`), sw `HTML_CACHE`
  v446→**v447**.
- **Gates GREEN:** tsc 0 · build 0 · security 385/0 · headless audit **11/11**
  (partner fixture with a rendered PENDING bid): LIGHT `bg-emerald-50`/
  `bg-amber-50` near-white (byte-identical) + 36 bids-tab lucide + bids chrome
  emoji GONE; DARK the same tints → `rgba(…,0.13)` translucent, `.card-p` →
  rgb(27,33,42), 36 lucide.
- NEXT (partner sweeps): Rooms & Pricing tab (room cards, unit editor, AI-price
  chrome) → Flash → Bookings/Reservations/Availability → the standalone tab
  components (Channel/Billing/Guests/Staff/Circle/AgentAuction/Content/etc.).
  Then admin → circle → trade → host → onboard → worker + Hinglish sweep.

### 2026-08-03 — Session 6 cont. (v651 — partner Rooms & Pricing sweep + STRICT-RESPONSIVE gate re-affirmed)
- **Owner re-affirmed a locked rule (explicitly, this turn):** EVERY screen at
  EVERY device/window size must auto-fit — nothing oversized, nothing hidden, no
  extra horizontal scroll — across the ENTIRE app, down to the smallest window,
  strictly. From now the audit harness enforces a MULTI-WIDTH responsive gate
  (320 / 360 / 390 / 768 / 1280, both themes, zero horizontal overflow, widest
  offender reported) on every ship, and I fix any breakage found, not just
  chrome.
- **Rooms & Pricing tab → lucide:** header + empty-state ➕ → Plus, empty 🏨 →
  Building2, card ✏️ Edit → Pencil, 🗑 → Trash2 (+ aria-label), "✓ Saved!" →
  Check, 📸 Room Photos → Camera, photo-remove ✕ → X (+ aria-label), 🔢 Physical
  Rooms → Hash, unit 🔧/↻ maintenance-toggle → Wrench/RotateCw (+ aria-labels),
  unit-delete ✕ → X (+ aria-label). KEEP: the "Apply AI → Bid Floor/Flash"
  inline text arrows, the "+ Add" compact text button. The tab was already
  responsive-sound (`grid md:grid-cols-2` single-col on mobile, flex-wrap unit
  chips) — verified, no layout change needed.
- Badge v650→**v651** (`SB_BUILD v651-partner-rooms-responsive`), sw
  `HTML_CACHE` v447→**v448**.
- **Gates GREEN:** tsc 0 · build 0 · security 385/0 · headless audit **22/22** —
  the RESPONSIVE gate (overview + rooms @ 320/360/390/768/1280 in LIGHT and DARK
  with a stress-long hotel+room name) all ZERO h-overflow, + rooms-tab lucide
  (43) + rooms chrome emoji gone.
- NEXT (partner sweeps): Flash Deals tab → Bookings/Reservations/Availability
  (inline + walk-in/OTA chrome) → the standalone tab components
  (Channel/Billing/Guests/Staff/Circle/AgentAuction/Content/Housekeeping/Menu/
  Fnb/Reports). Then admin → circle → trade → host → onboard → worker +
  Hinglish sweep. Each ship now carries the multi-width responsive gate.

### 2026-08-03 — Session 6 cont. (v652 — partner Flash Deals sweep)
- **Flash Deals tab → lucide:** ⚡ Create-New header → Zap, ⚡ Launch-Deal CTA
  → Zap, the per-deal ⚡ card icon → Zap (coloured gold/muted by active-state
  instead of the old `grayscale` filter). KEEP: the `dealMsg` "✓ …" string +
  its `.startsWith("✓")` success-branch logic (string vocabulary).
- **Audit-fixture lesson (documented so the next tabs reuse it):** `flash` is a
  SUBSCRIPTION_SERVICE, so an empty-entitlements fixture LOCKS the tab —
  clicking it opens `ServiceLockModal` instead of the tab (that's why an earlier
  run "found ⚡" — the modal's "⚡ Activate", not the flash tab). Fixture now
  returns `entitlements` with every SUBSCRIPTION_SERVICE unlocked
  (flash/reservations/housekeeping/billing/menu/fnbqr/guests/reports/redeem/
  channels/staff/verification) so the real tab renders.
- **Surfaced for the standalone-component sweep:** `components/partner/
  ServiceLockModal.tsx` needs a FULL pass — emoji chrome (⚡ Activate / 💰 Show
  charges), Hinglish copy ("ek subscription service hai… choose karo… unlock
  karo… request bhejo"), AND hardcoded hex (#f7f8fa/#c1ccd7/#d7dee6, no dark).
  Deferred as one unit (emoji + Hinglish + dark-tokenize together), not a
  drive-by ⚡ swap.
- Badge v651→**v652** (`SB_BUILD v652-partner-flash`), sw `HTML_CACHE`
  v448→**v449**.
- **Gates GREEN:** tsc 0 · build 0 · security 385/0 · headless audit **12/12** —
  Flash tab (28 lucide, genuine — not the overview 82) chrome emoji gone +
  responsive @ 320/360/390/768/1280 × LIGHT/DARK all zero h-overflow.
- NEXT (partner sweeps): Bookings/Reservations/Availability inline (walk-in +
  OTA chrome) → the standalone tab components (Channel/Billing/Guests/Staff/
  Circle/AgentAuction/Content/Housekeeping/Menu/Fnb/Reports + ServiceLockModal +
  RoomEditorModal). Then admin → circle → trade → host → onboard → worker +
  Hinglish sweep. Multi-width responsive gate on every ship.

### 2026-08-03 — Session 6 cont. (v653 — partner Bookings + walk-in modals + availability OTA)
- **Bookings tab → lucide:** empty 📅 → CalendarDays, per-booking 🎫 → Ticket.
  The "→" date-range separator kept (data string). Status badges already ride
  the v650 tint layer (purple/blue/emerald).
- **Availability tab (inline):** 🌐 OTA Channel Sync → Globe. "Full Channel
  Manager →" arrow kept. (The 📅🛏️📊📌 view legend at L2267-2273 is inside a JSX
  COMMENT — not rendered, left as-is. The AvailabilityCalendar + OtaFeedManager
  components are the later standalone sweep.)
- **Both walk-in modals → lucide:** calendar-driven modal (✕→X, 🔢 Allocate →
  Hash, ✓ Confirm → Check) + the overview quick-walk-in modal (🏨 Front Desk →
  Hotel, ✕→X, 🏨 Room Category → BedDouble, ⚠️ no-rooms → TriangleAlert, 🛑
  occupied → OctagonX, 🔢 Allocate → Hash, ✓ Check-in/Confirm → Check). Complaints
  tab ↻ Refresh → RotateCw. Icon-only buttons got aria-labels.
- **Status-tint layer extended: INDIGO** — the quick-walk-in selected room
  category uses `bg-indigo-50`/`text-indigo` (not in the v650 set); added
  indigo-50/border/text dark overrides to the `.pdash-root` layer (verified the
  selected category flips to `rgba(99,102,241,0.13)` in dark).
- Badge v652→**v653** (`SB_BUILD v653-partner-bookings-walkin`), sw `HTML_CACHE`
  v449→**v450**.
- **Gates GREEN:** tsc 0 · build 0 · security 385/0 · headless audit **22/22** —
  Bookings tab AND the OPENED quick-walk-in modal responsive @ 320/360/390/768/
  1280 × LIGHT/DARK all zero h-overflow (modal at 320px too), chrome emoji gone,
  walk-in modal lucide (65), dark indigo tint confirmed.
- NEXT: the standalone partner tab COMPONENTS — Reservations/Housekeeping/Guests/
  Reports/Billing/Menu/Fnb/Channel/Staff/Circle/AgentAuction/Content + the
  modals (ServiceLockModal/RoomEditorModal/SubscriptionBillingModal) +
  AvailabilityCalendar/OtaFeedManager (each: emoji→lucide + dark-tokenize any
  hardcoded hex + English-ize Hinglish where present + responsive gate). Then
  admin → circle → trade → host → onboard → worker.

### 2026-08-03 — Session 6 cont. (v654 — partner standalone components START: modalPortal dark-scope fix + ReservationsTab)
- **SYSTEMIC FIX — every partner modal now gets dark mode.** `modalPortal`
  (`lib/partner/modal-portal.ts`) renders overlays into `document.body` (to
  escape the `.fade-up` transform trap), which put them OUTSIDE `.pdash-root`,
  so all 12 portaled partner modals escaped the dark bridge (white modal +
  light inputs in dark). Fixed by wrapping the portaled tree in a
  `<div className="pdash-root">` scope, so the design-system dark rules reach
  them. To keep the scope from forcing an opaque bg over a modal's own
  translucent backdrop, the page-bg rule was re-keyed to the dashboard root's
  `bg-luxury-50` (the generic `.pdash-root` dark rule now sets only `color`).
  Verified: the ReservationForm modal is byte-identical white in light and
  flips to `rgb(27,33,42)` (`--bg-card`) in dark. This one change dark-enables
  RoomEditorModal, ServiceLockModal, SubscriptionBillingModal, and every other
  portaled partner modal for free.
- **ReservationsTab — all 4 dimensions:** ① emoji → lucide (➕→Plus, 🔍
  placeholder → an absolute Search icon in the input, 🛎️→ConciergeBell,
  ✏️→Pencil, 🗑→Trash2, modal ×→X; icon-only buttons got aria-labels). ②
  hardcoded status hex → Tailwind class pairs (`ST` map upcoming/inhouse/
  departed → bg-blue-100/emerald-100/luxury-100 + text) so the v650 tint layer
  flips them in dark instead of the old inline `style={{background:#dbeafe…}}`.
  ③ Hinglish → English (the cancel-confirm, the "banao/edit karo/manage karo"
  subhead, both empty states, all 4 form validation messages, the "Guest ka
  naam" placeholders). ④ responsive verified. KEEP: the `alert("❌ …")` browser-
  alert string (can't host an icon).
- Badge v653→**v654** (`SB_BUILD v654-partner-reservations-modalscope`), sw
  `HTML_CACHE` v450→**v451**.
- **Gates GREEN:** tsc 0 · build 0 · security 385/0 · headless audit **21/21** —
  Reservations tab + the OPENED ReservationForm modal responsive @ 320/360/390/
  768/1280 × LIGHT/DARK all zero h-overflow; portaled modal light byte-identical
  white → dark `rgb(27,33,42)` (modalPortal fix proven); chrome emoji gone;
  Hinglish gone; lucide (29).
- NEXT (standalone components, each = emoji+dark-hex+Hinglish+responsive, all
  their modals now auto-dark): HousekeepingTab → GuestsTab → StaffTab →
  ChannelManagerTab/OtaFeedManager → BillingTab → MenuBuilderTab/FnbOrdersTab →
  ReportsTab → AgentAuctionTab → the Circle tabs → Content/Passport → the
  shared modals (ServiceLockModal/RoomEditorModal/SubscriptionBillingModal/
  ServiceRenewBanner/CodeScanner). Then admin → circle → trade → host → onboard
  → worker.

### 2026-08-03 — Session 6 cont. (v655 — partner HousekeepingTab)
- **HousekeepingTab — all 4 dimensions.** The status board keyed 4 states
  (clean/dirty/inspected/out_of_order) off an inline-hex `META` map (bg/color/
  border via `style={{}}`) with emoji icons — zero dark support.
  ① **status system tokenized:** `META` now carries Tailwind tint class pairs
  (emerald/amber/blue/red-50 + -200 border + -700 text) so the v650 dark tint
  layer flips every tile in dark; a saturated `ring` hex per state is the ONLY
  remaining inline color, used just for the active/selected outline (reads on
  both themes). Icons: ✨→Sparkles, 🧹→SprayCan, ✅→CircleCheck, 🚫→Ban.
  (Design note: "dirty" moved from a neutral #fafbfc bg to a soft amber tint —
  more meaningful "needs attention" + dark-capable.)
  ② other emoji → lucide: 🛏️ empty → BedDouble, 👤 assignee → UserRound, ↺ show-
  all → RotateCcw, modal ×→X, the not-provisioned ⚠ → TriangleAlert (+ its card
  moved off inline #fafbfc to bg-amber-50). ③ Hinglish → English across the
  subhead, the not-provisioned notice, both empty states, the filter-empty line,
  the staff-name placeholder, and the save-failure alert. ④ responsive verified.
- Every partner modal (incl. this UnitPicker) is now dark via the v654
  modalPortal scope — confirmed here.
- Badge v654→**v655** (`SB_BUILD v655-partner-housekeeping`), sw `HTML_CACHE`
  v451→**v452**.
- **Gates GREEN:** tsc 0 · build 0 · security 385/0 · headless audit **21/21** —
  Housekeeping tab + the opened UnitPicker modal responsive @ 320/360/390/768/
  1280 × LIGHT/DARK all zero h-overflow; dark status tint on a dirty unit tile =
  `rgba(245,158,11,0.13)`; modal dark `rgb(27,33,42)`; chrome emoji gone;
  Hinglish gone; lucide (36).
- NEXT (standalone components): GuestsTab → StaffTab → ChannelManagerTab/
  OtaFeedManager → BillingTab → MenuBuilderTab/FnbOrdersTab → ReportsTab →
  AgentAuctionTab → Circle tabs → Content/Passport → the shared modals. Then
  admin → circle → trade → host → onboard → worker.

### 2026-08-03 — Session 6 cont. (v656 — partner GuestsTab / Guest CRM)
- **GuestsTab (list + in-place detail view; no modal).** ① emoji → lucide: 🔍
  placeholder → an inline Search icon, 👥 empty → Users, ← back → ArrowLeft, the
  not-provisioned ⚠ → TriangleAlert. ② the not-provisioned card moved off inline
  `#fafbfc` to `bg-amber-50` (dark-capable). ③ Hinglish → English across the two
  not-provisioned notices, both empty states + the "guests appear automatically"
  hint, and the "No stay records" line (+ the setup alert). ④ responsive
  verified (list + detail). **KEEP (rule-honoring):** the ★ VIP stars (filter
  toggle, badges, Mark-VIP button) and the ✓ selected-tag ticks — rating/tick
  content vocabulary per the locked icon policy — plus the `alert("❌ …")`
  native-alert strings.
- Badge v655→**v656** (`SB_BUILD v656-partner-guests`), sw `HTML_CACHE`
  v452→**v453**.
- **Gates GREEN:** tsc 0 · build 0 · security 385/0 · headless audit **22/22** —
  Guest list + the opened detail view responsive @ 320/360/390/768/1280 ×
  LIGHT/DARK all zero h-overflow; chrome emoji gone; Hinglish gone; lucide (25);
  ★ VIP vocabulary confirmed kept.
- **14-rules adherence (owner asked):** every ship = presentation-only
  (security 385/0), light+dark measured, responsive gate @5 widths, no blind
  builds, computed-value verification, palette-locked tokens only, English copy,
  content-vocab emoji kept, additive-only + full ship checklist + ledger.
- NEXT (standalone components): StaffTab → ChannelManagerTab/OtaFeedManager →
  BillingTab → MenuBuilderTab/FnbOrdersTab → ReportsTab → AgentAuctionTab →
  Circle tabs → Content/Passport → the shared modals. Then admin → circle →
  trade → host → onboard → worker.

<!-- Append new sessions ABOVE this line’s template:
### YYYY-MM-DD — Session N (Phase X)
- done / verified / decided / NEXT
-->
