// ─────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — M7 V2 PRODUCTION AUTHORITY PROVISIONING — INDEPENDENT per-role connection binding. OFFLINE candidate.
//
// TWO-CLIENT AUDIT RESULT (see README.md §3). The preserved V2 authority shape carries ONE
// connectionIdentityProof / expectedIssuer / connectionToken, which the frozen runtime re-verifies (and which it
// then applies to BOTH adapters). One proof never authenticates two connections. This module therefore binds EACH
// actual client INDEPENDENTLY, BEFORE the frozen authority exists:
//   • executor: an AiStagingExecutorAttestationV1 bound to the executor connection token + its own nonce;
//   • reader:   an AiStagingReaderAttestationV1 (the accepted contract, verified by the accepted
//               verifyReaderAttestation) bound to the reader connection token + its own nonce;
// each yields its OWN frozen-shape connection-identity proof that is checked with the accepted
// verifyConnectionTargetBinding against its OWN token. The two bindings must be pairwise distinct (role, token,
// backend pid, application name, nonce), so a proof/token for one client can never authorize the other.
// Only after both pass is the frozen authority assembled — its single proof slot carries the EXECUTOR proof (the
// frozen runtime re-verifies it); the reader binding is enforced by this layer and by the sealed reader guard
// (guarded-clients.mjs). The runtime can therefore never be fed an unverified second client.
// ─────────────────────────────────────────────────────────────────────────
import { CONNECTION_IDENTITY_PROOF_CONTRACT, verifyConnectionTargetBinding } from "../../trusted-executor-runtime-01/db-target-binding.mjs";
import { verifyReaderAttestation, ATTESTATION_CONTRACT as READER_ATTESTATION_CONTRACT } from "../../private-reader-production-integration-offline-01/reader-attestation.mjs";
import { READER_ROLE } from "../../private-reader-host-runtime-offline-01/reader-only-authority.mjs";
import { TARGETS_V2 } from "../../m7-step2-runtime-rebinding-offline-01/identity/v2-identity.mjs";
import { verifyExecutorAttestation, EXECUTOR_ATTESTATION_CONTRACT } from "./executor-attestation.mjs";
import { EXECUTOR_ROLE } from "./executor-session.mjs";

export { READER_ATTESTATION_CONTRACT, EXECUTOR_ATTESTATION_CONTRACT };
const fail = (reason) => ({ ok: false, reason });

function identityProofFrom(att, trustRoot, token, testBoundary) {
  return Object.freeze({
    provenance: testBoundary ? CONNECTION_IDENTITY_PROOF_CONTRACT.test_provenance : CONNECTION_IDENTITY_PROOF_CONTRACT.trusted_provenance,
    issuer: trustRoot.issuer, boundConnectionToken: token,
    serviceId: att.target.pgServiceId, projectId: att.target.projectId, environmentId: att.target.environmentId,
  });
}

function checkRootMode(trustRoot, testBoundary) {
  if (!trustRoot || typeof trustRoot !== "object") return fail("attester_trust_root_absent");
  if (!testBoundary && trustRoot.test === true) return fail("attester_trust_root_is_test_only");
  if (testBoundary && trustRoot.test !== true) return fail("test_boundary_requires_test_attester");
  return { ok: true };
}

/** Bind the EXECUTOR connection. Returns { ok, binding:{ role, token, pid, applicationName, nonce, identityProof, expectedIssuer, privileges } }. */
export function bindExecutorConnection({ session, envelope, trustRoot, requestNonce, nowMs, testBoundary }) {
  const rm = checkRootMode(trustRoot, testBoundary === true); if (!rm.ok) return rm;
  if (!session || !session.identity || session.identity.role !== EXECUTOR_ROLE) return fail("executor_session_absent");
  const v = verifyExecutorAttestation(envelope, { trustRoot, expectedConnectionToken: session.token, expectedRequestNonce: requestNonce, now: nowMs });
  if (!v.ok) return v;
  const proof = identityProofFrom(v.attestation, trustRoot, session.token, testBoundary === true);
  const tb = verifyConnectionTargetBinding({ expectedServiceId: TARGETS_V2.postgres, expectedIssuer: trustRoot.issuer, connectionToken: session.token,
    connectionIdentityProof: proof, testBoundary: testBoundary === true });
  if (!tb.ok) return fail("executor_" + tb.reason);
  return { ok: true, binding: Object.freeze({ role: EXECUTOR_ROLE, token: session.token, pid: session.identity.pid, applicationName: session.identity.applicationName,
    nonce: requestNonce, identityProof: proof, expectedIssuer: trustRoot.issuer, privileges: v.attestation.privileges }) };
}

/** Bind the READER connection with the ACCEPTED reader attestation contract + verifier. */
export function bindReaderConnection({ session, envelope, trustRoot, requestNonce, nowMs, testBoundary }) {
  const rm = checkRootMode(trustRoot, testBoundary === true); if (!rm.ok) return rm;
  if (!session || !session.identity || typeof session.token !== "string") return fail("reader_session_absent");
  const v = verifyReaderAttestation(envelope, { trustRoot, expectedConnectionToken: session.token, expectedRequestNonce: requestNonce, now: nowMs });
  if (!v.ok) return fail("reader_" + v.reason);
  if (v.attestation.connection.role !== READER_ROLE) return fail("reader_attestation_role_mismatch");
  const proof = identityProofFrom(v.attestation, trustRoot, session.token, testBoundary === true);
  const tb = verifyConnectionTargetBinding({ expectedServiceId: TARGETS_V2.postgres, expectedIssuer: trustRoot.issuer, connectionToken: session.token,
    connectionIdentityProof: proof, testBoundary: testBoundary === true });
  if (!tb.ok) return fail("reader_" + tb.reason);
  return { ok: true, binding: Object.freeze({ role: READER_ROLE, token: session.token, pid: session.identity.pid, applicationName: session.identity.applicationName,
    nonce: requestNonce, identityProof: proof, expectedIssuer: trustRoot.issuer, privileges: v.attestation.privileges,
    statementTimeoutMs: session.effectiveStatementTimeoutMs }) };
}

/** The two bindings must be two DIFFERENT connections with two DIFFERENT roles; no field may be shared. */
export function checkDistinctBindings(ex, rd) {
  if (!ex || !rd) return fail("binding_absent");
  if (ex.role !== EXECUTOR_ROLE || rd.role !== READER_ROLE) return fail("binding_roles_not_executor_and_reader");
  if (ex.token === rd.token) return fail("executor_and_reader_share_a_connection_token");
  if (ex.pid === rd.pid) return fail("executor_and_reader_share_a_backend");
  if (ex.applicationName === rd.applicationName) return fail("executor_and_reader_share_an_application_name");
  if (ex.nonce === rd.nonce) return fail("executor_and_reader_share_a_request_nonce");
  if (ex.identityProof.boundConnectionToken === rd.identityProof.boundConnectionToken) return fail("identity_proofs_bound_to_one_connection");
  return { ok: true };
}
