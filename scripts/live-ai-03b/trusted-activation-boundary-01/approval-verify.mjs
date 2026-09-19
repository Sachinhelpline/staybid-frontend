// ─────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — P1-02 TRUSTED ACTIVATION BOUNDARY — approval verifier.
// OFFLINE, Node built-ins only. No network / DB / provider / secret.
//
// Validates an independently-signed PricingEvidenceApprovalV1 envelope. This is the
// authentication half of the P1-02 boundary: the reviewer signs (Ed25519) the exact
// reviewed evidence + target + bundle + one execution nonce with a private key held
// OUTSIDE the operator's control. The verifier trusts ONLY an independently-pinned
// reviewer public key (trust root); a key carried in the envelope is never used to
// verify, and a caller cannot substitute the trust root. Matching two caller-supplied
// values is NOT accepted as approval.
//
// This closes the AUTHENTICATION half of P1-02. The EXECUTION/privilege half (a
// standalone operator must not be able to bypass approval via direct SQL) is enforced
// by the DB privilege boundary + one-shot ledger (see db/*.sql) + the trusted executor,
// and is an explicit future live gate (see TRUSTED-BOUNDARY-README.md).
// ─────────────────────────────────────────────────────────────────────────

import {
  APPROVAL_DOMAIN, APPROVAL_PURPOSE, FIXED,
  evidenceContentDigest, activationBundleDigest,
  publicKeyFingerprintFromDerB64, verifyEnvelopeSignature,
  toVerifiedClaims,
  RECEIPT_CONTRACT, RECEIPT_ACTION, activationReceiptCommitment,
} from "./pricing-approval-contract.mjs";

const RFC3339_UTC = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?Z$/;
const HEX64 = /^[0-9a-f]{64}$/;
function fail(reason) { return { ok: false, reason }; }
function ok(extra) { return { ok: true, ...(extra || {}) }; }
const ts = (s) => (RFC3339_UTC.test(String(s)) ? Date.parse(s) : NaN);

// ── trusted, read-only, POST-COMMIT ledger observation provenance (P1-02 Phase-B). A real
//    Phase-B ledger read is performed by an independently-provisioned trusted read-only
//    capability against the AI-STAGING database AFTER the activation transaction commits; a
//    standalone operator cannot forge this provenance. The TEST value is used ONLY inside an
//    explicitly identified offline test boundary. This is a DISTINCT capability from the
//    executor's dormant-state read capability. ──
export const TRUSTED_LEDGER_PROVENANCE = "trusted-approved-ledger-readonly-capability";
export const TEST_LEDGER_PROVENANCE = "TEST-ONLY-ledger-readonly-capability";

/**
 * authenticateApproval — the shared authentication core (trust-root/signature/domain/scope/
 * target/source/catalog/pricing/evidence-binding/freshness/execution-binding). It decides
 * NOTHING about the approval's lifecycle disposition (unused vs consumed); the caller does.
 * Reused UNCHANGED by both verifyApproval (Phase-A unused) and verifyConsumedApproval (Phase-B
 * consumed) so neither phase weakens any authentication check. Returns
 * { ok:true, p, ev, recomputed } or { ok:false, reason }.
 * @param {object} args
 *  - envelope: { payload, signature_b64, alg } (UNTRUSTED, operator-supplied)
 *  - trustRoot: { pinnedPublicKeyDerB64, pinnedFingerprint } (INDEPENDENTLY pinned; NOT from envelope)
 *  - suppliedEvidence: { id, digest, content } (operator-supplied evidence receipt)
 *  - nowIso: RFC3339 UTC execution time
 *  - executionId: the current execution nonce, pinned by the trusted executor
 */
function authenticateApproval(args) {
  const { envelope, trustRoot, suppliedEvidence, nowIso, executionId } = args || {};

  // ── trust root MUST be independently pinned (never taken from the envelope) ──
  if (!trustRoot || typeof trustRoot.pinnedPublicKeyDerB64 !== "string" || typeof trustRoot.pinnedFingerprint !== "string") {
    return fail("trust_root_absent"); // no pinned reviewer key ⇒ BLOCKED (production trust root required)
  }
  let pinnedFp;
  try { pinnedFp = publicKeyFingerprintFromDerB64(trustRoot.pinnedPublicKeyDerB64); } catch { return fail("trust_root_key_invalid"); }
  if (pinnedFp !== trustRoot.pinnedFingerprint) return fail("trust_root_fingerprint_mismatch");

  // ── envelope shape ──
  if (!envelope || typeof envelope !== "object") return fail("envelope_absent");
  if (envelope.alg !== "ed25519") return fail("alg_not_ed25519");
  if (typeof envelope.signature_b64 !== "string" || envelope.signature_b64.length === 0) return fail("signature_absent");
  const p = envelope.payload;
  if (!p || typeof p !== "object") return fail("payload_absent");

  // ── the envelope's declared reviewer fingerprint must equal the PINNED trust root
  //    (reject a caller-substituted trust root), and verification uses the PINNED key. ──
  if (p.reviewer_public_key_fingerprint !== pinnedFp) return fail("envelope_fingerprint_not_pinned_trust_root");

  // ── Ed25519 signature over canonicalize(payload) using the PINNED key ONLY ──
  if (!verifyEnvelopeSignature(p, envelope.signature_b64, trustRoot.pinnedPublicKeyDerB64)) return fail("signature_invalid_or_untrusted_signer");

  // ── domain + purpose ──
  if (p.domain !== APPROVAL_DOMAIN) return fail("domain_mismatch");
  if (p.purpose !== APPROVAL_PURPOSE) return fail("purpose_mismatch");
  if (typeof p.approval_id !== "string" || p.approval_id.trim() === "") return fail("approval_id_absent");

  // ── fixed scope facts ──
  const s = p.scope || {};
  if (s.provider !== FIXED.provider) return fail("provider_mismatch");
  if (s.model !== FIXED.model) return fail("model_mismatch");
  if (s.account_mode !== FIXED.account_mode) return fail("account_mode_mismatch");
  if (s.processing_mode !== FIXED.processing_mode) return fail("processing_mode_mismatch");
  if (s.regional_uplift !== false) return fail("regional_uplift_present");
  if (s.currency !== FIXED.currency) return fail("currency_mismatch");
  if (s.input_rate_micros !== FIXED.input_rate_micros) return fail("input_rate_mismatch");
  if (s.output_rate_micros !== FIXED.output_rate_micros) return fail("output_rate_mismatch");
  if (s.unit_size !== FIXED.unit_size) return fail("unit_size_mismatch");
  if (s.catalog_version_id !== FIXED.catalog_version_id) return fail("catalog_version_mismatch");
  if (s.source_id !== FIXED.source_id) return fail("source_id_mismatch");
  if (s.source_digest !== FIXED.source_digest) return fail("source_digest_mismatch");
  const ep = s.excluded_paths || {};
  for (const k of ["batch", "bedrock", "fast", "flex", "scale_tier"]) if (ep[k] !== false) return fail(`excluded_path_${k}_not_false`);
  if (typeof s.openai_account_ref !== "string" || s.openai_account_ref.trim() === "") return fail("openai_account_ref_absent");
  if (typeof s.openai_project_ref !== "string" || s.openai_project_ref.trim() === "") return fail("openai_project_ref_absent");

  // ── target + CORE exclusion + source + bundle binding ──
  const t = p.target || {};
  if (t.ai_staging_project !== FIXED.ai_staging_project) return fail("ai_staging_project_mismatch");
  if (t.ai_staging_environment !== FIXED.ai_staging_environment) return fail("ai_staging_environment_mismatch");
  if (t.ai_staging_postgres !== FIXED.ai_staging_postgres) return fail("ai_staging_postgres_mismatch");
  if (t.ai_staging_gateway !== FIXED.ai_staging_gateway) return fail("ai_staging_gateway_mismatch");
  if (t.core_excluded_project !== FIXED.core_excluded_project) return fail("core_exclusion_project_mismatch");
  if (t.core_excluded_postgres !== FIXED.core_excluded_postgres) return fail("core_exclusion_postgres_mismatch");
  if (t.source_commit !== FIXED.source_commit) return fail("source_commit_mismatch");
  if (t.source_tree !== FIXED.source_tree) return fail("source_tree_mismatch");
  if (t.inactive_catalog_digest !== FIXED.inactive_catalog_digest) return fail("inactive_catalog_digest_mismatch");
  if (t.active_catalog_digest !== FIXED.active_catalog_digest) return fail("active_catalog_digest_mismatch");
  if (t.activation_bundle_digest !== activationBundleDigest()) return fail("activation_bundle_digest_mismatch");

  // ── evidence binding: the reviewer signed evidence.content_digest + receipt_id; bind the
  //    SUPPLIED evidence to it (operator cannot forge the reviewer signature over a forged digest). ──
  const ev = p.evidence || {};
  if (typeof ev.receipt_id !== "string" || ev.receipt_id.trim() === "") return fail("approval_receipt_id_absent");
  if (!HEX64.test(String(ev.content_digest))) return fail("approval_content_digest_malformed");
  if (!suppliedEvidence || typeof suppliedEvidence !== "object") return fail("supplied_evidence_absent");
  if (suppliedEvidence.id !== ev.receipt_id) return fail("supplied_receipt_id_not_approved");
  if (!suppliedEvidence.content || typeof suppliedEvidence.content !== "object") return fail("supplied_content_absent");
  let recomputed;
  try { recomputed = evidenceContentDigest(suppliedEvidence.content); } catch { return fail("supplied_content_uncanonical"); }
  if (recomputed !== ev.content_digest) return fail("supplied_content_not_approved_digest");
  if (typeof suppliedEvidence.digest === "string" && suppliedEvidence.digest !== recomputed) return fail("supplied_digest_inconsistent");
  // the supplied content facts must ALSO equal the fixed reviewed facts (defense-in-depth).
  const c = suppliedEvidence.content;
  if (c.provider !== FIXED.provider || c.model !== FIXED.model || c.account_mode !== FIXED.account_mode
    || c.processing_mode !== FIXED.processing_mode || c.regional_uplift !== false || c.currency !== FIXED.currency
    || c.catalog_version_id !== FIXED.catalog_version_id || c.source_id !== FIXED.source_id || c.source_digest !== FIXED.source_digest) {
    return fail("supplied_content_facts_mismatch");
  }

  // ── freshness ──
  const now = ts(nowIso);
  if (Number.isNaN(now)) return fail("now_not_rfc3339_utc");
  const notBefore = ts(p.execution.not_before), expiry = ts(p.execution.expiry);
  const evVerified = ts(ev.verified_at), evExpiry = ts(ev.evidence_expiry);
  if (Number.isNaN(notBefore) || Number.isNaN(expiry) || Number.isNaN(evVerified) || Number.isNaN(evExpiry)) return fail("approval_timestamps_malformed");
  if (now < notBefore) return fail("approval_not_yet_valid");
  if (now >= expiry) return fail("approval_expired");
  if (now < evVerified) return fail("evidence_from_future");
  if (now >= evExpiry) return fail("evidence_expired");
  if (now >= ts(FIXED.catalog_verification_expiry)) return fail("catalog_verification_expired");

  // ── execution binding (authentication; NOT lifecycle disposition) ──
  if (typeof executionId !== "string" || executionId.trim() === "") return fail("execution_id_absent");
  if (p.execution.execution_id !== executionId) return fail("approval_for_another_execution");
  if (p.execution.max_uses !== 1) return fail("max_uses_not_one");

  // authentication complete — the lifecycle disposition (unused vs consumed) is the caller's.
  return { ok: true, p, ev, recomputed };
}

/**
 * PHASE-A path (pre-activation / executor): an authentic approval that MUST still be UNUSED.
 * The authoritative single-use guard is the DB ledger; isConsumed is the advisory replay
 * pre-check (absence ⇒ "cannot prove unused" = fail). NEVER use this on the Phase-B
 * post-activation path — a legitimate activation legitimately consumes the approval.
 */
export function verifyApproval(args) {
  const a = authenticateApproval(args);
  if (!a.ok) return a;
  const { p, ev, recomputed } = a;
  const executionId = (args || {}).executionId;
  const isConsumed = (args || {}).isConsumed;
  if (typeof isConsumed !== "function") return fail("consumption_check_unavailable");
  let consumed;
  try { consumed = isConsumed(p.approval_id, executionId) === true; } catch { return fail("consumption_check_error"); }
  if (consumed) return fail("approval_already_consumed_replay");

  // Finding 1 — return the ONE normalized VerifiedApprovalClaimsV1, derived ONLY from the
  // authenticated payload. The executor builds the DB invocation from THIS, never from
  // independently-supplied caller claims; the DB function reads these exact flat keys.
  return ok({ claims: toVerifiedClaims(p), approvalId: p.approval_id, receiptId: ev.receipt_id, executionId, contentDigest: recomputed });
}

/**
 * PHASE-B path (post-activation / pre-probe): the SAME authentic approval, no longer required
 * to be unused. It must instead correlate to EXACTLY ONE legitimately CONSUMED activation in
 * the authoritative AI-STAGING approval-consumption ledger (observed POST-COMMIT via a trusted
 * read-only capability) PLUS a matching deterministic activation receipt. It performs NO
 * activation and grants NO mutation authority. An isConsumed=false result, a caller-supplied
 * count of one, a fabricated ledger object, or a fabricated receipt can NEVER fabricate
 * success: the matching set is computed here from the trusted ledger records, and a second
 * activation stays blocked by the executor one-shot + the DB ledger unique key.
 * Extra args (beyond the authentication args):
 *  - ledgerObservation: { provenance, dbIdentity, committed, records:[{approval_id, execution_id,
 *      content_digest, active_catalog_digest, action, consumed_at}] } — from a trusted read-only
 *      capability against AI-STAGING, AFTER commit.
 *  - activationReceipt: the deterministic CatalogActivationReceiptV1 (contract/approval_id/
 *      execution_id/content_digest/active_catalog_digest/action/consumed_at/commitment).
 *  - testBoundary?: true ONLY for offline TEST fixtures.
 */
export function verifyConsumedApproval(args) {
  const a = authenticateApproval(args);
  if (!a.ok) return a;
  const { p, ev, recomputed } = a;
  const { nowIso, executionId, ledgerObservation, activationReceipt, testBoundary } = args || {};
  const claims = toVerifiedClaims(p);

  // authoritative, trusted, read-only, POST-COMMIT ledger observation tied to AI-STAGING.
  if (!ledgerObservation || typeof ledgerObservation !== "object") return fail("ledger_observation_absent");
  const prov = ledgerObservation.provenance;
  const provOk = testBoundary === true ? prov === TEST_LEDGER_PROVENANCE : prov === TRUSTED_LEDGER_PROVENANCE;
  if (!provOk) return fail("ledger_observation_provenance_untrusted"); // real trusted read capability absent offline ⇒ fail closed
  if (ledgerObservation.dbIdentity !== FIXED.ai_staging_postgres) return fail("ledger_observation_not_ai_staging");
  if (ledgerObservation.committed !== true) return fail("ledger_observation_not_committed"); // a pre-commit function return alone is NOT commit proof
  if (!Array.isArray(ledgerObservation.records)) return fail("ledger_records_absent");

  // compute the matching set OURSELVES — never trust a caller-supplied count or object.
  const matches = ledgerObservation.records.filter((r) => r && typeof r === "object"
    && r.approval_id === claims.approval_id && r.execution_id === claims.execution_id
    && r.content_digest === claims.content_digest && r.active_catalog_digest === claims.active_catalog_digest
    && r.action === RECEIPT_ACTION);
  if (matches.length === 0) return fail("consumed_ledger_record_missing");
  if (matches.length > 1) return fail("consumed_ledger_record_duplicate");
  const rec = matches[0];

  // bounded, valid consumption time within the signed approval validity window.
  const now = ts(nowIso);
  if (Number.isNaN(now)) return fail("now_not_rfc3339_utc");
  const consumedAt = ts(rec.consumed_at);
  if (Number.isNaN(consumedAt)) return fail("consumed_at_invalid");
  if (consumedAt > now) return fail("consumed_at_in_future");
  if (consumedAt < ts(p.execution.not_before) || consumedAt >= ts(p.execution.expiry)) return fail("consumed_at_outside_approval_window");

  // deterministic activation receipt correlated to the AUTHORITATIVE committed ledger record.
  if (!activationReceipt || typeof activationReceipt !== "object") return fail("activation_receipt_absent");
  if (activationReceipt.contract !== RECEIPT_CONTRACT) return fail("activation_receipt_contract_mismatch");
  if (activationReceipt.action !== RECEIPT_ACTION) return fail("receipt_action_mismatch");
  if (activationReceipt.approval_id !== claims.approval_id) return fail("receipt_approval_mismatch");
  if (activationReceipt.execution_id !== claims.execution_id) return fail("receipt_execution_mismatch");
  if (activationReceipt.content_digest !== claims.content_digest) return fail("receipt_content_digest_mismatch");
  if (activationReceipt.active_catalog_digest !== claims.active_catalog_digest) return fail("receipt_active_catalog_mismatch");
  if (activationReceipt.consumed_at !== rec.consumed_at) return fail("receipt_not_correlated_to_ledger");
  const expectCommit = activationReceiptCommitment({
    approval_id: rec.approval_id, execution_id: rec.execution_id, content_digest: rec.content_digest,
    active_catalog_digest: rec.active_catalog_digest, consumed_at: rec.consumed_at,
  });
  if (typeof activationReceipt.commitment !== "string" || activationReceipt.commitment !== expectCommit) return fail("receipt_commitment_not_ledger_derived");

  return ok({ claims, approvalId: claims.approval_id, receiptId: ev.receipt_id, executionId, contentDigest: recomputed, lifecycle: "consumed", consumedAt: rec.consumed_at });
}
