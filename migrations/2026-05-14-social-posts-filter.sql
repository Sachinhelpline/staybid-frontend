-- ═══════════════════════════════════════════════════════════════════════
-- v114 — IG-style filter preset persisted on social_posts.
-- Additive column. Older readers ignore it; new feed applies the chosen
-- CSS filter so what the creator saw in the composer matches the feed.
-- ═══════════════════════════════════════════════════════════════════════
alter table public.social_posts
  add column if not exists "filter" text;
