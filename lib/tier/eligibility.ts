// ═══════════════════════════════════════════════════════════════════════════
// Tier-system eligibility helpers.
// Source-of-truth functions for "can this user upload via the Verified Guest
// path?" and "is there an active location-OTP verification?".
// ═══════════════════════════════════════════════════════════════════════════
// All reads go through PostgREST with SB_KEY (anon). Pattern matches every
// other helper in lib/ — no service-role key, no Railway dependency.
import { SB_URL, SB_KEY } from "@/lib/sb";
import { resolveUserIds } from "@/lib/sb-server";

const READ_HEADERS = {
  apikey: SB_KEY,
  Authorization: `Bearer ${SB_KEY}`,
};

// Phase 0 §3.1 locked: a booking is "completed" iff
//   (bookings.status='CHECKED_OUT' OR bids.status='CHECKED_OUT')
//   AND checkOut < NOW()
//   AND checkOut > NOW() - INTERVAL '90 days'
const ELIGIBILITY_WINDOW_DAYS = 90;

export type EligibleBooking = {
  // Unified shape across `bookings` table + `bids` (ACCEPTED → CHECKED_OUT)
  id: string;
  hotelId: string;
  roomId?: string | null;
  checkIn: string | null;
  checkOut: string | null;
  source: "booking" | "bid";
  hotelName?: string | null;
  hotelCity?: string | null;
};

/**
 * Get every booking (across both tables) that qualifies the user for a
 * Verified Guest post. Returns most-recently-checked-out first.
 * Dedups (hotelId, roomId, checkIn) so the same stay never appears twice.
 */
export async function listEligibleBookings(
  primaryUserId: string,
  phone?: string | null
): Promise<EligibleBooking[]> {
  const userIds = await resolveUserIds(primaryUserId, phone);
  if (!userIds.length) return [];
  const inList = userIds.map(encodeURIComponent).join(",");

  const since = new Date(
    Date.now() - ELIGIBILITY_WINDOW_DAYS * 86_400_000
  ).toISOString();
  const now = new Date().toISOString();

  // Both tables in parallel.
  const [bookingsRes, bidsRes] = await Promise.all([
    fetch(
      `${SB_URL}/rest/v1/bookings?customerId=in.(${inList})` +
        `&status=eq.CHECKED_OUT` +
        `&checkOut=gte.${encodeURIComponent(since)}` +
        `&checkOut=lt.${encodeURIComponent(now)}` +
        `&select=id,hotelId,roomId,checkIn,checkOut,customerId` +
        `&order=checkOut.desc&limit=100`,
      { headers: READ_HEADERS, cache: "no-store" }
    ),
    fetch(
      `${SB_URL}/rest/v1/bids?customerId=in.(${inList})` +
        `&status=eq.CHECKED_OUT` +
        `&select=id,hotelId,roomId,customerId,requestId` +
        `&order=createdAt.desc&limit=100`,
      { headers: READ_HEADERS, cache: "no-store" }
    ),
  ]);

  const bookingRows = (bookingsRes.ok
    ? await bookingsRes.json().catch(() => [])
    : []) as any[];
  const bidRows = (bidsRes.ok ? await bidsRes.json().catch(() => []) : []) as any[];

  // For CHECKED_OUT bids, we need to join bid_requests to get checkIn/checkOut
  // and apply the same window filter at app-level (PostgREST can't filter on
  // a related table's column from a top-level GET).
  let bidEnriched: any[] = [];
  if (bidRows.length) {
    const reqIds = Array.from(
      new Set(bidRows.map((b) => b.requestId).filter(Boolean))
    );
    let requestRows: any[] = [];
    if (reqIds.length) {
      const inReq = reqIds.map(encodeURIComponent).join(",");
      const r = await fetch(
        `${SB_URL}/rest/v1/bid_requests?id=in.(${inReq})` +
          `&select=id,checkIn,checkOut`,
        { headers: READ_HEADERS, cache: "no-store" }
      );
      requestRows = r.ok ? (await r.json().catch(() => [])) : [];
    }
    const reqById = new Map(requestRows.map((r: any) => [r.id, r]));
    const sinceMs = Date.now() - ELIGIBILITY_WINDOW_DAYS * 86_400_000;
    const nowMs = Date.now();
    bidEnriched = bidRows
      .map((b) => {
        const r = b.requestId ? reqById.get(b.requestId) : null;
        if (!r?.checkOut) return null;
        const checkOutMs = Date.parse(r.checkOut);
        if (!Number.isFinite(checkOutMs)) return null;
        if (checkOutMs >= nowMs) return null;
        if (checkOutMs < sinceMs) return null;
        return {
          id: b.id,
          hotelId: b.hotelId,
          roomId: b.roomId,
          checkIn: r.checkIn,
          checkOut: r.checkOut,
          source: "bid" as const,
        };
      })
      .filter(Boolean) as any[];
  }

  const bookingEnriched: EligibleBooking[] = bookingRows.map((b: any) => ({
    id: b.id,
    hotelId: b.hotelId,
    roomId: b.roomId,
    checkIn: b.checkIn,
    checkOut: b.checkOut,
    source: "booking" as const,
  }));

  // Dedup on (hotelId, roomId, checkIn) — direct booking wins over bid projection.
  const seen = new Set<string>();
  const merged: EligibleBooking[] = [];
  for (const row of [...bookingEnriched, ...bidEnriched]) {
    const k = `${row.hotelId}|${row.roomId || ""}|${row.checkIn || ""}`;
    if (seen.has(k)) continue;
    seen.add(k);
    merged.push(row);
  }

  // Sort by checkOut desc (most recent first)
  merged.sort((a, b) => {
    const av = a.checkOut ? Date.parse(a.checkOut) : 0;
    const bv = b.checkOut ? Date.parse(b.checkOut) : 0;
    return bv - av;
  });

  // Side-load hotel name + city for display
  const hotelIds = Array.from(new Set(merged.map((m) => m.hotelId).filter(Boolean)));
  if (hotelIds.length) {
    const r = await fetch(
      `${SB_URL}/rest/v1/hotels?id=in.(${hotelIds.map(encodeURIComponent).join(",")})&select=id,name,city`,
      { headers: READ_HEADERS, cache: "no-store" }
    );
    if (r.ok) {
      const hotels = (await r.json().catch(() => [])) as any[];
      const byId = new Map(hotels.map((h: any) => [h.id, h]));
      for (const m of merged) {
        const h = byId.get(m.hotelId);
        if (h) {
          m.hotelName = h.name;
          m.hotelCity = h.city;
        }
      }
    }
  }

  return merged;
}

/**
 * Returns true if this user has at least one CHECKED_OUT booking in the
 * eligibility window for the given hotel (used by the Verified Guest
 * upload endpoint to validate booking_id ownership).
 */
export async function hasEligibleBookingForHotel(
  primaryUserId: string,
  phone: string | null,
  hotelId: string,
  bookingId: string
): Promise<{ ok: boolean; booking?: EligibleBooking }> {
  const eligible = await listEligibleBookings(primaryUserId, phone);
  const match = eligible.find(
    (b) => b.hotelId === hotelId && b.id === bookingId
  );
  if (!match) return { ok: false };
  return { ok: true, booking: match };
}

/**
 * Look up an active (verified + not consumed + not expired) location
 * verification for this user + hotel. Returns the row or null.
 */
export async function findActiveLocationVerification(
  userId: string,
  hotelId: string
): Promise<{ id: string; verified_at: string; expires_at: string } | null> {
  const now = new Date().toISOString();
  const r = await fetch(
    `${SB_URL}/rest/v1/location_verifications` +
      `?user_id=eq.${encodeURIComponent(userId)}` +
      `&hotel_id=eq.${encodeURIComponent(hotelId)}` +
      `&status=eq.VERIFIED` +
      `&expires_at=gt.${encodeURIComponent(now)}` +
      `&select=id,verified_at,expires_at,used_for_post_id` +
      `&order=verified_at.desc&limit=1`,
    { headers: READ_HEADERS, cache: "no-store" }
  );
  if (!r.ok) return null;
  const rows = (await r.json().catch(() => [])) as any[];
  if (!rows[0]) return null;
  // Already consumed → not active
  if (rows[0].used_for_post_id) return null;
  return rows[0];
}

/**
 * Count of unconsumed, verified, unexpired location verifications across
 * any hotel for a user. Used by GET /api/me/tier for the UI flag.
 */
export async function countActiveLocationVerifications(
  userId: string
): Promise<number> {
  const now = new Date().toISOString();
  const r = await fetch(
    `${SB_URL}/rest/v1/location_verifications` +
      `?user_id=eq.${encodeURIComponent(userId)}` +
      `&status=eq.VERIFIED` +
      `&expires_at=gt.${encodeURIComponent(now)}` +
      `&used_for_post_id=is.null` +
      `&select=id`,
    { headers: { ...READ_HEADERS, Prefer: "count=exact" }, cache: "no-store" }
  );
  if (!r.ok) return 0;
  const range = r.headers.get("content-range") || "0";
  const total = parseInt(range.split("/").pop() || "0", 10);
  return Number.isFinite(total) ? total : 0;
}
