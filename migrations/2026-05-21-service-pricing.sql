-- v177 — Service subscription pricing (partner panel, Phase 2).
--
-- service_pricing  — per-service monthly / quarterly / yearly price.
-- service_bundles  — multi-service bundle plans.
-- Admin sets these from /admin/services → Pricing. Partners see them
-- under a locked service's "Show charges".
--
-- Apply once in the Supabase SQL editor for project uxxhbdqedazpmvbvaosh.

CREATE TABLE IF NOT EXISTS public.service_pricing (
  service_key TEXT PRIMARY KEY,
  monthly     NUMERIC,
  quarterly   NUMERIC,
  yearly      NUMERIC,
  active      BOOLEAN NOT NULL DEFAULT true,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.service_bundles (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  service_keys JSONB NOT NULL DEFAULT '[]'::jsonb,
  monthly      NUMERIC,
  quarterly    NUMERIC,
  yearly       NUMERIC,
  active       BOOLEAN NOT NULL DEFAULT true,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.service_pricing ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_bundles ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='service_pricing' AND policyname='service_pricing_all_anon') THEN
    CREATE POLICY service_pricing_all_anon ON public.service_pricing FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='service_bundles' AND policyname='service_bundles_all_anon') THEN
    CREATE POLICY service_bundles_all_anon ON public.service_bundles FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;
