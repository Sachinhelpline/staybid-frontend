# Future live sequence — documentation only, NOT executed, NOT authorized

Each step needs its own explicit Owner authorization. This candidate performs none of them. The preferred topology is
a new, separate service (for example `live-ai-03b-executor-attester`), distinct from `live-ai-03b-reader-attester`,
which is not modified.

## Order

| # | Step | Gate |
|---|---|---|
| 1 | Preserve this issuer candidate in its own reviewed commit on top of `dcab7c5b` | Accepted only by the external review-bundle verifier, run from the bundle whose SHA-256 was recorded at closure review |
| 2 | Decide the future service identity and topology: a new private Railway service in the AI-STAGING project `4ad1abb3-…` / environment `aa397bd7-…`, single replica, private network only | Owner decision |
| 3 | Generate and provision a distinct Ed25519 signing key (PKCS#8, in the service's own secret custody). Record its public DER and fingerprint as non-secret identity | Its fingerprint must differ from the reader attester's |
| 4 | Provision a distinct executor-attester channel secret (at least 32 characters) | Never the reader channel secret |
| 5 | Provision the least-privilege observer credential | `executor-observer-role-proposal.sql` is applied only under a separate DB-change authorization. The shared accepted observer is an alternative documented option |
| 6 | Configure the private network: bind host, peer CIDR allowlist of the future authority host, port | Private addresses only |
| 7 | Issue the executor deployment anchor | See the detail below the table |
| 8 | Deploy the service (source pinned to the preserved commit) | Separate deploy authorization |
| 9 | Independently verify health and source | See the detail below the table |
| 10 | Prepare the narrow authority-binding change | See the detail below the table |
| 11 | Later: live authority provisioning, then Phase A, then SQL 03, per the preserved authority's `FUTURE-LIVE-BOUNDARY.md` | Separate authorizations; stop before the gateway |

Detail for the steps that need it:
- **Step 7 — anchor:**
  - The Owner verifies the cluster fingerprint (database, database oid, executor role oid, encoding) against
    Railway service `b7362594-…`.
  - The Owner then issues `AiStagingExecutorDeploymentAnchorV1`.
  - CORE-PROD (`04c8b523-…` / `1fbd7632-…`) can never be anchored.
- **Step 9 — verification:**
  - The deployed bytes must equal the preserved package.
  - The CLI must fail closed without configuration.
  - A request for an unknown token must return `no_such_session`.
  - No signature may be emitted for any state other than the clean accepted one.
- **Step 10 — authority binding:** a separate task. It replaces `acquireExecutorAttestationSourceV2()` in the
  preserved authority with a reviewed source built from `createExecutorAttestationSourceChannel`, using the existing
  `LIVE_AI_03B_EXECUTOR_ATTESTER_*` names.

## Service environment

**Required:**
- `LIVE_AI_03B_EXECUTOR_ATTESTER_ISSUER`
- `LIVE_AI_03B_EXECUTOR_ATTESTER_PUBKEY_DER_B64`
- `LIVE_AI_03B_EXECUTOR_ATTESTER_FINGERPRINT`
- `LIVE_AI_03B_EXECUTOR_ATTESTER_PORT`
- `LIVE_AI_03B_EXECUTOR_ATTESTER_CHANNEL_SECRET` (secret)
- `LIVE_AI_03B_EXECUTOR_ATTESTER_SIGNING_KEY_PKCS8_B64` (secret)
- `LIVE_AI_03B_EXECUTOR_ATTESTER_OBSERVER_DB_URL` (secret)
- `LIVE_AI_03B_EXECUTOR_ATTESTER_BIND_HOST`
- `LIVE_AI_03B_EXECUTOR_ATTESTER_ALLOWED_PEER_CIDRS`
- `LIVE_AI_03B_EXECUTOR_ATTESTER_DEPLOYMENT_ANCHOR`
- `LIVE_AI_03B_EXECUTOR_ATTESTER_DISTINCT_READER_ISSUER`
- `LIVE_AI_03B_EXECUTOR_ATTESTER_DISTINCT_READER_FINGERPRINT`

**Optional:**
- `LIVE_AI_03B_EXECUTOR_ATTESTER_ALLOW_WILDCARD_BIND` (exactly `true`, together with a peer allowlist)
- `LIVE_AI_03B_EXECUTOR_ATTESTER_PROOF_LIFETIME_MS` (at most 300000; default 120000)

**Refused if present** (the service fails closed before any I/O):
- executor, reader and gateway-store DB URLs;
- the reader transport secret;
- every reader-attester secret (signing key, observer URL, channel secret);
- provider keys;
- the reviewer private key and the session signing key;
- gateway and broker secrets;
- CORE and platform superuser credentials (`DATABASE_URL`, `DATABASE_PUBLIC_URL`, `PGPASSWORD`, `POSTGRES_PASSWORD`,
  `PGUSER`);
- any name matching `/PRIVATE_KEY/`, `/^OPENAI_/`, `/^ANTHROPIC_.*(KEY|TOKEN|SECRET)/`, `/^CORE_/` or
  `/GATEWAY.*(SECRET|KEY)/`.

## Never in this sequence

- SQL 03 before the authority binding and provisioning steps;
- any gateway deploy or action;
- any provider credential or call;
- CORE-PROD;
- 03C;
- any change to the reader attester or the crashed M5 reader.
