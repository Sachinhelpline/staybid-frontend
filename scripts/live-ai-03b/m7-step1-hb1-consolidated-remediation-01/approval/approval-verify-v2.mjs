// ─────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — M7 STEP 1 — SUCCESSOR V2 approval verifier (P1-02 authentication half).
// OFFLINE, Node built-ins only. No network / DB / provider / secret. Mirrors the ACCEPTED
// trusted-activation-boundary-01/approval-verify.mjs (same trust-root / signature / evidence-binding
// / freshness / execution-binding / Phase-A-unused / Phase-B-consumed structure) with the V2 facts.
// Every rejection is a static reason code. A caller-supplied `approved:true`, a key carried inside
// the envelope, or two matching caller values are NEVER authority.
// ─────────────────────────────────────────────────────────────────────────

import {
  APPROVAL_DOMAIN_V2, APPROVAL_PURPOSE_V2, FIXED_V2, EVIDENCE_CONTENT_KEYS, reviewedRates,
  evidenceContentDigestV2, publicKeyFingerprintFromDerB64, verifyEnvelopeSignature,
  toVerifiedClaimsV2, RECEIPT_CONTRACT_V2, RECEIPT_ACTION, activationReceiptCommitmentV2, canonicalize,
} from "./pricing-approval-contract-v2.mjs";

const RFC3339_UTC = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$/;
const HEX64 = /^[0-9a-f]{64}$/;
const IDRE = /^[A-Za-z0-9._:-]{8,128}$/;
const fail = (reason) => ({ ok: false, reason });
const ts = (s) => (RFC3339_UTC.test(String(s)) ? Date.parse(s) : NaN);
const keysOf = (o) => (o && typeof o === "object" && !Array.isArray(o) ? Object.keys(o).sort().join(",") : null);
const sameKeys = (o, keys) => keysOf(o) === [...keys].sort().join(",");

export const TRUSTED_LEDGER_PROVENANCE = "trusted-approved-ledger-readonly-capability";
export const TEST_LEDGER_PROVENANCE = "TEST-ONLY-ledger-readonly-capability";

const TOP_KEYS = ["approval_id", "domain", "evidence", "execution", "purpose", "reviewer_public_key_fingerprint", "scope", "target"];
const EVIDENCE_KEYS = ["content_digest", "evidence_expiry", "receipt_id", "verified_at"];
const EXEC_KEYS = ["execution_id", "expiry", "issued_at", "max_uses", "not_before"];
const SCOPE_KEYS = ["account_mode", "cache_write_rate_micros", "catalog_version_id", "context_tier", "currency", "excluded_paths",
  "input_rate_micros", "model", "openai_account_ref", "openai_project_ref", "output_rate_micros", "processing_mode", "provider",
  "regional_uplift", "service_tier", "source_digest", "source_id", "unit_size"];
const TARGET_KEYS = ["activation_bundle_digest", "active_catalog_digest", "ai_staging_environment", "ai_staging_gateway", "ai_staging_postgres",
  "ai_staging_project", "base_commit", "base_tree", "catalog_verification_expiry", "core_excluded_postgres", "core_excluded_project",
  "inactive_catalog_digest", "one_call_execution_admissions", "one_call_money_ceiling_micros", "one_call_policy_digest",
  "one_call_policy_id", "one_call_provider_calls"];
const EXCLUDED_KEYS = ["batch", "bedrock", "fast", "flex", "long_context", "priority", "regional", "scale_tier"];

function authenticateApprovalV2(args) {
  const { envelope, trustRoot, suppliedEvidence, nowIso, executionId } = args || {};

  // ── trust root: INDEPENDENTLY pinned; never taken from the envelope or the supplied evidence ──
  if (!trustRoot || typeof trustRoot.pinnedPublicKeyDerB64 !== "string" || typeof trustRoot.pinnedFingerprint !== "string") return fail("trust_root_absent");
  let pinnedFp;
  try { pinnedFp = publicKeyFingerprintFromDerB64(trustRoot.pinnedPublicKeyDerB64); } catch { return fail("trust_root_key_invalid"); }
  if (pinnedFp !== trustRoot.pinnedFingerprint) return fail("trust_root_fingerprint_mismatch");

  if (!envelope || typeof envelope !== "object") return fail("envelope_absent");
  if (envelope.alg !== "ed25519") return fail("alg_not_ed25519");
  if (typeof envelope.signature_b64 !== "string" || envelope.signature_b64.length === 0) return fail("signature_absent");
  const p = envelope.payload;
  if (!p || typeof p !== "object") return fail("payload_absent");
  if (p.reviewer_public_key_fingerprint !== pinnedFp) return fail("envelope_fingerprint_not_pinned_trust_root");
  if (!verifyEnvelopeSignature(p, envelope.signature_b64, trustRoot.pinnedPublicKeyDerB64)) return fail("signature_invalid_or_untrusted_signer");

  // ── exact shape (no extra keys — e.g. an injected "approved": true is rejected, never honoured) ──
  if (!sameKeys(p, TOP_KEYS)) return fail("payload_shape_not_exact");
  if (!sameKeys(p.evidence, EVIDENCE_KEYS) || !sameKeys(p.execution, EXEC_KEYS) || !sameKeys(p.scope, SCOPE_KEYS) || !sameKeys(p.target, TARGET_KEYS)) return fail("payload_section_shape_not_exact");
  if (p.domain !== APPROVAL_DOMAIN_V2) return fail("domain_mismatch");
  if (p.purpose !== APPROVAL_PURPOSE_V2) return fail("purpose_mismatch");
  if (typeof p.approval_id !== "string" || !IDRE.test(p.approval_id)) return fail("approval_id_absent_or_malformed");

  // ── scope: Standard / default tier / direct / non-regional / short-context / exact THREE rates ──
  const s = p.scope;
  if (s.provider !== FIXED_V2.provider) return fail("provider_mismatch");
  if (s.model !== FIXED_V2.model) return fail("model_mismatch");
  if (s.account_mode !== "direct") return fail("account_mode_not_direct");
  if (s.processing_mode !== "standard") return fail("processing_mode_not_standard");
  if (s.service_tier !== "default") return fail("service_tier_not_default");
  if (s.context_tier !== "short") return fail("context_tier_not_short");
  if (s.regional_uplift !== false) return fail("regional_uplift_present");
  if (s.currency !== "USD") return fail("currency_mismatch");
  if (s.unit_size !== FIXED_V2.unit_size) return fail("unit_size_mismatch");
  if (s.input_rate_micros !== FIXED_V2.input_rate_micros) return fail("input_rate_mismatch");
  if (s.cache_write_rate_micros === undefined || s.cache_write_rate_micros === null) return fail("cache_write_rate_missing");
  if (s.cache_write_rate_micros !== FIXED_V2.cache_write_rate_micros) return fail("cache_write_rate_mismatch");
  if (s.output_rate_micros !== FIXED_V2.output_rate_micros) return fail("output_rate_mismatch");
  if (s.catalog_version_id !== FIXED_V2.catalog_version_id) return fail("catalog_version_mismatch");
  if (s.source_id !== FIXED_V2.source_id) return fail("source_id_mismatch");
  if (s.source_digest !== FIXED_V2.source_digest) return fail("source_digest_mismatch");
  if (!sameKeys(s.excluded_paths, EXCLUDED_KEYS)) return fail("excluded_paths_shape_not_exact");
  for (const k of EXCLUDED_KEYS) if (s.excluded_paths[k] !== false) return fail(`excluded_path_${k}_not_false`);
  if (typeof s.openai_account_ref !== "string" || s.openai_account_ref.trim() === "") return fail("openai_account_ref_absent");
  if (typeof s.openai_project_ref !== "string" || s.openai_project_ref.trim() === "") return fail("openai_project_ref_absent");

  // ── target: AI-STAGING only; CORE-PROD excluded; exact V2 catalog + successor policy + bundle ──
  const t = p.target;
  if (t.ai_staging_project !== FIXED_V2.ai_staging_project) return fail("ai_staging_project_mismatch");
  if (t.ai_staging_environment !== FIXED_V2.ai_staging_environment) return fail("ai_staging_environment_mismatch");
  if (t.ai_staging_postgres !== FIXED_V2.ai_staging_postgres) return fail("ai_staging_postgres_mismatch");
  if (t.ai_staging_gateway !== FIXED_V2.ai_staging_gateway) return fail("ai_staging_gateway_mismatch");
  if (t.core_excluded_project !== FIXED_V2.core_excluded_project) return fail("core_exclusion_project_mismatch");
  if (t.core_excluded_postgres !== FIXED_V2.core_excluded_postgres) return fail("core_exclusion_postgres_mismatch");
  if ([t.ai_staging_project, t.ai_staging_postgres, t.ai_staging_environment, t.ai_staging_gateway].some((x) => x === FIXED_V2.core_excluded_project || x === FIXED_V2.core_excluded_postgres)) return fail("core_prod_target_rejected");
  if (t.base_commit !== FIXED_V2.base_commit) return fail("base_commit_mismatch");
  if (t.base_tree !== FIXED_V2.base_tree) return fail("base_tree_mismatch");
  if (t.inactive_catalog_digest !== FIXED_V2.inactive_catalog_digest) return fail("inactive_catalog_digest_mismatch");
  if (t.active_catalog_digest !== FIXED_V2.active_catalog_digest) return fail("active_catalog_digest_mismatch");
  if (t.catalog_verification_expiry !== FIXED_V2.catalog_verification_expiry) return fail("catalog_verification_expiry_mismatch");
  if (t.one_call_policy_id !== FIXED_V2.one_call_policy_id) return fail("one_call_policy_id_mismatch");
  if (t.one_call_policy_digest !== FIXED_V2.one_call_policy_digest) return fail("one_call_policy_digest_mismatch");
  if (t.one_call_money_ceiling_micros !== FIXED_V2.one_call_money_ceiling_micros) return fail("one_call_money_ceiling_mismatch");
  if (t.one_call_provider_calls !== 1) return fail("one_call_provider_calls_not_one");
  if (t.one_call_execution_admissions !== 1) return fail("one_call_execution_admissions_not_one");
  if (t.activation_bundle_digest !== FIXED_V2.activation_bundle_digest) return fail("activation_bundle_digest_mismatch");

  // ── evidence binding: reviewer signed (receipt_id, content_digest); the SUPPLIED receipt must hash to it ──
  const ev = p.evidence;
  if (typeof ev.receipt_id !== "string" || !IDRE.test(ev.receipt_id)) return fail("approval_receipt_id_absent");
  if (!HEX64.test(String(ev.content_digest))) return fail("approval_content_digest_malformed");
  if (!suppliedEvidence || typeof suppliedEvidence !== "object") return fail("supplied_evidence_absent");
  if (suppliedEvidence.id !== ev.receipt_id) return fail("supplied_receipt_id_not_approved");
  const c = suppliedEvidence.content;
  if (!c || typeof c !== "object" || Array.isArray(c)) return fail("supplied_content_absent");
  if (!sameKeys(c, EVIDENCE_CONTENT_KEYS)) return fail("supplied_content_shape_not_exact");
  let recomputed;
  try { recomputed = evidenceContentDigestV2(c); } catch { return fail("supplied_content_uncanonical"); }
  if (recomputed !== ev.content_digest) return fail("supplied_content_not_approved_digest");
  if (typeof suppliedEvidence.digest !== "string" || suppliedEvidence.digest !== recomputed) return fail("supplied_digest_inconsistent");
  // defense-in-depth: the supplied facts equal the fixed reviewed facts (incl. the exact three rates).
  if (c.provider !== FIXED_V2.provider || c.model !== FIXED_V2.model || c.account_mode !== "direct" || c.processing_mode !== "standard"
    || c.service_tier !== "default" || c.context_tier !== "short" || c.regional_uplift !== false || c.currency !== "USD"
    || c.unit_size !== FIXED_V2.unit_size || c.catalog_version_id !== FIXED_V2.catalog_version_id || c.source_id !== FIXED_V2.source_id
    || c.source_digest !== FIXED_V2.source_digest || c.source_url !== FIXED_V2.source_url
    || c.long_context_threshold_input_tokens !== 272000 || c.max_input_tokens !== FIXED_V2.max_input_tokens || c.max_output_tokens !== FIXED_V2.max_output_tokens
    || !(c.max_input_tokens < c.long_context_threshold_input_tokens)) return fail("supplied_content_facts_mismatch");
  if (canonicalize(c.rates) !== canonicalize(reviewedRates())) return fail("supplied_content_rates_mismatch");
  if (!sameKeys(c.excluded_paths, EXCLUDED_KEYS) || EXCLUDED_KEYS.some((k) => c.excluded_paths[k] !== false)) return fail("supplied_content_excluded_paths_mismatch");
  if (c.verified_at !== ev.verified_at) return fail("supplied_verified_at_not_approved");

  // ── freshness (V2 verification window + signed approval/evidence windows) ──
  const now = ts(nowIso);
  if (Number.isNaN(now)) return fail("now_not_rfc3339_utc");
  const nbf = ts(p.execution.not_before), exp = ts(p.execution.expiry), iss = ts(p.execution.issued_at);
  const evv = ts(ev.verified_at), eve = ts(ev.evidence_expiry);
  const catT0 = ts(FIXED_V2.catalog_t0), catExp = ts(FIXED_V2.catalog_verification_expiry);
  if ([nbf, exp, iss, evv, eve].some(Number.isNaN)) return fail("approval_timestamps_malformed");
  if (!(nbf < exp) || !(evv < eve)) return fail("empty_validity_interval");
  if (evv < catT0) return fail("evidence_predates_catalog_verification");
  if (eve > catExp || exp > catExp) return fail("validity_outlives_catalog_verification");
  if (now < catT0) return fail("catalog_verified_at_in_future");
  if (now >= catExp) return fail("catalog_verification_expired");
  if (now < nbf) return fail("approval_not_yet_valid");
  if (now >= exp) return fail("approval_expired");
  if (now < evv) return fail("evidence_from_future");
  if (now >= eve) return fail("evidence_expired");

  if (typeof executionId !== "string" || !IDRE.test(executionId)) return fail("execution_id_absent");
  if (p.execution.execution_id !== executionId) return fail("approval_for_another_execution");
  if (p.execution.max_uses !== 1) return fail("max_uses_not_one");
  return { ok: true, p, ev, recomputed };
}

/** PHASE-A (pre-activation): authentic AND still unused (DB ledger remains the authoritative single-use guard). */
export function verifyApprovalV2(args) {
  const a = authenticateApprovalV2(args);
  if (!a.ok) return a;
  const isConsumed = (args || {}).isConsumed;
  if (typeof isConsumed !== "function") return fail("consumption_check_unavailable");
  let consumed;
  try { consumed = isConsumed(a.p.approval_id, args.executionId) === true; } catch { return fail("consumption_check_error"); }
  if (consumed) return fail("approval_already_consumed_replay");
  return { ok: true, claims: toVerifiedClaimsV2(a.p), approvalId: a.p.approval_id, receiptId: a.ev.receipt_id, executionId: args.executionId, contentDigest: a.recomputed };
}

/** PHASE-B (post-activation): the same authentic approval correlated to EXACTLY ONE committed ledger row + receipt. */
export function verifyConsumedApprovalV2(args) {
  const a = authenticateApprovalV2(args);
  if (!a.ok) return a;
  const { nowIso, ledgerObservation: lo, activationReceipt: r, testBoundary } = args || {};
  const claims = toVerifiedClaimsV2(a.p);
  if (!lo || typeof lo !== "object") return fail("ledger_observation_absent");
  if (!(testBoundary === true ? lo.provenance === TEST_LEDGER_PROVENANCE : lo.provenance === TRUSTED_LEDGER_PROVENANCE)) return fail("ledger_observation_provenance_untrusted");
  if (lo.dbIdentity !== FIXED_V2.ai_staging_postgres) return fail("ledger_observation_not_ai_staging");
  if (lo.committed !== true) return fail("ledger_observation_not_committed");
  if (!Array.isArray(lo.records)) return fail("ledger_records_absent");
  const matches = lo.records.filter((x) => x && x.approval_id === claims.approval_id && x.execution_id === claims.execution_id
    && x.content_digest === claims.content_digest && x.active_catalog_digest === claims.active_catalog_digest && x.action === RECEIPT_ACTION);
  if (matches.length === 0) return fail("consumed_ledger_record_missing");
  if (matches.length > 1) return fail("consumed_ledger_record_duplicate");
  const rec = matches[0];
  const now = ts(nowIso), at = ts(rec.consumed_at);
  if (Number.isNaN(at)) return fail("consumed_at_invalid");
  if (at > now) return fail("consumed_at_in_future");
  if (at < ts(a.p.execution.not_before) || at >= ts(a.p.execution.expiry)) return fail("consumed_at_outside_approval_window");
  if (!r || r.contract !== RECEIPT_CONTRACT_V2 || r.action !== RECEIPT_ACTION || r.catalog_version_id !== FIXED_V2.catalog_version_id) return fail("activation_receipt_contract_mismatch");
  if (r.approval_id !== claims.approval_id || r.execution_id !== claims.execution_id || r.content_digest !== claims.content_digest
    || r.active_catalog_digest !== claims.active_catalog_digest || r.consumed_at !== rec.consumed_at) return fail("receipt_not_correlated_to_ledger");
  if (r.commitment !== activationReceiptCommitmentV2(rec)) return fail("receipt_commitment_not_ledger_derived");
  return { ok: true, claims, lifecycle: "consumed", consumedAt: rec.consumed_at };
}
