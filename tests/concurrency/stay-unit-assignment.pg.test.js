#!/usr/bin/env node
/* eslint-disable no-console */
// ═════════════════════════════════════════════════════════════════════════════
// STAY-LIFECYCLE-OPS-01 — physical unit assignment: ATOMIC mutation authority,
// ongoing writer synchronization, ONE cross-table serialization strategy, and
// privilege closure — proven against a REAL PostgreSQL running the ACTUAL
// migration SQL (migrations/2026-09-13-v753-stay-lifecycle-ops-unit-assignment-
// lines.sql). Run: node tests/concurrency/stay-unit-assignment.pg.test.js
//
// Throwaway socket-only cluster (.pg-harness) with Supabase-like roles (anon /
// authenticated NOLOGIN, service_role BYPASSRLS) + a non-owner `railway_writer`
// role standing in for the backend's DB role. NEVER touches Supabase / staging /
// production (dsn-guard). If postgres binaries are unavailable the harness exits
// NON-ZERO (unproven) — a SKIP is never a PASS.
//
// Proves (owner-controller M1–M4 material findings):
//   M1 — every assignment mutation is ONE transaction: a refusal (409-class) or a
//        mid-transaction failure (injected at the legacy-mirror stage) leaves the
//        PREVIOUS ACTIVE ASSIGNMENT INTACT — replacement after an old assignment
//        exists, mirror-stage failure, multi-unit partial failure, in-house
//        transfer failure.
//   M2 — a direct bids."assignedUnitId" writer (INSERT / UPDATE by a non-owner
//        role, as the backend or the unit-level booking flow would) is synced
//        into the authoritative lines table immediately and participates in
//        conflict authority: a second overlapping booking is REJECTED; lifecycle
//        exits (CHECKED_OUT / terminal / cleared column) release the unit.
//   M3 — bid-line vs walk-in block, block vs block, and line vs line races on the
//        same unit-night are serialized by the shared per-unit advisory lock +
//        fresh re-check: exactly one wins; wrong-hotel / wrong-category /
//        inactive / unknown pins are refused; the unit NUMBER is derived
//        server-side; a unit-pinned OTA block stays conflict-visible.
//   privilege — RLS enabled+forced, zero client policies, the permissive legacy
//        policy gone; EXECUTE revoked from anon/authenticated/public (and the
//        non-owner writer) on every RPC; service_role can execute; the triggers
//        still fire for the non-owner writer and cannot be called directly.
// ═════════════════════════════════════════════════════════════════════════════
"use strict";

let Client;
try { ({ Client } = require("pg")); } catch {
  console.error("[stay-units] `pg` is not installed. Run `npm ci`.");
  process.exit(2);
}
// DATE columns come back as the literal 'YYYY-MM-DD' (never a JS Date) so the
// stay-range assertions compare exact strings.
require("pg").types.setTypeParser(1082, (v) => v);
const path = require("path");
const fs = require("fs");
const harness = require("./.pg-harness");
const { assertTestDsn } = require("./dsn-guard");
const { MINIMAL_SCHEMA } = require("./apply-migrations");
const seed = require("./seed");

const MIGRATION = path.resolve(__dirname, "..", "..", "migrations", "2026-09-13-v753-stay-lifecycle-ops-unit-assignment-lines.sql");

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

// ── DB helpers ────────────────────────────────────────────────────────────────
async function conn(dsn) { const c = new Client({ connectionString: dsn }); await c.connect(); return c; }
async function assign(c, bidId, unitIds, opts = {}) {
  const r = await c.query(`select public.stay_assign_units($1::text, $2::text[], $3::text, $4::text, $5::text) as out`,
    [bidId, unitIds, opts.subject || "partner_test", opts.mode || "assign", opts.reason || null]);
  return r.rows[0].out;
}
async function release(c, bidId, reason = "unassigned") {
  const r = await c.query(`select public.stay_release_units($1::text, $2::text, $3::text) as out`, [bidId, "partner_test", reason]);
  return r.rows[0].out;
}
/** Await a promise that MUST fail with the given P0001 code (message) — returns the error. */
async function refused(promise, code, l) {
  let err = null;
  try { await promise; } catch (e) { err = e; }
  truthy(err, (l || "") + " expected a refusal, call succeeded");
  eq(err.code, "P0001", (l || "") + " sqlstate");
  eq(err.message, code, (l || "") + " refusal code");
  return err;
}
async function fails(promise, l) {
  let err = null;
  try { await promise; } catch (e) { err = e; }
  truthy(err, (l || "") + " expected failure");
  return err;
}
async function asRole(c, role, sql, params) {
  await c.query(`set role ${role}`);
  try { return await c.query(sql, params); } finally { await c.query("reset role"); }
}
async function activeLines(c, bidId) {
  return (await c.query(`select * from public.bid_unit_assignment_lines where bid_id=$1 and status='active' order by slot`, [bidId])).rows;
}
async function allLines(c, bidId) {
  return (await c.query(`select * from public.bid_unit_assignment_lines where bid_id=$1 order by assigned_at, slot`, [bidId])).rows;
}
async function mirror(c, bidId) {
  return (await c.query(`select * from public.bid_unit_assignments where "bidId"=$1`, [bidId])).rows[0] || null;
}
async function bidUnit(c, bidId) {
  return (await c.query(`select "assignedUnitId" as u, status from public.bids where id=$1`, [bidId])).rows[0];
}
async function blocksOnUnit(c, unitId) {
  return (await c.query(`select * from public.room_blocks where "assignedUnitId"=$1`, [unitId])).rows;
}
async function waitForLockWait(mon, pid, ms = 5000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const r = await mon.query(`select wait_event_type, wait_event from pg_stat_activity where pid=$1`, [pid]);
    const w = r.rows[0];
    if (w && w.wait_event_type === "Lock") return w;
    await new Promise((res) => setTimeout(res, 15));
  }
  throw new Error("waiter never blocked on a lock");
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Seed a hotel with a room category holding N active units (+ inactive / foreign units). */
async function seedHotel(c, n = 6) {
  const hotelId = seed.cuid("th"), roomId = seed.cuid("tr"), otherHotel = seed.cuid("th"), otherRoom = seed.cuid("tr");
  await c.query(`insert into public.rooms (id,"hotelId",quantity) values ($1,$2,$3),($4,$2,1),($5,$6,1)`, [roomId, hotelId, n, otherRoom, seed.cuid("tr"), otherHotel]);
  const units = [];
  for (let i = 0; i < n; i++) {
    const id = seed.cuid("tu");
    await c.query(`insert into public.hotel_room_units (id,"hotelId","roomId","roomNumber",status) values ($1,$2,$3,$4,'active')`, [id, hotelId, roomId, String(101 + i)]);
    units.push(id);
  }
  const inactive = seed.cuid("tu"), foreign = seed.cuid("tu"), otherCat = seed.cuid("tu");
  await c.query(`insert into public.hotel_room_units (id,"hotelId","roomId","roomNumber",status) values ($1,$2,$3,'190','inactive'),($4,$5,$3,'901','active'),($6,$2,$7,'201','active')`,
    [inactive, hotelId, roomId, foreign, otherHotel, otherCat, otherRoom]);
  return { hotelId, roomId, units, inactive, foreign, otherCat, otherHotel, otherRoom };
}
async function seedBid(c, h, status, from, to, extra = {}) {
  const { bidId } = await seed.seedBid(c, { hotelId: h.hotelId, roomId: h.roomId, status, checkIn: from, checkOut: to, numRooms: extra.numRooms || 1 });
  return bidId;
}

async function main() {
  console.log("STAY-LIFECYCLE-OPS-01 — unit assignment atomicity / sync / serialization suite (real PostgreSQL)");
  const dsn = await harness.start();
  assertTestDsn(dsn);
  const c = await conn(dsn);
  let mon; // monitor connection for lock-wait observation
  try {
    // Supabase-like roles + a non-owner backend writer role.
    await c.query(`do $$ begin
      if not exists (select from pg_roles where rolname='anon') then create role anon nologin; end if;
      if not exists (select from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
      if not exists (select from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
      if not exists (select from pg_roles where rolname='railway_writer') then create role railway_writer nologin; end if;
    end $$;`);
    await c.query(MINIMAL_SCHEMA);
    await c.query(LEGACY_DDL);
    await c.query(`grant usage on schema public to anon, authenticated, service_role, railway_writer;
      grant select, insert, update, delete on public.bids, public.bid_requests, public.room_blocks, public.hotel_room_units, public.rooms to railway_writer;
      grant select on public.hotel_room_units, public.bids, public.bid_requests, public.room_blocks to anon, authenticated, service_role;
      grant insert, update on public.bids, public.room_blocks to service_role;`);

    // ── PRE-MIGRATION data (backfill inputs) ────────────────────────────────
    const pre = await seedHotel(c, 3);
    const preAcc = await seedBid(c, pre, "ACCEPTED", "2027-03-10", "2027-03-12");
    const preOut = await seedBid(c, pre, "CHECKED_OUT", "2027-02-01", "2027-02-03");
    const preStamp = await seedBid(c, pre, "ACCEPTED", "2027-03-20", "2027-03-22");
    await c.query(`insert into public.bid_unit_assignments ("bidId","unitId","unitNumber","assignedBy") values ($1,$2,'101','legacy_p'),($3,$4,'102','legacy_p')`, [preAcc, pre.units[0], preOut, pre.units[1]]);
    await c.query(`update public.bids set "assignedUnitId"=$2 where id=$1`, [preStamp, pre.units[2]]);

    const migrationSql = fs.readFileSync(MIGRATION, "utf8");

    await t("0. migration applies to the legacy-shaped DB and is idempotent (re-apply)", async () => {
      await c.query(migrationSql);
      await c.query(migrationSql);
      eq((await c.query(`select to_regclass('public.bid_unit_assignment_lines') is not null as x`)).rows[0].x, true, "lines table");
    });

    await t("0b. backfill — legacy rows follow the bid lifecycle; bids-only stamps get ACTIVE lines + a mirror; re-apply adds nothing", async () => {
      const a = await allLines(c, preAcc); eq(a.length, 1); eq(a[0].status, "active"); eq(String(a[0].stay_from).slice(0, 10), "2027-03-10"); eq(a[0].unit_id, pre.units[0]);
      const o = await allLines(c, preOut); eq(o.length, 1); eq(o[0].status, "completed", "checked-out legacy row is 'completed' (no longer occupying)");
      const s = await allLines(c, preStamp); eq(s.length, 1); eq(s[0].status, "active"); eq(s[0].reason, "backfill: bids.assignedUnitId");
      truthy(await mirror(c, preStamp), "mirror created for the bids-only stamp");
      const before = (await c.query(`select count(*)::int as n from public.bid_unit_assignment_lines`)).rows[0].n;
      await c.query(migrationSql);
      eq((await c.query(`select count(*)::int as n from public.bid_unit_assignment_lines`)).rows[0].n, before, "re-apply is a no-op on lines");
    });

    await t("0c. privilege / RLS contract — lines + legacy deny-by-default; permissive legacy policy GONE; RPC EXECUTE service_role-only", async () => {
      for (const tbl of ["bid_unit_assignment_lines", "bid_unit_assignments"]) {
        eq((await c.query(`select (relrowsecurity and relforcerowsecurity) as x from pg_class where relname=$1`, [tbl])).rows[0].x, true, tbl + " RLS enabled+forced");
        eq((await c.query(`select count(*)::int as n from pg_policies where schemaname='public' and tablename=$1`, [tbl])).rows[0].n, 0, tbl + " zero policies");
        eq((await c.query(`select count(*)::int as n from information_schema.role_table_grants where table_schema='public' and table_name=$1 and grantee in ('anon','authenticated')`, [tbl])).rows[0].n, 0, tbl + " no client grants");
        truthy((await c.query(`select count(*)::int as n from information_schema.role_table_grants where table_schema='public' and table_name=$1 and grantee='service_role'`, [tbl])).rows[0].n >= 4, tbl + " service_role grants");
      }
      const fn = "public.stay_assign_units(text,text[],text,text,text)";
      for (const role of ["anon", "authenticated", "railway_writer"]) {
        eq((await c.query(`select has_function_privilege($1, $2, 'EXECUTE') as x`, [role, fn])).rows[0].x, false, role + " cannot EXECUTE the RPC");
        const e = await fails(asRole(c, role, `select public.stay_assign_units('x','{u}','p','assign',null)`), role + " direct call");
        eq(e.code, "42501", role + " permission denied");
      }
      eq((await c.query(`select has_function_privilege('service_role', $1, 'EXECUTE') as x`, [fn])).rows[0].x, true, "service_role can EXECUTE");
      for (const f of ["public.stay_release_units(text,text,text)", "public.stay_assign_block_unit(text,text,text)", "public.stay_release_block_unit(text,text)", "public.stay_sync_bid_unit_assignment()", "public.stay_guard_room_block_unit()"]) {
        eq((await c.query(`select has_function_privilege('anon', $1, 'EXECUTE') as x`, [f])).rows[0].x, false, f + " anon");
        eq((await c.query(`select has_function_privilege('authenticated', $1, 'EXECUTE') as x`, [f])).rows[0].x, false, f + " authenticated");
      }
      const e2 = await fails(asRole(c, "anon", `select * from public.bid_unit_assignment_lines`), "anon select lines"); eq(e2.code, "42501");
      const e3 = await fails(asRole(c, "authenticated", `insert into public.bid_unit_assignments ("bidId","unitId") values ('forge','u')`), "authenticated insert legacy"); eq(e3.code, "42501");
      const e4 = await fails(asRole(c, "railway_writer", `select public.stay_sync_bid_unit_assignment()`), "trigger fn direct call");
      truthy(e4.code === "42501" || e4.code === "0A000", "trigger function cannot be called directly (" + e4.code + ")");
    });

    // ── Working fixtures ─────────────────────────────────────────────────────
    const h = await seedHotel(c, 8);
    const [u1, u2, u3, u4, u5, u6, u7, u8] = h.units;

    await t("A. atomic assign → ACTIVE dated line + slot-1 mirror + bids.assignedUnitId in one transaction (service_role)", async () => {
      const b = await seedBid(c, h, "ACCEPTED", "2027-04-10", "2027-04-13");
      const out = (await asRole(c, "service_role", `select public.stay_assign_units($1,$2::text[],'partner_a','assign',null) as out`, [b, [u1]])).rows[0].out;
      eq(out.ok, true); eq(out.required, 1); eq(out.assigned.length, 1); eq(out.assigned[0].unitId, u1); eq(out.assigned[0].slot, 1);
      const l = await activeLines(c, b); eq(l.length, 1); eq(l[0].unit_id, u1); eq(l[0].unit_number, "101"); eq(l[0].assigned_by, "partner_a"); eq(String(l[0].stay_from).slice(0, 10), "2027-04-10"); eq(String(l[0].stay_to).slice(0, 10), "2027-04-13");
      const m = await mirror(c, b); eq(m && m.unitId, u1); eq(m.unitNumber, "101");
      eq((await bidUnit(c, b)).u, u1, "bids.assignedUnitId mirrored");
      // idempotent replay
      const out2 = await assign(c, b, [u1]); eq(out2.assigned.length, 1); eq((await allLines(c, b)).length, 1, "replay adds no line");
    });

    await t("B. re-assign before check-in SUPERSEDES the old line (history kept, nothing deleted)", async () => {
      const b = await seedBid(c, h, "ACCEPTED", "2027-04-10", "2027-04-13");
      await assign(c, b, [u2]); await assign(c, b, [u3]);
      const all = await allLines(c, b); eq(all.length, 2);
      const old = all.find((x) => x.unit_id === u2); eq(old.status, "superseded"); eq(old.reason, "reassigned before check-in"); eq(old.released_by, "partner_test"); truthy(old.released_at);
      const act = await activeLines(c, b); eq(act.length, 1); eq(act[0].unit_id, u3); eq(act[0].slot, 1);
      eq((await mirror(c, b)).unitId, u3); eq((await bidUnit(c, b)).u, u3);
    });

    await t("C. M1 — replacement CONFLICT after an old assignment exists: refused, previous active assignment INTACT", async () => {
      const a = await seedBid(c, h, "ACCEPTED", "2027-05-10", "2027-05-13");
      const b = await seedBid(c, h, "ACCEPTED", "2027-05-12", "2027-05-14");
      await assign(c, a, [u1]); await assign(c, b, [u2]);
      const beforeB = await activeLines(c, b);
      const e = await refused(assign(c, b, [u1]), "unit_conflict", "C"); eq(e.detail, u1, "detail names the unit");
      const afterB = await activeLines(c, b); eq(afterB.length, 1); eq(afterB[0].id, beforeB[0].id, "same active line row"); eq(afterB[0].status, "active");
      eq((await allLines(c, b)).length, 1, "no u1 line was ever written for b");
      eq((await mirror(c, b)).unitId, u2); eq((await bidUnit(c, b)).u, u2);
      eq((await activeLines(c, a)).length, 1, "holder untouched");
    });

    // Injected mid-transaction failure at the legacy-mirror stage (AFTER the
    // supersede + insert statements ran) — proves the whole RPC rolls back.
    await c.query(`create or replace function public.test_fail_mirror() returns trigger language plpgsql as $$
      begin
        if new."bidId" = current_setting('sb.test_fail_bid', true) then raise exception 'test_mirror_failure'; end if;
        return new;
      end $$;
      create trigger trg_test_fail_mirror before insert or update on public.bid_unit_assignments for each row execute function public.test_fail_mirror();`);
    const failMirrorFor = (bid) => c.query(`select set_config('sb.test_fail_bid', $1, false)`, [bid]);

    await t("D. M1 — MIRROR-STAGE failure rolls back the supersede + insert: previous assignment intact, nothing written", async () => {
      const b = await seedBid(c, h, "ACCEPTED", "2027-06-10", "2027-06-13");
      await assign(c, b, [u4]);
      const before = await activeLines(c, b);
      await failMirrorFor(b);
      const e = await fails(assign(c, b, [u5]), "D"); eq(e.message, "test_mirror_failure");
      await failMirrorFor("");
      const after = await activeLines(c, b); eq(after.length, 1); eq(after[0].id, before[0].id); eq(after[0].status, "active"); eq(after[0].unit_id, u4);
      eq((await allLines(c, b)).length, 1, "no u5 line exists (insert rolled back)");
      eq((await mirror(c, b)).unitId, u4); eq((await bidUnit(c, b)).u, u4);
      const ok = await assign(c, b, [u5]); eq(ok.assigned[0].unitId, u5, "same request succeeds once the failure is gone");
    });

    await t("E. M1 — MULTI-UNIT partial failure (2-room): conflict on the 2nd unit + mirror failure both leave [u4,u5]-style set intact", async () => {
      const b = await seedBid(c, h, "ACCEPTED", "2027-07-10", "2027-07-13", { numRooms: 2 });
      const holder = await seedBid(c, h, "ACCEPTED", "2027-07-11", "2027-07-12");
      await assign(c, holder, [u6]);
      const out = await assign(c, b, [u7, u8]); eq(out.required, 2); eq(out.assigned.map((x) => x.slot).join(","), "1,2");
      const before = await activeLines(c, b);
      await refused(assign(c, b, [u7, u6]), "unit_conflict", "E.conflict");
      let after = await activeLines(c, b); eq(after.length, 2); eq(after.map((x) => x.id).join(","), before.map((x) => x.id).join(","), "both lines untouched"); eq(after.map((x) => x.status).join(","), "active,active");
      eq((await allLines(c, b)).length, 2, "no u6 line written");
      await failMirrorFor(b);
      const e = await fails(assign(c, b, [u7, u1]), "E.mirror"); eq(e.message, "test_mirror_failure");
      await failMirrorFor("");
      after = await activeLines(c, b); eq(after.map((x) => x.id).join(","), before.map((x) => x.id).join(","), "u8 NOT superseded, u1 NOT inserted");
      eq((await allLines(c, b)).length, 2); eq((await mirror(c, b)).unitId, u7); eq((await bidUnit(c, b)).u, u7);
      // cardinality refusals write nothing
      await refused(assign(c, b, [u7, u1, u2]), "too_many_units", "E.too_many");
      await refused(assign(c, b, [u7, u7]), "duplicate_unit", "E.dup");
      await refused(assign(c, b, []), "no_units", "E.none");
      eq((await allLines(c, b)).length, 2);
    });

    await t("F. M1 — IN-HOUSE transfer: explicit only; conflict / missing reason / mirror failure keep the current room; success supersedes with audited reason", async () => {
      const b = await seedBid(c, h, "ACCEPTED", "2027-08-10", "2027-08-13");
      const other = await seedBid(c, h, "ACCEPTED", "2027-08-11", "2027-08-12");
      await assign(c, b, [u1]); await assign(c, other, [u2]);
      await c.query(`update public.bids set status='CHECKED_IN' where id=$1`, [b]);
      eq((await activeLines(c, b)).length, 1, "check-in keeps the line");
      await refused(assign(c, b, [u3]), "transfer_confirmation_required", "F.ordinary");
      await refused(assign(c, b, [u3], { mode: "transfer" }), "transfer_reason_required", "F.noreason");
      await refused(assign(c, b, [u2], { mode: "transfer", reason: "AC failure" }), "unit_conflict", "F.conflict");
      await failMirrorFor(b);
      const e = await fails(assign(c, b, [u3], { mode: "transfer", reason: "AC failure" }), "F.mirror"); eq(e.message, "test_mirror_failure");
      await failMirrorFor("");
      let act = await activeLines(c, b); eq(act.length, 1); eq(act[0].unit_id, u1, "still in u1 after every failed transfer"); eq((await allLines(c, b)).length, 1);
      eq((await mirror(c, b)).unitId, u1); eq((await bidUnit(c, b)).u, u1);
      const out = await assign(c, b, [u3], { mode: "transfer", reason: "AC failure in 101" }); eq(out.action, "transfer");
      const all = await allLines(c, b); eq(all.length, 2);
      const old = all.find((x) => x.unit_id === u1); eq(old.status, "superseded"); eq(old.reason, "transfer: AC failure in 101"); eq(old.released_by, "partner_test");
      act = await activeLines(c, b); eq(act[0].unit_id, u3); eq(act[0].reason, "transfer: AC failure in 101"); eq(act[0].slot, 1);
      eq((await mirror(c, b)).unitId, u3); eq((await bidUnit(c, b)).u, u3);
      await refused(release(c, b), "unassign_not_allowed_in_house", "F.release_in_house");
      await c.query(`update public.bids set status='CHECKED_OUT' where id=$1`, [b]);
      const done = await allLines(c, b); eq(done.find((x) => x.unit_id === u3).status, "completed", "checkout completes the line");
      await refused(assign(c, b, [u4]), "stay_completed", "F.frozen");
      await refused(assign(c, b, [u4], { mode: "transfer", reason: "x" }), "stay_completed", "F.frozen_transfer");
      await refused(release(c, b), "stay_completed", "F.frozen_release");
      // the freed unit is takeable by an overlapping stay now
      const nxt = await seedBid(c, h, "ACCEPTED", "2027-08-10", "2027-08-13"); await assign(c, nxt, [u3]);
    });

    await t("G. release before check-in → lines RELEASED (kept), mirror deleted, column cleared", async () => {
      const b = await seedBid(c, h, "ACCEPTED", "2027-09-10", "2027-09-13", { numRooms: 2 });
      await assign(c, b, [u1, u2]);
      const out = await release(c, b); eq(out.ok, true); eq(out.released.length, 2);
      eq((await activeLines(c, b)).length, 0); eq((await allLines(c, b)).map((x) => x.status).join(","), "released,released");
      eq(await mirror(c, b), null); eq((await bidUnit(c, b)).u, null);
      await refused(assign(c, b, [u1], { mode: "transfer", reason: "x" }), "transfer_only_while_checked_in", "G.transfer_pre");
    });

    await t("H. refusals — bid_not_found / bid_not_reservable (PENDING) / stay_dates_unavailable / unit_not_found / wrong hotel / wrong category / inactive", async () => {
      await refused(assign(c, "nope", [u1]), "bid_not_found", "H.nf");
      const p = await seedBid(c, h, "PENDING", "2027-10-10", "2027-10-12"); await refused(assign(c, p, [u1]), "bid_not_reservable", "H.pending");
      const nd = seed.cuid("bid"); await c.query(`insert into public.bids (id,"hotelId","roomId",status) values ($1,$2,$3,'ACCEPTED')`, [nd, h.hotelId, h.roomId]);
      await refused(assign(c, nd, [u1]), "stay_dates_unavailable", "H.nodates");
      const b = await seedBid(c, h, "ACCEPTED", "2027-10-10", "2027-10-12");
      await refused(assign(c, b, ["ghost"]), "unit_not_found", "H.ghost");
      await refused(assign(c, b, [h.foreign]), "unit_wrong_hotel", "H.hotel");
      await refused(assign(c, b, [h.otherCat]), "unit_wrong_category", "H.cat");
      await refused(assign(c, b, [h.inactive]), "unit_inactive", "H.inactive");
      eq((await allLines(c, b)).length, 0, "nothing written by any refusal");
    });

    // ── M3 — serialization races ─────────────────────────────────────────────
    mon = await conn(dsn);
    await t("I. M3 — bid RPC (holding the unit lock) vs concurrent walk-in block INSERT on the same unit-night → block waits, re-checks, REFUSED", async () => {
      const b = await seedBid(c, h, "ACCEPTED", "2027-11-10", "2027-11-13");
      const cA = await conn(dsn), cB = await conn(dsn);
      try {
        const pidB = (await cB.query(`select pg_backend_pid() as p`)).rows[0].p;
        await cA.query("begin"); await assign(cA, b, [u4]);
        await cB.query("begin");
        const pB = cB.query(`insert into public.room_blocks (id,"hotelId","roomId","fromDate","toDate",source,"assignedUnitId") values ($1,$2,$3,'2027-11-11','2027-11-12','walk_in',$4)`, [seed.cuid("rb"), h.hotelId, h.roomId, u4]).then(() => null, (e) => e);
        const w = await waitForLockWait(mon, pidB); eq(w.wait_event, "advisory", "waiter blocked on the per-unit ADVISORY lock");
        await cA.query("commit");
        const eB = await pB; truthy(eB, "block insert must fail"); eq(eB.code, "P0001"); eq(eB.message, "unit_conflict");
        await cB.query("rollback");
      } finally { await cA.end(); await cB.end(); }
      eq((await activeLines(c, b)).length, 1); eq((await blocksOnUnit(c, u4)).length, 0, "no block pinned to the unit");
    });

    await t("I2. M3 — walk-in block INSERT (holding the lock) vs concurrent bid RPC → RPC waits, re-checks, REFUSED; block wins", async () => {
      const b = await seedBid(c, h, "ACCEPTED", "2027-11-20", "2027-11-23");
      const cA = await conn(dsn), cB = await conn(dsn);
      const blk = seed.cuid("rb");
      try {
        const pidA = (await cA.query(`select pg_backend_pid() as p`)).rows[0].p;
        await cB.query("begin");
        await cB.query(`insert into public.room_blocks (id,"hotelId","roomId","fromDate","toDate",source,"assignedUnitId") values ($1,$2,$3,'2027-11-21','2027-11-22','walk_in',$4)`, [blk, h.hotelId, h.roomId, u5]);
        await cA.query("begin");
        const pA = assign(cA, b, [u5]).then(() => null, (e) => e);
        const w = await waitForLockWait(mon, pidA); eq(w.wait_event, "advisory");
        await cB.query("commit");
        const eA = await pA; truthy(eA); eq(eA.message, "unit_conflict");
        await cA.query("rollback");
      } finally { await cA.end(); await cB.end(); }
      eq((await allLines(c, b)).length, 0, "bid got no line"); eq((await blocksOnUnit(c, u5)).length, 1, "block committed");
      eq((await blocksOnUnit(c, u5))[0].assignedUnitNumber, "105", "unit number derived server-side by the guard");
      await c.query(`delete from public.room_blocks where id=$1`, [blk]);
    });

    await t("I3. M3 — simultaneous (no explicit txn) bid RPC vs block insert → exactly ONE wins", async () => {
      const b = await seedBid(c, h, "ACCEPTED", "2027-12-10", "2027-12-13");
      const cA = await conn(dsn), cB = await conn(dsn);
      const blk = seed.cuid("rb");
      try {
        const [rA, rB] = await Promise.all([
          assign(cA, b, [u6]).then(() => "ok", (e) => e.message),
          cB.query(`insert into public.room_blocks (id,"hotelId","roomId","fromDate","toDate",source,"assignedUnitId") values ($1,$2,$3,'2027-12-11','2027-12-12','manual',$4)`, [blk, h.hotelId, h.roomId, u6]).then(() => "ok", (e) => e.message),
        ]);
        eq([rA, rB].filter((x) => x === "ok").length, 1, "one winner (" + rA + " / " + rB + ")");
        eq([rA, rB].filter((x) => x === "unit_conflict").length, 1, "one unit_conflict");
      } finally { await cA.end(); await cB.end(); }
      eq((await activeLines(c, b)).length + (await blocksOnUnit(c, u6)).length, 1, "unit-night held exactly once");
      await c.query(`delete from public.room_blocks where id=$1`, [blk]);
    });

    await t("J. M3 — block vs block race on the same unit-night → exactly one block row", async () => {
      const cA = await conn(dsn), cB = await conn(dsn);
      try {
        const mk = (cl) => cl.query(`insert into public.room_blocks (id,"hotelId","roomId","fromDate","toDate",source,"assignedUnitId") values ($1,$2,$3,'2028-01-10','2028-01-12','walk_in',$4)`, [seed.cuid("rb"), h.hotelId, h.roomId, u7]).then(() => "ok", (e) => e.message);
        const [rA, rB] = await Promise.all([mk(cA), mk(cB)]);
        eq([rA, rB].filter((x) => x === "ok").length, 1, "one winner"); eq([rA, rB].filter((x) => x === "unit_conflict").length, 1);
        // explicit ordering: holder in-txn, second waits on the advisory lock then refuses
        const cC = await conn(dsn), cD = await conn(dsn);
        try {
          const pidD = (await cD.query(`select pg_backend_pid() as p`)).rows[0].p;
          await cC.query("begin");
          await cC.query(`insert into public.room_blocks (id,"hotelId","roomId","fromDate","toDate",source,"assignedUnitId") values ($1,$2,$3,'2028-02-10','2028-02-12','walk_in',$4)`, [seed.cuid("rb"), h.hotelId, h.roomId, u8]);
          const pD = cD.query(`insert into public.room_blocks (id,"hotelId","roomId","fromDate","toDate",source,"assignedUnitId") values ($1,$2,$3,'2028-02-11','2028-02-13','group',$4)`, [seed.cuid("rb"), h.hotelId, h.roomId, u8]).then(() => null, (e) => e);
          const w = await waitForLockWait(mon, pidD); eq(w.wait_event, "advisory");
          await cC.query("commit");
          const eD = await pD; truthy(eD); eq(eD.message, "unit_conflict");
        } finally { await cC.end(); await cD.end(); }
      } finally { await cA.end(); await cB.end(); }
      eq((await blocksOnUnit(c, u7)).length, 1); eq((await blocksOnUnit(c, u8)).length, 1);
      // non-overlapping nights on the same unit are fine
      await c.query(`insert into public.room_blocks (id,"hotelId","roomId","fromDate","toDate",source,"assignedUnitId") values ($1,$2,$3,'2028-01-12','2028-01-14','walk_in',$4)`, [seed.cuid("rb"), h.hotelId, h.roomId, u7]);
      eq((await blocksOnUnit(c, u7)).length, 2);
    });

    await t("K. M3 — line vs line race (two bids, same unit, overlapping) → exactly one ACTIVE line on the unit", async () => {
      const x = await seedBid(c, h, "ACCEPTED", "2028-03-10", "2028-03-13");
      const y = await seedBid(c, h, "ACCEPTED", "2028-03-12", "2028-03-14");
      const cA = await conn(dsn), cB = await conn(dsn);
      try {
        const [rA, rB] = await Promise.all([assign(cA, x, [u1]).then(() => "ok", (e) => e.message), assign(cB, y, [u1]).then(() => "ok", (e) => e.message)]);
        eq([rA, rB].filter((v) => v === "ok").length, 1); eq([rA, rB].filter((v) => v === "unit_conflict").length, 1);
      } finally { await cA.end(); await cB.end(); }
      const n = (await c.query(`select count(*)::int as n from public.bid_unit_assignment_lines where unit_id=$1 and status='active' and stay_from < '2028-03-14' and '2028-03-10' < stay_to`, [u1])).rows[0].n;
      eq(n, 1, "one active line on the unit for those nights");
    });

    await t("L. EXCLUDE backstop — two ACTIVE dated lines on the same unit + overlapping nights are refused by the constraint itself", async () => {
      const e = await fails(c.query(`insert into public.bid_unit_assignment_lines (id,bid_id,hotel_id,room_id,unit_id,unit_number,slot,status,stay_from,stay_to) values
        ('excl_t1','excl_b1',$1,$2,$3,'x',1,'active','2028-04-10','2028-04-12'), ('excl_t2','excl_b2',$1,$2,$3,'x',1,'active','2028-04-11','2028-04-13')`, [h.hotelId, h.roomId, u2]), "L");
      eq(e.code, "23P01", "exclusion_violation");
      eq((await c.query(`select count(*)::int as n from public.bid_unit_assignment_lines where id like 'excl_t%'`)).rows[0].n, 0, "statement rolled back");
    });

    // ── M2 — direct bids.assignedUnitId writers (non-owner role) ────────────
    await t("M. M2 — a NEW unit-level booking INSERTed with assignedUnitId by the non-owner writer is synced into lines + mirror at once", async () => {
      const req = seed.cuid("req"), bid = seed.cuid("bid");
      await asRole(c, "railway_writer", `insert into public.bid_requests (id,"checkIn","checkOut",guests) values ($1,'2028-05-10','2028-05-13',2)`, [req]);
      await asRole(c, "railway_writer", `insert into public.bids (id,"hotelId","roomId","customerId","requestId",status,amount,"numRooms","assignedUnitId") values ($1,$2,$3,'cust',$4,'ACCEPTED',1000,1,$5)`, [bid, h.hotelId, h.roomId, req, u3]);
      const l = await activeLines(c, bid); eq(l.length, 1); eq(l[0].unit_id, u3); eq(l[0].assigned_by, "lifecycle"); eq(l[0].reason, "synced from bids.assignedUnitId"); eq(String(l[0].stay_from).slice(0, 10), "2028-05-10");
      const m = await mirror(c, bid); eq(m && m.unitId, u3); eq(m.unitNumber, "103");
      eq(l[0].unit_number, "103", "unit number from the unit row (never a client value)");
      // (the writer role has NO privilege on the lines table itself)
      const e = await fails(asRole(c, "railway_writer", `select * from public.bid_unit_assignment_lines`), "M.priv"); eq(e.code, "42501");
    });

    await t("M2. M2 — a SECOND overlapping unit-level booking on that unit is REJECTED (bid row not created); the RPC also sees the direct booking", async () => {
      const req = seed.cuid("req"), bid = seed.cuid("bid");
      await asRole(c, "railway_writer", `insert into public.bid_requests (id,"checkIn","checkOut",guests) values ($1,'2028-05-12','2028-05-14',2)`, [req]);
      const e = await fails(asRole(c, "railway_writer", `insert into public.bids (id,"hotelId","roomId","customerId","requestId",status,amount,"numRooms","assignedUnitId") values ($1,$2,$3,'cust2',$4,'ACCEPTED',1000,1,$5)`, [bid, h.hotelId, h.roomId, req, u3]), "M2");
      eq(e.code, "P0001"); eq(e.message, "unit_conflict"); eq(e.detail, u3);
      eq((await c.query(`select count(*)::int as n from public.bids where id=$1`, [bid])).rows[0].n, 0, "bid row rolled back");
      eq((await allLines(c, bid)).length, 0);
      const viaRpc = await seedBid(c, h, "ACCEPTED", "2028-05-12", "2028-05-14");
      await refused(assign(c, viaRpc, [u3]), "unit_conflict", "M2.rpc");
      // non-overlapping direct booking on the same unit is fine
      const req2 = seed.cuid("req"), bid2 = seed.cuid("bid");
      await asRole(c, "railway_writer", `insert into public.bid_requests (id,"checkIn","checkOut",guests) values ($1,'2028-05-13','2028-05-15',2)`, [req2]);
      await asRole(c, "railway_writer", `insert into public.bids (id,"hotelId","roomId","customerId","requestId",status,amount,"numRooms","assignedUnitId") values ($1,$2,$3,'cust3',$4,'ACCEPTED',1000,1,$5)`, [bid2, h.hotelId, h.roomId, req2, u3]);
      eq((await activeLines(c, bid2)).length, 1);
    });

    await t("M3. M2 — lifecycle via direct UPDATE: CHECKED_OUT completes (unit freed), CANCELLED releases, cleared column releases + drops the mirror; PENDING→ACCEPTED ensures/refuses", async () => {
      const mk = async (from, to, status, unit) => {
        const req = seed.cuid("req"), bid = seed.cuid("bid");
        await asRole(c, "railway_writer", `insert into public.bid_requests (id,"checkIn","checkOut",guests) values ($1,$2,$3,2)`, [req, from, to]);
        await asRole(c, "railway_writer", `insert into public.bids (id,"hotelId","roomId","customerId","requestId",status,amount,"numRooms","assignedUnitId") values ($1,$2,$3,'c',$4,$5,1000,1,$6)`, [bid, h.hotelId, h.roomId, req, status, unit]);
        return bid;
      };
      const a = await mk("2028-06-10", "2028-06-13", "ACCEPTED", u4);
      await asRole(c, "railway_writer", `update public.bids set status='CHECKED_IN' where id=$1`, [a]); eq((await activeLines(c, a)).length, 1, "check-in keeps the line");
      await asRole(c, "railway_writer", `update public.bids set status='CHECKED_OUT' where id=$1`, [a]);
      eq((await allLines(c, a))[0].status, "completed"); eq((await activeLines(c, a)).length, 0);
      const a2 = await mk("2028-06-10", "2028-06-13", "ACCEPTED", u4); eq((await activeLines(c, a2)).length, 1, "freed unit bookable for the same nights");
      await asRole(c, "railway_writer", `update public.bids set status='CANCELLED' where id=$1`, [a2]); eq((await allLines(c, a2))[0].status, "released"); eq((await allLines(c, a2))[0].reason, "lifecycle: CANCELLED");
      const b = await mk("2028-06-20", "2028-06-22", "ACCEPTED", u5);
      await asRole(c, "railway_writer", `update public.bids set "assignedUnitId"=null where id=$1`, [b]);
      eq((await activeLines(c, b)).length, 0); eq((await allLines(c, b))[0].reason, "assignedUnitId cleared"); eq(await mirror(c, b), null);
      const holder = await mk("2028-07-10", "2028-07-12", "ACCEPTED", u6);
      const p = await mk("2028-07-11", "2028-07-13", "PENDING", u6); eq((await allLines(c, p)).length, 0, "PENDING occupies nothing");
      const e = await fails(asRole(c, "railway_writer", `update public.bids set status='ACCEPTED' where id=$1`, [p]), "M3.accept"); eq(e.message, "unit_conflict");
      eq((await bidUnit(c, p)).status, "PENDING", "acceptance onto an occupied unit is rejected (row unchanged)");
      await asRole(c, "railway_writer", `update public.bids set status='CHECKED_OUT' where id=$1`, [holder]);
      await asRole(c, "railway_writer", `update public.bids set status='ACCEPTED' where id=$1`, [p]); eq((await activeLines(c, p)).length, 1, "accepted once the unit is free → line ensured");
      // direct writer CHANGES the unit on a 1-room booking → old line superseded, new active
      await asRole(c, "railway_writer", `update public.bids set "assignedUnitId"=$2 where id=$1`, [p, u7]);
      const pl = await allLines(c, p); eq(pl.length, 2); eq(pl.find((x) => x.unit_id === u6).status, "superseded"); eq((await activeLines(c, p))[0].unit_id, u7); eq((await mirror(c, p)).unitId, u7);
      // direct writer stamps a foreign / wrong-category / inactive unit → refused
      for (const [unit, code] of [[h.foreign, "unit_wrong_hotel"], [h.otherCat, "unit_wrong_category"], [h.inactive, "unit_inactive"], ["ghost", "unit_not_found"]]) {
        const ee = await fails(asRole(c, "railway_writer", `update public.bids set "assignedUnitId"=$2 where id=$1`, [p, unit]), code); eq(ee.message, code);
      }
      eq((await bidUnit(c, p)).u, u7, "column unchanged after refused stamps");
      // INVARIANT: no occupying booking holds a unit solely in bids.assignedUnitId
      eq((await c.query(`select count(*)::int as n from public.bids b where upper(b.status) in ('ACCEPTED','CONFIRMED','CHECKED_IN') and b."assignedUnitId" is not null
        and not exists (select 1 from public.bid_unit_assignment_lines l where l.bid_id=b.id and l.unit_id=b."assignedUnitId" and l.status='active')`)).rows[0].n, 0, "invariant holds");
    });

    await t("N. M3 — room_blocks guard: wrong hotel / category / inactive / unknown refused; FORGED assignedUnitNumber replaced; PATCH onto an overlap refused; OTA pin stays conflict-visible", async () => {
      const ins = (unit, from, to, extra = "") => c.query(`insert into public.room_blocks (id,"hotelId","roomId","fromDate","toDate",source,"assignedUnitId"${extra ? ',"assignedUnitNumber"' : ""}) values ($1,$2,$3,$4,$5,'manual',$6${extra ? ",$7" : ""})`, [seed.cuid("rb"), h.hotelId, h.roomId, from, to, unit].concat(extra ? [extra] : []));
      for (const [unit, code] of [[h.foreign, "unit_wrong_hotel"], [h.otherCat, "unit_wrong_category"], [h.inactive, "unit_inactive"], ["ghost", "unit_not_found"]]) {
        const e = await fails(ins(unit, "2028-08-10", "2028-08-12"), code); eq(e.message, code);
      }
      await ins(u8, "2028-08-10", "2028-08-12", "FORGED");
      eq((await blocksOnUnit(c, u8)).filter((b) => String(b.fromDate).slice(0, 10) === "2028-08-10")[0].assignedUnitNumber, "108", "server-derived number, client value ignored");
      const free = (await c.query(`insert into public.room_blocks (id,"hotelId","roomId","fromDate","toDate",source,"assignedUnitId") values ($1,$2,$3,'2028-08-12','2028-08-14','walk_in',$4) returning id`, [seed.cuid("rb"), h.hotelId, h.roomId, u8])).rows[0].id;
      const e2 = await fails(c.query(`update public.room_blocks set "fromDate"='2028-08-11' where id=$1`, [free]), "N.patch"); eq(e2.message, "unit_conflict");
      eq(String((await c.query(`select "fromDate" from public.room_blocks where id=$1`, [free])).rows[0].fromDate).slice(0, 10), "2028-08-12", "refused PATCH left the block unchanged");
      // OTA feed import pinned to a unit → the bid RPC sees it; and a bid line blocks an OTA pin
      await c.query(`insert into public.room_blocks (id,"hotelId","roomId","fromDate","toDate",source,provider,"feedId","assignedUnitId") values ($1,$2,$3,'2028-09-10','2028-09-12','ota','airbnb','feed_1',$4)`, [seed.cuid("rb"), h.hotelId, h.roomId, u1]);
      const b = await seedBid(c, h, "ACCEPTED", "2028-09-11", "2028-09-13"); await refused(assign(c, b, [u1]), "unit_conflict", "N.ota_visible");
      const b2 = await seedBid(c, h, "ACCEPTED", "2028-10-10", "2028-10-12"); await assign(c, b2, [u1]);
      const e3 = await fails(c.query(`insert into public.room_blocks (id,"hotelId","roomId","fromDate","toDate",source,provider,"assignedUnitId") values ($1,$2,$3,'2028-10-11','2028-10-12','ota','booking',$4)`, [seed.cuid("rb"), h.hotelId, h.roomId, u1]), "N.ota_blocked"); eq(e3.message, "unit_conflict");
      // unpinned blocks are untouched by the guard
      await c.query(`insert into public.room_blocks (id,"hotelId","roomId","fromDate","toDate",source) values ($1,$2,$3,'2028-10-11','2028-10-12','manual')`, [seed.cuid("rb"), h.hotelId, h.roomId]);
      // the non-owner writer pinning a block goes through the same guard (definer trigger)
      const e4 = await fails(asRole(c, "railway_writer", `insert into public.room_blocks (id,"hotelId","roomId","fromDate","toDate",source,"assignedUnitId") values ($1,$2,$3,'2028-10-11','2028-10-12','walk_in',$4)`, [seed.cuid("rb"), h.hotelId, h.roomId, u1]), "N.writer"); eq(e4.message, "unit_conflict");
    });

    await t("O. block RPCs — stay_assign_block_unit pins atomically (number derived), conflict leaves the block unchanged, release clears", async () => {
      const blk = (await c.query(`insert into public.room_blocks (id,"hotelId","roomId","fromDate","toDate",source) values ($1,$2,$3,'2028-11-10','2028-11-12','walk_in') returning id`, [seed.cuid("rb"), h.hotelId, h.roomId])).rows[0].id;
      const out = (await c.query(`select public.stay_assign_block_unit($1,$2,'partner_test') as out`, [blk, u2])).rows[0].out; eq(out.ok, true); eq(out.unitNumber, "102");
      const other = await seedBid(c, h, "ACCEPTED", "2028-11-11", "2028-11-13"); await assign(c, other, [u3]);
      const e = await fails(c.query(`select public.stay_assign_block_unit($1,$2,'partner_test')`, [blk, u3]), "O.conflict"); eq(e.message, "unit_conflict");
      const row = (await c.query(`select "assignedUnitId" as u, "assignedUnitNumber" as n from public.room_blocks where id=$1`, [blk])).rows[0]; eq(row.u, u2); eq(row.n, "102");
      await refused(c.query(`select public.stay_assign_block_unit('nope',$1,'p')`, [u2]), "block_not_found", "O.nf");
      const rel = (await c.query(`select public.stay_release_block_unit($1,'partner_test') as out`, [blk])).rows[0].out; eq(rel.ok, true);
      const row2 = (await c.query(`select "assignedUnitId" as u, "assignedUnitNumber" as n from public.room_blocks where id=$1`, [blk])).rows[0]; eq(row2.u, null); eq(row2.n, null);
    });

    await c.query(`drop trigger if exists trg_test_fail_mirror on public.bid_unit_assignments; drop function if exists public.test_fail_mirror();`);
  } finally {
    try { if (mon) await mon.end(); } catch {}
    try { await c.end(); } catch {}
    harness.stop();
  }

  console.log(`\n• RESULT: ${passed} passed, ${failed} failed`);
  if (failures.length) {
    console.error("FAILURES:");
    for (const f of failures) console.error("  ✗ " + f.name + "\n      " + (f.err && f.err.stack ? f.err.stack.split("\n").slice(0, 3).join("\n      ") : f.err));
  }
  if (failed > 0) process.exitCode = 1; else { console.log("• ALL PASS"); process.exitCode = 0; }
}
main().catch((e) => { console.error("FATAL: " + (e && e.stack ? e.stack : e)); harness.stop(); process.exitCode = 2; });
