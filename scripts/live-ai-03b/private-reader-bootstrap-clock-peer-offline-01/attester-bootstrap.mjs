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
// Offline-test boundary: takeSampleFn / observerProvider / signer / clocks / peer CIDRs are injected. A future
// live wiring (real dedicated clock session, observer credential, DNS peer resolver) is a separate gate.
// ─────────────────────────────────────────────────────────────────────────
import { runStartupClockGate, createClockMonitor } from "./clock-gate.mjs";
import { startV2AttestationServer } from "./attestation-channel-v2.mjs";
import { STATES, createBootGeneration } from "./bootstrap-state.mjs";

export const ATTESTER_BOOTSTRAP_VERSION = "reader-attester-bootstrap-v1";
export const EXIT = Object.freeze({ unprovisioned: 70, clock_lost: 74 });

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
 * Returns a control handle, or { started:false, status, reason }.
 */
export async function startAttesterBootstrap(opts) {
  const { takeSampleFn, observerProvider, signer, anchor, channelSecret, listen, peerCidrs, monoNowUs, nowMs = Date.now, log = () => {}, offlineTestBoundary = false, onClockLost, startMonitor = true } = opts;
  if (!offlineTestBoundary) return { started: false, status: STATES.UNPROVISIONED, reason: "offline_test_boundary_required" };
  if (typeof takeSampleFn !== "function" || typeof observerProvider !== "function" || !signer || !anchor || typeof monoNowUs !== "function") {
    return { started: false, status: STATES.UNPROVISIONED, reason: "attester_bootstrap_deps_incomplete" };
  }

  let generation = createBootGeneration();
  let signingReady = false;
  let status = STATES.WAITING_FOR_CLOCK;

  // (1) startup clock gate — signing stays disabled until it passes
  const startup = await runStartupClockGate({ takeSampleFn });
  if (!startup.ok) { status = STATES.CLOCK_INVALID; }

  // (2) runtime monitor — invalidation disables signing + voids the generation
  const monitor = createClockMonitor({
    takeSampleFn, monoNowUs, onInvalid: (reason) => {
      signingReady = false; status = STATES.CLOCK_INVALID; generation = createBootGeneration();
      log(JSON.stringify({ attester: ATTESTER_BOOTSTRAP_VERSION, event: "clock_invalidated", reason }));
      try { if (typeof onClockLost === "function") onClockLost(reason); } catch {}
    },
  });
  if (startup.ok) {
    // seed the monitor with a fresh good sample so it is immediately fresh
    const seed = await monitor.sampleOnce();
    if (seed.ok) { signingReady = true; status = STATES.BOOTSTRAP_LISTENING; }
    else { status = STATES.CLOCK_INVALID; }
  }
  // (2b) start the 1 s runtime probe so freshness is maintained and staleness fires onInvalid. Off in
  // deterministic offline tests (which drive monitor.sampleOnce manually); ON by default for the live path.
  if (startMonitor && startup.ok) monitor.start();

  // (3) v2 listener — exists regardless; signing is gated by signingEnabled()
  let server;
  try {
    server = await startV2AttestationServer({
      channelSecret, listen, observerProvider, signer, anchor,
      attesterClockInterval: () => monitor.currentInterval(monoNowUs()),
      signingEnabled: () => signingReady && monitor.healthy(monoNowUs()),
      peerCidrs, nowMs, log, offlineTestBoundary,
    });
  } catch (e) { return { started: false, status: STATES.UNPROVISIONED, reason: "v2_listen_failed", detail: String(e && e.message) }; }

  // re-gate: a COMPLETE fresh startup pass is required to restore signing after invalidation
  async function regate() {
    const r = await runStartupClockGate({ takeSampleFn });
    if (!r.ok) { signingReady = false; status = STATES.CLOCK_INVALID; return { ok: false, reason: r.reason }; }
    const seed = await monitor.sampleOnce();
    if (!seed.ok) { signingReady = false; status = STATES.CLOCK_INVALID; return { ok: false, reason: seed.reason }; }
    generation = createBootGeneration(); signingReady = true; status = STATES.BOOTSTRAP_LISTENING;
    return { ok: true };
  }

  return Object.freeze({
    started: true,
    status: () => status,
    address: server.address,
    generation: () => generation.id,
    signingReady: () => signingReady && monitor.healthy(monoNowUs()),
    startupPassed: startup.ok,
    monitor,               // exposed for deterministic offline driving (sampleOnce / invalidate)
    regate,
    stats: () => ({ status, signingReady, startupPassed: startup.ok, generation: generation.id, server: server.stats(), monitor: monitor.stats() }),
    async stop() { status = STATES.STOPPED; monitor.stop(); try { await server.close(); } catch {} return true; },
  });
}
