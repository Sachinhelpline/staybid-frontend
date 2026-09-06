-- ════════════════════════════════════════════════════════════════════════
-- SEC-00B-P1F-2 — Media upload-session: DB-TIME LIFECYCLE / CAS remediation
--
-- CONTEXT (builds on P1F-1, read-only):
--   P1F-1 (migrations/2026-09-06-sec00b-p1f-1-…-atomic-reservation.sql) moved the
--   NEW-session reservation into ONE atomic RPC on a single post-lock DB clock.
--   But the three SECURITY-SENSITIVE lifecycle transitions still ran as ordinary
--   store UPDATEs whose status/timestamps were stamped from an APPLICATION clock
--   and whose rejection reason was caller-supplied:
--     • authorizeCreated(id, expiresAtIso, nowIso)   created  -> upload_authorized
--     • refreshAuthorized(id, expiresAtIso, nowIso)   upload_authorized (refresh)
--     • rejectCreated(id, reason, nowIso)             created  -> rejected
--   A skewed / hostile node could therefore shift the authoritative expiry or
--   supply an arbitrary rejection reason for the upload-authorization path.
--
--   P1F-2 removes ALL application-clock / TTL / reason authority from these
--   transitions: they now run through ONE bounded RPC that owns the clock, the
--   fixed 2-hour TTL, and the fixed rejection reason, serialised per-session by a
--   transaction-scoped advisory lock, using a SINGLE DB wall-clock instant taken
--   AFTER the lock is acquired.
--
-- WHAT THIS MIGRATION DOES (additive-only, SOURCE ONLY — not applied here):
--   • CREATE OR REPLACE FUNCTION public.apply_media_upload_authorization_cas(
--       p_session_id TEXT, p_action TEXT) RETURNS JSONB — the DB-time lifecycle
--     CAS gate for exactly three fixed actions.
--   • Lock down its EXECUTE privilege to service_role ONLY.
--
-- WHAT IT DOES NOT DO:
--   • No new table. No column add/alter. No index change. No policy. No bucket /
--     storage change. No data backfill.
--   • Does NOT touch the P1F-1 reservation RPC (public.reserve_media_upload_session),
--     its lock namespace, or its 12 / 60s / 6 / 2h invariants.
--   • Does NOT change provider signed-upload token behaviour (a separate provider
--     boundary) — this governs only the DB lifecycle row.
--   • Does NOT reconstruct the (absent-from-source) P1A media SQL.
--
-- LIFECYCLE INVARIANTS ARE DB-FIXED (never caller-supplied):
--   • LOGICAL LIFECYCLE TTL   = 2 hours (authorize / refresh expiry)
--   • REJECTION REASON        = 'upload_authorization_failed' (fixed)
--   • The authoritative instant is the DB wall-clock AFTER the per-session lock.
--   The caller passes ONLY the session id + one of three fixed action tokens —
--   NO time / expiry / TTL / reason / expected-status parameter exists.
--
-- SECURITY:
--   • LANGUAGE plpgsql, VOLATILE, SECURITY INVOKER (NOT DEFINER), pinned
--     search_path. Fully-qualified public.media_upload_sessions.
--   • Default EXECUTE is REVOKED from PUBLIC / anon / authenticated; GRANTed to
--     service_role ONLY. The server-only privileged store is the only caller.
--   • Returns a bounded JSONB business result only — no SQL error text, lock key,
--     DB internals, secret, or signed token ever appears in the result.
-- ════════════════════════════════════════════════════════════════════════

-- ──────────────────────────────────────────────────────────────────────
-- apply_media_upload_authorization_cas — DB-time lifecycle CAS.
--
-- CONTRACT
--   1. Structurally-impossible trusted-server input (blank session id, unknown
--      action) fails closed (RAISE) BEFORE the lock — the store maps any RPC
--      error to a generic 503; it is NOT a new public client error surface.
--   2. pg_advisory_xact_lock keyed on the SESSION id serialises every lifecycle
--      action for the SAME session. Different session ids lock independently
--      (negligible hash-collision only adds serialization, never weakens
--      correctness). Released at COMMIT / ROLLBACK.
--   3. A SINGLE DB wall-clock instant (v_now := clock_timestamp()) is taken AFTER
--      the lock and drives every timestamp this invocation writes. The
--      application supplies no clock — a caller that opened its transaction, then
--      WAITED on the lock, still stamps the real post-lock instant, never its
--      frozen transaction-start time.
--   4. Each action is a compare-and-set bound on the EXACT expected current
--      status, so a later lifecycle state is NEVER regressed:
--        authorize_created   : created            -> upload_authorized
--                              (upload_authorized_at = updated_at = v_now,
--                               expires_at = v_now + 2h)
--        refresh_authorized  : upload_authorized   -> upload_authorized
--                              (updated_at = v_now, expires_at = v_now + 2h;
--                               upload_authorized_at UNCHANGED)
--        reject_created      : created            -> rejected
--                              (rejected_reason = 'upload_authorization_failed',
--                               updated_at = v_now; expires_at NOT rewritten)
--   5. Exactly one matching row updated  -> outcome 'applied'; zero rows matched
--      (wrong / later status)            -> outcome 'state_conflict', ZERO
--      mutation.
--
-- RETURN  jsonb.
--   authorize_created / refresh_authorized applied:
--     { "outcome":"applied", "status":"upload_authorized", "expires_at": <ts> }
--   reject_created applied:
--     { "outcome":"applied", "status":"rejected" }
--   no matching expected state:
--     { "outcome":"state_conflict" }
--
-- CALLERS  lib/social/upload-session-store.ts::{authorizeCreated,
--   refreshAuthorized,rejectCreated} are the only routes into this RPC from
--   application code.
-- ──────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.apply_media_upload_authorization_cas(
  p_session_id TEXT,
  p_action     TEXT
) RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  -- DB-fixed lifecycle invariants (never caller-supplied).
  c_ttl    CONSTANT INTERVAL := INTERVAL '2 hours';
  c_reason CONSTANT TEXT     := 'upload_authorization_failed';

  v_now        TIMESTAMPTZ;
  v_expires_at TIMESTAMPTZ;
  v_count      INT;
BEGIN
  -- ── 1) Fail-closed trusted-input validation (BEFORE the lock) ──────────
  -- Structurally-impossible-for-a-correct-server conditions. A RAISE here is
  -- mapped by the store to a generic 503 (no SQL text leaked), NOT surfaced as a
  -- new public client error code.
  IF p_session_id IS NULL OR length(btrim(p_session_id)) = 0 THEN
    RAISE EXCEPTION 'apply_media_upload_authorization_cas: session_id required';
  END IF;
  IF p_action IS NULL
     OR p_action NOT IN ('authorize_created', 'refresh_authorized', 'reject_created') THEN
    RAISE EXCEPTION 'apply_media_upload_authorization_cas: invalid action';
  END IF;

  -- ── 2) SERIALIZATION BOUNDARY (per session) ────────────────────────────
  -- Every subsequent statement runs one-caller-at-a-time per session. No dynamic
  -- SQL; the session id is bound as a value into hashtextextended, never
  -- interpolated into SQL text.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('sec00b:media_upload_lifecycle:' || p_session_id, 0)
  );

  -- ── 3) Single authoritative DB WALL-CLOCK instant, taken AFTER the lock ─
  -- clock_timestamp() (NOT now()/transaction_timestamp()): a caller may open its
  -- transaction, then WAIT on the same-session advisory lock above and only
  -- acquire it later. The lifecycle timestamps must key off the real wall-clock
  -- instant AFTER lock acquisition, not the frozen transaction-start time.
  v_now := pg_catalog.clock_timestamp();

  -- ── 4) Action CAS (each bound on the EXACT expected current status) ─────
  IF p_action = 'authorize_created' THEN
    v_expires_at := v_now + c_ttl;
    UPDATE public.media_upload_sessions
       SET status               = 'upload_authorized',
           upload_authorized_at = v_now,
           updated_at           = v_now,
           expires_at           = v_expires_at
     WHERE id = p_session_id
       AND status = 'created';
    GET DIAGNOSTICS v_count = ROW_COUNT;
    IF v_count = 1 THEN
      RETURN jsonb_build_object(
        'outcome', 'applied',
        'status', 'upload_authorized',
        'expires_at', v_expires_at
      );
    END IF;
    RETURN jsonb_build_object('outcome', 'state_conflict');

  ELSIF p_action = 'refresh_authorized' THEN
    v_expires_at := v_now + c_ttl;
    -- Refresh the expiry ONLY while still upload_authorized; upload_authorized_at
    -- is deliberately left unchanged (it records the original authorization).
    UPDATE public.media_upload_sessions
       SET updated_at = v_now,
           expires_at = v_expires_at
     WHERE id = p_session_id
       AND status = 'upload_authorized';
    GET DIAGNOSTICS v_count = ROW_COUNT;
    IF v_count = 1 THEN
      RETURN jsonb_build_object(
        'outcome', 'applied',
        'status', 'upload_authorized',
        'expires_at', v_expires_at
      );
    END IF;
    RETURN jsonb_build_object('outcome', 'state_conflict');

  ELSE  -- p_action = 'reject_created' (validated above; no other value reaches here)
    -- Only a still-CREATED row is ever rejected. expires_at is NOT rewritten.
    UPDATE public.media_upload_sessions
       SET status          = 'rejected',
           rejected_reason = c_reason,
           updated_at      = v_now
     WHERE id = p_session_id
       AND status = 'created';
    GET DIAGNOSTICS v_count = ROW_COUNT;
    IF v_count = 1 THEN
      RETURN jsonb_build_object('outcome', 'applied', 'status', 'rejected');
    END IF;
    RETURN jsonb_build_object('outcome', 'state_conflict');
  END IF;
END;
$$;

COMMENT ON FUNCTION public.apply_media_upload_authorization_cas(TEXT, TEXT)
IS 'SEC-00B-P1F-2 — DB-time media upload-session lifecycle CAS. Serialises per session with pg_advisory_xact_lock; stamps status/updated_at/expires_at from a single post-lock DB clock (2h TTL, fixed rejection reason) for exactly authorize_created / refresh_authorized / reject_created; each CAS is bound on the exact expected status (no later-state regression). SECURITY INVOKER; EXECUTE service_role only. Returns jsonb {outcome[, status, expires_at]}. See migration for the full contract.';

-- ── EXECUTE privilege lockdown: service_role ONLY ──────────────────────
-- Remove the default public EXECUTE grant and every browser/customer role;
-- only the server-side service-role client may invoke this lifecycle CAS.
REVOKE ALL ON FUNCTION public.apply_media_upload_authorization_cas(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_media_upload_authorization_cas(TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.apply_media_upload_authorization_cas(TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.apply_media_upload_authorization_cas(TEXT, TEXT) TO service_role;
