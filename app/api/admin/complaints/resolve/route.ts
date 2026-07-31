import { NextRequest, NextResponse } from "next/server";
import { logAdminAction } from "@/lib/admin/audit";
import { requireVerifiedAdmin, auditIdentity } from "@/lib/admin/verify";
import { SB_URL, SB_KEY } from "@/lib/sb";
import { purgeEvidenceVideos } from "@/lib/verify/cleanup";



export async function POST(req: NextRequest) {
  const admin = await requireVerifiedAdmin(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { complaintId, resolution, refundAmount, notes, paymentId } = await req.json();
  if (!complaintId || !resolution) {
    return NextResponse.json({ error: "complaintId and resolution required" }, { status: 400 });
  }

  const wantsRefund = !!(refundAmount && refundAmount > 0 && paymentId);
  // Fail closed: a refund needs a server-provided Razorpay secret. Never fall
  // back to a hardcoded credential. If the config is absent, reject the whole
  // request (do NOT mark the complaint resolved without issuing the refund).
  if (wantsRefund && (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET)) {
    return NextResponse.json(
      { error: "payment_config_missing" },
      { status: 503 },
    );
  }

  let refundResult: any = null;
  if (wantsRefund) {
    try {
      const keyId = process.env.RAZORPAY_KEY_ID as string;
      const keySecret = process.env.RAZORPAY_KEY_SECRET as string;
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

  // v127.1 — When a stay_feedback complaint flips to resolved/rejected,
  // purge the customer's evidence video files immediately (per user spec:
  // "jaishe hi complaing resolve hoti hai toh video sabhi jangha se delete
  // ho jayegi"). Only the smiley initials persist long-term.
  let videoCleanup: any = null;
  if (resolution === "resolved" || resolution === "rejected") {
    try {
      const beforeRes = await fetch(
        `${SB_URL}/rest/v1/complaints?id=eq.${encodeURIComponent(complaintId)}&select=id,feedback,evidenceVideoId,feedbackType&limit=1`,
        { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } },
      );
      const before = (beforeRes.ok ? await beforeRes.json().catch(() => []) : [])[0];
      if (before?.feedbackType === "stay_feedback") {
        videoCleanup = await purgeEvidenceVideos({
          id: before.id,
          feedback: before.feedback,
          evidenceVideoId: before.evidenceVideoId,
        });
      }
    } catch (e: any) {
      videoCleanup = { error: e?.message || String(e) };
    }
  }

  // v98 — audit
  logAdminAction({
    admin: auditIdentity(admin),
    action: `complaint.${resolution}`,
    targetType: "complaint",
    targetId: complaintId,
    details: { refundAmount: refundAmount || 0, paymentId: paymentId || null, refund: refundResult, videoCleanup },
  });

  return NextResponse.json({ ok: patchRes.ok, refund: refundResult, videoCleanup });
}
