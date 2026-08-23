// HQ Support Desk — host surface: one ticket (detail + thread) + reply.
import { NextRequest, NextResponse } from "next/server";
import { hostIdentity } from "@/lib/support/identity";
import { getMyTicket, replyMyTicket } from "@/lib/support/desk";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = await hostIdentity(req);
  if (!id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: tid } = await params;
  const d = await getMyTicket(tid, id.ownerIds);
  if (!d) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(d);
}
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = await hostIdentity(req);
  if (!id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: tid } = await params;
  const body = await req.json().catch(() => ({}));
  const r = await replyMyTicket(tid, id.ownerIds, { authorId: id.ownerId, authorName: id.contactName, body: String(body?.body ?? "") });
  if ("error" in r) return NextResponse.json(r, { status: r.error === "not_found" ? 404 : 400 });
  return NextResponse.json(r);
}
