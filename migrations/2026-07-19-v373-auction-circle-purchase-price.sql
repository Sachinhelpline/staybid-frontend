-- v373 — Model 3 CIRCLE-OWNER floor fix. A Circle owner's floor must be based on
-- their ACTUAL PURCHASE price (what they paid to own the room, e.g. ₹30k/month ÷
-- 30 = ₹1000/night), NOT the retail floorPrice. Floor = purchase/night × 1.20.
-- The monthly_rate in circle_properties/circle_room_types is NOT linked to the
-- hotels/rooms Model-3 uses, so the Circle owner supplies their purchase price at
-- publish; we freeze it on the lot.
ALTER TABLE public.auction_lots
  ADD COLUMN IF NOT EXISTS purchase_price_per_night NUMERIC;

COMMENT ON COLUMN public.auction_lots.purchase_price_per_night IS
  'Circle-owner acquisition cost per room-night (monthly purchase rate ÷ 30). Floor = this × circle_floor_multiplier (1.20). NULL for property-owner lots (they use floorPrice).';

-- Fix the two demo Circle-owner lots to the CORRECT purchase-based floor:
--   Mussoorie: ₹30,000/mo → ₹1,000/night → floor ₹1,200 (×1.20)
--   Manali:    ₹24,000/mo → ₹800/night   → floor ₹960  (×1.20)
UPDATE public.auction_lots SET purchase_price_per_night = 1000, min_bid_per_room_night = 1200,
  metadata = metadata || '{"monthly_rate":30000}'::jsonb, updated_at = now()
  WHERE id = 'lot_demo_hcomusr1';
UPDATE public.auction_lots SET purchase_price_per_night = 800, min_bid_per_room_night = 960,
  metadata = metadata || '{"monthly_rate":24000}'::jsonb, updated_at = now()
  WHERE id = 'lot_demo_hcomanr1';
