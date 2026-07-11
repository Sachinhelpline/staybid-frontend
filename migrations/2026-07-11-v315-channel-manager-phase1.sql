-- v315 — Unified Channel Manager, Phase 1 (sync-engine foundation).
--
-- 1) Provision channel_connections (the 2026-05-21 migration file was never
--    applied to the live DB — /api/partner/channels has been returning
--    provisioned:false since v170) + health columns.
-- 2) Formalize ota_feeds (existed live WITHOUT a migration file) + the new
--    sync-engine columns (connectionId link, autoSync, per-feed interval,
--    consecutiveFailures auto-pause counter, import/remove counters).
-- 3) NEW channel_sync_logs — audit trail for every import/export/push run.
-- 4) NEW channel_room_mappings — local room ↔ OTA room/rate-plan ref +
--    per-channel markup (consumed from Phase 3; schema locked now).
--
-- Additive + idempotent. Applied live via Supabase MCP at v315 ship time.

-- ─────────────────────────────────────────────────────────────────────────
-- 1) channel_connections (same definition as 2026-05-21 file + health cols)
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.channel_connections (
  id           TEXT PRIMARY KEY,
  hotel_id     TEXT NOT NULL,
  ota          TEXT NOT NULL,                       -- booking | mmt | airbnb | agoda | goibibo | expedia | ...
  mode         TEXT NOT NULL DEFAULT 'api',         -- api | ical | manual
  label        TEXT,
  api_key      TEXT,
  api_secret   TEXT,
  property_id  TEXT,
  endpoint_url TEXT,
  status       TEXT NOT NULL DEFAULT 'configured',  -- configured | active | error | paused
  note         TEXT,
  updated_by   TEXT,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_channel       ON public.channel_connections (hotel_id, ota);
CREATE INDEX        IF NOT EXISTS idx_channel_hotel  ON public.channel_connections (hotel_id);

ALTER TABLE public.channel_connections ADD COLUMN IF NOT EXISTS health_status  TEXT;         -- ok | warning | error
ALTER TABLE public.channel_connections ADD COLUMN IF NOT EXISTS last_health_at TIMESTAMPTZ;

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

-- ─────────────────────────────────────────────────────────────────────────
-- 2) ota_feeds — formalize + sync-engine columns (camelCase like the live table)
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ota_feeds (
  id               TEXT PRIMARY KEY,
  "hotelId"        TEXT NOT NULL,
  "roomId"         TEXT NOT NULL,
  provider         TEXT NOT NULL,
  "icalUrl"        TEXT NOT NULL,
  label            TEXT,
  active           BOOLEAN NOT NULL DEFAULT TRUE,
  "lastSyncAt"     TIMESTAMPTZ,
  "lastSyncStatus" TEXT,
  "lastSyncError"  TEXT,
  "lastEventCount" INTEGER,
  "createdAt"      TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.ota_feeds ADD COLUMN IF NOT EXISTS "connectionId"        TEXT;
ALTER TABLE public.ota_feeds ADD COLUMN IF NOT EXISTS "autoSync"            BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE public.ota_feeds ADD COLUMN IF NOT EXISTS "syncIntervalMin"     INTEGER NOT NULL DEFAULT 30;
ALTER TABLE public.ota_feeds ADD COLUMN IF NOT EXISTS "consecutiveFailures" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.ota_feeds ADD COLUMN IF NOT EXISTS "lastImportedCount"   INTEGER;
ALTER TABLE public.ota_feeds ADD COLUMN IF NOT EXISTS "lastRemovedCount"    INTEGER;

CREATE INDEX IF NOT EXISTS idx_ota_feeds_hotel ON public.ota_feeds ("hotelId");
CREATE INDEX IF NOT EXISTS idx_ota_feeds_due   ON public.ota_feeds (active, "autoSync", "lastSyncAt")
  WHERE active AND "autoSync";

ALTER TABLE public.ota_feeds ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='ota_feeds' AND policyname='ota_feeds_all_anon'
  ) THEN
    CREATE POLICY ota_feeds_all_anon ON public.ota_feeds
      FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 3) channel_sync_logs — audit trail (snake_case, new-table convention)
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.channel_sync_logs (
  id             TEXT PRIMARY KEY,
  hotel_id       TEXT NOT NULL,
  feed_id        TEXT,
  connection_id  TEXT,
  provider       TEXT,
  direction      TEXT NOT NULL DEFAULT 'import',   -- import | export | push
  status         TEXT NOT NULL,                    -- ok | empty | error
  events_total   INTEGER,
  blocks_added   INTEGER,
  blocks_removed INTEGER,
  error          TEXT,
  duration_ms    INTEGER,
  triggered_by   TEXT,                             -- manual | cron | system
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_csl_hotel ON public.channel_sync_logs (hotel_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_csl_feed  ON public.channel_sync_logs (feed_id, created_at DESC);

ALTER TABLE public.channel_sync_logs ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='channel_sync_logs' AND policyname='channel_sync_logs_all_anon'
  ) THEN
    CREATE POLICY channel_sync_logs_all_anon ON public.channel_sync_logs
      FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 4) channel_room_mappings — room ↔ OTA ref + markup (Phase 3 consumer)
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.channel_room_mappings (
  id                TEXT PRIMARY KEY,
  connection_id     TEXT NOT NULL,
  hotel_id          TEXT NOT NULL,
  room_id           TEXT NOT NULL,
  ota_room_ref      TEXT,
  ota_rate_plan_ref TEXT,
  markup_pct        NUMERIC NOT NULL DEFAULT 0,
  active            BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_crm_conn_room ON public.channel_room_mappings (connection_id, room_id);
CREATE INDEX        IF NOT EXISTS idx_crm_hotel      ON public.channel_room_mappings (hotel_id);

ALTER TABLE public.channel_room_mappings ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='channel_room_mappings' AND policyname='channel_room_mappings_all_anon'
  ) THEN
    CREATE POLICY channel_room_mappings_all_anon ON public.channel_room_mappings
      FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;
