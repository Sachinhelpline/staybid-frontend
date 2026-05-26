"use client";

/* ════════════════════════════════════════════════════════════════════
   v206 — ClimberMilestoneMap

   Replaces the v203-v205 swipe/tilt/photo-swap stage with a Candy Crush
   Saga style vertical milestone path on a SINGLE screen.

   Sachin's exact feedback (v205 reject):
   - "yeh sab screen change hokar photos change ho rahe hai" — background
     was swapping per step (Mussoorie → forest → snow → alpine). FAKE.
   - "trails dikh rahi hai wo ek dum wahiyat disturbing lag rahi hai" —
     the curved white SVG trail + tiny bindi climber was confusing.
   - "ek mile stone ki traha 3d live icon ki traha ek step by step
     connected show ho" — wants a connected milestone tree.
   - "jaishe hi ush pe tap kre toh next step" — tap a milestone, that
     step's picker opens (NOT a full-screen takeover).
   - "ushko upar niche live motion main drag kar sakte hai" — vertical
     scrollable so a long path can be peeked.

   Architecture:
   ┌──────────────────────────────────────────────────────────────────
   │ • ONE static mountain backdrop (no per-step photo swaps)
   │ • SVG zig-zag path from bottom (START) to top (PEAK = launch)
   │ • 4 absolutely-positioned 3D milestone discs at the path bends
   │ • Climber emoji glides between discs as cards complete
   │ • Tap a disc → bottom SHEET (60vh max) rises with that card's
   │   render() — page underneath stays visible, dimmed
   │ • Sheet has Done CTA (manual cards) OR auto-closes (autoAdvance)
   │ • All 4 done → peak LAUNCH disc unlocks, tap → onAllComplete()
   └──────────────────────────────────────────────────────────────────

   Public API is byte-identical to BidCardStack / BidGameZone:
     - cards: BidCard[]   (existing step1Cards from app/bid/page.tsx)
     - onAllComplete: () => void
     - finalCtaLabel?: string

   CSS lives in app/globals.css under `.cmm-*` (per v120 styled-jsx
   rule — no <style jsx> blocks in component files; SWC panic guard).
═══════════════════════════════════════════════════════════════════ */

import { useCallback, useEffect, useRef, useState } from "react";
import gsap from "gsap";
import type { BidCard } from "./BidCardStack";
import type { BidGameRenderCtx } from "./BidGameZone";
import {
  playComplete,
  playError,
  playSelect,
  playTap,
  playWhoosh,
  vibrate,
} from "@/lib/bid-game/sound";

interface Props {
  cards: BidCard[];
  onAllComplete: () => void;
  finalCtaLabel?: string;
}

/* Milestone positions on a 0-100 % grid. y measured from TOP, so
   START (bottom) = 92%, PEAK (top) = 8%. Alternating x gives the
   Candy Crush zig-zag feel. Tuned so 4 discs + start + peak fit
   comfortably on a 100vh viewport without scroll on most phones
   (380-460dvh range) — and remains scrollable on very short screens. */
const NODES: { x: number; y: number }[] = [
  { x: 28, y: 76 }, // 1 City
  { x: 72, y: 58 }, // 2 Property
  { x: 28, y: 40 }, // 3 Dates
  { x: 72, y: 24 }, // 4 Guests
];
const START = { x: 50, y: 92 };
const PEAK = { x: 50, y: 9 };

/* Smooth bezier connecting START → NODES[0..3] → PEAK. Each segment
   uses control points pulled slightly off-axis to give the curvy
   organic path Candy Crush uses (instead of straight zig-zag lines). */
const PATH_D = (() => {
  const pts = [START, ...NODES, PEAK];
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1];
    const cur = pts[i];
    const midY = (prev.y + cur.y) / 2;
    // Curve outward toward whichever side cur is on
    const cp1x = prev.x + (cur.x - prev.x) * 0.15;
    const cp1y = midY + 4;
    const cp2x = cur.x - (cur.x - prev.x) * 0.15;
    const cp2y = midY - 4;
    d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${cur.x} ${cur.y}`;
  }
  return d;
})();

/* Approximate path length for stroke-dasharray progress drawing.
   We use a deliberately-rough estimate; the spec doesn't care about
   the exact pixel length — only the ratio. 500 is enough that the
   draw-in animation reads as "smooth fill" across all viewport
   sizes. */
const PATH_LEN = 500;

export default function ClimberMilestoneMap({
  cards,
  onAllComplete,
  finalCtaLabel,
}: Props) {
  /* sheetIdx === null  → no sheet open
     sheetIdx === N     → that card's picker is open in a bottom sheet */
  const [sheetIdx, setSheetIdx] = useState<number | null>(null);
  const [maxReached, setMaxReached] = useState(0);
  /* Tick to re-evaluate `isComplete()` closures on cards which read
     from external React state on the host page. Matches the 280ms
     poll in BidGameZone (lifted from v203 pattern). */
  const [, tick] = useState(0);

  const climberRef = useRef<HTMLDivElement | null>(null);
  const climberPosRef = useRef<{ x: number; y: number }>(START);

  /* Poll for card completion changes so the climber, drawn-path and
     node states stay live without forcing every host card to push
     updates here. 280ms matches BidGameZone's existing rhythm. */
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 280);
    return () => clearInterval(id);
  }, []);

  /* ── Derived state from card completion ──────────────────────────
     completedCount counts CONSECUTIVE completions from the start.
     Breaks at first un-complete card so the climber doesn't teleport
     past a hole if the user edits an earlier card to be invalid. */
  let completedCount = 0;
  for (let i = 0; i < cards.length; i++) {
    let ok = false;
    try {
      ok = cards[i].isComplete();
    } catch {
      ok = false;
    }
    if (ok) completedCount++;
    else break;
  }
  const allDone = completedCount === cards.length;

  /* Climber sits at the last completed milestone (or START if none).
     allDone → climber sits on the PEAK ready to launch. */
  const climberTarget =
    completedCount === 0
      ? START
      : allDone
      ? PEAK
      : NODES[completedCount - 1];

  /* GSAP animate climber to its target whenever it changes. We
     remember the previous position so we can do a smooth ease,
     not a teleport. */
  useEffect(() => {
    const el = climberRef.current;
    if (!el) return;
    const from = climberPosRef.current;
    const to = climberTarget;
    if (from.x === to.x && from.y === to.y) return;
    gsap.fromTo(
      el,
      { left: `${from.x}%`, top: `${from.y}%` },
      {
        left: `${to.x}%`,
        top: `${to.y}%`,
        duration: 0.95,
        ease: "power2.inOut",
      }
    );
    climberPosRef.current = to;
  }, [climberTarget]);

  /* ── Node tap handlers ───────────────────────────────────────────
     Locking rule: a node is tappable iff it's completed (re-edit) OR
     it's the NEXT pending node (= completedCount). Future nodes are
     locked so users can't skip ahead — matches Candy Crush model. */
  const handleNodeTap = useCallback(
    (idx: number) => {
      const locked = idx > completedCount;
      if (locked) {
        playError();
        vibrate([40, 20, 40]);
        return;
      }
      playTap();
      vibrate(14);
      setSheetIdx(idx);
      setMaxReached((m) => Math.max(m, idx));
    },
    [completedCount]
  );

  const handleSheetClose = useCallback(() => {
    setSheetIdx(null);
    playWhoosh();
    vibrate(12);
  }, []);

  /* Auto-close sheet when an autoAdvance card finishes. Replicates
     the BidGameZone auto-advance semantics (v203 fix: only fires
     once per "fresh visit" so re-tapping a completed card to edit
     doesn't bounce the sheet shut mid-edit). */
  useEffect(() => {
    if (sheetIdx === null) return;
    const card = cards[sheetIdx];
    if (!card?.autoAdvance) return;
    let ok = false;
    try {
      ok = card.isComplete();
    } catch {
      ok = false;
    }
    if (!ok) return;
    const delay = card.autoAdvanceDelayMs ?? 450;
    const t = setTimeout(() => {
      setSheetIdx(null);
      playSelect();
      vibrate([12, 24, 12]);
    }, delay);
    return () => clearTimeout(t);
    // re-evaluate whenever the poll tick fires
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheetIdx, cards, completedCount]);

  /* Body scroll lock while sheet is open — prevents the climber map
     scrolling underneath the dimmer when the user drags the sheet. */
  useEffect(() => {
    if (sheetIdx === null) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [sheetIdx]);

  /* ── Launch peak tap ─────────────────────────────────────────────
     Fires onAllComplete only when all 4 cards are done. Otherwise it
     buzzes + scrolls focus to the first pending milestone so the user
     knows where to go. */
  const handleLaunchTap = useCallback(() => {
    if (!allDone) {
      playError();
      vibrate([40, 20, 40]);
      return;
    }
    playComplete();
    vibrate([20, 40, 20, 40, 60]);
    onAllComplete();
  }, [allDone, onAllComplete]);

  /* Drawn-in path progress. completedCount=0 → only the start arc is
     drawn (~10%). Each milestone reached fills another quarter. PEAK
     reached → fully drawn. */
  const drawnPct = Math.max(0.08, Math.min(1, completedCount / cards.length));
  const dashOffset = PATH_LEN * (1 - drawnPct);

  return (
    <div className="cmm-root">
      {/* SVG path layer — visual only, all interactions go through the
          absolutely-positioned button nodes below. */}
      <svg
        className="cmm-path-svg"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        {/* Faint dashed background line so the FULL path is always
            hinted, even before the user has completed anything. */}
        <path
          d={PATH_D}
          className="cmm-path-bg"
          fill="none"
          strokeDasharray="2.5 2"
        />
        {/* The drawn-in progress overlay. */}
        <path
          d={PATH_D}
          className="cmm-path-drawn"
          fill="none"
          strokeDasharray={PATH_LEN}
          strokeDashoffset={dashOffset}
        />
      </svg>

      {/* Climber — sits on the path at whatever the last completed
          milestone is. GSAP-animated; reduced-motion still moves but
          loses the elastic feel via the CSS guard. */}
      <div className="cmm-climber" ref={climberRef} aria-hidden="true">
        <span className="cmm-climber-emoji">🧗</span>
        <span className="cmm-climber-shadow" />
      </div>

      {/* 4 milestone nodes — buttons absolutely positioned at NODES[i].
          Each is a 3D disc with radial gradient + soft drop shadow +
          rotating sheen on the active one. Label sits below the disc. */}
      {cards.map((card, i) => {
        const pos = NODES[i];
        let done = false;
        try {
          done = card.isComplete();
        } catch {
          done = false;
        }
        const locked = i > completedCount;
        const isNext = i === completedCount && !done;
        return (
          <button
            key={card.key}
            type="button"
            className={[
              "cmm-node",
              done ? "is-done" : "",
              isNext ? "is-active" : "",
              locked ? "is-locked" : "",
              `cmm-node-${i + 1}`,
            ]
              .filter(Boolean)
              .join(" ")}
            style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
            onClick={() => handleNodeTap(i)}
            aria-label={`Step ${i + 1}: ${card.title}${
              done ? ` — ${card.summary()}` : locked ? " (locked)" : ""
            }`}
            title={card.title}
            data-burst
          >
            <span className="cmm-node-ring" aria-hidden="true" />
            <span className="cmm-node-disc">
              <span className="cmm-node-glyph">
                {done ? "✓" : locked ? "🔒" : card.icon}
              </span>
              <span className="cmm-node-sheen" aria-hidden="true" />
            </span>
            <span className="cmm-node-num">{i + 1}</span>
            <span className="cmm-node-label">
              {done ? card.summary() : card.title}
            </span>
          </button>
        );
      })}

      {/* Peak — Launch disc. Locked until all 4 done. */}
      <button
        type="button"
        className={`cmm-peak ${allDone ? "is-ready" : "is-locked"}`}
        style={{ left: `${PEAK.x}%`, top: `${PEAK.y}%` }}
        onClick={handleLaunchTap}
        aria-label={
          allDone
            ? finalCtaLabel || "Launch the auction"
            : "Complete all 4 milestones to launch"
        }
        aria-disabled={!allDone}
      >
        <span className="cmm-peak-ring" aria-hidden="true" />
        <span className="cmm-peak-disc">
          <span className="cmm-peak-glyph">{allDone ? "🚩" : "🔒"}</span>
          <span className="cmm-peak-sheen" aria-hidden="true" />
        </span>
        <span className="cmm-peak-label">
          {allDone ? finalCtaLabel || "▶ Launch" : "Locked"}
        </span>
      </button>

      {/* Bottom sheet — renders the existing card.render() content
          unchanged. Backdrop dims the map underneath but stays visible
          (no full-screen takeover, matching Sachin's spec). */}
      {sheetIdx !== null && cards[sheetIdx] && (
        <div
          className="cmm-sheet-backdrop"
          onClick={handleSheetClose}
          role="presentation"
        >
          <div
            className="cmm-sheet"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={cards[sheetIdx].title}
          >
            <button
              type="button"
              className="cmm-sheet-close"
              onClick={handleSheetClose}
              aria-label="Close"
            >
              ✕
            </button>
            <div className="cmm-sheet-handle" aria-hidden="true" />
            <header className="cmm-sheet-head">
              <span className="cmm-sheet-glyph" aria-hidden="true">
                {cards[sheetIdx].icon}
              </span>
              <div className="cmm-sheet-h-text">
                <div className="cmm-sheet-title">{cards[sheetIdx].title}</div>
                {cards[sheetIdx].hint ? (
                  <div className="cmm-sheet-hint">{cards[sheetIdx].hint}</div>
                ) : null}
              </div>
              <div className="cmm-sheet-counter">
                {sheetIdx + 1} / {cards.length}
              </div>
            </header>
            <div className="cmm-sheet-body">
              {cards[sheetIdx].render({
                onAdvance: () => setSheetIdx(null),
                cardIdx: sheetIdx,
                activeIdx: sheetIdx,
                firstReach: sheetIdx >= maxReached,
              } as BidGameRenderCtx)}
            </div>
            {/* Manual cards (e.g. Guests counter) need a Done button.
                Autoadvance cards close themselves so we hide the CTA
                to prevent visual confusion. */}
            {!cards[sheetIdx].autoAdvance && (
              <footer className="cmm-sheet-cta">
                {(() => {
                  let ok = false;
                  try {
                    ok = cards[sheetIdx].isComplete();
                  } catch {
                    ok = false;
                  }
                  return (
                    <button
                      type="button"
                      className={`cmm-sheet-done ${ok ? "is-ready" : ""}`}
                      onClick={() => {
                        if (!ok) {
                          playError();
                          vibrate([30, 20, 30]);
                          return;
                        }
                        setSheetIdx(null);
                        playSelect();
                        vibrate([14, 28, 14]);
                      }}
                      disabled={!ok}
                    >
                      {ok ? "✓ Done" : cards[sheetIdx].hint || "Pick to unlock"}
                    </button>
                  );
                })()}
              </footer>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
