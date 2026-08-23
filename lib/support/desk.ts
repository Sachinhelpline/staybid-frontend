// Shared HQ Support Desk data layer (server-only) used by every party surface
// (host / creator / trade agent / worker). Tickets + messages live in the SAME
// Supabase store the HQ panel reads (public.hq_support_tickets / _messages), so a
// ticket raised on any surface lands on the one HQ desk and HQ replies flow back.
//
// Ticket/message ops use the anon key (SB_KEY) — the tables carry the app-standard
// permissive RLS policy, exactly like complaints/support_conversations; row scoping
// is enforced HERE (owner_scope ∈ the caller's ids), not by RLS. File signing uses
// the service-aware header (sb-server) for the private storage bucket.

import { randomUUID } from "crypto";
import { SB_URL, SB_KEY } from "@/lib/sb";
import { SB_H as SB_H_SERVER } from "@/lib/sb-server";

const H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } as const;
const TICKETS = `${SB_URL}/rest/v1/hq_support_tickets`;
const MESSAGES = `${SB_URL}/rest/v1/hq_support_messages`;
const BUCKET = "hq-support-files";

export interface DeskIdentity {
  ownerId: string;        // stable id stored as owner_scope (the caller's primary id)
  ownerIds: string[];     // all ids that are "this human" — scopes their reads
  partyType: string;      // hotel_owner | investor | agent | host | creator | worker
  contactName: string | null;
  contactRef: string | null;
}

export async function listMyTickets(ownerIds: string[]) {
  const inList = ownerIds.map(encodeURIComponent).join(",");
  const r = await fetch(`${TICKETS}?owner_scope=in.(${inList})&select=*&order=updated_at.desc&limit=200`, { headers: H, cache: "no-store" });
  const rows: any[] = r.ok ? await r.json() : [];
  const open = rows.filter((t) => t.status === "open" || t.status === "in_progress").length;
  return {
    tickets: rows.map((t) => ({ id: t.id, subject: t.subject, category: t.category, priority: t.priority, status: t.status, updatedAt: t.updated_at, createdAt: t.created_at })),
    stats: { open, total: rows.length },
  };
}

export async function createMyTicket(id: DeskIdentity, body: any): Promise<{ id: string } | { error: string; detail?: string }> {
  const subject = body?.subject ? String(body.subject).trim().slice(0, 300) : "";
  if (!subject) return { error: "subject_required" };
  const now = new Date().toISOString();
  const ticketId = randomUUID();
  const ins = await fetch(TICKETS, {
    method: "POST",
    headers: { ...H, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({
      id: ticketId, subject, party_type: id.partyType, source: "partner",
      contact_name: id.contactName, contact_ref: id.contactRef, owner_scope: id.ownerId,
      category: body?.category ? String(body.category).trim() : null,
      priority: ["low", "normal", "high"].includes(body?.priority) ? body.priority : "normal",
      status: "open", created_by: id.ownerId, created_at: now, updated_at: now,
    }),
  });
  if (!ins.ok) return { error: "create_failed", detail: (await ins.text().catch(() => "")).slice(0, 200) };
  if (body?.message && String(body.message).trim()) {
    await fetch(MESSAGES, {
      method: "POST", headers: { ...H, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ id: randomUUID(), ticket_id: ticketId, author_id: id.ownerId, author_kind: "partner", author_name: id.contactName, body: String(body.message).trim().slice(0, 4000), created_at: now }),
    });
  }
  return { id: ticketId };
}

async function ownedTicket(id: string, ownerIds: string[]) {
  const r = await fetch(`${TICKETS}?id=eq.${encodeURIComponent(id)}&select=*`, { headers: H, cache: "no-store" });
  const rows: any[] = r.ok ? await r.json() : [];
  const t = rows[0];
  if (!t || !ownerIds.includes(t.owner_scope)) return null;
  return t;
}

export async function getMyTicket(id: string, ownerIds: string[]) {
  const t = await ownedTicket(id, ownerIds);
  if (!t) return null;
  const mr = await fetch(`${MESSAGES}?ticket_id=eq.${encodeURIComponent(id)}&select=*&order=created_at.asc&limit=500`, { headers: H, cache: "no-store" });
  const msgs: any[] = mr.ok ? await mr.json() : [];
  return {
    id: t.id, subject: t.subject, category: t.category, priority: t.priority, status: t.status,
    createdAt: t.created_at, updatedAt: t.updated_at, closedAt: t.closed_at,
    messages: msgs.map((m) => ({
      id: m.id, body: m.body, fileName: m.file_name, mimeType: m.mime_type, size: m.size,
      mine: m.author_kind === "partner",
      authorName: m.author_kind === "partner" ? "You" : (m.author_name || "StayBid Support"),
      createdAt: m.created_at,
    })),
  };
}

export async function replyMyTicket(id: string, ownerIds: string[], author: { authorId: string; authorName: string | null; body: string }) {
  const t = await ownedTicket(id, ownerIds);
  if (!t) return { error: "not_found" as const };
  const text = author.body.trim().slice(0, 4000);
  if (!text) return { error: "empty_message" as const };
  const now = new Date().toISOString();
  await fetch(MESSAGES, {
    method: "POST", headers: { ...H, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ id: randomUUID(), ticket_id: id, author_id: author.authorId, author_kind: "partner", author_name: author.authorName, body: text, created_at: now }),
  });
  const patch: any = { updated_at: now };
  if (t.status === "resolved" || t.status === "closed") { patch.status = "open"; patch.closed_at = null; }
  await fetch(`${TICKETS}?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH", headers: { ...H, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(patch),
  });
  return { ok: true as const };
}

export async function signMyFile(id: string, ownerIds: string[], msgId: string) {
  const t = await ownedTicket(id, ownerIds);
  if (!t) return null;
  const mr = await fetch(`${MESSAGES}?id=eq.${encodeURIComponent(msgId)}&ticket_id=eq.${encodeURIComponent(id)}&select=storage_path,file_name`, { headers: H, cache: "no-store" });
  const mrows: any[] = mr.ok ? await mr.json() : [];
  const msg = mrows[0];
  if (!msg || !msg.storage_path) return null;
  const sign = await fetch(`${SB_URL}/storage/v1/object/sign/${BUCKET}/${msg.storage_path}`, {
    method: "POST", headers: { ...SB_H_SERVER, "Content-Type": "application/json" }, body: JSON.stringify({ expiresIn: 300 }),
  });
  if (!sign.ok) return null;
  const s = await sign.json().catch(() => null);
  if (!s?.signedURL) return null;
  return { url: `${SB_URL}/storage/v1${s.signedURL}`, fileName: msg.file_name };
}

// Party uploads a file into their ticket (anon key → the bucket's anon INSERT
// policy, same convention as social-media/verification-videos). Adds a partner
// message row and reopens a resolved/closed ticket.
export async function uploadMyFile(
  id: string, ownerIds: string[],
  author: { authorId: string; authorName: string | null },
  file: { buf: Buffer; fileName: string; mimeType: string },
): Promise<{ ok: true; fileName: string } | { error: string; detail?: string }> {
  const t = await ownedTicket(id, ownerIds);
  if (!t) return { error: "not_found" };
  if (!file.buf.length) return { error: "empty_file" };
  const safeName = (file.fileName || "file").replace(/[\/\\]+/g, "_").slice(0, 200) || "file";
  const ext = safeName.includes(".") ? safeName.slice(safeName.lastIndexOf(".")) : "";
  const path = `${id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
  const up = await fetch(`${SB_URL}/storage/v1/object/${BUCKET}/${path}`, {
    method: "POST",
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": file.mimeType || "application/octet-stream", "x-upsert": "false" },
    body: file.buf as any,
  });
  if (!up.ok) return { error: "upload_failed", detail: (await up.text().catch(() => "")).slice(0, 200) };
  const now = new Date().toISOString();
  await fetch(MESSAGES, {
    method: "POST", headers: { ...H, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ id: randomUUID(), ticket_id: id, author_id: author.authorId, author_kind: "partner", author_name: author.authorName, file_name: safeName, storage_path: path, mime_type: file.mimeType || null, size: file.buf.length, created_at: now }),
  });
  const patch: any = { updated_at: now };
  if (t.status === "resolved" || t.status === "closed") { patch.status = "open"; patch.closed_at = null; }
  await fetch(`${TICKETS}?id=eq.${encodeURIComponent(id)}`, { method: "PATCH", headers: { ...H, "Content-Type": "application/json", Prefer: "return=minimal" }, body: JSON.stringify(patch) });
  return { ok: true, fileName: safeName };
}
