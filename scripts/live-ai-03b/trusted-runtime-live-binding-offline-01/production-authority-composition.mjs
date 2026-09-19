// ─────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — P1-02 production-authority COMPOSITION (fail-closed, OFFLINE).
// Node built-ins only. No live connection/credential/provider/deploy.
//
// TASK C — a candidate, fail-closed production-authority composition compatible with the
// accepted trusted-executor runtime (trusted-executor-runtime-01), binding the four new
// reviewed read queries (Task A) + the reader-role proposal (Task B) into what a REAL
// deployment authority must supply. It PRESERVES the accepted separation between the
// UNTRUSTED ACTIVATION REQUEST and the INDEPENDENTLY-CONTROLLED PRODUCTION AUTHORITY.
//
// It does NOT modify the frozen 19+14 files and does NOT make the frozen production
// entrypoint reachable: the frozen acquireProductionAuthority() stays UNPROVISIONED, and
// this module's own acquireComposedProductionAuthority() is ALSO unprovisioned offline.
// It self-certifies NOTHING — no constructed object, known string, caller boolean or
// synthetic fixture becomes authority; genuine authority requires real, credential-isolated
// capabilities that cannot exist offline. This is a FUTURE-integration candidate for
// separately authorized review + wiring, not an operational provider.
// ─────────────────────────────────────────────────────────────────────────

import { PRODUCTION_AUTHORITY_CONTRACT } from "../trusted-executor-runtime-01/production-authority.mjs";
import { CONNECTION_IDENTITY_PROOF_CONTRACT } from "../trusted-executor-runtime-01/db-target-binding.mjs";
import { FIXED } from "../trusted-activation-boundary-01/pricing-approval-contract.mjs";
import { CANDIDATE_REGISTRY_DIGEST, assertSuppliedRegistry } from "./production-read-queries.mjs";

// the activation REQUEST caller may supply ONLY these keys (mirrors the accepted runtime).
export const ALLOWED_REQUEST_KEYS = Object.freeze(["approvalEnvelope", "suppliedEvidence", "executionId"]);
// dependencies the caller must NEVER inject (acquired only from the independent authority).
export const CALLER_FORBIDDEN_DEPENDENCIES = Object.freeze([
  "executorDbClient", "readerDbClient", "trustRoot", "trustRootProvider", "connectionIdentityProof",
  "expectedIssuer", "connectionToken", "privilegeProof", "reviewedStateQueries", "sourcePin",
  "nowProvider", "env", "testBoundary", "mode",
]);
// fields a provisioned authority MUST supply (independent of the caller).
export const REQUIRED_AUTHORITY_FIELDS = Object.freeze([
  "cfg", "trustRoot", "executorDbClient", "readerDbClient", "connectionIdentityProof",
  "expectedIssuer", "connectionToken", "privilegeProof", "reviewedStateQueries", "sourcePin", "nowProvider",
]);

function fail(reason) { return { ok: false, reason }; }

/** Reject any activation request that carries caller-supplied authority (whitelist enforced). */
export function rejectCallerSuppliedAuthority(request) {
  const req = request && typeof request === "object" ? request : {};
  for (const k of Object.keys(req)) if (!ALLOWED_REQUEST_KEYS.includes(k)) return fail("production_rejects_caller_supplied_authority:" + k);
  return { ok: true };
}

/**
 * Validate a would-be provisioned authority (production). Fails closed on anything that is
 * missing, test-tainted, self-certified, caller-injectable, or not registry/issuer/target bound.
 * This is NEVER satisfied offline (no real capabilities exist); it defines the acceptance bar for
 * a future, separately authorized provisioning.
 */
export function validateProvisionedAuthority(candidate, opts) {
  const a = candidate && typeof candidate === "object" ? candidate : null;
  if (!a) return fail("authority_absent");
  if (opts && opts.testBoundary === true) return fail("production_validation_rejects_test_boundary");
  // structural presence
  for (const f of REQUIRED_AUTHORITY_FIELDS) if (a[f] === undefined || a[f] === null) return fail("authority_missing_field:" + f);
  // real (not synthetic/mock) DB clients — a __testFixture marker is rejected, and its ABSENCE is
  // NOT treated as proof of production trust (custody is established by the deployment, not here).
  for (const c of ["executorDbClient", "readerDbClient"]) {
    if (typeof a[c].query !== "function") return fail("authority_db_client_invalid:" + c);
    if (a[c].__testFixture === true) return fail("authority_rejects_test_fixture:" + c);
  }
  // trust root pinned to config (independent of the operator envelope)
  if (typeof a.trustRoot.pinnedPublicKeyDerB64 !== "string" || typeof a.trustRoot.pinnedFingerprint !== "string") return fail("authority_trust_root_invalid");
  if (!a.cfg || a.cfg.ok !== true || !a.cfg.reviewer || a.trustRoot.pinnedFingerprint !== a.cfg.reviewer.pinnedFingerprint) return fail("authority_trust_root_not_config_pinned");
  // target = AI-STAGING, never CORE
  if (a.cfg.targets.pgServiceId !== FIXED.ai_staging_postgres) return fail("authority_target_not_ai_staging");
  if (a.cfg.targets.pgServiceId === FIXED.core_excluded_postgres) return fail("authority_target_is_core");
  // connection proof: independent trusted provenance + issuer + client-token bound (not a bare string)
  const p = a.connectionIdentityProof;
  if (!p || typeof p !== "object" || p.provenance !== CONNECTION_IDENTITY_PROOF_CONTRACT.trusted_provenance) return fail("authority_connection_proof_untrusted");
  if (typeof a.expectedIssuer !== "string" || p.issuer !== a.expectedIssuer) return fail("authority_connection_proof_issuer_unbound");
  if (typeof a.connectionToken !== "string" || p.boundConnectionToken !== a.connectionToken) return fail("authority_connection_proof_client_unbound");
  if (p.serviceId !== FIXED.ai_staging_postgres || p.projectId !== FIXED.ai_staging_project) return fail("authority_connection_proof_wrong_target");
  // privilege proof must be an independent proof object (NOT a bare boolean)
  if (typeof a.privilegeProof !== "object" || a.privilegeProof.restricted_role_proof_present !== true) return fail("authority_privilege_proof_invalid");
  // reviewed query registry (FINDING 2): validate the ACTUAL SUPPLIED SQL content, never a copied
  // digest marker. assertSuppliedRegistry reconstructs the full registry from the supplied reviewed
  // SQL + the frozen catalog/ledger queries, recomputes the canonical digest and requires it to
  // equal the pinned CANDIDATE_REGISTRY_DIGEST, requires the supplied marker to equal that recomputed
  // digest, and requires each supplied query to be byte-identical to the pinned constant. A correct
  // digest marker accompanying substituted SQL fails closed.
  const supInteg = assertSuppliedRegistry(a.reviewedStateQueries);
  if (!supInteg.ok) return fail("authority_query_registry_" + supInteg.reason);
  if (supInteg.digest !== CANDIDATE_REGISTRY_DIGEST) return fail("authority_query_registry_not_pinned");
  // clock + source pin present
  if (typeof a.nowProvider !== "function") return fail("authority_clock_absent");
  if (!a.sourcePin || typeof a.sourcePin !== "object") return fail("authority_source_pin_absent");
  return { ok: true, contract: PRODUCTION_AUTHORITY_CONTRACT.contract, registryDigest: CANDIDATE_REGISTRY_DIGEST };
}

// UNPROVISIONED sentinel — the only value this repository state can return. There is deliberately
// no exported setter/injector: a caller cannot install authority at runtime.
const UNPROVISIONED = Object.freeze({ available: false, reason: "composed_production_authority_unprovisioned" });

/**
 * Acquire the composed production authority. Offline it is UNPROVISIONED (fail closed) — real
 * credential-isolated clients, an independently issued connection proof, an independently issued
 * privilege proof and the pinned reviewer trust root cannot exist here. A future deployment
 * replaces this module with one that constructs a candidate and returns
 * { available:true, authority } ONLY after validateProvisionedAuthority() passes. This candidate
 * is NOT wired into the frozen production entrypoint (that remains its own UNPROVISIONED authority).
 */
export async function acquireComposedProductionAuthority() {
  return UNPROVISIONED;
}

export const COMPOSITION_RULES = Object.freeze({
  untrusted_request_only: ALLOWED_REQUEST_KEYS,
  caller_forbidden: CALLER_FORBIDDEN_DEPENDENCIES,
  authority_required: REQUIRED_AUTHORITY_FIELDS,
  no_self_certification: "a constructed object / known provenance string / caller boolean / synthetic fixture / exported test factory is NEVER authority",
  no_prod_to_test_fallback: true,
  no_public_endpoint: true,
  no_auto_activation_on_import: true,
  frozen_entrypoint_untouched: "does not modify or reach the frozen production entrypoint; frozen authority stays unprovisioned",
});
