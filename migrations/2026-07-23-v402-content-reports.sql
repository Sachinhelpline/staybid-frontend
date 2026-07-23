-- v402 — reel/content reports (admin review queue)
-- "Report this reel" now files a real report here (was a dead button). Admin
-- reviews under /admin/content · /admin/fraud. Additive, forward-only,
-- permissive RLS, TEXT ids (no FK — house style).

CREATE TABLE IF NOT EXISTS content_reports (
  id            TEXT PRIMARY KEY,
  post_id       TEXT,                         -- the reel / social_posts id
  hotel_id      TEXT,                         -- tagged hotel (if any)
  hotel_name    TEXT,
  author_handle TEXT,                         -- the reel's author (@handle) if known
  reporter_id   TEXT,                         -- who reported (null if logged out)
  reason        TEXT NOT NULL DEFAULT 'other',-- spam | inappropriate | misleading | offplatform | other
  note          TEXT,
  surface       TEXT NOT NULL DEFAULT 'reel',
  status        TEXT NOT NULL DEFAULT 'open',  -- open | reviewed | actioned | dismissed
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_content_reports_status ON content_reports (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_content_reports_post   ON content_reports (post_id);

ALTER TABLE content_reports ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY content_reports_all ON content_reports FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
