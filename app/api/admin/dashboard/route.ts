import { NextResponse } from "next/server";

const SB_URL = "https://uxxhbdqedazpmvbvaosh.supabase.co";
const SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV4eGhiZHFlZGF6cG12YnZhb3NoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxMTIwMDgsImV4cCI6MjA5MDY4ODAwOH0.mBhr1tNlail5u0D_dj3ljA9oRZvZ7_2_0-lt7I6cJ60";

async function sb(path: string) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) return [];
  return res.json();
}

function dayAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

export async function GET() {
  try {
    const [bookings, bids, users, vpPending, complaints, vpVideos] = await Promise.all([
      sb("bookings?select=id,totalAmount,status,createdAt,customerId,hotelId"),
      sb("bids?select=id,amount,status,createdAt,hotelId,customerId&order=createdAt.desc&limit=10"),
      sb("users?select=id,createdAt,tier"),
      sb("vp_requests?select=id,status,hotelId,customerId,tier,createdAt&status=eq.pending"),
      sb("complaints?select=id,type,status,priority,createdAt"),
      sb("vp_videos?select=id,trust_score,uploadedAt"),
    ]);

    const activeStatuses = ["ACCEPTED", "CONFIRMED", "CHECKED_IN"];
    const activeBookings = (bookings as any[]).filter((b) => activeStatuses.includes(b.status));
    const gmv = (bookings as any[]).reduce((s: number, b: any) => s + (Number(b.totalAmount) || 0), 0);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const newUsers = (users as any[]).filter((u) => new Date(u.createdAt) >= today).length;

    const fraud = (complaints as any[]).filter((c) => c.type === "fraud" || c.priority === "high").length;

    // Revenue = 5% commission on GMV
    const revenue = Math.round(gmv * 0.05);

    // Last 7 days bookings trend
    const bookingTrend = Array.from({ length: 7 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (6 - i));
      const dateStr = d.toISOString().split("T")[0];
      const label = d.toLocaleDateString("en-IN", { weekday: "short" });
      const count = (bookings as any[]).filter(
        (b) => b.createdAt?.startsWith(dateStr)
      ).length;
      return { label, value: count };
    });

    // Last 7 days revenue trend
    const revenueTrend = Array.from({ length: 7 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (6 - i));
      const dateStr = d.toISOString().split("T")[0];
      const label = d.toLocaleDateString("en-IN", { weekday: "short" });
      const dayGmv = (bookings as any[])
        .filter((b) => b.createdAt?.startsWith(dateStr))
        .reduce((s: number, b: any) => s + (Number(b.totalAmount) || 0), 0);
      return { label, value: Math.round(dayGmv * 0.05) };
    });

    // Verification pie
    const verified = (vpVideos as any[]).filter((v) => v.trust_score >= 70).length;
    const total = (vpVideos as any[]).length;
    const verifPie = [
      { label: "Passed", value: verified, color: "#2ECC71" },
      { label: "Failed", value: total - verified, color: "#FF4757" },
    ].filter((d) => d.value > 0);

    // Recent bids (live ticker)
    const recentBids = (bids as any[]).slice(0, 10).map((b: any) => ({
      id: b.id?.slice(0, 8),
      amount: b.amount,
      status: b.status,
      createdAt: b.createdAt,
    }));

    // Pending verifications queue
    const verifQueue = (vpPending as any[]).slice(0, 5);

    // Recent complaints
    const recentComplaints = (complaints as any[])
      .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 5);

    return NextResponse.json({
      kpi: {
        gmv,
        activeBookings: activeBookings.length,
        totalBookings: (bookings as any[]).length,
        revenue,
        pendingVerif: (vpPending as any[]).length,
        fraud,
        newUsers,
        totalUsers: (users as any[]).length,
        totalComplaints: (complaints as any[]).length,
      },
      bookingTrend,
      revenueTrend,
      verifPie: verifPie.length ? verifPie : [{ label: "No data", value: 1, color: "#8A8FA8" }],
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
