-- v398 — connect every demo reel (social_posts) to a REAL hotel so the reel
-- card's "At {hotel}" pill + Book Now / Make Offer deep-links point at a valid,
-- bookable hotel. 29 demo reels were untagged (hotel_id null) and one tagged an
-- id that no longer exists (h-mus-1). Round-robin across the approved-hotel pool
-- (diverse cities, incl. the new demand-cycle hubs) for variety. Demo data only.
-- Applied live via Supabase MCP; this file is the audit record.

-- 1) untagged reels → a real hotel, round-robin over all approved hotels
WITH pool AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY md5(id)) - 1 AS rn
  FROM public.hotels WHERE approval_status = 'approved'
), np AS (SELECT count(*)::int AS c FROM pool),
posts AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY md5(id)) - 1 AS pn
  FROM public.social_posts WHERE hotel_id IS NULL OR hotel_id = ''
)
UPDATE public.social_posts sp
   SET hotel_id = (SELECT p.id FROM pool p, np WHERE p.rn = posts.pn % np.c)
  FROM posts
 WHERE sp.id = posts.id;

-- 2) fix the one tagged reel whose hotel no longer exists
UPDATE public.social_posts
   SET hotel_id = (SELECT id FROM public.hotels WHERE city = 'Mussoorie' AND approval_status = 'approved' ORDER BY md5(id) LIMIT 1)
 WHERE hotel_id = 'h-mus-1';

-- verify:
--   SELECT count(*) FROM social_posts WHERE hotel_id IS NULL OR hotel_id='';  -- expect 0
