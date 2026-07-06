// StayCircle → bookable-hotel provisioning (Phase 2).
//
// When a Circle bundle activates (payment verified), the investor's allotted
// rooms must become REAL, bookable inventory that:
//   • appears to customers as individual Airbnb-style room listings, and
//   • is manageable by the investor from the ONE hotel-partner dashboard.
//
// Model (locked with Sachin):
//   hotels                — one bookable hotel per circle_property.
//                           account_type='staybid_operated' (StayBid runs ops).
//                           ownerId = STAYBID_CIRCLE_OPS sentinel so the hotel
//                           never lands in a real person's ownerId scope.
//   rooms                 — one CATEGORY row per circle_room_type (grouping +
//                           a price/amenity fallback). quantity = total_units.
//                           The v247 trigger auto-creates that many
//                           hotel_room_units on insert.
//   hotel_room_units      — the physical numbered rooms. Each is an INDEPENDENT
//                           listing; owner_user_id = the investor who bought it,
//                           circle_bundle_id = provenance. A customer books a
//                           SPECIFIC unit → that unit's owner_user_id gets the
//                           booking. Exact attribution, zero mis-routing.
//
// Multi-investor per hotel is the default: two investors buying rooms of the
// SAME category stamp DIFFERENT still-unowned units. One investor with rooms
// across many categories is just many self-contained units. N-proof.
//
// Everything here is BEST-EFFORT + IDEMPOTENT — it runs as a post-activation
// side-effect of /api/circle/verify and must never throw the response. Re-runs
// (webhook retries, manual re-verify) converge to the same state.

import { SB_URL, SB_H } from "@/lib/sb";

// Sentinel owner for every Circle-operated hotel. Not a real person — investors
// reach the hotel only via unit-ownership (lib/partner/operator-access.ts), so
// this keeps the hotel out of any human's ownerId-based partner scope.
export const STAYBID_CIRCLE_OPS = "staybid_circle_ops";

type BundleItem = { roomTypeId?: string; propertyId?: string; rooms?: number };

async function sbGet(path: string): Promise<any[]> {
  try {
    const r = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: SB_H });
    if (!r.ok) return [];
    const j = await r.json();
    return Array.isArray(j) ? j : [];
  } catch {
    return [];
  }
}

async function sbInsert(table: string, body: any, prefer = "return=representation"): Promise<any[]> {
  try {
    const r = await fetch(`${SB_URL}/rest/v1/${table}`, {
      method: "POST",
      headers: { ...SB_H, Prefer: prefer },
      body: JSON.stringify(body),
    });
    if (!r.ok) return [];
    const j = await r.json().catch(() => []);
    return Array.isArray(j) ? j : [];
  } catch {
    return [];
  }
}

async function sbPatch(path: string, body: any): Promise<boolean> {
  try {
    const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
      method: "PATCH",
      headers: { ...SB_H, Prefer: "return=minimal" },
      body: JSON.stringify(body),
    });
    return r.ok;
  } catch {
    return false;
  }
}

// A circle_room_type's monthly rent is the INVESTOR's number, not the guest
// nightly price. Derive a sensible starting nightly floor/mrp; the pricing
// spine + the investor's own per-unit override refine it later.
function deriveNightly(rt: any): { floor: number; mrp: number } {
  const monthly = Number(rt?.monthly_rate) || 0;
  // ~ rent / 30 as a rough breakeven-ish nightly, floored to a premium minimum.
  const base = monthly > 0 ? Math.round((monthly / 30) * 1.6) : 2500;
  const floor = Math.max(1500, Math.round(base / 100) * 100);
  const mrp = Math.round((floor * 1.5) / 100) * 100;
  return { floor, mrp };
}

// Map a free-text category name to the closest catalog room type slug.
function roomTypeSlug(name: string): string {
  const n = String(name || "").toLowerCase();
  if (n.includes("presidential")) return "presidential";
  if (n.includes("villa")) return "villa";
  if (n.includes("suite")) return n.includes("junior") ? "junior_suite" : "suite";
  if (n.includes("family")) return "family";
  if (n.includes("premium")) return "premium";
  if (n.includes("deluxe")) return "deluxe";
  if (n.includes("cottage")) return "cottage";
  if (n.includes("dorm")) return "dormitory";
  return "standard";
}

/**
 * Ensure a real bookable `hotels` row exists for a circle_property.
 * Returns the hotel id, or null on failure.
 */
async function ensureHotel(propertyId: string, bundleId: string): Promise<string | null> {
  const [prop] = await sbGet(
    `circle_properties?id=eq.${encodeURIComponent(propertyId)}&select=*`,
  );
  if (!prop) return null;

  // Already linked → reuse.
  if (prop.hotel_id) {
    const [existing] = await sbGet(
      `hotels?id=eq.${encodeURIComponent(prop.hotel_id)}&select=id`,
    );
    if (existing) return String(prop.hotel_id);
  }

  // Deterministic hotel id = the circle_property uuid (unique, TEXT-safe).
  const hotelId = String(prop.id);
  const [already] = await sbGet(`hotels?id=eq.${encodeURIComponent(hotelId)}&select=id`);
  if (!already) {
    const images = Array.isArray(prop.images) ? prop.images : [];
    await sbInsert("hotels", {
      id: hotelId,
      name: prop.title || "StayCircle Property",
      description: prop.description || prop.tagline || "",
      city: prop.city || "",
      state: prop.state || null,
      ownerId: STAYBID_CIRCLE_OPS,
      starRating: 4,
      // Provisioned as DRAFT so the inventory + per-unit ownership exist and are
      // manageable in the partner dashboard, but the hotel does NOT leak into the
      // customer feed until the Phase-3 individual-room display + real pricing are
      // ready (and admin/ops flips it live).
      isActive: false,
      isVerified: true,
      status: "draft",
      approval_status: "pending",
      account_type: "staybid_operated",
      circle_bundle_id: bundleId,
      circle_property_id: hotelId,
      images,
      property_type: "hotel",
    });
  }
  // Back-fill the link on the circle_property (idempotent).
  await sbPatch(`circle_properties?id=eq.${encodeURIComponent(hotelId)}`, {
    hotel_id: hotelId,
    updated_at: new Date().toISOString(),
  });
  return hotelId;
}

/**
 * Ensure a `rooms` category row exists for a circle_room_type inside a hotel.
 * The v247 trigger auto-creates its physical units. Returns the room id.
 */
async function ensureRoomCategory(
  hotelId: string,
  circleRoomTypeId: string,
): Promise<{ roomId: string; totalUnits: number } | null> {
  const [rt] = await sbGet(
    `circle_room_types?id=eq.${encodeURIComponent(circleRoomTypeId)}&select=*`,
  );
  if (!rt) return null;

  // Deterministic room id keyed to the circle_room_type → idempotent.
  const roomId = `cr_${circleRoomTypeId}`;
  const totalUnits = Math.max(1, Number(rt.total_units) || 1);

  const [existing] = await sbGet(`rooms?id=eq.${encodeURIComponent(roomId)}&select=id,quantity`);
  if (existing) {
    // Grow inventory if the circle category expanded (never shrink).
    if ((Number(existing.quantity) || 0) < totalUnits) {
      await sbPatch(`rooms?id=eq.${encodeURIComponent(roomId)}`, { quantity: totalUnits });
    }
    return { roomId, totalUnits };
  }

  const { floor, mrp } = deriveNightly(rt);
  const amenities = Array.isArray(rt.amenities) ? rt.amenities : [];
  const images = Array.isArray(rt.images) ? rt.images : [];
  await sbInsert("rooms", {
    id: roomId,
    hotelId,
    type: roomTypeSlug(rt.name),
    name: rt.name || "Room",
    capacity: Number(rt.capacity) || 2,
    floorPrice: floor,
    mrp,
    description: rt.description || "",
    amenities,
    images,
    quantity: totalUnits, // v247 trigger auto-creates this many hotel_room_units
    isAvailable: true,
    size_sqft: rt.size_sqft || null,
  });
  return { roomId, totalUnits };
}

/**
 * Stamp `count` still-unowned physical units of a room with the investor as
 * owner. Idempotent: units already stamped for THIS bundle+room are counted,
 * only the shortfall is filled from the unowned pool.
 */
async function stampOwnedUnits(
  hotelId: string,
  roomId: string,
  ownerUserId: string,
  bundleId: string,
  count: number,
): Promise<number> {
  if (count <= 0) return 0;

  // Already stamped for this exact bundle+room?
  const mine = await sbGet(
    `hotel_room_units?roomId=eq.${encodeURIComponent(roomId)}&circle_bundle_id=eq.${encodeURIComponent(bundleId)}&select=id`,
  );
  const have = mine.length;
  if (have >= count) return have;

  const need = count - have;

  // Take the first `need` still-unowned active units of this room.
  const pool = await sbGet(
    `hotel_room_units?roomId=eq.${encodeURIComponent(roomId)}&owner_user_id=is.null&status=eq.active&select=id&order=roomNumber.asc&limit=${need}`,
  );
  let stamped = have;
  for (const u of pool) {
    const ok = await sbPatch(`hotel_room_units?id=eq.${encodeURIComponent(u.id)}`, {
      owner_user_id: ownerUserId,
      circle_bundle_id: bundleId,
      is_listed: true,
    });
    if (ok) stamped += 1;
  }
  return stamped;
}

export type ProvisionResult = {
  ok: boolean;
  hotels: string[];
  unitsStamped: number;
  items: number;
  error?: string;
};

/**
 * Provision every item in an activated bundle. Called by /api/circle/verify.
 * Best-effort: returns a summary, never throws.
 */
export async function provisionBundle(bundle: any): Promise<ProvisionResult> {
  const result: ProvisionResult = { ok: true, hotels: [], unitsStamped: 0, items: 0 };
  try {
    const ownerUserId = String(bundle?.user_id || "").trim();
    const items: BundleItem[] = Array.isArray(bundle?.items) ? bundle.items : [];
    if (!ownerUserId || !items.length) {
      return { ...result, ok: false, error: "no user_id or items" };
    }
    const bundleId = String(bundle.id);

    for (const it of items) {
      const propertyId = String(it?.propertyId || "").trim();
      const circleRoomTypeId = String(it?.roomTypeId || "").trim();
      const rooms = Math.max(0, Number(it?.rooms) || 0);
      if (!propertyId || !circleRoomTypeId || rooms <= 0) continue;
      result.items += 1;

      const hotelId = await ensureHotel(propertyId, bundleId);
      if (!hotelId) continue;
      if (!result.hotels.includes(hotelId)) result.hotels.push(hotelId);

      const cat = await ensureRoomCategory(hotelId, circleRoomTypeId);
      if (!cat) continue;

      const stamped = await stampOwnedUnits(hotelId, cat.roomId, ownerUserId, bundleId, rooms);
      result.unitsStamped += stamped;
    }
    return result;
  } catch (e: any) {
    return { ...result, ok: false, error: String(e?.message || e).slice(0, 160) };
  }
}
