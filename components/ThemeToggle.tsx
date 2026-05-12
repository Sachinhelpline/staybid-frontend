"use client";
// ═══════════════════════════════════════════════════════════════════════════
// components/ThemeToggle.tsx — Single button that flips the whole UI
// between light + dark cozy modes (v90).
//
// Premium-minimal styling that adapts to the active theme:
//   • Light mode  → champagne pill, sun glyph, cocoa text
//   • Dark mode   → cocoa pill, moon glyph, cream text
//   • Animated icon swap (sun rises ↔ moon sets)
//
// Two variants:
//   • <ThemeToggle />            — compact pill, suitable for drawers / menus
//   • <ThemeToggle variant="lg" /> — bigger row with explicit label, for
//                                    settings pages
// ═══════════════════════════════════════════════════════════════════════════
import { useTheme } from "@/lib/theme-store";

export function ThemeToggle({ variant = "pill" }: { variant?: "pill" | "lg" }) {
  const { theme, toggle } = useTheme();
  const isDark = theme === "dark";

  if (variant === "lg") {
    return (
      <button
        type="button"
        onClick={toggle}
        className="tt-row"
        aria-label={`Switch to ${isDark ? "light" : "dark"} mode`}
        aria-pressed={isDark}
      >
        <span className="tt-row-icon">{isDark ? "🌙" : "☀️"}</span>
        <div className="tt-row-text">
          <p className="tt-row-label">Appearance</p>
          <p className="tt-row-sub">{isDark ? "Dark mode" : "Light mode"} · tap to switch</p>
        </div>
        <span className="tt-row-pill">
          <span className={`tt-row-pill-dot${isDark ? " is-dark" : ""}`} />
        </span>
        <style jsx global>{`
          .tt-row {
            display: flex; align-items: center; gap: 14px;
            width: 100%; padding: 12px 14px;
            border-radius: 12px;
            background: transparent; border: none; cursor: pointer;
            color: var(--text-base);
            font: inherit; text-align: left;
            transition: background 0.18s ease;
          }
          .tt-row:hover { background: var(--accent-soft); }
          .tt-row-icon {
            width: 38px; height: 38px; border-radius: 10px;
            background: var(--accent-soft);
            display: inline-flex; align-items: center; justify-content: center;
            font-size: 1.15rem; flex-shrink: 0;
          }
          .tt-row-text { flex: 1; min-width: 0; }
          .tt-row-label {
            font-size: 0.92rem; font-weight: 700;
            color: var(--text-base); line-height: 1.15; margin: 0;
          }
          .tt-row-sub {
            font-size: 0.72rem; color: var(--text-muted);
            font-weight: 500; margin: 2px 0 0;
          }
          .tt-row-pill {
            position: relative;
            width: 44px; height: 24px; border-radius: 999px;
            background: var(--bg-pill); border: 1px solid var(--border-soft);
            flex-shrink: 0;
            transition: background 0.22s ease, border-color 0.22s ease;
          }
          .tt-row-pill-dot {
            position: absolute; top: 2px; left: 2px;
            width: 18px; height: 18px; border-radius: 999px;
            background: var(--accent);
            box-shadow: 0 1px 4px rgba(31, 26, 15, 0.30);
            transition: transform 0.28s cubic-bezier(.32, 1.2, .36, 1);
          }
          .tt-row-pill-dot.is-dark { transform: translateX(20px); }
        `}</style>
      </button>
    );
  }

  // Default compact pill — for navbars, drawers, top bars
  return (
    <button
      type="button"
      onClick={toggle}
      className="tt-pill"
      aria-label={`Switch to ${isDark ? "light" : "dark"} mode`}
      aria-pressed={isDark}
      title={`${isDark ? "Light" : "Dark"} mode`}
    >
      <span className={`tt-pill-icon${isDark ? " is-dark" : ""}`}>
        {isDark ? "🌙" : "☀️"}
      </span>
      <style jsx global>{`
        .tt-pill {
          display: inline-flex; align-items: center; justify-content: center;
          width: 34px; height: 34px; border-radius: 999px;
          background: var(--bg-pill);
          border: 1px solid var(--border-soft);
          color: var(--text-base);
          cursor: pointer;
          transition:
            background 0.18s ease,
            border-color 0.18s ease,
            transform 0.14s cubic-bezier(.32, 1.2, .36, 1);
        }
        .tt-pill:hover { border-color: var(--accent); }
        .tt-pill:active { transform: scale(0.92); }
        .tt-pill-icon {
          font-size: 1rem; line-height: 1;
          transition: transform 0.32s cubic-bezier(.32, 1.2, .36, 1);
        }
        .tt-pill-icon.is-dark { transform: rotate(360deg); }
      `}</style>
    </button>
  );
}
