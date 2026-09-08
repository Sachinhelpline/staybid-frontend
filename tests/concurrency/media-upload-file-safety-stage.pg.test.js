#!/usr/bin/env node
/* eslint-disable no-console */
// ═════════════════════════════════════════════════════════════════════════
// SEC-00B-P1I-3 — real-Postgres suite for the FILE-SAFETY (MALWARE) STAGE DB
// FOUNDATION
// (public.claim_media_upload_file_safety /
//  public.complete_media_upload_file_safety_clean /
//  public.complete_media_upload_file_safety_malware).
//
//   Run:  node tests/concurrency/media-upload-file-safety-stage.pg.test.js
//
// Spins up a THROWAWAY Postgres cluster on a private Unix socket (shared harness),
// creates the minimum media_upload_sessions BASE schema + roles, then applies the
// REAL prior chain migrations P1G-1 (janitor claim) + P1H-1 (observation) + P1I-1
// (validation stage) and finally the NEW P1I-3 file-safety migration. A file_safety/
// passed row is produced by driving a seeded quarantined row through the REAL P1I-1
// claim + PASS RPCs (so every P1I-1 evidence constraint is genuinely satisfied), and
// then the P1I-3 claim / complete-clean / complete-malware RPCs are exercised.
//
// All concurrency is REAL — parallel callers get their own pg.Client. The dsn-guard
// refuses any DSN that is not the throwaway socket, so this NEVER touches Supabase /
// staging / production. ZERO Storage / byte / object / ClamAV work — this is the DB
// file-safety-stage control plane only. If postgres binaries are unavailable the
// shared harness exits NON-ZERO (unproven) — a SKIP is never a PASS.
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
const MIG_P1I3 = path.join(REPO, "migrations", "2026-09-07-sec00b-p1i-3-media-upload-file-safety-stage-db-foundation.sql");
const BUCKET = "social-media-quarantine";
const ENGINE = "clamav";
const ENGINE_VER = "1.4.1/ClamAV 1.4.1";
const SIG_VER = "27500/2026-09-07";

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

// ── minimum BASE schema + roles (identical to the P1I-1 suite) ─────────────
const MINIMAL_SCHEMA = `
DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE p1i3_probe; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

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
function shaFor(id) {
  // deterministic 64-hex sha for a session id (no crypto dep needed)
  let h = 0;
  for (let i = 0; i < id.length; i++) { h = (h * 33 + id.charCodeAt(i)) >>> 0; }
  const base = h.toString(16).padStart(8, "0");
  return (base.repeat(8)).slice(0, 64);
}

// Seed a QUARANTINED row (observation evidence present so P1H-1 all-or-none holds).
async function seedQuarantined(client, o) {
  o = o || {};
  const id = o.id || seed.cuid("sess");
  const mediaClass = o.mediaClass || "photo";
  const ctype = o.ctype || "image/jpeg";
  const bucket = o.bucket || BUCKET;
  const objectKey = o.objectKey || ("sessions/" + id + "/raw");
  const quarSql = `now() - make_interval(mins => ${Number(o.quarantinedAgoMin || 40)})`;
  const obsSize = String(o.obsSize == null ? 1024 : o.obsSize);
  const obsCtype = sqlStr(o.obsCtype || "image/jpeg");
  const obsObj = sqlStr(o.obsObj || ("objid_" + id));
  const obsEtag = sqlStr(o.obsEtag || ('"etag-' + id + '"'));
  await client.query(
    `INSERT INTO public.media_upload_sessions
       (id, owner_user_id, media_class, content_type, declared_byte_size,
        quarantine_bucket, object_key, idempotency_key, status,
        upload_authorized_at, created_at, updated_at,
        observed_byte_size, observed_content_type, observed_storage_object_id,
        observed_storage_etag, quarantined_at,
        validation_claim_generation)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'quarantined',
             now() - interval '2 hours', now() - interval '2 hours', now() - interval '1 hour',
             ${obsSize}, ${obsCtype}, ${obsObj}, ${obsEtag}, ${quarSql}, 0)`,
    [id, o.ownerId || seed.cuid("owner"), mediaClass, ctype,
     o.declared == null ? 1024 : o.declared, bucket, objectKey, o.idem || seed.cuid("idem")],
  );
  return id;
}

// P1I-1 real RPCs.
async function valClaim(client) {
  const r = await client.query("SELECT * FROM public.claim_media_upload_validation()");
  return r.rows;
}
async function valPass(client, a) {
  const r = await client.query(
    `SELECT public.complete_media_upload_validation_pass(
        $1::text,$2::bigint,$3::text,$4::text,$5::text,
        $6::integer,$7::integer,$8::bigint,$9::text,$10::text) AS out`,
    [a.sessionId, a.gen, a.sha256, a.ctype || "image/jpeg", a.container || "jpeg",
     a.w == null ? null : a.w, a.h == null ? null : a.h, a.dur == null ? null : a.dur,
     a.vcodec == null ? null : a.vcodec, a.acodec == null ? null : a.acodec],
  );
  return r.rows[0].out;
}

// Drive a seeded quarantined row all the way to file_safety/passed via the REAL P1I-1
// PASS RPC, so P1I-3 begins from a genuinely valid row. Returns { id, sha }.
async function seedFileSafety(client, o) {
  o = o || {};
  const id = await seedQuarantined(client, o);
  const rows = await valClaim(client);
  eq(rows.length, 1, "seedFileSafety: expected one validation claim (id " + id + ")");
  eq(rows[0].session_id, id, "seedFileSafety: claimed the seeded row");
  const gen = Number(rows[0].validation_claim_generation);
  const sha = o.sha || shaFor(id);
  const out = await valPass(client, {
    sessionId: id, gen, sha256: sha, ctype: "image/jpeg", container: "jpeg", w: 48, h: 24,
  });
  eq(out.status, "file_safety", "seedFileSafety: P1I-1 PASS -> file_safety (" + JSON.stringify(out) + ")");
  return { id, sha };
}

// P1I-3 RPCs.
async function fsClaim(client) {
  const r = await client.query("SELECT * FROM public.claim_media_upload_file_safety()");
  return r.rows;
}
async function fsClean(client, a) {
  const r = await client.query(
    `SELECT public.complete_media_upload_file_safety_clean(
        $1::text,$2::bigint,$3::text,$4::text,$5::text,$6::text) AS out`,
    [a.sessionId, a.gen, a.engine === undefined ? ENGINE : a.engine,
     a.engineVer === undefined ? ENGINE_VER : a.engineVer,
     a.sigVer === undefined ? SIG_VER : a.sigVer, a.sha],
  );
  return r.rows[0].out;
}
async function fsMalware(client, a) {
  const r = await client.query(
    `SELECT public.complete_media_upload_file_safety_malware(
        $1::text,$2::bigint,$3::text,$4::text,$5::text,$6::text) AS out`,
    [a.sessionId, a.gen, a.engine === undefined ? ENGINE : a.engine,
     a.engineVer === undefined ? ENGINE_VER : a.engineVer,
     a.sigVer === undefined ? SIG_VER : a.sigVer, a.sha],
  );
  return r.rows[0].out;
}
async function readRow(client, id) {
  const q = await client.query(
    `SELECT status,
            file_safety_claim_generation::text     AS gen,
            (file_safety_claimed_at IS NOT NULL)    AS claimed,
            (file_safety_completed_at IS NOT NULL)  AS completed,
            file_safety_outcome                     AS fsout,
            scanner_engine                          AS engine,
            scanner_engine_version                  AS engine_ver,
            scanner_signature_version               AS sig_ver,
            scanner_scanned_sha256                  AS scanned_sha,
            rejected_reason                         AS rreason,
            validation_outcome                      AS voutcome,
            actual_sha256                           AS sha
       FROM public.media_upload_sessions WHERE id = $1`, [id]);
  return q.rows[0];
}
async function applyFile(client, p) {
  await client.query(fs.readFileSync(p, "utf8"));
}

// Seed a file_safety/passed row and CLAIM it via P1I-3 → gen 1. Returns { id, sha, gen }.
async function seedFsAndClaim(client, o) {
  const { id, sha } = await seedFileSafety(client, o);
  const rows = await fsClaim(client);
  eq(rows.length, 1, "seedFsAndClaim: expected exactly one file-safety claim");
  eq(rows[0].session_id, id, "seedFsAndClaim: claimed the seeded row");
  eq(String(rows[0].file_safety_claim_generation), "1", "seedFsAndClaim: first fs claim gen=1");
  eq(rows[0].actual_sha256, sha, "seedFsAndClaim: claim returns P1I-2 actual_sha256");
  return { id, sha, gen: 1 };
}

async function main() {
  console.log("SEC-00B-P1I-3 — media upload file-safety-stage DB foundation suite");
  console.log("");
  console.log("[1/3] booting throwaway Postgres cluster …");
  const dsn = await harness.start();
  assertTestDsn(dsn);
  console.log("      dsn = " + dsn);

  const admin = await conn(dsn);
  console.log("[2/3] base schema + P1G-1 + P1H-1 + P1I-1 + P1I-3 migrations …");
  await admin.query(MINIMAL_SCHEMA);
  await applyFile(admin, MIG_P1G1);
  await applyFile(admin, MIG_P1H1);
  await applyFile(admin, MIG_P1I1);
  await applyFile(admin, MIG_P1I3);

  console.log("[3/3] running structural + DB-contract checks …");
  console.log("");

  // ── S1: additive — prior P1I-1/P1H-1/P1G-1 columns + constraints preserved ───
  await t("S1. additive: prior validation/observation/janitor columns + constraints preserved", async () => {
    const cols = (await admin.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema='public' AND table_name='media_upload_sessions'`)).rows.map(r => r.column_name);
    ["validation_outcome", "validation_claim_generation", "actual_sha256", "detected_container",
     "quarantine_deleted_at", "quarantined_at", "observed_byte_size", "observed_storage_object_id",
     "observed_storage_etag", "rejected_reason"].forEach(c =>
      truthy(cols.includes(c), "prior column preserved: " + c));
    const cons = (await admin.query(
      `SELECT conname FROM pg_constraint WHERE conrelid='public.media_upload_sessions'::regclass`)).rows.map(r => r.conname);
    ["chk_media_upload_val_complete_pairing", "chk_media_upload_val_pass_evidence",
     "chk_media_upload_obs_all_or_none"].forEach(c =>
      truthy(cons.includes(c), "prior constraint preserved: " + c));
  });

  // ── S2: exactly the 8 locked P1I-3 columns, correct types/nullability ────────
  await t("S2. exactly the eight P1I-3 file-safety columns introduced", async () => {
    const cols = (await admin.query(
      `SELECT column_name, data_type, is_nullable, column_default
         FROM information_schema.columns
        WHERE table_schema='public' AND table_name='media_upload_sessions'`)).rows;
    const byName = {}; cols.forEach(c => { byName[c.column_name] = c; });
    const eight = {
      file_safety_claimed_at: "timestamp with time zone",
      file_safety_claim_generation: "bigint",
      file_safety_completed_at: "timestamp with time zone",
      file_safety_outcome: "text",
      scanner_engine: "text",
      scanner_engine_version: "text",
      scanner_signature_version: "text",
      scanner_scanned_sha256: "text",
    };
    Object.keys(eight).forEach(name => {
      truthy(byName[name], "column present: " + name);
      eq(byName[name].data_type, eight[name], "type of " + name);
    });
    eq(byName.file_safety_claim_generation.is_nullable, "NO", "fs generation NOT NULL");
    truthy((byName.file_safety_claim_generation.column_default || "").indexOf("0") >= 0, "fs generation default 0");
    ["file_safety_claimed_at", "file_safety_completed_at", "file_safety_outcome", "scanner_engine",
     "scanner_engine_version", "scanner_signature_version", "scanner_scanned_sha256"].forEach(n =>
      eq(byName[n].is_nullable, "YES", n + " nullable"));
  });

  // ── S3: the six P1I-3 CHECK constraints present + generation never negative ──
  await t("S3. six stable-named P1I-3 CHECK constraints; generation never negative", async () => {
    const cons = (await admin.query(
      `SELECT conname FROM pg_constraint WHERE conrelid='public.media_upload_sessions'::regclass`)).rows.map(r => r.conname);
    ["chk_media_upload_fs_generation_nonneg", "chk_media_upload_fs_claim_generation",
     "chk_media_upload_fs_outcome", "chk_media_upload_fs_complete_pairing",
     "chk_media_upload_fs_scanned_sha_shape", "chk_media_upload_fs_evidence"].forEach(c =>
      truthy(cons.includes(c), "P1I-3 constraint present: " + c));
    await reset(admin);
    const id = await seedQuarantined(admin, {});
    await throwsRpc(() => admin.query(
      "UPDATE public.media_upload_sessions SET file_safety_claim_generation = -1 WHERE id=$1", [id]),
      "negative fs generation must violate the CHECK");
  });

  // ── S4: all three RPCs SECURITY INVOKER + pinned safe search_path ────────────
  await t("S4. three RPCs are SECURITY INVOKER with pinned search_path", async () => {
    const r = await admin.query(
      `SELECT proname, prosecdef, proconfig FROM pg_proc
        WHERE pronamespace='public'::regnamespace
          AND proname IN ('claim_media_upload_file_safety',
                          'complete_media_upload_file_safety_clean',
                          'complete_media_upload_file_safety_malware')`);
    eq(r.rows.length, 3, "three P1I-3 RPCs present");
    r.rows.forEach(row => {
      eq(row.prosecdef, false, row.proname + " is SECURITY INVOKER");
      truthy(/search_path=pg_catalog, public/.test((row.proconfig || []).join(",")),
        row.proname + " pins search_path");
    });
  });

  // ── S5: claim has NO params; complete RPCs carry NO caller reason arg ────────
  await t("S5. claim takes no params; complete RPCs have no caller-settable reason", async () => {
    const r = await admin.query(
      `SELECT proname, pg_get_function_arguments(oid) AS args FROM pg_proc
        WHERE pronamespace='public'::regnamespace
          AND proname IN ('claim_media_upload_file_safety',
                          'complete_media_upload_file_safety_clean',
                          'complete_media_upload_file_safety_malware')`);
    const byName = {}; r.rows.forEach(row => { byName[row.proname] = row.args; });
    eq(byName.claim_media_upload_file_safety.trim(), "", "claim takes NO parameters");
    ["complete_media_upload_file_safety_clean", "complete_media_upload_file_safety_malware"].forEach(fn => {
      const a = byName[fn];
      truthy(!/reason|rejected_reason|lease|ttl|batch|claimed_at|\bnow\b|timestamp/i.test(a),
        fn + " has no reason/lease/ttl/batch/timestamp arg: " + a);
      truthy(/p_file_safety_generation/.test(a), fn + " fences on generation");
      truthy(/p_scanner_scanned_sha256/.test(a), fn + " binds the scanned sha");
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // §12 DB-CONTRACT (15 material proofs)
  // ══════════════════════════════════════════════════════════════════════════

  // §12.1 — a file_safety/passed row is CLAIMABLE (gen 1) + bounded return shape.
  await t("§12.1 claim file_safety/passed row -> gen 1 + bounded fields (incl P1I-2 actual_sha256)", async () => {
    await reset(admin);
    const { id, sha } = await seedFileSafety(admin, {});
    const rows = await fsClaim(admin);
    eq(rows.length, 1, "one job claimed");
    eq(rows[0].session_id, id, "claimed the seeded row");
    eq(String(rows[0].file_safety_claim_generation), "1", "first claim generation 1");
    eq(rows[0].actual_sha256, sha, "claim returns the P1I-2 actual_sha256");
    truthy(rows[0].observed_storage_object_id != null, "returns observed_storage_object_id (TOCTOU anchor)");
    truthy(rows[0].observed_storage_etag != null, "returns observed_storage_etag (TOCTOU anchor)");
    truthy(rows[0].observed_byte_size != null, "returns observed_byte_size (TOCTOU anchor)");
    const keys = Object.keys(rows[0]).sort();
    const expected = ["actual_sha256", "file_safety_claim_generation", "object_key",
      "observed_byte_size", "observed_storage_etag", "observed_storage_object_id",
      "quarantine_bucket", "session_id"].sort();
    eq(JSON.stringify(keys), JSON.stringify(expected), "exact bounded field set (no owner/secret leak)");
    truthy(!keys.includes("owner_user_id"), "no owner_user_id leaked");
    // status stays file_safety while in flight (claim never advances the lifecycle)
    eq((await readRow(admin, id)).status, "file_safety", "status stays file_safety after claim");
  });

  // §12.2 — batch = 1: two claimable jobs, one claim() returns exactly one.
  await t("§12.2 batch = 1: two claimable jobs -> a single claim returns exactly one", async () => {
    await reset(admin);
    await seedFileSafety(admin, { quarantinedAgoMin: 40 });
    await seedFileSafety(admin, { quarantinedAgoMin: 30 });
    const rows = await fsClaim(admin);
    eq(rows.length, 1, "exactly one job per claim call");
  });

  // §12.3 — generation increments on each (re)claim of the same row.
  await t("§12.3 generation increments 1 -> 2 on stale-lease reclaim", async () => {
    await reset(admin);
    const { id } = await seedFsAndClaim(admin, {});
    // age the lease past 15m so the row is reclaimable
    await admin.query(
      "UPDATE public.media_upload_sessions SET file_safety_claimed_at = now() - interval '16 minutes' WHERE id=$1", [id]);
    const rows = await fsClaim(admin);
    eq(rows.length, 1, "stale lease reclaimed");
    eq(String(rows[0].file_safety_claim_generation), "2", "generation 1 -> 2 on reclaim");
    eq((await readRow(admin, id)).gen, "2", "row generation == 2");
  });

  // §12.4 — two real concurrent claimers, TWO jobs -> disjoint claims.
  const w2 = await conn(dsn);
  await t("§12.4 two real concurrent claimers, TWO jobs -> disjoint claims", async () => {
    await reset(admin);
    const a1 = await seedFileSafety(admin, { quarantinedAgoMin: 40 });
    const a2 = await seedFileSafety(admin, { quarantinedAgoMin: 30 });
    const [a, b] = await Promise.all([fsClaim(admin), fsClaim(w2)]);
    eq(a.length, 1, "claimer A got exactly one");
    eq(b.length, 1, "claimer B got exactly one");
    truthy(a[0].session_id !== b[0].session_id, "no duplicate session_id across claimers");
    const ids = [a[0].session_id, b[0].session_id].sort();
    eq(JSON.stringify(ids), JSON.stringify([a1.id, a2.id].sort()), "disjoint: both distinct jobs claimed");
  });

  // §12.5 — two real concurrent claimers, ONE job -> exactly one wins.
  await t("§12.5 two real concurrent claimers, ONE job -> exactly one wins (no duplicate)", async () => {
    await reset(admin);
    const { id } = await seedFileSafety(admin, {});
    const [a, b] = await Promise.all([fsClaim(admin), fsClaim(w2)]);
    const got = [...a, ...b];
    eq(got.length, 1, "exactly ONE job across both claimers");
    eq(got[0].session_id, id, "the one eligible job");
    eq(String(got[0].file_safety_claim_generation), "1", "generation incremented exactly once");
    eq((await readRow(admin, id)).gen, "1", "row generation == 1 (single increment)");
  });

  // §12.6 — stale-lease reclaim boundary: >15m reclaimed (fresh claimed_at); 14:40 not.
  await t("§12.6 post-lock boundary: >15m reclaimed (fresh claimed_at); 14:40 not reclaimed", async () => {
    await reset(admin);
    const staleRow = await seedFsAndClaim(admin, {});
    const freshRow = await seedFsAndClaim(admin, {});
    await admin.query(
      "UPDATE public.media_upload_sessions SET file_safety_claimed_at = now() - make_interval(secs => 15*60+3) WHERE id=$1", [staleRow.id]);
    await admin.query(
      "UPDATE public.media_upload_sessions SET file_safety_claimed_at = now() - make_interval(secs => 14*60+40) WHERE id=$1", [freshRow.id]);
    const rows = await fsClaim(admin);
    eq(rows.length, 1, "exactly one reclaim");
    eq(rows[0].session_id, staleRow.id, "reclaimed the >15m row, not the 14:40 row");
    eq(String(rows[0].file_safety_claim_generation), "2", "reclaim generation 1 -> 2");
    const skew = (await admin.query(
      "SELECT abs(EXTRACT(EPOCH FROM (file_safety_claimed_at - now())))::int AS s FROM public.media_upload_sessions WHERE id=$1",
      [staleRow.id])).rows[0].s;
    truthy(skew <= 5, "reclaimed claimed_at re-stamped to post-lock now (skew " + skew + "s)");
    const fr = await readRow(admin, freshRow.id);
    eq(fr.gen, "1", "14:40 row generation unchanged");
  });

  // §12.7 — a STALE generation cannot complete (state_conflict, ZERO mutation).
  await t("§12.7 stale generation cannot complete_clean (state_conflict, zero mutation)", async () => {
    await reset(admin);
    const { id, sha } = await seedFsAndClaim(admin, {}); // gen 1
    const out = await fsClean(admin, { sessionId: id, gen: 999, sha });
    eq(out.outcome, "state_conflict", "stale generation -> state_conflict");
    const r = await readRow(admin, id);
    eq(r.status, "file_safety", "status unchanged (still file_safety)");
    eq(r.completed, false, "not completed"); eq(r.fsout, null, "no outcome recorded");
  });

  // §12.8 — CLEAN completion: file_safety -> media_processing (+ evidence).
  await t("§12.8 clean completion: file_safety -> media_processing + scanner evidence", async () => {
    await reset(admin);
    const { id, sha } = await seedFsAndClaim(admin, {});
    const out = await fsClean(admin, { sessionId: id, gen: 1, sha });
    eq(out.outcome, "applied", "clean applied");
    eq(out.status, "media_processing", "-> media_processing");
    const r = await readRow(admin, id);
    eq(r.status, "media_processing", "status media_processing");
    eq(r.fsout, "clean", "file_safety_outcome clean");
    eq(r.completed, true, "completed_at stamped");
    eq(r.engine, ENGINE, "scanner_engine recorded");
    eq(r.engine_ver, ENGINE_VER, "scanner_engine_version recorded");
    eq(r.sig_ver, SIG_VER, "scanner_signature_version recorded");
    eq(r.scanned_sha, sha, "scanner_scanned_sha256 == P1I-2 actual_sha256");
    eq(r.rreason, null, "clean never sets rejected_reason");
  });

  // §12.9 — MALWARE completion: file_safety -> rejected.
  await t("§12.9 malware completion: file_safety -> rejected", async () => {
    await reset(admin);
    const { id, sha } = await seedFsAndClaim(admin, {});
    const out = await fsMalware(admin, { sessionId: id, gen: 1, sha });
    eq(out.outcome, "applied", "malware applied");
    eq(out.status, "rejected", "-> rejected");
    const r = await readRow(admin, id);
    eq(r.status, "rejected", "status rejected");
    eq(r.fsout, "malware_detected", "file_safety_outcome malware_detected");
    eq(r.completed, true, "completed_at stamped");
    eq(r.scanned_sha, sha, "scanner_scanned_sha256 recorded");
  });

  // §12.10 — rejected_reason is EXACTLY 'malware_detected' and NOT caller-supplied.
  await t("§12.10 malware sets rejected_reason='malware_detected' (never caller-supplied)", async () => {
    await reset(admin);
    const { id, sha } = await seedFsAndClaim(admin, {});
    await fsMalware(admin, { sessionId: id, gen: 1, sha });
    eq((await readRow(admin, id)).rreason, "malware_detected", "rejected_reason hardcoded to malware_detected");
    // Structurally proven in S5 that no caller reason arg exists — the token is RPC-owned.
    // And P1I-1's validation rejection RPC forbids this token (contract boundary).
    await reset(admin);
    const fs2 = await seedFsAndClaim(admin, {});
    await throwsRpc(async () => {
      await admin.query(
        `SELECT public.complete_media_upload_validation_rejection($1::text,$2::bigint,$3::text)`,
        [fs2.id, 1, "malware_detected"]);
    }, "P1I-1 rejection RPC refuses the malware_detected token (owned by P1I-3)");
  });

  // §12.11 — scanned-SHA mismatch cannot complete (clean AND malware).
  await t("§12.11 scanned-SHA mismatch cannot complete (clean + malware -> sha_mismatch, zero mutation)", async () => {
    await reset(admin);
    const { id } = await seedFsAndClaim(admin, {}); // gen 1, real sha ignored below
    const wrong = "b".repeat(64);
    const c1 = await fsClean(admin, { sessionId: id, gen: 1, sha: wrong });
    eq(c1.outcome, "sha_mismatch", "clean with wrong sha -> sha_mismatch");
    const m1 = await fsMalware(admin, { sessionId: id, gen: 1, sha: wrong });
    eq(m1.outcome, "sha_mismatch", "malware with wrong sha -> sha_mismatch");
    const r = await readRow(admin, id);
    eq(r.status, "file_safety", "status unchanged (still file_safety)");
    eq(r.completed, false, "not completed"); eq(r.fsout, null, "no outcome recorded");
  });

  // §12.12 — clean-without-passed-evidence fails closed.
  await t("§12.12 no passed-evidence fails closed: unclaimable + complete state_conflict", async () => {
    // (a) a still-validating row (not yet passed) is NEVER claimable by P1I-3.
    await reset(admin);
    const vid = await seedQuarantined(admin, {});
    const vrows = await valClaim(admin); // -> validating, NOT file_safety/passed
    eq(vrows.length, 1, "validation claim taken");
    eq((await fsClaim(admin)).length, 0, "a validating (non-passed) row is not file-safety claimable");
    // (b) claim a genuine file_safety row, then strip its passed evidence -> complete fails closed.
    await reset(admin);
    const { id, sha } = await seedFsAndClaim(admin, {});
    await admin.query(
      `UPDATE public.media_upload_sessions
          SET validation_outcome = NULL, validation_completed_at = NULL
        WHERE id=$1`, [id]); // still satisfies the P1I-1 pairing (both null)
    const out = await fsClean(admin, { sessionId: id, gen: 1, sha });
    eq(out.outcome, "state_conflict", "complete on a row lacking passed evidence -> state_conflict");
    eq((await readRow(admin, id)).status, "file_safety", "zero mutation");
  });

  // §12.13 — already-completed cannot be overwritten.
  await t("§12.13 already-completed cannot overwrite (clean/malware -> state_conflict)", async () => {
    await reset(admin);
    const { id, sha } = await seedFsAndClaim(admin, {});
    eq((await fsClean(admin, { sessionId: id, gen: 1, sha })).outcome, "applied", "first clean applied");
    // a second clean at the same generation is refused (completed_at present)
    eq((await fsClean(admin, { sessionId: id, gen: 1, sha })).outcome, "state_conflict", "re-clean refused");
    // a malware overwrite is refused too
    eq((await fsMalware(admin, { sessionId: id, gen: 1, sha })).outcome, "state_conflict", "malware-overwrite refused");
    eq((await readRow(admin, id)).status, "media_processing", "status stays media_processing (not flipped to rejected)");
  });

  // §12.14 — a purged (expired+deleted) object cannot complete + is unclaimable.
  // NB: P1G-1 (chk_media_upload_quar_deleted_expired) forbids quarantine_deleted_at
  // on a non-'expired' row, so the ONLY schema-valid "deleted" state is the janitor
  // having expired the stale lease AND purged the object.
  await t("§12.14 purged (expired+deleted) object cannot complete + is not claimable", async () => {
    await reset(admin);
    const { id, sha } = await seedFsAndClaim(admin, {}); // gen 1 claimed
    await admin.query(
      "UPDATE public.media_upload_sessions SET status='expired', quarantine_deleted_at = now() WHERE id=$1", [id]);
    const out = await fsClean(admin, { sessionId: id, gen: 1, sha });
    eq(out.outcome, "state_conflict", "clean on a purged (expired+deleted) object -> state_conflict");
    const r = await readRow(admin, id);
    eq(r.status, "expired", "zero mutation: stays expired (never media_processing)");
    eq(r.completed, false, "not completed"); eq(r.fsout, null, "no outcome recorded");
    // a purged object is never handed out by claim
    await reset(admin);
    await seedFileSafety(admin, {});
    await admin.query("UPDATE public.media_upload_sessions SET status='expired', quarantine_deleted_at = now()");
    eq((await fsClaim(admin)).length, 0, "purged object is not claimable");
  });

  // §12.15 — service_role-only EXECUTE privilege on all three RPCs.
  await t("§12.15 EXECUTE privilege: service_role only; PUBLIC/anon/authenticated/arbitrary denied", async () => {
    const fns = [
      "public.claim_media_upload_file_safety()",
      "public.complete_media_upload_file_safety_clean(text,bigint,text,text,text,text)",
      "public.complete_media_upload_file_safety_malware(text,bigint,text,text,text,text)",
    ];
    for (const f of fns) {
      const q = await admin.query(
        `SELECT has_function_privilege('service_role',$1,'EXECUTE') AS svc,
                has_function_privilege('anon',$1,'EXECUTE') AS anon,
                has_function_privilege('authenticated',$1,'EXECUTE') AS auth,
                has_function_privilege('p1i3_probe',$1,'EXECUTE') AS probe`, [f]);
      const r = q.rows[0];
      eq(r.svc, true, "service_role EXECUTE: " + f);
      eq(r.anon, false, "anon denied: " + f);
      eq(r.auth, false, "authenticated denied: " + f);
      eq(r.probe, false, "arbitrary role (PUBLIC) denied: " + f);
    }
  });

  // ── X1: fail-closed structural input raises (null id / gen<1 / blank engine / bad sha) ──
  await t("X1. fail-closed structural input on both completion RPCs (RAISE, zero mutation)", async () => {
    await reset(admin);
    const { id, sha } = await seedFsAndClaim(admin, {});
    for (const fn of [fsClean, fsMalware]) {
      await throwsRpc(() => fn(admin, { sessionId: null, gen: 1, sha }), "null session_id raises");
      await throwsRpc(() => fn(admin, { sessionId: id, gen: 0, sha }), "generation < 1 raises");
      await throwsRpc(() => fn(admin, { sessionId: id, gen: 1, engine: "   ", sha }), "blank scanner_engine raises");
      await throwsRpc(() => fn(admin, { sessionId: id, gen: 1, sha: "zz" }), "malformed scanned sha raises");
      await throwsRpc(() => fn(admin, { sessionId: id, gen: 1, sha: "A".repeat(64) }), "uppercase sha raises (shape)");
    }
    eq((await readRow(admin, id)).status, "file_safety", "no mutation from any refused input");
  });

  // ── X2: migration code performs NO byte read / storage / ClamAV in-DB ────────
  await t("X2. migration code introduces no scanner byte-read / storage / READY scope", async () => {
    const src = fs.readFileSync(MIG_P1I3, "utf8");
    const code = src.split("\n").map(l => l.replace(/--.*$/, "")).join("\n");
    truthy(!/instream|zinstream|storage\.objects|createsignedurl|arraybuffer|\.download|net\.socket/i.test(code),
      "no scanner byte-reader/storage/socket in SQL code");
    truthy(!/'ready'/.test(code), "code never sets ready (P1J owns READY)");
    truthy(/status\s*=\s*'media_processing'/.test(code), "clean sets media_processing");
    truthy(/status\s*=\s*'rejected'/.test(code), "malware sets rejected");
    truthy(/'malware_detected'/.test(code), "malware_detected token owned here");
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
  console.error("SUITE ERROR:", e && e.stack ? e.stack : e);
  try { await harness.stop(); } catch (_) { /* ignore */ }
  process.exit(1);
});
