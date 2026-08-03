"use client";
//
// v170 — Reports & Analytics (Phase 2).
//
// Read-only analytics computed client-side from data the dashboard already
// holds (accepted bids) + front-desk reservations. Zero new tables, zero
// migration — fully bulletproof.
//
//   • KPIs: Revenue · Bookings · Room-nights · ADR · Occupancy %
//   • Revenue trend (daily / weekly buckets)
//   • Booking-source mix
//   • Top room categories by revenue
//   • CSV export
//
import { useEffect, useMemo, useState } from "react";
import { Download } from "lucide-react";

function getToken() {
  return typeof window !== "undefined" ? localStorage.getItem("sb_partner_token") || "" : "";
}
function fmtCur(n: number) { return "₹" + Math.round(n || 0).toLocaleString("en-IN"); }
function fmtK(n: number) {
  if (n >= 100000) return "₹" + (n / 100000).toFixed(1) + "L";
  if (n >= 1000) return "₹" + (n / 1000).toFixed(1) + "k";
  return "₹" + Math.round(n);
}
function nights(a?: string, b?: string) {
  if (!a || !b) return 1;
  return Math.max(1, Math.ceil((new Date(b).getTime() - new Date(a).getTime()) / 86400000));
}
const dstr = (d: Date) => d.toISOString().slice(0, 10);

type Range = "7" | "30" | "90" | "month";

const SRC: Record<string, { label: string; c: string }> = {
  direct:       { label: "Direct",     c: "#0284c7" },
  creator:      { label: "Creator",    c: "#9333ea" },
  "hotel-feed": { label: "Your reel",  c: "#8198ae" },
  flash:        { label: "Flash deal", c: "#dc2626" },
  walkin:       { label: "Walk-in",    c: "#7c2d12" },
};

export default function ReportsTab({
  bids, rooms, hotelId,
}: {
  bids: any[];
  rooms: any[];
  hotelId: string;
}) {
  const [range, setRange] = useState<Range>("30");
  const [reservations, setReservations] = useState<any[]>([]);

  useEffect(() => {
    if (!hotelId) return;
    fetch(`/api/partner/walk-in?hotelId=${encodeURIComponent(hotelId)}`, {
      headers: { Authorization: `Bearer ${getToken()}` }, cache: "no-store",
    })
      .then((r) => r.json())
      .then((d) => setReservations((d.reservations || []).filter((x: any) => x.source === "walk_in" || x.source === "group")))
      .catch(() => {});
  }, [hotelId]);

  const { from, to, days } = useMemo(() => {
    const t = new Date(); t.setHours(0, 0, 0, 0);
    let f = new Date(t);
    if (range === "month") f = new Date(t.getFullYear(), t.getMonth(), 1);
    else f.setDate(t.getDate() - (Number(range) - 1));
    const days = Math.max(1, Math.round((t.getTime() - f.getTime()) / 86400000) + 1);
    return { from: dstr(f), to: dstr(t), days };
  }, [range]);

  // Unified "stays" — accepted bids + front-desk reservations, in range.
  const stays = useMemo(() => {
    const out: any[] = [];
    bids.filter((b) => b.status === "ACCEPTED").forEach((b) => {
      out.push({
        date: String(b.checkIn || b.createdAt || "").slice(0, 10),
        rate: Number(b.counterAmount || b.amount || 0),
        n: nights(b.checkIn, b.checkOut),
        roomId: b.roomId,
        source: b.source || "direct",
      });
    });
    reservations.forEach((r) => {
      out.push({
        date: String(r.fromDate || "").slice(0, 10),
        rate: Number(r.amount || 0),
        n: nights(r.fromDate, r.toDate),
        roomId: r.roomId,
        source: "walkin",
      });
    });
    return out.filter((s) => s.date && s.date >= from && s.date <= to);
  }, [bids, reservations, from, to]);

  const m = useMemo(() => {
    const revenue   = stays.reduce((s, x) => s + x.rate * x.n, 0);
    const roomNights = stays.reduce((s, x) => s + x.n, 0);
    const bookings  = stays.length;
    const adr       = roomNights ? revenue / roomNights : 0;
    const totalUnits = rooms.reduce((s, r) => s + (Number(r.quantity) || 1), 0);
    const occupancy = totalUnits ? Math.min(100, (roomNights / (totalUnits * days)) * 100) : 0;

    // source mix
    const bySrc: Record<string, { count: number; rev: number }> = {};
    stays.forEach((x) => {
      const k = SRC[x.source] ? x.source : "direct";
      (bySrc[k] = bySrc[k] || { count: 0, rev: 0 });
      bySrc[k].count++; bySrc[k].rev += x.rate * x.n;
    });

    // top rooms
    const byRoom: Record<string, { rev: number; n: number }> = {};
    stays.forEach((x) => {
      (byRoom[x.roomId] = byRoom[x.roomId] || { rev: 0, n: 0 });
      byRoom[x.roomId].rev += x.rate * x.n; byRoom[x.roomId].n += x.n;
    });
    const topRooms = Object.entries(byRoom)
      .map(([roomId, v]) => ({ roomId, name: rooms.find((r) => r.id === roomId)?.name || rooms.find((r) => r.id === roomId)?.type || "Room", ...v }))
      .sort((a, b) => b.rev - a.rev).slice(0, 6);

    // trend — daily, or weekly buckets when the window is long
    const weekly = days > 31;
    const buckets: { label: string; rev: number; cnt: number }[] = [];
    const idx: Record<string, number> = {};
    const t0 = new Date(from);
    for (let i = 0; i < days; i++) {
      const d = new Date(t0); d.setDate(t0.getDate() + i);
      const key = dstr(d);
      if (weekly) {
        const bi = Math.floor(i / 7);
        if (!buckets[bi]) buckets[bi] = { label: `W${bi + 1}`, rev: 0, cnt: 0 };
        idx[key] = bi;
      } else {
        idx[key] = buckets.length;
        buckets.push({ label: d.toLocaleDateString("en-IN", { day: "numeric", month: "short" }), rev: 0, cnt: 0 });
      }
    }
    stays.forEach((x) => {
      const bi = idx[x.date];
      if (bi != null && buckets[bi]) { buckets[bi].rev += x.rate * x.n; buckets[bi].cnt++; }
    });

    return { revenue, roomNights, bookings, adr, occupancy, bySrc, topRooms, buckets };
  }, [stays, rooms, days, from]);

  function exportCSV() {
    const lines = [
      `StayBid — Hotel Report (${from} to ${to})`,
      "",
      `Revenue,${Math.round(m.revenue)}`,
      `Bookings,${m.bookings}`,
      `Room-nights,${m.roomNights}`,
      `ADR,${Math.round(m.adr)}`,
      `Occupancy %,${m.occupancy.toFixed(1)}`,
      "",
      "Period,Revenue,Bookings",
      ...m.buckets.map((b) => `${b.label},${Math.round(b.rev)},${b.cnt}`),
      "",
      "Room category,Revenue,Room-nights",
      ...m.topRooms.map((r) => `${r.name},${Math.round(r.rev)},${r.n}`),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `staybid-report-${from}-to-${to}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const maxBar = Math.max(1, ...m.buckets.map((b) => b.rev));
  const KPIS = [
    { label: "Revenue",     value: fmtCur(m.revenue),               text: "text-amber-700",   bg: "bg-amber-50" },
    { label: "Bookings",    value: String(m.bookings),              text: "text-teal-700",    bg: "bg-teal-50" },
    { label: "Room-nights", value: String(m.roomNights),            text: "text-blue-700",    bg: "bg-blue-50" },
    { label: "ADR",         value: fmtCur(m.adr),                   text: "text-purple-700",  bg: "bg-purple-50" },
    { label: "Occupancy",   value: m.occupancy.toFixed(0) + "%",    text: "text-emerald-700", bg: "bg-emerald-50" },
  ];

  return (
    <div className="fade-up">
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div>
          <h2 className="sec-title text-xl">Reports &amp; Analytics</h2>
          <p className="text-[0.7rem] text-luxury-500 mt-0.5">{from} → {to} · {days} days</p>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {([["7", "7 days"], ["30", "30 days"], ["90", "90 days"], ["month", "This month"]] as [Range, string][]).map(([id, lbl]) => (
            <button key={id} onClick={() => setRange(id)}
              className={`text-[0.72rem] font-bold px-2.5 py-1.5 rounded-lg border transition-all ${
                range === id ? "text-white border-transparent" : "bg-white text-luxury-500 border-luxury-200 hover:border-luxury-400"
              }`}
              style={range === id ? { background: "radial-gradient(88% 64% at 32% 4%,rgba(240,247,253,0.24),transparent 58%),linear-gradient(160deg,#a0b2c6 0%,#6f8aa6 50%,#42566d 100%)" } : undefined}>
              {lbl}
            </button>
          ))}
          <button onClick={exportCSV} className="btn-ghost inline-flex items-center gap-1.5">
            <Download size={13} strokeWidth={2.3} aria-hidden />CSV
          </button>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 mb-4">
        {KPIS.map((k) => (
          <div key={k.label} className={`card-p card-tight ${k.bg}`}>
            <p className={`text-lg font-bold ${k.text}`}>{k.value}</p>
            <p className="text-[0.62rem] text-luxury-500 font-semibold mt-0.5">{k.label}</p>
          </div>
        ))}
      </div>

      {/* Revenue trend */}
      <div className="card-p mb-4">
        <p className="text-[0.78rem] font-bold text-luxury-900 mb-3">Revenue trend</p>
        {m.buckets.every((b) => b.rev === 0) ? (
          <p className="text-xs text-luxury-400 py-6 text-center">No revenue in this period.</p>
        ) : (
          <div className="flex items-end gap-1 h-32">
            {m.buckets.map((b, i) => (
              <div key={i} className="flex-1 flex flex-col items-center justify-end group min-w-0">
                <div className="text-[0.5rem] font-bold text-luxury-500 opacity-0 group-hover:opacity-100 transition mb-0.5 whitespace-nowrap">{fmtK(b.rev)}</div>
                <div className="w-full rounded-t" style={{
                  height: `${Math.max(2, (b.rev / maxBar) * 100)}%`,
                  background: "linear-gradient(180deg,#a9b9c8,#8198ae)",
                }} />
                <div className="text-[0.46rem] text-luxury-400 mt-1 truncate w-full text-center">{b.label}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {/* Source mix */}
        <div className="card-p">
          <p className="text-[0.78rem] font-bold text-luxury-900 mb-3">Booking source</p>
          {Object.keys(m.bySrc).length === 0 ? (
            <p className="text-xs text-luxury-400 py-4 text-center">No data.</p>
          ) : (
            <div className="space-y-2">
              {Object.entries(m.bySrc).sort((a, b) => b[1].rev - a[1].rev).map(([k, v]) => {
                const meta = SRC[k] || SRC.direct;
                const pct = m.revenue ? (v.rev / m.revenue) * 100 : 0;
                return (
                  <div key={k}>
                    <div className="flex items-center justify-between text-[0.7rem] mb-0.5">
                      <span className="font-semibold text-luxury-700">{meta.label} <span className="text-luxury-400">· {v.count}</span></span>
                      <span className="font-bold text-luxury-900">{fmtCur(v.rev)}</span>
                    </div>
                    <div className="h-2 rounded-full bg-luxury-100 overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${Math.max(3, pct)}%`, background: meta.c }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Top rooms */}
        <div className="card-p">
          <p className="text-[0.78rem] font-bold text-luxury-900 mb-3">Top room categories</p>
          {m.topRooms.length === 0 ? (
            <p className="text-xs text-luxury-400 py-4 text-center">No data.</p>
          ) : (
            <div className="space-y-1.5">
              {m.topRooms.map((r, i) => (
                <div key={r.roomId} className="flex items-center gap-2.5">
                  <span className="w-5 h-5 rounded-md bg-gold-100 text-gold-700 text-[0.62rem] font-bold flex items-center justify-center shrink-0">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[0.74rem] font-semibold text-luxury-900 truncate">{r.name}</p>
                    <p className="text-[0.58rem] text-luxury-400">{r.n} room-night{r.n !== 1 ? "s" : ""}</p>
                  </div>
                  <p className="text-[0.76rem] font-bold text-luxury-900 shrink-0">{fmtCur(r.rev)}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
