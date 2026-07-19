// v361 — Model 3: travel-agent self-registration (Google-authed).
// The user signs in with Google (Firebase), then submits agency details. We
// create a PENDING trade_agents row (admin approves later). Idempotent: a
// second call for the same auth id returns the existing row (no duplicate).
import { NextResponse } from "next/server";
import { SB_URL, SB_H } from "@/lib/sb";
import { genId } from "@/lib/sb-server";
import { tradeAgentFromReq, lookupTradeAgent } from "@/lib/trade/auth";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const auth = await tradeAgentFromReq(req);
  if (!auth) return NextResponse.json({ error: "Sign in with Google first." }, { status: 401 });

  // Already registered → return current status (no re-create).
  if (auth.agent) {
    return NextResponse.json({ registered: true, agent: publicAgent(auth.agent) });
  }

  let body: any = {};
  try { body = await req.json(); } catch { /* empty body ok */ }
  const agencyName = String(body.agencyName || body.agency_name || "").trim();
  if (!agencyName) return NextResponse.json({ error: "Agency name is required." }, { status: 400 });

  const row = {
    id: genId("ta"),
    user_id: auth.user.id,
    email: auth.user.email || body.email || null,
    name: String(body.name || auth.user.name || "").trim() || null,
    agency_name: agencyName,
    phone: String(body.phone || auth.user.phone || "").trim() || null,
    city: String(body.city || "").trim() || null,
    gst: String(body.gst || "").trim() || null,
    category: "standard",
    status: "pending",
    metadata: { source: "self_register" },
  };

  // Insert; on unique(user_id) conflict, ignore + re-fetch (idempotent).
  const r = await fetch(`${SB_URL}/rest/v1/trade_agents?on_conflict=user_id`, {
    method: "POST",
    headers: { ...SB_H, Prefer: "resolution=ignore-duplicates,return=representation" },
    body: JSON.stringify(row),
  });
  if (!r.ok) {
    const t = await r.text();
    return NextResponse.json({ error: "Registration failed.", detail: t }, { status: 500 });
  }
  const rows = await r.json().catch(() => []);
  let agent = Array.isArray(rows) ? rows[0] : rows;
  if (!agent) agent = await lookupTradeAgent(auth.user.id, auth.user.email);
  return NextResponse.json({ registered: true, agent: publicAgent(agent) });
}

function publicAgent(a: any) {
  if (!a) return null;
  return {
    id: a.id, agency_name: a.agency_name, name: a.name, email: a.email,
    city: a.city, category: a.category, status: a.status, created_at: a.created_at,
  };
}
