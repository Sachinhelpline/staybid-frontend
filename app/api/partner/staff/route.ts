// v170 — Staff & Roles management (partner panel, Phase 3).
//
//   GET    ?hotelId=...  → staff list (no PIN hashes)
//   POST                 → create a staff login (returns the login code)
//   PATCH                → edit name / role / active / PIN
//   DELETE ?id=...       → remove a staff login
//
// Owner-scoped (the partner who owns the hotel). Degrades gracefully
// until migrations/2026-05-21-hotel-staff.sql is applied.
//
import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { SB_URL, SB_H, SB_H_REPRESENT, sbSelect, decodeJwt, genId } from "@/lib/sb-server";
import { resolveOwnerIdsCrossPool } from "@/lib/partner/owner-ids";

export const dynamic = "force-dynamic";

const ROLES = new Set(["manager", "front_desk", "housekeeping"]);

export function pinHash(pin: string, id: string) {
  return crypto.createHash("sha256").update(`${pin}:${id}:staybid`).digest("hex");
}
function makeLoginCode() {
  const alpha = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous chars
  let s = "";
  for (let i = 0; i < 8; i++) s += alpha[Math.floor(Math.random() * alpha.length)];
  return s;
}

async function ownedHotelIds(req: NextRequest): Promise<{ ids: string[]; userId: string } | null> {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const payload = decodeJwt(token);
  if (!payload?.id) return null;
  const ownerIds = await resolveOwnerIdsCrossPool(
    payload.id,
    payload.phone || req.headers.get("x-phone") || "",
    payload.email || req.headers.get("x-email") || ""
  );
  if (!ownerIds.length) return { ids: [], userId: payload.id };
  const hotels = await sbSelect(`hotels?ownerId=in.(${ownerIds.join(",")})&select=id`);
  return { ids: (Array.isArray(hotels) ? hotels : []).map((h: any) => h.id), userId: payload.id };
}

const strip = (s: any) => ({
  id: s.id, hotel_id: s.hotel_id, name: s.name, role: s.role,
  login_code: s.login_code, active: s.active,
  created_at: s.created_at, last_login_at: s.last_login_at,
});

export async function GET(req: NextRequest) {
  const owned = await ownedHotelIds(req);
  if (!owned) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const hotelId = new URL(req.url).searchParams.get("hotelId");
  if (!hotelId || !owned.ids.includes(hotelId))
    return NextResponse.json({ error: "hotelId required / not yours" }, { status: 403 });
  try {
    const r = await fetch(`${SB_URL}/rest/v1/hotel_staff?hotel_id=eq.${encodeURIComponent(hotelId)}&select=*&order=created_at.desc`, { headers: SB_H });
    if (!r.ok) return NextResponse.json({ staff: [], provisioned: false });
    const rows = await r.json().catch(() => []);
    return NextResponse.json({ staff: (Array.isArray(rows) ? rows : []).map(strip), provisioned: true });
  } catch {
    return NextResponse.json({ staff: [], provisioned: false });
  }
}

export async function POST(req: NextRequest) {
  const owned = await ownedHotelIds(req);
  if (!owned) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: any = {};
  try { body = await req.json(); } catch {}
  const { hotelId } = body;
  if (!hotelId || !owned.ids.includes(hotelId))
    return NextResponse.json({ error: "Not your hotel" }, { status: 403 });
  if (!String(body.name || "").trim()) return NextResponse.json({ error: "Name required" }, { status: 400 });
  const pin = String(body.pin || "").trim();
  if (!/^\d{4,6}$/.test(pin)) return NextResponse.json({ error: "PIN must be 4–6 digits" }, { status: 400 });
  const role = ROLES.has(String(body.role)) ? String(body.role) : "front_desk";

  const id = genId("stf");
  const row = {
    id, hotel_id: hotelId, owner_id: owned.userId,
    name: String(body.name).trim(), role,
    login_code: makeLoginCode(), pin_hash: pinHash(pin, id),
    active: true, created_by: owned.userId,
  };

  async function ins(r: any) {
    return fetch(`${SB_URL}/rest/v1/hotel_staff`, { method: "POST", headers: SB_H_REPRESENT, body: JSON.stringify(r) });
  }
  let res = await ins(row);
  if (!res.ok) {
    const txt = await res.text();
    if (res.status === 404 || /does not exist/i.test(txt))
      return NextResponse.json({ error: "Staff table not provisioned yet. Apply migrations/2026-05-21-hotel-staff.sql." }, { status: 412 });
    // login_code collision — retry once with a fresh code
    if (/duplicate key|login_code/i.test(txt)) {
      row.login_code = makeLoginCode();
      res = await ins(row);
    }
    if (!res.ok) return NextResponse.json({ error: (await res.text()) || "Create failed" }, { status: 500 });
  }
  const j = await res.json().catch(() => []);
  return NextResponse.json({ ok: true, staff: strip(Array.isArray(j) ? j[0] : j) });
}

export async function PATCH(req: NextRequest) {
  const owned = await ownedHotelIds(req);
  if (!owned) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: any = {};
  try { body = await req.json(); } catch {}
  if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const existing = await sbSelect(`hotel_staff?id=eq.${encodeURIComponent(body.id)}&select=id,hotel_id`);
  if (!existing?.[0]) return NextResponse.json({ error: "Staff not found" }, { status: 404 });
  if (!owned.ids.includes(existing[0].hotel_id))
    return NextResponse.json({ error: "Not your staff" }, { status: 403 });

  const patch: any = {};
  if (body.name !== undefined) patch.name = String(body.name || "").trim();
  if (body.role !== undefined && ROLES.has(String(body.role))) patch.role = String(body.role);
  if (typeof body.active === "boolean") patch.active = body.active;
  if (body.pin !== undefined) {
    const pin = String(body.pin).trim();
    if (!/^\d{4,6}$/.test(pin)) return NextResponse.json({ error: "PIN must be 4–6 digits" }, { status: 400 });
    patch.pin_hash = pinHash(pin, body.id);
  }
  if (!Object.keys(patch).length) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });

  try {
    const r = await fetch(`${SB_URL}/rest/v1/hotel_staff?id=eq.${encodeURIComponent(body.id)}`, {
      method: "PATCH", headers: SB_H_REPRESENT, body: JSON.stringify(patch),
    });
    if (!r.ok) throw new Error(await r.text());
    const j = await r.json().catch(() => []);
    return NextResponse.json({ ok: true, staff: strip(Array.isArray(j) ? j[0] : j) });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Update failed" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const owned = await ownedHotelIds(req);
  if (!owned) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const existing = await sbSelect(`hotel_staff?id=eq.${encodeURIComponent(id)}&select=id,hotel_id`);
  if (!existing?.[0]) return NextResponse.json({ error: "Staff not found" }, { status: 404 });
  if (!owned.ids.includes(existing[0].hotel_id))
    return NextResponse.json({ error: "Not your staff" }, { status: 403 });

  try {
    const r = await fetch(`${SB_URL}/rest/v1/hotel_staff?id=eq.${encodeURIComponent(id)}`, { method: "DELETE", headers: SB_H });
    if (!r.ok) throw new Error(await r.text());
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Delete failed" }, { status: 500 });
  }
}
