-- v297 — StayCircle pay options (10% Visit-Access Hold · EMI · Full) + plan math.
-- Additive columns; extend the status CHECK to allow 'hold_paid'.
-- Applied live to uxxhbdqedazpmvbvaosh at v297 ship time.
ALTER TABLE public.circle_bundles
  ADD COLUMN IF NOT EXISTS pay_option TEXT NOT NULL DEFAULT 'full'
    CHECK (pay_option IN ('full','hold','emi')),
  ADD COLUMN IF NOT EXISTS charged_amount NUMERIC,
  ADD COLUMN IF NOT EXISTS hold_amount NUMERIC,
  ADD COLUMN IF NOT EXISTS balance_due NUMERIC,
  ADD COLUMN IF NOT EXISTS security_amount NUMERIC,
  ADD COLUMN IF NOT EXISTS advance_amount NUMERIC;

ALTER TABLE public.circle_bundles
  DROP CONSTRAINT IF EXISTS circle_bundles_status_check;
ALTER TABLE public.circle_bundles
  ADD CONSTRAINT circle_bundles_status_check
    CHECK (status IN ('draft','pending_payment','active','hold_paid','cancelled','completed'));
