-- v401 — comment contact-info flags (admin review queue)
-- When a public reel comment trips the anti-bypass sanitizer (phone / email /
-- social handle / StayBid id / off-platform solicitation), the client masks it
-- AND fires a flag here so admin/ops can review repeat offenders. Additive,
-- forward-only, permissive RLS, TEXT ids (no FK constraints — house style).

CREATE TABLE IF NOT EXISTS comment_flags (
  id            TEXT PRIMARY KEY,
  hotel_id      TEXT,                         -- the reel's tagged hotel / post id
  hotel_name    TEXT,
  author_id     TEXT,                         -- commenter (null if anon)
  author_name   TEXT,
  raw_text      TEXT NOT NULL,                -- what they tried to post (for review)
  masked_text   TEXT NOT NULL,               -- what everyone else would have seen
  reasons       TEXT[] NOT NULL DEFAULT '{}', -- which patterns tripped
  surface       TEXT NOT NULL DEFAULT 'reel_comment',
  status        TEXT NOT NULL DEFAULT 'open', -- open | reviewed | dismissed
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_comment_flags_status  ON comment_flags (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_comment_flags_author  ON comment_flags (author_id);
CREATE INDEX IF NOT EXISTS idx_comment_flags_created ON comment_flags (created_at DESC);

ALTER TABLE comment_flags ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY comment_flags_all ON comment_flags FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
