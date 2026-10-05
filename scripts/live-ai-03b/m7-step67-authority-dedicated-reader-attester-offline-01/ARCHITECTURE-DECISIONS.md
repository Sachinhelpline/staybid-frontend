# Architecture decisions: M7 Step6/7 dedicated Authority reader-attester V2

The architecture was **locked by the Owner** and is not reopened here. It resolves both earlier HOLDs:

- `HOLD_M7_STEP6_7_DUAL_BINDING_OWNER_MAC_OFFLINE_ATTESTER_CALLER_PATH_UNAVAILABLE`
- `HOLD_M7_STEP6_7_AUTHORITY_HOST_OFFLINE_PRIVATE_PEER_BOOTSTRAP_UNRESOLVED`

## AD-1 · A dedicated single-peer reader attester (not a second M5 peer)

The accepted bootstrap attester admits exactly the peer set resolved from ONE private service name
(`LIVE_AI_03B_READER_SERVICE_NAME`). That one name is the M5 reader host. Adding the Authority as a second M5 peer
would mutate the frozen M5 deployment.

Instead, a NEW service, `live-ai-03b-authority-reader-attester`, runs the **byte-unchanged** accepted attester.
Its single peer name is `${{live-ai-03b-v2-authority.RAILWAY_PRIVATE_DOMAIN}}`. Test C08 proves that the
Railway-resolved dedicated environment satisfies the **accepted** `loadAttesterProductionConfig` unchanged.

## AD-2 · New key, issuer and channel secret; observer and anchor reused by reference

- **Signing key.** A NEW Ed25519 key is generated in memory in P3. Its `keyId` is self-checked through the
  ACCEPTED `createSigningAdapter`.
- **Issuer.** `staybid-live-ai-03b-authority-reader-attester-v1`.
- **Channel secret.** A NEW 48-byte (base64url) secret. It is distinct from the M5, executor, gateway and
  provider secrets.
- **Observer credential.** `LIVE_AI_03B_ATTESTER_OBSERVER_DB_URL` is a Railway reference to the M5 attester
  variable. There is no new role, no ALTER ROLE and no password handling. Reuse is safe because the observer is
  a least-privilege read-only role, and the dedicated attester process holds it exactly as M5 does.
- **Anchor.** `LIVE_AI_03B_DEPLOYMENT_ANCHOR_JSON` is a Railway reference to the M5 anchor.
  `AiStagingDeploymentAnchorV1` binds the **cluster** only: project, environment, pgService and cluster
  fingerprint. It carries no attester identity, so it is attester-agnostic.
- **Replay state.** Each attester instance keeps its own replay state (the accepted per-process nonce sets).
  Nothing is shared between instances.

## AD-3 · The Authority reader path is v2 and clock-gated

`src/reader-v2-attestation-source.mjs` composes only accepted primitives:

- `resolvePeerAllowlist` (one exact private address);
- `makeClockSamplerOverPhysical(session.physical, {expectedFingerprint})` over the **same** reader session
  that is being bound;
- `startReaderBootstrap` (5-sample startup gate ≤ 250 ms each, RTT ≤ 100 ms; 1 s monitor, fresh ≤ 2 s);
- `acquireAuthority` (pre-sample → `obtainV2` L/U/generation → verify → post-sample → DB-clock consistency →
  generation unchanged).

`offlineTestBoundary:true` passed to `startReaderBootstrap` is the accepted internal composition seam, used
exactly as the accepted `production-reader.mjs` uses it. The test seams of THIS module (resolver, sampler,
obtain, monitor) are refused outside `testBoundary` (test C12).

The v1 `createAttestationSourceChannel` is never imported. Only the accepted channel-config validator and its
constant come from that module (test S05).

## AD-4 · Executor side unchanged; literal /128 peer binding (P7)

The executor attester admits peers only by literal CIDR (`LIVE_AI_03B_EXECUTOR_ATTESTER_ALLOWED_PEER_CIDRS`).
P7 learns the Authority's CURRENT private address from the Authority itself, via the accepted resolver inside
the container. The controller re-validates the reported address with the same accepted resolver, which accepts
only an exact host that is private, non-loopback and within the 4-address cap. The controller then sets the
variable and redeploys the executor attester from the same commit.

**The Authority must not be redeployed between P5 and the end of P8.** Every later phase re-checks the
Authority deployment id.

## AD-5 · Ordering (P5 before P6)

The accepted attester resolves its peer name at boot and exits 70 if the name does not resolve to an exact
private address. So the Authority must already be deployed (P5) before the dedicated attester deploys (P6).
`validatePhasePlan()` enforces P6 immediately after P5 (test C18).

## AD-6 · Verification only

The Step6/7 entrypoint never calls any of the following, and S01/S05 audit this statically:

- `composeTrustedExecutorProductionV2`;
- Phase A or SQL03;
- `activate_catalog_v2` or `restore_catalog_v2_inactive`;
- the gateway or a provider.

It issues only:

- the accepted executor and reader session lifecycle SQL;
- the accepted fixed DB clock probe (E02).

## AD-7 · Privilege contracts are reused, never forked

- **Executor:** `bindExecutorConnection` → `verifyExecutorAttestation`. It checks the exact routine and schema
  set and refuses role flags, memberships, budget/ledger privileges and PUBLIC/default widening.
- **Reader:** `bindReaderConnection` → `verifyReaderAttestation`. It requires select-only, zero writes and the
  exact grant count, and it refuses forbidden objects, memberships, routines and owner authority. Session
  verification uses `establishReaderSession` and `recheckReaderSession`.
- **Distinctness:** the accepted `checkDistinctBindings` checks role, token, pid, application name, nonce and
  bound connection token.

## Carried forward

- **MANDATORY LATER PRODUCTION-COMPOSITION INTEGRATION ITEM:** the production Authority reader caller v1 → v2
  integration. It must land before the production provisioner or Phase A. It is not optional B hardening, and
  it does not block this ZIP.
- **B item:** the stale comment in the frozen accepted file `executor-attestation.mjs`. It still says no issuer
  is deployed. It is not edited here.
