# M7 Step 2 — lifecycle correction record (M7-STEP2-LIFECYCLE-CORRECTION-OFFLINE-01)

**Status:** offline correction candidate for ONE focused independent WORK review.

**Not done:**
- no live readiness is claimed;
- no corrected PIN C exists;
- SQL 01/02 are NOT released by this record.

Nothing here was deployed, applied, signed, committed or pushed.

## 1. The defect (WORK finding — `HOLD_M7_LIVE_SEQUENCE_RECONCILIATION`)
The accepted Step-2 runtime (preserved at `f5ec5807`, runtime manifest `9a460078…`) validated ONE combined source pin
`checkSourcePinV2` (`LiveAi03bSourcePinV2`) everywhere. The PIN-B component, `checkGatewaySourcePinV2`, required an
OBSERVED DEPLOYED gateway: deployed commit, tree, deployment revision and voice-gateway tree.

The same pin was demanded by all of these:
- Phase A (`runPreActivationV2`);
- the activation executor;
- the executor runtime;
- the V2 production authority (`validateProvisionedAuthorityV2`);
- Phase B and the reader.

The PIN-B gateway (`server/voice-gateway/live-ai-staging-main.ts`, `stagingMain`) does four things in order:
1. connects to AI-STAGING;
2. calls `loadStagingPriceCatalog(pool)`;
3. exits fail-closed with `no_active_catalog_version` while no catalog is active;
4. only then calls `app.listen()`.

This creates a cycle:
- a healthy gateway requires an active catalog;
- an active catalog requires SQL 03;
- SQL 03 activation authority requires an already-deployed healthy gateway.

The cycle is reproduced in `tests/v2-lifecycle-correction.test.mjs` A01–A05, against the historical `f5ec5807`
bytes extracted with read-only `git archive`, plus the real PIN-B gateway source:
- the historical Phase A fails with `gateway_source_observation_absent`;
- it passes only when a deployed gateway is observed;
- in the gateway source, the catalog load and its fail-closed exit precede `app.listen()`.

## 2. The correction: two phase-specific proofs
`identity/v2-source-identity.mjs`:

| | ActivationSourceProofV2 (`LiveAi03bActivationSourceProofV2`) | PreProbeSourceProofV2 (`LiveAi03bPreProbeSourceProofV2`) |
|---|---|---|
| Used by | Phase A `runPreActivationV2`, `runActivationV2`, `v2-trusted-executor-runtime`, `validateProvisionedAuthorityV2` | Phase B `runPreflightV2`, `validateReaderOnlyAuthorityV2`, reader production entrypoint |
| PIN A | exact `9270c282…` / `c46da041…` | same |
| PIN B | `gatewayStaticSource` must byte-equal `staticGatewaySourceIdentityV2()`, which is derived ONLY from the reviewed literal `GATEWAY_DEPLOY_SOURCE_V2`, never supplied by a caller. It contains kind, repository, commit `4f390b74`, tree `72080256`, voice-gateway tree `2092d9de` and a closure digest over every reviewed closure/broker blob (including `openai-responses.ts` `1a9e2ae8…` and `live-ai-staging-main.ts` `e211b25f…`). | `gatewayDeployment` must be an independent observation: kind `live-deployed-gateway-observation`, trusted provenance `independent-railway-deployment-observation-v2` (TEST provenance only under the test boundary), `healthy:true`, and deployed commit / tree / deployment revision / voice-gateway tree exactly PIN B. |
| Deployment claim | **forbidden**: any `deployed_*`, `gateway_deployment_revision`, `healthy`, `observation_*` or `gatewayDeployment` key ⇒ `activation_proof_must_not_claim_gateway_deployment`; the result says `gatewayDeployed:false` | **required** |
| Static proof accepted? | yes (it IS the static proof) | **never** ⇒ `static_gateway_proof_cannot_satisfy_pre_probe` |
| Superseded `2b69ce` / `87aad22` / `8dd65435` | explicitly rejected | explicitly rejected |
| PIN C | PRESERVED `Step2RuntimePreservationBindingV2` | same |

The combined `checkSourcePinV2` is **retired**: it fails closed for every input with
`combined_source_pin_v2_retired_phase_specific_proof_required`. A `LiveAi03bSourcePinV2` object is refused by both
new proofs. Either proof supplied in the other phase's slot is refused. `checkGatewaySourcePinV2` is unchanged; it is
used only inside the deployed observation.

Why Phase A may use the static identity: deployment is structurally impossible before catalog activation. The static
identity is the exact reviewed literal and is re-provable from git (`tools/prove-gateway-source.mjs`; B04 checks
every closure blob at `4f390b74`). It claims nothing about deployment or health. Phase B keeps the full live
condition.

**The V2 reader host keeps the strong proof.** The reader is a post-deployment component. The Phase-A path reads
through the executor runtime's own restricted V2 read adapter, never through the reader host. The PIN-B gateway source
has no dependency on the V2 reader host.

## 3. PIN C — the historical binding is superseded, and the new one is not fabricated
- **Historical `f5ec5807`** (tree `742c837d…`, Step-2 dir tree `c0a2910d…`, manifest `9a460078…`) is HISTORICAL
  EVIDENCE ONLY. Its byte-exact artifacts are kept as `identity/HISTORICAL-RUNTIME-CONTENT-MANIFEST-f5ec5807.json`
  and `identity/HISTORICAL-STEP2-PRESERVATION-BINDING-TEMPLATE-V1-f5ec5807.json`.
- **`verifyStep2RuntimePin` refuses each historical element individually:** the V1 contract, the historical commit,
  the historical tree, the historical Step-2 dir tree and the historical manifest digest.
- **New binding contract:** `Step2RuntimePreservationBindingV2`, with trusted provenance
  `trusted-approved-step2-preservation-receipt-v2`. It adds lineage fields `correction_base = 3fda6af1…` and
  `historical_pin_c = f5ec5807…`. The placeholder stays `REQUIRED_AFTER_STEP2_PRESERVATION` with no commit or tree.
- **Corrected runtime manifest:** `64c7031746bff227321e2e2506b4737938eafc3493ae472ab0f51e5e46987d9f`, over the same
  17 runtime modules (`identity/RUNTIME-CONTENT-MANIFEST.json`).

### Verification model — `tools/verify-step2-preservation.mjs`
HEAD `3fda6af1` (the accepted M5 attester clock-recovery closure) comes after `f5ec5807`. The old rule, "every change
since PIN B is a Step-2 addition", cannot hold, and must not be forced by reverting M5 or fabricating history. The
smallest rigorous model is three segments over fixed commits that are re-derived from git:

| Segment | Range | Rule |
|---|---|---|
| S1 historical Step-2 lineage | `4f390b74 → f5ec5807` | ancestor; `f5ec5807` has tree `742c837d` and Step-2 dir tree `c0a2910d`; every change is an ADDITION under the Step-2 dir (real repo: 108 additions) |
| S2 accepted M5 closure | `f5ec5807 → 3fda6af1` | ancestor; `3fda6af1^1 = f5ec5807`; tree `aef84e58`; **zero** Step-2 paths; the Step-2 dir tree is unchanged; every path is under `m5-attester-clock-recovery-remediation-offline-01/` or `private-reader-bootstrap-clock-peer-offline-01/` (real repo: 63 changes). These are retained and never counted as Step-2 drift. |
| S3 correction | `3fda6af1 → X` | ancestor; X is not a known commit; at least one change; every changed path is under the Step-2 dir and is an addition or modification (no deletion). So every M5 and frozen path at X equals `3fda6af1`. |

The verifier then checks the Step-2 dir tree and the runtime bytes at X:
- the Step-2 dir tree at X must differ from the historical one;
- the runtime bytes at X must reproduce the corrected manifest, which must not be the historical one;
- only then does it emit the V2 binding.

P01–P07 run this model on the real repository. S1 and S2 are real git. S3 uses a working-tree overlay: blob hashes are
computed locally and nothing is written to git.

A future corrected PIN C must bind exactly five things:
- the preservation commit;
- its tree;
- its Step-2 dir tree;
- manifest `64c70317…`;
- trusted preservation provenance.

It reaches the runtime only through the Owner-controlled authority. Until then production fails closed.

## 4. Production-authority acquisition seam (`runtime/v2-production-authority.mjs` + `v2-trusted-executor-runtime.mjs`)
**Default (unchanged behaviour):**
- `acquireProductionAuthorityV2()` with no provisioner returns the deterministic frozen `v2_production_authority_unprovisioned`.
- `runTrustedExecutorProductionV2(request)` therefore fails closed.

**Seam: `composeTrustedExecutorProductionV2(provisioner)`.** A future, separately authorized production entrypoint
passes a **frozen** `{ contract: "LiveAi03bProductionAuthorityProvisionerV2", acquire }` at composition time.
- The returned object exposes only a one-shot `run(request)`.
- `acquire()` is called with **no arguments**, so a request can never reach it.
- Request keys other than `{ approvalEnvelope, suppliedEvidence, executionId }` are refused **before** acquisition.

**Validation bar:** the authority must pass `validateProvisionedAuthorityV2` in PRODUCTION mode.
- **Field set:** it must be exact. An unexpected field is refused, e.g. `sourcePin` or `providerApiKey`.
- **DB clients:** executor and reader clients must be distinct and must not be test fixtures.
- **Connection identity:** a trusted connection-identity proof bound to the issuer and token.
- **Target:** AI-STAGING, not CORE.
- **Privilege:** a restricted-role privilege proof.
- **Registry:** a content-verified registry.
- **Source proof:** the phase-appropriate `ActivationSourceProofV2` with a trusted PRESERVED PIN C.
- **Clock:** a trusted clock.

**What does not exist:** no global setter, no module-scope mutable slot, no env JSON blob and no request-borne
authority (F26 static scan).

**TEST path:** `composeTrustedExecutorTestV2(provisioner, { testBoundary: true })` and
`acquireAuthorityForTestV2`. The same synthetic authority is rejected by production (F05/F06/F23).

**Nothing is provisioned in this task:** no credential, secret, key, trust root or live authority.

## 5. Changed runtime files (the complete list)
| File | Change |
|---|---|
| `identity/v2-source-identity.mjs` | phase-specific proofs; static/deployed PIN-B checks; PIN-C V2 + historical/lineage constants; combined check retired |
| `runtime/v2-preflight.mjs` | Phase A → activation proof; Phase B → pre-probe proof (the shared railway/target helper no longer checks source) |
| `runtime/v2-trusted-activation-executor.mjs` | Phase-A observation field `activationSourceProof` |
| `runtime/v2-trusted-executor-runtime.mjs` | activation proof; composition seam; production/test run paths |
| `runtime/v2-production-authority.mjs` | acquisition seam, provisioner contract, exact-field validation, activation proof |
| `reader/v2-reader-only-authority.mjs`, `reader/v2-production-entrypoint.mjs` | the `sourcePin` slot is validated as a PreProbeSourceProofV2 (not weakened) |

**Not changed** (audited): `probe/v2-first-text-probe.mjs`, `runtime/v2-runtime-config.mjs`,
`runtime/v2-trusted-read-adapter.mjs`, `runtime/v2-query-registry.mjs`, `runtime/v2-restricted-activation-adapter.mjs`,
`identity/v2-identity.mjs`, and the other `reader/*` files.

The probe needed no change. It accepts only in-process receipts issued by `runPreflightV2`, which now requires the
pre-probe proof, and its expected gateway identity (`4f390b74` / `72080256` / `2092d9de`) is unchanged.

**Tools:**
- `tools/verify-step2-preservation.mjs` (three-segment model);
- `tools/write-identity-artifacts.mjs` (V2 template + historical section).

**Tests:**
- `tests/helpers.mjs`, `tests/v2-unit.test.mjs`, `tests/v2-localpg-lifecycle.mjs` and `tests/probe-child.mjs` are
  moved to the new proof shapes (same assertion counts);
- new `tests/v2-lifecycle-correction.test.mjs`;
- `tests/run-all-m7s2.sh` has 11 required checks;
- `tests/harness-fail-closed.test.sh` has the new shim and two forced-failure cases.

## 6. Corrected live order (summary; full text in `README-OPERATOR.md`)
1. review
2. new PIN C
3. prestate
4. SQL 01
5. SQL 02
6. read-only SQL 08 + M6 verifier
7. executor/read authority
8. genuine approval
9. Phase A
10. one SQL 03
11. ledger + sole-active verify
12. gateway-store credential
13. deploy exact PIN B
14. verify the healthy deployed PIN-B identity
15. SQL 04
16. SQL 05
17. provider/broker with ingress closed
18. Phase-B preflight
19. one probe
20. close ingress / remove the credential
21. SQL 07
22. postflight + M6 verifier

The gateway is never before SQL 03. SQL 03 is never before genuine approval. SQL 04/05 are never before the verified
deployed gateway.

## 7. Residual notes (honest)
- **Validation is not authentication.** `validateProvisionedAuthorityV2` is an acceptance bar. The real guarantees
  still come from four places:
  - the genuine reviewer signature against the config-pinned trust root;
  - the database-enforced restricted roles;
  - the DB function checks;
  - the composition being performed only by the separately authorized entrypoint.

  A provenance string alone is never authority, as in the accepted architecture.
- **Reader host before activation:** if the Owner ever wants the V2 reader HOST, rather than the executor runtime's
  own reader client, running before activation, that needs its own reviewed decision. This correction deliberately
  does not weaken the reader.
- **Step-2 dir `MANIFEST.json`:** it is the historical evidence-ZIP manifest of the accepted Step-2 package
  (`9a460078…`). It is left unchanged as history; this correction's package carries its own `MANIFEST.json`.
