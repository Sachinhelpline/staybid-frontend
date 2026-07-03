-- ============================================================================
-- v284 — Host 5-Phase Journey: preferences column on host_portfolio_configs
-- ----------------------------------------------------------------------------
-- The Portfolio Configurator was upgraded from a 6-step form into a 5-PHASE
-- investment journey (Investment → City → Property Type → Design & Setup →
-- Operations & Go Live) matching the master infographics. The new phases
-- collect NON-PRICED preferences that ops + admin need to see:
--   { returnProfile, cityMode, propertyTypes[], sourcing, designTheme,
--     operatingMode, popularAddons[] }
-- Pricing stays 100% in lib/host/wizard-rules computeBundle — preferences are
-- display/ops metadata only and never affect the Razorpay charge.
--
-- APPLIED LIVE 2026-07-02 via Supabase MCP (v284_host_portfolio_preferences).
-- ============================================================================

ALTER TABLE public.host_portfolio_configs
  ADD COLUMN IF NOT EXISTS preferences JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.host_portfolio_configs.preferences IS
  'v284 5-phase journey preferences: {returnProfile, cityMode, propertyTypes[], sourcing, designTheme, operatingMode, popularAddons[]} — display/ops only, never priced';

-- Verify:
--   SELECT column_name, data_type, column_default FROM information_schema.columns
--    WHERE table_name='host_portfolio_configs' AND column_name='preferences';
