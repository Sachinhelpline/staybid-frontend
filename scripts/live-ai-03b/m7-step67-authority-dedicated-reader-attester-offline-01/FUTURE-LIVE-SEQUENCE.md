# Future live sequence P0–P9 (DESIGN ONLY: nothing here has been executed)

Each phase that can change external state needs **its own fresh, exact Owner authorization** plus a Programme
Collision Guard V1 result of `CLEAR_OF_RECORDED_COLLISION` for **that phase's** actionId. CLEAR is a precondition,
never authorization. The controller runs dry by default. `--execute` refuses unless:

- `--owner-authorization-ref` is present;
- `--confirm-action-id` equals the phase actionId;
- `--collision-guard-result` is a CLEAR result for the same actionId.

The controller then creates `PX.attempt-started` (O_EXCL) **before** its first external call and writes
`PX.receipt.json` exactly once. There is **no auto-retry**: a marker without a receipt is AMBIGUOUS and needs
Owner/Control-Room reconciliation.

## Owner-Mac shell hygiene (every phase)

```sh
set +x; umask 077; unset HISTFILE; set +o history 2>/dev/null; ulimit -c 0
STATE="$(mktemp -d)"; trap 'rm -rf -- "${STATE:?}"' EXIT   # only after the receipts were copied to the Control Room
C=scripts/live-ai-03b/m7-step67-authority-dedicated-reader-attester-offline-01/controller/step67-controller.mjs
```

Never run `railway variables` (it prints values), `env`, `printenv`, `set -x`, or any command that echoes a
value. No secret ever appears in argv, shell history, chat, receipts, logs or a handoff file. The only two
generated secrets (P3) exist in the controller's memory, go to `railway variable set NAME --stdin`, and are gone
when the process exits.

| Phase | actionId | Class | Actor | What happens | Success / stop |
|---|---|---|---|---|---|
| **P0** | `M7-STEP6-7-P0-READ-ONLY-PRESTATE` | READ_ONLY | controller | `railway --version`, `whoami`, one names-only GraphQL document (no value field). Records the M5 snapshot (deployment ids and variable NAMES), the executor attester deployment and commit, and the Authority names. | HOLD if the dedicated service already exists, the executor commit or deployment ≠ pin, the M5 attester deployment ≠ pin, any public domain or TCP proxy exists, the Authority holds a forbidden name, or any Step6/7 name is already present. |
| **P1** | `M7-STEP6-7-P1-GIT-PRESERVATION` | PROGRAMME_PHASE | Owner git push → controller verify | The Owner commits THIS package to the designated branch. The controller then verifies that every manifest file (package plus accepted dependencies) has the manifest's git blob at `--reviewed-commit`. | HOLD on a manifest sha mismatch or any blob mismatch. |
| **P2** | `M7-STEP6-7-P2-DEDICATED-SERVICE-SHELL` | RAILWAY_SERVICE_CONFIG | Owner dashboard → controller verify | The Owner creates `live-ai-03b-authority-reader-attester` in AI-STAGING with: source = the P1 commit; root `/`; build `echo no-build`; start = the accepted attester entrypoint; 1 replica; **no domain, no TCP proxy, not deployed, no variables**. | HOLD on any spec mismatch, an id collision with a pinned service, or an M5 snapshot change. |
| **P3** | `M7-STEP6-7-P3-DEDICATED-ATTESTER-VARIABLES` | RAILWAY_SERVICE_VARIABLE | controller | Generates the NEW Ed25519 key and NEW channel secret in memory (self-checked by the accepted signer, distinct from the M5 and executor public pins). Writes 13 names with `railway variable set NAME --stdin --skip-deploys`: references and public values first, the two secrets last. CLI stdout is discarded. | HOLD (AMBIGUOUS) on a partial write: the receipt lists the names written. Records the public issuer and fingerprint (the future P8 pin). |
| **P4** | `M7-STEP6-7-P4-AUTHORITY-CALLER-REFERENCES` | RAILWAY_SERVICE_VARIABLE | controller | Writes 13 single-level reference expressions to the Authority (6 executor-attester, 6 dedicated-attester, 1 anchor). The 2 DB references already exist and are never touched. | HOLD if a forbidden name appears, a name already exists, or there is a partial write. |
| **P5** | `M7-STEP6-7-P5-AUTHORITY-STANDBY-DEPLOY` | DEPLOYMENT | Owner dashboard → controller verify | The Owner sets the Authority start command to the standby entrypoint and deploys the P1 commit. | HOLD on spec, commit or privacy mismatch, or if not redeployed. Records the Authority deployment id. |
| **P6** | `M7-STEP6-7-P6-DEDICATED-ATTESTER-DEPLOY` | DEPLOYMENT | Owner dashboard → controller verify | The Owner deploys the dedicated attester. It resolves the Authority as its sole peer at boot. | HOLD if the Authority changed since P5, or on a spec, commit or privacy mismatch. |
| **P7** | `M7-STEP6-7-P7-EXECUTOR-PEER-BINDING` | COMPOSITE | controller | `railway ssh … -s <authority> -- node …/authority-peer-identity.mjs` returns the exact /128. The controller re-validates it with the accepted resolver, then sets `LIVE_AI_03B_EXECUTOR_ATTESTER_ALLOWED_PEER_CIDRS` (stdin) and redeploys the executor attester from the same commit. | HOLD on a public, broad or unparsable address, or if the Authority or dedicated attester was redeployed. The redeploy must be SUCCESS with the commit unchanged. |
| **P8** | `M7-STEP6-7-EFFECTIVE-PRIVILEGE-DUAL-IDENTITY-BINDING` | READ_ONLY (authorized) | controller | `railway ssh … -- node …/step67-verification-entrypoint.mjs --run-id … <3 public pins from P3>`. **One attempt per Authority deployment** (O_EXCL lock in the container plus the Owner marker). | Exactly one `STEP67_RECEIPT` line, leak-guarded, bound to the run id and pins, with consistent exit and marker. PASS ⇒ `M7_STEP6_7_AUTHORITY_HOST_EFFECTIVE_PRIVILEGE_DUAL_BINDING_PASS_READY_FOR_REVIEWER_TRUST_ROOT`. |
| **P9** | `M7-STEP6-7-P9-READ-ONLY-POSTVERIFY` | READ_ONLY | controller | Checks the M5 snapshot equals P0, everything is private-only, and there are no forbidden names on the Authority. | HOLD on any difference. |

Example (P3, after a fresh authorization):

```sh
node "$C" --phase P3 --state-dir "$STATE" --run-id step67-p3-0001 --execute \
  --owner-authorization-ref OWNER-AUTH-STEP67-P3-<ref> --confirm-action-id M7-STEP6-7-P3-DEDICATED-ATTESTER-VARIABLES \
  --collision-guard-result ./p3-collision.json \
  --m5-reader-attester-fingerprint <public hex64> --executor-attester-fingerprint <public hex64>
```

## Never, in any phase

- `ALTER ROLE live_ai_03b_reader PASSWORD` / `ALTER ROLE live_ai_03b_executor PASSWORD`;
- credential rotation;
- Step11B replay or M4 replay;
- SQL03 or Phase A;
- the gateway or a provider;
- CORE-PROD `04c8b523…` / `1fbd7632…`;
- any change to the M5 reader host `88c74a23…` or the M5 attester `3a7e5f80…`;
- a variable delete;
- a public domain or TCP proxy.

## After P8 PASS (not part of this package)

The receipt goes to the reviewer trust root. Before the production provisioner or Phase A, the
**MANDATORY LATER PRODUCTION-COMPOSITION INTEGRATION ITEM** (production Authority reader caller v1 → v2) must be
designed, reviewed and separately authorized. The B item (the stale comment in the frozen
`executor-attestation.mjs` header) is recorded only.
