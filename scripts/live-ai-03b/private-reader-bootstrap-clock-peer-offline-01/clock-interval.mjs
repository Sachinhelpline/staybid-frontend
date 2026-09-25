// ─────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — BOOTSTRAP: COMMON DB-CLOCK INTERVAL UTILITY (OFFLINE). Node built-ins only. PURE math.
//
// Three DISTINCT clock domains, never cross-subtracted:
//   • local WALL clock      — Date.now() (ms; may step forward/backward; truncated to ms).
//   • local MONOTONIC clock — performance.now() (sub-ms; never steps; the only source used for RTT).
//   • database WALL clock   — clock_timestamp() from the shared AI-STAGING PostgreSQL (µs).
// The DB wall clock is the SHARED reference both reader and attester measure against; the DB offset cancels
// in the reader↔attester pairwise difference, so the pairwise skew is measured WITHOUT trusting either
// service's own wall clock to be NTP-accurate.
//
// A "sample" measures the conservative interval  I_s = [L, U]  of  (service local wall − DB wall)  in
// microseconds, using the NTP-style bracket:  the DB read happened at some instant between our send and our
// receive, so the local wall at that instant is within [wallSendLo, wallRecvHi]; therefore
//   L = wallSendLo − dbUs,  U = wallRecvHi − dbUs.
// RTT is measured on the MONOTONIC clock (immune to wall steps). Wall-vs-monotonic disagreement during the
// sample is a detected clock STEP and fails the sample closed — a step is never hidden inside a wide interval.
//
// All arithmetic is integer microseconds (epoch µs ≈ 1.7e15 < 2^53, safe). No midpoint / symmetric-network
// assumption is used for the bound; the interval spans the full send→receive uncertainty.
// ─────────────────────────────────────────────────────────────────────────

// ── Frozen architecture thresholds ──
export const RTT_MAX_MS = 100;                 // monotonic RTT cap per sample
export const WALL_MONO_DISCREPANCY_MAX_MS = 10;// wall vs monotonic elapsed disagreement (clock step) cap
export const E_MAX_MS = 10;                     // conservative sample uncertainty cap; unbounded ⇒ FAIL
export const SERVICE_ABS_BOUND_MS = 250;        // per-service |interval| bound
export const PAIRWISE_ABS_BOUND_MS = 500;       // reader↔attester |interval| bound
export const ACCEPTED_MAX_MS = 600;             // accepted invariant ceiling
export const RESERVE_MS = ACCEPTED_MAX_MS - PAIRWISE_ABS_BOUND_MS; // 100 ms reserved safety margin
export const STARTUP_SAMPLES = 5;               // consecutive valid samples required at startup
export const STARTUP_MAX_ATTEMPTS = 30;         // bounded total attempts to reach 5 consecutive
export const MONITOR_PERIOD_MS = 1000;          // one clock probe every second
export const MAX_SAMPLE_AGE_MS = 2000;          // maximum acceptable age of the last successful sample

const US = 1000;                                // µs per ms
const MS_QUANTIZATION_US = 1 * US;              // Date.now() truncates to whole ms
export const RTT_MAX_US = RTT_MAX_MS * US;
export const WALL_MONO_DISCREPANCY_MAX_US = WALL_MONO_DISCREPANCY_MAX_MS * US;
export const E_MAX_US = E_MAX_MS * US;
export const SERVICE_ABS_BOUND_US = SERVICE_ABS_BOUND_MS * US;
export const PAIRWISE_ABS_BOUND_US = PAIRWISE_ABS_BOUND_MS * US;

const isSafeInt = (n) => typeof n === "number" && Number.isInteger(n) && Number.isSafeInteger(n);
function fail(reason) { return { ok: false, reason }; }

/**
 * Evaluate one raw clock sample into a conservative interval, or fail closed.
 * @param raw {
 *   wallSendLoUs, wallSendHiUs,   // local wall bracket at send  (µs; hi = lo of the second read + quantization)
 *   monoSendUs, monoRecvUs,       // local monotonic at send / receive (µs)
 *   wallRecvLoUs, wallRecvHiUs,   // local wall bracket at receive (µs)
 *   dbUs                          // database clock_timestamp (µs)
 * }
 * @returns { ok:true, L, U, rttUs, eUs, absBoundUs } | { ok:false, reason }
 */
export function evaluateSample(raw) {
  if (!raw || typeof raw !== "object") return fail("sample_absent");
  const { wallSendLoUs, wallSendHiUs, monoSendUs, monoRecvUs, wallRecvLoUs, wallRecvHiUs, dbUs } = raw;
  for (const [k, v] of Object.entries({ wallSendLoUs, wallSendHiUs, monoSendUs, monoRecvUs, wallRecvLoUs, wallRecvHiUs, dbUs })) {
    if (!isSafeInt(v)) return fail("sample_field_not_integer:" + k);
  }
  if (dbUs <= 0) return fail("db_time_invalid");
  // internal bracket ordering (each capture's lo ≤ hi)
  if (wallSendHiUs < wallSendLoUs || wallRecvHiUs < wallRecvLoUs) return fail("wall_bracket_inverted");
  // monotonic RTT — the authoritative round-trip
  const rttUs = monoRecvUs - monoSendUs;
  if (rttUs < 0) return fail("monotonic_backward");           // monotonic must never go backward
  if (rttUs > RTT_MAX_US) return fail("rtt_exceeds_max");
  // wall must not move backward across the sample
  if (wallRecvLoUs < wallSendLoUs) return fail("wall_moved_backward");
  // wall-vs-monotonic elapsed disagreement ⇒ a wall clock STEP during the sample ⇒ fail closed
  const wallElapsedUs = wallRecvLoUs - wallSendLoUs;          // conservative lower estimate of wall elapsed
  const wallMonoDiscrepancyUs = Math.abs(wallElapsedUs - rttUs);
  if (wallMonoDiscrepancyUs > WALL_MONO_DISCREPANCY_MAX_US) return fail("wall_monotonic_discrepancy");
  // conservative sample uncertainty E = capture-bracket width + wall/monotonic disagreement
  const captureUncertaintyUs = Math.max(wallSendHiUs - wallSendLoUs, wallRecvHiUs - wallRecvLoUs);
  const eUs = captureUncertaintyUs + wallMonoDiscrepancyUs;
  if (eUs > E_MAX_US) return fail("uncertainty_exceeds_max");
  // conservative interval: the DB read instant's local wall ∈ [wallSendLo, wallRecvHi]
  const L = wallSendLoUs - dbUs;
  const U = wallRecvHiUs - dbUs;
  if (U < L) return fail("interval_inverted");
  const absBoundUs = Math.max(Math.abs(L), Math.abs(U));
  return { ok: true, L, U, rttUs, eUs, absBoundUs };
}

/** Conservative hull (union) of several accepted intervals: [min L, max U]. A wide/outlier sample widens the
 *  hull and fails the gate rather than being cherry-picked away. */
export function hull(intervals) {
  if (!Array.isArray(intervals) || intervals.length === 0) return null;
  let L = Infinity, U = -Infinity;
  for (const iv of intervals) { if (iv.L < L) L = iv.L; if (iv.U > U) U = iv.U; }
  return { L, U, absBoundUs: Math.max(Math.abs(L), Math.abs(U)) };
}

/** Per-service gate: the hull's absolute bound ≤ 250 ms. */
export function serviceGateOk(interval) {
  return !!interval && interval.absBoundUs <= SERVICE_ABS_BOUND_US;
}

/** Reader↔attester pairwise interval: (reader − attester) = (reader − db) − (attester − db).
 *  reader − attester ∈ [Lr − Ua, Ur − La]. The shared DB offset cancels. */
export function pairwiseInterval(readerIv, attesterIv) {
  if (!readerIv || !attesterIv) return null;
  const L = readerIv.L - attesterIv.U;
  const U = readerIv.U - attesterIv.L;
  return { L, U, absBoundUs: Math.max(Math.abs(L), Math.abs(U)) };
}

/** Pairwise gate: |reader − attester| ≤ 500 ms (100 ms reserve under the 600 ms accepted ceiling). */
export function pairwiseGateOk(readerIv, attesterIv) {
  const pi = pairwiseInterval(readerIv, attesterIv);
  return !!pi && pi.absBoundUs <= PAIRWISE_ABS_BOUND_US;
}

/**
 * Capture one raw sample using injected clocks + a DB clock probe, then evaluate it.
 * @param deps.wallNowMs  () → integer ms (default Date.now)
 * @param deps.monoNowUs  () → integer µs monotonic (default performance.now()*1000 rounded)
 * @param deps.probe      async () → { dbUs, ...fingerprint } (the fixed read-only DB clock query)
 * Returns { ok:true, L,U,rttUs,eUs,absBoundUs, probe } or { ok:false, reason }.
 */
export async function takeSample(deps) {
  const wallNowMs = deps.wallNowMs;
  const monoNowUs = deps.monoNowUs;
  const probe = deps.probe;
  if (typeof wallNowMs !== "function" || typeof monoNowUs !== "function" || typeof probe !== "function") {
    return fail("clock_deps_invalid");
  }
  const wLoA = wallNowMs(); const mSend = monoNowUs(); const wHiA = wallNowMs();
  let pr;
  try { pr = await probe(); } catch { return fail("db_probe_failed"); }
  const wLoB = wallNowMs(); const mRecv = monoNowUs(); const wHiB = wallNowMs();
  if (!pr || !isSafeInt(pr.dbUs)) return fail("db_probe_time_invalid");
  const raw = {
    wallSendLoUs: wLoA * US, wallSendHiUs: wHiA * US + MS_QUANTIZATION_US,
    monoSendUs: mSend, monoRecvUs: mRecv,
    wallRecvLoUs: wLoB * US, wallRecvHiUs: wHiB * US + MS_QUANTIZATION_US,
    dbUs: pr.dbUs,
  };
  const ev = evaluateSample(raw);
  if (!ev.ok) return ev;
  return { ...ev, probe: pr };
}

/** Default monotonic clock in integer microseconds (rounded from performance.now() ms). */
export function defaultMonoNowUs(perf) {
  const p = perf && typeof perf.now === "function" ? perf : null;
  return () => Math.round((p ? p.now() : 0) * US);
}
