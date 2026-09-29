// TEST-ONLY helpers for the M7 Step-2 offline suite. SYNTHETIC reviewer key (generated per run, never
// persisted), synthetic ids, TEST-ONLY provenances. Never imported by any runtime module (static-scan asserted).
import { generateKeyPairSync, sign } from "node:crypto";
import * as C from "../../m7-step1-hb1-consolidated-remediation-01/approval/pricing-approval-contract-v2.mjs";
import * as G from "../../m7-step1-hb1-consolidated-remediation-01/catalog/v2-digest-gen.mjs";
import { TEST_LEDGER_PROVENANCE } from "../../m7-step1-hb1-consolidated-remediation-01/approval/approval-verify-v2.mjs";
import { CONNECTION_IDENTITY_PROOF_CONTRACT } from "../../trusted-executor-runtime-01/db-target-binding.mjs";
import { CATALOG_V2, V1_HISTORICAL, POLICY_V2, CONTROLS_V2, DORMANT_V2_VIEW, TARGETS_V2, STORE_BINDING_REF, REQUIRED_ENV_NAMES_GATEWAY, REQUIRED_ENV_NAMES_BROKER } from "../identity/v2-identity.mjs";
import { DERIVATION_BASE, GATEWAY_DEPLOY_SOURCE_V2, STEP2_BINDING_CONTRACT, STEP2_PIN_STATUS_PRESERVED, STEP2_TEST_PROVENANCE, measureRuntimeManifest,
  ACTIVATION_SOURCE_PROOF_CONTRACT_V2, PRE_PROBE_SOURCE_PROOF_CONTRACT_V2, GATEWAY_DEPLOYMENT_OBSERVATION_KIND, GATEWAY_OBSERVATION_TEST_PROVENANCE,
  HISTORICAL_STEP2_PRESERVATION, ACCEPTED_M5_CLOSURE, staticGatewaySourceIdentityV2 } from "../identity/v2-source-identity.mjs";
import { REQUIRED_ENV_NAMES_V2 } from "../runtime/v2-runtime-config.mjs";

export const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
export const clone = (x) => JSON.parse(JSON.stringify(x));

export function makeReviewer() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const der = publicKey.export({ type: "spki", format: "der" }).toString("base64");
  const fp = C.publicKeyFingerprintFromDerB64(der);
  return { trustRoot: { pinnedPublicKeyDerB64: der, pinnedFingerprint: fp }, fp, sign: (payload) => sign(null, Buffer.from(C.canonicalize(payload), "utf8"), privateKey).toString("base64") };
}

/** A reviewer-signed V2 approval envelope + the matching supplied evidence, windows around `nowMs`. */
export function makeApproval(rv, { approvalId = "m7s2-approval-0001", executionId = "m7s2-exec-0001", nowMs = Date.now(), mutate } = {}) {
  const exp = Date.parse(G.T0_PLUS_7_DAYS);
  const content = C.buildEvidenceContentV2(G.T0);
  const digest = C.evidenceContentDigestV2(content);
  const winEnd = iso(Math.min(nowMs + 3600e3, exp));
  let payload = C.buildApprovalPayloadV2({
    approval_id: approvalId, reviewer_public_key_fingerprint: rv.fp,
    evidence: { receipt_id: "m7s2-test-receipt-0001", content_digest: digest, verified_at: G.T0, evidence_expiry: winEnd },
    scope: { openai_account_ref: "acct-ref-synthetic", openai_project_ref: "proj-ref-synthetic" },
    execution: { execution_id: executionId, issued_at: iso(Math.max(nowMs - 600e3, Date.parse(G.T0))), not_before: iso(Math.max(nowMs - 600e3, Date.parse(G.T0))), expiry: winEnd },
  });
  if (mutate) payload = mutate(clone(payload));
  return { envelope: { alg: "ed25519", payload, signature_b64: rv.sign(payload) }, suppliedEvidence: { id: "m7s2-test-receipt-0001", digest, content }, approvalId, executionId };
}

/** A synthetic TEST-provenance PIN-C V2 binding for the CORRECTED runtime (never a real commit). */
export function testStep2Binding(over = {}) {
  return { contract: STEP2_BINDING_CONTRACT, status: STEP2_PIN_STATUS_PRESERVED, provenance: STEP2_TEST_PROVENANCE,
    commit: "5e2c0de5e2c0de5e2c0de5e2c0de5e2c0de5e2c0", tree: "7ee57ee57ee57ee57ee57ee57ee57ee57ee57ee5",
    step2_dir_tree: "d12d12d12d12d12d12d12d12d12d12d12d12d12d", runtime_manifest_digest: measureRuntimeManifest().digest,
    correction_base: ACCEPTED_M5_CLOSURE.commit, historical_pin_c: HISTORICAL_STEP2_PRESERVATION.commit, ...over };
}
/** A synthetic TEST-provenance observation of a HEALTHY gateway deployed from exactly PIN B. */
export function testDeployedGateway(over = {}) {
  return { kind: GATEWAY_DEPLOYMENT_OBSERVATION_KIND, observation_provenance: GATEWAY_OBSERVATION_TEST_PROVENANCE, healthy: true,
    deployed_commit: GATEWAY_DEPLOY_SOURCE_V2.commit, deployed_tree: GATEWAY_DEPLOY_SOURCE_V2.tree,
    gateway_deployment_revision: GATEWAY_DEPLOY_SOURCE_V2.commit, voice_gateway_tree: GATEWAY_DEPLOY_SOURCE_V2.voice_gateway_tree, ...over };
}
/** Phase-A proof: PIN A + the reviewed STATIC PIN-B literal + PIN C. No deployment observation exists or is needed. */
export function testActivationSourceProof(over = {}) {
  return { contract: ACTIVATION_SOURCE_PROOF_CONTRACT_V2, derivationBase: { commit: DERIVATION_BASE.commit, tree: DERIVATION_BASE.tree },
    gatewayStaticSource: staticGatewaySourceIdentityV2(), step2Runtime: testStep2Binding(), ...over };
}
/** Phase-B proof: PIN A + an independent HEALTHY deployed PIN-B observation + PIN C. */
export function testPreProbeSourceProof(over = {}) {
  return { contract: PRE_PROBE_SOURCE_PROOF_CONTRACT_V2, derivationBase: { commit: DERIVATION_BASE.commit, tree: DERIVATION_BASE.tree },
    gatewayDeployment: testDeployedGateway(), step2Runtime: testStep2Binding(), ...over };
}

const CAT_BASE = { catalog_version_count: 2, catalog_entry_count: 5, v1_inactive_digest: V1_HISTORICAL.inactive_digest, v1_inactive_entry_count: 2,
  v1_expiry_is_historical: true, v2_entry_count: 3, v2_input_rate_micros: 2000000, v2_cache_write_rate_micros: 2500000, v2_output_rate_micros: 12000000 };
const POL_BASE = { dormant_policy_present: true, obsolete_v1_policy_present: false, wildcard_policy_present: false };
const ctl = (epoch, enabled, g, p) => ({ control_row_count: 2, global_control_epoch: epoch, project_control_epoch: epoch, global_control_enabled: enabled,
  project_control_enabled: enabled, global_control_killed: false, project_control_killed: false, control_global_digest: g, control_project_digest: p });
export const STATES = Object.freeze({
  pre: () => ({ ...CAT_BASE, active_catalog_count: 0, active_catalog_entry_count: 0, v2_inactive_digest: CATALOG_V2.inactive_digest, v2_inactive_entry_count: 3,
    active_policy_count: 0, policy_version_count: 1, ...POL_BASE, v2_policy_present: false, ...ctl(1, false, DORMANT_V2_VIEW.control_global_digest, DORMANT_V2_VIEW.control_project_digest) }),
  activated: () => ({ ...CAT_BASE, active_catalog_count: 1, active_catalog_entry_count: 3, v2_active_digest: CATALOG_V2.active_digest, v2_active_entry_count: 3,
    active_policy_count: 0, policy_version_count: 1, ...POL_BASE, v2_policy_present: false, ...ctl(1, false, DORMANT_V2_VIEW.control_global_digest, DORMANT_V2_VIEW.control_project_digest) }),
  armed: () => ({ ...CAT_BASE, active_catalog_count: 1, active_catalog_entry_count: 3, v2_active_digest: CATALOG_V2.active_digest, v2_active_entry_count: 3,
    one_call_policy_digest: POLICY_V2.active_digest, active_policy_count: 1, policy_version_count: 2, ...POL_BASE,
    ...ctl(2, true, CONTROLS_V2.global_activation_digest, CONTROLS_V2.project_activation_digest) }),
  restored: () => ({ ...CAT_BASE, active_catalog_count: 0, active_catalog_entry_count: 0, v2_inactive_digest: CATALOG_V2.inactive_digest, v2_inactive_entry_count: 3,
    v2_policy_restored_present: true, active_policy_count: 0, policy_version_count: 2, ...POL_BASE,
    ...ctl(3, false, CONTROLS_V2.global_restoration_digest, CONTROLS_V2.project_restoration_digest) }),
  counts: () => ({ envelopes: 0, provider_reservations: 0, provider_settlements: 0, execution_consumptions: 0, decisions: 0, reconciliations: 0, scope_counters: 0, sessions: 0 }),
  ceilings: () => ({ ...POLICY_V2.ceilings }),
});

export const RAILWAY = () => ({ railway_project_id: TARGETS_V2.project, railway_environment_id: TARGETS_V2.environment, gateway_service_id: TARGETS_V2.gateway, postgres_service_id: TARGETS_V2.postgres });
export const DB = () => ({ resolved_postgres_service_id: TARGETS_V2.postgres, store_binding_ref: STORE_BINDING_REF, resolved_project_id: TARGETS_V2.project });
export const phaseBGates = () => ({
  gatewayEnvNames: new Set(REQUIRED_ENV_NAMES_GATEWAY), brokerEnvNames: new Set(REQUIRED_ENV_NAMES_BROKER),
  gatewayPubFp: "a".repeat(64), brokerPubFp: "a".repeat(64), reasoningModel: "gpt-5.6-terra", providerCredentialPresent: true,
  gatesBeforeArm: { staging_text_enabled: false, staging_broker_enabled: false },
  operatorSubject: { derived_subject: "stg1." + "b".repeat(64), configured_operator_subject: "stg1." + "b".repeat(64), raw_admin_id_leaked: false, hmac_secret_leaked: false },
});

/** A committed-ledger observation + activation receipt as the V2 DB function / adapter would produce (TEST provenance). */
export function consumedFixture(ap, consumedAtIso) {
  const rec = { approval_id: ap.approvalId, execution_id: ap.executionId, content_digest: ap.suppliedEvidence.digest, active_catalog_digest: CATALOG_V2.active_digest, action: "activate", consumed_at: consumedAtIso };
  const ledgerObservation = { provenance: TEST_LEDGER_PROVENANCE, dbIdentity: TARGETS_V2.postgres, committed: true, records: [rec] };
  const fields = { approval_id: rec.approval_id, execution_id: rec.execution_id, content_digest: rec.content_digest, active_catalog_digest: rec.active_catalog_digest, consumed_at: rec.consumed_at };
  const activationReceipt = { contract: C.RECEIPT_CONTRACT_V2, action: "activate", catalog_version_id: CATALOG_V2.id, ...fields, commitment: C.activationReceiptCommitmentV2(fields) };
  return { ledgerObservation, activationReceipt };
}

export function testEnv(rv, over = {}) {
  const N = REQUIRED_ENV_NAMES_V2;
  return { [N.runtimeContractVersion]: "V2", [N.executorDbUrl]: "synthetic-ref-executor", [N.readerDbUrl]: "synthetic-ref-reader",
    [N.reviewerTrustRootDerB64]: rv.trustRoot.pinnedPublicKeyDerB64, [N.reviewerTrustRootFingerprint]: rv.fp,
    [N.aiStagingProjectId]: TARGETS_V2.project, [N.aiStagingEnvironmentId]: TARGETS_V2.environment, [N.aiStagingPgServiceId]: TARGETS_V2.postgres,
    [N.aiStagingGatewayServiceId]: TARGETS_V2.gateway, [N.connectionIdentityProofRef]: "TEST-proof-ref", ...over };
}
export function testConnectionProof(token = "TEST-TOKEN", issuer = "TEST-ISSUER") {
  return { provenance: CONNECTION_IDENTITY_PROOF_CONTRACT.test_provenance, issuer, boundConnectionToken: token,
    serviceId: TARGETS_V2.postgres, projectId: TARGETS_V2.project, environmentId: TARGETS_V2.environment };
}

export function makeRunner(name) {
  let pass = 0, fail = 0; const fails = [];
  const ok = (id, cond, detail) => { if (process.env.M7S2_LIST === "1") console.log(`  ${cond ? "PASS" : "FAIL"} ${id}`); if (cond) pass++; else { fail++; fails.push(id); console.log(`  FAIL ${id}${detail !== undefined ? " — " + JSON.stringify(detail).slice(0, 300) : ""}`); } };
  const done = () => { console.log(`${name}: ${pass} passed, ${fail} failed`); if (fail) { console.log("FAILED: " + fails.join(", ")); process.exitCode = 1; } return { pass, fail }; };
  return { ok, done };
}
export { C, G };
