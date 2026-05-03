-- Social graph: video_likes, video_comments, user_follows
-- Additive only — all CREATE IF NOT EXISTS.
-- Applied 2026-05-03 via Supabase MCP.

CREATE TABLE IF NOT EXISTS public.video_likes (
  id          TEXT PRIMARY KEY DEFAULT 'vl_' || substr(md5(random()::text), 1, 16),
  video_id    TEXT NOT NULL REFERENCES public.hotel_videos(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (video_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.video_comments (
  id          TEXT PRIMARY KEY DEFAULT 'vc_' || substr(md5(random()::text), 1, 16),
  video_id    TEXT NOT NULL REFERENCES public.hotel_videos(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL,
  body        TEXT NOT NULL,
  parent_id   TEXT REFERENCES public.video_comments(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.user_follows (
  id             TEXT PRIMARY KEY DEFAULT 'uf_' || substr(md5(random()::text), 1, 16),
  follower_id    TEXT NOT NULL,
  influencer_id  TEXT NOT NULL REFERENCES public.influencers(id) ON DELETE CASCADE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (follower_id, influencer_id)
);

ALTER TABLE public.hotel_videos
  ADD COLUMN IF NOT EXISTS likes_count    INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS comments_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS views_count    INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS uploader_type  TEXT NOT NULL DEFAULT 'hotel';

ALTER TABLE public.influencers
  ADD COLUMN IF NOT EXISTS followers_count INTEGER NOT NULL DEFAULT 0;
