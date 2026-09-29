# M7 Step 2 — architecture / binding map and V1 dependency inventory

## Method

`git grep` at `4f390b74` over every tracked file except `*.md/*.txt/*.log/*.zip/*.diff/*.html` and the Step-1
package, searching for:
- `openai-gpt-5-6-terra-standard-short-v1`
- `89536`
- `live-ai-03b-policy-oneprobe-v1`
- `live_ai_03b_trusted.activate_catalog`
- `2b69ce28…`
- imports of the V1 `pricing-approval-contract.mjs` / `approval-verify.mjs`

This found **64 files** (the list is in `docs/V1-DEPENDENCY-INVENTORY.txt`), 14 of them test files of
frozen suites. Each non-test file was read and classified below.

The gateway application source (`server/voice-gateway/**`) contains **none** of these bindings. It loads
whichever catalog/policy is active from the DB, so the gateway runtime is version-neutral. The Step-1
`m7-gateway` suite proves V2 accounting on it.

## A. Version-bound runtime → V2 successor provided (frozen V1 file untouched)

| Frozen V1 module (source-proven binding) | V2 successor |
|---|---|
| `trusted-activation-boundary-01/pricing-approval-contract.mjs` (`FIXED.catalog_version_id=…-v1`, 89,536, `source_commit 2b69ce`) | `identity/v2-identity.mjs` (from Step-1 `FIXED_V2` + digest generator; imports no V1 contract) |
| `trusted-activation-boundary-01/approval-verify.mjs` (`verifyApproval` / `verifyConsumedApproval`, V1) | Step-1 `approval/approval-verify-v2.mjs` (`verifyApprovalV2` / `verifyConsumedApprovalV2`), used directly |
| `trusted-activation-boundary-01/trusted-activation-executor.mjs` (V1 verifier + V1 Phase A) | `runtime/v2-trusted-activation-executor.mjs` |
| `trusted-executor-runtime-01/restricted-activation-adapter.mjs` (`live_ai_03b_trusted.activate_catalog`) | `runtime/v2-restricted-activation-adapter.mjs` (`live_ai_03b_trusted_v2.activate_catalog_v2` + `restore_catalog_v2_inactive`) |
| `trusted-executor-runtime-01/trusted-read-adapter.mjs` (V1 catalog id; V1 1-version/2-entry predecessor) | `runtime/v2-trusted-read-adapter.mjs` |
| `trusted-executor-runtime-01/trusted-executor-runtime.mjs` (V1 stack; checks ARMED state right after activation) | `runtime/v2-trusted-executor-runtime.mjs` (checks ACTIVATED state; armed belongs to Phase B) |
| `trusted-executor-runtime-01/runtime-config.mjs`, `production-authority.mjs`, `production-query-registry.mjs` | `runtime/v2-runtime-config.mjs`, `runtime/v2-production-authority.mjs`, `runtime/v2-query-registry.mjs` |
| `trusted-runtime-live-binding-offline-01/production-read-queries.mjs` (V1 catalog, `oneprobe-v1`, digest 9927…) | `runtime/v2-query-registry.mjs` |
| `trusted-runtime-live-binding-offline-01/production-authority-composition.mjs` | `runtime/v2-production-authority.mjs` |
| `first-text-probe-activation-01/first-probe-preflight-postflight.mjs` (V1 digests / expiry / 89,536 / 2b69ce) | `runtime/v2-preflight.mjs` |
| `first-text-probe-activation-01/first-text-probe.mjs` (`spendMicros <= 89536`, pin 2b69ce) | `probe/v2-first-text-probe.mjs` (the `PROBE_TEXT` / `PROBE_TEXT_SHA256` constants are imported unchanged) |
| `private-reader-host-offline-01/private-reader-host.mjs` (phases dormant/armed/ceilings; V1 registry digest in the outward guard) | `reader/v2-observation-contract.mjs` |
| `private-reader-host-runtime-offline-01/reader-only-authority.mjs` (V1 registry + V1 adapter) | `reader/v2-reader-only-authority.mjs` |
| `private-reader-host-runtime-offline-01/private-reader-host-runtime.mjs` (V1 host) | `reader/v2-serving-runtime.mjs` |
| `private-reader-production-integration-offline-01/production-reader-authority.mjs` (V1 SQL allow-list; `sourcePin 2b69ce`) | `reader/v2-production-reader-authority.mjs` |
| `private-reader-production-integration-offline-01/gateway-observation-caller.mjs` (V1 outward guard) | `reader/v2-gateway-observation-caller.mjs` |
| `private-reader-production-integration-offline-01/production-entrypoint.mjs` (V1 manager + runtime) | `reader/v2-production-entrypoint.mjs` (+ a V2 source-pin gate) |

## B. Version-neutral primitives → reused by import (only the symbols listed; test ST11 enforces this)

| Frozen module | Symbols used | Why neutral |
|---|---|---|
| `trusted-executor-runtime-01/db-target-binding.mjs` | `verifyConnectionTargetBinding`, `CONNECTION_IDENTITY_PROOF_CONTRACT` | reads only the 6 infrastructure target ids (identical in `FIXED_V2`; tests I02 + ST12) |
| `trusted-executor-runtime-01/canonical-timestamp.mjs` | `CANONICAL_CONSUMED_AT_SQL`, `assertCanonicalConsumedAt` | the same formatter the trusted_v2 functions use |
| `private-reader-host-runtime-offline-01/observation-transport.mjs` | server + wire constants | forwards `host.observe({observation})` verbatim; no version data |
| `private-reader-host-runtime-offline-01/runtime-config.mjs` | env names, listen config, `targetSelfCheck` | targets only |
| `private-reader-host-runtime-offline-01/reader-only-authority.mjs` | `READER_ROLE`, `READER_PRIVILEGE_PROOF_CONTRACT`, `READER_EXPECTED_SELECT_GRANTS` (12), `READER_STATEMENT_TIMEOUT_MAX_MS` | privilege contract unchanged (Step 2 widens nothing) |
| `private-reader-host-offline-01/private-reader-host.mjs` | `ERROR_CODES`, `FORBIDDEN_RESULT_KEY_RE` | a finite code set plus a key regex |
| `private-reader-production-integration-offline-01/reader-session.mjs`, `reader-attestation.mjs`, `attestation-source-channel.mjs`, `integration-config.mjs` | session / attestation / channel / config primitives | targets plus env names only |
| `private-reader-production-integration-offline-01/gateway-observation-caller.mjs` | `validateDestination`, `macFor`, timeouts, code lists | wire/destination policy only |
| `private-reader-production-integration-offline-01/production-entrypoint.mjs` | `composeProductionAttestationSource` | channel composition only |
| `first-text-probe-activation-01/first-text-probe.mjs` | `PROBE_TEXT`, `PROBE_TEXT_SHA256` | the packet requires the same text and digest |

The attester stack (`private-reader-attester-offline-01/*`) and the bootstrap stack
(`private-reader-bootstrap-clock-peer-offline-01/*`) import V1 `FIXED` **only** for target ids or for
canonicalize/fingerprint helpers. Their attestations carry no catalog, policy or ceiling. They are unchanged
and remain compatible with the V2 reader (proven end-to-end in lifecycle H with an independent attester).

## C. Historical SQL / evidence / specs → unchanged, superseded (never V2 authority)

| Frozen artifact | Status under V2 |
|---|---|
| `migrations/…inactive-price-catalog-seed.sql`, `…dormant-control-policy-seed.sql` | V1 historical seed plus the dormant policy. V2 requires V1 **historical inactive** and the dormant policy **preserved**. |
| `first-text-probe-activation-01/{catalog,one-call-policy,control}-activation.sql`, `dormant-restoration.sql`, `activation-digest-gen.mjs`, `gateway-deployment-spec.json` | Superseded by Step-1 `sql/m7-v2-03…07` and PIN B (`identity/GATEWAY-DEPLOY-SOURCE-PROOF.json`). The 2b69ce spec can no longer authorize the real probe. |
| `trusted-activation-boundary-01/db/…trusted-activation-boundary.sql` (M6 `activate_catalog`) | Frozen M6 boundary. It refuses V2 claims (lifecycle P05). Its ledger is reused by trusted_v2. |
| `trusted-boundary-post-apply-offline-01/{deferred-ledger-read-grant,post-application-verification}.sql` | Reused as-is. The M6 canonical verifier PASSES in every V2 lifecycle state. |
| `trusted-runtime-live-binding-offline-01/{trusted-reader-role,gateway-store-role}.sql` | The role shapes are unchanged. Step 2 needs no new grant. |
| `*EVIDENCE-MANIFEST.json`, `*-spec.json`, `future-live-gates.json`, `scripts/live-ai-budget-01/*` | Historical evidence and specs. The V2 operator sequence is `README-OPERATOR.md`. |

## D. Source pins (never conflated)

| Pin | Identity | Enforced by |
|---|---|---|
| A — Step-1 derivation base | `9270c282d5fd65e9fe49261391badfe92c777b8f` / `c46da04123dc44cd9954fe350de0b1bc20ff0948` | the signed bundle (`base_commit`/`base_tree`), `activate_catalog_v2` (`base_commit`), and `checkDerivationBase` (rejects rewriting) |
| B — gateway deploy source | `4f390b74132b087b757faa655bdcb73be6c14a8f` / `72080256d4cc2a97a2a15058931e838ebef5ec48`; `server/voice-gateway` tree `2092d9de…`; `openai-responses.ts` `1a9e2ae8…` | Phase A: `checkStaticGatewaySourceV2` (the REVIEWED STATIC literal + closure digest; no deployment claim accepted). Phase B / reader: `checkDeployedGatewayObservationV2` (independent, healthy, deployed commit/tree/revision/voice-gateway tree exact). Both reject 2b69ce / 87aad22 / 8dd65435 explicitly. `tools/prove-gateway-source.mjs` proves the literal from git. |
| C — Step-2 runtime preservation | `REQUIRED_AFTER_STEP2_PRESERVATION` (no SHA fabricated). Historical `f5ec5807` / manifest `9a460078…` = evidence only | `verifyStep2RuntimePin` (V2 binding; placeholder, V1 binding, historical commit/tree/dir-tree/manifest ⇒ fail) and `tools/verify-step2-preservation.mjs` (three-segment lineage S1/S2/S3 + corrected manifest) |

**Lifecycle correction.** The retired combined check (`checkSourcePinV2`) required the deployed PIN-B observation
for every phase. The phase-specific proofs are `ActivationSourceProofV2` (Phase A / SQL 03 — PIN A + static PIN B +
PIN C; used by `runPreActivationV2`, `runActivationV2`, `v2-trusted-executor-runtime` and the production authority)
and `PreProbeSourceProofV2` (Phase B — PIN A + live deployed healthy PIN B + PIN C; used by `runPreflightV2`, the
reader-only authority and the reader production entrypoint). See `LIFECYCLE-CORRECTION-RECORD.md`.
