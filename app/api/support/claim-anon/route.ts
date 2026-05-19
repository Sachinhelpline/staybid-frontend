import { NextRequest, NextResponse } from "next/server";
import { authUserId } from "@/lib/sb-server";
import { SB_URL, SB_H } from "@/lib/sb-server";

export const dynamic = "force-dynamic";

// POST /api/support/claim-anon  { anonymousId: string }
//
// Customer signed in after starting an anonymous chat. We migrate every
// orphan support_conversation row matching the anon id to the new user's
// account so the chat history persists across devices and sessions.
//
// Only updates rows where user_id IS NULL — guards against a different
// account already claiming this anon-id (extremely unlikely but possible
// if someone shares a device).
export async function POST(req: NextRequest) {
  const userId = authUserId(req);
  if (!userId) {
    return NextResponse.json({ error: "must_be_signed_in" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({} as any));
  const anonymousId = String(body?.anonymousId || "").trim();
  if (!anonymousId) {
    return NextResponse.json({ error: "missing_anonymous_id" }, { status: 400 });
  }

  const r = await fetch(
    `${SB_URL}/rest/v1/support_conversations?anonymous_id=eq.${encodeURIComponent(anonymousId)}&user_id=is.null`,
    {
      method: "PATCH",
      headers: { ...SB_H, Prefer: "return=representation" },
      body: JSON.stringify({ user_id: userId }),
    }
  );
  if (!r.ok) {
    return NextResponse.json({ error: "patch_failed" }, { status: 502 });
  }
  const rows = await r.json().catch(() => []);
  return NextResponse.json({ claimed: Array.isArray(rows) ? rows.length : 0 });
}
