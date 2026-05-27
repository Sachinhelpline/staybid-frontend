-- v239.2 — Widen mark_orphaned_accepted_bids to also catch bids that
-- have NO bid_acceptance_windows row.
--
-- APPLIED LIVE to Supabase project uxxhbdqedazpmvbvaosh on 2026-05-27 via
-- MCP apply_migration `v239_widen_mark_orphaned_accepted_bids`. This file
-- is the in-repo audit copy.
--
-- Background:
--   The v229 function required an INNER JOIN to bid_acceptance_windows,
--   which is populated client-side from AcceptedBidTimer's first mount on
--   /my-bids (lib/auto-cancel.ts → POST /api/acceptance-windows). For
--   auto-accepted bids (server-side flip via auto_accept_eligible_bids
--   cron), the customer might never open /my-bids → no window row is
--   ever POSTed → cron sweep INNER JOIN misses the bid forever.
--
--   Symptom (Sachin's report 2026-05-27): 25 orphan ACCEPTED bids
--   accumulated in production, jamming the partner Bid Inbox "Accepted
--   (24)" counter while customer /my-bids client-filter hid them. After
--   manual cleanup of those 25 rows, this widens the sweep so future
--   orphans get caught automatically.
--
-- Contract preserved:
--   * Same function name + return signature → /api/cron/expire-holds
--     callers keep working byte-identical.
--   * SECURITY DEFINER + search_path locked to 'public'.
--   * Only acts on ACCEPTED bids past their 15-min payment window by
--     AT LEAST 30 minutes (same safety buffer as before).
--   * Skips any bid with a payment record (bid_paid_amounts.paid_total > 0).
--   * Still hard-capped at 500 rows per call.

CREATE OR REPLACE FUNCTION public.mark_orphaned_accepted_bids()
 RETURNS TABLE(orphaned_expired integer, ran_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_count INT := 0;
BEGIN
  WITH orphaned AS (
    SELECT b.id
      FROM public.bids b
      LEFT JOIN public.bid_acceptance_windows aw ON aw.bid_id = b.id
      LEFT JOIN public.bid_paid_amounts      bpa ON bpa.bid_id = b.id
     WHERE b.status = 'ACCEPTED'
       AND (
         -- Case A: acceptance_window row exists, marked expired/cancelled
         (aw.status IN ('expired', 'cancelled')
          AND aw.expires_at < NOW() - INTERVAL '30 minutes')
         OR
         -- Case B (NEW v239): no acceptance_window row at all, but the
         -- bid's own expiresAt (15-min payment window stamped at
         -- auto-accept time) is past + grace. Cron blind-spot fix.
         (aw.bid_id IS NULL
          AND b."expiresAt" IS NOT NULL
          AND b."expiresAt" < NOW() - INTERVAL '30 minutes')
       )
       AND (bpa.bid_id IS NULL OR COALESCE(bpa.paid_total, 0) = 0)
     ORDER BY COALESCE(aw.expires_at, b."expiresAt") ASC
     LIMIT 500
  ),
  upd AS (
    UPDATE public.bids b SET status = 'EXPIRED'
      FROM orphaned o
     WHERE b.id = o.id AND b.status = 'ACCEPTED'
    RETURNING b.id
  )
  SELECT COUNT(*)::INT INTO v_count FROM upd;

  RETURN QUERY SELECT v_count, NOW();
END;
$function$;
