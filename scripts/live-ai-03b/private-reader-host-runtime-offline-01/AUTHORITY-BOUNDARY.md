# LIVE-AI-03B — reader-only authority: how `executorDbClient` is excluded

## The WORK v2 conflict (unchanged accepted code)
`private-reader-host-offline-01/private-reader-host.mjs` → `makePrivateReaderHost()` calls the accepted
`validateProvisionedAuthority()` (`trusted-runtime-live-binding-offline-01/production-authority-composition.mjs`),
whose `REQUIRED_AUTHORITY_FIELDS` includes **both** `readerDbClient` **and** `executorDbClient`, and which checks
both clients (`for (const c of ["executorDbClient","readerDbClient"])`). The private reader host may hold
**reader** authority only. Supplying a real executor client would breach the trust boundary; supplying a
fake one would bypass frozen validation. Both are forbidden. **Neither accepted file was edited.**

## The resolution — `reader-only-authority.mjs` (`reader-only-authority-v1`)
A new, narrowly versioned interface that establishes reader authority **without** the accepted factory:

| Accepted component reused (imported, unchanged) | Role in the reader-only path |
|---|---|
| `makeTrustedReadAdapter` (`trusted-executor-runtime-01/trusted-read-adapter.mjs`) | Requires only `{dbClient, targetBinding, reviewedStateQueries, mode}` — **no executor**. Runs only the fixed SELECT-only registry; rejects a `__testFixture` client in production. |
| `verifyConnectionTargetBinding` + `CONNECTION_IDENTITY_PROOF_CONTRACT` (`db-target-binding.mjs`) | AI-STAGING identity proof (trusted provenance, issuer + client-token bound, never CORE-PROD). |
| `assertSuppliedRegistry` + `CANDIDATE_REGISTRY_DIGEST` (`production-read-queries.mjs`) | Pinned, content-verified reviewed query registry. |
| `assertOutwardMessage`, `OBSERVATIONS`, `ERROR_CODES` (`private-reader-host.mjs`) | The accepted value-validated, non-secret outward boundary + fixed failure codes. |

`validateReaderOnlyAuthority()`:
- `REQUIRED_READER_FIELDS` has **no** `executorDbClient` and **no** executor `privilegeProof`.
- **Actively rejects** an authority carrying `executorDbClient` (`reader_only_rejects_executor_client`) or an
  executor `privilegeProof` (`reader_only_rejects_executor_privilege_proof`) — the reader host can never be handed
  executor authority, even by mistake.
- Requires a NEW **reader-privilege proof** (`AiStagingReaderPrivilegeProofV1`) — a proof *object*, not a
  boolean: role `live_ai_03b_reader`, target PG `b7362594-…`, `effectiveSelectOnly:true`, `writePrivilegeCount:0`,
  `selectGrantCount:12`, `forbiddenObjectAccessible:false` (`budget_envelope_allocations`), no unapproved role
  membership/routine authority, bound to the same client token, fresh (≤5 min, not future-dated), with
  trusted provenance.
- Reuses the accepted target, trust-root-pinning, registry and source-pin rules.

`makeReaderOnlyHost()` then composes `verifyConnectionTargetBinding` → `makeTrustedReadAdapter(reader client)`
→ `observe()` guarded by the accepted `assertOutwardMessage`. The reader client is closure-held and never
returned. **No executor object exists anywhere in this path** (test-asserted by a source scan).

## Why this is NOT a general-purpose replacement
It validates reader authority only, refuses executor authority outright, exposes only the three fixed
observations, and is used only by the private reader host. The activation executor's own validation
(`validateProvisionedAuthority`) is untouched and still governs executor authority.

## Synthetic vs genuine proof
Offline tests use `TEST-ONLY-…` provenance strings under an explicit `testBoundary`. In production mode
(`testBoundary:false`) those are **rejected** (`connection_proof_untrusted` / `reader_privilege_proof_untrusted`),
a `__testFixture` client is rejected, and the production acquire (`acquireReaderOnlyProductionAuthority`)
returns `UNPROVISIONED` with **no injector** — so no synthetic authority is reachable through the production
startup path. Caveat (same as the accepted validator): the validator is structural; genuine trust comes from the
deployment producing the proofs from independent sources at the later live gate (see DEPLOYMENT-CONFIG.md).

## Two-issue correction (observation deadline) — authority boundary unchanged
The reader-only authority gained ONE additional requirement and ONE internal guard; nothing about who holds
which authority changed:
- `validateReaderOnlyAuthority` now requires `readerDbClient.statementTimeoutMs` (integer 1–2000) — the
  declared DB-side per-statement bound the deployment enforces on the reader connection
  (`reader_client_statement_timeout_invalid` otherwise). Still NO executor field, client or proof.
- `makeReaderOnlyHost` passes the accepted `makeTrustedReadAdapter` an **abort-gated view** of the SAME reader
  client (`query` + `statementTimeoutMs`, and `__testFixture` copied through so the accepted production refusal
  of test fixtures still applies). `observe(request, { signal })` runs the adapter in an AsyncLocalStorage
  context; after abort no further query is issued and a late result is discarded. The adapter, target binding,
  pinned registry and outward boundary are the accepted, unedited modules; no cancellation API is invented.
