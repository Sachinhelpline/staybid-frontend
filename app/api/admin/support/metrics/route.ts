import { NextRequest, NextResponse } from "next/server";
import { requireVerifiedAdmin } from "@/lib/admin/verify";
import { agentFromReq } from "@/lib/support/agent-auth";
import { SB_URL, SB_H } from "@/lib/sb-server";

export const dynamic = "force-dynamic";

// GET /api/admin/support/metrics?days=7|30|90
//
// Aggregates support_conversations + support_messages over the requested
// window. All computations done in-memory after a single bounded fetch —
// keeps PostgREST chatter low. Hard cap of 5000 conversations per window
// (more than that and we'll add a materialized view).
export async function GET(req: NextRequest) {
  const admin = await requireVerifiedAdmin(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const agent = await agentFromReq(req);
  if (!agent) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const days = Math.max(1, Math.min(90, Number(req.nextUrl.searchParams.get("days") || 7)));
  const sinceIso = new Date(Date.now() - days * 86400_000).toISOString();

  const convs = await fetchConversationsSince(sinceIso);
  const messageStats = await fetchMessageStats(sinceIso);
  const queueDepth = await fetchQueueDepth();

  const total = convs.length;
  const aiOnlyResolved = convs.filter(
    (c) => c.status === "resolved" && !c.escalated_at
  ).length;
  const humanTouched = convs.filter((c) => !!c.escalated_at).length;
  const resolved = convs.filter((c) => c.status === "resolved" || c.status === "closed").length;
  const aiDeflectionRate = total > 0 ? aiOnlyResolved / total : 0;
  const resolutionRate = total > 0 ? resolved / total : 0;

  // Per-conversation timing (only on resolved rows with start + resolved timestamps)
  const resolvedDurations = convs
    .filter((c) => c.resolved_at && c.created_at)
    .map((c) => new Date(c.resolved_at!).getTime() - new Date(c.created_at).getTime())
    .filter((ms) => ms > 0 && ms < 30 * 86400_000);
  const avgResolutionMs =
    resolvedDurations.length > 0
      ? resolvedDurations.reduce((a, b) => a + b, 0) / resolvedDurations.length
      : 0;

  // Per-day conversation counts (last `days` buckets)
  const dailyCounts = bucketByDay(convs, days);

  // Top escalation reasons
  const reasonCounts: Record<string, number> = {};
  for (const c of convs) {
    if (c.escalation_reason) {
      reasonCounts[c.escalation_reason] = (reasonCounts[c.escalation_reason] || 0) + 1;
    }
  }
  const topReasons = Object.entries(reasonCounts)
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count);

  // Per-agent stats (only counts agents who touched at least 1 row)
  const perAgent: Record<
    string,
    { id: string; name: string; taken: number; resolved: number; messages: number }
  > = {};
  for (const c of convs) {
    if (!c.assigned_agent_id) continue;
    const key = c.assigned_agent_id;
    if (!perAgent[key]) {
      perAgent[key] = {
        id: c.assigned_agent_id,
        name: c.assigned_agent_name || "Agent",
        taken: 0,
        resolved: 0,
        messages: 0,
      };
    }
    perAgent[key].taken += 1;
    if (c.status === "resolved" || c.status === "closed") perAgent[key].resolved += 1;
  }
  // Merge agent message counts from the messages_by_agent lookup
  for (const [agentId, count] of Object.entries(messageStats.byAgent)) {
    if (perAgent[agentId]) perAgent[agentId].messages = count;
    else if (count > 0) {
      perAgent[agentId] = {
        id: agentId,
        name: messageStats.agentNames[agentId] || "Agent",
        taken: 0,
        resolved: 0,
        messages: count,
      };
    }
  }
  const agents = Object.values(perAgent).sort((a, b) => b.taken - a.taken);

  return NextResponse.json({
    range: { days, since: sinceIso },
    summary: {
      total,
      aiOnlyResolved,
      humanTouched,
      resolved,
      aiDeflectionRate: round2(aiDeflectionRate),
      resolutionRate: round2(resolutionRate),
      avgResolutionMs: Math.round(avgResolutionMs),
      messagesUserTotal: messageStats.byUser,
      messagesAITotal: messageStats.byAI,
      messagesAgentTotal: messageStats.byAgentTotal,
    },
    queueDepth,
    dailyCounts,
    topReasons,
    agents,
  });
}

type ConvRow = {
  id: string;
  status: string;
  escalation_reason: string | null;
  escalated_at: string | null;
  resolved_at: string | null;
  assigned_agent_id: string | null;
  assigned_agent_name: string | null;
  created_at: string;
};

async function fetchConversationsSince(sinceIso: string): Promise<ConvRow[]> {
  const params = [
    `created_at=gte.${encodeURIComponent(sinceIso)}`,
    "select=id,status,escalation_reason,escalated_at,resolved_at,assigned_agent_id,assigned_agent_name,created_at",
    "order=created_at.desc",
    "limit=5000",
  ];
  const r = await fetch(`${SB_URL}/rest/v1/support_conversations?${params.join("&")}`, {
    headers: SB_H,
  });
  if (!r.ok) return [];
  return r.json();
}

async function fetchQueueDepth(): Promise<{ ai: number; queue: number; agent: number }> {
  // Three quick COUNT queries via Prefer: count=exact
  async function count(status: string): Promise<number> {
    const r = await fetch(
      `${SB_URL}/rest/v1/support_conversations?status=eq.${status}&select=id&limit=1`,
      { headers: { ...SB_H, Prefer: "count=exact" } }
    );
    const range = r.headers.get("content-range") || "";
    const total = range.split("/")[1];
    return total ? Number(total) : 0;
  }
  const [ai, queue, agent] = await Promise.all([
    count("ai_active"),
    count("escalated"),
    count("agent_active"),
  ]);
  return { ai, queue, agent };
}

async function fetchMessageStats(sinceIso: string): Promise<{
  byUser: number;
  byAI: number;
  byAgentTotal: number;
  byAgent: Record<string, number>;
  agentNames: Record<string, string>;
}> {
  // Fetch lightweight projection of every message in window
  const params = [
    `created_at=gte.${encodeURIComponent(sinceIso)}`,
    "select=sender,sender_id,sender_name",
    "limit=20000",
  ];
  const r = await fetch(`${SB_URL}/rest/v1/support_messages?${params.join("&")}`, {
    headers: SB_H,
  });
  const rows: Array<{ sender: string; sender_id: string | null; sender_name: string | null }> =
    r.ok ? await r.json() : [];

  let byUser = 0;
  let byAI = 0;
  let byAgentTotal = 0;
  const byAgent: Record<string, number> = {};
  const agentNames: Record<string, string> = {};

  for (const m of rows) {
    if (m.sender === "user") byUser += 1;
    else if (m.sender === "ai") byAI += 1;
    else if (m.sender === "agent") {
      byAgentTotal += 1;
      if (m.sender_id) {
        byAgent[m.sender_id] = (byAgent[m.sender_id] || 0) + 1;
        if (m.sender_name) agentNames[m.sender_id] = m.sender_name;
      }
    }
  }
  return { byUser, byAI, byAgentTotal, byAgent, agentNames };
}

function bucketByDay(
  convs: ConvRow[],
  days: number
): Array<{ date: string; total: number; resolved: number; escalated: number }> {
  const buckets: Record<string, { total: number; resolved: number; escalated: number }> = {};
  const today = new Date();
  for (let i = 0; i < days; i += 1) {
    const d = new Date(today);
    d.setUTCDate(today.getUTCDate() - i);
    buckets[d.toISOString().slice(0, 10)] = { total: 0, resolved: 0, escalated: 0 };
  }
  for (const c of convs) {
    const key = c.created_at.slice(0, 10);
    if (!buckets[key]) buckets[key] = { total: 0, resolved: 0, escalated: 0 };
    buckets[key].total += 1;
    if (c.status === "resolved" || c.status === "closed") buckets[key].resolved += 1;
    if (c.escalated_at) buckets[key].escalated += 1;
  }
  return Object.entries(buckets)
    .map(([date, v]) => ({ date, ...v }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

function round2(n: number): number {
  return Math.round(n * 10000) / 10000;
}
