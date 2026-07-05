-- ============================================================================
-- v285 — Host Portfolio Configurator: payment options at Review & Pay
-- ----------------------------------------------------------------------------
-- Adds the three-way pay option to host_portfolio_configs:
--   pay_option      full | hold | emi   (how the partner chose to pay payNow)
--   charged_amount  what was actually charged now (payNow for full/emi, 10% for hold)
--   hold_amount     the 10% Visit-Access Hold (only when pay_option='hold')
--   balance_due     remaining after the hold (paid after the visit + agreement)
-- No status CHECK exists on this table, so verify may set status='hold_paid'
-- (10% paid, balance pending) vs 'active' (full/emi paid) with no constraint alter.
-- Additive + idempotent.
-- ============================================================================

ALTER TABLE public.host_portfolio_configs
  ADD COLUMN IF NOT EXISTS pay_option     text NOT NULL DEFAULT 'full',
  ADD COLUMN IF NOT EXISTS charged_amount integer,
  ADD COLUMN IF NOT EXISTS hold_amount    integer,
  ADD COLUMN IF NOT EXISTS balance_due    integer;
