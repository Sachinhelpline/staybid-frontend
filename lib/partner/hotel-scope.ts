// v315 — shared partner hotel-scope resolver (Channel Manager Phase 1).
// v326 — extended with partnerUnitScope (Channel Manager Phase B: per-unit
//         OTA cross-listing for StayBid Circle investors).
//
// THE MERGE RULE: every channel-manager route must scope by the UNION of
//   • hotels the caller OWNS  (hotels.ownerId, cross-pool resolved), and
//   • hotels the caller OPERATES (owns ≥1 physical unit — the StayBid Circle
//     + host-circle pools reach /partner/dashboard this way).
// Scoping by ownerId alone silently locks Circle partners out of the channel
// manager for their operated properties.
//
// THE UNIT RULE (Phase B): on an OPERATED hotel the caller may own only SOME
// physical units. A per-unit OTA feed (ota_feeds."unitId") must be manageable
// only by the unit's owner. The classic full-hotel owner (hotels.ownerId) has
// full access — they manage hotel-level AND every unit-level feed.
import { NextRequest } from "next/server";
import { sbSelect, decodeJwt } from "@/lib/sb-server";
import { resolveOwnerIdsCrossPool } from "@/lib/partner/owner-ids";
import { resolveOperatedHotelIds } from "@/lib/partner/operator-access";

export interface PartnerScope {
  hotelIds: string[];
  userId: string;
}

/** hotelId → owned unit ids (unit-scoped investor) OR null (full-hotel owner). */
export type UnitsByHotel = Record<string, string[] | null>;

export interface PartnerUnitScope {
  hotelIds: string[];
  userId: string;
  ownerIds: string[];
  /**
   * Per in-scope hotel:
   *   • null      → the caller is the classic full-hotel owner (hotels.ownerId).
   *                 They manage hotel-level AND any unit-level feed.
   *   • string[]  → the caller is a unit-scoped investor. They manage ONLY
   *                 feeds attached to a unit id in this list; never hotel-level.
   */
  unitsByHotel: UnitsByHotel;
  /** Detail rows for the units the caller owns (for the picker UI), by hotel. */
  ownedUnitsByHotel: Record<string, Array<{ id: string; roomId: string; roomNumber?: string }>>;
}

interface ScopeParts {
  userId: string;
  ownerIds: string[];
  ownedHotelIds: string[];    // hotels.ownerId ∈ ownerIds → full-hotel access
  operatedHotelIds: string[]; // owns ≥1 unit, not the ownerId → unit-scoped
}

async function resolveScopeParts(req: NextRequest): Promise<ScopeParts | null> {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const payload = decodeJwt(token);
  if (!payload?.id) return null;

  const ownerIds = await resolveOwnerIdsCrossPool(
    payload.id,
    payload.phone || req.headers.get("x-phone") || "",
    payload.email || req.headers.get("x-email") || ""
  ).catch(() => [payload.id]);

  const ownedSet = new Set<string>();
  const operatedSet = new Set<string>();
  if (ownerIds.length) {
    try {
      const hotels = await sbSelect(`hotels?ownerId=in.(${ownerIds.join(",")})&select=id`);
      (Array.isArray(hotels) ? hotels : []).forEach((h: any) => {
        if (h?.id) ownedSet.add(String(h.id));
      });
    } catch { /* ignore */ }
    try {
      const operated = await resolveOperatedHotelIds(ownerIds);
      operated.forEach((id) => operatedSet.add(id));
    } catch { /* ignore */ }
  }
  // A hotel the caller both owns AND operates counts as OWNED (full access).
  ownedSet.forEach((id) => operatedSet.delete(id));

  return {
    userId: payload.id,
    ownerIds,
    ownedHotelIds: Array.from(ownedSet),
    operatedHotelIds: Array.from(operatedSet),
  };
}

/** Resolve the caller's full hotel scope (owned ∪ operated). null = no/bad token. */
export async function partnerHotelScope(req: NextRequest): Promise<PartnerScope | null> {
  const parts = await resolveScopeParts(req);
  if (!parts) return null;
  const set = new Set<string>([...parts.ownedHotelIds, ...parts.operatedHotelIds]);
  return { hotelIds: Array.from(set), userId: parts.userId };
}

/**
 * Resolve the caller's scope AT UNIT GRANULARITY (Phase B).
 * Owned hotels → full access (unitsByHotel[h] = null).
 * Operated-only hotels → unit-scoped (unitsByHotel[h] = [owned unit ids]).
 */
export async function partnerUnitScope(req: NextRequest): Promise<PartnerUnitScope | null> {
  const parts = await resolveScopeParts(req);
  if (!parts) return null;

  const unitsByHotel: UnitsByHotel = {};
  const ownedUnitsByHotel: Record<string, Array<{ id: string; roomId: string; roomNumber?: string }>> = {};

  // Full-hotel owners: null (manage everything).
  for (const h of parts.ownedHotelIds) unitsByHotel[h] = null;

  // Operated-only hotels: batch-fetch the caller's active owned units.
  if (parts.operatedHotelIds.length && parts.ownerIds.length) {
    const hotelIn = parts.operatedHotelIds.map((i) => encodeURIComponent(i)).join(",");
    const ownerIn = parts.ownerIds.map((i) => encodeURIComponent(i)).join(",");
    let rows: any[] = [];
    try {
      const r = await sbSelect(
        `hotel_room_units?hotelId=in.(${hotelIn})&owner_user_id=in.(${ownerIn})&status=eq.active&select=id,hotelId,roomId,roomNumber`
      );
      if (Array.isArray(r)) rows = r;
    } catch { /* ignore — treat as no owned units */ }

    // seed empty arrays so every operated hotel has a definite entry
    for (const h of parts.operatedHotelIds) {
      unitsByHotel[h] = [];
      ownedUnitsByHotel[h] = [];
    }
    for (const u of rows) {
      const h = String(u.hotelId);
      const id = String(u.id);
      if (!unitsByHotel[h]) unitsByHotel[h] = [];
      (unitsByHotel[h] as string[]).push(id);
      (ownedUnitsByHotel[h] ||= []).push({
        id,
        roomId: String(u.roomId),
        roomNumber: u.roomNumber != null ? String(u.roomNumber) : undefined,
      });
    }
  }

  return {
    hotelIds: [...parts.ownedHotelIds, ...parts.operatedHotelIds],
    userId: parts.userId,
    ownerIds: parts.ownerIds,
    unitsByHotel,
    ownedUnitsByHotel,
  };
}

/**
 * Can the caller manage a feed / connection row identified by (hotelId, unitId)?
 *   • not in scope            → false
 *   • full-hotel access (null)→ true (hotel-level AND any unit-level)
 *   • unit-scoped ([ids])     → only when unitId is one of theirs; NEVER a
 *                               hotel-level (unitId null) row (that's the
 *                               operator's / admin's).
 */
export function canManageUnitRow(
  scope: PartnerUnitScope,
  hotelId: string,
  unitId: string | null | undefined
): boolean {
  if (!hotelId || !scope.hotelIds.includes(hotelId)) return false;
  const owned = scope.unitsByHotel[hotelId];
  if (owned === null || owned === undefined) return true; // full-hotel access
  if (!unitId) return false;                              // unit-scoped ≠ hotel-level
  return owned.includes(String(unitId));
}

/** True when the caller is unit-scoped (an investor, not the operator) on this hotel. */
export function isUnitScoped(scope: PartnerUnitScope, hotelId: string): boolean {
  return Array.isArray(scope.unitsByHotel[hotelId]);
}
