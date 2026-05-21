-- v170 — Guest Billing / Folio / Invoicing (partner panel, Phase 2).
--
-- guest_folios  — one bill per guest stay (open → settled).
-- folio_charges — line items: room / food / laundry / service / misc,
--                 plus kind='payment' rows for money received.
--
-- Apply once in the Supabase SQL editor for project uxxhbdqedazpmvbvaosh.
-- The /api/partner/folios route degrades gracefully until applied.

CREATE TABLE IF NOT EXISTS public.guest_folios (
  id          TEXT PRIMARY KEY,
  hotel_id    TEXT NOT NULL,
  guest_name  TEXT NOT NULL,
  guest_phone TEXT,
  guest_email TEXT,
  ref_type    TEXT,            -- bid | reservation | manual
  ref_id      TEXT,
  check_in    TEXT,
  check_out   TEXT,
  room_label  TEXT,
  status      TEXT NOT NULL DEFAULT 'open',   -- open | settled
  tax_pct     NUMERIC NOT NULL DEFAULT 12,
  discount    NUMERIC NOT NULL DEFAULT 0,
  note        TEXT,
  created_by  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  settled_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_folios_hotel ON public.guest_folios (hotel_id);

CREATE TABLE IF NOT EXISTS public.folio_charges (
  id          TEXT PRIMARY KEY,
  folio_id    TEXT NOT NULL,
  hotel_id    TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'misc',   -- room | food | laundry | service | misc | payment
  label       TEXT NOT NULL,
  qty         NUMERIC NOT NULL DEFAULT 1,
  unit_price  NUMERIC NOT NULL DEFAULT 0,
  amount      NUMERIC NOT NULL DEFAULT 0,
  created_by  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_charges_folio ON public.folio_charges (folio_id);
CREATE INDEX IF NOT EXISTS idx_charges_hotel ON public.folio_charges (hotel_id);

ALTER TABLE public.guest_folios  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.folio_charges ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='guest_folios' AND policyname='guest_folios_all_anon') THEN
    CREATE POLICY guest_folios_all_anon ON public.guest_folios FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='folio_charges' AND policyname='folio_charges_all_anon') THEN
    CREATE POLICY folio_charges_all_anon ON public.folio_charges FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;
