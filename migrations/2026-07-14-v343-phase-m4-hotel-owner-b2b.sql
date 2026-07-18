-- v343 — Circle Marketplace Phase M4: Model-4 B2B SUPPLY side (hotel-owner listing).
--
-- Additive, forward-only. This file RECORDS the DDL already applied live to
-- Supabase project uxxhbdqedazpmvbvaosh (verified 2026-07-14 via
-- information_schema.columns + pg_indexes). Re-running it is a no-op (guards).
--
-- WHAT CHANGES
--   b2b_listings + b2b_trades each gain a `source` discriminator so the SAME
--   D1 listing table + D2 trade/checkout/verify chain can carry a NEW
--   Model-4 SUPPLY path: a hotel OWNER (classic OR operated) lists room-nights
--   from their OWN inventory (no pre-bought inventory_block).
--     - source = 'investor_block' (DEFAULT) → the existing D1–D4 investor path
--       (list a block you own; on buy, transfer investor_user_id seller→buyer).
--     - source = 'hotel_owner'              → the NEW M4 supply path (list from
--       hotel inventory; on buy, assignFreeUnit + a NEW buyer inventory_block +
--       room_blocks hold + stampUnitOwner on the buyer).
--   block_id / unit_id become NULLABLE because a hotel_owner listing has NO
--   pre-bought block/unit yet (unit is auto-assigned at checkout).
--
-- NOTE: there is intentionally NO CHECK constraint on `source` (matches live).
--   The valid set {investor_block, hotel_owner} is enforced in the API layer
--   (same discipline as workforce_workers.status — a new source value is a code
--   change, not a migration + constraint drop). Both indexes are (source,status).

-- ---------------------------------------------------------------------------
-- b2b_listings
-- ---------------------------------------------------------------------------
ALTER TABLE public.b2b_listings
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'investor_block';

ALTER TABLE public.b2b_listings ALTER COLUMN block_id DROP NOT NULL;
ALTER TABLE public.b2b_listings ALTER COLUMN unit_id  DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_b2b_listings_source
  ON public.b2b_listings (source, status);

-- ---------------------------------------------------------------------------
-- b2b_trades
-- ---------------------------------------------------------------------------
ALTER TABLE public.b2b_trades
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'investor_block';

ALTER TABLE public.b2b_trades ALTER COLUMN block_id DROP NOT NULL;
ALTER TABLE public.b2b_trades ALTER COLUMN unit_id  DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_b2b_trades_source
  ON public.b2b_trades (source, status);

COMMENT ON COLUMN public.b2b_listings.source IS
  'investor_block (D1 investor path) | hotel_owner (M4 hotel-inventory supply). Enforced in API layer.';
COMMENT ON COLUMN public.b2b_trades.source IS
  'investor_block (D2 ownership transfer) | hotel_owner (M4 new pending block + unit stamp on buyer).';
