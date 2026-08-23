// HQ Support Desk — PARTNER side: signed download URL for a message's file.
//   GET /api/partner/support/[id]/file?msgId=...
// Guards: the ticket must belong to this owner, and the message must be on it.

import { NextRequest, NextResponse } from "next/server";
import { resolveOwnerIdsCrossPool } from "@/lib/partner/owner-ids";
import { SB_URL, SB_KEY } from "@/lib/sb";
import { uploadMyFile } from "@/lib/support/desk";

const SB_H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } as const;
const BUCKET = "hq-support-files";

function decodeJwt(t: string): any {
  try { return JSON.parse(Buffer.from(t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString()); }
  catch { return null; }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const token = (req.headers.get("authorization") || "").replace("Bearer ", "").trim();
  const payload = token ? decodeJwt(token) : null;
  if (!payload?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const ownerIds = await resolveOwnerIdsCrossPool(
    payload.id, payload.phone || req.headers.get("x-phone") || "", payload.email || req.headers.get("x-email") || "",
  );
  const msgId = req.nextUrl.searchParams.get("msgId") || "";
  if (!msgId) return NextResponse.json({ error: "msgId_required" }, { status: 400 });

  // Ownership: ticket belongs to this owner
  const tr = await fetch(`${SB_URL}/rest/v1/hq_support_tickets?id=eq.${encodeURIComponent(id)}&select=owner_scope`, { headers: SB_H, cache: "no-store" });
  const trows: any[] = tr.ok ? await tr.json() : [];
  if (!trows[0] || !ownerIds.includes(trows[0].owner_scope)) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // Message must be on this ticket + have a file
  const mr = await fetch(`${SB_URL}/rest/v1/hq_support_messages?id=eq.${encodeURIComponent(msgId)}&ticket_id=eq.${encodeURIComponent(id)}&select=storage_path,file_name`, { headers: SB_H, cache: "no-store" });
  const mrows: any[] = mr.ok ? await mr.json() : [];
  const msg = mrows[0];
  if (!msg || !msg.storage_path) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const sign = await fetch(`${SB_URL}/storage/v1/object/sign/${BUCKET}/${msg.storage_path}`, {
    method: "POST",
    headers: { ...SB_H, "Content-Type": "application/json" },
    body: JSON.stringify({ expiresIn: 300 }),
  });
  if (!sign.ok) return NextResponse.json({ error: "sign_failed" }, { status: 500 });
  const s = await sign.json().catch(() => null);
  if (!s?.signedURL) return NextResponse.json({ error: "sign_failed" }, { status: 500 });
  return NextResponse.json({ url: `${SB_URL}/storage/v1${s.signedURL}`, fileName: msg.file_name });
}

// Upload a file into the ticket (partner attaches a file for HQ).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const token = (req.headers.get("authorization") || "").replace("Bearer ", "").trim();
  const payload = token ? decodeJwt(token) : null;
  if (!payload?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const ownerIds = await resolveOwnerIdsCrossPool(payload.id, payload.phone || req.headers.get("x-phone") || "", payload.email || req.headers.get("x-email") || "");
  const buf = Buffer.from(await req.arrayBuffer());
  const fileName = req.nextUrl.searchParams.get("fileName") || "file";
  const mimeType = req.nextUrl.searchParams.get("mimeType") || "application/octet-stream";
  const r = await uploadMyFile(id, ownerIds, { authorId: payload.id, authorName: payload.name || payload.email || null }, { buf, fileName, mimeType });
  if ("error" in r) return NextResponse.json(r, { status: r.error === "not_found" ? 404 : r.error === "empty_file" ? 400 : 500 });
  return NextResponse.json(r);
}
