import { NextRequest, NextResponse } from "next/server";
import { authUserId, sbSelect, sbInsert, genId } from "@/lib/sb-server";

export async function POST(req: NextRequest) {
  const customerId = authUserId(req);
  if (!customerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { hotelId, roomId, amount, checkIn, checkOut, guests } = body || {};
  if (!hotelId || !checkIn || !checkOut) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  // Resolve city from hotel
  const hotels = await sbSelect(`hotels?id=eq.${hotelId}&select=city`);
  const city = hotels[0]?.city || "Unknown";

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
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    });
    return NextResponse.json({ request });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Request failed" }, { status: 500 });
  }
}
