# LIVE-AI-03B — P1-02 Trusted Activation Boundary (OFFLINE implementation)

**Status:** UNAPPLIED / UNDEPLOYED / NON-ACTIVATING review artifacts · **ARTIFACT_T0:** `2026-09-19T05:41:50Z`
**Packet:** LIVE-AI-03B-P1-02-TRUSTED-ACTIVATION-BOUNDARY-CONSOLIDATED-OFFLINE-IMPLEMENTATION-01

## The defect being closed (P1-02)
The prior kit accepted a caller-supplied `approvedEvidenceAnchor` (verifier) and caller-supplied
`std_evidence_approved_id/_digest` (SQL). Two matching caller-controlled values prove *equality*,
not *independent approval* — an operator could fabricate a receipt and a matching "approval" and
authorize activation. Closing P1-02 requires BOTH:

- **A. Authentic independent approval** of the exact reviewed evidence (the operator cannot forge it).
- **B. A restricted execution/DB-privilege boundary** so the operator cannot bypass approval via a
  direct catalog `UPDATE`.

A signature check alone fails B (an admin DB credential could UPDATE directly). A restricted DB role
alone fails A (the operator could supply its own alleged approval). Both halves are implemented here.

## The two halves

### A — Authentication (implemented + offline-proven)
- `pricing-approval-contract.mjs` — the deterministic **PricingEvidenceApprovalV1** envelope: a
  reviewer-signed (Ed25519) canonical payload binding approval id, reviewer public-key fingerprint,
  exact evidence receipt id + content digest, evidence verified-at/expiry, non-secret OpenAI
  account/project scope, provider `openai`, model `gpt-5.6-terra`, direct account mode, Standard
  processing, no regional uplift, accepted input/output prices + unit + USD, excluded alternate
  paths, catalog version + source, AI-STAGING target ids, explicit CORE-PROD exclusions, source
  commit/tree, activation-bundle digest, reviewed inactive/active catalog digests, one execution
  nonce, issued/not-before/expiry, `max_uses=1`, purpose + signature domain.
- `approval-verify.mjs` — verifies the Ed25519 signature against an **independently-pinned reviewer
  public key (trust root)** — never a key carried in the envelope; a caller cannot substitute the
  trust root. It recomputes the evidence content digest and binds the supplied receipt to the
  reviewer-signed digest, validates all fixed facts/targets/bundle, freshness, execution binding, and
  single-use. Matching two caller values is rejected; only a valid reviewer signature passes.

The reviewer **private** key lives OUTSIDE repo / Railway / gateway / probe / executor. No production
key or genuine approval exists in this packet; **synthetic TEST keys are used only for offline
positive/negative tests and are deleted** — never embedded as an accepted production trust root.

### B — Execution / privilege boundary (implemented as UNAPPLIED artifacts; live proof is a future gate)
- `db/2026-09-19-p1-02-trusted-activation-boundary.sql` (PostgreSQL 18, UNAPPLIED) — a trusted schema
  owned by a **NOLOGIN** function owner; a **restricted LOGIN executor** role; a **single-use
  approval-consumption ledger**; `SECURITY DEFINER` `activate_catalog(claims_json, execution_id)` /
  `restore_catalog_inactive(claims_json, execution_id)` functions (empty `search_path`, fully
  schema-qualified, atomic consume-then-transition, replay rejected by the ledger unique key, exact
  pre/postconditions, non-destructive). Each reads the flat `VerifiedApprovalClaimsV1` shape (Finding 1)
  and independently re-checks catalog/approval/evidence freshness on PostgreSQL's OWN wall clock
  (`clock_timestamp()`, Finding 3) immediately before the mutation — so a transaction begun before
  expiry but reaching the UPDATE afterward fails closed. `activate_catalog` RETURNS a deterministic
  `CatalogActivationReceiptV1` (jsonb) built from the ledger row it just consumed (P1-02 Phase-B
  correction) — a return value only, granting NO new authority and NOT serving as commit proof.
  `EXECUTE` is revoked from `PUBLIC` and granted only to the executor role; the executor gets **no**
  direct BUDGET-table DML and **no** ledger DML.
- `trusted-activation-executor.mjs` — the private, one-shot executor: verifies the signed approval,
  runs the concrete **PHASE-A pre-activation** verifier (`runPreActivation`) over authoritative DORMANT
  observations obtained through an approved read-only capability whose provenance must be trusted
  (Finding 2 — NO caller `{pass:true}` verdict is ever accepted), then calls **only** the restricted
  trusted function via a restricted executor DB capability, passing the verifier-emitted
  `VerifiedApprovalClaimsV1` (Finding 1 — never the raw envelope). It emits a bounded
  `CATALOG_ACTIVATION_COMPLETE` receipt only (never `PROBE_READY`; the armed-state seven-ceiling
  `runPreflight` is a separate post-activation/pre-probe gate) and surfaces the deterministic
  `CatalogActivationReceiptV1` (with its commitment) for the separate Phase-B consumed-approval
  correlation. It holds no provider/gateway/CORE
  secret, targets AI-STAGING only, fails closed without the trust root, the approved read-only
  capability, or the restricted DB capability, and never retries.

## Authority separation (operator vs approver vs executor)
- **Probe operator** — supplies pricing evidence, runs the probe; holds no reviewer key and no
  executor DB credential; cannot `EXECUTE` the trusted functions and cannot `UPDATE` BUDGET tables.
- **Independent Owner/reviewer (approver)** — sole holder of the reviewer private key; signs approvals
  out-of-band. Cannot be impersonated by the operator.
- **Trusted executor** — the only principal able to cause activation; verifies the signature and holds
  the only credential that can call the restricted function.

## Evidence → approval → activation → probe correlation
One execution nonce (`execution_id`) threads the reviewer approval, the Phase-A pre-activation
PASS, the single-use activation, the DB ledger row, and the probe. An approval issued for another
execution, or replayed, fails closed at both the verifier and the DB ledger.

## Approval LIFECYCLE — Phase A (unused) vs Phase B (consumed)  [P1-02 correction]
Authentication (`authenticateApproval`, shared, unchanged) is separated from lifecycle disposition:
- **Phase A (pre-activation, executor):** `verifyApproval` = authentication + the approval MUST be
  UNUSED (`isConsumed` advisory pre-check; the DB ledger is authoritative). A missing callback fails.
- **Activation:** the restricted `SECURITY DEFINER` function consumes the approval exactly once
  (atomic ledger insert; replay rejected by the unique key) and RETURNS a deterministic
  `CatalogActivationReceiptV1` (jsonb) built from that ledger row — a RETURN value only, NOT commit
  proof, NOT new authority.
- **Phase B (post-activation / pre-probe):** `verifyConsumedApproval` = the SAME authentication PLUS
  a correlation to EXACTLY ONE legitimately CONSUMED activation record observed POST-COMMIT in the
  authoritative AI-STAGING `approval_consumption` ledger through a trusted read-only capability
  (distinct `TRUSTED_LEDGER_PROVENANCE`), PLUS a matching deterministic activation receipt (the
  executor attaches the receipt commitment; Phase B recomputes it from the authoritative ledger
  record). It performs NO activation and admits NO provider call. The earlier defect — Phase B
  re-running the UNUSED check and rejecting an authentic activation as replay — is corrected. An
  `isConsumed=false`, a caller count, a fabricated ledger object, or a fabricated receipt can never
  fabricate success, and a second activation stays forbidden (executor one-shot + DB ledger unique).
  The committed ledger observation, not the receipt alone, remains authoritative.

## Honest status — what is proven vs not
- **OFFLINE IMPLEMENTATION PASS**: the signature/trust-root authentication and the privilege-boundary
  *artifacts* are implemented and offline-verified (Node signature positive/negative matrix; static SQL
  structure). The seven-ceiling P1-01 check is preserved and executable.
- **LIVE PRIVILEGE / DEPLOYMENT BOUNDARY NOT YET PROVEN**: no local PostgreSQL server was available, so
  the DB role/grant isolation is verified statically only. The existing `postgres` superuser +
  `pg_write_all_data` are **not** restricted by this migration. **Activation remains BLOCKED** until the
  future live gates in `trusted-executor-deployment-spec.json` are established and proven:
  a real reviewer trust root, a genuine signed pricing approval, the applied DB migration, a restricted
  executor credential withheld from the probe/gateway, proven absence of privileged-credential leakage,
  the runtime DB→service-identity proof, and Owner-controlled executor deployment. This packet does not
  claim the inactive catalog has been activated.

## Emergency restoration
The Owner-controlled emergency restoration remains the separate existing
`first-text-probe-activation-01/dormant-restoration.sql` — emergency administrative authority is **not**
granted to the probe or the restricted executor.
