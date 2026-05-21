-- v170 — Guest CRM (partner panel, Phase 3).
--
-- guest_profiles — one saved record per guest per hotel, holding the
-- CRM extras (tags, VIP flag, notes). Stay history itself is aggregated
-- live from bids + reservations + folios, so this table only stores what
-- the partner adds by hand.
--
-- Apply once in the Supabase SQL editor for project uxxhbdqedazpmvbvaosh.
-- The /api/partner/guests route degrades gracefully until applied.

CREATE TABLE IF NOT EXISTS public.guest_profiles (
  id          TEXT PRIMARY KEY,
  hotel_id    TEXT NOT NULL,
  guest_key   TEXT NOT NULL,                       -- normalized phone, or name fallback
  name        TEXT,
  phone       TEXT,
  email       TEXT,
  tags        JSONB NOT NULL DEFAULT '[]'::jsonb,
  vip         BOOLEAN NOT NULL DEFAULT false,
  note        TEXT,
  updated_by  TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_guest_profile  ON public.guest_profiles (hotel_id, guest_key);
CREATE INDEX        IF NOT EXISTS idx_guest_profiles  ON public.guest_profiles (hotel_id);

ALTER TABLE public.guest_profiles ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='guest_profiles' AND policyname='guest_profiles_all_anon'
  ) THEN
    CREATE POLICY guest_profiles_all_anon ON public.guest_profiles
      FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;
