# StayBid Circle — Multi-Investor Master Blueprint

> Anchor doc for the room-level hospitality-investment expansion. Every phase
> reads this first so context is never lost across sessions. Additive-only:
> nothing here breaks existing Circle / bid / partner / customer flows.

## 0. The idea (Sachin's ask)

Today a StayBid Circle investor "locks" a physical room on a StayBid-operated
hotel for a duration and gets that room's bookings (exclusive per-unit). The
expansion runs **three models on ONE shared core**, buildable together:

- **Model 1 — Income-share (expected, NO guaranteed ROI).** Investor owns a
  room/duration; income = actual bookings, net, "expected" only. Legal framing:
  never say "guaranteed/assured/fixed" — always "expected / based on actual
  bookings / aspirational".
- **Model 3 — Pre-buy + resell (commerce).** Investor advance-buys inventory
  (specific room-nights, dynamic weekday/weekend/seasonal price) from StayBid,
  then **resells on StayBid's own surfaces** at their own price. Cleanest legal
  path (goods trade, not an investment scheme). **Launch first.**
- **Model 4 — B2B exchange (intermediary).** Investors trade owned inventory
  among each other at B2B prices; StayBid is the digital platform + takes fees.
  Highest scale, most beneficial for StayBid. B2B-only (no retail) → far from
  SEBI/CIS. **Launch second.**

**Operated-only + owner-invisible** is a locked decision: build only on
StayBid-operated properties (best quality; property-owner and investors can
never connect directly). Already architecturally supported (`owner_type=
'host_circle'`, `hco_<propId>` per-property owner, v309).

### Model 3 sell-out = Model 1 sell-out (no new "seller platform")

The investor never builds a storefront. **StayBid's consumer feed IS the
storefront** — identical rails to Model 1: `ownership → customer feed →
attribution → settlement → payout`. Model 3 just owns "date-range inventory
blocks" instead of "a unit for a duration". Three sell channels, all provided
by us: (1) StayBid consumer app, (2) OTA/Airbnb cross-listing (Phase B),
(3) B2B exchange (Model 4, safety valve). Resale price set by investor
(Pricing Spine suggests). Unsold-inventory risk is the investor's (commerce);
StayBid maximizes sell-through via dynamic discount + OTA push + B2B + optional
(fee-based) buyback.

## 1. The shared core

```
        SHARED CORE (one neev)
        • ownership unit  (who owns which physical room / room-nights)
        • inventory ledger (which night is whose)
        • attribution + settlement (money routing + fees)
              │            │            │
        MODEL 1       MODEL 3       MODEL 4
        income-share  pre-buy+resell  B2B trade
        (expected)    (commerce)      (intermediary)
```

Three models = three faces of one engine. StayBid fee menu: bundle margin
(1/3), transaction % (4), listing/visibility fee (3/4), channel/OTA sync fee,
operating/mgmt fee (1), escrow/settlement fee (4). Fee config reuses the
service-subscription pricing infra (`service_pricing`).

## 2. Already-built vs gap (verified in code, 2026-07-12)

| Requirement | Status | Where |
|---|---|---|
| Investor locks 1 room → its bookings | ✅ built | `circle_bundles`, `lib/circle/provision.ts` |
| **Multiple investors per hotel (different rooms)** | ✅ built | `hotel_room_units.owner_user_id` (v299) |
| Investor partner-style dashboard | ✅ built | `resolveOperatedHotelIds` scope union (v309) |
| Per-unit independent listing (price/photos/title) | ✅ built | `hotel_room_units` overrides (v300), `/api/partner/circle-units`, `CircleUnitsTab` |
| Operated-only + owner-invisible | ✅ built | `owner_type='host_circle'`, `hco_<propId>` (v309/v310) |
| OTA/Airbnb cross-listing (hotel/operator level) | ✅ built | Channel Manager v315–v320, `partnerHotelScope` |
| Autopilot / Hybrid / Manual per HOTEL | ✅ built | `hotels.autopilot_mode` (v130) |
| **Autopilot per UNIT / per OWNER** | ✅ **Phase A (v325)** | `hotel_room_units.autopilot_mode` + `loadEffectiveAutopilotMode` |
| **OTA creds per UNIT / per OWNER** | ❌ gap | Phase B — `channel_connections.unit_id` / `ota_feeds.unit_id` |
| Pre-buy inventory blocks (Model 3) | ❌ gap | Phase C — `inventory_blocks` |
| B2B exchange + settlement (Model 4) | ❌ gap | Phase D — `b2b_listings` / `b2b_trades` / `settlement_ledger` |
| SAME room co-owned by multiple (fractional) | ❌ not planned | out of scope — exclusive-per-unit model stands |

**~70% of the two "new dashboard" requirements already existed.** Only 2 real
code-gaps to close (per-unit autopilot ✅ Phase A; per-unit OTA creds → Phase B)
plus the Model 3 + Model 4 layers.

## 3. Phase plan + status

Recommended order: A + B + E first (small, high-value, the two dashboard asks),
then C (clean-legal ownership), then D (most scale). F ongoing.

- [x] **Phase A — Per-unit autopilot (v325, 2026-07-12).** DONE. See §4.
- [x] **Phase B — Per-unit OTA/Airbnb cross-listing (v326, 2026-07-12).** DONE.
  See §5. `ota_feeds."unitId"` + `channel_connections.unit_id` (NULL =
  hotel-level, zero regression) + `partnerUnitScope` / `canManageUnitRow`;
  per-unit iCal export already existed (`/api/partner/ical/[roomId]`).
  Overbooking guard (v318) + reservations inbox extended per-unit.
- [~] **Phase C — Model 3 pre-buy inventory blocks.** `inventory_blocks`
  (owner, unit, date_from/to, buy_price from Pricing Spine, resale_price,
  status). Investor buys a date-range → sets resale → shows on the SAME
  consumer feed + OTA + B2B. Settlement: customer pays resale → StayBid fee →
  investor. Dynamic-discount / expiry / optional buyback on top.
  - [x] **C1 — inert foundation (v327, 2026-07-12).** DONE. See §6. Schema
    (`inventory_blocks`) + pure engine (`lib/inventory/engine.ts`) + Spine
    quote (`lib/inventory/quote.ts`) + owner-scoped read/quote/draft-list API
    + investor `CircleInventoryTab` (quote builder + draft blocks). NO
    Razorpay, NO inventory hold, NO consumer exposure, NO settlement.
  - [x] **C2 — purchase flow (v328, 2026-07-12).** DONE. See §7. Razorpay
    checkout (tamper-safe: server re-quotes the Spine + overlap re-guard,
    freezes buy at pay time) → `owned` on HMAC-verified payment. Writes an
    idempotent `room_blocks` inventory HOLD so the block can't double-book.
  - [x] **C3 — resale listing + consumer feed + settlement (v329, 2026-07-12).**
    DONE. See §8. `listed` block on the SAME customer feed at resale price;
    customer pays → block `sold` → `inventory_sales` freezes StayBid fee +
    investor net (`resaleMargin`); `payout_status='owed'` records what StayBid
    owes the investor (payout execution is C4).
  - [x] **C4 — dynamic discount / expiry / buyback + admin (v330, 2026-07-13).**
    DONE. See §9. Lifecycle cron `/api/cron/inventory-lifecycle` auto-marks-down
    listed blocks in tiers as check-in nears (frozen `metadata.listResalePerNight`
    baseline, floored at buy cost, idempotent) + expiry-sweeps started-but-unsold
    owned/listed blocks → `expired` + releases the pre-buy hold. Investor buyback
    toggle (`PATCH /api/circle/inventory`). Admin oversight `/admin/circle-inventory`
    + `/api/admin/circle-inventory`: force-expire, buyback (owned|listed|expired →
    refunded + `metadata.buybackPayoutStatus='owed'` + hold release), and settle
    both obligations (`inventory_sales.payout_status` owed→paid + buyback owed→paid).
- [ ] **Phase D — Model 4 B2B exchange.** `b2b_listings` / `b2b_trades` /
  `settlement_ledger`. Fees via `service_pricing` reuse. B2B-only (SEBI-safe).
- [ ] **Phase E — Model 1 "expected income" language.** UI/legal migration to
  "expected, no guarantee" (ledger already actual-performance-based). Copy +
  disclosure only; no new table.
- [ ] **Phase F — Operated-only supply growth.** Already ready via v309
  host-circle provisioning; investors list their own property → admin approve →
  operated, owner-invisible.

### Legal framing (biggest blocker, not code)
Order chosen for legal safety: Model 3 (commerce) → Model 4 (intermediary) →
Model 1 (expected-only). **NEVER** offer guaranteed/assured/fixed returns.

## 4. Phase A — Per-unit autopilot (v325, DONE)

**Problem:** `hotels.autopilot_mode` is per-HOTEL. On a multi-investor operated
hotel, one investor changing the mode would flip auto-accept for EVERY owner's
rooms. **Fix:** per-physical-unit override; NULL = inherit hotel-level.

- **Migration** `2026-07-12-v325-phase-a-per-unit-autopilot.sql` (applied live):
  `hotel_room_units.autopilot_mode` (NULL=inherit) + `autopilot_updated_at` +
  CHECK (`hru_autopilot_mode_chk`, NULL or auto|hybrid|manual) + partial index.
- **`lib/autopilot-server.ts` `loadEffectiveAutopilotMode(hotelId, unitId?)`** —
  unit override if set → else hotel-level `loadAutopilotMode` → else 'auto'.
  Fails SAFE at every layer; a bid is never blocked.
- **Wired into both accept paths:** `/api/bids/place` (uses the already-resolved
  `resolvedUnitId` from `resolveOwnedUnit`) and `/api/bids/[id]/schedule-accept`
  (reads the bid's `assignedUnitId`). Classic category bids (no unit) → identical
  hotel-level behaviour, zero regression.
- **Investor control:** `/api/partner/circle-units` PATCH whitelists
  `autopilot_mode` (auto|hybrid|manual|inherit→null), re-verifies unit ownership,
  stamps `autopilot_updated_at`. GET already `select=*` so it flows through.
- **UI:** `components/partner/CircleUnitsTab.tsx` — per-unit segmented control
  (Hotel default / Auto / Hybrid / Manual), saves immediately, shows the
  effective mode + description. Dashboard passes `hotelAutopilotMode` so
  "inherit" shows what it follows.

### Things to Avoid (Phase A)
- **Never** revert `place` / `schedule-accept` from `loadEffectiveAutopilotMode`
  back to `loadAutopilotMode` — that re-breaks per-owner control on shared hotels.
- **Never** trust a client-supplied unit for the mode. `place` resolves the unit
  via `resolveOwnedUnit` (owned+listed+active) before it drives the mode; a
  bid's `assignedUnitId` is only ever set from that validated resolution.
- **Never** let the per-unit mode escape the owner: `circle-units` PATCH
  re-verifies `owner_user_id ∈ caller's cross-pool ids` on every write.
- NULL is the inherit signal — keep it. A per-unit `'auto'` is an EXPLICIT
  override that ignores the hotel-level mode (matters if the hotel is 'manual').

## 5. Phase B — Per-unit OTA/Airbnb cross-listing (v326, DONE)

**Problem:** the Channel Manager (v315–v320) scopes feeds per HOTEL. On a
multi-investor operated hotel every co-investor would see + manage EVERY
owner's OTA feeds and guest reservations. **Fix:** an OTA feed can now be
attached to a single physical unit; a unit-scoped investor manages only feeds
on the units they own; a full-hotel owner keeps hotel-level access. NULL
`unitId` = hotel-level (zero regression for every existing feed).

- **Migration** `2026-07-12-v326-channel-manager-per-unit.sql` (applied live):
  `ota_feeds."unitId" TEXT` (camelCase quoted) + `channel_connections.unit_id
  TEXT` (snake_case) + 2 partial indexes `idx_ota_feeds_unit` /
  `idx_channel_connections_unit` (WHERE ... IS NOT NULL). `channel_connections
  .unit_id` is RESERVED for a future admin per-unit connector — the partner
  flow keys off `ota_feeds."unitId"` only. Unit-scoped feeds do NOT auto-link a
  `channel_connections` row (the `(hotel_id, ota)` unique index would collide
  across two investors on the same hotel + OTA).
- **THE UNIT RULE** (`lib/partner/hotel-scope.ts`): `resolveScopeParts(req)`
  returns `{userId, ownerIds, ownedHotelIds, operatedHotelIds}`;
  `partnerUnitScope(req)` adds `unitsByHotel` (per operated hotel: `null` =
  full-hotel owner via `hotels.ownerId`, else `string[]` of owned active unit
  ids batched from `hotel_room_units`). `canManageUnitRow(scope, hotelId,
  unitId)`: not-in-scope → false; full-hotel(null) → true; unit-scoped → only
  its OWN unitId, and NEVER a hotel-level (unitId null) feed → false.
  `partnerHotelScope` kept byte-compatible for callers that don't need units.
- **`/api/partner/ota-feeds`** — `partnerUnitScope`. GET returns `{feeds,
  unitScoped, units}` (feeds filtered by `canManageUnitRow`; units = owned
  units when unit-scoped, else all active hotel units). POST: if unit-scoped,
  `unitId` REQUIRED + must be owned + `roomId` DERIVED from the owned unit
  (never trusts a mismatched body roomId); else hotel-level with the
  room-belongs-to-hotel check. Auto-links `channel_connections` ONLY when
  `!unitId`. PATCH/DELETE re-check ownership via `canManageUnitRow(scope,
  existing.hotelId, existing.unitId ?? null)`.
- **`/api/partner/ota-feeds/sync`** — swapped to `partnerUnitScope` +
  `canManageUnitRow`.
- **Sync engine** (`lib/channels/sync.ts`): imported blocks now carry
  `assignedUnitId = feed.unitId` when the feed is per-unit, so a per-unit iCal
  import pins the hold to that physical room. `notifyForFeed(feed, …)` routes a
  per-unit feed's notifications to just that unit's owner (else all managers).
- **Availability** (`lib/availability.ts`): `Occupation.numRooms`;
  `getOccupations` carries each bid's `numRooms`; NEW `unitDoubleBooked({
  hotelId, unitId, from, to})` — filters occupations to `assignedUnitId ===
  unitId`, per-night sums `numRooms`, returns true if any night > 1. Fail-safe
  false.
- **`/api/partner/overbooking-check`** — per-unit branch: an assigned-unit OTA
  block runs `unitDoubleBooked` (same physical room sold twice, `perUnit:true`);
  category blocks keep the v318 `unitsFreeForRange` capacity check.
- **`/api/partner/channel-reservations`** — filters rows via `canManageUnitRow(
  scope, hotelId, b.assignedUnitId ?? null)` so a unit-scoped investor never
  sees a co-investor's OTA guest data.
- **UI** (`components/partner/OtaFeedManager.tsx`): loads `unitScoped` + `units`
  from GET; when unit-scoped the "Add feed" form shows a UNIT picker (sends
  `unitId`) instead of the room picker (sends `roomId`); each per-unit feed row
  gets an amber `🔑 #<roomNumber>` chip; Add button disabled uses
  `!(unitScoped ? nf.unitId : nf.roomId)`.
- `SB_BUILD v325→v326`, badge v326, `HTML_CACHE v139` (`public/sw.js`).

### Verified (live round-trip, then cleaned up — 0 leftover)
Seeded a synthetic host-circle hotel + one owned active `hotel_room_units`
(`owner_user_id='v326-lister'`) + a per-unit `ota_feeds` (`unitId` set) + two
overlapping unit-assigned `room_blocks`, then asserted against the real schema:
**(A)** `partnerUnitScope`'s unit query returns the owned active unit for the
lister (1); **(B)** `canManageUnitRow` admits the feed (feed.unitId ∈ owned
set); **(C)** `unitDoubleBooked` mirror = true, per-night peak = 2 (>1 =
double-booked). All test rows deleted. `tsc --noEmit` clean, `next build` green.

### Things to Avoid (Phase B)
- **Never** scope a channel route by `partnerHotelScope` (hotel-only) when it
  touches feeds, reservations, or overbooking — use `partnerUnitScope` +
  `canManageUnitRow`, or a unit-scoped investor sees/manages a co-investor's
  feeds and OTA guest data.
- **Never** auto-link a `channel_connections` row for a per-unit (`unitId` set)
  feed — the `(hotel_id, ota)` unique index would 42P10-collide across two
  investors' Booking.com feeds on the same hotel. Only hotel-level (`!unitId`)
  feeds auto-link. `channel_connections.unit_id` exists but is reserved for a
  future admin per-unit connector.
- **Never** trust a body `roomId` on a unit-scoped POST — derive `roomId` from
  the owned unit. A mismatched roomId would attach the feed's imported blocks to
  the wrong physical room.
- **Never** stamp `assignedUnitId` on an imported block from a hotel-level feed
  — only per-unit feeds set it; a category feed's imports stay unit-agnostic so
  `unitDoubleBooked` never false-positives on them.
- Keep `unitDoubleBooked` fail-safe false — a per-unit availability hiccup must
  never surface a phantom overbooking alert (same discipline as the v247
  oversell guard failing open).

---

## 6. Phase C1 — Model 3 pre-buy foundation (v327, 2026-07-12)

The additive, **inert** first sub-phase of Model 3. An investor who already
OWNS a physical unit (`hotel_room_units.owner_user_id`) can take commercial
control of a DATE RANGE of that unit: get a live Pricing-Spine quote (wholesale
buy + suggested retail + their margin) and save it as a **DRAFT** block. No
money moves, no inventory is held, nothing is exposed to customers — purchase
(C2), resale + settlement (C3), and dynamic-discount/buyback (C4) land next and
are shown in the UI as clearly-labelled "coming next".

### The commerce model (Model 3)
The investor buys room-nights WHOLESALE from StayBid (Pricing-Spine floor),
sets a RETAIL resale price, resells on StayBid surfaces, keeps the margin, and
bears the unsold risk (which is why the buy is paid upfront in C2). Wholesale =
Spine `bidFloor` (the lowest StayBid would sell), retail suggestion = Spine
`livePrice`. Platform takes a % fee on the resale at settlement.

### Migration `2026-07-12-v327-phase-c1-inventory-blocks.sql` (applied live)
`inventory_blocks` (22 cols): `id` PK (`inv_`+uuid), `investor_user_id`,
`hotel_id`, `unit_id`, `room_id`, `date_from`/`date_to` (DATE), `nights`,
`buy_price_per_night`/`buy_total` (frozen at draft), `resale_price_per_night`,
`platform_fee_pct`, `status` CHECK ∈ {draft, quoted, pending_payment, owned,
listed, sold, expired, cancelled, refunded} DEFAULT `'draft'`, `buyback_enabled`,
`razorpay_order_id`/`payment_id`, `purchased_at`/`listed_at`/`sold_at`,
`metadata` JSONB, timestamps. `CONSTRAINT inventory_blocks_range_chk CHECK
(date_to > date_from AND nights > 0)`. 5 indexes (investor+status,
unit+date-range, hotel+status, partial WHERE status='listed'). RLS permissive
`inventory_blocks_all_anon` (project baseline).

### Files (all NEW, additive)
- **`lib/inventory/engine.ts`** — PURE, no fetch. Shared by the quote endpoint,
  the (future C2) checkout, and the client UI so the numbers NEVER drift.
  `INVENTORY_STATUSES` / `ACTIVE_INVENTORY_STATUSES` / `TERMINAL_INVENTORY_STATUSES`,
  `PLATFORM_RESALE_FEE_PCT_DEFAULT = 12` (⚠ flagged default — wire to
  `service_pricing` later), `MAX_BLOCK_NIGHTS = 90`, `nightsBetween`,
  `computeBlockQuote` (per-night Spine arrays → nights/buyTotal/avgBuyPerNight/
  suggestedResaleTotal/avgResalePerNight/feePct/estFeeOnSuggested/
  estInvestorNetOnSuggested), `resaleMargin`.
- **`lib/inventory/quote.ts`** — server. `quoteInventoryBlock({roomId,from,to,
  feePct?})`: one `room_date_price` range read + per-missing-night
  `resolveSpinePrices` fallback. `wholesaleOf` = bidFloor → flashFloor →
  round(live×0.7); `retailOf` = livePrice → flashPrice → baseRate. Caps
  `MAX_BLOCK_NIGHTS`; returns null if no price signal.
- **`app/api/circle/inventory/quote/route.ts`** — POST `{unitId,from,to,
  resalePricePerNight?}`. Auth → `resolveOwnerIdsCrossPool` → `ownedUnit`
  (verify caller owns the physical unit) → derive roomId/hotelId →
  `quoteInventoryBlock` + optional `atResale` (`resaleMargin`). READ-ONLY, no
  write, no charge.
- **`app/api/circle/inventory/route.ts`** — GET (caller's blocks, side-load
  unit# + hotel name, NO FK embed) · POST (create DRAFT: ownership + date
  validation + overlap guard against non-terminal blocks + **re-quote to FREEZE**
  buy_price/buy_total/fee, client never sets ₹) · DELETE (only draft|quoted the
  caller owns).
- **`components/partner/CircleInventoryTab.tsx`** — investor UI under "My Rooms"
  (below `CircleUnitsTab`, operator-only): quote builder (unit picker → dates →
  optional resale/night → "Get quote") + "Save as draft" + draft-blocks list
  with status chips + delete. Honest "purchase & resale-listing arrive next".

### Wiring
`app/partner/dashboard/page.tsx` — `{tab === "myrooms" && hotel?.isOperator}`
now renders `<CircleUnitsTab/>` **and** `<CircleInventoryTab hotelId
initialUnits={hotel.ownedUnits}/>`. Same operator gate as Phase A.

### Verified (live round-trip, then cleaned up — 0 leftover)
Seeded a synthetic owned `hotel_room_units` (`owner_user_id='v327-tester'`) on
real room `ris04-r1` (75 days of Spine data) and mirrored the route against the
live schema: **(A)** ownership query resolves the owned unit; **(B)** overlap
guard empty (no clash); **(C)** quote mirror over 2026-07-15..18 =
nights 3 / buy_total 12,600 (3×₹4,200 floor) / suggested_resale 13,000;
**(D)** DRAFT insert accepted with the exact frozen field shape + range CHECK
held + JSONB metadata; **(E)** GET-list side-load (block + unit# + hotel name,
no FK embed); **(F)** DELETE guard removes only draft|quoted. Then deleted the
block + unit → `blocks_left=0, units_left=0`. `tsc --noEmit` clean,
`next build` green (both `/api/circle/inventory` routes compiled).

### Things to Avoid (Phase C1)
- **Never** let the client set the buy/resale ₹ on the DRAFT — POST re-quotes
  the Spine server-side and FREEZES `buy_price_per_night`/`buy_total`/`fee`.
  This is the C2 tamper-safe checkout pattern, established early.
- **Never** create an inventory block on a unit the caller doesn't own — every
  quote + POST goes through `resolveOwnerIdsCrossPool` + `ownedUnit`.
- **Never** skip the overlap guard on POST — two non-terminal blocks on the
  same unit over the same nights would double-sell in C2/C3.
- **Never** compute the quote anywhere but `lib/inventory/engine.ts` — the UI,
  the quote endpoint, and the future C2 checkout MUST share it so preview ==
  charge (same discipline as the host wizard's single-source `computeBundle`).
- **Never** delete a block that isn't draft|quoted — once money moves (C2) the
  lifecycle owns the transition; the DELETE route filters `status IN
  (draft,quoted)` belt-and-braces.
- `PLATFORM_RESALE_FEE_PCT_DEFAULT = 12` is a flagged default — wire it to the
  admin-editable `service_pricing` infra (same as host wizard + subscriptions)
  before C3 settlement goes live.

### C1 boundary — STOP
C1 is the inert data + pricing-quote foundation. **Do NOT start C2 (Razorpay
purchase + inventory hold) without Sachin's "continue".** C2 → C3 → C4 each
verify live + stop at their own sub-phase boundary, same as the Channel Manager
phases.

---

## §7 — Phase C2: Purchase Flow + Inventory Hold (v328, 2026-07-12)

C2 turns a C1 DRAFT/QUOTED inventory block into an `owned` block via a
tamper-safe Razorpay checkout, then writes an idempotent `room_blocks`
inventory HOLD so the bought room-nights can't be double-sold. **NO consumer
feed exposure, NO resale listing, NO settlement — those are C3/C4.** No
migration (C1's `inventory_blocks` + its razorpay columns already exist).

### The two routes (both owner-verified, both share `lib/inventory`)
- **`POST /api/circle/inventory/[id]/checkout`** — loads the block (must be
  `draft|quoted`, owned by caller via `resolveOwnerIdsCrossPool` + `ownedUnit`).
  Overlap re-guard EXCLUDING self (`unit_id=eq & id=neq.self & status=not.in.
  (expired,cancelled,refunded) & date_from<to & date_to>from` → 409 on clash).
  Re-quotes the Spine via `quoteInventoryBlock` (422 if null/≤0). Creates a
  Razorpay order via `${origin}/api/razorpay/order` with `amount: quote.buyTotal`,
  `receipt: cinv_<id>`, `notes:{kind:"circle_inventory",blockId,unitId}`. PATCH
  guarded `status=in.(draft,quoted) & investor_user_id=in.(ownerIds)` → sets
  `status:"pending_payment", buy_price_per_night, buy_total, platform_fee_pct,
  razorpay_order_id, metadata:{…,repricedAt,suggestedResaleTotal}`. Returns
  `{ok, keyId:PUBLIC_KEY_ID, order, buyTotal, block}`. **The client never sets
  the ₹** — the server re-quotes + FREEZES buy at pay time (C1 discipline).
- **`POST /api/circle/inventory/[id]/verify`** — validates razorpay_* fields,
  auth → ownerIds, HMAC via `${origin}/api/razorpay/verify` (reads `.verified`;
  400 mismatch / 502 unreachable). PATCH `id=eq & razorpay_order_id=eq &
  status=eq.pending_payment & investor_user_id=in.(ids)` → `status:"owned",
  razorpay_payment_id, purchased_at, updated_at`. **Anti-tamper + idempotent:**
  matched on `id + razorpay_order_id + status=pending_payment + ownership`, so a
  replay/tampered-configId flips 0 rows → re-fetch the owned block for the
  caller, `writeHold` if found, return `{ok:true, alreadyProcessed:true}`. On a
  real flip → `writeHold(block)` and return `{ok:true, block, held}`.

### The inventory hold (`writeHold`, best-effort, never throws)
`getOccupations`/`unitsFreeForRange` (`lib/availability.ts`) count ALL
`room_blocks` rows, so writing one row auto-holds the nights. Hold id is
DETERMINISTIC `invhold_<blockId>` → idempotent upsert
(`on_conflict=id, Prefer: resolution=merge-duplicates,return=minimal`) so
re-verify never duplicates it, and C4 expiry/refund can find + release it.
Body: `{id:'invhold_'+block.id, hotelId, roomId, fromDate:date_from,
toDate:date_to, source:"inventory", assignedUnitId:unit_id,
assignedUnitNumber, note:"StayBid Circle pre-buy hold",
createdBy:investor_user_id}`. `room_blocks` has NO `source` CHECK (only the
`toDate>fromDate` range check); `source` defaults to `'manual'`. `writeHold`
is best-effort — a hold hiccup must never fail a payment that already succeeded.

### Client UI (`components/partner/CircleInventoryTab.tsx`)
`buyNights(b)`: POST checkout → `openRazorpayForOrder(order)` → POST verify →
flash + `loadBlocks()`. `draft|quoted` rows show "Buy nights · {inr(buy_total)}";
`pending_payment` rows show "Complete payment". Razorpay client via
`openRazorpayForOrder` (cancellation = `RazorpayError("__CANCELLED__")`).

### Verified (live round-trip, cleaned up — 0 leftover, twice)
Self-contained synthetic host-circle hotel + a v247-trigger-provisioned owned
unit on a real room + a C1 DRAFT block. **All 6 asserts PASSED:**
overlap_guard_empty=0 · pending_after_checkout=1 (checkout PATCH →
pending_payment + order id) · owned_after_verify=1 (verify PATCH matched on
id+order+pending+ownership) · hold_written=1 (`room_blocks invhold_<id>`,
`source='inventory'`) · hold_idempotent_no_dup=1 (re-run `writeHold` via
on_conflict merge → still exactly 1 row) · units_free_after_hold=0 (the hold
consumes the unit → a customer booking for the range is blocked). Test rows
deleted both runs. `tsc --noEmit` clean, `next build` green (both routes
compiled). `SB_BUILD v327→v328`, badge v328, `HTML_CACHE v140→v141`.

### Things to Avoid (Phase C2)
- **Never** let the client set the buy ₹ at checkout — the checkout route
  re-quotes the Spine + freezes `buy_total` server-side; verify never trusts a
  client amount (same tamper-safe pattern as host-wizard + subscriptions).
- **Never** flip a block to `owned` without matching on `razorpay_order_id` AND
  `status=pending_payment` AND `investor_user_id ownership` — that 4-key PATCH
  filter is the anti-tamper + idempotency guard. A 0-row flip means
  already-processed OR not-yours → return `alreadyProcessed`, do NOT re-charge.
- **Never** write the inventory hold with a random id — it MUST be the
  deterministic `invhold_<blockId>` upsert, or a re-verify duplicates the hold
  and C4 can't find/release it.
- **Never** let `writeHold` throw or block the verify response — it's
  best-effort; a hold hiccup must not fail a payment that already verified.
- **Never** skip the self-excluding overlap re-guard at checkout — a second
  block on the same unit/nights could reach `owned` and double-sell the room.
- **Never** narrow the verify PATCH's ownership set — always
  `investor_user_id=in.(resolveOwnerIdsCrossPool ids)`, or a cross-pool
  identity can't complete its own purchase.

### C2 boundary — STOP
C2 is purchase + hold only. **Do NOT start C3 (resale listing + consumer-feed
exposure + settlement) without Sachin's "continue".** C3 → C4 each verify live
+ stop at their own sub-phase boundary, same as C1/C2 + the Channel Manager
phases.

---

## §8 — Phase C3: Resale Listing + Consumer Feed + Settlement (v329, 2026-07-12)

C3 takes a C2 `owned` block, lets the investor **list** it at a resale price on
the SAME customer feed as flash deals, and settles the sale: customer pays the
resale total → block `sold` → an `inventory_sales` ledger row freezes the
StayBid fee + investor net. StayBid holds the resale total and **owes** the
investor their net (`payout_status='owed'`); actual payout execution is C4.

### Migration `2026-07-12-v329-phase-c3-inventory-sales.sql` (applied live)
NEW `inventory_sales` settlement ledger (one row per resale sale):
`block_id`, `hotel_id`, `unit_id`, `room_id`, `investor_user_id` (who gets the
net), `buyer_user_id`/`buyer_name`/`buyer_phone`, `date_from`/`date_to`/`nights`,
`resale_per_night`/`resale_total` (what the customer pays), `buy_total` (cost
snapshot), `platform_fee_pct`/`platform_fee` (StayBid's cut), `investor_net`
(resale − fee − buy), razorpay ids, `status` ∈ {pending_payment, paid, refunded,
cancelled}, `payout_status` ∈ {owed, paid}, `paid_at`, `metadata`, timestamps.
5 indexes (block, investor+status, buyer, order) + a **UNIQUE partial index
`uniq_inv_sales_block_paid` on (block_id) WHERE status='paid'** — one paid sale
per block. RLS permissive `inventory_sales_all_anon`.
`inventory_blocks` already carries `listed_at`/`sold_at`/`resale_price_per_night`/
`platform_fee_pct` (C1) → **no block-schema change** for the listing state machine.

### Routes (4 files, all NEW, additive)
- **`POST/DELETE /api/circle/inventory/[id]/list`** — investor lists / re-prices
  (`owned|listed → listed`, resale > 0 ≤ 1,000,000, `date_to` future) / unlists
  (`listed → owned`). Owner-verified via `resolveOwnerIdsCrossPool` + `ownedUnit`.
- **`GET /api/circle/resale`** — PUBLIC consumer feed. Every `status=eq.listed`
  block with `resale_price_per_night=gt.0 & date_to=gt.today`, enriched with
  hotels (**`approval_status=eq.approved` ONLY** — a pending hotel can't surface)
  + rooms via manual `?id=in.(…)` side-loads (NO PostgREST FK embed). Discount
  computed vs `metadata.suggestedResaleTotal`. `Cache-Control: no-store`.
- **`POST /api/circle/resale/[id]/checkout`** — customer (`userFromReq`) buys a
  listed block. Loads it (must be `listed`, future-dated), computes the resale
  total **SERVER-SIDE** via `resaleMargin` (client NEVER sets ₹), creates a
  Razorpay order (`notes.kind='circle_resale'`), writes an `inventory_sales`
  **pending** row freezing the settlement split (fee + investor net). Block stays
  `listed` until verify.
- **`POST /api/circle/resale/[id]/verify`** — HMAC-verifies (shared
  `/api/razorpay/verify`), then: (1) flips the sale `pending_payment → paid`
  matched on `razorpay_order_id + block_id + buyer + status=eq.pending_payment`;
  (2) flips the block `listed → sold` guarded on `status=eq.listed` (anti-
  double-sell + idempotent); (3) best-effort refreshes the pre-buy `room_blocks`
  hold note. Leaves the hold in place — the room is now a paid resale guest.

### Client UI (all NEW / additive)
- **`components/circle/ResaleOffers.tsx`** — one-line mount on `/flash-deals`;
  fetches `/api/circle/resale?city=`, renders horizontal cards + reserve modal +
  Razorpay flow (`openRazorpayForOrder` / `RazorpayError`), success modal.
  Renders `null` when `!loaded || offers.length===0` (zero-regression).
- **`components/partner/CircleInventoryTab.tsx`** — `listResale`/`unlist`
  handlers + owned/listed/sold block-row UI.
- `app/flash-deals/page.tsx` mounts `<ResaleOffers city={city} />`.

### Settlement math (`resaleMargin`, `lib/inventory/engine.ts` — shared)
`resaleTotal = resalePerNight × nights` · `feeTotal = round(resaleTotal ×
feePct/100)` · `buyTotal = buyPerNight × nights` · `investorNet = resaleTotal −
feeTotal − buyTotal`. `PLATFORM_RESALE_FEE_PCT_DEFAULT = 12` (⚠ flagged —
wire to `service_pricing` with C4). The SAME function powers the checkout freeze
+ the client preview → preview == charge.

### Verified (live round-trip, cleaned up — 0 leftover)
Synthetic host-circle **approved** hotel + owned unit on real room `ris04-r1` +
a `listed` block (3n, buy ₹4,200/n, resale ₹5,000/n, fee 12%). **All 5 asserts
PASSED:** (A) resale feed SELECT surfaces the block (`feed_hit=1`) only because
the hotel is approved; (B) checkout writes an `inventory_sales` pending row with
`split_frozen_ok` — resale ₹15,000 / fee ₹1,800 / buy ₹12,600 / net ₹600, and
`investor_net = resale − fee − buy`; (C) verify flips sale → `paid` + block →
`sold` (`verify_ok=true`), StayBid keeps ₹1,800, `payout_status='owed'` owes
investor ₹600; (D) a second `paid` row for the block is rejected by
`uniq_inv_sales_block_paid` (`dup_row_landed=0`, `paid_rows_for_block=1`) and a
re-verify block-flip is a no-op (`reverify_would_flip=0`, idempotent). All test
rows deleted. `tsc --noEmit` clean, `next build` green (all 4 routes compiled).
`SB_BUILD v328→v329`, badge v329, `HTML_CACHE v141→v142`.

### Things to Avoid (Phase C3)
- **Never** let the client set the resale ₹ at checkout — the checkout route
  re-computes `resaleTotal` from the block via `resaleMargin` and writes the
  frozen split; verify never trusts a client amount (C1/C2 tamper-safe
  discipline).
- **Never** flip a block to `sold` without the `status=eq.listed` guard — it's
  the anti-double-sell + idempotency gate. A 0-row flip means already-sold (a
  re-verify) → do NOT re-settle.
- **Never** mark a sale `paid` without matching on `razorpay_order_id + block_id
  + buyer + status=eq.pending_payment` — that 4-key filter + the
  `uniq_inv_sales_block_paid` unique index are the anti-tamper + one-sale-per-
  block guarantees. On a 0-row match, re-fetch the paid row for the summary.
- **Never** surface a resale offer from a NON-approved hotel — the feed joins
  `hotels?…&approval_status=eq.approved`; an unapproved hotel's block must not
  reach the customer.
- **Never** compute the resale split outside `resaleMargin` — the checkout freeze
  and the client preview MUST share it so preview == charge.
- **Never** delete/release the pre-buy `room_blocks` hold on sale — the room is
  now a paid resale guest; verify only refreshes the hold note.
- **Never** execute a payout in C3 — C3 only RECORDS the obligation
  (`payout_status='owed'`); actual payout + reconciliation is C4.

### C3 boundary — STOP
C3 is resale listing + consumer feed + settlement-ledger only. **Do NOT start C4
(dynamic discount / expiry sweep / optional platform buyback + admin oversight)
without Sachin's "continue".** Same discipline as C1/C2 + the Channel Manager
phases.

---

## §9 — Phase C4: Dynamic Markdown + Expiry Sweep + Buyback + Admin (v330, 2026-07-13)

C4 closes Model 3: a lifecycle cron that auto-discounts listed blocks as
check-in nears + expires the unsold, an investor opt-in platform buyback, and a
full admin oversight surface for both settlement obligations. **NO migration** —
the `buyback_enabled` column + `metadata` JSONB + `expired`/`refunded` statuses
all already existed from C1; C4 is code-only.

### The two lifecycle passes (`/api/cron/inventory-lifecycle`, GET+POST)
Auth mirrors `/api/cron/expire-holds` (`?token=` / Bearer `CRON_SECRET` /
`adm_` x-admin token). Budget 24s, ≤200 rows/pass, per-pass bounded.
- **Markdown pass** — `status=eq.listed & date_from` in `[today, today+14]`.
  For each block: `original = round(metadata.listResalePerNight ?? resale_price_per_night)`
  (frozen baseline, backfilled from current price for pre-C4 listings);
  `daysOut = daysUntil(date_from)`; tiers **≥15→0% · ≥8→10% · ≥4→20% · ≥2→30%
  · else 40%**; `perNight = max(round(buy_price_per_night), round(original ×
  (1−pct)))` — **NEVER below buy cost**. Recomputed from the frozen baseline so
  re-runs converge + never compound; idempotent no-op skip when the price + pct
  already match. PATCH guarded on `status=eq.listed`.
- **Expiry pass** — `status=in.(owned,listed) & date_from < today` → `expired`
  + `metadata.expiredAt/expiredReason='stay_started_unsold'` + `releaseHold`
  (`DELETE room_blocks?id=eq.invhold_<blockId>` — deterministic C2 hold id).

### Investor buyback toggle
`PATCH /api/circle/inventory { id, buybackEnabled }` — owner-verified
(`resolveOwnerIdsCrossPool`), guarded on `status=in.(owned,listed) &
investor_user_id ownership`. When on, StayBid MAY buy the block back near
check-in if it stays unsold — the investor recovers their wholesale cost instead
of the block expiring worthless. UI: an optimistic checkbox on owned/listed rows
in `CircleInventoryTab`; a `−N% auto` badge (with struck-through original) shows
on listed rows once the cron has marked one down.

### Admin oversight
`/admin/circle-inventory` (sidebar "🧾 Circle Inventory") + `/api/admin/circle-inventory`
(`adminFromReq` + `logAdminAction`):
- **GET** — blocks + sales + KPIs (`investorOwed`, `investorPaid`, `platformFees`,
  `gmv`, `byStatus`, `buybackOwed`), hotels/units/users side-loaded (NO PostgREST
  FK embed).
- **POST** — `force_expire` (owned|listed→expired+releaseHold) · `buyback`
  (requires `buyback_enabled`; owned|listed|expired→refunded, amount defaults
  `buy_total`, +`metadata.buyback` +`buybackPayoutStatus='owed'` + releaseHold) ·
  `mark_payout_paid` (`inventory_sales` status=paid & payout_status=owed→paid) ·
  `mark_buyback_paid` (block refunded & `metadata.buybackPayoutStatus` owed→paid).

### Verified (live round-trip, cleaned up — 0 leftover)
Synthetic host-circle hotel + owned unit on a real room + a listed block 5 days
out (→ 20% tier), original ₹5000/n, buy ₹4200/n. **All asserts PASSED:**
**(A markdown)** 20% off ₹5000 = ₹4000 → floored at ₹4200 buy cost
(`a1_floored_at_cost`), pct + original frozen, non-floored math (6000@20%→4800)
correct, idempotent-skip TRUE. **(B expiry)** date_from<today → `expired` +
reason set + hold released. **(C toggle)** `buyback_enabled=true` (fired D).
**(D admin buyback)** → `refunded` + `metadata.buyback.amount=buy_total` +
`buybackPayoutStatus='owed'` + hold released. **(E settle)** `mark_buyback_paid`
→ `buybackPayoutStatus='paid'`; `mark_payout_paid` → `inventory_sales.payout_status='paid'`.
All test rows deleted (0 leftover). `tsc` clean, `next build` green (all 3 C4
routes compiled). `SB_BUILD v329→v330`, badge v330, `HTML_CACHE v142→v143`.

### Things to Avoid (Phase C4)
- **Never** mark a listed block down below its buy cost — the floor
  (`max(buyPerNight, marked)`) is the investor's protection; a below-cost resale
  would sell them into a loss they never agreed to.
- **Never** recompute the markdown from the CURRENT `resale_price_per_night` —
  always from the frozen `metadata.listResalePerNight` baseline, or successive
  cron runs compound the discount (20% of 20% of …) into oblivion.
- **Never** drop the idempotent no-op skip in the markdown pass — the cron runs
  every 15 min; without the skip it PATCHes every listed block every run.
- **Never** run a platform buyback without `buyback_enabled=true` — it's an
  investor opt-in. The admin `buyback` action + the cron both check the flag.
- **Never** let `releaseHold` failure block a status flip — expiry/buyback flip
  the block first, then best-effort release the hold (C2 discipline).
- **Never** compute settlement obligations outside the ledger — `inventory_sales`
  (resale payout) + `metadata.buyback` (buyback payout) are the two records;
  admin actions only flip `owed→paid`, never invent amounts.
- ⚠ **SACHIN ACTION:** register the cron on cron-job.org —
  `*/15 * * * *` → `https://www.staybids.in/api/cron/inventory-lifecycle?token=staybid-cron-dev`.

### C4 boundary — STOP
C4 completes Model 3 (pre-buy commerce). **Do NOT start Phase D (Model 4 B2B
exchange) without Sachin's "continue".** Same discipline as C1/C2/C3 + the
Channel Manager phases.

---

## Phase D1 — Model 4 B2B Exchange Foundation (v331, 2026-07-13)

Model 4 = intermediary commerce (a B2B exchange). An investor who OWNS Model-3
inventory (an `inventory_blocks` row in `owned` status — bounded date-range
goods, SEBI-safe) LISTS it at their own B2B ask; ANOTHER investor buys it.
StayBid is the platform + takes a fee. B2B-only (no retail) → far from SEBI/CIS.

**D1 is the INERT ADDITIVE FOUNDATION only** (mirrors C1): schema (3 tables) +
pure fee engine + owner-scoped listing CRUD + investor UI. **NO trade
execution, NO Razorpay, NO ownership transfer, NO settlement, NO marketplace
browse** — those are D2/D3/D4.

### Migration `2026-07-13-v331-phase-d1-b2b-exchange.sql` (applied live)
Three tables — only `b2b_listings` is written by D1; the other two are
created-but-unused (future-proof, mirrors C1's unused razorpay columns):
- **`b2b_listings`** (`b2bl_` ids) — the offer. `block_id`, `seller_user_id`
  (= block's `investor_user_id`), hotel/unit/room, date range, `nights`,
  `ask_per_night`/`ask_total`, `buy_total` (cost snapshot), `platform_fee_pct`
  (FROZEN server-side), `status` ∈ {draft,listed,sold,cancelled,withdrawn,
  expired} DEFAULT listed, `metadata`. `b2b_listings_range_chk` (date_to >
  date_from AND nights > 0). 4 indexes + **`uniq_b2b_listing_active_block`
  UNIQUE (block_id) WHERE status IN (draft,listed)** — at most ONE active
  listing per owned block.
- **`b2b_trades`** (`b2bt_` ids, D2/D3) — buyer purchase; `uniq_b2b_trade_
  listing_completed` UNIQUE (listing_id) WHERE status='completed' (a listing
  sells once) + 4 indexes.
- **`settlement_ledger`** (`setl_` ids, D3) — generic money-routing record
  (generalises `inventory_sales.payout_status`); `uniq_settlement_kind_ref`
  UNIQUE (kind, ref_id) — double-settle guard.
All 3 RLS-enabled with permissive `*_all_anon` policies (project baseline).

### Fee convention (locked at D1)
Buyer pays the ask total; the platform fee is StayBid's cut OUT of that; the
seller receives the remainder. `b2bTradeSplit(lib/b2b/engine.ts)`:
`askTotal = round(askPerNight × nights)` · `platformFee = round(askTotal ×
feePct/100)` · `sellerNet = askTotal − platformFee` · `sellerMargin = sellerNet
− buyTotal`. `B2B_FEE_PCT_DEFAULT = 8` (⚠ flagged — LOWER than the 12% consumer
resale fee because it's wholesale B2B; wire to `service_pricing` before D3).
The ask is **seller-set** (their own goods — unlike Model 3 where the wholesale
BUY is Spine-frozen); the platform fee % is **server-frozen** (tamper-safe).
Pure engine shared by the listing endpoint + future D3 checkout + client UI so
preview == charge == settlement.

### Files (all NEW, additive)
- `lib/b2b/engine.ts` — pure fee math (no I/O). `b2bTradeSplit`,
  `isValidAskPerNight`, status/fee constants.
- `app/api/b2b/listings/route.ts` — owner-scoped. GET (caller's listings,
  side-load unit#/hotel name — NO FK embed, + live split) · POST (`{blockId,
  askPerNight}`: ownership via `resolveOwnerIdsCrossPool` + `ownedBlock`;
  requires block `status='owned'`; rejects past-dated; freezes fee % via
  `b2bTradeSplit(..., B2B_FEE_PCT_DEFAULT)`; unique index is the final
  one-active-listing gate, 23505 → 409) · DELETE (soft-withdraw an active
  listing → `status='withdrawn'`).
- `components/partner/CircleInventoryTab.tsx` — B2B Exchange section under
  "My Rooms" (operator-only): per-owned-block "List on exchange" ask input +
  "⇄ On exchange" pill / withdraw.

### Verified (live round-trip, cleaned up — 0 leftover)
Synthetic host-circle hotel + owned unit (`v331-seller`) + an `owned`
`inventory_blocks` block (3n, buy ₹12,600). **All 4 asserts PASSED:**
**(A)** POST split frozen correct — ask 6000/n × 3 = ask_total ₹18,000, fee 8%
= ₹1,440, sellerNet ₹16,560, sellerMargin ₹3,960 (net − buy). **(B)** a 2nd
active listing on the same block rejected by `uniq_b2b_listing_active_block`
(0 leaked). **(C)** DELETE soft-withdraws (`status='withdrawn'`). **(D)** a
fresh listing on the now-inactive block is allowed (index only guards
draft|listed). Test rows deleted (0 leftover). `tsc --noEmit` clean, `next
build` green (`/api/b2b/listings` compiled). `SB_BUILD v330→v331`, badge v331,
`HTML_CACHE v143→v144`.

### Things to Avoid (Phase D1)
- **Never** compute the B2B split outside `lib/b2b/engine.ts` — the listing
  endpoint, the D3 checkout, and the client preview MUST share it so
  preview == charge == settlement.
- **Never** let the client set `platform_fee_pct` — the POST freezes it from
  `B2B_FEE_PCT_DEFAULT` server-side. (The ask IS seller-set — the seller's own
  goods — but the platform fee is StayBid's, so it's server-frozen.)
- **Never** list a block that isn't `status='owned'` — the owner must have
  bought it (C2) first; the POST 409s otherwise. `owned` blocks are naturally
  mutually-exclusive with consumer-`listed` blocks (different status), so a
  stale-listing cross-guard (consumer-list ↔ B2B-list) is a D2/D3 concern,
  harmless in inert D1.
- **Never** drop `uniq_b2b_listing_active_block` — it's the one-active-listing-
  per-block gate; the route pre-checks for a friendly error, but the index is
  the final race-safe gate (23505 → 409).
- **Never** write to `b2b_trades` / `settlement_ledger` in D1 — they are
  created-but-unused until D2/D3. D1 writes ONLY `b2b_listings`.
- **Never** point a `seller_user_id` / unit / hotel side-load at a PostgREST FK
  embed — no FK exists; manual `?id=in.(…)`.

### D1 boundary — STOP
D1 is the inert B2B foundation. **Do NOT start D2 (trade checkout + Razorpay +
ownership transfer) without Sachin's "continue".** Same discipline as C1–C4 +
the Channel Manager phases.

---

## Phase D2 — Model 4 B2B Trade Checkout + Ownership Transfer + Settlement (v332, 2026-07-13)

Second sub-phase of Model 4. Turns a D1 `listed` `b2b_listings` row into a
COMPLETED `b2b_trades` row via a tamper-safe Razorpay checkout, TRANSFERS the
commercial right (`inventory_blocks.investor_user_id` seller → buyer), and
records the seller's owed net in `settlement_ledger`. **NO marketplace browse
UI (D3), NO dynamic/admin (D4).** No migration (D1's `b2b_trades` +
`settlement_ledger` tables already exist).

### The ownership-transfer model (locked)
Only `inventory_blocks.investor_user_id` moves seller → buyer — the date-range
COMMERCIAL right. `hotel_room_units.owner_user_id` does NOT change (keeps the
SEBI-safe bounded-goods model + the buyer never becomes the physical-unit
owner). Buyer id = the caller's PRIMARY JWT userId (always inside their
`resolveOwnerIdsCrossPool` set, so cross-identity lookups still resolve the
block). The buyer can then C3-resell / C4-buyback the block exactly as if they
had C2-bought it.

### Fee convention (D1's `b2bTradeSplit`, unchanged)
Buyer pays `askTotal`; `platformFee = round(askTotal × feePct/100)` is StayBid's
cut OUT of the ask; `sellerNet = askTotal − platformFee`. The listing's frozen
`platform_fee_pct` (set at D1 list time) is what verify settles on — never
re-read from config. `B2B_FEE_PCT_DEFAULT = 8` (⚠ flagged — wire to
`service_pricing`).

### Routes (all NEW, additive; both trade routes owner/buyer-verified)
- **`POST /api/b2b/listings/[id]/checkout`** — buyer-side. `auth → buyerIds`
  via `resolveOwnerIdsCrossPool`; load listing (must be `status='listed'`);
  reject `isBuyer(seller_user_id)` (own listing → 409); reject `date_to <=
  today`; load block (must be `status='owned'` AND `investor_user_id ===
  listing.seller_user_id`); `split = b2bTradeSplit(...)` from the listing's
  frozen fields; Razorpay order via `${origin}/api/razorpay/order`
  (`amount: split.askTotal`, `receipt: cb2b_<listingId>`,
  `notes:{kind:"circle_b2b",listingId,blockId,buyerId}`); INSERT `b2b_trades`
  (`id: genId("b2bt")`, `buyer_user_id: primary userId`, `status
  pending_payment`, `metadata:{checkoutAt,buyPhone}`). Returns
  `{ok, keyId, order, tradeId, askTotal}`. **Client never sets ₹.**
- **`POST /api/b2b/listings/[id]/verify`** — HMAC via `${origin}/api/razorpay/
  verify` (400 mismatch / 502 unreachable), then five steps:
  1. PATCH `b2b_trades` → `completed` matched on `razorpay_order_id +
     listing_id + buyer_user_id IN (ids) + status=eq.pending_payment` (4-key
     anti-tamper + idempotent; re-verify falls back to fetch the completed row;
     502 only if no trade found). The `uniq_b2b_trade_listing_completed` UNIQUE
     index keeps it one-per-listing.
  2. TRANSFER — PATCH `inventory_blocks.investor_user_id` seller → buyer guarded
     on `investor_user_id=eq.sellerId` (a re-verify / race flips 0 rows = no-op;
     `transferred` captured). Only the block's commercial right moves.
  3. Flip listing `listed → sold` guarded `status=eq.listed`.
  4. INSERT `settlement_ledger` (`id: genId("setl")`, `kind='b2b_trade'`,
     `ref_id=trade.id`, `payee=sellerId`, `gross=ask_total`, `platform_fee`,
     `net=seller_net`, `payout_status='owed'`) with `Prefer: resolution=
     ignore-duplicates,return=minimal` (`uniq_settlement_kind_ref` idempotency).
  5. Best-effort refresh the pre-buy `room_blocks?id=eq.invhold_<blockId>` note
     + `createdBy=buyerId` so ops see the new owner.
  Returns `{ok, transferred, trade:{id,dateFrom,dateTo,nights,askTotal,sellerNet}}`.
- **`GET /api/b2b/trades[?hotelId=X]`** — the caller's trades as BUYER (blocks
  acquired) + as SELLER (blocks sold), `status in.(pending_payment,completed)`,
  cross-pool scoped, side-load unit#/hotel name (NO FK embed). Returns
  `{asBuyer, asSeller}`.

### Client UI (`components/partner/CircleInventoryTab.tsx`)
Read-only **"⇄ Exchange trades · Model 4"** subsection (renders only when trades
exist) — `asSeller` then `asBuyer` mapped to `<TradeRow>` (Sold/Bought pill +
status pill + `#unit` + dates + "you get {sellerNet}" for seller / "paid
{askTotal}" for buyer). The buy-side marketplace browse + Razorpay flow is D3.

### Verified (live round-trip, cleaned up — 0 leftover)
Seeded `inventory_blocks blk_v332test` (status=owned, investor=`v332-seller`) +
`b2b_listings lst_v332test` (status=listed, ask 6000/n × 3, fee 8%) +
`b2b_trades trd_v332test` (pending), mirrored checkout+verify. **All 13 asserts
PASSED:** `trade_completed=1 · trade_ask_total=18000 · trade_fee=1440 ·
trade_seller_net=16560 · block_owner_after=v332-buyer · block_status=owned ·
listing_status=sold · settle_rows=1 · settle_net=16560 · settle_payout=owed ·
transfer_rows=1 · reverify_transfer_rows=0 (idempotent no-op) ·
dup_completed_landed=0 (`uniq_b2b_trade_listing_completed` held)`. Test rows
deleted (0 leftover). `tsc --noEmit` clean, `next build` green (all 3 routes
compiled). `SB_BUILD v331→v332`, badge v332, `HTML_CACHE v144→v145`.

### Things to Avoid (Phase D2)
- **Never** let the client set the ask ₹ at checkout — the checkout route reads
  the listing's frozen `ask_per_night`/`platform_fee_pct` and `b2bTradeSplit`s
  server-side; verify never trusts a client amount.
- **Never** mark a trade `completed` without the 4-key PATCH filter
  (`razorpay_order_id + listing_id + buyer_user_id ownership +
  status=eq.pending_payment`). A 0-row flip = already-processed OR not-yours →
  re-fetch the completed row for the summary; do NOT re-charge / re-transfer.
- **Never** transfer `hotel_room_units.owner_user_id` — ONLY
  `inventory_blocks.investor_user_id` moves (the commercial right). The physical
  unit owner is untouched (SEBI-safe bounded goods).
- **Never** transfer the block without the `investor_user_id=eq.sellerId` guard
  — it makes a re-verify / race a 0-row no-op. `transferred` reflects the real
  flip.
- **Never** compute the split from config at settlement — use the listing's
  FROZEN `platform_fee_pct` (set at D1 list time) so preview == charge ==
  settlement even if the default fee changes later.
- **Never** drop `uniq_b2b_trade_listing_completed` / `uniq_settlement_kind_ref`
  — they are the one-completed-per-listing + one-ledger-row-per-trade guards
  that make verify idempotent.
- **Never** point a `seller`/`buyer`/unit/hotel side-load at a PostgREST FK
  embed — no FK exists; manual `?id=in.(…)`.

### D2 boundary — STOP
D2 completes the B2B trade + ownership transfer + settlement obligation. **Do
NOT start D3 (B2B marketplace browse + buy button + payout execution) without
Sachin's "continue".** Same discipline as C1–C4 + the Channel Manager phases.

---

## Phase D3 — B2B Marketplace Browse + Buy Button + Payout Execution (v333)

Third sub-phase of Model 4. D1 built the listing foundation, D2 built the trade
checkout + ownership transfer + settlement obligation. **D3 surfaces the
marketplace so investors can DISCOVER + buy another investor's listing, and
gives the admin a payout-execution surface to clear the `settlement_ledger`
obligations recorded by D2.** No migration (D1's three tables cover everything);
additive UI + one new read route + admin payout action.

### The marketplace read route (`GET /api/b2b/marketplace`)
Investor-facing browse. Owner-scoped via `resolveOwnerIdsCrossPool` (the caller
must be a real investor identity). Query:
`status=eq.listed & date_to=gt.<todayISO> & seller_user_id=not.in.(<ownerIds>)`
— shows every OTHER investor's live, future-dated listing; the caller's own
listings are excluded (you buy on the marketplace, you sell in your own B2B
Exchange section). Ordered `ask_total.asc` (cheapest first), cap 120 → side-load
unit# (`hotel_room_units?id=in.(…)`) + hotel name/city (`hotels?id=in.(…)`, NO
FK embed), map each with `b2bTradeSplit` (so the buyer sees ask_total + the fee
split preview), optional in-memory `city` filter, `slice(0, 60)`. Empty
`ownerIds` → `{listings:[]}` (a non-investor sees nothing).

### The buy button (`components/partner/CircleInventoryTab.tsx`)
New **"🛒 Buy from the exchange · Model 4"** section (renders only when
`market.length > 0`), placed BEFORE the D2 "Exchange trades" subsection.
`loadMarket()` fetches `/api/b2b/marketplace?hotelId=`; each card shows unit# +
dates + per-night + ask_total + a "Buy block" button → `buyExchange(l)`:
POST `/api/b2b/listings/[id]/checkout` (D2 route) → `openRazorpayForOrder(order)`
(`RazorpayError('__CANCELLED__')` catch) → POST `/api/b2b/listings/[id]/verify`
(D2 route) → flash "Block acquired ✓" + refresh `loadBlocks() / loadTrades() /
loadMarket() / loadB2b()`. The whole checkout+verify+transfer chain is D2's — D3
only adds the discovery surface + the button that drives it.

### Payout execution (admin — `/admin/circle-inventory` + `/api/admin/circle-inventory`)
D2 recorded `settlement_ledger` rows (`kind='b2b_trade'`, `payout_status='owed'`)
but nothing cleared them. D3 adds the admin payout surface:
- **GET** — the existing parallel-fetch extended with `settlements`
  (`kind=eq.b2b_trade&order=created_at.desc&limit=200`) + `settleAgg`
  (`kind=eq.b2b_trade` amounts, `limit=2000`) → derives 4 KPIs
  (`b2bOwed / b2bPaid / b2bFees / b2bGmv`). Settlements side-load their trade via
  `b2b_trades?id=in.(<ref_ids>)` (ref_id join, NO FK embed) → `enrichSettlement`
  resolves hotel_name / unit_number / dates / nights / seller_name / seller_phone.
- **POST `mark_settlement_paid { settlementId }`** — loads
  `settlement_ledger?id=eq.X&kind=eq.b2b_trade`, PATCHes
  `id=eq.X & kind=eq.b2b_trade & payout_status=eq.owed` →
  `{payout_status:'paid', paid_at, metadata:{…,payoutPaidAt,payoutPaidBy}, updated_at}`.
  A 0-row flip → 409 "already paid" (idempotent). `logAdminAction`
  `circle_inventory.settlement_paid`.
- **`/admin/circle-inventory` page** — 2 new KPI cards ("Exchange seller owed" ₹
  gold / "Exchange settled" ₹ green) + a "⇄ Exchange payouts owed to sellers ·
  Model 4" table (Hotel·Unit / Seller / Dates / Buyer paid / Fee / Seller net /
  When / Mark paid → `act({action:'mark_settlement_paid', settlementId})`).

### Verified (live round-trip, cleaned up — 0 leftover)
Seeded `b2b_listings lst_v333test` (status=listed, seller=`v333-seller`,
date_to=+23d, ask 6000/n × 3, fee 8%) + `b2b_trades trd_v333test` (completed,
buyer=`v333-buyer`) + `settlement_ledger setl_v333test` (b2b_trade, owed,
net 16560). **All asserts PASSED:** `a_buyer_sees=1` (marketplace filter surfaces
the listing to `v333-buyer`) · `b_seller_excluded=0` (`seller_user_id NOT IN
(v333-seller)` correctly hides the seller's own listing) · `c_trade_buyer=
v333-buyer` (settlement→trade resolves via ref_id side-load) · `d_status_before=
owed`. Payout PATCH as two sequential statements (faithful two-click mirror):
first run flipped `owed→paid` + `paid_at` set + `payoutPaidBy=v333-admin`;
idempotent re-run (guard `payout_status=eq.owed`) matched 0 rows (route 409
"already paid"). Test rows deleted (settle/trade/listing all 0). `tsc --noEmit`
clean, `next build` green (`/api/b2b/marketplace` compiled). `SB_BUILD v332→v333`,
badge v333, `HTML_CACHE v145→v146`.

### Things to Avoid (Phase D3)
- **Never** show the caller's OWN listings on the marketplace — the query MUST
  keep `seller_user_id=not.in.(<ownerIds>)`. You buy others' inventory on the
  marketplace; you sell yours in the B2B Exchange section.
- **Never** re-implement the buy chain in D3 — `buyExchange` calls the D2
  checkout + verify routes verbatim (server re-quotes the frozen ask, transfers
  the block, records the settlement). D3 adds only the discovery card + button.
- **Never** compute the payout amount at settlement time — the admin
  `mark_settlement_paid` action only flips `owed→paid`; the ₹ was frozen by D2
  into `settlement_ledger.net_amount`. Admin never edits amounts.
- **Never** drop the `payout_status=eq.owed` guard on the payout PATCH — it is
  the idempotency gate. A 0-row flip means already-paid → 409, do NOT re-pay.
- **Never** point the settlement→trade side-load at a PostgREST FK embed — no FK
  exists; manual `b2b_trades?id=in.(<ref_ids>)` keyed on `settlement_ledger.ref_id`.
- **Never** surface a payout as executed money movement — `mark_settlement_paid`
  is a RECORD-KEEPING flip (like C4's `mark_payout_paid`). Actual bank transfer
  is an ops action outside the app; the ledger tracks the obligation + its
  cleared state.

### D3 boundary — STOP
D3 completes the B2B marketplace + buy button + payout-execution record-keeping.
**Do NOT start D4 (dynamic B2B pricing / admin B2B oversight) — or Phase E
(Model-1 expected-only language) / Phase F (operated supply growth) — without
Sachin's "continue".** Same discipline as C1–C4 + D1–D2 + the Channel Manager
phases.
