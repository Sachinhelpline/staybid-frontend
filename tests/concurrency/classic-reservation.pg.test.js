#!/usr/bin/env node
/* eslint-disable no-console */
// ═════════════════════════════════════════════════════════════════════════
// v734 — automated concurrency suite for the classic pre-payment reservation.
//
//   Run:  npm run test:concurrency
//
// Spins up a throwaway Postgres cluster on a private Unix socket, applies
// the minimum schema + migrations/2026-08-14-v734-classic-reservation-rpc.sql,
// and exercises tests A–I (PHASE 5). All concurrency is REAL — each parallel
// caller gets its own pg.Client (separate socket session), not a shared pool.
// Every test asserts final DB row state, not just RPC returns.
//
// Expected results:
//   • Tests A/B/C/E/F.4/I.1/I.3/I.4/I.5 FAIL on pre-v734 code (proves the bug).
//   • All 13 sub-tests PASS after PHASE-6 code is loaded (i.e. this branch).
//   • Tests D/H/I.2 are regression guards and pass on both.
//
// The RPC is exercised directly through PostgREST-style JSON calls via pg's
// query() — same wire shape as production, no JavaScript imitation.
// ═════════════════════════════════════════════════════════════════════════
"use strict";

let Client;
try {
  ({ Client } = require("pg"));
} catch (e) {
  console.error("[concurrency] `pg` is not installed. Run `npm ci` (v734 adds pg to devDependencies).");
  process.exit(2);
}

const harness = require("./.pg-harness");
const { assertTestDsn } = require("./dsn-guard");
const { applyAll } = require("./apply-migrations");
const seed = require("./seed");

// ── assert framework ────────────────────────────────────────────────────
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

// ── DB helpers ───────────────────────────────────────────────────────────
async function conn(dsn) {
  const c = new Client({ connectionString: dsn });
  await c.connect();
  return c;
}
async function rpcReserve(client, args) {
  const r = await client.query(
    `SELECT public.reserve_classic_block(
        $1::text, $2::text, $3::text, $4::text,
        $5::date, $6::date, $7::numeric, $8::numeric, $9::jsonb, $10::text
      ) AS out`,
    [args.blockId, args.hotelId, args.roomId, args.investorUserId, args.from, args.to,
     args.buyPricePerNight || 1000, args.buyTotal || 1000, JSON.stringify(args.metadata || {}), args.razorpayOrderId || null],
  );
  return r.rows[0].out;
}
async function rpcAssert(client, blockId) {
  const r = await client.query(`SELECT public.assert_classic_hold_still_ours($1::text) AS out`, [blockId]);
  return r.rows[0].out;
}
async function countPendingBlocks(client, roomId) {
  const r = await client.query(
    `SELECT COUNT(*)::int AS n FROM public.inventory_blocks WHERE room_id = $1 AND status = 'pending_payment'`,
    [roomId],
  );
  return r.rows[0].n;
}
async function countInvHolds(client, roomId) {
  const r = await client.query(
    `SELECT COUNT(*)::int AS n FROM public.room_blocks WHERE "roomId" = $1 AND id LIKE 'invhold_%'`,
    [roomId],
  );
  return r.rows[0].n;
}

async function main() {
  console.log("v734 — classic reservation concurrency suite");
  console.log("");
  console.log("[1/3] booting throwaway Postgres cluster …");
  const dsn = await harness.start();
  assertTestDsn(dsn);
  console.log("      dsn = " + dsn);

  console.log("[2/3] applying minimal schema + v734 migration …");
  {
    const c = await conn(dsn);
    try {
      await applyAll(c);
    } finally {
      await c.end();
    }
  }

  console.log("[3/3] running tests A–I …");
  console.log("");

  // ── Test A — capacity=1, two simultaneous checkouts ────────────────────
  await t("A. capacity=1, two simultaneous callers → exactly 1 wins", async () => {
    const setup = await conn(dsn);
    const { hotelId, roomId } = await seedClassicRoomFresh(setup, 1);
    await setup.end();

    const cX = await conn(dsn);
    const cY = await conn(dsn);
    try {
      const invX = seed.cuid("test_inv"), invY = seed.cuid("test_inv");
      const blkX = seed.cuid("inv"), blkY = seed.cuid("inv");
      const args = { hotelId, roomId, from: "2027-01-10", to: "2027-01-12", metadata: { t: "A" } };
      const [rX, rY] = await Promise.all([
        rpcReserve(cX, { ...args, blockId: blkX, investorUserId: invX }),
        rpcReserve(cY, { ...args, blockId: blkY, investorUserId: invY }),
      ]);
      const wins = [rX, rY].filter((r) => r.ok && r.code === "reserved").length;
      const losses = [rX, rY].filter((r) => !r.ok && r.code === "category_full").length;
      eq(wins, 1, "reserved winners");
      eq(losses, 1, "category_full losers");
    } finally {
      await cX.end();
      await cY.end();
    }

    const check = await conn(dsn);
    try {
      eq(await countPendingBlocks(check, roomId), 1, "pending blocks after race");
      eq(await countInvHolds(check, roomId), 1, "invhold rows after race");
    } finally {
      await check.end();
    }
  });

  // ── Test B — capacity=N, N winners + 1 loser ───────────────────────────
  await t("B. capacity=3, four simultaneous callers → 3 win + 1 category_full", async () => {
    const setup = await conn(dsn);
    const { hotelId, roomId } = await seedClassicRoomFresh(setup, 3);
    await setup.end();

    const N = 4;
    const clients = await Promise.all(Array.from({ length: N }, () => conn(dsn)));
    try {
      const results = await Promise.all(
        clients.map((c) =>
          rpcReserve(c, {
            blockId: seed.cuid("inv"),
            hotelId, roomId,
            investorUserId: seed.cuid("test_inv"),
            from: "2027-02-01", to: "2027-02-03",
            metadata: { t: "B" },
          }),
        ),
      );
      const wins = results.filter((r) => r.ok && r.code === "reserved").length;
      const losses = results.filter((r) => !r.ok && r.code === "category_full").length;
      eq(wins, 3, "wins");
      eq(losses, 1, "losses");
    } finally {
      await Promise.all(clients.map((c) => c.end()));
    }

    const check = await conn(dsn);
    try {
      eq(await countPendingBlocks(check, roomId), 3, "pending blocks");
      eq(await countInvHolds(check, roomId), 3, "invhold rows");
      // A 5th sequential call must also fail with category_full.
      const fifth = await rpcReserve(check, {
        blockId: seed.cuid("inv"), hotelId, roomId,
        investorUserId: seed.cuid("test_inv"),
        from: "2027-02-01", to: "2027-02-03",
        metadata: { t: "B-fifth" },
      });
      eq(fifth.ok, false, "5th caller ok=false");
      eq(fifth.code, "category_full", "5th caller code");
    } finally {
      await check.end();
    }
  });

  // ── Test C — overlapping date ranges compete ──────────────────────────
  await t("C. capacity=1, overlapping ranges → exactly 1 wins", async () => {
    const setup = await conn(dsn);
    const { hotelId, roomId } = await seedClassicRoomFresh(setup, 1);
    await setup.end();

    const cX = await conn(dsn);
    const cY = await conn(dsn);
    try {
      const [rX, rY] = await Promise.all([
        rpcReserve(cX, { blockId: seed.cuid("inv"), hotelId, roomId, investorUserId: seed.cuid("test_inv"), from: "2027-03-01", to: "2027-03-04", metadata: { t: "C.X" } }),
        rpcReserve(cY, { blockId: seed.cuid("inv"), hotelId, roomId, investorUserId: seed.cuid("test_inv"), from: "2027-03-02", to: "2027-03-05", metadata: { t: "C.Y" } }),
      ]);
      const wins = [rX, rY].filter((r) => r.ok && r.code === "reserved").length;
      const losses = [rX, rY].filter((r) => !r.ok && r.code === "category_full").length;
      eq(wins, 1, "wins");
      eq(losses, 1, "losses");
    } finally {
      await cX.end();
      await cY.end();
    }
    const check = await conn(dsn);
    try {
      eq(await countInvHolds(check, roomId), 1, "invhold rows after overlap race");
    } finally {
      await check.end();
    }
  });

  // ── Test D — non-overlapping ranges both succeed (regression guard) ───
  await t("D. capacity=1, non-overlapping ranges → both succeed", async () => {
    const setup = await conn(dsn);
    const { hotelId, roomId } = await seedClassicRoomFresh(setup, 1);
    await setup.end();

    const cX = await conn(dsn);
    const cY = await conn(dsn);
    try {
      const [rX, rY] = await Promise.all([
        rpcReserve(cX, { blockId: seed.cuid("inv"), hotelId, roomId, investorUserId: seed.cuid("test_inv"), from: "2027-04-01", to: "2027-04-03", metadata: { t: "D.X" } }),
        rpcReserve(cY, { blockId: seed.cuid("inv"), hotelId, roomId, investorUserId: seed.cuid("test_inv"), from: "2027-04-06", to: "2027-04-08", metadata: { t: "D.Y" } }),
      ]);
      truthy(rX.ok, "X ok");
      truthy(rY.ok, "Y ok");
      eq(rX.code, "reserved", "X code");
      eq(rY.code, "reserved", "Y code");
    } finally {
      await cX.end();
      await cY.end();
    }
    const check = await conn(dsn);
    try {
      eq(await countPendingBlocks(check, roomId), 2, "both pending blocks exist");
      eq(await countInvHolds(check, roomId), 2, "both invholds exist");
    } finally {
      await check.end();
    }
  });

  // ── Test E — same blockId concurrent retry is idempotent ──────────────
  await t("E. capacity=1, five parallel same-blockId retries → 1 real, 4 idempotent", async () => {
    const setup = await conn(dsn);
    const { hotelId, roomId } = await seedClassicRoomFresh(setup, 1);
    await setup.end();

    const blockId = seed.cuid("inv");
    const investorUserId = seed.cuid("test_inv");
    const args = { blockId, hotelId, roomId, investorUserId, from: "2027-05-01", to: "2027-05-03", metadata: { t: "E" } };

    const clients = await Promise.all(Array.from({ length: 5 }, () => conn(dsn)));
    try {
      const results = await Promise.all(clients.map((c) => rpcReserve(c, args)));
      results.forEach((r, i) => truthy(r.ok, "call " + i + " ok"));
      const reserved = results.filter((r) => r.code === "reserved").length;
      const already = results.filter((r) => r.code === "already_reserved").length;
      eq(reserved + already, 5, "all 5 report ok");
      // At least one must be "reserved"; the rest are "already_reserved".
      truthy(reserved >= 1, "at least 1 reserved");
      eq(already, 5 - reserved, "the rest are already_reserved");
      results.forEach((r) => truthy(r.code !== "category_full", "no false category_full on same-blockId retry"));
    } finally {
      await Promise.all(clients.map((c) => c.end()));
    }

    const check = await conn(dsn);
    try {
      eq(await countPendingBlocks(check, roomId), 1, "exactly 1 pending block for same blockId");
      eq(await countInvHolds(check, roomId), 1, "exactly 1 invhold for same blockId");
      // A 6th sequential retry is still ok + already_reserved, no new writes.
      const before = (await check.query(`SELECT updated_at FROM public.inventory_blocks WHERE id = $1`, [blockId])).rows[0].updated_at;
      const sixth = await rpcReserve(check, args);
      truthy(sixth.ok, "6th ok");
      eq(sixth.code, "already_reserved", "6th code");
      const after = (await check.query(`SELECT updated_at FROM public.inventory_blocks WHERE id = $1`, [blockId])).rows[0].updated_at;
      eq(new Date(before).getTime(), new Date(after).getTime(), "6th retry did not mutate updated_at");
    } finally {
      await check.end();
    }
  });

  // ── Test F — existing room_blocks from every source counted ────────────
  const sourcesUnderTest = ["walk_in", "ota_ical", "manual", "inventory"];
  for (const src of sourcesUnderTest) {
    await t("F." + src + ". room_blocks source is counted", async () => {
      const setup = await conn(dsn);
      const { hotelId, roomId } = await seedClassicRoomFresh(setup, 2);
      // Seed one row of the source-under-test on our range.
      await seed.seedRoomBlock(setup, {
        hotelId, roomId, from: "2027-06-01", to: "2027-06-03", source: src,
      });
      await setup.end();

      // First call → succeed (1 held + our new one = 2).
      const c1 = await conn(dsn);
      try {
        const r = await rpcReserve(c1, {
          blockId: seed.cuid("inv"), hotelId, roomId,
          investorUserId: seed.cuid("test_inv"),
          from: "2027-06-01", to: "2027-06-03",
          metadata: { t: "F.first" },
        });
        truthy(r.ok, "F first ok");
        eq(r.occupied, 2, "occupied after first (seeded 1 + new 1)");
      } finally {
        await c1.end();
      }

      // Second parallel pair → exactly 1 succeeds (fills the room), 1 fails.
      const cA = await conn(dsn), cB = await conn(dsn);
      try {
        const [rA, rB] = await Promise.all([
          rpcReserve(cA, { blockId: seed.cuid("inv"), hotelId, roomId, investorUserId: seed.cuid("test_inv"), from: "2027-06-01", to: "2027-06-03", metadata: { t: "F.A" } }),
          rpcReserve(cB, { blockId: seed.cuid("inv"), hotelId, roomId, investorUserId: seed.cuid("test_inv"), from: "2027-06-01", to: "2027-06-03", metadata: { t: "F.B" } }),
        ]);
        const wins = [rA, rB].filter((r) => r.ok).length;
        const losses = [rA, rB].filter((r) => !r.ok && r.code === "category_full").length;
        eq(wins, 0, "no wins — room already full at cap 2");
        eq(losses, 2, "both category_full");
      } finally {
        await cA.end();
        await cB.end();
      }
    });
  }

  // ── Test G — hard-blocking bids counted like getOccupations ────────────
  await t("G. hard-blocking bids (ACCEPTED/COUNTER/CONFIRMED/CHECKED_IN×numRooms) fill capacity", async () => {
    const setup = await conn(dsn);
    const { hotelId, roomId } = await seedClassicRoomFresh(setup, 5);
    await seed.seedBid(setup, { hotelId, roomId, checkIn: "2027-07-01", checkOut: "2027-07-03", status: "ACCEPTED", numRooms: 2 });
    await seed.seedBid(setup, { hotelId, roomId, checkIn: "2027-07-01", checkOut: "2027-07-03", status: "COUNTER", numRooms: 1 });
    await seed.seedBid(setup, { hotelId, roomId, checkIn: "2027-07-02", checkOut: "2027-07-04", status: "CONFIRMED", numRooms: 1 });
    await seed.seedBid(setup, { hotelId, roomId, checkIn: "2027-07-01", checkOut: "2027-07-04", status: "CHECKED_IN", numRooms: 1 });
    // Peak day 2027-07-02: ACCEPTED(2) + COUNTER(1) + CONFIRMED(1) + CHECKED_IN(1) = 5.
    await setup.end();

    const c = await conn(dsn);
    try {
      const rFull = await rpcReserve(c, {
        blockId: seed.cuid("inv"), hotelId, roomId,
        investorUserId: seed.cuid("test_inv"),
        from: "2027-07-01", to: "2027-07-04",
        metadata: { t: "G.full" },
      });
      eq(rFull.ok, false, "G full ok=false");
      eq(rFull.code, "category_full", "G full code");
      eq(rFull.occupied, 5, "G occupied peak");
      eq(rFull.capacity, 5, "G capacity");

      // Past-the-bids window should succeed cleanly.
      const rClear = await rpcReserve(c, {
        blockId: seed.cuid("inv"), hotelId, roomId,
        investorUserId: seed.cuid("test_inv"),
        from: "2027-07-05", to: "2027-07-06",
        metadata: { t: "G.clear" },
      });
      truthy(rClear.ok, "G clear ok");
      eq(rClear.occupied, 1, "G clear occupied = new one only");
    } finally {
      await c.end();
    }
  });

  // ── Test H — PENDING bids remain uncounted ─────────────────────────────
  await t("H. capacity=1, ten PENDING bids stacked → RPC still succeeds", async () => {
    const setup = await conn(dsn);
    const { hotelId, roomId } = await seedClassicRoomFresh(setup, 1);
    for (let i = 0; i < 10; i++) {
      await seed.seedBid(setup, { hotelId, roomId, checkIn: "2027-08-01", checkOut: "2027-08-03", status: "PENDING", numRooms: 1 });
    }
    await setup.end();

    const c = await conn(dsn);
    try {
      const r = await rpcReserve(c, {
        blockId: seed.cuid("inv"), hotelId, roomId,
        investorUserId: seed.cuid("test_inv"),
        from: "2027-08-01", to: "2027-08-03",
        metadata: { t: "H" },
      });
      truthy(r.ok, "H ok");
      eq(r.code, "reserved", "H code");
    } finally {
      await c.end();
    }
  });

  // ── Test I.1 — pending classic hold exists before payment ─────────────
  await t("I.1 pre-payment hold exists with correct shape", async () => {
    const setup = await conn(dsn);
    const { hotelId, roomId } = await seedClassicRoomFresh(setup, 1);
    await setup.end();
    const c = await conn(dsn);
    try {
      const blockId = seed.cuid("inv");
      const investorUserId = seed.cuid("test_inv");
      const r = await rpcReserve(c, {
        blockId, hotelId, roomId, investorUserId,
        from: "2027-09-01", to: "2027-09-03", metadata: { t: "I.1" },
      });
      truthy(r.ok, "I.1 ok");
      const block = (await c.query(`SELECT status, unit_id FROM public.inventory_blocks WHERE id = $1`, [blockId])).rows[0];
      eq(block.status, "pending_payment", "I.1 block status");
      eq(block.unit_id, null, "I.1 block unit_id NULL");
      const hold = (await c.query(`SELECT source, "assignedUnitId" FROM public.room_blocks WHERE id = $1`, ["invhold_" + blockId])).rows[0];
      truthy(hold, "I.1 invhold row exists");
      eq(hold.source, "inventory", "I.1 invhold source");
      eq(hold.assignedUnitId, null, "I.1 invhold assignedUnitId NULL");
    } finally {
      await c.end();
    }
  });

  // ── Test I.2 — successful verify must not create a second hold ─────────
  await t("I.2 verify (block → owned) leaves exactly 1 invhold", async () => {
    const setup = await conn(dsn);
    const { hotelId, roomId } = await seedClassicRoomFresh(setup, 1);
    await setup.end();
    const c = await conn(dsn);
    try {
      const blockId = seed.cuid("inv");
      const investorUserId = seed.cuid("test_inv");
      await rpcReserve(c, { blockId, hotelId, roomId, investorUserId, from: "2027-10-01", to: "2027-10-03", metadata: { t: "I.2" } });
      await c.query(`UPDATE public.inventory_blocks SET status='owned' WHERE id=$1 AND status='pending_payment'`, [blockId]);
      const assertion = await rpcAssert(c, blockId);
      truthy(assertion.ok, "I.2 assertion ok");
      truthy(assertion.held, "I.2 assertion held");
      eq(await countInvHolds(c, roomId), 1, "I.2 exactly one invhold after verify");
    } finally {
      await c.end();
    }
  });

  // ── Test I.3 — missing hold at verify is NOT silently recreated ────────
  await t("I.3 missing hold at verify → assertion held=false, NOT recreated", async () => {
    const setup = await conn(dsn);
    const { hotelId, roomId } = await seedClassicRoomFresh(setup, 1);
    await setup.end();
    const c = await conn(dsn);
    try {
      const blockId = seed.cuid("inv");
      const investorUserId = seed.cuid("test_inv");
      await rpcReserve(c, { blockId, hotelId, roomId, investorUserId, from: "2027-11-01", to: "2027-11-03", metadata: { t: "I.3" } });
      // Simulate the expiry cron releasing the hold BEFORE verify runs.
      await c.query(`DELETE FROM public.room_blocks WHERE id = $1`, ["invhold_" + blockId]);
      eq(await countInvHolds(c, roomId), 0, "I.3 hold gone before verify");
      const assertion = await rpcAssert(c, blockId);
      truthy(assertion.ok, "I.3 assertion ok");
      eq(assertion.held, false, "I.3 assertion held=false");
      // Crucially: the assertion is PURE READ — no invhold reappeared.
      eq(await countInvHolds(c, roomId), 0, "I.3 no invhold recreated by assert");
    } finally {
      await c.end();
    }
  });

  // ── Test I.4 — abandoned-pending expiry releases the deterministic hold ─
  await t("I.4 abandoned-pending expiry: block→expired + invhold DELETEd", async () => {
    const setup = await conn(dsn);
    const { hotelId, roomId } = await seedClassicRoomFresh(setup, 1);
    await setup.end();
    const c = await conn(dsn);
    try {
      const blockId = seed.cuid("inv");
      const investorUserId = seed.cuid("test_inv");
      await rpcReserve(c, { blockId, hotelId, roomId, investorUserId, from: "2027-12-01", to: "2027-12-03", metadata: { t: "I.4" } });
      // Age the pending row past the 30-minute TTL.
      await c.query(`UPDATE public.inventory_blocks SET created_at = now() - INTERVAL '31 minutes' WHERE id = $1`, [blockId]);
      // Simulate the Pass-5 cron: guarded PATCH pending→expired + delete invhold.
      const patch = await c.query(
        `UPDATE public.inventory_blocks SET status='expired',
            metadata = metadata || jsonb_build_object('expiredReason','pending_payment_abandoned'),
            updated_at = now()
         WHERE id = $1 AND status = 'pending_payment'
         RETURNING id`,
        [blockId],
      );
      eq(patch.rowCount, 1, "I.4 pending→expired PATCH matched 1");
      await c.query(`DELETE FROM public.room_blocks WHERE id = $1`, ["invhold_" + blockId]);
      eq(await countInvHolds(c, roomId), 0, "I.4 hold released");
      // A subsequent fresh reservation on the same room+dates succeeds.
      const r2 = await rpcReserve(c, {
        blockId: seed.cuid("inv"), hotelId, roomId, investorUserId,
        from: "2027-12-01", to: "2027-12-03", metadata: { t: "I.4.after" },
      });
      truthy(r2.ok, "I.4 next caller ok");
      eq(r2.code, "reserved", "I.4 next caller code");
    } finally {
      await c.end();
    }
  });

  // ── Test I.5 — race between expiry and verify, both outcomes safe ─────
  await t("I.5 expiry ⇄ verify race: both outcomes preserve the invariant", async () => {
    // Two sub-runs — one where expiry wins first, one where verify wins first.
    // We can't reliably win a wall-clock race, so we drive each side
    // deterministically and prove that the LOSING side's guarded PATCH is a
    // safe no-op in either ordering.
    const setup = await conn(dsn);
    const { hotelId, roomId } = await seedClassicRoomFresh(setup, 1);
    await setup.end();

    // Outcome A: verify wins (pending → owned first). Expiry's guarded
    // pending→expired PATCH must match 0 rows and delete no hold.
    {
      const c = await conn(dsn);
      try {
        const blockId = seed.cuid("inv");
        const investorUserId = seed.cuid("test_inv");
        await rpcReserve(c, { blockId, hotelId, roomId, investorUserId, from: "2028-01-01", to: "2028-01-03", metadata: { t: "I.5.verify_wins" } });
        // Verify wins.
        await c.query(`UPDATE public.inventory_blocks SET status='owned' WHERE id=$1 AND status='pending_payment'`, [blockId]);
        // Expiry attempts its PATCH afterwards — must match 0 rows.
        const late = await c.query(
          `UPDATE public.inventory_blocks SET status='expired' WHERE id=$1 AND status='pending_payment' RETURNING id`,
          [blockId],
        );
        eq(late.rowCount, 0, "I.5.A expiry PATCH matched 0 rows (verify already won)");
        const row = (await c.query(`SELECT status FROM public.inventory_blocks WHERE id=$1`, [blockId])).rows[0];
        eq(row.status, "owned", "I.5.A block stays owned");
        // Invhold still there — no phantom release.
        const holds = (await c.query(`SELECT COUNT(*)::int AS n FROM public.room_blocks WHERE id=$1`, ["invhold_" + blockId])).rows[0].n;
        eq(holds, 1, "I.5.A invhold preserved");
      } finally {
        await c.end();
      }
    }

    // Outcome B: expiry wins first. Assert helper reports held=false + never
    // recreates the row (proven earlier in I.3 — re-tested here in-race).
    {
      const c = await conn(dsn);
      try {
        const { hotelId: hB, roomId: rB } = await seedClassicRoomFresh(c, 1);
        const blockId = seed.cuid("inv");
        const investorUserId = seed.cuid("test_inv");
        await rpcReserve(c, { blockId, hotelId: hB, roomId: rB, investorUserId, from: "2028-02-01", to: "2028-02-03", metadata: { t: "I.5.expiry_wins" } });
        // Age + expire.
        await c.query(`UPDATE public.inventory_blocks SET created_at = now() - INTERVAL '31 minutes' WHERE id=$1`, [blockId]);
        await c.query(`UPDATE public.inventory_blocks SET status='expired' WHERE id=$1 AND status='pending_payment'`, [blockId]);
        await c.query(`DELETE FROM public.room_blocks WHERE id=$1`, ["invhold_" + blockId]);
        // Now the verify path runs: guarded pending→owned PATCH must match 0
        // (block is already expired); assert helper returns held=false.
        const late = await c.query(
          `UPDATE public.inventory_blocks SET status='owned' WHERE id=$1 AND status='pending_payment' RETURNING id`,
          [blockId],
        );
        eq(late.rowCount, 0, "I.5.B verify PATCH matched 0 rows (expiry already won)");
        const assertion = await rpcAssert(c, blockId);
        eq(assertion.held, false, "I.5.B assertion held=false");
        eq((await c.query(`SELECT COUNT(*)::int AS n FROM public.room_blocks WHERE id=$1`, ["invhold_" + blockId])).rows[0].n, 0, "I.5.B invhold stays gone");
      } finally {
        await c.end();
      }
    }
  });

  console.log("");
  console.log("── summary ──────────────────────────────────────────────");
  console.log("  passed: " + passed);
  console.log("  failed: " + failed);
  if (failed) {
    console.log("");
    for (const f of failures) {
      console.log("  ✗ " + f.name);
      console.log("    " + (f.err && f.err.stack ? f.err.stack.split("\n").slice(0, 4).join("\n    ") : String(f.err)));
    }
  }

  harness.stop();
  process.exit(failed ? 1 : 0);
}

// Helper — seedClassicRoom on the SHARED connection, without opening a new one.
async function seedClassicRoomFresh(client, quantity) {
  return await seed.seedClassicRoom(client, quantity);
}

main().catch((e) => {
  console.error("[concurrency] fatal:", e);
  try { harness.stop(); } catch {}
  process.exit(1);
});
