// GET /api/admin/verification/pending
// v126.3 — vp_requests uses snake_case columns (created_at, hotel_id, etc.)
// Previous version queried order=createdAt.desc which PostgREST rejected →
// empty response → admin verification queue showed 0 even with 42 pending.
import { NextResponse } from "next/server";
import { SB_URL, SB_KEY } from "@/lib/sb";

export const dynamic = "force-dynamic";

const SB_H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` };

export async function GET() {
  // Pull pending verification requests + side-load hotel + customer names
  const requests = await fetch(
    `${SB_URL}/rest/v1/vp_requests?select=*&status=eq.pending&order=created_at.desc&limit=300`,
    { headers: SB_H },
  ).then((r) => (r.ok ? r.json() : []));

  const list: any[] = Array.isArray(requests) ? requests : [];

  // Side-loads
  const hotelIds = Array.from(new Set(list.map((r) => r.hotel_id).filter(Boolean)));
  const custIds = Array.from(new Set(list.map((r) => r.customer_id).filter(Boolean)));
  const [hotels, users] = await Promise.all([
    hotelIds.length
      ? fetch(`${SB_URL}/rest/v1/hotels?id=in.(${hotelIds.join(",")})&select=id,name,city`, { headers: SB_H }).then((r) => (r.ok ? r.json() : []))
      : Promise.resolve([]),
    custIds.length
      ? fetch(`${SB_URL}/rest/v1/users?id=in.(${custIds.join(",")})&select=id,name,phone,email`, { headers: SB_H }).then((r) => (r.ok ? r.json() : []))
      : Promise.resolve([]),
  ]);

  const hotelById: Record<string, any> = {};
  for (const h of hotels) hotelById[h.id] = h;
  const userById: Record<string, any> = {};
  for (const u of users) userById[u.id] = u;

  const enriched = list.map((r) => ({
    ...r,
    hotel: hotelById[r.hotel_id] || null,
    customer: userById[r.customer_id] || null,
    // Back-compat aliases for the existing UI columns
    createdAt: r.created_at,
    hotelId: r.hotel_id,
    customerId: r.customer_id,
    dueBy: r.due_by,
  }));

  return NextResponse.json({ pending: enriched, total: enriched.length });
}
