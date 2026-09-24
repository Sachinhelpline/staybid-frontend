// ─────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — PRIVATE trusted-reader SERVING runtime (OFFLINE). Node built-ins only.
//
// A genuine long-running private serving process (not a preparation-only entrypoint): it establishes a
// reader-ONLY authority (no executorDbClient) via the versioned reader-only interface, holds the reader
// client privately, and serves the fixed, approved observation over an authenticated transport whose
// listen mode is EXPLICITLY selected (unix | loopback-tcp | private-network — see observation-transport).
// Fail-closed when authority / caller-auth secret / proofs / listen config are absent or invalid; never
// substitutes mock authority in production; opens no public domain; invents no authorization framework.
// Observation deadline + quarantine (Finding 2): a degraded transport (stalled work that never settled)
// makes the runtime NOT ready and fires the degraded watchdog; the process entrypoint then stops and
// exits non-zero (DEGRADED_EXIT_CODE) so the platform restart policy recycles it (terminating its DB
// connections) instead of accumulating stalled work.
// ─────────────────────────────────────────────────────────────────────────
import process from "node:process";
import { fileURLToPath } from "node:url";
import { makeReaderOnlyHost, acquireReaderOnlyProductionAuthority } from "./reader-only-authority.mjs";
import { startObservationServer, validateListenConfig, MIN_SECRET_LEN } from "./observation-transport.mjs";
import { RUNTIME_ID, targetSelfCheck, acquireTransportSecretFromEnv, resolveListenConfigFromEnv } from "./runtime-config.mjs";

export const RUNTIME_STATUS = Object.freeze(["target_identity_mismatch", "acquire_error", "unprovisioned", "host_unavailable", "transport_secret_absent", "listen_config_invalid", "transport_error", "serving"]);
export const FAIL_EXIT_CODE = 70;
export const DEGRADED_EXIT_CODE = 71;
export const DEGRADED_WATCH_MS = 1000;

function logLine(log, status) { (log || console.log)(JSON.stringify({ runtime: RUNTIME_ID, status, servesPublicDomain: false })); }

/**
 * Start the serving runtime. DI for offline tests: acquireReaderAuthority (default = accepted
 * reader-only composition, UNPROVISIONED offline), transportSecretProvider (default = env, absent
 * offline), listen (explicit listen config; legacy socketPath / tcp still accepted; default = env, which
 * defaults to a Unix socket), limits (tighten-only), onDegraded, degradedWatchMs, nowProvider, log,
 * testBoundary. Returns a control handle when serving, else { started:false, status } (fail closed).
 */
export async function startServingRuntime(opts = {}) {
  const { acquireReaderAuthority, transportSecretProvider, socketPath, tcp, nowProvider, log, testBoundary, limits, onDegraded } = opts;
  const sc = targetSelfCheck();
  if (!sc.ok) { logLine(log, "target_identity_mismatch"); return { started: false, status: "target_identity_mismatch" }; }

  const acquire = acquireReaderAuthority || acquireReaderOnlyProductionAuthority;
  let acq;
  try { acq = await acquire(); } catch { logLine(log, "acquire_error"); return { started: false, status: "acquire_error" }; }
  if (!acq || acq.available !== true || !acq.authority) { logLine(log, "unprovisioned"); return { started: false, status: "unprovisioned" }; }

  const host = makeReaderOnlyHost(acq.authority, { testBoundary: !!testBoundary });
  if (!host || host.available !== true) { logLine(log, "host_unavailable"); return { started: false, status: "host_unavailable" }; }

  const secretProvider = transportSecretProvider || acquireTransportSecretFromEnv;
  let secret;
  try { secret = await secretProvider(); } catch { secret = undefined; }
  if (typeof secret !== "string" || secret.length < MIN_SECRET_LEN) { logLine(log, "transport_secret_absent"); return { started: false, status: "transport_secret_absent" }; }

  // explicit listen selection: opts.listen › legacy tcp (loopback) › legacy socketPath (unix) › env (default unix)
  let listen;
  try {
    listen = opts.listen ? opts.listen
      : tcp ? { mode: "loopback-tcp", host: tcp.host, port: tcp.port }
      : socketPath ? { mode: "unix", socketPath }
      : resolveListenConfigFromEnv();
    validateListenConfig(listen, { testBoundary: !!testBoundary }); // no bind yet; refuses public/unacknowledged/unfiltered
  } catch { logLine(log, "listen_config_invalid"); return { started: false, status: "listen_config_invalid" }; }

  let server;
  try { server = await startObservationServer({ listen, limits, host, secret, nowProvider, log, testBoundary: !!testBoundary }); }
  catch { logLine(log, "transport_error"); return { started: false, status: "transport_error" }; }

  logLine(log, "serving");
  let serving = true; let degradedNotified = false;
  const watchMs = Number.isInteger(opts.degradedWatchMs) && opts.degradedWatchMs > 0 ? opts.degradedWatchMs : DEGRADED_WATCH_MS;
  const watch = setInterval(() => {
    if (!serving || degradedNotified || !server.health().degraded) return;
    degradedNotified = true;
    logLine(log, "degraded");
    try { if (typeof onDegraded === "function") onDegraded(); } catch {}
  }, watchMs);
  if (typeof watch.unref === "function") watch.unref();

  return Object.freeze({
    started: true, status: "serving", id: RUNTIME_ID, address: server.address, mode: server.mode,
    ready() { return serving === true && host.available === true && server.health().degraded === false; },
    health() { const h = server.health(); return { serving, active: h.active, degraded: h.degraded, maxConcurrent: h.maxConcurrent }; },
    // in-process direct observation (bypasses the socket) — same guarded host boundary; for local checks
    async observeLocal(request) { return serving ? host.observe(request) : { kind: "live-ai-03b-observation", ok: false, code: "unprovisioned" }; },
    toGatewayMessage(m) { return host.toGatewayMessage(m); },
    async stop() { serving = false; clearInterval(watch); try { return await server.close(); } catch { return false; } },
  });
}

// Process entrypoint (fail-closed). Production uses the accepted reader-only composition (UNPROVISIONED
// offline) + the env transport secret (absent offline) ⇒ never serves; exits non-zero. No listener.
async function main() {
  let r;
  const onDegraded = () => {
    // documented recovery: stop admitting, close the listener, exit non-zero so the platform restarts the
    // process (which also drops its DB connections). Never keeps accepting work while degraded.
    Promise.resolve(r && r.stop()).catch(() => {}).finally(() => process.exit(DEGRADED_EXIT_CODE));
  };
  r = await startServingRuntime({ onDegraded });
  if (!r.started) { process.exitCode = FAIL_EXIT_CODE; return; }
  const shutdown = async () => { try { await r.stop(); } finally { process.exitCode = 0; } };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

const isMain = (() => { try { return !!process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]; } catch { return false; } })();
if (isMain) { main(); }
