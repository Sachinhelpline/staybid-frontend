// HQ Support Desk — worker surface: signed download for an HQ-attached file.
import { NextRequest, NextResponse } from "next/server";
import { workerIdentity } from "@/lib/support/identity";
import { signMyFile } from "@/lib/support/desk";

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
