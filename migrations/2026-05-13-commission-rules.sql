-- ─────────────────────────────────────────────────────────────────────────
-- Tiered commission rules (v95, May 2026)
--
-- Replaces the flat 12% (or 15% Elite) commission with a slab-based
-- structure where the rate climbs with monthly booking volume, plus a
-- loyalty bonus for creators who stay at a slab for N consecutive months.
-- Both the slabs and bonuses are admin-editable per creator (and globally).
--
-- Defaults seeded in this migration:
--   Slabs (bookings/month → commission %):
--     1–25    →  5%
--     26–50   →  7%
--     51–100  → 10%
--     101–300 → 12%
--   Loyalty (consecutive months at same-or-higher slab):
--     3 months → +1%
--     6 months → +2%
--
-- Additive only — no existing tables touched. Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.commission_rules (
  id              TEXT PRIMARY KEY DEFAULT ('cr_' || gen_random_uuid()::text),
  scope           TEXT NOT NULL,                   -- 'global' | 'creator'
  creator_id      TEXT,                            -- influencers.id when scope='creator'
  slabs           JSONB NOT NULL,                  -- [{minBookings, maxBookings, pct}]
  loyalty_bonuses JSONB NOT NULL,                  -- [{months, bonusPct}]
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  note            TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by      TEXT
);

CREATE INDEX IF NOT EXISTS idx_commrules_scope   ON public.commission_rules(scope);
CREATE INDEX IF NOT EXISTS idx_commrules_creator ON public.commission_rules(creator_id) WHERE creator_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_commrules_active  ON public.commission_rules(active);

-- Enforce: at most ONE active creator override row per creator_id.
CREATE UNIQUE INDEX IF NOT EXISTS uq_commrules_creator_active
  ON public.commission_rules(creator_id)
  WHERE scope = 'creator' AND active = TRUE;

-- Enforce: exactly ONE active global rule (the platform default).
CREATE UNIQUE INDEX IF NOT EXISTS uq_commrules_global_active
  ON public.commission_rules((1))
  WHERE scope = 'global' AND active = TRUE;

GRANT ALL ON public.commission_rules TO anon, authenticated, service_role;

ALTER TABLE public.commission_rules ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='commission_rules' AND policyname='all_anon_all') THEN
    EXECUTE 'CREATE POLICY all_anon_all ON public.commission_rules FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)';
  END IF;
END $$;

-- Seed the platform-default global rule. Skipped if a global rule already
-- exists (e.g. admin tweaked the defaults before this migration was re-run).
INSERT INTO public.commission_rules (scope, slabs, loyalty_bonuses, note, updated_by)
SELECT
  'global',
  '[
    {"minBookings": 1,   "maxBookings": 25,  "pct": 5},
    {"minBookings": 26,  "maxBookings": 50,  "pct": 7},
    {"minBookings": 51,  "maxBookings": 100, "pct": 10},
    {"minBookings": 101, "maxBookings": 300, "pct": 12}
  ]'::jsonb,
  '[
    {"months": 3, "bonusPct": 1},
    {"months": 6, "bonusPct": 2}
  ]'::jsonb,
  'Platform default — seeded by v95 migration',
  'system'
WHERE NOT EXISTS (
  SELECT 1 FROM public.commission_rules WHERE scope='global' AND active=TRUE
);

-- ─────────────────────────────────────────────────────────────────────────
-- Monthly snapshot per creator. Used to:
--   1. Detect "consecutive months at slab" for loyalty bonus eligibility
--   2. Show admins a history of every creator's monthly volume + slab
--
-- Written by /api/attribution/record on every creator-attributed booking
-- (upserts the current calendar month's row). Slab + total_pct are
-- recomputed live each write, so a mid-month change in the rule is
-- reflected immediately.
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.creator_commission_history (
  creator_id          TEXT NOT NULL,
  year                INT NOT NULL,
  month               INT NOT NULL,                -- 1-12
  bookings_count      INT NOT NULL DEFAULT 0,
  slab_min            INT,
  slab_max            INT,
  slab_pct            NUMERIC(5,2) NOT NULL DEFAULT 0,
  loyalty_pct         NUMERIC(5,2) NOT NULL DEFAULT 0,
  total_pct           NUMERIC(5,2) NOT NULL DEFAULT 0,
  gmv                 NUMERIC(14,2) NOT NULL DEFAULT 0,
  commission_total    NUMERIC(14,2) NOT NULL DEFAULT 0,
  computed_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (creator_id, year, month)
);

CREATE INDEX IF NOT EXISTS idx_cch_year_month ON public.creator_commission_history(year, month);
CREATE INDEX IF NOT EXISTS idx_cch_creator    ON public.creator_commission_history(creator_id);

GRANT ALL ON public.creator_commission_history TO anon, authenticated, service_role;

ALTER TABLE public.creator_commission_history ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='creator_commission_history' AND policyname='all_anon_all') THEN
    EXECUTE 'CREATE POLICY all_anon_all ON public.creator_commission_history FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
