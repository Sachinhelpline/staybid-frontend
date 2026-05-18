-- ═══════════════════════════════════════════════════════════════════════════
-- StayBid 2-Tier System — Phase 1 additive schema migration
-- ═══════════════════════════════════════════════════════════════════════════
-- Forward-only, additive-only. No DROP, no TRUNCATE, no column renames.
-- Every statement is idempotent (IF NOT EXISTS / IF NOT EXISTS guards) so the
-- migration can be safely re-run.
--
-- Implements Phase 1 of the master tier-system plan. See CLAUDE.md Section 3
-- for locked decisions. Adds:
--   1. Two new values to social_user_type enum (VERIFIED_GUEST, COMMUNITY_CONTRIBUTOR)
--   2. social_profiles.tier_promoted_at audit column
--   3. social_posts moderation state machine + booking link + verification method
--   4. NEW location_verifications table (Community Contributor location-OTP)
--   5. NEW inspiration_nudges table (Section 5 nudge + reward tracking)
--   6. Idempotency unique index on wallet_credit_history (tier-reward credits)
--   7. RLS + permissive policies on new tables (frontend pattern)
--
-- Pre-flight verified 2026-05-18:
--   - social_user_type currently has {PUBLIC, CREATOR, HOTEL}
--   - social_profiles has no tier_promoted_at column
--   - social_posts has no moderation_status / booking_id / verification_method
--   - location_verifications + inspiration_nudges do not exist
--   - wallet_credit_history has ZERO duplicates on (user_id, source_type,
--     source_id) WHERE source_id IS NOT NULL → unique index safe to add
-- ═══════════════════════════════════════════════════════════════════════════

-- ──────────────────────────────────────────────────────────────────────────
-- 1. Extend social_user_type ENUM
-- ──────────────────────────────────────────────────────────────────────────
-- Postgres 17 allows ALTER TYPE ADD VALUE inside a transaction (PG 14+), but
-- the new values cannot be USED in the same transaction. We only ADD here —
-- backfill / use happens in Phase 2 runtime code.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'social_user_type' AND e.enumlabel = 'VERIFIED_GUEST'
  ) THEN
    EXECUTE 'ALTER TYPE public.social_user_type ADD VALUE ''VERIFIED_GUEST'' AFTER ''PUBLIC''';
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'social_user_type' AND e.enumlabel = 'COMMUNITY_CONTRIBUTOR'
  ) THEN
    EXECUTE 'ALTER TYPE public.social_user_type ADD VALUE ''COMMUNITY_CONTRIBUTOR'' AFTER ''VERIFIED_GUEST''';
  END IF;
END$$;

-- ──────────────────────────────────────────────────────────────────────────
-- 2. social_profiles.tier_promoted_at — audit field
-- ──────────────────────────────────────────────────────────────────────────
-- Set whenever user_type transitions PUBLIC → VERIFIED_GUEST / COMMUNITY_CONTRIBUTOR
-- / CREATOR. NULL for existing rows (they were never "promoted" — they were
-- whatever they are today).
ALTER TABLE public.social_profiles
  ADD COLUMN IF NOT EXISTS tier_promoted_at TIMESTAMPTZ;

-- ──────────────────────────────────────────────────────────────────────────
-- 3. social_posts moderation state machine + tier-system metadata
-- ──────────────────────────────────────────────────────────────────────────
-- moderation_status default = 'APPROVED' so EVERY existing row stays visible.
-- The state machine only constrains new uploads going through the Phase 2
-- /api/social/posts/verified-guest + /api/social/posts/community endpoints.
ALTER TABLE public.social_posts
  ADD COLUMN IF NOT EXISTS moderation_status TEXT NOT NULL DEFAULT 'APPROVED';

ALTER TABLE public.social_posts
  DROP CONSTRAINT IF EXISTS social_posts_moderation_status_check;
ALTER TABLE public.social_posts
  ADD CONSTRAINT social_posts_moderation_status_check
  CHECK (moderation_status IN (
    'PENDING_HOTEL_APPROVAL',  -- new upload waiting for hotel partner decision
    'PENDING_ADMIN_REVIEW',    -- hotel or cron escalated to admin (borderline / dispute)
    'APPROVED',                -- hotel partner explicitly approved
    'AUTO_APPROVED',           -- cron auto-approved after hotel timeout
    'REJECTED',                -- hotel partner or admin rejected
    'FLAGGED',                 -- post-hoc admin flag (e.g. complaint after publish)
    'DELETED'                  -- soft delete
  ));

-- Tie the post to the booking that qualified the upload (Verified Guest path)
-- or to the hotel verified by location-OTP (Community Contributor path uses
-- hotel_id only — no booking).
ALTER TABLE public.social_posts
  ADD COLUMN IF NOT EXISTS booking_id TEXT;  -- nullable

-- How did this upload qualify?
--   'booking'          → Verified Guest with a CHECKED_OUT booking
--   'location_otp'     → Community Contributor with a verified on-site OTP
--   'creator'          → existing creator path (untouched)
--   'hotel'            → hotel-account upload (untouched)
--   NULL               → legacy posts from before this migration
ALTER TABLE public.social_posts
  ADD COLUMN IF NOT EXISTS verification_method TEXT;

ALTER TABLE public.social_posts
  DROP CONSTRAINT IF EXISTS social_posts_verification_method_check;
ALTER TABLE public.social_posts
  ADD CONSTRAINT social_posts_verification_method_check
  CHECK (verification_method IS NULL OR verification_method IN (
    'booking',
    'location_otp',
    'creator',
    'hotel'
  ));

-- Hotel-partner approval bookkeeping for the PENDING_HOTEL_APPROVAL state
ALTER TABLE public.social_posts
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
ALTER TABLE public.social_posts
  ADD COLUMN IF NOT EXISTS approved_by TEXT;  -- user_id of hotel partner who approved
ALTER TABLE public.social_posts
  ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ;
ALTER TABLE public.social_posts
  ADD COLUMN IF NOT EXISTS rejected_by TEXT;  -- user_id of hotel partner who rejected
ALTER TABLE public.social_posts
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT;
ALTER TABLE public.social_posts
  ADD COLUMN IF NOT EXISTS auto_approved_at TIMESTAMPTZ;

-- Admin-approval escalation lane (Sachin's Phase 1 addition).
-- A post enters PENDING_ADMIN_REVIEW when either:
--   (a) the hotel partner explicitly escalates ("not sure, admin dekhe"), OR
--   (b) the auto-approve cron escalates instead of auto-approving (admin
--       policy can toggle this per-hotel later).
-- Admins resolve via approve / reject with optional notes.
ALTER TABLE public.social_posts
  ADD COLUMN IF NOT EXISTS admin_reviewed_at      TIMESTAMPTZ;
ALTER TABLE public.social_posts
  ADD COLUMN IF NOT EXISTS admin_reviewed_by      TEXT;  -- users.id of admin
ALTER TABLE public.social_posts
  ADD COLUMN IF NOT EXISTS admin_review_decision  TEXT;  -- 'approve' | 'reject'
ALTER TABLE public.social_posts
  ADD COLUMN IF NOT EXISTS admin_review_notes     TEXT;
ALTER TABLE public.social_posts
  ADD COLUMN IF NOT EXISTS escalated_to_admin_at  TIMESTAMPTZ;
ALTER TABLE public.social_posts
  ADD COLUMN IF NOT EXISTS escalated_by           TEXT;  -- users.id (hotel partner or 'cron')

ALTER TABLE public.social_posts
  DROP CONSTRAINT IF EXISTS social_posts_admin_decision_check;
ALTER TABLE public.social_posts
  ADD CONSTRAINT social_posts_admin_decision_check
  CHECK (admin_review_decision IS NULL
         OR admin_review_decision IN ('approve', 'reject'));

-- Index for hotel partner's Pending Reviews dashboard
CREATE INDEX IF NOT EXISTS idx_social_posts_pending_for_hotel
  ON public.social_posts (hotel_id, created_at DESC)
  WHERE moderation_status = 'PENDING_HOTEL_APPROVAL';

-- Index for cron's auto-approve sweep (Phase 6)
CREATE INDEX IF NOT EXISTS idx_social_posts_pending_age
  ON public.social_posts (created_at)
  WHERE moderation_status = 'PENDING_HOTEL_APPROVAL';

-- Index for admin's Pending Admin Review queue (cross-hotel)
CREATE INDEX IF NOT EXISTS idx_social_posts_pending_admin
  ON public.social_posts (created_at DESC)
  WHERE moderation_status = 'PENDING_ADMIN_REVIEW';

-- Index for booking → posts lookup (Verified Guest)
CREATE INDEX IF NOT EXISTS idx_social_posts_booking
  ON public.social_posts (booking_id)
  WHERE booking_id IS NOT NULL;

-- ──────────────────────────────────────────────────────────────────────────
-- 4. NEW location_verifications table — Community Contributor OTP flow
-- ──────────────────────────────────────────────────────────────────────────
-- One row per OTP request. Geofence + OTP audit. Raw OTP never stored —
-- only a SHA-256 / bcrypt hash. Verification record is consumed on use
-- (status='CONSUMED' when linked to a social_posts.id).
CREATE TABLE IF NOT EXISTS public.location_verifications (
  id                 TEXT PRIMARY KEY DEFAULT ('locv_' || replace(gen_random_uuid()::text, '-', '')),
  user_id            TEXT NOT NULL,
  hotel_id           TEXT NOT NULL,

  -- Device coordinates submitted by the customer's browser Geolocation API
  device_lat         DOUBLE PRECISION NOT NULL,
  device_lng         DOUBLE PRECISION NOT NULL,
  device_accuracy_m  DOUBLE PRECISION,  -- from Geolocation API accuracy field; nullable

  -- Hotel coordinates snapshotted at send-otp time (for audit; hotels.lat/lng
  -- may move later but we want to know what was used to compute distance).
  hotel_lat          DOUBLE PRECISION NOT NULL,
  hotel_lng          DOUBLE PRECISION NOT NULL,
  distance_m         DOUBLE PRECISION NOT NULL,  -- haversine at send-otp time

  -- OTP audit (raw OTP NEVER stored)
  status             TEXT NOT NULL DEFAULT 'OTP_SENT',
  otp_hash           TEXT,
  otp_sent_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  otp_attempts       INT NOT NULL DEFAULT 0,
  verified_at        TIMESTAMPTZ,

  -- Consumption tracking
  used_for_post_id   TEXT,  -- social_posts.id once consumed; null until then
  expires_at         TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '15 minutes'),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.location_verifications
  DROP CONSTRAINT IF EXISTS location_verifications_status_check;
ALTER TABLE public.location_verifications
  ADD CONSTRAINT location_verifications_status_check
  CHECK (status IN ('OTP_SENT', 'VERIFIED', 'CONSUMED', 'EXPIRED', 'FAILED'));

CREATE INDEX IF NOT EXISTS idx_locv_user_created
  ON public.location_verifications (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_locv_hotel
  ON public.location_verifications (hotel_id);

-- Partial index for actively-pending OTPs (small, fast)
CREATE INDEX IF NOT EXISTS idx_locv_pending
  ON public.location_verifications (user_id, hotel_id, expires_at)
  WHERE status = 'OTP_SENT';

-- ──────────────────────────────────────────────────────────────────────────
-- 5. NEW inspiration_nudges table — Section 5 nudges + rewards
-- ──────────────────────────────────────────────────────────────────────────
-- Records every nudge sent to a user, every click, every resulting post,
-- and every wallet reward. Idempotency unique index prevents double-rewards
-- on cron re-runs.
CREATE TABLE IF NOT EXISTS public.inspiration_nudges (
  id                  TEXT PRIMARY KEY DEFAULT ('insp_' || replace(gen_random_uuid()::text, '-', '')),
  user_id             TEXT NOT NULL,
  booking_id          TEXT,  -- nullable; the booking that triggered the nudge
  hotel_id            TEXT,
  nudge_type          TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'SENT',
  reward_kind         TEXT,             -- e.g. 'wallet_credit_50', 'wallet_credit_200'
  reward_amount_inr   INT,
  reward_credited_at  TIMESTAMPTZ,
  reference_post_id   TEXT,             -- social_posts.id that triggered the reward
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.inspiration_nudges
  DROP CONSTRAINT IF EXISTS inspiration_nudges_status_check;
ALTER TABLE public.inspiration_nudges
  ADD CONSTRAINT inspiration_nudges_status_check
  CHECK (status IN ('SENT', 'CLICKED', 'POSTED', 'REWARDED', 'EXPIRED'));

ALTER TABLE public.inspiration_nudges
  DROP CONSTRAINT IF EXISTS inspiration_nudges_type_check;
ALTER TABLE public.inspiration_nudges
  ADD CONSTRAINT inspiration_nudges_type_check
  CHECK (nudge_type IN (
    'post_stay_share',           -- "Share your trip" 24h after checkout
    'view_milestone',            -- "Your reel hit 1k views" reward nudge
    'first_post_completion'      -- onboarding bonus on first approved post
  ));

-- Idempotency: one nudge per (user, booking, type). COALESCE handles
-- non-booking nudges (booking_id NULL → empty-string token).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_insp_user_booking_type
  ON public.inspiration_nudges (user_id, COALESCE(booking_id, ''), nudge_type);

CREATE INDEX IF NOT EXISTS idx_insp_user_created
  ON public.inspiration_nudges (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_insp_status_type
  ON public.inspiration_nudges (status, nudge_type, created_at DESC);

-- updated_at auto-touch trigger (mirrors hotel_hold_config + room_date_overrides pattern)
CREATE OR REPLACE FUNCTION public.fn_inspiration_nudges_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_inspiration_nudges_touch ON public.inspiration_nudges;
CREATE TRIGGER trg_inspiration_nudges_touch
  BEFORE UPDATE ON public.inspiration_nudges
  FOR EACH ROW EXECUTE FUNCTION public.fn_inspiration_nudges_touch_updated_at();

-- ──────────────────────────────────────────────────────────────────────────
-- 6. Idempotency guard for wallet_credit_history (tier-reward credits)
-- ──────────────────────────────────────────────────────────────────────────
-- Phase 6 cron must NEVER credit a user twice for the same milestone.
-- Pre-flight verified: zero existing duplicates on (user_id, source_type,
-- source_id) WHERE source_id IS NOT NULL → safe to add this unique index.
-- Existing wallet_credit_history rows with NULL source_id remain valid.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_wch_idempotency
  ON public.wallet_credit_history (user_id, source_type, source_id)
  WHERE source_id IS NOT NULL;

-- ──────────────────────────────────────────────────────────────────────────
-- 7. Row-Level Security on new tables — match repo's "permissive anon" pattern
-- ──────────────────────────────────────────────────────────────────────────
-- Phase 2 endpoints will go through service-role / authenticated paths, but
-- the existing app reads everything via the anon PostgREST key. Permissive
-- RLS keeps that pattern working. See migrations/2026-05-13-rls-everywhere.sql
-- for precedent.
ALTER TABLE public.location_verifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "location_verifications_all_anon" ON public.location_verifications;
CREATE POLICY "location_verifications_all_anon"
  ON public.location_verifications
  FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

ALTER TABLE public.inspiration_nudges ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "inspiration_nudges_all_anon" ON public.inspiration_nudges;
CREATE POLICY "inspiration_nudges_all_anon"
  ON public.inspiration_nudges
  FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

-- ──────────────────────────────────────────────────────────────────────────
-- End of Phase 1 additive migration. Phase 2 onward will add API routes,
-- helpers, components, and crons that READ + WRITE these columns / tables.
-- ──────────────────────────────────────────────────────────────────────────
