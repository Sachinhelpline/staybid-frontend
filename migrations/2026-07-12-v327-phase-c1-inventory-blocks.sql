-- ════════════════════════════════════════════════════════════════════════
-- v327 — StayBid Circle Phase C1: Model 3 pre-buy inventory blocks (foundation)
--
-- Model 3 (pre-buy + resell, commerce): a Circle investor who OWNS a physical
-- unit (hotel_room_units.owner_user_id) takes commercial control of a specific
-- DATE RANGE of that unit — buys those room-nights wholesale from StayBid
-- (Pricing-Spine floor), sets a retail resale price, and (later phases) resells
-- on StayBid's own surfaces at their own margin. Unsold risk is the investor's.
--
-- C1 is the INERT foundation: table + read/quote/draft only. NO money, NO
-- room_blocks hold, NO consumer-feed exposure, NO settlement — those are C2/C3.
-- Additive-only; touches nothing existing. `draft`/`quoted` blocks are dormant.
-- ════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.inventory_blocks (
  id                      TEXT PRIMARY KEY DEFAULT ('inv_' || replace(gen_random_uuid()::text, '-', '')),
  investor_user_id        TEXT NOT NULL,          -- canonical owner id (cross-pool resolved)
  hotel_id                TEXT NOT NULL,
  unit_id                 TEXT NOT NULL,          -- hotel_room_units.id the investor owns
  room_id                 TEXT NOT NULL,          -- rooms category id (= unit.roomId) for Spine pricing
  date_from               DATE NOT NULL,
  date_to                 DATE NOT NULL,          -- exclusive checkout; nights = date_to - date_from
  nights                  INTEGER NOT NULL,
  buy_price_per_night     NUMERIC,               -- wholesale (Spine floor), frozen at quote/purchase
  buy_total               NUMERIC,
  resale_price_per_night  NUMERIC,               -- investor retail; NULL until they set it
  platform_fee_pct        NUMERIC,               -- fee taken on resale (frozen at purchase)
  status                  TEXT NOT NULL DEFAULT 'draft',
  buyback_enabled         BOOLEAN NOT NULL DEFAULT false,
  razorpay_order_id       TEXT,
  razorpay_payment_id     TEXT,
  purchased_at            TIMESTAMPTZ,
  listed_at               TIMESTAMPTZ,
  sold_at                 TIMESTAMPTZ,
  metadata                JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT inventory_blocks_status_chk CHECK (
    status IN ('draft','quoted','pending_payment','owned','listed','sold','expired','cancelled','refunded')
  ),
  CONSTRAINT inventory_blocks_range_chk CHECK (date_to > date_from AND nights > 0)
);

-- Investor dashboard: "my blocks" by status.
CREATE INDEX IF NOT EXISTS idx_inv_blocks_investor ON public.inventory_blocks (investor_user_id, status);
-- Overlap guard + unit timeline.
CREATE INDEX IF NOT EXISTS idx_inv_blocks_unit_range ON public.inventory_blocks (unit_id, date_from, date_to);
-- Hotel-level admin views.
CREATE INDEX IF NOT EXISTS idx_inv_blocks_hotel ON public.inventory_blocks (hotel_id, status);
-- Consumer-feed surfacing (C3) reads only LIVE resale inventory — partial index.
CREATE INDEX IF NOT EXISTS idx_inv_blocks_listed
  ON public.inventory_blocks (room_id, date_from, date_to)
  WHERE status = 'listed';

-- Permissive RLS (matches the project baseline — server routes are the real gate).
ALTER TABLE public.inventory_blocks ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='inventory_blocks' AND policyname='inventory_blocks_all_anon'
  ) THEN
    CREATE POLICY inventory_blocks_all_anon ON public.inventory_blocks
      FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;
