-- ═══════════════════════════════════════════════════════════════════════════
-- StayBid 2-Tier System — Phase 7 additive schema migration
-- ═══════════════════════════════════════════════════════════════════════════
-- Adds 2 columns to public.influencers so the Phase 7 cron can write
-- creator-upgrade candidates into the existing admin queue without
-- needing a separate table or admin page. Existing /upgrade form-based
-- creator applications stay untouched (column default='form').
--
-- Forward-only, additive. Existing rows get default 'form' for
-- application_source and NULL for auto_eval_data.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. application_source — distinguishes form-applicants from cron-driven
--    creator-upgrade evaluations. 3 valid values:
--      'form'         → existing /upgrade form submission (default)
--      'auto_eval'    → Phase 7 cron flagged for admin review (Type B)
--      'auto_promote' → Phase 7 cron auto-promoted to active (Type A)
ALTER TABLE public.influencers
  ADD COLUMN IF NOT EXISTS application_source TEXT NOT NULL DEFAULT 'form';

ALTER TABLE public.influencers
  DROP CONSTRAINT IF EXISTS influencers_application_source_check;
ALTER TABLE public.influencers
  ADD CONSTRAINT influencers_application_source_check
  CHECK (application_source IN ('form', 'auto_eval', 'auto_promote'));

-- 2. auto_eval_data — JSONB snapshot of the metrics the cron used to
--    promote / flag this creator. Lets admin see WHY this candidate
--    qualified before approving. Schema:
--      {
--        posts_approved: int,        // approved posts in eval window
--        posts_rejected: int,        // rejected (quality signal)
--        total_views: int,
--        follower_count: int,
--        approval_rate: float (0..1),
--        evaluated_at: ISO timestamp,
--        eval_window_days: int,
--        eligibility_type: "auto_promote" | "admin_review"
--      }
ALTER TABLE public.influencers
  ADD COLUMN IF NOT EXISTS auto_eval_data JSONB;

-- Index for admin /admin/creators page filtering by application source
CREATE INDEX IF NOT EXISTS idx_influencers_application_source
  ON public.influencers (application_source, status, created_at DESC);
