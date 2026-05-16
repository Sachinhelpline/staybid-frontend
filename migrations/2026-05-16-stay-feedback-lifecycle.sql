-- ─────────────────────────────────────────────────────────────────────────
-- Stay-feedback lifecycle (v127.1, 2026-05-16)
--
-- Adds the columns the auto-expiry sweep needs so the v127 smiley system
-- has a complete data-lifecycle policy:
--
--   1. Customer has 48 hours after checkout to submit feedback. If they
--      don't, the lifecycle cron auto-creates an all-positive feedback
--      row + queues a notification + deletes the hotel's verification
--      video for that booking from both Storage AND vp_videos.
--
--   2. If the customer submits evidence video as part of the complaint,
--      admin has 14 days to resolve. The moment admin marks status=
--      'resolved'/'rejected', the evidence video files + vp_videos rows
--      get deleted (no extra grace period — per user spec).
--
--   3. If admin doesn't resolve in 14 days, complaint auto-escalates
--      (status='escalated'). Evidence video stays until manually closed.
--
-- Only the smiley initials (feedback JSONB) persist long-term — they're
-- what powers the public aggregated hotel-feedback summary + future
-- hotel-rank-graph feature.
--
-- New columns:
--   feedbackAutoFilled     BOOLEAN  TRUE when the row was created by the
--                                   lifecycle cron because the customer
--                                   didn't submit in time.
--   videoCleanedAt         TIMESTAMPTZ  Set by cleanup helpers when the
--                                   evidence-video / verification-video
--                                   files have been purged from Storage
--                                   + vp_videos. Idempotency marker so
--                                   the cron doesn't re-attempt.
--   resolutionDeadlineAt   TIMESTAMPTZ  Set to createdAt + 14 days for
--                                   any complaint with evidence video.
--                                   Cron uses this to auto-escalate.
--
-- Additive only. Idempotent. Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE public.complaints ADD COLUMN IF NOT EXISTS "feedbackAutoFilled"   BOOLEAN DEFAULT false;
ALTER TABLE public.complaints ADD COLUMN IF NOT EXISTS "videoCleanedAt"       TIMESTAMPTZ;
ALTER TABLE public.complaints ADD COLUMN IF NOT EXISTS "resolutionDeadlineAt" TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_complaints_auto_filled  ON public.complaints("feedbackAutoFilled");
CREATE INDEX IF NOT EXISTS idx_complaints_video_clean  ON public.complaints("videoCleanedAt");
CREATE INDEX IF NOT EXISTS idx_complaints_resolution   ON public.complaints("resolutionDeadlineAt");

GRANT ALL ON public.complaints TO anon, authenticated, service_role;
