// ─────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — P1-02 TRUSTED EXECUTOR RUNTIME — DB target-identity binding.
// OFFLINE, Node built-ins only. Performs NO connection itself.
//
// A PostgreSQL database name ("railway"), a project display name ("production"),
// a host label, or a caller-supplied assertion is NOT connection authority — both
// AI-STAGING and CORE-PROD can show environment "production" and DB "railway".
// This module defines the FAIL-CLOSED interface that binds an actual connection to
// the exact intended AI-STAGING PostgreSQL SERVICE identity via an INDEPENDENT proof
// (never a name), and refuses CORE-PROD. Offline no proof exists, so it fails closed.
// ─────────────────────────────────────────────────────────────────────────

import { FIXED } from "../trusted-activation-boundary-01/pricing-approval-contract.mjs";

// The independent connection-identity proof contract (what a REAL proof must attest).
// This is a future live-verification gate — a DB query alone can never satisfy it.
export const CONNECTION_IDENTITY_PROOF_CONTRACT = Object.freeze({
  contract: "AiStagingConnectionIdentityProofV1",
  must_attest: [
    "the live SQL connection terminates at Railway PostgreSQL SERVICE b7362594-... (by service identity, not DB/host name)",
    "that service belongs to Railway project 4ad1abb3-... environment aa397bd7-...",
    "the connection is NOT CORE-PROD service 1fbd7632-... / project 04c8b523-...",
    "evidence is from an independently controlled Railway/runtime source, not the operator or a DB self-report",
  ],
  trusted_provenance: "trusted-approved-connection-identity-proof",  // real (absent offline)
  test_provenance: "TEST-ONLY-connection-identity-proof",           // only under an explicit test boundary
});

function fail(reason) { return { ok: false, reason }; }

/**
 * Verify that an actual connection is bound to the exact intended AI-STAGING PG service.
 * The proof is only ever produced by the independent production authority (never the activation
 * caller). Beyond the AI-STAGING identity + CORE rejection, it must be bound to an INDEPENDENT
 * issuer AND to the ACTUAL connection token of the client it authorizes, so a bare object that
 * merely carries the (public) provenance string and expected IDs is NOT sufficient.
 * @param {object} args
 *  - expectedServiceId: required AI-STAGING PG service id (must equal FIXED.ai_staging_postgres)
 *  - expectedIssuer: the independently-configured proof issuer id (from the production authority)
 *  - connectionToken: the actual client's opaque connection token the proof must be bound to
 *  - connectionIdentityProof: { provenance, issuer, boundConnectionToken, serviceId, projectId,
 *      environmentId } issued by the INDEPENDENT proof source. Absent offline ⇒ fail closed.
 *  - testBoundary?: true ONLY inside an explicit offline test boundary.
 * Returns { ok:true, verifiedServiceId, verifiedProjectId } or { ok:false, reason }.
 */
export function verifyConnectionTargetBinding(args) {
  const { expectedServiceId, expectedIssuer, connectionToken, connectionIdentityProof, testBoundary } = args || {};
  if (expectedServiceId !== FIXED.ai_staging_postgres) return fail("expected_service_not_ai_staging");
  // CORE-PROD can never be the expected target.
  if (expectedServiceId === FIXED.core_excluded_postgres) return fail("expected_service_is_core_prod");

  if (!connectionIdentityProof || typeof connectionIdentityProof !== "object") return fail("connection_identity_proof_absent");
  const prov = connectionIdentityProof.provenance;
  const provOk = testBoundary === true
    ? prov === CONNECTION_IDENTITY_PROOF_CONTRACT.test_provenance
    : prov === CONNECTION_IDENTITY_PROOF_CONTRACT.trusted_provenance;
  if (!provOk) return fail("connection_identity_proof_untrusted"); // real independent proof absent offline ⇒ BLOCKED

  // issuer binding — the proof must be issued by the independently-configured issuer (a known
  // provenance string alone is NOT authority; the issuer is set by the production authority).
  if (typeof expectedIssuer !== "string" || expectedIssuer.trim() === "") return fail("expected_issuer_absent");
  if (connectionIdentityProof.issuer !== expectedIssuer) return fail("connection_proof_issuer_mismatch");
  // connection binding — the proof must be bound to the ACTUAL client connection token, so a
  // proof cannot be replayed against, or fabricated for, a different (e.g. synthetic) client.
  if (typeof connectionToken !== "string" || connectionToken.trim() === "") return fail("connection_token_absent");
  if (connectionIdentityProof.boundConnectionToken !== connectionToken) return fail("connection_proof_not_bound_to_client");

  // the proven connection service identity must be AI-STAGING and never CORE-PROD.
  if (connectionIdentityProof.serviceId === FIXED.core_excluded_postgres) return fail("connection_resolves_to_core_postgres");
  if (connectionIdentityProof.projectId === FIXED.core_excluded_project) return fail("connection_resolves_to_core_project");
  if (connectionIdentityProof.serviceId !== FIXED.ai_staging_postgres) return fail("connection_service_not_ai_staging");
  if (connectionIdentityProof.projectId !== FIXED.ai_staging_project) return fail("connection_project_not_ai_staging");
  if (connectionIdentityProof.environmentId !== FIXED.ai_staging_environment) return fail("connection_environment_not_ai_staging");

  return { ok: true, verifiedServiceId: FIXED.ai_staging_postgres, verifiedProjectId: FIXED.ai_staging_project };
}
