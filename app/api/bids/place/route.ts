import { NextRequest, NextResponse } from "next/server";
import { authUserId, authPayload, ensureUser, sbSelect, sbInsert, genId } from "@/lib/sb-server";
import { ACCEPTED_UNPAID_WINDOW_MS } from "@/lib/bid-expiry";
import { computeBidderScore } from "@/lib/bidder-score";

// v241.26 — Server-side tier gate for Hybrid-mode /bid auto-accept. Reuses the
// canonical computeBidderScore (lib/bidder-score) on the customer's last 10
// bids so the tier matches the customer-facing confidence chip EXACTLY and the
// client cannot spoof it. NEW bidders (no history) → false → they wait for the
// partner, mirroring resolveAutoAcceptMs(hybrid, NEW) = Infinity on the
// hotel-page flow. Any failure falls back to false (partner reviews — the safe
// default for hybrid). Note: PostgREST needs camelCase order columns quoted →
// order=%22createdAt%22.desc.
async function isPremiumOrStrong(customerId: string): Promise<boolean> {
  try {
    const hist = await sbSelect(
      `bids?customerId=eq.${customerId}&select=amount,message,roomId&order=%22createdAt%22.desc&limit=10`
    );
    if (!hist.length) return false;
    const roomIds = Array.from(new Set(hist.map((b: any) => b.roomId).filter(Boolean)));
    const rooms = roomIds.length
      ? await sbSelect(`rooms?id=in.(${roomIds.join(",")})&select=id,floorPrice`)
      : [];
    const floorById = new Map(rooms.map((r: any) => [r.id, Number(r.floorPrice || 0)]));
    const items = hist.map((b: any) => ({
      amount: Number(b.amount),
      message: b.message,
      floorPrice: floorById.get(b.roomId),
    }));
    const tier = computeBidderScore(items).tier;
    return tier === "PREMIUM" || tier === "STRONG";
  } catch {
    return false;
  }
}

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
    return t > 0 && now > t + ACCEPTED_UNPAID_WINDOW_MS;
  }
  if (status === "PENDING") {
    if (b?.auto_accept_at) {
      const t = new Date(b.auto_accept_at).getTime();
      // v241.22 — auto_accept_at + 15min grace stays as-is (this is
      // the legacy fixed grace for missed crons, distinct from the
      // ACCEPTED-unpaid pay window). Auto-accept itself runs at
      // auto_accept_at; the +15min is just slack.
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
  const { hotelId, roomId, amount, requestId, dealId, message, flow, numRooms, guests } = body || {};

  if (!hotelId || !roomId || !amount) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  // v241 — Customer's numRooms for THIS hotel. Schema CHECK 1–10.
  // Defaults to 1 when caller omits the field (Book Now / Flash flows).
  // The customer's intent for the WHOLE broadcast is on
  // `bid_requests.numRoomsRequested`; this is the per-bid resolved value.
  const numRoomsClamped = Math.max(1, Math.min(10, Math.floor(Number(numRooms) || 1)));
  // v241 — guests resolves from body first; fall back to the linked
  // bid_request row so legacy hotel-page callers (Negotiate / Book Now)
  // that send only `requestId` still get capacityMismatch flagged
  // correctly. Cheap single-row REST lookup; only fires when body omits.
  let guestsClamped = Math.max(1, Math.floor(Number(guests) || 0));
  if (!guestsClamped && requestId) {
    try {
      const reqRows = await sbSelect(`bid_requests?id=eq.${requestId}&select=guests,"numRoomsRequested"`);
      if (reqRows[0]) {
        guestsClamped = Math.max(1, Math.floor(Number(reqRows[0].guests) || 1));
      }
    } catch { /* non-blocking */ }
  }
  if (!guestsClamped) guestsClamped = 1;

  // Floor-price check (skipped when dealId is present). Floor stays
  // per-room-per-night — amount × nights × numRooms is the final
  // charge, but the floor compares 1:1 against amount.
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

  // v241 — Inventory + capacity resolution against THIS hotel's actual
  // room row. `rooms.quantity` is what the partner configured for total
  // units of this category; `rooms.capacity` is guests-per-unit (default
  // 2 from partner panel). Two checks:
  //   1. INVENTORY — if numRoomsClamped > quantity, the hotel literally
  //      doesn't have that many of this category. Return 409 with the
  //      configured quantity so the customer can adjust.
  //   2. CAPACITY MISMATCH — flag-only (no rejection) when guests >
  //      capacity × numRooms. Partner inbox surfaces yellow chip; hotel
  //      decides counter-with-more-rooms or accept-anyway.
  // Skip on dealId-bypass flows (flash) — those have their own
  // hotel_room_units availability path.
  let capacityMismatch = false;
  if (!dealId) {
    const roomRows = await sbSelect(`rooms?id=eq.${roomId}&select=capacity,quantity,type,name`);
    const roomRow = roomRows[0];
    const roomCapacity = Number(roomRow?.capacity || 2);
    const roomQuantity = roomRow?.quantity == null ? null : Number(roomRow.quantity);
    const roomLabel = roomRow?.name || roomRow?.type || "this room";

    if (roomQuantity != null && numRoomsClamped > roomQuantity) {
      return NextResponse.json(
        {
          error: `This hotel has only ${roomQuantity} ${roomLabel} room${roomQuantity === 1 ? "" : "s"} available. Reduce your room count or pick a different hotel.`,
          maxAvailable: roomQuantity,
        },
        { status: 409 }
      );
    }

    capacityMismatch = guestsClamped > roomCapacity * numRoomsClamped;
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
      const aboveFloor = floor > 0 && Number(amount) >= floor;
      if (aboveFloor) {
        // v241.26 — respect the hotel's Autopilot mode on the /bid instant-
        // accept path. Pre-v241 (v196) auto-accepted EVERY above-floor /bid
        // bid regardless of mode, so a Manual hotel still auto-confirmed and a
        // Hybrid hotel auto-confirmed low-tier bidders — both violating the
        // mode spec (the hotel-page Negotiate/Book-Now flow already respects
        // mode via lib/autopilot.resolveAutoAcceptMs + /schedule-accept; only
        // this /bid path bypassed it). Now:
        //   • auto   → instant accept (unchanged — the default for most hotels)
        //   • manual → never auto-accept; bid stays PENDING for partner review
        //   • hybrid → only PREMIUM/STRONG auto-accept (server-computed tier)
        let mode = "auto";
        try {
          const hRows = await sbSelect(`hotels?id=eq.${hotelId}&select=autopilot_mode&limit=1`);
          const m = String(hRows[0]?.autopilot_mode || "auto");
          if (m === "auto" || m === "hybrid" || m === "manual") mode = m;
        } catch { /* column missing / unreachable → 'auto' (lib/autopilot parity) */ }

        if (mode === "manual") {
          autoAccept = false;
        } else if (mode === "hybrid") {
          autoAccept = await isPremiumOrStrong(customerId);
        } else {
          autoAccept = true; // 'auto'
        }
      }
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
        ? new Date(Date.now() + ACCEPTED_UNPAID_WINDOW_MS).toISOString()
        : expiresAtFor(flow),
      isBestDeal: false,
      // v241 — multi-room support. Denormalized so /api/bids/my doesn't
      // need a join + /my-bids charge math reads it directly.
      numRooms: numRoomsClamped,
      capacityMismatch,
    });
    return NextResponse.json({ bid, autoAccepted: autoAccept });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Bid failed" }, { status: 500 });
  }
}
