// ─────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — INDEPENDENT ATTESTER: production entrypoint (OFFLINE candidate). Node built-ins only at
// load; the real `pg` driver is imported lazily when the observer connection opens.
//
// Start command (see DEPLOYMENT-CONTRACT.md):
//   node scripts/live-ai-03b/private-reader-attester-offline-01/attester-entrypoint.mjs
//
// Composition, in order, all before the channel listens:
//   validated attester configuration (env NAMES; foreign credentials refused)
//     → Ed25519 signing adapter from the attester's OWN secret custody
//     → Owner-issued deployment anchor (no anchor ⇒ no target ⇒ no signature, ever)
//     → least-privilege observer connection: statement_timeout + read-only set and read back, and a
//       capability self-check (must NOT be superuser, must NOT be the reader, must hold pg_read_all_stats)
//     → authenticated private-network channel on the accepted contract.
// Every request re-measures evidence; a signature is issued only for a clean, anchored observation bound
// to a session the attester itself observed. Fail-closed startup; no fixture path; no public listener.
// ─────────────────────────────────────────────────────────────────────────
import process from "node:process";
import { fileURLToPath } from "node:url";
import { loadAttesterConfig, ATTESTER_ID, ENV } from "./attester-config.mjs";
import { createSigningAdapter } from "./signing-adapter.mjs";
import { parseDeploymentAnchor } from "./target-binding.mjs";
import { makeObserverPgFactory, establishObserverSession } from "./observer-connection.mjs";
import { startAttestationServer } from "./attestation-server.mjs";

export const ATTESTER_VERSION = "reader-attester-v1";
export const EXIT = Object.freeze({ unprovisioned: 70, observer_lost: 73 });
export const PRODUCTION_OPTION_KEYS = Object.freeze(["mode", "env", "log", "onFatal"]);
export const OBSERVER_WATCH_MS = 2000;

function logLine(log, status, extra) { (log || console.log)(JSON.stringify({ attester: ATTESTER_ID, version: ATTESTER_VERSION, status, servesPublicDomain: false, ...(extra || {}) })); }

/**
 * Start the attester service. Returns a control handle, or { started:false, status, reason } (fail closed).
 * Offline-test mode (`mode:"offline-test"` + `offlineTestBoundary:true`) is the ONLY way to inject a
 * synthetic observer factory or clock; production accepts configuration and callbacks only.
 */
export async function startAttesterService(opts = {}) {
  const { log, onFatal } = opts;
  const offline = opts.mode === "offline-test";
  if (offline && opts.offlineTestBoundary !== true) { logLine(log, "refused", { reason: "offline_test_boundary_required" }); return { started: false, status: "refused", reason: "offline_test_boundary_required" }; }
  if (!offline && opts.mode !== undefined && opts.mode !== "production") { logLine(log, "refused", { reason: "mode_invalid" }); return { started: false, status: "refused", reason: "mode_invalid" }; }
  if (!offline) for (const k of Object.keys(opts)) if (!PRODUCTION_OPTION_KEYS.includes(k)) { logLine(log, "refused", { reason: "test_injection_refused_in_production" }); return { started: false, status: "refused", reason: "test_injection_refused_in_production" }; }

  const env = opts.env || process.env;
  const cfg = loadAttesterConfig(env, { offlineTestBoundary: offline });
  if (!cfg.ok) { logLine(log, "unprovisioned", { reason: cfg.reason }); return { started: false, status: "unprovisioned", reason: cfg.reason }; }

  const nowProvider = offline && typeof opts.nowProvider === "function" ? opts.nowProvider : Date.now;
  const sa = createSigningAdapter({ issuer: cfg.issuer, privateKeyPkcs8B64: env[cfg.secretRefs.signingKeyEnvName], proofLifetimeMs: cfg.proofLifetimeMs, nowProvider });
  if (!sa.ok) { logLine(log, "unprovisioned", { reason: sa.reason }); return { started: false, status: "unprovisioned", reason: sa.reason }; }

  const pa = parseDeploymentAnchor(cfg.deploymentAnchorRef);
  if (!pa.ok) { logLine(log, "unprovisioned", { reason: pa.reason }); return { started: false, status: "unprovisioned", reason: pa.reason }; }

  const factory = offline && opts.observerFactory ? opts.observerFactory
    : makeObserverPgFactory({ env, connectionStringEnvName: cfg.secretRefs.observerDbUrlEnvName });

  let observer = null;
  async function openObserver() {
    let physical;
    try { physical = await factory.open(); } catch { return { ok: false, reason: "observer_connection_failed" }; }
    const es = await establishObserverSession(physical);
    if (!es.ok) { try { await physical.close(); } catch {} return { ok: false, reason: es.reason }; }
    return es;
  }
  const first = await openObserver();
  if (!first.ok) { logLine(log, "unprovisioned", { reason: first.reason }); return { started: false, status: "unprovisioned", reason: first.reason }; }
  observer = first.observer;

  // A dropped observer must never be silently replaced mid-proof: the provider re-opens and the new
  // session is re-verified (timeout, read-only, capability) before any evidence is measured on it.
  let reopening = null;
  async function observerProvider() {
    if (observer && !observer.isDead()) return { ok: true, observer };
    if (!reopening) reopening = openObserver().then((r) => { reopening = null; if (r.ok) observer = r.observer; return r; });
    return reopening;
  }

  let server;
  try {
    server = await startAttestationServer({
      channelSecret: env[cfg.secretRefs.channelSecretEnvName], listen: cfg.listen, observerProvider,
      signer: sa.signer, anchor: pa.anchor, nowProvider, log: () => {}, offlineTestBoundary: offline,
    });
  } catch { try { await observer.close(); } catch {} logLine(log, "unprovisioned", { reason: "attester_listen_failed" }); return { started: false, status: "unprovisioned", reason: "attester_listen_failed" }; }

  logLine(log, "serving", { issuer: sa.signer.issuer, keyId: sa.signer.keyId, port: server.address.port });
  let serving = true; let fatalSignalled = false;
  const watch = setInterval(() => {
    if (!serving || fatalSignalled) return;
    if (observer && observer.isDead()) { void observerProvider().then((r) => { if (!r.ok && !fatalSignalled) { fatalSignalled = true; logLine(log, "observer_lost", { reason: r.reason }); try { if (typeof onFatal === "function") onFatal(); } catch {} } }); }
  }, offline && Number.isInteger(opts.watchMs) ? opts.watchMs : OBSERVER_WATCH_MS);
  if (typeof watch.unref === "function") watch.unref();

  return Object.freeze({
    started: true, status: "serving", id: ATTESTER_ID, version: ATTESTER_VERSION,
    address: server.address, issuer: sa.signer.issuer, keyId: sa.signer.keyId, publicKeyDerB64: sa.signer.publicKeyDerB64,
    stats: () => server.stats(),
    ready() { return serving === true && !!observer && !observer.isDead(); },
    async stop() { serving = false; clearInterval(watch); try { await server.close(); } catch {} try { if (observer) await observer.close(); } catch {} return true; },
  });
}

async function main() {
  let ctrl;
  ctrl = await startAttesterService({ onFatal: () => { Promise.resolve(ctrl && ctrl.stop()).catch(() => {}).finally(() => process.exit(EXIT.observer_lost)); } });
  if (!ctrl.started) { process.exitCode = EXIT.unprovisioned; return; }
  const shutdown = async () => { try { await ctrl.stop(); } finally { process.exit(0); } };
  process.on("SIGTERM", shutdown); process.on("SIGINT", shutdown);
}
const isMain = (() => { try { return !!process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]; } catch { return false; } })();
if (isMain) { main(); }
