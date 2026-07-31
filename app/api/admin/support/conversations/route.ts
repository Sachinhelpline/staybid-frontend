import { NextRequest, NextResponse } from "next/server";
import { requireVerifiedAdmin } from "@/lib/admin/verify";
import { agentFromReq } from "@/lib/support/agent-auth";
import { listConversationsForAgent } from "@/lib/support/repo";
import type { SupportStatus } from "@/lib/support/types";

export const dynamic = "force-dynamic";

// GET /api/admin/support/conversations?view=queue|mine|all&search=...
// view=queue → unassigned escalated/ai_active
// view=mine  → assigned to caller, active
// view=all   → everything except closed
export async function GET(req: NextRequest) {
  const admin = await requireVerifiedAdmin(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const agent = await agentFromReq(req);
  if (!agent) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const view = req.nextUrl.searchParams.get("view") || "queue";
  const search = req.nextUrl.searchParams.get("search") || "";

  let status: SupportStatus[] | undefined;
  let assignedAgentId: string | undefined;
  let unassignedOnly = false;

  if (view === "queue") {
    status = ["escalated", "ai_active"];
    unassignedOnly = true;
  } else if (view === "mine") {
    assignedAgentId = agent.id;
    status = ["agent_active", "escalated"];
  } else if (view === "resolved") {
    status = ["resolved", "closed"];
  } else {
    status = ["ai_active", "escalated", "agent_active"];
  }

  const conversations = await listConversationsForAgent({
    status,
    assignedAgentId,
    unassignedOnly,
    search: search || undefined,
    limit: 200,
  });

  return NextResponse.json({ conversations });
}
