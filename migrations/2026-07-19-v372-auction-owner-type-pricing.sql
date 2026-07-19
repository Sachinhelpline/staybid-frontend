-- v372 — Model 3 owner-type pricing. The min-bid floor now depends on WHO listed:
--   • Property owner (classic hotel) → floor = the room's NORMAL floorPrice.
--   • Circle owner (host_circle)     → floor = floorPrice × circle_floor_multiplier
--                                       (cover their purchase cost + a margin).
-- Set the multiplier to 1.20 (= cost + 20% profit) as the new default. Admins can
-- still tune it in /admin/auction ("Circle floor ×"). Additive.
UPDATE public.auction_config SET circle_floor_multiplier = 1.20, updated_at = now()
  WHERE id = 'default' AND circle_floor_multiplier = 1.0;

ALTER TABLE public.auction_config ALTER COLUMN circle_floor_multiplier SET DEFAULT 1.20;

COMMENT ON COLUMN public.auction_config.circle_floor_multiplier IS
  'Circle-owner (host_circle) Model-3 floor multiplier: floor = floorPrice × this (default 1.20 = purchase cost + 20% profit). Property-owner lots use floorPrice × 1.';
