// ═══════════════════════════════════════════════════════════════════════════
// Tier-system eligibility helpers.
// Source-of-truth functions for "can this user upload via the Verified Guest
// path?" and "is there an active location-OTP verification?".
// ═══════════════════════════════════════════════════════════════════════════
// All reads go through PostgREST with SB_KEY (anon). Pattern matches every
// other helper in lib/ — no service-role key, no Railway dependency.
import { SB_URL, SB_KEY } from "@/lib/sb";
import { resolveUserIds } from "@/lib/sb-server";
import { readVerifiedStayEvidenceForCustomers } from "@/lib/stay/verified-stay-evidence";

const READ_HEADERS = {
  apikey: SB_KEY,
  Authorization: `Bearer ${SB_KEY}`,
};

// SEC-00B FINAL TRUST BOUNDARY: the mutable public tables `bids`, `bookings`,
// and `checkin_checkout_logs` have permissive RLS (anon + authenticated full
// CRUD) — a client can forge any CHECKED_IN/CHECKED_OUT status or row in them —
// and the legacy partner check-in route was decode-only. So NONE of those rows
// are trustworthy as Verified-Guest AUTO_APPROVE authority. The ONLY authority
// is the protected `verified_stay_evidence` table (service-role, forge-proof),
// written by the hardened, cryptographically-verified partner check-in. This
// helper reads ONLY that evidence (already recency-windowed to 90 days) and
// fails closed ([]) when it is unconfigured / the migration is not yet applied.
// Payment markers remain fail-closed (never authority).

export type EligibleBooking = {
  // Unified shape across `bookings` table + `bids` (ACCEPTED → CHECKED_OUT)
  id: string;
  hotelId: string;
  roomId?: string | null;
  checkIn: string | null;
  checkOut: string | null;
  source: "booking" | "bid";
  status?: string | null;
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
  phone?: string | null,
  email?: string | null
): Promise<EligibleBooking[]> {
  // resolveUserIds() accepts string | undefined; normalize null → undefined.
  // Pass jwtEmail (the documented resolveUserIds(id, phone, email) contract).
  // Without it, an eligible stay booked under an email-keyed identity twin —
  // e.g. a Google/Firebase session whose own `users` row has no stored email —
  // is silently missed, producing a false "no stays" zero.
  //
  // AUTHORITY BOUNDARY (SEC-00B): the ownership callers of this helper (the
  // Verified Guest upload gate + the eligible-bookings picker) now supply a
  // CRYPTOGRAPHICALLY VERIFIED email (resolveVerifiedMediaIdentity) — never a
  // decode-only claim. Two independent defences still neutralize the
  // `email=ilike.<email>` wildcard vector: (1) this local plausibility gate
  // drops a value carrying whitespace / , % * ( ) < > " ' \ or a non-address
  // shape; (2) resolveUserIds() escapes the SQL LIKE metacharacters (`\ % _`)
  // and drops the PostgREST `*` wildcard, so the match is LITERAL and a
  // legitimate `first_last@x.com` still resolves its twin while `*@*` / `%` / `_`
  // can never widen the caller to another user's identity.
  const trimmedEmail = typeof email === "string" ? email.trim() : "";
  const safeEmail =
    trimmedEmail &&
    !/[\s,%*()<>"'\\]/.test(trimmedEmail) &&
    /^[^@]+@[^@]+\.[^@]+$/.test(trimmedEmail)
      ? trimmedEmail
      : undefined;
  const userIds = await resolveUserIds(
    primaryUserId,
    phone ?? undefined,
    safeEmail
  );
  if (!userIds.length) return [];

  // AUTHORITY: read ONLY the protected verified_stay_evidence (service-role,
  // forge-proof; already windowed to 90 days). Fails closed ([]) when
  // unconfigured / migration not applied. The mutable public bids / bookings /
  // checkin_checkout_logs rows are NEVER consulted here.
  const evidence = await readVerifiedStayEvidenceForCustomers(userIds);
  if (!evidence.length) return [];

  // Map evidence → the unified EligibleBooking shape. `source_id` is the
  // underlying bid/booking id the client references; the partner-recorded
  // check-in/out timestamps are trustworthy (set by the authenticated partner).
  const seen = new Set<string>();
  const merged: EligibleBooking[] = [];
  for (const e of evidence) {
    const id = String(e.source_id || "");
    const hotelId = String(e.hotel_id || "");
    if (!id || !hotelId) continue;
    const k = `${hotelId}|${id}`;
    if (seen.has(k)) continue;
    seen.add(k);
    merged.push({
      id,
      hotelId,
      roomId: null,
      checkIn: e.check_in_at || null,
      checkOut: e.check_out_at || e.check_in_at || null,
      source: e.source_type === "booking" ? "booking" : "bid",
      status: e.proof_state,
    });
  }
  if (!merged.length) return [];

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
  bookingId: string,
  email?: string | null
): Promise<{ ok: boolean; booking?: EligibleBooking }> {
  // v740 — thread email so the upload gate resolves the SAME identity set as
  // the picker (/api/me/eligible-bookings) and the tier count. Otherwise the
  // picker could show a stay the upload gate then rejects (or vice-versa).
  const eligible = await listEligibleBookings(primaryUserId, phone, email);
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
