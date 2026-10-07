# M7 POST-STEP67 — Fresh Pricing / Catalog Successor 01 — Remediation R3

**Build-sandbox status:** `HOLD_PENDING_REAL_PG16_OR_PG18_R3_SINGLE_OBSERVATION_RUN`.

R3 closes only the R2 independent-review proof-composition defect. Production V3 SQL/runtime/approval, Executor Attestation V2, pricing/catalog facts/digests, and frozen predecessors are byte-for-byte preserved from the R2 candidate.

## R3 single-observation proof rule

`tests/localpg-expiry-lock-regression.sh` no longer accumulates independent Boolean facts across polling iterations.

A PRE proof exists only if **one MATERIALIZED control-query row** simultaneously establishes:

1. activation backend B exact PID;
2. blocker backend A exact PID;
3. observer PID distinct from A and B;
4. B is `active`;
5. B has `wait_event_type='Lock'`;
6. `pg_blocking_pids(B)` contains exact A and has cardinality exactly 1;
7. the single sampled PostgreSQL `clock_timestamp()` is strictly before expiry.

A separate POST proof must then establish in **one MATERIALIZED row** that the same B is still actively Lock-waiting on the same sole A with the sampled PostgreSQL clock at or after the same expiry. Only after POST proof may A be released.

After release, activation must fail with the exact expected `activate_v3: mutation-boundary freshness failed` path and final committed state must be exactly `inactive|3|0`.

## Exact R2 defect negative regression

`tests/interleaving-proof-gate.test.sh` includes the WORK-reproduced split-observation case:

- pre-expiry but not blocked row;
- later after-expiry exact-blocked row.

Both rows are independently refused as PRE proof, and they cannot compose into a completion PASS. The suite also retains already-expired, never-blocked, wrong-blocker, multiple-blocker, same-backend, observer-collision, early-release, wrong-activation, unrelated-error, and dirty-rollback refusals.

## Required owner/local closure

PostgreSQL 16 or 18 is mandatory. This build sandbox has no PostgreSQL server binaries, so real R3 local-PG execution remains UNKNOWN/HOLD here.

A supported run must end with:

`RESULT: PASS (12/12 required checks)`

and print:

- `R3_PRE_EXPIRY_SINGLE_OBSERVATION_PROVEN ...`
- `R3_POST_EXPIRY_SINGLE_OBSERVATION_PROVEN ...`
- `R3_FRESHNESS_REFUSAL_PROVEN ...`
- `R3_ROLLBACK_PROVEN state=inactive|3|0`
- `A1_R3_LOCALPG_SINGLE_OBSERVATION_INTERLEAVING_PASS ...`

Missing either single-row proof is FAIL/HOLD, never PASS.

## Live-action status

R3 performed no Railway write, GitHub write, live DB connection, live SQL, SQL03, composition `.run()`, provider call, approval signing, restart, redeploy, G4, G5, gateway action, or CORE-PROD action.
