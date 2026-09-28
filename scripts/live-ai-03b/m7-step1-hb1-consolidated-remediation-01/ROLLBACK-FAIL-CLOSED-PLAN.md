# M7 Step 1 — Rollback / fail-closed plan (offline; nothing executed)

Two principles apply throughout:
- **Authority always moves toward dormant.** Every step either fails before any change or completes atomically.
- **Evidence is never deleted.** No step deletes ledger rows, V1/V2 catalog rows, or accounting rows.

| Situation | Behaviour | Proven by |
|---|---|---|
| `01` seed precondition mismatch: V1 not byte-exact, an old 89,536 policy present, anything active, V2 already present, or accounting not empty | Raises, then `ROLLBACK`. Nothing is inserted. | `m7-localpg` §1 (re-run create-once) and the precheck code |
| `02` precondition mismatch: M6 boundary absent or changed, successor already present | Raises, then `ROLLBACK` | `m7-localpg` §1 |
| Successor must be withdrawn **before** any activation | `09`: drops only `live_ai_03b_trusted_v2` and its 2 functions. M6, the ledger and the catalog rows are untouched. The inert inactive V2 seed stays and expires on its own. | `m7-localpg` §13 |
| Successor withdrawal requested **after** a V2 approval was consumed | `09` refuses (HOLD). Use restoration (`06`/`07`). The trusted boundary is never removed while its evidence is live. | `m7-localpg` §13 |
| Activation claims invalid: wrong contract or key set, arbitrary ID or digest, old policy, non-default tier, batch, flex, regional, long context, wrong rate, CORE-PROD target, windows | Raises. Ledger not consumed; catalog unchanged. | `m7-localpg` §4 (20 cases) |
| Pre-state not exact: missing or altered cache-write row, wrong rates or unit, duplicate or extra entry, another active catalog, V1 active or extended, digest tamper, active policy, controls not dormant | Raises (whole transaction rolled back) | `m7-localpg` §5 (13 cases) |
| Failure after the ledger consume, or mid-transition | Whole transaction rolled back: ledger row absent, V2 inactive, approval still unused | `m7-localpg` §6 |
| DB clock ≥ V2 expiry, or < T0 | Raises at the mutation boundary: "HOLD for a fresh successor" | `m7-localpg` §12 |
| Replay, or a second approval while V2 is active | Raises. Single authority remains. | `m7-localpg` §7 |
| Policy `04`: obsolete 89,536 policy present, create-once violated, V1 not historical | Raises | `m7-localpg` §8 |
| Control `05`: tampered ceiling, more than one active policy, V1 also active, anything other than the exact V2 active shape | Raises. Controls stay disabled. | `m7-localpg` §8 |
| Restore from the exact active state | `07` (Owner) or `06` (executor) returns V2 to the exact reviewed inactive digest. V1 is never revived; accounting and ledger are preserved. | `m7-localpg` §9–§10 |
| Restore re-run | Idempotent no-op (`already restored` / `already_restored`) | `m7-localpg` §9–§10 |
| Restore from a mixed or ambiguous state | Raises (HOLD). No ledger consumption. | `m7-localpg` §10 |
| Provider/gateway ingress during an abort | Close ingress FIRST (accepted `ABORT-ROLLBACK-RUNBOOK.md`: broker off, then text gate off, then remove key), then restoration SQL | Accepted runbook (unchanged) |

What stays out of reach of rollback:
- `live_ai_03b_trusted.approval_consumption` rows are never deleted.
- Accepted M6 objects are never modified.
- CORE-PROD is never a fallback.
