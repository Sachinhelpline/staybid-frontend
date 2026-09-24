// ─────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — reader-only PRODUCTION AUTHORITY constructor + continuous LIFECYCLE (OFFLINE).
//
// Supplies the accepted serving runtime (private-reader-host-runtime-offline-01, frozen) with a
// reader-ONLY authority through its supported `acquireReaderAuthority` interface, and keeps that
// authority honest for as long as it serves:
//   • establish(): open ONE physical reader connection → enforce + read back statement_timeout →
//     read own identity → request a signed attestation bound to that connection token + a fresh nonce
//     → verify it against the deployment-pinned trust root → VALID.
//   • readerClient: the stable object handed to the accepted host. Its query() is the enforcement
//     point: it admits only the fixed reviewed registry SQL, checks authority validity (fresh, bound to
//     the CURRENT live physical connection) immediately before issuing the statement, and re-checks
//     after the result (a result obtained across an expiry/reconnect/drift is discarded). No query can
//     begin under expired or invalid authority. It never exposes the physical connection.
//   • renew(): self-check the SAME session + fresh attestation; drift ⇒ immediate invalidation; a
//     failed renewal never extends the previous proof beyond its own expiry.
//   • connection loss ⇒ immediate invalidation; reconnect() builds a NEW session that must pass every
//     check again (a proof bound to the old connection token can never validate the new one).
// No executorDbClient, executor credential or privileged client exists anywhere in this module.
// ─────────────────────────────────────────────────────────────────────────
import { randomBytes } from "node:crypto";
import { FIXED } from "../trusted-activation-boundary-01/pricing-approval-contract.mjs";
import { CONNECTION_IDENTITY_PROOF_CONTRACT } from "../trusted-executor-runtime-01/db-target-binding.mjs";
import { CANDIDATE_QUERY_REGISTRY, buildReviewedStateQueries } from "../trusted-runtime-live-binding-offline-01/production-read-queries.mjs";
import { READER_ROLE, READER_PRIVILEGE_PROOF_CONTRACT } from "../private-reader-host-runtime-offline-01/reader-only-authority.mjs";
import { verifyReaderAttestation, isDriftReason } from "./reader-attestation.mjs";
import { establishReaderSession, recheckReaderSession } from "./reader-session.mjs";
import { CHANNEL_FAILURE_CODES } from "./attestation-source-channel.mjs";
const CHANNEL_CODES = new Set(CHANNEL_FAILURE_CODES);

export const AUTHORITY_INTEGRATION_VERSION = "reader-production-authority-v1";
// Observation SQL the reader host may issue = the pinned reviewed registry MINUS the executor-side
// ledger query (the reader host's three observations never use it).
export const READER_OBSERVATION_SQL = Object.freeze(Object.entries(CANDIDATE_QUERY_REGISTRY).filter(([k]) => k !== "ledgerCommitted").map(([, v]) => v));
const ALLOWED_SQL = new Set(READER_OBSERVATION_SQL);
export const DEFAULT_RENEW_AFTER_MS = 120000; // renew well inside the ≤5-minute proof lifetime
const REFUSED = "reader_authority_refused";    // fixed error text — no detail leaves this module

function fail(reason) { return { ok: false, reason }; }
function validParams(params) {
  return Array.isArray(params) && params.length <= 4 && params.every((p) => (typeof p === "string" && p.length <= 256) || Number.isSafeInteger(p));
}

/**
 * @param opts.mode 'production' | 'offline-test' (offline-test maps to the accepted TEST provenance +
 *   accepted testBoundary; production maps to the accepted TRUSTED provenance)
 * @param opts.physicalFactory { open() → physical } (production: real pg factory)
 * @param opts.attestationSource { obtain({ contract, connectionToken, role, requestNonce }) → envelope }
 * @param opts.trustRoot pinned attester trust root (from makeAttesterTrustRoot)
 * @param opts.statementTimeoutMs requested session statement_timeout (≤ 2000)
 * @param opts.nowProvider trusted clock
 */
export function createReaderAuthorityManager(opts) {
  const { mode, physicalFactory, attestationSource, trustRoot, statementTimeoutMs, nowProvider, renewAfterMs = DEFAULT_RENEW_AFTER_MS } = opts || {};
  if (mode !== "production" && mode !== "offline-test") throw new Error("authority_mode_invalid");
  if (mode === "production" && (!trustRoot || trustRoot.test === true)) throw new Error("production_refuses_test_trust_root");
  const now = () => nowProvider();
  let state = { status: "unestablished", reason: "not_established" };
  let session = null; let attestation = null; let epoch = 0; let establishing = false;
  const listeners = new Set();

  function invalidate(reason) {
    if (state.status === "invalid" && state.reason) { attestation = null; return; }
    state = { status: "invalid", reason };
    attestation = null;
    epoch++;
    for (const cb of listeners) { try { cb(reason); } catch {} }
  }

  /** Live validity — recomputed on every call; never a cached readiness flag. */
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
    catch (err) { return fail(err && CHANNEL_CODES.has(err.code) ? err.code : "attestation_unavailable"); } // fixed codes only
    return verifyReaderAttestation(envelope, { trustRoot, expectedConnectionToken: sess.token, expectedRequestNonce: requestNonce, now: now() });
  }

  async function closeSession() {
    const s = session; session = null;
    if (s) { try { await s.physical.close(); } catch {} }
  }

  async function establish() {
    if (establishing) return fail("establish_in_progress");
    establishing = true;
    try {
      invalidate("re_establishing");
      await closeSession();
      if (!trustRoot) return fail("trust_root_absent");
      if (!attestationSource || typeof attestationSource.obtain !== "function") { state = { status: "invalid", reason: "attestation_source_unprovisioned" }; return fail("attestation_source_unprovisioned"); } // before ANY DB connection
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
    const c = current();
    if (!c.ok) return fail(c.reason);
    const sess = session; const myEpoch = epoch;
    const rc = await recheckReaderSession(sess);
    if (epoch !== myEpoch) return fail("superseded");
    if (!rc.ok) { invalidate(rc.reason); return fail(rc.reason); }
    const v = await attest(sess);
    if (epoch !== myEpoch) return fail("superseded");
    if (!v.ok) {
      // a genuinely signed attestation reporting drift revokes immediately; any other failure keeps the
      // PREVIOUS proof only until its own expiry (current() enforces that) — never beyond it.
      if (isDriftReason(v.reason)) invalidate(v.reason);
      return fail(v.reason);
    }
    attestation = v.attestation;
    return { ok: true };
  }

  // renew at renewAfterMs, or at half the attester-chosen lifetime if that is shorter
  function needsRenewal() { const c = current(); return c.ok && now() - c.issuedAtMs >= Math.min(renewAfterMs, Math.floor((c.expiresAtMs - c.issuedAtMs) / 2)); }

  // The ONLY client the accepted host ever receives. No __testFixture flag; no physical exposure.
  const readerClient = Object.freeze({
    async query(sql, params) {
      if (typeof sql !== "string" || !ALLOWED_SQL.has(sql) || !validParams(params === undefined ? [] : params)) throw new Error(REFUSED);
      const before = current();
      if (!before.ok) throw new Error(REFUSED);                          // no statement is issued
      const sess = session;
      const r = await sess.physical.query(sql, params || []);
      const after = current();
      if (!after.ok || after.epoch !== before.epoch || after.token !== before.token) throw new Error(REFUSED); // late result discarded
      return r;
    },
    get statementTimeoutMs() { return session ? session.effectiveStatementTimeoutMs : undefined; }, // VERIFIED effective value
  });

  /** Build the accepted reader-only authority (reader-only-authority-v1) from the CURRENT verified state.
   *  The accepted proof objects are derived ONLY from a signature-verified attestation. */
  function acceptedAuthority() {
    const c = current();
    if (!c.ok) return null;
    const a = attestation; const test = mode === "offline-test";
    return {
      cfg: { ok: true, reviewer: { pinnedPublicKeyDerB64: trustRoot.publicKeyDerB64, pinnedFingerprint: trustRoot.fingerprint },
        targets: { projectId: a.target.projectId, environmentId: a.target.environmentId, pgServiceId: a.target.pgServiceId } },
      trustRoot: { pinnedPublicKeyDerB64: trustRoot.publicKeyDerB64, pinnedFingerprint: trustRoot.fingerprint },
      readerDbClient: readerClient,
      connectionIdentityProof: {
        provenance: test ? CONNECTION_IDENTITY_PROOF_CONTRACT.test_provenance : CONNECTION_IDENTITY_PROOF_CONTRACT.trusted_provenance,
        issuer: a.issuer, boundConnectionToken: a.connection.token,
        serviceId: a.target.pgServiceId, projectId: a.target.projectId, environmentId: a.target.environmentId,
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
      reviewedStateQueries: buildReviewedStateQueries(),
      sourcePin: { commit: FIXED.source_commit, integration: AUTHORITY_INTEGRATION_VERSION },
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
