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

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import gsap from "gsap";
import type { BidCard } from "./BidCardStack";
import NaturalMountainScene from "./bid-game/NaturalMountainScene";
// v206 — Candy Crush-style milestone path replaces the v203-v205
// swipe/tilt/photo-swap stage. Same `cards: BidCard[]` interface so
// the existing `step1Cards` in app/bid/page.tsx renders byte-identical
// inside each milestone's bottom sheet. See ClimberMilestoneMap header.
import ClimberMilestoneMap from "./ClimberMilestoneMap";
import {
  isMuted as soundIsMuted,
  playComplete,
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

/* ── Component ───────────────────────────────────────────────────── */

export default function BidGameZone({ cards, onAllComplete, finalCtaLabel, className, zoneLabel = "STAYBID REVERSE BIDDING ZONE" }: Props) {
  const [phase, setPhase] = useState<Phase>("boot");
  const [muted, setMutedState] = useState(false);
  // v203.1 — portal-mount the game zone to document.body so the
  // `position: fixed` boot screen escapes the /bid page's Tailwind
  // `transition-all translate-y-0` parent. That parent's CSS transform
  // creates a containing block which traps `position: fixed`, collapsing
  // .bgz-boot to 0×0. Portal pattern matches CLAUDE.md v132.2 /v128.5
  // precedents (createPortal to escape containing-block ancestors).
  const [portalReady, setPortalReady] = useState(false);
  useEffect(() => { setPortalReady(true); }, []);

  const stageRef = useRef<HTMLDivElement | null>(null);
  const bootRef = useRef<HTMLDivElement | null>(null);

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

  /* ── Final exit — fired by ClimberMilestoneMap when the user taps
     the PEAK Launch disc (all 4 cards complete). Plays the close-
     out cue + fades the stage out + hands off to the host page's
     onAllComplete (which usually advances /bid from step 1 → step 2). */
  const handleLaunch = useCallback(() => {
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
  }, [onAllComplete]);

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
          {/* v205 — real natural mountain backdrop (Unsplash photo at
              dawn) replaces v204's cheap procedural Three.js scene.
              Static frame on boot — no climber trail, no birds. */}
          <NaturalMountainScene step={0} totalSteps={cards.length} active={false} />
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

      {/* PHASE 2 — Game zone stage (v206 — Candy Crush milestone path)
          The v203-v205 swipe/tilt/photo-swap stage is gone. Per
          Sachin's spec ("alag alag screen aurbek dum se yeh full
          screen show na ho... ek mile stone ki traha 3d live icon ki
          traha ek step by step connected show ho"), the stage is now
          one static mountain backdrop + a vertical milestone path
          with 4 connected 3D discs. Tap a disc → bottom sheet rises
          with that step's existing render() — the map stays visible
          dimmed below. No per-step photo cross-fade. */}
      {(phase === "playing" || phase === "exiting") && (
        <div className="bgz-stage cmm-stage" ref={stageRef}>
          {/* Single static dawn mountain backdrop. step=0, active=false
              so NaturalMountainScene does NOT cross-fade photos or
              draw its own trail — only the dawn photo + ambient
              vignette + animated birds remain. */}
          <div className="bgz-stage-backdrop" aria-hidden="true">
            <NaturalMountainScene step={0} totalSteps={1} active={false} />
          </div>

          {/* HUD — only sound mute kept. Pip rail removed because the
              milestone discs themselves visually convey progress and
              are individually tappable (Candy Crush level tree). */}
          <header className="bgz-hud cmm-hud">
            <div className="cmm-hud-title" aria-hidden="true">
              Climb to launch your auction
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

          <main className="bgz-stage-main cmm-stage-main">
            <ClimberMilestoneMap
              cards={cards}
              onAllComplete={handleLaunch}
              finalCtaLabel={finalCtaLabel}
            />
          </main>
        </div>
      )}
    </div>
  );

  if (!portalReady || typeof document === "undefined") return null;
  return createPortal(ui, document.body);
}
