// HQ Support Desk — worker surface: file download (GET, signed) + upload (POST).
import { NextRequest, NextResponse } from "next/server";
import { workerIdentity } from "@/lib/support/identity";
import { signMyFile, uploadMyFile } from "@/lib/support/desk";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = await workerIdentity(req);
  if (!id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: tid } = await params;
  const msgId = req.nextUrl.searchParams.get("msgId") || "";
  if (!msgId) return NextResponse.json({ error: "msgId_required" }, { status: 400 });
  const r = await signMyFile(tid, id.ownerIds, msgId);
  if (!r) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(r);
}
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = await workerIdentity(req);
  if (!id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: tid } = await params;
  const buf = Buffer.from(await req.arrayBuffer());
  const fileName = req.nextUrl.searchParams.get("fileName") || "file";
  const mimeType = req.nextUrl.searchParams.get("mimeType") || "application/octet-stream";
  const r = await uploadMyFile(tid, id.ownerIds, { authorId: id.ownerId, authorName: id.contactName }, { buf, fileName, mimeType });
  if ("error" in r) return NextResponse.json(r, { status: r.error === "not_found" ? 404 : r.error === "empty_file" ? 400 : 500 });
  return NextResponse.json(r);
}
