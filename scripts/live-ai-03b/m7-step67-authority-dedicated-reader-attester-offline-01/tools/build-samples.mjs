#!/usr/bin/env node
// OFFLINE review tool — produces SYNTHETIC sample receipts from REAL offline runs (loopback attesters, TEST-ONLY keys,
// synthetic clusters; the mock Railway CLI for the controller sample). The fingerprints inside are per-run TEST keys.
import { writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { makeDualEnv, kp } from "../tests/fixtures/dual-env.mjs";
import { makeMockRailway } from "../tests/fixtures/mock-railway.mjs";
import { runStep67Verification } from "../src/step67-verifier.mjs";
import { buildReceipt } from "../src/receipt.mjs";
import { runPhase } from "../controller/step67-controller.mjs";
import { phaseOf } from "../controller/future-live-phase-plan.mjs";
import { PACKAGE_ROOT } from "./import-closure.mjs";

async function step67(runId, over) {
  const E = await makeDualEnv(over);
  try {
    const startedUtc = new Date().toISOString();
    const r = await runStep67Verification(E.deps());
    const b = buildReceipt({ runId, startedUtc, finishedUtc: new Date().toISOString(), result: r, pins: E.pins });
    if (!b.ok) throw new Error(b.reason);
    return b.receipt;
  } finally { await E.close(); }
}
const pass = await step67("synthetic-offline-sample-pass", {});
const hold = await step67("synthetic-offline-sample-hold", { attesterIntervalUs: [-600000, 600000] });
// controller P0..P3 against the mock CLI; keep the P3 receipt (public issuer + new fingerprint only)
const M = makeMockRailway({});
const st = mkdtempSync(join(tmpdir(), "s67-sample-")), m5 = kp(), ex = kp();
const pkg = mkdtempSync(join(tmpdir(), "s67-sample-pkg-"));
const mtext = JSON.stringify({ files: [{ repoPath: "scripts/x.mjs", gitBlobSha1: "1".repeat(40) }] }) + "\n";
writeFileSync(join(pkg, "EVIDENCE-MANIFEST.json"), mtext); M.cfg.gitBlobs = [{ repoPath: "scripts/x.mjs", gitBlobSha1: "1".repeat(40) }];
let p3;
for (const phase of ["P0", "P1", "P2", "P3"]) {
  if (phase === "P2") M.ownerCreateDedicated();
  const cg = join(st, phase + "-cg.json");
  writeFileSync(cg, JSON.stringify({ schema: "staybid-programme-collision-check-result-v1", outcome: "CLEAR_OF_RECORDED_COLLISION", decision: "CLEAR_OF_RECORDED_COLLISION_ONLY",
    candidate: { actionId: phaseOf(phase).actionId }, liveAuthorization: "LIVE_AUTHORIZATION_NOT_GRANTED_BY_COLLISION_GUARD" }));
  const r = await runPhase({ phase, stateDir: st, runId: "synthetic-sample-" + phase.toLowerCase(), execute: true, ownerAuthorizationRef: "SYNTHETIC-SAMPLE-AUTH-" + phase,
    confirmActionId: phaseOf(phase).actionId, collisionGuardResultPath: cg, dedicatedServiceId: M.inst.dedicated && M.inst.dedicated.serviceId,
    reviewedCommit: "a".repeat(40), manifestSha256: createHash("sha256").update(mtext).digest("hex"), m5ReaderAttesterFingerprint: m5.fp, executorAttesterFingerprint: ex.fp },
    { runner: M.runner, packageRoot: pkg, wait: async () => {} });
  if (r.exit !== 0) throw new Error(phase + " " + r.text);
  p3 = r.receipt;
}
const note = "SYNTHETIC SAMPLE from an OFFLINE run (loopback attesters / mock Railway CLI, TEST-ONLY keys). Shape illustration only; grants no authorization.";
writeFileSync(join(PACKAGE_ROOT, "samples", "SAMPLE-STEP67-RECEIPT-PASS.synthetic.json"), JSON.stringify({ note, receipt: pass }, null, 2) + "\n");
writeFileSync(join(PACKAGE_ROOT, "samples", "SAMPLE-STEP67-RECEIPT-HOLD.synthetic.json"), JSON.stringify({ note, receipt: hold }, null, 2) + "\n");
writeFileSync(join(PACKAGE_ROOT, "samples", "SAMPLE-CONTROLLER-P3-RECEIPT.synthetic.json"), JSON.stringify({ note, receipt: p3 }, null, 2) + "\n");
console.log(pass.outcome, hold.outcome, hold.reason, p3.outcome);
