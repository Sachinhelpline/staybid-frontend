import { NextRequest, NextResponse } from "next/server";
import { agentFromReq } from "@/lib/support/agent-auth";
import { logAdminAction } from "@/lib/admin/audit";
import { SB_URL, SB_H } from "@/lib/sb-server";
import {
  getConversation,
  listMessages,
  markRead,
  patchConversation,
} from "@/lib/support/repo";
import type {
  SupportConversation,
  SupportStatus,
} from "@/lib/support/types";

export const dynamic = "force-dynamic";

// GET /api/admin/support/conversations/:id?since=<iso>
// Returns conversation + messages + lightweight user-context panel data.
export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const agent = await agentFromReq(req);
  if (!agent) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const conv = await getConversation(params.id);
  if (!conv) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const sinceIso = req.nextUrl.searchParams.get("since") || undefined;
  const messages = await listMessages(conv.id, { sinceIso });

  if (!sinceIso) {
    markRead(conv.id, "agent").catch(() => {});
  }

  // Lightweight user context for the agent's right rail
  let userContext: any = null;
  if (conv.user_id) {
    userContext = await fetchAgentSideUserContext(conv.user_id);
  }

  return NextResponse.json({ conversation: conv, messages, userContext });
}

// POST /api/admin/support/conversations/:id  { action: "take" | "release" | "resolve" }
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const agent = await agentFromReq(req);
  if (!agent) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({} as any));
  const action = String(body?.action || "");

  const conv = await getConversation(params.id);
  if (!conv) return NextResponse.json({ error: "not_found" }, { status: 404 });

  let patch: Partial<SupportConversation> = {};

  if (action === "take") {
    if (conv.assigned_agent_id && conv.assigned_agent_id !== agent.id) {
      return NextResponse.json(
        { error: "already_assigned", to: conv.assigned_agent_name || conv.assigned_agent_id },
        { status: 409 }
      );
    }
    patch = {
      assigned_agent_id: agent.id,
      assigned_agent_name: agent.name || "Support",
      status: "agent_active" as SupportStatus,
    };
  } else if (action === "release") {
    if (conv.assigned_agent_id !== agent.id) {
      return NextResponse.json({ error: "not_assigned_to_you" }, { status: 403 });
    }
    patch = {
      assigned_agent_id: null,
      assigned_agent_name: null,
      status: "escalated" as SupportStatus,
    };
  } else if (action === "resolve") {
    patch = {
      status: "resolved" as SupportStatus,
      resolved_at: new Date().toISOString(),
      resolved_by: agent.id,
    };
  } else if (action === "ai_handoff") {
    // Hand the conversation BACK to AI (rare, but useful if agent thinks
    // bot can finish from here)
    patch = {
      assigned_agent_id: null,
      assigned_agent_name: null,
      status: "ai_active" as SupportStatus,
    };
  } else {
    return NextResponse.json({ error: "unknown_action" }, { status: 400 });
  }

  const updated = await patchConversation(conv.id, patch as any);

  logAdminAction({
    admin: { id: agent.id, name: agent.name, phone: agent.phone },
    action: `support.${action}`,
    targetType: "support_conversation",
    targetId: conv.id,
    details: { from_status: conv.status, to_status: patch.status || conv.status },
  });

  return NextResponse.json({ conversation: updated });
}

async function fetchAgentSideUserContext(userId: string): Promise<any> {
  const [userRow, bookings, bids, wallet] = await Promise.all([
    fetch(
      `${SB_URL}/rest/v1/users?id=eq.${encodeURIComponent(userId)}&select=id,name,phone,email,tier,role,createdAt&limit=1`,
      { headers: SB_H }
    ).then((r) => (r.ok ? r.json() : [])).catch(() => []),
    fetch(
      `${SB_URL}/rest/v1/bookings?customerId=eq.${encodeURIComponent(userId)}&select=id,status,checkIn,checkOut,hotelId,createdAt&order=createdAt.desc&limit=5`,
      { headers: SB_H }
    ).then((r) => (r.ok ? r.json() : [])).catch(() => []),
    fetch(
      `${SB_URL}/rest/v1/bids?customerId=eq.${encodeURIComponent(userId)}&select=id,status,amount,hotelId,createdAt&order=createdAt.desc&limit=5`,
      { headers: SB_H }
    ).then((r) => (r.ok ? r.json() : [])).catch(() => []),
    fetch(
      `${SB_URL}/rest/v1/wallet_credits?userId=eq.${encodeURIComponent(userId)}&select=amount,direction&limit=200`,
      { headers: SB_H }
    ).then((r) => (r.ok ? r.json() : [])).catch(() => []),
  ]);

  const balance = Array.isArray(wallet)
    ? wallet.reduce((s: number, r: any) => s + (r.direction === "DEBIT" ? -Number(r.amount || 0) : Number(r.amount || 0)), 0)
    : 0;

  return {
    user: userRow?.[0] || null,
    recentBookings: bookings,
    recentBids: bids,
    walletBalance: balance,
  };
}
