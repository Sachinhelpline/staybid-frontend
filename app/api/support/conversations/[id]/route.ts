import { NextRequest, NextResponse } from "next/server";
import { authUserId } from "@/lib/sb-server";
import {
  getConversation,
  listMessages,
  markRead,
  patchConversation,
} from "@/lib/support/repo";

export const dynamic = "force-dynamic";

// GET /api/support/conversations/:id
// Returns conversation + messages. Marks ai/agent messages as read for the user.
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const userId = authUserId(req);
  const anonId = req.headers.get("x-support-anon-id");

  const conv = await getConversation(params.id);
  if (!conv) return NextResponse.json({ error: "not_found" }, { status: 404 });

  if (!hasAccess(conv, userId, anonId)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const sinceIso = req.nextUrl.searchParams.get("since") || undefined;
  const messages = await listMessages(conv.id, { sinceIso });

  // Mark inbound (ai/agent/system) messages as read.
  if (!sinceIso) {
    markRead(conv.id, "user").catch(() => {});
  }

  return NextResponse.json({ conversation: conv, messages });
}

// PATCH /api/support/conversations/:id  { action: "close" }
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const userId = authUserId(req);
  const anonId = req.headers.get("x-support-anon-id");
  const body = await req.json().catch(() => ({} as any));

  const conv = await getConversation(params.id);
  if (!conv) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!hasAccess(conv, userId, anonId)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  if (body.action === "close") {
    const updated = await patchConversation(conv.id, {
      status: "closed",
      resolved_at: new Date().toISOString(),
      resolved_by: userId || anonId || "user",
    } as any);
    return NextResponse.json({ conversation: updated });
  }

  return NextResponse.json({ error: "unknown_action" }, { status: 400 });
}

function hasAccess(
  conv: { user_id: string | null; anonymous_id: string | null },
  userId: string | null,
  anonId: string | null
): boolean {
  if (conv.user_id && userId && conv.user_id === userId) return true;
  if (conv.anonymous_id && anonId && conv.anonymous_id === anonId) return true;
  return false;
}
