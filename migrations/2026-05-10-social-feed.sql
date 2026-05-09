-- ═══════════════════════════════════════════════════════════════════════════
-- StayBid Social Feed — Phase F (May 2026)
-- ───────────────────────────────────────────────────────────────────────────
-- ADDITIVE ONLY. Does not touch any existing table, column, enum, or RLS
-- policy. Safe to run multiple times (every CREATE uses IF NOT EXISTS).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Enums ──────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE social_user_type AS ENUM ('PUBLIC', 'CREATOR', 'HOTEL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE social_media_type AS ENUM ('PHOTO', 'REEL', 'STORY');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── social_profiles ─────────────────────────────────────────────────────
-- One row per (user, profile-type) — separates the social identity from
-- the underlying auth user. Hotels link via hotel_id FK; creators link
-- via creator_id FK; public users have neither.
CREATE TABLE IF NOT EXISTS social_profiles (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id         TEXT NOT NULL UNIQUE,                    -- auth user id (CUID or Firebase sub)
  hotel_id        TEXT UNIQUE,                             -- only set when user_type = 'HOTEL'
  creator_id      TEXT UNIQUE,                             -- only set when user_type = 'CREATOR'
  username        TEXT NOT NULL UNIQUE,                    -- @handle
  display_name    TEXT NOT NULL,
  bio             TEXT,
  avatar_url      TEXT,
  cover_url       TEXT,
  follower_count  INTEGER NOT NULL DEFAULT 0,
  following_count INTEGER NOT NULL DEFAULT 0,
  is_verified     BOOLEAN NOT NULL DEFAULT FALSE,          -- blue ✓ for HOTEL
  is_creator      BOOLEAN NOT NULL DEFAULT FALSE,          -- gold ✦ for CREATOR
  user_type       social_user_type NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_social_profiles_user_id   ON social_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_social_profiles_username  ON social_profiles(username);
CREATE INDEX IF NOT EXISTS idx_social_profiles_hotel_id  ON social_profiles(hotel_id) WHERE hotel_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_social_profiles_user_type ON social_profiles(user_type);

-- ── social_posts ────────────────────────────────────────────────────────
-- Photos / reels / stories. Stories are auto-expired in the feed via the
-- 24-hour rule (filter `created_at > now() - interval '24 hours'`).
CREATE TABLE IF NOT EXISTS social_posts (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  author_id       TEXT NOT NULL REFERENCES social_profiles(id) ON DELETE CASCADE,
  hotel_id        TEXT,                                    -- when the post is hotel-tagged
  media_type      social_media_type NOT NULL,
  media_url       TEXT NOT NULL,
  thumbnail_url   TEXT,
  caption         TEXT,
  sound_track     TEXT,                                    -- "Original Audio" or library track name
  sound_url       TEXT,                                    -- optional audio URL
  sound_owner_id  TEXT,                                    -- only this profile can change the sound
  location_name   TEXT,
  location_lat    DOUBLE PRECISION,
  location_lng    DOUBLE PRECISION,
  view_count      INTEGER NOT NULL DEFAULT 0,
  like_count      INTEGER NOT NULL DEFAULT 0,
  comment_count   INTEGER NOT NULL DEFAULT 0,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_social_posts_author_id  ON social_posts(author_id);
CREATE INDEX IF NOT EXISTS idx_social_posts_hotel_id   ON social_posts(hotel_id) WHERE hotel_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_social_posts_created_at ON social_posts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_social_posts_active     ON social_posts(is_active, created_at DESC) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_social_posts_media_type ON social_posts(media_type, created_at DESC);

-- ── social_follows ──────────────────────────────────────────────────────
-- Edge table: follower (auth user id) → followed (social_profiles.id).
-- Composite PK avoids duplicate follows.
CREATE TABLE IF NOT EXISTS social_follows (
  follower_user_id TEXT NOT NULL,
  followed_id      TEXT NOT NULL REFERENCES social_profiles(id) ON DELETE CASCADE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (follower_user_id, followed_id)
);

CREATE INDEX IF NOT EXISTS idx_social_follows_followed ON social_follows(followed_id);
CREATE INDEX IF NOT EXISTS idx_social_follows_follower ON social_follows(follower_user_id);

-- ── Trigger: keep follower_count / following_count denormalised ─────────
CREATE OR REPLACE FUNCTION fn_social_follow_counts()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE social_profiles SET follower_count = follower_count + 1 WHERE id = NEW.followed_id;
    UPDATE social_profiles SET following_count = following_count + 1 WHERE user_id = NEW.follower_user_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE social_profiles SET follower_count = GREATEST(0, follower_count - 1) WHERE id = OLD.followed_id;
    UPDATE social_profiles SET following_count = GREATEST(0, following_count - 1) WHERE user_id = OLD.follower_user_id;
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_social_follow_counts ON social_follows;
CREATE TRIGGER trg_social_follow_counts
AFTER INSERT OR DELETE ON social_follows
FOR EACH ROW EXECUTE FUNCTION fn_social_follow_counts();

-- ── Trigger: auto-bump updated_at on social_profiles ────────────────────
CREATE OR REPLACE FUNCTION fn_social_profiles_touch()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_social_profiles_touch ON social_profiles;
CREATE TRIGGER trg_social_profiles_touch
BEFORE UPDATE ON social_profiles
FOR EACH ROW EXECUTE FUNCTION fn_social_profiles_touch();

-- ═══════════════════════════════════════════════════════════════════════
-- DONE. Verify no existing tables were touched:
--   SELECT tablename FROM pg_tables WHERE schemaname = 'public'
--   ORDER BY tablename;
-- All previously-existing tables remain untouched.
-- ═══════════════════════════════════════════════════════════════════════
