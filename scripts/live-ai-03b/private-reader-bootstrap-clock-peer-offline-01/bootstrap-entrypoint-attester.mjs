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

/** Production service composition from process.env (no test injection accepted here). */
export async function startAttesterBootstrapService(opts = {}) {
  if (opts.mode === "offline-test" && opts.offlineTestBoundary === true) {
    return composeAttesterProduction({ offlineTest: true, offlineTestBoundary: true, inject: opts.inject || {} });
  }
  return composeAttesterProduction({ env: opts.env || process.env, log: opts.log });
}

async function main() {
  const r = await startAttesterBootstrapService({});
  console.log(JSON.stringify({ attester: ATTESTER_BOOTSTRAP_VERSION, composition: ATTESTER_PRODUCTION_VERSION, status: r.status || "unprovisioned", reason: r.reason, servesPublicDomain: false, signingReady: typeof r.signingReady === "function" ? r.signingReady() : false }));
  if (!r.started) { process.exitCode = EXIT.unprovisioned; return; }
  process.on("SIGTERM", () => { Promise.resolve(r.stop && r.stop()).finally(() => process.exit(0)); });
  process.on("SIGINT", () => { Promise.resolve(r.stop && r.stop()).finally(() => process.exit(0)); });
}
const isMain = (() => { try { return !!process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]; } catch { return false; } })();
if (isMain) { main(); }
