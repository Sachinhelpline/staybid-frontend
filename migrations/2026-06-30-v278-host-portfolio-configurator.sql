-- ============================================================================
-- v278 — StayBid for Hosts: Portfolio Configurator
-- A real multi-step build flow: pick budget tier → cities → rooms → design →
-- add-ons → bundle → consent → payment (mode-specific security + EMI/rental).
-- Additive + isolated. No FK from existing tables. Mirrors the host vertical
-- pattern (host_leads / store_orders): permissive RLS, anon-key writes.
-- ============================================================================

-- The draft + committed portfolio config a partner builds in the wizard.
CREATE TABLE IF NOT EXISTS public.host_portfolio_configs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       text,                               -- nullable (anon can draft)
  tier          text NOT NULL,                      -- explorer/adventurer/trailblazer/elite
  cities        jsonb NOT NULL DEFAULT '[]'::jsonb,  -- string[]
  rooms         integer NOT NULL DEFAULT 1,
  design        text NOT NULL DEFAULT 'essential',
  addons        jsonb NOT NULL DEFAULT '[]'::jsonb,  -- string[]
  payment_mode  text NOT NULL DEFAULT 'monthly',
  -- server-computed snapshot of the bundle (the numbers the partner consented to)
  breakdown     jsonb,
  pay_now       integer,                            -- the amount charged at checkout
  recurring     integer,                            -- per-period management charge after
  security      integer,
  -- lifecycle
  status        text NOT NULL DEFAULT 'draft',      -- draft / pending_payment / active / cancelled
  contact       jsonb,                              -- { name, phone, email }
  razorpay_order_id   text,
  razorpay_payment_id text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS host_portfolio_configs_user_idx   ON public.host_portfolio_configs (user_id);
CREATE INDEX IF NOT EXISTS host_portfolio_configs_status_idx ON public.host_portfolio_configs (status);
CREATE INDEX IF NOT EXISTS host_portfolio_configs_rzp_idx    ON public.host_portfolio_configs (razorpay_order_id);

ALTER TABLE public.host_portfolio_configs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS host_portfolio_configs_all_anon ON public.host_portfolio_configs;
CREATE POLICY host_portfolio_configs_all_anon ON public.host_portfolio_configs
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
