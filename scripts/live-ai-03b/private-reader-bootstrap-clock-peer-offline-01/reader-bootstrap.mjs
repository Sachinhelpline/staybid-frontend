// ─────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — BOOTSTRAP: versioned READER bootstrap (OFFLINE). Node built-ins only.
//
// The reader can be RUNNING but NOT SERVING. It starts UNPROVISIONED → WAITING_FOR_CLOCK (own startup clock
// gate) → WAITING_FOR_ATTESTER, and reaches AUTHORITY_READY only via a clock BRACKET around a v2 attestation:
//   pre-sample → clock-bound v2 request → signed proof → accepted verifier → post-sample → consistency check.
// Authority is accepted ONLY when pre+post samples are valid, the proof is cryptographically valid and bound to
// the exact token+nonce, and the shared DB clock advanced consistently with the reader's own monotonic clock
// across the bracket (a DB clock step is detected and rejected). A signature alone never confers authority.
//
// M1-R1 (invalidation / re-entry race — LOAD-BEARING): every authority-acquisition attempt is permanently bound
// to the exact GENERATION it started under. A clock/monitor invalidation atomically clears authority, rotates
// the generation, INVALIDATES the completed startup-gate evidence (a re-gate is required), and returns the reader
// to WAITING_FOR_CLOCK. An acquisition whose generation is superseded across ANY awaited phase is DEAD: it can
// never install authority, never be rebound to a later generation, and is never rescued by a single later clock
// sample. Re-entry requires, in order: a COMPLETE fresh five-consecutive-sample startup gate (`regate()`), then a
// NEW acquisition (new request nonce → new attestation → valid proof → valid post-bracket) whose generation is
// STILL current at the final atomic install. Concurrent acquisitions are refused.
//
// This offline milestone NEVER opens the gateway observation listener; serving() is always false.
// ─────────────────────────────────────────────────────────────────────────
import { runStartupClockGate, createClockMonitor } from "./clock-gate.mjs";
import { serviceGateOk, RTT_MAX_US, WALL_MONO_DISCREPANCY_MAX_US } from "./clock-interval.mjs";
import { STATES, createBootGeneration, randomHex, obtainV2 } from "./bootstrap-state.mjs";
import { verifyReaderAttestation } from "../private-reader-production-integration-offline-01/reader-attestation.mjs";

export const READER_BOOTSTRAP_VERSION = "reader-bootstrap-v1";
export const EXIT = Object.freeze({ unprovisioned: 70, clock_lost: 74 });
// bracket tolerance: two probe RTTs + one wall/monotonic discrepancy budget
export const BRACKET_STEP_TOL_US = 2 * RTT_MAX_US + WALL_MONO_DISCREPANCY_MAX_US;

/**
 * Start the reader bootstrap.
 * @param opts.takeSampleFn async () → reader clock sample (has .probe.dbUs)
 * @param opts.connectionToken the reader's own re-derivable connection token (accepted derivation)
 * @param opts.attester { host, port }
 * @param opts.channelSecret shared with the attester
 * @param opts.trustRoot accepted attester trust root (makeAttesterTrustRoot(...).trustRoot)
 * @param opts.monoNowUs / opts.nowMs clocks
 * @param opts.offlineTestBoundary must be true
 * @param opts.obtainV2Fn (offline-test seam ONLY) override the v2 client for deterministic barrier tests
 * @param opts.startMonitor start the 1 s runtime probe (default true; tests drive sampleOnce manually)
 */
export async function startReaderBootstrap(opts) {
  const {
    takeSampleFn, connectionToken, attester, channelSecret, trustRoot, monoNowUs, nowMs = Date.now,
    log = () => {}, offlineTestBoundary = false, onClockLost, startMonitor = true, obtainV2Fn = obtainV2,
  } = opts;
  if (!offlineTestBoundary) return { started: false, status: STATES.UNPROVISIONED, reason: "offline_test_boundary_required" };
  if (typeof takeSampleFn !== "function" || typeof connectionToken !== "string" || !attester || !trustRoot || typeof monoNowUs !== "function") {
    return { started: false, status: STATES.UNPROVISIONED, reason: "reader_bootstrap_deps_incomplete" };
  }

  let generation = createBootGeneration();
  let gatePassedForGeneration = null;   // the generation id for which a FULL 5-sample startup gate most recently passed
  let status = STATES.WAITING_FOR_CLOCK;
  let authority = null;                  // { envelope, generation, atMonoUs }
  let acquiring = false;                 // concurrent-acquisition guard

  // (1) initial startup clock gate — a generation-bound attempt (uniform with regate()). No invalidation source
  //     exists yet (the monitor is created below), but we snapshot + re-verify defensively and bind to the SNAPSHOT.
  const bootGen = generation.id;
  const startup = await runGenerationBoundGate(bootGen);
  if (!startup.ok) { status = generation.id === bootGen ? STATES.CLOCK_INVALID : STATES.WAITING_FOR_CLOCK; }
  else { gatePassedForGeneration = bootGen; status = STATES.WAITING_FOR_ATTESTER; }

  // (2) runtime monitor — an invalidation atomically kills authority + startup-gate evidence + rotates generation
  const monitor = createClockMonitor({
    takeSampleFn, monoNowUs, onInvalid: (reason) => {
      authority = null;
      gatePassedForGeneration = null;              // completed startup gate is INVALIDATED — a fresh re-gate is required
      generation = createBootGeneration();         // rotate: any in-flight acquisition is now superseded (DEAD)
      status = STATES.WAITING_FOR_CLOCK;           // non-authoritative clock-gating state, NOT WAITING_FOR_ATTESTER
      log(JSON.stringify({ reader: READER_BOOTSTRAP_VERSION, event: "clock_invalidated", reason }));
      try { if (typeof onClockLost === "function") onClockLost(reason); } catch {}
    },
  });
  if (startup.ok) { await monitor.sampleOnce(); if (startMonitor) monitor.start(); }

  /**
   * Run a COMPLETE five-consecutive-sample startup gate BOUND to `startGen`. A sample whose await crosses an
   * invalidation (generation rotated) is discarded — so no pre-invalidation sample can ever count toward a
   * post-invalidation pass, and a run interrupted by an invalidation can never accumulate five. Returns ok ONLY
   * if the gate passed AND the generation is still `startGen` (rechecked after the gate). Binds nothing.
   */
  async function runGenerationBoundGate(startGen) {
    const guardedTake = async () => {
      const s = await takeSampleFn();
      if (generation.id !== startGen) return { ok: false, reason: "generation_superseded" };
      return s;
    };
    const r = await runStartupClockGate({ takeSampleFn: guardedTake });
    if (generation.id !== startGen) return { ok: false, reason: "generation_superseded" };
    return r;
  }

  /**
   * Re-establish clock eligibility after an invalidation: a COMPLETE fresh five-consecutive-sample gate under ONE
   * unchanged generation, then a fresh monitor seed, then a FINAL SYNCHRONOUS bind that re-verifies the unchanged
   * start generation and binds to the SNAPSHOT (never "whatever generation is current now"). A single/handful of
   * good monitor samples is NOT a substitute, and clock eligibility alone never confers authority (fresh
   * attestation via acquireAuthority is still required).
   */
  async function regate() {
    const startGen = generation.id;                     // this re-gate attempt belongs PERMANENTLY to this generation
    const r = await runGenerationBoundGate(startGen);
    if (generation.id !== startGen) return { ok: false, reason: "generation_superseded" };  // invalidated mid-gate → no bind
    if (!r.ok) { gatePassedForGeneration = null; status = STATES.WAITING_FOR_CLOCK; return { ok: false, reason: r.reason }; }
    const seed = await monitor.sampleOnce();
    if (generation.id !== startGen) return { ok: false, reason: "generation_superseded" };  // invalidated during seed → no bind
    if (!seed.ok) { gatePassedForGeneration = null; status = STATES.WAITING_FOR_CLOCK; return { ok: false, reason: seed.reason }; }
    // ── FINAL SYNCHRONOUS BIND: only after the unchanged start generation is re-verified one last time ──
    if (generation.id !== startGen) return { ok: false, reason: "generation_superseded" };
    gatePassedForGeneration = startGen;                 // bind to the SNAPSHOT, never the current generation
    status = STATES.WAITING_FOR_ATTESTER;
    return { ok: true, generation: startGen };
  }

  /** Acquire authority via the clock bracket, bound to the generation captured at start. */
  async function doAcquire() {
    const startGen = generation.id;                 // snapshot the generation/epoch this attempt belongs to
    // an attempt is valid only while its generation is current AND that generation still holds a passed gate
    const stillCurrent = () => generation.id === startGen && gatePassedForGeneration === startGen && status !== STATES.CLOCK_INVALID;
    if (status === STATES.CLOCK_INVALID) return { ok: false, reason: "clock_invalid" };
    if (gatePassedForGeneration !== startGen) return { ok: false, reason: "clock_gate_required" };
    if (!monitor.healthy(monoNowUs())) return { ok: false, reason: "monitor_unhealthy" };

    const monoBefore = monoNowUs();
    const pre = await takeSampleFn();
    if (!stillCurrent()) return { ok: false, reason: "generation_superseded" };
    if (!pre.ok || !serviceGateOk(pre)) return { ok: false, reason: pre.ok ? "pre_sample_out_of_bound" : pre.reason };

    const requestNonce = randomHex(16);
    const res = await obtainV2Fn({ host: attester.host, port: attester.port, channelSecret, connectionToken, requestNonce, readerClock: { L: pre.L, U: pre.U, generation: startGen }, nowMs });
    if (!stillCurrent()) return { ok: false, reason: "generation_superseded" };   // late response cannot install
    if (!res.ok) return { ok: false, reason: "attestation_" + res.code };

    const verified = verifyReaderAttestation(res.envelope, { trustRoot, expectedConnectionToken: connectionToken, expectedRequestNonce: requestNonce, now: nowMs() });
    if (!stillCurrent()) return { ok: false, reason: "generation_superseded" };   // late/stale proof cannot install
    if (!verified.ok) return { ok: false, reason: "proof_" + verified.reason };

    const post = await takeSampleFn();
    const monoAfter = monoNowUs();
    if (!stillCurrent()) return { ok: false, reason: "generation_superseded" };
    if (!post.ok || !serviceGateOk(post)) return { ok: false, reason: post.ok ? "post_sample_out_of_bound" : post.reason };

    // shared-DB clock consistency across the bracket vs the reader's own monotonic clock
    const dbElapsed = post.probe.dbUs - pre.probe.dbUs;
    const monoElapsed = monoAfter - monoBefore;
    if (dbElapsed < 0) return { ok: false, reason: "db_clock_backward" };
    if (Math.abs(dbElapsed - monoElapsed) > BRACKET_STEP_TOL_US) return { ok: false, reason: "common_db_clock_inconsistency" };

    // ── FINAL ATOMIC INSTALL: no invalidation may have occurred since start; gate + monitor still current/healthy ──
    if (!stillCurrent() || !monitor.healthy(monoNowUs())) return { ok: false, reason: "generation_superseded" };
    authority = { envelope: res.envelope, generation: startGen, atMonoUs: monoAfter, requestNonce };
    status = STATES.AUTHORITY_READY;
    return { ok: true, generation: startGen };
  }

  async function acquireAuthority() {
    if (acquiring) return { ok: false, reason: "acquire_in_progress" };
    acquiring = true;
    try { return await doAcquire(); } finally { acquiring = false; }
  }

  return Object.freeze({
    started: true,
    status: () => status,
    generation: () => generation.id,
    // authority is ready only if it was installed for the CURRENT generation and the monitor is still healthy
    authorityReady: () => status === STATES.AUTHORITY_READY && !!authority && authority.generation === generation.id && monitor.healthy(monoNowUs()),
    authorityGeneration: () => (authority ? authority.generation : null),
    authorityRequestNonce: () => (authority ? authority.requestNonce : null),
    gatePassed: () => gatePassedForGeneration === generation.id,
    serving: () => false,                 // offline milestone: the gateway observation listener is NEVER opened
    startupPassed: startup.ok,
    monitor,
    acquireAuthority,
    regate,
    stats: () => ({ status, startupPassed: startup.ok, generation: generation.id, gatePassed: gatePassedForGeneration === generation.id, authority: authority ? { generation: authority.generation } : null, monitor: monitor.stats() }),
    async stop() { status = STATES.STOPPED; monitor.stop(); return true; },
  });
}
