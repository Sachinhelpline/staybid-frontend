# M7 Step 2 — offline runtime rebinding (V1 / 89,536 → V2 / 105,920)

**Status:** offline candidate. Nothing in this directory has been deployed, applied, signed or run
against any live system. Nothing here is authority by itself.

This directory is an **additive successor layer**. It rebinds the trusted executor, the read path, the
private reader, the preflight/postflight and the first-text probe from the frozen V1 contract
(catalog `…-short-v1`, policy `oneprobe-v1`, 89,536 µ$) to the accepted Step-1 V2 contract
(catalog `…-short-v2`, policy `oneprobe-v2`, 105,920 µ$). **No frozen file is edited.**

## Layout

| Path | Role |
|---|---|
| `identity/v2-identity.mjs` | The one V2 runtime identity, derived only from the Step-1 contract (`FIXED_V2`, digest generator). Self-checks at import. |
| `identity/v2-source-identity.mjs` | The three distinct source pins: A (derivation base 9270c282), B (gateway deploy source 4f390b74), and C (Step-2 preservation — fail-closed placeholder). |
| `identity/GATEWAY-DEPLOY-SOURCE-PROOF.json` | Output of `tools/prove-gateway-source.mjs` (read-only git) for PIN B. |
| `identity/STEP2-PRESERVATION-BINDING-TEMPLATE.json` | How the later Step-2 preservation receipt must look and be verified (PIN C). |
| `identity/RUNTIME-CONTENT-MANIFEST.json` | The measured content manifest of the 17 runtime modules (what PIN C binds). |
| `runtime/v2-query-registry.mjs` | Immutable V2 read-query registry: `public.`-qualified, SELECT-only, content-bound digest. |
| `runtime/v2-trusted-read-adapter.mjs` | V2 read adapter: pre-activation / activated / armed / ceilings / restored / exposure / ledger. |
| `runtime/v2-restricted-activation-adapter.mjs` | Calls ONLY `live_ai_03b_trusted_v2.activate_catalog_v2` and `…restore_catalog_v2_inactive`. |
| `runtime/v2-preflight.mjs` | Phase A (pre-activation), activated-state check, Phase B (pre-probe, issues the V2 receipt), postflight. |
| `runtime/v2-trusted-activation-executor.mjs` | One-shot V2 activation executor (never PROBE_READY). |
| `runtime/v2-trusted-executor-runtime.mjs` | Production-shaped harness: Phase A → activate → committed ledger → Phase-B correlation → activated state. |
| `runtime/v2-runtime-config.mjs`, `runtime/v2-production-authority.mjs` | V2 config (explicit `LIVE_AI_03B_RUNTIME_CONTRACT_VERSION=V2`) and V2 production authority (UNPROVISIONED). |
| `probe/v2-first-text-probe.mjs` | Same probe text/digest; one send; no retry; `spendMicros ≤ 105920`; accepts only an in-process V2 receipt. |
| `reader/*` | V2 private-reader chain: observation contract, reader-only authority/host, serving runtime, authority manager, gateway caller, production entrypoint. |
| `tools/prove-gateway-source.mjs`, `tools/verify-step2-preservation.mjs` | Read-only git tools for PIN B and PIN C. |
| `tests/` | Unit / negative matrix, real-PG lifecycle (PG16 + PG18), predecessor runner, logs in `tests/out/`. |

## Future live sequence (each step needs its OWN explicit Owner authorization — none is granted here)

1. **Preserve this directory** in one reviewed commit on top of `4f390b74` (additive only). Then run
   `node tools/verify-step2-preservation.mjs --repo <clone> --commit <sha>`. This proves:
   - the commit descends from `4f390b74`;
   - it only adds files under this directory;
   - its runtime bytes equal the reviewed manifest.

   The tool emits the `Step2RuntimePreservationBindingV1` (PIN C). Until then, every V2 consumer refuses with
   `step2_runtime_pin_required_after_preservation`.
2. **Deploy the gateway from exactly `4f390b74` / tree `72080256`.** Its `server/voice-gateway` tree must be
   `2092d9de…` and must carry `service_tier:"default"`. Never deploy from `2b69ce…`.
3. **Provision the V2 production authority** out of band. It needs:
   - the independently pinned reviewer trust root;
   - restricted `live_ai_03b_executor` and `live_ai_03b_reader` connections;
   - an independent connection-identity proof and a privilege proof;
   - the V2 registry;
   - the V2 source pin (A + observed B + C).

   Today `acquireProductionAuthorityV2()` returns UNPROVISIONED.
4. **Owner applies the Step-1 SQL `01` (inactive V2 seed) and `02` (trusted_v2 successor)** on AI-STAGING.
   Run the M6 canonical verifier; it must PASS.
5. **Genuine independent reviewer approval** (a V2 envelope signed with the real reviewer key, outside this
   repo), then `runTrustedExecutorProductionV2({ approvalEnvelope, suppliedEvidence, executionId })`:
   - Phase A;
   - `activate_catalog_v2`;
   - committed ledger;
   - Phase-B correlation;
   - activated-state check.

   The result is **never** PROBE_READY.
6. **Owner arms:**
   - Step-1 `04` (policy `oneprobe-v2`, 105,920);
   - Step-1 `05` (controls epoch 1 → 2, with `-v control_updated_at=…`).
7. **Run `runPreflightV2`** on fresh armed observations plus the committed ledger and the activation receipt,
   together with the gateway, broker, env, key and gate observations. It issues a `FirstProbePreflightReceiptV2`
   **only** on a full PASS.
8. **Within 15 s, in the SAME process, call `runProbeV2`** with that receipt, the expected
   `approvalId`/`executionId`, and the staging broker transport. This is ONE send; there is no retry.
9. **Close ingress, remove the provider credential, then run Step-1 `07`** (dormant restoration, epoch 3).
   Then run `runPostflightV2` and the M6 verifier.

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
bash tests/run-all-m7s2.sh                                     # canonical aggregate (10 required checks)
bash tests/harness-fail-closed.test.sh                         # forced-failure regression for both runners
```

Both aggregate runners are **fail-closed**:
- **`run-all-m7s2.sh` exits 0 only when all 10 required checks pass.** Each check compares the child's
  **exact** exit status with its contract:
  - identity check, gateway proof and unit: 0;
  - the three fail-closed CLIs: exactly 2;
  - the reader entrypoint and serving runtime: exactly 70.

  The unit summary must read exactly `290 passed, 0 failed`. Each PostgreSQL lifecycle must really run on the right
  major version and report `60 passed, 0 failed`; a `SKIPPED`, missing binaries or a missing/partial summary is a
  FAIL. Otherwise the runner exits 1 with `RESULT: FAIL`.
- **`run-predecessor.sh` exits 0 only with 0 suite failures, 0 required-setup failures and exactly 44 suites.**
  - A fatal setup failure (output directory, copying the candidate) exits 3 immediately.
  - A failed historical 9270c282 checkout is counted as a setup failure.

`M7S2_PG18_BIN` overrides the local PG18 test-build path. It is harness configuration only, not runtime authority.
