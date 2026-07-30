// v124 — Public read-only "Auction Pit" insights for the bid page.
//
// Returns:
//   - tonightAuctions:  open bid_requests created in last 24h (city-scoped if ?city=)
//   - acceptedToday:    bids accepted today (city-scoped if ?city=)
//   - avgAcceptMins:    median minutes between accepted bid createdAt and updatedAt
//   - hotelsListening:  count of CUSTOMER-BOOKABLE hotels in the city (or platform
//                       if no city). Gated exactly like /api/hotels —
//                       approval_status='approved' + launch curation — because a
//                       bid placed on /bid can only ever reach that catalog
//                       (submit() calls api.getHotels → the curated /api/hotels).
//                       Counting the raw hotels table here printed "88 hotels
//                       taking offers" on the home band next to the ticker's
//                       "31 properties live" (v579 consistency fix).
//   - cityHotStreak:    accepted bids in last 60 min (city-scoped if ?city=)
//   - recentWins[]:     last 5 accepted bids — first-letter only initials, sanitized
//
// All data is REAL — reads only from existing bids + bid_requests + hotels +
// users tables. The same tables already power /api/admin/analytics/bidding
// (admin) and /api/partner/bids (hotel partner panel), so we're not introducing
// any new data surface — just exposing read-only city-scoped slices to the
// customer-facing bid page.
//
// Cache: 30s SWR via sb-cache. Catalog is fine being a few seconds stale —
// the page rotates the ticker visibly so users feel freshness regardless.

import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_KEY } from "@/lib/sb";
import { sbCached } from "@/lib/sb-cache";
import { curateHotels } from "@/lib/launch/curation";

const SB_H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" };
const TTL = 30_000;

function maskName(raw?: string | null): string {
  if (!raw || typeof raw !== "string") return "Guest";
  const t = raw.trim();
  if (!t) return "Guest";
  // Anti-PII: first letter + period + dot (e.g. "Sneha" -> "S.")
  return `${t.charAt(0).toUpperCase()}.`;
}

function timeAgo(iso?: string | null): string {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "";
  const m = Math.floor(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const city = (searchParams.get("city") || "").trim();
  const cityKey = city ? city.toLowerCase() : "_all_";

  // Cache key includes city so each city gets its own slot.
  const data = await sbCached(`bid-insights:${cityKey}`, async () => {
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const since1h  = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const sinceToday = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();

    // Build city filter for hotels (used to scope bids to a city via hotelId IN(..)).
    // BOTH branches apply the SAME customer-catalog gate as /api/hotels
    // (approval_status='approved' + curateHotels — fail-open with the curation
    // flag), so every surface reading this route prints the same universe the
    // ticker, /hotels and /bid submit() actually operate on.
    let hotelIdsInCity: string[] = [];
    let hotelsListening = 0;
    if (city) {
      const hotelsRes = await fetch(
        `${SB_URL}/rest/v1/hotels?city=ilike.${encodeURIComponent(city)}*&approval_status=eq.approved&select=id`,
        { headers: SB_H }
      );
      const hotelRows = await hotelsRes.json().catch(() => []);
      if (Array.isArray(hotelRows)) {
        hotelIdsInCity = curateHotels(hotelRows).map((h: any) => h.id).filter(Boolean);
        hotelsListening = hotelIdsInCity.length;
      }
    } else {
      const allRes = await fetch(
        `${SB_URL}/rest/v1/hotels?approval_status=eq.approved&select=id&limit=1000`,
        { headers: SB_H }
      );
      const allRows = await allRes.json().catch(() => []);
      hotelsListening = Array.isArray(allRows) ? curateHotels(allRows).length : 0;
    }

    const hotelFilter = hotelIdsInCity.length ? `&hotelId=in.(${hotelIdsInCity.join(",")})` : "";

    // Tonight's open auctions (bid_requests, last 24h)
    const tonightUrl = city
      ? `${SB_URL}/rest/v1/bid_requests?city=ilike.${encodeURIComponent(city)}*&createdAt=gte.${since24h}&select=id`
      : `${SB_URL}/rest/v1/bid_requests?createdAt=gte.${since24h}&select=id`;
    const tonightRes = await fetch(tonightUrl, { headers: { ...SB_H, Prefer: "count=exact" } });
    const tonightAuctions = Number((tonightRes.headers.get("content-range") || "").split("/")[1]) || 0;

    // Bids accepted today
    const acceptedTodayUrl = `${SB_URL}/rest/v1/bids?status=eq.ACCEPTED&updatedAt=gte.${sinceToday}${hotelFilter}&select=id`;
    const atRes = await fetch(acceptedTodayUrl, { headers: { ...SB_H, Prefer: "count=exact" } });
    const acceptedToday = Number((atRes.headers.get("content-range") || "").split("/")[1]) || 0;

    // Hot streak: accepted bids in last 60 min, city-scoped
    const streakUrl = `${SB_URL}/rest/v1/bids?status=eq.ACCEPTED&updatedAt=gte.${since1h}${hotelFilter}&select=id`;
    const streakRes = await fetch(streakUrl, { headers: { ...SB_H, Prefer: "count=exact" } });
    const cityHotStreak = Number((streakRes.headers.get("content-range") || "").split("/")[1]) || 0;

    // Recent wins: last 8 accepted bids, joined with hotel name + customer first-letter
    const wonUrl = `${SB_URL}/rest/v1/bids?status=eq.ACCEPTED${hotelFilter}&select=id,amount,hotelId,customerId,updatedAt,counterAmount&order=updatedAt.desc&limit=8`;
    const wonRes = await fetch(wonUrl, { headers: SB_H });
    const wonRaw = await wonRes.json().catch(() => []);
    const won: any[] = Array.isArray(wonRaw) ? wonRaw : [];

    let wins: any[] = [];
    if (won.length > 0) {
      const hIds = Array.from(new Set(won.map((b: any) => b.hotelId).filter(Boolean)));
      const cIds = Array.from(new Set(won.map((b: any) => b.customerId).filter(Boolean)));

      const [hotels, customers] = await Promise.all([
        hIds.length
          ? fetch(`${SB_URL}/rest/v1/hotels?id=in.(${hIds.join(",")})&select=id,name,city`, { headers: SB_H }).then(r => r.json()).catch(() => [])
          : Promise.resolve([]),
        cIds.length
          ? fetch(`${SB_URL}/rest/v1/users?id=in.(${cIds.join(",")})&select=id,name`, { headers: SB_H }).then(r => r.json()).catch(() => [])
          : Promise.resolve([]),
      ]);

      const hById: Record<string, any> = {};
      (Array.isArray(hotels) ? hotels : []).forEach((h: any) => { hById[h.id] = h; });
      const cById: Record<string, any> = {};
      (Array.isArray(customers) ? customers : []).forEach((c: any) => { cById[c.id] = c; });

      wins = won.map((b: any) => {
        const h = hById[b.hotelId];
        const c = cById[b.customerId];
        const finalAmount = Number(b.counterAmount) > 0 ? Number(b.counterAmount) : Number(b.amount);
        return {
          id: b.id,
          initial: maskName(c?.name),
          amount: finalAmount,
          hotelName: h?.name || "a hotel",
          city: h?.city || "",
          when: timeAgo(b.updatedAt),
        };
      });
    }

    // Avg accept time — diff between updatedAt and createdAt for last 30 accepted bids
    const speedUrl = `${SB_URL}/rest/v1/bids?status=eq.ACCEPTED${hotelFilter}&select=createdAt,updatedAt&order=updatedAt.desc&limit=30`;
    const speedRes = await fetch(speedUrl, { headers: SB_H });
    const speedRaw = await speedRes.json().catch(() => []);
    const speeds: number[] = (Array.isArray(speedRaw) ? speedRaw : [])
      .map((b: any) => {
        const a = new Date(b.createdAt || 0).getTime();
        const z = new Date(b.updatedAt || 0).getTime();
        const m = (z - a) / 60000;
        return Number.isFinite(m) && m >= 0 && m < 60 * 24 ? m : null;
      })
      .filter((x: any) => x !== null) as number[];
    speeds.sort((a, b) => a - b);
    const median = speeds.length ? speeds[Math.floor(speeds.length / 2)] : 0;

    return {
      tonightAuctions,
      acceptedToday,
      hotelsListening,
      cityHotStreak,
      avgAcceptMins: Math.round(median),
      recentWins: wins.slice(0, 5),
      city: city || null,
      generatedAt: Date.now(),
    };
  }, TTL);

  return NextResponse.json(data, {
    headers: {
      // Browser-side: ~10s fresh, ~60s SWR — same family as v93 feed APIs.
      "Cache-Control": "public, max-age=10, stale-while-revalidate=60",
    },
  });
}
