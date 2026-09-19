# LIVE-AI-03B — P1-02 Trusted Executor Runtime + Read Adapter (OFFLINE integration)

**Status:** UNAPPLIED / UNDEPLOYED / NON-ACTIVATING offline integration artifacts · **ARTIFACT_T0:** `2026-09-19T05:41:50Z`
**Packet:** LIVE-AI-03B-P1-02-TRUSTED-EXECUTOR-READ-ADAPTER-OFFLINE-IMPLEMENTATION-01

This is a **separate, offline** integration boundary that connects the **frozen** accepted P1-02
contracts (in `../trusted-activation-boundary-01/` and `../first-text-probe-activation-01/`, the
Git-preserved 19-file set at commit `653a84c1…`) to the **future** AI-STAGING runtime. It changes
**none** of those 19 files. It performs no live database/Railway/provider access, no git action, no
deployment, and remains **inert** unless deliberately invoked with real injected capabilities
(absent offline ⇒ fail closed).

## Production dependency boundary (remediation)
An independent WORK negative test found the first cut let the **activation caller** supply the
security-authoritative dependencies (DB clients, trust root, connection proof, privilege boolean,
reviewed SQL, source pin), so a caller could drive a false `ok/activated` with synthetic infra.
Corrected: the **untrusted activation request** is now strictly separated from the
**independently-controlled production authority**. `runTrustedExecutorProduction(request)` accepts
ONLY `{ approvalEnvelope, suppliedEvidence, executionId }` — any other key is rejected — and acquires
all trusted dependencies from `production-authority.mjs` + the digest-bound `production-query-registry.mjs`,
never from the caller. Offline both are unprovisioned/incomplete, so production fails closed. The
connection proof is bound to an independent issuer + the actual client token (a public provenance
string is not authority). The test path keeps injection under an explicit test boundary only.

## Modules
- `runtime-config.mjs` — non-secret config contract + fail-closed loader (NAMES only; target IDs from the frozen `FIXED`).
- `production-authority.mjs` — independent acquisition of trusted production dependencies; NO caller-reachable injector; unprovisioned (fail-closed) in this repo state.
- `production-query-registry.mjs` — immutable, digest-bound known-schema queries; policy/control/ceiling/zero-exposure columns are an unresolved schema-binding gate ⇒ registry incomplete ⇒ production blocked.
- `db-target-binding.mjs` — connection→service identity binding; independent proof bound to issuer + client token required, CORE-PROD rejected, fail-closed offline.
- `canonical-timestamp.mjs` — whole-second UTC `consumed_at` canonicalizer + the reviewed DB `to_char` expression (matches the frozen receipt; truncates, never rounds; fails closed on malformed/missing).
- `restricted-activation-adapter.mjs` — typed capability invoking ONLY the frozen `live_ai_03b_trusted.activate_catalog(jsonb,text)`; no arbitrary SQL, no admin fallback, no auto-retry.
- `trusted-read-adapter.mjs` — read-only observations (dormant predecessor, committed ledger POST-COMMIT, armed state, seven ceilings); constructs provenance/dbIdentity/committed ITSELF; policy/control/ceiling columns via a reviewed query binding (future schema gate).
- `trusted-executor-runtime.mjs` — the production + test entrypoints wiring the frozen one-shot executor (`runActivation`) + frozen Phase-B verifier (`verifyConsumedApproval`) + the adapters. Production rejects test flags / test provenance / synthetic trust roots / mock fixtures; never emits `PROBE_READY`.

## Trust / lifecycle
PHASE A (authentic signed approval + UNUSED) → restricted single-use activation → committed ledger
row → trusted POST-COMMIT observation → PHASE B (SAME approval correlated to exactly one consumed
ledger row + deterministic receipt + armed state + seven ceilings). A successful function response
alone is not commit proof; the committed ledger observation is authoritative. Catalog activation
alone is **not** probe-ready.

## Tests
```
node scripts/live-ai-03b/trusted-executor-runtime-01/tests/runtime-integration.test.mjs
```
One consolidated offline suite (66 checks): canonical timestamp; target binding (issuer + client-token);
activation-adapter single-use / ambiguous-commit / no-arbitrary-SQL / prod-refuses-fixture;
committed-ledger provenance + timestamp negatives; the **production dependency-boundary remediation**
(the demonstrated bypass + each caller-supplied-authority vector now fails closed; a clean request
fails closed at the unprovisioned authority); harness pre-activation negatives; the positive
Phase A→activation→Phase B lifecycle; and the one-shot guard. Uses a disposable in-memory fixture +
synthetic keys under an explicit test boundary.

## Honest status — NOT proven live
- **OFFLINE INTEGRATION PASS** only. The disposable in-memory fixture is **not** live PostgreSQL and
  is never presented as privilege verification.
- **Remaining LIVE gates:** independently-provisioned reviewer trust root; restricted executor +
  read-only reader credentials (credential-isolated from postgres/pg_write_all_data/gateway/probe);
  applied trusted-boundary migration on AI-STAGING PG `b7362594-…`; an independent connection→service
  identity proof; the reviewed policy/control/seven-ceiling **schema-confirmation binding** (those
  exact columns are not in the accepted 19 artifacts); provider credential; gateway arm + full
  preflight; and the single probe — each a separate authorized step.
- **Activation REMAINS BLOCKED.** No production trust root, no genuine signed approval, migration
  UNAPPLIED, no live credentials.
