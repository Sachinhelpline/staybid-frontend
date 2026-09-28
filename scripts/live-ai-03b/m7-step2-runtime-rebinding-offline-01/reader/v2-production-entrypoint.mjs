// ─────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — M7 STEP 2 — V2 PRODUCTION ENTRYPOINT for the private reader host. OFFLINE candidate.
//
// Successor of private-reader-production-integration-offline-01/production-entrypoint.mjs (V1, frozen:
// composes the V1 authority manager + V1 serving runtime). Same startup contract and supervisor
// (establish → serve; renew; suspend on expiry / drift / connection loss; bounded recovery; exit 72 on
// exhausted recovery, 71 on degraded) — now composing the V2 manager + V2 serving runtime.
// ADDITIONALLY the V2 production path requires a V2 SOURCE PIN (derivation base / gateway 4f390 / Step-2
// preservation binding). None is provisioned in this repository state (acquireReaderSourcePinV2 ⇒
// UNPROVISIONED), so production refuses BEFORE any DB connection. Offline-test mode (explicit
// offlineTestBoundary:true) is the only way to inject a session factory / attestation source / trust
// root / clock / source pin.
// ─────────────────────────────────────────────────────────────────────────
import process from "node:process";
import { fileURLToPath } from "node:url";
import { targetSelfCheck, resolveListenConfigFromEnv, ENV_TRANSPORT_SECRET } from "../../private-reader-host-runtime-offline-01/runtime-config.mjs";
import { loadIntegrationConfig } from "../../private-reader-production-integration-offline-01/integration-config.mjs";
import { makePgPhysicalFactory } from "../../private-reader-production-integration-offline-01/reader-session.mjs";
import { makeAttesterTrustRoot } from "../../private-reader-production-integration-offline-01/reader-attestation.mjs";
import { composeProductionAttestationSource } from "../../private-reader-production-integration-offline-01/production-entrypoint.mjs";
import { checkSourcePinV2 } from "../identity/v2-source-identity.mjs";
import { createReaderAuthorityManagerV2 } from "./v2-production-reader-authority.mjs";
import { startServingRuntimeV2 } from "./v2-serving-runtime.mjs";

export const ENTRYPOINT_VERSION_V2 = "reader-production-entrypoint-v2";
export const EXIT = Object.freeze({ unprovisioned: 70, degraded: 71, authority_failed: 72 });
export const SUPERVISOR_TICK_MS = 1000;
export const MAX_RECOVERY_ATTEMPTS = 5;
export const RECOVERY_BACKOFF_MS = 5000;
export const PRODUCTION_OPTION_KEYS = Object.freeze(["mode", "env", "log", "onFatal", "onDegraded"]);
function logLine(log, status, extra) { (log || console.log)(JSON.stringify({ entrypoint: ENTRYPOINT_VERSION_V2, status, servesPublicDomain: false, ...(extra || {}) })); }

const SOURCE_PIN_UNPROVISIONED = Object.freeze({ available: false, reason: "v2_source_pin_unprovisioned" });
/** The V2 source pin comes from an Owner-controlled preservation receipt — none exists in this repository state. */
export async function acquireReaderSourcePinV2() { return SOURCE_PIN_UNPROVISIONED; }

export async function startProductionReaderServiceV2(opts = {}) {
  const { log, onFatal, onDegraded } = opts;
  const offline = opts.mode === "offline-test";
  if (offline && opts.offlineTestBoundary !== true) { logLine(log, "refused", { reason: "offline_test_boundary_required" }); return { started: false, status: "refused", reason: "offline_test_boundary_required" }; }
  if (!offline && opts.mode !== undefined && opts.mode !== "production") { logLine(log, "refused", { reason: "mode_invalid" }); return { started: false, status: "refused", reason: "mode_invalid" }; }
  if (!offline) for (const k of Object.keys(opts)) if (!PRODUCTION_OPTION_KEYS.includes(k)) { logLine(log, "refused", { reason: "test_injection_refused_in_production" }); return { started: false, status: "refused", reason: "test_injection_refused_in_production" }; }
  if (!targetSelfCheck().ok) { logLine(log, "unprovisioned", { reason: "target_identity_mismatch" }); return { started: false, status: "unprovisioned", reason: "target_identity_mismatch" }; }

  let trustRoot, physicalFactory, attestationSource, statementTimeoutMs, nowProvider, listen, transportSecretProvider, sourcePin;
  if (offline) {
    const tr = opts.trustRoot && opts.trustRoot.ok ? opts.trustRoot : makeAttesterTrustRoot(opts.trustRootConfig || {}, { allowTestIssuer: true });
    if (!tr.ok) { logLine(log, "unprovisioned", { reason: tr.reason }); return { started: false, status: "unprovisioned", reason: tr.reason }; }
    trustRoot = tr.trustRoot; physicalFactory = opts.physicalFactory; attestationSource = opts.attestationSource;
    statementTimeoutMs = opts.statementTimeoutMs === undefined ? 2000 : opts.statementTimeoutMs;
    nowProvider = opts.nowProvider || Date.now; listen = opts.listen; transportSecretProvider = opts.transportSecretProvider; sourcePin = opts.sourcePin;
  } else {
    // source pin FIRST (no DB connection, no attester contact while it is unprovisioned).
    const sp = await acquireReaderSourcePinV2();
    if (!sp || sp.available !== true) { logLine(log, "unprovisioned", { reason: (sp && sp.reason) || "v2_source_pin_unprovisioned" }); return { started: false, status: "unprovisioned", reason: (sp && sp.reason) || "v2_source_pin_unprovisioned" }; }
    sourcePin = sp.sourcePin;
    const env = opts.env || process.env;
    const cfg = loadIntegrationConfig(env);
    if (!cfg.ok) { logLine(log, "unprovisioned", { reason: cfg.reason }); return { started: false, status: "unprovisioned", reason: cfg.reason }; }
    trustRoot = cfg.trustRoot; statementTimeoutMs = cfg.statementTimeoutMs; nowProvider = Date.now;
    const src = composeProductionAttestationSource(env, cfg);
    if (!src.ok) { logLine(log, "unprovisioned", { reason: src.reason }); return { started: false, status: "unprovisioned", reason: src.reason }; }
    attestationSource = src.source;
    physicalFactory = makePgPhysicalFactory({ env, connectionStringEnvName: cfg.readerDbUrlEnvName });
    listen = resolveListenConfigFromEnv(env);
    transportSecretProvider = async () => { const v = env[ENV_TRANSPORT_SECRET]; return typeof v === "string" && v.length > 0 ? v : undefined; };
  }
  const spc = checkSourcePinV2(sourcePin, { testBoundary: offline });
  if (!spc.ok) { logLine(log, "unprovisioned", { reason: "source_pin_" + spc.reason }); return { started: false, status: "unprovisioned", reason: "source_pin_" + spc.reason }; }

  const mgr = createReaderAuthorityManagerV2({ mode: offline ? "offline-test" : "production", physicalFactory, attestationSource, trustRoot, statementTimeoutMs, nowProvider, sourcePin,
    renewAfterMs: offline && opts.renewAfterMs !== undefined ? opts.renewAfterMs : undefined });
  const est = await mgr.establish();
  if (!est.ok) { logLine(log, "unprovisioned", { reason: est.reason }); await mgr.close(); return { started: false, status: "unprovisioned", reason: est.reason }; }

  const acquireReaderAuthority = async () => { const a = mgr.acceptedAuthority(); return a ? { available: true, authority: a } : { available: false }; };
  let runtime = null; let phase = "starting"; let lastReason = null; let recoveryAttempts = 0; let lastRecoveryAt = -Infinity; let busy = false;
  const backoffMs = offline && opts.recoveryBackoffMs !== undefined ? opts.recoveryBackoffMs : RECOVERY_BACKOFF_MS;
  const maxAttempts = offline && opts.maxRecoveryAttempts !== undefined ? opts.maxRecoveryAttempts : MAX_RECOVERY_ATTEMPTS;
  const startRuntime = () => startServingRuntimeV2({ acquireReaderAuthority, transportSecretProvider, listen, nowProvider, log: () => {}, testBoundary: offline, limits: offline ? opts.limits : undefined,
    onDegraded: () => { phase = "degraded"; logLine(log, "degraded"); try { if (typeof onDegraded === "function") onDegraded(); } catch {} } });

  runtime = await startRuntime();
  if (!runtime.started) { logLine(log, "unprovisioned", { reason: runtime.status }); await mgr.close(); return { started: false, status: "unprovisioned", reason: runtime.status }; }
  phase = "serving"; logLine(log, "serving", { mode: runtime.mode });

  async function suspend(reason) {
    if (phase !== "serving") return;
    phase = "suspended"; lastReason = reason; logLine(log, "suspended", { reason });
    const r = runtime; runtime = null; if (r) { try { await r.stop(); } catch {} }
  }
  async function tick() {
    if (busy || phase === "stopped" || phase === "failed" || phase === "degraded") return phase;
    busy = true;
    try {
      if (phase === "serving") { let c = mgr.current(); if (c.ok && mgr.needsRenewal()) { await mgr.renew(); c = mgr.current(); } if (!c.ok) await suspend(c.reason); }
      if (phase === "suspended") {
        const t = nowProvider();
        if (t - lastRecoveryAt >= backoffMs) {
          lastRecoveryAt = t; recoveryAttempts++;
          const e = await mgr.establish();
          if (e.ok) { const r = await startRuntime(); if (r.started) { runtime = r; phase = "serving"; recoveryAttempts = 0; logLine(log, "serving", { mode: r.mode, recovered: true }); } else lastReason = r.status; }
          else lastReason = e.reason;
          if (phase === "suspended" && recoveryAttempts >= maxAttempts) { phase = "failed"; await mgr.close(); logLine(log, "failed", { reason: lastReason }); try { if (typeof onFatal === "function") onFatal(); } catch {} }
        }
      }
      if (phase === "serving") { const c2 = mgr.current(); if (!c2.ok) await suspend(c2.reason); }
      return phase;
    } finally { busy = false; }
  }
  const tickMs = offline && opts.tickMs !== undefined ? opts.tickMs : SUPERVISOR_TICK_MS;
  const timer = tickMs > 0 ? setInterval(() => { void tick(); }, tickMs) : null;
  if (timer && typeof timer.unref === "function") timer.unref();
  mgr.onInvalid(() => { if (!busy) void tick(); });
  return Object.freeze({
    started: true, version: ENTRYPOINT_VERSION_V2,
    get address() { return runtime ? runtime.address : null; },
    phase: () => phase, lastReason: () => lastReason,
    ready() { return phase === "serving" && !!runtime && runtime.ready() === true && mgr.current().ok === true; },
    authority: () => mgr.status(), health() { return runtime ? runtime.health() : null; }, tick,
    async stop() { phase = "stopped"; if (timer) clearInterval(timer); const r = runtime; runtime = null; if (r) { try { await r.stop(); } catch {} } await mgr.close(); return true; },
  });
}

async function main() {
  let ctrl;
  ctrl = await startProductionReaderServiceV2({
    onFatal: () => { Promise.resolve(ctrl && ctrl.stop()).catch(() => {}).finally(() => process.exit(EXIT.authority_failed)); },
    onDegraded: () => { Promise.resolve(ctrl && ctrl.stop()).catch(() => {}).finally(() => process.exit(EXIT.degraded)); },
  });
  if (!ctrl.started) { process.exitCode = EXIT.unprovisioned; return; }
  const shutdown = async () => { try { await ctrl.stop(); } finally { process.exit(0); } };
  process.on("SIGTERM", shutdown); process.on("SIGINT", shutdown);
}
const isMain = (() => { try { return !!process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]; } catch { return false; } })();
if (isMain) { main(); }
