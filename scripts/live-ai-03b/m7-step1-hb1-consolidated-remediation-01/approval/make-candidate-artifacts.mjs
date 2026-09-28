#!/usr/bin/env node
// LIVE-AI-03B — M7 STEP 1 — emits (A) the CANDIDATE supplied evidence receipt and (B) the
// INDEPENDENT-APPROVAL ANCHOR TEMPLATE. OFFLINE, deterministic. Creates NO signature, NO key,
// NO approval: the template is UNSIGNED and carries explicit reviewer placeholders, so it can
// never verify (it has no signature and no pinned trust root). `--check` fails on drift.
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
import * as G from "../catalog/v2-digest-gen.mjs";
import { buildEvidenceContentV2, evidenceContentDigestV2, buildApprovalPayloadV2, APPROVAL_ALG } from "./pricing-approval-contract-v2.mjs";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const content = buildEvidenceContentV2(G.T0);
const receiptId = "m7s1-pricing-evidence-" + G.V2_ID + "-" + G.T0.replace(/[-:]/g, "");
const receipt = {
  _status: "CANDIDATE SUPPLIED RECEIPT (authority A) — NOT AN APPROVAL, NOT AUTHORITY. Executor retrieved the official OpenAI pages 2026-09-28 (see docs-evidence/); a LATER independent WORK closure must re-verify the facts before any reviewer signs an anchor.",
  receipt: { id: receiptId, digest: evidenceContentDigestV2(content), content },
};
const P = "<REVIEWER-FILLS>";
const payload = buildApprovalPayloadV2({
  approval_id: P + ":approval_id [A-Za-z0-9._:-]{8,128}",
  reviewer_public_key_fingerprint: P + ":sha256(DER SPKI) of the INDEPENDENTLY PINNED reviewer Ed25519 key",
  evidence: { receipt_id: receiptId, content_digest: receipt.receipt.digest, verified_at: G.T0, evidence_expiry: P + ":RFC3339 UTC <= " + G.T0_PLUS_7_DAYS },
  scope: { openai_account_ref: P + ":non-secret account reference", openai_project_ref: P + ":non-secret project reference (project Service Tier must NOT force Fast/Scale)" },
  execution: { execution_id: P + ":single execution nonce", issued_at: P + ":RFC3339 UTC", not_before: P + ":RFC3339 UTC", expiry: P + ":RFC3339 UTC <= " + G.T0_PLUS_7_DAYS },
});
const template = {
  _status: "INDEPENDENT_APPROVED_ANCHOR = REQUIRED BEFORE LIVE ACTIVATION. UNSIGNED TEMPLATE (authority B). Contains NO signature and NO trust root; it cannot verify. The reviewer (an authority independent of the operator/executor) re-verifies the official pricing facts, fills the placeholders, signs canonicalize(payload) with their OFFLINE Ed25519 private key, and the verifier trusts ONLY an independently pinned reviewer public key. A caller-controlled approved=true / matching ids / a key inside the envelope are never authority.",
  alg: APPROVAL_ALG,
  signature_b64: "<REVIEWER-SIGNS-OFFLINE: base64 Ed25519 signature over canonicalize(payload)>",
  payload,
};
const out = { "SUPPLIED-EVIDENCE-RECEIPT-CANDIDATE.json": receipt, "INDEPENDENT-APPROVAL-ANCHOR-TEMPLATE.json": template };
let bad = 0;
for (const [f, v] of Object.entries(out)) {
  const s = JSON.stringify(v, null, 2) + "\n", p = path.join(HERE, f);
  if (process.argv.includes("--check")) { if (!fs.existsSync(p) || fs.readFileSync(p, "utf8") !== s) { console.error("DRIFT " + f); bad++; } }
  else fs.writeFileSync(p, s);
}
if (process.argv.includes("--check")) { console.log(bad ? "candidate artifacts drifted" : "candidate artifacts reproduce byte-exact"); process.exit(bad ? 1 : 0); }
console.log("receipt", receiptId, receipt.receipt.digest);
