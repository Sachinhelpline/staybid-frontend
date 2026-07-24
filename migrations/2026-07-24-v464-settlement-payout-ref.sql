-- v464 — a RazorpayX payout reference on each settlement row, so an async
-- payout-status webhook can reconcile the exact rows a payout covered
-- (payout.processed → paid, payout.reversed/failed → owed). Additive/forward-only.
ALTER TABLE settlement_ledger ADD COLUMN IF NOT EXISTS payout_ref TEXT;
CREATE INDEX IF NOT EXISTS idx_settlement_payout_ref ON settlement_ledger (payout_ref) WHERE payout_ref IS NOT NULL;
