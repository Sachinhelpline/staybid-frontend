// HQ Support Desk — CIRCLE INVESTOR side.
//
// A StayCircle investor raises + tracks support tickets from /circle/support and
// chats with the StayBid HQ team. Same unified Supabase store the HQ panel reads
// (public.hq_support_tickets) — real 2-way. party_type = 'investor'.
//
// Auth: the investor's customer sb_token Bearer → decodeJwt → cross-pool ids
// (same as /api/circle/portfolio). Scoped to the caller's OWN tickets. This does
// NOT touch the guest-customer support inbox (support_conversations).
//
//   GET  /api/circle/support   → my tickets
//   POST /api/circle/support   → raise a ticket (+ optional first message)

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { SB_URL, SB_H, decodeJwt } from "@/lib/sb-server";
import { resolveOwnerIdsCrossPool } from "@/lib/partner/owner-ids";

const TICKETS = `${SB_URL}/rest/v1/hq_support_tickets`;
const MESSAGES = `${SB_URL}/rest/v1/hq_support_messages`;

async function investorContext(req: NextRequest) {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const p = token ? decodeJwt(token) : null;
  if (!p?.id) return null;
  const ownerIds = await resolveOwnerIdsCrossPool(p.id, p.phone || req.headers.get("x-phone") || "", p.email || req.headers.get("x-email") || "");
  return { payload: p, ownerIds };
}

function listItem(t: any) {
  return {
    id: t.id, subject: t.subject, category: t.category, priority: t.priority,
    status: t.status, updatedAt: t.updated_at, createdAt: t.created_at,
  };
}

export async function GET(req: NextRequest) {
  const ctx = await investorContext(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const inList = ctx.ownerIds.map(encodeURIComponent).join(",");
  const r = await fetch(`${TICKETS}?owner_scope=in.(${inList})&select=*&order=updated_at.desc&limit=200`, { headers: SB_H, cache: "no-store" });
  const rows: any[] = r.ok ? await r.json() : [];
  const open = rows.filter((t) => t.status === "open" || t.status === "in_progress").length;
  return NextResponse.json({ tickets: rows.map(listItem), stats: { open, total: rows.length } });
}

export async function POST(req: NextRequest) {
  const ctx = await investorContext(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const subject = body?.subject ? String(body.subject).trim().slice(0, 300) : "";
  if (!subject) return NextResponse.json({ error: "subject_required" }, { status: 400 });

  const investorId = ctx.payload.id;
  const contactName = ctx.payload.name || ctx.payload.email || null;
  const contactRef = ctx.payload.phone || ctx.payload.email || null;
  const now = new Date().toISOString();
  const id = randomUUID();

  const ins = await fetch(TICKETS, {
    method: "POST",
    headers: { ...SB_H, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({
      id, subject, party_type: "investor", source: "partner",
      contact_name: contactName, contact_ref: contactRef, owner_scope: investorId,
      category: body?.category ? String(body.category).trim() : null,
      priority: ["low", "normal", "high"].includes(body?.priority) ? body.priority : "normal",
      status: "open", created_by: investorId, created_at: now, updated_at: now,
    }),
  });
  if (!ins.ok) {
    const msg = await ins.text().catch(() => "");
    return NextResponse.json({ error: "create_failed", detail: msg.slice(0, 200) }, { status: 500 });
  }

  if (body?.message && String(body.message).trim()) {
    await fetch(MESSAGES, {
      method: "POST",
      headers: { ...SB_H, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({
        id: randomUUID(), ticket_id: id, author_id: investorId, author_kind: "partner",
        author_name: contactName, body: String(body.message).trim().slice(0, 4000), created_at: now,
      }),
    });
  }
  return NextResponse.json({ id });
}
