#!/usr/bin/env node
/* eslint-disable no-console */
// ─────────────────────────────────────────────────────────────────────────
// SEC-00B-P1I-1 — source-contract test for the VALIDATION-STAGE DB FOUNDATION
// migration. Pure/static (no DB, no network): reads the migration file and
// asserts the LOCKED contract — exactly twelve additive validation columns, the
// six fail-closed CHECK constraints, the claim partial index, the THREE
// SECURITY INVOKER service_role-only RPCs, DB-fixed batch=1 / lease=15m,
// clock_timestamp after the lock (never now()/transaction_timestamp()),
// FOR UPDATE SKIP LOCKED, generation fencing (+1 per claim, exact-match
// completion), the five exact rejection tokens (no malware_detected), the exact
// lowercase-64-hex sha256 shape, the media-family cross-check, and ZERO
// scanner/media_processing/READY/byte-reader/writer scope.
//   Run: node tests/social/media-upload-validation-stage-source.test.js
// ─────────────────────────────────────────────────────────────────────────
const path = require("path"), fs = require("fs");
const REPO = path.resolve(__dirname, "..", "..");
let pass = 0, fail = 0; const failures = [];
function ok(c, l) { if (c) pass += 1; else { fail += 1; failures.push(l); console.error("  ✗ " + l); } }
function section(n) { console.log("\n• " + n); }
const read = (p) => fs.readFileSync(path.join(REPO, p), "utf8");

const MIG_PATH = "migrations/2026-09-07-sec00b-p1i-1-media-upload-validation-stage-db-foundation.sql";

section("P1I-1 migration source contract");
let mig = "";
let migExists = false;
try { mig = read(MIG_PATH); migExists = mig.length > 0; } catch { migExists = false; }
ok(migExists, "migration source exists");
// Strip SQL line comments so prose mentions never create false hits.
const code = mig.replace(/--[^\n]*/g, "");

// ── (1) Exactly the twelve additive validation columns ────────────────────
section("exactly twelve additive validation columns");
const COLS = [
  ["validation_claimed_at", "TIMESTAMPTZ"],
  ["validation_claim_generation", "BIGINT NOT NULL DEFAULT 0"],
  ["validation_completed_at", "TIMESTAMPTZ"],
  ["validation_outcome", "TEXT"],
  ["actual_sha256", "TEXT"],
  ["detected_content_type", "TEXT"],
  ["detected_container", "TEXT"],
  ["media_width_px", "INTEGER"],
  ["media_height_px", "INTEGER"],
  ["media_duration_ms", "BIGINT"],
  ["detected_video_codec", "TEXT"],
  ["detected_audio_codec", "TEXT"],
];
COLS.forEach(([name, type]) => {
  const re = new RegExp("ADD COLUMN IF NOT EXISTS\\s+" + name + "\\s+" + type.replace(/ /g, "\\s+"), "i");
  ok(re.test(code), "adds column " + name + " " + type);
});
const addCols = (code.match(/ADD COLUMN IF NOT EXISTS/gi) || []).length;
ok(addCols === 12, "exactly 12 ADD COLUMN statements (got " + addCols + ")");
// generation is the ONLY non-null / defaulted validation column.
ok(/validation_claim_generation\s+BIGINT NOT NULL DEFAULT 0/i.test(code), "generation is BIGINT NOT NULL DEFAULT 0");
// No P1I-3 scanner/safety columns.
["safety_status", "safety_checked_at", "safety_provider", "safety_engine_version", "safety_signature_version"]
  .forEach(n => ok(!new RegExp("ADD COLUMN IF NOT EXISTS\\s+" + n).test(code), "no P1I-3 column added: " + n));

// ── (2) Six fail-closed CHECK constraints ─────────────────────────────────
section("six fail-closed CHECK constraints");
ok(/chk_media_upload_val_generation_nonneg[\s\S]*?CHECK\s*\(\s*validation_claim_generation >= 0\s*\)/i.test(code), "A: generation >= 0");
ok(/chk_media_upload_val_claim_generation[\s\S]*?CHECK\s*\(\s*validation_claimed_at IS NULL OR validation_claim_generation >= 1\s*\)/i.test(code), "B: claimed ⇒ generation >= 1");
ok(/chk_media_upload_val_outcome[\s\S]*?validation_outcome IN \('passed', 'rejected'\)/i.test(code), "C: outcome vocabulary passed|rejected");
ok(/chk_media_upload_val_sha256_shape[\s\S]*?actual_sha256 ~ '\^\[0-9a-f\]\{64\}\$'/i.test(code), "D: sha256 exact lowercase 64-hex shape");
ok(/chk_media_upload_val_complete_pairing[\s\S]*?validation_completed_at IS NULL AND validation_outcome IS NULL[\s\S]*?validation_completed_at IS NOT NULL AND validation_outcome IS NOT NULL/i.test(code), "E: completed ⇔ outcome pairing");
ok(/chk_media_upload_val_pass_evidence[\s\S]*?validation_outcome IS DISTINCT FROM 'passed'[\s\S]*?actual_sha256 IS NOT NULL[\s\S]*?detected_content_type IS NOT NULL[\s\S]*?detected_container IS NOT NULL/i.test(code), "F: PASS requires sha256+ctype+container");
const chkCount = (code.match(/ADD CONSTRAINT chk_media_upload_val_/gi) || []).length;
ok(chkCount === 6, "exactly six P1I-1 CHECK constraints (got " + chkCount + ")");
// No table-level rejected_reason CHECK invented (RPC enforces the vocabulary).
ok(!/ADD CONSTRAINT[\s\S]*?rejected_reason IN/i.test(code), "no table-level rejected_reason CHECK invented");

// ── (3) Bounded claim partial index ───────────────────────────────────────
section("claim partial index");
ok(/CREATE INDEX IF NOT EXISTS idx_media_upload_validation_claim/i.test(code), "creates idx_media_upload_validation_claim");
ok(/idx_media_upload_validation_claim[\s\S]*?WHERE[\s\S]*?validation_completed_at IS NULL[\s\S]*?quarantine_deleted_at IS NULL[\s\S]*?status IN \('quarantined', 'validating'\)/i.test(code), "index scoped to claimable rows");

// ── (4) Exactly three RPCs with the exact names ───────────────────────────
section("exactly three RPCs");
const fnDefs = code.match(/CREATE OR REPLACE FUNCTION\s+public\.[a-z_]+/gi) || [];
ok(fnDefs.length === 3, "exactly three CREATE OR REPLACE FUNCTION (got " + fnDefs.length + ")");
ok(/CREATE OR REPLACE FUNCTION\s+public\.claim_media_upload_validation\s*\(\s*\)/i.test(code), "RPC A claim_media_upload_validation() takes NO params");
ok(/CREATE OR REPLACE FUNCTION\s+public\.complete_media_upload_validation_pass\s*\(/i.test(code), "RPC B complete_media_upload_validation_pass(...)");
ok(/CREATE OR REPLACE FUNCTION\s+public\.complete_media_upload_validation_rejection\s*\(/i.test(code), "RPC C complete_media_upload_validation_rejection(...)");

// ── (5) Claim contract: batch 1, lease 15m, SKIP LOCKED, +1, bounded return ─
section("claim contract");
ok(/RETURNS TABLE\(\s*[\s\S]*?session_id[\s\S]*?media_class[\s\S]*?quarantine_bucket[\s\S]*?object_key[\s\S]*?observed_byte_size[\s\S]*?observed_content_type[\s\S]*?observed_storage_object_id[\s\S]*?observed_storage_etag[\s\S]*?validation_claim_generation/i.test(code), "claim RETURNS only the bounded job fields");
ok(!/RETURNS TABLE\([\s\S]*?owner_user_id/i.test(code), "claim never returns owner_user_id");
ok(/INTERVAL '15 minutes'/i.test(code), "lease = 15 minutes");
ok(/LIMIT 1\s*\n?\s*FOR UPDATE SKIP LOCKED/i.test(code), "batch 1 via LIMIT 1 + FOR UPDATE SKIP LOCKED");
ok(/validation_claim_generation\s*=\s*m\.validation_claim_generation \+ 1/i.test(code), "generation incremented by exactly 1");
ok(/status = 'quarantined' AND s\.quarantined_at IS NOT NULL/i.test(code), "first-claim eligibility: quarantined + quarantined_at");
ok(/status = 'validating'[\s\S]*?validation_claimed_at <= pg_catalog\.clock_timestamp\(\) - c_lease/i.test(code), "reclaim eligibility: stale validating lease");
// Authoritative clock AFTER the lock in the claim.
ok(/FOR UPDATE SKIP LOCKED;[\s\S]*?v_now := pg_catalog\.clock_timestamp\(\);/i.test(code), "claim: authoritative clock taken AFTER the row lock");

// ── (6) Fencing in both completions ───────────────────────────────────────
section("completion fencing");
// exact generation match, unexpired lease, validating, not completed, not deleted.
// Split into per-function chunks so each completion's fencing is checked in isolation.
const fnChunks = code.split(/CREATE OR REPLACE FUNCTION/i).slice(1);
const passBlock = fnChunks.find(c => /^\s*public\.complete_media_upload_validation_pass/i.test(c)) || "";
const rejBlock = fnChunks.find(c => /^\s*public\.complete_media_upload_validation_rejection/i.test(c)) || "";
[["PASS", passBlock], ["REJECT", rejBlock]].forEach(([label, blk]) => {
  ok(blk.length > 0, label + ": function chunk located");
  ok(/validation_claim_generation <> p_validation_claim_generation/i.test(blk), label + ": exact generation fencing");
  ok(/validation_claimed_at <= v_now - c_lease/i.test(blk), label + ": unexpired-lease fencing");
  ok(/status <> 'validating'/i.test(blk), label + ": requires validating");
  ok(/validation_completed_at IS NOT NULL/i.test(blk), label + ": requires not-yet-completed");
  ok(/quarantine_deleted_at IS NOT NULL/i.test(blk), label + ": requires not-deleted");
  ok(/FOR UPDATE;/i.test(blk) && !/SKIP LOCKED/i.test(blk), label + ": locks the target row FOR UPDATE (no SKIP LOCKED)");
  ok(/v_now := pg_catalog\.clock_timestamp\(\);/i.test(blk), label + ": post-lock DB clock");
});

// ── (7) Rejection vocabulary — exactly five, no malware_detected ──────────
section("rejection vocabulary");
["file_type_mismatch", "unsupported_format", "malformed_media", "media_limits_exceeded", "unsafe_active_content"]
  .forEach(tok => ok(new RegExp("'" + tok + "'").test(code), "accepted token: " + tok));
ok(!/'malware_detected'/.test(code), "malware_detected is NOT an accepted token (P1I-3)");
ok(/p_reason NOT IN \(\s*'file_type_mismatch',\s*'unsupported_format',\s*'malformed_media',\s*'media_limits_exceeded',\s*'unsafe_active_content'\s*\)/i.test(code), "reject RPC allow-lists exactly the five tokens");

// ── (8) PASS sha256 shape + media-family cross-check ──────────────────────
section("pass evidence + media-family cross-check");
ok(/p_actual_sha256 !~ '\^\[0-9a-f\]\{64\}\$'/i.test(code), "PASS validates exact lowercase 64-hex sha256");
ok(/media_class IN \('photo', 'avatar', 'circle_image'\)/i.test(code), "IMAGE family = photo/avatar/circle_image");
ok(/media_class = 'reel'/i.test(code), "VIDEO family = reel");
ok(/media_class = 'audio'/i.test(code), "AUDIO family = audio");
ok(/media_class = 'story'/i.test(code) && /v_is_image OR v_is_video/i.test(code), "STORY = image OR video (from detected shape)");
ok(/status\s*=\s*'file_safety'/.test(code), "PASS transitions validating -> file_safety");
ok(/status\s*=\s*'rejected'/.test(code), "REJECT transitions validating -> rejected");

// ── (9) Security posture: SECURITY INVOKER + pinned path + service_role ────
section("security posture");
// Count only the function-header occurrences (COMMENT ON FUNCTION string literals
// also contain the words "SECURITY INVOKER"). The header is `VOLATILE\nSECURITY INVOKER`.
const invokerCount = (code.match(/VOLATILE\s+SECURITY INVOKER/gi) || []).length;
ok(invokerCount === 3, "all three RPC headers SECURITY INVOKER (got " + invokerCount + ")");
ok(!/SECURITY DEFINER/i.test(code), "never SECURITY DEFINER");
const pathCount = (code.match(/SET search_path = pg_catalog, public/gi) || []).length;
ok(pathCount === 3, "all three RPCs pin search_path=pg_catalog, public (got " + pathCount + ")");
["claim_media_upload_validation", "complete_media_upload_validation_pass", "complete_media_upload_validation_rejection"]
  .forEach(fn => {
    ok(new RegExp("REVOKE ALL ON FUNCTION public\\." + fn + "[\\s\\S]*?FROM PUBLIC", "i").test(code), fn + ": REVOKE FROM PUBLIC");
    ok(new RegExp("REVOKE ALL ON FUNCTION public\\." + fn + "[\\s\\S]*?FROM anon", "i").test(code), fn + ": REVOKE FROM anon");
    ok(new RegExp("REVOKE ALL ON FUNCTION public\\." + fn + "[\\s\\S]*?FROM authenticated", "i").test(code), fn + ": REVOKE FROM authenticated");
    ok(new RegExp("GRANT EXECUTE ON FUNCTION public\\." + fn + "[\\s\\S]*?TO service_role", "i").test(code), fn + ": GRANT EXECUTE service_role only");
  });

// ── (10) Clock discipline + no caller-controlled authority ────────────────
section("clock + no caller authority");
ok(!/\bnow\(\)/i.test(code), "never uses now() (uses clock_timestamp only)");
ok(!/transaction_timestamp\(\)/i.test(code), "never uses transaction_timestamp()");
// No caller timestamp / TTL / batch / claim-owner parameter names.
ok(!/p_(now|timestamp|lease|ttl|batch|claimed_at|claim_owner|expires)/i.test(code), "no caller timestamp/ttl/batch/owner parameter");

// ── (11) Scope exclusions ─────────────────────────────────────────────────
section("scope exclusions");
ok(!/'media_processing'/.test(code), "never references media_processing status");
ok(!/'ready'/.test(code), "never sets ready status");
ok(!/clamav|scanner|storage\.objects|createsignedurl|arraybuffer|\.download/i.test(code), "no scanner / storage / byte reader");

// ── (12) Prior migrations untouched by THIS file (additive-only) ──────────
section("additive-only (prior migrations present + unedited by this file)");
["migrations/2026-09-06-sec00b-p1f-1-media-upload-atomic-reservation.sql",
 "migrations/2026-09-07-sec00b-p1f-2-media-upload-lifecycle-cas.sql",
 "migrations/2026-09-07-sec00b-p1g-1-media-upload-quarantine-janitor-claim.sql",
 "migrations/2026-09-07-sec00b-p1h-1-media-upload-actual-file-observation.sql"]
  .forEach(p => { let e = true; try { read(p); } catch { e = false; } ok(e, "prior migration present: " + path.basename(p)); });
ok(!/DROP\s+(TABLE|COLUMN|CONSTRAINT|INDEX|FUNCTION)/i.test(code), "migration performs no DROP");
ok(!/DELETE FROM/i.test(code), "migration performs no DELETE");
ok(/ADD COLUMN IF NOT EXISTS/i.test(code), "additive column adds only");

// ── (R1) remediation contract ─────────────────────────────────────────────
section("R1-01 post-lock reclaim clock authority");
const claimChunk = fnChunks.find(c => /^\s*public\.claim_media_upload_validation/i.test(c)) || "";
ok(claimChunk.length > 0, "claim function chunk located");
// The pre-lock candidate SELECT + SKIP LOCKED, THEN the authoritative post-lock clock,
// THEN an eligibility RE-GATE that uses v_now (not the pre-lock scan clock).
ok(/FOR UPDATE SKIP LOCKED;[\s\S]*?v_now := pg_catalog\.clock_timestamp\(\);[\s\S]*?validation_claimed_at <= v_now - c_lease/i.test(claimChunk),
   "post-lock v_now re-gate decides reclaim staleness (v_now - c_lease AFTER the lock)");
ok(/v_now := pg_catalog\.clock_timestamp\(\);[\s\S]*?IF NOT \([\s\S]*?RETURN;[\s\S]*?END IF;[\s\S]*?UPDATE/i.test(claimChunk),
   "an ineligible-under-v_now candidate RETURNs (no mutation) before the claim UPDATE");
ok(/validation_claimed_at\s*=\s*v_now/i.test(claimChunk), "claim stamps validation_claimed_at = post-lock v_now");

section("R1-02 evidence-shape (NOT canonical detected-family authority)");
ok(/evidence-SHAPE|evidence-shape/i.test(code), "code reframes the check as media_class evidence-shape");
ok(/NOT\s+(the\s+)?CANONICAL DETECTED (MEDIA )?FAMILY|does NOT prove the CANONICAL|NOT canonical detected-family/i.test(code),
   "code explicitly does NOT claim canonical detected-family authority (P1I-2 concern)");
// The shape predicates must NOT be derived from the opaque detected type/container strings.
const shapePredicates = (code.match(/v_is_image :=[\s\S]*?v_is_audio :=[\s\S]*?\);/) || [""])[0];
ok(shapePredicates.length > 0, "shape predicate block located");
ok(/p_media_width_px/.test(shapePredicates), "shape predicates derive from geometry/codec");
ok(!/detected_content_type|detected_container/.test(shapePredicates), "shape predicates never key off detected_content_type/container");
ok(/media_class IN \('photo', 'avatar', 'circle_image'\)/i.test(code), "IMAGE shape = photo/avatar/circle_image");
ok(/media_class = 'story'/i.test(code) && /v_is_image OR v_is_video/i.test(code), "STORY = image OR video shape");

section("R1-03 no unauthorized string-length policy");
ok(!/char_length\([^)]*\)\s*>\s*128/i.test(code), "no >128 length cap remains");
ok(!/char_length\([^)]*\)\s*>\s*64/i.test(code), "no >64 length cap remains");
ok(!/char_length\([^)]*\)\s*>\s*\d+/i.test(code), "no char_length maximum-length policy of ANY value (255/256/etc.)");
// detected_content_type / detected_container are still REQUIRED + non-blank (mechanically forced).
ok(/p_detected_content_type IS NULL\s*\n?\s*OR length\(btrim\(p_detected_content_type\)\) = 0/i.test(code), "detected_content_type required + non-blank");
ok(/p_detected_container IS NULL\s*\n?\s*OR length\(btrim\(p_detected_container\)\) = 0/i.test(code), "detected_container required + non-blank");

// ── summary ───────────────────────────────────────────────────────────────
console.log("\n──────────────────────────────────────────────────────────");
console.log("  PASS " + pass + "   FAIL " + fail);
if (failures.length) { console.log(""); failures.forEach(f => console.log("  ✗ " + f)); }
console.log("──────────────────────────────────────────────────────────");
process.exit(fail === 0 ? 0 : 1);
