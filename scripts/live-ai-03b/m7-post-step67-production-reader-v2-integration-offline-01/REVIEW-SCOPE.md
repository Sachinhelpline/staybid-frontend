# WORK v2 — OFFLINE IMPLEMENTATION CANDIDATE REVIEW

Review only this offline candidate.

Do not implement.
Do not write GitHub.
Do not mutate Railway.
Do not access or mutate DB.
Do not restart/redeploy.
Do not run Phase A / SQL03 / G4 / G5.

## Required independent checks

1. Integrity of the ZIP and manifest.
2. Production runtime change boundary is exactly the reviewed three files.
3. `provisioning-config.mjs` uses the accepted deployment-anchor parser and private Railway destination rule correctly.
4. `production-entrypoint.mjs` has no production reader-v1 fallback and reuses the frozen v2 acquisition.
5. `readerAttestationProvider` accepts the exact existing reader session and does not open another DB connection.
6. `provisioner.mjs` passes the exact `rdS.session`, uses provider nonce unchanged, and opens exactly one reader physical connection.
7. Executor path remains materially unchanged.
8. `role-binding.mjs`, guarded clients, reader session primitives, frozen v2 acquisition, accepted v2 dependencies and frozen Step-2 runtime remain unchanged.
9. The final 45-case suite is meaningful and passes 45/45.
10. The pre-freeze anchor-reason remediation is correctly incorporated.
11. No secret logging/env dump, no v1 fallback, no reconnect/retry, no live hooks.
12. Candidate source identities match bytes.

## Required verdict

Return exactly one:

`ACCEPTED_OFFLINE_IMPLEMENTATION_CANDIDATE_READY_FOR_FREEZE`

or

`MATERIAL_IMPLEMENTATION_BLOCKER_HOLD`

If accepted, explicitly confirm:
- 3-file runtime boundary;
- 45/45 final test pass;
- same-session/one-reader-connection property;
- frozen byte/import closure preservation;
- no live authorization is granted.

If HOLD:
identify only the genuine material implementation blocker.
Do not create an automatic remediation chain.
