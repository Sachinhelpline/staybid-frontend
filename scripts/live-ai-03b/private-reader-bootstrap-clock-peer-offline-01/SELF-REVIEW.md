# LIVE-AI-03B BOOTSTRAP — CONSOLIDATED REMEDIATION ADVERSARIAL SELF-REVIEW (§32)

One consolidated adversarial pass over the three WORK-v2 Milestone-1 findings (M1-R1 race, M1-R2 production
composition, M1-R3 DB target). Goal: refute each closure; fix material candidate-local defects in-pass; record
residuals honestly. Frozen predecessors were NOT edited.

## M1-R1 — reader invalidation / re-entry race (CLOSED)
**Fix:** every acquisition snapshots its start generation; `stillCurrent()` is re-checked after EVERY awaited phase
(pre-sample, attestation, proof verify, post-sample) and again at the FINAL ATOMIC INSTALL (generation current +
gate passed + monitor healthy). An invalidation atomically clears authority, rotates the generation, INVALIDATES
the completed startup-gate evidence, and returns to WAITING_FOR_CLOCK; re-entry requires a COMPLETE fresh
five-sample `regate()` THEN a fresh acquisition (new nonce → new attestation → valid post-bracket). Concurrent
acquisitions are refused.
- Probed every await boundary with deterministic barriers (`tests/race.test.mjs` A–F): invalidation at pre-sample,
  during attestation (a genuine valid signature returned post-invalidation is discarded before verify), during
  post-sample / before final install, and via monitor invalidation while active — NONE install authority.
- One good sample (I), four good samples (J), and a bare re-gate without attestation (K) all fail to confer
  authority; only re-gate + fresh attestation (L) does, and the new authority is bound to the post-invalidation
  generation + a fresh request nonce (L2–L4).
- Late-result handling: because the generation rotates on invalidation, any late DB sample / attestation / proof /
  post-sample is caught by the post-await recheck or the final atomic guard. `authorityReady()` also re-binds to
  the CURRENT generation, so a stale authority object can never read ready.
- No candidate-local defect survived. Double-concurrent acquisition is explicitly refused (M).

## M1-R2 — production composition (CLOSED)
**Fix:** `production-reader.mjs` / `production-attester.mjs` are REAL fail-closed composition roots; the entrypoints
compose from `process.env`; the permanent `live_wiring_is_a_future_gate` stub is REMOVED. Config is validated
(`production-config.mjs`), the executor + foreign credential categories are refused, and production accepts only
`{env,log}` — any other option key (all test-injection keys) is rejected.
- Probed: empty/partial config → `*_config_incomplete`; executor credential present → `executor_credential_present`;
  wrong/CORE-PROD AI-STAGING identity → mismatch/`config_targets_core_prod`; non-`railway.internal` peer → rejected;
  bad port / short channel secret / bad trust root / malformed anchor / bad issuer → rejected; test-injection key →
  `production_option_not_allowed:<key>`. With valid config the composition PROGRESSES PAST config to the real
  adapter stage (DNS/DB) and then fails closed offline (`attester_peer_*` / `reader_peer_*`) — proving it is not a
  stub. The offline-test boundary composes to a running bootstrap (reader WAITING_FOR_ATTESTER, attester
  BOOTSTRAP_LISTENING), acquires authority via the full bracket, and NEVER opens the gateway serving listener nor
  signs pre-clock.
- Secret handling: no secret VALUE is returned or logged; DB URLs / signing key / channel secret are read by env
  NAME at point of use; entrypoints log only status/reason/version.
- **Material defect found and fixed in-pass (F-R2):** the first composition wired the private-peer resolver as a
  one-shot resolve — an UNUSED supervisor and no refresh/invalidation on a peer transition (violating §21/§22).
  Fixed with `createPeerSupervisor` (validate-before-swap refresh, keep-last-good on unsafe, never widen) wired into
  the attester composition so an unsafe refresh or a validated peer-identity change invalidates signing (rotating
  the generation); `start()` uses an unref'd interval. Covered by `tests/network.test.mjs` F1–F4.
- Test-injection boundary: the offline-test seam requires BOTH `offlineTest` and `offlineTestBoundary` true; the
  production entrypoints never set them, and a lone flag falls through to the production path (rejected/fail-closed).

## M1-R3 — database-clock target (CLOSED)
**Fix:** the clock source is a DIRECT bounded read-only PostgreSQL session to the anchored AI-STAGING Railway
service `b7362594…` (`clock_timestamp()`), the same anchored clock for reader (reader credential) and attester
(observer credential). Docs (`DEPLOYMENT-CONTRACT.md`, `README.md`) rewritten; the misleading `SB_URL`
Supabase/PostgREST clock-contract line is removed.
- Probed with `tests/target-contract.test.mjs`: the clock query is `clock_timestamp()` (not HTTP/REST); the clock
  credential names are the direct reader/observer DB URL names (never Supabase/PostgREST/`SB_URL`); every mention
  of those terms in production SOURCE is a negative comment or the `UNSUPPORTED_CLOCK_ENV` exclusion list — never a
  read; no file dereferences `env["SB_URL"|SUPABASE|POSTGREST]`; docs assert the direct-PostgreSQL contract + the
  anchored pg service id + the explicit exclusion. CORE-PROD stays a distinct excluded id.

## Residuals disclosed honestly (NOT candidate-local defects)
- **R1 (accepted threat-model limit):** a compromised secret-holding reader can misreport its own clock; not
  redesigned (per §29). The reader-side current-generation enforcement + token/nonce/replay controls prevent stale
  authority; the attester's generation handling stays stateless by design.
- **R2:** the synthetic env shares one controllable DB clock — genuine independent inter-service skew and real
  `clock_timestamp()` precision/latency on hosted PostgreSQL are PENDING LIVE VERIFICATION.
- **R3:** the production composition's live branch (real DNS + real reader/observer DB sessions + real listener)
  is proven only structurally offline (config validation + progression-past-config + fail-closed); it is NOT run
  against live AI-STAGING here. Production admin/clock operation is NOT claimed fixed.
- **R4:** live peer-identity rotation performs a controlled listener recreation by the operator/orchestrator; the
  supervisor invalidates authority on transition but does not itself rebuild the v2 listener (that would require a
  mutable-allowlist change to the frozen v2 server, out of scope).

## M1-R1 FINAL lifecycle closure (generation-bound re-gate)
A focused final pass exhaustively inventoried every trust-state writer (`WRITER-INVENTORY.md`) and found a residual
same-family defect the first remediation left in `regate()`:
**F-R1-final — `regate()` bound `gatePassedForGeneration = generation.id` ("whatever generation is current now")
after its awaited 5-sample gate + monitor seed.** An invalidation crossing the re-gate could rotate the generation
and the re-gate would then bind eligibility to the NEW generation using samples partly collected under the OLD one.
**Fixed:** `regate()` now snapshots `startGen`, runs a generation-bound gate (`runGenerationBoundGate` — every
sample whose await crosses a rotation is discarded so no pre-invalidation sample counts and an interrupted run can
never reach five), rechecks the generation after the gate and after the seed, and performs the FINAL SYNCHRONOUS
bind only after re-verifying the unchanged `startGen`, binding to the SNAPSHOT (never the current generation). A
failed same-generation re-gate returns to WAITING_FOR_CLOCK (retryable) without clobbering an invalidation reset.
The construction gate was made uniformly snapshot-bound.
- Deterministic barrier coverage (`tests/regate.test.mjs`, 27): invalidation at each of samples 1–5, the monitor
  seed, and the pre-bind window all abort with `generation_superseded` and no bind; one/four good monitor samples
  and five monitor samples alone never recreate eligibility; a full re-gate creates clock eligibility ONLY; a full
  re-gate + fresh attestation reaches AUTHORITY_READY bound to the re-gate generation + a fresh nonce.
- Static writer-coverage guard (`tests/inventory.test.mjs`, 13): asserts eligibility/authority are bound only to a
  generation SNAPSHOT (never `generation.id`), enumerates the exact writer set, and fails if a new same-family
  writer is introduced — preventing another hidden writer from escaping review.
- Same-family adversarial pass over all inventoried writers + await boundaries found no further M1-R1 race.

## Verdict
Three findings closed; two material candidate-local defects found and fixed in-pass across the passes (F-R2 unused
resolver/no supervision; F-R1-final re-gate current-generation binding) with new barrier + static coverage. No
closure refuted. Residuals are environment/scope boundaries, disclosed, none fixable offline.
Outcome: `FINAL_M1_R1_LIFECYCLE_CLOSURE_COMPLETE_REVIEW_REQUIRED`.
