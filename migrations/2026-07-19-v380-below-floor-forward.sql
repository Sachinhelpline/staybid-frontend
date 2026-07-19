-- v380 — Model 3 LIVE: below-floor bids are FORWARDED to the owner (not rejected),
-- mirroring the customer negotiation panel (a guest can bid below the floor and the
-- hotel reviews/counters). But "below floor" is bounded — an agent can bid down to
-- floor × below_floor_min_ratio only; anything lower is rejected. A below-floor bid
-- is NEVER auto-accepted — it always goes to the owner (accept / counter / decline).
-- Additive config knob. Admin-tunable in /admin/auction.
ALTER TABLE public.auction_config
  ADD COLUMN IF NOT EXISTS below_floor_min_ratio NUMERIC NOT NULL DEFAULT 0.85;

COMMENT ON COLUMN public.auction_config.below_floor_min_ratio IS 'Model 3 LIVE: agents may bid down to floor × this (owner-reviewed, never auto). Below it, the bid is rejected. Bounded 0.5–1.';
