// ─────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — M7 STEP 2 — V2 PRODUCTION AUTHORITY contract (fail-closed, UNPROVISIONED). OFFLINE.
//
// Successor of trusted-executor-runtime-01/production-authority.mjs +
// trusted-runtime-live-binding-offline-01/production-authority-composition.mjs (V1, frozen: V1 registry,
// V1 source pin 2b69ce). Preserves the accepted separation: the UNTRUSTED activation REQUEST may carry
// ONLY { approvalEnvelope, suppliedEvidence, executionId }; every dependency comes from an independently
// controlled authority that must pass validateProvisionedAuthorityV2. In this repository state the
// authority is UNPROVISIONED — there is no setter / injector / env switch, so production fails closed.
// ─────────────────────────────────────────────────────────────────────────

import { CONNECTION_IDENTITY_PROOF_CONTRACT } from "../../trusted-executor-runtime-01/db-target-binding.mjs";
import { TARGETS_V2, RUNTIME_CONTRACT_VERSION } from "../identity/v2-identity.mjs";
import { checkSourcePinV2 } from "../identity/v2-source-identity.mjs";
import { assertSuppliedRegistryV2, V2_REGISTRY_DIGEST } from "./v2-query-registry.mjs";

export const PRODUCTION_AUTHORITY_CONTRACT_V2 = Object.freeze({
  contract: "LiveAi03bTrustedExecutorProductionAuthorityV2",
  must_supply: [
    "cfg — loadRuntimeConfigV2 PASS (LIVE_AI_03B_RUNTIME_CONTRACT_VERSION=V2, AI-STAGING targets)",
    "trustRoot — the independently pinned reviewer PUBLIC key + fingerprint equal to cfg",
    "executorDbClient — restricted live_ai_03b_executor connection (EXECUTE on trusted_v2 only)",
    "readerDbClient — live_ai_03b_reader SELECT-only connection",
    "connectionIdentityProof + expectedIssuer + connectionToken — independent AI-STAGING identity proof bound to the actual client",
    "privilegeProof — independent restricted-role / credential-isolation proof object",
    "registry — the content-verified V2 read registry (assertSuppliedRegistryV2)",
    "sourcePin — LiveAi03bSourcePinV2 { derivationBase 9270c282…, gatewaySource 4f390b74… (observed), step2Runtime (PRESERVED binding) }",
    "nowProvider — trusted clock",
  ],
  unprovisioned_offline: true,
});
export const ALLOWED_REQUEST_KEYS_V2 = Object.freeze(["approvalEnvelope", "suppliedEvidence", "executionId"]);
export const REQUIRED_AUTHORITY_FIELDS_V2 = Object.freeze(["cfg", "trustRoot", "executorDbClient", "readerDbClient", "connectionIdentityProof",
  "expectedIssuer", "connectionToken", "privilegeProof", "registry", "sourcePin", "nowProvider"]);

const fail = (reason) => ({ ok: false, reason });

export function rejectCallerSuppliedAuthorityV2(request) {
  const req = request && typeof request === "object" && !Array.isArray(request) ? request : {};
  for (const k of Object.keys(req)) if (!ALLOWED_REQUEST_KEYS_V2.includes(k)) return fail("production_rejects_caller_supplied_authority:" + k);
  return { ok: true };
}

/** Acceptance bar for a FUTURE, separately authorized provisioning. Never satisfiable offline. */
export function validateProvisionedAuthorityV2(candidate) {
  const a = candidate && typeof candidate === "object" ? candidate : null;
  if (!a) return fail("authority_absent");
  for (const f of REQUIRED_AUTHORITY_FIELDS_V2) if (a[f] === undefined || a[f] === null) return fail("authority_missing_field:" + f);
  for (const c of ["executorDbClient", "readerDbClient"]) {
    if (typeof a[c].query !== "function") return fail("authority_db_client_invalid:" + c);
    if (a[c].__testFixture === true) return fail("authority_rejects_test_fixture:" + c);
  }
  if (a.executorDbClient === a.readerDbClient) return fail("authority_executor_and_reader_share_a_client");
  if (!a.cfg || a.cfg.ok !== true || a.cfg.contractVersion !== RUNTIME_CONTRACT_VERSION || !a.cfg.reviewer || !a.cfg.targets) return fail("authority_cfg_not_v2");
  if (!a.trustRoot || typeof a.trustRoot !== "object") return fail("authority_trust_root_invalid");
  if (typeof a.trustRoot.pinnedPublicKeyDerB64 !== "string" || a.trustRoot.pinnedFingerprint !== a.cfg.reviewer.pinnedFingerprint) return fail("authority_trust_root_not_config_pinned");
  if (a.cfg.targets.pgServiceId !== TARGETS_V2.postgres || a.cfg.targets.pgServiceId === TARGETS_V2.core_excluded_postgres) return fail("authority_target_not_ai_staging");
  const p = a.connectionIdentityProof;
  if (!p || p.provenance !== CONNECTION_IDENTITY_PROOF_CONTRACT.trusted_provenance) return fail("authority_connection_proof_untrusted");
  if (typeof a.expectedIssuer !== "string" || p.issuer !== a.expectedIssuer) return fail("authority_connection_proof_issuer_unbound");
  if (typeof a.connectionToken !== "string" || p.boundConnectionToken !== a.connectionToken) return fail("authority_connection_proof_client_unbound");
  if (p.serviceId !== TARGETS_V2.postgres || p.projectId !== TARGETS_V2.project) return fail("authority_connection_proof_wrong_target");
  if (typeof a.privilegeProof !== "object" || a.privilegeProof.restricted_role_proof_present !== true) return fail("authority_privilege_proof_invalid");
  const reg = assertSuppliedRegistryV2(a.registry);
  if (!reg.ok) return fail("authority_query_registry_" + reg.reason);
  const sp = checkSourcePinV2(a.sourcePin, { testBoundary: false });
  if (!sp.ok) return fail("authority_source_pin_" + sp.reason);
  if (typeof a.nowProvider !== "function") return fail("authority_clock_absent");
  return { ok: true, contract: PRODUCTION_AUTHORITY_CONTRACT_V2.contract, registryDigest: V2_REGISTRY_DIGEST };
}

const UNPROVISIONED = Object.freeze({ available: false, reason: "v2_production_authority_unprovisioned" });
/** The ONLY value this repository state can return. A future deployment replaces this module. */
export async function acquireProductionAuthorityV2() { return UNPROVISIONED; }
