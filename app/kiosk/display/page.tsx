"use client";
//
// StayBid Offline Kiosk — BIG DISPLAY BOARD (ad-style rotating showcase)
//
// Cinematic, auto-rotating ONE-hotel-at-a-time ad board for a 43"–75" display
// (or any screen) at a tourist location. Each slide shows a single live
// same-day flash deal with a QR code so anyone can scan + book on their own
// phone. Premium cozy dark-walnut theme. Fully device-native — vmin-based
// scaling adapts to ANY aspect ratio (portrait/landscape, phone → 75") with
// no overflow, no cut, no shrink. Data from `/api/kiosk/feed` (→ canonical
// flash engine → Supabase, wired to hotels + admin).
//
// Configure a unit:  /kiosk/display?loc=mussoorie-mall
//
import { useCallback, useEffect, useMemo, useRef, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { formatINR, KioskDeal } from "@/lib/kiosk";

const REFRESH_MS = 60000;   // re-pull deals every minute
const SLIDE_MS = 8000;      // each hotel ad shows for 8s

function Stars({ n }: { n: number }) {
  return <span className="kd-stars">{"★".repeat(Math.max(1, Math.min(5, Math.round(n))))}</span>;
}

function bookOrigin() {
  if (typeof window !== "undefined" && window.location?.origin) return window.location.origin;
  return "https://www.staybids.in";
}

// Customer-facing flash deal deep link — opens the real hotel page in
// directBook mode so a guest can finish on their own phone.
function dealUrl(d: KioskDeal) {
  const base = bookOrigin();
  const q = new URLSearchParams({
    dealId: String(d.id),
    dealPrice: String(Math.round(d.aiPrice)),
    roomId: String(d.roomId),
    discount: String(d.discount),
    directBook: "true",
    src: "kiosk",
  });
  return `${base}/hotels/${encodeURIComponent(d.hotelId)}?${q.toString()}`;
}

function DisplayInner() {
  const params = useSearchParams();
  const loc = params.get("loc") || "mussoorie-mall";
  const [deals, setDeals] = useState<KioskDeal[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [locName, setLocName] = useState("");
  const [clock, setClock] = useState("");
  const [loading, setLoading] = useState(true);
  const [idx, setIdx] = useState(0);
  const dataTimer = useRef<any>(null);
  const slideTimer = useRef<any>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/kiosk/feed?loc=${encodeURIComponent(loc)}`, { cache: "no-store" });
      const j = await r.json();
      const list = Array.isArray(j?.deals) ? j.deals : [];
      setDeals(list);
      setStats(j?.stats || null);
      setLocName(j?.location?.name || "");
      setIdx((i) => (list.length ? i % list.length : 0));
    } catch {
      /* keep last board on transient failure */
    } finally {
      setLoading(false);
    }
  }, [loc]);

  useEffect(() => {
    load();
    dataTimer.current = setInterval(load, REFRESH_MS);
    return () => clearInterval(dataTimer.current);
  }, [load]);

  // Auto-advance the ad rotation.
  useEffect(() => {
    if (deals.length <= 1) return;
    slideTimer.current = setInterval(() => setIdx((i) => (i + 1) % deals.length), SLIDE_MS);
    return () => clearInterval(slideTimer.current);
  }, [deals.length]);

  useEffect(() => {
    const t = setInterval(() => {
      setClock(new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }));
    }, 1000);
    return () => clearInterval(t);
  }, []);

  const ticker = deals.slice(0, 14);
  const current = deals[idx] || null;
  const qrSrc = useMemo(() => {
    if (!current) return "";
    const data = dealUrl(current);
    return `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(data)}&size=320x320&margin=1&format=svg`;
  }, [current]);

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

      {/* Rotating single-hotel ad stage */}
      <div className="kd-stage">
        {loading ? (
          <div className="kd-empty">Loading live deals…</div>
        ) : !current ? (
          <div className="kd-empty">No same-day deals live right now. Check back soon. ⏳</div>
        ) : (
          <>
            {/* Hero */}
            <div className="kd-hero">
              <img key={current.id} src={current.image} alt={current.hotelName} className="kd-hero-img"
                onError={(e) => { (e.target as HTMLImageElement).style.opacity = "0"; }} />
              <div className="kd-hero-shade" />
              {current.discount >= 8 ? <div className="kd-hero-disc">⚡ −{current.discount}%</div> : null}
              <div className="kd-hero-units">{current.unitsFree} room{current.unitsFree !== 1 ? "s" : ""} left tonight</div>
              <div className="kd-hero-cap">
                <div className="kd-hero-name">{current.hotelName}</div>
                <div className="kd-hero-meta">
                  <Stars n={current.stars} />
                  {current.avgRating > 0 ? <span className="kd-hero-rating">★ {current.avgRating.toFixed(1)}</span> : null}
                  {current.area ? <span> · {current.area}</span> : null}
                  {current.distanceKm ? <span> · {current.distanceKm} km</span> : null}
                </div>
              </div>
            </div>

            {/* Info + QR */}
            <div className="kd-info">
              <div className="kd-info-room">{current.roomType} · sleeps {current.capacity}</div>
              <div className="kd-price-block">
                {current.mrp > current.aiPrice ? <div className="kd-mrp">{formatINR(current.mrp)}</div> : null}
                <div className="kd-price">{formatINR(current.aiPrice)}<span>/night</span></div>
                {current.mrp > current.aiPrice ? (
                  <div className="kd-delta down">💰 Save {formatINR(current.mrp - current.aiPrice)}</div>
                ) : current.deltaPct > 0 ? (
                  <div className="kd-delta down">⚡ {current.deltaPct}% off</div>
                ) : null}
              </div>

              {current.amenities.length > 0 && (
                <div className="kd-amen">
                  {current.amenities.slice(0, 5).map((a, i) => <span key={i} className="kd-amen-chip">{a}</span>)}
                </div>
              )}

              <div className="kd-qr">
                {qrSrc ? <img src={qrSrc} alt="Scan to book" className="kd-qr-img" /> : null}
                <div className="kd-qr-txt">
                  <div className="kd-qr-h">📱 Scan to book on your phone</div>
                  <div className="kd-qr-s">Or touch the kiosk beside the screen</div>
                </div>
              </div>

              {/* Up next filmstrip */}
              {deals.length > 1 && (
                <div className="kd-dots">
                  {deals.slice(0, Math.min(deals.length, 12)).map((_, i) => (
                    <span key={i} className={`kd-dot2 ${i === idx ? "on" : ""}`} />
                  ))}
                  <span className="kd-counter">{idx + 1} / {deals.length}</span>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Footer */}
      <div className="kd-footer">
        <div className="kd-fstats">
          <span>Hotels Live <b>{stats?.hotelsOnline ?? 0}</b></span>
          <span>Cheapest <b>{stats?.cheapest ? formatINR(stats.cheapest) : "—"}</b></span>
          <span>Rooms <b>{stats?.totalRoomsLeft ?? 0}</b></span>
          <span>Under ₹1000 <b>{stats?.under1000 ?? 0}</b></span>
        </div>
        <a className="kd-cta" href={`/kiosk/book?loc=${encodeURIComponent(loc)}`}>
          👉 Book Smart · Stay Best
        </a>
      </div>

      <style jsx global>{`
        html, body { margin:0; padding:0; background:#0F0C08; overflow:hidden; }
        * { box-sizing:border-box; }
        .kd-screen {
          position:fixed; inset:0; z-index:999999; display:flex; flex-direction:column;
          height:100dvh; width:100vw;
          color:#F5EFE0; font-family:'Inter',system-ui,sans-serif;
          background:
            radial-gradient(120vmin 70vmin at 80% -8%, rgba(201,166,107,.18), transparent 60%),
            radial-gradient(90vmin 50vmin at 10% 30%, rgba(217,190,130,.10), transparent 55%),
            linear-gradient(180deg,#1A1610 0%,#0F0C08 55%,#0B0906 100%);
          overflow:hidden;
        }
        /* HEADER — vmin scaled */
        .kd-header { display:flex; align-items:center; gap:2vmin; padding:1.6vmin 3vmin; border-bottom:1px solid rgba(217,190,130,.18); background:linear-gradient(90deg,rgba(26,22,16,.9),rgba(15,12,8,.6)); flex:0 0 auto; }
        .kd-brand { display:flex; align-items:center; gap:1.2vmin; min-width:0; }
        .kd-mark { width:clamp(28px,4.4vmin,56px); height:clamp(28px,4.4vmin,56px); display:grid; place-items:center; border-radius:1.3vmin; background:linear-gradient(135deg,#D9BE82,#C9A66B); color:#1F1A0F; font-size:clamp(15px,2.4vmin,28px); box-shadow:0 0.5vmin 1.6vmin rgba(201,166,107,.5); flex:0 0 auto; }
        .kd-name { font-family:'Cormorant Garamond',Georgia,serif; font-size:clamp(22px,4vmin,46px); font-weight:700; letter-spacing:.3px; white-space:nowrap; }
        .kd-name b { color:#E3C98A; }
        .kd-tagline { font-size:clamp(9px,1.5vmin,15px); letter-spacing:.35vmin; text-transform:uppercase; color:#C9A66B; white-space:nowrap; }
        .kd-live { display:flex; align-items:center; gap:.8vmin; font-size:clamp(10px,1.7vmin,16px); letter-spacing:.2vmin; color:#9DB07F; font-weight:700; }
        .kd-dot { width:1.1vmin; height:1.1vmin; min-width:7px; min-height:7px; border-radius:50%; background:#9DB07F; box-shadow:0 0 1.4vmin #9DB07F; animation:kdblink 1.3s infinite; }
        @keyframes kdblink { 0%,100%{opacity:1} 50%{opacity:.25} }
        .kd-loc { margin-left:auto; font-size:clamp(11px,1.8vmin,18px); color:#D6C9AE; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:34vw; }
        .kd-clock { font-family:'Cormorant Garamond',serif; font-size:clamp(15px,2.6vmin,26px); color:#E3C98A; font-weight:700; }

        /* TICKER */
        .kd-ticker { flex:0 0 auto; background:linear-gradient(90deg,#231C12,#1A1610); border-bottom:1px solid rgba(217,190,130,.2); overflow:hidden; white-space:nowrap; }
        .kd-ticker-track { display:inline-flex; gap:4.5vmin; padding:1vmin 0; animation:kdmarquee 42s linear infinite; }
        .kd-tick { display:inline-flex; align-items:center; gap:1vmin; font-size:clamp(11px,1.9vmin,19px); }
        .kd-tick-name { color:#D6C9AE; font-weight:600; }
        .kd-tick-price { color:#E3C98A; font-weight:700; }
        .kd-tick-delta { font-weight:700; font-size:.85em; }
        .kd-tick-delta.up { color:#E08A7B; }
        .kd-tick-delta.down { color:#9DB07F; }
        @keyframes kdmarquee { from{transform:translateX(0)} to{transform:translateX(-50%)} }

        /* STAGE — adapts to aspect ratio */
        .kd-stage { flex:1 1 auto; min-height:0; display:flex; gap:2.4vmin; padding:2.4vmin 3vmin; overflow:hidden; }
        @media (orientation:portrait) { .kd-stage { flex-direction:column; } }
        .kd-empty { flex:1; display:flex; align-items:center; justify-content:center; font-size:clamp(16px,3vmin,30px); color:#B9AC90; text-align:center; }

        .kd-hero { position:relative; flex:1.5 1 0; min-height:0; min-width:0; border-radius:2.2vmin; overflow:hidden; box-shadow:0 1.6vmin 4vmin rgba(0,0,0,.5); }
        .kd-hero-img { width:100%; height:100%; object-fit:cover; animation:kdken 16s ease-in-out infinite alternate; }
        @keyframes kdken { from{transform:scale(1) translate(0,0)} to{transform:scale(1.08) translate(-1%,-1%)} }
        .kd-hero-shade { position:absolute; inset:0; background:linear-gradient(180deg,rgba(0,0,0,.05) 30%,rgba(11,9,6,.85) 100%); }
        .kd-hero-disc { position:absolute; top:2vmin; left:2vmin; background:linear-gradient(135deg,#E0A07B,#C24E4E); color:#fff; font-weight:800; font-size:clamp(13px,2.4vmin,26px); padding:.7vmin 1.6vmin; border-radius:99px; box-shadow:0 .6vmin 1.6vmin rgba(194,78,78,.5); }
        .kd-hero-units { position:absolute; top:2vmin; right:2vmin; background:rgba(11,9,6,.7); border:1px solid rgba(157,176,127,.6); color:#A9BE88; font-size:clamp(10px,1.7vmin,18px); padding:.6vmin 1.4vmin; border-radius:99px; }
        .kd-hero-cap { position:absolute; left:2.4vmin; right:2.4vmin; bottom:2.2vmin; }
        .kd-hero-name { font-family:'Cormorant Garamond',serif; font-weight:700; font-size:clamp(26px,6vmin,76px); line-height:1.02; color:#FFFDF7; text-shadow:0 .4vmin 2vmin rgba(0,0,0,.6); }
        .kd-hero-meta { display:flex; flex-wrap:wrap; align-items:center; gap:1.2vmin; margin-top:.8vmin; font-size:clamp(12px,2.1vmin,22px); color:#E8DDC4; }
        .kd-stars { color:#E3C98A; letter-spacing:1px; }
        .kd-hero-rating { background:rgba(227,201,138,.2); color:#F0DDAE; font-weight:700; padding:.2vmin 1.2vmin; border-radius:99px; }

        .kd-info { flex:1 1 0; min-width:0; min-height:0; display:flex; flex-direction:column; justify-content:center; gap:2vmin; }
        @media (orientation:portrait) { .kd-info { flex:0 0 auto; gap:1.6vmin; } }
        .kd-info-room { font-size:clamp(12px,2.1vmin,22px); color:#B9AC90; }
        .kd-price-block { display:flex; align-items:baseline; flex-wrap:wrap; gap:1.4vmin; }
        .kd-mrp { font-size:clamp(13px,2.2vmin,24px); color:#8A7C60; text-decoration:line-through; }
        .kd-price { font-family:'Cormorant Garamond',serif; font-weight:700; font-size:clamp(34px,8vmin,96px); line-height:.95; color:#E3C98A; }
        .kd-price span { font-size:.32em; color:#B9AC90; font-family:'Inter',sans-serif; }
        .kd-delta { font-size:clamp(11px,1.9vmin,20px); font-weight:700; padding:.4vmin 1.4vmin; border-radius:99px; }
        .kd-delta.up { background:rgba(224,138,123,.16); color:#E8A293; }
        .kd-delta.down { background:rgba(157,176,127,.16); color:#A9BE88; }
        .kd-amen { display:flex; flex-wrap:wrap; gap:1vmin; }
        .kd-amen-chip { background:rgba(36,30,20,.7); border:1px solid rgba(217,190,130,.18); color:#D6C9AE; font-size:clamp(10px,1.6vmin,17px); padding:.5vmin 1.4vmin; border-radius:99px; }

        .kd-qr { display:flex; align-items:center; gap:2vmin; background:#FFFCF6; border-radius:2vmin; padding:1.8vmin; box-shadow:0 1vmin 3vmin rgba(0,0,0,.4); align-self:flex-start; max-width:100%; }
        .kd-qr-img { width:clamp(96px,16vmin,200px); height:clamp(96px,16vmin,200px); display:block; }
        .kd-qr-h { font-family:'Cormorant Garamond',serif; font-weight:700; color:#1F1A0F; font-size:clamp(16px,2.6vmin,28px); line-height:1.1; }
        .kd-qr-s { color:#6E5430; font-size:clamp(11px,1.7vmin,18px); margin-top:.6vmin; }

        .kd-dots { display:flex; align-items:center; flex-wrap:wrap; gap:1vmin; margin-top:.6vmin; }
        .kd-dot2 { width:1.4vmin; height:1.4vmin; min-width:8px; min-height:8px; border-radius:99px; background:rgba(217,190,130,.28); transition:all .3s; }
        .kd-dot2.on { background:#E3C98A; width:4vmin; min-width:22px; }
        .kd-counter { margin-left:1vmin; font-size:clamp(10px,1.6vmin,16px); color:#9C8E72; }

        /* FOOTER */
        .kd-footer { flex:0 0 auto; display:flex; align-items:center; justify-content:space-between; gap:2vmin; flex-wrap:wrap; padding:1.4vmin 3vmin; border-top:1px solid rgba(217,190,130,.2); background:linear-gradient(90deg,#1A1610,#0F0C08,#1A1610); }
        .kd-fstats { display:flex; gap:3vmin; flex-wrap:wrap; font-size:clamp(11px,1.8vmin,18px); color:#B9AC90; }
        .kd-fstats b { color:#E3C98A; margin-left:.4vmin; }
        .kd-cta { text-decoration:none; font-family:'Cormorant Garamond',serif; font-style:italic; font-size:clamp(14px,2.4vmin,26px); color:#1F1A0F; background:linear-gradient(135deg,#E3C98A,#C9A66B); padding:1vmin 2.6vmin; border-radius:99px; font-weight:700; box-shadow:0 .6vmin 2vmin rgba(201,166,107,.45); white-space:nowrap; animation:kdpulse 2.6s infinite; }
        .kd-cta:active { transform:scale(.97); }
        @keyframes kdpulse { 0%,100%{box-shadow:0 .6vmin 2vmin rgba(201,166,107,.45)} 50%{box-shadow:0 .6vmin 3.4vmin rgba(227,201,138,.75)} }

        /* very small / narrow screens — trim secondary chrome */
        @media (max-width:520px) { .kd-tagline,.kd-loc{ display:none; } }

        /* ── MOBILE / SMALL PHONES — explicit vw-based sizing so nothing
           ever over-sizes, cuts, or shrinks. On phones the stage stacks
           (portrait), hero shrinks, fonts read from vw not vmin. ───────── */
        @media (max-width:640px) {
          .kd-header { gap:2.5vw; padding:2.5vw 3.5vw; }
          .kd-name { font-size:6.2vw; }
          .kd-clock { font-size:5vw; }
          .kd-live { font-size:3vw; }
          .kd-ticker-track { gap:6vw; padding:2vw 0; animation-duration:30s; }
          .kd-tick { font-size:3.4vw; gap:2vw; }
          /* hero capped so the price + QR + footer always sit above the fold;
             stage packs from the TOP (not centered) + can scroll as a safety */
          .kd-stage { gap:3vw; padding:3vw 4vw; overflow-y:auto; }
          .kd-hero { flex:0 0 30vh; min-height:30vh; }
          .kd-hero-name { font-size:7vw; }
          .kd-hero-meta { font-size:3.4vw; gap:2.5vw; }
          .kd-hero-disc { font-size:3.6vw; padding:1.4vw 3vw; top:3vw; left:3vw; }
          .kd-hero-units { font-size:2.8vw; padding:1.2vw 2.6vw; top:3vw; right:3vw; }
          .kd-info { gap:2.4vw; justify-content:flex-start; }
          /* secondary rows hidden on phones so the QR never clips behind footer */
          .kd-info-room, .kd-amen, .kd-dots { display:none; }
          .kd-price { font-size:12vw; }
          .kd-mrp { font-size:4vw; }
          .kd-delta { font-size:3.4vw; padding:1vw 3vw; }
          .kd-qr { gap:3.5vw; padding:3vw; }
          .kd-qr-img { width:24vw; height:24vw; }
          .kd-qr-h { font-size:4.2vw; }
          .kd-qr-s { font-size:2.8vw; }
          .kd-footer { gap:2.5vw; padding:2.5vw 4vw; }
          .kd-fstats { gap:4vw; font-size:3.2vw; }
          .kd-cta { font-size:4vw; padding:2vw 5vw; }
        }
        /* very narrow phones (iPhone SE etc.) — drop the live ticker entirely
           so the hero + QR always fit above the fold */
        @media (max-width:380px) {
          .kd-ticker { display:none; }
          .kd-hero { flex:0 0 28vh; min-height:28vh; }
          .kd-price { font-size:11vw; }
          .kd-qr-img { width:22vw; height:22vw; }
        }
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
