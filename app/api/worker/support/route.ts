// HQ Support Desk — worker surface. Raise + list tickets on the unified HQ store.
import { NextRequest, NextResponse } from "next/server";
import { workerIdentity } from "@/lib/support/identity";
import { listMyTickets, createMyTicket } from "@/lib/support/desk";

export async function GET(req: NextRequest) {
  const id = await workerIdentity(req);
  if (!id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(await listMyTickets(id.ownerIds));
}
export async function POST(req: NextRequest) {
  const id = await workerIdentity(req);
  if (!id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const r = await createMyTicket(id, body);
  if ("error" in r) return NextResponse.json(r, { status: r.error === "subject_required" ? 400 : 500 });
  return NextResponse.json(r);
}
