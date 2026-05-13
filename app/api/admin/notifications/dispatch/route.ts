// POST /api/admin/notifications/dispatch
//   Manually mark a notification_queue row as 'sent' (or 'failed') from
//   the admin UI. Used when the worker isn't yet wired to MSG91/SendGrid
//   and operators want to clear pending items by hand after dealing with
//   them out-of-band.
//
//   Body: { id: string, status: "sent" | "failed" | "pending", note?: string }
import { NextResponse } from "next/server";
import { SB_URL, SB_H } from "@/lib/sb";
import { logAdminAction, adminFromReq } from "@/lib/admin/audit";

const VALID = new Set(["sent", "failed", "pending"]);

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const id = String(body.id || "").trim();
  const status = VALID.has(body.status) ? body.status : null;
  if (!id || !status) {
    return NextResponse.json({ error: "id and valid status required" }, { status: 400 });
  }
  const admin = adminFromReq(req);
  const patch: Record<string, any> = {
    status,
    updated_at: new Date().toISOString(),
  };
  if (status === "sent") patch.sent_at = new Date().toISOString();
  if (status === "failed") patch.error = body.note || "Manually marked failed by admin";

  const res = await fetch(`${SB_URL}/rest/v1/notification_queue?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: SB_H,
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    return NextResponse.json({ error: "Update failed", detail }, { status: 500 });
  }

  // Fire-and-forget audit log
  logAdminAction({
    admin,
    action: `notification.${status}`,
    targetType: "notification",
    targetId: id,
    details: { manual: true, note: body.note || null },
  });

  return NextResponse.json({ ok: true });
}
