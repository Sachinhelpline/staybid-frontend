import { NextRequest, NextResponse } from "next/server";
import { authUserId, authPayload, ensureUser, sbSelect, sbInsert, genId } from "@/lib/sb-server";

// v200 — One active bid per (customer × HOTEL). Per-flow timers:
//   • Negotiate (1:1 single hotel)    → 3h
//   • /bid      (1:N reverse auction) → 1h
const NEGOTIATE_MS = 3 * 3600_000;
const PLACE_MS     = 1 * 3600_000;
const expiresAtFor = (flow?: string) =>
  new Date(Date.now() + (flow === "place" ? PLACE_MS : NEGOTIATE_MS)).toISOString();

// v200 — Returns the conflicting active bid (PENDING / COUNTER / unpaid
// ACCEPTED) on THIS SAME hotel, or null. Per Sachin's confirmed rule
// (2026-05-24): one active bid per (customer × hotel). Different hotels
// in the same city are OK — a /bid broadcast still works because we
// exempt same-requestId.
//
// `currentRequestId` is the requestId attached to the incoming placeBid. /bid
// broadcasts N hotels in one city under ONE bid_request — so all N share the
// same requestId. We treat same-requestId rows as the same logical bid and
// skip them, so a single /bid submit doesn't 409 itself across its own
// per-hotel calls. A new /bid run (new requestId) does 409 against the
// still-active prior bid ON THE SAME hotel, which is the desired guard.
//
// We DROP the `expiresAt > now()` filter that was in v195 — stale ACCEPTED-
// unpaid bids (past 15-min payment window) had `expiresAt` in the past, so
// the old query silently returned no conflict and the customer could
// place duplicates (Sachin SS1/SS2 showed 4 stacked ACCEPTED on the same
// hotel). New rule: trust the STATUS column; the row stays ACCEPTED until
// either paid (bookings.paidAmount > 0) OR cron sweeps it to EXPIRED.
// While ACCEPTED-unpaid, no new bids on the same hotel can be placed.
//
// v236 — Apply per-status time-based filters so a STALE PENDING / COUNTER
// / ACCEPTED-unpaid bid (past its window) NEVER triggers a ghost conflict.
// Sachin's 2-screenshot report (2026-05-27): /bid Dhanaulti showed
// "You already have an active bid in Dhanaulti" while /my-bids showed
// ZERO bids. Root cause: v193 server cron `mark_stale_pending_bids`
// flips PENDING > 6h to EXPIRED in DB, AND v234 client filter in
// /my-bids hides PENDING > 6h client-side. BUT this conflict-check
// trusted STATUS only (v200 contract). If the cron is delayed or
// missed a window, the bid stays PENDING in DB → conflict check sees
// it → /my-bids client filter hides it → user sees a ghost conflict
// they can't action. v236 closes the gap: same per-status windows as
// `lib/bid-expiry.ts` applied here at conflict-check time. The cron
// is still the DB-truth path; this is the second line of defence.
//
// Windows (matching lib/bid-expiry.ts):
//   • PENDING with auto_accept_at → expire 15 min past scheduled accept
//   • PENDING with expiresAt      → server stamp (1h place / 3h negotiate)
//   • PENDING legacy              → 1h or 3h derived from message; 6h cap
//   • COUNTER                     → 60 min after updatedAt
//   • ACCEPTED + unpaid           → 15 min after acceptedAt
const ONE_MIN_MS = 60_000;
const ONE_HOUR_MS = 60 * ONE_MIN_MS;
function isBidStale(b: any): boolean {
  const now = Date.now();
  const status = String(b?.status || "").toUpperCase();
  if (status === "COUNTER") {
    const t = b?.updatedAt ? new Date(b.updatedAt).getTime()
            : b?.createdAt ? new Date(b.createdAt).getTime()
            : 0;
    return t > 0 && now > t + 60 * ONE_MIN_MS;
  }
  if (status === "ACCEPTED") {
    // v236.1 — expiresAt is the authoritative window for ACCEPTED-
    // unpaid bids (set by /api/bids/place on auto-accept to
    // acceptedAt + 15min; set by partner accept to now() + window).
    // The bids table has NO acceptedAt or updatedAt columns
    // (verified via information_schema 2026-05-27); the runtime
    // fallback chain is kept defensively in case those columns
    // are added in a future migration.
    if (b?.expiresAt) {
      const t = new Date(b.expiresAt).getTime();
      if (!Number.isNaN(t)) return now > t;
    }
    const t = b?.acceptedAt ? new Date(b.acceptedAt).getTime()
            : b?.updatedAt  ? new Date(b.updatedAt).getTime()
            : b?.createdAt  ? new Date(b.createdAt).getTime()
            : 0;
    return t > 0 && now > t + 15 * ONE_MIN_MS;
  }
  if (status === "PENDING") {
    if (b?.auto_accept_at) {
      const t = new Date(b.auto_accept_at).getTime();
      if (!Number.isNaN(t)) return now > t + 15 * ONE_MIN_MS;
    }
    if (b?.expiresAt) {
      const t = new Date(b.expiresAt).getTime();
      if (!Number.isNaN(t)) return now > t;
    }
    // Legacy: derive window from createdAt + flow detection. 6h hard cap
    // matches v193 server cron `mark_stale_pending_bids`.
    const created = b?.createdAt ? new Date(b.createdAt).getTime() : 0;
    if (!created) return false;
    const age = now - created;
    const msg = String(b?.message || "");
    const isPlace = /\bGuest bid\b/i.test(msg) || /max ₹/i.test(msg);
    const flowCap = isPlace ? 1 * ONE_HOUR_MS : 3 * ONE_HOUR_MS;
    return age > Math.min(flowCap, 6 * ONE_HOUR_MS);
  }
  return false;
}

async function findActiveBidOnHotel(
  customerIds: string[],
  hotelId: string,
  currentRequestId?: string | null,
): Promise<any | null> {
  if (!customerIds.length || !hotelId) return null;
  const ids = customerIds.join(",");
  const bids = await sbSelect(
    // v236.1 — Only request columns that exist on bids (verified
    // 2026-05-27 via information_schema.columns). `acceptedAt` +
    // `updatedAt` do NOT exist on this table; requesting them causes
    // PostgREST to 400 → empty array → conflict check broken → user
    // can place duplicate bids (worse than the ghost-conflict bug
    // v236 was fixing). The runtime isBidStale() fallback chain
    // handles missing fields by falling through to `createdAt`.
    `bids?customerId=in.(${ids})&hotelId=eq.${hotelId}&status=in.(PENDING,COUNTER,ACCEPTED)&select=id,hotelId,roomId,requestId,status,amount,counterAmount,expiresAt,createdAt,auto_accept_at,message`
  );
  if (!bids.length) return null;

  // ACCEPTED only locks while there's no paid booking yet.
  const acceptedIds = bids.filter((b: any) => b.status === "ACCEPTED").map((b: any) => b.id);
  let paidByBidId = new Map<string, number>();
  if (acceptedIds.length) {
    const bks = await sbSelect(
      `bookings?bidId=in.(${acceptedIds.join(",")})&select=bidId,paidAmount`
    );
    paidByBidId = new Map(bks.map((b: any) => [b.bidId, Number(b.paidAmount || 0)]));
  }

  let hotelMeta: any = null;
  for (const b of bids) {
    if (b.status === "ACCEPTED" && (paidByBidId.get(b.id) || 0) > 0) continue;
    if (currentRequestId && b.requestId && b.requestId === currentRequestId) continue;
    // v236 — skip stale bids that the cron hasn't swept yet.
    if (isBidStale(b)) continue;
    if (!hotelMeta) {
      const hotels = await sbSelect(`hotels?id=eq.${hotelId}&select=id,name,city`);
      hotelMeta = hotels[0] || { id: hotelId, name: "this hotel", city: "" };
    }
    return {
      bidId:         b.id,
      hotelId:       b.hotelId,
      hotelName:     hotelMeta.name || "this hotel",
      city:          hotelMeta.city || "",
      status:        b.status,
      amount:        b.amount,
      counterAmount: b.counterAmount,
      expiresAt:     b.expiresAt,
    };
  }
  return null;
}

export async function POST(req: NextRequest) {
  const customerId = authUserId(req);
  if (!customerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const p = authPayload(req);
  await ensureUser(customerId, p?.phone, p?.name);

  const body = await req.json().catch(() => ({}));
  const { hotelId, roomId, amount, requestId, dealId, message, flow } = body || {};

  if (!hotelId || !roomId || !amount) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  // Floor-price check (skipped when dealId is present)
  if (!dealId) {
    const rooms = await sbSelect(`rooms?id=eq.${roomId}&select=floorPrice`);
    const floor = rooms[0]?.floorPrice;
    if (floor && Number(amount) < Number(floor)) {
      return NextResponse.json(
        { error: `Amount too low. Minimum: ₹${floor}` },
        { status: 400 }
      );
    }
  }

  // v200 — Pre-flight: 409 if customer already has an active bid on THIS
  // hotel. Skipped for flash-deal bookings — those are instant-purchase,
  // not bids. Per-hotel rule (was per-city in v195) — customer can bid on
  // different hotels in the same city, but only one bid per hotel.
  if (!dealId) {
    const conflict = await findActiveBidOnHotel([customerId], hotelId, requestId);
    if (conflict) {
      return NextResponse.json(
        {
          error: `You already have an active bid on ${conflict.hotelName}. Update its budget instead of placing a new one.`,
          conflict,
        },
        { status: 409 }
      );
    }
  }

  try {
    // v196 Sachin-rule: for /bid (flow="place") broadcasts, hotels whose floor
    // is at or below the customer's offer auto-accept INSTANTLY — the user
    // explicitly asked for this ("jish hotel ne auto accept hui hai unke price
    // rule ke according"). This overrides the v130 "let competition settle"
    // design — Sachin owns the product decision. Negotiate (single hotel) keeps
    // its existing schedule-accept lifecycle via /api/bids/[id]/schedule-accept.
    // We re-read the floor here (not from the earlier check) so dealId-bypass
    // bids never auto-accept (their floor check was skipped).
    let autoAccept = false;
    if (flow === "place" && !dealId) {
      const rooms = await sbSelect(`rooms?id=eq.${roomId}&select=floorPrice`);
      const floor = Number(rooms[0]?.floorPrice || 0);
      autoAccept = floor > 0 && Number(amount) >= floor;
    }

    const bid = await sbInsert("bids", {
      id: genId("bid"),
      customerId,
      hotelId,
      roomId,
      amount: Number(amount),
      requestId: requestId || null,
      status: autoAccept ? "ACCEPTED" : "PENDING",
      message: message || null,
      // Auto-accepted bids open the 15-min pay-window timer (same window the
      // hotel-accept path uses). Pending bids keep their per-flow timer.
      expiresAt: autoAccept
        ? new Date(Date.now() + 15 * 60_000).toISOString()
        : expiresAtFor(flow),
      isBestDeal: false,
    });
    return NextResponse.json({ bid, autoAccepted: autoAccept });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Bid failed" }, { status: 500 });
  }
}
