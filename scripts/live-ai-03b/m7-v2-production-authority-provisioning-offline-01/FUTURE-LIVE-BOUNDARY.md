# Future live boundary — not authorized, not executed

Each step needs its own explicit Owner authorization. This package performs none of them.

## Order

| # | Step |
|---|---|
| 1 | WORK review of this authority candidate |
| 2 | Preservation of this package in its own reviewed commit, accepted only by the EXTERNAL review-bundle verifier (`verify-preservation-external.mjs` + `REVIEW-ANCHOR.json`, run from the bundle whose SHA-256 was recorded at closure review; README §6.1). The in-package `tools/verify-package-preservation.mjs` is a non-authoritative diagnostic. |
| 3 | Fresh read-only live target / prestate |
| 4 | Provision the restricted `live_ai_03b_executor` credential |
| 5 | Provision the restricted `live_ai_03b_reader` credential (a different credential identity) |
| 6 | Independently verify the effective role privileges (executor set of `executor-attestation.mjs`; the accepted reader set) |
| 7 | Independently bind the connection identity of BOTH clients through the independent attester |
| 8 | Provision the reviewer PUBLIC trust root |
| 9 | Compose the production provisioner (`composeProductionActivationBoundaryV2`) |
| 10 | Obtain the genuine, independent V2 approval, signed outside this repository with the real reviewer key |
| 11 | Phase A |
| 12 | Exactly one SQL 03 activation |
| 13 | Verify the committed ledger and the activated state |
| 14 | STOP before any gateway credential or deployment |

Detail for the steps that need it:

- **Step 4 — executor credential:** the role has login and none of superuser, CREATEROLE, CREATEDB, REPLICATION or
  BYPASSRLS. It holds only USAGE on the two trusted schemas and EXECUTE on the 4 functions.
- **Step 5 — reader credential:** SELECT on the 12 allow-listed tables, plus the accepted deferred ledger SELECT.
- **Step 7 — connection identity:**
  - The independent executor-attester issuer (`AiStagingExecutorAttestationV1`) is preserved at `02345082`.
  - Step 10 (offline candidate, README §7a) binds `acquireExecutorAttestationSourceV2()` to its reviewed channel
    adapter using the existing `LIVE_AI_03B_EXECUTOR_ATTESTER_*` names. The binding still needs WORK review and its
    own preservation before any live use.
- **Step 9 — composition:**
  - It opens two connections, binds both, seals both clients and validates the frozen authority.
  - The result is one `run()`.
- **Step 10 — approval:**
  - This package never signs.
  - It never holds the private key.
  - It never fabricates evidence.
- **Step 11 — Phase A:** runs inside the preserved runtime with the `ActivationSourceProofV2`. No deployed gateway is
  needed or accepted.
- **Step 12 — SQL 03:** the sealed executor client admits `activate_catalog_v2` once. There is no retry.
- **Step 13 — verification:** the preserved runtime does this itself. The result is never `PROBE_READY`.

## Never in this boundary

- a gateway deploy before SQL 03;
- SQL 04 or 05;
- a provider credential;
- a provider call;
- a gateway action;
- CORE-PROD;
- 03C.

## Forbidden in the executor authority environment (fail-closed)

The authority refuses to start if any of the following is present.

**Exact names:**
- `OPENAI_API_KEY`
- `LIVE_AI_SESSION_SIGNING_PRIVATE_KEY`
- `LIVE_AI_03B_REVIEWER_PRIVATE_KEY`
- `CORE_DATABASE_URL`
- `LIVE_AI_03B_STAGING_DATABASE_URL` (the gateway-store credential)
- `LIVE_AI_CONTROL_TOKEN_SECRET`
- `LIVE_AI_KILL_SWITCH_HMAC_SECRET`
- `LIVE_AI_IP_HASH_SALT`
- `LIVE_AI_03B_STAGING_SUBJECT_HMAC_SECRET`
- `LIVE_AI_03B_READER_TRANSPORT_SECRET`
- `DATABASE_URL`
- `DATABASE_PUBLIC_URL`
- `PGPASSWORD`
- `POSTGRES_PASSWORD`
- `PGUSER`

**Name patterns:**
- `/PRIVATE_KEY/`
- `/^OPENAI_.*(KEY|TOKEN|SECRET)/`
- `/^CORE_/`
- `/GATEWAY.*(SECRET|KEY)/`

## Secret values

Secret values are read only inside the trusted entrypoint, by the physical-connection factories at `open()` and by the
channel adapters. They are never returned, logged or placed in an error message.
