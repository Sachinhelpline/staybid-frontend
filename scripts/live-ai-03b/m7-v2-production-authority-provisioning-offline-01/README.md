# M7 — V2 production authority provisioning (offline candidate 01)

**Status:** this is an offline preparation candidate. Nothing here has been deployed, provisioned, signed or run
against a live system.

- **Not authority by itself.** Nothing in this directory is authority on its own.
- **Default is unchanged.** The preserved default (`v2_production_authority_unprovisioned`) is not changed.
- **Stops before any connection.** The production entrypoint fails closed before any database connection:
  - the executor-attestation source is unprovisioned;
  - see §7.

It is an additive layer on top of the Step-2 runtime preserved at PIN C.

| Field | Value |
|---|---|
| PIN C commit | `0afe4b6bedeb12f756cc9027367d323acb264464` |
| Runtime manifest | `64c7031746bff227321e2e2506b4737938eafc3493ae472ab0f51e5e46987d9f` |

No file under `m7-step2-runtime-rebinding-offline-01/`, and no other frozen predecessor, is modified.

## 1. What it provides
It is a bounded composition boundary. In a future, separately authorized live step, it can obtain and validate
every dependency the preserved V2 runtime needs for Phase A and exactly one SQL 03. The untrusted activation request
can never supply any of them.

```
trusted process env ─► provisioning-config ─► reviewer PUBLIC trust root ─► ActivationSourceProofV2 (PIN C re-derived from git)
                     └► executor-attestation source (UNPROVISIONED today) / reader-attestation source (accepted channel)
                     └► restricted executor + reader physical-connection factories (distinct credential refs)
                     └► trusted clock (bound to the DB clock on the executor connection)
        ─► createAuthorityProvisionerV2 → frozen { contract:"LiveAi03bProductionAuthorityProvisionerV2", acquire }
        ─► PRESERVED composeTrustedExecutorProductionV2(provisioner) → ONE-SHOT run({ approvalEnvelope, suppliedEvidence, executionId })
```

## 2. Modules (`src/`)
| Module | Role |
|---|---|
| `provisioning-config.mjs` | Loads configuration: names, public identifiers and pinned public keys only. It reuses the preserved `loadRuntimeConfigV2` and adds the rest of the checks listed below this table. |
| `reviewer-trust-root.mjs` | Loads the reviewer public Ed25519 key (DER SPKI). It recomputes the fingerprint with the accepted Step-1 primitive, which must equal the config. It refuses private-key material (PKCS#8 or PEM) and non-Ed25519 keys. |
| `trusted-clock.mjs` | Takes no caller or request time. It is the host clock, usable only after binding to the AI-STAGING DB clock (skew ≤ 5 s), and it never moves backwards. A TEST clock exists only under the test boundary. |
| `executor-session.mjs` | Opens one restricted executor connection. It sets and reads back the `statement_timeout`, which must lie in 1000–15000 ms. It requires `current_user` and `session_user` to be `live_ai_03b_executor`, derives the connection token, and reads the DB clock. |
| `executor-attestation.mjs` | Verifies `AiStagingExecutorAttestationV1`, an Ed25519-signed attestation by an independent attester. It covers the exact executor privilege set, the AI-STAGING target (CORE refused), freshness of at most 5 min, and the connection-token and nonce binding. |
| `role-binding.mjs` | Binds each client independently: the executor with the executor attestation, and the reader with the accepted `AiStagingReaderAttestationV1` via the accepted `verifyReaderAttestation`. Each proof is checked by the accepted `verifyConnectionTargetBinding` against its own token. The two bindings must be pairwise distinct. |
| `guarded-clients.mjs` | Seals the only clients the runtime ever sees. The executor client admits only `ACTIVATE_SQL_V2`, at most once. The reader client admits only the 8 preserved registry statements. Neither reconnects silently. |
| `activation-source.mjs` | Builds the exact `LiveAi03bActivationSourceProofV2` (details below this table). The Phase-B pre-probe proof is not imported. |
| `provisioner.mjs` | Validates dependencies statically (exact key set, no I/O). Its `acquire()` takes no arguments and runs once. It assembles the exact frozen authority and validates it with the preserved `validateProvisionedAuthorityV2`. |
| `production-entrypoint.mjs` | Production composition, which fails closed today (§7). The test composition exists only under the test boundary. The CLI exits 2. |

`provisioning-config.mjs` adds these checks on top of `loadRuntimeConfigV2`:
- a forbidden-secret-class screen;
- distinct executor and reader credential references, compared by digest only;
- two independent attester trust roots and their channels;
- the executor issuer must be named by the frozen `LIVE_AI_03B_CONNECTION_IDENTITY_PROOF_REF`.

`activation-source.mjs` builds the proof from three parts:
- **PIN A:** the imported derivation base.
- **PIN B:** the imported static reviewed identity.
- **PIN C:** the genuine V2 binding of `0afe4b6b`, re-derived from git by the preserved verifier and required to be
  byte-equal. The whole proof is then checked by the preserved `checkActivationSourceProofV2`, which also re-measures
  the running Step-2 bytes.

## 3. Two-client audit (the material review question)
**What the preserved runtime does.**
- The frozen authority shape has distinct `executorDbClient` and `readerDbClient`.
- It has only one `connectionIdentityProof` / `expectedIssuer` / `connectionToken`.
- `runInternal` verifies that single proof once and passes the resulting target binding to both adapters.
- So the preserved runtime by itself authenticates one connection. One proof does not authenticate two connections.

**Conclusion: safe dual-client binding can be established additively, without modifying Step 2.**
1. **Independent attestations.** Each actual connection gets its own independent attestation from the Owner-controlled
   attester. Each is bound to its own connection token (derived from backend pid, backend start and application name)
   and its own fresh nonce, then verified against its own pinned trust root and its own token. Swapped, replayed and
   cross-role attestations fail (tests C10–C15).
2. **Pairwise distinct.** Role, token, backend pid, application name, nonce and credential reference must all differ.
   The same factory, the same physical connection and a shared credential are each refused.
3. **Sealed clients.** Each client object handed to the runtime is a sealed guard around exactly one bound connection.
   It never reconnects, and its statement allowlist is scoped to its role.
4. **Executor proof in the frozen slot.** The single frozen proof slot carries the executor binding, which the runtime
   re-verifies. The reader binding is enforced by this layer before the authority exists, and by the sealed reader guard.
5. **Only one construction path.** The authority reaches the runtime only through the frozen provisioner's no-argument
   `acquire()`, so the runtime can never be fed an unverified second client.

**Honest residual.** The preserved runtime re-verifies only the executor binding. The reader binding's per-connection
check lives in this layer. That is acceptable only because this layer is the sole constructor of the authority.

## 4. Privilege proofs
- **Executor:** the executor privilege-proof contract lives in `executor-attestation.mjs`; the exact expected set is
  in its `EXPECTED_EXECUTOR_PRIVILEGES`.
  - Role must be `live_ai_03b_executor` for both `current_user` and `session_user`.
  - Must be false: superuser, CREATEROLE, CREATEDB, REPLICATION, BYPASSRLS.
  - Must be empty: role memberships, schema CREATE.
  - Must be 0: budget-table privileges, ledger privileges.
  - USAGE exactly on `live_ai_03b_trusted` and `live_ai_03b_trusted_v2`.
  - EXECUTE exactly on these 4 routines:
    - the 2 M6 routines (V1-bound, expired, fail closed inside);
    - the 2 successor routines.
  - No other routine EXECUTE; no PUBLIC or default widening.
  - Fresh (lifetime ≤ 5 min, forward tolerance 5 s), bound to the executor connection token and nonce, with a trusted
    issuer and key.

  The frozen `privilegeProof: { restricted_role_proof_present: true }` marker is set only after that attestation
  verified. A bare boolean is never accepted as evidence (E22) and cannot be injected (E23).
- **Reader:** the accepted contract, unchanged. SELECT-only, exactly 12 SELECT grants, 0 writes, forbidden object
  inaccessible, no membership, routine, owner or executor authority, `statement_timeout` ≤ 2000 ms read back,
  read-only session, fresh, and bound to the reader token. The standalone Phase-B reader host is not touched and never
  receives executor authority.

## 5. Request boundary
`run(request)` accepts exactly `{ approvalEnvelope, suppliedEvidence, executionId }`, enforced by the preserved
`rejectCallerSuppliedAuthorityV2` before acquisition.
- Any other key is refused with 0 connections (tests B*). Examples: a DB client, `dbUrl`, `password`, `trustRoot`, a
  proof, `registry`, `activationSourceProof`, a clock, `nowIso`, an authority object, a provisioner.
- `acquire()` refuses arguments.
- The boundary, the composed executor, the provisioner and the preserved executor are each one-shot.

## 6. Identity of this package (not PIN C)
`identity/PACKAGE-CONTENT-MANIFEST.json`, written by `tools/package-identity.mjs`, records:
- the baseline `0afe4b6b` and the PIN-C reference;
- every file with its SHA-256;
- `package_runtime_digest` (over `src/`) and `package_content_digest`;
- every frozen dependency `src/` imports, with its SHA-256.

The future preservation binding is `V2ProductionAuthorityProvisioningPreservationBindingV1`, with its template in
`identity/PACKAGE-PRESERVATION-BINDING-TEMPLATE.json`. It is deliberately not a PIN C and is refused by
`verifyStep2RuntimePin` (Z02). No future commit or tree is fabricated.

### 6.1 Which check decides preservation (R1)
The identity files and `tools/verify-package-preservation.mjs` live **inside** this package, which is exactly what a
future preservation commit adds. A target commit could change runtime, manifest, identity logic and that verifier
together and stay self-consistent. So:

| Check | Where it lives | Status |
|---|---|---|
| `verify-preservation-external.mjs` + `REVIEW-ANCHOR.json` | the external review bundle, **outside** the target commit | **AUTHORITATIVE** |
| `tools/verify-package-preservation.mjs`, `tools/package-identity.mjs --check` | inside this package | non-authoritative diagnostics (internal consistency only) |

The external verifier:
- runs from the review bundle, whose SHA-256 is recorded independently at closure review, and must be checked
  against that record before the verifier is trusted;
- reads its expectations only from the fixed sibling `REVIEW-ANCHOR.json`, and accepts no replacement anchor,
  expected-value argument or override environment variable;
- imports nothing from the target commit, and reads target files only as untrusted bytes being measured;
- accepts a commit only when its tree equals the baseline tree plus exactly the reviewed package bytes.

Neither verifier is made trustworthy by storing its own hash; the trust anchor is the externally recorded
review-bundle hash.

## 7. Remaining blockers before any live provisioning (honest)
1. **No independent executor-attestation issuer exists.** The accepted M5 attester issues only
   `AiStagingReaderAttestationV1` for `live_ai_03b_reader`: `attestation-server.mjs` refuses any other role or contract.
   - `acquireExecutorAttestationSourceV2()` is therefore deterministically UNPROVISIONED, and the production entrypoint
     stops there (A04) before opening any connection.
   - A reviewed issuer extension, which is a change outside this package, must exist first. Then this package can
     receive a reviewed, preserved source.
2. **Deployment topology.** The accepted reader-attestation channel is private (`*.railway.internal`). The future
   trusted entrypoint must therefore run where it can reach the attester privately, and where the restricted
   credentials are provisioned. This is decided at the live boundary, not here.
3. **Nothing is provisioned yet:**
   - restricted executor and reader credentials;
   - the reviewer public trust root in the executor environment;
   - the executor-attester configuration;
   - a genuine approval.
4. **This package needs its own preservation (§6) and a WORK review** before any of the above.

## 8. Running the offline evidence
```
node tests/authority-provisioning.test.mjs      # focused suite (A–K + Z)
bash tests/run-all.sh                            # 12 required checks: this package + preserved Step 2 + predecessors
node tools/package-identity.mjs --check          # identity files current (diagnostic)
```

Preservation acceptance is not run from here; see §6.1.

The future live boundary is described in `FUTURE-LIVE-BOUNDARY.md`, and the exact imports in `DEPENDENCY-MAP.md`.
