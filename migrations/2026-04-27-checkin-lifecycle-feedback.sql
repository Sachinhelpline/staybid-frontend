-- ADDITIVE extension (applied via Supabase MCP). No existing column / table touched.
CREATE TABLE IF NOT EXISTS public.checkin_checkout_logs (
  id            TEXT PRIMARY KEY DEFAULT ('cio_' || gen_random_uuid()::text),
  booking_id    TEXT NOT NULL,
  hotel_id      TEXT NOT NULL,
  customer_id   TEXT,
  checkin_time  TIMESTAMPTZ,
  checkout_time TIMESTAMPTZ,
  marked_by     TEXT,
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_cio_booking ON public.checkin_checkout_logs(booking_id);

CREATE TABLE IF NOT EXISTS public.video_lifecycle (
  id           TEXT PRIMARY KEY DEFAULT ('vlc_' || gen_random_uuid()::text),
  booking_id   TEXT NOT NULL, hotel_id TEXT, customer_id TEXT,
  vp_request_id TEXT,
  expiry_time  TIMESTAMPTZ NOT NULL,
  status       TEXT NOT NULL DEFAULT 'active',
  reminder_2h_sent  BOOLEAN NOT NULL DEFAULT FALSE,
  reminder_35h_sent BOOLEAN NOT NULL DEFAULT FALSE,
  initial_notified  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_vlc_booking ON public.video_lifecycle(booking_id);

CREATE TABLE IF NOT EXISTS public.feedback_tracking (
  id            TEXT PRIMARY KEY DEFAULT ('fbk_' || gen_random_uuid()::text),
  booking_id    TEXT NOT NULL, hotel_id TEXT, customer_id TEXT,
  submitted     BOOLEAN NOT NULL DEFAULT FALSE,
  timestamp     TIMESTAMPTZ,
  rating        INT, comments TEXT,
  staypoints_credited INT DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_fbk_booking ON public.feedback_tracking(booking_id);

GRANT ALL ON public.checkin_checkout_logs, public.video_lifecycle, public.feedback_tracking
  TO anon, authenticated, service_role;
ALTER TABLE public.checkin_checkout_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.video_lifecycle      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feedback_tracking    ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='checkin_checkout_logs' AND policyname='all_anon_all') THEN
    EXECUTE 'CREATE POLICY all_anon_all ON public.checkin_checkout_logs FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='video_lifecycle' AND policyname='all_anon_all') THEN
    EXECUTE 'CREATE POLICY all_anon_all ON public.video_lifecycle FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='feedback_tracking' AND policyname='all_anon_all') THEN
    EXECUTE 'CREATE POLICY all_anon_all ON public.feedback_tracking FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)'; END IF;
END $$;
NOTIFY pgrst, 'reload schema';
