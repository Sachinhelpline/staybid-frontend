#!/usr/bin/env node
/* eslint-disable no-console */
// ═════════════════════════════════════════════════════════════════════════
// SEC-00B-P1J — real-Postgres suite for the MEDIA-PROCESSING-STAGE DB FOUNDATION
// (public.claim_media_upload_processing / complete_media_upload_processing_ready /
//  complete_media_upload_processing_rejection).
//
//   Run:  node tests/concurrency/media-upload-processing-stage.pg.test.js
//
// Throwaway socket-only Postgres (shared harness + dsn-guard: never Supabase/
// staging/production). Applies base + P1G-1 + P1H-1 + P1I-1 + P1I-3 + P1J, seeds a
// genuine media_processing/clean row by driving a quarantined row through the REAL
// accepted P1I-1 (validate PASS) + P1I-3 (file-safety CLEAN) RPCs, then exercises the
// P1J claim/ready/rejection RPCs + fencing. If postgres binaries are unavailable the
// suite exits NON-ZERO (unproven) — a skip is never a pass. ZERO Storage/byte work.
// ═════════════════════════════════════════════════════════════════════════
"use strict";

let Client;
try {
  ({ Client } = require("pg"));
} catch (e) {
  console.error("[concurrency] `pg` is not installed. Run `npm ci` (pg is a devDependency).");
  process.exit(2);
}

const fs = require("fs");
const path = require("path");
const harness = require("./.pg-harness");
const { assertTestDsn } = require("./dsn-guard");
const seed = require("./seed");

const REPO = path.resolve(__dirname, "..", "..");
const M = (n) => path.join(REPO, "migrations", n);
const MIG = [
  M("2026-09-07-sec00b-p1g-1-media-upload-quarantine-janitor-claim.sql"),
  M("2026-09-07-sec00b-p1h-1-media-upload-actual-file-observation.sql"),
  M("2026-09-07-sec00b-p1i-1-media-upload-validation-stage-db-foundation.sql"),
  M("2026-09-07-sec00b-p1i-3-media-upload-file-safety-stage-db-foundation.sql"),
  M("2026-09-07-sec00b-p1j-media-upload-processing-stage-db-foundation.sql"),
];
const BUCKET = "social-media-quarantine";
const PROCESSED_BUCKET = "social-media-processed";

let passed = 0, failed = 0;
const failures = [];
async function t(name, fn) {
  process.stdout.write(" • " + name + " ... ");
  try { await fn(); console.log("ok"); passed++; }
  catch (e) { console.log("FAIL"); failed++; failures.push({ name, err: e }); }
}
function eq(a, b, l) { if (a !== b) throw new Error((l ? l + ": " : "") + "expected " + JSON.stringify(b) + " got " + JSON.stringify(a)); }
function truthy(a, l) { if (!a) throw new Error((l ? l + ": " : "") + "expected truthy, got " + JSON.stringify(a)); }
async function throwsRpc(fn, l) { let th = false; try { await fn(); } catch { th = true; } if (!th) throw new Error((l ? l + ": " : "") + "expected RAISE"); }

const MINIMAL_SCHEMA = `
DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE p1j_probe; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE TABLE IF NOT EXISTS public.media_upload_sessions (
  id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL, media_class TEXT NOT NULL,
  content_type TEXT NOT NULL, declared_byte_size BIGINT NOT NULL,
  quarantine_bucket TEXT NOT NULL, object_key TEXT NOT NULL, idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'created', upload_authorized_at TIMESTAMPTZ, rejected_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ );
CREATE UNIQUE INDEX IF NOT EXISTS uniq_media_upload_owner_idem
  ON public.media_upload_sessions (owner_user_id, idempotency_key);
`;

async function conn(dsn) { const c = new Client({ connectionString: dsn }); await c.connect(); return c; }
async function reset(c) { await c.query("TRUNCATE public.media_upload_sessions"); }

function shaFor(id) {
  let h = 0; for (let i = 0; i < id.length; i++) h = (h * 33 + id.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, "0").repeat(8).slice(0, 64);
}

async function seedQuarantined(c, o) {
  o = o || {};
  const id = o.id || seed.cuid("sess");
  const mediaClass = o.mediaClass || "photo";
  const ctype = o.ctype || "image/jpeg";
  await c.query(
    `INSERT INTO public.media_upload_sessions
       (id, owner_user_id, media_class, content_type, declared_byte_size,
        quarantine_bucket, object_key, idempotency_key, status,
        upload_authorized_at, created_at, updated_at,
        observed_byte_size, observed_content_type, observed_storage_object_id,
        observed_storage_etag, quarantined_at, validation_claim_generation)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'quarantined',
             now()-interval '2 hours', now()-interval '2 hours', now()-interval '1 hour',
             $9,$4,$10,$11, now()-make_interval(mins => 40), 0)`,
    [id, "owner_" + id, mediaClass, ctype, o.declared == null ? 1024 : o.declared,
     BUCKET, "sessions/" + id + "/raw", "idem_" + id,
     o.obsSize == null ? 1024 : o.obsSize, "objid_" + id, "etag_" + id],
  );
  return id;
}

// Drive quarantined -> file_safety/passed (P1I-1) -> media_processing/clean (P1I-3).
// media_class: 'photo'|'avatar'|'circle_image' (image) | 'reel' (video) | 'audio'.
async function seedMediaProcessing(c, o) {
  o = o || {};
  const id = await seedQuarantined(c, o);
  const sha = o.sha || shaFor(id);
  // P1I-1 validate
  const g1 = (await c.query("SELECT validation_claim_generation AS g FROM public.claim_media_upload_validation()")).rows[0].g;
  eq(String(g1), "1", "seed: P1I-1 claim gen 1 for " + id);
  const cls = o.mediaClass || "photo";
  const passArgs = cls === "audio"
    ? [id, 1, sha, o.ctype || "audio/mpeg", "mp3", null, null, 1045, null, "mp3"]
    : cls === "reel"
    ? [id, 1, sha, o.ctype || "video/mp4", "mp4", 1280, 720, 5000, "h264", null]
    : [id, 1, sha, "image/jpeg", "jpeg", 48, 24, null, null, null];
  const p = (await c.query(
    `SELECT public.complete_media_upload_validation_pass($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) AS o`, passArgs)).rows[0].o;
  truthy(/file_safety/.test(JSON.stringify(p)), "seed: P1I-1 PASS -> file_safety (" + JSON.stringify(p) + ")");
  // P1I-3 file-safety CLEAN
  const g2 = (await c.query("SELECT file_safety_claim_generation AS g FROM public.claim_media_upload_file_safety()")).rows[0].g;
  eq(String(g2), "1", "seed: P1I-3 claim gen 1");
  const cl = (await c.query(
    `SELECT public.complete_media_upload_file_safety_clean($1,$2,$3,$4,$5,$6) AS o`,
    [id, 1, "clamav", "ClamAV 1.4.1", "27500", sha])).rows[0].o;
  truthy(/media_processing/.test(JSON.stringify(cl)), "seed: P1I-3 CLEAN -> media_processing (" + JSON.stringify(cl) + ")");
  return { id, sha };
}

async function claimProc(c) { return (await c.query("SELECT * FROM public.claim_media_upload_processing()")).rows; }
async function readyRpc(c, a) {
  return (await c.query(
    `SELECT public.complete_media_upload_processing_ready(
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) AS o`,
    [a.sessionId, a.gen, a.bucket === undefined ? PROCESSED_BUCKET : a.bucket,
     a.key === undefined ? ("sessions/" + a.sessionId + "/processed/g" + a.gen + "/final.jpg") : a.key,
     a.size === undefined ? 512 : a.size, a.sha === undefined ? "a".repeat(64) : a.sha,
     a.ctype === undefined ? "image/jpeg" : a.ctype, a.container === undefined ? "jpeg" : a.container,
     a.w === undefined ? 48 : a.w, a.h === undefined ? 24 : a.h,
     a.dur === undefined ? null : a.dur, a.vcodec === undefined ? null : a.vcodec,
     a.acodec === undefined ? null : a.acodec, a.oid === undefined ? "poid_" + a.sessionId : a.oid,
     a.etag === undefined ? "petag_" + a.sessionId : a.etag])).rows[0].o;
}
async function rejectRpc(c, a) {
  return (await c.query(
    `SELECT public.complete_media_upload_processing_rejection($1,$2,$3) AS o`,
    [a.sessionId, a.gen, a.reason])).rows[0].o;
}
async function statusOf(c, id) {
  return (await c.query(
    `SELECT coalesce(status,'')||'|'||coalesce(processing_outcome,'')||'|'||coalesce(rejected_reason,'') AS s
       FROM public.media_upload_sessions WHERE id=$1`, [id])).rows[0].s;
}
async function seedClaimed(c, o) {
  const { id, sha } = await seedMediaProcessing(c, o);
  const rows = await claimProc(c);
  eq(rows.length, 1, "seedClaimed: one claim");
  eq(rows[0].session_id, id, "seedClaimed: claimed the row");
  eq(String(rows[0].processing_claim_generation), "1", "seedClaimed: gen 1");
  return { id, sha, gen: 1, claim: rows[0] };
}

async function main() {
  console.log("SEC-00B-P1J — media upload processing-stage DB foundation suite\n");
  console.log("[1/3] booting throwaway Postgres cluster …");
  const dsn = await harness.start();
  assertTestDsn(dsn);
  console.log("      dsn = " + dsn);
  const admin = await conn(dsn);
  console.log("[2/3] base + P1G-1 + P1H-1 + P1I-1 + P1I-3 + P1J …");
  await admin.query(MINIMAL_SCHEMA);
  for (const f of MIG) await admin.query(fs.readFileSync(f, "utf8"));
  console.log("[3/3] running structural + §18 DB-contract checks …\n");

  // ── S1: exactly the 17 P1J columns + prior columns preserved ────────────────
  await t("S1. 17 P1J columns present (types/nullability) + prior columns preserved", async () => {
    const rows = (await admin.query(
      `SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns
        WHERE table_schema='public' AND table_name='media_upload_sessions'`)).rows;
    const by = {}; rows.forEach(r => { by[r.column_name] = r; });
    const cols = {
      processing_claimed_at: "timestamp with time zone", processing_claim_generation: "bigint",
      processing_completed_at: "timestamp with time zone", processing_outcome: "text",
      processed_bucket: "text", processed_object_key: "text", processed_byte_size: "bigint",
      processed_sha256: "text", processed_content_type: "text", processed_container: "text",
      processed_width_px: "integer", processed_height_px: "integer", processed_duration_ms: "bigint",
      processed_video_codec: "text", processed_audio_codec: "text",
      processed_storage_object_id: "text", processed_storage_etag: "text",
    };
    Object.keys(cols).forEach(n => { truthy(by[n], "col " + n); eq(by[n].data_type, cols[n], "type " + n); });
    eq(by.processing_claim_generation.is_nullable, "NO", "gen NOT NULL");
    truthy((by.processing_claim_generation.column_default || "").indexOf("0") >= 0, "gen default 0");
    ["actual_sha256", "file_safety_outcome", "scanner_scanned_sha256", "file_safety_completed_at",
     "quarantine_deleted_at"].forEach(c => truthy(by[c], "prior col preserved: " + c));
  });

  // ── S2: RPCs SECURITY INVOKER + pinned search_path; claim no params ─────────
  await t("S2. three P1J RPCs SECURITY INVOKER + pinned search_path; claim takes no params", async () => {
    const r = (await admin.query(
      `SELECT proname, prosecdef, proconfig, pg_get_function_arguments(oid) AS args FROM pg_proc
        WHERE pronamespace='public'::regnamespace AND proname IN
        ('claim_media_upload_processing','complete_media_upload_processing_ready','complete_media_upload_processing_rejection')`)).rows;
    eq(r.length, 3, "3 RPCs");
    r.forEach(row => {
      eq(row.prosecdef, false, row.proname + " INVOKER");
      truthy(/search_path=pg_catalog, public/.test((row.proconfig || []).join(",")), row.proname + " search_path");
    });
    eq(r.find(x => x.proname === "claim_media_upload_processing").args.trim(), "", "claim no params");
    // rejection RPC has a reason token; ready RPC has no arbitrary-reason arg
    truthy(/p_reason/.test(r.find(x => x.proname === "complete_media_upload_processing_rejection").args), "rejection has reason");
    truthy(!/p_reason/.test(r.find(x => x.proname === "complete_media_upload_processing_ready").args), "ready has no reason");
  });

  // ── §18.1 claim only media_processing + passed + clean; §18.5 gen increments ─
  await t("§18.1 claim a media_processing/passed/clean row -> gen 1 + bounded fields + DB-owned key", async () => {
    await reset(admin);
    const { id, sha } = await seedMediaProcessing(admin, {});
    const rows = await claimProc(admin);
    eq(rows.length, 1, "one claim");
    eq(rows[0].session_id, id, "claimed the row");
    eq(String(rows[0].processing_claim_generation), "1", "gen 1");
    eq(rows[0].actual_sha256, sha, "returns actual_sha256");
    eq(rows[0].processed_bucket, PROCESSED_BUCKET, "DB-owned processed bucket");
    eq(rows[0].processed_object_key, "sessions/" + id + "/processed/g1/final.jpg", "DB-owned generation-specific key");
    truthy(rows[0].observed_storage_object_id && rows[0].observed_storage_etag, "TOCTOU anchors returned");
    eq(await statusOf(admin, id), "media_processing||", "status stays media_processing after claim");
  });

  // ── §18.1(neg) a non-eligible row (still file_safety) is NOT claimable ───────
  await t("§18.1(neg) a not-yet-media_processing row is NOT claimable", async () => {
    await reset(admin);
    const fsid = await seedQuarantined(admin, {});
    // drive only to file_safety/passed (P1I-1), NOT to media_processing
    await admin.query("SELECT validation_claim_generation FROM public.claim_media_upload_validation()");
    await admin.query(`SELECT public.complete_media_upload_validation_pass('${fsid}',1,'${shaFor(fsid)}','image/jpeg','jpeg',48,24,NULL,NULL,NULL)`);
    eq((await claimProc(admin)).length, 0, "file_safety row not processing-claimable");
  });

  // ── §18.2 scanner SHA mismatch row cannot claim/complete ────────────────────
  await t("§18.2 scanner_scanned_sha256 != actual_sha256 -> not claimable + complete state_conflict", async () => {
    await reset(admin);
    const { id } = await seedClaimed(admin, {}); // claimed gen 1 (valid)
    // adversarially break the sha agreement AFTER claim
    await admin.query(`UPDATE public.media_upload_sessions SET scanner_scanned_sha256='${"b".repeat(64)}' WHERE id='${id}'`);
    const out = await readyRpc(admin, { sessionId: id, gen: 1, sha: "a".repeat(64) });
    eq((out).outcome, "state_conflict", "ready refused on sha-mismatch row");
    // and a fresh media_processing row with a broken sha agreement is not claimable
    await reset(admin);
    const m = await seedMediaProcessing(admin, {});
    await admin.query(`UPDATE public.media_upload_sessions SET scanner_scanned_sha256='${"c".repeat(64)}' WHERE id='${m.id}'`);
    eq((await claimProc(admin)).length, 0, "sha-mismatch media_processing row not claimable");
  });

  // ── §18.3 batch=1 ; §18.4 disjoint concurrent claims ────────────────────────
  const w2 = await conn(dsn);
  await t("§18.3 batch=1: two claimable rows -> a single claim returns exactly one", async () => {
    await reset(admin);
    await seedMediaProcessing(admin, {}); await seedMediaProcessing(admin, {});
    eq((await claimProc(admin)).length, 1, "one job per claim");
  });
  await t("§18.4 two real concurrent claimers, TWO rows -> disjoint", async () => {
    await reset(admin);
    const a = await seedMediaProcessing(admin, {}); const b = await seedMediaProcessing(admin, {});
    const [ra, rb] = await Promise.all([claimProc(admin), claimProc(w2)]);
    eq(ra.length, 1, "A one"); eq(rb.length, 1, "B one");
    truthy(ra[0].session_id !== rb[0].session_id, "disjoint");
    eq(JSON.stringify([ra[0].session_id, rb[0].session_id].sort()), JSON.stringify([a.id, b.id].sort()), "both distinct claimed");
  });

  // ── §18.6 stale lease reclaim increments generation ─────────────────────────
  await t("§18.6 stale (>30m) processing lease reclaim -> generation 1 -> 2", async () => {
    await reset(admin);
    const { id } = await seedClaimed(admin, {});
    await admin.query(`UPDATE public.media_upload_sessions SET processing_claimed_at = now() - interval '31 minutes' WHERE id='${id}'`);
    const rows = await claimProc(admin);
    eq(rows.length, 1, "reclaimed");
    eq(String(rows[0].processing_claim_generation), "2", "gen 1 -> 2");
    eq(rows[0].processed_object_key, "sessions/" + id + "/processed/g2/final.jpg", "generation-specific key advances (g2)");
  });

  // ── §18.7 stale generation cannot complete ──────────────────────────────────
  await t("§18.7 stale generation cannot complete_ready (state_conflict, zero mutation)", async () => {
    await reset(admin);
    const { id } = await seedClaimed(admin, {}); // gen 1
    eq((await readyRpc(admin, { sessionId: id, gen: 999 })).outcome, "state_conflict", "stale gen -> conflict");
    eq(await statusOf(admin, id), "media_processing||", "unchanged");
  });

  // ── §18.8 ready -> ready ; §18.9 records full processed evidence ────────────
  await t("§18.8/§18.9 ready completion -> ready + full processed evidence recorded", async () => {
    await reset(admin);
    const { id } = await seedClaimed(admin, {});
    const out = (await readyRpc(admin, {
      sessionId: id, gen: 1, bucket: PROCESSED_BUCKET,
      key: "sessions/" + id + "/processed/g1/final.jpg", size: 4096, sha: "d".repeat(64),
      ctype: "image/jpeg", container: "jpeg", w: 48, h: 24, oid: "poid1", etag: "petag1",
    }));
    eq(out.outcome, "applied", "applied"); eq(out.status, "ready", "-> ready");
    eq(await statusOf(admin, id), "ready|ready|", "status ready/ready");
    const r = (await admin.query(
      `SELECT processed_bucket, processed_object_key, processed_byte_size::text AS sz, processed_sha256,
              processed_content_type, processed_container, processed_width_px::text AS w,
              processed_storage_object_id, processed_storage_etag
         FROM public.media_upload_sessions WHERE id='${id}'`)).rows[0];
    eq(r.processed_bucket, PROCESSED_BUCKET, "bucket"); eq(r.sz, "4096", "size");
    eq(r.processed_sha256, "d".repeat(64), "sha"); eq(r.processed_container, "jpeg", "container");
    eq(r.processed_storage_object_id, "poid1", "storage oid"); eq(r.w, "48", "width");
  });

  // ── §18.10 blank/invalid output SHA refused ; §18.11 size<=0 refused ────────
  await t("§18.10/§18.11 invalid output sha / non-positive size -> RAISE (zero mutation)", async () => {
    await reset(admin);
    const { id } = await seedClaimed(admin, {});
    await throwsRpc(() => readyRpc(admin, { sessionId: id, gen: 1, sha: "zz" }), "bad sha raises");
    await throwsRpc(() => readyRpc(admin, { sessionId: id, gen: 1, sha: "A".repeat(64) }), "uppercase sha raises");
    await throwsRpc(() => readyRpc(admin, { sessionId: id, gen: 1, size: 0 }), "size 0 raises");
    await throwsRpc(() => readyRpc(admin, { sessionId: id, gen: 1, size: -5 }), "negative size raises");
    await throwsRpc(() => readyRpc(admin, { sessionId: id, gen: 1, bucket: "  " }), "blank bucket raises");
    await throwsRpc(() => readyRpc(admin, { sessionId: id, gen: 1, container: "" }), "blank container raises");
    eq(await statusOf(admin, id), "media_processing||", "no mutation from any refused input");
  });

  // ── §18.12 completion without file_safety clean fails ───────────────────────
  await t("§18.12 completion without file_safety=clean -> state_conflict", async () => {
    await reset(admin);
    const { id } = await seedClaimed(admin, {});
    await admin.query(`UPDATE public.media_upload_sessions SET file_safety_outcome='malware_detected' WHERE id='${id}'`);
    eq((await readyRpc(admin, { sessionId: id, gen: 1 })).outcome, "state_conflict", "not-clean -> conflict");
  });

  // ── §18.13 deleted quarantine row cannot complete ───────────────────────────
  await t("§18.13 purged (expired+deleted) quarantine cannot complete + not claimable", async () => {
    await reset(admin);
    const { id } = await seedClaimed(admin, {});
    await admin.query(`UPDATE public.media_upload_sessions SET status='expired', quarantine_deleted_at=now() WHERE id='${id}'`);
    eq((await readyRpc(admin, { sessionId: id, gen: 1 })).outcome, "state_conflict", "deleted -> conflict");
    await reset(admin);
    await seedMediaProcessing(admin, {});
    await admin.query(`UPDATE public.media_upload_sessions SET status='expired', quarantine_deleted_at=now()`);
    eq((await claimProc(admin)).length, 0, "purged not claimable");
  });

  // ── §18.14 already completed cannot overwrite ───────────────────────────────
  await t("§18.14 already-completed (ready) cannot overwrite (state_conflict; stays ready)", async () => {
    await reset(admin);
    const { id } = await seedClaimed(admin, {});
    eq((await readyRpc(admin, { sessionId: id, gen: 1 })).outcome, "applied", "first ready applied");
    eq((await readyRpc(admin, { sessionId: id, gen: 1 })).outcome, "state_conflict", "re-ready refused");
    eq((await rejectRpc(admin, { sessionId: id, gen: 1, reason: "processing_output_invalid" })).outcome, "state_conflict", "reject-overwrite refused");
    eq(await statusOf(admin, id), "ready|ready|", "stays ready");
  });

  // ── §18.15 rejection accepts only P1J tokens ; §18.16 arbitrary text refused ─
  await t("§18.15/§18.16 rejection: only the three P1J tokens; arbitrary text refused", async () => {
    for (const tok of ["processing_decode_failed", "processing_limits_exceeded", "processing_output_invalid"]) {
      await reset(admin);
      const { id } = await seedClaimed(admin, {});
      const out = (await rejectRpc(admin, { sessionId: id, gen: 1, reason: tok }));
      eq(out.outcome, "applied", tok + " applied");
      eq(await statusOf(admin, id), "rejected|rejected|" + tok, tok + " recorded");
    }
    await reset(admin);
    const { id } = await seedClaimed(admin, {});
    await throwsRpc(() => rejectRpc(admin, { sessionId: id, gen: 1, reason: "malware_detected" }), "P1I-3 token refused");
    await throwsRpc(() => rejectRpc(admin, { sessionId: id, gen: 1, reason: "something arbitrary" }), "arbitrary text refused");
    eq(await statusOf(admin, id), "media_processing||", "no mutation from refused reason");
  });

  // ── §18.17 service_role-only EXECUTE ─────────────────────────────────────────
  await t("§18.17 EXECUTE privilege: service_role only (PUBLIC/anon/authenticated/arbitrary denied)", async () => {
    const fns = [
      "public.claim_media_upload_processing()",
      "public.complete_media_upload_processing_ready(text,bigint,text,text,bigint,text,text,text,integer,integer,bigint,text,text,text,text)",
      "public.complete_media_upload_processing_rejection(text,bigint,text)",
    ];
    for (const f of fns) {
      const r = (await admin.query(
        `SELECT has_function_privilege('service_role','${f}','EXECUTE') AS s,
                has_function_privilege('anon','${f}','EXECUTE') AS a,
                has_function_privilege('authenticated','${f}','EXECUTE') AS u,
                has_function_privilege('p1j_probe','${f}','EXECUTE') AS p`)).rows[0];
      eq(r.s, true, "svc " + f); eq(r.a, false, "anon " + f); eq(r.u, false, "auth " + f); eq(r.p, false, "arb " + f);
    }
  });

  // ── §18.18 READY output-evidence shape enforced by the constraint ───────────
  await t("§18.18 a 'ready' outcome without complete output evidence violates the CHECK", async () => {
    await reset(admin);
    const { id } = await seedMediaProcessing(admin, {});
    // A direct UPDATE that sets outcome='ready' but omits the processed evidence must
    // violate chk_media_upload_proc_ready_evidence (fail-closed shape guard).
    await throwsRpc(() => admin.query(
      `UPDATE public.media_upload_sessions
          SET processing_outcome='ready', processing_completed_at=now() WHERE id='${id}'`),
      "ready without evidence must violate the constraint");
  });

  // ═══ MATERIAL HARDENING R1 — Gap 1/2/3 adversarial DB proofs ═══════════════

  // ── §18.19 READY bound to the DB-owned destination (bucket/key/extension) ────
  await t("§18.19 wrong bucket / wrong key / wrong extension cannot READY (state_conflict, zero mutation)", async () => {
    // wrong (non-blank) bucket
    await reset(admin);
    let s = await seedClaimed(admin, {});
    eq((await readyRpc(admin, { sessionId: s.id, gen: 1, bucket: "social-media-public" })).outcome, "state_conflict", "wrong bucket -> conflict");
    eq(await statusOf(admin, s.id), "media_processing||", "unchanged after wrong bucket");
    // wrong key (different path)
    await reset(admin);
    s = await seedClaimed(admin, {});
    eq((await readyRpc(admin, { sessionId: s.id, gen: 1, key: "sessions/" + s.id + "/processed/g1/attacker.jpg" })).outcome, "state_conflict", "wrong key -> conflict");
    // traversal key
    await reset(admin);
    s = await seedClaimed(admin, {});
    eq((await readyRpc(admin, { sessionId: s.id, gen: 1, key: "sessions/" + s.id + "/processed/g1/../../../etc/final.jpg" })).outcome, "state_conflict", "traversal key -> conflict");
    // wrong extension (png ext for a jpeg lot)
    await reset(admin);
    s = await seedClaimed(admin, {});
    eq((await readyRpc(admin, { sessionId: s.id, gen: 1, key: "sessions/" + s.id + "/processed/g1/final.png" })).outcome, "state_conflict", "wrong extension -> conflict");
    // wrong generation-path (g2 key on a gen-1 claim)
    await reset(admin);
    s = await seedClaimed(admin, {});
    eq((await readyRpc(admin, { sessionId: s.id, gen: 1, key: "sessions/" + s.id + "/processed/g2/final.jpg" })).outcome, "state_conflict", "wrong gen-path -> conflict");
    eq(await statusOf(admin, s.id), "media_processing||", "unchanged after all destination mismatches");
  });

  // ── §18.20 wrong processed container / canonical content-type mismatch ───────
  await t("§18.20 wrong processed container or non-canonical content-type cannot READY", async () => {
    await reset(admin);
    let s = await seedClaimed(admin, {});
    eq((await readyRpc(admin, { sessionId: s.id, gen: 1, container: "mp4" })).outcome, "state_conflict", "container != detected -> conflict");
    await reset(admin);
    s = await seedClaimed(admin, {});
    eq((await readyRpc(admin, { sessionId: s.id, gen: 1, ctype: "image/png" })).outcome, "state_conflict", "content-type != canonical(jpeg) -> conflict");
    await reset(admin);
    s = await seedClaimed(admin, {});
    eq((await readyRpc(admin, { sessionId: s.id, gen: 1, ctype: "application/octet-stream" })).outcome, "state_conflict", "octet-stream -> conflict");
    eq(await statusOf(admin, s.id), "media_processing||", "unchanged");
  });

  // ── §18.21 missing storage identity (object id / etag) cannot READY ─────────
  await t("§18.21 missing processed storage object id / etag cannot READY (state_conflict)", async () => {
    await reset(admin);
    let s = await seedClaimed(admin, {});
    eq((await readyRpc(admin, { sessionId: s.id, gen: 1, oid: null })).outcome, "state_conflict", "null storage oid -> conflict");
    await reset(admin);
    s = await seedClaimed(admin, {});
    eq((await readyRpc(admin, { sessionId: s.id, gen: 1, oid: "   " })).outcome, "state_conflict", "blank storage oid -> conflict");
    await reset(admin);
    s = await seedClaimed(admin, {});
    eq((await readyRpc(admin, { sessionId: s.id, gen: 1, etag: null })).outcome, "state_conflict", "null storage etag -> conflict");
    await reset(admin);
    s = await seedClaimed(admin, {});
    eq((await readyRpc(admin, { sessionId: s.id, gen: 1, etag: "" })).outcome, "state_conflict", "blank storage etag -> conflict");
    eq(await statusOf(admin, s.id), "media_processing||", "unchanged");
  });

  // ── §18.22 IMAGE media-shape violations cannot READY ────────────────────────
  await t("§18.22 IMAGE shape: duration/video-codec/audio-codec present, or missing dims -> state_conflict", async () => {
    await reset(admin);
    let s = await seedClaimed(admin, {});
    eq((await readyRpc(admin, { sessionId: s.id, gen: 1, dur: 5000 })).outcome, "state_conflict", "image w/ duration -> conflict");
    await reset(admin);
    s = await seedClaimed(admin, {});
    eq((await readyRpc(admin, { sessionId: s.id, gen: 1, vcodec: "h264" })).outcome, "state_conflict", "image w/ video codec -> conflict");
    await reset(admin);
    s = await seedClaimed(admin, {});
    eq((await readyRpc(admin, { sessionId: s.id, gen: 1, acodec: "aac" })).outcome, "state_conflict", "image w/ audio codec -> conflict");
    await reset(admin);
    s = await seedClaimed(admin, {});
    eq((await readyRpc(admin, { sessionId: s.id, gen: 1, w: 0 })).outcome, "state_conflict", "image w/ non-positive width -> conflict");
    eq(await statusOf(admin, s.id), "media_processing||", "unchanged");
  });

  // ── §18.23 VIDEO (reel) READY positive + shape violations ───────────────────
  await t("§18.23 VIDEO reel: canonical mp4/h264 + dims + duration -> READY; missing duration/dims -> state_conflict", async () => {
    // positive: a fully-shaped reel completes READY
    await reset(admin);
    let s = await seedClaimed(admin, { mediaClass: "reel", ctype: "video/mp4" });
    const key = "sessions/" + s.id + "/processed/g1/final.mp4";
    const okOut = (await readyRpc(admin, {
      sessionId: s.id, gen: 1, key, container: "mp4", ctype: "video/mp4",
      size: 40960, sha: "e".repeat(64), w: 1280, h: 720, dur: 5000, vcodec: "h264", acodec: null,
      oid: "vpoid1", etag: "vpetag1",
    }));
    eq(okOut.outcome, "applied", "reel READY applied"); eq(okOut.status, "ready", "-> ready");
    eq(await statusOf(admin, s.id), "ready|ready|", "reel status ready/ready");
    // missing duration
    await reset(admin);
    s = await seedClaimed(admin, { mediaClass: "reel", ctype: "video/mp4" });
    eq((await readyRpc(admin, { sessionId: s.id, gen: 1, key: "sessions/" + s.id + "/processed/g1/final.mp4", container: "mp4", ctype: "video/mp4", w: 1280, h: 720, dur: null, vcodec: "h264" })).outcome, "state_conflict", "reel missing duration -> conflict");
    // missing dims
    await reset(admin);
    s = await seedClaimed(admin, { mediaClass: "reel", ctype: "video/mp4" });
    eq((await readyRpc(admin, { sessionId: s.id, gen: 1, key: "sessions/" + s.id + "/processed/g1/final.mp4", container: "mp4", ctype: "video/mp4", w: null, h: null, dur: 5000, vcodec: "h264" })).outcome, "state_conflict", "reel missing dims -> conflict");
    // wrong video codec for mp4 (vp9 is webm-only)
    await reset(admin);
    s = await seedClaimed(admin, { mediaClass: "reel", ctype: "video/mp4" });
    eq((await readyRpc(admin, { sessionId: s.id, gen: 1, key: "sessions/" + s.id + "/processed/g1/final.mp4", container: "mp4", ctype: "video/mp4", w: 1280, h: 720, dur: 5000, vcodec: "vp9" })).outcome, "state_conflict", "mp4 w/ vp9 codec -> conflict");
  });

  // ── §18.24 media_class <-> family mismatch cannot READY ─────────────────────
  await t("§18.24 a photo (image) row can never READY with a video container/shape", async () => {
    await reset(admin);
    const s = await seedClaimed(admin, {}); // photo, detected jpeg
    // even a perfectly-shaped mp4 payload cannot READY on a photo row (detected jpeg key
    // won't match, and family mismatch is caught) -> state_conflict.
    eq((await readyRpc(admin, {
      sessionId: s.id, gen: 1, key: "sessions/" + s.id + "/processed/g1/final.mp4",
      container: "mp4", ctype: "video/mp4", w: 1280, h: 720, dur: 5000, vcodec: "h264",
    })).outcome, "state_conflict", "photo row + video payload -> conflict");
    eq(await statusOf(admin, s.id), "media_processing||", "unchanged");
  });

  // ── §18.25 direct UPDATE with a bad READY shape violates the CHECK ──────────
  await t("§18.25 a direct UPDATE to ready with an inconsistent media-shape violates chk_media_upload_proc_ready_shape", async () => {
    await reset(admin);
    const { id } = await seedMediaProcessing(admin, {}); // photo
    // Full evidence + storage identity present, but an IMAGE row carrying a video codec
    // must violate the fail-closed shape CHECK (defense against a raw UPDATE).
    await throwsRpc(() => admin.query(
      `UPDATE public.media_upload_sessions
          SET processing_outcome='ready', processing_completed_at=now(),
              processed_bucket='${PROCESSED_BUCKET}', processed_object_key='sessions/${id}/processed/g1/final.jpg',
              processed_byte_size=4096, processed_sha256='${"d".repeat(64)}',
              processed_content_type='image/jpeg', processed_container='jpeg',
              processed_width_px=48, processed_height_px=24, processed_video_codec='h264',
              processed_storage_object_id='oid', processed_storage_etag='etag'
        WHERE id='${id}'`),
      "image row with a video codec must violate the ready-shape CHECK");
    // and a ready row with a blank storage identity violates the storage-identity CHECK
    await throwsRpc(() => admin.query(
      `UPDATE public.media_upload_sessions
          SET processing_outcome='ready', processing_completed_at=now(),
              processed_bucket='${PROCESSED_BUCKET}', processed_object_key='sessions/${id}/processed/g1/final.jpg',
              processed_byte_size=4096, processed_sha256='${"d".repeat(64)}',
              processed_content_type='image/jpeg', processed_container='jpeg',
              processed_width_px=48, processed_height_px=24,
              processed_storage_object_id='', processed_storage_etag=''
        WHERE id='${id}'`),
      "blank storage identity must violate the storage-identity CHECK");
    eq(await statusOf(admin, id), "media_processing||", "no mutation from either refused direct UPDATE");
  });

  // ── generation fencing: two real concurrent claimers, ONE row -> one wins ────
  await t("R. two real concurrent claimers, ONE row -> exactly one wins (single increment)", async () => {
    await reset(admin);
    const { id } = await seedMediaProcessing(admin, {});
    const [a, b] = await Promise.all([claimProc(admin), claimProc(w2)]);
    const got = [...a, ...b];
    eq(got.length, 1, "exactly one claim");
    eq(got[0].session_id, id, "the row");
    eq(String(got[0].processing_claim_generation), "1", "single increment");
  });

  await w2.end(); await admin.end();
  console.log("\n──────────────────────────────────────────────────────────");
  console.log("  PASS " + passed + "   FAIL " + failed);
  if (failures.length) { console.log(""); failures.forEach(f => { console.log("  ✗ " + f.name); console.log("      " + (f.err && f.err.message)); }); }
  console.log("──────────────────────────────────────────────────────────");
  await harness.stop();
  process.exit(failed === 0 ? 0 : 1);
}
main().catch((e) => { console.error("SUITE ERROR:", e && e.stack ? e.stack : e); process.exit(1); });
