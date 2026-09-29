// ─────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — BOOTSTRAP: ATTESTER production entrypoint (OFFLINE candidate). Node built-ins only.
//
// Start command (see DEPLOYMENT-CONTRACT.md):
//   node scripts/live-ai-03b/private-reader-bootstrap-clock-peer-offline-01/bootstrap-entrypoint-attester.mjs
//
// This is a REAL versioned composition root (M1-R2): it composes the attester bootstrap from deployment-owned
// configuration in process.env. With valid provisioning it starts (WAITING_FOR_CLOCK → BOOTSTRAP_LISTENING and
// signs only after the full clock/anchor/observer/request gates) — it is NOT hardcoded to a permanent stub. With
// missing/invalid configuration it fails closed (exit 70), opens no listener, connects to no database, and mints
// no signature. Secrets (signing key, channel secret, DB URL) are consumed by env NAME at point of use, never printed.
// ─────────────────────────────────────────────────────────────────────────
import process from "node:process";
import { fileURLToPath } from "node:url";
import { composeAttesterProduction, ATTESTER_PRODUCTION_VERSION } from "./production-attester.mjs";
import { ATTESTER_BOOTSTRAP_VERSION, EXIT } from "./attester-bootstrap.mjs";

export { EXIT, ATTESTER_BOOTSTRAP_VERSION, ATTESTER_PRODUCTION_VERSION };
export const START_COMMAND = "node scripts/live-ai-03b/private-reader-bootstrap-clock-peer-offline-01/bootstrap-entrypoint-attester.mjs";

// ── M5 clock-recovery remediation: SAFE production logger ──────────────────────────────────────────────────────
// The composition's structured JSON events are re-emitted as sanitized markers `M5_ATTESTER_<EVENT> {json}`.
// Only ALLOWLISTED event names and ALLOWLISTED keys survive; values must be booleans, finite numbers, null, or
// short strings over a restricted charset — anything else is replaced by "<redacted>". No secret, DSN, env value,
// token, key, IP address, hostname, SQL or stack can pass (they fail the key allowlist or the value charset).
export const ATTESTER_LOG_EVENTS = Object.freeze([
  "startup", "clock_invalidated", "signing_disabled", "recovery_scheduled", "recovery_started", "recovery_pass",
  "recovery_fail", "signing_restored", "peer_invalidated", "peer_identity_changed", "state", "stopped",
]);
export const ATTESTER_LOG_KEYS = Object.freeze([
  "reason", "reasonClass", "wasSigning", "attempt", "delayMs", "trigger", "nextDelayMs", "generationRotated", "recovery",
  "status", "signingReady", "monitorHealthy", "recovering", "recoveryAttempt", "peerInvalid", "lastReasonClass",
  "requests", "signed", "refused", "clockRefused", "started", "composition", "servesPublicDomain",
]);
// every legitimate value is one of the composition's own single-case identifiers (e.g. db_probe_failed,
// BOOTSTRAP_LISTENING); mixed case (base64/JWT-like), punctuation, whitespace and long hex runs are refused
const SAFE_LOG_STRING = /^(?:[a-z0-9_]{0,48}|[A-Z0-9_]{1,48})$/;
const IPV4_LIKE = /\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/;
const LONG_HEX_RUN = /[0-9a-fA-F]{16,}/;          // key/token/generation-like material
function safeLogValue(v) {
  if (v === null || typeof v === "boolean") return v;
  if (typeof v === "number") return Number.isFinite(v) ? v : "<redacted>";
  if (typeof v === "string") return SAFE_LOG_STRING.test(v) && !IPV4_LIKE.test(v) && !LONG_HEX_RUN.test(v) ? v : "<redacted>";
  return "<redacted>";
}
/** Build the safe marker logger. `write(line)` receives exactly one sanitized marker line per accepted event. */
export function makeSafeAttesterLogger(write) {
  const out = typeof write === "function" ? write : (line) => { try { process.stdout.write(line + "\n"); } catch {} };
  return function safeLog(line) {
    let o; try { o = typeof line === "string" ? JSON.parse(line) : null; } catch { return; }
    if (!o || typeof o !== "object" || Array.isArray(o)) return;
    const event = typeof o.event === "string" ? o.event : "";
    if (!ATTESTER_LOG_EVENTS.includes(event)) return;                // unknown events are dropped, never echoed
    const clean = {};
    for (const k of ATTESTER_LOG_KEYS) if (Object.prototype.hasOwnProperty.call(o, k)) clean[k] = safeLogValue(o[k]);
    try { out("M5_ATTESTER_" + event.toUpperCase() + " " + JSON.stringify(clean)); } catch {}
  };
}

/** Production service composition from process.env (no test injection accepted here). */
export async function startAttesterBootstrapService(opts = {}) {
  if (opts.mode === "offline-test" && opts.offlineTestBoundary === true) {
    return composeAttesterProduction({ offlineTest: true, offlineTestBoundary: true, inject: opts.inject || {} });
  }
  return composeAttesterProduction({ env: opts.env || process.env, log: opts.log });
}

async function main() {
  const safeLog = makeSafeAttesterLogger((line) => console.log(line));
  const r = await startAttesterBootstrapService({ log: safeLog });
  console.log(JSON.stringify({ attester: ATTESTER_BOOTSTRAP_VERSION, composition: ATTESTER_PRODUCTION_VERSION, status: r.status || "unprovisioned", reason: r.reason, servesPublicDomain: false, signingReady: typeof r.signingReady === "function" ? r.signingReady() : false }));
  safeLog(JSON.stringify({ event: "startup", started: !!r.started, status: typeof r.status === "function" ? r.status() : (r.status || "unprovisioned"), signingReady: typeof r.signingReady === "function" ? r.signingReady() : false, servesPublicDomain: false }));
  if (!r.started) { process.exitCode = EXIT.unprovisioned; return; }
  process.on("SIGTERM", () => { Promise.resolve(r.stop && r.stop()).finally(() => process.exit(0)); });
  process.on("SIGINT", () => { Promise.resolve(r.stop && r.stop()).finally(() => process.exit(0)); });
}
const isMain = (() => { try { return !!process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]; } catch { return false; } })();
if (isMain) { main(); }
