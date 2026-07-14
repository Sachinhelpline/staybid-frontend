// v342 — Circle Marketplace Phase M3: Model-4 B2B exchange DEMAND-side browse.
//
//   GET /api/circle/model4/listings[?city=Y]
//     → every ACTIVE (status='listed'), future-dated B2B listing on the exchange,
//       cheapest-ask first. Each row carries a buyer-facing money split
//       (askTotal / fee / sellerNet — the SAME b2bTradeSplit the D2 checkout +
//       verify + settlement use, so preview == charge == settlement). Unit # +
//       hotel name/city are side-loaded (NO PostgREST FK embed — none exists).
//
// PUBLIC / AUTH-OPTIONAL — unlike /api/b2b/marketplace (D3, auth-required, hidden
// behind the partner dashboard), the M3 marketplace shows the exchange BEFORE
// sign-in (the customer picks a listing, then /auth on Buy). When a Bearer token
// IS present, the caller's OWN cross-pool listings are excluded (you can't buy
// your own inventory). No token → the full listed feed.
//
// BROWSE ONLY — the Buy button routes to the D2 checkout+verify flow, which
// re-validates listing='listed' + block='owned' + seller match, so a stale row
// is always buy-safe.

import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_H, decodeJwt } from "@/lib/sb-server";
import { resolveOwnerIdsCrossPool } from "@/lib/partner/owner-ids";
import { b2bTradeSplit } from "@/lib/b2b/engine";

export const dynamic = "force-dynamic";

function auth(req: NextRequest): { userId?: string; phone?: string; email?: string } {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const p = token ? decodeJwt(token) : null;
  return { userId: p?.id || p?.user_id || p?.sub, phone: p?.phone, email: p?.email };
}

const idList = (ids: string[]) => ids.map((x) => encodeURIComponent(x)).join(",");
const todayISO = () => new Date().toISOString().slice(0, 10);
const noStore = { headers: { "Cache-Control": "no-store" } };

export async function GET(req: NextRequest) {
  const { userId, phone, email } = auth(req);

  // Auth-optional: exclude the caller's OWN listings only when signed in.
  let ownerIds: string[] = [];
  if (userId) {
    try { ownerIds = await resolveOwnerIdsCrossPool(userId, phone, email); } catch { ownerIds = []; }
  }

  // ACTIVE, future-dated — cheapest ask first.
  let q = `status=eq.listed&date_to=gt.${todayISO()}&select=*&order=ask_total.asc&limit=120`;
  if (ownerIds.length) q += `&seller_user_id=not.in.(${idList(ownerIds)})`;

  let listings: any[] = [];
  try {
    const r = await fetch(`${SB_URL}/rest/v1/b2b_listings?${q}`, { headers: SB_H });
    listings = r.ok ? await r.json().catch(() => []) : [];
  } catch { listings = []; }
  if (!Array.isArray(listings) || !listings.length) return NextResponse.json({ listings: [] }, noStore);

  // Side-load unit # + hotel name/city (no PostgREST FK embed — none exists).
  const unitIds = Array.from(new Set(listings.map((l) => String(l.unit_id)).filter(Boolean)));
  const hotelIds = Array.from(new Set(listings.map((l) => String(l.hotel_id)).filter(Boolean)));
  const unitNo: Record<string, string> = {};
  const hotelMeta: Record<string, { name: string; city: string }> = {};
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
        `${SB_URL}/rest/v1/hotels?id=in.(${idList(hotelIds)})&select=id,name,city`,
        { headers: SB_H },
      );
      (await h.json().catch(() => [])).forEach((x: any) => {
        hotelMeta[x.id] = { name: x.name || x.id, city: x.city || "" };
      });
    }
  } catch { /* enrichment is best-effort */ }

  let rows = listings.map((l) => {
    const meta = hotelMeta[l.hotel_id] || { name: null, city: "" };
    const split = b2bTradeSplit({
      askPerNight: Number(l.ask_per_night),
      nights: Number(l.nights),
      feePct: Number(l.platform_fee_pct),
      buyTotal: Number(l.buy_total),
    });
    return {
      ...l,
      unit_number: unitNo[l.unit_id] || null,
      hotel_name: meta.name,
      hotel_city: meta.city,
      split,
    };
  });

  // Optional in-memory city filter (side-loaded, so cannot filter server-side).
  const city = (new URL(req.url).searchParams.get("city") || "").trim().toLowerCase();
  if (city && city !== "all") {
    rows = rows.filter((r) => String(r.hotel_city || "").toLowerCase() === city);
  }

  return NextResponse.json({ listings: rows.slice(0, 60) }, noStore);
}
