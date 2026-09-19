-- ═════════════════════════════════════════════════════════════════════════
-- LIVE-AI-03B — P1-02 TRUSTED ACTIVATION BOUNDARY — PostgreSQL 18 privilege boundary
-- ⚠ UNAPPLIED. NOT executed against any database by this packet. Owner-applied only,
--   from a securely authenticated superuser session against AI-STAGING Postgres
--   b7362594-a01b-4623-a982-394707a6cec2 ONLY. NEVER CORE-PROD 1fbd7632-....
--
-- PURPOSE (P1-02 execution/privilege half): make catalog activation reachable ONLY
-- through a restricted, single-use, SECURITY DEFINER trusted function invoked by a
-- dedicated restricted executor role — so a standalone probe/gateway operator cannot
-- authorize activation by direct catalog UPDATE, and a replayed/duplicate approval is
-- rejected atomically. The Ed25519 approval SIGNATURE is verified OUT-OF-DB by the
-- trusted executor BEFORE calling these functions (core PostgreSQL cannot verify
-- Ed25519); this migration enforces the PRIVILEGE + SINGLE-USE + PRECONDITION half.
--
-- ⚠ RESIDUAL / FUTURE LIVE GATE (must be proven separately — NOT done here):
--   The existing BUDGET tables are owned by `postgres`, which retains superuser +
--   pg_write_all_data. Creating these roles does NOT restrict postgres. Complete P1-02
--   isolation REQUIRES a future proof that the probe/gateway/runtime principal cannot
--   read the executor credential or impersonate postgres/pg_write_all_data. This file
--   does NOT (and cannot from here) restrict postgres, and does NOT revoke existing
--   BUDGET grants blindly (that could break the legitimate budget store accounting
--   writes). If restricting the runtime/store principals needs a separate migration or
--   a compatibility decision, that is an explicit future execution gate.
--
-- Idempotent-safe object creation; run inside a single transaction by the Owner.
-- ═════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on
BEGIN;

-- ── roles ────────────────────────────────────────────────────────────────
-- NOLOGIN owner of the trusted schema/functions/ledger; SECURITY DEFINER runs as this
-- role. Never loginable; reachable only through the granted functions.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'live_ai_03b_fn_owner') THEN
    CREATE ROLE live_ai_03b_fn_owner NOLOGIN;
  END IF;
  -- restricted executor: LOGIN, NOT superuser, NOT pg_write_all_data; may only EXECUTE
  -- the granted trusted functions. Its password/credential is provisioned out-of-band
  -- and MUST be withheld from the probe/gateway principals (future gate).
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'live_ai_03b_executor') THEN
    CREATE ROLE live_ai_03b_executor LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END $$;

-- ── trusted schema (owned by the NOLOGIN owner) ────────────────────────────
CREATE SCHEMA IF NOT EXISTS live_ai_03b_trusted AUTHORIZATION live_ai_03b_fn_owner;
REVOKE ALL ON SCHEMA live_ai_03b_trusted FROM PUBLIC;
GRANT USAGE ON SCHEMA live_ai_03b_trusted TO live_ai_03b_executor;

-- ── single-use approval-consumption ledger (durable; replay rejection) ─────
CREATE TABLE IF NOT EXISTS live_ai_03b_trusted.approval_consumption (
  approval_id        text PRIMARY KEY,                 -- single-use per approval
  execution_id       text NOT NULL,
  content_digest     text NOT NULL,
  active_catalog_digest text NOT NULL,
  action             text NOT NULL CHECK (action IN ('activate','restore')),
  consumed_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uniq_approval_execution UNIQUE (approval_id, execution_id)
);
ALTER TABLE live_ai_03b_trusted.approval_consumption OWNER TO live_ai_03b_fn_owner;
REVOKE ALL ON live_ai_03b_trusted.approval_consumption FROM PUBLIC;
-- executor gets NO direct DML on the ledger; it is written only inside the definer functions.

-- ── the function owner needs narrow privileges on ONLY the BUDGET tables it transitions.
--    (Owner runs this migration as superuser; these GRANTs let the NOLOGIN definer owner
--     perform the reviewed transitions. No grant is given to the executor or to PUBLIC.) ──
GRANT SELECT, UPDATE ON
  public.budget_price_catalog_versions,
  public.budget_price_catalog_entries,
  public.budget_control_epochs,
  public.budget_policy_versions
  TO live_ai_03b_fn_owner;

-- ═══════════════════ trusted ACTIVATE function (SECURITY DEFINER) ══════════
-- Single-use, atomic: consumes the approval (ledger insert ⇒ replay-safe), re-checks the
-- exact reviewed predecessor + digests, transitions ONLY the reviewed catalog version +
-- 2 entries inactive→active, postverifies. search_path is empty + every object is fully
-- schema-qualified (SECURITY DEFINER hardening). The Ed25519 signature is already verified
-- by the trusted executor; approval_json carries the reviewer-bound facts for defense-in-depth.
-- Finding 1 — the function reads the ONE flat VerifiedApprovalClaimsV1 shape produced by the
--   verifier (approval_id/execution_id/*_digest/timestamps as TOP-LEVEL keys), so an authentic
--   approval traverses verifier → executor → this function unchanged.
-- Finding 3 — the function independently enforces catalog/approval/evidence freshness using
--   PostgreSQL's OWN clock (clock_timestamp(), real wall time), rechecked immediately before the
--   mutation so a transaction that began before expiry but reaches the UPDATE afterward fails.
-- Phase-B lifecycle (P1-02 consumed-approval correction) — the function RETURNS a deterministic
--   CatalogActivationReceiptV1 (jsonb) built from the ledger row it just consumed + the exact
--   reviewed transition (approval_id/execution_id/content_digest/active_catalog_digest/action/
--   consumed_at). This is a RETURN VALUE only — it grants NO new mutation authority. It is NOT a
--   commit proof: Phase B independently observes the COMMITTED approval_consumption ledger row
--   (post-commit, via a trusted read-only capability) and correlates this receipt to it. The
--   single-use ledger + unique key still make a second activation impossible.
DROP FUNCTION IF EXISTS live_ai_03b_trusted.activate_catalog(jsonb, text);
CREATE OR REPLACE FUNCTION live_ai_03b_trusted.activate_catalog(claims_json jsonb, p_execution_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_contract text := claims_json #>> '{contract}';
  v_approval_id text := claims_json #>> '{approval_id}';
  v_content_digest text := claims_json #>> '{content_digest}';
  v_active text := claims_json #>> '{active_catalog_digest}';
  v_inactive text := claims_json #>> '{inactive_catalog_digest}';
  v_exec text := claims_json #>> '{execution_id}';
  v_appr_nbf text := claims_json #>> '{approval_not_before}';
  v_appr_exp text := claims_json #>> '{approval_expiry}';
  v_ev_verified text := claims_json #>> '{evidence_verified_at}';
  v_ev_exp text := claims_json #>> '{evidence_expiry}';
  v_cat_exp text := claims_json #>> '{catalog_verification_expiry}';
  v_now timestamptz;
  v_consumed_at timestamptz;
  n bigint;
BEGIN
  IF v_contract IS DISTINCT FROM 'VerifiedApprovalClaimsV1' THEN RAISE EXCEPTION 'activate: claims contract mismatch (expected VerifiedApprovalClaimsV1)'; END IF;
  IF v_approval_id IS NULL OR v_approval_id = '' THEN RAISE EXCEPTION 'activate: approval_id missing'; END IF;
  IF p_execution_id IS NULL OR p_execution_id = '' OR v_exec IS DISTINCT FROM p_execution_id THEN
    RAISE EXCEPTION 'activate: execution_id missing or not bound to verified claims';
  END IF;
  -- claims must carry the exact reviewed digests (defense-in-depth; executor verified the signature).
  IF v_active IS DISTINCT FROM '616cc481e8cc342462445da5ededa142ec4450f38805edd91ed798554f3c24f8' THEN RAISE EXCEPTION 'activate: active_catalog_digest mismatch'; END IF;
  IF v_inactive IS DISTINCT FROM '453f928762b8e6cddedac8618786d008cb7a3d57ffefab9d0cfe3cda52c4c973' THEN RAISE EXCEPTION 'activate: inactive_catalog_digest mismatch'; END IF;
  -- the claimed catalog verification expiry must equal the exact reviewed contract literal.
  IF v_cat_exp IS DISTINCT FROM '2026-09-25T18:37:35Z' THEN RAISE EXCEPTION 'activate: claims catalog_verification_expiry does not match reviewed contract'; END IF;
  IF v_appr_nbf IS NULL OR v_appr_exp IS NULL OR v_ev_verified IS NULL OR v_ev_exp IS NULL THEN
    RAISE EXCEPTION 'activate: missing approval/evidence validity timestamps';
  END IF;

  -- SINGLE-USE: consume first; a duplicate approval_id (or (approval_id,execution_id)) fails closed.
  BEGIN
    INSERT INTO live_ai_03b_trusted.approval_consumption(approval_id, execution_id, content_digest, active_catalog_digest, action)
    VALUES (v_approval_id, p_execution_id, COALESCE(v_content_digest,''), v_active, 'activate')
    RETURNING consumed_at INTO v_consumed_at;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'activate: approval already consumed (replay rejected)';
  END;

  -- lock the reviewed catalog rows for an atomic transition.
  PERFORM 1 FROM public.budget_price_catalog_versions
    WHERE id = 'openai-gpt-5-6-terra-standard-short-v1' FOR UPDATE;

  -- exact inactive predecessor.
  SELECT count(*) INTO n FROM public.budget_price_catalog_versions WHERE status='active';
  IF n <> 0 THEN RAISE EXCEPTION 'activate: an active catalog version already exists'; END IF;
  PERFORM 1 FROM public.budget_price_catalog_versions
    WHERE id='openai-gpt-5-6-terra-standard-short-v1' AND status='inactive'
      AND catalog_digest='453f928762b8e6cddedac8618786d008cb7a3d57ffefab9d0cfe3cda52c4c973';
  IF NOT FOUND THEN RAISE EXCEPTION 'activate: reviewed inactive catalog predecessor not matched'; END IF;

  -- Finding 3 — DB-CLOCK FRESHNESS rechecked at the mutation boundary (real wall clock, NOT a
  -- caller-supplied timestamp, NOT now()/transaction-start, NOT ARTIFACT_T0). A malformed
  -- timestamp raises on cast (fail closed). Catalog expiry uses the exact reviewed literal.
  v_now := clock_timestamp();
  IF NOT (v_now < TIMESTAMPTZ '2026-09-25T18:37:35Z') THEN
    RAISE EXCEPTION 'activate: catalog verification expired at DB clock (%) — HOLD for reviewed fresh pricing / successor catalog', v_now;
  END IF;
  IF NOT (v_now >= v_appr_nbf::timestamptz AND v_now < v_appr_exp::timestamptz) THEN
    RAISE EXCEPTION 'activate: DB clock outside signed approval validity interval';
  END IF;
  IF NOT (v_now >= v_ev_verified::timestamptz AND v_now < v_ev_exp::timestamptz) THEN
    RAISE EXCEPTION 'activate: DB clock outside signed evidence validity interval';
  END IF;

  -- transition version + 2 entries inactive → active (reviewed digests only).
  UPDATE public.budget_price_catalog_versions
     SET status='active', catalog_digest='616cc481e8cc342462445da5ededa142ec4450f38805edd91ed798554f3c24f8'
   WHERE id='openai-gpt-5-6-terra-standard-short-v1' AND status='inactive'
     AND catalog_digest='453f928762b8e6cddedac8618786d008cb7a3d57ffefab9d0cfe3cda52c4c973';
  UPDATE public.budget_price_catalog_entries
     SET status='active'
   WHERE catalog_version_id='openai-gpt-5-6-terra-standard-short-v1' AND status='inactive'
     AND id IN ('openai-gpt-5-6-terra-standard-short-v1-reasoning-input-token-base',
                'openai-gpt-5-6-terra-standard-short-v1-reasoning-output-token-base');

  -- postcondition.
  SELECT count(*) INTO n FROM public.budget_price_catalog_versions WHERE status='active'
    AND catalog_digest='616cc481e8cc342462445da5ededa142ec4450f38805edd91ed798554f3c24f8';
  IF n <> 1 THEN RAISE EXCEPTION 'activate: postcondition active version not exactly 1'; END IF;
  SELECT count(*) INTO n FROM public.budget_price_catalog_entries WHERE status='active';
  IF n <> 2 THEN RAISE EXCEPTION 'activate: postcondition active entries not exactly 2'; END IF;

  -- deterministic CatalogActivationReceiptV1 built from the consumed ledger row + the exact
  -- reviewed transition (RETURN value only; no new authority). The JS executor attaches the
  -- deterministic commitment; Phase B correlates this to the POST-COMMIT ledger observation.
  RETURN jsonb_build_object(
    'contract', 'CatalogActivationReceiptV1',
    'approval_id', v_approval_id,
    'execution_id', p_execution_id,
    'content_digest', COALESCE(v_content_digest, ''),
    'active_catalog_digest', v_active,
    'action', 'activate',
    'consumed_at', to_char(v_consumed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  );
END;
$fn$;
ALTER FUNCTION live_ai_03b_trusted.activate_catalog(jsonb, text) OWNER TO live_ai_03b_fn_owner;
REVOKE ALL ON FUNCTION live_ai_03b_trusted.activate_catalog(jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION live_ai_03b_trusted.activate_catalog(jsonb, text) TO live_ai_03b_executor;

-- ═══════════════ trusted RESTORE function (SECURITY DEFINER) ═══════════════
-- The reviewed normal one-shot close: catalog active→inactive. (Control/policy epoch
-- transitions remain in the accepted activation-kit SQL under the same restricted invocation
-- contract; emergency Owner-controlled restoration stays SEPARATE and is NOT granted to the
-- executor.) Single-use per approval; non-destructive (no accounting rows deleted).
CREATE OR REPLACE FUNCTION live_ai_03b_trusted.restore_catalog_inactive(claims_json jsonb, p_execution_id text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_contract text := claims_json #>> '{contract}';
  v_approval_id text := claims_json #>> '{approval_id}';
  v_exec text := claims_json #>> '{execution_id}';
  n bigint;
BEGIN
  IF v_contract IS DISTINCT FROM 'VerifiedApprovalClaimsV1' THEN RAISE EXCEPTION 'restore: claims contract mismatch'; END IF;
  IF v_approval_id IS NULL OR v_approval_id = '' THEN RAISE EXCEPTION 'restore: approval_id missing'; END IF;
  IF p_execution_id IS NULL OR v_exec IS DISTINCT FROM p_execution_id THEN RAISE EXCEPTION 'restore: execution_id not bound'; END IF;
  BEGIN
    INSERT INTO live_ai_03b_trusted.approval_consumption(approval_id, execution_id, content_digest, active_catalog_digest, action)
    VALUES (v_approval_id || ':restore', p_execution_id, '', '453f928762b8e6cddedac8618786d008cb7a3d57ffefab9d0cfe3cda52c4c973', 'restore');
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'restore: already consumed (replay rejected)';
  END;
  PERFORM 1 FROM public.budget_price_catalog_versions WHERE id='openai-gpt-5-6-terra-standard-short-v1' FOR UPDATE;
  UPDATE public.budget_price_catalog_versions
     SET status='inactive', catalog_digest='453f928762b8e6cddedac8618786d008cb7a3d57ffefab9d0cfe3cda52c4c973'
   WHERE id='openai-gpt-5-6-terra-standard-short-v1' AND status='active'
     AND catalog_digest='616cc481e8cc342462445da5ededa142ec4450f38805edd91ed798554f3c24f8';
  UPDATE public.budget_price_catalog_entries SET status='inactive'
   WHERE catalog_version_id='openai-gpt-5-6-terra-standard-short-v1' AND status='active';
  SELECT count(*) INTO n FROM public.budget_price_catalog_versions WHERE status='active';
  IF n <> 0 THEN RAISE EXCEPTION 'restore: postcondition still has an active version'; END IF;
  RETURN 'restored:' || v_approval_id;
END;
$fn$;
ALTER FUNCTION live_ai_03b_trusted.restore_catalog_inactive(jsonb, text) OWNER TO live_ai_03b_fn_owner;
REVOKE ALL ON FUNCTION live_ai_03b_trusted.restore_catalog_inactive(jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION live_ai_03b_trusted.restore_catalog_inactive(jsonb, text) TO live_ai_03b_executor;

-- executor gets NO direct DML anywhere on BUDGET tables and NO ledger DML.
-- (Deliberately no GRANT ... ON public.budget_* TO live_ai_03b_executor.)

COMMIT;

-- ── FUTURE LIVE GATES (documented; NOT applied here) ───────────────────────
--  * set + securely store the restricted executor login credential; withhold from probe/gateway.
--  * prove the probe/gateway/runtime principals are NOT superuser and lack pg_write_all_data,
--    and cannot read the executor credential or impersonate postgres/fn_owner.
--  * decide + apply any budget-store runtime role compatibility so legitimate accounting writes
--    keep working while direct catalog-activation authority is removed from those principals.
--  * verify the runtime DB reference resolves to AI-STAGING Postgres b7362594-... (identity).
