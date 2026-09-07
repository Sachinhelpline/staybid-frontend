-- ============================================================================
-- SEC-00B — P1J — FINAL MEDIA PROCESSING / NORMALIZATION — DB FOUNDATION
-- ----------------------------------------------------------------------------
-- Additive / forward-only. Builds on the accepted P1I-1 validation stage and the
-- P1I-3 file-safety stage. P1J produces a fully decoded, sanitized, normalized,
-- PRIVATE processed output whose exact output bytes are independently verified and
-- DB-bound before status becomes READY.
--
-- Lifecycle boundary this stage owns:
--   media_processing (validation_outcome=passed AND file_safety_outcome=clean
--                     AND scanner_scanned_sha256 = actual_sha256 AND not-deleted)
--     --(ready)------> ready       (a private normalized processed object exists,
--                                   its exact identity/hash/size/type DB-recorded,
--                                   output-verified; NOT published, NOT a cutover,
--                                   NOT raw-quarantine deletion, NOT activation)
--     --(rejected)---> rejected    (rejected_reason in the P1J-owned fixed set)
--
-- It does NOT: reopen P1I-2 validation or P1I-3 file-safety, publish media, cut over
-- customer routes, delete the raw quarantine object, or activate production.
--
-- This migration:
--   * adds 17 additive nullable-safe control-plane columns
--     (processing_claim_generation is BIGINT NOT NULL DEFAULT 0 for fencing);
--   * adds stable-named fail-closed CHECK constraints;
--   * adds ONE partial index for the claimable set;
--   * creates THREE SECURITY INVOKER, service_role-only RPCs
--     (claim + complete-ready + complete-rejection).
-- The private processed bucket contract (social-media-processed, public=false,
-- 100 MiB) is a SEPARATE SOURCE-ONLY review artifact
-- (2026-09-07-sec00b-p1j-processed-bucket.sql) — NOT applied by this migration and
-- NOT applied to any hosted project by this change.
-- ============================================================================

-- ── 1) Additive control-plane columns ───────────────────────────────────────
ALTER TABLE public.media_upload_sessions
  ADD COLUMN IF NOT EXISTS processing_claimed_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS processing_claim_generation  BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS processing_completed_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS processing_outcome           TEXT,
  ADD COLUMN IF NOT EXISTS processed_bucket             TEXT,
  ADD COLUMN IF NOT EXISTS processed_object_key         TEXT,
  ADD COLUMN IF NOT EXISTS processed_byte_size          BIGINT,
  ADD COLUMN IF NOT EXISTS processed_sha256             TEXT,
  ADD COLUMN IF NOT EXISTS processed_content_type       TEXT,
  ADD COLUMN IF NOT EXISTS processed_container          TEXT,
  ADD COLUMN IF NOT EXISTS processed_width_px           INTEGER,
  ADD COLUMN IF NOT EXISTS processed_height_px          INTEGER,
  ADD COLUMN IF NOT EXISTS processed_duration_ms        BIGINT,
  ADD COLUMN IF NOT EXISTS processed_video_codec        TEXT,
  ADD COLUMN IF NOT EXISTS processed_audio_codec        TEXT,
  ADD COLUMN IF NOT EXISTS processed_storage_object_id  TEXT,
  ADD COLUMN IF NOT EXISTS processed_storage_etag       TEXT;

-- ── 2) Fail-closed CHECK constraints (stable-named; guarded add) ─────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_media_upload_proc_generation_nonneg') THEN
    ALTER TABLE public.media_upload_sessions
      ADD CONSTRAINT chk_media_upload_proc_generation_nonneg
      CHECK (processing_claim_generation >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_media_upload_proc_claim_generation') THEN
    ALTER TABLE public.media_upload_sessions
      ADD CONSTRAINT chk_media_upload_proc_claim_generation
      CHECK (processing_claimed_at IS NULL OR processing_claim_generation >= 1);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_media_upload_proc_outcome') THEN
    ALTER TABLE public.media_upload_sessions
      ADD CONSTRAINT chk_media_upload_proc_outcome
      CHECK (processing_outcome IS NULL OR processing_outcome IN ('ready', 'rejected'));
  END IF;
  -- completion is all-or-none: completed_at present iff outcome present
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_media_upload_proc_complete_pairing') THEN
    ALTER TABLE public.media_upload_sessions
      ADD CONSTRAINT chk_media_upload_proc_complete_pairing
      CHECK ((processing_completed_at IS NULL AND processing_outcome IS NULL)
          OR (processing_completed_at IS NOT NULL AND processing_outcome IS NOT NULL));
  END IF;
  -- processed sha shape (exact 64 lowercase hex) when present
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_media_upload_proc_sha_shape') THEN
    ALTER TABLE public.media_upload_sessions
      ADD CONSTRAINT chk_media_upload_proc_sha_shape
      CHECK (processed_sha256 IS NULL OR processed_sha256 ~ '^[0-9a-f]{64}$');
  END IF;
  -- processed byte size, when present, is strictly positive and <= 100 MiB
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_media_upload_proc_size_positive') THEN
    ALTER TABLE public.media_upload_sessions
      ADD CONSTRAINT chk_media_upload_proc_size_positive
      CHECK (processed_byte_size IS NULL OR (processed_byte_size > 0 AND processed_byte_size <= 104857600));
  END IF;
  -- READY output-evidence presence: a 'ready' outcome REQUIRES the private object's
  -- bucket/key + exact size/hash + normalized type/container (all non-blank).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_media_upload_proc_ready_evidence') THEN
    ALTER TABLE public.media_upload_sessions
      ADD CONSTRAINT chk_media_upload_proc_ready_evidence
      CHECK (processing_outcome IS DISTINCT FROM 'ready'
          OR (processed_bucket IS NOT NULL AND length(btrim(processed_bucket)) > 0
              AND processed_object_key IS NOT NULL AND length(btrim(processed_object_key)) > 0
              AND processed_byte_size IS NOT NULL
              AND processed_sha256 IS NOT NULL
              AND processed_content_type IS NOT NULL AND length(btrim(processed_content_type)) > 0
              AND processed_container IS NOT NULL AND length(btrim(processed_container)) > 0));
  END IF;
END $$;

-- ── 3) Partial index for the claimable processing set ────────────────────────
CREATE INDEX IF NOT EXISTS idx_media_upload_processing_claim
  ON public.media_upload_sessions (processing_claimed_at)
  WHERE status = 'media_processing'
    AND validation_outcome = 'passed'
    AND file_safety_outcome = 'clean'
    AND processing_completed_at IS NULL
    AND quarantine_deleted_at IS NULL;

-- ── helper: DB-owned processed object extension from the P1I-2 detected container
-- (never a customer filename). Unknown container -> 'bin' (worker rejects a lot it
-- cannot map, so this is a defensive default only).
CREATE OR REPLACE FUNCTION public.sb_p1j_processed_ext(p_container TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
  SELECT CASE lower(coalesce(p_container, ''))
           WHEN 'jpeg' THEN 'jpg'
           WHEN 'png'  THEN 'png'
           WHEN 'webp' THEN 'webp'
           WHEN 'mp4'  THEN 'mp4'
           WHEN 'webm' THEN 'webm'
           WHEN 'mp3'  THEN 'mp3'
           WHEN 'm4a'  THEN 'm4a'
           ELSE 'bin'
         END;
$$;

-- ── 4A) CLAIM RPC ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.claim_media_upload_processing()
RETURNS TABLE(
  session_id                    TEXT,
  media_class                   TEXT,
  quarantine_bucket             TEXT,
  object_key                    TEXT,
  observed_byte_size            BIGINT,
  observed_storage_object_id    TEXT,
  observed_storage_etag         TEXT,
  actual_sha256                 TEXT,
  detected_content_type         TEXT,
  detected_container            TEXT,
  media_width_px                INTEGER,
  media_height_px               INTEGER,
  media_duration_ms             BIGINT,
  detected_video_codec          TEXT,
  detected_audio_codec          TEXT,
  processing_claim_generation   BIGINT,
  processed_bucket              TEXT,
  processed_object_key          TEXT
)
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  c_lease  CONSTANT INTERVAL := INTERVAL '30 minutes';  -- DB-fixed processing lease
  c_bucket CONSTANT TEXT     := 'social-media-processed';
  v_now    TIMESTAMPTZ;
  v_row    RECORD;
  v_gen    BIGINT;
BEGIN
  SELECT s.id, s.status, s.validation_outcome, s.file_safety_outcome, s.actual_sha256,
         s.scanner_scanned_sha256, s.file_safety_completed_at, s.quarantine_deleted_at,
         s.processing_claimed_at, s.processing_completed_at,
         s.media_class, s.quarantine_bucket, s.object_key, s.observed_byte_size,
         s.observed_storage_object_id, s.observed_storage_etag,
         s.detected_content_type, s.detected_container,
         s.media_width_px, s.media_height_px, s.media_duration_ms,
         s.detected_video_codec, s.detected_audio_codec
    INTO v_row
    FROM public.media_upload_sessions s
   WHERE s.quarantine_deleted_at IS NULL
     AND s.processing_completed_at IS NULL
     AND s.status = 'media_processing'
     AND s.validation_outcome = 'passed'
     AND s.file_safety_outcome = 'clean'
     AND s.actual_sha256 IS NOT NULL
     AND s.scanner_scanned_sha256 = s.actual_sha256
     AND s.file_safety_completed_at IS NOT NULL
     AND (s.processing_claimed_at IS NULL
          OR s.processing_claimed_at <= clock_timestamp() - c_lease)
   ORDER BY s.processing_claimed_at NULLS FIRST
   FOR UPDATE SKIP LOCKED
   LIMIT 1;

  IF v_row.id IS NULL THEN
    RETURN;  -- nothing claimable
  END IF;

  v_now := pg_catalog.clock_timestamp();

  -- Authoritative post-lock re-gate against v_now (fail-closed disjunction).
  IF v_row.quarantine_deleted_at IS NOT NULL
     OR v_row.processing_completed_at IS NOT NULL
     OR v_row.status IS DISTINCT FROM 'media_processing'
     OR v_row.validation_outcome IS DISTINCT FROM 'passed'
     OR v_row.file_safety_outcome IS DISTINCT FROM 'clean'
     OR v_row.actual_sha256 IS NULL
     OR v_row.scanner_scanned_sha256 IS DISTINCT FROM v_row.actual_sha256
     OR v_row.file_safety_completed_at IS NULL
     OR NOT (v_row.processing_claimed_at IS NULL
             OR v_row.processing_claimed_at <= v_now - c_lease)
  THEN
    RETURN;
  END IF;

  UPDATE public.media_upload_sessions m
     SET processing_claimed_at       = v_now,
         processing_claim_generation = m.processing_claim_generation + 1,
         updated_at                  = v_now
   WHERE m.id = v_row.id
   RETURNING m.processing_claim_generation INTO v_gen;

  session_id                    := v_row.id;
  media_class                   := v_row.media_class;
  quarantine_bucket             := v_row.quarantine_bucket;
  object_key                    := v_row.object_key;
  observed_byte_size            := v_row.observed_byte_size;
  observed_storage_object_id    := v_row.observed_storage_object_id;
  observed_storage_etag         := v_row.observed_storage_etag;
  actual_sha256                 := v_row.actual_sha256;
  detected_content_type         := v_row.detected_content_type;
  detected_container            := v_row.detected_container;
  media_width_px                := v_row.media_width_px;
  media_height_px               := v_row.media_height_px;
  media_duration_ms             := v_row.media_duration_ms;
  detected_video_codec          := v_row.detected_video_codec;
  detected_audio_codec          := v_row.detected_audio_codec;
  processing_claim_generation   := v_gen;
  processed_bucket              := c_bucket;
  -- DB-owned, generation-specific target key (no customer filename, no traversal).
  processed_object_key          := 'sessions/' || v_row.id || '/processed/g' || v_gen::text
                                   || '/final.' || public.sb_p1j_processed_ext(v_row.detected_container);
  RETURN NEXT;
END;
$$;
COMMENT ON FUNCTION public.claim_media_upload_processing()
IS 'SEC-00B-P1J — atomic bounded PROCESSING claim/lease. No caller params; DB-fixed batch 1 / lease 30m. FOR UPDATE SKIP LOCKED + authoritative post-lock re-gate against clock_timestamp(). Claims a not-deleted, not-processing-completed row with status=media_processing AND validation_outcome=passed AND file_safety_outcome=clean AND actual_sha256 present AND scanner_scanned_sha256=actual_sha256 AND file_safety_completed_at present (first claim), or reclaims a stale (>30m) lease; increments processing_claim_generation by 1; returns the bounded worker input fields + the DB-owned generation-specific processed bucket/key. status stays media_processing. SECURITY INVOKER; EXECUTE service_role only. Reads NO storage/bytes.';

-- ── 4B) COMPLETE — READY (media_processing -> ready) ─────────────────────────
CREATE OR REPLACE FUNCTION public.complete_media_upload_processing_ready(
  p_session_id                 TEXT,
  p_processing_generation      BIGINT,
  p_processed_bucket           TEXT,
  p_processed_object_key       TEXT,
  p_processed_byte_size        BIGINT,
  p_processed_sha256           TEXT,
  p_processed_content_type     TEXT,
  p_processed_container        TEXT,
  p_processed_width_px         INTEGER,
  p_processed_height_px        INTEGER,
  p_processed_duration_ms      BIGINT,
  p_processed_video_codec      TEXT,
  p_processed_audio_codec      TEXT,
  p_processed_storage_object_id TEXT,
  p_processed_storage_etag     TEXT
) RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  c_lease CONSTANT INTERVAL := INTERVAL '30 minutes';
  v_now   TIMESTAMPTZ;
  v_row   RECORD;
BEGIN
  -- Fail-closed structural input (complete output evidence required).
  IF p_session_id IS NULL OR length(btrim(p_session_id)) = 0 THEN
    RAISE EXCEPTION 'complete_media_upload_processing_ready: session_id required';
  END IF;
  IF p_processing_generation IS NULL OR p_processing_generation < 1 THEN
    RAISE EXCEPTION 'complete_media_upload_processing_ready: invalid generation';
  END IF;
  IF p_processed_bucket IS NULL OR length(btrim(p_processed_bucket)) = 0
     OR p_processed_object_key IS NULL OR length(btrim(p_processed_object_key)) = 0 THEN
    RAISE EXCEPTION 'complete_media_upload_processing_ready: processed bucket/key required';
  END IF;
  IF p_processed_byte_size IS NULL OR p_processed_byte_size <= 0 OR p_processed_byte_size > 104857600 THEN
    RAISE EXCEPTION 'complete_media_upload_processing_ready: invalid processed_byte_size';
  END IF;
  IF p_processed_sha256 IS NULL OR p_processed_sha256 !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'complete_media_upload_processing_ready: invalid processed_sha256';
  END IF;
  IF p_processed_content_type IS NULL OR length(btrim(p_processed_content_type)) = 0
     OR p_processed_container IS NULL OR length(btrim(p_processed_container)) = 0 THEN
    RAISE EXCEPTION 'complete_media_upload_processing_ready: processed type/container required';
  END IF;

  SELECT s.id, s.status, s.validation_outcome, s.file_safety_outcome, s.actual_sha256,
         s.scanner_scanned_sha256, s.processing_claimed_at, s.processing_claim_generation,
         s.processing_completed_at, s.quarantine_deleted_at
    INTO v_row
    FROM public.media_upload_sessions s
   WHERE s.id = p_session_id
   FOR UPDATE;

  IF v_row.id IS NULL THEN
    RETURN jsonb_build_object('outcome', 'state_conflict');
  END IF;

  v_now := pg_catalog.clock_timestamp();

  -- FENCING (fail-closed disjunction; a NULL term never fails open).
  IF v_row.status IS DISTINCT FROM 'media_processing'
     OR v_row.validation_outcome IS DISTINCT FROM 'passed'
     OR v_row.file_safety_outcome IS DISTINCT FROM 'clean'
     OR v_row.actual_sha256 IS NULL
     OR v_row.scanner_scanned_sha256 IS DISTINCT FROM v_row.actual_sha256
     OR v_row.processing_completed_at IS NOT NULL
     OR v_row.quarantine_deleted_at IS NOT NULL
     OR v_row.processing_claimed_at IS NULL
     OR v_row.processing_claim_generation IS DISTINCT FROM p_processing_generation
     OR v_row.processing_claimed_at <= v_now - c_lease
  THEN
    RETURN jsonb_build_object('outcome', 'state_conflict');
  END IF;

  UPDATE public.media_upload_sessions
     SET status                      = 'ready',
         processing_outcome          = 'ready',
         processing_completed_at     = v_now,
         processed_bucket            = p_processed_bucket,
         processed_object_key        = p_processed_object_key,
         processed_byte_size         = p_processed_byte_size,
         processed_sha256            = p_processed_sha256,
         processed_content_type      = p_processed_content_type,
         processed_container         = p_processed_container,
         processed_width_px          = p_processed_width_px,
         processed_height_px         = p_processed_height_px,
         processed_duration_ms       = p_processed_duration_ms,
         processed_video_codec       = p_processed_video_codec,
         processed_audio_codec       = p_processed_audio_codec,
         processed_storage_object_id = p_processed_storage_object_id,
         processed_storage_etag      = p_processed_storage_etag,
         updated_at                  = v_now
   WHERE id = v_row.id
     AND status = 'media_processing'
     AND processing_completed_at IS NULL
     AND processing_claim_generation = p_processing_generation;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'state_conflict');
  END IF;
  RETURN jsonb_build_object('outcome', 'applied', 'status', 'ready');
END;
$$;
COMMENT ON FUNCTION public.complete_media_upload_processing_ready(TEXT, BIGINT, TEXT, TEXT, BIGINT, TEXT, TEXT, TEXT, INTEGER, INTEGER, BIGINT, TEXT, TEXT, TEXT, TEXT)
IS 'SEC-00B-P1J — fenced READY completion (media_processing -> ready). Fail-closed structural input requiring COMPLETE output evidence (bucket/key + positive bounded byte size + 64-hex processed_sha256 + non-blank type/container); locks the row, post-lock clock; requires status=media_processing + validation_outcome=passed + file_safety_outcome=clean + scanner_scanned_sha256=actual_sha256 + exact processing_claim_generation + unexpired 30m lease + not-completed + not-deleted (else state_conflict, ZERO mutation). Records the private processed object identity + normalized media evidence. NO publish / public-storage / raw-deletion / activation happens here. SECURITY INVOKER; EXECUTE service_role only.';

-- ── 4C) COMPLETE — REJECTION (media_processing -> rejected) ──────────────────
CREATE OR REPLACE FUNCTION public.complete_media_upload_processing_rejection(
  p_session_id             TEXT,
  p_processing_generation  BIGINT,
  p_reason                 TEXT
) RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  c_lease CONSTANT INTERVAL := INTERVAL '30 minutes';
  v_now   TIMESTAMPTZ;
  v_row   RECORD;
BEGIN
  IF p_session_id IS NULL OR length(btrim(p_session_id)) = 0 THEN
    RAISE EXCEPTION 'complete_media_upload_processing_rejection: session_id required';
  END IF;
  IF p_processing_generation IS NULL OR p_processing_generation < 1 THEN
    RAISE EXCEPTION 'complete_media_upload_processing_rejection: invalid generation';
  END IF;
  -- ONLY the three P1J-owned deterministic tokens (no arbitrary caller text).
  IF p_reason IS NULL OR p_reason NOT IN ('processing_decode_failed', 'processing_limits_exceeded', 'processing_output_invalid') THEN
    RAISE EXCEPTION 'complete_media_upload_processing_rejection: invalid reason token';
  END IF;

  SELECT s.id, s.status, s.validation_outcome, s.file_safety_outcome, s.actual_sha256,
         s.scanner_scanned_sha256, s.processing_claimed_at, s.processing_claim_generation,
         s.processing_completed_at, s.quarantine_deleted_at
    INTO v_row
    FROM public.media_upload_sessions s
   WHERE s.id = p_session_id
   FOR UPDATE;

  IF v_row.id IS NULL THEN
    RETURN jsonb_build_object('outcome', 'state_conflict');
  END IF;

  v_now := pg_catalog.clock_timestamp();

  IF v_row.status IS DISTINCT FROM 'media_processing'
     OR v_row.validation_outcome IS DISTINCT FROM 'passed'
     OR v_row.file_safety_outcome IS DISTINCT FROM 'clean'
     OR v_row.actual_sha256 IS NULL
     OR v_row.scanner_scanned_sha256 IS DISTINCT FROM v_row.actual_sha256
     OR v_row.processing_completed_at IS NOT NULL
     OR v_row.quarantine_deleted_at IS NOT NULL
     OR v_row.processing_claimed_at IS NULL
     OR v_row.processing_claim_generation IS DISTINCT FROM p_processing_generation
     OR v_row.processing_claimed_at <= v_now - c_lease
  THEN
    RETURN jsonb_build_object('outcome', 'state_conflict');
  END IF;

  UPDATE public.media_upload_sessions
     SET status                  = 'rejected',
         processing_outcome      = 'rejected',
         rejected_reason         = p_reason,
         processing_completed_at = v_now,
         updated_at              = v_now
   WHERE id = v_row.id
     AND status = 'media_processing'
     AND processing_completed_at IS NULL
     AND processing_claim_generation = p_processing_generation;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'state_conflict');
  END IF;
  RETURN jsonb_build_object('outcome', 'applied', 'status', 'rejected');
END;
$$;
COMMENT ON FUNCTION public.complete_media_upload_processing_rejection(TEXT, BIGINT, TEXT)
IS 'SEC-00B-P1J — fenced deterministic REJECTION (media_processing -> rejected). Accepts ONLY the three P1J-owned tokens processing_decode_failed / processing_limits_exceeded / processing_output_invalid (no arbitrary caller text). Same generation/lease/state/file-safety fencing as the ready RPC. Infrastructure/encoder/storage/timeout errors are TRANSIENT and must NOT call this RPC. SECURITY INVOKER; EXECUTE service_role only.';

-- ── 5) EXECUTE privilege lockdown: service_role ONLY ─────────────────────────
REVOKE ALL ON FUNCTION public.claim_media_upload_processing() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_media_upload_processing() FROM anon;
REVOKE ALL ON FUNCTION public.claim_media_upload_processing() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_media_upload_processing() TO service_role;

REVOKE ALL ON FUNCTION public.complete_media_upload_processing_ready(TEXT, BIGINT, TEXT, TEXT, BIGINT, TEXT, TEXT, TEXT, INTEGER, INTEGER, BIGINT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_media_upload_processing_ready(TEXT, BIGINT, TEXT, TEXT, BIGINT, TEXT, TEXT, TEXT, INTEGER, INTEGER, BIGINT, TEXT, TEXT, TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.complete_media_upload_processing_ready(TEXT, BIGINT, TEXT, TEXT, BIGINT, TEXT, TEXT, TEXT, INTEGER, INTEGER, BIGINT, TEXT, TEXT, TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.complete_media_upload_processing_ready(TEXT, BIGINT, TEXT, TEXT, BIGINT, TEXT, TEXT, TEXT, INTEGER, INTEGER, BIGINT, TEXT, TEXT, TEXT, TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.complete_media_upload_processing_rejection(TEXT, BIGINT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_media_upload_processing_rejection(TEXT, BIGINT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.complete_media_upload_processing_rejection(TEXT, BIGINT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.complete_media_upload_processing_rejection(TEXT, BIGINT, TEXT) TO service_role;

-- The extension helper is a pure IMMUTABLE mapping; lock it to service_role too.
REVOKE ALL ON FUNCTION public.sb_p1j_processed_ext(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sb_p1j_processed_ext(TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.sb_p1j_processed_ext(TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.sb_p1j_processed_ext(TEXT) TO service_role;

-- END SEC-00B-P1J media-processing-stage DB foundation.
