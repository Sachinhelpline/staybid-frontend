-- ─────────────────────────────────────────────────────────────────────────
-- Stay-feedback smiley system (v127, 2026-05-16)
--
-- Adds 4 columns to public.complaints so the new post-checkout smiley flow
-- on /verification can write a structured complaint without spinning up a
-- second table. The existing v98 `complaints` surfaces (customer /complaints
-- centre, admin /admin/complaints queue, audit log via lib/admin/audit.ts)
-- pick this up for free.
--
--   feedback              JSONB   structured smiley scores. Shape:
--                                 { roomMatch, staff, hygiene, food, staffResponse,
--                                   submittedAt, evidenceVideoUrls?: string[] }
--                                 Each checkpoint key carries one of:
--                                   "positive" | "neutral" | "negative"
--   feedbackType          TEXT    discriminator, e.g. "stay_feedback".
--                                 Lets /admin/complaints filter the queue
--                                 without juggling type unions.
--   verificationRequestId TEXT    soft FK → vp_requests.id. Lets admin
--                                 side-load the HOTEL's verification video
--                                 for side-by-side review.
--   evidenceVideoId       TEXT    soft FK → vp_videos.id. The CUSTOMER's
--                                 evidence video recorded when a negative
--                                 checkpoint was flagged. Nullable for
--                                 all-positive feedback (no video needed).
--
-- Additive only. Idempotent. Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE public.complaints ADD COLUMN IF NOT EXISTS feedback                  JSONB;
ALTER TABLE public.complaints ADD COLUMN IF NOT EXISTS "feedbackType"            TEXT;
ALTER TABLE public.complaints ADD COLUMN IF NOT EXISTS "verificationRequestId"   TEXT;
ALTER TABLE public.complaints ADD COLUMN IF NOT EXISTS "evidenceVideoId"         TEXT;

CREATE INDEX IF NOT EXISTS idx_complaints_feedback_type ON public.complaints("feedbackType");
CREATE INDEX IF NOT EXISTS idx_complaints_verif_req     ON public.complaints("verificationRequestId");
CREATE INDEX IF NOT EXISTS idx_complaints_evidence_vid  ON public.complaints("evidenceVideoId");

GRANT ALL ON public.complaints TO anon, authenticated, service_role;
