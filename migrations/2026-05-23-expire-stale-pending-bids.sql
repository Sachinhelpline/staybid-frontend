-- ── Stale-PENDING-bid sweep RPC (v193) ─────────────────────────────────
-- Mirrors `lib/bid-expiry.ts` so the DB row state matches what the
-- customer / partner / admin views already show (or rather, already hide).
--
-- Two cases we flip PENDING → EXPIRED:
--
--   1. PENDING + auto_accept_at IS NULL + createdAt < NOW() - 6 hours
--      → LOWBALL / unscheduled bids the hotel never acted on.
--        Client already hides these at 6 h; this just catches up the
--        DB row so a new bid (and the partner panel queue) can move on.
--
--   2. PENDING + auto_accept_at IS NOT NULL
--                + auto_accept_at < NOW() - 15 minutes
--      → Above-floor scheduled bids that the auto-accept cron missed.
--        The companion RPC `auto_accept_eligible_bids()` should have
--        flipped these to ACCEPTED already; this is the "missed cron"
--        backstop. 15 min grace mirrors the client rule.
--
-- NEVER touches:
--   • ACCEPTED, COUNTER, REJECTED, CHECKED_IN, CHECKED_OUT (have natural
--     action paths or short client filters)
--   • Anything younger than the cutoffs (still actionable by the hotel)
--
-- Cron-friendly: idempotent, returns row counts, hard-cap of 500 rows
-- per call so a backlog doesn't blow a single transaction.
--
-- Called from /api/cron/expire-holds alongside mark_expired_holds().

CREATE OR REPLACE FUNCTION public.mark_stale_pending_bids()
RETURNS TABLE(
  unscheduled_expired INT,
  scheduled_expired   INT,
  ran_at              TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_unsched_count INT := 0;
  v_sched_count   INT := 0;
BEGIN
  -- Case 1: PENDING with no schedule + older than 6 h
  WITH stale_unscheduled AS (
    SELECT id
      FROM public.bids
     WHERE status = 'PENDING'
       AND auto_accept_at IS NULL
       AND "createdAt" < (NOW() AT TIME ZONE 'UTC') - INTERVAL '6 hours'
     ORDER BY "createdAt" ASC
     LIMIT 500
  ),
  upd_unsched AS (
    UPDATE public.bids b
       SET status = 'EXPIRED'
      FROM stale_unscheduled s
     WHERE b.id = s.id
       AND b.status = 'PENDING'
    RETURNING b.id
  )
  SELECT COUNT(*)::INT INTO v_unsched_count FROM upd_unsched;

  -- Case 2: PENDING with schedule, past the 15-min grace
  WITH stale_scheduled AS (
    SELECT id
      FROM public.bids
     WHERE status = 'PENDING'
       AND auto_accept_at IS NOT NULL
       AND auto_accept_at < NOW() - INTERVAL '15 minutes'
     ORDER BY auto_accept_at ASC
     LIMIT 500
  ),
  upd_sched AS (
    UPDATE public.bids b
       SET status = 'EXPIRED'
      FROM stale_scheduled s
     WHERE b.id = s.id
       AND b.status = 'PENDING'
    RETURNING b.id
  )
  SELECT COUNT(*)::INT INTO v_sched_count FROM upd_sched;

  RETURN QUERY
  SELECT v_unsched_count, v_sched_count, NOW();
END;
$$;

-- Grant exec to the anon role used by the cron route's SB_KEY auth
GRANT EXECUTE ON FUNCTION public.mark_stale_pending_bids() TO anon, authenticated;

-- Helpful index — speeds up Case 1 scan (most common). Partial keeps it tiny.
CREATE INDEX IF NOT EXISTS idx_bids_pending_unscheduled_age
  ON public.bids ("createdAt")
  WHERE status = 'PENDING' AND auto_accept_at IS NULL;
