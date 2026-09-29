# M7 Step 2 — offline runtime rebinding (V1 / 89,536 → V2 / 105,920)

**Status:** offline candidate. Nothing in this directory has been deployed, applied, signed or run
against any live system. Nothing here is authority by itself.

> **Lifecycle correction (M7-STEP2-LIFECYCLE-CORRECTION-OFFLINE-01).** The accepted runtime required a healthy
> DEPLOYED PIN-B gateway before SQL 03 activation, but that gateway cannot start until a catalog is active — a
> dependency cycle. Phase A now uses a **static reviewed PIN-B source proof**; Phase B (pre-probe) keeps the
> **live deployed PIN-B gateway proof**. The historical PIN C `f5ec5807` (runtime manifest `9a460078…`) is
> historical evidence only and can no longer authorize this runtime. The full record is
> `LIFECYCLE-CORRECTION-RECORD.md`; the corrected live order is below.

This directory is an **additive successor layer**. It rebinds the trusted executor, the read path, the
private reader, the preflight/postflight and the first-text probe from the frozen V1 contract
(catalog `…-short-v1`, policy `oneprobe-v1`, 89,536 µ$) to the accepted Step-1 V2 contract
(catalog `…-short-v2`, policy `oneprobe-v2`, 105,920 µ$). **No frozen file is edited.**

## Layout

| Path | Role |
|---|---|
| `identity/v2-identity.mjs` | The one V2 runtime identity, derived only from the Step-1 contract (`FIXED_V2`, digest generator). Self-checks at import. |
| `identity/v2-source-identity.mjs` | The three distinct source pins — A (derivation base 9270c282), B (gateway deploy source 4f390b74), C (Step-2 preservation, V2 binding — fail-closed placeholder) — and the two phase-specific proofs: `checkActivationSourceProofV2` (Phase A: STATIC reviewed PIN B) and `checkPreProbeSourceProofV2` (Phase B / reader: LIVE deployed healthy PIN B). The combined `checkSourcePinV2` is RETIRED (fails closed). |
| `identity/GATEWAY-DEPLOY-SOURCE-PROOF.json` | Output of `tools/prove-gateway-source.mjs` (read-only git) for PIN B. |
| `identity/STEP2-PRESERVATION-BINDING-TEMPLATE.json` | How the later CORRECTED Step-2 preservation receipt (`Step2RuntimePreservationBindingV2`) must look and be verified (PIN C), including the historical PIN C and the three-segment lineage rules. |
| `identity/RUNTIME-CONTENT-MANIFEST.json` | The measured content manifest of the 17 corrected runtime modules (what the new PIN C must bind). |
| `identity/HISTORICAL-*-f5ec5807.json` | Byte-exact copies of the pre-correction manifest (`9a460078…`) and V1 binding template — historical evidence only. |
| `runtime/v2-query-registry.mjs` | Immutable V2 read-query registry: `public.`-qualified, SELECT-only, content-bound digest. |
| `runtime/v2-trusted-read-adapter.mjs` | V2 read adapter: pre-activation / activated / armed / ceilings / restored / exposure / ledger. |
| `runtime/v2-restricted-activation-adapter.mjs` | Calls ONLY `live_ai_03b_trusted_v2.activate_catalog_v2` and `…restore_catalog_v2_inactive`. |
| `runtime/v2-preflight.mjs` | Phase A (pre-activation), activated-state check, Phase B (pre-probe, issues the V2 receipt), postflight. |
| `runtime/v2-trusted-activation-executor.mjs` | One-shot V2 activation executor (never PROBE_READY). |
| `runtime/v2-trusted-executor-runtime.mjs` | Production-shaped harness: Phase A → activate → committed ledger → Phase-B correlation → activated state. |
| `runtime/v2-runtime-config.mjs`, `runtime/v2-production-authority.mjs` | V2 config (explicit `LIVE_AI_03B_RUNTIME_CONTRACT_VERSION=V2`) and V2 production authority: validation bar + the bounded acquisition/composition seam (`acquireProductionAuthorityV2(provisioner)`, `composeTrustedExecutorProductionV2(provisioner)`); default = UNPROVISIONED. |
| `probe/v2-first-text-probe.mjs` | Same probe text/digest; one send; no retry; `spendMicros ≤ 105920`; accepts only an in-process V2 receipt. |
| `reader/*` | V2 private-reader chain: observation contract, reader-only authority/host, serving runtime, authority manager, gateway caller, production entrypoint. |
| `tools/prove-gateway-source.mjs`, `tools/verify-step2-preservation.mjs` | Read-only git tools for PIN B and PIN C. |
| `tests/` | Unit / negative matrix, the lifecycle-correction suite (`v2-lifecycle-correction.test.mjs`), real-PG lifecycle (PG16 + PG18), predecessor runner, logs in `tests/out/`. |

## Future live sequence (CORRECTED — each step needs its OWN explicit Owner authorization; none is granted here)

The earlier sequence in this file ("deploy the gateway, then activate") was impossible: the PIN-B gateway exits
`no_active_catalog_version` before `app.listen()` while no catalog is active. The corrected order:

1. **Review** this corrected Step-2 candidate (one focused independent WORK review).
2. **Preserve the correction in a NEW PIN C.** Commit this directory on top of `3fda6af1` (the correction changes
   ONLY Step-2 paths), then run `node tools/verify-step2-preservation.mjs --repo <clone> --commit <sha>`. It proves
   the three-segment lineage (S1 `4f390b74 → f5ec5807` historical Step-2 additions; S2 `f5ec5807 → 3fda6af1` the
   accepted M5 closure, retained and never counted as Step-2 drift; S3 `3fda6af1 → <commit>` Step-2-only
   additions/modifications) and that the runtime bytes equal the corrected manifest. It emits the
   `Step2RuntimePreservationBindingV2`. Until then every V2 consumer refuses with
   `step2_runtime_pin_required_after_preservation`; the historical PIN C `f5ec5807` / `9a460078…` is refused.
3. **Fresh AI-STAGING prestate** (read-only).
4. **Owner SQL `01`** (inactive V2 seed).
5. **Owner SQL `02`** (trusted_v2 successor).
6. **Read-only SQL `08` + the frozen M6 canonical verifier** — must PASS.
7. **Separately provision the restricted executor/read authority** (reviewer trust root; restricted
   `live_ai_03b_executor` + `live_ai_03b_reader` clients; independent connection-identity + privilege proofs; the V2
   registry; the `ActivationSourceProofV2` = PIN A + the reviewed STATIC PIN B + the preserved PIN C). It reaches the
   runtime ONLY through a frozen provisioner handed to `composeTrustedExecutorProductionV2` by that separately
   authorized entrypoint. **No deployed gateway is needed or accepted here.**
8. **Genuine independent V2 approval** (signed outside this repo with the real reviewer key).
9. **Phase A** (inside the composed executor): pre-activation state, unused authentic approval, static source proof.
10. **Exactly one trusted SQL `03`** (`activate_catalog_v2`) — one-shot, no retry; the result is never PROBE_READY.
11. **Verify** the committed ledger row + receipt correlation and the V2-sole-active activated state.
12. **Separately provision the restricted gateway-store credential/config.**
13. **Deploy the gateway from exactly `4f390b74` / tree `72080256`** (`server/voice-gateway` `2092d9de…`,
    `service_tier:"default"`). Never `2b69ce…`. It can now start because V2 is active.
14. **Independently verify the healthy deployed PIN-B identity** (deployed commit, tree, deployment revision,
    voice-gateway tree, health) — this observation becomes the `gatewayDeployment` of the `PreProbeSourceProofV2`.
15. **Owner SQL `04`** (policy `oneprobe-v2`, 105,920).
16. **Owner SQL `05`** (controls epoch 1 → 2, with `-v control_updated_at=…`).
17. **Separately provision provider/broker requirements while ingress remains closed.**
18. **Phase-B preflight** (`runPreflightV2`): armed state, the seven exact ceilings, the SAME consumed approval +
    committed ledger + activation receipt, env/key/gate/operator checks, zero prior exposure, provider credential
    presence, and the `PreProbeSourceProofV2` (a static proof is refused). It issues a `FirstProbePreflightReceiptV2`
    **only** on a full PASS.
19. **Within 15 s, in the SAME process, call `runProbeV2`** — ONE send, no retry.
20. **Close ingress / remove the provider credential.**
21. **Owner SQL `07`** (dormant restoration, epoch 3).
22. **Postflight** (`runPostflightV2`) **+ the frozen M6 verifier.**

The in-process rule in step 8 is deliberate. The probe accepts **only** receipt objects issued by
`runPreflightV2` in the same process (module-private `WeakSet`). A serialized, copied, V1 or fabricated
receipt is refused, even when its commitment is recomputed correctly.

## Clock

- The V2 verification window is `2026-09-28T15:26:23Z ≤ now < 2026-10-05T15:26:23Z`. At or after expiry, every
  check fails closed: HOLD for a fresh successor. T0 is never regenerated.
- The live mutation clock is PostgreSQL `clock_timestamp()` inside `activate_catalog_v2` (the Step-1 contract).
  Process time is only a pre-check.

## Running the offline evidence

```
node tests/v2-unit.test.mjs                                   # unit + §19 negative matrix
bash tests/v2-localpg.test.sh                                  # real PG16 lifecycle A–H
M6_PGBIN=/tmp/lai03b-pg18bin/bin bash tests/v2-localpg.test.sh # real PG18 lifecycle A–H
bash tests/run-predecessor.sh                                  # every accepted predecessor suite
node tools/prove-gateway-source.mjs --repo <clone>             # PIN B proof
node tests/v2-lifecycle-correction.test.mjs                    # lifecycle correction (A–K + real-git PIN-C lineage)
bash tests/run-all-m7s2.sh                                     # canonical aggregate (11 required checks)
bash tests/harness-fail-closed.test.sh                         # forced-failure regression for both runners
```

Both aggregate runners are **fail-closed**:
- **`run-all-m7s2.sh` exits 0 only when all 11 required checks pass.** Each check compares the child's
  **exact** exit status with its contract:
  - identity check, gateway proof, unit and the lifecycle-correction suite: 0;
  - the three fail-closed CLIs: exactly 2;
  - the reader entrypoint and serving runtime: exactly 70.

  The unit summary must read exactly `290 passed, 0 failed`; the lifecycle-correction summary exactly
  `m7s2-lifecycle-correction: 113 passed, 0 failed`. Each PostgreSQL lifecycle must really run on the right
  major version and report `60 passed, 0 failed`; a `SKIPPED`, missing binaries or a missing/partial summary is a
  FAIL. Otherwise the runner exits 1 with `RESULT: FAIL`.
- **`run-predecessor.sh` exits 0 only with 0 suite failures, 0 required-setup failures and exactly 44 suites.**
  - A fatal setup failure (output directory, copying the candidate) exits 3 immediately.
  - A failed historical 9270c282 checkout is counted as a setup failure.

`M7S2_PG18_BIN` overrides the local PG18 test-build path. It is harness configuration only, not runtime authority.
