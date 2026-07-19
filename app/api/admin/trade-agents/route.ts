// v361 — Model 3: admin management of travel-agent accounts.
//   GET  ?status=pending|approved|rejected|suspended|all → list agents.
//   POST { agentId, action: 'approve'|'reject'|'suspend'|'reinstate', category? }
//        → change status (+ optional category). Audit-logged.
import { NextResponse } from "next/server";
import { SB_URL, SB_H, SB_READ } from "@/lib/sb";
import { adminFromReq, logAdminAction } from "@/lib/admin/audit";

export const dynamic = "force-dynamic";

const ACTION_STATUS: Record<string, string> = {
  approve: "approved",
  reject: "rejected",
  suspend: "suspended",
  reinstate: "approved",
};

export async function GET(req: Request) {
  const admin = adminFromReq(req);
  if (!admin) return NextResponse.json({ error: "Admin auth required." }, { status: 401 });

  const url = new URL(req.url);
  const status = (url.searchParams.get("status") || "all").toLowerCase();
  let filter = "";
  if (status !== "all") filter = `&status=eq.${encodeURIComponent(status)}`;

  const r = await fetch(
    `${SB_URL}/rest/v1/trade_agents?select=*${filter}&order=created_at.desc&limit=500`,
    { headers: SB_READ, cache: "no-store" },
  );
  const rows = r.ok ? await r.json().catch(() => []) : [];
  return NextResponse.json({ agents: rows });
}

export async function POST(req: Request) {
  const admin = adminFromReq(req);
  if (!admin) return NextResponse.json({ error: "Admin auth required." }, { status: 401 });

  let body: any = {};
  try { body = await req.json(); } catch {}
  const agentId = String(body.agentId || body.agent_id || "").trim();
  const action = String(body.action || "").trim().toLowerCase();
  if (!agentId) return NextResponse.json({ error: "agentId required." }, { status: 400 });
  const nextStatus = ACTION_STATUS[action];
  if (!nextStatus) return NextResponse.json({ error: "Invalid action." }, { status: 400 });

  const patch: any = { status: nextStatus, updated_at: new Date().toISOString() };
  if (typeof body.category === "string" && body.category.trim()) patch.category = body.category.trim();

  const r = await fetch(
    `${SB_URL}/rest/v1/trade_agents?id=eq.${encodeURIComponent(agentId)}`,
    { method: "PATCH", headers: { ...SB_H, Prefer: "return=representation" }, body: JSON.stringify(patch) },
  );
  if (!r.ok) {
    const t = await r.text();
    return NextResponse.json({ error: "Update failed.", detail: t }, { status: 500 });
  }
  const [agent] = await r.json().catch(() => []);
  if (!agent) return NextResponse.json({ error: "Agent not found." }, { status: 404 });

  logAdminAction({
    admin, action: `trade_agent.${action}`, targetType: "trade_agent", targetId: agentId,
    details: { status: nextStatus, category: patch.category },
  });

  return NextResponse.json({ ok: true, agent });
}
