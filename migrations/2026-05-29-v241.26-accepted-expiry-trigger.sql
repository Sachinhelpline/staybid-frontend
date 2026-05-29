-- v241.26 — Partner-panel acceptance-window hardening (audit fix).
--
-- Central BEFORE trigger that stamps bids."expiresAt" = now() + the hotel's
-- acceptance window (clamped >= 30 min per v241.25) on EVERY transition into
-- ACCEPTED, regardless of which path performs the flip:
--   • mark_expired_holds() cron RPC          (Autopilot / Hybrid auto-accept)
--   • Railway POST /api/bids/:id/accept       (Manual + all-mode partner override)
--   • Railway counter-accept / agent assist
--   • every Next.js accept route + /bid place auto-accept + budget re-accept
--   • Book-Now / flash auto-accept and any FUTURE path
--
-- WHY (regression root cause):
-- v241.17 made bids."expiresAt" the single source of truth for the
-- ACCEPTED-unpaid window (read by isBidExpired / filterActiveBids /
-- filterUserVisibleBids / isBidPayWindowOpen / the place-route isBidStale
-- conflict check / the partner Bid Inbox). But only the Next.js routes were
-- updated to stamp it. The cron RPC (mark_expired_holds) and the Railway
-- accept routes set status='ACCEPTED' ONLY, leaving the PENDING-era expiresAt
-- (createdAt + 1h for /bid-flow, + 3h for Negotiate/Book-Now) in place.
-- Because every surface now reads expiresAt first, the intended 30-min window
-- silently became 1-3h for every cron-/Railway-accepted bid — the partner
-- inbox kept confirmed-unpaid rows (and their revenue) up to 3h, the customer
-- Pay CTA + lock chip stayed open up to 3h, and the one-bid-per-hotel conflict
-- lock persisted up to 3h. See docs/PARTNER-PANEL-AUDIT-v241.17-v241.25.md.
--
-- A data-layer trigger fixes all three modes (Autopilot / Hybrid / Manual) and
-- all entry points at once, and is future-proof: no application code can ever
-- forget to stamp the window again. Railway (Prisma), the Supabase RPC, and
-- the Next.js routes all write to THIS database, so one trigger covers them all.
--
-- SAFETY:
--   • Additive — a brand-new BEFORE trigger. Does NOT modify the existing
--     trg_on_bid_accepted (AFTER, commissions/points), trg_log_bid_status,
--     or trg_sync_bids_city_lower triggers.
--   • Idempotent — fires only on a REAL transition INTO ACCEPTED. A re-write of
--     an already-ACCEPTED row (e.g. the payment write) is skipped, so a paid
--     bid's window is never disturbed and the 30-min clock never restarts.
--   • PENDING / COUNTER / REJECTED rows are never touched — their place-time /
--     counter-time expiresAt is left exactly as-is.
--   • bids."expiresAt" is `timestamp without time zone` holding UTC wall-clock
--     (matches new Date(..).toISOString() written by the app + the UTC
--     convention in mark_stale_pending_bids), so we compute in UTC.

CREATE OR REPLACE FUNCTION public.fn_stamp_accepted_expiry()
RETURNS TRIGGER AS $$
DECLARE
  v_window_min INT;
BEGIN
  -- Only act on a transition INTO ACCEPTED.
  IF UPPER(COALESCE(NEW.status, '')) <> 'ACCEPTED' THEN
    RETURN NEW;
  END IF;
  -- Already ACCEPTED before this write → leave the existing window untouched
  -- (covers the payment write, idempotent re-flips, and any later re-save).
  IF TG_OP = 'UPDATE' AND UPPER(COALESCE(OLD.status, '')) = 'ACCEPTED' THEN
    RETURN NEW;
  END IF;

  -- Resolve the acceptance window: per-hotel override → global default → 30,
  -- clamped to a 30-min floor. Mirrors /api/hotel-hold-config v241.25:
  --   Math.max(30, config?.acceptance_window_min ?? defaults ?? 30)
  -- so an explicit per-hotel value >= 30 (e.g. 60 for luxury) stays
  -- authoritative end-to-end, while legacy < 30 rows are upgraded to 30.
  SELECT GREATEST(30, COALESCE(
           (SELECT acceptance_window_min FROM public.hotel_hold_config
             WHERE hotel_id = NEW."hotelId"),
           (SELECT acceptance_window_min FROM public.hotel_hold_config
             WHERE hotel_id = '_global_defaults'),
           30))
    INTO v_window_min;

  NEW."expiresAt" := (NOW() AT TIME ZONE 'UTC') + (v_window_min || ' minutes')::interval;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_stamp_accepted_expiry ON public.bids;
CREATE TRIGGER trg_stamp_accepted_expiry
  BEFORE INSERT OR UPDATE OF status ON public.bids
  FOR EACH ROW EXECUTE FUNCTION public.fn_stamp_accepted_expiry();
