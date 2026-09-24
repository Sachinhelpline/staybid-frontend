# LIVE-AI-03B — private-reader production integration: contract (OFFLINE candidate)

> **Status: OFFLINE production-integration candidate — review required.** Not deployed, not live-ready,
> not provider-ready. Everything below that concerns live AI-STAGING is **PENDING LIVE VERIFICATION**.
> Synthetic fixtures (session, attester key, secret) are test-only and are not evidence about AI-STAGING.

## 1. Trust boundaries

| Party | Holds | Never holds |
|---|---|---|
| **Independent attester** (Owner-controlled, outside host/gateway/probe/executor — FUTURE, not built) | Ed25519 **signing key**; its own privileged observation of AI-STAGING (`pg_stat_activity`, catalog privileges, Railway service identity) | anything from the reader host other than the attestation request |
| **Reader host** (service `88c74a23…`) | reader DB URL (`live_ai_03b_reader` only), attester **public** key + fingerprint (deployment config), transport secret | signing key, executor credential (startup refuses if `LIVE_AI_03B_TRUSTED_EXECUTOR_DB_URL` is present), owner credential, any privileged client |
| **Gateway** (service `dd96c7cd…`) | transport secret, reader private destination | any DB credential, `readerDbClient`, `executorDbClient`, signing key |

- The trust root is **deployment configuration** (`LIVE_AI_03B_READER_ATTESTER_PUBKEY_DER_B64` +
  separately configured `…_FINGERPRINT` + `…_ISSUER`). The fingerprint is recomputed from the key and must
  match; the key must be Ed25519; `TEST-ONLY-*` issuers are refused in production. A key carried inside an
  attestation envelope is ignored — the attestation channel can never supply its own trust root.
- Verification reuses the **accepted** primitives from `trusted-activation-boundary-01/pricing-approval-contract.mjs`
  (`canonicalize`, `publicKeyFingerprintFromDerB64`, `verifyEnvelopeSignature`). No new signing framework.

## 2. Production entrypoint contract (`production-entrypoint.mjs`, `reader-production-entrypoint-v1`)
`node scripts/live-ai-03b/private-reader-production-integration-offline-01/production-entrypoint.mjs`

1. Accepted `targetSelfCheck()` (AI-STAGING, never CORE-PROD).
2. `loadIntegrationConfig(process.env)` — refuses an executor credential, missing names, a bad timeout, a bad/test
   trust root, or an invalid attestation-source channel configuration (destination, port, channel secret).
3. **`composeProductionAttestationSource(env, cfg)`** builds the ONLY production source — the versioned
   `reader-attestation-channel-v1` adapter (§3a) — from that validated deployment configuration. Missing or invalid
   source configuration ⇒ `unprovisioned` / exit **70** with **zero** DB connections.
4. One physical reader connection → statement-timeout + read-only enforcement and read-back → own identity → signed
   attestation bound to that connection token and a fresh request nonce → verified.
5. The **accepted** `startServingRuntime({ acquireReaderAuthority, … })` (frozen runtime; the accepted
   `validateReaderOnlyAuthority` re-validates; accepted transport, deadlines, quarantine, outward guard unchanged).
6. `status:"serving"` is logged only when the listener is up **and** authority is valid; `ready()` is recomputed
   live on every call (listener serving ∧ accepted `ready()` ∧ authority valid now).

Exit codes: **70** unprovisioned/refused · **71** accepted runtime degraded · **72** authority recovery exhausted ·
**0** after SIGTERM/SIGINT (listener and DB session closed, then an explicit exit).
Production mode accepts ONLY the option keys `PRODUCTION_OPTION_KEYS = [mode, env, log, onFatal, onDegraded]`; any
other key — an attestation source object, a channel object, a trust root, a clock, a session factory, listen, limits,
or `offlineTestBoundary` — is refused before anything is contacted. `env` is the configuration source (`process.env`
in `main()`); every value in it passes the same validation. Offline-test mode exists only behind `offlineTestBoundary: true`, uses the accepted
test provenance and accepted `testBoundary`, so its messages carry `mode:"test"`.

## 3. Real authority-proof prerequisites — `AiStagingReaderAttestationV1`
Signed (Ed25519 over the accepted canonical bytes) payload, exact key sets:
```
{ contract:"AiStagingReaderAttestationV1", domain:"staybid.live-ai-03b.reader-authority-attestation.v1",
  issuer, keyId:<sha256(SPKI) of the signing key>, issuedAtMs, expiresAtMs (≤ issuedAtMs+300000), requestNonce,
  target:{ projectId, environmentId, pgServiceId },                 // independently observed Railway identity
  connection:{ token, role:"live_ai_03b_reader" },                  // the observed session (see §5)
  privileges:{ currentUser, effectiveSelectOnly, writePrivilegeCount, selectGrantCount, forbiddenObjectAccessible,
               unapprovedRoleMembership, unapprovedRoutineAuthority, ownerOrExecutorAuthority } }
```
Required: issuer + keyId = pinned trust root; valid signature; lifetime ≤ 5 min; not stale (>5 min), not
future-dated (>5 s), not expired; token = the host's own observed token; nonce = the host's request nonce;
target = AI-STAGING `4ad1abb3…/aa397bd7…/b7362594…` (CORE-PROD refused); `currentUser = live_ai_03b_reader`,
select-only, 0 write privileges, exactly 12 SELECT grants, `budget_envelope_allocations` inaccessible, no
unapproved membership/routine authority, no owner/executor authority. A genuinely signed attestation reporting
any other state is **drift** and revokes immediately.
The attester must derive every field from **its own** privileged observation — never from the request. Its
custody, deployment, the live availability of its channel endpoint, and key provisioning are **NOT AUTHORIZED
here** (future live gates). The host-side channel adapter IS implemented (§3a).

## 3a. Production attestation-source channel (`attestation-source-channel.mjs`, `reader-attestation-channel-v1`)
The adapter only **requests and receives** the attester's signed envelope; it cannot sign, fabricate or trust one.
Every envelope it returns is verified, unchanged, by `reader-attestation.mjs` against the pinned trust root.
- **Framing:** the accepted `reader-obs-transport-v1` pattern — one newline-terminated JSON request per connection,
  one JSON response. Request `{ v:"reader-attestation-channel-v1", op:"attest", args:{ contract:"AiStagingReaderAttestationV1",
  connectionToken, role:"live_ai_03b_reader", requestNonce }, nonce, ts, mac }`, where
  `mac = HMAC-SHA256(channelSecret, v⏎op⏎JSON(args)⏎nonce⏎ts)` (the accepted canonical construction). `args` is exactly
  the four fields the authority manager supplies (a 64-hex token and a 32-hex nonce); nothing else is caller-chosen.
- **Response:** exactly `{ ok:true, envelope:{ payload, signatureB64 } }` or `{ ok:false, code }`, where `code` is one
  of `unauthenticated|stale|replayed|bad_request|unknown_op|unsupported_version|no_such_session|busy|unavailable|internal`.
  Any other shape — including extra fields such as an embedded key — is `attester_bad_response`.
- **Channel authentication:** a dedicated `LIVE_AI_03B_READER_ATTESTER_CHANNEL_SECRET` (≥ 32 chars, must differ from
  the transport secret). The attester must verify the MAC, a ±30 s timestamp window and a single-use nonce. The
  channel secret only lets the attester refuse unauthenticated callers; the signature is still the sole source of authority.
- **Destination:** `LIVE_AI_03B_READER_ATTESTER_HOST` + `…_PORT` from deployment configuration only. The host must be a
  `*.railway.internal` name or a literal RFC 1918 / ULA address; URLs, public addresses, external names and loopback
  are refused. It is never taken from a request or an envelope.
- **Bounds:** connect 1.5 s, total 4 s, request ≤ 2 KiB, response ≤ 16 KiB, **no retries**.
- **Failures (`err.code`, surfaced as the authority reason):** `attester_request_invalid`, `attester_unreachable`,
  `attester_deadline_exceeded`, `attester_response_too_large`, `attester_bad_response`, `attester_rejected`. They carry
  no raw socket error, stack, secret or host detail.
- **Renewal:** the supervisor renews at `min(120 s, half the attester-chosen lifetime)` through the same configured
  source. A failed renewal never extends the previous proof beyond its expiry. Recovery goes through the same
  source and must pass every fresh target, connection, privilege and timeout check.

## 4. Credential custody
- Reader DB URL: env name `LIVE_AI_03B_TRUSTED_READER_DB_URL` (the accepted name), service-scoped on `88c74a23`;
  read only inside the `pg` factory's `open()`; never returned, logged or passed to the accepted host.
- Transport secret: accepted name `LIVE_AI_03B_READER_TRANSPORT_SECRET`, on the host **and** the gateway only.
- Attester signing key: attester custody only. The host holds only the public key (`…_ATTESTER_PUBKEY_DER_B64`,
  `…_ATTESTER_FINGERPRINT`, `…_ATTESTER_ISSUER`).
- Attester channel secret: `LIVE_AI_03B_READER_ATTESTER_CHANNEL_SECRET`, held by the reader host and the attester only.
  It is read from the environment when the source is composed; never returned, logged or placed in a request body.
- Executor credential: must be absent from the reader host (presence ⇒ refusal).

## 5. Connection / reconnection lifecycle (`production-reader-authority.mjs`)
- **Connection token** = `sha256("lai03b-reader-connection-v1" ⏎ pid ⏎ backend_start ⏎ application_name)`. The host
  reads its own row; the attester computes the same from `pg_stat_activity`. `application_name` carries a fresh
  random value per connection, so every reconnection has a new token.
- **Enforcement point:** the accepted host captures `readerDbClient` once. The integration supplies a stable client
  whose `query()` (a) admits only the pinned reviewed registry SQL (the executor-side ledger query excluded),
  (b) checks authority is valid **now** and bound to the **current live** connection before issuing any statement,
  and (c) re-checks after the result — a result that straddles expiry, reconnection or drift is discarded. The accepted
  host turns that into its fixed `observation_error`. No statement can begin under expired or invalid authority.
- **Expiry:** at most 5 min; renewal (same-connection self-check + fresh attestation) begins after 120 s. A failed
  renewal keeps the previous proof only until its **own** expiry — never beyond it.
- **Drift** (signed attestation reporting a bad target/privilege state, or a same-connection self-check showing a
  changed role, timeout, read-only setting or backend identity) ⇒ immediate revocation.
- **Connection loss** ⇒ immediate invalidation (driver `error`/`end`).
- **Supervisor:** on any invalidation it stops the accepted runtime (listener closed — no admission). It then recovers
  with a **new** connection and every check again, and only then starts a fresh accepted runtime. Recovery is bounded
  (5 attempts, 5 s apart) ⇒ `failed`, exit 72.
- An observation already executing when authority lapses: the reader client discards its result. The in-flight
  statement itself is ended by the DB-side `statement_timeout` (§6), and the accepted deadline/quarantine still applies.

## 6. PostgreSQL statement_timeout enforcement (`reader-session.mjs`)
Per physical connection, before any observation:
`SELECT set_config('statement_timeout', $1, false)` → `SELECT current_setting('statement_timeout')` on the **same**
connection → parse (`ms|s|min|h|d`) → require `0 < effective ≤ 2000` **and** `effective === requested`. Then
`default_transaction_read_only = on`, set and read back. `readerDbClient.statementTimeoutMs` reports the
**verified effective** value. Any error, unparseable, disabled (`0`), above-limit or mismatched value ⇒ no
authority ⇒ no serving. It is repeated on every reconnection and re-checked at every renewal. These are ordinary
session-level settings needing no extra privilege; no pool is introduced.
**Synthetically tested only.** Whether hosted PostgreSQL accepts `set_config` for this role, reports it as tested,
and actually cancels a running statement at the limit is **PENDING LIVE VERIFICATION**. `AbortSignal` does not
cancel an in-flight statement; the accepted quarantine still bounds work that does not end.

## 7. Gateway caller (`gateway-observation-caller.mjs`, `reader-gateway-caller-v1`)
`createGatewayObservationCaller({ destination:{host,port}, secret })` → `{ observe(observation) }`, and nothing else.
- Destination: `*.railway.internal` DNS name or a literal RFC 1918 / ULA address. URLs, public addresses, external
  hostnames and extra fields are refused; loopback is allowed only under an offline test boundary.
- Request: the accepted envelope; HMAC-SHA256 over `v⏎op⏎JSON(args)⏎nonce⏎ts`; a fresh 128-bit nonce and
  timestamp per call; **no retries**.
- Bounds: connect 1.5 s, total 6 s, response ≤ accepted `MAX_RESPONSE_BYTES`.
- Response: must be exactly `{ok,message}` or `{ok,code}`. A success message must pass the **accepted**
  `assertOutwardMessage`, match the requested phase and carry `mode:"production"` (production caller).
- Fixed caller codes: `config_invalid`, `observation_not_approved`, `reader_unreachable`, `deadline_exceeded`,
  `response_too_large`, `bad_response`, `reader_rejected` (+ accepted `readerCode`), `observation_failed`
  (+ accepted `hostCode`).
- **The live gateway (`server/voice-gateway/*`) is NOT modified or connected.** Minimum future wiring (separately
  authorized): the gateway's controller constructs this caller from its own env (`LIVE_AI_03B_READER_TRANSPORT_SECRET`
  + a reader-destination host/port) and treats every non-ok result as "no observation".

## 8. Deferred live requirements (none performed here)
1. Independent attester: custody, deployment and signing-key generation; serving `reader-attestation-channel-v1` at a
   private endpoint reachable from `88c74a23` only; provisioning the host's attester host/port/channel secret and its
   public key, fingerprint and issuer. The host adapter and composition are implemented and synthetically tested.
2. Service-scoped reader DB URL and transport secret on `88c74a23`; transport secret and destination on the gateway.
3. Live verification that the reader role can `set_config` the timeout and read-only settings, and that hosted
   PostgreSQL cancels at the limit.
4. Live verification that the reader can read its own `pg_stat_activity` row, and that the attester's token
   derivation matches.
5. Railway private-network verification (listen mode, allowlist, DNS name, gateway-only reachability, no public
   exposure).
6. Gateway wiring in `server/voice-gateway` (separate authorization); attach source + deploy; live fail-closed and
   serving checks.
