-- v301 — bids.assignedUnitId: book a SPECIFIC physical room → route to its owner.
-- APPLIED LIVE via Supabase MCP (migration `v301_bids_assigned_unit`).
--
-- When a customer bids/books an individual Airbnb-style room (a hotel_room_unit
-- owned by one investor), the bid records which unit. That unit's owner_user_id
-- IS the booking's owner — exact attribution, zero mis-routing. NULL for every
-- classic category-level bid (unchanged behaviour). Additive, no regression.

ALTER TABLE public.bids
  ADD COLUMN IF NOT EXISTS "assignedUnitId" text;

-- Operator dashboard: "bookings on MY units" lookup.
CREATE INDEX IF NOT EXISTS idx_bids_assigned_unit
  ON public.bids ("assignedUnitId")
  WHERE "assignedUnitId" IS NOT NULL;
