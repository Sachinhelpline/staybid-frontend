-- ============================================================================
-- StayBid for Hosts — Phase 6: Channel Manager (v275)
-- Additive only. One new table: host_channels — a partner's per-OTA connection
-- requests + sync status, surfaced at /host/channels.
-- Mirrors the discovery_inquiries / workforce_jobs lead-capture shape:
-- a partner asks StayBid to connect their listing to an OTA; StayBid's team
-- wires up the real sync and flips status. Real OTA API integration is a
-- backend concern outside this repo — this table is the request + status ledger.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.host_channels (
  id TEXT PRIMARY KEY DEFAULT ('chan_' || gen_random_uuid()::text),
  user_id TEXT,
  channel TEXT NOT NULL CHECK (channel IN (
    'booking','airbnb','mmt','goibibo','agoda','expedia','tripadvisor','other'
  )),
  property_ref TEXT,
  listing_url TEXT,
  contact JSONB,
  status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN (
    'requested','connected','syncing','error','paused'
  )),
  last_sync_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_host_channels_user    ON public.host_channels (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_host_channels_channel ON public.host_channels (channel, status);
CREATE INDEX IF NOT EXISTS idx_host_channels_status  ON public.host_channels (status, created_at DESC);

-- RLS — permissive anon/authenticated, matching every other host table.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['host_channels'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
    BEGIN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);',
        t || '_all_anon', t);
    EXCEPTION WHEN duplicate_object THEN NULL; END;
  END LOOP;
END $$;
