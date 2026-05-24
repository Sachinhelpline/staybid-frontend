import { NextRequest, NextResponse } from "next/server";
import { authUserId, sbSelect, sbUpdate } from "@/lib/sb-server";

// Per-flow timers — must match /api/bids/place
const NEGOTIATE_MS = 3 * 3600_000;
const PLACE_MS     = 1 * 3600_000;
const expiresAtFor = (flow?: string) =>
  new Date(Date.now() + (flow === "place" ? PLACE_MS : NEGOTIATE_MS)).toISOString();

// PATCH /api/bids/:id/budget — update the per-night amount on an active bid
// (PENDING or COUNTER) instead of placing a brand-new bid. COUNTER bids
// revert to PENDING so the hotel re-evaluates against the customer's
// updated offer.
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const customerId = authUserId(req);
  if (!customerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const newAmount = Number(body?.amount);
  const flow = body?.flow;
  if (!Number.isFinite(newAmount) || newAmount <= 0) {
    return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
  }

  const bids = await sbSelect(`bids?id=eq.${id}&select=*`);
  const bid = bids[0];
  if (!bid) return NextResponse.json({ error: "Bid not found" }, { status: 404 });
  if (bid.customerId !== customerId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!["PENDING", "COUNTER"].includes(bid.status)) {
    return NextResponse.json(
      { error: `Cannot update a ${String(bid.status).toLowerCase()} bid` },
      { status: 400 }
    );
  }

  // Floor check — never allow the new budget to fall below the room floor
  const rooms = await sbSelect(`rooms?id=eq.${bid.roomId}&select=floorPrice`);
  const floor = Number(rooms[0]?.floorPrice || 0);
  if (floor && newAmount < floor) {
    return NextResponse.json(
      { error: `Amount too low. Minimum: ₹${floor}` },
      { status: 400 }
    );
  }

  try {
    const patch: any = {
      amount: newAmount,
      expiresAt: expiresAtFor(flow),
    };
    if (bid.status === "COUNTER") {
      patch.status = "PENDING";
      patch.counterAmount = null;
    }
    const updated = await sbUpdate("bids", `id=eq.${id}`, patch);
    return NextResponse.json({ bid: updated });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Update failed" }, { status: 500 });
  }
}
