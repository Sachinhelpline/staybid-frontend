// Returns room unit assignments for a list of bid IDs (customer-facing).
// Used by /my-bids and /bookings pages to display the allocated room number(s).
//
// STAY-LIFECYCLE-OPS-01 — CRYPTOGRAPHIC customer authority. The previous
// handler derived the caller from a DECODED (unverified) JWT, so a forged
// id/sub could read another guest's physical room number. Identity now comes
// ONLY from the established verified customer authority
// (lib/auth/customer-verify.ts: HS256 signature verified against the configured
// secrets; decode-only / forged / alg:none / Firebase RS256 tokens FAIL CLOSED →
// 401). The verified primary id is reconciled to its legitimate identity twins
// via resolveUserIds (prefix twin / phone variants / email), and ONLY bids owned
// by those ids are resolved.
//
// Reads the authoritative bid_unit_assignment_lines (ACTIVE lines, slot order)
// so a multi-room booking lists every allocated room; falls back to the legacy
// PK=bidId row when the lines table is not applied yet. Response keeps the
// original single-unit shape ({unitId, unitNumber} = slot 1) and adds
// `unitNumbers` (all slots). Read-only.
import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_H, resolveUserIds } from "@/lib/sb-server";
import { verifiedCustomerFromReq } from "@/lib/auth/customer-verify";
import { projectDisplayUnits } from "@/lib/stay/unit-assignments";

export const runtime = "nodejs"; // jsonwebtoken verify is server-only; never edge
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const customer = verifiedCustomerFromReq(req);
  if (!customer) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: any = {};
  try { body = await req.json(); } catch {}
  const bidIds: string[] = Array.isArray(body?.bidIds) ? body.bidIds.filter(Boolean).map(String) : [];
  if (!bidIds.length) return NextResponse.json({ assignments: {} });

  try {
    // Only this VERIFIED customer's own bids may be resolved (never another guest's room).
    const customerIds = await resolveUserIds(customer.id, customer.phone || undefined, customer.email || undefined);
    const own = await fetch(
      `${SB_URL}/rest/v1/bids?id=in.(${bidIds.map(encodeURIComponent).join(",")})&customerId=in.(${customerIds.map(encodeURIComponent).join(",")})&select=id`,
      { headers: SB_H, cache: "no-store" }
    ).then((r) => r.json()).catch(() => []);
    const ownIds: string[] = Array.isArray(own) ? own.map((b: any) => String(b.id)) : [];
    if (!ownIds.length) return NextResponse.json({ assignments: {} });
    const inList = ownIds.map(encodeURIComponent).join(",");

    const map: Record<string, { unitId: string; unitNumber: string; unitNumbers: string[] }> = {};
    // STAY-LIFECYCLE-OPS-01 M6 — read ACTIVE (live stay) AND COMPLETED (finished
    // stay) lines so a CHECKED_OUT guest still sees the FINAL room(s) they occupied.
    // projectDisplayUnits picks active-if-any-else-completed per bid, never a
    // superseded/released (transferred-away) room.
    const lRes = await fetch(
      `${SB_URL}/rest/v1/bid_unit_assignment_lines?bid_id=in.(${inList})&status=in.(active,completed)&select=bid_id,unit_id,unit_number,slot,status&order=slot.asc`,
      { headers: SB_H, cache: "no-store" }
    );
    if (lRes.ok) {
      const rows = await lRes.json();
      if (Array.isArray(rows)) {
        const projected = projectDisplayUnits(rows);
        for (const bidId of Object.keys(projected)) {
          const units = projected[bidId];
          if (!units.length) continue;
          map[bidId] = { unitId: units[0].unitId, unitNumber: units[0].unitNumber, unitNumbers: units.map((u) => u.unitNumber) };
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
