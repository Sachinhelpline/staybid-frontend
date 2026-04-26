-- AI Dynamic Pricing Engine — additive only (applied via Supabase MCP).
CREATE TABLE IF NOT EXISTS public.room_pricing_config (
  id              TEXT PRIMARY KEY DEFAULT ('rpc_' || gen_random_uuid()::text),
  room_id         TEXT NOT NULL, hotel_id TEXT NOT NULL,
  floor_price     NUMERIC(10,2) NOT NULL, current_price NUMERIC(10,2) NOT NULL,
  competitor_min  NUMERIC(10,2),
  discount_pct    NUMERIC(4,2) NOT NULL DEFAULT 7.0,
  ai_managed      BOOLEAN NOT NULL DEFAULT TRUE,
  last_updated    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_rpc_room ON public.room_pricing_config(room_id);
CREATE INDEX IF NOT EXISTS idx_rpc_hotel ON public.room_pricing_config(hotel_id);

CREATE TABLE IF NOT EXISTS public.competitor_prices (
  id          TEXT PRIMARY KEY DEFAULT ('cp_' || gen_random_uuid()::text),
  hotel_id    TEXT NOT NULL, room_type TEXT, platform TEXT NOT NULL,
  price       NUMERIC(10,2) NOT NULL, date DATE,
  fetched_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cp_hotel   ON public.competitor_prices(hotel_id);
CREATE INDEX IF NOT EXISTS idx_cp_fetched ON public.competitor_prices(fetched_at DESC);

CREATE TABLE IF NOT EXISTS public.price_history (
  id           TEXT PRIMARY KEY DEFAULT ('ph_' || gen_random_uuid()::text),
  room_id      TEXT, hotel_id TEXT, flash_deal_id TEXT,
  old_price    NUMERIC(10,2), new_price NUMERIC(10,2) NOT NULL,
  reason       TEXT NOT NULL, triggered_by TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.bid_decisions (
  id              TEXT PRIMARY KEY DEFAULT ('bd_' || gen_random_uuid()::text),
  bid_id          TEXT, booking_id TEXT, hotel_id TEXT, room_id TEXT,
  bid_amount      NUMERIC(10,2) NOT NULL, floor_price NUMERIC(10,2) NOT NULL,
  decision        TEXT NOT NULL,
  escalated_at    TIMESTAMPTZ, hotel_decision TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.flash_deals ADD COLUMN IF NOT EXISTS start_price        NUMERIC(10,2);
ALTER TABLE public.flash_deals ADD COLUMN IF NOT EXISTS drop_interval_mins INT NOT NULL DEFAULT 30;
ALTER TABLE public.flash_deals ADD COLUMN IF NOT EXISTS drop_amount        NUMERIC(10,2) NOT NULL DEFAULT 50;
ALTER TABLE public.flash_deals ADD COLUMN IF NOT EXISTS rise_trigger_pct   NUMERIC(4,2) NOT NULL DEFAULT 60;
ALTER TABLE public.flash_deals ADD COLUMN IF NOT EXISTS last_drop_at       TIMESTAMPTZ;

GRANT ALL ON public.room_pricing_config, public.competitor_prices,
             public.price_history, public.bid_decisions
  TO anon, authenticated, service_role;

ALTER TABLE public.room_pricing_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.competitor_prices   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.price_history       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bid_decisions       ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='room_pricing_config' AND policyname='all_anon_all') THEN
    EXECUTE 'CREATE POLICY all_anon_all ON public.room_pricing_config FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='competitor_prices' AND policyname='all_anon_all') THEN
    EXECUTE 'CREATE POLICY all_anon_all ON public.competitor_prices FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='price_history' AND policyname='all_anon_all') THEN
    EXECUTE 'CREATE POLICY all_anon_all ON public.price_history FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='bid_decisions' AND policyname='all_anon_all') THEN
    EXECUTE 'CREATE POLICY all_anon_all ON public.bid_decisions FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
