"use client";

// v361 — Model 3 (travel-agent monthly auction): OWNER SUPPLY tab.
// The property owner publishes spare inventory for an upcoming whole month as an
// auction "lot". Approved travel agents then bid on it. The min bid floor is
// StayBid-computed from the Spine (owner never sells below cost); the owner may
// raise it. Reads/writes /api/trade/owner/* (partner-scoped server-side).

import { useCallback, useEffect, useMemo, useState } from "react";
import { LIVE_AUTOPILOT_LABEL, LIVE_AUTOPILOT_DESC, type LiveAutopilotMode } from "@/lib/trade/live-auction";

function getToken() {
  return typeof window !== "undefined" ? localStorage.getItem("sb_partner_token") || "" : "";
}
const inr = (n: any) => `₹${Math.round(Number(n) || 0).toLocaleString("en-IN")}`;
const fmtDate = (s: string) => {
  try { return new Date(s).toLocaleDateString("en-IN", { day: "numeric", month: "short" }); } catch { return s; }
};

type RoomCat = { id: string; name?: string | null; floorPrice?: number | null };
type UpMonth = { monthKey: string; monthStart: string; monthEnd: string; nights: number; windowOpenAt: string; windowCloseAt: string; phase: string };
type Lot = {
  id: string; hotel_id: string; room_id: string; category?: string | null; city?: string | null;
  month_key: string; num_rooms: number; min_bid_per_room_night: number;
  window_open_at: string; window_close_at: string; status: string; bid_count?: number;
  sale_mode?: string; autopilot_mode?: string;
};

const STATUS_STYLE: Record<string, { bg: string; c: string; label: string }> = {
  open:      { bg: "#ecfdf5", c: "#047857", label: "Live" },
  draft:     { bg: "#eff6ff", c: "#1d4ed8", label: "Scheduled" },
  closed:    { bg: "#f5f3ff", c: "#6d28d9", label: "Closed" },
  awarded:   { bg: "#fef9c3", c: "#a16207", label: "Awarded" },
  cancelled: { bg: "#f3f4f6", c: "#6b7280", label: "Cancelled" },
};

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

  return (
    <div className="space-y-5">
      {/* Intro */}
      <div className="rounded-2xl p-5" style={{ background: "linear-gradient(135deg,#1f1710,#33251a)", color: "#ffe9c7" }}>
        <div className="text-lg font-bold" style={{ color: "#ffd98a" }}>🏷️ Sell to Travel Agents</div>
        <p className="text-sm mt-1 opacity-90">
          Offer your spare inventory to travel agents by the <b>month</b>. StayBid computes the minimum price from your
          cost (never sells below it); you can only raise it. Choose <b>Live</b> — always-open bidding your autopilot
          handles automatically — or a <b>Sealed</b> month-end auction where the highest bids win.
        </p>
      </div>

      {/* Publish form */}
      <div className="rounded-2xl border border-luxury-200 bg-white p-5 space-y-4">
        <div className="font-bold text-luxury-900">Publish a new lot</div>

        {/* Sale mode toggle */}
        <div className="grid grid-cols-2 gap-2">
          {([
            { k: "live", t: "⚡ Live (always open)", d: "Agents bid anytime — no deposit. Your autopilot accepts." },
            { k: "sealed", t: "🔒 Sealed month-end", d: "Agents bid with a deposit; highest bids win at close." },
          ] as const).map((o) => (
            <button key={o.k} type="button" onClick={() => setSaleMode(o.k)}
              className="text-left rounded-xl border-2 px-3 py-2.5 transition"
              style={{ borderColor: saleMode === o.k ? "#c9911a" : "#e5e0d5", background: saleMode === o.k ? "#fffbef" : "#fff" }}>
              <div className="text-sm font-bold text-luxury-900">{o.t}</div>
              <div className="text-[0.72rem] text-luxury-500 mt-0.5">{o.d}</div>
            </button>
          ))}
        </div>

        {/* Autopilot picker (LIVE mode only) */}
        {saleMode === "live" && (
          <label className="text-sm block">
            <span className="text-luxury-500 font-semibold">Autopilot — how bids get accepted</span>
            <div className="mt-1 grid sm:grid-cols-3 gap-2">
              {(["hybrid", "auto", "manual"] as LiveAutopilotMode[]).map((m) => (
                <button key={m} type="button" onClick={() => setAutopilotMode(m)}
                  className="text-left rounded-lg border-2 px-2.5 py-2 transition"
                  style={{ borderColor: autopilotMode === m ? "#c9911a" : "#e5e0d5", background: autopilotMode === m ? "#fffbef" : "#fff" }}>
                  <div className="text-[0.8rem] font-bold text-luxury-900">{LIVE_AUTOPILOT_LABEL[m]}</div>
                  <div className="text-[0.68rem] text-luxury-500 mt-0.5 leading-snug">{LIVE_AUTOPILOT_DESC[m]}</div>
                </button>
              ))}
            </div>
          </label>
        )}
        <div className="grid sm:grid-cols-2 gap-3">
          <label className="text-sm">
            <span className="text-luxury-500 font-semibold">Room category</span>
            <select value={roomId} onChange={(e) => setRoomId(e.target.value)}
              className="mt-1 w-full border border-luxury-200 rounded-lg px-3 py-2 text-sm">
              <option value="">— choose —</option>
              {rooms.map((r) => <option key={r.id} value={r.id}>{r.name || r.id}</option>)}
            </select>
          </label>
          <label className="text-sm">
            <span className="text-luxury-500 font-semibold">Month</span>
            <select value={monthKey} onChange={(e) => setMonthKey(e.target.value)}
              className="mt-1 w-full border border-luxury-200 rounded-lg px-3 py-2 text-sm">
              {upcoming.map((u) => <option key={u.monthKey} value={u.monthKey}>{monthLabel(u.monthKey)}</option>)}
            </select>
          </label>
          <label className="text-sm">
            <span className="text-luxury-500 font-semibold">Number of rooms (units)</span>
            <input type="number" min={1} max={50} value={numRooms}
              onChange={(e) => setNumRooms(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
              className="mt-1 w-full border border-luxury-200 rounded-lg px-3 py-2 text-sm" />
          </label>
          <label className="text-sm">
            <span className="text-luxury-500 font-semibold">Min bid / room / night {quoting && <span className="text-luxury-400">…</span>}</span>
            <input type="number" min={effFloor || 0} value={minBid}
              onChange={(e) => setMinBid(e.target.value === "" ? "" : Number(e.target.value))}
              placeholder={effFloor ? String(effFloor) : "—"}
              className="mt-1 w-full border border-luxury-200 rounded-lg px-3 py-2 text-sm" />
            {effFloor != null ? (
              <span className="text-[0.72rem] text-luxury-400 mt-0.5 block">
                StayBid floor: <b>{inr(effFloor)}</b>/room/night — can't go below this.
                {circleOwner
                  ? ` Circle inventory: floor = your purchase (${inr(purchasePerNight)}/night) × ${circleMult} = cost + ${Math.round((circleMult - 1) * 100)}% profit.`
                  : retailFloor
                    ? (floorMode === "dynamic" && spineAdr
                        ? ` Dynamic floor = live market ADR ${inr(spineAdr)} − ${wholesaleDiscount}% (tracks demand each month; never below ${inr(ceil100(retailFloor * minFloorFraction))}). You can raise it above.`
                        : ` Wholesale floor = your retail floor ${inr(retailFloor)} − ${wholesaleDiscount}% so agents have real resale margin. You can raise it above.`)
                    : " Property owner: bulk wholesale floor (below retail) so agents have resale margin."}
              </span>
            ) : circleOwner ? (
              <span className="text-[0.72rem] text-amber-600 mt-0.5 block">Enter your monthly purchase rate below to compute the floor.</span>
            ) : null}
          </label>
        </div>

        {/* Circle owner: purchase price → floor = purchase/night × multiplier */}
        {circleOwner && (
          <label className="text-sm block">
            <span className="text-luxury-500 font-semibold">Your monthly purchase rate (₹ / room / month)</span>
            <input type="number" min={0} value={monthlyRate}
              onChange={(e) => setMonthlyRate(e.target.value === "" ? "" : Number(e.target.value))}
              placeholder="e.g. 30000"
              className="mt-1 w-full border border-luxury-200 rounded-lg px-3 py-2 text-sm" />
            <span className="text-[0.72rem] text-luxury-400 mt-0.5 block">
              This is what you paid to own the room. Per night = ÷ 30{purchasePerNight > 0 ? ` = ${inr(purchasePerNight)}` : ""}. Your floor = that × {circleMult}.
            </span>
          </label>
        )}

        {/* Property owner: wholesale discount control + live floor breakdown */}
        {!circleOwner && roomId && retailFloor != null && (
          <div className="rounded-xl border border-luxury-200 bg-luxury-50/60 p-3">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-sm font-semibold text-luxury-700">Wholesale discount</span>
              <span className="text-sm font-bold text-gold-700">{wholesaleDiscount}% off</span>
            </div>
            <input type="range" min={0} max={40} step={1} value={wholesaleDiscount}
              onChange={(e) => setWholesaleDiscount(Number(e.target.value))}
              className="w-full accent-gold-500" />
            <div className="grid grid-cols-3 gap-2 mt-2 text-center">
              <div className="rounded-lg bg-white border border-luxury-100 px-2 py-1.5">
                <div className="text-[0.56rem] font-bold text-luxury-400 tracking-wide">{floorMode === "dynamic" && spineAdr ? "MARKET ADR (LIVE)" : "RETAIL FLOOR"}</div>
                <div className="text-[0.9rem] font-extrabold text-luxury-900">{inr(floorMode === "dynamic" && spineAdr ? spineAdr : retailFloor)}</div>
              </div>
              <div className="rounded-lg bg-white border border-gold-200 px-2 py-1.5">
                <div className="text-[0.56rem] font-bold text-luxury-400 tracking-wide">YOUR FLOOR</div>
                <div className="text-[0.9rem] font-extrabold text-gold-700">{effFloor != null ? inr(effFloor) : "—"}</div>
              </div>
              <div className="rounded-lg bg-white border border-luxury-100 px-2 py-1.5">
                <div className="text-[0.56rem] font-bold text-luxury-400 tracking-wide">SAFETY ANCHOR</div>
                <div className="text-[0.9rem] font-extrabold text-luxury-900">{inr(ceil100(retailFloor * minFloorFraction))}</div>
              </div>
            </div>
            <div className="text-[0.68rem] text-luxury-400 mt-1.5">
              {floorMode === "dynamic"
                ? "Floor tracks the live market each month; a higher discount = more agent margin & faster sales. Never below the safety anchor."
                : "A higher discount = more agent margin & faster sales."} Set the min bid above to raise it further.
            </div>
          </div>
        )}

        {saleMode === "live" ? (
          monthKey && (
            <div className="text-[0.78rem] text-emerald-700 bg-emerald-50 rounded-lg px-3 py-2">
              ⚡ <b>Always open</b> — agents can bid now through <b>{monthLabel(monthKey)}</b>. <b>No deposit.</b>{" "}
              Accepted agents pay within {cfg ? "the pay window" : "24h"} from their dashboard, then get the inventory.
            </div>
          )
        ) : win ? (
          <div className="text-[0.78rem] text-luxury-500 bg-luxury-50 rounded-lg px-3 py-2">
            Bidding window: <b>{fmtDate(win.windowOpenAt)}</b> → <b>{fmtDate(win.windowCloseAt)}</b>
            {win.phase === "open" ? " · LIVE now" : ` · opens ${fmtDate(win.windowOpenAt)}`} ·
            {" "}{win.nights} nights · agent EMD deposit {cfg?.depositPct ?? 10}%
          </div>
        ) : null}

        {conflict && (
          <div className="text-[0.8rem] rounded-lg px-3 py-2 bg-blue-50 text-blue-800 border border-blue-200">
            ℹ️ This room is also listed on <b>Model 2</b> — that's fine. Both channels <b>run together</b>; availability is shared (a unit sold on one channel is automatically blocked on the other — no clash).
          </div>
        )}

        {msg && (
          <div className={`text-sm rounded-lg px-3 py-2 ${msg.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>{msg.text}</div>
        )}

        <button onClick={publish} disabled={!roomId || !monthKey || !effFloor || publishing}
          className="px-5 py-2.5 rounded-xl font-bold text-white disabled:opacity-50"
          style={{ background: "linear-gradient(135deg,#c9911a,#f0b429)" }}>
          {publishing ? "Publishing…" : "Publish auction lot"}
        </button>
      </div>

      {/* Pending LIVE bids to review (manual + hybrid-at-floor) */}
      {pending.length > 0 && (
        <div className="rounded-2xl border-2 border-amber-200 bg-amber-50/40 p-5">
          <div className="font-bold text-luxury-900 mb-1">⚡ Live bids to review</div>
          <p className="text-[0.78rem] text-luxury-500 mb-3">Agents bidding on your always-open lots. Accept to lock the sale (they pay next), decline, or counter with a different price.</p>
          <div className="space-y-2">
            {pending.map((b) => {
              const floor = Number(b.lot?.min_bid_per_room_night) || 0;
              const cv = counterVal[b.id];
              return (
                <div key={b.id} className="border border-amber-200 rounded-xl px-3 py-2.5 bg-white">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-luxury-900 truncate">
                        {b.lot?.category || b.lot?.room_id} · {monthLabel(b.lot?.month_key || "")}
                        {b.status === "countered" && <span className="ml-1 text-[0.7rem] text-purple-700 font-bold">· countered</span>}
                      </div>
                      <div className="text-[0.75rem] text-luxury-500">
                        {b.segment_label} · <b>{inr(b.per_room_per_night)}</b>/room/night × {b.rooms_wanted} rooms · floor {inr(floor)}
                        {(b.metadata?.below_floor || Number(b.per_room_per_night) < floor) && (
                          <span className="ml-1 text-[0.68rem] font-bold text-amber-700">· below floor offer</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button onClick={() => actOnBid(b.id, "accept")} disabled={bidBusy === b.id}
                        className="px-3 py-1.5 rounded-lg text-[0.75rem] font-bold text-white disabled:opacity-50" style={{ background: "linear-gradient(135deg,#059669,#10b981)" }}>Accept</button>
                      <button onClick={() => actOnBid(b.id, "reject")} disabled={bidBusy === b.id}
                        className="px-3 py-1.5 rounded-lg text-[0.75rem] font-bold text-red-600 border border-red-200 disabled:opacity-50">Decline</button>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 mt-2">
                    <input type="number" min={floor} placeholder={`Counter ≥ ${floor}`} value={cv ?? ""}
                      onChange={(e) => setCounterVal((m) => ({ ...m, [b.id]: e.target.value === "" ? "" : Number(e.target.value) }))}
                      className="w-36 border border-luxury-200 rounded-lg px-2.5 py-1.5 text-[0.8rem]" />
                    <button onClick={() => cv && Number(cv) >= floor && actOnBid(b.id, "counter", Number(cv))}
                      disabled={bidBusy === b.id || !cv || Number(cv) < floor}
                      className="px-3 py-1.5 rounded-lg text-[0.75rem] font-bold text-white disabled:opacity-40" style={{ background: "#6d28d9" }}>Counter</button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Existing lots */}
      <div className="rounded-2xl border border-luxury-200 bg-white p-5">
        <div className="font-bold text-luxury-900 mb-3">Your lots</div>
        {lots.length === 0 ? (
          <div className="text-sm text-luxury-400 py-4 text-center">No lots yet. Publish one above.</div>
        ) : (
          <div className="space-y-2">
            {lots.map((l) => {
              const st = STATUS_STYLE[l.status] || STATUS_STYLE.draft;
              return (
                <div key={l.id} className="flex items-center justify-between gap-3 border border-luxury-100 rounded-xl px-3 py-2.5">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-luxury-900 truncate">
                      {l.category || l.room_id} · {monthLabel(l.month_key)}
                    </div>
                    <div className="text-[0.75rem] text-luxury-500">
                      {l.num_rooms} rooms · min {inr(l.min_bid_per_room_night)}/night · {l.bid_count || 0} bids
                      {l.sale_mode === "live" && (
                        <> · <span className="font-semibold text-emerald-700">⚡ Live · {LIVE_AUTOPILOT_LABEL[(l.autopilot_mode as LiveAutopilotMode) || "hybrid"]}</span></>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[0.7rem] font-bold px-2 py-1 rounded-full" style={{ background: st.bg, color: st.c }}>{st.label}</span>
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
