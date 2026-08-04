-- ════════════════════════════════════════════════════════════════════════
-- v733 — Circle Model 2 (B2B): hotel-owner WHOLESALE buy price + admin knob.
--
-- Root cause of "buy price == market price, koi kyun kharidega" (owner report):
-- a HOTEL-OWNER supply listing has NO real acquisition cost, so the old
-- `own × multiplier` model substituted `own = the room's RETAIL FLOOR` and the
-- 2× multiplier landed the buy price AT/ABOVE the live market (live_price is
-- floored at the retail floor). Result: buy == market → zero resale margin.
-- (The demo catalogue seeded own = floor/2, mult = 2 → buy = floor = market.)
--
-- Fix: for hotel-owner supply the buy price is a genuine WHOLESALE DISCOUNT
-- below the retail floor (mirrors the Model-3 wholesale floor). Because the
-- retail floor is the lowest a guest ever pays, buying below it is ALWAYS below
-- the live market, so the resale margin is guaranteed ≥ the discount %, every
-- season, every property. The discount % is admin-tunable.
--
-- Additive + forward-only. Investor-block resale (real cost basis) is untouched.
-- ════════════════════════════════════════════════════════════════════════

-- ① admin knob: wholesale discount % (default 25). Resolved by
--    lib/b2b/fee-config-store.ts → resolveB2bFeeConfig().wholesaleDiscountPct.
ALTER TABLE b2b_fee_config
  ADD COLUMN IF NOT EXISTS wholesale_discount_pct numeric NOT NULL DEFAULT 25;

UPDATE b2b_fee_config
SET wholesale_discount_pct = 25
WHERE id = 'default' AND wholesale_discount_pct IS NULL;

-- ② re-price the demo hotel-owner listings from the broken `own = floor/2,
--    mult = 2 → buy = floor` to the genuine wholesale price
--    `snap100(retailFloor × (1 − 25%))` (own = the wholesale buy, multiplier = 1).
--    retailFloor = the room's floorPrice (= Spine bidFloor for these clean rows).
WITH priced AS (
  SELECT
    l.id,
    r."floorPrice" AS floor_price,
    -- faithful to lib/b2b/engine.ts wholesaleBuyPerNight(floor, 25):
    --   snapped = round( max( round(floor*0.5), round(floor*0.75) ) / 100 ) * 100
    (ROUND(
       GREATEST(ROUND(r."floorPrice" * 0.5), ROUND(r."floorPrice" * 0.75)) / 100.0
     ) * 100)::int AS new_buy,
    l.nights
  FROM b2b_listings l
  JOIN rooms r ON r.id = l.room_id
  WHERE l.source = 'hotel_owner'
    AND (l.metadata->>'demo') = 'true'
)
UPDATE b2b_listings l
SET
  own_per_night    = p.new_buy,
  price_multiplier = 1,
  ask_per_night    = p.new_buy,
  ask_total        = p.new_buy * l.nights,
  buy_total        = p.new_buy * l.nights,   -- wholesale cost basis = the wholesale price
  metadata = l.metadata || jsonb_build_object(
    'ownPerNight', p.new_buy,
    'multiplier', 1,
    'retailFloorPerNight', p.floor_price,
    'wholesaleDiscountPct', 25,
    'repricedV733', true
  ),
  updated_at = now()
FROM priced p
WHERE l.id = p.id;
