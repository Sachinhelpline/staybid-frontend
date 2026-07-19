"use client";

// v361 — Model 3 (travel-agent monthly auction): OWNER SUPPLY tab.
// The property owner publishes spare inventory for an upcoming whole month as an
// auction "lot". Approved travel agents then bid on it. The min bid floor is
// StayBid-computed from the Spine (owner never sells below cost); the owner may
// raise it. Reads/writes /api/trade/owner/* (partner-scoped server-side).

import { useCallback, useEffect, useMemo, useState } from "react";

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

  const [roomId, setRoomId] = useState("");
  const [monthKey, setMonthKey] = useState("");
  const [numRooms, setNumRooms] = useState(2);
  const [minBid, setMinBid] = useState<number | "">("");
  const [floor, setFloor] = useState<number | null>(null);
  const [win, setWin] = useState<UpMonth | null>(null);
  const [conflict, setConflict] = useState(false);
  const [circleOwner, setCircleOwner] = useState(false);
  const [quoting, setQuoting] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const selectedRoom = useMemo(() => rooms.find((r) => r.id === roomId), [rooms, roomId]);

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
          setMinBid((prev) => (prev === "" || Number(prev) < d.minBidPerRoomNight ? d.minBidPerRoomNight : prev));
        } else { setMsg({ ok: false, text: d.error || "Quote failed." }); }
      } catch { /* ignore */ } finally { if (!cancelled) setQuoting(false); }
    })();
    return () => { cancelled = true; };
  }, [hotelId, roomId, monthKey]);

  const publish = async () => {
    if (!roomId || !monthKey || !floor) return;
    setPublishing(true); setMsg(null);
    try {
      const r = await fetch("/api/trade/owner/lots", {
        method: "POST", headers: { Authorization: `Bearer ${getToken()}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          hotelId, roomId, monthKey, numRooms,
          minBidPerRoomNight: minBid === "" ? floor : Number(minBid),
          category: selectedRoom?.name || null, city: city || null,
        }),
      });
      const d = await r.json();
      if (r.ok) {
        setMsg({ ok: true, text: d.phase === "open" ? "Lot is LIVE — agents can bid now." : `Lot scheduled — the window opens on ${fmtDate(d.scheduledOpensAt)}.` });
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
        <div className="text-lg font-bold" style={{ color: "#ffd98a" }}>🏷️ Sell to Travel Agents — Monthly Auction</div>
        <p className="text-sm mt-1 opacity-90">
          Auction your spare inventory to travel agents for the <b>upcoming whole month</b>. Approved agents bid per
          room — the <b>highest bid wins</b>. StayBid computes the minimum price from your cost (Spine floor); you can
          only raise it. Your inventory never sells below cost.
        </p>
      </div>

      {/* Publish form */}
      <div className="rounded-2xl border border-luxury-200 bg-white p-5 space-y-4">
        <div className="font-bold text-luxury-900">Publish a new lot</div>
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
            <input type="number" min={floor || 0} value={minBid}
              onChange={(e) => setMinBid(e.target.value === "" ? "" : Number(e.target.value))}
              placeholder={floor ? String(floor) : "—"}
              className="mt-1 w-full border border-luxury-200 rounded-lg px-3 py-2 text-sm" />
            {floor != null && (
              <span className="text-[0.72rem] text-luxury-400 mt-0.5 block">
                StayBid floor: <b>{inr(floor)}</b>/room/night — can't go below this.
                {circleOwner
                  ? " Circle-operated inventory: floor = your cost + 20% (covers your purchase + profit)."
                  : " Property-owner inventory: floor = your room's floor price."}
              </span>
            )}
          </label>
        </div>

        {win && (
          <div className="text-[0.78rem] text-luxury-500 bg-luxury-50 rounded-lg px-3 py-2">
            Bidding window: <b>{fmtDate(win.windowOpenAt)}</b> → <b>{fmtDate(win.windowCloseAt)}</b>
            {win.phase === "open" ? " · LIVE now" : ` · opens ${fmtDate(win.windowOpenAt)}`} ·
            {" "}{win.nights} nights · agent EMD deposit {cfg?.depositPct ?? 10}%
          </div>
        )}

        {conflict && (
          <div className="text-[0.8rem] rounded-lg px-3 py-2 bg-blue-50 text-blue-800 border border-blue-200">
            ℹ️ This room is also listed on <b>Model 2</b> — that's fine. Both channels <b>run together</b>; availability is shared (a unit sold on one channel is automatically blocked on the other — no clash).
          </div>
        )}

        {msg && (
          <div className={`text-sm rounded-lg px-3 py-2 ${msg.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>{msg.text}</div>
        )}

        <button onClick={publish} disabled={!roomId || !monthKey || !floor || publishing}
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
