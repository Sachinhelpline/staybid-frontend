-- v307 Phase 2 — hospitality property-listing redesign.
-- Applied live to project uxxhbdqedazpmvbvaosh on 2026-07-07 via Supabase MCP
-- (migration name: v307_discovery_properties_rooms_hospitality).
--
-- Adds a per-category ROOM BUILDER to owner property submissions. Additive only:
--   • property-level amenities keep using the existing `amenities` jsonb column
--   • meal plans / add-ons / check-in-out / house rules / description / star
--     rating live in the existing `details` jsonb bag
--   • `rooms` is the one genuinely-new column — the Phase 4 approval->provision
--     step reads it to create real hotel rooms (+ hotel_room_units).
--
-- rooms shape: [{category,name,count,price,capacity,amenities[],images[]}]

ALTER TABLE public.discovery_properties
  ADD COLUMN IF NOT EXISTS rooms jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.discovery_properties.rooms IS
  'Hospitality room categories: [{category,name,count,price,capacity,amenities[],images[]}]. Read by admin review + Phase 4 auto-provision.';
