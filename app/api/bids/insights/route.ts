// v124 — Public read-only "Auction Pit" insights for the bid page.
//
// Returns:
//   - tonightAuctions:  open bid_requests created in last 24h (city-scoped if ?city=)
//   - acceptedToday:    bids accepted today (city-scoped if ?city=)
//   - avgAcceptMins:    median minutes between bid createdAt and acceptance (bid_status_log.changed_at)
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
const LOG_PAGE_SIZE = 100;
const BID_CHUNK_SIZE = 40;

function chunk<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
}

function deduplicateLogsByBidId(logs: any[]): any[] {
  const latest: Record<string, any> = {};
  for (const log of logs) {
    const bid_id = log.bid_id;
    if (!bid_id) continue;
    if (!latest[bid_id] || new Date(log.changed_at) > new Date(latest[bid_id].changed_at)) {
      latest[bid_id] = log;
    }
  }
  return Object.values(latest);
}

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
    const isCityScoped = Boolean(city);

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

    // Tonight's open auctions (bid_requests, last 24h) — calculate before fast path
    const tonightUrl = city
      ? `${SB_URL}/rest/v1/bid_requests?city=ilike.${encodeURIComponent(city)}*&createdAt=gte.${since24h}&select=id`
      : `${SB_URL}/rest/v1/bid_requests?createdAt=gte.${since24h}&select=id`;
    const tonightRes = await fetch(tonightUrl, { headers: { ...SB_H, Prefer: "count=exact" } });
    const tonightAuctions = Number((tonightRes.headers.get("content-range") || "").split("/")[1]) || 0;

    // Fast path: zero-curated-city (city-scoped but no hotels) returns zero/empty for acceptance metrics
    if (isCityScoped && hotelIdsInCity.length === 0) {
      return {
        tonightAuctions,
        acceptedToday: 0,
        hotelsListening: 0,
        cityHotStreak: 0,
        avgAcceptMins: 0,
        recentWins: [],
        city: city || null,
        generatedAt: Date.now(),
      };
    }

    // Bids accepted today — use bid_status_log for authoritative acceptance time, paginate entire window
    let allAtLogs: any[] = [];
    let atOffset = 0;
    let atHasMore = true;
    while (atHasMore) {
      const acceptedTodayUrl = `${SB_URL}/rest/v1/bid_status_log?new_status=eq.ACCEPTED&changed_at=gte.${sinceToday}&select=id,bid_id,changed_at&order=changed_at.desc,id.desc&offset=${atOffset}&limit=${LOG_PAGE_SIZE}`;
      const atRes = await fetch(acceptedTodayUrl, { headers: SB_H });
      const atPage = await atRes.json().catch(() => []);
      const atPageArr: any[] = Array.isArray(atPage) ? atPage : [];
      if (atPageArr.length === 0) {
        atHasMore = false;
      } else {
        allAtLogs.push(...atPageArr);
        atOffset += LOG_PAGE_SIZE;
      }
    }

    let acceptedToday = 0;
    if (allAtLogs.length > 0) {
      const deduplicatedAtLogs = deduplicateLogsByBidId(allAtLogs);
      const atBidIds = deduplicatedAtLogs.map((l: any) => l.bid_id).filter(Boolean);
      if (atBidIds.length > 0) {
        const atBidChunks = chunk(atBidIds, BID_CHUNK_SIZE);
        const atBidsArr: any[] = [];
        for (const bidChunk of atBidChunks) {
          const atUrl = `${SB_URL}/rest/v1/bids?id=in.(${bidChunk.join(",")})&status=eq.ACCEPTED&select=id,hotelId`;
          const atBidsRes = await fetch(atUrl, { headers: SB_H });
          const atBids = await atBidsRes.json().catch(() => []);
          if (Array.isArray(atBids)) {
            atBidsArr.push(...atBids);
          }
        }
        if (isCityScoped) {
          acceptedToday = hotelIdsInCity.length > 0
            ? atBidsArr.filter((b: any) => hotelIdsInCity.includes(b.hotelId)).length
            : 0;
        } else {
          acceptedToday = atBidsArr.length;
        }
      }
    }

    // Hot streak: accepted bids in last 60 min, paginate entire window
    let allStreakLogs: any[] = [];
    let streakOffset = 0;
    let streakHasMore = true;
    while (streakHasMore) {
      const streakUrl = `${SB_URL}/rest/v1/bid_status_log?new_status=eq.ACCEPTED&changed_at=gte.${since1h}&select=id,bid_id,changed_at&order=changed_at.desc,id.desc&offset=${streakOffset}&limit=${LOG_PAGE_SIZE}`;
      const streakRes = await fetch(streakUrl, { headers: SB_H });
      const streakPage = await streakRes.json().catch(() => []);
      const streakPageArr: any[] = Array.isArray(streakPage) ? streakPage : [];
      if (streakPageArr.length === 0) {
        streakHasMore = false;
      } else {
        allStreakLogs.push(...streakPageArr);
        streakOffset += LOG_PAGE_SIZE;
      }
    }

    let cityHotStreak = 0;
    if (allStreakLogs.length > 0) {
      const deduplicatedStreakLogs = deduplicateLogsByBidId(allStreakLogs);
      const streakBidIds = deduplicatedStreakLogs.map((l: any) => l.bid_id).filter(Boolean);
      if (streakBidIds.length > 0) {
        const streakBidChunks = chunk(streakBidIds, BID_CHUNK_SIZE);
        const streakBidsArr: any[] = [];
        for (const bidChunk of streakBidChunks) {
          const streakBidsUrl = `${SB_URL}/rest/v1/bids?id=in.(${bidChunk.join(",")})&status=eq.ACCEPTED&select=id,hotelId`;
          const streakBidsRes = await fetch(streakBidsUrl, { headers: SB_H });
          const streakBids = await streakBidsRes.json().catch(() => []);
          if (Array.isArray(streakBids)) {
            streakBidsArr.push(...streakBids);
          }
        }
        if (isCityScoped) {
          cityHotStreak = hotelIdsInCity.length > 0
            ? streakBidsArr.filter((b: any) => hotelIdsInCity.includes(b.hotelId)).length
            : 0;
        } else {
          cityHotStreak = streakBidsArr.length;
        }
      }
    }

    // Recent wins: paginate until 5 unique eligible accepted bids collected or exhausted
    let wins: any[] = [];
    let winsOffset = 0;
    let winsHasMore = true;
    const winsTarget = 5;
    const seenWinsBidIds = new Set<string>();
    const winsBidsById: Record<string, any> = {};
    const winsLogsByBidId: Record<string, any> = {};
    const eligibleWinCandidates: Array<{ bid: any; log: any }> = [];

    while (winsHasMore && eligibleWinCandidates.length < winsTarget) {
      const logsUrl = `${SB_URL}/rest/v1/bid_status_log?new_status=eq.ACCEPTED&select=id,bid_id,changed_at&order=changed_at.desc,id.desc&offset=${winsOffset}&limit=${LOG_PAGE_SIZE}`;
      const logsRes = await fetch(logsUrl, { headers: SB_H });
      const logsPage = await logsRes.json().catch(() => []);
      const logsPageArr: any[] = Array.isArray(logsPage) ? logsPage : [];
      if (logsPageArr.length === 0) {
        winsHasMore = false;
      } else {
        // Collect new unseen bid IDs from this page
        const newBidIds: string[] = [];
        for (const log of logsPageArr) {
          const bid_id = log.bid_id;
          if (bid_id && !seenWinsBidIds.has(bid_id)) {
            seenWinsBidIds.add(bid_id);
            newBidIds.push(bid_id);
            // Store only the first (newest) log per bid_id due to desc order
            if (!winsLogsByBidId[bid_id]) {
              winsLogsByBidId[bid_id] = log;
            }
          }
        }

        // Fetch details for unseen bid IDs in chunks
        if (newBidIds.length > 0) {
          const bidChunks = chunk(newBidIds, BID_CHUNK_SIZE);
          for (const bidChunk of bidChunks) {
            const wonUrl = `${SB_URL}/rest/v1/bids?id=in.(${bidChunk.join(",")})&status=eq.ACCEPTED&select=id,amount,hotelId,customerId,counterAmount`;
            const wonRes = await fetch(wonUrl, { headers: SB_H });
            const won = await wonRes.json().catch(() => []);
            if (Array.isArray(won)) {
              won.forEach((b: any) => { winsBidsById[b.id] = b; });
            }
          }
        }

        // Collect eligible candidates from this page
        for (const bid_id of newBidIds) {
          if (eligibleWinCandidates.length >= winsTarget) break;
          const log = winsLogsByBidId[bid_id];
          const b = winsBidsById[bid_id];
          if (!log || !b) continue;

          // City filter: if city is provided, retain only bids on curated-city hotels
          if (isCityScoped) {
            if (!hotelIdsInCity.includes(b.hotelId)) continue; // Not in curated city
          }

          eligibleWinCandidates.push({ bid: b, log });
        }

        winsOffset += LOG_PAGE_SIZE;
      }
    }

    // Batch-fetch hotels and users for collected candidates
    if (eligibleWinCandidates.length > 0) {
      const hIds = Array.from(new Set(eligibleWinCandidates.map((c: any) => c.bid.hotelId).filter(Boolean)));
      const cIds = Array.from(new Set(eligibleWinCandidates.map((c: any) => c.bid.customerId).filter(Boolean)));

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

      // Build wins from collected candidates
      for (const { bid: b, log } of eligibleWinCandidates) {
        const h = hById[b.hotelId];
        const c = cById[b.customerId];
        const finalAmount = Number(b.counterAmount) > 0 ? Number(b.counterAmount) : Number(b.amount);
        wins.push({
          id: b.id,
          initial: maskName(c?.name),
          amount: finalAmount,
          hotelName: h?.name || "a hotel",
          city: h?.city || "",
          when: timeAgo(log.changed_at),
        });
      }
    }

    // Avg accept time — paginate until 30 unique eligible samples collected or exhausted
    let speedOffset = 0;
    let speedHasMore = true;
    const speedTarget = 30;
    const seenSpeedBidIds = new Set<string>();
    const speedBidsById: Record<string, any> = {};
    const speedLogsByBidId: Record<string, any> = {};
    const speeds: number[] = [];

    while (speedHasMore && speeds.length < speedTarget) {
      const speedLogsUrl = `${SB_URL}/rest/v1/bid_status_log?new_status=eq.ACCEPTED&select=id,bid_id,changed_at&order=changed_at.desc,id.desc&offset=${speedOffset}&limit=${LOG_PAGE_SIZE}`;
      const speedLogsRes = await fetch(speedLogsUrl, { headers: SB_H });
      const speedLogsPage = await speedLogsRes.json().catch(() => []);
      const speedLogsPageArr: any[] = Array.isArray(speedLogsPage) ? speedLogsPage : [];
      if (speedLogsPageArr.length === 0) {
        speedHasMore = false;
      } else {
        // Collect new unseen bid IDs from this page
        const newSpeedBidIds: string[] = [];
        for (const log of speedLogsPageArr) {
          const bid_id = log.bid_id;
          if (bid_id && !seenSpeedBidIds.has(bid_id)) {
            seenSpeedBidIds.add(bid_id);
            newSpeedBidIds.push(bid_id);
            // Store only the first (newest) log per bid_id due to desc order
            if (!speedLogsByBidId[bid_id]) {
              speedLogsByBidId[bid_id] = log;
            }
          }
        }

        // Fetch details for unseen bid IDs in chunks
        if (newSpeedBidIds.length > 0) {
          const speedBidChunks = chunk(newSpeedBidIds, BID_CHUNK_SIZE);
          for (const bidChunk of speedBidChunks) {
            const speedUrl = `${SB_URL}/rest/v1/bids?id=in.(${bidChunk.join(",")})&status=eq.ACCEPTED&select=id,hotelId,createdAt`;
            const speedRes = await fetch(speedUrl, { headers: SB_H });
            const speedBids = await speedRes.json().catch(() => []);
            if (Array.isArray(speedBids)) {
              speedBids.forEach((b: any) => { speedBidsById[b.id] = b; });
            }
          }
        }

        // Process samples from this page
        for (const bid_id of newSpeedBidIds) {
          if (speeds.length >= speedTarget) break;
          const log = speedLogsByBidId[bid_id];
          const b = speedBidsById[bid_id];
          if (!log || !b) continue;

          // City filter: if city is provided, retain only bids on curated-city hotels
          if (isCityScoped) {
            if (hotelIdsInCity.length === 0) continue; // No hotels in city
            if (!hotelIdsInCity.includes(b.hotelId)) continue; // Not in curated city
          }

          const created = b.createdAt;
          if (!created) continue;
          const a = new Date(created).getTime();
          const z = new Date(log.changed_at).getTime();
          const m = (z - a) / 60000;
          if (Number.isFinite(m) && m >= 0 && m < 60 * 24) {
            speeds.push(m);
          }
        }

        speedOffset += LOG_PAGE_SIZE;
      }
    }

    speeds.sort((a, b) => a - b);
    const median = speeds.length ? speeds[Math.floor(speeds.length / 2)] : 0;

    return {
      tonightAuctions,
      acceptedToday,
      hotelsListening,
      cityHotStreak,
      avgAcceptMins: Math.round(median),
      recentWins: wins,
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
