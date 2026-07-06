// Individual-room "listing" resolver (Phase 3).
//
// Sachin's locked model: a hotel with investor-owned physical rooms shows each
// room to the customer as its OWN Airbnb-style listing — own price / amenities /
// photos / host-rating — grouped under its category. Different owners of the
// same category can price + furnish differently; the customer books a SPECIFIC
// room and that room's owner gets the booking.
//
// This resolver turns `hotel_room_units` (the owned + listed + active ones) into
// customer-facing listings, resolving each field with a fallback to its room
// CATEGORY. Owner identity is NEVER exposed — differentiation is by room
// attributes + a per-room host-rating only.
//
// A hotel with ZERO owned+listed units → `individualRooms:false` + empty list →
// the customer page renders category cards exactly as today (every one of the
// 31 existing StayBid hotels). Purely additive.

import { SB_URL, SB_KEY } from "@/lib/sb";

const H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" };

export type RoomListing = {
  unitId: string;
  roomId: string;        // category id (rooms.id) this unit belongs to
  categoryName: string;  // rooms.name — the group header
  roomNumber: string | null;
  floor: string | null;
  title: string;         // unit.title || category name
  price: number;         // unit.price_override ?? category floorPrice
  mrp: number | null;    // unit.mrp_override ?? category mrp
  amenities: any[];      // unit.amenities (non-empty) else category amenities
  photos: any[];         // unit.photos (non-empty) else category images
  viewLabel: string | null;
  capacity: number;
  hostRating: number | null;
  hostReviews: number;
};

function arr(v: any): any[] {
  return Array.isArray(v) ? v : [];
}

function overlaps(aFrom: string, aTo: string, bFrom: string, bTo: string): boolean {
  // [from, to) half-open — checkout day is free. Guard bad dates.
  if (!aFrom || !aTo || !bFrom || !bTo) return false;
  return aFrom < bTo && bFrom < aTo;
}

/**
 * Is a SPECIFIC physical unit free for [from, to)? Checks partner/OTA
 * `room_blocks` on the unit + active `bids` assigned to the unit (their dates
 * from the linked bid_request). Prevents two guests double-booking one room.
 * Fails OPEN on any gap (missing dates / query error) — a false "occupied" on
 * the core booking path is worse than a rare edge; the category-level check in
 * place-bid still guards the pool.
 */
export async function isUnitFreeForRange(
  unitId: string,
  from: string,
  to: string,
): Promise<boolean> {
  if (!unitId || !from || !to) return true;
  try {
    // 1) Partner/OTA/walk-in blocks assigned to this unit.
    const blkRes = await fetch(
      `${SB_URL}/rest/v1/room_blocks?assignedUnitId=eq.${encodeURIComponent(unitId)}&select=fromDate,toDate`,
      { headers: H },
    );
    if (blkRes.ok) {
      const blocks = await blkRes.json().catch(() => []);
      if (Array.isArray(blocks)) {
        for (const b of blocks) {
          if (overlaps(from, to, String(b.fromDate), String(b.toDate))) return false;
        }
      }
    }
    // 2) Active bids already assigned to this unit → their request dates.
    const bidRes = await fetch(
      `${SB_URL}/rest/v1/bids?assignedUnitId=eq.${encodeURIComponent(unitId)}` +
        `&status=in.(PENDING,COUNTER,ACCEPTED,CONFIRMED,CHECKED_IN)&select=requestId`,
      { headers: H },
    );
    if (bidRes.ok) {
      const bids = await bidRes.json().catch(() => []);
      const reqIds = Array.isArray(bids)
        ? Array.from(new Set(bids.map((b: any) => b.requestId).filter(Boolean)))
        : [];
      if (reqIds.length) {
        const rqRes = await fetch(
          `${SB_URL}/rest/v1/bid_requests?id=in.(${reqIds.map((i) => encodeURIComponent(String(i))).join(",")})&select=checkIn,checkOut`,
          { headers: H },
        );
        if (rqRes.ok) {
          const rqs = await rqRes.json().catch(() => []);
          if (Array.isArray(rqs)) {
            for (const rq of rqs) {
              if (overlaps(from, to, String(rq.checkIn), String(rq.checkOut))) return false;
            }
          }
        }
      }
    }
    return true;
  } catch {
    return true; // fail open
  }
}

/**
 * Build individual-room listings for a hotel.
 * @param hotelId  the hotel
 * @param rooms    the hotel's `rooms` (categories) — already fetched by getHotel
 */
export async function resolveRoomListings(
  hotelId: string,
  rooms: any[],
): Promise<{ individualRooms: boolean; listings: RoomListing[] }> {
  if (!hotelId) return { individualRooms: false, listings: [] };

  // In a circle-operated hotel EVERY physical room is an individual listing —
  // investor-owned units use their overrides; StayBid-ops units (owner_user_id
  // NULL) use category defaults. getHotel already gates this to circle hotels via
  // account_type, so we list all active + listed units here.
  let units: any[] = [];
  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/hotel_room_units?hotelId=eq.${encodeURIComponent(hotelId)}` +
        `&is_listed=eq.true&status=eq.active` +
        `&select=id,roomId,roomNumber,floor,title,price_override,mrp_override,amenities,photos,view_label,host_rating,host_reviews` +
        `&order=roomNumber.asc`,
      { headers: H },
    );
    if (r.ok) {
      const j = await r.json();
      if (Array.isArray(j)) units = j;
    }
  } catch {
    /* best-effort → category display */
  }
  if (!units.length) return { individualRooms: false, listings: [] };

  const catById: Record<string, any> = {};
  arr(rooms).forEach((rm) => {
    if (rm?.id) catById[String(rm.id)] = rm;
  });

  const listings: RoomListing[] = units.map((u: any) => {
    const cat = catById[String(u.roomId)] || {};
    const uAmen = arr(u.amenities);
    const uPhotos = arr(u.photos);
    const price =
      u.price_override != null ? Number(u.price_override) : Number(cat.floorPrice) || 0;
    const mrp =
      u.mrp_override != null
        ? Number(u.mrp_override)
        : cat.mrp != null
          ? Number(cat.mrp)
          : null;
    return {
      unitId: String(u.id),
      roomId: String(u.roomId),
      categoryName: cat.name || "Room",
      roomNumber: u.roomNumber ? String(u.roomNumber) : null,
      floor: u.floor ? String(u.floor) : null,
      title: u.title || cat.name || "Room",
      price,
      mrp,
      amenities: uAmen.length ? uAmen : arr(cat.amenities),
      photos: uPhotos.length ? uPhotos : arr(cat.images),
      viewLabel: u.view_label || null,
      capacity: Number(cat.capacity) || 2,
      hostRating: u.host_rating != null ? Number(u.host_rating) : null,
      hostReviews: Number(u.host_reviews) || 0,
    };
  });

  return { individualRooms: true, listings };
}

/**
 * Validate that `unitId` is a bookable listing on `hotelId` (optionally in
 * `roomId` category): active + listed + belongs to the hotel. Used by
 * /api/bids/place to attach a unit to a bid so the booking is for that specific
 * room (its owner_user_id — investor OR StayBid-ops NULL — is the payout owner).
 * Returns null when the unit is invalid → the caller drops the assignment
 * (leak-safe; never trust a client-supplied unit blindly).
 */
export async function resolveOwnedUnit(
  hotelId: string,
  unitId: string,
  roomId?: string,
): Promise<{ unitId: string; roomId: string; ownerUserId: string | null } | null> {
  if (!hotelId || !unitId) return null;
  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/hotel_room_units?id=eq.${encodeURIComponent(unitId)}` +
        `&hotelId=eq.${encodeURIComponent(hotelId)}` +
        `&is_listed=eq.true&status=eq.active&select=id,roomId,owner_user_id`,
      { headers: H },
    );
    if (!r.ok) return null;
    const rows = await r.json().catch(() => []);
    const u = Array.isArray(rows) ? rows[0] : null;
    if (!u) return null;
    if (roomId && String(u.roomId) !== String(roomId)) return null;
    return {
      unitId: String(u.id),
      roomId: String(u.roomId),
      ownerUserId: u.owner_user_id != null ? String(u.owner_user_id) : null,
    };
  } catch {
    return null;
  }
}
