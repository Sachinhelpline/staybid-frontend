"use client";
// v138 — Welcome Story (Layer 1 of the 3-layer tutorial system).
//
// Fullscreen IG-story-style modal that auto-fires once on first launch
// (when the user is on a customer-facing page, not /admin, /partner,
// /onboard, /auth). 5 cards, manual tap-to-advance (NO auto-progress —
// respects reading pace, especially for Hinglish readers).
//
// Trigger logic:
//   • Skipped if   sb_tutorial_welcome_seen = "1"
//   • Skipped if   sb_tutorial_disabled    = "1"
//   • Skipped on   /admin, /partner, /onboard, /auth
//   • Otherwise    1.2s delay after mount, then fades in
//
// The 1.2s delay lets the user see the page first — premium "the app
// reveals itself" feel rather than slamming an overlay on landing.
//
// Portal-mounted to document.body to escape any parent transform / filter
// containing block (lesson from v132.2 portal-mount fix on partner panel).

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter } from "next/navigation";
import { useTutorial } from "@/lib/tutorial/tutorial-store";
import { WELCOME_STORY } from "@/lib/tutorial/tutorial-content";
import { LanguageToggle } from "./LanguageToggle";

const SKIP_PREFIXES = ["/admin", "/partner", "/onboard", "/auth"];
const REVEAL_DELAY_MS = 1200;

export function WelcomeStory() {
  const pathname = usePathname() || "/";
  const router = useRouter();
  const { hydrated, disabled, isSeen, markSeen, active, setActive, lang } = useTutorial();

  const [mounted, setMounted] = useState(false);
  const [idx, setIdx] = useState(0);
  const [exiting, setExiting] = useState(false);
  const revealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Mount portal target on client only ──────────────────────────────
  useEffect(() => {
    setMounted(true);
  }, []);

  // ── Auto-fire logic ─────────────────────────────────────────────────
  useEffect(() => {
    if (!hydrated) return;
    if (active === "welcome") return; // already open
    if (disabled) return;
    if (isSeen("welcome")) return;
    if (SKIP_PREFIXES.some((p) => pathname.startsWith(p))) return;

    revealTimerRef.current = setTimeout(() => {
      setIdx(0);
      setExiting(false);
      setActive("welcome");
    }, REVEAL_DELAY_MS);

    return () => {
      if (revealTimerRef.current) clearTimeout(revealTimerRef.current);
    };
  }, [hydrated, disabled, pathname, isSeen, active, setActive]);

  // ── Lock body scroll while open ─────────────────────────────────────
  useEffect(() => {
    if (active !== "welcome") return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [active]);

  // ── Keyboard navigation (desktop) ────────────────────────────────────
  useEffect(() => {
    if (active !== "welcome") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement) {
        const tag = e.target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      }
      if (e.key === "ArrowRight" || e.key === " " || e.key === "Enter") {
        e.preventDefault();
        handleNext();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        handlePrev();
      } else if (e.key === "Escape") {
        e.preventDefault();
        handleSkip();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, idx]);

  const content = useMemo(() => WELCOME_STORY[lang] || WELCOME_STORY.en, [lang]);
  const cards = content.cards;
  const total = cards.length;
  const card = cards[idx] || cards[0];
  const isLast = idx === total - 1;

  const close = () => {
    setExiting(true);
    setTimeout(() => {
      markSeen("welcome");
      setActive(null);
      setExiting(false);
      setIdx(0);
    }, 220);
  };

  const handleSkip = () => {
    close();
  };

  const handleNext = () => {
    if (isLast) {
      close();
      return;
    }
    setIdx((i) => Math.min(i + 1, total - 1));
  };

  const handlePrev = () => {
    setIdx((i) => Math.max(i - 1, 0));
  };

  // ── Tap zones (IG-style: left third = back, right two-thirds = next).
  // We keep the buttons too for accessibility / clarity.
  const handleTapZone = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    // Ignore taps inside buttons / interactive controls
    if (target.closest("button") || target.closest("[data-tutorial-noop]")) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    if (x < rect.width * 0.33) handlePrev();
    else handleNext();
  };

  if (!mounted) return null;
  if (active !== "welcome") return null;

  const overlay = (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="StayBid welcome tour"
      className={exiting ? "sb-welcome-overlay sb-welcome-exit" : "sb-welcome-overlay"}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 99000,
        background: "rgba(15, 12, 8, 0.74)",
        backdropFilter: "blur(14px) saturate(120%)",
        WebkitBackdropFilter: "blur(14px) saturate(120%)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "calc(env(safe-area-inset-top, 0px) + 16px) 16px calc(env(safe-area-inset-bottom, 0px) + 16px) 16px",
        animation: exiting ? "sbWelcomeOut 0.22s ease both" : "sbWelcomeIn 0.32s cubic-bezier(.16,.84,.32,1) both",
      }}
    >
      <div
        onClick={handleTapZone}
        style={{
          position: "relative",
          width: "min(420px, 100%)",
          height: "min(720px, 100%)",
          maxHeight: "calc(100dvh - 32px)",
          borderRadius: 28,
          overflow: "hidden",
          background: "linear-gradient(160deg, #FFFCF6 0%, #FAF5EB 55%, #F2EAD8 100%)",
          boxShadow: "0 30px 80px -20px rgba(31, 26, 15, 0.55), 0 0 0 1px rgba(201, 166, 107, 0.22)",
          isolation: "isolate",
          cursor: "pointer",
          userSelect: "none",
        }}
      >
        {/* ── Progress bars (top) ──────────────────────────────────── */}
        <div
          data-tutorial-noop
          style={{
            position: "absolute",
            top: 14,
            left: 14,
            right: 14,
            display: "flex",
            gap: 4,
            zIndex: 5,
          }}
        >
          {cards.map((_, i) => (
            <div
              key={i}
              style={{
                flex: 1,
                height: 3,
                borderRadius: 999,
                background: "rgba(74, 56, 32, 0.18)",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: i < idx ? "100%" : i === idx ? "100%" : "0%",
                  background: "linear-gradient(90deg, #C9A66B, #D9BE82)",
                  transition: "width 0.4s ease",
                }}
              />
            </div>
          ))}
        </div>

        {/* ── Top-right: language toggle + close ──────────────────── */}
        <div
          data-tutorial-noop
          style={{
            position: "absolute",
            top: 28,
            right: 14,
            display: "flex",
            gap: 8,
            alignItems: "center",
            zIndex: 5,
          }}
        >
          <LanguageToggle variant="chip" />
        </div>

        {/* ── Card body ───────────────────────────────────────────── */}
        <div
          key={idx}
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            alignItems: "center",
            padding: "72px 28px 132px 28px",
            textAlign: "center",
            animation: "sbWelcomeCardIn 0.42s cubic-bezier(.16,.84,.32,1) both",
          }}
        >
          {/* Halo behind icon */}
          <div
            style={{
              position: "relative",
              marginBottom: 28,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <span
              aria-hidden
              style={{
                position: "absolute",
                inset: -28,
                borderRadius: "50%",
                background: `radial-gradient(circle at 50% 50%, ${card.accent || "var(--cozy-champagne)"}33 0%, transparent 70%)`,
                animation: "sbWelcomeHalo 3.6s ease-in-out infinite",
              }}
            />
            <span
              style={{
                position: "relative",
                fontSize: 64,
                lineHeight: 1,
                display: "inline-block",
                filter: "drop-shadow(0 6px 16px rgba(201, 166, 107, 0.35))",
                animation: "sbWelcomeIcon 0.6s cubic-bezier(.16,.84,.32,1) both",
              }}
            >
              {card.icon}
            </span>
          </div>

          <h2
            style={{
              margin: 0,
              fontFamily: "'Cormorant Garamond', Georgia, serif",
              fontStyle: "italic",
              fontSize: "clamp(1.6rem, 6vw, 2.1rem)",
              fontWeight: 600,
              lineHeight: 1.18,
              color: "var(--cozy-warm-dark, #1F1A0F)",
              maxWidth: 320,
            }}
          >
            {card.headline}
          </h2>

          <p
            style={{
              marginTop: 14,
              marginBottom: 0,
              fontSize: "0.98rem",
              lineHeight: 1.55,
              color: "var(--cozy-cocoa, #4A3820)",
              maxWidth: 320,
            }}
          >
            {card.body}
          </p>

          <div
            data-tutorial-noop
            style={{
              marginTop: 22,
              display: "flex",
              alignItems: "center",
              gap: 6,
              color: "rgba(110, 84, 48, 0.5)",
              fontSize: 11,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
            }}
          >
            <span>{idx + 1}</span>
            <span>/</span>
            <span>{total}</span>
          </div>
        </div>

        {/* ── Bottom action row ─────────────────────────────────────── */}
        <div
          data-tutorial-noop
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 20,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "0 22px",
            gap: 10,
            zIndex: 5,
          }}
        >
          <button
            type="button"
            onClick={handleSkip}
            style={{
              appearance: "none",
              background: "transparent",
              border: "none",
              color: "rgba(74, 56, 32, 0.7)",
              fontSize: "0.92rem",
              fontWeight: 500,
              padding: "10px 14px",
              cursor: "pointer",
              letterSpacing: "0.02em",
            }}
          >
            {content.skipLabel}
          </button>

          <button
            type="button"
            onClick={handleNext}
            style={{
              position: "relative",
              appearance: "none",
              border: "none",
              cursor: "pointer",
              padding: "12px 24px",
              borderRadius: 999,
              background: "linear-gradient(135deg, #E7CFA0, #D9BE82, #C9A66B)",
              color: "#1F1A0F",
              fontSize: "0.95rem",
              fontWeight: 700,
              letterSpacing: "0.03em",
              boxShadow: "0 10px 24px -8px rgba(201, 166, 107, 0.55), inset 0 1px 0 rgba(255,255,255,0.45)",
              overflow: "hidden",
            }}
          >
            <span style={{ position: "relative", zIndex: 2 }}>
              {isLast ? content.doneLabel : content.nextLabel} {isLast ? "✨" : "›"}
            </span>
          </button>
        </div>

        {/* ── Inline scoped keyframes (single <style> block) ────────── */}
        <style>{`
          @keyframes sbWelcomeIn {
            from { opacity: 0; }
            to   { opacity: 1; }
          }
          @keyframes sbWelcomeOut {
            from { opacity: 1; }
            to   { opacity: 0; }
          }
          @keyframes sbWelcomeCardIn {
            from { opacity: 0; transform: translateY(14px); }
            to   { opacity: 1; transform: translateY(0); }
          }
          @keyframes sbWelcomeIcon {
            0%   { opacity: 0; transform: scale(0.7) rotate(-6deg); }
            60%  { opacity: 1; transform: scale(1.08) rotate(2deg); }
            100% { opacity: 1; transform: scale(1) rotate(0); }
          }
          @keyframes sbWelcomeHalo {
            0%, 100% { opacity: 0.7; transform: scale(1); }
            50%      { opacity: 1;   transform: scale(1.12); }
          }
          @media (prefers-reduced-motion: reduce) {
            .sb-welcome-overlay,
            .sb-welcome-overlay * {
              animation: none !important;
              transition: none !important;
            }
          }
        `}</style>
      </div>
    </div>
  );

  return createPortal(overlay, document.body);
}
