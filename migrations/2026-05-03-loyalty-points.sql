-- Session 4: loyalty points ledger. Distinct from the frontend-derived
-- StayPoints concept on /wallet (which is computed from spend) — these tables
-- are the durable points wallet for redemptions and admin adjustments.
CREATE TABLE IF NOT EXISTS public.user_points (
  user_id            TEXT PRIMARY KEY,
  balance            INT NOT NULL DEFAULT 0,
  lifetime_earned    INT NOT NULL DEFAULT 0,
  lifetime_redeemed  INT NOT NULL DEFAULT 0,
  tier               TEXT NOT NULL DEFAULT 'silver',
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.points_history (
  id              TEXT PRIMARY KEY DEFAULT ('ph_' || gen_random_uuid()::text),
  user_id         TEXT NOT NULL,
  delta           INT NOT NULL,
  type            TEXT NOT NULL,
  reason          TEXT,
  source_type     TEXT,
  source_id       TEXT,
  balance_after   INT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_points_history_user ON public.points_history(user_id);
CREATE INDEX IF NOT EXISTS idx_points_history_type ON public.points_history(type);

GRANT ALL ON public.user_points, public.points_history TO anon, authenticated, service_role;
ALTER TABLE public.user_points    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.points_history ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='user_points' AND policyname='all_anon_all') THEN
    EXECUTE 'CREATE POLICY all_anon_all ON public.user_points FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='points_history' AND policyname='all_anon_all') THEN
    EXECUTE 'CREATE POLICY all_anon_all ON public.points_history FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)';
  END IF;
END $$;
NOTIFY pgrst, 'reload schema';
