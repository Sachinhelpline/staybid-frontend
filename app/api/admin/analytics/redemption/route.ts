// GET /api/admin/analytics/redemption?days=30
//
// Aggregated metrics for /admin/finance + /admin/analytics:
//   - issued / used / expired counts in window
//   - total ₹ cost (sum of value_inr on USED rows — actual P&L hit)
//   - total ₹ liability (sum of value_inr on ACTIVE rows — future P&L hit)
//   - points spent (gross customer value redeemed)
//   - per-kind breakdown
//   - per-rule top performers
//   - day-by-day trend for the trend chart
//   - wallet credit balance + lifetime debited (real cash-equivalent paid out)

import { NextRequest, NextResponse } from "next/server";
import { requireVerifiedAdmin } from "@/lib/admin/verify";
import { SB_URL, SB_READ } from "@/lib/sb";

export const dynamic = "force-dynamic";


export async function GET(req: NextRequest) {
  const admin = await requireVerifiedAdmin(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const days = Math.max(1, Math.min(365, parseInt(req.nextUrl.searchParams.get("days") || "30", 10)));
  const since = new Date(Date.now() - days * 86400_000).toISOString();

  const [codesIssued, codesUsed, allActive, walletLedger] = await Promise.all([
    fetch(`${SB_URL}/rest/v1/redemption_codes?issued_at=gte.${encodeURIComponent(since)}&select=*&limit=5000`, { headers: SB_READ })
      .then((r) => r.json()).catch(() => []),
    fetch(`${SB_URL}/rest/v1/redemption_codes?status=eq.used&used_at=gte.${encodeURIComponent(since)}&select=*&limit=5000`, { headers: SB_READ })
      .then((r) => r.json()).catch(() => []),
    fetch(`${SB_URL}/rest/v1/redemption_codes?status=eq.active&select=value_inr,kind`, { headers: SB_READ })
      .then((r) => r.json()).catch(() => []),
    fetch(`${SB_URL}/rest/v1/wallet_credit_history?created_at=gte.${encodeURIComponent(since)}&select=*&limit=5000`, { headers: SB_READ })
      .then((r) => r.json()).catch(() => []),
  ]);

  const issued: any[] = Array.isArray(codesIssued) ? codesIssued : [];
  const used: any[]   = Array.isArray(codesUsed) ? codesUsed : [];
  const active: any[] = Array.isArray(allActive) ? allActive : [];
  const ledger: any[] = Array.isArray(walletLedger) ? walletLedger : [];

  // KPIs
  const totalIssued = issued.length;
  const totalUsed = used.length;
  const totalPointsSpent = issued.reduce((s, c) => s + Number(c.points_spent || 0), 0);
  const totalCostUsed = used.reduce((s, c) => s + Number(c.value_inr || 0), 0);
  const totalLiabilityActive = active.reduce((s, c) => s + Number(c.value_inr || 0), 0);
  const walletCredited = ledger.filter((l) => Number(l.delta_inr) > 0).reduce((s, l) => s + Number(l.delta_inr), 0);
  const walletDebited = Math.abs(ledger.filter((l) => Number(l.delta_inr) < 0).reduce((s, l) => s + Number(l.delta_inr), 0));

  // By kind
  const byKind = ["coupon", "wallet_credit", "amenity", "voucher"].map((k) => {
    const inK = issued.filter((c) => c.kind === k);
    const usedK = used.filter((c) => c.kind === k);
    return {
      kind: k,
      issued: inK.length,
      used: usedK.length,
      points: inK.reduce((s, c) => s + Number(c.points_spent || 0), 0),
      costUsed: usedK.reduce((s, c) => s + Number(c.value_inr || 0), 0),
    };
  });

  // Top rules by used count
  const ruleAgg: Record<string, { slug: string; title: string; count: number; cost: number; points: number }> = {};
  for (const c of used) {
    const k = c.rule_slug || "unknown";
    if (!ruleAgg[k]) ruleAgg[k] = { slug: k, title: c.title || k, count: 0, cost: 0, points: 0 };
    ruleAgg[k].count += 1;
    ruleAgg[k].cost += Number(c.value_inr || 0);
    ruleAgg[k].points += Number(c.points_spent || 0);
  }
  const topRules = Object.values(ruleAgg).sort((a, b) => b.count - a.count).slice(0, 10);

  // Daily trend — last `days` days
  const dailyTrend: { date: string; issued: number; used: number; cost: number }[] = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setUTCHours(0, 0, 0, 0);
    d.setUTCDate(d.getUTCDate() - i);
    const next = new Date(d);
    next.setUTCDate(next.getUTCDate() + 1);
    const dStr = d.toISOString().slice(0, 10);
    const dIssued = issued.filter((c) => {
      const t = new Date(c.issued_at).getTime();
      return t >= d.getTime() && t < next.getTime();
    });
    const dUsed = used.filter((c) => {
      const t = new Date(c.used_at).getTime();
      return t >= d.getTime() && t < next.getTime();
    });
    dailyTrend.push({
      date: dStr,
      issued: dIssued.length,
      used: dUsed.length,
      cost: dUsed.reduce((s, c) => s + Number(c.value_inr || 0), 0),
    });
  }

  return NextResponse.json({
    window: { days, since },
    kpis: {
      totalIssued,
      totalUsed,
      totalPointsSpent,
      totalCostUsed,
      totalLiabilityActive,
      walletCredited,
      walletDebited,
    },
    byKind,
    topRules,
    dailyTrend,
  });
}
