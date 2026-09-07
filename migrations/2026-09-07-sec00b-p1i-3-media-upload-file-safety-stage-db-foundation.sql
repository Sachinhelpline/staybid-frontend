-- ============================================================================
-- SEC-00B — P1I-3 — MEDIA UPLOAD FILE-SAFETY (MALWARE) STAGE — DB FOUNDATION
-- ----------------------------------------------------------------------------
-- Additive / forward-only. Builds on the accepted P1I-1 validation-stage
-- foundation. P1I-3 answers ONLY: "are the exact P1I-2-validated bytes free of
-- DETECTED malware?" It begins from status='file_safety' with
-- validation_outcome='passed' and P1I-2 actual_sha256 populated.
--
-- Transitions this stage owns:
--   file_safety --(clean)--> media_processing   (P1J owns media_processing onward)
--   file_safety --(malware)-> rejected           (rejected_reason='malware_detected')
--
-- This migration:
--   * adds EXACTLY 8 additive nullable-safe control-plane columns
--     (file_safety_claim_generation is BIGINT NOT NULL DEFAULT 0 for fencing);
--   * adds stable-named CHECK constraints (fail-closed evidence pairing);
--   * adds ONE partial index for the claimable set;
--   * creates EXACTLY THREE SECURITY INVOKER, service_role-only RPCs
--     (claim + complete-clean + complete-malware).
--
-- It does NOT: re-decide media type policy, transcode, normalize, strip EXIF,
-- publish media, grant READY, or weaken any P1I-1 validation RPC.
-- malware_detected is OWNED here (P1I-1's rejection RPC forbids that token).
-- ============================================================================

-- ── 1) Additive control-plane columns ───────────────────────────────────────
ALTER TABLE public.media_upload_sessions
  ADD COLUMN IF NOT EXISTS file_safety_claimed_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS file_safety_claim_generation  BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS file_safety_completed_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS file_safety_outcome           TEXT,
  ADD COLUMN IF NOT EXISTS scanner_engine                TEXT,
  ADD COLUMN IF NOT EXISTS scanner_engine_version        TEXT,
  ADD COLUMN IF NOT EXISTS scanner_signature_version     TEXT,
  ADD COLUMN IF NOT EXISTS scanner_scanned_sha256        TEXT;

-- ── 2) Fail-closed CHECK constraints (stable-named; guarded add) ─────────────
DO $$ BEGIN
  -- generation is never negative
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_media_upload_fs_generation_nonneg') THEN
    ALTER TABLE public.media_upload_sessions
      ADD CONSTRAINT chk_media_upload_fs_generation_nonneg
      CHECK (file_safety_claim_generation >= 0);
  END IF;
  -- a claimed row has generation >= 1
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_media_upload_fs_claim_generation') THEN
    ALTER TABLE public.media_upload_sessions
      ADD CONSTRAINT chk_media_upload_fs_claim_generation
      CHECK (file_safety_claimed_at IS NULL OR file_safety_claim_generation >= 1);
  END IF;
  -- outcome vocabulary
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_media_upload_fs_outcome') THEN
    ALTER TABLE public.media_upload_sessions
      ADD CONSTRAINT chk_media_upload_fs_outcome
      CHECK (file_safety_outcome IS NULL OR file_safety_outcome IN ('clean', 'malware_detected'));
  END IF;
  -- completion is all-or-none: completed_at present iff outcome present
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_media_upload_fs_complete_pairing') THEN
    ALTER TABLE public.media_upload_sessions
      ADD CONSTRAINT chk_media_upload_fs_complete_pairing
      CHECK ((file_safety_completed_at IS NULL AND file_safety_outcome IS NULL)
          OR (file_safety_completed_at IS NOT NULL AND file_safety_outcome IS NOT NULL));
  END IF;
  -- scanned sha shape (exact 64 lowercase hex) when present
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_media_upload_fs_scanned_sha_shape') THEN
    ALTER TABLE public.media_upload_sessions
      ADD CONSTRAINT chk_media_upload_fs_scanned_sha_shape
      CHECK (scanner_scanned_sha256 IS NULL OR scanner_scanned_sha256 ~ '^[0-9a-f]{64}$');
  END IF;
  -- a completed file-safety row carries bounded scanner evidence
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_media_upload_fs_evidence') THEN
    ALTER TABLE public.media_upload_sessions
      ADD CONSTRAINT chk_media_upload_fs_evidence
      CHECK (file_safety_outcome IS NULL
          OR (scanner_engine IS NOT NULL AND length(btrim(scanner_engine)) > 0
              AND scanner_scanned_sha256 IS NOT NULL));
  END IF;
END $$;

-- ── 3) Partial index for the claimable file-safety set ──────────────────────
CREATE INDEX IF NOT EXISTS idx_media_upload_file_safety_claim
  ON public.media_upload_sessions (file_safety_claimed_at)
  WHERE status = 'file_safety'
    AND validation_outcome = 'passed'
    AND file_safety_completed_at IS NULL
    AND quarantine_deleted_at IS NULL;

-- ── 4A) CLAIM RPC ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.claim_media_upload_file_safety()
RETURNS TABLE(
  session_id                  TEXT,
  quarantine_bucket           TEXT,
  object_key                  TEXT,
  observed_byte_size          BIGINT,
  observed_storage_object_id  TEXT,
  observed_storage_etag       TEXT,
  actual_sha256               TEXT,
  file_safety_claim_generation BIGINT
)
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  c_lease CONSTANT INTERVAL := INTERVAL '15 minutes'; -- DB-fixed file-safety lease
  v_now   TIMESTAMPTZ;
  v_row   RECORD;
  v_gen   BIGINT;
BEGIN
  -- Pre-select + lock ONE candidate (batch = 1). The pre-lock WHERE only PRE-SELECTS;
  -- the AUTHORITATIVE claim/reclaim eligibility is re-decided AFTER the lock.
  SELECT s.id, s.status, s.validation_outcome, s.actual_sha256,
         s.quarantine_bucket, s.object_key, s.observed_byte_size,
         s.observed_storage_object_id, s.observed_storage_etag,
         s.file_safety_claimed_at, s.file_safety_completed_at, s.quarantine_deleted_at
    INTO v_row
    FROM public.media_upload_sessions s
   WHERE s.quarantine_deleted_at IS NULL
     AND s.file_safety_completed_at IS NULL
     AND s.status = 'file_safety'
     AND s.validation_outcome = 'passed'
     AND s.actual_sha256 IS NOT NULL
     AND (s.file_safety_claimed_at IS NULL
          OR s.file_safety_claimed_at <= clock_timestamp() - c_lease)
   ORDER BY s.file_safety_claimed_at NULLS FIRST
   FOR UPDATE SKIP LOCKED
   LIMIT 1;

  IF v_row.id IS NULL THEN
    RETURN; -- nothing claimable
  END IF;

  v_now := pg_catalog.clock_timestamp();

  -- Authoritative post-lock re-gate against v_now (first-claim OR stale-lease reclaim).
  IF NOT (
       v_row.quarantine_deleted_at IS NULL
   AND v_row.file_safety_completed_at IS NULL
   AND v_row.status = 'file_safety'
   AND v_row.validation_outcome = 'passed'
   AND v_row.actual_sha256 IS NOT NULL
   AND (v_row.file_safety_claimed_at IS NULL
        OR v_row.file_safety_claimed_at <= v_now - c_lease)
  ) THEN
    RETURN;
  END IF;

  -- Table alias `m` qualifies the column so it is never ambiguous with the
  -- like-named OUT parameter (file_safety_claim_generation).
  UPDATE public.media_upload_sessions m
     SET file_safety_claimed_at       = v_now,
         file_safety_claim_generation = m.file_safety_claim_generation + 1,
         updated_at                   = v_now
   WHERE m.id = v_row.id
   RETURNING m.file_safety_claim_generation INTO v_gen;

  session_id                   := v_row.id;
  quarantine_bucket            := v_row.quarantine_bucket;
  object_key                   := v_row.object_key;
  observed_byte_size           := v_row.observed_byte_size;
  observed_storage_object_id   := v_row.observed_storage_object_id;
  observed_storage_etag        := v_row.observed_storage_etag;
  actual_sha256                := v_row.actual_sha256;
  file_safety_claim_generation := v_gen;
  RETURN NEXT;
END;
$$;
COMMENT ON FUNCTION public.claim_media_upload_file_safety()
IS 'SEC-00B-P1I-3 — atomic bounded FILE-SAFETY claim/lease. No caller params; DB-fixed batch 1 / lease 15m. FOR UPDATE SKIP LOCKED (disjoint concurrent claims); AUTHORITATIVE post-lock re-gate against clock_timestamp(). Claims a not-deleted, not-file-safety-completed row with status=file_safety AND validation_outcome=passed AND actual_sha256 present (first claim), or reclaims a stale (>15m) lease; stamps file_safety_claimed_at, increments file_safety_claim_generation by exactly 1, returns the new generation + the bounded object fields (bucket/key/observed size+id+etag + P1I-2 actual_sha256). SECURITY INVOKER; EXECUTE service_role only. Reads NO storage/bytes.';

-- ── 4B) COMPLETE — CLEAN (file_safety -> media_processing) ───────────────────
CREATE OR REPLACE FUNCTION public.complete_media_upload_file_safety_clean(
  p_session_id                TEXT,
  p_file_safety_generation    BIGINT,
  p_scanner_engine            TEXT,
  p_scanner_engine_version    TEXT,
  p_scanner_signature_version TEXT,
  p_scanner_scanned_sha256    TEXT
) RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  c_lease CONSTANT INTERVAL := INTERVAL '15 minutes';
  v_now   TIMESTAMPTZ;
  v_row   RECORD;
BEGIN
  -- Fail-closed structural input.
  IF p_session_id IS NULL OR length(btrim(p_session_id)) = 0 THEN
    RAISE EXCEPTION 'complete_media_upload_file_safety_clean: session_id required';
  END IF;
  IF p_file_safety_generation IS NULL OR p_file_safety_generation < 1 THEN
    RAISE EXCEPTION 'complete_media_upload_file_safety_clean: invalid generation';
  END IF;
  IF p_scanner_engine IS NULL OR length(btrim(p_scanner_engine)) = 0 THEN
    RAISE EXCEPTION 'complete_media_upload_file_safety_clean: scanner_engine required';
  END IF;
  IF p_scanner_scanned_sha256 IS NULL OR p_scanner_scanned_sha256 !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'complete_media_upload_file_safety_clean: invalid scanner_scanned_sha256';
  END IF;

  SELECT s.id, s.status, s.validation_outcome, s.actual_sha256,
         s.file_safety_claimed_at, s.file_safety_claim_generation,
         s.file_safety_completed_at, s.quarantine_deleted_at
    INTO v_row
    FROM public.media_upload_sessions s
   WHERE s.id = p_session_id
   FOR UPDATE;

  IF v_row.id IS NULL THEN
    RETURN jsonb_build_object('outcome', 'state_conflict');
  END IF;

  v_now := pg_catalog.clock_timestamp();

  -- FENCING (fail-closed DISJUNCTION: any unmet term — a NULL included — is a
  -- state_conflict with ZERO mutation. A conjunctive `IF NOT (.. AND ..)` would
  -- fail OPEN on a NULL term (three-valued logic: NOT(TRUE AND NULL) = NULL, and
  -- `IF NULL` skips the guard). Every term below is a definite boolean
  -- (IS DISTINCT FROM / IS NULL / IS NOT NULL), so a NULL never fails open.
  IF v_row.status IS DISTINCT FROM 'file_safety'
     OR v_row.validation_outcome IS DISTINCT FROM 'passed'
     OR v_row.actual_sha256 IS NULL
     OR v_row.file_safety_completed_at IS NOT NULL
     OR v_row.quarantine_deleted_at IS NOT NULL
     OR v_row.file_safety_claimed_at IS NULL
     OR v_row.file_safety_claim_generation IS DISTINCT FROM p_file_safety_generation
     OR v_row.file_safety_claimed_at <= v_now - c_lease
  THEN
    RETURN jsonb_build_object('outcome', 'state_conflict');
  END IF;

  -- SHA binding: scanned bytes MUST be the P1I-2-validated bytes.
  IF p_scanner_scanned_sha256 IS DISTINCT FROM v_row.actual_sha256 THEN
    RETURN jsonb_build_object('outcome', 'sha_mismatch');
  END IF;

  UPDATE public.media_upload_sessions
     SET status                    = 'media_processing',
         file_safety_outcome       = 'clean',
         file_safety_completed_at  = v_now,
         scanner_engine            = p_scanner_engine,
         scanner_engine_version    = p_scanner_engine_version,
         scanner_signature_version = p_scanner_signature_version,
         scanner_scanned_sha256    = p_scanner_scanned_sha256,
         updated_at                = v_now
   WHERE id = v_row.id
     AND status = 'file_safety'
     AND file_safety_completed_at IS NULL
     AND file_safety_claim_generation = p_file_safety_generation;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'state_conflict');
  END IF;
  RETURN jsonb_build_object('outcome', 'applied', 'status', 'media_processing');
END;
$$;
COMMENT ON FUNCTION public.complete_media_upload_file_safety_clean(TEXT, BIGINT, TEXT, TEXT, TEXT, TEXT)
IS 'SEC-00B-P1I-3 — fenced CLEAN completion (file_safety -> media_processing). Fail-closed structural input; locks the row FOR UPDATE, post-lock clock; requires status=file_safety + validation_outcome=passed + actual_sha256 present + exact file_safety_claim_generation + unexpired 15m lease + not-completed + not-deleted (else state_conflict, ZERO mutation). Binds scanner_scanned_sha256 == stored P1I-2 actual_sha256 (else sha_mismatch, ZERO mutation). Records bounded scanner evidence + file_safety_outcome=clean. SECURITY INVOKER; EXECUTE service_role only. Proves NO processing / normalization / READY.';

-- ── 4C) COMPLETE — MALWARE (file_safety -> rejected) ─────────────────────────
CREATE OR REPLACE FUNCTION public.complete_media_upload_file_safety_malware(
  p_session_id                TEXT,
  p_file_safety_generation    BIGINT,
  p_scanner_engine            TEXT,
  p_scanner_engine_version    TEXT,
  p_scanner_signature_version TEXT,
  p_scanner_scanned_sha256    TEXT
) RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  c_lease CONSTANT INTERVAL := INTERVAL '15 minutes';
  v_now   TIMESTAMPTZ;
  v_row   RECORD;
BEGIN
  IF p_session_id IS NULL OR length(btrim(p_session_id)) = 0 THEN
    RAISE EXCEPTION 'complete_media_upload_file_safety_malware: session_id required';
  END IF;
  IF p_file_safety_generation IS NULL OR p_file_safety_generation < 1 THEN
    RAISE EXCEPTION 'complete_media_upload_file_safety_malware: invalid generation';
  END IF;
  IF p_scanner_engine IS NULL OR length(btrim(p_scanner_engine)) = 0 THEN
    RAISE EXCEPTION 'complete_media_upload_file_safety_malware: scanner_engine required';
  END IF;
  IF p_scanner_scanned_sha256 IS NULL OR p_scanner_scanned_sha256 !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'complete_media_upload_file_safety_malware: invalid scanner_scanned_sha256';
  END IF;

  SELECT s.id, s.status, s.validation_outcome, s.actual_sha256,
         s.file_safety_claimed_at, s.file_safety_claim_generation,
         s.file_safety_completed_at, s.quarantine_deleted_at
    INTO v_row
    FROM public.media_upload_sessions s
   WHERE s.id = p_session_id
   FOR UPDATE;

  IF v_row.id IS NULL THEN
    RETURN jsonb_build_object('outcome', 'state_conflict');
  END IF;

  v_now := pg_catalog.clock_timestamp();

  -- FENCING (fail-closed DISJUNCTION — identical NULL-safe contract as the clean
  -- RPC; a NULL term never fails open).
  IF v_row.status IS DISTINCT FROM 'file_safety'
     OR v_row.validation_outcome IS DISTINCT FROM 'passed'
     OR v_row.actual_sha256 IS NULL
     OR v_row.file_safety_completed_at IS NOT NULL
     OR v_row.quarantine_deleted_at IS NOT NULL
     OR v_row.file_safety_claimed_at IS NULL
     OR v_row.file_safety_claim_generation IS DISTINCT FROM p_file_safety_generation
     OR v_row.file_safety_claimed_at <= v_now - c_lease
  THEN
    RETURN jsonb_build_object('outcome', 'state_conflict');
  END IF;

  IF p_scanner_scanned_sha256 IS DISTINCT FROM v_row.actual_sha256 THEN
    RETURN jsonb_build_object('outcome', 'sha_mismatch');
  END IF;

  UPDATE public.media_upload_sessions
     SET status                    = 'rejected',
         file_safety_outcome       = 'malware_detected',
         rejected_reason           = 'malware_detected',
         file_safety_completed_at  = v_now,
         scanner_engine            = p_scanner_engine,
         scanner_engine_version    = p_scanner_engine_version,
         scanner_signature_version = p_scanner_signature_version,
         scanner_scanned_sha256    = p_scanner_scanned_sha256,
         updated_at                = v_now
   WHERE id = v_row.id
     AND status = 'file_safety'
     AND file_safety_completed_at IS NULL
     AND file_safety_claim_generation = p_file_safety_generation;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'state_conflict');
  END IF;
  RETURN jsonb_build_object('outcome', 'applied', 'status', 'rejected');
END;
$$;
COMMENT ON FUNCTION public.complete_media_upload_file_safety_malware(TEXT, BIGINT, TEXT, TEXT, TEXT, TEXT)
IS 'SEC-00B-P1I-3 — fenced MALWARE completion (file_safety -> rejected). Same fail-closed input + fencing + SHA binding as the clean RPC; on success sets file_safety_outcome=malware_detected, rejected_reason=malware_detected (this token is OWNED by P1I-3 — the P1I-1 validation-rejection RPC forbids it). No arbitrary caller-supplied reason. SECURITY INVOKER; EXECUTE service_role only. Reads NO storage/bytes.';

-- ── 5) EXECUTE privilege lockdown: service_role ONLY (all three RPCs) ─────────
REVOKE ALL ON FUNCTION public.claim_media_upload_file_safety() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_media_upload_file_safety() FROM anon;
REVOKE ALL ON FUNCTION public.claim_media_upload_file_safety() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_media_upload_file_safety() TO service_role;

REVOKE ALL ON FUNCTION public.complete_media_upload_file_safety_clean(TEXT, BIGINT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_media_upload_file_safety_clean(TEXT, BIGINT, TEXT, TEXT, TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.complete_media_upload_file_safety_clean(TEXT, BIGINT, TEXT, TEXT, TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.complete_media_upload_file_safety_clean(TEXT, BIGINT, TEXT, TEXT, TEXT, TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.complete_media_upload_file_safety_malware(TEXT, BIGINT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_media_upload_file_safety_malware(TEXT, BIGINT, TEXT, TEXT, TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.complete_media_upload_file_safety_malware(TEXT, BIGINT, TEXT, TEXT, TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.complete_media_upload_file_safety_malware(TEXT, BIGINT, TEXT, TEXT, TEXT, TEXT) TO service_role;

-- END SEC-00B-P1I-3 file-safety-stage DB foundation.
