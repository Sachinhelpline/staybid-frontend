// v332 — Circle Phase D2: Model 4 B2B trade history.
//
// GET /api/b2b/trades[?hotelId=X]
//   The caller's B2B exchange trades — as BUYER (blocks they acquired) and as
//   SELLER (blocks they sold). Cross-pool scoped. Side-loads unit # + hotel
//   name (no PostgREST FK embed — none exists). Read-only; the buy flow lives
//   in the checkout/verify routes (a marketplace browse button lands in D3).

import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_H, decodeJwt } from "@/lib/sb-server";
import { resolveOwnerIdsCrossPool } from "@/lib/partner/owner-ids";

export const dynamic = "force-dynamic";

function auth(req: NextRequest): { userId?: string; phone?: string; email?: string } {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const p = token ? decodeJwt(token) : null;
  return { userId: p?.id || p?.user_id || p?.sub, phone: p?.phone, email: p?.email };
}

const idList = (ids: string[]) => ids.map((x) => encodeURIComponent(x)).join(",");

async function fetchTrades(role: "buyer" | "seller", ids: string[], hotelId: string): Promise<any[]> {
  const col = role === "buyer" ? "buyer_user_id" : "seller_user_id";
  let q = `${col}=in.(${idList(ids)})&status=in.(pending_payment,completed)&select=*&order=created_at.desc&limit=200`;
  if (hotelId) q += `&hotel_id=eq.${encodeURIComponent(hotelId)}`;
  try {
    const r = await fetch(`${SB_URL}/rest/v1/b2b_trades?${q}`, { headers: SB_H });
    return r.ok ? await r.json().catch(() => []) : [];
  } catch { return []; }
}

export async function GET(req: NextRequest) {
  const { userId, phone, email } = auth(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const ids = await resolveOwnerIdsCrossPool(userId, phone, email);
  if (!ids.length) return NextResponse.json({ asBuyer: [], asSeller: [] });

  const hotelId = (new URL(req.url).searchParams.get("hotelId") || "").trim();
  const [asBuyer, asSeller] = await Promise.all([
    fetchTrades("buyer", ids, hotelId),
    fetchTrades("seller", ids, hotelId),
  ]);

  // Side-load unit # + hotel name for every trade (no FK embed).
  const all = [...asBuyer, ...asSeller];
  const unitIds = Array.from(new Set(all.map((t) => String(t.unit_id)).filter(Boolean)));
  const hotelIds = Array.from(new Set(all.map((t) => String(t.hotel_id)).filter(Boolean)));
  const unitNo: Record<string, string> = {};
  const hotelName: Record<string, string> = {};
  try {
    if (unitIds.length) {
      const u = await fetch(
        `${SB_URL}/rest/v1/hotel_room_units?id=in.(${idList(unitIds)})&select=id,roomNumber`,
        { headers: SB_H },
      );
      (await u.json().catch(() => [])).forEach((x: any) => { unitNo[x.id] = x.roomNumber || x.id; });
    }
    if (hotelIds.length) {
      const h = await fetch(
        `${SB_URL}/rest/v1/hotels?id=in.(${idList(hotelIds)})&select=id,name`,
        { headers: SB_H },
      );
      (await h.json().catch(() => [])).forEach((x: any) => { hotelName[x.id] = x.name || x.id; });
    }
  } catch { /* enrichment is best-effort */ }

  const enrich = (t: any) => ({
    ...t,
    unit_number: unitNo[t.unit_id] || null,
    hotel_name: hotelName[t.hotel_id] || null,
  });

  return NextResponse.json({
    asBuyer: asBuyer.map(enrich),
    asSeller: asSeller.map(enrich),
  });
}
