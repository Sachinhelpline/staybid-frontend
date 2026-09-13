#!/usr/bin/env node
/* eslint-disable no-console */
// ═════════════════════════════════════════════════════════════════════════════
// STAY-LIFECYCLE-OPS-01 — M8-R1 ZERO-CORRUPTION CUTOVER, proven against a REAL
// PostgreSQL running the ACTUAL migration SQL
// (migrations/2026-09-13-v753-stay-lifecycle-ops-unit-assignment-lines.sql).
// Run: node tests/concurrency/stay-cutover-preflight.pg.test.js
//
// The M8 code-first→migration cutover claims "every occupancy WRITE fails closed
// 503 until migration," but that 503 only gates the NEW authority surfaces (the
// assignment RPCs + walk-in pins). PRE-EXISTING pinned room_blocks writers (the
// OTA sync engine, b2b/circle/trade verify, inventory holds) stay active during
// the code-first window. M8-R1 closes the two residual races AT THE SCHEMA LEVEL:
//
//   • the LOCKED, FAIL-CLOSED cutover PREFLIGHT at the TOP of the migration —
//     refuses (stay_assignment_preflight_conflict, full atomic rollback) if any
//     LIVE assignment (a legacy bid_unit_assignments row OR an occupying
//     bids."assignedUnitId" stamp) overlaps a unit-pinned room_block on the same
//     unit + checkout-exclusive nights; and its EXCLUSIVE lock on every occupancy
//     source is held for the WHOLE migration transaction, so a concurrent writer
//     cannot slip between the preflight and trigger/RLS activation;
//   • the LEGACY-TABLE CONVERGENCE GUARD at the END — an old-v752 in-flight
//     request that finishes AFTER activation and writes a legacy-only
//     bid_unit_assignments row with NO matching active line is REFUSED
//     (legacy_assignment_without_line), so a post-migration legacy-only write
//     converges (refuses) instead of diverging from the lines table.
//
// CASE 1  — a pre-existing OVERLAPPING pinned block + a live assignment exists →
//           the migration RAISEs and rolls back ATOMICALLY: ZERO partial stay
//           schema / RLS / trigger activation survives. Freeing the unit lets a
//           re-apply succeed (the preflight blocks ONLY on a real conflict).
//   1b — the bids."assignedUnitId" STAMP variant of a live assignment also trips
//        the preflight (both live-assignment sources are covered).
//   1c — a NON-occupying (PENDING) stamp + overlapping block does NOT trip it
//        (only ACCEPTED/CONFIRMED/CHECKED_IN occupations count) → migration OK.
// CASE 2  — a NON-overlapping pinned block → the migration SUCCEEDS: the live
//           assignment is backfilled to an ACTIVE line, the room_blocks guard is
//           active (a new conflicting pin is refused), and a legacy-only write
//           with no line is refused while the sanctioned RPC path still writes.
// CASE 3  — a concurrent pinned room_blocks write attempted WHILE the migration
//           transaction holds its EXCLUSIVE lock BLOCKS on the lock (observed via
//           pg_stat_activity) and the new schema is invisible to other sessions
//           until COMMIT; once the migration commits, the writer proceeds and
//           meets the now-active guard (refused). It can never slip through.
//
// Throwaway socket-only cluster (.pg-harness), one fresh DATABASE per case so
// CASE 1's atomic-rollback assertion starts from a schema-free DB. Supabase-like
// roles (anon/authenticated NOLOGIN, service_role BYPASSRLS) + a non-owner
// railway_writer. NEVER touches Supabase / staging / production (dsn-guard). If
// postgres binaries are unavailable the harness exits NON-ZERO (unproven) — a
// SKIP is never a PASS.
// ═════════════════════════════════════════════════════════════════════════════
"use strict";

let Client;
try { ({ Client } = require("pg")); } catch {
  console.error("[stay-cutover] `pg` is not installed. Run `npm ci`.");
  process.exit(2);
}
// DATE columns come back as the literal 'YYYY-MM-DD' (never a JS Date).
require("pg").types.setTypeParser(1082, (v) => v);
const path = require("path");
const fs = require("fs");
const harness = require("./.pg-harness");
const { assertTestDsn } = require("./dsn-guard");
const { MINIMAL_SCHEMA } = require("./apply-migrations");
const seed = require("./seed");

const MIGRATION = path.resolve(__dirname, "..", "..", "migrations", "2026-09-13-v753-stay-lifecycle-ops-unit-assignment-lines.sql");
const migrationSql = fs.readFileSync(MIGRATION, "utf8");

// Production-shaped LEGACY table (PK bidId) WITH the permissive policy the
// migration must remove — so the closure is exercised, not assumed.
const LEGACY_DDL = `
create table if not exists public.bid_unit_assignments (
  "bidId" text primary key, "unitId" text not null, "unitNumber" text,
  "assignedAt" timestamptz default now(), "assignedBy" text
);
alter table public.bid_unit_assignments enable row level security;
create policy all_anon_all on public.bid_unit_assignments for all to anon, authenticated using (true) with check (true);
grant all on public.bid_unit_assignments to anon, authenticated, service_role;
`;

// ── assert framework ──────────────────────────────────────────────────────────
let passed = 0, failed = 0;
const failures = [];
async function t(name, fn) {
  process.stdout.write(" • " + name + " ... ");
  try { await fn(); console.log("ok"); passed++; }
  catch (e) { console.log("FAIL"); failed++; failures.push({ name, err: e }); }
}
function eq(a, b, l) { if (a !== b) throw new Error((l ? l + ": " : "") + "expected " + JSON.stringify(b) + " got " + JSON.stringify(a)); }
function truthy(a, l) { if (!a) throw new Error((l ? l + ": " : "") + "expected truthy, got " + JSON.stringify(a)); }

// Await a promise that MUST fail with the given P0001 code (message). Returns the error.
async function refused(promise, code, l) {
  let err = null;
  try { await promise; } catch (e) { err = e; }
  truthy(err, (l || "") + " expected a refusal, call succeeded");
  eq(err.code, "P0001", (l || "") + " sqlstate (got " + (err && err.code) + " / " + (err && err.message) + ")");
  eq(err.message, code, (l || "") + " refusal code");
  return err;
}

// ── connections + per-case databases ────────────────────────────────────────
async function conn(dsn) { const c = new Client({ connectionString: dsn }); await c.connect(); return c; }
function dsnFor(baseDsn, dbName) { const u = new URL(baseDsn); u.pathname = "/" + dbName; return u.toString(); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForLockWait(mon, pid, ms = 5000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const r = await mon.query(`select wait_event_type, wait_event, state from pg_stat_activity where pid=$1`, [pid]);
    const w = r.rows[0];
    if (w && w.wait_event_type === "Lock") return w;
    await sleep(15);
  }
  throw new Error("waiter never blocked on a lock");
}

// ── per-DB setup + seed helpers ──────────────────────────────────────────────
async function setupDb(c) {
  await c.query(MINIMAL_SCHEMA);
  await c.query(LEGACY_DDL);
  await c.query(`grant usage on schema public to anon, authenticated, service_role, railway_writer;
    grant select, insert, update, delete on public.bids, public.bid_requests, public.room_blocks, public.hotel_room_units, public.rooms to railway_writer;
    grant select on public.hotel_room_units, public.bids, public.bid_requests, public.room_blocks to anon, authenticated, service_role;
    grant insert, update on public.bids, public.room_blocks to service_role;`);
}
async function seedHotelUnit(c) {
  const hotelId = seed.cuid("th"), roomId = seed.cuid("tr");
  await c.query(`insert into public.rooms (id,"hotelId",quantity) values ($1,$2,4)`, [roomId, hotelId]);
  const unit = seed.cuid("tu");
  await c.query(`insert into public.hotel_room_units (id,"hotelId","roomId","roomNumber",status) values ($1,$2,$3,'101','active')`, [unit, hotelId, roomId]);
  return { hotelId, roomId, unit };
}
async function seedBidLegacy(c, h, unit, status, from, to) {
  const { bidId } = await seed.seedBid(c, { hotelId: h.hotelId, roomId: h.roomId, status, checkIn: from, checkOut: to });
  await c.query(`insert into public.bid_unit_assignments ("bidId","unitId","unitNumber","assignedBy") values ($1,$2,'101','legacy')`, [bidId, unit]);
  return bidId;
}
async function seedBidStamp(c, h, unit, status, from, to) {
  const { bidId } = await seed.seedBid(c, { hotelId: h.hotelId, roomId: h.roomId, status, checkIn: from, checkOut: to });
  await c.query(`update public.bids set "assignedUnitId"=$2 where id=$1`, [bidId, unit]);
  return bidId;
}
async function pinBlock(c, h, unit, from, to, source = "ota") {
  const id = seed.cuid("rb");
  await c.query(`insert into public.room_blocks (id,"hotelId","roomId","fromDate","toDate",source,"assignedUnitId") values ($1,$2,$3,$4,$5,$6,$7)`,
    [id, h.hotelId, h.roomId, from, to, source, unit]);
  return id;
}

// The full "is the stay schema active?" fingerprint — every marker the migration
// installs. CASE 1 asserts NONE of these survive an aborted apply.
async function schemaState(c) {
  const q = async (sql, p) => (await c.query(sql, p)).rows[0].x;
  return {
    linesTable:      await q(`select to_regclass('public.bid_unit_assignment_lines') is not null as x`),
    assignRpc:       await q(`select to_regprocedure('public.stay_assign_units(text,text[],text,text,text)') is not null as x`),
    readyProbe:      await q(`select to_regprocedure('public.stay_assignment_ready()') is not null as x`),
    legacyGuardFn:   await q(`select to_regprocedure('public.stay_guard_legacy_assignment()') is not null as x`),
    syncTrigger:     await q(`select exists(select 1 from pg_trigger where tgname='trg_stay_sync_bid_unit_assignment') as x`),
    blockGuardTrig:  await q(`select exists(select 1 from pg_trigger where tgname='trg_stay_guard_room_block_unit') as x`),
    legacyGuardTrig: await q(`select exists(select 1 from pg_trigger where tgname='trg_stay_guard_legacy_assignment') as x`),
    bidsForced:      await q(`select coalesce((select relforcerowsecurity from pg_class where relname='bids' and relnamespace='public'::regnamespace),false) as x`),
    blocksForced:    await q(`select coalesce((select relforcerowsecurity from pg_class where relname='room_blocks' and relnamespace='public'::regnamespace),false) as x`),
    permissivePolicy:await q(`select exists(select 1 from pg_policies where tablename='bid_unit_assignments' and policyname='all_anon_all') as x`),
  };
}
async function activeLineOnUnit(c, bidId, unitId) {
  return (await c.query(`select * from public.bid_unit_assignment_lines where bid_id=$1 and unit_id=$2 and status='active'`, [bidId, unitId])).rows[0] || null;
}

async function main() {
  console.log("STAY-LIFECYCLE-OPS-01 — M8-R1 zero-corruption cutover (real PostgreSQL)");
  const baseDsn = await harness.start();
  assertTestDsn(baseDsn);

  const admin = await conn(baseDsn);        // sbtest — role bootstrap + DB creation
  const maint = await conn(dsnFor(baseDsn, "postgres")); // maintenance DB for CREATE DATABASE
  const open = [admin, maint];
  try {
    // Roles are CLUSTER-global — create once.
    await admin.query(`do $$ begin
      if not exists (select from pg_roles where rolname='anon') then create role anon nologin; end if;
      if not exists (select from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
      if not exists (select from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
      if not exists (select from pg_roles where rolname='railway_writer') then create role railway_writer nologin bypassrls; end if;
    end $$;`);

    const DBS = ["sbcut1", "sbcut1b", "sbcut1c", "sbcut2", "sbcut3"];
    for (const db of DBS) {
      await maint.query(`drop database if exists ${db}`);
      await maint.query(`create database ${db}`);
    }
    const dsn = Object.fromEntries(DBS.map((d) => [d, dsnFor(baseDsn, d)]));

    // ── CASE 1 — overlapping pre-existing pinned block → atomic failure ───────
    await t("CASE 1 — a live LEGACY assignment overlapping a pre-existing pinned block ABORTS the migration atomically (zero partial schema survives)", async () => {
      const c = await conn(dsn.sbcut1); open.push(c);
      await setupDb(c);
      const h = await seedHotelUnit(c);
      const bid = await seedBidLegacy(c, h, h.unit, "ACCEPTED", "2027-08-10", "2027-08-13");
      // A pre-existing OTA pin overlapping the live assignment (the code-first race).
      await pinBlock(c, h, h.unit, "2027-08-11", "2027-08-12", "ota");

      const before = await schemaState(c);
      eq(before.linesTable, false, "pre: no lines table");
      eq(before.permissivePolicy, true, "pre: legacy permissive policy present");

      const e = await refused(c.query(migrationSql), "stay_assignment_preflight_conflict", "C1 preflight");
      truthy(String(e.detail || "").includes("overlap"), "C1 detail explains the overlap (" + e.detail + ")");

      // ATOMIC: nothing the migration would have installed survives.
      const after = await schemaState(c);
      eq(after.linesTable, false, "C1 lines table NOT created");
      eq(after.assignRpc, false, "C1 assign RPC NOT created");
      eq(after.readyProbe, false, "C1 stay_assignment_ready NOT created");
      eq(after.legacyGuardFn, false, "C1 legacy guard fn NOT created");
      eq(after.syncTrigger, false, "C1 sync trigger NOT created");
      eq(after.blockGuardTrig, false, "C1 room_blocks guard NOT created");
      eq(after.legacyGuardTrig, false, "C1 legacy guard trigger NOT created");
      eq(after.bidsForced, false, "C1 bids RLS NOT forced (M5 rolled back)");
      eq(after.blocksForced, false, "C1 room_blocks RLS NOT forced (M5 rolled back)");
      eq(after.permissivePolicy, true, "C1 legacy permissive policy STILL present (M5 drop rolled back)");
      eq((await c.query(`select count(*)::int n from public.bid_unit_assignments`)).rows[0].n, 1, "C1 legacy rows untouched");

      // PRECISION + RECOVERY: free the unit → the SAME migration now applies.
      await c.query(`delete from public.room_blocks where "assignedUnitId"=$1`, [h.unit]);
      await c.query(migrationSql);
      const rec = await schemaState(c);
      eq(rec.linesTable, true, "C1 recovery: migration applies once the unit is free");
      truthy(await activeLineOnUnit(c, bid, h.unit), "C1 recovery: the live assignment backfilled to an ACTIVE line");
    });

    // ── CASE 1b — the bids.assignedUnitId STAMP source is covered too ─────────
    await t("CASE 1b — a live bids.assignedUnitId STAMP overlapping a pinned block ALSO trips the preflight", async () => {
      const c = await conn(dsn.sbcut1b); open.push(c);
      await setupDb(c);
      const h = await seedHotelUnit(c);
      await seedBidStamp(c, h, h.unit, "CONFIRMED", "2027-09-10", "2027-09-13"); // no legacy row — the column stamp is the only live assignment
      await pinBlock(c, h, h.unit, "2027-09-12", "2027-09-14", "b2b");
      await refused(c.query(migrationSql), "stay_assignment_preflight_conflict", "C1b stamp-source preflight");
      eq((await schemaState(c)).linesTable, false, "C1b nothing installed");
    });

    // ── CASE 1c — a non-occupying (PENDING) stamp does NOT trip the preflight ──
    await t("CASE 1c — a NON-occupying (PENDING) bid stamp overlapping a pinned block does NOT trip the preflight (only occupations count)", async () => {
      const c = await conn(dsn.sbcut1c); open.push(c);
      await setupDb(c);
      const h = await seedHotelUnit(c);
      await seedBidStamp(c, h, h.unit, "PENDING", "2027-10-10", "2027-10-13"); // PENDING is not an occupation
      await pinBlock(c, h, h.unit, "2027-10-11", "2027-10-12", "ota");
      await c.query(migrationSql); // must NOT raise
      eq((await schemaState(c)).linesTable, true, "C1c migration applied (no false conflict)");
    });

    // ── CASE 2 — non-overlapping block → success + guards active ──────────────
    await t("CASE 2 — a NON-overlapping pinned block lets the migration SUCCEED; the live assignment is backfilled ACTIVE; guards are live", async () => {
      const c = await conn(dsn.sbcut2); open.push(c);
      await setupDb(c);
      const h = await seedHotelUnit(c);
      const bid = await seedBidLegacy(c, h, h.unit, "ACCEPTED", "2027-11-10", "2027-11-13");
      await pinBlock(c, h, h.unit, "2027-11-20", "2027-11-22", "ota"); // NON-overlapping → no conflict

      await c.query(migrationSql); // succeeds
      const st = await schemaState(c);
      eq(st.linesTable, true, "C2 lines table created");
      eq(st.blockGuardTrig, true, "C2 room_blocks guard active");
      eq(st.legacyGuardTrig, true, "C2 legacy convergence guard active");
      eq(st.readyProbe, true, "C2 stay_assignment_ready installed (code-first ready signal)");
      eq((await c.query(`select public.stay_assignment_ready() as x`)).rows[0].x, true, "C2 stay_assignment_ready()=true");
      truthy(await activeLineOnUnit(c, bid, h.unit), "C2 backfilled ACTIVE line for the live assignment");

      // The room_blocks guard is LIVE: a NEW pin overlapping the backfilled line is refused.
      // (service_role = BYPASSRLS writer; single-statement param queries only.)
      await c.query("set role service_role");
      const e1 = await refused(
        c.query(`insert into public.room_blocks (id,"hotelId","roomId","fromDate","toDate",source,"assignedUnitId") values ($1,$2,$3,'2027-11-11','2027-11-12','ota',$4)`,
          [seed.cuid("rb"), h.hotelId, h.roomId, h.unit]),
        "unit_conflict", "C2 new conflicting pin");
      eq(e1.detail, h.unit, "C2 conflict names the unit");

      // The legacy convergence guard: a direct legacy write with NO active line is refused (the old-v752 closure).
      const e2 = await refused(
        c.query(`insert into public.bid_unit_assignments ("bidId","unitId","unitNumber","assignedBy") values ($1,$2,'999','v752-inflight')`,
          [seed.cuid("bid"), seed.cuid("tu")]),
        "legacy_assignment_without_line", "C2 legacy-only in-flight write");
      await c.query("reset role");
      eq((await c.query(`select count(*)::int n from public.room_blocks where "fromDate"='2027-11-11'`)).rows[0].n, 0, "C2 the conflicting pin wrote nothing");

      // …but the sanctioned RPC path (line FIRST, then mirror) still writes through the guard.
      const b2 = await seed.seedBid(c, { hotelId: h.hotelId, roomId: h.roomId, status: "ACCEPTED", checkIn: "2027-12-01", checkOut: "2027-12-03" });
      const out = (await c.query(`select public.stay_assign_units($1,$2::text[],'partner_c2','assign',null) as out`, [b2.bidId, [h.unit]])).rows[0].out;
      eq(out.ok, true, "C2 sanctioned RPC assign succeeds through the legacy guard");
      truthy((await c.query(`select 1 from public.bid_unit_assignments where "bidId"=$1`, [b2.bidId])).rows[0], "C2 RPC wrote the legacy mirror");
    });

    // ── CASE 3 — a concurrent pinned write blocks on the migration's lock ──────
    await t("CASE 3 — a concurrent pinned room_blocks write BLOCKS on the migration's EXCLUSIVE lock and cannot slip between preflight and activation", async () => {
      const c = await conn(dsn.sbcut3); open.push(c);
      await setupDb(c);
      const h = await seedHotelUnit(c);
      const bid = await seedBidLegacy(c, h, h.unit, "ACCEPTED", "2028-01-10", "2028-01-13");

      // Migration runner A: run the WHOLE migration inside an explicit txn but do
      // NOT commit — the top-of-file EXCLUSIVE lock is held until COMMIT.
      const A = await conn(dsn.sbcut3); open.push(A);
      await A.query("begin");
      await A.query(migrationSql); // preflight passes (no conflicting block yet), schema built, lock HELD
      // The new schema is created inside A's uncommitted txn → invisible elsewhere.
      // (to_regclass is a catalog lookup — it does NOT lock the occupancy tables,
      // so this read does not itself block on A's ACCESS EXCLUSIVE lock.)
      eq((await c.query(`select to_regclass('public.bid_unit_assignment_lines') is not null as x`)).rows[0].x, false, "C3 lines table invisible to others pre-commit");

      // Writer B: a pre-existing-style pinned write on the same unit, overlapping.
      // The migration's ALTER TABLE / CREATE TRIGGER on room_blocks escalate to
      // ACCESS EXCLUSIVE (held until COMMIT), so B cannot even PARSE the INSERT —
      // it blocks on the relation lock. That is STRICTLY STRONGER than "cannot
      // write": no session can touch the occupancy tables until activation.
      const B = await conn(dsn.sbcut3); open.push(B);
      const mon = await conn(dsn.sbcut3); open.push(mon); // reads pg_stat_activity ONLY (never the locked tables)
      await B.query("set role service_role"); // BYPASSRLS writer (OTA sync / inventory hold)
      const bpid = (await B.query(`select pg_backend_pid() as pid`)).rows[0].pid;
      const pinP = B.query(`insert into public.room_blocks (id,"hotelId","roomId","fromDate","toDate",source,"assignedUnitId") values ($1,$2,$3,'2028-01-11','2028-01-12','ota',$4)`,
        [seed.cuid("rb"), h.hotelId, h.roomId, h.unit]);
      let pinErr = null; pinP.catch((e) => { pinErr = e; }); // capture without unhandled-rejection

      // B must be BLOCKED on a Lock (it did NOT slip through). Observed via
      // pg_stat_activity — NOT by reading room_blocks (that read would itself
      // block on the same ACCESS EXCLUSIVE lock and deadlock the test).
      const w = await waitForLockWait(mon, bpid);
      truthy(w.wait_event_type === "Lock", "C3 writer is blocked on a Lock (" + w.wait_event + ")");
      eq((await c.query(`select to_regclass('public.bid_unit_assignment_lines') is not null as x`)).rows[0].x, false, "C3 schema still not active while the writer is blocked (cannot slip between preflight and activation)");

      // Activate: commit the migration. B unblocks and now meets the ACTIVE guard.
      await A.query("commit");
      const e = await refused(pinP, "unit_conflict", "C3 writer meets the now-active guard");
      eq(e.detail, h.unit, "C3 refusal names the unit");
      await B.query("reset role").catch(() => {});
      eq((await c.query(`select count(*)::int n from public.room_blocks where "assignedUnitId"=$1`, [h.unit])).rows[0].n, 0, "C3 the racing pin wrote nothing");
      eq((await c.query(`select to_regclass('public.bid_unit_assignment_lines') is not null as x`)).rows[0].x, true, "C3 schema is active post-commit");
      truthy(await activeLineOnUnit(c, bid, h.unit), "C3 the live assignment is now an ACTIVE line");
      void pinErr;
    });
  } finally {
    for (const c of open) { try { await c.end(); } catch { /* ignore */ } }
    await harness.stop();
  }

  console.log("");
  if (failures.length) {
    console.log("• FAILURES:");
    for (const f of failures) console.log("   ✗ " + f.name + "\n     " + (f.err && f.err.stack ? f.err.stack.split("\n").slice(0, 3).join("\n     ") : f.err));
  }
  console.log("• RESULT: " + passed + " passed, " + failed + " failed");
  console.log(failed ? "• FAIL" : "• ALL PASS");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); try { harness.stop(); } catch {} process.exit(1); });
