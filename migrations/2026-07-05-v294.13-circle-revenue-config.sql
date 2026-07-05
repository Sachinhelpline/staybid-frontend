-- v294.13 — StayCircle honest revenue model: admin-editable config singleton.
-- One row (id='default') holds the revenue levers (uplift %, commission %,
-- setup/room, city fee, management/mo) as a JSONB blob. resolveRevenueConfig()
-- merges it over lib/circle/engine DEFAULT_CIRCLE_REVENUE (mergeRevenueConfig
-- clamps every number), so a partial / empty / missing row keeps the panel
-- working on bundled defaults. Same pattern as host_wizard_config (v280).
--
-- DISPLAY-ONLY: these numbers drive the /circle/build "Investment & Returns"
-- transparency panel. They do NOT touch payNow / the Razorpay charge — the
-- checkout amount stays the investment subscription, unchanged.

CREATE TABLE IF NOT EXISTS public.circle_revenue_config (
  id          TEXT PRIMARY KEY DEFAULT 'default',
  config      JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  TEXT
);

-- Seed the singleton empty → resolver falls back to bundled defaults until an
-- admin saves overrides from /admin/circle → Revenue Model.
INSERT INTO public.circle_revenue_config (id, config)
VALUES ('default', '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.circle_revenue_config ENABLE ROW LEVEL SECURITY;

-- Permissive read for anon (public panel needs the resolved config); writes go
-- through the admin route with service key (SB_H). Matches circle_* precedent.
DROP POLICY IF EXISTS circle_revenue_config_all ON public.circle_revenue_config;
CREATE POLICY circle_revenue_config_all
  ON public.circle_revenue_config
  FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);
