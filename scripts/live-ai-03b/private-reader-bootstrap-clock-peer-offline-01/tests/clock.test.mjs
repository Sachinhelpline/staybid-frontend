// ─────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B BOOTSTRAP §27 — CLOCK INTERVAL / GATE / MONITOR matrix (OFFLINE). Node built-ins only.
// PURE deterministic math over crafted samples — no sockets, no DB, no time dependence. Boundary cases are
// crafted at the evaluateSample level (exact µs) so RTT/backward/discrepancy/E/service/pairwise thresholds are
// asserted exactly, not approximated through synthetic-network jitter.
// ─────────────────────────────────────────────────────────────────────────
import {
  evaluateSample, hull, serviceGateOk, pairwiseInterval, pairwiseGateOk,
  RTT_MAX_US, E_MAX_US, SERVICE_ABS_BOUND_US, PAIRWISE_ABS_BOUND_US, WALL_MONO_DISCREPANCY_MAX_US,
  SERVICE_ABS_BOUND_MS, PAIRWISE_ABS_BOUND_MS, ACCEPTED_MAX_MS, RESERVE_MS, STARTUP_SAMPLES,
} from "../clock-interval.mjs";
import { runStartupClockGate, createClockMonitor } from "../clock-gate.mjs";

let pass = 0, fail = 0; const fails = [];
const ok = (n, c) => { if (c) pass++; else { fail++; fails.push(n); console.log("  FAIL:", n); } };

const W = 1_700_000_000_000_000;   // µs, whole-ms multiple (local wall at send-lo)
const DB = 1_700_000_000_000_000;  // µs db clock
const M = 5_000_000;               // µs monotonic at send
function raw(over = {}) {
  return {
    wallSendLoUs: W, wallSendHiUs: W + 1000,
    monoSendUs: M, monoRecvUs: M + 2000,
    wallRecvLoUs: W + 2000, wallRecvHiUs: W + 3000,
    dbUs: DB, ...over,
  };
}

async function run() {
  // ── A. thresholds wired correctly (frozen architecture numbers) ──
  ok("A1. service bound = 250 ms", SERVICE_ABS_BOUND_MS === 250 && SERVICE_ABS_BOUND_US === 250000);
  ok("A2. pairwise bound = 500 ms", PAIRWISE_ABS_BOUND_MS === 500 && PAIRWISE_ABS_BOUND_US === 500000);
  ok("A3. accepted ceiling 600 ms, reserve 100 ms", ACCEPTED_MAX_MS === 600 && RESERVE_MS === 100);
  ok("A4. startup requires 5 samples", STARTUP_SAMPLES === 5);
  ok("A5. RTT cap 100 ms, discrepancy cap 10 ms, E cap 10 ms", RTT_MAX_US === 100000 && WALL_MONO_DISCREPANCY_MAX_US === 10000 && E_MAX_US === 10000);

  // ── B. evaluateSample physics ──
  const good = evaluateSample(raw());
  ok("B1. baseline valid sample ok", good.ok === true);
  ok("B2. baseline L/U/rtt/e exact", good.L === 0 && good.U === 3000 && good.rttUs === 2000 && good.eUs === 1000 && good.absBoundUs === 3000);

  // RTT boundary: exactly 100 ms passes, +1 µs fails (wall matched so discrepancy stays 0)
  const rttExact = evaluateSample(raw({ monoRecvUs: M + 100000, wallRecvLoUs: W + 100000, wallRecvHiUs: W + 101000 }));
  ok("B3. RTT exactly 100 ms passes", rttExact.ok === true && rttExact.rttUs === 100000);
  const rttOver = evaluateSample(raw({ monoRecvUs: M + 100001, wallRecvLoUs: W + 100000, wallRecvHiUs: W + 101000 }));
  ok("B4. RTT 100 ms + 1 µs fails closed", rttOver.ok === false && rttOver.reason === "rtt_exceeds_max");

  const monoBack = evaluateSample(raw({ monoRecvUs: M - 1 }));
  ok("B5. monotonic backward fails", monoBack.ok === false && monoBack.reason === "monotonic_backward");

  const wallBack = evaluateSample(raw({ wallRecvLoUs: W - 1000, wallRecvHiUs: W - 1000 + 1000 }));
  ok("B6. wall moved backward fails", wallBack.ok === false && wallBack.reason === "wall_moved_backward");

  // discrepancy: wall elapsed exceeds monotonic RTT by > 10 ms ⇒ detected clock step
  const disc = evaluateSample(raw({ wallRecvLoUs: W + 15000, wallRecvHiUs: W + 16000 }));
  ok("B7. wall/monotonic discrepancy (clock step) fails", disc.ok === false && disc.reason === "wall_monotonic_discrepancy");
  // discrepancy contributes to E, so the largest discrepancy that can pass keeps E ≤ 10 ms
  // (capture 1 ms + discrepancy 9 ms = E 10 ms, the boundary).
  const discEdge = evaluateSample(raw({ monoRecvUs: M + 2000, wallRecvLoUs: W + 11000, wallRecvHiUs: W + 12000 }));
  ok("B8. discrepancy 9 ms with E at the 10 ms cap passes", discEdge.ok === true && discEdge.eUs === E_MAX_US);
  // discrepancy over the 10 ms cap is caught even if E were somehow within budget
  const discOver = evaluateSample(raw({ monoRecvUs: M + 2000, wallRecvLoUs: W + 20000, wallRecvHiUs: W + 20000 }));
  ok("B8b. discrepancy > 10 ms fails closed", discOver.ok === false && (discOver.reason === "wall_monotonic_discrepancy" || discOver.reason === "uncertainty_exceeds_max"));

  // E cap: capture bracket 11 ms ⇒ uncertainty over 10 ms fails
  const eOver = evaluateSample(raw({ wallSendHiUs: W + 11000 }));
  ok("B9. sample uncertainty E > 10 ms fails", eOver.ok === false && eOver.reason === "uncertainty_exceeds_max");

  ok("B10. dbUs ≤ 0 fails", evaluateSample(raw({ dbUs: 0 })).reason === "db_time_invalid");
  ok("B11. non-integer field fails", evaluateSample(raw({ dbUs: 1.5 })).reason === "sample_field_not_integer:dbUs");
  ok("B12. inverted send bracket fails", evaluateSample(raw({ wallSendHiUs: W - 1 })).reason === "wall_bracket_inverted");
  ok("B13. absent sample fails", evaluateSample(null).reason === "sample_absent");

  // ── C. hull (union) ──
  const h = hull([{ L: -5000, U: 3000 }, { L: 1000, U: 9000 }, { L: -2000, U: 4000 }]);
  ok("C1. hull is [minL, maxU]", h.L === -5000 && h.U === 9000 && h.absBoundUs === 9000);
  ok("C2. empty hull → null", hull([]) === null);
  // hull abs bound can never exceed the max member bound (per-sample gate already enforced)
  const members = [{ L: -SERVICE_ABS_BOUND_US, U: 0, absBoundUs: SERVICE_ABS_BOUND_US }, { L: 0, U: SERVICE_ABS_BOUND_US, absBoundUs: SERVICE_ABS_BOUND_US }];
  ok("C3. hull of two in-bound samples stays in bound", serviceGateOk(hull(members)));

  // ── D. per-service absolute bound ──
  ok("D1. service bound at exactly 250 ms passes", serviceGateOk({ absBoundUs: SERVICE_ABS_BOUND_US }));
  ok("D2. service bound 250 ms + 1 µs fails", serviceGateOk({ absBoundUs: SERVICE_ABS_BOUND_US + 1 }) === false);
  ok("D3. service gate null-safe", serviceGateOk(null) === false);

  // ── E. pairwise interval (shared DB offset cancels) ──
  const pi = pairwiseInterval({ L: 10000, U: 20000 }, { L: 5000, U: 15000 });
  ok("E1. pairwise = [Lr−Ua, Ur−La]", pi.L === -5000 && pi.U === 15000 && pi.absBoundUs === 15000);
  ok("E2. pairwise gate within 500 ms passes", pairwiseGateOk({ L: 0, U: 100000 }, { L: 0, U: 100000 }));
  ok("E3. pairwise exactly 500 ms passes", pairwiseGateOk({ L: 0, U: PAIRWISE_ABS_BOUND_US }, { L: 0, U: 0 }));
  ok("E4. pairwise 500 ms + 1 µs fails", pairwiseGateOk({ L: 0, U: PAIRWISE_ABS_BOUND_US + 1 }, { L: 0, U: 0 }) === false);
  ok("E5. pairwise null-safe", pairwiseInterval(null, { L: 0, U: 0 }) === null);

  // ── F. startup clock gate ──
  const okSample = () => good;                     // a fixed in-bound sample
  const badSample = () => ({ ok: false, reason: "db_probe_failed" });
  {
    const r = await runStartupClockGate({ takeSampleFn: okSample });
    ok("F1. 5 consecutive valid → gate passes", r.ok === true && r.samples.length === 5 && serviceGateOk(r.interval));
  }
  {
    // an invalid sample RESETS the consecutive run (no cherry-picking)
    let i = 0; const seq = [good, good, { ok: false, reason: "x" }, good, good, good, good, good];
    const tf = async () => seq[Math.min(i++, seq.length - 1)];
    const r = await runStartupClockGate({ takeSampleFn: tf });
    ok("F2. invalid sample resets run, then 5 consecutive pass", r.ok === true && r.samples.length === 5);
  }
  {
    const r = await runStartupClockGate({ takeSampleFn: badSample, maxAttempts: 7 });
    ok("F3. never 5 consecutive within attempts → fail closed", r.ok === false && r.attempts === 7);
  }
  {
    // an in-bound-but-out-of-service sample (absBound > 250 ms) never counts
    const bigBound = evaluateSample(raw({ dbUs: DB - (SERVICE_ABS_BOUND_US + 5000), wallRecvHiUs: W + 3000 }));
    const tf = async () => bigBound;
    const r = await runStartupClockGate({ takeSampleFn: tf, maxAttempts: 6 });
    ok("F4. out-of-service samples never satisfy startup", bigBound.ok === true && bigBound.absBoundUs > SERVICE_ABS_BOUND_US && r.ok === false);
  }
  ok("F5. missing takeSampleFn → fail closed", (await runStartupClockGate({})).ok === false);

  // ── G. runtime clock monitor ──
  {
    let mono = 0; const monoNowUs = () => mono;
    let sample = good; let invalidations = 0; let lastReason = null;
    const tf = async () => sample;
    const mon = createClockMonitor({ takeSampleFn: tf, monoNowUs, onInvalid: (r) => { invalidations++; lastReason = r; } });
    const s1 = await mon.sampleOnce();
    ok("G1. good sample → healthy + interval", s1.ok === true && mon.healthy(mono) && !!mon.currentInterval(mono));
    // staleness: advance mono beyond 2 s max age WITHOUT a new sample
    mono += 2_000_001;
    ok("G2. stale (> 2 s) → not fresh, not healthy, interval null", mon.fresh(mono) === false && mon.healthy(mono) === false && mon.currentInterval(mono) === null);
    // a failing sample invalidates (onInvalid once) and latches
    sample = { ok: false, reason: "db_probe_failed" };
    await mon.sampleOnce(); await mon.sampleOnce();
    ok("G3. failing sample invalidates once (latched)", invalidations === 1 && lastReason === "db_probe_failed" && mon.invalidatedReason === "db_probe_failed");
    ok("G4. invalidated monitor is unhealthy", mon.healthy(mono) === false);
    // a fresh good sample clears the latch
    sample = good; const rec = await mon.sampleOnce();
    ok("G5. fresh good sample clears the invalid latch", rec.ok === true && mon.invalidatedReason === null && mon.healthy(mono));
    // an out-of-service sample invalidates
    sample = evaluateSample(raw({ dbUs: DB - (SERVICE_ABS_BOUND_US + 5000) }));
    await mon.sampleOnce();
    ok("G6. out-of-service sample invalidates the monitor", mon.invalidatedReason === "service_bound_exceeded");
    mon.stop();
    ok("G7. stopped monitor is never healthy", mon.healthy(0) === false);
  }
  ok("G8. monitor requires clock deps", (() => { try { createClockMonitor({}); return false; } catch { return true; } })());

  console.log("\n══════════════════════════════════════════════════════════");
  console.log(`RESULT: ${pass} passed, ${fail} failed  (executed assertions: ${pass + fail})`);
  if (fail > 0) { console.log("FAILURES:", fails.join(" | ")); process.exitCode = 1; return; }
  console.log("OFFLINE CLOCK MATRIX (§27): PASS");
  process.exitCode = 0;
}
run().catch((e) => { console.log("HARNESS ERROR:", e && e.stack); process.exitCode = 1; });
