// §20 — PEER invalidation stays fail-closed and is NEVER auto-restored by clock recovery (CANDIDATE tree).
import fs from "node:fs";
import { randomBytes } from "node:crypto";
import { CANDIDATE_TREE, bdir, makeOk, deferred, waitFor } from "./lib.mjs";

const B = bdir(CANDIDATE_TREE);
const { startAttesterBootstrap } = await import(B + "/attester-bootstrap.mjs");
const { STATES } = await import(B + "/bootstrap-state.mjs");
const { makeBootstrapEnv } = await import(B + "/tests/fixtures/synthetic-env.mjs");
const T = makeOk("m5acr-peer"); const { ok } = T;
const SECRET = randomBytes(32).toString("hex");
function fakeTimers() { const q = []; return { q, setTimer: (fn, ms) => { const t = { fn, ms, cleared: false }; q.push(t); return t; }, clearTimer: (t) => { if (t) t.cleared = true; }, pending() { return q.filter((t) => !t.cleared && !t.fired); }, async fire() { const t = this.pending()[0]; if (!t) return null; t.fired = true; await t.fn(); return t; } }; }
function events() { const ev = []; const lines = []; return { ev, lines, log: (l) => { lines.push(l); try { ev.push(JSON.parse(l)); } catch {} }, of: (e) => ev.filter((x) => x.event === e) }; }
const env = await makeBootstrapEnv({ rttUs: 2000 });
let mode = "pass"; let hold = null; let calls = 0;
const take = async () => { calls++; if (hold) await hold.promise; return mode === "bad" ? { ok: false, reason: "db_probe_failed" } : env.attesterTakeSample(); };
const mk = (E, ft) => startAttesterBootstrap({ takeSampleFn: take, observerProvider: env.observerProvider, signer: env.signer, anchor: env.anchor, channelSecret: SECRET, listen: { bindHost: "127.0.0.1", port: 0 }, peerCidrs: env.peerCidrs, monoNowUs: env.monoNowUs, offlineTestBoundary: true, startMonitor: false, autoRecover: true, log: E.log, setTimer: ft.setTimer, clearTimer: ft.clearTimer });

{
  const E = events(); const ft = fakeTimers(); const att = await mk(E, ft);
  // a clock invalidation first (recovery pending), then a peer invalidation
  mode = "bad"; await att.monitor.sampleOnce(); mode = "pass";
  ok("P0 precondition: clock recovery timer pending", ft.pending().length === 1);
  const gen = att.generation();
  att.invalidatePeer("peer_unsafe:dns_answer_changed");
  ok("P1 peer_unsafe: signing off, status PEER_INVALID, generation rotated", att.signingReady() === false && att.status() === STATES.PEER_INVALID && att.generation() !== gen && att.peerInvalid() === "peer_unsafe");
  ok("P2 the pending CLOCK recovery timer is cancelled by the peer latch", ft.pending().length === 0);
  const pe = E.of("peer_invalidated")[0];
  ok("P3 peer_invalidated event: class only, recovery=controlled_restart_required, resolver detail NOT logged", pe && pe.reasonClass === "peer_unsafe" && pe.recovery === "controlled_restart_required" && !E.lines.some((l) => l.includes("dns_answer_changed")));
  const heal = await att.monitor.sampleOnce();
  ok("P4 the clock monitor heals (fresh good sample) yet signing stays OFF", heal.ok === true && att.monitor.healthy(env.monoNowUs()) === true && att.signingReady() === false);
  const rg = await att.regate();
  ok("P5 a clock regate never restores a peer-invalid attester (peer_invalid)", rg.ok === false && rg.reason === "peer_invalid" && att.signingReady() === false);
  mode = "bad"; await att.monitor.sampleOnce(); mode = "pass";
  ok("P6 a later clock invalidation schedules NO recovery while peer-invalid; status stays PEER_INVALID", ft.pending().length === 0 && att.status() === STATES.PEER_INVALID);
  att.invalidatePeer("peer_identity_changed");
  ok("P7 the peer latch is sticky (first class kept; no duplicate peer_invalidated event)", att.peerInvalid() === "peer_unsafe" && E.of("peer_invalidated").length === 1);
  await att.stop();
}
{
  const E = events(); const ft = fakeTimers(); const att = await mk(E, ft);
  mode = "bad"; await att.monitor.sampleOnce(); mode = "pass";
  hold = deferred(); const firing = ft.fire();
  await waitFor(() => att.recovery().inFlight === true, 2000);
  att.invalidatePeer("peer_identity_changed");
  hold.resolve(); hold = null; await firing;
  ok("P8 peer_identity_changed during an in-flight recovery: attempt aborts, never restores, no reschedule", att.signingReady() === false && E.of("signing_restored").length === 0 && ft.pending().length === 0 && att.peerInvalid() === "peer_identity_changed");
  ok("P9 the aborted attempt reports reasonClass peer_invalid and nextDelayMs null", E.of("recovery_fail")[0]?.reasonClass === "peer_invalid" && E.of("recovery_fail")[0]?.nextDelayMs === null);
  await att.stop();
}
{
  // legacy route: a peer_* reason arriving through monitor.invalidate is routed to the same sticky latch
  const E = events(); const ft = fakeTimers(); const att = await mk(E, ft);
  att.monitor.invalidate("peer_unsafe:x");
  ok("P10 monitor.invalidate('peer_…') lands in the sticky peer latch (no clock recovery scheduled)", att.peerInvalid() === "peer_unsafe" && att.status() === STATES.PEER_INVALID && ft.pending().length === 0);
  await att.stop();
}
{
  const src = fs.readFileSync(B + "/production-attester.mjs", "utf8");
  ok("P11 production supervisor onUnsafe → attRef.invalidatePeer(\"peer_unsafe:\" + reason)", src.includes('attRef.invalidatePeer("peer_unsafe:" + reason)'));
  ok("P12 production supervisor onChange → attRef.invalidatePeer(\"peer_identity_changed\") (existing log line kept)", src.includes('attRef.invalidatePeer("peer_identity_changed")') && src.includes('event: "peer_identity_changed"'));
  ok("P13 production no longer routes peer events through the healable monitor latch", !/monitor\.invalidate\("peer_/.test(src));
}
await env.cleanup();
T.done(14);
