// GET /api/admin/dashboard
//
// v126.2 — Real data wire-up. Previously queried `bookings` (empty) → GMV/
// Revenue/Active Bookings all 0 even though 41 ACCEPTED bids existed with
// ₹244K real paid GMV. Now reads bids + bid_paid_amounts + vp_requests +
// hotel_videos + users + complaints with the correct column names.

import { NextResponse } from "next/server";
import { SB_URL, SB_KEY } from "@/lib/sb";

export const dynamic = "force-dynamic";

const SB_H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" };

async function sb(path: string) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: SB_H });
  if (!res.ok) return [];
  return res.json().catch(() => []);
}

const ACCEPTED_STATUSES = ["ACCEPTED", "CONFIRMED", "CHECKED_IN", "CHECKED_OUT"];

export async function GET() {
  try {
    const [bids, paid, users, vpPending, complaints, hotelVideos, holds] = await Promise.all([
      sb("bids?select=id,amount,status,createdAt,hotelId,customerId&limit=5000"),
      sb("bid_paid_amounts?select=bid_id,paid_total,recorded_at&limit=5000"),
      sb("users?select=id,createdAt"),
      sb("vp_requests?select=id,status,hotel_id,customer_id,tier,created_at&status=eq.pending"),
      sb("complaints?select=id,type,status,priority,createdAt"),
      sb("hotel_videos?select=id,verification_status,uploadedAt&limit=500"),
      sb("bid_holds?select=bid_id,status,total_amount,hold_amount,expires_at&status=eq.active"),
    ]);

    // Build a paid lookup
    const paidByBid: Record<string, number> = {};
    for (const p of (paid as any[])) if (p.bid_id) paidByBid[p.bid_id] = Number(p.paid_total) || 0;

    const acceptedBids = (bids as any[]).filter((b) => ACCEPTED_STATUSES.includes(b.status));
    const activeBookings = (bids as any[]).filter((b) => ["ACCEPTED", "CONFIRMED", "CHECKED_IN"].includes(b.status));

    // GMV from authoritative paid totals; fallback to bid.amount when no paid row
    const gmv = acceptedBids.reduce((s: number, b: any) => {
      const p = paidByBid[b.id];
      return s + (p != null ? p : Number(b.amount) || 0);
    }, 0);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayMs = today.getTime();

    const last7 = new Date();
    last7.setDate(last7.getDate() - 7);
    const last30 = new Date();
    last30.setDate(last30.getDate() - 30);

    const newUsersToday = (users as any[]).filter((u) => new Date(u.createdAt).getTime() >= todayMs).length;
    const new7d = (users as any[]).filter((u) => new Date(u.createdAt) >= last7).length;

    const fraud = (complaints as any[]).filter((c) => c.type === "fraud" || c.priority === "high").length;
    const videosPending = (hotelVideos as any[]).filter((v) => v.verification_status === "pending").length;
    const videosApproved = (hotelVideos as any[]).filter((v) => v.verification_status === "approved").length;

    // Revenue = 5% commission on GMV (matches /api/admin/finance default rate)
    const revenue = Math.round(gmv * 0.05);

    // 7-day bid trend (placed per day)
    const bookingTrend = Array.from({ length: 7 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (6 - i));
      const dateStr = d.toISOString().split("T")[0];
      const label = d.toLocaleDateString("en-IN", { weekday: "short" });
      const count = (bids as any[]).filter((b) => (b.createdAt || "").startsWith(dateStr)).length;
      return { label, value: count };
    });

    // 7-day revenue trend (5% of accepted bid GMV per day)
    const revenueTrend = Array.from({ length: 7 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (6 - i));
      const dateStr = d.toISOString().split("T")[0];
      const label = d.toLocaleDateString("en-IN", { weekday: "short" });
      const dayGmv = acceptedBids
        .filter((b) => (b.createdAt || "").startsWith(dateStr))
        .reduce((s: number, b: any) => s + (paidByBid[b.id] ?? Number(b.amount) ?? 0), 0);
      return { label, value: Math.round(dayGmv * 0.05) };
    });

    // Today-only KPIs (for the new "Today" tab on dashboard / analytics)
    const todayKpi = (() => {
      const todayStr = new Date().toISOString().split("T")[0];
      const todayBids = (bids as any[]).filter((b) => (b.createdAt || "").startsWith(todayStr));
      const todayAccepted = todayBids.filter((b) => ACCEPTED_STATUSES.includes(b.status));
      const todayGmv = todayAccepted.reduce((s, b: any) => s + (paidByBid[b.id] ?? Number(b.amount) ?? 0), 0);
      return {
        bids: todayBids.length,
        accepted: todayAccepted.length,
        gmv: todayGmv,
        revenue: Math.round(todayGmv * 0.05),
        newUsers: newUsersToday,
      };
    })();

    // Verification status mini-pie (from vp_requests since hotel_videos is empty)
    const verifPie = [
      { label: "Pending review", value: (vpPending as any[]).length, color: "#F0D060" },
      { label: "Videos to approve", value: videosPending, color: "#3D9CF5" },
      { label: "Videos approved", value: videosApproved, color: "#2ECC71" },
    ].filter((d) => d.value > 0);

    // Recent bids ticker (top 10 newest)
    const sortedBids = (bids as any[]).slice().sort((a: any, b: any) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    const recentBids = sortedBids.slice(0, 10).map((b: any) => ({
      id: String(b.id).slice(0, 8),
      amount: b.amount,
      status: b.status,
      createdAt: b.createdAt,
    }));

    const verifQueue = (vpPending as any[]).slice(0, 5);
    const recentComplaints = (complaints as any[])
      .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 5);

    return NextResponse.json({
      kpi: {
        gmv,
        activeBookings: activeBookings.length,
        totalBookings: acceptedBids.length,
        revenue,
        pendingVerif: (vpPending as any[]).length,
        videosPending,
        fraud,
        newUsers: new7d,
        newUsersToday,
        totalUsers: (users as any[]).length,
        totalComplaints: (complaints as any[]).length,
        activeHolds: (holds as any[]).length,
      },
      today: todayKpi,
      bookingTrend,
      revenueTrend,
      verifPie: verifPie.length ? verifPie : [{ label: "No data yet", value: 1, color: "#8A8FA8" }],
      recentBids,
      verifQueue,
      recentComplaints,
      notifs: {
        verif: (vpPending as any[]).length,
        complaints: (complaints as any[]).filter((c: any) => c.status === "open").length,
        fraud,
        payouts: 0,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
