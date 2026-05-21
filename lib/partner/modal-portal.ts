"use client";
import { createPortal } from "react-dom";
import type { ReactNode } from "react";

// v175 — render modal overlays at <body> so `position: fixed` is relative
// to the real viewport. Partner-panel tab content is wrapped in `.fade-up`
// (a CSS animation that leaves a `transform` via `animation-fill-mode:
// both`). A `transform` on any ancestor makes `position: fixed` resolve
// against THAT ancestor, not the viewport — which clipped every modal.
// Portaling to document.body escapes the trap on every device.
export function modalPortal(node: ReactNode): ReactNode {
  if (typeof document === "undefined") return null;
  return createPortal(node, document.body);
}
