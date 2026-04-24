// Returns room unit assignments for a list of bid IDs (customer-facing).
// Used by /my-bids and /bookings pages to display the allocated room number.
import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_H, decodeJwt } from "@/lib/sb-server";

export const dynamic = "force-dynamic";

function auth(req: NextRequest): { userId?: string } {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const p = token ? decodeJwt(token) : null;
  return { userId: p?.id || p?.user_id || p?.sub };
}

export async function POST(req: NextRequest) {
  const { userId } = auth(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: any = {};
  try { body = await req.json(); } catch {}
  const bidIds: string[] = Array.isArray(body?.bidIds) ? body.bidIds.filter(Boolean) : [];
  if (!bidIds.length) return NextResponse.json({ assignments: {} });

  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/bid_unit_assignments?bidId=in.(${bidIds.join(",")})&select=bidId,unitId,unitNumber`,
      { headers: SB_H }
    );
    const rows = await r.json();
    const map: Record<string, { unitId: string; unitNumber: string }> = {};
    if (Array.isArray(rows)) {
      for (const x of rows) map[x.bidId] = { unitId: x.unitId, unitNumber: x.unitNumber };
    }
    return NextResponse.json({ assignments: map });
  } catch (e: any) {
    return NextResponse.json({ assignments: {}, warning: e?.message });
  }
}
