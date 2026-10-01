# Dependency map — frozen modules this package COMPOSES (never edits)

The exact paths and SHA-256 values at baseline `0afe4b6b` are in `identity/PACKAGE-CONTENT-MANIFEST.json` under
`frozen_dependencies`. Every file listed below is byte-unchanged; see the frozen-file proof in the review package.

## Step-2 runtime — covered by PIN C `0afe4b6b` (runtime manifest `64c70317…`)

| Frozen module | Symbols used | Used by |
|---|---|---|
| `runtime/v2-trusted-executor-runtime.mjs` | `composeTrustedExecutorProductionV2`, `composeTrustedExecutorTestV2` | production-entrypoint |
| `runtime/v2-production-authority.mjs` | `PROVISIONER_CONTRACT_V2`, `validateProvisionedAuthorityV2`, `REQUIRED_AUTHORITY_FIELDS_V2` | provisioner |
| `runtime/v2-runtime-config.mjs` | `loadRuntimeConfigV2`, `REQUIRED_ENV_NAMES_V2`, `FORBIDDEN_ENV_NAMES_V2` | provisioning-config |
| `runtime/v2-query-registry.mjs` | `buildV2RegistrySupply`, `assertSuppliedRegistryV2`, `V2_QUERY_REGISTRY`, `LEDGER_COMMITTED_QUERY_V2`, `REGISTRY_SELF_CHECK`, `V2_REGISTRY_DIGEST` | provisioner, guarded-clients |
| `runtime/v2-restricted-activation-adapter.mjs` | `ACTIVATE_SQL_V2` | guarded-clients |
| `identity/v2-source-identity.mjs` | `DERIVATION_BASE`, `staticGatewaySourceIdentityV2`, `checkActivationSourceProofV2`, `ACTIVATION_SOURCE_PROOF_CONTRACT_V2`, `STEP2_BINDING_CONTRACT`, `STEP2_PIN_STATUS_PRESERVED`, `STEP2_TRUSTED_PROVENANCE` | activation-source, provisioner |
| `identity/v2-identity.mjs` | `TARGETS_V2` | role-binding |
| `tools/verify-step2-preservation.mjs` | `verifyStep2Preservation`, `makeGit` (read-only git) | activation-source, the in-package diagnostic verifier |

**Not used:** `checkPreProbeSourceProofV2` and `PRE_PROBE_SOURCE_PROOF_CONTRACT_V2` (Phase B). The source modules never
import them; test I14 asserts this.

## Accepted predecessors — baseline tree `0afe4b6b`

| Frozen module | Symbols used | Used by |
|---|---|---|
| `trusted-executor-runtime-01/db-target-binding.mjs` | `verifyConnectionTargetBinding`, `CONNECTION_IDENTITY_PROOF_CONTRACT` | role-binding |
| `private-reader-production-integration-offline-01/reader-attestation.mjs` | `verifyReaderAttestation`, `makeAttesterTrustRoot`, `ATTESTATION_CONTRACT`, `ATTESTATION_MAX_LIFETIME_MS`, `ATTESTATION_FORWARD_TOLERANCE_MS` | role-binding, provisioning-config, executor-attestation |
| `private-reader-production-integration-offline-01/reader-session.mjs` | `establishReaderSession`, `makePgPhysicalFactory`, `parsePgDurationMs` | provisioner, production-entrypoint, executor-session |
| `private-reader-production-integration-offline-01/attestation-source-channel.mjs` | `createAttestationSourceChannel`, `validateAttesterChannelConfig` | production-entrypoint, provisioning-config |
| `private-reader-production-integration-offline-01/integration-config.mjs` | `ENV` (the accepted reader-attester env names) | provisioning-config |
| `private-reader-host-runtime-offline-01/reader-only-authority.mjs` | `READER_ROLE` | provisioner, role-binding |
| `trusted-activation-boundary-01/pricing-approval-contract.mjs` | `FIXED` (the six target ids only), `canonicalize`, `verifyEnvelopeSignature` | executor-attestation |
| `m7-step1-hb1-consolidated-remediation-01/approval/pricing-approval-contract-v2.mjs` | `publicKeyFingerprintFromDerB64` | reviewer-trust-root |

## Step 10 — preserved executor-attester issuer (commit `02345082`, runtime digest `5a920a9f…`)

| Frozen module | Symbols used | Used by |
|---|---|---|
| `m7-v2-executor-attester-issuer-offline-01/src/executor-attestation-channel.mjs` | `createExecutorAttestationSourceChannel` | production-entrypoint (`acquireExecutorAttestationSourceV2`) |

It is imported unchanged; its channel protocol is not re-implemented here. The adapter itself imports
`executor-attestation.mjs` and `executor-session.mjs` from this package; nothing imports `production-entrypoint.mjs`,
so there is no import cycle. The identity manifest records it as `covered_by: executor_attester_issuer_preservation_02345082`.

`loadIntegrationConfig` of the reader host is deliberately not used. It refuses an environment that contains the
executor credential, which is correct for the standalone reader host but not for the executor authority process. So
this package reuses only the accepted names (`ENV`) and the accepted validators.
