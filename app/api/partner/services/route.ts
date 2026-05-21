// v176 — Partner service entitlements (Phase 1).
//
//   GET   ?hotelId=...  → which subscription services are unlocked +
//                         this hotel's pending access requests
//   POST  { hotelId, serviceKey, kind }  → raise an access request
//                         kind: activate | free_trial
//
// Owner-scoped. Degrades gracefully until 2026-05-21-hotel-services.sql.
//
import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_H, SB_H_REPRESENT, sbSelect, decodeJwt, genId } from "@/lib/sb-server";
import { resolveOwnerIdsCrossPool } from "@/lib/partner/owner-ids";
import { isSubscriptionService } from "@/lib/partner/services";

export const dynamic = "force-dynamic";

async function owned(req: NextRequest): Promise<{ ids: string[]; userId: string } | null> {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const p = decodeJwt(token);
  if (!p?.id) return null;
  const ownerIds = await resolveOwnerIdsCrossPool(
    p.id, p.phone || req.headers.get("x-phone") || "", p.email || req.headers.get("x-email") || ""
  );
  if (!ownerIds.length) return { ids: [], userId: p.id };
  const hotels = await sbSelect(`hotels?ownerId=in.(${ownerIds.join(",")})&select=id,name`);
  return { ids: (Array.isArray(hotels) ? hotels : []).map((h: any) => h.id), userId: p.id };
}

export async function GET(req: NextRequest) {
  const o = await owned(req);
  if (!o) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const qHotel = new URL(req.url).searchParams.get("hotelId");
  const hotelId = qHotel && o.ids.includes(qHotel) ? qHotel : o.ids[0];
  if (!hotelId)
    return NextResponse.json({ entitlements: {}, requests: [], provisioned: true });

  try {
    const [svcRes, reqRes] = await Promise.all([
      fetch(`${SB_URL}/rest/v1/hotel_services?hotel_id=eq.${encodeURIComponent(hotelId)}&select=*`, { headers: SB_H }),
      fetch(`${SB_URL}/rest/v1/service_requests?hotel_id=eq.${encodeURIComponent(hotelId)}&status=eq.pending&select=service_key,kind,status`, { headers: SB_H }),
    ]);
    if (!svcRes.ok) return NextResponse.json({ entitlements: {}, requests: [], provisioned: false });
    const rows = await svcRes.json().catch(() => []);
    const reqs = reqRes.ok ? await reqRes.json().catch(() => []) : [];
    const now = Date.now();
    const entitlements: Record<string, any> = {};
    for (const r of Array.isArray(rows) ? rows : []) {
      const expired = r.expires_at && new Date(r.expires_at).getTime() < now;
      entitlements[r.service_key] = {
        unlocked: !expired,
        accessType: r.access_type,
        plan: r.plan || null,
        expiresAt: r.expires_at || null,
        expired: !!expired,
      };
    }
    return NextResponse.json({ entitlements, requests: Array.isArray(reqs) ? reqs : [], provisioned: true });
  } catch {
    return NextResponse.json({ entitlements: {}, requests: [], provisioned: false });
  }
}

export async function POST(req: NextRequest) {
  const o = await owned(req);
  if (!o) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: any = {};
  try { body = await req.json(); } catch {}
  const { hotelId, serviceKey } = body;
  if (!hotelId || !o.ids.includes(hotelId))
    return NextResponse.json({ error: "Not your hotel" }, { status: 403 });
  if (!isSubscriptionService(String(serviceKey)))
    return NextResponse.json({ error: "Invalid service" }, { status: 400 });
  const kind = body.kind === "free_trial" ? "free_trial" : "activate";

  // hotel name for the admin queue
  const hotels = await sbSelect(`hotels?id=eq.${encodeURIComponent(hotelId)}&select=name`).catch(() => []);
  const hotelName = hotels?.[0]?.name || null;

  const row = {
    id: genId("svcreq"),
    hotel_id: hotelId, hotel_name: hotelName,
    service_key: serviceKey, kind, status: "pending",
    note: body.note ? String(body.note) : null,
  };
  try {
    // ignore-duplicates → a pending request already exists, treat as success
    const r = await fetch(`${SB_URL}/rest/v1/service_requests`, {
      method: "POST",
      headers: { ...SB_H_REPRESENT, Prefer: "return=representation,resolution=ignore-duplicates" },
      body: JSON.stringify(row),
    });
    const txt = await r.text();
    if (!r.ok) {
      if (r.status === 404 || /does not exist/i.test(txt))
        return NextResponse.json({ error: "Service system not provisioned yet. Apply migrations/2026-05-21-hotel-services.sql." }, { status: 412 });
      throw new Error(txt);
    }
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Request failed" }, { status: 500 });
  }
}
