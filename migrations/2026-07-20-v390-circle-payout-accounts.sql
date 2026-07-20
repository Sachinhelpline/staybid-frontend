-- v390 — Circle settlement S3 foundation: owner PAYOUT ACCOUNTS.
--
-- Where a Circle owner/investor gets paid. This is the hard prerequisite for any
-- money-out (RazorpayX needs a fund-account per owner). Collected now; the
-- RazorpayX fund_account_id is stamped later when the payout rail is provisioned.
--
-- Additive / forward-only / TEXT ids / NO FK constraints / permissive RLS
-- (service key elevates via lib/sb-server), matching every other Circle table.

CREATE TABLE IF NOT EXISTS circle_payout_accounts (
  id                        TEXT PRIMARY KEY,
  user_id                   TEXT NOT NULL,           -- the owner's primary id (cross-pool resolved on read)
  method                    TEXT NOT NULL DEFAULT 'bank',   -- 'bank' | 'upi'
  account_holder            TEXT,                    -- name as per bank
  account_number            TEXT,                    -- bank a/c (sensitive)
  ifsc                      TEXT,                    -- bank IFSC
  upi_id                    TEXT,                    -- UPI VPA (alt to bank)
  status                    TEXT NOT NULL DEFAULT 'pending',  -- pending | verified | rejected
  razorpayx_fund_account_id TEXT,                    -- set when RazorpayX is provisioned (S3 money-out)
  metadata                  JSONB DEFAULT '{}'::jsonb,
  created_at                TIMESTAMPTZ DEFAULT now(),
  updated_at                TIMESTAMPTZ DEFAULT now()
);

-- One payout account per owner (upsert target).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_payout_account_user ON circle_payout_accounts (user_id);
CREATE INDEX IF NOT EXISTS idx_payout_account_status ON circle_payout_accounts (status);

ALTER TABLE circle_payout_accounts ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'circle_payout_accounts' AND policyname = 'circle_payout_accounts_all') THEN
    CREATE POLICY circle_payout_accounts_all ON circle_payout_accounts FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;
