import { NextRequest, NextResponse } from "next/server";
import { authUserId, authPayload } from "@/lib/sb-server";
import {
  getConversation,
  insertMessage,
  listMessages,
  patchConversation,
  fetchUserContextForAI,
} from "@/lib/support/repo";
import {
  isAIEnabled,
  respondToMessage,
  shouldShortCircuitEscalate,
} from "@/lib/support/ai-agent";
import { notifyTeamOfEscalation } from "@/lib/support/notify-team";
import { t, detectLocale } from "@/lib/support/i18n";
import { fallbackBotReply } from "@/lib/support/fallback-bot";
import type {
  SupportConversation,
  SupportEscalationReason,
  SupportStatus,
} from "@/lib/support/types";

export const dynamic = "force-dynamic";

// POST /api/support/conversations/:id/messages
// Body: { body: string }
// Flow:
//   1. Insert user message
//   2. If conversation is ai_active → call AI → insert AI reply (or escalate)
//   3. If conversation is agent_active or escalated → just bump unread + last_message
//   4. Always update conversation aggregates
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const userId = authUserId(req);
  const payload = authPayload(req);
  const anonId = req.headers.get("x-support-anon-id");
  const body = await req.json().catch(() => ({} as any));

  const text = String(body?.body || "").trim();
  if (!text) {
    return NextResponse.json({ error: "empty_message" }, { status: 400 });
  }
  if (text.length > 4000) {
    return NextResponse.json({ error: "message_too_long" }, { status: 400 });
  }

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

  const senderName = payload?.name || null;

  // 1. Persist user message
  const userMsg = await insertMessage({
    conversationId: conv.id,
    sender: "user",
    senderId: userId || anonId || null,
    senderName,
    body: text,
  });

  // 2. Decide next step based on conv.status
  let aiReplyMsg: any = null;
  let convPatch: Partial<SupportConversation> = {
    last_message_at: new Date().toISOString(),
    last_message_sender: "user",
    user_message_count: conv.user_message_count + 1,
    agent_unread_count: conv.agent_unread_count + (conv.status !== "ai_active" ? 1 : 0),
  };

  if (conv.status === "ai_active") {
    const aiResult = await runAIPath(conv, text, userId, senderName);
    aiReplyMsg = aiResult.message;
    convPatch = {
      ...convPatch,
      ...aiResult.conversationPatch,
    };

    // Team alert on any new escalation triggered this turn
    if (convPatch.status === "escalated" && convPatch.escalation_reason) {
      notifyTeamOfEscalation({
        conversation: { ...conv, ...convPatch } as SupportConversation,
        reason: convPatch.escalation_reason as SupportEscalationReason,
        lastUserMessage: text,
        customerName: senderName,
        customerPhone: payload?.phone || null,
      }).catch(() => {});
    }
  }

  await patchConversation(conv.id, convPatch as any);

  return NextResponse.json({
    userMessage: userMsg,
    aiReply: aiReplyMsg,
    conversationStatus: convPatch.status || conv.status,
  });
}

// GET /api/support/conversations/:id/messages?since=<iso>
// Used by polling loop. Returns NEW messages only when ?since is supplied.
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
  return NextResponse.json({
    messages,
    conversation: {
      id: conv.id,
      status: conv.status,
      assigned_agent_name: conv.assigned_agent_name,
      escalation_reason: conv.escalation_reason,
    },
  });
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

// Runs the AI path for one user turn. Returns the AI reply message (if any)
// and the conversation patch to apply.
async function runAIPath(
  conv: SupportConversation,
  userText: string,
  userId: string | null,
  senderName: string | null
): Promise<{ message: any; conversationPatch: Partial<SupportConversation> }> {
  const strings = t(conv.metadata?.locale || null);

  // Short-circuit: explicit "human agent" keyword OR refund/legal intent
  const shortCircuit = shouldShortCircuitEscalate(userText);
  if (shortCircuit.escalate) {
    const aiAck = await insertMessage({
      conversationId: conv.id,
      sender: "system",
      senderId: null,
      senderName: "StayBid",
      body:
        shortCircuit.reason === "specific_intent"
          ? strings.shortCircuitFinancial
          : strings.shortCircuitUser,
    });
    return {
      message: aiAck,
      conversationPatch: {
        status: "escalated" as SupportStatus,
        escalation_reason: shortCircuit.reason as SupportEscalationReason,
        escalated_at: new Date().toISOString(),
        last_message_at: new Date().toISOString(),
        last_message_sender: "system",
        agent_unread_count: conv.agent_unread_count + 1,
        ai_message_count: conv.ai_message_count + 1,
      },
    };
  }

  // AI disabled → try fallback intent bot FIRST. Real Claude is preferred
  // when ANTHROPIC_API_KEY is set, but the fallback handles common
  // queries (greetings, bid help, booking status, wallet, deals, points)
  // even without any API key. Only escalates when fallback can't match.
  if (!isAIEnabled()) {
    const locale = detectLocale(conv.metadata?.locale || null);
    const fb = fallbackBotReply(userText, locale);

    if (fb.matched && !fb.shouldEscalate) {
      const aiMsg = await insertMessage({
        conversationId: conv.id,
        sender: "ai",
        senderId: null,
        senderName: "StayBid Assistant",
        body: fb.reply,
        aiModel: "fallback-intent",
        aiConfidence: fb.confidence,
        aiShouldEscalate: false,
      });
      return {
        message: aiMsg,
        conversationPatch: {
          last_message_at: new Date().toISOString(),
          last_message_sender: "ai",
          ai_message_count: conv.ai_message_count + 1,
          user_unread_count: conv.user_unread_count + 1,
        },
      };
    }

    // Fallback didn't match OR matched but flagged for escalation
    // (refund / cancel / tech). Send the matched response (if any) then escalate.
    const bodyText = fb.matched ? fb.reply : strings.aiDisabledAck;
    const ack = await insertMessage({
      conversationId: conv.id,
      sender: fb.matched ? "ai" : "system",
      senderId: null,
      senderName: fb.matched ? "StayBid Assistant" : "StayBid",
      body: bodyText,
      aiModel: fb.matched ? "fallback-intent" : null,
      aiConfidence: fb.matched ? fb.confidence : null,
      aiShouldEscalate: true,
    });
    return {
      message: ack,
      conversationPatch: {
        status: "escalated" as SupportStatus,
        escalation_reason: fb.matched
          ? "specific_intent" as SupportEscalationReason
          : "ai_disabled" as SupportEscalationReason,
        escalated_at: new Date().toISOString(),
        last_message_at: new Date().toISOString(),
        last_message_sender: fb.matched ? "ai" : "system",
        agent_unread_count: conv.agent_unread_count + 1,
        ai_message_count: fb.matched ? conv.ai_message_count + 1 : conv.ai_message_count,
      },
    };
  }

  // Build context + history
  const [history, userCtx] = await Promise.all([
    listMessages(conv.id, { limit: 30 }),
    userId
      ? fetchUserContextForAI(userId)
      : Promise.resolve({ name: null, tier: null, bookingCount: 0, activeBidCount: 0 }),
  ]);

  let aiResp;
  try {
    aiResp = await respondToMessage({
      conversation: { id: conv.id, status: conv.status },
      history,
      newMessage: userText,
      userContext: {
        userId,
        name: userCtx.name || senderName,
        tier: userCtx.tier,
        bookingCount: userCtx.bookingCount,
        activeBidCount: userCtx.activeBidCount,
      },
    });
  } catch (e: any) {
    // AI failed — escalate to agent so user isn't blocked
    const ack = await insertMessage({
      conversationId: conv.id,
      sender: "system",
      senderId: null,
      senderName: "StayBid",
      body: strings.aiFailureAck,
    });
    return {
      message: ack,
      conversationPatch: {
        status: "escalated" as SupportStatus,
        escalation_reason: "low_confidence" as SupportEscalationReason,
        escalated_at: new Date().toISOString(),
        last_message_at: new Date().toISOString(),
        last_message_sender: "system",
        agent_unread_count: conv.agent_unread_count + 1,
      },
    };
  }

  // Persist AI reply
  const aiMsg = await insertMessage({
    conversationId: conv.id,
    sender: "ai",
    senderId: null,
    senderName: "StayBid Assistant",
    body: aiResp.reply,
    aiModel: aiResp.model,
    aiTokensIn: aiResp.tokensIn,
    aiTokensOut: aiResp.tokensOut,
    aiConfidence: aiResp.confidence,
    aiShouldEscalate: aiResp.shouldEscalate,
  });

  const patch: Partial<SupportConversation> = {
    last_message_at: new Date().toISOString(),
    last_message_sender: "ai",
    ai_message_count: conv.ai_message_count + 1,
    user_unread_count: conv.user_unread_count + 1,
  };

  if (aiResp.shouldEscalate) {
    patch.status = "escalated" as SupportStatus;
    patch.escalation_reason =
      (aiResp.escalationReason as SupportEscalationReason) || "low_confidence";
    patch.escalated_at = new Date().toISOString();
    patch.agent_unread_count = conv.agent_unread_count + 1;
  }

  return { message: aiMsg, conversationPatch: patch };
}
