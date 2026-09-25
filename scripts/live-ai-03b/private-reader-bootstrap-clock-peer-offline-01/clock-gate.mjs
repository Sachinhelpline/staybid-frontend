// ─────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — BOOTSTRAP: STARTUP clock gate + RUNTIME clock monitor (OFFLINE). Node built-ins only.
//
// Startup gate: require STARTUP_SAMPLES (5) CONSECUTIVE individually-valid samples, then require the
// conservative HULL of exactly those samples to pass the per-service absolute bound (≤ 250 ms). An invalid
// sample resets the consecutive run (no cherry-picking); the whole gate is bounded by STARTUP_MAX_ATTEMPTS and
// fails closed otherwise. Runtime monitor: one probe per second; the last successful sample is authoritative
// only while it is ≤ 2 s old AND still within the service bound; any failure/staleness invalidates the current
// authority generation via onInvalid and clears the cached interval (re-entry requires a fresh startup-grade pass).
// ─────────────────────────────────────────────────────────────────────────
import {
  serviceGateOk, STARTUP_SAMPLES, STARTUP_MAX_ATTEMPTS, MONITOR_PERIOD_MS, MAX_SAMPLE_AGE_MS,
} from "./clock-interval.mjs";

/**
 * Run the startup clock gate.
 * @param deps.takeSampleFn async () → sample ({ ok, L, U, absBoundUs, ... } | { ok:false, reason })
 * @param deps.needed default STARTUP_SAMPLES
 * @param deps.maxAttempts default STARTUP_MAX_ATTEMPTS
 * @returns { ok:true, interval:{L,U,absBoundUs}, samples } | { ok:false, reason, attempts }
 */
export async function runStartupClockGate(deps) {
  const takeSampleFn = deps && deps.takeSampleFn;
  const needed = deps && Number.isInteger(deps.needed) ? deps.needed : STARTUP_SAMPLES;
  const maxAttempts = deps && Number.isInteger(deps.maxAttempts) ? deps.maxAttempts : STARTUP_MAX_ATTEMPTS;
  if (typeof takeSampleFn !== "function") return { ok: false, reason: "take_sample_fn_required", attempts: 0 };
  let run = [];               // current consecutive-valid run
  let attempts = 0;
  let lastReason = "insufficient_samples";
  while (attempts < maxAttempts) {
    attempts++;
    let s; try { s = await takeSampleFn(); } catch { s = { ok: false, reason: "sample_threw" }; }
    if (!s || s.ok !== true) { run = []; lastReason = (s && s.reason) || "sample_invalid"; continue; } // reset run
    if (!serviceGateOk(s)) { run = []; lastReason = "service_bound_exceeded"; continue; }              // per-sample bound
    run.push({ L: s.L, U: s.U, absBoundUs: s.absBoundUs });
    if (run.length >= needed) {
      // conservative hull across exactly the accepted consecutive set
      let L = Infinity, U = -Infinity;
      for (const iv of run) { if (iv.L < L) L = iv.L; if (iv.U > U) U = iv.U; }
      const interval = { L, U, absBoundUs: Math.max(Math.abs(L), Math.abs(U)) };
      if (!serviceGateOk(interval)) return { ok: false, reason: "hull_bound_exceeded", attempts };
      return { ok: true, interval, samples: run.slice() };
    }
  }
  return { ok: false, reason: lastReason, attempts };
}

/**
 * Runtime clock monitor. Deterministic core (sampleOnce/fresh/currentInterval) for tests; start()/stop() add a
 * real 1 s scheduler for production. The monitor never mutates Railway/DB/credentials/config.
 * @param deps.takeSampleFn async () → sample
 * @param deps.monoNowUs () → integer µs monotonic
 * @param deps.onInvalid (reason) → void, called once per invalidation transition
 */
export function createClockMonitor(deps) {
  const takeSampleFn = deps.takeSampleFn;
  const monoNowUs = deps.monoNowUs;
  const periodMs = Number.isInteger(deps.periodMs) ? deps.periodMs : MONITOR_PERIOD_MS;
  const maxAgeUs = (Number.isInteger(deps.maxAgeMs) ? deps.maxAgeMs : MAX_SAMPLE_AGE_MS) * 1000;
  const onInvalid = typeof deps.onInvalid === "function" ? deps.onInvalid : () => {};
  if (typeof takeSampleFn !== "function" || typeof monoNowUs !== "function") throw new Error("clock_monitor_deps_invalid");

  let lastGood = null;          // { interval, atMonoUs }
  let invalidated = null;       // reason string once invalid, until a fresh good sample
  let stopped = false;
  let timer = null;

  function invalidate(reason) {
    lastGood = null;
    if (invalidated === null) { invalidated = reason; try { onInvalid(reason); } catch {} }
  }
  function fresh(nowMonoUs) { return !!lastGood && (nowMonoUs - lastGood.atMonoUs) <= maxAgeUs; }
  function currentInterval(nowMonoUs) { return fresh(nowMonoUs) ? lastGood.interval : null; }
  function healthy(nowMonoUs) { return !stopped && invalidated === null && fresh(nowMonoUs); }

  async function sampleOnce() {
    if (stopped) return { ok: false, reason: "monitor_stopped" };
    let s; try { s = await takeSampleFn(); } catch { s = { ok: false, reason: "sample_threw" }; }
    if (!s || s.ok !== true) { invalidate(s && s.reason ? s.reason : "sample_invalid"); return { ok: false, reason: (s && s.reason) || "sample_invalid" }; }
    if (!serviceGateOk(s)) { invalidate("service_bound_exceeded"); return { ok: false, reason: "service_bound_exceeded" }; }
    lastGood = { interval: { L: s.L, U: s.U, absBoundUs: s.absBoundUs }, atMonoUs: monoNowUs() };
    invalidated = null;                    // a fresh good sample clears the invalid latch
    return { ok: true, interval: lastGood.interval };
  }

  function start() {
    if (timer || stopped) return;
    timer = setInterval(() => {
      void sampleOnce().finally(() => { if (!stopped && !fresh(monoNowUs())) invalidate("sample_stale"); });
    }, periodMs);
    if (typeof timer.unref === "function") timer.unref();
  }
  function stop() { stopped = true; if (timer) { clearInterval(timer); timer = null; } }

  return Object.freeze({
    sampleOnce, currentInterval, fresh, healthy, invalidate, start, stop,
    get invalidatedReason() { return invalidated; },
    stats() { return { healthy: healthy(monoNowUs()), invalidatedReason: invalidated, lastGoodAtMonoUs: lastGood ? lastGood.atMonoUs : null }; },
  });
}
