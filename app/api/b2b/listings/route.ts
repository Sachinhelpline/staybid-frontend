// v331 — Circle Phase D1: Model 4 B2B exchange listings (owner-scoped).
//
//   GET    /api/b2b/listings[?hotelId=X]
//     → the caller's own B2B listings (enriched with unit # + hotel name),
//       each with a live money split (askTotal / fee / sellerNet / margin).
//   POST   /api/b2b/listings
//     Body: { blockId, askPerNight }
//     → lists an OWNED inventory block (Model 3, status='owned') the caller
//       owns onto the B2B exchange at the seller-set ask. Freezes the platform
//       fee % server-side (tamper-safe); the ask is the seller's to choose (it
//       is their own goods). NO trade, NO charge, NO ownership transfer — D2/D3.
//   DELETE /api/b2b/listings?id=X
//     → withdraws an active (draft|listed) listing the caller owns.
//
// Auth: partner Bearer JWT → cross-pool owner ids. seller_user_id is the block's
// investor_user_id so listing + block + unit always agree on ownership.
//
// D1 writes ONLY `b2b_listings`. `b2b_trades` + `settlement_ledger` are created
// (migration v331) but untouched until D2/D3.

import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_H, SB_H_REPRESENT, decodeJwt, genId } from "@/lib/sb-server";
import { resolveOwnerIdsCrossPool } from "@/lib/partner/owner-ids";
import { b2bTradeSplit, isValidAskPerNight } from "@/lib/b2b/engine";
import { resolveB2bFeeConfig } from "@/lib/b2b/fee-config-store";
import { partnerHotelScope } from "@/lib/partner/hotel-scope";
import { quoteInventoryBlock } from "@/lib/inventory/quote";
import { unitsFreeForRange } from "@/lib/availability";

export const dynamic = "force-dynamic";

function auth(req: NextRequest): { userId?: string; phone?: string; email?: string } {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const p = token ? decodeJwt(token) : null;
  return { userId: p?.id || p?.user_id || p?.sub, phone: p?.phone, email: p?.email };
}

const idList = (ids: string[]) => ids.map((x) => encodeURIComponent(x)).join(",");
const todayISO = () => new Date().toISOString().slice(0, 10);

/** Load an `owned` inventory block the caller owns, or null. */
async function ownedBlock(blockId: string, ownerIds: string[]): Promise<any | null> {
  if (!blockId || !ownerIds.length) return null;
  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/inventory_blocks?id=eq.${encodeURIComponent(blockId)}` +
        `&select=id,investor_user_id,hotel_id,unit_id,room_id,date_from,date_to,nights,buy_total,platform_fee_pct,status`,
      { headers: SB_H },
    );
    if (!r.ok) return null;
    const rows = await r.json().catch(() => []);
    const b = Array.isArray(rows) ? rows[0] : null;
    if (!b || !ownerIds.map(String).includes(String(b.investor_user_id))) return null;
    return b;
  } catch { return null; }
}

export async function GET(req: NextRequest) {
  const { userId, phone, email } = auth(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const ownerIds = await resolveOwnerIdsCrossPool(userId, phone, email);
  if (!ownerIds.length) return NextResponse.json({ listings: [] });

  const hotelId = (new URL(req.url).searchParams.get("hotelId") || "").trim();
  let q = `seller_user_id=in.(${idList(ownerIds)})&select=*&order=created_at.desc&limit=300`;
  if (hotelId) q += `&hotel_id=eq.${encodeURIComponent(hotelId)}`;

  let listings: any[] = [];
  try {
    const r = await fetch(`${SB_URL}/rest/v1/b2b_listings?${q}`, { headers: SB_H });
    listings = r.ok ? await r.json().catch(() => []) : [];
  } catch { listings = []; }
  if (!Array.isArray(listings) || !listings.length) return NextResponse.json({ listings: [] });

  // Side-load unit # + hotel name (no PostgREST FK embed — none exists).
  const unitIds = Array.from(new Set(listings.map((l) => String(l.unit_id)).filter(Boolean)));
  const hotelIds = Array.from(new Set(listings.map((l) => String(l.hotel_id)).filter(Boolean)));
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

  return NextResponse.json({
    listings: listings.map((l) => {
      const split = b2bTradeSplit({
        askPerNight: Number(l.ask_per_night),
        nights: Number(l.nights),
        buyerFeePct: Number(l.buyer_fee_pct),
        sellerFeePct: Number(l.seller_fee_pct),
        buyTotal: Number(l.buy_total),
      });
      return {
        ...l,
        unit_number: unitNo[l.unit_id] || null,
        hotel_name: hotelName[l.hotel_id] || null,
        split,
      };
    }),
  });
}

// ════════════════════════════════════════════════════════════════════════
// v343 — Circle Marketplace Phase M4: hotel-owner B2B SUPPLY listing.
//
// A hotel owner (classic OR operated — anyone in `partnerHotelScope`) lists
// room-nights of their OWN inventory on the B2B exchange WITHOUT a pre-bought
// `inventory_blocks` row (block_id = NULL, unit_id = NULL). The buy_total is
// the owner's Spine FLOOR (`quoteInventoryBlock`) — the wholesale cost basis —
// so the seller-margin math still holds; the fee % is server-frozen. On BUY
// (D2 checkout/verify, hotel_owner branch), a free unit is auto-assigned + a
// NEW buyer `inventory_blocks` block is minted, exactly like the M1 marketplace.
//
// The `uniq_b2b_listing_active_block` partial unique index is on block_id;
// NULLs are distinct in Postgres, so hotel_owner listings never collide there.
// ════════════════════════════════════════════════════════════════════════
async function createHotelOwnerListing(
  req: NextRequest,
  userId: string,
  body: any,
): Promise<NextResponse> {
  const hotelId = String(body?.hotelId || "").trim();
  const roomId = String(body?.roomId || "").trim();
  const dateFrom = String(body?.dateFrom || "").slice(0, 10);
  const dateTo = String(body?.dateTo || "").slice(0, 10);

  if (!hotelId || !roomId || !/^\d{4}-\d{2}-\d{2}$/.test(dateFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) {
    return NextResponse.json({ error: "hotelId, roomId, dateFrom, dateTo required" }, { status: 400 });
  }
  if (dateFrom >= dateTo) {
    return NextResponse.json({ error: "Check-out must be after check-in." }, { status: 400 });
  }
  if (dateTo <= todayISO()) {
    return NextResponse.json({ error: "These dates have passed." }, { status: 409 });
  }
  if (!isValidAskPerNight(body?.askPerNight)) {
    return NextResponse.json({ error: "Enter a valid ask price per night." }, { status: 400 });
  }
  const askPerNight = Math.round(Number(body.askPerNight));

  // Ownership — owned ∪ operated hotels (Circle/host-circle covered).
  const scope = await partnerHotelScope(req);
  if (!scope || !scope.hotelIds.includes(hotelId)) {
    return NextResponse.json({ error: "Forbidden — not your hotel" }, { status: 403 });
  }

  // Room must belong to this hotel.
  try {
    const rr = await fetch(
      `${SB_URL}/rest/v1/rooms?id=eq.${encodeURIComponent(roomId)}` +
        `&hotelId=eq.${encodeURIComponent(hotelId)}&select=id&limit=1`,
      { headers: SB_H },
    );
    const rooms = rr.ok ? await rr.json().catch(() => []) : [];
    if (!Array.isArray(rooms) || !rooms.length) {
      return NextResponse.json({ error: "Room not found for this hotel." }, { status: 404 });
    }
  } catch {
    return NextResponse.json({ error: "Could not verify the room." }, { status: 502 });
  }

  // At least one physical unit must be free for the range (so a buyer can be
  // auto-assigned one at checkout). Fail-open only if the capacity signal is
  // missing — a firm 0 free blocks the listing.
  const avail = await unitsFreeForRange({ hotelId, roomId, from: dateFrom, to: dateTo });
  if (avail && avail.free < 1) {
    return NextResponse.json(
      { error: "No rooms free for these nights — pick different dates." },
      { status: 409 },
    );
  }

  // buy_total = the owner's Spine FLOOR (wholesale cost basis). Client NEVER
  // sets ₹; the seller only chooses the ASK.
  const quote = await quoteInventoryBlock({ roomId, from: dateFrom, to: dateTo });
  if (!quote || quote.buyTotal <= 0) {
    return NextResponse.json({ error: "Couldn't price these nights right now — try again." }, { status: 422 });
  }

  // Freeze BOTH commission % server-side (admin-controlled). Ask is seller-set.
  const fee = await resolveB2bFeeConfig();
  const split = b2bTradeSplit({
    askPerNight,
    nights: quote.nights,
    buyerFeePct: fee.buyerFeePct,
    sellerFeePct: fee.sellerFeePct,
    buyTotal: quote.buyTotal,
  });

  const row = {
    id: genId("b2bl"),
    block_id: null,               // hotel-owner supply — no pre-bought block
    seller_user_id: String(userId),
    hotel_id: hotelId,
    unit_id: null,                // a free unit is auto-assigned to the BUYER at checkout
    room_id: roomId,
    date_from: dateFrom,
    date_to: dateTo,
    nights: split.nights,
    ask_per_night: split.askPerNight,
    ask_total: split.askTotal,
    buy_total: split.buyTotal,
    platform_fee_pct: split.platformFeePct,
    buyer_fee_pct: split.buyerFeePct,
    seller_fee_pct: split.sellerFeePct,
    status: "listed",
    source: "hotel_owner",
    metadata: { listedAt: new Date().toISOString(), spineBuyTotal: quote.buyTotal },
    updated_at: new Date().toISOString(),
  };

  try {
    const res = await fetch(`${SB_URL}/rest/v1/b2b_listings`, {
      method: "POST",
      headers: SB_H_REPRESENT,
      body: JSON.stringify(row),
    });
    if (!res.ok) {
      const err = await res.text();
      return NextResponse.json({ error: "List failed", detail: err.slice(0, 200) }, { status: 500 });
    }
    const saved = await res.json().catch(() => []);
    return NextResponse.json({ ok: true, listing: Array.isArray(saved) ? saved[0] : saved, split });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "List failed" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const { userId, phone, email } = auth(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: any;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  // v343 — Model-4 SUPPLY side: a hotel owner lists their own inventory
  // (no pre-bought block). Distinct branch; the D1 blockId path below is
  // unchanged.
  if (String(body?.source || "").trim() === "hotel_owner") {
    return createHotelOwnerListing(req, userId, body);
  }

  const blockId = String(body?.blockId || "").trim();
  if (!blockId) return NextResponse.json({ error: "blockId required" }, { status: 400 });
  if (!isValidAskPerNight(body?.askPerNight)) {
    return NextResponse.json({ error: "Enter a valid ask price per night." }, { status: 400 });
  }
  const askPerNight = Math.round(Number(body.askPerNight));

  const ownerIds = await resolveOwnerIdsCrossPool(userId, phone, email);
  const block = await ownedBlock(blockId, ownerIds);
  if (!block) return NextResponse.json({ error: "Forbidden — not your block" }, { status: 403 });

  // Only an OWNED block (bought via C2, not consumer-listed/sold) can be B2B-listed.
  if (String(block.status) !== "owned") {
    return NextResponse.json(
      { error: "Only an owned block can be listed on the exchange. Unlist it from the guest feed first." },
      { status: 409 },
    );
  }
  // Can't sell a block whose stay has already ended.
  if (String(block.date_to).slice(0, 10) <= todayISO()) {
    return NextResponse.json({ error: "This block's dates have passed." }, { status: 409 });
  }

  // At most one ACTIVE (draft|listed) B2B listing per block. The partial unique
  // index is the final gate; this is the friendly-error pre-check.
  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/b2b_listings?block_id=eq.${encodeURIComponent(blockId)}` +
        `&status=in.(draft,listed)&select=id&limit=1`,
      { headers: SB_H },
    );
    const clash = r.ok ? await r.json().catch(() => []) : [];
    if (Array.isArray(clash) && clash.length) {
      return NextResponse.json({ error: "This block is already listed on the exchange." }, { status: 409 });
    }
  } catch { /* non-fatal — the unique index is the final gate */ }

  // Freeze BOTH commission % server-side (tamper-safe). The ask is seller-set.
  const fee = await resolveB2bFeeConfig();
  const split = b2bTradeSplit({
    askPerNight,
    nights: Number(block.nights),
    buyerFeePct: fee.buyerFeePct,
    sellerFeePct: fee.sellerFeePct,
    buyTotal: Number(block.buy_total),
  });

  const row = {
    id: genId("b2bl"),
    block_id: String(block.id),
    seller_user_id: String(block.investor_user_id),  // listing + block + unit agree on ownership
    hotel_id: String(block.hotel_id),
    unit_id: String(block.unit_id),
    room_id: String(block.room_id),
    date_from: String(block.date_from).slice(0, 10),
    date_to: String(block.date_to).slice(0, 10),
    nights: split.nights,
    ask_per_night: split.askPerNight,
    ask_total: split.askTotal,
    buy_total: split.buyTotal,
    platform_fee_pct: split.platformFeePct,
    buyer_fee_pct: split.buyerFeePct,
    seller_fee_pct: split.sellerFeePct,
    status: "listed",
    metadata: { listedAt: new Date().toISOString() },
    updated_at: new Date().toISOString(),
  };

  try {
    const res = await fetch(`${SB_URL}/rest/v1/b2b_listings`, {
      method: "POST",
      headers: SB_H_REPRESENT,
      body: JSON.stringify(row),
    });
    if (!res.ok) {
      const err = await res.text();
      // 23505 = the partial unique index caught a race (already listed).
      if (/duplicate key|23505/i.test(err)) {
        return NextResponse.json({ error: "This block is already listed on the exchange." }, { status: 409 });
      }
      return NextResponse.json({ error: "List failed", detail: err.slice(0, 200) }, { status: 500 });
    }
    const saved = await res.json().catch(() => []);
    return NextResponse.json({ ok: true, listing: Array.isArray(saved) ? saved[0] : saved, split });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "List failed" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const { userId, phone, email } = auth(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const id = (new URL(req.url).searchParams.get("id") || "").trim();
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const ownerIds = await resolveOwnerIdsCrossPool(userId, phone, email);
  if (!ownerIds.length) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // Withdraw (soft) an active listing the caller owns — frees the block to
  // re-list. Keeps the row for history; the unique index only guards draft|listed.
  try {
    const res = await fetch(
      `${SB_URL}/rest/v1/b2b_listings?id=eq.${encodeURIComponent(id)}` +
        `&status=in.(draft,listed)&seller_user_id=in.(${idList(ownerIds)})`,
      {
        method: "PATCH",
        headers: SB_H_REPRESENT,
        body: JSON.stringify({ status: "withdrawn", updated_at: new Date().toISOString() }),
      },
    );
    const rows = res.ok ? await res.json().catch(() => []) : [];
    if (!Array.isArray(rows) || !rows.length) {
      return NextResponse.json({ error: "Listing changed — refresh and try again." }, { status: 409 });
    }
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Withdraw failed" }, { status: 500 });
  }
}
