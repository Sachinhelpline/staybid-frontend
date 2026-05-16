-- ─────────────────────────────────────────────────────────────────────────
-- Hotel Performance Scorecard (v128, 2026-05-16)
--
-- Stores the cached scorecard per hotel + the live rank within its city.
--
-- The score-compute path lives in lib/hotel-score.ts (pure functions).
-- The /api/hotels/:id/scorecard route does the heavy data fetch, calls
-- computeHotelScore(), upserts a row here, and uses this table to compute
-- the rank-within-city in O(N) where N = hotels in that city.
--
-- The cron sweep recomputes ALL hotels' scores periodically. Customer
-- /hotels/:id pages also opportunistically recompute when the cache row
-- is older than 30 minutes (lazy refresh).
--
-- Why a cache table instead of computing on-the-fly every request:
--   1. Rank-within-city needs every hotel's overall score to sort. If we
--      computed all of them on every detail-page open, that's 18 hotels ×
--      ~6 Supabase fetches = 108 queries per page open. Cached: 1 read.
--   2. Cron job pre-warms scores at low traffic times.
--   3. Admin / partner panels read the same precomputed row.
--
-- Additive only. Idempotent. Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.hotel_scores (
  hotel_id           TEXT PRIMARY KEY,
  city               TEXT,
  state              TEXT,
  overall            NUMERIC(5,2),                 -- 0..100 OR NULL (unrated)
  rank_in_city       INTEGER,
  total_in_city      INTEGER,
  percentile_city    NUMERIC(5,2),                 -- 0..100
  status             TEXT,                          -- unrated | developing | fair | good | excellent
  badge_emoji        TEXT,
  badge_label        TEXT,
  badge_color        TEXT,

  -- Full checkpoint breakdown — UI reads from here to render the
  -- detailed scorecard modal without recomputing.
  checkpoints        JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- Headline counts surfaced on the badge tooltip + modal.
  total_bookings       INTEGER NOT NULL DEFAULT 0,
  total_stay_feedback  INTEGER NOT NULL DEFAULT 0,
  total_complaints     INTEGER NOT NULL DEFAULT 0,

  computed_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hotel_scores_city ON public.hotel_scores(city);
CREATE INDEX IF NOT EXISTS idx_hotel_scores_overall ON public.hotel_scores(overall DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_hotel_scores_city_overall ON public.hotel_scores(city, overall DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_hotel_scores_computed_at ON public.hotel_scores(computed_at);

-- ─────────────────────────────────────────────────────────────────────────
-- Optional history table — once-per-day snapshot. Used by the trend
-- sparkline on the detailed scorecard modal. Capped at 90 days via the
-- cron sweep itself (DELETE WHERE snapshot_at < now() - interval '90 days').
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.hotel_score_history (
  id                BIGSERIAL PRIMARY KEY,
  hotel_id          TEXT NOT NULL,
  overall           NUMERIC(5,2),
  rank_in_city      INTEGER,
  total_in_city     INTEGER,
  checkpoints       JSONB,
  snapshot_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hotel_score_history_hotel ON public.hotel_score_history(hotel_id, snapshot_at DESC);
CREATE INDEX IF NOT EXISTS idx_hotel_score_history_snapshot ON public.hotel_score_history(snapshot_at DESC);

GRANT ALL ON public.hotel_scores TO anon, authenticated, service_role;
GRANT ALL ON public.hotel_score_history TO anon, authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE hotel_score_history_id_seq TO anon, authenticated, service_role;

-- v99 permissive policy parity (table is RLS-enabled per v99 baseline
-- once `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` runs).
ALTER TABLE public.hotel_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hotel_score_history ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'hotel_scores' AND policyname = 'all_anon_all'
  ) THEN
    CREATE POLICY "all_anon_all" ON public.hotel_scores FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'hotel_score_history' AND policyname = 'all_anon_all'
  ) THEN
    CREATE POLICY "all_anon_all" ON public.hotel_score_history FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;
