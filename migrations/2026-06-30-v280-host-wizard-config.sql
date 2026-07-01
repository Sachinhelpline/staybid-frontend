-- ============================================================================
-- v280 — Host Portfolio Configurator: admin-editable pricing config
-- ----------------------------------------------------------------------------
-- Single-row config table. The full WizardConfig (tiers / cityActivationFee /
-- designPackages / addons / paymentModes) lives in the `config` JSONB column,
-- keyed id='default'. The server resolver (lib/host/wizard-config-store.ts)
-- merges it over the bundled DEFAULT_WIZARD_CONFIG, so a missing/partial row
-- still yields a complete, range-clamped config and the wizard keeps working.
--
-- Additive + idempotent. Permissive RLS to match the project convention
-- (writes go through the admin API which authenticates via adminFromReq).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.host_wizard_config (
  id          text PRIMARY KEY DEFAULT 'default',
  config      jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  text
);

ALTER TABLE public.host_wizard_config ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'host_wizard_config'
      AND policyname = 'host_wizard_config_all_anon'
  ) THEN
    CREATE POLICY host_wizard_config_all_anon ON public.host_wizard_config
      FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Seed the singleton row (empty config → resolver uses bundled defaults).
INSERT INTO public.host_wizard_config (id, config)
VALUES ('default', '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;
