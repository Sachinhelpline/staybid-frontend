// Bidding lifecycle analytics — single endpoint that aggregates KPIs
// across phases 1-7. Hits Supabase REST in parallel, derives metrics
// in memory.
//
// GET /api/admin/analytics/bidding?days=30

import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_READ } from "@/lib/sb";

async function sbGet(path: string) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: SB_READ });
  if (!r.ok) return [];
  return r.json();
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const days = Math.max(1, Math.min(180, Number(searchParams.get("days") || 30)));
  const sinceIso = new Date(Date.now() - days * 86400_000).toISOString();

  try {
    // Parallel reads — keep query budget tight
    const [bids, holds, windows, paidAmounts, hotels, attributions] = await Promise.all([
      sbGet(`bids?createdAt=gte.${encodeURIComponent(sinceIso)}&select=id,status,amount,counterAmount,hotelId,customerId,createdAt,auto_accept_at,bidder_tier&limit=5000`),
      sbGet(`bid_holds?created_at=gte.${encodeURIComponent(sinceIso)}&select=bid_id,hotel_id,status,hold_amount,total_amount,created_at,pay_at_hotel&limit=5000`),
      sbGet(`bid_acceptance_windows?accepted_at=gte.${encodeURIComponent(sinceIso)}&select=bid_id,status,accepted_at&limit=5000`),
      sbGet(`bid_paid_amounts?createdAt=gte.${encodeURIComponent(sinceIso)}&select=bid_id,paid_total,flow,createdAt&limit=5000`),
      sbGet(`hotels?select=id,name,city,starRating&limit=500`),
      // v94 — source attribution rows in the window
      sbGet(`bid_attributions?created_at=gte.${encodeURIComponent(sinceIso)}&select=bid_id,source,creator_id,creator_handle,paid_total,commission_amount,created_at&limit=5000`),
    ]) as any[][];

    const hotelById: Record<string, any> = {};
    for (const h of hotels) hotelById[h.id] = h;

    // ── Bid lifecycle ────────────────────────────────────────
    const totalBids   = bids.length;
    const byStatus    = bids.reduce<Record<string, number>>((acc, b) => { acc[b.status] = (acc[b.status] || 0) + 1; return acc; }, {});
    const accepted    = byStatus["ACCEPTED"] || 0;
    const countered   = byStatus["COUNTER"] || 0;
    const rejected    = byStatus["REJECTED"] || 0;
    const pending     = byStatus["PENDING"] || 0;
    const acceptRate  = totalBids ? Math.round((accepted / totalBids) * 100) : 0;
    const counterRate = totalBids ? Math.round((countered / totalBids) * 100) : 0;

    // Auto-accept hit rate: ACCEPTED bids that had an auto_accept_at scheduled
    const scheduledBids   = bids.filter((b) => b.auto_accept_at);
    const autoAccepted    = scheduledBids.filter((b) => b.status === "ACCEPTED").length;
    const autoAcceptHit   = scheduledBids.length ? Math.round((autoAccepted / scheduledBids.length) * 100) : 0;

    // Tier distribution
    const tierCounts: Record<string, number> = {};
    for (const b of bids) {
      const t = b.bidder_tier || "UNKNOWN";
      tierCounts[t] = (tierCounts[t] || 0) + 1;
    }

    // ── Daily bids/accepts trend ─────────────────────────────
    const dayMap: Record<string, { date: string; placed: number; accepted: number; countered: number }> = {};
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400_000);
      const key = d.toISOString().slice(0, 10);
      dayMap[key] = { date: key, placed: 0, accepted: 0, countered: 0 };
    }
    for (const b of bids) {
      const key = String(b.createdAt).slice(0, 10);
      if (dayMap[key]) {
        dayMap[key].placed += 1;
        if (b.status === "ACCEPTED") dayMap[key].accepted += 1;
        else if (b.status === "COUNTER") dayMap[key].countered += 1;
      }
    }
    const dailyTrend = Object.values(dayMap);

    // ── Hold conversion ───────────────────────────────────────
    const totalHolds      = holds.length;
    const holdsCompleted  = holds.filter((h) => h.status === "completed").length;
    const holdsExpired    = holds.filter((h) => h.status === "expired").length;
    const holdsActive     = holds.filter((h) => h.status === "active").length;
    const holdConversion  = totalHolds ? Math.round((holdsCompleted / totalHolds) * 100) : 0;
    const lockedNow       = holds.filter((h) => h.status === "active").reduce((s, h) => s + Number(h.hold_amount || 0), 0);
    const payAtHotelCount = holds.filter((h) => h.pay_at_hotel).length;

    // ── Acceptance window stats ──────────────────────────────
    const totalWindows  = windows.length;
    const windowsPaid   = windows.filter((w) => w.status === "paid").length;
    const windowsExpired= windows.filter((w) => w.status === "expired").length;
    const windowsActive = windows.filter((w) => w.status === "active").length;
    const windowPayRate = totalWindows ? Math.round((windowsPaid / totalWindows) * 100) : 0;

    // ── Revenue (sum of paid_amounts.paidTotal by flow) ──────
    const revenueByFlow: Record<string, number> = {};
    let revenueTotal = 0;
    const paidByBid: Record<string, number> = {};
    for (const p of paidAmounts) {
      const amt = Number(p.paid_total || 0);
      paidByBid[p.bid_id] = amt;
      revenueTotal += amt;
      const flow = String(p.flow || "unknown");
      revenueByFlow[flow] = (revenueByFlow[flow] || 0) + amt;
    }

    // ── v94 Source attribution breakdown ─────────────────────
    // For each bid we know its channel (direct / creator / hotel-feed /
    // flash). Counts + revenue per source surface in the admin analytics
    // panel so the team sees which channels drive bookings.
    const bookingsBySource: Record<string, number> = {};
    const revenueBySource: Record<string, number> = {};
    const creatorBookings: Record<string, { handle: string; bookings: number; gmv: number; commission: number }> = {};
    let totalCommission = 0;
    for (const a of attributions) {
      const src = a.source || "direct";
      bookingsBySource[src] = (bookingsBySource[src] || 0) + 1;
      const paid = Number(paidByBid[a.bid_id] || a.paid_total || 0);
      revenueBySource[src] = (revenueBySource[src] || 0) + paid;
      if (src === "creator" && a.creator_handle) {
        if (!creatorBookings[a.creator_handle]) {
          creatorBookings[a.creator_handle] = { handle: a.creator_handle, bookings: 0, gmv: 0, commission: 0 };
        }
        creatorBookings[a.creator_handle].bookings += 1;
        creatorBookings[a.creator_handle].gmv += paid;
        creatorBookings[a.creator_handle].commission += Number(a.commission_amount || 0);
      }
      totalCommission += Number(a.commission_amount || 0);
    }
    const topCreators = Object.values(creatorBookings)
      .sort((a, b) => b.gmv - a.gmv)
      .slice(0, 10);

    // ── Top hotels by acceptance rate (min 5 bids to qualify) ─
    const hotelStats: Record<string, { hotelId: string; name: string; city?: string; placed: number; accepted: number }> = {};
    for (const b of bids) {
      if (!hotelStats[b.hotelId]) {
        const h = hotelById[b.hotelId] || {};
        hotelStats[b.hotelId] = { hotelId: b.hotelId, name: h.name || b.hotelId, city: h.city, placed: 0, accepted: 0 };
      }
      hotelStats[b.hotelId].placed += 1;
      if (b.status === "ACCEPTED") hotelStats[b.hotelId].accepted += 1;
    }
    const topHotels = Object.values(hotelStats)
      .filter((h) => h.placed >= 3)
      .map((h) => ({ ...h, rate: Math.round((h.accepted / h.placed) * 100) }))
      .sort((a, b) => b.rate - a.rate || b.placed - a.placed)
      .slice(0, 10);

    // ── Avg time-to-accept (bids that went PENDING → ACCEPTED with auto_accept_at) ──
    // We can only approximate without acceptedAt; use auto_accept_at as a proxy (= when the bid SHOULD have flipped).
    const accTimes: number[] = [];
    for (const b of bids.filter((b) => b.status === "ACCEPTED" && b.auto_accept_at)) {
      const placed   = new Date(b.createdAt).getTime();
      const accepted = new Date(b.auto_accept_at).getTime();
      if (accepted > placed) accTimes.push(accepted - placed);
    }
    const avgTimeToAcceptMs = accTimes.length ? Math.round(accTimes.reduce((s, x) => s + x, 0) / accTimes.length) : 0;

    return NextResponse.json({
      windowDays: days,
      kpis: {
        totalBids,
        accepted, countered, rejected, pending,
        acceptRate, counterRate, autoAcceptHit,
        scheduledBids: scheduledBids.length,
        autoAccepted,
        holds: { total: totalHolds, completed: holdsCompleted, expired: holdsExpired, active: holdsActive, conversion: holdConversion, lockedNow, payAtHotelCount },
        windows: { total: totalWindows, paid: windowsPaid, expired: windowsExpired, active: windowsActive, payRate: windowPayRate },
        revenueTotal,
        revenueByFlow,
        avgTimeToAcceptMs,
        // v94 — source attribution KPIs
        bookingsBySource,
        revenueBySource,
        totalCommission,
        attributedCount: attributions.length,
      },
      topCreators,
      tierCounts,
      dailyTrend,
      topHotels,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
