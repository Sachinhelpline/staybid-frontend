// ─────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — M7 STEP6/7 — VERIFICATION-ONLY Authority-host entrypoint (one-shot process). OFFLINE candidate.
//
// Future use ONLY (phase P8, separately authorized): executed INSIDE the deployed Authority container via
//   railway ssh -p <project> -e <environment> -s <authority> -- node <this file> --run-id <id> \
//     --expected-executor-attester-fingerprint <hex64> --expected-reader-attester-fingerprint <hex64> \
//     --forbidden-reader-attester-fingerprint <hex64>
// Every argument is PUBLIC (a run id + three public-key fingerprints from accepted receipts). Secret values are read
// only from the Authority's Railway-resolved environment, at point of use, by accepted factories/adapters, and are
// never printed, logged or placed in an error. No listener. Exactly one attempt per Authority deployment.
// It NEVER calls composeTrustedExecutorProductionV2(), Phase A, SQL03, activation or restoration routines,
// a gateway or a provider. Exit: 0 PASS · 3 HOLD · 64 usage.
// ─────────────────────────────────────────────────────────────────────────
import process from "node:process";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { makeExecutorPgPhysicalFactory } from "../../m7-v2-production-authority-provisioning-offline-01/src/executor-session.mjs";
import { makePgPhysicalFactory } from "../../private-reader-production-integration-offline-01/reader-session.mjs";
import { makeProductionClock } from "../../m7-v2-production-authority-provisioning-offline-01/src/trusted-clock.mjs";
import { createExecutorAttestationSourceChannel } from "../../m7-v2-executor-attester-issuer-offline-01/src/executor-attestation-channel.mjs";
import { loadStep67Config } from "./step67-config.mjs";
import { acquireReaderV2Attestation } from "./reader-v2-attestation-source.mjs";
import { runStep67Verification } from "./step67-verifier.mjs";
import { buildReceipt, holdMarker } from "./receipt.mjs";
import { acquireDeploymentAttemptLock, isValidRunId } from "./one-shot-guard.mjs";

const ARG_KEYS = Object.freeze({
  "--run-id": "runId",
  "--expected-executor-attester-fingerprint": "expectedExecutorAttesterFingerprint",
  "--expected-reader-attester-fingerprint": "expectedReaderAttesterFingerprint",
  "--forbidden-reader-attester-fingerprint": "forbiddenReaderAttesterFingerprint",
});
export function parseArgs(argv) {
  const out = {};
  if (!Array.isArray(argv) || argv.length !== 8) return { ok: false, reason: "usage" };
  for (let i = 0; i < argv.length; i += 2) {
    const k = ARG_KEYS[argv[i]]; const v = argv[i + 1];
    if (!k || out[k] !== undefined || typeof v !== "string") return { ok: false, reason: "usage" };
    out[k] = v;
  }
  if (!isValidRunId(out.runId)) return { ok: false, reason: "run_id_invalid" };
  for (const k of ["expectedExecutorAttesterFingerprint", "expectedReaderAttesterFingerprint", "forbiddenReaderAttesterFingerprint"]) if (!/^[0-9a-f]{64}$/.test(out[k] || "")) return { ok: false, reason: "pin_invalid" };
  return { ok: true, args: Object.freeze(out) };
}

/** PRODUCTION composition. Accepts ONLY { env, argv, lockDir? } — no injected factory/source/clock/trust root. */
export async function runStep67Production(opts = {}) {
  const keys = Object.keys(opts);
  if (keys.some((k) => !["env", "argv", "lockDir"].includes(k))) return { ok: false, reason: "production_entrypoint_rejects_injection", stage: "S0_inputs" };
  const env = opts.env || process.env;
  const a = parseArgs(opts.argv || []);
  if (!a.ok) return { ok: false, reason: a.reason, stage: "S0_inputs", usage: true };
  const pins = { expectedExecutorAttesterFingerprint: a.args.expectedExecutorAttesterFingerprint, expectedReaderAttesterFingerprint: a.args.expectedReaderAttesterFingerprint,
    forbiddenReaderAttesterFingerprint: a.args.forbiddenReaderAttesterFingerprint };
  const cfg = loadStep67Config(env, pins, { testBoundary: false });
  if (!cfg.ok) return { ok: false, reason: cfg.reason, stage: "S0_inputs", runId: a.args.runId, pins };
  const lock = acquireDeploymentAttemptLock(a.args.runId, ...(opts.lockDir ? [opts.lockDir] : []));
  if (!lock.ok) return { ok: false, reason: lock.reason, stage: "S0_one_shot", runId: a.args.runId, pins };
  const exSrc = createExecutorAttestationSourceChannel({ host: cfg.executorAttester.host, port: cfg.executorAttester.port,
    channelSecret: env[cfg.executorAttester.channelSecretEnvName], readerChannelSecret: env[cfg.readerAttester.channelSecretEnvName] }, { offlineTestBoundary: false });
  if (!exSrc.ok) return { ok: false, reason: exSrc.reason, stage: "S0_inputs", runId: a.args.runId, pins };
  const result = await runStep67Verification({
    config: cfg,
    executorPhysicalFactory: makeExecutorPgPhysicalFactory({ env, connectionStringEnvName: cfg.executorDbUrlEnvName }),
    readerPhysicalFactory: makePgPhysicalFactory({ env, connectionStringEnvName: cfg.readerDbUrlEnvName }),
    executorSource: exSrc.source,
    readerChannelSecret: env[cfg.readerAttester.channelSecretEnvName],
    clock: makeProductionClock(),
    acquireReaderV2: (x) => acquireReaderV2Attestation({ ...x, testBoundary: false }),
  });
  return { ...result, runId: a.args.runId, pins };
}

async function main() {
  try { process.umask(0o077); } catch {}
  const startedUtc = new Date().toISOString();
  let r;
  try { r = await runStep67Production({ env: process.env, argv: process.argv.slice(2) }); }
  catch { r = { ok: false, reason: "entrypoint_unexpected_failure", stage: "S0_inputs" }; }
  const finishedUtc = new Date().toISOString();
  if (r.usage) { process.stdout.write(holdMarker("USAGE") + "\n"); process.exitCode = 64; return; }
  const pins = r.pins || { expectedExecutorAttesterFingerprint: "0".repeat(64), expectedReaderAttesterFingerprint: "0".repeat(64), forbiddenReaderAttesterFingerprint: "0".repeat(64) };
  const b = buildReceipt({ runId: r.runId || "unknown-run", startedUtc, finishedUtc, result: r, pins });
  if (!b.ok) { process.stdout.write(holdMarker("RECEIPT_REFUSED_UNSAFE") + "\n"); process.exitCode = 3; return; }
  process.stdout.write("STEP67_RECEIPT " + JSON.stringify(b.receipt) + "\n" + b.receipt.marker + "\n");
  process.exitCode = r.ok === true ? 0 : 3;
}
const isMain = (() => { try { return !!process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(resolve(process.argv[1])); } catch { return false; } })();
if (isMain) main();
