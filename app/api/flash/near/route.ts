import { NextRequest, NextResponse } from "next/server";

const SB_URL = "https://uxxhbdqedazpmvbvaosh.supabase.co";
const SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV4eGhiZHFlZGF6cG12YnZhb3NoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxMTIwMDgsImV4cCI6MjA5MDY4ODAwOH0.mBhr1tNlail5u0D_dj3ljA9oRZvZ7_2_0-lt7I6cJ60";
const SB_H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" };

async function sb(path: string) {
  try {
    const r = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: SB_H });
    const t = await r.text();
    const j = JSON.parse(t);
    return Array.isArray(j) ? j : [];
  } catch { return []; }
}

function toISO(d: Date) { return d.toISOString().slice(0, 10); }
function rangesOverlap(a1: string, a2: string, b1: string, b2: string) { return a1 < b2 && b1 < a2; }

export async function GET(req: NextRequest) {
  const city = req.nextUrl.searchParams.get("city") || "";

  // ─── 1) Pull raw deals + parallel side-load ───────────────────────────
  const baseSelect = `select=*${city ? `&city=ilike.${encodeURIComponent(city)}` : ""}`;
  const tries = [
    `${baseSelect}&isActive=eq.true`,
    `${baseSelect}&is_active=eq.true`,
    `${baseSelect}&active=eq.true`,
    `${baseSelect}`,
  ];
  let dealsRaw: any[] = [];
  for (const f of tries) {
    const r = await sb(`flash_deals?${f}`);
    if (Array.isArray(r) && r.length > 0) { dealsRaw = r; break; }
  }
  const [hotels, rooms] = await Promise.all([
    sb(`hotels?select=*`),
    sb(`rooms?select=*`),
  ]);

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
    const disc    = Number(d.discount) || (floor > 0 ? Math.round(((floor - ai) / floor) * 100) : 0);
    const c: Candidate = {
      id:           String(d.id),
      hotelId, roomId,
      city:         hotel.city || d.city || "",
      aiPrice:      ai,
      floorPrice:   floor,
      discount:     disc,
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
  const validUntilDefault = new Date(Date.now() + 7 * 86400000).toISOString();
  let synthIdx = 0;
  for (const r of rooms) {
    if (!validHotelIds.has(r.hotelId)) continue;
    if (realByHotel.has(r.hotelId)) continue;
    const hotel = hotels.find((h: any) => h.id === r.hotelId);
    if (!hotel) continue;
    const floor = Number(r.floorPrice) || 0;
    if (floor <= 0) continue;
    const disc  = 12 + ((synthIdx++ * 7) % 14); // 12% – 25%
    const ai    = Math.max(500, Math.round(floor * (100 - disc) / 100));
    const c: Candidate = {
      id:         `auto-${r.id}`,
      hotelId:    r.hotelId,
      roomId:     r.id,
      city:       hotel.city || "",
      aiPrice:    ai,
      floorPrice: floor,
      discount:   disc,
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
    sb(`hotel_room_units?hotelId=${inFilter}&status=eq.active&select=hotelId,roomId,id`),
    sb(`bids?hotelId=${inFilter}&status=in.(ACCEPTED,COUNTER)&select=id,hotelId,roomId,requestId,status`),
    sb(`room_blocks?hotelId=${inFilter}&toDate=gt.${today}&fromDate=lt.${tomorrow}&select=hotelId,roomId,fromDate,toDate`),
  ]);

  // Hydrate bid_requests for the bids we care about, so we can date-filter
  const requestIds = Array.from(new Set(bids.map((b: any) => b.requestId).filter(Boolean)));
  let reqMap: Record<string, any> = {};
  if (requestIds.length) {
    const rqs = await sb(`bid_requests?id=in.(${requestIds.join(",")})&select=id,checkIn,checkOut`);
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
        // Apply the same discount % as the headline so deal feel is consistent
        const price = Math.max(500, Math.round(floor * (100 - headline.discount) / 100));
        return {
          roomId:        r.id,
          type:          r.type || r.name || "Room",
          capacity:      r.capacity || 2,
          images:        r.images || [],
          floorPrice:    floor,
          dealPrice:     price,
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

  // Sort: biggest discount first, then cheapest
  out.sort((a, b) => (b.discount - a.discount) || (a.aiPrice - b.aiPrice));

  return NextResponse.json({
    deals:       out,
    generatedAt: new Date().toISOString(),
  });
}
