// v333 — Circle Phase D3: Model 4 B2B marketplace (browse OTHER investors' listings).
//
//   GET /api/b2b/marketplace[?hotelId=X&city=Y]
//     → every ACTIVE (status='listed'), future-dated B2B listing that the caller
//       does NOT own, cheapest-ask first. Each row carries a buyer-facing money
//       split (askTotal / fee / sellerNet — same b2bTradeSplit used at checkout
//       + settlement, so preview == charge == settlement). Unit # + hotel name +
//       city are side-loaded (NO PostgREST FK embed — none exists).
//
// Auth: partner Bearer JWT → cross-pool owner ids (so a cross-identity buyer's
// OWN listings are excluded regardless of which of their user-ids listed them).
// This is BROWSE ONLY — the buy button routes to the D2 checkout+verify flow,
// which re-validates listing='listed' + block='owned' + seller match, so a stale
// marketplace row is always buy-safe.

import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_H, decodeJwt } from "@/lib/sb-server";
import { resolveOwnerIdsCrossPool } from "@/lib/partner/owner-ids";
import { b2bTradeSplit } from "@/lib/b2b/engine";
import { isLaunchHotel } from "@/lib/launch/curation";

export const dynamic = "force-dynamic";

function auth(req: NextRequest): { userId?: string; phone?: string; email?: string } {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const p = token ? decodeJwt(token) : null;
  return { userId: p?.id || p?.user_id || p?.sub, phone: p?.phone, email: p?.email };
}

const idList = (ids: string[]) => ids.map((x) => encodeURIComponent(x)).join(",");
const todayISO = () => new Date().toISOString().slice(0, 10);

export async function GET(req: NextRequest) {
  const { userId, phone, email } = auth(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const ownerIds = await resolveOwnerIdsCrossPool(userId, phone, email);
  // Guard: empty ownerIds would make `not.in.()` an invalid PostgREST filter.
  if (!ownerIds.length) return NextResponse.json({ listings: [] });

  const sp = new URL(req.url).searchParams;
  const hotelId = (sp.get("hotelId") || "").trim();

  // ACTIVE, future-dated, NOT the caller's own — cheapest ask first.
  let q =
    `status=eq.listed&date_to=gt.${todayISO()}` +
    `&seller_user_id=not.in.(${idList(ownerIds)})` +
    `&select=*&order=ask_total.asc&limit=120`;
  if (hotelId) q += `&hotel_id=eq.${encodeURIComponent(hotelId)}`;

  let listings: any[] = [];
  try {
    const r = await fetch(`${SB_URL}/rest/v1/b2b_listings?${q}`, { headers: SB_H });
    listings = r.ok ? await r.json().catch(() => []) : [];
  } catch { listings = []; }
  // v536 — launch curation: only exchange listings on curated launch hotels.
  // Fail-open (curation off → unchanged).
  if (Array.isArray(listings)) listings = listings.filter((l) => isLaunchHotel(l.hotel_id));
  if (!Array.isArray(listings) || !listings.length) return NextResponse.json({ listings: [] });

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
    const md = l.metadata && typeof l.metadata === "object" ? l.metadata : {};
    const split = b2bTradeSplit({
      askPerNight: Number(l.ask_per_night),
      nights: Number(l.nights),
      buyerFeePct: Number(l.buyer_fee_pct),
      sellerFeePct: Number(l.seller_fee_pct),
      buyTotal: Number(l.buy_total),
    });
    // Display name/city come from the hotels table; for Circle-sourced listings
    // (synthetic hotel_id) they live in metadata (title/city). `...l` already
    // spreads own_per_night, price_multiplier + the full tour metadata.
    return {
      ...l,
      unit_number: unitNo[l.unit_id] || null,
      hotel_name: meta.name || md.title || md.hotel_name || null,
      hotel_city: meta.city || md.city || "",
      split,
    };
  });

  // Optional in-memory city filter (side-loaded, so cannot filter server-side).
  const city = (sp.get("city") || "").trim().toLowerCase();
  if (city && city !== "all") {
    rows = rows.filter((r) => String(r.hotel_city || "").toLowerCase() === city);
  }

  return NextResponse.json({ listings: rows.slice(0, 60) });
}
