// HQ Support Desk — CIRCLE INVESTOR side: one ticket (detail + thread) + reply.
// Scoped to the caller's OWN tickets (owner_scope ∈ their cross-pool ids).
//   GET  /api/circle/support/[id]   → ticket + messages
//   POST /api/circle/support/[id]   → add a reply (text); reopens a resolved/closed ticket

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

async function ownedTicket(id: string, ownerIds: string[]) {
  const r = await fetch(`${TICKETS}?id=eq.${encodeURIComponent(id)}&select=*`, { headers: SB_H, cache: "no-store" });
  const rows: any[] = r.ok ? await r.json() : [];
  const t = rows[0];
  if (!t || !ownerIds.includes(t.owner_scope)) return null;
  return t;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await investorContext(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const t = await ownedTicket(id, ctx.ownerIds);
  if (!t) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const mr = await fetch(`${MESSAGES}?ticket_id=eq.${encodeURIComponent(id)}&select=*&order=created_at.asc&limit=500`, { headers: SB_H, cache: "no-store" });
  const msgs: any[] = mr.ok ? await mr.json() : [];
  return NextResponse.json({
    id: t.id, subject: t.subject, category: t.category, priority: t.priority, status: t.status,
    createdAt: t.created_at, updatedAt: t.updated_at, closedAt: t.closed_at,
    messages: msgs.map((m) => ({
      id: m.id, body: m.body, fileName: m.file_name, mimeType: m.mime_type, size: m.size,
      mine: m.author_kind === "partner",
      authorName: m.author_kind === "partner" ? "You" : (m.author_name || "StayBid Support"),
      createdAt: m.created_at,
    })),
  });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await investorContext(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const t = await ownedTicket(id, ctx.ownerIds);
  if (!t) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const text = body?.body ? String(body.body).trim().slice(0, 4000) : "";
  if (!text) return NextResponse.json({ error: "empty_message" }, { status: 400 });

  const now = new Date().toISOString();
  await fetch(MESSAGES, {
    method: "POST",
    headers: { ...SB_H, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({
      id: randomUUID(), ticket_id: id, author_id: ctx.payload.id, author_kind: "partner",
      author_name: ctx.payload.name || ctx.payload.email || null, body: text, created_at: now,
    }),
  });
  const patch: any = { updated_at: now };
  if (t.status === "resolved" || t.status === "closed") { patch.status = "open"; patch.closed_at = null; }
  await fetch(`${TICKETS}?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { ...SB_H, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(patch),
  });
  return NextResponse.json({ ok: true, createdAt: now });
}
