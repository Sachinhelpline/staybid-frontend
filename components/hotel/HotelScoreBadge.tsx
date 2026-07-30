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
  rank: {
    rank: number | null;
    total: number;
    percentile: number | null;
    // v549 — cohort the rank was computed in: city | zone | national.
    scope?: "city" | "zone" | "national" | string;
    scopeLabel?: string | null;
  };
  checkpoints: any[];
  totals: { bookings: number; stayFeedback: number; complaints: number };
  computedAt: string;
};

const CACHE: Record<string, { data: Scorecard | null; at: number }> = {};
const TTL = 60_000;

/**
 * Seed the per-hotel scorecard cache from a batch fetch
 * (GET /api/hotels/scorecards?ids=…). List pages call this so the badges that
 * mount afterward read from cache instead of each firing its own request.
 * Safe to call repeatedly; freshest wins.
 */
export function seedScorecardCache(scorecards: Record<string, Scorecard | null> | null | undefined) {
  if (!scorecards) return;
  const at = Date.now();
  for (const id of Object.keys(scorecards)) {
    CACHE[id] = { data: scorecards[id] ?? null, at };
  }
}

export async function fetchScorecard(
  hotelId: string,
  opts?: { force?: boolean },
): Promise<Scorecard | null> {
  const cached = CACHE[hotelId];
  if (!opts?.force && cached && Date.now() - cached.at < TTL) return cached.data;
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

  const load = useCallback(async (force = false) => {
    setLoading(true);
    const data = await fetchScorecard(hotelId, { force });
    setCard(data);
    setLoading(false);
  }, [hotelId]);

  // v128.7 — Auto-upgrade flow. When the hotel transitions from
  // "unrated" to a real scorecard (e.g. customer just booked + admin/
  // cron recomputed), the badge picks it up automatically WITHOUT a
  // manual page reload via two triggers:
  //   1. Tab returns to foreground (`visibilitychange` → visible)
  //   2. Window regains focus (cross-tab switch on desktop)
  // Both run a force-refetch which bypasses the 60s in-memory cache.
  // Throttled: at most one refetch per 8s per hotel to avoid spam.
  useEffect(() => {
    if (typeof document === "undefined") return;
    let lastFetch = Date.now();
    const maybeRefresh = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastFetch < 8_000) return;
      lastFetch = Date.now();
      load(true).catch(() => {});
    };
    document.addEventListener("visibilitychange", maybeRefresh);
    window.addEventListener("focus", maybeRefresh);
    return () => {
      document.removeEventListener("visibilitychange", maybeRefresh);
      window.removeEventListener("focus", maybeRefresh);
    };
  }, [load]);

  useEffect(() => {
    mounted.current = true;
    if (!initial) load();
    return () => {
      mounted.current = false;
    };
  }, [hotelId, initial, load]);

  // v128.3 — Auto-reopen scorecard modal when user returns from the
  // /hotels/[id]/reviews or /feedback full-page routes. The modal sets
  // a sessionStorage flag BEFORE navigating; we read it here and
  // auto-open the modal after a tiny delay so the page renders first.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = sessionStorage.getItem("sb_scorecard_reopen");
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data?.hotelId === hotelId && Date.now() - data.at < 120_000) {
        sessionStorage.removeItem("sb_scorecard_reopen");
        const t = setTimeout(() => {
          if (mounted.current) setOpen(true);
        }, 280);
        return () => clearTimeout(t);
      }
    } catch {}
  }, [hotelId]);

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

  // ── Unrated (new hotel) — v128.6 ────────────────────────────────
  // Old horizontal pill clashed with the trophy+medal of rated cards on
  // the /hotels list. Now uses the SAME trophy+medal structure so every
  // card has consistent height + shape. NEW trophy is champagne-tinted,
  // medal disc shows a centered sparkle.
  if (isUnrated) {
    const ariaLabel = "Hotel score awaiting — first stays needed. Tap for details.";
    // Compact variant gets its own single-pill render below.
    if (variant === "compact") {
      return (
        <>
          <button
            type="button"
            className="hsb hsb-compact-pill hsb-tier-new"
            onClick={handleClick}
            aria-label={ariaLabel}
            title={ariaLabel}
          >
            <span className="hsb-cp-icon">✨</span>
            <span className="hsb-cp-text">NEW</span>
            <span className="hsb-cp-dot">·</span>
            <span className="hsb-cp-meta">awaiting score</span>
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
    return (
      <>
        <button
          type="button"
          className={`hsb hsb-${variant} hsb-medal-style hsb-tier-new`}
          onClick={handleClick}
          aria-label={ariaLabel}
          title={ariaLabel}
          style={{ ["--hsb-color" as any]: "#C9A66B" }}
        >
          <span className="hsb-trophy" aria-hidden>
            <span className="hsb-trophy-tail hsb-trophy-tail-l" />
            <span className="hsb-trophy-tail hsb-trophy-tail-r" />
            <span className="hsb-trophy-body">
              <span className="hsb-trophy-icon">✨</span>
              <span className="hsb-trophy-text">NEW</span>
            </span>
          </span>
          <span className="hsb-medal" aria-hidden>
            <span className="hsb-medal-sheen" />
            <span className="hsb-medal-inner">
              <span className="hsb-medal-new-emoji">✨</span>
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

  // v128.2 — user explicitly asked to spell out "RANK" instead of just
  // "1st / 2nd / 3rd / #N". Word "Rank" sits IN the ribbon so customers
  // never wonder what the number means.
  const rankLabel = rank.rank ? `Rank ${rank.rank}` : null;

  const rankIcon = rank.rank === 1 ? "🥇"
    : rank.rank === 2 ? "🥈"
    : rank.rank === 3 ? "🥉"
    : rank.rank && rank.rank <= 10 ? "🏆"
    : null;

  const rankWhere = rank.scopeLabel || card!.city || "its area";
  const ariaLabel = `Hotel performance score ${score} out of 100${
    rank.rank ? `, ranked ${rankLabel} of ${rank.total} in ${rankWhere}` : ""
  }. Tap for full breakdown.`;

  // v128.6 — Compact pill (used in reels + inline placements). Single
  // horizontal chip — no stacked trophy+medal, no clipping issues, fits
  // naturally next to other inline pills. Premium feel via tier-tinted
  // background + subtle inner glow.
  if (variant === "compact") {
    const ranked = !!rank.rank;
    return (
      <>
        <button
          type="button"
          className={`hsb hsb-compact-pill${rankTier ? ` hsb-tier-${rankTier}` : ""}`}
          onClick={handleClick}
          aria-label={ariaLabel}
          title={ariaLabel}
          style={{ ["--hsb-color" as any]: medalColor }}
        >
          <span className="hsb-cp-icon">{ranked ? rankIcon : badge.emoji}</span>
          <span className="hsb-cp-text">
            {ranked ? rankLabel : badge.label}
          </span>
          <span className="hsb-cp-dot">·</span>
          <span className="hsb-cp-score">
            {Math.round(animatedScore)}
            <span className="hsb-cp-denom">/100</span>
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

        {/* 3D medal disc — v128.4: "SCORE" label added inside for symmetry
            with the "Rank N" trophy ribbon above. Customer never wonders
            what the number means. */}
        <span className="hsb-medal" aria-hidden>
          <span className="hsb-medal-sheen" />
          <span className="hsb-medal-inner">
            <span className="hsb-medal-score-lbl">Score</span>
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
  /* v128.5 — gentle ambient breathing animation so users see this is
   *  interactive at a glance. Scales 100%↔102% over 2.8s, infinite. */
  animation: hsb-breathe 2.8s ease-in-out infinite;
}
@keyframes hsb-breathe {
  0%, 100% { transform: scale(1); }
  50%      { transform: scale(1.025); }
}
.hsb:hover {
  transform: translateY(-2px) scale(1.04);
  filter: drop-shadow(0 8px 18px rgba(31, 26, 15, 0.22));
  animation-play-state: paused;
}
.hsb:active { transform: translateY(0) scale(0.96); animation-play-state: paused; }
.hsb:focus-visible {
  outline: 2px solid var(--cozy-champagne, #C9A66B);
  outline-offset: 4px;
  border-radius: 12px;
}

/* v128.2 — Per-variant sizing.
 * Smaller than v128.1 across all breakpoints. User explicitly asked for
 * less screen real-estate on mobile + desktop hotels list cards. */
.hsb-hero { width: 78px; min-height: 100px; }
.hsb-card { width: 62px; min-height: 80px; }
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
  gap: 4px;
  padding: 4px 11px 5px;
  border-radius: 5px;
  background: linear-gradient(180deg, var(--hsb-trophy-light, #b4c1cf) 0%, var(--hsb-trophy-base, #C9A66B) 55%, var(--hsb-trophy-dark, #8B6914) 100%);
  color: #fcfcfd;
  font-family: var(--font-body, "DM Sans"), system-ui, sans-serif;
  font-weight: 800;
  font-size: 0.68rem;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  text-shadow: 0 1px 1px rgba(0,0,0,0.32);
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
/* Card-variant ribbon — slightly tighter but still readable */
.hsb-card .hsb-trophy-body { padding: 3px 8px 4px; font-size: 0.58rem; gap: 3px; }
.hsb-card .hsb-trophy-icon { font-size: 0.72rem; }
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
.hsb-tier-gold .hsb-trophy { --hsb-trophy-light: #e3e8ed; --hsb-trophy-base: #b4c1cf; --hsb-trophy-dark: #8B6914; }
/* Silver (2nd) ─ cool platinum sage */
.hsb-tier-silver .hsb-trophy { --hsb-trophy-light: #F0F0EC; --hsb-trophy-base: #C8C9C2; --hsb-trophy-dark: #6B7565; color: #fcfcfd; }
.hsb-tier-silver .hsb-trophy-body { color: #2B2415; text-shadow: 0 1px 0 rgba(255,255,255,0.45); }
/* Bronze (3rd) ─ warm copper */
.hsb-tier-bronze .hsb-trophy { --hsb-trophy-light: #E8B58A; --hsb-trophy-base: #B8794A; --hsb-trophy-dark: #6B3D1F; }
/* Champagne (4-10) */
.hsb-tier-champagne .hsb-trophy { --hsb-trophy-light: #c8d2dc; --hsb-trophy-base: #C9A66B; --hsb-trophy-dark: #8B6914; }
/* Muted (11+) */
.hsb-tier-muted .hsb-trophy { --hsb-trophy-light: #b4c1cf; --hsb-trophy-base: #849ab1; --hsb-trophy-dark: #6E5430; }
/* Citywide (no rank — show badge label) */
.hsb-trophy-citywide { --hsb-trophy-light: #b4c1cf; --hsb-trophy-base: #C9A66B; --hsb-trophy-dark: #6E5430; }
/* New (unrated) — soft champagne — v128.6 */
.hsb-tier-new .hsb-trophy { --hsb-trophy-light: #dae1e7; --hsb-trophy-base: #b4c1cf; --hsb-trophy-dark: #8B6914; }

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
  /* v128.5 — pulsing ring radiates outward to telegraph "clickable" */
  --hsb-pulse-color: var(--hsb-color, #C9A66B);
}
.hsb-medal::after {
  content: "";
  position: absolute;
  inset: -2px;
  border-radius: 50%;
  pointer-events: none;
  box-shadow: 0 0 0 0 color-mix(in oklab, var(--hsb-pulse-color, #C9A66B) 70%, transparent);
  animation: hsb-pulse-ring 2.4s cubic-bezier(.4, 0, .2, 1) infinite;
  opacity: 0.95;
}
@keyframes hsb-pulse-ring {
  0% {
    box-shadow: 0 0 0 0 color-mix(in oklab, var(--hsb-pulse-color, #C9A66B) 70%, transparent);
  }
  70% {
    box-shadow: 0 0 0 14px color-mix(in oklab, var(--hsb-pulse-color, #C9A66B) 0%, transparent);
  }
  100% {
    box-shadow: 0 0 0 0 color-mix(in oklab, var(--hsb-pulse-color, #C9A66B) 0%, transparent);
  }
}
/* Medal background-stack — overflow REMOVED so ::after pulse ring is
 * not clipped by the disc edge. The sheen self-clips via border-radius:50%
 * so removing overflow:hidden here doesn't break the metallic shimmer. */
.hsb .hsb-medal {
  background:
    radial-gradient(circle at 32% 28%, rgba(255, 255, 255, 0.85) 0%, rgba(255, 255, 255, 0.0) 38%),
    radial-gradient(circle at 50% 50%, var(--hsb-color, #C9A66B) 0%, color-mix(in oklab, var(--hsb-color, #C9A66B) 70%, #2B2415) 100%);
  box-shadow:
    0 14px 28px -10px rgba(31, 26, 15, 0.50),
    0 5px 10px -3px rgba(31, 26, 15, 0.32),
    0 0 0 2px color-mix(in oklab, var(--hsb-color, #C9A66B) 60%, #fcfcfd),
    inset 0 3px 5px rgba(255, 255, 255, 0.55),
    inset 0 -4px 7px rgba(31, 26, 15, 0.30),
    inset 0 0 0 1px rgba(255, 255, 255, 0.25);
  isolation: isolate;
}
.hsb-hero .hsb-medal { width: 70px; height: 70px; }
.hsb-card .hsb-medal { width: 56px; height: 56px; }
.hsb-compact .hsb-medal { width: 38px; height: 38px; }

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
/* v128.7 — Font sizes bumped 18-30% across all variants for visibility
   on desktop especially. Stronger color contrast (cream 0.95 vs 0.78). */
.hsb-medal-score-lbl {
  font-family: var(--font-body, "DM Sans"), system-ui, sans-serif;
  font-size: 0.52rem;
  font-weight: 800;
  letter-spacing: 0.14em;
  color: rgba(176, 192, 209, 0.92);
  text-transform: uppercase;
  line-height: 1;
  margin-bottom: 2px;
  text-shadow: 0 1px 1px rgba(0, 0, 0, 0.32);
}
.hsb-medal-num {
  font-family: var(--font-display, "Cormorant Garamond"), Georgia, serif;
  font-weight: 700;
  font-style: italic;
  font-size: 1.65rem;
  color: #fcfcfd;
  letter-spacing: -0.02em;
  font-feature-settings: "tnum" 1;
  line-height: 1;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.28);
}
.hsb-medal-denom {
  font-family: var(--font-body, "DM Sans"), system-ui, sans-serif;
  font-size: 0.56rem;
  font-weight: 700;
  letter-spacing: 0.10em;
  color: rgba(176, 192, 209, 0.95);
  margin-top: 1px;
  text-transform: uppercase;
  line-height: 1;
  text-shadow: 0 1px 1px rgba(0, 0, 0, 0.28);
}
.hsb-card .hsb-medal-num { font-size: 1.3rem; }
.hsb-card .hsb-medal-denom { font-size: 0.5rem; }
.hsb-card .hsb-medal-score-lbl { font-size: 0.46rem; letter-spacing: 0.12em; }
/* v128.6 — Big sparkle for unrated state, replaces the score number */
.hsb-medal-new-emoji {
  font-size: 1.6rem;
  line-height: 1;
  filter: drop-shadow(0 2px 3px rgba(31, 26, 15, 0.32));
  animation: hsb-new-twinkle 2.4s ease-in-out infinite;
}
.hsb-card .hsb-medal-new-emoji { font-size: 1.3rem; }
@keyframes hsb-new-twinkle {
  0%, 100% { transform: scale(1) rotate(0deg); opacity: 0.95; }
  50%      { transform: scale(1.12) rotate(8deg); opacity: 1; }
}

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

/* ── v128.6 — Compact PILL variant ──────────────────────────────────
 * Single horizontal chip — replaces the v128.4 stacked trophy+medal
 * compact rendering which was cramped on inline placements (reels,
 * pill rows). Premium feel via tier-tinted gradient + champagne
 * highlight inner stroke. Drop-shadow + breathing animation reuse
 * the .hsb base rules above. */
.hsb-compact-pill {
  flex-direction: row;
  align-items: center;
  justify-content: center;
  gap: 7px;
  padding: 6px 13px 6px 11px;
  border-radius: 999px;
  min-height: 30px;
  background: linear-gradient(
    180deg,
    color-mix(in oklab, var(--hsb-color, #C9A66B) 22%, var(--bg-elevated, #fcfcfd)) 0%,
    color-mix(in oklab, var(--hsb-color, #C9A66B) 10%, var(--bg-card, #f4f6f8)) 100%
  );
  border: 1.5px solid color-mix(in oklab, var(--hsb-color, #C9A66B) 60%, transparent);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.65),
    inset 0 -1px 0 color-mix(in oklab, var(--hsb-color, #C9A66B) 22%, transparent),
    0 3px 8px rgba(31, 26, 15, 0.14);
  white-space: nowrap;
  font-family: var(--font-body, "DM Sans"), system-ui, sans-serif;
  color: var(--text-base, #1f1a0f);
  animation: hsb-breathe 3.2s ease-in-out infinite;
}
.hsb-compact-pill .hsb-cp-icon {
  font-size: 1rem;
  line-height: 1;
  filter: drop-shadow(0 1px 1px rgba(31, 26, 15, 0.22));
}
.hsb-compact-pill .hsb-cp-text {
  font-family: var(--font-body, "DM Sans"), system-ui, sans-serif;
  font-size: 0.78rem;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: color-mix(in oklab, var(--hsb-color, #C9A66B) 70%, var(--cozy-warm-dark, #1f1a0f));
}
.hsb-compact-pill .hsb-cp-dot {
  color: var(--cozy-cocoa-soft, #6e5430);
  opacity: 0.65;
  font-size: 0.85rem;
  line-height: 1;
}
.hsb-compact-pill .hsb-cp-score {
  font-family: var(--font-display, "Cormorant Garamond"), serif;
  font-style: italic;
  font-weight: 700;
  font-size: 1.15rem;
  line-height: 1;
  color: var(--text-base, #1f1a0f);
  font-feature-settings: "tnum" 1;
}
.hsb-compact-pill .hsb-cp-denom {
  font-family: var(--font-body, "DM Sans"), system-ui, sans-serif;
  font-style: normal;
  font-size: 0.62rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: var(--cozy-cocoa-soft, #6e5430);
  margin-left: 2px;
}
.hsb-compact-pill .hsb-cp-meta {
  font-size: 0.66rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--cozy-cocoa-soft, #6e5430);
  text-transform: none;
}

/* Compact pill — narrow phones (iPhone SE ≤ 380px) */
@media (max-width: 380px) {
  .hsb-compact-pill { padding: 5px 11px 5px 9px; gap: 6px; min-height: 26px; }
  .hsb-compact-pill .hsb-cp-icon { font-size: 0.88rem; }
  .hsb-compact-pill .hsb-cp-text { font-size: 0.7rem; }
  .hsb-compact-pill .hsb-cp-score { font-size: 1rem; }
  .hsb-compact-pill .hsb-cp-denom { font-size: 0.56rem; }
  .hsb-compact-pill .hsb-cp-meta { font-size: 0.58rem; }
}
/* Compact pill — laptop */
@media (min-width: 1024px) {
  .hsb-compact-pill { min-height: 34px; padding: 7px 14px 7px 12px; }
  .hsb-compact-pill .hsb-cp-icon { font-size: 1.1rem; }
  .hsb-compact-pill .hsb-cp-text { font-size: 0.82rem; }
  .hsb-compact-pill .hsb-cp-score { font-size: 1.25rem; }
  .hsb-compact-pill .hsb-cp-denom { font-size: 0.68rem; }
  .hsb-compact-pill .hsb-cp-meta { font-size: 0.72rem; }
}
/* Compact pill — desktop wide */
@media (min-width: 1440px) {
  .hsb-compact-pill { min-height: 36px; }
  .hsb-compact-pill .hsb-cp-text { font-size: 0.86rem; }
  .hsb-compact-pill .hsb-cp-score { font-size: 1.35rem; }
}

/* Dark mode parity */
[data-theme="dark"] .hsb-compact-pill {
  background: linear-gradient(
    180deg,
    color-mix(in oklab, var(--hsb-color, #C9A66B) 22%, var(--cozy-warm-soft, #2B2415)) 0%,
    color-mix(in oklab, var(--hsb-color, #C9A66B) 12%, var(--cozy-warm-dark, #1F1A0F)) 100%
  );
  color: var(--cozy-cream-50, #fcfcfd);
}
[data-theme="dark"] .hsb-compact-pill .hsb-cp-text { color: var(--cozy-champagne-light, #b4c1cf); }
[data-theme="dark"] .hsb-compact-pill .hsb-cp-score { color: var(--cozy-cream-50, #fcfcfd); }
[data-theme="dark"] .hsb-compact-pill .hsb-cp-denom { color: rgba(176, 192, 209, 0.55); }
[data-theme="dark"] .hsb-compact-pill .hsb-cp-meta { color: rgba(176, 192, 209, 0.62); }

/* Skeleton ───────────────────────────────────────────────────────── */
.hsb-skel {
  position: relative;
  border-radius: 50%;
  overflow: hidden;
  background: linear-gradient(160deg, var(--bg-card, #f4f6f8), var(--bg-elevated, #fcfcfd));
}
.hsb-skel.hsb-hero { width: 78px; height: 100px; border-radius: 14px; }
.hsb-skel.hsb-card { width: 62px; height: 80px; border-radius: 12px; }
.hsb-skel.hsb-compact { width: 92px; height: 32px; border-radius: 999px; }
.hsb-skel-shimmer {
  position: absolute; inset: 0;
  background: linear-gradient(110deg, transparent 30%, rgba(255,255,255,0.6) 50%, transparent 70%);
  animation: hsb-shimmer 1.4s linear infinite;
}
@keyframes hsb-shimmer { to { transform: translateX(120%); } }

/* ── Responsive breakpoints (v128.2 — shrunk ~20% across the board) ─── */
/* Mobile-first defaults are above. Scale UP gently on larger screens. */

/* v128.7 — All responsive breakpoints bumped for visibility.
 * Desktop especially needed bigger fonts. */

/* Tablet (>= 600px) */
@media (min-width: 600px) {
  .hsb-hero { width: 92px; min-height: 116px; }
  .hsb-hero .hsb-medal { width: 82px; height: 82px; }
  .hsb-hero .hsb-medal-num { font-size: 1.85rem; }
  .hsb-hero .hsb-medal-denom { font-size: 0.6rem; }
  .hsb-hero .hsb-medal-score-lbl { font-size: 0.56rem; }
  .hsb-hero .hsb-trophy-body { font-size: 0.72rem; padding: 4px 12px 5px; }
}

/* Laptop (>= 1024px) */
@media (min-width: 1024px) {
  .hsb-hero { width: 100px; min-height: 124px; }
  .hsb-hero .hsb-medal { width: 88px; height: 88px; }
  .hsb-hero .hsb-medal-num { font-size: 2rem; }
  .hsb-hero .hsb-medal-denom { font-size: 0.62rem; }
  .hsb-hero .hsb-medal-score-lbl { font-size: 0.58rem; }
  .hsb-hero .hsb-trophy-body { font-size: 0.75rem; padding: 5px 13px; }
  .hsb-hero .hsb-trophy-tail { width: 9px; height: 14px; }
  .hsb-card { width: 76px; min-height: 96px; }
  .hsb-card .hsb-medal { width: 66px; height: 66px; }
  .hsb-card .hsb-medal-num { font-size: 1.4rem; }
  .hsb-card .hsb-medal-denom { font-size: 0.52rem; }
  .hsb-card .hsb-medal-score-lbl { font-size: 0.48rem; }
}

/* Desktop (>= 1440px) */
@media (min-width: 1440px) {
  .hsb-hero { width: 108px; min-height: 132px; }
  .hsb-hero .hsb-medal { width: 94px; height: 94px; }
  .hsb-hero .hsb-medal-num { font-size: 2.15rem; }
  .hsb-hero .hsb-medal-denom { font-size: 0.66rem; }
  .hsb-hero .hsb-medal-score-lbl { font-size: 0.6rem; }
}

/* Very narrow phones (iPhone SE ≤ 380px) */
@media (max-width: 380px) {
  .hsb-hero { width: 76px; min-height: 100px; }
  .hsb-hero .hsb-medal { width: 68px; height: 68px; }
  .hsb-hero .hsb-medal-num { font-size: 1.4rem; }
  .hsb-hero .hsb-medal-denom { font-size: 0.48rem; }
  .hsb-hero .hsb-medal-score-lbl { font-size: 0.44rem; letter-spacing: 0.10em; }
  .hsb-hero .hsb-trophy-body { padding: 3px 9px 4px; font-size: 0.6rem; }
  .hsb-hero .hsb-trophy-tail { width: 8px; height: 12px; }
  .hsb-hero .hsb-trophy-icon { font-size: 0.7rem; }
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
  .hsb-medal-sheen, .hsb-medal-live-dot, .hsb-skel-shimmer,
  .hsb-medal::after, .hsb { animation: none; }
  .hsb { transition: none; }
}
`;
