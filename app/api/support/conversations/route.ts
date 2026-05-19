import { NextRequest, NextResponse } from "next/server";
import { authUserId, authPayload, ensureUser } from "@/lib/sb-server";
import {
  createConversation,
  listConversationsForUser,
  listConversationsForAnon,
} from "@/lib/support/repo";

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
  });

  return NextResponse.json({ conversation: conv });
}
