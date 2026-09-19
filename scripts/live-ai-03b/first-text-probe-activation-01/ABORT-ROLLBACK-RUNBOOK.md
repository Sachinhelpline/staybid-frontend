# LIVE-AI-03B — FIRST-TEXT-PROBE — ABORT / ROLLBACK RUNBOOK

**Status:** UNAPPLIED / UNDEPLOYED / NON-ACTIVATING REVIEW ARTIFACT · **ARTIFACT_T0:** `2026-09-19T05:41:50Z`

This runbook is a reviewed procedure of record. It executes NOTHING. It governs the future,
owner-controlled first-text-probe against **AI-STAGING only** (Railway project
`4ad1abb3-823a-4acf-b889-6d34ae46d7f9`, gateway `dd96c7cd-02c1-4d02-89eb-7e217930ebfa`,
Postgres `b7362594-a01b-4623-a982-394707a6cec2`). **CORE-PROD**
(project `04c8b523-5b15-4d81-af06-8c2aa1a83499`, Postgres `1fbd7632-95ad-46f3-a20c-5be5b8e44e6b`)
is never touched and never a fallback.

## Hard rules (apply to every scenario)

1. **No provider-call retry.** A provider-bearing request is attempted at most once. A failure,
   timeout, or ambiguous outcome is NEVER retried.
2. **Close ingress FIRST** whenever a provider-bearing boundary has been (or may have been)
   crossed: turn `LIVE_AI_03B_STAGING_BROKER_ENABLED` OFF, then `LIVE_AI_03B_STAGING_TEXT_ENABLED`
   OFF, then remove `OPENAI_API_KEY`, before any reconciliation SQL.
3. **Ambiguous accounting ⇒ conservatively retain authority/spend accounting and disable further
   execution.** Never under-charge; never mint a second authority.
4. **Never delete evidence to "restore".** Restoration returns AUTHORITY to dormant; it never
   deletes sessions / decisions / envelopes / allocations / reservations / settlements /
   reconciliations / consumptions / counters. `dormant-restoration.sql` contains no DELETE/TRUNCATE.
5. **Identity mismatch ⇒ abort BEFORE mutation** where possible (source, Railway id, DB binding,
   CORE identity). CORE-PROD never becomes a fallback under any failure.
6. **Never print or persist a secret** (DSN, API key, HMAC secret, signing private key) in any log
   or evidence file.

## Order of the abort primitives

- **A. Close ingress** — broker gate OFF → text gate OFF → provider credential removed.
- **B. Prevent any second call** — the one-call policy + enabled control already cap authority; if
   already armed, run `dormant-restoration.sql` to disable controls (epoch 2→3) and make the
   one-call policy + catalog inactive.
- **C. Reconcile/settle in the gateway** — let the gateway's own reconciliation/reaper settle any
   open reservation; never hand-edit accounting.
- **D. Postflight** — run `first-probe-preflight-postflight.mjs --postflight` (with the injected
   observation context) to prove the closed, dormant, within-ceiling terminal state.

## Scenarios

| # | Scenario | Response |
|---|----------|----------|
| 1 | **gateway startup failure** | Abort before arming. No credential, no gate on. Fix deploy; nothing to reconcile (no provider boundary crossed). |
| 2 | **source-revision mismatch** | HOLD before any mutation. Deploy must be pinned to commit `2b69ce28…` / tree `87aad22d…`; no floating branch. Do not proceed. |
| 3 | **DB-binding mismatch** | HOLD before any mutation. Runtime DSN/reference must resolve to Postgres `b7362594…`. A structurally-compatible DB is insufficient. Never proceed against an unproven target. |
| 4 | **CORE identity ambiguity** | Immediate abort before mutation. If the resolved target could be the CORE project/Postgres, STOP. CORE is never a fallback. |
| 5 | **catalog expiry** | The trusted `activate_catalog(...)` function re-checks freshness against PostgreSQL's OWN wall clock (`clock_timestamp()`, Finding 3) immediately BEFORE the mutation — a transaction that began before expiry but reaches the UPDATE afterward still fails closed. If the DB clock is `>= 2026-09-25T18:37:35Z` (catalog), or outside the signed approval / evidence validity intervals carried in the verified claims, activation fails. Re-verify pricing and mint a fresh reviewed catalog / successor; NEVER extend expiry. |
| 6 | **official pricing mismatch** | If observed OpenAI rates differ from the reviewed rates (input 2,000,000 / output 12,000,000 micros per 1e6, source digest `fda6f4a8…`), HOLD. Do not activate; re-review pricing. |
| 7 | **Standard/non-regional proof missing, forged, or unbound (P1-02 trusted boundary)** | Both gates fail closed. AUTHENTICATION: preflight (`independentApprovalVerified` → `approval-verify.mjs`) requires a reviewer-signed Ed25519 `PricingEvidenceApprovalV1` envelope verified against an INDEPENDENTLY-PINNED reviewer public key (trust root a caller cannot substitute); the supplied evidence is bound to the reviewer-signed content digest + receipt id; fixed facts/targets/bundle, freshness, the execution nonce and single-use are enforced. A fabricated receipt + matching fabricated anchor no longer pass (the operator cannot forge the reviewer signature). ONE UNIFIED CLAIMS CONTRACT (Finding 1): only on successful verification does the verifier emit the flat `VerifiedApprovalClaimsV1` object; the executor hands THAT (never the raw envelope, never caller-selected fields) to `catalog-activation.sql` as `verified_claims_json`, and `live_ai_03b_trusted.activate_catalog(claims_json, execution_id)` reads exactly those flat keys — so an authentic approval traverses verifier → executor → DB unchanged, and a shape mismatch fails closed. TWO-PHASE ORDER (Finding 2): the executor runs the concrete PHASE-A `runPreActivation(...)` verifier over authoritative DORMANT observations (via an approved read-only capability whose provenance must be trusted — no caller `{pass:true}` verdict is ever accepted) BEFORE it invokes activation, and emits only a `CATALOG_ACTIVATION_COMPLETE` receipt (never `PROBE_READY`); the armed-state PHASE-B `runPreflight(...)` is a separate post-activation/pre-probe gate. PHASE-B CONSUMED-APPROVAL LIFECYCLE (P1-02 correction): Phase B no longer re-runs the Phase-A UNUSED-approval check (which wrongly rejected an authentic successful activation as replay). It runs `verifyConsumedApproval(...)` — the SAME authentication (signature/trust-root/target/freshness/execution, unchanged) PLUS a correlation to EXACTLY ONE legitimately CONSUMED activation record observed POST-COMMIT in the authoritative AI-STAGING `approval_consumption` ledger through a trusted read-only capability, PLUS a matching deterministic `CatalogActivationReceiptV1`. An `isConsumed=false` result, a caller-supplied count, a fabricated ledger object, or a fabricated receipt can never fabricate Phase-B success, and a SECOND activation stays forbidden (executor one-shot + the DB ledger unique key). `activate_catalog(...)` now RETURNS that deterministic receipt (jsonb) built from the consumed ledger row — a RETURN value only, NOT commit proof and NOT new mutation authority; the committed ledger observation remains authoritative. EXECUTION/PRIVILEGE: `catalog-activation.sql` no longer performs a raw operator-authorized UPDATE — it only invokes the restricted, single-use `SECURITY DEFINER` `live_ai_03b_trusted.activate_catalog(...)` and fails closed unless run as `live_ai_03b_executor`; that function is EXECUTE-granted to the executor role only (PUBLIC revoked), consumes the approval atomically (replay rejected by the ledger), independently re-checks catalog/approval/evidence freshness on the DB wall clock (Finding 3, see #5) immediately before the mutation, and the executor holds no direct BUDGET-table DML. A standalone probe/gateway operator can neither EXECUTE the function nor UPDATE the catalog directly. **Residual live gate:** existing `postgres` superuser / `pg_write_all_data` are not restricted by the migration; activation REMAINS BLOCKED until the future live gates (real trust root, genuine signed approval, applied migration, restricted executor credential withheld from probe/gateway, proven no privileged-credential leakage) are established. |
| 8 | **policy mismatch** | If the dormant policy is not exactly `live-ai-03b-policy-v1-dormant` / digest `cf5ae64f…`, or an unexpected active policy exists, HOLD. Do not insert the one-call policy. |
| 9 | **control mismatch / staleness** | If controls are not exactly epoch-1 dormant (digests `26136eb9…` / `be70f6b4…`), or `control_updated_at` is not fresh (≤ 15000 ms) strict RFC3339 UTC, `control-activation.sql` fails closed. Do not enable controls. |
| 10 | **operator-subject mismatch** | If the derived `stg1.<64hex>` subject does not equal the single configured `LIVE_AI_03B_STAGING_OPERATOR_SUBJECT` (HMAC-SHA256 over DOMAIN + NUL + verified admin id), deny (403). Do not send the probe. |
| 11 | **signing-key mismatch** | If the gateway public-key fingerprint ≠ the broker public-key fingerprint (derived from the private key out-of-band; only fingerprints compared), HOLD. Never log key material. |
| 12 | **reservation failure** | The probe is not admitted; no provider call. Nothing to reconcile beyond a REFUSED decision. Close ingress and postflight. |
| 13 | **reservation persistence failure** | Treat as crash-ambiguous: close ingress FIRST, let the gateway reaper/reconciler forfeit conservatively; never re-issue. |
| 14 | **provider failure** | No retry. Record failure evidence; close ingress; let the gateway settle any open reservation (charge conservatively); postflight. |
| 15 | **provider timeout** | No retry (the accepted adapter uses zero HTTP retries; ≤ 20,000 ms deadline). Treat as provider failure #14. |
| 16 | **missing / malformed usage** | Retain the conservative reservation (do NOT under-charge); the gateway keeps the reserved amount as charged. Close and postflight. |
| 17 | **usage > reserved bound** | Record the over-cap / excess incident (budget over-cap columns); never mint additional spend authority. Close and postflight. |
| 18 | **settlement failure** | Leave the reservation for the gateway's idempotent settlement/reaper; never hand-edit. Close ingress; postflight; if unresolved, HOLD with authority retained. |
| 19 | **reconciliation failure** | Conservatively retain authority/spend accounting; disable further execution (`dormant-restoration.sql` epoch 2→3). Never delete evidence. HOLD for review. |
| 20 | **unexpected second-call attempt** | The one-call policy (`session_provider_calls=1`, `session_execution_admissions=1`) + enabled control cap authority; the probe script's single-shot guard refuses a second turn. If detected, treat as an incident: close ingress, HOLD, retain accounting. |
| 21 | **postflight mismatch** | If `--postflight` does not prove ≤1 reservation / ≤1 call / exact settlement / terminal reconciliation / spend ≤ 89536 micros / no second authority / durable evidence retained / ingress closed / credential removed / controls dormant / policy non-authorizing / catalog inactive / CORE unchanged, HOLD. Do not re-open. Investigate with authority retained. |

## Restoration invariant

Restoration (`dormant-restoration.sql`) is fail-closed + idempotency-aware: it performs the
epoch 2→3 control disable, one-call policy → inactive, and catalog → inactive ONLY from the exact
active predecessor; it safely reports an already-restored state without a destructive rewrite; and
any mixed/ambiguous state RAISES (HOLD). Durable accounting is always retained.
