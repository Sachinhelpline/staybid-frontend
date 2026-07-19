"use client";

// v361 — Model 3 travel-agent auction: PUBLIC browse + bid. Anyone can browse
// live lots; placing a bid needs an approved agent (Google sign-in → register →
// admin approval). Bids go into a client bundle; the review page pays one EMD.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTradeAuth } from "@/lib/trade/use-trade-auth";
import { addBid, bidItemKey, onBidBasketChange, bidBasketList } from "@/lib/trade/bid-basket";
import { bidCostPreview } from "@/lib/trade/auction-engine";
import { CIRCLE_AUCTION_NOTE } from "@/lib/circle/disclosure";

const inr = (n: any) => `₹${Math.round(Number(n) || 0).toLocaleString("en-IN")}`;
const monthLabel = (mk: string) => {
  try { const [y, m] = mk.split("-").map(Number); return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" }); }
  catch { return mk; }
};

type Lot = {
  id: string; hotel_id: string; room_id: string; category?: string; city?: string;
  month_key: string; num_rooms: number; min_bid_per_room_night: number;
  window_close_at: string; metadata?: any;
};
type Seg = { type: "full_month" | "week" | "weekend"; weekIndex?: number; label: string; nights: number };

export default function TradeBrowsePage() {
  const router = useRouter();
  const auth = useTradeAuth();
  const [lots, setLots] = useState<Lot[]>([]);
  const [cities, setCities] = useState<string[]>([]);
  const [city, setCity] = useState("All");
  const [loading, setLoading] = useState(true);
  const [basketN, setBasketN] = useState(0);
  const [modalLot, setModalLot] = useState<Lot | null>(null);

  const loadLots = useCallback(async (c: string) => {
    setLoading(true);
    try {
      const r = await fetch(`/api/trade/lots${c && c !== "All" ? `?city=${encodeURIComponent(c)}` : ""}`, { cache: "no-store" });
      const d = await r.json();
      if (r.ok) { setLots(d.lots || []); if (d.cities?.length) setCities(d.cities); }
    } catch { /* ignore */ } finally { setLoading(false); }
  }, []);

  useEffect(() => { loadLots(city); }, [city, loadLots]);
  useEffect(() => {
    setBasketN(bidBasketList().length);
    return onBidBasketChange(() => setBasketN(bidBasketList().length));
  }, []);

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(180deg,#faf7f2,#f3ece1)" }}>
      {/* Header */}
      <div className="sticky top-0 z-30" style={{ background: "linear-gradient(135deg,#1f1710,#33251a)", color: "#ffe9c7" }}>
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div>
            <div className="font-extrabold text-lg" style={{ color: "#ffd98a" }}>StayBid Trade</div>
            <div className="text-[0.72rem] opacity-80">Monthly inventory auction · travel agents</div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => router.push("/trade/my-bids")} className="text-[0.75rem] px-3 py-1.5 rounded-lg" style={{ background: "rgba(255,217,138,0.14)", color: "#ffd98a" }}>My Bids</button>
            <button onClick={() => router.push("/trade/review")} className="text-[0.75rem] px-3 py-1.5 rounded-lg font-bold" style={{ background: "linear-gradient(135deg,#c9911a,#f0b429)", color: "#1f1710" }}>
              Bundle {basketN > 0 ? `(${basketN})` : ""}
            </button>
          </div>
        </div>
      </div>

      {/* Account strip */}
      <AccountStrip auth={auth} />

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
          <div className="col-span-full text-center text-luxury-400 py-10">Is city me abhi koi live lot nahi.</div>
        ) : lots.map((l) => (
          <div key={l.id} className="rounded-2xl overflow-hidden bg-white border border-luxury-200 flex flex-col">
            <div className="h-36 bg-cover bg-center" style={{ backgroundImage: `url(${l.metadata?.room_img || ""})`, background: l.metadata?.room_img ? undefined : "#e7d9c2" }} />
            <div className="p-3 flex-1 flex flex-col">
              <div className="text-[0.72rem] text-luxury-400">{l.metadata?.hotel_name || l.hotel_id} · {l.city}</div>
              <div className="font-bold text-luxury-900">{l.category || l.room_id}</div>
              <div className="text-[0.78rem] text-luxury-500 mt-0.5">{monthLabel(l.month_key)} · {l.num_rooms} rooms</div>
              <div className="mt-2 text-sm">
                <span className="text-luxury-400 text-[0.72rem]">Min bid</span>{" "}
                <b className="text-luxury-900">{inr(l.min_bid_per_room_night)}</b><span className="text-luxury-400 text-[0.72rem]">/room/night</span>
              </div>
              <button onClick={() => setModalLot(l)}
                className="mt-3 w-full py-2 rounded-xl font-bold text-white" style={{ background: "linear-gradient(135deg,#c9911a,#f0b429)" }}>
                Bid lagao
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="max-w-6xl mx-auto px-4 pb-8 pt-2">
        <p className="text-[0.7rem] text-luxury-400 leading-relaxed">{CIRCLE_AUCTION_NOTE}</p>
      </div>

      {modalLot && <BidModal lot={modalLot} auth={auth} onClose={() => setModalLot(null)} />}
    </div>
  );
}

function AccountStrip({ auth }: { auth: ReturnType<typeof useTradeAuth> }) {
  const [busy, setBusy] = useState(false);
  if (auth.loading) return null;
  if (auth.status === "approved") {
    return <div className="max-w-6xl mx-auto px-4 pt-2 text-[0.75rem] text-green-700">✓ {auth.agent?.agency_name || "Agent"} — approved, aap bid kar sakte ho.</div>;
  }
  const doSignIn = async () => { setBusy(true); try { await auth.signIn(); } catch {} finally { setBusy(false); } };
  return (
    <div className="max-w-6xl mx-auto px-4 pt-2">
      <div className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-[0.78rem] text-amber-800 flex items-center justify-between gap-2">
        <span>
          {auth.status === "signed_out" && "Browse free hai. Bid karne ke liye Google se sign-in + agent registration zaroori."}
          {auth.status === "unregistered" && "Sign-in ho gaya — ab travel-agent registration karo (neeche bid pe)."}
          {auth.status === "pending" && "Aapki agent application review me hai. Approval ke baad bid kar paoge."}
          {auth.status === "rejected" && "Aapki agent application reject hui. Support se sampark karein."}
          {auth.status === "suspended" && "Aapka agent account suspended hai."}
        </span>
        {auth.status === "signed_out" && (
          <button onClick={doSignIn} disabled={busy} className="shrink-0 px-3 py-1.5 rounded-lg font-bold text-white disabled:opacity-50" style={{ background: "#33251a" }}>
            {busy ? "…" : "Google sign-in"}
          </button>
        )}
      </div>
    </div>
  );
}

function BidModal({ lot, auth, onClose }: { lot: Lot; auth: ReturnType<typeof useTradeAuth>; onClose: () => void }) {
  const [segments, setSegments] = useState<Seg[]>([]);
  const [depositPct, setDepositPct] = useState(10);
  const [segKey, setSegKey] = useState("");
  const [perNight, setPerNight] = useState<number>(lot.min_bid_per_room_night);
  const [rooms, setRooms] = useState(1);
  const [agencyName, setAgencyName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`/api/trade/lots/${lot.id}`, { cache: "no-store" });
        const d = await r.json();
        if (r.ok) { setSegments(d.segments || []); setDepositPct(d.depositPct ?? 10); if (d.segments?.[0]) setSegKey(segId(d.segments[0])); }
      } catch {}
    })();
  }, [lot.id]);

  const seg = useMemo(() => segments.find((s) => segId(s) === segKey) || null, [segments, segKey]);
  const preview = seg ? bidCostPreview({ perRoomPerNight: perNight, nights: seg.nights, rooms, depositPct }) : null;

  const belowFloor = perNight < lot.min_bid_per_room_night;

  const addToBundle = () => {
    if (!seg || belowFloor) return;
    addBid({
      key: bidItemKey(lot.id, seg.type, seg.weekIndex), lotId: lot.id,
      hotelName: lot.metadata?.hotel_name || lot.hotel_id, roomName: lot.category || lot.room_id,
      city: lot.city || "", image: lot.metadata?.room_img || "", monthKey: lot.month_key,
      segmentType: seg.type, weekIndex: seg.weekIndex, segmentLabel: seg.label, nights: seg.nights,
      minBid: lot.min_bid_per_room_night, perRoomPerNight: perNight, roomsWanted: rooms,
    });
    onClose();
  };

  const doSignIn = async () => { setBusy(true); setErr(""); try { await auth.signIn(); } catch (e: any) { setErr(e?.message || "Sign-in failed."); } finally { setBusy(false); } };
  const doRegister = async () => {
    if (!agencyName.trim()) { setErr("Agency ka naam daalo."); return; }
    setBusy(true); setErr("");
    try { const res = await auth.register({ agencyName, city: lot.city }); if (!res.ok) setErr(res.data?.error || "Register failed."); }
    catch { setErr("Register failed."); } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className="bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl p-5 max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-2">
          <div className="font-bold text-luxury-900">{lot.category || lot.room_id}</div>
          <button onClick={onClose} className="text-luxury-400 text-xl leading-none">×</button>
        </div>
        <div className="text-[0.75rem] text-luxury-500 mb-3">{lot.metadata?.hotel_name || lot.hotel_id} · {lot.city} · {monthLabel(lot.month_key)}</div>

        {/* Gate */}
        {auth.status !== "approved" ? (
          <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-[0.8rem] text-amber-800 space-y-2">
            {auth.status === "signed_out" && (<>
              <p>Bid karne ke liye Google se sign-in karo (approved travel agents hi bid karte hain).</p>
              <button onClick={doSignIn} disabled={busy} className="w-full py-2 rounded-lg font-bold text-white disabled:opacity-50" style={{ background: "#33251a" }}>{busy ? "…" : "Google sign-in"}</button>
            </>)}
            {auth.status === "unregistered" && (<>
              <p>Travel-agent / agency registration karo — admin approve karega, phir bid.</p>
              <input value={agencyName} onChange={(e) => setAgencyName(e.target.value)} placeholder="Agency ka naam" className="w-full border border-amber-300 rounded-lg px-3 py-2 text-sm" />
              <button onClick={doRegister} disabled={busy} className="w-full py-2 rounded-lg font-bold text-white disabled:opacity-50" style={{ background: "#33251a" }}>{busy ? "…" : "Register as agent"}</button>
            </>)}
            {auth.status === "pending" && <p>Application review me hai — approval ke baad bid khul jaayega.</p>}
            {(auth.status === "rejected" || auth.status === "suspended") && <p>Account {auth.status}. Support se sampark karein.</p>}
            {err && <p className="text-red-600">{err}</p>}
          </div>
        ) : (
          <div className="space-y-3">
            <label className="text-sm block">
              <span className="text-luxury-500 font-semibold">Segment (kitne din chahiye)</span>
              <select value={segKey} onChange={(e) => setSegKey(e.target.value)} className="mt-1 w-full border border-luxury-200 rounded-lg px-3 py-2 text-sm">
                {segments.map((s) => <option key={segId(s)} value={segId(s)}>{s.label} · {s.nights} nights</option>)}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-sm block">
                <span className="text-luxury-500 font-semibold">Bid / room / night</span>
                <input type="number" min={lot.min_bid_per_room_night} value={perNight}
                  onChange={(e) => setPerNight(Number(e.target.value) || 0)}
                  className="mt-1 w-full border border-luxury-200 rounded-lg px-3 py-2 text-sm" />
                <span className="text-[0.7rem] text-luxury-400">Min {inr(lot.min_bid_per_room_night)}</span>
              </label>
              <label className="text-sm block">
                <span className="text-luxury-500 font-semibold">Rooms (max {lot.num_rooms})</span>
                <input type="number" min={1} max={lot.num_rooms} value={rooms}
                  onChange={(e) => setRooms(Math.max(1, Math.min(lot.num_rooms, Number(e.target.value) || 1)))}
                  className="mt-1 w-full border border-luxury-200 rounded-lg px-3 py-2 text-sm" />
              </label>
            </div>
            {belowFloor && <div className="text-[0.78rem] text-red-600">Bid floor se neeche nahi ho sakta.</div>}
            {preview && !belowFloor && (
              <div className="rounded-xl bg-luxury-50 p-3 text-[0.8rem] text-luxury-700 space-y-1">
                <div className="flex justify-between"><span>Bid ({seg?.nights} nights × {rooms} rooms)</span><b>{inr(preview.baseTotal)}</b></div>
                <div className="flex justify-between"><span>EMD deposit ({depositPct}%) abhi</span><b>{inr(preview.deposit)}</b></div>
                <div className="text-[0.7rem] text-luxury-400">Jeet gaye to baaki balance pay + buyer premium. Haar gaye to deposit wapas.</div>
              </div>
            )}
            <button onClick={addToBundle} disabled={belowFloor || !seg}
              className="w-full py-2.5 rounded-xl font-bold text-white disabled:opacity-50" style={{ background: "linear-gradient(135deg,#c9911a,#f0b429)" }}>
              Bundle me add karo
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

const segId = (s: Seg) => `${s.type}:${s.weekIndex ?? ""}`;
