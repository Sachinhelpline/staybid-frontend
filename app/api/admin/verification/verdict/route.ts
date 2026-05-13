import { NextRequest, NextResponse } from "next/server";
import { logAdminAction, adminFromReq } from "@/lib/admin/audit";
import { SB_URL, SB_KEY } from "@/lib/sb";



export async function POST(req: NextRequest) {
  const body = await req.json();
  const { requestId, verdict, notes, refundAmount } = body;

  if (!requestId || !verdict) {
    return NextResponse.json({ error: "requestId and verdict required" }, { status: 400 });
  }

  const patchRes = await fetch(`${SB_URL}/rest/v1/vp_requests?id=eq.${requestId}`, {
    method: "PATCH",
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify({
      status: verdict,
      adminNotes: notes || null,
      reviewedAt: new Date().toISOString(),
      refundAmount: refundAmount || 0,
    }),
  });

  const data = patchRes.ok ? await patchRes.json() : null;

  // v98 — audit
  logAdminAction({
    admin: adminFromReq(req),
    action: `verification.${verdict}`,
    targetType: "verification",
    targetId: requestId,
    details: { refundAmount: refundAmount || 0 },
  });

  return NextResponse.json({ ok: patchRes.ok, request: data?.[0] || null });
}
