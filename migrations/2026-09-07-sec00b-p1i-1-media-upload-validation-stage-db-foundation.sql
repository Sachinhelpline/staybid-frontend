-- ════════════════════════════════════════════════════════════════════════
-- SEC-00B-P1I-1 — Media upload-session: VALIDATION-STAGE DB FOUNDATION
--
-- CONTEXT (builds on P1F-1 reservation + P1F-2 lifecycle CAS + P1G-1 janitor
--   claim + P1H-1 actual-file observation):
--   P1H-1 established the DB gate that accepts a server-observed quarantine object
--   (upload_authorized -> quarantined). The lifecycle then STOPS at 'quarantined':
--   the declared states validating / file_safety / media_processing / ready have NO
--   transition into them. This packet establishes ONLY the DB-owned VALIDATION
--   STAGE control plane that a FUTURE trusted server worker (a LATER packet, P1I-2)
--   will drive: a bounded, fenced CLAIM/LEASE of a quarantined object into
--   'validating', and two fenced completions (validating -> file_safety on PASS,
--   validating -> rejected on a deterministic validation failure).
--
--   IMPORTANT SEMANTIC BOUNDARY: this packet performs ZERO file work. It reads NO
--   Storage object, NO bytes, NO magic/signature, runs NO parser/ffprobe/decoder,
--   NO malware/file-safety scan, NO media processing, and grants NO READY /
--   promotion authority. The evidence columns it defines are POPULATED LATER by the
--   P1I-2 worker through these RPCs; P1I-1 only defines the columns, the fail-closed
--   invariants, the lease/fencing model, and the exact three RPCs. Reaching
--   'file_safety' here proves ONLY that a trusted worker recorded internally
--   self-consistent validation evidence under a live claim generation — it does NOT
--   prove malware safety (P1I-3), processing (P1J), or publishability.
--
-- WHAT THIS MIGRATION DOES (additive-only, SOURCE ONLY — not applied here):
--   • Adds EXACTLY TWELVE additive validation-stage columns to
--     public.media_upload_sessions (all NULL / DEFAULT-0, existing rows stay valid):
--       validation_claimed_at        TIMESTAMPTZ  (lease stamp; NULL = unclaimed)
--       validation_claim_generation  BIGINT NOT NULL DEFAULT 0  (fencing token)
--       validation_completed_at      TIMESTAMPTZ  (terminal completion instant)
--       validation_outcome           TEXT         ('passed' | 'rejected')
--       actual_sha256                TEXT         (64 lowercase hex on PASS)
--       detected_content_type        TEXT         (real sniffed type — P1I-2 vocab)
--       detected_container           TEXT         (real container — P1I-2 vocab)
--       media_width_px               INTEGER
--       media_height_px              INTEGER
--       media_duration_ms            BIGINT
--       detected_video_codec         TEXT
--       detected_audio_codec         TEXT
--   • Adds SIX stable-named fail-closed CHECK constraints (generation >= 0;
--     claimed ⇒ generation >= 1; outcome vocabulary; sha256 shape; outcome⇔completed
--     pairing; PASS core-evidence presence).
--   • Adds ONE bounded partial index for validation claim-candidate selection.
--   • Creates EXACTLY THREE SECURITY INVOKER RPCs (claim + complete-pass +
--     complete-rejection), EXECUTE service_role ONLY.
--
-- WHAT IT DOES NOT DO:
--   • NO Storage read/list/info/download; NO file bytes; NO magic/signature; NO
--     parser/ffprobe/image-decoder; NO malware/ClamAV/file-safety worker; NO
--     media_processing; NO READY/promotion; NO final storage movement; NO writer
--     cutover; NO media-worker; NO Railway/worker code.
--   • Adds NO P1I-3 scanner/safety column (safety_status/…), NO malware_detected
--     token.
--   • Does NOT edit/rewrite/delete any accepted P1F/P1G/P1H migration; does NOT
--     weaken or remove any accepted constraint/index/RPC; does NOT modify the P1G-1
--     janitor (a quarantined/validating row is already outside the janitor's
--     created/upload_authorized/expired claim set — no janitor change is needed).
--   • Does NOT add a table-level rejected_reason CHECK: the validation rejection
--     vocabulary is enforced fail-closed INSIDE RPC C (a table-wide CHECK would
--     over-constrain the pre-existing P1F-2 'upload_authorization_failed' reason and
--     any future non-validation reason — that is broader policy than this packet's
--     locked contract forces, so it is deliberately NOT invented here).
--   • Does NOT reconstruct the (absent-from-source) P1A media SQL.
--
-- VALIDATION-STAGE INVARIANTS ARE DB-FIXED (never caller-supplied):
--   • CLAIM BATCH        = 1     (one job per claim call)
--   • VALIDATION LEASE   = 15 minutes
--   • FENCING TOKEN      = validation_claim_generation (BIGINT, +1 per claim/reclaim)
--   • REJECTION VOCAB    = { file_type_mismatch, unsupported_format, malformed_media,
--                            media_limits_exceeded, unsafe_active_content } (fixed)
--   • The authoritative instant is the DB wall-clock (clock_timestamp()), taken
--     AFTER the row lock. The caller supplies NO time / TTL / batch / claim-owner.
--
-- MEDIA_CLASS EVIDENCE-SHAPE CONTRACT (enforced in RPC B) — R1-02:
--   P1I-1 does NOT prove the CANONICAL DETECTED MEDIA FAMILY (that requires the
--   byte-reading validator + canonical type/container vocabulary DEFERRED to P1I-2).
--   RPC B enforces only that the recorded EVIDENCE SHAPE (geometry/duration/codec
--   presence) is CONSISTENT with the row's media_class:
--     photo/avatar/circle_image -> IMAGE shape ; reel -> VIDEO shape ;
--     audio -> AUDIO shape ; story -> IMAGE shape OR VIDEO shape.
--   detected_content_type/detected_container are recorded as OPAQUE bounded-non-empty
--   strings (no canonical vocabulary asserted here). Declared/client/Storage MIME is
--   advisory only. "evidence-shape compatibility" is NOT "canonical detected-family proof".
--
-- SECURITY:
--   • All three RPCs LANGUAGE plpgsql, VOLATILE, SECURITY INVOKER (NOT DEFINER),
--     pinned search_path, fully-qualified public.media_upload_sessions.
--   • Default EXECUTE REVOKED from PUBLIC / anon / authenticated; GRANTed to
--     service_role ONLY. The server-only privileged worker store is the only caller.
--   • Bounded results only — no SQL error text, lock key, DB internals, secret, or
--     signed token in any result; the claim returns only the bounded job fields.
-- ════════════════════════════════════════════════════════════════════════

-- ── 1) Additive nullable validation-stage columns (exactly twelve) ──────
-- Existing rows stay valid: every column defaults NULL, except the fencing
-- generation which defaults 0 (a never-claimed row).
ALTER TABLE public.media_upload_sessions
  ADD COLUMN IF NOT EXISTS validation_claimed_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS validation_claim_generation BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS validation_completed_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS validation_outcome          TEXT,
  ADD COLUMN IF NOT EXISTS actual_sha256               TEXT,
  ADD COLUMN IF NOT EXISTS detected_content_type       TEXT,
  ADD COLUMN IF NOT EXISTS detected_container          TEXT,
  ADD COLUMN IF NOT EXISTS media_width_px              INTEGER,
  ADD COLUMN IF NOT EXISTS media_height_px             INTEGER,
  ADD COLUMN IF NOT EXISTS media_duration_ms           BIGINT,
  ADD COLUMN IF NOT EXISTS detected_video_codec        TEXT,
  ADD COLUMN IF NOT EXISTS detected_audio_codec        TEXT;

-- ── 2) Fail-closed CHECK constraints (stable names; idempotent add) ─────
-- A. The fencing generation is NEVER negative.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'chk_media_upload_val_generation_nonneg'
       AND conrelid = 'public.media_upload_sessions'::regclass
  ) THEN
    ALTER TABLE public.media_upload_sessions
      ADD CONSTRAINT chk_media_upload_val_generation_nonneg
      CHECK (validation_claim_generation >= 0);
  END IF;
END $$;

-- B. A claimed / in-flight validation row (claim stamp present) has generation >= 1.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'chk_media_upload_val_claim_generation'
       AND conrelid = 'public.media_upload_sessions'::regclass
  ) THEN
    ALTER TABLE public.media_upload_sessions
      ADD CONSTRAINT chk_media_upload_val_claim_generation
      CHECK (validation_claimed_at IS NULL OR validation_claim_generation >= 1);
  END IF;
END $$;

-- C. validation_outcome, when present, is exactly 'passed' or 'rejected'.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'chk_media_upload_val_outcome'
       AND conrelid = 'public.media_upload_sessions'::regclass
  ) THEN
    ALTER TABLE public.media_upload_sessions
      ADD CONSTRAINT chk_media_upload_val_outcome
      CHECK (validation_outcome IS NULL OR validation_outcome IN ('passed', 'rejected'));
  END IF;
END $$;

-- D. actual_sha256, when present, is EXACTLY 64 lowercase hex characters.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'chk_media_upload_val_sha256_shape'
       AND conrelid = 'public.media_upload_sessions'::regclass
  ) THEN
    ALTER TABLE public.media_upload_sessions
      ADD CONSTRAINT chk_media_upload_val_sha256_shape
      CHECK (actual_sha256 IS NULL OR actual_sha256 ~ '^[0-9a-f]{64}$');
  END IF;
END $$;

-- E. ALL-OR-NONE completion pairing: the terminal instant and the outcome are
--    present exactly together (both RPC completions set both; nothing sets one
--    without the other; a claimed/in-flight row has neither).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'chk_media_upload_val_complete_pairing'
       AND conrelid = 'public.media_upload_sessions'::regclass
  ) THEN
    ALTER TABLE public.media_upload_sessions
      ADD CONSTRAINT chk_media_upload_val_complete_pairing
      CHECK (
        (validation_completed_at IS NULL AND validation_outcome IS NULL)
        OR
        (validation_completed_at IS NOT NULL AND validation_outcome IS NOT NULL)
      );
  END IF;
END $$;

-- F. PASS core-evidence presence: a 'passed' outcome REQUIRES the three
--    class-independent evidence anchors (content SHA-256 + detected type +
--    detected container). Class-conditional geometry/codec shape is enforced in
--    RPC B against the DETECTED family (story cannot be resolved at the row level).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'chk_media_upload_val_pass_evidence'
       AND conrelid = 'public.media_upload_sessions'::regclass
  ) THEN
    ALTER TABLE public.media_upload_sessions
      ADD CONSTRAINT chk_media_upload_val_pass_evidence
      CHECK (
        validation_outcome IS DISTINCT FROM 'passed'
        OR (
          actual_sha256 IS NOT NULL
          AND detected_content_type IS NOT NULL
          AND detected_container IS NOT NULL
        )
      );
  END IF;
END $$;

-- ── 3) Bounded partial index for validation claim-candidate selection ───
-- Covers exactly the claim/reclaim scan (not-yet-completed, not-deleted, in a
-- claimable status), ordered by the claim/observation age. Not for any other query.
CREATE INDEX IF NOT EXISTS idx_media_upload_validation_claim
  ON public.media_upload_sessions (status, validation_claimed_at, quarantined_at, id)
  WHERE validation_completed_at IS NULL
    AND quarantine_deleted_at IS NULL
    AND status IN ('quarantined', 'validating');

-- ──────────────────────────────────────────────────────────────────────
-- claim_media_upload_validation — atomic bounded validation CLAIM/LEASE (batch 1).
--
-- CONTRACT
--   • NO caller parameters — batch (1), lease (15m), status set, and clock are ALL
--     DB-fixed. A caller can never weaken them.
--   • Eligibility (one txn, FOR UPDATE SKIP LOCKED, LIMIT 1):
--       quarantine_deleted_at IS NULL
--       AND validation_completed_at IS NULL
--       AND (
--             (status='quarantined' AND quarantined_at IS NOT NULL)             -- first claim
--          OR (status='validating'  AND validation_claimed_at IS NOT NULL       -- reclaim
--              AND validation_claimed_at <= clock_timestamp() - 15 min)
--       )
--     created/upload_authorized/uploading/file_safety/media_processing/ready/
--     rejected/expired are NEVER claimed. The reclaim staleness filter uses a live
--     clock evaluated as the row lock is taken.
--   • The row lock is acquired FIRST (FOR UPDATE SKIP LOCKED); the AUTHORITATIVE
--     instant (v_now := clock_timestamp()) is taken AFTER the lock and written as
--     validation_claimed_at; the generation is incremented by EXACTLY 1
--     (first claim 0->1, reclaim N->N+1); status is set/kept 'validating'.
--   • FOR UPDATE SKIP LOCKED ⇒ concurrent workers get DISJOINT claims and never
--     wait on each other; only one worker can hold a given generation of a row.
--
-- RETURNS  TABLE(session_id, media_class, quarantine_bucket, object_key,
--   observed_byte_size, observed_content_type, observed_storage_object_id,
--   observed_storage_etag, validation_claim_generation) — at most ONE row, or none.
--   Bounded job fields only; NO owner id, secret, token, or clock.
-- ──────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.claim_media_upload_validation()
RETURNS TABLE(
  session_id                  TEXT,
  media_class                 TEXT,
  quarantine_bucket           TEXT,
  object_key                  TEXT,
  observed_byte_size          BIGINT,
  observed_content_type       TEXT,
  observed_storage_object_id  TEXT,
  observed_storage_etag       TEXT,
  validation_claim_generation BIGINT
)
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  c_lease CONSTANT INTERVAL := INTERVAL '15 minutes'; -- DB-fixed validation lease
  v_now   TIMESTAMPTZ;
  v_row   RECORD;
  v_gen   BIGINT;
BEGIN
  -- ── 1) Pre-select + lock ONE candidate row (batch = 1). The pre-lock WHERE is
  --       ONLY a candidate PRE-SELECTOR (its clock_timestamp() is used to avoid
  --       scanning fresh validating rows for efficiency); the AUTHORITATIVE
  --       claim/reclaim eligibility decision is re-made AFTER the lock against
  --       v_now (R1-01). We fetch the eligibility fields under the row lock. ─────
  SELECT s.id, s.status, s.quarantined_at, s.validation_claimed_at,
         s.validation_completed_at, s.quarantine_deleted_at
    INTO v_row
    FROM public.media_upload_sessions s
   WHERE s.quarantine_deleted_at IS NULL
     AND s.validation_completed_at IS NULL
     AND (
           (s.status = 'quarantined' AND s.quarantined_at IS NOT NULL)
        OR (s.status = 'validating'
            AND s.validation_claimed_at IS NOT NULL
            AND s.validation_claimed_at <= pg_catalog.clock_timestamp() - c_lease)
     )
   ORDER BY COALESCE(s.validation_claimed_at, s.quarantined_at) ASC, s.id ASC
   LIMIT 1
   FOR UPDATE SKIP LOCKED;

  IF NOT FOUND THEN
    RETURN;  -- no candidate
  END IF;

  -- ── 2) Authoritative DB wall-clock instant, taken AFTER the row lock ────────
  v_now := pg_catalog.clock_timestamp();

  -- ── 3) AUTHORITATIVE post-lock eligibility RE-GATE (R1-01) ─────────────────
  -- Reclaim staleness is decided against the post-lock v_now, NEVER the pre-lock
  -- scan clock or a transaction-start time. A locked candidate that is neither
  -- first-claim-eligible NOR reclaim-eligible under v_now is NOT claimed and NOT
  -- mutated (no job returned). This makes v_now the single authoritative instant
  -- for both the eligibility decision and the claim stamp.
  IF NOT (
        (v_row.status = 'quarantined'
         AND v_row.quarantined_at IS NOT NULL
         AND v_row.validation_completed_at IS NULL
         AND v_row.quarantine_deleted_at IS NULL)
     OR (v_row.status = 'validating'
         AND v_row.validation_completed_at IS NULL
         AND v_row.validation_claimed_at IS NOT NULL
         AND v_row.validation_claimed_at <= v_now - c_lease
         AND v_row.quarantine_deleted_at IS NULL)
  ) THEN
    RETURN;  -- not authoritatively eligible under the post-lock clock
  END IF;

  -- ── 4) Stamp the claim: status -> 'validating', claimed_at = v_now,
  --       generation += 1 (exactly one). ────────────────────────────────────
  UPDATE public.media_upload_sessions m
     SET status                      = 'validating',
         validation_claimed_at       = v_now,
         validation_claim_generation = m.validation_claim_generation + 1,
         updated_at                  = v_now
   WHERE m.id = v_row.id
  RETURNING m.validation_claim_generation INTO v_gen;

  RETURN QUERY
    SELECT s.id, s.media_class, s.quarantine_bucket, s.object_key,
           s.observed_byte_size, s.observed_content_type,
           s.observed_storage_object_id, s.observed_storage_etag,
           v_gen
      FROM public.media_upload_sessions s
     WHERE s.id = v_row.id;
END;
$$;

COMMENT ON FUNCTION public.claim_media_upload_validation()
IS 'SEC-00B-P1I-1 — atomic bounded validation CLAIM/LEASE. No caller params; DB-fixed batch 1 / lease 15m. FOR UPDATE SKIP LOCKED (disjoint concurrent claims). The pre-lock WHERE only PRE-SELECTS a candidate; the AUTHORITATIVE claim/reclaim eligibility is re-decided AFTER the lock against v_now=clock_timestamp() (R1-01) — a candidate not first-claim/reclaim-eligible under the post-lock clock is not claimed. Claims a not-deleted, not-completed quarantined row (first claim) or a validating row whose lease is stale (claimed_at <= v_now - 15m) (reclaim); sets status=validating, validation_claimed_at=v_now, increments validation_claim_generation by exactly 1 and returns the new generation with the bounded job fields. SECURITY INVOKER; EXECUTE service_role only. Reads NO storage/bytes.';

-- ──────────────────────────────────────────────────────────────────────
-- complete_media_upload_validation_pass — fenced PASS completion.
--   validating -> file_safety.
--
-- CONTRACT
--   1. Structurally-impossible trusted-server input fails closed (RAISE) — mapped
--      by the store to a generic 503, NOT a public client error surface:
--        • blank session id; generation NULL or < 1;
--        • actual_sha256 not EXACTLY ^[0-9a-f]{64}$ (rejects uppercase / wrong
--          length / non-hex);
--        • detected_content_type / detected_container NULL or blank (required, non-blank
--          ONLY — NO maximum-length policy; canonical vocabulary is a P1I-2 concern, R1-03);
--        • a present numeric that is <= 0; a present codec that is blank (no length cap).
--   2. The target row is located + locked FOR UPDATE by id. Missing -> state_conflict.
--   3. FENCING (all required; else state_conflict, ZERO mutation): status='validating'
--      AND validation_claim_generation = p_validation_claim_generation
--      AND validation_completed_at IS NULL AND validation_claimed_at IS NOT NULL
--      AND the 15-minute lease is UNEXPIRED at the post-lock DB clock
--      AND quarantine_deleted_at IS NULL. A stale worker (expired lease / reclaimed /
--      generation advanced) can NEVER commit.
--   4. media_class-compatible evidence-SHAPE check (R1-02; NOT canonical detected-family
--      authority — that is a P1I-2 responsibility). The required SHAPE per media_class:
--        IMAGE (photo/avatar/circle_image): width>0 & height>0; duration/video/audio NULL.
--        VIDEO (reel): width>0 & height>0 & duration>0 & video_codec present;
--          audio_codec MAY be NULL (no allowed audio track).
--        AUDIO (audio): duration>0 & audio_codec present; width/height/video_codec NULL.
--        STORY: a valid IMAGE shape OR a valid VIDEO shape.
--      A PASS whose evidence SHAPE is inconsistent with media_class fails closed (RAISE),
--      ZERO mutation — the worker must instead call the rejection RPC for a bad file.
--   5. On success (CAS bound on the exact fenced state): status='file_safety',
--      validation_completed_at = v_now, validation_outcome='passed', the ten evidence
--      values, updated_at = v_now. -> {"outcome":"applied","status":"file_safety"}.
-- ──────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.complete_media_upload_validation_pass(
  p_session_id                 TEXT,
  p_validation_claim_generation BIGINT,
  p_actual_sha256              TEXT,
  p_detected_content_type      TEXT,
  p_detected_container         TEXT,
  p_media_width_px             INTEGER,
  p_media_height_px            INTEGER,
  p_media_duration_ms          BIGINT,
  p_detected_video_codec       TEXT,
  p_detected_audio_codec       TEXT
) RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  c_lease CONSTANT INTERVAL := INTERVAL '15 minutes';
  v_now      TIMESTAMPTZ;
  v_row      RECORD;
  v_shape    TEXT;   -- the REQUIRED evidence shape for the row's media_class (R1-02)
  v_is_image BOOLEAN;
  v_is_video BOOLEAN;
  v_is_audio BOOLEAN;
  v_count    INT;
BEGIN
  -- ── 1) Fail-closed structural input validation (BEFORE the lock) ────────────
  IF p_session_id IS NULL OR length(btrim(p_session_id)) = 0 THEN
    RAISE EXCEPTION 'complete_media_upload_validation_pass: session_id required';
  END IF;
  IF p_validation_claim_generation IS NULL OR p_validation_claim_generation < 1 THEN
    RAISE EXCEPTION 'complete_media_upload_validation_pass: invalid generation';
  END IF;
  IF p_actual_sha256 IS NULL OR p_actual_sha256 !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'complete_media_upload_validation_pass: invalid actual_sha256';
  END IF;
  -- detected_content_type / detected_container are PASS-required evidence anchors
  -- (constraint chk_media_upload_val_pass_evidence) — required + non-blank ONLY.
  -- NO maximum-length policy is imposed here: the P1I-1 locked contract defines these
  -- as TEXT NULL with a canonical vocabulary deferred to P1I-2 (R1-03).
  IF p_detected_content_type IS NULL
     OR length(btrim(p_detected_content_type)) = 0 THEN
    RAISE EXCEPTION 'complete_media_upload_validation_pass: detected_content_type required';
  END IF;
  IF p_detected_container IS NULL
     OR length(btrim(p_detected_container)) = 0 THEN
    RAISE EXCEPTION 'complete_media_upload_validation_pass: detected_container required';
  END IF;
  IF (p_media_width_px  IS NOT NULL AND p_media_width_px  <= 0)
     OR (p_media_height_px IS NOT NULL AND p_media_height_px <= 0)
     OR (p_media_duration_ms IS NOT NULL AND p_media_duration_ms <= 0) THEN
    RAISE EXCEPTION 'complete_media_upload_validation_pass: invalid media dimension/duration';
  END IF;
  -- A PRESENT codec must be non-blank (no maximum-length policy — R1-03).
  IF (p_detected_video_codec IS NOT NULL AND length(btrim(p_detected_video_codec)) = 0)
     OR (p_detected_audio_codec IS NOT NULL AND length(btrim(p_detected_audio_codec)) = 0) THEN
    RAISE EXCEPTION 'complete_media_upload_validation_pass: blank codec';
  END IF;

  -- ── 2) Locate + lock the row FIRST ──────────────────────────────────────────
  SELECT id, status, media_class,
         validation_claim_generation, validation_completed_at,
         validation_claimed_at, quarantine_deleted_at
    INTO v_row
    FROM public.media_upload_sessions
   WHERE id = p_session_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'state_conflict');
  END IF;

  -- ── 3) Authoritative post-lock instant ─────────────────────────────────────
  v_now := pg_catalog.clock_timestamp();

  -- ── 4) FENCING: exact generation + live lease + fenced state (else conflict) ─
  IF v_row.status <> 'validating'
     OR v_row.validation_completed_at IS NOT NULL
     OR v_row.validation_claimed_at IS NULL
     OR v_row.validation_claim_generation <> p_validation_claim_generation
     OR v_row.validation_claimed_at <= v_now - c_lease   -- lease already expired
     OR v_row.quarantine_deleted_at IS NOT NULL THEN
    RETURN jsonb_build_object('outcome', 'state_conflict');
  END IF;

  -- ── 5) media_class-compatible evidence-SHAPE check (R1-02) ──────────────────
  -- IMPORTANT SCOPE: P1I-1 does NOT prove the CANONICAL DETECTED MEDIA FAMILY.
  -- The canonical detected type/container vocabulary is a P1I-2 responsibility;
  -- detected_content_type/detected_container are stored here as OPAQUE strings.
  -- What this block enforces is only that the recorded geometry/duration/codec
  -- EVIDENCE SHAPE is CONSISTENT with the row's media_class. v_is_image/video/audio
  -- are evidence-SHAPE predicates, NOT canonical-family determinations.
  v_is_image := (p_media_width_px IS NOT NULL AND p_media_width_px > 0
                 AND p_media_height_px IS NOT NULL AND p_media_height_px > 0
                 AND p_media_duration_ms IS NULL
                 AND p_detected_video_codec IS NULL
                 AND p_detected_audio_codec IS NULL);
  v_is_video := (p_media_width_px IS NOT NULL AND p_media_width_px > 0
                 AND p_media_height_px IS NOT NULL AND p_media_height_px > 0
                 AND p_media_duration_ms IS NOT NULL AND p_media_duration_ms > 0
                 AND p_detected_video_codec IS NOT NULL);
  v_is_audio := (p_media_duration_ms IS NOT NULL AND p_media_duration_ms > 0
                 AND p_detected_audio_codec IS NOT NULL
                 AND p_media_width_px IS NULL
                 AND p_media_height_px IS NULL
                 AND p_detected_video_codec IS NULL);

  IF v_row.media_class IN ('photo', 'avatar', 'circle_image') THEN
    v_shape := 'IMAGE';                                   -- required evidence shape
    IF NOT v_is_image THEN
      RAISE EXCEPTION 'complete_media_upload_validation_pass: image evidence-shape mismatch';
    END IF;
  ELSIF v_row.media_class = 'reel' THEN
    v_shape := 'VIDEO';
    IF NOT v_is_video THEN
      RAISE EXCEPTION 'complete_media_upload_validation_pass: video evidence-shape mismatch';
    END IF;
  ELSIF v_row.media_class = 'audio' THEN
    v_shape := 'AUDIO';
    IF NOT v_is_audio THEN
      RAISE EXCEPTION 'complete_media_upload_validation_pass: audio evidence-shape mismatch';
    END IF;
  ELSIF v_row.media_class = 'story' THEN
    v_shape := 'IMAGE_OR_VIDEO';                          -- story accepts either shape
    IF NOT (v_is_image OR v_is_video) THEN
      RAISE EXCEPTION 'complete_media_upload_validation_pass: story evidence-shape mismatch';
    END IF;
  ELSE
    -- Structurally-impossible media_class for a SEC-00B row.
    RAISE EXCEPTION 'complete_media_upload_validation_pass: unknown media_class';
  END IF;

  -- ── 6) Fenced PASS: validating -> file_safety (CAS bound on the fenced state) ─
  UPDATE public.media_upload_sessions
     SET status                  = 'file_safety',
         validation_completed_at = v_now,
         validation_outcome      = 'passed',
         actual_sha256           = p_actual_sha256,
         detected_content_type   = p_detected_content_type,
         detected_container      = p_detected_container,
         media_width_px          = p_media_width_px,
         media_height_px         = p_media_height_px,
         media_duration_ms       = p_media_duration_ms,
         detected_video_codec    = p_detected_video_codec,
         detected_audio_codec    = p_detected_audio_codec,
         updated_at              = v_now
   WHERE id = v_row.id
     AND status = 'validating'
     AND validation_claim_generation = p_validation_claim_generation
     AND validation_completed_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count = 1 THEN
    RETURN jsonb_build_object('outcome', 'applied', 'status', 'file_safety');
  END IF;

  -- Defensive: row moved out from under the lock (should be impossible).
  RETURN jsonb_build_object('outcome', 'state_conflict');
END;
$$;

COMMENT ON FUNCTION public.complete_media_upload_validation_pass(TEXT, BIGINT, TEXT, TEXT, TEXT, INTEGER, INTEGER, BIGINT, TEXT, TEXT)
IS 'SEC-00B-P1I-1 — fenced validation PASS (validating -> file_safety). Fail-closed structural input (exact lowercase 64-hex sha256; required non-blank detected_content_type/detected_container with NO length cap; positive dimensions; non-blank present codecs); locks the row FOR UPDATE, takes a post-lock clock, requires exact validation_claim_generation + unexpired 15m lease + validating + not-completed + not-deleted (else state_conflict, zero mutation); enforces media_class-compatible evidence SHAPE (image/video/audio/story) — NOT canonical detected-family authority, which is a P1I-2 concern — a shape mismatch failing closed; then records the ten evidence values + validation_outcome=passed. SECURITY INVOKER; EXECUTE service_role only. Reads NO storage/bytes; proves NO canonical family / malware safety / processing / READY.';

-- ──────────────────────────────────────────────────────────────────────
-- complete_media_upload_validation_rejection — fenced deterministic REJECTION.
--   validating -> rejected.
--
-- CONTRACT
--   1. Fail-closed structural input (RAISE): blank session id; generation NULL/<1;
--      reason NOT IN the FIVE fixed validation tokens
--      { file_type_mismatch, unsupported_format, malformed_media,
--        media_limits_exceeded, unsafe_active_content }. malware_detected and any
--      arbitrary text are rejected here (malware is P1I-3, not P1I-1).
--   2. Row locked FOR UPDATE by id (missing -> state_conflict); post-lock clock.
--   3. Same FENCING as the PASS RPC (exact generation + unexpired lease + validating
--      + not-completed + not-deleted; else state_conflict, ZERO mutation). An
--      already-terminal row is never overwritten.
--   4. On success: status='rejected', validation_completed_at = v_now,
--      validation_outcome='rejected', rejected_reason = the fixed token,
--      updated_at = v_now. -> {"outcome":"applied","status":"rejected"}.
-- ──────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.complete_media_upload_validation_rejection(
  p_session_id                 TEXT,
  p_validation_claim_generation BIGINT,
  p_reason                     TEXT
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
  v_count INT;
BEGIN
  -- ── 1) Fail-closed structural input validation (BEFORE the lock) ────────────
  IF p_session_id IS NULL OR length(btrim(p_session_id)) = 0 THEN
    RAISE EXCEPTION 'complete_media_upload_validation_rejection: session_id required';
  END IF;
  IF p_validation_claim_generation IS NULL OR p_validation_claim_generation < 1 THEN
    RAISE EXCEPTION 'complete_media_upload_validation_rejection: invalid generation';
  END IF;
  IF p_reason IS NULL
     OR p_reason NOT IN (
          'file_type_mismatch',
          'unsupported_format',
          'malformed_media',
          'media_limits_exceeded',
          'unsafe_active_content'
        ) THEN
    -- Rejects arbitrary text AND malware_detected (P1I-3, not P1I-1).
    RAISE EXCEPTION 'complete_media_upload_validation_rejection: invalid reason';
  END IF;

  -- ── 2) Locate + lock the row FIRST ──────────────────────────────────────────
  SELECT id, status,
         validation_claim_generation, validation_completed_at,
         validation_claimed_at, quarantine_deleted_at
    INTO v_row
    FROM public.media_upload_sessions
   WHERE id = p_session_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'state_conflict');
  END IF;

  -- ── 3) Authoritative post-lock instant ─────────────────────────────────────
  v_now := pg_catalog.clock_timestamp();

  -- ── 4) FENCING (identical to PASS; else state_conflict, ZERO mutation) ──────
  IF v_row.status <> 'validating'
     OR v_row.validation_completed_at IS NOT NULL
     OR v_row.validation_claimed_at IS NULL
     OR v_row.validation_claim_generation <> p_validation_claim_generation
     OR v_row.validation_claimed_at <= v_now - c_lease
     OR v_row.quarantine_deleted_at IS NOT NULL THEN
    RETURN jsonb_build_object('outcome', 'state_conflict');
  END IF;

  -- ── 5) Fenced deterministic rejection: validating -> rejected ───────────────
  UPDATE public.media_upload_sessions
     SET status                  = 'rejected',
         validation_completed_at = v_now,
         validation_outcome      = 'rejected',
         rejected_reason         = p_reason,
         updated_at              = v_now
   WHERE id = v_row.id
     AND status = 'validating'
     AND validation_claim_generation = p_validation_claim_generation
     AND validation_completed_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count = 1 THEN
    RETURN jsonb_build_object('outcome', 'applied', 'status', 'rejected');
  END IF;

  RETURN jsonb_build_object('outcome', 'state_conflict');
END;
$$;

COMMENT ON FUNCTION public.complete_media_upload_validation_rejection(TEXT, BIGINT, TEXT)
IS 'SEC-00B-P1I-1 — fenced deterministic validation REJECTION (validating -> rejected). Fail-closed structural input (generation, and reason restricted to exactly file_type_mismatch/unsupported_format/malformed_media/media_limits_exceeded/unsafe_active_content — malware_detected and arbitrary text are refused); locks the row FOR UPDATE, post-lock clock, same fencing as the PASS RPC (exact generation + unexpired 15m lease + validating + not-completed + not-deleted, else state_conflict zero mutation); sets validation_outcome=rejected + the fixed token into rejected_reason. SECURITY INVOKER; EXECUTE service_role only. Reads NO storage/bytes.';

-- ── EXECUTE privilege lockdown: service_role ONLY (all three RPCs) ──────
REVOKE ALL ON FUNCTION public.claim_media_upload_validation() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_media_upload_validation() FROM anon;
REVOKE ALL ON FUNCTION public.claim_media_upload_validation() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_media_upload_validation() TO service_role;

REVOKE ALL ON FUNCTION public.complete_media_upload_validation_pass(TEXT, BIGINT, TEXT, TEXT, TEXT, INTEGER, INTEGER, BIGINT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_media_upload_validation_pass(TEXT, BIGINT, TEXT, TEXT, TEXT, INTEGER, INTEGER, BIGINT, TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.complete_media_upload_validation_pass(TEXT, BIGINT, TEXT, TEXT, TEXT, INTEGER, INTEGER, BIGINT, TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.complete_media_upload_validation_pass(TEXT, BIGINT, TEXT, TEXT, TEXT, INTEGER, INTEGER, BIGINT, TEXT, TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.complete_media_upload_validation_rejection(TEXT, BIGINT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_media_upload_validation_rejection(TEXT, BIGINT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.complete_media_upload_validation_rejection(TEXT, BIGINT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.complete_media_upload_validation_rejection(TEXT, BIGINT, TEXT) TO service_role;
