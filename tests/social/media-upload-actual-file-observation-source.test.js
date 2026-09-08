#!/usr/bin/env node
/* eslint-disable no-console */
// ─────────────────────────────────────────────────────────────────────────
// SEC-00B-P1H-1 — source-contract test for the ACTUAL FILE OBSERVATION DB gate
// migration. Pure/static (no DB, no network): reads the migration file and
// asserts the locked contract — five additive nullable observation columns, the
// bounded + all-or-none CHECK constraints (bound to quarantined_at, NOT status),
// exactly ONE SECURITY INVOKER service_role-only RPC with EXACTLY the six allowed
// parameters (no status/time/bucket/object-key/limit/reason authority),
// clock_timestamp taken AFTER the row FOR UPDATE (never now()/transaction_
// timestamp()/statement_timestamp()), the exact 100 MiB ceiling, exact
// observed==declared size + exact content-type equality, the exact server bucket +
// sessions/<id>/raw key invariant, upload_authorized -> quarantined, idempotent
// quarantined retry, later-state no-regression, and ZERO Storage / HTTP / file /
// READY / file-safety / production-activation surface.
//   Run: node tests/social/media-upload-actual-file-observation-source.test.js
// ─────────────────────────────────────────────────────────────────────────
const path = require("path"), fs = require("fs");
const REPO = path.resolve(__dirname, "..", "..");
let pass = 0, fail = 0; const failures = [];
function ok(c, l) { if (c) pass += 1; else { fail += 1; failures.push(l); console.error("  ✗ " + l); } }
function section(n) { console.log("\n• " + n); }
const read = (p) => fs.readFileSync(path.join(REPO, p), "utf8");

const MIG_PATH = "migrations/2026-09-07-sec00b-p1h-1-media-upload-actual-file-observation.sql";

section("P1H-1 migration source contract");
let mig = "";
let migExists = false;
try { mig = read(MIG_PATH); migExists = mig.length > 0; } catch { migExists = false; }
ok(migExists, "migration source exists");

// Strip SQL line comments so clock-source / prose mentions in the header can't
// create false hits (mirrors the P1G-1 source test).
const code = mig.replace(/--[^\n]*/g, "");
// `exec` additionally removes the descriptive COMMENT ON FUNCTION statement, whose
// honest semantic-boundary prose (e.g. "magic bytes / malware safety / READY")
// would otherwise trip the negative token checks. The COMMENT string ends at the
// only '<quote>; sequence (no internal '; exists), so this removes it cleanly.
const exec = code.replace(/COMMENT ON FUNCTION[\s\S]*?IS\s*'[\s\S]*?';/i, "");

// ── Additive nullable observation columns ──────────────────────────────────
section("additive nullable observation columns");
ok(/ADD COLUMN IF NOT EXISTS observed_byte_size\s+BIGINT/i.test(code), "adds nullable observed_byte_size BIGINT");
ok(/ADD COLUMN IF NOT EXISTS observed_content_type\s+TEXT/i.test(code), "adds nullable observed_content_type TEXT");
ok(/ADD COLUMN IF NOT EXISTS observed_storage_object_id\s+TEXT/i.test(code), "adds nullable observed_storage_object_id TEXT");
ok(/ADD COLUMN IF NOT EXISTS observed_storage_etag\s+TEXT/i.test(code), "adds nullable observed_storage_etag TEXT");
ok(/ADD COLUMN IF NOT EXISTS quarantined_at\s+TIMESTAMPTZ/i.test(code), "adds nullable quarantined_at TIMESTAMPTZ");
// No destructive column rewrite of existing columns.
ok(!/DROP COLUMN/i.test(code), "no DROP COLUMN (additive only)");
ok(!/ALTER COLUMN/i.test(code), "no ALTER COLUMN (no existing-column rewrite)");

// ── CHECK constraints (bounded values + all-or-none) ────────────────────────
section("bounded + all-or-none CHECK constraints");
ok(/chk_media_upload_obs_size[\s\S]*?observed_byte_size > 0 AND observed_byte_size <= 104857600/i.test(code), "size CHECK: 0 < size <= 100 MiB");
ok(/chk_media_upload_obs_ctype[\s\S]*?char_length\(observed_content_type\) > 0/i.test(code), "content-type CHECK: non-empty");
ok(/chk_media_upload_obs_objid[\s\S]*?char_length\(observed_storage_object_id\) > 0/i.test(code), "object-id CHECK: non-empty");
ok(/chk_media_upload_obs_etag[\s\S]*?char_length\(observed_storage_etag\) > 0/i.test(code), "etag CHECK: non-empty");
ok(
  /chk_media_upload_obs_all_or_none[\s\S]*?quarantined_at IS NULL[\s\S]*?observed_byte_size IS NULL[\s\S]*?observed_content_type IS NULL[\s\S]*?observed_storage_object_id IS NULL[\s\S]*?observed_storage_etag IS NULL[\s\S]*?quarantined_at IS NOT NULL[\s\S]*?observed_byte_size IS NOT NULL[\s\S]*?observed_content_type IS NOT NULL[\s\S]*?observed_storage_object_id IS NOT NULL[\s\S]*?observed_storage_etag IS NOT NULL/i.test(code),
  "all-or-none CHECK: quarantined_at present iff all four observed fields present",
);
// The observation evidence is bound to quarantined_at, NOT ONLY to status='quarantined'.
ok(!/observed_[a-z_]+\s+IS NULL OR status = 'quarantined'/i.test(code), "observation fields are NOT bound only to status='quarantined'");

// ── No new index ────────────────────────────────────────────────────────────
section("no new index (§8)");
ok(!/CREATE INDEX/i.test(code), "P1H-1 adds NO new index");

// ── Exactly one new RPC, exact six parameters, no forbidden authority ───────
section("exactly one RPC with the six allowed parameters");
const fnDefs = code.match(/CREATE OR REPLACE FUNCTION\s+public\.[a-z_]+/gi) || [];
ok(fnDefs.length === 1, "exactly ONE CREATE OR REPLACE FUNCTION (got " + fnDefs.length + ")");
ok(/CREATE OR REPLACE FUNCTION public\.confirm_media_upload_quarantine_observation\s*\(/i.test(code), "RPC name is confirm_media_upload_quarantine_observation");
const sigM = code.match(/CREATE OR REPLACE FUNCTION public\.confirm_media_upload_quarantine_observation\s*\(([\s\S]*?)\)\s*RETURNS JSONB/i);
const params = sigM ? sigM[1] : "";
ok(params.length > 0, "found the RPC parameter block returning JSONB");
ok(/p_session_id\s+TEXT/i.test(params), "param p_session_id TEXT");
ok(/p_owner_user_id\s+TEXT/i.test(params), "param p_owner_user_id TEXT");
ok(/p_observed_byte_size\s+BIGINT/i.test(params), "param p_observed_byte_size BIGINT");
ok(/p_observed_content_type\s+TEXT/i.test(params), "param p_observed_content_type TEXT");
ok(/p_storage_object_id\s+TEXT/i.test(params), "param p_storage_object_id TEXT");
ok(/p_storage_etag\s+TEXT/i.test(params), "param p_storage_etag TEXT");
// exactly six parameters (five commas separating six declared params)
ok((params.match(/,/g) || []).length === 5, "exactly six parameters (got " + ((params.match(/,/g) || []).length + 1) + ")");
// Caller cannot supply any DB/session-owned authority.
for (const forbidden of [
  "p_status", "p_bucket", "p_object_key", "p_objectkey", "p_expires", "p_expires_at",
  "p_quarantined_at", "p_reason", "p_limit", "p_now", "p_clock", "p_media_class",
  "p_declared", "p_declared_byte_size", "p_action", "p_result", "p_outcome", "p_ttl",
]) {
  ok(!new RegExp("\\b" + forbidden + "\\b", "i").test(params), "caller cannot supply " + forbidden);
}

// ── DB clock: clock_timestamp only, after the row lock ──────────────────────
section("DB clock taken AFTER the row FOR UPDATE");
ok(/pg_catalog\.clock_timestamp\(\)/.test(code), "uses pg_catalog.clock_timestamp()");
ok(!/\bnow\(/.test(code), "executable migration contains NO now()");
ok(!/transaction_timestamp\(/.test(code), "no transaction_timestamp()");
ok(!/statement_timestamp\(/.test(code), "no statement_timestamp()");
{
  const iForUpdate = code.indexOf("FOR UPDATE");
  const iClock = code.indexOf("clock_timestamp");
  ok(iForUpdate > -1 && iClock > -1 && iForUpdate < iClock, "FOR UPDATE row lock precedes the clock_timestamp() assignment");
}

// ── Owner-bound row lock ─────────────────────────────────────────────────────
section("owner-bound row lock");
ok(/WHERE id = p_session_id\s*AND owner_user_id = p_owner_user_id\s*FOR UPDATE/i.test(code), "row located + locked by (id, owner_user_id) FOR UPDATE");

// ── Exact ceiling + size/content-type consistency ───────────────────────────
section("exact ceiling + observed==declared size + exact content-type");
ok(/104857600/.test(code), "exact 100 MiB ceiling (104857600)");
ok(/c_max_bytes\s+CONSTANT\s+BIGINT\s*:=\s*104857600/i.test(code), "DB-fixed ceiling constant");
ok(/p_observed_byte_size <> v_row\.declared_byte_size/i.test(code), "observed byte size compared EXACTLY to declared_byte_size");
ok(/p_observed_content_type <> v_row\.content_type/i.test(code), "observed content type compared EXACTLY to stored content_type");
// No normalization / coercion of the observed values.
ok(!/lower\(\s*p_observed_content_type/i.test(code) && !/upper\(\s*p_observed_content_type/i.test(code), "no case-folding of observed content type");
ok(!/btrim\(\s*p_observed_content_type\s*\)\s*=/.test(code) && !/trim\(\s*p_observed_content_type\s*\)\s*=/.test(code), "no trimming of observed content type in the equality compare");

// ── Server-owned destination invariants ─────────────────────────────────────
section("server-owned bucket + object-key invariants");
ok(/'social-media-quarantine'/.test(code), "exact quarantine bucket literal social-media-quarantine");
ok(/c_bucket\s+CONSTANT\s+TEXT\s*:=\s*'social-media-quarantine'/i.test(code), "bucket is a server constant");
ok(/quarantine_bucket <> c_bucket/i.test(code), "DB row bucket must equal the server constant");
ok(/'sessions\/'\s*\|\|\s*v_row\.id\s*\|\|\s*'\/raw'/.test(code), "exact server-derived sessions/<db row id>/raw object-key invariant");
ok(/object_key <> v_expected_key/i.test(code), "DB row object_key must equal the server-derived key");
// Caller never chooses the bucket / object key (only p_* params exist; none is bucket/key).
ok(!/p_bucket|p_object_key/i.test(code), "no caller bucket / object_key parameter anywhere");

// ── Transition + idempotency + no backwards move ────────────────────────────
section("transition, idempotency, no regression");
ok(/SET[\s\S]*?status\s*=\s*'quarantined'/i.test(code), "applied transition sets status='quarantined'");
ok(/WHERE id = v_row\.id\s*AND status = 'upload_authorized'/i.test(code), "CAS bound on the exact expected status upload_authorized");
ok(/'upload_authorized'\s*->\s*'quarantined'|upload_authorized[\s\S]{0,80}quarantined/i.test(code), "documented upload_authorized -> quarantined transition");
ok(/'applied'/.test(code) && /'status', 'quarantined'/.test(code), "returns applied + quarantined");
ok(/'idempotent_existing'/.test(code), "idempotent retry outcome present");
ok(/v_row\.status = 'quarantined'[\s\S]*?v_row\.quarantined_at IS NOT NULL[\s\S]*?observed_byte_size\s*=\s*p_observed_byte_size[\s\S]*?observed_content_type\s*=\s*p_observed_content_type[\s\S]*?observed_storage_object_id\s*=\s*p_storage_object_id[\s\S]*?observed_storage_etag\s*=\s*p_storage_etag/i.test(code), "idempotent gated on quarantined + quarantined_at + all four observed fields equal");
ok(/status <> 'upload_authorized'[\s\S]*?state_conflict/i.test(code), "any non-authorized (non-quarantined) status -> state_conflict (no backwards move)");
ok(/'expired'/.test(code), "expiry gate returns the expired outcome");
// P1H-1 NEVER sets status='expired' (the janitor owns that).
ok(!/status\s*=\s*'expired'/i.test(code), "never writes status='expired'");
// Later / non-cleanup statuses must NOT appear as quoted STATUS literals in the
// executable SQL (checked against `exec` so the descriptive COMMENT can't collide).
for (const s of ["created", "uploading", "validating", "file_safety", "media_processing", "ready", "rejected"]) {
  ok(!new RegExp("'" + s + "'").test(exec), "later status '" + s + "' is NOT a status literal in the RPC");
}

// ── Security: SECURITY INVOKER, never DEFINER; service_role-only EXECUTE ─────
section("SECURITY INVOKER + service_role-only EXECUTE");
ok(!/SECURITY DEFINER/i.test(code), "never SECURITY DEFINER");
ok(/SECURITY INVOKER/i.test(code), "function is SECURITY INVOKER");
ok(/SET search_path = pg_catalog, public/i.test(code), "pinned safe search_path");
const SIG = "public.confirm_media_upload_quarantine_observation\\(TEXT, TEXT, BIGINT, TEXT, TEXT, TEXT\\)";
ok(new RegExp("REVOKE ALL ON FUNCTION " + SIG + " FROM PUBLIC", "i").test(code), "REVOKE PUBLIC");
ok(new RegExp("REVOKE ALL ON FUNCTION " + SIG + " FROM anon", "i").test(code), "REVOKE anon");
ok(new RegExp("REVOKE ALL ON FUNCTION " + SIG + " FROM authenticated", "i").test(code), "REVOKE authenticated");
ok(new RegExp("GRANT EXECUTE ON FUNCTION " + SIG + " TO service_role", "i").test(code), "GRANT service_role only");

// ── ZERO storage / HTTP / file / READY / file-safety / activation surface ───
// Checked against `exec` (COMMENT ON FUNCTION removed) so the honest descriptive
// boundary prose in the COMMENT cannot create a false hit.
section("no storage / HTTP / file / READY / file-safety / activation");
ok(!/storage\.objects/i.test(exec), "no storage.objects reference");
ok(!/storage\.from\(/i.test(exec), "no storage.from() client call");
ok(!/\.remove\(/i.test(exec), "no Storage .remove()");
ok(!/\.download\(|\.list\(|createSignedUrl|createSignedUploadUrl|\.info\(|\.upload\(/i.test(exec), "no download/list/signed-url/upload/info storage call");
ok(!/createBucket|updateBucket|deleteBucket|emptyBucket/i.test(exec), "no bucket mutation");
ok(!/DELETE\s+FROM/i.test(exec), "no DELETE FROM (no row deletion)");
ok(!/https?:\/\//i.test(exec), "no HTTP(S) URL");
ok(!/\bfetch\(|readFile|createReadStream/i.test(exec), "no HTTP fetch / file read");
ok(!/'ready'/i.test(exec), "no 'ready' status literal (no READY claim)");
ok(!/'file_safety'/i.test(exec), "no 'file_safety' status literal (no file-safety claim)");
ok(!/magic|antivirus|malware\s*=|clamav|sniff/i.test(exec), "no magic-byte / antivirus / malware scanning in executable SQL");
ok(!/process\.env|_ENABLED\b|feature_flag/i.test(exec), "no feature activation / env / flag in the migration");

console.log("");
section("RESULT"); console.log(`  ${pass} passed, ${fail} failed`);
if (failures.length) console.error("\nFAILURES:\n  " + failures.join("\n  "));
if (fail > 0) process.exitCode = 1; else { console.log("• ALL PASS"); process.exitCode = 0; }
