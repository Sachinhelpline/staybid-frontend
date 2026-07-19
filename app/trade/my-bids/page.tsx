"use client";

// v361 — Model 3: an agent's own bids (active / won / lost). Sealed-bid, so
// other agents' bids are never shown — only your own standing + outcome.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTradeAuth, getTradeToken } from "@/lib/trade/use-trade-auth";

const inr = (n: any) => `₹${Math.round(Number(n) || 0).toLocaleString("en-IN")}`;
const monthLabel = (mk: string) => {
  try { const [y, m] = mk.split("-").map(Number); return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-IN", { month: "short", year: "numeric", timeZone: "UTC" }); }
  catch { return mk; }
};
const ST: Record<string, { bg: string; c: string; label: string }> = {
  active:   { bg: "#eff6ff", c: "#1d4ed8", label: "Live" },
  won:      { bg: "#ecfdf5", c: "#047857", label: "Won" },
  partial:  { bg: "#f0fdf4", c: "#15803d", label: "Won (partial)" },
  lost:     { bg: "#f3f4f6", c: "#6b7280", label: "Lost" },
  refunded: { bg: "#fef2f2", c: "#b91c1c", label: "Deposit refunded" },
};

export default function TradeMyBidsPage() {
  const router = useRouter();
  const auth = useTradeAuth();
  const [bids, setBids] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (auth.loading) return;
    if (auth.status === "signed_out") { setLoading(false); return; }
    (async () => {
      try {
        const r = await fetch("/api/trade/bids/mine", { headers: { Authorization: `Bearer ${getTradeToken()}` }, cache: "no-store" });
        const d = await r.json();
        if (r.ok) setBids(d.bids || []);
      } catch {} finally { setLoading(false); }
    })();
  }, [auth.loading, auth.status]);

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(180deg,#faf7f2,#f3ece1)" }}>
      <div className="sticky top-0 z-30" style={{ background: "linear-gradient(135deg,#1f1710,#33251a)", color: "#ffe9c7" }}>
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
          <button onClick={() => router.push("/trade")} className="text-lg">‹</button>
          <div className="font-extrabold" style={{ color: "#ffd98a" }}>My Bids</div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-4 space-y-3">
        {auth.status === "signed_out" ? (
          <div className="text-center text-luxury-400 py-12">Sign-in karo apni bids dekhne ke liye. <button onClick={() => router.push("/trade")} className="underline text-gold-600">Browse</button></div>
        ) : loading ? (
          <div className="text-center text-luxury-400 py-12">Loading…</div>
        ) : bids.length === 0 ? (
          <div className="text-center text-luxury-400 py-12">Abhi koi bid nahi. <button onClick={() => router.push("/trade")} className="underline text-gold-600">Lots browse karo</button></div>
        ) : bids.map((b) => {
          const st = ST[b.status] || ST.active;
          return (
            <div key={b.id} className="rounded-2xl bg-white border border-luxury-200 p-3 flex gap-3">
              <div className="w-14 h-14 rounded-xl bg-cover bg-center shrink-0" style={{ backgroundImage: `url(${b.lot?.metadata?.room_img || ""})`, background: b.lot?.metadata?.room_img ? undefined : "#e7d9c2" }} />
              <div className="flex-1 min-w-0">
                <div className="font-bold text-luxury-900 truncate">{b.lot?.category || b.metadata?.room_id || b.lot_id}</div>
                <div className="text-[0.72rem] text-luxury-400">{b.lot?.metadata?.hotel_name || ""} · {b.lot?.city || b.metadata?.city} · {monthLabel(b.lot?.month_key || b.metadata?.month_key || "")}</div>
                <div className="text-[0.75rem] text-luxury-600 mt-0.5">{b.segment_label} · {inr(b.per_room_per_night)}/night × {b.rooms_wanted} rooms</div>
                <div className="text-[0.72rem] text-amber-700 mt-0.5">EMD paid {inr(b.deposit_amount)}{b.rooms_awarded ? ` · ${b.rooms_awarded} rooms won` : ""}</div>
              </div>
              <span className="text-[0.7rem] font-bold px-2 py-1 rounded-full self-start" style={{ background: st.bg, color: st.c }}>{st.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
