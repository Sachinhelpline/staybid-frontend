#!/usr/bin/env node
/* eslint-disable no-console */
// ═════════════════════════════════════════════════════════════════════════
// LIVE-AI-03B-ROOT-CAUSE-RESIDUAL-CLOSURE — §21 NEGATIVE MUTATIONS (A/B/C).
//   Run:  node tests/live-ai/live-ai-03b-p1-negmut.test.js
//
// Each mutation REVERTS exactly one of the three root-cause fixes in the REAL
// source, runs the deterministic 03B suite, and asserts the suite now FAILS
// (non-zero exit) — proving the tests genuinely bind the fix. Every source file
// is restored byte-for-byte in a finally block (even on crash). NO commit / push
// / network — pure local source toggling.
//   MUT-A  P1-08 — drop the strict assistant-role requirement.
//   MUT-B  P1-07 — re-introduce the epoch/monotonic clock split at beginTurn.
//   MUT-C  P1-06 — make the controller call loop.acknowledgeDispatch DIRECTLY
//                  (the exact bypass of the released-03A lifecycle).
// ═════════════════════════════════════════════════════════════════════════
"use strict";
const path = require("path");
const fs = require("fs");
const cp = require("child_process");

const REPO = path.resolve(__dirname, "..", "..");
const SUITE = path.join(__dirname, "live-ai-03b.test.js");
const RESP_FILE = path.join(REPO, "server/voice-gateway/openai-responses.ts");
const CTRL_FILE = path.join(REPO, "server/voice-gateway/live-ai-03b-controller.ts");

let pass = 0, fail = 0; const failures = [];
function ok(c, l) { if (c) { pass += 1; console.log("  ✓ " + l); } else { fail += 1; failures.push(l); console.error("  ✗ " + l); } }

function runSuite() {
  const r = cp.spawnSync(process.execPath, [SUITE], { cwd: REPO, encoding: "utf8" });
  return { code: r.status, tail: (r.stdout || "").split("\n").slice(-4).join(" ") + (r.stderr || "") };
}

// Apply one string replacement to a file; assert it actually changed something; run the suite; restore.
function mutation(name, file, find, replace, label) {
  const orig = fs.readFileSync(file, "utf8");
  let mutated = false;
  try {
    if (orig.indexOf(find) === -1) { ok(false, `${name} — target present in source (mutation anchor found)`); return; }
    ok(true, `${name} — mutation anchor found in source`);
    const next = orig.replace(find, replace);
    if (next === orig) { ok(false, `${name} — mutation changed the source`); return; }
    fs.writeFileSync(file, next); mutated = true;
    const { code, tail } = runSuite();
    ok(code !== 0, `${name} — ${label} (reverted fix ⇒ suite FAILS, exit=${code})`);
    if (code === 0) console.error("    [unexpected PASS] " + tail);
  } finally {
    if (mutated) fs.writeFileSync(file, orig); // restore byte-for-byte
  }
  // prove restoration
  ok(fs.readFileSync(file, "utf8") === orig, `${name} — source restored byte-for-byte`);
}

console.log("• LIVE-AI-03B §21 negative mutations (revert-a-fix ⇒ suite must fail)\n");

// Baseline: the unmutated suite MUST pass (guards against a false "caught" from an unrelated break).
{
  const { code } = runSuite();
  ok(code === 0, `BASE — the unmutated 03B suite PASSES (exit=${code})`);
}

// ── MUT-A — P1-08 assistant-role requirement removed ────────────────────────
mutation(
  "MUT-A",
  RESP_FILE,
  '      if (role !== "assistant") return { kind: "MALFORMED_RESPONSE" };\n',
  "      /* MUT-A: assistant-role requirement removed */\n",
  "a message with a missing/foreign role is wrongly accepted",
);

// ── MUT-B — P1-07 one-clock-domain reverted (beginTurn back on epoch now()) ──
mutation(
  "MUT-B",
  CTRL_FILE,
  "      const nowMs = monoNow();\n      const first = deps.loop.beginTurn({",
  "      const nowMs = deps.now();\n      const first = deps.loop.beginTurn({",
  "beginTurn anchored on epoch Date.now while the deadline is monotonic",
);

// ── MUT-C — P1-06 released-03A bypass (controller calls the loop DIRECTLY) ───
mutation(
  "MUT-C",
  CTRL_FILE,
  "      let acc: AcceptOutcome;\n      try { acc = execution.acceptAction({ accepted }); }",
  "      let acc: AcceptOutcome;\n      try { deps.loop.acknowledgeDispatch({ nowMs: monoNow(), accepted }); acc = execution.acceptAction({ accepted }); }",
  "the controller bypasses 03A by acknowledging the dispatch directly on the loop",
);

console.log(`\n${fail === 0 ? "✅" : "❌"} LIVE-AI-03B §21 negative mutations: ${pass} passed, ${fail} failed`);
if (fail !== 0) { console.error("\nFAILURES:\n" + failures.map((f) => "  - " + f).join("\n")); process.exit(1); }
process.exit(0);
