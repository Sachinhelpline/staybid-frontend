# StayBid Circle — 3-Model Marketplace Redesign (Deep-Understanding Spec)

**Status:** SPEC / awaiting Sachin's approval of the phase plan before any code.
**Author date:** 2026-07-14. **Branch:** `claude/staybid-multi-investor-design-szfnl4`.
**This doc is the "pehle deeply samjho" deliverable.** No code, schema, or route
was changed to write it — only read-only inspection + 3 read-only SQL queries.

The rule from Sachin (verbatim intent): StayBid Circle is **purely for
investors**, 3 models. Model 1 is built correctly. Redesign Models 3 & 4 so
**all 3 investors get the SAME complete 3-step setup as Model 1** — Step 1
property select & lock → Step 2 room select & lock → Step 3 build the bundle &
pay — a **complete marketplace**. Also design **inventory provisioning (supply)**
for all 3, and let **every existing StayBid hotel owner give their inventory to
these 3 models for B2B sale**. "Pehle deeply samjho, phir ek dum perfect tarike
se build karo, bina breakdown ke, bina kuch left chhode."

---

## 1. The three investors — one mental model

All 3 investors do the SAME thing on our platform: **pre-own a kind of
inventory, then sell it on StayBid (+ other OTAs).** They differ ONLY in (a)
what they browse in Step 1, (b) what they get on purchase, and (c) what StayBid
charges them.

| | **Model 1 — Managed Income** | **Model 3 — Pre-Buy & Resell** | **Model 4 — Exchange & Resell** |
|---|---|---|---|
| Who | Passive investor | Active investor | Active investor / trader |
| **Step 1 browses** | Curated Circle properties (`circle_properties`) | **StayBid-operated properties** (host-circle) — pick dates on a yearly calendar | **B2B listings** from M1/M3 investors **+ existing hotel owners** |
| **Step 2 selects/locks** | Rooms in a property | Date-ranges + room categories at **dynamic price** | Which B2B room-night blocks to buy |
| **Step 3 build + pay** | Period-ownership bundle, StayBid manages + pays monthly | Pre-buy at wholesale, investor resells B2C | Buy the block, investor resells B2C |
| **On purchase gets** | Passive monthly payouts (no dashboard) | **Partner dashboard auth access** → sell those pre-bought rooms on StayBid + OTAs | **Partner dashboard auth access** → sell B2C on StayBid + OTAs |
| **Investor sells** | Nothing (StayBid runs it) | B2C themselves via the dashboard (+ can also list B2B into Model 4) | B2C themselves via the dashboard (+ can re-list B2B) |
| **StayBid charges** | Revenue-share / mgmt fee (existing) | **Per-model subscription/service charge** + wholesale margin | **Per-model subscription/service charge** + B2B fee |

Two flows for every model, exactly like Model 1 already has:

- **DEMAND flow (invest):** the 3-step marketplace `Step 1 → Step 2 → Step 3 →
  pay`. Model 1 = `/circle/discover` → `/circle/build`. Models 3 & 4 need the
  same shape at new `/circle/*` routes.
- **SUPPLY flow (create inventory):** like Model 1's "list your property for
  lease". Model 3's supply = StayBid-operated properties (host-circle). Model
  4's supply = B2B listings from M1/M3 investors **and any existing hotel
  owner**. This is the "har hotel owner apni inventory B2B sell ke liye de
  sake" piece — genuinely new.

---

## 2. What was built WRONG (the honest audit)

The C1–C4 (Model 3) and D1–D4 (Model 4) work shipped a **functionally correct
commerce engine** (tamper-safe checkout, inventory holds, settlement ledger,
idempotent verify, markdown/expiry cron) — but the wrong SHAPE and wrong entry
point for Sachin's vision. Three concrete faults:

### 2.1 Model 3 is operator-gated → chicken-and-egg → effectively dead
`components/partner/CircleInventoryTab.tsx` gates the entire flow behind:
```
if (!units.length) return "…becomes available once you own rooms on this hotel."
```
and `app/api/circle/inventory/route.ts` POST requires the caller to ALREADY own
a `hotel_room_units` row (`ownedUnit(unitId, ownerIds)` → 403 otherwise). **To
pre-buy you must already own units, but pre-buying is HOW you'd become an
owner.** Live proof (queried today):

```
hotels_total=35 · host_circle_hotels=0 · operated_hotels=0
units_total=204 · units_owned=0
inventory_blocks=0 · b2b_listings=0 · circle_properties=9  (Model 1 supply = live)
```

`units_owned=0` → **no investor can reach the Model-3 pre-buy at all.** It's
buried in `/partner/dashboard` "My Rooms" and requires operator status the
investor doesn't have. The vision wants the **pre-buy itself to be Step 1-3 of
an open marketplace** that GRANTS the unit + dashboard access.

### 2.2 Model 4 is B2B-only (no "any hotel owner can sell"), buried in the dashboard
D1–D4 built investor↔investor B2B: investor A owns a Model-3 block, lists it,
investor B buys it. Two gaps vs the vision:
- **Existing hotel owners cannot B2B-sell.** Vision: "sab se main ki StayBid par
  jo bhi hotel owner hai wo bhi in 3no model ko apni inventory B2B sell ke liye
  de sakta hai." A classic hotel owner (not a Circle investor, has real
  `rooms.quantity` inventory) has NO path to list room-nights into Model 4.
- **No 3-step marketplace surface.** Model 4 lives in `CircleInventoryTab`, not
  as `/circle/*` Step 1→2→3. Vision wants the same complete marketplace.

### 2.3 The hub routes Model 3 & 4 to the wrong place
`app/circle/page.tsx` (verified today, lines 322 + 336): Model 3 card → `/partner/dashboard`, Model 4 card → `/partner/dashboard`. Model 1 → `/circle/discover`. The two cards must re-route to the new `/circle/*` marketplaces.

### 2.4 What is RIGHT and MUST be reused (not rebuilt)
The commerce engine underneath is solid and stays:
- `lib/inventory/engine.ts` (pure quote/margin/markdown), `lib/inventory/quote.ts`
  (Spine wholesale/retail), the C2 tamper-safe checkout + idempotent verify +
  deterministic `invhold_<blockId>` hold, C3 resale + settlement ledger, C4
  markdown/expiry/buyback cron.
- `lib/b2b/engine.ts` (pure fee split), D2 trade + ownership-transfer + settlement,
  D3 marketplace read + payout, D4 markdown/expiry.
- The **schema stays** (`inventory_blocks`, `inventory_sales`, `b2b_listings`,
  `b2b_trades`, `settlement_ledger`). Redesign changes WHO initiates + WHAT
  surface it lives on, NOT the money math.

**Locked constraints preserved:** operated-only + owner-invisible
(`owner_type='host_circle'`, per-property `hco_<propId>` owner id); legal framing
(never "guaranteed/assured/fixed"; always "expected/based on actual bookings" —
`lib/circle/disclosure.ts`); ADDITIVE-ONLY; per-model subscription via
`hotel_services`/`service_pricing`.

---

## 3. The corrected data model (what changes, minimally)

Everything below is ADDITIVE. `inventory_blocks.unit_id` + `investor_user_id`
are **NOT NULL** — so the redesign must **auto-assign a real available unit at
checkout** (it cannot leave `unit_id` null). That's the single biggest schema
constraint driving the design.

### 3.1 Model 3 — open pre-buy that GRANTS ownership (not requires it)
- **Supply = host-circle operated hotels' units.** Model 3's Step 1 browses
  hotels where `owner_type='host_circle'` (v309/v336 provisioning). Today that's
  0 → Model 3 marketplace is empty until ops provisions properties. **This is a
  real dependency, not a bug** — surface an honest "coming soon / more
  properties being added" empty state, and it fills as ops runs Go-Live (v336).
- **New: unit auto-assignment on checkout.** New `lib/inventory/assign.ts`
  `assignFreeUnit(hotelId, roomId|category, dateFrom, dateTo)` → picks a
  `hotel_room_units` row that is FREE for the range (`unitsFreeForRange`/
  `getOccupations`, `lib/availability.ts`) and not already blocked. The C2
  checkout, instead of requiring `ownedUnit`, calls `assignFreeUnit`, sets
  `inventory_blocks.investor_user_id = buyer`, `unit_id = assigned`.
- **New: dashboard-access-on-purchase.** On C2 verify success, stamp the
  assigned `hotel_room_units.owner_user_id = buyer` → the EXISTING
  `resolveOperatedHotelIds` scope union (v309) surfaces the operated hotel on
  `/partner/dashboard` for the buyer, zero read-path change, for the pre-bought
  date-range only. (Per-unit autopilot / per-unit OTA — Circle Phase A/B — then
  scope the buyer's control to THEIR units on that hotel.)
- Result: any investor → browse operated property → pick dates on a yearly
  calendar at dynamic (Spine) price → pay wholesale → gets an owned block + unit
  + dashboard access → resells B2C (C3 `/api/circle/resale`) + can list B2B into
  Model 4 (D1).

### 3.2 Model 4 — add "any hotel owner can B2B-sell"
- D1 `b2b_listings` already keys off an owned `inventory_blocks` block. Add a
  SECOND supply source: an existing hotel owner lists **room-nights from their
  own `rooms.quantity` inventory** directly into `b2b_listings` (a "hotel-direct"
  B2B listing, `source='hotel_owner'`, no pre-bought block required — the owner
  already owns the physical rooms). Same fee engine (`b2bTradeSplit`), same
  ownership-transfer-on-buy (D2), but the "cost snapshot" = the owner's floor,
  and the physical inventory is guarded via a `room_blocks` hold on buy (not a
  block transfer).
- Model 4's Step 1 browses ALL live B2B listings (investor blocks + hotel-direct)
  → Step 2 select → Step 3 pay → buyer gets the block/hold + dashboard access +
  resells B2C.

### 3.3 Per-model subscription/service charge
Reuse `hotel_services` + `service_pricing` (v159.22 billing). Define 3 service
keys (`circle_model1` / `circle_model3` / `circle_model4`) with admin-editable
prices. The 3-step "build & pay" charges the wholesale/purchase amount AND
enrolls the investor into the per-model service (grant on verify). Model 1's
existing revenue-share is untouched.

---

## 4. Phase plan (small, verified, additive — same discipline as C1–C4 / D1–D4)

Every phase: build → live SQL round-trip → `tsc` + `next build` green → bump
`SB_BUILD`/badge/`HTML_CACHE` → STOP for Sachin's "continue".

- **Phase M0 — Hub re-route + shared 3-step shell.** `/circle` Model 3 & 4 cards
  → new `/circle/model3` + `/circle/model4`. Extract Model 1's Step-1/2/3 shell
  into a reusable layout so all 3 look identical. Honest empty states.
- **Phase M1 — Model 3 marketplace (demand).** `/circle/model3` Step 1 (browse
  operated host-circle properties) → Step 2 (yearly-calendar date-range + room
  category at Spine dynamic price) → Step 3 (build bundle + pay). Checkout auto-
  assigns a free unit + on verify stamps `owner_user_id` (dashboard access) +
  grants `circle_model3` service. Reuses C2/C3 engine.
- **Phase M2 — Model 3 supply.** Ensure ops has a clean path: host-circle
  provisioning (v309/v336) IS the supply. Add a Circle-admin surface to mark a
  provisioned hotel "available for pre-buy" + set the pre-buy inventory window.
- **Phase M3 — Model 4 marketplace (demand).** `/circle/model4` Step 1 (browse
  all B2B listings) → Step 2 → Step 3. Reuses D2/D3 engine + grants
  `circle_model4` + dashboard access on buy.
- **Phase M4 — Model 4 supply: hotel-owner B2B listing.** New listing path so
  ANY hotel owner (classic or operated) lists room-nights B2B from their own
  inventory (`source='hotel_owner'`, `room_blocks` hold on buy). This is the
  "har hotel owner B2B sell kar sake" piece.
- **Phase M5 — Per-model subscription wiring.** `hotel_services` keys +
  `service_pricing` admin editor for the 3 Circle services; grant-on-verify.
- **Phase M6 — Investor "My Circle" dashboard + legal-language sweep.** One place
  each investor sees their bundles/blocks/listings/dashboard-access + resale
  performance. Re-run the Phase-E disclosure sweep on every new surface.

**Dependencies / honest limits:** Model 3 supply is 0 until ops provisions
host-circle hotels (v336 Go-Live) — the marketplace ships with a truthful empty
state and fills as supply lands. Nothing in Model 1 changes. The commerce engine
(C2/C3/D2/D3) is reused, not rebuilt.

---

## 5. Files anticipated (populated as phases land)

- New routes: `app/circle/model3/*`, `app/circle/model4/*` (3-step each) + a
  shared step-shell component.
- New libs: `lib/inventory/assign.ts` (free-unit auto-assign), maybe
  `lib/circle/model-services.ts` (per-model service keys).
- Additive route changes: C2 checkout (auto-assign instead of require-owned),
  C2 verify (stamp `owner_user_id` + grant service), D1 listing (add
  `source='hotel_owner'` path).
- Modified (copy/route only): `app/circle/page.tsx` (Model 3/4 cards re-route).
- Migration(s): only if a new column is genuinely needed (e.g.
  `b2b_listings.source` for hotel-direct). Prefer reusing `metadata` JSONB.

## 6. Explicitly NOT touched
Model 1 (`/circle/discover`, `/circle/build`, `computeBundle`,
`circle_properties`), scoring engine, bid lifecycle, tier system, passport,
reel-dedup chain, availability engine internals, channel sync engine, host
vertical data model, and the C2/C3/D2/D3 money math (reused verbatim).

---

**Awaiting Sachin's approval of §4 phase plan before Phase M0.** Open question
for Sachin: Model 3 supply depends on ops provisioning host-circle properties
(currently 0). Confirm we ship the M3 marketplace with an honest empty state
now, and it fills as you Go-Live properties — OR do you want a seed batch of
operated properties provisioned first so M3 has visible supply on day one?
