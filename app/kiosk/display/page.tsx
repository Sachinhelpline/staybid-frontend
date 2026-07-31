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

// ─────────────────────────────────────────────────────────────────────────
// Hotel performance scorecard — KIOSK-NATIVE (no customer-panel import).
// Fetches the SAME `/api/hotels/[id]/scorecard` the customer site uses, but
// renders a self-themed, vmin-scaled, tappable chip so the kiosk stays a
// self-contained leaf module. Per-hotel in-memory cache keeps the rotating
// board from re-fetching the same hotel every loop.
// ─────────────────────────────────────────────────────────────────────────
type ScoreData = {
  overall: number;
  rank: number | null;
  total: number | null;
  emoji: string;
  label: string;
  city: string;
  checkpoints: { label: string; emoji: string; earned: number; weight: number; pct: number; status: string }[];
  bookings: number;
  feedback: number;
};

const SCORE_CACHE = new Map<string, ScoreData | null>();

function useHotelScore(hotelId: string | undefined) {
  const [data, setData] = useState<ScoreData | null>(() => (hotelId ? SCORE_CACHE.get(hotelId) ?? null : null));
  useEffect(() => {
    if (!hotelId) { setData(null); return; }
    if (SCORE_CACHE.has(hotelId)) { setData(SCORE_CACHE.get(hotelId) || null); return; }
    let alive = true;
    setData(null);
    fetch(`/api/hotels/${encodeURIComponent(hotelId)}/scorecard`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!alive) return;
        const overall = j?.overall;
        if (overall == null) { SCORE_CACHE.set(hotelId, null); setData(null); return; }
        const sd: ScoreData = {
          overall: Math.round(Number(overall)),
          rank: j.rank_in_city ?? j.rank?.rank ?? null,
          total: j.total_in_city ?? j.rank?.total ?? null,
          emoji: j.badge_emoji || j.badge?.emoji || "⭐",
          label: j.badge_label || j.badge?.label || "Rated",
          city: j.city || "",
          checkpoints: Array.isArray(j.checkpoints) ? j.checkpoints : [],
          bookings: Number(j.total_bookings) || 0,
          feedback: Number(j.total_stay_feedback) || 0,
        };
        SCORE_CACHE.set(hotelId, sd);
        setData(sd);
      })
      .catch(() => { if (alive) setData(null); });
    return () => { alive = false; };
  }, [hotelId]);
  return data;
}

function KdScorecard({ hotelId, expanded, onToggle }: { hotelId: string; expanded: boolean; onToggle: () => void }) {
  const score = useHotelScore(hotelId);
  if (!score) return null;
  const rankTxt =
    score.rank && score.total
      ? `Rank #${score.rank} of ${score.total}${score.city ? " · " + score.city : ""}`
      : score.city ? `Top stay in ${score.city}` : "Verified performance";
  const top = score.checkpoints
    .filter((c) => c.earned > 0)
    .sort((a, b) => (b.pct || 0) - (a.pct || 0))
    .slice(0, 4);
  return (
    <button type="button" className={`kd-score ${expanded ? "open" : ""}`} onClick={onToggle} aria-expanded={expanded}>
      <div className="kd-score-head">
        <span className="kd-score-medal">{score.emoji}</span>
        <div className="kd-score-main">
          <div className="kd-score-num"><b>{score.overall}</b><span>/100</span> <em>StayBid Score</em></div>
          <div className="kd-score-rank">{score.label} · {rankTxt}</div>
        </div>
        <span className="kd-score-caret">{expanded ? "Hide ▴" : "Details ▾"}</span>
      </div>
      {expanded && top.length > 0 && (
        <div className="kd-score-detail">
          {top.map((c, i) => (
            <div className="kd-score-row" key={i}>
              <span className="kd-score-emoji">{c.emoji}</span>
              <span className="kd-score-label">{c.label}</span>
              <span className="kd-score-bar"><i style={{ width: `${Math.max(6, Math.round(c.pct || 0))}%` }} /></span>
            </div>
          ))}
          <div className="kd-score-foot">
            Verified from {score.bookings || "real"} bookings{score.feedback ? ` · ${score.feedback} guest reviews` : ""}
          </div>
        </div>
      )}
    </button>
  );
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
  const [scoreOpen, setScoreOpen] = useState(false);
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

  // Collapse the scorecard detail whenever the slide changes.
  useEffect(() => { setScoreOpen(false); }, [idx]);

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
              <div className="kd-hero-units"><span className="kd-units-dot" />{current.unitsFree} room{current.unitsFree !== 1 ? "s" : ""} left tonight</div>
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
              <div className="kd-info-top">
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

                {/* Active, tappable hotel scorecard */}
                <KdScorecard hotelId={current.hotelId} expanded={scoreOpen} onToggle={() => setScoreOpen((v) => !v)} />

                {current.amenities.length > 0 && (
                  <div className="kd-amen">
                    {current.amenities.slice(0, 5).map((a, i) => <span key={i} className="kd-amen-chip">{a}</span>)}
                  </div>
                )}
              </div>

              {/* Scan-to-book block — the QR + a clear animated call to action */}
              <div className="kd-book">
                <div className="kd-qr">
                  <div className="kd-qr-imgwrap">
                    {qrSrc ? <img src={qrSrc} alt="Scan to book" className="kd-qr-img" /> : null}
                    <span className="kd-qr-scan" aria-hidden />
                  </div>
                  <div className="kd-qr-txt">
                    <div className="kd-qr-h">📱 Scan to book on your phone</div>
                    <div className="kd-qr-s">Instant confirmation · pay later option</div>
                  </div>
                </div>
                <div className="kd-scan-band">
                  <span className="kd-scan-arrow">👆</span>
                  <span className="kd-scan-txt">Point your camera here — book in <b>30 seconds</b>, no app needed</span>
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
          <span className="kd-cta-glow" aria-hidden />
          <span className="kd-cta-txt">📲 Scan the code · or tap here to book →</span>
        </a>
      </div>

      <style jsx global>{`
        html, body { margin:0; padding:0; background:#0F0C08; overflow:hidden; }
        * { box-sizing:border-box; }
        .kd-screen {
          position:fixed; inset:0; z-index:999999; display:flex; flex-direction:column;
          height:100dvh; width:100vw;
          color:#ecf0f3; font-family:'Inter',system-ui,sans-serif;
          background:
            radial-gradient(120vmin 70vmin at 80% -8%, rgba(106,133,160,.18), transparent 60%),
            radial-gradient(90vmin 50vmin at 10% 30%, rgba(176, 192, 209,.10), transparent 55%),
            linear-gradient(180deg,#1A1610 0%,#0F0C08 55%,#0B0906 100%);
          overflow:hidden;
        }
        /* HEADER — vmin scaled */
        .kd-header { display:flex; align-items:center; gap:2vmin; padding:1.6vmin 3vmin; border-bottom:1px solid rgba(176, 192, 209,.18); background:linear-gradient(90deg,rgba(26,22,16,.9),rgba(15,12,8,.6)); flex:0 0 auto; }
        .kd-brand { display:flex; align-items:center; gap:1.2vmin; min-width:0; }
        .kd-mark { width:clamp(28px,4.4vmin,56px); height:clamp(28px,4.4vmin,56px); display:grid; place-items:center; border-radius:1.3vmin; background:linear-gradient(135deg,#b4c1cf,#5f7c98); color:#1F1A0F; font-size:clamp(15px,2.4vmin,28px); box-shadow:0 0.5vmin 1.6vmin rgba(106,133,160,.5); flex:0 0 auto; }
        .kd-name { font-family:'Cormorant Garamond',Georgia,serif; font-size:clamp(22px,4vmin,46px); font-weight:700; letter-spacing:.3px; white-space:nowrap; }
        .kd-name b { color:#c0ccd7; }
        .kd-tagline { font-size:clamp(9px,1.5vmin,15px); letter-spacing:.35vmin; text-transform:uppercase; color:#5f7c98; white-space:nowrap; }
        .kd-live { display:flex; align-items:center; gap:.8vmin; font-size:clamp(10px,1.7vmin,16px); letter-spacing:.2vmin; color:#9DB07F; font-weight:700; }
        .kd-dot { width:1.1vmin; height:1.1vmin; min-width:7px; min-height:7px; border-radius:50%; background:#9DB07F; box-shadow:0 0 1.4vmin #9DB07F; animation:kdblink 1.3s infinite; }
        @keyframes kdblink { 0%,100%{opacity:1} 50%{opacity:.25} }
        .kd-loc { margin-left:auto; font-size:clamp(11px,1.8vmin,18px); color:#c0cbd7; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:34vw; }
        .kd-clock { font-family:'Cormorant Garamond',serif; font-size:clamp(15px,2.6vmin,26px); color:#c0ccd7; font-weight:700; }

        /* TICKER */
        .kd-ticker { flex:0 0 auto; background:linear-gradient(90deg,#231C12,#1A1610); border-bottom:1px solid rgba(176, 192, 209,.2); overflow:hidden; white-space:nowrap; }
        .kd-ticker-track { display:inline-flex; gap:4.5vmin; padding:1vmin 0; animation:kdmarquee 42s linear infinite; }
        .kd-tick { display:inline-flex; align-items:center; gap:1vmin; font-size:clamp(11px,1.9vmin,19px); }
        .kd-tick-name { color:#c0cbd7; font-weight:600; }
        .kd-tick-price { color:#c0ccd7; font-weight:700; }
        .kd-tick-delta { font-weight:700; font-size:.85em; }
        .kd-tick-delta.up { color:#E08A7B; }
        .kd-tick-delta.down { color:#9DB07F; }
        @keyframes kdmarquee { from{transform:translateX(0)} to{transform:translateX(-50%)} }

        /* STAGE — adapts to aspect ratio */
        .kd-stage { flex:1 1 auto; min-height:0; display:flex; gap:2.4vmin; padding:2.4vmin 3vmin; overflow:hidden; }
        @media (orientation:portrait) { .kd-stage { flex-direction:column; } }
        .kd-empty { flex:1; display:flex; align-items:center; justify-content:center; font-size:clamp(16px,3vmin,30px); color:#9eafc1; text-align:center; }

        .kd-hero { position:relative; flex:1.5 1 0; min-height:0; min-width:0; border-radius:2.2vmin; overflow:hidden; box-shadow:0 1.6vmin 4vmin rgba(0,0,0,.5); }
        .kd-hero-img { width:100%; height:100%; object-fit:cover; animation:kdken 16s ease-in-out infinite alternate; }
        @keyframes kdken { from{transform:scale(1) translate(0,0)} to{transform:scale(1.08) translate(-1%,-1%)} }
        .kd-hero-shade { position:absolute; inset:0; background:linear-gradient(180deg,rgba(0,0,0,.05) 30%,rgba(11,9,6,.85) 100%); }
        .kd-hero-disc { position:absolute; top:2vmin; left:2vmin; background:linear-gradient(135deg,#E0A07B,#C24E4E); color:#fff; font-weight:800; font-size:clamp(13px,2.4vmin,26px); padding:.7vmin 1.6vmin; border-radius:99px; box-shadow:0 .6vmin 1.6vmin rgba(194,78,78,.5); animation:kdstamp 2.4s ease-in-out infinite; }
        @keyframes kdstamp { 0%,100%{transform:rotate(-4deg) scale(1)} 50%{transform:rotate(-4deg) scale(1.06)} }
        .kd-hero-units { position:absolute; top:2vmin; right:2vmin; display:flex; align-items:center; gap:.8vmin; background:rgba(11,9,6,.7); border:1px solid rgba(157,176,127,.6); color:#A9BE88; font-size:clamp(10px,1.7vmin,18px); padding:.6vmin 1.4vmin; border-radius:99px; }
        .kd-units-dot { width:1vmin; height:1vmin; min-width:6px; min-height:6px; border-radius:50%; background:#A9BE88; box-shadow:0 0 1.2vmin #A9BE88; animation:kdblink 1.6s infinite; }
        .kd-hero-cap { position:absolute; left:2.4vmin; right:2.4vmin; bottom:2.2vmin; }
        .kd-hero-name { font-family:'Cormorant Garamond',serif; font-weight:700; font-size:clamp(26px,6vmin,76px); line-height:1.02; color:#fdfdfd; text-shadow:0 .4vmin 2vmin rgba(0,0,0,.6); }
        .kd-hero-meta { display:flex; flex-wrap:wrap; align-items:center; gap:1.2vmin; margin-top:.8vmin; font-size:clamp(12px,2.1vmin,22px); color:#d7dfe6; }
        .kd-stars { color:#c0ccd7; letter-spacing:1px; }
        .kd-hero-rating { background:rgba(176, 192, 209,.2); color:#d8dfe6; font-weight:700; padding:.2vmin 1.2vmin; border-radius:99px; }

        .kd-info { flex:1 1 0; min-width:0; min-height:0; display:flex; flex-direction:column; justify-content:space-between; gap:1.6vmin; }
        @media (orientation:portrait) { .kd-info { flex:0 0 auto; gap:1.4vmin; } }
        .kd-info-top { display:flex; flex-direction:column; gap:1.4vmin; }
        .kd-info-room { font-size:clamp(12px,2.1vmin,22px); color:#9eafc1; }
        .kd-price-block { display:flex; align-items:baseline; flex-wrap:wrap; gap:1.4vmin; }
        .kd-mrp { font-size:clamp(13px,2.2vmin,24px); color:#8A7C60; text-decoration:line-through; }
        .kd-price { font-family:'Cormorant Garamond',serif; font-weight:700; font-size:clamp(34px,8vmin,96px); line-height:.95; color:#c0ccd7; text-shadow:0 0 2.4vmin rgba(176, 192, 209,.28); animation:kdpriceglow 3.4s ease-in-out infinite; }
        @keyframes kdpriceglow { 0%,100%{text-shadow:0 0 1.6vmin rgba(176, 192, 209,.18)} 50%{text-shadow:0 0 3.2vmin rgba(176, 192, 209,.45)} }
        .kd-price span { font-size:.32em; color:#9eafc1; font-family:'Inter',sans-serif; }
        .kd-delta { font-size:clamp(11px,1.9vmin,20px); font-weight:700; padding:.4vmin 1.4vmin; border-radius:99px; }
        .kd-delta.up { background:rgba(224,138,123,.16); color:#E8A293; }
        .kd-delta.down { background:rgba(157,176,127,.16); color:#A9BE88; }
        .kd-amen { display:flex; flex-wrap:wrap; gap:1vmin; }
        .kd-amen-chip { background:rgba(36,30,20,.7); border:1px solid rgba(176, 192, 209,.18); color:#c0cbd7; font-size:clamp(10px,1.6vmin,17px); padding:.5vmin 1.4vmin; border-radius:99px; }

        /* SCORECARD — kiosk-native, tappable */
        .kd-score { display:block; width:100%; text-align:left; border:1px solid rgba(176, 192, 209,.32); background:linear-gradient(135deg,rgba(45,37,23,.92),rgba(28,22,14,.92)); border-radius:1.8vmin; padding:1.2vmin 1.6vmin; cursor:pointer; color:inherit; font:inherit; box-shadow:0 .8vmin 2.4vmin rgba(0,0,0,.35), inset 0 0 0 1px rgba(255,255,255,.03); transition:transform .18s ease, box-shadow .18s ease; }
        .kd-score:hover, .kd-score:active { transform:translateY(-2px); box-shadow:0 1.2vmin 3vmin rgba(106,133,160,.3); }
        .kd-score-head { display:flex; align-items:center; gap:1.4vmin; }
        .kd-score-medal { flex:0 0 auto; width:clamp(34px,5.4vmin,64px); height:clamp(34px,5.4vmin,64px); display:grid; place-items:center; font-size:clamp(17px,3vmin,34px); border-radius:50%; background:radial-gradient(circle at 32% 28%, #e3e8ed, #b4c1cf 55%, #3f5369); color:#3a2c08; box-shadow:0 .4vmin 1.4vmin rgba(106,133,160,.5), inset 0 .2vmin .4vmin rgba(255,255,255,.5), inset 0 -.3vmin .5vmin rgba(80,55,10,.4); animation:kdmedal 2.6s ease-in-out infinite; }
        @keyframes kdmedal { 0%,100%{box-shadow:0 .4vmin 1.4vmin rgba(106,133,160,.4), inset 0 .2vmin .4vmin rgba(255,255,255,.5), inset 0 -.3vmin .5vmin rgba(80,55,10,.4)} 50%{box-shadow:0 .4vmin 2.4vmin rgba(176, 192, 209,.75), inset 0 .2vmin .4vmin rgba(255,255,255,.6), inset 0 -.3vmin .5vmin rgba(80,55,10,.4)} }
        .kd-score-main { flex:1 1 auto; min-width:0; }
        .kd-score-num { font-family:'Cormorant Garamond',serif; font-size:clamp(16px,2.8vmin,30px); color:#d8dfe6; line-height:1.05; }
        .kd-score-num b { font-weight:700; font-size:1.25em; color:#e6ebef; }
        .kd-score-num span { color:#7a92aa; font-size:.7em; }
        .kd-score-num em { font-style:normal; font-family:'Inter',sans-serif; font-size:.46em; letter-spacing:.18vmin; text-transform:uppercase; color:#5f7c98; margin-left:.6vmin; }
        .kd-score-rank { font-size:clamp(10px,1.7vmin,17px); color:#c0cbd7; margin-top:.2vmin; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .kd-score-caret { flex:0 0 auto; font-size:clamp(9px,1.5vmin,14px); letter-spacing:.1vmin; text-transform:uppercase; color:#5f7c98; background:rgba(106,133,160,.14); border:1px solid rgba(106,133,160,.3); padding:.4vmin 1vmin; border-radius:99px; }
        .kd-score-detail { margin-top:1.2vmin; padding-top:1.2vmin; border-top:1px dashed rgba(176, 192, 209,.22); display:flex; flex-direction:column; gap:.8vmin; animation:kdpop .22s ease; }
        @keyframes kdpop { from{opacity:0; transform:translateY(-4px)} to{opacity:1; transform:translateY(0)} }
        .kd-score-row { display:flex; align-items:center; gap:1vmin; font-size:clamp(10px,1.7vmin,17px); }
        .kd-score-emoji { flex:0 0 auto; }
        .kd-score-label { flex:0 0 auto; min-width:11vmin; color:#c0cbd7; }
        .kd-score-bar { flex:1 1 auto; height:1vmin; min-height:6px; border-radius:99px; background:rgba(176, 192, 209,.14); overflow:hidden; }
        .kd-score-bar i { display:block; height:100%; border-radius:99px; background:linear-gradient(90deg,#5f7c98,#c6d0da); box-shadow:0 0 1vmin rgba(176, 192, 209,.4); }
        .kd-score-foot { font-size:clamp(9px,1.5vmin,14px); color:#7a92aa; margin-top:.4vmin; }

        /* BOOK BLOCK — QR + scan band (kills the dead space; clearest CTA) */
        .kd-book { display:flex; flex-direction:column; gap:1.2vmin; }
        .kd-qr { display:flex; align-items:center; gap:2vmin; background:#fcfcfd; border-radius:2vmin; padding:1.8vmin; box-shadow:0 1vmin 3vmin rgba(0,0,0,.4); align-self:flex-start; max-width:100%; }
        .kd-qr-imgwrap { position:relative; flex:0 0 auto; border-radius:1vmin; overflow:hidden; line-height:0; }
        .kd-qr-img { width:clamp(96px,16vmin,200px); height:clamp(96px,16vmin,200px); display:block; }
        .kd-qr-scan { position:absolute; left:0; right:0; top:0; height:18%; background:linear-gradient(180deg,rgba(106,133,160,0),rgba(106,133,160,.55)); box-shadow:0 0 1.4vmin rgba(106,133,160,.6); animation:kdscan 2.4s ease-in-out infinite; }
        @keyframes kdscan { 0%{top:-20%; opacity:0} 12%{opacity:1} 88%{opacity:1} 100%{top:100%; opacity:0} }
        .kd-qr-h { font-family:'Cormorant Garamond',serif; font-weight:700; color:#1F1A0F; font-size:clamp(16px,2.6vmin,28px); line-height:1.1; }
        .kd-qr-s { color:#6E5430; font-size:clamp(11px,1.7vmin,18px); margin-top:.6vmin; }
        .kd-scan-band { display:flex; align-items:center; gap:1.2vmin; align-self:flex-start; max-width:100%; background:linear-gradient(90deg,rgba(106,133,160,.16),rgba(106,133,160,.04)); border:1px solid rgba(176, 192, 209,.28); border-radius:99px; padding:.7vmin 1.6vmin; font-size:clamp(11px,1.8vmin,19px); color:#d7dfe6; }
        .kd-scan-band b { color:#d8dfe6; }
        .kd-scan-arrow { display:inline-block; font-size:1.3em; animation:kdfloat 1.4s ease-in-out infinite; }
        @keyframes kdfloat { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-.7vmin)} }

        .kd-dots { display:flex; align-items:center; flex-wrap:wrap; gap:1vmin; }
        .kd-dot2 { width:1.4vmin; height:1.4vmin; min-width:8px; min-height:8px; border-radius:99px; background:rgba(176, 192, 209,.28); transition:all .3s; }
        .kd-dot2.on { background:#c0ccd7; width:4vmin; min-width:22px; }
        .kd-counter { margin-left:1vmin; font-size:clamp(10px,1.6vmin,16px); color:#7a92aa; }

        /* FOOTER */
        .kd-footer { flex:0 0 auto; display:flex; align-items:center; justify-content:space-between; gap:2vmin; flex-wrap:wrap; padding:1.4vmin 3vmin; border-top:1px solid rgba(176, 192, 209,.2); background:linear-gradient(90deg,#1A1610,#0F0C08,#1A1610); }
        .kd-fstats { display:flex; gap:3vmin; flex-wrap:wrap; font-size:clamp(11px,1.8vmin,18px); color:#9eafc1; }
        .kd-fstats b { color:#c0ccd7; margin-left:.4vmin; }
        .kd-cta { position:relative; overflow:hidden; text-decoration:none; display:inline-flex; align-items:center; border-radius:99px; background:linear-gradient(135deg,#c6d0da,#c0ccd7 45%,#5f7c98); padding:1.1vmin 2.8vmin; box-shadow:0 .6vmin 2.4vmin rgba(106,133,160,.5); white-space:nowrap; animation:kdpulse 2.4s infinite; }
        .kd-cta-txt { position:relative; z-index:1; font-family:'Cormorant Garamond',serif; font-style:italic; font-weight:700; font-size:clamp(15px,2.6vmin,28px); color:#1F1A0F; }
        .kd-cta-glow { position:absolute; inset:0; background:linear-gradient(110deg,transparent 20%,rgba(255,255,255,.7) 50%,transparent 80%); transform:translateX(-120%); animation:kdshine 2.8s ease-in-out infinite; }
        @keyframes kdshine { 0%{transform:translateX(-120%)} 60%,100%{transform:translateX(120%)} }
        .kd-cta:active { transform:scale(.97); }
        @keyframes kdpulse { 0%,100%{box-shadow:0 .6vmin 2vmin rgba(106,133,160,.45)} 50%{box-shadow:0 .6vmin 3.6vmin rgba(176, 192, 209,.85)} }

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
          /* hero capped so the price + score + QR + footer always sit above
             the fold; stage packs from the TOP + can scroll as a safety */
          .kd-stage { gap:3vw; padding:3vw 4vw; overflow-y:auto; }
          .kd-hero { flex:0 0 26vh; min-height:26vh; }
          .kd-hero-name { font-size:7vw; }
          .kd-hero-meta { font-size:3.4vw; gap:2.5vw; }
          .kd-hero-disc { font-size:3.6vw; padding:1.4vw 3vw; top:3vw; left:3vw; }
          .kd-hero-units { font-size:2.8vw; padding:1.2vw 2.6vw; top:3vw; right:3vw; }
          .kd-info { gap:3vw; justify-content:flex-start; }
          .kd-info-top { gap:2.6vw; }
          /* keep scorecard + scan band visible on phones; trim only the
             least-essential rows so the QR never clips behind the footer */
          .kd-info-room, .kd-amen, .kd-dots { display:none; }
          .kd-price { font-size:11vw; }
          .kd-mrp { font-size:4vw; }
          .kd-delta { font-size:3.4vw; padding:1vw 3vw; }
          .kd-score { padding:2.6vw 3vw; border-radius:3.5vw; }
          .kd-score-num { font-size:5vw; }
          .kd-score-rank { font-size:3.2vw; }
          .kd-score-caret { font-size:2.8vw; }
          .kd-score-row { font-size:3.2vw; }
          .kd-score-label { min-width:24vw; }
          .kd-book { gap:2.6vw; }
          .kd-qr { gap:3.5vw; padding:3vw; }
          .kd-qr-img { width:24vw; height:24vw; }
          .kd-qr-h { font-size:4.2vw; }
          .kd-qr-s { font-size:2.8vw; }
          .kd-scan-band { font-size:3.2vw; padding:1.6vw 3.5vw; }
          .kd-footer { gap:2.5vw; padding:2.5vw 4vw; }
          .kd-fstats { gap:4vw; font-size:3.2vw; }
          .kd-cta-txt { font-size:4.2vw; }
          .kd-cta { padding:2.2vw 5vw; }
        }
        /* very narrow phones (iPhone SE etc.) — drop the live ticker entirely
           so the hero + score + QR always fit above the fold */
        @media (max-width:380px) {
          .kd-ticker { display:none; }
          .kd-hero { flex:0 0 24vh; min-height:24vh; }
          .kd-price { font-size:10vw; }
          .kd-qr-img { width:22vw; height:22vw; }
        }
        @media (prefers-reduced-motion: reduce) {
          .kd-hero-img, .kd-hero-disc, .kd-price, .kd-score-medal, .kd-qr-scan,
          .kd-scan-arrow, .kd-cta, .kd-cta-glow, .kd-dot, .kd-units-dot,
          .kd-ticker-track { animation:none !important; }
          .kd-cta-glow { display:none; }
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
