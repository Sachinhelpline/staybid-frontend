// ═════════════════════════════════════════════════════════════════════════
// v734 — per-test seed helpers. Each test gets fresh CUIDs so parallel tests
// never collide, and a `wipeTestRoom(client, roomId)` for red-green iteration.
// ═════════════════════════════════════════════════════════════════════════
"use strict";
const crypto = require("crypto");

function cuid(prefix) {
  return prefix + "_" + crypto.randomBytes(12).toString("hex");
}

/**
 * Seed a fresh CLASSIC room:
 *   • rooms row with the requested quantity
 *   • NO hotel_room_units rows (defines "classic" per assign.ts)
 */
async function seedClassicRoom(client, quantity) {
  const hotelId = cuid("test_hotel");
  const roomId = cuid("test_room");
  await client.query(
    `INSERT INTO public.rooms (id, "hotelId", quantity) VALUES ($1, $2, $3)`,
    [roomId, hotelId, quantity],
  );
  return { hotelId, roomId };
}

/**
 * Seed a fresh UNIT room (rooms.quantity IGNORED by unitsFreeForRange when
 * hotel_room_units has active rows). Used only for the classic-guard test.
 */
async function seedUnitRoom(client, unitCount) {
  const hotelId = cuid("test_hotel");
  const roomId = cuid("test_room");
  await client.query(
    `INSERT INTO public.rooms (id, "hotelId", quantity) VALUES ($1, $2, $3)`,
    [roomId, hotelId, unitCount],
  );
  for (let i = 0; i < unitCount; i++) {
    const unitId = cuid("test_unit");
    await client.query(
      `INSERT INTO public.hotel_room_units (id, "hotelId", "roomId", "roomNumber", status)
       VALUES ($1, $2, $3, $4, 'active')`,
      [unitId, hotelId, roomId, String(101 + i)],
    );
  }
  return { hotelId, roomId };
}

async function seedRoomBlock(client, opts) {
  const id = opts.id || cuid("rb");
  await client.query(
    `INSERT INTO public.room_blocks
       (id, "hotelId", "roomId", "fromDate", "toDate", source, note, "createdBy", "assignedUnitId")
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [id, opts.hotelId, opts.roomId, opts.from, opts.to, opts.source, opts.note || null, opts.createdBy || null, opts.assignedUnitId || null],
  );
  return id;
}

async function seedBid(client, opts) {
  const requestId = cuid("req");
  await client.query(
    `INSERT INTO public.bid_requests (id, "checkIn", "checkOut", guests) VALUES ($1, $2, $3, $4)`,
    [requestId, opts.checkIn, opts.checkOut, opts.guests || 2],
  );
  const bidId = cuid("bid");
  await client.query(
    `INSERT INTO public.bids (id, "hotelId", "roomId", "customerId", "requestId", status, amount, "numRooms")
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [bidId, opts.hotelId, opts.roomId, opts.customerId || cuid("cust"), requestId, opts.status, opts.amount || 1000, opts.numRooms || 1],
  );
  return { bidId, requestId };
}

/**
 * Wipe all rows keyed off a test room. Only used by red-green iteration; the
 * whole cluster is torn down at end-of-run so this isn't required for isolation.
 */
async function wipeTestRoom(client, roomId) {
  await client.query(`DELETE FROM public.room_blocks WHERE "roomId" = $1`, [roomId]);
  await client.query(`DELETE FROM public.inventory_blocks WHERE room_id = $1`, [roomId]);
  await client.query(`DELETE FROM public.bids WHERE "roomId" = $1`, [roomId]);
  await client.query(`DELETE FROM public.hotel_room_units WHERE "roomId" = $1`, [roomId]);
  await client.query(`DELETE FROM public.rooms WHERE id = $1`, [roomId]);
}

module.exports = { cuid, seedClassicRoom, seedUnitRoom, seedRoomBlock, seedBid, wipeTestRoom };
