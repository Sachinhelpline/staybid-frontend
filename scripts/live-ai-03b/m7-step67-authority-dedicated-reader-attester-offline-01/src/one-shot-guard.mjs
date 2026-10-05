// ─────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — M7 STEP6/7 — one-shot guards. OFFLINE candidate. Node built-ins only.
//   • acquireDeploymentAttemptLock (inside the Authority container): ONE Step6/7 attempt per deployment lifetime,
//     regardless of run id — O_CREAT|O_EXCL|O_NOFOLLOW, mode 0600, refused if the directory is a symlink.
//   • beginOwnerAttempt / writeOwnerReceiptOnce (Owner-Mac controller): an attempt marker is created BEFORE the
//     live call; if a marker already exists (completed OR ambiguous) every later attempt is refused — NO auto-retry;
//     a receipt is written exactly once (never overwritten).
// ─────────────────────────────────────────────────────────────────────────
import { openSync, closeSync, writeSync, lstatSync, mkdirSync, constants, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const RUN_ID = /^[a-z0-9][a-z0-9-]{7,63}$/;
const fail = (reason) => Object.freeze({ ok: false, reason });
export const isValidRunId = (s) => typeof s === "string" && RUN_ID.test(s);

function exclusiveCreate(path, content) {
  let fd;
  try { fd = openSync(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW || 0), 0o600); }
  catch (e) { return fail(e && e.code === "EEXIST" ? "already_exists" : "create_failed"); }
  try { writeSync(fd, content); } finally { closeSync(fd); }
  return { ok: true };
}
function safeDir(dir) {
  try { mkdirSync(dir, { recursive: true, mode: 0o700 }); } catch { return false; }
  try { const st = lstatSync(dir); return st.isDirectory() && !st.isSymbolicLink(); } catch { return false; }
}

export function defaultLockDir() { return join(tmpdir(), "lai03b-step67"); }

/** One attempt per Authority deployment (container lifetime). */
export function acquireDeploymentAttemptLock(runId, dir = defaultLockDir()) {
  if (!isValidRunId(runId)) return fail("run_id_invalid");
  if (!safeDir(dir)) return fail("lock_dir_unsafe");
  const r = exclusiveCreate(join(dir, "step67-attempt.lock"), runId + "\n");
  if (!r.ok) return fail(r.reason === "already_exists" ? "step67_already_attempted_in_this_deployment" : "lock_create_failed");
  return { ok: true };
}

/** Owner controller: refuse if ANY prior attempt marker exists for this phase (done or ambiguous). */
export function beginOwnerAttempt(stateDir, phase, runId) {
  if (!isValidRunId(runId)) return fail("run_id_invalid");
  if (!/^P[0-9]$/.test(phase)) return fail("phase_invalid");
  if (!safeDir(stateDir)) return fail("state_dir_unsafe");
  if (existsSync(join(stateDir, phase + ".receipt.json"))) return fail("phase_receipt_exists_no_overwrite");
  const r = exclusiveCreate(join(stateDir, phase + ".attempt-started"), runId + "\n");
  if (!r.ok) return fail(r.reason === "already_exists" ? "prior_attempt_exists_ambiguous_or_complete_no_auto_retry" : "attempt_marker_failed");
  return { ok: true };
}
export function writeOwnerReceiptOnce(stateDir, phase, text) {
  if (!/^P[0-9]$/.test(phase)) return fail("phase_invalid");
  if (!safeDir(stateDir)) return fail("state_dir_unsafe");
  const r = exclusiveCreate(join(stateDir, phase + ".receipt.json"), text.endsWith("\n") ? text : text + "\n");
  return r.ok ? { ok: true } : fail(r.reason === "already_exists" ? "receipt_exists_no_overwrite" : "receipt_write_failed");
}
