import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_H, userFromReq } from "@/lib/sb";

// POST /api/push/register — store (or refresh) an FCM device token for the
// signed-in user. Upserts on the unique `token` so re-registering the same
// device just refreshes user_id + updated_at. The Railway notification
// drainer reads push_tokens by user_id to send web/native push.
export async function POST(req: NextRequest) {
  const u = userFromReq(req);
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const token = String(body?.token || "").trim();
  const platform = ["web", "android", "ios"].includes(String(body?.platform))
    ? String(body.platform)
    : "web";
  const userAgent = String(body?.userAgent || "").slice(0, 400);
  if (!token) return NextResponse.json({ error: "token required" }, { status: 400 });

  const r = await fetch(`${SB_URL}/rest/v1/push_tokens`, {
    method: "POST",
    headers: { ...SB_H, Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify({
      user_id: u.id,
      token,
      platform,
      user_agent: userAgent,
      enabled: true,
      updated_at: new Date().toISOString(),
    }),
  });
  if (!r.ok) {
    return NextResponse.json({ error: "register failed", detail: await r.text() }, { status: 500 });
  }
  return NextResponse.json({ registered: true });
}

// DELETE /api/push/register — disable a token (user turned notifications off).
export async function DELETE(req: NextRequest) {
  const u = userFromReq(req);
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const token = String(body?.token || "").trim();
  if (!token) return NextResponse.json({ error: "token required" }, { status: 400 });
  await fetch(
    `${SB_URL}/rest/v1/push_tokens?token=eq.${encodeURIComponent(token)}&user_id=eq.${encodeURIComponent(u.id)}`,
    { method: "PATCH", headers: { ...SB_H }, body: JSON.stringify({ enabled: false, updated_at: new Date().toISOString() }) }
  );
  return NextResponse.json({ disabled: true });
}
