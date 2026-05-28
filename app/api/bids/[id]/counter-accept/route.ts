import { NextRequest, NextResponse } from "next/server";
import { authUserId, sbSelect, sbUpdate } from "@/lib/sb-server";

// Customer accepts a hotel's counter-offer.
// Flips bid to ACCEPTED and promotes counterAmount → amount.
// Does NOT create a booking; customer must pay via /api/bids/:id/pay.
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const customerId = authUserId(req);
  if (!customerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = params;
  const rows = await sbSelect(`bids?id=eq.${id}&select=id,customerId,status,amount,counterAmount,message`);
  const bid = rows[0];
  if (!bid) return NextResponse.json({ error: "Bid not found" }, { status: 404 });
  if (bid.customerId !== customerId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const finalAmount = Number(bid.counterAmount ?? bid.amount);
  try {
    // v241.17 — stamp expiresAt = now + 15min (acceptance starts the
    // 15-minute payment window; expiresAt is the single source of truth
    // shared by the conflict check + /my-bids + lib/bid-expiry).
    const updated = await sbUpdate("bids", `id=eq.${id}`, {
      status: "ACCEPTED",
      amount: finalAmount,
      expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
    });
    return NextResponse.json({ bid: updated, accepted: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: 500 });
  }
}
