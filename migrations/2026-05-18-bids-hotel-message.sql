-- v145.1 — Add hotelMessage column on bids so partner-side counter offers
-- (serialized COUNTER_ADDONS catalog) can be persisted via the Supabase
-- fallback PATCH. Without this, /api/partner/bids/[id] returned "Update
-- failed" whenever Railway was cold and the fallback fired, because
-- PostgREST rejects unknown columns.
--
-- Customer my-bids/page.tsx already reads `b.hotelMessage || b.message`
-- and pipes through parseAddons() to render amenity chip pills, so adding
-- the column makes the v129 structured-addons flow fully cross-device.
--
-- Applied to production Supabase project uxxhbdqedazpmvbvaosh on
-- 2026-05-18 via Supabase MCP (apply_migration v145_bids_hotel_message).
ALTER TABLE public.bids
  ADD COLUMN IF NOT EXISTS "hotelMessage" text;
