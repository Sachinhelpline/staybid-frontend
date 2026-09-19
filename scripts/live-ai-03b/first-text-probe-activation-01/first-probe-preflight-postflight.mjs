// ─────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — FIRST-TEXT-PROBE — preflight / postflight verifier  (UNEXECUTED)
//
// ⚠ A FUTURE verification tool. NOT executed by this packet. Node built-ins ONLY.
// It performs NO database / network / Railway / provider access on its own: every
// observation is supplied by the owner-controlled execution harness through an INJECTED
// `deps` object. The CLI entrypoint is FAIL-CLOSED — invoked without an injected
// verification context it prints the required-inputs contract and exits non-zero. It
// NEVER opens a connection itself, NEVER prints a secret, NEVER auto-repairs, and NEVER
// triggers a second provider call.
//
// Modes: --preflight (arm-time gate) and --postflight (post-probe close gate).
// ─────────────────────────────────────────────────────────────────────────

import { createHash } from "node:crypto";
// P1-02 trusted boundary — real independent-approval verification (Ed25519 signature against
// an independently-pinned reviewer trust root). Replaces the prior caller-controlled anchor
// equality, which could be satisfied by two fabricated matching caller values.
import { verifyApproval, verifyConsumedApproval } from "../trusted-activation-boundary-01/approval-verify.mjs";

// ── frozen expectations (accepted / reviewed; never secrets) ──
export const EXPECT = Object.freeze({
  repository: "Sachinhelpline/staybid-frontend",
  deployable_commit: "2b69ce28230fc9d56a035846e95d8de206d5db3b",
  deployable_tree: "87aad22d90f84f2c3b307201c3e0d3b8658b1619",
  equivalent_03b_staging_commit: "9df5a7c0c242ff0b70f5d602ea3a11a29f15b6ae",
  railway_project_id: "4ad1abb3-823a-4acf-b889-6d34ae46d7f9",
  railway_environment_id: "aa397bd7-b316-4fd8-b05a-0a5f6c5e3abc",
  gateway_service_id: "dd96c7cd-02c1-4d02-89eb-7e217930ebfa",
  postgres_service_id: "b7362594-a01b-4623-a982-394707a6cec2",
  core_project_id: "04c8b523-5b15-4d81-af06-8c2aa1a83499",
  core_postgres_service_id: "1fbd7632-95ad-46f3-a20c-5be5b8e44e6b",
  reasoning_model: "gpt-5.6-terra",
  provider: "openai",
  endpoint: "https://api.openai.com/v1/responses",
  catalog_version_id: "openai-gpt-5-6-terra-standard-short-v1",
  catalog_verification_expiry: "2026-09-25T18:37:35Z",
  active_catalog_digest: "616cc481e8cc342462445da5ededa142ec4450f38805edd91ed798554f3c24f8",
  inactive_catalog_digest: "453f928762b8e6cddedac8618786d008cb7a3d57ffefab9d0cfe3cda52c4c973",
  source_digest: "fda6f4a834b2277bd0ace30738cda1e8f75c0f8bc523ddbd11c966c4da52beb3",
  one_call_policy_id: "live-ai-03b-policy-oneprobe-v1",
  one_call_policy_digest: "9927a920975c4e03f5cbf3adee23c34bb7396a032b00b029ba5a2c7ac0c8ec1c",
  control_global_activation_digest: "0a60f1eb2050b2d0e4ff43262e9cde12d35c8dab84c30a8ceffc36ffa357878b",
  control_project_activation_digest: "eb56f2b74f1afbb82bed7316c9839201698c780c7881e3604bdc701022315a6f",
  one_call_money_ceiling_micros: 89536,
  one_call_provider_calls: 1,
  one_call_execution_admissions: 1,
  // P1-01 — ALL SEVEN exact one-call ceilings (every field mandatory).
  one_call_ceilings: {
    session_money_ceiling_micros: 89536,
    session_provider_calls: 1,
    session_execution_admissions: 1,
    subject_day_money_ceiling_micros: 89536,
    project_day_money_ceiling_micros: 89536,
    project_month_money_ceiling_micros: 89536,
    global_day_money_ceiling_micros: 89536,
  },
  probe_text_sha256: "8efedb83900154947f749a5ca0c66546a5580593db18aa125e3d6809e311700d",
  store_binding_ref: "live-ai-03b-staging::railway-postgres::b7362594-a01b-4623-a982-394707a6cec2",
  required_env_names_gateway: [
    "LIVE_AI_03B_STAGING_DATABASE_URL", "LIVE_AI_BUDGET_ENABLED", "LIVE_AI_BUDGET_STORE_BINDING",
    "LIVE_AI_BUDGET_PROJECT_ID", "LIVE_AI_BUDGET_LEASE_TTL_MS", "LIVE_AI_BUDGET_MAX_CONTROL_STALENESS_MS",
    "LIVE_AI_BUDGET_CONTROL_POLL_MS", "OPENAI_API_KEY", "LIVE_AI_REASONING_MODEL", "LIVE_AI_RUNTIME_ENABLED",
    "LIVE_AI_SESSION_SIGNING_PUBLIC_KEY", "LIVE_AI_SESSION_ISSUER", "LIVE_AI_SESSION_AUDIENCE",
    "LIVE_AI_CONTROL_TOKEN_SECRET", "LIVE_AI_KILL_SWITCH_HMAC_SECRET", "LIVE_AI_ALLOWED_ORIGINS",
    "LIVE_AI_IP_HASH_SALT", "LIVE_AI_03B_STAGING_TEXT_ENABLED", "LIVE_AI_03B_STAGING_SUBJECT_ALLOWLIST",
    "LIVE_AI_03B_FIRST_PROBE_ONE_CALL",
  ],
  required_env_names_broker: [
    "LIVE_AI_03B_STAGING_BROKER_ENABLED", "LIVE_AI_03B_STAGING_OPERATOR_SUBJECT",
    "LIVE_AI_03B_STAGING_SUBJECT_HMAC_SECRET", "LIVE_AI_SESSION_SIGNING_PRIVATE_KEY", "LIVE_AI_GATEWAY_URL",
  ],
});

const OPERATOR_SUBJECT_SHAPE = /^stg1\.[0-9a-f]{64}$/;
const RFC3339_UTC = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?Z$/;

function ok() { return { ok: true }; }
function fail(reason) { return { ok: false, reason }; }
function need(v, name) { if (v === undefined || v === null) throw new Error(`missing injected input: ${name}`); return v; }

// P1-01 — STRICT integer equality: only a real JS integer (never a string, NaN, Infinity,
// float, negative-when-unexpected, or coerced value) equal to `want` passes. No coercion.
function exactInt(v, want) {
  return typeof v === "number" && Number.isInteger(v) && Object.is(v, want);
}

// ── P1-02 — the FIXED, reviewed Standard/non-regional evidence FACTS (accepted business
// contract: provider/model/rates/source are the already-accepted price-catalog values —
// NOT a fabricated approval). The receipt content MUST attest exactly these facts. The
// approval DIGEST is never hardcoded here (that would fabricate an approval); it is the
// independently-supplied trusted anchor validated at execution. ──
export const EVIDENCE_EXPECTED_FACTS = Object.freeze({
  account_mode: "direct",
  catalog_version_id: "openai-gpt-5-6-terra-standard-short-v1",
  currency: "USD",
  excluded_paths: { batch: false, bedrock: false, fast: false, flex: false, scale_tier: false },
  model: "gpt-5.6-terra",
  processing_mode: "standard",
  provider: "openai",
  rates: { input_rate_micros: 2000000, output_rate_micros: 12000000, unit_size: 1000000 },
  regional_uplift: false,
  source_digest: "fda6f4a834b2277bd0ace30738cda1e8f75c0f8bc523ddbd11c966c4da52beb3",
  source_id: "openai-api-pricing/gpt-5.6-terra/standard/short-context/v1",
});

// canonicalization (accepted BUDGET contract) used to recompute the evidence digest from
// the SUPPLIED content, so the approved anchor digest binds to the exact attested content.
function canon(v) {
  if (v === null) return "null";
  const t = typeof v;
  if (t === "boolean") return v ? "true" : "false";
  if (t === "number") { if (!Number.isInteger(v)) throw new Error("float forbidden"); return String(v); }
  if (t === "string") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  if (t === "object") { const k = Object.keys(v).sort(); return "{" + k.map((x) => JSON.stringify(x) + ":" + canon(v[x])).join(",") + "}"; }
  throw new Error("unsupported type " + t);
}
/** recompute the evidence digest over the canonical (content-facts + verified_at) payload. */
export function recomputeEvidenceDigest(content) {
  const payload = {
    domain: "staybid.live-ai.budget.pricing-evidence.v1",
    facts: {
      account_mode: content.account_mode,
      catalog_version_id: content.catalog_version_id,
      currency: content.currency,
      excluded_paths: content.excluded_paths,
      model: content.model,
      processing_mode: content.processing_mode,
      provider: content.provider,
      rates: content.rates,
      regional_uplift: content.regional_uplift,
      source_digest: content.source_digest,
      source_id: content.source_id,
    },
    verified_at: content.verified_at,
  };
  return createHash("sha256").update(Buffer.from(canon(payload), "utf8")).digest("hex");
}
function factsExactlyExpected(c) {
  if (!c || typeof c !== "object") return false;
  const E = EVIDENCE_EXPECTED_FACTS;
  if (c.account_mode !== E.account_mode) return false;
  if (c.catalog_version_id !== E.catalog_version_id) return false;
  if (c.currency !== E.currency) return false;
  if (c.model !== E.model) return false;
  if (c.processing_mode !== E.processing_mode) return false;
  if (c.provider !== E.provider) return false;
  if (c.regional_uplift !== false) return false;
  if (c.source_digest !== E.source_digest) return false;
  if (c.source_id !== E.source_id) return false;
  if (!c.rates || typeof c.rates !== "object") return false;
  if (!exactInt(c.rates.input_rate_micros, E.rates.input_rate_micros)) return false;
  if (!exactInt(c.rates.output_rate_micros, E.rates.output_rate_micros)) return false;
  if (!exactInt(c.rates.unit_size, E.rates.unit_size)) return false;
  if (!c.excluded_paths || typeof c.excluded_paths !== "object") return false;
  for (const k of ["batch", "bedrock", "fast", "flex", "scale_tier"]) if (c.excluded_paths[k] !== false) return false;
  return true;
}

/** SHA-256 fingerprint of PUBLIC key material only (never a private key). */
export function publicKeyFingerprint(publicKeyPem) {
  if (typeof publicKeyPem !== "string" || !publicKeyPem.includes("PUBLIC KEY")) return null;
  return createHash("sha256").update(Buffer.from(publicKeyPem, "utf8")).digest("hex");
}

// ── individual, pure checks (each returns {ok,reason}; NEVER echoes a secret value) ──
export const checks = {
  railwayIds(o) {
    if (o.railway_project_id !== EXPECT.railway_project_id) return fail("railway_project_id_mismatch");
    if (o.railway_environment_id !== EXPECT.railway_environment_id) return fail("railway_environment_id_mismatch");
    if (o.gateway_service_id !== EXPECT.gateway_service_id) return fail("gateway_service_id_mismatch");
    if (o.postgres_service_id !== EXPECT.postgres_service_id) return fail("postgres_service_id_mismatch");
    return ok();
  },
  sourcePin(o) {
    if (o.deployed_commit !== EXPECT.deployable_commit) return fail("deployed_commit_mismatch");
    if (o.deployed_tree !== EXPECT.deployable_tree) return fail("deployed_tree_mismatch");
    if (o.gateway_deployment_revision !== EXPECT.deployable_commit) return fail("gateway_revision_not_pinned_commit");
    return ok();
  },
  dbBindingToAiStaging(o) {
    if (o.resolved_postgres_service_id !== EXPECT.postgres_service_id) return fail("db_binding_not_ai_staging");
    if (o.store_binding_ref !== EXPECT.store_binding_ref) return fail("store_binding_ref_mismatch");
    return ok();
  },
  coreExclusion(o) {
    if (o.resolved_postgres_service_id === EXPECT.core_postgres_service_id) return fail("db_resolves_to_CORE_postgres");
    if (o.resolved_project_id === EXPECT.core_project_id) return fail("db_resolves_to_CORE_project");
    return ok();
  },
  catalogFreshness(nowIso) {
    if (!RFC3339_UTC.test(String(nowIso))) return fail("now_not_rfc3339_utc");
    if (Date.parse(nowIso) >= Date.parse(EXPECT.catalog_verification_expiry)) return fail("catalog_verification_expired");
    return ok();
  },
  // P1-02 — INDEPENDENT approval verification (trusted boundary). Delegates to
  // verifyApproval(): a reviewer-signed Ed25519 PricingEvidenceApprovalV1 envelope is verified
  // against an INDEPENDENTLY-PINNED reviewer public key (trust root) that a caller cannot
  // substitute; the supplied evidence is bound to the reviewer-signed content digest + receipt
  // id; fixed facts/targets/bundle, freshness, execution binding and single-use are enforced.
  // Two matching caller-supplied values can no longer authorize approval (the operator cannot
  // forge the reviewer signature). Absent trust root ⇒ BLOCKED.
  independentApprovalVerified(args) {
    return verifyApproval(args);
  },
  // P1-02 Phase-B — CONSUMED-approval correlation (post-activation / pre-probe). Delegates to
  // verifyConsumedApproval(): the SAME authentic approval (full signature/trust-root/target/
  // freshness/execution authentication, unchanged) + EXACTLY ONE matching, legitimately CONSUMED
  // activation record observed POST-COMMIT in the authoritative AI-STAGING ledger through a
  // trusted read-only capability + a correlated deterministic activation receipt. This REPLACES
  // the Phase-A unused-approval check on the armed path, so an authentic successful activation is
  // no longer rejected as replay; a second activation stays forbidden (executor one-shot + DB
  // ledger unique). isConsumed=false, a caller count, a fabricated ledger object, or a fabricated
  // receipt can never fabricate success.
  consumedApprovalCorrelated(args) {
    return verifyConsumedApproval(args);
  },
  predecessorArmedState(s) {
    if (s.active_catalog_digest !== EXPECT.active_catalog_digest) return fail("active_catalog_digest_mismatch");
    if (s.one_call_policy_digest !== EXPECT.one_call_policy_digest) return fail("one_call_policy_digest_mismatch");
    if (s.control_global_digest !== EXPECT.control_global_activation_digest) return fail("global_control_activation_digest_mismatch");
    if (s.control_project_digest !== EXPECT.control_project_activation_digest) return fail("project_control_activation_digest_mismatch");
    if (s.global_control_epoch !== 2 || s.project_control_epoch !== 2) return fail("control_epoch_not_2");
    if (s.global_control_enabled !== true || s.project_control_enabled !== true) return fail("control_not_enabled");
    if (s.global_control_killed === true || s.project_control_killed === true) return fail("control_killed");
    return ok();
  },
  zeroPriorProbeExposure(counts) {
    for (const k of ["envelopes", "provider_reservations", "provider_settlements", "execution_consumptions", "decisions", "reconciliations", "scope_counters", "sessions"]) {
      if (Number(counts[k]) !== 0) return fail(`nonzero_prior_exposure:${k}`);
    }
    return ok();
  },
  envNamesPresent(presentSet, side) {
    const req = side === "broker" ? EXPECT.required_env_names_broker : EXPECT.required_env_names_gateway;
    const missing = req.filter((n) => !presentSet.has(n));
    return missing.length === 0 ? ok() : fail(`env_names_missing:${missing.join(",")}`);
  },
  signingKeyCorrespondence(gatewayPubFp, brokerPubFp) {
    if (!gatewayPubFp || !brokerPubFp) return fail("signing_key_fingerprint_absent");
    return gatewayPubFp === brokerPubFp ? ok() : fail("signing_key_fingerprint_mismatch");
  },
  reasoningModel(model) { return model === EXPECT.reasoning_model ? ok() : fail("reasoning_model_mismatch"); },
  providerCredentialPresence(present) { return present === true ? ok() : fail("provider_credential_absent"); },
  gatesStillOffUntilArm(o) {
    if (o.staging_text_enabled === true) return fail("staging_text_gate_on_before_arm");
    if (o.staging_broker_enabled === true) return fail("staging_broker_gate_on_before_arm");
    return ok();
  },
  operatorSubjectDerivedSafely(o) {
    if (!OPERATOR_SUBJECT_SHAPE.test(String(o.derived_subject || ""))) return fail("derived_subject_bad_shape");
    if (o.derived_subject !== o.configured_operator_subject) return fail("derived_subject_not_operator");
    if (o.raw_admin_id_leaked === true || o.hmac_secret_leaked === true) return fail("subject_derivation_leaked_secret");
    return ok();
  },
  // P1-01 — ALL SEVEN one-call ceilings are mandatory + STRICT integer equality. A missing,
  // null, undefined, malformed, non-integer, negative, NaN, Infinity, coerced-string, or
  // mismatched value in ANY of the seven fails closed (no silent coercion).
  oneCallCeilingsExact(p) {
    if (!p || typeof p !== "object") return fail("one_call_policy_absent");
    const E = EXPECT.one_call_ceilings;
    for (const k of Object.keys(E)) {
      if (!exactInt(p[k], E[k])) return fail(`ceiling_${k}_invalid_or_mismatch`);
    }
    return ok();
  },
  // ── postflight ──
  atMostOneReservation(counts) { return Number(counts.provider_reservations) <= 1 ? ok() : fail("more_than_one_reservation"); },
  atMostOneProviderCall(counts) { return Number(counts.provider_calls) <= 1 ? ok() : fail("more_than_one_provider_call"); },
  settlementExact(o) {
    if (Number(o.reservations_open) !== 0) return fail("open_reservation_after_probe");
    if (Number(o.settlements) !== Number(o.reservations)) return fail("settlement_count_mismatch");
    return ok();
  },
  reconciliationTerminal(o) { return o.all_envelopes_terminal === true ? ok() : fail("envelope_not_terminal"); },
  spendWithinCeiling(micros) { return Number(micros) <= EXPECT.one_call_money_ceiling_micros ? ok() : fail("spend_over_ceiling"); },
  noSecondAuthority(counts) { return Number(counts.envelopes) <= 1 ? ok() : fail("second_provider_authority_minted"); },
  durableEvidenceRetained(o) { return o.accounting_rows_retained === true ? ok() : fail("durable_evidence_missing"); },
  ingressClosed(o) {
    if (o.staging_text_enabled !== false) return fail("staging_text_gate_still_on");
    if (o.staging_broker_enabled !== false) return fail("staging_broker_gate_still_on");
    return ok();
  },
  providerCredentialRemoved(present) { return present === false ? ok() : fail("provider_credential_still_present"); },
  controlsDormant(s) {
    if (s.global_control_epoch !== 3 || s.project_control_epoch !== 3) return fail("control_epoch_not_3");
    if (s.global_control_enabled === true || s.project_control_enabled === true) return fail("control_still_enabled");
    return ok();
  },
  policyNonAuthorizing(s) { return s.active_policy_count === 0 ? ok() : fail("active_policy_remains"); },
  catalogInactive(s) { return s.active_catalog_count === 0 ? ok() : fail("active_catalog_remains"); },
  coreUnchanged(o) { return o.core_unchanged === true ? ok() : fail("core_changed"); },
  // ── Finding 2: PHASE A pre-activation predecessor — the DORMANT/INACTIVE state that
  //    genuinely exists BEFORE activation (opposite of predecessorArmedState). ──
  preActivationDormantPredecessor(s) {
    if (!s || typeof s !== "object") return fail("pre_activation_state_absent");
    if (Number(s.active_catalog_count) !== 0) return fail("catalog_already_active");
    if (Number(s.inactive_catalog_version_count) !== 1) return fail("inactive_catalog_version_not_1");
    if (Number(s.inactive_catalog_entry_count) !== 2) return fail("inactive_catalog_entries_not_2");
    if (s.inactive_catalog_digest !== EXPECT.inactive_catalog_digest) return fail("inactive_catalog_digest_mismatch");
    if (Number(s.active_policy_count) !== 0) return fail("policy_already_active");
    if (s.dormant_policy_present !== true) return fail("dormant_policy_absent");
    if (Number(s.global_control_epoch) !== 1 || Number(s.project_control_epoch) !== 1) return fail("control_epoch_not_1");
    if (s.global_control_enabled !== false || s.project_control_enabled !== false) return fail("control_already_enabled");
    if (s.global_control_killed === true || s.project_control_killed === true) return fail("control_killed");
    return ok();
  },
  approvalNotConsumed(flag) { return flag === false ? ok() : fail("approval_already_consumed_or_unknown"); },
  privilegeProofPresent(o) {
    // the trusted read-only observation capability must attest the restricted-role/credential
    // isolation proof. Offline this is a TEST-only attestation; live requires the real proof.
    if (!o || o.restricted_role_proof_present !== true) return fail("restricted_privilege_proof_absent");
    return ok();
  },
};

function collect(results) {
  const failures = results.filter((r) => r && r.ok === false);
  return { pass: failures.length === 0, failures };
}

/** Finding 2 — PHASE A: PRE-ACTIVATION verification. Uses authoritative observations of the
 *  DORMANT / INACTIVE predecessor (NOT armed state) + an authentic independent approval + exact
 *  target/source + zero prior exposure + approval-not-consumed + the restricted-privilege proof.
 *  It does NOT require the catalog/policy/controls to be active. Runs BEFORE catalog activation. */
export function runPreActivation(deps) {
  need(deps, "deps");
  const R = [
    checks.railwayIds(need(deps.railway, "railway")),
    checks.sourcePin(need(deps.source, "source")),
    checks.dbBindingToAiStaging(need(deps.db, "db")),
    checks.coreExclusion(need(deps.db, "db")),
    checks.catalogFreshness(need(deps.nowIso, "nowIso")),
    checks.independentApprovalVerified({
      envelope: need(deps.approvalEnvelope, "approvalEnvelope"),
      trustRoot: need(deps.trustRoot, "trustRoot"),
      suppliedEvidence: need(deps.suppliedEvidence, "suppliedEvidence"),
      nowIso: need(deps.nowIso, "nowIso"),
      executionId: need(deps.executionId, "executionId"),
      isConsumed: need(deps.isApprovalConsumed, "isApprovalConsumed"),
    }),
    checks.preActivationDormantPredecessor(need(deps.dormantState, "dormantState")),
    checks.zeroPriorProbeExposure(need(deps.counts, "counts")),
    checks.approvalNotConsumed(need(deps.approvalConsumed, "approvalConsumed")),
    checks.privilegeProofPresent(need(deps.privilegeProof, "privilegeProof")),
  ];
  return collect(R);
}

/** Finding 2 / P1-02 Phase-B lifecycle — PHASE B: POST-ACTIVATION / PRE-PROBE verification. ALL
 *  obligations must PASS AFTER the catalog + one-call policy + control transitions have been
 *  applied, and BEFORE the single probe is sent: armed state + all seven ceilings + gates + the
 *  SAME authentic approval correlated to EXACTLY ONE legitimately CONSUMED activation record
 *  (trusted post-commit ledger observation) + a matching deterministic activation receipt. It
 *  performs NO activation and admits NO provider call. */
export function runPreflight(deps) {
  need(deps, "deps");
  const R = [
    checks.railwayIds(need(deps.railway, "railway")),
    checks.sourcePin(need(deps.source, "source")),
    checks.dbBindingToAiStaging(need(deps.db, "db")),
    checks.coreExclusion(need(deps.db, "db")),
    checks.catalogFreshness(need(deps.nowIso, "nowIso")),
    checks.consumedApprovalCorrelated({
      envelope: need(deps.approvalEnvelope, "approvalEnvelope"),
      trustRoot: need(deps.trustRoot, "trustRoot"),
      suppliedEvidence: need(deps.suppliedEvidence, "suppliedEvidence"),
      nowIso: need(deps.nowIso, "nowIso"),
      executionId: need(deps.executionId, "executionId"),
      // lifecycle inputs are passed through as-is (NOT need()'d): a missing/absent ledger
      // observation or activation receipt must FAIL CLOSED inside verifyConsumedApproval with a
      // bounded reason, never throw.
      ledgerObservation: deps.ledgerObservation,
      activationReceipt: deps.activationReceipt,
      testBoundary: deps.testBoundary === true,
    }),
    checks.predecessorArmedState(need(deps.armedState, "armedState")),
    checks.zeroPriorProbeExposure(need(deps.counts, "counts")),
    checks.envNamesPresent(need(deps.gatewayEnvNames, "gatewayEnvNames"), "gateway"),
    checks.envNamesPresent(need(deps.brokerEnvNames, "brokerEnvNames"), "broker"),
    checks.signingKeyCorrespondence(need(deps.gatewayPubFp, "gatewayPubFp"), need(deps.brokerPubFp, "brokerPubFp")),
    checks.reasoningModel(need(deps.reasoningModel, "reasoningModel")),
    checks.providerCredentialPresence(need(deps.providerCredentialPresent, "providerCredentialPresent")),
    checks.gatesStillOffUntilArm(need(deps.gatesBeforeArm, "gatesBeforeArm")),
    checks.operatorSubjectDerivedSafely(need(deps.operatorSubject, "operatorSubject")),
    checks.oneCallCeilingsExact(need(deps.oneCallPolicy, "oneCallPolicy")),
  ];
  return collect(R);
}

/** FUTURE postflight — proves the single probe stayed within bounds + is fully closed. */
export function runPostflight(deps) {
  need(deps, "deps");
  const R = [
    checks.atMostOneReservation(need(deps.counts, "counts")),
    checks.atMostOneProviderCall(need(deps.counts, "counts")),
    checks.settlementExact(need(deps.settlement, "settlement")),
    checks.reconciliationTerminal(need(deps.reconciliation, "reconciliation")),
    checks.spendWithinCeiling(need(deps.actualSpendMicros, "actualSpendMicros")),
    checks.noSecondAuthority(need(deps.counts, "counts")),
    checks.durableEvidenceRetained(need(deps.evidence, "evidence")),
    checks.ingressClosed(need(deps.gatesAfterClose, "gatesAfterClose")),
    checks.providerCredentialRemoved(need(deps.providerCredentialPresent, "providerCredentialPresent")),
    checks.controlsDormant(need(deps.controlState, "controlState")),
    checks.policyNonAuthorizing(need(deps.policyState, "policyState")),
    checks.catalogInactive(need(deps.catalogState, "catalogState")),
    checks.coreUnchanged(need(deps.core, "core")),
  ];
  return collect(R);
}

// ── FAIL-CLOSED CLI: no injected verification context here ⇒ refuse + exit non-zero. ──
function main(argv) {
  const mode = argv.includes("--postflight") ? "postflight" : argv.includes("--preflight") ? "preflight" : null;
  process.stderr.write(
    "[live-ai-03b first-probe verifier] FAIL-CLOSED: this tool performs NO db/network/railway/provider access on its own.\n" +
    "It requires an INJECTED verification context (railway/source/db/armedState/counts/... ) supplied by the\n" +
    "owner-controlled execution harness via runPreflight(deps) / runPostflight(deps). Invoked directly it verifies nothing.\n" +
    `mode=${mode || "none"} — no injected deps present ⇒ refusing (exit 2). No secret is ever printed.\n`,
  );
  process.exit(2);
}
if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2));
