-- ═════════════════════════════════════════════════════════════════════════
-- LIVE-AI-03B — FIRST-TEXT-PROBE — PRICE-CATALOG ACTIVATION  (UNAPPLIED / OFFLINE)
--
-- ⚠ UNAPPLIED. NOT executed against any database by this packet.
--
-- P1-02 TRUSTED-BOUNDARY REWRITE — the previous standalone, operator-authorized activation
-- path is REMOVED. Catalog activation is NO LONGER authorized by caller-selected receipt/
-- approved id+digest equality (two matching caller values are NOT independent approval). The
-- ONLY authorized activation path is now the restricted, single-use, SECURITY DEFINER trusted
-- function invoked by the dedicated restricted executor role:
--
--     scripts/live-ai-03b/trusted-activation-boundary-01/db/2026-09-19-p1-02-trusted-activation-boundary.sql
--       live_ai_03b_trusted.activate_catalog(claims_json jsonb, execution_id text)
--
-- Finding 1 (ONE contract): the executor passes the normalized VerifiedApprovalClaimsV1 object
-- produced by approval-verify.mjs AFTER successful signature verification — NOT the raw envelope,
-- and NOT caller-selected fields. The DB function reads that exact flat shape.
--
-- Trust split (see TRUSTED-BOUNDARY-README.md):
--   * AUTHENTICATION — the independently-signed Ed25519 PricingEvidenceApprovalV1 envelope is
--     verified OUT-OF-DB by the trusted executor (approval-verify.mjs) against an independently
--     pinned reviewer public key BEFORE this script runs; the executor then emits the verified
--     claims. Core PostgreSQL cannot verify Ed25519, so it also independently enforces
--     DB-clock catalog/approval/evidence freshness (Finding 3) at the mutation boundary.
--   * EXECUTION/PRIVILEGE — the trusted function is EXECUTE-granted ONLY to
--     live_ai_03b_executor (PUBLIC revoked); the executor holds NO direct BUDGET-table DML and
--     NO superuser; single-use + exact predecessor/postcondition are enforced atomically inside
--     the function via the approval-consumption ledger. A standalone probe/gateway operator can
--     neither EXECUTE the function nor UPDATE the catalog directly.
--
-- This file is therefore ONLY the reviewed invocation contract; it performs NO raw catalog
-- UPDATE and confers NO standalone operator authorization. Run by the trusted executor role
-- with the VERIFIED claims + the bound execution id.
--
-- P1-02 Phase-B lifecycle (consumed-approval correction): activate_catalog now RETURNS a
-- deterministic CatalogActivationReceiptV1 (jsonb) built from the ledger row it just consumed +
-- the reviewed transition. This return value is NOT a commit proof. The SEPARATE downstream
-- PHASE-B pre-probe verification independently observes the COMMITTED approval_consumption
-- ledger row (post-commit, via a trusted read-only capability) and correlates it to that
-- receipt. Catalog activation alone is NOT probe-ready.
--
-- REQUIRED execution-time parameters (fail closed if ABSENT):
--   -v verified_claims_json='<VerifiedApprovalClaimsV1 emitted by approval-verify.mjs after signature verification>'
--   -v execution_id='<the one execution nonce bound in that approval>'
-- Both come from the trusted executor after signature verification — NEVER caller-selected
-- id/digest pairs and NEVER the raw unverified envelope. A fabricated approval fails: (a) executor
-- Ed25519 verification, (b) the in-function contract/digest/consumption/predecessor checks + the
-- DB-clock freshness guards; and only the executor role may run it.
--
-- ⚠ RESIDUAL LIVE GATE: this offline artifact does NOT prove the runtime privilege isolation.
-- Activation remains BLOCKED until the future live gates in trusted-executor-deployment-spec.json
-- are established (real trust root, genuine signed approval, applied migration, restricted
-- executor credential withheld from probe/gateway, proven no privileged-credential leakage).
-- ═════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on

\if :{?verified_claims_json}
\else
\echo 'FATAL: verified_claims_json not supplied — the executor-emitted VerifiedApprovalClaimsV1 is REQUIRED (fail closed).'
\quit
\endif
\if :{?execution_id}
\else
\echo 'FATAL: execution_id not supplied — the approval-bound execution nonce is REQUIRED (fail closed).'
\quit
\endif

BEGIN;

-- Privilege guard: ONLY the restricted trusted executor role may run this invocation. A
-- standalone operator / gateway / probe role (or any other role) fails closed here, and the
-- trusted function's EXECUTE grant is executor-only regardless.
DO $$
BEGIN
  IF current_user <> 'live_ai_03b_executor' THEN
    RAISE EXCEPTION 'catalog-activation: not the restricted trusted executor role (current_user=%); standalone activation is not authorized', current_user;
  END IF;
END $$;

-- The reviewed activation transition + single-use consumption + exact pre/postconditions are
-- performed atomically INSIDE the SECURITY DEFINER trusted function (owned by the NOLOGIN
-- function owner). This file adds NO raw catalog UPDATE path.
SELECT live_ai_03b_trusted.activate_catalog(:'verified_claims_json'::jsonb, :'execution_id');

COMMIT;
