-- v170 — Housekeeping room-status board (partner panel, Phase 1).
--
-- One row per physical room unit (hotel_room_units.id). Tracks the
-- housekeeping state independent of the unit's availability `status`
-- (active/maintenance) so a "dirty" room is NOT auto-removed from
-- sale — front desk decides.
--
-- Apply once in the Supabase SQL editor for project uxxhbdqedazpmvbvaosh.
-- The /api/partner/housekeeping route degrades gracefully until applied.

CREATE TABLE IF NOT EXISTS public.room_housekeeping (
  unit_id     TEXT PRIMARY KEY,
  hotel_id    TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'clean',   -- clean | dirty | inspected | out_of_order
  assigned_to TEXT,
  note        TEXT,
  updated_by  TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_room_hk_hotel ON public.room_housekeeping (hotel_id);

ALTER TABLE public.room_housekeeping ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'room_housekeeping'
      AND policyname = 'room_hk_all_anon'
  ) THEN
    CREATE POLICY room_hk_all_anon ON public.room_housekeeping
      FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;
