// §17/§23 — REAL PostgreSQL (throwaway local unix-socket cluster) + the REAL `pg` driver. MODE=old runs the
// UNMODIFIED baseline modules; MODE=new runs the candidate. One mode per PROCESS (pg's util.deprecate warning is
// once-per-process). Stall injection = SIGSTOP/SIGCONT of the attester clock session's backend. Never Railway.
import net from "node:net";
import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";
import { execSync } from "node:child_process";
import { bdir, s03b, sleep, makeOk, waitFor } from "./lib.mjs";

const MODE = process.argv[2];
// old = baseline f5ec5807 · v1 = prior reviewed candidate (shutdown red side only) · new = revised candidate
const TREE = MODE === "old" ? process.env.M5ACR_BASELINE_TREE : (MODE === "v1" ? process.env.M5ACR_V1_TREE : process.env.M5ACR_CANDIDATE_TREE);
if (!TREE || !["old", "v1", "new"].includes(MODE) || !process.env.PGSOCK) { console.log("realpg-scenario: MODE + tree + PGSOCK required (a skip is not a pass)"); process.exit(2); }
const B = bdir(TREE);
const { makeProductionClockSampler, makeClockSamplerOverPhysical } = await import(B + "/production-db-clock.mjs");
const { startAttesterBootstrap } = await import(B + "/attester-bootstrap.mjs");
const { buildV2Request } = await import(B + "/attestation-channel-v2.mjs");
const { makeBootstrapEnv } = await import(B + "/tests/fixtures/synthetic-env.mjs");
const { clusterFingerprint } = await import(s03b(TREE) + "/private-reader-attester-offline-01/target-binding.mjs");
const { makePgPhysicalFactory } = await import(s03b(TREE) + "/private-reader-production-integration-offline-01/reader-session.mjs");
const pg = createRequire(TREE + "/package.json")("pg");
const T = makeOk(`m5acr-realpg[${MODE}]`); const { ok } = T;
const warnings = []; process.on("warning", (w) => warnings.push({ name: w.name, message: String(w.message).slice(0, 80) }));
const pgWarn = () => warnings.filter((w) => w.name === "DeprecationWarning" && w.message.startsWith("Calling client.query() when the client is already executing a query"));

const CONN = `postgresql://postgres@/railway?host=${encodeURIComponent(process.env.PGSOCK)}`;
const ENV = { M5ACR_DB_URL: CONN };
const SECRET = randomBytes(32).toString("hex"); const hex = (n) => randomBytes(n).toString("hex");
const admin = new pg.Client({ connectionString: CONN, application_name: "m5acr-admin" }); await admin.connect();
const f = (await admin.query("SELECT current_database() AS d, (SELECT oid FROM pg_database WHERE datname=current_database())::text AS o, (SELECT oid FROM pg_roles WHERE rolname='live_ai_03b_reader')::text AS r, (SELECT encoding::text FROM pg_database WHERE datname=current_database()) AS e, current_setting('server_version') AS v")).rows[0];
const fp = clusterFingerprint({ datname: f.d, databaseOid: f.o, readerRoleOid: f.r, encoding: f.e });
console.log(`  server_version=${f.v}`);
const backends = async () => (await admin.query("SELECT pid FROM pg_stat_activity WHERE datname='railway' AND application_name <> 'm5acr-admin' AND backend_type='client backend' ORDER BY backend_start")).rows.map((r) => r.pid);

const env = await makeBootstrapEnv({ rttUs: 2000 });

/**
 * Real-PG SHUTDOWN scenario: stall-induced recovery in flight + a DELAYED OPEN (the postmaster is SIGSTOPped so the
 * reconnect is genuinely pending), then stop, then the postmaster resumes and the open completes LATE.
 * kind "new" uses the revised composition helper; kind "v1" replicates v1's composition stop body verbatim
 * (await baseStop(); await sampler.close()). Counts STARTS from the sampler's own counters + live pg_stat_activity.
 */
async function shutdownScenario(kind) {
  const fs = await import("node:fs");
  const pmPid = Number(fs.readFileSync(process.env.PGSOCK + "/data/postmaster.pid", "utf8").split("\n")[0]);
  const before = new Set(await backends());
  const s2 = makeProductionClockSampler({ env: ENV, connectionStringEnvName: "M5ACR_DB_URL", expectedFingerprint: fp, statementTimeoutMs: 2000 });
  const ev2 = [];
  const att2 = await startAttesterBootstrap({ takeSampleFn: s2.takeSampleFn, observerProvider: env.observerProvider, signer: env.signer, anchor: env.anchor, channelSecret: SECRET,
    listen: { bindHost: "127.0.0.1", port: 0 }, peerCidrs: env.peerCidrs, monoNowUs: s2.monoNowUs, offlineTestBoundary: true, startMonitor: false, autoRecover: true, recoveryBackoffMs: [50],
    log: (l) => { try { ev2.push(JSON.parse(l).event); } catch {} } });
  const pid2 = (await backends()).find((p) => !before.has(p));
  execSync(`kill -STOP ${pid2}`); await att2.monitor.sampleOnce();              // probe deadline → session retired → CLOCK_INVALID
  execSync(`kill -STOP ${pmPid}`); execSync(`kill -CONT ${pid2}`);             // new connections now block at the postmaster
  const openStarted = () => (kind === "new" ? s2.stats().opensStarted : null);
  await waitFor(() => att2.recovery().inFlight === true, 3000, 20);
  await sleep(300);                                                             // recovery sample → ensure → open pending
  const st0 = s2.stats(); const at = { samples: st0.samples, sql: st0.sqlStarted ?? null, opens: openStarted() };
  const baseStop = att2.stop;
  const stop = kind === "new"
    ? (await import(B + "/production-attester.mjs")).makeContainedAttesterStop({ supervisor: null, baseStop, sampler: s2 })
    : async () => { try { await baseStop(); } catch {} try { await s2.close(); } catch {} return true; };
  const t0 = Date.now(); const stopping = stop();
  await sleep(200); execSync(`kill -CONT ${pmPid}`);                           // the pending open completes LATE
  await stopping; const stopMs = Date.now() - t0;
  await sleep(2500);
  const st1 = s2.stats(); const leftover = (await backends()).filter((p) => !before.has(p) && p !== pid2);
  return { at, after: { samples: st1.samples, sql: st1.sqlStarted ?? null, opens: openStarted(), lateOpensRetired: st1.lateOpensRetired ?? null, hasPhysical: st1.hasPhysical }, leftover, stopMs,
    status: att2.status(), signing: att2.signingReady(), restored: ev2.includes("signing_restored"), s2, att2 };
}

if (MODE === "v1") {
  const r = await shutdownScenario("v1");
  console.log("  v1 shutdown: " + JSON.stringify({ at: r.at, after: r.after, leftover: r.leftover.length, stopMs: r.stopMs }));
  ok("S1 V1 RED: samples kept STARTING after stop (the recovery gate continued)", r.after.samples > r.at.samples);
  ok("S2 V1 RED: the late-completing real connection was INSTALLED as the current physical after close()", r.after.hasPhysical === true);
  ok("S3 V1 RED: that late session is still open (a live backend leaked past shutdown)", r.leftover.length >= 1);
  ok("S4 V1: authority unaffected — no signing restore, status STOPPED", r.restored === false && r.signing === false && r.status === "STOPPED");
  await r.s2.close(); await admin.end(); await env.cleanup();
  T.done(4);
}
const events = []; const markers = [];
let log = (l) => { try { events.push(JSON.parse(l).event); } catch {} };
if (MODE === "new") {
  const { makeSafeAttesterLogger } = await import(B + "/bootstrap-entrypoint-attester.mjs");
  const safe = makeSafeAttesterLogger((m) => markers.push(m));
  log = (l) => { try { events.push(JSON.parse(l).event); } catch {} safe(l); };
}
const sampler = makeProductionClockSampler({ env: ENV, connectionStringEnvName: "M5ACR_DB_URL", expectedFingerprint: fp, statementTimeoutMs: 2000 });
const att = await startAttesterBootstrap({ takeSampleFn: sampler.takeSampleFn, observerProvider: env.observerProvider, signer: env.signer, anchor: env.anchor, channelSecret: SECRET,
  listen: { bindHost: "127.0.0.1", port: 0 }, peerCidrs: env.peerCidrs, monoNowUs: sampler.monoNowUs, offlineTestBoundary: true, startMonitor: true, log,
  autoRecover: true });                         // ignored by the baseline (option did not exist); production default backoff
ok("R0 attester up over a REAL pg session: startup gate + seed passed, signing ready", att.started === true && att.signingReady() === true);
const pids0 = await backends();
ok("R1 exactly one physical clock session serves the attester monitor", pids0.length === 1);
const clockPid = pids0[0];
const rdr = makeProductionClockSampler({ env: ENV, connectionStringEnvName: "M5ACR_DB_URL", expectedFingerprint: fp, statementTimeoutMs: 2000 });
async function attest() {
  const rs = await rdr.takeSampleFn(); if (!rs.ok) return { code: "reader_sample_failed" };
  const line = buildV2Request({ channelSecret: SECRET, connectionToken: env.connectionToken, requestNonce: hex(16), readerClock: { L: rs.L, U: rs.U, generation: hex(16) }, nonce: hex(16), ts: Date.now() });
  return new Promise((resolve) => { let buf = ""; const s = net.createConnection({ host: "127.0.0.1", port: att.address.port }); const to = setTimeout(() => { s.destroy(); resolve({ code: "client_timeout" }); }, 5000);
    s.on("connect", () => s.write(line)); s.setEncoding("utf8"); s.on("data", (d) => (buf += d)); s.on("end", () => { clearTimeout(to); try { resolve(JSON.parse(buf.trim())); } catch { resolve({ code: "parse" }); } }); s.on("error", () => { clearTimeout(to); resolve({ code: "sockerr" }); }); });
}
ok("R2 a valid request is signed before the stall", (await attest()).ok === true);

execSync(`kill -STOP ${clockPid}`); await sleep(3200); execSync(`kill -CONT ${clockPid}`); await sleep(300);
ok("R3 the stall invalidated signing (clock_invalidated)", events.includes("clock_invalidated"));

if (MODE === "old") {
  ok("R4 OLD: pg emitted the concurrent-query DeprecationWarning (≥3 overlapping query() on ONE client)", pgWarn().length === 1);
  await sleep(12000);
  ok("R5 OLD: 12 s later the monitor is healthy again …", att.monitor.healthy(sampler.monoNowUs()) === true);
  ok("R6 OLD: … yet signing is still disabled and a valid request gets 'unavailable' (permanent latch)", att.signingReady() === false && (await attest()).code === "unavailable");
  ok("R7 OLD: the stalled session was reused, never retired (same backend still first)", (await backends())[0] === clockPid);
  await att.stop(); await rdr.close(); await sampler.close(); await admin.end(); await env.cleanup();
  T.done(8);
} else {
  const st = sampler.stats();
  ok("R4 NEW: NO pg concurrent-query DeprecationWarning (never >1 query on a physical)", pgWarn().length === 0 && warnings.length === 0);
  ok("R5 NEW: the stalled session was RETIRED (unresolved probe) — never re-queried", st.retiredUnresolved >= 1 && st.maxConcurrentQueriesPerPhysical === 1 && st.concurrencyViolations === 0);
  await waitFor(async () => (await backends()).some((p) => p !== clockPid), 8000, 100);
  const pids1 = await backends();
  ok("R6 NEW: the next probe opened a FRESH session (new backend pid serves the clock)", pids1.some((p) => p !== clockPid && !pids0.includes(p)));
  await waitFor(async () => !(await backends()).includes(clockPid), 8000, 100);
  ok("R7 NEW: the retired session was actually closed (old backend gone after it resumed)", !(await backends()).includes(clockPid));
  await waitFor(() => att.signingReady() === true, 30000, 100);
  ok("R8 NEW: signing restored AUTOMATICALLY with the production backoff (no manual regate, no restart)", att.signingReady() === true && events.includes("signing_restored") && att.recovery().passed >= 1);
  ok("R9 NEW: a valid request after recovery is signed", (await attest()).ok === true);
  ok("R10 NEW: the recovery is visible as sanitized markers", ["M5_ATTESTER_CLOCK_INVALIDATED", "M5_ATTESTER_SIGNING_DISABLED", "M5_ATTESTER_RECOVERY_STARTED", "M5_ATTESTER_SIGNING_RESTORED"].every((m) => markers.some((x) => x.startsWith(m + " "))));
  // the reader's own session (makeClockSamplerOverPhysical): stall it — no second query ever queues behind the stall
  const phys = await makePgPhysicalFactory({ env: ENV, connectionStringEnvName: "M5ACR_DB_URL" }).open();
  const rsm = makeClockSamplerOverPhysical(phys, { expectedFingerprint: fp });
  const rpid = (await phys.query("SELECT pg_backend_pid() AS p", [])).rows[0].p;
  ok("R11 NEW reader sampler: normal sample on the reader's own session", (await rsm.takeSampleFn()).ok === true);
  execSync(`kill -STOP ${rpid}`);
  const a = await rsm.takeSampleFn(); const b = await rsm.takeSampleFn(); const c = await rsm.takeSampleFn();
  execSync(`kill -CONT ${rpid}`); await sleep(300);
  ok("R12 NEW reader sampler: during the stall samples fail closed (db_probe_failed) and later ones issue NO query", !a.ok && !b.ok && !c.ok && a.reason === "db_probe_failed" && c.reason === "db_probe_failed" && rsm.stats().skippedBusy === 2);
  const d = await rsm.takeSampleFn();
  ok("R13 NEW reader sampler: after the stall clears, sampling resumes on the SAME session; still no pg warning", d.ok === true && pgWarn().length === 0 && rsm.stats().maxConcurrentQueries === 1);
  await phys.close();
  const r = await shutdownScenario("new");
  console.log("  new shutdown: " + JSON.stringify({ at: r.at, after: r.after, leftover: r.leftover.length, stopMs: r.stopMs }));
  ok("R14 NEW shutdown (real pg, delayed open): ZERO post-stop sample / SQL / open starts", r.after.samples === r.at.samples && r.after.sql === r.at.sql && r.after.opens === r.at.opens);
  ok("R15 NEW shutdown: the late real connection was RETIRED, never installed", r.after.lateOpensRetired === 1 && r.after.hasPhysical === false);
  ok("R16 NEW shutdown: no leftover backend from the attester's clock sampler after stop", r.leftover.length === 0);
  ok("R17 NEW shutdown: STOPPED, signing false, no restore, bounded stop; still no pg concurrent-query warning", r.status === "STOPPED" && r.signing === false && r.restored === false && r.stopMs <= 2500 + 1500 && pgWarn().length === 0);
  await att.stop(); await rdr.close(); await sampler.close(); await admin.end(); await env.cleanup();
  T.done(18);
}
