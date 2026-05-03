import { NextResponse } from "next/server";
import { SB_URL, SB_READ } from "@/lib/sb";

// Aggregates platform revenue from accepted bids + influencer commissions +
// outstanding loyalty points. Returns headline KPIs and a 30-day timeseries.
export async function GET() {
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000);
  const isoMS = monthStart.toISOString();
  const iso30 = thirtyDaysAgo.toISOString();

  const [acceptedBids, paidAmounts, commissions, points] = await Promise.all([
    fetch(`${SB_URL}/rest/v1/bids?status=eq.ACCEPTED&select=id,amount,createdAt&order=createdAt.desc&limit=2000`, { headers: SB_READ }).then(r => r.json()).catch(() => []),
    fetch(`${SB_URL}/rest/v1/bid_paid_amounts?select=bid_id,paid_total,created_at`, { headers: SB_READ }).then(r => r.json()).catch(() => []),
    fetch(`${SB_URL}/rest/v1/influencer_commissions?select=commission_amount,status,created_at`, { headers: SB_READ }).then(r => r.json()).catch(() => []),
    fetch(`${SB_URL}/rest/v1/user_points?select=balance,lifetime_earned,lifetime_redeemed`, { headers: SB_READ }).then(r => r.json()).catch(() => []),
  ]);

  const bidsArr: any[] = Array.isArray(acceptedBids) ? acceptedBids : [];
  const paidArr: any[] = Array.isArray(paidAmounts) ? paidAmounts : [];
  const commArr: any[] = Array.isArray(commissions) ? commissions : [];
  const pointsArr: any[] = Array.isArray(points) ? points : [];

  const paidMap: Record<string, number> = {};
  for (const p of paidArr) if (p.bid_id) paidMap[p.bid_id] = Number(p.paid_total || 0);

  const grossOf = (b: any) => paidMap[b.id] != null ? paidMap[b.id] : Number(b.amount || 0);
  const inMonth = (d: string) => new Date(d) >= monthStart;
  const inLast30 = (d: string) => new Date(d) >= thirtyDaysAgo;

  const grossAllTime = bidsArr.reduce((s, b) => s + grossOf(b), 0);
  const grossMTD     = bidsArr.filter(b => inMonth(b.createdAt)).reduce((s, b) => s + grossOf(b), 0);
  const gross30      = bidsArr.filter(b => inLast30(b.createdAt)).reduce((s, b) => s + grossOf(b), 0);

  const commissionPaid    = commArr.filter(c => c.status === "paid").reduce((s, c) => s + Number(c.commission_amount || 0), 0);
  const commissionPending = commArr.filter(c => c.status === "pending").reduce((s, c) => s + Number(c.commission_amount || 0), 0);

  const pointsOutstanding = pointsArr.reduce((s, p) => s + Number(p.balance || 0), 0);

  // 30-day timeseries (gross by day)
  const buckets: Record<string, number> = {};
  for (let i = 0; i < 30; i++) {
    const d = new Date(Date.now() - i * 86_400_000);
    buckets[d.toISOString().slice(0, 10)] = 0;
  }
  for (const b of bidsArr) {
    if (!inLast30(b.createdAt)) continue;
    const k = String(b.createdAt).slice(0, 10);
    if (k in buckets) buckets[k] += grossOf(b);
  }
  const series = Object.entries(buckets)
    .sort((a, b) => a[0] < b[0] ? -1 : 1)
    .map(([date, gross]) => ({ date, gross: Math.round(gross) }));

  return NextResponse.json({
    kpi: {
      grossAllTime: Math.round(grossAllTime),
      grossMTD:     Math.round(grossMTD),
      gross30:      Math.round(gross30),
      acceptedBids: bidsArr.length,
      commissionPaid:    Math.round(commissionPaid),
      commissionPending: Math.round(commissionPending),
      pointsOutstanding,
    },
    series,
  });
}
