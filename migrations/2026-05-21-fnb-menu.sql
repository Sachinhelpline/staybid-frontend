-- v172 — Food & Beverage digital menu (partner panel).
--
-- menu_categories — hotel's menu sections (Starters, Main Course…).
-- menu_items      — dishes with veg/nonveg, photo, and portion pricing
--                   (portions JSONB: [{label, price}] — Half/Full etc.).
--
-- Phase 1 of the F&B system (menu builder). QR ordering + billing
-- integration build on top of these tables.
--
-- Apply once in the Supabase SQL editor for project uxxhbdqedazpmvbvaosh.

CREATE TABLE IF NOT EXISTS public.menu_categories (
  id         TEXT PRIMARY KEY,
  hotel_id   TEXT NOT NULL,
  name       TEXT NOT NULL,
  sort       INT  NOT NULL DEFAULT 0,
  active     BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_menu_cat_hotel ON public.menu_categories (hotel_id);

CREATE TABLE IF NOT EXISTS public.menu_items (
  id          TEXT PRIMARY KEY,
  hotel_id    TEXT NOT NULL,
  category_id TEXT,
  name        TEXT NOT NULL,
  description TEXT,
  food_type   TEXT NOT NULL DEFAULT 'veg',          -- veg | nonveg | egg
  image       TEXT,
  portions    JSONB NOT NULL DEFAULT '[]'::jsonb,   -- [{label, price}]
  available   BOOLEAN NOT NULL DEFAULT true,
  sort        INT  NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_menu_item_hotel ON public.menu_items (hotel_id);
CREATE INDEX IF NOT EXISTS idx_menu_item_cat   ON public.menu_items (category_id);

ALTER TABLE public.menu_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.menu_items      ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='menu_categories' AND policyname='menu_categories_all_anon') THEN
    CREATE POLICY menu_categories_all_anon ON public.menu_categories FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='menu_items' AND policyname='menu_items_all_anon') THEN
    CREATE POLICY menu_items_all_anon ON public.menu_items FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;
