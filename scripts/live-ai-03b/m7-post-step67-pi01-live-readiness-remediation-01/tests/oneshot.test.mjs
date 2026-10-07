// OFFLINE tests — one-shot activation runner (FUTURE boundary 9 only): argv/request shape, catalog expiry, one-shot
// lock, NO retry after ambiguous outcome, NO automatic restoration, exit classification. Fake boundaries only.
import { mkdtempSync, writeFileSync, rmSync, symlinkSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";
import { counter } from "./_h.mjs";
import { runActivationOneShot, parseArgs, classify, EXIT, acquireActivationAttemptLock } from "../src/authority-v3-activation-oneshot.mjs";

const { ok, done } = counter("oneshot");
const TMP = mkdtempSync(join(os.tmpdir(), "lai03b-lrr01-oneshot-"));
process.on("exit", () => { try { rmSync(TMP, { recursive: true, force: true }); } catch {} });
const IN_WINDOW = Date.parse("2026-10-08T00:00:00Z"), AT_EXPIRY = Date.parse("2026-10-13T22:44:42Z");
let n = 0;
function reqFile(obj) { const p = join(TMP, "req-" + (++n) + ".json"); writeFileSync(p, JSON.stringify(obj)); return p; }
const goodReq = () => ({ approvalEnvelope: { payload: { approval_id: "approval-v3-0001" }, signatureB64: "s".repeat(88) }, executionId: "execution-v3-0001", suppliedEvidence: {} });
const argv = (file, over = {}) => ["--run-id", over.runId || "lrr01-run-0001", "--request-file", file, "--confirm-execution-id", over.confirm || "execution-v3-0001"];
function fakeCompose(result, counters) {
  return () => ({ available: true, successorRuntimePinRef: "78804a8648e684bcdfb7d52dd34463310dec43c592fb2530216be19a04bc203d",
    boundary: Object.freeze({ available: true, async run(r) { counters.runs++; counters.last = r; if (result instanceof Error) throw result; return result; } }) });
}
const lockDir = () => join(TMP, "lock-" + (++n));

ok("O01 argv must be exactly the three flags", parseArgs(["--run-id", "lrr01-run-0001"]).reason === "argv_shape");
ok("O02 duplicate flag refused", parseArgs(["--run-id", "lrr01-run-0001", "--run-id", "lrr01-run-0002", "--confirm-execution-id", "execution-v3-0001"]).reason === "argv_shape");
ok("O03 invalid run id refused", parseArgs(["--run-id", "X", "--request-file", "f", "--confirm-execution-id", "execution-v3-0001"]).reason === "run_id_invalid");
{ const c = { runs: 0 }; const r = await runActivationOneShot(argv(reqFile({ ...goodReq(), extra: 1 })), { compose: fakeCompose({ ok: true, activated: true }, c), lockDir: lockDir(), nowMs: IN_WINDOW });
  ok("O04 request with an extra key ⇒ refused, boundary never run", r.code === EXIT.usage && c.runs === 0 && /request_shape_not_exact/.test(r.line)); }
{ const c = { runs: 0 }; const r = await runActivationOneShot(argv(reqFile(goodReq()), { confirm: "execution-v3-0002" }), { compose: fakeCompose({ ok: true, activated: true }, c), lockDir: lockDir(), nowMs: IN_WINDOW });
  ok("O05 confirm-execution-id mismatch ⇒ refused, boundary never run", r.code === EXIT.usage && c.runs === 0 && /execution_id_confirmation_mismatch/.test(r.line)); }
{ const p = reqFile(goodReq()); const l = join(TMP, "link-" + (++n) + ".json"); symlinkSync(p, l); const c = { runs: 0 };
  const r = await runActivationOneShot(argv(l), { compose: fakeCompose({ ok: true, activated: true }, c), lockDir: lockDir(), nowMs: IN_WINDOW });
  ok("O06 symlinked request file ⇒ refused", r.code === EXIT.usage && c.runs === 0 && /request_file_not_regular/.test(r.line)); }
{ const c = { runs: 0 }; const ld = lockDir(); const r = await runActivationOneShot(argv(reqFile(goodReq())), { compose: fakeCompose({ ok: true, activated: true }, c), lockDir: ld, nowMs: AT_EXPIRY });
  ok("O07 AT the frozen catalog expiry ⇒ refused before lock/composition/run (no T0 regeneration)", r.code === EXIT.refused && c.runs === 0 && /catalog_window_expired_hold/.test(r.line) && !existsSync(join(ld, "activation-attempt.lock"))); }
{ const c = { runs: 0 }; const r = await runActivationOneShot(argv(reqFile(goodReq())), { compose: () => ({ available: false, reason: "authority_v3_config_incomplete" }), lockDir: lockDir(), nowMs: IN_WINDOW });
  ok("O08 composition unavailable ⇒ refused (exit 3), nothing attempted", r.code === EXIT.refused && /"activationAttempted":false/.test(r.line)); }
{ const c = { runs: 0 }; const ld = lockDir();
  const r1 = await runActivationOneShot(argv(reqFile(goodReq())), { compose: fakeCompose({ ok: true, activated: true, stage: "V3_CATALOG_ACTIVATED_COMMITTED_AND_CORRELATED", approvalId: "approval-v3-0001", executionId: "execution-v3-0001", consumedAt: "2026-10-08T00:00:00Z" }, c), lockDir: ld, nowMs: IN_WINDOW });
  ok("O09 successful activation ⇒ exit 0, boundary run exactly once, request passed through unchanged", r1.code === EXIT.activated && c.runs === 1 && Object.keys(c.last).sort().join(",") === "approvalEnvelope,executionId,suppliedEvidence");
  const r2 = await runActivationOneShot(argv(reqFile(goodReq()), { runId: "lrr01-run-0002" }), { compose: fakeCompose({ ok: true, activated: true }, c), lockDir: ld, nowMs: IN_WINDOW });
  ok("O10 a SECOND attempt in the same deployment is refused by the one-shot lock (even after success)", r2.code === EXIT.usage && c.runs === 1 && /activation_already_attempted_in_this_deployment/.test(r2.line)); }
{ const c = { runs: 0 }; const ld = lockDir();
  const r = await runActivationOneShot(argv(reqFile(goodReq())), { compose: fakeCompose({ ok: false, activated: false, stage: "phase_b_correlation", reason: "committed_ledger_cardinality", uncertain: true }, c), lockDir: ld, nowMs: IN_WINDOW });
  ok("O11 ambiguous post-mutation outcome ⇒ exit 4 UNCERTAIN, run once, retried=false, autoRestored=false", r.code === EXIT.uncertain && c.runs === 1 && /UNCERTAIN_NO_RETRY_NO_AUTO_RESTORE/.test(r.line) && /"retried":false/.test(r.line) && /"autoRestored":false/.test(r.line));
  const again = await runActivationOneShot(argv(reqFile(goodReq()), { runId: "lrr01-run-0003" }), { compose: fakeCompose({ ok: true, activated: true }, c), lockDir: ld, nowMs: IN_WINDOW });
  ok("O12 after an UNCERTAIN outcome any further attempt is refused (no auto-retry)", again.code === EXIT.usage && c.runs === 1); }
{ const c = { runs: 0 }; const r = await runActivationOneShot(argv(reqFile(goodReq())), { compose: fakeCompose(new Error("boom"), c), lockDir: lockDir(), nowMs: IN_WINDOW });
  ok("O13 boundary throwing ⇒ treated as UNCERTAIN (exit 4), never retried", r.code === EXIT.uncertain && c.runs === 1); }
{ const c = { runs: 0 }; const r = await runActivationOneShot(argv(reqFile(goodReq())), { compose: fakeCompose({ ok: false, activated: false, stage: "approval", reason: "approval_rejected" }, c), lockDir: lockDir(), nowMs: IN_WINDOW });
  ok("O14 pre-mutation refusal (approval rejected) ⇒ exit 3, not uncertain", r.code === EXIT.refused && c.runs === 1); }
ok("O15 classify: uncertain flag always wins over refused", classify({ ok: false, uncertain: true }) === EXIT.uncertain && classify({ ok: false }) === EXIT.refused && classify({ ok: true, activated: true }) === EXIT.activated && classify(undefined) === EXIT.refused);
{ const ld = lockDir(); ok("O16 lock file is exclusive (O_EXCL) and never released", acquireActivationAttemptLock("lrr01-run-0009", ld).ok === true && acquireActivationAttemptLock("lrr01-run-0010", ld).ok === false
  && readFileSync(join(ld, "activation-attempt.lock"), "utf8") === "lrr01-run-0009\n"); }
{ const c = { runs: 0 }; const r = await runActivationOneShot(argv(reqFile(goodReq())), { compose: fakeCompose({ ok: true, activated: true, approvalId: "approval-v3-0001", executionId: "execution-v3-0001", consumedAt: "2026-10-08T00:00:00Z" }, c), lockDir: lockDir(), nowMs: IN_WINDOW });
  ok("O17 output line never echoes the approval envelope / signature", !r.line.includes("s".repeat(40)) && !r.line.includes("approvalEnvelope")); }

done();
