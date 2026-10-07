// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — PI01 LIVE READINESS REMEDIATION 01 — Executor Attester V2 production-like ENTRYPOINT. OFFLINE
// candidate (NOT deployed). Future start command (FUTURE boundary 2, separately authorized):
//   node scripts/live-ai-03b/m7-post-step67-pi01-live-readiness-remediation-01/src/executor-attester-v2-entrypoint.mjs
//
// Order (fail closed at every step; nothing listens until all pass):
//   1. STATIC configuration (no I/O) via the FROZEN reviewed executor-attester config loader (foreign credentials
//      refused, required names present, issuer/fingerprint distinct from the reader attester, TEST-ONLY material
//      refused, private listen policy, proof lifetime, executor anchor) PLUS the V2 rule: the configured issuer MUST
//      equal exactly `staybid.live-ai-03b.executor-attester.v2` (the frozen R3 V2 issuer). Any other value — including
//      every V1-era issuer string — refuses. There is no V1 mode.
//   2. STATIC signing adapter (no I/O): the frozen R3 createExecutorSigningAdapterV2 — Ed25519 key == configured public
//      identity, ≠ reader-attester key, lifetime ≤ the frozen V2 ceiling.
//   3. ONLY THEN the first I/O — the least-privilege V2 observer connection (timeout + read-only set and read back).
//   4. the authenticated private-network channel `executor-attestation-channel-v2`.
// Production accepts ONLY { mode:"production"|undefined, env, log, onFatal }. Offline injection requires
// mode:"offline-test" + offlineTestBoundary:true; any injection key in production is refused before config is read.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
import process from "node:process";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadExecutorAttesterConfig, EXECUTOR_ATTESTER_ID, ENV as EXECUTOR_ATTESTER_SERVICE_ENV }
  from "../../m7-v2-executor-attester-issuer-offline-01/src/executor-attester-config.mjs";
import { EXECUTOR_ATTESTATION_ISSUER_V2, EXECUTOR_ATTESTATION_CONTRACT_V2 }
  from "../../m7-post-step67-fresh-successor-r3-preservation-02/artifact/extracted/src/executor-attestation-v2.mjs";
import { createExecutorSigningAdapterV2 } from "../../m7-post-step67-fresh-successor-r3-preservation-02/artifact/extracted/src/executor-attester-signing-v2.mjs";
import { makeExecutorObserverPgFactoryV2, establishExecutorObserverSessionV2 } from "./executor-observer-v2.mjs";
import { startExecutorAttestationServerV2 } from "./executor-attestation-server-v2.mjs";
import { EXECUTOR_CHANNEL_VERSION_V2 } from "./executor-attestation-channel-v2.mjs";

export const EXECUTOR_ATTESTER_V2_VERSION = "executor-attester-v2-pi01-lrr01";
export const EXIT = Object.freeze({ unprovisioned: 70, observer_lost: 73 });
export const PRODUCTION_OPTION_KEYS = Object.freeze(["env", "log", "mode", "onFatal"]);
export const OBSERVER_WATCH_MS = 2000;
export { EXECUTOR_ATTESTER_SERVICE_ENV };

function logLine(log, status, extra) {
  (log || console.log)(JSON.stringify({ executorAttester: EXECUTOR_ATTESTER_ID, version: EXECUTOR_ATTESTER_V2_VERSION, contract: EXECUTOR_ATTESTATION_CONTRACT_V2,
    protocol: EXECUTOR_CHANNEL_VERSION_V2, status, servesPublicDomain: false, ...(extra || {}) }));
}
const refuse = (log, status, reason) => { logLine(log, status, { reason }); return { started: false, status, reason }; };

/** STATIC V2 configuration (no I/O): frozen reviewed loader + exact V2 issuer binding. */
export function loadExecutorAttesterV2Config(env, { offlineTestBoundary = false } = {}) {
  const cfg = loadExecutorAttesterConfig(env, { offlineTestBoundary });
  if (!cfg.ok) return cfg;
  if (cfg.issuer !== EXECUTOR_ATTESTATION_ISSUER_V2) return { ok: false, reason: "executor_attester_issuer_not_v2" };
  return cfg;
}

/** Start the V2 executor attester service. Returns a control handle, or { started:false, status, reason }. */
export async function startExecutorAttesterServiceV2(opts = {}) {
  const { log, onFatal } = opts;
  const offline = opts.mode === "offline-test";
  if (offline && opts.offlineTestBoundary !== true) return refuse(log, "refused", "offline_test_boundary_required");
  if (!offline && opts.mode !== undefined && opts.mode !== "production") return refuse(log, "refused", "mode_invalid");
  if (!offline) for (const k of Object.keys(opts)) if (!PRODUCTION_OPTION_KEYS.includes(k)) return refuse(log, "refused", "test_injection_refused_in_production");

  const env = opts.env || process.env;
  // ── 1 + 2: STATIC validation, before any I/O ──
  const cfg = loadExecutorAttesterV2Config(env, { offlineTestBoundary: offline });
  if (!cfg.ok) return refuse(log, "unprovisioned", cfg.reason);
  const nowProvider = offline && typeof opts.nowProvider === "function" ? opts.nowProvider : Date.now;
  const sa = createExecutorSigningAdapterV2({ privateKeyPkcs8B64: env[cfg.secretRefs.signingKeyEnvName], expectedPublicKeyDerB64: cfg.publicKeyDerB64,
    expectedFingerprint: cfg.fingerprint, readerAttesterFingerprint: cfg.readerAttester.fingerprint, proofLifetimeMs: cfg.proofLifetimeMs, nowProvider });
  if (!sa.ok) return refuse(log, "unprovisioned", sa.reason);

  // ── 3: first I/O — the V2 observer ──
  const factory = offline && opts.observerFactory ? opts.observerFactory
    : makeExecutorObserverPgFactoryV2({ env, connectionStringEnvName: cfg.secretRefs.observerDbUrlEnvName });
  let observer = null;
  async function openObserver() {
    let physical;
    try { physical = await factory.open(); } catch { return { ok: false, reason: "observer_connection_failed" }; }
    const es = await establishExecutorObserverSessionV2(physical);   // destroys the physical itself on a failed setup
    if (!es.ok) return { ok: false, reason: es.reason };
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

  // ── 4: the channel ── (TEST-ONLY loopback listener only under the offline boundary; production never reaches it)
  let listen = cfg.listen;
  if (offline && opts.testListen) {
    const tl = opts.testListen;
    if (tl.bindHost !== "127.0.0.1" || !Number.isInteger(tl.port) || JSON.stringify(tl.allowedPeerCidrs) !== '["127.0.0.1/32"]') return refuse(log, "refused", "test_listen_not_loopback");
    listen = Object.freeze({ bindHost: "127.0.0.1", port: tl.port, allowWildcardBind: false, allowedPeerCidrs: ["127.0.0.1/32"] });
  }
  let server;
  try {
    server = await startExecutorAttestationServerV2({ channelSecret: env[cfg.secretRefs.channelSecretEnvName], listen, observerProvider,
      signer: sa.signer, anchor: cfg.anchor, nowProvider, log: offline && typeof opts.requestLog === "function" ? opts.requestLog : () => {},
      offlineTestBoundary: offline, ...(offline && Number.isInteger(opts.requestBudgetMs) ? { requestBudgetMs: opts.requestBudgetMs } : {}) });
  } catch { try { await observer.close(); } catch {} return refuse(log, "unprovisioned", "executor_attester_v2_listen_failed"); }

  logLine(log, "serving", { issuer: sa.signer.issuer, keyId: sa.signer.keyId, port: server.address.port });
  let serving = true, fatalSignalled = false;
  const watch = setInterval(() => {
    if (!serving || fatalSignalled) return;
    if (observer && observer.isDead()) void observerProvider().then((r) => { if (!r.ok && !fatalSignalled) { fatalSignalled = true; logLine(log, "observer_lost", { reason: r.reason }); try { if (typeof onFatal === "function") onFatal(); } catch {} } });
  }, offline && Number.isInteger(opts.watchMs) ? opts.watchMs : OBSERVER_WATCH_MS);
  if (typeof watch.unref === "function") watch.unref();

  return Object.freeze({
    started: true, status: "serving", id: EXECUTOR_ATTESTER_ID, version: EXECUTOR_ATTESTER_V2_VERSION,
    address: server.address, issuer: sa.signer.issuer, keyId: sa.signer.keyId, publicKeyDerB64: sa.signer.publicKeyDerB64,
    stats: () => server.stats(),
    ready() { return serving === true && !!observer && !observer.isDead(); },
    async stop() { serving = false; clearInterval(watch); try { await server.close(); } catch {} try { if (observer) await observer.close(); } catch {} return true; },
  });
}

async function main() {
  let ctrl;
  ctrl = await startExecutorAttesterServiceV2({ onFatal: () => { Promise.resolve(ctrl && ctrl.stop()).catch(() => {}).finally(() => process.exit(EXIT.observer_lost)); } });
  if (!ctrl.started) { process.exitCode = EXIT.unprovisioned; return; }
  const shutdown = async () => { try { await ctrl.stop(); } finally { process.exit(0); } };
  process.on("SIGTERM", shutdown); process.on("SIGINT", shutdown);
}
const isMain = (() => { try { return !!process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(resolve(process.argv[1])); } catch { return false; } })();
if (isMain) { main(); }
