// ─────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — M7 STEP 2 — V2 PRODUCTION AUTHORITY contract + ACQUISITION SEAM (fail-closed default). OFFLINE.
//
// Successor of trusted-executor-runtime-01/production-authority.mjs +
// trusted-runtime-live-binding-offline-01/production-authority-composition.mjs (V1, frozen: V1 registry,
// V1 source pin 2b69ce). Preserves the accepted separation: the UNTRUSTED activation REQUEST may carry
// ONLY { approvalEnvelope, suppliedEvidence, executionId }; every dependency comes from an independently
// controlled authority that must pass validateProvisionedAuthorityV2.
//
// LIFECYCLE CORRECTION — the acquisition path is now CONCRETELY WIRED as a bounded COMPOSITION SEAM:
//   • acquireProductionAuthorityV2()            — no provisioner ⇒ deterministic UNPROVISIONED (the default;
//                                                  this repository provisions nothing).
//   • acquireProductionAuthorityV2(provisioner) — a provisioner is a FROZEN object
//                                                  { contract: PROVISIONER_CONTRACT_V2, acquire } handed in at
//                                                  COMPOSITION time by a future, separately authorized production
//                                                  entrypoint (see composeTrustedExecutorProductionV2). acquire()
//                                                  is called with NO arguments (a request can never reach it); its
//                                                  result must pass the FULL production bar below before use.
// There is NO global setter, NO module-level mutable slot, NO env JSON authority blob and NO request-borne
// authority. The authority is Phase-A (activation) authority: its source proof is the ActivationSourceProofV2.
// ─────────────────────────────────────────────────────────────────────────

import { CONNECTION_IDENTITY_PROOF_CONTRACT } from "../../trusted-executor-runtime-01/db-target-binding.mjs";
import { TARGETS_V2, RUNTIME_CONTRACT_VERSION } from "../identity/v2-identity.mjs";
import { checkActivationSourceProofV2 } from "../identity/v2-source-identity.mjs";
import { assertSuppliedRegistryV2, V2_REGISTRY_DIGEST } from "./v2-query-registry.mjs";

export const PRODUCTION_AUTHORITY_CONTRACT_V2 = Object.freeze({
  contract: "LiveAi03bTrustedExecutorProductionAuthorityV2",
  must_supply: [
    "cfg — loadRuntimeConfigV2 PASS (LIVE_AI_03B_RUNTIME_CONTRACT_VERSION=V2, AI-STAGING targets)",
    "trustRoot — the independently pinned reviewer PUBLIC key + fingerprint equal to cfg",
    "executorDbClient — restricted live_ai_03b_executor connection (EXECUTE on trusted_v2 only)",
    "readerDbClient — live_ai_03b_reader SELECT-only connection (a DIFFERENT client object)",
    "connectionIdentityProof + expectedIssuer + connectionToken — independent AI-STAGING identity proof bound to the actual client",
    "privilegeProof — independent restricted-role / credential-isolation proof object",
    "registry — the content-verified V2 read registry (assertSuppliedRegistryV2)",
    "activationSourceProof — LiveAi03bActivationSourceProofV2 { derivationBase 9270c282…, gatewayStaticSource (reviewed static PIN B 4f390b74…), step2Runtime (PRESERVED V2 binding) } — NO deployed gateway is required or accepted",
    "nowProvider — trusted clock",
  ],
  acquisition: "composition seam: acquireProductionAuthorityV2(provisioner) / composeTrustedExecutorProductionV2(provisioner); default (no provisioner) = UNPROVISIONED",
  unprovisioned_offline: true,
});
export const ALLOWED_REQUEST_KEYS_V2 = Object.freeze(["approvalEnvelope", "suppliedEvidence", "executionId"]);
export const REQUIRED_AUTHORITY_FIELDS_V2 = Object.freeze(["cfg", "trustRoot", "executorDbClient", "readerDbClient", "connectionIdentityProof",
  "expectedIssuer", "connectionToken", "privilegeProof", "registry", "activationSourceProof", "nowProvider"]);
export const PROVISIONER_CONTRACT_V2 = "LiveAi03bProductionAuthorityProvisionerV2";

const fail = (reason) => ({ ok: false, reason });
const REASON_SAFE = /[^A-Za-z0-9_.:-]/g;

export function rejectCallerSuppliedAuthorityV2(request) {
  const req = request && typeof request === "object" && !Array.isArray(request) ? request : {};
  for (const k of Object.keys(req)) if (!ALLOWED_REQUEST_KEYS_V2.includes(k)) return fail("production_rejects_caller_supplied_authority:" + k);
  return { ok: true };
}

/**
 * Acceptance bar for a provisioned authority. PRODUCTION (default): never satisfiable offline — it needs trusted
 * connection-identity provenance, non-fixture clients and a TRUSTED preserved PIN-C binding for the corrected
 * runtime (none exists). opts.testBoundary:true is used ONLY by the explicit isolated test composition.
 */
export function validateProvisionedAuthorityV2(candidate, opts) {
  const testBoundary = !!(opts && opts.testBoundary === true);
  const a = candidate && typeof candidate === "object" && !Array.isArray(candidate) ? candidate : null;
  if (!a) return fail("authority_absent");
  for (const k of Object.keys(a)) if (!REQUIRED_AUTHORITY_FIELDS_V2.includes(k)) return fail("authority_unexpected_field:" + String(k).replace(REASON_SAFE, "").slice(0, 48));
  for (const f of REQUIRED_AUTHORITY_FIELDS_V2) if (a[f] === undefined || a[f] === null) return fail("authority_missing_field:" + f);
  for (const c of ["executorDbClient", "readerDbClient"]) {
    if (typeof a[c].query !== "function") return fail("authority_db_client_invalid:" + c);
    if (!testBoundary && a[c].__testFixture === true) return fail("authority_rejects_test_fixture:" + c);
  }
  if (a.executorDbClient === a.readerDbClient) return fail("authority_executor_and_reader_share_a_client");
  if (!a.cfg || a.cfg.ok !== true || a.cfg.contractVersion !== RUNTIME_CONTRACT_VERSION || !a.cfg.reviewer || !a.cfg.targets) return fail("authority_cfg_not_v2");
  if (!a.trustRoot || typeof a.trustRoot !== "object") return fail("authority_trust_root_invalid");
  if (typeof a.trustRoot.pinnedPublicKeyDerB64 !== "string" || a.trustRoot.pinnedFingerprint !== a.cfg.reviewer.pinnedFingerprint) return fail("authority_trust_root_not_config_pinned");
  if (a.cfg.targets.pgServiceId !== TARGETS_V2.postgres || a.cfg.targets.pgServiceId === TARGETS_V2.core_excluded_postgres) return fail("authority_target_not_ai_staging");
  const p = a.connectionIdentityProof;
  const wantProv = testBoundary ? CONNECTION_IDENTITY_PROOF_CONTRACT.test_provenance : CONNECTION_IDENTITY_PROOF_CONTRACT.trusted_provenance;
  if (!p || typeof p !== "object" || p.provenance !== wantProv) return fail("authority_connection_proof_untrusted");
  if (typeof a.expectedIssuer !== "string" || p.issuer !== a.expectedIssuer) return fail("authority_connection_proof_issuer_unbound");
  if (typeof a.connectionToken !== "string" || p.boundConnectionToken !== a.connectionToken) return fail("authority_connection_proof_client_unbound");
  if (p.serviceId === TARGETS_V2.core_excluded_postgres || p.projectId === TARGETS_V2.core_excluded_project) return fail("authority_connection_proof_is_core");
  if (p.serviceId !== TARGETS_V2.postgres || p.projectId !== TARGETS_V2.project) return fail("authority_connection_proof_wrong_target");
  if (typeof a.privilegeProof !== "object" || a.privilegeProof.restricted_role_proof_present !== true) return fail("authority_privilege_proof_invalid");
  const reg = assertSuppliedRegistryV2(a.registry);
  if (!reg.ok) return fail("authority_query_registry_" + reg.reason);
  const sp = checkActivationSourceProofV2(a.activationSourceProof, { testBoundary });
  if (!sp.ok) return fail("authority_source_proof_" + sp.reason);
  if (typeof a.nowProvider !== "function") return fail("authority_clock_absent");
  return { ok: true, contract: PRODUCTION_AUTHORITY_CONTRACT_V2.contract, registryDigest: V2_REGISTRY_DIGEST, mode: testBoundary ? "test" : "production" };
}

/** Structural check of a provisioner (the composition-time dependency). */
export function checkProvisionerV2(provisioner) {
  const p = provisioner;
  if (!p || typeof p !== "object" || Array.isArray(p)) return fail("provisioner_absent");
  if (!Object.isFrozen(p)) return fail("provisioner_not_frozen");
  if (Object.keys(p).sort().join(",") !== "acquire,contract") return fail("provisioner_shape_not_exact");
  if (p.contract !== PROVISIONER_CONTRACT_V2) return fail("provisioner_contract_mismatch");
  if (typeof p.acquire !== "function") return fail("provisioner_acquire_absent");
  return { ok: true };
}

const UNPROVISIONED = Object.freeze({ available: false, reason: "v2_production_authority_unprovisioned" });

async function acquireWith(provisioner, testBoundary) {
  if (provisioner === undefined) return UNPROVISIONED; // the deterministic default of this repository state
  const pc = checkProvisionerV2(provisioner);
  if (!pc.ok) return Object.freeze({ available: false, reason: pc.reason });
  let got;
  try { got = await provisioner.acquire(); } catch { return Object.freeze({ available: false, reason: "provisioner_acquire_failed" }); }
  if (!got || typeof got !== "object" || got.available !== true) {
    const r = got && typeof got.reason === "string" ? got.reason.replace(REASON_SAFE, "").slice(0, 64) : "";
    return Object.freeze({ available: false, reason: r ? "provisioner_unavailable:" + r : "provisioner_unavailable" });
  }
  const v = validateProvisionedAuthorityV2(got.authority, { testBoundary });
  if (!v.ok) return Object.freeze({ available: false, reason: v.reason });
  const authority = Object.freeze(Object.fromEntries(REQUIRED_AUTHORITY_FIELDS_V2.map((k) => [k, got.authority[k]])));
  return Object.freeze({ available: true, authority, mode: v.mode });
}

/**
 * PRODUCTION acquisition. No argument ⇒ UNPROVISIONED (always, deterministically). With a composition-time
 * provisioner ⇒ the provisioner's authority, ONLY after it passes the full PRODUCTION bar.
 */
export async function acquireProductionAuthorityV2(provisioner) { return acquireWith(provisioner, false); }

/** TEST acquisition — explicit isolated test boundary only (synthetic fixtures / TEST provenances). */
export async function acquireAuthorityForTestV2(provisioner, opts) {
  if (!opts || opts.testBoundary !== true) return Object.freeze({ available: false, reason: "test_acquisition_requires_testBoundary_true" });
  if (provisioner === undefined) return UNPROVISIONED;
  return acquireWith(provisioner, true);
}
