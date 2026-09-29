// §17–§21 — GREEN SIDE: shutdown containment on the REVISED candidate. Counts STARTS after the stop boundary.
// Stop ordering = the revised composition helper makeContainedAttesterStop (production-attester.mjs).
import { CANDIDATE_TREE, makeOk } from "./lib.mjs";
import { loadTree, buildRig, invalidateAndRetire, delta, sleep, deferred, waitFor, events, fakeTimers } from "./shutdown-scenarios.mjs";
import { randomBytes } from "node:crypto";
import fs from "node:fs";

const R = makeOk("m5acr-shutdown(revised)"); const { ok } = R;
const T = await loadTree(CANDIDATE_TREE);
const containedStop = (rig) => T.productionAttester.makeContainedAttesterStop({ supervisor: null, baseStop: rig.att.stop, sampler: rig.sampler });
const counts = {};

// ── A. STOP DURING DELAYED OPEN (the WORK scenario) ──
{
  const rig = await buildRig(T);
  await invalidateAndRetire(rig);
  const og = deferred(); rig.ctl.openHang = og.promise;
  rig.ft.fireNoAwait();
  await waitFor(() => rig.ctl.openCalls === 2 && rig.att.recovery().inFlight === true, 3000);
  ok("A0 precondition: active recovery + a pending (unresolved) DB open at the stop boundary", rig.att.recovery().inFlight === true && rig.ctl.openCalls === 2 && rig.ctl.physicals.length === 1);
  const atStop = rig.snap();
  const t0 = Date.now();
  const stopping = containedStop(rig)();
  ok("A1 the CLOSED + STOPPED latches are committed synchronously (before any await)", rig.sampler.closed === true && rig.att.status() === T.STATES.STOPPED && rig.att.signingReady() === false);
  await sleep(50); rig.ctl.openHang = null; og.resolve();              // the open completes LATE
  await stopping; const stopMs = Date.now() - t0;
  await sleep(400);
  const after = rig.snap(); const d = delta(atStop, after);
  const late = rig.ctl.physicals[1];
  counts.A = { atStop, after, delta: d, stopMs, lateOpensRetired: rig.sampler.stats().lateOpensRetired };
  ok("A2 physical opens INITIATED after stop = 0", d.openCalls === 0);
  ok("A3 SQL starts after stop = 0 (no harden, no clock query on the late physical)", d.sqlStarts === 0 && late && late.queries === 0);
  ok("A4 sample starts after stop = 0 (attester calls + sampler samples)", d.sampleCalls === 0 && d.samplerSamples === 0);
  ok("A5 late physical installs = 0: it was retired (closed) and is not current", late && late.closeCalled === true && late.dead === true && rig.sampler.stats().hasPhysical === false && rig.sampler.stats().lateOpensRetired === 1);
  const again = await rig.sampler.takeSampleFn();
  ok("A6 no later caller can reuse it: a post-close sample fails closed without any open/SQL", again.ok === false && rig.ctl.openCalls === atStop.openCalls && rig.ctl.sqlStarts === atStop.sqlStarts);
  ok("A7 signing restorations = 0; status STOPPED; recovery settled with no retry timer", rig.E.of("signing_restored").length === 0 && rig.att.status() === T.STATES.STOPPED && rig.att.signingReady() === false && rig.att.recovery().inFlight === false && rig.ft.pending().length === 0);
  ok("A8 stop completed within the bounded contract (≤ STOP_RECOVERY_CONTAIN_MS + listener close)", stopMs <= T.STOP_RECOVERY_CONTAIN_MS + 1500 && T.STOP_RECOVERY_CONTAIN_MS === 2500);
  const rr = await rig.att.regate();
  ok("A9 a manual regate after stop is refused without sampling", rr.ok === false && rr.reason === "stopped" && rig.snap().sampleCalls === after.sampleCalls);
  await rig.env.cleanup();
}

// ── A′. an UNCOOPERATIVE open that never resolves: stop still returns within the bound ──
{
  const rig = await buildRig(T, { deadlineMs: 300 });
  await invalidateAndRetire(rig);
  rig.ctl.openHang = new Promise(() => {});                           // never resolves
  rig.ft.fireNoAwait();
  await waitFor(() => rig.ctl.openCalls === 2, 3000);
  const atStop = rig.snap(); const t0 = Date.now();
  await containedStop(rig)(); const stopMs = Date.now() - t0;
  await sleep(700);
  const d = delta(atStop, rig.snap());
  counts.A_uncooperative = { delta: d, stopMs };
  ok("A10 never-resolving open: stop returns within the bound, and zero opens/SQL/samples start afterwards", stopMs <= T.STOP_RECOVERY_CONTAIN_MS + 1500 && d.openCalls === 0 && d.sqlStarts === 0 && d.sampleCalls === 0 && rig.att.status() === T.STATES.STOPPED);
  await rig.env.cleanup();
}

// ── B. STOP DURING ACTIVE RECOVERY (gate partially consumed) ──
{
  const env = await T.makeBootstrapEnv({ rttUs: 2000 });
  const E = events(); const ft = fakeTimers();
  let mode = "pass", calls = 0, holdAfter = 0, held = null;
  const take = async () => { calls++; const s = mode === "bad" ? { ok: false, reason: "db_probe_failed" } : await env.attesterTakeSample();
    if (holdAfter && calls === holdAfter) { held = deferred(); await held.promise; } return s; };   // hold AFTER the sample (already-started work)
  const att = await T.startAttesterBootstrap({ takeSampleFn: take, observerProvider: env.observerProvider, signer: env.signer, anchor: env.anchor, channelSecret: randomBytes(32).toString("hex"),
    listen: { bindHost: "127.0.0.1", port: 0 }, peerCidrs: env.peerCidrs, monoNowUs: env.monoNowUs, offlineTestBoundary: true, startMonitor: false, autoRecover: true, log: E.log, setTimer: ft.setTimer, clearTimer: ft.clearTimer });
  mode = "bad"; await att.monitor.sampleOnce(); mode = "pass";
  holdAfter = calls + 3;                                               // gate sample #3 of the recovery
  const firing = ft.fireNoAwait();
  await waitFor(() => held !== null, 3000);
  const atStop = calls;
  ok("B0 precondition: recovery ACTIVE with 3 of the startup samples consumed (not all 5)", att.recovery().inFlight === true && E.of("recovery_started").length === 1);
  const t0 = Date.now(); const stopping = att.stop();
  await sleep(30); held.resolve();
  await stopping; await firing; const stopMs = Date.now() - t0;
  await sleep(200);
  counts.B = { callsAtStop: atStop, callsAfter: calls, stopMs };
  ok("B1 the active recovery aborted TERMINALLY: zero further samples started (no remaining 30-attempt loop)", calls === atStop);
  ok("B2 recovery reports reasonClass 'stopped' with no next delay; NO retry/backoff timer scheduled", E.of("recovery_fail").at(-1)?.reasonClass === "stopped" && E.of("recovery_fail").at(-1)?.nextDelayMs === null && ft.pending().length === 0);
  ok("B3 the recovery promise settled within the bound; signing false; STOPPED sticky", att.recovery().inFlight === false && stopMs <= T.STOP_RECOVERY_CONTAIN_MS + 1500 && att.signingReady() === false && att.status() === T.STATES.STOPPED && E.of("signing_restored").length === 0);
  att.invalidatePeer("peer_unsafe:x"); att.monitor.invalidate("x");
  ok("B4 late invalidations after stop change nothing (status STOPPED, no new timer, no event)", att.status() === T.STATES.STOPPED && ft.pending().length === 0 && E.of("peer_invalidated").length === 0);
  await env.cleanup();
}
// B′ — the gate itself: an explicit terminal abort stops at once; ordinary invalid samples keep the 5/30 contract
{
  const { runStartupClockGate } = await import(T.B + "/clock-gate.mjs");
  let n = 0; let abort = false;
  const r = await runStartupClockGate({ takeSampleFn: async () => { n++; if (n === 2) abort = true; return { ok: false, reason: "db_probe_failed" }; }, shouldAbort: () => abort });
  let m = 0; const r2 = await runStartupClockGate({ takeSampleFn: async () => { m++; return { ok: false, reason: "db_probe_failed" }; } });
  ok("B5 gate: terminal abort returns immediately (2 samples, not 30); without shouldAbort invalid samples still use all 30", r.ok === false && r.aborted === true && n === 2 && r2.ok === false && m === 30 && r2.reason === "db_probe_failed");
}

// ── C. STOP DURING AN ACTIVE SAMPLE (query already in flight on the physical) ──
{
  const rig = await buildRig(T, { deadlineMs: 5000 });
  await invalidateAndRetire(rig);
  rig.ft.fireNoAwait();
  await waitFor(() => rig.ctl.physicals.length === 2 && rig.ctl.physicals[1].queries >= 4, 3000);   // new session hardened, gate running
  rig.ctl.hang = true;
  await waitFor(() => rig.ctl.physicals[1].outstanding === 1, 3000);
  const p = rig.ctl.physicals[1];
  const atStop = rig.snap(); const t0 = Date.now();
  await containedStop(rig)(); const stopMs = Date.now() - t0;
  ok("C0 precondition held: a clock query was IN FLIGHT at the stop boundary", atStop.sqlStarts > 0);
  rig.ctl.hang = false; rig.release();                                // the already-started query settles AFTER stop
  await sleep(400);
  const d = delta(atStop, rig.snap());
  counts.C = { delta: d, stopMs };
  ok("C1 the in-flight query settled but its result was discarded: no seed/gate continuation (zero new samples)", d.sampleCalls === 0 && d.samplerSamples === 0 && rig.E.of("signing_restored").length === 0);
  ok("C2 zero SQL / open starts after stop", d.sqlStarts === 0 && d.openCalls === 0);
  ok("C3 the physical was retired + closed at stop", p.closeCalled === true && p.dead === true && rig.sampler.stats().hasPhysical === false);
  ok("C4 STOPPED + signing false are final; stop bounded", rig.att.status() === T.STATES.STOPPED && rig.att.signingReady() === false && stopMs <= T.STOP_RECOVERY_CONTAIN_MS + 1500);
  await rig.env.cleanup();
}

// ── D. STOP DURING BACKOFF ──
{
  const rig = await buildRig(T);
  await invalidateAndRetire(rig);
  rig.ctl.openFail = true; await rig.ft.fireNoAwait();                // attempt 1 fails (reopen failure) → backoff timer
  const timer = rig.ft.pending()[0];
  ok("D0 precondition: a failed recovery left a future backoff timer (10 s)", !!timer && timer.ms === 10000);
  rig.ctl.openFail = false;
  const atStop = rig.snap();
  await containedStop(rig)();
  ok("D1 the backoff timer was cancelled by stop", timer.cleared === true && rig.ft.pending().length === 0);
  await timer.fn();                                                   // even a timer that fires anyway is neutralized
  await sleep(200);
  const d = delta(atStop, rig.snap());
  counts.D = { delta: d };
  ok("D2 no recovery starts; zero sample / open / SQL starts after stop; STOPPED final", d.sampleCalls === 0 && d.openCalls === 0 && d.sqlStarts === 0 && rig.att.recovery().started === 1 && rig.att.status() === T.STATES.STOPPED);
  await rig.env.cleanup();
}

// ── E. stop during the QUIESCENCE wait (gate already passed): released at once, never re-enables ──
{
  const rig = await buildRig(T);
  await invalidateAndRetire(rig);
  rig.ft.fireNoAwait();
  // startup 5 + seed 1 + invalidating sample 1 + recovery gate 5 = 12 → the gate has PASSED; the attempt is now inside
  // the quiescence floor (inval + 2150 ms) and the seed (sample 13) has not started
  await waitFor(() => rig.snap().samplerSamples >= 5 + 1 + 1 + 5, 3000);
  await sleep(100);
  const inQuiescence = rig.snap().samplerSamples === 12 && rig.att.recovery().inFlight === true && rig.E.of("signing_restored").length === 0;
  const atStop = rig.snap(); const t0 = Date.now();
  await containedStop(rig)(); const stopMs = Date.now() - t0;
  await sleep(300);
  const d = delta(atStop, rig.snap());
  counts.E = { delta: d, stopMs, atStop };
  ok("E0 precondition: the recovery gate had passed and the attempt was waiting in the quiescence floor", inQuiescence);
  ok("E1 stop during the quiescence floor: the wait is released at once (stop fast), no seed sample, no restore", stopMs < 1000 && d.sampleCalls === 0 && d.sqlStarts === 0 && rig.E.of("signing_restored").length === 0 && rig.att.status() === T.STATES.STOPPED);
  await rig.env.cleanup();
}

// ── F. the composition helper commits both latches in ONE synchronous turn; sampler latch is monotonic ──
{
  const rig = await buildRig(T);
  let supStopped = false;
  const stop = T.productionAttester.makeContainedAttesterStop({ supervisor: { stop: () => { supStopped = true; } }, baseStop: rig.att.stop, sampler: rig.sampler });
  const pr = stop();
  ok("F1 supervisor stopped, sampler CLOSED and attester STOPPED synchronously within the stop() call", supStopped && rig.sampler.closed === true && rig.att.status() === T.STATES.STOPPED);
  await pr;
  const r1 = await rig.sampler.takeSampleFn(); const p2 = rig.sampler.close(); const p3 = rig.sampler.close();
  ok("F2 the CLOSED latch is monotonic + idempotent (never reopens; queued/late callers fail closed)", r1.ok === false && r1.reason === "sampler_closed" && p2 === p3 && rig.sampler.closed === true && rig.sampler.stats().refusedAfterClose >= 1);
  await rig.env.cleanup();
}

fs.writeFileSync(new URL("../logs/shutdown-revised-counts.json", import.meta.url), JSON.stringify(counts, null, 2) + "\n");
R.done(29);
