// ─────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — M7 STEP 1 — SUCCESSOR V2 signed-approval contract (P1-02 two-authority model).
// OFFLINE, PURE — Node built-ins only. No I/O, no network, no clock, no secret, no private key.
//
// Preserves the ACCEPTED P1-02 model (trusted-activation-boundary-01/pricing-approval-contract.mjs):
//   A. SUPPLIED evidence receipt  { id, digest, content }  (operator-supplied; NOT authority), and
//   B. an INDEPENDENTLY-APPROVED ANCHOR — a reviewer-signed Ed25519 PricingEvidenceApprovalV2
//      envelope, verified ONLY against an independently PINNED reviewer public key (trust root).
// A caller cannot self-approve: two matching caller values / an `approved:true` flag / a key carried
// inside the envelope are NEVER authority. The reviewer PRIVATE key lives outside repo / Railway /
// gateway / probe / executor. This module never holds a private key and embeds NO trust root.
//
// V2 deltas vs the accepted V1 contract (HB-1):
//   • THREE rates bound (input 2,000,000 · cache_write 2,500,000 · output 12,000,000 per 1,000,000);
//   • service_tier "default" (Standard) bound; Fast/Priority/Flex/Batch/Scale/regional/long-context
//     explicitly excluded; short context (≤ 32,768 input ≪ 272,000 long-context threshold);
//   • successor one-call policy (id + digest + 105,920 money ceiling; 1 call; 1 admission) bound;
//   • V2 catalog identity + inactive/active digests + fresh source_digest + T0+7d expiry bound;
//   • the activation bundle is the V2 bundle (catalog/v2-digest-gen.mjs bundlePayloadV2).
// ─────────────────────────────────────────────────────────────────────────

import { createHash, createPublicKey, verify as edVerify } from "node:crypto";
import * as G from "../catalog/v2-digest-gen.mjs";

export const canonicalize = G.canonicalize;
export const sha256hex = G.sha256hex;

export const APPROVAL_DOMAIN_V2 = "staybid.live-ai.pricing-evidence-approval.v2";
export const APPROVAL_PURPOSE_V2 = "activate-catalog-v2+one-call-probe";
export const EVIDENCE_DIGEST_DOMAIN_V2 = "staybid.live-ai.budget.pricing-evidence.v2";
export const APPROVAL_ALG = "ed25519";
export const VERIFIED_CLAIMS_CONTRACT_V2 = "VerifiedApprovalClaimsV2";
export const RECEIPT_CONTRACT_V2 = "CatalogActivationReceiptV2";
export const RECEIPT_ACTION = "activate";

const EXCLUDED = Object.freeze({ batch: false, bedrock: false, fast: false, flex: false, long_context: false, priority: false, regional: false, scale_tier: false });

// ── the FIXED reviewed V2 facts / targets ──
export const FIXED_V2 = Object.freeze({
  provider: "openai",
  model: "gpt-5.6-terra",
  account_mode: "direct",
  processing_mode: "standard",
  service_tier: "default",
  context_tier: "short",
  regional_uplift: false,
  currency: "USD",
  unit_size: 1000000,
  input_rate_micros: 2000000,
  cache_write_rate_micros: 2500000,
  output_rate_micros: 12000000,
  long_context_threshold_input_tokens: 272000,
  max_input_tokens: G.MAX_INPUT_TOKENS,
  max_output_tokens: G.MAX_OUTPUT_TOKENS,
  excluded_paths: EXCLUDED,
  catalog_version_id: G.V2_ID,
  catalog_entry_ids: G.V2_ENTRY_IDS,
  source_id: G.SOURCE_ID,
  source_url: G.SOURCE_URL,
  source_digest: G.SOURCE_DIGEST_V2,
  catalog_t0: G.T0,
  catalog_verification_expiry: G.T0_PLUS_7_DAYS,
  inactive_catalog_digest: G.v2Inactive.digest,
  active_catalog_digest: G.v2Active.digest,
  one_call_policy_id: G.V2_POLICY_ID,
  one_call_policy_digest: G.v2PolicyActive.digest,
  one_call_money_ceiling_micros: G.V2_CEILING_MICROS,
  one_call_provider_calls: 1,
  one_call_execution_admissions: 1,
  activation_bundle_digest: G.v2Bundle.digest,
  base_commit: G.BASE_COMMIT,
  base_tree: G.BASE_TREE,
  // infra targets (unchanged accepted identities)
  ai_staging_project: "4ad1abb3-823a-4acf-b889-6d34ae46d7f9",
  ai_staging_environment: "aa397bd7-b316-4fd8-b05a-0a5f6c5e3abc",
  ai_staging_postgres: "b7362594-a01b-4623-a982-394707a6cec2",
  ai_staging_gateway: "dd96c7cd-02c1-4d02-89eb-7e217930ebfa",
  core_excluded_project: "04c8b523-5b15-4d81-af06-8c2aa1a83499",
  core_excluded_postgres: "1fbd7632-95ad-46f3-a20c-5be5b8e44e6b",
});

/** the three reviewed rate rows, in canonical entry-id order. */
export function reviewedRates() {
  return G.V2_RATES.map((r) => ({ billing_dimension: r.billing_dimension, rate_micros: r.rate_micros, service_tier: r.service_tier, unit_size: r.unit_size }));
}

// ── supplied evidence content (A) → content digest ──
export function buildEvidenceContentV2(verifiedAt) {
  return {
    account_mode: FIXED_V2.account_mode,
    catalog_version_id: FIXED_V2.catalog_version_id,
    context_tier: FIXED_V2.context_tier,
    currency: FIXED_V2.currency,
    excluded_paths: { ...EXCLUDED },
    long_context_threshold_input_tokens: FIXED_V2.long_context_threshold_input_tokens,
    max_input_tokens: FIXED_V2.max_input_tokens,
    max_output_tokens: FIXED_V2.max_output_tokens,
    model: FIXED_V2.model,
    processing_mode: FIXED_V2.processing_mode,
    provider: FIXED_V2.provider,
    rates: reviewedRates(),
    regional_uplift: false,
    service_tier: FIXED_V2.service_tier,
    source_digest: FIXED_V2.source_digest,
    source_id: FIXED_V2.source_id,
    source_url: FIXED_V2.source_url,
    unit_size: FIXED_V2.unit_size,
    verified_at: verifiedAt,
  };
}
const EVIDENCE_FACT_KEYS = Object.keys(buildEvidenceContentV2("x")).filter((k) => k !== "verified_at").sort();
export function evidenceContentDigestV2(content) {
  if (!content || typeof content !== "object" || Array.isArray(content)) throw new Error("content not an object");
  const facts = {};
  for (const k of EVIDENCE_FACT_KEYS) facts[k] = content[k];
  return sha256hex(canonicalize({ domain: EVIDENCE_DIGEST_DOMAIN_V2, facts, verified_at: content.verified_at }));
}
export const EVIDENCE_CONTENT_KEYS = Object.freeze([...EVIDENCE_FACT_KEYS, "verified_at"].sort());

export function publicKeyFingerprintFromDerB64(derB64) {
  const der = Buffer.from(derB64, "base64");
  const key = createPublicKey({ key: der, format: "der", type: "spki" });
  return createHash("sha256").update(key.export({ format: "der", type: "spki" })).digest("hex");
}

// ── the canonical signed payload (B, signed by the reviewer over canonicalize(payload)) ──
export function buildApprovalPayloadV2(input) {
  return {
    domain: APPROVAL_DOMAIN_V2,
    purpose: APPROVAL_PURPOSE_V2,
    approval_id: input.approval_id,
    reviewer_public_key_fingerprint: input.reviewer_public_key_fingerprint,
    evidence: {
      receipt_id: input.evidence.receipt_id,
      content_digest: input.evidence.content_digest,
      verified_at: input.evidence.verified_at,
      evidence_expiry: input.evidence.evidence_expiry,
    },
    scope: {
      openai_account_ref: input.scope.openai_account_ref, // non-secret reference, never a credential
      openai_project_ref: input.scope.openai_project_ref,
      provider: FIXED_V2.provider, model: FIXED_V2.model, account_mode: FIXED_V2.account_mode,
      processing_mode: FIXED_V2.processing_mode, service_tier: FIXED_V2.service_tier, context_tier: FIXED_V2.context_tier,
      regional_uplift: false, currency: FIXED_V2.currency, unit_size: FIXED_V2.unit_size,
      input_rate_micros: FIXED_V2.input_rate_micros, cache_write_rate_micros: FIXED_V2.cache_write_rate_micros,
      output_rate_micros: FIXED_V2.output_rate_micros, excluded_paths: { ...EXCLUDED },
      catalog_version_id: FIXED_V2.catalog_version_id, source_id: FIXED_V2.source_id, source_digest: FIXED_V2.source_digest,
    },
    target: {
      ai_staging_project: FIXED_V2.ai_staging_project, ai_staging_environment: FIXED_V2.ai_staging_environment,
      ai_staging_postgres: FIXED_V2.ai_staging_postgres, ai_staging_gateway: FIXED_V2.ai_staging_gateway,
      core_excluded_project: FIXED_V2.core_excluded_project, core_excluded_postgres: FIXED_V2.core_excluded_postgres,
      base_commit: FIXED_V2.base_commit, base_tree: FIXED_V2.base_tree,
      activation_bundle_digest: FIXED_V2.activation_bundle_digest,
      inactive_catalog_digest: FIXED_V2.inactive_catalog_digest, active_catalog_digest: FIXED_V2.active_catalog_digest,
      catalog_verification_expiry: FIXED_V2.catalog_verification_expiry,
      one_call_policy_id: FIXED_V2.one_call_policy_id, one_call_policy_digest: FIXED_V2.one_call_policy_digest,
      one_call_money_ceiling_micros: FIXED_V2.one_call_money_ceiling_micros,
      one_call_provider_calls: 1, one_call_execution_admissions: 1,
    },
    execution: {
      execution_id: input.execution.execution_id,
      issued_at: input.execution.issued_at,
      not_before: input.execution.not_before,
      expiry: input.execution.expiry,
      max_uses: 1,
    },
  };
}

// ── VerifiedApprovalClaimsV2 — the ONE flat shape the DB function accepts (exact 36-key set) ──
export function toVerifiedClaimsV2(p) {
  return {
    contract: VERIFIED_CLAIMS_CONTRACT_V2,
    approval_id: p.approval_id,
    execution_id: p.execution.execution_id,
    receipt_id: p.evidence.receipt_id,
    content_digest: p.evidence.content_digest,
    reviewer_fingerprint: p.reviewer_public_key_fingerprint,
    approval_not_before: p.execution.not_before,
    approval_expiry: p.execution.expiry,
    evidence_verified_at: p.evidence.verified_at,
    evidence_expiry: p.evidence.evidence_expiry,
    provider: p.scope.provider, model: p.scope.model, account_mode: p.scope.account_mode,
    processing_mode: p.scope.processing_mode, service_tier: p.scope.service_tier, context_tier: p.scope.context_tier,
    regional_uplift: p.scope.regional_uplift, currency: p.scope.currency, unit_size: p.scope.unit_size,
    input_rate_micros: p.scope.input_rate_micros, cache_write_rate_micros: p.scope.cache_write_rate_micros,
    output_rate_micros: p.scope.output_rate_micros,
    catalog_version_id: p.scope.catalog_version_id, source_digest: p.scope.source_digest,
    inactive_catalog_digest: p.target.inactive_catalog_digest, active_catalog_digest: p.target.active_catalog_digest,
    catalog_verification_expiry: p.target.catalog_verification_expiry,
    activation_bundle_digest: p.target.activation_bundle_digest,
    one_call_policy_id: p.target.one_call_policy_id, one_call_policy_digest: p.target.one_call_policy_digest,
    one_call_money_ceiling_micros: p.target.one_call_money_ceiling_micros,
    base_commit: p.target.base_commit,
    ai_staging_project: p.target.ai_staging_project, ai_staging_postgres: p.target.ai_staging_postgres,
    core_excluded_project: p.target.core_excluded_project, core_excluded_postgres: p.target.core_excluded_postgres,
  };
}

export function activationReceiptCommitmentV2(r) {
  return sha256hex(canonicalize({
    domain: "staybid.live-ai.catalog-activation-receipt.v2",
    action: RECEIPT_ACTION, catalog_version_id: FIXED_V2.catalog_version_id,
    active_catalog_digest: r.active_catalog_digest, approval_id: r.approval_id, consumed_at: r.consumed_at,
    content_digest: r.content_digest, execution_id: r.execution_id,
  }));
}

/** Ed25519 over canonicalize(payload) using ONLY the independently pinned key (DER SPKI, base64). */
export function verifyEnvelopeSignature(payload, signatureB64, pinnedPublicKeyDerB64) {
  try {
    const key = createPublicKey({ key: Buffer.from(pinnedPublicKeyDerB64, "base64"), format: "der", type: "spki" });
    if (key.asymmetricKeyType !== "ed25519") return false;
    return edVerify(null, Buffer.from(canonicalize(payload), "utf8"), key, Buffer.from(signatureB64, "base64")) === true;
  } catch { return false; }
}
