"use client";

/* ═══════════════════════════════════════════════════════════════════
   BidCardStack (v202) — mobile/tablet card-stack flow for /bid Step 1

   Replaces the flat scrollable list of "Destination · Property Type ·
   Dates · Guests & Rooms" sub-sections with a Tinder/Apple-Wallet style
   stack: one card is fully visible at the top, the next 2 peek behind
   with progressive scale + opacity, completed cards collapse into
   tappable breadcrumb chips at the top of the surface.

   Desktop / laptop (>= 1024px) gets the existing inline flow — the host
   page guards with `useMediaQuery` and renders <BidCardStack> on mobile
   only. Desktop / form state / submit logic are byte-identical to v200.

   The component is purely VIEW. State lives on the host page (`form`
   object in app/bid/page.tsx), each card calls back via
   `cards[i].isComplete()` so the stack knows when to enable Next.

   CSS lives in globals.css under .bcs-* — adding a styled-jsx block
   here triggers the SWC visitor.rs:597 panic documented in v120 /
   v132.9.1 era (3+ style blocks in a single component file).
═════════════════════════════════════════════════════════════════════ */

import { ReactNode, useCallback, useEffect, useRef, useState } from "react";

export interface BidCard {
  key: string;
  icon: string;
  title: string;
  hint?: string;
  /** Returns true when the user has filled this card sufficiently. */
  isComplete: () => boolean;
  /** Short summary shown in the breadcrumb chip after completion. */
  summary: () => string;
  /** Card body — receives an `onAdvance` callback to programmatically move forward. */
  render: (ctx: { onAdvance: () => void; cardIdx: number; activeIdx: number }) => ReactNode;
}

interface Props {
  cards: BidCard[];
  /** Fires after the LAST card completes and the user taps Continue. */
  onAllComplete: () => void;
  /** Final-card CTA label override. Default: "Continue →". */
  finalCtaLabel?: string;
  className?: string;
}

export default function BidCardStack({ cards, onAllComplete, finalCtaLabel, className }: Props) {
  const [activeIdx, setActiveIdx] = useState(0);
  // We DERIVE completed state from `isComplete()` on each card instead of
  // tracking it separately, so the breadcrumb chip auto-flips back to
  // "in-progress" if the user edits a previous card via tap-to-jump.
  const [maxReached, setMaxReached] = useState(0);

  const stackRef = useRef<HTMLDivElement | null>(null);

  // Smooth-scroll the stack into view when activeIdx changes (handles
  // mobile keyboards popping up / dismissing during data entry).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const el = stackRef.current;
    if (!el) return;
    // Defer one frame so the card-swap animation starts first.
    const t = setTimeout(() => {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
    return () => clearTimeout(t);
  }, [activeIdx]);

  const advance = useCallback(() => {
    const next = activeIdx + 1;
    if (next >= cards.length) {
      onAllComplete();
    } else {
      setActiveIdx(next);
      setMaxReached((m) => Math.max(m, next));
    }
  }, [activeIdx, cards.length, onAllComplete]);

  const jumpTo = useCallback(
    (idx: number) => {
      // Allow jumping to any card that has been reached or completed.
      if (idx <= maxReached) setActiveIdx(idx);
    },
    [maxReached]
  );

  const activeCard = cards[activeIdx];
  const isLastCard = activeIdx === cards.length - 1;
  const canAdvanceNow = activeCard?.isComplete() ?? false;

  return (
    <div className={`bcs-shell ${className || ""}`.trim()}>
      {/* ── Breadcrumb chips — completed cards collapse here ─────── */}
      <div className="bcs-crumbs" role="tablist" aria-label="Bid wizard steps">
        {cards.map((c, i) => {
          const done = c.isComplete() && i < activeIdx;
          const active = i === activeIdx;
          const reached = i <= maxReached;
          return (
            <button
              key={c.key}
              type="button"
              role="tab"
              aria-selected={active}
              aria-disabled={!reached}
              className={`bcs-crumb ${active ? "is-active" : ""} ${done ? "is-done" : ""} ${!reached ? "is-locked" : ""}`.trim()}
              onClick={() => jumpTo(i)}
              disabled={!reached}
              title={done ? `${c.title} · ${c.summary()}` : c.title}
            >
              <span className="bcs-crumb-glyph" aria-hidden="true">
                {done ? "✓" : c.icon}
              </span>
              <span className="bcs-crumb-label">{done ? c.summary() : c.title}</span>
            </button>
          );
        })}
      </div>

      {/* ── Card stack — active card on top + 2 peeks behind ────── */}
      <div className="bcs-stack" ref={stackRef}>
        {cards.map((c, i) => {
          const offset = i - activeIdx;
          // Only render the 3 cards visible in the stack: prev (slides
          // out), active (on top), and 2 peeks behind. Anything further
          // is offscreen — skip to keep DOM lean.
          if (offset < 0 || offset > 2) return null;

          const isActive = offset === 0;
          const scale = 1 - offset * 0.035;
          const translateY = offset * 14;
          const opacity = isActive ? 1 : Math.max(0.35, 0.78 - offset * 0.22);

          return (
            <section
              key={c.key}
              className={`bcs-card ${isActive ? "is-active" : "is-peek"}`}
              style={{
                transform: `translateY(${translateY}px) scale(${scale})`,
                opacity,
                zIndex: 100 - offset,
                pointerEvents: isActive ? "auto" : "none",
              }}
              aria-hidden={!isActive}
            >
              <header className="bcs-card-head">
                <div className="bcs-card-glyph" aria-hidden="true">{c.icon}</div>
                <div className="bcs-card-h-text">
                  <div className="bcs-card-title">{c.title}</div>
                  {c.hint ? <div className="bcs-card-hint">{c.hint}</div> : null}
                </div>
                <div className="bcs-card-counter" aria-label={`Step ${i + 1} of ${cards.length}`}>
                  {i + 1}<span className="bcs-card-counter-sep">/</span>{cards.length}
                </div>
              </header>

              {/* Only render body content for the active card — peeks
                  are decorative chrome. Avoids running expensive child
                  effects (city fetches, geo) for non-visible cards. */}
              {isActive ? (
                <div className="bcs-card-body">
                  {c.render({ onAdvance: advance, cardIdx: i, activeIdx })}
                </div>
              ) : (
                <div className="bcs-card-body bcs-card-body-peek" aria-hidden="true" />
              )}
            </section>
          );
        })}
      </div>

      {/* ── Sticky bottom CTA — Continue / final action ─────────── */}
      <div className="bcs-cta-rail">
        <button
          type="button"
          className="bcs-cta-btn"
          onClick={advance}
          disabled={!canAdvanceNow}
        >
          <span className="bcs-cta-label">
            {isLastCard ? (finalCtaLabel || "Continue →") : "Next →"}
          </span>
          <span className="bcs-cta-shimmer" aria-hidden="true" />
        </button>
        {!canAdvanceNow ? (
          <p className="bcs-cta-tip">
            {activeCard?.hint || "Fill this card to unlock the next step."}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** Helper hook used by the host page to decide whether to render the
 *  card stack (mobile/tablet) or the legacy inline flow (laptop+).
 *  SSR-safe — returns `false` until mount, so server-rendered markup
 *  matches the legacy inline path. Mobile users see the card stack
 *  swap in within ~16ms of hydration. */
export function useIsMobileTablet(): boolean {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(max-width: 1023px)");
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener?.("change", update);
    return () => mq.removeEventListener?.("change", update);
  }, []);
  return isMobile;
}
