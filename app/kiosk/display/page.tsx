"use client";
//
// StayBid Offline Kiosk — BIG DISPLAY BOARD (stock-market style)
//
// Read-only, auto-refreshing screen for a 55"–75" display at a tourist
// location. Shows ONLY tonight's live StayBid flash deals for the unit's
// city, fetched from `/api/kiosk/feed` (→ canonical flash engine → Supabase,
// wired to hotels + admin). No interaction — pure ambient advertising that
// drives walk-ins to the touchscreen kiosk beside it.
//
// Configure a unit:  /kiosk/display?loc=mussoorie-mall
//
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { formatINR, KioskDeal } from "@/lib/kiosk";

const REFRESH_MS = 30000;

function StarRow({ n }: { n: number }) {
  return <span className="k-stars">{"★".repeat(Math.max(1, Math.min(5, Math.round(n))))}</span>;
}

function DisplayInner() {
  const params = useSearchParams();
  const loc = params.get("loc") || "mussoorie-mall";
  const [deals, setDeals] = useState<KioskDeal[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [locName, setLocName] = useState("");
  const [clock, setClock] = useState("");
  const [loading, setLoading] = useState(true);
  const timer = useRef<any>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/kiosk/feed?loc=${encodeURIComponent(loc)}`, { cache: "no-store" });
      const j = await r.json();
      setDeals(Array.isArray(j?.deals) ? j.deals : []);
      setStats(j?.stats || null);
      setLocName(j?.location?.name || "");
    } catch {
      /* keep last board on transient failure */
    } finally {
      setLoading(false);
    }
  }, [loc]);

  useEffect(() => {
    load();
    timer.current = setInterval(load, REFRESH_MS);
    return () => clearInterval(timer.current);
  }, [load]);

  useEffect(() => {
    const t = setInterval(() => {
      setClock(new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
    }, 1000);
    return () => clearInterval(t);
  }, []);

  const top = deals.slice(0, 12);

  return (
    <div className="k-screen">
      {/* Header */}
      <div className="k-header">
        <div className="k-logo">Stay<span>Bid</span></div>
        <div className="k-live"><span className="k-dot" /> LIVE PRICES</div>
        <div className="k-loc">📍 {locName || "—"} · Updates every 30s</div>
        <div className="k-clock">{clock}</div>
      </div>

      {/* Ticker */}
      <div className="k-ticker">
        <div className="k-ticker-track">
          <span>🔴 FLASH DEALS — SAME DAY BOOKING ONLY</span>
          <span>✅ {stats?.hotelsOnline ?? 0} Hotels Online</span>
          {stats?.bestDealName ? <span>🏨 Best Deal: {formatINR(stats.bestDealPrice)} — {stats.bestDealName}</span> : null}
          <span>⚡ {stats?.under1000 ?? 0} Rooms Under ₹1000</span>
          <span>🛏️ {stats?.totalRoomsLeft ?? 0} Rooms Left Tonight</span>
          {/* duplicate for seamless scroll */}
          <span>🔴 FLASH DEALS — SAME DAY BOOKING ONLY</span>
          <span>✅ {stats?.hotelsOnline ?? 0} Hotels Online</span>
          <span>⚡ {stats?.under1000 ?? 0} Rooms Under ₹1000</span>
        </div>
      </div>

      {/* Board */}
      <div className="k-board">
        {loading ? (
          <div className="k-empty">Loading live prices…</div>
        ) : top.length === 0 ? (
          <div className="k-empty">No same-day deals live right now. Check back soon. ⏳</div>
        ) : (
          top.map((d) => (
            <div className="k-card" key={d.id}>
              <div className="k-card-img" style={{ backgroundImage: `url(${d.image})` }}>
                <div className="k-avail">{d.unitsFree} LEFT</div>
                {d.discount >= 10 ? <div className="k-disc">−{d.discount}%</div> : null}
              </div>
              <div className="k-card-body">
                <div className="k-name" title={d.hotelName}>{d.hotelName}</div>
                <div className="k-meta">
                  <StarRow n={d.stars} />
                  {d.area ? <span className="k-area"> · {d.area}</span> : null}
                </div>
                <div className="k-price-row">
                  <div className="k-price">{formatINR(d.aiPrice)}</div>
                  <div className={`k-change ${d.trend === "down" ? "down" : "up"}`}>
                    {d.trend === "down" ? "▼" : "▲"} {Math.abs(d.deltaPct)}%
                  </div>
                </div>
                <div className="k-sub">
                  {d.mrp > d.aiPrice ? <span className="k-strike">{formatINR(d.mrp)}</span> : null}
                  {d.distanceKm ? <span className="k-dist">{d.distanceKm} km</span> : null}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Footer */}
      <div className="k-footer">
        <div className="k-fstats">
          <span>Active Hotels: <b>{stats?.hotelsOnline ?? 0}</b></span>
          <span>Cheapest: <b>{stats?.cheapest ? formatINR(stats.cheapest) : "—"}</b></span>
          <span>Rooms Tonight: <b>{stats?.totalRoomsLeft ?? 0}</b></span>
        </div>
        <div className="k-cta">👉 TOUCH KIOSK TO BOOK NOW</div>
      </div>

      <style jsx global>{`
        html, body { margin: 0; padding: 0; background: #000; overflow: hidden; }
        .k-screen {
          position: fixed; inset: 0;
          background: radial-gradient(120% 120% at 80% 0%, #14000f 0%, #0a0a0f 55%, #050008 100%);
          color: #f0f0f8;
          font-family: 'Barlow Condensed','Rajdhani',system-ui,sans-serif;
          display: flex; flex-direction: column;
          z-index: 999999;
        }
        .k-header {
          display: flex; align-items: center; gap: 18px;
          padding: 14px 26px;
          background: linear-gradient(90deg,#0a0a0f,#120018);
          border-bottom: 2px solid #FF6B00;
        }
        .k-logo { font-family:'Rajdhani',sans-serif; font-weight:700; font-size:30px; color:#FF6B00; letter-spacing:1px; }
        .k-logo span { color:#fff; }
        .k-live { display:flex; align-items:center; gap:7px; font-family:monospace; font-size:13px; color:#00E676; letter-spacing:2px; }
        .k-dot { width:9px; height:9px; border-radius:50%; background:#00E676; animation:kblink 1.2s infinite; }
        @keyframes kblink { 0%,100%{opacity:1} 50%{opacity:.2} }
        .k-loc { margin-left:auto; font-family:monospace; font-size:13px; color:#888899; }
        .k-clock { font-family:monospace; font-size:15px; color:#FFB300; font-weight:700; min-width:90px; text-align:right; }

        .k-ticker { background:#FF6B00; color:#000; overflow:hidden; white-space:nowrap; }
        .k-ticker-track {
          display:inline-flex; gap:48px; padding:7px 0;
          font-family:monospace; font-size:14px; font-weight:700;
          animation:kmarquee 28s linear infinite;
        }
        .k-ticker-track span { display:inline-block; }
        @keyframes kmarquee { from{transform:translateX(100%)} to{transform:translateX(-100%)} }

        .k-board {
          flex:1; display:grid; grid-template-columns:repeat(4,1fr); grid-auto-rows:1fr;
          gap:14px; padding:18px 22px; overflow:hidden;
        }
        @media (max-width:1100px){ .k-board{ grid-template-columns:repeat(3,1fr);} }
        @media (max-width:760px){ .k-board{ grid-template-columns:repeat(2,1fr);} }
        .k-card {
          background:#12121a; border:1px solid rgba(255,255,255,.08);
          border-radius:8px; overflow:hidden; display:flex; flex-direction:column;
          box-shadow:0 6px 18px rgba(0,0,0,.5);
        }
        .k-card-img {
          height:42%; min-height:90px; background-size:cover; background-position:center;
          position:relative;
        }
        .k-avail {
          position:absolute; top:8px; right:8px; background:rgba(0,0,0,.78);
          border:1px solid #00E676; color:#00E676; font-family:monospace; font-size:10px;
          padding:2px 7px; letter-spacing:1px; border-radius:3px;
        }
        .k-disc {
          position:absolute; top:8px; left:8px; background:#FF1744; color:#fff;
          font-family:monospace; font-weight:700; font-size:12px; padding:3px 8px; border-radius:3px;
          transform:rotate(-4deg);
        }
        .k-card-body { padding:9px 12px 11px; flex:1; display:flex; flex-direction:column; }
        .k-name { font-family:'Rajdhani',sans-serif; font-weight:700; font-size:19px; color:#fff; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .k-meta { font-size:13px; margin:2px 0 6px; color:#888899; }
        .k-stars { color:#FFB300; letter-spacing:1px; }
        .k-area { color:#888899; }
        .k-price-row { display:flex; align-items:baseline; justify-content:space-between; margin-top:auto; }
        .k-price { font-family:monospace; font-weight:700; font-size:26px; color:#FF6B00; }
        .k-change { font-family:monospace; font-weight:700; font-size:14px; padding:2px 7px; border-radius:3px; }
        .k-change.up { background:rgba(255,23,68,.16); color:#FF5277; }
        .k-change.down { background:rgba(0,230,118,.16); color:#00E676; }
        .k-sub { display:flex; gap:10px; align-items:center; margin-top:4px; font-family:monospace; font-size:12px; }
        .k-strike { color:#666; text-decoration:line-through; }
        .k-dist { color:#888899; margin-left:auto; }
        .k-empty { grid-column:1/-1; display:flex; align-items:center; justify-content:center; font-size:24px; color:#888899; }

        .k-footer {
          display:flex; align-items:center; justify-content:space-between; gap:20px;
          padding:11px 26px; background:linear-gradient(90deg,#0a0a0f,#050010,#0a0a0f);
          border-top:1px solid rgba(255,107,0,.35);
        }
        .k-fstats { display:flex; gap:26px; font-family:monospace; font-size:14px; color:#888899; }
        .k-fstats b { color:#FFB300; }
        .k-cta {
          background:#FF6B00; color:#000; font-family:'Rajdhani',sans-serif; font-weight:700;
          font-size:18px; padding:8px 22px; letter-spacing:1px; border-radius:4px;
          animation:kpulse 2s infinite;
        }
        @keyframes kpulse { 0%,100%{opacity:1} 50%{opacity:.65} }
      `}</style>
    </div>
  );
}

export default function KioskDisplayPage() {
  return (
    <Suspense fallback={<div style={{ position: "fixed", inset: 0, background: "#000" }} />}>
      <DisplayInner />
    </Suspense>
  );
}
