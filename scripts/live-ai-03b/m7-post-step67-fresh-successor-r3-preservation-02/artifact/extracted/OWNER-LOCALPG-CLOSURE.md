# Owner Local Disposable-PostgreSQL Closure — R3

This verification is local/disposable only and must not connect to Railway or any live database.

Supported PostgreSQL server major: **16 or 18 only**. PostgreSQL 15 is deliberately refused.

For the Owner Mac where Homebrew PostgreSQL 16 is already installed:

```bash
PGBIN="/usr/local/opt/postgresql@16/bin"
M7_R1_PGBIN="$PGBIN" bash tests/run-all.sh
```

Required final marker:

`RESULT: PASS (12/12 required checks)`

Required R3 markers:

`R3_PRE_EXPIRY_SINGLE_OBSERVATION_PROVEN ...`

`R3_POST_EXPIRY_SINGLE_OBSERVATION_PROVEN ...`

`R3_FRESHNESS_REFUSAL_PROVEN ...`

`R3_ROLLBACK_PROVEN state=inactive|3|0`

`A1_R3_LOCALPG_SINGLE_OBSERVATION_INTERLEAVING_PASS ...`

The PRE marker can only come from one PostgreSQL observation row that simultaneously proves active Lock wait, exact sole blocker, distinct activation/blocker/observer PIDs, and sampled DB time strictly before expiry. The POST marker separately requires the same activation PID still blocked by the same sole blocker at/after expiry. No facts may accumulate across rows.
