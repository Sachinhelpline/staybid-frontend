// ─────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B BOOTSTRAP §M1-R1(final §2/§7) — TRUST-STATE WRITER INVARIANT COVERAGE (OFFLINE). Node built-ins.
// A STATIC guard so no hidden same-family writer escapes review: it enumerates EVERY assignment to the
// generation-derived gate-eligibility (`gatePassedForGeneration`), the installed `authority`, and the boot
// `generation` in reader-bootstrap.mjs, and asserts:
//   • gate eligibility is bound ONLY to a captured generation SNAPSHOT (bootGen/startGen) or cleared to null —
//     NEVER to `generation.id` ("whatever generation is current now");
//   • authority is bound ONLY with `generation: startGen` (the acquisition's snapshot) or cleared to null;
//   • `generation` is (re)created ONLY via createBootGeneration() (init + the single invalidation rotation);
//   • the exact set of writer sites matches the reviewed inventory (a NEW writer changes the counts → fails).
// If this test fails, a new trust-state writer was added and MUST be re-reviewed against the M1-R1 invariant.
// ─────────────────────────────────────────────────────────────────────────
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(resolve(HERE, "..", "reader-bootstrap.mjs"), "utf8");
let pass = 0, fail = 0; const fails = [];
const ok = (n, c) => { if (c) pass++; else { fail++; fails.push(n); console.log("  FAIL:", n); } };

// collect RHS of every assignment (exclude comparisons/arrows), per variable
function assignments(varName) {
  const out = [];
  const re = new RegExp("(^|[^=!<>])\\b" + varName + "\\s*=\\s*([^;]+);", "g");
  let m;
  while ((m = re.exec(SRC)) !== null) {
    const rhs = m[2].trim();
    if (rhs.startsWith("=") || rhs.startsWith(">")) continue;   // skip == / => that slipped past
    out.push(rhs);
  }
  return out;
}

const gate = assignments("gatePassedForGeneration");
const auth = assignments("authority");
const gen = assignments("generation");

// ── THE core M1-R1 guard: gate eligibility is NEVER bound to the current generation ──
ok("1. NO `gatePassedForGeneration = generation.id` anywhere (never bind to the current generation)", !/gatePassedForGeneration\s*=\s*generation\.id/.test(SRC));

// ── gate eligibility RHS ∈ { null, bootGen, startGen } only ──
const GATE_ALLOWED = new Set(["null", "bootGen", "startGen"]);
ok("2. every gate-eligibility assignment binds a snapshot (bootGen/startGen) or null", gate.length > 0 && gate.every((r) => GATE_ALLOWED.has(r)));
ok("3. exactly one gate bind to bootGen (construction) and one to startGen (regate)", gate.filter((r) => r === "bootGen").length === 1 && gate.filter((r) => r === "startGen").length === 1);
ok("4. gate-eligibility writer count matches the reviewed inventory (2 null-init/invalidate + 2 regate-fail-null + 2 binds = 6)", gate.length === 6);

// ── authority RHS ∈ { null, an object binding generation: startGen } ──
ok("5. authority is only cleared to null or installed as an object", auth.every((r) => r === "null" || r.startsWith("{")));
ok("6. NO `authority = { ... generation: generation.id ... }` (authority binds the acquisition snapshot)", !/authority\s*=\s*\{[^;]*generation:\s*generation\.id/.test(SRC));
ok("7. the single authority install binds generation: startGen", auth.filter((r) => r.startsWith("{")).length === 1 && /authority\s*=\s*\{[^;]*generation:\s*startGen/.test(SRC));
ok("8. authority writer count matches the reviewed inventory (init null + invalidate null + install = 3)", auth.length === 3);

// ── generation (re)created ONLY via createBootGeneration() (init + invalidation rotation) ──
ok("9. generation is only (re)created via createBootGeneration()", gen.length > 0 && gen.every((r) => r === "createBootGeneration()"));
ok("10. generation is rotated exactly twice: init + the single invalidation", gen.length === 2);

// ── the invalidation callback clears BOTH gate eligibility and authority and rotates the generation ──
const inval = /onInvalid:\s*\(reason\)\s*=>\s*\{[\s\S]*?\}\)/.exec(SRC);
const invalBody = inval ? inval[0] : "";
ok("11. invalidation clears authority + gate eligibility, rotates generation, drops to WAITING_FOR_CLOCK", /authority\s*=\s*null/.test(invalBody) && /gatePassedForGeneration\s*=\s*null/.test(invalBody) && /generation\s*=\s*createBootGeneration\(\)/.test(invalBody) && /status\s*=\s*STATES\.WAITING_FOR_CLOCK/.test(invalBody));

// ── the final acquisition install and the regate bind are both preceded by a generation recheck ──
ok("12. regate binds only after a final synchronous generation recheck", /if\s*\(generation\.id\s*!==\s*startGen\)\s*return[\s\S]{0,120}gatePassedForGeneration\s*=\s*startGen/.test(SRC));
ok("13. acquisition install is guarded by stillCurrent() + monitor.healthy before binding authority", /if\s*\(!stillCurrent\(\)\s*\|\|\s*!monitor\.healthy\(monoNowUs\(\)\)\)\s*return[\s\S]{0,140}authority\s*=\s*\{/.test(SRC));

console.log("\n══════════════════════════════════════════════════════════");
console.log(`RESULT: ${pass} passed, ${fail} failed  (executed assertions: ${pass + fail})`);
if (fail > 0) { console.log("FAILURES:", fails.join(" | ")); console.log("gate:", JSON.stringify(gate), "auth:", JSON.stringify(auth), "gen:", JSON.stringify(gen)); process.exitCode = 1; }
else { console.log("OFFLINE TRUST-STATE WRITER INVARIANT COVERAGE (§M1-R1 final): PASS"); process.exitCode = 0; }
