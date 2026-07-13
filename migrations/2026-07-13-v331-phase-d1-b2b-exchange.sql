-- ════════════════════════════════════════════════════════════════════════
-- v331 — StayBid Circle Multi-Investor · Phase D1: Model 4 B2B exchange foundation
--
-- Model 4 = intermediary commerce. An investor who OWNS Model-3 inventory
-- (an `inventory_blocks` row in `owned` status — bounded date-range goods)
-- LISTS it on a B2B exchange; ANOTHER investor buys it at the seller's ask.
-- StayBid is the platform + takes a fee. B2B-only (no retail) → far from
-- SEBI/CIS.
--
-- D1 is the INERT ADDITIVE FOUNDATION only:
--   * b2b_listings   — the offer (WRITTEN by D1)
--   * b2b_trades     — buyer purchase   (created-but-unused until D2/D3)
--   * settlement_ledger — money routing (created-but-unused until D3)
--
-- NO trade execution, NO Razorpay, NO ownership transfer, NO settlement —
-- those are D2/D3/D4. Additive-only; nothing existing is touched.
--
-- Applied live to project uxxhbdqedazpmvbvaosh (apply_migration
-- `v331_phase_d1_b2b_exchange`). This file is the audit-trail record.
-- ════════════════════════════════════════════════════════════════════════

-- ── b2b_listings — the exchange offer (one ACTIVE listing per owned block) ──
CREATE TABLE IF NOT EXISTS public.b2b_listings (
  id                text        PRIMARY KEY DEFAULT ('b2bl_' || replace(gen_random_uuid()::text, '-', '')),
  block_id          text        NOT NULL,          -- inventory_blocks.id (must be status='owned' at list time)
  seller_user_id    text        NOT NULL,          -- = the block's investor_user_id (listing/block/unit agree)
  hotel_id          text        NOT NULL,
  unit_id           text        NOT NULL,
  room_id           text        NOT NULL,
  date_from         date        NOT NULL,
  date_to           date        NOT NULL,
  nights            integer     NOT NULL,
  ask_per_night     numeric     NOT NULL,          -- seller's own B2B price (seller sets it — their goods)
  ask_total         numeric     NOT NULL,          -- round(ask_per_night * nights) = what a buyer pays
  buy_total         numeric,                        -- seller cost snapshot (for margin display only)
  platform_fee_pct  numeric     NOT NULL,          -- StayBid's cut % — FROZEN server-side (tamper-safe)
  status            text        NOT NULL DEFAULT 'listed',
  metadata          jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT b2b_listings_range_chk  CHECK (date_to > date_from AND nights > 0),
  CONSTRAINT b2b_listings_status_chk CHECK (status = ANY (ARRAY['draft','listed','sold','cancelled','withdrawn','expired']))
);

CREATE INDEX  IF NOT EXISTS idx_b2b_listings_block  ON public.b2b_listings (block_id);
CREATE INDEX  IF NOT EXISTS idx_b2b_listings_seller ON public.b2b_listings (seller_user_id, status);
CREATE INDEX  IF NOT EXISTS idx_b2b_listings_hotel  ON public.b2b_listings (hotel_id, status);
CREATE INDEX  IF NOT EXISTS idx_b2b_listings_live   ON public.b2b_listings (status) WHERE status = 'listed';
-- At most ONE active (draft|listed) B2B listing per owned block:
CREATE UNIQUE INDEX IF NOT EXISTS uniq_b2b_listing_active_block
  ON public.b2b_listings (block_id) WHERE status IN ('draft','listed');

-- ── b2b_trades — buyer purchase (created-but-unused; D2/D3) ──
CREATE TABLE IF NOT EXISTS public.b2b_trades (
  id                   text        PRIMARY KEY DEFAULT ('b2bt_' || replace(gen_random_uuid()::text, '-', '')),
  listing_id           text        NOT NULL,
  block_id             text        NOT NULL,
  seller_user_id       text        NOT NULL,
  buyer_user_id        text        NOT NULL,
  hotel_id             text        NOT NULL,
  unit_id              text        NOT NULL,
  room_id              text        NOT NULL,
  date_from            date        NOT NULL,
  date_to              date        NOT NULL,
  nights               integer     NOT NULL,
  ask_total            numeric     NOT NULL,        -- buyer pays this
  platform_fee_pct     numeric     NOT NULL,
  platform_fee         numeric     NOT NULL,        -- StayBid cut (out of ask)
  seller_net           numeric     NOT NULL,        -- ask_total - platform_fee
  status               text        NOT NULL DEFAULT 'pending_payment',
  razorpay_order_id    text,
  razorpay_payment_id  text,
  completed_at         timestamptz,
  metadata             jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT b2b_trades_status_chk CHECK (status = ANY (ARRAY['pending_payment','completed','failed','cancelled']))
);

CREATE INDEX  IF NOT EXISTS idx_b2b_trades_listing ON public.b2b_trades (listing_id);
CREATE INDEX  IF NOT EXISTS idx_b2b_trades_seller  ON public.b2b_trades (seller_user_id, status);
CREATE INDEX  IF NOT EXISTS idx_b2b_trades_buyer   ON public.b2b_trades (buyer_user_id, status);
CREATE INDEX  IF NOT EXISTS idx_b2b_trades_order   ON public.b2b_trades (razorpay_order_id);
-- A listing sells once (D3 idempotency):
CREATE UNIQUE INDEX IF NOT EXISTS uniq_b2b_trade_listing_completed
  ON public.b2b_trades (listing_id) WHERE status = 'completed';

-- ── settlement_ledger — generic money-routing record (created-but-unused; D3) ──
CREATE TABLE IF NOT EXISTS public.settlement_ledger (
  id             text        PRIMARY KEY DEFAULT ('setl_' || replace(gen_random_uuid()::text, '-', '')),
  kind           text        NOT NULL,           -- e.g. 'b2b_trade'
  ref_id         text        NOT NULL,           -- the source row id (e.g. b2b_trades.id)
  payee_user_id  text        NOT NULL,           -- who receives net_amount
  gross_amount   numeric     NOT NULL,
  platform_fee   numeric     NOT NULL,
  net_amount     numeric     NOT NULL,
  payout_status  text        NOT NULL DEFAULT 'owed',
  paid_at        timestamptz,
  metadata       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT settlement_ledger_status_chk CHECK (payout_status = ANY (ARRAY['owed','paid','cancelled']))
);

CREATE INDEX  IF NOT EXISTS idx_settlement_kind_ref ON public.settlement_ledger (kind, ref_id);
CREATE INDEX  IF NOT EXISTS idx_settlement_payee    ON public.settlement_ledger (payee_user_id, payout_status);
-- One ledger row per (kind, ref) — D3 double-settle guard:
CREATE UNIQUE INDEX IF NOT EXISTS uniq_settlement_kind_ref
  ON public.settlement_ledger (kind, ref_id);

-- ── RLS: permissive (project baseline — all writes go through server routes) ──
ALTER TABLE public.b2b_listings     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.b2b_trades       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settlement_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS b2b_listings_all_anon     ON public.b2b_listings;
DROP POLICY IF EXISTS b2b_trades_all_anon       ON public.b2b_trades;
DROP POLICY IF EXISTS settlement_ledger_all_anon ON public.settlement_ledger;

CREATE POLICY b2b_listings_all_anon      ON public.b2b_listings
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY b2b_trades_all_anon        ON public.b2b_trades
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY settlement_ledger_all_anon ON public.settlement_ledger
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
