#!/usr/bin/env node
/* eslint-disable no-console */
// ═════════════════════════════════════════════════════════════════════════
// SEC-00B-P1G-1 — real-Postgres suite for the quarantine-cleanup CLAIM/LEASE
// foundation (public.claim_media_upload_quarantine_cleanup +
// public.complete_media_upload_quarantine_cleanup).
//
//   Run:  node tests/concurrency/media-upload-quarantine-janitor.pg.test.js
//
// Spins up a THROWAWAY Postgres cluster on a private Unix socket (shared
// harness), creates ONLY the minimum media_upload_sessions base schema + the
// anon/authenticated/service_role roles the migration's grants reference, then
// applies migrations/2026-09-07-sec00b-p1g-1-media-upload-quarantine-janitor-claim.sql
// and exercises J1–J17. All concurrency is REAL — each parallel caller gets its
// own pg.Client. The dsn-guard refuses any DSN that is not the throwaway socket,
// so this NEVER touches Supabase / staging / production. It re-uses the shared
// .pg-harness / dsn-guard / seed helpers unchanged and touches NO other test.
// There is ZERO storage / object deletion here — this is DB claim/lease only.
// If postgres binaries are unavailable the shared harness exits NON-ZERO
// (unproven) — a SKIP is never a PASS.
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
const MIGRATION = path.join(REPO, "migrations", "2026-09-07-sec00b-p1g-1-media-upload-quarantine-janitor-claim.sql");
const FN_CLAIM = "public.claim_media_upload_quarantine_cleanup()";
const FN_COMPLETE = "public.complete_media_upload_quarantine_cleanup(text)";
const BUCKET = "social-media-quarantine";

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

// ── minimum base schema + roles the migration reaches ──────────────────────
// The P1A media SQL is intentionally NOT reconstructed. We declare only the
// base columns; the P1G-1 migration adds the two janitor columns + constraints +
// partial index. Roles must exist BEFORE the migration is applied.
const MINIMAL_SCHEMA = `
DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE p1g_probe; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

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
// claim RPC — NO arguments. Returns rows [{session_id, quarantine_bucket, object_key}].
async function claim(client) {
  const r = await client.query("SELECT session_id, quarantine_bucket, object_key FROM public.claim_media_upload_quarantine_cleanup()");
  return r.rows;
}
async function complete(client, sessionId) {
  const r = await client.query("SELECT public.complete_media_upload_quarantine_cleanup($1::text) AS out", [sessionId]);
  return r.rows[0].out;
}
// Seed a row. status/expiresSql/claimedSql/deletedSql/uaSql are TEST-CONTROLLED
// constant SQL expressions (never user input), so they are inlined. updatedAgoSecs
// ages updated_at into the past so a fresh DB-clock write is visibly distinct.
async function seedRow(client, o) {
  const id = o.id || seed.cuid("sess");
  const exp = o.expiresSql && o.expiresSql !== "null" ? o.expiresSql : "NULL";
  const claimed = o.claimedSql && o.claimedSql !== "null" ? o.claimedSql : "NULL";
  const deleted = o.deletedSql && o.deletedSql !== "null" ? o.deletedSql : "NULL";
  const ua = o.uaSql && o.uaSql !== "null" ? o.uaSql : "NULL";
  const updAgo = o.updatedAgoSecs == null ? 3600 : o.updatedAgoSecs;
  await client.query(
    `INSERT INTO public.media_upload_sessions
       (id, owner_user_id, media_class, content_type, declared_byte_size,
        quarantine_bucket, object_key, idempotency_key, status,
        upload_authorized_at, rejected_reason, created_at, updated_at, expires_at,
        quarantine_cleanup_claimed_at, quarantine_deleted_at)
     VALUES ($1,$2,'photo','image/jpeg',1024,'${BUCKET}',$3,$4,$5,
             ${ua}, NULL,
             now() - interval '2 hours', now() - make_interval(secs => $6::int), ${exp},
             ${claimed}, ${deleted})`,
    [id, o.ownerId || seed.cuid("owner"), o.objectKey || ("sessions/" + id + "/raw"), o.idem || seed.cuid("idem"), o.status || "created", updAgo],
  );
  return id;
}
async function readRow(client, id) {
  const q = await client.query(
    `SELECT status,
            quarantine_cleanup_claimed_at::text AS claim,
            quarantine_deleted_at::text         AS del,
            updated_at::text                    AS upd,
            upload_authorized_at::text          AS ua,
            (quarantine_cleanup_claimed_at = updated_at) AS claim_eq_upd,
            abs(EXTRACT(EPOCH FROM (updated_at - now())))::int AS upd_skew
       FROM public.media_upload_sessions WHERE id = $1`, [id]);
  return q.rows[0];
}
const ids = (rows) => rows.map((r) => r.session_id);

async function main() {
  console.log("SEC-00B-P1G-1 — quarantine janitor DB claim/lease suite");
  console.log("");
  console.log("[1/3] booting throwaway Postgres cluster …");
  const dsn = await harness.start();
  assertTestDsn(dsn);
  console.log("      dsn = " + dsn);

  console.log("[2/3] applying minimal schema + roles + the P1G-1 migration …");
  {
    const c = await conn(dsn);
    try {
      await c.query(MINIMAL_SCHEMA);
      await c.query(fs.readFileSync(MIGRATION, "utf8"));
    } finally {
      await c.end();
    }
  }

  console.log("[3/3] running tests J1–J17 …");
  console.log("");

  // ── J1 — expired CREATED row is claimed + transitions to expired ───────
  await t("J1. expired CREATED -> claimed, status expired, claim=updated_at=fresh", async () => {
    const c = await conn(dsn);
    try {
      await reset(c);
      const id = await seedRow(c, { status: "created", expiresSql: "now() - interval '1 minute'", updatedAgoSecs: 3600 });
      const rows = await claim(c);
      eq(rows.length, 1, "one row claimed");
      eq(rows[0].session_id, id, "returned session id");
      eq(rows[0].quarantine_bucket, BUCKET, "returned bucket");
      eq(rows[0].object_key, "sessions/" + id + "/raw", "returned object key");
      const row = await readRow(c, id);
      eq(row.status, "expired", "status -> expired");
      truthy(row.claim, "claim timestamp populated");
      eq(row.claim_eq_upd, true, "claim == updated_at (newly expired)");
      truthy(row.upd_skew <= 30, "updated_at is fresh DB clock");
    } finally { await c.end(); }
  });

  // ── J2 — expired UPLOAD_AUTHORIZED transitions safely to expired ───────
  await t("J2. expired UPLOAD_AUTHORIZED -> expired; upload_authorized_at UNCHANGED", async () => {
    const c = await conn(dsn);
    try {
      await reset(c);
      const id = await seedRow(c, { status: "upload_authorized", expiresSql: "now() - interval '5 minutes'", uaSql: "now() - interval '2 hours'", updatedAgoSecs: 3600 });
      const before = await readRow(c, id);
      const rows = await claim(c);
      eq(rows.length, 1, "one row claimed");
      eq(rows[0].session_id, id, "returned id");
      const row = await readRow(c, id);
      eq(row.status, "expired", "status -> expired");
      truthy(row.claim, "claim populated");
      eq(row.ua, before.ua, "upload_authorized_at UNCHANGED");
      truthy(row.upd_skew <= 30, "updated_at fresh");
    } finally { await c.end(); }
  });

  // ── J3 — unexpired created / upload_authorized NOT claimed ─────────────
  await t("J3. unexpired created/upload_authorized -> NOT claimed", async () => {
    const c = await conn(dsn);
    try {
      await reset(c);
      const a = await seedRow(c, { status: "created", expiresSql: "now() + interval '2 hours'" });
      const b = await seedRow(c, { status: "upload_authorized", expiresSql: "now() + interval '3 hours'" });
      const rows = await claim(c);
      eq(rows.length, 0, "nothing claimed");
      eq((await readRow(c, a)).status, "created", "a unchanged");
      eq((await readRow(c, b)).status, "upload_authorized", "b unchanged");
    } finally { await c.end(); }
  });

  // ── J4 — later / non-cleanup statuses NEVER claimed (even if expiry due) ─
  await t("J4. uploading/quarantined/validating/file_safety/media_processing/ready/rejected -> never claimed", async () => {
    const c = await conn(dsn);
    try {
      await reset(c);
      const sts = ["uploading", "quarantined", "validating", "file_safety", "media_processing", "ready", "rejected"];
      const seeded = [];
      for (const s of sts) seeded.push(await seedRow(c, { status: s, expiresSql: "now() - interval '1 hour'" }));
      const rows = await claim(c);
      eq(rows.length, 0, "no later-state row claimed");
      for (let i = 0; i < sts.length; i++) eq((await readRow(c, seeded[i])).status, sts[i], `${sts[i]} unchanged`);
    } finally { await c.end(); }
  });

  // ── J5 — already expired, not deleted, no live lease -> claimable (retry) ─
  await t("J5. expired + not deleted + no live lease -> claimable (retry); updated_at NOT rewritten", async () => {
    const c = await conn(dsn);
    try {
      await reset(c);
      const id = await seedRow(c, { status: "expired", expiresSql: "now() - interval '3 hours'", updatedAgoSecs: 3600 });
      const before = await readRow(c, id);
      const rows = await claim(c);
      eq(rows.length, 1, "expired retry claimed");
      eq(rows[0].session_id, id, "returned id");
      const row = await readRow(c, id);
      eq(row.status, "expired", "stays expired");
      truthy(row.claim, "claim populated");
      eq(row.upd, before.upd, "updated_at NOT rewritten for already-expired retry");
    } finally { await c.end(); }
  });

  // ── J6 — a fresh lease blocks immediate reclaim ────────────────────────
  await t("J6. fresh lease -> row NOT immediately reclaimable", async () => {
    const c = await conn(dsn);
    try {
      await reset(c);
      const id = await seedRow(c, { status: "expired", expiresSql: "now() - interval '1 hour'" });
      const first = await claim(c);
      eq(first.length, 1, "first claim returns it");
      const second = await claim(c);
      eq(second.length, 0, "second immediate claim returns nothing (lease live)");
      truthy(!ids(second).includes(id), "row not reclaimed while lease fresh");
    } finally { await c.end(); }
  });

  // ── J7 — lease aged beyond 10 minutes -> reclaimable ───────────────────
  await t("J7. lease aged > 10 minutes -> reclaimable", async () => {
    const c = await conn(dsn);
    try {
      await reset(c);
      const id = await seedRow(c, { status: "expired", expiresSql: "now() - interval '1 hour'", claimedSql: "now() - interval '11 minutes'" });
      const rows = await claim(c);
      eq(rows.length, 1, "stale-lease row reclaimed");
      eq(rows[0].session_id, id, "returned id");
    } finally { await c.end(); }
  });

  // ── J8 — completion of an expired claimed row ──────────────────────────
  await t("J8. complete expired+claimed -> completed; deleted populated; claim cleared; still expired", async () => {
    const c = await conn(dsn);
    try {
      await reset(c);
      const id = await seedRow(c, { status: "expired", expiresSql: "now() - interval '1 hour'", claimedSql: "now() - interval '1 minute'" });
      const out = await complete(c, id);
      eq(out.outcome, "completed", "outcome completed");
      const row = await readRow(c, id);
      eq(row.status, "expired", "status remains expired");
      truthy(row.del, "quarantine_deleted_at populated");
      eq(row.claim, null, "claim cleared to NULL");
    } finally { await c.end(); }
  });

  // ── J9 — a completed (deleted) row is never claimable again ────────────
  await t("J9. completed (deleted) row -> never claimable again", async () => {
    const c = await conn(dsn);
    try {
      await reset(c);
      const id = await seedRow(c, { status: "expired", expiresSql: "now() - interval '2 hours'", deletedSql: "now() - interval '1 minute'" });
      const rows = await claim(c);
      eq(rows.length, 0, "deleted row not claimed");
      truthy(!ids(rows).includes(id), "deleted row absent from claim");
    } finally { await c.end(); }
  });

  // ── J10 — complete wrong-state / unclaimed / already-completed -> conflict ─
  await t("J10. complete wrong-state/unclaimed/already-completed -> state_conflict, ZERO mutation", async () => {
    const c = await conn(dsn);
    try {
      await reset(c);
      // (a) not expired
      const created = await seedRow(c, { status: "created", expiresSql: "now() - interval '1 hour'" });
      let before = await readRow(c, created);
      eq((await complete(c, created)).outcome, "state_conflict", "created -> state_conflict");
      let after = await readRow(c, created);
      eq(after.status + "|" + after.del + "|" + after.claim, before.status + "|" + before.del + "|" + before.claim, "created row unchanged");
      // (b) expired but unclaimed
      const unclaimed = await seedRow(c, { status: "expired", expiresSql: "now() - interval '1 hour'" });
      before = await readRow(c, unclaimed);
      eq((await complete(c, unclaimed)).outcome, "state_conflict", "expired+unclaimed -> state_conflict");
      after = await readRow(c, unclaimed);
      eq(after.del, before.del, "unclaimed row deleted unchanged (still null)");
      eq(after.claim, before.claim, "unclaimed row claim unchanged");
      // (c) already completed (deleted)
      const done = await seedRow(c, { status: "expired", expiresSql: "now() - interval '1 hour'", deletedSql: "now() - interval '2 minutes'" });
      before = await readRow(c, done);
      eq((await complete(c, done)).outcome, "state_conflict", "already-completed -> state_conflict");
      after = await readRow(c, done);
      eq(after.del, before.del, "already-completed deleted timestamp unchanged");
    } finally { await c.end(); }
  });

  // ── J11 — blank session id fails closed ────────────────────────────────
  await t("J11. blank/whitespace session id -> RAISE (fail closed)", async () => {
    const c = await conn(dsn);
    try {
      for (const bad of ["", "   "]) {
        let threw = false;
        try { await complete(c, bad); } catch { threw = true; }
        truthy(threw, `complete("${bad}") throws`);
      }
    } finally { await c.end(); }
  });

  // ── J12 — batch bound: >50 eligible -> exactly 50 max per claim ────────
  await t("J12. >50 eligible -> single claim returns exactly 50 max", async () => {
    const c = await conn(dsn);
    try {
      await reset(c);
      for (let i = 0; i < 55; i++) await seedRow(c, { status: "expired", expiresSql: "now() - interval '1 hour'" });
      const rows = await claim(c);
      eq(rows.length, 50, "claim capped at 50");
    } finally { await c.end(); }
  });

  // ── J13 — concurrent claimers get disjoint batches (SKIP LOCKED) ───────
  await t("J13. concurrent claimers -> disjoint claimed session ids (FOR UPDATE SKIP LOCKED)", async () => {
    const cA = await conn(dsn), cB = await conn(dsn), setup = await conn(dsn);
    try {
      await reset(setup);
      for (let i = 0; i < 60; i++) await seedRow(setup, { status: "expired", expiresSql: "now() - interval '1 hour'" });
      const [rA, rB] = await Promise.all([claim(cA), claim(cB)]);
      const setA = new Set(ids(rA)), setB = new Set(ids(rB));
      let overlap = 0;
      setA.forEach((x) => { if (setB.has(x)) overlap++; });
      eq(overlap, 0, "no session id in both batches (disjoint)");
      const union = new Set([...setA, ...setB]);
      eq(union.size, setA.size + setB.size, "union has no duplicates");
      truthy(rA.length <= 50 && rB.length <= 50, "each batch <= 50");
    } finally { await cA.end(); await cB.end(); await setup.end(); }
  });

  // ── J14 — claim is a DB-fixed no-argument API ──────────────────────────
  await t("J14. claim RPC takes ZERO arguments (no caller time/limit/lease/cutoff)", async () => {
    const c = await conn(dsn);
    try {
      const q = await c.query(`SELECT pronargs FROM pg_proc WHERE oid = $1::regprocedure`, [FN_CLAIM]);
      eq(q.rows[0].pronargs, 0, "claim function has 0 parameters");
    } finally { await c.end(); }
  });

  // ── J15 — both functions SECURITY INVOKER (prosecdef=false) ────────────
  await t("J15. both janitor functions are SECURITY INVOKER (prosecdef=false)", async () => {
    const c = await conn(dsn);
    try {
      const a = await c.query(`SELECT prosecdef FROM pg_proc WHERE oid = $1::regprocedure`, [FN_CLAIM]);
      const b = await c.query(`SELECT prosecdef FROM pg_proc WHERE oid = $1::regprocedure`, [FN_COMPLETE]);
      eq(a.rows[0].prosecdef, false, "claim SECURITY INVOKER");
      eq(b.rows[0].prosecdef, false, "complete SECURITY INVOKER");
    } finally { await c.end(); }
  });

  // ── J16 — EXECUTE privilege: service_role ONLY ─────────────────────────
  await t("J16. EXECUTE granted to service_role ONLY (PUBLIC/anon/authenticated denied) for both", async () => {
    const c = await conn(dsn);
    try {
      for (const [label, sig] of [["claim", FN_CLAIM], ["complete", FN_COMPLETE]]) {
        const q = await c.query(
          `SELECT has_function_privilege('p1g_probe', $1, 'EXECUTE')     AS probe,
                  has_function_privilege('anon', $1, 'EXECUTE')          AS anon,
                  has_function_privilege('authenticated', $1, 'EXECUTE') AS authed,
                  has_function_privilege('service_role', $1, 'EXECUTE')  AS svc`, [sig]);
        const row = q.rows[0];
        eq(row.probe, false, `${label}: PUBLIC/probe denied`);
        eq(row.anon, false, `${label}: anon denied`);
        eq(row.authed, false, `${label}: authenticated denied`);
        eq(row.svc, true, `${label}: service_role granted`);
      }
    } finally { await c.end(); }
  });

  // ── J17 — CHECK constraints forbid claim/deleted on non-expired status ─
  await t("J17. claim/deleted timestamps cannot persist on non-expired status (CHECK constraints)", async () => {
    const c = await conn(dsn);
    try {
      await reset(c);
      // claim on a non-expired (created) row -> violates chk_...claim_expired
      let threw = false;
      try { await seedRow(c, { status: "created", claimedSql: "now()" }); } catch { threw = true; }
      truthy(threw, "claimed_at on status=created rejected");
      // deleted on a non-expired (upload_authorized) row -> violates chk_...deleted_expired
      threw = false;
      try { await seedRow(c, { status: "upload_authorized", deletedSql: "now()" }); } catch { threw = true; }
      truthy(threw, "deleted_at on status=upload_authorized rejected");
      // deleted + claimed both set on expired -> violates chk_...deleted_not_leased
      threw = false;
      try { await seedRow(c, { status: "expired", claimedSql: "now()", deletedSql: "now()" }); } catch { threw = true; }
      truthy(threw, "deleted + live claim on expired rejected");
      // sanity: claim + deleted individually on expired ARE allowed
      threw = false;
      try {
        await seedRow(c, { status: "expired", claimedSql: "now()" });
        await seedRow(c, { status: "expired", deletedSql: "now()" });
      } catch { threw = true; }
      truthy(!threw, "claim-only and deleted-only on expired are allowed");
    } finally { await c.end(); }
  });

  // ── report ─────────────────────────────────────────────────────────────
  console.log("");
  console.log("RESULT: " + passed + " passed, " + failed + " failed");
  if (failures.length) {
    console.error("\nFAILURES:");
    for (const f of failures) console.error("  ✗ " + f.name + "\n    " + (f.err && f.err.message ? f.err.message : String(f.err)));
  }
  harness.stop();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("\n• FATAL: " + (e && e.stack ? e.stack : String(e)));
  try { harness.stop(); } catch {}
  process.exit(2);
});
