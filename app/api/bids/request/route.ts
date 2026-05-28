import { NextRequest, NextResponse } from "next/server";
import { authUserId, authPayload, ensureUser, sbSelect, sbInsert, genId } from "@/lib/sb-server";

export async function POST(req: NextRequest) {
  const customerId = authUserId(req);
  if (!customerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const p = authPayload(req);
  await ensureUser(customerId, p?.phone, p?.name);

  const body = await req.json().catch(() => ({}));
  const { hotelId, roomId, amount, checkIn, checkOut, guests, source, numRooms } = body || {};
  if (!hotelId || !checkIn || !checkOut) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  // Resolve city from hotel
  const hotels = await sbSelect(`hotels?id=eq.${hotelId}&select=city`);
  const city = hotels[0]?.city || "Unknown";

  // v240 — Stamp the originating flow at request-creation time. Schema
  // CHECK constraint enforces the enum; default in DB is 'negotiate', so
  // callers that don't pass `source` (legacy hotel-page paths) keep
  // working byte-identical. This is the future-proof anchor: /my-bids
  // detection now reads b.request.source server-authoritatively instead
  // of pattern-matching `b.message` (v234 era), which broke whenever
  // Railway / a future API path stripped the message.
  const allowedSources = new Set(["place", "negotiate", "direct", "flash"]);
  const requestSource = allowedSources.has(String(source)) ? source : "negotiate";

  // v241 — Customer's room-count pick, frozen at request creation.
  // Schema CHECK enforces 1–10. Defaults to 1 when caller omits the
  // field (legacy callers + single-room flows like Book Now / Flash).
  // Per-bid `bids.numRooms` may differ when /api/bids/place resolves
  // against hotel-specific room.capacity, but the customer's intent
  // is frozen here for audit + multi-hotel broadcast consistency.
  const numRoomsRequested = Math.max(1, Math.min(10, Math.floor(Number(numRooms) || 1)));

  try {
    const request = await sbInsert("bid_requests", {
      id: genId("req"),
      customerId,
      city,
      checkIn: new Date(checkIn).toISOString(),
      checkOut: new Date(checkOut).toISOString(),
      guests: Number(guests) || 2,
      maxBudget: Number(amount) || 0,
      status: "OPEN",
      source: requestSource,
      numRoomsRequested,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    });
    return NextResponse.json({ request });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Request failed" }, { status: 500 });
  }
}
