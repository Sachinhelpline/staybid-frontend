import { NextRequest, NextResponse } from "next/server";
import { authPayload, sbSelect, resolveUserIds, SB_URL, SB_H } from "@/lib/sb-server";

// v244 — lazy orphan-bid sweep. The cron-job.org schedule that flips stale
// ACCEPTED-unpaid bids → EXPIRED isn't guaranteed to be running (bids were
// found sitting expired for 11+ days, still blocking new bids + showing
// "Pay Now"/"Cancel"). Run the same RPC opportunistically every time a user
// opens My Bids, so the data self-heals regardless of the external cron.
// Fire-and-forget: a sweep failure must never break the bids fetch.
async function lazySweepOrphanedBids(): Promise<void> {
  try {
    await fetch(`${SB_URL}/rest/v1/rpc/mark_orphaned_accepted_bids`, {
      method: "POST",
      headers: { ...SB_H, "Content-Type": "application/json" },
      body: "{}",
    });
  } catch { /* swallow — never break the read path */ }
}

export async function GET(req: NextRequest) {
  const payload = authPayload(req);
  const primaryId = payload?.id || payload?.user_id || payload?.sub;
  if (!primaryId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Self-heal stale ACCEPTED-unpaid bids before reading (awaited so the
  // response already reflects the sweep — no stale "Pay Now" flash).
  await lazySweepOrphanedBids();

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
