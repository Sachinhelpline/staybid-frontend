-- Session 6: outbound notification queue. Frontend enqueues; a backend cron
-- (or Supabase Edge Function) drains the queue via SendGrid / MSG91.
CREATE TABLE IF NOT EXISTS public.notification_queue (
  id            TEXT PRIMARY KEY DEFAULT ('nq_' || gen_random_uuid()::text),
  user_id       TEXT,
  channel       TEXT NOT NULL,
  template      TEXT NOT NULL,
  payload       JSONB NOT NULL DEFAULT '{}'::jsonb,
  status        TEXT NOT NULL DEFAULT 'pending',
  scheduled_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at       TIMESTAMPTZ,
  error         TEXT,
  attempts      INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_nq_status_sched ON public.notification_queue(status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_nq_user         ON public.notification_queue(user_id);

GRANT ALL ON public.notification_queue TO anon, authenticated, service_role;
ALTER TABLE public.notification_queue ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='notification_queue' AND policyname='all_anon_all') THEN
    EXECUTE 'CREATE POLICY all_anon_all ON public.notification_queue FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)';
  END IF;
END $$;
NOTIFY pgrst, 'reload schema';
