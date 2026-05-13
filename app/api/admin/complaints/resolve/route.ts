import { NextRequest, NextResponse } from "next/server";
import { logAdminAction, adminFromReq } from "@/lib/admin/audit";
import { SB_URL, SB_KEY } from "@/lib/sb";



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

  // v98 — columns now exist after the v98_complaints_and_audit migration.
  // adminNotes (plural), refundAmount, resolvedAt + updatedAt are all real
  // columns. Until v98 this PATCH was silently failing on the schema
  // mismatch (admin page wrote adminNotes; DB only had adminNote).
  const patchRes = await fetch(`${SB_URL}/rest/v1/complaints?id=eq.${encodeURIComponent(complaintId)}`, {
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
      adminNote:  notes || null,                // mirror legacy column for older readers
      refundAmount: refundAmount || 0,
      resolvedAt: new Date().toISOString(),
      updatedAt:  new Date().toISOString(),
    }),
  });

  // v98 — audit
  logAdminAction({
    admin: adminFromReq(req),
    action: `complaint.${resolution}`,
    targetType: "complaint",
    targetId: complaintId,
    details: { refundAmount: refundAmount || 0, paymentId: paymentId || null, refund: refundResult },
  });

  return NextResponse.json({ ok: patchRes.ok, refund: refundResult });
}
