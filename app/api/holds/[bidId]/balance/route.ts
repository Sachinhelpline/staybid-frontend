// Settle the balance on a held bid. Called after the customer pays the
// remaining amount via Razorpay (from the bookings page HoldBanner).
//
// POST /api/holds/[bidId]/balance
//   body: { balancePaymentId: "pay_..." }
//   marks bid_holds.status = "completed", records the payment id.

import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_H, userFromReq } from "@/lib/sb";

export async function POST(req: NextRequest, props: { params: Promise<{ bidId: string }> }) {
  const params = await props.params;
  const user = userFromReq(req);
  if (!user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const bidId = params.bidId;
  if (!bidId) return NextResponse.json({ error: "bidId required" }, { status: 400 });

  try {
    const { balancePaymentId } = await req.json();
    const r = await fetch(
      `${SB_URL}/rest/v1/bid_holds?bid_id=eq.${encodeURIComponent(bidId)}&customer_id=eq.${encodeURIComponent(user.id)}`,
      {
        method: "PATCH",
        headers: SB_H,
        body: JSON.stringify({
          status: "completed",
          balance_payment_id: balancePaymentId || null,
        }),
      }
    );
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return NextResponse.json({ error: data?.message || "Update failed" }, { status: 500 });
    return NextResponse.json({ ok: true, hold: (data as any[])[0] || null });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
