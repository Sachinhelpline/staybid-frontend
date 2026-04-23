import { NextRequest, NextResponse } from "next/server";
import { authUserId, sbSelect, sbUpdate } from "@/lib/sb-server";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const customerId = authUserId(req);
  if (!customerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const bids = await sbSelect(`bids?id=eq.${id}&select=*`);
  const bid = bids[0];
  if (!bid) return NextResponse.json({ error: "Bid not found" }, { status: 404 });
  if (bid.customerId !== customerId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const updated = await sbUpdate(
      "bids",
      `id=eq.${id}`,
      { status: "ACCEPTED" }
    );
    return NextResponse.json({ bid: updated, accepted: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Accept failed" }, { status: 500 });
  }
}
