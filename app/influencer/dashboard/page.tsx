"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { CountUp } from "@/components/CountUp";
// v142 — Phase-6 creator hub tour. 4 steps: tier → KPIs → KYC → commissions.
import { usePageTour } from "@/lib/tutorial/usePageTour";

const inr = (n: number) => "₹" + (Number(n) || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 });

const TIER_META: Record<number, { label: string; color: string; perks: string }> = {
  1: { label: "Starter",   color: "#94a3b8", perks: "12% commission · basic listing" },
  2: { label: "Verified",  color: "#c9911a", perks: "12% + featured slots · faster payouts" },
  3: { label: "Elite",     color: "#7c3aed", perks: "15% commission · priority campaigns" },
};

export default function InfluencerDashboard() {
  const [inf, setInf] = useState<any>(null);
  const [stats, setStats] = useState<any>(null);
  const [recent, setRecent] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  // v142 — Phase 6 creator hub tour. delayMs:1500 so /api/influencer/me +
  // earnings + recent commissions all populate before fire.
  usePageTour("influencer", "influencer", { delayMs: 1500 });

  useEffect(() => {
    api.getMyInfluencer()
      .then(async (d) => {
        const i = d?.influencer;
        if (!i) return;
        setInf(i);
        const [s, e] = await Promise.all([
          api.getInfluencerStats(i.id).catch(() => null),
          api.getInfluencerEarnings(i.id).catch(() => null),
        ]);
        setStats(s);
        setRecent((e?.commissions || []).slice(0, 5));
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="card-luxury p-8 text-center text-luxury-500 text-sm">Loading…</div>;
  if (!inf)    return <div className="card-luxury p-8 text-center text-luxury-500 text-sm">Not registered yet.</div>;

  const tier = TIER_META[inf.verification_tier] || TIER_META[1];
  const kycPct =
    (inf.aadhaar_verified ? 50 : 0) +
    (inf.pan_verified ? 50 : 0);

  return (
    <div className="space-y-5">
      {/* Hero status card */}
      <div className="card-luxury sb-card-lift sb-fade-in p-6 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-40 h-40 rounded-full opacity-10"
          style={{ background: `radial-gradient(circle, ${tier.color}, transparent 70%)` }} />
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 relative">
          <div>
            <p className="text-xs uppercase tracking-widest font-bold text-luxury-500 inline-flex items-center gap-1.5">
              <span className="sb-pulse-dot" style={{ background: tier.color, boxShadow: `0 0 0 0 ${tier.color}55` }} />
              Tier
            </p>
            <p className="font-display text-3xl font-bold" style={{ color: tier.color }}>{tier.label}</p>
            <p className="text-luxury-500 text-sm mt-1">{tier.perks}</p>
          </div>
          <div className="text-right">
            <p className="text-xs uppercase tracking-widest font-bold text-luxury-500">Total Earnings</p>
            <p className="font-display text-3xl font-bold text-gold-700">₹<CountUp value={Number(inf.total_earnings) || 0} duration={1100} /></p>
            <p className="text-luxury-500 text-xs mt-1">Status: <span className="font-bold text-luxury-700 uppercase">{inf.status}</span></p>
          </div>
        </div>
      </div>

      {/* KPI grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sb-stagger">
        <KPI label="This Month" rawValue={stats?.derived?.monthlyCommission ?? 0} prefix="₹" sub={`${stats?.derived?.monthlyBookings ?? 0} bookings`} />
        <KPI label="Pending Payout" rawValue={stats?.derived?.pendingCommission ?? 0} prefix="₹" sub="Cleared monthly" />
        <KPI label="All-time Bookings" rawValue={stats?.derived?.totalBookings ?? 0} sub="Attributed to you" />
        <KPI label="Followers" rawValue={inf.total_followers || 0} sub="As declared" />
      </div>

      {/* KYC progress */}
      <div className="card-luxury sb-card-lift p-5">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-bold text-luxury-900">KYC Verification</h3>
          <span className="text-sm font-semibold text-luxury-600"><CountUp value={kycPct} duration={800} suffix="%" /></span>
        </div>
        <div className="w-full h-2 bg-luxury-100 rounded-full overflow-hidden">
          <div className="h-full bg-gradient-to-r from-gold-500 to-gold-400 transition-all duration-700" style={{ width: `${kycPct}%` }} />
        </div>
        <div className="grid grid-cols-2 gap-3 mt-4 sb-stagger">
          <KycChip label="Aadhaar" done={inf.aadhaar_verified} />
          <KycChip label="PAN" done={inf.pan_verified} />
        </div>
        {kycPct < 100 && (
          <p className="text-xs text-luxury-500 mt-3">
            Complete KYC to receive payouts. Admin will verify your documents within 24 hours after submission.
          </p>
        )}
      </div>

      {/* Recent commissions */}
      <div className="card-luxury sb-card-lift p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold text-luxury-900">Recent Commissions</h3>
          <Link href="/influencer/earnings" className="text-xs font-semibold text-gold-700 hover:text-gold-800">View all →</Link>
        </div>
        {recent.length === 0 ? (
          <p className="text-sm text-luxury-500 py-4 text-center">
            No commissions yet. Share your StayBid profile link to start earning.
          </p>
        ) : (
          <div className="divide-y divide-luxury-100 sb-stagger">
            {recent.map((c) => (
              <div key={c.id} className="flex items-center justify-between py-2.5 transition-colors hover:bg-luxury-50/40">
                <div className="text-sm">
                  <p className="font-semibold text-luxury-800">Hotel {String(c.hotel_id).slice(0, 8)}</p>
                  <p className="text-xs text-luxury-500">{new Date(c.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</p>
                </div>
                <div className="text-right">
                  <p className="font-bold text-gold-700">{inr(c.commission_amount)}</p>
                  <p className="text-[0.65rem] uppercase tracking-wider font-bold text-luxury-500">{c.status}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function KPI({ label, rawValue, prefix = "", sub }: { label: string; rawValue: number; prefix?: string; sub?: string }) {
  return (
    <div className="card-luxury sb-card-lift p-4">
      <p className="text-[0.65rem] uppercase tracking-widest font-bold text-luxury-500">{label}</p>
      <p className="font-display text-2xl font-bold text-luxury-900 mt-1 leading-none">
        {prefix}<CountUp value={rawValue} duration={1000} />
      </p>
      {sub && <p className="text-xs text-luxury-500 mt-1">{sub}</p>}
    </div>
  );
}

function KycChip({ label, done }: { label: string; done: boolean }) {
  return (
    <div className={`flex items-center gap-2 px-3 py-2 rounded-xl border sb-card-lift ${done ? "bg-emerald-50 border-emerald-200" : "bg-luxury-50 border-luxury-200"}`}>
      <span className="text-lg">{done ? "✅" : "⏳"}</span>
      <div>
        <p className="text-sm font-bold text-luxury-800">{label}</p>
        <p className="text-[0.65rem] uppercase tracking-wider font-bold text-luxury-500">
          {done ? "Verified" : "Pending"}
        </p>
      </div>
    </div>
  );
}
