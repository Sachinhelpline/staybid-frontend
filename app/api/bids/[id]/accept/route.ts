import { NextRequest, NextResponse } from "next/server";
import { authUserId, sbSelect, sbUpdate } from "@/lib/sb-server";
import { ACCEPTED_UNPAID_WINDOW_MS } from "@/lib/bid-expiry";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const customerId = authUserId(req);
  if (!customerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const bids = await sbSelect(`bids?id=eq.${id}&select=*`);
  const bid = bids[0];
  if (!bid) return NextResponse.json({ error: "Bid not found" }, { status: 404 });
  if (bid.customerId !== customerId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    // v241.17 — stamp expiresAt = now + 15min so the 15-minute payment
    // window starts at ACCEPTANCE, and so `expiresAt` is the single
    // source of truth for "is this ACCEPTED-unpaid bid still active" —
    // consumed identically by the server conflict check (isBidStale),
    // /my-bids liveBids, and lib/bid-expiry. Without this the row kept
    // its PENDING-era expiresAt, drifting the client (createdAt+15min)
    // from the server (expiresAt) → "Place Bid (0) but conflict fires".
    const updated = await sbUpdate(
      "bids",
      `id=eq.${id}`,
      { status: "ACCEPTED", expiresAt: new Date(Date.now() + ACCEPTED_UNPAID_WINDOW_MS).toISOString() }
    );
    return NextResponse.json({ bid: updated, accepted: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Accept failed" }, { status: 500 });
  }
}
