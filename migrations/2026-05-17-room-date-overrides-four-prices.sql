-- ─────────────────────────────────────────────────────────────────────────
-- v132.3 — Extend room_date_overrides to support FOUR price overrides
--
-- v132.2 only stored a single `floorPrice` per (roomId, date). Partners
-- asked for four parallel price overrides per cell:
--   • mrp             — regular price (what customer sees as "from ₹X")
--   • floorPrice      — minimum bid accepted (already existed)
--   • flashPrice      — flash deal regular price for that date
--   • flashFloorPrice — flash deal floor (minimum acceptable in flash)
--
-- Each column nullable independently — partner can override any subset.
-- null falls back to the base value from `rooms` (rooms.mrp,
-- rooms.floorPrice, rooms.flashFloorPrice) or, for flashPrice, to the
-- dynamic pricing engine's output.
--
-- Idempotent — safe to re-apply.
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE public.room_date_overrides
  ADD COLUMN IF NOT EXISTS "mrp"              NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS "flashPrice"       NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS "flashFloorPrice"  NUMERIC(10,2);

-- Trigger from 2026-05-17-room-date-overrides.sql already auto-touches
-- updatedAt on any UPDATE, so the new columns get the same treatment.
