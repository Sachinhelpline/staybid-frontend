-- v722 Gap-1 — dynamic customer bid floor (admin-configurable, default OFF).
--
-- Adds three knobs to the existing pricing_engine_config singleton so the
-- CUSTOMER reverse-auction bid floor can track the live (season-adjusted) price
-- instead of the bare static rooms.floorPrice. Default 'static' keeps today's
-- exact behaviour (byte-identical); the owner opts in to 'dynamic' and tunes the
-- discount / floor fraction from the admin Pricing Engine tab. Resolver:
-- lib/pricing/engine-config-store.ts. Applied by the spine (computeRoomDatePrice
-- → bidFloor) so the cron-written room_date_price.bid_floor + every reader
-- (hotel page arena, /bid autopilot) pick it up automatically. Additive only.

ALTER TABLE pricing_engine_config
  ADD COLUMN IF NOT EXISTS cust_floor_mode                 text    DEFAULT 'static',
  ADD COLUMN IF NOT EXISTS cust_floor_max_win_discount_pct numeric DEFAULT 25,
  ADD COLUMN IF NOT EXISTS cust_floor_min_fraction         numeric DEFAULT 1.0;

UPDATE pricing_engine_config
  SET cust_floor_mode                 = COALESCE(cust_floor_mode, 'static'),
      cust_floor_max_win_discount_pct = COALESCE(cust_floor_max_win_discount_pct, 25),
      cust_floor_min_fraction         = COALESCE(cust_floor_min_fraction, 1.0)
  WHERE id = 'default';
