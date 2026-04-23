import { NextRequest, NextResponse } from "next/server";
import { authUserId, sbSelect } from "@/lib/sb-server";

export async function GET(req: NextRequest) {
  const customerId = authUserId(req);
  if (!customerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const bids = await sbSelect(`bids?customerId=eq.${customerId}&select=*`);
  if (!bids.length) return NextResponse.json({ bids: [] });

  // Collect unique IDs
  const hotelIds   = [...new Set(bids.map((b: any) => b.hotelId).filter(Boolean))];
  const roomIds    = [...new Set(bids.map((b: any) => b.roomId).filter(Boolean))];
  const requestIds = [...new Set(bids.map((b: any) => b.requestId).filter(Boolean))];

  const [hotels, rooms, requests] = await Promise.all([
    hotelIds.length   ? sbSelect(`hotels?id=in.(${hotelIds.join(",")})&select=*`)     : Promise.resolve([]),
    roomIds.length    ? sbSelect(`rooms?id=in.(${roomIds.join(",")})&select=*`)       : Promise.resolve([]),
    requestIds.length ? sbSelect(`bid_requests?id=in.(${requestIds.join(",")})&select=*`) : Promise.resolve([]),
  ]);

  const enriched = bids.map((b: any) => ({
    ...b,
    hotel:   hotels.find((h: any) => h.id === b.hotelId)    || null,
    room:    rooms.find((r: any) => r.id === b.roomId)      || null,
    request: requests.find((r: any) => r.id === b.requestId) || null,
  }));

  // Newest first
  enriched.sort((a: any, b: any) =>
    new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
  );

  return NextResponse.json({ bids: enriched });
}
