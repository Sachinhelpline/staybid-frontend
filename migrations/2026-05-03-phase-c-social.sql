-- Phase C: profile metadata + following_count trigger
-- Applied 2026-05-03 via Supabase MCP.

ALTER TABLE public.influencers
  ADD COLUMN IF NOT EXISTS display_name    TEXT,
  ADD COLUMN IF NOT EXISTS avatar_url      TEXT,
  ADD COLUMN IF NOT EXISTS following_count INTEGER NOT NULL DEFAULT 0;

UPDATE public.influencers i
   SET display_name = u.name
  FROM public.users u
 WHERE i.user_id = u.id AND (i.display_name IS NULL OR i.display_name = '');

-- referral_events.metadata for video-watch analytics
ALTER TABLE public.referral_events
  ADD COLUMN IF NOT EXISTS metadata JSONB;

CREATE INDEX IF NOT EXISTS idx_referral_events_event_type ON public.referral_events(event_type);
CREATE INDEX IF NOT EXISTS idx_referral_events_target ON public.referral_events(target_type, target_id);

-- View-count RPC (called by /api/videos/track-view)
CREATE OR REPLACE FUNCTION public.increment_video_view(p_video_id TEXT)
RETURNS VOID LANGUAGE SQL AS $$
  UPDATE public.hotel_videos SET views_count = views_count + 1 WHERE id = p_video_id;
$$;

-- following_count trigger (mirror of followers_count from Phase A)
CREATE OR REPLACE FUNCTION fn_user_follows_following_count() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.influencers SET following_count = following_count + 1 WHERE user_id = NEW.follower_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.influencers SET following_count = GREATEST(0, following_count - 1) WHERE user_id = OLD.follower_id;
  END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_user_follows_following_count ON public.user_follows;
CREATE TRIGGER trg_user_follows_following_count
  AFTER INSERT OR DELETE ON public.user_follows
  FOR EACH ROW EXECUTE FUNCTION fn_user_follows_following_count();
