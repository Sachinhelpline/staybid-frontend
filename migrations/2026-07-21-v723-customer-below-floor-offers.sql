-- v723 Gap-3 — customer below-floor forwarded offers (admin-configurable, default OFF).
--
-- Adds one knob to pricing_engine_config. Default 1.0 = OFF = today's exact
-- behaviour (bids/place hard-rejects amount < floor). When the owner sets it
-- below 1.0 (e.g. 0.85), a guest can OFFER down to floor × ratio; the REAL offer
-- is stored on the bid and forwarded PENDING to the owner (never auto-accepted,
-- never auto-countered) — mirroring the Model-3 travel-agent below-floor band.
-- The static floor stays the anti-lowball guard below floor × ratio. Additive.

ALTER TABLE pricing_engine_config
  ADD COLUMN IF NOT EXISTS cust_below_floor_ratio numeric DEFAULT 1.0;

UPDATE pricing_engine_config
  SET cust_below_floor_ratio = COALESCE(cust_below_floor_ratio, 1.0)
  WHERE id = 'default';
