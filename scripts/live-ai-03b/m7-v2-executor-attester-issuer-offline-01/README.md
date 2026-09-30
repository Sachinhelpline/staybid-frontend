# M7 V2 — executor attestation issuer (offline candidate 01, remediation R1)

**Status:** this is an offline preparation candidate. Nothing here is deployed, provisioned or bound, and nothing has
signed a real attestation.

The package is the missing upstream capability behind the preserved production authority. That authority package
(`m7-v2-production-authority-provisioning-offline-01`, tree `c22ca7cf`) verifies `AiStagingExecutorAttestationV1` but
has no issuer. Its `acquireExecutorAttestationSourceV2()` still returns `executor_attestation_source_unprovisioned`,
and this candidate does not change that.

| Field | Value |
|---|---|
| Baseline | `dcab7c5b8884db4826d3fc9188ae042a1ed298d6` (tree `c5b2bb3a…`) |
| Corrected PIN C | `0afe4b6b`, Step-2 tree `bacac441` |
| Frozen packages modified | none |

**R1 (one consolidated remediation of the two Control Room findings):**
1. **External verifier silent exit 0** — fixed in the external review bundle (not in this package): no is-main guard,
   an explicit machine-readable verdict, and an exit guard that makes a no-verdict exit 0 impossible (§9).
2. **Privilege coverage gap** — every independently grantable PostgreSQL 16/18 authority class is now measured by a
   catch-all with a fixed allowlist, and any widening folds into the existing signed field
   `publicOrDefaultPrivilegeWidening=true` (§4a). The attestation payload and the preserved
   `verifyExecutorAttestation` are unchanged.

## 1. Separate authority plane

It is a new, separate service. The accepted reader attester (`private-reader-attester-offline-01`) is not modified,
and the executor issuer shares no secret with it.

| | Reader attester (accepted, unchanged) | Executor issuer (this package) |
|---|---|---|
| Contract | `AiStagingReaderAttestationV1` | `AiStagingExecutorAttestationV1` (the preserved verifier's contract) |
| Issuer | `LIVE_AI_03B_ATTESTER_ISSUER` | `LIVE_AI_03B_EXECUTOR_ATTESTER_ISSUER` — must differ from the reader issuer |
| Signing key | `LIVE_AI_03B_ATTESTER_SIGNING_KEY_PKCS8_B64` | `LIVE_AI_03B_EXECUTOR_ATTESTER_SIGNING_KEY_PKCS8_B64` — fingerprint must differ from the reader's |
| Channel | `reader-attestation-channel-v1` / op `attest` | `executor-attestation-channel-v1` / op `attest-executor` |
| Channel secret | `LIVE_AI_03B_READER_ATTESTER_CHANNEL_SECRET` | `LIVE_AI_03B_EXECUTOR_ATTESTER_CHANNEL_SECRET` (the reader secret is refused in this env) |
| Observer credential | `LIVE_AI_03B_ATTESTER_OBSERVER_DB_URL` | `LIVE_AI_03B_EXECUTOR_ATTESTER_OBSERVER_DB_URL` (the reader's is refused in this env) |
| Deployment anchor | `AiStagingDeploymentAnchorV1` | `AiStagingExecutorDeploymentAnchorV1` (a reader anchor is refused) |

The names the preserved authority already expects are imported from it and reused unchanged:
- `LIVE_AI_03B_EXECUTOR_ATTESTER_ISSUER`
- `LIVE_AI_03B_EXECUTOR_ATTESTER_PUBKEY_DER_B64`
- `LIVE_AI_03B_EXECUTOR_ATTESTER_FINGERPRINT`
- `LIVE_AI_03B_EXECUTOR_ATTESTER_PORT`
- `LIVE_AI_03B_EXECUTOR_ATTESTER_CHANNEL_SECRET`

`…_HOST` is the authority-side destination; the service binds its own `…_BIND_HOST`.

## 2. Modules (`src/`)

| Module | Role |
|---|---|
| `executor-attester-config.mjs` | Static, fail-closed config (no I/O). Details below the table. |
| `executor-target-binding.mjs` | The executor anchor: an Owner-verified AI-STAGING target plus a cluster fingerprint over the database, database oid, executor role oid and encoding. CORE-PROD and non-AI-STAGING targets are refused; a TEST-ONLY anchor is refused in production. |
| `executor-evidence-queries.mjs` | The fixed evidence registry (§4). |
| `executor-evidence-evaluator.mjs` | Measures and evaluates the evidence. It emits exactly the preserved `EXECUTOR_PRIVILEGE_KEYS` and refuses any non-clean state. |
| `executor-observer.mjs` | One least-privilege observer connection (timeout and read-only set and read back) plus a bounded, lifecycle-aware coordinator, adapted 1:1 from the accepted reader design. |
| `executor-signing-adapter.mjs` | Builds and signs the exact payload from measured evidence, using the accepted canonicalize and Ed25519. The key must equal the configured public identity and differ from the reader key. |
| `executor-attestation-server.mjs` | The channel server. It re-verifies every envelope with the preserved `verifyExecutorAttestation` before release (the conformance gate). |
| `executor-attestation-channel.mjs` | A client exposing the exact `obtain({contract, connectionToken, role, requestNonce})` shape the preserved provisioner calls. It is not wired in; that is the future authority-binding step. |
| `executor-attester-entrypoint.mjs` | The production-like entrypoint: static validation, then the first I/O (the observer), then the channel. CLI exit 70 when unprovisioned. |

`executor-attester-config.mjs` refuses:
- foreign credentials, by exact name and by pattern;
- missing required names;
- a TEST-ONLY issuer in production;
- an issuer or fingerprint equal to the reader attester's;
- a short channel secret;
- a non-private listener;
- an invalid proof lifetime;
- an invalid anchor.

## 3. Attestation contract (issuer conforms to the preserved verifier)

The payload keys are exactly:
- `connection`, `contract`, `domain`, `expiresAtMs`, `issuedAtMs`, `issuer`, `keyId`, `privileges`, `requestNonce`,
  `target`;
- `target` is `{environmentId, pgServiceId, projectId}`;
- `connection` is `{role: "live_ai_03b_executor", token}`.

The privilege fields are exactly the preserved `EXECUTOR_PRIVILEGE_KEYS`. Proof:
- tests A01–A12 run the preserved verifier and the preserved `bindExecutorConnection`;
- the real-PostgreSQL suite repeats this on PostgreSQL 16 and 18;
- the server's conformance gate refuses to release anything the preserved verifier would reject (E23).

## 4. Measured executor privilege model

**Signed only when exactly this state is measured:**

| Field | Required value |
|---|---|
| `currentUser`, `sessionUser` | `live_ai_03b_executor` |
| `rolsuper`, `rolcreaterole`, `rolcreatedb`, `rolreplication`, `rolbypassrls` | all `false` |
| `roleMemberships`, `schemaCreate` | `[]` |
| `budgetTablePrivilegeCount`, `ledgerPrivilegeCount` | `0` |
| `trustedSchemaUsage` | exactly `live_ai_03b_trusted` and `live_ai_03b_trusted_v2` |
| `executableRoutines` | exactly the 4 routines |
| `unapprovedRoutineExecute`, `publicOrDefaultPrivilegeWidening` | `false` |

**How each is measured, over every user schema:**
- **Routines:** every routine the executor can EXECUTE, as `name(argtypes)`.
- **Relations:** table privileges and column privileges (`has_any_column_privilege`) on every relation; sequences;
  MAINTAIN on PostgreSQL 17+. These are split into trusted-schema ("ledger") versus other ("budget/state").
- **Schemas:** USAGE, CREATE and ownership.
- **Database:** CREATE and ownership, and objects owned by the executor.
- **Memberships:** the recursive closure, plus prohibited-role reachability.
- **Widening:**
  - PUBLIC relation grants;
  - PUBLIC trusted-schema grants and PUBLIC CREATE;
  - PUBLIC-executable trusted routines (a NULL ACL counts);
  - default-ACL entries granting to PUBLIC or to the executor.

**Also refused, though not signed fields:**
- USAGE on any schema other than the two trusted schemas and `public` (PostgreSQL's PUBLIC default);
- database CREATE or ownership, and any owned object;
- a missing reviewed object (schema drift).

**`currentUser`:** another backend's `current_user` is not observable. It is signed as the executor only when
proven: the session user is the executor, there are no memberships (so SET ROLE is impossible) and it is not a
superuser. Otherwise the value is `unproven` and nothing is signed.

The accepted post-Step-1 state, built from the frozen migrations on throwaway PostgreSQL 16.13 and 18.4, measures
clean. Every real drift case is refused. When a drifted state is force-signed, the preserved verifier rejects it
with the matching `executor_drift_*` code.

## 4a. Catch-all privilege coverage (R1)

R1 replaces "enumerate the classes we thought of" with four layers that fail closed on anything unreviewed:

1. **Version gate.** The server major must be 16 or 18 (`server_version_num`). Anything else is refused as
   `server_version_unsupported`, because the catalog and privilege model differ between majors.
2. **Coverage self-check.** The set of every `aclitem[]` column in `pg_catalog` (14 on PostgreSQL 16 and 18:
   `pg_attribute.attacl`, `pg_class.relacl`, `pg_database.datacl`, `pg_default_acl.defaclacl`,
   `pg_foreign_data_wrapper.fdwacl`, `pg_foreign_server.srvacl`, `pg_init_privs.initprivs`, `pg_language.lanacl`,
   `pg_largeobject_metadata.lomacl`, `pg_namespace.nspacl`, `pg_parameter_acl.paracl`, `pg_proc.proacl`,
   `pg_tablespace.spcacl`, `pg_type.typacl`) must equal the reviewed list exactly. A new or missing grantable class
   is refused as `privilege_class_coverage_incomplete`.
3. **Every direct grant or ownership held by the executor, in any database or on a shared object.** PostgreSQL
   records these in the shared catalog `pg_shdepend`. The only allowed rows are the 6 ACL rows of the accepted state
   (USAGE on the 2 trusted schemas, EXECUTE on the 4 routines, in this database) plus CONNECT/TEMPORARY on this
   database. Anything else is a finding: an owner row (`o`), a policy (`r`), an init-privs row (`i`), any object
   class other than schema/routine/database, a grant in another database, or a shared object (tablespace,
   parameter, database).
4. **PUBLIC and built-in drift, and effective checks.** For every class that PUBLIC can be granted:
   - ACLs on built-in objects are compared with their `pg_init_privs` or `acldefault()` baseline;
   - user objects are checked for any PUBLIC entry;
   - the executor's effective privileges are checked with `has_*_privilege` (reaching grants through PUBLIC and
     memberships);
   - ownership is counted across all 23 owner catalogs.

**Classes now measured (each proven by a real drift on PostgreSQL 16.13 and 18.4):**
- large objects: SELECT, UPDATE, PUBLIC grants, ownership;
- foreign-data-wrapper USAGE (direct and PUBLIC);
- foreign-server USAGE (direct and PUBLIC), user mappings (executor and PUBLIC), server ownership;
- tablespace CREATE (direct and PUBLIC);
- parameter SET and ALTER SYSTEM (direct and PUBLIC);
- `lo_compat_privileges` (cluster and per-database setting);
- type and domain USAGE (including re-granting a type whose PUBLIC USAGE was revoked);
- language USAGE;
- built-in catalog relation and routine ACLs (e.g. SELECT on `pg_authid`, EXECUTE on `pg_read_file`/`pg_ls_dir`);
- CREATE on `pg_catalog` or any schema;
- CREATE or CONNECT on another database, and grants inside another database;
- per-role settings, policies, and ownership of collations, text-search objects and every other owned class.

Every finding folds into the signed field `publicOrDefaultPrivilegeWidening=true` (ownership findings also refuse as
`drift_owner_or_database_authority`). A force-signed drifted copy is rejected by the preserved verifier as
`executor_drift_public_or_default_widening`.

**Ambient built-ins deliberately not flagged (each bounded):**

| Class | Why it is safe to ignore |
|---|---|
| USAGE on untrusted languages `c` and `internal` | These come from `acldefault()`, but creating a function in an untrusted language is superuser-only. `rolsuper=false` is signed and verified. |
| PUBLIC defaults on built-ins | These are exactly the `pg_init_privs`/`acldefault()` baseline and include EXECUTE on built-in functions, USAGE on built-in types and languages, SELECT on `pg_catalog` views, and CONNECT/TEMPORARY on databases. Only a deviation from the baseline is flagged. |
| SELECT on `information_schema` relations | PUBLIC SELECT is the shipped state. Any other privilege on `information_schema` is flagged. |
| USAGE on the `public` schema | This is PostgreSQL's PUBLIC default. PUBLIC CREATE on any schema, and executor CREATE, are flagged. |
| CONNECT/TEMPORARY on this database | The executor must connect. CONNECT on any other database is flagged. |

## 5. Observer capability model (no new privilege)

The observer is a least-privilege role:
- `LOGIN INHERIT`, not superuser, no CREATE*, REPLICATION or BYPASSRLS;
- exactly the membership `pg_read_all_stats`, which is needed because `backend_start` is otherwise NULL;
- CONNECT on the database;
- nothing else.

That is the same capability class as the accepted reader observer, and no observer privilege is widened. A distinct
role is proposed in `executor-observer-role-proposal.sql`. It is guarded and not applied; its body is proven
sufficient on real PostgreSQL. The shared accepted observer is also proven sufficient, but is documented only as a
future option (§8).

Existence checks use a pure catalog lookup, because `to_regclass()` raises for an observer without schema USAGE
(found and verified on real PostgreSQL). The issuer refuses to run as:
- a superuser, the executor or the reader;
- a member of the executor or reader;
- an observer with any membership other than exactly `pg_read_all_stats`, or with elevated attributes;
- an observer whose current role differs from its session role.

The attester holds only three secrets: its observer credential, its signing key and its channel secret.
Executor, reader, gateway-store, provider, reviewer, CORE and reader-attester secrets are all refused.

## 6. Request / channel model

`executor-attestation-channel-v1` is one newline-terminated JSON request per connection. Its authentication:
- HMAC-SHA256 over `v⏎op⏎JSON(args)⏎nonce⏎ts`, with the executor channel secret;
- freshness within ±30 s;
- single-use nonces;
- a peer allowlist.

**What the request may carry:** exactly `{connectionToken, contract, requestNonce, role}` with the executor contract
and role.

**Refused as `bad_request`:**
- privileges, target, issuer, keyId or public key;
- expiry;
- SQL or a DB URL;
- expected privileges or a signing key.

**Other refusals:** a reader-channel request gets `unsupported_version`. The accepted reader attester refuses the
executor channel (E26), and the accepted reader client refuses an executor request (E27).

**How the token is handled:** the requester's connection token only selects which session to attest. The issuer
re-derives the token from its own `pg_stat_activity` observation using the preserved `executorConnectionTokenFor`.
It refuses when:
- no session matches, or more than one matches;
- the role is wrong;
- `backend_start` is invisible;
- the application name is empty or not the executor prefix;
- the database is wrong.

## 7. Signing / freshness model

- `issuedAtMs` comes from the issuer's host clock, which must agree with the database clock within 5 s (the
  preserved verifier's forward tolerance) or it refuses. Expiry is `issuedAtMs + lifetime`, where the lifetime is
  at most the preserved `ATTESTATION_MAX_LIFETIME_MS` (default 120 s).
- No caller time and no caller expiry are accepted.
- TEST-ONLY issuers, anchors, signers and loopback listeners exist only behind the offline test boundary. Production
  refuses them and refuses every test-injection option.

## 8. Residual limitations (honest)

- **Target binding needs an Owner-verified anchor.** Nothing in PostgreSQL names a Railway service. The Owner must
  issue `AiStagingExecutorDeploymentAnchorV1` after verifying the fingerprint against service `b7362594-…`.
- **Single replica only.** Replay protection is in memory, so the service must run as one replica.
- **Catch-all is bounded by the reviewed catalog model.** Coverage relies on the PostgreSQL 16/18 catalogs
  (`pg_shdepend` and the 14 ACL columns). A future major, or a new ACL column, is refused rather than guessed. Grants
  made only through `pg_hba.conf`, row-level security predicates, or superuser-only mechanisms are outside SQL
  privilege measurement. These are bounded by the signed `rolsuper=false` and by the absence of memberships.
- **Other databases are measured through the shared catalog only.** A grant in another database is detected through
  `pg_shdepend`, and CONNECT on it is refused. That database's PUBLIC ACLs are not inspected, because the executor
  cannot connect to it.
- **Strict routine semantics.** Any PUBLIC-executable routine in a user schema (for example, an extension installed
  into `public`) makes the issuer refuse. This is fail-closed. Resolving it would need a separately reviewed REVOKE,
  never a looser check.
- **Unproven on the live database.** Tested on PostgreSQL 16.13 and 18.4 throwaway clusters only; no live database
  was touched.
- **Shared observer role.** The shared reader-attester observer role is technically sufficient without widening, but
  a distinct role is recommended so that credential custody is separate.

## 9. Preservation identity

`identity/PACKAGE-CONTENT-MANIFEST.json` and `tools/package-identity.mjs` are **non-authoritative diagnostics**. They
live inside the package a future preservation commit would add, so they cannot certify it.

The **authoritative** preservation check is the external review bundle: `REVIEW-ANCHOR.json`, the CLI
`verify-preservation-external.mjs` and its library `verifier-lib.mjs`. It is kept outside the target commit and
identified by the independently recorded bundle SHA-256.

R1 changes the verifier's exit discipline:
- `main()` always runs; there is no is-main guard.
- Every outcome is one JSON verdict with `verification_executed` and `result` =
  `M7V2_EXECUTOR_ATTESTER_PRESERVATION_ACCEPTED` / `…_REJECTED` / `…_REFUSED_BEFORE_VERIFICATION`.
- An exit 0 without an emitted ACCEPTED verdict is forced to 3.

A caller must require both exit 0 **and** `result === …_ACCEPTED`.

## 10. Running the offline evidence

```
node tests/executor-attester.test.mjs                        # focused (synthetic observer, loopback channel)
node tests/localpg/executor-attester-localpg.test.mjs         # real PostgreSQL (M7EA_PGBIN=<pg18 bin> for 18)
bash tests/run-all.sh                                         # 15 required checks incl. frozen predecessors
```

See `FUTURE-LIVE-SEQUENCE.md` for the future live order and `DEPENDENCY-MAP.md` for the exact frozen imports.
