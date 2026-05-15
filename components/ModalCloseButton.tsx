// v125.2 — bulletproof modal close button.
//
// Why a dedicated component?
// Many close buttons across the app are 32×32 (`w-8 h-8`) with `text-white/40`.
// On mobile, that's:
//   • below iOS HIG's 44×44 tap-target minimum (fingers miss);
//   • visually almost invisible against the dark headers;
//   • sometimes inside `data-autonext-form` containers whose global delegate
//     can swallow the click;
//   • occasionally covered by sibling fixed elements with higher z-index.
//
// This component fixes ALL of those failure modes at once:
//   • 44×44 visual + a transparent 56×56 hit-area extension (::before in CSS).
//   • Bright tappable color (champagne accent against dark header / cocoa
//     against cream).
//   • `data-modal-close` marker so the global capture-phase listener (see
//     globals.css `.sb-modal-close` rules) can resolve it even if the
//     framework click misfires.
//   • `data-autonext-skip` keeps the auto-next-scroll delegate's hands off it.
//   • Fires on both onClick AND onMouseDown — captures the tap as early as
//     possible, before any other handler can prevent it.
//   • `aria-label="Close"` + `type="button"` so it never submits a parent form.

"use client";

import { MouseEvent } from "react";

export type ModalCloseButtonProps = {
  onClose: () => void;
  /** "light" = dark text on cream surface; "dark" = light text on dark header. */
  tone?: "light" | "dark";
  /** Tailwind/inline className additions (e.g. "absolute top-3 right-3"). */
  className?: string;
  /** Override the default ✕ glyph. */
  label?: string;
  /** Optional inline style overrides. */
  style?: React.CSSProperties;
  /** A11y override. */
  ariaLabel?: string;
};

export default function ModalCloseButton(p: ModalCloseButtonProps) {
  const tone = p.tone || "dark";
  const handle = (e: MouseEvent | any) => {
    // Stop propagation so a parent backdrop's onClick={onClose} doesn't
    // double-fire and so any auto-next delegate ancestor can't intercept.
    if (e && typeof e.stopPropagation === "function") e.stopPropagation();
    if (e && typeof e.preventDefault === "function") e.preventDefault();
    try { p.onClose(); } catch { /* swallow — closing should never throw */ }
  };

  return (
    <button
      type="button"
      data-modal-close="true"
      data-autonext-skip="true"
      aria-label={p.ariaLabel || "Close"}
      onMouseDown={handle}
      onTouchStart={handle as any}
      onClick={handle}
      className={`sb-modal-close sb-modal-close--${tone} ${p.className || ""}`}
      style={p.style}
    >
      <span aria-hidden="true">{p.label || "✕"}</span>
    </button>
  );
}
