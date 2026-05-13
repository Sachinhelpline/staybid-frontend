-- v112: server-side idempotency for /api/social/posts.
-- Bulletproofs the recurring triple-upload bug. The Composer generates a
-- stable clientPostId once per post() invocation; the server upserts by
-- (author_id, client_post_id) so 1..N rapid POSTs return the same row.
--
-- Applied live to project uxxhbdqedazpmvbvaosh via Supabase MCP at v112
-- ship time. File checked in for repo history + future-self reference.

ALTER TABLE social_posts
  ADD COLUMN IF NOT EXISTS client_post_id TEXT;

-- One profile cannot have two posts with the same client_post_id.
-- Partial index (only enforce when client_post_id is non-null) so
-- legacy rows aren't affected.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_social_posts_author_client
  ON social_posts (author_id, client_post_id)
  WHERE client_post_id IS NOT NULL;
