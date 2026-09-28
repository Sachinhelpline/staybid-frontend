// ─────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — M7 STEP 2 — V2 PHASE-A pre-activation / PHASE-B pre-probe preflight / postflight.
// OFFLINE, Node built-ins only. Performs NO database / network / Railway / provider access: every
// observation is INJECTED by the owner-controlled harness (or the V2 executor runtime). The CLI is
// FAIL-CLOSED (exit 2). Never prints a secret, never auto-repairs, never triggers a provider call.
//
// Successor of first-text-probe-activation-01/first-probe-preflight-postflight.mjs (V1, frozen:
// catalog V1 digests, 2b69ce deploy pin, 89,536 ceilings, a 1-inactive-version / 2-entry predecessor).
//
//   runPreActivationV2  — PHASE A: exact pre-activation state (2 versions / 5 entries; V1 historical;
//                         V2 inactive with 3 entries; 0 active; dormant policy; epoch-1 controls; zero
//                         exposure) + an authentic, UNUSED V2 approval (verifyApprovalV2).
//   checkActivatedStateV2 — after the trusted activation: V2 SOLE active; policy NOT yet active;
//                         controls still dormant; V1 still historical.
//   runPreflightV2      — PHASE B: armed state (V2 sole active; policy-v2 SOLE active; seven exact
//                         ceilings; epoch 2) + the SAME approval correlated to EXACTLY ONE committed
//                         ledger row + receipt (verifyConsumedApprovalV2) + gateway/env/key/gate checks
//                         + the three source pins. On PASS it ISSUES a FirstProbePreflightReceiptV2
//                         bound to this exact V2 identity (the ONLY receipt the V2 probe accepts).
//   runPostflightV2     — after the single probe + restoration: ≤1 call, spend ≤ 105,920, closed
//                         ingress, V2 restored inactive, policy-v2 restored, epoch 3, V1 never revived.
// ─────────────────────────────────────────────────────────────────────────

import { verifyApprovalV2, verifyConsumedApprovalV2 } from "../../m7-step1-hb1-consolidated-remediation-01/approval/approval-verify-v2.mjs";
import {
  FIXED_V2, CATALOG_V2, V1_HISTORICAL, POLICY_V2, CONTROLS_V2, DORMANT_V2_VIEW, TARGETS_V2, PRE_ACTIVATION_TOTALS,
  STORE_BINDING_REF, REASONING_MODEL, REQUIRED_ENV_NAMES_GATEWAY, REQUIRED_ENV_NAMES_BROKER, PROBE_TEXT_SHA256,
  canonicalize, sha256hex, exactInt, ceilingsExactV2, assertIdentityIntegrity,
} from "../identity/v2-identity.mjs";
import { checkSourcePinV2 } from "../identity/v2-source-identity.mjs";
import { V2_REGISTRY_DIGEST } from "./v2-query-registry.mjs";

const OPERATOR_SUBJECT_SHAPE = /^stg1\.[0-9a-f]{64}$/;
const RFC3339_UTC = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?Z$/;
const ok = () => ({ ok: true });
const fail = (reason) => ({ ok: false, reason });
function need(v, name) { if (v === undefined || v === null) throw new Error(`missing injected input: ${name}`); return v; }

export const PREFLIGHT_RECEIPT_CONTRACT_V2 = "FirstProbePreflightReceiptV2";
export const PREFLIGHT_RECEIPT_DOMAIN_V2 = "staybid.live-ai.first-probe-preflight-receipt.v2";
const COUNT_KEYS = ["envelopes", "provider_reservations", "provider_settlements", "execution_consumptions", "decisions", "reconciliations", "scope_counters", "sessions"];

function ratesExact(s) {
  if (!exactInt(s.v2_input_rate_micros, FIXED_V2.input_rate_micros)) return fail("v2_input_rate_mismatch");
  if (!exactInt(s.v2_cache_write_rate_micros, FIXED_V2.cache_write_rate_micros)) return fail("v2_cache_write_rate_missing_or_mismatch");
  if (!exactInt(s.v2_output_rate_micros, FIXED_V2.output_rate_micros)) return fail("v2_output_rate_mismatch");
  if (!exactInt(s.v2_entry_count, CATALOG_V2.entry_count)) return fail("v2_entry_count_not_3");
  return ok();
}
function v1Historical(s) {
  if (s.v1_inactive_digest !== V1_HISTORICAL.inactive_digest) return fail("v1_not_historical_inactive");
  if (!exactInt(s.v1_inactive_entry_count, V1_HISTORICAL.entry_count)) return fail("v1_entries_not_historical_inactive");
  if (s.v1_expiry_is_historical !== true) return fail("v1_expiry_extended_or_altered");
  return ok();
}
function totals(s) {
  if (!exactInt(s.catalog_version_count, PRE_ACTIVATION_TOTALS.catalog_versions)) return fail("catalog_version_count_not_2");
  if (!exactInt(s.catalog_entry_count, PRE_ACTIVATION_TOTALS.catalog_entries)) return fail("catalog_entry_count_not_5");
  return ok();
}
function policyHygiene(s) {
  if (s.obsolete_v1_policy_present !== false) return fail("obsolete_89536_policy_present");
  if (s.wildcard_policy_present !== false) return fail("wildcard_policy_present");
  if (s.dormant_policy_present !== true) return fail("dormant_policy_absent_or_altered");
  return ok();
}
function controls(s, epoch, enabled, gDigest, pDigest) {
  if (!exactInt(s.control_row_count, 2)) return fail("control_row_count_not_2");
  if (!exactInt(s.global_control_epoch, epoch) || !exactInt(s.project_control_epoch, epoch)) return fail(`control_epoch_not_${epoch}`);
  if (s.global_control_enabled !== enabled || s.project_control_enabled !== enabled) return fail(enabled ? "control_not_enabled" : "control_already_enabled");
  if (s.global_control_killed !== false || s.project_control_killed !== false) return fail("control_killed");
  if (s.control_global_digest !== gDigest) return fail("global_control_digest_mismatch");
  if (s.control_project_digest !== pDigest) return fail("project_control_digest_mismatch");
  return ok();
}
const first = (...rs) => rs.find((r) => r && r.ok === false) || ok();

export const checks = {
  identityIntegrity() { return assertIdentityIntegrity(); },
  railwayIds(o) {
    if (!o || typeof o !== "object") return fail("railway_observation_absent");
    if (o.railway_project_id !== TARGETS_V2.project) return fail("railway_project_id_mismatch");
    if (o.railway_environment_id !== TARGETS_V2.environment) return fail("railway_environment_id_mismatch");
    if (o.gateway_service_id !== TARGETS_V2.gateway) return fail("gateway_service_id_mismatch");
    if (o.postgres_service_id !== TARGETS_V2.postgres) return fail("postgres_service_id_mismatch");
    return ok();
  },
  sourcePins(sp, testBoundary) { return checkSourcePinV2(sp, { testBoundary }); },
  dbBindingToAiStaging(o) {
    if (!o || typeof o !== "object") return fail("db_binding_absent");
    if (o.resolved_postgres_service_id !== TARGETS_V2.postgres) return fail("db_binding_not_ai_staging");
    if (o.store_binding_ref !== STORE_BINDING_REF) return fail("store_binding_ref_mismatch");
    return ok();
  },
  coreExclusion(o) {
    if (!o || typeof o !== "object") return fail("db_binding_absent");
    if (o.resolved_postgres_service_id === TARGETS_V2.core_excluded_postgres) return fail("db_resolves_to_CORE_postgres");
    if (o.resolved_project_id === TARGETS_V2.core_excluded_project) return fail("db_resolves_to_CORE_project");
    return ok();
  },
  /** V2 verification window: T0 ≤ now < 2026-10-05T15:26:23Z. At/after expiry ⇒ HOLD (never regenerate T0). */
  catalogFreshnessV2(nowIso) {
    if (!RFC3339_UTC.test(String(nowIso))) return fail("now_not_rfc3339_utc");
    const n = Date.parse(nowIso);
    if (n < Date.parse(CATALOG_V2.t0)) return fail("catalog_verified_at_in_future");
    if (n >= Date.parse(CATALOG_V2.verification_expiry)) return fail("catalog_v2_verification_expired_hold_for_fresh_successor");
    return ok();
  },
  independentApprovalVerifiedV2(args) { return verifyApprovalV2(args); },
  consumedApprovalCorrelatedV2(args) { return verifyConsumedApprovalV2(args); },
  preActivationStateV2(s) {
    if (!s || typeof s !== "object") return fail("pre_activation_state_absent");
    return first(
      totals(s),
      exactInt(s.active_catalog_count, 0) && exactInt(s.active_catalog_entry_count, 0) ? ok() : fail("catalog_already_active"),
      v1Historical(s),
      s.v2_inactive_digest === CATALOG_V2.inactive_digest ? ok() : fail("v2_inactive_digest_mismatch"),
      exactInt(s.v2_inactive_entry_count, 3) ? ok() : fail("v2_inactive_entries_not_3"),
      ratesExact(s),
      exactInt(s.active_policy_count, 0) ? ok() : fail("policy_already_active"),
      exactInt(s.policy_version_count, 1) ? ok() : fail("policy_version_count_not_1"),
      s.v2_policy_present === false ? ok() : fail("successor_policy_already_present"),
      policyHygiene(s),
      controls(s, DORMANT_V2_VIEW.control_epoch, false, DORMANT_V2_VIEW.control_global_digest, DORMANT_V2_VIEW.control_project_digest),
    );
  },
  activatedStateV2(s) {
    if (!s || typeof s !== "object") return fail("activated_state_absent");
    return first(
      totals(s),
      exactInt(s.active_catalog_count, 1) && exactInt(s.active_catalog_entry_count, 3) ? ok() : fail("v2_not_sole_active_catalog"),
      s.v2_active_digest === CATALOG_V2.active_digest ? ok() : fail("v2_active_digest_mismatch_or_not_sole"),
      exactInt(s.v2_active_entry_count, 3) ? ok() : fail("v2_active_entries_not_3"),
      ratesExact(s), v1Historical(s),
      exactInt(s.active_policy_count, 0) ? ok() : fail("policy_active_before_arm"),
      exactInt(s.policy_version_count, 1) && s.v2_policy_present === false ? ok() : fail("successor_policy_present_before_arm"),
      policyHygiene(s),
      controls(s, DORMANT_V2_VIEW.control_epoch, false, DORMANT_V2_VIEW.control_global_digest, DORMANT_V2_VIEW.control_project_digest),
    );
  },
  armedStateV2(s) {
    if (!s || typeof s !== "object") return fail("armed_state_absent");
    return first(
      totals(s),
      exactInt(s.active_catalog_count, 1) && exactInt(s.active_catalog_entry_count, 3) ? ok() : fail("v2_not_sole_active_catalog"),
      s.v2_active_digest === CATALOG_V2.active_digest ? ok() : fail("active_catalog_digest_mismatch"),
      exactInt(s.v2_active_entry_count, 3) ? ok() : fail("v2_active_entries_not_3"),
      ratesExact(s), v1Historical(s),
      s.one_call_policy_digest === POLICY_V2.active_digest ? ok() : fail("one_call_policy_v2_not_sole_active_or_digest_mismatch"),
      exactInt(s.active_policy_count, 1) ? ok() : fail("active_policy_count_not_1"),
      exactInt(s.policy_version_count, 2) ? ok() : fail("policy_version_count_not_2"),
      policyHygiene(s),
      controls(s, CONTROLS_V2.armed_epoch, true, CONTROLS_V2.global_activation_digest, CONTROLS_V2.project_activation_digest),
    );
  },
  oneCallCeilingsExactV2(p) { return ceilingsExactV2(p); },
  zeroPriorProbeExposure(counts) {
    if (!counts || typeof counts !== "object") return fail("exposure_counts_absent");
    for (const k of COUNT_KEYS) if (!exactInt(counts[k], 0)) return fail(`nonzero_or_unknown_prior_exposure:${k}`);
    return ok();
  },
  envNamesPresent(presentSet, side) {
    if (!(presentSet instanceof Set)) return fail("env_name_set_absent");
    const req = side === "broker" ? REQUIRED_ENV_NAMES_BROKER : REQUIRED_ENV_NAMES_GATEWAY;
    const missing = req.filter((n) => !presentSet.has(n));
    return missing.length === 0 ? ok() : fail(`env_names_missing:${missing.join(",")}`);
  },
  signingKeyCorrespondence(g, b) { if (!g || !b) return fail("signing_key_fingerprint_absent"); return g === b ? ok() : fail("signing_key_fingerprint_mismatch"); },
  reasoningModel(m) { return m === REASONING_MODEL ? ok() : fail("reasoning_model_mismatch"); },
  providerCredentialPresence(p) { return p === true ? ok() : fail("provider_credential_absent"); },
  gatesStillOffUntilArm(o) {
    if (!o || typeof o !== "object") return fail("gate_observation_absent");
    if (o.staging_text_enabled !== false) return fail("staging_text_gate_on_before_arm");
    if (o.staging_broker_enabled !== false) return fail("staging_broker_gate_on_before_arm");
    return ok();
  },
  operatorSubjectDerivedSafely(o) {
    if (!o || typeof o !== "object") return fail("operator_subject_absent");
    if (!OPERATOR_SUBJECT_SHAPE.test(String(o.derived_subject || ""))) return fail("derived_subject_bad_shape");
    if (o.derived_subject !== o.configured_operator_subject) return fail("derived_subject_not_operator");
    if (o.raw_admin_id_leaked !== false || o.hmac_secret_leaked !== false) return fail("subject_derivation_leaked_secret");
    return ok();
  },
  approvalNotConsumed(flag) { return flag === false ? ok() : fail("approval_already_consumed_or_unknown"); },
  privilegeProofPresent(o) { return o && o.restricted_role_proof_present === true ? ok() : fail("restricted_privilege_proof_absent"); },
  // ── postflight ──
  atMostOneReservation(c) { return exactInt(c.provider_reservations, 0) || exactInt(c.provider_reservations, 1) ? ok() : fail("more_than_one_reservation_or_unknown"); },
  atMostOneProviderCall(c) { return exactInt(c.provider_calls, 0) || exactInt(c.provider_calls, 1) ? ok() : fail("more_than_one_provider_call_or_unknown"); },
  settlementExact(o) {
    if (!exactInt(o.reservations_open, 0)) return fail("open_reservation_after_probe");
    if (!Number.isInteger(o.settlements) || o.settlements !== o.reservations) return fail("settlement_count_mismatch");
    return ok();
  },
  reconciliationTerminal(o) { return o.all_envelopes_terminal === true ? ok() : fail("envelope_not_terminal"); },
  spendWithinCeilingV2(m) { return Number.isInteger(m) && m >= 0 && m <= POLICY_V2.money_ceiling_micros ? ok() : fail("spend_over_105920_or_invalid"); },
  noSecondAuthority(c) { return exactInt(c.envelopes, 0) || exactInt(c.envelopes, 1) ? ok() : fail("second_provider_authority_minted"); },
  durableEvidenceRetained(o) { return o.accounting_rows_retained === true ? ok() : fail("durable_evidence_missing"); },
  ingressClosed(o) {
    if (o.staging_text_enabled !== false) return fail("staging_text_gate_still_on");
    if (o.staging_broker_enabled !== false) return fail("staging_broker_gate_still_on");
    return ok();
  },
  providerCredentialRemoved(p) { return p === false ? ok() : fail("provider_credential_still_present"); },
  restoredStateV2(s) {
    if (!s || typeof s !== "object") return fail("restored_state_absent");
    return first(
      totals(s),
      exactInt(s.active_catalog_count, 0) && exactInt(s.active_catalog_entry_count, 0) ? ok() : fail("active_catalog_remains"),
      s.v2_inactive_digest === CATALOG_V2.inactive_digest ? ok() : fail("v2_not_restored_to_inactive_digest"),
      exactInt(s.v2_inactive_entry_count, 3) ? ok() : fail("v2_entries_not_restored"),
      ratesExact(s), v1Historical(s),
      exactInt(s.active_policy_count, 0) ? ok() : fail("active_policy_remains"),
      s.v2_policy_restored_present === true ? ok() : fail("successor_policy_not_restored"),
      policyHygiene(s),
      controls(s, CONTROLS_V2.restored_epoch, false, CONTROLS_V2.global_restoration_digest, CONTROLS_V2.project_restoration_digest),
    );
  },
  coreUnchanged(o) { return o && o.core_unchanged === true ? ok() : fail("core_changed_or_unknown"); },
};

function collect(results) { const failures = results.filter((r) => !r || r.ok === false).map((r) => (r ? r : fail("check_absent"))); return { pass: failures.length === 0, failures }; }
function railwayAndTarget(deps) {
  return [
    checks.identityIntegrity(),
    checks.railwayIds(need(deps.railway, "railway")),
    checks.sourcePins(need(deps.sourcePin, "sourcePin"), deps.testBoundary === true),
    checks.dbBindingToAiStaging(need(deps.db, "db")),
    checks.coreExclusion(need(deps.db, "db")),
    checks.catalogFreshnessV2(need(deps.nowIso, "nowIso")),
  ];
}

/** PHASE A — pre-activation (runs BEFORE the trusted V2 activation). */
export function runPreActivationV2(deps) {
  need(deps, "deps");
  return collect([
    ...railwayAndTarget(deps),
    checks.independentApprovalVerifiedV2({
      envelope: need(deps.approvalEnvelope, "approvalEnvelope"), trustRoot: need(deps.trustRoot, "trustRoot"),
      suppliedEvidence: need(deps.suppliedEvidence, "suppliedEvidence"), nowIso: need(deps.nowIso, "nowIso"),
      executionId: need(deps.executionId, "executionId"), isConsumed: need(deps.isApprovalConsumed, "isApprovalConsumed"),
    }),
    checks.preActivationStateV2(need(deps.preActivationState, "preActivationState")),
    checks.zeroPriorProbeExposure(need(deps.counts, "counts")),
    checks.approvalNotConsumed(need(deps.approvalConsumed, "approvalConsumed")),
    checks.privilegeProofPresent(need(deps.privilegeProof, "privilegeProof")),
  ]);
}

/** Post-activation, pre-arm: V2 sole active, policy/controls untouched. */
export function checkActivatedStateV2(state) { return checks.activatedStateV2(state); }

// ── receipts ISSUED by this module (the V2 probe accepts ONLY these objects) ──
const ISSUED = new WeakSet();
function deepFreeze(o) { if (o && typeof o === "object") { for (const v of Object.values(o)) deepFreeze(v); Object.freeze(o); } return o; }
export function preflightReceiptCommitmentV2(identity, issuedAtIso, mode) {
  return sha256hex(canonicalize({ domain: PREFLIGHT_RECEIPT_DOMAIN_V2, identity, issued_at: issuedAtIso, mode }));
}
export function isIssuedPreflightReceiptV2(r) { return !!r && typeof r === "object" && ISSUED.has(r); }

/** PHASE B — post-activation / pre-probe. Issues a FirstProbePreflightReceiptV2 ONLY on a full PASS. */
export function runPreflightV2(deps) {
  need(deps, "deps");
  const testBoundary = deps.testBoundary === true;
  const consumed = checks.consumedApprovalCorrelatedV2({
    envelope: need(deps.approvalEnvelope, "approvalEnvelope"), trustRoot: need(deps.trustRoot, "trustRoot"),
    suppliedEvidence: need(deps.suppliedEvidence, "suppliedEvidence"), nowIso: need(deps.nowIso, "nowIso"),
    executionId: need(deps.executionId, "executionId"),
    // lifecycle inputs pass through as-is: absence must FAIL CLOSED inside the verifier, never throw.
    ledgerObservation: deps.ledgerObservation, activationReceipt: deps.activationReceipt, testBoundary,
  });
  const source = checks.sourcePins(need(deps.sourcePin, "sourcePin"), testBoundary);
  const R = collect([
    ...railwayAndTarget(deps),
    consumed,
    checks.armedStateV2(need(deps.armedState, "armedState")),
    checks.oneCallCeilingsExactV2(need(deps.oneCallPolicy, "oneCallPolicy")),
    checks.zeroPriorProbeExposure(need(deps.counts, "counts")),
    checks.envNamesPresent(need(deps.gatewayEnvNames, "gatewayEnvNames"), "gateway"),
    checks.envNamesPresent(need(deps.brokerEnvNames, "brokerEnvNames"), "broker"),
    checks.signingKeyCorrespondence(need(deps.gatewayPubFp, "gatewayPubFp"), need(deps.brokerPubFp, "brokerPubFp")),
    checks.reasoningModel(need(deps.reasoningModel, "reasoningModel")),
    checks.providerCredentialPresence(need(deps.providerCredentialPresent, "providerCredentialPresent")),
    checks.gatesStillOffUntilArm(need(deps.gatesBeforeArm, "gatesBeforeArm")),
    checks.operatorSubjectDerivedSafely(need(deps.operatorSubject, "operatorSubject")),
  ]);
  if (!R.pass) return R;
  const identity = {
    contract_version: "V2",
    catalog_version_id: CATALOG_V2.id, active_catalog_digest: CATALOG_V2.active_digest, catalog_verification_expiry: CATALOG_V2.verification_expiry,
    one_call_policy_id: POLICY_V2.id, one_call_policy_digest: POLICY_V2.active_digest, one_call_money_ceiling_micros: POLICY_V2.money_ceiling_micros,
    ceilings: { ...POLICY_V2.ceilings },
    control_epoch: CONTROLS_V2.armed_epoch, control_global_digest: CONTROLS_V2.global_activation_digest, control_project_digest: CONTROLS_V2.project_activation_digest,
    approval_id: consumed.claims.approval_id, execution_id: consumed.claims.execution_id, content_digest: consumed.claims.content_digest,
    consumed_at: consumed.consumedAt, activation_receipt_commitment: deps.activationReceipt.commitment,
    derivation_base: source.derivationBase, gateway_source: source.gateway, step2_runtime: source.step2,
    targets: { project: TARGETS_V2.project, environment: TARGETS_V2.environment, gateway: TARGETS_V2.gateway, postgres: TARGETS_V2.postgres },
    probe_text_sha256: PROBE_TEXT_SHA256, read_registry_digest: V2_REGISTRY_DIGEST,
  };
  const mode = testBoundary ? "test" : "production";
  const receipt = deepFreeze({ contract: PREFLIGHT_RECEIPT_CONTRACT_V2, pass: true, mode, issuedAtIso: deps.nowIso, identity,
    commitment: preflightReceiptCommitmentV2(identity, deps.nowIso, mode) });
  ISSUED.add(receipt);
  return { pass: true, failures: [], receipt };
}

/** POSTFLIGHT — the single probe stayed within bounds, ingress is closed, V2 authority restored inactive. */
export function runPostflightV2(deps) {
  need(deps, "deps");
  return collect([
    checks.atMostOneReservation(need(deps.counts, "counts")),
    checks.atMostOneProviderCall(need(deps.counts, "counts")),
    checks.settlementExact(need(deps.settlement, "settlement")),
    checks.reconciliationTerminal(need(deps.reconciliation, "reconciliation")),
    checks.spendWithinCeilingV2(need(deps.actualSpendMicros, "actualSpendMicros")),
    checks.noSecondAuthority(need(deps.counts, "counts")),
    checks.durableEvidenceRetained(need(deps.evidence, "evidence")),
    checks.ingressClosed(need(deps.gatesAfterClose, "gatesAfterClose")),
    checks.providerCredentialRemoved(need(deps.providerCredentialPresent, "providerCredentialPresent")),
    checks.restoredStateV2(need(deps.restoredState, "restoredState")),
    checks.coreUnchanged(need(deps.core, "core")),
  ]);
}

function main(argv) {
  const mode = argv.includes("--postflight") ? "postflight" : argv.includes("--preflight") ? "preflight" : argv.includes("--pre-activation") ? "pre-activation" : null;
  process.stderr.write(
    "[live-ai-03b V2 preflight] FAIL-CLOSED: performs NO db/network/railway/provider access on its own.\n" +
    "It requires an INJECTED verification context via runPreActivationV2 / runPreflightV2 / runPostflightV2.\n" +
    `mode=${mode || "none"} — no injected deps present ⇒ refusing (exit 2). No secret is ever printed.\n`,
  );
  process.exit(2);
}
if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2));
