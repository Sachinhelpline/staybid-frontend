// ─────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — BOOTSTRAP: versioned ATTESTER bootstrap (OFFLINE). Node built-ins only.
//
// State: the attester may be RUNNING + BOOTSTRAP_LISTENING before signing is enabled. The v2 listener exists
// from the start, but signer.issue() is unreachable until (a) the startup clock gate passed AND (b) the runtime
// clock monitor is fresh; every request additionally passes the pre-sign clock guard (reader↔attester pairwise
// ≤ 500 ms). A monitor invalidation disables signing and voids the authority generation; re-enabling requires a
// COMPLETE fresh startup-grade clock pass (regate), not a single good sample. Anchor/observer may be valid
// before signing — a valid anchor proves target identity only, never clock safety.
//
// M5 clock-recovery remediation: every clock invalidation immediately disables signing, sets CLOCK_INVALID and
// rotates the generation, then a bounded, SERIALIZED recovery controller (opt-in `autoRecover`; the production
// composition enables it) re-runs the COMPLETE startup-grade gate with deterministic backoff. Recovery re-enables
// signing only after: a fresh 5-consecutive-sample gate whose samples are bound to one unchanged invalidation
// epoch (and to zero interleaved monitor failures), the request-budget QUIESCENCE floor (so no request accepted
// before the invalidation can still be live), a fresh monitor seed, and a final synchronous recheck. A PEER
// invalidation (unsafe refresh / identity change) is a separate sticky latch: never restored by clock recovery.
//
// Offline-test boundary: takeSampleFn / observerProvider / signer / clocks / peer CIDRs are injected. A future
// live wiring (real dedicated clock session, observer credential, DNS peer resolver) is a separate gate.
// ─────────────────────────────────────────────────────────────────────────
import { performance } from "node:perf_hooks";
import { runStartupClockGate, createClockMonitor } from "./clock-gate.mjs";
import { startV2AttestationServer, V2_REQUEST_BUDGET_MS } from "./attestation-channel-v2.mjs";
import { STATES, createBootGeneration } from "./bootstrap-state.mjs";
import { serviceGateOk } from "./clock-interval.mjs";

export const ATTESTER_BOOTSTRAP_VERSION = "reader-attester-bootstrap-v1";
export const EXIT = Object.freeze({ unprovisioned: 70, clock_lost: 74 });
// Deterministic recovery backoff (ms) for attempt 1..5; every later attempt waits the last value (60 s).
export const RECOVERY_BACKOFF_MS = Object.freeze([5000, 10000, 20000, 40000, 60000]);
// A re-enable may happen no earlier than lastInvalidation + V2 request budget + this margin: any request accepted
// before the invalidation has then provably lost its authority window (ctx deadline + server budget timer).
export const RECOVERY_QUIESCENCE_MARGIN_MS = 250;
export const RECOVERY_QUIESCENCE_MS = V2_REQUEST_BUDGET_MS + RECOVERY_QUIESCENCE_MARGIN_MS;
// stop() waits at most this long for an in-flight recovery to settle (it can only be finishing a sample that had
// already started; nothing new starts after stop). An uncooperative promise is detached, never awaited forever.
export const STOP_RECOVERY_CONTAIN_MS = 2500;

const SAFE_REASON = /^[a-z0-9_]{1,48}$/;
/** Map an invalidation reason to a fixed, non-sensitive class (peer resolver detail is never propagated). */
function peerClassOf(reason) {
  const r = typeof reason === "string" ? reason : "";
  if (r.startsWith("peer_identity_changed")) return "peer_identity_changed";
  if (r.startsWith("peer_unsafe")) return "peer_unsafe";
  return "peer_other";
}
export function reasonClassOf(reason) {
  const r = typeof reason === "string" ? reason : "";
  if (r.startsWith("peer_") && !SAFE_REASON.test(r)) return peerClassOf(r);   // e.g. "peer_unsafe:<resolver code>"
  return SAFE_REASON.test(r) ? r : "other";
}
const isPeerReason = (reason) => typeof reason === "string" && reason.startsWith("peer_");
const defaultSetTimer = (fn, ms) => { const t = setTimeout(fn, ms); if (t && typeof t.unref === "function") t.unref(); return t; };
const defaultClearTimer = (t) => clearTimeout(t);

/**
 * Start the attester bootstrap.
 * @param opts.takeSampleFn async () → clock sample (built from the DB clock probe on the attester's session)
 * @param opts.observerProvider async () → { ok, observer }
 * @param opts.signer accepted Ed25519 signing adapter
 * @param opts.anchor parsed deployment anchor (required)
 * @param opts.channelSecret shared with the reader
 * @param opts.listen { bindHost, port, allowWildcardBind? }
 * @param opts.peerCidrs exact-host allowlist for the reader peer (from the private-peer resolver)
 * @param opts.monoNowUs / opts.nowMs clocks
 * @param opts.offlineTestBoundary must be true to accept injected deps
 * @param opts.autoRecover opt-in automatic, serialized clock recovery (default false; production passes true)
 * @param opts.recoveryBackoffMs deterministic backoff schedule (default RECOVERY_BACKOFF_MS)
 * @param opts.quiescenceMs re-enable floor after an invalidation (default RECOVERY_QUIESCENCE_MS; never below it
 *   in production — tests may only RAISE or keep it)
 * @param opts.setTimer / opts.clearTimer injectable one-shot timers (deterministic tests)
 * @param opts.heartbeatMs periodic sanitized `state` event (0 = off; production passes 60000)
 * Returns a control handle, or { started:false, status, reason }.
 */
export async function startAttesterBootstrap(opts) {
  const { takeSampleFn, observerProvider, signer, anchor, channelSecret, listen, peerCidrs, monoNowUs, nowMs = Date.now, log = () => {}, offlineTestBoundary = false, onClockLost, startMonitor = true,
    autoRecover = false, recoveryBackoffMs = RECOVERY_BACKOFF_MS, setTimer = defaultSetTimer, clearTimer = defaultClearTimer, heartbeatMs = 0 } = opts;
  if (!offlineTestBoundary) return { started: false, status: STATES.UNPROVISIONED, reason: "offline_test_boundary_required" };
  if (typeof takeSampleFn !== "function" || typeof observerProvider !== "function" || !signer || !anchor || typeof monoNowUs !== "function") {
    return { started: false, status: STATES.UNPROVISIONED, reason: "attester_bootstrap_deps_incomplete" };
  }
  const backoff = Array.isArray(recoveryBackoffMs) && recoveryBackoffMs.length > 0 && recoveryBackoffMs.every((n) => Number.isInteger(n) && n >= 0)
    ? recoveryBackoffMs.slice() : RECOVERY_BACKOFF_MS.slice();
  const quiescenceMs = Number.isInteger(opts.quiescenceMs) && opts.quiescenceMs >= RECOVERY_QUIESCENCE_MS ? opts.quiescenceMs : RECOVERY_QUIESCENCE_MS;
  const localMs = () => performance.now();          // process-monotonic, independent of any injected clock

  const emit = (event, fields) => { try { log(JSON.stringify({ attester: ATTESTER_BOOTSTRAP_VERSION, event, ...(fields || {}) })); } catch {} };

  let generation = createBootGeneration();
  let signingReady = false;
  let status = STATES.WAITING_FOR_CLOCK;
  let stopped = false;
  let epoch = 0;                         // bumps on EVERY invalidation (clock or peer) and on stop
  let peerInvalid = null;                // sticky: "peer_unsafe" | "peer_identity_changed" | "peer_other"
  let lastInvalidationAtMs = null;       // localMs() of the last invalidation that could have followed signing
  let lastReasonClass = null;
  let monitorFailSeq = 0;                // count of failed monitor samples (binds regate samples to "no interleaved failure")
  let regating = false;
  let activeRegate = null;               // the in-flight regate promise (auto or manual), for bounded stop containment
  const pendingDelays = new Set();       // abortable quiescence waits (released immediately by stop())
  let monitorStarted = false;
  let server = null;
  const rc = { timer: null, inFlight: false, attempt: 0, scheduled: 0, started: 0, passed: 0, failed: 0, lastNextDelayMs: null };
  const inv = { clock: 0, peer: 0 };

  // monitor samples are wrapped only to COUNT failures (the sample itself is passed through unchanged)
  const monitorTake = async () => {
    let s; try { s = await takeSampleFn(); } catch { s = { ok: false, reason: "sample_threw" }; }
    if (!s || s.ok !== true || !serviceGateOk(s)) monitorFailSeq++;
    return s;
  };

  // (1) startup clock gate — signing stays disabled until it passes
  const startup = await runStartupClockGate({ takeSampleFn });
  if (!startup.ok) { status = STATES.CLOCK_INVALID; lastReasonClass = reasonClassOf(startup.reason); }

  // (2) runtime monitor — invalidation disables signing + voids the generation
  let inPeer = false;
  function invalidatePeer(reason) {
    if (stopped) return false;
    const peerCls = peerClassOf(reason);
    const first = peerInvalid === null;
    if (first) peerInvalid = peerCls;
    const wasSigning = signingReady;
    epoch++; inv.peer++;
    signingReady = false; status = STATES.PEER_INVALID; generation = createBootGeneration();
    lastInvalidationAtMs = localMs(); lastReasonClass = peerCls;
    if (rc.timer) { try { clearTimer(rc.timer); } catch {} rc.timer = null; }
    if (first) {
      emit("peer_invalidated", { reasonClass: peerCls, recovery: "controlled_restart_required" });
      emit("signing_disabled", { reasonClass: peerCls, wasSigning });
    }
    if (!inPeer) { inPeer = true; try { monitor.invalidate("peer_" + (peerCls === "peer_identity_changed" ? "identity_changed" : "unsafe")); } catch {} inPeer = false; }
    try { if (typeof onClockLost === "function") onClockLost(peerCls); } catch {}
    return true;
  }
  function onMonitorInvalid(reason) {
    if (stopped) return;
    if (isPeerReason(reason)) { if (!inPeer) invalidatePeer(reason); return; }
    const cls = reasonClassOf(reason);
    const wasSigning = signingReady;
    epoch++; inv.clock++;
    signingReady = false; generation = createBootGeneration();
    status = peerInvalid !== null ? STATES.PEER_INVALID : STATES.CLOCK_INVALID;
    lastInvalidationAtMs = localMs(); lastReasonClass = cls;
    emit("clock_invalidated", { reason: cls, reasonClass: cls });
    emit("signing_disabled", { reasonClass: cls, wasSigning });
    try { if (typeof onClockLost === "function") onClockLost(reason); } catch {}
    scheduleRecovery("clock_invalidated");
  }
  const monitor = createClockMonitor({ takeSampleFn: monitorTake, monoNowUs, onInvalid: onMonitorInvalid });

  function signingEnabledNow() { return !stopped && peerInvalid === null && signingReady && monitor.healthy(monoNowUs()); }

  if (startup.ok) {
    // seed the monitor with a fresh good sample so it is immediately fresh
    const seed = await monitor.sampleOnce();
    if (seed.ok && epoch === 0) { signingReady = true; status = STATES.BOOTSTRAP_LISTENING; }
    else { signingReady = false; status = peerInvalid !== null ? STATES.PEER_INVALID : STATES.CLOCK_INVALID; if (!seed.ok) lastReasonClass = reasonClassOf(seed.reason); }
  }
  // (2b) start the 1 s runtime probe so freshness is maintained and staleness fires onInvalid. Off in
  // deterministic offline tests (which drive monitor.sampleOnce manually); ON by default for the live path.
  if (startMonitor && startup.ok) { monitor.start(); monitorStarted = true; }

  // (3) v2 listener — exists regardless; signing is gated by signingEnabled(). The attester clock interval is
  //     only offered while signing is enabled, so a request that raced an invalidation can never pick up a
  //     monitor interval that healed before the full recovery completed.
  try {
    server = await startV2AttestationServer({
      channelSecret, listen, observerProvider, signer, anchor,
      attesterClockInterval: () => (signingEnabledNow() ? monitor.currentInterval(monoNowUs()) : null),
      signingEnabled: signingEnabledNow,
      peerCidrs, nowMs, log, offlineTestBoundary,
    });
  } catch (e) { stopped = true; monitor.stop(); return { started: false, status: STATES.UNPROVISIONED, reason: "v2_listen_failed", detail: String(e && e.message) }; }

  /**
   * Re-gate: a COMPLETE fresh startup-grade pass is required to restore signing after a CLOCK invalidation.
   * Serialized (never concurrent), bound to the invalidation epoch captured at its start, refused while
   * peer-invalid or stopped, and it re-enables only after the quiescence floor.
   */
  async function regateOnce() {
    if (stopped) return { ok: false, reason: "stopped" };
    if (peerInvalid !== null) return { ok: false, reason: "peer_invalid" };
    const startEpoch = epoch;
    const stale = () => stopped || peerInvalid !== null || epoch !== startEpoch;
    let failSeq = monitorFailSeq;
    const guardedTake = async () => {
      if (stale()) return { ok: false, reason: "epoch_superseded" };   // never START a sample once stopped/superseded
      const s = await takeSampleFn();
      if (stale()) return { ok: false, reason: "epoch_superseded" };
      if (monitorFailSeq !== failSeq) { failSeq = monitorFailSeq; return { ok: false, reason: "monitor_sample_failed" }; }   // resets the run
      return s;
    };
    // stop / a superseded epoch is TERMINAL for this attempt: the gate aborts at once (no remaining attempts)
    const r = await runStartupClockGate({ takeSampleFn: guardedTake, shouldAbort: stale });
    if (stale()) return { ok: false, reason: stopped ? "stopped" : (peerInvalid !== null ? "peer_invalid" : "epoch_superseded") };
    if (!r.ok) { signingReady = false; status = STATES.CLOCK_INVALID; return { ok: false, reason: r.reason }; }
    // quiescence floor: no request accepted before the last invalidation may still hold a live authority window
    if (lastInvalidationAtMs !== null) {
      const waitMs = Math.ceil(lastInvalidationAtMs + quiescenceMs - localMs());
      if (waitMs > 0) await abortableDelay(waitMs);
      if (stale()) return { ok: false, reason: stopped ? "stopped" : (peerInvalid !== null ? "peer_invalid" : "epoch_superseded") };
    }
    if (stale()) return { ok: false, reason: stopped ? "stopped" : (peerInvalid !== null ? "peer_invalid" : "epoch_superseded") };
    const seed = await monitor.sampleOnce();
    if (stale()) return { ok: false, reason: stopped ? "stopped" : (peerInvalid !== null ? "peer_invalid" : "epoch_superseded") };
    if (!seed.ok) { signingReady = false; status = STATES.CLOCK_INVALID; return { ok: false, reason: seed.reason }; }
    if (monitorFailSeq !== failSeq || !monitor.healthy(monoNowUs())) { signingReady = false; status = STATES.CLOCK_INVALID; return { ok: false, reason: "monitor_unhealthy" }; }
    if (startMonitor && !monitorStarted) { monitor.start(); monitorStarted = true; }
    // final SYNCHRONOUS bind (no await between the recheck above and here)
    generation = createBootGeneration(); signingReady = true; status = STATES.BOOTSTRAP_LISTENING;
    return { ok: true };
  }
  function abortableDelay(ms) {
    return new Promise((res) => {
      const entry = { done: () => { clearTimeout(entry.t); pendingDelays.delete(entry); res(); } };
      entry.t = setTimeout(entry.done, ms); if (entry.t && typeof entry.t.unref === "function") entry.t.unref();
      pendingDelays.add(entry);
    });
  }
  async function regateSerialized() {
    if (stopped) return { ok: false, reason: "stopped" };
    if (regating) return { ok: false, reason: "recovery_in_flight" };
    regating = true;
    const p = (async () => { try { return await regateOnce(); } catch { return { ok: false, reason: "recovery_threw" }; } finally { regating = false; } })();
    activeRegate = p;
    try { return await p; } finally { if (activeRegate === p) activeRegate = null; }
  }
  /** Public manual re-gate (unchanged contract; now serialized + epoch-bound). */
  async function regate() {
    const r = await regateSerialized();
    if (r.ok) { if (rc.timer) { try { clearTimer(rc.timer); } catch {} rc.timer = null; } rc.attempt = 0; }
    return r;
  }

  // ── bounded, serialized automatic recovery controller ──
  function scheduleRecovery(trigger) {
    if (!autoRecover || stopped || peerInvalid !== null || rc.timer || rc.inFlight) return false;
    const delayMs = backoff[Math.min(rc.attempt, backoff.length - 1)];
    rc.scheduled++; rc.lastNextDelayMs = delayMs;
    emit("recovery_scheduled", { attempt: rc.attempt + 1, delayMs, trigger });
    rc.timer = setTimer(runRecovery, delayMs);
    return true;
  }
  async function runRecovery() {
    rc.timer = null;
    if (!autoRecover || stopped || peerInvalid !== null || rc.inFlight) return;
    if (regating) { scheduleRecovery("regate_busy"); return; }
    rc.inFlight = true; rc.attempt++; rc.started++;
    const attempt = rc.attempt;
    emit("recovery_started", { attempt });
    let r;
    try { r = await regateSerialized(); } catch { r = { ok: false, reason: "recovery_threw" }; }
    rc.inFlight = false;
    if (stopped) { rc.failed++; emit("recovery_fail", { attempt, reasonClass: "stopped", nextDelayMs: null }); return; }   // terminal: no backoff
    if (r.ok) {
      rc.passed++; rc.attempt = 0;
      emit("recovery_pass", { attempt });
      emit("signing_restored", { attempt, generationRotated: true });
      return;
    }
    rc.failed++;
    const reasonClass = reasonClassOf(r.reason);
    const nextDelayMs = peerInvalid !== null ? null : backoff[Math.min(rc.attempt, backoff.length - 1)];
    emit("recovery_fail", { attempt, reasonClass, nextDelayMs });
    scheduleRecovery("retry");
  }
  // a failed STARTUP gate is recovered by the same bounded controller (production); no signing ever happened
  if (!signingReady && !stopped) scheduleRecovery("startup_gate_failed");

  function snapshot() {
    return { status, signingReady: signingEnabledNow(), monitorHealthy: monitor.healthy(monoNowUs()), recovering: rc.inFlight || rc.timer !== null,
      recoveryAttempt: rc.attempt, peerInvalid, lastReasonClass };
  }
  let hb = null;
  if (Number.isInteger(heartbeatMs) && heartbeatMs > 0) {
    hb = setInterval(() => { const sv = server.stats(); emit("state", { ...snapshot(), requests: sv.requests, signed: sv.signed, refused: sv.refused, clockRefused: sv.clockRefused }); }, heartbeatMs);
    if (typeof hb.unref === "function") hb.unref();
  }

  return Object.freeze({
    started: true,
    status: () => status,
    address: server.address,
    generation: () => generation.id,
    signingReady: signingEnabledNow,
    startupPassed: startup.ok,
    monitor,               // exposed for deterministic offline driving (sampleOnce / invalidate)
    regate,
    invalidatePeer,
    peerInvalid: () => peerInvalid,
    recovery: () => ({ autoRecover, inFlight: rc.inFlight, pending: rc.timer !== null, attempt: rc.attempt, scheduled: rc.scheduled, started: rc.started, passed: rc.passed, failed: rc.failed, lastNextDelayMs: rc.lastNextDelayMs }),
    stats: () => ({ status, signingReady, startupPassed: startup.ok, generation: generation.id, server: server.stats(), monitor: monitor.stats(),
      epoch, peerInvalid, invalidations: { ...inv }, lastReasonClass,
      recovery: { autoRecover, inFlight: rc.inFlight, pending: rc.timer !== null, attempt: rc.attempt, scheduled: rc.scheduled, started: rc.started, passed: rc.passed, failed: rc.failed } }),
    /**
     * Stop (shutdown containment). SYNCHRONOUSLY: signing off, STOPPED, epoch bumped (supersedes any recovery),
     * recovery timer + heartbeat cancelled, monitor scheduler stopped, quiescence waits released — so no new
     * recovery attempt, gate sample or seed can start. Then a BOUNDED wait (STOP_RECOVERY_CONTAIN_MS) for an
     * in-flight recovery to settle (its late result is discarded: every bind is epoch-checked), then the listener
     * closes. STOPPED is final: nothing can restore signing or change the status afterwards.
     */
    async stop() {
      if (!stopped) {
        stopped = true; epoch++; signingReady = false; status = STATES.STOPPED;
        if (rc.timer) { try { clearTimer(rc.timer); } catch {} rc.timer = null; }
        if (hb) { clearInterval(hb); hb = null; }
        monitor.stop();
        for (const d of Array.from(pendingDelays)) { try { d.done(); } catch {} }
        emit("stopped", { recovering: rc.inFlight || regating });
      }
      const inflight = activeRegate;
      if (inflight) {
        let t; const bound = new Promise((res) => { t = setTimeout(res, STOP_RECOVERY_CONTAIN_MS); if (t && typeof t.unref === "function") t.unref(); });
        await Promise.race([inflight.then(() => {}, () => {}), bound]); clearTimeout(t);
      }
      try { await server.close(); } catch {}
      return true;
    },
  });
}
