// Admin Holds dashboard API — list bid_holds + acceptance_windows with
// filters, plus quick stats (active count, $ locked, expiring in 24h).
//
// GET  /api/admin/holds?status=...&hotelId=...&search=...&limit=200
//      Returns { holds, windows, stats }
//
// PATCH /api/admin/holds  body { bidId, action: "force_expire" | "force_complete" | "force_cancel" }
//      Admin override — manually set a hold's status.

import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_H, SB_READ } from "@/lib/sb";

async function sbGet(path: string) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: SB_READ });
  if (!r.ok) return [];
  return r.json();
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const status   = searchParams.get("status");   // active | completed | expired | cancelled | all
  const hotelId  = searchParams.get("hotelId");
  const search   = searchParams.get("search");
  const limit    = Math.min(500, Number(searchParams.get("limit") || 200));

  try {
    let path = `bid_holds?order=created_at.desc&limit=${limit}`;
    if (status && status !== "all") path += `&status=eq.${status}`;
    if (hotelId)                    path += `&hotel_id=eq.${encodeURIComponent(hotelId)}`;

    let holds = (await sbGet(path)) as any[];

    if (search) {
      const s = search.toLowerCase();
      holds = holds.filter((h) =>
        h.bid_id?.toLowerCase().includes(s) ||
        h.hotel_name?.toLowerCase().includes(s) ||
        h.customer_id?.toLowerCase().includes(s)
      );
    }

    // Customer name lookup — join via users.id (max 100 to keep req cheap)
    const customerIds = Array.from(new Set(holds.map((h) => h.customer_id).filter(Boolean))).slice(0, 100);
    let users: any[] = [];
    if (customerIds.length) {
      const inList = customerIds.map((i) => `"${i}"`).join(",");
      users = (await sbGet(`users?id=in.(${encodeURIComponent(inList)})&select=id,name,phone,email`)) as any[];
    }
    const byId: Record<string, any> = {};
    for (const u of users) byId[u.id] = u;
    holds = holds.map((h) => ({ ...h, customer: byId[h.customer_id] || null }));

    // Stats
    const now = Date.now();
    const day = 24 * 3600 * 1000;
    const activeHolds = holds.filter((h) => h.status === "active");
    const stats = {
      total:        holds.length,
      active:       activeHolds.length,
      completed:    holds.filter((h) => h.status === "completed").length,
      expired:      holds.filter((h) => h.status === "expired").length,
      cancelled:    holds.filter((h) => h.status === "cancelled").length,
      locked_value: activeHolds.reduce((s, h) => s + Number(h.hold_amount || 0), 0),
      total_value:  activeHolds.reduce((s, h) => s + Number(h.total_amount || 0), 0),
      expiring_24h: activeHolds.filter((h) => {
        const exp = new Date(h.expires_at).getTime();
        return exp > now && exp - now < day;
      }).length,
    };

    // Active acceptance windows (smaller list)
    const windows = (await sbGet(`bid_acceptance_windows?status=eq.active&order=accepted_at.desc&limit=50`)) as any[];

    return NextResponse.json({ holds, windows, stats });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { bidId, action } = await req.json();
    if (!bidId || !action) return NextResponse.json({ error: "bidId + action required" }, { status: 400 });
    const map: Record<string, string> = {
      force_expire:   "expired",
      force_complete: "completed",
      force_cancel:   "cancelled",
    };
    const newStatus = map[action];
    if (!newStatus) return NextResponse.json({ error: "Unknown action" }, { status: 400 });

    const r = await fetch(
      `${SB_URL}/rest/v1/bid_holds?bid_id=eq.${encodeURIComponent(bidId)}`,
      { method: "PATCH", headers: SB_H, body: JSON.stringify({ status: newStatus }) }
    );
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      return NextResponse.json({ error: d?.message || "Update failed" }, { status: 500 });
    }
    const data = await r.json().catch(() => []);
    return NextResponse.json({ ok: true, hold: (data as any[])[0] || null });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
