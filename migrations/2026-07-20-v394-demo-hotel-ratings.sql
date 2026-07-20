-- v394 — Give the demo StayBid Circle hotels (v392 hubs + v393 satellites, and
-- the older host_circle seeds) a realistic avgRating + totalReviews so they
-- surface in the customer home rails ("Most loved by guests" needs avgRating
-- ≥ 4.2) and show a ★ rating on their cards. Previously seeded with no rating,
-- so they were invisible in the curated/preference rails.
--
-- Deterministic per-hotel (hashtext) so re-running is stable; idempotent
-- (only fills rows that still have no rating). Demo data only (id LIKE
-- 'hco-seed-%'); zero impact on real hotels.

UPDATE public.hotels
   SET "avgRating"   = ROUND((4.3 + (abs(hashtext(id)) % 6) * 0.1)::numeric, 1),   -- 4.3 .. 4.8
       "totalReviews" = 24 + (abs(hashtext(id)) % 140)                              -- 24 .. 163
 WHERE id LIKE 'hco-seed-%'
   AND ("avgRating" IS NULL OR "avgRating" = 0);

-- verify:
--   SELECT city, "avgRating", "totalReviews" FROM hotels WHERE id LIKE 'hco-seed-%' ORDER BY city LIMIT 10;
--   SELECT count(*) FROM hotels WHERE id LIKE 'hco-seed-%' AND "avgRating" >= 4.2;  -- expect 41
