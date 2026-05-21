-- v170 — Staff & Roles (partner panel, Phase 3).
--
-- hotel_staff — login accounts a hotel owner creates for their team.
-- Each staff member signs in at /partner/staff with a login code + PIN
-- and gets a role-scoped dashboard (front_desk / housekeeping / manager).
--
-- Apply once in the Supabase SQL editor for project uxxhbdqedazpmvbvaosh.
-- The /api/partner/staff route degrades gracefully until applied.

CREATE TABLE IF NOT EXISTS public.hotel_staff (
  id            TEXT PRIMARY KEY,
  hotel_id      TEXT NOT NULL,
  owner_id      TEXT,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'front_desk',  -- manager | front_desk | housekeeping
  login_code    TEXT NOT NULL,
  pin_hash      TEXT NOT NULL,
  active        BOOLEAN NOT NULL DEFAULT true,
  created_by    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_staff_login_code ON public.hotel_staff (login_code);
CREATE INDEX        IF NOT EXISTS idx_staff_hotel       ON public.hotel_staff (hotel_id);

ALTER TABLE public.hotel_staff ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='hotel_staff' AND policyname='hotel_staff_all_anon'
  ) THEN
    CREATE POLICY hotel_staff_all_anon ON public.hotel_staff
      FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;
