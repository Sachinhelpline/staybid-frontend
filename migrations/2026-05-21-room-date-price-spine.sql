-- v165 Phase A — unified pricing spine.
-- One row per (room, date): the single source of truth that the hotel
-- page, /bid auction and flash deals will all read from (Phase C).
-- Purely additive — nothing reads this table yet, so it cannot break
-- any existing flow. Populated by /api/cron/price-spine.
-- Applied to production Supabase (uxxhbdqedazpmvbvaosh) on 2026-05-21
-- via MCP migration `v165_room_date_price_spine`.

CREATE TABLE IF NOT EXISTS public.room_date_price (
  room_id        text NOT NULL,
  hotel_id       text NOT NULL,
  date           date NOT NULL,
  base_rate      numeric NOT NULL DEFAULT 0,   -- hotel reference / market rate (mrp)
  live_price     numeric NOT NULL DEFAULT 0,   -- dynamic customer-facing price
  bid_floor      numeric NOT NULL DEFAULT 0,   -- /bid auction + negotiation floor
  flash_price    numeric NOT NULL DEFAULT 0,   -- flash-deal price
  flash_floor    numeric NOT NULL DEFAULT 0,   -- flash-deal floor
  competitor_min numeric,                       -- cheapest scraped OTA price (nullable)
  vacancy_ratio  numeric,                       -- 0..1 occupancy for this date
  demand_score   integer,                       -- 0..100
  factors        jsonb NOT NULL DEFAULT '[]'::jsonb,
  computed_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (room_id, date)
);

CREATE INDEX IF NOT EXISTS idx_rdp_hotel_date ON public.room_date_price (hotel_id, date);
CREATE INDEX IF NOT EXISTS idx_rdp_date ON public.room_date_price (date);

ALTER TABLE public.room_date_price ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='room_date_price'
      AND policyname='room_date_price_all_anon'
  ) THEN
    CREATE POLICY room_date_price_all_anon ON public.room_date_price
      FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;
