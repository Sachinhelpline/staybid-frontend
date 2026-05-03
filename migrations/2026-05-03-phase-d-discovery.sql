-- Phase D: trending hashtags RPC + notification triggers
-- Applied 2026-05-03 via Supabase MCP.

CREATE OR REPLACE FUNCTION public.trending_hashtags(p_days INT DEFAULT 30, p_limit INT DEFAULT 12)
RETURNS TABLE (tag TEXT, uses BIGINT)
LANGUAGE SQL STABLE AS $$
  SELECT t.tag, COUNT(*)::BIGINT AS uses
  FROM (
    SELECT lower(substring(m[1] from 2)) AS tag
    FROM public.hotel_videos v,
         LATERAL regexp_matches(coalesce(v.title, ''), '#[A-Za-z0-9_]+', 'g') AS m
    WHERE v.verification_status = 'approved'
      AND v.created_at >= now() - (p_days || ' days')::interval
  ) t
  WHERE length(t.tag) >= 2
  GROUP BY t.tag
  ORDER BY uses DESC, t.tag ASC
  LIMIT p_limit;
$$;

-- Notification triggers — write to notification_queue on social events
CREATE OR REPLACE FUNCTION fn_notify_on_video_like() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE owner_id TEXT;
BEGIN
  SELECT uploaded_by INTO owner_id FROM public.hotel_videos WHERE id = NEW.video_id;
  IF owner_id IS NOT NULL AND owner_id <> NEW.user_id THEN
    INSERT INTO public.notification_queue(user_id, channel, template, payload, status)
    VALUES (owner_id, 'push', 'video_like',
            jsonb_build_object('videoId', NEW.video_id, 'fromUserId', NEW.user_id),
            'pending');
  END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_notify_video_like ON public.video_likes;
CREATE TRIGGER trg_notify_video_like AFTER INSERT ON public.video_likes
  FOR EACH ROW EXECUTE FUNCTION fn_notify_on_video_like();

CREATE OR REPLACE FUNCTION fn_notify_on_video_comment() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE owner_id TEXT;
BEGIN
  SELECT uploaded_by INTO owner_id FROM public.hotel_videos WHERE id = NEW.video_id;
  IF owner_id IS NOT NULL AND owner_id <> NEW.user_id THEN
    INSERT INTO public.notification_queue(user_id, channel, template, payload, status)
    VALUES (owner_id, 'push', 'video_comment',
            jsonb_build_object('videoId', NEW.video_id, 'commentId', NEW.id, 'fromUserId', NEW.user_id, 'preview', left(NEW.body, 80)),
            'pending');
  END IF;
  IF NEW.parent_id IS NOT NULL THEN
    INSERT INTO public.notification_queue(user_id, channel, template, payload, status)
    SELECT user_id, 'push', 'comment_reply',
           jsonb_build_object('videoId', NEW.video_id, 'commentId', NEW.id, 'fromUserId', NEW.user_id, 'preview', left(NEW.body, 80)),
           'pending'
    FROM public.video_comments
    WHERE id = NEW.parent_id AND user_id <> NEW.user_id;
  END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_notify_video_comment ON public.video_comments;
CREATE TRIGGER trg_notify_video_comment AFTER INSERT ON public.video_comments
  FOR EACH ROW EXECUTE FUNCTION fn_notify_on_video_comment();

CREATE OR REPLACE FUNCTION fn_notify_on_follow() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE inf_user_id TEXT;
BEGIN
  SELECT user_id INTO inf_user_id FROM public.influencers WHERE id = NEW.influencer_id;
  IF inf_user_id IS NOT NULL AND inf_user_id <> NEW.follower_id THEN
    INSERT INTO public.notification_queue(user_id, channel, template, payload, status)
    VALUES (inf_user_id, 'push', 'new_follower',
            jsonb_build_object('influencerId', NEW.influencer_id, 'fromUserId', NEW.follower_id),
            'pending');
  END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_notify_follow ON public.user_follows;
CREATE TRIGGER trg_notify_follow AFTER INSERT ON public.user_follows
  FOR EACH ROW EXECUTE FUNCTION fn_notify_on_follow();
