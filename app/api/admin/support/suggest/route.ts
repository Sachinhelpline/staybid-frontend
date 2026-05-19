import { NextRequest, NextResponse } from "next/server";
import { agentFromReq } from "@/lib/support/agent-auth";
import {
  getConversation,
  listMessages,
  fetchUserContextForAI,
} from "@/lib/support/repo";
import {
  isAIEnabled,
  respondToMessage,
} from "@/lib/support/ai-agent";

export const dynamic = "force-dynamic";

// POST /api/admin/support/suggest  { conversationId: string }
// Returns an AI-suggested reply the agent can paste/edit.
export async function POST(req: NextRequest) {
  const agent = await agentFromReq(req);
  if (!agent) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  if (!isAIEnabled()) {
    return NextResponse.json(
      { error: "ai_disabled", reason: "ANTHROPIC_API_KEY not configured" },
      { status: 503 }
    );
  }

  const body = await req.json().catch(() => ({} as any));
  const convId = String(body?.conversationId || "");
  if (!convId) return NextResponse.json({ error: "missing_conversation_id" }, { status: 400 });

  const conv = await getConversation(convId);
  if (!conv) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const history = await listMessages(conv.id, { limit: 20 });
  const lastUser = [...history].reverse().find((m) => m.sender === "user");
  if (!lastUser) {
    return NextResponse.json({ error: "no_user_message" }, { status: 400 });
  }

  const userCtx = conv.user_id
    ? await fetchUserContextForAI(conv.user_id)
    : { name: null, tier: null, bookingCount: 0, activeBidCount: 0 };

  try {
    const aiResp = await respondToMessage({
      conversation: { id: conv.id, status: conv.status },
      history: history.filter((m) => m.id !== lastUser.id),
      newMessage: lastUser.body,
      userContext: {
        userId: conv.user_id,
        name: userCtx.name,
        tier: userCtx.tier,
        bookingCount: userCtx.bookingCount,
        activeBidCount: userCtx.activeBidCount,
      },
    });
    return NextResponse.json({
      suggestion: aiResp.reply,
      confidence: aiResp.confidence,
    });
  } catch (e: any) {
    return NextResponse.json({ error: "ai_failed", detail: String(e?.message || e) }, { status: 502 });
  }
}
