// Circle-operator per-unit listing management — Phase 3c.
//
// A circle investor owns specific PHYSICAL rooms (`hotel_room_units` where
// `owner_user_id` = the investor) on a StayBid-operated hotel. Each such unit
// is its own Airbnb-style customer listing (Phase 3b), so the operator needs to
// manage its commercial layer: nightly price, MRP, title, view label, amenities,
// photos, and whether it's listed at all.
//
//   GET  /api/partner/circle-units?hotelId=X
//     → every unit in the hotel the caller owns, ordered by roomNumber. Used to
//       (re)hydrate the "My Rooms" tab after an edit.
//
//   PATCH /api/partner/circle-units
//     Body: { hotelId, unitId, price_override?, mrp_override?, title?,
//             view_label?, amenities?, photos?, is_listed?, autopilot_mode? }
//     autopilot_mode (Phase A): 'auto'|'hybrid'|'manual' — this owner's per-room
//       auto-accept mode; null|""|"inherit" clears it → inherit the hotel-level
//       hotels.autopilot_mode. So one investor's mode never touches other rooms.
//     Updates ONLY the whitelisted listing fields on ONE unit the caller owns.
//     Ownership is re-verified against the unit's owner_user_id every write —
//     an operator can never touch another owner's room.
//
// Auth: partner Bearer JWT → cross-pool owner ids (same resolver as
// /api/partner/hotel). Never writes owner_user_id / circle_bundle_id / hotelId /
// roomId / roomNumber / status (system-owned).

import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_H, SB_H_REPRESENT, decodeJwt } from "@/lib/sb-server";
import { resolveOwnerIdsCrossPool } from "@/lib/partner/owner-ids";
import { otaCapPrice } from "@/lib/pricing/ota-cap";

export const dynamic = "force-dynamic";

function auth(req: NextRequest): { userId?: string; phone?: string; email?: string } {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const p = token ? decodeJwt(token) : null;
  return { userId: p?.id || p?.user_id || p?.sub, phone: p?.phone, email: p?.email };
}

// Fetch a unit and confirm the caller owns it. Returns the row or null.
async function ownedUnit(unitId: string, ownerIds: string[]): Promise<any | null> {
  if (!unitId || !ownerIds.length) return null;
  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/hotel_room_units?id=eq.${encodeURIComponent(unitId)}&select=id,hotelId,roomId,owner_user_id`,
      { headers: SB_H },
    );
    if (!r.ok) return null;
    const rows = await r.json().catch(() => []);
    const u = Array.isArray(rows) ? rows[0] : null;
    if (!u) return null;
    if (!ownerIds.map(String).includes(String(u.owner_user_id))) return null;
    return u;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const { userId, phone, email } = auth(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const hotelId = (new URL(req.url).searchParams.get("hotelId") || "").trim();
  if (!hotelId) return NextResponse.json({ error: "hotelId required" }, { status: 400 });

  const ownerIds = await resolveOwnerIdsCrossPool(userId, phone, email);
  const inList = ownerIds.map((i) => encodeURIComponent(i)).join(",");
  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/hotel_room_units?hotelId=eq.${encodeURIComponent(hotelId)}` +
        `&owner_user_id=in.(${inList})&status=eq.active&select=*&order=roomNumber.asc`,
      { headers: SB_H },
    );
    if (!r.ok) return NextResponse.json({ units: [] });
    const units = await r.json().catch(() => []);
    return NextResponse.json({ units: Array.isArray(units) ? units : [] });
  } catch {
    return NextResponse.json({ units: [] });
  }
}

export async function PATCH(req: NextRequest) {
  const { userId, phone, email } = auth(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: any;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const unitId = String(body?.unitId || "");
  if (!unitId) return NextResponse.json({ error: "unitId required" }, { status: 400 });

  const ownerIds = await resolveOwnerIdsCrossPool(userId, phone, email);
  const unit = await ownedUnit(unitId, ownerIds);
  if (!unit) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // Whitelist + coerce. Every field is optional; only provided keys are written.
  const patch: Record<string, any> = {};

  const num = (v: any) => {
    if (v === null || v === "") return null;              // clear override
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : undefined;  // undefined → reject
  };
  let priceCap: { cappedTo: number } | null = null;
  if ("price_override" in body) {
    const v = num(body.price_override);
    if (v === undefined) return NextResponse.json({ error: "price_override must be ≥ 0" }, { status: 400 });
    // v726 — OTA "always cheapest" guard on the owner's flat unit price.
    if (v !== null && v > 0 && unit?.roomId) {
      const capRes = await otaCapPrice(String(unit.roomId), v);
      patch.price_override = capRes.price;
      if (capRes.capped) priceCap = { cappedTo: capRes.price };
    } else {
      patch.price_override = v;
    }
  }
  if ("mrp_override" in body) {
    const v = num(body.mrp_override);
    if (v === undefined) return NextResponse.json({ error: "mrp_override must be ≥ 0" }, { status: 400 });
    patch.mrp_override = v;
  }
  if ("title" in body) patch.title = body.title == null ? null : String(body.title).slice(0, 120);
  if ("view_label" in body) patch.view_label = body.view_label == null ? null : String(body.view_label).slice(0, 80);
  if ("is_listed" in body) patch.is_listed = !!body.is_listed;
  // Phase A — per-unit autopilot. NULL / "" / "inherit" clears the override so
  // the room inherits the hotel-level hotels.autopilot_mode; otherwise one of
  // the 3 known modes. The DB CHECK (hru_autopilot_mode_chk) backstops this.
  if ("autopilot_mode" in body) {
    const v = body.autopilot_mode;
    if (v === null || v === "" || v === "inherit") {
      patch.autopilot_mode = null;
    } else if (v === "auto" || v === "hybrid" || v === "manual") {
      patch.autopilot_mode = v;
    } else {
      return NextResponse.json({ error: "autopilot_mode must be auto | hybrid | manual | inherit" }, { status: 400 });
    }
    patch.autopilot_updated_at = new Date().toISOString();
  }
  if ("amenities" in body) {
    patch.amenities = Array.isArray(body.amenities)
      ? body.amenities.map((a: any) => String(a).slice(0, 60)).slice(0, 24)
      : [];
  }
  if ("photos" in body) {
    patch.photos = Array.isArray(body.photos)
      ? body.photos.map((p: any) => String(p)).filter(Boolean).slice(0, 12)
      : [];
  }

  if (!Object.keys(patch).length) {
    return NextResponse.json({ error: "No editable fields provided" }, { status: 400 });
  }

  try {
    const res = await fetch(
      `${SB_URL}/rest/v1/hotel_room_units?id=eq.${encodeURIComponent(unitId)}`,
      { method: "PATCH", headers: SB_H_REPRESENT, body: JSON.stringify(patch) },
    );
    if (!res.ok) {
      const err = await res.text();
      return NextResponse.json({ error: err || "Update failed" }, { status: 500 });
    }
    const saved = await res.json().catch(() => []);
    return NextResponse.json({
      unit: Array.isArray(saved) ? saved[0] : saved,
      ...(priceCap
        ? { priceCapped: true, listedPrice: priceCap.cappedTo, warning: `Your price was above the current lowest online rate, so it was set to ₹${priceCap.cappedTo}/night to keep StayBid the cheapest. (Never below your cost.)` }
        : {}),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Update failed" }, { status: 500 });
  }
}
