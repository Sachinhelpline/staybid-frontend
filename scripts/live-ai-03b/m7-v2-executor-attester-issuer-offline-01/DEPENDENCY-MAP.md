# Dependency map — frozen modules this package IMPORTS (never edits)

Direct imports are listed below. The full transitive closure (every frozen file loaded at runtime, 30 files) with
SHA-256 at `dcab7c5b` is recorded in two places:
- the external `REVIEW-ANCHOR.json`, which is authoritative;
- `identity/PACKAGE-CONTENT-MANIFEST.json`, which is diagnostic.

Every one of them is byte-unchanged; see the frozen-byte proof.

## Preserved M7 V2 production authority (tree `c22ca7cf`)

| Frozen module | Symbols | Used by |
|---|---|---|
| `src/executor-attestation.mjs` | `verifyExecutorAttestation` | server conformance gate |
| `src/executor-attestation.mjs` | `EXECUTOR_ATTESTATION_CONTRACT`, `EXECUTOR_ATTESTATION_DOMAIN`, `EXECUTOR_PRIVILEGE_KEYS` | signing adapter, server, client |
| `src/executor-attestation.mjs` | `EXPECTED_EXECUTOR_PRIVILEGES`, `ATTESTATION_MAX_LIFETIME_MS` | evaluator, signing adapter |
| `src/executor-session.mjs` | `EXECUTOR_ROLE`, `executorConnectionTokenFor`, `EXECUTOR_APPLICATION_NAME_PREFIX` | registry, evaluator |
| `src/provisioning-config.mjs` | `EXECUTOR_ATTESTER_ENV` (the names only) | config |

## Accepted reader attester (unchanged)

| Frozen module | Symbols | Used by |
|---|---|---|
| `private-reader-attester-offline-01/attester-config.mjs` | `validateAttesterListen` | config |
| `private-reader-attester-offline-01/attester-config.mjs` | `ATTESTER_ID`, `ENV` (reader secret names, so they can be refused) | config |
| `private-reader-attester-offline-01/evidence-queries.mjs` | `PERMITTED_SELECT_OBJECTS`, `FORBIDDEN_OBJECT`, `PROHIBITED_ROLES` | registry |
| `private-reader-attester-offline-01/observer-connection.mjs` | `makeRequestContext`, `parsePgDurationMs` | observer |

## Accepted reader integration / host runtime

| Frozen module | Symbols | Used by |
|---|---|---|
| `private-reader-production-integration-offline-01/reader-attestation.mjs` | `makeAttesterTrustRoot`, `ATTESTATION_MAX_LIFETIME_MS`, `TEST_ISSUER_PREFIX` | config, signing, server |
| `private-reader-production-integration-offline-01/attestation-source-channel.mjs` | `validateAttesterChannelConfig`, `MIN_CHANNEL_SECRET_LEN` | config, client |
| `private-reader-production-integration-offline-01/attestation-source-channel.mjs` | `CHANNEL_*` sizes and timeouts, the reader channel version (to refuse it) | server, client |
| `private-reader-production-integration-offline-01/integration-config.mjs` | `ENV` (the reader channel-secret name, refused here) | config |
| `private-reader-host-runtime-offline-01/observation-transport.mjs` | `PRIVATE_RANGES` | server peer allowlist |
| `private-reader-host-runtime-offline-01/reader-only-authority.mjs` | `READER_ROLE` | registry |

## Accepted primitives and Step 2

| Frozen module | Symbols | Used by |
|---|---|---|
| `trusted-activation-boundary-01/pricing-approval-contract.mjs` | `FIXED` (target ids), `canonicalize`, `publicKeyFingerprintFromDerB64` | target binding, signing |
| `m7-step2-runtime-rebinding-offline-01/runtime/v2-runtime-config.mjs` | `REQUIRED_ENV_NAMES_V2` (executor and reader DB-URL names, refused here) | config |

## Adapted, not imported

The reader attester's `establishObserverSession` and `createObserverCoordinator` are hard-wired to the reader
registry and reader evaluator. Their containment design is therefore reproduced 1:1 in `src/executor-observer.mjs`,
bound to the executor registry and evaluator. The reader module itself is untouched.
