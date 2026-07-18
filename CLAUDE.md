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
  page.tsx / discover/ / reels/       # IG-style reel feed (page.tsx renders DiscoverPage directly)
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
components/  discover/ partner/ admin/ circle/ hotel/ tier/ verify/ passport/ upgrade/ host/ ...
lib/        api.ts auth.tsx sb.ts sb-server.ts sb-cache.ts razorpay.ts firebase.ts
            bid-expiry.ts price-snap.ts catalog.ts hotel-score.ts commission.ts attribution.ts
            pricing/{spine,read-spine} inventory/{engine,quote,assign,prebuy-window}
            b2b/engine.ts channels/{sync,adapters/} partner/{hotel-scope,operator-access,owner-ids}
            circle/{provision,disclosure} host/{wizard-rules,modules,journey-data,provision}
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
Server-only: `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` · `SUPABASE_SERVICE_ROLE_KEY`
(auto-elevates RLS via `lib/sb-server.ts`) · `CRON_SECRET` · `JWT_SECRET` · optional
`GEMINI_API_KEY` (free vision primary) / `ANTHROPIC_API_KEY` (paid backup) / `AI_VERIFY_PROVIDER` ·
`BOOKING_COM_LIVE` (inert channel-manager scaffold).
Razorpay live keys also hardcoded as fallbacks in the order/verify routes. Public LIVE key id
`rzp_live_SfFAsbYjbHfztd` is safe in client code.

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
  (+ `partnerHotelScope`/`partnerUnitScope`), `adminFromReq` + `logAdminAction`, `workerFromReq`
  (last-10-digit phone `ilike`).
- **Sign-in-then-resume:** auth-gated CTAs use `redirectToSignIn(router,{route,action?,payload?})`
  (`lib/auth-intent.ts`, 30-min localStorage TTL) + `consumeMatchingIntent()` on the destination.
  `/auth` reads `?return=` (wrapped in `<Suspense>`).
- **Bulletproof logout** (`lib/auth.tsx`): allow-list wipe of localStorage (KEEP only device prefs:
  theme/city/build/reel-filter/reel-mute/reel-gain) + `sessionStorage.clear()` +
  `indexedDB.deleteDatabase("firebaseLocalStorageDb")` + lazy `firebaseSignOut` +
  `window.location.replace("/auth")`. Firebase imports MUST be lazy (dynamic import inside
  `logout()`) so SSR never calls `getAuth` without env vars.

---

## Current production state (v349, Circle "Model 2" — rename + dual fee + city access + regulated price)
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
  SWR HTML, cache-first hashed chunks, network-only `/api/`. `HTML_CACHE` at `v161` (v349 regulated price).
- **Version badge:** `SB_BUILD` + visible `vN` chip in `app/layout.tsx`, at v349. Bump both on
  every UI ship.
- **NOT to be touched casually:** scoring engine (`lib/hotel-score.ts` weights/tiers), commission
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
- **Legal framing (v335, LOCKED):** NEVER "guaranteed/assured/fixed/risk-free" for Circle income.
  ALWAYS "expected / based on actual bookings / not guaranteed". Use `lib/circle/disclosure.ts`
  constants (`CIRCLE_INCOME_DISCLOSURE`, `CIRCLE_RESALE_RISK_NOTE`, `CIRCLE_PAYOUTS_LABEL="Monthly
  Payouts"`). Never relabel the payout ledger "Returns".
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
`view-milestone-rewards`, `creator-upgrade-eval`. All accept `?token=<CRON_SECRET||"staybid-cron-dev">`
/ Bearer `CRON_SECRET` / `adm_` x-admin-token. Keep internal budgets ≤24s (cron-job.org ~30s client
timeout); per-item `withTimeout` in batched loops (Node fetch has no default timeout). ⚠ Pending
Sachin registrations: `/api/cron/channel-sync` + `/api/cron/inventory-lifecycle` (`*/15 * * * *`).

## Scope / process
- Only touch repos `sachinhelpline/staybid-frontend` + `sachinhelpline/staybid-live`. Use
  `mcp__github__` tools, never `gh`. Additive-only; never delete/rename existing fields/routes.
  Existing customer/partner/admin flows must keep working after every change. Stop at phase
  boundaries; wait for the user's "continue" before the next phase. Hinglish in user-facing copy,
  English in code/commits/this file. Never put the model identifier anywhere pushed to a repo.
