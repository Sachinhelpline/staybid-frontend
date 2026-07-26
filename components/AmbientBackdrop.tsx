"use client";
// ═══════════════════════════════════════════════════════════════════════════
// components/AmbientBackdrop.tsx — v500 "adaptive black" for dark mode.
//
// A fixed, heavily-blurred + darkened copy of the page's hero image, painted
// BEHIND all content. In dark mode the near-black page canvas softly takes on
// the hotel's own photo colours (a quiet "reflection of content"), so the dark
// theme feels alive instead of a flat black rectangle — the same technique the
// reel page already uses for its now-playing frame.
//
// SAFE BY CONSTRUCTION:
//   • Renders NOTHING in light mode (CSS `[data-theme="dark"]` gate) — light
//     mode is byte-identical.
//   • Sits at z-index:-1 over the opaque `--bg-page`, so it only tints the dark
//     ground; it never sits under text. Body copy stays on solid `--bg-card`
//     surfaces above it → contrast is unchanged and WCAG-safe.
//   • pointer-events:none, aria-hidden — purely decorative.
//   • Respects prefers-reduced-motion (no fade) via the CSS below.
// ═══════════════════════════════════════════════════════════════════════════

export function AmbientBackdrop({ image }: { image?: string | null }) {
  if (!image) return null;
  return (
    <div
      className="sb-ambient-backdrop"
      aria-hidden="true"
      style={{ backgroundImage: `url(${image})` }}
    />
  );
}
