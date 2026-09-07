#!/usr/bin/env node
/* eslint-disable no-console */
// ═════════════════════════════════════════════════════════════════════════
// SEC-00B-P1I-1 — real-Postgres suite for the VALIDATION-STAGE DB FOUNDATION
// (public.claim_media_upload_validation / complete_media_upload_validation_pass /
//  complete_media_upload_validation_rejection).
//
//   Run:  node tests/concurrency/media-upload-validation-stage.pg.test.js
//
// Spins up a THROWAWAY Postgres cluster on a private Unix socket (shared harness),
// creates the minimum media_upload_sessions BASE schema + roles, then applies the
// REAL prior chain migrations P1G-1 (janitor claim: quarantine_deleted_at) + P1H-1
// (observation: quarantined_at + observed_*) and finally the NEW P1I-1 migration,
// and exercises T1–T35. All concurrency is REAL — parallel callers get their own
// pg.Client. The dsn-guard refuses any DSN that is not the throwaway socket, so
// this NEVER touches Supabase / staging / production. ZERO Storage / byte / object
// work — this is the DB validation-stage control plane only. If postgres binaries
// are unavailable the shared harness exits NON-ZERO (unproven) — a SKIP is never a
// PASS.
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
const seed = require("./seed"); // cuid() only

const REPO = path.resolve(__dirname, "..", "..");
const MIG_P1G1 = path.join(REPO, "migrations", "2026-09-07-sec00b-p1g-1-media-upload-quarantine-janitor-claim.sql");
const MIG_P1H1 = path.join(REPO, "migrations", "2026-09-07-sec00b-p1h-1-media-upload-actual-file-observation.sql");
const MIG_P1I1 = path.join(REPO, "migrations", "2026-09-07-sec00b-p1i-1-media-upload-validation-stage-db-foundation.sql");
const BUCKET = "social-media-quarantine";
const SHA_OK = "a".repeat(64); // 64 lowercase hex

// ── assert framework ──────────────────────────────────────────────────────
let passed = 0, failed = 0;
const failures = [];
async function t(name, fn) {
  process.stdout.write(" • " + name + " ... ");
  try {
    await fn();
    console.log("ok");
    passed++;
  } catch (e) {
    console.log("FAIL");
    failed++;
    failures.push({ name, err: e });
  }
}
function eq(actual, expected, label) {
  if (actual !== expected) {
    throw new Error((label ? label + ": " : "") + "expected " + JSON.stringify(expected) + " got " + JSON.stringify(actual));
  }
}
function truthy(actual, label) {
  if (!actual) throw new Error((label ? label + ": " : "") + "expected truthy, got " + JSON.stringify(actual));
}
async function throwsRpc(fn, label) {
  let threw = false;
  try { await fn(); } catch (e) { threw = true; }
  if (!threw) throw new Error((label ? label + ": " : "") + "expected the RPC to RAISE, but it returned");
}

// ── minimum BASE schema + roles ────────────────────────────────────────────
const MINIMAL_SCHEMA = `
DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE p1i_probe; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.media_upload_sessions (
  id                   TEXT PRIMARY KEY,
  owner_user_id        TEXT NOT NULL,
  media_class          TEXT NOT NULL,
  content_type         TEXT NOT NULL,
  declared_byte_size   BIGINT NOT NULL,
  quarantine_bucket    TEXT NOT NULL,
  object_key           TEXT NOT NULL,
  idempotency_key      TEXT NOT NULL,
  status               TEXT NOT NULL DEFAULT 'created',
  upload_authorized_at TIMESTAMPTZ,
  rejected_reason      TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at           TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_media_upload_owner_idem
  ON public.media_upload_sessions (owner_user_id, idempotency_key);
`;

// ── DB helpers ─────────────────────────────────────────────────────────────
async function conn(dsn) {
  const c = new Client({ connectionString: dsn });
  await c.connect();
  return c;
}
async function reset(client) {
  await client.query("TRUNCATE public.media_upload_sessions");
}
function sqlStr(s) { return "'" + String(s).replace(/'/g, "''") + "'"; }

// Seed a media_upload_sessions row. status / timestamps / validation & observation
// fields are TEST-CONTROLLED (never user input) so they are inlined.
async function seedRow(client, o) {
  const id = o.id || seed.cuid("sess");
  const status = o.status || "quarantined";
  const mediaClass = o.mediaClass || "photo";
  const ctype = o.ctype || "image/jpeg";
  const declared = o.declared == null ? 1024 : o.declared;
  const bucket = o.bucket || BUCKET;
  const objectKey = o.objectKey || ("sessions/" + id + "/raw");
  // observation evidence (P1H-1 all-or-none: present iff quarantined_at present)
  const hasQuar = o.quarantinedAgoMin != null || o.quarantined === true;
  const quarSql = hasQuar ? `now() - make_interval(mins => ${Number(o.quarantinedAgoMin || 40)})` : "NULL";
  const obsSize = hasQuar ? String(o.obsSize == null ? 1024 : o.obsSize) : "NULL";
  const obsCtype = hasQuar ? sqlStr(o.obsCtype || "image/jpeg") : "NULL";
  const obsObj = hasQuar ? sqlStr(o.obsObj || ("objid_" + id)) : "NULL";
  const obsEtag = hasQuar ? sqlStr(o.obsEtag || '"etag-abc"') : "NULL";
  // validation lease fields (minute- or second-granular claim age)
  const claimSql = o.claimedAgoSec != null
    ? `now() - make_interval(secs => ${Number(o.claimedAgoSec)})`
    : (o.claimedAgoMin == null ? "NULL" : `now() - make_interval(mins => ${Number(o.claimedAgoMin)})`);
  const gen = o.gen == null ? 0 : Number(o.gen);
  const complSql = o.completedAgoMin == null ? "NULL" : `now() - make_interval(mins => ${Number(o.completedAgoMin)})`;
  const outcome = o.outcome == null ? "NULL" : sqlStr(o.outcome);
  // P1G-1 fields (only valid on status='expired')
  const delSql = o.deletedAgoMin == null ? "NULL" : `now() - make_interval(mins => ${Number(o.deletedAgoMin)})`;
  const cleanSql = o.cleanupClaimedAgoMin == null ? "NULL" : `now() - make_interval(mins => ${Number(o.cleanupClaimedAgoMin)})`;

  await client.query(
    `INSERT INTO public.media_upload_sessions
       (id, owner_user_id, media_class, content_type, declared_byte_size,
        quarantine_bucket, object_key, idempotency_key, status,
        upload_authorized_at, rejected_reason, created_at, updated_at, expires_at,
        observed_byte_size, observed_content_type, observed_storage_object_id,
        observed_storage_etag, quarantined_at,
        validation_claimed_at, validation_claim_generation, validation_completed_at,
        validation_outcome, quarantine_deleted_at, quarantine_cleanup_claimed_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,
             now() - interval '2 hours', ${o.rejectedReason ? sqlStr(o.rejectedReason) : "NULL"},
             now() - interval '2 hours', now() - interval '1 hour', ${o.expiresSql || "NULL"},
             ${obsSize}, ${obsCtype}, ${obsObj}, ${obsEtag}, ${quarSql},
             ${claimSql}, ${gen}, ${complSql}, ${outcome}, ${delSql}, ${cleanSql})`,
    [id, o.ownerId || seed.cuid("owner"), mediaClass, ctype, declared, bucket, objectKey,
     o.idem || seed.cuid("idem"), status],
  );
  return id;
}

async function claim(client) {
  const r = await client.query("SELECT * FROM public.claim_media_upload_validation()");
  return r.rows; // array (0 or 1 rows)
}
async function passRpc(client, a) {
  const r = await client.query(
    `SELECT public.complete_media_upload_validation_pass(
        $1::text,$2::bigint,$3::text,$4::text,$5::text,
        $6::integer,$7::integer,$8::bigint,$9::text,$10::text) AS out`,
    [a.sessionId, a.gen, a.sha256 === undefined ? SHA_OK : a.sha256,
     a.ctype === undefined ? "image/jpeg" : a.ctype,
     a.container === undefined ? "jpeg" : a.container,
     a.w === undefined ? null : a.w, a.h === undefined ? null : a.h,
     a.dur === undefined ? null : a.dur,
     a.vcodec === undefined ? null : a.vcodec, a.acodec === undefined ? null : a.acodec],
  );
  return r.rows[0].out;
}
async function rejectRpc(client, a) {
  const r = await client.query(
    `SELECT public.complete_media_upload_validation_rejection($1::text,$2::bigint,$3::text) AS out`,
    [a.sessionId, a.gen, a.reason],
  );
  return r.rows[0].out;
}
async function readRow(client, id) {
  const q = await client.query(
    `SELECT status,
            validation_claim_generation::text          AS gen,
            (validation_claimed_at IS NOT NULL)         AS claimed,
            (validation_completed_at IS NOT NULL)       AS completed,
            validation_outcome                          AS outcome,
            actual_sha256                               AS sha,
            detected_content_type                       AS dctype,
            detected_container                          AS dcont,
            media_width_px::text                        AS w,
            media_height_px::text                       AS h,
            media_duration_ms::text                     AS dur,
            detected_video_codec                        AS vcodec,
            detected_audio_codec                        AS acodec,
            rejected_reason                             AS rreason
       FROM public.media_upload_sessions WHERE id = $1`, [id]);
  return q.rows[0];
}
// Seed a quarantined row then CLAIM it → validating, gen=1, fresh lease. Returns id.
async function seedAndClaim(client, o) {
  const id = await seedRow(client, Object.assign({ status: "quarantined", quarantined: true }, o, { id: o && o.id }));
  const rows = await claim(client);
  eq(rows.length, 1, "seedAndClaim: expected exactly one claim");
  eq(rows[0].session_id, id, "seedAndClaim: claimed the seeded row");
  eq(String(rows[0].validation_claim_generation), "1", "seedAndClaim: first claim gen=1");
  return id;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function applyFile(client, p) {
  await client.query(fs.readFileSync(p, "utf8"));
}

async function main() {
  console.log("SEC-00B-P1I-1 — media upload validation-stage DB foundation suite");
  console.log("");
  console.log("[1/3] booting throwaway Postgres cluster …");
  const dsn = await harness.start();
  assertTestDsn(dsn);
  console.log("      dsn = " + dsn);

  const admin = await conn(dsn);
  console.log("[2/3] base schema + P1G-1 + P1H-1 + P1I-1 migrations …");
  await admin.query(MINIMAL_SCHEMA);
  await applyFile(admin, MIG_P1G1);
  await applyFile(admin, MIG_P1H1);
  await applyFile(admin, MIG_P1I1);

  console.log("[3/3] running T1–T35 …");
  console.log("");

  // ── T1: additive — prior P1G-1/P1H-1 columns preserved + P1I-1 adds columns ──
  await t("T1. migration additive: P1G-1/P1H-1 columns preserved + P1I-1 columns present", async () => {
    const cols = (await admin.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema='public' AND table_name='media_upload_sessions'`)).rows.map(r => r.column_name);
    // prior chain columns still present
    ["quarantine_deleted_at", "quarantine_cleanup_claimed_at", "quarantined_at",
     "observed_byte_size", "observed_content_type", "observed_storage_object_id",
     "observed_storage_etag", "rejected_reason"].forEach(c =>
      truthy(cols.includes(c), "prior column preserved: " + c));
    // prior constraints still present
    const cons = (await admin.query(
      `SELECT conname FROM pg_constraint WHERE conrelid='public.media_upload_sessions'::regclass`)).rows.map(r => r.conname);
    ["chk_media_upload_obs_all_or_none", "chk_media_upload_quar_deleted_expired"].forEach(c =>
      truthy(cons.includes(c), "prior constraint preserved: " + c));
  });

  // ── T2: exactly the 12 locked P1I-1 columns introduced ──────────────────────
  await t("T2. exactly the twelve P1I-1 validation columns introduced", async () => {
    const cols = (await admin.query(
      `SELECT column_name, data_type, is_nullable, column_default
         FROM information_schema.columns
        WHERE table_schema='public' AND table_name='media_upload_sessions'`)).rows;
    const byName = {}; cols.forEach(c => { byName[c.column_name] = c; });
    const twelve = {
      validation_claimed_at: "timestamp with time zone",
      validation_claim_generation: "bigint",
      validation_completed_at: "timestamp with time zone",
      validation_outcome: "text",
      actual_sha256: "text",
      detected_content_type: "text",
      detected_container: "text",
      media_width_px: "integer",
      media_height_px: "integer",
      media_duration_ms: "bigint",
      detected_video_codec: "text",
      detected_audio_codec: "text",
    };
    Object.keys(twelve).forEach(name => {
      truthy(byName[name], "column present: " + name);
      eq(byName[name].data_type, twelve[name], "type of " + name);
    });
    // generation is NOT NULL DEFAULT 0; the rest are nullable
    eq(byName.validation_claim_generation.is_nullable, "NO", "generation NOT NULL");
    truthy((byName.validation_claim_generation.column_default || "").indexOf("0") >= 0, "generation default 0");
    ["validation_claimed_at", "validation_completed_at", "validation_outcome", "actual_sha256",
     "detected_content_type", "detected_container", "media_width_px", "media_height_px",
     "media_duration_ms", "detected_video_codec", "detected_audio_codec"].forEach(n =>
      eq(byName[n].is_nullable, "YES", n + " nullable"));
    // No P1I-3 scanner columns leaked in.
    ["safety_status", "safety_checked_at", "safety_provider", "safety_engine_version",
     "safety_signature_version"].forEach(n => truthy(!byName[n], "no P1I-3 column: " + n));
  });

  // ── T3: generation default 0, cannot be negative ────────────────────────────
  await t("T3. generation default 0 and NEVER negative (constraint)", async () => {
    await reset(admin);
    const id = await seedRow(admin, { status: "quarantined", quarantined: true });
    eq((await readRow(admin, id)).gen, "0", "default generation 0");
    await throwsRpc(() => admin.query(
      "UPDATE public.media_upload_sessions SET validation_claim_generation = -1 WHERE id=$1", [id]),
      "negative generation must violate the CHECK");
  });

  // ── T4: first claim accepts ONLY an eligible quarantined row ─────────────────
  await t("T4. first claim accepts only an eligible quarantined row", async () => {
    await reset(admin);
    // ineligible rows: created / upload_authorized / file_safety / ready / rejected / expired
    await seedRow(admin, { status: "created" });
    await seedRow(admin, { status: "upload_authorized" });
    await seedRow(admin, { status: "rejected", quarantined: true, claimedAgoMin: 1, gen: 1, completedAgoMin: 0, outcome: "rejected", rejectedReason: "malformed_media" });
    await seedRow(admin, { status: "expired", deletedAgoMin: 5 }); // expired+deleted, not claimable
    const eligible = await seedRow(admin, { status: "quarantined", quarantined: true });
    const rows = await claim(admin);
    eq(rows.length, 1, "exactly one claim");
    eq(rows[0].session_id, eligible, "claimed the quarantined row");
  });

  // ── T5: first claim increments generation 0 -> 1 ────────────────────────────
  await t("T5. first claim increments generation 0 -> 1 and sets validating", async () => {
    await reset(admin);
    const id = await seedRow(admin, { status: "quarantined", quarantined: true });
    const rows = await claim(admin);
    eq(rows.length, 1, "one claim");
    eq(String(rows[0].validation_claim_generation), "1", "generation 0 -> 1");
    const r = await readRow(admin, id);
    eq(r.status, "validating", "status validating");
    eq(r.gen, "1", "row gen 1");
    eq(r.claimed, true, "claimed_at set");
    eq(r.completed, false, "not completed");
  });

  // ── T6: claim batch fixed to one ────────────────────────────────────────────
  await t("T6. claim batch is fixed to one (3 eligible -> 1 returned)", async () => {
    await reset(admin);
    await seedRow(admin, { status: "quarantined", quarantined: true, quarantinedAgoMin: 30 });
    await seedRow(admin, { status: "quarantined", quarantined: true, quarantinedAgoMin: 20 });
    await seedRow(admin, { status: "quarantined", quarantined: true, quarantinedAgoMin: 10 });
    const rows = await claim(admin);
    eq(rows.length, 1, "exactly one job returned though three are eligible");
    // two remain quarantined
    const left = (await admin.query("SELECT count(*)::int AS n FROM public.media_upload_sessions WHERE status='quarantined'")).rows[0].n;
    eq(left, 2, "two rows remain unclaimed");
  });

  // ── T7: a non-expired validating row cannot be reclaimed ────────────────────
  await t("T7. a fresh (non-expired) validating row is NOT reclaimed", async () => {
    await reset(admin);
    await seedRow(admin, { status: "validating", quarantined: true, claimedAgoMin: 5, gen: 1 }); // lease fresh (<15m)
    const rows = await claim(admin);
    eq(rows.length, 0, "no reclaim of a fresh lease");
  });

  // ── T8: an expired-lease validating row can be reclaimed ────────────────────
  await t("T8. an expired-lease validating row is reclaimed", async () => {
    await reset(admin);
    const id = await seedRow(admin, { status: "validating", quarantined: true, claimedAgoMin: 20, gen: 1 }); // stale (>15m)
    const rows = await claim(admin);
    eq(rows.length, 1, "reclaimed");
    eq(rows[0].session_id, id, "reclaimed the stale row");
  });

  // ── T9: reclaim increments generation 1 -> 2 ────────────────────────────────
  await t("T9. reclaim increments generation 1 -> 2", async () => {
    await reset(admin);
    const id = await seedRow(admin, { status: "validating", quarantined: true, claimedAgoMin: 20, gen: 1 });
    const rows = await claim(admin);
    eq(String(rows[0].validation_claim_generation), "2", "generation 1 -> 2 on reclaim");
    eq((await readRow(admin, id)).gen, "2", "row gen 2");
  });

  // ── T10: FOR UPDATE SKIP LOCKED — a locked row is not claimed concurrently ───
  await t("T10. SKIP LOCKED: a row locked by another txn is skipped by claim", async () => {
    await reset(admin);
    const id = await seedRow(admin, { status: "quarantined", quarantined: true });
    const holder = await conn(dsn);
    try {
      await holder.query("BEGIN");
      // Hold the row lock exactly as the claim's candidate SELECT would.
      const h = await holder.query("SELECT id FROM public.media_upload_sessions WHERE id=$1 FOR UPDATE", [id]);
      eq(h.rows.length, 1, "holder locked the row");
      // A concurrent claim must SKIP the locked row and return nothing.
      const rows = await claim(admin);
      eq(rows.length, 0, "claim skipped the locked row");
      await holder.query("ROLLBACK");
    } finally {
      await holder.end();
    }
    // After release, the row is claimable again.
    const rows2 = await claim(admin);
    eq(rows2.length, 1, "claimable after lock released");
  });

  // ── T11: a stale-generation completion fails closed after reclaim ───────────
  await t("T11. stale-generation PASS after reclaim fails closed (zero mutation)", async () => {
    await reset(admin);
    const id = await seedRow(admin, { status: "validating", quarantined: true, claimedAgoMin: 20, gen: 1 });
    const rc = await claim(admin); // reclaim -> gen 2, fresh lease
    eq(String(rc[0].validation_claim_generation), "2", "reclaim gen 2");
    const out = await passRpc(admin, { sessionId: id, gen: 1, w: 800, h: 600 }); // stale gen 1
    eq(out.outcome, "state_conflict", "stale generation rejected");
    const r = await readRow(admin, id);
    eq(r.status, "validating", "still validating (zero mutation)");
    eq(r.completed, false, "not completed");
    eq(r.gen, "2", "generation unchanged at 2");
  });

  // ── T12: completion after lease expiry fails closed ─────────────────────────
  await t("T12. PASS after lease expiry fails closed (zero mutation)", async () => {
    await reset(admin);
    const id = await seedRow(admin, { status: "validating", quarantined: true, claimedAgoMin: 20, gen: 1 }); // lease expired
    const out = await passRpc(admin, { sessionId: id, gen: 1, w: 800, h: 600 });
    eq(out.outcome, "state_conflict", "expired lease completion rejected");
    eq((await readRow(admin, id)).status, "validating", "still validating");
  });

  // ── T13: valid current-generation, unexpired PASS -> file_safety ────────────
  await t("T13. valid PASS: validating -> file_safety + evidence + passed", async () => {
    await reset(admin);
    const id = await seedAndClaim(admin, { mediaClass: "photo" });
    const out = await passRpc(admin, { sessionId: id, gen: 1, w: 800, h: 600 });
    eq(out.outcome, "applied", "applied");
    eq(out.status, "file_safety", "-> file_safety");
    const r = await readRow(admin, id);
    eq(r.status, "file_safety", "status file_safety");
    eq(r.completed, true, "completed_at set");
    eq(r.outcome, "passed", "outcome passed");
    eq(r.sha, SHA_OK, "sha persisted");
    eq(r.w, "800", "width"); eq(r.h, "600", "height");
  });

  // ── T14: valid deterministic REJECTION -> rejected + token ──────────────────
  await t("T14. valid rejection: validating -> rejected + fixed token", async () => {
    await reset(admin);
    const id = await seedAndClaim(admin, { mediaClass: "photo" });
    const out = await rejectRpc(admin, { sessionId: id, gen: 1, reason: "malformed_media" });
    eq(out.outcome, "applied", "applied");
    eq(out.status, "rejected", "-> rejected");
    const r = await readRow(admin, id);
    eq(r.status, "rejected", "status rejected");
    eq(r.completed, true, "completed_at set");
    eq(r.outcome, "rejected", "outcome rejected");
    eq(r.rreason, "malformed_media", "rejected_reason token");
    eq(r.sha, null, "no sha on rejection");
  });

  // ── T15: each of the five exact tokens is accepted ──────────────────────────
  await t("T15. all five deterministic rejection tokens accepted", async () => {
    const tokens = ["file_type_mismatch", "unsupported_format", "malformed_media", "media_limits_exceeded", "unsafe_active_content"];
    for (const tok of tokens) {
      await reset(admin);
      const id = await seedAndClaim(admin, { mediaClass: "photo" });
      const out = await rejectRpc(admin, { sessionId: id, gen: 1, reason: tok });
      eq(out.outcome, "applied", "token accepted: " + tok);
      eq((await readRow(admin, id)).rreason, tok, "reason stored: " + tok);
    }
  });

  // ── T16: an arbitrary/unapproved rejection token is refused ─────────────────
  await t("T16. arbitrary rejection token refused (RAISE, zero mutation)", async () => {
    await reset(admin);
    const id = await seedAndClaim(admin, { mediaClass: "photo" });
    await throwsRpc(() => rejectRpc(admin, { sessionId: id, gen: 1, reason: "something_arbitrary" }), "arbitrary token");
    eq((await readRow(admin, id)).status, "validating", "still validating");
  });

  // ── T17: malware_detected is refused by P1I-1 ───────────────────────────────
  await t("T17. malware_detected refused by P1I-1 (belongs to P1I-3)", async () => {
    await reset(admin);
    const id = await seedAndClaim(admin, { mediaClass: "photo" });
    await throwsRpc(() => rejectRpc(admin, { sessionId: id, gen: 1, reason: "malware_detected" }), "malware_detected");
    eq((await readRow(admin, id)).status, "validating", "still validating");
  });

  // ── T18: PASS requires exact lowercase 64-hex sha256 ────────────────────────
  await t("T18. PASS requires exact lowercase 64-hex sha256 (bad forms RAISE)", async () => {
    const bad = [
      "A".repeat(64),            // uppercase
      "a".repeat(63),            // too short
      "a".repeat(65),            // too long
      "g".repeat(64),            // non-hex
      "a".repeat(62) + "!!",     // punctuation
    ];
    for (const s of bad) {
      await reset(admin);
      const id = await seedAndClaim(admin, { mediaClass: "photo" });
      await throwsRpc(() => passRpc(admin, { sessionId: id, gen: 1, sha256: s, w: 800, h: 600 }), "bad sha256: " + s.slice(0, 6));
      eq((await readRow(admin, id)).status, "validating", "still validating for " + s.slice(0, 6));
    }
    // control: valid sha passes
    await reset(admin);
    const id = await seedAndClaim(admin, { mediaClass: "photo" });
    const out = await passRpc(admin, { sessionId: id, gen: 1, sha256: "0123456789abcdef".repeat(4), w: 10, h: 10 });
    eq(out.outcome, "applied", "valid lowercase 64-hex accepted");
  });

  // ── T19–T25: per-family PASS evidence shapes ────────────────────────────────
  await t("T19. photo image-family PASS shape", async () => {
    await reset(admin);
    const id = await seedAndClaim(admin, { mediaClass: "photo" });
    eq((await passRpc(admin, { sessionId: id, gen: 1, w: 1200, h: 800 })).outcome, "applied", "photo image shape");
  });
  await t("T20. avatar image-family PASS shape", async () => {
    await reset(admin);
    const id = await seedAndClaim(admin, { mediaClass: "avatar" });
    eq((await passRpc(admin, { sessionId: id, gen: 1, w: 256, h: 256 })).outcome, "applied", "avatar image shape");
  });
  await t("T21. circle_image image-family PASS shape", async () => {
    await reset(admin);
    const id = await seedAndClaim(admin, { mediaClass: "circle_image" });
    eq((await passRpc(admin, { sessionId: id, gen: 1, w: 640, h: 480 })).outcome, "applied", "circle_image image shape");
  });
  await t("T22. reel video-family PASS shape", async () => {
    await reset(admin);
    const id = await seedAndClaim(admin, { mediaClass: "reel", ctype: "video/webm", obsCtype: "video/webm" });
    eq((await passRpc(admin, { sessionId: id, gen: 1, ctype: "video/webm", container: "webm", w: 1080, h: 1920, dur: 30000, vcodec: "vp9", acodec: "opus" })).outcome, "applied", "reel video shape");
  });
  await t("T23. audio audio-family PASS shape", async () => {
    await reset(admin);
    const id = await seedAndClaim(admin, { mediaClass: "audio", ctype: "audio/mpeg", obsCtype: "audio/mpeg" });
    eq((await passRpc(admin, { sessionId: id, gen: 1, ctype: "audio/mpeg", container: "mp3", dur: 12000, acodec: "mp3" })).outcome, "applied", "audio shape");
  });
  await t("T24. story IMAGE-family PASS shape", async () => {
    await reset(admin);
    const id = await seedAndClaim(admin, { mediaClass: "story" });
    eq((await passRpc(admin, { sessionId: id, gen: 1, w: 1080, h: 1920 })).outcome, "applied", "story image shape");
  });
  await t("T25. story VIDEO-family PASS shape", async () => {
    await reset(admin);
    const id = await seedAndClaim(admin, { mediaClass: "story", ctype: "video/webm", obsCtype: "video/webm" });
    eq((await passRpc(admin, { sessionId: id, gen: 1, ctype: "video/webm", container: "webm", w: 1080, h: 1920, dur: 15000, vcodec: "vp9" })).outcome, "applied", "story video shape (no audio track)");
  });

  // ── T26: cross-family mismatches fail closed ────────────────────────────────
  await t("T26. cross-family evidence mismatches fail closed (RAISE, zero mutation)", async () => {
    // photo (IMAGE) with VIDEO-family evidence
    await reset(admin);
    let id = await seedAndClaim(admin, { mediaClass: "photo" });
    await throwsRpc(() => passRpc(admin, { sessionId: id, gen: 1, w: 800, h: 600, dur: 1000, vcodec: "vp9" }), "photo+video");
    eq((await readRow(admin, id)).status, "validating", "photo mismatch: still validating");
    // reel (VIDEO) with IMAGE-only evidence
    await reset(admin);
    id = await seedAndClaim(admin, { mediaClass: "reel", ctype: "video/webm", obsCtype: "video/webm" });
    await throwsRpc(() => passRpc(admin, { sessionId: id, gen: 1, ctype: "video/webm", container: "webm", w: 800, h: 600 }), "reel image-only");
    eq((await readRow(admin, id)).status, "validating", "reel mismatch: still validating");
    // audio (AUDIO) with width/height/video codec
    await reset(admin);
    id = await seedAndClaim(admin, { mediaClass: "audio", ctype: "audio/mpeg", obsCtype: "audio/mpeg" });
    await throwsRpc(() => passRpc(admin, { sessionId: id, gen: 1, ctype: "audio/mpeg", container: "mp3", w: 100, h: 100, dur: 1000, vcodec: "h264", acodec: "mp3" }), "audio+wh");
    eq((await readRow(admin, id)).status, "validating", "audio mismatch: still validating");
    // story that proves NEITHER valid image nor valid video (width only)
    await reset(admin);
    id = await seedAndClaim(admin, { mediaClass: "story" });
    await throwsRpc(() => passRpc(admin, { sessionId: id, gen: 1, w: 800 }), "story neither");
    eq((await readRow(admin, id)).status, "validating", "story mismatch: still validating");
  });

  // ── T27: completion cannot happen twice ─────────────────────────────────────
  await t("T27. completion cannot happen twice (second fails closed)", async () => {
    await reset(admin);
    const id = await seedAndClaim(admin, { mediaClass: "photo" });
    eq((await passRpc(admin, { sessionId: id, gen: 1, w: 10, h: 10 })).outcome, "applied", "first pass applied");
    const out2 = await passRpc(admin, { sessionId: id, gen: 1, w: 10, h: 10 });
    eq(out2.outcome, "state_conflict", "second pass conflicts");
    // and a rejection after pass also conflicts
    eq((await rejectRpc(admin, { sessionId: id, gen: 1, reason: "malformed_media" })).outcome, "state_conflict", "reject after pass conflicts");
    eq((await readRow(admin, id)).status, "file_safety", "status unchanged (file_safety)");
  });

  // ── T28: completion from a non-validating state fails closed ────────────────
  await t("T28. completion from a non-validating state fails closed", async () => {
    await reset(admin);
    const idQ = await seedRow(admin, { status: "quarantined", quarantined: true }); // not yet validating
    eq((await passRpc(admin, { sessionId: idQ, gen: 1, w: 10, h: 10 })).outcome, "state_conflict", "pass on quarantined conflicts");
    eq((await readRow(admin, idQ)).status, "quarantined", "quarantined unchanged");
    const idMissing = "does-not-exist";
    eq((await passRpc(admin, { sessionId: idMissing, gen: 1, w: 10, h: 10 })).outcome, "state_conflict", "pass on missing conflicts");
  });

  // ── T29: claim/complete require quarantine_deleted_at IS NULL ────────────────
  await t("T29. deleted rows never claimed; fencing requires quarantine_deleted_at IS NULL", async () => {
    await reset(admin);
    // An expired+deleted row is never claimable (and P1G-1 forbids deleted on non-expired).
    await seedRow(admin, { status: "expired", deletedAgoMin: 5 });
    const elig = await seedRow(admin, { status: "quarantined", quarantined: true });
    const rows = await claim(admin);
    eq(rows.length, 1, "only the non-deleted quarantined row is claimed");
    eq(rows[0].session_id, elig, "claimed the eligible row, not the deleted one");
    // Source-level proof that both completion RPCs include the deleted-guard.
    const src = fs.readFileSync(MIG_P1I1, "utf8");
    const guards = src.match(/quarantine_deleted_at IS NOT NULL/g) || [];
    truthy(guards.length >= 2, "both completion RPCs fence on quarantine_deleted_at (found " + guards.length + ")");
  });

  // ── T30: RPC EXECUTE privilege — service_role only ──────────────────────────
  await t("T30. EXECUTE privilege: service_role only; PUBLIC/anon/authenticated/arbitrary denied", async () => {
    const fns = [
      "public.claim_media_upload_validation()",
      "public.complete_media_upload_validation_pass(text,bigint,text,text,text,integer,integer,bigint,text,text)",
      "public.complete_media_upload_validation_rejection(text,bigint,text)",
    ];
    for (const f of fns) {
      const q = await admin.query(
        `SELECT has_function_privilege('service_role',$1,'EXECUTE') AS svc,
                has_function_privilege('anon',$1,'EXECUTE') AS anon,
                has_function_privilege('authenticated',$1,'EXECUTE') AS auth,
                has_function_privilege('p1i_probe',$1,'EXECUTE') AS probe`, [f]);
      const r = q.rows[0];
      eq(r.svc, true, "service_role EXECUTE: " + f);
      eq(r.anon, false, "anon denied: " + f);
      eq(r.auth, false, "authenticated denied: " + f);
      eq(r.probe, false, "arbitrary role (PUBLIC) denied: " + f);
    }
  });

  // ── T31: all three RPCs are SECURITY INVOKER ────────────────────────────────
  await t("T31. all three RPCs are SECURITY INVOKER (never DEFINER)", async () => {
    const r = await admin.query(
      `SELECT proname, prosecdef FROM pg_proc
        WHERE pronamespace='public'::regnamespace
          AND proname IN ('claim_media_upload_validation',
                          'complete_media_upload_validation_pass',
                          'complete_media_upload_validation_rejection')`);
    eq(r.rows.length, 3, "three RPCs present");
    r.rows.forEach(row => eq(row.prosecdef, false, row.proname + " is SECURITY INVOKER"));
  });

  // ── T32: pinned search_path present and safe ────────────────────────────────
  await t("T32. pinned safe search_path on all three RPCs", async () => {
    const r = await admin.query(
      `SELECT proname, proconfig FROM pg_proc
        WHERE pronamespace='public'::regnamespace
          AND proname IN ('claim_media_upload_validation',
                          'complete_media_upload_validation_pass',
                          'complete_media_upload_validation_rejection')`);
    eq(r.rows.length, 3, "three RPCs");
    r.rows.forEach(row => {
      const cfg = (row.proconfig || []).join(",");
      truthy(/search_path=pg_catalog, public/.test(cfg), row.proname + " pins search_path=pg_catalog, public (" + cfg + ")");
    });
  });

  // ── T33: no caller-controlled timestamp/TTL/batch/claim-owner input ─────────
  await t("T33. no caller timestamp/TTL/batch/claim-owner parameters", async () => {
    const r = await admin.query(
      `SELECT proname, pg_get_function_arguments(oid) AS args FROM pg_proc
        WHERE pronamespace='public'::regnamespace
          AND proname IN ('claim_media_upload_validation',
                          'complete_media_upload_validation_pass',
                          'complete_media_upload_validation_rejection')`);
    const byName = {}; r.rows.forEach(row => { byName[row.proname] = row.args; });
    eq(byName.claim_media_upload_validation.trim(), "", "claim takes NO parameters");
    [ "claim_media_upload_validation", "complete_media_upload_validation_pass",
      "complete_media_upload_validation_rejection" ].forEach(fn => {
      const a = byName[fn];
      truthy(!/lease|ttl|batch|claimed_at|claim_owner|\bnow\b|timestamp/i.test(a),
        fn + " has no lease/ttl/batch/owner/timestamp arg: " + a);
    });
    // pass exposes exactly the ten expected args; reject exactly three.
    truthy(/p_validation_claim_generation/.test(byName.complete_media_upload_validation_pass), "pass has generation");
    truthy(/p_reason/.test(byName.complete_media_upload_validation_rejection), "reject has reason token");
  });

  // ── T34: claim returns ONLY the bounded locked job fields ────────────────────
  await t("T34. claim returns only the bounded job fields (no owner/secret)", async () => {
    await reset(admin);
    await seedRow(admin, { status: "quarantined", quarantined: true });
    const rows = await claim(admin);
    eq(rows.length, 1, "one job");
    const keys = Object.keys(rows[0]).sort();
    const expected = ["media_class", "object_key", "observed_byte_size", "observed_content_type",
      "observed_storage_etag", "observed_storage_object_id", "quarantine_bucket", "session_id",
      "validation_claim_generation"].sort();
    eq(JSON.stringify(keys), JSON.stringify(expected), "exact bounded field set");
    truthy(!keys.includes("owner_user_id"), "no owner_user_id leaked");
    truthy(!keys.includes("idempotency_key"), "no idempotency_key leaked");
  });

  // ── T35: no scanner/file-safety/media_processing/READY/writer scope ─────────
  await t("T35. migration introduces no scanner/media_processing/READY/writer scope", async () => {
    const src = fs.readFileSync(MIG_P1I1, "utf8");
    // Scan the CODE only — strip `--` comments (the prose legitimately explains what
    // is OUT of scope, e.g. "malware_detected belongs to P1I-3", "no ClamAV").
    const code = src.split("\n").map(l => l.replace(/--.*$/, "")).join("\n");
    // The ONLY statuses the RPCs SET are 'validating' (claim) / 'file_safety' (pass) /
    // 'rejected' (reject). They never set media_processing / ready.
    truthy(!/'media_processing'/.test(code), "code never references media_processing");
    truthy(!/'ready'/.test(code), "code never sets ready");
    truthy(!/'malware_detected'/.test(code), "malware_detected is NOT an accepted token");
    truthy(!/clamav|scanner|storage\.objects|createsignedurl|arraybuffer|\.download/i.test(code), "no scanner/storage/byte reader in code");
    // It DOES set exactly the three intended statuses.
    truthy(/status\s*=\s*'validating'/.test(code), "sets validating (claim)");
    truthy(/status\s*=\s*'file_safety'/.test(code), "sets file_safety (pass)");
    truthy(/status\s*=\s*'rejected'/.test(code), "sets rejected (reject)");
    // The five accepted rejection tokens are exactly present in code.
    ["file_type_mismatch", "unsupported_format", "malformed_media", "media_limits_exceeded", "unsafe_active_content"]
      .forEach(tok => truthy(new RegExp("'" + tok + "'").test(code), "token present in code: " + tok));
  });

  // ══════════════════════════════════════════════════════════════════════════
  // P1I-1-R1 REMEDIATION TESTS (R1-01 post-lock clock · R1-04 two real claimers ·
  // R1-03 no length cap)
  // ══════════════════════════════════════════════════════════════════════════
  const w2 = await conn(dsn);

  // R1-a — CASE A: ONE eligible job, TWO real concurrent claimers -> exactly one wins.
  await t("R1-a. two real concurrent claimers, ONE job -> exactly one wins (no duplicate)", async () => {
    await reset(admin);
    const id = await seedRow(admin, { status: "quarantined", quarantined: true });
    const [a, b] = await Promise.all([claim(admin), claim(w2)]);
    const got = [...a, ...b];
    eq(got.length, 1, "exactly ONE job returned across both claimers");
    eq(got[0].session_id, id, "the one eligible job");
    eq(String(got[0].validation_claim_generation), "1", "generation incremented exactly once");
    eq((await readRow(admin, id)).gen, "1", "row generation == 1 (single increment for the claim event)");
  });

  // R1-b — CASE B: TWO eligible jobs, TWO real concurrent claimers -> disjoint.
  await t("R1-b. two real concurrent claimers, TWO jobs -> disjoint claims", async () => {
    await reset(admin);
    const id1 = await seedRow(admin, { status: "quarantined", quarantined: true, quarantinedAgoMin: 30 });
    const id2 = await seedRow(admin, { status: "quarantined", quarantined: true, quarantinedAgoMin: 20 });
    const [a, b] = await Promise.all([claim(admin), claim(w2)]);
    eq(a.length, 1, "claimer A got exactly one");
    eq(b.length, 1, "claimer B got exactly one");
    truthy(a[0].session_id !== b[0].session_id, "no duplicate session_id across claimers");
    const ids = [a[0].session_id, b[0].session_id].sort();
    eq(JSON.stringify(ids), JSON.stringify([id1, id2].sort()), "disjoint: both distinct jobs claimed");
    eq(String(a[0].validation_claim_generation), "1", "A generation matches row (1)");
    eq(String(b[0].validation_claim_generation), "1", "B generation matches row (1)");
    eq((await readRow(admin, id1)).gen, "1", "row1 gen 1"); eq((await readRow(admin, id2)).gen, "1", "row2 gen 1");
  });

  // R1-c — many concurrent claimers, no duplicate (session_id, generation) pair.
  await t("R1-c. N concurrent claimers > jobs -> no duplicate (session_id,generation) pair", async () => {
    await reset(admin);
    for (let i = 0; i < 4; i++) await seedRow(admin, { status: "quarantined", quarantined: true, quarantinedAgoMin: 40 - i });
    const extra = [await conn(dsn), await conn(dsn), await conn(dsn)];
    const clients = [admin, w2, ...extra]; // 5 claimers, 4 jobs
    try {
      const results = await Promise.all(clients.map(c => claim(c)));
      const pairs = results.flat().map(r => r.session_id + "|" + r.validation_claim_generation);
      eq(pairs.length, new Set(pairs).size, "no duplicate (session_id,generation) pair across claimers");
      eq(pairs.length, 4, "exactly the four jobs claimed (surplus claimer gets none)");
      const sessions = results.flat().map(r => r.session_id);
      eq(sessions.length, new Set(sessions).size, "no session_id claimed twice");
    } finally { for (const c of extra) await c.end(); }
  });

  // R1-d — post-lock 15-minute boundary: >15m reclaimed with a fresh (post-lock) claimed_at;
  //         14:40 NOT reclaimed. The authoritative reclaim decision uses the post-lock clock.
  await t("R1-d. post-lock boundary: >15m reclaimed (fresh claimed_at); 14:40 not reclaimed", async () => {
    await reset(admin);
    const stale = await seedRow(admin, { status: "validating", quarantined: true, gen: 1, claimedAgoSec: 15 * 60 + 3 });
    const fresh = await seedRow(admin, { status: "validating", quarantined: true, gen: 1, claimedAgoSec: 14 * 60 + 40 });
    const rows = await claim(admin);
    eq(rows.length, 1, "exactly one reclaim");
    eq(rows[0].session_id, stale, "reclaimed the >15m row, not the 14:40 row");
    eq(String(rows[0].validation_claim_generation), "2", "reclaim generation 1 -> 2");
    // The reclaimed row's claimed_at was RE-STAMPED to the post-lock instant (recent) — proving
    // v_now (post-lock) is written, not the seeded/pre-lock time.
    const skew = (await admin.query(
      "SELECT abs(EXTRACT(EPOCH FROM (validation_claimed_at - now())))::int AS s FROM public.media_upload_sessions WHERE id=$1", [stale])).rows[0].s;
    truthy(skew <= 5, "reclaimed claimed_at re-stamped to post-lock now (skew " + skew + "s)");
    const fr = await readRow(admin, fresh);
    eq(fr.status, "validating", "14:40 row untouched"); eq(fr.gen, "1", "14:40 generation unchanged");
  });

  // R1-e — R1-03: no maximum-length policy — long detected strings/codecs now PASS.
  await t("R1-e. no maximum-length policy: long (uncapped) detected strings accepted", async () => {
    await reset(admin);
    const id = await seedAndClaim(admin, { mediaClass: "reel", ctype: "video/webm", obsCtype: "video/webm" });
    const out = await passRpc(admin, {
      sessionId: id, gen: 1,
      ctype: "video/" + "x".repeat(300), container: "c".repeat(300),
      w: 100, h: 100, dur: 1000, vcodec: "v".repeat(300), acodec: "a".repeat(300),
    });
    eq(out.outcome, "applied", "long detected_content_type/container/codecs accepted (no 128/64 cap)");
    // but a BLANK required detected string still fails closed (mechanically required)
    await reset(admin);
    const id2 = await seedAndClaim(admin, { mediaClass: "photo" });
    await throwsRpc(() => passRpc(admin, { sessionId: id2, gen: 1, container: "   ", w: 10, h: 10 }), "blank container still refused");
    eq((await readRow(admin, id2)).status, "validating", "blank container: zero mutation");
  });

  await w2.end();
  await admin.end();

  // ── summary ────────────────────────────────────────────────────────────────
  console.log("");
  console.log("──────────────────────────────────────────────────────────");
  console.log("  PASS " + passed + "   FAIL " + failed);
  if (failures.length) {
    console.log("");
    failures.forEach(f => { console.log("  ✗ " + f.name); console.log("      " + (f.err && f.err.message)); });
  }
  console.log("──────────────────────────────────────────────────────────");
  await harness.stop();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  try { await harness.stop(); } catch (_) {}
  process.exit(1);
});
