"use client";

/* ════════════════════════════════════════════════════════════════════
   v203 — BidGameZone

   Replaces the v202 BidCardStack on mobile/tablet for /bid Step 1.
   A single rolling "stage" — boot screen → 4 connected steps →
   handoff. Cinema-grade via GSAP timelines, synthesized sound design
   via Web Audio API, optional Vibration API haptics.

   Architecture (single file, 4 phases):
     1. Boot screen ............ PRESS START → unlocks sound, fades in
     2. Stage ................... 4 BidCard steps rolling left-right
     3. Particles ............... ambient gold dust + selection bursts
     4. Bottom CTA + sound HUD

   Public API: same `cards: BidCard[]` + `onAllComplete` props as
   BidCardStack so swapping the host is one-line change in /bid page.

   The component takes the existing `BidCard` interface (key/icon/
   title/hint/isComplete/summary/render/autoAdvance/…) so every card
   body authored for v202 still renders here byte-identical.

   Critical v203 fixes baked in:
   ┌───────────────────────────────────────────────────────────────────
   │ ✔ Auto-advance + auto-open ONLY on forward arrival
   │ ✔ Back-swipe to a completed card no longer auto-bounces forward
   │ ✔ `firstReach` prop forwarded to cards via render ctx for
   │   DateAutoOpener etc.
   │ ✔ Parallax tilt-on-touch (±10°)
   │ ✔ Ambient drone + step-cue sounds (mutable, persisted)
   │ ✔ Vibration API haptics on every tap
   └───────────────────────────────────────────────────────────────────

   CSS lives in globals.css under `.bgz-*` (per v120 rule — no styled-
   jsx blocks in component files).
═══════════════════════════════════════════════════════════════════ */

import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import gsap from "gsap";
import type { BidCard } from "./BidCardStack";
import MountainStage from "./bid-game/MountainStage";
import {
  isMuted as soundIsMuted,
  playComplete,
  playError,
  playSelect,
  playTap,
  playWhoosh,
  setMuted as setSoundMuted,
  startAmbient,
  stopAmbient,
  unlockSound,
  vibrate,
} from "@/lib/bid-game/sound";

/* ── BidGameCard interface extension ─────────────────────────────── */
// The host page may pass extra fields on each card that BidGameZone
// surfaces to the render ctx (e.g. firstReach so DateAutoOpener only
// fires the first time a user lands on the card).
export interface BidGameRenderCtx {
  onAdvance: () => void;
  cardIdx: number;
  activeIdx: number;
  firstReach: boolean;
}

interface Props {
  cards: BidCard[];
  onAllComplete: () => void;
  finalCtaLabel?: string;
  className?: string;
  /** Optional override — defaults to "AUCTION GAME ZONE". */
  zoneLabel?: string;
}

/* ── Local types ─────────────────────────────────────────────────── */

type Phase = "boot" | "playing" | "exiting";
type Burst = { id: number; x: number; y: number };

/* ── Component ───────────────────────────────────────────────────── */

export default function BidGameZone({ cards, onAllComplete, finalCtaLabel, className, zoneLabel = "STAYBID REVERSE BIDDING ZONE" }: Props) {
  const [phase, setPhase] = useState<Phase>("boot");
  const [activeIdx, setActiveIdx] = useState(0);
  const [maxReached, setMaxReached] = useState(0);
  const [muted, setMutedState] = useState(false);
  const [bursts, setBursts] = useState<Burst[]>([]);
  const [, forceRender] = useState(0);
  // v203.1 — portal-mount the game zone to document.body so the
  // `position: fixed` boot screen escapes the /bid page's Tailwind
  // `transition-all translate-y-0` parent. That parent's CSS transform
  // creates a containing block which traps `position: fixed`, collapsing
  // .bgz-boot to 0×0. Portal pattern matches CLAUDE.md v132.2 /v128.5
  // precedents (createPortal to escape containing-block ancestors).
  const [portalReady, setPortalReady] = useState(false);
  useEffect(() => { setPortalReady(true); }, []);

  const stageRef = useRef<HTMLDivElement | null>(null);
  const stepRef = useRef<HTMLDivElement | null>(null);
  const bootRef = useRef<HTMLDivElement | null>(null);
  const burstSeqRef = useRef(0);
  const lastSelectedCountRef = useRef<Record<string, number>>({});

  /* Hydrate mute pref from sound module once on mount */
  useEffect(() => {
    setMutedState(soundIsMuted());
  }, []);

  /* Cleanup ambient on unmount */
  useEffect(() => {
    return () => {
      stopAmbient();
    };
  }, []);

  /* ── Boot screen → game zone transition ──────────────────────────── */
  const handleStart = useCallback(() => {
    unlockSound();
    playWhoosh();
    vibrate([18, 30, 18]);
    // Boot screen exit
    if (bootRef.current) {
      gsap.to(bootRef.current, {
        opacity: 0,
        scale: 1.18,
        filter: "blur(12px)",
        duration: 0.55,
        ease: "power3.in",
        onComplete: () => setPhase("playing"),
      });
    } else {
      setPhase("playing");
    }
    setTimeout(() => startAmbient(), 250);
  }, []);

  /* ── Sound HUD toggle ────────────────────────────────────────────── */
  const handleToggleMute = useCallback(() => {
    const next = !muted;
    setSoundMuted(next);
    setMutedState(next);
    if (next) {
      stopAmbient();
    } else {
      startAmbient();
      playTap();
    }
  }, [muted]);

  /* ── Step navigation primitives ──────────────────────────────────── */

  const activeCard = cards[activeIdx];
  const isLastCard = activeIdx === cards.length - 1;
  const canAdvanceNow = activeCard?.isComplete() ?? false;
  const firstReach = activeIdx >= maxReached;

  const animateStepIn = useCallback((direction: 1 | -1) => {
    const el = stepRef.current;
    if (!el) return;
    gsap.fromTo(
      el,
      {
        x: direction === 1 ? 80 : -80,
        opacity: 0,
        scale: 0.94,
        rotateY: direction === 1 ? 8 : -8,
        filter: "blur(8px)",
      },
      {
        x: 0,
        opacity: 1,
        scale: 1,
        rotateY: 0,
        filter: "blur(0px)",
        duration: 0.55,
        ease: "power3.out",
        clearProps: "filter",
      }
    );
  }, []);

  const advance = useCallback(() => {
    const next = activeIdx + 1;
    if (next >= cards.length) {
      playComplete();
      vibrate([20, 40, 20, 40, 60]);
      setPhase("exiting");
      const stage = stageRef.current;
      if (stage) {
        gsap.to(stage, {
          opacity: 0,
          scale: 0.94,
          filter: "blur(10px)",
          duration: 0.45,
          ease: "power3.in",
          onComplete: () => {
            stopAmbient();
            onAllComplete();
          },
        });
      } else {
        stopAmbient();
        onAllComplete();
      }
      return;
    }
    playWhoosh();
    vibrate([14, 26, 14]);
    setActiveIdx(next);
    setMaxReached((m) => Math.max(m, next));
    requestAnimationFrame(() => animateStepIn(1));
  }, [activeIdx, animateStepIn, cards.length, onAllComplete]);

  const jumpTo = useCallback(
    (idx: number, direction: 1 | -1 = -1) => {
      if (idx === activeIdx) return;
      if (idx < 0 || idx >= cards.length) return;
      if (idx > maxReached) return; // can't fast-forward past furthest
      playTap();
      vibrate(12);
      setActiveIdx(idx);
      requestAnimationFrame(() => animateStepIn(direction));
    },
    [activeIdx, animateStepIn, cards.length, maxReached]
  );

  /* ── Auto-advance — ONLY on forward arrival ──────────────────────── */
  // v203 bug fix: when a user swipes BACK to a completed card, the
  // effect's deps fire again. Without this guard the card auto-
  // advances them forward immediately → they can't stay on a previous
  // card to edit it. The `activeIdx >= maxReached` check ensures auto-
  // advance only fires the FIRST time they land on a card.
  useEffect(() => {
    if (phase !== "playing") return;
    if (!activeCard) return;
    if (!activeCard.autoAdvance) return;
    if (isLastCard) return;
    if (!canAdvanceNow) return;
    if (activeIdx < maxReached) return; // ← v203 fix: forward-only
    const delay = activeCard.autoAdvanceDelayMs ?? 450;
    const t = setTimeout(() => {
      if (activeCard.isComplete()) advance();
    }, delay);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCard, canAdvanceNow, isLastCard, activeIdx, maxReached, phase]);

  /* ── Selection feedback: detect summary changes and pulse ───────── */
  // Each card's `summary()` returns a string that changes when the
  // user picks something new on that card. Compare against last tick
  // to know whether to play a click + burst.
  useEffect(() => {
    if (phase !== "playing") return;
    const id = setInterval(() => {
      let changed = false;
      for (const c of cards) {
        const key = c.key;
        const summary = (() => {
          try {
            return c.summary();
          } catch {
            return "";
          }
        })();
        const prev = lastSelectedCountRef.current[key];
        if (prev !== undefined && prev !== summary.length) {
          changed = true;
        }
        lastSelectedCountRef.current[key] = summary.length;
      }
      if (changed) {
        playSelect();
        vibrate(10);
      }
    }, 220);
    return () => clearInterval(id);
  }, [cards, phase]);

  /* ── Swipe gestures (horizontal only) ────────────────────────────── */
  const touchStartRef = useRef<{ x: number; y: number; t: number } | null>(null);
  const onTouchStart = useCallback((e: React.TouchEvent) => {
    const t = e.touches[0];
    if (!t) return;
    touchStartRef.current = { x: t.clientX, y: t.clientY, t: Date.now() };
  }, []);
  const onTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      const start = touchStartRef.current;
      touchStartRef.current = null;
      if (!start) return;
      const t = e.changedTouches[0];
      if (!t) return;
      const dx = t.clientX - start.x;
      const dy = t.clientY - start.y;
      const elapsed = Date.now() - start.t;
      if (elapsed > 600) return;
      if (Math.abs(dx) < 60) return;
      if (Math.abs(dy) > Math.abs(dx)) return;
      if (dx < 0) {
        if (canAdvanceNow && !isLastCard) {
          advance();
        } else if (!canAdvanceNow) {
          playError();
          vibrate([40, 20, 40]);
        }
      } else if (activeIdx > 0) {
        jumpTo(activeIdx - 1, -1);
      }
    },
    [activeIdx, advance, canAdvanceNow, isLastCard, jumpTo]
  );

  /* ── Tilt-on-touch parallax ──────────────────────────────────────── */
  // Maps finger position relative to card center to rotateX/rotateY
  // ±10°. Snaps back to neutral on touch end via GSAP.
  const tiltRef = useRef<HTMLDivElement | null>(null);
  const onTiltMove = useCallback((e: React.TouchEvent | React.PointerEvent) => {
    const el = tiltRef.current;
    if (!el) return;
    const point =
      "touches" in e && e.touches.length > 0
        ? { x: e.touches[0].clientX, y: e.touches[0].clientY }
        : "clientX" in e
        ? { x: e.clientX, y: e.clientY }
        : null;
    if (!point) return;
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = (point.x - cx) / (rect.width / 2);
    const dy = (point.y - cy) / (rect.height / 2);
    gsap.to(el, {
      rotateY: dx * 8,
      rotateX: -dy * 8,
      duration: 0.18,
      ease: "power2.out",
      transformPerspective: 1200,
    });
  }, []);
  const onTiltEnd = useCallback(() => {
    const el = tiltRef.current;
    if (!el) return;
    gsap.to(el, {
      rotateX: 0,
      rotateY: 0,
      duration: 0.45,
      ease: "elastic.out(1, 0.55)",
    });
  }, []);

  /* ── Selection burst (gold particles ejecting from tap point) ────── */
  const triggerBurstAt = useCallback((clientX: number, clientY: number) => {
    const stage = stageRef.current;
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const id = ++burstSeqRef.current;
    setBursts((b) => [...b, { id, x, y }]);
    setTimeout(() => {
      setBursts((b) => b.filter((it) => it.id !== id));
    }, 1100);
  }, []);

  /* Listen for tap inside the active step body to fire the burst */
  const onStepClickCapture = useCallback(
    (e: React.MouseEvent) => {
      // Only burst on actual user clicks/taps on selectable controls
      const target = e.target as HTMLElement;
      const clickable = target.closest("button, [role='button'], a, [data-burst]");
      if (!clickable) return;
      triggerBurstAt(e.clientX, e.clientY);
    },
    [triggerBurstAt]
  );

  /* ── Ambient particle field — 18 floating gold embers ───────────── */
  const ambientParticles = useMemo(
    () =>
      Array.from({ length: 18 }, (_, i) => {
        const seed = i * 73.7;
        return {
          id: i,
          left: (Math.sin(seed) * 0.5 + 0.5) * 100,
          delay: (i * 0.4) % 6,
          duration: 7 + (i % 5),
          size: 2 + (i % 4),
          opacity: 0.18 + ((i * 13) % 30) / 100,
        };
      }),
    []
  );

  // Force re-render once / sec so the activeCard's isComplete reads stay live
  useEffect(() => {
    if (phase !== "playing") return;
    const id = setInterval(() => forceRender((n) => n + 1), 280);
    return () => clearInterval(id);
  }, [phase]);

  /* ── Rendering ───────────────────────────────────────────────────── */

  // v203.1 — Build the entire UI tree, then portal it to document.body
  // so the position-fixed boot screen + full-viewport stage escape the
  // /bid page's transform-trap. SSR-safe: portalReady starts false, flips
  // true on mount, so first paint returns null (no hydration mismatch
  // since the parent /bid page is a client component).
  const ui = (
    <div className={`bgz-shell ${className || ""}`.trim()}>
      {/* PHASE 1 — Boot screen */}
      {phase === "boot" && (
        <div className="bgz-boot" ref={bootRef} role="dialog" aria-label="Auction game zone — press start">
          {/* v204 — natural mountain scene replaces gold/black aurora */}
          <div className="bgz-boot-scene" aria-hidden="true">
            <MountainStage step={0} totalSteps={cards.length} active={false} />
            <div className="bgz-boot-scene-vignette" />
          </div>
          <div className="bgz-boot-content">
            <div className="bgz-boot-eyebrow">⚡ WELCOME TO</div>
            <h1 className="bgz-boot-title">{zoneLabel}</h1>
            <p className="bgz-boot-sub">
              Real hotels. Real deals. Set your price, watch them compete.
            </p>
            <p className="bgz-boot-sub bgz-boot-sub-en">
              Book your dream hotel · room · at your dream price in just 1
              minute — backed by StayBid&rsquo;s 100% satisfaction promise.
            </p>
            <button
              type="button"
              className="bgz-boot-cta"
              onClick={handleStart}
              aria-label="Press start to enter the StayBid reverse bidding zone"
            >
              <span className="bgz-boot-cta-glow" aria-hidden="true" />
              <span className="bgz-boot-cta-label">▶ PRESS START</span>
            </button>
            <p className="bgz-boot-tip">Sound on · Tap anywhere on the cards to react</p>
          </div>
        </div>
      )}

      {/* PHASE 2 — Game zone stage */}
      {(phase === "playing" || phase === "exiting") && (
        <div className="bgz-stage" ref={stageRef} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
          {/* v204 — Mountain climbing scene replaces gold/black aurora.
              Sun moves, sky tints, camera dollies higher per step; the
              climber trail SVG overlay reveals as the user advances. The
              old gold ambient particles are gone — the snow + birds in
              the 3D scene cover the "alive feel" requirement. */}
          <div className="bgz-stage-backdrop" aria-hidden="true">
            <MountainStage step={activeIdx} totalSteps={cards.length} active />
            <div className="bgz-stage-vignette" />
          </div>

          {/* Top HUD — step pips + sound toggle */}
          <header className="bgz-hud">
            <div className="bgz-pips" role="tablist" aria-label="Bid game progress">
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
                    className={`bgz-pip ${active ? "is-active" : ""} ${done ? "is-done" : ""} ${!reached ? "is-locked" : ""}`.trim()}
                    onClick={() => reached && jumpTo(i, i < activeIdx ? -1 : 1)}
                    disabled={!reached}
                    title={done ? `${c.title} · ${c.summary()}` : c.title}
                  >
                    <span className="bgz-pip-glyph" aria-hidden="true">
                      {done ? "✓" : c.icon}
                    </span>
                    <span className="bgz-pip-label">{done ? c.summary() : c.title}</span>
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              className={`bgz-mute ${muted ? "is-muted" : ""}`}
              onClick={handleToggleMute}
              aria-label={muted ? "Unmute game zone sound" : "Mute game zone sound"}
              title={muted ? "Sound off" : "Sound on"}
            >
              {muted ? "🔇" : "🔊"}
            </button>
          </header>

          {/* Active step card with tilt-on-touch */}
          <main
            className="bgz-stage-main"
            onClickCapture={onStepClickCapture}
          >
            <div
              className="bgz-tilt-wrap"
              ref={tiltRef}
              onTouchMove={onTiltMove}
              onTouchEnd={onTiltEnd}
              onTouchCancel={onTiltEnd}
            >
              <article className="bgz-step" ref={stepRef} aria-live="polite">
                <header className="bgz-step-head">
                  <div className="bgz-step-glyph" aria-hidden="true">{activeCard?.icon}</div>
                  <div className="bgz-step-h-text">
                    <div className="bgz-step-title">{activeCard?.title}</div>
                    {activeCard?.hint ? <div className="bgz-step-hint">{activeCard.hint}</div> : null}
                  </div>
                  <div className="bgz-step-counter" aria-label={`Step ${activeIdx + 1} of ${cards.length}`}>
                    <span className="bgz-step-counter-n">{activeIdx + 1}</span>
                    <span className="bgz-step-counter-sep">/</span>
                    <span className="bgz-step-counter-d">{cards.length}</span>
                  </div>
                </header>
                <div className="bgz-step-body">
                  {activeCard?.render({
                    onAdvance: advance,
                    cardIdx: activeIdx,
                    activeIdx,
                    firstReach,
                  } as BidGameRenderCtx)}
                </div>
              </article>
            </div>

            {/* Burst particles emitted from selection taps */}
            {bursts.map((b) => (
              <div key={b.id} className="bgz-burst" style={{ left: b.x, top: b.y }} aria-hidden="true">
                {Array.from({ length: 10 }).map((_, i) => (
                  <span
                    key={i}
                    className="bgz-burst-dot"
                    style={{
                      // 10 particles ejected on a 360° rosette
                      ["--bgz-burst-x" as any]: `${Math.cos((i / 10) * Math.PI * 2) * 60}px`,
                      ["--bgz-burst-y" as any]: `${Math.sin((i / 10) * Math.PI * 2) * 60}px`,
                      animationDelay: `${i * 8}ms`,
                    }}
                  />
                ))}
              </div>
            ))}
          </main>

          {/* v203.3 — Bottom swipe gesture rail (replaces Next CTA button).
              Per Sachin's feedback: native game-zone feel means the user
              navigates by SWIPING, not tapping a button. The rail surfaces:
                - animated chevron arrows (→ left swipe to advance)
                - a back chevron (← right swipe to revisit) when activeIdx > 0
                - dynamic hint text per-state
              On the last card the rail flips to a single premium "Enter the
              Auction" button — swipe is unintuitive for a "submit" action. */}
          <footer className="bgz-swipe-rail">
            {isLastCard ? (
              <button
                type="button"
                className="bgz-cta-btn bgz-cta-btn-final"
                onClick={() => {
                  if (!canAdvanceNow) {
                    playError();
                    vibrate([60, 40, 60]);
                    return;
                  }
                  advance();
                }}
                disabled={!canAdvanceNow}
                aria-disabled={!canAdvanceNow}
              >
                <span className="bgz-cta-shimmer" aria-hidden="true" />
                <span className="bgz-cta-label">
                  {finalCtaLabel || "▶ Enter the Auction"}
                </span>
              </button>
            ) : canAdvanceNow ? (
              <div
                className="bgz-swipe-indicator is-forward"
                role="button"
                tabIndex={0}
                aria-label="Swipe left or tap to continue"
                onClick={advance}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    advance();
                  }
                }}
              >
                <span className="bgz-swipe-chev bgz-swipe-chev-1" aria-hidden="true">›</span>
                <span className="bgz-swipe-chev bgz-swipe-chev-2" aria-hidden="true">›</span>
                <span className="bgz-swipe-chev bgz-swipe-chev-3" aria-hidden="true">›</span>
                <span className="bgz-swipe-label">Swipe to continue</span>
              </div>
            ) : (
              <div className="bgz-swipe-indicator is-waiting">
                <span className="bgz-swipe-pulse" aria-hidden="true" />
                <span className="bgz-swipe-label">
                  {activeCard?.hint || "Pick to unlock the next step"}
                </span>
              </div>
            )}
            {activeIdx > 0 && !isLastCard && (
              <button
                type="button"
                className="bgz-swipe-back"
                onClick={() => jumpTo(activeIdx - 1, -1)}
                aria-label="Swipe right or tap to go back"
              >
                <span aria-hidden="true">‹</span> Back
              </button>
            )}
          </footer>
        </div>
      )}
    </div>
  );

  if (!portalReady || typeof document === "undefined") return null;
  return createPortal(ui, document.body);
}
