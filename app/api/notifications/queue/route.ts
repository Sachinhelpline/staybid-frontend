import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_H } from "@/lib/sb";
import { verifiedCustomerFromReq, safeInternalPath } from "@/lib/auth/customer-verify";

const ALLOWED_CHANNELS = new Set(["email", "sms", "push", "whatsapp"]);

// Enqueue a notification. Actual delivery is handled by a backend cron /
// Supabase Edge Function that drains rows where status='pending' and
// scheduled_at <= NOW() via SendGrid (email) or MSG91 (sms/whatsapp).
export async function POST(req: NextRequest) {
  // Require a cryptographically VERIFIED caller (HS256 backend token). A
  // Firebase RS256 token fails closed here until firebase-admin lands.
  const u = verifiedCustomerFromReq(req);
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const channel = String(body?.channel || "").toLowerCase();
  const template = String(body?.template || "").trim();
  if (!ALLOWED_CHANNELS.has(channel) || !template) {
    return NextResponse.json({ error: "channel and template required" }, { status: 400 });
  }

  // Sanitize the client-supplied payload: the notification URL may only be a
  // validated internal application path (no external origins, no js:/data:).
  const rawPayload =
    body.payload && typeof body.payload === "object" ? { ...body.payload } : {};
  const safeUrl = safeInternalPath(rawPayload.url);
  if (safeUrl) rawPayload.url = safeUrl;
  else delete rawPayload.url;

  const row = {
    // Bound to the VERIFIED subject only. A client-supplied target userId is
    // ignored — a caller can never enqueue a notification for another user.
    user_id: u.id,
    channel,
    template,
    payload: rawPayload,
    scheduled_at: body.scheduledAt || new Date().toISOString(),
    status: "pending",
  };
  const ins = await fetch(`${SB_URL}/rest/v1/notification_queue`, { method: "POST", headers: SB_H, body: JSON.stringify(row) });
  if (!ins.ok) return NextResponse.json({ error: "Enqueue failed", detail: await ins.text() }, { status: 500 });
  const created = await ins.json().catch(() => null);
  return NextResponse.json({ notification: Array.isArray(created) ? created[0] : created, queued: true });
}
