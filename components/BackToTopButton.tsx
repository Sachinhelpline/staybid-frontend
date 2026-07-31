"use client";
// ── Back-to-top floating button ────────────────────────────────────────
// v132.9 — Surfaces when the user has scrolled past `threshold` pixels
// AND viewport is >=1024px. Mobile users have the BottomDock for primary
// nav + DialerNav crown wheel; they don't need an extra floating chip in
// the corner that fights for thumb reach. Desktop users have neither, so
// long pages (hotel detail with many rooms + reviews + OTA comparison)
// benefit from a single-click jump-to-top.
//
// Hidden automatically while any `.fixed.inset-0` modal/sheet is open so
// it doesn't peek through a backdrop. Reduced-motion users get an
// instant jump instead of smooth scroll.

import { useEffect, useState } from "react";

export default function BackToTopButton({
  threshold = 600,
}: { threshold?: number }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    // Skip entirely on mobile/tablet — the BottomDock + DialerNav own
    // the floating-button real estate at <1024px.
    if (!window.matchMedia("(min-width: 1024px)").matches) return;

    const onScroll = () => {
      const past = window.scrollY > threshold;
      // Hide while any modal/sheet is open (anti-flicker).
      const modalOpen = !!document.querySelector(
        '.fixed.inset-0:not([aria-hidden="true"])'
      );
      setVisible(past && !modalOpen);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [threshold]);

  if (!visible) return null;

  const handleClick = () => {
    const reduceMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({
      top: 0,
      behavior: reduceMotion ? "auto" : "smooth",
    });
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label="Back to top"
      className="sb-back-to-top"
      style={{
        position: "fixed",
        right: "24px",
        bottom: "24px",
        width: "44px",
        height: "44px",
        borderRadius: "50%",
        background: "var(--bg-elevated, rgba(31, 26, 15, 0.92))",
        color: "var(--accent, #5f7c98)",
        border: "1px solid var(--border-strong, rgba(106, 133, 160, 0.30))",
        boxShadow:
          "0 12px 28px rgba(15, 12, 8, 0.18), 0 4px 10px rgba(15, 12, 8, 0.10)",
        backdropFilter: "blur(12px) saturate(160%)",
        WebkitBackdropFilter: "blur(12px) saturate(160%)",
        cursor: "pointer",
        zIndex: 45,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: "1.2rem",
        fontWeight: 700,
        lineHeight: 1,
        transition: "transform 0.18s cubic-bezier(.3,1.4,.4,1), background 0.18s ease",
        animation: "sbBackToTopIn 0.24s cubic-bezier(0.3, 1, 0.32, 1) both",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.transform = "translateY(-3px)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.transform = "translateY(0)";
      }}
    >
      ↑
      {/* v132.9.1 — @keyframes sbBackToTopIn moved to app/desktop.css.
          A non-global <style jsx> block would scope the @keyframes name
          to a hashed identifier (`sbBackToTopIn-jsx-abc123`), but the
          inline `animation:` style references the un-hashed name —
          producing a silent mismatch and dead animation. Defining the
          keyframes globally in desktop.css keeps the name stable. */}
    </button>
  );
}
