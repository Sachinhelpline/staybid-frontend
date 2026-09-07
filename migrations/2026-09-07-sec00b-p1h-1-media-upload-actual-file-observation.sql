-- ════════════════════════════════════════════════════════════════════════
-- SEC-00B-P1H-1 — Media upload-session: ACTUAL FILE OBSERVATION DB gate
--
-- CONTEXT (builds on P1F-1 reservation + P1F-2 lifecycle CAS + P1G-1 janitor):
--   A future TRUSTED SERVER worker (a later packet) will inspect the exact
--   quarantine Storage object a client uploaded and record what it actually
--   observed (byte size, storage-reported content type, storage object id, ETag).
--   This packet establishes ONLY the DB-owned acceptance gate that such a worker
--   will call to transition upload_authorized -> quarantined AFTER server-observed
--   metadata satisfies the DB contract. P1H-1 itself performs ZERO Storage /
--   network / file work — it only defines the additive columns, the safety
--   constraints, and the single bounded CAS RPC that accepts an observation.
--
--   IMPORTANT SEMANTIC BOUNDARY: reaching 'quarantined' here proves ONLY that the
--   server-observed metadata is self-consistent with the DB row. It does NOT prove
--   the real file type, magic bytes, malware safety, media decodability, READY, or
--   publishability — those remain strictly later stages.
--
-- WHAT THIS MIGRATION DOES (additive-only, SOURCE ONLY — not applied here):
--   • Adds FIVE nullable observation columns to public.media_upload_sessions:
--       observed_byte_size          BIGINT      (server-observed exact byte size)
--       observed_content_type       TEXT        (storage-reported content type)
--       observed_storage_object_id  TEXT        (evidence anchor)
--       observed_storage_etag       TEXT        (evidence anchor)
--       quarantined_at              TIMESTAMPTZ (observation-accepted instant)
--   • Adds FIVE stable named CHECK constraints (bounded size, non-empty strings,
--     and ALL-OR-NONE observation evidence bound to quarantined_at — NOT bound to
--     status, so later legitimate states preserve the same evidence).
--   • Creates ONE SECURITY INVOKER RPC
--     public.confirm_media_upload_quarantine_observation(...), EXECUTE
--     service_role ONLY.
--
-- WHAT IT DOES NOT DO:
--   • NO Storage read / download / list / info; NO file bytes; NO magic-byte or
--     type sniffing; NO antivirus / file-safety; NO media processing; NO READY /
--     promotion; NO customer route; NO new index (the primary key / owner+session
--     access path is sufficient); NO change to any existing column / constraint /
--     index / RPC; NO data backfill; NO DELETE of any row.
--   • Does NOT weaken the existing status constraint and does NOT bind the
--     observation columns to status='quarantined' (a later validating /
--     file_safety / media_processing / ready state must be able to preserve the
--     same observation evidence).
--   • Does NOT reconstruct the (absent-from-source) P1A media SQL.
--
-- OBSERVATION INVARIANTS ARE DB-FIXED (never caller-supplied):
--   • BYTE CEILING           = 104857600 (100 MiB) — the same P1F-1 quarantine cap
--   • DESTINATION BUCKET     = 'social-media-quarantine' (server constant)
--   • DESTINATION OBJECT KEY = 'sessions/<db row id>/raw' (server-derived)
--   • The authoritative instant is the DB wall-clock AFTER the per-row lock.
--   The caller passes ONLY the session id, the owner id, and the four observed
--   values — NO status / timestamp / expiry / bucket / object key / media class /
--   declared size / size limit / action / result / rejection reason parameter
--   exists. Those authorities remain DB / session-owned.
--
-- SECURITY:
--   • LANGUAGE plpgsql, VOLATILE, SECURITY INVOKER (NOT DEFINER), pinned
--     search_path. Fully-qualified public.media_upload_sessions.
--   • Default EXECUTE is REVOKED from PUBLIC / anon / authenticated; GRANTed to
--     service_role ONLY. The server-only privileged store is the only caller.
--   • Returns a bounded JSONB business result only — no SQL error text, lock key,
--     DB internals, secret, or signed token ever appears in the result.
-- ════════════════════════════════════════════════════════════════════════

-- ── 1) Additive nullable observation columns ───────────────────────────
-- Existing rows stay valid: every column defaults NULL.
ALTER TABLE public.media_upload_sessions
  ADD COLUMN IF NOT EXISTS observed_byte_size         BIGINT,
  ADD COLUMN IF NOT EXISTS observed_content_type      TEXT,
  ADD COLUMN IF NOT EXISTS observed_storage_object_id TEXT,
  ADD COLUMN IF NOT EXISTS observed_storage_etag      TEXT,
  ADD COLUMN IF NOT EXISTS quarantined_at             TIMESTAMPTZ;

-- ── 2) Safety CHECK constraints (stable names; idempotent add) ──────────
-- A. Observed byte size, when present, is bounded (0 < size <= 100 MiB).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'chk_media_upload_obs_size'
       AND conrelid = 'public.media_upload_sessions'::regclass
  ) THEN
    ALTER TABLE public.media_upload_sessions
      ADD CONSTRAINT chk_media_upload_obs_size
      CHECK (
        observed_byte_size IS NULL
        OR (observed_byte_size > 0 AND observed_byte_size <= 104857600)
      );
  END IF;
END $$;

-- B. Observed content type, when present, is a non-empty string.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'chk_media_upload_obs_ctype'
       AND conrelid = 'public.media_upload_sessions'::regclass
  ) THEN
    ALTER TABLE public.media_upload_sessions
      ADD CONSTRAINT chk_media_upload_obs_ctype
      CHECK (
        observed_content_type IS NULL
        OR char_length(observed_content_type) > 0
      );
  END IF;
END $$;

-- C. Observed storage object id, when present, is a non-empty string.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'chk_media_upload_obs_objid'
       AND conrelid = 'public.media_upload_sessions'::regclass
  ) THEN
    ALTER TABLE public.media_upload_sessions
      ADD CONSTRAINT chk_media_upload_obs_objid
      CHECK (
        observed_storage_object_id IS NULL
        OR char_length(observed_storage_object_id) > 0
      );
  END IF;
END $$;

-- D. Observed storage ETag, when present, is a non-empty string.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'chk_media_upload_obs_etag'
       AND conrelid = 'public.media_upload_sessions'::regclass
  ) THEN
    ALTER TABLE public.media_upload_sessions
      ADD CONSTRAINT chk_media_upload_obs_etag
      CHECK (
        observed_storage_etag IS NULL
        OR char_length(observed_storage_etag) > 0
      );
  END IF;
END $$;

-- E. ALL-OR-NONE: the four observed fields are present exactly when
--    quarantined_at is present (bound to quarantined_at, NOT to status — a later
--    validating / file_safety / media_processing / ready state must be able to
--    preserve the same observation evidence).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'chk_media_upload_obs_all_or_none'
       AND conrelid = 'public.media_upload_sessions'::regclass
  ) THEN
    ALTER TABLE public.media_upload_sessions
      ADD CONSTRAINT chk_media_upload_obs_all_or_none
      CHECK (
        (
          quarantined_at IS NULL
          AND observed_byte_size IS NULL
          AND observed_content_type IS NULL
          AND observed_storage_object_id IS NULL
          AND observed_storage_etag IS NULL
        )
        OR
        (
          quarantined_at IS NOT NULL
          AND observed_byte_size IS NOT NULL
          AND observed_content_type IS NOT NULL
          AND observed_storage_object_id IS NOT NULL
          AND observed_storage_etag IS NOT NULL
        )
      );
  END IF;
END $$;

-- ──────────────────────────────────────────────────────────────────────
-- confirm_media_upload_quarantine_observation — DB-time observation CAS.
--
-- CONTRACT
--   1. Structurally-impossible trusted-server input (blank ids, non-positive /
--      over-ceiling size, blank / over-long observed strings) fails closed (RAISE)
--      BEFORE the lock — the store maps any RPC error to a generic 503; it is NOT a
--      new public client error surface. btrim is used ONLY to REJECT blank input;
--      the EXACT service-supplied observed strings are persisted (no trim / lower /
--      decode / coercion / caller-controlled normalization).
--   2. The target row is located and locked by (id, owner_user_id) FOR UPDATE. No
--      owner/session match -> {"outcome":"state_conflict"} (never reveals whether
--      another user's session exists).
--   3. A SINGLE DB wall-clock instant (v_now := clock_timestamp()) is taken AFTER
--      the row lock and drives the expiry comparison and every timestamp written —
--      never now()/transaction_timestamp()/caller clock. A caller that opened its
--      transaction, then WAITED on the row lock, still keys off the real post-lock
--      instant, never its frozen transaction-start time.
--   4. First acceptance requires ALL of:
--        • status = 'upload_authorized'
--        • expires_at IS NOT NULL AND expires_at > v_now  (else 'expired', ZERO
--          mutation; P1H-1 never sets status='expired' — the janitor owns that)
--        • quarantine_bucket = 'social-media-quarantine' AND
--          object_key = 'sessions/'||id||'/raw'          (else 'observation_mismatch')
--        • observed byte size = declared_byte_size EXACTLY (else 'observation_mismatch')
--        • observed content type = content_type EXACTLY (no trim / lower / MIME
--          param stripping / family compare; else 'observation_mismatch')
--      then atomically: status='quarantined', the four observed fields, quarantined_at
--      = v_now, updated_at = v_now (bound on status='upload_authorized'). -> 'applied'.
--   5. Idempotent retry: status='quarantined' + quarantined_at NOT NULL + all four
--      persisted observation fields EXACTLY equal the supplied observation ->
--      {"outcome":"idempotent_existing","status":"quarantined"} (ZERO mutation, no
--      timestamp / evidence rewrite).
--   6. status='quarantined' with any differing observation -> 'state_conflict'.
--      Any other status (created / uploading / validating / file_safety /
--      media_processing / ready / rejected / expired) -> 'state_conflict'. No
--      backwards transition, ZERO mutation.
--
-- RETURN  jsonb.
--   applied:              { "outcome":"applied", "status":"quarantined" }
--   idempotent retry:     { "outcome":"idempotent_existing", "status":"quarantined" }
--   expiry gate:          { "outcome":"expired" }
--   destination / size / content-type inconsistency: { "outcome":"observation_mismatch" }
--   wrong owner / wrong state / quarantined mismatch: { "outcome":"state_conflict" }
--
-- CALLERS  a future server-only privileged store is the only route into this RPC.
-- ──────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.confirm_media_upload_quarantine_observation(
  p_session_id           TEXT,
  p_owner_user_id        TEXT,
  p_observed_byte_size   BIGINT,
  p_observed_content_type TEXT,
  p_storage_object_id    TEXT,
  p_storage_etag         TEXT
) RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  -- DB-fixed observation invariants (never caller-supplied).
  c_max_bytes CONSTANT BIGINT := 104857600;             -- 100 MiB quarantine ceiling
  c_bucket    CONSTANT TEXT   := 'social-media-quarantine';

  v_now         TIMESTAMPTZ;
  v_row         RECORD;
  v_expected_key TEXT;
  v_count       INT;
BEGIN
  -- ── 1) Fail-closed trusted-input validation (BEFORE the lock) ──────────
  -- Structurally-impossible-for-a-correct-server conditions. A RAISE here is
  -- mapped by the store to a generic 503 (no SQL text leaked), NOT surfaced as a
  -- new public client error code. btrim is used ONLY to reject blank input — the
  -- EXACT values are stored later (no normalization authority).
  IF p_session_id IS NULL OR length(btrim(p_session_id)) = 0 THEN
    RAISE EXCEPTION 'confirm_media_upload_quarantine_observation: session_id required';
  END IF;
  IF p_owner_user_id IS NULL OR length(btrim(p_owner_user_id)) = 0 THEN
    RAISE EXCEPTION 'confirm_media_upload_quarantine_observation: owner_user_id required';
  END IF;
  IF p_observed_byte_size IS NULL
     OR p_observed_byte_size <= 0
     OR p_observed_byte_size > c_max_bytes THEN
    RAISE EXCEPTION 'confirm_media_upload_quarantine_observation: invalid observed_byte_size';
  END IF;
  IF p_observed_content_type IS NULL
     OR length(btrim(p_observed_content_type)) = 0
     OR char_length(p_observed_content_type) > 128 THEN
    RAISE EXCEPTION 'confirm_media_upload_quarantine_observation: invalid observed_content_type';
  END IF;
  IF p_storage_object_id IS NULL
     OR length(btrim(p_storage_object_id)) = 0
     OR char_length(p_storage_object_id) > 256 THEN
    RAISE EXCEPTION 'confirm_media_upload_quarantine_observation: invalid storage_object_id';
  END IF;
  IF p_storage_etag IS NULL
     OR length(btrim(p_storage_etag)) = 0
     OR char_length(p_storage_etag) > 512 THEN
    RAISE EXCEPTION 'confirm_media_upload_quarantine_observation: invalid storage_etag';
  END IF;

  -- ── 2) Locate + lock the owner's session row FIRST ─────────────────────
  -- The (id, owner_user_id) pair binds the mutation to the owning session. A
  -- FOR UPDATE row lock serialises every observation for this row without an
  -- advisory lock (the transition is session-row scoped).
  SELECT id, status, expires_at, quarantine_bucket, object_key,
         declared_byte_size, content_type, quarantined_at,
         observed_byte_size, observed_content_type,
         observed_storage_object_id, observed_storage_etag
    INTO v_row
    FROM public.media_upload_sessions
   WHERE id = p_session_id
     AND owner_user_id = p_owner_user_id
   FOR UPDATE;

  IF NOT FOUND THEN
    -- Wrong owner or unknown session — never reveal another user's session.
    RETURN jsonb_build_object('outcome', 'state_conflict');
  END IF;

  -- ── 3) Single authoritative DB WALL-CLOCK instant, taken AFTER the lock ─
  -- clock_timestamp() (NOT now()/transaction_timestamp()): a caller may open its
  -- transaction, then WAIT on the row lock above and only acquire it later. The
  -- expiry decision and any timestamp written must key off the real post-lock
  -- instant, never the frozen transaction-start time.
  v_now := pg_catalog.clock_timestamp();

  -- ── 4) Already quarantined: idempotent retry vs mismatch ───────────────
  IF v_row.status = 'quarantined' THEN
    IF v_row.quarantined_at IS NOT NULL
       AND v_row.observed_byte_size          = p_observed_byte_size
       AND v_row.observed_content_type       = p_observed_content_type
       AND v_row.observed_storage_object_id  = p_storage_object_id
       AND v_row.observed_storage_etag       = p_storage_etag THEN
      RETURN jsonb_build_object('outcome', 'idempotent_existing', 'status', 'quarantined');
    END IF;
    -- Quarantined but the supplied observation differs (or evidence absent).
    RETURN jsonb_build_object('outcome', 'state_conflict');
  END IF;

  -- ── 5) Only a still-authorized, unexpired row can accept a first observation ─
  IF v_row.status <> 'upload_authorized' THEN
    -- created / uploading / validating / file_safety / media_processing / ready /
    -- rejected / expired — never a backwards transition.
    RETURN jsonb_build_object('outcome', 'state_conflict');
  END IF;

  -- Authorisation expiry gate. P1H-1 NEVER sets status='expired' (the janitor
  -- owns expired-session cleanup); it only refuses acceptance past expiry.
  IF v_row.expires_at IS NULL OR v_row.expires_at <= v_now THEN
    RETURN jsonb_build_object('outcome', 'expired');
  END IF;

  -- ── 6) Server-owned destination invariants (never caller-supplied) ─────
  v_expected_key := 'sessions/' || v_row.id || '/raw';
  IF v_row.quarantine_bucket <> c_bucket
     OR v_row.object_key <> v_expected_key THEN
    RETURN jsonb_build_object('outcome', 'observation_mismatch');
  END IF;

  -- ── 7) Actual byte-size consistency: EXACT match with declared, no tolerance ─
  IF p_observed_byte_size <> v_row.declared_byte_size THEN
    RETURN jsonb_build_object('outcome', 'observation_mismatch');
  END IF;

  -- ── 8) Storage content-type consistency: EXACT match, no normalization ─
  IF p_observed_content_type <> v_row.content_type THEN
    RETURN jsonb_build_object('outcome', 'observation_mismatch');
  END IF;

  -- ── 9) First accepted transition upload_authorized -> quarantined ──────
  -- CAS bound on the exact expected status; the EXACT observed values are
  -- persisted; a single DB instant stamps quarantined_at and updated_at.
  UPDATE public.media_upload_sessions
     SET status                     = 'quarantined',
         observed_byte_size         = p_observed_byte_size,
         observed_content_type      = p_observed_content_type,
         observed_storage_object_id = p_storage_object_id,
         observed_storage_etag      = p_storage_etag,
         quarantined_at             = v_now,
         updated_at                 = v_now
   WHERE id = v_row.id
     AND status = 'upload_authorized';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count = 1 THEN
    RETURN jsonb_build_object('outcome', 'applied', 'status', 'quarantined');
  END IF;

  -- Defensive: the row moved out from under the lock (should be impossible while
  -- holding FOR UPDATE). Never fabricate an acceptance.
  RETURN jsonb_build_object('outcome', 'state_conflict');
END;
$$;

COMMENT ON FUNCTION public.confirm_media_upload_quarantine_observation(TEXT, TEXT, BIGINT, TEXT, TEXT, TEXT)
IS 'SEC-00B-P1H-1 — DB-time media upload actual-file observation CAS. Locates + locks the (id, owner_user_id) row FOR UPDATE, takes a single post-lock clock_timestamp(), and accepts upload_authorized -> quarantined ONLY when unexpired + server-owned bucket/key invariants hold + observed byte size == declared_byte_size + observed content type == content_type (all EXACT, no normalization). Persists the four exact observed values + quarantined_at. Idempotent on an identical already-quarantined observation; later/other states never regress. Server-observed metadata only — proves NO real file type / magic bytes / malware safety / READY. SECURITY INVOKER; EXECUTE service_role only. Returns jsonb {outcome[, status]}. See migration for the full contract.';

-- ── EXECUTE privilege lockdown: service_role ONLY ──────────────────────
-- Remove the default public EXECUTE grant and every browser/customer role; only
-- the server-side service-role client may invoke this observation CAS.
REVOKE ALL ON FUNCTION public.confirm_media_upload_quarantine_observation(TEXT, TEXT, BIGINT, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.confirm_media_upload_quarantine_observation(TEXT, TEXT, BIGINT, TEXT, TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.confirm_media_upload_quarantine_observation(TEXT, TEXT, BIGINT, TEXT, TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_media_upload_quarantine_observation(TEXT, TEXT, BIGINT, TEXT, TEXT, TEXT) TO service_role;
