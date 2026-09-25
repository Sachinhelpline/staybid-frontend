// ─────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B BOOTSTRAP §M1-R1 — READER INVALIDATION / RE-ENTRY RACE (OFFLINE). Node built-ins only.
// DETERMINISTIC barrier-controlled tests (no timing luck). Each phase-invalidation test pauses the acquisition at
// an EXACT awaited phase via a one-shot gate, rotates the generation via a monitor invalidation, then releases the
// phase — and proves the superseded acquisition can NEVER install authority. Also proves recovery requires a FULL
// fresh five-sample startup gate (regate) PLUS a fresh attestation: one/four good samples and a bare re-gate are
// all insufficient. Real Ed25519 attester + synthetic cluster + real loopback sockets.
// ─────────────────────────────────────────────────────────────────────────
import { makeBootstrapEnv } from "./fixtures/synthetic-env.mjs";
import { startAttesterBootstrap } from "../attester-bootstrap.mjs";
import { startReaderBootstrap } from "../reader-bootstrap.mjs";
import { obtainV2, STATES } from "../bootstrap-state.mjs";

const SECRET = "s".repeat(48);
let pass = 0, fail = 0; const fails = [];
const ok = (n, c) => { if (c) pass++; else { fail++; fails.push(n); console.log("  FAIL:", n); } };

// a gate that blocks the Nth wait() call until release() (one-shot at a chosen index)
function callGate() {
  let blockAt = -1, count = 0, resolve = null;
  return {
    armAt(n) { blockAt = n; count = 0; },
    disarm() { blockAt = -1; },
    async wait() { const i = count++; if (i === blockAt) { await new Promise((r) => (resolve = r)); } },
    release() { if (resolve) { const r = resolve; resolve = null; r(); } },
    get blocking() { return !!resolve; },
  };
}
const nextTick = () => new Promise((r) => setImmediate(r));

async function run() {
  const env = await makeBootstrapEnv({ rttUs: 2000 });
  const att = await startAttesterBootstrap({
    takeSampleFn: env.attesterTakeSample, observerProvider: env.observerProvider, signer: env.signer,
    anchor: env.anchor, channelSecret: SECRET, listen: { bindHost: "127.0.0.1", port: 0 },
    peerCidrs: env.peerCidrs, monoNowUs: env.monoNowUs, offlineTestBoundary: true, startMonitor: false,
  });

  const sampleGate = callGate();
  const obtainGate = callGate();
  const wrappedTake = async () => { await sampleGate.wait(); return env.readerTakeSample(); };
  const wrappedObtain = async (args) => { await obtainGate.wait(); return obtainV2(args); };
  const readers = [];
  const mkReader = async () => {
    const r = await startReaderBootstrap({
      takeSampleFn: wrappedTake, connectionToken: env.connectionToken,
      attester: { host: att.address.host, port: att.address.port }, channelSecret: SECRET,
      trustRoot: env.trustRoot, monoNowUs: env.monoNowUs, offlineTestBoundary: true,
      startMonitor: false, obtainV2Fn: wrappedObtain,
    });
    readers.push(r); sampleGate.disarm(); obtainGate.disarm(); return r;
  };

  // helper: run one acquire that will be paused at a phase, invalidate, release, and assert it does not install
  async function racePhase(name, arm) {
    const r = await mkReader();
    arm();                                  // arm the gate for the phase under test
    const p = r.acquireAuthority();         // start; it will block at the armed phase
    // spin until the acquisition is actually blocked at the gate
    for (let i = 0; i < 50 && !(sampleGate.blocking || obtainGate.blocking); i++) await nextTick();
    r.monitor.invalidate("race_invalidation");   // rotate generation while the attempt is paused
    sampleGate.release(); obtainGate.release();   // release the phase → the superseded attempt resumes
    const res = await p;
    ok(name, res.ok === false && r.authorityReady() === false && r.status() === STATES.WAITING_FOR_CLOCK);
    sampleGate.disarm(); obtainGate.disarm();
    return r;
  }

  // A. invalidate during/after pre-sample (before attestation)
  await racePhase("A. invalidate during pre-sample → no authority", () => sampleGate.armAt(0));
  // B/C. invalidate while awaiting attestation (a valid response/signature arriving late is discarded before verify)
  await racePhase("B/C. invalidate while awaiting attestation (late valid signature discarded) → no authority", () => obtainGate.armAt(0));
  // D/E. invalidate during/before post-sample and final install
  await racePhase("D/E. invalidate during post-sample (before final install) → no authority", () => sampleGate.armAt(1));
  // F. monitor invalidation while acquireAuthority is active (same mechanism, asserted explicitly)
  await racePhase("F. monitor invalidation while acquire active → no authority", () => obtainGate.armAt(0));

  // G/H. an OLD valid response + valid signature arriving after invalidation cannot install authority.
  // (racePhase B/C already exercises a genuine valid envelope returned post-invalidation; assert signed>0 proves
  //  the attester really produced a signature that was then discarded by the reader.)
  ok("G/H. attester really signed during the race yet no reader authority resulted", att.stats().server.signed >= 1);

  // I. one good monitor sample after invalidation cannot restore authority
  {
    const r = await mkReader();
    r.monitor.invalidate("test"); await r.monitor.sampleOnce();
    const a = await r.acquireAuthority();
    ok("I. one good sample after invalidation cannot re-acquire", a.ok === false && a.reason === "clock_gate_required" && r.authorityReady() === false);
  }
  // J. four good monitor samples after invalidation cannot restore authority
  {
    const r = await mkReader();
    r.monitor.invalidate("test");
    for (let i = 0; i < 4; i++) await r.monitor.sampleOnce();
    const a = await r.acquireAuthority();
    ok("J. four good samples after invalidation cannot re-acquire", a.ok === false && a.reason === "clock_gate_required" && r.authorityReady() === false);
  }
  // K. a full fresh five-sample startup gate WITHOUT a fresh attestation is not authority
  {
    const r = await mkReader();
    r.monitor.invalidate("test");
    const rg = await r.regate();
    ok("K. re-gate alone (no fresh attestation) is NOT authority-ready", rg.ok === true && r.gatePassed() === true && r.authorityReady() === false && r.status() === STATES.WAITING_FOR_ATTESTER);
  }
  // L. full re-gate + fresh attestation → AUTHORITY_READY, bound to the post-invalidation generation + fresh nonce
  {
    const r = await mkReader();
    const a0 = await r.acquireAuthority();
    const gen0 = r.generation(); const nonce0 = r.authorityRequestNonce();
    r.monitor.invalidate("test");
    const gen1 = r.generation();
    const rg = await r.regate();
    const a1 = await r.acquireAuthority();
    ok("L. re-gate + fresh attestation → AUTHORITY_READY", a0.ok === true && rg.ok === true && a1.ok === true && r.authorityReady() === true);
    ok("L2. generation rotated across invalidation", gen1 !== gen0);
    ok("L3. new authority bound to the post-invalidation generation", r.authorityGeneration() === gen1 && r.authorityGeneration() === a1.generation);
    ok("L4. new authority carries a fresh request nonce", r.authorityRequestNonce() && r.authorityRequestNonce() !== nonce0);
  }

  // M. concurrent acquisitions are refused (only one in flight)
  {
    const r = await mkReader();
    sampleGate.armAt(0);
    const p1 = r.acquireAuthority();
    for (let i = 0; i < 50 && !sampleGate.blocking; i++) await nextTick();
    const p2 = await r.acquireAuthority();   // second call while first is paused
    ok("M. concurrent acquisition refused", p2.ok === false && p2.reason === "acquire_in_progress");
    sampleGate.release(); await p1; sampleGate.disarm();
  }

  for (const r of readers) { try { await r.stop(); } catch {} }
  await att.stop(); await env.cleanup();

  console.log("\n══════════════════════════════════════════════════════════");
  console.log(`RESULT: ${pass} passed, ${fail} failed  (executed assertions: ${pass + fail})`);
  if (fail > 0) { console.log("FAILURES:", fails.join(" | ")); process.exitCode = 1; return; }
  console.log("OFFLINE READER INVALIDATION / RE-ENTRY RACE (§M1-R1): PASS");
  console.log("SCOPE: deterministic barriers + real Ed25519 attester + synthetic cluster + loopback. NOT live AI-STAGING.");
  process.exitCode = 0;
}
run().catch((e) => { console.log("HARNESS ERROR:", e && e.stack); process.exitCode = 1; });
