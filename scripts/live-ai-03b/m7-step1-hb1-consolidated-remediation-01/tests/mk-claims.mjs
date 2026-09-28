#!/usr/bin/env node
// TEST-ONLY: emits a VerifiedApprovalClaimsV2 object exactly as approval-verify-v2.mjs would AFTER a
// successful reviewer-signature verification (built via the same toVerifiedClaimsV2 over a V2 payload),
// with validity windows around the REAL current time. argv[2] = approval id, argv[3] = execution id,
// argv[4] = optional JSON overrides ({"__delete":[keys]} removes keys). Never used outside the offline suite.
import * as C from "../approval/pricing-approval-contract-v2.mjs";
import * as G from "../catalog/v2-digest-gen.mjs";
const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
const now = Date.now(), exp = Date.parse(G.T0_PLUS_7_DAYS);
const content = C.buildEvidenceContentV2(G.T0);
const p = C.buildApprovalPayloadV2({
  approval_id: process.argv[2], reviewer_public_key_fingerprint: "f".repeat(64),
  evidence: { receipt_id: "m7s1-test-receipt-0001", content_digest: C.evidenceContentDigestV2(content), verified_at: G.T0, evidence_expiry: iso(Math.min(now + 7200e3, exp)) },
  scope: { openai_account_ref: "acct-ref-synthetic", openai_project_ref: "proj-ref-synthetic" },
  execution: { execution_id: process.argv[3], issued_at: iso(now - 600e3), not_before: iso(now - 600e3), expiry: iso(Math.min(now + 7200e3, exp)) },
});
const claims = C.toVerifiedClaimsV2(p);
const over = process.argv[4] ? JSON.parse(process.argv[4]) : {};
for (const k of over.__delete || []) delete claims[k];
delete over.__delete;
process.stdout.write(JSON.stringify({ ...claims, ...over }));
