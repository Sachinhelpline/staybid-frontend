-- v300 — Per-unit "independent listing" fields (Airbnb-style rooms within a hotel).
-- APPLIED LIVE via Supabase MCP (migration `v300_circle_unit_listings`).
--
-- Sachin's locked model: each physical room (hotel_room_units row) is an
-- INDEPENDENT bookable listing owned by ONE owner (owner_user_id, v299), with
-- its OWN price / amenities / photos / title. Different owners of the same
-- category can therefore set different prices + facilities, and the customer
-- picks a SPECIFIC room → that room's owner gets the booking (exact attribution,
-- zero mis-routing). One owner can own many rooms across many categories — each
-- room is still just one self-contained listing, so it's N-proof.
--
-- ALL columns are nullable / defaulted → zero regression. Every existing unit
-- (StayBid-owned, owner_user_id IS NULL) has no override → falls back to the
-- room CATEGORY price/amenities exactly as today. Overrides only apply to
-- circle-owned units where an investor set their own values.

ALTER TABLE public.hotel_room_units
  ADD COLUMN IF NOT EXISTS price_override numeric,          -- nightly price the owner set for THIS room; NULL = category/engine price
  ADD COLUMN IF NOT EXISTS mrp_override numeric,            -- optional strike-through MRP for THIS room
  ADD COLUMN IF NOT EXISTS title text,                      -- display title e.g. "Balcony Deluxe"; NULL = category name
  ADD COLUMN IF NOT EXISTS amenities jsonb NOT NULL DEFAULT '[]'::jsonb,  -- per-room amenities; empty = inherit category
  ADD COLUMN IF NOT EXISTS photos jsonb NOT NULL DEFAULT '[]'::jsonb,     -- per-room photos; empty = inherit category
  ADD COLUMN IF NOT EXISTS view_label text,                 -- e.g. "Pool view"
  ADD COLUMN IF NOT EXISTS is_listed boolean NOT NULL DEFAULT true,       -- owner can pause THIS room from the customer feed
  ADD COLUMN IF NOT EXISTS host_rating numeric,             -- cached per-owner behaviour rating (future reviews); NULL = new
  ADD COLUMN IF NOT EXISTS host_reviews integer NOT NULL DEFAULT 0;       -- cached review count for the trust badge

-- Customer feed: "give me every LISTED, owned, active unit for this hotel".
CREATE INDEX IF NOT EXISTS idx_hru_listed_hotel
  ON public.hotel_room_units ("hotelId")
  WHERE is_listed = true AND status = 'active';
