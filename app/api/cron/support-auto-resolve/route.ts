import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_H } from "@/lib/sb-server";

export const dynamic = "force-dynamic";

// Auto-resolve idle support conversations.
//
// Triggers:
//   - ai_active conversations idle > IDLE_AI_HOURS (default 48h)
//   - escalated conversations idle > IDLE_QUEUE_HOURS (default 72h)
//   - agent_active conversations idle > IDLE_AGENT_HOURS (default 48h)
//
// Flips status to 'resolved' + adds a closing system message + sets
// resolved_by='auto'. Idempotent — runs against a filtered slice and the
// status flip is by-definition single-write.
//
// Auth: cron-job.org token query, Vercel native Bearer secret, OR admin
// adm_<48hex> header for manual trigger (matches /api/cron/expire-holds
// precedent).
//
// Schedule: daily on cron-job.org (no Vercel slot needed).

const IDLE_AI_HOURS = Number(process.env.SUPPORT_AUTO_RESOLVE_AI_HOURS || 48);
const IDLE_QUEUE_HOURS = Number(process.env.SUPPORT_AUTO_RESOLVE_QUEUE_HOURS || 72);
const IDLE_AGENT_HOURS = Number(process.env.SUPPORT_AUTO_RESOLVE_AGENT_HOURS || 48);
const MAX_PER_RUN = 200;

const REPRESENT = { ...SB_H, Prefer: "return=representation,resolution=ignore-duplicates" };

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return run();
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return run();
}

function isAuthorized(req: NextRequest): boolean {
  const url = new URL(req.url);
  const token = url.searchParams.get("token") || "";
  if (token && token === (process.env.CRON_SECRET || "staybid-cron-dev")) return true;

  const auth = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (auth && auth === (process.env.CRON_SECRET || "")) return true;

  const adminToken = req.headers.get("x-admin-token") || "";
  if (/^adm_[a-f0-9]{8,}$/i.test(adminToken)) return true;

  return false;
}

async function run(): Promise<NextResponse> {
  const now = new Date();
  const aiCutoff = isoMinusHours(now, IDLE_AI_HOURS);
  const queueCutoff = isoMinusHours(now, IDLE_QUEUE_HOURS);
  const agentCutoff = isoMinusHours(now, IDLE_AGENT_HOURS);

  const [aiCandidates, queueCandidates, agentCandidates] = await Promise.all([
    fetchCandidates("ai_active", aiCutoff),
    fetchCandidates("escalated", queueCutoff),
    fetchCandidates("agent_active", agentCutoff),
  ]);

  const all = [...aiCandidates, ...queueCandidates, ...agentCandidates].slice(0, MAX_PER_RUN);

  let resolvedCount = 0;
  for (const conv of all) {
    const ok = await resolveOne(conv.id, conv.status);
    if (ok) resolvedCount += 1;
  }

  return NextResponse.json({
    ok: true,
    scanned: {
      ai: aiCandidates.length,
      queue: queueCandidates.length,
      agent: agentCandidates.length,
    },
    resolved: resolvedCount,
    cutoffs: {
      ai: aiCutoff,
      queue: queueCutoff,
      agent: agentCutoff,
    },
    ran_at: now.toISOString(),
  });
}

async function fetchCandidates(
  status: "ai_active" | "escalated" | "agent_active",
  cutoffIso: string
): Promise<Array<{ id: string; status: string }>> {
  const params = [
    `status=eq.${status}`,
    `last_message_at=lt.${encodeURIComponent(cutoffIso)}`,
    "select=id,status",
    "limit=200",
  ];
  const r = await fetch(
    `${SB_URL}/rest/v1/support_conversations?${params.join("&")}`,
    { headers: SB_H }
  );
  if (!r.ok) return [];
  return r.json();
}

async function resolveOne(id: string, fromStatus: string): Promise<boolean> {
  // 1. Insert auto-close system message
  await fetch(`${SB_URL}/rest/v1/support_messages`, {
    method: "POST",
    headers: SB_H,
    body: JSON.stringify({
      conversation_id: id,
      sender: "system",
      sender_name: "StayBid",
      body:
        "Yeh chat 48h se idle thi — automatically resolve kar diya hai. Agar koi naya issue ho, naya chat shuru kar dijiye. ✨",
    }),
  }).catch(() => {});

  // 2. Patch the conversation row — narrow filter on status guards against
  // race conditions (a customer message between fetch and patch flips the
  // row out of the candidate window and the PATCH affects 0 rows).
  const r = await fetch(
    `${SB_URL}/rest/v1/support_conversations?id=eq.${encodeURIComponent(id)}&status=eq.${fromStatus}`,
    {
      method: "PATCH",
      headers: REPRESENT,
      body: JSON.stringify({
        status: "resolved",
        resolved_at: new Date().toISOString(),
        resolved_by: "auto",
        last_message_at: new Date().toISOString(),
        last_message_sender: "system",
      }),
    }
  );
  if (!r.ok) return false;
  const rows = await r.json().catch(() => []);
  return Array.isArray(rows) && rows.length > 0;
}

function isoMinusHours(now: Date, hours: number): string {
  return new Date(now.getTime() - hours * 60 * 60 * 1000).toISOString();
}
