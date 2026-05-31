-- ════════════════════════════════════════════════════════════════
-- v249.4 Phase 4 — AI Pricing: nightly online-learning store.
--
-- The nightly trainer (/api/cron/pricing-model-train) aggregates every
-- pricing_decision ⨝ bids outcome into empirical accept-rates per
-- (scope, scope_id, ratio_band) and PERSISTS them here. The accept-model
-- then reads these learned aggregates (room → hotel → city → global
-- fallback) instead of a per-request live scan — broader, faster, and
-- self-improving as data accumulates.
--
-- ADDITIVE-ONLY. Nothing reads these tables unless PRICING_MODEL_LEARNED=1
-- (default OFF) — so this migration changes ZERO live behavior. The Phase-2
-- live `loadAcceptStats` path stays the default until the flag flips.
-- ════════════════════════════════════════════════════════════════

-- ── Learned accept-rate parameters (one row per scope × band) ──────
CREATE TABLE IF NOT EXISTS public.pricing_model_params (
  id           TEXT PRIMARY KEY,
  scope        TEXT NOT NULL CHECK (scope IN ('room', 'hotel', 'city', 'global')),
  scope_id     TEXT NOT NULL,            -- room_id / hotel_id / city / 'GLOBAL'
  ratio_band   TEXT NOT NULL,            -- mirrors lib/pricing/outcomes RatioBand
  n            INTEGER NOT NULL DEFAULT 0,
  accepts      INTEGER NOT NULL DEFAULT 0,
  observed_rate DOUBLE PRECISION NOT NULL DEFAULT 0,  -- accepts / n
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per (scope, scope_id, band) — the trainer upserts on this key.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_pmp_scope_band
  ON public.pricing_model_params (scope, scope_id, ratio_band);

-- Fast scope lookup for the reader (loadLearnedStats).
CREATE INDEX IF NOT EXISTS idx_pmp_scope_lookup
  ON public.pricing_model_params (scope, scope_id);

-- ── Training-run audit trail (one row per nightly run) ─────────────
CREATE TABLE IF NOT EXISTS public.pricing_model_runs (
  id                 TEXT PRIMARY KEY,
  started_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at        TIMESTAMPTZ,
  lookback_days      INTEGER,
  decisions_scanned  INTEGER NOT NULL DEFAULT 0,
  bids_joined        INTEGER NOT NULL DEFAULT 0,
  params_written     INTEGER NOT NULL DEFAULT 0,
  scopes             JSONB,    -- { room: N, hotel: N, city: N, global: N }
  ok                 BOOLEAN NOT NULL DEFAULT false,
  error              TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pmr_created
  ON public.pricing_model_runs (created_at DESC);

-- ── RLS — permissive anon (matches every other table in this project) ──
ALTER TABLE public.pricing_model_params ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pricing_model_runs   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pricing_model_params_all_anon ON public.pricing_model_params;
CREATE POLICY pricing_model_params_all_anon ON public.pricing_model_params
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS pricing_model_runs_all_anon ON public.pricing_model_runs;
CREATE POLICY pricing_model_runs_all_anon ON public.pricing_model_runs
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
