-- v720 — Admin-tunable AI pricing-engine config (singleton).
--
-- Makes the "digits" inside the dynamic-pricing formula admin-editable WITHOUT
-- code changes: the 9 demand factors, the multiplier clamp, the OTA undercut %,
-- the flash discount %, and an opt-in "cap live at MRP" (Gap-6). The AI formula
-- itself is unchanged — these are just the numbers it multiplies. Resolver:
-- lib/pricing/engine-config-store.ts (fail-open to hardcoded defaults). Only the
-- authoritative server writers (cron price-spine + read-spine) read it; every
-- client fallback keeps the hardcoded defaults, so pricing never breaks if the
-- table is absent.
--
-- Additive, TEXT id, NO FK, permissive RLS (matches the repo convention).

CREATE TABLE IF NOT EXISTS pricing_engine_config (
  id                        text PRIMARY KEY DEFAULT 'default',
  -- spine-level knobs
  undercut_pct              numeric,      -- OTA undercut % (default 5)
  flash_discount_pct        numeric,      -- flash discount % off live (default 20)
  cap_live_at_mrp           boolean DEFAULT false,  -- Gap-6 opt-in
  -- multiplier clamp band
  clamp_min                 numeric,      -- 0.55
  clamp_max                 numeric,      -- 2.20
  -- single-value factors
  micro_amplitude_pct       numeric,      -- 2.5
  monsoon_mult              numeric,      -- 0.80
  school_mult               numeric,      -- 1.15
  long_weekend_mult         numeric,      -- 1.20
  long_weekend_holiday_mult numeric,      -- 1.10
  -- array / map factors (jsonb)
  season_mults              jsonb,        -- 12 — national curve
  dow_mults                 jsonb,        -- 7  — Sun..Sat
  occupancy_mults           jsonb,        -- 5  — [<30,30-50,50-70,70-85,>85]
  lead_mults                jsonb,        -- 6  — [same-day,<=2,<=7,<=14,<=30,>30]
  event_mults               jsonb,        -- ordered to EVENTS[]
  city_demand               jsonb,        -- per-city baseline overrides
  updated_at                timestamptz DEFAULT now(),
  updated_by                text
);

ALTER TABLE pricing_engine_config ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'pricing_engine_config' AND policyname = 'pricing_engine_config_all'
  ) THEN
    CREATE POLICY pricing_engine_config_all ON pricing_engine_config
      FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Seed the singleton with today's hardcoded defaults so the admin UI shows the
-- live values immediately. Idempotent — never clobbers an admin edit.
INSERT INTO pricing_engine_config (
  id, undercut_pct, flash_discount_pct, cap_live_at_mrp,
  clamp_min, clamp_max, micro_amplitude_pct,
  monsoon_mult, school_mult, long_weekend_mult, long_weekend_holiday_mult,
  season_mults, dow_mults, occupancy_mults, lead_mults, event_mults, city_demand,
  updated_at
) VALUES (
  'default', 5, 20, false,
  0.55, 2.20, 2.5,
  0.80, 1.15, 1.20, 1.10,
  '[0.95,0.88,1.02,1.20,1.32,1.10,0.95,0.88,0.90,1.40,1.48,1.35]'::jsonb,
  '[1.20,0.90,0.88,0.92,0.98,1.32,1.38]'::jsonb,
  '[0.88,0.96,1.00,1.12,1.28]'::jsonb,
  '[0.80,0.87,1.06,1.12,1.08,1.03]'::jsonb,
  '[1.58,1.45,1.38,1.48,1.45,1.32,1.25]'::jsonb,
  '{"Mussoorie":1.22,"Rishikesh":1.18,"Manali":1.20,"Shimla":1.15,"Dehradun":1.06,"Dhanaulti":1.10,"Goa":1.30,"Kerala":1.22,"Udaipur":1.25,"Jaisalmer":1.15,"Leh":1.20,"Meghalaya":1.12,"Puri":1.10,"Coorg":1.12}'::jsonb,
  now()
)
ON CONFLICT (id) DO NOTHING;
