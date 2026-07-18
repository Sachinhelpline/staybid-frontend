-- v349 — Circle Model 2: StayBid-REGULATED B2B pricing. The B2B ask is no
-- longer a free seller input — it is computed from the Spine wholesale floor
-- plus an admin-controlled markup %. Additive, forward-only. Applied live.
ALTER TABLE public.b2b_fee_config
  ADD COLUMN IF NOT EXISTS regulated_markup_pct NUMERIC NOT NULL DEFAULT 20;

COMMENT ON COLUMN public.b2b_fee_config.regulated_markup_pct IS
  'Model-2 regulated B2B ask = Spine wholesale/night x (1 + this%/100). Admin-controlled.';
