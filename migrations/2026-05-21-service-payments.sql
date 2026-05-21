-- v178 — Service subscription billing (partner panel, Phase 3).
--
-- service_payments — one row per Razorpay subscription purchase.
--   A hotel taps "Activate" on a locked service (or bundle), picks a
--   term (monthly / quarterly / yearly) and pays. The verified payment
--   grants the service via hotel_services (access_type='paid') with a
--   term-based expires_at. The lazy expiry check on read does the rest —
--   no cron needed.
--
-- Apply once in the Supabase SQL editor for project uxxhbdqedazpmvbvaosh.

CREATE TABLE IF NOT EXISTS public.service_payments (
  id                  TEXT PRIMARY KEY,
  hotel_id            TEXT NOT NULL,
  hotel_name          TEXT,
  service_key         TEXT,                              -- single-service purchase
  bundle_id           TEXT,                              -- bundle purchase
  service_keys        JSONB NOT NULL DEFAULT '[]'::jsonb, -- effective keys granted
  plan                TEXT NOT NULL,                     -- monthly | quarterly | yearly
  amount              NUMERIC NOT NULL,                  -- INR rupees
  currency            TEXT NOT NULL DEFAULT 'INR',
  status              TEXT NOT NULL DEFAULT 'created',   -- created | paid | failed
  razorpay_order_id   TEXT,
  razorpay_payment_id TEXT,
  razorpay_signature  TEXT,
  expires_at          TIMESTAMPTZ,
  created_by          TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at             TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS service_payments_hotel_idx ON public.service_payments (hotel_id);
CREATE INDEX IF NOT EXISTS service_payments_order_idx ON public.service_payments (razorpay_order_id);
CREATE INDEX IF NOT EXISTS service_payments_status_idx ON public.service_payments (status);

ALTER TABLE public.service_payments ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='service_payments' AND policyname='service_payments_all_anon') THEN
    CREATE POLICY service_payments_all_anon ON public.service_payments FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;
