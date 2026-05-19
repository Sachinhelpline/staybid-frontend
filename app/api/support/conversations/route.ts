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

  const conv = await createConversation({
    userId,
    anonymousId: anonId,
    subject: (body.subject || "").toString().slice(0, 200) || null,
    metadata: {
      pageUrl: body?.metadata?.pageUrl || null,
      locale: body?.metadata?.locale || null,
      userAgent: body?.metadata?.userAgent || null,
      tier: body?.metadata?.tier || null,
    },
    // Start state depends on AI availability — without API key we don't
    // pretend AI is active.
    startStatus: isAIEnabled() ? "ai_active" : "escalated",
  });

  // Seed a welcome system message so the chat doesn't open empty.
  const welcomeBody = isAIEnabled()
    ? "👋 Aap StayBid Support se baat kar rahe hain. Booking, bid, payment — kuch bhi pucho. Agar human team chahiye, neeche \"Talk to human\" button hai."
    : "👋 Aap StayBid Support se baat kar rahe hain. Apna sawaal likhein — team kuch hi minutes mein reply karegi.";

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
