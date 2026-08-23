// HQ Support Desk — CIRCLE INVESTOR side: signed download URL for a message's file.
//   GET /api/circle/support/[id]/file?msgId=...
// Guards: the ticket must belong to this investor, and the message must be on it.

import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_H, decodeJwt } from "@/lib/sb-server";
import { resolveOwnerIdsCrossPool } from "@/lib/partner/owner-ids";
import { uploadMyFile } from "@/lib/support/desk";

const BUCKET = "hq-support-files";

async function investorOwnerIds(req: NextRequest) {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const p = token ? decodeJwt(token) : null;
  if (!p?.id) return null;
  const ownerIds = await resolveOwnerIdsCrossPool(p.id, p.phone || req.headers.get("x-phone") || "", p.email || req.headers.get("x-email") || "");
  return { p, ownerIds };
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await investorOwnerIds(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const buf = Buffer.from(await req.arrayBuffer());
  const fileName = req.nextUrl.searchParams.get("fileName") || "file";
  const mimeType = req.nextUrl.searchParams.get("mimeType") || "application/octet-stream";
  const r = await uploadMyFile(id, ctx.ownerIds, { authorId: ctx.p.id, authorName: ctx.p.name || ctx.p.email || null }, { buf, fileName, mimeType });
  if ("error" in r) return NextResponse.json(r, { status: r.error === "not_found" ? 404 : r.error === "empty_file" ? 400 : 500 });
  return NextResponse.json(r);
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const p = token ? decodeJwt(token) : null;
  if (!p?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const ownerIds = await resolveOwnerIdsCrossPool(p.id, p.phone || req.headers.get("x-phone") || "", p.email || req.headers.get("x-email") || "");
  const msgId = req.nextUrl.searchParams.get("msgId") || "";
  if (!msgId) return NextResponse.json({ error: "msgId_required" }, { status: 400 });

  const tr = await fetch(`${SB_URL}/rest/v1/hq_support_tickets?id=eq.${encodeURIComponent(id)}&select=owner_scope`, { headers: SB_H, cache: "no-store" });
  const trows: any[] = tr.ok ? await tr.json() : [];
  if (!trows[0] || !ownerIds.includes(trows[0].owner_scope)) return NextResponse.json({ error: "not_found" }, { status: 404 });

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
