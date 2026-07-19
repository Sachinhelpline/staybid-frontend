-- v381 — Model 3 LIVE: never let a pending bid get "stuck".
-- Two safety nets so an agent is never blocked by an old bid:
--   1. Agents can CANCEL their own pending (active/countered) live bid (route).
--   2. A pending live bid AUTO-EXPIRES if the owner doesn't act within
--      live_offer_ttl_hours (default 48h) or once the lot window closes — the
--      cron flips it to 'expired', freeing the agent to bid again.
-- Additive config knob. Admin-tunable in /admin/auction.
ALTER TABLE public.auction_config
  ADD COLUMN IF NOT EXISTS live_offer_ttl_hours INT NOT NULL DEFAULT 48;

COMMENT ON COLUMN public.auction_config.live_offer_ttl_hours IS 'Model 3 LIVE: a pending (active/countered) live bid auto-expires this many hours after it was placed if the owner has not acted.';
