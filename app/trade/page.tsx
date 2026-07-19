"use client";

// v369 — Model 3 travel-agent auction: PUBLIC browse. Anyone can browse live
// lots; each card opens a full property TOUR page (/trade/[id]) where bidding +
// the agent gate live. English copy. Real room images.

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTradeAuth, getTradeToken } from "@/lib/trade/use-trade-auth";
import { onBidBasketChange, bidBasketList } from "@/lib/trade/bid-basket";
import { CIRCLE_AUCTION_NOTE } from "@/lib/circle/disclosure";

const inr = (n: any) => `₹${Math.round(Number(n) || 0).toLocaleString("en-IN")}`;
const monthLabel = (mk: string) => {
  try { const [y, m] = mk.split("-").map(Number); return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" }); }
  catch { return mk; }
};

type Lot = {
  id: string; hotel_id: string; room_id: string; category?: string; city?: string;
  month_key: string; num_rooms: number; min_bid_per_room_night: number;
  window_close_at: string; metadata?: any; image?: string; sale_mode?: string;
};

export default function TradeBrowsePage() {
  const router = useRouter();
  const auth = useTradeAuth();
  const [lots, setLots] = useState<Lot[]>([]);
  const [cities, setCities] = useState<string[]>([]);
  const [city, setCity] = useState("All");
  const [loading, setLoading] = useState(true);
  const [basketN, setBasketN] = useState(0);

  const loadLots = useCallback(async (c: string) => {
    setLoading(true);
    try {
      const r = await fetch(`/api/trade/lots${c && c !== "All" ? `?city=${encodeURIComponent(c)}` : ""}`, { cache: "no-store" });
      const d = await r.json();
      if (r.ok) { setLots(d.lots || []); if (d.cities?.length) setCities(d.cities); }
    } catch { /* ignore */ } finally { setLoading(false); }
  }, []);

  useEffect(() => { loadLots(city); }, [city, loadLots]);
  useEffect(() => { setBasketN(bidBasketList().length); return onBidBasketChange(() => setBasketN(bidBasketList().length)); }, []);

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(180deg,#faf7f2,#f3ece1)" }}>
      {/* Header */}
      <div className="sticky top-0 z-30" style={{ background: "linear-gradient(135deg,#1f1710,#33251a)", color: "#ffe9c7" }}>
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div>
            <div className="font-extrabold text-lg" style={{ color: "#ffd98a" }}>StayBid Trade</div>
            <div className="text-[0.72rem] opacity-80">Monthly inventory auction · for travel agents</div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => router.push("/trade/my-bids")} className="text-[0.75rem] px-3 py-1.5 rounded-lg" style={{ background: "rgba(255,217,138,0.14)", color: "#ffd98a" }}>My Bids</button>
            <button onClick={() => router.push("/trade/review")} className="text-[0.75rem] px-3 py-1.5 rounded-lg font-bold" style={{ background: "linear-gradient(135deg,#c9911a,#f0b429)", color: "#1f1710" }}>
              Bundle {basketN > 0 ? `(${basketN})` : ""}
            </button>
          </div>
        </div>
      </div>

      <AccountStrip auth={auth} />
      <Model2Entry auth={auth} />

      {/* City chips */}
      <div className="max-w-6xl mx-auto px-4 pt-3 flex gap-2 overflow-x-auto">
        {["All", ...cities].map((c) => (
          <button key={c} onClick={() => setCity(c)}
            className="shrink-0 px-3 py-1.5 rounded-full text-sm font-semibold"
            style={city === c ? { background: "#33251a", color: "#ffd98a" } : { background: "#fff", color: "#7a5a2e", border: "1px solid #e7d9c2" }}>
            {c}
          </button>
        ))}
      </div>

      {/* Lots */}
      <div className="max-w-6xl mx-auto px-4 py-4 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {loading ? (
          <div className="col-span-full text-center text-luxury-400 py-10">Loading…</div>
        ) : lots.length === 0 ? (
          <div className="col-span-full text-center text-luxury-400 py-10">No live lots in this city right now.</div>
        ) : lots.map((l) => (
          <button key={l.id} onClick={() => router.push(`/trade/${l.id}`)} className="text-left rounded-2xl overflow-hidden bg-white border border-luxury-200 flex flex-col hover:shadow-lg transition-shadow">
            <div className="relative">
              {l.image
                ? <img src={l.image} alt={l.category || l.room_id} className="w-full aspect-[4/3] object-cover" />
                : <div className="w-full aspect-[4/3] grid place-items-center text-3xl" style={{ background: "#e7d9c2" }}>🏔️</div>}
              <span className="absolute top-2 left-2 text-[0.66rem] font-bold px-2 py-0.5 rounded-full"
                style={l.sale_mode === "live" ? { background: "#ecfdf5", color: "#047857" } : { background: "#f5f3ff", color: "#6d28d9" }}>
                {l.sale_mode === "live" ? "⚡ Live · bid now" : "🔒 Sealed · month-end"}
              </span>
            </div>
            <div className="p-3 flex-1 flex flex-col">
              <div className="text-[0.72rem] text-luxury-400">{l.metadata?.hotel_name || l.hotel_id} · {l.city}</div>
              <div className="font-bold text-luxury-900">{l.category || l.room_id}</div>
              <div className="text-[0.78rem] text-luxury-500 mt-0.5">{monthLabel(l.month_key)} · {l.num_rooms} rooms</div>
              <div className="mt-2 text-sm">
                <span className="text-luxury-400 text-[0.72rem]">Min bid</span>{" "}
                <b className="text-luxury-900">{inr(l.min_bid_per_room_night)}</b><span className="text-luxury-400 text-[0.72rem]">/room/night</span>
              </div>
              <div className="mt-3 w-full py-2 rounded-xl font-bold text-white text-center" style={{ background: "linear-gradient(135deg,#c9911a,#f0b429)" }}>
                View & bid
              </div>
            </div>
          </button>
        ))}
      </div>

      <div className="max-w-6xl mx-auto px-4 pb-8 pt-2">
        <p className="text-[0.7rem] text-luxury-400 leading-relaxed">{CIRCLE_AUCTION_NOTE}</p>
      </div>
    </div>
  );
}

function AccountStrip({ auth }: { auth: ReturnType<typeof useTradeAuth> }) {
  const [busy, setBusy] = useState(false);
  if (auth.loading) return null;
  if (auth.status === "approved") {
    return <div className="max-w-6xl mx-auto px-4 pt-2 text-[0.75rem] text-green-700">✓ {auth.agent?.agency_name || "Agent"} — approved. You can place bids.</div>;
  }
  const doSignIn = async () => { setBusy(true); try { await auth.signIn(); } catch {} finally { setBusy(false); } };
  return (
    <div className="max-w-6xl mx-auto px-4 pt-2">
      <div className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-[0.78rem] text-amber-800 flex items-center justify-between gap-2">
        <span>
          {auth.status === "signed_out" && "Browsing is free. To bid, sign in with Google and register as a travel agent."}
          {auth.status === "unregistered" && "You're signed in — open any property to register and bid."}
          {auth.status === "pending" && "Your agent application is under review. You can bid once it's approved."}
          {auth.status === "rejected" && "Your agent application was rejected. Please contact support."}
          {auth.status === "suspended" && "Your agent account is suspended."}
        </span>
        {auth.status === "signed_out" && (
          <button onClick={doSignIn} disabled={busy} className="shrink-0 px-3 py-1.5 rounded-lg font-bold text-white disabled:opacity-50" style={{ background: "#33251a" }}>
            {busy ? "…" : "Sign in with Google"}
          </button>
        )}
      </div>
    </div>
  );
}

function Model2Entry({ auth }: { auth: ReturnType<typeof useTradeAuth> }) {
  if (auth.loading || auth.status !== "approved") return null;
  const goModel2 = () => {
    const tok = getTradeToken();
    try {
      localStorage.setItem("sb_token", tok);
      localStorage.setItem("sb_token_type", "firebase");
      localStorage.setItem("sb_user", JSON.stringify({ id: auth.user?.id, name: auth.agent?.agency_name || auth.user?.name || "Agent", email: auth.user?.email || "", role: "customer" }));
    } catch {}
    window.location.href = "/circle/model2/browse";
  };
  return (
    <div className="max-w-6xl mx-auto px-4 pt-3">
      <div className="rounded-2xl p-4 flex items-center justify-between gap-3" style={{ background: "linear-gradient(135deg,#33251a,#4a3820)", color: "#ffe9c7" }}>
        <div className="min-w-0">
          <div className="font-bold" style={{ color: "#ffd98a" }}>🔑 Model 2 — curated Circle inventory (fixed price)</div>
          <p className="text-[0.75rem] opacity-85 mt-0.5">Beyond the auction: buy room-nights from StayBid Circle-operated properties at a <b>fixed, guaranteed price</b> — no bidding, no risk. You purchase as a B2B trade buyer.</p>
        </div>
        <button onClick={goModel2} className="shrink-0 px-4 py-2 rounded-xl font-bold text-[0.8rem]" style={{ background: "linear-gradient(135deg,#c9911a,#f0b429)", color: "#1f1710" }}>
          Open Model 2 →
        </button>
      </div>
    </div>
  );
}
