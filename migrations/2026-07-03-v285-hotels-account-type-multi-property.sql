-- v285 — Multi-property partner dashboard + account_type foundation
--
-- ADDITIVE ONLY. Zero existing rows change behaviour:
--   * account_type defaults to 'hotel_owner' → every existing hotel keeps the
--     exact same partner-panel experience it has today.
--   * circle_bundle_id / circle_property_id are nullable provenance tags,
--     populated ONLY when a hotel is provisioned from a StayCircle investment
--     (Phase 2). NULL for every hotel that exists today.
--
-- Why on `hotels` (not a new table): the partner dashboard's whole scoping
-- spine is `hotels.ownerId`. A Circle investor who owns a real `hotels` row
-- inherits the ENTIRE partner panel (Bids / Rooms / Bookings / Availability /
-- Flash / F&B / Housekeeping / Channel / Subscription-billing) for free, with
-- account_type as a pure provenance/label tag — no parallel dashboard, no
-- clash, no admin confusion.

ALTER TABLE public.hotels
  ADD COLUMN IF NOT EXISTS account_type TEXT NOT NULL DEFAULT 'hotel_owner'
    CHECK (account_type IN ('hotel_owner', 'circle_operator', 'staybid_operated'));

ALTER TABLE public.hotels
  ADD COLUMN IF NOT EXISTS circle_bundle_id TEXT;

ALTER TABLE public.hotels
  ADD COLUMN IF NOT EXISTS circle_property_id TEXT;

-- Admin filtering by account type + Circle-provenance lookups.
CREATE INDEX IF NOT EXISTS idx_hotels_account_type ON public.hotels (account_type);
CREATE INDEX IF NOT EXISTS idx_hotels_circle_bundle ON public.hotels (circle_bundle_id)
  WHERE circle_bundle_id IS NOT NULL;
