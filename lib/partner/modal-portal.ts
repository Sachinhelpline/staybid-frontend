"use client";
import { createPortal } from "react-dom";
import { createElement, type ReactNode } from "react";

// v175 — render modal overlays at <body> so `position: fixed` is relative
// to the real viewport. Partner-panel tab content is wrapped in `.fade-up`
// (a CSS animation that leaves a `transform` via `animation-fill-mode:
// both`). A `transform` on any ancestor makes `position: fixed` resolve
// against THAT ancestor, not the viewport — which clipped every modal.
// Portaling to document.body escapes the trap on every device.
//
// v654 — the portal target (document.body) is OUTSIDE `.pdash-root`, so
// portaled partner modals used to escape the partner dark-mode bridge (white
// modal + light inputs in dark). Wrapping the portaled tree in a `.pdash-root`
// scope re-applies the design-system dark rules (bg-white/card-p/inp-p/btn/
// luxury text+border/status tints) to every partner modal at once. The scope
// class deliberately carries NO `bg-luxury-50`, so it never forces an opaque
// background over the modal's own translucent backdrop (see globals.css).
export function modalPortal(node: ReactNode): ReactNode {
  if (typeof document === "undefined") return null;
  return createPortal(createElement("div", { className: "pdash-root" }, node), document.body);
}
