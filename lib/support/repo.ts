// Server-only Supabase REST helpers for the support system.
// Centralized so routes stay short and consistent.

import { SB_URL, SB_H } from "@/lib/sb-server";
import type {
  SupportConversation,
  SupportMessage,
  SupportSender,
  SupportStatus,
} from "./types";

const REPRESENT = { ...SB_H, Prefer: "return=representation" };

export async function getConversation(id: string): Promise<SupportConversation | null> {
  const r = await fetch(
    `${SB_URL}/rest/v1/support_conversations?id=eq.${encodeURIComponent(id)}&select=*&limit=1`,
    { headers: SB_H }
  );
  if (!r.ok) return null;
  const rows = await r.json();
  return rows?.[0] || null;
}

export async function listConversationsForUser(userId: string): Promise<SupportConversation[]> {
  const r = await fetch(
    `${SB_URL}/rest/v1/support_conversations?user_id=eq.${encodeURIComponent(userId)}&select=*&order=last_message_at.desc&limit=30`,
    { headers: SB_H }
  );
  if (!r.ok) return [];
  return r.json();
}

export async function listConversationsForAnon(anonId: string): Promise<SupportConversation[]> {
  const r = await fetch(
    `${SB_URL}/rest/v1/support_conversations?anonymous_id=eq.${encodeURIComponent(anonId)}&user_id=is.null&select=*&order=last_message_at.desc&limit=30`,
    { headers: SB_H }
  );
  if (!r.ok) return [];
  return r.json();
}

export type ConversationListFilter = {
  status?: SupportStatus | SupportStatus[];
  assignedAgentId?: string;
  unassignedOnly?: boolean;
  search?: string;
  limit?: number;
};

export async function listConversationsForAgent(
  filter: ConversationListFilter
): Promise<SupportConversation[]> {
  const params: string[] = [];
  if (filter.status) {
    const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
    params.push(`status=in.(${statuses.join(",")})`);
  }
  if (filter.assignedAgentId) {
    params.push(`assigned_agent_id=eq.${encodeURIComponent(filter.assignedAgentId)}`);
  } else if (filter.unassignedOnly) {
    params.push(`assigned_agent_id=is.null`);
  }
  if (filter.search) {
    const term = encodeURIComponent(`%${filter.search}%`);
    params.push(`or=(subject.ilike.${term},user_id.ilike.${term})`);
  }
  params.push("select=*");
  params.push("order=last_message_at.desc");
  params.push(`limit=${filter.limit || 100}`);

  const r = await fetch(
    `${SB_URL}/rest/v1/support_conversations?${params.join("&")}`,
    { headers: SB_H }
  );
  if (!r.ok) return [];
  return r.json();
}

export async function createConversation(input: {
  userId: string | null;
  anonymousId: string | null;
  subject: string | null;
  metadata: Record<string, any>;
  startStatus?: SupportStatus;
}): Promise<SupportConversation> {
  const row = {
    user_id: input.userId,
    anonymous_id: input.anonymousId,
    subject: input.subject,
    status: input.startStatus || "ai_active",
    metadata: input.metadata,
  };
  const r = await fetch(`${SB_URL}/rest/v1/support_conversations`, {
    method: "POST",
    headers: REPRESENT,
    body: JSON.stringify(row),
  });
  if (!r.ok) {
    throw new Error(`createConversation failed: ${r.status} ${await r.text()}`);
  }
  const rows = await r.json();
  return rows[0];
}

export async function patchConversation(
  id: string,
  patch: Partial<SupportConversation>
): Promise<SupportConversation | null> {
  const r = await fetch(
    `${SB_URL}/rest/v1/support_conversations?id=eq.${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      headers: REPRESENT,
      body: JSON.stringify(patch),
    }
  );
  if (!r.ok) return null;
  const rows = await r.json();
  return rows?.[0] || null;
}

export async function listMessages(
  conversationId: string,
  opts: { limit?: number; sinceIso?: string } = {}
): Promise<SupportMessage[]> {
  const params: string[] = [
    `conversation_id=eq.${encodeURIComponent(conversationId)}`,
    "select=*",
    "order=created_at.asc",
    `limit=${opts.limit || 200}`,
  ];
  if (opts.sinceIso) {
    params.push(`created_at=gt.${encodeURIComponent(opts.sinceIso)}`);
  }
  const r = await fetch(`${SB_URL}/rest/v1/support_messages?${params.join("&")}`, {
    headers: SB_H,
  });
  if (!r.ok) return [];
  return r.json();
}

export async function insertMessage(input: {
  conversationId: string;
  sender: SupportSender;
  senderId: string | null;
  senderName: string | null;
  body: string;
  aiSuggested?: boolean;
  aiModel?: string | null;
  aiTokensIn?: number | null;
  aiTokensOut?: number | null;
  aiConfidence?: number | null;
  aiShouldEscalate?: boolean | null;
}): Promise<SupportMessage> {
  const row = {
    conversation_id: input.conversationId,
    sender: input.sender,
    sender_id: input.senderId,
    sender_name: input.senderName,
    body: input.body,
    ai_suggested: !!input.aiSuggested,
    ai_model: input.aiModel ?? null,
    ai_tokens_in: input.aiTokensIn ?? null,
    ai_tokens_out: input.aiTokensOut ?? null,
    ai_confidence: input.aiConfidence ?? null,
    ai_should_escalate: input.aiShouldEscalate ?? null,
  };
  const r = await fetch(`${SB_URL}/rest/v1/support_messages`, {
    method: "POST",
    headers: REPRESENT,
    body: JSON.stringify(row),
  });
  if (!r.ok) {
    throw new Error(`insertMessage failed: ${r.status} ${await r.text()}`);
  }
  const rows = await r.json();
  return rows[0];
}

// PATCH every unread inbound message of a conversation to read.
// `who='user'` marks ai/agent/system messages read; `who='agent'` marks user messages read.
export async function markRead(
  conversationId: string,
  who: "user" | "agent"
): Promise<void> {
  const senderFilter = who === "user"
    ? "sender=in.(ai,agent,system)"
    : "sender=eq.user";
  await fetch(
    `${SB_URL}/rest/v1/support_messages?conversation_id=eq.${encodeURIComponent(conversationId)}&${senderFilter}&read_at=is.null`,
    {
      method: "PATCH",
      headers: SB_H,
      body: JSON.stringify({ read_at: new Date().toISOString() }),
    }
  );
  // Reset the unread counter on the conversation row
  const patch =
    who === "user"
      ? { user_unread_count: 0 }
      : { agent_unread_count: 0 };
  await patchConversation(conversationId, patch as any);
}

// Fetch lightweight user context for AI prompt.
// Returns counts only — no PII leaks into prompt.
export async function fetchUserContextForAI(userId: string): Promise<{
  name?: string | null;
  tier?: string | null;
  bookingCount: number;
  activeBidCount: number;
}> {
  const [userRow, bookingCount, activeBidCount] = await Promise.all([
    fetch(
      `${SB_URL}/rest/v1/users?id=eq.${encodeURIComponent(userId)}&select=name,tier&limit=1`,
      { headers: SB_H }
    ).then((r) => (r.ok ? r.json() : [])).catch(() => []),
    fetch(
      `${SB_URL}/rest/v1/bookings?customerId=eq.${encodeURIComponent(userId)}&select=id&limit=1`,
      { headers: { ...SB_H, Prefer: "count=exact" } }
    ).then((r) => {
      const range = r.headers.get("content-range") || "";
      const total = range.split("/")[1];
      return total ? Number(total) : 0;
    }).catch(() => 0),
    fetch(
      `${SB_URL}/rest/v1/bids?customerId=eq.${encodeURIComponent(userId)}&status=in.(PENDING,COUNTER)&select=id&limit=1`,
      { headers: { ...SB_H, Prefer: "count=exact" } }
    ).then((r) => {
      const range = r.headers.get("content-range") || "";
      const total = range.split("/")[1];
      return total ? Number(total) : 0;
    }).catch(() => 0),
  ]);

  return {
    name: userRow?.[0]?.name || null,
    tier: userRow?.[0]?.tier || null,
    bookingCount,
    activeBidCount,
  };
}
