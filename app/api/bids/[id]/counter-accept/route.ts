import { NextRequest, NextResponse } from "next/server";
import { authUserId, sbSelect, sbUpdate } from "@/lib/sb-server";

// Customer accepts a hotel's counter-offer.
// Flips bid to ACCEPTED and promotes counterAmount → amount.
// Does NOT create a booking; customer must pay via /api/bids/:id/pay.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const customerId = authUserId(req);
  if (!customerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = params;
  const rows = await sbSelect(`bids?id=eq.${id}&select=id,customerId,status,amount,counterAmount,message`);
  const bid = rows[0];
  if (!bid) return NextResponse.json({ error: "Bid not found" }, { status: 404 });
  if (bid.customerId !== customerId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const finalAmount = Number(bid.counterAmount ?? bid.amount);
  try {
    const updated = await sbUpdate("bids", `id=eq.${id}`, {
      status: "ACCEPTED",
      amount: finalAmount,
    });
    return NextResponse.json({ bid: updated, accepted: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: 500 });
  }
}
