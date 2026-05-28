-- v241 — End-to-end multi-room bids + auto-fit capacity reconciliation.
--
-- Background:
--   Pre-v241, customer /bid Step 3 had `form.rooms` (1–5) but the value
--   was NEVER sent to the server. `bid_requests` had `guests` only.
--   `bids` stored `amount` as per-room-per-night with no rooms column.
--   /my-bids charge math: `total = perNight × nights` — silently
--   dropped the rooms multiplier. Customer asking for 2 rooms paid for 1.
--
-- Fix: three additive columns. `bid_requests.numRoomsRequested` = the
-- customer's pick (frozen at request creation, audit trail for what
-- they originally asked for across the city broadcast).
-- `bids.numRooms` = denormalized per-hotel resolved count so /api/bids/my
-- doesn't need a join. `bids.capacityMismatch` = boolean flag set
-- server-side when room.capacity × numRooms < guests, surfaced in
-- partner inbox so hotel can decide counter-vs-decline.
--
-- Auto-fit (client-side, additive) bumps form.rooms to ceil(guests/avgCap)
-- BEFORE submit, so the numRooms reaching the server is already
-- reconciled. Server's capacityMismatch flag catches edge cases
-- (e.g. user toggled auto-fit OFF, or hotel-specific capacity differs
-- from category default).
--
-- Forward-only. CHECK enforces 1–10 cap. Defaults preserve legacy
-- behavior (single-room bids that pre-date v241 read as 1).

ALTER TABLE public.bid_requests
  ADD COLUMN IF NOT EXISTS "numRoomsRequested" INTEGER NOT NULL DEFAULT 1
    CHECK ("numRoomsRequested" BETWEEN 1 AND 10);

ALTER TABLE public.bids
  ADD COLUMN IF NOT EXISTS "numRooms" INTEGER NOT NULL DEFAULT 1
    CHECK ("numRooms" BETWEEN 1 AND 10);

ALTER TABLE public.bids
  ADD COLUMN IF NOT EXISTS "capacityMismatch" BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.bid_requests."numRoomsRequested" IS
  'Number of rooms customer picked at /bid Step 3 (1–10). Frozen at request creation. Per-bid numRooms (on the bids row) may differ when server resolves against hotel-specific room.capacity.';

COMMENT ON COLUMN public.bids."numRooms" IS
  'Resolved room count for this bid against this specific hotel. Equals bid_requests.numRoomsRequested in the happy path. Multiplies amount × nights × numRooms to compute booking total on /my-bids.';

COMMENT ON COLUMN public.bids."capacityMismatch" IS
  'true when (guests > room.capacity × numRooms) at insert time. Customer over-packed for the resolved configuration. Partner inbox surfaces a yellow chip; partner can counter-with-more-rooms or decline.';

-- No backfill needed — DEFAULT 1 on both numRooms columns + false on
-- capacityMismatch means every legacy row reads as single-room
-- single-hotel exactly like pre-v241 behavior. Charge math fallback
-- in /my-bids: `b.numRooms || b.request?.numRoomsRequested || 1`.

-- Verification after apply:
--   SELECT COUNT(*) FROM bid_requests WHERE "numRoomsRequested" = 1;
--   SELECT COUNT(*) FROM bids WHERE "numRooms" = 1;
--   SELECT COUNT(*) FROM bids WHERE "capacityMismatch" = true;
-- Expected post-apply: all-row count for the first two, 0 for the third.
