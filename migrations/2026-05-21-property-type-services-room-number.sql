-- v170 Phase 1 — property type, hotel service capability, room number.
-- Purely additive: every column has a safe default, so every existing
-- hotel/room row + every existing query keeps working unchanged.
-- Applied to production Supabase (uxxhbdqedazpmvbvaosh) 2026-05-21 via
-- MCP migration `v170_property_type_services_room_number`.

ALTER TABLE public.hotels
  ADD COLUMN IF NOT EXISTS property_type  TEXT   NOT NULL DEFAULT 'hotel',
  ADD COLUMN IF NOT EXISTS meal_plans     TEXT[] NOT NULL DEFAULT '{room_only,breakfast}',
  ADD COLUMN IF NOT EXISTS addon_services TEXT[] NOT NULL DEFAULT '{}';

-- room_number — needed for video verification (a stay is verified
-- against its physical room number).
ALTER TABLE public.rooms
  ADD COLUMN IF NOT EXISTS room_number TEXT;

CREATE INDEX IF NOT EXISTS idx_hotels_property_type ON public.hotels (property_type);

-- Backfill the demo inventory so the new filters have signal:
--   property_type  — inferred from the hotel name
--   meal_plans     — by star rating
--   addon_services — by star rating
--   rooms.room_number — sequential per hotel (101, 102, …)
-- (run once; see the v170 era notes in CLAUDE.md for the exact values)
