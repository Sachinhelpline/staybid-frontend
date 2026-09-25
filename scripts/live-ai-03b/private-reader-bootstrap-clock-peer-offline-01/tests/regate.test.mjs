// ─────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B BOOTSTRAP §M1-R1(final) — REGATE / GATE-ELIGIBILITY GENERATION LIFECYCLE (OFFLINE). Node built-ins.
// DETERMINISTIC barrier-controlled tests (no timing luck) proving the generation-bound re-gate invariant:
//   • an invalidation during ANY of the five startup samples, the monitor seed, or before the final synchronous
//     bind aborts the re-gate: gate eligibility is NOT bound to a rotated generation, and no pre-invalidation
//     sample counts toward a post-invalidation pass;
//   • one/four good monitor samples cannot recreate gate eligibility;
//   • five monitor samples alone cannot (only a full runGenerationBoundGate via regate() binds eligibility);
//   • a full fresh re-gate creates clock eligibility ONLY (authorityReady stays false without attestation);
//   • a full re-gate + fresh acquisition (new nonce + attestation + post-bracket) reaches AUTHORITY_READY.
// Real Ed25519 attester + synthetic cluster + real loopback sockets.
// ─────────────────────────────────────────────────────────────────────────
import { makeBootstrapEnv } from "./fixtures/synthetic-env.mjs";
import { startAttesterBootstrap } from "../attester-bootstrap.mjs";
import { startReaderBootstrap } from "../reader-bootstrap.mjs";
import { STATES } from "../bootstrap-state.mjs";

const SECRET = "s".repeat(48);
let pass = 0, fail = 0; const fails = [];
const ok = (n, c) => { if (c) pass++; else { fail++; fails.push(n); console.log("  FAIL:", n); } };
const nextTick = () => new Promise((r) => setImmediate(r));

async function run() {
  const env = await makeBootstrapEnv({ rttUs: 2000 });
  const att = await startAttesterBootstrap({
    takeSampleFn: env.attesterTakeSample, observerProvider: env.observerProvider, signer: env.signer,
    anchor: env.anchor, channelSecret: SECRET, listen: { bindHost: "127.0.0.1", port: 0 },
    peerCidrs: env.peerCidrs, monoNowUs: env.monoNowUs, offlineTestBoundary: true, startMonitor: false,
  });

  // a take wrapper with an absolute call counter and a one-shot block at a chosen index (reset per re-gate)
  let count = 0, blockAt = -1, resolver = null;
  const gate = {
    armAt(n) { blockAt = n; }, reset() { count = 0; blockAt = -1; resolver = null; },
    async wait() { const i = count++; if (i === blockAt) await new Promise((r) => (resolver = r)); },
    release() { if (resolver) { const r = resolver; resolver = null; r(); } },
    get blocking() { return !!resolver; },
  };
  const take = async () => { await gate.wait(); return env.readerTakeSample(); };
  const readers = [];
  const mkReader = async () => {
    const r = await startReaderBootstrap({
      takeSampleFn: take, connectionToken: env.connectionToken, attester: { host: att.address.host, port: att.address.port },
      channelSecret: SECRET, trustRoot: env.trustRoot, monoNowUs: env.monoNowUs, offlineTestBoundary: true, startMonitor: false,
    });
    readers.push(r); gate.reset(); return r;
  };

  // ── A. invalidation at each re-gate checkpoint aborts the re-gate (generation-bound) ──
  // index 0..4 = the five startup samples; index 5 = the monitor seed (the last await before the synchronous bind)
  const CHECKPOINTS = [[0, "sample 1"], [1, "sample 2"], [2, "sample 3"], [3, "sample 4"], [4, "sample 5"], [5, "monitor seed (before final bind)"]];
  for (const [k, label] of CHECKPOINTS) {
    const r = await mkReader();                 // fresh reader: monitor latch clear, gatePassed=true under G0
    gate.reset(); gate.armAt(k);
    const p = r.regate();                        // a re-gate attempt bound to G0
    for (let i = 0; i < 100 && !gate.blocking; i++) await nextTick();
    const genBefore = r.generation();
    r.monitor.invalidate("mid_regate");         // clear latch → fires → rotate generation while the re-gate is paused
    gate.release();
    const res = await p;
    ok(`A.${k}. invalidation during ${label} aborts re-gate (no bind)`, res.ok === false && res.reason === "generation_superseded");
    ok(`A.${k}b. ${label}: gate eligibility NOT bound to the rotated generation`, r.gatePassed() === false && r.authorityReady() === false);
    ok(`A.${k}c. ${label}: generation rotated (attempt is dead)`, r.generation() !== genBefore && r.status() === STATES.WAITING_FOR_CLOCK);
    gate.reset();
  }

  // ── B. good monitor samples after invalidation cannot recreate gate eligibility ──
  {
    const r = await mkReader(); r.monitor.invalidate("t"); gate.reset();
    await r.monitor.sampleOnce();
    ok("B1. one good monitor sample → still no gate eligibility", r.gatePassed() === false && (await r.acquireAuthority()).reason === "clock_gate_required");
  }
  {
    const r = await mkReader(); r.monitor.invalidate("t"); gate.reset();
    for (let i = 0; i < 4; i++) await r.monitor.sampleOnce();
    ok("B2. four good monitor samples → still no gate eligibility", r.gatePassed() === false && (await r.acquireAuthority()).reason === "clock_gate_required");
  }
  {
    const r = await mkReader(); r.monitor.invalidate("t"); gate.reset();
    for (let i = 0; i < 5; i++) await r.monitor.sampleOnce();
    ok("B3. five monitor samples ALONE (not a full gate) → still no gate eligibility", r.gatePassed() === false && r.authorityReady() === false);
  }

  // ── C. a full fresh re-gate creates clock eligibility ONLY (no authority without attestation) ──
  {
    const r = await mkReader(); r.monitor.invalidate("t"); gate.reset();
    const rg = await r.regate();
    ok("C1. full re-gate binds gate eligibility to its own generation", rg.ok === true && r.gatePassed() === true && rg.generation === r.generation() && r.status() === STATES.WAITING_FOR_ATTESTER);
    ok("C2. clock eligibility alone is NOT authority", r.authorityReady() === false);
  }

  // ── D. full re-gate + fresh attestation → AUTHORITY_READY, bound to the re-gate generation + fresh nonce ──
  {
    const r = await mkReader();
    const a0 = await r.acquireAuthority(); const nonce0 = r.authorityRequestNonce();
    r.monitor.invalidate("t"); gate.reset();
    const gen1 = r.generation();
    const rg = await r.regate();
    const a1 = await r.acquireAuthority();
    ok("D1. re-gate + fresh attestation → AUTHORITY_READY", a0.ok === true && rg.ok === true && a1.ok === true && r.authorityReady() === true);
    ok("D2. authority bound to the re-gate generation + a fresh nonce", r.authorityGeneration() === gen1 && a1.generation === gen1 && r.authorityRequestNonce() && r.authorityRequestNonce() !== nonce0);
  }

  // ── E. a re-gate that completes fully under ONE unchanged generation is not disturbed by a LATER invalidation ──
  {
    const r = await mkReader(); r.monitor.invalidate("t"); gate.reset();
    const rg = await r.regate();
    ok("E1. clean re-gate ok", rg.ok === true && r.gatePassed() === true);
    r.monitor.invalidate("after");     // a subsequent invalidation drops eligibility again (must re-gate)
    ok("E2. later invalidation clears eligibility again", r.gatePassed() === false && r.status() === STATES.WAITING_FOR_CLOCK && (await r.acquireAuthority()).reason === "clock_gate_required");
  }

  for (const r of readers) { try { await r.stop(); } catch {} }
  await att.stop(); await env.cleanup();

  console.log("\n══════════════════════════════════════════════════════════");
  console.log(`RESULT: ${pass} passed, ${fail} failed  (executed assertions: ${pass + fail})`);
  if (fail > 0) { console.log("FAILURES:", fails.join(" | ")); process.exitCode = 1; return; }
  console.log("OFFLINE REGATE / GATE-ELIGIBILITY GENERATION LIFECYCLE (§M1-R1 final): PASS");
  console.log("SCOPE: deterministic barriers + real Ed25519 attester + synthetic cluster + loopback. NOT live AI-STAGING.");
  process.exitCode = 0;
}
run().catch((e) => { console.log("HARNESS ERROR:", e && e.stack); process.exitCode = 1; });
