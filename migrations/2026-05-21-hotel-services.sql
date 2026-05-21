-- v176 — Service entitlements + access requests (partner panel, Phase 1).
--
-- hotel_services    — one row per (hotel, service) that is GRANTED. No row
--                     = the service is locked. Default services never need
--                     a row (always free). expires_at in the past = expired.
-- service_requests  — a hotel asks the admin to unlock a service
--                     (kind: activate | free_trial). Admin approves/rejects.
--
-- Apply once in the Supabase SQL editor for project uxxhbdqedazpmvbvaosh.

CREATE TABLE IF NOT EXISTS public.hotel_services (
  id          TEXT PRIMARY KEY,
  hotel_id    TEXT NOT NULL,
  service_key TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'active',   -- active (expiry derived from expires_at)
  access_type TEXT NOT NULL DEFAULT 'free',     -- free | trial | paid
  plan        TEXT,                             -- monthly | quarterly | yearly | null
  expires_at  TIMESTAMPTZ,                      -- null = no expiry
  granted_by  TEXT,
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_hotel_service ON public.hotel_services (hotel_id, service_key);
CREATE INDEX        IF NOT EXISTS idx_hotel_services ON public.hotel_services (hotel_id);

CREATE TABLE IF NOT EXISTS public.service_requests (
  id          TEXT PRIMARY KEY,
  hotel_id    TEXT NOT NULL,
  hotel_name  TEXT,
  service_key TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'activate', -- activate | free_trial
  status      TEXT NOT NULL DEFAULT 'pending',  -- pending | approved | rejected
  note        TEXT,
  decided_by  TEXT,
  decided_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_svc_req_hotel  ON public.service_requests (hotel_id);
CREATE INDEX IF NOT EXISTS idx_svc_req_status ON public.service_requests (status);
-- at most one pending request per (hotel, service)
CREATE UNIQUE INDEX IF NOT EXISTS uniq_svc_req_pending
  ON public.service_requests (hotel_id, service_key) WHERE status = 'pending';

ALTER TABLE public.hotel_services   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_requests ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='hotel_services' AND policyname='hotel_services_all_anon') THEN
    CREATE POLICY hotel_services_all_anon ON public.hotel_services FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='service_requests' AND policyname='service_requests_all_anon') THEN
    CREATE POLICY service_requests_all_anon ON public.service_requests FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;
