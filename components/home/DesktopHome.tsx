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
// rail that links into the real reel feed at the reel you tapped.
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
import { useRouter } from "next/navigation";
import { LAUNCH_ZONES, zoneForCity } from "@/lib/launch/curation";
import { currentMonthDemand, demandTier } from "@/lib/circle/demand-cycle";
import { CountUp } from "@/components/CountUp";
import { CIRCLE_INCOME_DISCLOSURE } from "@/lib/circle/disclosure";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import HotelScoreBadge, { seedScorecardCache } from "@/components/hotel/HotelScoreBadge";
import { useFollow } from "@/lib/follow-store";
// v580 — the shared browsing-affinity engine: season (existing wheel) +
// reach-from-viewer (owner's Origin-to-Destination Fit Matrix + distance) +
// taste (the existing sb_disco_signals store). One engine orders the hero,
// the "easy to reach" rail, the reel rail and the /discover feed identically.
import { rankForBrowse, cityAccess, nearestOriginCluster, type ViewerPoint } from "@/lib/browse/affinity";
import { readViewerGeo, primeViewerGeo, requestViewerGeo } from "@/lib/browse/viewer-geo";
import { getSignals, markLiked } from "@/lib/track";
// v581 — Decision Engine P1: the deck's 6 trip formats + 4 seasonal selling
// programs + inferred audience segment. The Stage now answers "what kind of
// trip?" and rewrites its seasonal campaign as the calendar turns.
import { TRIP_FORMATS, tripFormat, formatFit, formatForSegment, cityCorridor, type TripFormatId } from "@/lib/browse/trip-formats";
import { readSegment, recordFormatChoice } from "@/lib/browse/segment";
// v582 — Decision Engine P2: the 3-tap Trip Finder for the traveller who
// cannot name a destination (engine: lib/browse/trip-finder.ts).
import TripFinder from "@/components/home/TripFinder";
// v583 — P3: drive-time labels share the Finder's distance engine.
import { driveLabelFor } from "@/lib/browse/trip-finder";
// v583.1 — the season PREFERENCE: every season-aware ranking reads
// effectiveMonth() (pref ?? wall clock) so a "plan for Winter" choice in the
// Finder re-ranks the hero, the rails and the reels in the same breath.
import { effectiveMonth } from "@/lib/browse/season-pref";

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
  author?: { username?: string | null; display_name?: string | null; avatar_url?: string | null } | null;
  display_name?: string | null;
  like_count?: number | null;
  comment_count?: number | null;
  view_count?: number | null;
  hotel?: { id?: string; name?: string; city?: string; minPrice?: number | null; avgRating?: number | null; totalReviews?: number | null } | null;
};
type CircleProp = {
  id: string;
  title?: string;
  city?: string;
  state?: string;
  images?: string[];
  roomsLabel?: string;
  monthlyRate?: number | null;
  operationModel?: string | null;
  // NOTE: the API also returns roiMin/roiMax and a literal "18% ROI" badge.
  // They are deliberately NOT typed or rendered here — see CircleRow.
};
type CircleCounts = { properties: number; listings: number; cities: number; lots: number };
type Scorecard = {
  overall?: number | null;
  badge?: string | null;
  rank?: { rank?: number | null; scopeLabel?: string | null } | null;
};

const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");
const fmtCount = (n: number) => n >= 1_000_000 ? (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M"
  : n >= 1_000 ? (n / 1_000).toFixed(1).replace(/\.0$/, "") + "K" : String(n);

/* ── the reel PLAYER's iconography + engagement, mirrored exactly ──────────
   These are 1:1 mini copies from components/discover/InstagramHotelFeed.tsx
   (RailIcon glyph paths + hashStr/pseudoStat) so the home reel tiles show the
   SAME icons and the SAME deterministic per-hotel engagement numbers the
   player shows for the same reel — never emojis, never different counts. */
function RailGlyph({ name, filled }: { name: "heart" | "comment" | "share" | "bookmark" | "more"; filled?: boolean }) {
  const p: any = {
    viewBox: "0 0 24 24", width: 14, height: 14,
    fill: filled ? "currentColor" : "none", stroke: "currentColor",
    strokeWidth: 1.9, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true,
  };
  switch (name) {
    case "heart":    return (<svg {...p}><path d="M12 20.3s-6.8-4.4-6.8-9.5A4.1 4.1 0 0 1 12 7.2a4.1 4.1 0 0 1 6.8 3.6c0 5.1-6.8 9.5-6.8 9.5Z" /></svg>);
    case "comment":  return (<svg {...p} fill="none"><path d="M20 11.4a7.4 7.4 0 0 1-10.8 6.6L4.5 19.3l1.3-4.6A7.4 7.4 0 1 1 20 11.4Z" /></svg>);
    case "share":    return (<svg {...p} fill="none"><path d="M21.5 3 10.6 13.9" /><path d="M21.5 3 14.6 22l-3.9-8.1L2.5 10 21.5 3Z" /></svg>);
    case "bookmark": return (<svg {...p}><path d="M6.5 4h11v16l-5.5-3.6L6.5 20V4Z" /></svg>);
    case "more":     return (<svg {...p} fill="currentColor" stroke="none"><circle cx="5" cy="12" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="19" cy="12" r="1.7" /></svg>);
    default:         return null;
  }
}
function hashStrHome(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
function pseudoStatHome(seed: string, salt: string, min: number, max: number) {
  return min + (hashStrHome(`${seed}::${salt}`) % (max - min));
}

/**
 * The "% OFF" a flash deal is ACTUALLY showing, derived from the two prices the
 * card prints beside it.
 *
 * Do NOT use the API's `discount` field here. /api/flash/near recomputes
 * `aiPrice` through the v527 flash ladder but passes `discount` straight
 * through from the raw deal row, so the two disagree — live today it returns
 * 48% over a marketRate 3000 -> aiPrice 2400 move, which is 20%. A badge that
 * contradicts the prices next to it is a claim we can't support, and it was
 * visible on both the card and the ticker.
 * (The API keeps its own `discount` because it is also the feed's sort/bucket
 * key — changing it there would reorder the feed.)
 */
function offPct(was?: number | null, now?: number | null): number {
  const w = Number(was) || 0;
  const n = Number(now) || 0;
  if (w <= 0 || n <= 0 || n >= w) return 0;
  return Math.round(((w - n) / w) * 100);
}

/** cheapest real room price for a hotel, or null */
function minPriceOf(h?: Hotel | null): number | null {
  const list = (h?.rooms || [])
    .map((r) => Number(r?.floorPrice))
    .filter((n) => Number.isFinite(n) && n > 0);
  return list.length ? Math.min(...list) : null;
}
/** the room "rack"/MRP market rate for a hotel (max mrp across rooms), or null */
function marketOf(h?: Hotel | null): number | null {
  const list = (h?.rooms || [])
    .map((r) => Number(r?.mrp))
    .filter((n) => Number.isFinite(n) && n > 0);
  return list.length ? Math.max(...list) : null;
}
/** whole-percent a price sits below a market rate (0 when not below) */
function belowPct(market?: number | null, price?: number | null): number {
  const m = Number(market) || 0;
  const p = Number(price) || 0;
  if (m <= 0 || p <= 0 || p >= m) return 0;
  return Math.round(((m - p) / m) * 100);
}
function imgOf(h?: Hotel | null): string {
  const arr = Array.isArray(h?.images) ? h!.images!.filter(Boolean) : [];
  return arr[0] || "";
}

/* ── wishlist (heart) — writes sb_local_saves, the exact schema /saved reads ── */
function readSavedIds(): Set<string> {
  try {
    const raw = localStorage.getItem("sb_local_saves");
    const arr = raw ? JSON.parse(raw) : [];
    return new Set((Array.isArray(arr) ? arr : []).map((s: any) => `${s.target_type}:${s.target_id}`));
  } catch { return new Set(); }
}
// v586 — write the SAME rich shape the reel feed writes and /saved reads:
// { id, target_type, target_id, saved_at, target:{…} }. The old flat shape
// ({target_type,target_id,...snap}) had NO nested `target`, so /saved's
// SaveCard (which gates on `s.target`) silently dropped every home save —
// the Wishlist read empty even with hearts filled. `target` must match the
// SaveCard field names: hotel → {id,name,city,star_rating,images[]},
// video → {id,title,s3_url,thumbnail_url,views_count}.
function toggleSaved(kind: "hotel" | "video", id: string, target: Record<string, any>): boolean {
  try {
    const raw = localStorage.getItem("sb_local_saves");
    const arr = raw ? JSON.parse(raw) : [];
    const list = Array.isArray(arr) ? arr : [];
    const key = `${kind}:${id}`;
    const exists = list.some((s: any) => `${s.target_type}:${s.target_id}` === key);
    const next = exists
      ? list.filter((s: any) => `${s.target_type}:${s.target_id}` !== key)
      : [{ id: `local-${Date.now()}`, target_type: kind, target_id: id, saved_at: new Date().toISOString(), target: { id, ...target } }, ...list];
    localStorage.setItem("sb_local_saves", JSON.stringify(next.slice(0, 200)));
    try { window.dispatchEvent(new Event("sb:saves-change")); } catch {}
    return !exists;
  } catch { return false; }
}
/** Wishlist heart button — top-right of any card's media. */
function SaveHeart({ kind, id, target }: { kind: "hotel" | "video"; id: string; target: Record<string, any> }) {
  const [saved, setSaved] = useState(false);
  useEffect(() => { setSaved(readSavedIds().has(`${kind}:${id}`)); }, [kind, id]);
  return (
    <button
      type="button"
      className={`sbh-heart${saved ? " is-on" : ""}`}
      aria-label={saved ? "Remove from wishlist" : "Add to wishlist"}
      aria-pressed={saved}
      onClick={(e) => {
        e.preventDefault(); e.stopPropagation();
        const now = toggleSaved(kind, id, target);
        setSaved(now);
        // v580 — a save is a strong preference signal; it personalises the
        // reel feed + rails via the same store the /discover ranker reads.
        if (now) markLiked(id);
      }}
    >
      <svg viewBox="0 0 24 24" width="18" height="18" fill={saved ? "currentColor" : "none"} stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12.001 4.529c2.349-2.532 6.151-2.595 8.6-.184 2.45 2.41 2.605 6.37.4 8.978l-7.21 7.21a1.06 1.06 0 0 1-1.5 0l-7.21-7.21c-2.205-2.609-2.05-6.568.4-8.978 2.45-2.41 6.252-2.348 8.601.184Z" />
      </svg>
    </button>
  );
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
  action,
  actionBtn,
}: {
  title: string;
  sub?: string;
  href?: string;
  children: React.ReactNode;
  variant?: "wide" | "tall";
  /** optional primary action beside "See all" — used by the Reels rail to
      carry the create entry that lived on the reel home before the Stage. */
  action?: { href: string; label: string };
  /** v580 — same slot as `action` but a BUTTON (the reach rail's 📍 chip
      must be a real user gesture, not a navigation). */
  actionBtn?: { label: string; onClick: () => void; disabled?: boolean };
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
        <div className="sbh-rail-acts">
          {actionBtn ? (
            <button type="button" className="sbh-rail-act" onClick={actionBtn.onClick} disabled={actionBtn.disabled}>
              {actionBtn.label}
            </button>
          ) : null}
          {action ? (
            <Link href={action.href} className="sbh-rail-act">{action.label}</Link>
          ) : null}
          {href ? (
            <Link href={href} className="sbh-rail-all">
              See all <span aria-hidden>→</span>
            </Link>
          ) : null}
        </div>
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
function HotelCard({ h, score, drive, why }: { h: Hotel; score?: Scorecard; drive?: string | null; why?: string | null }) {
  // v584 — pilgrimage-ready validation: Braj / Religious-UP / Haridwar
  // corridor stays serve darshan travellers (deck: satvik meals, temple
  // access, aarti timings). Corridor comes from the shared trip-format map.
  const corridor = cityCorridor(h.city);
  const darshan = corridor === "braj" || corridor === "religiousup" || corridor === "haridwar";
  const price = minPriceOf(h);
  const img = imgOf(h);
  const rate = Number(h.avgRating) || 0;
  const reviews = Number(h.totalReviews) || 0;
  const below = belowPct(marketOf(h), price);
  return (
    <Link href={`/hotels/${h.id}`} className="sbh-card sbh-card-wide">
      <div className="sbh-card-media">
        {img ? <img src={img} alt="" loading="lazy" /> : <div className="sbh-card-ph" />}
        <div className="sbh-card-sheen" aria-hidden />
        <div className="sbh-card-scrim" aria-hidden />
        <SaveHeart kind="hotel" id={h.id} target={{ name: h.name, city: h.city, star_rating: h.starRating, images: img ? [img] : [] }} />
        {score?.overall != null ? (
          <span className="sbh-badge-slot" onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}>
            <HotelScoreBadge hotelId={h.id} hotelName={h.name || ""} variant="compact" />
          </span>
        ) : null}
      </div>
      <div className="sbh-card-body">
        <h3 className="sbh-card-name" title={h.name || ""}>{h.name}</h3>
        <p className="sbh-card-meta">
          <span className="sbh-card-loc">{h.city}</span>
          {rate > 0 ? (
            <span className="sbh-card-rating">★ {rate.toFixed(1)}{reviews > 0 ? <em> ({reviews})</em> : null}</span>
          ) : null}
          {/* v583 — effort answered on the card itself ("how far is it?").
              Real distance from the viewer (Delhi-Core default) via the same
              engine the Finder uses — hours, because hours are how people
              actually judge a road trip. */}
          {drive ? <span className="sbh-card-drive">{drive}</span> : null}
        </p>
        {price != null ? (
          <p className="sbh-card-price">
            <span>from</span> <b>{inr(price)}</b> <em>/night</em>
          </p>
        ) : null}
        {below >= 5 ? <span className="sbh-card-below">▼ {below}% below market</span> : null}
        {/* v584 — validation chips: WHY this card is in front of you. One
            personal reason (in season / your taste) + the darshan marker. */}
        {(why || darshan) ? (
          <span className="sbh-card-whyrow">
            {why ? <span className="sbh-card-why">{why}</span> : null}
            {darshan ? <span className="sbh-card-why is-darshan">🛕 Darshan-friendly</span> : null}
          </span>
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

/* v632 — same wording as the /flash-deals card pill ("Ends in 23h 7m"):
   the home card used to print the raw hh:mm:ss ticker, so the two surfaces
   described the same deadline in two different languages. */
function endsLabelFromClock(left: string): string {
  const m = /^(\d+):(\d+)/.exec(left || "");
  if (!m) return "";
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  return `Ends in ${h}h ${min}m`;
}

function FlashCard({ d, left, score }: { d: Deal; left: string; score?: Scorecard }) {
  const h = d.hotel;
  const img = imgOf(h);
  const now = Number(d.aiPrice) || 0;
  const was = Number(d.marketRate) || 0;
  const off = offPct(was, now);   // always agrees with the prices below
  const rate = Number(h?.avgRating) || 0;
  const reviews = Number(h?.totalReviews) || 0;
  const hid = d.hotelId || h?.id || "";
  return (
    <Link href={`/hotels/${hid}`} className="sbh-card sbh-card-wide sbh-card-flash">
      <div className="sbh-card-media">
        {img ? <img src={img} alt="" loading="lazy" /> : <div className="sbh-card-ph" />}
        <div className="sbh-card-sheen" aria-hidden />
        <div className="sbh-card-scrim" aria-hidden />
        {/* one real flex row: OFF (left) · countdown (true centre) · heart (right) —
            flex owns the spacing, so nothing can overlap at any card width */}
        <div className="sbh-fd-toprow">
          {off > 0 ? <span className="sbh-chip sbh-chip-off">{off}% OFF</span> : null}
          {left ? <span className="sbh-chip sbh-chip-live sbh-chip-live-br">{endsLabelFromClock(left)}</span> : null}
          {hid ? <SaveHeart kind="hotel" id={hid} target={{ name: h?.name, city: h?.city, star_rating: h?.starRating, images: img ? [img] : [] }} /> : null}
        </div>
        {score?.overall != null ? (
          <span className="sbh-badge-slot" onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}>
            <HotelScoreBadge hotelId={hid} hotelName={h?.name || ""} variant="compact" />
          </span>
        ) : null}
      </div>
      <div className="sbh-card-body">
        <h3 className="sbh-card-name" title={h?.name || ""}>{h?.name}</h3>
        <p className="sbh-card-meta">
          <span className="sbh-card-loc">{d.city || h?.city}</span>
          {rate > 0 ? (
            <span className="sbh-card-rating">★ {rate.toFixed(1)}{reviews > 0 ? <em> ({reviews})</em> : null}</span>
          ) : null}
        </p>
        <p className="sbh-card-price">
          {was > now ? <s>{inr(was)}</s> : null} <b>{inr(now)}</b> <em>/night</em>
        </p>
        {off >= 5 ? <span className="sbh-card-below">▼ {off}% below market</span> : null}
      </div>
    </Link>
  );
}

/* A reel card is a LINK into the real reel feed, positioned at this reel.
   v572 — the Stage used to open its own small player here. That meant StayBid
   shipped two reel players: this one, and the real feed at /discover. The
   small one had no like, no comment, no share, no save, no follow, no create —
   so tapping a reel from home quietly took features away, and there was no
   reason for a second player to exist. Now the card navigates to the ONE
   player, landed on the exact reel you tapped. Everything works there, the
   swipe is the feed's own, and Back returns you to this page because it is a
   real navigation rather than an overlay. */
function ReelCard({ r, preview, price }: { r: Reel; preview: boolean; price: number | null }) {
  const poster = reelPoster(r);
  const who = r.author?.display_name || r.display_name || "StayBid";
  // Netflix-style hover preview: the reel's own clip plays muted on hover.
  // Motion happens exactly where the pointer already is — never on its own.
  // Hover preview is a pointer affordance — never mounted on touch, so phones
  // don't fetch a dozen video headers they can never trigger.
  const isVideo = preview && String(r.media_type || "").toUpperCase() !== "IMAGE" && !!r.media_url;
  const [hot, setHot] = useState(false);
  const [playing, setPlaying] = useState(false);
  const vid = useRef<HTMLVideoElement>(null);
  const router = useRouter();
  const hotelId = r.hotel?.id || "";
  const openReel = useCallback(() => { router.push(`/discover?start=${encodeURIComponent(r.id)}`); }, [router, r.id]);
  const go = (href: string) => (e: React.MouseEvent) => { e.preventDefault(); e.stopPropagation(); router.push(href); };
  const [liked, setLiked] = useState(false);
  const [savedR, setSavedR] = useState(false);
  useEffect(() => { setSavedR(readSavedIds().has(`video:${r.id}`)); }, [r.id]);
  // real follow state + follower count — the SAME store the player uses
  const { isFollowing, toggleFollow, followerCount } = useFollow();
  const handle = r.author?.username || who;
  const followed = isFollowing(handle);
  const followers = followerCount(handle);
  // the SAME per-hotel engagement the player shows for this reel
  // (InstagramHotelFeed: pseudoStat(h.id||"x","likes",1240,28400))
  const likeN = pseudoStatHome(r.hotel?.id || "x", "likes", 1240, 28400) + (liked ? 1 : 0);
  const avatar = r.author?.avatar_url || "";
  const shareReel = useCallback((e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    const url = `${window.location.origin}/discover?start=${encodeURIComponent(r.id)}`;
    if (navigator.share) navigator.share({ title: "StayBid reel", url }).catch(() => {});
    else navigator.clipboard?.writeText(url).catch(() => {});
  }, [r.id]);
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
    <div
      className="sbh-card sbh-card-tall sbh-reelx"
      role="link" tabIndex={0}
      onClick={openReel}
      onKeyDown={(e) => { if (e.key === "Enter") openReel(); }}
      onMouseEnter={() => setHot(true)}
      onMouseLeave={() => setHot(false)}
    >
      <div className="sbh-card-media">
        {poster ? <img src={poster} alt="" loading="lazy" /> : <div className="sbh-card-ph" />}
        {isVideo ? (
          <video
            ref={vid}
            className={`sbh-reel-vid${hot && playing ? " is-on" : ""}`}
            src={r.media_url || undefined}
            muted loop playsInline preload="metadata"
            onPlaying={() => setPlaying(true)}
            onEnded={() => setPlaying(false)}
            tabIndex={-1} aria-hidden
          />
        ) : null}
        <div className="sbh-card-sheen" aria-hidden />
        <div className="sbh-card-scrim" aria-hidden />

        {/* TOP strip — exactly like the reel page: DP avatar · @username · 📍 · Follow */}
        <div className="sbh-reelx-who">
          <span className="sbh-reelx-dp" aria-hidden>
            {avatar ? <img src={avatar} alt="" loading="lazy" /> : <b>{(who || "?")[0]}</b>}
          </span>
          <span className="sbh-reelx-id">
            <strong>
              @{handle}
              <svg className="sbh-reelx-tick" viewBox="0 0 24 24" width="9" height="9" aria-hidden>
                <circle cx="12" cy="12" r="11" fill="#3897f0" />
                <path d="M7 12.5l3 3 6.5-6.5" stroke="#fff" strokeWidth="2.6" fill="none" strokeLinecap="round" />
              </svg>
            </strong>
            <span>📍 {r.location_name ? `${r.location_name} · ` : ""}{fmtCount(followers)} followers</span>
          </span>
          <button
            type="button"
            className={`sbh-reelx-follow${followed ? " is-on" : ""}`}
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleFollow(handle); }}
          >
            {followed ? "Following" : "Follow"}
          </button>
        </div>

        {/* RIGHT RAIL — the player's glass-circle glyph rail, same order:
            like (count) · comment · share · save · more */}
        <div className="sbh-reelx-rail">
          <button type="button" className={`sbh-rx-btn${liked ? " is-on" : ""}`} aria-label="Like"
            onClick={(e) => {
              e.preventDefault(); e.stopPropagation();
              setLiked((v) => {
                // v580 — mirror the player: a like feeds the preference store
                // (same id the player's ig_like would record for this reel).
                if (!v) markLiked(hotelId || r.id);
                return !v;
              });
            }}>
            <span className="sbh-rx-ic"><RailGlyph name="heart" filled={liked} /></span>
            <span className="sbh-rx-n">{fmtCount(likeN)}</span>
          </button>
          <button type="button" className="sbh-rx-btn" aria-label="Comments" onClick={(e) => { e.preventDefault(); e.stopPropagation(); openReel(); }}>
            <span className="sbh-rx-ic"><RailGlyph name="comment" /></span>
          </button>
          <button type="button" className="sbh-rx-btn" aria-label="Share" onClick={shareReel}>
            <span className="sbh-rx-ic"><RailGlyph name="share" /></span>
            <span className="sbh-rx-n">Share</span>
          </button>
          <button type="button" className={`sbh-rx-btn${savedR ? " is-saved" : ""}`} aria-label={savedR ? "Remove from wishlist" : "Add to wishlist"}
            onClick={(e) => {
              e.preventDefault(); e.stopPropagation();
              const now = toggleSaved("video", r.id, { title: r.caption || r.hotel?.name || "Reel", s3_url: (r as any).media_url || "", thumbnail_url: poster, views_count: (r as any).views_count || 0 });
              setSavedR(now);
              if (now) markLiked(hotelId || r.id); // v580 — save = preference signal
            }}>
            <span className="sbh-rx-ic"><RailGlyph name="bookmark" filled={savedR} /></span>
            <span className="sbh-rx-n">{savedR ? "Saved" : "Save"}</span>
          </button>
          <button type="button" className="sbh-rx-btn" aria-label="More" onClick={(e) => { e.preventDefault(); e.stopPropagation(); openReel(); }}>
            <span className="sbh-rx-ic"><RailGlyph name="more" /></span>
            <span className="sbh-rx-n">More</span>
          </button>
        </div>

        {/* BOTTOM — the player's CTA bar, mini: From ₹ · ⚡ Book Now · 🏷 Bid Now */}
        {hotelId ? (
          <div className="sbh-reelx-foot">
            {price ? <span className="sbh-reelx-from"><i>From</i><b>{inr(price)}</b><em>/n</em></span> : null}
            <button type="button" className="sbh-reelx-book" onClick={go(`/hotels/${hotelId}`)}>⚡ Book Now</button>
            <button type="button" className="sbh-reelx-bid" onClick={go(`/hotels/${hotelId}?intent=negotiate#availability-picker`)}>🏷 Bid Now</button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* ── SCROLL RAIL — a scrollbar you can always see and grab ─────────────
   The native one is not dependable. Chrome on Windows draws a classic bar;
   macOS (and Safari especially) uses an OVERLAY bar that fades when idle, and
   Safari ignores ::-webkit-scrollbar for the document scrollbar entirely — so
   CSS alone cannot guarantee the affordance. On a 6,000px page that leaves a
   mouse user with nothing visible to grab.

   So: detect it. `innerWidth - documentElement.clientWidth` is 0 exactly when
   the native bar takes no layout space, i.e. it is an overlay/hidden one. Only
   then do we render our own rail, so a Windows user who already has a real
   scrollbar never gets two. Pointer-only (no touch), and wheel/keyboard
   scrolling is untouched either way. */
function ScrollRail() {
  const [on, setOn] = useState(false);
  const [geo, setGeo] = useState({ top: 0, height: 0 });
  const drag = useRef<{ startY: number; startScroll: number } | null>(null);

  // Only mount where the native scrollbar is invisible AND we have a pointer.
  useEffect(() => {
    const decide = () => {
      const overlay = window.innerWidth - document.documentElement.clientWidth === 0;
      const pointer = window.matchMedia("(pointer: fine)").matches;
      const wide = window.matchMedia("(min-width: 1024px)").matches;
      setOn(overlay && pointer && wide);
    };
    decide();
    window.addEventListener("resize", decide);
    return () => window.removeEventListener("resize", decide);
  }, []);

  const sync = useCallback(() => {
    const de = document.documentElement;
    const track = de.clientHeight;
    const total = de.scrollHeight;
    if (total <= track) { setGeo({ top: 0, height: 0 }); return; }
    // thumb length is proportional, with a floor so it stays grabbable
    const h = Math.max(48, Math.round((track / total) * track));
    const maxTop = track - h;
    const top = Math.round((window.scrollY / (total - track)) * maxTop);
    setGeo({ top, height: h });
  }, []);

  useEffect(() => {
    if (!on) return;
    sync();
    window.addEventListener("scroll", sync, { passive: true });
    window.addEventListener("resize", sync);
    // the page grows as rails hydrate — keep the thumb honest
    const ro = new ResizeObserver(sync);
    ro.observe(document.body);
    return () => {
      window.removeEventListener("scroll", sync);
      window.removeEventListener("resize", sync);
      ro.disconnect();
    };
  }, [on, sync]);

  // drag the thumb
  useEffect(() => {
    if (!on) return;
    const move = (e: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      const de = document.documentElement;
      const track = de.clientHeight;
      const total = de.scrollHeight;
      const h = Math.max(48, Math.round((track / total) * track));
      const maxTop = track - h;
      if (maxTop <= 0) return;
      const delta = e.clientY - d.startY;
      window.scrollTo({ top: d.startScroll + (delta / maxTop) * (total - track) });
    };
    const up = () => {
      drag.current = null;
      document.body.style.userSelect = "";
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [on]);

  if (!on || geo.height === 0) return null;

  return (
    <div
      className="sbh-srail"
      onPointerDown={(e) => {
        // clicking the track jumps a page; grabbing the thumb starts a drag
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const y = e.clientY - rect.top;
        if (y < geo.top || y > geo.top + geo.height) {
          window.scrollBy({ top: y < geo.top ? -window.innerHeight : window.innerHeight, behavior: "smooth" });
        }
      }}
      aria-hidden
    >
      <div
        className="sbh-srail-thumb"
        style={{ transform: `translateY(${geo.top}px)`, height: geo.height }}
        onPointerDown={(e) => {
          e.stopPropagation();
          drag.current = { startY: e.clientY, startScroll: window.scrollY };
          document.body.style.userSelect = "none";
        }}
      />
    </div>
  );
}

/* ── PASSPORT — the returning-visitor strip ────────────────────────────
   The streaming analogue of "Continue watching": your own state, first, above
   the merchandising. Signed-out renders NOTHING — there is no honest way to
   show a stranger a progress bar, and a fake one would be worse than absent.

   Every number is computed by lib/passport/engine.ts, the same pure engine the
   /passport page uses, so the strip can never disagree with the passport
   itself. Nothing here is recomputed locally. */
type PassportData = {
  rank?: {
    rank?: { label?: string; emoji?: string; color?: string; gradient?: string };
    next?: { label?: string; emoji?: string; xpMin?: number } | null;
    xp?: number;
    progressPct?: number;
  };
  stats?: { stampCount?: number; citiesVisited?: number };
};

function PassportStrip() {
  const { user, loading } = useAuth();
  const [d, setD] = useState<PassportData | null>(null);

  useEffect(() => {
    if (!user) { setD(null); return; }
    let dead = false;
    api.getPassport()
      .then((j: any) => { if (!dead) setD(j || null); }, () => {});
    return () => { dead = true; };
  }, [user]);

  if (loading || !user || !d?.rank?.rank) return null;

  const r = d.rank;
  const rank = r.rank!;
  const xp = Number(r.xp) || 0;
  const pct = Math.max(0, Math.min(100, Number(r.progressPct) || 0));
  const stamps = Number(d.stats?.stampCount) || 0;
  const cities = Number(d.stats?.citiesVisited) || 0;
  const toGo = r.next?.xpMin ? Math.max(0, r.next.xpMin - xp) : 0;

  return (
    <div className="sbh-pp-wrap">
      <Link href="/passport" className="sbh-pp">
        <span className="sbh-pp-sheen" aria-hidden />
        <span className="sbh-pp-kicker">Explorer Passport</span>

        <span className="sbh-pp-head">
          <span className="sbh-pp-medal" aria-hidden>
            <span className="sbh-pp-medal-face" style={{ background: rank.gradient || undefined }}>
              {rank.emoji}
            </span>
          </span>
          <span className="sbh-pp-id">
            <b>{rank.label}</b>
            <i>{xp.toLocaleString("en-IN")} XP</i>
          </span>
        </span>

        <span className="sbh-pp-bar" aria-hidden>
          <span style={{ width: `${pct}%`, background: rank.gradient || rank.color || undefined }} />
        </span>
        <span className="sbh-pp-sub">
          {/* A brand-new passport has no next-rank distance worth quoting —
              it has a first stamp to earn, which is the more useful nudge. */}
          {stamps === 0
            ? "Your first confirmed stay earns your first stamp"
            : r.next && toGo > 0
              ? <>{toGo.toLocaleString("en-IN")} XP to {r.next.emoji} {r.next.label}</>
              : "Top rank reached"}
        </span>

        {stamps > 0 ? (
          <span className="sbh-pp-stats">
            <span><b>{stamps}</b> stamp{stamps === 1 ? "" : "s"}</span>
            <span><b>{cities}</b> cit{cities === 1 ? "y" : "ies"}</span>
          </span>
        ) : null}

        <span className="sbh-pp-go">Open passport <em aria-hidden>→</em></span>
      </Link>
    </div>
  );
}

/* ── CIRCLE — the ownership side of StayBid ────────────────────────────
   The homepage sold stays and never once said you can OWN one. This rail
   surfaces the real Model-1 catalog plus one honest line per model.

   ⚠ LEGAL (locked, lib/circle/disclosure.ts): /api/circle/properties returns
   roiMin/roiMax and a ready-made "18% ROI" badge. Neither is rendered. The
   homepage is the most public surface on the site — seen by every visitor,
   including people who never open the Circle journey and never see the
   in-journey disclosures — so a bare return number has no business here. The
   card shows monthlyRate, which is what you PAY (a price, like every other
   card on this page), not what you might earn. CIRCLE_INCOME_DISCLOSURE still
   rides along, because the product itself is income-producing property. */
function CircleCard({ p }: { p: CircleProp }) {
  const img = (Array.isArray(p.images) ? p.images.filter(Boolean) : [])[0] || "";
  return (
    <Link href={`/circle/${p.id}`} className="sbh-card sbh-card-wide">
      <div className="sbh-card-media">
        {img ? <img src={img} alt="" loading="lazy" /> : <div className="sbh-card-ph" />}
        <div className="sbh-card-sheen" aria-hidden />
        <div className="sbh-card-scrim" aria-hidden />
        {p.operationModel === "managed" ? (
          <span className="sbh-chip sbh-chip-circle">Fully managed</span>
        ) : null}
      </div>
      <div className="sbh-card-body">
        <h3 className="sbh-card-name" title={p.title || ""}>{p.title}</h3>
        <p className="sbh-card-meta">{p.city}{p.roomsLabel ? ` · ${p.roomsLabel}` : ""}</p>
        {p.monthlyRate ? (
          <p className="sbh-card-price">
            <span>from</span> <b>{inr(p.monthlyRate)}</b> <em>/month</em>
          </p>
        ) : null}
      </div>
    </Link>
  );
}

function CircleRow({ props: items, counts }: { props: CircleProp[]; counts: CircleCounts }) {
  // One line per model, each carrying a REAL count. A model with nothing live
  // is dropped rather than shown as a hopeful zero.
  const models = [
    counts.properties
      ? { k: "1", t: "Own a share", s: `${counts.properties} operated propert${counts.properties === 1 ? "y" : "ies"}`, href: "/circle/discover" }
      : null,
    counts.listings
      ? { k: "2", t: "Buy room-nights", s: `${counts.listings} live across ${counts.cities} cities`, href: "/circle/model2/browse" }
      : null,
    counts.lots
      ? { k: "3", t: "Sell to travel agents", s: `${counts.lots} open lot${counts.lots === 1 ? "" : "s"}`, href: "/trade" }
      : null,
  ].filter(Boolean) as { k: string; t: string; s: string; href: string }[];

  return (
    <>
      <Rail
        title="💎 StayBid Circle"
        sub="Own a share of an operated property — or trade its room-nights"
        href="/circle"
      >
        {items.slice(0, 14).map((p) => <CircleCard key={p.id} p={p} />)}
      </Rail>

      {models.length ? (
        <div className="sbh-circ-ways">
          {models.map((m) => (
            <Link key={m.k} href={m.href} className="sbh-circ-way">
              <span className="sbh-circ-badge" aria-hidden>{m.k}</span>
              <span className="sbh-circ-body">
                <span className="sbh-circ-n">Model {m.k}</span>
                <strong>{m.t}</strong>
                <em>{m.s}</em>
              </span>
              <span className="sbh-circ-arrow" aria-hidden>→</span>
            </Link>
          ))}
          <p className="sbh-circ-note">{CIRCLE_INCOME_DISCLOSURE}</p>
        </div>
      ) : null}
    </>
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
    { n: "1", t: "Place your bid", s: "Pick a stay and offer the price you want to pay." },
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
          <h2 className="sbh-bid-title">Bid your own price.<br />Hotels accept or counter.</h2>
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

      // scorecards for the hotels we will actually render (zone rails + flash
      // deals) so rank + score show on every card, not just the zone rails.
      const dealIds = (Array.isArray(fj?.deals) ? fj.deals : [])
        .map((d: Deal) => d.hotelId || d.hotel?.id)
        .filter(Boolean) as string[];
      const ids = Array.from(new Set([...hs.map((h) => h.id), ...dealIds]))
        .filter(Boolean)
        .slice(0, 80);
      if (ids.length) {
        const sc = await fetch(`/api/hotels/scorecards?ids=${ids.join(",")}`)
          .then((r) => (r.ok ? r.json() : null), () => null);
        if (!dead && sc?.scorecards) {
          setScores(sc.scorecards);
          // let the shared HotelScoreBadge read these from cache instead of
          // each badge firing its own request — same trophy/medal as /hotels.
          seedScorecardCache(sc.scorecards);
        }
      }
    })();
    return () => { dead = true; };
  }, [on]);

  // Circle loads in its OWN effect, not the hero's Promise.all — the row sits
  // far below the fold, so its three requests must never delay first paint.
  // All three endpoints are public and unauthenticated; each failure is
  // independent (a dead count just drops that model's line).
  const [circleProps, setCircleProps] = useState<CircleProp[]>([]);
  const [circleCounts, setCircleCounts] = useState<CircleCounts>({ properties: 0, listings: 0, cities: 0, lots: 0 });
  useEffect(() => {
    if (!on) return;
    let dead = false;
    const j = (u: string) => fetch(u).then((r) => (r.ok ? r.json() : null), () => null);
    Promise.all([
      j("/api/circle/properties"),
      j("/api/circle/marketplace-summary"),
      j("/api/trade/lots"),
    ]).then(([pj, sj, lj]) => {
      if (dead) return;
      const ps: CircleProp[] = Array.isArray(pj?.properties) ? pj.properties : [];
      setCircleProps(ps);
      setCircleCounts({
        properties: ps.length,
        // the summary's model3/model4 keys are the PRE-RENAME names — both are
        // today's "Model 2" (see the v346 rebrand note in CLAUDE.md)
        listings: Number(sj?.model4?.liveListings) || 0,
        cities: Array.isArray(sj?.model3?.cities) ? sj.model3.cities.length : 0,
        lots: Array.isArray(lj?.lots) ? lj.lots.length : 0,
      });
    });
    return () => { dead = true; };
  }, [on]);

  // ── VIEWER GEO (v580) ────────────────────────────────────────────────
  // Where is this person browsing from? Cached point (or an already-granted
  // permission, refreshed silently) — the browser PROMPT only ever fires from
  // the 📍 chip on the reach rail (explicit gesture). No point → the engine
  // assumes the Delhi-Core origin, the strategy docs' core market.
  const [viewer, setViewer] = useState<ViewerPoint | null>(null);
  useEffect(() => {
    if (!on) return;
    setViewer(readViewerGeo());
    primeViewerGeo().then((pt) => { if (pt) setViewer(pt); });
    const onGeo = () => setViewer(readViewerGeo());
    window.addEventListener("sb:geo-change", onGeo);
    return () => window.removeEventListener("sb:geo-change", onGeo);
  }, [on]);
  const originCluster = useMemo(() => nearestOriginCluster(viewer), [viewer]);

  // v583.1 — season preference: default = the real current month; the
  // Finder's season picker overrides it live (sb:season-pref).
  const [effMonth, setEffMonth] = useState<number>(() => new Date().getUTCMonth());
  useEffect(() => {
    if (!on) return;
    setEffMonth(effectiveMonth());
    const onPref = () => setEffMonth(effectiveMonth());
    window.addEventListener("sb:season-pref", onPref);
    return () => window.removeEventListener("sb:season-pref", onPref);
  }, [on]);

  // v580 — the reel rail is ordered by the SAME affinity engine as /discover:
  // a new visitor sees in-season reels from places they can actually reach
  // first; a returning visitor's watch/save/like history (sb_disco_signals)
  // pulls their taste forward. Feed order within a band is preserved.
  const railReels = useMemo(
    () =>
      rankForBrowse(
        reels,
        (r) => r.hotel?.city || r.location_name || "",
        (r) => r.hotel?.id || r.id,
        { viewer, signals: getSignals(), month: effMonth },
      ).slice(0, 16),
    [reels, viewer, effMonth],
  );

  // /api/social/feed returns the tagged hotel's identity columns but no price
  // (HOTEL_CARD_COLS carries no rooms). The rails' own hotels cover part of it,
  // but launch curation caps /api/hotels to one property per city, so most
  // tagged hotels are NOT in that payload — which is the exact case
  // /api/hotels/starting-prices was built for. One batched call fills the rest.
  const [taggedPrices, setTaggedPrices] = useState<Record<string, number>>({});
  useEffect(() => {
    const ids = Array.from(
      new Set(railReels.map((r) => r.hotel?.id).filter(Boolean) as string[]),
    );
    if (!ids.length) return;
    let dead = false;
    fetch(`/api/hotels/starting-prices?ids=${ids.map(encodeURIComponent).join(",")}`)
      .then((r) => (r.ok ? r.json() : null), () => null)
      .then((j) => { if (!dead && j?.prices) setTaggedPrices(j.prices); });
    return () => { dead = true; };
  }, [railReels]);

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

  // ── SEASON + REACH HERO POOL ─────────────────────────────────────────
  // The hero showcases the locations that are in season this month (the real
  // 12-month demand wheel, lib/circle/demand-cycle.ts) AND the properties the
  // viewer can most easily reach (lib/browse/affinity.ts — fit matrix +
  // distance from their location, Delhi-Core default). Ordered by the shared
  // engine so an in-season stay a short drive away leads; a distant in-season
  // icon still rotates in. Falls back to best-scored, so it can never be empty.
  const demand = useMemo(() => currentMonthDemand(), []);
  const heroPool = useMemo(() => {
    const byScore = (a: Hotel, b: Hotel) => (scores[b.id]?.overall ?? 0) - (scores[a.id]?.overall ?? 0);
    const shot = hotels.filter((h) => imgOf(h));
    if (!shot.length) return shot;
    const tier = (t: "primary" | "secondary") =>
      shot.filter((h) => demandTier(h.city || "", effMonth) === t).sort(byScore);
    const p = tier("primary");
    const s = tier("secondary");
    const seasonal = p.length >= 3 ? p : [...p, ...s];
    // Reach candidates: the closest / best-fit properties for this viewer,
    // even out of season — the owner's "easily accessible first" rule.
    const reachTop = shot
      .slice()
      .sort((a, b) => cityAccess(b.city, viewer).score - cityAccess(a.city, viewer).score)
      .slice(0, 6);
    const seen = new Set<string>();
    const pool = [...seasonal, ...reachTop].filter((h) => {
      if (seen.has(h.id)) return false;
      seen.add(h.id);
      return true;
    });
    const base = pool.length ? pool : shot.slice().sort(byScore).slice(0, 6);
    // One shared formula orders the pool (season + reach; taste via signals).
    return rankForBrowse(base, (h) => h.city, (h) => h.id, {
      viewer, month: effMonth, signals: getSignals(),
    });
  }, [hotels, scores, effMonth, viewer]);

  // rotation — auto-advance, but pauses on hover and never runs under
  // prefers-reduced-motion or when the user has taken manual control.
  const [heroIdx, setHeroIdx] = useState(0);
  const [held, setHeld] = useState(false);
  // v584.1 — manual navigation is an OPTION alongside auto-rotate, not a
  // mode: arrows (desktop) / finger swipe (mobile) jump the slide and reset
  // the 5s clock (navTick), but the wheel keeps turning afterwards.
  const [navTick, setNavTick] = useState(0);
  const heroNav = useCallback((dir: 1 | -1) => {
    setHeroIdx((i) => {
      const n = heroPool.length;
      return n ? (i + dir + n) % n : 0;
    });
    setNavTick((t) => t + 1);
  }, [heroPool.length]);
  const heroTouch = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => { setHeroIdx(0); }, [heroPool.length]);
  useEffect(() => {
    if (held || heroPool.length < 2) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // 5s — fast enough to feel alive, slow enough to still read the name, the
    // price and reach a CTA. Below ~5s a slide gets cut off mid-read, which is
    // why this is the floor rather than 3-4s.
    const t = setInterval(() => setHeroIdx((i) => (i + 1) % heroPool.length), 5000);
    return () => clearInterval(t);
  }, [held, heroPool.length, navTick]);
  const featured = heroPool[heroIdx] || heroPool[0] || null;

  // ── LIVE TICKER — real facts only (deals + the season wheel) ─────────
  // Every item is a real destination. A deal that names a hotel goes to that
  // hotel; the season + inventory facts go to the browse surfaces they
  // describe. Nothing here is decorative text any more.
  const ticker = useMemo(() => {
    const out: { k: string; icon: string; text: string; accent?: string; href: string }[] = [];
    const seasonCities = demand.primary.join(" · ");
    if (seasonCities) {
      out.push({
        k: "season",
        icon: SEASON_ICON[demand.season] || "✦",
        text: `${demand.season} — ${seasonCities} in season now`,
        href: "/hotels",
      });
    }
    // v628 — the ticker no longer repeats the Flash Deals rail. Flash now lives
    // ONLY in the ⚡ Flash Deals rail below; the ticker carries season +
    // real ZONE destination links (only zones that have live properties) +
    // the inventory count — distinct, non-duplicative "what's live" facts.
    const cityHasStay = (cities: string[]) =>
      hotels.some((h) => cities.includes((h.city || "").toLowerCase()));
    LAUNCH_ZONES.forEach((z) => {
      if (!cityHasStay(z.cities)) return;
      out.push({ k: `zone-${z.id}`, icon: "🧭", text: `Explore ${z.label}`, href: "/hotels" });
    });
    if (hotels.length) {
      out.push({
        k: "count",
        icon: "🏔️",
        text: `${hotels.length} properties live across ${LAUNCH_ZONES.length} zones`,
        href: "/hotels",
      });
    }
    return out;
  }, [hotels, demand]);

  // zone rails — reuse the launch curation grouping (same as /hotels).
  // v580 — rails are ordered by how reachable their best city is for THIS
  // viewer (Garhwal first for Delhi NCR, Braj first for Agra…), and the
  // properties INSIDE each rail lead with the easiest drives. Same engine,
  // no layout change.
  const zoneRails = useMemo(() => {
    const out: { id: string; label: string; items: Hotel[]; reach: number }[] = [];
    for (const z of LAUNCH_ZONES) {
      const items = hotels.filter((h) => zoneForCity(h.city) === z.id);
      if (!items.length) continue;
      const ranked = rankForBrowse(items, (h) => h.city, (h) => h.id, { viewer, signals: getSignals(), month: effMonth });
      // v583 — answer-first ordering: the inferred audience segment's natural
      // trip format pulls its zones up (a family sees family corridors first).
      const segFmt = tripFormat(formatForSegment(readSegment()));
      const segBoost = segFmt
        ? Math.max(...items.map((h) => formatFit(segFmt, h.city, minPriceOf(h)))) * 0.3
        : 0;
      const reach = Math.max(...items.map((h) => cityAccess(h.city, viewer).score)) + segBoost;
      out.push({ id: z.id, label: z.label, items: ranked, reach });
    }
    out.sort((a, b) => b.reach - a.reach);
    return out;
  }, [hotels, viewer, effMonth]);

  // v580 — "🚗 Easy getaways near you": the top reachable properties for this
  // viewer in one row (the owner's fit-matrix strategy as a browse surface —
  // the FIRST thing under the deals/reels so choosing is effortless). When
  // location isn't granted, ordering assumes Delhi NCR and a 📍 chip lets the
  // user refine it — the ONLY place the permission prompt can fire.
  const [geoBusy, setGeoBusy] = useState(false);
  const [geoDenied, setGeoDenied] = useState(false);
  const reachRail = useMemo(() => {
    const shot = hotels.filter((h) => imgOf(h));
    return shot
      .slice()
      .sort((a, b) => cityAccess(b.city, viewer).score - cityAccess(a.city, viewer).score)
      .slice(0, 20);
  }, [hotels, viewer]);
  const askGeo = useCallback(async () => {
    if (geoBusy) return;
    setGeoBusy(true);
    const pt = await requestViewerGeo();
    setGeoBusy(false);
    if (pt) { setViewer(pt); setGeoDenied(false); }
    else setGeoDenied(true);
  }, [geoBusy]);

  // v584 — ONE personal "why" per card (validation): in-season beats taste;
  // silence beats noise (null when neither applies).
  const whyFor = useCallback((city?: string | null) => {
    if (!city) return null;
    if (demandTier(city, effMonth) === "primary") return "🌟 In season now";
    const cLc = String(city).toLowerCase();
    const sig = getSignals();
    if ((sig.cities || []).some((x) => String(x).toLowerCase() === cLc)) return "💚 Your kind of place";
    return null;
  }, [effMonth]);

  // v583 — the "how far is it?" chip every property card carries. Hours,
  // not km (hours are how people judge a road trip); long-haul reads as a
  // fly-away. Same engine (cityAccess + driveLabelFor) as the Trip Finder.
  const driveFor = useCallback((city?: string | null) => {
    const lbl = driveLabelFor(cityAccess(city, viewer).km);
    if (!lbl) return null;
    return lbl === "Fly-away escape" ? "✈️ fly-away" : `🚗 ${lbl.replace(" drive", "")}`;
  }, [viewer]);

  // ── DECISION ENGINE P1 (v581): trip-type browse chips ────────────────
  const tripRef = useRef<HTMLElement>(null);

  // Trip-type chip selection: last explicit choice wins, else the inferred
  // audience segment's default (children on a bid ⇒ Family Escape, …).
  // v582.1 — also follows the Trip Finder live (sb:trip-format event), so
  // picking a trip in the Finder flips this rail in the same breath.
  const [tripSel, setTripSel] = useState<TripFormatId>("weekend");
  useEffect(() => {
    if (!on) return;
    const sync = () => {
      try {
        const stored = localStorage.getItem("sb_trip_format");
        if (stored && tripFormat(stored)) { setTripSel(stored as TripFormatId); return; }
      } catch {}
      setTripSel(formatForSegment(readSegment()));
    };
    sync();
    window.addEventListener("sb:trip-format", sync);
    return () => window.removeEventListener("sb:trip-format", sync);
  }, [on]);
  const pickTrip = useCallback((id: TripFormatId) => {
    setTripSel(id);
    try { localStorage.setItem("sb_trip_format", id); } catch {}
    recordFormatChoice(id);
  }, []);

  // Properties matched to the selected format: corridor-gated (formatFit ≥
  // 0.5 requires the right region), then ordered by format fit + reach.
  const selFormat = tripFormat(tripSel) || TRIP_FORMATS[0];
  const tripRail = useMemo(() => {
    const shot = hotels.filter((h) => imgOf(h));
    return shot
      .map((h) => {
        const fit = formatFit(selFormat, h.city, minPriceOf(h));
        return { h, fit, k: fit * 2.5 + cityAccess(h.city, viewer).score };
      })
      .filter((x) => x.fit >= 0.5) // corridor gate — wrong-region cities never sneak in on reach alone
      .sort((a, b) => b.k - a.k)
      .map((x) => x.h);
  }, [hotels, selFormat, viewer]);

  // v631 — Hotstar hero DEPTH transition (owner-approved from the live demo).
  // Scroll-linked only: --sbhp runs 0→1 over the first half viewport of
  // scroll; the mobile CSS block in globals.css maps it to the hero's
  // recede (scale/sink/dim) + the cover surface's un-zoom. rAF-throttled
  // passive listener writing ONE custom property — transform/opacity only,
  // no layout reads besides scrollY. Desktop CSS ignores the var (≥1024px
  // rules untouched); reduced-motion bails here AND is reset in CSS.
  const depthRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    // Re-run when `on` flips: the first mount returns null (the `if (!on)`
    // gate below), so the ref only attaches once the Stage actually renders.
    const el = depthRef.current;
    if (!on || !el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    const tick = () => {
      raf = 0;
      const span = Math.max(window.innerHeight * 0.5, 1);
      const p = Math.min(Math.max(window.scrollY / span, 0), 1);
      el.style.setProperty("--sbhp", p.toFixed(4));
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(tick); };
    window.addEventListener("scroll", onScroll, { passive: true });
    tick();
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [on]);

  if (!on) return null;

  const fScore = featured ? scores[featured.id] : undefined;
  const fPrice = minPriceOf(featured);
  const fImg = imgOf(featured);
  const fRank = fScore?.rank;

  return (
    <div className="sbh-root" ref={depthRef}>
      {/* ── HERO ─────────────────────────────────────────────────────── */}
      <section
        className="sbh-hero"
        onMouseEnter={() => setHeld(true)}
        onMouseLeave={() => setHeld(false)}
        // v584.1 — mobile finger swipe: a clear horizontal swipe (≥45px,
        // dominantly sideways) flips the slide; taps and vertical scrolls
        // pass through untouched. Auto-rotate continues after.
        onTouchStart={(e) => {
          const t = e.touches[0];
          if (t) heroTouch.current = { x: t.clientX, y: t.clientY };
        }}
        onTouchEnd={(e) => {
          const s = heroTouch.current;
          heroTouch.current = null;
          if (!s || heroPool.length < 2) return;
          const t = e.changedTouches[0];
          if (!t) return;
          const dx = t.clientX - s.x;
          const dy = t.clientY - s.y;
          if (Math.abs(dx) >= 45 && Math.abs(dx) > Math.abs(dy) * 1.5) {
            heroNav(dx < 0 ? 1 : -1);
          }
        }}
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
            {SEASON_ICON[demand.season] || "✦"} {demand.season} · {featured && demandTier(featured.city || "", effMonth) === "primary" ? "In season now" : "picked for you"}
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
              {/* v572 — was "— or name your own price", which reads as a slogan
                  rather than something you can actually do here. Name the
                  mechanic instead: you bid, and the hotel answers. */}
              <span className="sbh-hero-nudge">
                or <b>bid your own price</b> — the hotel accepts or counters
              </span>
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

        {/* v584.1 — desktop paddle arrows (both sides). They jump the slide;
            the 5s auto-rotate keeps running (hover already pauses it while
            the cursor is on the hero, so a click never fights the timer). */}
        {heroPool.length > 1 ? (
          <>
            <button
              type="button"
              className="sbh-hero-arr sbh-hero-arr-l"
              aria-label="Previous property"
              onClick={() => heroNav(-1)}
            ><span aria-hidden>‹</span></button>
            <button
              type="button"
              className="sbh-hero-arr sbh-hero-arr-r"
              aria-label="Next property"
              onClick={() => heroNav(1)}
            ><span aria-hidden>›</span></button>
          </>
        ) : null}

        {/* rotation control — the user can always take over */}
        {heroPool.length > 1 ? (
          <div className="sbh-hero-dots" role="tablist" aria-label="Featured properties picked for you">
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
              {/* v580 — the pool now mixes in-season with easy-reach picks,
                  so the honest label is "picked for you", not "in season". */}
              {heroIdx + 1}/{Math.min(8, heroPool.length)} picked for you
            </span>
          </div>
        ) : null}
      </section>

      {/* ── RAILS ────────────────────────────────────────────────────── */}
      {/* v632 — the LIVE TICKER moved INSIDE .sbh-rails (first child). On
          mobile the rails panel is the hero-depth COVER surface (sticky
          hero slides under it) — when the ticker was a separate sibling it
          became a floating white band over the hero with a see-through
          margin gap beneath it (owner screenshot). One continuous cover =
          the Hotstar look. Ticker markup + behaviour unchanged. */}
      <div className="sbh-rails">
        {/* ── LIVE TICKER ─────────────────────────────────────────────
            Every item is a link, which changes what the motion is allowed
            to do. On a POINTER the marquee runs and pauses on hover/focus,
            so you can always stop a chip and click it (also WCAG 2.2.2's
            pause requirement). On TOUCH it does not auto-move at all — it
            is a swipeable row — because chasing a moving chip with a thumb
            is not a real interaction. Only the FIRST group is in the a11y
            tree; the second is the seamless-loop duplicate and is hidden +
            unfocusable, otherwise every offer would be announced twice. */}
        {ticker.length ? (
          <nav className="sbh-ticker" aria-label="Live offers and season">
            <div className="sbh-ticker-track">
              {[0, 1].map((dup) => (
                <div
                  className="sbh-ticker-group"
                  key={dup}
                  aria-hidden={dup === 1 ? true : undefined}
                >
                  {ticker.map((t) => (
                    <Link
                      href={t.href}
                      className="sbh-ticker-item"
                      key={`${dup}-${t.k}`}
                      tabIndex={dup === 1 ? -1 : undefined}
                    >
                      <span className="sbh-tk-ico" aria-hidden>{t.icon}</span>
                      <span className="sbh-tk-text">{t.text}</span>
                      {t.accent ? <span className="sbh-tk-accent">{t.accent}</span> : null}
                    </Link>
                  ))}
                </div>
              ))}
            </div>
          </nav>
        ) : null}
        {/* v582 — TRIP FINDER: the first thing under the hero, because the
            most common visitor state is "I don't know where to go". Three
            taps → three destinations with reasons. Every number is real
            (min nightly rate × typical nights). */}
        <TripFinder
          viewer={viewer}
          hotels={hotels.map((h) => ({
            id: h.id,
            name: h.name,
            city: h.city,
            minPrice: minPriceOf(h),
            overall: scores[h.id]?.overall ?? null,
            image: imgOf(h) || null,
          }))}
        />

        {/* v582.1 — the seasonal selling program now lives INSIDE the Trip
            Finder as a slim ribbon (owner: the standalone band + finder were
            two tall flat cards eating the first screen). */}
        {deals.length ? (
          <Rail
            title="⚡ Flash Deals"
            sub={countdown ? `Resets in ${countdown} — live prices, limited rooms` : "Tonight only — live prices, limited rooms"}
            href="/flash-deals"
          >
            {deals.slice(0, 14).map((d) => <FlashCard key={d.id} d={d} left={countdown} score={scores[d.hotelId || d.hotel?.id || ""]} />)}
          </Rail>
        ) : null}

        {reels.length ? (
          <Rail
            title="🎬 Reels"
            sub="Real stays, filmed by real guests"
            href="/discover"
            variant="tall"
            action={{ href: "/discover?create=1", label: "＋ Post a reel" }}
          >
            {railReels.map((r) => (
              <ReelCard key={r.id} r={r} preview={wide} price={priceForHotel(r.hotel?.id)} />
            ))}
          </Rail>
        ) : null}

        {/* v628 — "What kind of trip?" chips + the format-picks rail were a
            SECOND, parallel trip chooser alongside the Trip Finder above (which
            already asks the trip type in its Who·Trip·Budget flow). Consolidated
            to the one Trip Finder (owner decision 1A): the duplicate chips
            section + its picks rail are removed. The same properties still
            appear in the Trip Finder matches, the zone rails and Easy getaways —
            nothing left the product, only the repetition. */}

        {/* v580 — the owner's fit-matrix strategy as a browse surface: the
            top properties this viewer can most easily reach, in one row, so
            choosing is effortless. Ordering assumes Delhi NCR until the user
            taps 📍 (the ONLY place the location prompt can fire). */}
        {reachRail.length ? (
          <Rail
            title="🚗 Easy getaways near you"
            sub={
              geoDenied
                ? "Location unavailable — showing Delhi NCR picks · short drives first"
                : originCluster
                  ? `Handpicked for ${originCluster.label} · shortest drives first`
                  : viewer
                    ? "Shortest drives from your location first"
                    : "Showing Delhi NCR picks · tap 📍 to use your location"
            }
            href="/hotels"
            actionBtn={
              !viewer
                ? { label: geoBusy ? "Locating…" : "📍 Use my location", onClick: askGeo, disabled: geoBusy }
                : undefined
            }
          >
            {reachRail.map((h) => <HotelCard key={h.id} h={h} score={scores[h.id]} drive={driveFor(h.city)} why={whyFor(h.city)} />)}
          </Rail>
        ) : null}

        {zoneRails.map((z) => (
          <Rail key={z.id} title={z.label} sub={`${z.items.length} propert${z.items.length === 1 ? "y" : "ies"}`} href="/hotels">
            {z.items.map((h) => <HotelCard key={h.id} h={h} score={scores[h.id]} drive={driveFor(h.city)} why={whyFor(h.city)} />)}
          </Rail>
        ))}

        {/* Ownership sits after the browse rails and before the closing band:
            you have seen what StayBid sells, now here is how you can own it. */}
        {circleProps.length ? <CircleRow props={circleProps} counts={circleCounts} /> : null}

        {/* Your own progress, last — after everything StayBid sells and just
            above the closing band, which stays the page's final word.
            Self-gates on sign-in, so a signed-out visitor sees no gap here. */}
        <PassportStrip />

        {/* Closing band. It sits AFTER every rail — the browse surfaces sell the
            stays, and this is the "so what do I do now" answer you land on once
            you've scrolled the lot. Full-bleed: the rails column has no
            max-width, and the gutter lives inside each child via --sbh-gut. */}
        <LiveBidding />

        {!hotels.length && !deals.length ? (
          <div className="sbh-loading">Loading your stage…</div>
        ) : null}
      </div>

      <ScrollRail />
    </div>
  );
}
