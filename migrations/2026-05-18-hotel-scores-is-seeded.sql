-- ═══════════════════════════════════════════════════════════════════════════
-- v133.1 — hotel_scores: future-proof against recompute wipes (2026-05-18)
--
-- Why this exists:
--   The v131.6 fix added a 24h `HONOR_GOOD_SCORE_MS` guard in the customer
--   scorecard route. The guard worked for 24h, then expired. After 24h, the
--   route called recompute() against the demo dataset (no real bids /
--   bookings / complaints / stay_feedback). The engine returned
--   { overall: null, status: "unrated" }, which then UPSERTed back to the
--   hotel_scores row — wiping the seeded synthetic score. From that moment
--   on, `hasGoodScore` returned false → effective TTL dropped back to 30
--   minutes → the route kept overwriting the null score from empty source
--   data → the badge stayed "New on StayBid" forever.
--
--   At v133.1 ship time: 30 of 32 hotel_scores rows had overall=NULL.
--
-- The fix is a `is_seeded` flag combined with:
--   (a) Route + cron + admin recompute paths SKIP rows where is_seeded=true.
--       Synthetic rows are NEVER overwritten by recompute, regardless of
--       how stale the cached row gets.
--   (b) upsertScore() in every recompute path refuses to "downgrade" a
--       non-null overall to null. Even non-seeded rows are protected from
--       the empty-source-data wipe.
--
--   These two protections combined mean a future Claude session adding a
--   4th recompute entry point (e.g. a new "Refresh all scorecards" admin
--   button) can't accidentally wipe seeded demo data again.
--
-- How to "unseal" a seeded row once real activity arrives:
--   UPDATE public.hotel_scores SET is_seeded = false WHERE hotel_id = '…';
--   Then the next /api/hotels/[id]/scorecard hit will recompute from real
--   source data and pick up live values.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.hotel_scores
  ADD COLUMN IF NOT EXISTS is_seeded BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS hotel_scores_is_seeded_idx
  ON public.hotel_scores (is_seeded)
  WHERE is_seeded = TRUE;

COMMENT ON COLUMN public.hotel_scores.is_seeded IS
  'v133.1: TRUE = synthetic / demo data, NEVER overwritten by recompute. '
  'Real data ingestion paths (cron sweep 5, customer route, admin recompute) '
  'SKIP these rows. Admin manually flips to FALSE when real activity arrives.';
