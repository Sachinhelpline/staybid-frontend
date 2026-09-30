// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — M7 V2 EXECUTOR ATTESTATION ISSUER — production-like entrypoint. OFFLINE candidate (NOT deployed).
//
// Future start command (a NEW, separate service — never the reader attester's):
//   node scripts/live-ai-03b/m7-v2-executor-attester-issuer-offline-01/src/executor-attester-entrypoint.mjs
//
// Order (fail closed at every step; nothing listens until all pass):
//   1. STATIC configuration (no I/O): foreign credentials refused, required names present, issuer/fingerprint distinct
//      from the reader attester, TEST-ONLY material refused, private listen policy, proof lifetime, executor anchor;
//   2. STATIC signing adapter (no I/O): Ed25519 key == configured public identity, ≠ reader-attester key;
//   3. ONLY THEN the first I/O — the least-privilege observer connection (statement_timeout + read-only set and read
//      back; the observer self-check runs on every measurement);
//   4. the authenticated private-network channel on `executor-attestation-channel-v1`.
// Production accepts ONLY { mode:"production"|undefined, env, log, onFatal }. The offline test boundary
// (`mode:"offline-test"` + `offlineTestBoundary:true`) is the only way to inject a synthetic observer factory or a
// clock; any injection key in production is refused before configuration is read.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
import process from "node:process";
import { fileURLToPath } from "node:url";
import { loadExecutorAttesterConfig, EXECUTOR_ATTESTER_ID } from "./executor-attester-config.mjs";
import { createExecutorSigningAdapter } from "./executor-signing-adapter.mjs";
import { makeExecutorObserverPgFactory, establishExecutorObserverSession } from "./executor-observer.mjs";
import { startExecutorAttestationServer } from "./executor-attestation-server.mjs";

export const EXECUTOR_ATTESTER_VERSION = "executor-attester-v1";
export const EXIT = Object.freeze({ unprovisioned: 70, observer_lost: 73 });
export const PRODUCTION_OPTION_KEYS = Object.freeze(["env", "log", "mode", "onFatal"]);
export const OBSERVER_WATCH_MS = 2000;

function logLine(log, status, extra) {
  (log || console.log)(JSON.stringify({ executorAttester: EXECUTOR_ATTESTER_ID, version: EXECUTOR_ATTESTER_VERSION, status, servesPublicDomain: false, ...(extra || {}) }));
}
const refuse = (log, status, reason) => { logLine(log, status, { reason }); return { started: false, status, reason }; };

/** Start the executor attester service. Returns a control handle, or { started:false, status, reason }. */
export async function startExecutorAttesterService(opts = {}) {
  const { log, onFatal } = opts;
  const offline = opts.mode === "offline-test";
  if (offline && opts.offlineTestBoundary !== true) return refuse(log, "refused", "offline_test_boundary_required");
  if (!offline && opts.mode !== undefined && opts.mode !== "production") return refuse(log, "refused", "mode_invalid");
  if (!offline) for (const k of Object.keys(opts)) if (!PRODUCTION_OPTION_KEYS.includes(k)) return refuse(log, "refused", "test_injection_refused_in_production");

  const env = opts.env || process.env;
  // ── 1 + 2: STATIC validation, before any I/O ──
  const cfg = loadExecutorAttesterConfig(env, { offlineTestBoundary: offline });
  if (!cfg.ok) return refuse(log, "unprovisioned", cfg.reason);
  const nowProvider = offline && typeof opts.nowProvider === "function" ? opts.nowProvider : Date.now;
  const sa = createExecutorSigningAdapter({ issuer: cfg.issuer, privateKeyPkcs8B64: env[cfg.secretRefs.signingKeyEnvName],
    expectedPublicKeyDerB64: cfg.publicKeyDerB64, expectedFingerprint: cfg.fingerprint, readerAttesterFingerprint: cfg.readerAttester.fingerprint,
    proofLifetimeMs: cfg.proofLifetimeMs, nowProvider, offlineTestBoundary: offline });
  if (!sa.ok) return refuse(log, "unprovisioned", sa.reason);

  // ── 3: first I/O — the observer ──
  const factory = offline && opts.observerFactory ? opts.observerFactory
    : makeExecutorObserverPgFactory({ env, connectionStringEnvName: cfg.secretRefs.observerDbUrlEnvName });
  let observer = null;
  async function openObserver() {
    let physical;
    try { physical = await factory.open(); } catch { return { ok: false, reason: "observer_connection_failed" }; }
    const es = await establishExecutorObserverSession(physical);
    if (!es.ok) { try { await physical.close(); } catch {} return { ok: false, reason: es.reason }; }
    return es;
  }
  const first = await openObserver();
  if (!first.ok) return refuse(log, "unprovisioned", first.reason);
  observer = first.observer;
  let reopening = null;
  async function observerProvider() {
    if (observer && !observer.isDead()) return { ok: true, observer };
    if (!reopening) reopening = openObserver().then((r) => { reopening = null; if (r.ok) observer = r.observer; return r; });
    return reopening;
  }

  // ── 4: the channel ──
  // TEST-ONLY: the accepted private-network listener contract refuses loopback, so offline tests may substitute a
  // loopback listener (exactly 127.0.0.1 + a 127.0.0.1/32 peer) — only under the offline test boundary; production
  // never reaches this (the option key is refused above).
  let listen = cfg.listen;
  if (offline && opts.testListen) {
    const tl = opts.testListen;
    if (tl.bindHost !== "127.0.0.1" || !Number.isInteger(tl.port) || JSON.stringify(tl.allowedPeerCidrs) !== '["127.0.0.1/32"]') return refuse(log, "refused", "test_listen_not_loopback");
    listen = Object.freeze({ bindHost: "127.0.0.1", port: tl.port, allowWildcardBind: false, allowedPeerCidrs: ["127.0.0.1/32"] });
  }
  let server;
  try {
    server = await startExecutorAttestationServer({ channelSecret: env[cfg.secretRefs.channelSecretEnvName], listen, observerProvider,
      signer: sa.signer, anchor: cfg.anchor, nowProvider, log: offline && typeof opts.requestLog === "function" ? opts.requestLog : () => {},
      offlineTestBoundary: offline, ...(offline && Number.isInteger(opts.requestBudgetMs) ? { requestBudgetMs: opts.requestBudgetMs } : {}) });
  } catch { try { await observer.close(); } catch {} return refuse(log, "unprovisioned", "executor_attester_listen_failed"); }

  logLine(log, "serving", { issuer: sa.signer.issuer, keyId: sa.signer.keyId, port: server.address.port });
  let serving = true, fatalSignalled = false;
  const watch = setInterval(() => {
    if (!serving || fatalSignalled) return;
    if (observer && observer.isDead()) void observerProvider().then((r) => { if (!r.ok && !fatalSignalled) { fatalSignalled = true; logLine(log, "observer_lost", { reason: r.reason }); try { if (typeof onFatal === "function") onFatal(); } catch {} } });
  }, offline && Number.isInteger(opts.watchMs) ? opts.watchMs : OBSERVER_WATCH_MS);
  if (typeof watch.unref === "function") watch.unref();

  return Object.freeze({
    started: true, status: "serving", id: EXECUTOR_ATTESTER_ID, version: EXECUTOR_ATTESTER_VERSION,
    address: server.address, issuer: sa.signer.issuer, keyId: sa.signer.keyId, publicKeyDerB64: sa.signer.publicKeyDerB64,
    stats: () => server.stats(),
    ready() { return serving === true && !!observer && !observer.isDead(); },
    async stop() { serving = false; clearInterval(watch); try { await server.close(); } catch {} try { if (observer) await observer.close(); } catch {} return true; },
  });
}

async function main() {
  let ctrl;
  ctrl = await startExecutorAttesterService({ onFatal: () => { Promise.resolve(ctrl && ctrl.stop()).catch(() => {}).finally(() => process.exit(EXIT.observer_lost)); } });
  if (!ctrl.started) { process.exitCode = EXIT.unprovisioned; return; }
  const shutdown = async () => { try { await ctrl.stop(); } finally { process.exit(0); } };
  process.on("SIGTERM", shutdown); process.on("SIGINT", shutdown);
}
const isMain = (() => { try { return !!process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]; } catch { return false; } })();
if (isMain) { main(); }
