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

  // ── Rated badge ─────────────────────────────────────────────────
  const { badge, rank } = card!;
  const score = card!.overall as number;
  const ringColor = badge.color || "#C9A66B";
  const rankLabel =
    rank.rank !== null && rank.total > 0
      ? `${ordinal(rank.rank)} of ${rank.total}`
      : null;

  return (
    <>
      <button
        type="button"
        className={`hsb hsb-${variant} hsb-rated`}
        onClick={handleClick}
        aria-label={`Hotel score ${score} out of 100${
          rankLabel ? `, ranked ${rankLabel} in ${card!.city || "city"}` : ""
        }`}
        style={{
          // CSS var for ring fill so JSX styles can read it
          ["--hsb-ring-color" as any]: ringColor,
          ["--hsb-ring-pct" as any]: `${ringPct}%`,
        }}
      >
        {/* Animated sweep + base */}
        <span className="hsb-sweep" aria-hidden />
        <span className="hsb-rim" aria-hidden />

        {/* Top: rank + emoji */}
        <span className="hsb-top">
          {rankLabel ? (
            <span className="hsb-rank">
              <span className="hsb-rank-emoji">{badge.emoji}</span>
              <span className="hsb-rank-text">{rankLabel}</span>
            </span>
          ) : (
            <span className="hsb-rank hsb-rank-citywide">
              <span className="hsb-rank-emoji">{badge.emoji}</span>
              <span className="hsb-rank-text">{badge.label}</span>
            </span>
          )}
        </span>

        {/* Center: score + ring */}
        <span className="hsb-center">
          <svg className="hsb-ring" viewBox="0 0 100 100" aria-hidden>
            <defs>
              <linearGradient
                id={`hsb-grad-${hotelId.slice(-6)}`}
                x1="0%"
                y1="0%"
                x2="100%"
                y2="100%"
              >
                <stop offset="0%" stopColor={ringColor} stopOpacity="0.95" />
                <stop offset="100%" stopColor={ringColor} stopOpacity="0.55" />
              </linearGradient>
            </defs>
            <circle
              className="hsb-ring-track"
              cx="50"
              cy="50"
              r="44"
              strokeWidth="6"
              fill="none"
            />
            <circle
              className="hsb-ring-fill"
              cx="50"
              cy="50"
              r="44"
              strokeWidth="6"
              fill="none"
              stroke={`url(#hsb-grad-${hotelId.slice(-6)})`}
              strokeLinecap="round"
              transform="rotate(-90 50 50)"
              style={{
                strokeDasharray: `${2 * Math.PI * 44}`,
                strokeDashoffset: `${
                  2 * Math.PI * 44 * (1 - ringPct / 100)
                }`,
              }}
            />
          </svg>
          <span className="hsb-score">
            <span className="hsb-score-num">{animatedScore}</span>
            <span className="hsb-score-denom">/100</span>
          </span>
        </span>

        {/* Bottom: label + live dot */}
        <span className="hsb-bottom">
          <span className="hsb-live-dot" aria-hidden />
          <span className="hsb-bottom-text">
            {variant === "compact" ? "Tap" : "Tap for full scorecard"}
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
.hsb {
  position: relative;
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  cursor: pointer;
  border: none;
  background: linear-gradient(160deg, var(--bg-elevated, #fffcf6) 0%, var(--bg-card, #faf5eb) 60%, var(--cozy-cream-100, #faf5eb) 100%);
  border-radius: 22px;
  padding: 14px 18px 12px;
  color: var(--text-base, #1f1a0f);
  font-family: var(--font-display, "Cormorant Garamond"), serif;
  box-shadow:
    0 1px 0 rgba(255,255,255,0.6) inset,
    0 0 0 1px rgba(201, 166, 107, 0.25),
    0 18px 40px -22px rgba(74, 56, 32, 0.45),
    0 4px 14px -8px rgba(31, 26, 15, 0.25);
  transition: transform .26s cubic-bezier(.22,1,.36,1), box-shadow .26s, opacity .2s;
  overflow: hidden;
  isolation: isolate;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
}
.hsb:hover {
  transform: translateY(-2px);
  box-shadow:
    0 1px 0 rgba(255,255,255,0.7) inset,
    0 0 0 1px rgba(201, 166, 107, 0.4),
    0 22px 48px -22px rgba(74, 56, 32, 0.55),
    0 6px 18px -8px rgba(31, 26, 15, 0.3);
}
.hsb:active { transform: translateY(0); }
.hsb:focus-visible {
  outline: 2px solid var(--cozy-champagne, #C9A66B);
  outline-offset: 3px;
}

.hsb-sweep {
  position: absolute;
  inset: -40%;
  background: conic-gradient(from 200deg, transparent 0%, rgba(201,166,107,0.18) 18%, transparent 35%, transparent 100%);
  animation: hsb-sweep 6s linear infinite;
  z-index: 0;
  pointer-events: none;
}
@keyframes hsb-sweep { to { transform: rotate(360deg); } }

.hsb-rim {
  position: absolute;
  inset: 1px;
  border-radius: 21px;
  background: radial-gradient(120% 80% at 50% -10%, rgba(255,255,255,0.55) 0%, transparent 60%);
  z-index: 1;
  pointer-events: none;
}

.hsb-top, .hsb-center, .hsb-bottom {
  position: relative;
  z-index: 2;
}

/* HERO variant */
.hsb-hero { width: 158px; min-height: 184px; padding: 14px 14px 10px; }
.hsb-hero .hsb-ring { width: 96px; height: 96px; }
.hsb-hero .hsb-score-num { font-size: 2.05rem; font-weight: 600; line-height: 1; }
.hsb-hero .hsb-score-denom { font-size: 0.78rem; opacity: 0.65; }

/* CARD variant — for /hotels list */
.hsb-card { width: 110px; min-height: 130px; padding: 9px 9px 7px; border-radius: 18px; }
.hsb-card .hsb-ring { width: 64px; height: 64px; }
.hsb-card .hsb-score-num { font-size: 1.35rem; font-weight: 600; line-height: 1; }
.hsb-card .hsb-score-denom { font-size: 0.62rem; }
.hsb-card .hsb-bottom-text { font-size: 0.55rem; letter-spacing: 0.08em; }

/* COMPACT chip */
.hsb-compact {
  flex-direction: row;
  gap: 8px;
  border-radius: 14px;
  padding: 7px 12px;
  min-height: 0;
}
.hsb-compact .hsb-ring { width: 28px; height: 28px; }
.hsb-compact .hsb-score-num { font-size: 0.95rem; }
.hsb-compact .hsb-score-denom { display: none; }
.hsb-compact .hsb-top { font-size: 0.62rem; }
.hsb-compact .hsb-bottom { display: none; }
.hsb-compact .hsb-rank-emoji { font-size: 0.95rem; }
.hsb-compact .hsb-rank-text { font-size: 0.65rem; }

/* Top rank pill */
.hsb-rank {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: linear-gradient(180deg, rgba(255,255,255,0.5), rgba(255,255,255,0.18));
  border: 1px solid rgba(201, 166, 107, 0.35);
  border-radius: 999px;
  padding: 3px 9px 3px 7px;
  font-family: var(--font-body, "DM Sans"), system-ui, sans-serif;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  font-size: 0.62rem;
  font-weight: 700;
  color: var(--cozy-cocoa, #4a3820);
  box-shadow: 0 1px 0 rgba(255,255,255,0.6) inset;
}
.hsb-rank-emoji { font-size: 0.95rem; line-height: 1; }
.hsb-rank-text { line-height: 1; }

/* Center: ring + score overlay */
.hsb-center {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin: 6px 0 4px;
}
.hsb-compact .hsb-center { margin: 0; }
.hsb-ring { display: block; }
.hsb-ring-track {
  stroke: rgba(201, 166, 107, 0.16);
}
.hsb-ring-fill {
  transition: stroke-dashoffset 1.1s cubic-bezier(.22,1,.36,1);
  filter: drop-shadow(0 0 6px rgba(201, 166, 107, 0.45));
}

.hsb-score {
  position: absolute;
  inset: 0;
  display: inline-flex;
  align-items: baseline;
  justify-content: center;
  gap: 1px;
  font-family: var(--font-display, "Cormorant Garamond"), serif;
  font-feature-settings: "tnum" 1;
}
.hsb-score-num {
  color: var(--text-base, #1f1a0f);
}
.hsb-score-denom {
  color: var(--cozy-cocoa-soft, #6e5430);
  letter-spacing: 0.04em;
}

/* Bottom */
.hsb-bottom {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin-top: 2px;
  font-family: var(--font-body, "DM Sans"), system-ui, sans-serif;
  font-size: 0.6rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  font-weight: 600;
  color: var(--cozy-cocoa, #4a3820);
  opacity: 0.85;
}
.hsb-live-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #7F9269;
  box-shadow: 0 0 0 0 rgba(127, 146, 105, 0.75);
  animation: hsb-pulse 1.8s ease-in-out infinite;
}
@keyframes hsb-pulse {
  0% { box-shadow: 0 0 0 0 rgba(127, 146, 105, 0.7); }
  70% { box-shadow: 0 0 0 8px rgba(127, 146, 105, 0); }
  100% { box-shadow: 0 0 0 0 rgba(127, 146, 105, 0); }
}

/* Unrated */
.hsb-unrated {
  flex-direction: row;
  gap: 10px;
  padding: 10px 14px;
  border-radius: 14px;
  text-align: left;
  min-height: 0;
}
.hsb-unrated-emoji { font-size: 1.4rem; }
.hsb-unrated-text { display: inline-flex; flex-direction: column; }
.hsb-unrated-l1 {
  font-family: var(--font-display, "Cormorant Garamond"), serif;
  font-size: 1.05rem;
  font-weight: 600;
  font-style: italic;
  color: var(--text-base, #1f1a0f);
}
.hsb-unrated-l2 {
  font-family: var(--font-body, "DM Sans"), system-ui, sans-serif;
  font-size: 0.66rem;
  letter-spacing: 0.05em;
  color: var(--cozy-cocoa-soft, #6e5430);
}

/* Skeleton */
.hsb-skel {
  background: linear-gradient(160deg, var(--bg-card, #faf5eb), var(--bg-elevated, #fffcf6));
  width: 158px; min-height: 184px;
  overflow: hidden;
}
.hsb-skel-shimmer {
  position: absolute; inset: 0;
  background: linear-gradient(110deg, transparent 30%, rgba(255,255,255,0.7) 50%, transparent 70%);
  animation: hsb-shimmer 1.4s linear infinite;
}
@keyframes hsb-shimmer { to { transform: translateX(120%); } }

@media (prefers-reduced-motion: reduce) {
  .hsb-sweep, .hsb-live-dot, .hsb-skel-shimmer { animation: none; }
  .hsb-ring-fill { transition: none; }
}
`;
