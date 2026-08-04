-- v724 Gap-2 — AI yield-optimizer admin toggle (default OFF).
--
-- The expected-revenue optimizer (lib/pricing/optimizer.ts) was flag-gated by the
-- env var PRICING_OPTIMIZER_ENABLED only. This adds an admin toggle on the
-- pricing_engine_config singleton so the owner can enable/preview it from the
-- Pricing Engine tab without a redeploy. Default false = rule price (byte-identical).
-- When true, the spine applies the optimizer's expected-revenue-max price — a
-- guarded ±12% nudge around the proven rule price, never below floor, never above
-- the competitor-undercut cap. Additive.

ALTER TABLE pricing_engine_config
  ADD COLUMN IF NOT EXISTS yield_optimizer_enabled boolean DEFAULT false;

UPDATE pricing_engine_config
  SET yield_optimizer_enabled = COALESCE(yield_optimizer_enabled, false)
  WHERE id = 'default';
