"use client";
/*
 * v128 — Hotel Performance Score Badge.
 *
 * Premium clickable live badge surfaced on /hotels/[id] (and a compact
 * variant on /hotels list cards). Top shows rank within city, bottom
 * shows score /100 with a circular SVG progress ring + champagne sweep.
 *
 * Click → opens <HotelScorecardModal> with the full checkpoint
 * breakdown + rank table + trend sparkline.
 *
 * Three size variants:
 *   "hero"    — large, used on /hotels/[id] hero ribbon
 *   "card"    — medium, used on /hotels list grid card corner
 *   "compact" — small chip, used wherever a tiny "82 · 2nd" pill works
 *
 * Self-fetches the scorecard on mount with a small in-memory cache so
 * multiple badges for the same hotel (e.g. list page + detail page
 * shared chrome) don't double-fetch.
 */
import { useEffect, useRef, useState, useMemo, useCallback } from "react";

import HotelScorecardModal from "./HotelScorecardModal";

export type Scorecard = {
  hotelId: string;
  city: string | null;
  overall: number | null;
  status: "unrated" | "developing" | "fair" | "good" | "excellent";
  badge: { emoji: string; label: string; color: string };
  rank: { rank: number | null; total: number; percentile: number | null };
  checkpoints: any[];
  totals: { bookings: number; stayFeedback: number; complaints: number };
  computedAt: string;
};

const CACHE: Record<string, { data: Scorecard | null; at: number }> = {};
const TTL = 60_000;

async function fetchScorecard(hotelId: string): Promise<Scorecard | null> {
  const cached = CACHE[hotelId];
  if (cached && Date.now() - cached.at < TTL) return cached.data;
  try {
    const r = await fetch(`/api/hotels/${encodeURIComponent(hotelId)}/scorecard`, {
      cache: "no-store",
    });
    if (!r.ok) {
      CACHE[hotelId] = { data: null, at: Date.now() };
      return null;
    }
    const data: Scorecard = await r.json();
    CACHE[hotelId] = { data, at: Date.now() };
    return data;
  } catch {
    CACHE[hotelId] = { data: null, at: Date.now() };
    return null;
  }
}

function useCountUp(target: number, duration = 1100) {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (!Number.isFinite(target) || target <= 0) {
      setV(0);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / duration);
      const e = 1 - Math.pow(1 - k, 3);
      setV(+(target * e).toFixed(1));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return v;
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

type Props = {
  hotelId: string;
  hotelName?: string;
  variant?: "hero" | "card" | "compact";
  // If parent already has the scorecard data (e.g. from server-side render),
  // pass it to skip the fetch.
  initial?: Scorecard | null;
  // optional click handler — defaults to opening the modal
  onClick?: () => void;
};

export default function HotelScoreBadge({
  hotelId,
  hotelName,
  variant = "hero",
  initial,
  onClick,
}: Props) {
  const [card, setCard] = useState<Scorecard | null>(initial ?? null);
  const [loading, setLoading] = useState<boolean>(!initial);
  const [open, setOpen] = useState(false);
  const mounted = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    const data = await fetchScorecard(hotelId);
    setCard(data);
    setLoading(false);
  }, [hotelId]);

  useEffect(() => {
    mounted.current = true;
    if (!initial) load();
    return () => {
      mounted.current = false;
    };
  }, [hotelId, initial, load]);

  const overall = card?.overall ?? 0;
  const animatedScore = useCountUp(overall, 1100);
  const isUnrated = !card || card.overall === null;

  const ringPct = useMemo(() => {
    if (!card || card.overall === null) return 0;
    return Math.max(0, Math.min(100, card.overall));
  }, [card]);

  const handleClick = useCallback(() => {
    if (onClick) onClick();
    else setOpen(true);
  }, [onClick]);

  // ── Loading skeleton ─────────────────────────────────────────────
  if (loading && !card) {
    return (
      <div
        className={`hsb hsb-${variant} hsb-skel`}
        aria-label="Loading hotel score"
      >
        <div className="hsb-skel-shimmer" />
      </div>
    );
  }

  // ── Unrated (new hotel) ─────────────────────────────────────────
  if (isUnrated) {
    return (
      <button
        type="button"
        className={`hsb hsb-${variant} hsb-unrated`}
        onClick={handleClick}
        aria-label="Hotel score — new on StayBid"
      >
        <span className="hsb-unrated-emoji">✨</span>
        <span className="hsb-unrated-text">
          <span className="hsb-unrated-l1">New on StayBid</span>
          <span className="hsb-unrated-l2">Score forms after first stays</span>
        </span>
        <style jsx>{styles}</style>
      </button>
    );
  }

  // ── Rated badge — 3D award-medal style (v128.1) ─────────────────
  const { badge, rank } = card!;
  const score = card!.overall as number;
  const medalColor = badge.color || "#C9A66B";

  // Rank tier styling — 1st gold / 2nd silver / 3rd bronze / rest champagne.
  // Mirrors classic prize-medal hierarchy so customers can read it instantly.
  const rankTier =
    rank.rank === 1 ? "gold"
    : rank.rank === 2 ? "silver"
    : rank.rank === 3 ? "bronze"
    : rank.rank && rank.rank <= 10 ? "champagne"
    : rank.rank ? "muted"
    : null;

  const rankLabel = rank.rank
    ? rank.rank === 1 ? "1st"
      : rank.rank === 2 ? "2nd"
      : rank.rank === 3 ? "3rd"
      : `#${rank.rank}`
    : null;

  const rankIcon = rank.rank === 1 ? "🥇"
    : rank.rank === 2 ? "🥈"
    : rank.rank === 3 ? "🥉"
    : rank.rank && rank.rank <= 10 ? "🏆"
    : null;

  const ariaLabel = `Hotel performance score ${score} out of 100${
    rank.rank ? `, ranked ${rankLabel} of ${rank.total} in ${card!.city || "city"}` : ""
  }. Tap for full breakdown.`;

  return (
    <>
      <button
        type="button"
        className={`hsb hsb-${variant} hsb-medal-style${rankTier ? ` hsb-tier-${rankTier}` : ""}`}
        onClick={handleClick}
        aria-label={ariaLabel}
        title={ariaLabel}
        style={{
          ["--hsb-color" as any]: medalColor,
        }}
      >
        {/* Top trophy ribbon — only shows when ranked */}
        {rankLabel ? (
          <span className="hsb-trophy" aria-hidden>
            <span className="hsb-trophy-tail hsb-trophy-tail-l" />
            <span className="hsb-trophy-tail hsb-trophy-tail-r" />
            <span className="hsb-trophy-body">
              {rankIcon ? <span className="hsb-trophy-icon">{rankIcon}</span> : null}
              <span className="hsb-trophy-text">{rankLabel}</span>
            </span>
          </span>
        ) : (
          <span className="hsb-trophy hsb-trophy-citywide" aria-hidden>
            <span className="hsb-trophy-tail hsb-trophy-tail-l" />
            <span className="hsb-trophy-tail hsb-trophy-tail-r" />
            <span className="hsb-trophy-body">
              <span className="hsb-trophy-icon">{badge.emoji}</span>
              <span className="hsb-trophy-text">{badge.label}</span>
            </span>
          </span>
        )}

        {/* 3D medal disc */}
        <span className="hsb-medal" aria-hidden>
          <span className="hsb-medal-sheen" />
          <span className="hsb-medal-inner">
            <span className="hsb-medal-num">{animatedScore}</span>
            <span className="hsb-medal-denom">/100</span>
          </span>
          <span className="hsb-medal-live">
            <span className="hsb-medal-live-dot" />
          </span>
        </span>
      </button>

      {open ? (
        <HotelScorecardModal
          hotelId={hotelId}
          hotelName={hotelName}
          card={card}
          onClose={() => setOpen(false)}
          onRefresh={load}
        />
      ) : null}

      <style jsx>{styles}</style>
    </>
  );
}

// ── Styles ───────────────────────────────────────────────────────────

const styles = `
/* ── v128.1 — 3D award-medal badge ───────────────────────────────── */
/*
 * Smaller, modern, premium. Visual hierarchy:
 *   1. Top "trophy ribbon" — prize sash with rank (#1/#2/#3)
 *   2. 3D circular medal — radial-gradient metallic disc with
 *      conic-gradient sheen sweep + multiple layered shadows for
 *      genuine depth illusion. Score lives in the center.
 *
 * Tier system mirrors classic competition medals:
 *   .hsb-tier-gold     1st place  ↦ champagne gold gradient
 *   .hsb-tier-silver   2nd place  ↦ cool sage/grey gradient
 *   .hsb-tier-bronze   3rd place  ↦ warm copper gradient
 *   .hsb-tier-champagne 4-10      ↦ subtle champagne
 *   .hsb-tier-muted     11+       ↦ muted gold
 *   (no tier)          unranked   ↦ status label only
 *
 * Sizes per variant:
 *   hero    — 92×112px (mobile) → 100×120 (tablet) → 108×130 (desktop)
 *   card    — 76×96px constant (used inside hotel-list grid cells)
 *   compact — inline pill, 56px tall
 */

/* Base button ───────────────────────────────────────────────────── */
.hsb {
  position: relative;
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  border: none;
  background: transparent;
  padding: 0;
  cursor: pointer;
  isolation: isolate;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
  font-family: var(--font-display, "Cormorant Garamond"), serif;
  color: var(--text-base, #1f1a0f);
  transition: transform .28s cubic-bezier(.22,1,.36,1), filter .28s;
  -webkit-touch-callout: none;
}
.hsb:hover {
  transform: translateY(-2px) scale(1.015);
  filter: drop-shadow(0 8px 18px rgba(31, 26, 15, 0.18));
}
.hsb:active { transform: translateY(0) scale(0.98); }
.hsb:focus-visible {
  outline: 2px solid var(--cozy-champagne, #C9A66B);
  outline-offset: 4px;
  border-radius: 12px;
}

/* Per-variant sizing ─────────────────────────────────────────────── */
.hsb-hero { width: 92px; min-height: 116px; }
.hsb-card { width: 76px; min-height: 96px; }
.hsb-compact {
  flex-direction: row;
  align-items: center;
  gap: 8px;
  min-height: 0;
  width: auto;
}

/* Trophy ribbon (top) ───────────────────────────────────────────── */
.hsb-trophy {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  z-index: 3;
  margin-bottom: -8px;       /* overlap medal so it tucks behind */
  filter: drop-shadow(0 3px 5px rgba(31, 26, 15, 0.22));
  pointer-events: none;
}
.hsb-trophy-body {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 4px 11px 5px;
  border-radius: 6px;
  background: linear-gradient(180deg, var(--hsb-trophy-light, #D9BE82) 0%, var(--hsb-trophy-base, #C9A66B) 55%, var(--hsb-trophy-dark, #8B6914) 100%);
  color: #FFFCF6;
  font-family: var(--font-body, "DM Sans"), system-ui, sans-serif;
  font-weight: 800;
  font-size: 0.6rem;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  text-shadow: 0 1px 1px rgba(0,0,0,0.30);
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,0.55),
    inset 0 -1px 0 rgba(0,0,0,0.20),
    0 2px 4px rgba(31, 26, 15, 0.15);
  z-index: 2;
  line-height: 1;
  white-space: nowrap;
}
.hsb-trophy-icon { font-size: 0.85rem; line-height: 1; }
.hsb-trophy-text { line-height: 1; }
/* Ribbon "tails" — left + right notched flags peeking from behind */
.hsb-trophy-tail {
  position: absolute;
  top: 50%;
  width: 9px;
  height: 14px;
  background: linear-gradient(180deg, var(--hsb-trophy-base, #C9A66B) 0%, var(--hsb-trophy-dark, #8B6914) 100%);
  transform: translateY(-50%);
  z-index: 1;
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.30), 0 1px 2px rgba(31, 26, 15, 0.15);
}
.hsb-trophy-tail-l {
  left: -5px;
  clip-path: polygon(0 0, 100% 0, 100% 100%, 0 100%, 35% 50%);
}
.hsb-trophy-tail-r {
  right: -5px;
  clip-path: polygon(0 0, 100% 0, 65% 50%, 100% 100%, 0 100%);
}

/* Gold (1st) ─ champagne sunset */
.hsb-tier-gold .hsb-trophy { --hsb-trophy-light: #FFE7A3; --hsb-trophy-base: #D9BE82; --hsb-trophy-dark: #8B6914; }
/* Silver (2nd) ─ cool platinum sage */
.hsb-tier-silver .hsb-trophy { --hsb-trophy-light: #F0F0EC; --hsb-trophy-base: #C8C9C2; --hsb-trophy-dark: #6B7565; color: #FFFCF6; }
.hsb-tier-silver .hsb-trophy-body { color: #2B2415; text-shadow: 0 1px 0 rgba(255,255,255,0.45); }
/* Bronze (3rd) ─ warm copper */
.hsb-tier-bronze .hsb-trophy { --hsb-trophy-light: #E8B58A; --hsb-trophy-base: #B8794A; --hsb-trophy-dark: #6B3D1F; }
/* Champagne (4-10) */
.hsb-tier-champagne .hsb-trophy { --hsb-trophy-light: #E7CFA0; --hsb-trophy-base: #C9A66B; --hsb-trophy-dark: #8B6914; }
/* Muted (11+) */
.hsb-tier-muted .hsb-trophy { --hsb-trophy-light: #CCBFA0; --hsb-trophy-base: #A89674; --hsb-trophy-dark: #6E5430; }
/* Citywide (no rank — show badge label) */
.hsb-trophy-citywide { --hsb-trophy-light: #D9BE82; --hsb-trophy-base: #C9A66B; --hsb-trophy-dark: #6E5430; }

/* 3D medal disc ──────────────────────────────────────────────────── */
.hsb-medal {
  position: relative;
  width: 84px;
  height: 84px;
  border-radius: 50%;
  z-index: 2;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  /* The medal IS the color — radial highlight + base + outer rim */
  background:
    radial-gradient(circle at 32% 28%, rgba(255, 255, 255, 0.85) 0%, rgba(255, 255, 255, 0.0) 38%),
    radial-gradient(circle at 50% 50%, var(--hsb-color, #C9A66B) 0%, color-mix(in oklab, var(--hsb-color, #C9A66B) 70%, #2B2415) 100%);
  box-shadow:
    /* Outer ambient drop */
    0 14px 28px -10px rgba(31, 26, 15, 0.50),
    0 5px 10px -3px rgba(31, 26, 15, 0.32),
    /* Outer rim ring */
    0 0 0 2px color-mix(in oklab, var(--hsb-color, #C9A66B) 60%, #FFFCF6),
    /* Inner highlight (top) */
    inset 0 3px 5px rgba(255, 255, 255, 0.55),
    /* Inner shadow (bottom) */
    inset 0 -4px 7px rgba(31, 26, 15, 0.30),
    /* Engraved ring inset */
    inset 0 0 0 1px rgba(255, 255, 255, 0.25);
  overflow: hidden;
  isolation: isolate;
}
.hsb-hero .hsb-medal { width: 84px; height: 84px; }
.hsb-card .hsb-medal { width: 68px; height: 68px; }
.hsb-compact .hsb-medal { width: 44px; height: 44px; }

/* Metallic sheen sweep across the disc */
.hsb-medal-sheen {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background: conic-gradient(
    from 0deg,
    transparent 0%,
    rgba(255, 255, 255, 0.20) 18%,
    transparent 36%,
    transparent 50%,
    rgba(255, 255, 255, 0.10) 68%,
    transparent 84%,
    transparent 100%
  );
  animation: hsb-medal-spin 8s linear infinite;
  z-index: 1;
  pointer-events: none;
  mix-blend-mode: screen;
}
@keyframes hsb-medal-spin { to { transform: rotate(360deg); } }

/* Inner content (score + denom) — slightly recessed for depth */
.hsb-medal-inner {
  position: relative;
  z-index: 2;
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  line-height: 1;
  text-shadow:
    0 1px 0 rgba(255, 255, 255, 0.45),
    0 -1px 0 rgba(31, 26, 15, 0.20);
}
.hsb-medal-num {
  font-family: var(--font-display, "Cormorant Garamond"), Georgia, serif;
  font-weight: 700;
  font-style: italic;
  font-size: 1.85rem;
  color: #FFFCF6;
  letter-spacing: -0.02em;
  font-feature-settings: "tnum" 1;
}
.hsb-medal-denom {
  font-family: var(--font-body, "DM Sans"), system-ui, sans-serif;
  font-size: 0.55rem;
  font-weight: 700;
  letter-spacing: 0.10em;
  color: rgba(255, 252, 246, 0.85);
  margin-top: 1px;
  text-transform: uppercase;
}
.hsb-card .hsb-medal-num { font-size: 1.45rem; }
.hsb-card .hsb-medal-denom { font-size: 0.5rem; }
.hsb-compact .hsb-medal-num { font-size: 1.0rem; }
.hsb-compact .hsb-medal-denom { display: none; }

/* Live pulse dot — bottom-right corner of the medal */
.hsb-medal-live {
  position: absolute;
  right: 7%;
  bottom: 9%;
  z-index: 3;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.95);
  box-shadow:
    0 0 0 2px color-mix(in oklab, var(--hsb-color, #C9A66B) 70%, #2B2415),
    0 0 0 4px rgba(255, 255, 255, 0.30);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.hsb-medal-live-dot {
  width: 3.5px;
  height: 3.5px;
  border-radius: 50%;
  background: #7F9269;
  animation: hsb-pulse 1.8s ease-in-out infinite;
}
@keyframes hsb-pulse {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(0.55); opacity: 0.45; }
}

/* COMPACT variant tweaks — pill layout, no top ribbon stacking */
.hsb-compact {
  background: var(--bg-card, #FFFCF6);
  border: 1px solid rgba(201, 166, 107, 0.28);
  padding: 4px 10px 4px 4px;
  border-radius: 999px;
  box-shadow: 0 2px 6px rgba(31, 26, 15, 0.08);
}
.hsb-compact .hsb-trophy { margin-bottom: 0; margin-right: 0; }
.hsb-compact .hsb-trophy-body { padding: 2px 7px; font-size: 0.52rem; border-radius: 4px; }
.hsb-compact .hsb-trophy-tail { display: none; }

/* Unrated / new — small horizontal pill */
.hsb-unrated {
  flex-direction: row;
  align-items: center;
  gap: 8px;
  padding: 7px 12px 7px 10px;
  border-radius: 999px;
  text-align: left;
  min-height: 0;
  background: linear-gradient(180deg, var(--bg-elevated, #fffcf6), var(--bg-card, #faf5eb));
  border: 1px solid rgba(201, 166, 107, 0.30);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.55),
    0 4px 10px -4px rgba(31, 26, 15, 0.15);
}
.hsb-unrated-emoji { font-size: 1.3rem; line-height: 1; }
.hsb-unrated-text { display: inline-flex; flex-direction: column; line-height: 1.1; }
.hsb-unrated-l1 {
  font-family: var(--font-display, "Cormorant Garamond"), serif;
  font-size: 0.95rem;
  font-weight: 600;
  font-style: italic;
  color: var(--text-base, #1f1a0f);
}
.hsb-unrated-l2 {
  font-family: var(--font-body, "DM Sans"), system-ui, sans-serif;
  font-size: 0.6rem;
  letter-spacing: 0.04em;
  color: var(--cozy-cocoa-soft, #6e5430);
  margin-top: 1px;
}

/* Skeleton ───────────────────────────────────────────────────────── */
.hsb-skel {
  position: relative;
  border-radius: 50%;
  overflow: hidden;
  background: linear-gradient(160deg, var(--bg-card, #faf5eb), var(--bg-elevated, #fffcf6));
}
.hsb-skel.hsb-hero { width: 92px; height: 116px; border-radius: 16px; }
.hsb-skel.hsb-card { width: 76px; height: 96px; border-radius: 14px; }
.hsb-skel.hsb-compact { width: 100px; height: 36px; border-radius: 999px; }
.hsb-skel-shimmer {
  position: absolute; inset: 0;
  background: linear-gradient(110deg, transparent 30%, rgba(255,255,255,0.6) 50%, transparent 70%);
  animation: hsb-shimmer 1.4s linear infinite;
}
@keyframes hsb-shimmer { to { transform: translateX(120%); } }

/* ── Responsive breakpoints ──────────────────────────────────────── */
/* Mobile-first defaults are above. Scale UP on tablet + desktop. */

/* Tablet (>= 600px) */
@media (min-width: 600px) {
  .hsb-hero { width: 100px; min-height: 124px; }
  .hsb-hero .hsb-medal { width: 92px; height: 92px; }
  .hsb-hero .hsb-medal-num { font-size: 2.0rem; }
  .hsb-hero .hsb-medal-denom { font-size: 0.58rem; }
  .hsb-hero .hsb-trophy-body { font-size: 0.62rem; padding: 4px 12px 5px; }
}

/* Laptop (>= 1024px) */
@media (min-width: 1024px) {
  .hsb-hero { width: 108px; min-height: 130px; }
  .hsb-hero .hsb-medal { width: 96px; height: 96px; }
  .hsb-hero .hsb-medal-num { font-size: 2.1rem; }
  .hsb-hero .hsb-medal-denom { font-size: 0.6rem; }
  .hsb-hero .hsb-trophy-body { font-size: 0.65rem; padding: 5px 13px; }
  .hsb-hero .hsb-trophy-tail { width: 10px; height: 16px; }
  .hsb-card { width: 84px; min-height: 100px; }
  .hsb-card .hsb-medal { width: 72px; height: 72px; }
}

/* Desktop (>= 1440px) */
@media (min-width: 1440px) {
  .hsb-hero { width: 116px; min-height: 138px; }
  .hsb-hero .hsb-medal { width: 100px; height: 100px; }
  .hsb-hero .hsb-medal-num { font-size: 2.25rem; }
}

/* Very narrow phones (iPhone SE ≤ 380px) */
@media (max-width: 380px) {
  .hsb-hero { width: 84px; min-height: 106px; }
  .hsb-hero .hsb-medal { width: 76px; height: 76px; }
  .hsb-hero .hsb-medal-num { font-size: 1.7rem; }
  .hsb-hero .hsb-trophy-body { padding: 3px 9px 4px; font-size: 0.55rem; }
  .hsb-hero .hsb-trophy-tail { width: 8px; height: 12px; }
}

/* Dark theme — medal stays metallic, trophy text colors adjust */
[data-theme="dark"] .hsb-unrated {
  background: linear-gradient(180deg, rgba(43, 36, 21, 0.96), rgba(31, 26, 15, 0.92));
  border-color: rgba(201, 166, 107, 0.45);
}
[data-theme="dark"] .hsb-compact {
  background: rgba(43, 36, 21, 0.92);
  border-color: rgba(201, 166, 107, 0.45);
}

/* Reduced motion */
@media (prefers-reduced-motion: reduce) {
  .hsb-medal-sheen, .hsb-medal-live-dot, .hsb-skel-shimmer { animation: none; }
  .hsb { transition: none; }
}
`;
