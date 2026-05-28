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
  // v241.18 — encodeURIComponent each ID so IDs with special chars
  // (rare but possible: fb_ prefix combined with weird Firebase UIDs)
  // don't break the PostgREST in.() filter and silently return [].
  const customerIds = await resolveUserIds(primaryId, payload?.phone, payload?.email);
  const bids = await sbSelect(
    `bids?customerId=in.(${customerIds.map(encodeURIComponent).join(",")})&select=*`
  );

  // v241.18 — Diagnostic block returned alongside bids. Surfaces the
  // exact auth state + raw bid count so the /my-bids empty-state UI can
  // show "API returned N bids" + the resolved identity list when the
  // count is unexpectedly zero. Helps catch identity-drift bugs without
  // needing server logs. Strictly informational — no PII beyond what
  // the client already has via its own JWT.
  const _debug = {
    primaryId,
    resolvedIds: customerIds,
    rawBidCount: bids.length,
    jwtPhone: payload?.phone || null,
    jwtEmail: payload?.email || null,
    timestamp: new Date().toISOString(),
  };

  if (!bids.length) return NextResponse.json({ bids: [], _debug });

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

  return NextResponse.json({ bids: enriched, _debug });
}
