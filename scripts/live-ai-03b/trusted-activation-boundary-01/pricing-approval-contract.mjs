// ─────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — P1-02 TRUSTED ACTIVATION BOUNDARY — signed approval contract.
// OFFLINE, PURE — Node built-ins only. No I/O, no network, no clock, no secrets.
//
// Deterministic, versioned PricingEvidenceApprovalV1 envelope + canonicalization,
// shared by the approval verifier, the trusted executor, and the offline tests.
//
// The envelope is a REVIEWER-SIGNED (Ed25519) statement binding the exact reviewed
// pricing evidence, target, source, activation bundle and a single execution nonce.
// The reviewer PRIVATE key lives OUTSIDE repo / Railway / gateway / probe / executor.
// This module NEVER holds a private key and NEVER embeds a production trust root.
//
// Canonicalization = the accepted BUDGET contract: recursive lexicographic key sort,
// UTF-8, no insignificant whitespace, integers as JSON numbers (floats forbidden),
// booleans as JSON booleans, null as null, standard escaping, explicit domain,
// lowercase SHA-256 hex.
// ─────────────────────────────────────────────────────────────────────────

import { createHash, createPublicKey, verify as edVerify } from "node:crypto";

export const APPROVAL_DOMAIN = "staybid.live-ai.pricing-evidence-approval.v1";
export const APPROVAL_PURPOSE = "activate-catalog+one-call-probe";
export const EVIDENCE_DIGEST_DOMAIN = "staybid.live-ai.budget.pricing-evidence.v1";
export const APPROVAL_ALG = "ed25519";

// ── the FIXED reviewed facts / targets (accepted business + infra contract) ──
export const FIXED = Object.freeze({
  provider: "openai",
  model: "gpt-5.6-terra",
  account_mode: "direct",
  processing_mode: "standard",
  regional_uplift: false,
  currency: "USD",
  input_rate_micros: 2000000,
  output_rate_micros: 12000000,
  unit_size: 1000000,
  excluded_paths: { batch: false, bedrock: false, fast: false, flex: false, scale_tier: false },
  catalog_version_id: "openai-gpt-5-6-terra-standard-short-v1",
  source_id: "openai-api-pricing/gpt-5.6-terra/standard/short-context/v1",
  source_digest: "fda6f4a834b2277bd0ace30738cda1e8f75c0f8bc523ddbd11c966c4da52beb3",
  catalog_verification_expiry: "2026-09-25T18:37:35Z",
  // infra targets
  ai_staging_project: "4ad1abb3-823a-4acf-b889-6d34ae46d7f9",
  ai_staging_environment: "aa397bd7-b316-4fd8-b05a-0a5f6c5e3abc",
  ai_staging_postgres: "b7362594-a01b-4623-a982-394707a6cec2",
  ai_staging_gateway: "dd96c7cd-02c1-4d02-89eb-7e217930ebfa",
  core_excluded_project: "04c8b523-5b15-4d81-af06-8c2aa1a83499",
  core_excluded_postgres: "1fbd7632-95ad-46f3-a20c-5be5b8e44e6b",
  source_commit: "2b69ce28230fc9d56a035846e95d8de206d5db3b",
  source_tree: "87aad22d90f84f2c3b307201c3e0d3b8658b1619",
  inactive_catalog_digest: "453f928762b8e6cddedac8618786d008cb7a3d57ffefab9d0cfe3cda52c4c973",
  active_catalog_digest: "616cc481e8cc342462445da5ededa142ec4450f38805edd91ed798554f3c24f8",
  one_call_policy_digest: "9927a920975c4e03f5cbf3adee23c34bb7396a032b00b029ba5a2c7ac0c8ec1c",
  control_global_activation_digest: "0a60f1eb2050b2d0e4ff43262e9cde12d35c8dab84c30a8ceffc36ffa357878b",
  control_project_activation_digest: "eb56f2b74f1afbb82bed7316c9839201698c780c7881e3604bdc701022315a6f",
});

// ── canonicalization + hashing ──
export function canonicalize(v) {
  if (v === null) return "null";
  const t = typeof v;
  if (t === "boolean") return v ? "true" : "false";
  if (t === "number") { if (!Number.isInteger(v)) throw new Error("float forbidden"); return String(v); }
  if (t === "string") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canonicalize).join(",") + "]";
  if (t === "object") { const k = Object.keys(v).sort(); return "{" + k.map((x) => JSON.stringify(x) + ":" + canonicalize(v[x])).join(",") + "}"; }
  throw new Error("unsupported type " + t);
}
export function sha256hex(s) { return createHash("sha256").update(Buffer.from(s, "utf8")).digest("hex"); }

// ── evidence content digest (same domain the predecessor pricing evidence uses) ──
export function evidenceContentDigest(content) {
  const payload = {
    domain: EVIDENCE_DIGEST_DOMAIN,
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
  return sha256hex(canonicalize(payload));
}

// ── activation bundle digest — binds the approval to the exact reviewed activation set ──
export function activationBundleDigest() {
  const payload = {
    domain: "staybid.live-ai.activation-bundle.v1",
    active_catalog_digest: FIXED.active_catalog_digest,
    inactive_catalog_digest: FIXED.inactive_catalog_digest,
    one_call_policy_digest: FIXED.one_call_policy_digest,
    control_global_activation_digest: FIXED.control_global_activation_digest,
    control_project_activation_digest: FIXED.control_project_activation_digest,
    source_commit: FIXED.source_commit,
    source_tree: FIXED.source_tree,
  };
  return sha256hex(canonicalize(payload));
}

// ── public-key fingerprint = sha256 over the DER SPKI (lowercase hex) ──
export function publicKeyFingerprintFromDerB64(derB64) {
  const der = Buffer.from(derB64, "base64");
  const key = createPublicKey({ key: der, format: "der", type: "spki" }); // throws on non-key
  const spki = key.export({ format: "der", type: "spki" });
  return createHash("sha256").update(spki).digest("hex");
}

// ── build the canonical signed payload (signature is over canonicalize(payload)) ──
export function buildApprovalPayload(input) {
  // input supplies the non-fixed, per-approval fields; FIXED supplies the rest.
  return {
    domain: APPROVAL_DOMAIN,
    purpose: APPROVAL_PURPOSE,
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
      provider: FIXED.provider,
      model: FIXED.model,
      account_mode: FIXED.account_mode,
      processing_mode: FIXED.processing_mode,
      regional_uplift: FIXED.regional_uplift,
      currency: FIXED.currency,
      input_rate_micros: FIXED.input_rate_micros,
      output_rate_micros: FIXED.output_rate_micros,
      unit_size: FIXED.unit_size,
      excluded_paths: FIXED.excluded_paths,
      catalog_version_id: FIXED.catalog_version_id,
      source_id: FIXED.source_id,
      source_digest: FIXED.source_digest,
    },
    target: {
      ai_staging_project: FIXED.ai_staging_project,
      ai_staging_environment: FIXED.ai_staging_environment,
      ai_staging_postgres: FIXED.ai_staging_postgres,
      ai_staging_gateway: FIXED.ai_staging_gateway,
      core_excluded_project: FIXED.core_excluded_project,
      core_excluded_postgres: FIXED.core_excluded_postgres,
      source_commit: FIXED.source_commit,
      source_tree: FIXED.source_tree,
      activation_bundle_digest: activationBundleDigest(),
      inactive_catalog_digest: FIXED.inactive_catalog_digest,
      active_catalog_digest: FIXED.active_catalog_digest,
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

// ── VerifiedApprovalClaimsV1 — the ONE normalized shape produced by the verifier AFTER a
//    successful signature verification, consumed by the executor, the catalog-activation
//    invocation adapter and the PostgreSQL function. Flat, versioned, and derived ONLY from
//    the authenticated payload (never from independently-supplied caller claims). Every
//    consumer reads these exact top-level keys, so an authentic envelope traverses the whole
//    path unchanged (Finding 1). ──
export const VERIFIED_CLAIMS_CONTRACT = "VerifiedApprovalClaimsV1";
export function toVerifiedClaims(p) {
  return {
    contract: VERIFIED_CLAIMS_CONTRACT,
    approval_id: p.approval_id,
    execution_id: p.execution.execution_id,
    receipt_id: p.evidence.receipt_id,
    content_digest: p.evidence.content_digest,
    catalog_version_id: p.scope.catalog_version_id,
    active_catalog_digest: p.target.active_catalog_digest,
    inactive_catalog_digest: p.target.inactive_catalog_digest,
    activation_bundle_digest: p.target.activation_bundle_digest,
    ai_staging_project: p.target.ai_staging_project,
    ai_staging_postgres: p.target.ai_staging_postgres,
    source_commit: p.target.source_commit,
    source_tree: p.target.source_tree,
    approval_not_before: p.execution.not_before,
    approval_expiry: p.execution.expiry,
    evidence_verified_at: p.evidence.verified_at,
    evidence_expiry: p.evidence.evidence_expiry,
    catalog_verification_expiry: FIXED.catalog_verification_expiry,
    reviewer_fingerprint: p.reviewer_public_key_fingerprint,
  };
}

// ── CatalogActivationReceiptV1 — the ONE deterministic, bounded activation-receipt
//    contract derived from the trusted activation result (P1-02 Phase-B consumed-approval
//    lifecycle). The DB function returns the raw receipt FIELDS (from the ledger row it just
//    consumed + the exact catalog transition); the executor attaches this deterministic
//    commitment; Phase B independently recomputes the commitment from the AUTHORITATIVE
//    committed ledger record and requires the receipt to carry that exact value. A fabricated
//    receipt whose fields do not match the authoritative ledger record fails. This is a binding
//    over the reviewed transition; the committed ledger observation remains authoritative. ──
export const RECEIPT_CONTRACT = "CatalogActivationReceiptV1";
export const RECEIPT_ACTION = "activate";
export function activationReceiptCommitment(r) {
  const payload = {
    domain: "staybid.live-ai.catalog-activation-receipt.v1",
    action: RECEIPT_ACTION,
    active_catalog_digest: r.active_catalog_digest,
    approval_id: r.approval_id,
    consumed_at: r.consumed_at,
    content_digest: r.content_digest,
    execution_id: r.execution_id,
  };
  return sha256hex(canonicalize(payload));
}

/** Verify an Ed25519 signature over canonicalize(payload) using a PINNED public key
 *  (DER SPKI, base64). The caller MUST pass the independently-pinned trust-root key;
 *  a key carried inside an untrusted envelope is NEVER used for verification. */
export function verifyEnvelopeSignature(payload, signatureB64, pinnedPublicKeyDerB64) {
  try {
    const der = Buffer.from(pinnedPublicKeyDerB64, "base64");
    const key = createPublicKey({ key: der, format: "der", type: "spki" });
    const msg = Buffer.from(canonicalize(payload), "utf8");
    const sig = Buffer.from(signatureB64, "base64");
    return edVerify(null, msg, key, sig) === true;
  } catch {
    return false;
  }
}
