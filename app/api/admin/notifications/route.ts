import { NextRequest, NextResponse } from "next/server";
import { requireVerifiedAdmin } from "@/lib/admin/verify";
import { SB_URL, SB_READ } from "@/lib/sb";
import { notificationChannelStatus } from "@/lib/notify-server";

export async function GET(req: NextRequest) {
  const admin = await requireVerifiedAdmin(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const status = req.nextUrl.searchParams.get("status") || "pending";
  const filter = status === "all" ? "" : `status=eq.${encodeURIComponent(status)}&`;
  const res = await fetch(
    `${SB_URL}/rest/v1/notification_queue?${filter}select=*&order=created_at.desc&limit=200`,
    { headers: SB_READ }
  );
  const data = res.ok ? await res.json() : [];
  return NextResponse.json({
    notifications: Array.isArray(data) ? data : [],
    // Live channel-enablement so the team can see at a glance what's active.
    // sms/whatsapp/email stay false until the paid plan flags flip — see
    // docs/NOTIFICATIONS-ACTIVATION.md.
    channels: notificationChannelStatus(),
  });
}
