-- v229 — Bid washout completeness + future-proof hardening
--
-- APPLIED LIVE 2026-05-26 via Supabase MCP. This file is the source-
-- of-truth record; reapplying via psql is idempotent (uses
-- IF NOT EXISTS / DROP IF EXISTS throughout).
--
-- Three independent hardenings ship together:
--   (A) Washout cron extensions — mark_stale_pending_bids extended to
--       sweep COUNTER bids past 6h grace; new mark_orphaned_accepted_bids
--       RPC for ACCEPTED-unpaid rows whose acceptance_window died.
--   (B) Status CHECK constraint — typo regressions ("CANCELED"
--       vs "CANCELLED") can no longer slip through silently.
--   (C) Audit log + partial unique index — every status flip recorded
--       immutably + race condition closed for "one active bid per
--       (customer × city)" rule.
--
-- See CLAUDE.md (v229 Era) for the user-reported bugs this closes.

-- ───────────────────────────────────────────────────────────────────
-- (A) Washout RPCs — stale COUNTER + orphaned ACCEPTED-unpaid sweeps
-- ───────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.mark_stale_pending_bids();

CREATE FUNCTION public.mark_stale_pending_bids()
 RETURNS TABLE(unscheduled_expired integer, scheduled_expired integer, counter_expired integer, ran_at timestamp with time zone)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_unsched_count INT := 0;
  v_sched_count   INT := 0;
  v_counter_count INT := 0;
BEGIN
  -- A1. PENDING (no auto_accept_at scheduled) older than 6h
  WITH stale_unscheduled AS (
    SELECT id FROM public.bids
     WHERE status = 'PENDING' AND auto_accept_at IS NULL
       AND "createdAt" < (NOW() AT TIME ZONE 'UTC') - INTERVAL '6 hours'
     ORDER BY "createdAt" ASC LIMIT 500
  ),
  upd_unsched AS (
    UPDATE public.bids b SET status = 'EXPIRED'
      FROM stale_unscheduled s WHERE b.id = s.id AND b.status = 'PENDING'
    RETURNING b.id
  )
  SELECT COUNT(*)::INT INTO v_unsched_count FROM upd_unsched;

  -- A2. PENDING with auto_accept_at far past — cron-lag safety net
  WITH stale_scheduled AS (
    SELECT id FROM public.bids
     WHERE status = 'PENDING' AND auto_accept_at IS NOT NULL
       AND auto_accept_at < NOW() - INTERVAL '15 minutes'
     ORDER BY auto_accept_at ASC LIMIT 500
  ),
  upd_sched AS (
    UPDATE public.bids b SET status = 'EXPIRED'
      FROM stale_scheduled s WHERE b.id = s.id AND b.status = 'PENDING'
    RETURNING b.id
  )
  SELECT COUNT(*)::INT INTO v_sched_count FROM upd_sched;

  -- A3. v229 — stale COUNTER sweep. 6h past expiresAt = far past any
  -- reasonable 1h/3h flow window + Railway in-process cron's 5-min cadence.
  WITH stale_counter AS (
    SELECT id FROM public.bids
     WHERE status = 'COUNTER' AND "expiresAt" < NOW() - INTERVAL '6 hours'
     ORDER BY "createdAt" ASC LIMIT 500
  ),
  upd_counter AS (
    UPDATE public.bids b SET status = 'EXPIRED'
      FROM stale_counter s WHERE b.id = s.id AND b.status = 'COUNTER'
    RETURNING b.id
  )
  SELECT COUNT(*)::INT INTO v_counter_count FROM upd_counter;

  RETURN QUERY SELECT v_unsched_count, v_sched_count, v_counter_count, NOW();
END;
$function$;

-- NEW: flips ACCEPTED bids to EXPIRED when acceptance_window died + no payment.
-- 30-min grace past window expiry handles the cron-vs-pay race cleanly.
CREATE OR REPLACE FUNCTION public.mark_orphaned_accepted_bids()
 RETURNS TABLE(orphaned_expired integer, ran_at timestamp with time zone)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_count INT := 0;
BEGIN
  WITH orphaned AS (
    SELECT b.id FROM public.bids b
      JOIN public.bid_acceptance_windows aw ON aw.bid_id = b.id
      LEFT JOIN public.bid_paid_amounts bpa ON bpa.bid_id = b.id
     WHERE b.status = 'ACCEPTED'
       AND aw.status IN ('expired', 'cancelled')
       AND aw.expires_at < NOW() - INTERVAL '30 minutes'
       AND (bpa.bid_id IS NULL OR COALESCE(bpa.paid_total, 0) = 0)
     ORDER BY aw.expires_at ASC LIMIT 500
  ),
  upd AS (
    UPDATE public.bids b SET status = 'EXPIRED'
      FROM orphaned o WHERE b.id = o.id AND b.status = 'ACCEPTED'
    RETURNING b.id
  )
  SELECT COUNT(*)::INT INTO v_count FROM upd;

  RETURN QUERY SELECT v_count, NOW();
END;
$function$;

GRANT EXECUTE ON FUNCTION public.mark_stale_pending_bids()      TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_orphaned_accepted_bids()  TO anon, authenticated, service_role;

-- ───────────────────────────────────────────────────────────────────
-- (B) bids.status CHECK constraint — typo guard
-- ───────────────────────────────────────────────────────────────────
ALTER TABLE public.bids DROP CONSTRAINT IF EXISTS bids_status_valid;
ALTER TABLE public.bids ADD CONSTRAINT bids_status_valid
  CHECK (status IN ('PENDING','COUNTER','ACCEPTED','REJECTED','EXPIRED','CANCELLED','CHECKED_IN','CHECKED_OUT'));

-- ───────────────────────────────────────────────────────────────────
-- (C) bid_status_log audit table + every-flip trigger
-- ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.bid_status_log (
  id          BIGSERIAL    PRIMARY KEY,
  bid_id      TEXT         NOT NULL,
  old_status  TEXT,
  new_status  TEXT         NOT NULL,
  changed_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bid_status_log_bid_changed ON public.bid_status_log (bid_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_bid_status_log_changed_at  ON public.bid_status_log (changed_at DESC);

CREATE OR REPLACE FUNCTION public.log_bid_status_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.bid_status_log (bid_id, old_status, new_status)
    VALUES (NEW.id, NULL, NEW.status);
  ELSIF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO public.bid_status_log (bid_id, old_status, new_status)
    VALUES (NEW.id, OLD.status, NEW.status);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_bid_status ON public.bids;
CREATE TRIGGER trg_log_bid_status
  AFTER INSERT OR UPDATE OF status ON public.bids
  FOR EACH ROW EXECUTE FUNCTION public.log_bid_status_change();

-- Seed initial snapshot for the existing 168 rows so the audit history
-- isn't completely missing the pre-trigger past.
INSERT INTO public.bid_status_log (bid_id, old_status, new_status, changed_at)
SELECT id, NULL, status, "createdAt" FROM public.bids
WHERE NOT EXISTS (SELECT 1 FROM public.bid_status_log l WHERE l.bid_id = bids.id);

ALTER TABLE public.bid_status_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bid_status_log_select ON public.bid_status_log;
CREATE POLICY bid_status_log_select ON public.bid_status_log
  FOR SELECT TO anon, authenticated USING (true);

-- ───────────────────────────────────────────────────────────────────
-- (D) Race-condition guard — partial unique index on
--     (customerId, lower(city)) for PENDING + COUNTER bids
-- ───────────────────────────────────────────────────────────────────
-- city_lower is a denormalized column maintained by trigger from
-- hotels.city. Required because PG unique-index expressions can't
-- subquery another table.
ALTER TABLE public.bids ADD COLUMN IF NOT EXISTS city_lower TEXT;

-- Backfill existing rows
UPDATE public.bids b SET city_lower = lower(h.city)
  FROM public.hotels h WHERE b."hotelId" = h.id AND b.city_lower IS NULL;

CREATE OR REPLACE FUNCTION public.sync_bids_city_lower()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW."hotelId" IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW."hotelId" IS DISTINCT FROM OLD."hotelId") THEN
    SELECT lower(city) INTO NEW.city_lower FROM public.hotels WHERE id = NEW."hotelId";
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_bids_city_lower ON public.bids;
CREATE TRIGGER trg_sync_bids_city_lower
  BEFORE INSERT OR UPDATE OF "hotelId" ON public.bids
  FOR EACH ROW EXECUTE FUNCTION public.sync_bids_city_lower();

-- Partial unique index — only enforced while bid is in PENDING or COUNTER.
-- Once a bid transitions to a terminal state the slot frees up so the same
-- customer can launch a fresh bid in the same city.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_bids_one_active_per_city
  ON public.bids ("customerId", city_lower)
  WHERE status IN ('PENDING', 'COUNTER');

GRANT EXECUTE ON FUNCTION public.log_bid_status_change() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sync_bids_city_lower()  TO anon, authenticated, service_role;
