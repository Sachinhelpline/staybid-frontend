// M7 Step-2 LIFECYCLE CORRECTION — focused OFFLINE suite (A–K + real-git PIN-C lineage). Synthetic keys / ids /
// fixtures only. Connects to NOTHING external: fetch / http / https / net sockets are trapped and counted, every
// child process is recorded (only local read-only `git` and a local `tar -x` into a temp dir are permitted).
import { readFileSync, readdirSync, statSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname, resolve, relative } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import cp from "node:child_process";
import net from "node:net";
import http from "node:http";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";

// ── J/K guards: installed BEFORE any code under test runs ──
const G_COUNTS = { fetch: 0, http: 0, socket: 0 };
const SPAWNS = [];
globalThis.fetch = async () => { G_COUNTS.fetch++; throw new Error("network_forbidden_in_offline_suite"); };
for (const m of [http, https]) { const orig = m.request; m.request = (...a) => { G_COUNTS.http++; throw new Error("network_forbidden_in_offline_suite"); }; m.get = m.request; void orig; }
const origConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...a) { G_COUNTS.socket++; throw new Error("network_forbidden_in_offline_suite"); };
void origConnect;
const READONLY_GIT = new Set(["rev-parse", "merge-base", "diff", "cat-file", "archive", "ls-tree", "show"]);
for (const fn of ["execFileSync", "spawnSync", "execSync", "spawn", "execFile", "exec"]) {
  const orig = cp[fn];
  cp[fn] = function (cmd, args, ...rest) {
    const argv = Array.isArray(args) ? args : [];
    const verb = cmd === "git" ? argv.filter((x) => !x.startsWith("-") && x !== argv[argv.indexOf("-C") + 1])[0] : null;
    SPAWNS.push({ cmd: String(cmd), verb });
    return orig.call(this, cmd, args, ...rest);
  };
}
syncBuiltinESMExports();

const { makeReviewer, makeApproval, testActivationSourceProof, testPreProbeSourceProof, testStep2Binding, testDeployedGateway, STATES, RAILWAY, DB,
  phaseBGates, consumedFixture, testEnv, testConnectionProof, makeRunner, iso } = await import("./helpers.mjs");
const SRC = await import("../identity/v2-source-identity.mjs");
const ID = await import("../identity/v2-identity.mjs");
const REG = await import("../runtime/v2-query-registry.mjs");
const PF = await import("../runtime/v2-preflight.mjs");
const PA = await import("../runtime/v2-production-authority.mjs");
const EXR = await import("../runtime/v2-trusted-executor-runtime.mjs");
const { ACTIVATE_SQL_V2 } = await import("../runtime/v2-restricted-activation-adapter.mjs");
const { loadRuntimeConfigV2 } = await import("../runtime/v2-runtime-config.mjs");
const { validateReaderOnlyAuthorityV2 } = await import("../reader/v2-reader-only-authority.mjs");
const { startProductionReaderServiceV2 } = await import("../reader/v2-production-entrypoint.mjs");
const { verifyStep2Preservation, makeGit } = await import("../tools/verify-step2-preservation.mjs");

const HERE = dirname(fileURLToPath(import.meta.url));
const STEP2 = resolve(HERE, "..");
const REPO = resolve(STEP2, "../../..");
const { ok, done } = makeRunner("m7s2-lifecycle-correction");
const rv = makeReviewer();
const NOW = Date.now();
const nowIso = iso(NOW);
const ap = makeApproval(rv, { nowMs: NOW, approvalId: "m7s2-lc-approval-0001", executionId: "m7s2-lc-exec-0001" });
const git = (...a) => cp.execFileSync("git", ["-C", REPO, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 << 20 });
const H = SRC.HISTORICAL_STEP2_PRESERVATION, M5 = SRC.ACCEPTED_M5_CLOSURE, B = SRC.GATEWAY_DEPLOY_SOURCE_V2;
const reasons = (r) => (r && r.failures ? r.failures.map((f) => f.reason) : []);

// ═══════════ A — the ORIGINAL lifecycle cycle, reproduced against the historical (f5ec5807) bytes ═══════════
{
  const tmp = mkdtempSync(join(tmpdir(), "lai03b-m7s2-hist-"));
  try {
    const tar = cp.execFileSync("git", ["-C", REPO, "archive", "--format=tar", H.commit, "scripts/live-ai-03b"], { maxBuffer: 256 << 20 });
    writeFileSync(join(tmp, "h.tar"), tar);
    cp.execFileSync("tar", ["-xf", join(tmp, "h.tar"), "-C", tmp]);
    const hs2 = join(tmp, "scripts/live-ai-03b/m7-step2-runtime-rebinding-offline-01");
    const HS = await import(pathToFileURL(join(hs2, "identity/v2-source-identity.mjs")).href);
    const HPF = await import(pathToFileURL(join(hs2, "runtime/v2-preflight.mjs")).href);
    const hm = HS.measureRuntimeManifest(hs2);
    ok("A01 historical f5ec5807 runtime measures exactly the historical manifest 9a460078…", hm.digest === H.runtime_manifest_digest, hm.digest);
    const histBinding = { contract: "Step2RuntimePreservationBindingV1", status: "PRESERVED", provenance: "TEST-ONLY-step2-preservation-receipt",
      commit: "5e2c0de5e2c0de5e2c0de5e2c0de5e2c0de5e2c0", tree: "7ee57ee57ee57ee57ee57ee57ee57ee57ee57ee5", step2_dir_tree: "d12d12d12d12d12d12d12d12d12d12d12d12d12d", runtime_manifest_digest: hm.digest };
    const preDeploy = { contract: "LiveAi03bSourcePinV2", derivationBase: { commit: SRC.DERIVATION_BASE.commit, tree: SRC.DERIVATION_BASE.tree }, gatewaySource: undefined, step2Runtime: histBinding };
    const hc = HS.checkSourcePinV2(preDeploy, { testBoundary: true, measured: hm });
    ok("A02 historical combined check BEFORE any gateway deployment ⇒ gateway_source_observation_absent (activation authority impossible)", hc.reason === "gateway_source_observation_absent", hc);
    const withDeployed = { ...preDeploy, gatewaySource: { deployed_commit: B.commit, deployed_tree: B.tree, gateway_deployment_revision: B.commit, voice_gateway_tree: B.voice_gateway_tree } };
    ok("A03 historical combined check passes ONLY with an observed DEPLOYED PIN-B gateway (the dependency)", HS.checkSourcePinV2(withDeployed, { testBoundary: true, measured: hm }).ok === true);
    let hpa;
    try {
      hpa = HPF.runPreActivationV2({ railway: RAILWAY(), sourcePin: preDeploy, db: DB(), nowIso, testBoundary: true, approvalEnvelope: ap.envelope, trustRoot: rv.trustRoot,
        suppliedEvidence: ap.suppliedEvidence, executionId: ap.executionId, isApprovalConsumed: () => false, preActivationState: STATES.pre(), counts: STATES.counts(),
        approvalConsumed: false, privilegeProof: { restricted_role_proof_present: true } });
    } catch (e) { hpa = { pass: false, failures: [{ reason: "threw:" + e.message }] }; }
    ok("A04 historical Phase A (pre-deployment reality) FAILS on the gateway observation ⇒ SQL 03 blocked", hpa.pass === false && reasons(hpa).includes("gateway_source_observation_absent"), reasons(hpa));
  } finally { rmSync(tmp, { recursive: true, force: true }); }
  const main = git("show", `${B.commit}:server/voice-gateway/live-ai-staging-main.ts`);
  const mainFn = main.slice(main.indexOf("export async function stagingMain("));
  const iLoad = mainFn.indexOf("await loadStagingPriceCatalog(pool)"), iExit = mainFn.indexOf("if (!cat.ok)"), iListen = mainFn.indexOf("await app.listen(");
  ok("A05 PIN-B gateway source (stagingMain): the catalog load + fail-closed exit precede app.listen() ⇒ no healthy gateway before activation",
    main.includes('reason: "no_active_catalog_version"') && iLoad > 0 && iExit > iLoad && iListen > iExit, { iLoad, iExit, iListen });
  ok("A06 corrected runtime: the historical combined check is RETIRED (fails closed for the formerly-valid pin)",
    SRC.checkSourcePinV2({ contract: "LiveAi03bSourcePinV2" }).reason === "combined_source_pin_v2_retired_phase_specific_proof_required");
  ok("A07 corrected runtime: a LiveAi03bSourcePinV2 object cannot be used as the Phase-A proof",
    SRC.checkActivationSourceProofV2({ ...testPreProbeSourceProof(), contract: "LiveAi03bSourcePinV2" }, { testBoundary: true }).reason === "combined_source_pin_v2_retired_phase_specific_proof_required");
}

// ═══════════ B — corrected ActivationSourceProofV2: positive ═══════════
{
  const r = SRC.checkActivationSourceProofV2(testActivationSourceProof(), { testBoundary: true });
  ok("B01 exact PIN A + exact STATIC PIN B + valid TEST PIN-C (test boundary) ⇒ PASS", r.ok === true, r);
  ok("B02 activation proof requires NO deployed gateway and claims none (gatewayDeployed:false, no deployment keys)",
    r.gatewayDeployed === false && r.phase === "activation" && !("gatewayDeployment" in testActivationSourceProof()) && !Object.keys(testActivationSourceProof().gatewayStaticSource).some((k) => /deployed|healthy|revision|observ/.test(k)));
  ok("B03 the static PIN-B object is the reviewed literal (not caller-chosen)", JSON.stringify(testActivationSourceProof().gatewayStaticSource) === JSON.stringify(SRC.staticGatewaySourceIdentityV2())
    && SRC.staticGatewaySourceIdentityV2().commit === "4f390b74132b087b757faa655bdcb73be6c14a8f" && SRC.staticGatewaySourceIdentityV2().tree === "72080256d4cc2a97a2a15058931e838ebef5ec48");
  const blobs = Object.entries(B.closure_blobs).every(([p, h]) => git("rev-parse", `${B.commit}:${p}`).trim() === h);
  ok("B04 the reviewed static literal matches real git at PIN B (tree, voice-gateway tree, every closure blob incl. openai-responses 1a9e2ae8 / staging-main e211b25f)",
    blobs && git("rev-parse", `${B.commit}^{tree}`).trim() === B.tree && git("rev-parse", `${B.commit}:server/voice-gateway`).trim() === B.voice_gateway_tree
    && B.closure_blobs["server/voice-gateway/openai-responses.ts"] === "1a9e2ae8f13365577c4a0dc40f6771c1c5073a37" && B.closure_blobs["server/voice-gateway/live-ai-staging-main.ts"] === "e211b25f68f4414f4c6a938d9c25935cdf26b67a");
  ok("B05 the TEST PIN-C is accepted ONLY under the explicit test boundary", SRC.checkActivationSourceProofV2(testActivationSourceProof()).reason === "step2_runtime_pin_provenance_untrusted");
}

// ═══════════ C — ActivationSourceProofV2: negatives ═══════════
{
  const st = SRC.staticGatewaySourceIdentityV2();
  const act = (o) => SRC.checkActivationSourceProofV2(testActivationSourceProof(o), { testBoundary: true }).reason;
  const pin = (o) => act({ step2Runtime: testStep2Binding(o) });
  const cases = [
    ["C01 wrong PIN A commit", act({ derivationBase: { commit: "f".repeat(40), tree: SRC.DERIVATION_BASE.tree } }), "derivation_base_rewritten"],
    ["C02 rewritten derivation base (= PIN B)", act({ derivationBase: { commit: B.commit, tree: B.tree } }), "derivation_base_rewritten"],
    ["C03 PIN A absent", act({ derivationBase: null }), "derivation_base_absent"],
    ["C04 wrong static PIN B commit (caller-chosen)", act({ gatewayStaticSource: { ...st, commit: "a".repeat(40) } }), "static_gateway_commit_mismatch"],
    ["C05 wrong static PIN B tree", act({ gatewayStaticSource: { ...st, tree: "a".repeat(40) } }), "static_gateway_tree_mismatch"],
    ["C06 wrong static voice-gateway tree", act({ gatewayStaticSource: { ...st, voice_gateway_tree: "a".repeat(40) } }), "static_gateway_voice_gateway_tree_mismatch"],
    ["C07 wrong closure digest", act({ gatewayStaticSource: { ...st, closure_digest: "0".repeat(64) } }), "static_gateway_closure_digest_mismatch"],
    ["C08 wrong repository", act({ gatewayStaticSource: { ...st, repository: "someone/else" } }), "static_gateway_repository_mismatch"],
    ["C09 superseded PIN B commit 2b69ce", act({ gatewayStaticSource: { ...st, commit: SRC.SUPERSEDED_GATEWAY_SOURCE_V1.commit } }), "superseded_gateway_source_2b69ce_rejected"],
    ["C10 superseded PIN B tree 87aad22", act({ gatewayStaticSource: { ...st, tree: SRC.SUPERSEDED_GATEWAY_SOURCE_V1.tree } }), "superseded_gateway_source_2b69ce_rejected"],
    ["C11 superseded voice-gateway tree 8dd65435", act({ gatewayStaticSource: { ...st, voice_gateway_tree: SRC.SUPERSEDED_GATEWAY_SOURCE_V1.voice_gateway_tree } }), "superseded_gateway_source_2b69ce_rejected"],
    ["C12 static proof claiming deployment (healthy:true)", act({ gatewayStaticSource: { ...st, healthy: true } }), "activation_proof_must_not_claim_gateway_deployment"],
    ["C13 activation proof carrying a deployment observation", act({ gatewayDeployment: testDeployedGateway() }), "activation_proof_must_not_claim_gateway_deployment"],
    ["C14 pre-probe proof supplied as an activation proof", SRC.checkActivationSourceProofV2(testPreProbeSourceProof(), { testBoundary: true }).reason, "pre_probe_proof_is_not_an_activation_proof"],
    ["C15 PIN-C placeholder (not preserved)", act({ step2Runtime: SRC.STEP2_RUNTIME_PIN_PLACEHOLDER }), "step2_runtime_pin_required_after_preservation"],
    ["C16 PIN-C missing", act({ step2Runtime: null }), "step2_runtime_pin_absent"],
    ["C17 PIN-C malformed commit", pin({ commit: "HEAD" }), "step2_runtime_pin_commit_malformed"],
    ["C18 PIN-C extra key", pin({ approved: true }), "step2_runtime_pin_shape_not_exact"],
    ["C19 historical runtime manifest 9a460078… against the corrected runtime", pin({ runtime_manifest_digest: H.runtime_manifest_digest }), "historical_runtime_manifest_cannot_authorize_corrected_runtime"],
    ["C20 historical PIN-C commit f5ec5807", pin({ commit: H.commit }), "historical_pin_c_cannot_authorize_corrected_runtime"],
    ["C21 historical PIN-C Step-2 dir tree", pin({ step2_dir_tree: H.step2_dir_tree }), "historical_step2_dir_tree_cannot_authorize_corrected_runtime"],
    ["C22 historical V1 binding contract", SRC.verifyStep2RuntimePin({ contract: "Step2RuntimePreservationBindingV1", status: "PRESERVED", provenance: "trusted-approved-step2-preservation-receipt", commit: H.commit, tree: H.tree, step2_dir_tree: H.step2_dir_tree, runtime_manifest_digest: H.runtime_manifest_digest }).reason, "historical_step2_binding_v1_cannot_authorize_corrected_runtime"],
    ["C23 fabricated / non-preserved PIN-C (status DRAFT)", pin({ status: "DRAFT" }), "step2_runtime_pin_not_preserved"],
    ["C24 PIN-C for other bytes", pin({ runtime_manifest_digest: "1".repeat(64) }), "step2_runtime_manifest_mismatch"],
    ["C25 PIN-C = the uncorrected baseline 3fda6af1", pin({ commit: M5.commit }), "step2_runtime_pin_reuses_non_step2_commit"],
    ["C26 PIN-C wrong lineage (correction base)", pin({ correction_base: H.commit }), "step2_runtime_pin_lineage_mismatch"],
    ["C27 PIN-C wrong provenance (trusted string under the test boundary)", pin({ provenance: SRC.STEP2_TRUSTED_PROVENANCE }), "step2_runtime_pin_provenance_untrusted"],
    ["C28 PIN-C old V1 provenance string", pin({ provenance: "trusted-approved-step2-preservation-receipt" }), "step2_runtime_pin_provenance_untrusted"],
    ["C29 activation proof wrong contract", act({ contract: "LiveAi03bActivationSourceProofV1" }), "activation_source_proof_contract_mismatch"],
    ["C30 activation proof extra key", act({ note: "x" }), "activation_source_proof_shape_not_exact"],
  ];
  for (const [n, got, want] of cases) ok(n, got === want, got);
}

// ═══════════ D / E — PreProbeSourceProofV2 (Phase B / reader) ═══════════
{
  const r = SRC.checkPreProbeSourceProofV2(testPreProbeSourceProof(), { testBoundary: true });
  ok("D01 independent HEALTHY deployed PIN-B observation + PIN A + PIN C ⇒ PASS (gatewayDeployed:true)", r.ok && r.gatewayDeployed === true && r.phase === "pre-probe", r);
  ok("D02 the observation object must be the live deployment observation (commit/tree/revision/voice-gateway tree all exact)",
    ["deployed_commit", "deployed_tree", "gateway_deployment_revision", "voice_gateway_tree"].every((k) => testDeployedGateway()[k] !== undefined));
  const pp = (o) => SRC.checkPreProbeSourceProofV2(testPreProbeSourceProof(o), { testBoundary: true }).reason;
  const dg = (o) => pp({ gatewayDeployment: testDeployedGateway(o) });
  const S = SRC.SUPERSEDED_GATEWAY_SOURCE_V1;
  const cases = [
    ["E01 static-only proof (the activation proof) cannot satisfy Phase B", SRC.checkPreProbeSourceProofV2(testActivationSourceProof(), { testBoundary: true }).reason, "static_gateway_proof_cannot_satisfy_pre_probe"],
    ["E02 static PIN-B object in the deployment slot", pp({ gatewayDeployment: SRC.staticGatewaySourceIdentityV2() }), "static_gateway_proof_cannot_satisfy_pre_probe"],
    ["E03 extra static key alongside the observation", pp({ gatewayStaticSource: SRC.staticGatewaySourceIdentityV2() }), "static_gateway_proof_cannot_satisfy_pre_probe"],
    ["E04 absent gateway observation", pp({ gatewayDeployment: null }), "gateway_source_observation_absent"],
    ["E05 gateway observation key missing", (() => { const x = testPreProbeSourceProof(); delete x.gatewayDeployment; return SRC.checkPreProbeSourceProofV2(x, { testBoundary: true }).reason; })(), "pre_probe_source_proof_shape_not_exact"],
    ["E06 wrong deployed commit", dg({ deployed_commit: "a".repeat(40) }), "deployed_commit_mismatch"],
    ["E07 wrong deployment revision", dg({ gateway_deployment_revision: "a".repeat(40) }), "gateway_revision_not_pinned_commit"],
    ["E08 wrong deployed tree", dg({ deployed_tree: "a".repeat(40) }), "deployed_tree_mismatch"],
    ["E09 wrong voice-gateway tree", dg({ voice_gateway_tree: "a".repeat(40) }), "voice_gateway_closure_tree_mismatch"],
    ["E10 superseded V1 deployed commit 2b69ce", dg({ deployed_commit: S.commit }), "superseded_gateway_source_2b69ce_rejected"],
    ["E11 superseded V1 tree 87aad22", dg({ deployed_tree: S.tree }), "superseded_gateway_source_2b69ce_rejected"],
    ["E12 superseded V1 revision", dg({ gateway_deployment_revision: S.commit }), "superseded_gateway_source_2b69ce_rejected"],
    ["E13 superseded V1 voice-gateway tree 8dd65435", dg({ voice_gateway_tree: S.voice_gateway_tree }), "superseded_gateway_source_2b69ce_rejected"],
    ["E14 unhealthy deployed gateway", dg({ healthy: false }), "deployed_gateway_not_healthy"],
    ["E15 self-reported (non-independent) observation", dg({ observation_provenance: "self-reported-by-caller" }), "deployed_gateway_observation_not_independent"],
    ["E16 TEST observation in production", SRC.checkPreProbeSourceProofV2(testPreProbeSourceProof()).reason, "deployed_gateway_observation_not_independent"],
    ["E17 observation kind absent", (() => { const g = testDeployedGateway(); delete g.kind; return pp({ gatewayDeployment: g }); })(), "deployed_gateway_observation_kind_absent"],
    ["E18 unresolved PIN-C", pp({ step2Runtime: SRC.STEP2_RUNTIME_PIN_PLACEHOLDER }), "step2_runtime_pin_required_after_preservation"],
  ];
  for (const [n, got, want] of cases) ok(n, got === want, got);
}

// ═══════════ F — production authority acquisition seam ═══════════
const makeClients = (fixture) => {
  const state = { mode: "pre", ledger: [], activations: 0 };
  const row = () => ({ ...(state.mode === "pre" ? STATES.pre() : STATES.activated()), ...STATES.counts() });
  const reader = { async query(sql, p) { if (sql === REG.LEDGER_COMMITTED_QUERY_V2) return { rows: state.ledger.filter((x) => x.approval_id === p[0] && x.execution_id === p[1]) }; if (REG.REGISTRY_KEYS.some((k) => REG.V2_QUERY_REGISTRY[k] === sql)) return { rows: [row()] }; throw new Error("unexpected sql"); } };
  const executor = { async query(sql, p) { if (sql !== ACTIVATE_SQL_V2) throw new Error("only activate"); state.activations++; const cl = JSON.parse(p[0]); const at = iso(Date.now() - 1000);
    if (state.ledger.some((x) => x.approval_id === cl.approval_id)) throw Object.assign(new Error("replay"), { code: "P0001" });
    state.ledger.push({ approval_id: cl.approval_id, execution_id: p[1], content_digest: cl.content_digest, active_catalog_digest: ID.CATALOG_V2.active_digest, action: "activate", consumed_at: at }); state.mode = "activated";
    return { rows: [{ receipt: { contract: "CatalogActivationReceiptV2", catalog_version_id: ID.CATALOG_V2.id, approval_id: cl.approval_id, execution_id: p[1], content_digest: cl.content_digest, active_catalog_digest: ID.CATALOG_V2.active_digest, action: "activate", consumed_at: at } }] }; } };
  if (fixture) { reader.__testFixture = true; executor.__testFixture = true; }
  return { state, reader, executor };
};
const synthAuthority = (c, over = {}) => ({ cfg: loadRuntimeConfigV2(testEnv(rv)), trustRoot: rv.trustRoot, executorDbClient: c.executor, readerDbClient: c.reader,
  connectionIdentityProof: testConnectionProof(), expectedIssuer: "TEST-ISSUER", connectionToken: "TEST-TOKEN", privilegeProof: { restricted_role_proof_present: true },
  registry: REG.buildV2RegistrySupply(), activationSourceProof: testActivationSourceProof(), nowProvider: () => iso(Date.now()), ...over });
const provisioner = (authority, spy) => Object.freeze({ contract: PA.PROVISIONER_CONTRACT_V2, async acquire(...args) { if (spy) { spy.calls++; spy.argc = args.length; } return { available: true, authority }; } });
{
  const u1 = await PA.acquireProductionAuthorityV2(), u2 = await PA.acquireProductionAuthorityV2();
  ok("F01 default (no provisioner) ⇒ deterministic UNPROVISIONED", u1.available === false && u1.reason === "v2_production_authority_unprovisioned" && u1 === u2 && Object.isFrozen(u1));
  ok("F02 default production executor ⇒ fail closed before any I/O", (await EXR.runTrustedExecutorProductionV2({ approvalEnvelope: ap.envelope, suppliedEvidence: ap.suppliedEvidence, executionId: ap.executionId })).reason === "v2_production_authority_unprovisioned");
  const c = makeClients(true);
  const t = await PA.acquireAuthorityForTestV2(provisioner(synthAuthority(c)), { testBoundary: true });
  ok("F03 synthetic TEST authority passes ONLY under the explicit isolated test boundary", t.available === true && t.mode === "test" && Object.isFrozen(t.authority));
  ok("F04 test acquisition without the boundary refused", (await PA.acquireAuthorityForTestV2(provisioner(synthAuthority(c)))).reason === "test_acquisition_requires_testBoundary_true");
  ok("F05 the SAME synthetic authority is REJECTED by production validation (test fixture)", (await PA.acquireProductionAuthorityV2(provisioner(synthAuthority(c)))).reason === "authority_rejects_test_fixture:executorDbClient");
  const c2 = makeClients(false);
  ok("F06 non-fixture clients but TEST connection proof ⇒ production rejects", (await PA.acquireProductionAuthorityV2(provisioner(synthAuthority(c2)))).reason === "authority_connection_proof_untrusted");
  const V = (o, tb = true) => PA.validateProvisionedAuthorityV2(synthAuthority(c2, o), { testBoundary: tb }).reason;
  ok("F07 same DB client for executor + reader rejected", V({ readerDbClient: c2.executor }) === "authority_executor_and_reader_share_a_client");
  ok("F08 missing connection identity proof rejected", V({ connectionIdentityProof: undefined }) === "authority_missing_field:connectionIdentityProof");
  ok("F09 connection proof not bound to the client token rejected", V({ connectionToken: "OTHER-TOKEN" }) === "authority_connection_proof_client_unbound");
  ok("F10 missing restricted privilege proof rejected", V({ privilegeProof: undefined }) === "authority_missing_field:privilegeProof" && V({ privilegeProof: {} }) === "authority_privilege_proof_invalid");
  ok("F11 wrong (V1-shaped / tampered) registry rejected", V({ registry: { ...REG.buildV2RegistrySupply(), ceilings: "SELECT 1 FROM public.budget_sessions" } }).startsWith("authority_query_registry_"));
  ok("F12 wrong-phase source proof (pre-probe proof as the activation proof) rejected", V({ activationSourceProof: testPreProbeSourceProof() }) === "authority_source_proof_pre_probe_proof_is_not_an_activation_proof");
  ok("F13 legacy combined `sourcePin` field rejected (unexpected field)", V({ sourcePin: testPreProbeSourceProof() }) === "authority_unexpected_field:sourcePin");
  ok("F14 secret-bearing extra field rejected (providerApiKey)", V({ providerApiKey: "synthetic" }) === "authority_unexpected_field:providerApiKey");
  ok("F15 missing trusted clock rejected", V({ nowProvider: undefined }) === "authority_missing_field:nowProvider");
  ok("F16 activation proof with unresolved PIN-C rejected", V({ activationSourceProof: testActivationSourceProof({ step2Runtime: SRC.STEP2_RUNTIME_PIN_PLACEHOLDER }) }) === "authority_source_proof_step2_runtime_pin_required_after_preservation");
  // provisioner shape / behaviour
  const P = (x) => PA.acquireProductionAuthorityV2(x).then((r) => r.reason);
  ok("F17 provisioner must be frozen", (await P({ contract: PA.PROVISIONER_CONTRACT_V2, acquire: async () => ({}) })) === "provisioner_not_frozen");
  ok("F18 provisioner exact shape", (await P(Object.freeze({ contract: PA.PROVISIONER_CONTRACT_V2, acquire: async () => ({}), authority: {} }))) === "provisioner_shape_not_exact");
  ok("F19 provisioner contract", (await P(Object.freeze({ contract: "x", acquire: async () => ({}) }))) === "provisioner_contract_mismatch");
  ok("F20 provisioner throw ⇒ fail closed", (await P(Object.freeze({ contract: PA.PROVISIONER_CONTRACT_V2, acquire: async () => { throw new Error(["postgres", "//synthetic-user@synthetic-host"].join(":")); } }))) === "provisioner_acquire_failed");
  ok("F21 provisioner unavailable ⇒ sanitized reason, fail closed", (await P(Object.freeze({ contract: PA.PROVISIONER_CONTRACT_V2, acquire: async () => ({ available: false, reason: "not yet <x>" }) }))) === "provisioner_unavailable:notyetx");
  // caller cannot inject authority: the request never reaches the provisioner, extra request keys are refused before acquisition
  const spy = { calls: 0, argc: -1 };
  const comp = EXR.composeTrustedExecutorProductionV2(provisioner(synthAuthority(c), spy));
  const inj = await comp.run({ approvalEnvelope: ap.envelope, readerDbClient: c.reader });
  ok("F22 caller-supplied authority field in the request refused BEFORE acquisition", inj.reason === "production_rejects_caller_supplied_authority:readerDbClient" && spy.calls === 0);
  const comp2 = EXR.composeTrustedExecutorProductionV2(provisioner(synthAuthority(c), spy));
  const pr = await comp2.run({ approvalEnvelope: ap.envelope, suppliedEvidence: ap.suppliedEvidence, executionId: ap.executionId });
  ok("F23 production composition with a TEST authority ⇒ rejected by the production bar; acquire() called with NO arguments; zero activation",
    pr.ok === false && pr.stage === "production_authority" && pr.reason === "authority_rejects_test_fixture:executorDbClient" && spy.calls === 1 && spy.argc === 0 && c.state.activations === 0, pr);
  ok("F24 composing without a valid provisioner ⇒ unavailable", EXR.composeTrustedExecutorProductionV2(undefined).available === false && EXR.composeTrustedExecutorProductionV2({}).reason === "provisioner_not_frozen");
  ok("F25 test composition requires the explicit test boundary", EXR.composeTrustedExecutorTestV2(provisioner(synthAuthority(c))).available === false);
  const src = readFileSync(join(STEP2, "runtime/v2-production-authority.mjs"), "utf8").replace(/\/\/.*$/gm, "");
  ok("F26 no global mutable authority slot / setter / env authority blob in the authority module",
    !/^(let|var)\s/m.test(src) && !/export\s+(async\s+)?function\s+(set|register|inject|install|provide)\w*/i.test(src) && !/process\.env/.test(src) && !/JSON\.parse/.test(src));
}

// ═══════════ G / I — Phase A reaches the restricted activation seam with NO deployed gateway; one-shot ═══════════
{
  const c = makeClients(true);
  const auth = synthAuthority(c);
  ok("G00 the Phase-A authority contains no gateway deployment observation", !JSON.stringify(auth.activationSourceProof).includes("deployed_commit") && !("gatewayDeployment" in auth.activationSourceProof));
  const comp = EXR.composeTrustedExecutorTestV2(provisioner(auth), { testBoundary: true });
  const r = await comp.run({ approvalEnvelope: ap.envelope, suppliedEvidence: ap.suppliedEvidence, executionId: ap.executionId });
  ok("G01 Phase A + genuine (synthetic) approval + restricted executor ⇒ exactly ONE activate_catalog_v2, committed + correlated, BEFORE any gateway deployment",
    r.ok === true && r.stage === "V2_CATALOG_ACTIVATED_COMMITTED_AND_CORRELATED" && c.state.activations === 1 && c.state.ledger.length === 1, r);
  ok("G02 still NOT probe-ready after activation", r.probeReady === false && !JSON.stringify(r).includes("PROBE_READY"));
  const again = await comp.run({ approvalEnvelope: ap.envelope, suppliedEvidence: ap.suppliedEvidence, executionId: ap.executionId });
  ok("I01 the composed executor is one-shot (second run refused before acquisition)", again.reason === "composed_executor_is_one_shot" && c.state.activations === 1);
  const comp3 = EXR.composeTrustedExecutorTestV2(provisioner(synthAuthority(c)), { testBoundary: true });
  const r3 = await comp3.run({ approvalEnvelope: ap.envelope, suppliedEvidence: ap.suppliedEvidence, executionId: ap.executionId });
  ok("I02 a fresh composition cannot re-activate (process one-shot / replay) — no second mutation", r3.ok === false && c.state.activations === 1, r3.reason);
  const fresh = await import("../runtime/v2-trusted-activation-executor.mjs?lc=1");
  const common = { targetBinding: { resolvedPostgresServiceId: ID.TARGETS_V2.postgres, resolvedProjectId: ID.TARGETS_V2.project }, trustRoot: rv.trustRoot, approvalEnvelope: ap.envelope,
    suppliedEvidence: ap.suppliedEvidence, nowIso, executionId: ap.executionId, isConsumed: () => false, testBoundary: true };
  const { TEST_READSTATE_PROVENANCE_V2 } = await import("../runtime/v2-trusted-read-adapter.mjs");
  const obs = () => ({ railway: RAILWAY(), activationSourceProof: testActivationSourceProof(), db: DB(), preActivationState: STATES.pre(), counts: STATES.counts(), approvalConsumed: false, privilegeProof: { restricted_role_proof_present: true } });
  let n = 0;
  const amb = await fresh.runActivationV2({ ...common, readState: { provenance: TEST_READSTATE_PROVENANCE_V2, observe: obs }, restrictedDbActivate: async () => { n++; throw new Error("socket closed"); } });
  const amb2 = await fresh.runActivationV2({ ...common, readState: { provenance: TEST_READSTATE_PROVENANCE_V2, observe: obs }, restrictedDbActivate: async () => { n++; return { ok: true }; } });
  ok("I03 SQL 03 ambiguous mutation ⇒ uncertain, NO retry (second attempt refused before I/O)", amb.reason === "restricted_activation_ambiguous_no_retry" && amb.uncertain === true && amb2.reason === "executor_is_one_shot_already_ran" && n === 1);
  const pa = PF.runPreActivationV2({ railway: RAILWAY(), activationSourceProof: testActivationSourceProof(), db: DB(), nowIso, testBoundary: true, approvalEnvelope: ap.envelope, trustRoot: rv.trustRoot,
    suppliedEvidence: ap.suppliedEvidence, executionId: ap.executionId, isApprovalConsumed: () => false, preActivationState: STATES.pre(), counts: STATES.counts(), approvalConsumed: false, privilegeProof: { restricted_role_proof_present: true } });
  ok("G03 Phase A PASSES with no gateway observation injected at all", pa.pass === true, reasons(pa));
  const paBad = PF.runPreActivationV2({ railway: RAILWAY(), activationSourceProof: testActivationSourceProof({ derivationBase: { commit: B.commit, tree: B.tree } }), db: DB(), nowIso, testBoundary: true, approvalEnvelope: ap.envelope, trustRoot: rv.trustRoot,
    suppliedEvidence: ap.suppliedEvidence, executionId: ap.executionId, isApprovalConsumed: () => false, preActivationState: STATES.pre(), counts: STATES.counts(), approvalConsumed: false, privilegeProof: { restricted_role_proof_present: true } });
  ok("G04 Phase A still fails closed on a wrong PIN A", reasons(paBad).includes("derivation_base_rewritten"));
  const paNoAppr = PF.runPreActivationV2({ railway: RAILWAY(), activationSourceProof: testActivationSourceProof(), db: DB(), nowIso, testBoundary: true, approvalEnvelope: makeApproval(makeReviewer(), { nowMs: NOW }).envelope, trustRoot: rv.trustRoot,
    suppliedEvidence: ap.suppliedEvidence, executionId: ap.executionId, isApprovalConsumed: () => false, preActivationState: STATES.pre(), counts: STATES.counts(), approvalConsumed: false, privilegeProof: { restricted_role_proof_present: true } });
  ok("G05 Phase A still requires the genuine pinned-reviewer approval", reasons(paNoAppr).includes("envelope_fingerprint_not_pinned_trust_root"));
}

// ═══════════ H — Phase B refuses until a deployed-gateway proof exists ═══════════
{
  const cf = consumedFixture(ap, iso(NOW - 60e3));
  const phaseB = (o) => { try { return PF.runPreflightV2({ railway: RAILWAY(), db: DB(), nowIso, testBoundary: true, approvalEnvelope: ap.envelope, trustRoot: rv.trustRoot,
    suppliedEvidence: ap.suppliedEvidence, executionId: ap.executionId, ...cf, armedState: STATES.armed(), oneCallPolicy: STATES.ceilings(), counts: STATES.counts(), ...phaseBGates(), ...o }); }
    catch (e) { return { pass: false, failures: [{ reason: "refused:" + e.message }] }; } };
  const s = phaseB({ preProbeSourceProof: testActivationSourceProof() });
  ok("H01 Phase B with only the static (activation) proof ⇒ NO receipt", !s.pass && !s.receipt && reasons(s).includes("static_gateway_proof_cannot_satisfy_pre_probe"), reasons(s));
  const a = phaseB({});
  ok("H02 Phase B with no source proof at all ⇒ refused, NO receipt", !a.pass && !a.receipt, reasons(a));
  const u = phaseB({ preProbeSourceProof: testPreProbeSourceProof({ gatewayDeployment: testDeployedGateway({ healthy: false }) }) });
  ok("H03 Phase B with an UNHEALTHY deployed gateway ⇒ NO receipt", !u.pass && !u.receipt && reasons(u).includes("deployed_gateway_not_healthy"));
  const w = phaseB({ preProbeSourceProof: testPreProbeSourceProof({ gatewayDeployment: testDeployedGateway({ deployed_commit: SRC.SUPERSEDED_GATEWAY_SOURCE_V1.commit }) }) });
  ok("H04 Phase B with the superseded V1 gateway deployed ⇒ NO receipt", !w.pass && !w.receipt && reasons(w).includes("superseded_gateway_source_2b69ce_rejected"));
  const g = phaseB({ preProbeSourceProof: testPreProbeSourceProof() });
  ok("H05 Phase B with the independent healthy deployed PIN-B observation ⇒ receipt bound to PIN B + the resolved PIN C", g.pass === true && g.receipt && g.receipt.identity.gateway_source.commit === B.commit
    && g.receipt.identity.step2_runtime.runtime_manifest_digest === SRC.measureRuntimeManifest().digest, reasons(g));
  const ra = { cfg: { ok: true, reviewer: { pinnedFingerprint: rv.fp }, targets: { pgServiceId: ID.TARGETS_V2.postgres } }, trustRoot: rv.trustRoot,
    readerDbClient: { __testFixture: true, statementTimeoutMs: 2000, async query() { return { rows: [] }; } }, connectionIdentityProof: testConnectionProof(), expectedIssuer: "TEST-ISSUER", connectionToken: "TEST-TOKEN",
    readerPrivilegeProof: { provenance: "TEST-ONLY-reader-privilege-proof", role: "live_ai_03b_reader", pgServiceId: ID.TARGETS_V2.postgres, effectiveSelectOnly: true, writePrivilegeCount: 0, selectGrantCount: 12, forbiddenObjectAccessible: false, unapprovedRoleMembership: false, unapprovedRoutineAuthority: false, boundReaderToken: "TEST-TOKEN", issuedAtMs: Date.now() },
    registry: REG.buildV2RegistrySupply(), nowProvider: () => Date.now() };
  ok("H06 V2 reader host is NOT weakened: a static (activation) proof is refused", validateReaderOnlyAuthorityV2({ ...ra, sourcePin: testActivationSourceProof() }, { testBoundary: true }).reason === "source_pin_static_gateway_proof_cannot_satisfy_pre_probe"
    && validateReaderOnlyAuthorityV2({ ...ra, sourcePin: testPreProbeSourceProof() }, { testBoundary: true }).ok === true);
  const rs = await startProductionReaderServiceV2({ mode: "offline-test", offlineTestBoundary: true, trustRootConfig: {}, physicalFactory: { open: async () => { throw new Error("must not connect"); } },
    attestationSource: {}, sourcePin: testActivationSourceProof(), listen: { mode: "loopback-tcp", host: "127.0.0.1", port: 1 }, transportSecretProvider: async () => "x".repeat(40), tickMs: 0, log: () => {} });
  ok("H07 V2 reader entrypoint with a static proof refuses before any DB/attester contact", rs.started === false && /static_gateway_proof_cannot_satisfy_pre_probe|unprovisioned|trust/.test(String(rs.reason)), rs.reason);
}

// ═══════════ P — PIN-C preservation model on the REAL repository lineage (read-only git + working-tree overlay) ═══════════
{
  const blobSha1 = (buf) => createHash("sha1").update(Buffer.concat([Buffer.from(`blob ${buf.length}\0`), buf])).digest("hex");
  const at3fda = new Map(git("ls-tree", "-r", M5.commit, "--", SRC.STEP2_DIR).split("\n").filter(Boolean).map((l) => { const [meta, p] = l.split("\t"); return [p, meta.split(" ")[2]]; }));
  const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
  const work = new Map(walk(STEP2).map((p) => [relative(REPO, p).split("\\").join("/"), blobSha1(readFileSync(p))]));
  const s3 = [];
  for (const [p, h] of work) { if (!at3fda.has(p)) s3.push({ status: "A", path: p }); else if (at3fda.get(p) !== h) s3.push({ status: "M", path: p }); }
  for (const p of at3fda.keys()) if (!work.has(p)) s3.push({ status: "D", path: p });
  const real = makeGit(REPO);
  const X = "c0ffee00c0ffee00c0ffee00c0ffee00c0ffee00";
  const overlay = (extra = []) => ({
    revParse: (x) => (x === `${X}^{commit}` ? X : x === `${X}^{tree}` ? "3".repeat(40) : x === `${X}:${SRC.STEP2_DIR}` ? "4".repeat(40) : real.revParse(x)),
    isAncestor: (a, b) => (b === X ? a === M5.commit || real.isAncestor(a, M5.commit) : real.isAncestor(a, b)),
    diffNameStatus: (a, b) => (b === X ? [...s3, ...extra] : real.diffNameStatus(a, b)),
    blobBytes: (rev, p) => (rev === X ? readFileSync(join(REPO, p)) : real.blobBytes(rev, p)),
  });
  const v = verifyStep2Preservation(overlay(), X);
  ok("P01 real lineage: S1 = 108 historical Step-2 additions, S2 = 63 accepted M5 changes retained (0 Step-2), S3 = this correction (Step-2 only, no deletion) ⇒ V2 binding",
    v.ok === true && v.lineage.s1_historical_additions === 108 && v.lineage.s2_m5_changes_retained === 63 && v.lineage.s3_step2_correction_changes === s3.length && s3.every((c) => c.status !== "D"), v);
  ok("P02 the emitted binding carries the corrected manifest + lineage and verifies (trusted)", v.ok && SRC.verifyStep2RuntimePin(v.binding).ok === true && v.binding.correction_base === M5.commit && v.binding.historical_pin_c === H.commit);
  ok("P03 an M5 file touched by the correction segment ⇒ fail", verifyStep2Preservation(overlay([{ status: "M", path: `${M5.path_prefixes[0]}README.md` }]), X).reason.startsWith("s3_non_step2_path_changed"));
  ok("P04 the historical PIN C itself ⇒ refused", verifyStep2Preservation(real, H.commit).reason === "historical_pin_c_cannot_authorize_corrected_runtime");
  ok("P05 the uncorrected baseline 3fda6af1 ⇒ refused", verifyStep2Preservation(real, M5.commit).reason === "commit_is_the_uncorrected_baseline");
  ok("P06 real git confirms: 3fda6af1 parent = f5ec5807; Step-2 dir tree unchanged across the M5 closure", git("rev-parse", `${M5.commit}^1`).trim() === H.commit
    && git("rev-parse", `${M5.commit}:${SRC.STEP2_DIR}`).trim() === H.step2_dir_tree && git("rev-parse", `${H.commit}:${SRC.STEP2_DIR}`).trim() === H.step2_dir_tree);
  ok("P07 corrected runtime manifest ≠ historical 9a460078…", SRC.measureRuntimeManifest().digest !== H.runtime_manifest_digest);
}

// ═══════════ J / K — no provider / network / DB / Railway access ═══════════
ok("J01 no provider/network call: fetch=0 http(s)=0 socket connects=0", G_COUNTS.fetch === 0 && G_COUNTS.http === 0 && G_COUNTS.socket === 0, G_COUNTS);
const bad = SPAWNS.filter((s) => !((s.cmd === "git" && READONLY_GIT.has(s.verb)) || s.cmd === "tar"));
ok("K01 only local read-only git (+ local tar extract to a temp dir) was spawned — no railway / psql / curl / network tool", bad.length === 0 && SPAWNS.some((s) => s.cmd === "git"), bad);
done();
