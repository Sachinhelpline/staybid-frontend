// ─────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — M7 STEP6/7 — Authority STANDBY start command (future phase P5 deploy). OFFLINE candidate.
//
// Keeps the Authority container alive so (a) it holds ONE stable private network identity that the executor
// attester's literal /128 allowlist and the dedicated reader attester's DNS-resolved peer can bind to, and (b) the
// one-shot verification entrypoint can later be executed inside it (`railway ssh … -- node …`).
// It opens NO database connection, sends NO attester request, binds NO listener, reads NO secret VALUE (only checks
// that the required NAMES are present) and prints one bounded non-secret line. It contains no activation path.
// ─────────────────────────────────────────────────────────────────────────
import process from "node:process";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { REQUIRED_AUTHORITY_NAMES, screenStep67Forbidden } from "./step67-config.mjs";
import { STEP67_VERSION } from "./constants.mjs";

export const STANDBY_VERSION = "m7-step67-authority-standby-v1";
export function standbyStatus(env) {
  const present = (n) => typeof env[n] === "string" && env[n].trim() !== "";
  const missing = REQUIRED_AUTHORITY_NAMES.filter((n) => !present(n)).length;
  const fs = screenStep67Forbidden(env);
  return Object.freeze({ standby: STANDBY_VERSION, package: STEP67_VERSION, requiredNamesPresent: missing === 0, missingNameCount: missing,
    forbiddenSecretClassAbsent: fs.ok === true, dbConnections: 0, attesterRequests: 0, listener: false, activationCapability: false });
}
function main() {
  process.stdout.write("STEP67_AUTHORITY_STANDBY " + JSON.stringify(standbyStatus(process.env)) + "\n");
  const keep = setInterval(() => {}, 60 * 60 * 1000);   // idle keep-alive; no I/O
  const stop = () => { clearInterval(keep); process.exit(0); };
  process.on("SIGTERM", stop); process.on("SIGINT", stop);
}
const isMain = (() => { try { return !!process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(resolve(process.argv[1])); } catch { return false; } })();
if (isMain) main();
