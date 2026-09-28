#!/usr/bin/env node
// LIVE-AI-03B — M7 STEP 1 — offline CONTRACT suite (digests, catalog/policy contracts, approval
// two-authority verifier, SQL literal cross-check, static scans). NO DB, NO network, NO secret.
// Ed25519 keys here are EPHEMERAL, generated in-process for the test, never written anywhere.
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
import { generateKeyPairSync, sign as edSign } from "node:crypto";
import { execFileSync } from "node:child_process";
import * as G from "../catalog/v2-digest-gen.mjs";
import { checkV2Catalog, reviewedV2Rows, verifySourceDigest, checkSuccessorPolicy, reviewedPolicyRow } from "../catalog/v2-catalog-contract.mjs";
import * as C from "../approval/pricing-approval-contract-v2.mjs";
import { verifyApprovalV2, verifyConsumedApprovalV2, TEST_LEDGER_PROVENANCE } from "../approval/approval-verify-v2.mjs";
import { CLAIMS_KEYS } from "../build-sql.mjs";

const M7 = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0; const fails = [];
const ok = (c, l) => { if (c) pass++; else { fail++; fails.push(l); console.error("  ✗ " + l); } };
const eq = (a, b, l) => ok(a === b, l + (a === b ? "" : ` [got ${a} want ${b}]`));
const rej = (r, reason, l) => ok(r && r.ok === false && (reason === undefined || r.reason === reason || String(r.reason).startsWith(reason)), l + (r && r.ok === false && r.reason !== reason ? ` [reason ${r && r.reason}]` : ""));
const clone = (x) => JSON.parse(JSON.stringify(x));
const NOW = "2026-09-28T16:26:23Z"; // T0 + 1h — inside every reviewed window

// ─────────── 1. digests / T0 / predecessor reproduction ───────────
ok(G.SELF_CHECK_FAILURES.length === 0, "D01 all 13 accepted predecessor digests reproduce byte-exact (V1 source/catalog, dormant+V1 one-call policy, 4 controls)");
eq(G.T0_PLUS_7_DAYS, new Date(Date.parse(G.T0) + 7 * 86400000).toISOString().replace(".000Z", "Z"), "D02 expiry = T0 + exactly 7 calendar days");
eq(G.V2_WORST_CASE_MICROS, 105920, "D03 reviewed worst case 32768×2.50 + 2000×12.00 = 105,920");
eq(G.V2_ENTRY_IDS.length, 3, "D04 exactly three V2 entries");
const src = G.sourcePayload(G.V2_RATES, G.T0, G.V2_ID);
eq(src.rates.length, 3, "D05 source evidence commits to THREE rates (not the two-rate V1 digest)");
ok(G.SOURCE_DIGEST_V2 !== G.V1.source_digest, "D06 fresh source_digest ≠ historical V1 digest");
ok(verifySourceDigest(src, G.SOURCE_DIGEST_V2), "D07 source_digest verifier reproduces");
{ const t = clone(src); t.rates[1].rate_micros = 2400000; ok(!verifySourceDigest(t, G.SOURCE_DIGEST_V2), "D08 tampered source evidence (cache-write rate) → digest mismatch (#18)"); }
{ const t = clone(src); t.verified_at = G.V1.t0; ok(!verifySourceDigest(t, G.SOURCE_DIGEST_V2), "D09 V1 verified_at reused → digest mismatch"); }
{ const t = clone(src); t.rates = t.rates.filter((r) => r.service_tier !== "cache_write"); ok(!verifySourceDigest(t, G.SOURCE_DIGEST_V2), "D10 two-rate source payload does NOT produce the V2 digest"); }
ok(G.v2Inactive.digest !== G.v2Active.digest && G.v2Active.digest !== G.V1.active_catalog_digest, "D11 inactive ≠ active V2 digest; ≠ V1 digests");
{ const p = G.catalogPayload(G.V2_ID, G.V2_RATES, G.T0, G.T0_PLUS_7_DAYS, G.SOURCE_DIGEST_V2, "active");
  ok(G.digestOf(p).digest === G.v2Active.digest && p.entries.every((e) => e.status === "active") && p.catalog_version.status === "active", "D12 active digest = reviewed lifecycle transition (status only; all other fields byte-preserved)"); }

// ─────────── 2. V2 catalog contract (regressions 3–19; §16 E/F/G) ───────────
const good = (s) => reviewedV2Rows(s);
{ const r = good("inactive"); ok(checkV2Catalog(r.version, r.entries, "inactive", NOW).ok, "C03 exact 3-row inactive V2 accepted (#3)"); }
{ const r = good("active"); ok(checkV2Catalog(r.version, r.entries, "active", NOW).ok, "C04 exact V2 active transition accepted (#4)"); }
const mut = (f, s = "inactive") => { const r = clone(good(s)); f(r); return checkV2Catalog(r.version, r.entries, s, NOW); };
rej(mut((r) => { r.entries = r.entries.filter((e) => e.service_tier !== "cache_write"); }), "entry_missing", "C05 missing cache-write row rejected (#5, §16E)");
rej(mut((r) => { r.entries.find((e) => e.service_tier === "cache_write").rate_micros = 2400000; }), "cache_write_rate_below_published", "C06 cache-write rate < 2,500,000 rejected (#6, §16F)");
rej(mut((r) => { r.entries.find((e) => e.service_tier === "cache_write").rate_micros = 2600000; }), "cache_write_rate_mismatch", "C06b cache-write rate ≠ reviewed rejected");
rej(mut((r) => { r.entries.find((e) => e.service_tier === "cache_write").rate_micros = "2500000"; }), "rate_or_unit_malformed", "C06c cache-write rate as string (malformed) rejected (§16G)");
rej(mut((r) => { r.entries.find((e) => e.service_tier === "cache_write").rate_micros = 2500000.5; }), "rate_or_unit_malformed", "C06d cache-write rate float (malformed) rejected (§16G)");
rej(mut((r) => { r.entries.find((e) => e.service_tier === "cache_write").rate_micros = -1; }), "cache_write_rate_below_published", "C06e negative cache-write rate rejected (§16G)");
rej(mut((r) => { r.entries.find((e) => e.billing_dimension === "reasoning_input_token" && e.service_tier === null).rate_micros = 1900000; }), "input_rate_mismatch", "C08 wrong base input rate rejected (#8)");
rej(mut((r) => { r.entries.find((e) => e.billing_dimension === "reasoning_output_token").rate_micros = 11000000; }), "output_rate_mismatch", "C09 wrong output rate rejected (#9)");
rej(mut((r) => { r.entries[0].unit_size = 1000; }), "unit_size_mismatch", "C10 wrong unit size rejected (#10)");
rej(mut((r) => { r.version.id = "openai-gpt-5-6-terra-standard-short-v3"; }), "catalog_id_mismatch", "C11 wrong catalog ID rejected (#11)");
rej(mut((r) => { r.entries[1].id = r.entries[1].id.replace("cache-write", "cachewrite"); }), "entry_id_mismatch", "C12 wrong entry ID rejected (#12)");
rej(mut((r) => { r.entries.push(clone(r.entries[0])); }), "entry_extra_or_duplicate", "C13 duplicate entry rejected (#13)");
rej(mut((r) => { r.entries[2] = clone(r.entries[0]); }), "duplicate_entry_id", "C13b duplicate entry id (same count) rejected");
rej(mut((r) => { r.entries[0].provider = "azure"; }), "provider_mismatch", "C13c wrong provider rejected");
rej(mut((r) => { r.entries[0].model = "gpt-5.6-sol"; }), "model_mismatch", "C13d wrong model rejected");
rej(mut((r) => { r.entries[0].currency_code = "EUR"; }), "currency_mismatch", "C13e wrong currency rejected");
{ const r = good("inactive"); rej(checkV2Catalog(r.version, r.entries, "inactive", "2026-10-05T15:26:23Z"), "verification_stale", "C16 stale V2 (now ≥ T0+7d) rejected (#16)"); }
{ const r = good("inactive"); rej(checkV2Catalog(r.version, r.entries, "inactive", "2026-09-28T15:26:22Z"), "verified_at_in_future", "C17 future verified_at (now < T0) rejected (#17)"); }
rej(mut((r) => { for (const e of r.entries) e.source_digest = G.V1.source_digest; }), "source_digest_mismatch", "C18 source digest tamper (V1 digest reused) rejected (#18)");
rej(mut((r) => { r.version.catalog_digest = G.v2Active.digest; }), "stored_catalog_digest_mismatch", "C19 catalog digest tamper rejected (#19)");
rej(mut((r) => { r.entries[0].verification_expires_at = "2026-10-12T15:26:23Z"; }), "verification_expiry_mismatch", "C19b V2 expiry extended rejected");
rej(mut((r) => { r.entries[0].status = "active"; }), "entry_status_mismatch", "C19c mixed-status entries rejected");

// ─────────── 3. successor one-call policy (regressions 20–26) ───────────
const pol = reviewedPolicyRow("active");
ok(checkSuccessorPolicy(pol).ok, "P22 exact 105920 successor policy accepted (#22)");
eq([pol.session_money_ceiling_micros, pol.subject_day_money_ceiling_micros, pol.project_day_money_ceiling_micros, pol.project_month_money_ceiling_micros, pol.global_day_money_ceiling_micros].join(), "105920,105920,105920,105920,105920", "P23 all FIVE money ceilings = 105,920 (#23)");
eq(pol.session_provider_calls, 1, "P24 session_provider_calls = 1 (#24)");
eq(pol.session_execution_admissions, 1, "P25 session_execution_admissions = 1 (#25)");
eq(Object.keys(G.V2_CEILINGS).length, 7, "P25b exactly seven ceiling fields (5 money + 2 counts)");
rej(checkSuccessorPolicy({ ...pol, policy_digest: G.ONECALL_V1.active_digest }), "stored_policy_digest_mismatch", "P20 policy digest tamper rejected (#20)");
rej(checkSuccessorPolicy({ ...pol, id: G.ONECALL_V1.id, session_money_ceiling_micros: 89536 }), "obsolete_89536_policy", "P21 old 89536 policy rejected (#21)");
for (const k of ["session_money_ceiling_micros", "subject_day_money_ceiling_micros", "project_day_money_ceiling_micros", "project_month_money_ceiling_micros", "global_day_money_ceiling_micros"]) {
  rej(checkSuccessorPolicy({ ...pol, [k]: 105921 }), "money_ceiling_not_exact", `P26 ${k} > 105920 rejected (#26)`);
  rej(checkSuccessorPolicy({ ...pol, [k]: 105919 }), "money_ceiling_not_exact", `P26 ${k} < 105920 rejected (#26)`);
}
rej(checkSuccessorPolicy({ ...pol, session_provider_calls: 2 }), "provider_calls_not_one", "P26 provider calls 2 rejected");
rej(checkSuccessorPolicy({ ...pol, session_execution_admissions: 0 }), "execution_admissions_not_one", "P26 admissions 0 rejected");
ok(G.v2PolicyActive.digest !== G.ONECALL_V1.active_digest, "P26b successor policy digest ≠ obsolete 89536 digest");

// ─────────── 4. approval two-authority verifier (regressions 27–36, 53) ───────────
const reviewer = generateKeyPairSync("ed25519"), operator = generateKeyPairSync("ed25519");
const der = (k) => k.publicKey.export({ format: "der", type: "spki" }).toString("base64");
const trustRoot = { pinnedPublicKeyDerB64: der(reviewer), pinnedFingerprint: C.publicKeyFingerprintFromDerB64(der(reviewer)) };
const content = C.buildEvidenceContentV2(G.T0);
const supplied = { id: "m7s1-test-receipt-0001", digest: C.evidenceContentDigestV2(content), content };
const EXEC = "exec-m7s1-test-0001";
function payload(over = {}) {
  const p = C.buildApprovalPayloadV2({
    approval_id: "appr-m7s1-test-0001", reviewer_public_key_fingerprint: trustRoot.pinnedFingerprint,
    evidence: { receipt_id: supplied.id, content_digest: supplied.digest, verified_at: G.T0, evidence_expiry: "2026-10-04T00:00:00Z" },
    scope: { openai_account_ref: "acct-ref-synthetic", openai_project_ref: "proj-ref-synthetic" },
    execution: { execution_id: EXEC, issued_at: "2026-09-28T15:30:00Z", not_before: "2026-09-28T15:30:00Z", expiry: "2026-10-01T00:00:00Z" },
  });
  return over.mutate ? (over.mutate(p), p) : p;
}
const envOf = (p, key = reviewer) => ({ alg: "ed25519", payload: p, signature_b64: edSign(null, Buffer.from(C.canonicalize(p), "utf8"), key.privateKey).toString("base64") });
const V = (env, o = {}) => verifyApprovalV2({ envelope: env, trustRoot: ("trustRoot" in o) ? o.trustRoot : trustRoot, suppliedEvidence: o.supplied ?? supplied, nowIso: o.now ?? NOW, executionId: o.exec ?? EXEC, isConsumed: o.isConsumed ?? (() => false) });
const good1 = V(envOf(payload()));
ok(good1.ok === true, "A00 genuine reviewer-signed V2 approval + matching supplied receipt verifies" + (good1.ok ? "" : ` [${good1.reason}]`));
eq(Object.keys(good1.claims || {}).sort().join(","), [...CLAIMS_KEYS].sort().join(","), "A00b emitted VerifiedApprovalClaimsV2 key set == the DB function's exact key set");
rej(V(envOf(payload()), { trustRoot: null }), "trust_root_absent", "A27 missing independent approval anchor (no pinned trust root) rejected (#27)");
rej(V({ alg: "ed25519", payload: payload(), signature_b64: "" }), "signature_absent", "A27b unsigned envelope rejected");
{ const p = payload(); rej(V(envOf(p, operator)), "signature_invalid_or_untrusted_signer", "A28 self-approval (operator-signed) rejected (#28)"); }
{ const opFp = C.publicKeyFingerprintFromDerB64(der(operator)); const p = payload({ mutate: (x) => { x.reviewer_public_key_fingerprint = opFp; } });
  rej(V(envOf(p, operator)), "envelope_fingerprint_not_pinned_trust_root", "A28b self-approval with the operator's own fingerprint rejected"); }
{ const p = payload(); p.approved = true; rej(V(envOf(p)), "payload_shape_not_exact", "A28c injected approved:true (even reviewer-signed) is never authority"); }
{ const env = envOf(payload()); env.payload = { ...env.payload, approved: true }; rej(V(env), "signature_invalid_or_untrusted_signer", "A28d caller-added approved:true breaks the signature"); }
rej(V(envOf(payload()), { supplied: { ...supplied, id: "m7s1-other-receipt-9" } }), "supplied_receipt_id_not_approved", "A29 receipt/anchor ID mismatch rejected (#29)");
{ const c2 = clone(content); c2.rates[1].rate_micros = 2000000; rej(V(envOf(payload()), { supplied: { id: supplied.id, digest: C.evidenceContentDigestV2(c2), content: c2 } }), "supplied_content_not_approved_digest", "A30 supplied/approved digest mismatch rejected (#30)"); }
rej(V(envOf(payload()), { supplied: { ...supplied, digest: "0".repeat(64) } }), "supplied_digest_inconsistent", "A30b supplied digest inconsistent rejected");
const scopeCase = (k, v, reason, l) => rej(V(envOf(payload({ mutate: (p) => { p.scope[k] = v; } }))), reason, l);
scopeCase("processing_mode", "batch", "processing_mode_not_standard", "A31 wrong processing mode (batch) rejected (#31)");
scopeCase("regional_uplift", true, "regional_uplift_present", "A32 regional uplift rejected (#32)");
scopeCase("service_tier", "priority", "service_tier_not_default", "A33 Priority service tier rejected (#33)");
scopeCase("service_tier", "fast", "service_tier_not_default", "A33b Fast service tier rejected (#33)");
scopeCase("service_tier", "flex", "service_tier_not_default", "A35 Flex service tier rejected (#35)");
scopeCase("service_tier", "auto", "service_tier_not_default", "A39 'auto' (project-inherited) tier rejected (#39)");
scopeCase("processing_mode", "flex", "processing_mode_not_standard", "A35b Flex processing mode rejected (#35)");
scopeCase("context_tier", "long", "context_tier_not_short", "A36 long-context rejected (#36)");
scopeCase("account_mode", "bedrock", "account_mode_not_direct", "A31b non-direct account mode rejected");
for (const k of ["batch", "flex", "fast", "priority", "regional", "long_context", "scale_tier", "bedrock"])
  rej(V(envOf(payload({ mutate: (p) => { p.scope.excluded_paths[k] = true; } }))), `excluded_path_${k}_not_false`, `A3x excluded path ${k}=true rejected (#32–36)`);
scopeCase("cache_write_rate_micros", 2400000, "cache_write_rate_mismatch", "A05 wrong cache-write rate in approval rejected (#6)");
rej(V(envOf(payload({ mutate: (p) => { delete p.scope.cache_write_rate_micros; } }))), "payload_section_shape_not_exact", "A05b missing cache-write rate in approval rejected (#5)");
scopeCase("input_rate_micros", 2100000, "input_rate_mismatch", "A08 wrong input rate rejected");
scopeCase("output_rate_micros", 12500000, "output_rate_mismatch", "A09 wrong output rate rejected");
scopeCase("unit_size", 1000, "unit_size_mismatch", "A10 wrong unit size rejected");
scopeCase("catalog_version_id", G.V1.id, "catalog_version_mismatch", "A11 V1 catalog id rejected (#11)");
scopeCase("source_digest", G.V1.source_digest, "source_digest_mismatch", "A18 V1 source digest rejected (#18)");
const tgtCase = (k, v, reason, l) => rej(V(envOf(payload({ mutate: (p) => { p.target[k] = v; } }))), reason, l);
tgtCase("active_catalog_digest", G.V1.active_catalog_digest, "active_catalog_digest_mismatch", "A19 catalog digest mismatch rejected (#19)");
tgtCase("one_call_policy_digest", G.ONECALL_V1.active_digest, "one_call_policy_digest_mismatch", "A20 old/tampered policy digest rejected (#20/#21)");
tgtCase("one_call_money_ceiling_micros", 89536, "one_call_money_ceiling_mismatch", "A21 89536 ceiling rejected (#21)");
tgtCase("one_call_provider_calls", 2, "one_call_provider_calls_not_one", "A24 provider calls ≠ 1 rejected");
tgtCase("activation_bundle_digest", "0".repeat(64), "activation_bundle_digest_mismatch", "A19b bundle digest mismatch rejected");
tgtCase("ai_staging_postgres", "1fbd7632-95ad-46f3-a20c-5be5b8e44e6b", "ai_staging_postgres_mismatch", "A53 CORE-PROD Postgres as target rejected (#53)");
tgtCase("ai_staging_project", "04c8b523-5b15-4d81-af06-8c2aa1a83499", "ai_staging_project_mismatch", "A53b CORE-PROD project as target rejected (#53)");
tgtCase("base_commit", "2b69ce28230fc9d56a035846e95d8de206d5db3b", "base_commit_mismatch", "A19c stale base commit rejected");
rej(V(envOf(payload()), { now: "2026-10-05T15:26:23Z" }), "catalog_verification_expired", "A16 stale V2 (now ≥ T0+7d) rejected (#16)");
rej(V(envOf(payload()), { now: "2026-09-28T15:00:00Z" }), "catalog_verified_at_in_future", "A17 now < V2 verified_at rejected (#17)");
rej(V(envOf(payload()), { now: "2026-10-01T00:00:00Z" }), "approval_expired", "A16b approval expired rejected");
rej(V(envOf(payload({ mutate: (p) => { p.evidence.evidence_expiry = "2026-10-06T00:00:00Z"; } }))), "validity_outlives_catalog_verification", "A16c evidence outliving the V2 verification rejected");
rej(V(envOf(payload({ mutate: (p) => { p.evidence.verified_at = "2026-09-27T00:00:00Z"; } })), { supplied }), "supplied_verified_at_not_approved", "A17b evidence verified_at not the approved value rejected");
rej(V(envOf(payload()), { exec: "exec-m7s1-other-9999" }), "approval_for_another_execution", "A45a approval bound to another execution rejected");
rej(V(envOf(payload()), { isConsumed: () => true }), "approval_already_consumed_replay", "A45 replay (already consumed) rejected (#45)");
rej(verifyApprovalV2({ envelope: envOf(payload()), trustRoot, suppliedEvidence: supplied, nowIso: NOW, executionId: EXEC }), "consumption_check_unavailable", "A45b no consumption check ⇒ cannot prove unused ⇒ rejected");
{ const tpl = JSON.parse(fs.readFileSync(path.join(M7, "approval/INDEPENDENT-APPROVAL-ANCHOR-TEMPLATE.json"), "utf8"));
  const r = V({ alg: tpl.alg, payload: tpl.payload, signature_b64: tpl.signature_b64 });
  ok(r.ok === false, "A27c the UNSIGNED anchor template never verifies (no fabricated approval) [" + r.reason + "]"); }
{ const cand = JSON.parse(fs.readFileSync(path.join(M7, "approval/SUPPLIED-EVIDENCE-RECEIPT-CANDIDATE.json"), "utf8")).receipt;
  eq(C.evidenceContentDigestV2(cand.content), cand.digest, "A00c candidate supplied receipt digest reproduces"); }
// Phase B (consumed) path
{ const consumedAt = "2026-09-28T16:00:00Z";
  const rec = { approval_id: "appr-m7s1-test-0001", execution_id: EXEC, content_digest: supplied.digest, active_catalog_digest: G.v2Active.digest, action: "activate", consumed_at: consumedAt };
  const receipt = { contract: C.RECEIPT_CONTRACT_V2, catalog_version_id: G.V2_ID, ...rec, commitment: C.activationReceiptCommitmentV2(rec) };
  const lo = { provenance: TEST_LEDGER_PROVENANCE, dbIdentity: C.FIXED_V2.ai_staging_postgres, committed: true, records: [rec] };
  const B = (o) => verifyConsumedApprovalV2({ envelope: envOf(payload()), trustRoot, suppliedEvidence: supplied, nowIso: NOW, executionId: EXEC, ledgerObservation: o.lo ?? lo, activationReceipt: o.r ?? receipt, testBoundary: true });
  ok(B({}).ok === true, "B01 Phase-B consumed approval correlates to exactly one committed V2 ledger row");
  rej(B({ lo: { ...lo, records: [rec, rec] } }), "consumed_ledger_record_duplicate", "B02 duplicate consumption rejected");
  rej(B({ lo: { ...lo, records: [] } }), "consumed_ledger_record_missing", "B03 missing consumption rejected");
  rej(B({ r: { ...receipt, commitment: "0".repeat(64) } }), "receipt_commitment_not_ledger_derived", "B04 fabricated receipt rejected");
  rej(B({ lo: { ...lo, committed: false } }), "ledger_observation_not_committed", "B05 uncommitted observation rejected");
  rej(B({ lo: { ...lo, dbIdentity: "1fbd7632-95ad-46f3-a20c-5be5b8e44e6b" } }), "ledger_observation_not_ai_staging", "B06 CORE-PROD ledger observation rejected"); }

// ─────────── 5. SQL literal cross-check + reproducibility + static scans ───────────
const sql = Object.fromEntries(fs.readdirSync(path.join(M7, "sql")).map((f) => [f, fs.readFileSync(path.join(M7, "sql", f), "utf8")]));
const all = Object.values(sql).join("\n");
for (const [k, v] of [["source_digest", G.SOURCE_DIGEST_V2], ["inactive", G.v2Inactive.digest], ["active", G.v2Active.digest], ["policy", G.v2PolicyActive.digest], ["policy_restored", G.v2PolicyRestored.digest], ["bundle", G.v2Bundle.digest], ["T0", G.T0], ["expiry", G.T0_PLUS_7_DAYS]])
  ok(all.includes(v), `S01 SQL embeds the generator's ${k} literal`);
ok(!/\bnow\(\)|CURRENT_TIMESTAMP|clock_timestamp\(\)/.test(sql["m7-v2-01-inactive-catalog-seed.sql"].replace(/--[^\n]*/g, "")), "S02 seed uses NO now()/CURRENT_TIMESTAMP/clock_timestamp() (frozen T0 only)");
ok((sql["m7-v2-02-trusted-successor-migration.sql"].match(/SECURITY DEFINER SET search_path = ''/g) || []).length === 2, "S03 both successor functions: SECURITY DEFINER + search_path = ''");
ok(!/\b(DELETE|TRUNCATE)\b/i.test((sql["m7-v2-07-dormant-restoration.sql"] + sql["m7-v2-06-catalog-restoration.sql"] + sql["m7-v2-02-trusted-successor-migration.sql"]).replace(/--[^\n]*/g, "")), "S04 restoration/trusted SQL contains no DELETE/TRUNCATE (evidence preserved)");
ok(!/GRANT[^;]*TO\s+(PUBLIC|live_ai_03b_reader|live_ai_03b_gateway_store)/i.test(sql["m7-v2-02-trusted-successor-migration.sql"]), "S05 no grant to PUBLIC / reader / gateway-store");
ok(!/GRANT\s+(INSERT|UPDATE|DELETE|ALL)[^;]*TO\s+live_ai_03b_executor/i.test(all), "S06 no direct table-write grant to the executor anywhere");
ok(!/sk-[A-Za-z0-9]{16}|OPENAI_API_KEY\s*=|postgres(ql)?:\/\/[^\s'"]+@|BEGIN [A-Z ]*PRIVATE KEY|password\s*=\s*'[^<]/i.test(all), "S07 no secret / DSN / API key / private key in SQL artifacts");
ok(!/api\.openai\.com|railway\s+(up|run|variables|ssh)/i.test(all), "S08 SQL artifacts carry no provider endpoint / Railway command");
ok(!/1fbd7632-95ad-46f3-a20c-5be5b8e44e6b/.test(all.replace(/NEVER CORE-PROD[^\n]*/g, "").replace(/core_excluded_postgres[^\n]*/g, "")), "S09 CORE-PROD Postgres id appears only as the exclusion binding");
try { execFileSync(process.execPath, [path.join(M7, "build-sql.mjs"), "--check"], { stdio: "pipe" }); ok(true, "S10 build-sql --check: SQL reproduces byte-exact from the generator"); } catch { ok(false, "S10 build-sql --check"); }
try { execFileSync(process.execPath, [path.join(M7, "approval/make-candidate-artifacts.mjs"), "--check"], { stdio: "pipe" }); ok(true, "S11 candidate receipt + anchor template reproduce byte-exact"); } catch { ok(false, "S11 candidate artifacts"); }
{ const derived = sql["m7-v2-04-one-call-policy-activation.sql"] + sql["m7-v2-05-control-activation.sql"] + sql["m7-v2-07-dormant-restoration.sql"];
  ok(!/9927a920975c4e03f5cbf3adee23c34bb7396a032b00b029ba5a2c7ac0c8ec1c|616cc481e8cc342462445da5ededa142ec4450f38805edd91ed798554f3c24f8/.test(derived), "S12 derived artifacts reference no V1-active / old-policy digest");
  ok((sql["m7-v2-04-one-call-policy-activation.sql"].match(/105920/g) || []).length >= 11, "S13 successor policy SQL: 105920 on all five money fields (insert + postcondition)"); }
{ const accepted = ["one-call-policy-activation.sql", "control-activation.sql", "dormant-restoration.sql"].map((f) => fs.readFileSync(path.join(process.env.REPO || "/home/user/staybid-frontend", "scripts/live-ai-03b/first-text-probe-activation-01", f), "utf8"));
  ok(accepted[0].includes("89536") && accepted[1].includes("616cc481"), "S14 accepted kit files are read-only inputs (unchanged; still V1/89536)"); }
eq(CLAIMS_KEYS.length, 36, "S15 claims contract has exactly 36 keys");
ok(sql["m7-v2-02-trusted-successor-migration.sql"].includes('array_agg(k ORDER BY k COLLATE pg_catalog."C")') && JSON.stringify([...CLAIMS_KEYS].sort()) === JSON.stringify(CLAIMS_KEYS), "S16 claims key-set comparison is byte-order (COLLATE \"C\") on both sides — independent of the hosted DB default collation");
ok(!/CREATE ROLE|ALTER ROLE|PASSWORD/i.test(all.replace(/--[^\n]*/g, "")), "S17 M7 SQL creates/alters no role and sets no password (no credential provisioning)");

console.log(`\nm7-contract: ${pass} passed, ${fail} failed`);
if (fail) { console.log(fails.join("\n")); process.exit(1); }
