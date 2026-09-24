// ─────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — versioned PRODUCTION ENTRYPOINT for the private reader host (OFFLINE candidate).
//
// Wraps the ACCEPTED, frozen serving runtime (private-reader-host-runtime-offline-01 →
// startServingRuntime) through its supported `acquireReaderAuthority` interface. It never edits or
// bypasses the accepted reader-only validation, transport, deadlines or outward guard.
//
// Startup contract (production mode — the only mode main() uses):
//   config (env NAMES) → refuse if an executor credential is present → pinned attester trust root →
//   approved attestation source COMPOSED from validated deployment config (reader-attestation-channel-v1,
//   composeProductionAttestationSource) — all before any DB connection → one physical reader connection →
//   verified statement_timeout ≤ 2000 ms + read-only → own identity → signed attestation bound to that
//   connection + a fresh nonce → verified → accepted startServingRuntime() (accepted re-validation) →
//   status "serving" ONLY when the listener is up AND authority is valid.
// Supervisor (continuous): every tick recomputes authority; renews before expiry; on expiry / failed
//   renewal past expiry / drift / connection loss it STOPS the accepted runtime (listener closed —
//   no admission) and attempts bounded recovery (new connection + every check again) before restarting
//   the runtime; exhausted recovery ⇒ "failed" (entrypoint exit 72). Degraded runtime ⇒ exit 71.
// Offline-test mode exists ONLY behind `offlineTestBoundary:true` and is the only way to inject a
// synthetic session factory, attestation source, trust root or clock. Production accepts ONLY the option
// keys in PRODUCTION_OPTION_KEYS (configuration env + callbacks); any other key — in particular any
// attestation source object — is refused.
// ─────────────────────────────────────────────────────────────────────────
import process from "node:process";
import { fileURLToPath } from "node:url";
import { startServingRuntime } from "../private-reader-host-runtime-offline-01/private-reader-host-runtime.mjs";
import { targetSelfCheck, resolveListenConfigFromEnv, ENV_TRANSPORT_SECRET } from "../private-reader-host-runtime-offline-01/runtime-config.mjs";
import { loadIntegrationConfig } from "./integration-config.mjs";
import { createReaderAuthorityManager } from "./production-reader-authority.mjs";
import { makePgPhysicalFactory } from "./reader-session.mjs";
import { makeAttesterTrustRoot } from "./reader-attestation.mjs";
import { createAttestationSourceChannel } from "./attestation-source-channel.mjs";

export const ENTRYPOINT_VERSION = "reader-production-entrypoint-v1";
export const EXIT = Object.freeze({ unprovisioned: 70, degraded: 71, authority_failed: 72 });
export const SUPERVISOR_TICK_MS = 1000;
export const MAX_RECOVERY_ATTEMPTS = 5;
export const RECOVERY_BACKOFF_MS = 5000;

/**
 * The ONLY way production obtains an attestation source: constructed here from VALIDATED, deployment-owned
 * configuration (loadIntegrationConfig) as the versioned `reader-attestation-channel-v1` adapter. There is no
 * caller-supplied source, no fallback channel and no switch that disables validation. Returns
 * { ok:true, source } or { ok:false, reason } (fail closed, before any DB access).
 */
export function composeProductionAttestationSource(env, cfg) {
  if (!cfg || !cfg.ok || !cfg.attesterChannel) return { ok: false, reason: "attester_channel_config_absent" };
  const ch = cfg.attesterChannel;
  return createAttestationSourceChannel({ host: ch.host, port: ch.port, channelSecret: env[ch.channelSecretEnvName], transportSecret: env[ENV_TRANSPORT_SECRET] }, { offlineTestBoundary: false });
}

export const PRODUCTION_OPTION_KEYS = Object.freeze(["mode", "env", "log", "onFatal", "onDegraded"]);
function logLine(log, status, extra) { (log || console.log)(JSON.stringify({ entrypoint: ENTRYPOINT_VERSION, status, servesPublicDomain: false, ...(extra || {}) })); }

/**
 * Start the production reader service. Returns a control handle { started:true, ... } or
 * { started:false, status, reason } (fail closed; no listener).
 */
export async function startProductionReaderService(opts = {}) {
  const { log, onFatal, onDegraded } = opts;
  const offline = opts.mode === "offline-test";
  if (offline && opts.offlineTestBoundary !== true) { logLine(log, "refused", { reason: "offline_test_boundary_required" }); return { started: false, status: "refused", reason: "offline_test_boundary_required" }; }
  if (!offline && opts.mode !== undefined && opts.mode !== "production") { logLine(log, "refused", { reason: "mode_invalid" }); return { started: false, status: "refused", reason: "mode_invalid" }; }
  if (!offline) for (const k of Object.keys(opts)) if (!PRODUCTION_OPTION_KEYS.includes(k)) { logLine(log, "refused", { reason: "test_injection_refused_in_production" }); return { started: false, status: "refused", reason: "test_injection_refused_in_production" }; }

  if (!targetSelfCheck().ok) { logLine(log, "unprovisioned", { reason: "target_identity_mismatch" }); return { started: false, status: "unprovisioned", reason: "target_identity_mismatch" }; }

  let trustRoot, physicalFactory, attestationSource, statementTimeoutMs, nowProvider, listen, transportSecretProvider;
  if (offline) {
    const tr = opts.trustRoot && opts.trustRoot.ok ? opts.trustRoot : makeAttesterTrustRoot(opts.trustRootConfig || {}, { allowTestIssuer: true });
    if (!tr.ok) { logLine(log, "unprovisioned", { reason: tr.reason }); return { started: false, status: "unprovisioned", reason: tr.reason }; }
    trustRoot = tr.trustRoot; physicalFactory = opts.physicalFactory; attestationSource = opts.attestationSource;
    statementTimeoutMs = opts.statementTimeoutMs === undefined ? 2000 : opts.statementTimeoutMs;
    nowProvider = opts.nowProvider || Date.now; listen = opts.listen; transportSecretProvider = opts.transportSecretProvider;
  } else {
    const env = opts.env || process.env;
    const cfg = loadIntegrationConfig(env);
    if (!cfg.ok) { logLine(log, "unprovisioned", { reason: cfg.reason }); return { started: false, status: "unprovisioned", reason: cfg.reason }; }
    trustRoot = cfg.trustRoot; statementTimeoutMs = cfg.statementTimeoutMs; nowProvider = Date.now;
    const src = composeProductionAttestationSource(env, cfg);
    if (!src.ok) { logLine(log, "unprovisioned", { reason: src.reason }); return { started: false, status: "unprovisioned", reason: src.reason }; }
    attestationSource = src.source;
    physicalFactory = makePgPhysicalFactory({ env, connectionStringEnvName: cfg.readerDbUrlEnvName });
    listen = resolveListenConfigFromEnv(env);
    // same (accepted) env NAME as acquireTransportSecretFromEnv, read from the SAME configuration source
    transportSecretProvider = async () => { const v = env[ENV_TRANSPORT_SECRET]; return typeof v === "string" && v.length > 0 ? v : undefined; };
  }

  const mgr = createReaderAuthorityManager({ mode: offline ? "offline-test" : "production", physicalFactory, attestationSource, trustRoot, statementTimeoutMs, nowProvider,
    renewAfterMs: offline && opts.renewAfterMs !== undefined ? opts.renewAfterMs : undefined });
  const est = await mgr.establish();
  if (!est.ok) { logLine(log, "unprovisioned", { reason: est.reason }); await mgr.close(); return { started: false, status: "unprovisioned", reason: est.reason }; }

  const acquireReaderAuthority = async () => { const a = mgr.acceptedAuthority(); return a ? { available: true, authority: a } : { available: false }; };
  let runtime = null; let phase = "starting"; let lastReason = null; let recoveryAttempts = 0; let lastRecoveryAt = -Infinity; let busy = false;
  const backoffMs = offline && opts.recoveryBackoffMs !== undefined ? opts.recoveryBackoffMs : RECOVERY_BACKOFF_MS;
  const maxAttempts = offline && opts.maxRecoveryAttempts !== undefined ? opts.maxRecoveryAttempts : MAX_RECOVERY_ATTEMPTS;

  async function startRuntime() {
    const r = await startServingRuntime({ acquireReaderAuthority, transportSecretProvider, listen, nowProvider, log: () => {}, testBoundary: offline, limits: offline ? opts.limits : undefined,
      onDegraded: () => { phase = "degraded"; logLine(log, "degraded"); try { if (typeof onDegraded === "function") onDegraded(); } catch {} } });
    return r;
  }

  runtime = await startRuntime();
  if (!runtime.started) { logLine(log, "unprovisioned", { reason: runtime.status }); await mgr.close(); return { started: false, status: "unprovisioned", reason: runtime.status }; }
  phase = "serving";
  logLine(log, "serving", { mode: runtime.mode });

  async function suspend(reason) {
    if (phase !== "serving") return;
    phase = "suspended"; lastReason = reason;
    logLine(log, "suspended", { reason });
    const r = runtime; runtime = null;
    if (r) { try { await r.stop(); } catch {} } // listener closed: no further admission
  }

  async function tick() {
    if (busy || phase === "stopped" || phase === "failed" || phase === "degraded") return phase;
    busy = true;
    try {
      if (phase === "serving") {
        let c = mgr.current();
        if (c.ok && mgr.needsRenewal()) { await mgr.renew(); c = mgr.current(); }
        if (!c.ok) await suspend(c.reason);
      }
      if (phase === "suspended") {
        const t = nowProvider();
        if (t - lastRecoveryAt >= backoffMs) {
          lastRecoveryAt = t; recoveryAttempts++;
          const e = await mgr.establish();
          if (e.ok) {
            const r = await startRuntime();
            if (r.started) { runtime = r; phase = "serving"; recoveryAttempts = 0; logLine(log, "serving", { mode: r.mode, recovered: true }); }
            else lastReason = r.status;
          } else lastReason = e.reason;
          if (phase === "suspended" && recoveryAttempts >= maxAttempts) {
            phase = "failed"; await mgr.close(); logLine(log, "failed", { reason: lastReason });
            try { if (typeof onFatal === "function") onFatal(); } catch {}
          }
        }
      }
      // an invalidation that arrived while this tick was busy is handled now, not at the next tick
      if (phase === "serving") { const c2 = mgr.current(); if (!c2.ok) await suspend(c2.reason); }
      return phase;
    } finally { busy = false; }
  }
  const tickMs = offline && opts.tickMs !== undefined ? opts.tickMs : SUPERVISOR_TICK_MS;
  const timer = tickMs > 0 ? setInterval(() => { void tick(); }, tickMs) : null;
  if (timer && typeof timer.unref === "function") timer.unref();
  mgr.onInvalid(() => { if (!busy) void tick(); }); // react immediately to connection loss / drift

  return Object.freeze({
    started: true, version: ENTRYPOINT_VERSION,
    get address() { return runtime ? runtime.address : null; },
    phase: () => phase,
    lastReason: () => lastReason,
    // LIVE readiness: listener serving + accepted runtime ready + authority valid NOW (never cached)
    ready() { return phase === "serving" && !!runtime && runtime.ready() === true && mgr.current().ok === true; },
    authority: () => mgr.status(),
    health() { return runtime ? runtime.health() : null; },
    tick,
    async stop() { phase = "stopped"; if (timer) clearInterval(timer); const r = runtime; runtime = null; if (r) { try { await r.stop(); } catch {} } await mgr.close(); return true; },
  });
}

async function main() {
  let ctrl;
  ctrl = await startProductionReaderService({
    onFatal: () => { Promise.resolve(ctrl && ctrl.stop()).catch(() => {}).finally(() => process.exit(EXIT.authority_failed)); },
    onDegraded: () => { Promise.resolve(ctrl && ctrl.stop()).catch(() => {}).finally(() => process.exit(EXIT.degraded)); },
  });
  if (!ctrl.started) { process.exitCode = EXIT.unprovisioned; return; }
  const shutdown = async () => { try { await ctrl.stop(); } finally { process.exit(0); } }; // listener + DB session already closed by stop()
  process.on("SIGTERM", shutdown); process.on("SIGINT", shutdown);
}

const isMain = (() => { try { return !!process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]; } catch { return false; } })();
if (isMain) { main(); }
