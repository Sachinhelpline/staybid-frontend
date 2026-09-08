-- ════════════════════════════════════════════════════════════════════════
-- SEC-00B-P1F-1 — Media upload-session: ATOMIC abuse-reservation RPC
--
-- CONTEXT (P1F preflight, read-only):
--   The DORMANT server upload-session handler (lib/social/upload-session.ts)
--   guarded the NEW-session abuse bounds with THREE separate, non-atomic store
--   calls: countRecentSessions → countActiveSessions → insertCreated. Two (or
--   twelve) concurrent requests for the SAME owner could each read a count
--   below the ceiling and each insert, exceeding the per-owner rate (12 / 60s)
--   or active (6) quota — a TOCTOU race. The quota fields (created_at /
--   expires_at) were also stamped from the APPLICATION clock, so a skewed node
--   could shift its own rate window.
--
--   P1F-1 replaces the count→count→insert boundary with a SINGLE atomic RPC
--   that runs the idempotency check, the two quota counts, and the CREATED
--   insert inside ONE transaction under a per-owner advisory lock, using a
--   SINGLE authoritative DB clock instant for every quota-sensitive field.
--
-- WHAT THIS MIGRATION DOES (additive-only, SOURCE ONLY — not applied here):
--   • CREATE OR REPLACE FUNCTION public.reserve_media_upload_session(...) —
--     the atomic new-session reservation gate.
--   • Lock down its EXECUTE privilege to service_role ONLY.
--
-- WHAT IT DOES NOT DO:
--   • No new table. No column add/alter. No index change. No policy. No bucket
--     / storage change. No existing-row update. No data backfill.
--   • Does NOT touch the CAS lifecycle (authorizeCreated / refreshAuthorized /
--     rejectCreated) — those DB-time CAS timestamps are P1F-2 (NOT this packet).
--   • Does NOT reconstruct the (absent-from-source) P1A media SQL — P1A
--     source-control reconciliation is a separate track.
--
-- ABUSE BOUNDS ARE DB-FIXED SECURITY INVARIANTS (never caller-supplied):
--   • NEW SESSION LIMIT       = 12
--   • ROLLING WINDOW          = 60 seconds
--   • ACTIVE SESSION LIMIT    = 6
--   • CREATED RESERVATION TTL = 2 hours
--   Mirrors upload-session.ts MAX_NEW_SESSIONS_PER_60S / MAX_ACTIVE_SESSIONS /
--   ACTIVE_STATES / SIGNED_UPLOAD_TTL_MS. The caller passes NO limit / window /
--   TTL / clock — a parameter can never weaken these.
--
-- SECURITY:
--   • LANGUAGE plpgsql, VOLATILE, SECURITY INVOKER (NOT DEFINER), pinned
--     search_path. Fully-qualified public.media_upload_sessions.
--   • Default EXECUTE is REVOKED from PUBLIC / anon / authenticated; GRANTed to
--     service_role ONLY. The store invokes it with the service-role key.
--   • Returns a bounded JSONB business result only — no SQL error text, lock
--     key, DB internals, secret, or signed token ever appears in the result.
-- ════════════════════════════════════════════════════════════════════════

-- ──────────────────────────────────────────────────────────────────────
-- reserve_media_upload_session — atomic NEW-session reservation.
--
-- CONCURRENCY CONTRACT
--   1. Structurally-impossible trusted-server input fails closed (RAISE) BEFORE
--      the lock — the store maps any RPC error to a generic 503; it is NOT a new
--      public client error surface.
--   2. pg_advisory_xact_lock keyed on the owner serialises every caller for the
--      SAME owner. Different owners lock independently (negligible hash-collision
--      only adds serialization, never weakens correctness). Released at
--      COMMIT / ROLLBACK.
--   3. Idempotency runs FIRST inside the lock: an existing (owner, idempotency)
--      row returns 'idempotent_existing' and is NEVER counted or re-inserted.
--   4. A SINGLE DB instant (v_now) drives the recent-window comparison, the
--      active-expiry comparison, and the new row's created_at / updated_at /
--      expires_at. The application supplies no clock.
--   5. Rate count is status-agnostic over created_at >= v_now - 60s; active
--      count is status IN (created, upload_authorized) AND not expired at v_now
--      (NULL expiry counts active, fail-closed). A rejection inserts ZERO rows.
--
-- RETURN  jsonb — { outcome, row }.
--   outcome ∈ reserved | idempotent_existing | rate_limited | concurrency_limited
--   row is the canonical session for reserved / idempotent_existing; null for
--   rate_limited / concurrency_limited.
--
-- CALLERS  lib/social/upload-session-store.ts::reserveNewSession is the only
--   route into this RPC from application code.
-- ──────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.reserve_media_upload_session(
  p_session_id         TEXT,
  p_owner_user_id      TEXT,
  p_media_class        TEXT,
  p_content_type       TEXT,
  p_declared_byte_size BIGINT,
  p_object_key         TEXT,
  p_idempotency_key    TEXT
) RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  -- DB-fixed abuse invariants (never caller-supplied).
  c_new_limit    CONSTANT INT      := 12;
  c_window_secs  CONSTANT INT      := 60;
  c_active_limit CONSTANT INT      := 6;
  c_created_ttl  CONSTANT INTERVAL := INTERVAL '2 hours';
  c_max_bytes    CONSTANT BIGINT   := 104857600;  -- 100 MiB quarantine ceiling
  c_bucket       CONSTANT TEXT     := 'social-media-quarantine';

  v_now      TIMESTAMPTZ;
  v_existing RECORD;
  v_recent   INT;
  v_active   INT;
  v_row      RECORD;
BEGIN
  -- ── 1) Fail-closed trusted-input validation (BEFORE the lock) ──────────
  -- These are structurally-impossible-for-a-correct-server conditions. The
  -- application validateInput remains the primary detailed request validator;
  -- a RAISE here is mapped by the store to a generic 503 (no SQL text leaked),
  -- NOT surfaced as a new public client error code.
  IF p_owner_user_id IS NULL OR length(btrim(p_owner_user_id)) = 0 THEN
    RAISE EXCEPTION 'reserve_media_upload_session: owner_user_id required';
  END IF;
  IF p_session_id IS NULL OR length(btrim(p_session_id)) = 0 THEN
    RAISE EXCEPTION 'reserve_media_upload_session: session_id required';
  END IF;
  IF p_object_key IS NULL OR length(btrim(p_object_key)) = 0 THEN
    RAISE EXCEPTION 'reserve_media_upload_session: object_key required';
  END IF;
  IF p_idempotency_key IS NULL OR length(btrim(p_idempotency_key)) = 0 THEN
    RAISE EXCEPTION 'reserve_media_upload_session: idempotency_key required';
  END IF;
  IF p_media_class IS NULL
     OR p_media_class NOT IN ('photo','reel','story','audio','avatar','circle_image') THEN
    RAISE EXCEPTION 'reserve_media_upload_session: invalid media_class';
  END IF;
  IF p_content_type IS NULL OR length(btrim(p_content_type)) = 0 THEN
    RAISE EXCEPTION 'reserve_media_upload_session: content_type required';
  END IF;
  IF p_declared_byte_size IS NULL
     OR p_declared_byte_size <= 0
     OR p_declared_byte_size > c_max_bytes THEN
    RAISE EXCEPTION 'reserve_media_upload_session: invalid declared_byte_size';
  END IF;

  -- ── 2) SERIALIZATION BOUNDARY (per owner) ──────────────────────────────
  -- Every subsequent statement runs one-caller-at-a-time per owner. No dynamic
  -- SQL; the owner string is bound as a value into hashtextextended, never
  -- interpolated into SQL text.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('sec00b:media_upload_reservation:' || p_owner_user_id, 0)
  );

  -- ── 3) Single authoritative DB WALL-CLOCK instant, taken AFTER the lock ─
  -- clock_timestamp() (NOT now()/transaction_timestamp()): a caller may open
  -- its transaction, then WAIT on the same-owner advisory lock above and only
  -- acquire it later. The quota decision must key off the real wall-clock
  -- instant AFTER lock acquisition, not the frozen transaction-start time.
  -- This ONE value is reused for the recent-window comparison, the active-expiry
  -- comparison, and the new row's created_at / updated_at / expires_at.
  v_now := pg_catalog.clock_timestamp();

  -- ── 4) Idempotency FIRST (inside the lock) ─────────────────────────────
  -- An existing canonical (owner, idempotency) row is NEVER counted as a new
  -- session and NEVER re-inserted. The UNIQUE (owner_user_id, idempotency_key)
  -- remains the final arbiter.
  SELECT id, owner_user_id, media_class, content_type,
         declared_byte_size, object_key, status
    INTO v_existing
    FROM public.media_upload_sessions
   WHERE owner_user_id = p_owner_user_id
     AND idempotency_key = p_idempotency_key;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'outcome', 'idempotent_existing',
      'row', jsonb_build_object(
        'id',                 v_existing.id,
        'owner_user_id',      v_existing.owner_user_id,
        'media_class',        v_existing.media_class,
        'content_type',       v_existing.content_type,
        'declared_byte_size', v_existing.declared_byte_size,
        'object_key',         v_existing.object_key,
        'status',             v_existing.status
      )
    );
  END IF;

  -- ── 5) Rate quota (status-agnostic, rolling window) ────────────────────
  SELECT count(*)::int INTO v_recent
    FROM public.media_upload_sessions
   WHERE owner_user_id = p_owner_user_id
     AND created_at >= v_now - make_interval(secs => c_window_secs);

  IF v_recent >= c_new_limit THEN
    RETURN jsonb_build_object('outcome', 'rate_limited', 'row', NULL);
  END IF;

  -- ── 6) Active quota (not-expired active states; NULL counts active) ─────
  SELECT count(*)::int INTO v_active
    FROM public.media_upload_sessions
   WHERE owner_user_id = p_owner_user_id
     AND status IN ('created', 'upload_authorized')
     AND (expires_at IS NULL OR expires_at > v_now);

  IF v_active >= c_active_limit THEN
    RETURN jsonb_build_object('outcome', 'concurrency_limited', 'row', NULL);
  END IF;

  -- ── 7) Atomic CREATED insert (same txn, same lock, DB clock) ───────────
  BEGIN
    INSERT INTO public.media_upload_sessions (
      id, owner_user_id, media_class, content_type, declared_byte_size,
      quarantine_bucket, object_key, idempotency_key, status,
      created_at, updated_at, expires_at
    ) VALUES (
      p_session_id, p_owner_user_id, p_media_class, p_content_type, p_declared_byte_size,
      c_bucket, p_object_key, p_idempotency_key, 'created',
      v_now, v_now, v_now + c_created_ttl
    )
    RETURNING id, owner_user_id, media_class, content_type,
              declared_byte_size, object_key, status
      INTO v_row;
  EXCEPTION WHEN unique_violation THEN
    -- Defensive: a concurrent same-(owner, idempotency) insert won the race.
    -- Re-read the canonical idempotency row; if present, this is an idempotent
    -- retry. A unique violation that is NOT the (owner, idempotency) row (e.g.
    -- a session-id / object-key collision minted for a DIFFERENT reservation)
    -- is NOT disguised as success — re-raise so the store fails closed (503).
    SELECT id, owner_user_id, media_class, content_type,
           declared_byte_size, object_key, status
      INTO v_existing
      FROM public.media_upload_sessions
     WHERE owner_user_id = p_owner_user_id
       AND idempotency_key = p_idempotency_key;
    IF FOUND THEN
      RETURN jsonb_build_object(
        'outcome', 'idempotent_existing',
        'row', jsonb_build_object(
          'id',                 v_existing.id,
          'owner_user_id',      v_existing.owner_user_id,
          'media_class',        v_existing.media_class,
          'content_type',       v_existing.content_type,
          'declared_byte_size', v_existing.declared_byte_size,
          'object_key',         v_existing.object_key,
          'status',             v_existing.status
        )
      );
    END IF;
    RAISE;
  END;

  RETURN jsonb_build_object(
    'outcome', 'reserved',
    'row', jsonb_build_object(
      'id',                 v_row.id,
      'owner_user_id',      v_row.owner_user_id,
      'media_class',        v_row.media_class,
      'content_type',       v_row.content_type,
      'declared_byte_size', v_row.declared_byte_size,
      'object_key',         v_row.object_key,
      'status',             v_row.status
    )
  );
END;
$$;

COMMENT ON FUNCTION public.reserve_media_upload_session(TEXT, TEXT, TEXT, TEXT, BIGINT, TEXT, TEXT)
IS 'SEC-00B-P1F-1 — atomic NEW media upload-session reservation. Serialises per owner with pg_advisory_xact_lock; runs idempotency + rate(12/60s) + active(6) + CREATED insert (2h TTL) in one txn on a single DB clock. SECURITY INVOKER; EXECUTE service_role only. Returns jsonb {outcome, row}. See migration for the full contract.';

-- ── EXECUTE privilege lockdown: service_role ONLY ──────────────────────
-- Remove the default public EXECUTE grant and every browser/customer role;
-- only the server-side service-role client may invoke this reservation.
REVOKE ALL ON FUNCTION public.reserve_media_upload_session(TEXT, TEXT, TEXT, TEXT, BIGINT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reserve_media_upload_session(TEXT, TEXT, TEXT, TEXT, BIGINT, TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.reserve_media_upload_session(TEXT, TEXT, TEXT, TEXT, BIGINT, TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_media_upload_session(TEXT, TEXT, TEXT, TEXT, BIGINT, TEXT, TEXT) TO service_role;
