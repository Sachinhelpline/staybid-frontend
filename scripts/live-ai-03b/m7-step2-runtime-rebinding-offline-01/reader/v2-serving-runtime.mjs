// ─────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — M7 STEP 2 — V2 private-reader SERVING runtime. OFFLINE, Node built-ins only.
//
// Successor of private-reader-host-runtime-offline-01/private-reader-host-runtime.mjs (V1, frozen: it
// composes the V1 reader-only host). Identical serving discipline — reader-ONLY authority, explicit listen
// mode, authenticated transport, observation deadline + quarantine, degraded ⇒ not ready + watchdog — and
// it REUSES the accepted, version-neutral transport (`reader-obs-transport-v1` forwards
// `host.observe({observation},{signal})` unchanged) and runtime config. Only the host is the V2 host.
// ─────────────────────────────────────────────────────────────────────────
import process from "node:process";
import { fileURLToPath } from "node:url";
import { startObservationServer, validateListenConfig, MIN_SECRET_LEN } from "../../private-reader-host-runtime-offline-01/observation-transport.mjs";
import { targetSelfCheck, acquireTransportSecretFromEnv, resolveListenConfigFromEnv } from "../../private-reader-host-runtime-offline-01/runtime-config.mjs";
import { makeReaderOnlyHostV2, acquireReaderOnlyProductionAuthorityV2 } from "./v2-reader-only-authority.mjs";
import { MESSAGE_KIND_V2 } from "./v2-observation-contract.mjs";

export const RUNTIME_ID_V2 = "live-ai-03b-private-reader-host-runtime-v2";
export const FAIL_EXIT_CODE = 70;
export const DEGRADED_EXIT_CODE = 71;
export const DEGRADED_WATCH_MS = 1000;
function logLine(log, status) { (log || console.log)(JSON.stringify({ runtime: RUNTIME_ID_V2, status, servesPublicDomain: false })); }

export async function startServingRuntimeV2(opts = {}) {
  const { acquireReaderAuthority, transportSecretProvider, socketPath, tcp, nowProvider, log, testBoundary, limits, onDegraded } = opts;
  if (!targetSelfCheck().ok) { logLine(log, "target_identity_mismatch"); return { started: false, status: "target_identity_mismatch" }; }
  const acquire = acquireReaderAuthority || acquireReaderOnlyProductionAuthorityV2;
  let acq;
  try { acq = await acquire(); } catch { logLine(log, "acquire_error"); return { started: false, status: "acquire_error" }; }
  if (!acq || acq.available !== true || !acq.authority) { logLine(log, "unprovisioned"); return { started: false, status: "unprovisioned" }; }
  const host = makeReaderOnlyHostV2(acq.authority, { testBoundary: !!testBoundary });
  if (!host || host.available !== true) { logLine(log, "host_unavailable"); return { started: false, status: "host_unavailable" }; }
  let secret;
  try { secret = await (transportSecretProvider || acquireTransportSecretFromEnv)(); } catch { secret = undefined; }
  if (typeof secret !== "string" || secret.length < MIN_SECRET_LEN) { logLine(log, "transport_secret_absent"); return { started: false, status: "transport_secret_absent" }; }
  let listen;
  try {
    listen = opts.listen ? opts.listen : tcp ? { mode: "loopback-tcp", host: tcp.host, port: tcp.port } : socketPath ? { mode: "unix", socketPath } : resolveListenConfigFromEnv();
    validateListenConfig(listen, { testBoundary: !!testBoundary });
  } catch { logLine(log, "listen_config_invalid"); return { started: false, status: "listen_config_invalid" }; }
  let server;
  try { server = await startObservationServer({ listen, limits, host, secret, nowProvider, log, testBoundary: !!testBoundary }); }
  catch { logLine(log, "transport_error"); return { started: false, status: "transport_error" }; }
  logLine(log, "serving");
  let serving = true; let degradedNotified = false;
  const watchMs = Number.isInteger(opts.degradedWatchMs) && opts.degradedWatchMs > 0 ? opts.degradedWatchMs : DEGRADED_WATCH_MS;
  const watch = setInterval(() => {
    if (!serving || degradedNotified || !server.health().degraded) return;
    degradedNotified = true; logLine(log, "degraded");
    try { if (typeof onDegraded === "function") onDegraded(); } catch {}
  }, watchMs);
  if (typeof watch.unref === "function") watch.unref();
  return Object.freeze({
    started: true, status: "serving", id: RUNTIME_ID_V2, address: server.address, mode: server.mode,
    ready() { return serving === true && host.available === true && server.health().degraded === false; },
    health() { const h = server.health(); return { serving, active: h.active, degraded: h.degraded, maxConcurrent: h.maxConcurrent }; },
    async observeLocal(request) { return serving ? host.observe(request) : { kind: MESSAGE_KIND_V2, ok: false, code: "unprovisioned" }; },
    toGatewayMessage(m) { return host.toGatewayMessage(m); },
    async stop() { serving = false; clearInterval(watch); try { return await server.close(); } catch { return false; } },
  });
}

async function main() {
  let r;
  const onDegraded = () => { Promise.resolve(r && r.stop()).catch(() => {}).finally(() => process.exit(DEGRADED_EXIT_CODE)); };
  r = await startServingRuntimeV2({ onDegraded });
  if (!r.started) { process.exitCode = FAIL_EXIT_CODE; return; }
  const shutdown = async () => { try { await r.stop(); } finally { process.exitCode = 0; } };
  process.on("SIGTERM", shutdown); process.on("SIGINT", shutdown);
}
const isMain = (() => { try { return !!process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]; } catch { return false; } })();
if (isMain) { main(); }
