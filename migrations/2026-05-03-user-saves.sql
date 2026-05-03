-- Session 5: per-user saves across hotels, videos, influencers.
CREATE TABLE IF NOT EXISTS public.user_saves (
  id           TEXT PRIMARY KEY DEFAULT ('sv_' || gen_random_uuid()::text),
  user_id      TEXT NOT NULL,
  target_type  TEXT NOT NULL,
  target_id    TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, target_type, target_id)
);
CREATE INDEX IF NOT EXISTS idx_user_saves_user   ON public.user_saves(user_id);
CREATE INDEX IF NOT EXISTS idx_user_saves_target ON public.user_saves(target_type, target_id);

GRANT ALL ON public.user_saves TO anon, authenticated, service_role;
ALTER TABLE public.user_saves ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='user_saves' AND policyname='all_anon_all') THEN
    EXECUTE 'CREATE POLICY all_anon_all ON public.user_saves FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)';
  END IF;
END $$;
NOTIFY pgrst, 'reload schema';
