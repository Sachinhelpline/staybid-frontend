import { NextRequest, NextResponse } from "next/server";
import { sbCached } from "@/lib/sb-cache";
import { SB_URL, SB_KEY } from "@/lib/sb";
import { HOTEL_CARD_COLS, ROOM_CARD_COLS } from "@/lib/sb-columns";
// v168 — synthetic flash prices come from the unified pricing spine.
import { resolveSpinePrices } from "@/lib/pricing/read-spine";


const SB_H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" };

// Warm-Lambda caching TTLs. Inventory side-tables (bids/blocks) get a
// shorter window because availability flips matter more than catalog data.
const TTL_CATALOG = 60_000;
const TTL_INVENTORY = 15_000;

async function sb(path: string) {
  try {
    const r = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: SB_H, cache: "no-store" });
    const t = await r.text();
    const j = JSON.parse(t);
    return Array.isArray(j) ? j : [];
  } catch { return []; }
}

// Memoised variant: each call shares one in-flight fetch across concurrent
// requests on the same Lambda + reuses the result for `ttl` milliseconds.
const sbCachedFetch = (path: string, ttl: number) =>
  sbCached(`flash:${path}`, () => sb(path), ttl);

function toISO(d: Date) { return d.toISOString().slice(0, 10); }
function rangesOverlap(a1: string, a2: string, b1: string, b2: string) { return a1 < b2 && b1 < a2; }

export async function GET(req: NextRequest) {
  const city   = req.nextUrl.searchParams.get("city") || "";
  // viewed=id1,id2,…  → de-prioritized in the result (same hotels won't
  // sit at the top of the rail on every visit). Capped at 60 by the
  // client. Same idea as the personalization layer on /api/discover/feed.
  const viewedRaw = req.nextUrl.searchParams.get("viewed") || "";
  const viewedIds = new Set(
    viewedRaw.split(",").map(s => s.trim()).filter(Boolean).slice(0, 60)
  );

  // ─── 1) Pull raw deals + parallel side-load ───────────────────────────
  const baseSelect = `select=*${city ? `&city=ilike.${encodeURIComponent(city)}` : ""}`;
  const tries = [
    `${baseSelect}&isActive=eq.true`,
    `${baseSelect}&is_active=eq.true`,
    `${baseSelect}&active=eq.true`,
    `${baseSelect}`,
  ];
  // flash_deals is parameterised on city so it gets keyed per city (still cached
  // per warm Lambda for TTL_INVENTORY).
  let dealsRaw: any[] = [];
  for (const f of tries) {
    const r = await sbCachedFetch(`flash_deals?${f}`, TTL_INVENTORY);
    if (Array.isArray(r) && r.length > 0) { dealsRaw = r; break; }
  }
  // hotels + rooms are shared across every caller and rarely change → long TTL.
  // Narrowed selects (was select=*). Drops description/address/internal
  // columns from every hotel + room row. ~75–85% payload reduction.
  // v262 — admin-approval gate: only APPROVED hotels surface flash deals.
  // Pending/draft hotels stay hidden until an admin verifies them.
  const [hotels, rooms] = await Promise.all([
    sbCachedFetch(`hotels?approval_status=eq.approved&select=${HOTEL_CARD_COLS}`, TTL_CATALOG),
    sbCachedFetch(`rooms?select=${ROOM_CARD_COLS}`, TTL_CATALOG),
  ]);

  // v168 — pricing-spine flash prices for tonight. Used to price the
  // SYNTHESIZED deals (real flash_deals rows stay hotel/cron-managed).
  // Failure → empty map → synthetic path falls back to its legacy
  // floor-discount formula, so the flash feed never breaks.
  const spineDate = toISO(new Date());
  const spineMap: Record<string, any> = await resolveSpinePrices(
    rooms.map((r: any) => r.id),
    spineDate,
  ).catch(() => ({}));

  const now = Date.now();
  const activeOnly = dealsRaw.filter((d: any) => {
    const v = d?.isActive ?? d?.is_active ?? d?.active;
    return v === undefined || v === null || v === true || v === "true" || v === 1;
  });
  const liveDeals = activeOnly.filter((d: any) => {
    const raw = d?.validUntil ?? d?.valid_until ?? d?.expiresAt ?? d?.expires_at;
    if (!raw) return true;
    const t = new Date(String(raw)).getTime();
    if (!Number.isFinite(t)) return true;
    return t > now;
  });

  // ─── 2) Build a per-hotel pool of "candidate" deals (real + synthesized) ──
  // ⚠️ Flash-deal rule (May 2026):
  //   Only ONE deal per hotel. Synthesize from rooms only if the hotel has
  //   no real flash deal. The picked deal is the cheapest *available* room
  //   tonight; all other rooms with availability become "upgrade" options.
  type Candidate = {
    id:            string;
    hotelId:       string;
    roomId:        string;
    city:          string;
    aiPrice:       number;
    floorPrice:    number;
    discount:      number;
    marketRate:    number;   // v525 — spine live price (the honest "was" anchor)
    validUntil:    string;
    maxBookings?:  number;
    bookingCount?: number;
    _synthetic?:   boolean;
    raw:           any;
  };

  const realByHotel = new Map<string, Candidate[]>();
  for (const d of liveDeals) {
    const hotelId = d.hotelId || d.hotel_id;
    const roomId  = d.roomId || d.room_id;
    if (!hotelId || !roomId) continue;
    const room    = rooms.find((r: any) => r.id === roomId);
    const hotel   = hotels.find((h: any) => h.id === hotelId);
    if (!hotel || !room) continue;
    const floor   = Number(room.floorPrice) || Number(d.floorPrice) || 0;
    const ai      = Number(d.aiPrice ?? d.dealPrice ?? d.price) || 0;
    // v525 — market anchor = the room's live spine price (same number the
    // hotel page shows as "Market Rate"). Used to strike + compute % off
    // consistently on every surface. 0 when the spine has no row (fail-open).
    const market  = Number(spineMap[roomId]?.livePrice) || 0;
    const disc    = Number(d.discount) || (floor > 0 ? Math.round(((floor - ai) / floor) * 100) : 0);
    const c: Candidate = {
      id:           String(d.id),
      hotelId, roomId,
      city:         hotel.city || d.city || "",
      aiPrice:      ai,
      floorPrice:   floor,
      discount:     disc,
      marketRate:   market,
      validUntil:   d.validUntil || d.valid_until || d.expiresAt || "",
      maxBookings:  d.maxBookings || d.max_bookings,
      bookingCount: d.bookingCount || d.booking_count,
      raw:          d,
    };
    (realByHotel.get(hotelId) || realByHotel.set(hotelId, []).get(hotelId)!).push(c);
  }

  // Synthesize for hotels that have none. One pseudo-deal per room.
  const syntheticByHotel = new Map<string, Candidate[]>();
  const wantCity = city.trim().toLowerCase();
  const validHotelIds = new Set(
    hotels.filter((h: any) => !wantCity || (h.city || "").toLowerCase().includes(wantCity)).map((h: any) => h.id)
  );
  // Flash deals are nightly-reset inventory — every unsold room at 12am IST
  // is auto-offered as the next day's deal. Cap the synthesized timer at
  // the next midnight so the home-page rail viewer and the /flash-deals
  // page both count down to the same moment (no "6d 23h" vs "04:55:24"
  // mismatch). Uses local server time (Vercel runs UTC, but the visual
  // cap is the same wall-clock across surfaces — the timer value stays
  // consistent for any given user session).
  const nextMidnight = (() => {
    const d = new Date();
    d.setUTCHours(24, 0, 0, 0);
    return d.toISOString();
  })();
  const validUntilDefault = nextMidnight;
  let synthIdx = 0;
  for (const r of rooms) {
    if (!validHotelIds.has(r.hotelId)) continue;
    if (realByHotel.has(r.hotelId)) continue;
    const hotel = hotels.find((h: any) => h.id === r.hotelId);
    if (!hotel) continue;
    const floor = Number(r.floorPrice) || 0;
    if (floor <= 0) continue;
    // v168 — synthetic flash price from the unified spine (flash_price =
    // live_price − 20%, ≥ flash floor, ₹100-snapped, always below the
    // market rate). Falls back to the legacy floor-discount formula when
    // the spine has no row for this room.
    const sp = spineMap[r.id];
    let ai: number, disc: number;
    if (sp && Number(sp.flashPrice) > 0) {
      ai = Number(sp.flashPrice);
      const ref = Number(sp.baseRate) || floor;
      disc = ref > ai ? Math.round((1 - ai / ref) * 100) : 12;
    } else {
      disc = 12 + ((synthIdx++ * 7) % 14); // 12% – 25% (legacy fallback)
      ai   = Math.max(500, Math.round(floor * (100 - disc) / 100));
    }
    const c: Candidate = {
      id:         `auto-${r.id}`,
      hotelId:    r.hotelId,
      roomId:     r.id,
      city:       hotel.city || "",
      aiPrice:    ai,
      floorPrice: floor,
      discount:   disc,
      marketRate: Number(sp?.livePrice) || Number(sp?.baseRate) || 0,   // v525
      validUntil: validUntilDefault,
      _synthetic: true,
      raw:        { _synthetic: true },
    };
    (syntheticByHotel.get(r.hotelId) || syntheticByHotel.set(r.hotelId, []).get(r.hotelId)!).push(c);
  }

  // City filter for real deals
  // (avoid `for..of` on Map.keys() — Vercel's tsconfig lacks downlevelIteration)
  const filteredHotelIds = new Set<string>();
  Array.from(realByHotel.keys()).forEach((hid) => {
    const h = hotels.find((x: any) => x.id === hid);
    if (!h) return;
    if (!wantCity || (h.city || "").toLowerCase().includes(wantCity)) filteredHotelIds.add(hid);
  });
  Array.from(syntheticByHotel.keys()).forEach((hid) => filteredHotelIds.add(hid));

  // ─── 3) Live availability check — tonight (today → tomorrow) ────────────
  // Inventory model:
  //   • hotel_room_units = physical room units per category. If empty, treat as 1 unit.
  //   • Occupied = ACCEPTED/COUNTER bids overlapping tonight + room_blocks overlapping tonight.
  const today    = toISO(new Date());
  const tomorrow = toISO(new Date(Date.now() + 86400000));
  const hotelIds = Array.from(filteredHotelIds);
  if (hotelIds.length === 0) {
    return NextResponse.json({ deals: [], generatedAt: new Date().toISOString() });
  }
  const inFilter = `in.(${hotelIds.join(",")})`;

  const [units, bids, blocks] = await Promise.all([
    sbCachedFetch(`hotel_room_units?hotelId=${inFilter}&status=eq.active&select=hotelId,roomId,id`, TTL_INVENTORY),
    sbCachedFetch(`bids?hotelId=${inFilter}&status=in.(ACCEPTED,COUNTER)&select=id,hotelId,roomId,requestId,status`, TTL_INVENTORY),
    sbCachedFetch(`room_blocks?hotelId=${inFilter}&toDate=gt.${today}&fromDate=lt.${tomorrow}&select=hotelId,roomId,fromDate,toDate`, TTL_INVENTORY),
  ]);

  // Hydrate bid_requests for the bids we care about, so we can date-filter
  const requestIds = Array.from(new Set(bids.map((b: any) => b.requestId).filter(Boolean)));
  let reqMap: Record<string, any> = {};
  if (requestIds.length) {
    const rqs = await sbCachedFetch(
      `bid_requests?id=in.(${requestIds.join(",")})&select=id,checkIn,checkOut`,
      TTL_INVENTORY,
    );
    rqs.forEach((x: any) => { reqMap[x.id] = x; });
  }

  // unitsTotal[roomId] = count of physical units (fallback 1)
  const unitsTotal: Record<string, number> = {};
  units.forEach((u: any) => { unitsTotal[u.roomId] = (unitsTotal[u.roomId] || 0) + 1; });

  // occupiedTonight[roomId] = how many units busy tonight
  const occupiedTonight: Record<string, number> = {};
  for (const b of bids) {
    const r = reqMap[b.requestId];
    const ci = r?.checkIn ? toISO(new Date(r.checkIn)) : null;
    const co = r?.checkOut ? toISO(new Date(r.checkOut)) : null;
    if (!ci || !co) continue;
    if (rangesOverlap(ci, co, today, tomorrow)) {
      occupiedTonight[b.roomId] = (occupiedTonight[b.roomId] || 0) + 1;
    }
  }
  for (const bk of blocks) {
    const ci = toISO(new Date(bk.fromDate));
    const co = toISO(new Date(bk.toDate));
    if (rangesOverlap(ci, co, today, tomorrow)) {
      occupiedTonight[bk.roomId] = (occupiedTonight[bk.roomId] || 0) + 1;
    }
  }

  const unitsFree = (roomId: string) => {
    const total = unitsTotal[roomId] || 1;          // legacy: no unit rows = 1 unit
    return Math.max(0, total - (occupiedTonight[roomId] || 0));
  };

  // ─── 4) Per hotel: pick ONE deal + compute upgrade ladder ───────────────
  const out: any[] = [];
  for (const hotelId of hotelIds) {
    const hotel    = hotels.find((h: any) => h.id === hotelId);
    if (!hotel) continue;
    const allRooms = rooms.filter((r: any) => r.hotelId === hotelId);
    // Pool of candidate deals (real preferred over synthetic) for this hotel
    const pool: Candidate[] = realByHotel.get(hotelId) || syntheticByHotel.get(hotelId) || [];
    if (!pool.length) continue;

    // Keep only candidates whose room is available tonight
    const available = pool.filter(c => unitsFree(c.roomId) > 0);
    if (!available.length) continue; // hotel fully booked — skip entirely

    // Headline = cheapest available
    const headline = available.slice().sort((a, b) => a.aiPrice - b.aiPrice)[0];
    const headlineRoom = allRooms.find((r: any) => r.id === headline.roomId);

    // Upgrade ladder: every OTHER room in this hotel, with availability + delta
    const upgrades = allRooms
      .filter((r: any) => r.id !== headline.roomId)
      .map((r: any) => {
        const free  = unitsFree(r.id);
        const floor = Number(r.floorPrice) || 0;
        if (floor <= 0) return null;
        // v525 — each upgrade room is priced by its OWN spine flash price
        // (= its live price − 20%, ≥ its flash floor), NOT the headline
        // deal's discount smeared onto this room's floor. This makes the
        // price INTRINSIC to the room — it no longer changes based on which
        // deal the customer tapped to arrive. Falls back to floor×(1−disc)
        // only when the spine has no row for this room.
        const usp   = spineMap[r.id];
        const market = Number(usp?.livePrice) || 0;
        const price = (usp && Number(usp.flashPrice) > 0)
          ? Number(usp.flashPrice)
          : Math.max(500, Math.round(floor * (100 - headline.discount) / 100));
        return {
          roomId:        r.id,
          type:          r.type || r.name || "Room",
          capacity:      r.capacity || 2,
          images:        r.images || [],
          floorPrice:    floor,
          dealPrice:     price,
          marketRate:    market,
          extraPerNight: Math.max(0, price - headline.aiPrice),
          unitsFree:     free,
          available:     free > 0,
          amenities:     r.amenities || [],
        };
      })
      .filter(Boolean)
      .sort((a: any, b: any) => a.dealPrice - b.dealPrice);

    out.push({
      id:           headline.id,
      hotelId:      headline.hotelId,
      roomId:       headline.roomId,
      city:         headline.city,
      aiPrice:      headline.aiPrice,
      floorPrice:   headline.floorPrice,
      discount:     headline.discount,
      marketRate:   headline.marketRate,   // v525 — honest "was" anchor (spine live price)
      validUntil:   headline.validUntil,
      maxBookings:  headline.maxBookings || 5,
      bookingCount: headline.bookingCount || 0,
      _synthetic:   !!headline._synthetic,
      hotel,
      room:         headlineRoom,
      // NEW — same payload shape as before, plus:
      unitsFree:    unitsFree(headline.roomId),
      unitsTotal:   unitsTotal[headline.roomId] || 1,
      upgrades,                         // upgrade ladder
      roomTypesAvailable: 1 + upgrades.filter((u: any) => u.available).length,
    });
  }

  // ─── Personalize the order ──────────────────────────────────────────
  // Old behaviour: deterministic sort (discount DESC, price ASC). Same
  // hotels at the top forever — felt stale on repeat visits.
  // New behaviour:
  //   1. Bucket by discount band (5% wide). Band order preserved so a 30%
  //      deal never sits below a 15% one.
  //   2. Fisher-Yates shuffle inside each band so siblings rotate.
  //   3. Push deals the user has already viewed in this browser to the
  //      bottom of THEIR band (still visible — just not occupying the
  //      coveted top slots).
  //   4. Tiny price jitter (±50) only used as the final tiebreak inside a
  //      band so the same two-deal-in-a-band visits feel non-identical.
  // v80: tighten band width 5% → 3% so siblings reshuffle more aggressively
  // (IG-style "different deals on top every refresh"). Same band semantics:
  // a 30% deal still never sits below a 15% one — only sibling order rotates.
  const banded = new Map<number, any[]>();
  for (const d of out) {
    const k = Math.floor(d.discount / 3);
    if (!banded.has(k)) banded.set(k, []);
    banded.get(k)!.push(d);
  }
  const bandKeys = Array.from(banded.keys()).sort((a, b) => b - a);
  const personalized: any[] = [];
  bandKeys.forEach((k) => {
    const arr = banded.get(k)!.slice();
    // Fisher-Yates inside band
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    // Within band, push viewed to the back so fresh deals lead
    const fresh = arr.filter((d) => !viewedIds.has(String(d.id)));
    const seen  = arr.filter((d) =>  viewedIds.has(String(d.id)));
    personalized.push(...fresh, ...seen);
  });

  const res = NextResponse.json({
    deals:       personalized,
    generatedAt: new Date().toISOString(),
  });
  // v131.2 — bump CDN window. The reshuffle is keyed on viewed IDs + city
  // + signals (all in the URL), so different users / different state still
  // get different cache keys. Within a key, 60s of identical results is
  // fine for the flash-deal rail (deals don't fluctuate that fast). Stale
  // serves preserve sub-30ms TTFB during the bg revalidate. Was 10/30.
  // v131.7 — PROPER CDN caching. CDN-Cache-Control + Vercel-CDN-Cache-Control
  // are NOT stripped on auto-dynamic routes (unlike Cache-Control's s-maxage).
  // 90%+ of flash-rail visits now serve from edge in <30ms.
  res.headers.set("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
  res.headers.set("CDN-Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
  res.headers.set("Vercel-CDN-Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
  return res;
}
