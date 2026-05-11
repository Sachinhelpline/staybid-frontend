// Persistent acceptance-window state — replaces the localStorage-only
// timer from Phase 3. Backend now has the truth: when hotel accepts a
// bid, we insert a row with expires_at = accepted_at + window_min. The
// AcceptedBidTimer component reads from here on every fresh device.
//
// GET   /api/acceptance-windows                  — current user's windows
// GET   /api/acceptance-windows?bidId=X          — single
// POST  /api/acceptance-windows                  — start a window
// PATCH /api/acceptance-windows                  — mark warned / paid / cancelled

import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_H, SB_READ, userFromReq } from "@/lib/sb";

async function sbGet(path: string) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: SB_READ });
  if (!r.ok) return [];
  return r.json();
}

export async function GET(req: NextRequest) {
  const user = userFromReq(req);
  if (!user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const bidId = searchParams.get("bidId");
  const ids   = searchParams.get("bidIds");

  try {
    if (bidId) {
      const rows = await sbGet(`bid_acceptance_windows?bid_id=eq.${encodeURIComponent(bidId)}&customer_id=eq.${encodeURIComponent(user.id)}`);
      return NextResponse.json({ window: (rows as any[])[0] || null });
    }
    if (ids) {
      const list = ids.split(",").filter(Boolean).slice(0, 200);
      if (!list.length) return NextResponse.json({ windows: [] });
      const inList = list.map((i) => `"${i}"`).join(",");
      const rows = await sbGet(`bid_acceptance_windows?bid_id=in.(${encodeURIComponent(inList)})&customer_id=eq.${encodeURIComponent(user.id)}`);
      return NextResponse.json({ windows: rows });
    }
    const rows = await sbGet(`bid_acceptance_windows?customer_id=eq.${encodeURIComponent(user.id)}&order=accepted_at.desc&limit=100`);
    return NextResponse.json({ windows: rows });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// POST { bidId, hotelId, expiresAt, windowMin }
//   Idempotent — if a window already exists for this bidId, no-op.
export async function POST(req: NextRequest) {
  const user = userFromReq(req);
  if (!user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await req.json();
    if (!body?.bidId || !body?.hotelId || !body?.expiresAt) {
      return NextResponse.json({ error: "bidId, hotelId, expiresAt required" }, { status: 400 });
    }
    const existing = await sbGet(`bid_acceptance_windows?bid_id=eq.${encodeURIComponent(body.bidId)}&select=bid_id,status,expires_at`);
    if ((existing as any[]).length > 0) {
      return NextResponse.json({ ok: true, idempotent: true, window: (existing as any[])[0] });
    }
    const row = {
      bid_id:                body.bidId,
      hotel_id:              body.hotelId,
      customer_id:           user.id,
      expires_at:            body.expiresAt,
      acceptance_window_min: Number(body.windowMin || 15),
      status:                "active",
    };
    const r = await fetch(`${SB_URL}/rest/v1/bid_acceptance_windows`, {
      method: "POST",
      headers: { ...SB_H, Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify(row),
    });
    const data = await r.json();
    if (!r.ok) return NextResponse.json({ error: data?.message || "Save failed" }, { status: 500 });
    return NextResponse.json({ ok: true, window: (data as any[])[0] || data });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// PATCH { bidId, action: "warned" | "paid" | "cancelled" }
export async function PATCH(req: NextRequest) {
  const user = userFromReq(req);
  if (!user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { bidId, action } = await req.json();
    if (!bidId || !action) return NextResponse.json({ error: "bidId + action required" }, { status: 400 });
    const patch: Record<string, any> = {};
    if (action === "warned")        patch.warned_at = new Date().toISOString();
    else if (action === "paid")     patch.status = "paid";
    else if (action === "cancelled") patch.status = "cancelled";
    else return NextResponse.json({ error: "Unknown action" }, { status: 400 });

    const r = await fetch(
      `${SB_URL}/rest/v1/bid_acceptance_windows?bid_id=eq.${encodeURIComponent(bidId)}&customer_id=eq.${encodeURIComponent(user.id)}`,
      { method: "PATCH", headers: SB_H, body: JSON.stringify(patch) }
    );
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      return NextResponse.json({ error: d?.message || "Update failed" }, { status: 500 });
    }
    const data = await r.json().catch(() => []);
    return NextResponse.json({ ok: true, window: (data as any[])[0] || null });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
