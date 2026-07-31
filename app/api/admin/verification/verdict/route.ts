import { NextRequest, NextResponse } from "next/server";
import { requireVerifiedAdmin, auditIdentity } from "@/lib/admin/verify";
import { logAdminAction } from "@/lib/admin/audit";
import { SB_URL, SB_KEY } from "@/lib/sb";



export async function POST(req: NextRequest) {
  const admin = await requireVerifiedAdmin(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json();
  const { requestId, verdict, notes, refundAmount } = body;

  if (!requestId || !verdict) {
    return NextResponse.json({ error: "requestId and verdict required" }, { status: 400 });
  }

  // v126.3 — vp_requests only has columns: status, updated_at, etc. The
  // adminNotes/reviewedAt/refundAmount fields don't exist on this table, so
  // we update the supported columns + log the rest via the audit trail.
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
      updated_at: new Date().toISOString(),
    }),
  });

  const data = patchRes.ok ? await patchRes.json() : null;

  // v98 — audit
  logAdminAction({
    admin: auditIdentity(admin),
    action: `verification.${verdict}`,
    targetType: "verification",
    targetId: requestId,
    details: { refundAmount: refundAmount || 0 },
  });

  return NextResponse.json({ ok: patchRes.ok, request: data?.[0] || null });
}
