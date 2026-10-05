# LIVE-AI-03B · M7 Step6/7: dedicated Authority reader-attester and Authority-host V2 dual binding (offline candidate)

**Status:** OFFLINE CANDIDATE, ready for independent review. **This package grants no live authorization.**
Nothing in it has been run against Railway, a live database or any secret. Every live step is a future phase,
and each phase needs its own fresh, exact Owner authorization (see `FUTURE-LIVE-SEQUENCE.md`).

## What this is

This package proves two connections at the same moment, inside the deployed `live-ai-03b-v2-authority` service:

- the **executor** connection (`live_ai_03b_executor`);
- the **reader** connection (`live_ai_03b_reader`).

For each connection it proves the **effective privileges** are exactly the accepted set, and it proves the two
connections are **distinct identities**. Each proof comes from an independent attester:

- **Executor:** the deployed executor attester `c74d7558…`, unchanged, using `executor-attestation-channel-v1`.
- **Reader:** a NEW dedicated private reader attester, `live-ai-03b-authority-reader-attester`, using the
  accepted **v2 clock-gated** protocol.

The dedicated attester runs the **unchanged** accepted bootstrap attester code
(`private-reader-bootstrap-clock-peer-offline-01/bootstrap-entrypoint-attester.mjs`). It has:

- a NEW Ed25519 key;
- a NEW issuer, `staybid-live-ai-03b-authority-reader-attester-v1`;
- a NEW channel secret;
- exactly ONE peer, the Authority (`LIVE_AI_03B_READER_SERVICE_NAME = ${{live-ai-03b-v2-authority.RAILWAY_PRIVATE_DOMAIN}}`).

It reuses the M5 observer credential and the M5 AI-STAGING anchor **by Railway reference only**.

The M5 reader host `88c74a23…` and the M5 reader attester `3a7e5f80…` are **not touched**:

- no variable;
- no restart;
- no second peer;
- no shared key or secret.

## Layout

| Path | Role |
|---|---|
| `src/constants.mjs` | Frozen pins and env NAMES only. AI-STAGING ids are re-exported from the accepted frozen contract. |
| `src/step67-config.mjs` | Authority caller config. It runs the forbidden-secret screen and checks the two DB refs are distinct. It also checks the pins (the dedicated key must ≠ the M5 key), the distinct issuers, keys, secrets and destinations, and the AI-STAGING anchor. |
| `src/reader-v2-attestation-source.mjs` | The Authority side of the accepted v2 path. It uses `startReaderBootstrap` (startup gate plus monitor), `acquireAuthority` (L/U/generation bracket) and `makeClockSamplerOverPhysical` over the SAME reader session. A literal private destination is resolved through `resolvePeerAllowlist`. **It never uses the v1 `createAttestationSourceChannel`.** |
| `src/step67-verifier.mjs` | The 20-step verification core (S1–S12). It composes only accepted primitives and issues zero SQL outside the accepted session lifecycle and the fixed clock probe. |
| `src/step67-verification-entrypoint.mjs` | The one-shot Authority entrypoint for P8. Its arguments are public only: a run id and three public fingerprints. Exit codes: 0 PASS · 3 HOLD · 64 usage. |
| `src/authority-standby-entrypoint.mjs` | The Authority start command from P5 on. It is a names-only idle keep-alive: no DB, no attester, no listener. |
| `src/authority-peer-identity.mjs` | The P7 helper. The Authority resolves its OWN private name with the accepted resolver and reports its exact /128 (or /32) addresses. |
| `src/receipt.mjs` / `src/one-shot-guard.mjs` | The leak-guarded receipt and the one-attempt guards (in the container and on the Owner side). |
| `controller/*` | The Owner-Mac phase controller (P0–P9). It contains the phase plan, the reference plans, the exact argv builders, the names-only state query and P3 identity generation. |
| `tests/*` | Offline security tests (`node tests/run-all.mjs`). |
| `tools/*` | The import closure, predecessor byte-identity check, static audits and manifest builder. |
| `samples/*` | SYNTHETIC receipts that show the shape only. |

## How to review offline

```sh
node scripts/live-ai-03b/m7-step67-authority-dedicated-reader-attester-offline-01/tests/run-all.mjs
node scripts/live-ai-03b/m7-step67-authority-dedicated-reader-attester-offline-01/tools/check-predecessors.mjs
node scripts/live-ai-03b/m7-step67-authority-dedicated-reader-attester-offline-01/tools/static-audit.mjs
```

The ZIP extracts with repository-relative paths. It contains this package plus the minimum byte-identical
accepted dependencies, so the commands above run as-is from the extraction root (no `npm install`; `pg` is
never loaded offline).

## Carried-forward items (not resolved by this package)

- **MANDATORY LATER PRODUCTION-COMPOSITION INTEGRATION ITEM:** this must land before the production provisioner or
  Phase A. The accepted production Authority composition still acquires reader attestations through the **v1**
  caller, and the dedicated attester speaks **v2 only** (a v1 frame is refused with `unsupported_version`; this is
  test E24). This package's v2 reader path is the **verification-only** Step6/7 composition. Integrating v2 into
  the production Authority reader caller is a separate, reviewed change. It is not optional B hardening. It does
  not block this ZIP.
- **Known B item:** the header of the frozen accepted file
  `m7-v2-production-authority-provisioning-offline-01/src/executor-attestation.mjs` carries a stale comment. It
  says "No deployed issuer produces this contract yet … UNPROVISIONED", but the executor attester `c74d7558…` is
  deployed. The frozen source is deliberately **not edited**; record it for a future source-hygiene pass.
