# LIVE-AI-03B BOOTSTRAP — DEPLOYMENT CONTRACT (OFFLINE candidate)

This milestone is **offline**: it connects to nothing external and deploys nothing. It provides REAL, fail-closed
production composition roots (M1-R2) that operate later when valid deployment-owned configuration, secrets, a
direct PostgreSQL session, and the Railway private network exist. Nothing below is performed by this milestone.

## Database-clock target — DIRECT PostgreSQL against the anchored AI-STAGING Railway service (M1-R3)
The bootstrap clock source is a **direct, bounded, read-only PostgreSQL session** to the EXACT deployment-anchor-
bound AI-STAGING Railway PostgreSQL service:

- project `4ad1abb3-823a-4acf-b889-6d34ae46d7f9`
- environment `aa397bd7-b316-4fd8-b05a-0a5f6c5e3abc`
- **PostgreSQL service `b7362594-a01b-4623-a982-394707a6cec2`**

Clock = PostgreSQL `clock_timestamp()`. Fingerprint = the accepted `target-binding` cluster fields, re-derived on
every probe and enforced against the anchored `clusterFingerprint`. The **reader and the attester observe the SAME
anchored PostgreSQL clock** (the shared DB offset cancels in the pairwise skew).

**There is NO Supabase, NO PostgREST, NO `SB_URL`, and NO HTTP clock source** anywhere in the clock path. The
reader connects with its **reader** credential; the attester connects with its **observer** credential; the
executor credential is never used by either process. CORE-PROD (`04c8b523…` / `1fbd7632…`) can never be anchored
(the anchor parser rejects it).

## Start commands (real composition roots; fail closed until provisioned)
```
node scripts/live-ai-03b/private-reader-bootstrap-clock-peer-offline-01/bootstrap-entrypoint-attester.mjs
node scripts/live-ai-03b/private-reader-bootstrap-clock-peer-offline-01/bootstrap-entrypoint-reader.mjs
```
With missing/invalid configuration both print `{status:"UNPROVISIONED", reason:"<reader|attester>_config_incomplete", …}`
and exit **70**: no listener, no DB connection, no signature, `serving`/`signingReady` always `false`. The permanent
`live_wiring_is_a_future_gate` stub has been **removed** — valid future configuration is no longer hardcoded to fail.

## Required environment variable NAMES (values never here)
Secret-bearing values are read only by NAME, at point of use, and never logged.

**Reader** (`production-config.mjs` `READER_ENV`)
- `LIVE_AI_03B_TRUSTED_READER_DB_URL` — read-only **reader** DB credential for the direct clock session (secret)
- `LIVE_AI_03B_AI_STAGING_PROJECT_ID` / `_ENVIRONMENT_ID` / `_PG_SERVICE_ID` — must equal the anchored AI-STAGING IDs above
- `LIVE_AI_03B_DEPLOYMENT_ANCHOR_JSON` — owner-issued anchor (non-secret); supplies the anchored cluster fingerprint the reader clock probe must observe
- `LIVE_AI_03B_ATTESTER_SERVICE_NAME` — the attester's `<name>.railway.internal` (private) destination
- `LIVE_AI_03B_ATTESTER_PORT` — attester private port
- `LIVE_AI_03B_READER_ATTESTER_CHANNEL_SECRET` — shared v2 channel secret (secret)
- `LIVE_AI_03B_ATTESTER_ISSUER` / `_PUBLIC_KEY_DER_B64` / `_KEY_FINGERPRINT` — the pinned attester trust root
- `LIVE_AI_03B_CLOCK_STATEMENT_TIMEOUT_MS` — optional; within the frozen per-service bound

**Attester** (`production-config.mjs` `ATTESTER_ENV`)
- `LIVE_AI_03B_ATTESTER_OBSERVER_DB_URL` — read-only **observer** DB credential (secret)
- `LIVE_AI_03B_ATTESTER_SIGNING_KEY_PKCS8_B64` — Ed25519 signing key from custody (secret)
- `LIVE_AI_03B_ATTESTER_ISSUER` — signer issuer
- `LIVE_AI_03B_DEPLOYMENT_ANCHOR_JSON` — owner-issued anchor (non-secret)
- `LIVE_AI_03B_READER_ATTESTER_CHANNEL_SECRET` — shared v2 channel secret (secret)
- `LIVE_AI_03B_READER_SERVICE_NAME` — the reader's `<name>.railway.internal` identity (for the exact-host peer allowlist)
- `LIVE_AI_03B_ATTESTER_BIND_HOST` / `LIVE_AI_03B_ATTESTER_PORT` — private listener bind
- `LIVE_AI_03B_AI_STAGING_PROJECT_ID` / `_ENVIRONMENT_ID` / `_PG_SERVICE_ID` — must equal the anchored AI-STAGING IDs
- `LIVE_AI_03B_CLOCK_STATEMENT_TIMEOUT_MS` — optional

**Forbidden / foreign categories (fail closed):** `LIVE_AI_03B_TRUSTED_EXECUTOR_DB_URL` (the EXECUTE-capable
executor credential) must never be present in a reader/attester process. No Supabase/PostgREST/`SB_URL` value is
ever read as the clock source.

## Production composition (what each root builds; §16–§18)
- **Reader** (`production-reader.mjs`): validate config → reject any injected authority → resolve the attester's
  `.railway.internal` name to an EXACT private host → establish the reader's OWN read-only reader-role session
  (its observed identity + connection token) → build the fixed direct-PostgreSQL clock sampler over that session
  → start the reader bootstrap → WAITING_FOR_CLOCK → WAITING_FOR_ATTESTER → AUTHORITY_READY (only through the
  frozen clock bracket + a verified attestation). **The gateway observation serving listener is never opened.**
- **Attester** (`production-attester.mjs`): validate config → reject injected authority → build the Ed25519 signer
  from custody → resolve the reader's `.railway.internal` identity to an EXACT private-host allowlist → build the
  fixed clock sampler over the observer credential + the accepted least-privilege observer provider → start the
  attester bootstrap → BOOTSTRAP_LISTENING (signs only after the full clock/anchor/observer/request gates).
- **Test-injection boundary (§18):** production accepts only `{ env, log }`; any other option key is rejected
  (`production_option_not_allowed:<key>`). Synthetic dependencies are accepted ONLY behind the explicit
  `{ offlineTest:true, offlineTestBoundary:true, inject:{…} }` seam used by the offline tests.

## Ordering (future, owner-performed — NOT done here)
1. Provision the read-only **reader** and **observer** roles on the anchored PostgreSQL service; confirm
   `clock_timestamp()` precision/latency on hosted PostgreSQL.
2. Set the env NAMES above (secrets from custody) on the Railway reader + attester services.
3. Deploy the attester on the Railway private network (private bind; the reader `.railway.internal` allowlisted).
4. Deploy the reader with its clock session + trust root + the attester `.railway.internal` destination.
5. Owner smoke-test: reader boots → clock gate → attestation bracket → AUTHORITY_READY; a broken/stepped clock on
   either side refuses authority; a demoted peer/clock invalidates and requires a fresh re-gate.
6. Only a LATER milestone opens the gateway observation serving listener (`serving` stays false until then).

## Remaining LIVE-only gates (not proven here)
Real Railway variables · real reader/observer logins · real DB fingerprint · real `clock_timestamp()` precision
and latency · real Railway private DNS · real socket source addresses · signing-key custody · deployment · real
inter-service clock skew. Offline tests prove composition logic only; **Production admin/clock operation is NOT
claimed fixed.**

## Rollback
Purely additive and offline. Removing the directory leaves every accepted layer and every login untouched. No
migration, env, or deployed resource is created by this milestone.
