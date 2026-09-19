// CONSOLIDATED OFFLINE INTEGRATION + REMEDIATION SUITE
// LIVE-AI-03B-P1-02-TRUSTED-EXECUTOR-READ-ADAPTER (+ PRODUCTION-DEPENDENCY-BOUNDARY REMEDIATION)
// Exercises the ACTUAL corrected new integration code against a disposable in-memory fixture and
// synthetic TEST-only Ed25519 keys, under an explicit test boundary. NOT proof of live PostgreSQL
// privileges or a real committed transaction.
import { generateKeyPairSync, sign as edSign } from "node:crypto";

const RT = "/home/user/staybid-frontend/scripts/live-ai-03b/trusted-executor-runtime-01";
const TB = "/home/user/staybid-frontend/scripts/live-ai-03b/trusted-activation-boundary-01";
const contract = await import(`${TB}/pricing-approval-contract.mjs`);
const av = await import(`${TB}/approval-verify.mjs`);
const { runTrustedExecutorProduction, runTrustedExecutorTest } = await import(`${RT}/trusted-executor-runtime.mjs`);
const { makeTrustedReadAdapter } = await import(`${RT}/trusted-read-adapter.mjs`);
const { makeRestrictedActivationAdapter, ACTIVATE_SQL } = await import(`${RT}/restricted-activation-adapter.mjs`);
const { verifyConnectionTargetBinding, CONNECTION_IDENTITY_PROOF_CONTRACT } = await import(`${RT}/db-target-binding.mjs`);
const { canonicalizeConsumedAt, assertCanonicalConsumedAt, TimestampError } = await import(`${RT}/canonical-timestamp.mjs`);
const { acquireProductionAuthority } = await import(`${RT}/production-authority.mjs`);
const { getProductionQueryRegistry } = await import(`${RT}/production-query-registry.mjs`);
const { makeInMemoryPg, REVIEWED_QUERIES } = await import(`${RT}/tests/inmemory-pg-fixture.mjs`);
const { FIXED, buildApprovalPayload, evidenceContentDigest, canonicalize, publicKeyFingerprintFromDerB64 } = contract;

let pass = 0, fail = 0; const fails = [];
function ok(n, c) { if (c) pass++; else { fail++; fails.push(n); console.log("  FAIL:", n); } }

const kp = generateKeyPairSync("ed25519");
const derB64 = kp.publicKey.export({ format: "der", type: "spki" }).toString("base64");
const pinnedFingerprint = publicKeyFingerprintFromDerB64(derB64);
const trustRoot = { pinnedPublicKeyDerB64: derB64, pinnedFingerprint };
const other = generateKeyPairSync("ed25519");

const evContent = {
  account_mode: "direct", catalog_version_id: "openai-gpt-5-6-terra-standard-short-v1", currency: "USD",
  excluded_paths: { batch: false, bedrock: false, fast: false, flex: false, scale_tier: false },
  model: "gpt-5.6-terra", processing_mode: "standard", provider: "openai",
  rates: { input_rate_micros: 2000000, output_rate_micros: 12000000, unit_size: 1000000 },
  regional_uplift: false, source_digest: FIXED.source_digest,
  source_id: "openai-api-pricing/gpt-5.6-terra/standard/short-context/v1", verified_at: "2026-09-20T00:00:00Z",
};
const contentDigest = evidenceContentDigest(evContent);
function inp(over = {}) {
  return {
    approval_id: over.approval_id || "appr-1", reviewer_public_key_fingerprint: pinnedFingerprint,
    evidence: { receipt_id: "rcpt-1", content_digest: over.content_digest || contentDigest, verified_at: evContent.verified_at, evidence_expiry: "2026-09-25T00:00:00Z" },
    scope: { openai_account_ref: "acct", openai_project_ref: "proj" },
    execution: { execution_id: over.execution_id || "exec-1", issued_at: "2026-09-20T00:00:00Z", not_before: "2026-09-20T00:00:00Z", expiry: "2026-09-25T00:00:00Z" },
  };
}
function env(over = {}, key = kp.privateKey) { const p = buildApprovalPayload(inp(over)); return { payload: p, signature_b64: edSign(null, Buffer.from(canonicalize(p), "utf8"), key).toString("base64"), alg: "ed25519" }; }
const suppliedEvidence = { id: "rcpt-1", digest: contentDigest, content: evContent };
const CONSUMED = "2026-09-21T00:00:00Z", NOW = "2026-09-21T00:05:00Z";
const CONN_TOKEN = "test-conn-token", ISSUER = "test-issuer";
const testProof = { provenance: CONNECTION_IDENTITY_PROOF_CONTRACT.test_provenance, issuer: ISSUER, boundConnectionToken: CONN_TOKEN, serviceId: FIXED.ai_staging_postgres, projectId: FIXED.ai_staging_project, environmentId: FIXED.ai_staging_environment };
function baseEnv() {
  return {
    LIVE_AI_03B_TRUSTED_EXECUTOR_DB_URL: "test://executor", LIVE_AI_03B_TRUSTED_READER_DB_URL: "test://reader",
    LIVE_AI_03B_REVIEWER_TRUST_ROOT_DER_B64: derB64, LIVE_AI_03B_REVIEWER_TRUST_ROOT_FINGERPRINT: pinnedFingerprint,
    LIVE_AI_03B_AI_STAGING_PROJECT_ID: FIXED.ai_staging_project, LIVE_AI_03B_AI_STAGING_ENVIRONMENT_ID: FIXED.ai_staging_environment,
    LIVE_AI_03B_AI_STAGING_PG_SERVICE_ID: FIXED.ai_staging_postgres, LIVE_AI_03B_AI_STAGING_GATEWAY_SERVICE_ID: FIXED.ai_staging_gateway,
    LIVE_AI_03B_CONNECTION_IDENTITY_PROOF_REF: "test-proof-ref",
  };
}
function testCtx(over = {}) {
  const pg = makeInMemoryPg({ consumedAtIso: CONSUMED });
  return {
    ctx: {
      testBoundary: true, env: baseEnv(), trustRoot, expectedIssuer: ISSUER, connectionToken: CONN_TOKEN,
      connectionIdentityProof: testProof, executorDbClient: pg.executorClient, readerDbClient: pg.readerClient,
      reviewedStateQueries: REVIEWED_QUERIES, approvalEnvelope: env(), suppliedEvidence, executionId: "exec-1",
      nowProvider: () => NOW, sourcePin: { deployed_commit: FIXED.source_commit, deployed_tree: FIXED.source_tree, gateway_deployment_revision: FIXED.source_commit },
      privilegeProof: { restricted_role_proof_present: true }, ...over,
    }, pg,
  };
}

// ═══════ 1. Canonical timestamp ═══════
console.log("1. canonical timestamp");
ok("exact whole-second UTC passes", canonicalizeConsumedAt("2026-09-21T00:00:00Z") === "2026-09-21T00:00:00Z");
ok("Date → whole-second UTC", canonicalizeConsumedAt(new Date("2026-09-21T00:00:00.000Z")) === "2026-09-21T00:00:00Z");
ok("fractional truncates (floor)", canonicalizeConsumedAt("2026-09-21T00:00:00.973Z") === "2026-09-21T00:00:00Z");
ok("non-UTC offset → UTC", canonicalizeConsumedAt("2026-09-21T05:30:00+05:30") === "2026-09-21T00:00:00Z");
ok("malformed fails closed", (() => { try { canonicalizeConsumedAt("nope"); return false; } catch (e) { return e instanceof TimestampError; } })());
ok("missing fails closed", (() => { try { canonicalizeConsumedAt(""); return false; } catch (e) { return e.reason === "consumed_at_missing"; } })());
ok("assertCanonical rejects fractional", (() => { try { assertCanonicalConsumedAt("2026-09-21T00:00:00.5Z"); return false; } catch { return true; } })());

// ═══════ 2. target binding (issuer + client-token bound) ═══════
console.log("2. connection target binding");
const bindArgs = (over = {}) => ({ expectedServiceId: FIXED.ai_staging_postgres, expectedIssuer: ISSUER, connectionToken: CONN_TOKEN, connectionIdentityProof: testProof, testBoundary: true, ...over });
ok("offline: absent proof fails closed", verifyConnectionTargetBinding({ expectedServiceId: FIXED.ai_staging_postgres }).ok === false);
ok("prod path rejects TEST provenance", verifyConnectionTargetBinding(bindArgs({ testBoundary: false })).ok === false);
ok("CORE serviceId rejected", verifyConnectionTargetBinding(bindArgs({ connectionIdentityProof: { ...testProof, serviceId: FIXED.core_excluded_postgres } })).ok === false);
ok("expected=CORE rejected", verifyConnectionTargetBinding(bindArgs({ expectedServiceId: FIXED.core_excluded_postgres })).ok === false);
ok("missing issuer rejected", verifyConnectionTargetBinding(bindArgs({ expectedIssuer: undefined })).ok === false);
ok("wrong issuer rejected", verifyConnectionTargetBinding(bindArgs({ connectionIdentityProof: { ...testProof, issuer: "evil" } })).ok === false);
ok("unbound client token rejected", verifyConnectionTargetBinding(bindArgs({ connectionIdentityProof: { ...testProof, boundConnectionToken: "other" } })).ok === false);
ok("valid test binding ok", verifyConnectionTargetBinding(bindArgs()).ok === true);

// ═══════ 3. activation adapter (single-use / ambiguous / no-arbitrary-SQL / prod refuses fixture) ═══════
console.log("3. activation adapter");
{
  const pg = makeInMemoryPg({ consumedAtIso: CONSUMED });
  const tbnd = verifyConnectionTargetBinding(bindArgs());
  const act = makeRestrictedActivationAdapter({ dbClient: pg.executorClient, targetBinding: tbnd, mode: "test" });
  const claims = contract.toVerifiedClaims(env().payload);
  const r1 = await act.restrictedDbActivate({ claims, executionId: "exec-1" });
  ok("first activation ok + receipt", r1.ok === true && r1.receipt && r1.receipt.contract === "CatalogActivationReceiptV1");
  const r2 = await act.restrictedDbActivate({ claims, executionId: "exec-1" });
  ok("replay rejected, uncertain, no retry", r2.ok === false && r2.uncertain === true);
  ok("single-use: one ledger row", pg.state.ledger.length === 1);
}
{
  const throwing = { __testFixture: true, query: async () => { const e = new Error("reset"); e.code = "08006"; throw e; } };
  const act = makeRestrictedActivationAdapter({ dbClient: throwing, targetBinding: verifyConnectionTargetBinding(bindArgs()), mode: "test" });
  const r = await act.restrictedDbActivate({ claims: contract.toVerifiedClaims(env().payload), executionId: "exec-1" });
  ok("ambiguous commit → uncertain, no auto-retry", r.ok === false && r.uncertain === true);
}
{
  const pg = makeInMemoryPg({ consumedAtIso: CONSUMED });
  let threw = false; try { await pg.executorClient.query("DROP TABLE public.budget_price_catalog_versions", []); } catch { threw = true; }
  ok("arbitrary SQL rejected by fixture", threw === true);
  ok("ACTIVATE_SQL is the only activation statement", ACTIVATE_SQL === "SELECT live_ai_03b_trusted.activate_catalog($1::jsonb, $2) AS receipt");
  ok("production activation adapter refuses a test fixture", (() => { try { makeRestrictedActivationAdapter({ dbClient: pg.executorClient, targetBinding: { ok: true, verifiedServiceId: FIXED.ai_staging_postgres, verifiedProjectId: FIXED.ai_staging_project }, mode: "production" }); return false; } catch { return true; } })());
  ok("production read adapter refuses unregistered queries", (() => { try { makeTrustedReadAdapter({ dbClient: { query: async () => ({ rows: [] }) }, targetBinding: { ok: true, verifiedServiceId: FIXED.ai_staging_postgres, verifiedProjectId: FIXED.ai_staging_project }, reviewedStateQueries: { dormantPolicyControl: "SELECT TRUE" }, mode: "production" }); return false; } catch (e) { return String(e.message).includes("unregistered_queries"); } })());
}

// ═══════ 4. read adapter committed-ledger + timestamp negatives ═══════
console.log("4. trusted read adapter");
async function activatedReader(overState) {
  const pg = makeInMemoryPg({ consumedAtIso: CONSUMED });
  const tbnd = verifyConnectionTargetBinding(bindArgs());
  const act = makeRestrictedActivationAdapter({ dbClient: pg.executorClient, targetBinding: tbnd, mode: "test" });
  const receipt = (await act.restrictedDbActivate({ claims: contract.toVerifiedClaims(env().payload), executionId: "exec-1" })).receipt;
  if (overState) overState(pg.state);
  const reader = makeTrustedReadAdapter({ dbClient: pg.readerClient, targetBinding: tbnd, reviewedStateQueries: REVIEWED_QUERIES, mode: "test" });
  return { pg, reader, receipt, tbnd };
}
{
  const { reader } = await activatedReader();
  const obs = await reader.observeCommittedLedger({ approvalId: "appr-1", executionId: "exec-1" });
  ok("committed obs: adapter-set provenance/dbIdentity/committed", obs.ok === true && obs.observation.committed === true && obs.observation.dbIdentity === FIXED.ai_staging_postgres && obs.observation.records.length === 1);
  ok("observed consumed_at canonical", /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(obs.observation.records[0].consumed_at));
}
{ const { reader, receipt } = await activatedReader(); const obs = await reader.observeCommittedLedger({ approvalId: "appr-1", executionId: "exec-OTHER" }); ok("missing committed row → Phase-B fail", av.verifyConsumedApproval({ envelope: env(), trustRoot, suppliedEvidence, nowIso: NOW, executionId: "exec-1", ledgerObservation: obs.observation, activationReceipt: receipt, testBoundary: true }).ok === false); }
{ const { reader, receipt } = await activatedReader((s) => { s.duplicateInjected = { approval_id: "appr-1", execution_id: "exec-1", content_digest: contentDigest, active_catalog_digest: FIXED.active_catalog_digest, action: "activate", consumed_at: CONSUMED }; }); const obs = await reader.observeCommittedLedger({ approvalId: "appr-1", executionId: "exec-1" }); ok("duplicate rows → Phase-B fail", av.verifyConsumedApproval({ envelope: env(), trustRoot, suppliedEvidence, nowIso: NOW, executionId: "exec-1", ledgerObservation: obs.observation, activationReceipt: receipt, testBoundary: true }).ok === false); }
{ const { receipt } = await activatedReader(); const fab = { provenance: "operator-declared", dbIdentity: FIXED.ai_staging_postgres, committed: true, records: [{ approval_id: "appr-1", execution_id: "exec-1", content_digest: contentDigest, active_catalog_digest: FIXED.active_catalog_digest, action: "activate", consumed_at: CONSUMED }] }; ok("fabricated ledger provenance rejected", av.verifyConsumedApproval({ envelope: env(), trustRoot, suppliedEvidence, nowIso: NOW, executionId: "exec-1", ledgerObservation: fab, activationReceipt: receipt, testBoundary: true }).ok === false); }
{ const { reader } = await activatedReader((s) => { s.ledger[0].consumed_at = "2026-09-21T00:00:00.512Z"; }); const obs = await reader.observeCommittedLedger({ approvalId: "appr-1", executionId: "exec-1" }); ok("non-canonical consumed_at → read fails closed", obs.ok === false && obs.reason === "ledger_consumed_at_not_canonical"); }
{ const { reader } = await activatedReader(); const obs = await reader.observeCommittedLedger({ approvalId: "appr-1", executionId: "exec-1" }); const bad = { contract: "CatalogActivationReceiptV1", action: "activate", approval_id: "appr-1", execution_id: "exec-1", content_digest: contentDigest, active_catalog_digest: FIXED.active_catalog_digest, consumed_at: "2026-09-22T00:00:00Z", commitment: "x" }; ok("mismatched receipt → Phase-B fail", av.verifyConsumedApproval({ envelope: env(), trustRoot, suppliedEvidence, nowIso: NOW, executionId: "exec-1", ledgerObservation: obs.observation, activationReceipt: bad, testBoundary: true }).ok === false); }

// ═══════ 5. PRODUCTION DEPENDENCY BOUNDARY REMEDIATION — the demonstrated bypass + 13 vectors ═══════
console.log("5. production dependency boundary (WORK finding)");
// authority + registry are unprovisioned/incomplete offline
ok("acquireProductionAuthority unprovisioned offline", (await acquireProductionAuthority()).available === false);
ok("production query registry incomplete offline", getProductionQueryRegistry().complete === false);
// THE demonstrated bypass: full synthetic dependency set passed to production must FAIL CLOSED
const pgAttack = makeInMemoryPg({ consumedAtIso: CONSUMED });
const attack = {
  approvalEnvelope: env(), suppliedEvidence, executionId: "exec-1",
  env: baseEnv(), trustRoot, trustRootProvider: () => trustRoot,
  connectionIdentityProof: testProof, expectedIssuer: ISSUER, connectionToken: CONN_TOKEN,
  executorDbClient: { query: pgAttack.executorClient.query }, readerDbClient: { query: pgAttack.readerClient.query },
  reviewedStateQueries: { dormantPolicyControl: "SELECT TRUE", armedPolicyControl: "SELECT TRUE", ceilings: "SELECT TRUE", zeroExposureCounts: "SELECT TRUE" },
  sourcePin: { deployed_commit: FIXED.source_commit, deployed_tree: FIXED.source_tree, gateway_deployment_revision: FIXED.source_commit },
  privilegeProof: { restricted_role_proof_present: true },
};
const attackR = await runTrustedExecutorProduction(attack);
ok("DEMONSTRATED BYPASS now fails closed (not ok, not activated)", attackR.ok === false && attackR.activated !== true);
ok("bypass rejected as caller-supplied authority", attackR.stage === "production_boundary" && String(attackR.reason).startsWith("production_rejects_caller_supplied_authority"));
// each individual bypass vector as a caller-supplied request key → rejected
for (const k of ["executorDbClient", "readerDbClient", "trustRoot", "trustRootProvider", "connectionIdentityProof", "expectedIssuer", "connectionToken", "reviewedStateQueries", "privilegeProof", "sourcePin", "env"]) {
  const r = await runTrustedExecutorProduction({ approvalEnvelope: env(), suppliedEvidence, executionId: "exec-1", [k]: (k === "trustRootProvider") ? (() => trustRoot) : ({}) });
  ok(`vector rejected: ${k}`, r.ok === false && r.stage === "production_boundary");
}
// a CLEAN request (only the 3 allowed keys) still fails closed: authority unprovisioned
const cleanR = await runTrustedExecutorProduction({ approvalEnvelope: env(), suppliedEvidence, executionId: "exec-1" });
ok("clean request → production_authority unprovisioned (fail closed)", cleanR.ok === false && cleanR.stage === "production_authority");
ok("no production→test fallback: clean request never activates", cleanR.activated !== true);
ok("test entrypoint requires testBoundary", (await runTrustedExecutorTest({})).ok === false);

// ═══════ 6. harness test-mode pre-activation negatives ═══════
console.log("6. harness pre-activation negatives");
async function neg(name, over) { const { ctx } = testCtx(over); const r = await runTrustedExecutorTest(ctx); ok(name + " → HOLD", r.ok === false); }
await neg("incomplete config", { env: {} });
await neg("config not AI-STAGING", { env: { ...baseEnv(), LIVE_AI_03B_AI_STAGING_PG_SERVICE_ID: "deadbeef" } });
await neg("connection proof absent", { connectionIdentityProof: undefined });
await neg("CORE connection proof", { connectionIdentityProof: { ...testProof, serviceId: FIXED.core_excluded_postgres } });
await neg("wrong issuer", { connectionIdentityProof: { ...testProof, issuer: "evil" } });
await neg("unbound connection token", { connectionToken: "different" });
await neg("source pin absent", { sourcePin: undefined });
await neg("privilege proof false", { privilegeProof: { restricted_role_proof_present: false } });
await neg("missing approval", { approvalEnvelope: undefined });
await neg("invalid signature", { approvalEnvelope: env({}, other.privateKey) });
await neg("expired approval", { nowProvider: () => "2026-09-25T00:00:00Z" });
await neg("wrong execution id", { executionId: "exec-OTHER" });
await neg("wrong provider evidence", (() => { const c = { ...evContent, provider: "anthropic" }; const cd = evidenceContentDigest(c); return { approvalEnvelope: env({ content_digest: cd }), suppliedEvidence: { id: "rcpt-1", digest: cd, content: c } }; })());

// ═══════ 7. harness positive lifecycle (test entrypoint) + one-shot ═══════
console.log("7. harness positive lifecycle + one-shot");
{
  const { ctx } = testCtx();
  const r = await runTrustedExecutorTest(ctx);
  ok("positive: CATALOG_ACTIVATION_AND_PHASE_B_COMPLETE", r.ok === true && r.stage === "CATALOG_ACTIVATION_AND_PHASE_B_COMPLETE");
  ok("positive: NOT probe-ready", r.probeReady === false);
  ok("positive: dbIdentity AI-STAGING", r.dbIdentity === FIXED.ai_staging_postgres);
  ok("positive: consumedAt canonical", /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(r.consumedAt));
  const { ctx: ctx2 } = testCtx();
  const r2 = await runTrustedExecutorTest(ctx2);
  ok("second run refused by executor one-shot", r2.ok === false);
}

console.log("\n══════════════════════════════════════════════════════════");
console.log(`RESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) { console.log("FAILURES:", fails.join(" | ")); process.exit(1); }
console.log("OFFLINE RUNTIME INTEGRATION + PRODUCTION-BOUNDARY REMEDIATION: PASS");
console.log("DATABASE EXECUTION TESTS: disposable in-memory fixture only — NOT live PostgreSQL privilege verification.");
console.log("PRODUCTION PATH: remains BLOCKED offline (production authority unprovisioned + query registry incomplete).");
console.log("LIVE GATES: independent trust root, credential-isolated executor+reader clients, independent connection-identity + privilege proofs, schema-confirmed query registry, provider credential, gateway arm — all UNPROVEN offline; activation REMAINS BLOCKED.");
process.exit(0);
