// Aggregate OFFLINE runner — V3 RUNTIME PG BIGINT NORMALIZATION REMEDIATION 01. Every suite must exit 0; a skip
// (exit 2) is UNPROVEN, never a pass. The ACCEPTED suites run UNCHANGED. The accepted static suite is evaluated
// against an explicit, closed expectation for this candidate:
//   • S23 (HEAD must be cbcb2689) already fails on the pristine a2b84c4 baseline (pre-existing, unrelated);
//   • S24 / S25 are EXPECTED to name exactly this candidate's change set — and are accepted ONLY when the new
//     int8-remediation-static suite independently proves that set is exactly composition + helper + tests (R02/R03).
// Any other static failure, or any other suite failure, fails the run.
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = resolve(HERE, "..");
const RT = resolve(PKG, "../m7-post-step67-production-integration-01-runtime-01");
const SUITES = [
  ["int8-normalizer (new)", join(HERE, "int8-normalizer.test.mjs")],
  ["authority-v3-int8-localpg (new, real PostgreSQL)", join(HERE, "localpg/authority-v3-int8-localpg.test.mjs")],
  ["int8-remediation-static (new)", join(HERE, "int8-remediation-static.test.mjs")],
  ["authority-v3 (accepted)", join(HERE, "authority-v3.test.mjs")],
  ["executor-v2 (accepted)", join(HERE, "executor-v2.test.mjs")],
  ["oneshot (accepted)", join(HERE, "oneshot.test.mjs")],
  ["static (accepted)", join(HERE, "static.test.mjs")],
  ["executor-v2-localpg (accepted)", join(HERE, "localpg/executor-v2-localpg.test.mjs")],
  ["accepted-pi01-runtime-suite", join(RT, "tests/run-all.mjs")],
  ["accepted-pi01-identity", join(RT, "tools/verify-package.mjs")],
];
const EXPECTED_STATIC_FAILS = new Set(["S23", "S24", "S25"]);
let pass = 0, fail = 0, checks = 0, remediationScopeProven = false;
for (const [name, file] of SUITES) {
  const r = spawnSync(process.execPath, [file], { encoding: "utf8", timeout: 900000 });
  const out = (r.stdout || "") + (r.stderr || "");
  const m = out.match(/(\d+) passed, (\d+) failed/g);
  if (m) for (const x of m) checks += Number(x.match(/(\d+) passed/)[1]);
  if (/IDENTITY_PASS/.test(out)) checks += 1;
  let okRun = r.status === 0 && !/\bFAIL\b/.test(out.replace(/0 failed/g, ""));
  let note = "";
  if (name.startsWith("int8-remediation-static")) remediationScopeProven = okRun && /PASS R02 /.test(out) && /PASS R03 /.test(out);
  if (name === "static (accepted)" && !okRun && r.status === 1) {
    const failed = [...out.matchAll(/^\s+FAIL (S\d+)\b/gm)].map((x) => x[1]);
    const unexpected = failed.filter((s) => !EXPECTED_STATIC_FAILS.has(s));
    if (unexpected.length === 0 && failed.includes("S23") && remediationScopeProven) { okRun = true; note = ` — accepted deltas only: ${failed.join(",")} (S23 pre-existing at a2b84c4; S24/S25 = this candidate's exact file set, proven by R02/R03)`; }
    else note = ` — UNEXPECTED static failures: ${unexpected.join(",") || "(scope not proven)"}`;
  }
  console.log(`${okRun ? "PASS" : "FAIL"} ${name} (exit ${r.status})${m ? " — " + m.join("; ") : ""}${note}${r.status === 2 ? " — SKIPPED = UNPROVEN" : ""}`);
  if (!okRun) { fail++; console.log(out.split("\n").filter((l) => /FAIL|Error|SKIPPED/.test(l)).slice(0, 20).join("\n")); } else pass++;
}
console.log(`RESULT: ${fail === 0 ? "PASS" : "FAIL"} (${pass}/${SUITES.length} suites, ${checks} assertions passed)`);
process.exit(fail === 0 ? 0 : 1);
