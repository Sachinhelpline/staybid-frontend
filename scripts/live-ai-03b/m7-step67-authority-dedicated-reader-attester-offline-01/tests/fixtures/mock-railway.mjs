// TEST-ONLY — in-memory mock of the Railway CLI (+ the two git read commands) for the Step6/7 controller. OFFLINE.
// It answers ONLY the argv shapes the controller's builders produce; anything else returns exit 2 and is recorded,
// so a test can assert that no unplanned command was ever issued. It models variable NAMES only (values written via
// stdin are kept in a separate test-only capture so tests can prove they never leak into argv, files or receipts).
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { SERVICES, TARGET, DB_ENV, DEDICATED_ATTESTER_ENV as DA, AUTHORITY_STANDBY_START_COMMAND, DEDICATED_ATTESTER_START_COMMAND, SUCCESS_MARKER } from "../../src/constants.mjs";
import { buildReceipt } from "../../src/receipt.mjs";

export const BASELINE_COMMIT = "1f5e8f66fe5892253d4b68eab006fe3e77107ee4";
const REPO = "Sachinhelpline/staybid-frontend";
const si = (id, name, { start = "node old-entrypoint.mjs", dep = null, commit = null, status = "SUCCESS", domains = 0 } = {}) => ({
  serviceId: id, serviceName: name, environmentId: TARGET.environmentId, numReplicas: 1, startCommand: start, rootDirectory: "/",
  source: { repo: REPO, image: null }, latestDeployment: dep ? { id: dep, status, meta: { commitHash: commit } } : null,
  domains: { serviceDomains: Array.from({ length: domains }, () => ({ id: randomUUID() })), customDomains: [] } });

export function makeMockRailway(opts = {}) {
  const services = [
    { id: SERVICES.authority.id, name: SERVICES.authority.name }, { id: SERVICES.executorAttester.id, name: SERVICES.executorAttester.name },
    { id: SERVICES.m5ReaderAttester.id, name: SERVICES.m5ReaderAttester.name }, { id: SERVICES.m5ReaderHost.id, name: "live-ai-03b-reader-host" },
    { id: TARGET.postgresServiceId, name: "Postgres" }];
  const inst = {
    authority: si(SERVICES.authority.id, SERVICES.authority.name, { dep: randomUUID(), commit: BASELINE_COMMIT }),
    executorAttester: si(SERVICES.executorAttester.id, SERVICES.executorAttester.name, { dep: SERVICES.executorAttester.deploymentId, commit: SERVICES.executorAttester.sourceCommit }),
    m5ReaderAttester: si(SERVICES.m5ReaderAttester.id, SERVICES.m5ReaderAttester.name, { dep: SERVICES.m5ReaderAttester.deploymentId, commit: BASELINE_COMMIT }),
    m5ReaderHost: si(SERVICES.m5ReaderHost.id, "live-ai-03b-reader-host", { dep: randomUUID(), commit: BASELINE_COMMIT }),
    postgres: si(TARGET.postgresServiceId, "Postgres", { dep: randomUUID(), commit: null }),
  };
  const tcp = { authority: 0, executorAttester: 0, m5ReaderAttester: 0, m5ReaderHost: 0, postgres: 0, dedicated: 0 };
  const names = {
    [SERVICES.authority.id]: [DB_ENV.executorDbUrl, DB_ENV.readerDbUrl, "LIVE_AI_03B_TRUSTED_RUNTIME_MODE"],
    [SERVICES.executorAttester.id]: ["LIVE_AI_03B_EXECUTOR_ATTESTER_ISSUER", "LIVE_AI_03B_EXECUTOR_ATTESTER_SIGNING_KEY_PKCS8_B64", "LIVE_AI_03B_EXECUTOR_ATTESTER_ALLOWED_PEER_CIDRS"],
    [SERVICES.m5ReaderAttester.id]: Object.values(DA).filter((n) => n !== DA.clockStatementTimeoutMs),
    [SERVICES.m5ReaderHost.id]: ["LIVE_AI_03B_READER_TRANSPORT_SECRET"],
    [TARGET.postgresServiceId]: ["PGDATA"],
  };
  const calls = [], stdinCapture = [];
  const cfg = { peerCidrs: ["fd12:3456:789a::5/128"], verifyMode: "pass", failVariableSetAt: null, gitBlobs: null, redeployStatus: "SUCCESS", ...opts };
  let dedicatedId = null, variableSets = 0;

  function stateJson(doc) {
    const d = {
      project: { id: TARGET.projectId, services: { pageInfo: { hasNextPage: false }, edges: services.map((s) => ({ node: { ...s } })) } },
      environment: { id: TARGET.environmentId, variables: { pageInfo: { hasNextPage: false }, edges: Object.entries(names).flatMap(([sid, ns]) => ns.map((n) => ({ node: { name: n, serviceId: sid, environmentId: TARGET.environmentId } }))) } },
    };
    for (const a of ["authority", "executorAttester", "m5ReaderAttester", "m5ReaderHost", "postgres", "dedicated"]) {
      if (!new RegExp("\\b" + a + ": serviceInstance").test(doc)) continue;
      d[a] = inst[a] ? JSON.parse(JSON.stringify(inst[a])) : null;
      d[a + "Tcp"] = Array.from({ length: tcp[a] || 0 }, () => ({ id: randomUUID() }));
    }
    return JSON.stringify({ data: d });
  }
  const aliasOf = (id) => Object.keys(inst).find((a) => inst[a] && inst[a].serviceId === id);
  function verifyOutput(argv) {
    const get = (k) => argv[argv.indexOf(k) + 1];
    const pins = { expectedExecutorAttesterFingerprint: get("--expected-executor-attester-fingerprint"), expectedReaderAttesterFingerprint: get("--expected-reader-attester-fingerprint"),
      forbiddenReaderAttesterFingerprint: get("--forbidden-reader-attester-fingerprint") };
    const all = ["executorConnectionEstablished", "executorSessionRole", "trustedClockBoundToDb", "readerConnectionEstablished", "readerSessionRole", "readerReadOnlySession",
      "readerStatementTimeoutBounded", "readerProtocolV2ClockGated", "executorAttestationSignatureTrustFreshness", "executorPrivilegeContract", "executorTargetBinding",
      "readerAttestationSignatureTrustFreshness", "readerPrivilegeContract", "readerTargetBinding", "distinctRoles", "distinctPhysicalSessions", "distinctConnectionTokens",
      "distinctBackendPids", "distinctApplicationNames", "distinctRequestNonces", "distinctBoundConnectionTokens", "noReconnectUnderBoundProof", "connectionsClosed"];
    const pass = cfg.verifyMode !== "hold";
    const result = pass ? { ok: true, stage: "S12_complete", checks: Object.fromEntries(all.map((k) => [k, true])), counters: { realConnectionsOpened: 2, attestationRequestsIssued: 2 } }
      : { ok: false, stage: "S7_reader_v2_attestation", reason: "reader_v2_attestation_clock_gate_failed", checks: {}, counters: { realConnectionsOpened: 2, attestationRequestsIssued: 2 } };
    const b = buildReceipt({ runId: get("--run-id"), startedUtc: "2026-10-05T00:00:00.000Z", finishedUtc: "2026-10-05T00:00:02.000Z", result,
      pins: cfg.verifyMode === "pin-mismatch" ? { ...pins, expectedReaderAttesterFingerprint: "e".repeat(64) } : pins });
    let rec = b.receipt;
    if (cfg.verifyMode === "unsafe") rec = { ...rec, reason: "leak_" + "9".repeat(40) };
    const line = "STEP67_RECEIPT " + JSON.stringify(rec);
    const out = cfg.verifyMode === "two-lines" ? line + "\n" + line + "\n" : line + "\n" + rec.marker + "\n";
    return { code: pass ? 0 : 3, stdout: out, stderr: "" };
  }

  const runner = {
    async run(bin, argv, { stdin = null } = {}) {
      calls.push({ bin, argv: argv.slice(), hasStdin: stdin !== null });
      if (bin === "git") {
        if (argv[0] === "cat-file") return { code: 0, stdout: "", stderr: "" };
        if (argv[0] === "ls-tree") return { code: 0, stdout: (cfg.gitBlobs || []).map((f) => `100644 blob ${f.gitBlobSha1}\t${f.repoPath}`).join("\n") + "\n", stderr: "" };
        return { code: 2, stdout: "", stderr: "" };
      }
      if (bin !== "railway") return { code: 2, stdout: "", stderr: "" };
      const a0 = argv[0];
      if (a0 === "--version") return { code: 0, stdout: "railway 4.x\n", stderr: "" };
      if (a0 === "whoami") return { code: 0, stdout: "{\"name\":\"owner\"}\n", stderr: "" };
      if (a0 === "api" && argv[1] === "-f") return { code: 0, stdout: stateJson(readFileSync(argv[2], "utf8")), stderr: "" };
      if (a0 === "variable" && argv[1] === "set" && argv[3] === "--stdin" && argv[4] === "--skip-deploys") {
        variableSets++;
        if (cfg.failVariableSetAt !== null && variableSets === cfg.failVariableSetAt) return { code: 1, stdout: "", stderr: "" };
        const sid = argv[argv.indexOf("--service") + 1];
        stdinCapture.push({ serviceId: sid, name: argv[2], value: stdin });
        names[sid] = Array.from(new Set([...(names[sid] || []), argv[2]])).sort();
        return { code: 0, stdout: "{\"echo\":\"" + (stdin || "") + "\"}\n", stderr: "" };   // a hostile CLI that echoes the value — controller must discard it
      }
      if (a0 === "deployment" && argv[1] === "redeploy") {
        const al = aliasOf(argv[argv.indexOf("--service") + 1]);
        inst[al].latestDeployment = { id: randomUUID(), status: cfg.redeployStatus, meta: { commitHash: inst[al].latestDeployment.meta.commitHash } };
        return { code: 0, stdout: "{}\n", stderr: "" };
      }
      if (a0 === "ssh") {
        const script = argv[argv.indexOf("--") + 2] || "";
        if (script.endsWith("authority-peer-identity.mjs"))
          return { code: 0, stdout: "STEP67_AUTHORITY_PEER_IDENTITY " + JSON.stringify({ version: "m7-step67-authority-peer-identity-v1", ok: true, serviceName: SERVICES.authority.name + ".railway.internal", cidrs: cfg.peerCidrs }) + "\n", stderr: "" };
        if (script.endsWith("step67-verification-entrypoint.mjs")) return verifyOutput(argv);
      }
      return { code: 2, stdout: "", stderr: "" };
    },
  };
  return {
    runner, calls, stdinCapture, cfg, inst, names, services, tcp,
    // ── simulated Owner dashboard actions (P2 / P5 / P6) ──
    ownerCreateDedicated(id = randomUUID(), over = {}) {
      dedicatedId = id; services.push({ id, name: SERVICES.dedicatedReaderAttester.name });
      inst.dedicated = si(id, SERVICES.dedicatedReaderAttester.name, { start: DEDICATED_ATTESTER_START_COMMAND, ...over }); names[id] = []; return id;
    },
    ownerDeployAuthority(commit) { inst.authority = si(SERVICES.authority.id, SERVICES.authority.name, { start: AUTHORITY_STANDBY_START_COMMAND, dep: randomUUID(), commit }); },
    ownerDeployDedicated(commit) { inst.dedicated = si(dedicatedId, SERVICES.dedicatedReaderAttester.name, { start: DEDICATED_ATTESTER_START_COMMAND, dep: randomUUID(), commit }); },
    SUCCESS_MARKER,
  };
}
