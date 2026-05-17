-- ─────────────────────────────────────────────────────────────────────────
-- v132.2 — Per-date per-room price + quantity overrides
--
-- Partners asked for the ability to change pricing and inventory ON A
-- SPECIFIC DATE without permanently editing the room's base floor price.
-- Example use cases:
--   • Diwali weekend: cottage normally ₹3500/night, jack to ₹6500 for
--     Oct 31 + Nov 1 only
--   • Maintenance: keep 3 of 5 units available on Dec 12 (quantity = 3),
--     leave other dates untouched
--
-- Design choices:
--   • One row per (roomId, date) — UNIQUE constraint enforces it
--   • `floorPrice` nullable — null means "use base rooms.floorPrice"
--   • `quantityOverride` nullable — null means "use base rooms.quantity"
--   • Either or both can be set; partner saves whichever they touched
--   • hotelId denormalized so partner-scope queries don't need to join
--     rooms every time
--
-- Read path: `/api/partner/calendar` will merge this into the response
-- alongside the existing occupancy map (additive — old clients still get
-- the same shape). New clients also get a `pricing` map.
--
-- Write path: new `/api/partner/room-pricing` endpoint accepts bulk
-- upserts (so multi-date selection saves in one round-trip) plus a
-- delete-by-id for clearing overrides.
--
-- Idempotent — safe to re-apply.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.room_date_overrides (
  id                 TEXT NOT NULL PRIMARY KEY,
  "hotelId"          TEXT NOT NULL,
  "roomId"           TEXT NOT NULL,
  date               TEXT NOT NULL,                 -- YYYY-MM-DD, matches calendar API format
  "floorPrice"       NUMERIC(10,2),                 -- nullable: use room base if null
  "quantityOverride" INTEGER,                       -- nullable: use room.quantity if null
  note               TEXT,
  "createdAt"        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt"        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS room_date_overrides_room_date_unique
  ON public.room_date_overrides ("roomId", date);

CREATE INDEX IF NOT EXISTS room_date_overrides_hotel_date_idx
  ON public.room_date_overrides ("hotelId", date);

CREATE INDEX IF NOT EXISTS room_date_overrides_room_idx
  ON public.room_date_overrides ("roomId");

-- Permissive RLS so the partner panel (which uses the anon key for direct
-- REST reads through lib/sb.ts patterns) can read + write. Authorization
-- happens in the API route via ownerId check against the hotel.
ALTER TABLE public.room_date_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "all_anon_all" ON public.room_date_overrides;
CREATE POLICY "all_anon_all" ON public.room_date_overrides
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- updatedAt auto-touch on UPDATE
CREATE OR REPLACE FUNCTION public.fn_room_date_overrides_touch_updated()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW."updatedAt" := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_room_date_overrides_touch_updated ON public.room_date_overrides;
CREATE TRIGGER trg_room_date_overrides_touch_updated
  BEFORE UPDATE ON public.room_date_overrides
  FOR EACH ROW EXECUTE FUNCTION public.fn_room_date_overrides_touch_updated();
