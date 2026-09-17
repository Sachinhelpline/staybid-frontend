#!/usr/bin/env node
/* eslint-disable no-console */
// ═════════════════════════════════════════════════════════════════════════
// LIVE-AI-03B-P1-06-FINAL-TEARDOWN-RESIDUAL-CLOSURE — §14 NEGATIVE MUTATIONS.
//   Run:  node tests/live-ai/live-ai-03b-teardown-negmut.test.js
//
// Each mutation REVERTS one part of the P1-06 FINAL TEARDOWN wiring in the REAL
// source, runs the deterministic 03B suite, and asserts it now FAILS (non-zero
// exit) — proving the teardown tests genuinely bind the fix. Every source file is
// restored byte-for-byte in a finally block. NO commit / push / network.
//   MUT-A  remove the 03B teardown from the runtime kill path.
//   MUT-B  remove the central teardown from the store onTerminate hook.
//   MUT-C  let a torn-down lifecycle keep its active03b entry (stale authority).
// ═════════════════════════════════════════════════════════════════════════
"use strict";
const path = require("path");
const fs = require("fs");
const cp = require("child_process");

const REPO = path.resolve(__dirname, "..", "..");
const SUITE = path.join(__dirname, "live-ai-03b.test.js");
const IDX = path.join(REPO, "server/voice-gateway/index.ts");

let pass = 0, fail = 0; const failures = [];
function ok(c, l) { if (c) { pass += 1; console.log("  ✓ " + l); } else { fail += 1; failures.push(l); console.error("  ✗ " + l); } }
function runSuite() { const r = cp.spawnSync(process.execPath, [SUITE], { cwd: REPO, encoding: "utf8" }); return { code: r.status, tail: (r.stdout || "").split("\n").slice(-3).join(" ") }; }

function mutation(name, file, find, replace, label) {
  const orig = fs.readFileSync(file, "utf8");
  let mutated = false;
  try {
    if (orig.indexOf(find) === -1) { ok(false, `${name} — mutation anchor found in source`); return; }
    ok(true, `${name} — mutation anchor found in source`);
    fs.writeFileSync(file, orig.replace(find, replace)); mutated = true;
    const { code } = runSuite();
    ok(code !== 0, `${name} — ${label} (reverted fix ⇒ suite FAILS, exit=${code})`);
  } finally {
    if (mutated) fs.writeFileSync(file, orig);
  }
  ok(fs.readFileSync(file, "utf8") === orig, `${name} — source restored byte-for-byte`);
}

console.log("• LIVE-AI-03B §14 TEARDOWN negative mutations (revert-a-fix ⇒ suite must fail)\n");
{
  const { code } = runSuite();
  ok(code === 0, `BASE — the unmutated 03B suite PASSES (exit=${code})`);
}

// ── MUT-A — 03B teardown removed from the runtime kill path ──────────────────
mutation(
  "MUT-A", IDX,
  "  const revoked03b = ctx.teardownAll03b();\n  const drained = ctx.store.drainAll();",
  "  const revoked03b = 0; /* MUT-A: teardownAll03b removed from kill */\n  const drained = ctx.store.drainAll();",
  "runtime kill no longer revokes active 03B lifecycles before drain",
);

// ── MUT-B — central teardown removed from the store onTerminate hook ─────────
mutation(
  "MUT-B", IDX,
  '      try { void teardown03b(s.gatewaySessionId, "session_terminated", { reconcile: true }); } catch { /* never break store teardown */ }',
  "      /* MUT-B: teardown03b removed from onTerminate */",
  "session termination (timeout / terminate / socket-close) no longer tears down active03b",
);

// ── MUT-C — a torn-down lifecycle keeps its active03b entry (stale authority) ─
mutation(
  "MUT-C", IDX,
  "    active03b.delete(gatewaySessionId);                        // bound memory — no retained-controller leak",
  "    /* MUT-C: active03b entry NOT removed — stale authority survives teardown */",
  "a torn-down lifecycle remains reachable so a late terminal can resume it",
);

console.log(`\n${fail === 0 ? "✅" : "❌"} LIVE-AI-03B §14 teardown negative mutations: ${pass} passed, ${fail} failed`);
if (fail !== 0) { console.error("\nFAILURES:\n" + failures.map((f) => "  - " + f).join("\n")); process.exit(1); }
process.exit(0);
