import { NextRequest, NextResponse } from "next/server";
import { requireVerifiedAdmin } from "@/lib/admin/verify";
import { agentFromReq } from "@/lib/support/agent-auth";
import { logAdminAction } from "@/lib/admin/audit";
import {
  getConversation,
  insertMessage,
  patchConversation,
} from "@/lib/support/repo";
import type { SupportConversation } from "@/lib/support/types";

export const dynamic = "force-dynamic";

// POST /api/admin/support/conversations/:id/messages
// Body: { body: string, aiSuggested?: boolean }
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const admin = await requireVerifiedAdmin(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const params = await props.params;
  const agent = await agentFromReq(req);
  if (!agent) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({} as any));
  const text = String(body?.body || "").trim();
  if (!text) return NextResponse.json({ error: "empty_message" }, { status: 400 });
  if (text.length > 4000) return NextResponse.json({ error: "too_long" }, { status: 400 });

  const conv = await getConversation(params.id);
  if (!conv) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (conv.status === "closed" || conv.status === "resolved") {
    return NextResponse.json({ error: "conversation_closed" }, { status: 409 });
  }

  const msg = await insertMessage({
    conversationId: conv.id,
    sender: "agent",
    senderId: agent.id,
    senderName: agent.name || "Support",
    body: text,
    aiSuggested: !!body.aiSuggested,
  });

  // First agent reply on an escalated conv → flip to agent_active + auto-claim
  const patch: Partial<SupportConversation> = {
    last_message_at: new Date().toISOString(),
    last_message_sender: "agent",
    agent_message_count: conv.agent_message_count + 1,
    user_unread_count: conv.user_unread_count + 1,
  };
  if (conv.status !== "agent_active") {
    patch.status = "agent_active";
    patch.assigned_agent_id = agent.id;
    patch.assigned_agent_name = agent.name || "Support";
  }
  await patchConversation(conv.id, patch as any);

  logAdminAction({
    admin: { id: agent.id, name: agent.name, phone: agent.phone },
    action: "support.reply",
    targetType: "support_conversation",
    targetId: conv.id,
    details: { length: text.length, ai_suggested: !!body.aiSuggested },
  });

  return NextResponse.json({ message: msg });
}
