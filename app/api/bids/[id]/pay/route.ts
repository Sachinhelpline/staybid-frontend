import { NextRequest, NextResponse } from "next/server";
import { authUserId, sbSelect, sbUpdate } from "@/lib/sb-server";

// Marks a bid as paid by stamping the Razorpay payment id onto the bid.
// Clients call this AFTER /api/razorpay/verify has returned verified:true.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const customerId = authUserId(req);
  if (!customerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = params;
  const body = await req.json().catch(() => ({}));
  const paymentId: string = body?.razorpay_payment_id || "";
  if (!paymentId) return NextResponse.json({ error: "Missing payment id" }, { status: 400 });

  const rows = await sbSelect(`bids?id=eq.${id}&select=id,customerId,message`);
  const bid = rows[0];
  if (!bid) return NextResponse.json({ error: "Bid not found" }, { status: 404 });
  if (bid.customerId !== customerId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const existingMsg = bid.message || "";
  const paidStamp = `Razorpay: ${paymentId}`;
  const newMessage = existingMsg.includes("Razorpay:") ? existingMsg : (existingMsg ? `${existingMsg} | ${paidStamp}` : paidStamp);

  try {
    const updated = await sbUpdate("bids", `id=eq.${id}`, { message: newMessage });
    return NextResponse.json({ bid: updated, paid: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed to mark paid" }, { status: 500 });
  }
}
