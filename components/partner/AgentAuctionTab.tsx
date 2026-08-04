"use client";

// v361 — Model 3 (travel-agent monthly auction): OWNER SUPPLY tab.
// The property owner publishes spare inventory for an upcoming whole month as an
// auction "lot". Approved travel agents then bid on it. The min bid floor is
// StayBid-computed from the Spine (owner never sells below cost); the owner may
// raise it. Reads/writes /api/trade/owner/* (partner-scoped server-side).
//
// v730 — HIGH-TECH REDESIGN (presentation only; all logic/state/API calls are
// byte-identical to v729). The flat white boxes become a premium, layered
// control-panel: a dark steel hero, elevated selectable mode/autopilot tiles, a
// rooms stepper, a live wholesale-floor GAUGE, modern info pills, and premium
// lot/bid rows — matching the partner dashboard's design system (.card-p /
// .btn-gold steel gradient / gold value accents) + the "Manage My Price" ladder.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Tag, Zap, Lock, Info, Gauge, Sparkles, Minus, Plus, BadgeCheck, ShieldCheck, Wallet } from "lucide-react";
import { LIVE_AUTOPILOT_LABEL, LIVE_AUTOPILOT_DESC, type LiveAutopilotMode } from "@/lib/trade/live-auction";

function getToken() {
  return typeof window !== "undefined" ? localStorage.getItem("sb_partner_token") || "" : "";
}
const inr = (n: any) => `₹${Math.round(Number(n) || 0).toLocaleString("en-IN")}`;
const fmtDate = (s: string) => {
  try { return new Date(s).toLocaleDateString("en-IN", { day: "numeric", month: "short" }); } catch { return s; }
};

// Shared visual tokens (match the dashboard steel-gradient CTA + gold accents).
const STEEL = "radial-gradient(88% 64% at 32% 4%,rgba(240,247,253,0.24),transparent 58%),linear-gradient(160deg,#a0b2c6 0%,#6f8aa6 50%,#42566d 100%)";
const RING_ACTIVE = { boxShadow: "0 0 0 1.5px #8198ae, 0 8px 22px rgba(66,86,109,0.16)" };

type RoomCat = { id: string; name?: string | null; floorPrice?: number | null };
type UpMonth = { monthKey: string; monthStart: string; monthEnd: string; nights: number; windowOpenAt: string; windowCloseAt: string; phase: string };
type Lot = {
  id: string; hotel_id: string; room_id: string; category?: string | null; city?: string | null;
  month_key: string; num_rooms: number; min_bid_per_room_night: number;
  window_open_at: string; window_close_at: string; status: string; bid_count?: number;
  sale_mode?: string; autopilot_mode?: string;
};

const STATUS_STYLE: Record<string, { cls: string; label: string; dot: string }> = {
  open:      { cls: "bg-emerald-50 text-emerald-700 border-emerald-200", label: "Live",      dot: "bg-emerald-500" },
  draft:     { cls: "bg-blue-50 text-blue-700 border-blue-200",          label: "Scheduled", dot: "bg-blue-500" },
  closed:    { cls: "bg-purple-50 text-purple-700 border-purple-200",    label: "Closed",    dot: "bg-purple-500" },
  awarded:   { cls: "bg-amber-50 text-amber-700 border-amber-200",       label: "Awarded",   dot: "bg-amber-500" },
  cancelled: { cls: "bg-luxury-100 text-luxury-500 border-luxury-200",   label: "Cancelled", dot: "bg-luxury-400" },
};

// A compact −/value/+ stepper so every count is reliably selectable (no browser
// spinner jumping to max). Mirrors the trade RoomStepper pattern.
function Stepper({ value, min, max, onChange }: { value: number; min: number; max: number; onChange: (v: number) => void }) {
  const set = (v: number) => onChange(Math.max(min, Math.min(max, v)));
  return (
    <div className="mt-1 flex items-center rounded-xl border border-luxury-200 bg-white overflow-hidden">
      <button type="button" aria-label="Fewer rooms" onClick={() => set(value - 1)} disabled={value <= min}
        className="px-4 py-2.5 text-luxury-500 hover:bg-luxury-50 disabled:opacity-30 transition"><Minus size={15} strokeWidth={2.7} aria-hidden /></button>
      <div className="flex-1 text-center text-sm font-extrabold text-luxury-900 tabular-nums select-none">{value}</div>
      <button type="button" aria-label="More rooms" onClick={() => set(value + 1)} disabled={value >= max}
        className="px-4 py-2.5 text-luxury-500 hover:bg-luxury-50 disabled:opacity-30 transition"><Plus size={15} strokeWidth={2.7} aria-hidden /></button>
    </div>
  );
}

export default function AgentAuctionTab({
  hotelId, hotelName, city, rooms,
}: { hotelId: string; hotelName?: string; city?: string; rooms: RoomCat[] }) {
  const [lots, setLots] = useState<Lot[]>([]);
  const [upcoming, setUpcoming] = useState<UpMonth[]>([]);
  const [cfg, setCfg] = useState<{ depositPct: number; buyerPremiumPct: number } | null>(null);

  const [saleMode, setSaleMode] = useState<"live" | "sealed">("live");
  const [autopilotMode, setAutopilotMode] = useState<LiveAutopilotMode>("hybrid");
  const [roomId, setRoomId] = useState("");
  const [monthKey, setMonthKey] = useState("");
  const [numRooms, setNumRooms] = useState(2);
  const [minBid, setMinBid] = useState<number | "">("");
  const [floor, setFloor] = useState<number | null>(null);
  const [win, setWin] = useState<UpMonth | null>(null);
  const [conflict, setConflict] = useState(false);
  const [circleOwner, setCircleOwner] = useState(false);
  const [circleMult, setCircleMult] = useState(1.2);
  const [retailFloor, setRetailFloor] = useState<number | null>(null);
  const [wholesaleDiscount, setWholesaleDiscount] = useState(20);
  const [spineAdr, setSpineAdr] = useState<number | null>(null);
  const [floorMode, setFloorMode] = useState<"dynamic" | "static">("dynamic");
  const [minFloorFraction, setMinFloorFraction] = useState(0.6);
  const [monthlyRate, setMonthlyRate] = useState<number | "">(""); // Circle owner's monthly purchase rate
  const [quoting, setQuoting] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const selectedRoom = useMemo(() => rooms.find((r) => r.id === roomId), [rooms, roomId]);

  // Circle owner: purchase/night = monthly rate ÷ 30; floor = purchase × multiplier.
  const purchasePerNight = circleOwner && monthlyRate !== "" ? Math.round(Number(monthlyRate) / 30) : 0;
  const ceil100 = (n: number) => Math.max(100, Math.ceil(n / 100) * 100);
  // Property-owner floor previews the SAME formula the server enforces, live as
  // the owner drags the discount: dynamic = ceil100(ADR × (1−disc)) anchored at
  // retail × minFloorFraction; static = ceil100(retail × (1−disc)).
  const propFloorPreview = (): number | null => {
    if (!retailFloor) return floor;
    if (floorMode === "dynamic" && spineAdr && spineAdr > 0) {
      return Math.max(ceil100(spineAdr * (1 - wholesaleDiscount / 100)), ceil100(retailFloor * minFloorFraction), 100);
    }
    return Math.max(ceil100(retailFloor * (1 - wholesaleDiscount / 100)), 100);
  };
  const effFloor: number | null = circleOwner
    ? (purchasePerNight > 0 ? Math.max(Math.ceil((purchasePerNight * circleMult) / 100) * 100, 100) : null)
    : propFloorPreview();

  const [pending, setPending] = useState<any[]>([]);
  const [bidBusy, setBidBusy] = useState("");
  const [counterVal, setCounterVal] = useState<Record<string, number | "">>({});

  const loadLots = useCallback(async () => {
    try {
      const r = await fetch("/api/trade/owner/lots", { headers: { Authorization: `Bearer ${getToken()}` }, cache: "no-store" });
      const d = await r.json();
      if (r.ok) setLots(Array.isArray(d.lots) ? d.lots : []);
    } catch { /* ignore */ }
  }, []);

  const loadPending = useCallback(async () => {
    try {
      const r = await fetch("/api/trade/owner/live-bids", { headers: { Authorization: `Bearer ${getToken()}` }, cache: "no-store" });
      const d = await r.json();
      if (r.ok) setPending(Array.isArray(d.bids) ? d.bids : []);
    } catch { /* ignore */ }
  }, []);

  const actOnBid = useCallback(async (bidId: string, action: "accept" | "reject" | "counter", counterPerRoomPerNight?: number) => {
    setBidBusy(bidId); setMsg(null);
    try {
      const r = await fetch("/api/trade/owner/live-bids", {
        method: "POST", headers: { Authorization: `Bearer ${getToken()}`, "Content-Type": "application/json" },
        body: JSON.stringify({ bidId, action, counterPerRoomPerNight }),
      });
      const d = await r.json();
      if (r.ok) { setMsg({ ok: true, text: action === "accept" ? "Bid accepted — the agent will pay to lock the rooms." : action === "reject" ? "Bid declined." : "Counter sent to the agent." }); loadPending(); loadLots(); }
      else setMsg({ ok: false, text: d.error || "Action failed." });
    } catch { setMsg({ ok: false, text: "Network error." }); } finally { setBidBusy(""); }
  }, [loadPending, loadLots]);

  // Initial: config + upcoming months + existing lots.
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/trade/owner/quote", {
          method: "POST", headers: { Authorization: `Bearer ${getToken()}`, "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        const d = await r.json();
        if (r.ok) { setUpcoming(d.upcoming || []); setCfg(d.config || null); if (d.upcoming?.[0]) setMonthKey(d.upcoming[0].monthKey); }
      } catch { /* ignore */ }
    })();
    loadLots();
    loadPending();
  }, [loadLots, loadPending]);

  // (Re)quote the floor whenever room + month are chosen.
  useEffect(() => {
    if (!roomId || !monthKey) { setFloor(null); setWin(null); return; }
    let cancelled = false;
    setQuoting(true);
    (async () => {
      try {
        const r = await fetch("/api/trade/owner/quote", {
          method: "POST", headers: { Authorization: `Bearer ${getToken()}`, "Content-Type": "application/json" },
          body: JSON.stringify({ hotelId, roomId, monthKey }),
        });
        const d = await r.json();
        if (cancelled) return;
        if (r.ok) {
          setFloor(d.minBidPerRoomNight ?? null);
          setWin(d.window ? { ...(d.range || {}), ...d.window } as any : null);
          setConflict(!!d.model2Conflict);
          setCircleOwner(!!d.circleOperated);
          if (d.circleFloorMultiplier) setCircleMult(Number(d.circleFloorMultiplier) || 1.2);
          setRetailFloor(d.retailFloor ?? null);
          if (d.wholesaleDiscountPct != null) setWholesaleDiscount(Number(d.wholesaleDiscountPct) || 20);
          setSpineAdr(d.spineAdr ?? null);
          setFloorMode(d.floorMode === "static" ? "static" : "dynamic");
          if (d.minFloorFraction != null) setMinFloorFraction(Number(d.minFloorFraction) || 0.6);
          if (d.minBidPerRoomNight != null) setMinBid((prev) => (prev === "" || Number(prev) < d.minBidPerRoomNight ? d.minBidPerRoomNight : prev));
        } else { setMsg({ ok: false, text: d.error || "Quote failed." }); }
      } catch { /* ignore */ } finally { if (!cancelled) setQuoting(false); }
    })();
    return () => { cancelled = true; };
  }, [hotelId, roomId, monthKey]);

  const publish = async () => {
    if (!roomId || !monthKey || !effFloor) return;
    setPublishing(true); setMsg(null);
    try {
      const r = await fetch("/api/trade/owner/lots", {
        method: "POST", headers: { Authorization: `Bearer ${getToken()}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          hotelId, roomId, monthKey, numRooms,
          saleMode, autopilotMode,
          minBidPerRoomNight: minBid === "" ? effFloor : Number(minBid),
          wholesaleDiscountPct: circleOwner ? undefined : wholesaleDiscount,
          monthlyRate: circleOwner && monthlyRate !== "" ? Number(monthlyRate) : undefined,
          category: selectedRoom?.name || null, city: city || null,
        }),
      });
      const d = await r.json();
      if (r.ok) {
        setMsg({ ok: true, text: d.saleMode === "live"
          ? "Lot is LIVE — agents can bid now, and your autopilot handles acceptance."
          : d.phase === "open" ? "Lot is LIVE — agents can bid now." : `Lot scheduled — the window opens on ${fmtDate(d.scheduledOpensAt)}.` });
        setRoomId(""); setMinBid(""); setFloor(null); setWin(null);
        loadLots();
      } else { setMsg({ ok: false, text: d.error || "Publish failed." }); }
    } catch { setMsg({ ok: false, text: "Network error." }); } finally { setPublishing(false); }
  };

  const cancelLot = async (id: string) => {
    try {
      const r = await fetch(`/api/trade/owner/lots/${id}`, {
        method: "PATCH", headers: { Authorization: `Bearer ${getToken()}`, "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel" }),
      });
      const d = await r.json();
      if (r.ok) loadLots(); else setMsg({ ok: false, text: d.error || "Cancel failed." });
    } catch { /* ignore */ }
  };

  const monthLabel = (mk: string) => {
    try { const [y, m] = mk.split("-").map(Number); return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-IN", { month: "long", year: "numeric" }); }
    catch { return mk; }
  };

  // ── Live wholesale-floor gauge geometry (property owner) ──────────────────
  // Track spans the safety anchor → market ADR; the gold marker sits at "Your
  // Floor". Purely presentational — reads the same numbers the server enforces.
  const anchor = retailFloor != null ? ceil100(retailFloor * minFloorFraction) : null;
  const ceilRef = floorMode === "dynamic" && spineAdr ? spineAdr : retailFloor;
  const gaugePct = (() => {
    if (anchor == null || ceilRef == null || effFloor == null || ceilRef <= anchor) return 50;
    return Math.max(4, Math.min(96, ((effFloor - anchor) / (ceilRef - anchor)) * 100));
  })();

  const canPublish = !!roomId && !!monthKey && !!effFloor && !publishing;

  return (
    <div className="space-y-5 fade-up">
      {/* ── HERO ── */}
      <div className="relative overflow-hidden rounded-2xl p-5 sm:p-6"
        style={{ background: "radial-gradient(120% 150% at 12% -10%,rgba(129,152,174,0.30),transparent 52%),linear-gradient(155deg,#243244 0%,#18222f 58%,#101820 100%)", color: "#eef3f8" }}>
        <div className="absolute inset-x-0 top-0 h-px" style={{ background: "linear-gradient(90deg,transparent,rgba(212,183,120,0.7),transparent)" }} />
        <div className="relative">
          <div className="inline-flex items-center gap-2 text-[0.6rem] font-bold uppercase tracking-[0.22em] px-2.5 py-1 rounded-full"
            style={{ background: "rgba(255,255,255,0.08)", color: "#cdd7e2", border: "1px solid rgba(255,255,255,0.12)" }}>
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />B2B Wholesale Marketplace
          </div>
          <h2 className="mt-2.5 text-xl sm:text-2xl font-bold inline-flex items-center gap-2" style={{ letterSpacing: "-0.01em" }}>
            <Tag size={20} strokeWidth={2.3} aria-hidden />Sell to Travel Agents
          </h2>
          <p className="text-sm mt-1.5 max-w-2xl" style={{ color: "rgba(238,243,248,0.82)", lineHeight: 1.6 }}>
            Offer spare inventory to agents by the <b>month</b>. StayBid sets a minimum price from your cost
            (never below it) — you can only raise it.
          </p>
          <div className="mt-3.5 flex flex-wrap gap-2">
            {[
              { Ic: ShieldCheck, t: "Floor-protected" },
              { Ic: Zap, t: "Live · no deposit" },
              { Ic: Sparkles, t: "Autopilot accepts" },
            ].map((c) => (
              <span key={c.t} className="inline-flex items-center gap-1.5 text-[0.72rem] font-semibold px-2.5 py-1.5 rounded-lg"
                style={{ background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.11)", color: "#dbe4ee" }}>
                <c.Ic size={13} strokeWidth={2.3} aria-hidden style={{ color: "#e6c887" }} />{c.t}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* ── PUBLISH A NEW LOT ── */}
      <div className="card-p p-0! overflow-hidden">
        <div className="flex items-center gap-2.5 px-5 pt-4 pb-3 border-b border-luxury-100">
          <span className="grid place-items-center w-8 h-8 rounded-xl text-white shrink-0" style={{ background: STEEL }}>
            <Plus size={17} strokeWidth={2.6} aria-hidden />
          </span>
          <div>
            <div className="font-bold text-luxury-900 leading-tight">Publish a new lot</div>
            <div className="text-[0.7rem] text-luxury-400">Pick a channel, tune the floor, and go live in seconds.</div>
          </div>
        </div>

        <div className="p-5 space-y-4">
          {/* STEP 1 — Sale mode */}
          <div>
            <div className="text-[0.63rem] font-bold uppercase tracking-widest text-luxury-400 mb-1.5">1 · How agents buy</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {([
                { k: "live", Ic: Zap, t: "Live (always open)", d: "Agents bid anytime — no deposit. Your autopilot accepts." },
                { k: "sealed", Ic: Lock, t: "Sealed month-end", d: "Agents bid with a deposit; highest bids win at close." },
              ] as const).map((o) => {
                const on = saleMode === o.k;
                return (
                  <button key={o.k} type="button" onClick={() => setSaleMode(o.k)}
                    className={`group text-left rounded-xl border px-3.5 py-3 transition-all ${on ? "border-transparent bg-white" : "bg-white border-luxury-200 hover:border-luxury-300 hover:-translate-y-0.5"}`}
                    style={on ? RING_ACTIVE : undefined}>
                    <div className="flex items-center gap-2">
                      <span className={`grid place-items-center w-7 h-7 rounded-lg shrink-0 transition ${on ? "text-white" : "text-luxury-500 bg-luxury-50"}`}
                        style={on ? { background: STEEL } : undefined}>
                        <o.Ic size={14} strokeWidth={2.5} aria-hidden />
                      </span>
                      <span className="text-sm font-bold text-luxury-900">{o.t}</span>
                      {on && <BadgeCheck size={15} strokeWidth={2.5} aria-hidden className="ml-auto text-[#6f8aa6]" />}
                    </div>
                    <div className="text-[0.72rem] text-luxury-500 mt-1.5 leading-snug">{o.d}</div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* STEP 2 — Autopilot (LIVE only) */}
          {saleMode === "live" && (
            <div>
              <div className="text-[0.63rem] font-bold uppercase tracking-widest text-luxury-400 mb-1.5">2 · Autopilot — how bids get accepted</div>
              <div className="grid sm:grid-cols-3 gap-2">
                {(["hybrid", "auto", "manual"] as LiveAutopilotMode[]).map((m) => {
                  const on = autopilotMode === m;
                  return (
                    <button key={m} type="button" onClick={() => setAutopilotMode(m)}
                      className={`text-left rounded-xl border px-3 py-2.5 transition-all ${on ? "border-transparent bg-white" : "bg-white border-luxury-200 hover:border-luxury-300"}`}
                      style={on ? RING_ACTIVE : undefined}>
                      <div className="text-[0.82rem] font-bold text-luxury-900 flex items-center gap-1.5">
                        {LIVE_AUTOPILOT_LABEL[m]}{on && <span className="w-1.5 h-1.5 rounded-full bg-[#6f8aa6]" />}
                      </div>
                      <div className="text-[0.68rem] text-luxury-500 mt-0.5 leading-snug">{LIVE_AUTOPILOT_DESC[m]}</div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* STEP 3 — the lot */}
          <div>
            <div className="text-[0.63rem] font-bold uppercase tracking-widest text-luxury-400 mb-1.5">{saleMode === "live" ? "3" : "2"} · What you're selling</div>
            <div className="grid sm:grid-cols-2 gap-3">
              <label className="text-sm block">
                <span className="text-[0.63rem] font-bold uppercase tracking-widest text-luxury-400">Room category</span>
                <select value={roomId} onChange={(e) => setRoomId(e.target.value)} className="inp-p mt-1">
                  <option value="">— choose —</option>
                  {rooms.map((r) => <option key={r.id} value={r.id}>{r.name || r.id}</option>)}
                </select>
              </label>
              <label className="text-sm block">
                <span className="text-[0.63rem] font-bold uppercase tracking-widest text-luxury-400">Month</span>
                <select value={monthKey} onChange={(e) => setMonthKey(e.target.value)} className="inp-p mt-1">
                  {upcoming.map((u) => <option key={u.monthKey} value={u.monthKey}>{monthLabel(u.monthKey)}</option>)}
                </select>
              </label>
              <label className="text-sm block">
                <span className="text-[0.63rem] font-bold uppercase tracking-widest text-luxury-400">Number of rooms (units)</span>
                <Stepper value={numRooms} min={1} max={50} onChange={setNumRooms} />
              </label>
              <label className="text-sm block">
                <span className="text-[0.63rem] font-bold uppercase tracking-widest text-luxury-400">Min bid / room / night {quoting && <span className="text-luxury-400 animate-pulse">·syncing</span>}</span>
                <div className="relative mt-1">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-luxury-400 text-sm font-medium">₹</span>
                  <input type="number" min={effFloor || 0} value={minBid}
                    onChange={(e) => setMinBid(e.target.value === "" ? "" : Number(e.target.value))}
                    placeholder={effFloor ? String(effFloor) : "—"} className="inp-p pl-7" />
                </div>
                {effFloor != null ? (
                  <span className="text-[0.72rem] text-luxury-400 mt-1 block">
                    StayBid floor: <b className="text-luxury-600">{inr(effFloor)}</b>/room/night — can't go below this.
                    {circleOwner
                      ? ` Circle inventory: floor = your purchase (${inr(purchasePerNight)}/night) × ${circleMult} = cost + ${Math.round((circleMult - 1) * 100)}% profit.`
                      : retailFloor
                        ? (floorMode === "dynamic" && spineAdr
                            ? ` Dynamic floor = live market ADR ${inr(spineAdr)} − ${wholesaleDiscount}% (tracks demand each month; never below ${inr(ceil100(retailFloor * minFloorFraction))}).`
                            : ` Wholesale floor = your retail floor ${inr(retailFloor)} − ${wholesaleDiscount}% so agents have real resale margin.`)
                        : " Property owner: bulk wholesale floor (below retail) so agents have resale margin."}
                  </span>
                ) : circleOwner ? (
                  <span className="text-[0.72rem] text-amber-600 mt-1 block">Enter your monthly purchase rate below to compute the floor.</span>
                ) : null}
              </label>
            </div>
          </div>

          {/* Circle owner: purchase price → floor = purchase/night × multiplier */}
          {circleOwner && (
            <label className="text-sm block rounded-xl border border-amber-200 bg-amber-50/60 p-3">
              <span className="text-[0.63rem] font-bold uppercase tracking-widest text-amber-700 inline-flex items-center gap-1.5"><Wallet size={12} strokeWidth={2.5} aria-hidden />Your monthly purchase rate (₹ / room / month)</span>
              <div className="relative mt-1">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-luxury-400 text-sm font-medium">₹</span>
                <input type="number" min={0} value={monthlyRate}
                  onChange={(e) => setMonthlyRate(e.target.value === "" ? "" : Number(e.target.value))}
                  placeholder="e.g. 30000" className="inp-p pl-7" />
              </div>
              <span className="text-[0.72rem] text-luxury-500 mt-1 block">
                What you paid to own the room. Per night = ÷ 30{purchasePerNight > 0 ? ` = ${inr(purchasePerNight)}` : ""}. Your floor = that × {circleMult}.
              </span>
            </label>
          )}

          {/* Property owner: wholesale-discount GAUGE + live floor breakdown */}
          {!circleOwner && roomId && retailFloor != null && (
            <div className="rounded-xl border border-luxury-200 p-3.5" style={{ background: "linear-gradient(180deg,#fbfcfd,#f4f7fa)" }}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[0.63rem] font-bold uppercase tracking-widest text-luxury-500 inline-flex items-center gap-1.5"><Gauge size={13} strokeWidth={2.4} aria-hidden />Wholesale floor</span>
                <span className="text-sm font-extrabold text-gold-700">{wholesaleDiscount}% off</span>
              </div>
              {/* Visual gauge: anchor ——●(your floor)—— market */}
              <div className="relative h-2.5 rounded-full mt-2 mb-1" style={{ background: "linear-gradient(90deg,#e9463a22,#d4b77833 45%,#10b98122)" }}>
                <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${gaugePct}%`, background: "linear-gradient(90deg,#6f8aa6,#42566d)" }} />
                <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-4 h-4 rounded-full border-2 border-white shadow" style={{ left: `${gaugePct}%`, background: "linear-gradient(160deg,#ffd98a,#d69a1e)" }} />
              </div>
              <input type="range" min={0} max={40} step={1} value={wholesaleDiscount}
                onChange={(e) => setWholesaleDiscount(Number(e.target.value))} className="w-full accent-gold-500" aria-label="Wholesale discount percent" />
              <div className="grid grid-cols-3 gap-2 mt-2 text-center">
                <div className="rounded-lg bg-white border border-luxury-100 px-2 py-1.5">
                  <div className="text-[0.6rem] font-bold text-luxury-400 tracking-wide">{floorMode === "dynamic" && spineAdr ? "MARKET ADR" : "RETAIL FLOOR"}</div>
                  <div className="text-[0.92rem] font-extrabold text-luxury-900">{inr(floorMode === "dynamic" && spineAdr ? spineAdr : retailFloor)}</div>
                </div>
                <div className="rounded-lg bg-white px-2 py-1.5" style={{ boxShadow: "0 0 0 1.5px #e6c887 inset" }}>
                  <div className="text-[0.6rem] font-bold text-gold-600 tracking-wide">YOUR FLOOR</div>
                  <div className="text-[0.92rem] font-extrabold text-gold-700">{effFloor != null ? inr(effFloor) : "—"}</div>
                </div>
                <div className="rounded-lg bg-white border border-luxury-100 px-2 py-1.5">
                  <div className="text-[0.6rem] font-bold text-luxury-400 tracking-wide">SAFETY ANCHOR</div>
                  <div className="text-[0.92rem] font-extrabold text-luxury-900">{inr(ceil100(retailFloor * minFloorFraction))}</div>
                </div>
              </div>
              <div className="text-[0.68rem] text-luxury-400 mt-1.5 leading-snug">
                {floorMode === "dynamic"
                  ? "Floor tracks the live market each month; a higher discount = more agent margin & faster sales. Never below the safety anchor."
                  : "A higher discount = more agent margin & faster sales."} Set the min bid above to raise it further.
              </div>
            </div>
          )}

          {/* Info pills */}
          {saleMode === "live" ? (
            monthKey && (
              <div className="text-[0.78rem] text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2.5 flex items-start gap-2">
                <Zap size={14} strokeWidth={2.4} aria-hidden className="mt-0.5 shrink-0 text-emerald-600" />
                <span><b>Always open</b> — agents can bid now through <b>{monthLabel(monthKey)}</b>. <b>No deposit.</b>{" "}
                Accepted agents pay within {cfg ? "the pay window" : "24h"} from their dashboard, then get the inventory.</span>
              </div>
            )
          ) : win ? (
            <div className="text-[0.78rem] text-luxury-600 bg-luxury-50 border border-luxury-200 rounded-xl px-3 py-2.5">
              Bidding window: <b>{fmtDate(win.windowOpenAt)}</b> → <b>{fmtDate(win.windowCloseAt)}</b>
              {win.phase === "open" ? " · LIVE now" : ` · opens ${fmtDate(win.windowOpenAt)}`} ·
              {" "}{win.nights} nights · agent EMD deposit {cfg?.depositPct ?? 10}%
            </div>
          ) : null}

          {conflict && (
            <div className="text-[0.8rem] rounded-xl px-3 py-2.5 bg-blue-50 text-blue-700 border border-blue-200 flex items-start gap-2">
              <Info size={14} strokeWidth={2.4} aria-hidden className="mt-0.5 shrink-0" />
              <span>This room is also listed on <b>Model 2</b> — that's fine. Both channels <b>run together</b>; availability is shared (a unit sold on one channel is automatically blocked on the other — no clash).</span>
            </div>
          )}

          {msg && (
            <div className={`text-sm rounded-xl px-3 py-2.5 border ${msg.ok ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-red-50 text-red-600 border-red-200"}`}>{msg.text}</div>
          )}

          <button onClick={publish} disabled={!canPublish}
            className="btn-gold w-full sm:w-auto justify-center inline-flex items-center gap-2 py-3! px-6! text-sm!">
            {publishing ? "Publishing…" : <><Zap size={15} strokeWidth={2.6} aria-hidden />Publish auction lot</>}
          </button>
        </div>
      </div>

      {/* ── Pending LIVE bids to review ── */}
      {pending.length > 0 && (
        <div className="rounded-2xl border border-amber-200 p-5" style={{ background: "linear-gradient(180deg,#fffdf6,#fff8e8)" }}>
          <div className="font-bold text-luxury-900 mb-1 inline-flex items-center gap-2">
            <span className="grid place-items-center w-7 h-7 rounded-lg text-white" style={{ background: "linear-gradient(160deg,#f4b942,#d68a17)" }}><Zap size={15} strokeWidth={2.5} aria-hidden /></span>
            Live bids to review
            <span className="text-[0.7rem] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">{pending.length}</span>
          </div>
          <p className="text-[0.78rem] text-luxury-500 mb-3">Agents bidding on your always-open lots. Accept to lock the sale (they pay next), decline, or counter with a different price.</p>
          <div className="space-y-2">
            {pending.map((b) => {
              const bFloor = Number(b.lot?.min_bid_per_room_night) || 0;
              const cv = counterVal[b.id];
              const below = b.metadata?.below_floor || Number(b.per_room_per_night) < bFloor;
              return (
                <div key={b.id} className="border border-amber-200 rounded-xl px-3.5 py-3 bg-white shadow-sm">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-luxury-900 truncate">
                        {b.lot?.category || b.lot?.room_id} · {monthLabel(b.lot?.month_key || "")}
                        {b.status === "countered" && <span className="ml-1.5 text-[0.68rem] text-purple-700 font-bold px-1.5 py-0.5 rounded bg-purple-50">countered</span>}
                      </div>
                      <div className="text-[0.75rem] text-luxury-500 mt-0.5">
                        {b.segment_label} · <b className="text-luxury-800">{inr(b.per_room_per_night)}</b>/room/night × {b.rooms_wanted} rooms · floor {inr(bFloor)}
                        {below && <span className="ml-1.5 text-[0.66rem] font-bold text-amber-700 px-1.5 py-0.5 rounded bg-amber-100">below floor</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button onClick={() => actOnBid(b.id, "accept")} disabled={bidBusy === b.id}
                        className="px-3.5 py-1.5 rounded-lg text-[0.75rem] font-bold text-white disabled:opacity-50 transition hover:-translate-y-0.5" style={{ background: "linear-gradient(135deg,#059669,#10b981)", boxShadow: "0 2px 8px rgba(16,185,129,0.28)" }}>Accept</button>
                      <button onClick={() => actOnBid(b.id, "reject")} disabled={bidBusy === b.id}
                        className="px-3.5 py-1.5 rounded-lg text-[0.75rem] font-bold text-red-600 border border-red-200 bg-white hover:bg-red-50 disabled:opacity-50 transition">Decline</button>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 mt-2.5">
                    <div className="relative">
                      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-luxury-400 text-[0.8rem]">₹</span>
                      <input type="number" min={bFloor} placeholder={`Counter ≥ ${bFloor}`} value={cv ?? ""}
                        onChange={(e) => setCounterVal((m) => ({ ...m, [b.id]: e.target.value === "" ? "" : Number(e.target.value) }))}
                        className="w-40 border border-luxury-200 rounded-lg pl-6 pr-2.5 py-1.5 text-[0.8rem] outline-none focus:border-[#8198ae]" />
                    </div>
                    <button onClick={() => cv && Number(cv) >= bFloor && actOnBid(b.id, "counter", Number(cv))}
                      disabled={bidBusy === b.id || !cv || Number(cv) < bFloor}
                      className="px-3.5 py-1.5 rounded-lg text-[0.75rem] font-bold text-white disabled:opacity-40 transition" style={{ background: "#6d28d9" }}>Counter</button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Your lots ── */}
      <div className="card-p">
        <div className="flex items-center justify-between mb-3">
          <div className="font-bold text-luxury-900 inline-flex items-center gap-2"><Tag size={15} strokeWidth={2.4} aria-hidden className="text-luxury-400" />Your lots</div>
          {lots.length > 0 && <span className="text-[0.7rem] font-semibold text-luxury-400">{lots.length} total</span>}
        </div>
        {lots.length === 0 ? (
          <div className="text-center py-8">
            <span className="grid place-items-center w-11 h-11 mx-auto rounded-2xl bg-luxury-50 text-luxury-300 mb-2"><Tag size={19} strokeWidth={1.9} aria-hidden /></span>
            <p className="text-sm text-luxury-500 font-semibold">No lots yet</p>
            <p className="text-[0.75rem] text-luxury-400 mt-0.5">Publish one above to start selling to agents.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {lots.map((l) => {
              const st = STATUS_STYLE[l.status] || STATUS_STYLE.draft;
              return (
                <div key={l.id} className="flex items-center justify-between gap-3 border border-luxury-100 rounded-xl px-3.5 py-3 bg-white hover:border-luxury-200 transition">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-luxury-900 truncate">
                      {l.category || l.room_id} · {monthLabel(l.month_key)}
                    </div>
                    <div className="text-[0.75rem] text-luxury-500 mt-0.5 flex items-center gap-1.5 flex-wrap">
                      <span>{l.num_rooms} rooms</span><span className="text-luxury-300">·</span>
                      <span>min <b className="text-luxury-700">{inr(l.min_bid_per_room_night)}</b>/night</span><span className="text-luxury-300">·</span>
                      <span>{l.bid_count || 0} bids</span>
                      {l.sale_mode === "live" && (
                        <span className="inline-flex items-center gap-1 font-semibold text-emerald-700"><span className="text-luxury-300">·</span><Zap size={11} strokeWidth={2.6} aria-hidden />Live · {LIVE_AUTOPILOT_LABEL[(l.autopilot_mode as LiveAutopilotMode) || "hybrid"]}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2.5 shrink-0">
                    <span className={`inline-flex items-center gap-1.5 text-[0.68rem] font-bold px-2.5 py-1 rounded-full border ${st.cls}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${st.dot} ${l.status === "open" ? "animate-pulse" : ""}`} />{st.label}
                    </span>
                    {["draft", "open"].includes(l.status) && (l.bid_count || 0) === 0 && (
                      <button onClick={() => cancelLot(l.id)} className="text-[0.72rem] text-red-500 hover:text-red-600 font-semibold">Cancel</button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
