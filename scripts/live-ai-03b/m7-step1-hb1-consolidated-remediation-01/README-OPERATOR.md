# LIVE-AI-03B — M7 Step 1: operator README

This package is an offline candidate: nothing here is applied, deployed or run live.

It consolidates the HB-1 remediation:
- successor catalog V2 with three rows;
- cache-write accounting (proven with the unchanged gateway budget core);
- a 105,920 one-call policy;
- the Standard `service_tier: "default"` pin;
- the successor trusted activation and restoration functions.

The frozen M7 **T0** is `2026-09-28T15:26:23Z`. V2 verification **expires at** `2026-10-05T15:26:23Z` (T0 + 7 calendar days). After that instant every path fails closed, and a new successor with fresh verification is required. The V2 expiry is never extended.

## Contents

| Path | What it is |
|---|---|
| `catalog/v2-digest-gen.mjs` | The single deterministic source of every literal. It re-derives all 13 accepted predecessor digests before printing anything. |
| `catalog/v2-digests.json` | Generator output: canonical payloads and digests for source, catalog, policy and bundle. |
| `catalog/v2-catalog-contract.mjs` | V2 catalog and policy contract / preflight: rebuilds digests from the rows; rejects a missing or low cache-write rate, tampering, stale or future windows. |
| `build-sql.mjs` | Emits every `sql/*.sql` byte-exact. `--check` detects drift. |
| `sql/m7-v2-01-inactive-catalog-seed.sql` | Owner: V2 inactive seed (3 entries). V1 preserved byte-exact. Row count goes from exactly 6 to 10. |
| `sql/m7-v2-02-trusted-successor-migration.sql` | Owner superuser: the new schema `live_ai_03b_trusted_v2` with its 2 `SECURITY DEFINER` functions. Only the executor may run them. |
| `sql/m7-v2-03-catalog-activation.sql` | Executor invocation contract for `activate_catalog_v2`. |
| `sql/m7-v2-04-one-call-policy-activation.sql` | Owner: successor one-call policy with 105,920 on the 5 money ceilings and 1 on the 2 count ceilings. Derived from the accepted kit. |
| `sql/m7-v2-05-control-activation.sql` | Owner: control epoch 1→2. Derived from the accepted kit, plus a guard for exact ceilings, a single authority and V1 staying historical. |
| `sql/m7-v2-06-catalog-restoration.sql` | Executor invocation contract for `restore_catalog_v2_inactive`. |
| `sql/m7-v2-07-dormant-restoration.sql` | Owner: controls to epoch 3, then policy V2 and V2 back to inactive. Idempotent; never deletes anything. |
| `sql/m7-v2-08-post-apply-verification.sql` | Read-only verifier of the post-apply, pre-activation state. |
| `sql/m7-v2-09-successor-rollback.sql` | Owner: drops the successor schema only before activation. Refuses once any V2 approval has been consumed. |
| `approval/pricing-approval-contract-v2.mjs` + `approval-verify-v2.mjs` | V2 two-authority contract. Phase A requires the approval to be unused; Phase B requires it to be consumed. |
| `approval/SUPPLIED-EVIDENCE-RECEIPT-CANDIDATE.json` | Authority A: the candidate supplied receipt. Not authority. |
| `approval/INDEPENDENT-APPROVAL-ANCHOR-TEMPLATE.json` | Authority B template: unsigned and cannot verify. `INDEPENDENT_APPROVED_ANCHOR = REQUIRED BEFORE LIVE ACTIVATION`. |
| `approval/first-probe-request-contract.mjs` | The exact first-probe request body, which must include `service_tier: "default"`. |
| `diffs/service-tier-pin.diff` | The only source change: `server/voice-gateway/openai-responses.ts`, +7 lines. |
| `docs-evidence/` | Raw official OpenAI pages (sha256-pinned), the extractor, and extracted evidence. |
| `PRIVILEGE-MATRIX.json`, `ROLLBACK-FAIL-CLOSED-PLAN.md`, `REGRESSION-MAP.md`, `tests/` | Expected privileges, rollback plan, regression map and the test harness. |

## Exact later live order

Each step below is a **separate, explicitly Owner-authorized live boundary**. None of them is authorized by this packet.

0. **Independent WORK closure review** of this package. It re-verifies the official OpenAI pricing (Standard, short context: input 2.00, cache write 2.50, output 12.00) and the `service_tier` semantics.
1. **Preserve and commit** the reviewed artifacts. Merge the one-line gateway pin. The gateway deploy source must contain it, and the deploy gate must prove the first-probe request contract (regression R37/R38).
2. **Owner (AI-STAGING `b7362594…` only)**:
   - apply `01`, then `02`;
   - run `08` **and** the frozen M6 canonical post-verifier (both must pass).
   CORE-PROD `1fbd7632…` / `04c8b523…` is never a target.
3. **Independent reviewer**:
   - re-verifies the pricing facts;
   - fills in and signs `INDEPENDENT-APPROVAL-ANCHOR-TEMPLATE.json` offline with their Ed25519 key;
   - the verifier pins only that reviewer public key.
   No caller or operator can self-approve.
4. **Trusted executor**:
   - `verifyApprovalV2` (Phase A) passes, then `03` runs as `live_ai_03b_executor`;
   - Phase B, `verifyConsumedApprovalV2`, then correlates the committed ledger row.
   The executor credential is **not** provisioned by this packet. It is a later credential gate.
5. **Owner**: `04` (policy), then `05` (controls, with a fresh `control_updated_at`). The executor and reader runtime rebinding to V2 must be completed first. The accepted executor and reader stack is V1-bound, so today it fails closed against V2. That rebinding is the M7 Step-2 boundary.
6. After the probe, or on any abort: close ingress first (runbook), then `07` (or `06`). Evidence is never deleted.

## Hard rules carried forward

- **V1 stays historical.** Never extended, rewritten, reactivated or converted. Its trusted activation fails closed at the DB clock (`2026-09-25T18:37:35Z`).
- **No arbitrary authority.** No arbitrary catalog ID, digest or policy; every identity is a reviewed literal. Replay and duplicate activations fail closed through the M6 single-use ledger.
- **Timestamps.** Seeds contain no `now()`. Freshness at the mutation boundary uses the PostgreSQL wall clock (`clock_timestamp()`).
- **Nothing in this package provisions secrets or touches the provider or gateway.** No password, DSN, API key or provider call; no gateway configuration or deployment.
