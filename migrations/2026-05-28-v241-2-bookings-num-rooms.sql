-- v241.2 — Denormalize numRooms on bookings table.
--
-- APPLIED LIVE to Supabase project uxxhbdqedazpmvbvaosh on 2026-05-28 via
-- MCP apply_migration `v241_2_bookings_num_rooms`.
--
-- Background:
--   v241 added numRooms to bid_requests + bids (the bidding lifecycle).
--   Bookings table (Railway/Prisma managed, customer flow inserts via
--   Railway side) lacked the column entirely. Partner payouts + admin
--   finance + refund math had to 3-hop join bookings → bids → bid_requests
--   to figure out how many rooms each booking represented.
--
-- This migration denormalizes numRooms onto the bookings row directly.
-- Once Railway-side Prisma is regenerated (separate session), new booking
-- inserts will populate from the bid's numRooms. Until then, all NEW
-- bookings get DEFAULT 1, which exactly matches pre-v241 single-room
-- behavior. Legacy rows also read as 1.
--
-- Additive only. Forward-only. CHECK 1-10 mirrors the v241 bid CHECKs.

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS "numRooms" INTEGER NOT NULL DEFAULT 1
    CHECK ("numRooms" BETWEEN 1 AND 10);

COMMENT ON COLUMN public.bookings."numRooms" IS
  'Multi-room count for this booking. v241.2 denormalized so partner payouts, refunds, and admin finance do not need a 3-hop join through bid -> bid_request -> bid.numRooms. Defaults to 1 for legacy rows.';

-- Verification after apply:
--   SELECT column_name, data_type, column_default
--     FROM information_schema.columns
--    WHERE table_schema='public' AND table_name='bookings' AND column_name='numRooms';
-- Expected: data_type='integer', column_default='1'.
