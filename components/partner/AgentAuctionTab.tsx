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
  const [monthlyRate, setMonthlyRate] = useState<number | "">(""); // Circle owner's monthly purchase rate
  const [quoting, setQuoting] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const selectedRoom = useMemo(() => rooms.find((r) => r.id === roomId), [rooms, roomId]);

  // Circle owner: purchase/night = monthly rate ÷ 30; floor = purchase × multiplier.
  const purchasePerNight = circleOwner && monthlyRate !== "" ? Math.round(Number(monthlyRate) / 30) : 0;
  const effFloor: number | null = circleOwner
    ? (purchasePerNight > 0 ? Math.max(Math.ceil((purchasePerNight * circleMult) / 100) * 100, 100) : null)
    : floor;

  const loadLots = useCallback(async () => {
    try {
      const r = await fetch("/api/trade/owner/lots", { headers: { Authorization: `Bearer ${getToken()}` }, cache: "no-store" });
      const d = await r.json();
      if (r.ok) setLots(Array.isArray(d.lots) ? d.lots : []);
    } catch { /* ignore */ }
  }, []);

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
  }, [loadLots]);

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
              {(["auto", "hybrid", "manual"] as LiveAutopilotMode[]).map((m) => (
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
                  : " Property owner: floor = your room's floor price."}
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
