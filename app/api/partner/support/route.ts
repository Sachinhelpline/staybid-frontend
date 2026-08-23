// HQ Support Desk — PARTNER side (hotel owner).
//
// A hotel owner raises + tracks support tickets from their dashboard. The tickets
// live in the SAME Supabase store the HQ panel reads (public.hq_support_tickets),
// so an HQ reply shows up here and vice-versa — one unified desk.
//
// Read/write is scoped to the partner's OWN tickets (owner_scope ∈ their owner ids),
// exactly like /api/partner/complaints. Service-role key (SB_KEY) bypasses RLS.
//
//   GET  /api/partner/support           → my tickets
//   POST /api/partner/support           → raise a ticket (+ optional first message)
//     Headers: Authorization: Bearer <sb_partner_token>  (+ optional x-phone / x-email)

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { resolveOwnerIdsCrossPool } from "@/lib/partner/owner-ids";
import { SB_URL, SB_KEY } from "@/lib/sb";
import { unreadTicketIds } from "@/lib/support/desk";

const SB_H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } as const;
const TICKETS = `${SB_URL}/rest/v1/hq_support_tickets`;
const MESSAGES = `${SB_URL}/rest/v1/hq_support_messages`;

function decodeJwt(t: string): any {
  try { return JSON.parse(Buffer.from(t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString()); }
  catch { return null; }
}

async function ownerContext(req: NextRequest) {
  const token = (req.headers.get("authorization") || "").replace("Bearer ", "").trim();
  if (!token) return null;
  const payload = decodeJwt(token);
  if (!payload?.id) return null;
  const headerPhone = req.headers.get("x-phone") || "";
  const headerEmail = req.headers.get("x-email") || "";
  const ownerIds = await resolveOwnerIdsCrossPool(payload.id, payload.phone || headerPhone, payload.email || headerEmail);
  return { payload, ownerIds };
}

function listItem(t: any) {
  return {
    id: t.id, subject: t.subject, category: t.category, priority: t.priority,
    status: t.status, hotelId: t.hotel_id, updatedAt: t.updated_at, createdAt: t.created_at,
  };
}

export async function GET(req: NextRequest) {
  const ctx = await ownerContext(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const inList = ctx.ownerIds.map(encodeURIComponent).join(",");
  const r = await fetch(
    `${TICKETS}?owner_scope=in.(${inList})&select=*&order=updated_at.desc&limit=200`,
    { headers: SB_H, cache: "no-store" },
  );
  const rows: any[] = r.ok ? await r.json() : [];
  const open = rows.filter((t) => t.status === "open" || t.status === "in_progress").length;
  const unread = await unreadTicketIds(rows);
  return NextResponse.json({
    tickets: rows.map((t) => ({ ...listItem(t), unread: unread.has(t.id) })),
    stats: { open, total: rows.length, unread: unread.size },
  });
}

export async function POST(req: NextRequest) {
  const ctx = await ownerContext(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const subject = body?.subject ? String(body.subject).trim().slice(0, 300) : "";
  if (!subject) return NextResponse.json({ error: "subject_required" }, { status: 400 });

  const ownerId = ctx.payload.id;
  const contactName = ctx.payload.name || ctx.payload.email || null;
  const contactRef = ctx.payload.phone || ctx.payload.email || null;
  const now = new Date().toISOString();
  const id = randomUUID();

  const ins = await fetch(TICKETS, {
    method: "POST",
    headers: { ...SB_H, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({
      id, subject, party_type: "hotel_owner", source: "partner",
      contact_name: contactName, contact_ref: contactRef, owner_scope: ownerId,
      hotel_id: body?.hotelId ? String(body.hotelId).trim() : null,
      category: body?.category ? String(body.category).trim() : null,
      priority: ["low", "normal", "high"].includes(body?.priority) ? body.priority : "normal",
      status: "open", created_by: ownerId, created_at: now, updated_at: now,
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
        id: randomUUID(), ticket_id: id, author_id: ownerId, author_kind: "partner",
        author_name: contactName, body: String(body.message).trim().slice(0, 4000), created_at: now,
      }),
    });
  }
  return NextResponse.json({ id });
}
