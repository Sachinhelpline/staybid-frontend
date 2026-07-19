-- v377 — Wholesale-floor discount for Model 3 (property-owner lots).
-- WHY: a bulk B2B auction floor set at the room's RETAIL floorPrice leaves an
-- agent almost no resale margin (floorPrice ≈ the room's cheapest retail night).
-- A bulk, advance, guaranteed purchase justifies a real wholesale discount BELOW
-- the retail floor, so the agent buys wholesale and resells at the (real, live)
-- market ADR with genuine headroom. Circle-owner lots keep purchase × 1.20.
-- Additive, forward-only. Frozen per lot at publish (tamper-safe).

-- Admin-global default discount (%). Property-owner floor = floorPrice × (1 − pct/100).
ALTER TABLE public.auction_config
  ADD COLUMN IF NOT EXISTS wholesale_discount_pct NUMERIC NOT NULL DEFAULT 20;

-- Frozen per-lot discount + the retail floor it was derived from (audit + coach).
ALTER TABLE public.auction_lots
  ADD COLUMN IF NOT EXISTS wholesale_discount_pct NUMERIC;
ALTER TABLE public.auction_lots
  ADD COLUMN IF NOT EXISTS retail_floor_per_night NUMERIC;

COMMENT ON COLUMN public.auction_config.wholesale_discount_pct IS 'Model 3 property-owner wholesale floor = room floorPrice × (1 − pct/100). Circle owners use purchase × circle_floor_multiplier instead.';
COMMENT ON COLUMN public.auction_lots.retail_floor_per_night IS 'The room retail floorPrice the wholesale floor was derived from (property-owner lots), frozen at publish for transparency.';

-- Reseed the demo PROPERTY-owner live lots with the wholesale floor (20% below
-- retail) so the browse/coach shows real margin. Circle lot (Mussoorie) untouched.
UPDATE public.auction_lots SET
  retail_floor_per_night = 2800, wholesale_discount_pct = 20, min_bid_per_room_night = 2240,
  metadata = coalesce(metadata,'{}'::jsonb) || '{"retail_floor":2800,"wholesale_discount_pct":20}'::jsonb
WHERE id = 'lot_live_deh02r1';
UPDATE public.auction_lots SET
  retail_floor_per_night = 3200, wholesale_discount_pct = 20, min_bid_per_room_night = 2560,
  metadata = coalesce(metadata,'{}'::jsonb) || '{"retail_floor":3200,"wholesale_discount_pct":20}'::jsonb
WHERE id = 'lot_live_dha04r1';
UPDATE public.auction_lots SET
  retail_floor_per_night = 3500, wholesale_discount_pct = 20, min_bid_per_room_night = 2800,
  metadata = coalesce(metadata,'{}'::jsonb) || '{"retail_floor":3500,"wholesale_discount_pct":20}'::jsonb
WHERE id = 'lot_live_man04r1';
