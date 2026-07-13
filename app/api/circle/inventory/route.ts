// v327 — Circle Phase C1: Model 3 inventory blocks (owner-scoped).
//
//   GET    /api/circle/inventory[?hotelId=X]
//     → the caller's inventory blocks (enriched with unit # + hotel name).
//   POST   /api/circle/inventory
//     Body: { unitId, from, to, resalePricePerNight? }
//     → creates a DRAFT block on a unit the caller OWNS. Re-quotes the Spine
//       server-side to FREEZE buy_price / buy_total / fee (client never sets ₹).
//       NO charge, NO room_blocks hold, NO consumer exposure — that's C2/C3.
//   DELETE /api/circle/inventory?id=X
//     → deletes an un-purchased (draft|quoted) block the caller owns.
//
// Auth: partner Bearer JWT → cross-pool owner ids. investor_user_id is stamped
// as the UNIT's owner_user_id so the block and the unit always agree on ownership.

import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_H, SB_H_REPRESENT, decodeJwt, genId } from "@/lib/sb-server";
import { resolveOwnerIdsCrossPool } from "@/lib/partner/owner-ids";
import { quoteInventoryBlock } from "@/lib/inventory/quote";
import { nightsBetween, MAX_BLOCK_NIGHTS } from "@/lib/inventory/engine";

export const dynamic = "force-dynamic";

function auth(req: NextRequest): { userId?: string; phone?: string; email?: string } {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const p = token ? decodeJwt(token) : null;
  return { userId: p?.id || p?.user_id || p?.sub, phone: p?.phone, email: p?.email };
}

async function ownedUnit(unitId: string, ownerIds: string[]): Promise<any | null> {
  if (!unitId || !ownerIds.length) return null;
  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/hotel_room_units?id=eq.${encodeURIComponent(unitId)}&select=id,hotelId,roomId,roomNumber,owner_user_id,status`,
      { headers: SB_H },
    );
    if (!r.ok) return null;
    const rows = await r.json().catch(() => []);
    const u = Array.isArray(rows) ? rows[0] : null;
    if (!u || !ownerIds.map(String).includes(String(u.owner_user_id))) return null;
    return u;
  } catch { return null; }
}

const idList = (ids: string[]) => ids.map((x) => encodeURIComponent(x)).join(",");
const todayISO = () => new Date().toISOString().slice(0, 10);

export async function GET(req: NextRequest) {
  const { userId, phone, email } = auth(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const ownerIds = await resolveOwnerIdsCrossPool(userId, phone, email);
  if (!ownerIds.length) return NextResponse.json({ blocks: [] });

  const hotelId = (new URL(req.url).searchParams.get("hotelId") || "").trim();
  let q = `investor_user_id=in.(${idList(ownerIds)})&select=*&order=created_at.desc&limit=300`;
  if (hotelId) q += `&hotel_id=eq.${encodeURIComponent(hotelId)}`;

  let blocks: any[] = [];
  try {
    const r = await fetch(`${SB_URL}/rest/v1/inventory_blocks?${q}`, { headers: SB_H });
    blocks = r.ok ? await r.json().catch(() => []) : [];
  } catch { blocks = []; }
  if (!Array.isArray(blocks) || !blocks.length) return NextResponse.json({ blocks: [] });

  // Side-load unit # + hotel name (no PostgREST FK embed — none exists).
  const unitIds = Array.from(new Set(blocks.map((b) => String(b.unit_id)).filter(Boolean)));
  const hotelIds = Array.from(new Set(blocks.map((b) => String(b.hotel_id)).filter(Boolean)));
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
    blocks: blocks.map((b) => ({
      ...b,
      unit_number: unitNo[b.unit_id] || null,
      hotel_name: hotelName[b.hotel_id] || null,
    })),
  });
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
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return NextResponse.json({ error: "Valid from/to dates required" }, { status: 400 });
  }
  if (from < todayISO()) return NextResponse.json({ error: "Start date can't be in the past" }, { status: 400 });
  const nights = nightsBetween(from, to);
  if (nights <= 0) return NextResponse.json({ error: "to must be after from" }, { status: 400 });
  if (nights > MAX_BLOCK_NIGHTS) {
    return NextResponse.json({ error: `Max ${MAX_BLOCK_NIGHTS} nights per block` }, { status: 400 });
  }

  const ownerIds = await resolveOwnerIdsCrossPool(userId, phone, email);
  const unit = await ownedUnit(unitId, ownerIds);
  if (!unit) return NextResponse.json({ error: "Forbidden — not your unit" }, { status: 403 });

  // Overlap guard — no two non-terminal blocks on the same unit over the same nights.
  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/inventory_blocks?unit_id=eq.${encodeURIComponent(unitId)}` +
        `&status=not.in.(expired,cancelled,refunded)` +
        `&date_from=lt.${to}&date_to=gt.${from}&select=id&limit=1`,
      { headers: SB_H },
    );
    const clash = r.ok ? await r.json().catch(() => []) : [];
    if (Array.isArray(clash) && clash.length) {
      return NextResponse.json({ error: "These nights overlap an existing block on this room." }, { status: 409 });
    }
  } catch { /* non-fatal — the DB is the final integrity gate */ }

  // Re-quote server-side to FREEZE the wholesale buy + fee (tamper-safe).
  const quote = await quoteInventoryBlock({ roomId: String(unit.roomId), from, to });
  if (!quote) {
    return NextResponse.json({ error: "Couldn't price this range (needs a live rate)." }, { status: 422 });
  }

  const rp = Number(body?.resalePricePerNight);
  const resalePerNight = Number.isFinite(rp) && rp > 0 ? Math.round(rp) : null;

  const row = {
    id: genId("inv"),
    investor_user_id: String(unit.owner_user_id),  // block + unit always agree on ownership
    hotel_id: String(unit.hotelId),
    unit_id: String(unit.id),
    room_id: String(unit.roomId),
    date_from: from,
    date_to: to,
    nights: quote.nights,
    buy_price_per_night: quote.avgBuyPerNight,
    buy_total: quote.buyTotal,
    resale_price_per_night: resalePerNight,
    platform_fee_pct: quote.feePct,
    status: "draft",
    metadata: { suggestedResaleTotal: quote.suggestedResaleTotal, quotedAt: new Date().toISOString() },
    updated_at: new Date().toISOString(),
  };

  try {
    const res = await fetch(`${SB_URL}/rest/v1/inventory_blocks`, {
      method: "POST",
      headers: SB_H_REPRESENT,
      body: JSON.stringify(row),
    });
    if (!res.ok) {
      const err = await res.text();
      return NextResponse.json({ error: "Save failed", detail: err.slice(0, 200) }, { status: 500 });
    }
    const saved = await res.json().catch(() => []);
    return NextResponse.json({ ok: true, block: Array.isArray(saved) ? saved[0] : saved, quote });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Save failed" }, { status: 500 });
  }
}

// v330 (C4) — PATCH: investor toggles PLATFORM BUYBACK protection on a block
// they own. When enabled + unsold, an admin may buy the nights back (StayBid
// takes the unsold-risk off the investor) via /api/admin/circle-inventory.
// Owner-scoped; only meaningful while the block is still commercially live
// (owned|listed) — a sold/expired/refunded block's flag is moot.
export async function PATCH(req: NextRequest) {
  const { userId, phone, email } = auth(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: any = {};
  try { body = await req.json(); } catch { /* empty */ }
  const id = String(body?.id || "").trim();
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  if (typeof body?.buybackEnabled !== "boolean") {
    return NextResponse.json({ error: "buybackEnabled (boolean) required" }, { status: 400 });
  }

  const ownerIds = await resolveOwnerIdsCrossPool(userId, phone, email);
  if (!ownerIds.length) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const idsCsv = idList(ownerIds);

  try {
    const res = await fetch(
      `${SB_URL}/rest/v1/inventory_blocks?id=eq.${encodeURIComponent(id)}` +
        `&status=in.(owned,listed)&investor_user_id=in.(${idsCsv})`,
      {
        method: "PATCH",
        headers: SB_H_REPRESENT,
        body: JSON.stringify({ buyback_enabled: body.buybackEnabled, updated_at: new Date().toISOString() }),
      },
    );
    const rows = res.ok ? await res.json().catch(() => []) : [];
    if (!Array.isArray(rows) || !rows.length) {
      return NextResponse.json({ error: "Block changed — refresh and try again." }, { status: 409 });
    }
    return NextResponse.json({ ok: true, block: rows[0] });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Update failed" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const { userId, phone, email } = auth(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const id = (new URL(req.url).searchParams.get("id") || "").trim();
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const ownerIds = await resolveOwnerIdsCrossPool(userId, phone, email);
  if (!ownerIds.length) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // Only un-purchased (draft|quoted) blocks the caller owns can be deleted.
  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/inventory_blocks?id=eq.${encodeURIComponent(id)}&select=id,investor_user_id,status`,
      { headers: SB_H },
    );
    const rows = r.ok ? await r.json().catch(() => []) : [];
    const b = Array.isArray(rows) ? rows[0] : null;
    if (!b || !ownerIds.map(String).includes(String(b.investor_user_id))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (!["draft", "quoted"].includes(String(b.status))) {
      return NextResponse.json({ error: "Only un-purchased blocks can be deleted." }, { status: 409 });
    }
    const del = await fetch(
      `${SB_URL}/rest/v1/inventory_blocks?id=eq.${encodeURIComponent(id)}&status=in.(draft,quoted)`,
      { method: "DELETE", headers: SB_H },
    );
    if (!del.ok) return NextResponse.json({ error: "Delete failed" }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Delete failed" }, { status: 500 });
  }
}
