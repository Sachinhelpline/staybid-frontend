// M7 V2 PRODUCTION AUTHORITY PROVISIONING — focused OFFLINE suite (A–K). Synthetic keys / ids / in-memory connections
// only. Connects to NOTHING: fetch / http(s) / sockets are trapped and counted; every child process is recorded (only
// local read-only git is permitted — PIN-C re-derivation). No real credential, no approval signing by a real key.
import { readFileSync, readdirSync } from "node:fs";
import { generateKeyPairSync } from "node:crypto";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import cp from "node:child_process";
import net from "node:net";
import http from "node:http";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";

const COUNTS = { fetch: 0, http: 0, socket: 0 };
const SPAWNS = [];
globalThis.fetch = async () => { COUNTS.fetch++; throw new Error("network_forbidden_in_offline_suite"); };
for (const m of [http, https]) { m.request = () => { COUNTS.http++; throw new Error("network_forbidden_in_offline_suite"); }; m.get = m.request; }
net.Socket.prototype.connect = function () { COUNTS.socket++; throw new Error("network_forbidden_in_offline_suite"); };
const READONLY_GIT = new Set(["rev-parse", "merge-base", "diff", "cat-file", "ls-tree", "show"]);
for (const fn of ["execFileSync", "spawnSync", "execSync", "spawn", "execFile", "exec"]) {
  const orig = cp[fn];
  cp[fn] = function (cmd, args, ...rest) {
    const argv = Array.isArray(args) ? args : [];
    const ci = argv.indexOf("-C"); const verb = cmd === "git" ? argv.filter((x, i) => !x.startsWith("-") && i !== ci + 1)[0] : null;
    SPAWNS.push({ cmd: String(cmd), verb });
    return orig.call(this, cmd, args, ...rest);
  };
}
syncBuiltinESMExports();

const H = await import("./helpers.mjs");
const S2H = await import("../../m7-step2-runtime-rebinding-offline-01/tests/helpers.mjs");
const SRC = await import("../../m7-step2-runtime-rebinding-offline-01/identity/v2-source-identity.mjs");
const REG = await import("../../m7-step2-runtime-rebinding-offline-01/runtime/v2-query-registry.mjs");
const PA = await import("../../m7-step2-runtime-rebinding-offline-01/runtime/v2-production-authority.mjs");
const { ACTIVATE_SQL_V2, RESTORE_SQL_V2 } = await import("../../m7-step2-runtime-rebinding-offline-01/runtime/v2-restricted-activation-adapter.mjs");
const { verifyConnectionTargetBinding, CONNECTION_IDENTITY_PROOF_CONTRACT } = await import("../../trusted-executor-runtime-01/db-target-binding.mjs");
const { buildReviewedStateQueries: V1_buildQueries } = await import("../../trusted-runtime-live-binding-offline-01/production-read-queries.mjs");
const { establishReaderSession } = await import("../../private-reader-production-integration-offline-01/reader-session.mjs");
const { makeAttesterTrustRoot } = await import("../../private-reader-production-integration-offline-01/reader-attestation.mjs");
const CFG = await import("../src/provisioning-config.mjs");
const { loadReviewerTrustRootV2 } = await import("../src/reviewer-trust-root.mjs");
const CLK = await import("../src/trusted-clock.mjs");
const EXS = await import("../src/executor-session.mjs");
const EXA = await import("../src/executor-attestation.mjs");
const RB = await import("../src/role-binding.mjs");
const GC = await import("../src/guarded-clients.mjs");
const AS = await import("../src/activation-source.mjs");
const PV = await import("../src/provisioner.mjs");
const EP = await import("../src/production-entrypoint.mjs");

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = resolve(HERE, "..");
const REPO = resolve(PKG, "../../..");
const { ok, done } = H.makeRunner("m7-v2-authority-provisioning");
const reviewer = S2H.makeReviewer();
const NOW = Date.now();
const ap = S2H.makeApproval(reviewer, { nowMs: NOW, approvalId: "m7ap-approval-0001", executionId: "m7ap-exec-0001" });
const REQ = () => ({ approvalEnvelope: ap.envelope, suppliedEvidence: ap.suppliedEvidence, executionId: ap.executionId });
const exAtt = H.makeTestAttester("TEST-ONLY-executor-attester");
const rdAtt = H.makeTestAttester("TEST-ONLY-reader-attester");
const ENV = H.testProvisioningEnv(reviewer, exAtt, rdAtt);
// a NON-test, production-shaped environment (ops issuers, private *.railway.internal destinations, synthetic values)
const PROD_ENV = { ...H.testProvisioningEnv(reviewer, H.makeTestAttester("ops-executor-attester"), H.makeTestAttester("ops-reader-attester")),
  [CFG.EXECUTOR_ATTESTER_ENV.host]: "executor-attester.railway.internal", [CFG.READER_ATTESTER_ENV.host]: "live-ai-03b-reader-attester.railway.internal" };
const PC = CFG.loadProvisioningConfig(ENV, { testBoundary: true });
const RT = loadReviewerTrustRootV2(PC.cfg);
const SP = AS.testActivationSourceProofV2(H.testPinC(), { testBoundary: true });
ok("SETUP config / reviewer trust root / test source proof", PC.ok === true && RT.ok === true && SP.ok === true, { PC: PC.reason, RT: RT.reason, SP: SP.reason });

/** Fresh TEST composition dependencies (new in-memory connections every call). */
function mkDeps(o = {}) {
  const state = o.state || { mode: "pre", ledger: [], activations: 0 };
  const exP = o.exPhys || H.makeFakePhysical("live_ai_03b_executor", { state, ...(o.exOpts || {}) });
  const rdP = o.rdPhys || H.makeFakePhysical("live_ai_03b_reader", { state, ...(o.rdOpts || {}) });
  const spy = { ex: {}, rd: {} };
  const clockMs = () => Date.now();
  return {
    state, exP, rdP, spy,
    deps: {
      provisioningConfig: o.pc || PC, reviewerTrustRoot: o.rt || RT.trustRoot, activationSourceProof: o.sp || SP.proof,
      clock: o.clock || CLK.makeTestClock(clockMs, { testBoundary: true }),
      executorPhysicalFactory: o.exFactory || H.factoryOf(exP, spy.ex), readerPhysicalFactory: o.rdFactory || H.factoryOf(rdP, spy.rd),
      executorAttestationSource: o.exSrc || H.makeTestSource(exAtt, clockMs, o.exSrcOpts), readerAttestationSource: o.rdSrc || H.makeTestSource(rdAtt, clockMs, o.rdSrcOpts),
      ...(o.extraDeps || {}),
    },
  };
}
const acquireWith = async (o) => { const m = mkDeps(o); const p = PV.createAuthorityProvisionerV2(m.deps, { testBoundary: true }); if (!p.ok) return { r: { available: false, reason: p.reason }, m }; return { r: await p.provisioner.acquire(), m, p }; };

// ═══════════ A — default fail closed ═══════════
{
  const u = await PA.acquireProductionAuthorityV2();
  ok("A01 no provisioner ⇒ v2_production_authority_unprovisioned (preserved default)", u.available === false && u.reason === "v2_production_authority_unprovisioned");
  const e0 = await EP.composeProductionActivationBoundaryV2({ env: {} });
  ok("A02 production entrypoint with an empty environment ⇒ unavailable (no implicit fallback)", e0.available === false && /runtime_config_v2_/.test(e0.reason), e0.reason);
  ok("A03 production entrypoint refuses injected composition inputs", (await EP.composeProductionActivationBoundaryV2({ env: {}, executorPhysicalFactory: {} })).reason === "production_entrypoint_rejects_injection");
  // (Step 10) a complete, NON-test production-shaped environment now COMPOSES — the executor source is the reviewed
  // executor-attester channel adapter — and composing opens NO connection (the boundary is NOT run offline: its
  // first I/O would be the executor DB connection inside the provisioner's acquire()).
  const sock0 = COUNTS.socket;
  const e1 = await EP.composeProductionActivationBoundaryV2({ env: PROD_ENV, repoRoot: REPO });
  ok("A04 full production-shaped env: config ✓ reviewer root ✓ PIN C re-derived from git ✓ executor source BOUND ✓ ⇒ production boundary composed, 0 socket connects", e1.available === true && e1.mode === "production" && typeof e1.run === "function" && COUNTS.socket === sock0, e1.reason);
  const e1u = await EP.composeProductionActivationBoundaryV2({ env: { ...PROD_ENV, [CFG.EXECUTOR_ATTESTER_ENV.channelSecret]: "" }, repoRoot: REPO });
  ok("A05 an unavailable boundary (executor channel secret absent) never runs", e1u.available === false && (await e1u.run(REQ())).ok === false, e1u.reason);
  const a6 = await EP.acquireExecutorAttestationSourceV2();
  ok("A06 executor attestation source acquisition WITHOUT the trusted composition inputs fails closed (fixed reason, no source) — never the retired unprovisioned default", a6.available === false && a6.reason === "executor_attestation_source_inputs_invalid" && !("source" in a6), a6);
  // production mode refuses TEST composition dependencies before any connection
  const m = mkDeps();
  const pp = PV.createAuthorityProvisionerV2(m.deps, { testBoundary: false });
  ok("A07 production provisioner refuses TEST-ONLY attester trust roots / test clock / test source proof (no production authority from test fixtures)", pp.ok === false && m.spy.ex.opens === undefined, pp.reason);
  const tm = await acquireWith({});
  ok("A08 a TEST-built authority is REJECTED by the preserved production validator", tm.r.available === true && PA.validateProvisionedAuthorityV2(tm.r.authority).ok === false);
  ok("A09 production entrypoint CLI is fail-closed (exit 2, no request intake)", cp.spawnSync(process.execPath, [join(PKG, "src/production-entrypoint.mjs")], { encoding: "utf8" }).status === 2);
}

// ═══════════ X — Step 10: authority binding to the reviewed executor-attester channel ═══════════
{
  const EXN = CFG.EXECUTOR_ATTESTER_ENV, RDN = CFG.READER_ATTESTER_ENV;
  const PPC = CFG.loadProvisioningConfig(PROD_ENV, { testBoundary: false });
  const acq = (env, pc = PPC) => EP.acquireExecutorAttestationSourceV2({ provisioningConfig: pc, env });
  const compose = (env, extra = {}) => EP.composeProductionActivationBoundaryV2({ env, repoRoot: REPO, ...extra });
  const sock0 = COUNTS.socket;
  // 1 + 2 — valid production config ⇒ the reviewed adapter; destination only from the validated env NAMES
  const s1 = await acq(PROD_ENV);
  ok("X01 production-shaped config ⇒ executor source constructed = the reviewed executor-attestation-channel-v1 adapter (no DB connection, no request)",
    PPC.ok === true && s1.available === true && s1.source.version === "executor-attestation-channel-v1" && typeof s1.source.obtain === "function" && Object.isFrozen(s1) && COUNTS.socket === sock0, s1.reason);
  ok("X02 destination is EXACTLY LIVE_AI_03B_EXECUTOR_ATTESTER_HOST / _PORT (= provisioningConfig.executorAttester.channel), never the reader destination",
    s1.source.destination.host === PROD_ENV[EXN.host] && s1.source.destination.port === Number(PROD_ENV[EXN.port]) && s1.source.destination.host === PPC.executorAttester.channel.host
    && PPC.executorAttester.channel.channelSecretEnvName === EXN.channelSecret && s1.source.destination.host !== PROD_ENV[RDN.host] && s1.source.destination.port !== Number(PROD_ENV[RDN.port]), s1.source.destination);
  const ign = await acq({ ...PROD_ENV, LIVE_AI_03B_EXECUTOR_ATTESTER_URL: "http://attacker.example", LIVE_AI_03B_EXECUTOR_ATTESTER_SOURCE: "reader" });
  ok("X02b unrelated look-alike env names cannot redirect the destination (only the six reviewed EXECUTOR_ATTESTER_ENV names are read)", ign.available === true && ign.source.destination.host === PROD_ENV[EXN.host]);
  ok("X02c a validated config whose destination does not equal the env it is paired with ⇒ refused (host)", (await acq({ ...PROD_ENV, [EXN.host]: "other-attester.railway.internal" })).reason === "executor_attestation_source_destination_mismatch");
  ok("X02d …(port)", (await acq({ ...PROD_ENV, [EXN.port]: "7199" })).reason === "executor_attestation_source_destination_mismatch");
  const crafted = { ...PPC, executorAttester: { ...PPC.executorAttester, channel: { ...PPC.executorAttester.channel, host: "attacker-attester.railway.internal" } } };
  ok("X02e a crafted provisioning config (destination swapped) ⇒ refused before construction", (await acq(PROD_ENV, crafted)).reason === "executor_attestation_source_destination_mismatch");
  const swapped = { ...PPC, executorAttester: { ...PPC.executorAttester, channel: { ...PPC.executorAttester.channel, channelSecretEnvName: RDN.channelSecret } } };
  ok("X02f a config naming the READER channel-secret env for the executor ⇒ refused", (await acq(PROD_ENV, swapped)).reason === "executor_attestation_source_config_invalid");
  ok("X02g a config that is not a loadProvisioningConfig result (version / ok) ⇒ refused", (await acq(PROD_ENV, { ...PPC, version: "x" })).reason === "executor_attestation_source_config_invalid"
    && (await acq(PROD_ENV, { ...PPC, ok: false })).reason === "executor_attestation_source_config_invalid");
  // 3 — missing host / port / channel secret ⇒ fixed reasons, fail closed
  for (const k of ["host", "port", "channelSecret"]) {
    const env = { ...PROD_ENV }; delete env[EXN[k]];
    const c = await compose(env);
    ok(`X03 compose with ${EXN[k]} absent ⇒ fail closed (executor_attester_config_incomplete), 0 connections`, c.available === false && c.reason === "executor_attester_config_incomplete" && COUNTS.socket === sock0, c.reason);
  }
  { const env = { ...PROD_ENV }; delete env[EXN.channelSecret]; ok("X03b direct acquisition with the executor channel secret absent ⇒ executor_attestation_source_channel_secret_absent", (await acq(env)).reason === "executor_attestation_source_channel_secret_absent"); }
  { const env = { ...PROD_ENV }; delete env[RDN.channelSecret]; ok("X03c direct acquisition with the reader channel secret absent ⇒ refused (the executor ≠ reader secret check can never be skipped)", (await acq(env)).reason === "executor_attestation_source_reader_channel_secret_absent"); }
  for (const [k, v, re] of [["port", "abc", /^executor_attester_destination_port$/], ["port", "70000", /^executor_attester_destination_port$/], ["channelSecret", "short-secret", /^executor_attester_channel_secret_invalid$/]]) {
    const c = await compose({ ...PROD_ENV, [EXN[k]]: v });
    ok(`X03d malformed ${EXN[k]}=${JSON.stringify(v)} ⇒ fail closed with a fixed bounded reason`, c.available === false && re.test(c.reason), c.reason);
  }
  // 4 — public / loopback destination refused outside the test boundary (config layer AND the adapter itself)
  for (const [h, why] of [["8.8.8.8", "destination_not_private"], ["127.0.0.1", "destination_loopback"], ["executor-attester.example.com", "destination_not_private_dns"]]) {
    const c = await compose({ ...PROD_ENV, [EXN.host]: h });
    ok(`X04 production executor destination ${h} ⇒ refused (executor_attester_${why})`, c.available === false && c.reason === "executor_attester_" + why, c.reason);
  }
  { const lenv = { ...PROD_ENV, [EXN.host]: "127.0.0.1" }; const tpc = CFG.loadProvisioningConfig(lenv, { testBoundary: true }); const r = await acq(lenv, tpc);
    ok("X04b a loopback destination that passed only the TEST-boundary config is still refused by the reviewed adapter in production mode", tpc.ok === true && r.available === false && r.reason === "executor_attester_destination_loopback", r); }
  // 5 — executor secret equal to reader secret
  { const same = { ...PROD_ENV, [RDN.channelSecret]: PROD_ENV[EXN.channelSecret] };
    const c = await compose(same);
    ok("X05 compose with executor channel secret == reader channel secret ⇒ refused", c.available === false && c.reason === "attester_channel_secret_reused", c.reason);
    ok("X05b …and the reviewed adapter's own independent check refuses it too (executor_attester_channel_secret_reuses_reader)", (await acq(same)).reason === "executor_attester_channel_secret_reuses_reader"); }
  // 6 — the caller cannot inject or replace the executor source
  for (const k of ["executorAttestationSource", "readerAttestationSource", "source", "host", "port", "channelSecret", "trustRoot", "executorAttester", "provisioner", "provisioningConfig", "clock", "dbUrl", "fingerprint", "issuer"]) {
    const c = await compose(PROD_ENV, { [k]: { obtain: async () => ({}) } });
    ok(`X06 production composition refuses a caller-supplied ${k} (production_entrypoint_rejects_injection)`, c.available === false && c.reason === "production_entrypoint_rejects_injection");
  }
  ok("X06b the acquisition refuses any extra input key (e.g. a caller source / host / secret)", (await EP.acquireExecutorAttestationSourceV2({ provisioningConfig: PPC, env: PROD_ENV, source: { obtain() {} } })).reason === "executor_attestation_source_inputs_invalid"
    && (await EP.acquireExecutorAttestationSourceV2({ provisioningConfig: PPC, env: PROD_ENV, host: "x.railway.internal" })).reason === "executor_attestation_source_inputs_invalid"
    && (await EP.acquireExecutorAttestationSourceV2([PPC, PROD_ENV])).reason === "executor_attestation_source_inputs_invalid");
  ok("X06c the entrypoint exposes no setter / override for the executor source", Object.keys(EP).sort().join() === "ENTRYPOINT_VERSION,acquireExecutorAttestationSourceV2,composeActivationBoundaryForTestV2,composeProductionActivationBoundaryV2", Object.keys(EP));
  for (const k of ["executorAttestationSource", "readerAttestationSource", "channelSecret", "host", "issuer", "fingerprint", "source"]) {
    const m = mkDeps();
    const r = await EP.composeActivationBoundaryForTestV2(m.deps, { testBoundary: true }).run({ ...REQ(), [k]: { x: 1 } });
    ok(`X06d an activation REQUEST carrying ${k} ⇒ refused before acquisition (0 connections, 0 attestation requests)`, r.ok === false && m.spy.ex.opens === undefined && m.spy.rd.opens === undefined
      && m.deps.executorAttestationSource.calls.length === 0 && m.deps.readerAttestationSource.calls.length === 0, r.reason);
  }
  // 7 — composition performs no DB connection and no channel request; the bound source is the reviewed protocol
  ok("X07 all Step-10 compositions above: 0 socket connects (no DB connection, no attester request)", COUNTS.socket === sock0, COUNTS);
  let x7; try { await s1.source.obtain({ contract: "AiStagingExecutorAttestationV1", role: "live_ai_03b_executor", connectionToken: "not-hex", requestNonce: "x" }); x7 = "no-throw"; } catch (e) { x7 = e.code; }
  ok("X07b the bound source enforces the reviewed request shape BEFORE any I/O (executor_attester_request_invalid, still 0 sockets)", x7 === "executor_attester_request_invalid" && COUNTS.socket === sock0, x7);
  // 8 — rejected executor configuration never falls back to the reader source
  { const env = { ...PROD_ENV, [EXN.host]: "8.8.8.8" };
    const c = await compose(env), d = await acq({ ...PROD_ENV, [EXN.channelSecret]: "" });
    ok("X08 rejected executor config ⇒ unavailable with an EXECUTOR reason (no reader-source fallback, no source returned)", c.available === false && /^executor_/.test(c.reason) && d.available === false && !("source" in d) && /^executor_/.test(d.reason), { c: c.reason, d: d.reason });
    const rd = CFG.loadProvisioningConfig(PROD_ENV, { testBoundary: false }).readerAttester.channel;
    ok("X08b a valid executor source never aliases the reader destination or the reader secret", !(s1.source.destination.host === rd.host && s1.source.destination.port === rd.port) && PROD_ENV[EXN.channelSecret] !== PROD_ENV[RDN.channelSecret]); }
  // 9 — production CLI stays fail-closed even with a complete production-shaped env and a request on argv/stdin
  { const r = cp.spawnSync(process.execPath, [join(PKG, "src/production-entrypoint.mjs"), JSON.stringify(REQ())], { encoding: "utf8", env: { PATH: process.env.PATH, ...PROD_ENV }, input: JSON.stringify(REQ()) });
    ok("X09 production CLI with a full production env + a request on argv/stdin ⇒ exit 2, fail-closed, no request intake", r.status === 2 && /FAIL-CLOSED/.test(r.stderr) && r.stdout === "", r.status); }
  // static: the binding imports the reviewed adapter (no protocol duplication) and reads env only through validated names
  { const src = readFileSync(join(PKG, "src/production-entrypoint.mjs"), "utf8");
    ok("X10 production-entrypoint imports createExecutorAttestationSourceChannel from the preserved issuer package and does not re-implement the channel (no net / HMAC / wire in this package)",
      /import \{ createExecutorAttestationSourceChannel \} from "\.\.\/\.\.\/m7-v2-executor-attester-issuer-offline-01\/src\/executor-attestation-channel\.mjs";/.test(src)
      && readdirSync(join(PKG, "src")).every((f) => !/from\s+"node:net"|createHmac|executorChannelMac|attest-executor/.test(readFileSync(join(PKG, "src", f), "utf8"))));
    ok("X10b the executor source is built in PRODUCTION mode only (offlineTestBoundary:false literal; no test flag reaches it)", /createExecutorAttestationSourceChannel\(\{ host: ch\.host, port: ch\.port, channelSecret, readerChannelSecret \}, \{ offlineTestBoundary: false \}\)/.test(src) && !/offlineTestBoundary: (true|testBoundary|opts)/.test(src));
    ok("X10c lifecycle order preserved: config → reviewer root → PIN C → EXECUTOR source → reader source → factories/clock → provisioner → preserved runtime",
      (() => { const i = ["loadProvisioningConfig(env", "loadReviewerTrustRootV2(pc.cfg)", "productionActivationSourceProofV2(", "acquireExecutorAttestationSourceV2({ provisioningConfig: pc, env })", "createAttestationSourceChannel({", "createAuthorityProvisionerV2({", "composeTrustedExecutorProductionV2(prov.provisioner)"].map((t) => src.indexOf(t, src.indexOf("export async function composeProductionActivationBoundaryV2"))); return i.every((x) => x > 0) && i.every((x, j) => j === 0 || x > i[j - 1]); })()); }
}

// ═══════════ B — the activation request is untrusted ═══════════
for (const k of ["executorDbClient", "readerDbClient", "authority", "dbUrl", "password", "trustRoot", "connectionIdentityProof", "privilegeProof", "registry", "activationSourceProof", "nowProvider", "nowIso", "provisioner"]) {
  const m = mkDeps();
  const b = EP.composeActivationBoundaryForTestV2(m.deps, { testBoundary: true });
  const r = await b.run({ ...REQ(), [k]: { x: 1 } });
  ok(`B ${k} in the request ⇒ refused before acquisition (0 connections)`, r.ok === false && r.reason === "production_rejects_caller_supplied_authority:" + k && m.spy.ex.opens === undefined && m.spy.rd.opens === undefined, r.reason);
}

// ═══════════ C — two DISTINCT restricted clients, independently bound ═══════════
{
  const t = await acquireWith({});
  const a = t.r.authority;
  ok("C01 acquire ⇒ exact frozen authority; executor and reader are DIFFERENT client objects", t.r.available === true && a.executorDbClient !== a.readerDbClient
    && Object.keys(a).sort().join() === [...PA.REQUIRED_AUTHORITY_FIELDS_V2].sort().join(), t.r.reason);
  ok("C02 the frozen single proof slot carries the EXECUTOR binding (token of the executor connection)", a.connectionIdentityProof.boundConnectionToken === a.connectionToken && t.m.exP.log.some((s) => s === EXS.EXECUTOR_LIFECYCLE_SQL.readIdentity));
  ok("C03 two attestations were requested: one executor, one reader, different tokens + nonces", (() => {
    const e = t.m.deps.executorAttestationSource.calls[0], r = t.m.deps.readerAttestationSource.calls[0];
    return e.role === "live_ai_03b_executor" && r.role === "live_ai_03b_reader" && e.connectionToken !== r.connectionToken && e.requestNonce !== r.requestNonce && e.contract !== r.contract;
  })());
  ok("C04 same physical factory object for both roles refused", PV.createAuthorityProvisionerV2(mkDeps({ rdFactory: undefined, exFactory: undefined }).deps, { testBoundary: true }).ok === true
    && (() => { const m = mkDeps(); const f = m.deps.executorPhysicalFactory; return PV.createAuthorityProvisionerV2({ ...m.deps, readerPhysicalFactory: f }, { testBoundary: true }).reason === "executor_and_reader_share_a_physical_factory"; })());
  const same = H.makeFakePhysical("live_ai_03b_executor");
  const s2 = await acquireWith({ exFactory: H.factoryOf(same), rdFactory: H.factoryOf(same) });
  ok("C05 one physical connection offered for both roles refused", s2.r.reason === "executor_and_reader_share_a_physical_connection" && same.closed === true, s2.r.reason);
  ok("C06 one credential for both roles refused (distinct credential identities)", CFG.loadProvisioningConfig({ ...ENV, LIVE_AI_03B_TRUSTED_READER_DB_URL: ENV.LIVE_AI_03B_TRUSTED_EXECUTOR_DB_URL }, { testBoundary: true }).reason === "executor_and_reader_share_a_credential");
  ok("C07 reader connection that is really the executor role refused", (await acquireWith({ rdOpts: { currentUser: "live_ai_03b_executor" } })).r.reason === "reader_session_role_not_reader");
  ok("C08 executor connection that is really the reader role refused", (await acquireWith({ exOpts: { currentUser: "live_ai_03b_reader" } })).r.reason === "executor_session_role_not_executor");
  ok("C09 superuser/owner login as executor refused", (await acquireWith({ exOpts: { currentUser: "postgres" } })).r.reason === "executor_session_role_not_executor");
  // swapped / replayed proofs, at the binding level
  const exPh = H.makeFakePhysical("live_ai_03b_executor"), rdPh = H.makeFakePhysical("live_ai_03b_reader");
  const exSess = (await EXS.establishExecutorSession(exPh, { statementTimeoutMs: 10000 })).session;
  const rdSess = (await establishReaderSession(rdPh, { statementTimeoutMs: 2000 })).session;
  const now = Date.now();
  const exEnv = exAtt.envelope({ contract: EXA.EXECUTOR_ATTESTATION_CONTRACT, connectionToken: exSess.token, role: "live_ai_03b_executor", requestNonce: "a".repeat(32) }, now);
  const rdEnv = rdAtt.envelope({ contract: RB.READER_ATTESTATION_CONTRACT, connectionToken: rdSess.token, role: "live_ai_03b_reader", requestNonce: "b".repeat(32) }, now);
  const exOk = RB.bindExecutorConnection({ session: exSess, envelope: exEnv, trustRoot: PC.executorAttester.trustRoot, requestNonce: "a".repeat(32), nowMs: now, testBoundary: true });
  const rdOk = RB.bindReaderConnection({ session: rdSess, envelope: rdEnv, trustRoot: PC.readerAttester.trustRoot, requestNonce: "b".repeat(32), nowMs: now, testBoundary: true });
  ok("C10 independent bindings: both pass and are pairwise distinct", exOk.ok && rdOk.ok && RB.checkDistinctBindings(exOk.binding, rdOk.binding).ok);
  const exForRd = exAtt.envelope({ contract: EXA.EXECUTOR_ATTESTATION_CONTRACT, connectionToken: rdSess.token, role: "live_ai_03b_executor", requestNonce: "a".repeat(32) }, now);
  ok("C11 an executor attestation issued for the READER connection cannot bind the executor", RB.bindExecutorConnection({ session: exSess, envelope: exForRd, trustRoot: PC.executorAttester.trustRoot, requestNonce: "a".repeat(32), nowMs: now, testBoundary: true }).reason === "executor_attestation_connection_mismatch");
  ok("C12 the executor attestation replayed against the reader binding fails", !RB.bindReaderConnection({ session: rdSess, envelope: exEnv, trustRoot: PC.readerAttester.trustRoot, requestNonce: "a".repeat(32), nowMs: now, testBoundary: true }).ok);
  ok("C13 the reader attestation replayed against the executor binding fails", !RB.bindExecutorConnection({ session: exSess, envelope: rdEnv, trustRoot: PC.executorAttester.trustRoot, requestNonce: "b".repeat(32), nowMs: now, testBoundary: true }).ok);
  ok("C14 swapped proofs: the executor identity proof does not authorize the reader token (and vice versa)",
    verifyConnectionTargetBinding({ expectedServiceId: SRC.DERIVATION_BASE && "b7362594-a01b-4623-a982-394707a6cec2", expectedIssuer: exOk.binding.expectedIssuer, connectionToken: rdSess.token, connectionIdentityProof: exOk.binding.identityProof, testBoundary: true }).reason === "connection_proof_not_bound_to_client"
    && verifyConnectionTargetBinding({ expectedServiceId: "b7362594-a01b-4623-a982-394707a6cec2", expectedIssuer: rdOk.binding.expectedIssuer, connectionToken: exSess.token, connectionIdentityProof: rdOk.binding.identityProof, testBoundary: true }).reason === "connection_proof_not_bound_to_client");
  ok("C15 two bindings for ONE connection (same token/pid) are refused", RB.checkDistinctBindings(exOk.binding, { ...rdOk.binding, token: exOk.binding.token }).reason === "executor_and_reader_share_a_connection_token"
    && RB.checkDistinctBindings(exOk.binding, { ...rdOk.binding, pid: exOk.binding.pid }).reason === "executor_and_reader_share_a_backend");
}

// ═══════════ D — connection identity ═══════════
{
  const mut = (f) => ({ exSrcOpts: { mutate: (p) => { f(p); return p; } } });
  const cases = [
    ["D01 executor attestation missing", { exSrc: { obtain: async () => undefined } }, "executor_attestation_absent"],
    ["D02 wrong issuer (re-signed by the same key)", mut((p) => { p.issuer = "TEST-ONLY-other-issuer"; }), "executor_attestation_issuer_untrusted"],
    ["D03 wrong connection token", mut((p) => { p.connection.token = "f".repeat(64); }), "executor_attestation_connection_mismatch"],
    ["D04 wrong service", mut((p) => { p.target.pgServiceId = "00000000-0000-0000-0000-000000000000"; }), "executor_drift_target_not_ai_staging"],
    ["D05 wrong project", mut((p) => { p.target.projectId = "00000000-0000-0000-0000-000000000000"; }), "executor_drift_target_not_ai_staging"],
    ["D06 wrong environment", mut((p) => { p.target.environmentId = "00000000-0000-0000-0000-000000000000"; }), "executor_drift_target_not_ai_staging"],
    ["D07 CORE-PROD postgres", mut((p) => { p.target.pgServiceId = "1fbd7632-95ad-46f3-a20c-5be5b8e44e6b"; }), "executor_drift_target_is_core_prod"],
    ["D08 CORE-PROD project", mut((p) => { p.target.projectId = "04c8b523-5b15-4d81-af06-8c2aa1a83499"; }), "executor_drift_target_is_core_prod"],
    ["D09 wrong request nonce (replay)", mut((p) => { p.requestNonce = "0".repeat(32); }), "executor_attestation_request_nonce_mismatch"],
    ["D10 reader: wrong project", { rdSrcOpts: { mutate: (p) => { p.target.projectId = "00000000-0000-0000-0000-000000000000"; return p; } } }, "reader_drift_target_not_ai_staging"],
    ["D11 reader: CORE-PROD", { rdSrcOpts: { mutate: (p) => { p.target.pgServiceId = "1fbd7632-95ad-46f3-a20c-5be5b8e44e6b"; return p; } } }, "reader_drift_target_is_core_prod"],
    ["D12 reader: wrong token", { rdSrcOpts: { mutate: (p) => { p.connection.token = "e".repeat(64); return p; } } }, "reader_attestation_connection_mismatch"],
  ];
  for (const [n, o, want] of cases) { const t = await acquireWith(o); ok(n, t.r.available === false && t.r.reason === want && t.m.exP.closed === true, t.r.reason); }
  const forged = H.makeTestAttester("TEST-ONLY-executor-attester", { signer: H.makeEd25519() });
  ok("D13 forged signature (another key claiming the pinned issuer AND key-id) refused", (await acquireWith({ exSrc: H.makeTestSource(forged, () => Date.now(), { mutate: (p) => { p.keyId = exAtt.key.fp; return p; } }) })).r.reason === "executor_attestation_signature_invalid");
  ok("D13b attestation claiming another key-id refused", (await acquireWith({ exSrc: H.makeTestSource(forged, () => Date.now()) })).r.reason === "executor_attestation_key_untrusted");
  ok("D14 a static/public-ID assertion object instead of a signed attestation refused",
    (await acquireWith({ exSrc: { obtain: async () => ({ provenance: CONNECTION_IDENTITY_PROOF_CONTRACT.trusted_provenance, serviceId: "b7362594-a01b-4623-a982-394707a6cec2", projectId: "4ad1abb3-823a-4acf-b889-6d34ae46d7f9" }) } })).r.reason === "executor_attestation_malformed");
  ok("D15 a pre-made proof cannot be injected (deps key set is exact)", PV.createAuthorityProvisionerV2({ ...mkDeps().deps, connectionIdentityProof: {} }, { testBoundary: true }).reason === "provisioner_deps_shape_not_exact");
  ok("D16 TEST-provenance proof refused in production by the accepted target binding", verifyConnectionTargetBinding({ expectedServiceId: "b7362594-a01b-4623-a982-394707a6cec2", expectedIssuer: "x", connectionToken: "t".repeat(16), connectionIdentityProof: { provenance: CONNECTION_IDENTITY_PROOF_CONTRACT.test_provenance } }).reason === "connection_identity_proof_untrusted");
  ok("D17 a TEST-ONLY attester root is refused in production binding", RB.bindExecutorConnection({ session: {}, envelope: {}, trustRoot: PC.executorAttester.trustRoot, requestNonce: "x", nowMs: Date.now(), testBoundary: false }).reason === "attester_trust_root_is_test_only");
  ok("D18 production config refuses TEST-ONLY attester issuers", CFG.loadProvisioningConfig(ENV).reason === "executor_trust_root_test_issuer_refused");
  ok("D19 production config refuses loopback attester channels", (() => { const e = { ...H.testProvisioningEnv(reviewer, H.makeTestAttester("ops-ex"), H.makeTestAttester("ops-rd")) }; return /loopback|destination|private/.test(String(CFG.loadProvisioningConfig(e).reason)); })(), CFG.loadProvisioningConfig({ ...H.testProvisioningEnv(reviewer, H.makeTestAttester("ops-ex"), H.makeTestAttester("ops-rd")) }).reason);
  ok("D20 the frozen config's connection-identity-proof reference must name the executor issuer", CFG.loadProvisioningConfig({ ...ENV, LIVE_AI_03B_CONNECTION_IDENTITY_PROOF_REF: "someone-else" }, { testBoundary: true }).reason === "connection_identity_proof_ref_not_executor_issuer");
}

// ═══════════ E — executor privilege proof (strong, exact, independent) ═══════════
{
  const mut = (f) => ({ exSrcOpts: { mutate: (p) => { f(p); return p; } } });
  const cases = [
    ["E01 wrong role (reader)", (p) => { p.privileges.currentUser = "live_ai_03b_reader"; }, "executor_drift_wrong_role"],
    ["E02 superuser", (p) => { p.privileges.rolsuper = true; }, "executor_drift_superuser"],
    ["E03 CREATEROLE", (p) => { p.privileges.rolcreaterole = true; }, "executor_drift_createrole"],
    ["E04 CREATEDB", (p) => { p.privileges.rolcreatedb = true; }, "executor_drift_createdb"],
    ["E05 REPLICATION", (p) => { p.privileges.rolreplication = true; }, "executor_drift_replication"],
    ["E06 BYPASSRLS", (p) => { p.privileges.rolbypassrls = true; }, "executor_drift_bypassrls"],
    ["E07 unexpected role membership", (p) => { p.privileges.roleMemberships = ["pg_write_all_data"]; }, "executor_drift_role_membership"],
    ["E08 budget table write privilege", (p) => { p.privileges.budgetTablePrivilegeCount = 1; }, "executor_drift_budget_table_privilege"],
    ["E09 ledger mutation privilege", (p) => { p.privileges.ledgerPrivilegeCount = 1; }, "executor_drift_ledger_privilege"],
    ["E10 schema CREATE", (p) => { p.privileges.schemaCreate = ["live_ai_03b_trusted_v2"]; }, "executor_drift_schema_create"],
    ["E11 unexpected routine EXECUTE (extra function)", (p) => { p.privileges.executableRoutines.push("public.anything(text)"); }, "executor_drift_routine_execute"],
    ["E12 missing successor EXECUTE", (p) => { p.privileges.executableRoutines = p.privileges.executableRoutines.slice(0, 3); }, "executor_drift_routine_execute"],
    ["E13 unapproved routine execute elsewhere", (p) => { p.privileges.unapprovedRoutineExecute = true; }, "executor_drift_unapproved_routine_execute"],
    ["E14 extra schema USAGE", (p) => { p.privileges.trustedSchemaUsage.push("live_ai_03b_gateway"); }, "executor_drift_schema_usage"],
    ["E15 PUBLIC/default privilege widening", (p) => { p.privileges.publicOrDefaultPrivilegeWidening = true; }, "executor_drift_public_or_default_widening"],
    ["E16 stale proof (> 5 min)", (p) => { p.issuedAtMs -= 400000; p.expiresAtMs = p.issuedAtMs + 200000; }, "executor_attestation_stale"],
    ["E17 future-dated proof", (p) => { p.issuedAtMs += 60000; p.expiresAtMs = p.issuedAtMs + 200000; }, "executor_attestation_future_dated"],
    ["E18 lifetime too long", (p) => { p.expiresAtMs = p.issuedAtMs + 600000; }, "executor_attestation_lifetime_too_long"],
    ["E19 client-token mismatch", (p) => { p.connection.token = "d".repeat(64); }, "executor_attestation_connection_mismatch"],
    ["E20 extra privilege field", (p) => { p.privileges.note = "trust me"; }, "executor_attestation_malformed"],
    ["E21 missing privilege field", (p) => { delete p.privileges.rolsuper; }, "executor_attestation_malformed"],
  ];
  for (const [n, f, want] of cases) { const t = await acquireWith(mut(f)); ok(n, t.r.available === false && t.r.reason === want, t.r.reason); }
  ok("E22 a bare boolean `restricted_role_proof_present:true` is not an executor proof", (await acquireWith({ exSrc: { obtain: async () => ({ restricted_role_proof_present: true }) } })).r.reason === "executor_attestation_malformed");
  ok("E23 a frozen-shape privilegeProof cannot be injected (deps key set is exact)", PV.createAuthorityProvisionerV2({ ...mkDeps().deps, privilegeProof: { restricted_role_proof_present: true } }, { testBoundary: true }).reason === "provisioner_deps_shape_not_exact");
  ok("E24 test-provenance executor attestation refused in production (TEST-ONLY issuer root)", EXA.verifyExecutorAttestation({}, {}).reason === "executor_trust_root_absent"
    && RB.bindExecutorConnection({ session: {}, envelope: {}, trustRoot: PC.executorAttester.trustRoot, testBoundary: false }).reason === "attester_trust_root_is_test_only");
  ok("E25 the accepted executor privilege set is exactly 2 schemas USAGE + 4 routines EXECUTE (2 M6 + 2 successor)", EXA.EXPECTED_EXECUTOR_PRIVILEGES.trustedSchemaUsage.length === 2 && EXA.EXPECTED_EXECUTOR_PRIVILEGES.executableRoutines.length === 4
    && EXA.EXPECTED_EXECUTOR_PRIVILEGES.executableRoutines.filter((r) => r.startsWith("live_ai_03b_trusted_v2.")).length === 2);
  ok("E26 executor statement_timeout must really apply (read-back)", (await acquireWith({ exOpts: { ignoreTimeout: true } })).r.reason === "executor_statement_timeout_not_applied");
}

// ═══════════ F — reader privilege proof (accepted contract, not weakened) ═══════════
{
  const mut = (f) => ({ rdSrcOpts: { mutate: (p) => { f(p); return p; } } });
  const cases = [
    ["F01 write capability", (p) => { p.privileges.writePrivilegeCount = 1; }, "reader_drift_write_privilege"],
    ["F02 wrong SELECT grant count", (p) => { p.privileges.selectGrantCount = 11; }, "reader_drift_select_grant_count"],
    ["F03 forbidden object accessible", (p) => { p.privileges.forbiddenObjectAccessible = true; }, "reader_drift_forbidden_object_accessible"],
    ["F04 unexpected routine authority", (p) => { p.privileges.unapprovedRoutineAuthority = true; }, "reader_drift_routine_authority"],
    ["F05 unexpected membership", (p) => { p.privileges.unapprovedRoleMembership = true; }, "reader_drift_role_membership"],
    ["F06 owner/executor authority", (p) => { p.privileges.ownerOrExecutorAuthority = true; }, "reader_drift_owner_or_executor_authority"],
    ["F07 not SELECT-only", (p) => { p.privileges.effectiveSelectOnly = false; }, "reader_drift_not_select_only"],
    ["F08 stale", (p) => { p.issuedAtMs -= 400000; p.expiresAtMs = p.issuedAtMs + 200000; }, "reader_attestation_stale"],
    ["F09 future-dated", (p) => { p.issuedAtMs += 60000; p.expiresAtMs = p.issuedAtMs + 200000; }, "reader_attestation_future_dated"],
    ["F10 wrong client binding", (p) => { p.connection.token = "c".repeat(64); }, "reader_attestation_connection_mismatch"],
  ];
  for (const [n, f, want] of cases) { const t = await acquireWith(mut(f)); ok(n, t.r.available === false && t.r.reason === want, t.r.reason); }
  ok("F11 invalid statement timeout (not applied on the reader connection)", /reader_statement_timeout_/.test((await acquireWith({ rdOpts: { ignoreTimeout: true } })).r.reason));
  ok("F12 the reader session is read-only and ≤ 2000 ms (accepted establishReaderSession)", (await acquireWith({})).m.rdP.log.includes("SELECT set_config('default_transaction_read_only', 'on', false) AS v"));
}

// ═══════════ G — reviewer trust root ═══════════
{
  const cfg = (reviewerOver) => ({ ok: true, reviewer: { pinnedPublicKeyDerB64: reviewer.trustRoot.pinnedPublicKeyDerB64, pinnedFingerprint: reviewer.fp, ...reviewerOver } });
  const other = H.makeEd25519();
  ok("G01 exact pinned public key ⇒ PASS", loadReviewerTrustRootV2(cfg({})).ok === true);
  ok("G02 missing key", loadReviewerTrustRootV2(cfg({ pinnedPublicKeyDerB64: "" })).reason === "reviewer_public_key_absent");
  ok("G03 invalid DER", loadReviewerTrustRootV2(cfg({ pinnedPublicKeyDerB64: Buffer.from("not a key at all").toString("base64") })).reason === "reviewer_public_key_invalid_der");
  ok("G04 wrong fingerprint", loadReviewerTrustRootV2(cfg({ pinnedFingerprint: other.fp })).reason === "reviewer_fingerprint_mismatch");
  ok("G05 private key material (PKCS#8 DER) refused", loadReviewerTrustRootV2(cfg({ pinnedPublicKeyDerB64: other.pk8 })).reason === "reviewer_private_key_material_refused");
  ok("G06 private key material (PEM text) refused", loadReviewerTrustRootV2(cfg({ pinnedPublicKeyDerB64: "-----BEGIN PRIVATE KEY-----" })).reason === "reviewer_private_key_material_refused");
  ok("G07 trust root that does not match the V2 config refused", PV.createAuthorityProvisionerV2(mkDeps({ rt: { pinnedPublicKeyDerB64: other.der, pinnedFingerprint: other.fp } }).deps, { testBoundary: true }).reason === "reviewer_trust_root_not_config_pinned");
  ok("G08 non-Ed25519 key refused", (() => { const k = generateKeyPairSync("rsa", { modulusLength: 1024 }); const der = k.publicKey.export({ type: "spki", format: "der" }).toString("base64"); return loadReviewerTrustRootV2(cfg({ pinnedPublicKeyDerB64: der })).reason === "reviewer_public_key_not_ed25519"; })());
  // envelope-carried key override: an envelope signed by ANOTHER key that carries its own public key
  const foreign = S2H.makeReviewer(); const fap = S2H.makeApproval(foreign, { nowMs: NOW, approvalId: "m7ap-approval-0002", executionId: "m7ap-exec-0002" });
  const m = mkDeps();
  const b = EP.composeActivationBoundaryForTestV2(m.deps, { testBoundary: true });
  const r = await b.run({ approvalEnvelope: { ...fap.envelope, public_key_der_b64: foreign.trustRoot.pinnedPublicKeyDerB64 }, suppliedEvidence: fap.suppliedEvidence, executionId: fap.executionId });
  ok("G09 envelope-carried key override ignored ⇒ refused, 0 activations", r.ok === false && m.state.activations === 0, r.reason);
}

// ═══════════ H — registry ═══════════
{
  const t = await acquireWith({});
  const a = t.r.authority;
  ok("H01 the authority registry is the preserved content-verified V2 registry", REG.assertSuppliedRegistryV2(a.registry).ok && a.registry.__registryDigest === REG.V2_REGISTRY_DIGEST);
  for (const [n, reg, pre] of [["H02 arbitrary registry", { foo: "SELECT 1" }, "authority_query_registry_"], ["H03 changed query", { ...REG.buildV2RegistrySupply(), ceilings: REG.CEILINGS_QUERY + " " }, "authority_query_registry_"],
    ["H04 V1 registry", V1_buildQueries(), "authority_query_registry_"], ["H05 digest marker mismatch", { ...REG.buildV2RegistrySupply(), __registryDigest: "0".repeat(64) }, "authority_query_registry_"]]) {
    const v = PA.validateProvisionedAuthorityV2({ ...a, registry: reg }, { testBoundary: true });
    ok(n + " refused by the preserved validator", v.ok === false && v.reason.startsWith(pre), v.reason);
  }
  ok("H06 a registry cannot be injected into the provisioner (deps key set is exact)", PV.createAuthorityProvisionerV2({ ...mkDeps().deps, registry: REG.buildV2RegistrySupply() }, { testBoundary: true }).reason === "provisioner_deps_shape_not_exact");
  const rq = async (sql, params) => { try { await a.readerDbClient.query(sql, params); return "ran"; } catch (e) { return e.code; } };
  ok("H07 reader client refuses caller SQL", (await rq("SELECT * FROM public.budget_envelope_allocations")) === "READER_SQL_NOT_ADMITTED");
  ok("H08 reader client refuses a changed registry query", (await rq(REG.CEILINGS_QUERY + " ")) === "READER_SQL_NOT_ADMITTED");
  ok("H09 reader client refuses the activation statement", (await rq(ACTIVATE_SQL_V2, ["{}", "m7ap-exec-0001"])) === "READER_SQL_NOT_ADMITTED");
  ok("H10 reader client refuses parameters on a parameter-free query", (await rq(REG.CEILINGS_QUERY, ["x"])) === "READER_PARAMS_NOT_ADMITTED");
  ok("H11 reader client admits the preserved registry query", (await rq(REG.CEILINGS_QUERY)) === "ran");
  const eq = async (sql, params) => { try { await a.executorDbClient.query(sql, params); return "ran"; } catch (e) { return e.code; } };
  ok("H12 executor client refuses restoration / DML / registry reads", (await eq(RESTORE_SQL_V2, ["{}", "m7ap-exec-0001"])) === "EXECUTOR_SQL_NOT_ADMITTED"
    && (await eq("UPDATE public.budget_price_catalog_versions SET status='active'", [])) === "EXECUTOR_SQL_NOT_ADMITTED" && (await eq(REG.CEILINGS_QUERY, [])) === "EXECUTOR_SQL_NOT_ADMITTED");
  t.m.rdP.kill();
  ok("H13 a dead reader connection is never silently replaced", (await rq(REG.CEILINGS_QUERY)) === "READER_CONNECTION_DEAD");
}

// ═══════════ I — ActivationSourceProofV2 ═══════════
{
  const real = AS.productionActivationSourceProofV2({ repoRoot: REPO });
  ok("I01 PRODUCTION source proof: PIN A + static PIN B + PIN C RE-DERIVED from git (0afe4b6b) ⇒ preserved checker PASS", real.ok === true
    && real.proof.step2Runtime.commit === "0afe4b6bedeb12f756cc9027367d323acb264464" && real.proof.step2Runtime.runtime_manifest_digest === "64c7031746bff227321e2e2506b4737938eafc3493ae472ab0f51e5e46987d9f", real.reason);
  ok("I02 PIN B in the proof is the reviewed static literal (4f390b74 / 72080256 / 2092d9de) — no deployed-gateway claim", real.ok && real.proof.gatewayStaticSource.commit === "4f390b74132b087b757faa655bdcb73be6c14a8f"
    && real.proof.gatewayStaticSource.tree === "72080256d4cc2a97a2a15058931e838ebef5ec48" && real.proof.gatewayStaticSource.voice_gateway_tree === "2092d9de6b96763ab76477f9c37159082c00aa26" && !("gatewayDeployment" in real.proof));
  ok("I03 PIN A 9270c282 / c46da041", real.ok && real.proof.derivationBase.commit === "9270c282d5fd65e9fe49261391badfe92c777b8f" && real.proof.derivationBase.tree === "c46da04123dc44cd9954fe350de0b1bc20ff0948");
  const chk = (proof) => SRC.checkActivationSourceProofV2(proof).reason;
  const P = AS.PRESERVED_PIN_C_V2;
  ok("I04 historical f5ec5807 PIN C refused", chk(AS.assembleActivationSourceProofV2({ ...P, commit: "f5ec5807014442884c1d156c51a4edd1563b25bd" })) === "historical_pin_c_cannot_authorize_corrected_runtime");
  ok("I05 baseline 3fda6af1 as PIN C refused", chk(AS.assembleActivationSourceProofV2({ ...P, commit: "3fda6af1eb9bf2681a39e4b90bddec270ac86395" })) === "step2_runtime_pin_reuses_non_step2_commit");
  ok("I06 wrong runtime digest refused", chk(AS.assembleActivationSourceProofV2({ ...P, runtime_manifest_digest: "1".repeat(64) })) === "step2_runtime_manifest_mismatch");
  ok("I07 historical manifest 9a460078 refused", chk(AS.assembleActivationSourceProofV2({ ...P, runtime_manifest_digest: "9a460078846eec885b726e7b54bdbd8a301c690b1f78a68439e151f462341998" })) === "historical_runtime_manifest_cannot_authorize_corrected_runtime");
  ok("I08 wrong PIN A refused", chk({ ...AS.assembleActivationSourceProofV2(P), derivationBase: { commit: "4f390b74132b087b757faa655bdcb73be6c14a8f", tree: "72080256d4cc2a97a2a15058931e838ebef5ec48" } }) === "derivation_base_rewritten");
  ok("I09 wrong PIN B refused", chk({ ...AS.assembleActivationSourceProofV2(P), gatewayStaticSource: { ...SRC.staticGatewaySourceIdentityV2(), commit: "a".repeat(40) } }) === "static_gateway_commit_mismatch");
  ok("I10 superseded PIN B 2b69ce refused", chk({ ...AS.assembleActivationSourceProofV2(P), gatewayStaticSource: { ...SRC.staticGatewaySourceIdentityV2(), commit: "2b69ce28230fc9d56a035846e95d8de206d5db3b" } }) === "superseded_gateway_source_2b69ce_rejected");
  ok("I11 deployed-gateway claim in the Phase-A proof refused", chk({ ...AS.assembleActivationSourceProofV2(P), gatewayStaticSource: { ...SRC.staticGatewaySourceIdentityV2(), healthy: true } }) === "activation_proof_must_not_claim_gateway_deployment");
  ok("I12 PreProbe proof substituted for the activation proof refused (provisioner deps)", PV.createAuthorityProvisionerV2(mkDeps({ sp: { ...SP.proof, contract: SRC.PRE_PROBE_SOURCE_PROOF_CONTRACT_V2 } }).deps, { testBoundary: true }).reason === "activation_source_proof_pre_probe_proof_is_not_an_activation_proof");
  const fakeGit = { revParse: () => null, isAncestor: () => false, diffNameStatus: () => [], blobBytes: () => Buffer.alloc(0) };
  ok("I13 PIN C that cannot be re-derived from git ⇒ fail closed", AS.productionActivationSourceProofV2({ git: fakeGit }).ok === false);
  ok("I14 the source-proof module never imports the Phase-B pre-probe proof", !/PreProbe|PRE_PROBE|checkPreProbeSourceProofV2/.test(readFileSync(join(PKG, "src/activation-source.mjs"), "utf8").replace(/\/\/.*$/gm, "")));
  ok("I15 the recorded PIN C equals the preserved verifier output bit-for-bit", AS.rederivePinCFromGit((await import("../../m7-step2-runtime-rebinding-offline-01/tools/verify-step2-preservation.mjs")).makeGit(REPO)).ok === true);
}

// ═══════════ J — provisioner / composition / one-shot / clock ═══════════
{
  const m = mkDeps();
  const p = PV.createAuthorityProvisionerV2(m.deps, { testBoundary: true });
  ok("J01 provisioner is frozen with EXACTLY { contract, acquire }", p.ok && Object.isFrozen(p.provisioner) && Object.keys(p.provisioner).sort().join() === "acquire,contract" && p.provisioner.contract === PA.PROVISIONER_CONTRACT_V2
    && PA.checkProvisionerV2(p.provisioner).ok === true);
  ok("J02 acquire refuses any argument (a request can never reach it)", (await p.provisioner.acquire(REQ())).reason === "acquire_takes_no_arguments" && m.spy.ex.opens === undefined);
  const a1 = await p.provisioner.acquire(); const a2 = await p.provisioner.acquire();
  ok("J03 acquire is one-shot", a1.available === true && a2.reason === "provisioner_acquire_is_one_shot");
  const f = await acquireWith({ exFactory: H.factoryOf(new Error("boom")) });
  ok("J04 acquisition failure (executor connection) stays fail-closed with a fixed code", f.r.available === false && f.r.reason === "executor_connection_failed");
  const f2 = await acquireWith({ exSrcOpts: { throwCode: "attester_unreachable" } });
  ok("J05 attester unreachable ⇒ fail closed, both connections closed", f2.r.reason === "executor_attestation_unavailable:attester_unreachable" && f2.m.exP.closed === true && f2.m.rdP.closed === true);
  ok("J06 deps key set exact (extra key refused)", PV.createAuthorityProvisionerV2({ ...mkDeps().deps, extra: 1 }, { testBoundary: true }).reason === "provisioner_deps_shape_not_exact");
  // clock
  ok("J07 TEST clock requires the explicit test boundary", (() => { try { CLK.makeTestClock(() => 1); return false; } catch (e) { return e.message === "test_clock_requires_testBoundary_true"; } })());
  ok("J08 production clock unusable before DB binding", (() => { try { CLK.makeProductionClock().nowMs(); return false; } catch (e) { return e.message === "trusted_clock_not_bound"; } })());
  ok("J09 production validator refuses the TEST clock", CLK.validateClock(CLK.makeTestClock(() => 1, { testBoundary: true })).reason === "trusted_clock_provenance_untrusted");
  ok("J10 host/DB clock skew beyond 5 s ⇒ fail closed", (await acquireWith({ exOpts: { dbNowMs: () => Date.now() - 60000 } })).r.reason === "host_db_clock_skew_exceeds_bound");
  ok("J11 a pre-bound clock is refused (binding happens on the actual executor connection only)", (() => { const c = CLK.makeTestClock(() => Date.now(), { testBoundary: true }); c.bindToDbClock(Date.now()); return PV.createAuthorityProvisionerV2(mkDeps({ clock: c }).deps, { testBoundary: true }).reason === "trusted_clock_prebound"; })());
  ok("J12 clock never moves backwards", (() => { let t = 5000000; const c = CLK.makeTestClock(() => t, { testBoundary: true }); c.bindToDbClock(5000000); const x = c.nowMs(); t = 4000000; return c.nowMs() === x; })());
  // forbidden secret classes
  for (const n of ["OPENAI_API_KEY", "LIVE_AI_SESSION_SIGNING_PRIVATE_KEY", "LIVE_AI_03B_REVIEWER_PRIVATE_KEY", "CORE_DATABASE_URL", "LIVE_AI_03B_STAGING_DATABASE_URL", "LIVE_AI_CONTROL_TOKEN_SECRET", "DATABASE_URL", "PGPASSWORD", "SOME_GATEWAY_SIGNING_SECRET", "X_PRIVATE_KEY"]) {
    ok(`J13 forbidden secret class in the authority env ⇒ refused (${n})`, CFG.loadProvisioningConfig({ ...ENV, [n]: "synthetic" }, { testBoundary: true }).reason === "forbidden_secret_class_present");
  }
}

// ═══════════ G+ — the ONE positive Phase-A run through the preserved TEST seam (no deployed gateway) ═══════════
{
  const m = mkDeps();
  const b = EP.composeActivationBoundaryForTestV2(m.deps, { testBoundary: true });
  const r = await b.run(REQ());
  ok("P01 composed boundary: exactly ONE activate_catalog_v2, committed + correlated, NOT probe-ready", r.ok === true && r.stage === "V2_CATALOG_ACTIVATED_COMMITTED_AND_CORRELATED" && r.probeReady === false && m.state.activations === 1, r.reason);
  ok("P02 both physical connections released after the run", m.exP.closed === true && m.rdP.closed === true);
  const exRuntimeSql = m.exP.log.filter((s) => !Object.values(EXS.EXECUTOR_LIFECYCLE_SQL).includes(s));
  ok("P03 the executor connection carried ONLY lifecycle SQL + exactly one ACTIVATE", exRuntimeSql.length === 1 && exRuntimeSql[0] === ACTIVATE_SQL_V2, exRuntimeSql);
  const allowedReader = new Set([...Object.values(REG.V2_QUERY_REGISTRY), ...Object.values((await import("../../private-reader-production-integration-offline-01/reader-session.mjs")).LIFECYCLE_SQL)]);
  ok("P04 the reader connection carried ONLY lifecycle + registry SQL", m.rdP.log.every((s) => allowedReader.has(s)));
  const r2 = await b.run(REQ());
  ok("P05 second run of the same boundary refused (one-shot), no second mutation", r2.ok === false && r2.reason === "activation_boundary_is_one_shot" && m.state.activations === 1);
  const m3 = mkDeps({ state: m.state });
  const r3 = await EP.composeActivationBoundaryForTestV2(m3.deps, { testBoundary: true }).run(REQ());
  ok("P06 a fresh composition cannot re-activate (preserved executor one-shot / replay) — still one mutation", r3.ok === false && m.state.activations === 1, r3.reason);
  ok("P07 no gateway observation, deployment or provider input exists anywhere in the authority dependencies", !JSON.stringify(Object.keys(m.deps)).match(/gateway|provider|deploy/i) && !("gatewayDeployment" in SP.proof));
}

// ═══════════ S — static boundary scans over the package sources ═══════════
{
  const files = readdirSync(join(PKG, "src")).filter((f) => f.endsWith(".mjs")).map((f) => ({ f, s: readFileSync(join(PKG, "src", f), "utf8") }));
  const code = (s) => s.replace(/\/\/.*$/gm, "");
  ok("S01 no src module imports test helpers", files.every(({ s }) => !/from\s+"[^"]*tests\//.test(s)));
  ok("S02 no module-scope mutable authority slot / setter / env-JSON blob", files.every(({ s }) => !/^(let|var)\s/m.test(code(s)) && !/export\s+(async\s+)?function\s+(set|register|inject|install|provide)\w*/i.test(s) && !/JSON\.parse\(\s*(process\.)?env/.test(s)));
  ok("S03 no logging of values (no console.* in src)", files.every(({ s }) => !/console\.(log|info|warn|error)\(/.test(code(s))));
  ok("S04 process.env is read only by the production entrypoint", files.filter(({ s }) => /process\.env/.test(code(s))).map(({ f }) => f).join() === "production-entrypoint.mjs");
  ok("S05 no private key / DSN / provider credential literal in src or tests", [...files, ...readdirSync(HERE).filter((f) => f.endsWith(".mjs")).map((f) => ({ s: readFileSync(join(HERE, f), "utf8") }))]
    .every(({ s }) => !/BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----\n|postgres(ql)?:\/\/[^"'`\s]*:[^"'`\s]*@|sk-[A-Za-z0-9]{20,}|claude-(opus|sonnet|haiku|fable)/.test(s)));
  ok("S06 the preserved Step-2 runtime is composed, never copied (imports of v2-trusted-executor-runtime / v2-production-authority)",
    /m7-step2-runtime-rebinding-offline-01\/runtime\/v2-trusted-executor-runtime\.mjs/.test(readFileSync(join(PKG, "src/production-entrypoint.mjs"), "utf8")) && /v2-production-authority\.mjs/.test(readFileSync(join(PKG, "src/provisioner.mjs"), "utf8")));
}

// ═══════════ Z — package identity + FUTURE package-preservation verifier (real repo + working-tree overlay) ═══════════
{
  const PI = await import("../tools/package-identity.mjs");
  const VP = await import("../tools/verify-package-preservation.mjs");
  const { readdirSync: rd, statSync: st } = await import("node:fs");
  const { relative: rel } = await import("node:path");
  const walk = (d) => rd(d).flatMap((f) => { const p = join(d, f); return st(p).isDirectory() ? walk(p) : [p]; });
  const pkgFiles = walk(PKG).map((p) => rel(PKG, p).split("\\").join("/"));
  const real = VP.makeGit(REPO);
  const X = "c0ffee11c0ffee11c0ffee11c0ffee11c0ffee11";
  // Step 10: src/ now imports the preserved executor-attester issuer adapter, which first exists at 02345082. The
  // synthetic overlay therefore takes every NON-package byte from that real preserved tree (Step-2 tree unchanged =
  // bacac441; every other frozen dependency byte-identical to 0afe4b6b), and the package bytes from the working tree.
  const STEP10_BASE = "023450821bc7dbf75165acbf3ee349a3d5984b1b";
  const overlay = (o = {}) => ({
    revParse: (x) => (x === `${X}^{commit}` ? X : x === `${X}^{tree}` ? "5".repeat(40) : x === `${X}:${PI.PACKAGE_DIR}` ? "6".repeat(40)
      : x.startsWith(X + ":") ? real.revParse(STEP10_BASE + x.slice(X.length)) : real.revParse(x)),
    isAncestor: (a, b) => (b === X ? a === PI.BASELINE.commit || real.isAncestor(a, PI.BASELINE.commit) : real.isAncestor(a, b)),
    diffNameStatus: (a, b) => (b === X ? (o.changes || pkgFiles.map((p) => ({ status: "A", path: `${PI.PACKAGE_DIR}/${p}` }))) : real.diffNameStatus(a, b)),
    blobBytes: (rev, p) => { if (rev !== X) return real.blobBytes(rev, p); if (o.tamper && p === o.tamper) return Buffer.from("tampered");
      return p.startsWith(PI.PACKAGE_DIR + "/") ? readFileSync(join(REPO, p)) : real.blobBytes(STEP10_BASE, p); },
    listFiles: (rev, dir) => (rev === X ? pkgFiles : real.listFiles(rev, dir)),
  });
  const v = VP.verifyPackagePreservation(overlay(), X);
  ok("Z01 in-package preservation DIAGNOSTIC (non-authoritative; synthetic overlay = preserved tree 02345082 + this package): Step-2 tree unchanged, PIN C re-derived, every frozen dep (incl. the Step-10 issuer adapter) + digests exact ⇒ V2ProductionAuthorityProvisioningPreservationBindingV1", v.ok === true
    && v.binding.package_runtime_digest === PI.measurePackage().package_runtime_digest
    && v.binding.contract === "V2ProductionAuthorityProvisioningPreservationBindingV1" && v.binding.base_commit === "0afe4b6bedeb12f756cc9027367d323acb264464", v);
  ok("Z02 the package binding is NOT a PIN C (refused by the preserved verifyStep2RuntimePin)", v.ok && SRC.verifyStep2RuntimePin(v.binding).ok === false);
  ok("Z03 a Step-2 file changed by the package commit ⇒ fail", VP.verifyPackagePreservation(overlay({ changes: [{ status: "M", path: "scripts/live-ai-03b/m7-step2-runtime-rebinding-offline-01/runtime/v2-production-authority.mjs" }] }), X).reason.startsWith("non_package_path_changed"));
  ok("Z04 a frozen dependency different at the commit ⇒ fail", VP.verifyPackagePreservation(overlay({ tamper: "scripts/live-ai-03b/trusted-executor-runtime-01/db-target-binding.mjs" }), X).reason.startsWith("frozen_dependency_changed"));
  ok("Z05 package runtime bytes different at the commit ⇒ fail", VP.verifyPackagePreservation(overlay({ tamper: `${PI.PACKAGE_DIR}/src/provisioner.mjs` }), X).reason === "package_runtime_digest_differs");
  ok("Z06 the baseline commit itself ⇒ refused", VP.verifyPackagePreservation(real, "0afe4b6bedeb12f756cc9027367d323acb264464").reason === "commit_is_the_baseline");
  ok("Z07 package identity files are current (tools/package-identity.mjs --check semantics)", (() => { const m = PI.measurePackage(); const cur = JSON.parse(readFileSync(join(PKG, "identity/PACKAGE-CONTENT-MANIFEST.json"), "utf8")); return cur.package_runtime_digest === m.package_runtime_digest && cur.package_content_digest === m.package_content_digest; })());
}

// ═══════════ K — no live effect ═══════════
ok("K01 zero network: fetch=0 http(s)=0 socket connects=0 (⇒ 0 DB / Railway / provider calls)", COUNTS.fetch === 0 && COUNTS.http === 0 && COUNTS.socket === 0, COUNTS);
const bad = SPAWNS.filter((s) => !((s.cmd === "git" && READONLY_GIT.has(s.verb)) || s.cmd === process.execPath));
ok("K02 only local read-only git (PIN-C re-derivation) and the fail-closed CLI child were spawned — no railway / psql / curl", bad.length === 0, bad);
done();
