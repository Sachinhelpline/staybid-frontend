"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

const inr = (n: number) => "₹" + (Number(n) || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 });

type Filter = "all" | "pending" | "paid";

export default function InfluencerEarningsPage() {
  const [filter, setFilter] = useState<Filter>("all");
  const [list, setList] = useState<any[]>([]);
  const [totals, setTotals] = useState<{ pending: number; paid: number; total: number }>({ pending: 0, paid: 0, total: 0 });
  const [loading, setLoading] = useState(true);

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
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [filter]);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-3">
        <Card label="Pending" value={inr(totals.pending)} accent="text-amber-700" />
        <Card label="Paid"    value={inr(totals.paid)}    accent="text-emerald-700" />
        <Card label="Total"   value={inr(totals.total)}   accent="text-gold-700" />
      </div>

      <div className="flex gap-2">
        {(["all", "pending", "paid"] as Filter[]).map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-4 py-2 rounded-xl text-sm font-semibold border transition-all capitalize ${
              filter === f ? "bg-gold-500 text-white border-gold-600" : "bg-white text-luxury-700 border-luxury-200 hover:border-gold-400"
            }`}>
            {f}
          </button>
        ))}
      </div>

      <div className="card-luxury p-0 overflow-hidden">
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

function Card({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="card-luxury p-4">
      <p className="text-[0.65rem] uppercase tracking-widest font-bold text-luxury-500">{label}</p>
      <p className={`font-display text-xl md:text-2xl font-bold mt-1 leading-none ${accent}`}>{value}</p>
    </div>
  );
}
