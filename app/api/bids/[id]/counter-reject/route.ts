import { NextRequest, NextResponse } from "next/server";
import { authUserId, sbSelect, sbUpdate } from "@/lib/sb-server";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const customerId = authUserId(req);
  if (!customerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = params;
  const rows = await sbSelect(`bids?id=eq.${id}&select=id,customerId`);
  const bid = rows[0];
  if (!bid) return NextResponse.json({ error: "Bid not found" }, { status: 404 });
  if (bid.customerId !== customerId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const updated = await sbUpdate("bids", `id=eq.${id}`, { status: "REJECTED" });
    return NextResponse.json({ bid: updated, rejected: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: 500 });
  }
}
