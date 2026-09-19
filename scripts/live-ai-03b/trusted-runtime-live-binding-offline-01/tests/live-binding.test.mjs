// CONSOLIDATED OFFLINE SUITE — LIVE-AI-03B-P1-02 ...-CONSOLIDATED-MATERIAL-REMEDIATION-01
// Exercises the ACTUAL new integration code (four reviewed queries + registry + composition)
// against the FROZEN read adapter + verifier + checks, using a disposable in-memory fixture +
// synthetic keys under an explicit test boundary. NOT proof of live PostgreSQL behavior/authority.
//
// Finding 1 (exact policy/object binding) is proven two ways: (a) STATIC assertions that the exact
// bindings are in the ACTUAL SQL bytes; (b) query→observation→FROZEN-checker flow (positive +
// negatives). Finding 2 (registry-content authority) reproduces the WORK substituted-query attack.
// Actual hosted PostgreSQL dialect/transaction behavior remains a FUTURE live gate.
import { generateKeyPairSync, sign as edSign } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));   // .../trusted-runtime-live-binding-offline-01/tests
const RT = resolve(HERE, "..");                         // .../trusted-runtime-live-binding-offline-01
const LA = resolve(RT, "..");                           // .../live-ai-03b
const TER = resolve(LA, "trusted-executor-runtime-01");
const TB = resolve(LA, "trusted-activation-boundary-01");
const KIT = resolve(LA, "first-text-probe-activation-01");
const imp = (p) => import(pathToFileURL(p).href);

const q = await imp(`${RT}/production-read-queries.mjs`);
const comp = await imp(`${RT}/production-authority-composition.mjs`);
const fix = await imp(`${RT}/tests/live-binding-fixture.mjs`);
const pf = await imp(`${KIT}/first-probe-preflight-postflight.mjs`);
const { makeTrustedReadAdapter } = await imp(`${TER}/trusted-read-adapter.mjs`);
const { verifyConnectionTargetBinding, CONNECTION_IDENTITY_PROOF_CONTRACT } = await imp(`${TER}/db-target-binding.mjs`);
const { runTrustedExecutorTest } = await imp(`${TER}/trusted-executor-runtime.mjs`);
const contract = await imp(`${TB}/pricing-approval-contract.mjs`);
const { FIXED, buildApprovalPayload, evidenceContentDigest, canonicalize, sha256hex, publicKeyFingerprintFromDerB64 } = contract;
const EXPECT = pf.EXPECT, checks = pf.checks;

let pass = 0, fail = 0; const fails = [];
function ok(n, c) { if (c) pass++; else { fail++; fails.push(n); console.log("  FAIL:", n); } }

const ISS = "iss-test", TOK = "tok-test";
const proof = { provenance: CONNECTION_IDENTITY_PROOF_CONTRACT.test_provenance, issuer: ISS, boundConnectionToken: TOK, serviceId: FIXED.ai_staging_postgres, projectId: FIXED.ai_staging_project, environmentId: FIXED.ai_staging_environment };
const tbnd = verifyConnectionTargetBinding({ expectedServiceId: FIXED.ai_staging_postgres, expectedIssuer: ISS, connectionToken: TOK, connectionIdentityProof: proof, testBoundary: true });
function reader(fxOpts, catalogActive = false) {
  const fx = fix.makeFixture(fxOpts);
  if (catalogActive) fx.state.catalogActive = true; // armed reads require an ACTIVE catalog row
  return { fx, r: makeTrustedReadAdapter({ dbClient: fx.client, targetBinding: tbnd, reviewedStateQueries: q.buildReviewedStateQueries(), mode: "test" }) };
}

// ═══════ 1. registry integrity + digest + query shape (Task A) ═══════
console.log("1. registry + query integrity");
ok("assertRegistryIntegrity ok", q.assertRegistryIntegrity().ok === true);
ok("registry digest stable + hex", /^[0-9a-f]{64}$/.test(q.CANDIDATE_REGISTRY_DIGEST));
ok("buildReviewedStateQueries carries digest + 4 queries", (() => { const b = q.buildReviewedStateQueries(); return b.__registryDigest === q.CANDIDATE_REGISTRY_DIGEST && b.dormantPolicyControl && b.armedPolicyControl && b.ceilings && b.zeroExposureCounts; })());
ok("all 4 queries present in registry", q.REVIEWED_STATE_KEYS.every((k) => typeof q.CANDIDATE_QUERY_REGISTRY[k] === "string"));
ok("tampered registry fails integrity", q.assertRegistryIntegrity({ ...q.CANDIDATE_QUERY_REGISTRY, ceilings: "SELECT TRUE" }).ok === false);
ok("queries are SELECT-only, no DML, no ';'", q.REVIEWED_STATE_KEYS.every((k) => { const s = q.CANDIDATE_QUERY_REGISTRY[k]; return /^SELECT/i.test(s) && !/\b(INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER|CREATE|GRANT|REVOKE)\b/i.test(s) && !s.includes(";"); }));

// ── Finding 1: STATIC binding assertions — the exact bindings live in the ACTUAL SQL bytes ──
const D = q.DORMANT_POLICY_CONTROL_QUERY, A = q.ARMED_POLICY_CONTROL_QUERY, C = q.CEILINGS_QUERY, Z = q.ZERO_EXPOSURE_COUNTS_QUERY;
ok("F1: dormant relations are public.-qualified (no unqualified budget_)", !/FROM\s+budget_/i.test(D) && /public\.budget_policy_versions/.test(D) && /public\.budget_control_epochs/.test(D));
ok("F1: armed relations are public.-qualified", !/FROM\s+budget_/i.test(A) && /public\.budget_policy_versions/.test(A) && /public\.budget_control_epochs/.test(A));
ok("F1: ceilings relation is public.-qualified", !/FROM\s+budget_/i.test(C) && /public\.budget_policy_versions/.test(C));
ok("F1: zeroExposure = 8 public.-qualified accounting relations", !/FROM\s+budget_/i.test(Z) && (Z.match(/public\.budget_/g) || []).length === 8);
ok("F1: dormant active-policy count is GLOBAL (no project filter)", D.includes("count(*)::int FROM public.budget_policy_versions WHERE status='active') AS active_policy_count"));
ok("F1: dormant_present binds exact dormant id + digest + single-row cardinality", D.includes("id='live-ai-03b-policy-v1-dormant'") && D.includes(q.DORMANT_POLICY_DIGEST) && D.includes("(SELECT count(*)::int FROM public.budget_policy_versions) = 1"));
ok("F1: armed digest binds exact one-call id + exactly-one-globally-active guard", A.includes("id='live-ai-03b-policy-oneprobe-v1'") && A.includes("(SELECT count(*) FROM public.budget_policy_versions WHERE status='active') = 1"));
ok("F1: armed reads stored policy_digest + record_digest columns", A.includes("policy_digest") && A.includes("record_digest"));
ok("F1: armed does NOT emit the adapter-discarded active_policy_count field", !A.includes("active_policy_count"));
ok("F1: ceilings bind the SAME exact one-call identity + digest", C.includes("id='live-ai-03b-policy-oneprobe-v1'") && C.includes(q.ONE_CALL_POLICY_DIGEST) && C.includes("session_money_ceiling_micros"));
ok("F1: scope keys are the accepted literals global / live-ai-03b", A.includes("scope_key_digest='global'") && A.includes("scope_key_digest='live-ai-03b'"));

// ═══════ 2. query → observation → FROZEN checks (positive + Finding-1 negatives) ═══════
console.log("2. query→observation via frozen read adapter + checks");
{
  const { r } = reader({}); // fresh (inactive catalog) → dormant predecessor
  const d = await r.observeDormant();
  ok("dormant observation ok", d.ok === true);
  ok("dormant → preActivationDormantPredecessor PASS", checks.preActivationDormantPredecessor(d.dormantState).ok === true);
  ok("dormant counts → zeroPriorProbeExposure PASS", checks.zeroPriorProbeExposure(d.counts).ok === true);
}
{
  const { r } = reader({}, true); // active catalog → armed + ceilings
  const a = await r.observeArmed();
  ok("armed observation ok", a.ok === true);
  ok("armed → predecessorArmedState PASS", checks.predecessorArmedState(a.armedState).ok === true);
  const c = await r.observeCeilings();
  ok("ceilings observation ok", c.ok === true);
  ok("ceilings → oneCallCeilingsExact PASS", checks.oneCallCeilingsExact(c.oneCallPolicy).ok === true);
}
async function dormantNeg(name, ov) { const { r } = reader({ overrides: ov }); let bad; try { const d = await r.observeDormant(); bad = !d.ok || checks.preActivationDormantPredecessor(d.dormantState).ok === false; } catch { bad = true; } ok(name, bad); }
async function armedNeg(name, ov) { const { r } = reader({ overrides: ov }, true); let bad; try { const a = await r.observeArmed(); bad = !a.ok || checks.predecessorArmedState(a.armedState).ok === false; } catch { bad = true; } ok(name, bad); }
async function ceilNeg(name, ov) { const { r } = reader({ overrides: ov }, true); let bad; try { const c = await r.observeCeilings(); bad = !c.ok || checks.oneCallCeilingsExact(c.oneCallPolicy).ok === false; } catch { bad = true; } ok(name, bad); }
async function zeroNeg(name, ov) { const { r } = reader({ overrides: ov }); let bad; try { const d = await r.observeDormant(); bad = !d.ok || checks.zeroPriorProbeExposure(d.counts).ok === false; } catch { bad = true; } ok(name, bad); }

// §6 required Phase-A negatives (the GLOBAL active count surfaces wildcard AND foreign active policies)
await dormantNeg("F1#1 active wildcard policy (Phase A) rejects", { dormant: () => ({ ...fix.DORMANT_ROW(), active_policy_count: 1 }) });
await dormantNeg("F1#2 active foreign-project policy (Phase A) rejects", { dormant: () => ({ ...fix.DORMANT_ROW(), active_policy_count: 1 }) });
await dormantNeg("F1#5 missing accepted dormant policy rejects", { dormant: () => ({ ...fix.DORMANT_ROW(), dormant_policy_present: false }) });
await dormantNeg("F1#6 wrong dormant policy id rejects (present=false)", { dormant: () => ({ ...fix.DORMANT_ROW(), dormant_policy_present: false }) });
await dormantNeg("F1#7 wrong dormant policy digest rejects (present=false)", { dormant: () => ({ ...fix.DORMANT_ROW(), dormant_policy_present: false }) });
await dormantNeg("F1#8 extra/duplicate dormant policy row rejects (present=false)", { dormant: () => ({ ...fix.DORMANT_ROW(), dormant_policy_present: false }) });
await dormantNeg("F1 missing control row (null epoch) rejects", { dormant: () => ({ ...fix.DORMANT_ROW(), global_control_epoch: null }) });
await dormantNeg("F1 armed-as-dormant (epoch 2 enabled) rejects", { dormant: () => ({ ...fix.DORMANT_ROW(), global_control_epoch: 2, project_control_epoch: 2, global_control_enabled: true, project_control_enabled: true }) });
await dormantNeg("F1 dormant observation missing (0 rows) fails closed", { dormant: () => null });

// §6 required Phase-B negatives (an extra/duplicate/foreign globally-active policy ⇒ digest NULL)
await armedNeg("F1#3 additional active wildcard policy (Phase B) → digest NULL rejects", { armed: () => ({ ...fix.ARMED_ROW(), one_call_policy_digest: null }) });
await armedNeg("F1#4 additional active foreign-project policy (Phase B) → digest NULL rejects", { armed: () => ({ ...fix.ARMED_ROW(), one_call_policy_digest: null }) });
await armedNeg("F1#9 wrong one-call policy id → digest NULL rejects", { armed: () => ({ ...fix.ARMED_ROW(), one_call_policy_digest: null }) });
await armedNeg("F1#10 wrong one-call policy digest rejects", { armed: () => ({ ...fix.ARMED_ROW(), one_call_policy_digest: "0".repeat(64) }) });
await armedNeg("F1#11 extra/duplicate globally-active policy → digest NULL rejects", { armed: () => ({ ...fix.ARMED_ROW(), one_call_policy_digest: null }) });
await armedNeg("F1#14a wrong project control digest rejects", { armed: () => ({ ...fix.ARMED_ROW(), control_project_digest: "0".repeat(64) }) });
await armedNeg("F1#14b wrong global control digest rejects", { armed: () => ({ ...fix.ARMED_ROW(), control_global_digest: "0".repeat(64) }) });
await armedNeg("F1#14c stale project control epoch (1) rejects", { armed: () => ({ ...fix.ARMED_ROW(), project_control_epoch: 1 }) });
await armedNeg("F1 dormant-as-armed (disabled) rejects", { armed: () => ({ ...fix.ARMED_ROW(), global_control_enabled: false, global_control_epoch: 1 }) });
await armedNeg("F1 killed control rejects", { armed: () => ({ ...fix.ARMED_ROW(), project_control_killed: true }) });
await armedNeg("F1 armed observation missing (0 rows) fails closed", { armed: () => null });

// §6 #12 ceilings from a different active policy identity ⇒ the id/digest-bound query matches nothing
await ceilNeg("F1#12 ceilings from a different identity (0 rows) fails closed", { ceilings: () => null });
await ceilNeg("F1 mismatched ceiling rejects", { ceilings: () => ({ ...fix.CEILINGS_ROW(), global_day_money_ceiling_micros: 89535 }) });
await ceilNeg("F1 missing ceiling field rejects", { ceilings: () => ({ ...fix.CEILINGS_ROW(), session_money_ceiling_micros: undefined }) });

// zero-exposure negatives (§5.S preserved)
await zeroNeg("F1 nonzero prior exposure rejects", { zero: () => ({ ...fix.ZERO_ROW(), envelopes: 1 }) });
await zeroNeg("F1 malformed counts reject", { zero: () => ({ ...fix.ZERO_ROW(), sessions: "x" }) });

// simulated hosted-DB scalar-subquery cardinality error (duplicate active policy) ⇒ fail closed
{
  const fx = fix.makeFixture({ throwOn: new Set([q.ARMED_POLICY_CONTROL_QUERY]) });
  fx.state.catalogActive = true; // so observeArmed reaches the armed query where the error is simulated
  const r = makeTrustedReadAdapter({ dbClient: fx.client, targetBinding: tbnd, reviewedStateQueries: q.buildReviewedStateQueries(), mode: "test" });
  let threw = false, res = null; try { res = await r.observeArmed(); } catch { threw = true; }
  ok("F1 duplicate-active subquery error fails closed (simulated)", threw || (res && res.ok === false));
}

// ═══════ 3. end-to-end: the four REAL corrected queries drive the frozen accepted lifecycle ═══════
console.log("3. end-to-end via frozen test entrypoint with the real registry");
{
  const kp = generateKeyPairSync("ed25519");
  const derB64 = kp.publicKey.export({ format: "der", type: "spki" }).toString("base64");
  const fp = publicKeyFingerprintFromDerB64(derB64);
  const trustRoot = { pinnedPublicKeyDerB64: derB64, pinnedFingerprint: fp };
  const evContent = { account_mode: "direct", catalog_version_id: FIXED.catalog_version_id, currency: "USD", excluded_paths: { batch: false, bedrock: false, fast: false, flex: false, scale_tier: false }, model: "gpt-5.6-terra", processing_mode: "standard", provider: "openai", rates: { input_rate_micros: 2000000, output_rate_micros: 12000000, unit_size: 1000000 }, regional_uplift: false, source_digest: FIXED.source_digest, source_id: "openai-api-pricing/gpt-5.6-terra/standard/short-context/v1", verified_at: "2026-09-20T00:00:00Z" };
  const cd = evidenceContentDigest(evContent);
  const payload = buildApprovalPayload({ approval_id: "appr-1", reviewer_public_key_fingerprint: fp, evidence: { receipt_id: "r1", content_digest: cd, verified_at: evContent.verified_at, evidence_expiry: "2026-09-25T00:00:00Z" }, scope: { openai_account_ref: "a", openai_project_ref: "p" }, execution: { execution_id: "exec-1", issued_at: "2026-09-20T00:00:00Z", not_before: "2026-09-20T00:00:00Z", expiry: "2026-09-25T00:00:00Z" } });
  const envlp = { payload, signature_b64: edSign(null, Buffer.from(canonicalize(payload), "utf8"), kp.privateKey).toString("base64"), alg: "ed25519" };
  const fx = fix.makeFixture({ consumedAtIso: "2026-09-21T00:00:00Z" });
  const env = { LIVE_AI_03B_TRUSTED_EXECUTOR_DB_URL: "t://e", LIVE_AI_03B_TRUSTED_READER_DB_URL: "t://r", LIVE_AI_03B_REVIEWER_TRUST_ROOT_DER_B64: derB64, LIVE_AI_03B_REVIEWER_TRUST_ROOT_FINGERPRINT: fp, LIVE_AI_03B_AI_STAGING_PROJECT_ID: FIXED.ai_staging_project, LIVE_AI_03B_AI_STAGING_ENVIRONMENT_ID: FIXED.ai_staging_environment, LIVE_AI_03B_AI_STAGING_PG_SERVICE_ID: FIXED.ai_staging_postgres, LIVE_AI_03B_AI_STAGING_GATEWAY_SERVICE_ID: FIXED.ai_staging_gateway, LIVE_AI_03B_CONNECTION_IDENTITY_PROOF_REF: "ref" };
  const r = await runTrustedExecutorTest({
    testBoundary: true, env, trustRoot, expectedIssuer: ISS, connectionToken: TOK, connectionIdentityProof: proof,
    executorDbClient: fx.client, readerDbClient: fx.client, reviewedStateQueries: q.buildReviewedStateQueries(),
    approvalEnvelope: envlp, suppliedEvidence: { id: "r1", digest: cd, content: evContent }, executionId: "exec-1",
    nowProvider: () => "2026-09-21T00:05:00Z", sourcePin: { deployed_commit: FIXED.source_commit, deployed_tree: FIXED.source_tree, gateway_deployment_revision: FIXED.source_commit },
    privilegeProof: { restricted_role_proof_present: true },
  });
  ok("end-to-end with real 4 queries → CATALOG_ACTIVATION_AND_PHASE_B_COMPLETE", r.ok === true && r.stage === "CATALOG_ACTIVATION_AND_PHASE_B_COMPLETE" && r.probeReady === false);
}

// ═══════ 4. production-authority composition (Task C) + Finding-2 registry-content authority ═══════
console.log("4. production-authority composition + Finding 2 (supplied-SQL authority)");
ok("acquireComposedProductionAuthority unprovisioned offline", (await comp.acquireComposedProductionAuthority()).available === false);
ok("clean request accepted by whitelist", comp.rejectCallerSuppliedAuthority({ approvalEnvelope: {}, suppliedEvidence: {}, executionId: "e" }).ok === true);
for (const k of ["executorDbClient", "readerDbClient", "trustRoot", "connectionIdentityProof", "privilegeProof", "reviewedStateQueries", "sourcePin", "env", "testBoundary"]) {
  ok(`caller-supplied ${k} rejected`, comp.rejectCallerSuppliedAuthority({ approvalEnvelope: {}, suppliedEvidence: {}, executionId: "e", [k]: {} }).ok === false);
}
ok("validate: absent authority fails", comp.validateProvisionedAuthority(null).ok === false);
ok("validate: testBoundary rejected", comp.validateProvisionedAuthority({}, { testBoundary: true }).ok === false);
function goodCandidate() {
  return {
    cfg: { ok: true, targets: { pgServiceId: FIXED.ai_staging_postgres, projectId: FIXED.ai_staging_project, environmentId: FIXED.ai_staging_environment, gatewayServiceId: FIXED.ai_staging_gateway }, reviewer: { pinnedFingerprint: "f".repeat(64) } },
    trustRoot: { pinnedPublicKeyDerB64: "x", pinnedFingerprint: "f".repeat(64) },
    executorDbClient: { query: async () => ({ rows: [] }) }, readerDbClient: { query: async () => ({ rows: [] }) },
    connectionIdentityProof: { provenance: CONNECTION_IDENTITY_PROOF_CONTRACT.trusted_provenance, issuer: "real-iss", boundConnectionToken: "real-tok", serviceId: FIXED.ai_staging_postgres, projectId: FIXED.ai_staging_project, environmentId: FIXED.ai_staging_environment },
    expectedIssuer: "real-iss", connectionToken: "real-tok",
    privilegeProof: { restricted_role_proof_present: true },
    reviewedStateQueries: q.buildReviewedStateQueries(), sourcePin: { deployed_commit: FIXED.source_commit }, nowProvider: () => "2026-09-21T00:00:00Z",
  };
}
ok("validate: correctly-shaped candidate passes the bar", comp.validateProvisionedAuthority(goodCandidate()).ok === true);
ok("validate: __testFixture client rejected", comp.validateProvisionedAuthority({ ...goodCandidate(), executorDbClient: { __testFixture: true, query: async () => ({}) } }).ok === false);
ok("validate: bare boolean privilege rejected", comp.validateProvisionedAuthority({ ...goodCandidate(), privilegeProof: true }).ok === false);
ok("validate: unbound connection token rejected", comp.validateProvisionedAuthority({ ...goodCandidate(), connectionToken: "other" }).ok === false);
ok("validate: CORE target rejected", (() => { const c = goodCandidate(); c.cfg.targets.pgServiceId = FIXED.core_excluded_postgres; return comp.validateProvisionedAuthority(c).ok === false; })());
ok("validate: test provenance in production rejected", comp.validateProvisionedAuthority({ ...goodCandidate(), connectionIdentityProof: { ...goodCandidate().connectionIdentityProof, provenance: CONNECTION_IDENTITY_PROOF_CONTRACT.test_provenance } }).ok === false);

// ── Finding 2: registry-content authority — a copied correct digest can NEVER bless substituted SQL ──
const good = q.buildReviewedStateQueries();
const mut = (o) => ({ ...good, ...o });
ok("F2 legit supplied registry passes", q.assertSuppliedRegistry(good).ok === true);
ok("F2 correct digest + one changed query rejects", q.assertSuppliedRegistry(mut({ ceilings: "SELECT 1" })).ok === false);
ok("F2 correct digest + all four changed rejects", q.assertSuppliedRegistry(mut({ dormantPolicyControl: "SELECT 1", armedPolicyControl: "SELECT 1", ceilings: "SELECT 1", zeroExposureCounts: "SELECT 1" })).ok === false);
ok("F2 correct digest + missing key rejects", (() => { const m = mut({}); delete m.ceilings; return q.assertSuppliedRegistry(m).ok === false; })());
ok("F2 correct digest + extra key rejects", q.assertSuppliedRegistry(mut({ extraKey: "SELECT 1" })).ok === false);
ok("F2 correct digest + whitespace-altered query rejects", q.assertSuppliedRegistry(mut({ ceilings: q.CEILINGS_QUERY + " " })).ok === false);
ok("F2 missing registry marker rejects", (() => { const m = mut({}); delete m.__registryDigest; return q.assertSuppliedRegistry(m).ok === false; })());
ok("F2 incorrect registry marker rejects", q.assertSuppliedRegistry(mut({ __registryDigest: "0".repeat(64) })).ok === false);
// supplied digest that MATCHES altered SQL but is not the pinned registry digest → still rejects
{
  const alt4 = { dormantPolicyControl: good.dormantPolicyControl, armedPolicyControl: good.armedPolicyControl, ceilings: "SELECT 2 AS session_money_ceiling_micros", zeroExposureCounts: good.zeroExposureCounts };
  const fullAlt = { ...alt4, ledgerCommitted: q.CANDIDATE_QUERY_REGISTRY.ledgerCommitted, catalogActiveCount: q.CANDIDATE_QUERY_REGISTRY.catalogActiveCount, catalogActiveDigest: q.CANDIDATE_QUERY_REGISTRY.catalogActiveDigest, catalogInactiveVersion: q.CANDIDATE_QUERY_REGISTRY.catalogInactiveVersion, catalogInactiveEntryCount: q.CANDIDATE_QUERY_REGISTRY.catalogInactiveEntryCount };
  const altDigest = sha256hex(canonicalize(fullAlt));
  ok("F2 digest matching altered SQL (not pinned) rejects", q.assertSuppliedRegistry({ __registryDigest: altDigest, ...alt4 }).ok === false && altDigest !== q.CANDIDATE_REGISTRY_DIGEST);
}
// the reproduced WORK attack, THROUGH the production-authority validator
ok("F2 WORK attack (correct digest + fabricated SQL) rejected by validator", comp.validateProvisionedAuthority({ ...goodCandidate(), reviewedStateQueries: { __registryDigest: q.CANDIDATE_REGISTRY_DIGEST, dormantPolicyControl: "SELECT 1", armedPolicyControl: "SELECT 1", ceilings: "SELECT 1", zeroExposureCounts: "SELECT 1" } }).ok === false);
ok("F2 validator still ACCEPTS the legit pinned registry", comp.validateProvisionedAuthority(goodCandidate()).ok === true);
// no self-provisioning regardless of candidate shape
ok("acquire stays unprovisioned regardless of candidate shape", (await comp.acquireComposedProductionAuthority()).available === false);

console.log("\n══════════════════════════════════════════════════════════");
console.log(`RESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) { console.log("FAILURES:", fails.join(" | ")); process.exit(1); }
console.log("OFFLINE VERIFIED-SCHEMA READ-QUERY + COMPOSITION: PASS (Findings 1 & 2 remediated)");
console.log("DATABASE EXECUTION: disposable in-memory fixture only — NOT live PostgreSQL dialect/catalog validation.");
console.log("PRODUCTION AUTHORITY: composed authority UNPROVISIONED offline; frozen entrypoint untouched; activation REMAINS BLOCKED.");
process.exit(0);
