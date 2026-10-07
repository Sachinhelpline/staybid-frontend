// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — PI01 LIVE READINESS REMEDIATION 01 — Authority V3 ONE-SHOT ACTIVATION RUNNER. OFFLINE candidate.
//
// FOR FUTURE BOUNDARY 9 (CATALOG ACTIVATION) ONLY — it is NOT a start command, is NOT imported by the standby
// entrypoint, and running it requires a separate, explicit Owner authorization AFTER boundaries 1–8 have passed
// (including GENUINE reviewer approval signing, which this package never performs).
// Intended future invocation inside the deployed Authority container (operator-run, never automatic):
//   node scripts/live-ai-03b/m7-post-step67-pi01-live-readiness-remediation-01/src/authority-v3-activation-oneshot.mjs \
//     --run-id <run-id> --request-file <path> --confirm-execution-id <execution-id>
//
// Fail-closed order:
//   1. exact argv shape; request file ≤ 64 KiB, regular file, exact keys {approvalEnvelope, executionId,
//      suppliedEvidence}; executionId must equal --confirm-execution-id;
//   2. ADVISORY host-clock catalog window (refuses at/after the frozen R3 expiry; the authoritative check is the
//      DB-clock-bound one inside the accepted PI01 run());
//   3. ONE-SHOT container lock (O_CREAT|O_EXCL|O_NOFOLLOW, 0600) taken BEFORE any composition or I/O — a second
//      attempt in the same deployment is refused whether the first succeeded, failed or is ambiguous; never removed;
//   4. composeAuthorityV3({env}) (accepted PI01 boundary, unchanged) — unavailable ⇒ refused, nothing attempted;
//   5. boundary.run(request) EXACTLY ONCE. No retry of any kind. No automatic restoration.
// Exit codes: 0 activated+committed+correlated · 3 refused (no activation attempted / adapter refused without
// executing) · 4 UNCERTAIN (ambiguous mutation outcome — MUST NOT be retried or restored automatically; Owner
// read-only reconciliation required) · 2 usage/lock refusal. Output: one bounded JSON line, no secrets, no request body.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
import process from "node:process";
import { openSync, closeSync, writeSync, lstatSync, mkdirSync, readFileSync, realpathSync, constants } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { composeAuthorityV3 } from "./authority-v3-composition.mjs";
import { catalogWindow } from "./authority-v3-standby-entrypoint.mjs";

export const ONESHOT_VERSION = "pi01-authority-v3-activation-oneshot-lrr01";
export const EXIT = Object.freeze({ activated: 0, usage: 2, refused: 3, uncertain: 4 });
export const MAX_REQUEST_BYTES = 65536;
const RUN_ID = /^[a-z0-9][a-z0-9-]{7,63}$/;
const IDRE = /^[A-Za-z0-9._:-]{8,128}$/;
const REQUEST_KEYS = "approvalEnvelope,executionId,suppliedEvidence";
const SAFE = (s) => (typeof s === "string" && /^[A-Za-z0-9_:.-]{1,96}$/.test(s) ? s : "unclassified");

export function defaultLockDir() { return join(tmpdir(), "lai03b-pi01-v3-activation"); }

/** One activation attempt per Authority deployment (container lifetime). Never released. */
export function acquireActivationAttemptLock(runId, dir = defaultLockDir()) {
  if (!RUN_ID.test(String(runId))) return { ok: false, reason: "run_id_invalid" };
  try { mkdirSync(dir, { recursive: true, mode: 0o700 }); const st = lstatSync(dir); if (!st.isDirectory() || st.isSymbolicLink()) return { ok: false, reason: "lock_dir_unsafe" }; }
  catch { return { ok: false, reason: "lock_dir_unsafe" }; }
  let fd;
  try { fd = openSync(join(dir, "activation-attempt.lock"), constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW || 0), 0o600); }
  catch (e) { return { ok: false, reason: e && e.code === "EEXIST" ? "activation_already_attempted_in_this_deployment" : "lock_create_failed" }; }
  try { writeSync(fd, runId + "\n"); } finally { closeSync(fd); }
  return { ok: true };
}

export function parseArgs(argv) {
  if (!Array.isArray(argv) || argv.length !== 6) return { ok: false, reason: "argv_shape" };
  const m = new Map();
  for (let i = 0; i < 6; i += 2) { const k = argv[i], v = argv[i + 1]; if (!["--run-id", "--request-file", "--confirm-execution-id"].includes(k) || m.has(k) || typeof v !== "string" || v.startsWith("--")) return { ok: false, reason: "argv_shape" }; m.set(k, v); }
  if (!RUN_ID.test(m.get("--run-id"))) return { ok: false, reason: "run_id_invalid" };
  if (!IDRE.test(m.get("--confirm-execution-id"))) return { ok: false, reason: "confirm_execution_id_invalid" };
  return { ok: true, runId: m.get("--run-id"), requestFile: m.get("--request-file"), confirmExecutionId: m.get("--confirm-execution-id") };
}

export function readRequest(path, confirmExecutionId) {
  let st; try { st = lstatSync(path); } catch { return { ok: false, reason: "request_file_absent" }; }
  if (!st.isFile() || st.isSymbolicLink()) return { ok: false, reason: "request_file_not_regular" };
  if (st.size < 2 || st.size > MAX_REQUEST_BYTES) return { ok: false, reason: "request_file_size" };
  let req; try { req = JSON.parse(readFileSync(path, "utf8")); } catch { return { ok: false, reason: "request_json_malformed" }; }
  if (!req || typeof req !== "object" || Array.isArray(req) || Object.keys(req).sort().join(",") !== REQUEST_KEYS) return { ok: false, reason: "request_shape_not_exact" };
  if (req.executionId !== confirmExecutionId) return { ok: false, reason: "execution_id_confirmation_mismatch" };
  return { ok: true, request: req };
}

export function classify(result) {
  if (result && result.ok === true && result.activated === true) return EXIT.activated;
  if (result && result.uncertain === true) return EXIT.uncertain;
  return EXIT.refused;
}

/** Run the one-shot. Injection exists ONLY for offline tests (compose / lockDir / nowMs). */
export async function runActivationOneShot(argv, { env = process.env, compose = composeAuthorityV3, lockDir = defaultLockDir(), nowMs = Date.now() } = {}) {
  const out = (code, o) => ({ code, line: JSON.stringify({ oneshot: ONESHOT_VERSION, ...o }) });
  const a = parseArgs(argv); if (!a.ok) return out(EXIT.usage, { status: "refused", reason: a.reason, activationAttempted: false });
  const r = readRequest(a.requestFile, a.confirmExecutionId); if (!r.ok) return out(EXIT.usage, { status: "refused", reason: r.reason, activationAttempted: false });
  const w = catalogWindow(nowMs); if (w !== "open_advisory") return out(EXIT.refused, { status: "refused", reason: "catalog_window_" + w, activationAttempted: false });
  const lock = acquireActivationAttemptLock(a.runId, lockDir); if (!lock.ok) return out(EXIT.usage, { status: "refused", reason: lock.reason, activationAttempted: false });
  const c = compose({ env }); if (!c || c.available !== true) return out(EXIT.refused, { status: "refused", reason: SAFE(c && c.reason), activationAttempted: false });
  let res;
  try { res = await c.boundary.run(r.request); } catch { res = { ok: false, activated: false, uncertain: true, stage: "oneshot", reason: "boundary_run_threw" }; }
  const code = classify(res);
  return out(code, { status: code === EXIT.activated ? "activated" : code === EXIT.uncertain ? "UNCERTAIN_NO_RETRY_NO_AUTO_RESTORE" : "refused",
    stage: SAFE(res && res.stage), reason: res && res.ok ? null : SAFE(res && res.reason), activationAttempted: true, retried: false, autoRestored: false,
    approvalId: res && res.ok ? SAFE(res.approvalId) : null, executionId: res && res.ok ? SAFE(res.executionId) : null,
    consumedAt: res && res.ok ? SAFE(res.consumedAt) : null, successorRuntimePinRef: c.successorRuntimePinRef });
}

async function main() {
  const r = await runActivationOneShot(process.argv.slice(2));
  process.stdout.write(r.line + "\n");
  process.exit(r.code);
}
const isMain = (() => { try { return !!process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(resolve(process.argv[1])); } catch { return false; } })();
if (isMain) main();
