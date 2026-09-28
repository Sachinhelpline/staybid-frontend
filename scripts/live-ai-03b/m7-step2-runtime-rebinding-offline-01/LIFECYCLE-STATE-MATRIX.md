# M7 Step 2 — lifecycle state matrix (what each V2 check requires)

The fields are those produced by `runtime/v2-query-registry.mjs`, read by `runtime/v2-trusted-read-adapter.mjs`, and
judged by `runtime/v2-preflight.mjs`. Values are converted **strictly**: NULL, missing, or non-integer never becomes 0.

| Field | Pre-activation (after Step-1 01+02) | Activated (after `activate_catalog_v2`) | Armed (after Owner 04+05) | Restored (after Owner 07) |
|---|---|---|---|---|
| catalog versions / entries (total) | 2 / 5 | 2 / 5 | 2 / 5 | 2 / 5 |
| active catalog versions / entries | 0 / 0 | 1 / 3 | 1 / 3 | 0 / 0 |
| V1 `…-short-v1` | inactive, digest `453f9287…`, 2 inactive entries, expiry `2026-09-25T18:37:35Z` unextended | same (historical) | same | same (never revived) |
| V2 `…-short-v2` | inactive, digest `36355fab…`, 3 inactive entries (ids, expiry, source digest bound) | **sole** active, digest `836548ef…`, 3 active entries | sole active `836548ef…` | inactive `36355fab…`, 3 entries |
| V2 rates (input / cache_write / output) | 2,000,000 / 2,500,000 / 12,000,000 per 1e6 | same | same | same |
| active policies | 0 | 0 | 1 = `oneprobe-v2` `864e2481…` (SOLE globally active) | 0 |
| policy versions | 1 (dormant) | 1 | 2 | 2 (`oneprobe-v2` restored `833e5b96…`) |
| dormant `live-ai-03b-policy-v1-dormant` `cf5ae64f…` | present, inactive | present | preserved | preserved |
| obsolete `oneprobe-v1` (89,536) / wildcard `*` policy | absent / absent | absent | absent | absent |
| seven ceilings | — | — | 5 × 105,920 + calls 1 + admissions 1 (row identity **and** values) | — |
| controls (global, project) | epoch 1, disabled, not killed, `26136eb9…` / `be70f6b4…` | epoch 1 | epoch 2, enabled, not killed, `0a60f1eb…` / `eb56f2b7…` | epoch 3, disabled, `0d2f6885…` / `d26219d1…` |
| exposure (8 accounting tables) | all 0 | — | all 0 (before the probe) | evidence retained |
| M6 ledger `approval_consumption` | no row for this approval | exactly 1 `activate` row, correlated to the receipt commitment | same | same (never deleted) |
| M6 canonical verifier | PASS | PASS | PASS | PASS |
| Gate | `runPreActivationV2` | `checkActivatedStateV2` (executor runtime) | `runPreflightV2` → issues `FirstProbePreflightReceiptV2` | `runPostflightV2`; `runPreflightV2` FAILS (no receipt ⇒ no probe) |

All four states were exercised on **real PostgreSQL 16.13 and 18.4** (`tests/v2-localpg-lifecycle.mjs`, A00–H03).
