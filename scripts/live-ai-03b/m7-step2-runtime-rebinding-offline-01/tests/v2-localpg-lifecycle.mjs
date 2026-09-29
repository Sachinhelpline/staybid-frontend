// M7 Step-2 REAL-PostgreSQL LIFECYCLE (A–H) on a THROWAWAY local cluster (unix socket only; never
// AI-STAGING / CORE-PROD). Invoked by v2-localpg.test.sh AFTER it builds the accepted post-M6 base + the
// Step-1 inactive V2 seed (01) + trusted_v2 successor (02). REAL role logins: live_ai_03b_executor (scram,
// SYNTHETIC test-only password), live_ai_03b_reader (trust). Owner steps 04/05/07 are applied as the
// Owner (postgres) through psql. The frozen M6 canonical verifier must PASS in every lifecycle state.
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import net from "node:net";
import pg from "pg";
import { makeReviewer, makeApproval, testActivationSourceProof, testPreProbeSourceProof, phaseBGates, testEnv, testConnectionProof, makeRunner, iso, RAILWAY, DB } from "./helpers.mjs";
import { makeLocalPgAttester } from "./localpg-attester.mjs";
import * as ID from "../identity/v2-identity.mjs";
import * as SRC from "../identity/v2-source-identity.mjs";
import * as REG from "../runtime/v2-query-registry.mjs";
import { makeTrustedReadAdapterV2 } from "../runtime/v2-trusted-read-adapter.mjs";
import { makeRestrictedActivationAdapterV2 } from "../runtime/v2-restricted-activation-adapter.mjs";
import * as PF from "../runtime/v2-preflight.mjs";
import { runTrustedExecutorTestV2 } from "../runtime/v2-trusted-executor-runtime.mjs";
import { runProbeV2 } from "../probe/v2-first-text-probe.mjs";
import { startProductionReaderServiceV2 } from "../reader/v2-production-entrypoint.mjs";
import { createGatewayObservationCallerV2 } from "../reader/v2-gateway-observation-caller.mjs";
import { makePgPhysicalFactory } from "../../private-reader-production-integration-offline-01/reader-session.mjs";
import { verifyApprovalV2 } from "../../m7-step1-hb1-consolidated-remediation-01/approval/approval-verify-v2.mjs";
import { runProbe as V1_runProbe } from "../../first-text-probe-activation-01/first-text-probe.mjs";

const { BASE, PGC, SQLD, M6VERIFY, PGPASSWORD, PGLABEL } = process.env;
if (!BASE || !PGC || !SQLD || !M6VERIFY || !PGPASSWORD) { console.log("SKIPPED: harness env absent (a skip is not a pass)"); process.exit(2); }
const SOCK = `${BASE}/c`;
const { ok, done } = makeRunner(`m7s2-localpg-lifecycle[${PGLABEL || "?"}]`);
const psqlFile = (file, vars = []) => spawnSync("bash", [PGC, "psql", SOCK, "-d", "railway", "-v", "ON_ERROR_STOP=1", ...vars.flatMap((v) => ["-v", v])], { input: readFileSync(file), encoding: "utf8" });
const m6pass = () => { const r = spawnSync("bash", [PGC, "psql", SOCK, "-d", "railway", "-v", "ON_ERROR_STOP=1"], { input: readFileSync(M6VERIFY), encoding: "utf8" }); return (r.stdout + r.stderr).includes("ALL HARD CHECKS PASSED"); };
const nowUtc = () => iso(Date.now());
const client = async (user, password) => { const c = new pg.Client({ host: SOCK, user, database: "railway", ...(password ? { password } : {}) }); await c.connect(); return c; };

const superC = await client("postgres");
const readerC = await client("live_ai_03b_reader");
const execC = await client("live_ai_03b_executor", PGPASSWORD);
const sq = async (sql) => (await superC.query(sql)).rows;
const one = async (sql) => (await sq(sql))[0];
const ledgerCount = async () => Number((await one("SELECT count(*)::int AS n FROM live_ai_03b_trusted.approval_consumption")).n);
const tb = { ok: true, verifiedServiceId: ID.TARGETS_V2.postgres, verifiedProjectId: ID.TARGETS_V2.project };
const reader = makeTrustedReadAdapterV2({ dbClient: readerC, targetBinding: tb, registry: REG.buildV2RegistrySupply(), mode: "test" });
const rv = makeReviewer();
const ap = makeApproval(rv, { approvalId: "m7s2-lc-approval-01", executionId: "m7s2-lc-exec-0001" });

// ── H (start): the V2 private reader over REAL PG, independently attested, served on loopback ──
const att = makeLocalPgAttester({ superClient: superC });
const port = await new Promise((res) => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); }); });
const SECRET = "synthetic-transport-secret-localpg-0123456789";
const readerSvc = await startProductionReaderServiceV2({
  mode: "offline-test", offlineTestBoundary: true, trustRootConfig: att.trustRootConfig,
  physicalFactory: makePgPhysicalFactory({ env: { R: `postgresql://live_ai_03b_reader@/railway?host=${encodeURIComponent(SOCK)}` }, connectionStringEnvName: "R" }),
  attestationSource: att.source, sourcePin: testPreProbeSourceProof(), listen: { mode: "loopback-tcp", host: "127.0.0.1", port },
  transportSecretProvider: async () => SECRET, tickMs: 0, log: () => {},
});
ok("H00 V2 reader service starts against REAL PG (reader login, verified statement_timeout, independent attestation)", readerSvc.started === true && readerSvc.ready(), readerSvc.reason);
const gw = createGatewayObservationCallerV2({ destination: { host: "127.0.0.1", port }, secret: SECRET, offlineTestBoundary: true, expectedMode: "test" });
const viaReader = async (phase) => { const r = await gw.observe(phase); return r.ok ? r.message.observation : { __fail: r }; };
{
  const noPin = await startProductionReaderServiceV2({ mode: "offline-test", offlineTestBoundary: true, trustRootConfig: att.trustRootConfig,
    physicalFactory: { open: async () => { throw new Error("must not connect"); } }, attestationSource: att.source,
    sourcePin: testPreProbeSourceProof({ step2Runtime: SRC.STEP2_RUNTIME_PIN_PLACEHOLDER }), listen: { mode: "loopback-tcp", host: "127.0.0.1", port: port + 1 }, transportSecretProvider: async () => SECRET, tickMs: 0, log: () => {} });
  ok("H01 reader service with the unresolved Step-2 pin refuses BEFORE any DB connection", !noPin.started && noPin.reason === "source_pin_step2_runtime_pin_required_after_preservation");
}

// ═══════════ A — pre-activation (after 01 + 02) ═══════════
ok("A00 M6 canonical verifier PASS (pre-activation)", m6pass());
const preObs = await reader.observePreActivation();
ok("A01 real pre-activation: 2 versions / 5 entries; V1 historical; V2 inactive ×3; 0 active; dormant policy; epoch-1; zero exposure",
  preObs.ok && PF.checks.preActivationStateV2(preObs.preActivationState).ok && PF.checks.zeroPriorProbeExposure(preObs.counts).ok, preObs.ok && PF.checks.preActivationStateV2(preObs.preActivationState));
const rPre = await viaReader("pre-activation");
ok("A02 reader chain (loopback) returns the identical pre-activation observation", !rPre.__fail && JSON.stringify(rPre.preActivationState) === JSON.stringify(preObs.preActivationState), rPre.__fail);
ok("A03 the reader session is SELECT-only (write attempt refused by the DB)", await readerC.query("UPDATE public.budget_price_catalog_versions SET status='active' WHERE false").then(() => false, (e) => /permission denied/.test(e.message)));

const base = { testBoundary: true, env: testEnv(rv), trustRoot: rv.trustRoot, connectionIdentityProof: testConnectionProof(), expectedIssuer: "TEST-ISSUER", connectionToken: "TEST-TOKEN",
  executorDbClient: execC, readerDbClient: readerC, registry: REG.buildV2RegistrySupply(), activationSourceProof: testActivationSourceProof(), privilegeProof: { restricted_role_proof_present: true },
  approvalEnvelope: ap.envelope, suppliedEvidence: ap.suppliedEvidence, executionId: ap.executionId, nowProvider: nowUtc };
{
  const r1 = await runTrustedExecutorTestV2({ ...base, activationSourceProof: testActivationSourceProof({ step2Runtime: SRC.STEP2_RUNTIME_PIN_PLACEHOLDER }) });
  const r2 = await runTrustedExecutorTestV2({ ...base, activationSourceProof: testActivationSourceProof({ gatewayStaticSource: { ...SRC.staticGatewaySourceIdentityV2(), commit: SRC.SUPERSEDED_GATEWAY_SOURCE_V1.commit } }) });
  const r3 = await runTrustedExecutorTestV2({ ...base, executionId: "m7s2-lc-exec-other" });
  ok("A04 unresolved Step-2 pin / 2b69ce gateway / foreign execution ⇒ refused, ZERO ledger rows, V2 still inactive",
    r1.reason === "step2_runtime_pin_required_after_preservation" && r2.reason === "superseded_gateway_source_2b69ce_rejected" && /approval_for_another_execution/.test(r3.reason) && (await ledgerCount()) === 0
    && (await one(`SELECT status FROM public.budget_price_catalog_versions WHERE id='${ID.CATALOG_V2.id}'`)).status === "inactive", [r1.reason, r2.reason, r3.reason]);
}

// ═══════════ B — trusted V2 activation → committed ledger → Phase-B correlation → activated ═══════════
const act = await runTrustedExecutorTestV2(base);
ok("B00 real executor login activates V2 via activate_catalog_v2; ledger committed; correlated; activated state exact; NOT probe-ready",
  act.ok && act.stage === "V2_CATALOG_ACTIVATED_COMMITTED_AND_CORRELATED" && act.probeReady === false, act);
ok("B01 exactly ONE ledger row (action=activate) for this approval", (await ledgerCount()) === 1 && (await one(`SELECT count(*)::int AS n FROM live_ai_03b_trusted.approval_consumption WHERE approval_id='${ap.approvalId}' AND action='activate' AND active_catalog_digest='${ID.CATALOG_V2.active_digest}'`)).n === 1);
ok("B02 V2 SOLE active with the reviewed active digest; V1 inactive historical", (await one(`SELECT string_agg(id||':'||status||':'||catalog_digest, ',' ORDER BY id) AS s FROM public.budget_price_catalog_versions`)).s
  === `${ID.V1_HISTORICAL.id}:inactive:${ID.V1_HISTORICAL.inactive_digest},${ID.CATALOG_V2.id}:active:${ID.CATALOG_V2.active_digest}`);
ok("B03 M6 canonical verifier PASS (activated)", m6pass());
const rAct = await viaReader("activated");
ok("B04 reader chain: activated observation passes the activated-state check", !rAct.__fail && PF.checkActivatedStateV2(rAct.activatedState).ok, rAct.__fail);
{
  const again = await runTrustedExecutorTestV2(base);
  ok("B05 second executor run refused (one-shot); no second ledger row", !again.ok && (await ledgerCount()) === 1, again.reason);
  // DB-level replay through a FRESH adapter (bypassing the executor one-shot): the trusted_v2 function refuses.
  const v = verifyApprovalV2({ envelope: ap.envelope, trustRoot: rv.trustRoot, suppliedEvidence: ap.suppliedEvidence, nowIso: nowUtc(), executionId: ap.executionId, isConsumed: () => false });
  const ad = makeRestrictedActivationAdapterV2({ dbClient: execC, targetBinding: tb, mode: "test" });
  const rep = await ad.restrictedDbActivate({ claims: v.claims, executionId: ap.executionId });
  ok("B06 DB-level replay of the SAME approval refused inside activate_catalog_v2 (ledger unique); state unchanged", !rep.ok && (await ledgerCount()) === 1, rep);
  const ap2 = makeApproval(rv, { approvalId: "m7s2-lc-approval-02", executionId: "m7s2-lc-exec-0002" });
  const v2 = verifyApprovalV2({ envelope: ap2.envelope, trustRoot: rv.trustRoot, suppliedEvidence: ap2.suppliedEvidence, nowIso: nowUtc(), executionId: ap2.executionId, isConsumed: () => false });
  const rep2 = await ad.restrictedDbActivate({ claims: v2.claims, executionId: ap2.executionId });
  ok("B07 a SECOND valid approval while V2 is active refused (no competing authority); ledger unchanged", !rep2.ok && (await ledgerCount()) === 1, rep2);
  ok("B08 executor has no direct catalog DML", await execC.query(`UPDATE public.budget_price_catalog_versions SET status='inactive' WHERE id='${ID.CATALOG_V2.id}'`).then(() => false, (e) => /permission denied/.test(e.message)));
}

// §17/§19 privilege boundary on the REAL successor grants (no widening; no admin fallback)
{
  const v = verifyApprovalV2({ envelope: ap.envelope, trustRoot: rv.trustRoot, suppliedEvidence: ap.suppliedEvidence, nowIso: nowUtc(), executionId: ap.executionId, isConsumed: () => false });
  const cj = JSON.stringify(v.claims).replace(/'/g, "''");
  const asRole = async (role, sql) => { try { await superC.query("BEGIN"); await superC.query(`SET LOCAL ROLE ${role}`); await superC.query(sql); await superC.query("ROLLBACK"); return "allowed"; } catch (e) { await superC.query("ROLLBACK").catch(() => {}); return e.message; } };
  await superC.query("DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='m7s2_public_probe') THEN CREATE ROLE m7s2_public_probe NOLOGIN; END IF; END $$");
  const call = `SELECT live_ai_03b_trusted_v2.activate_catalog_v2('${cj}'::jsonb, '${ap.executionId}')`;
  ok("P01 gateway_store has NO activation authority (activate_catalog_v2 denied)", /permission denied/.test(await asRole("live_ai_03b_gateway_store", call)));
  ok("P02 PUBLIC has NO successor execute (activate_catalog_v2 denied)", /permission denied/.test(await asRole("m7s2_public_probe", call)));
  ok("P03 reader has NO successor execute", /permission denied/.test(await asRole("live_ai_03b_reader", call)));
  ok("P04 reader has NO restore authority", /permission denied/.test(await asRole("live_ai_03b_reader", call.replace("activate_catalog_v2", "restore_catalog_v2_inactive"))));
  const old = await execC.query(`SELECT live_ai_03b_trusted.activate_catalog($1::jsonb, $2)`, [JSON.stringify(v.claims), ap.executionId]).then(() => "allowed", (e) => e.message);
  ok("P05 old trusted activate_catalog path refuses V2 claims (no V1 fallback); ledger unchanged", old !== "allowed" && (await ledgerCount()) === 1, old);
  ok("P06 executor cannot write the ledger directly", await execC.query("INSERT INTO live_ai_03b_trusted.approval_consumption VALUES ('x','y','z','w','activate')").then(() => false, (e) => /permission denied/.test(e.message)));
  ok("P07 reader cannot write the ledger", await readerC.query("INSERT INTO live_ai_03b_trusted.approval_consumption VALUES ('x','y','z','w','activate')").then(() => false, (e) => /permission denied|read-only/.test(e.message)));
  await superC.query("DROP ROLE m7s2_public_probe");
}

// ═══════════ C — Phase B BEFORE the Owner arm ⇒ no receipt, probe impossible ═══════════
const ledgerObs = await reader.observeCommittedLedger({ approvalId: ap.approvalId, executionId: ap.executionId });
const phaseB = async (nowIso = nowUtc()) => {
  const armed = await reader.observeArmed(), ceil = await reader.observeCeilings(), cnt = await reader.observeExposureCounts();
  return PF.runPreflightV2({ railway: RAILWAY(), preProbeSourceProof: testPreProbeSourceProof(), db: DB(), nowIso, testBoundary: true,
    approvalEnvelope: ap.envelope, trustRoot: rv.trustRoot, suppliedEvidence: ap.suppliedEvidence, executionId: ap.executionId,
    ledgerObservation: ledgerObs.observation, activationReceipt: act.activationReceipt,
    armedState: armed.ok ? armed.armedState : undefined, oneCallPolicy: ceil.ok ? ceil.oneCallPolicy : {}, counts: cnt.ok ? cnt.counts : {}, ...phaseBGates() });
};
const early = await phaseB().catch((e) => ({ pass: false, failures: [{ reason: "threw:" + e.message }] }));
ok("C00 Phase B before the policy/control arm ⇒ FAIL, no receipt", early.pass === false && !early.receipt, early.failures && early.failures.map((f) => f.reason));

// ═══════════ D — Owner arm (04 policy-v2 + 05 controls epoch 2) ⇒ Phase B receipt ═══════════
const o4 = psqlFile(`${SQLD}/m7-v2-04-one-call-policy-activation.sql`);
ok("D00 04 successor one-call policy (105,920) activated by the Owner", /postcondition OK/.test(o4.stdout + o4.stderr) && !/ERROR/.test(o4.stderr), o4.stderr);
const o5 = psqlFile(`${SQLD}/m7-v2-05-control-activation.sql`, [`control_updated_at=${nowUtc()}`]);
ok("D01 05 controls epoch 1→2 enabled by the Owner", /postcondition OK/.test(o5.stdout + o5.stderr) && !/ERROR/.test(o5.stderr), o5.stderr);
ok("D02 M6 canonical verifier PASS (armed)", m6pass());
const armedObs = await reader.observeArmed();
ok("D03 real armed state: V2 sole active; policy-v2 SOLE active; epoch 2 enabled", armedObs.ok && PF.checks.armedStateV2(armedObs.armedState).ok, armedObs.ok && PF.checks.armedStateV2(armedObs.armedState));
const ceilObs = await reader.observeCeilings();
ok("D04 real ceilings: 5 × 105,920 + calls 1 + admissions 1 (row identity AND values)", ceilObs.ok && ID.ceilingsExactV2(ceilObs.oneCallPolicy).ok, ceilObs);
const rArm = await viaReader("armed"), rCeil = await viaReader("ceilings");
ok("D05 reader chain: armed + ceilings observations equal the executor-side reads", !rArm.__fail && !rCeil.__fail && JSON.stringify(rArm.armedState) === JSON.stringify(armedObs.armedState) && JSON.stringify(rCeil.oneCallPolicy) === JSON.stringify(ceilObs.oneCallPolicy));
let pb = await phaseB();
ok("D06 Phase-B preflight PASS on real armed state + real committed ledger ⇒ FirstProbePreflightReceiptV2 issued", pb.pass && pb.receipt && pb.receipt.identity.consumed_at === act.consumedAt, pb.failures);

// ═══════════ E — the single probe (SYNTHETIC broker; no provider) ═══════════
{
  let v1sent = 0;
  const v1 = await V1_runProbe({ preflightReceipt: pb.receipt, nowIso: nowUtc(), sendViaStagingBroker: async () => { v1sent++; return {}; } });
  ok("E00 the frozen V1 probe refuses the V2 receipt (never sends)", !v1.sent && v1sent === 0, v1);
  pb = await phaseB(); // fresh receipt (≤ 15 s)
  let sends = 0; let payload = null;
  const pr = await runProbeV2({ preflightReceipt: pb.receipt, nowIso: nowUtc(), expectedApprovalId: ap.approvalId, expectedExecutionId: ap.executionId, expectedMode: "test",
    sendViaStagingBroker: async (p) => { sends++; payload = p; return { accepted: true, providerCalls: 1, spendMicros: 105920, reservationRef: "rsv-localpg-synthetic" }; } });
  ok("E01 V2 probe: ONE send of the frozen probe text through the injected broker; spend 105,920 within ceiling", pr.ok && sends === 1 && pr.withinCeiling === true && payload.text === ID.PROBE_TEXT && payload.oneCall === true, pr);
  const pr2 = await runProbeV2({ preflightReceipt: pb.receipt, nowIso: nowUtc(), expectedApprovalId: ap.approvalId, expectedExecutionId: ap.executionId, expectedMode: "test", sendViaStagingBroker: async () => { sends++; return {}; } });
  ok("E02 no second turn", pr2.reason === "probe_already_sent_no_second_turn" && sends === 1);
}

// ═══════════ F — tamper matrix on the armed DB (Owner-side edits, each reverted) ═══════════
const tamper = async (name, doSql, undoSql, check) => { await superC.query(doSql); let r; try { r = await check(); } finally { await superC.query(undoSql); } ok(name, r === true); };
const armedFails = async (reason) => { const a = await reader.observeArmed(); return a.ok && PF.checks.armedStateV2(a.armedState).reason === reason; };
const P = `id='${ID.POLICY_V2.id}'`;
for (const [f, d] of [["session_money_ceiling_micros", 1], ["session_money_ceiling_micros", -1], ["global_day_money_ceiling_micros", 1], ["project_month_money_ceiling_micros", -1], ["session_provider_calls", 1], ["session_execution_admissions", 1], ["subject_day_money_ceiling_micros", -1], ["project_day_money_ceiling_micros", 1]]) {
  await tamper(`F01 ceiling ${f} ${d > 0 ? "+1" : "-1"} ⇒ ceilings row no longer matches (zero rows) ⇒ fail closed`,
    `UPDATE public.budget_policy_versions SET ${f}=${f}+(${d}) WHERE ${P}`, `UPDATE public.budget_policy_versions SET ${f}=${f}-(${d}) WHERE ${P}`,
    async () => (await reader.observeCeilings()).reason === "ceilings_unavailable");
}
await tamper("F02 extra foreign active policy ⇒ policy-v2 not SOLE active ⇒ armed check fails",
  "INSERT INTO public.budget_policy_versions VALUES ('m7s2-foreign-policy','other-project','active','2026-09-28T15:26:23Z',NULL,1,1,1,1,1,1,1,'x','2026-09-28T15:26:23Z')",
  "DELETE FROM public.budget_policy_versions WHERE id='m7s2-foreign-policy'", () => armedFails("one_call_policy_v2_not_sole_active_or_digest_mismatch"));
await tamper("F03 V1 also active ⇒ V2 not sole active", `UPDATE public.budget_price_catalog_versions SET status='active' WHERE id='${ID.V1_HISTORICAL.id}'`,
  `UPDATE public.budget_price_catalog_versions SET status='inactive' WHERE id='${ID.V1_HISTORICAL.id}'`, () => armedFails("v2_not_sole_active_catalog"));
await tamper("F04 V1 expiry extended in place ⇒ fail", `UPDATE public.budget_price_catalog_entries SET verification_expires_at='2026-12-31T00:00:00Z' WHERE catalog_version_id='${ID.V1_HISTORICAL.id}'`,
  `UPDATE public.budget_price_catalog_entries SET verification_expires_at='${ID.V1_HISTORICAL.verification_expiry}' WHERE catalog_version_id='${ID.V1_HISTORICAL.id}'`, () => armedFails("v1_expiry_extended_or_altered"));
await tamper("F05 cache-write rate lowered to base ⇒ fail", `UPDATE public.budget_price_catalog_entries SET rate_micros=2000000 WHERE id='${ID.CATALOG_V2.entry_ids[1]}'`,
  `UPDATE public.budget_price_catalog_entries SET rate_micros=2500000 WHERE id='${ID.CATALOG_V2.entry_ids[1]}'`, () => armedFails("v2_cache_write_rate_missing_or_mismatch"));
await tamper("F06 control killed ⇒ fail", "UPDATE public.budget_control_epochs SET killed=true WHERE scope_type='global'", "UPDATE public.budget_control_epochs SET killed=false WHERE scope_type='global'", () => armedFails("control_killed"));
await tamper("F07 obsolete 89,536 policy row present ⇒ fail",
  "INSERT INTO public.budget_policy_versions VALUES ('live-ai-03b-policy-oneprobe-v1','live-ai-03b','inactive','2026-09-19T05:41:50Z',NULL,89536,1,1,89536,89536,89536,89536,'9927a920975c4e03f5cbf3adee23c34bb7396a032b00b029ba5a2c7ac0c8ec1c','2026-09-19T05:41:50Z')",
  "DELETE FROM public.budget_policy_versions WHERE id='live-ai-03b-policy-oneprobe-v1'", () => armedFails("policy_version_count_not_2"));
ok("F08 after every revert the armed state + ceilings pass again", PF.checks.armedStateV2((await reader.observeArmed()).armedState).ok && ID.ceilingsExactV2((await reader.observeCeilings()).oneCallPolicy).ok);
ok("F09 M6 canonical verifier PASS (armed, post-tamper-revert)", m6pass());

// ═══════════ G — restoration (Owner 07) ⇒ postflight; probe authority gone ═══════════
await superC.query(`INSERT INTO public.budget_sessions VALUES ('m7s2-test-bs','m7s2-test-gwdigest','m7s2-test-subject','live-ai-03b',now())`);
const o7 = psqlFile(`${SQLD}/m7-v2-07-dormant-restoration.sql`, [`control_updated_at=${nowUtc()}`]);
ok("G00 07 dormant restoration by the Owner", /dormant-restoration OK/.test(o7.stdout + o7.stderr) && !/ERROR/.test(o7.stderr), o7.stderr);
const rest = await reader.observeRestored();
ok("G01 real restored state: V2 inactive digest; policy-v2 restored digest; epoch 3; V1 never revived", rest.ok && PF.checks.restoredStateV2(rest.restoredState).ok, rest.ok && PF.checks.restoredStateV2(rest.restoredState));
const post = PF.runPostflightV2({ counts: { provider_reservations: 1, provider_calls: 1, envelopes: 1 }, settlement: { reservations_open: 0, settlements: 1, reservations: 1 },
  reconciliation: { all_envelopes_terminal: true }, actualSpendMicros: 105920, evidence: { accounting_rows_retained: Number((await one("SELECT count(*)::int AS n FROM public.budget_sessions")).n) === 1 },
  gatesAfterClose: { staging_text_enabled: false, staging_broker_enabled: false }, providerCredentialPresent: false, restoredState: rest.restoredState, core: { core_unchanged: true } });
ok("G02 postflight PASS on the real restored state (+ synthetic accounting evidence preserved)", post.pass, post.failures);
ok("G03 ledger evidence preserved (never deleted)", (await ledgerCount()) === 1);
ok("G04 M6 canonical verifier PASS (restored)", m6pass());
const rRest = await viaReader("restored");
ok("G05 reader chain: restored observation passes the restored-state check", !rRest.__fail && PF.checks.restoredStateV2(rRest.restoredState).ok, rRest.__fail);
const late = await phaseB();
ok("G06 Phase B after restoration ⇒ FAIL, no receipt (probe authority gone)", !late.pass && !late.receipt);
{
  const v = verifyApprovalV2({ envelope: ap.envelope, trustRoot: rv.trustRoot, suppliedEvidence: ap.suppliedEvidence, nowIso: nowUtc(), executionId: ap.executionId, isConsumed: () => false });
  const ad = makeRestrictedActivationAdapterV2({ dbClient: execC, targetBinding: tb, mode: "test" });
  const rr = await ad.restrictedDbRestore({ claims: v.claims, executionId: ap.executionId });
  ok("G07 executor restore path on the restored state: idempotent already_restored, no ledger write", rr.ok && rr.receipt.status === "already_restored" && (await ledgerCount()) === 1, rr);
}

// ═══════════ H (end) ═══════════
ok("H02 reader service still ready after the full lifecycle; independent attestations issued", readerSvc.ready() && att.issued() >= 1);
await readerSvc.stop();
ok("H03 reader service stops cleanly (listener closed)", !readerSvc.ready());
await Promise.all([superC.end(), readerC.end(), execC.end()]);
done();
