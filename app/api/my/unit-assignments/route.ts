// Returns room unit assignments for a list of bid IDs (customer-facing).
// Used by /my-bids and /bookings pages to display the allocated room number(s).
//
// STAY-LIFECYCLE-OPS-01 — reads the authoritative bid_unit_assignment_lines
// (ACTIVE lines, slot order) so a multi-room booking lists every allocated
// room; falls back to the legacy PK=bidId row when the lines table is not
// applied yet. Response keeps the original single-unit shape ({unitId,
// unitNumber} = slot 1) and adds `unitNumbers` (all slots). Read-only; the
// caller only ever receives rows for the bid ids it asked about, scoped to its
// own verified customer identity below.
import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_H, authPayload, resolveUserIds } from "@/lib/sb-server";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const payload = authPayload(req);
  const primaryId = payload?.id || payload?.user_id || payload?.sub;
  if (!primaryId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: any = {};
  try { body = await req.json(); } catch {}
  const bidIds: string[] = Array.isArray(body?.bidIds) ? body.bidIds.filter(Boolean).map(String) : [];
  if (!bidIds.length) return NextResponse.json({ assignments: {} });

  try {
    // Only this customer's own bids may be resolved (never another guest's room).
    const customerIds = await resolveUserIds(primaryId, payload?.phone);
    const own = await fetch(
      `${SB_URL}/rest/v1/bids?id=in.(${bidIds.map(encodeURIComponent).join(",")})&customerId=in.(${customerIds.join(",")})&select=id`,
      { headers: SB_H, cache: "no-store" }
    ).then((r) => r.json()).catch(() => []);
    const ownIds: string[] = Array.isArray(own) ? own.map((b: any) => String(b.id)) : [];
    if (!ownIds.length) return NextResponse.json({ assignments: {} });
    const inList = ownIds.map(encodeURIComponent).join(",");

    const map: Record<string, { unitId: string; unitNumber: string; unitNumbers: string[] }> = {};
    const lRes = await fetch(
      `${SB_URL}/rest/v1/bid_unit_assignment_lines?bid_id=in.(${inList})&status=eq.active&select=bid_id,unit_id,unit_number,slot&order=slot.asc`,
      { headers: SB_H, cache: "no-store" }
    );
    if (lRes.ok) {
      const rows = await lRes.json();
      if (Array.isArray(rows)) {
        for (const x of rows) {
          const cur = map[x.bid_id];
          if (!cur) map[x.bid_id] = { unitId: String(x.unit_id), unitNumber: String(x.unit_number), unitNumbers: [String(x.unit_number)] };
          else cur.unitNumbers.push(String(x.unit_number));
        }
      }
      return NextResponse.json({ assignments: map });
    }
    // Legacy fallback (lines table not applied yet).
    const r = await fetch(
      `${SB_URL}/rest/v1/bid_unit_assignments?bidId=in.(${inList})&select=bidId,unitId,unitNumber`,
      { headers: SB_H, cache: "no-store" }
    );
    const rows = await r.json();
    if (Array.isArray(rows)) {
      for (const x of rows) map[x.bidId] = { unitId: x.unitId, unitNumber: x.unitNumber, unitNumbers: [String(x.unitNumber)] };
    }
    return NextResponse.json({ assignments: map });
  } catch (e: any) {
    return NextResponse.json({ assignments: {}, warning: e?.message });
  }
}
