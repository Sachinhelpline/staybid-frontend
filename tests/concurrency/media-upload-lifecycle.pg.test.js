#!/usr/bin/env node
/* eslint-disable no-console */
// ═════════════════════════════════════════════════════════════════════════
// SEC-00B-P1F-2 — real-Postgres suite for the DB-TIME media upload-session
// lifecycle CAS RPC (public.apply_media_upload_authorization_cas).
//
//   Run:  node tests/concurrency/media-upload-lifecycle.pg.test.js
//
// Spins up a THROWAWAY Postgres cluster on a private Unix socket (shared
// harness), creates ONLY the minimum media_upload_sessions schema + the
// anon/authenticated/service_role roles the migration's grants reference, then
// applies migrations/2026-09-07-sec00b-p1f-2-media-upload-lifecycle-cas.sql
// (source of truth for the RPC) and exercises L1–L12. All concurrency is REAL —
// each parallel caller gets its own pg.Client (separate socket session). The
// dsn-guard refuses any DSN that is not the throwaway socket, so this NEVER
// touches Supabase / staging / production.
//
// It re-uses the shared .pg-harness / dsn-guard / seed helpers unchanged, and
// does NOT touch the P1F-1 reservation RPC, its migration, or its test. If
// postgres binaries are unavailable the shared harness exits NON-ZERO
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
const MIGRATION = path.join(REPO, "migrations", "2026-09-07-sec00b-p1f-2-media-upload-lifecycle-cas.sql");
const FN_SIG = "public.apply_media_upload_authorization_cas(text,text)";

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

// ── minimum schema + roles the migration reaches ──────────────────────────
// The P1A media SQL source is intentionally NOT reconstructed (separate track);
// we declare only the columns the lifecycle CAS reads/writes plus the roles its
// GRANT/REVOKE reference. Roles must exist BEFORE the migration is applied.
const MINIMAL_SCHEMA = `
DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE p1f2_probe; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

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
CREATE INDEX IF NOT EXISTS idx_media_upload_id_status
  ON public.media_upload_sessions (id, status);
`;

// ── DB helpers ─────────────────────────────────────────────────────────────
async function conn(dsn) {
  const c = new Client({ connectionString: dsn });
  await c.connect();
  return c;
}
// Invoke the lifecycle CAS RPC. Rejects (throws) when the RPC RAISEs.
async function cas(client, sessionId, action) {
  const r = await client.query(
    `SELECT public.apply_media_upload_authorization_cas($1::text, $2::text) AS out`,
    [sessionId, action],
  );
  return r.rows[0].out;
}
// Seed a session row directly. `uaSql` / `expiresSql` are TEST-CONTROLLED constant
// SQL expressions (never user input), so they are inlined — a bound parameter
// would be treated as a literal value, not an expression. created_at/updated_at
// are seeded 5 minutes in the past so a fresh DB-clock write is visibly distinct.
async function seedRow(client, o) {
  const id = o.id || seed.cuid("sess");
  const ua = o.uaSql && o.uaSql !== "null" ? o.uaSql : "NULL";
  const exp = o.expiresSql && o.expiresSql !== "null" ? o.expiresSql : "NULL";
  await client.query(
    `INSERT INTO public.media_upload_sessions
       (id, owner_user_id, media_class, content_type, declared_byte_size,
        quarantine_bucket, object_key, idempotency_key, status,
        upload_authorized_at, rejected_reason, created_at, updated_at, expires_at)
     VALUES ($1,$2,'photo','image/jpeg',1024,'social-media-quarantine',$3,$4,$5,
             ${ua}, NULL,
             now() - interval '5 minutes', now() - interval '5 minutes', ${exp})`,
    [id, o.ownerId || seed.cuid("owner"), "sessions/" + id + "/raw", o.idem || seed.cuid("idem"), o.status || "created"],
  );
  return id;
}
async function snapshot(client, id) {
  const q = await client.query(
    `SELECT status,
            upload_authorized_at::text AS ua,
            expires_at::text           AS exp,
            updated_at::text           AS upd,
            rejected_reason            AS reason
       FROM public.media_upload_sessions WHERE id = $1`, [id]);
  return q.rows[0];
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log("SEC-00B-P1F-2 — media upload lifecycle DB-time CAS suite");
  console.log("");
  console.log("[1/3] booting throwaway Postgres cluster …");
  const dsn = await harness.start();
  assertTestDsn(dsn);
  console.log("      dsn = " + dsn);

  console.log("[2/3] applying minimal schema + roles + the P1F-2 migration …");
  {
    const c = await conn(dsn);
    try {
      await c.query(MINIMAL_SCHEMA);
      await c.query(fs.readFileSync(MIGRATION, "utf8"));
    } finally {
      await c.end();
    }
  }

  console.log("[3/3] running tests L1–L12 …");
  console.log("");

  // ── L1 — created -> authorize_created ──────────────────────────────────
  await t("L1. created -> authorize_created: applied, upload_authorized, ua=upd, expires=upd+2h", async () => {
    const c = await conn(dsn);
    try {
      const id = await seedRow(c, { status: "created" });
      const r = await cas(c, id, "authorize_created");
      eq(r.outcome, "applied", "outcome applied");
      eq(r.status, "upload_authorized", "returned status");
      truthy(typeof r.expires_at === "string" && r.expires_at.length > 0, "RPC returns a DB expires_at");
      const q = await c.query(
        `SELECT status,
                (upload_authorized_at = updated_at)                          AS eq_ua_upd,
                EXTRACT(EPOCH FROM (expires_at - updated_at))::int           AS ttl,
                abs(EXTRACT(EPOCH FROM (updated_at - now())))::int           AS upd_skew,
                (expires_at = $2::timestamptz)                               AS matches_returned
           FROM public.media_upload_sessions WHERE id = $1`, [id, r.expires_at]);
      const row = q.rows[0];
      eq(row.status, "upload_authorized", "row status upload_authorized");
      eq(row.eq_ua_upd, true, "upload_authorized_at === updated_at (single DB instant)");
      eq(row.ttl, 7200, "expires_at - updated_at = exactly 2 hours");
      truthy(row.upd_skew <= 30, "updated_at is the DB clock (≈ now)");
      eq(row.matches_returned, true, "returned expires_at equals the row it wrote");
    } finally { await c.end(); }
  });

  // ── L2 — refresh_authorized ────────────────────────────────────────────
  await t("L2. refresh_authorized: applied, stays upload_authorized, ua UNCHANGED, fresh upd/expires=upd+2h", async () => {
    const c = await conn(dsn);
    try {
      const id = await seedRow(c, { status: "upload_authorized", uaSql: "now() - interval '40 minutes'", expiresSql: "now() + interval '20 minutes'" });
      const before = await snapshot(c, id);
      const r = await cas(c, id, "refresh_authorized");
      eq(r.outcome, "applied", "outcome applied");
      eq(r.status, "upload_authorized", "returned status unchanged");
      const q = await c.query(
        `SELECT status,
                upload_authorized_at::text                          AS ua,
                EXTRACT(EPOCH FROM (expires_at - updated_at))::int  AS ttl,
                abs(EXTRACT(EPOCH FROM (updated_at - now())))::int  AS upd_skew,
                (upload_authorized_at < updated_at)                 AS ua_before_upd
           FROM public.media_upload_sessions WHERE id = $1`, [id]);
      const row = q.rows[0];
      eq(row.status, "upload_authorized", "row still upload_authorized");
      eq(row.ua, before.ua, "upload_authorized_at UNCHANGED by refresh");
      eq(row.ttl, 7200, "expires_at - updated_at = exactly 2 hours (fresh)");
      truthy(row.upd_skew <= 30, "updated_at refreshed to DB clock (≈ now)");
      eq(row.ua_before_upd, true, "upload_authorized_at is older than the fresh updated_at");
    } finally { await c.end(); }
  });

  // ── L3 — created -> reject_created ─────────────────────────────────────
  await t("L3. created -> reject_created: applied, rejected, reason=upload_authorization_failed, fresh upd", async () => {
    const c = await conn(dsn);
    try {
      const id = await seedRow(c, { status: "created" });
      const r = await cas(c, id, "reject_created");
      eq(r.outcome, "applied", "outcome applied");
      eq(r.status, "rejected", "returned status rejected");
      const q = await c.query(
        `SELECT status, rejected_reason,
                abs(EXTRACT(EPOCH FROM (updated_at - now())))::int AS upd_skew
           FROM public.media_upload_sessions WHERE id = $1`, [id]);
      const row = q.rows[0];
      eq(row.status, "rejected", "row status rejected");
      eq(row.rejected_reason, "upload_authorization_failed", "DB-owned fixed rejection reason");
      truthy(row.upd_skew <= 30, "updated_at is the DB clock (≈ now)");
    } finally { await c.end(); }
  });

  // ── L4 — authorize_created on wrong status -> state_conflict, zero mutation ─
  await t("L4. authorize_created on upload_authorized -> state_conflict, ZERO mutation", async () => {
    const c = await conn(dsn);
    try {
      const id = await seedRow(c, { status: "upload_authorized", uaSql: "now() - interval '10 minutes'", expiresSql: "now() + interval '50 minutes'" });
      const before = await snapshot(c, id);
      const r = await cas(c, id, "authorize_created");
      eq(r.outcome, "state_conflict", "wrong status -> state_conflict");
      const after = await snapshot(c, id);
      eq(after.status, before.status, "status unchanged");
      eq(after.ua, before.ua, "upload_authorized_at unchanged");
      eq(after.exp, before.exp, "expires_at unchanged");
      eq(after.upd, before.upd, "updated_at unchanged (zero mutation)");
      eq(after.reason, before.reason, "rejected_reason unchanged");
    } finally { await c.end(); }
  });

  // ── L5 — refresh_authorized on wrong status -> state_conflict, zero mutation ─
  await t("L5. refresh_authorized on created -> state_conflict, ZERO mutation", async () => {
    const c = await conn(dsn);
    try {
      const id = await seedRow(c, { status: "created", expiresSql: "now() + interval '2 hours'" });
      const before = await snapshot(c, id);
      const r = await cas(c, id, "refresh_authorized");
      eq(r.outcome, "state_conflict", "wrong status -> state_conflict");
      const after = await snapshot(c, id);
      eq(after.status, before.status, "status unchanged");
      eq(after.exp, before.exp, "expires_at unchanged");
      eq(after.upd, before.upd, "updated_at unchanged (zero mutation)");
    } finally { await c.end(); }
  });

  // ── L6 — reject_created on wrong status -> state_conflict, zero mutation ─
  await t("L6. reject_created on upload_authorized -> state_conflict, ZERO mutation", async () => {
    const c = await conn(dsn);
    try {
      const id = await seedRow(c, { status: "upload_authorized", uaSql: "now() - interval '5 minutes'", expiresSql: "now() + interval '1 hour'" });
      const before = await snapshot(c, id);
      const r = await cas(c, id, "reject_created");
      eq(r.outcome, "state_conflict", "wrong status -> state_conflict");
      const after = await snapshot(c, id);
      eq(after.status, before.status, "status unchanged (not rejected)");
      eq(after.reason, before.reason, "rejected_reason unchanged (still null)");
      eq(after.upd, before.upd, "updated_at unchanged (zero mutation)");
    } finally { await c.end(); }
  });

  // ── L7 — concurrent authorize vs reject on SAME created session ────────
  await t("L7. authorize_created || reject_created on same created session -> exactly ONE applies", async () => {
    const setup = await conn(dsn);
    let id;
    try { id = await seedRow(setup, { status: "created" }); } finally { await setup.end(); }
    const cA = await conn(dsn), cB = await conn(dsn);
    try {
      const [rA, rB] = await Promise.all([
        cas(cA, id, "authorize_created"),
        cas(cB, id, "reject_created"),
      ]);
      eq([rA, rB].filter((r) => r.outcome === "applied").length, 1, "exactly one applied");
      eq([rA, rB].filter((r) => r.outcome === "state_conflict").length, 1, "the other is state_conflict");
      const q = await cA.query(`SELECT status, rejected_reason FROM public.media_upload_sessions WHERE id = $1`, [id]);
      const row = q.rows[0];
      truthy(row.status === "upload_authorized" || row.status === "rejected", "final row is one valid terminal result");
      if (rA.outcome === "applied") {
        eq(row.status, "upload_authorized", "authorize won -> upload_authorized");
        eq(row.rejected_reason, null, "authorize won -> no rejection reason (never both)");
      } else {
        eq(row.status, "rejected", "reject won -> rejected");
        eq(row.rejected_reason, "upload_authorization_failed", "reject won -> DB reason");
      }
    } finally { await cA.end(); await cB.end(); }
  });

  // ── L8 — the lifecycle clock is taken AFTER the session lock ───────────
  await t("L8. lifecycle clock is taken AFTER session lock (clock_timestamp, not txn-start now())", async () => {
    const setup = await conn(dsn);
    let id;
    try { id = await seedRow(setup, { status: "created" }); } finally { await setup.end(); }
    const cHold = await conn(dsn), cB = await conn(dsn), cCtl = await conn(dsn);
    let resolvedB = false, rB = null, errB = null;
    try {
      // (1) A holds the exact session lifecycle advisory xact lock (txn kept open).
      await cHold.query("BEGIN");
      await cHold.query(
        `SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('sec00b:media_upload_lifecycle:' || $1, 0))`,
        [id]);

      // (2) B starts authorize_created for the SAME session; its transaction begins
      //     now (txn-start now() is fixed HERE) but it blocks on the lock.
      const pB = cas(cB, id, "authorize_created")
        .then((r) => { resolvedB = true; rB = r; })
        .catch((e) => { resolvedB = true; errB = e; });

      // (3) Deterministic ~1s block so B's txn-start is ~1s BEFORE the marker.
      await sleep(1000);
      truthy(!resolvedB, "B is still pending (blocked on the session lock)");
      const waitQ = await cCtl.query(
        `SELECT count(*)::int AS n FROM pg_stat_activity
          WHERE wait_event_type = 'Lock' AND wait_event = 'advisory'`);
      truthy(waitQ.rows[0].n >= 1, "a backend is waiting on an advisory lock");

      // (4) Capture a DB wall-clock marker just before releasing A; small gap after.
      const mk = await cCtl.query(`SELECT clock_timestamp() AS m`);
      const marker = mk.rows[0].m; // JS Date (ms precision) — gap is ~seconds, robust
      await sleep(250);

      // (5) Release A -> (6) B proceeds and completes.
      await cHold.query("ROLLBACK");
      await pB;
      truthy(!errB, "B completed without error");
      eq(rB && rB.outcome, "applied", "B applied");

      // (7)/(8) B's updated_at must be AFTER the release marker (clock-after-lock).
      const q = await cCtl.query(
        `SELECT updated_at::text AS upd,
                (updated_at >= $2::timestamptz)          AS after_marker,
                (upload_authorized_at = updated_at)      AS eq_ua_upd,
                EXTRACT(EPOCH FROM (expires_at - updated_at))::int AS ttl
           FROM public.media_upload_sessions WHERE id = $1`,
        [id, marker.toISOString()]);
      const row = q.rows[0];
      eq(row.after_marker, true, "updated_at >= release-marker (taken AFTER lock acquisition)");
      eq(row.eq_ua_upd, true, "upload_authorized_at === updated_at");
      eq(row.ttl, 7200, "expires_at - updated_at = exactly 2 hours");
      truthy(new Date(row.upd).getTime() >= new Date(marker).getTime(),
        "updated_at instant is at/after the marker instant");
    } finally {
      try { await cHold.query("ROLLBACK"); } catch {}
      await cHold.end(); await cB.end(); await cCtl.end();
    }
  });

  // ── L9 — different session ids do NOT share the lifecycle lock ─────────
  await t("L9. different session ids -> independent lifecycle locks", async () => {
    const setup = await conn(dsn);
    let idA, idB;
    try {
      idA = await seedRow(setup, { status: "created" });
      idB = await seedRow(setup, { status: "created" });
    } finally { await setup.end(); }
    const cHold = await conn(dsn), cProbe = await conn(dsn), cB = await conn(dsn);
    try {
      await cHold.query("BEGIN");
      await cHold.query(
        `SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('sec00b:media_upload_lifecycle:' || $1, 0))`,
        [idA]);
      await cProbe.query("BEGIN");
      const pa = await cProbe.query(
        `SELECT pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('sec00b:media_upload_lifecycle:' || $1, 0)) AS l`, [idA]);
      const pb = await cProbe.query(
        `SELECT pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('sec00b:media_upload_lifecycle:' || $1, 0)) AS l`, [idB]);
      eq(pa.rows[0].l, false, "session A key is held (probe cannot acquire)");
      eq(pb.rows[0].l, true, "session B key is FREE (independent session)");
      await cProbe.query("ROLLBACK");
      const rB = await cas(cB, idB, "authorize_created");
      eq(rB.outcome, "applied", "session B applies while session A lock held");
    } finally {
      try { await cHold.query("ROLLBACK"); } catch {}
      await cHold.end(); await cProbe.end(); await cB.end();
    }
  });

  // ── L10 — blank session id + unknown action fail closed (RAISE) ────────
  await t("L10. blank session id / unknown action fail closed (RAISE, zero mutation)", async () => {
    const c = await conn(dsn);
    try {
      const id = await seedRow(c, { status: "created" });
      for (const [l, sid, act] of [
        ["blank id", "", "authorize_created"],
        ["whitespace id", "   ", "authorize_created"],
        ["unknown action", id, "bogus_action"],
        ["partial action", id, "authorize"],
        ["empty action", id, ""],
      ]) {
        let threw = false;
        try { await cas(c, sid, act); } catch { threw = true; }
        ok10(threw, l);
      }
      // the still-created row was never mutated by any failed call
      const q = await c.query(`SELECT status FROM public.media_upload_sessions WHERE id = $1`, [id]);
      eq(q.rows[0].status, "created", "row stays created after fail-closed calls (zero mutation)");
    } finally { await c.end(); }
    function ok10(threw, l) { if (!threw) throw new Error(l + ": expected RAISE/throw, got success"); }
  });

  // ── L11 — EXECUTE privilege: service_role ONLY ─────────────────────────
  await t("L11. EXECUTE granted to service_role ONLY (PUBLIC/anon/authenticated denied)", async () => {
    const c = await conn(dsn);
    try {
      const q = await c.query(
        `SELECT has_function_privilege('p1f2_probe', $1, 'EXECUTE')     AS probe,
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

  // ── L12 — function is SECURITY INVOKER, not DEFINER ────────────────────
  await t("L12. function is SECURITY INVOKER (prosecdef = false)", async () => {
    const c = await conn(dsn);
    try {
      const q = await c.query(`SELECT prosecdef FROM pg_proc WHERE oid = $1::regprocedure`, [FN_SIG]);
      eq(q.rows[0].prosecdef, false, "SECURITY INVOKER (not DEFINER)");
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
