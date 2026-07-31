# StayBid Frontend — CLAUDE.md (lean)

> **📖 Full era-by-era history lives in [`docs/CLAUDE-HISTORY.md`](docs/CLAUDE-HISTORY.md)** (12,146 lines,
> nothing deleted). This lean file is the always-loaded working memory: project map,
> environment, current production state, and every load-bearing "Things to Avoid" rule
> distilled from that archive. When you need the *why* behind a rule or the detail of an
> old era, open the history file on demand — do NOT paste it back into CLAUDE.md.

---

## Project Overview
StayBid — luxury hotel reverse-auction platform. Customers browse hotels, place price
bids, book flash deals; hotels accept/counter/reject in real time. Plus StayBid Circle
(multi-investor operated-property models), StayBid for Hosts (managed portfolio), a
creator/reels social layer, a content-tier system, an Explorer Passport, a subscription
service layer, and a unified OTA Channel Manager.

- **Stack:** Next.js **16** App Router · React **19** · TypeScript **6** · Tailwind **4**
  (CSS-first `@theme` in `app/globals.css`, NO `tailwind.config.js`) · Supabase (project
  `uxxhbdqedazpmvbvaosh`) · Razorpay · Firebase (Google/Facebook/Phone auth) · Vercel.
- **Frontend deploy:** Vercel project `staybid-customer-frontend` → **`staybids.in`**.
  Auto-deploys from `main`. (Legacy Vercel projects `staybid-admin` / `staybid-hotel-panel`
  / `staybid-agent-panel` are abandoned snapshots — NOT this repo. The stray Netlify project
  `willowy-mooncake-a50d6f` has no repo config and red-fails every PR — ignore it.)
- **Backend:** Railway (Node/Express/Prisma/PostgreSQL) at
  `https://staybid-live-production.up.railway.app`, private repo `Sachinhelpline/staybid-Live`
  — NOT in this tree. Talk to it via `/api/proxy/*` (client) or direct fetch (server). Admin +
  partner panels actually live INSIDE this repo at `staybids.in/admin/*` + `/partner/*`.
- **DB:** Supabase PostgREST. Migrations in `migrations/*.sql`, applied via Supabase MCP
  `apply_migration`. **Additive/forward-only, TEXT ids (CUIDs), NO FK constraints anywhere.**

---

## Directory Structure (high-level)
```
app/
  page.tsx                            # "The Stage" home (components/home/DesktopHome.tsx), BOTH viewports
  discover/ / reels/                  # IG-style reel feed — unchanged, still the dedicated reel surfaces
  me/ me/posts/ saved/ saved/posts/   # IG-style self profile + posts scroll feeds
  hotels/ hotels/[id]/                # listing + detail (MOST COMPLEX page)
  bid/                                # reverse-auction (BidGameZone climber)
  flash-deals/ my-bids/ bookings/     # deals, bid history, confirmed stays
  passport/ (wallet/points/redeem/my-codes are redirect shells → /passport?tab=)
  auth/ profile/ upgrade/ verification/ complaints/
  partner/ partner/dashboard/         # hotel partner (multi-tab)
  admin/**                            # dark-luxury admin panel
  influencer/**                       # creator hub
  onboard/**                          # hotel owner self-signup wizard
  host/**                             # StayBid for Hosts vertical
  circle/**                           # StayBid Circle (model1 /discover→/build, model3, model4)
  worker/**                           # workforce panel (separate sb_worker session)
  api/**                              # all Next.js API routes
components/  home/ discover/ partner/ admin/ circle/ hotel/ tier/ verify/ passport/ upgrade/ host/ ...
lib/        api.ts auth.tsx sb.ts sb-server.ts sb-cache.ts razorpay.ts firebase.ts
            bid-expiry.ts price-snap.ts catalog.ts hotel-score.ts commission.ts attribution.ts
            pricing/{spine,read-spine} inventory/{engine,quote,assign,prebuy-window}
            b2b/engine.ts channels/{sync,adapters/} partner/{hotel-scope,operator-access,owner-ids}
            circle/{provision,disclosure,demand-cycle} host/{wizard-rules,modules,journey-data,provision}
            launch/curation.ts (launch-phase city/hotel allow-list — fail-open)
            passport/engine.ts tier/{eligibility,haversine,promote} sound-store follow-store posts-store
public/     sw.js  manifest.json  .well-known/assetlinks.json
migrations/*.sql   docs/*.md (incl. CLAUDE-HISTORY.md + phase plans/runbooks)
```

---

## Environment Variables
Public: `NEXT_PUBLIC_API_URL` · `NEXT_PUBLIC_RAZORPAY_KEY_ID=rzp_live_SfFAsbYjbHfztd` ·
`NEXT_PUBLIC_FIREBASE_*` (project `staybid-6feb7`) · `NEXT_PUBLIC_SB_IMAGE_TRANSFORM`
(Pro-plan image transform gate) · `NEXT_PUBLIC_ENABLE_PHONE_OTP` (default 0) ·
`NEXT_PUBLIC_ENABLE_LOCATION_OTP` (default 0).
Server-only: `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` (**environment-only — hardcoded fallbacks are
FORBIDDEN**; routes fail closed with `payment_config_missing` when unset) · `SUPABASE_SERVICE_ROLE_KEY`
(auto-elevates RLS via `lib/sb-server.ts`) · `CRON_SECRET` · **`JWT_ACCESS_SECRET`** (Railway's
authoritative HS256 access-token signing secret — the frontend verifies backend/admin/Gmail tokens against it) ·
`JWT_SECRET` (**now only a compatibility FALLBACK** for token verification + the onboarding token) · optional
`GEMINI_API_KEY` (free vision primary) / `ANTHROPIC_API_KEY` (paid backup) / `AI_VERIFY_PROVIDER` ·
`BOOKING_COM_LIVE` (inert channel-manager scaffold).
Public LIVE Razorpay key id `rzp_live_SfFAsbYjbHfztd` is safe in client code. **Never document or commit
secret VALUES anywhere — variable names + safe descriptions only.**

---

## Auth / identity (critical shared model)
- **Tokens (localStorage):** `sb_token`+`sb_user`+`sb_token_type` (`"backend"` HS256 / `"firebase"`
  RS256) · `sb_partner_token`+`sb_partner_user` · `sb_admin_token`+`sb_admin_user` ·
  `sb_worker_token`+`sb_worker`. All four session families are SEPARATE — never share keys.
- **NO single `users.id` per human.** The same person has up to 4 rows: Google Firebase UID,
  Facebook Firebase UID (`fb_`/`firebase_` prefix), Phone-OTP `+91…`, Phone-OTP no-prefix.
  Firebase rows store `phone = unknown_<uid>` placeholders. **Always resolve identities** via
  `resolveUserIds(primaryId, jwtPhone, jwtEmail)` / `resolveOwnerIdsCrossPool` — they walk 3 axes
  (Firebase prefix-twin, phone variants, case-insensitive email `ilike`). Pass `payload.email`.
- **`ensureUser` no-clobber:** INSERT placeholder only if row missing (`ignore-duplicates`), then
  PATCH real phone/name ONLY when the JWT carries them. Never overwrite a real phone with a
  placeholder.
- Route auth helpers: `userFromReq`/`socialUserFromReq` (customer), `x-partner-token`
  (+ `partnerHotelScope`/`partnerUnitScope`), **`requireVerifiedAdmin`** (`lib/admin/verify.ts`) +
  `logAdminAction`, `workerFromReq` (last-10-digit phone `ilike`).
- **🔒 Admin/cron auth contract (hotfix v621 — LOCKED):**
  - **`adm_*` opaque tokens are RETIRED and must NEVER be accepted as authentication** anywhere (was the
    old `adminFromReq`/cron bypass). `adminFromReq`, bare `x-admin-id`, and `adm_`-presence are all removed.
  - **Every `app/api/admin/**` handler gates with `await requireVerifiedAdmin(req)` before any body parse /
    DB / logging / mutation** (except `check-role` = login-verify, and `hotel-scores/recompute` = admin-OR-cron).
    It verifies the JWT signature + does a **server-side admin/super_admin role lookup on every request**;
    audit logs use the verified identity or `"unknown"` (never a header value).
  - **Admin login is GMAIL/RAILWAY ONLY (v621.1 — the phone + Master-PIN flow is REMOVED).** Admins sign in
    with Google at `/auth` (mobile OTP is intentionally disabled); Google returns a Railway HS256 access JWT
    stored as `sb_token`. `/admin/login` offers **"Continue with Google"** (→ `/auth?return=/admin/login`),
    then POSTs that token to `check-role` as `Authorization: Bearer <sb_token>`. `check-role` runs
    `requireVerifiedAdmin` (verify signature + DB role lookup, admin/super_admin only) and returns the verified
    identity; the client reuses the **same** verified token as `sb_admin_token` and stores only the
    server-returned identity as `sb_admin_user` (never the local `sb_user` role). **There is NO PIN, NO default
    PIN, and NO token-issuance path** — supplying phone/pin can never mint an admin token, and `ADMIN_JWT_SECRET`
    is no longer used anywhere (the forge-your-own-admin-token surface is gone).
  - **Admin tokens are verified against `JWT_ACCESS_SECRET`** (Railway's authoritative access-token secret —
    the same secret Google sign-in tokens are signed with), then the DB role lookup; `JWT_SECRET` is tried only
    as a compatibility fallback. A Firebase RS256 token fails the HS256 check → rejected. Railway tokens carry no
    `iss`/`aud`/`token_use` — see the token-purpose follow-up below.
  - **Cron routes (`app/api/cron/*`) accept `CRON_SECRET` ONLY, via `Authorization: Bearer <CRON_SECRET>`** — the
    `?token=` query-string and `x-cron-secret` transports are REMOVED (no secrets in URLs); the `adm_` path is gone.
  - **Notification queue** (`/api/notifications/queue`) requires a cryptographically-verified HS256 caller,
    binds `user_id` to the verified subject, and only permits validated internal same-origin paths (mirrored
    by `sbSafeUrl` in `public/sw.js`). **Firebase RS256 callers FAIL CLOSED** until `firebase-admin`
    verification lands (interim limitation).
  - **Permanent security regression suite:** `npm run test:security` (`tests/security/security.test.js`) —
    hermetic, network-free; covers the Gmail/Railway admin gate, the Master-PIN/default-PIN scrub across the
    tracked tree + rendered admin-login source, customer HS256/Firebase-fail-closed, notification URL hardening,
    Razorpay config-absent, and cron Bearer-only fail-closed. Run it on every auth change.
  - ⚠ **Follow-up (Railway):** add an admin-scope claim (`token_use`/`aud`) minted only at admin login so the
    frontend can distinguish admin-context tokens; today any valid Railway token for an admin-role subject
    authorizes admin access (bounded to that admin principal; DB role is the guard).
- **Sign-in-then-resume:** auth-gated CTAs use `redirectToSignIn(router,{route,action?,payload?})`
  (`lib/auth-intent.ts`, 30-min localStorage TTL) + `consumeMatchingIntent()` on the destination.
  `/auth` reads `?return=` (wrapped in `<Suspense>`).
- **Bulletproof logout** (`lib/auth.tsx`): allow-list wipe of localStorage (KEEP only device prefs:
  theme/city/build/reel-filter/reel-mute/reel-gain) + `sessionStorage.clear()` +
  `indexedDB.deleteDatabase("firebaseLocalStorageDb")` + lazy `firebaseSignOut` +
  `window.location.replace("/auth")`. Firebase imports MUST be lazy (dynamic import inside
  `logout()`) so SSR never calls `getAuth` without env vars.

---

## Current production state (v571 — Stage depth pass: real surfaces, honest discounts, a scroll rail)
- **Everything on the Stage that read FLAT or OVERSIZED was fixed at the cause** (owner review of the live site).
- **Ticker is a row of real LINKS** (deal → its hotel; season/inventory → the surfaces they describe), raised
  pills with a gold offer badge. Links change what the motion may do: **pointer** = marquee that pauses on
  `:hover`/`:focus-within`; **touch** = marquee that pauses on **`:active`** — the pause fires at touchstart, so
  the chip under the finger is frozen by the time the tap resolves. Verified by really clicking/tapping. Only
  the FIRST group is in the a11y tree; the seamless-loop duplicate is `aria-hidden` + `tabIndex={-1}`.
- **Cards are CONTAINER-LESS on BOTH viewports** (the Airbnb pattern the owner asked for): name + price sit on
  the PAGE under the artwork. **Depth belongs on `.sbh-card-media` (the tile), NEVER on `.sbh-card`** — a shadow
  around the text block is exactly what made them read heavy/"stretched". Mobile `46vw` / max 196px, crop
  **1:1**; desktop `clamp(258px,20.5vw,336px)`, crop 16:10.
  ⚠ Two corrections the owner had to make: "resize" meant **width only** (v568 restored the 1:1 crop after v567
  also cut it to 4:3), and the flash "% OFF" colour is the **`/flash-deals` GOLD stamp**
  (`#ffe9ad→#f2c650→#d69a1e`), not the home card's old red (v570).
- **Circle model cards + How-it-works steps + bid stat cards** — layered elevation, embossed numeral, display
  serif title, hover lift.
- **`<ScrollRail/>` (v571)** — our own right-edge scrollbar (drag to scroll, click track to page,
  `ResizeObserver` so the thumb stays honest). Mounts **only** when
  `innerWidth - documentElement.clientWidth === 0` (native bar takes no layout width ⇒ it is an overlay/hidden
  one) **and** `pointer:fine` **and** ≥1024px, so a Windows user with a classic bar never gets two. See the
  scrollbar invariant below for why CSS alone could not do this.
- `tsc` + `next build` clean; 8 breakpoints pass; reduced-motion audited clean.
  Badge **v571**, sw HTML_CACHE **v372**.

## Current production state (v566 — "The Stage": the home surface, desktop AND mobile)
- **`/` is no longer the reel player.** It is a streaming-service home (Netflix/Prime/Hotstar idiom) rendered by
  **`components/home/DesktopHome.tsx`** for BOTH viewports. Order:
  **Hero (season-driven) → live ticker → ⚡ Flash Deals → 🎬 Reels → 7 zone rails → 💎 Circle + 3 models →
  🛂 Passport card → Live Bidding band.** `/discover` + `/reels` are UNCHANGED and remain the dedicated reel surfaces —
  only the ENTRY point moved. Revert switch: `NEXT_PUBLIC_MOBILE_HOME="0"` puts mobile `/` back on the reel feed
  with no code change (desktop always gets the Stage).
- **Hero is SEASON-driven, not one property** — `currentMonthDemand()` / `demandTier()` from the pre-existing
  `lib/circle/demand-cycle.ts` (the real 12-month wheel; NOT a new engine). The pool = every shot property whose
  city is `primary` this month, `secondary` as fill, best-scorecard-first; rotates every 5s, pauses on hover,
  stops on dot tap, off under reduced-motion. 5s is the FLOOR — below that slides get cut mid-read.
- **Reel theater (v563)** — a reel card opens a player for THAT reel (it used to link to `/discover`, i.e. the
  top of a generic feed). Arrows/keys/swipe navigate the same 16 the rail renders; Esc closes; scroll lock
  restores the PREVIOUS overflow value. Panel carries the tagged hotel + its real cheapest rate →
  `/hotels/<id>`, and "name your own price" → `/hotels/<id>?intent=negotiate` (a real deep link; **`/bid` takes
  no hotel param** and would silently drop the hotel). Price comes from `/api/hotels/starting-prices` — launch
  curation caps `/api/hotels` to one property per city, so most tagged hotels are NOT in that payload.
- **Live Bidding band (v561/562)** — reads the EXISTING public `/api/bids/insights`. **Switches on real
  activity:** counters + recent wins when the platform is live; "How StayBid works" 3-step + "N hotels taking
  offers" when it is quiet. Zero-valued counters are filtered out — never print a wall of zeros under a
  "live right now" claim.
- **Circle row (v564)** — real Model-1 catalog + one line per model with live counts (`/api/circle/properties`,
  `/api/circle/marketplace-summary`, `/api/trade/lots`). ⚠ **`/api/circle/properties` returns `roiMin`/`roiMax`
  AND a ready-made `"18% ROI"` badge — NONE of it is rendered.** The home page is the most public surface on the
  site (seen by people who never open the Circle journey and so never see the in-journey disclosures), so the
  card shows `monthlyRate` — what the investor PAYS — plus `CIRCLE_INCOME_DISCLOSURE`. See the locked Circle
  legal rule below. `marketplace-summary` still uses the PRE-RENAME `model3`/`model4` keys (both are today's
  Model 2 — v346 rebrand); map them explicitly, never trust the key names.
- **Passport card (v565, redesigned v571)** — signed-in only; signed-out renders nothing **and never fires the
  request**. A bounded passport-booklet CARD (capped 470px desktop) at the BOTTOM of the rails, not the
  full-bleed strip it started as. Every
  figure from `GET /api/passport` (the same `lib/passport/engine.ts` the `/passport` page uses) — never recompute
  locally or the strip can disagree with the passport.
- Circle + Passport data load in their OWN effects, never the hero's `Promise.all`, so below-the-fold requests
  can't delay first paint.
- `tsc` + `next build` clean; verified headless at 1280/1440/1728/1920/2560 + 360/390/430. Badge **v566**,
  sw HTML_CACHE **v367**.

## Current production state (v391 — Circle settlement S3: RazorpayX payout execution (admin-triggered))
- **The real money-out — admin-triggered RazorpayX payout for a Circle owner's owed guest-booking rows. INERT
  until RazorpayX is provisioned** (env `RAZORPAYX_KEY_ID`/`RAZORPAYX_KEY_SECRET`/`RAZORPAYX_ACCOUNT_NUMBER`;
  optional `RAZORPAYX_PAYOUT_MODE` default IMPS). No creds ⇒ every payout path no-ops (button hidden), so nothing
  can fire accidentally.
- **NEW `lib/circle/razorpayx.ts`** (server-only) — `isRazorpayXConfigured()`, `ensureFundAccount` (creates the
  RazorpayX contact + bank/VPA fund_account on first use, reused after), `createPayout` (IMPS, `X-Payout-Idempotency`
  header). ⚠ Untested against live RazorpayX from this env — verify one TEST-mode payout before going live.
- **NEW admin action `payout_owner_batch { payeeUserId }`** (`/api/admin/circle-inventory`) — **two-phase claim so
  double-pay is impossible:** ① flip the owner's `owed` guest_booking rows → `paying`; ② the claimed set = all
  `paying` rows (recovers a crashed attempt); ③ ensure fund_account (stamp `razorpayx_fund_account_id` +
  status=verified on first create); ④ `createPayout` with an idempotency key derived from the exact claimed row
  ids (retry ⇒ RazorpayX returns the SAME payout, never a second send); ⑤ success → `paying`→`paid`; failure →
  `paying`→`owed` (released for retry). Migration `2026-07-20-v391` relaxes the `payout_status` CHECK to add
  `paying`.
- **Admin (`/admin/circle-inventory`)** — the Payout-batches panel shows **"RazorpayX live / not configured"**, a
  **"Pay via RazorpayX"** button (only when configured + owner has an account) + **"Mark paid (manual)"** (the
  interim rail, always available). GET returns `razorpayxConfigured`.
- **Live SQL round-trip verified** — claim→success (owed→paying→paid, 2/2), claim→release (paying→owed), 0 leftover;
  the `paying` state passes the CHECK. RazorpayX HTTP calls not exercised (inert without creds — as designed).
- ⚠ **Remaining (small, when RazorpayX is live):** refund claw-back on a `paid` row (today refund reversal only
  flips `owed`→`cancelled`), and optional auto-batch cron. Register `/api/cron/circle-settlement` (`*/30`) so owed
  rows accrue. **The whole money-out is admin-reviewed per owner — no unattended auto-transfer.**
- `tsc` + `next build` clean. Badge v390→**v391**, sw HTML_CACHE v202→v203. Migration `2026-07-20-v391` applied live.

## Current production state (v390 — Circle settlement S3 foundation: owner payout accounts + admin batches)
- **S3 FOUNDATION (owner decision "A") — the money-out prerequisites; still moves NO money.** Reality check: the
  Railway backend clone (`staybid-live`) is a thin skeleton — bookings are wallet-mode `paidAmount=0`, NO Razorpay
  money-in, NO payout rail, and the Circle tables aren't in its Prisma schema — so the real RazorpayX money-out
  can't live there yet. This ships the two hard prerequisites in the frontend (where the money layer already lives).
- **NEW `circle_payout_accounts`** (migration `2026-07-20-v390`) — where an owner gets paid (bank a/c + IFSC or
  UPI), `status` pending/verified, `razorpayx_fund_account_id` stamped later. One per user (`uniq_payout_account_user`),
  permissive RLS. **NEW `GET/POST /api/circle/payout-account`** (customer sb_token → cross-pool; self-only;
  bank/IFSC/UPI validated; editing resets status→pending + clears the fund-account link). Details stored for the
  future RazorpayX fund-account; **saving moves no money.**
- **`app/circle/earnings`** — a 🏦 **Payout account** card (bank/UPI toggle, masked display, edit) so owners add
  where they get paid.
- **Admin (`/admin/circle-inventory`)** — a NEW 💸 **Payout batches** panel: owed guest_booking rows grouped
  **per owner** (bookings · total owed · payout-account status ⚠/✓) + a **Mark batch paid** bulk action
  `mark_owner_batch_paid` (flips ALL that owner's owed guest_booking rows → paid). GET returns `payoutBatches`
  (joins `circle_payout_accounts`). Per-row `mark_guest_booking_paid` (v389) stays.
- **Live SQL round-trip verified** — account saved, batch mark-paid flipped 2/2 rows (₹4,400 = 2640+1760), 0 leftover.
- ⚠ **Still NOT built (final S3 money-out, needs YOUR ops):** RazorpayX account + creds, then a payout cron that
  creates a fund-account per owner from `circle_payout_accounts` and executes the transfer (owed→paid + bank move)
  + refund claw-back. All the data plumbing is now ready for it. `mark_owner_batch_paid` is the interim manual rail.
- `tsc` + `next build` clean. Badge v389→**v390**, sw HTML_CACHE v201→v202. Migration `2026-07-20-v390` applied live.

## Current production state (v389 — Circle settlement S2: guest-booking owed reconciler + admin payouts)
- **S2 of the money layer — RECORDS the owner's owed obligation from confirmed guest bookings; moves NO money.**
  Uses the v388 resolver. `bookings` are Railway-created (into Supabase) with no in-repo confirm hook, so the
  record layer is a **cron reconciler**, not a verify-hook.
- **NEW `GET/POST /api/cron/circle-settlement`** (token-gated like the other crons; register cron-job.org
  `*/30 * * * *`). Two idempotent passes over recent bookings (`checkOut ≥ today−120d`, bounded 200):
  ① **SETTLE** — confirmed/paid, non-cancelled booking → `bidId`→`bids.assignedUnitId`→unit → resolve per-night
  payee (`resolveNightlyPayees`) → keep Circle-attributed nights → pro-rate `paidAmount` → INSERT one owed
  `settlement_ledger` row per payee (`kind='guest_booking'`, `ref_id='<bookingId>:<payeeId>'`, fee **12%** frozen,
  `payout_status='owed'`), idempotent via `uniq_settlement_kind_ref`. StayBid-retained nights (sentinel owner /
  classic hotel) get NO row (owner decision 2 — they stay on the existing hotel settlement). ② **REVERSE** —
  now-cancelled/refunded booking → its still-`owed` rows flip to `cancelled` (`ref_id=like.<bookingId>:*`).
- **Admin (`/admin/circle-inventory`)** — a NEW "🏠 Guest-booking payouts owed to owners" panel (owner · booking ·
  nights · guest-paid share · fee · owner net) + a **Mark paid** action `mark_guest_booking_paid` (owed→paid,
  manual reconciliation; mirrors `mark_settlement_paid`). GET returns `guestBookingSettlements` + KPIs
  `gbOwed/gbPaid/gbFees/gbCount`.
- **Owner decisions applied:** fee 12% single-source (`CIRCLE_BOOKING_FEE_PCT_DEFAULT`, frozen per row); Circle
  owners paid via this ledger, classic hotels unchanged; payout rail = RazorpayX batch (record owed now, money-out
  is S3); escrow OK. **Live SQL round-trip verified** — dual-payee split, `(kind,ref_id)` idempotency (dup ignored,
  net not clobbered), refund reversal (2/2 flipped), 0 leftover.
- ⚠ **NOT built (S3):** auto money-out (RazorpayX/Route owed→paid + bank transfer) + paid-row claw-back on refund —
  Railway phase. `mark_guest_booking_paid` is the interim manual payout-record.
- `tsc` + `next build` clean. Badge v388→**v389**, sw HTML_CACHE v200→v201. ⚠ Pending cron registration:
  `/api/cron/circle-settlement` (`*/30 * * * *`).

## Current production state (v388 — Circle settlement S1: attribution resolver + projected earnings (read-only))
- **First phase of the money attribution/settlement layer (design in `docs/CIRCLE-SETTLEMENT-ATTRIBUTION-DESIGN.md`).
  PURE + READ-ONLY — writes nothing, moves no money.** Closes the "who earns this unit-night" gap in code
  without touching any money path.
- **NEW `lib/circle/attribution.ts`** — the single source of truth resolver. `resolveNightlyPayees(nights, ctx)`
  resolves a payee PER NIGHT by precedence: ① an `inventory_blocks` overlay (owned/listed) covering that unit+date
  → `investor_user_id` (the TRANSFERABLE commercial right); ② else `hotel_room_units.owner_user_id`; ③ else the
  hotel owner, unless a Circle-ops sentinel (`STAYBID_CIRCLE_OPS`/`hco_`) → null (StayBid retains). **SEBI-safe by
  construction** — reads the transferable `investor_user_id`, never the frozen `owner_user_id`. `enumerateNights`
  is checkout-EXCLUSIVE. `CIRCLE_BOOKING_FEE_PCT_DEFAULT=12` is illustrative-only (committed fee = S2 decision).
  6/6 algorithm cases verified (night-exclusive, block-overlay split, pending-block ignored, sentinel-retained,
  classic-hotel-owner).
- **NEW `GET /api/circle/projected-earnings`** (customer sb_token → cross-pool ids) — projects what the owner
  WOULD be owed from real confirmed bookings: owner units ∪ owned blocks → bids on those units → paid bookings
  (`bidId` join, non-cancelled) → resolve per-night payee → keep the owner's nights → pro-rate `paidAmount` ×
  (1−fee). All reads; returns `{projectedNetOwed, projectedGross, bookingCount, nightsCount, feePct, items}`.
- **`app/circle/earnings`** — a **📈 "Projected from your live bookings" PREVIEW** panel (net/gross/bookings·nights
  + line items), shown only when `bookingCount>0`, clearly labelled illustrative / "nothing recorded or paid yet".
- ⚠ **NOT built (S2/S3, pending owner decisions):** the owed `settlement_ledger` write at booking-confirm (kind
  `guest_booking`, authoritative in Railway) + payout execution (RazorpayX/Route) + refund reversal. 4 open owner
  decisions: fee %, StayBid-retained nights, payout rail, escrow. `bookings` are Railway-owned; the resolver is
  mirrored there for the authoritative write.
- `tsc` + `next build` clean. Badge v387→**v388**, sw HTML_CACHE v199→v200.

## Current production state (v387 — Circle Phase 2: B2C one-tap "list all" on purchase (owner decision 1a))
- **Phase 2 of the cross-model selling audit — the new owner's inventory is one-tap B2C-available on purchase**
  (owner picked option 1a: one-tap available, NOT force auto-list; and accepted the boundary that resale-buyer
  guest PAYOUT stays a settlement-phase item — only AVAILABILITY is wired here).
- **NEW bulk action `POST /api/circle/inventory/sell { action: "list_all" }`** — lists EVERY `owned`/`listed`,
  current (`date_to ≥ today`) block the caller holds, in one tap. Refactored the per-block logic into
  `listBlockPublic` / `pauseBlockPublic` helpers (single `list`/`pause` behaviour byte-identical). SEBI-safe by
  construction: authorization is by BLOCK ownership (`inventory_blocks.investor_user_id`, cross-pool); the hold
  release is block-level (opens exactly the caller's nights); the unit-level `is_listed`/`price_override` PATCH
  stays guarded on `owner_user_id`, so a resale buyer never mutates a seller-owned unit's global config.
  Idempotent (skips already-`publicListed`). Excludes `pending_payment`/past blocks. Live round-trip verified
  (seed owned block+hold → list_all selects 1, releases hold, stamps publicListed=true → 0 leftover).
- **`app/circle/model2/selling`** — a post-purchase **"🎉 N room-night sets ready to sell"** nudge + a **"List all
  for booking"** one-tap button (Option A); channels relabelled **Option A · Sell on StayBid** / **Option B ·
  Direct selling** (+ Model 3 agents / OTA) so a Model 2 buyer OR a Model 3 agent who bought on Model 2 sees the
  same clear A/B module. `app/circle/model2/review` success copy points at the one-tap listing.
- **Scope note:** this surface serves inventory-BLOCK holders (Model 2 buyers + Model 3 agents). Model 1
  provisioned owners hold `owner_user_id` UNITS (not blocks) and manage B2C from the partner dashboard via the
  v386 bridge — correct split, unchanged.
- `tsc` + `next build` clean. Badge v386→**v387**, sw HTML_CACHE v198→v199.

## Current production state (v386 — Circle investor → partner-dashboard bridge (cross-model B2B sell reachability))
- **Phase 1 of the cross-model selling audit: a pure Circle investor can now REACH the B2B sell surfaces.** The
  cross-model sell *APIs* already existed and are scope-permissive (`POST /api/b2b/listings` list-on-exchange,
  `POST /api/trade/owner/lots` publish-to-agents — both gated by `partnerHotelScope` = owned ∪ operated units),
  but both live only inside `/partner/dashboard`, and `partner/google-login` admits only registered hotel owners
  — so a pure Circle investor (role `customer`, operates units via `owner_user_id`) was locked out. A Model 1
  provisioned owner DOES hold `owner_user_id` units (`lib/circle/provision.ts` `stampOwnedUnits` stamps
  `owner_user_id` + `is_listed=true`), so operator scope is correct once they have a partner session.
- **NEW `lib/circle/partner-bridge.ts` `bridgeToPartnerDashboard(user, tab?)`** — reuses the investor's Circle
  `sb_token` as `sb_partner_token` (+ `sb_partner_user`) and opens `/partner/dashboard?tab=…`. Mirrors the proven
  Model-3-winner bridge (`app/trade/my-bids` enable-selling); ADD-only (never touches the customer `sb_token`),
  partner routes only `decodeJwt` + scope by `owner_user_id`.
- **`app/partner/dashboard/page.tsx`** now honours a `?tab=` query on first mount (deep-link) so the bridge lands
  on **My Rooms** (`myrooms` → B2B exchange list + StayBid B2C), **Sell to Agents** (`agentauction` → Model 3
  auction publish), or **Channel Manager** (`channels` → OTA) instead of always Overview.
- **`app/circle/me`** + **`app/circle/model2/selling`** — the plain `/partner/dashboard` links (which dropped a
  pure investor on a blocked dashboard) are now token-bridging buttons, and both surfaces gained an explicit
  🏷️ **Sell to travel agents (Model 3)** entry alongside 🏠 StayBid B2C · ⇄ Model 2 exchange · 🌐 OTA.
- ⚠ **Phase 2 (pending owner decision, NOT built):** "B2C auto-opens on a Model 2 purchase" + resale-buyer
  guest-payout. Blocked by two LOCKED contracts — `owner_user_id` never transfers between investors (SEBI-safe;
  an `investor_block` resale moves only `inventory_blocks.investor_user_id`, so guest attribution still keys to
  the seller's `owner_user_id`), and there is no auto guest→owner payout anywhere (settlement/Railway phase).
  The B2C *availability* option (`/api/circle/inventory/sell` list/pause) exists; the money attribution does not.
- `tsc` + `next build` clean. Badge v385→**v386**, sw HTML_CACHE v197→v198.

## Current production state (v385 — Trade: floor-consistent min bid (browse == tour) + browse sort/filters)
- **Fixed the "browse says ₹1,200 min, bid page says ₹4,900 min" inconsistency (`app/trade/[id]` `LiveBidBox`).**
  Root cause: the v383 profit ladder computed the picks purely OFF the MRP (Save Big = 40% off rack) and set
  `sliderMin = saveBidVal`, so on a Circle-operated lot where the floor sits far below the room's booking price
  (Mussoorie Ridge Deluxe: floor ₹1,200 = purchase ₹1,000 × 1.20, rack/MRP ₹7,200) the tour page refused any bid
  below ~₹4,900 — contradicting the browse card's real `min_bid_per_room_night` (₹1,200). Now the ladder is
  **anchored to the real floor → MRP-ceiling**: `mrpCeil = round100(rack/(1+prem))`, `floorBid = min(floor,
  mrpCeil)`, Save Big = `floorBid` (the advertised floor, best margin), Smart = `floor + 34% span` (default,
  nudge up), Max = `floor + 67% span` (strong); `sliderMin = floorBid`, `sliderMax = mrpCeil`. The tour minimum
  now equals the browse "Min bid" for EVERY lot. Verified: Mussoorie Save Big ₹1,200 / Smart ₹3,100 / Max ₹5,000,
  slider ₹1,200–₹6,900; Cave View (tight floor ₹2,300, rack ₹4,900) Save Big ₹2,300 / Smart ₹3,100 / Max ₹3,900.
  Profit still framed off MRP (unchanged); default stays Smart. Data confirmed real via `room_date_price`
  (base_rate ₹7,200, live ₹4,200–5,700) — the low floor is the legit Circle owner cost, not a bug.
- **Model 3 browse (`/trade`) gained sort + filters** (was city-only): a **sale-mode** chip row (All / ⚡ Live /
  🔒 Sealed) + a **Sort** dropdown (Recommended / Price low→high / Price high→low / Most rooms / Month soonest).
  All client-side over the lots the API already returns (`min_bid_per_room_night`, `num_rooms`, `month_key`,
  `sale_mode`) — no API change. Empty-state copy reflects the active city + mode.
- `tsc` + `next build` clean. Badge v384→**v385**, sw HTML_CACHE v196→v197.

## Current production state (v384 — Trade coach: profit bifurcation + rooms stepper + consistent top strip)
- **Four clarity fixes on `app/trade/[id]` (booking-price framing polish; pure UI, no money/logic change):**
  1. **Top metric strip consistency** — for a LIVE lot the first `.sbt-metrics` card now shows **ROOM BOOKING
     PRICE** (`market.rack` MRP, e.g. ₹4,900) instead of the stale internal **MIN BID / ROOM / NIGHT ₹2,300**
     (which contradicted the booking-price coach). Sealed lots keep MIN BID. `bookingPriceTop` computed in the
     parent from `data.market?.rack` (same fallback chain as the coach).
  2. **Removed the pick %-profit sublabel** — the Save Big / Smart / Max quick-picks no longer print
     "~40% / ~30% / ~20% profit" (kept the agent blind to the internal ladder; picks show only label + ₹ price).
  3. **Profit bifurcation** — the two profit cells were identical when rooms=1. Now **PROFIT / ROOM / NIGHT**
     (`profitPerNight` = bookingPrice − bid×(1+premium)) vs **TOTAL PROFIT** (`= rooms × nights × per-night`)
     with a visible breakdown line "`N rooms × MN × ₹per-night`" so the multiplication is explicit.
  4. **Rooms stepper** — replaced the bare `<input type=number>` (whose browser spinner jumped straight to max
     on some devices, skipping 2/3/4) with a `RoomStepper` (−/value/+ buttons, clamped 1..num_rooms). Used in
     BOTH `LiveBidBox` and the sealed `BidBox`. Every value 1..max is now reliably selectable.
- Verified `tsc` + `next build` clean. Badge v383→**v384**, sw HTML_CACHE v195→v196.

## Current production state (v383 — Agent coach: booking-price (MRP) profit ladder, high-interest + blind)
- **Per owner direction, the agent bid coach is now BOOKING-PRICE (MRP) framed to maximise interest, and the
  accept mechanics are hidden (the agent bids "blind").** `app/trade/[id]` `LiveBidBox`:
  - **Profit is measured against the room's BOOKING PRICE (rack/MRP `market.rack`, e.g. ₹4,900)**, not the live
    ADR — `profit/night = bookingPrice − bid×(1+premium)`, shown as **EST. PROFIT / ROOM** and **TOTAL PROFIT**.
  - **Quick-picks are a profit ladder off the booking price**: 💰 Save Big (~40%), ⭐ Smart (~30%, default), ⚡ Max
    (~20%). `bid(P) = round100(bookingPrice / ((1+premium)(1+P)))`. The slider spans the 40%→~0% price; the agent
    is **not hard-capped** at 20% (they may bid higher for certainty — a higher bid pleases the owner).
  - **Blind:** removed the "owner reviews / locks instantly / below-floor" chip, the coach tip, the pick outcome
    sublabels, the exposed floor/min-offer text, and the mode name in the pill (now "⚡ Live · no deposit"). The
    submit button is a neutral "Place bid". The server still enforces the real floor + instant-lock under the hood.
  - Cells: **ROOM BOOKING PRICE** (was RACK RATE), **GUESTS PAY** (min–max, up to booking price), **EST. PROFIT /
    ROOM**, **TOTAL PROFIT**. Market range folded into GUESTS PAY (up to MRP).
  - `lib/trade/market.ts` `monthMarket` already returns `rack`. All base numbers 100% real Spine data. Verified
    (Cave View, MRP ₹4,900): Smart ₹3,600 → ₹33,600 profit (30%); Save Big ₹3,300 (40%); Max ₹3,900 (20%).
    Badge v382→**v383**, sw HTML_CACHE v194→v195.
  - ⚠ Framing note: profit is vs the room's rack/booking price (the travel-agent resell-to-own-clients model),
    not the live StayBid ADR — an intentional high-interest product choice by the owner.

## Current production state (v382 — Agent coach: Rack Rate + Est. Profit (hide internal floors))
- **The agent AI coach hides the internal floor math and sells the OPPORTUNITY.** The `RETAIL FLOOR` +
  `YOUR WHOLESALE FLOOR` cells (confusing for an agent) are replaced with **RACK RATE** (the room's list/rack
  rate = MRP-equivalent, `max(room_date_price.base_rate)` — Cave View ₹4,900), **GUESTS PAY (LIVE)** (the real
  Spine ADR), **EST. PROFIT** (a big ₹ number = `(ADR − bid) × nights × rooms`, with an "up to ₹X" peak using the
  market high), and MARKET RANGE. The slider header shows **≈ ₹{profit} profit** (green) instead of a bare %.
  `lib/trade/market.ts` `monthMarket` now also returns `rack` (max base_rate; falls back to peak×1.6). All
  numbers are 100% real Spine data. Owner tab keeps the retail/wholesale/anchor breakdown (they need it to set
  the discount). Verified (Cave View): Rack ₹4,900 · ADR ₹2,867 · Smart ₹2,645 → Est. profit ₹6,660 (up to
  ₹19,650); Save Big ₹2,100 → ₹23,010. Badge v381→**v382**, sw HTML_CACHE v193→v194.

## Current production state (v381 — Live bid never gets "stuck": self-withdraw + auto-expiry TTL)
- **An old live bid can never block a new one.** Two safety nets: (1) an agent can **withdraw their own
  un-paid bid** — `POST /api/trade/bids/cancel` (agent auth; cancellable while `active`/`countered`/`accepted`;
  an `accepted` bid's minted award (`status=awarded`, un-paid) is cancelled too; a PAID/voucher bid is never
  touched). (2) The cron **auto-expires stale pending live bids** — `auction-lifecycle` Pass D flips
  `active`/`countered` live bids older than `live_offer_ttl_hours` (config, default **48h**) to `expired`.
- **UI:** `/trade/my-bids` — a **Withdraw** button on `active`/`countered` bids AND on `awarded` (accepted-unpaid)
  live vouchers; `/trade/[id]` the "you already have a live bid" error now links to **Manage / withdraw in My
  Bids**. Config `live_offer_ttl_hours` admin-tunable in `/admin/auction`. Migration
  `2026-07-19-v381-live-bid-cancel-ttl.sql`. Verified: cancelling the accepted bid + its award → 0 blocking bids
  (agent free to re-bid).
- **Coach polish:** removed the redundant Offer/Floor/Market text labels under the slider (same values are in the
  cells + picks). Confirmed the Market ADR is **100% real live Spine data** (`room_date_price.live_price` — real
  per-date rows; this demo room's dynamic price is genuinely ₹2,800–3,400, MRP ₹4,900). Badge v380→**v381**, sw
  HTML_CACHE v192→v193.

## Current production state (v380 — Below-floor offers forwarded (customer-parity) + quick-pick tiers)
- **Below-floor bids are now FORWARDED to the owner (not rejected)** — mirroring the customer negotiation panel
  (a guest can bid below the room floor and the hotel reviews/counters). Bounded: an agent may bid down to
  `floor × below_floor_min_ratio` (config, default **0.85**, clamp 0.5–1); anything lower is rejected ("too low").
  A below-floor bid is NEVER auto-accepted (any mode) — it always becomes an OFFER the owner can accept /
  counter / decline. `lib/trade/live-auction.ts` `evaluateLiveBid` now returns `pending{belowFloor}` /
  `reject{too_low}`; `bids/place-live` allows `[floor×0.85, floor)` as a forwarded offer (metadata
  `below_floor`), rejects below `floor×0.85`. Owner "Live bids to review" tags below-floor offers.
- **Quick-picks mirror the customer arena** (Save Big / Smart / Instant): `LiveBidBox` picks are 💰 **Save Big**
  (below floor → "owner reviews", best margin), ⭐ **Smart** (instant-lock threshold → "locks instantly ✓",
  recommended default), ⚡ **Market** (near the live ADR → priority lock). The slider now spans `floor×0.85` →
  market ceiling with Offer/Floor/Market marks; the outcome chip reads "⧗ Owner reviews · below floor" in that
  band. Config `below_floor_min_ratio` admin-tunable in `/admin/auction`. Migration
  `2026-07-19-v380-below-floor-forward.sql`. Verified (Cave View floor ₹2,300): reject <₹1,955, below-floor
  offer ₹1,955–2,299, owner-review ₹2,300–2,644, instant-lock ≥₹2,645. Badge v379→**v380**, sw HTML_CACHE v191→v192.

## Current production state (v379 — Live: no bare-floor auto-accept (Smart instant-lock) + scarcity)
- **The bare floor no longer auto-confirms by default** (fixes "agents always bid the minimum"). The default mode
  is now **Smart** (`autopilot='hybrid'`, relabelled): a bid **instant-LOCKS only at/above floor ×
  `live_hybrid_accept_ratio`** (default bumped 1.10→**1.15**); a floor/below-threshold bid goes to the owner
  (accept/counter/decline — they can take a higher competing bid). Pure **"Instant"** (`autopilot='auto'`,
  accepts at floor) stays as an explicit, ⚠-warned owner opt-in. `LIVE_AUTOPILOT_LABEL`: hybrid→"Smart" (default),
  auto→"Instant (accepts at floor)", manual→"Manual". Migration `2026-07-19-v379-smart-instant-lock.sql`
  (config ratio 1.15 + default hybrid + reseed demo Cave View auto→hybrid). Verified: Cave View floor ₹2,300 →
  **instant-lock at ₹2,645**; floor now "owner reviews", not auto-confirm.
- **Coach reframed to push the agent up:** `app/trade/[id]` `LiveBidBox` now DEFAULTS the bid to the **Smart
  (instant-lock) price**, not the bare floor; the Floor quick-pick reads "owner reviews", Smart reads "Locks
  instantly ✓"; the outcome chip is "✓ Locks instantly" vs "⧗ Owner reviews". **Scarcity:** `lots/[id]` returns
  `roomsAvailable` (num_rooms − awarded); when ≤3 the coach shows "🔥 Only N rooms left — higher bids get
  priority." Owner mode picker lists Smart first. Badge v378→**v379**, sw HTML_CACHE v190→v191.

## Current production state (v378 — Dynamic Spine-linked property floor + owner control)
- **Property-owner Model-3 floor is now DYNAMIC (Spine ADR-linked), not a static floorPrice.** The floor tracks
  the room's LIVE month Spine ADR (same dynamic engine that prices guests): `dynamicWholesaleFloor =
  ceil100(monthSpineADR × (1 − wholesale_discount_pct))`, floored by a HARD ANCHOR
  `ceil100(retail floorPrice × min_floor_fraction)` so an off-season dip can't collapse the owner's price.
  Peak month ⇒ higher floor (owner protected); off-season ⇒ lower (liquidity). `lib/trade/lots.ts`
  `dynamicWholesaleFloor()`. Shared live-market reader `lib/trade/market.ts` `monthMarket()` (room_date_price +
  Spine) backs BOTH the floor (owner/lots + owner/quote) AND the agent coach (lots/[id]) — same engine.
  Config `auction_config.floor_mode` ('dynamic' default | 'static') + `min_floor_fraction` (0.6, clamp 0.4–1),
  admin-tunable in `/admin/auction`. Frozen per lot (`floor_mode` + `spine_adr_at_publish`). If Spine ADR is
  unavailable at publish, it falls back to the STATIC floor (records the fallback) — a pricing outage never
  breaks publish. Migration `2026-07-19-v378-dynamic-spine-floor.sql` (+ dynamic reseed of the 3 property demo
  live lots). Circle-owner floor (purchase × 1.20) UNCHANGED.
- **Owner control (manual override) in `AgentAuctionTab`:** property owners get a **wholesale-discount slider
  (0–40%)** with a live floor breakdown (Market ADR → Your floor → Safety anchor) that previews the exact
  server formula as they drag; they can still **raise** the min bid above the computed floor (server clamps
  `minBid = max(asked, floor)` — tamper-safe, never below cost). Verified: Cave View live ADR ₹2,870 − 20% →
  floor **₹2,300** (anchor ₹1,700), 20% agent headroom; peak months lift it automatically. Badge v377→**v378**,
  sw HTML_CACHE v189→v190.

## Current production state (v377 — Trade wholesale floor (real margin) + slidable AI coach)
- **Root fix for "2% margin" (agent had no reason to buy):** the property-owner Model-3 floor was the room's
  RETAIL `floorPrice` (≈ the room's cheapest retail night), so an agent's floor ≈ the live ADR. Now the
  property-owner floor is a **WHOLESALE floor = retail floorPrice × (1 − wholesale_discount_pct)** (bulk +
  advance + guaranteed ⇒ real discount). `auction_config.wholesale_discount_pct` default **20** (admin-tunable
  in `/admin/auction`, clamped 0–40), optional per-lot override; frozen on `auction_lots.wholesale_discount_pct`
  + `retail_floor_per_night` at publish (tamper-safe). `wholesaleFloor()` in `lib/trade/lots.ts`; applied in
  `owner/lots` POST + `owner/quote`. **Circle-owner floor (purchase × 1.20) is UNCHANGED.** Verified: Cave View
  retail ₹2,800 → wholesale ₹2,240, live ADR ₹2,870 → **22% resale headroom** (was 2%). Migration
  `2026-07-19-v377-wholesale-floor-discount.sql` (+ reseed of the 3 property demo live lots).
- **ADR is 100% real, live Spine data** (`room_date_price.live_price` / `resolveSpinePrices` over the lot month,
  `lots/[id].market`) — NOT fabricated. The coach hides the market panel gracefully if Spine data is missing.
- **The AI Bid Coach gauge is now a real SLIDABLE price slider** (`app/trade/[id]` `LiveBidBox`): a gradient
  range input (red floor → green market, gold thumb, touch-friendly) drags the bid between the wholesale floor
  and the live-market ceiling; live resale-margin % updates as you drag. Plus **Floor / Smart / Market
  quick-pick tiers** (like the customer arena's Save/Smart/Instant) and a market panel showing Retail floor →
  Your wholesale floor → Market ADR (live) → range. Owner "Sell to Agents" tab explains the wholesale floor.
  Badge v376→**v377**, sw HTML_CACHE v188→v189.

## Current production state (v376 — Trade AI Bid Coach + phone step without OTP)
- **Trade LIVE bid box now has an "AI Bid Coach" (stock-style market intelligence)** so agents don't just bid the
  floor: `app/trade/[id]` `LiveBidBox` shows the room's REAL guest market price (ADR + low/high, from the new
  `lots/[id]` `market` field = `room_date_price.live_price` / Spine over the lot month, `marketRange` bounded 14
  Spine fills), a Floor→bid→Market gauge, resale-headroom %, an autopilot outcome chip (auto-confirms vs owner
  reviews via `evaluateLiveBid`), and a per-mode **suggested bid** (auto→floor is optimal; hybrid→auto-confirm
  threshold `floor×ratio`; manual→toward market ADR) with a tap-to-apply button. Pure/read; no money change.
- **Phone step works WITHOUT the (dead) OTP:** the hotel-page "One Quick Step" gate (`withBackendAuth` →
  Firebase/Google users) no longer blocks bids/bookings on the broken SMS OTP. When
  `NEXT_PUBLIC_ENABLE_PHONE_OTP != 1` (default) the modal collects the number in one step and saves it —
  `saveVerifyPhone` → NEW `POST /api/user/phone` (`socialUserFromReq`, no-clobber PATCH: only fills null/empty/
  `unknown_*` phone) + updates the local session user so the booking/bid carries a reachable number. When the
  flag is on, the full Send-OTP → Verify flow is unchanged. Badge v375→**v376**, sw HTML_CACHE v187→v188.

## Current production state (v374, Circle "Model 3" — LIVE always-open mode: no-EMD, autopilot, pay-on-accept)
- **NEW launch-default sale mode for Model 3: an always-open LIVE bulk auction alongside the existing sealed
  monthly auction (both coexist; the sealed path is UNCHANGED).** `auction_lots.sale_mode` = `'live'` (new
  default for the owner form) or `'sealed'` (existing rows keep this). A live lot is open from publish and
  biddable through the inventory month (`window_close_at = month_end`), NO EMD, NO clearing engine.
- **How it works (mirrors the customer reverse-auction):** owner publishes a live lot with a floor + an
  autopilot mode (`auction_lots.autopilot_mode` = auto|hybrid|manual) → an approved agent bids like a StayBid
  guest but for BULK rooms (segment + per-room-per-night ≥ floor + rooms), **no deposit** → the lot autopilot
  decides via the pure engine `lib/trade/live-auction.ts` `evaluateLiveBid`: **auto** accepts any at/above-floor
  bid instantly; **hybrid** accepts a bid ≥ floor × `live_hybrid_accept_ratio` (default 1.10), at-floor waits;
  **manual** waits for the owner. On ACCEPT (autopilot at bid time, or owner later) we mint an `auction_awards`
  row (`createLiveAward`, `lib/trade/live-award.ts`, idempotent on `uniq_auction_award_bid`) → the agent pays
  via the **existing, already-verified award money path unchanged** (`awards/pay` → `awards/verify` 4-key
  idempotent → voucher + owner settlement) → `awards/[id]/enable-selling` (operator scope + holds) → Option A
  (sell on StayBid + OTA) / Option B (own channel). No EMD ⇒ `deposit_applied=0`, `amount_due = base + buyer
  premium`. Units are assigned at PAY (enable-selling), so nothing is held pre-pay.
- **Routes:** `bids/place-live` (agent live bid, no payment, autopilot decision), `owner/live-bids`
  (owner GET pending + POST accept/reject/counter), `bids/accept-counter` (agent takes the owner counter,
  re-priced server-side). `owner/lots` POST branches by `saleMode`; `owner/quote` + `lots/[id]` return live
  config. Cron `auction-lifecycle`: SEALED lots only in the clearing pass (`sale_mode=neq.live`); NEW Pass C
  expires accepted-unpaid live bids + their live awards past `pay_deadline_at` (nothing to release — no pre-pay
  holds). Config `auction_config`: `live_pay_window_hours` (24) / `live_default_autopilot` (hybrid) /
  `live_hybrid_accept_ratio` (1.10). Migration `2026-07-19-v374-model3-live-auction-foundation.sql` (additive).
- **UI:** owner `AgentAuctionTab` — sale-mode toggle (Live ↔ Sealed) + autopilot picker + a "Live bids to
  review" section (accept/decline/counter). Agent `/trade` browse — Live/Sealed card badge; `/trade/[id]` tour
  — a `LiveBidBox` (no-EMD, autopilot preview, direct submit → my-bids to pay); `/trade/my-bids` — accepted
  live bids surface as awards to Pay + enable-selling, `countered` bids get an Accept-counter button, live bids
  show "no deposit". Disclosure `CIRCLE_LIVE_AUCTION_NOTE` (no deposit, autopilot, acceptance not guaranteed).
- **Verified:** live money-path SQL round-trip (base ₹9,600 → pay ₹10,080 incl. 5% buyer premium → owner net
  ₹9,120 owed; 0 leftover). `tsc` + `next build` clean. Badge v373→**v374**, sw HTML_CACHE v185→v186.
  ⚠ Same honest money boundary as everywhere: owner payouts (`settlement_ledger` owed) are manual admin/ops —
  no auto money-out. Autopilot picks the FIRST acceptable bid (no max-bid price competition on live lots) — that
  is the deliberate launch trade-off (faster liquidity); the floor still protects, and the sealed auction stays
  available for price-competitive months.

## Earlier production state (v367, Circle "Model 3 v2" — winner sell channels + agent↔Model-2 bridge + guardrails)
- **Winner sell channels (Phase A):** a Model-3 auction winner sells their won allotment two ways from the
  voucher card (`/trade/my-bids`). **StayBid + OTA:** `POST /api/trade/awards/[id]/enable-selling` grants
  OPERATOR SCOPE over the won units for exactly the allotment nights — reuses the M1/M4 precedent
  (`assignFreeUnit` per contiguous run × room → date-bounded `inventory_blocks` `investor_user_id`=agent →
  `stampUnitOwner` guarded `or=(owner_user_id.is.null,in.(agentIds))` → `writeHold(invhold_<blockId>)`,
  idempotent deterministic ids) → UI reuses the agent's Google token as `sb_partner_token` + opens
  `/partner/dashboard` (My Rooms + per-unit OTA feeds). **Own channel:** copyable direct booking link
  (`/hotels/<id>?checkIn=&checkOut=`) + voucher. No-units property → honest "use your own channel" fallback.
- **Agent → Model-2 buy entry (Phase B):** approved agents see a "Model 2 — curated Circle inventory (fixed
  price)" card on `/trade` → click bridges their Google identity into the customer session (`sb_token`/
  `sb_user`/`sb_token_type`=firebase) → existing Model-2 flow. **Model 2 has NO room-ownership gate in code**
  (only per-city ₹ access) — so this is pure surfacing + bridge, trade-buyer framing, no new gate, no M2 change.
- **Concurrent channels, clash-free (Phase C, v367.1):** Model 2 = Circle-operated only; Model 3 = all StayBid
  properties. A property CAN run on BOTH channels at once (so Circle owners who can't join the M3 auction still
  get that inventory via M2). **No cross-channel block** — the shared physical layer (`assignFreeUnit` +
  `inventory_blocks` + `room_blocks` holds) makes a double-booked unit-night impossible (proven: a unit held by
  one channel drops out of the other's free-unit set). `hasActiveModel2Listing` is now INFO-only (owner tab
  shows "also on Model 2, both run together" — never blocks). Publish enforces a **physical-capacity cap**
  (`activeUnitCount` — a lot can't promise more rooms than units exist; 0-unit classic rooms self-regulate at
  booking). (2) **Owner-type min-bid floor (v372/v373):** floor depends on WHO lists.
  • **Property owner** (classic) → floor = room's NORMAL `floorPrice` (`computeMinBidFloorPerNight`; NOT the
    same-day flash floor — that's for last-minute liquidation + usually NULL).
  • **Circle owner** (`host_circle`) → floor = **their PURCHASE price/night × `circle_floor_multiplier`**
    (default **1.20** = cost + 20% profit), via `circleOwnerFloor()`. Purchase/night = their monthly acquisition
    rate ÷ 30 (e.g. ₹30k/mo → ₹1,000 → ₹1,200 floor). `circle_properties.monthly_rate` is NOT linked to the
    hotels Model-3 uses, so the Circle owner SUPPLIES their monthly rate in the "Sell to Agents" form; it's frozen
    on `auction_lots.purchase_price_per_night` (migration `2026-07-19-v373`). Admin tunes the multiplier in
    `/admin/auction` ("Circle floor ×"). Detection = `isCircleOperatedHotel` (`hotels.owner_type='host_circle'`).
- **⚠ Known follow-up:** `owner_user_id` is a permanent unit stamp; for recurring monthly auctions on the SAME
  unit, `assignFreeUnit` prefers unowned units (per-month rotation/expiry is a documented refinement). Per-unit
  GUEST listings only surface on `host_circle` hotels (`account_type!='hotel_owner'`); classic hotels get
  dashboard + OTA distribution, not the StayBid per-unit guest feed. Still no auto money-out anywhere.

## Earlier production state (v364, Circle "Model 3" — travel-agent MONTHLY INVENTORY AUCTION)
- **NEW vertical: a sealed-bid B2B monthly auction where property owners sell spare inventory to approved
  travel agents.** Distinct `sb_trade_*` namespace + `/trade/*` surface (the `/agent` + `sb_agent_*` panel is
  customer SUPPORT — do NOT collide). Google (Firebase) sign-in only (phone OTP is off). **Browse is OPEN to
  everyone; BIDDING needs an admin-approved `trade_agents` row.**
- **Tables (migration `2026-07-19-v361-model3-auction-foundation.sql`, additive/no-FK/permissive-RLS):**
  `trade_agents` (Google-auth agent account + admin approval), `auction_config` (admin singleton: buyer
  premium %, seller fee %, EMD deposit %, window-open day, pay-window hrs), `auction_lots` (owner-published
  monthly lot; `min_bid_per_room_night` = MAX Spine bidFloor across sampled nights — owner never sells below
  cost; `uniq_auction_lot_live` = one live lot per hotel/room/month), `auction_bids` (sealed bid;
  `per_room_per_night` = the frozen clearing comparator), `auction_awards` (clearing result + voucher +
  frozen settlement figures; `uniq_auction_award_bid`). Demo seed `2026-07-19-v361-demo-model3-auction.sql`
  (8 OPEN lots on real Dehradun/Dhanaulti/Manali hotels for Aug 2026 + 1 approved demo agent).
- **Journey:** owner publishes from partner dashboard **"🏷️ Sell to Agents"** tab (`/api/trade/owner/{quote,lots}`,
  min-bid Spine-floor clamped, window from config) → agent `/trade` browses live lots → bid modal picks a
  **segment (full month / a week / weekends)** + per-room-per-night bid (≥ floor) + rooms → client bundle →
  `/trade/review` pays ONE **refundable EMD deposit** (`/api/trade/bids/{checkout,verify}`, tamper-safe:
  server re-prices every line, segment nights recomputed from the lot, 4-key idempotent activate) → at window
  close the **clash-free clearing engine** (`lib/trade/clear.ts` — greedy ₹/room/night desc, per-slot night
  calendars, partial rooms allowed, deterministic) awards winners (`/api/cron/auction-lifecycle` opens
  scheduled + clears closed lots; admin force-clear `/api/admin/auction/clear`) → winner pays the balance
  (`/api/trade/awards/{pay,verify}` → 4-key idempotent → `voucher_issued` + code + owner `settlement_ledger`
  kind=`auction_award` owed) → `/trade/my-bids` shows won allotments + vouchers.
- **Segment engine** `lib/trade/auction-engine.ts` (full-month/week/weekend nights + per-night normalization +
  EMD math) backs the form, review AND server (preview == charge). **Admin** `/admin/auction` (agents
  approve/reject/suspend, config, lots + force-clear, awards, EMD-refund-owed mark-paid). Circle hub shows a
  **Model 3 card** → `/trade`. Disclosure `CIRCLE_AUCTION_NOTE` (wholesale goods trade, EMD refundable if you
  don't win, winning not guaranteed). Cron to register on cron-job.org: `/api/cron/auction-lifecycle` `*/15`.
- **⚠ Honest money boundary (same as everywhere):** loser EMD refunds (`auction_bids.metadata.emd_refund=owed`)
  and owner payouts (`settlement_ledger` owed) are **manual admin/ops** — there is NO auto money-out anywhere
  (Railway/settlement phase). Physical unit assignment/holds are NOT written at award (voucher = category
  allotment); agent resells to their own guests offline (wholesale handoff). Clearing is greedy (transparent +
  clash-free), NOT theoretically revenue-optimal.

## Legacy state (v360, Circle "Model 2" — sell-to-public LIVE on Circle-operated hotels)
- **Model-2 buyer now sells to the PUBLIC like an owner (deck steps 5–6), VERIFIED end-to-end.** Demo released
  inventory moved onto the 4 **host_circle** (Circle-operated) hotels (`hco-seed-man/mus/ris/shi`), which are now
  `approval_status='approved'` (guest-live) — migration `2026-07-19-v360-demo-b2b-host-circle.sql`. On host_circle
  hotels the guest hotel page renders individual UNIT listings (`account_type!='hotel_owner'` → `resolveRoomListings`),
  so after purchase the buyer's stamped unit is a guest listing and a guest booking it carries `bids.assignedUnitId`
  → `owner_user_id` (buyer) → shows in the buyer's owner dashboard. Own/night = room Spine floor ÷ 2, ask = floor
  (below market ADR/MRP → resale upside), released window Aug 1–Dec 1.
- **NEW `/api/circle/inventory/sell` (customer sb_token) + a real "List for public booking" control** on
  `/circle/model2/selling`: `list` DELETEs the protective `invhold_<blockId>` (source=inventory) → opens the nights
  to guests + sets the unit `is_listed` + optional guest `price_override`; `pause` re-writes the hold. Owner-guarded
  (block `investor_user_id` ∈ cross-pool ids), additive — touches only the buyer's own block/unit, NO core
  booking-engine change. Live SQL round-trip verified: HELD (invhold overlap=1, guest blocked) → release → LIVE
  (overlap=0 free · owner=buyer · listed+active · approved non-hotel_owner hotel) → 0 leftover.
- **⚠ Still Railway (the money):** the browse→pick→book→attributed-bid loop is fully wired, but there is STILL no
  automatic guest-payment→owner payout in this repo (capture-split + payout keyed on `assignedUnitId→owner_user_id`
  is a settlement/Railway phase). The sell page + endpoint control guest AVAILABILITY only, never money.

## Earlier state (v359, Circle "Model 2" — Your Selling Inventory surface + honest sell-side map)
- **NEW `/circle/model2/selling` "Your Selling Inventory" (deck step 5–6):** after a B2B purchase the buyer
  holds the SELLING RIGHTS to those room-nights. This premium page reads `/api/circle/portfolio` and shows the
  owned room-nights + KPIs + per-block **sell-through channels** (🏠 Sell on StayBid → `/partner/dashboard`,
  🌐 Your OTA → `/partner/dashboard?tab=channels`, 🔗 Direct booking link copy) + a "Manage & sell in your owner
  dashboard" CTA. Linked from the review success screen + a dashboard tile. CircleDock excludes `/selling` from
  the "Tour" step. Additive, read-only-ish (no core-engine mutation, no money path).
- **⚠ Honest sell-side architecture (VERIFIED, important):** a Model-2 buyer selling to the PUBLIC like a hotel
  owner is only PARTIALLY frontend-buildable. What WORKS today: purchase stamps `hotel_room_units.owner_user_id`
  = buyer → they become an OPERATOR on that hotel (`resolveOperatedHotelIds`/`partnerUnitScope`) → a "My Rooms"
  tab in `/partner/dashboard` lets them set price/photos/availability/OTA feeds for THEIR units; a guest booking
  a specific unit stamps `bids.assignedUnitId` → `owner_user_id` → shows in their dashboard (attribution key
  exists end-to-end). GAPS: (1) the guest hotel page only renders individual-unit listings for
  `account_type!='hotel_owner'` (Circle-operated/host_circle) hotels — on the CLASSIC demo hotels a guest can't
  pick a specific owned unit yet (the clean home for Model-2 inventory is host_circle properties); (2) there is
  NO automatic guest-payment→owner payout ANYWHERE in this repo — not even Model 1 (it uses a manual admin
  `circle_payouts` ledger). The real money leg (capture-split + payout keyed on `assignedUnitId→owner_user_id`)
  is a **Railway/settlement** phase. Do NOT claim auto-earn on guest bookings.

## Earlier state (v358, Circle "Model 2" — multi-select calendar + detailed review + premium look)
- **MULTI-SELECT availability calendar (deck ss3):** the room tour calendar (`app/circle/model2/[id]`) is now a
  **tap-any-nights** grid — the buyer selects individual nights (non-contiguous, ACROSS months), exactly like the
  deck's "owner-released dates". No check-in→checkout range. A bundle line = one room + its `dates:string[]`.
- **Basket model change:** `lib/circle/model2-basket.ts` `M2Item.dates:string[]` (was from/to); key = listingId
  (one line per room). NEW `groupRuns(dates)` (contiguous runs) + `priceNights(buyPerNight,feePct,dates)` — prices
  a picked set EXACTLY as the server (per-run `b2bTradeSplit` rounding). `market-quote` now returns `buyerFeePct`.
- **Detailed review dates:** `/circle/model2/review` line item lists the exact nights grouped by month
  (`fmtDates` → "Aug 2026: 4, 7, 12 · Sep 2026: 3, 5"). Checkout `flatMap(groupRuns)` → one `{listingId,from,to}`
  pick per contiguous run; server prices each run (preview == charge, verified both contiguous + non-contiguous).
- **Premium dark-gold look (deck):** the calendar, market panel, metric grid, hero, and the review COST & VALUE
  panel are dark-walnut + gold (`#1f1710`→`#33251a`, `#ffd98a`/`#ffcf6e` accents) matching the deck's panels.
- **⚠ Post-purchase resale is MANUAL, not auto (verified):** buying room-nights transfers ownership
  (`inventory_blocks.status=owned`, `owner_user_id` stamped) + writes a protective `invhold` (source=inventory,
  which BLOCKS those nights from guests) + grants partner/OTA management scope + portfolio visibility. It does
  NOT auto-list anywhere and `owner_user_id` is never read by any booking/revenue path. Re-listing on the B2B
  exchange, selling on the StayBid guest feed, and OTA distribution are all MANUAL buyer actions from
  `/partner/dashboard` (the `/circle/me` "My Selling Inventory" channels are links, not auto-actions). An
  auto-list-on-purchase flow is NOT built yet (a future money-path phase).

## Earlier state (v357, Circle "Model 2" — Model-1 parity: real routes, clean calendar, no rule shown)
- **Model 2 is now REAL PAGES (routes), mirroring Model 1** (not overlays): `/circle/model2/browse` (Step 1,
  property-grouped browse) → `/circle/model2/[id]` (Step 2, full property tour page — hero gallery + thumbs +
  badges + metric grid + "Choose your rooms") → `/circle/model2/review` (Step 4, full review + pay page like
  `/circle/build`: YOUR BUNDLE grouped by city + a COST & VALUE panel [you pay · market value · resale upside]).
  The bundle lives in **localStorage** via `lib/circle/model2-basket.ts` (`readBasket`/`addItem`/`removeItem`/
  `onBasketChange`, `sb_m2_basket_v1` + `sbc:m2-basket-change` event) — the Model-1 state-contract pattern.
- **Step dock is Model-2 aware:** `components/circle/CircleDock.tsx` renders **Browse → Tour → Pay** (basket
  count badge) on `/circle/model2/*` routes instead of Model-1's Property/Rooms/Plan.
- **No internal pricing rule shown to the buyer (ss7):** every "2× / owner's own price / resale multiplier /
  double / sell price" is REMOVED from the buyer surface. The room "market panel" shows only Your buy price vs
  the room's real guest ADR / low / high + resale upside. The own×multiplier math stays 100% server-side.
- **Clean calendar (ss8):** the room tour has a proper check-in → check-out RANGE picker (Check-in/Check-out
  labels + Clear, one continuous gold band). Every released-window night is available — `market-quote` returns
  `blocked:[]` for a `metadata.window` listing (a released window ⇒ no blocked dates); physical availability is
  still hard-guarded only at payment (`assignFreeUnit`). Non-window listings still consult real occupancy.
- Removed the two browse header links; City Access lives in the dashboard (v356). Money path unchanged
  (calendar-driven `basket/checkout items:[{listingId,from,to}]`, own×mult×nights + fees, 4-key verify).

## Earlier state (v356, Circle "Model 2" — full Model-1-style journey: calendar tour + trading + review)
- **Model 2 browse REBUILT into the Model-1 journey** (`app/circle/model2/browse/page.tsx`): Step 1 browse
  released inventory **grouped by PROPERTY** (property cards) → Step 2 full **property + room TOUR** (in-page
  overlay: property gallery + per-room card) → Step 3 **build** (pick nights across cities into a bundle) →
  Step 4 **review** overlay (per-city line items + city fees + totals) → ONE payment. Removed the two
  secondary header links (pre-buy operated + City Access); City Access now lives in the investor dashboard
  (`/circle/dashboard` tiles → `/circle/me?tab=city`).
- **Calendar-driven date picking (deck ss2):** each demo listing is now a **released WINDOW** (Aug 1–Dec 1,
  `metadata.window=true`, migration `2026-07-18-v356-demo-b2b-windows.sql`), not a fixed range. In the room
  tour a **live availability MiniCalendar** shows the window minus blocked dates (from `/api/availability`
  via the new quote route) and the buyer **picks their own nights**; price = own/night × multiplier × nights.
- **Trading panel (guest/retail market):** NEW `app/api/b2b/market-quote/route.ts` (customer Bearer) →
  `{ window, blocked[], ownPerNight, multiplier, buyPerNight, market:{adr,low,high}, selection? }`. Market =
  `room_date_price.live_price` min/avg/max over the range (Spine `resolveSpinePrices` per-night fallback,
  bounded 45). The tour shows "your buy price vs market ADR/low/high + resale upside" like a stock. e.g.
  Cave View own ₹1,000 → buy ₹2,000 vs market ADR ₹2,852 (₹2,800–4,900).
- **Buyer-picked-dates checkout:** `app/api/b2b/basket/checkout` now accepts `items:[{listingId,from,to}]`
  (back-compat `listingIds`), validates each pick ⊆ the released window, prices the CHOSEN nights
  (own×mult×nights + frozen fees), `assignFreeUnit` + mints a pending buyer block over exactly those nights,
  writes the trade with the chosen dates. `basket/verify` settles per trade; a **hotel_owner window stays
  `listed`** after a sale (other buyers can still buy other nights) — only a fixed `investor_block` flips
  `sold`. Money path otherwise unchanged (b2bTradeSplit, 4-key idempotent verify, tamper-safe).

## Earlier state (v355, Circle "Model 2" — resale = own-price × multiplier + premium browse/tour)
- **Resale price = the owner's OWN price/night × a multiplier (v355), NOT a Spine markup.** The rule:
  an investor who owns a room at (e.g.) ₹30k/month owns it at ₹1,000/day → StayBid lists it for B2B
  sale at **2× that own price** (₹2,000/day). `sell/night = round(ownPerNight × multiplier)`, where
  ownPerNight = the owner's real per-night acquisition cost (Circle inventory = `monthly_rate ÷ 30`;
  hotel-owner supply = Spine wholesale cost). NEW `resaleAskPerNight(ownPerNight, multiplier)` in
  `lib/b2b/engine.ts` (`B2B_RESALE_MULTIPLIER_DEFAULT=2`); legacy `regulatedB2bAskPerNight` now delegates
  to it (markup 100% == 2×). The multiplier is **admin-global + per-listing overridable + future-dynamic**:
  `b2b_fee_config.resale_multiplier` (default 2, resolved via `resolveB2bFeeConfig().resaleMultiplier`)
  ?? per-listing `b2b_listings.price_multiplier` (a body `priceMultiplier` on the listing-create paths).
  Both listing branches + `/api/b2b/regulated-quote` freeze `own_per_night` + `price_multiplier` on the
  row (tamper-safe; preview == charge == settlement — the split still reads the frozen `ask`). Admin edits
  the GLOBAL multiplier in the `/admin/circle-inventory` fee card ("Resale ×", 1–20; POST `resaleMultiplier`,
  which also keeps `regulated_markup_pct` in sync), AND a PER-LISTING multiplier inline in the B2B
  listings table ("Resale ×" column → `set_listing_multiplier` action re-prices ONE draft|listed listing
  from its frozen `own_per_night` × the new ×; own/buy/fees untouched). Migration `2026-07-18-v355-b2b-resale-multiplier.sql`
  (config `resale_multiplier` + listing `own_per_night`/`price_multiplier`) applied live. Round-trip
  verified (9 demo rows: ask=own×2, ask_total=ask×nights, all double).
- **Premium browse + room/property TOUR (v355):** `/circle/model2/browse` rebuilt — **All Cities** default
  chip + per-city filter (counts), luxe image cards, a "how it works" step strip + KPI chips, and a full
  **room/property tour** modal (image gallery from `metadata.room_images`+`prop_images`, amenities chips,
  capacity/stars, description, dates, and a price breakdown: own/night → ×2 → sell/night → you pay). An
  investor goes through the room like a guest before buying. Basket/checkout money path unchanged.
- **Demo reseed (v355):** the 6 old Spine-priced demo listings replaced by 9 own-price×2 listings across
  Dehradun/Dhanaulti/Manali/Mussoorie/Rishikesh on real StayBid hotels (purchasable via the hotel_owner
  checkout), each frozen `own_per_night`/`price_multiplier=2` + rich tour metadata (real room images,
  amenities, capacity, description). `metadata.demo=true`, `seller_user_id='demo_seller_circle'`.
  `migrations/2026-07-18-v355-demo-b2b-resale-ownprice.sql`. e.g. Dhanaulti ₹1,000 own → ₹2,000 sell.

## Legacy state (v352, Circle "Model 2" — city fee at checkout, not pre-activation)
- **City access is now PAY-AT-CHECKOUT (v352), not a pre-gate:** the FULL inventory is browsable from
  the start (no "unlock a city first" block). `/circle/model2/browse` shows all supply cities + all
  listings; the per-city ₹access fee is ADDED to the basket/single-buy total ONLY for the cities the
  basket touches that the buyer hasn't unlocked yet, and those cities activate on VERIFY with the same
  payment (lifetime). `basket/checkout` computes `newCities` (`resolveActiveCities` diff), adds
  `newCities.length × cityAccessPrice` to the order + mints pending `circle_city_access` rows on the
  order; `basket/verify` flips them active. The single `b2b/listings/[id]/checkout` no longer 403s
  `needCityAccess` — it folds `cityFee` into `buyerPays` + mints a pending access row; its verify
  activates it. `/circle/me` City Access card stays as OPTIONAL pre-unlock. Round-trip verified
  (order = inventory + ₹999 city, city active on same payment; 0 leftover).
- **Browse contrast fix (v352):** `.sbc-ms-title`/`.sbc-ms-sub`/`.sbc-ms-note` are cream (old dark
  theme) but `.sbc-home` is now the light cozy canvas → the browse title/subtitle were invisible.
  Fixed with explicit dark colors (`var(--sbc-coffee)` / `rgba(74,56,32,…)`) inline on that page.
  (Same latent bug exists on `/circle/model3` + `/circle/model4` via CircleStepShell — not touched here.)

## Earlier — Circle "Model 2" COMPLETE (6 phases: v346–v351)
- **My Selling Inventory + sell-through channels (v351):** `/circle/me` "Inventory Blocks" section is
  now **"My Selling Inventory"** — the buyer's owned room-nights with the ss3 sell-through channels per
  owned/listed block: 🔗 **Direct** booking link (client-side copy of `/hotels/<id>?checkIn=&checkOut=`),
  🏠 **StayBid** feed + ⇄ **B2B exchange** (→ `/partner/dashboard`), 🌐 **your OTA** (→
  `/partner/dashboard?tab=channels` Channel Manager). UI-only — no migration, no new money path (the
  actual list/sell actions live on the existing partner surfaces). Completes the deck's "Your inventory.
  Your strategy. Your growth."
- **Model 2 redesign COMPLETE (6 phases):** P1 rename/merge (v346) · P2 dual 5%+5% fee (v347) · P3
  ₹999/city access (v348) · P4 regulated Spine pricing (v349) · P5 basket/multi-city bundle (v350) ·
  P6 My Selling Inventory (v351). All merged to main.

## Earlier state (v350, Circle "Model 2" — + multi-select basket / multi-city bundle)
- **Basket / multi-city bundle (v350) — LIVE MONEY:** the buy side of ss3 — browse owner-released
  listings per city, multi-select into a basket (across cities), and buy them ALL in ONE payment.
  `/circle/model2/browse` (customer `sb_token`): city chips (unlocked ∪ supply cities; locked cities
  show 🔒 + an unlock prompt → `/circle/me`), released listings via `/api/b2b/marketplace?city=`,
  a sticky basket bar. NEW `app/api/b2b/basket/checkout` — loads every listing, gates each distinct
  city on access, freezes each split from the listing's regulated ask + frozen fees, reserves
  inventory (hotel_owner → `assignFreeUnit` + a fresh pending block minted INTERLEAVED so two basket
  items never grab the same unit; investor_block → integrity check), creates ONE Razorpay order for
  the SUM of `buyerPays`, writes N pending `b2b_trades` all tagged with that order id. NEW
  `app/api/b2b/basket/verify` — HMAC-verifies the single payment, then settles EVERY pending trade on
  that order (mark completed + per-source block flip/transfer + stampUnitOwner/hold + listing→sold +
  settlement, all guarded/idempotent). The hub Model-2 card now routes to `/circle/model2/browse`
  (the pre-buy operated flow is a secondary link). No migration (reuses `b2b_*` + `inventory_blocks`).
  Round-trip verified (2 listings, one ₹15,120 order → both settle; 0 leftover).

## Earlier state (v349, Circle "Model 2" — rename + dual fee + city access + regulated price)
- **Regulated B2B pricing (v349):** the Model-2 B2B ask is NO LONGER a free seller input — it is
  StayBid-REGULATED: `regulatedB2bAskPerNight(spineWholesalePerNight, markupPct)` = `round(wholesale ×
  (1 + markup%))`, `lib/b2b/engine.ts`. Markup is admin-controlled (`b2b_fee_config.regulated_markup_pct`,
  default 20, via `resolveB2bFeeConfig().regulatedMarkupPct` + `/api/admin/b2b-fee` + the
  `/admin/circle-inventory` fee card "Reg. markup %"). Both listing-create paths compute the ask from
  Spine cost (hotel_owner → `quote.avgBuyPerNight`; investor_block → `block.buy_total/nights`) and
  IGNORE any client `askPerNight`. Preview endpoint `/api/b2b/regulated-quote?roomId&from&to` (partner
  Bearer) returns the regulated ask + split so the seller sees the price BEFORE listing; the
  CircleInventoryTab supply form + per-block "List on exchange" dropped their ask inputs (show the
  regulated price / "List at regulated price"). Migration `2026-07-18-v349-b2b-regulated-markup.sql`
  applied live. `isValidAskPerNight` retired from the listing paths. Verified (ask 3000→3600 @20%).

## Legacy state (v348, Circle "Model 2" — rename + dual fee + city access)
- **City access paywall (v348) — LIVE MONEY:** an investor unlocks a city ONCE (₹999, lifetime,
  admin-priced) to buy/resell Model-2 inventory there. Price = `b2b_fee_config.city_access_price`
  (default 999) resolved via `resolveB2bFeeConfig().cityAccessPrice`; admin edits it in the same
  `/admin/circle-inventory` fee card (+ `/api/admin/b2b-fee` accepts `cityAccessPrice`). Grants live in
  `circle_city_access` (deterministic id `cca_<primaryId>_<citySlug>`, `uniq_city_access_active` on
  `(user_id,city) WHERE status=active`). Flow: `/api/circle/city-access` GET (active cities + price) +
  POST (checkout, tamper-safe amount) → `/api/circle/city-access/verify` (4-key idempotent
  pending→active). Helpers `lib/circle/city-access.ts` (`normalizeCity`/`cityAccessId`/
  `resolveActiveCities`/`hasCityAccess`, all cross-pool). GATE: `app/api/b2b/listings/[id]/checkout`
  403s `needCityAccess` if the buyer hasn't unlocked the listing hotel's city (fails OPEN on lookup
  error). UI: `/circle/me` "City Access" card (list unlocked + unlock a new city via Razorpay).
  Migration `2026-07-18-v348-city-access.sql` applied live. Round-trip verified (0 leftover).


- **Model 2 rebrand (v346):** the old Model 3 (pre-buy) + Model 4 (B2B exchange) are now ONE
  **"Model 2 — Multi-City Inventory Bundle"**. Hub shows 2 model cards (Model 1 + Model 2); canonical
  `/circle/model2` route (re-exports the pre-buy flow); `/circle/model3` + `/circle/model4` stay live,
  rebranded, cross-linking. Service key `circle_model2` (verify grants write it; `circle_model3/4`
  kept as legacy labels). All user-visible "Model 3/4" → "Model 2"; internal phase-history comments
  (C1/D2/M4/vNNN) left as the audit trail.
- **Dual B2B commission (v347) — LIVE MONEY:** `b2bTradeSplit` is now DUAL-SIDED. Buyer is charged
  `buyerPays = askTotal + buyerFee`; seller receives `sellerNet = askTotal − sellerFee`; StayBid keeps
  `platformFee = buyerFee + sellerFee`. Both % are ADMIN-CONTROLLED via `b2b_fee_config` singleton
  (`lib/b2b/fee-config-store.ts` `resolveB2bFeeConfig`, 60s cache; default 5%/5%), edited at
  `/api/admin/b2b-fee` + the `/admin/circle-inventory` fee card. The two % are FROZEN onto each
  `b2b_listings` row at list time (`buyer_fee_pct`/`seller_fee_pct`) — a later admin change only
  re-prices NEW listings (tamper-safe). Checkout charges `split.buyerPays` (NOT askTotal) and stamps
  `buyer_fee/seller_fee/buyer_pays` on `b2b_trades`; verify settlement `gross_amount = buyer_pays`.
  Migration `2026-07-18-v347-b2b-dual-fee.sql` (config table + `b2b_listings`/`b2b_trades` fee columns)
  applied live. Round-trip verified (0 leftover). Legacy `B2B_FEE_PCT_DEFAULT=8` retired in favour of
  `B2B_BUYER_FEE_PCT_DEFAULT`/`B2B_SELLER_FEE_PCT_DEFAULT=5`.

### Earlier — Circle Marketplace redesign M0–M6 (COMPLETE)
- **Live version chain:** Circle Marketplace Redesign M0 (v339) → M1 (v340) → M2 (v341) →
  M3 (v342) → M4 (v343) → M5 (v344) → **M6 (v345) ✅ (redesign complete)**. Branch this session:
  `claude/circle-m4-hotel-owner-b2b-vaei3q`.
- **Phase M6 (unified investor "My Circle" dashboard + disclosure sweep) — SHIPPED:** `/circle/me`
  (was Model-1 bundles/payouts/locks only) now ALSO aggregates cross-model holdings via a NEW
  additive read-only aggregator `app/api/circle/portfolio/route.ts` (customer `sb_token` → `decodeJwt`
  → `resolveOwnerIdsCrossPool` — cross-pool so twin-id holdings are never missed; the pre-existing
  `/api/circle/me` raw-`user.id` route is UNTOUCHED). The route fans out to `inventory_blocks`
  (`investor_user_id`), `b2b_listings` (`seller_user_id`), `b2b_trades` (buyer+seller),
  `hotel_room_units` (`owner_user_id` → operated hotels), side-loads hotel names + unit numbers, and
  derives ACTUAL-only resale KPIs (`ownedBlocks/activeListings/inventoryValue/b2bNetEarned` etc.). New
  `/circle/me` sections (gated on `hasMarketplace`): Pre-buy & Exchange KPI strip, Inventory Blocks
  (Model 3/4), B2B Exchange (my listings + sold/bought trades), Dashboard Access (operated hotels →
  `/partner/dashboard`). **Disclosure sweep:** new `CIRCLE_B2B_RESALE_NOTE` in `lib/circle/disclosure.ts`
  (Model-4 goods-trade risk), new sections import the constants (`CIRCLE_RESALE_RISK_NOTE` +
  `CIRCLE_B2B_RESALE_NOTE`), and the hero KPI relabelled "Returns Paid Out" → "Payouts Received" (never
  "returns"). Read-only, no migration, no money mutation. Round-trip verified (0 leftover).
- **Phase M5 (per-model service enrollment markers) — SHIPPED:** `circle_model1/3/4` are now
  formalized in the service catalog (`lib/partner/services.ts`: `CIRCLE_SERVICES` + `isCircleService`
  + `SERVICE_LABEL` entries) as FREE enrollment markers — deliberately NOT in `SUBSCRIPTION_SERVICES`
  (never tab-gate the dashboard nor hit the paid `service-checkout`/`isSubscriptionService` gates) and
  NOT in `DEFAULT_SERVICES`. All 3 model journeys grant their marker free on verify: M3
  `grantModel3Service` + M4 `grantModel4Service` (pre-existing) and NEW M1 `grantModel1Service`
  (`app/api/circle/verify/route.ts`, fires per provisioned hotel from `provisionBundle().hotels` on
  full activation, idempotent upsert on `hotel_id,service_key`). Real Circle access stays
  ownership-based (`owner_user_id`/`investor_user_id`) — the markers are never read by any gate. NOTE:
  the paid-subscription billing tables (`service_pricing`/`service_bundles`/`service_payments`, code +
  `2026-05-21` migrations) were never applied live, so Circle stays free-marker only (M5 scope choice).
  No migration, no new charge. Round-trip verified (0 leftover).
- **Phase M4 (Model-4 B2B SUPPLY side, `source='hotel_owner'`) — SHIPPED:** ANY hotel owner lists
  room-nights on the B2B exchange from their OWN inventory (no pre-bought `inventory_blocks`),
  reusing `b2bTradeSplit` (`B2B_FEE_PCT_DEFAULT=8`) + the D2 checkout/verify chain. Listing
  `buy_total` = owner's Spine floor via `quoteInventoryBlock` (`app/api/b2b/listings` POST,
  `source:'hotel_owner'` branch → `block_id`/`unit_id` NULL). On BUY (`.../[id]/checkout`
  hotel_owner branch): SKIP the owned-block integrity check → `assignFreeUnit` (409 if none) →
  freeze buyer's Spine buy basis via `quoteInventoryBlock` → mint a NEW buyer `inventory_blocks`
  pending block (mirrors M1 marketplace checkout, unit_id NON-null) + overlap re-guard → `b2b_trades`
  row carries `source='hotel_owner'` + the new `block_id`. On VERIFY (`.../[id]/verify` branch on
  `trade.source`): flip the buyer's block pending→owned (4-key idempotent) + `stampUnitOwner`
  (or-guard `owner_user_id.is.null,in.(buyerIds)`) + `writeHold(invhold_<blockId>, source=inventory)`;
  settlement `payee=seller`; `grantModel4Service` already fires. The D2 investor_block
  transfer branch is untouched. Buy-side browse (`/api/b2b/marketplace`) already surfaces
  hotel_owner listings (no source filter — just `status=listed`), so buying works via the same
  `buyExchange`→checkout→verify path. UI: partner "Pre-buy Inventory" tab
  (`components/partner/CircleInventoryTab.tsx`) gained a "List your own inventory" supply form.
  Migration `migrations/2026-07-14-v343-phase-m4-hotel-owner-b2b.sql` (`b2b_listings`+`b2b_trades`
  `source TEXT NOT NULL DEFAULT 'investor_block'` + `block_id`/`unit_id` DROP NOT NULL + `idx_*_source`;
  NO CHECK — NULL block_ids are distinct so hotel_owner listings never collide the
  `uniq_b2b_listing_active_block` partial index) applied live. Round-trip verified (0 leftover).
- **Reel-app surfaces** (`/`, `/discover`, `/reels`, `/me`, `/me/posts`, `/saved/posts`): hide
  Navbar/DialerNav/ServerStatus, show BottomDock. Everything else: BackChip + Navbar + BottomDock.
- **Service worker** `public/sw.js`: stable URL `/sw.js`, stable static cache (`staybid-static-v2`),
  SWR HTML, cache-first hashed chunks, network-only `/api/`. `HTML_CACHE` at **`v372`** (v571 depth pass).
- **Version badge:** `SB_BUILD` + visible `vN` chip in `app/layout.tsx`, at **v571**. Bump both on
  every UI ship.
- **NOT to be touched casually:** the Stage home order + its `.sbh-*` layer contract (below), scoring engine (`lib/hotel-score.ts` weights/tiers), commission
  engine, attribution chain, tier system, passport engine, reel-dedup 5-hop chain, Model-1/3/4
  money engines, channel sync engine, availability engine.

---

## Ship checklist (every user-visible release)
1. Bump `SB_BUILD` + the visible `vN` badge in `app/layout.tsx` (only user-visible deploy signal).
2. Bump `public/sw.js HTML_CACHE` **only if UI/HTML changed** (server-only / pure-logic ships skip it;
   NEVER bump the static cache name unless the sw.js fetch-handler logic itself changed — v93 discipline).
3. `npx tsc --noEmit` **and** `npm run build` (Vercel's build catches things `tsc` alone misses:
   SWC styled-jsx panics, `useSearchParams` static-prerender bailouts, `for..of Set` downlevel — see below).
4. Apply migrations via Supabase MCP; keep the `.sql` file in `/migrations` as the audit trail.
5. Live SQL round-trip verify (seed → assert → clean up, 0 leftover) for any DB/money path.
6. Commit + push (`git push -u origin <branch>`, retry 2/4/8/16s on network fail). Open/refresh a
   **draft** PR via `mcp__github__` tools (NOT `gh`). Commit trailers: `Co-Authored-By: Claude Opus
   4.8 <noreply@anthropic.com>` + `Claude-Session: <url>`. PR body ends with the Generated-with footer.
   **NEVER put the model identifier in any commit/PR/code/artifact — chat only.**

---

# Things to Avoid (consolidated — every load-bearing invariant)

## Build / toolchain
- **`for..of` on a `Set`/`Map.keys()`/`Map.values()`** breaks Vercel's build historically — even
  though `tsconfig target` is now `es2017` (native Set iteration). Prefer `Array.from(x).forEach()`
  for safety; NEVER drop `target` below `es2017` (re-introduces the downlevelIteration trap).
- **Never add a 3rd `<style jsx>` block to `components/discover/InstagramHotelFeed.tsx`** — SWC
  styled-jsx panics at `visitor.rs:597` with ≥3 blocks (or with IIFE-returning-JSX). It's at its
  2-block ceiling. New global styles → `app/globals.css` / `app/desktop.css`. Same rule for any
  file: hoist compute-then-render out of JSX (`const x = (()=>{})(); {x && (<jsx/>)}`), and use
  `<style jsx global>` for keyframes referenced by inline `style={{animation}}`.
- **Never ship a client component using `useSearchParams()` without a `<Suspense>` wrapper** —
  Next static-prerender bails; `tsc` doesn't catch it, only `next build` does.
- **Next 16 dynamic routes:** `params` is a `Promise` — `const { id } = await params;` and the
  signature must be `{ params: Promise<{id:string}> }`.
- **Tailwind 4:** never re-add `tailwind.config.js` (theme lives in `@theme{}` in globals.css);
  keep `@import 'tailwindcss'` (not the v3 `@tailwind` triple); `@tailwindcss/postcss` must match
  `postcss.config.js`. Verify `@types/react-dom` present before importing from `react-dom`.
- **Never run `npm audit fix --force`** — it downgrades Next to 9.3.x. Remaining transitive
  advisories clear only via major bumps.
- **Never bump `public/sw.js` cache names on a routine UI release** — cache-nuke/SW-unregister/
  force-reload kill-switches are permanently banned (v93). Keep the stable `/sw.js` URL and SWR HTML.

## Stage home / `.sbh-*` (v555–v571)
- **`app/desktop.css` is imported into `layer(utilities)`; `app/globals.css` is UNLAYERED.** Unlayered rules
  therefore BEAT layered ones regardless of source order. Modules that must look identical on both viewports
  (`.sbh-bid-*`, `.sbh-th-*`, `.sbh-circ-*`, `.sbh-pp-*`) are written ONCE, unlayered, at the end of globals.css
  with an inner `@media (min-width:1024px)` — never split across the two files, or the desktop half silently
  loses. `app/desktop.css` stays entirely `@media (min-width:1024px)`; the mobile Stage block in globals.css is
  `@media (max-width:1023px)`.
- **Scope any selector that can reach inside `<CountUp>`.** It renders a `<span>`, so a bare
  `.card span { font-size: .66rem }` swallowed every number into the LABEL style (24px → 10.56px, shipped
  invisibly). Use `>` (`.sbh-bid-stat > span`). `next build` does not catch this — only measuring in a browser does.
- **Tap targets: 24×24 minimum (WCAG 2.5.8), and it applies to POINTER input too** — the exception is only for
  links inline in a sentence, which a standalone "See all" is not. Grow the HIT AREA, never the visual: a
  transparent `::after { inset: -Npx }` for dots (and size the row `gap` so neighbouring hit boxes touch but
  never overlap, else a tap lands on the wrong slide), or `padding` + a cancelling negative `margin` for text
  links so nothing moves.
- **Never invent a data source the page already has.** The reel price problem was solved by
  `/api/hotels/starting-prices` (which exists for exactly that case), the hero season by `demand-cycle.ts`, the
  bid numbers by `/api/bids/insights` — all pre-existing. Grep before adding an endpoint.
- **Verify by MEASURING in a headless browser, not by screenshotting.** This sandbox's proxy blocks the image/
  video CDNs, so media never renders in a local screenshot even when the page is perfect (`curl` proves 200).
  Assert computed geometry instead. Two gotchas: `.sb-welcome-overlay` covers the viewport (set
  `sessionStorage.sb_welcome_shown="1"` in an init script — do NOT remove the node, React then throws
  `removeChild`), and `waitUntil:"networkidle"` never settles (use `domcontentloaded` + an explicit wait).
- Auto-scrolling rails were considered and REJECTED: Netflix/Prime/Hotstar don't do it, it fails WCAG 2.2.2,
  and it steals control on the one surface where the user is browsing. (The TICKER is the one exception — it
  auto-scrolls on both viewports by owner decision, and is only tappable because it pauses on `:active`.)
- **A headless browser can NEVER tell you anything about scrollbars.** A control run proved headless Chromium
  renders no classic scrollbar even on a bare tall page with no CSS — 0px with AND without
  `--disable-features=OverlayScrollbar`. Two rounds were wasted "verifying" a scrollbar fix against a
  measurement that could only ever return 0. If the question is scrollbars, reason about the browser or ask the
  owner; do not measure it here.
- **`::-webkit-scrollbar` cannot guarantee a visible scrollbar.** Chrome turns it into a classic bar; **Safari
  ignores it for the DOCUMENT scrollbar** and obeys the macOS "Show scroll bars" setting. That is why the fix is
  `<ScrollRail/>` in `components/home/DesktopHome.tsx`, gated on the zero-layout-width test above — not CSS.
- **Depth goes on the media tile, never on the card shell.** `.sbh-card` is transparent/borderless/shadowless on
  BOTH viewports; `.sbh-card-media` carries the ring + contact shadow + cast. Boxing the text is what produces
  the "stretched" complaint, because the panel must then be tall enough for image + 2 lines + padding.
- **One deal, one colour.** The flash "% OFF" gold is `.fd-disc-stamp` on `/flash-deals`
  (`linear-gradient(140deg,#ffe9ad,#f2c650 44%,#d69a1e)`). `.sbh-chip-off` and `.sbh-tk-accent` must match it —
  assert the computed gradient in the browser rather than eyeballing.

## Supabase / API
- **No FK constraints exist** → never use PostgREST embed joins (`users:user_id(...)`). Manual
  `?id=in.(…)` side-loads + `attachUsers` everywhere.
- **Verify column names against `information_schema.columns` before narrowing `select=*`.** Real
  gotchas: `social_posts` uses `media_url`/`sound_url`/`like_count`(singular)/`thumbnail_url`/`filter`;
  `hotel_videos` uses `s3_url`; `social_profiles` uses `is_verified`/`follower_count`(singular);
  `rooms` has NO `aiPrice` (only `flash_deals` does); `hotels`/`rooms` `amenities`/`images`/`meal_plans`
  are `text[]` (PostgREST coerces JSON arrays; raw SQL needs `'{a,b}'::text[]`, never `::jsonb`).
- **CDN caching:** Vercel silently strips `s-maxage` from `Cache-Control` on dynamic routes (any
  that read `searchParams`/`cookies`/`headers`). Set `CDN-Cache-Control` + `Vercel-CDN-Cache-Control`
  too; verify with `x-vercel-cache: HIT`. `/api/discover/feed` + `/api/flash/near` stay `no-store`
  (per-request shuffle).
- **`lib/sb-cache.ts` (`sbCached`)** is server-only (globalThis module state); TTLs by volatility
  (catalog 60s / popular 20s / inventory 15s / posts 15s). Under load, N concurrent opens = 1
  Supabase fetch. Never import it from a client component; never mutate the Map directly.
- **`ota_feeds` INSERT needs an explicit `id`** (`genId("feed")`) — no DB default, `sbInsert`
  doesn't generate one.
- **Never issue destructive SQL casually.** No `DROP`/`TRUNCATE`/`--force-reset`; forward-only
  migrations; keep the `.sql` file even after live apply. Destructive prod row mutations only on
  explicit approval, guarded, after a query proves the state.

## Payments (tamper-safe — universal)
- **Client NEVER sets the ₹ amount.** Every checkout route re-computes/clamps the amount
  server-side from the source of truth (`computeBundle`, `service_pricing`, `quoteInventoryBlock`,
  `b2bTradeSplit`, `resaleMargin`, Spine). Preview == charge == settlement because the SAME pure
  engine backs the UI and the server.
- **Verify uses the 4-key idempotent PATCH:** `razorpay_order_id + <row id> + status=eq.pending_payment
  + ownership in.(ids)`. A 0-row flip = already-processed or not-yours → re-fetch, return
  `alreadyProcessed`, NEVER re-charge. HMAC via the shared `/api/razorpay/verify`.
- **Never let a best-effort side-effect (hold write, service grant, notification, hold release)
  throw/block a payment that already verified.** Holds use deterministic ids (`invhold_<blockId>`)
  + upsert `on_conflict=id, merge-duplicates`. `room_blocks` cascades/deletes always qualify
  `source=eq.<x>` so manual/walk-in blocks are never touched.

## Bidding lifecycle
- **Single source of truth `lib/bid-expiry.ts`:** `filterUserVisibleBids` (24h FRESH_GRACE) for
  customer surfaces (`/my-bids`, `/hotels/[id]`); `filterActiveBids` (strict) for operator surfaces
  (admin/partner); `isBidPayWindowOpen` gates every Pay CTA; `ACCEPTED_UNPAID_WINDOW_MIN/MS = 30`
  everywhere. `isBidExpired`: terminal statuses (EXPIRED/CANCELLED/DECLINED) MUST `return true`
  (hidden). The 24h grace is gated on NON-terminal status. Never treat `pageActiveBids.length>0` as
  "has active bid" without a PENDING/COUNTER/ACCEPTED status check.
- **`bids.expiresAt` is stamped by DB trigger `trg_stamp_accepted_expiry`** (`now + per-hotel
  acceptance_window_min ≥30`) on EVERY →ACCEPTED transition (cron RPC + Railway + Next routes).
  Never rely on app code to stamp it; never drop the trigger without re-adding the stamp to the
  cron RPC AND Railway accept routes.
- **`parseDbTime()` on every CLIENT expiry read** — `bids.createdAt`/`expiresAt` are `timestamp
  without time zone` (no tz marker); on IST browsers a naive `new Date()` reads 5.5h behind →
  "expired on launch". Always parse tz-less strings as UTC. Server (Vercel UTC) reads are fine.
- **One bid per HOTEL** (not per city) — both FE `/api/bids/place` and Railway lock on
  `findActiveBidOnHotel`. `/bid` (reverse auction) respects the hotel's Autopilot mode
  (`auto`=instant, `manual`=PENDING, `hybrid`=PREMIUM/STRONG via server-side `computeBidderScore`).
  LOWBALL never auto-accepts. Never restore instant `api.acceptBid` in the negotiate above-floor path.
- **`bid_requests.source`** (`place|negotiate|direct|flash`) is stamped at request creation; `/my-bids`
  reads it server-authoritatively. Every new bid-creation call site MUST pass `source` + `numRooms`
  + `guests`.
- **Multi-room:** `numRooms`/`capacityMismatch` on `bids`, `numRoomsRequested` on `bid_requests`,
  `numRooms` on `bookings`. Charge math = base × nights × numRooms; per-guest add-ons scale by
  NIGHTS only (party shared across rooms). Room-count auto-fit rule = `max(ceil(adults/cap),
  ceil(children/cap))` bounded ≤ adults (children ride free up to cap; overflow → extra room).
  Rooms cap 1-10 (11+ → WhatsApp concierge). Availability/oversell guards **fail open** (never a
  false 409 on the core booking path). PENDING bids do NOT consume inventory.
- **Every price input uses `snap100`** (`lib/price-snap.ts`, ₹100 multiple). Never show the word
  "floor price" in customer UI (show the number). Partner counters use the structured
  `lib/counter-addons.ts` catalog (no free-text — v25 anti-bypass).

## Flash deals
- ⚠ **`/api/flash/near` returns a STALE `discount`.** Line ~350 recomputes `aiPrice` through the v527 flash
  ladder but line ~352 passes `discount` straight through from the raw deal row, so the two disagree — live it
  returns **48%** against a `marketRate 3000 → aiPrice 2400` move, which is **20%**. **Never render that field.**
  Derive the badge from the two prices you are printing (`offPct(was, now)` in `components/home/DesktopHome.tsx`;
  the same derivation in `app/flash-deals/page.tsx` `stats.avgDisc`), so a badge can never contradict the prices
  beside it. The API keeps its own `discount` deliberately — it is also the feed's **sort/bucket key** (line
  ~385), so changing it there reorders the feed and is an owner decision, not a cleanup.

## Pricing Spine
- ONE source of truth: `lib/pricing/spine.ts` + `resolveSpinePrices()` (`lib/pricing/read-spine.ts`)
  + `room_date_price` cache + `/api/cron/price-spine`. Auction deal MUST be ≥8% below `livePrice`
  (which is below OTAs) — the no-overpay guarantee. Every customer surface reading a price MUST keep
  a local-compute fallback so a spine outage never breaks a page. `room_pricing_config.competitor_min`
  is a live INPUT (lowest-price guarantee) — never retire it; but `.current_price` is dead. Monsoon
  = 15 Jul–15 Sep (June is peak); `calculateDynamicPrice` multiplier clamped 0.55×–2.20×.

## Reel feed / social / dedup (5-hop LOAD-BEARING chain — bit us 3×)
Every hop has `⚠️ v131.8 LOAD-BEARING` markers; audit all 5 before touching any:
1. Composer (`CreateFlow.tsx`) generates a unique `clientPostId` per upload, sends it in the POST body.
2. `/api/social/posts` saves `social_posts.client_post_id` (unique partial index on `(author_id,
   client_post_id)`). It is the ONLY server writer — `InstagramHotelFeed.onPosted` must NEVER re-POST.
3. `/api/social/feed` returns the row with `client_post_id` (keep `select=*`).
4. `app/discover/page.tsx socialPostToItem` forwards `client_post_id` as `_clientPostId`; also
   `_taggedHotelId` (the real hotel id — NEVER pass the post id as a `/hotels/[id]` link).
5. `InstagramHotelFeed` dedups by exact `_clientPostId` match against local PostsStore ids;
   caption-fingerprint fallback for legacy pre-clientPostId posts.
- Every new post MUST tag a hotel (`/api/social/posts` 400s otherwise; HOTEL author defaults to
  `profile.hotel_id`). Feed filters `moderation_status=in.(APPROVED,AUTO_APPROVED)` — never remove
  it (keeps PENDING_ADMIN_REVIEW community posts off the feed).
- Never route `applyGain` through a cross-origin `<video>` (silences it — audio via `<audio>` only).
  Never add a private-DM affordance to any reel surface (v25 anti-bypass; post-booking chat only,
  gated to ACCEPTED+ status). Cross-identity social profile lookup via `findProfileAcrossIdentities`.

## Reel-page fullscreen (v247.4 final)
- Immersive `requestFullscreen()` on first gesture IS the chosen behaviour (like IG/TikTok) — the
  only reliable Android back-gesture absorber. Software history-sentinel back-guards were tried
  twice and FAILED (Next App Router tears through `pushState`). The app's own bottom nav stays
  visible so users are never trapped. Read `--reel-vh` from `visualViewport.height`, not
  `innerHeight`. Don't remove the immersive call to "show the nav pill" without a guard that
  actually holds the back gesture.

## Circle (multi-investor) — LOCKED contracts
- **Operated-only + owner-invisible.** Host-circle hotels: `owner_type='host_circle'`, per-property
  owner id `hco_<propId>` (NEVER a real user id, NEVER the shared sentinel). Lister dashboard access
  is via `hotel_room_units.owner_user_id` scope union (`resolveOperatedHotelIds` /
  `partnerHotelScope`/`partnerUnitScope`), NEVER via `hotels.ownerId`.
- **`approval_status='approved'` is the SINGLE customer-feed gate** (`/api/hotels`,
  `/api/discover/feed`, `/api/flash/near`, `/api/circle/resale`). `isActive`/`status`/`isVerified`/
  `published_at` are NOT feed gates. Three orthogonal Circle flags: `prebuy_enabled` (browsable as
  Model-3 supply), pre-buy window (`prebuy_window_start` inclusive / `prebuy_window_end` EXCLUSIVE,
  bounds check-in date, shared `lib/inventory/prebuy-window.ts`), `approval_status` (customer-bookable).
  Provision as DRAFT; only admin "Go Live" flips `approval_status='approved'` (guarded
  `owner_type='host_circle'`, never touches ownerId/owner_type).
- **Ownership transfer (B2B/D2):** ONLY `inventory_blocks.investor_user_id` moves seller→buyer (the
  commercial right); `hotel_room_units.owner_user_id` NEVER transfers between investors (SEBI-safe
  bounded goods). M1/M4 buyers get `owner_user_id` STAMPED at verify (guarded
  `or=(owner_user_id.is.null, in.(buyerIds))`).
- **Money engines are the single source** — `lib/inventory/engine.ts` (`resaleMargin`,
  `markdownResalePerNight` floored at buy cost, `PLATFORM_RESALE_FEE_PCT_DEFAULT=12`) and
  `lib/b2b/engine.ts` (`b2bTradeSplit`, `B2B_FEE_PCT_DEFAULT=8`, `markdownB2bAskPerNight`). Markdown
  always recomputes from the FROZEN baseline (`metadata.listResalePerNight`/`listAskPerNight`),
  never from the current marked-down price (else it compounds). Idempotent no-op skip (cron every
  15 min). Unique guards: `uniq_b2b_listing_active_block`, `uniq_b2b_trade_listing_completed`,
  `uniq_inv_sales_block_paid`, `uniq_settlement_kind_ref`. Admin payout actions only flip
  `owed→paid` (never invent amounts). B2B-only, never retail (SEBI/CIS distance).
- **Legal framing (v335, LOCKED; reaffirmed v564):** NEVER "guaranteed/assured/fixed/risk-free" for Circle
  income. ALWAYS "expected / based on actual bookings / not guaranteed". Use `lib/circle/disclosure.ts`
  constants (`CIRCLE_INCOME_DISCLOSURE`, `CIRCLE_RESALE_RISK_NOTE`, `CIRCLE_PAYOUTS_LABEL="Monthly
  Payouts"`). Never relabel the payout ledger "Returns". **And never render `roiMin`/`roiMax` or the API's
  ready-made `"18% ROI"` badge on a PUBLIC surface** — the home page shows `monthlyRate` (what the investor
  PAYS) instead, because a visitor there may never see the in-journey disclosures at all.
- All 3 investor journeys (Model 1/3/4) render the SAME `components/circle/CircleStepShell.tsx` —
  never fork it. The shared pure engines back UI + server so preview == charge.

## Channel Manager
- ONE sync engine `lib/channels/sync.ts` (manual + cron + adapters). Cancellation reconciliation:
  a VEVENT gone from the feed → its FUTURE-dated imported block DELETED; past-dated kept as history;
  reconcile ONLY from a response containing `BEGIN:VCALENDAR`. `isSafeFeedUrl` (SSRF) + 8s
  `withTimeout` on every feed fetch. Auto-pause at 10 consecutive failures. Scope by
  `partnerHotelScope`/`partnerUnitScope` (owned ∪ operated) — never `ownerId` alone (Circle
  partners would lose access). Per-unit feeds (`ota_feeds."unitId"`) use `canManageUnitRow`; NULL
  unitId = hotel-level. Notifications fire ONLY on real change (imported>0 / removed>0 / auto-pause).
  API-mode channels show honest "configured · awaiting connector" until certified (Booking.com
  scaffold is inert unless `BOOKING_COM_LIVE=1` + creds).

## Host vertical / subscriptions / tier / passport / scorecard
- **Host:** properties table is `discovery_properties` (NOT `host_properties` — doesn't exist);
  `source` CHECK = owner|broker|agent|platform (admin/curated = `'platform'`, never `'admin'`);
  no `updated_at` (in `NO_UPDATED_AT`). Lease-out (`/host/list-property` → `discovery_properties`)
  is DISTINCT from run-it-yourself (`/onboard`) — never cross them. `lib/host/wizard-rules.ts`
  `computeBundle` is the single source; overrides via admin-editable `host_wizard_config`
  (`resolveWizardConfig`, `mergeWizardConfig` clamps numerics + locks the key set). Channel/Workforce
  "connect"/"hire" are REQUESTS (ops actions), not automated. Worker self-edit route never writes
  status/verified/jobs_done; public hire catalog filters `status=eq.approved`.
- **Subscriptions:** default services (Bids/Rooms/Bookings/Availability/Complaints/Content/Profile)
  are free forever; never lock them. Trial/paid expiry is LAZY (`hotel_services.expires_at` read
  check) — no cron. `service-checkout` validates amount server-side; upsert `on_conflict=hotel_id,
  service_key` (`uniq_hotel_service`).
- **Content tier (2-tier):** Verified Guest (has booking) → `AUTO_APPROVED` instantly; Community
  Contributor (no stay, location-OTP) → `PENDING_ADMIN_REVIEW`; hotels NEVER gate guest content
  (report → admin only). Verified-Guest eligibility is date-based from CHECK-IN (`checkIn<=now AND
  checkOut>=now-90d`, CANCELLED excluded), never `checkOut<now`. Existing `/upgrade` creator form +
  auto-promote paths co-exist (first-to-fire wins). Reward crons need `Prefer: resolution=
  ignore-duplicates` (idempotency). Location OTP gated by `NEXT_PUBLIC_ENABLE_LOCATION_OTP`.
- **Passport:** `lib/passport/engine.ts` is pure + shared (server award + client display) — never
  change rank/XP/badge thresholds casually. `xp = computed(stamps) + bonus_xp`; to durably change a
  passport add/remove a real `passport_stamps` row or set `bonus_xp` (a plain `xp` write won't stick).
  Admin stamps need a unique `source_id`.
- **Hotel scorecard (`lib/hotel-score.ts`):** engine/weights/tiers LOCKED. `is_seeded=true` rows are
  never recomputed; every `upsertScore` refuses to write null over non-null `overall` and preserves
  `is_seeded`. 3-layer defense across all recompute entry points (route/cron/admin `?force=1`).
- **Animation layer:** exactly 10 `.sb-*` + 4 `.hx-*` utilities + `<CountUp value>` (named export)
  + `lib/useReveal.ts`; reduced-motion guard at the bottom of globals.css. Don't add an 11th
  utility or rename any (applied across 19 pages). `.hx-*` are `/hotels/[id]`-scoped.

## Cron jobs
Vercel cron (2-cap): `/api/cron/pricing` (daily 4:00), `/api/cron/lifecycle` (4:05). cron-job.org
(rest): `expire-holds`, `flash-drop`, `feedback-lifecycle`, `price-spine`, `inventory-lifecycle`
(Circle markdown/expiry + B2B), `channel-sync`, `auto-approve-content`, `post-stay-nudge`,
`view-milestone-rewards`, `creator-upgrade-eval`. **Cron auth is FAIL-CLOSED + Bearer-ONLY (hotfix v621, shared
`lib/cron/auth.ts`):** the ONLY credential is the exact `CRON_SECRET`, and the ONLY accepted transport is the
`Authorization: Bearer <CRON_SECRET>` header. **A secret must NEVER travel in a URL** — the `?token=` query-string
transport (and the `x-cron-secret` header) are REMOVED; request URLs are logged by proxies / the CDN edge / browser
history, so a token in the query string is a credential leak. There is **NO public "staybid-cron-dev" fallback and no
`CRON_TOKEN`** — a route returns **503 `cron_auth_unconfigured`** when `CRON_SECRET` is unset and **401** on a
wrong/absent/fake/query-only token, **before any side effect**. The `adm_` x-admin-token bypass is RETIRED. `vercel.json`
crons carry no query token (Vercel sends `Authorization: Bearer <CRON_SECRET>` automatically once `CRON_SECRET` is set
in Vercel Production). Keep internal budgets ≤24s (cron-job.org ~30s client timeout); per-item `withTimeout` in batched
loops (Node fetch has no default timeout). ⚠ **CRON_SECRET must be set in prod** (a hard merge blocker) and external
schedulers (cron-job.org) must be configured with a **custom header** `Authorization: Bearer <CRON_SECRET>` (never a
`?token=` URL). Registered `*/15`/`*/30`: `channel-sync` + `inventory-lifecycle` + `circle-settlement`.
⏳ **Owner ops still PENDING (deferred 2026-07-27):** RazorpayX live payout setup (the 3
`RAZORPAYX_*` env vars → Circle owner money-out). Full step-by-step in
`docs/PENDING-RAZORPAYX-SETUP.md`. Interim: `/admin/circle-inventory` "Mark paid (manual)".

## Scope / process
- Only touch repos `sachinhelpline/staybid-frontend` + `sachinhelpline/staybid-live`. Use
  `mcp__github__` tools, never `gh`. Additive-only; never delete/rename existing fields/routes.
  Existing customer/partner/admin flows must keep working after every change. Stop at phase
  boundaries; wait for the user's "continue" before the next phase. **User-facing copy is ENGLISH**
  (owner moved Circle + Trade to English in v369; keep all new user-facing copy English, NOT Hinglish).
  English in code/commits/this file. Never put the model identifier anywhere pushed to a repo.
