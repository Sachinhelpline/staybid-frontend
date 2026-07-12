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
- [ ] **Phase B — Per-unit OTA/Airbnb cross-listing.** `channel_connections
  .unit_id` + `ota_feeds.unit_id` (NULL = hotel-level, zero regression) +
  `partnerUnitScope`; per-unit iCal export already exists
  (`/api/partner/ical/[roomId]`). Overbooking guard (v318) extended per-unit.
- [ ] **Phase C — Model 3 pre-buy inventory blocks.** `inventory_blocks`
  (owner, unit, date_from/to, buy_price from Pricing Spine, resale_price,
  status). Investor buys a date-range → sets resale → shows on the SAME
  consumer feed + OTA + B2B. Settlement: customer pays resale → StayBid fee →
  investor. Dynamic-discount / expiry / optional buyback on top.
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
