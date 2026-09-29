// §18 auto-regate SUCCESS + §19 failure regressions on the CANDIDATE attester (real v2 loopback server, real
// Ed25519 signer, synthetic cluster/observer). Deterministic: barrier-gated samplers + injected one-shot timers.
import net from "node:net";
import { randomBytes } from "node:crypto";
import { CANDIDATE_TREE, bdir, s03b, sleep, makeOk, deferred, waitFor, makeFakePhysicalFactory } from "./lib.mjs";

const B = bdir(CANDIDATE_TREE);
const { startAttesterBootstrap, RECOVERY_BACKOFF_MS, RECOVERY_QUIESCENCE_MS } = await import(B + "/attester-bootstrap.mjs");
const { buildV2Request, V2_REQUEST_BUDGET_MS } = await import(B + "/attestation-channel-v2.mjs");
const { STATES } = await import(B + "/bootstrap-state.mjs");
const { makeBootstrapEnv } = await import(B + "/tests/fixtures/synthetic-env.mjs");
const { makeProductionClockSampler } = await import(B + "/production-db-clock.mjs");
const { clusterFingerprint } = await import(s03b(CANDIDATE_TREE) + "/private-reader-attester-offline-01/target-binding.mjs");
const T = makeOk("m5acr-recovery"); const { ok } = T;
const SECRET = randomBytes(32).toString("hex");
const hex = (n) => randomBytes(n).toString("hex");

function fakeTimers() {
  const q = []; let seq = 0;
  return { q, setTimer: (fn, ms) => { const t = { id: ++seq, fn, ms, cleared: false }; q.push(t); return t; }, clearTimer: (t) => { if (t) t.cleared = true; },
    pending() { return q.filter((t) => !t.cleared && !t.fired); },
    async fire() { const t = this.pending()[0]; if (!t) return null; t.fired = true; await t.fn(); return t; } };
}
function events() { const ev = []; return { ev, log: (line) => { try { const o = JSON.parse(line); ev.push({ ...o, at: Date.now() }); } catch {} }, of: (e) => ev.filter((x) => x.event === e) }; }
async function mk(env, o = {}) {
  return startAttesterBootstrap({ takeSampleFn: o.takeSampleFn || env.attesterTakeSample, observerProvider: o.observerProvider || env.observerProvider, signer: env.signer, anchor: env.anchor,
    channelSecret: SECRET, listen: { bindHost: "127.0.0.1", port: 0 }, peerCidrs: env.peerCidrs, monoNowUs: o.monoNowUs || env.monoNowUs, offlineTestBoundary: true,
    startMonitor: o.startMonitor ?? false, autoRecover: o.autoRecover ?? true, log: o.log, recoveryBackoffMs: o.backoff, setTimer: o.setTimer, clearTimer: o.clearTimer, heartbeatMs: o.heartbeatMs });
}
async function attest(env, att) {
  const rs = await env.readerTakeSample();
  const line = buildV2Request({ channelSecret: SECRET, connectionToken: env.connectionToken, requestNonce: hex(16), readerClock: { L: rs.L, U: rs.U, generation: hex(16) }, nonce: hex(16), ts: Date.now() });
  return new Promise((resolve) => {
    let buf = ""; const s = net.createConnection({ host: "127.0.0.1", port: att.address.port });
    const to = setTimeout(() => { s.destroy(); resolve({ code: "client_timeout" }); }, 6000);
    s.on("connect", () => s.write(line)); s.setEncoding("utf8"); s.on("data", (d) => (buf += d));
    s.on("end", () => { clearTimeout(to); try { resolve(JSON.parse(buf.trim())); } catch { resolve({ code: "parse" }); } });
    s.on("error", () => { clearTimeout(to); resolve({ code: "sockerr" }); });
  });
}
/** Barrier-gated sampler over the synthetic attester clock: while `holding`, each call waits for release(). */
function gated(env) {
  const g = { holding: false, calls: 0, waiters: [], mode: "pass" };
  g.take = async () => {
    g.calls++;
    if (g.holding) { const d = deferred(); g.waiters.push(d.resolve); await d.promise; }
    if (g.mode === "throw") throw new Error("synthetic");
    if (g.mode === "bad") return { ok: false, reason: "db_probe_failed" };
    if (g.mode === "hull") return { ok: true, L: g.calls % 2 ? -400000 : 0, U: g.calls % 2 ? 0 : 400000, absBoundUs: 1000 };   // synthetic: per-sample bound CLAIMED ok, real hull 400 ms (exercises the gate's independent hull check)
    if (g.mode === "wide") return { ok: true, L: -300000, U: -290000, absBoundUs: 300000 };
    return env.attesterTakeSample();
  };
  g.releaseOne = () => { const w = g.waiters.shift(); if (w) w(); return !!w; };
  return g;
}

const env = await makeBootstrapEnv({ rttUs: 2000 });

// ── A. AUTO-REGATE PASS (barrier-gated): not restored after samples 1–4; fresh generation; quiescence ──
{
  const E = events(); const g = gated(env);
  const att = await mk(env, { takeSampleFn: g.take, backoff: [30], log: E.log });
  ok("A0 attester signing at startup", att.signingReady() === true && att.status() === STATES.BOOTSTRAP_LISTENING);
  const gen0 = att.generation();
  g.mode = "bad"; const tInv = Date.now(); await att.monitor.sampleOnce();
  const gen1 = att.generation();
  ok("A1 clock invalidation: signingReady=false, status CLOCK_INVALID, generation rotated", att.signingReady() === false && att.status() === STATES.CLOCK_INVALID && gen1 !== gen0);
  ok("A2 events clock_invalidated + signing_disabled + recovery_scheduled (bounded delay) emitted", E.of("clock_invalidated").length === 1 && E.of("signing_disabled").length === 1 && E.of("recovery_scheduled")[0]?.delayMs === 30);
  g.mode = "pass"; g.holding = true;
  await waitFor(() => E.of("recovery_started").length === 1 && g.waiters.length === 1, 2000);
  let notRestored = true;
  for (let i = 1; i <= 4; i++) {
    const before = g.calls; g.releaseOne();
    await waitFor(() => g.calls === before + 1 && g.waiters.length === 1, 2000);
    if (att.signingReady() !== false || att.status() !== STATES.CLOCK_INVALID) notRestored = false;
  }
  ok("A3 signing NOT restored after gate samples 1, 2, 3 and 4 (status stays CLOCK_INVALID)", notRestored && E.of("signing_restored").length === 0);
  const r5 = attest(env, att);
  const res5 = await r5;
  ok("A4 a request during recovery is refused with the fast unavailable frame (never signed)", res5.ok !== true && res5.code === "unavailable");
  g.holding = false; g.releaseOne();
  await waitFor(() => E.of("signing_restored").length === 1, 6000);
  const tRes = E.of("signing_restored")[0]?.at || 0;
  ok("A5 after the 5th consecutive sample + quiescence + fresh seed, signing is restored AUTOMATICALLY", att.signingReady() === true && att.status() === STATES.BOOTSTRAP_LISTENING && E.of("recovery_pass").length === 1);
  ok("A6 restore happened no earlier than the quiescence floor after the invalidation", tRes - tInv >= RECOVERY_QUIESCENCE_MS && RECOVERY_QUIESCENCE_MS === V2_REQUEST_BUDGET_MS + 250);
  const gen2 = att.generation();
  ok("A7 recovery bound a FRESH generation (≠ boot generation, ≠ invalidation generation)", gen2 !== gen0 && gen2 !== gen1);
  const r = await attest(env, att);
  ok("A8 a new valid request after recovery is signed", r.ok === true && att.stats().server.signed === 1);
  ok("A9 recovery attempt counter reset on success; no timer left pending", att.recovery().attempt === 0 && att.recovery().pending === false && att.recovery().passed === 1);
  await att.stop();
}

// ── B. a request in flight BEFORE the invalidation can never be signed after recovery ──
{
  const E = events(); const hold = deferred(); let observerCalls = 0;
  const observerProvider = async () => { observerCalls++; if (observerCalls === 1) await hold.promise; return env.observerProvider(); };
  const g = gated(env);
  const att = await mk(env, { takeSampleFn: g.take, backoff: [20], log: E.log, observerProvider });
  const signedBefore = att.stats().server.signed;
  const inflight = attest(env, att);
  await waitFor(() => observerCalls === 1, 2000);
  g.mode = "bad"; const tInv = Date.now(); await att.monitor.sampleOnce(); g.mode = "pass";
  await waitFor(() => g.calls >= 1 + 1 + 5, 2000);            // startup(5)+seed(1)+inval(1)+gate(5) — gate samples done fast
  const tGateDone = Date.now();
  await sleep(250); hold.resolve();
  const res = await inflight;
  ok("B1 the pre-invalidation in-flight request is NOT signed (refused), although the gate samples had already passed", res.ok !== true && att.stats().server.signed === signedBefore);
  ok("B2 (counterfactual timing) gate samples completed well inside the request budget, so only the quiescence floor kept signing off", tGateDone - tInv < V2_REQUEST_BUDGET_MS);
  await waitFor(() => E.of("signing_restored").length === 1, 6000);
  ok("B3 recovery completed only after the floor (≥ budget + margin after the invalidation)", (E.of("signing_restored")[0]?.at || 0) - tInv >= RECOVERY_QUIESCENCE_MS);
  const r2 = await attest(env, att);
  ok("B4 a fresh post-recovery request is signed", r2.ok === true);
  await att.stop();
}

// ── C. repeated invalid samples: deterministic backoff; exactly one pending timer; no tight loop ──
{
  const E = events(); const ft = fakeTimers(); const g = gated(env);
  const att = await mk(env, { takeSampleFn: g.take, log: E.log, setTimer: ft.setTimer, clearTimer: ft.clearTimer });
  g.mode = "bad"; await att.monitor.sampleOnce();
  const delays = [ft.pending()[0]?.ms]; let maxPending = ft.pending().length; let callsPerAttempt = [];
  for (let i = 0; i < 6; i++) { const c0 = g.calls; await ft.fire(); callsPerAttempt.push(g.calls - c0); maxPending = Math.max(maxPending, ft.pending().length); delays.push(ft.pending()[0]?.ms); }
  ok("C1 backoff is exactly 5 s, 10 s, 20 s, 40 s, 60 s, then 60 s", JSON.stringify(delays) === JSON.stringify([5000, 10000, 20000, 40000, 60000, 60000, 60000]) && JSON.stringify(RECOVERY_BACKOFF_MS) === "[5000,10000,20000,40000,60000]");
  ok("C2 never more than ONE pending recovery timer; each attempt is one bounded gate (30 samples max)", maxPending === 1 && callsPerAttempt.every((n) => n === 30));
  const fails = E.of("recovery_fail");
  ok("C3 recovery_fail events carry attempt, reasonClass and nextDelayMs", fails.length === 6 && fails[0].attempt === 1 && fails[0].reasonClass === "db_probe_failed" && fails[0].nextDelayMs === 10000 && fails[5].nextDelayMs === 60000);
  ok("C4 signing stays disabled throughout the failed attempts", att.signingReady() === false && att.status() === STATES.CLOCK_INVALID);
  g.mode = "pass"; await ft.fire();
  ok("C5 once the clock is valid again the next scheduled attempt restores signing (attempt counter reset)", att.signingReady() === true && att.recovery().attempt === 0);
  await att.stop();
}

// ── D. failure classes: throw, per-sample bound, hull, interrupted run, reopen failure ──
for (const [mode, want, label] of [["throw", "sample_threw", "D1 a THROWING sampler"], ["wide", "service_bound_exceeded", "D2 a sample beyond the 250 ms service bound"], ["hull", "hull_bound_exceeded", "D3 a set whose conservative HULL exceeds the bound"]]) {
  const E = events(); const ft = fakeTimers(); const g = gated(env);
  const att = await mk(env, { takeSampleFn: g.take, log: E.log, setTimer: ft.setTimer, clearTimer: ft.clearTimer });
  g.mode = "bad"; await att.monitor.sampleOnce(); g.mode = mode; await ft.fire();
  ok(`${label} fails recovery closed (reasonClass ${want}), signing stays off, retry scheduled`, E.of("recovery_fail")[0]?.reasonClass === want && att.signingReady() === false && ft.pending().length === 1);
  await att.stop();
}
{
  const E = events(); const ft = fakeTimers(); const g = gated(env);
  const att = await mk(env, { takeSampleFn: g.take, log: E.log, setTimer: ft.setTimer, clearTimer: ft.clearTimer });
  g.mode = "bad"; await att.monitor.sampleOnce(); g.mode = "pass";
  let n = 0; const orig = g.take; const script = ["pass", "pass", "pass", "bad"];
  const att2Take = async () => { const m = script[n++] || "pass"; g.mode = m; return orig(); };
  // interrupted run: 3 good then 1 invalid then good → the run restarts (needs 5 NEW consecutive)
  const E2 = events(); const ft2 = fakeTimers();
  const att2 = await mk(env, { takeSampleFn: att2Take, log: E2.log, setTimer: ft2.setTimer, clearTimer: ft2.clearTimer });
  // att2's startup consumed the script: 3 good + 1 bad + 5 good + seed ⇒ the startup gate itself proves the reset rule
  ok("D4 an invalid sample resets the consecutive run (startup needed 3+1+5 samples, then a seed)", att2.signingReady() === true && n === 3 + 1 + 5 + 1);
  await att2.stop(); await att.stop();
}
{
  const cluster = { datname: env.cl.state.datname, databaseOid: env.cl.state.databaseOid, readerRoleOid: env.cl.state.readerRoleOid, encoding: env.cl.state.encoding };
  const { factory, ctl } = makeFakePhysicalFactory({ cluster });
  const s = makeProductionClockSampler({ env: {}, connectionStringEnvName: "X", expectedFingerprint: clusterFingerprint(cluster), deadlineMs: 200, closeDeadlineMs: 100, physicalFactory: factory });
  const E = events(); const ft = fakeTimers();
  const att = await mk(env, { takeSampleFn: s.takeSampleFn, monoNowUs: s.monoNowUs, log: E.log, setTimer: ft.setTimer, clearTimer: ft.clearTimer });
  ok("D5 precondition: attester up over the (fake-driver) production sampler", att.signingReady() === true);
  ctl.hang = true; await att.monitor.sampleOnce(); ctl.hang = false;
  ok("D6 a timed-out probe invalidates signing and retires its session", att.signingReady() === false && s.stats().retiredUnresolved === 1);
  ctl.openFail = true; await ft.fire();
  ok("D7 REOPEN failure during recovery fails closed (db_probe_failed), retry scheduled", E.of("recovery_fail")[0]?.reasonClass === "db_probe_failed" && att.signingReady() === false && ft.pending().length === 1);
  ctl.openFail = false; await ft.fire();
  ok("D8 after the reopen fault clears, recovery opens a fresh session and restores signing", att.signingReady() === true && ctl.opened === 2 && ctl.overlapCalls === 0);
  await att.stop(); await s.close();
}

// ── E. recovery in flight: serialized; manual regate refused; new invalidation supersedes the attempt ──
{
  const E = events(); const ft = fakeTimers(); const g = gated(env);
  const att = await mk(env, { takeSampleFn: g.take, log: E.log, setTimer: ft.setTimer, clearTimer: ft.clearTimer });
  g.mode = "bad"; await att.monitor.sampleOnce(); g.mode = "pass"; g.holding = true;
  const firing = ft.fire();
  await waitFor(() => g.waiters.length === 1, 2000);
  const manual = await att.regate();
  ok("E1 a manual regate while automatic recovery is in flight is refused (recovery_in_flight)", manual.ok === false && manual.reason === "recovery_in_flight");
  // a NEW clock invalidation mid-recovery: heal the monitor latch, then fail it (samples run un-held)
  g.holding = false; const heal = await att.monitor.sampleOnce(); g.mode = "bad"; await att.monitor.sampleOnce(); g.mode = "pass";
  ok("E2 a second invalidation during recovery schedules NO concurrent attempt (no timer while in flight)", heal.ok === true && ft.pending().length === 0 && att.recovery().inFlight === true);
  g.releaseOne(); await firing;
  ok("E3 the superseded attempt fails (epoch_superseded) instead of restoring signing", E.of("recovery_fail")[0]?.reasonClass === "epoch_superseded" && att.signingReady() === false && E.of("signing_restored").length === 0);
  ok("E4 exactly one retry is scheduled afterwards with the next backoff step", ft.pending().length === 1 && ft.pending()[0].ms === 10000);
  await ft.fire();
  ok("E5 the next attempt restores signing", att.signingReady() === true);
  await att.stop();
}

// ── F. stop during recovery; startup-gate failure recovery; autoRecover default OFF ──
{
  const E = events(); const ft = fakeTimers(); const g = gated(env);
  const att = await mk(env, { takeSampleFn: g.take, log: E.log, setTimer: ft.setTimer, clearTimer: ft.clearTimer });
  g.mode = "bad"; await att.monitor.sampleOnce(); g.mode = "pass"; g.holding = true;
  const firing = ft.fire(); await waitFor(() => g.waiters.length === 1, 2000);
  await att.stop(); g.holding = false; while (g.releaseOne()); await firing;
  ok("F1 stop() during recovery: never restored, STOPPED, no timer scheduled, regate refused", att.signingReady() === false && att.status() === STATES.STOPPED && ft.pending().length === 0 && E.of("signing_restored").length === 0 && (await att.regate()).reason === "stopped");
  ok("F2 a stopped event is emitted once", E.of("stopped").length === 1);
}
{
  const E = events(); const ft = fakeTimers(); const g = gated(env); g.mode = "bad";
  const att = await mk(env, { takeSampleFn: g.take, log: E.log, setTimer: ft.setTimer, clearTimer: ft.clearTimer });
  ok("F3 a failed STARTUP gate leaves the listener up, signing off, and schedules bounded recovery", att.started === true && att.status() === STATES.CLOCK_INVALID && E.of("recovery_scheduled")[0]?.trigger === "startup_gate_failed" && ft.pending()[0]?.ms === 5000);
  g.mode = "pass"; const t0 = Date.now(); await ft.fire();
  ok("F4 startup recovery restores signing (no quiescence wait: nothing was ever signable)", att.signingReady() === true && Date.now() - t0 < 1500);
  await att.stop();
}
{
  const E = events(); const ft = fakeTimers(); const g = gated(env);
  const att = await startAttesterBootstrap({ takeSampleFn: g.take, observerProvider: env.observerProvider, signer: env.signer, anchor: env.anchor, channelSecret: SECRET, listen: { bindHost: "127.0.0.1", port: 0 }, peerCidrs: env.peerCidrs, monoNowUs: env.monoNowUs, offlineTestBoundary: true, startMonitor: false, log: E.log, setTimer: ft.setTimer, clearTimer: ft.clearTimer });
  g.mode = "bad"; await att.monitor.sampleOnce();
  ok("F5 autoRecover defaults OFF (frozen deterministic semantics): no recovery scheduled", ft.q.length === 0 && E.of("recovery_scheduled").length === 0 && att.recovery().autoRecover === false);
  g.mode = "pass"; const rg = await att.regate();
  ok("F6 manual regate still restores signing (unchanged contract)", rg.ok === true && att.signingReady() === true);
  await att.stop();
}

// ── G. real 1 s scheduler: a hanging production probe → watchdog invalidates → automatic recovery ──
{
  const cluster = { datname: env.cl.state.datname, databaseOid: env.cl.state.databaseOid, readerRoleOid: env.cl.state.readerRoleOid, encoding: env.cl.state.encoding };
  const { factory, ctl, release } = makeFakePhysicalFactory({ cluster });
  const s = makeProductionClockSampler({ env: {}, connectionStringEnvName: "X", expectedFingerprint: clusterFingerprint(cluster), closeDeadlineMs: 200, physicalFactory: factory });
  const E = events();
  const att = await mk(env, { takeSampleFn: s.takeSampleFn, monoNowUs: s.monoNowUs, log: E.log, startMonitor: true, backoff: [200] });
  ctl.hang = true;
  // worst case: next 1 s tick + the 2 s probe deadline (or the 2 s staleness watchdog) + scheduling slack.
  // (v2 evidence fix — test race only: signingReady() already turns false at the 2 s staleness AGE, fail-closed,
  //  up to one scheduler tick BEFORE the watchdog emits clock_invalidated; wait for BOTH, assertion unchanged.)
  await waitFor(() => att.signingReady() === false && E.of("clock_invalidated").length >= 1, 8000);
  ok("G1 the live scheduler + watchdog disable signing while probes hang (no manual driving)", att.signingReady() === false && E.of("clock_invalidated").length >= 1);
  await sleep(1500);
  ok("G2 while hanging: no driver overlap, and the stalled session was retired (not re-queried)", ctl.overlapCalls === 0 && ctl.queriesOnRetired === 0 && s.stats().retiredUnresolved >= 1);
  ctl.hang = false; release();
  await waitFor(() => att.signingReady() === true, 12000);
  ok("G3 once the DB answers again, signing is restored automatically on a fresh session", att.signingReady() === true && E.of("signing_restored").length >= 1 && ctl.opened >= 2);
  const r = await attest(env, att);
  ok("G4 a valid request after automatic recovery is signed", r.ok === true);
  await att.stop(); await s.close();
}

await env.cleanup();
T.done(42);
