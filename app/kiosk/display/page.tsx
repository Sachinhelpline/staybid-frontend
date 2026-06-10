"use client";
//
// StayBid Offline Kiosk — BIG DISPLAY BOARD (premium dark-walnut · cozy)
//
// Read-only, auto-refreshing ambient screen for a 55"–75" display at a tourist
// location. Stock-market style price ticker + premium hotel grid, in the
// customer frontend's cozy dark theme (walnut + champagne). Shows ONLY
// tonight's live StayBid flash deals for the unit's city, from `/api/kiosk/feed`
// (→ canonical flash engine → Supabase, wired to hotels + admin).
//
// Configure a unit:  /kiosk/display?loc=mussoorie-mall
//
import { useCallback, useEffect, useRef, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { formatINR, KioskDeal } from "@/lib/kiosk";

const REFRESH_MS = 30000;

function Stars({ n }: { n: number }) {
  return <span className="kd-stars">{"★".repeat(Math.max(1, Math.min(5, Math.round(n))))}</span>;
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

  const grid = deals.slice(0, 10);
  const ticker = deals.slice(0, 14);

  return (
    <div className="kd-screen">
      {/* Header */}
      <div className="kd-header">
        <div className="kd-brand">
          <span className="kd-mark">⛰</span>
          <span className="kd-name">Stay<b>Bid</b></span>
          <span className="kd-tagline">Live Hotel Prices</span>
        </div>
        <div className="kd-live"><span className="kd-dot" /> LIVE</div>
        <div className="kd-loc">📍 {locName || "—"}</div>
        <div className="kd-clock">{clock}</div>
      </div>

      {/* Stock-market price ticker */}
      <div className="kd-ticker">
        <div className="kd-ticker-track">
          {[...ticker, ...ticker].map((d, i) => (
            <span className="kd-tick" key={i}>
              <span className="kd-tick-name">{d.hotelName}</span>
              <span className="kd-tick-price">{formatINR(d.aiPrice)}</span>
              <span className={`kd-tick-delta ${d.trend === "down" ? "down" : "up"}`}>
                {d.trend === "down" ? "▼" : "▲"}{Math.abs(d.deltaPct)}%
              </span>
            </span>
          ))}
        </div>
      </div>

      {/* Board */}
      <div className="kd-board">
        {loading ? (
          <div className="kd-empty">Loading live prices…</div>
        ) : grid.length === 0 ? (
          <div className="kd-empty">No same-day deals live right now. Check back soon. ⏳</div>
        ) : (
          grid.map((d) => (
            <div className="kd-card" key={d.id}>
              <div className="kd-card-img" style={{ backgroundImage: `url(${d.image})` }}>
                <div className="kd-avail">{d.unitsFree} left</div>
                {d.discount >= 10 ? <div className="kd-disc">−{d.discount}%</div> : null}
              </div>
              <div className="kd-card-body">
                <div className="kd-cname" title={d.hotelName}>{d.hotelName}</div>
                <div className="kd-cmeta"><Stars n={d.stars} />{d.area ? <span> · {d.area}</span> : null}</div>
                <div className="kd-cfoot">
                  <div className="kd-cprice">
                    {d.mrp > d.aiPrice ? <span className="kd-cstrike">{formatINR(d.mrp)}</span> : null}
                    {formatINR(d.aiPrice)}
                  </div>
                  <div className={`kd-cdelta ${d.trend === "down" ? "down" : "up"}`}>{d.trend === "down" ? "▼" : "▲"} {Math.abs(d.deltaPct)}%</div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Footer */}
      <div className="kd-footer">
        <div className="kd-fstats">
          <span>Hotels Live: <b>{stats?.hotelsOnline ?? 0}</b></span>
          <span>Cheapest: <b>{stats?.cheapest ? formatINR(stats.cheapest) : "—"}</b></span>
          <span>Rooms Tonight: <b>{stats?.totalRoomsLeft ?? 0}</b></span>
          <span>Under ₹1000: <b>{stats?.under1000 ?? 0}</b></span>
        </div>
        <div className="kd-cta">👉 Book Smart. Stay Best. · Touch the kiosk</div>
      </div>

      <style jsx global>{`
        html, body { margin:0; padding:0; background:#0F0C08; overflow:hidden; }
        .kd-screen {
          position:fixed; inset:0; z-index:999999; display:flex; flex-direction:column;
          color:#F5EFE0; font-family:'Inter',system-ui,sans-serif;
          background:
            radial-gradient(1200px 620px at 80% -8%, rgba(201,166,107,.18), transparent 60%),
            radial-gradient(900px 480px at 10% 30%, rgba(217,190,130,.10), transparent 55%),
            linear-gradient(180deg,#1A1610 0%,#0F0C08 55%,#0B0906 100%);
        }
        .kd-header { display:flex; align-items:center; gap:18px; padding:16px 30px; border-bottom:1px solid rgba(217,190,130,.18); background:linear-gradient(90deg,rgba(26,22,16,.9),rgba(15,12,8,.7)); }
        .kd-brand { display:flex; align-items:center; gap:10px; }
        .kd-mark { width:38px; height:38px; display:grid; place-items:center; border-radius:11px; background:linear-gradient(135deg,#D9BE82,#C9A66B); color:#1F1A0F; font-size:20px; box-shadow:0 4px 14px rgba(201,166,107,.5); }
        .kd-name { font-family:'Cormorant Garamond',Georgia,serif; font-size:32px; font-weight:700; letter-spacing:.5px; }
        .kd-name b { color:#E3C98A; }
        .kd-tagline { font-size:12px; letter-spacing:3px; text-transform:uppercase; color:#C9A66B; margin-left:6px; }
        .kd-live { display:flex; align-items:center; gap:7px; font-size:13px; letter-spacing:2px; color:#9DB07F; font-weight:700; }
        .kd-dot { width:9px; height:9px; border-radius:50%; background:#9DB07F; box-shadow:0 0 10px #9DB07F; animation:kdblink 1.3s infinite; }
        @keyframes kdblink { 0%,100%{opacity:1} 50%{opacity:.25} }
        .kd-loc { margin-left:auto; font-size:14px; color:#D6C9AE; }
        .kd-clock { font-family:'Cormorant Garamond',serif; font-size:20px; color:#E3C98A; font-weight:700; min-width:96px; text-align:right; }

        .kd-ticker { background:linear-gradient(90deg,#231C12,#1A1610); border-bottom:1px solid rgba(217,190,130,.2); overflow:hidden; white-space:nowrap; }
        .kd-ticker-track { display:inline-flex; gap:42px; padding:9px 0; animation:kdmarquee 40s linear infinite; }
        .kd-tick { display:inline-flex; align-items:center; gap:9px; font-size:15px; }
        .kd-tick-name { color:#D6C9AE; font-weight:600; }
        .kd-tick-price { color:#E3C98A; font-weight:700; }
        .kd-tick-delta { font-weight:700; font-size:13px; }
        .kd-tick-delta.up { color:#E08A7B; }
        .kd-tick-delta.down { color:#9DB07F; }
        @keyframes kdmarquee { from{transform:translateX(0)} to{transform:translateX(-50%)} }

        .kd-board { flex:1; display:grid; grid-template-columns:repeat(5,1fr); grid-auto-rows:1fr; gap:16px; padding:20px 26px; overflow:hidden; }
        @media (max-width:1280px){ .kd-board{ grid-template-columns:repeat(4,1fr);} }
        @media (max-width:960px){ .kd-board{ grid-template-columns:repeat(3,1fr);} }
        @media (max-width:680px){ .kd-board{ grid-template-columns:repeat(2,1fr);} }
        .kd-card { background:rgba(36,30,20,.7); border:1px solid rgba(217,190,130,.14); border-radius:16px; overflow:hidden; display:flex; flex-direction:column; box-shadow:0 8px 26px rgba(0,0,0,.45); }
        .kd-card-img { height:46%; min-height:96px; background-size:cover; background-position:center; position:relative; }
        .kd-avail { position:absolute; top:9px; right:9px; background:rgba(11,9,6,.78); border:1px solid rgba(157,176,127,.6); color:#A9BE88; font-size:11px; padding:2px 9px; border-radius:999px; }
        .kd-disc { position:absolute; top:9px; left:9px; background:linear-gradient(135deg,#E0A07B,#C24E4E); color:#fff; font-weight:700; font-size:13px; padding:3px 10px; border-radius:999px; box-shadow:0 4px 10px rgba(194,78,78,.45); }
        .kd-card-body { padding:11px 14px 13px; flex:1; display:flex; flex-direction:column; }
        .kd-cname { font-family:'Cormorant Garamond',serif; font-weight:700; font-size:21px; color:#F5EFE0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .kd-cmeta { font-size:13px; color:#B9AC90; margin:2px 0 8px; }
        .kd-stars { color:#E3C98A; letter-spacing:1px; }
        .kd-cfoot { display:flex; align-items:flex-end; justify-content:space-between; margin-top:auto; }
        .kd-cprice { font-family:'Cormorant Garamond',serif; font-weight:700; font-size:26px; color:#E3C98A; }
        .kd-cstrike { display:block; font-size:13px; color:#8A7C60; text-decoration:line-through; font-family:'Inter',sans-serif; font-weight:400; }
        .kd-cdelta { font-size:13px; font-weight:700; padding:2px 8px; border-radius:999px; }
        .kd-cdelta.up { background:rgba(224,138,123,.16); color:#E8A293; }
        .kd-cdelta.down { background:rgba(157,176,127,.16); color:#A9BE88; }
        .kd-empty { grid-column:1/-1; display:flex; align-items:center; justify-content:center; font-size:24px; color:#B9AC90; }

        .kd-footer { display:flex; align-items:center; justify-content:space-between; gap:20px; padding:13px 30px; border-top:1px solid rgba(217,190,130,.2); background:linear-gradient(90deg,#1A1610,#0F0C08,#1A1610); }
        .kd-fstats { display:flex; gap:28px; font-size:14px; color:#B9AC90; }
        .kd-fstats b { color:#E3C98A; }
        .kd-cta { font-family:'Cormorant Garamond',serif; font-style:italic; font-size:18px; color:#1F1A0F; background:linear-gradient(135deg,#E3C98A,#C9A66B); padding:8px 22px; border-radius:999px; font-weight:700; box-shadow:0 4px 14px rgba(201,166,107,.4); animation:kdpulse 2.4s infinite; }
        @keyframes kdpulse { 0%,100%{opacity:1} 50%{opacity:.7} }
      `}</style>
    </div>
  );
}

export default function KioskDisplayPage() {
  return (
    <Suspense fallback={<div style={{ position: "fixed", inset: 0, background: "#0F0C08" }} />}>
      <DisplayInner />
    </Suspense>
  );
}
