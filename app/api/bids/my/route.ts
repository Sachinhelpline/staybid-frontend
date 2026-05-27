import { NextRequest, NextResponse } from "next/server";
import { authPayload, sbSelect, resolveUserIds } from "@/lib/sb-server";

export async function GET(req: NextRequest) {
  const payload = authPayload(req);
  const primaryId = payload?.id || payload?.user_id || payload?.sub;
  if (!primaryId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // v240 — Union ALL user IDs sharing the same human (phone variants +
  // email). Pre-v240 this matched only on phone, so a customer who placed
  // bids via Google Firebase (customerId=`Ld6xDB42…`, phone placeholder
  // `unknown_<uid>`) and then opened /my-bids via Phone OTP
  // (`cmnr4b8ol…`) saw an empty Place Bid section because the resolver
  // never linked the two identities. Cross-identity is the future-proof
  // anchor; replaces the v234 message-regex Place Bid detection.
  const customerIds = await resolveUserIds(primaryId, payload?.phone, payload?.email);
  const bids = await sbSelect(`bids?customerId=in.(${customerIds.join(",")})&select=*`);
  if (!bids.length) return NextResponse.json({ bids: [] });

  // Collect unique IDs
  const hotelIds   = Array.from(new Set(bids.map((b: any) => b.hotelId).filter(Boolean)));
  const roomIds    = Array.from(new Set(bids.map((b: any) => b.roomId).filter(Boolean)));
  const requestIds = Array.from(new Set(bids.map((b: any) => b.requestId).filter(Boolean)));

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
