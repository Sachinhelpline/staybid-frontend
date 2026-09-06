#!/usr/bin/env node
/* eslint-disable no-console */
// ─────────────────────────────────────────────────────────────────────────
// SEC-00B-P1G-1 — source-contract test for the quarantine-janitor DB claim/lease
// migration. Pure/static (no DB, no network): reads the migration file and
// asserts the locked contract — additive columns, CHECK constraints, partial
// index, the two SECURITY INVOKER service_role-only RPCs, DB-fixed batch/lease,
// clock_timestamp (never now()/transaction_timestamp()), FOR UPDATE SKIP LOCKED,
// exact eligible states, later-state exclusion, and ZERO storage/row deletion.
//   Run: node tests/social/media-upload-quarantine-janitor-source.test.js
// ─────────────────────────────────────────────────────────────────────────
const path = require("path"), fs = require("fs");
const REPO = path.resolve(__dirname, "..", "..");
let pass = 0, fail = 0; const failures = [];
function ok(c, l) { if (c) pass += 1; else { fail += 1; failures.push(l); console.error("  ✗ " + l); } }
function section(n) { console.log("\n• " + n); }
const read = (p) => fs.readFileSync(path.join(REPO, p), "utf8");

const MIG_PATH = "migrations/2026-09-07-sec00b-p1g-1-media-upload-quarantine-janitor-claim.sql";

section("P1G-1 migration source contract");
let mig = "";
let migExists = false;
try { mig = read(MIG_PATH); migExists = mig.length > 0; } catch { migExists = false; }
ok(migExists, "migration source exists");

// Strip SQL line comments so clock-source / prose mentions don't create false hits.
const code = mig.replace(/--[^\n]*/g, "");

// ── Additive columns ────────────────────────────────────────────────────
ok(/ADD COLUMN IF NOT EXISTS quarantine_cleanup_claimed_at\s+TIMESTAMPTZ/i.test(code), "adds nullable quarantine_cleanup_claimed_at");
ok(/ADD COLUMN IF NOT EXISTS quarantine_deleted_at\s+TIMESTAMPTZ/i.test(code), "adds nullable quarantine_deleted_at");

// ── CHECK constraints (A/B/C) ─────────────────────────────────────────────
ok(/chk_media_upload_quar_claim_expired[\s\S]*?CHECK\s*\(\s*quarantine_cleanup_claimed_at IS NULL OR status = 'expired'\s*\)/i.test(code), "constraint A: claim only on expired");
ok(/chk_media_upload_quar_deleted_expired[\s\S]*?CHECK\s*\(\s*quarantine_deleted_at IS NULL OR status = 'expired'\s*\)/i.test(code), "constraint B: deleted only on expired");
ok(/chk_media_upload_quar_deleted_not_leased[\s\S]*?CHECK\s*\(\s*quarantine_deleted_at IS NULL OR quarantine_cleanup_claimed_at IS NULL\s*\)/i.test(code), "constraint C: deleted cannot remain leased");

// ── Partial index ─────────────────────────────────────────────────────────
ok(/CREATE INDEX IF NOT EXISTS idx_media_upload_quar_cleanup/i.test(code), "creates the janitor candidate partial index");
ok(/idx_media_upload_quar_cleanup[\s\S]*?WHERE[\s\S]*?quarantine_deleted_at IS NULL[\s\S]*?status IN \('created', 'upload_authorized', 'expired'\)/i.test(code), "partial index scoped to not-deleted + cleanup-relevant statuses");

// ── Exactly the two janitor RPC names, no release/failure RPC ─────────────
const fnDefs = code.match(/CREATE OR REPLACE FUNCTION\s+public\.[a-z_]+/gi) || [];
ok(fnDefs.length === 2, "exactly two CREATE OR REPLACE FUNCTION definitions (got " + fnDefs.length + ")");
ok(/CREATE OR REPLACE FUNCTION public\.claim_media_upload_quarantine_cleanup\s*\(\s*\)/i.test(code), "claim RPC present with ZERO caller args");
ok(/CREATE OR REPLACE FUNCTION public\.complete_media_upload_quarantine_cleanup\s*\(\s*p_session_id\s+TEXT\s*\)/i.test(code), "complete RPC present with only p_session_id TEXT");
ok(!/release|_fail|failure/i.test(code.replace(/upload_authorization_failed/g, "")), "no release/failure RPC (P1G-1 has no release path)");

// ── DB-fixed batch / lease ────────────────────────────────────────────────
ok(/c_batch\s+CONSTANT\s+INT\s*:=\s*50\b/i.test(code), "fixed batch = 50");
ok(/c_lease\s+CONSTANT\s+INTERVAL\s*:=\s*INTERVAL '10 minutes'/i.test(code), "fixed lease = 10 minutes");

// ── DB clock: clock_timestamp only; never now()/transaction_timestamp() ────
ok(/pg_catalog\.clock_timestamp\(\)/.test(code), "uses pg_catalog.clock_timestamp()");
ok(!/\bnow\(\)/.test(code), "executable migration contains NO now()");
ok(!/transaction_timestamp\(\)/.test(code), "executable migration contains NO transaction_timestamp()");

// ── Row-locking strategy ──────────────────────────────────────────────────
ok(/FOR UPDATE SKIP LOCKED/i.test(code), "claim uses FOR UPDATE SKIP LOCKED");

// ── Eligible states: exactly created / upload_authorized (+ expired retry) ─
ok(/status = 'created'\s+AND\s+s?\.?expires_at IS NOT NULL\s+AND\s+s?\.?expires_at <= v_now/i.test(code), "eligible: expired created");
ok(/status = 'upload_authorized'\s+AND\s+s?\.?expires_at IS NOT NULL\s+AND\s+s?\.?expires_at <= v_now/i.test(code), "eligible: expired upload_authorized");
ok(/status = 'expired'/i.test(code), "eligible: expired retry allowed");
// Later / non-cleanup statuses must NOT appear as quoted literals anywhere in executable SQL.
for (const s of ["uploading", "quarantined", "validating", "file_safety", "media_processing", "ready", "rejected"]) {
  ok(!new RegExp("'" + s + "'").test(code), `later status '${s}' is NOT an eligible literal`);
}

// ── Security: SECURITY INVOKER, never DEFINER; service_role-only EXECUTE ────
ok(!/SECURITY DEFINER/i.test(code), "never SECURITY DEFINER");
ok((code.match(/SECURITY INVOKER/gi) || []).length >= 2, "both functions SECURITY INVOKER");
ok(/SET search_path = pg_catalog, public/i.test(code), "pinned safe search_path");
for (const sig of [
  "public.claim_media_upload_quarantine_cleanup\\(\\)",
  "public.complete_media_upload_quarantine_cleanup\\(TEXT\\)",
]) {
  ok(new RegExp("REVOKE ALL ON FUNCTION " + sig + " FROM PUBLIC", "i").test(code), "REVOKE PUBLIC on " + sig);
  ok(new RegExp("REVOKE ALL ON FUNCTION " + sig + " FROM anon", "i").test(code), "REVOKE anon on " + sig);
  ok(new RegExp("REVOKE ALL ON FUNCTION " + sig + " FROM authenticated", "i").test(code), "REVOKE authenticated on " + sig);
  ok(new RegExp("GRANT EXECUTE ON FUNCTION " + sig + " TO service_role", "i").test(code), "GRANT service_role on " + sig);
}

// ── No storage / no row deletion / no bucket mutation ──────────────────────
ok(!/DELETE\s+FROM\s+public\.media_upload_sessions/i.test(code), "no DELETE FROM media_upload_sessions");
ok(!/DELETE\s+FROM\s+storage\.objects/i.test(code), "no DELETE FROM storage.objects");
ok(!/storage\.objects/i.test(code), "no storage.objects reference");
ok(!/\.remove\(/i.test(code), "no Storage .remove() call");
ok(!/createBucket|updateBucket|deleteBucket|emptyBucket/i.test(code), "no bucket mutation");

// ── Completion eligibility contract ────────────────────────────────────────
ok(/s\.status = 'expired'[\s\S]*?s\.quarantine_deleted_at IS NULL[\s\S]*?s\.quarantine_cleanup_claimed_at IS NOT NULL[\s\S]*?FOR UPDATE/i.test(code), "complete requires expired + not-deleted + claimed, locked FOR UPDATE");
ok(/quarantine_deleted_at\s*=\s*v_now[\s\S]*?quarantine_cleanup_claimed_at\s*=\s*NULL/i.test(code), "complete sets deleted=v_now + clears claim");
ok(/'completed'/.test(code) && /'state_conflict'/.test(code), "complete returns completed / state_conflict outcomes");

console.log("");
section("RESULT"); console.log(`  ${pass} passed, ${fail} failed`);
if (failures.length) console.error("\nFAILURES:\n  " + failures.join("\n  "));
if (fail > 0) process.exitCode = 1; else { console.log("• ALL PASS"); process.exitCode = 0; }
