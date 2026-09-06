-- ════════════════════════════════════════════════════════════════════════
-- SEC-00B-P1G-1 — Media upload quarantine JANITOR: DB claim / lease foundation
--
-- CONTEXT (builds on P1F-1 reservation + P1F-2 lifecycle CAS):
--   Expired / abandoned CREATED and UPLOAD_AUTHORIZED upload sessions leave
--   quarantine-bucket objects (or reserved keys) that a future janitor worker
--   (P1G-2) must clean up. This packet establishes ONLY the database-owned,
--   bounded, retryable CLAIM/LEASE state that such a worker will consume.
--
-- WHAT THIS MIGRATION DOES (additive-only, SOURCE ONLY — not applied here):
--   • Adds TWO nullable columns to public.media_upload_sessions:
--       quarantine_cleanup_claimed_at TIMESTAMPTZ  (lease stamp; NULL = unclaimed)
--       quarantine_deleted_at         TIMESTAMPTZ  (cleanup done; NULL = not deleted)
--   • Adds THREE CHECK constraints binding those columns to status='expired'
--     and forbidding a completed cleanup from remaining actively leased.
--   • Adds ONE bounded partial index for janitor candidate selection.
--   • Creates TWO SECURITY INVOKER RPCs (claim + complete), EXECUTE service_role
--     ONLY.
--
-- WHAT IT DOES NOT DO:
--   • NO Storage object deletion, NO bucket/object mutation, NO storage.objects
--     DELETE (Storage removal is P1G-2, after independent review).
--   • NO DELETE FROM public.media_upload_sessions (the DB row is never removed).
--   • NO release/failure RPC — a crashed worker's claim simply expires after the
--     DB-fixed 10-minute lease and becomes eligible for retry (see the RETRY
--     MODEL note). NO cron route, NO scheduler, NO status enum change ('expired'
--     already exists), NO change to any existing constraint/index/RPC.
--
-- DB-FIXED CONSTANTS (never caller-supplied):
--   • CLAIM BATCH MAX = 50
--   • CLAIM LEASE     = 10 minutes
--   • the authoritative instant is the DB wall-clock (clock_timestamp()), taken
--     once per invocation (claim) / once after the row lock (complete).
--
-- SECURITY:
--   • Both RPCs LANGUAGE plpgsql, VOLATILE, SECURITY INVOKER (NOT DEFINER),
--     pinned search_path, fully-qualified public.media_upload_sessions.
--   • Default EXECUTE REVOKED from PUBLIC / anon / authenticated; GRANTed to
--     service_role ONLY. No browser / customer / admin authority.
-- ════════════════════════════════════════════════════════════════════════

-- ── 1) Additive nullable columns ───────────────────────────────────────
-- Existing rows stay valid: both columns default NULL.
ALTER TABLE public.media_upload_sessions
  ADD COLUMN IF NOT EXISTS quarantine_cleanup_claimed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS quarantine_deleted_at         TIMESTAMPTZ;

-- ── 2) Safety CHECK constraints (stable names; idempotent add) ──────────
-- A. A cleanup claim/lease may exist ONLY on an expired row.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'chk_media_upload_quar_claim_expired'
       AND conrelid = 'public.media_upload_sessions'::regclass
  ) THEN
    ALTER TABLE public.media_upload_sessions
      ADD CONSTRAINT chk_media_upload_quar_claim_expired
      CHECK (quarantine_cleanup_claimed_at IS NULL OR status = 'expired');
  END IF;
END $$;

-- B. A cleanup-deleted marker may exist ONLY on an expired row.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'chk_media_upload_quar_deleted_expired'
       AND conrelid = 'public.media_upload_sessions'::regclass
  ) THEN
    ALTER TABLE public.media_upload_sessions
      ADD CONSTRAINT chk_media_upload_quar_deleted_expired
      CHECK (quarantine_deleted_at IS NULL OR status = 'expired');
  END IF;
END $$;

-- C. A completed cleanup can NOT remain actively leased (deleted ⇒ no live claim).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'chk_media_upload_quar_deleted_not_leased'
       AND conrelid = 'public.media_upload_sessions'::regclass
  ) THEN
    ALTER TABLE public.media_upload_sessions
      ADD CONSTRAINT chk_media_upload_quar_deleted_not_leased
      CHECK (quarantine_deleted_at IS NULL OR quarantine_cleanup_claimed_at IS NULL);
  END IF;
END $$;

-- ── 3) Bounded partial index for janitor candidate selection ───────────
-- Covers the cleanup scan fields and applies ONLY to not-yet-deleted rows in a
-- cleanup-relevant status. Not for any unrelated query.
CREATE INDEX IF NOT EXISTS idx_media_upload_quar_cleanup
  ON public.media_upload_sessions (status, expires_at, quarantine_cleanup_claimed_at, id)
  WHERE quarantine_deleted_at IS NULL
    AND status IN ('created', 'upload_authorized', 'expired');

-- ──────────────────────────────────────────────────────────────────────
-- claim_media_upload_quarantine_cleanup — atomic bounded CLAIM/LEASE.
--
-- CONTRACT
--   • NO caller parameters — the batch (50), lease (10m), status set, expiry
--     cutoff, and clock are ALL DB-fixed. A caller can never weaken them.
--   • ONE authoritative DB instant (v_now := clock_timestamp(), NOT now()/
--     transaction_timestamp()) drives the expiry comparison, the lease-staleness
--     comparison, the new claim stamp, and the newly-expired updated_at.
--   • Candidate eligibility (all inside ONE txn, FOR UPDATE SKIP LOCKED):
--       quarantine_deleted_at IS NULL
--       AND (claim NULL OR claim <= v_now - 10 min)   -- unclaimed or lease stale
--       AND ( (status='created'           AND expires_at IS NOT NULL AND expires_at <= v_now)
--          OR (status='upload_authorized' AND expires_at IS NOT NULL AND expires_at <= v_now)
--          OR (status='expired') )                    -- CASE C: retry after crash
--     uploading/quarantined/validating/file_safety/media_processing/ready/rejected
--     are NEVER claimed. Deterministic order (expiry, then updated_at, then id),
--     LIMIT 50.
--   • Effect: newly-expired created/upload_authorized rows transition
--     status='expired' + claim=v_now + updated_at=v_now; an already-expired row
--     only (re)stamps claim=v_now (its lifecycle timestamps are NOT rewritten).
--     Never touches rejected_reason / upload_authorized_at / created_at /
--     object_key / bucket / owner / media facts.
--   • FOR UPDATE SKIP LOCKED ⇒ concurrent janitors get DISJOINT claims and never
--     wait on each other's locked rows.
--
-- RETURNS  TABLE(session_id, quarantine_bucket, object_key) — exactly the fields
--   a worker needs to locate the object; NO secret / token / owner / clock.
-- ──────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.claim_media_upload_quarantine_cleanup()
RETURNS TABLE(session_id TEXT, quarantine_bucket TEXT, object_key TEXT)
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  c_batch CONSTANT INT      := 50;                 -- DB-fixed max claim batch
  c_lease CONSTANT INTERVAL := INTERVAL '10 minutes'; -- DB-fixed lease
  v_now   TIMESTAMPTZ;
BEGIN
  -- Single authoritative DB wall-clock instant for this invocation.
  v_now := pg_catalog.clock_timestamp();

  RETURN QUERY
  WITH candidates AS (
    SELECT s.id
      FROM public.media_upload_sessions s
     WHERE s.quarantine_deleted_at IS NULL
       AND (
             s.quarantine_cleanup_claimed_at IS NULL
          OR s.quarantine_cleanup_claimed_at <= v_now - c_lease
       )
       AND (
             (s.status = 'created'           AND s.expires_at IS NOT NULL AND s.expires_at <= v_now)
          OR (s.status = 'upload_authorized' AND s.expires_at IS NOT NULL AND s.expires_at <= v_now)
          OR (s.status = 'expired')
       )
     ORDER BY s.expires_at ASC NULLS FIRST, s.updated_at ASC, s.id ASC
     LIMIT c_batch
     FOR UPDATE SKIP LOCKED
  )
  UPDATE public.media_upload_sessions m
     SET status = 'expired',
         quarantine_cleanup_claimed_at = v_now,
         -- Only a NEWLY-expired row gets a fresh updated_at; an already-expired
         -- row keeps its lifecycle updated_at (only the claim is refreshed).
         updated_at = CASE WHEN m.status = 'expired' THEN m.updated_at ELSE v_now END
    FROM candidates c
   WHERE m.id = c.id
  RETURNING m.id, m.quarantine_bucket, m.object_key;
END;
$$;

COMMENT ON FUNCTION public.claim_media_upload_quarantine_cleanup()
IS 'SEC-00B-P1G-1 — atomic bounded quarantine-cleanup CLAIM. No caller params; DB-fixed batch 50 / lease 10m / clock_timestamp(). FOR UPDATE SKIP LOCKED (disjoint concurrent claims). Claims not-yet-deleted rows that are expired created/upload_authorized (expiry-due) or already expired (retry); later statuses never claimed. Newly-expired rows transition to expired; returns (session_id, quarantine_bucket, object_key). SECURITY INVOKER; EXECUTE service_role only. Deletes NO storage object and NO DB row.';

-- ──────────────────────────────────────────────────────────────────────
-- complete_media_upload_quarantine_cleanup(p_session_id) — mark cleanup done.
--
-- CONTRACT
--   • Caller supplies ONLY the session id (non-null, trimmed non-empty) — NO
--     time / bucket / object path / status / deleted flag.
--   • Permitted ONLY when the row is status='expired' AND quarantine_deleted_at
--     IS NULL AND quarantine_cleanup_claimed_at IS NOT NULL.
--   • The row is locked FOR UPDATE FIRST; the authoritative instant
--     (clock_timestamp()) is taken AFTER the lock, then atomically:
--       quarantine_deleted_at = v_now, quarantine_cleanup_claimed_at = NULL,
--       updated_at = v_now.
--   • Returns {"outcome":"completed"} on success, {"outcome":"state_conflict"}
--     when no eligible row (wrong state / unclaimed / already deleted) — zero
--     mutation in that case. Never deletes the DB row, never resets idempotency
--     data, never touches owner / media facts.
-- ──────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.complete_media_upload_quarantine_cleanup(
  p_session_id TEXT
) RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_now TIMESTAMPTZ;
  v_id  TEXT;
BEGIN
  IF p_session_id IS NULL OR length(btrim(p_session_id)) = 0 THEN
    RAISE EXCEPTION 'complete_media_upload_quarantine_cleanup: session_id required';
  END IF;

  -- Lock the eligible row FIRST (only expired + claimed + not-yet-deleted).
  SELECT s.id INTO v_id
    FROM public.media_upload_sessions s
   WHERE s.id = p_session_id
     AND s.status = 'expired'
     AND s.quarantine_deleted_at IS NULL
     AND s.quarantine_cleanup_claimed_at IS NOT NULL
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'state_conflict');
  END IF;

  -- Authoritative instant taken AFTER the row lock is acquired.
  v_now := pg_catalog.clock_timestamp();

  UPDATE public.media_upload_sessions
     SET quarantine_deleted_at         = v_now,
         quarantine_cleanup_claimed_at = NULL,
         updated_at                    = v_now
   WHERE id = v_id;

  RETURN jsonb_build_object('outcome', 'completed');
END;
$$;

COMMENT ON FUNCTION public.complete_media_upload_quarantine_cleanup(TEXT)
IS 'SEC-00B-P1G-1 — mark a claimed expired quarantine cleanup done. Session id only; locks the row FOR UPDATE then stamps quarantine_deleted_at = clock_timestamp(), clears the claim, updated_at = same instant. Requires status=expired + not-yet-deleted + claimed, else {"outcome":"state_conflict"} (zero mutation). SECURITY INVOKER; EXECUTE service_role only. Deletes NO storage object and NO DB row.';

-- ── EXECUTE privilege lockdown: service_role ONLY (both RPCs) ───────────
REVOKE ALL ON FUNCTION public.claim_media_upload_quarantine_cleanup() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_media_upload_quarantine_cleanup() FROM anon;
REVOKE ALL ON FUNCTION public.claim_media_upload_quarantine_cleanup() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_media_upload_quarantine_cleanup() TO service_role;

REVOKE ALL ON FUNCTION public.complete_media_upload_quarantine_cleanup(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_media_upload_quarantine_cleanup(TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.complete_media_upload_quarantine_cleanup(TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.complete_media_upload_quarantine_cleanup(TEXT) TO service_role;
