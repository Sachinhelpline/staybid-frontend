// v341 — Circle Marketplace Phase M2: Model-3 supply admin.
//
//   GET  /api/admin/circle-supply
//     → every host-circle hotel (owner_type='host_circle'), whether or not it's
//        pre-buy-enabled, enriched with room count + physical-unit count +
//        owned-unit count + the pre-buy window. Ops uses this to flip a
//        provisioned property into browsable Model-3 supply and set the window.
//   POST /api/admin/circle-supply  { hotelId, prebuyEnabled?, windowStart?, windowEnd? }
//        Sets prebuy_enabled and/or the check-in window. Empty-string window =
//        clear that edge (NULL = unbounded). Only host-circle hotels may be set
//        (the 400 guard — pre-buy is operated-only; a classic hotel can never be
//        a Model-3 supply source). Every write logAdminAction'd.
//
// prebuy_enabled is DECOUPLED from approval_status (v336). This surface never
// touches ownerId / owner_type / approval_status — it only governs Model-3
// supply visibility + the window, never the customer-feed gate.
//
// Auth: adminFromReq (Bearer / x-admin-token).

import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_KEY } from "@/lib/sb";
import { adminFromReq, logAdminAction } from "@/lib/admin/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SB_H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" };
const idList = (ids: string[]) => ids.map((x) => encodeURIComponent(x)).join(",");

async function sb(path: string): Promise<any[]> {
  try {
    const r = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: SB_H, cache: "no-store" });
    const j = await r.json().catch(() => []);
    return Array.isArray(j) ? j : [];
  } catch { return []; }
}

const isoDate = (v: any): string | null => {
  const s = String(v || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
};

export async function GET(req: NextRequest) {
  if (!adminFromReq(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Every operated host-circle property — enabled or not — so ops can flip
  // freshly-provisioned drafts into pre-buy supply.
  const hotels = await sb(
    `hotels?owner_type=eq.host_circle` +
      `&select=id,name,city,state,images,prebuy_enabled,prebuy_window_start,prebuy_window_end,approval_status,status` +
      `&order=name.asc&limit=300`,
  );
  if (!hotels.length) return NextResponse.json({ hotels: [] });

  const hotelIds = hotels.map((h: any) => String(h.id));
  const [rooms, units] = await Promise.all([
    sb(`rooms?hotelId=in.(${idList(hotelIds)})&select=id,hotelId`),
    sb(`hotel_room_units?hotelId=in.(${idList(hotelIds)})&select=id,hotelId,owner_user_id,status`),
  ]);

  const roomCount: Record<string, number> = {};
  for (const r of rooms) roomCount[String(r.hotelId)] = (roomCount[String(r.hotelId)] || 0) + 1;

  const unitCount: Record<string, number> = {};
  const ownedUnitCount: Record<string, number> = {};
  for (const u of units) {
    const hid = String(u.hotelId);
    if (String(u.status || "active") === "active") {
      unitCount[hid] = (unitCount[hid] || 0) + 1;
      if (u.owner_user_id) ownedUnitCount[hid] = (ownedUnitCount[hid] || 0) + 1;
    }
  }

  const firstImage = (imgs: any): string | null => {
    if (Array.isArray(imgs)) return imgs.find((x) => typeof x === "string" && x) || null;
    if (typeof imgs === "string" && imgs.trim()) {
      try { const a = JSON.parse(imgs); if (Array.isArray(a)) return a[0] || null; } catch { /* raw */ }
      return imgs;
    }
    return null;
  };

  const out = hotels.map((h: any) => {
    const hid = String(h.id);
    return {
      id: hid,
      name: h.name,
      city: h.city || null,
      state: h.state || null,
      image: firstImage(h.images),
      prebuyEnabled: !!h.prebuy_enabled,
      windowStart: isoDate(h.prebuy_window_start),
      windowEnd: isoDate(h.prebuy_window_end),
      approvalStatus: h.approval_status || null,
      status: h.status || null,
      rooms: roomCount[hid] || 0,
      units: unitCount[hid] || 0,
      ownedUnits: ownedUnitCount[hid] || 0,
    };
  });

  return NextResponse.json({ hotels: out });
}

export async function POST(req: NextRequest) {
  const admin = adminFromReq(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: any = {};
  try { body = await req.json(); } catch { /* empty */ }
  const hotelId = String(body?.hotelId || "").trim();
  if (!hotelId) return NextResponse.json({ error: "hotelId required" }, { status: 400 });

  // Only operated host-circle properties may be pre-buy supply — this is the
  // guard that stops an arbitrary classic hotel from becoming a Model-3 source.
  const rows = await sb(`hotels?id=eq.${encodeURIComponent(hotelId)}&select=id,owner_type`);
  const hotel = rows[0];
  if (!hotel) return NextResponse.json({ error: "Hotel not found" }, { status: 404 });
  if (String(hotel.owner_type) !== "host_circle") {
    return NextResponse.json({ error: "Only host-circle (StayBid-operated) properties can be pre-buy supply." }, { status: 400 });
  }

  const patch: Record<string, any> = {};

  if (typeof body?.prebuyEnabled === "boolean") {
    patch.prebuy_enabled = body.prebuyEnabled;
  }

  // Window edges: undefined = leave as-is; "" or null = clear (NULL); date = set.
  if ("windowStart" in body) {
    const raw = body.windowStart;
    if (raw === "" || raw === null) patch.prebuy_window_start = null;
    else {
      const d = isoDate(raw);
      if (!d) return NextResponse.json({ error: "windowStart must be YYYY-MM-DD" }, { status: 400 });
      patch.prebuy_window_start = d;
    }
  }
  if ("windowEnd" in body) {
    const raw = body.windowEnd;
    if (raw === "" || raw === null) patch.prebuy_window_end = null;
    else {
      const d = isoDate(raw);
      if (!d) return NextResponse.json({ error: "windowEnd must be YYYY-MM-DD" }, { status: 400 });
      patch.prebuy_window_end = d;
    }
  }

  // Reject an inverted window (start >= end) — resolve against the final state.
  const finalStart = "prebuy_window_start" in patch ? patch.prebuy_window_start
    : (rows[0] as any)?.prebuy_window_start ?? null;
  const finalEnd = "prebuy_window_end" in patch ? patch.prebuy_window_end
    : (rows[0] as any)?.prebuy_window_end ?? null;
  if (finalStart && finalEnd && String(finalStart) >= String(finalEnd)) {
    return NextResponse.json({ error: "Window start must be before window end." }, { status: 400 });
  }

  if (!Object.keys(patch).length) {
    return NextResponse.json({ error: "Nothing to update (send prebuyEnabled and/or windowStart/windowEnd)." }, { status: 400 });
  }

  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/hotels?id=eq.${encodeURIComponent(hotelId)}&owner_type=eq.host_circle`,
      { method: "PATCH", headers: { ...SB_H, Prefer: "return=representation" }, body: JSON.stringify(patch) },
    );
    const updated = r.ok ? (await r.json().catch(() => []))?.[0] : null;
    if (!updated) {
      const err = await r.text().catch(() => "");
      return NextResponse.json({ error: "Update failed.", detail: err.slice(0, 160) }, { status: 502 });
    }
    logAdminAction({ admin, action: "circle_supply.set", targetType: "hotel", targetId: hotelId, details: patch });
    return NextResponse.json({
      ok: true,
      hotel: {
        id: String(updated.id),
        prebuyEnabled: !!updated.prebuy_enabled,
        windowStart: isoDate(updated.prebuy_window_start),
        windowEnd: isoDate(updated.prebuy_window_end),
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e).slice(0, 160) }, { status: 502 });
  }
}
