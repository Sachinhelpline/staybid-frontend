#!/usr/bin/env node
/* eslint-disable no-console */
// ═════════════════════════════════════════════════════════════════════════
// SEC-00B-P1F-1 — real-Postgres concurrency suite for the ATOMIC media
// upload-session reservation RPC (public.reserve_media_upload_session).
//
//   Run:  node tests/concurrency/media-upload-reservation.pg.test.js
//
// Spins up a THROWAWAY Postgres cluster on a private Unix socket (shared
// harness), creates ONLY the minimum media_upload_sessions schema + the
// anon/authenticated/service_role roles the migration's grants reference, then
// applies migrations/2026-09-06-sec00b-p1f-1-media-upload-atomic-reservation.sql
// (source of truth for the RPC) and exercises T1–T12. All concurrency is REAL —
// each parallel caller gets its own pg.Client (separate socket session). The
// dsn-guard refuses any DSN that is not the throwaway socket, so this NEVER
// touches Supabase / staging / production.
//
// It does NOT edit or import the classic-reservation test/harness contract
// (it only re-uses the shared .pg-harness / dsn-guard / seed helpers, unchanged).
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
const MIGRATION = path.join(REPO, "migrations", "2026-09-06-sec00b-p1f-1-media-upload-atomic-reservation.sql");
const FN_SIG = "public.reserve_media_upload_session(text,text,text,text,bigint,text,text)";

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
// we declare only the columns/indexes the RPC reads/writes plus the roles its
// GRANT/REVOKE reference. Roles must exist BEFORE the migration is applied.
const MINIMAL_SCHEMA = `
DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE p1f_probe; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

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
CREATE INDEX IF NOT EXISTS idx_media_upload_owner_created
  ON public.media_upload_sessions (owner_user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_media_upload_owner_status
  ON public.media_upload_sessions (owner_user_id, status);
`;

// ── DB helpers ─────────────────────────────────────────────────────────────
async function conn(dsn) {
  const c = new Client({ connectionString: dsn });
  await c.connect();
  return c;
}
async function rpc(client, a) {
  const r = await client.query(
    `SELECT public.reserve_media_upload_session(
        $1::text, $2::text, $3::text, $4::text, $5::bigint, $6::text, $7::text
      ) AS out`,
    [
      a.sessionId,
      a.ownerId,
      a.mediaClass || "photo",
      a.contentType || "image/jpeg",
      a.byteSize == null ? 1024 : a.byteSize,
      a.objectKey || ("sessions/" + a.sessionId + "/raw"),
      a.idempotencyKey,
    ],
  );
  return r.rows[0].out;
}
// Seed a session row directly (bypassing the RPC) to set up quota preconditions.
// `expiresSql` is a TEST-CONTROLLED constant SQL expression (never user input),
// so it is inlined — a bound parameter would be treated as a literal value, not
// an expression. created_at is DB-clock relative via a bound seconds-ago value.
async function seedRow(client, o) {
  const id = o.id || seed.cuid("sess");
  const raw = o.expiresSql;
  const expiresExpr = !raw || raw === "null" ? "NULL" : raw;
  await client.query(
    `INSERT INTO public.media_upload_sessions
       (id, owner_user_id, media_class, content_type, declared_byte_size,
        quarantine_bucket, object_key, idempotency_key, status, created_at, expires_at)
     VALUES ($1,$2,'photo','image/jpeg',1024,'social-media-quarantine',$3,$4,$5,
             now() - make_interval(secs => $6::int), ${expiresExpr})`,
    [
      id, o.ownerId, "sessions/" + id + "/raw", o.idem || seed.cuid("idem"),
      o.status || "created",
      o.agoSecs == null ? 0 : o.agoSecs,
    ],
  );
  return id;
}
async function countOwner(client, ownerId) {
  const r = await client.query(`SELECT count(*)::int AS n FROM public.media_upload_sessions WHERE owner_user_id = $1`, [ownerId]);
  return r.rows[0].n;
}
const outcomes = (arr) => arr.map((r) => r && r.outcome).sort();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log("SEC-00B-P1F-1 — media upload reservation concurrency suite");
  console.log("");
  console.log("[1/3] booting throwaway Postgres cluster …");
  const dsn = await harness.start();
  assertTestDsn(dsn);
  console.log("      dsn = " + dsn);

  console.log("[2/3] applying minimal schema + roles + the P1F-1 migration …");
  {
    const c = await conn(dsn);
    try {
      await c.query(MINIMAL_SCHEMA);
      await c.query(fs.readFileSync(MIGRATION, "utf8"));
    } finally {
      await c.end();
    }
  }

  console.log("[3/3] running tests T1–T12 …");
  console.log("");

  // ── T1 — RATE limit under concurrency (11 recent + 2 simultaneous) ─────
  await t("T1. 11 recent + 2 simultaneous different-idem → exactly 1 reserves, recent ≤ 12", async () => {
    const owner = seed.cuid("owner");
    const setup = await conn(dsn);
    try {
      // 11 RECENT rows that are NOT active (terminal status) so only the RATE
      // guard is exercised — created just now, so all count toward the window.
      for (let i = 0; i < 11; i++) await seedRow(setup, { ownerId: owner, status: "ready", agoSecs: 1 });
    } finally { await setup.end(); }

    const cX = await conn(dsn), cY = await conn(dsn);
    try {
      const [rX, rY] = await Promise.all([
        rpc(cX, { sessionId: seed.cuid("sess"), ownerId: owner, idempotencyKey: seed.cuid("idem") }),
        rpc(cY, { sessionId: seed.cuid("sess"), ownerId: owner, idempotencyKey: seed.cuid("idem") }),
      ]);
      eq([rX, rY].filter((r) => r.outcome === "reserved").length, 1, "reserved winners");
      eq([rX, rY].filter((r) => r.outcome === "rate_limited").length, 1, "rate_limited losers");
      const total = await countOwner(cX, owner);
      eq(total, 12, "owner total rows never exceeds 12");
    } finally { await cX.end(); await cY.end(); }
  });

  // ── T2 — ACTIVE limit under concurrency (5 active + 2 simultaneous) ────
  await t("T2. 5 active + 2 simultaneous different-idem → exactly 1 reserves, active ≤ 6", async () => {
    const owner = seed.cuid("owner");
    const setup = await conn(dsn);
    try {
      // 5 ACTIVE rows, aged out of the rate window so ONLY the active guard fires.
      for (let i = 0; i < 5; i++) await seedRow(setup, { ownerId: owner, status: "created", agoSecs: 300, expiresSql: "now() + interval '2 hours'" });
    } finally { await setup.end(); }

    const cX = await conn(dsn), cY = await conn(dsn);
    try {
      const [rX, rY] = await Promise.all([
        rpc(cX, { sessionId: seed.cuid("sess"), ownerId: owner, idempotencyKey: seed.cuid("idem") }),
        rpc(cY, { sessionId: seed.cuid("sess"), ownerId: owner, idempotencyKey: seed.cuid("idem") }),
      ]);
      eq([rX, rY].filter((r) => r.outcome === "reserved").length, 1, "reserved winners");
      eq([rX, rY].filter((r) => r.outcome === "concurrency_limited").length, 1, "concurrency_limited losers");
      const r = await cX.query(
        `SELECT count(*)::int AS n FROM public.media_upload_sessions
          WHERE owner_user_id = $1 AND status IN ('created','upload_authorized')
            AND (expires_at IS NULL OR expires_at > now())`, [owner]);
      eq(r.rows[0].n, 6, "active total never exceeds 6");
    } finally { await cX.end(); await cY.end(); }
  });

  // ── T3 — same owner + same idem, two simultaneous → exactly one row ────
  await t("T3. same owner + same idem, 2 simultaneous → 1 canonical row (reserved + idempotent_existing)", async () => {
    const owner = seed.cuid("owner");
    const idem = seed.cuid("idem");
    const cX = await conn(dsn), cY = await conn(dsn);
    try {
      const [rX, rY] = await Promise.all([
        rpc(cX, { sessionId: seed.cuid("sess"), ownerId: owner, idempotencyKey: idem }),
        rpc(cY, { sessionId: seed.cuid("sess"), ownerId: owner, idempotencyKey: idem }),
      ]);
      eq(outcomes([rX, rY]).join(","), "idempotent_existing,reserved", "one reserved + one idempotent_existing");
      eq(rX.row.id, rY.row.id, "both resolve to the SAME canonical row id");
      const total = await countOwner(cX, owner);
      eq(total, 1, "exactly one canonical row for (owner, idem)");
    } finally { await cX.end(); await cY.end(); }
  });

  // ── T4 — same owner, different idem, quota allows both → serialized ────
  await t("T4. same owner, different idem, under quota → both reserve, 2 distinct rows", async () => {
    const owner = seed.cuid("owner");
    const cX = await conn(dsn), cY = await conn(dsn);
    try {
      const sX = seed.cuid("sess"), sY = seed.cuid("sess");
      const [rX, rY] = await Promise.all([
        rpc(cX, { sessionId: sX, ownerId: owner, idempotencyKey: seed.cuid("idem") }),
        rpc(cY, { sessionId: sY, ownerId: owner, idempotencyKey: seed.cuid("idem") }),
      ]);
      eq([rX, rY].filter((r) => r.outcome === "reserved").length, 2, "both reserve (serialized, no lost update)");
      truthy(rX.row.id !== rY.row.id, "two distinct canonical rows");
      eq(await countOwner(cX, owner), 2, "exactly two rows");
    } finally { await cX.end(); await cY.end(); }
  });

  // ── T5 — different owners do NOT share the owner lock ──────────────────
  await t("T5. different owners → independent locks (A held ≠ blocks B)", async () => {
    const ownerA = seed.cuid("owner"), ownerB = seed.cuid("owner");
    const cHold = await conn(dsn), cProbe = await conn(dsn), cB = await conn(dsn);
    try {
      // cHold acquires ownerA's advisory xact lock and keeps the txn open.
      await cHold.query("BEGIN");
      await cHold.query(
        `SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('sec00b:media_upload_reservation:' || $1, 0))`,
        [ownerA]);
      // A probe (its own txn) cannot take ownerA's key (held elsewhere) but CAN
      // take ownerB's — proving the lock is per-owner, not global.
      await cProbe.query("BEGIN");
      const pa = await cProbe.query(
        `SELECT pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('sec00b:media_upload_reservation:' || $1, 0)) AS l`, [ownerA]);
      const pb = await cProbe.query(
        `SELECT pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('sec00b:media_upload_reservation:' || $1, 0)) AS l`, [ownerB]);
      eq(pa.rows[0].l, false, "ownerA key is held (probe cannot acquire)");
      eq(pb.rows[0].l, true, "ownerB key is FREE (independent owner)");
      await cProbe.query("ROLLBACK");
      // ownerB reserves fully while ownerA's lock is still held → real progress.
      const rB = await rpc(cB, { sessionId: seed.cuid("sess"), ownerId: ownerB, idempotencyKey: seed.cuid("idem") });
      eq(rB.outcome, "reserved", "ownerB reserves while ownerA lock held");
    } finally {
      try { await cHold.query("ROLLBACK"); } catch {}
      await cHold.end(); await cProbe.end(); await cB.end();
    }
  });

  // ── T6 — expired active-status rows do NOT count active ────────────────
  await t("T6. 6 EXPIRED created rows do NOT count active → reserve succeeds", async () => {
    const owner = seed.cuid("owner");
    const setup = await conn(dsn);
    try {
      for (let i = 0; i < 6; i++) await seedRow(setup, { ownerId: owner, status: "created", agoSecs: 300, expiresSql: "now() - interval '1 hour'" });
    } finally { await setup.end(); }
    const c = await conn(dsn);
    try {
      const r = await rpc(c, { sessionId: seed.cuid("sess"), ownerId: owner, idempotencyKey: seed.cuid("idem") });
      eq(r.outcome, "reserved", "expired rows excluded from active quota");
    } finally { await c.end(); }
  });

  // ── T7 — NULL expires_at DOES count active (fail-closed) ───────────────
  await t("T7. 6 active rows with NULL expiry DO count active → concurrency_limited", async () => {
    const owner = seed.cuid("owner");
    const setup = await conn(dsn);
    try {
      for (let i = 0; i < 6; i++) await seedRow(setup, { ownerId: owner, status: "created", agoSecs: 300, expiresSql: "null" });
    } finally { await setup.end(); }
    const c = await conn(dsn);
    try {
      const r = await rpc(c, { sessionId: seed.cuid("sess"), ownerId: owner, idempotencyKey: seed.cuid("idem") });
      eq(r.outcome, "concurrency_limited", "NULL expiry counts active (fail-closed)");
    } finally { await c.end(); }
  });

  // ── T8 — recent count is status-agnostic ───────────────────────────────
  await t("T8. 12 recent rows in terminal statuses still rate_limit (status-agnostic)", async () => {
    const owner = seed.cuid("owner");
    const setup = await conn(dsn);
    try {
      const sts = ["ready", "rejected", "expired", "quarantined"];
      for (let i = 0; i < 12; i++) await seedRow(setup, { ownerId: owner, status: sts[i % sts.length], agoSecs: 1, expiresSql: "now() - interval '1 hour'" });
    } finally { await setup.end(); }
    const c = await conn(dsn);
    try {
      const r = await rpc(c, { sessionId: seed.cuid("sess"), ownerId: owner, idempotencyKey: seed.cuid("idem") });
      eq(r.outcome, "rate_limited", "recent window counts ALL statuses");
    } finally { await c.end(); }
  });

  // ── T9 — a rejection inserts ZERO new row ──────────────────────────────
  await t("T9. rate/concurrency rejection inserts ZERO new row", async () => {
    // rate rejection
    const ownerR = seed.cuid("owner");
    let setup = await conn(dsn);
    try { for (let i = 0; i < 12; i++) await seedRow(setup, { ownerId: ownerR, status: "ready", agoSecs: 1 }); } finally { await setup.end(); }
    let c = await conn(dsn);
    try {
      const before = await countOwner(c, ownerR);
      const r = await rpc(c, { sessionId: seed.cuid("sess"), ownerId: ownerR, idempotencyKey: seed.cuid("idem") });
      eq(r.outcome, "rate_limited", "rate rejected");
      eq(await countOwner(c, ownerR), before, "rate rejection wrote ZERO rows");
    } finally { await c.end(); }
    // concurrency rejection
    const ownerC = seed.cuid("owner");
    setup = await conn(dsn);
    try { for (let i = 0; i < 6; i++) await seedRow(setup, { ownerId: ownerC, status: "created", agoSecs: 300, expiresSql: "now() + interval '2 hours'" }); } finally { await setup.end(); }
    c = await conn(dsn);
    try {
      const before = await countOwner(c, ownerC);
      const r = await rpc(c, { sessionId: seed.cuid("sess"), ownerId: ownerC, idempotencyKey: seed.cuid("idem") });
      eq(r.outcome, "concurrency_limited", "concurrency rejected");
      eq(await countOwner(c, ownerC), before, "concurrency rejection wrote ZERO rows");
    } finally { await c.end(); }
  });

  // ── T10 — created reservation timestamps are DB-generated (now + 2h) ────
  await t("T10. created_at/updated_at/expires_at are DB-generated (expires ≈ now + 2h)", async () => {
    const owner = seed.cuid("owner");
    const c = await conn(dsn);
    try {
      const sid = seed.cuid("sess");
      const r = await rpc(c, { sessionId: sid, ownerId: owner, idempotencyKey: seed.cuid("idem") });
      eq(r.outcome, "reserved", "reserved");
      const q = await c.query(
        `SELECT created_at, updated_at, expires_at,
                EXTRACT(EPOCH FROM (expires_at - created_at))::int AS ttl_secs,
                abs(EXTRACT(EPOCH FROM (created_at - now())))::int AS created_skew,
                (created_at = updated_at) AS eq_cu
           FROM public.media_upload_sessions WHERE id = $1`, [sid]);
      const row = q.rows[0];
      eq(row.ttl_secs, 7200, "expires_at is created_at + exactly 2h");
      truthy(row.created_skew <= 30, "created_at is the DB clock (≈ now)");
      eq(row.eq_cu, true, "created_at === updated_at at insert");
    } finally { await c.end(); }
  });

  // ── T11 — EXECUTE privilege: service_role ONLY ─────────────────────────
  await t("T11. EXECUTE granted to service_role ONLY (PUBLIC/anon/authenticated denied)", async () => {
    const c = await conn(dsn);
    try {
      const q = await c.query(
        `SELECT has_function_privilege('p1f_probe', $1, 'EXECUTE')     AS probe,
                has_function_privilege('anon', $1, 'EXECUTE')          AS anon,
                has_function_privilege('authenticated', $1, 'EXECUTE') AS authed,
                has_function_privilege('service_role', $1, 'EXECUTE')  AS svc`,
        [FN_SIG]);
      const row = q.rows[0];
      eq(row.probe, false, "an unrelated role (PUBLIC) has NO execute");
      eq(row.anon, false, "anon has NO execute");
      eq(row.authed, false, "authenticated has NO execute");
      eq(row.svc, true, "service_role CAN execute");
    } finally { await c.end(); }
  });

  // ── T12 — function is SECURITY INVOKER, not DEFINER ────────────────────
  await t("T12. function is SECURITY INVOKER (prosecdef = false)", async () => {
    const c = await conn(dsn);
    try {
      const q = await c.query(`SELECT prosecdef FROM pg_proc WHERE oid = $1::regprocedure`, [FN_SIG]);
      eq(q.rows[0].prosecdef, false, "SECURITY INVOKER (not DEFINER)");
    } finally { await c.end(); }
  });

  // ── T13 — the reservation clock is taken AFTER the owner lock ──────────
  // Proves clock_timestamp()-after-lock, not transaction-start now(): a caller
  // that BLOCKS on the owner lock must stamp created_at AFTER it finally acquires
  // the lock (i.e. after the holder releases), never at its own transaction start.
  await t("T13. reservation clock is taken AFTER owner lock (clock_timestamp, not txn-start now())", async () => {
    const owner = seed.cuid("owner");
    const cHold = await conn(dsn), cB = await conn(dsn), cCtl = await conn(dsn);
    let resolvedB = false, rB = null, errB = null;
    try {
      // (1) A holds the exact owner advisory xact lock (txn kept open).
      await cHold.query("BEGIN");
      await cHold.query(
        `SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('sec00b:media_upload_reservation:' || $1, 0))`,
        [owner]);

      // (2) B starts a reservation for the SAME owner; its transaction begins now
      //     (so its txn-start now() is fixed HERE) but it blocks on the lock.
      const pB = rpc(cB, { sessionId: seed.cuid("sess"), ownerId: owner, idempotencyKey: seed.cuid("idem") })
        .then((r) => { resolvedB = true; rB = r; })
        .catch((e) => { resolvedB = true; errB = e; });

      // (3) Deterministic ~1s block so B's txn-start is ~1s BEFORE the marker.
      await sleep(1000);
      truthy(!resolvedB, "B is still pending (blocked on the owner lock)");
      const waitQ = await cCtl.query(
        `SELECT count(*)::int AS n FROM pg_stat_activity
          WHERE wait_event_type = 'Lock' AND wait_event = 'advisory'`);
      truthy(waitQ.rows[0].n >= 1, "a backend is waiting on an advisory lock");

      // (4) Capture a DB wall-clock marker just before releasing A; then a small
      //     deterministic separation so B's post-lock clock is unambiguously after it.
      const mk = await cCtl.query(`SELECT clock_timestamp() AS m`);
      const marker = mk.rows[0].m; // JS Date (ms precision) — gap is ~seconds, robust
      await sleep(250);

      // (5) Release A → (6) B proceeds and completes.
      await cHold.query("ROLLBACK");
      await pB;
      truthy(!errB, "B completed without error");
      eq(rB && rB.outcome, "reserved", "B reserved");

      // (7)/(8) B's created_at must be AFTER the release marker (clock-after-lock).
      const q = await cCtl.query(
        `SELECT created_at, updated_at,
                (created_at >= $2::timestamptz) AS after_marker,
                (updated_at = created_at)       AS eq_cu,
                EXTRACT(EPOCH FROM (expires_at - created_at))::int AS ttl_secs
           FROM public.media_upload_sessions WHERE id = $1`,
        [rB.row.id, marker.toISOString()]);
      const row = q.rows[0];
      eq(row.after_marker, true, "created_at >= release-marker (taken AFTER lock acquisition)");
      eq(row.eq_cu, true, "updated_at === created_at");
      eq(row.ttl_secs, 7200, "expires_at - created_at = exactly 2 hours");
      // Cross-check in JS too (marker vs created_at as absolute instants).
      truthy(new Date(row.created_at).getTime() >= new Date(marker).getTime(),
        "created_at instant is at/after the marker instant");
    } finally {
      try { await cHold.query("ROLLBACK"); } catch {}
      await cHold.end(); await cB.end(); await cCtl.end();
    }
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
