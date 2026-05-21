// v170 — Guest CRM profiles (partner panel, Phase 3).
//
//   GET   ?hotelId=...  → saved guest profiles (tags / VIP / notes)
//   PATCH               → upsert a profile by (hotel_id, guest_key)
//
// Stay history is aggregated client-side from bids + reservations +
// folios. This route only persists the CRM extras. Degrades gracefully
// until migrations/2026-05-21-guest-profiles.sql is applied.
//
import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_H, SB_H_REPRESENT, sbSelect, decodeJwt, genId } from "@/lib/sb-server";
import { resolveOwnerIdsCrossPool } from "@/lib/partner/owner-ids";

export const dynamic = "force-dynamic";

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

export async function GET(req: NextRequest) {
  const owned = await ownedHotelIds(req);
  if (!owned) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const hotelId = new URL(req.url).searchParams.get("hotelId");
  if (!hotelId || !owned.ids.includes(hotelId))
    return NextResponse.json({ error: "hotelId required / not yours" }, { status: 403 });

  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/guest_profiles?hotel_id=eq.${encodeURIComponent(hotelId)}&select=*`,
      { headers: SB_H }
    );
    if (!r.ok) return NextResponse.json({ profiles: [], provisioned: false });
    const rows = await r.json().catch(() => []);
    return NextResponse.json({ profiles: Array.isArray(rows) ? rows : [], provisioned: true });
  } catch {
    return NextResponse.json({ profiles: [], provisioned: false });
  }
}

export async function PATCH(req: NextRequest) {
  const owned = await ownedHotelIds(req);
  if (!owned) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: any = {};
  try { body = await req.json(); } catch {}
  const { hotelId, guestKey } = body;
  if (!hotelId || !guestKey)
    return NextResponse.json({ error: "hotelId, guestKey required" }, { status: 400 });
  if (!owned.ids.includes(hotelId))
    return NextResponse.json({ error: "Not your hotel" }, { status: 403 });

  // Keep a stable id across upserts so merge-duplicates updates in place.
  const existing = await sbSelect(
    `guest_profiles?hotel_id=eq.${encodeURIComponent(hotelId)}&guest_key=eq.${encodeURIComponent(guestKey)}&select=id`
  ).catch(() => []);
  const row = {
    id: existing?.[0]?.id || genId("gst"),
    hotel_id: hotelId,
    guest_key: guestKey,
    name: body.name ?? null,
    phone: body.phone ?? null,
    email: body.email ?? null,
    tags: Array.isArray(body.tags) ? body.tags : [],
    vip: !!body.vip,
    note: body.note ?? null,
    updated_by: owned.userId,
    updated_at: new Date().toISOString(),
  };

  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/guest_profiles?on_conflict=hotel_id,guest_key`,
      {
        method: "POST",
        headers: { ...SB_H_REPRESENT, Prefer: "return=representation,resolution=merge-duplicates" },
        body: JSON.stringify(row),
      }
    );
    const txt = await r.text();
    if (!r.ok) {
      if (r.status === 404 || /does not exist/i.test(txt))
        return NextResponse.json(
          { error: "Guest CRM table not provisioned yet. Apply migrations/2026-05-21-guest-profiles.sql." },
          { status: 412 }
        );
      throw new Error(txt);
    }
    const j = txt ? JSON.parse(txt) : [];
    return NextResponse.json({ ok: true, profile: Array.isArray(j) ? j[0] : j });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Save failed" }, { status: 500 });
  }
}
