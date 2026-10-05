# Failure and recovery matrix (future live phases)

General rule: **no automatic remediation, no auto-retry.** Any HOLD stops the sequence. The Owner and Control Room
reconcile using the receipts, then grant a NEW authorization (and a new collision-guard CLEAR) for any further
action.

| Phase | Failure | State left behind | Recovery (each step separately authorized) |
|---|---|---|---|
| P0 | any HOLD | nothing changed | Investigate; re-run P0 with a new state dir and run id. |
| P1 | blob or manifest mismatch | nothing on Railway | Re-preserve the exact reviewed bytes; never deploy an unreviewed commit. |
| P2 | spec mismatch | an empty, undeployed service exists | The Owner fixes the dashboard settings, or deletes the empty shell (Owner dashboard only; the controller has no delete builder). |
| P3 | partial write (AMBIGUOUS) | some dedicated variables staged (skip-deploys, so nothing runs) | Owner/Control-Room reconciliation of the names written (receipt). Safest: delete the dedicated service shell entirely and restart from P2 with a NEW key. A partially staged key is never reused. |
| P4 | partial write | some Authority references staged (skip-deploys) | Reconcile; the Authority is not redeployed until P5, so the staged references are inert. |
| P5 | deploy failure | the Authority runs its previous deployment or is down | Owner redeploys; P5 is re-verified with a new run. The Authority id recorded in P5 is the binding reference for P6–P8. |
| P6 | the attester exits 70 (peer not resolvable) or the deploy fails | the attester is crashed (fail closed: it serves nothing) | Confirm the Authority is up (P5), then redeploy the attester (Owner). |
| P7 | variable set or redeploy ambiguous | the executor attester may hold the new CIDR without a redeploy | Reconcile; no M5 or Authority change is involved. Rollback: restore the previous CIDR value (Owner, stdin) and redeploy the same commit. |
| P7/P8 | the Authority was redeployed after P5 | the /128 binding is stale | Restart from P7 (new peer identity) under a new authorization. |
| P8 | HOLD receipt | nothing mutated (verification only); the container lock is consumed | Diagnose from the receipt `stage` and `reason`. A new attempt requires a NEW Authority deployment (the lock is per deployment), which means P5→P7 again. |
| P8 | no receipt or ambiguous output | unknown | Treat as AMBIGUOUS; never retry automatically. |
| P9 | M5 snapshot changed | — | STOP; incident review (this package never writes M5). |

## Full rollback of the dedicated path (Owner, separately authorized)

1. Remove the 13 Authority reference variables and restore the Authority start command.
2. Delete the dedicated service.
3. Restore the executor attester's previous peer CIDRs and redeploy the same commit.

M5 and the database are untouched by design, so they need no rollback.
