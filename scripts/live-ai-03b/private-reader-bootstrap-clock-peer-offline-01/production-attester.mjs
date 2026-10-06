// ─────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — BOOTSTRAP: ATTESTER production composition root (OFFLINE candidate). Node built-ins only at load.
//
// A REAL fail-closed composition root. In PRODUCTION mode it validates deployment-owned configuration, rejects
// any caller-injected authority, builds: the fixed direct-PostgreSQL clock sampler over the OBSERVER credential;
// the accepted least-privilege observer provider (its own read-only session per observation); the accepted
// Ed25519 signer from the signing-key env NAME (value consumed at construction, never logged); the owner-issued
// deployment anchor; and the private-peer allowlist resolved from the reader's `.railway.internal` identity to
// EXACT private hosts. It starts the attester bootstrap on a private bind. It NEVER signs before the frozen
// clock/anchor/observer/request gates pass.
//
// Synthetic dependency injection is accepted ONLY behind the explicit offline-test boundary. No live connection
// is attempted offline.
// ─────────────────────────────────────────────────────────────────────────
import { STATES } from "./bootstrap-state.mjs";
import { startAttesterBootstrap } from "./attester-bootstrap.mjs";
import { loadAttesterProductionConfig, rejectTestInjection } from "./production-config.mjs";
import { makeProductionClockSampler } from "./production-db-clock.mjs";
import { createPeerSupervisor } from "./private-peer-resolver.mjs";
import { createSigningAdapter } from "../private-reader-attester-offline-01/signing-adapter.mjs";
import { makeObserverPgFactory, establishObserverSession, OBSERVER_CLEANUP_DEADLINE_MS } from "../private-reader-attester-offline-01/observer-connection.mjs";

export const ATTESTER_PRODUCTION_VERSION = "reader-attester-bootstrap-production-v1";
export const ATTESTER_PROOF_LIFETIME_MS = 60000;   // ≤ accepted 5-min ceiling
export const ATTESTER_HEARTBEAT_MS = 60000;        // sanitized periodic state marker (M5 remediation)

/**
 * Compose + start the attester bootstrap.
 * Production: composeAttesterProduction({ env, log }).
 * Offline-test: composeAttesterProduction({ offlineTest:true, offlineTestBoundary:true, inject:{ takeSampleFn, observerProvider, signer, anchor, channelSecret, listen, peerCidrs, monoNowUs, startMonitor? } }).
 */
export async function composeAttesterProduction(opts = {}) {
  if (opts && opts.offlineTest === true && opts.offlineTestBoundary === true) {
    const inj = opts.inject || {};
    return startAttesterBootstrap({ ...inj, offlineTestBoundary: true });
  }
  // ── PRODUCTION MODE ──
  const bad = rejectTestInjection(opts);
  if (bad) return { started: false, status: STATES.UNPROVISIONED, reason: "production_option_not_allowed:" + bad };
  const env = opts.env;
  const log = typeof opts.log === "function" ? opts.log : () => {};

  const loaded = loadAttesterProductionConfig(env || {});
  if (!loaded.ok) return { started: false, status: STATES.UNPROVISIONED, reason: loaded.reason, missing: loaded.missing };
  const cfg = loaded.config;

  // signer from custody (env NAME → value consumed here, never logged/returned)
  const sig = createSigningAdapter({ issuer: cfg.issuer, privateKeyPkcs8B64: env[cfg.signingKeyEnvName], proofLifetimeMs: ATTESTER_PROOF_LIFETIME_MS });
  if (!sig.ok) return { started: false, status: STATES.UNPROVISIONED, reason: "signer_" + sig.reason };

  // the private-peer allowlist for the READER, resolved + SUPERVISED from its .railway.internal identity (§21/§22).
  // An unsafe refresh keeps the last-good set (never widens) and invalidates signing; a validated peer-identity
  // change invalidates signing too (the operator/orchestrator performs the controlled listener recreation).
  // M5 remediation: both route to the attester's STICKY peer latch (invalidatePeer) — a peer invalidation is
  // never auto-restored by clock recovery; it requires a controlled restart.
  let attRef = null;
  const supervisor = createPeerSupervisor({
    serviceName: cfg.readerServiceName,
    onUnsafe: (reason) => { try { if (attRef) attRef.invalidatePeer("peer_unsafe:" + reason); } catch {} },
    onChange: () => { try { if (attRef) attRef.invalidatePeer("peer_identity_changed"); } catch {} log(JSON.stringify({ attester: ATTESTER_PRODUCTION_VERSION, event: "peer_identity_changed" })); },
  });
  const first = await supervisor.refreshOnce();
  if (!first.ok) return { started: false, status: STATES.UNPROVISIONED, reason: "reader_peer_" + first.reason };
  const peerCidrs = supervisor.current();

  // the fixed clock sampler over the OBSERVER credential
  let sampler;
  try { sampler = makeProductionClockSampler({ env, connectionStringEnvName: cfg.observerDbUrlEnvName, expectedFingerprint: cfg.expectedFingerprint, statementTimeoutMs: cfg.clockStatementTimeoutMs }); }
  catch (e) { return { started: false, status: STATES.UNPROVISIONED, reason: "clock_sampler_" + (e && e.message) }; }

  // the accepted least-privilege observer provider (a fresh read-only session per observation)
  const observerFactory = makeObserverPgFactory({ env, connectionStringEnvName: cfg.observerDbUrlEnvName });
  // OBSERVER-ROLE CONNECTION-BUDGET FIX (candidate): a physical whose session setup fails is destroyed here — the
  // accepted coordinator never receives (and therefore can never close) a physical behind an { ok:false } result.
  const observerProvider = makeClosingObserverProvider(observerFactory);

  const channelSecret = env[cfg.channelSecretEnvName];

  let att;
  try {
    att = await startAttesterBootstrap({
      takeSampleFn: sampler.takeSampleFn,
      observerProvider,
      signer: sig.signer,
      anchor: cfg.anchor,
      channelSecret,
      listen: { bindHost: cfg.bindHost, port: cfg.port },
      peerCidrs,
      monoNowUs: sampler.monoNowUs,
      offlineTestBoundary: true,   // internal composition seam; signing still requires the full clock/anchor/observer/request gates
      log,
      autoRecover: true,           // M5 remediation: bounded, serialized, startup-grade automatic clock recovery
      heartbeatMs: ATTESTER_HEARTBEAT_MS,
    });
  } catch (e) { try { await sampler.close(); } catch {} return { started: false, status: STATES.UNPROVISIONED, reason: "attester_bootstrap_start_failed" }; }
  if (!att.started) { try { await sampler.close(); } catch {} return att; }

  attRef = att;              // wire the supervisor's invalidation to the running attester, then start supervision
  supervisor.start();
  return Object.freeze({ ...att, version: ATTESTER_PRODUCTION_VERSION, stop: makeContainedAttesterStop({ supervisor, baseStop: att.stop, sampler }) });
}

/**
 * OBSERVER-ROLE CONNECTION-BUDGET FIX (candidate). The production observer provider: open ONE physical, run the
 * accepted establishObserverSession unchanged, and — when setup fails (statement error, setup deadline, or an
 * unverified statement_timeout / read-only read-back) — destroy that physical before returning the failure, bounded
 * by the accepted cleanup deadline. b076 returned the failure WITHOUT closing the physical, so every failed setup left
 * one live observer-role session (keepAlive) until process exit. The accepted containment test T-E already required
 * exactly this behaviour of its test provider; production now matches it. Success is byte-for-byte unchanged.
 */
export function makeClosingObserverProvider(factory, { cleanupDeadlineMs = OBSERVER_CLEANUP_DEADLINE_MS } = {}) {
  return async () => {
    const physical = await factory.open();
    const es = await establishObserverSession(physical);
    if (!es || es.ok !== true) {
      let t;
      const bound = new Promise((r) => { t = setTimeout(r, Math.max(1, cleanupDeadlineMs)); });
      try { await Promise.race([Promise.resolve().then(() => (typeof physical.destroy === "function" ? physical.destroy() : physical.close())).catch(() => {}), bound]); }
      finally { clearTimeout(t); }
    }
    return es;
  };
}

/**
 * Shutdown containment for the production composition. The clock sampler's CLOSED latch and the attester's
 * STOPPED latch are both committed in the SAME synchronous turn (sampler.close() and baseStop() each latch before
 * their first await), so from that instant no DB open, SQL or clock sample can start — including a recovery
 * attempt that is already in flight, or a factory.open() that completes late (it is retired, never installed).
 * Then both bounded teardowns are awaited. Exported for deterministic offline tests of the exact ordering.
 */
export function makeContainedAttesterStop({ supervisor, baseStop, sampler }) {
  return async function stop() {
    try { if (supervisor) supervisor.stop(); } catch {}
    let closing = null;
    try { closing = sampler && typeof sampler.close === "function" ? sampler.close() : null; } catch {}   // sync CLOSED latch
    let stopping = null;
    try { stopping = baseStop(); } catch {}                                                                // sync STOPPED latch
    try { await stopping; } catch {}
    try { await closing; } catch {}
    return true;
  };
}
