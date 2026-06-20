-- ═══════════════════════════════════════════════════════════════════════
-- v264 — Passport Phase 1 (additive). Applied live via Supabase MCP
-- (migration name: v264_passport_phase1_additive) on project
-- uxxhbdqedazpmvbvaosh. ADDITIVE-ONLY — no existing table/column touched.
--
-- The digital Explorer Passport layer on top of the existing
-- wallet/points/codes ecosystem. Stamps earned from confirmed stays;
-- rank/XP/badges derive from stamps; stamp-rewards mint redemption_codes.
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.passport_profiles (
  user_id            TEXT PRIMARY KEY,
  explorer_id        TEXT UNIQUE NOT NULL,
  member_since       TIMESTAMPTZ NOT NULL DEFAULT now(),
  display_name       TEXT,
  rank_key           TEXT NOT NULL DEFAULT 'explorer',
  xp                 INTEGER NOT NULL DEFAULT 0,
  stamps_count       INTEGER NOT NULL DEFAULT 0,
  properties_visited INTEGER NOT NULL DEFAULT 0,
  cities_visited     INTEGER NOT NULL DEFAULT 0,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.passport_stamps (
  id           TEXT PRIMARY KEY DEFAULT ('pst_'::text || gen_random_uuid()::text),
  user_id      TEXT NOT NULL,
  hotel_id     TEXT,
  hotel_name   TEXT,
  city         TEXT,
  region       TEXT,
  source_type  TEXT NOT NULL,          -- 'bid' | 'booking'
  source_id    TEXT NOT NULL,
  xp_awarded   INTEGER NOT NULL DEFAULT 0,
  stay_date    TIMESTAMPTZ,
  earned_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT passport_stamps_source_uniq UNIQUE (user_id, source_type, source_id)
);
CREATE INDEX IF NOT EXISTS idx_passport_stamps_user   ON public.passport_stamps (user_id, earned_at DESC);
CREATE INDEX IF NOT EXISTS idx_passport_stamps_hotel  ON public.passport_stamps (user_id, hotel_id);
CREATE INDEX IF NOT EXISTS idx_passport_stamps_city   ON public.passport_stamps (user_id, city);

CREATE TABLE IF NOT EXISTS public.passport_badges (
  id         TEXT PRIMARY KEY DEFAULT ('pbg_'::text || gen_random_uuid()::text),
  user_id    TEXT NOT NULL,
  badge_key  TEXT NOT NULL,
  earned_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT passport_badges_uniq UNIQUE (user_id, badge_key)
);
CREATE INDEX IF NOT EXISTS idx_passport_badges_user ON public.passport_badges (user_id);

CREATE TABLE IF NOT EXISTS public.passport_reward_claims (
  id               TEXT PRIMARY KEY DEFAULT ('prc_'::text || gen_random_uuid()::text),
  user_id          TEXT NOT NULL,
  reward_key       TEXT NOT NULL,
  threshold_stamps INTEGER,
  code_id          TEXT,
  code             TEXT,
  kind             TEXT,
  value_inr        NUMERIC NOT NULL DEFAULT 0,
  claimed_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT passport_reward_claims_uniq UNIQUE (user_id, reward_key)
);
CREATE INDEX IF NOT EXISTS idx_passport_reward_claims_user ON public.passport_reward_claims (user_id);

ALTER TABLE public.passport_profiles      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.passport_stamps        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.passport_badges        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.passport_reward_claims ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS passport_profiles_all_anon      ON public.passport_profiles;
DROP POLICY IF EXISTS passport_stamps_all_anon        ON public.passport_stamps;
DROP POLICY IF EXISTS passport_badges_all_anon        ON public.passport_badges;
DROP POLICY IF EXISTS passport_reward_claims_all_anon ON public.passport_reward_claims;

CREATE POLICY passport_profiles_all_anon      ON public.passport_profiles      FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY passport_stamps_all_anon        ON public.passport_stamps        FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY passport_badges_all_anon        ON public.passport_badges        FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY passport_reward_claims_all_anon ON public.passport_reward_claims FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
