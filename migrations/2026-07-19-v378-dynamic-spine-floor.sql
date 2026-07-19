-- v378 — Dynamic, Spine-linked wholesale floor for Model 3 property-owner lots.
-- WHY: a static floor (floorPrice-based) goes stale — it doesn't rise in peak
-- season or ease off-season. Tie the wholesale floor to the room's LIVE Spine
-- price (the same dynamic engine that prices guests) so the floor tracks real
-- demand, while a hard anchor + owner override keep it safe and controllable.
--   dynamic wholesale floor = ceil100(month Spine ADR × (1 − wholesale_discount%))
--   hard anchor             = ceil100(retail floorPrice × min_floor_fraction)
--   final floor             = max(dynamic, anchor, owner's manual min)
-- Circle-owner floor (purchase × 1.20) is UNCHANGED. Additive, forward-only.

ALTER TABLE public.auction_config
  ADD COLUMN IF NOT EXISTS floor_mode        TEXT    NOT NULL DEFAULT 'dynamic';  -- 'dynamic' | 'static'
ALTER TABLE public.auction_config
  ADD COLUMN IF NOT EXISTS min_floor_fraction NUMERIC NOT NULL DEFAULT 0.6;       -- anchor = retail × this

ALTER TABLE public.auction_lots
  ADD COLUMN IF NOT EXISTS floor_mode          TEXT;     -- frozen at publish
ALTER TABLE public.auction_lots
  ADD COLUMN IF NOT EXISTS spine_adr_at_publish NUMERIC; -- the month ADR the dynamic floor came from

COMMENT ON COLUMN public.auction_config.floor_mode IS 'Model 3 property-owner floor: dynamic = ceil100(month Spine ADR × (1−discount)); static = ceil100(retail floorPrice × (1−discount)).';
COMMENT ON COLUMN public.auction_config.min_floor_fraction IS 'Hard anchor: the dynamic wholesale floor is never below retail floorPrice × this fraction.';

-- Reseed the 3 property demo live lots to the DYNAMIC floor (from their real Sept
-- Spine ADR × 0.80, ceil ₹100). Circle Mussoorie lot untouched.
UPDATE public.auction_lots SET
  floor_mode='dynamic', spine_adr_at_publish=2870, min_bid_per_room_night=2300,
  metadata = coalesce(metadata,'{}'::jsonb) || '{"floor_mode":"dynamic","spine_adr":2870}'::jsonb
WHERE id='lot_live_deh02r1';
UPDATE public.auction_lots SET
  floor_mode='dynamic', spine_adr_at_publish=3303, min_bid_per_room_night=2700,
  metadata = coalesce(metadata,'{}'::jsonb) || '{"floor_mode":"dynamic","spine_adr":3303}'::jsonb
WHERE id='lot_live_dha04r1';
UPDATE public.auction_lots SET
  floor_mode='dynamic', spine_adr_at_publish=3707, min_bid_per_room_night=3000,
  metadata = coalesce(metadata,'{}'::jsonb) || '{"floor_mode":"dynamic","spine_adr":3707}'::jsonb
WHERE id='lot_live_man04r1';
