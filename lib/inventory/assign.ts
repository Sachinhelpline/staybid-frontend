// ════════════════════════════════════════════════════════════════════════
// v340 — Circle Marketplace Phase M1: free-unit auto-assign (server only).
//
// Model 3 pre-buy MARKETPLACE (demand side): an investor browses a
// StayBid-OPERATED host-circle property and pre-buys a date range WITHOUT
// already owning a physical unit there. `inventory_blocks.unit_id` +
// `investor_user_id` are NOT NULL, so the marketplace checkout must
// AUTO-ASSIGN a free physical unit at buy time (and verify then STAMPS
// `hotel_room_units.owner_user_id = buyer` so dashboard access + the block's
// ownership line up — the SAME unit-ownership scope union the whole partner
// panel keys off).
//
// THE SAFETY RULE (locked with Sachin): prefer a buyer-owned-free unit →
// then an unowned-free unit (owner_user_id NULL) → NEVER another investor's
// unit. The verify owner-stamp PATCH is additionally guarded with
// or=(owner_user_id.is.null,owner_user_id.in.(<buyerIds>)) so a race can never
// overwrite a co-investor's ownership.
//
// This is the M1 twist vs C1/C2, which required the caller to ALREADY OWN the
// unit (`ownedUnit`). Here the buyer owns nothing yet.
// ════════════════════════════════════════════════════════════════════════

import { SB_URL, SB_H } from "@/lib/sb-server";
import { getOccupations, unitsFreeForRange, rangesOverlap } from "@/lib/availability";

export interface FreeUnit {
  unitId: string;
  roomNumber: string;
}

/**
 * Find a free physical unit in (hotelId, roomId) for [from, to) to assign to
 * a Model-3 marketplace buyer. Returns null when the room is full, has no
 * physical units, has no capacity signal, or only co-investor-owned units are
 * left (never take those).
 *
 * @param buyerIds the caller's cross-pool owner ids (from
 *        resolveOwnerIdsCrossPool) — a buyer-OWNED free unit is preferred so a
 *        repeat buyer re-uses their own unit instead of consuming an unowned one.
 */
export async function assignFreeUnit(params: {
  hotelId: string;
  roomId: string;
  from: string; // YYYY-MM-DD inclusive
  to: string;   // YYYY-MM-DD exclusive
  buyerIds: string[];
}): Promise<FreeUnit | null> {
  const hotelId = String(params.hotelId || "");
  const roomId = String(params.roomId || "");
  const from = String(params.from || "").slice(0, 10);
  const to = String(params.to || "").slice(0, 10);
  const buyerIds = (params.buyerIds || []).map(String);
  if (!hotelId || !roomId || !from || !to || from >= to) return null;

  // 0) Capacity gate — never assign into an oversold room. null (no capacity
  //    signal) here means the room has no physical units AND no quantity → we
  //    cannot assign a physical unit for a NOT-NULL block, so fail.
  const avail = await unitsFreeForRange({ hotelId, roomId, from, to });
  if (!avail || avail.free < 1) return null;

  // 1) All active physical units for this room category.
  let units: any[] = [];
  try {
    const ur = await fetch(
      `${SB_URL}/rest/v1/hotel_room_units?hotelId=eq.${encodeURIComponent(hotelId)}` +
        `&roomId=eq.${encodeURIComponent(roomId)}&status=eq.active&select=id,roomNumber,owner_user_id`,
      { headers: SB_H },
    );
    const rows = ur.ok ? await ur.json().catch(() => []) : [];
    if (Array.isArray(rows)) units = rows;
  } catch { /* handled below */ }
  if (!units.length) return null; // M1 requires physical units to assign

  const taken = new Set<string>();

  // 2) Units taken by customer occupations (accepted/confirmed bids +
  //    room_blocks incl. inventory holds) overlapping the range.
  try {
    const occs = await getOccupations({ hotelId, roomId, from, to });
    for (const o of occs) {
      if (!o.assignedUnitId) continue;
      if (o.roomId && o.roomId !== roomId) continue;
      if (rangesOverlap(o.fromDate, o.toDate, from, to)) taken.add(String(o.assignedUnitId));
    }
  } catch { /* best-effort — the inventory_blocks pass below is the firm guard */ }

  // 3) Units reserved by OTHER non-terminal inventory_blocks over the range
  //    (a pending_payment block has no room_blocks hold yet, so occupations
  //    miss it — this closes the concurrent-buyer gap).
  try {
    const br = await fetch(
      `${SB_URL}/rest/v1/inventory_blocks?hotel_id=eq.${encodeURIComponent(hotelId)}` +
        `&room_id=eq.${encodeURIComponent(roomId)}` +
        `&status=not.in.(expired,cancelled,refunded)` +
        `&date_from=lt.${to}&date_to=gt.${from}&select=unit_id`,
      { headers: SB_H },
    );
    const blocks = br.ok ? await br.json().catch(() => []) : [];
    if (Array.isArray(blocks)) for (const b of blocks) if (b.unit_id) taken.add(String(b.unit_id));
  } catch { /* best-effort */ }

  // 4) Prefer buyer-owned-free → unowned-free → NEVER another investor's unit.
  const buyerSet = new Set(buyerIds);
  const free = units.filter((u) => !taken.has(String(u.id)));
  const buyerOwnedFree = free.filter((u) => u.owner_user_id && buyerSet.has(String(u.owner_user_id)));
  const unownedFree = free.filter((u) => !u.owner_user_id);
  const pick = buyerOwnedFree[0] || unownedFree[0] || null;
  if (!pick) return null; // only co-investor-owned units remain → never take them

  return { unitId: String(pick.id), roomNumber: String(pick.roomNumber || pick.id) };
}
