import { NextRequest, NextResponse } from "next/server";
import { authUserId } from "@/lib/sb-server";
import {
  getConversation,
  insertMessage,
  patchConversation,
} from "@/lib/support/repo";
import type {
  SupportConversation,
  SupportEscalationReason,
} from "@/lib/support/types";

export const dynamic = "force-dynamic";

// POST /api/support/conversations/:id/escalate
// User explicitly requests a human agent.
export async function POST(
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
  if (conv.status === "closed" || conv.status === "resolved") {
    return NextResponse.json(
      { error: "conversation_closed" },
      { status: 409 }
    );
  }
  if (conv.status === "agent_active" || conv.status === "escalated") {
    return NextResponse.json({
      conversation: conv,
      already: true,
    });
  }

  const reason = (body?.reason || "user_request") as SupportEscalationReason;

  await insertMessage({
    conversationId: conv.id,
    sender: "system",
    senderId: null,
    senderName: "StayBid",
    body: "Human team se connect kar rahe hain. Kuch hi minutes mein wapas message aayega. 🤝",
  });

  const patch: Partial<SupportConversation> = {
    status: "escalated",
    escalation_reason: reason,
    escalated_at: new Date().toISOString(),
    last_message_at: new Date().toISOString(),
    last_message_sender: "system",
    agent_unread_count: conv.agent_unread_count + 1,
  };

  const updated = await patchConversation(conv.id, patch as any);
  return NextResponse.json({ conversation: updated });
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
