-- v173 — F&B QR ordering (partner panel, Phase 2).
--
-- food_outlets     — ordering points (Room Service, Restaurant, Pool Bar…).
--                    Each outlet id is its public QR URL: /order/<id>.
-- food_orders      — orders placed by guests via the QR menu.
-- food_order_items — order line items.
--
-- Apply once in the Supabase SQL editor for project uxxhbdqedazpmvbvaosh.

CREATE TABLE IF NOT EXISTS public.food_outlets (
  id         TEXT PRIMARY KEY,
  hotel_id   TEXT NOT NULL,
  name       TEXT NOT NULL,
  type       TEXT NOT NULL DEFAULT 'room_service',   -- room_service | restaurant | other
  active     BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_outlet_hotel ON public.food_outlets (hotel_id);

CREATE TABLE IF NOT EXISTS public.food_orders (
  id           TEXT PRIMARY KEY,
  hotel_id     TEXT NOT NULL,
  outlet_id    TEXT,
  outlet_name  TEXT,
  location     TEXT,                                  -- room / table the guest entered
  guest_name   TEXT,
  guest_phone  TEXT,
  items_total  NUMERIC NOT NULL DEFAULT 0,
  status       TEXT NOT NULL DEFAULT 'pending',       -- pending | verified | rejected | added_to_folio
  note         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_forder_hotel ON public.food_orders (hotel_id);

CREATE TABLE IF NOT EXISTS public.food_order_items (
  id          TEXT PRIMARY KEY,
  order_id    TEXT NOT NULL,
  hotel_id    TEXT NOT NULL,
  item_name   TEXT NOT NULL,
  portion     TEXT,
  qty         NUMERIC NOT NULL DEFAULT 1,
  unit_price  NUMERIC NOT NULL DEFAULT 0,
  amount      NUMERIC NOT NULL DEFAULT 0,
  food_type   TEXT
);
CREATE INDEX IF NOT EXISTS idx_foitem_order ON public.food_order_items (order_id);

ALTER TABLE public.food_outlets     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.food_orders      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.food_order_items ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='food_outlets' AND policyname='food_outlets_all_anon') THEN
    CREATE POLICY food_outlets_all_anon ON public.food_outlets FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='food_orders' AND policyname='food_orders_all_anon') THEN
    CREATE POLICY food_orders_all_anon ON public.food_orders FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='food_order_items' AND policyname='food_order_items_all_anon') THEN
    CREATE POLICY food_order_items_all_anon ON public.food_order_items FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;
