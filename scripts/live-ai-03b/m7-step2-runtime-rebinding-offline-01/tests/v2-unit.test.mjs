// M7 Step-2 OFFLINE unit + negative-matrix suite. Synthetic keys / ids / fixtures only. Connects to
// NOTHING external (no Railway / AI-STAGING / CORE-PROD / provider / internet). Node built-ins only.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import net from "node:net";
import { makeReviewer, makeApproval, testSourcePin, STATES, RAILWAY, DB, phaseBGates, consumedFixture, testEnv, testConnectionProof, makeRunner, iso, clone, C, G } from "./helpers.mjs";
import * as ID from "../identity/v2-identity.mjs";
import * as SRC from "../identity/v2-source-identity.mjs";
import * as REG from "../runtime/v2-query-registry.mjs";
import { makeTrustedReadAdapterV2, TEST_READSTATE_PROVENANCE_V2, toInt } from "../runtime/v2-trusted-read-adapter.mjs";
import { makeRestrictedActivationAdapterV2, ACTIVATE_SQL_V2, RESTORE_SQL_V2 } from "../runtime/v2-restricted-activation-adapter.mjs";
import * as PF from "../runtime/v2-preflight.mjs";
import { loadRuntimeConfigV2 } from "../runtime/v2-runtime-config.mjs";
import { acquireProductionAuthorityV2, validateProvisionedAuthorityV2 } from "../runtime/v2-production-authority.mjs";
import { runTrustedExecutorProductionV2, runTrustedExecutorTestV2 } from "../runtime/v2-trusted-executor-runtime.mjs";
import { validatePreflightReceiptV2, runProbeV2 } from "../probe/v2-first-text-probe.mjs";
import { assertOutwardMessageV2, successMsgV2, MESSAGE_KIND_V2 } from "../reader/v2-observation-contract.mjs";
import { validateReaderOnlyAuthorityV2, makeReaderOnlyHostV2 } from "../reader/v2-reader-only-authority.mjs";
import { startProductionReaderServiceV2, PRODUCTION_OPTION_KEYS } from "../reader/v2-production-entrypoint.mjs";
import { startServingRuntimeV2 } from "../reader/v2-serving-runtime.mjs";
import { createGatewayObservationCallerV2 } from "../reader/v2-gateway-observation-caller.mjs";
import { verifyStep2Preservation } from "../tools/verify-step2-preservation.mjs";
import { proveGatewaySource, makeGit } from "../tools/prove-gateway-source.mjs";
// accepted V1 modules — imported ONLY to prove V1 artifacts are REJECTED by the V2 runtime.
import { FIXED as V1_FIXED, buildApprovalPayload as V1_buildPayload } from "../../trusted-activation-boundary-01/pricing-approval-contract.mjs";
import { TEST_READSTATE_PROVENANCE as V1_TEST_READSTATE } from "../../trusted-executor-runtime-01/trusted-read-adapter.mjs";
import { CANDIDATE_REGISTRY_DIGEST as V1_REGISTRY_DIGEST, buildReviewedStateQueries as V1_buildQueries, ZERO_EXPOSURE_COUNTS_QUERY as V1_ZERO } from "../../trusted-runtime-live-binding-offline-01/production-read-queries.mjs";
import { EXPECT as V1_EXPECT } from "../../first-text-probe-activation-01/first-probe-preflight-postflight.mjs";
import { makePrivateReaderHostForTest as V1_hostForTest } from "../../private-reader-host-offline-01/private-reader-host.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const STEP2 = resolve(HERE, "..");
const REPO = resolve(STEP2, "../../..");
const { ok, done } = makeRunner("m7s2-unit");
const rv = makeReviewer();
const NOW = Date.now();
const nowIso = iso(NOW);
const ap = makeApproval(rv, { nowMs: NOW });
const child = (spend, calls) => { const r = spawnSync(process.execPath, [join(HERE, "probe-child.mjs"), String(spend), ...(calls === undefined ? [] : [String(calls)])], { encoding: "utf8" }); try { return JSON.parse(r.stdout); } catch { return { err: r.stderr }; } };

// ═══════════ I — identity boundary ═══════════
ok("I01 V2 identity self-check passes", ID.assertIdentityIntegrity().ok);
ok("I02 target constants of reused neutral modules (V1 FIXED targets) equal FIXED_V2 targets",
  ["ai_staging_project", "ai_staging_environment", "ai_staging_postgres", "ai_staging_gateway", "core_excluded_project", "core_excluded_postgres"].every((k) => V1_FIXED[k] === ID.FIXED_V2[k]));
ok("I03 env-name lists identical to accepted V1 (no deployment drift)", JSON.stringify(ID.REQUIRED_ENV_NAMES_GATEWAY) === JSON.stringify(V1_EXPECT.required_env_names_gateway) && JSON.stringify(ID.REQUIRED_ENV_NAMES_BROKER) === JSON.stringify(V1_EXPECT.required_env_names_broker));
ok("I04 V2 identity is not V1 (catalog, policy, ceiling, digests)", ID.CATALOG_V2.id !== V1_FIXED.catalog_version_id && ID.POLICY_V2.money_ceiling_micros === 105920 && ID.CATALOG_V2.active_digest !== V1_FIXED.active_catalog_digest);
ok("I05 zero-exposure SQL is byte-identical to the accepted V1 query (neutral)", REG.ZERO_EXPOSURE_COUNTS_QUERY === V1_ZERO);
ok("I06 ceilingsExactV2 exact set passes", ID.ceilingsExactV2(STATES.ceilings()).ok);

// ═══════════ S — source identity (three distinct pins) ═══════════
ok("S01 PIN A derivation base = 9270c282/c46da041 and equals the signed bundle base", SRC.checkDerivationBase({ commit: "9270c282d5fd65e9fe49261391badfe92c777b8f", tree: "c46da04123dc44cd9954fe350de0b1bc20ff0948" }).ok);
ok("S02 PIN A rewritten to the gateway commit is rejected", SRC.checkDerivationBase({ commit: SRC.GATEWAY_DEPLOY_SOURCE_V2.commit, tree: SRC.GATEWAY_DEPLOY_SOURCE_V2.tree }).reason === "derivation_base_rewritten");
ok("S03 PIN B 4f390b74/72080256 accepted", SRC.checkGatewaySourcePinV2(testSourcePin().gatewaySource).ok);
for (const [k, v] of [["deployed_commit", SRC.SUPERSEDED_GATEWAY_SOURCE_V1.commit], ["deployed_tree", SRC.SUPERSEDED_GATEWAY_SOURCE_V1.tree], ["gateway_deployment_revision", SRC.SUPERSEDED_GATEWAY_SOURCE_V1.commit], ["voice_gateway_tree", SRC.SUPERSEDED_GATEWAY_SOURCE_V1.voice_gateway_tree]]) {
  const g = { ...testSourcePin().gatewaySource, [k]: v };
  ok(`S04 old 2b69ce source cannot authorize (${k})`, SRC.checkGatewaySourcePinV2(g).reason === "superseded_gateway_source_2b69ce_rejected");
}
for (const k of ["deployed_commit", "deployed_tree", "gateway_deployment_revision", "voice_gateway_tree"]) {
  ok(`S05 gateway pin mismatch (${k})`, !SRC.checkGatewaySourcePinV2({ ...testSourcePin().gatewaySource, [k]: "f".repeat(40) }).ok);
}
ok("S06 PIN C placeholder fails closed (test boundary too)", SRC.verifyStep2RuntimePin(SRC.STEP2_RUNTIME_PIN_PLACEHOLDER, { testBoundary: true }).reason === "step2_runtime_pin_required_after_preservation");
ok("S07 PIN C placeholder carries NO commit/tree (nothing fabricated)", SRC.STEP2_RUNTIME_PIN_PLACEHOLDER.commit === null && SRC.STEP2_RUNTIME_PIN_PLACEHOLDER.tree === null);
ok("S08 PIN C TEST binding accepted only under test boundary", SRC.verifyStep2RuntimePin(testSourcePin().step2Runtime, { testBoundary: true }).ok && SRC.verifyStep2RuntimePin(testSourcePin().step2Runtime).reason === "step2_runtime_pin_provenance_untrusted");
for (const c of [SRC.DERIVATION_BASE.commit, SRC.GATEWAY_DEPLOY_SOURCE_V2.commit, SRC.SUPERSEDED_GATEWAY_SOURCE_V1.commit]) {
  ok(`S09 PIN C cannot reuse a non-Step-2 commit (${c.slice(0, 8)})`, SRC.verifyStep2RuntimePin({ ...testSourcePin().step2Runtime, commit: c }, { testBoundary: true }).reason === "step2_runtime_pin_reuses_non_step2_commit");
}
ok("S10 PIN C manifest for other bytes rejected", SRC.verifyStep2RuntimePin({ ...testSourcePin().step2Runtime, runtime_manifest_digest: "0".repeat(64) }, { testBoundary: true }).reason === "step2_runtime_manifest_mismatch");
ok("S11 PIN C extra key rejected", SRC.verifyStep2RuntimePin({ ...testSourcePin().step2Runtime, approved: true }, { testBoundary: true }).reason === "step2_runtime_pin_shape_not_exact");
ok("S12 PIN C malformed commit rejected", !SRC.verifyStep2RuntimePin({ ...testSourcePin().step2Runtime, commit: "HEAD" }, { testBoundary: true }).ok);
ok("S13 combined source pin: V1-shaped pin (no contract) rejected", SRC.checkSourcePinV2({ commit: V1_FIXED.source_commit || "2b69ce28230fc9d56a035846e95d8de206d5db3b" }, { testBoundary: true }).reason === "source_pin_contract_not_v2");
ok("S14 combined source pin: placeholder step2 ⇒ fail", SRC.checkSourcePinV2(testSourcePin({ step2Runtime: SRC.STEP2_RUNTIME_PIN_PLACEHOLDER }), { testBoundary: true }).reason === "step2_runtime_pin_required_after_preservation");
ok("S15 runtime manifest covers every runtime module file", (() => { const all = []; for (const d of ["identity", "runtime", "probe", "reader"]) for (const f of readdirSync(join(STEP2, d))) if (f.endsWith(".mjs")) all.push(`${d}/${f}`); return all.sort().join() === [...SRC.RUNTIME_MANIFEST_FILES].sort().join(); })());
// real-git gateway proof + preservation verifier fail-closed + injected-git positive path
const gp = proveGatewaySource(makeGit(REPO));
ok("S16 gateway closure proof passes on the real clone (only the service_tier pin differs from 2b69ce)", gp.pass === true, gp.failures);
ok("S17 committed proof JSON equals a fresh recomputation", JSON.stringify(JSON.parse(readFileSync(join(STEP2, "identity/GATEWAY-DEPLOY-SOURCE-PROOF.json"), "utf8"))) === JSON.stringify(gp));
ok("S18 preservation verifier: 4f390b74 is not a Step-2 commit", verifyStep2Preservation(makeGit(REPO), SRC.GATEWAY_DEPLOY_SOURCE_V2.commit).reason === "commit_is_a_non_step2_pin");
ok("S19 preservation verifier: unknown commit ⇒ absent", verifyStep2Preservation(makeGit(REPO), "0123456789abcdef0123456789abcdef01234567").reason === "commit_absent");
{
  const measured = SRC.measureRuntimeManifest();
  const bytes = Object.fromEntries(SRC.RUNTIME_MANIFEST_FILES.map((p) => [p, readFileSync(join(STEP2, p))]));
  const X = "5e2c0de5e2c0de5e2c0de5e2c0de5e2c0de5e2c0";
  const fakeGit = (o = {}) => ({
    revParse: (x) => (x === `${X}^{commit}` ? X : x === `${X}^{tree}` ? "1".repeat(40) : x === `${X}:${SRC.STEP2_DIR}` ? "2".repeat(40) : null),
    isAncestor: (a, b) => o.notAncestor ? false : a === SRC.GATEWAY_DEPLOY_SOURCE_V2.commit && b === X,
    diffNameStatus: () => o.changes || SRC.RUNTIME_MANIFEST_FILES.map((p) => ({ status: "A", path: `${SRC.STEP2_DIR}/${p}` })),
    blobBytes: (_r, p) => { const k = p.slice(SRC.STEP2_DIR.length + 1); if (o.tamper === k) return Buffer.from("tampered"); return bytes[k]; },
  });
  const pos = verifyStep2Preservation(fakeGit(), X, { measured });
  ok("S20 preservation verifier (injected read-only git): additive Step-2 commit ⇒ binding", pos.ok && SRC.verifyStep2RuntimePin(pos.binding, { measured }).ok);
  ok("S21 preservation: not descending from 4f390 ⇒ fail", verifyStep2Preservation(fakeGit({ notAncestor: true }), X, { measured }).reason === "gateway_deploy_source_not_ancestor");
  ok("S22 preservation: a frozen predecessor modified ⇒ fail", verifyStep2Preservation(fakeGit({ changes: [{ status: "M", path: "scripts/live-ai-03b/first-text-probe-activation-01/first-text-probe.mjs" }] }), X, { measured }).reason.startsWith("non_step2_path_changed"));
  ok("S23 preservation: Step-2 file modified-not-added ⇒ fail", verifyStep2Preservation(fakeGit({ changes: [{ status: "M", path: `${SRC.STEP2_DIR}/runtime/v2-preflight.mjs` }] }), X, { measured }).reason.startsWith("step2_path_not_additive"));
  ok("S24 preservation: different runtime bytes at commit ⇒ fail", verifyStep2Preservation(fakeGit({ tamper: "probe/v2-first-text-probe.mjs" }), X, { measured }).reason === "runtime_manifest_at_commit_differs_from_reviewed_bytes");
}

// ═══════════ R — immutable V2 query registry ═══════════
ok("R01 registry self-check", REG.REGISTRY_SELF_CHECK.ok && REG.REGISTRY_SELF_CHECK.digest === REG.V2_REGISTRY_DIGEST);
ok("R02 V2 registry digest ≠ V1 registry digest", REG.V2_REGISTRY_DIGEST !== V1_REGISTRY_DIGEST);
ok("R03 supplied registry passes by content", REG.assertSuppliedRegistryV2(REG.buildV2RegistrySupply()).ok);
{
  const s = REG.buildV2RegistrySupply();
  const cases = [
    ["R04 copied correct marker + substituted SQL", { ...s, ceilings: s.ceilings.replace("105920", "105921") }, "supplied_registry_content_digest_mismatch"],
    ["R05 marker not content-bound", { ...s, __registryDigest: "0".repeat(64) }, "supplied_registry_marker_not_content_bound"],
    ["R06 extra key", { ...s, extra: "SELECT 1 FROM public.budget_sessions" }, "supplied_registry_key_set_mismatch"],
    ["R07 missing key", (() => { const x = { ...s }; delete x.armedState; return x; })(), "supplied_registry_key_set_mismatch"],
    ["R08 non-public-qualified relation", { ...s, zeroExposureCounts: s.zeroExposureCounts.replace("public.budget_envelopes", "budget_envelopes") }, "supplied_relation_not_public_qualified_or_not_allowed:zeroExposureCounts"],
    ["R09 DML smuggled", { ...s, ceilings: "SELECT 1 FROM public.budget_sessions WHERE (UPDATE x)" }, "supplied_dml_ddl_or_side_effect_in_query:ceilings"],
    ["R10 multi-statement", { ...s, ceilings: s.ceilings + "; SELECT 1" }, "supplied_multi_statement_or_comment:ceilings"],
    ["R11 comment", { ...s, ceilings: s.ceilings + " -- x" }, "supplied_multi_statement_or_comment:ceilings"],
    ["R12 forbidden allocation table", { ...s, zeroExposureCounts: "SELECT count(*) FROM public.budget_envelope_allocations" }, "supplied_forbidden_object:zeroExposureCounts"],
    ["R13 V1 query map (4 keys) rejected", { ...V1_buildQueries() }, "supplied_registry_key_set_mismatch"],
    ["R14 ledger schema outside the ledger query", { ...s, ceilings: "SELECT 1 FROM live_ai_03b_trusted.approval_consumption" }, "supplied_relation_not_public_qualified_or_not_allowed:ceilings"],
    ["R15 parameter in reader query", { ...s, ceilings: s.ceilings.replace("= 1", "= $1") }, "supplied_unexpected_parameter:ceilings"],
  ];
  for (const [n, x, want] of cases) { const r = REG.assertSuppliedRegistryV2(x); ok(n, !r.ok && r.reason === want, r); }
}
ok("R16 every query is public./trusted-ledger qualified + SELECT-only", REG.REGISTRY_KEYS.every((k) => REG.badQueryShapeV2(REG.V2_QUERY_REGISTRY[k], k) === null));
ok("R17 ceilings bound to row identity AND all seven values", ["id='live-ai-03b-policy-oneprobe-v2'", "status='active'", `policy_digest='${ID.POLICY_V2.active_digest}'`, ...Object.entries(ID.POLICY_V2.ceilings).map(([k, v]) => `${k}=${v}`), "WHERE status='active') = 1"].every((t) => REG.CEILINGS_QUERY.includes(t)));
{
  const { OBS_SCHEMA_V2 } = await import("../reader/v2-observation-contract.mjs");
  const cols = (keys) => new Set(keys.flatMap((k) => [...REG.V2_QUERY_REGISTRY[k].matchAll(/\bAS ([a-z0-9_]+)/g)].map((m) => m[1]).concat(k === "ceilings" ? REG.V2_QUERY_REGISTRY[k].split(" FROM ")[0].replace(/^SELECT /, "").split(",").map((x) => x.trim()) : [])));
  const src = { "pre-activation": ["preActivationCatalog", "policyControl", "zeroExposureCounts"], activated: ["activatedCatalog", "policyControl"], armed: ["armedState"], ceilings: ["ceilings"], restored: ["restoredState"] };
  const missing = Object.entries(src).flatMap(([ph, keys]) => { const have = cols(keys); return Object.values(OBS_SCHEMA_V2[ph]).flat().filter((f) => !have.has(f)).map((f) => `${ph}.${f}`); });
  ok("R19 every observed field of every phase is produced by its registry query (column coverage)", missing.length === 0, missing);
}
ok("R18 no V1 catalog/policy identity is a V2 target in the registry", !/oneprobe-v1'\s+AND\s+project_id/.test(REG.ARMED_STATE_QUERY) && !REG.CEILINGS_QUERY.includes("89536"));

// ═══════════ AD — adapters (in-memory clients) ═══════════
const tbOk = { ok: true, verifiedServiceId: ID.TARGETS_V2.postgres, verifiedProjectId: ID.TARGETS_V2.project };
const fixtureClient = (rows) => ({ __testFixture: true, async query(sql) { const k = REG.REGISTRY_KEYS.find((x) => REG.V2_QUERY_REGISTRY[x] === sql); return { rows: rows[k] === undefined ? [] : [rows[k]] }; } });
ok("AD01 read adapter refuses a test fixture in production", (() => { try { makeTrustedReadAdapterV2({ dbClient: fixtureClient({}), targetBinding: tbOk, registry: REG.buildV2RegistrySupply(), mode: "production" }); return false; } catch (e) { return e.message === "read_adapter_v2_refuses_test_fixture_in_production"; } })());
ok("AD02 read adapter refuses an unverified / V1 registry", (() => { try { makeTrustedReadAdapterV2({ dbClient: fixtureClient({}), targetBinding: tbOk, registry: V1_buildQueries(), mode: "test" }); return false; } catch (e) { return e.message === "read_adapter_v2_registry_not_content_verified"; } })());
ok("AD03 strict conversion: NULL / '' / float never become 0", Number.isNaN(toInt(null)) && Number.isNaN(toInt("")) && Number.isNaN(toInt(1.5)) && toInt("105920") === 105920);
{
  const pre = { ...STATES.pre(), ...STATES.counts() };
  const ad = makeTrustedReadAdapterV2({ dbClient: fixtureClient({ preActivationCatalog: pre, policyControl: pre, zeroExposureCounts: pre }), targetBinding: tbOk, registry: REG.buildV2RegistrySupply(), mode: "test" });
  const o = await ad.observePreActivation();
  ok("AD04 pre-activation observation passes Phase-A state check", o.ok && PF.checks.preActivationStateV2(o.preActivationState).ok && PF.checks.zeroPriorProbeExposure(o.counts).ok, o);
  const nullCtl = { ...pre, global_control_epoch: null };
  const ad2 = makeTrustedReadAdapterV2({ dbClient: fixtureClient({ preActivationCatalog: nullCtl, policyControl: nullCtl, zeroExposureCounts: pre }), targetBinding: tbOk, registry: REG.buildV2RegistrySupply(), mode: "test" });
  const o2 = await ad2.observePreActivation();
  ok("AD05 a missing control row (NULL epoch) fails closed, never reads as epoch 0/1", o2.ok && PF.checks.preActivationStateV2(o2.preActivationState).reason === "control_epoch_not_1");
  const ad3 = makeTrustedReadAdapterV2({ dbClient: fixtureClient({ ceilings: undefined }), targetBinding: tbOk, registry: REG.buildV2RegistrySupply(), mode: "test" });
  ok("AD06 zero-row ceilings (tampered value) ⇒ unavailable", (await ad3.observeCeilings()).reason === "ceilings_unavailable");
  ok("AD07 read adapter provenance is V2-specific (not the V1 string)", ad.readStateProvenance === TEST_READSTATE_PROVENANCE_V2 && TEST_READSTATE_PROVENANCE_V2 !== V1_TEST_READSTATE);
}
{
  const calls = [];
  const exec = { async query(sql, p) { calls.push(sql); if (sql === ACTIVATE_SQL_V2) { const cl = JSON.parse(p[0]); return { rows: [{ receipt: { contract: "CatalogActivationReceiptV2", catalog_version_id: ID.CATALOG_V2.id, action: "activate", approval_id: cl.approval_id, execution_id: p[1], content_digest: cl.content_digest, active_catalog_digest: ID.CATALOG_V2.active_digest, consumed_at: nowIso } }] }; } throw Object.assign(new Error("boom postgres://secret@host"), { code: "P0001" }); } };
  const aa = makeRestrictedActivationAdapterV2({ dbClient: exec, targetBinding: tbOk, mode: "test" });
  const v = (await import("../../m7-step1-hb1-consolidated-remediation-01/approval/approval-verify-v2.mjs")).verifyApprovalV2({ envelope: ap.envelope, trustRoot: rv.trustRoot, suppliedEvidence: ap.suppliedEvidence, nowIso, executionId: ap.executionId, isConsumed: () => false });
  ok("AD08 V2 approval verifies with the synthetic reviewer", v.ok, v);
  ok("AD09 activation adapter forwards verified V2 claims to activate_catalog_v2 only", (await aa.restrictedDbActivate({ claims: v.claims, executionId: ap.executionId })).ok && calls[0] === ACTIVATE_SQL_V2);
  const v1claims = { ...v.claims, contract: "VerifiedApprovalClaimsV1" };
  ok("AD10 V1 claims contract refused before any SQL", (await aa.restrictedDbActivate({ claims: v1claims, executionId: ap.executionId })).reason === "activation_claims_not_verified_v2" && calls.length === 1);
  const extra = { ...v.claims, approved: true };
  ok("AD11 claims key set ≠ 36 refused", (await aa.restrictedDbActivate({ claims: extra, executionId: ap.executionId })).reason === "activation_claims_key_set_not_exact");
  const missing = { ...v.claims }; delete missing.cache_write_rate_micros;
  ok("AD12 claims missing cache_write_rate refused", (await aa.restrictedDbActivate({ claims: missing, executionId: ap.executionId })).reason === "activation_claims_key_set_not_exact");
  ok("AD13 V1 catalog id in claims refused", (await aa.restrictedDbActivate({ claims: { ...v.claims, catalog_version_id: V1_FIXED.catalog_version_id }, executionId: ap.executionId })).reason === "activation_claims_not_v2_catalog");
  ok("AD14 execution id unbound refused", (await aa.restrictedDbActivate({ claims: v.claims, executionId: "m7s2-other-exec-01" })).reason === "activation_execution_unbound");
  const r = await aa.restrictedDbRestore({ claims: v.claims, executionId: ap.executionId });
  ok("AD15 DB error ⇒ uncertain, SQLSTATE only, no message/secret leaked", r.ok === false && r.uncertain === true && r.reason === "restoration_db_error:P0001" && !JSON.stringify(r).includes("secret"), r);
  ok("AD16 restore uses restore_catalog_v2_inactive only", calls.at(-1) === RESTORE_SQL_V2);
  ok("AD17 activation adapter refuses test fixture in production", (() => { try { makeRestrictedActivationAdapterV2({ dbClient: { __testFixture: true, query() {} }, targetBinding: tbOk, mode: "production" }); return false; } catch { return true; } })());
}

// ═══════════ PA — PHASE A pre-activation matrix ═══════════
const phaseA = (o = {}) => PF.runPreActivationV2({ railway: RAILWAY(), sourcePin: testSourcePin(), db: DB(), nowIso, testBoundary: true,
  approvalEnvelope: ap.envelope, trustRoot: rv.trustRoot, suppliedEvidence: ap.suppliedEvidence, executionId: ap.executionId, isApprovalConsumed: () => false,
  preActivationState: STATES.pre(), counts: STATES.counts(), approvalConsumed: false, privilegeProof: { restricted_role_proof_present: true }, ...o });
const reasons = (r) => r.failures.map((f) => f.reason);
ok("PA00 exact pre-activation state + unused approval ⇒ PASS", phaseA().pass, phaseA().failures);
const preMut = [
  ["PA01 3 catalog versions", { catalog_version_count: 3 }, "catalog_version_count_not_2"],
  ["PA02 6 entries", { catalog_entry_count: 6 }, "catalog_entry_count_not_5"],
  ["PA03 something already active", { active_catalog_count: 1 }, "catalog_already_active"],
  ["PA04 V1 not historical (digest)", { v1_inactive_digest: null }, "v1_not_historical_inactive"],
  ["PA05 V1 active entries", { v1_inactive_entry_count: 1 }, "v1_entries_not_historical_inactive"],
  ["PA06 V1 expiry extended", { v1_expiry_is_historical: false }, "v1_expiry_extended_or_altered"],
  ["PA07 V2 inactive digest tampered", { v2_inactive_digest: "0".repeat(64) }, "v2_inactive_digest_mismatch"],
  ["PA08 V2 only 2 inactive entries", { v2_inactive_entry_count: 2 }, "v2_inactive_entries_not_3"],
  ["PA09 missing cache-write row", { v2_cache_write_rate_micros: NaN }, "v2_cache_write_rate_missing_or_mismatch"],
  ["PA10 cache-write rate below 2.5", { v2_cache_write_rate_micros: 2000000 }, "v2_cache_write_rate_missing_or_mismatch"],
  ["PA11 input rate wrong", { v2_input_rate_micros: 1999999 }, "v2_input_rate_mismatch"],
  ["PA12 output rate wrong", { v2_output_rate_micros: 12000001 }, "v2_output_rate_mismatch"],
  ["PA13 extra V2 entry", { v2_entry_count: 4 }, "v2_entry_count_not_3"],
  ["PA14 a policy already active", { active_policy_count: 1 }, "policy_already_active"],
  ["PA15 obsolete 89,536 policy present", { obsolete_v1_policy_present: true, policy_version_count: 1 }, "obsolete_89536_policy_present"],
  ["PA16 wildcard policy", { wildcard_policy_present: true }, "wildcard_policy_present"],
  ["PA17 dormant policy absent/altered", { dormant_policy_present: false }, "dormant_policy_absent_or_altered"],
  ["PA18 successor policy pre-present", { v2_policy_present: true }, "successor_policy_already_present"],
  ["PA19 control enabled", { global_control_enabled: true }, "control_already_enabled"],
  ["PA20 control epoch 2", { project_control_epoch: 2 }, "control_epoch_not_1"],
  ["PA21 control killed", { global_control_killed: true }, "control_killed"],
  ["PA22 dormant control digest tampered", { control_project_digest: "x" }, "project_control_digest_mismatch"],
  ["PA23 extra control row", { control_row_count: 3 }, "control_row_count_not_2"],
];
for (const [n, m, want] of preMut) { const r = phaseA({ preActivationState: { ...STATES.pre(), ...m } }); ok(n, !r.pass && reasons(r).includes(want), reasons(r)); }
ok("PA24 nonzero prior exposure", reasons(phaseA({ counts: { ...STATES.counts(), sessions: 1 } })).includes("nonzero_or_unknown_prior_exposure:sessions"));
ok("PA25 NULL exposure count never reads as zero", reasons(phaseA({ counts: { ...STATES.counts(), envelopes: NaN } })).includes("nonzero_or_unknown_prior_exposure:envelopes"));
ok("PA26 approval already consumed (ledger)", reasons(phaseA({ isApprovalConsumed: () => true, approvalConsumed: true })).includes("approval_already_consumed_replay"));
ok("PA27 privilege proof absent", reasons(phaseA({ privilegeProof: {} })).includes("restricted_privilege_proof_absent"));
ok("PA28 CORE-PROD db binding", reasons(phaseA({ db: { ...DB(), resolved_postgres_service_id: ID.TARGETS_V2.core_excluded_postgres } })).includes("db_resolves_to_CORE_postgres"));
ok("PA29 wrong gateway service", reasons(phaseA({ railway: { ...RAILWAY(), gateway_service_id: "x" } })).includes("gateway_service_id_mismatch"));
ok("PA30 old 2b69ce gateway source", reasons(phaseA({ sourcePin: testSourcePin({ gatewaySource: { ...testSourcePin().gatewaySource, deployed_commit: SRC.SUPERSEDED_GATEWAY_SOURCE_V1.commit } }) })).includes("superseded_gateway_source_2b69ce_rejected"));
ok("PA31 unresolved Step-2 pin", reasons(phaseA({ sourcePin: testSourcePin({ step2Runtime: SRC.STEP2_RUNTIME_PIN_PLACEHOLDER }) })).includes("step2_runtime_pin_required_after_preservation"));
{
  // V1 approval envelope (V1 contract payload, signed by the same synthetic reviewer) is not a V2 approval.
  let v1env;
  try { const p = V1_buildPayload({ approval_id: "m7s2-v1-approval-01", reviewer_public_key_fingerprint: rv.fp, evidence: { receipt_id: "r-0000001", content_digest: "0".repeat(64), verified_at: G.T0, evidence_expiry: nowIso }, scope: { openai_account_ref: "a", openai_project_ref: "b" }, execution: { execution_id: ap.executionId, issued_at: nowIso, not_before: nowIso, expiry: nowIso } }); v1env = { alg: "ed25519", payload: p, signature_b64: rv.sign(p) }; } catch { v1env = null; }
  const r = v1env ? phaseA({ approvalEnvelope: v1env }) : null;
  ok("PA32 V1-contract approval envelope rejected by the V2 verifier", r && !r.pass && reasons(r).some((x) => /domain_mismatch|payload_shape_not_exact|payload_section_shape_not_exact/.test(x)), r && reasons(r));
}
ok("PA33 self-approval (approved:true injected) rejected", reasons(phaseA({ approvalEnvelope: makeApproval(rv, { nowMs: NOW, mutate: (p) => ({ ...p, approved: true }) }).envelope })).includes("payload_shape_not_exact"));
ok("PA34 envelope signed by another key rejected", reasons(phaseA({ approvalEnvelope: makeApproval(makeReviewer(), { nowMs: NOW }).envelope })).includes("envelope_fingerprint_not_pinned_trust_root"));
// §19 — approval-scope / target negatives (each re-signed by the pinned synthetic reviewer, so the
// rejection comes from the V2 CONTRACT, not from a broken signature).
{
  const mut = (f) => phaseA({ approvalEnvelope: makeApproval(rv, { nowMs: NOW, mutate: (p) => { f(p); return p; } }).envelope });
  const cases = [
    ["N01 V1 catalog id in approval scope", (p) => { p.scope.catalog_version_id = V1_FIXED.catalog_version_id; }, "catalog_version_mismatch"],
    ["N02 V1 active digest as target", (p) => { p.target.active_catalog_digest = V1_FIXED.active_catalog_digest; }, "active_catalog_digest_mismatch"],
    ["N03 V1 inactive digest as target", (p) => { p.target.inactive_catalog_digest = V1_FIXED.inactive_catalog_digest; }, "inactive_catalog_digest_mismatch"],
    ["N04 V1 expiry as target", (p) => { p.target.catalog_verification_expiry = G.V1.expiry; }, "catalog_verification_expiry_mismatch"],
    ["N05 V1 one-call policy id", (p) => { p.target.one_call_policy_id = G.ONECALL_V1.id; }, "one_call_policy_id_mismatch"],
    ["N06 V1 one-call policy digest", (p) => { p.target.one_call_policy_digest = G.ONECALL_V1.active_digest; }, "one_call_policy_digest_mismatch"],
    ["N07 89536 money ceiling in approval", (p) => { p.target.one_call_money_ceiling_micros = 89536; }, "one_call_money_ceiling_mismatch"],
    ["N08 wrong source digest", (p) => { p.scope.source_digest = G.V1.source_digest; }, "source_digest_mismatch"],
    ["N09 wrong cache-write rate", (p) => { p.scope.cache_write_rate_micros = 2000000; }, "cache_write_rate_mismatch"],
    ["N10 missing cache-write rate", (p) => { delete p.scope.cache_write_rate_micros; }, "payload_section_shape_not_exact"],
    ["N11 wrong service tier (priority)", (p) => { p.scope.service_tier = "priority"; }, "service_tier_not_default"],
    ["N12 missing service tier", (p) => { delete p.scope.service_tier; }, "payload_section_shape_not_exact"],
    ["N13 long context", (p) => { p.scope.context_tier = "long"; }, "context_tier_not_short"],
    ["N14 regional uplift", (p) => { p.scope.regional_uplift = true; }, "regional_uplift_present"],
    ["N15 processing mode batch", (p) => { p.scope.processing_mode = "batch"; }, "processing_mode_not_standard"],
    ["N16 wrong AI-STAGING target", (p) => { p.target.ai_staging_postgres = "00000000-0000-0000-0000-000000000000"; }, "ai_staging_postgres_mismatch"],
    ["N17 CORE-PROD as target", (p) => { p.target.ai_staging_project = V1_FIXED.core_excluded_project; }, "ai_staging_project_mismatch"],
    ["N18 bundle for another base", (p) => { p.target.base_commit = SRC.GATEWAY_DEPLOY_SOURCE_V2.commit; }, "base_commit_mismatch"],
    ["N19 future-dated evidence (verified_at > now)", (p) => { p.evidence.verified_at = iso(NOW + 600e3); }, "supplied_verified_at_not_approved"],
  ];
  for (const k of ["batch", "bedrock", "fast", "flex", "long_context", "priority", "regional", "scale_tier"]) cases.push([`N20 excluded path ${k}=true`, (p) => { p.scope.excluded_paths[k] = true; }, `excluded_path_${k}_not_false`]);
  for (const [n, f, want] of cases) { const r = mut(f); ok(n, !r.pass && reasons(r).includes(want), reasons(r)); }
  const unsigned = { ...ap.envelope, signature_b64: "" };
  ok("N21 unsigned approval", reasons(phaseA({ approvalEnvelope: unsigned })).includes("signature_absent"));
  const forged = { ...ap.envelope, payload: { ...ap.envelope.payload, approval_id: "m7s2-forged-000001" } };
  ok("N22 payload altered after signing", reasons(phaseA({ approvalEnvelope: forged })).includes("signature_invalid_or_untrusted_signer"));
  const other = makeReviewer(); const own = makeApproval(other, { nowMs: NOW });
  ok("N23 caller-supplied trust root + own signed envelope ⇒ refused by the runtime (config-pinned root only)",
    (await runTrustedExecutorTestV2({ testBoundary: true, env: testEnv(rv), trustRoot: other.trustRoot, approvalEnvelope: own.envelope, suppliedEvidence: own.suppliedEvidence, executionId: own.executionId })).reason === "trust_root_not_config_pinned");
  // future evidence where the signed content is self-consistent: content verified_at = signed verified_at > now
  const futEv = makeApproval(rv, { nowMs: NOW });
  const fc = { ...futEv.suppliedEvidence.content, verified_at: iso(NOW + 600e3) };
  const fd = C.evidenceContentDigestV2(fc);
  const fe = makeApproval(rv, { nowMs: NOW, mutate: (p) => { p.evidence.verified_at = fc.verified_at; p.evidence.content_digest = fd; return p; } });
  const rF = phaseA({ approvalEnvelope: fe.envelope, suppliedEvidence: { id: fe.suppliedEvidence.id, digest: fd, content: fc } });
  ok("N24 future-dated evidence (consistent signed content) ⇒ evidence_from_future", reasons(rF).includes("evidence_from_future"), reasons(rF));
  ok("N25 2-entry V1-only catalog state treated as V2 ⇒ refused", !phaseA({ preActivationState: { ...STATES.pre(), catalog_version_count: 1, catalog_entry_count: 2, v2_inactive_digest: null, v2_inactive_entry_count: 0, v2_entry_count: 0 } }).pass);
  ok("N26 V1 active digest observed as the armed catalog", PF.checks.armedStateV2({ ...STATES.armed(), v2_active_digest: V1_FIXED.active_catalog_digest }).reason === "active_catalog_digest_mismatch");
  ok("N27 V1 inactive digest observed as V2 inactive", reasons(phaseA({ preActivationState: { ...STATES.pre(), v2_inactive_digest: V1_FIXED.inactive_catalog_digest } })).includes("v2_inactive_digest_mismatch"));
  const t = child("throw");
  ok("N28 send failure ⇒ NO retry; a later send is refused (one-shot)", t.result.sent === true && t.result.reason === "provider_bearing_send_failed_no_retry" && t.second.reason === "probe_already_sent_no_second_turn" && t.sends === 1, t);
}
// expiry 2026-10-05T15:26:23Z — T0 never regenerated
const EXP = Date.parse(G.T0_PLUS_7_DAYS);
{
  const apE = makeApproval(rv, { nowMs: EXP - 60e3 });
  const at = (ms) => PF.runPreActivationV2({ railway: RAILWAY(), sourcePin: testSourcePin(), db: DB(), nowIso: iso(ms), testBoundary: true, approvalEnvelope: apE.envelope, trustRoot: rv.trustRoot,
    suppliedEvidence: apE.suppliedEvidence, executionId: apE.executionId, isApprovalConsumed: () => false, preActivationState: STATES.pre(), counts: STATES.counts(), approvalConsumed: false, privilegeProof: { restricted_role_proof_present: true } });
  ok("PA35 one second before V2 expiry ⇒ PASS", at(EXP - 1000).pass, reasons(at(EXP - 1000)));
  ok("PA36 AT V2 expiry ⇒ HOLD (fail closed)", reasons(at(EXP)).includes("catalog_v2_verification_expired_hold_for_fresh_successor"));
  ok("PA37 AFTER V2 expiry ⇒ HOLD", reasons(at(EXP + 86400e3)).includes("catalog_v2_verification_expired_hold_for_fresh_successor"));
  ok("PA38 T0 is frozen (not regenerated)", G.T0 === "2026-09-28T15:26:23Z" && G.T0_PLUS_7_DAYS === "2026-10-05T15:26:23Z");
  ok("PA39 before T0 ⇒ fail", reasons(phaseA({ nowIso: "2026-09-28T15:26:22Z" })).includes("catalog_verified_at_in_future"));
}

// ═══════════ AC — activated state ═══════════
ok("AC00 exact activated state PASS", PF.checkActivatedStateV2(STATES.activated()).ok);
for (const [n, m, want] of [
  ["AC01 V1 AND V2 active", { active_catalog_count: 2, v2_active_digest: null }, "v2_not_sole_active_catalog"],
  ["AC02 V2 active digest wrong", { v2_active_digest: "0".repeat(64) }, "v2_active_digest_mismatch_or_not_sole"],
  ["AC03 policy already active", { active_policy_count: 1 }, "policy_active_before_arm"],
  ["AC04 controls enabled early", { global_control_enabled: true, project_control_enabled: true }, "control_already_enabled"],
  ["AC05 V1 revived", { v1_inactive_digest: null }, "v1_not_historical_inactive"],
]) { const r = PF.checkActivatedStateV2({ ...STATES.activated(), ...m }); ok(n, r.reason === want, r); }

// ═══════════ PB — PHASE B pre-probe preflight matrix ═══════════
const cf = consumedFixture(ap, iso(NOW - 60e3));
const phaseB = (o = {}) => PF.runPreflightV2({ railway: RAILWAY(), sourcePin: testSourcePin(), db: DB(), nowIso, testBoundary: true,
  approvalEnvelope: ap.envelope, trustRoot: rv.trustRoot, suppliedEvidence: ap.suppliedEvidence, executionId: ap.executionId, ...cf,
  armedState: STATES.armed(), oneCallPolicy: STATES.ceilings(), counts: STATES.counts(), ...phaseBGates(), ...o });
const good = phaseB();
ok("PB00 armed V2 + correlated consumed approval ⇒ PASS + receipt", good.pass && good.receipt && good.receipt.contract === "FirstProbePreflightReceiptV2", good.failures);
for (const k of ID.CEILING_KEYS) for (const d of [-1, 1]) {
  const r = phaseB({ oneCallPolicy: { ...STATES.ceilings(), [k]: ID.POLICY_V2.ceilings[k] + d } });
  ok(`PB01 ceiling ${k} ${d > 0 ? "+1" : "-1"} rejected`, !r.pass && !r.receipt && reasons(r).includes(`ceiling_${k}_invalid_or_mismatch`));
}
ok("PB02 old 89,536 ceilings rejected", reasons(phaseB({ oneCallPolicy: Object.fromEntries(ID.CEILING_KEYS.map((k) => [k, k.endsWith("_micros") ? 89536 : 1])) })).some((x) => x.startsWith("ceiling_")));
ok("PB03 ceiling as string rejected (no coercion)", reasons(phaseB({ oneCallPolicy: { ...STATES.ceilings(), session_money_ceiling_micros: "105920" } })).includes("ceiling_session_money_ceiling_micros_invalid_or_mismatch"));
ok("PB04 missing ceiling field", reasons(phaseB({ oneCallPolicy: (() => { const c = STATES.ceilings(); delete c.global_day_money_ceiling_micros; return c; })() })).includes("ceiling_key_set_not_exact"));
for (const [n, m, want] of [
  ["PB05 extra/foreign active policy (digest collapses to NULL)", { one_call_policy_digest: null, active_policy_count: 2 }, "one_call_policy_v2_not_sole_active_or_digest_mismatch"],
  ["PB06 old V1 one-call policy digest", { one_call_policy_digest: G.ONECALL_V1.active_digest }, "one_call_policy_v2_not_sole_active_or_digest_mismatch"],
  ["PB07 controls still dormant (epoch 1)", { global_control_epoch: 1, project_control_epoch: 1 }, "control_epoch_not_2"],
  ["PB08 controls disabled", { global_control_enabled: false }, "control_not_enabled"],
  ["PB09 control killed", { project_control_killed: true }, "control_killed"],
  ["PB10 V1 catalog active alongside", { active_catalog_count: 2 }, "v2_not_sole_active_catalog"],
  ["PB11 V1 expiry extended", { v1_expiry_is_historical: false }, "v1_expiry_extended_or_altered"],
  ["PB12 control activation digest tampered", { control_global_digest: CONTROL_DIG_WRONG() }, "global_control_digest_mismatch"],
  ["PB13 obsolete policy present", { obsolete_v1_policy_present: true }, "obsolete_89536_policy_present"],
]) { const r = phaseB({ armedState: { ...STATES.armed(), ...m } }); ok(n, !r.pass && reasons(r).includes(want), reasons(r)); }
function CONTROL_DIG_WRONG() { return G.DORMANT.control_global_digest; }
ok("PB14 ledger observation absent ⇒ fail (no throw)", reasons(phaseB({ ledgerObservation: undefined })).includes("ledger_observation_absent"));
ok("PB15 ledger record missing", reasons(phaseB({ ledgerObservation: { ...cf.ledgerObservation, records: [] } })).includes("consumed_ledger_record_missing"));
ok("PB16 duplicate ledger record", reasons(phaseB({ ledgerObservation: { ...cf.ledgerObservation, records: [cf.ledgerObservation.records[0], cf.ledgerObservation.records[0]] } })).includes("consumed_ledger_record_duplicate"));
ok("PB17 fabricated receipt commitment", reasons(phaseB({ activationReceipt: { ...cf.activationReceipt, commitment: "0".repeat(64) } })).includes("receipt_commitment_not_ledger_derived"));
ok("PB18 V1 activation receipt contract", reasons(phaseB({ activationReceipt: { ...cf.activationReceipt, contract: "CatalogActivationReceiptV1" } })).includes("activation_receipt_contract_mismatch"));
ok("PB19 trusted-provenance ledger under test boundary refused", reasons(phaseB({ ledgerObservation: { ...cf.ledgerObservation, provenance: "trusted-approved-ledger-readonly-capability" } })).includes("ledger_observation_provenance_untrusted"));
ok("PB20 ledger for another DB", reasons(phaseB({ ledgerObservation: { ...cf.ledgerObservation, dbIdentity: ID.TARGETS_V2.core_excluded_postgres } })).includes("ledger_observation_not_ai_staging"));
ok("PB21 gates on before arm", reasons(phaseB({ gatesBeforeArm: { staging_text_enabled: true, staging_broker_enabled: false } })).includes("staging_text_gate_on_before_arm"));
ok("PB22 signing key mismatch", reasons(phaseB({ brokerPubFp: "c".repeat(64) })).includes("signing_key_fingerprint_mismatch"));
ok("PB23 missing gateway env name", reasons(phaseB({ gatewayEnvNames: new Set(ID.REQUIRED_ENV_NAMES_GATEWAY.filter((n) => n !== "LIVE_AI_03B_FIRST_PROBE_ONE_CALL")) })).some((x) => x.startsWith("env_names_missing")));
ok("PB24 provider credential absent", reasons(phaseB({ providerCredentialPresent: false })).includes("provider_credential_absent"));
ok("PB25 operator subject leaked secret", reasons(phaseB({ operatorSubject: { ...phaseBGates().operatorSubject, hmac_secret_leaked: true } })).includes("subject_derivation_leaked_secret"));
ok("PB26 unresolved Step-2 pin ⇒ NO receipt", (() => { const r = phaseB({ sourcePin: testSourcePin({ step2Runtime: SRC.STEP2_RUNTIME_PIN_PLACEHOLDER }) }); return !r.pass && !r.receipt; })());
ok("PB27 at V2 expiry ⇒ no receipt", !phaseB({ nowIso: G.T0_PLUS_7_DAYS }).receipt);
ok("PB28 wrong reasoning model", reasons(phaseB({ reasoningModel: "gpt-5.6-terra-priority" })).includes("reasoning_model_mismatch"));

// ═══════════ PR — preflight receipt ↔ probe binding ═══════════
const ctx = { nowIso, expectedApprovalId: ap.approvalId, expectedExecutionId: ap.executionId, expectedMode: "test" };
ok("PR00 issued V2 receipt validates", validatePreflightReceiptV2(good.receipt, ctx).ok, validatePreflightReceiptV2(good.receipt, ctx));
ok("PR01 receipt identity binds V2 catalog/policy/105920/epoch2/gateway 4f390/Step-2", good.receipt.identity.one_call_money_ceiling_micros === 105920 && good.receipt.identity.gateway_source.commit === SRC.GATEWAY_DEPLOY_SOURCE_V2.commit && good.receipt.identity.catalog_version_id === ID.CATALOG_V2.id && good.receipt.identity.control_epoch === 2);
ok("PR02 receipt is deep-frozen", Object.isFrozen(good.receipt) && Object.isFrozen(good.receipt.identity) && Object.isFrozen(good.receipt.identity.ceilings));
ok("PR03 JSON copy (identical bytes, correct commitment) NOT issued ⇒ refused", validatePreflightReceiptV2(clone(good.receipt), ctx).reason === "receipt_not_issued_by_v2_preflight");
ok("PR04 V1 receipt shape (pin 2b69ce) refused", validatePreflightReceiptV2({ pass: true, issuedAtIso: nowIso, pin: { deployable_commit: "2b69ce28230fc9d56a035846e95d8de206d5db3b", deployable_tree: "87aad22d90f84f2c3b307201c3e0d3b8658b1619", gateway_service_id: ID.TARGETS_V2.gateway, postgres_service_id: ID.TARGETS_V2.postgres } }, ctx).reason === "receipt_is_v1_shape_rejected");
ok("PR05 stale receipt (> 15 s)", validatePreflightReceiptV2(good.receipt, { ...ctx, nowIso: iso(NOW + 16000) }).reason === "receipt_stale");
ok("PR06 receipt from the future", validatePreflightReceiptV2(good.receipt, { ...ctx, nowIso: iso(NOW - 2000) }).reason === "receipt_in_future");
ok("PR07 receipt for another approval", validatePreflightReceiptV2(good.receipt, { ...ctx, expectedApprovalId: "m7s2-approval-9999" }).reason === "receipt_for_another_approval");
ok("PR08 receipt for another execution", validatePreflightReceiptV2(good.receipt, { ...ctx, expectedExecutionId: "m7s2-exec-9999" }).reason === "receipt_for_another_execution");
ok("PR09 test receipt refused by a production probe", validatePreflightReceiptV2(good.receipt, { ...ctx, expectedMode: undefined }).reason === "receipt_mode_mismatch");
ok("PR10 receipt absent", validatePreflightReceiptV2(undefined, ctx).reason === "receipt_absent");
{
  // other-target receipt: a receipt issued by a (compromised) preflight for a different gateway id can't exist
  // (identity is fixed inside runPreflightV2), so model a tampered-identity object: not issued ⇒ refused before identity.
  const t = { ...clone(good.receipt), identity: { ...clone(good.receipt.identity), targets: { ...good.receipt.identity.targets, gateway: "other-gateway" } } };
  ok("PR11 other-target receipt refused", !validatePreflightReceiptV2(t, ctx).ok);
}
ok("PR12 probe refuses a V1 receipt and sends nothing", await (async () => { let sent = 0; const r = await runProbeV2({ preflightReceipt: { pass: true, pin: {} }, nowIso, expectedApprovalId: ap.approvalId, expectedExecutionId: ap.executionId, expectedMode: "test", sendViaStagingBroker: async () => { sent++; return {}; } }); return !r.sent && sent === 0; })());
ok("PR13 probe refuses a stale receipt and sends nothing", await (async () => { let sent = 0; const r = await runProbeV2({ preflightReceipt: good.receipt, nowIso: iso(NOW + 20000), expectedApprovalId: ap.approvalId, expectedExecutionId: ap.executionId, expectedMode: "test", sendViaStagingBroker: async () => { sent++; return {}; } }); return r.reason === "receipt_stale" && sent === 0; })());
{
  const a = child(105920);
  ok("PR14 spend 105,920 ⇒ within ceiling, ok, exactly ONE send", a.preflightPass && a.result.ok === true && a.result.withinCeiling === true && a.sends === 1, a);
  ok("PR15 second send refused (no second turn)", a.second && a.second.reason === "probe_already_sent_no_second_turn" && a.sends === 1);
  const b = child(105921);
  ok("PR16 spend 105,921 ⇒ NOT ok (over ceiling)", b.result.ok === false && b.result.withinCeiling === false && b.result.reason === "spend_over_ceiling_or_unknown", b);
  const c = child(89536);
  ok("PR17 spend 89,536 (old V1 ceiling) is within the V2 ceiling", c.result.ok === true && c.result.withinCeiling === true);
  const d = child(1000, 2);
  ok("PR18 two provider calls reported ⇒ NOT ok", d.result.ok === false && d.result.reason === "more_than_one_provider_call_or_unknown");
  ok("PR19 probe sends the SAME frozen probe text/digest", ID.PROBE_TEXT_SHA256 === "8efedb83900154947f749a5ca0c66546a5580593db18aa125e3d6809e311700d");
}

// ═══════════ PF — postflight ═══════════
const post = (o = {}) => PF.runPostflightV2({ counts: { provider_reservations: 1, provider_calls: 1, envelopes: 1 }, settlement: { reservations_open: 0, settlements: 1, reservations: 1 },
  reconciliation: { all_envelopes_terminal: true }, actualSpendMicros: 105920, evidence: { accounting_rows_retained: true },
  gatesAfterClose: { staging_text_enabled: false, staging_broker_enabled: false }, providerCredentialPresent: false, restoredState: STATES.restored(), core: { core_unchanged: true }, ...o });
ok("PF00 restored V2 + closed ingress ⇒ PASS", post().pass, post().failures);
ok("PF01 spend 105,921 ⇒ fail", reasons(post({ actualSpendMicros: 105921 })).includes("spend_over_105920_or_invalid"));
ok("PF02 two provider calls ⇒ fail", reasons(post({ counts: { provider_reservations: 1, provider_calls: 2, envelopes: 1 } })).includes("more_than_one_provider_call_or_unknown"));
ok("PF03 V2 left active ⇒ fail", reasons(post({ restoredState: { ...STATES.restored(), active_catalog_count: 1 } })).includes("active_catalog_remains"));
ok("PF04 V1 revived on restore ⇒ fail", reasons(post({ restoredState: { ...STATES.restored(), v1_inactive_digest: null } })).includes("v1_not_historical_inactive"));
ok("PF05 policy not restored ⇒ fail", reasons(post({ restoredState: { ...STATES.restored(), v2_policy_restored_present: false } })).includes("successor_policy_not_restored"));
ok("PF06 controls not epoch 3 ⇒ fail", reasons(post({ restoredState: { ...STATES.restored(), global_control_epoch: 2 } })).includes("control_epoch_not_3"));
ok("PF07 credential still present ⇒ fail", reasons(post({ providerCredentialPresent: true })).includes("provider_credential_still_present"));

// ═══════════ EX — executor + production authority boundary ═══════════
ok("EX01 production entry rejects caller-supplied authority", (await runTrustedExecutorProductionV2({ approvalEnvelope: ap.envelope, readerDbClient: {} })).reason === "production_rejects_caller_supplied_authority:readerDbClient");
ok("EX02 production entry fails closed: authority UNPROVISIONED", (await runTrustedExecutorProductionV2({ approvalEnvelope: ap.envelope, suppliedEvidence: ap.suppliedEvidence, executionId: ap.executionId })).reason === "v2_production_authority_unprovisioned");
ok("EX03 acquireProductionAuthorityV2 is unprovisioned", (await acquireProductionAuthorityV2()).available === false);
ok("EX04 validateProvisionedAuthorityV2 rejects test fixtures", validateProvisionedAuthorityV2({ cfg: {}, trustRoot: {}, executorDbClient: { __testFixture: true, query() {} }, readerDbClient: { query() {} }, connectionIdentityProof: {}, expectedIssuer: "x", connectionToken: "t", privilegeProof: {}, registry: {}, sourcePin: {}, nowProvider() {} }).reason === "authority_rejects_test_fixture:executorDbClient");
ok("EX04b validateProvisionedAuthorityV2 fails closed (no throw) on a cfg without reviewer/targets", (() => { try { return validateProvisionedAuthorityV2({ cfg: { ok: true, contractVersion: "V2" }, trustRoot: {}, executorDbClient: { query() {} }, readerDbClient: { query() {} }, connectionIdentityProof: {}, expectedIssuer: "x", connectionToken: "t", privilegeProof: {}, registry: {}, sourcePin: {}, nowProvider() {} }).reason === "authority_cfg_not_v2"; } catch { return false; } })());
ok("EX05 test entry requires testBoundary", (await runTrustedExecutorTestV2({})).reason === "test_entrypoint_requires_testBoundary_true");
ok("EX06 runtime config: V1-era env (no contract selector) refused", loadRuntimeConfigV2(testEnv(rv, { LIVE_AI_03B_RUNTIME_CONTRACT_VERSION: undefined })).reason === "runtime_config_incomplete");
ok("EX07 runtime config: contract V1 refused", loadRuntimeConfigV2(testEnv(rv, { LIVE_AI_03B_RUNTIME_CONTRACT_VERSION: "V1" })).reason === "runtime_contract_version_not_v2");
ok("EX08 runtime config: CORE-PROD target refused", loadRuntimeConfigV2(testEnv(rv, { LIVE_AI_03B_AI_STAGING_PG_SERVICE_ID: ID.TARGETS_V2.core_excluded_postgres })).reason === "config_targets_core_prod");
ok("EX09 runtime config: provider key present in executor env refused", loadRuntimeConfigV2(testEnv(rv, { OPENAI_API_KEY: "synthetic" })).reason === "forbidden_secret_present_in_executor_env");
ok("EX10 runtime config: V2 env loads (names only, no secret values returned)", (() => { const c = loadRuntimeConfigV2(testEnv(rv)); return c.ok && !JSON.stringify(c).includes("synthetic-ref-executor"); })());
{
  // in-memory full executor run (the real-PG run is in v2-localpg): V1 read capability refused; then one positive run; then one-shot.
  const state = { mode: "pre", ledger: [] };
  const row = () => ({ ...(state.mode === "pre" ? STATES.pre() : STATES.activated()), ...STATES.counts() });
  const reader = { async query(sql, p) { if (sql === REG.LEDGER_COMMITTED_QUERY_V2) return { rows: state.ledger.filter((x) => x.approval_id === p[0] && x.execution_id === p[1]) }; if (REG.REGISTRY_KEYS.some((k) => REG.V2_QUERY_REGISTRY[k] === sql)) return { rows: [row()] }; throw new Error("unexpected sql"); } };
  let activations = 0;
  const executor = { async query(sql, p) { if (sql !== ACTIVATE_SQL_V2) throw new Error("only activate"); activations++; const cl = JSON.parse(p[0]); const at = iso(Date.now() - 1000);
    if (state.ledger.some((x) => x.approval_id === cl.approval_id)) throw Object.assign(new Error("replay"), { code: "P0001" });
    state.ledger.push({ approval_id: cl.approval_id, execution_id: p[1], content_digest: cl.content_digest, active_catalog_digest: ID.CATALOG_V2.active_digest, action: "activate", consumed_at: at }); state.mode = "activated";
    return { rows: [{ receipt: { contract: "CatalogActivationReceiptV2", catalog_version_id: ID.CATALOG_V2.id, approval_id: cl.approval_id, execution_id: p[1], content_digest: cl.content_digest, active_catalog_digest: ID.CATALOG_V2.active_digest, action: "activate", consumed_at: at } }] }; } };
  const base = { testBoundary: true, env: testEnv(rv), trustRoot: rv.trustRoot, connectionIdentityProof: testConnectionProof(), expectedIssuer: "TEST-ISSUER", connectionToken: "TEST-TOKEN",
    executorDbClient: executor, readerDbClient: reader, registry: REG.buildV2RegistrySupply(), sourcePin: testSourcePin(), privilegeProof: { restricted_role_proof_present: true },
    approvalEnvelope: ap.envelope, suppliedEvidence: ap.suppliedEvidence, executionId: ap.executionId, nowProvider: () => iso(Date.now()) };
  ok("EX11 V1 query map refused by the V2 runtime", (await runTrustedExecutorTestV2({ ...base, registry: V1_buildQueries() })).reason === "read_adapter_v2_registry_not_content_verified" && activations === 0);
  ok("EX12 unresolved Step-2 pin refused before activation", (await runTrustedExecutorTestV2({ ...base, sourcePin: testSourcePin({ step2Runtime: SRC.STEP2_RUNTIME_PIN_PLACEHOLDER }) })).reason === "step2_runtime_pin_required_after_preservation" && activations === 0);
  ok("EX13 shared reader/executor client refused", (await runTrustedExecutorTestV2({ ...base, readerDbClient: executor })).reason === "reader_and_executor_must_be_separate_clients" && activations === 0);
  ok("EX14 wrong trust root refused", (await runTrustedExecutorTestV2({ ...base, trustRoot: makeReviewer().trustRoot })).reason === "trust_root_not_config_pinned" && activations === 0);
  ok("EX15 CORE-PROD connection proof refused", (await runTrustedExecutorTestV2({ ...base, connectionIdentityProof: { ...testConnectionProof(), serviceId: ID.TARGETS_V2.core_excluded_postgres } })).stage === "target_binding" && activations === 0);
  ok("EX16 approval for another execution refused (Phase A)", (await runTrustedExecutorTestV2({ ...base, executionId: "m7s2-exec-other-1" })).reason.includes("approval_for_another_execution") && activations === 0);
  const r = await runTrustedExecutorTestV2(base);
  ok("EX17 in-memory V2 run: activation → committed ledger → correlation → activated state", r.ok && r.stage === "V2_CATALOG_ACTIVATED_COMMITTED_AND_CORRELATED" && r.probeReady === false && activations === 1, r);
  ok("EX18 never PROBE_READY", r.probeReady === false && !JSON.stringify(r).includes("PROBE_READY"));
  const r2 = await runTrustedExecutorTestV2(base);
  ok("EX19 second run: replay/one-shot refused, no second mutation", !r2.ok && activations === 1, r2);
}
{
  const { runActivationV2 } = await import("../runtime/v2-trusted-activation-executor.mjs");
  ok("EX20 executor already one-shot (process-lifetime)", (await runActivationV2({ targetBinding: { resolvedPostgresServiceId: ID.TARGETS_V2.postgres } })).reason === "executor_is_one_shot_already_ran");
  const fresh = await import("../runtime/v2-trusted-activation-executor.mjs?fresh=1");
  const common = { targetBinding: { resolvedPostgresServiceId: ID.TARGETS_V2.postgres, resolvedProjectId: ID.TARGETS_V2.project }, trustRoot: rv.trustRoot, approvalEnvelope: ap.envelope, suppliedEvidence: ap.suppliedEvidence, nowIso, executionId: ap.executionId, isConsumed: () => false, testBoundary: true };
  ok("EX21 V1 read-state capability (provenance) refused by the V2 executor", (await fresh.runActivationV2({ ...common, readState: { provenance: V1_TEST_READSTATE, observe: () => ({}) }, restrictedDbActivate: async () => ({ ok: true }) })).reason === "readonly_capability_provenance_untrusted_or_not_v2");
  ok("EX22 provider key handed to executor refused", (await fresh.runActivationV2({ ...common, providerApiKey: "x" })).stage === "secret_hygiene");
  const fresh2 = await import("../runtime/v2-trusted-activation-executor.mjs?fresh=2");
  const obs = () => ({ railway: RAILWAY(), sourcePin: testSourcePin(), db: DB(), preActivationState: STATES.pre(), counts: STATES.counts(), approvalConsumed: false, privilegeProof: { restricted_role_proof_present: true } });
  let n = 0;
  const amb = await fresh2.runActivationV2({ ...common, readState: { provenance: TEST_READSTATE_PROVENANCE_V2, observe: obs }, restrictedDbActivate: async () => { n++; throw new Error("socket closed"); } });
  const amb2 = await fresh2.runActivationV2({ ...common, readState: { provenance: TEST_READSTATE_PROVENANCE_V2, observe: obs }, restrictedDbActivate: async () => { n++; return { ok: true }; } });
  ok("EX23 ambiguous mutation ⇒ uncertain, NO retry (second call refused before I/O)", amb.reason === "restricted_activation_ambiguous_no_retry" && amb.uncertain === true && amb2.reason === "executor_is_one_shot_already_ran" && n === 1);
}

// ═══════════ RD — V2 private-reader chain ═══════════
const validMsg = successMsgV2("ceilings", { oneCallPolicy: STATES.ceilings() }, "test");
ok("RD01 V2 outward message passes", assertOutwardMessageV2(validMsg).ok);
ok("RD02 V1 message kind refused", !assertOutwardMessageV2({ ...validMsg, kind: "live-ai-03b-observation" }).ok);
ok("RD03 V1 phase name refused", !assertOutwardMessageV2({ ...validMsg, phase: "dormant" }).ok);
ok("RD04 V1 registry digest refused", !assertOutwardMessageV2({ ...validMsg, registryDigest: V1_REGISTRY_DIGEST }).ok);
ok("RD05 URL/DSN embedded in a field refused by content", !assertOutwardMessageV2(successMsgV2("armed", { armedState: { ...STATES.armed(), control_global_digest: "postgres://u:p@h/db" } }, "test")).ok);
ok("RD06 NULL leaf refused", !assertOutwardMessageV2(successMsgV2("activated", { activatedState: { ...STATES.activated(), v2_active_digest: null } }, "test")).ok);
ok("RD07 extra field refused", !assertOutwardMessageV2(successMsgV2("ceilings", { oneCallPolicy: { ...STATES.ceilings(), secret: 1 } }, "test")).ok);
ok("RD08 every V2 phase schema accepts the fixture state", ["pre-activation", "activated", "armed", "ceilings", "restored"].every((ph) => assertOutwardMessageV2(successMsgV2(ph, ph === "pre-activation" ? { preActivationState: STATES.pre(), counts: STATES.counts() } : ph === "ceilings" ? { oneCallPolicy: STATES.ceilings() } : { [ph + "State"]: STATES[ph === "activated" ? "activated" : ph === "armed" ? "armed" : "restored"]() }, "test")).ok));
const readerAuth = (o = {}) => ({ cfg: { ok: true, reviewer: { pinnedFingerprint: rv.fp }, targets: { pgServiceId: ID.TARGETS_V2.postgres } }, trustRoot: rv.trustRoot,
  readerDbClient: { __testFixture: true, statementTimeoutMs: 2000, async query(sql) { const k = REG.REGISTRY_KEYS.find((x) => REG.V2_QUERY_REGISTRY[x] === sql); return { rows: [{ ...STATES.armed(), ...STATES.ceilings(), ...STATES.counts(), ...(k === "preActivationCatalog" || k === "policyControl" ? STATES.pre() : {}) }] }; } },
  connectionIdentityProof: testConnectionProof(), expectedIssuer: "TEST-ISSUER", connectionToken: "TEST-TOKEN",
  readerPrivilegeProof: { provenance: "TEST-ONLY-reader-privilege-proof", role: "live_ai_03b_reader", pgServiceId: ID.TARGETS_V2.postgres, effectiveSelectOnly: true, writePrivilegeCount: 0, selectGrantCount: 12, forbiddenObjectAccessible: false, unapprovedRoleMembership: false, unapprovedRoutineAuthority: false, boundReaderToken: "TEST-TOKEN", issuedAtMs: Date.now() },
  registry: REG.buildV2RegistrySupply(), sourcePin: testSourcePin(), nowProvider: () => Date.now(), ...o });
ok("RD09 reader-only V2 authority validates (test boundary)", validateReaderOnlyAuthorityV2(readerAuth(), { testBoundary: true }).ok, validateReaderOnlyAuthorityV2(readerAuth(), { testBoundary: true }));
for (const [n, o, want] of [
  ["RD10 executor client present", { executorDbClient: { query() {} } }, "reader_only_rejects_executor_client"],
  ["RD11 V1 reviewedStateQueries supplied", { reviewedStateQueries: V1_buildQueries() }, "reader_only_v2_rejects_v1_query_map"],
  ["RD12 V1 registry as registry", { registry: V1_buildQueries() }, "query_registry_supplied_registry_key_set_mismatch"],
  ["RD13 unresolved Step-2 pin", { sourcePin: testSourcePin({ step2Runtime: SRC.STEP2_RUNTIME_PIN_PLACEHOLDER }) }, "source_pin_step2_runtime_pin_required_after_preservation"],
  ["RD14 11 SELECT grants", { readerPrivilegeProof: { ...readerAuth().readerPrivilegeProof, selectGrantCount: 11 } }, "reader_privilege_proof_grant_count"],
  ["RD15 statement timeout 5 s", { readerDbClient: { ...readerAuth().readerDbClient, statementTimeoutMs: 5000 } }, "reader_client_statement_timeout_invalid"],
]) { const r = validateReaderOnlyAuthorityV2(readerAuth(o), { testBoundary: true }); ok(n, r.reason === want, r); }
ok("RD16 production validation refuses test fixture / test provenance", !validateReaderOnlyAuthorityV2(readerAuth()).ok);
{
  const host = makeReaderOnlyHostV2(readerAuth(), { testBoundary: true });
  const m = await host.observe({ observation: "ceilings" });
  ok("RD17 V2 host serves ceilings observation, exact 105,920", m.ok === true && m.kind === MESSAGE_KIND_V2 && m.observation.oneCallPolicy.session_money_ceiling_micros === 105920, m);
  ok("RD18 V1 observation name refused", (await host.observe({ observation: "dormant" })).code === "unknown_observation");
  ok("RD19 extra request key refused", (await host.observe({ observation: "armed", sql: "SELECT 1" })).code === "request_rejected");
  const v1host = V1_hostForTest({ dbClient: readerAuth().readerDbClient });
  const v1m = await v1host.observe({ observation: "ceilings" });
  ok("RD20 a V1 host message is refused by the V2 boundary", !assertOutwardMessageV2(v1m).ok);
}
ok("RD21 production reader entrypoint refuses test injection", (await startProductionReaderServiceV2({ physicalFactory: {}, log: () => {} })).reason === "test_injection_refused_in_production");
ok("RD22 production reader entrypoint fails closed: V2 source pin UNPROVISIONED (before any DB/attester)", (await startProductionReaderServiceV2({ log: () => {}, env: {} })).reason === "v2_source_pin_unprovisioned");
ok("RD23 serving runtime default authority UNPROVISIONED", (await startServingRuntimeV2({ log: () => {} })).status === "unprovisioned");
ok("RD24 gateway caller: public destination refused", createGatewayObservationCallerV2({ destination: { host: "8.8.8.8", port: 7000 }, secret: "x".repeat(32) }).code === "config_invalid");
ok("RD25 gateway caller: loopback only under test boundary", createGatewayObservationCallerV2({ destination: { host: "127.0.0.1", port: 7000 }, secret: "x".repeat(32) }).available === false && createGatewayObservationCallerV2({ destination: { host: "127.0.0.1", port: 7000 }, secret: "x".repeat(32), offlineTestBoundary: true, expectedMode: "test" }).available === true);
ok("RD26 PRODUCTION_OPTION_KEYS unchanged (no source pin / factory injection)", PRODUCTION_OPTION_KEYS.join() === "mode,env,log,onFatal,onDegraded");
{
  // loopback end-to-end: V2 serving runtime (test authority) ↔ V2 gateway caller
  const port = await new Promise((res) => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); }); });
  const SECRET = "synthetic-transport-secret-0123456789";
  const rt = await startServingRuntimeV2({ acquireReaderAuthority: async () => ({ available: true, authority: readerAuth() }), transportSecretProvider: async () => SECRET, listen: { mode: "loopback-tcp", host: "127.0.0.1", port }, testBoundary: true, log: () => {} });
  const gw = createGatewayObservationCallerV2({ destination: { host: "127.0.0.1", port }, secret: SECRET, offlineTestBoundary: true, expectedMode: "test" });
  const res = await gw.observe("armed");
  ok("RD27 loopback: V2 caller ↔ V2 runtime armed observation", rt.started && res.ok && res.message.observation.armedState.one_call_policy_digest === ID.POLICY_V2.active_digest, res);
  ok("RD28 loopback: V1 phase name refused client-side", (await gw.observe("dormant")).code === "observation_not_approved");
  const bad = createGatewayObservationCallerV2({ destination: { host: "127.0.0.1", port }, secret: "wrong-secret-0123456789abcdef", offlineTestBoundary: true, expectedMode: "test" });
  ok("RD29 loopback: wrong transport secret ⇒ unauthenticated", (await bad.observe("armed")).readerCode === "unauthenticated");
  await rt.stop();
}

// ═══════════ ST — static boundary scans over the runtime modules ═══════════
const runtimeFiles = SRC.RUNTIME_MANIFEST_FILES.map((p) => ({ p, s: readFileSync(join(STEP2, p), "utf8") }));
const imports = (s) => [...s.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
const V1_BOUND = ["trusted-activation-boundary-01/pricing-approval-contract.mjs", "trusted-activation-boundary-01/approval-verify.mjs", "trusted-activation-boundary-01/trusted-activation-executor.mjs",
  "first-text-probe-activation-01/first-probe-preflight-postflight.mjs", "trusted-executor-runtime-01/trusted-read-adapter.mjs", "trusted-executor-runtime-01/restricted-activation-adapter.mjs",
  "trusted-executor-runtime-01/trusted-executor-runtime.mjs", "trusted-executor-runtime-01/runtime-config.mjs", "trusted-executor-runtime-01/production-authority.mjs", "trusted-executor-runtime-01/production-query-registry.mjs",
  "trusted-runtime-live-binding-offline-01/production-read-queries.mjs", "trusted-runtime-live-binding-offline-01/production-authority-composition.mjs",
  "private-reader-production-integration-offline-01/production-reader-authority.mjs", "private-reader-host-runtime-offline-01/private-reader-host-runtime.mjs"];
const offenders = runtimeFiles.flatMap(({ p, s }) => imports(s).filter((i) => V1_BOUND.some((b) => i.endsWith(b))).map((i) => `${p} → ${i}`));
ok("ST01 no runtime module imports a V1-version-bound module", offenders.length === 0, offenders);
ok("ST02 no runtime module uses 89,536 as a value (comments + the obsolete-policy reason-code name excluded)", runtimeFiles.every(({ s }) => !s.replace(/\/\/.*$/gm, "").replace(/obsolete_89536_policy_present/g, "").includes("89536")));
ok("ST03 2b69ce appears only in the source-identity rejection list", runtimeFiles.filter(({ s }) => s.includes("2b69ce28")).map(({ p }) => p).join() === "identity/v2-source-identity.mjs");
ok("ST04 probe imports no http/https/fetch/net and builds no provider URL", (() => { const s = readFileSync(join(STEP2, "probe/v2-first-text-probe.mjs"), "utf8"); return !/node:(http|https|net|tls)|\bfetch\(|api\.openai\.com/.test(s); })());
ok("ST05 no runtime module reads process.env OPENAI_API_KEY or a secret value", runtimeFiles.every(({ s }) => !/process\.env\.(OPENAI_API_KEY|LIVE_AI_03B_TRUSTED_(EXECUTOR|READER)_DB_URL)/.test(s)));
ok("ST06 no runtime module imports test helpers / fixtures", runtimeFiles.every(({ s }) => !imports(s).some((i) => /tests\//.test(i))));
ok("ST07 no model identifier / private key material in runtime or tests", [...runtimeFiles, ...readdirSync(HERE).filter((f) => f.endsWith(".mjs")).map((f) => ({ s: readFileSync(join(HERE, f), "utf8") }))].every(({ s }) => !/claude-(opus|sonnet|haiku|fable)|BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY|sk-[A-Za-z0-9]{20,}/.test(s)));
ok("ST08 only fixed V2 function names in the activation adapter", (() => { const s = readFileSync(join(STEP2, "runtime/v2-restricted-activation-adapter.mjs"), "utf8"); return s.includes("live_ai_03b_trusted_v2.activate_catalog_v2") && !/live_ai_03b_trusted\.activate_catalog\b/.test(s.replace(/\/\/.*$/gm, "")); })());
ok("ST09 production entrypoints never import tests or accept testBoundary in production signatures", !/testBoundary:\s*true/.test(readFileSync(join(STEP2, "runtime/v2-trusted-executor-runtime.mjs"), "utf8").split("runTrustedExecutorProductionV2")[1].split("runTrustedExecutorTestV2")[0]));
{
  const bad = runtimeFiles.filter(({ s }) => /\b(execSync|spawn|exec)\(/.test(s));
  ok("ST10 no runtime module spawns processes", bad.length === 0, bad.map((b) => b.p));
}
{
  // ST11 — the ONLY frozen (non-Step-1) symbols the successor may import: version-neutral primitives.
  const NEUTRAL = {
    "first-text-probe-activation-01/first-text-probe.mjs": ["PROBE_TEXT", "PROBE_TEXT_SHA256"],
    "private-reader-host-runtime-offline-01/observation-transport.mjs": ["APPROVED_OPS", "MAX_RESPONSE_BYTES", "MIN_SECRET_LEN", "TRANSPORT_VERSION", "startObservationServer", "validateListenConfig"],
    "private-reader-production-integration-offline-01/gateway-observation-caller.mjs": ["CALLER_CODES", "CONNECT_TIMEOUT_MS", "READER_TRANSPORT_CODES", "TOTAL_TIMEOUT_MS", "macFor", "validateDestination"],
    "private-reader-host-offline-01/private-reader-host.mjs": ["ERROR_CODES", "FORBIDDEN_RESULT_KEY_RE"],
    "private-reader-host-runtime-offline-01/runtime-config.mjs": ["ENV_TRANSPORT_SECRET", "acquireTransportSecretFromEnv", "resolveListenConfigFromEnv", "targetSelfCheck"],
    "private-reader-production-integration-offline-01/integration-config.mjs": ["loadIntegrationConfig"],
    "private-reader-production-integration-offline-01/reader-session.mjs": ["establishReaderSession", "makePgPhysicalFactory", "recheckReaderSession"],
    "private-reader-production-integration-offline-01/reader-attestation.mjs": ["isDriftReason", "makeAttesterTrustRoot", "verifyReaderAttestation"],
    "private-reader-production-integration-offline-01/production-entrypoint.mjs": ["composeProductionAttestationSource"],
    "trusted-executor-runtime-01/db-target-binding.mjs": ["CONNECTION_IDENTITY_PROOF_CONTRACT", "verifyConnectionTargetBinding"],
    "private-reader-host-runtime-offline-01/reader-only-authority.mjs": ["READER_EXPECTED_SELECT_GRANTS", "READER_PRIVILEGE_PROOF_CONTRACT", "READER_ROLE", "READER_STATEMENT_TIMEOUT_MAX_MS"],
    "private-reader-production-integration-offline-01/attestation-source-channel.mjs": ["CHANNEL_FAILURE_CODES"],
    "trusted-executor-runtime-01/canonical-timestamp.mjs": ["CANONICAL_CONSUMED_AT_SQL", "assertCanonicalConsumedAt"],
  };
  const bad = [];
  for (const { p, s } of runtimeFiles) for (const m of s.matchAll(/import\s*\{([^}]*)\}\s*from\s*"([^"]+)"/g)) {
    const mod = m[2]; if (!mod.startsWith("../../") || mod.includes("m7-step1-hb1-consolidated-remediation-01")) continue;
    const key = mod.replace("../../", ""); const syms = m[1].split(",").map((x) => x.trim().split(/\s+as\s+/)[0]).filter(Boolean);
    for (const sym of syms) if (!(NEUTRAL[key] || []).includes(sym)) bad.push(`${p}: ${key}#${sym}`);
  }
  ok("ST11 successor imports from frozen non-Step-1 modules are ONLY the listed version-neutral symbols", bad.length === 0, bad);
  // the reused neutral modules read V1 FIXED for the SIX infrastructure target ids only (asserted equal to FIXED_V2 in I02)
  const TARGET_KEYS = new Set(["ai_staging_project", "ai_staging_environment", "ai_staging_postgres", "ai_staging_gateway", "core_excluded_project", "core_excluded_postgres"]);
  const leaks = Object.keys(NEUTRAL).flatMap((k) => [...readFileSync(join(STEP2, "..", k), "utf8").matchAll(/FIXED\.([a-z_]+)/g)].map((m) => m[1]).filter((x) => !TARGET_KEYS.has(x)).map((x) => `${k}: FIXED.${x}`));
  ok("ST12 reused neutral modules consume NO V1 pricing/catalog/policy field of FIXED (targets only)", leaks.length === 0, leaks);
}
done();
