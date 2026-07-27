# 🚀 StayBid Circle — REAL launch inventory redesign (PLANNING)

**Status:** PLANNING / spec-gathering. Owner (2026-07-27) wants to launch the Circle-based
platform for real with a curated inventory. NOT started — build in a fresh session once the
property list + decisions below are in.

## The vision (owner's words, distilled)
Replace the scattered demo/seed inventory with a clean, **curated real launch set**:
- **1 property per city.**
- **10–12 different cities / locations** total (owner will supply the exact list).
- Each property set up for **12 months** of operation / availability.
- This is the **actual go-live of StayBid Circle** (the multi-investor operated-property
  platform), not demo data.

## What the codebase already has (reuse, don't reinvent)
- **Circle-operated hotels** = `hotels.owner_type='host_circle'`, per-property owner id
  `hco_<propId>` (never a real user id). Operated-only + owner-invisible.
- **Provisioning:** `lib/circle/provision.ts` (`provisionBundle`, `stampOwnedUnits` → stamps
  `hotel_room_units.owner_user_id` + `is_listed`).
- **Go-live gate:** `approval_status='approved'` is the SINGLE customer-feed gate. Provision as
  DRAFT; admin "Go Live" flips it (guarded `owner_type='host_circle'`).
- **Pre-buy window:** `prebuy_window_start` (incl) / `prebuy_window_end` (excl) bounds check-in.
- **Pricing spine:** `lib/pricing/spine.ts` + `room_date_price` + `/api/cron/price-spine`
  (dynamic per-date pricing, already runs).
- **Investor journeys (LOCKED contracts):** Model 1 (co-own & operate), Model 2 (buy inventory
  bundles), Model 3 (travel-agent auction). Ownership transfer moves only
  `inventory_blocks.investor_user_id`; `owner_user_id` never transfers (SEBI-safe).
- ⚠ **Money-out is inert** until RazorpayX is set up — see `docs/PENDING-RAZORPAYX-SETUP.md`.

## OPEN QUESTIONS (must answer before build)
1. **Property list** — the 10–12 cities + the 1 property each (see the data template below).
2. **Real or placeholder?** Are these physically tied-up hotels (real names/photos/rooms) or
   launch placeholders to fill later?
3. **Rooms per property** — how many room units each, and room types/categories?
4. **"12 months" meaning** — availability + dynamic pricing open for the next 12 months
   (prebuy windows spanning 12 months)? Confirm.
5. **Which Circle model is the launch hero** — Model 1 / 2 / 3, or all? Who is the primary
   investor and primary guest journey at launch?
6. **Existing demo data** — archive/hide the current seed hotels (hco-seed-*, demo listings)
   so only these 10–12 show, or coexist?
7. **Pricing** — who sets each property/room base rate (owner-set vs spine-derived)? Base
   rates per room?
8. **Investor economics** — monthly acquisition rate / purchase price per property (drives the
   Circle Model-1/3 floors, e.g. `circle_floor_multiplier` 1.20).

## Per-property data template (owner to fill, ×10–12)
```
City:
Property name:
Location / area (+ Google Maps link if any):
Star rating / positioning:
# of rooms (units):
Room categories (name · capacity · base price/night):
Images (links):
Amenities:
Monthly acquisition rate (investor cost) — for Circle floor:
Operating window: 12 months from <date>
```

## Suggested approach (to detail in the build session)
1. **Plan/design phase first** (Plan agent) — map exactly which tables + provisioning paths to
   use; decide demo-data handling; confirm it honours the LOCKED Circle contracts.
2. Build a clean **provisioning script/migration** to create the 10–12 host_circle properties
   + rooms + 12-month prebuy windows, as DRAFT.
3. Seed spine base rates → let `/api/cron/price-spine` price them.
4. Admin "Go Live" per property (approval_status=approved) when ready.
5. Wire the chosen Circle model(s) journey to this real inventory; hide/retire demo.
6. Live SQL round-trip verify each step (0 leftover), per the ship checklist.

**Next action:** owner fills the property list + answers Q4–Q8 → finalize this brief → build in
a fresh session.
