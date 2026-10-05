// TEST-ONLY — Owner-Mac Step6/7 controller against the in-memory mock Railway CLI. OFFLINE; nothing real is called.
import { mkdtempSync, writeFileSync, readdirSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { test, eq, ok, match, run } from "./_harness.mjs";
import { makeMockRailway, BASELINE_COMMIT } from "./fixtures/mock-railway.mjs";
import { kp } from "./fixtures/dual-env.mjs";
import { runPhase, evaluateGates, makeSpawnRunner, parseControllerArgs, PHASE_RECEIPT_SCHEMA } from "../controller/step67-controller.mjs";
import { phaseOf, PHASES } from "../controller/future-live-phase-plan.mjs";
import { ARGV } from "../controller/railway-argv.mjs";
import { buildNamesOnlyDocument, isNamesOnlyDocument, parseNamesOnlyState } from "../controller/names-only-state.mjs";
import { DEDICATED_PLAN, authorityWrites } from "../controller/reference-plan.mjs";
import { SERVICES, TARGET, DEDICATED_ATTESTER_ENV as DA } from "../src/constants.mjs";

const tmp = (p) => mkdtempSync(join(tmpdir(), "s67c-" + p + "-"));
const REVIEWED = "a".repeat(40);
function packageRootWithManifest() {
  const root = tmp("pkg");
  const files = [{ repoPath: "scripts/live-ai-03b/x/a.mjs", gitBlobSha1: "1".repeat(40) }, { repoPath: "scripts/live-ai-03b/x/b.mjs", gitBlobSha1: "2".repeat(40) }];
  const text = JSON.stringify({ files }, null, 2) + "\n";
  writeFileSync(join(root, "EVIDENCE-MANIFEST.json"), text);
  return { root, files, sha: createHash("sha256").update(text).digest("hex") };
}
function collisionFile(dir, phase, over = {}) {
  const p = join(dir, "cg-" + phase + "-" + randomUUID().slice(0, 8) + ".json");
  writeFileSync(p, JSON.stringify({ schema: "staybid-programme-collision-check-result-v1", outcome: "CLEAR_OF_RECORDED_COLLISION", decision: "CLEAR_OF_RECORDED_COLLISION_ONLY",
    candidate: { actionId: phaseOf(phase).actionId }, liveAuthorization: "LIVE_AUTHORIZATION_NOT_GRANTED_BY_COLLISION_GUARD", ...over }));
  return p;
}
function harness(mockOpts = {}) {
  const pkg = packageRootWithManifest();
  const M = makeMockRailway({ gitBlobs: pkg.files, ...mockOpts });
  const stateDir = tmp("state"), cgDir = tmp("cg");
  const m5 = kp(), ex = kp();
  const go = (phase, extra = {}) => runPhase({ phase, stateDir, runId: "run-" + phase.toLowerCase() + "-000001", execute: true,
    ownerAuthorizationRef: "OWNER-AUTH-STEP67-" + phase, confirmActionId: phaseOf(phase).actionId, collisionGuardResultPath: collisionFile(cgDir, phase),
    reviewedCommit: REVIEWED, manifestSha256: pkg.sha, m5ReaderAttesterFingerprint: m5.fp, executorAttesterFingerprint: ex.fp, ...extra },
    { runner: M.runner, packageRoot: pkg.root, wait: async () => {}, pollAttempts: 3, pollIntervalMs: 0 });
  return { M, stateDir, go, m5, ex, pkg };
}
/** drive P0..upTo with the simulated Owner dashboard steps in between */
async function driveTo(h, upTo, opts = {}) {
  const out = {};
  for (const p of PHASES.map((x) => x.phase)) {
    if (p === "P2") h.M.ownerCreateDedicated(opts.dedicatedId);
    if (p === "P5") h.M.ownerDeployAuthority(REVIEWED);
    if (p === "P6") h.M.ownerDeployDedicated(REVIEWED);
    const extra = p === "P2" ? { dedicatedServiceId: h.M.inst.dedicated.serviceId } : {};
    out[p] = await h.go(p, extra);
    if (p === upTo) break;
  }
  return out;
}
// the Authority's caller name for the reader channel secret is the SAME accepted name (LIVE_AI_03B_READER_ATTESTER_CHANNEL_SECRET) but carries a
// reference expression; the generated secret VALUES live only on the dedicated service
const secretValues = (M) => M.stdinCapture.filter((x) => x.serviceId === M.inst.dedicated.serviceId && (x.name === DA.signingKeyPkcs8B64 || x.name === DA.channelSecret)).map((x) => x.value);
function allStateText(dir) { return readdirSync(dir).map((f) => readFileSync(join(dir, f), "utf8")).join("\n"); }

test("K01", "dry-run (default) makes ZERO runner calls for every phase; P0 prints the plan", async () => {
  const runner = { run: async () => { throw new Error("runner must not be called in dry-run"); } };
  const st = tmp("dry");
  for (const p of PHASES) {
    const r = await runPhase({ phase: p.phase, stateDir: st, runId: "dry-run-000001" }, { runner, packageRoot: st });
    if (p.phase === "P0") { eq(r.exit, 0); match(r.text, /^DRY-RUN P0/); } else match(r.text, /PREVIOUS_PHASE_RECEIPT_ABSENT/);
  }
  eq(readdirSync(st).length, 0, "dry-run writes nothing");
});
test("K02", "execute gates: missing auth ref / wrong confirm id / collision absent, not CLEAR, other action, wrong schema ⇒ refused before any call or marker", async () => {
  const h = harness();
  await driveTo(h, "P1");
  h.M.ownerCreateDedicated();
  const id = h.M.inst.dedicated.serviceId, before = h.M.calls.length, cgd = tmp("cg2");
  const cases = [
    [{ ownerAuthorizationRef: undefined }, /OWNER_AUTHORIZATION_REF_REQUIRED/],
    [{ confirmActionId: "M7-STEP6-7-P3-DEDICATED-ATTESTER-VARIABLES" }, /CONFIRM_ACTION_ID_MISMATCH/],
    [{ collisionGuardResultPath: join(cgd, "absent.json") }, /COLLISION_RESULT_SCHEMA/],
    [{ collisionGuardResultPath: collisionFile(cgd, "P2", { outcome: "HOLD_SEMANTIC_COLLISION", decision: "HOLD_STOP" }) }, /COLLISION_RESULT_NOT_CLEAR/],
    [{ collisionGuardResultPath: collisionFile(cgd, "P3") }, /COLLISION_RESULT_ACTION_MISMATCH/],
    [{ collisionGuardResultPath: collisionFile(cgd, "P2", { schema: "x" }) }, /COLLISION_RESULT_SCHEMA/],
    [{ collisionGuardResultPath: collisionFile(cgd, "P2", { liveAuthorization: "GRANTED" }) }, /AUTHORIZATION_STATEMENT_MISSING/],
  ];
  for (const [over, re] of cases) { const r = await h.go("P2", { dedicatedServiceId: id, ...over }); eq(r.exit, 3); match(r.text, re); }
  eq(h.M.calls.length, before, "no runner call");
  ok(!existsSync(join(h.stateDir, "P2.attempt-started")), "no attempt marker consumed");
});
test("K03", "full P0→P9 happy path: all PASS; values only on stdin; secrets never in argv/state/receipts; exact write sets; no frozen target", async () => {
  const h = harness();
  const out = await driveTo(h, "P9");
  for (const p of Object.keys(out)) { eq(out[p].exit, 0, p + " " + out[p].text.slice(0, 160)); eq(out[p].receipt.outcome, "PASS", p); eq(out[p].receipt.schema, PHASE_RECEIPT_SCHEMA); }
  const sec = secretValues(h.M);
  eq(sec.length, 2, "two generated secrets staged");
  const argvText = h.M.calls.map((c) => c.argv.join(" ")).join("\n");
  for (const s of sec) { ok(!argvText.includes(s), "secret in argv"); ok(!allStateText(h.stateDir).includes(s), "secret in state dir"); ok(!Object.values(out).some((o) => o.text.includes(s)), "secret in output"); }
  const ded = h.M.inst.dedicated.serviceId;
  eq(h.M.stdinCapture.filter((x) => x.serviceId === ded).map((x) => x.name).sort().join(","), DEDICATED_PLAN.map((e) => e.dest).sort().join(","));
  eq(h.M.stdinCapture.filter((x) => x.serviceId === ded).slice(-2).map((x) => x.name).sort().join(","), [DA.channelSecret, DA.signingKeyPkcs8B64].sort().join(","), "secrets written last");
  const aw = h.M.stdinCapture.filter((x) => x.serviceId === SERVICES.authority.id);
  eq(JSON.stringify(aw.map((x) => [x.name, x.value])), JSON.stringify(authorityWrites().map((w) => [w.name, w.stdinValue])), "Authority receives exactly the 13 reference expressions");
  const ew = h.M.stdinCapture.filter((x) => x.serviceId === SERVICES.executorAttester.id);
  eq(ew.length, 1); eq(ew[0].name, "LIVE_AI_03B_EXECUTOR_ATTESTER_ALLOWED_PEER_CIDRS"); eq(ew[0].value, "fd12:3456:789a::5/128");
  ok(h.M.calls.every((c) => c.bin !== "railway" || c.argv[0] !== "variable" || c.hasStdin), "every variable set carries its value on stdin");
  for (const id of [SERVICES.m5ReaderAttester.id, SERVICES.m5ReaderHost.id, TARGET.postgresServiceId, TARGET.coreProdProjectId, TARGET.coreProdPostgresId])
    ok(!h.M.calls.some((c) => c.argv.includes(id) && c.argv[0] !== "api"), "frozen/CORE-PROD target in a command: " + id);
  eq(h.M.calls.filter((c) => c.argv[0] === "deployment").length, 1, "exactly one redeploy (executor attester)");
  eq(out.P8.receipt.facts.step67Receipt.marker, h.M.SUCCESS_MARKER);
  eq(out.P3.receipt.facts.expectedReaderAttesterFingerprint, out.P8.receipt.facts.step67Receipt.pins.expectedReaderAttesterFingerprint);
  ok(!h.M.calls.some((c) => /variables|delete|domain|tcp|connect|^up$|^run$/.test(c.argv[0] + " " + (c.argv[1] || ""))), "no forbidden railway subcommand");
});
test("K04", "one-shot: a completed phase cannot be re-run; an attempt marker without a receipt (ambiguous) blocks every retry", async () => {
  const h = harness();
  await driveTo(h, "P0");
  const n = h.M.calls.length;
  const r = await h.go("P0"); eq(r.exit, 3); match(r.text, /RECEIPT_EXISTS|PRIOR_ATTEMPT/);
  writeFileSync(join(h.stateDir, "P1.attempt-started"), "run-x\n");
  const r1 = await h.go("P1"); eq(r1.exit, 3); match(r1.text, /PRIOR_ATTEMPT_EXISTS_AMBIGUOUS_OR_COMPLETE_NO_AUTO_RETRY/);
  eq(h.M.calls.length, n, "no call on refused retries");
});
test("K05", "P3 partial variable-set failure ⇒ HOLD ambiguous with the names written so far; P4 refused afterwards", async () => {
  const h = harness({ failVariableSetAt: 4 });
  const out = await driveTo(h, "P3");
  eq(out.P3.exit, 3); match(out.P3.receipt.reason, /partial_state_ambiguous/);
  eq(out.P3.receipt.facts.variableNamesWritten.length, 3);
  const r4 = await h.go("P4"); match(r4.text, /PREVIOUS_PHASE_NOT_PASS_P3/);
});
test("K06", "P0 HOLDs: dedicated service already exists / executor commit not pinned / Authority holds a forbidden name / public domain", async () => {
  { const h = harness(); h.M.ownerCreateDedicated(); const r = await h.go("P0"); match(r.receipt.reason, /dedicated_service_already_exists/); }
  { const h = harness(); h.M.inst.executorAttester.latestDeployment.meta.commitHash = "b".repeat(40); const r = await h.go("P0"); match(r.receipt.reason, /executor_attester_commit_not_pinned/); }
  { const h = harness(); h.M.names[SERVICES.authority.id].push("LIVE_AI_03B_ATTESTER_SIGNING_KEY_PKCS8_B64"); const r = await h.go("P0"); match(r.receipt.reason, /forbidden_name/); }
  { const h = harness(); h.M.inst.m5ReaderHost.domains.serviceDomains.push({ id: "x" }); const r = await h.go("P0"); match(r.receipt.reason, /not_private_only:m5ReaderHost/); }
});
test("K07", "M5 frozen snapshot changes after P0 (redeploy or variable-name change) ⇒ later phases HOLD", async () => {
  const h = harness();
  await driveTo(h, "P1");
  h.M.inst.m5ReaderAttester.latestDeployment.id = randomUUID();
  h.M.ownerCreateDedicated();
  const r = await h.go("P2", { dedicatedServiceId: h.M.inst.dedicated.serviceId });
  eq(r.exit, 3); match(r.receipt.reason, /m5_snapshot_changed/);
});
test("K08", "P7: public / broad peer address refused before any write; Authority redeployed since P5 refused before ssh", async () => {
  { const h = harness({ peerCidrs: ["8.8.8.8/32"] }); const out = await driveTo(h, "P7"); eq(out.P7.exit, 3); match(out.P7.receipt.reason, /not_exact_private_hosts/);
    ok(!h.M.stdinCapture.some((x) => x.serviceId === SERVICES.executorAttester.id), "no executor write"); }
  { const h = harness({ peerCidrs: ["fd12:3456:789a::/64"] }); const out = await driveTo(h, "P7"); eq(out.P7.exit, 3); }
  { const h = harness(); await driveTo(h, "P6"); h.M.ownerDeployAuthority(REVIEWED); const n = h.M.calls.length;
    const r = await h.go("P7"); match(r.receipt.reason, /authority_redeployed_since_p5/); ok(!h.M.calls.slice(n).some((c) => c.argv[0] === "ssh"), "no ssh"); }
});
test("K09", "P8: ambiguous (two receipts), unsafe, pin-mismatched receipts refused; an Authority HOLD is recorded and P9 still runs", async () => {
  for (const [mode, re] of [["two-lines", /absent_or_ambiguous/], ["unsafe", /unsafe/], ["pin-mismatch", /binding_mismatch/]]) {
    const h = harness({ verifyMode: mode }); const out = await driveTo(h, "P8"); eq(out.P8.exit, 3, mode); match(out.P8.receipt.reason, re, mode);
  }
  const h = harness({ verifyMode: "hold" }); const out = await driveTo(h, "P9");
  eq(out.P8.receipt.outcome, "HOLD"); match(out.P8.receipt.reason, /step67_hold/); eq(out.P9.receipt.outcome, "PASS");
});
test("K10", "argv builders: no delete/list/run/up builders; frozen/CORE-PROD targets, non-executor redeploy, other ssh scripts and unsafe args refused", async () => {
  eq(Object.keys(ARGV).sort().join(","), "namesOnlyState,redeploy,sshAuthorityNode,sshHelp,variableSet,variableSetHelp,version,whoami");
  const thr = (f) => { try { f(); return null; } catch (e) { return e.message; } };
  match(thr(() => ARGV.variableSet(SERVICES.m5ReaderAttester.id, "X_Y")), /frozen_service/);
  match(thr(() => ARGV.variableSet(SERVICES.m5ReaderHost.id, "X_Y")), /frozen_service/);
  match(thr(() => ARGV.variableSet(TARGET.coreProdPostgresId, "X_Y")), /core_prod/);
  match(thr(() => ARGV.variableSet(SERVICES.executorAttester.id, "LIVE_AI_03B_EXECUTOR_ATTESTER_CHANNEL_SECRET")), /limited_to_peer_cidrs/);
  match(thr(() => ARGV.variableSet(SERVICES.authority.id, "bad name")), /variable_name_invalid/);
  match(thr(() => ARGV.redeploy(SERVICES.authority.id)), /only_permitted_for_executor/);
  match(thr(() => ARGV.sshAuthorityNode("scripts/evil.mjs")), /not_permitted/);
  match(thr(() => ARGV.sshAuthorityNode("scripts/live-ai-03b/m7-step67-authority-dedicated-reader-attester-offline-01/src/authority-peer-identity.mjs", ["a;rm"])), /arg_not_permitted/);
  ok(ARGV.variableSet(SERVICES.authority.id, "X_Y").argv.includes("--skip-deploys"));
});
test("K11", "names-only document is value-free; parser refuses value fields, GraphQL errors, CORE-PROD ids, incomplete pagination", async () => {
  ok(isNamesOnlyDocument(buildNamesOnlyDocument({ dedicatedServiceId: randomUUID() })));
  ok(!isNamesOnlyDocument(buildNamesOnlyDocument({}).replace("name serviceId environmentId", "name value serviceId environmentId")));
  ok(!isNamesOnlyDocument("mutation { x }"));
  const good = { data: { project: { services: { pageInfo: { hasNextPage: false }, edges: [] } }, environment: { variables: { pageInfo: { hasNextPage: false }, edges: [] } } } };
  eq(parseNamesOnlyState(good).ok, true);
  match(parseNamesOnlyState({ errors: [{ message: "x" }] }).reason, /graphql_errors/);
  const v = JSON.parse(JSON.stringify(good)); v.data.environment.variables.edges.push({ node: { name: "A_B", value: "s", serviceId: "x", environmentId: TARGET.environmentId } });
  match(parseNamesOnlyState(v).reason, /variable_shape_unexpected/);
  const c = JSON.parse(JSON.stringify(good)); c.data.project.services.edges.push({ node: { id: TARGET.coreProdProjectId, name: "x" } });
  match(parseNamesOnlyState(c).reason, /core_prod/);
  const p = JSON.parse(JSON.stringify(good)); p.data.environment.variables.pageInfo.hasNextPage = true;
  match(parseNamesOnlyState(p).reason, /incomplete/);
});
test("K12", "spawn runner: shell:false, only railway/git binaries, environment allowlist (no secret/DB env reaches the child)", async () => {
  const r = makeSpawnRunner({ env: { PATH: process.env.PATH, HOME: process.env.HOME || "/tmp", LIVE_AI_03B_TRUSTED_EXECUTOR_DB_URL: "postgresql://u:p@h/db", SOME_SECRET: "zzz" } });
  let refused = null; try { await r.run("sh", ["-c", "env"]); } catch (e) { refused = e.message; }
  eq(refused, "binary_not_permitted");
  const out = await r.run("git", ["-c", "alias.showenv=!env", "showenv"]);
  ok(out.stdout.includes("PATH="), "PATH passed");
  ok(!out.stdout.includes("SOME_SECRET") && !out.stdout.includes("TRUSTED_EXECUTOR_DB_URL"), "secret env withheld");
});
test("K13", "CLI parsing: unknown flag / duplicate / missing value ⇒ usage; --execute is explicit", async () => {
  eq(parseControllerArgs(["--phase", "P0", "--bogus", "x"]).ok, false);
  eq(parseControllerArgs(["--phase", "P0", "--phase", "P1"]).ok, false);
  eq(parseControllerArgs(["--phase", "--execute"]).ok, false);
  eq(parseControllerArgs(["--phase", "P0"]).opts.execute, false);
  eq(parseControllerArgs(["--phase", "P0", "--execute"]).opts.execute, true);
  match(evaluateGates({ phase: "P10", runId: "run-000001", stateDir: "/tmp" }).reason, /phase_unknown/);
});
test("K14", "P2 verification: dedicated service must be private, undeployed, variable-free, correctly named; id must not collide with a pinned service", async () => {
  { const h = harness(); await driveTo(h, "P1"); h.M.ownerCreateDedicated(undefined, { domains: 1 });
    const r = await h.go("P2", { dedicatedServiceId: h.M.inst.dedicated.serviceId }); match(r.receipt.reason, /public_domain_present|not_private/); }
  { const h = harness(); await driveTo(h, "P1"); h.M.ownerCreateDedicated(); h.M.tcp.dedicated = 1;
    const r = await h.go("P2", { dedicatedServiceId: h.M.inst.dedicated.serviceId }); match(r.receipt.reason, /not_private_only/); }
  { const h = harness(); await driveTo(h, "P1"); h.M.ownerCreateDedicated(); h.M.names[h.M.inst.dedicated.serviceId] = ["X_Y"];
    const r = await h.go("P2", { dedicatedServiceId: h.M.inst.dedicated.serviceId }); match(r.receipt.reason, /has_variables/); }
  { const h = harness(); await driveTo(h, "P1"); h.M.ownerCreateDedicated();
    const r = await h.go("P2", { dedicatedServiceId: SERVICES.m5ReaderAttester.id }); match(r.receipt.reason, /collides_with_pinned_service/); }
});

await run("controller.test.mjs");
