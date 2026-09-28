// ─────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — M7 STEP 2 — V2 reader-only PRODUCTION AUTHORITY manager + continuous lifecycle. OFFLINE.
//
// Successor of private-reader-production-integration-offline-01/production-reader-authority.mjs (V1,
// frozen: its enforcement client admits ONLY the V1 registry SQL and its authority carries the V1
// reviewedStateQueries + sourcePin 2b69ce). Identical lifecycle — establish (one physical reader
// connection → verified statement_timeout → own identity → signed attestation bound to that connection
// + a fresh nonce), live validity recomputed per query, renew / drift / connection-loss invalidation,
// reconnect re-checks everything — with the V2 registry (minus the executor-side ledger query) as the ONLY
// admissible SQL and a V2 accepted authority (content-verified V2 registry + V2 source pin).
// No executorDbClient, executor credential or privileged client exists anywhere in this module.
// ─────────────────────────────────────────────────────────────────────────
import { randomBytes } from "node:crypto";
import { CONNECTION_IDENTITY_PROOF_CONTRACT } from "../../trusted-executor-runtime-01/db-target-binding.mjs";
import { READER_ROLE, READER_PRIVILEGE_PROOF_CONTRACT } from "../../private-reader-host-runtime-offline-01/reader-only-authority.mjs";
import { verifyReaderAttestation, isDriftReason } from "../../private-reader-production-integration-offline-01/reader-attestation.mjs";
import { establishReaderSession, recheckReaderSession } from "../../private-reader-production-integration-offline-01/reader-session.mjs";
import { CHANNEL_FAILURE_CODES } from "../../private-reader-production-integration-offline-01/attestation-source-channel.mjs";
import { V2_QUERY_REGISTRY, READER_QUERY_KEYS, buildV2RegistrySupply } from "../runtime/v2-query-registry.mjs";
import { RUNTIME_CONTRACT_VERSION } from "../identity/v2-identity.mjs";

const CHANNEL_CODES = new Set(CHANNEL_FAILURE_CODES);
export const AUTHORITY_INTEGRATION_VERSION_V2 = "reader-production-authority-v2";
export const READER_OBSERVATION_SQL_V2 = Object.freeze(READER_QUERY_KEYS.map((k) => V2_QUERY_REGISTRY[k]));
const ALLOWED_SQL = new Set(READER_OBSERVATION_SQL_V2);
export const DEFAULT_RENEW_AFTER_MS = 120000;
const REFUSED = "reader_authority_refused";
function fail(reason) { return { ok: false, reason }; }
function validParams(params) { return Array.isArray(params) && params.length === 0; } // every V2 reader query is parameter-free

/**
 * @param opts.mode 'production' | 'offline-test'
 * @param opts.physicalFactory { open() → physical }
 * @param opts.attestationSource { obtain({contract, connectionToken, role, requestNonce}) → envelope }
 * @param opts.trustRoot pinned attester trust root
 * @param opts.statementTimeoutMs requested statement_timeout (≤ 2000)
 * @param opts.nowProvider trusted clock (ms)
 * @param opts.sourcePin a LiveAi03bSourcePinV2 supplied by the deployment (validated by the host)
 */
export function createReaderAuthorityManagerV2(opts) {
  const { mode, physicalFactory, attestationSource, trustRoot, statementTimeoutMs, nowProvider, sourcePin, renewAfterMs = DEFAULT_RENEW_AFTER_MS } = opts || {};
  if (mode !== "production" && mode !== "offline-test") throw new Error("authority_mode_invalid");
  if (mode === "production" && (!trustRoot || trustRoot.test === true)) throw new Error("production_refuses_test_trust_root");
  const now = () => nowProvider();
  let state = { status: "unestablished", reason: "not_established" };
  let session = null; let attestation = null; let epoch = 0; let establishing = false;
  const listeners = new Set();

  function invalidate(reason) {
    if (state.status === "invalid" && state.reason) { attestation = null; return; }
    state = { status: "invalid", reason }; attestation = null; epoch++;
    for (const cb of listeners) { try { cb(reason); } catch {} }
  }
  function current() {
    if (state.status !== "valid" || !session || !attestation) return fail(state.reason || "not_established");
    if (session.physical.isDead && session.physical.isDead()) { invalidate("connection_lost"); return fail("connection_lost"); }
    const t = now();
    if (!(t < attestation.expiresAtMs) || t - attestation.issuedAtMs > READER_PRIVILEGE_PROOF_CONTRACT.max_age_ms) { invalidate("attestation_expired"); return fail("attestation_expired"); }
    return { ok: true, epoch, token: session.token, expiresAtMs: attestation.expiresAtMs, issuedAtMs: attestation.issuedAtMs };
  }
  async function attest(sess) {
    if (!attestationSource || typeof attestationSource.obtain !== "function") return fail("attestation_source_unprovisioned");
    const requestNonce = randomBytes(16).toString("hex");
    let envelope;
    try { envelope = await attestationSource.obtain(Object.freeze({ contract: "AiStagingReaderAttestationV1", connectionToken: sess.token, role: READER_ROLE, requestNonce })); }
    catch (err) { return fail(err && CHANNEL_CODES.has(err.code) ? err.code : "attestation_unavailable"); }
    return verifyReaderAttestation(envelope, { trustRoot, expectedConnectionToken: sess.token, expectedRequestNonce: requestNonce, now: now() });
  }
  async function closeSession() { const s = session; session = null; if (s) { try { await s.physical.close(); } catch {} } }
  async function establish() {
    if (establishing) return fail("establish_in_progress");
    establishing = true;
    try {
      invalidate("re_establishing");
      await closeSession();
      if (!trustRoot) return fail("trust_root_absent");
      if (!attestationSource || typeof attestationSource.obtain !== "function") { state = { status: "invalid", reason: "attestation_source_unprovisioned" }; return fail("attestation_source_unprovisioned"); }
      let physical;
      try { physical = await physicalFactory.open(); } catch { state = { status: "invalid", reason: "reader_connection_failed" }; return fail("reader_connection_failed"); }
      const es = await establishReaderSession(physical, { statementTimeoutMs });
      if (!es.ok) { try { await physical.close(); } catch {} state = { status: "invalid", reason: es.reason }; return fail(es.reason); }
      const v = await attest(es.session);
      if (!v.ok) { try { await physical.close(); } catch {} state = { status: "invalid", reason: v.reason }; return fail(v.reason); }
      session = es.session; attestation = v.attestation; epoch++;
      state = { status: "valid", reason: null };
      const myEpoch = epoch;
      if (typeof physical.onDead === "function") physical.onDead(() => { if (epoch === myEpoch) invalidate("connection_lost"); });
      return { ok: true, token: session.token };
    } finally { establishing = false; }
  }
  async function renew() {
    const c = current(); if (!c.ok) return fail(c.reason);
    const sess = session; const myEpoch = epoch;
    const rc = await recheckReaderSession(sess);
    if (epoch !== myEpoch) return fail("superseded");
    if (!rc.ok) { invalidate(rc.reason); return fail(rc.reason); }
    const v = await attest(sess);
    if (epoch !== myEpoch) return fail("superseded");
    if (!v.ok) { if (isDriftReason(v.reason)) invalidate(v.reason); return fail(v.reason); }
    attestation = v.attestation;
    return { ok: true };
  }
  function needsRenewal() { const c = current(); return c.ok && now() - c.issuedAtMs >= Math.min(renewAfterMs, Math.floor((c.expiresAtMs - c.issuedAtMs) / 2)); }

  const readerClient = Object.freeze({
    async query(sql, params) {
      if (typeof sql !== "string" || !ALLOWED_SQL.has(sql) || !validParams(params === undefined ? [] : params)) throw new Error(REFUSED);
      const before = current(); if (!before.ok) throw new Error(REFUSED);
      const sess = session;
      const r = await sess.physical.query(sql, []);
      const after = current();
      if (!after.ok || after.epoch !== before.epoch || after.token !== before.token) throw new Error(REFUSED);
      return r;
    },
    get statementTimeoutMs() { return session ? session.effectiveStatementTimeoutMs : undefined; },
  });

  function acceptedAuthority() {
    const c = current(); if (!c.ok) return null;
    const a = attestation; const test = mode === "offline-test";
    return {
      cfg: { ok: true, contractVersion: RUNTIME_CONTRACT_VERSION, reviewer: { pinnedPublicKeyDerB64: trustRoot.publicKeyDerB64, pinnedFingerprint: trustRoot.fingerprint },
        targets: { projectId: a.target.projectId, environmentId: a.target.environmentId, pgServiceId: a.target.pgServiceId } },
      trustRoot: { pinnedPublicKeyDerB64: trustRoot.publicKeyDerB64, pinnedFingerprint: trustRoot.fingerprint },
      readerDbClient: readerClient,
      connectionIdentityProof: {
        provenance: test ? CONNECTION_IDENTITY_PROOF_CONTRACT.test_provenance : CONNECTION_IDENTITY_PROOF_CONTRACT.trusted_provenance,
        issuer: a.issuer, boundConnectionToken: a.connection.token, serviceId: a.target.pgServiceId, projectId: a.target.projectId, environmentId: a.target.environmentId,
      },
      expectedIssuer: trustRoot.issuer,
      connectionToken: session.token,
      readerPrivilegeProof: {
        provenance: test ? READER_PRIVILEGE_PROOF_CONTRACT.test_provenance : READER_PRIVILEGE_PROOF_CONTRACT.trusted_provenance,
        role: a.connection.role, pgServiceId: a.target.pgServiceId,
        effectiveSelectOnly: a.privileges.effectiveSelectOnly, writePrivilegeCount: a.privileges.writePrivilegeCount,
        selectGrantCount: a.privileges.selectGrantCount, forbiddenObjectAccessible: a.privileges.forbiddenObjectAccessible,
        unapprovedRoleMembership: a.privileges.unapprovedRoleMembership, unapprovedRoutineAuthority: a.privileges.unapprovedRoutineAuthority,
        boundReaderToken: a.connection.token, issuedAtMs: a.issuedAtMs,
      },
      registry: buildV2RegistrySupply(),
      sourcePin,
      nowProvider,
    };
  }
  return Object.freeze({
    mode, establish, renew, current, needsRenewal, acceptedAuthority, readerClient,
    invalidate: (reason) => invalidate(typeof reason === "string" ? reason : "invalidated"),
    onInvalid(cb) { listeners.add(cb); return () => listeners.delete(cb); },
    status() { const c = current(); return c.ok ? { status: "valid", expiresAtMs: c.expiresAtMs } : { status: state.status === "unestablished" ? "unestablished" : "invalid", reason: c.reason }; },
    async close() { invalidate("closed"); await closeSession(); },
  });
}
