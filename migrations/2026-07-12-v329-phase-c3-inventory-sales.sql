-- ════════════════════════════════════════════════════════════════════════
-- v329 — Circle Phase C3: Model 3 resale settlement ledger.
--
-- When a customer buys a LISTED inventory block off the consumer feed, the
-- money lands in StayBid's Razorpay account; StayBid keeps the platform fee and
-- OWES the investor their net. `inventory_sales` is that settlement ledger —
-- one row per resale sale, freezing resale_total / platform_fee / investor_net
-- at pay time. Actual payout execution + admin oversight are C4; C3 records the
-- obligation (`payout_status='owed'`).
--
-- Additive + idempotent. `inventory_blocks` already carries `listed_at`/`sold_at`
-- (C1), so the listing state machine needs NO block-schema change here.
-- ════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.inventory_sales (
  id                  TEXT PRIMARY KEY DEFAULT ('invs_'::text || replace((gen_random_uuid())::text, '-'::text, ''::text)),
  block_id            TEXT NOT NULL,
  hotel_id            TEXT NOT NULL,
  unit_id             TEXT NOT NULL,
  room_id             TEXT NOT NULL,
  investor_user_id    TEXT NOT NULL,           -- who gets the net (from the block)
  buyer_user_id       TEXT,                    -- customer (sb_token id); nullable-safe
  buyer_name          TEXT,
  buyer_phone         TEXT,
  date_from           DATE NOT NULL,
  date_to             DATE NOT NULL,
  nights              INTEGER NOT NULL,
  resale_per_night    NUMERIC NOT NULL,
  resale_total        NUMERIC NOT NULL,        -- what the customer pays
  buy_total           NUMERIC,                 -- snapshot of the investor's cost
  platform_fee_pct    NUMERIC NOT NULL,
  platform_fee        NUMERIC NOT NULL,        -- StayBid's cut
  investor_net        NUMERIC NOT NULL,        -- resale − fee − buy  (owed to investor)
  razorpay_order_id   TEXT,
  razorpay_payment_id TEXT,
  status              TEXT NOT NULL DEFAULT 'pending_payment'
    CHECK (status IN ('pending_payment','paid','refunded','cancelled')),
  payout_status       TEXT NOT NULL DEFAULT 'owed'
    CHECK (payout_status IN ('owed','paid')),
  paid_at             TIMESTAMPTZ,
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inv_sales_block     ON public.inventory_sales (block_id);
CREATE INDEX IF NOT EXISTS idx_inv_sales_investor  ON public.inventory_sales (investor_user_id, status);
CREATE INDEX IF NOT EXISTS idx_inv_sales_buyer     ON public.inventory_sales (buyer_user_id);
CREATE INDEX IF NOT EXISTS idx_inv_sales_order     ON public.inventory_sales (razorpay_order_id);
-- One paid sale per block (a block sells once). Partial unique keeps
-- pending_payment rows from racing to two paid rows.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_inv_sales_block_paid
  ON public.inventory_sales (block_id) WHERE status = 'paid';

ALTER TABLE public.inventory_sales ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='inventory_sales' AND policyname='inventory_sales_all_anon'
  ) THEN
    CREATE POLICY inventory_sales_all_anon ON public.inventory_sales
      FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;
