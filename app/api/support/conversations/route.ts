import { NextRequest, NextResponse } from "next/server";
import { authUserId, authPayload, ensureUser } from "@/lib/sb-server";
import {
  createConversation,
  insertMessage,
  listConversationsForUser,
  listConversationsForAnon,
  patchConversation,
} from "@/lib/support/repo";
import { isAIEnabled } from "@/lib/support/ai-agent";
import { t } from "@/lib/support/i18n";

export const dynamic = "force-dynamic";

// GET /api/support/conversations
// Customer's own conversation list. Signed-in users see by user_id;
// anonymous sessions see by x-support-anon-id header.
export async function GET(req: NextRequest) {
  const userId = authUserId(req);
  const anonId = req.headers.get("x-support-anon-id");

  if (userId) {
    const rows = await listConversationsForUser(userId);
    return NextResponse.json({ conversations: rows });
  }
  if (anonId) {
    const rows = await listConversationsForAnon(anonId);
    return NextResponse.json({ conversations: rows });
  }
  return NextResponse.json({ conversations: [] });
}

// POST /api/support/conversations
// Starts a new chat session. Returns the created conversation row.
// Body: { subject?: string, anonymousId?: string, metadata?: { pageUrl, locale } }
export async function POST(req: NextRequest) {
  const userId = authUserId(req);
  const payload = authPayload(req);
  const body = await req.json().catch(() => ({} as any));

  const anonId = userId
    ? null
    : (body.anonymousId || req.headers.get("x-support-anon-id") || null);

  if (!userId && !anonId) {
    return NextResponse.json(
      { error: "Either sign in or provide an anonymousId" },
      { status: 400 }
    );
  }

  if (userId && payload?.phone) {
    ensureUser(userId, payload.phone, payload.name).catch(() => {});
  }

  // v149 bug fix: ALWAYS start as ai_active so the fallback intent bot
  // (lib/support/fallback-bot.ts) can handle initial messages even when
  // ANTHROPIC_API_KEY is missing. Pre-v149 we set startStatus=escalated
  // when isAIEnabled()=false, which blocked runAIPath from ever running
  // and silenced the fallback bot entirely.
  const conv = await createConversation({
    userId,
    anonymousId: anonId,
    // v149 — accepts a `category` from the new pre-chat subject picker.
    subject: (body.subject || body.category || "").toString().slice(0, 200) || null,
    metadata: {
      pageUrl: body?.metadata?.pageUrl || null,
      locale: body?.metadata?.locale || null,
      userAgent: body?.metadata?.userAgent || null,
      tier: body?.metadata?.tier || null,
      category: body?.category || null,
    },
    startStatus: "ai_active",
  });

  // Seed a welcome system message so the chat doesn't open empty.
  // Always use welcomeAI — fallback bot covers when real Claude is off.
  const strings = t(body?.metadata?.locale || null);
  const welcomeBody = strings.welcomeAI;

  await insertMessage({
    conversationId: conv.id,
    sender: "system",
    senderId: null,
    senderName: "StayBid",
    body: welcomeBody,
  });

  await patchConversation(conv.id, {
    last_message_at: new Date().toISOString(),
    last_message_sender: "system",
    user_unread_count: 1,
  } as any);

  return NextResponse.json({ conversation: conv });
}
