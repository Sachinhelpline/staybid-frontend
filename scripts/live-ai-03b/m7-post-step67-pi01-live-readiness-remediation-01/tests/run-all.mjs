// Aggregate OFFLINE runner. Every required suite must exit 0; a PostgreSQL skip (exit 2) is UNPROVEN, never a pass.
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = resolve(HERE, "..");
const RT = resolve(PKG, "../m7-post-step67-production-integration-01-runtime-01");
const SUITES = [
  ["authority-v3", join(HERE, "authority-v3.test.mjs")],
  ["executor-v2", join(HERE, "executor-v2.test.mjs")],
  ["oneshot", join(HERE, "oneshot.test.mjs")],
  ["static", join(HERE, "static.test.mjs")],
  ["executor-v2-localpg", join(HERE, "localpg/executor-v2-localpg.test.mjs")],
  ["accepted-pi01-runtime-suite", join(RT, "tests/run-all.mjs")],
  ["accepted-pi01-identity", join(RT, "tools/verify-package.mjs")],
];
let pass = 0, fail = 0, checks = 0;
for (const [name, file] of SUITES) {
  const r = spawnSync(process.execPath, [file], { encoding: "utf8", timeout: 600000 });
  const out = (r.stdout || "") + (r.stderr || "");
  const m = out.match(/(\d+) passed, (\d+) failed/g);
  if (m) for (const x of m) { const [, p] = x.match(/(\d+) passed/); checks += Number(p); }
  if (/IDENTITY_PASS/.test(out)) checks += 1;
  const okRun = r.status === 0 && !/\bFAIL\b/.test(out.replace(/0 failed/g, ""));
  console.log(`${okRun ? "PASS" : "FAIL"} ${name} (exit ${r.status})${m ? " — " + m.join("; ") : ""}${r.status === 2 ? " — SKIPPED = UNPROVEN" : ""}`);
  if (!okRun) { fail++; console.log(out.split("\n").filter((l) => /FAIL|Error|SKIPPED/.test(l)).slice(0, 20).join("\n")); } else pass++;
}
console.log(`RESULT: ${fail === 0 ? "PASS" : "FAIL"} (${pass}/${SUITES.length} suites, ${checks} assertions passed)`);
process.exit(fail === 0 ? 0 : 1);
