import { NextRequest, NextResponse } from "next/server";

const SB_URL = "https://uxxhbdqedazpmvbvaosh.supabase.co";
const SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV4eGhiZHFlZGF6cG12YnZhb3NoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxMTIwMDgsImV4cCI6MjA5MDY4ODAwOH0.mBhr1tNlail5u0D_dj3ljA9oRZvZ7_2_0-lt7I6cJ60";

export async function POST(req: NextRequest) {
  const { complaintId, resolution, refundAmount, notes, paymentId } = await req.json();
  if (!complaintId || !resolution) {
    return NextResponse.json({ error: "complaintId and resolution required" }, { status: 400 });
  }

  let refundResult: any = null;
  if (refundAmount && refundAmount > 0 && paymentId) {
    try {
      const keyId = process.env.RAZORPAY_KEY_ID || "rzp_live_SfFAsbYjbHfztd";
      const keySecret = process.env.RAZORPAY_KEY_SECRET || "dv3xFGG44R2FSqlshkDVY2Gn";
      const auth = Buffer.from(`${keyId}:${keySecret}`).toString("base64");
      const rRes = await fetch(`https://api.razorpay.com/v1/payments/${paymentId}/refund`, {
        method: "POST",
        headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
        body: JSON.stringify({ amount: Math.round(refundAmount * 100) }),
      });
      refundResult = await rRes.json();
    } catch (e: any) {
      refundResult = { error: e.message };
    }
  }

  const patchRes = await fetch(`${SB_URL}/rest/v1/complaints?id=eq.${complaintId}`, {
    method: "PATCH",
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify({
      status: resolution,
      adminNotes: notes || null,
      refundAmount: refundAmount || 0,
      resolvedAt: new Date().toISOString(),
    }),
  });

  return NextResponse.json({ ok: patchRes.ok, refund: refundResult });
}
