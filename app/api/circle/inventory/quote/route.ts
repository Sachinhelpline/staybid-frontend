// v327 — Circle Phase C1: Model 3 pre-buy QUOTE (read-only, no charge, no write).
//
// POST /api/circle/inventory/quote  Body: { unitId, from, to, resalePricePerNight? }
//   → verifies the caller OWNS the physical unit, derives roomId + hotelId, and
//     returns the Pricing-Spine pre-buy quote (wholesale buy + suggested retail
//     + fee + investor net). Purely informational — nothing is stored or charged.
//
// Auth: partner Bearer JWT → cross-pool owner ids (same resolver as circle-units).

import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_H, decodeJwt } from "@/lib/sb-server";
import { resolveOwnerIdsCrossPool } from "@/lib/partner/owner-ids";
import { quoteInventoryBlock } from "@/lib/inventory/quote";
import { resaleMargin, MAX_BLOCK_NIGHTS, PLATFORM_RESALE_FEE_PCT_DEFAULT } from "@/lib/inventory/engine";

export const dynamic = "force-dynamic";

function auth(req: NextRequest): { userId?: string; phone?: string; email?: string } {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const p = token ? decodeJwt(token) : null;
  return { userId: p?.id || p?.user_id || p?.sub, phone: p?.phone, email: p?.email };
}

// Fetch a unit and confirm the caller owns it.
async function ownedUnit(unitId: string, ownerIds: string[]): Promise<any | null> {
  if (!unitId || !ownerIds.length) return null;
  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/hotel_room_units?id=eq.${encodeURIComponent(unitId)}&select=id,hotelId,roomId,owner_user_id,status`,
      { headers: SB_H },
    );
    if (!r.ok) return null;
    const rows = await r.json().catch(() => []);
    const u = Array.isArray(rows) ? rows[0] : null;
    if (!u || !ownerIds.map(String).includes(String(u.owner_user_id))) return null;
    return u;
  } catch { return null; }
}

export async function POST(req: NextRequest) {
  const { userId, phone, email } = auth(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: any;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const unitId = String(body?.unitId || "");
  const from = String(body?.from || "").slice(0, 10);
  const to = String(body?.to || "").slice(0, 10);
  if (!unitId) return NextResponse.json({ error: "unitId required" }, { status: 400 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || to <= from) {
    return NextResponse.json({ error: "Valid from < to dates required" }, { status: 400 });
  }

  const ownerIds = await resolveOwnerIdsCrossPool(userId, phone, email);
  const unit = await ownedUnit(unitId, ownerIds);
  if (!unit) return NextResponse.json({ error: "Forbidden — not your unit" }, { status: 403 });

  const quote = await quoteInventoryBlock({ roomId: String(unit.roomId), from, to });
  if (!quote) {
    return NextResponse.json(
      { error: `Couldn't price this range (max ${MAX_BLOCK_NIGHTS} nights, needs a live rate).` },
      { status: 422 },
    );
  }

  // Optional: if the investor typed a resale price, show their margin at it.
  let atResale: ReturnType<typeof resaleMargin> | null = null;
  const rp = Number(body?.resalePricePerNight);
  if (Number.isFinite(rp) && rp > 0) {
    atResale = resaleMargin({
      resalePerNight: rp,
      buyPerNight: quote.avgBuyPerNight,
      nights: quote.nights,
      feePct: quote.feePct,
    });
  }

  return NextResponse.json({
    ok: true,
    unitId,
    roomId: unit.roomId,
    hotelId: unit.hotelId,
    feePctDefault: PLATFORM_RESALE_FEE_PCT_DEFAULT,
    quote,
    atResale,
  });
}
