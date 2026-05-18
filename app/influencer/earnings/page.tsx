"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { CountUp } from "@/components/CountUp";

const inr = (n: number) => "₹" + (Number(n) || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 });

type Filter = "all" | "pending" | "paid";
type Slab = { minBookings: number; maxBookings: number; pct: number };
type LoyaltyBonus = { months: number; bonusPct: number };
type CommissionData = {
  rule: { scope: string; slabs: Slab[]; loyaltyBonuses: LoyaltyBonus[]; note: string | null };
  snapshot: {
    monthlyBookings: number;
    currentSlab: Slab | null;
    basePct: number;
    loyaltyPct: number;
    totalPct: number;
    consecutiveMonths: number;
    nextSlab: Slab | null;
    bookingsToNext: number;
  };
};

export default function InfluencerEarningsPage() {
  const [filter, setFilter] = useState<Filter>("all");
  const [list, setList] = useState<any[]>([]);
  const [totals, setTotals] = useState<{ pending: number; paid: number; total: number }>({ pending: 0, paid: 0, total: 0 });
  const [loading, setLoading] = useState(true);
  // v105.2 — live tiered-commission snapshot for this creator
  const [commission, setCommission] = useState<CommissionData | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.getMyInfluencer()
      .then(async (d) => {
        const i = d?.influencer;
        if (!i) return;
        const status = filter === "all" ? undefined : filter;
        const e = await api.getInfluencerEarnings(i.id, status).catch(() => null);
        if (cancelled) return;
        setList(e?.commissions || []);
        setTotals(e?.totals || { pending: 0, paid: 0, total: 0 });
        // Fetch commission rule snapshot once per mount (filter-independent)
        if (!commission) {
          const token = typeof window !== "undefined" ? localStorage.getItem("sb_token") : null;
          fetch(`/api/influencer/commission-rule?creatorId=${encodeURIComponent(i.id)}`, {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          }).then(r => r.json()).then((d: CommissionData) => { if (!cancelled) setCommission(d); }).catch(() => {});
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-3 sb-stagger">
        <Card label="Pending" rawValue={totals.pending} accent="text-amber-700" />
        <Card label="Paid"    rawValue={totals.paid}    accent="text-emerald-700" />
        <Card label="Total"   rawValue={totals.total}   accent="text-gold-700" />
      </div>

      {/* v105.2 — Commission Structure: shows live slab + rate + projection */}
      {commission && commission.rule.slabs.length > 0 && (
        <CommissionStructure data={commission} />
      )}

      <div className="flex gap-2 sb-fade-in" style={{ animationDelay: "0.15s" }}>
        {(["all", "pending", "paid"] as Filter[]).map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-4 py-2 rounded-xl text-sm font-semibold border transition-all capitalize sb-card-lift ${
              filter === f ? "bg-gold-500 text-white border-gold-600" : "bg-white text-luxury-700 border-luxury-200 hover:border-gold-400"
            }`}>
            {f}
          </button>
        ))}
      </div>

      <div className="card-luxury sb-card-lift p-0 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-luxury-500 text-sm">Loading…</div>
        ) : list.length === 0 ? (
          <div className="p-8 text-center text-luxury-500 text-sm">No commissions in this filter.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-luxury-50 text-xs uppercase tracking-wider text-luxury-600">
                <tr>
                  <th className="text-left px-4 py-3 font-bold">Date</th>
                  <th className="text-left px-4 py-3 font-bold">Hotel</th>
                  <th className="text-right px-4 py-3 font-bold">Booking</th>
                  <th className="text-right px-4 py-3 font-bold">Rate</th>
                  <th className="text-right px-4 py-3 font-bold">Commission</th>
                  <th className="text-left px-4 py-3 font-bold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-luxury-100">
                {list.map((c) => (
                  <tr key={c.id} className="hover:bg-luxury-50/50">
                    <td className="px-4 py-3 text-luxury-700">{new Date(c.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</td>
                    <td className="px-4 py-3 font-mono text-xs text-luxury-600">{String(c.hotel_id).slice(0, 12)}</td>
                    <td className="px-4 py-3 text-right text-luxury-700">{inr(c.booking_amount)}</td>
                    <td className="px-4 py-3 text-right text-luxury-500">{(Number(c.commission_percentage) * 100).toFixed(1)}%</td>
                    <td className="px-4 py-3 text-right font-bold text-gold-700">{inr(c.commission_amount)}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 rounded-full text-[0.65rem] uppercase tracking-wider font-bold ${
                        c.status === "paid" ? "bg-emerald-100 text-emerald-700"
                        : c.status === "cancelled" ? "bg-red-100 text-red-700"
                        : "bg-amber-100 text-amber-700"
                      }`}>{c.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Card({ label, rawValue, accent }: { label: string; rawValue: number; accent: string }) {
  return (
    <div className="card-luxury sb-card-lift p-4">
      <p className="text-[0.65rem] uppercase tracking-widest font-bold text-luxury-500">{label}</p>
      <p className={`font-display text-xl md:text-2xl font-bold mt-1 leading-none ${accent}`}>
        ₹<CountUp value={Number(rawValue) || 0} duration={1000} />
      </p>
    </div>
  );
}

// ─── v105.2 — Commission Structure ────────────────────────────────────────
// Live snapshot of the v95 tiered commission system for the signed-in
// creator. Shows current slab, this month's booking count, loyalty
// streak, and the projection to the next slab.
function CommissionStructure({ data }: { data: CommissionData }) {
  const { rule, snapshot } = data;
  const slabs = [...rule.slabs].sort((a, b) => a.minBookings - b.minBookings);
  const currentSlabIndex = snapshot.currentSlab
    ? slabs.findIndex((s) => s.minBookings === snapshot.currentSlab!.minBookings)
    : -1;

  return (
    <div className="card-luxury sb-card-lift sb-fade-in p-5 bg-gradient-to-br from-gold-50/30 to-white border-gold-300/40" style={{ animationDelay: "0.1s" }}>
      <div className="flex items-baseline justify-between mb-3 flex-wrap gap-2">
        <div>
          <p className="text-[0.65rem] uppercase tracking-widest font-bold text-gold-700 inline-flex items-center gap-1.5">
            <span className="sb-pulse-dot is-warn" />
            Your Commission
          </p>
          <h2 className="font-display text-xl font-bold text-luxury-900 mt-0.5">
            <CountUp value={Math.round(snapshot.totalPct)} duration={900} suffix="% per booking" />
            {snapshot.loyaltyPct > 0 && (
              <span className="text-[0.7rem] font-bold ml-2 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 align-middle">
                +{snapshot.loyaltyPct}% loyalty
              </span>
            )}
          </h2>
        </div>
        {rule.scope === "creator" && (
          <span className="text-[0.6rem] font-bold uppercase tracking-widest px-2 py-1 rounded-full bg-purple-100 text-purple-700">
            Custom rate
          </span>
        )}
      </div>

      {/* This-month progress strip */}
      <div className="mb-4 p-3 bg-white border border-luxury-100 rounded-xl">
        <div className="flex justify-between items-baseline mb-2">
          <span className="text-[0.65rem] uppercase tracking-widest font-bold text-luxury-500">This month</span>
          <span className="font-bold text-luxury-900">
            {snapshot.monthlyBookings} booking{snapshot.monthlyBookings === 1 ? "" : "s"}
          </span>
        </div>
        {snapshot.nextSlab && snapshot.bookingsToNext > 0 ? (
          <p className="text-xs text-luxury-600">
            <span className="font-semibold text-gold-700">{snapshot.bookingsToNext} more</span>{" "}
            to unlock the <span className="font-semibold">{snapshot.nextSlab.pct}%</span> tier
            ({snapshot.nextSlab.minBookings}–{snapshot.nextSlab.maxBookings === 999999 ? "∞" : snapshot.nextSlab.maxBookings} bookings).
          </p>
        ) : snapshot.currentSlab ? (
          <p className="text-xs text-emerald-700 font-semibold">🎉 You're at the top tier this month.</p>
        ) : (
          <p className="text-xs text-luxury-500">Place your first booking-driving reel to start earning.</p>
        )}
      </div>

      {/* Slab ladder */}
      <div className="space-y-1.5">
        <p className="text-[0.65rem] uppercase tracking-widest font-bold text-luxury-500 mb-1">Slab Ladder</p>
        <div className="sb-stagger space-y-1.5">
        {slabs.map((s, i) => {
          const isActive = i === currentSlabIndex;
          return (
            <div
              key={i}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg text-xs transition-all ${
                isActive
                  ? "bg-gold-100 border border-gold-400 font-bold"
                  : "bg-luxury-50/60 border border-luxury-100"
              }`}
            >
              <span className={`flex-1 ${isActive ? "text-gold-900" : "text-luxury-700"}`}>
                {s.minBookings}–{s.maxBookings === 999999 ? "∞" : s.maxBookings} bookings/month
              </span>
              <span className={`font-mono ${isActive ? "text-gold-900" : "text-luxury-600"}`}>
                {s.pct}%
              </span>
              {isActive && <span className="text-[0.6rem] font-bold uppercase text-emerald-700 inline-flex items-center gap-1"><span className="sb-pulse-dot" />Active</span>}
            </div>
          );
        })}
        </div>
      </div>

      {/* Loyalty bonus row */}
      {rule.loyaltyBonuses.length > 0 && (
        <div className="mt-3 p-3 bg-luxury-50/60 border border-luxury-100 rounded-lg">
          <p className="text-[0.65rem] uppercase tracking-widest font-bold text-luxury-500 mb-1.5">Loyalty Bonus</p>
          <div className="flex flex-wrap gap-2">
            {rule.loyaltyBonuses.map((b, i) => {
              const earned = snapshot.consecutiveMonths >= b.months;
              return (
                <span
                  key={i}
                  className={`text-[0.65rem] font-bold px-2.5 py-1 rounded-full ${
                    earned
                      ? "bg-emerald-100 text-emerald-700 border border-emerald-300"
                      : "bg-white text-luxury-500 border border-luxury-200"
                  }`}
                >
                  {b.months} months @ same+ slab → +{b.bonusPct}%
                  {earned && " ✓"}
                </span>
              );
            })}
          </div>
          <p className="text-[0.65rem] text-luxury-500 mt-2">
            Streak: <span className="font-bold text-luxury-700">{snapshot.consecutiveMonths}</span> consecutive month{snapshot.consecutiveMonths === 1 ? "" : "s"}
          </p>
        </div>
      )}

      {rule.note && (
        <p className="text-[0.7rem] text-luxury-500 mt-3 italic">{rule.note}</p>
      )}
    </div>
  );
}
