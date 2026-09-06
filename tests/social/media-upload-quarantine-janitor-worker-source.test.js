#!/usr/bin/env node
/* eslint-disable no-console */
// ─────────────────────────────────────────────────────────────────────────
// SEC-00B-P1G-2 — source-contract test for the safe quarantine STORAGE janitor
// WORKER (route + pure worker + privileged store). Pure/static (no DB, no
// network): reads the three source files and asserts the locked contract —
// POST-only cron route using the shared cronAuthGuard (auth before work, no
// ?token/x-cron-secret/JSON/searchParams authority), dormant activation gate,
// service-role-only pinned-origin store, exact bucket + exact server-derived key
// + canonical UUID v4 validation, exact one-object remove, explicit deletion
// acknowledgement, delete-before-complete, only the two P1G-1 RPC names, and
// ZERO storage precheck / row mutation / storage.objects delete / env mutation.
//   Run: node tests/social/media-upload-quarantine-janitor-worker-source.test.js
// (This is the P1G-2 WORKER source test — distinct from the accepted P1G-1
//  tests/social/media-upload-quarantine-janitor-source.test.js which is unchanged.)
// ─────────────────────────────────────────────────────────────────────────
const path = require("path"), fs = require("fs");
const REPO = path.resolve(__dirname, "..", "..");
let pass = 0, fail = 0; const failures = [];
function ok(c, l) { if (c) pass += 1; else { fail += 1; failures.push(l); console.error("  ✗ " + l); } }
function section(n) { console.log("\n• " + n); }
const read = (p) => fs.readFileSync(path.join(REPO, p), "utf8");
// Strip block + line comments so prose (e.g. "no ?token=") can't create hits.
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const ROUTE = "app/api/cron/media-quarantine-janitor/route.ts";
const WORKER = "lib/social/quarantine-janitor.ts";
const STORE = "lib/social/quarantine-janitor-store.ts";

const routeRaw = read(ROUTE), workerRaw = read(WORKER), storeRaw = read(STORE);
const route = strip(routeRaw), worker = strip(workerRaw), store = strip(storeRaw);

// ── ROUTE ──────────────────────────────────────────────────────────────
section("route: POST-only, cron-auth-first, no request authority");
ok(/export\s+async\s+function\s+POST\s*\(/.test(route), "exports async POST");
ok(!/export\s+(async\s+function|const|function)\s+GET\b/.test(route), "does NOT export GET");
ok(/import\s*\{\s*cronAuthGuard\s*\}\s*from\s*["']@\/lib\/cron\/auth["']/.test(route), "imports cronAuthGuard from @/lib/cron/auth");
{
  const iAuth = route.indexOf("cronAuthGuard(");
  const iWork = route.indexOf("runQuarantineJanitor(");
  ok(iAuth > -1 && iWork > -1 && iAuth < iWork, "cronAuthGuard runs BEFORE runQuarantineJanitor");
}
ok(!/\?token|x-cron-secret/i.test(route), "no ?token / x-cron-secret auth");
ok(!/req\.json|request\.json|\.json\(\)/.test(route), "route reads NO request JSON");
ok(!/searchParams|nextUrl|new URL\(/.test(route), "route uses NO query/searchParams authority");
ok(/runtime\s*=\s*["']nodejs["']/.test(route), "route nodejs runtime");
ok(/dynamic\s*=\s*["']force-dynamic["']/.test(route), "route force-dynamic");
ok(/media_quarantine_janitor_disabled/.test(route) && /media_quarantine_janitor_unconfigured/.test(route) && /media_quarantine_janitor_service_unavailable/.test(route), "route maps the three 503 codes");

// ── WORKER (pure, dependency-free) ───────────────────────────────────────
section("worker: dormant gate, one claim, validate, delete-before-complete");
ok(!/from\s+["']@supabase|from\s+["']@\/|require\(/.test(worker), "worker is dependency-free (no @supabase/@/require)");
ok(/MEDIA_QUARANTINE_JANITOR_ENABLED/.test(worker), "worker reads MEDIA_QUARANTINE_JANITOR_ENABLED gate");
ok(/trim\(\)\.toLowerCase\(\)\s*===\s*["']true["']/.test(worker), "flag enabled only when normalized value is exactly 'true'");
{
  const claimCalls = (worker.match(/\.claimCleanup\(/g) || []).length;
  ok(claimCalls === 1, "worker invokes store.claimCleanup() exactly once (got " + claimCalls + ")");
}
ok(!/while\s*\(|for\s*\(\s*;;|runQuarantineJanitor\([\s\S]*runQuarantineJanitor\(/.test(worker), "worker has no drain loop / no self-recursion");
ok(/isCanonicalUuidV4/.test(worker) && /4\[0-9a-f\]\{3\}/.test(worker), "worker validates canonical UUID v4");
ok(/claim\.quarantineBucket\s*===\s*QUARANTINE_BUCKET/.test(worker), "worker validates exact bucket");
ok(/claim\.objectKey\s*===\s*quarantineObjectKeyForSession\(/.test(worker), "worker validates exact server-derived object key");
{
  const iDelete = worker.indexOf("deleteClaimedObject(");
  const iComplete = worker.indexOf("completeCleanup(");
  ok(iDelete > -1 && iComplete > -1 && iDelete < iComplete, "delete happens BEFORE complete");
}
ok(/!==\s*["']confirmed["']/.test(worker), "worker gates completion on a confirmed delete");
ok(!/finally\s*\{/.test(worker), "worker never completes in a finally block");
ok(/QUARANTINE_BUCKET\s*=\s*["']social-media-quarantine["']/.test(worker), "server-constant bucket defined");

// ── STORE (server-only privileged) ───────────────────────────────────────
section("store: service-role-only, pinned origin, exact target, only P1G-1 RPCs");
ok(/typeof window/.test(store), "store server-only guard");
ok(/SUPABASE_SERVICE_ROLE_KEY/.test(store) && !/\b(SB_ADMIN_KEY|SB_H|SB_READ|SB_KEY)\b/.test(store) && !/NEXT_PUBLIC_/.test(store), "service-role key ONLY, no anon/SB_*/NEXT_PUBLIC fallback");
ok(/EXPECTED_SUPABASE_ORIGIN\s*=\s*["']https:\/\/uxxhbdqedazpmvbvaosh\.supabase\.co["']/.test(store), "pinned exact Supabase origin");
ok(/persistSession:\s*false/.test(store) && /autoRefreshToken:\s*false/.test(store) && /detectSessionInUrl:\s*false/.test(store), "hardened client auth config");
ok(/\.from\(QUARANTINE_BUCKET\)/.test(store), "storage delete uses the QUARANTINE_BUCKET constant");
ok(!/\.from\(\s*claim\.quarantineBucket/.test(store), "store NEVER uses claim.quarantineBucket for the Storage bucket");
ok(/\.remove\(\[\s*objectKey\s*\]\)/.test(store), "store remove receives a one-element exact key array");
ok(/isCanonicalUuidV4\(claim\.sessionId\)/.test(store), "store independently validates canonical UUID v4");
ok(/claim\.objectKey\s*!==\s*quarantineObjectKeyForSession\(/.test(store), "store independently validates exact object key");
ok(/claim\.quarantineBucket\s*!==\s*QUARANTINE_BUCKET/.test(store), "store independently validates exact bucket");
ok(/data\.length\s*!==\s*1/.test(store) && /Array\.isArray\(data\)/.test(store), "store requires explicit single-object deletion acknowledgement");
// only the two P1G-1 RPC names; no other RPC / no P1F RPC
ok(/claim_media_upload_quarantine_cleanup/.test(store) && /complete_media_upload_quarantine_cleanup/.test(store), "store references both P1G-1 RPC names");
ok(!/reserve_media_upload_session|apply_media_upload_authorization_cas/.test(store), "store references NO P1F RPCs");
{
  const rpcCalls = (store.match(/\.rpc\(/g) || []).length;
  ok(rpcCalls === 2, "store makes exactly two .rpc() call sites (claim + complete), got " + rpcCalls);
}
ok(!/media_upload_sessions/.test(store), "store has NO direct media_upload_sessions table reference");
ok(!/storage\.objects/.test(store) && !/DELETE\s+FROM/i.test(store), "store has NO storage.objects / SQL DELETE");
ok(!/\.list\(|\.download\(|createSignedUrl|createSignedUploadUrl|\.upload\(|\.info\(/.test(store), "store performs NO list/download/signed-url/upload/info existence precheck");

// ── No scheduler / no env mutation / no activation across all three ──────
section("no scheduler / env mutation / activation");
for (const [name, code] of [["route", route], ["worker", worker], ["store", store]]) {
  ok(!/process\.env\.[A-Za-z_]+\s*=(?!=)/.test(code), `${name}: no process.env write (no env mutation)`);
  ok(!/cron-job\.org|vercel\.json|schedule\s*:/.test(code), `${name}: no scheduler/config mutation`);
}

console.log("");
section("RESULT"); console.log(`  ${pass} passed, ${fail} failed`);
if (failures.length) console.error("\nFAILURES:\n  " + failures.join("\n  "));
if (fail > 0) process.exitCode = 1; else { console.log("• ALL PASS"); process.exitCode = 0; }
