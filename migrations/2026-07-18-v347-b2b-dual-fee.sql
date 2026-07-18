-- v347 — Circle Model 2: DUAL-SIDED B2B commission (5% buyer + 5% seller),
-- admin-controlled. Additive, forward-only.
--
-- WHAT CHANGES
--   • b2b_fee_config — admin-editable singleton for the two commission %.
--   • b2b_listings   — freeze buyer_fee_pct + seller_fee_pct at list time
--                      (tamper-safe; a later admin change never re-prices a
--                      live listing).
--   • b2b_trades     — record the frozen split both sides + buyer_pays (what
--                      the buyer was charged = ask + buyer fee).
--
-- The old single platform_fee_pct / platform_fee columns stay (now hold the
-- TOTAL fee = buyer + seller) so existing readers keep working.

-- ---------------------------------------------------------------------------
-- b2b_fee_config (admin singleton)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.b2b_fee_config (
  id             TEXT PRIMARY KEY,
  buyer_fee_pct  NUMERIC NOT NULL DEFAULT 5,
  seller_fee_pct NUMERIC NOT NULL DEFAULT 5,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed the default singleton (5% / 5%) once. No-op if it already exists.
INSERT INTO public.b2b_fee_config (id, buyer_fee_pct, seller_fee_pct)
VALUES ('default', 5, 5)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.b2b_fee_config ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public'
      AND tablename='b2b_fee_config' AND policyname='b2b_fee_config_all_anon'
  ) THEN
    CREATE POLICY b2b_fee_config_all_anon ON public.b2b_fee_config
      FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- b2b_listings — freeze both fee % at list time
-- ---------------------------------------------------------------------------
ALTER TABLE public.b2b_listings
  ADD COLUMN IF NOT EXISTS buyer_fee_pct  NUMERIC NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS seller_fee_pct NUMERIC NOT NULL DEFAULT 5;

-- ---------------------------------------------------------------------------
-- b2b_trades — record the frozen dual split + buyer charge
-- ---------------------------------------------------------------------------
ALTER TABLE public.b2b_trades
  ADD COLUMN IF NOT EXISTS buyer_fee_pct  NUMERIC,
  ADD COLUMN IF NOT EXISTS seller_fee_pct NUMERIC,
  ADD COLUMN IF NOT EXISTS buyer_fee      NUMERIC,
  ADD COLUMN IF NOT EXISTS seller_fee     NUMERIC,
  ADD COLUMN IF NOT EXISTS buyer_pays     NUMERIC;

COMMENT ON TABLE public.b2b_fee_config IS
  'Admin-editable dual B2B commission % (buyer + seller). Singleton id=default. Frozen onto each listing at list time.';
COMMENT ON COLUMN public.b2b_trades.buyer_pays IS
  'What the buyer was charged = ask_total + buyer_fee. platform_fee holds buyer_fee + seller_fee (total).';
