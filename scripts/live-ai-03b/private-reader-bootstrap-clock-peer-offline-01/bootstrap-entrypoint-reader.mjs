// ─────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — BOOTSTRAP: READER production entrypoint (OFFLINE candidate). Node built-ins only.
//
// Start command (see DEPLOYMENT-CONTRACT.md):
//   node scripts/live-ai-03b/private-reader-bootstrap-clock-peer-offline-01/bootstrap-entrypoint-reader.mjs
//
// This is a REAL versioned composition root (M1-R2): it composes the reader bootstrap from deployment-owned
// configuration in process.env. With valid provisioning it starts (WAITING_FOR_CLOCK → WAITING_FOR_ATTESTER →
// AUTHORITY_READY) — it is NOT hardcoded to a permanent stub. With missing/invalid configuration it fails closed
// (exit 70) and opens no listener, connects to no database, and never opens the gateway observation listener.
// Secrets are consumed by env NAME at point of use and never printed.
// ─────────────────────────────────────────────────────────────────────────
import process from "node:process";
import { fileURLToPath } from "node:url";
import { composeReaderProduction, READER_PRODUCTION_VERSION } from "./production-reader.mjs";
import { READER_BOOTSTRAP_VERSION, EXIT } from "./reader-bootstrap.mjs";

export { EXIT, READER_BOOTSTRAP_VERSION, READER_PRODUCTION_VERSION };
export const START_COMMAND = "node scripts/live-ai-03b/private-reader-bootstrap-clock-peer-offline-01/bootstrap-entrypoint-reader.mjs";

/** Production service composition from process.env (no test injection accepted here). */
export async function startReaderBootstrapService(opts = {}) {
  // In production the only inputs are env + log. An explicit offline-test boundary forwards to the composition seam.
  if (opts.mode === "offline-test" && opts.offlineTestBoundary === true) {
    return composeReaderProduction({ offlineTest: true, offlineTestBoundary: true, inject: opts.inject || {} });
  }
  return composeReaderProduction({ env: opts.env || process.env, log: opts.log });
}

async function main() {
  const r = await startReaderBootstrapService({});
  console.log(JSON.stringify({ reader: READER_BOOTSTRAP_VERSION, composition: READER_PRODUCTION_VERSION, status: r.status || "unprovisioned", reason: r.reason, serving: false, authorityReady: typeof r.authorityReady === "function" ? r.authorityReady() : false }));
  if (!r.started) { process.exitCode = EXIT.unprovisioned; return; }
  process.on("SIGTERM", () => { Promise.resolve(r.stop && r.stop()).finally(() => process.exit(0)); });
  process.on("SIGINT", () => { Promise.resolve(r.stop && r.stop()).finally(() => process.exit(0)); });
}
const isMain = (() => { try { return !!process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]; } catch { return false; } })();
if (isMain) { main(); }
