# Independent Review HOLD that triggered Remediation R3

The R2 independent closure review matched the exact R2 ZIP/manifest and kept prior source-level acceptance of the A1 production SQL and A2 successor attestation architecture closed.

One A-class harness/evidence blocker remained:

`HOLD_FRESH_SUCCESSOR_R2_LOCK_WAIT_REGRESSION_INTERLEAVING_NOT_PROVEN`

The reviewer reproduced that R2's `PRE_VALID`, `LOCK_WAIT`, and `EXACT_BLOCKER` flags were sticky across polling observations. A pre-expiry row that was not blocked and a later after-expiry row that was blocked could combine into a false `R2_PRE_EXPIRY_LOCK_WAIT_PROVEN` result.

R3 is harness/evidence only. It removes accumulated proof state. A PRE proof can exist only when one single PostgreSQL observation row simultaneously proves the complete pre-expiry active/Lock/exact-blocker/distinct-backend conjunction. POST proof is separately required from one single at/after-expiry row for the same activation PID and same exact blocker PID.

Production V3 SQL/runtime/approval, Executor Attestation V2, pricing/catalog identities, and frozen predecessors are not modified by R3.
