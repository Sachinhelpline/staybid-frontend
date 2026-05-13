-- v112.2 — IG-style Edit Post sheet needs two more toggles + the
-- ability to merge duplicate social_profiles rows that came from the
-- "fb_<uid>" vs raw uid split in legacy auth code.
--
-- Applied live to project uxxhbdqedazpmvbvaosh via Supabase MCP at v112.2
-- ship time. Captured here for repo history.

-- 1. Two new IG-style toggles on social_posts. Default off so legacy
--    rows stay normal.
ALTER TABLE social_posts
  ADD COLUMN IF NOT EXISTS hide_likes BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS disable_comments BOOLEAN NOT NULL DEFAULT FALSE;

-- 2. (Already applied live, captured for record) Sachin's duplicate
--    social_profiles row was merged:
--      kept:  e5c72301-... user_id=Ld6xDB42... username=sachin_tomer
--      dropped: 03bf28f5-... user_id=fb_Ld6xDB42... username=user_fb_ld6
--    Posts + follows re-pointed to the keeper before delete.
--
-- Forward-fix lives in lib/social/auth-helper.ts (normalizeAuthId)
-- which strips "fb_" / "firebase_" prefixes from the JWT-derived id
-- before every social-profile lookup. Any future legacy token still
-- resolves to the canonical row.
