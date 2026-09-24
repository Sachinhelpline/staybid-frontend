# LIVE-AI-03B · private-reader PRODUCTION INTEGRATION (OFFLINE candidate)

**Authorization:** Owner, 24 Sep 2026 — one bounded offline production-integration task.
**Disposition:** `OFFLINE_ATTESTATION_SOURCE_CORRECTION_COMPLETE_REVIEW_REQUIRED` (correction of the WORK v2
finding "production attestation-source composition missing") — not deployed, not live-ready,
not provider-ready. Untracked; no Git, Railway, database, credential, provider or CORE-PROD operation.

This connects the **accepted** serving runtime (`../private-reader-host-runtime-offline-01`, commit `828b4ce7`,
byte-unchanged) to a real reader-authority lifecycle through its supported `acquireReaderAuthority` interface. It
also adds a separate authenticated gateway caller. Contract details: `INTEGRATION-CONTRACT.md`.

## Files (all NEW)
| File | Purpose |
|---|---|
| `production-entrypoint.mjs` | Versioned production entrypoint: composes the approved attestation source from validated config (`composeProductionAttestationSource`), plus the authority supervisor. |
| `attestation-source-channel.mjs` | **NEW (correction)** — versioned production attestation-source adapter `reader-attestation-channel-v1`. |
| `production-reader-authority.mjs` | Reader-only authority constructor, continuous lifecycle, enforcing reader client. |
| `reader-attestation.mjs` | Verification of Ed25519-signed `AiStagingReaderAttestationV1` against the pinned trust root. |
| `reader-session.mjs` | One physical connection: statement_timeout + read-only set/read-back, identity token, lazy `pg` factory. |
| `integration-config.mjs` | Non-secret config (env NAMES), trust-root pinning, executor-credential refusal. |
| `gateway-observation-caller.mjs` | Bounded HMAC caller for the accepted transport (no DB credential). |
| `tests/production-integration.test.mjs` | 157 integrated offline assertions (A–H; H = actual production entrypoint composition). |
| `tests/fixtures/reference-attester.mjs` | Offline TEST-ONLY reference issuer (signing key lives only here). |
| `tests/fixtures/synthetic-pg.mjs` | Synthetic PostgreSQL session protocol (no network). |
| `tests/fixtures/simulated-attester-server.mjs` | **NEW** — SIMULATED attester behind the approved channel (fixture key, channel-auth verification, independent observation). |
| `tests/fixtures/pg-hook.mjs`, `tests/fixtures/pg-synthetic-driver.mjs` | **NEW** — harness-only module hook + synthetic `pg` Client, so the REAL production `pg` factory runs offline. |
| `tests/fixtures/production-harness-preload.mjs` | **NEW** — harness-only `--import` preload so the real process `main()` runs offline. |
| `INTEGRATION-CONTRACT.md`, `README.md`, `EVIDENCE-MANIFEST.json` | Documentation + evidence. |

## Reproduce (offline; no secrets; no network beyond local loopback)
```
cd scripts/live-ai-03b/private-reader-production-integration-offline-01
for f in *.mjs tests/*.mjs tests/fixtures/*.mjs; do node --check "$f"; done
node tests/production-integration.test.mjs          # 157 passed, 0 failed, 0 skipped (~30 s; real production timers in H)
env -i PATH="$PATH" node production-entrypoint.mjs; echo $?   # unprovisioned, 70
# accepted suites (unchanged):
node ../private-reader-host-runtime-offline-01/tests/runtime.test.mjs       # 125 passed
node ../private-reader-host-offline-01/tests/private-reader-host.test.mjs   # 54 passed
node ../trusted-runtime-live-binding-offline-01/tests/live-binding.test.mjs # 82 passed
```

## Evidence status
| Claim | Status |
|---|---|
| Accepted runtime + frozen predecessors byte-unchanged | INDEPENDENTLY VERIFIED (hash-asserted in suite) |
| ACTUAL production entrypoint composes the approved source from validated config and serves (simulated attester) | SYNTHETICALLY TESTED |
| Missing/invalid source config fails closed before any DB connection; arbitrary source injection refused | SYNTHETICALLY TESTED |
| Attestation verification matrix (forged / untrusted / stale / future / wrong target / role / binding / drift) | SYNTHETICALLY TESTED |
| Expiry, failed renewal, reconnection, drift, stale-readiness, mid-flight expiry | SYNTHETICALLY TESTED (through the accepted runtime) |
| statement_timeout set + read back on the same session | SYNTHETICALLY TESTED — hosted PostgreSQL: PENDING LIVE VERIFICATION |
| Gateway caller ↔ accepted transport | SYNTHETICALLY TESTED over loopback — Railway isolation: PENDING LIVE VERIFICATION |
| Genuine reader privileges / independent attester | PENDING LIVE VERIFICATION — issuer deployment NOT AUTHORIZED here |
| Live gateway wiring / deployment | NOT AUTHORIZED (not done) |
