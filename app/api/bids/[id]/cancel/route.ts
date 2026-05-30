import { NextRequest, NextResponse } from "next/server";
import { authUserId, authPayload, resolveUserIds, sbSelect, sbUpdate } from "@/lib/sb-server";

// POST /api/bids/:id/cancel — customer cancels their own PENDING / COUNTER bid.
//
// Flips status → CANCELLED. This is what lets a customer remove a bid they no
// longer want (e.g. a stale pending bid) and immediately place a fresh one —
// the one-bid-per-hotel lock keys off active (PENDING/COUNTER/ACCEPTED-unpaid)
// bids, so a CANCELLED bid releases it. (This route was referenced by
// api.cancelBid since v229 but never actually existed — cancel 404'd silently.)
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const primaryId = authUserId(req);
  if (!primaryId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const bids = await sbSelect(`bids?id=eq.${encodeURIComponent(id)}&select=*`);
  const bid = bids[0];
  if (!bid) return NextResponse.json({ error: "Bid not found" }, { status: 404 });

  // Cross-identity ownership (v240): /my-bids shows bids across the user's
  // multiple identity rows (Firebase / phone variants), so resolve them all and
  // accept the cancel if the bid belongs to any of them.
  const payload = authPayload(req);
  const ownerIds = await resolveUserIds(primaryId, payload?.phone, payload?.email);
  if (!ownerIds.includes(String(bid.customerId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Only active, not-yet-confirmed bids can be cancelled by the customer.
  // ACCEPTED (a hotel committed) / CHECKED_IN / CHECKED_OUT / already-CANCELLED
  // / REJECTED / EXPIRED are terminal from the customer's side.
  if (!["PENDING", "COUNTER"].includes(String(bid.status))) {
    return NextResponse.json(
      { error: `Cannot cancel a ${String(bid.status).toLowerCase()} bid` },
      { status: 400 }
    );
  }

  try {
    await sbUpdate("bids", `id=eq.${encodeURIComponent(id)}`, { status: "CANCELLED" });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Cancel failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, bidId: id, status: "CANCELLED" });
}
