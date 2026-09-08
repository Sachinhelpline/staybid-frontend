#!/usr/bin/env node
/* eslint-disable no-console */
// ═════════════════════════════════════════════════════════════════════════
// SEC-00B-P1H-1 — real-Postgres suite for the ACTUAL FILE OBSERVATION DB gate
// (public.confirm_media_upload_quarantine_observation).
//
//   Run:  node tests/concurrency/media-upload-actual-file-observation.pg.test.js
//
// Spins up a THROWAWAY Postgres cluster on a private Unix socket (shared
// harness), creates ONLY the minimum media_upload_sessions BASE schema + the
// anon/authenticated/service_role roles the migration's grants reference, then
// applies migrations/2026-09-07-sec00b-p1h-1-media-upload-actual-file-observation.sql
// (which ADDs the five observation columns + constraints + the RPC) and exercises
// O1–O20. All concurrency is REAL — each parallel caller gets its own pg.Client.
// The dsn-guard refuses any DSN that is not the throwaway socket, so this NEVER
// touches Supabase / staging / production. It re-uses the shared .pg-harness /
// dsn-guard / seed helpers unchanged and touches NO other test. There is ZERO
// Storage / object read or deletion here — this is the DB observation gate only.
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
const MIGRATION = path.join(REPO, "migrations", "2026-09-07-sec00b-p1h-1-media-upload-actual-file-observation.sql");
const FN_SIG = "public.confirm_media_upload_quarantine_observation(text,text,bigint,text,text,text)";
const BUCKET = "social-media-quarantine";
const CEILING = 104857600;

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

// ── minimum BASE schema + roles the migration reaches ──────────────────────
// The P1A media SQL is intentionally NOT reconstructed. We declare only the base
// columns; the P1H-1 migration adds the five observation columns + constraints +
// the RPC. Roles must exist BEFORE the migration is applied.
const MINIMAL_SCHEMA = `
DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE p1h_probe; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

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
// Invoke the observation CAS RPC. Rejects (throws) when the RPC RAISEs.
async function confirm(client, a) {
  const r = await client.query(
    `SELECT public.confirm_media_upload_quarantine_observation(
        $1::text, $2::text, $3::bigint, $4::text, $5::text, $6::text) AS out`,
    [a.sessionId, a.ownerId, a.size, a.ctype, a.objId, a.etag],
  );
  return r.rows[0].out;
}
function sqlStr(s) { return "'" + String(s).replace(/'/g, "''") + "'"; }
// Seed a row. status/expiresSql/quarantinedSql + the observed_* values are
// TEST-CONTROLLED (never user input) so they are inlined. updated_at/created_at
// are aged into the past so a fresh DB-clock write is visibly distinct.
async function seedRow(client, o) {
  const id = o.id || seed.cuid("sess");
  const exp = o.expiresSql && o.expiresSql !== "null" ? o.expiresSql : "NULL";
  const quar = o.quarantinedSql && o.quarantinedSql !== "null" ? o.quarantinedSql : "NULL";
  const obsSize = (o.obsSize === undefined || o.obsSize === null) ? "NULL" : String(o.obsSize);
  const obsCtype = o.obsCtype == null ? "NULL" : sqlStr(o.obsCtype);
  const obsObjId = o.obsObjId == null ? "NULL" : sqlStr(o.obsObjId);
  const obsEtag = o.obsEtag == null ? "NULL" : sqlStr(o.obsEtag);
  const declared = o.declared == null ? 1024 : o.declared;
  const bucket = o.bucket || BUCKET;
  const objectKey = o.objectKey || ("sessions/" + id + "/raw");
  const updAgo = o.updatedAgoSecs == null ? 600 : o.updatedAgoSecs;
  await client.query(
    `INSERT INTO public.media_upload_sessions
       (id, owner_user_id, media_class, content_type, declared_byte_size,
        quarantine_bucket, object_key, idempotency_key, status,
        upload_authorized_at, rejected_reason, created_at, updated_at, expires_at,
        observed_byte_size, observed_content_type, observed_storage_object_id,
        observed_storage_etag, quarantined_at)
     VALUES ($1,$2,'photo',$3,$4,$5,$6,$7,$8,
             now() - interval '30 minutes', NULL,
             now() - interval '30 minutes', now() - make_interval(secs => $9::int), ${exp},
             ${obsSize}, ${obsCtype}, ${obsObjId}, ${obsEtag}, ${quar})`,
    [id, o.ownerId || seed.cuid("owner"), o.ctype || "image/jpeg", declared, bucket,
     objectKey, o.idem || seed.cuid("idem"), o.status || "upload_authorized", updAgo],
  );
  return id;
}
async function readRow(client, id) {
  const q = await client.query(
    `SELECT status,
            observed_byte_size::text                AS osize,
            observed_content_type                   AS octype,
            observed_storage_object_id              AS oobj,
            observed_storage_etag                   AS oetag,
            quarantined_at::text                    AS quar,
            updated_at::text                        AS upd,
            (quarantined_at = updated_at)           AS quar_eq_upd,
            abs(EXTRACT(EPOCH FROM (updated_at - now())))::int AS upd_skew
       FROM public.media_upload_sessions WHERE id = $1`, [id]);
  return q.rows[0];
}
// A default self-consistent valid observation for a seeded upload_authorized row
// (declared 1024, content_type image/jpeg, server bucket + sessions/<id>/raw key).
function validObs(id, ownerId) {
  return { sessionId: id, ownerId, size: 1024, ctype: "image/jpeg", objId: "objid_" + id, etag: '"etag-abc123"' };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log("SEC-00B-P1H-1 — media upload actual-file observation DB gate suite");
  console.log("");
  console.log("[1/3] booting throwaway Postgres cluster …");
  const dsn = await harness.start();
  assertTestDsn(dsn);
  console.log("      dsn = " + dsn);

  console.log("[2/3] applying minimal base schema + roles + the P1H-1 migration …");
  {
    const c = await conn(dsn);
    try {
      await c.query(MINIMAL_SCHEMA);
      await c.query(fs.readFileSync(MIGRATION, "utf8"));
    } finally {
      await c.end();
    }
  }

  console.log("[3/3] running tests O1–O20 …");
  console.log("");

  // ── O1 — valid upload_authorized + exact observation -> applied ────────
  await t("O1. upload_authorized + exact observation -> applied, quarantined, evidence persisted, quarantined_at=updated_at", async () => {
    const c = await conn(dsn);
    try {
      await reset(c);
      const owner = seed.cuid("owner");
      const id = await seedRow(c, { ownerId: owner, status: "upload_authorized", expiresSql: "now() + interval '1 hour'" });
      const obs = validObs(id, owner);
      const r = await confirm(c, obs);
      eq(r.outcome, "applied", "outcome applied");
      eq(r.status, "quarantined", "returned status quarantined");
      const row = await readRow(c, id);
      eq(row.status, "quarantined", "row status quarantined");
      eq(row.osize, "1024", "observed_byte_size persisted exactly");
      eq(row.octype, "image/jpeg", "observed_content_type persisted exactly");
      eq(row.oobj, obs.objId, "observed_storage_object_id persisted exactly");
      eq(row.oetag, obs.etag, "observed_storage_etag persisted exactly");
      truthy(row.quar, "quarantined_at populated");
      eq(row.quar_eq_upd, true, "quarantined_at === updated_at (single DB instant)");
      truthy(row.upd_skew <= 30, "updated_at is the DB clock (≈ now)");
    } finally { await c.end(); }
  });

  // ── O2 — owner mismatch -> state_conflict, ZERO mutation ───────────────
  await t("O2. owner mismatch -> state_conflict, ZERO mutation", async () => {
    const c = await conn(dsn);
    try {
      await reset(c);
      const id = await seedRow(c, { ownerId: seed.cuid("ownerA"), status: "upload_authorized", expiresSql: "now() + interval '1 hour'" });
      const before = await readRow(c, id);
      const r = await confirm(c, { sessionId: id, ownerId: seed.cuid("ownerB"), size: 1024, ctype: "image/jpeg", objId: "o", etag: "e" });
      eq(r.outcome, "state_conflict", "owner mismatch -> state_conflict");
      const after = await readRow(c, id);
      eq(after.status, before.status, "status unchanged (still upload_authorized)");
      eq(after.quar, before.quar, "quarantined_at unchanged (still null)");
      eq(after.osize, before.osize, "observed_byte_size unchanged (still null)");
      eq(after.upd, before.upd, "updated_at unchanged (zero mutation)");
    } finally { await c.end(); }
  });

  // ── O3 — created state -> state_conflict ───────────────────────────────
  await t("O3. created state -> state_conflict, ZERO mutation", async () => {
    const c = await conn(dsn);
    try {
      await reset(c);
      const owner = seed.cuid("owner");
      const id = await seedRow(c, { ownerId: owner, status: "created", expiresSql: "now() + interval '1 hour'" });
      const before = await readRow(c, id);
      const r = await confirm(c, validObs(id, owner));
      eq(r.outcome, "state_conflict", "created -> state_conflict");
      const after = await readRow(c, id);
      eq(after.status, "created", "status unchanged");
      eq(after.quar, before.quar, "quarantined_at unchanged");
      eq(after.upd, before.upd, "updated_at unchanged (zero mutation)");
    } finally { await c.end(); }
  });

  // ── O4 — every later / non-authorized status -> state_conflict ─────────
  await t("O4. uploading/validating/file_safety/media_processing/ready/rejected/expired -> state_conflict", async () => {
    const c = await conn(dsn);
    try {
      const sts = ["uploading", "validating", "file_safety", "media_processing", "ready", "rejected", "expired"];
      for (const s of sts) {
        await reset(c);
        const owner = seed.cuid("owner");
        const id = await seedRow(c, { ownerId: owner, status: s, expiresSql: "now() + interval '1 hour'" });
        const before = await readRow(c, id);
        const r = await confirm(c, validObs(id, owner));
        eq(r.outcome, "state_conflict", s + " -> state_conflict");
        const after = await readRow(c, id);
        eq(after.status, s, s + " status unchanged");
        eq(after.quar, before.quar, s + " quarantined_at unchanged");
        eq(after.upd, before.upd, s + " updated_at unchanged (zero mutation)");
      }
    } finally { await c.end(); }
  });

  // ── O5 — expires_at NULL -> expired outcome, ZERO mutation ─────────────
  await t("O5. upload_authorized + expires_at NULL -> expired, ZERO mutation", async () => {
    const c = await conn(dsn);
    try {
      await reset(c);
      const owner = seed.cuid("owner");
      const id = await seedRow(c, { ownerId: owner, status: "upload_authorized", expiresSql: "null" });
      const before = await readRow(c, id);
      const r = await confirm(c, validObs(id, owner));
      eq(r.outcome, "expired", "null expiry -> expired");
      const after = await readRow(c, id);
      eq(after.status, "upload_authorized", "status unchanged (NOT expired; janitor owns that)");
      eq(after.quar, before.quar, "quarantined_at unchanged (still null)");
      eq(after.upd, before.upd, "updated_at unchanged (zero mutation)");
    } finally { await c.end(); }
  });

  // ── O6 — expires_at <= DB clock -> expired outcome, ZERO mutation ──────
  await t("O6. upload_authorized + expires_at in the past -> expired, ZERO mutation", async () => {
    const c = await conn(dsn);
    try {
      await reset(c);
      const owner = seed.cuid("owner");
      const id = await seedRow(c, { ownerId: owner, status: "upload_authorized", expiresSql: "now() - interval '1 minute'" });
      const before = await readRow(c, id);
      const r = await confirm(c, validObs(id, owner));
      eq(r.outcome, "expired", "past expiry -> expired");
      const after = await readRow(c, id);
      eq(after.status, "upload_authorized", "status unchanged (NOT set to expired here)");
      eq(after.upd, before.upd, "updated_at unchanged (zero mutation)");
    } finally { await c.end(); }
  });

  // ── O7 — observed size != declared -> observation_mismatch ─────────────
  await t("O7. observed byte size != declared -> observation_mismatch, ZERO mutation", async () => {
    const c = await conn(dsn);
    try {
      await reset(c);
      const owner = seed.cuid("owner");
      const id = await seedRow(c, { ownerId: owner, status: "upload_authorized", declared: 1024, expiresSql: "now() + interval '1 hour'" });
      const before = await readRow(c, id);
      const r = await confirm(c, { sessionId: id, ownerId: owner, size: 2048, ctype: "image/jpeg", objId: "o1", etag: "e1" });
      eq(r.outcome, "observation_mismatch", "size mismatch -> observation_mismatch");
      const after = await readRow(c, id);
      eq(after.status, "upload_authorized", "status unchanged");
      eq(after.quar, before.quar, "quarantined_at unchanged");
      eq(after.upd, before.upd, "updated_at unchanged (zero mutation)");
    } finally { await c.end(); }
  });

  // ── O8 — zero / negative / >100 MiB observed size -> fail closed ───────
  await t("O8. observed size 0 / negative / >100MiB -> RAISE (fail closed), ZERO mutation", async () => {
    const c = await conn(dsn);
    try {
      await reset(c);
      const owner = seed.cuid("owner");
      const id = await seedRow(c, { ownerId: owner, status: "upload_authorized", declared: 1024, expiresSql: "now() + interval '1 hour'" });
      for (const bad of [0, -5, CEILING + 1]) {
        let threw = false;
        try { await confirm(c, { sessionId: id, ownerId: owner, size: bad, ctype: "image/jpeg", objId: "o", etag: "e" }); } catch { threw = true; }
        truthy(threw, "size " + bad + " throws (fail closed)");
      }
      eq((await readRow(c, id)).status, "upload_authorized", "row unchanged after fail-closed calls");
    } finally { await c.end(); }
  });

  // ── O9 — observed content type differs -> observation_mismatch ─────────
  await t("O9. observed content type != stored content_type -> observation_mismatch, ZERO mutation", async () => {
    const c = await conn(dsn);
    try {
      await reset(c);
      const owner = seed.cuid("owner");
      const id = await seedRow(c, { ownerId: owner, status: "upload_authorized", ctype: "image/jpeg", expiresSql: "now() + interval '1 hour'" });
      const before = await readRow(c, id);
      const r = await confirm(c, { sessionId: id, ownerId: owner, size: 1024, ctype: "image/png", objId: "o1", etag: "e1" });
      eq(r.outcome, "observation_mismatch", "content-type mismatch -> observation_mismatch");
      const after = await readRow(c, id);
      eq(after.status, "upload_authorized", "status unchanged");
      eq(after.upd, before.upd, "updated_at unchanged (zero mutation)");
    } finally { await c.end(); }
  });

  // ── O10 — wrong quarantine bucket in DB row -> observation_mismatch ────
  await t("O10. wrong quarantine_bucket in DB row -> observation_mismatch, ZERO mutation", async () => {
    const c = await conn(dsn);
    try {
      await reset(c);
      const owner = seed.cuid("owner");
      const id = await seedRow(c, { ownerId: owner, status: "upload_authorized", bucket: "wrong-bucket", expiresSql: "now() + interval '1 hour'" });
      const before = await readRow(c, id);
      const r = await confirm(c, validObs(id, owner));
      eq(r.outcome, "observation_mismatch", "wrong bucket -> observation_mismatch");
      const after = await readRow(c, id);
      eq(after.status, "upload_authorized", "status unchanged");
      eq(after.upd, before.upd, "updated_at unchanged (zero mutation)");
    } finally { await c.end(); }
  });

  // ── O11 — wrong object key in DB row -> observation_mismatch ───────────
  await t("O11. wrong object_key in DB row -> observation_mismatch, ZERO mutation", async () => {
    const c = await conn(dsn);
    try {
      await reset(c);
      const owner = seed.cuid("owner");
      const id = await seedRow(c, { ownerId: owner, status: "upload_authorized", objectKey: "sessions/someone-else/raw", expiresSql: "now() + interval '1 hour'" });
      const before = await readRow(c, id);
      const r = await confirm(c, validObs(id, owner));
      eq(r.outcome, "observation_mismatch", "wrong object key -> observation_mismatch");
      const after = await readRow(c, id);
      eq(after.status, "upload_authorized", "status unchanged");
      eq(after.upd, before.upd, "updated_at unchanged (zero mutation)");
    } finally { await c.end(); }
  });

  // ── O12 — blank / malformed structural observation values -> fail closed ─
  await t("O12. blank/malformed structural observation values -> RAISE, ZERO mutation", async () => {
    const c = await conn(dsn);
    try {
      await reset(c);
      const owner = seed.cuid("owner");
      const id = await seedRow(c, { ownerId: owner, status: "upload_authorized", expiresSql: "now() + interval '1 hour'" });
      const cases = [
        ["blank session id", { sessionId: "", ownerId: owner, size: 1024, ctype: "image/jpeg", objId: "o", etag: "e" }],
        ["whitespace session id", { sessionId: "   ", ownerId: owner, size: 1024, ctype: "image/jpeg", objId: "o", etag: "e" }],
        ["blank owner", { sessionId: id, ownerId: "", size: 1024, ctype: "image/jpeg", objId: "o", etag: "e" }],
        ["whitespace owner", { sessionId: id, ownerId: "  ", size: 1024, ctype: "image/jpeg", objId: "o", etag: "e" }],
        ["blank content type", { sessionId: id, ownerId: owner, size: 1024, ctype: "", objId: "o", etag: "e" }],
        ["whitespace content type", { sessionId: id, ownerId: owner, size: 1024, ctype: "   ", objId: "o", etag: "e" }],
        ["blank object id", { sessionId: id, ownerId: owner, size: 1024, ctype: "image/jpeg", objId: "", etag: "e" }],
        ["whitespace object id", { sessionId: id, ownerId: owner, size: 1024, ctype: "image/jpeg", objId: "   ", etag: "e" }],
        ["blank etag", { sessionId: id, ownerId: owner, size: 1024, ctype: "image/jpeg", objId: "o", etag: "" }],
        ["whitespace etag", { sessionId: id, ownerId: owner, size: 1024, ctype: "image/jpeg", objId: "o", etag: "   " }],
        ["over-long content type", { sessionId: id, ownerId: owner, size: 1024, ctype: "x".repeat(129), objId: "o", etag: "e" }],
        ["over-long object id", { sessionId: id, ownerId: owner, size: 1024, ctype: "image/jpeg", objId: "x".repeat(257), etag: "e" }],
        ["over-long etag", { sessionId: id, ownerId: owner, size: 1024, ctype: "image/jpeg", objId: "o", etag: "x".repeat(513) }],
      ];
      for (const [label, args] of cases) {
        let threw = false;
        try { await confirm(c, args); } catch { threw = true; }
        truthy(threw, label + " throws (fail closed)");
      }
      eq((await readRow(c, id)).status, "upload_authorized", "row unchanged after fail-closed calls (zero mutation)");
    } finally { await c.end(); }
  });

  // ── O13 — already quarantined + exact same observation -> idempotent ───
  await t("O13. already quarantined + identical observation -> idempotent_existing, ZERO rewrite", async () => {
    const c = await conn(dsn);
    try {
      await reset(c);
      const owner = seed.cuid("owner");
      const id = await seedRow(c, {
        ownerId: owner, status: "quarantined", expiresSql: "now() - interval '2 hours'",
        obsSize: 1024, obsCtype: "image/jpeg", obsObjId: "objid_persisted", obsEtag: '"etag-persisted"',
        quarantinedSql: "now() - interval '1 hour'", updatedAgoSecs: 3600,
      });
      const before = await readRow(c, id);
      const r = await confirm(c, { sessionId: id, ownerId: owner, size: 1024, ctype: "image/jpeg", objId: "objid_persisted", etag: '"etag-persisted"' });
      eq(r.outcome, "idempotent_existing", "identical observation -> idempotent_existing");
      eq(r.status, "quarantined", "returned status quarantined");
      const after = await readRow(c, id);
      eq(after.status, "quarantined", "status unchanged");
      eq(after.quar, before.quar, "quarantined_at NOT rewritten");
      eq(after.upd, before.upd, "updated_at NOT rewritten");
      eq(after.osize, before.osize, "observed_byte_size unchanged");
      eq(after.oetag, before.oetag, "observed_storage_etag unchanged");
    } finally { await c.end(); }
  });

  // ── O14 — already quarantined + ANY different observation field -> conflict ─
  await t("O14. already quarantined + any differing observation field -> state_conflict, ZERO mutation", async () => {
    const c = await conn(dsn);
    try {
      const base = { obsSize: 1024, obsCtype: "image/jpeg", obsObjId: "objid_persisted", obsEtag: '"etag-persisted"' };
      const variants = [
        ["size", { size: 2048, ctype: "image/jpeg", objId: "objid_persisted", etag: '"etag-persisted"' }],
        ["ctype", { size: 1024, ctype: "image/png", objId: "objid_persisted", etag: '"etag-persisted"' }],
        ["objId", { size: 1024, ctype: "image/jpeg", objId: "objid_other", etag: '"etag-persisted"' }],
        ["etag", { size: 1024, ctype: "image/jpeg", objId: "objid_persisted", etag: '"etag-other"' }],
      ];
      for (const [label, over] of variants) {
        await reset(c);
        const owner = seed.cuid("owner");
        const id = await seedRow(c, Object.assign({ ownerId: owner, status: "quarantined", expiresSql: "now() - interval '2 hours'", quarantinedSql: "now() - interval '1 hour'", updatedAgoSecs: 3600 }, base));
        const before = await readRow(c, id);
        const r = await confirm(c, Object.assign({ sessionId: id, ownerId: owner }, over));
        eq(r.outcome, "state_conflict", "different " + label + " -> state_conflict");
        const after = await readRow(c, id);
        eq(after.quar, before.quar, label + ": quarantined_at unchanged");
        eq(after.upd, before.upd, label + ": updated_at unchanged (zero mutation)");
        eq(after.osize, before.osize, label + ": observed_byte_size unchanged");
        eq(after.oetag, before.oetag, label + ": observed_storage_etag unchanged");
      }
    } finally { await c.end(); }
  });

  // ── O15 — the observation clock is taken AFTER the row lock ────────────
  await t("O15. clock is taken AFTER the row lock (unexpired at B's txn-start, expired after lock -> expired)", async () => {
    const setup = await conn(dsn);
    let id; const owner = seed.cuid("owner");
    try {
      await reset(setup);
      // Expiry ~1s in the future: B's transaction starts BEFORE expiry, but B only
      // acquires the row lock (and takes clock_timestamp) AFTER expiry has passed.
      id = await seedRow(setup, { ownerId: owner, status: "upload_authorized", expiresSql: "now() + interval '1 second'" });
    } finally { await setup.end(); }
    const cHold = await conn(dsn), cB = await conn(dsn), cCtl = await conn(dsn);
    let resolvedB = false, rB = null, errB = null;
    try {
      // (1) A holds the exact row lock (txn kept open).
      await cHold.query("BEGIN");
      await cHold.query(`SELECT id FROM public.media_upload_sessions WHERE id = $1 FOR UPDATE`, [id]);

      // (2) B starts confirm for the SAME row; its transaction begins now
      //     (txn-start now() would be fixed HERE, still BEFORE expiry) but it
      //     blocks on the row lock.
      const pB = confirm(cB, validObs(id, owner))
        .then((r) => { resolvedB = true; rB = r; })
        .catch((e) => { resolvedB = true; errB = e; });

      // (3) Deterministic block so wall-clock passes expires_at while B waits.
      await sleep(1600);
      truthy(!resolvedB, "B is still pending (blocked on the row lock)");

      // (4) Release A -> (5) B proceeds, takes clock_timestamp() AFTER the lock.
      await cHold.query("ROLLBACK");
      await pB;
      truthy(!errB, "B completed without error");
      eq(rB && rB.outcome, "expired", "B returns expired (clock taken AFTER lock, past expiry) — NOT applied");

      // Row untouched: still upload_authorized, no observation written.
      const row = await readRow(cCtl, id);
      eq(row.status, "upload_authorized", "row stays upload_authorized (zero mutation)");
      eq(row.quar, null, "quarantined_at still null");
    } finally {
      try { await cHold.query("ROLLBACK"); } catch {}
      await cHold.end(); await cB.end(); await cCtl.end();
    }
  });

  // ── O16 — concurrent identical confirmations -> exactly one applies ────
  await t("O16. concurrent identical confirmations -> exactly ONE applied, other idempotent_existing, no double rewrite", async () => {
    const setup = await conn(dsn);
    let id; const owner = seed.cuid("owner");
    try {
      await reset(setup);
      id = await seedRow(setup, { ownerId: owner, status: "upload_authorized", expiresSql: "now() + interval '1 hour'" });
    } finally { await setup.end(); }
    const cA = await conn(dsn), cB = await conn(dsn), cCtl = await conn(dsn);
    try {
      const obs = validObs(id, owner);
      const [rA, rB] = await Promise.all([confirm(cA, obs), confirm(cB, obs)]);
      const outcomes = [rA.outcome, rB.outcome];
      eq(outcomes.filter((o) => o === "applied").length, 1, "exactly one applied");
      eq(outcomes.filter((o) => o === "idempotent_existing").length, 1, "the other is idempotent_existing");
      const row = await readRow(cCtl, id);
      eq(row.status, "quarantined", "final row quarantined");
      eq(row.osize, "1024", "evidence size correct");
      eq(row.octype, "image/jpeg", "evidence content type correct");
      eq(row.oobj, obs.objId, "evidence object id correct");
      eq(row.oetag, obs.etag, "evidence etag correct");
      eq(row.quar_eq_upd, true, "quarantined_at === updated_at (written once, no double rewrite)");
    } finally { await cA.end(); await cB.end(); await cCtl.end(); }
  });

  // ── O17 — constraints enforce all-or-none observation evidence ─────────
  await t("O17. CHECK enforces all-or-none observation evidence (quarantined_at <-> observed fields)", async () => {
    const c = await conn(dsn);
    try {
      await reset(c);
      // quarantined_at set but observed fields NULL -> violates all-or-none
      let threw = false;
      try { await seedRow(c, { status: "quarantined", quarantinedSql: "now()" }); } catch { threw = true; }
      truthy(threw, "quarantined_at without observed evidence rejected");
      // observed field set but quarantined_at NULL -> violates all-or-none
      threw = false;
      try { await seedRow(c, { status: "upload_authorized", obsSize: 1024, obsCtype: "image/jpeg", obsObjId: "o", obsEtag: "e" }); } catch { threw = true; }
      truthy(threw, "observed evidence without quarantined_at rejected");
      // partial evidence (missing etag) + quarantined_at -> violates all-or-none
      threw = false;
      try { await seedRow(c, { status: "quarantined", quarantinedSql: "now()", obsSize: 1024, obsCtype: "image/jpeg", obsObjId: "o" }); } catch { threw = true; }
      truthy(threw, "partial observed evidence rejected");
      // sanity: all-none (no evidence, no quarantined_at) and full evidence both allowed
      threw = false;
      try {
        await seedRow(c, { status: "upload_authorized" });
        await seedRow(c, { status: "quarantined", quarantinedSql: "now()", obsSize: 1024, obsCtype: "image/jpeg", obsObjId: "o", obsEtag: "e" });
      } catch { threw = true; }
      truthy(!threw, "all-NULL and full-evidence rows are both allowed");
    } finally { await c.end(); }
  });

  // ── O18 — observed byte-size constraint rejects invalid persisted values ─
  await t("O18. observed_byte_size CHECK rejects 0 / negative / >100MiB persisted values", async () => {
    const c = await conn(dsn);
    try {
      await reset(c);
      for (const bad of [0, -1, CEILING + 1]) {
        let threw = false;
        try {
          await seedRow(c, { status: "quarantined", quarantinedSql: "now()", obsSize: bad, obsCtype: "image/jpeg", obsObjId: "o", obsEtag: "e" });
        } catch { threw = true; }
        truthy(threw, "observed_byte_size " + bad + " rejected by CHECK");
      }
      // sanity: 1 and exactly the ceiling are allowed
      let threw = false;
      try {
        await seedRow(c, { status: "quarantined", quarantinedSql: "now()", obsSize: 1, obsCtype: "image/jpeg", obsObjId: "o", obsEtag: "e" });
        await seedRow(c, { status: "quarantined", quarantinedSql: "now()", obsSize: CEILING, obsCtype: "image/jpeg", obsObjId: "o", obsEtag: "e" });
      } catch { threw = true; }
      truthy(!threw, "observed_byte_size 1 and exactly 100MiB are allowed");
    } finally { await c.end(); }
  });

  // ── O19 — function is SECURITY INVOKER, not DEFINER ────────────────────
  await t("O19. function is SECURITY INVOKER (prosecdef = false)", async () => {
    const c = await conn(dsn);
    try {
      const q = await c.query(`SELECT prosecdef FROM pg_proc WHERE oid = $1::regprocedure`, [FN_SIG]);
      eq(q.rows[0].prosecdef, false, "SECURITY INVOKER (not DEFINER)");
    } finally { await c.end(); }
  });

  // ── O20 — EXECUTE privilege: service_role ONLY ─────────────────────────
  await t("O20. EXECUTE granted to service_role ONLY (PUBLIC/anon/authenticated denied)", async () => {
    const c = await conn(dsn);
    try {
      const q = await c.query(
        `SELECT has_function_privilege('p1h_probe', $1, 'EXECUTE')      AS probe,
                has_function_privilege('anon', $1, 'EXECUTE')           AS anon,
                has_function_privilege('authenticated', $1, 'EXECUTE')  AS authed,
                has_function_privilege('service_role', $1, 'EXECUTE')   AS svc`,
        [FN_SIG]);
      const row = q.rows[0];
      eq(row.probe, false, "an unrelated role (PUBLIC) has NO execute");
      eq(row.anon, false, "anon has NO execute");
      eq(row.authed, false, "authenticated has NO execute");
      eq(row.svc, true, "service_role CAN execute");
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
