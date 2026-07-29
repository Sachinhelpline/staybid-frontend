"use client";
// ═══════════════════════════════════════════════════════════════════════════
// v555 — DESKTOP HOME ("The Stage")
//
// The desktop root surface. Until now `/` rendered the mobile reel player
// centred on a wide canvas with two thin side panels — a phone layout scaled
// up, which can never read as desktop-native no matter how it is resized.
//
// This is a real desktop home in the streaming-service idiom (Netflix / Prime
// Video / Hotstar): a cinematic HERO for the featured property, then rows of
// cards for everything StayBid actually sells — Flash Deals, Reels, and one
// rail per launch ZONE. The reel feed is not removed; it becomes a browsable
// rail (and, in a later phase, a full-screen theater player).
//
// Contracts honoured:
//   • DESKTOP-ONLY — returns null below 1024px, so the mobile reel experience
//     (app/discover/page.tsx) is byte-identical and carries zero risk.
//   • All styling lives in app/desktop.css under the NEW `.sbh-*` namespace —
//     never a new `.sb-*`/`.hx-*` animation utility, never a <style jsx> here.
//   • Every number is real: prices from /api/hotels rooms, deals from
//     /api/flash/near, scores + cohort rank from /api/hotels/scorecards.
// ═══════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { LAUNCH_ZONES, zoneForCity } from "@/lib/launch/curation";
import { currentMonthDemand, demandTier } from "@/lib/circle/demand-cycle";
import { CountUp } from "@/components/CountUp";

const SEASON_ICON: Record<string, string> = {
  Winter: "❄️", Spring: "🌸", Summer: "☀️", Monsoon: "🌧️", Autumn: "🍂",
};

/* ── types (loose — the APIs are untyped JSON) ─────────────────────────── */
type Hotel = {
  id: string;
  name?: string;
  city?: string;
  state?: string;
  images?: string[];
  starRating?: number | null;
  avgRating?: number | null;
  totalReviews?: number | null;
  amenities?: string[];
  rooms?: { floorPrice?: number | null; mrp?: number | null }[];
};
type Deal = {
  id: string;
  hotelId?: string;
  city?: string;
  aiPrice?: number;
  discount?: number;
  marketRate?: number | null;
  hotel?: Hotel;
  room?: { name?: string } | null;
};
type Reel = {
  id: string;
  media_url?: string | null;
  thumbnail_url?: string | null;
  media_type?: string | null;
  caption?: string | null;
  location_name?: string | null;
  author?: { display_name?: string | null; avatar_url?: string | null } | null;
  display_name?: string | null;
  hotel?: { id?: string; name?: string; minPrice?: number | null } | null;
};
type Scorecard = {
  overall?: number | null;
  badge?: string | null;
  rank?: { rank?: number | null; scopeLabel?: string | null } | null;
};

const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");

/** cheapest real room price for a hotel, or null */
function minPriceOf(h?: Hotel | null): number | null {
  const list = (h?.rooms || [])
    .map((r) => Number(r?.floorPrice))
    .filter((n) => Number.isFinite(n) && n > 0);
  return list.length ? Math.min(...list) : null;
}
function imgOf(h?: Hotel | null): string {
  const arr = Array.isArray(h?.images) ? h!.images!.filter(Boolean) : [];
  return arr[0] || "";
}
function reelPoster(r: Reel): string {
  const isVideo = String(r.media_type || "").toUpperCase() !== "IMAGE";
  return (isVideo ? r.thumbnail_url : r.media_url) || r.media_url || "";
}

/* ── horizontal rail with arrow controls ───────────────────────────────── */
function Rail({
  title,
  sub,
  href,
  children,
  variant = "wide",
}: {
  title: string;
  sub?: string;
  href?: string;
  children: React.ReactNode;
  variant?: "wide" | "tall";
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);

  const sync = () => {
    const el = ref.current;
    if (!el) return;
    setAtStart(el.scrollLeft < 8);
    setAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 8);
  };
  useEffect(() => {
    sync();
    const el = ref.current;
    if (!el) return;
    el.addEventListener("scroll", sync, { passive: true });
    window.addEventListener("resize", sync);
    return () => {
      el.removeEventListener("scroll", sync);
      window.removeEventListener("resize", sync);
    };
  }, []);
  const nudge = (dir: 1 | -1) => {
    const el = ref.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.round(el.clientWidth * 0.82), behavior: "smooth" });
  };

  return (
    <section className="sbh-rail-wrap">
      <div className="sbh-rail-head">
        <div>
          <h2 className="sbh-rail-title">{title}</h2>
          {sub ? <p className="sbh-rail-sub">{sub}</p> : null}
        </div>
        {href ? (
          <Link href={href} className="sbh-rail-all">
            See all <span aria-hidden>→</span>
          </Link>
        ) : null}
      </div>
      <div className="sbh-rail-shell">
        <button
          type="button"
          className="sbh-rail-nav sbh-rail-nav-l"
          onClick={() => nudge(-1)}
          disabled={atStart}
          aria-label={`Scroll ${title} left`}
        >
          ‹
        </button>
        <div ref={ref} className={`sbh-rail sbh-rail-${variant}`}>
          {children}
        </div>
        <button
          type="button"
          className="sbh-rail-nav sbh-rail-nav-r"
          onClick={() => nudge(1)}
          disabled={atEnd}
          aria-label={`Scroll ${title} right`}
        >
          ›
        </button>
      </div>
    </section>
  );
}

/* ── cards ─────────────────────────────────────────────────────────────── */
function HotelCard({ h, score }: { h: Hotel; score?: Scorecard }) {
  const price = minPriceOf(h);
  const img = imgOf(h);
  const rank = score?.rank?.rank;
  const scope = score?.rank?.scopeLabel;
  return (
    <Link href={`/hotels/${h.id}`} className="sbh-card sbh-card-wide">
      <div className="sbh-card-media">
        {img ? <img src={img} alt="" loading="lazy" /> : <div className="sbh-card-ph" />}
        <div className="sbh-card-sheen" aria-hidden />
        <div className="sbh-card-scrim" aria-hidden />
        {score?.overall != null ? (
          <span className="sbh-chip sbh-chip-score">
            {Math.round(score.overall)}<em>/100</em>
          </span>
        ) : null}
      </div>
      <div className="sbh-card-body">
        <h3 className="sbh-card-name" title={h.name || ""}>{h.name}</h3>
        <p className="sbh-card-meta">
          {h.city}
          {rank && scope ? <span className="sbh-card-rank"> · #{rank} in {scope}</span> : null}
        </p>
        {price != null ? (
          <p className="sbh-card-price">
            <span>from</span> <b>{inr(price)}</b> <em>/night</em>
          </p>
        ) : null}
      </div>
    </Link>
  );
}

/** ms until the next 00:00 IST — flash inventory resets nightly (see
 *  app/api/flash/near: "every unsold room at 12am IST"). Real deadline, not a fake timer. */
function msToMidnightIST(): number {
  const now = Date.now();
  const IST = 5.5 * 3600_000;
  const ist = now + IST;
  const next = Math.floor(ist / 86400_000) * 86400_000 + 86400_000;
  return Math.max(0, next - ist);
}
function useNightlyCountdown(): string {
  const [ms, setMs] = useState<number | null>(null);
  useEffect(() => {
    setMs(msToMidnightIST());
    const t = setInterval(() => setMs(msToMidnightIST()), 1000);
    return () => clearInterval(t);
  }, []);
  if (ms == null) return "";
  const s = Math.floor(ms / 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
}

function FlashCard({ d, left }: { d: Deal; left: string }) {
  const h = d.hotel;
  const img = imgOf(h);
  const now = Number(d.aiPrice) || 0;
  const was = Number(d.marketRate) || 0;
  return (
    <Link href={`/hotels/${d.hotelId || h?.id || ""}`} className="sbh-card sbh-card-wide sbh-card-flash">
      <div className="sbh-card-media">
        {img ? <img src={img} alt="" loading="lazy" /> : <div className="sbh-card-ph" />}
        <div className="sbh-card-sheen" aria-hidden />
        <div className="sbh-card-scrim" aria-hidden />
        {d.discount ? <span className="sbh-chip sbh-chip-off">{Math.round(d.discount)}% OFF</span> : null}
        {left ? <span className="sbh-chip sbh-chip-live">⏳ {left}</span> : null}
      </div>
      <div className="sbh-card-body">
        <h3 className="sbh-card-name" title={h?.name || ""}>{h?.name}</h3>
        <p className="sbh-card-meta">{d.city || h?.city}</p>
        <p className="sbh-card-price">
          {was > now ? <s>{inr(was)}</s> : null} <b>{inr(now)}</b> <em>/night</em>
        </p>
      </div>
    </Link>
  );
}

function ReelCard({ r, preview, onOpen }: { r: Reel; preview: boolean; onOpen: () => void }) {
  const poster = reelPoster(r);
  const who = r.author?.display_name || r.display_name || "StayBid";
  const price = r.hotel?.minPrice;
  // Netflix-style hover preview: the reel's own clip plays muted on hover.
  // Motion happens exactly where the pointer already is — never on its own.
  // Hover preview is a pointer affordance — never mounted on touch, so phones
  // don't fetch a dozen video headers they can never trigger.
  const isVideo = preview && String(r.media_type || "").toUpperCase() !== "IMAGE" && !!r.media_url;
  const [hot, setHot] = useState(false);
  const [playing, setPlaying] = useState(false);
  const vid = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = vid.current;
    if (!v) return;
    if (!hot) {
      v.pause();
      setPlaying(false);
      return;
    }
    // Small debounce so a casual mouse sweep across the rail doesn't kick off
    // a dozen video fetches; a deliberate hover starts loading + playing.
    let cancelled = false;
    const t = setTimeout(() => {
      if (cancelled || !vid.current) return;
      const el = vid.current;
      el.muted = true;                       // belt-and-braces for autoplay policy
      el.play().then(() => { if (cancelled) el.pause(); }).catch(() => {});
    }, 180);
    return () => { cancelled = true; clearTimeout(t); };
  }, [hot]);
  return (
    /* A button, not a link: it opens the player for THIS reel in place.
       /discover is still one tap away from inside the theater. */
    <button
      type="button"
      className="sbh-card sbh-card-tall"
      onClick={onOpen}
      onMouseEnter={() => setHot(true)}
      onMouseLeave={() => setHot(false)}
    >
      <div className="sbh-card-media">
        {poster ? <img src={poster} alt="" loading="lazy" /> : <div className="sbh-card-ph" />}
        {isVideo ? (
          <video
            ref={vid}
            /* only fade in once frames are actually flowing — never a black box */
            className={`sbh-reel-vid${hot && playing ? " is-on" : ""}`}
            src={r.media_url || undefined}
            muted
            loop
            playsInline
            preload="metadata"
            onPlaying={() => setPlaying(true)}
            onEnded={() => setPlaying(false)}
            tabIndex={-1}
            aria-hidden
          />
        ) : null}
        <div className="sbh-card-sheen" aria-hidden />
        <div className="sbh-card-scrim" aria-hidden />
        <span className="sbh-play" aria-hidden>▶</span>
        <div className="sbh-reel-foot">
          <strong>{who}</strong>
          {r.location_name ? <span>{r.location_name}</span> : null}
        </div>
        {price ? <span className="sbh-chip sbh-chip-price">{inr(price)}<em>/n</em></span> : null}
      </div>
    </button>
  );
}

/* ── REEL THEATER — tapping a reel plays THAT reel ──────────────────────
   Before this, a reel card linked to /discover, which drops you at the top of
   a generic feed — the one place on the Stage where the card promised
   something the click did not deliver. The theater plays the reel you picked,
   lets you move through the rail with keys/swipe/arrows, and keeps StayBid's
   ground reality attached: every post tags a real hotel, so the panel carries
   that hotel and its real cheapest nightly price straight to /hotels/[id].
   No fullscreen API call here — that is the /reels page's deliberate back-
   gesture behaviour and does not belong on an overlay you can Esc out of. */
function ReelTheater({
  reels, idx, onIdx, onClose, priceFor,
}: {
  reels: Reel[];
  idx: number;
  onIdx: (n: number) => void;
  onClose: () => void;
  priceFor: (hotelId?: string | null) => number | null;
}) {
  const r = reels[idx];
  const vid = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(false);
  const [paused, setPaused] = useState(false);
  const touch = useRef<{ x: number; y: number } | null>(null);

  const go = (d: number) => {
    if (!reels.length) return;
    onIdx((idx + d + reels.length) % reels.length);
  };

  // Keyboard: the overlay owns the page while it is open.
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onClose(); return; }
      if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); go(1); }
      else if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); go(-1); }
      else if (e.key === " ") { e.preventDefault(); setPaused((p) => !p); }
      else if (e.key.toLowerCase() === "m") setMuted((m) => !m);
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  });

  // Scroll lock. Restores the exact previous value rather than clearing it, so
  // we never stomp on another surface that legitimately set overflow.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  // Autoplay the current clip. Opening is a user gesture, so sound is allowed;
  // if the browser still refuses we fall back to muted rather than showing a
  // frozen frame.
  useEffect(() => {
    const v = vid.current;
    if (!v) return;
    v.currentTime = 0;
    setPaused(false);
    v.play().catch(() => {
      v.muted = true;
      setMuted(true);
      v.play().catch(() => {});
    });
  }, [idx]);

  useEffect(() => { if (vid.current) vid.current.muted = muted; }, [muted]);
  useEffect(() => {
    const v = vid.current;
    if (!v) return;
    if (paused) v.pause(); else v.play().catch(() => {});
  }, [paused]);

  if (!r) return null;
  const poster = reelPoster(r);
  const isVideo = String(r.media_type || "").toUpperCase() !== "IMAGE" && !!r.media_url;
  const who = r.author?.display_name || r.display_name || "StayBid";
  const hotelId = r.hotel?.id || null;
  const price = priceFor(hotelId);

  return (
    <div
      className="sbh-th"
      role="dialog"
      aria-modal="true"
      aria-label="Reel player"
      onClick={onClose}
      onTouchStart={(e) => { const t = e.touches[0]; touch.current = { x: t.clientX, y: t.clientY }; }}
      onTouchEnd={(e) => {
        const s = touch.current;
        touch.current = null;
        if (!s) return;
        const t = e.changedTouches[0];
        const dx = t.clientX - s.x;
        const dy = t.clientY - s.y;
        // A downward flick closes (the phone gesture people already expect);
        // a horizontal flick moves through the rail.
        if (Math.abs(dy) > Math.abs(dx) && dy > 70) onClose();
        else if (Math.abs(dx) > 60) go(dx < 0 ? 1 : -1);
      }}
    >
      <button className="sbh-th-x" onClick={onClose} aria-label="Close">✕</button>
      {reels.length > 1 ? (
        <>
          <button
            className="sbh-th-nav sbh-th-prev"
            onClick={(e) => { e.stopPropagation(); go(-1); }}
            aria-label="Previous reel"
          >‹</button>
          <button
            className="sbh-th-nav sbh-th-next"
            onClick={(e) => { e.stopPropagation(); go(1); }}
            aria-label="Next reel"
          >›</button>
        </>
      ) : null}

      <div className="sbh-th-stage" onClick={(e) => e.stopPropagation()}>
        <div className="sbh-th-frame">
          {isVideo ? (
            <video
              ref={vid}
              key={r.id}
              className="sbh-th-media"
              src={r.media_url || undefined}
              poster={poster || undefined}
              loop
              playsInline
              onClick={() => setPaused((p) => !p)}
              onPlaying={() => setPaused(false)}
            />
          ) : poster ? (
            <img className="sbh-th-media" src={poster} alt={r.caption || ""} />
          ) : (
            <div className="sbh-card-ph" />
          )}

          {isVideo ? (
            <>
              {paused ? <span className="sbh-th-paused" aria-hidden>▶</span> : null}
              <button
                className="sbh-th-mute"
                onClick={(e) => { e.stopPropagation(); setMuted((m) => !m); }}
                aria-label={muted ? "Unmute" : "Mute"}
              >{muted ? "🔇" : "🔊"}</button>
            </>
          ) : null}
          <span className="sbh-th-count">{idx + 1} / {reels.length}</span>
        </div>

        <aside className="sbh-th-side">
          <p className="sbh-th-who">{who}</p>
          {r.location_name ? <p className="sbh-th-loc">📍 {r.location_name}</p> : null}
          {r.caption ? <p className="sbh-th-cap">{r.caption}</p> : null}

          {hotelId ? (
            <div className="sbh-th-hotel">
              <p className="sbh-th-hlabel">Stay in this reel</p>
              <p className="sbh-th-hname">{r.hotel?.name}</p>
              {price ? <p className="sbh-th-hprice">from <b>{inr(price)}</b> <em>/night</em></p> : null}
              <Link href={`/hotels/${hotelId}`} className="sbh-btn sbh-btn-primary sbh-th-cta">
                View hotel
              </Link>
              {/* ?intent=negotiate is a real deep-link the hotel page honours —
                  it auto-opens the picker on the cheapest room and resumes
                  into the Negotiate modal. /bid takes no hotel param, so
                  linking there would silently drop the hotel. */}
              <Link href={`/hotels/${hotelId}?intent=negotiate`} className="sbh-th-bid">
                or name your own price →
              </Link>
            </div>
          ) : null}

          <Link href="/discover" className="sbh-th-all">See all reels →</Link>
        </aside>
      </div>
    </div>
  );
}

/* ── LIVE BIDDING band — StayBid's actual differentiator ───────────────── */
type Insights = {
  tonightAuctions?: number;
  acceptedToday?: number;
  hotelsListening?: number;
  avgAcceptMins?: number;
  recentWins?: { id: string; initial?: string; amount?: number; hotelName?: string; city?: string; when?: string }[];
};

function LiveBidding() {
  const [d, setD] = useState<Insights | null>(null);
  useEffect(() => {
    let dead = false;
    fetch("/api/bids/insights")
      .then((r) => (r.ok ? r.json() : null), () => null)
      .then((j) => { if (!dead && j) setD(j); });
    return () => { dead = true; };
  }, []);

  // Every figure comes from /api/bids/insights — real open bid_requests, real
  // accepted bids, real median accept time, real active hotels. Nothing here is
  // invented, which means the band has to survive a QUIET platform honestly: on
  // a day with no auctions those counters are all 0, and a wall of zeros under
  // a "live right now" claim would be both ugly and untrue. So the right-hand
  // panel switches — activity ⇒ the live numbers + recent wins; silence ⇒ the
  // mechanic itself, plus the one number that is always true (hotels listening).
  const wins = (d?.recentWins || []).filter((w) => w.hotelName);
  const live = (d?.tonightAuctions ?? 0) > 0 || (d?.acceptedToday ?? 0) > 0 || wins.length > 0;

  const stats = [
    { k: "Live auctions", v: d?.tonightAuctions ?? 0, suffix: "" },
    { k: "Accepted today", v: d?.acceptedToday ?? 0, suffix: "" },
    { k: "Avg. reply", v: d?.avgAcceptMins ?? 0, suffix: " min" },
    { k: "Hotels listening", v: d?.hotelsListening ?? 0, suffix: "" },
  ].filter((s) => s.v > 0);

  // The actual mechanic, in the order the user meets it on /bid.
  const steps = [
    { n: "1", t: "Name your price", s: "Pick a stay, set what you want to pay." },
    { n: "2", t: "Hotels reply", s: "They accept, counter or decline — live." },
    { n: "3", t: "Pay only if you like it", s: "No answer you like, no booking." },
  ];

  return (
    <section className="sbh-bid">
      <div className="sbh-bid-inner">
        <div className="sbh-bid-lead">
          <p className="sbh-bid-kicker">
            {live ? <><span className="sbh-dot" aria-hidden /> Live right now</> : <>How StayBid works</>}
          </p>
          <h2 className="sbh-bid-title">Name your price.<br />Let hotels compete.</h2>
          <p className="sbh-bid-sub">
            You don&apos;t take the listed rate — you make an offer. Hotels accept, counter or decline,
            usually within minutes.
          </p>
          <Link href="/bid" className="sbh-btn sbh-btn-primary sbh-bid-cta">Start bidding</Link>
        </div>

        <div className="sbh-bid-right">
          {live && stats.length ? (
            <div className="sbh-bid-stats">
              {stats.map((s) => (
                <div className="sbh-bid-stat" key={s.k}>
                  <b><CountUp value={s.v} />{s.suffix ? <i>{s.suffix}</i> : null}</b>
                  <span>{s.k}</span>
                </div>
              ))}
            </div>
          ) : (
            <ol className="sbh-bid-steps">
              {steps.map((s) => (
                <li key={s.n}>
                  <span className="sbh-bid-step-n">{s.n}</span>
                  <span className="sbh-bid-step-b">
                    <strong>{s.t}</strong>
                    <em>{s.s}</em>
                  </span>
                </li>
              ))}
            </ol>
          )}

          {live && wins.length ? (
            <ul className="sbh-bid-wins">
              {wins.slice(0, 3).map((w) => (
                <li key={w.id}>
                  <span className="sbh-bid-who">{w.initial || "G"}</span>
                  {/* the ₹ figure is the point of the row, so it must never be
                      the thing that gets ellipsised — hence text + timestamp
                      live in one block that stacks on a phone. */}
                  <span className="sbh-bid-body">
                    <span className="sbh-bid-what">
                      won <strong>{w.hotelName}</strong>
                      {w.amount ? <> for <b>{inr(w.amount)}</b></> : null}
                    </span>
                    {w.when ? <span className="sbh-bid-when">{w.when}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          ) : (d?.hotelsListening ?? 0) > 0 ? (
            <p className="sbh-bid-listening">
              <span className="sbh-dot" aria-hidden />
              <b><CountUp value={d?.hotelsListening ?? 0} /></b> hotels taking offers right now
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}

/* ── the page ──────────────────────────────────────────────────────────── */
/** Desktop-only affordances (hover video preview) — never on touch. */
function useWide(): boolean {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const a = () => setWide(mq.matches);
    a();
    mq.addEventListener("change", a);
    return () => mq.removeEventListener("change", a);
  }, []);
  return wide;
}

export default function DesktopHome() {
  const [on, setOn] = useState(false);
  const wide = useWide();
  const [hotels, setHotels] = useState<Hotel[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [reels, setReels] = useState<Reel[]>([]);
  const [scores, setScores] = useState<Record<string, Scorecard>>({});
  const countdown = useNightlyCountdown();
  const [theater, setTheater] = useState<number | null>(null);

  // Client-mount gate only. WHICH viewports get this home is decided in
  // app/page.tsx (desktop always; mobile behind MOBILE_HOME_ON), so this
  // component stays a pure renderer.
  useEffect(() => { setOn(true); }, []);

  // body marker so desktop.css can retire the reel-player chrome on this surface
  useEffect(() => {
    if (!on) return;
    document.body.classList.add("sbh-on");
    return () => document.body.classList.remove("sbh-on");
  }, [on]);

  useEffect(() => {
    if (!on) return;
    let dead = false;
    (async () => {
      const [hj, fj, sj] = await Promise.all([
        fetch("/api/hotels?limit=100", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null), () => null),
        fetch("/api/flash/near").then((r) => (r.ok ? r.json() : null), () => null),
        fetch("/api/social/feed?limit=24").then((r) => (r.ok ? r.json() : null), () => null),
      ]);
      if (dead) return;
      const hs: Hotel[] = Array.isArray(hj?.hotels) ? hj.hotels : [];
      setHotels(hs);
      setDeals(Array.isArray(fj?.deals) ? fj.deals : []);
      setReels(Array.isArray(sj?.posts) ? sj.posts : []);

      // scorecards for the hotels we will actually render
      const ids = hs.map((h) => h.id).filter(Boolean).slice(0, 60);
      if (ids.length) {
        const sc = await fetch(`/api/hotels/scorecards?ids=${ids.join(",")}`)
          .then((r) => (r.ok ? r.json() : null), () => null);
        if (!dead && sc?.scorecards) setScores(sc.scorecards);
      }
    })();
    return () => { dead = true; };
  }, [on]);

  // The theater navigates the SAME slice the rail renders, so "next" never
  // walks off into reels the user never saw on the rail.
  const theaterReels = useMemo(() => reels.slice(0, 16), [reels]);

  // /api/social/feed returns the tagged hotel's identity columns but no price
  // (HOTEL_CARD_COLS carries no rooms). The rails' own hotels cover part of it,
  // but launch curation caps /api/hotels to one property per city, so most
  // tagged hotels are NOT in that payload — which is the exact case
  // /api/hotels/starting-prices was built for. One batched call fills the rest.
  const [taggedPrices, setTaggedPrices] = useState<Record<string, number>>({});
  useEffect(() => {
    const ids = Array.from(
      new Set(theaterReels.map((r) => r.hotel?.id).filter(Boolean) as string[]),
    );
    if (!ids.length) return;
    let dead = false;
    fetch(`/api/hotels/starting-prices?ids=${ids.map(encodeURIComponent).join(",")}`)
      .then((r) => (r.ok ? r.json() : null), () => null)
      .then((j) => { if (!dead && j?.prices) setTaggedPrices(j.prices); });
    return () => { dead = true; };
  }, [theaterReels]);

  const priceByHotel = useMemo(() => {
    const m: Record<string, number> = { ...taggedPrices };
    hotels.forEach((h) => {
      const p = minPriceOf(h);
      if (h.id && p) m[String(h.id)] = p;
    });
    return m;
  }, [hotels, taggedPrices]);
  const priceForHotel = useCallback(
    (id?: string | null) => (id ? priceByHotel[String(id)] ?? null : null),
    [priceByHotel],
  );

  // ── SEASON-DRIVEN HERO POOL ──────────────────────────────────────────
  // The hero is not one hard-coded property: it showcases EVERY property in
  // the locations that are actually in season this month, read from the real
  // 12-month demand cycle (lib/circle/demand-cycle.ts — the same wheel the
  // Circle portfolio uses). July → Monsoon → Leh; December → Winter → Goa /
  // Udaipur / Jaisalmer, and so on. Falls back primary → secondary → best
  // scored, so the hero can never be empty.
  const demand = useMemo(() => currentMonthDemand(), []);
  const heroPool = useMemo(() => {
    const byScore = (a: Hotel, b: Hotel) => (scores[b.id]?.overall ?? 0) - (scores[a.id]?.overall ?? 0);
    const shot = hotels.filter((h) => imgOf(h));
    const tier = (t: "primary" | "secondary") =>
      shot.filter((h) => demandTier(h.city || "", demand.month) === t).sort(byScore);
    // Primaries lead. If this month's primaries are thin (e.g. July → Leh,
    // which has one curated property), widen to the SECONDARY performers —
    // they are genuinely in season too, so the hero rotates without ever
    // claiming a season a city does not have.
    const p = tier("primary");
    const s = tier("secondary");
    const seasonal = p.length >= 3 ? p : [...p, ...s];
    if (seasonal.length) return seasonal;
    return shot.slice().sort(byScore).slice(0, 6);
  }, [hotels, scores, demand]);

  // rotation — auto-advance, but pauses on hover and never runs under
  // prefers-reduced-motion or when the user has taken manual control.
  const [heroIdx, setHeroIdx] = useState(0);
  const [held, setHeld] = useState(false);
  useEffect(() => { setHeroIdx(0); }, [heroPool.length]);
  useEffect(() => {
    if (held || heroPool.length < 2) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // 5s — fast enough to feel alive, slow enough to still read the name, the
    // price and reach a CTA. Below ~5s a slide gets cut off mid-read, which is
    // why this is the floor rather than 3-4s.
    const t = setInterval(() => setHeroIdx((i) => (i + 1) % heroPool.length), 5000);
    return () => clearInterval(t);
  }, [held, heroPool.length]);
  const featured = heroPool[heroIdx] || heroPool[0] || null;

  // ── LIVE TICKER — real facts only (deals + the season wheel) ─────────
  const ticker = useMemo(() => {
    const out: string[] = [];
    const seasonCities = demand.primary.join(" · ");
    if (seasonCities) out.push(`${SEASON_ICON[demand.season] || "✦"} ${demand.season} — ${seasonCities} in season now`);
    for (const d of deals.slice(0, 8)) {
      if (!d.hotel?.name) continue;
      out.push(`⚡ ${d.hotel.name}${d.discount ? ` — ${Math.round(d.discount)}% off tonight` : ""}`);
    }
    if (hotels.length) out.push(`🏔️ ${hotels.length} properties live across ${LAUNCH_ZONES.length} zones`);
    return out;
  }, [deals, hotels.length, demand]);

  // zone rails — reuse the launch curation grouping (same as /hotels)
  const zoneRails = useMemo(() => {
    const out: { id: string; label: string; items: Hotel[] }[] = [];
    for (const z of LAUNCH_ZONES) {
      const items = hotels.filter((h) => zoneForCity(h.city) === z.id);
      if (items.length) out.push({ id: z.id, label: z.label, items });
    }
    return out;
  }, [hotels]);

  if (!on) return null;

  const fScore = featured ? scores[featured.id] : undefined;
  const fPrice = minPriceOf(featured);
  const fImg = imgOf(featured);
  const fRank = fScore?.rank;

  return (
    <div className="sbh-root">
      {/* ── HERO ─────────────────────────────────────────────────────── */}
      <section
        className="sbh-hero"
        onMouseEnter={() => setHeld(true)}
        onMouseLeave={() => setHeld(false)}
      >
        <div
          key={featured?.id || "hero"}
          className="sbh-hero-bg"
          style={fImg ? { backgroundImage: `url("${fImg}")` } : undefined}
          aria-hidden
        />
        <div className="sbh-hero-scrim" aria-hidden />
        <div className="sbh-hero-inner">
          <p className="sbh-eyebrow">
            <span className="sbh-dot" aria-hidden />
            {SEASON_ICON[demand.season] || "✦"} {demand.season} · In season now
            {fRank?.rank && fRank?.scopeLabel ? ` · #${fRank.rank} in ${fRank.scopeLabel}` : ""}
          </p>
          <h1 className="sbh-hero-title">{featured?.name || "Bid your stay. Save big."}</h1>
          <p className="sbh-hero-meta">
            {featured?.starRating ? (
              <span className="sbh-stars">{"★".repeat(Math.min(5, Math.round(featured.starRating)))}</span>
            ) : null}
            {featured?.city ? <span>{featured.city}{featured.state ? `, ${featured.state}` : ""}</span> : null}
            {fScore?.overall != null ? <span className="sbh-hero-score">{Math.round(fScore.overall)}/100</span> : null}
          </p>
          {fPrice != null ? (
            <p className="sbh-hero-price">
              <span>from</span> <b>{inr(fPrice)}</b> <em>/night</em>
              <span className="sbh-hero-nudge">— or name your own price</span>
            </p>
          ) : null}
          <div className="sbh-hero-cta">
            <Link href={featured ? `/hotels/${featured.id}` : "/hotels"} className="sbh-btn sbh-btn-primary">
              Bid your stay
            </Link>
            <Link href="/discover" className="sbh-btn sbh-btn-ghost">
              ▶ Watch reels
            </Link>
          </div>
          {featured?.amenities?.length ? (
            <div className="sbh-hero-chips">
              {featured.amenities.slice(0, 5).map((a) => (
                <span key={a} className="sbh-amen">{a}</span>
              ))}
            </div>
          ) : null}
        </div>

        {/* rotation control — the user can always take over */}
        {heroPool.length > 1 ? (
          <div className="sbh-hero-dots" role="tablist" aria-label="Featured properties in season">
            {heroPool.slice(0, 8).map((h, i) => (
              <button
                key={h.id}
                type="button"
                role="tab"
                aria-selected={i === heroIdx}
                aria-label={h.name || `Property ${i + 1}`}
                className={`sbh-hero-dot${i === heroIdx ? " is-on" : ""}`}
                onClick={() => { setHeroIdx(i); setHeld(true); }}
              />
            ))}
            <span className="sbh-hero-count">
              {heroIdx + 1}/{Math.min(8, heroPool.length)} in season
            </span>
          </div>
        ) : null}
      </section>

      {/* ── LIVE TICKER — the one place auto-motion belongs: ambient, not a
          list of choices the user is trying to click. ─────────────────── */}
      {ticker.length ? (
        <div className="sbh-ticker" aria-hidden>
          <div className="sbh-ticker-track">
            {[0, 1].map((dup) => (
              <div className="sbh-ticker-group" key={dup}>
                {ticker.map((t, i) => (
                  <span className="sbh-ticker-item" key={`${dup}-${i}`}>{t}</span>
                ))}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* ── RAILS ────────────────────────────────────────────────────── */}
      <div className="sbh-rails">
        {deals.length ? (
          <Rail
            title="⚡ Flash Deals"
            sub={countdown ? `Resets in ${countdown} — live prices, limited rooms` : "Tonight only — live prices, limited rooms"}
            href="/flash-deals"
          >
            {deals.slice(0, 14).map((d) => <FlashCard key={d.id} d={d} left={countdown} />)}
          </Rail>
        ) : null}

        {reels.length ? (
          <Rail title="🎬 Reels" sub="Real stays, filmed by real guests" href="/discover" variant="tall">
            {reels.slice(0, 16).map((r, i) => (
              <ReelCard key={r.id} r={r} preview={wide} onOpen={() => setTheater(i)} />
            ))}
          </Rail>
        ) : null}

        {zoneRails.map((z) => (
          <Rail key={z.id} title={z.label} sub={`${z.items.length} propert${z.items.length === 1 ? "y" : "ies"}`} href="/hotels">
            {z.items.map((h) => <HotelCard key={h.id} h={h} score={scores[h.id]} />)}
          </Rail>
        ))}

        {/* Closing band. It sits AFTER every rail — the browse surfaces sell the
            stays, and this is the "so what do I do now" answer you land on once
            you've scrolled the lot. Full-bleed: the rails column has no
            max-width, and the gutter lives inside each child via --sbh-gut. */}
        <LiveBidding />

        {!hotels.length && !deals.length ? (
          <div className="sbh-loading">Loading your stage…</div>
        ) : null}
      </div>

      {theater != null ? (
        <ReelTheater
          reels={theaterReels}
          idx={theater}
          onIdx={setTheater}
          onClose={() => setTheater(null)}
          priceFor={priceForHotel}
        />
      ) : null}
    </div>
  );
}
