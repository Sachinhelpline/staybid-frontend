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
    // v226 — ambient drone removed. User feedback: "background sound chal
    // raha hai jiska koi kaam nahi". stopAmbient() calls below + on unmount
    // are kept as defence-in-depth (no-op when nothing is playing).
  }, []);

  /* ── Sound HUD toggle ────────────────────────────────────────────── */
  const handleToggleMute = useCallback(() => {
    const next = !muted;
    setSoundMuted(next);
    setMutedState(next);
    // v226 — toggle still controls SFX (tap / whoosh / complete), but no
    // longer restarts the ambient drone. stopAmbient() always safe.
    stopAmbient();
    if (!next) playTap();
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
            {/* v214 — SS2 (Candy Crush) layout, 100% structure-identical,
                only cream-on-mountain SS3 theme. Compact 2-col header +
                step tracker strip + 5 alternating cards with OUTSIDE
                eyebrow (number disc + italic title + sub-text). */}
            <div className="bgz-boot-header">
              <div className="bgz-boot-brand">
                <span className="bgz-boot-brand-bolt">⚡</span>
                <span className="bgz-boot-brand-text">
                  <span className="bgz-boot-brand-name">stay·bid</span>
                  <span className="bgz-boot-brand-live">LIVE</span>
                </span>
              </div>
              <div className="bgz-boot-headline">
                <h1 className="bgz-boot-title">Bid Your Stay, Save Big!</h1>
                <p className="bgz-boot-sub">Name your price. Hotels compete. You win.</p>
              </div>
            </div>
            <div className="bgz-boot-tracker" aria-hidden="true">
              <div className="bgz-boot-track-item">
                <span className="bgz-boot-track-num">1</span>
                <span className="bgz-boot-track-name">Where</span>
                <span className="bgz-boot-track-sub">Pick city</span>
              </div>
              <div className="bgz-boot-track-item">
                <span className="bgz-boot-track-num">2</span>
                <span className="bgz-boot-track-name">Property</span>
                <span className="bgz-boot-track-sub">Type of stay</span>
              </div>
              <div className="bgz-boot-track-item">
                <span className="bgz-boot-track-num">3</span>
                <span className="bgz-boot-track-name">Dates</span>
                <span className="bgz-boot-track-sub">Choose dates</span>
              </div>
              <div className="bgz-boot-track-item">
                <span className="bgz-boot-track-num">4</span>
                <span className="bgz-boot-track-name">Guests</span>
                <span className="bgz-boot-track-sub">Who&rsquo;s coming</span>
              </div>
              <div className="bgz-boot-track-item">
                <span className="bgz-boot-track-num">5</span>
                <span className="bgz-boot-track-name">Review</span>
                <span className="bgz-boot-track-sub">Place your bid</span>
              </div>
            </div>
            <ol className="bgz-boot-journey" aria-label="Your 5-step journey">
              <li className="bgz-boot-step bgz-boot-step--right">
                <div className="bgz-boot-step-eyebrow">
                  <span className="bgz-boot-step-num">1</span>
                  <div className="bgz-boot-step-eyebrow-text">
                    <div className="bgz-boot-step-eye-title">Where to stay?</div>
                    <div className="bgz-boot-step-eye-sub">Pick a city and see hotels listening tonight.</div>
                  </div>
                </div>
                <div className="bgz-boot-step-card">
                  <div className="bgz-boot-step-title">Where do you want to stay?</div>
                  <div className="bgz-boot-mock-pills">
                    <span>🏔️ Mussoorie</span>
                    <span>🌲 Dhanaulti</span>
                    <span>🕉️ Rishikesh</span>
                    <span>❄️ Shimla</span>
                    <span>🏂 Manali</span>
                    <span>🌿 Dehradun</span>
                  </div>
                </div>
              </li>
              <li className="bgz-boot-step bgz-boot-step--left">
                <div className="bgz-boot-step-card">
                  <div className="bgz-boot-step-title">What kind of property?</div>
                  <div className="bgz-boot-mock-pills">
                    <span>🏨 Hotel</span>
                    <span>🌴 Resort</span>
                    <span>🏡 Cottage</span>
                  </div>
                </div>
                <div className="bgz-boot-step-eyebrow">
                  <span className="bgz-boot-step-num">2</span>
                  <div className="bgz-boot-step-eyebrow-text">
                    <div className="bgz-boot-step-eye-title">Type of stay?</div>
                    <div className="bgz-boot-step-eye-sub">Pick at least one to start your auction.</div>
                  </div>
                </div>
              </li>
              <li className="bgz-boot-step bgz-boot-step--right">
                <div className="bgz-boot-step-eyebrow">
                  <span className="bgz-boot-step-num">3</span>
                  <div className="bgz-boot-step-eyebrow-text">
                    <div className="bgz-boot-step-eye-title">Select your dates</div>
                    <div className="bgz-boot-step-eye-sub">A short trip — pick smart, save more.</div>
                  </div>
                </div>
                <div className="bgz-boot-step-card">
                  <div className="bgz-boot-step-title">Select your stay dates</div>
                  <div className="bgz-boot-mock-dates">
                    <div><span className="lbl">Check-in</span><span className="val">Tue 28 May</span></div>
                    <div className="sep">→</div>
                    <div><span className="lbl">Check-out</span><span className="val">Wed 29 May</span></div>
                  </div>
                </div>
              </li>
              <li className="bgz-boot-step bgz-boot-step--left">
                <div className="bgz-boot-step-card">
                  <div className="bgz-boot-step-title">Who&rsquo;s coming?</div>
                  <div className="bgz-boot-mock-guests">
                    <span>👤 2 Adults</span>
                    <span>👶 0 Kids</span>
                    <span>🛏 1 Room</span>
                  </div>
                </div>
                <div className="bgz-boot-step-eyebrow">
                  <span className="bgz-boot-step-num">4</span>
                  <div className="bgz-boot-step-eyebrow-text">
                    <div className="bgz-boot-step-eye-title">Who&rsquo;s coming?</div>
                    <div className="bgz-boot-step-eye-sub">Tell us who&rsquo;s travelling &amp; how many rooms.</div>
                  </div>
                </div>
              </li>
              <li className="bgz-boot-step bgz-boot-step--right">
                <div className="bgz-boot-step-eyebrow">
                  <span className="bgz-boot-step-num">5</span>
                  <div className="bgz-boot-step-eyebrow-text">
                    <div className="bgz-boot-step-eye-title">Review &amp; bid</div>
                    <div className="bgz-boot-step-eye-sub">Name your price — launch the auction.</div>
                  </div>
                </div>
                <div className="bgz-boot-step-card">
                  <div className="bgz-boot-step-title">Review &amp; place your bid</div>
                  <div className="bgz-boot-mock-price">
                    <span className="mock-price-amt">₹2,500</span>
                    <span className="mock-price-cta">Place My Bid</span>
                  </div>
                </div>
              </li>
            </ol>
            <button
              type="button"
              className="bgz-boot-cta"
              onClick={handleStart}
              aria-label="Press start to enter the StayBid reverse bidding zone"
            >
              <span className="bgz-boot-cta-glow" aria-hidden="true" />
              <span className="bgz-boot-cta-label">▶ PRESS START</span>
            </button>
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

          {/* v216 — Sachin: header banner ko remove karo. Both the
              "Climb to launch your auction" eyebrow AND the mute
              button are GONE. The climber path itself conveys the
              concept; mountain photo is edge-to-edge. handleToggleMute
              + muted state are kept on the parent because the global
              SoundProvider still reads them. */}
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
