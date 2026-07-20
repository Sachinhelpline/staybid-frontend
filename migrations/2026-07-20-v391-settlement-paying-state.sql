-- v391 — settlement_ledger: add a 'paying' claim state for safe payout execution.
--
-- The RazorpayX payout flow two-phase-claims rows (owed → paying) BEFORE calling
-- the payout API, so a concurrent run / retry can never double-pay: a 'paying'
-- row is excluded from any new batch, and a crashed attempt's rows are recovered
-- (re-included) on the next run under the same idempotency key.
--
-- Relaxes the payout_status CHECK from (owed|paid|cancelled) to add 'paying'.
-- Additive / forward-only.

DO $$
DECLARE cname text;
BEGIN
  SELECT conname INTO cname FROM pg_constraint
   WHERE conrelid = 'settlement_ledger'::regclass AND contype = 'c'
     AND pg_get_constraintdef(oid) ILIKE '%payout_status%';
  IF cname IS NOT NULL THEN EXECUTE format('ALTER TABLE settlement_ledger DROP CONSTRAINT %I', cname); END IF;
END $$;

ALTER TABLE settlement_ledger
  ADD CONSTRAINT settlement_ledger_payout_status_chk
  CHECK (payout_status IN ('owed','paying','paid','cancelled'));
