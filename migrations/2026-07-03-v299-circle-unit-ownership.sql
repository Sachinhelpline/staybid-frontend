-- v299 — StayCircle unit-level ownership (multi-investor per hotel).
--
-- The crux Sachin raised: one hotel can have MANY owners/operators, each owning
-- DIFFERENT physical rooms. A booking must route to the RIGHT owner, and the
-- customer must not have to know which physical room they got.
--
-- Solution: physical rooms already exist (`hotel_room_units` = 101, 102 …) and
-- bookings are already assigned to a specific unit (`room_blocks.assignedUnitId`).
-- We add an OWNER to each physical unit. Then:
--   • Customer books a CATEGORY (Deluxe) — unchanged, standard hotel UX.
--   • StayBid assigns the booking to a free physical unit (existing flow).
--   • That unit's owner = the booking's owner → automatic attribution + payout.
--   • Each investor's partner dashboard filters to THEIR units only.
--
-- ADDITIVE / zero regression: owner_user_id is nullable. NULL = StayBid-owned /
-- default (every existing unit today). The partner dashboard's existing
-- ownerId-based scoping is untouched; unit-ownership is an ADDITIONAL access
-- path (see lib/partner/operator-access.ts).

ALTER TABLE public.hotel_room_units
  ADD COLUMN IF NOT EXISTS owner_user_id TEXT;

-- Circle provenance on the unit (which bundle bought it) — audit + payout.
ALTER TABLE public.hotel_room_units
  ADD COLUMN IF NOT EXISTS circle_bundle_id TEXT;

-- "who operates which hotel" lookups from the partner resolver.
CREATE INDEX IF NOT EXISTS idx_hru_owner ON public.hotel_room_units (owner_user_id)
  WHERE owner_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_hru_circle_bundle ON public.hotel_room_units (circle_bundle_id)
  WHERE circle_bundle_id IS NOT NULL;
