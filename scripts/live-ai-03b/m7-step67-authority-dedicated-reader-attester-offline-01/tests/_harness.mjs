// TEST-ONLY harness. Offline; node built-ins only. Each test is an async function; a thrown error = FAIL.
import process from "node:process";
const tests = [];
export function test(id, name, fn) { tests.push({ id, name, fn }); }
export function eq(a, b, msg) { if (a !== b) throw new Error((msg || "eq") + ": expected " + JSON.stringify(b) + " got " + JSON.stringify(a)); }
export function ok(c, msg) { if (!c) throw new Error(msg || "assertion failed"); }
export function match(s, re, msg) { if (!re.test(String(s))) throw new Error((msg || "match") + ": " + JSON.stringify(s) + " !~ " + re); }
export async function run(file) {
  let pass = 0, failN = 0;
  for (const t of tests) {
    const t0 = Date.now();
    try { await t.fn(); pass++; console.log(`PASS ${t.id} ${t.name} (${Date.now() - t0}ms)`); }
    catch (e) { failN++; console.log(`FAIL ${t.id} ${t.name}: ${e && e.message}`); }
  }
  console.log("RESULT " + JSON.stringify({ file, pass, fail: failN, ids: tests.map((t) => t.id) }));
  process.exitCode = failN ? 1 : 0;
}
