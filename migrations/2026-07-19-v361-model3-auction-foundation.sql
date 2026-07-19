-- v361 — StayBid Circle "Model 3": Monthly B2B Inventory AUCTION for Travel Agents.
-- Phase 0 (Foundation). Additive, forward-only. NO money path here (that lands
-- in Phase 2/3). NO FK constraints (house rule). TEXT ids (genId prefixes).
--
-- WHAT THIS MODEL IS
--   Any property owner publishes spare inventory for an UPCOMING WHOLE MONTH as
--   an auction "lot". Approved travel agents/agencies browse a city calendar,
--   place SEALED bids (full-month / a single week / weekends), pay a refundable
--   EMD deposit, and at the month-end window close the HIGHEST ₹/room/night bids
--   are auto-allotted clash-free. Winners pay the balance → get a voucher.
--
-- TABLES
--   trade_agents    — travel-agent/agency account (Google-auth identity + admin approval).
--   auction_config  — admin singleton (buyer premium %, seller fee %, deposit %, window/pay timing).
--   auction_lots    — one owner-published monthly inventory lot.
--   auction_bids    — one sealed bid by an agent on a lot for a chosen segment.
--   auction_awards  — clearing result: a winning bid's allotment + voucher + settlement figures.
--
-- Namespace note: the `/agent` route + `sb_agent_*` token already belong to the
-- customer-SUPPORT panel. Travel agents use a DISTINCT `sb_trade_*` namespace and
-- the `trade_agents` table — no collision.

-- ---------------------------------------------------------------------------
-- trade_agents — travel agent / agency account
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.trade_agents (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,               -- normalized auth id (Firebase/Google uid or backend CUID)
  email        TEXT,
  name         TEXT,                         -- contact person
  agency_name  TEXT,
  phone        TEXT,
  city         TEXT,
  category     TEXT NOT NULL DEFAULT 'standard',  -- future access-tier gate
  gst          TEXT,
  status       TEXT NOT NULL DEFAULT 'pending',   -- pending | approved | rejected | suspended
  kyc          JSONB,
  metadata     JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- One agent row per human (auth id). Browsing is open to anyone; this uniqueness
-- only governs the registered agent identity.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_trade_agent_user ON public.trade_agents (user_id);
CREATE INDEX IF NOT EXISTS idx_trade_agents_status     ON public.trade_agents (status);
CREATE INDEX IF NOT EXISTS idx_trade_agents_email      ON public.trade_agents (lower(email));

-- ---------------------------------------------------------------------------
-- auction_config — admin-editable singleton (mirrors b2b_fee_config pattern)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.auction_config (
  id                 TEXT PRIMARY KEY,
  buyer_premium_pct  NUMERIC NOT NULL DEFAULT 5,    -- added on top of the winning bid (agent pays)
  seller_fee_pct     NUMERIC NOT NULL DEFAULT 5,    -- deducted from owner net
  deposit_pct        NUMERIC NOT NULL DEFAULT 10,   -- EMD = deposit_pct% of the bid total
  window_open_day    INT     NOT NULL DEFAULT 24,   -- day of the PREVIOUS month the auction opens
  pay_window_hours   INT     NOT NULL DEFAULT 48,   -- winner's balance-pay window after clearing
  min_bid_floor_mode TEXT    NOT NULL DEFAULT 'spine', -- 'spine' = Spine bidFloor is the hard floor
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO public.auction_config (id) VALUES ('default') ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- auction_lots — one owner-published monthly inventory lot
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.auction_lots (
  id                     TEXT PRIMARY KEY,
  owner_user_id          TEXT NOT NULL,       -- property owner (partner) id
  hotel_id               TEXT NOT NULL,
  room_id                TEXT NOT NULL,
  category               TEXT,                -- room-type name, denormalized for display
  city                   TEXT,
  month_key              TEXT NOT NULL,       -- 'YYYY-MM' e.g. '2026-08'
  month_start            DATE NOT NULL,       -- inclusive first night
  month_end              DATE NOT NULL,       -- EXCLUSIVE (first of next month)
  num_rooms              INT  NOT NULL DEFAULT 1,  -- units offered (snapshot of free units)
  min_bid_per_room_night NUMERIC NOT NULL,    -- floor per room per night (Spine bidFloor)
  window_open_at         TIMESTAMPTZ NOT NULL,
  window_close_at        TIMESTAMPTZ NOT NULL,
  status                 TEXT NOT NULL DEFAULT 'draft', -- draft|open|closed|awarded|cancelled
  metadata               JSONB,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_auction_lots_city_status  ON public.auction_lots (city, status);
CREATE INDEX IF NOT EXISTS idx_auction_lots_owner        ON public.auction_lots (owner_user_id);
CREATE INDEX IF NOT EXISTS idx_auction_lots_hotel_month  ON public.auction_lots (hotel_id, month_key);
CREATE INDEX IF NOT EXISTS idx_auction_lots_close        ON public.auction_lots (status, window_close_at);
-- One live lot per (hotel, room, month) so republish can't duplicate a lot.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_auction_lot_live
  ON public.auction_lots (hotel_id, room_id, month_key)
  WHERE status IN ('draft','open','closed');

-- ---------------------------------------------------------------------------
-- auction_bids — a sealed bid on a lot for a chosen segment
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.auction_bids (
  id                 TEXT PRIMARY KEY,
  lot_id             TEXT NOT NULL,
  agent_user_id      TEXT NOT NULL,          -- agent's normalized auth id
  agent_id           TEXT,                    -- trade_agents.id
  segment_type       TEXT NOT NULL,           -- full_month | week | weekend
  segment_label      TEXT,                    -- 'Full month' | 'Week 2' | 'Weekends'
  date_from          DATE,                    -- segment bound (inclusive)
  date_to            DATE,                    -- segment bound (EXCLUSIVE)
  night_dates        JSONB NOT NULL,          -- exact ISO nights this bid covers
  nights             INT  NOT NULL,           -- count(night_dates)
  per_room_bid       NUMERIC NOT NULL,        -- agent's bid per room for the WHOLE segment
  per_room_per_night NUMERIC NOT NULL,        -- frozen comparator = per_room_bid / nights
  rooms_wanted       INT  NOT NULL DEFAULT 1, -- max rooms desired (1..lot.num_rooms)
  deposit_amount     NUMERIC NOT NULL DEFAULT 0, -- EMD frozen at bid (server-computed)
  rooms_awarded      INT  NOT NULL DEFAULT 0,
  status             TEXT NOT NULL DEFAULT 'pending_payment',
                     -- pending_payment | active | won | partial | lost | refunded | cancelled
  razorpay_order_id  TEXT,
  razorpay_payment_id TEXT,
  metadata           JSONB,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_auction_bids_lot_status ON public.auction_bids (lot_id, status);
CREATE INDEX IF NOT EXISTS idx_auction_bids_agent      ON public.auction_bids (agent_user_id);
CREATE INDEX IF NOT EXISTS idx_auction_bids_order      ON public.auction_bids (razorpay_order_id);

-- ---------------------------------------------------------------------------
-- auction_awards — clearing result (one row per winning bid)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.auction_awards (
  id                 TEXT PRIMARY KEY,
  lot_id             TEXT NOT NULL,
  bid_id             TEXT NOT NULL,
  agent_user_id      TEXT NOT NULL,
  agent_id           TEXT,
  owner_user_id      TEXT,
  hotel_id           TEXT,
  room_id            TEXT,
  city               TEXT,
  month_key          TEXT,
  segment_label      TEXT,
  night_dates        JSONB,
  unit_ids           JSONB,                   -- physical hotel_room_units assigned (at pay time)
  rooms_awarded      INT  NOT NULL DEFAULT 0,
  per_room_per_night NUMERIC,
  base_total         NUMERIC,                 -- winning bid × rooms × (already per-segment)
  buyer_fee          NUMERIC,                 -- buyer premium (added on top)
  seller_fee         NUMERIC,                 -- deducted from owner
  seller_net         NUMERIC,                 -- owner receives
  platform_fee       NUMERIC,                 -- buyer_fee + seller_fee
  amount_due         NUMERIC NOT NULL DEFAULT 0, -- balance owed at pay = base_total + buyer_fee − deposit
  amount_paid        NUMERIC NOT NULL DEFAULT 0,
  deposit_applied    NUMERIC NOT NULL DEFAULT 0,
  voucher_code       TEXT,
  pay_window_close_at TIMESTAMPTZ,
  status             TEXT NOT NULL DEFAULT 'awarded',
                     -- awarded | paid | voucher_issued | expired | cancelled
  razorpay_order_id  TEXT,
  razorpay_payment_id TEXT,
  metadata           JSONB,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_auction_awards_agent  ON public.auction_awards (agent_user_id);
CREATE INDEX IF NOT EXISTS idx_auction_awards_lot    ON public.auction_awards (lot_id);
CREATE INDEX IF NOT EXISTS idx_auction_awards_status ON public.auction_awards (status);
-- One award per bid (idempotent clearing).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_auction_award_bid ON public.auction_awards (bid_id);

-- ---------------------------------------------------------------------------
-- RLS — permissive (app talks via server routes under service-role, mirrors
-- every other StayBid table). Enable + open policy so anon/authenticated reads
-- keep working exactly like b2b_* tables.
-- ---------------------------------------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['trade_agents','auction_config','auction_lots','auction_bids','auction_awards']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=t
        AND policyname = t || '_all_anon'
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)',
        t || '_all_anon', t);
    END IF;
  END LOOP;
END $$;

COMMENT ON TABLE public.trade_agents  IS 'Model 3 travel-agent/agency account (Google-auth identity + admin approval). Browse open; bid requires status=approved.';
COMMENT ON TABLE public.auction_lots  IS 'Model 3 owner-published monthly inventory lot. min_bid_per_room_night = Spine bidFloor (owner never sells below cost).';
COMMENT ON TABLE public.auction_bids  IS 'Model 3 sealed bid. per_room_per_night = per_room_bid/nights is the frozen clearing comparator across full-month/week/weekend segments.';
COMMENT ON TABLE public.auction_awards IS 'Model 3 clearing result: winning bid allotment + voucher + tamper-safe settlement figures.';
COMMENT ON TABLE public.auction_config IS 'Model 3 admin singleton: buyer premium %, seller fee %, EMD deposit %, auction window + pay-window timing.';
