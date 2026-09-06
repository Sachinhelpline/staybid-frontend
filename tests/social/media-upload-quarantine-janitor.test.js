#!/usr/bin/env node
/* eslint-disable no-console */
// ─────────────────────────────────────────────────────────────────────────
// SEC-00B-P1G-2 — hermetic worker test for the quarantine STORAGE janitor.
//   Run: node tests/social/media-upload-quarantine-janitor.test.js
// ZERO live network / Supabase / Storage. Compiles the REAL
// lib/social/quarantine-janitor.ts + quarantine-janitor-store.ts with the lockfile
// tsc into an OS TEMP dir, then drives the REAL worker (runQuarantineJanitor) +
// REAL store (createQuarantineJanitorStore) against an INJECTED Supabase-like
// double (rpc claim/complete + storage remove). Proves W1–W20: the dormant gate,
// service-role config, exact claim validation, exact one-object delete +
// explicit acknowledgement, delete-before-complete order, conservative
// missing/ambiguous handling, and counts-only output. Exit code set AFTER cleanup.
// ─────────────────────────────────────────────────────────────────────────
const path = require("path"), fs = require("fs"), os = require("os"), cp = require("child_process"), crypto = require("crypto");
const REPO = path.resolve(__dirname, "..", "..");
const REPO_NM = path.join(REPO, "node_modules");
let pass = 0, fail = 0, fatal = null; const failures = [];
function ok(c, l) { if (c) pass += 1; else { fail += 1; failures.push(l); console.error("  ✗ " + l); } }
function eqv(a, b, l) { ok(a === b, `${l} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`); }
function section(n) { console.log("\n• " + n); }

const BUCKET = "social-media-quarantine";
const RPC_CLAIM = "claim_media_upload_quarantine_cleanup";
const RPC_COMPLETE = "complete_media_upload_quarantine_cleanup";
const uuid = () => crypto.randomUUID(); // canonical lowercase v4
const keyFor = (id) => "sessions/" + id + "/raw";
const claimRow = (id, over = {}) => ({ session_id: id, quarantine_bucket: BUCKET, object_key: keyFor(id), ...over });

// Injected Supabase-like double for the REAL store.
//   plan.claim    : {data,error} for the claim rpc (required)
//   plan.remove   : {data,error} OR (paths,bucket)=>({data,error})   (default: 1-item ack)
//   plan.complete : {data,error} OR (sessionId)=>({data,error})      (default: completed)
function fakeSupabase(plan) {
  const cap = (plan.cap = plan.cap || { rpcCalls: [], removeCalls: [] });
  return {
    rpc: async (fn, params) => {
      cap.rpcCalls.push({ fn, params });
      if (fn === RPC_CLAIM) return plan.claim || { data: [], error: null };
      if (fn === RPC_COMPLETE) {
        const cr = typeof plan.complete === "function" ? plan.complete(params && params.p_session_id) : plan.complete;
        return cr || { data: { outcome: "completed" }, error: null };
      }
      cap.unknownRpc = fn;
      return { data: null, error: { message: "unknown_rpc" } };
    },
    storage: {
      from: (bucket) => ({
        remove: async (paths) => {
          cap.removeCalls.push({ bucket, paths });
          const rr = typeof plan.remove === "function" ? plan.remove(paths, bucket) : plan.remove;
          return rr || { data: [{ name: paths[0] }], error: null };
        },
      }),
    },
  };
}
const completeRpcCount = (cap) => cap.rpcCalls.filter((c) => c.fn === RPC_COMPLETE).length;
const claimRpcCount = (cap) => cap.rpcCalls.filter((c) => c.fn === RPC_CLAIM).length;

async function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "staybid-p1g2-"));
  try {
    const SRC = path.join(tempRoot, "src"), OUT = path.join(tempRoot, "out");
    fs.mkdirSync(SRC, { recursive: true });
    fs.copyFileSync(path.join(REPO, "lib/social/quarantine-janitor.ts"), path.join(SRC, "quarantine-janitor.ts"));
    fs.copyFileSync(path.join(REPO, "lib/social/quarantine-janitor-store.ts"), path.join(SRC, "quarantine-janitor-store.ts"));
    fs.writeFileSync(path.join(SRC, "tsconfig.json"), JSON.stringify({
      compilerOptions: {
        module: "commonjs", target: "es2020", lib: ["es2020", "dom"], moduleResolution: "node",
        strict: true, esModuleInterop: true, skipLibCheck: true, ignoreDeprecations: "6.0",
        baseUrl: REPO, typeRoots: [path.join(REPO, "node_modules/@types")], types: ["node"],
        paths: { "*": ["node_modules/*"] }, rootDir: ".", outDir: "../out", noEmitOnError: true,
      },
      include: ["*.ts"],
    }));
    let TSC; try { TSC = require.resolve("typescript/bin/tsc", { paths: [REPO] }); } catch { throw new Error("COMPILE GATE FAILED — local tsc not installed."); }
    const compile = cp.spawnSync(process.execPath, [TSC, "-p", path.join(SRC, "tsconfig.json")], { cwd: REPO, encoding: "utf8" });
    if (compile.status !== 0) throw new Error("COMPILE GATE FAILED:\n" + (compile.stdout || "") + (compile.stderr || ""));
    console.log("• Local tsc compile: exit 0, clean (strict) — worker + STORE");

    process.env.NODE_PATH = REPO_NM;
    require("module").Module._initPaths();

    const P = require(path.join(OUT, "quarantine-janitor.js"));
    const ST = require(path.join(OUT, "quarantine-janitor-store.js"));

    const ENABLED = { MEDIA_QUARANTINE_JANITOR_ENABLED: "true" };
    // Real store bound to an injected fake supabase (service key present).
    const mkStore = (plan) => ST.createQuarantineJanitorStore({ SUPABASE_SERVICE_ROLE_KEY: "svc" }, { client: fakeSupabase(plan) });

    // ── W1 — flag disabled → ZERO claim/storage/complete ────────────────
    section("W1 activation gate (dormant by default)");
    for (const flag of [undefined, "", "false", "1", "yes", "TRUE-ish"]) {
      const plan = {}; const store = mkStore(plan);
      const env = flag === undefined ? {} : { MEDIA_QUARANTINE_JANITOR_ENABLED: flag };
      const r = await P.runQuarantineJanitor({ store, env });
      eqv(r.status, "disabled", `flag=${JSON.stringify(flag)} -> disabled`);
      eqv(plan.cap.rpcCalls.length, 0, `flag=${JSON.stringify(flag)} ZERO rpc`);
      eqv(plan.cap.removeCalls.length, 0, `flag=${JSON.stringify(flag)} ZERO storage`);
    }
    { const r = await P.runQuarantineJanitor({ store: mkStore({ claim: { data: [], error: null } }), env: ENABLED }); eqv(r.status, "ok", "flag=true enables (ok, empty batch)"); }

    // ── W2 — store unconfigured → fail closed, ZERO work ────────────────
    section("W2 store unconfigured");
    { const store = ST.createQuarantineJanitorStore({ SUPABASE_SERVICE_ROLE_KEY: undefined }); // no injected client, no key
      const r = await P.runQuarantineJanitor({ store, env: ENABLED });
      eqv(r.status, "unconfigured", "unconfigured store -> unconfigured"); }
    ok(ST.createQuarantineJanitorStore({ SUPABASE_SERVICE_ROLE_KEY: "" }).configured() === false, "blank key -> not configured");
    ok(ST.createQuarantineJanitorStore({ SUPABASE_SERVICE_ROLE_KEY: "   " }).configured() === false, "whitespace key -> not configured");
    ok(ST.createQuarantineJanitorStore({ SUPABASE_SERVICE_ROLE_KEY: "svc" }).configured() === true, "present key -> configured");

    // ── W3 — claim provider failure → service_unavailable, ZERO delete ──
    section("W3 claim provider failure");
    { const plan = { claim: { data: null, error: { message: "boom" } } }; const store = mkStore(plan);
      const r = await P.runQuarantineJanitor({ store, env: ENABLED });
      eqv(r.status, "service_unavailable", "claim error -> service_unavailable");
      eqv(plan.cap.removeCalls.length, 0, "no storage delete on claim failure");
      eqv(completeRpcCount(plan.cap), 0, "no completion on claim failure"); }

    // ── W4 — one valid canonical claim → delete + ack + complete ────────
    section("W4 valid canonical claim -> delete + complete");
    { const id = uuid(); const plan = { claim: { data: [claimRow(id)], error: null } }; const store = mkStore(plan);
      const r = await P.runQuarantineJanitor({ store, env: ENABLED });
      eqv(r.status, "ok", "ok"); eqv(r.counts.claimed, 1, "claimed 1"); eqv(r.counts.deleteConfirmed, 1, "deleteConfirmed 1");
      eqv(r.counts.completed, 1, "completed 1"); eqv(r.counts.invalidClaims, 0, "invalid 0");
      eqv(plan.cap.removeCalls.length, 1, "exactly one storage remove");
      eqv(plan.cap.removeCalls[0].bucket, BUCKET, "remove uses server constant bucket");
      eqv(JSON.stringify(plan.cap.removeCalls[0].paths), JSON.stringify([keyFor(id)]), "remove one-element exact key array");
      eqv(completeRpcCount(plan.cap), 1, "exactly one completion rpc");
      eqv(plan.cap.rpcCalls.find((c) => c.fn === RPC_COMPLETE).params.p_session_id, id, "complete sends p_session_id only"); }

    // ── W5 — wrong bucket → no delete, no complete, invalid counted ─────
    section("W5 wrong bucket");
    { const id = uuid(); const plan = { claim: { data: [claimRow(id, { quarantine_bucket: "evil-bucket" })], error: null } }; const store = mkStore(plan);
      const r = await P.runQuarantineJanitor({ store, env: ENABLED });
      eqv(r.counts.invalidClaims, 1, "invalid 1"); eqv(r.counts.deleteConfirmed, 0, "no delete confirmed");
      eqv(plan.cap.removeCalls.length, 0, "no storage remove"); eqv(completeRpcCount(plan.cap), 0, "no completion"); }

    // ── W6 — wrong object key → no delete, no complete ──────────────────
    section("W6 wrong object key");
    { const id = uuid(); const plan = { claim: { data: [claimRow(id, { object_key: "sessions/" + id + "/evil" })], error: null } }; const store = mkStore(plan);
      const r = await P.runQuarantineJanitor({ store, env: ENABLED });
      eqv(r.counts.invalidClaims, 1, "invalid 1"); eqv(plan.cap.removeCalls.length, 0, "no storage remove"); eqv(completeRpcCount(plan.cap), 0, "no completion"); }
    // extra: traversal / double slash / prefix variants also rejected
    for (const [l, k] of [["traversal", "sessions/../raw"], ["double slash", "sessions//raw"], ["prefix", "x/sessions/ID/raw"], ["suffix", "sessions/ID/raw.jpg"]]) {
      const id = uuid(); const badKey = k.replace("ID", id); const plan = { claim: { data: [claimRow(id, { object_key: badKey })], error: null } }; const store = mkStore(plan);
      const r = await P.runQuarantineJanitor({ store, env: ENABLED });
      eqv(r.counts.invalidClaims, 1, `${l} key -> invalid`); eqv(plan.cap.removeCalls.length, 0, `${l} key -> no remove`);
    }

    // ── W7 — non-canonical / wrong-version / uppercase session id ───────
    section("W7 non-canonical session UUID");
    for (const [l, bad] of [
      ["not a uuid", "not-a-uuid"],
      ["uppercase", uuid().toUpperCase()],
      ["v1 (wrong version)", "11111111-1111-1111-8111-111111111111"],
      ["wrong variant", "11111111-1111-4111-1111-111111111111"],
      ["truncated", "1234"],
      ["empty", ""],
    ]) {
      const plan = { claim: { data: [{ session_id: bad, quarantine_bucket: BUCKET, object_key: "sessions/" + bad + "/raw" }], error: null } }; const store = mkStore(plan);
      const r = await P.runQuarantineJanitor({ store, env: ENABLED });
      eqv(r.counts.invalidClaims, 1, `${l} -> invalid`); eqv(plan.cap.removeCalls.length, 0, `${l} -> no remove`); eqv(completeRpcCount(plan.cap), 0, `${l} -> no complete`);
    }

    // ── W8..W12 — delete NOT confirmed → NO completion ──────────────────
    section("W8-W12 delete-ack fail-safe (no completion)");
    for (const [l, removeRes] of [
      ["W8 storage error", { data: null, error: { message: "x" } }],
      ["W9 null data", { data: null, error: null }],
      ["W10 empty array", { data: [], error: null }],
      ["W11 non-array data", { data: { name: "sessions/x/raw" }, error: null }],
      ["W12 multiple entries", { data: [{ name: "a" }, { name: "b" }], error: null }],
    ]) {
      const id = uuid(); const plan = { claim: { data: [claimRow(id)], error: null }, remove: removeRes }; const store = mkStore(plan);
      const r = await P.runQuarantineJanitor({ store, env: ENABLED });
      eqv(r.counts.deleteConfirmed, 0, `${l}: not confirmed`); eqv(r.counts.deleteRetryable, 1, `${l}: retryable`);
      eqv(r.counts.completed, 0, `${l}: not completed`); eqv(completeRpcCount(plan.cap), 0, `${l}: completion NOT called`);
      eqv(plan.cap.removeCalls.length, 1, `${l}: exactly one delete attempt`);
    }

    // ── W13 — confirmed delete + completion state_conflict ──────────────
    section("W13 confirmed delete + completion state_conflict");
    { const id = uuid(); const plan = { claim: { data: [claimRow(id)], error: null }, complete: { data: { outcome: "state_conflict" }, error: null } }; const store = mkStore(plan);
      const r = await P.runQuarantineJanitor({ store, env: ENABLED });
      eqv(r.counts.deleteConfirmed, 1, "deleteConfirmed 1"); eqv(r.counts.completionConflicts, 1, "conflict 1"); eqv(r.counts.completed, 0, "completed 0");
      eqv(plan.cap.removeCalls.length, 1, "delete once (no repeat)"); eqv(completeRpcCount(plan.cap), 1, "completion once"); }

    // ── W14 — confirmed delete + completion provider error ──────────────
    section("W14 confirmed delete + completion error (not fabricated)");
    { const id = uuid(); const plan = { claim: { data: [claimRow(id)], error: null }, complete: { data: null, error: { message: "down" } } }; const store = mkStore(plan);
      const r = await P.runQuarantineJanitor({ store, env: ENABLED });
      eqv(r.counts.deleteConfirmed, 1, "deleteConfirmed 1"); eqv(r.counts.completionErrors, 1, "completionErrors 1"); eqv(r.counts.completed, 0, "completed NOT fabricated");
      eqv(plan.cap.removeCalls.length, 1, "delete once (no second delete)"); eqv(completeRpcCount(plan.cap), 1, "completion attempted once"); }
    // unknown completion outcome is also a (safe) completion error
    { const id = uuid(); const plan = { claim: { data: [claimRow(id)], error: null }, complete: { data: { outcome: "weird" }, error: null } }; const store = mkStore(plan);
      const r = await P.runQuarantineJanitor({ store, env: ENABLED });
      eqv(r.counts.completionErrors, 1, "unknown completion outcome -> completionError"); eqv(r.counts.completed, 0, "unknown outcome not completed"); }

    // ── W15 — mixed batch: bad row cannot block valid rows ──────────────
    section("W15 mixed batch independence");
    { const id1 = uuid(), id2 = uuid(), id3 = uuid();
      const plan = { claim: { data: [claimRow(id1), claimRow(id2, { quarantine_bucket: "evil" }), claimRow(id3)], error: null } }; const store = mkStore(plan);
      const r = await P.runQuarantineJanitor({ store, env: ENABLED });
      eqv(r.counts.claimed, 3, "claimed 3"); eqv(r.counts.invalidClaims, 1, "invalid 1"); eqv(r.counts.deleteConfirmed, 2, "deleteConfirmed 2"); eqv(r.counts.completed, 2, "completed 2");
      eqv(plan.cap.removeCalls.length, 2, "exactly two deletes");
      const removedKeys = plan.cap.removeCalls.map((c) => c.paths[0]).sort();
      eqv(JSON.stringify(removedKeys), JSON.stringify([keyFor(id1), keyFor(id3)].sort()), "only the two valid keys deleted");
      ok(!removedKeys.includes(keyFor(id2)), "bad row NEVER deleted"); }

    // ── W16 / W17 — claim invoked exactly once, no recursive drain ──────
    section("W16/W17 one claim per invocation");
    { const rows = []; for (let i = 0; i < 50; i++) rows.push(claimRow(uuid()));
      const plan = { claim: { data: rows, error: null } }; const store = mkStore(plan);
      const r = await P.runQuarantineJanitor({ store, env: ENABLED });
      eqv(claimRpcCount(plan.cap), 1, "claim rpc invoked exactly once");
      eqv(r.counts.claimed, 50, "processed the single (DB-bounded) batch"); eqv(r.counts.deleteConfirmed, 50, "all 50 deleted once");
      eqv(plan.cap.removeCalls.length, 50, "one delete per row, no re-drain"); }

    // ── W18 — response exposes COUNTS only ──────────────────────────────
    section("W18 counts-only output");
    { const id = uuid(); const plan = { claim: { data: [claimRow(id)], error: null } }; const store = mkStore(plan);
      const r = await P.runQuarantineJanitor({ store, env: ENABLED });
      const keys = Object.keys(r.counts).sort();
      eqv(keys.join(","), "claimed,completed,completionConflicts,completionErrors,deleteConfirmed,deleteRetryable,invalidClaims", "counts has ONLY the count fields");
      const blob = JSON.stringify(r);
      ok(!blob.includes(id), "no session id in worker output");
      ok(!blob.includes("sessions/"), "no object key/path in worker output");
      ok(!blob.includes(BUCKET), "no bucket value in worker output"); }

    // ── W19 — exact server bucket + one-element exact key ───────────────
    section("W19 exact delete target");
    { const id = uuid(); const plan = { claim: { data: [claimRow(id)], error: null } }; const store = mkStore(plan);
      await P.runQuarantineJanitor({ store, env: ENABLED });
      eqv(plan.cap.removeCalls[0].bucket, BUCKET, "server constant bucket");
      ok(Array.isArray(plan.cap.removeCalls[0].paths) && plan.cap.removeCalls[0].paths.length === 1, "one-element path array");
      eqv(plan.cap.removeCalls[0].paths[0], keyFor(id), "exact server-derived key"); }
    // Store defence-in-depth: deleteClaimedObject refuses invalid claims without any storage call.
    { const plan = { claim: { data: [], error: null } }; const store = mkStore(plan);
      const rr = await store.deleteClaimedObject({ sessionId: "not-a-uuid", quarantineBucket: BUCKET, objectKey: "sessions/not-a-uuid/raw" });
      eqv(rr, "retryable", "store refuses invalid uuid (retryable)"); eqv(plan.cap.removeCalls.length, 0, "store made NO storage call for invalid claim"); }
    { const id = uuid(); const plan = { claim: { data: [], error: null } }; const store = mkStore(plan);
      const rr = await store.deleteClaimedObject({ sessionId: id, quarantineBucket: "evil", objectKey: keyFor(id) });
      eqv(rr, "retryable", "store refuses wrong bucket (retryable)"); eqv(plan.cap.removeCalls.length, 0, "store made NO storage call for wrong bucket"); }

    // ── W20 — missing/ambiguous object NEVER triggers complete ──────────
    section("W20 missing/ambiguous -> retryable, never complete");
    { const id = uuid(); const plan = { claim: { data: [claimRow(id)], error: null }, remove: { data: [], error: null } }; const store = mkStore(plan);
      const r = await P.runQuarantineJanitor({ store, env: ENABLED });
      eqv(r.counts.completed, 0, "missing object NOT completed"); eqv(r.counts.deleteRetryable, 1, "missing object retryable");
      eqv(completeRpcCount(plan.cap), 0, "completion RPC NEVER called on missing/ambiguous"); }

  } catch (err) { fatal = err; console.error("\n• FATAL: " + (err && err.message ? err.message : String(err))); }
  finally { fs.rmSync(tempRoot, { recursive: true, force: true }); console.log("\n• Temp dir removed: " + tempRoot + " (exists=" + fs.existsSync(tempRoot) + ")"); }
  section("RESULT"); console.log(`  ${pass} passed, ${fail} failed`);
  if (failures.length) console.error("\nFAILURES:\n  " + failures.join("\n  "));
  if (fatal) process.exitCode = 2; else if (fail > 0) process.exitCode = 1; else { console.log("• ALL PASS"); process.exitCode = 0; }
}

main();
