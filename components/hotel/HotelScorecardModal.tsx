"use client";
/*
 * v128 — Hotel Performance Scorecard detailed modal.
 *
 * Opens when the user taps the live score badge. Shows:
 *   - Hero: animated overall score + rank-in-city + status tier
 *   - Checkpoint cards: 10 weighted metrics with earned/weight bars
 *     + sentiment-tinted background + plain-English evidence line
 *   - Headline counts: bookings / stay feedback / complaints
 *   - "Compare in {city}" link → opens /hotels?city=X sorted by score
 *
 * Premium cozy palette — reads v90 theme tokens so both modes work.
 * Full keyboard support (Esc closes), focus-trap, body-scroll-lock,
 * touch-friendly bottom-sheet on mobile.
 */
import { useEffect, useMemo, useRef, useCallback, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";

// v128.3 — Clickable checkpoints navigate to dedicated full-page routes
// (replaces the v128.2 in-modal drill-down which felt cramped on mobile).
// User asked: "actual real page par jump karo" — when tapped, the page
// fills the screen, no blur/overlap, and back/close returns to wherever
// they came from with the scorecard modal auto-reopened.
const DRILL_DOWN_KEYS = new Set(["starRating", "staySmiley"]);
const DRILL_DOWN_PATH: Record<string, string> = {
  starRating: "reviews",
  staySmiley: "feedback",
};

// v128.3 — Review payload types live in the dedicated full-page routes
// at /hotels/[id]/reviews + /hotels/[id]/feedback. The modal no longer
// loads reviews itself; tap a drill-down checkpoint and the user is
// navigated there with `?return=<currentPath>&from=scorecard` so back
// brings them right back to where they were.

type Scorecard = {
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

type Props = {
  hotelId: string;
  hotelName?: string;
  card: Scorecard | null;
  onClose: () => void;
  onRefresh?: () => void;
};

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function statusTone(status: string): string {
  if (status === "excellent") return "#7F9269";
  if (status === "good") return "#C9A66B";
  if (status === "fair") return "#D9BE82";
  return "#D49583";
}

function checkpointTone(s: string): string {
  if (s === "excellent") return "#7F9269";
  if (s === "good") return "#C9A66B";
  if (s === "fair") return "#D9BE82";
  if (s === "poor") return "#D49583";
  return "#6E5430";
}

export default function HotelScorecardModal({
  hotelId,
  hotelName,
  card,
  onClose,
  onRefresh,
}: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const pathname = usePathname();

  // ── Esc / body lock ─────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  // ── Navigate to a dedicated full page on checkpoint tap (v128.3) ──
  // Stores a session flag so the BADGE on the return page auto-re-opens
  // this modal once the user lands back. Matches user spec exactly:
  // "X ya jaishe bhi close kare toh fir se automatic ushko performance
  // scorecard wali screen par rahe jahan se click kiya tha".
  const openDrillDown = useCallback(
    (key: string) => {
      if (!DRILL_DOWN_KEYS.has(key)) return;
      const path = DRILL_DOWN_PATH[key];
      if (!path) return;
      // Stash the reopen intent BEFORE navigating so race conditions
      // can't lose it. Badge will pick it up on mount.
      try {
        sessionStorage.setItem(
          "sb_scorecard_reopen",
          JSON.stringify({ hotelId, at: Date.now() }),
        );
      } catch {}
      const returnUrl = pathname || `/hotels/${hotelId}`;
      const qs = new URLSearchParams({
        return: returnUrl,
        from: "scorecard",
      });
      if (hotelName) qs.set("hotel", hotelName);
      router.push(`/hotels/${encodeURIComponent(hotelId)}/${path}?${qs.toString()}`);
      onClose();
    },
    [hotelId, hotelName, pathname, router, onClose],
  );

  const checkpoints = card?.checkpoints || [];

  const rankLine = useMemo(() => {
    if (!card) return null;
    const r = card.rank;
    if (r.rank == null || r.total === 0) return null;
    return `Ranked ${ordinal(r.rank)} of ${r.total}${
      card.city ? ` in ${card.city}` : ""
    }${r.percentile != null ? ` · top ${Math.max(1, 100 - Math.round(r.percentile))}%` : ""}`;
  }, [card]);

  const tone = card ? statusTone(card.status) : "#C9A66B";

  // v128.5 — Portal render. The modal was visually clipped on the
  // /flash-deals page because each .fd-card has `overflow:hidden` and
  // the modal mounted INSIDE that card got clipped to the card bounds.
  // Same issue would hit any future surface that wraps the badge in a
  // transform / filter / contain ancestor (Reels has many of those).
  // Mounting at document.body guarantees the modal escapes EVERY parent
  // stacking context and reliably covers the full viewport.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const modal = (
    <div
      className="hsm-backdrop"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Hotel performance scorecard"
    >
      <div
        className="hsm-sheet"
        ref={dialogRef}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Hero */}
        <div className="hsm-hero" style={{ background: `linear-gradient(150deg, ${tone}22 0%, var(--bg-card, #faf5eb) 60%)` }}>
          <button
            type="button"
            className="hsm-close"
            onClick={onClose}
            aria-label="Close scorecard"
          >
            ✕
          </button>

          <div className="hsm-hero-eyebrow">PERFORMANCE SCORECARD</div>
          <div className="hsm-hero-title">
            {hotelName || "This hotel"}
          </div>
          {rankLine ? (
            <div className="hsm-hero-rank">
              <span className="hsm-rank-emoji">{card?.badge.emoji}</span>
              <span>{rankLine}</span>
            </div>
          ) : null}

          <div className="hsm-hero-score-row">
            <div className="hsm-hero-score">
              <span className="hsm-hero-num">
                {card?.overall != null ? card.overall.toFixed(1) : "—"}
              </span>
              <span className="hsm-hero-denom">/ 100</span>
            </div>
            <div
              className="hsm-hero-status"
              style={{ borderColor: tone, color: tone }}
            >
              <span style={{ fontSize: "1.2rem", lineHeight: 1 }}>{card?.badge.emoji}</span>
              <span style={{ fontWeight: 600 }}>{card?.badge.label}</span>
            </div>
          </div>

          {/* Headline counts */}
          {card ? (
            <div className="hsm-tally">
              <div className="hsm-tally-cell">
                <div className="hsm-tally-num">{card.totals.bookings}</div>
                <div className="hsm-tally-lbl">Bookings</div>
              </div>
              <div className="hsm-tally-divider" />
              <div className="hsm-tally-cell">
                <div className="hsm-tally-num">{card.totals.stayFeedback}</div>
                <div className="hsm-tally-lbl">Stay reviews</div>
              </div>
              <div className="hsm-tally-divider" />
              <div className="hsm-tally-cell">
                <div className="hsm-tally-num">{card.totals.complaints}</div>
                <div className="hsm-tally-lbl">Complaints</div>
              </div>
            </div>
          ) : null}
        </div>

        {/* Checkpoint cards */}
        <div className="hsm-body">
          <div className="hsm-section-title">
            <span>Score breakdown</span>
            <span className="hsm-section-sub">
              {checkpoints.length} checkpoints · weighted out of 100
            </span>
          </div>

          <ul className="hsm-checkpoint-list">
            {checkpoints.map((c: any) => {
              const ctone = checkpointTone(c.status);
              const fillPct = Math.max(0, Math.min(100, c.pct || 0));
              const isClickable = DRILL_DOWN_KEYS.has(c.key);
              const onCpClick = () => {
                if (isClickable) openDrillDown(c.key);
              };
              const onCpKey = (e: React.KeyboardEvent) => {
                if (!isClickable) return;
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  openDrillDown(c.key);
                }
              };
              return (
                <li
                  key={c.key}
                  className={`hsm-checkpoint${isClickable ? " hsm-checkpoint-clickable" : ""}`}
                  style={{
                    borderLeftColor: ctone,
                    // accent color for the clickable highlight border
                    ...(isClickable ? ({ ["--hsm-cp-accent" as any]: ctone } as any) : {}),
                  }}
                  onClick={isClickable ? onCpClick : undefined}
                  onKeyDown={isClickable ? onCpKey : undefined}
                  role={isClickable ? "button" : undefined}
                  tabIndex={isClickable ? 0 : undefined}
                  aria-label={
                    isClickable
                      ? `${c.label}, scored ${Math.round(c.earned * 10) / 10} of ${c.weight}. Tap to view every review.`
                      : undefined
                  }
                >
                  <div className="hsm-checkpoint-row">
                    <span className="hsm-checkpoint-icon" aria-hidden>{c.emoji}</span>
                    <div className="hsm-checkpoint-text">
                      <div className="hsm-checkpoint-label">
                        {c.label}
                        {isClickable ? (
                          <span className="hsm-checkpoint-pill" aria-hidden>
                            Tap to read
                          </span>
                        ) : null}
                      </div>
                      <div className="hsm-checkpoint-evidence">{c.evidence}</div>
                    </div>
                    <div className="hsm-checkpoint-points">
                      <span className="hsm-checkpoint-earned" style={{ color: ctone }}>
                        {Math.round(c.earned * 10) / 10}
                      </span>
                      <span className="hsm-checkpoint-weight">/{c.weight}</span>
                    </div>
                  </div>

                  <div className="hsm-checkpoint-bar">
                    <div
                      className="hsm-checkpoint-bar-fill"
                      style={{
                        width: `${fillPct}%`,
                        background: `linear-gradient(90deg, ${ctone}cc, ${ctone}99)`,
                      }}
                    />
                  </div>

                  <div className="hsm-checkpoint-row-bottom">
                    {c.sampleSize > 0 ? (
                      <div className="hsm-checkpoint-sample">
                        Based on {c.sampleSize} data point{c.sampleSize === 1 ? "" : "s"}
                      </div>
                    ) : (
                      <div className="hsm-checkpoint-sample hsm-checkpoint-sample-empty">
                        Not enough data yet — baseline credit applied
                      </div>
                    )}
                    {isClickable ? (
                      <span className="hsm-checkpoint-chevron" aria-hidden>
                        See all →
                      </span>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>

          {/* Footer actions */}
          <div className="hsm-footer">
            {card?.city ? (
              <Link
                href={`/hotels?city=${encodeURIComponent(card.city)}#scorecard-leaderboard`}
                className="hsm-cta-compare"
                onClick={onClose}
              >
                Compare with all {card.rank.total || ""} hotels in {card.city} →
              </Link>
            ) : null}
            {onRefresh ? (
              <button
                type="button"
                onClick={() => {
                  onRefresh();
                }}
                className="hsm-cta-refresh"
                aria-label="Refresh scorecard"
              >
                ↻ Refresh
              </button>
            ) : null}
          </div>

          <div className="hsm-fineprint">
            Score updates live as bids, stays + feedback flow in.
            Computed {card ? new Date(card.computedAt).toLocaleString() : "—"}.
          </div>
        </div>
      </div>

      <style jsx>{`
        .hsm-backdrop {
          position: fixed;
          inset: 0;
          background: rgba(31, 26, 15, 0.62);
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
          z-index: 1000;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: env(safe-area-inset-top, 0) 16px env(safe-area-inset-bottom, 0);
          animation: hsm-fade .25s ease-out;
        }
        @keyframes hsm-fade { from { opacity: 0 } to { opacity: 1 } }

        .hsm-sheet {
          position: relative;
          width: 100%;
          max-width: 640px;
          max-height: 92dvh;
          overflow-y: auto;
          background: var(--bg-card, #faf5eb);
          color: var(--text-base, #1f1a0f);
          border-radius: 22px;
          box-shadow:
            0 1px 0 rgba(255,255,255,0.6) inset,
            0 30px 80px -22px rgba(31, 26, 15, 0.45),
            0 0 0 1px rgba(201, 166, 107, 0.25);
          animation: hsm-rise .35s cubic-bezier(.22,1,.36,1);
          -webkit-overflow-scrolling: touch;
        }
        @media (max-width: 600px) {
          .hsm-backdrop { align-items: flex-end; padding: 0; }
          .hsm-sheet {
            max-width: 100%;
            border-radius: 22px 22px 0 0;
            max-height: 90dvh;
          }
        }
        @keyframes hsm-rise {
          from { transform: translateY(28px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }

        .hsm-hero {
          padding: 22px 22px 18px;
          position: relative;
          border-radius: 22px 22px 0 0;
        }
        .hsm-close {
          position: absolute;
          top: 12px;
          right: 12px;
          width: 34px; height: 34px;
          border-radius: 50%;
          border: 1px solid rgba(201, 166, 107, 0.35);
          background: rgba(255, 252, 246, 0.85);
          color: var(--cozy-cocoa, #4a3820);
          font-size: 0.85rem;
          cursor: pointer;
          z-index: 4;
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }
        .hsm-close:hover { background: var(--bg-elevated, #fffcf6); }

        .hsm-hero-eyebrow {
          font-family: var(--font-body, "DM Sans"), system-ui, sans-serif;
          font-size: 0.62rem;
          letter-spacing: 0.22em;
          text-transform: uppercase;
          color: var(--cozy-cocoa-soft, #6e5430);
          margin-bottom: 6px;
        }
        .hsm-hero-title {
          font-family: var(--font-display, "Cormorant Garamond"), serif;
          font-size: 1.6rem;
          font-weight: 600;
          letter-spacing: -0.005em;
          font-style: italic;
          line-height: 1.15;
          color: var(--text-base, #1f1a0f);
        }
        .hsm-hero-rank {
          margin-top: 6px;
          display: inline-flex;
          gap: 6px;
          align-items: center;
          font-family: var(--font-body, "DM Sans"), system-ui, sans-serif;
          font-size: 0.78rem;
          color: var(--cozy-cocoa, #4a3820);
        }
        .hsm-rank-emoji { font-size: 1rem; }

        .hsm-hero-score-row {
          margin-top: 14px;
          display: flex;
          align-items: center;
          gap: 16px;
          flex-wrap: wrap;
        }
        .hsm-hero-score {
          display: inline-flex;
          align-items: baseline;
          gap: 2px;
          font-family: var(--font-display, "Cormorant Garamond"), serif;
          font-feature-settings: "tnum" 1;
        }
        .hsm-hero-num { font-size: 3rem; font-weight: 600; line-height: 1; }
        .hsm-hero-denom {
          font-size: 0.95rem;
          color: var(--cozy-cocoa-soft, #6e5430);
          letter-spacing: 0.04em;
        }
        .hsm-hero-status {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 8px 14px;
          border: 1.5px solid;
          border-radius: 999px;
          font-family: var(--font-body, "DM Sans"), system-ui, sans-serif;
          font-size: 0.82rem;
          background: rgba(255, 252, 246, 0.6);
        }

        .hsm-tally {
          margin-top: 16px;
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px 14px;
          border-radius: 14px;
          background: rgba(255, 252, 246, 0.7);
          border: 1px solid rgba(201, 166, 107, 0.22);
        }
        .hsm-tally-cell { flex: 1; text-align: center; }
        .hsm-tally-num {
          font-family: var(--font-display, "Cormorant Garamond"), serif;
          font-size: 1.4rem;
          font-weight: 600;
          color: var(--text-base, #1f1a0f);
          line-height: 1;
        }
        .hsm-tally-lbl {
          margin-top: 3px;
          font-family: var(--font-body, "DM Sans"), system-ui, sans-serif;
          font-size: 0.6rem;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: var(--cozy-cocoa-soft, #6e5430);
        }
        .hsm-tally-divider {
          width: 1px; align-self: stretch;
          background: rgba(201, 166, 107, 0.3);
        }

        .hsm-body { padding: 18px 18px 22px; }
        .hsm-section-title {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: 10px;
          margin-bottom: 10px;
          flex-wrap: wrap;
        }
        .hsm-section-title > span:first-child {
          font-family: var(--font-display, "Cormorant Garamond"), serif;
          font-size: 1.1rem;
          font-style: italic;
          font-weight: 600;
        }
        .hsm-section-sub {
          font-family: var(--font-body, "DM Sans"), system-ui, sans-serif;
          font-size: 0.66rem;
          letter-spacing: 0.16em;
          text-transform: uppercase;
          color: var(--cozy-cocoa-soft, #6e5430);
        }

        .hsm-checkpoint-list {
          list-style: none;
          padding: 0;
          margin: 0;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .hsm-checkpoint {
          padding: 12px 14px 10px;
          border-radius: 14px;
          background: var(--bg-elevated, #fffcf6);
          border: 1px solid rgba(201, 166, 107, 0.18);
          border-left: 4px solid;
          transition: transform .2s, box-shadow .2s;
        }
        @media (hover: hover) {
          .hsm-checkpoint:hover {
            transform: translateY(-1px);
            box-shadow: 0 8px 18px -10px rgba(31, 26, 15, 0.25);
          }
        }
        .hsm-checkpoint-row {
          display: flex;
          gap: 10px;
          align-items: flex-start;
        }
        .hsm-checkpoint-icon {
          font-size: 1.4rem;
          flex-shrink: 0;
          line-height: 1.1;
        }
        .hsm-checkpoint-text { flex: 1; min-width: 0; }
        .hsm-checkpoint-label {
          font-family: var(--font-display, "Cormorant Garamond"), serif;
          font-size: 1.05rem;
          font-weight: 600;
          color: var(--text-base, #1f1a0f);
          line-height: 1.2;
        }
        .hsm-checkpoint-evidence {
          margin-top: 2px;
          font-family: var(--font-body, "DM Sans"), system-ui, sans-serif;
          font-size: 0.78rem;
          color: var(--cozy-cocoa, #4a3820);
          line-height: 1.35;
        }
        .hsm-checkpoint-points {
          flex-shrink: 0;
          font-family: var(--font-display, "Cormorant Garamond"), serif;
          font-feature-settings: "tnum" 1;
          font-size: 0.95rem;
          display: inline-flex;
          align-items: baseline;
          gap: 1px;
        }
        .hsm-checkpoint-earned { font-weight: 600; font-size: 1.15rem; }
        .hsm-checkpoint-weight {
          color: var(--cozy-cocoa-soft, #6e5430);
          font-size: 0.85rem;
        }
        .hsm-checkpoint-bar {
          margin-top: 8px;
          height: 6px;
          border-radius: 999px;
          background: rgba(201, 166, 107, 0.16);
          overflow: hidden;
        }
        .hsm-checkpoint-bar-fill {
          height: 100%;
          border-radius: 999px;
          transition: width .9s cubic-bezier(.22,1,.36,1);
        }
        .hsm-checkpoint-sample {
          margin-top: 6px;
          font-family: var(--font-body, "DM Sans"), system-ui, sans-serif;
          font-size: 0.62rem;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--cozy-cocoa-soft, #6e5430);
        }
        .hsm-checkpoint-sample-empty { opacity: 0.7; }

        .hsm-footer {
          margin-top: 18px;
          display: flex;
          gap: 10px;
          align-items: center;
          flex-wrap: wrap;
        }
        .hsm-cta-compare {
          flex: 1 1 220px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: 12px 16px;
          border-radius: 12px;
          background: linear-gradient(135deg, var(--cozy-champagne, #c9a66b), var(--cozy-champagne-light, #d9be82));
          color: var(--cozy-warm-dark, #1f1a0f);
          font-family: var(--font-body, "DM Sans"), system-ui, sans-serif;
          font-weight: 700;
          text-decoration: none;
          font-size: 0.85rem;
          letter-spacing: 0.03em;
          box-shadow: 0 10px 24px -12px rgba(201, 166, 107, 0.55);
          transition: transform .2s;
        }
        .hsm-cta-compare:hover { transform: translateY(-1px); }

        .hsm-cta-refresh {
          padding: 11px 14px;
          border-radius: 12px;
          border: 1px solid rgba(201, 166, 107, 0.4);
          background: var(--bg-elevated, #fffcf6);
          color: var(--cozy-cocoa, #4a3820);
          font-family: var(--font-body, "DM Sans"), system-ui, sans-serif;
          font-weight: 600;
          font-size: 0.78rem;
          cursor: pointer;
        }
        .hsm-cta-refresh:hover { background: var(--bg-card, #faf5eb); }

        .hsm-fineprint {
          margin-top: 14px;
          text-align: center;
          font-family: var(--font-body, "DM Sans"), system-ui, sans-serif;
          font-size: 0.66rem;
          color: var(--cozy-cocoa-soft, #6e5430);
          letter-spacing: 0.04em;
        }

        /* ── v128.2: clickable checkpoint highlight ───────────────── */
        .hsm-checkpoint-clickable {
          cursor: pointer;
          background: linear-gradient(180deg,
            color-mix(in oklab, var(--hsm-cp-accent, #C9A66B) 10%, transparent) 0%,
            var(--bg-card, #faf5eb) 100%);
          border: 1.5px solid color-mix(in oklab, var(--hsm-cp-accent, #C9A66B) 50%, transparent);
          box-shadow:
            0 4px 12px -6px color-mix(in oklab, var(--hsm-cp-accent, #C9A66B) 60%, transparent),
            inset 0 1px 0 rgba(255, 255, 255, 0.5);
          transition: transform 0.18s ease, box-shadow 0.22s ease, border-color 0.2s;
        }
        .hsm-checkpoint-clickable:hover,
        .hsm-checkpoint-clickable:focus-visible {
          transform: translateY(-2px);
          border-color: color-mix(in oklab, var(--hsm-cp-accent, #C9A66B) 90%, transparent);
          box-shadow:
            0 8px 18px -6px color-mix(in oklab, var(--hsm-cp-accent, #C9A66B) 65%, transparent),
            inset 0 1px 0 rgba(255, 255, 255, 0.6);
          outline: none;
        }
        .hsm-checkpoint-clickable:active { transform: translateY(0); }
        .hsm-checkpoint-pill {
          display: inline-block;
          margin-left: 8px;
          padding: 2px 7px;
          font-size: 0.55rem;
          font-family: var(--font-body, "DM Sans"), system-ui, sans-serif;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--cozy-cocoa, #4a3820);
          background: linear-gradient(180deg, rgba(255,255,255,0.7), rgba(255,255,255,0.3));
          border: 1px solid color-mix(in oklab, var(--hsm-cp-accent, #C9A66B) 55%, transparent);
          border-radius: 999px;
          vertical-align: middle;
        }
        .hsm-checkpoint-row-bottom {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          margin-top: 6px;
        }
        .hsm-checkpoint-chevron {
          font-family: var(--font-body, "DM Sans"), system-ui, sans-serif;
          font-size: 0.66rem;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--hsm-cp-accent, #C9A66B);
        }

        /* ── v128.2: drill-down view ───────────────────────────────── */
        .hsm-drill {
          display: flex;
          flex-direction: column;
          max-height: 92dvh;
        }
        .hsm-drill-header {
          position: sticky;
          top: 0;
          z-index: 5;
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 14px 18px;
          background: var(--bg-card, #faf5eb);
          border-bottom: 1px solid rgba(201, 166, 107, 0.20);
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
        }
        .hsm-drill-back, .hsm-drill-close {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 34px;
          height: 34px;
          border-radius: 50%;
          border: 1px solid rgba(201, 166, 107, 0.35);
          background: rgba(255, 252, 246, 0.85);
          color: var(--cozy-cocoa, #4a3820);
          font-size: 0.95rem;
          cursor: pointer;
          transition: transform 0.18s, background 0.2s;
        }
        .hsm-drill-back:hover, .hsm-drill-close:hover {
          background: var(--accent-soft, rgba(201,166,107,0.15));
        }
        .hsm-drill-title {
          flex: 1 1 auto;
          font-family: var(--font-display, "Cormorant Garamond"), serif;
          font-style: italic;
          font-size: 1.15rem;
          line-height: 1.15;
          color: var(--text-base, #1f1a0f);
          min-width: 0;
        }
        .hsm-drill-sub {
          font-family: var(--font-body, "DM Sans"), system-ui, sans-serif;
          font-size: 0.66rem;
          letter-spacing: 0.07em;
          text-transform: uppercase;
          color: var(--cozy-cocoa-soft, #6e5430);
          font-weight: 700;
          margin-top: 2px;
        }
        .hsm-drill-body {
          padding: 18px 18px 24px;
          overflow-y: auto;
          -webkit-overflow-scrolling: touch;
        }
        .hsm-drill-empty {
          padding: 32px 12px;
          text-align: center;
          color: var(--text-soft, #4a3820);
          font-family: var(--font-body, "DM Sans"), system-ui, sans-serif;
          font-size: 0.85rem;
          line-height: 1.5;
        }
        .hsm-drill-empty-emoji { font-size: 2rem; display: block; margin-bottom: 6px; }
        .hsm-drill-stats {
          display: grid;
          grid-template-columns: auto 1fr;
          gap: 14px;
          padding: 14px 14px 16px;
          margin-bottom: 16px;
          background: linear-gradient(150deg, rgba(201,166,107,0.10) 0%, var(--bg-elevated, #fffcf6) 100%);
          border: 1px solid rgba(201, 166, 107, 0.22);
          border-radius: 14px;
          align-items: center;
        }
        .hsm-stat-big {
          font-family: var(--font-display, "Cormorant Garamond"), serif;
          font-style: italic;
          font-weight: 700;
          font-size: 2.3rem;
          line-height: 1;
          color: var(--text-base, #1f1a0f);
          letter-spacing: -0.01em;
        }
        .hsm-stat-big small {
          font-size: 1rem;
          opacity: 0.55;
          margin-left: 2px;
        }
        .hsm-stat-bars {
          display: flex;
          flex-direction: column;
          gap: 4px;
          font-family: var(--font-body, "DM Sans"), system-ui, sans-serif;
          font-size: 0.7rem;
        }
        .hsm-stat-bar-row {
          display: grid;
          grid-template-columns: 30px 1fr 36px;
          gap: 6px;
          align-items: center;
        }
        .hsm-stat-bar-row .hsm-bar-count { text-align: right; color: var(--cozy-cocoa, #4a3820); }
        .hsm-stat-bar {
          height: 7px;
          border-radius: 4px;
          background: rgba(201, 166, 107, 0.18);
          overflow: hidden;
        }
        .hsm-stat-bar-fill {
          height: 100%;
          background: linear-gradient(90deg, #D9BE82, #C9A66B);
          border-radius: 4px;
        }

        /* Star reviews list */
        .hsm-rev-list { display: flex; flex-direction: column; gap: 10px; }
        .hsm-rev {
          padding: 12px 14px;
          background: var(--bg-elevated, #fffcf6);
          border: 1px solid rgba(201, 166, 107, 0.22);
          border-radius: 12px;
          box-shadow: 0 2px 6px -3px rgba(31, 26, 15, 0.10);
        }
        .hsm-rev-head {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 6px;
        }
        .hsm-rev-guest {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          padding: 3px 9px;
          background: var(--accent-soft, rgba(201,166,107,0.15));
          color: var(--cozy-cocoa, #4a3820);
          font-family: var(--font-body, "DM Sans"), system-ui, sans-serif;
          font-size: 0.65rem;
          font-weight: 700;
          letter-spacing: 0.08em;
          border-radius: 999px;
        }
        .hsm-rev-stars {
          font-size: 0.85rem;
          letter-spacing: 0.06em;
          color: var(--cozy-champagne, #C9A66B);
        }
        .hsm-rev-stars span { opacity: 0.25; }
        .hsm-rev-stars span.on { opacity: 1; }
        .hsm-rev-date {
          margin-left: auto;
          font-size: 0.65rem;
          color: var(--cozy-cocoa-soft, #6e5430);
          letter-spacing: 0.04em;
        }
        .hsm-rev-body {
          font-family: var(--font-body, "DM Sans"), system-ui, sans-serif;
          font-size: 0.85rem;
          line-height: 1.45;
          color: var(--text-base, #1f1a0f);
          word-break: break-word;
        }
        .hsm-rev-empty-body {
          font-style: italic;
          color: var(--cozy-cocoa-soft, #6e5430);
          font-size: 0.78rem;
        }

        /* Stay-feedback snapshot cards */
        .hsm-sf {
          padding: 12px 14px;
          background: var(--bg-elevated, #fffcf6);
          border: 1px solid rgba(201, 166, 107, 0.22);
          border-radius: 12px;
          margin-bottom: 10px;
          box-shadow: 0 2px 6px -3px rgba(31, 26, 15, 0.10);
        }
        .hsm-sf-head {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 8px;
        }
        .hsm-sf-grid {
          display: grid;
          grid-template-columns: repeat(5, 1fr);
          gap: 6px;
        }
        .hsm-sf-cell {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 3px;
          padding: 7px 4px;
          border-radius: 8px;
          border: 1px solid color-mix(in oklab, var(--hsm-sf-tone, #C9A66B) 30%, transparent);
          background: color-mix(in oklab, var(--hsm-sf-tone, #C9A66B) 10%, var(--bg-card, #faf5eb));
        }
        .hsm-sf-emoji { font-size: 1.05rem; line-height: 1; }
        .hsm-sf-cell-lbl {
          font-size: 0.52rem;
          font-family: var(--font-body, "DM Sans"), system-ui, sans-serif;
          color: var(--text-soft, #4a3820);
          line-height: 1.1;
          text-align: center;
          font-weight: 600;
        }
        .hsm-sf-auto-pill {
          margin-left: auto;
          padding: 2px 7px;
          background: rgba(217, 190, 130, 0.25);
          color: var(--cozy-cocoa, #4a3820);
          font-size: 0.58rem;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          font-weight: 700;
          border-radius: 999px;
        }
        @media (max-width: 480px) {
          .hsm-sf-grid { grid-template-columns: repeat(5, 1fr); gap: 4px; }
          .hsm-sf-cell { padding: 5px 2px; }
          .hsm-sf-emoji { font-size: 0.9rem; }
          .hsm-sf-cell-lbl { font-size: 0.46rem; }
        }

        @media (prefers-reduced-motion: reduce) {
          .hsm-backdrop, .hsm-sheet, .hsm-checkpoint-bar-fill { animation: none; transition: none; }
        }
      `}</style>
    </div>
  );

  if (!mounted || typeof document === "undefined") return null;
  return createPortal(modal, document.body);
}

