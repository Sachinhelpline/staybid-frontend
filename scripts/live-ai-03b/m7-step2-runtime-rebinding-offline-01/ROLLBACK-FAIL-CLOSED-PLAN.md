# M7 Step 2 — rollback / fail-closed plan (offline; nothing executed live)

Step 2 adds **runtime code only**. It adds no SQL, grant, role, credential or deployment. Rolling it back means
**not using it**: the directory is additive, and deleting it restores the accepted tree exactly (see
`FROZEN-FILE-HASH-PROOF.txt`). Every DB-state rollback remains the accepted Step-1 plan
(`m7-step1-…/ROLLBACK-FAIL-CLOSED-PLAN.md`: `06` / `07` restore, `09` withdraws the successor schema before any
activation).

| Situation | V2 runtime behaviour | Proven by |
|---|---|---|
| Step-2 preservation commit not yet made or verified | Every consumer (executor runtime, preflight receipt, reader production entrypoint) refuses with `step2_runtime_pin_required_after_preservation`, **before** any DB connection or attester contact | S06, PA31, PB26, EX12, RD13, RD22, A04, H01 |
| Gateway running old `2b69ce…` | `superseded_gateway_source_2b69ce_rejected`: no activation, no receipt | S04, PA30, A04 |
| Production authority not provisioned (today) | `v2_production_authority_unprovisioned` / reader `unprovisioned`, and no I/O | EX02, EX03, RD22, RD23 |
| Any V1 artifact (approval, claims, registry, read capability, receipt) | refused by contract, provenance or shape | PA32, AD10, AD02, EX11, EX21, PR04, PR12, RD11–RD12, RD20 |
| Ambiguous activation outcome (throw, or no receipt) | `uncertain:true`; the one-shot is already claimed; **no retry**. The Owner reconciles through the ledger + M6 verifier, then `06`/`07` | EX23, AD15 |
| Replay, or a second approval while V2 is active | refused by the executor one-shot **and** inside `activate_catalog_v2` (ledger unique) | EX19, B05–B07 |
| Armed-state drift (ceiling ±1, foreign active policy, V1 active, V1 expiry extended, cache-write rate, kill, obsolete policy) | Phase B fails and **no receipt ⇒ no probe** | PB01–PB13, F01–F07 |
| Probe send throws | `provider_bearing_send_failed_no_retry`; later sends refused. Close ingress first (accepted abort runbook), then `07` | N28 |
| Spend > 105,920 / more than one provider call | the probe reports `ok:false`; the postflight fails | PR16, PR18, PF01, PF02 |
| At or after `2026-10-05T15:26:23Z` | every check fails closed: HOLD for a fresh successor. T0 is not regenerated | PA36, PA37, PB27 |
| After restoration (`07`) | Phase B fails; no receipt; the probe authority is gone. A restore re-run is an idempotent no-op | G06, G07 |

Nothing in this plan deletes ledger rows, V1/V2 catalog rows or accounting evidence. CORE-PROD is never a fallback.
