"use client";
// Creator Hub — Bookings driven by you (v94)
// Lists every bid + booking that arrived at a hotel page through THIS
// creator's reel. The /api/influencer/[id]/bookings endpoint resolves
// either the influencer.id OR the underlying users.id, so the page works
// even before/after the user's influencer row was activated.
import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { SOURCE_ICON, SOURCE_LABEL, SOURCE_COLOR, type AttributionSource } from "@/lib/attribution";

const inr = (n: number) => "₹" + (Number(n) || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 });
const fmt = (s?: string | null) =>
  s ? new Date(s).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—";

const STATUS_COLOR: Record<string, string> = {
  PENDING:   "#d97706",
  COUNTER:   "#ea580c",
  ACCEPTED:  "#059669",
  CONFIRMED: "#059669",
  CHECKED_IN: "#0891b2",
  CHECKED_OUT: "#475569",
  REJECTED:  "#dc2626",
  CANCELLED: "#dc2626",
};

export default function InfluencerBookings() {
  const [inf, setInf]         = useState<any>(null);
  const [list, setList]       = useState<any[]>([]);
  const [totals, setTotals]   = useState({ count: 0, gmv: 0, commission: 0, paid: 0 });
  const [loading, setLoading] = useState(true);
  const [filter, setFilter]   = useState<"all" | "ACCEPTED" | "PENDING" | "COUNTER">("all");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.getMyInfluencer()
      .then(async (d) => {
        const i = d?.influencer;
        if (cancelled) return;
        if (!i) { setLoading(false); return; }
        setInf(i);
        const r = await fetch(`/api/influencer/${i.id}/bookings`, { cache: "no-store" }).then(r => r.json()).catch(() => null);
        if (cancelled) return;
        setList(r?.bookings || []);
        setTotals(r?.totals || { count: 0, gmv: 0, commission: 0, paid: 0 });
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const filtered = filter === "all"
    ? list
    : list.filter((b) => String(b.status || "").toUpperCase() === filter);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card label="Bookings driven" value={String(totals.count)} sub={`${totals.count} attributions`} />
        <Card label="GMV"              value={inr(totals.gmv)}      sub="Total paid by guests" />
        <Card label="Commission"        value={inr(totals.commission)} accent="text-gold-700" sub="At 12% (Elite: 15%)" />
        <Card label="Paid out"          value={inr(totals.paid)}     accent="text-emerald-700" sub="Cleared monthly" />
      </div>

      <div className="card-luxury p-4">
        <div className="flex items-center gap-3 mb-3 flex-wrap">
          <h3 className="font-bold text-luxury-900 mr-auto">Attributed bookings</h3>
          {(["all", "ACCEPTED", "PENDING", "COUNTER"] as const).map((f) => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${
                filter === f
                  ? "bg-gold-500 text-white border-gold-600"
                  : "bg-white text-luxury-700 border-luxury-200 hover:border-gold-400"
              }`}>
              {f === "all" ? "All" : f.charAt(0) + f.slice(1).toLowerCase()}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="p-6 text-center text-luxury-500 text-sm">Loading attributions…</div>
        ) : !inf ? (
          <div className="p-6 text-center text-luxury-500 text-sm">
            Apply for a Creator account from <Link href="/upgrade" className="text-gold-700 font-bold">Upgrade</Link> to start tracking attributed bookings.
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-6 text-center text-luxury-500 text-sm">
            <p className="mb-2">No bookings yet for this filter.</p>
            <p className="text-xs">When viewers tap Book/Bid on your reels, those bookings will appear here automatically with the source tag.</p>
          </div>
        ) : (
          <div className="overflow-x-auto -mx-4 px-4">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wider text-luxury-500">
                <tr className="border-b border-luxury-100">
                  <th className="text-left py-2 font-bold">Booking</th>
                  <th className="text-left py-2 font-bold">Hotel</th>
                  <th className="text-left py-2 font-bold">Source</th>
                  <th className="text-left py-2 font-bold">Status</th>
                  <th className="text-right py-2 font-bold">Booking</th>
                  <th className="text-right py-2 font-bold">Commission</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((b) => {
                  const src = (b.source || "direct") as AttributionSource;
                  const statusColor = STATUS_COLOR[String(b.status || "").toUpperCase()] || "#6b7280";
                  return (
                    <tr key={b.bidId} className="border-b border-luxury-50 hover:bg-luxury-50/40">
                      <td className="py-3">
                        <div className="font-mono text-[0.7rem] text-luxury-500">{b.bidId.slice(0, 10)}</div>
                        <div className="text-[0.7rem] text-luxury-500">{fmt(b.createdAt)}</div>
                      </td>
                      <td className="py-3">
                        <div className="font-bold text-luxury-800 truncate max-w-[170px]">{b.hotelName}</div>
                        <div className="text-[0.7rem] text-luxury-500">{b.hotelCity} · {b.checkIn ? `${fmt(b.checkIn)} → ${fmt(b.checkOut)}` : "dates pending"}</div>
                      </td>
                      <td className="py-3">
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[0.7rem] font-bold"
                          style={{
                            background: SOURCE_COLOR[src] + "20",
                            color: SOURCE_COLOR[src],
                            border: `1px solid ${SOURCE_COLOR[src]}55`,
                          }}>
                          {SOURCE_ICON[src]} {SOURCE_LABEL[src]}
                        </span>
                      </td>
                      <td className="py-3">
                        <span className="px-2 py-1 rounded text-[0.65rem] font-bold uppercase tracking-wider"
                          style={{ background: statusColor + "20", color: statusColor }}>
                          {b.status}
                        </span>
                      </td>
                      <td className="py-3 text-right">
                        <div className="font-bold text-luxury-800">{inr(b.paidTotal || b.amount)}</div>
                        {b.flow && <div className="text-[0.65rem] text-luxury-400 uppercase tracking-wider">{b.flow}</div>}
                      </td>
                      <td className="py-3 text-right">
                        {b.commissionAmount ? (
                          <>
                            <div className="font-bold text-gold-700">{inr(b.commissionAmount)}</div>
                            <div className="text-[0.6rem] uppercase tracking-wider font-bold"
                              style={{ color: b.commissionStatus === "paid" ? "#059669" : "#d97706" }}>
                              {b.commissionStatus || "pending"}
                            </div>
                          </>
                        ) : (
                          <span className="text-luxury-400 text-xs">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card-luxury p-5">
        <h3 className="font-bold text-luxury-900 mb-2">How attribution works</h3>
        <ul className="text-sm text-luxury-600 space-y-1.5 leading-relaxed">
          <li>• Upload a reel and tag a hotel. Viewers who tap <strong>Book Now</strong> or <strong>Bid</strong> from your reel will be attributed to you.</li>
          <li>• Each attributed booking earns 12% commission at the Verified tier and 15% at the Elite tier.</li>
          <li>• Commissions appear here as <span className="text-amber-700 font-bold">pending</span> the moment a guest pays, and flip to <span className="text-emerald-700 font-bold">paid</span> after the monthly payout sweep.</li>
          <li>• Even when the booking ends up using a Flash Deal, you keep the credit if the guest reached the hotel page via your reel first.</li>
        </ul>
      </div>
    </div>
  );
}

function Card({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="card-luxury p-4">
      <p className="text-[0.65rem] uppercase tracking-widest font-bold text-luxury-500">{label}</p>
      <p className={`font-display text-2xl font-bold mt-1 leading-none ${accent || "text-luxury-900"}`}>{value}</p>
      {sub && <p className="text-xs text-luxury-500 mt-1">{sub}</p>}
    </div>
  );
}
