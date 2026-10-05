#!/usr/bin/env node
// TEST-ONLY — runs every suite in a fresh node process; prints a per-suite and total count. OFFLINE.
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const SUITES = ["verifier-e2e.test.mjs", "config-and-plans.test.mjs", "controller.test.mjs", "static-audit.test.mjs"];
let pass = 0, fail = 0; const ids = []; const perSuite = [];
for (const s of SUITES) {
  const r = spawnSync(process.execPath, [join(HERE, s)], { encoding: "utf8", timeout: 600000 });
  process.stdout.write(r.stdout);
  const line = (r.stdout || "").split("\n").find((l) => l.startsWith("RESULT "));
  if (!line || r.status !== 0) { fail += line ? JSON.parse(line.slice(7)).fail : 1; if (!line) console.log("SUITE CRASHED " + s + " " + (r.stderr || "").slice(0, 400)); }
  if (line) { const j = JSON.parse(line.slice(7)); pass += j.pass; if (r.status === 0) fail += j.fail; ids.push(...j.ids); perSuite.push({ suite: s, pass: j.pass, fail: j.fail }); }
}
const dup = ids.filter((x, i) => ids.indexOf(x) !== i);
console.log("TOTAL " + JSON.stringify({ suites: perSuite, pass, fail, distinctTests: new Set(ids).size, duplicateIds: dup }));
process.exitCode = fail || dup.length ? 1 : 0;
