-- v348 — Circle Model 2: per-investor CITY ACCESS paywall (₹999 one-time,
-- lifetime, admin-priced). Additive, forward-only.
--
-- An investor pays a one-time fee to unlock a city on the Model-2 inventory
-- marketplace; access is lifetime (never expires). The price lives on the
-- Model-2 config singleton (b2b_fee_config.city_access_price, default 999) so
-- admin edits it in the same place as the dual commission %.

-- Price on the shared Model-2 config singleton.
ALTER TABLE public.b2b_fee_config
  ADD COLUMN IF NOT EXISTS city_access_price NUMERIC NOT NULL DEFAULT 999;

-- Per-investor, per-city lifetime access grant.
CREATE TABLE IF NOT EXISTS public.circle_city_access (
  id                  TEXT PRIMARY KEY,   -- deterministic: cca_<primaryUserId>_<citySlug>
  user_id             TEXT NOT NULL,      -- investor primary (cross-pool resolved on read)
  city                TEXT NOT NULL,      -- normalized lowercase
  status              TEXT NOT NULL DEFAULT 'pending_payment',  -- pending_payment | active
  amount              NUMERIC,
  razorpay_order_id   TEXT,
  razorpay_payment_id TEXT,
  activated_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One ACTIVE access per (investor, city). Pending rows don't block re-tries
-- (the deterministic id upserts the same row).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_city_access_active
  ON public.circle_city_access (user_id, city) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_city_access_user
  ON public.circle_city_access (user_id, status);

ALTER TABLE public.circle_city_access ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public'
      AND tablename='circle_city_access' AND policyname='circle_city_access_all_anon'
  ) THEN
    CREATE POLICY circle_city_access_all_anon ON public.circle_city_access
      FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

COMMENT ON TABLE public.circle_city_access IS
  'Model-2 per-investor city access paywall (₹999 one-time lifetime). Price = b2b_fee_config.city_access_price.';
