// POST /api/discover/feed
// Ranked hotel feed for the reels/swipe Discovery mode.
//
// ─── Architecture (hybrid, session-first, server-side ranking) ────────────
//
// Inputs (all optional — cold-start safe):
//   body: {
//     userId?,                  // JWT-resolved id (from Authorization header); fallback to anon
//     limit?,                   // 1–60 (default 30)
//     signals?: {
//       viewedIds?:    string[]        // hotels shown already this session
//       likedIds?:     string[]        // vertical-swipe "engaged" (long dwell, bid, book)
//       skippedIds?:   string[]        // rapid vertical-swipe (skip)
//       cities?:       string[]        // user's preferred cities
//       priceBand?:    [number, number]// Min/max /night the user has engaged with
//       preferAmenities?: string[]     // e.g. ["pool","mountain view"]
//     }
//   }
//
// Scoring per hotel (weights summed, higher = better; range normalized):
//   1. Content-based:
//      • +18  city match with signals.cities
//      • +12  price band overlap (minRoomPrice inside band)
//      • + 8  amenity intersection ratio × 8
//      • + 6  rating ≥ 4 (luxury skew)
//      • + 5  has images (quality proxy)
//   2. Collaborative proxy (popularity):
//      • +  log2(1 + bidCount) × 4           (demand)
//      • +  log2(1 + bookingCount) × 3       (converted demand)
//   3. Behavioral history (logged-in):
//      • +15 if user booked previously here (comeback boost)
//      • -30 if already in viewedIds OR likedIds (avoid repeat)
//      • -60 if in skippedIds (respect signal)
//   4. Exploration (ε-greedy 20%):
//      • Every 5th slot replaced with a random unseen hotel to break the bubble.
//      • Prevents "same 10 hotels forever" over-personalization.
//   5. Freshness:
//      • +  min(6, daysOld^-1 × 6)  for new listings (cold-start boost for hotels)
//
// Output:
//   { items: [ { hotel, score, reasons: string[] } ], nextCursor: null }
//
// Latency: single Supabase roundtrip + in-memory scoring. Typical <120ms.
// Cache: response tagged `Cache-Control: private, max-age=20` so same-session
//        re-pulls are fast, yet live bookings show up within ~20s.

import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_H, authPayload } from "@/lib/sb-server";

export const dynamic = "force-dynamic";

type Signals = {
  viewedIds?: string[];
  likedIds?:  string[];
  skippedIds?: string[];
  cities?:    string[];
  priceBand?: [number, number];
  preferAmenities?: string[];
};

function log2(n: number) { return Math.log(Math.max(1, n)) / Math.LN2; }

export async function POST(req: NextRequest) {
  const payload = authPayload(req);
  const userId = payload?.id || payload?.user_id || payload?.sub || null;

  let body: any = {};
  try { body = await req.json(); } catch {}
  const limit = Math.min(60, Math.max(1, parseInt(body?.limit || "30", 10)));
  const sig: Signals = body?.signals || {};
  const viewed  = new Set(sig.viewedIds  || []);
  const liked   = new Set(sig.likedIds   || []);
  const skipped = new Set(sig.skippedIds || []);
  const prefCities = new Set((sig.cities || []).map(s => s.toLowerCase()));
  const prefAmen   = new Set((sig.preferAmenities || []).map(s => s.toLowerCase()));
  const priceBand  = Array.isArray(sig.priceBand) ? sig.priceBand : null;

  // 1) Pull catalog (hotels + rooms minimally — we don't need everything)
  const [hotelsRes, roomsRes, bidsRes, bookingsRes, userBookingsRes] = await Promise.all([
    fetch(`${SB_URL}/rest/v1/hotels?select=id,name,city,state,lat,lng,amenities,images,avgRating,starRating,createdAt,trustBadge,ownerId`, { headers: SB_H }).then(r => r.json()).catch(() => []),
    fetch(`${SB_URL}/rest/v1/rooms?select=id,hotelId,type,capacity,floorPrice,images,amenities`,                                 { headers: SB_H }).then(r => r.json()).catch(() => []),
    fetch(`${SB_URL}/rest/v1/bids?select=hotelId`,                                                                                { headers: SB_H }).then(r => r.json()).catch(() => []),
    fetch(`${SB_URL}/rest/v1/bookings?select=hotelId`,                                                                            { headers: SB_H }).then(r => r.json()).catch(() => []),
    userId
      ? fetch(`${SB_URL}/rest/v1/bids?customerId=eq.${userId}&status=eq.ACCEPTED&select=hotelId`, { headers: SB_H }).then(r => r.json()).catch(() => [])
      : Promise.resolve([]),
  ]);
  const hotels: any[]   = Array.isArray(hotelsRes) ? hotelsRes : [];
  const rooms: any[]    = Array.isArray(roomsRes) ? roomsRes : [];
  const bids: any[]     = Array.isArray(bidsRes) ? bidsRes : [];
  const bookings: any[] = Array.isArray(bookingsRes) ? bookingsRes : [];
  const userBooked: any[] = Array.isArray(userBookingsRes) ? userBookingsRes : [];

  // 2) Build quick indexes (popularity, min-price, user-history)
  const bidPop:    Record<string, number> = {};
  const bookPop:   Record<string, number> = {};
  bids.forEach(b => { if (b.hotelId) bidPop[b.hotelId]  = (bidPop[b.hotelId]  || 0) + 1; });
  bookings.forEach(b => { if (b.hotelId) bookPop[b.hotelId] = (bookPop[b.hotelId] || 0) + 1; });
  const userBookedSet = new Set(userBooked.map((b: any) => b.hotelId).filter(Boolean));

  const roomsByHotel: Record<string, any[]> = {};
  rooms.forEach(r => { (roomsByHotel[r.hotelId] ||= []).push(r); });

  // 3) Score
  const now = Date.now();
  const scored = hotels.map((h: any) => {
    const hotelRooms = roomsByHotel[h.id] || [];
    const minPrice = hotelRooms.length ? Math.min(...hotelRooms.map(r => r.floorPrice || 99999)) : null;

    const reasons: string[] = [];
    let score = 0;

    // Content-based
    const cityLc = (h.city || "").toLowerCase();
    if (prefCities.has(cityLc))                               { score += 18; reasons.push(`${h.city} matches your taste`); }
    if (priceBand && minPrice != null &&
        minPrice >= priceBand[0] && minPrice <= priceBand[1]) { score += 12; reasons.push("in your price range"); }
    if (Array.isArray(h.amenities) && prefAmen.size) {
      const overlap = h.amenities.filter((a: string) => prefAmen.has(String(a).toLowerCase())).length;
      const ratio = overlap / Math.max(1, prefAmen.size);
      if (ratio > 0) { score += ratio * 8; reasons.push(`${overlap} favourite amenities`); }
    }
    if ((h.avgRating || 0) >= 4) { score += 6; reasons.push(`${h.avgRating?.toFixed(1) || "4+"}★ rated`); }
    if (Array.isArray(h.images) && h.images.length > 0) score += 5;

    // Collaborative proxy
    const bP = bidPop[h.id]  || 0;
    const kP = bookPop[h.id] || 0;
    if (bP) score += log2(1 + bP) * 4;
    if (kP) score += log2(1 + kP) * 3;
    if (bP > 5 || kP > 2) reasons.push("trending right now");

    // Behavioral
    if (userBookedSet.has(h.id))            { score += 15; reasons.push("you've stayed here before"); }
    if (viewed.has(h.id) || liked.has(h.id)) score -= 30;
    if (skipped.has(h.id))                   score -= 60;

    // Freshness cold-start boost
    if (h.createdAt) {
      const daysOld = Math.max(0.5, (now - new Date(h.createdAt).getTime()) / 86400000);
      if (daysOld < 30) { score += Math.min(6, 6 / daysOld); reasons.push("newly listed"); }
    }

    return {
      hotel: { ...h, rooms: hotelRooms, minPrice },
      score,
      reasons: reasons.slice(0, 3),
    };
  });

  // 4) Sort desc by score, then inject ε-greedy exploration every 5th slot
  scored.sort((a, b) => b.score - a.score);
  const mainPool = scored.filter(s => !skipped.has(s.hotel.id));
  const unseenPool = mainPool.filter(s => !viewed.has(s.hotel.id));

  const out: any[] = [];
  const usedIds = new Set<string>();
  let mainIdx = 0;
  for (let i = 0; i < limit; i++) {
    const exploreSlot = (i + 1) % 5 === 0 && unseenPool.length > 0;
    if (exploreSlot) {
      // Random pick from unseen pool (avoid bubble)
      const randIdx = Math.floor(Math.random() * unseenPool.length);
      const pick = unseenPool.splice(randIdx, 1)[0];
      if (pick && !usedIds.has(pick.hotel.id)) {
        usedIds.add(pick.hotel.id);
        out.push({ ...pick, exploration: true });
        continue;
      }
    }
    // Otherwise next highest-score that's not already used
    while (mainIdx < mainPool.length) {
      const cand = mainPool[mainIdx++];
      if (!usedIds.has(cand.hotel.id)) {
        usedIds.add(cand.hotel.id);
        out.push(cand);
        break;
      }
    }
    if (out.length <= i) break; // exhausted
  }

  const res = NextResponse.json({ items: out, nextCursor: null });
  res.headers.set("Cache-Control", "private, max-age=20");
  return res;
}
