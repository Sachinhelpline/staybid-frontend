// ─────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B BOOTSTRAP §26 — FROZEN-PREDECESSOR PRESERVATION (OFFLINE). Node built-ins only.
// The bootstrap milestone REUSES accepted predecessor modules and must NEVER edit them. This test pins the exact
// SHA-256 of every frozen dependency the candidate imports; any byte change to a frozen file fails the gate. It
// also asserts the candidate imports those modules by RELATIVE path (composition, not a fork) and that no frozen
// file lives inside the candidate directory. Hashes recorded at candidate authoring (baseline HEAD 3b9458a0).
// ─────────────────────────────────────────────────────────────────────────
import { readFileSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const CAND = resolve(HERE, "..");                 // the candidate directory
const L03B = resolve(CAND, "..");                 // scripts/live-ai-03b
let pass = 0, fail = 0; const fails = [];
const ok = (n, c) => { if (c) pass++; else { fail++; fails.push(n); console.log("  FAIL:", n); } };
const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");

// Frozen accepted dependencies (path relative to scripts/live-ai-03b → pinned SHA-256).
const FROZEN = {
  "private-reader-attester-offline-01/signing-adapter.mjs": "741bc14b3e634c7b657c05c2b6d3b42c67f047c606453ed6a3fb266cb39d2e65",
  "private-reader-attester-offline-01/target-binding.mjs": "6ea5cde145d8db68286bbde8dc30cbf13040ba2b32c09bb1905e1170945215b0",
  "private-reader-attester-offline-01/observer-connection.mjs": "37b9672535291e5444bd6b10aea8700be1782bc310a877bbf707ba731015c1cc",
  "private-reader-attester-offline-01/evidence-queries.mjs": "05bf3e2895b0cb52ac5c575f7de69127e1b9e5f7ad159b938027c46714ed667e",
  "private-reader-attester-offline-01/evidence-evaluator.mjs": "c79e7177d2ef481960d87c6a657d87f41fa1d7a0d09ff04924b1d31aea47c8e2",
  "private-reader-attester-offline-01/tests/fixtures/synthetic-cluster.mjs": "7cceb6600dd522572a7733273c41df931d286931cae6ecdd4e91426fb9d637ed",
  "private-reader-production-integration-offline-01/reader-attestation.mjs": "42964752dcb7035abddd7decd6ea40a7c27321112f96176379c8983ce72b3d5e",
  "private-reader-production-integration-offline-01/reader-session.mjs": "064021ba88e39da431249a4b5b86a2313a787c7b1c35f0190587270741b1d011",
  "private-reader-production-integration-offline-01/attestation-source-channel.mjs": "eb484e7a558de4fc59883718340e98bc6489acefdf53d295e41df9b96a8306ed",
  "private-reader-host-runtime-offline-01/observation-transport.mjs": "06c01348d20c3e8b118b74aae086e24de8945e7ab043df4d4715eff21b4f6ca3",
  // newly reused by the M1-R2 production composition (byte-unchanged accepted contracts)
  "trusted-activation-boundary-01/pricing-approval-contract.mjs": "59ef03ea3b0532100cf59c19a7f4f174543a4dea0e688359ced858e974312ad3",
  "trusted-executor-runtime-01/runtime-config.mjs": "c0035996b6fcf3a36a402d220ac1559bdcb8cdf2f943d72deaa714c72ec197ae",
};

// candidate source files that import predecessors (must reference them by relative path, never copy them in)
const CAND_SRC = [
  "clock-interval.mjs", "db-clock-probe.mjs", "clock-gate.mjs", "private-peer-resolver.mjs",
  "attestation-channel-v2.mjs", "bootstrap-state.mjs", "reader-bootstrap.mjs", "attester-bootstrap.mjs",
  "bootstrap-entrypoint-reader.mjs", "bootstrap-entrypoint-attester.mjs",
  "production-config.mjs", "production-db-clock.mjs", "production-reader.mjs", "production-attester.mjs",
];

function run() {
  // ── A. every frozen dependency is byte-unchanged ──
  for (const [rel, want] of Object.entries(FROZEN)) {
    const got = sha(resolve(L03B, rel));
    ok(`A. frozen unchanged: ${rel}`, got === want);
  }

  // ── B. the candidate references the predecessors by relative path (composition) ──
  const allSrc = CAND_SRC.map((f) => readFileSync(resolve(CAND, f), "utf8")).join("\n");
  const fixtureSrc = readFileSync(resolve(CAND, "tests/fixtures/synthetic-env.mjs"), "utf8");
  ok("B1. test fixture reuses the accepted signer + synthetic cluster (not forked)", fixtureSrc.includes("../../../private-reader-attester-offline-01/signing-adapter.mjs") && fixtureSrc.includes("../../../private-reader-attester-offline-01/tests/fixtures/synthetic-cluster.mjs"));
  ok("B2. candidate imports the accepted reader-attestation verifier", allSrc.includes("../private-reader-production-integration-offline-01/reader-attestation.mjs"));
  ok("B3. candidate imports the accepted observer coordinator", allSrc.includes("../private-reader-attester-offline-01/observer-connection.mjs"));
  ok("B4. candidate imports the accepted evidence evaluator", allSrc.includes("../private-reader-attester-offline-01/evidence-evaluator.mjs"));
  ok("B5. candidate imports the accepted target binding", allSrc.includes("../private-reader-attester-offline-01/target-binding.mjs"));
  ok("B6. candidate imports the accepted channel constants", allSrc.includes("../private-reader-production-integration-offline-01/attestation-source-channel.mjs"));
  ok("B7. candidate imports the accepted private ranges", allSrc.includes("../private-reader-host-runtime-offline-01/observation-transport.mjs"));

  // ── C. no frozen predecessor file was copied INTO the candidate directory ──
  const frozenBasenames = new Set(Object.keys(FROZEN).map((p) => p.split("/").pop()));
  let copies = [];
  (function walk(dir) {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e); const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else if (frozenBasenames.has(e)) copies.push(p.replace(CAND + "/", ""));
    }
  })(CAND);
  ok("C1. no frozen predecessor basename duplicated inside the candidate", copies.length === 0 || (console.log("   copies:", copies), false));

  // ── D. the candidate does not reach outside scripts/live-ai-03b (no external repo edits) ──
  ok("D1. candidate imports stay within live-ai-03b or node built-ins", !/from "\.\.\/\.\.\/\.\.\//.test(allSrc) && !/from "\/(?!home)/.test(allSrc));

  console.log("\n══════════════════════════════════════════════════════════");
  console.log(`RESULT: ${pass} passed, ${fail} failed  (executed assertions: ${pass + fail})`);
  if (fail > 0) { console.log("FAILURES:", fails.join(" | ")); process.exitCode = 1; return; }
  console.log("OFFLINE FROZEN-PREDECESSOR PRESERVATION (§26): PASS");
  process.exitCode = 0;
}
run();
