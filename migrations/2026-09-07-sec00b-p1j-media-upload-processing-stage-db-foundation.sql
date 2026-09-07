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
--   * defines pure IMMUTABLE canonical-mapping helpers (extension / output container /
--     content-type / family / codec approval) + ONE READY media-shape validator that
--     backs BOTH the CHECK constraint AND the RPC (single source of truth);
--   * adds stable-named fail-closed CHECK constraints;
--   * adds ONE partial index for the claimable set;
--   * creates THREE SECURITY INVOKER, service_role-only RPCs
--     (claim + complete-ready + complete-rejection).
--
-- MATERIAL HARDENING R1 (this pass):
--   * an unmappable / non-canonical detected container is NEVER READY-capable (the
--     extension/output-container helpers return NULL, not a ".bin" default);
--   * the READY completion INDEPENDENTLY recomputes the DB-owned processed bucket +
--     generation-specific object key from the session id + exact generation + stored
--     detected container and requires EXACT equality (a caller can never choose a
--     different bucket / key / extension / customer path / traversal);
--   * READY requires COMPLETE storage identity (non-blank storage object id + etag)
--     and a canonical media-shape (container↔content-type pairing, media_class↔family
--     consistency, per-family width/height/duration/codec shape) — enforced by both a
--     fail-closed CHECK and the RPC.
--
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

-- ── 2) Pure IMMUTABLE canonical-mapping helpers (defined BEFORE the CHECKs that
--       reference them). All key the DB-owned OUTPUT off the P1I-2 DETECTED
--       container (never a customer filename). An unmappable container yields NULL
--       everywhere ⇒ it can never satisfy a READY constraint. ────────────────────

-- DB-owned output extension. NULL = unmappable (never READY-capable; no ".bin" default).
CREATE OR REPLACE FUNCTION public.sb_p1j_processed_ext(p_container TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public AS $$
  SELECT CASE lower(coalesce(p_container, ''))
           WHEN 'jpeg' THEN 'jpg'  WHEN 'png'  THEN 'png'  WHEN 'webp' THEN 'webp'
           WHEN 'mp4'  THEN 'mp4'  WHEN 'webm' THEN 'webm' WHEN 'mp3'  THEN 'mp3'
           WHEN 'm4a'  THEN 'm4a'  ELSE NULL
         END;
$$;

-- Canonical normalized OUTPUT container (identity within the 7-set). NULL = unmappable.
CREATE OR REPLACE FUNCTION public.sb_p1j_output_container(p_container TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public AS $$
  SELECT CASE lower(coalesce(p_container, ''))
           WHEN 'jpeg' THEN 'jpeg' WHEN 'png'  THEN 'png'  WHEN 'webp' THEN 'webp'
           WHEN 'mp4'  THEN 'mp4'  WHEN 'webm' THEN 'webm' WHEN 'mp3'  THEN 'mp3'
           WHEN 'm4a'  THEN 'm4a'  ELSE NULL
         END;
$$;

-- Canonical content-type for a normalized OUTPUT container. NULL = unknown.
CREATE OR REPLACE FUNCTION public.sb_p1j_canonical_content_type(p_container TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public AS $$
  SELECT CASE lower(coalesce(p_container, ''))
           WHEN 'jpeg' THEN 'image/jpeg' WHEN 'png'  THEN 'image/png' WHEN 'webp' THEN 'image/webp'
           WHEN 'mp4'  THEN 'video/mp4'  WHEN 'webm' THEN 'video/webm'
           WHEN 'mp3'  THEN 'audio/mpeg' WHEN 'm4a'  THEN 'audio/mp4' ELSE NULL
         END;
$$;

-- Media family for a normalized OUTPUT container. NULL = unknown.
CREATE OR REPLACE FUNCTION public.sb_p1j_container_family(p_container TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public AS $$
  SELECT CASE lower(coalesce(p_container, ''))
           WHEN 'jpeg' THEN 'image' WHEN 'png'  THEN 'image' WHEN 'webp' THEN 'image'
           WHEN 'mp4'  THEN 'video' WHEN 'webm' THEN 'video'
           WHEN 'mp3'  THEN 'audio' WHEN 'm4a'  THEN 'audio' ELSE NULL
         END;
$$;

-- Approved video codec per normalized OUTPUT container.
CREATE OR REPLACE FUNCTION public.sb_p1j_video_codec_ok(p_container TEXT, p_codec TEXT)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public AS $$
  SELECT CASE lower(coalesce(p_container, ''))
           WHEN 'mp4'  THEN lower(coalesce(p_codec, '')) = 'h264'
           WHEN 'webm' THEN lower(coalesce(p_codec, '')) IN ('vp8', 'vp9')
           ELSE false
         END;
$$;

-- Approved audio codec per normalized OUTPUT container.
CREATE OR REPLACE FUNCTION public.sb_p1j_audio_codec_ok(p_container TEXT, p_codec TEXT)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public AS $$
  SELECT CASE lower(coalesce(p_container, ''))
           WHEN 'mp4'  THEN lower(coalesce(p_codec, '')) = 'aac'
           WHEN 'webm' THEN lower(coalesce(p_codec, '')) = 'opus'
           WHEN 'mp3'  THEN lower(coalesce(p_codec, '')) = 'mp3'
           WHEN 'm4a'  THEN lower(coalesce(p_codec, '')) = 'aac'
           ELSE false
         END;
$$;

-- SINGLE source of truth for READY media-shape validity (backs BOTH the CHECK and the
-- RPC). Requires: canonical container↔content-type pairing; COMPLETE storage identity
-- (non-blank object id + etag); media_class↔family consistency
-- (photo/avatar/circle_image→image · reel→video · audio→audio · story→image|video);
-- and the per-family processed evidence shape:
--   IMAGE: width>0 & height>0 & duration NULL & video_codec NULL & audio_codec NULL
--   VIDEO: width>0 & height>0 & duration>0 & approved video_codec & (audio_codec NULL
--          OR approved) — a missing duration/dimension is NOT valid READY
--   AUDIO: duration>0 & approved audio_codec & width/height/video_codec NULL
CREATE OR REPLACE FUNCTION public.sb_p1j_ready_shape_ok(
  p_media_class       TEXT,
  p_container         TEXT,
  p_content_type      TEXT,
  p_width             INTEGER,
  p_height            INTEGER,
  p_duration          BIGINT,
  p_video_codec       TEXT,
  p_audio_codec       TEXT,
  p_storage_object_id TEXT,
  p_storage_etag      TEXT
) RETURNS BOOLEAN
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, public AS $$
DECLARE
  v_family TEXT := public.sb_p1j_container_family(p_container);
  v_ctype  TEXT := public.sb_p1j_canonical_content_type(p_container);
BEGIN
  -- canonical container + canonical content-type pairing
  IF v_family IS NULL OR v_ctype IS NULL THEN RETURN false; END IF;
  IF p_content_type IS DISTINCT FROM v_ctype THEN RETURN false; END IF;
  -- complete storage identity
  IF p_storage_object_id IS NULL OR length(btrim(p_storage_object_id)) = 0 THEN RETURN false; END IF;
  IF p_storage_etag IS NULL OR length(btrim(p_storage_etag)) = 0 THEN RETURN false; END IF;
  -- media_class <-> family consistency
  IF p_media_class IN ('photo', 'avatar', 'circle_image') THEN
    IF v_family <> 'image' THEN RETURN false; END IF;
  ELSIF p_media_class = 'reel' THEN
    IF v_family <> 'video' THEN RETURN false; END IF;
  ELSIF p_media_class = 'audio' THEN
    IF v_family <> 'audio' THEN RETURN false; END IF;
  ELSIF p_media_class = 'story' THEN
    IF v_family NOT IN ('image', 'video') THEN RETURN false; END IF;
  ELSE
    RETURN false;
  END IF;
  -- per-family processed evidence shape
  IF v_family = 'image' THEN
    RETURN p_width IS NOT NULL AND p_width > 0
       AND p_height IS NOT NULL AND p_height > 0
       AND p_duration IS NULL AND p_video_codec IS NULL AND p_audio_codec IS NULL;
  ELSIF v_family = 'video' THEN
    RETURN p_width IS NOT NULL AND p_width > 0
       AND p_height IS NOT NULL AND p_height > 0
       AND p_duration IS NOT NULL AND p_duration > 0
       AND p_video_codec IS NOT NULL
       AND public.sb_p1j_video_codec_ok(p_container, p_video_codec)
       AND (p_audio_codec IS NULL OR public.sb_p1j_audio_codec_ok(p_container, p_audio_codec));
  ELSE  -- audio
    RETURN p_duration IS NOT NULL AND p_duration > 0
       AND p_width IS NULL AND p_height IS NULL AND p_video_codec IS NULL
       AND p_audio_codec IS NOT NULL
       AND public.sb_p1j_audio_codec_ok(p_container, p_audio_codec);
  END IF;
END;
$$;

-- ── 3) Fail-closed CHECK constraints (stable-named; guarded add) ─────────────
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
  -- READY storage-identity completeness (fail-closed; direct-UPDATE defense).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_media_upload_proc_ready_storage_identity') THEN
    ALTER TABLE public.media_upload_sessions
      ADD CONSTRAINT chk_media_upload_proc_ready_storage_identity
      CHECK (processing_outcome IS DISTINCT FROM 'ready'
          OR (processed_storage_object_id IS NOT NULL AND length(btrim(processed_storage_object_id)) > 0
              AND processed_storage_etag IS NOT NULL AND length(btrim(processed_storage_etag)) > 0));
  END IF;
  -- READY canonical media-shape (container↔content-type pairing + media_class↔family +
  -- per-family width/height/duration/codec shape). Single source of truth via
  -- sb_p1j_ready_shape_ok — fail-closed for any direct UPDATE that bypasses the RPC.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_media_upload_proc_ready_shape') THEN
    ALTER TABLE public.media_upload_sessions
      ADD CONSTRAINT chk_media_upload_proc_ready_shape
      CHECK (processing_outcome IS DISTINCT FROM 'ready'
          OR public.sb_p1j_ready_shape_ok(media_class, processed_container, processed_content_type,
               processed_width_px, processed_height_px, processed_duration_ms,
               processed_video_codec, processed_audio_codec,
               processed_storage_object_id, processed_storage_etag));
  END IF;
END $$;

-- ── 4) Partial index for the claimable processing set ────────────────────────
CREATE INDEX IF NOT EXISTS idx_media_upload_processing_claim
  ON public.media_upload_sessions (processing_claimed_at)
  WHERE status = 'media_processing'
    AND validation_outcome = 'passed'
    AND file_safety_outcome = 'clean'
    AND processing_completed_at IS NULL
    AND quarantine_deleted_at IS NULL;

-- ── 5A) CLAIM RPC ────────────────────────────────────────────────────────────
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
  v_ext    TEXT;
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

  v_ext := public.sb_p1j_processed_ext(v_row.detected_container);

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
  -- DB-owned, generation-specific target key (no customer filename, no traversal). An
  -- unmappable container yields NULL ext ⇒ NULL key (the worker rejects such a lot,
  -- and complete-ready recomputes the same NULL and can never match).
  processed_object_key          := CASE WHEN v_ext IS NULL THEN NULL
                                        ELSE 'sessions/' || v_row.id || '/processed/g' || v_gen::text
                                             || '/final.' || v_ext END;
  RETURN NEXT;
END;
$$;
COMMENT ON FUNCTION public.claim_media_upload_processing()
IS 'SEC-00B-P1J — atomic bounded PROCESSING claim/lease. No caller params; DB-fixed batch 1 / lease 30m. FOR UPDATE SKIP LOCKED + authoritative post-lock re-gate against clock_timestamp(). Claims a not-deleted, not-processing-completed row with status=media_processing AND validation_outcome=passed AND file_safety_outcome=clean AND actual_sha256 present AND scanner_scanned_sha256=actual_sha256 AND file_safety_completed_at present (first claim), or reclaims a stale (>30m) lease; increments processing_claim_generation by 1; returns the bounded worker input fields + the DB-owned generation-specific processed bucket/key (NULL key for an unmappable container). status stays media_processing. SECURITY INVOKER; EXECUTE service_role only. Reads NO storage/bytes.';

-- ── 5B) COMPLETE — READY (media_processing -> ready) ─────────────────────────
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
  c_lease        CONSTANT INTERVAL := INTERVAL '30 minutes';
  c_bucket       CONSTANT TEXT     := 'social-media-processed';
  v_now          TIMESTAMPTZ;
  v_row          RECORD;
  v_ext          TEXT;
  v_out_container TEXT;
  v_expected_key TEXT;
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
         s.processing_completed_at, s.quarantine_deleted_at,
         s.media_class, s.detected_container
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

  -- DB-OWNED DESTINATION BINDING (Gap 1): recompute the expected bucket + the exact
  -- generation-specific key from the session id + fenced generation + stored detected
  -- container. A caller can never choose a different bucket / key / extension / customer
  -- path / traversal, and an unmappable container (NULL ext/container) can never READY.
  v_ext           := public.sb_p1j_processed_ext(v_row.detected_container);
  v_out_container := public.sb_p1j_output_container(v_row.detected_container);
  v_expected_key  := CASE WHEN v_ext IS NULL THEN NULL
                          ELSE 'sessions/' || v_row.id || '/processed/g' || p_processing_generation::text
                               || '/final.' || v_ext END;
  IF v_ext IS NULL OR v_out_container IS NULL OR v_expected_key IS NULL
     OR p_processed_bucket IS DISTINCT FROM c_bucket
     OR p_processed_object_key IS DISTINCT FROM v_expected_key
     OR p_processed_container IS DISTINCT FROM v_out_container
  THEN
    RETURN jsonb_build_object('outcome', 'state_conflict');
  END IF;

  -- COMPLETE STORAGE IDENTITY + CANONICAL MEDIA-SHAPE (Gap 2/3), single source of truth.
  IF NOT public.sb_p1j_ready_shape_ok(
       v_row.media_class, p_processed_container, p_processed_content_type,
       p_processed_width_px, p_processed_height_px, p_processed_duration_ms,
       p_processed_video_codec, p_processed_audio_codec,
       p_processed_storage_object_id, p_processed_storage_etag)
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
IS 'SEC-00B-P1J — fenced READY completion (media_processing -> ready). Fail-closed structural input requiring COMPLETE output evidence (bucket/key + positive bounded byte size + 64-hex processed_sha256 + non-blank type/container); locks the row, post-lock clock; requires status=media_processing + validation_outcome=passed + file_safety_outcome=clean + scanner_scanned_sha256=actual_sha256 + exact processing_claim_generation + unexpired 30m lease + not-completed + not-deleted. R1: independently RECOMPUTES the DB-owned processed bucket + generation-specific key from session id + fenced generation + stored detected container and requires EXACT bucket/key/output-container equality (unmappable container never READY), then requires COMPLETE storage identity + canonical media-shape via sb_p1j_ready_shape_ok — any mismatch => state_conflict, ZERO mutation. Records the private processed object identity + normalized media evidence. NO publish / public-storage / raw-deletion / activation. SECURITY INVOKER; EXECUTE service_role only.';

-- ── 5C) COMPLETE — REJECTION (media_processing -> rejected) ──────────────────
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

-- ── 6) EXECUTE privilege lockdown: service_role ONLY ─────────────────────────
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

-- The pure IMMUTABLE mapping/shape helpers are locked to service_role too (they are
-- consulted by the service_role RPCs + by the READY CHECK constraint under a
-- service_role UPDATE).
REVOKE ALL ON FUNCTION public.sb_p1j_processed_ext(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sb_p1j_processed_ext(TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.sb_p1j_processed_ext(TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.sb_p1j_processed_ext(TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.sb_p1j_output_container(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sb_p1j_output_container(TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.sb_p1j_output_container(TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.sb_p1j_output_container(TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.sb_p1j_canonical_content_type(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sb_p1j_canonical_content_type(TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.sb_p1j_canonical_content_type(TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.sb_p1j_canonical_content_type(TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.sb_p1j_container_family(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sb_p1j_container_family(TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.sb_p1j_container_family(TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.sb_p1j_container_family(TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.sb_p1j_video_codec_ok(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sb_p1j_video_codec_ok(TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.sb_p1j_video_codec_ok(TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.sb_p1j_video_codec_ok(TEXT, TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.sb_p1j_audio_codec_ok(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sb_p1j_audio_codec_ok(TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.sb_p1j_audio_codec_ok(TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.sb_p1j_audio_codec_ok(TEXT, TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.sb_p1j_ready_shape_ok(TEXT, TEXT, TEXT, INTEGER, INTEGER, BIGINT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sb_p1j_ready_shape_ok(TEXT, TEXT, TEXT, INTEGER, INTEGER, BIGINT, TEXT, TEXT, TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.sb_p1j_ready_shape_ok(TEXT, TEXT, TEXT, INTEGER, INTEGER, BIGINT, TEXT, TEXT, TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.sb_p1j_ready_shape_ok(TEXT, TEXT, TEXT, INTEGER, INTEGER, BIGINT, TEXT, TEXT, TEXT, TEXT) TO service_role;

-- END SEC-00B-P1J media-processing-stage DB foundation.
