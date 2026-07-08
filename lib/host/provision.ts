// v309 (Host Property-Listing Redesign, Phase 4) — listing → operated hotel.
//
// When an admin approves a `discovery_properties` listing, we create a REAL
// bookable `hotels` row that StayBid operates, its `rooms` categories (the v247
// trigger auto-creates the physical `hotel_room_units`), and grant the original
// lister dashboard access by stamping every unit with their user id.
//
// Locked owner-model (with Sachin) — "alag owner ID per property":
//   • hotels.ownerId    = "hco_<propId>"       — a DISTINCT per-property owner
//                                                id. Never a real person's id,
//                                                never the shared circle sentinel
//                                                → two host-circle properties
//                                                never clash, and the lister's
//                                                classic hotels (ownerId = their
//                                                user id) stay separate.
//   • hotels.owner_type = 'host_circle'         — discriminator (admin sees it).
//   • hotels.account_type = 'staybid_operated'  — StayBid runs the ops.
//   • hotel_room_units.owner_user_id = submitted_by — the lister owns the units,
//                                                so the EXISTING
//                                                resolveOperatedHotelIds surfaces
//                                                the hotel on /partner/dashboard
//                                                via the read-time scope union
//                                                (zero read-path changes across
//                                                the 22 partner routes).
//
// Provisioned as a DRAFT hotel (isActive=false) — the inventory + per-unit
// ownership exist and are dashboard-manageable, but the hotel does NOT enter the
// customer feed until ops flips it live. Everything is BEST-EFFORT + IDEMPOTENT:
// deterministic ids mean re-runs converge (never duplicate hotel/rooms/units).

import { SB_URL, SB_H } from "@/lib/sb";

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

async function sbInsert(table: string, body: any): Promise<any[]> {
  try {
    const r = await fetch(`${SB_URL}/rest/v1/${table}`, {
      method: "POST",
      headers: { ...SB_H, Prefer: "return=representation" },
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

const nOrNull = (v: any): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const arr = (v: any): any[] => (Array.isArray(v) ? v : []);

export type HostProvisionResult = {
  ok: boolean;
  hotelId?: string;
  ownerId?: string;
  rooms?: number;
  unitsStamped?: number;
  reused?: boolean;
  error?: string;
};

/**
 * Ensure the operated `hotels` row for a listing. Returns { hotelId, ownerId,
 * reused } or null on failure. Deterministic ids → idempotent.
 */
async function ensureHotel(prop: any): Promise<{ hotelId: string; ownerId: string; reused: boolean } | null> {
  const propId = String(prop.id);
  const hotelId = `hcp_${propId}`;
  const ownerId = `hco_${propId}`;

  const [already] = await sbGet(`hotels?id=eq.${encodeURIComponent(hotelId)}&select=id`);
  if (already) return { hotelId, ownerId, reused: true };

  const details = prop.details && typeof prop.details === "object" ? prop.details : {};
  const sr = Number(details.starRating);
  const lat = nOrNull(prop.lat);
  const lng = nOrNull(prop.lng);

  const body: Record<string, any> = {
    id: hotelId,
    name: prop.title || "Host Property",
    description: String(details.description || prop.description || ""),
    city: prop.city || "",
    state: prop.state || null,
    ownerId,
    owner_type: "host_circle",
    account_type: "staybid_operated",
    starRating: Number.isFinite(sr) && sr >= 1 && sr <= 5 ? Math.round(sr) : 4,
    // DRAFT — inventory + ownership exist + dashboard-manageable, but hidden from
    // the customer feed until ops flips it live.
    isActive: false,
    isVerified: true,
    status: "draft",
    approval_status: "pending",
    property_type: prop.property_type || "hotel",
    amenities: arr(prop.amenities),
    images: arr(prop.images),
    meal_plans: arr(details.mealPlans),
    addon_services: arr(details.addonServices),
    source: "host_circle",
    formatted_address: prop.formatted_address || null,
  };
  if (lat != null) body.lat = lat;
  if (lng != null) body.lng = lng;

  const ins = await sbInsert("hotels", body);
  if (!ins.length) return null;
  return { hotelId, ownerId, reused: false };
}

/**
 * Ensure the `rooms` category rows from the listing's `rooms` jsonb. The v247
 * trigger auto-creates each category's physical `hotel_room_units`. Returns the
 * number of category rows that exist for the hotel.
 */
async function ensureRooms(hotelId: string, roomsJson: any[]): Promise<number> {
  let count = 0;
  for (let i = 0; i < roomsJson.length; i++) {
    const rm = roomsJson[i] || {};
    const roomId = `${hotelId}_r${i}`;
    const qty = Math.max(1, Math.round(Number(rm.count) || 1));

    const [existing] = await sbGet(`rooms?id=eq.${encodeURIComponent(roomId)}&select=id,quantity`);
    if (existing) {
      // Grow inventory if the listing expanded (never shrink → keeps stamped units).
      if ((Number(existing.quantity) || 0) < qty) {
        await sbPatch(`rooms?id=eq.${encodeURIComponent(roomId)}`, { quantity: qty });
      }
      count += 1;
      continue;
    }

    const price = Math.max(0, Math.round(Number(rm.price) || 0));
    const floor = price > 0 ? Math.round(price / 100) * 100 : 2500;
    const mrp = Math.round((floor * 1.5) / 100) * 100;
    const ins = await sbInsert("rooms", {
      id: roomId,
      hotelId,
      type: String(rm.category || "standard").slice(0, 40) || "standard",
      name: String(rm.name || "Room").slice(0, 80),
      capacity: Math.max(1, Math.round(Number(rm.capacity) || 2)),
      floorPrice: floor,
      mrp,
      description: "",
      amenities: arr(rm.amenities),
      images: arr(rm.images),
      quantity: qty, // v247 trigger auto-creates this many hotel_room_units
      isAvailable: true,
    });
    if (ins.length) count += 1;
  }
  return count;
}

/**
 * Stamp every still-unowned physical unit of the hotel with the lister as owner
 * so resolveOperatedHotelIds surfaces the hotel on their partner dashboard.
 * Idempotent: units already owned by the lister are counted, not re-stamped.
 */
async function stampUnitsToLister(hotelId: string, listerId: string): Promise<number> {
  // Already-stamped units for this lister.
  const mine = await sbGet(
    `hotel_room_units?hotelId=eq.${encodeURIComponent(hotelId)}&owner_user_id=eq.${encodeURIComponent(listerId)}&select=id`,
  );
  let stamped = mine.length;

  // Take the still-unowned active units of this hotel (batched, generous cap).
  const pool = await sbGet(
    `hotel_room_units?hotelId=eq.${encodeURIComponent(hotelId)}&owner_user_id=is.null&status=eq.active&select=id&order=roomNumber.asc&limit=500`,
  );
  for (const u of pool) {
    const ok = await sbPatch(`hotel_room_units?id=eq.${encodeURIComponent(u.id)}`, {
      owner_user_id: listerId,
      is_listed: true,
    });
    if (ok) stamped += 1;
  }
  return stamped;
}

/**
 * Provision an operated hotel from a `discovery_properties` listing. Called by
 * the admin approve+provision endpoint. Idempotent; returns a summary.
 */
export async function provisionListing(propertyId: string): Promise<HostProvisionResult> {
  try {
    const id = String(propertyId || "").trim();
    if (!id) return { ok: false, error: "propertyId required" };

    const [prop] = await sbGet(`discovery_properties?id=eq.${encodeURIComponent(id)}&select=*`);
    if (!prop) return { ok: false, error: "listing not found" };

    const ensured = await ensureHotel(prop);
    if (!ensured) return { ok: false, error: "hotel insert failed" };
    const { hotelId, ownerId, reused } = ensured;

    const roomsJson = arr(prop.rooms);
    const roomsCount = roomsJson.length ? await ensureRooms(hotelId, roomsJson) : 0;

    // Grant dashboard access to the original lister (owner submissions only —
    // admin/platform-created listings have no external lister; StayBid operates
    // them fully and the units stay unstamped, which is leak-safe).
    let unitsStamped = 0;
    const listerId = String(prop.submitted_by || "").trim();
    if (listerId) unitsStamped = await stampUnitsToLister(hotelId, listerId);

    return { ok: true, hotelId, ownerId, rooms: roomsCount, unitsStamped, reused };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e).slice(0, 160) };
  }
}
