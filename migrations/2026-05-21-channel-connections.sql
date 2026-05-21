-- v170 — Channel Manager (partner panel, Phase 3).
--
-- channel_connections — one row per (hotel, OTA). Stores the credentials
-- the hotel owner gets from their own OTA partner account (Booking.com,
-- MakeMyTrip, Airbnb, Agoda, Goibibo, Expedia…). The owner just pastes
-- key / secret / property-id / endpoint and the connection is provisioned.
--
-- Apply once in the Supabase SQL editor for project uxxhbdqedazpmvbvaosh.
-- The /api/partner/channels route degrades gracefully until applied.

CREATE TABLE IF NOT EXISTS public.channel_connections (
  id           TEXT PRIMARY KEY,
  hotel_id     TEXT NOT NULL,
  ota          TEXT NOT NULL,                       -- booking | mmt | airbnb | agoda | goibibo | expedia | other
  mode         TEXT NOT NULL DEFAULT 'api',         -- api | ical
  label        TEXT,
  api_key      TEXT,
  api_secret   TEXT,
  property_id  TEXT,
  endpoint_url TEXT,
  status       TEXT NOT NULL DEFAULT 'configured',  -- configured | active | error
  note         TEXT,
  updated_by   TEXT,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_channel       ON public.channel_connections (hotel_id, ota);
CREATE INDEX        IF NOT EXISTS idx_channel_hotel  ON public.channel_connections (hotel_id);

ALTER TABLE public.channel_connections ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='channel_connections' AND policyname='channel_connections_all_anon'
  ) THEN
    CREATE POLICY channel_connections_all_anon ON public.channel_connections
      FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;
