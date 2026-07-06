// Circle-operator access resolver (Phase 2).
//
// The classic partner-dashboard scope is `hotels.ownerId` (the person who
// onboarded the hotel). Circle investors DON'T own the hotel row — StayBid
// operates it under the STAYBID_CIRCLE_OPS sentinel. Instead they own specific
// physical rooms (`hotel_room_units.owner_user_id`). This resolver finds every
// hotel where the caller owns at least one unit, so the partner endpoints can
// UNION those hotels into the caller's scope alongside their ownerId hotels.
//
// Additive: for a classic hotel_owner (no owned units) this returns []. The
// existing ownerId path is untouched.

import { SB_URL, SB_KEY } from "@/lib/sb";

const H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" };

/**
 * Distinct hotel ids where any of `ownerIds` owns ≥1 physical unit.
 * `ownerIds` must already be the caller's resolved cross-pool ids.
 */
export async function resolveOperatedHotelIds(ownerIds: string[]): Promise<string[]> {
  const ids = (ownerIds || []).filter(Boolean);
  if (!ids.length) return [];
  try {
    const inList = ids.map((i) => encodeURIComponent(i)).join(",");
    const r = await fetch(
      `${SB_URL}/rest/v1/hotel_room_units?owner_user_id=in.(${inList})&select=hotelId`,
      { headers: H },
    );
    if (!r.ok) return [];
    const rows = await r.json().catch(() => []);
    if (!Array.isArray(rows)) return [];
    const set = new Set<string>();
    rows.forEach((row: any) => {
      if (row?.hotelId) set.add(String(row.hotelId));
    });
    return Array.from(set);
  } catch {
    return [];
  }
}

/**
 * The set of unit ids (within a hotel) that the caller owns. Used to scope
 * bookings / availability to the operator's OWN rooms on shared hotels.
 * Returns null when the caller owns NO units in the hotel (i.e. they're the
 * classic ownerId partner → full-hotel access, no unit filtering).
 */
export async function resolveOwnedUnitIds(
  hotelId: string,
  ownerIds: string[],
): Promise<string[] | null> {
  const ids = (ownerIds || []).filter(Boolean);
  if (!hotelId || !ids.length) return null;
  try {
    const inList = ids.map((i) => encodeURIComponent(i)).join(",");
    const r = await fetch(
      `${SB_URL}/rest/v1/hotel_room_units?hotelId=eq.${encodeURIComponent(hotelId)}&owner_user_id=in.(${inList})&select=id,roomId,roomNumber`,
      { headers: H },
    );
    if (!r.ok) return null;
    const rows = await r.json().catch(() => []);
    if (!Array.isArray(rows) || !rows.length) return null;
    return rows.map((row: any) => String(row.id));
  } catch {
    return null;
  }
}
