-- v379 — Model 3 LIVE: no more bare-floor auto-accept by default.
-- The bare floor should never be an instant win (else agents always bid the
-- minimum). The default "Smart" mode (autopilot='hybrid') instant-LOCKS only bids
-- at/above floor × live_hybrid_accept_ratio; at-floor bids go to the owner (who
-- can accept a higher competing bid). Pure "Instant" (autopilot='auto', accepts
-- at floor) stays as an explicit, warned owner opt-in. Additive config tweak.
UPDATE public.auction_config
  SET live_hybrid_accept_ratio = 1.15,   -- clearer "bid up to lock" gap
      live_default_autopilot   = 'hybrid'
  WHERE id = 'default';

-- The demo Cave View live lot was seeded as 'auto' (floor auto-accepts) — flip it
-- to 'hybrid' (Smart) so the always-open demo shows the correct incentive.
UPDATE public.auction_lots
  SET autopilot_mode = 'hybrid',
      metadata = coalesce(metadata,'{}'::jsonb) || '{"autopilot_mode":"hybrid"}'::jsonb
  WHERE id = 'lot_live_deh02r1' AND autopilot_mode = 'auto';
