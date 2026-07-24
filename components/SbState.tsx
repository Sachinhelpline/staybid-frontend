"use client";

// v451 — shared empty / error state block.
//
// Before v451 every customer page rolled its own "nothing here yet" / "couldn't
// load" UI — 5 visually distinct empty treatments across two palettes (cozy
// tokens vs legacy luxury), and 7 of 12 surfaces had NO error state at all (a
// fetch failure silently rendered the empty state, so "server down" looked like
// "you have no bookings"). This is the one premium block they all share:
// glyph-in-circle + serif title + subtext + optional actions, cozy tokens,
// theme-aware. `.sb-state` CSS lives in app/globals.css.

import Link from "next/link";
import type { ReactNode } from "react";

export type SbStateAction = {
  label: string;
  href?: string;
  onClick?: () => void;
  ghost?: boolean;
};

export default function SbState({
  variant = "empty",
  glyph,
  title,
  subtitle,
  actions,
  className,
}: {
  variant?: "empty" | "error";
  glyph?: ReactNode;
  title: string;
  subtitle?: string;
  actions?: SbStateAction[];
  className?: string;
}) {
  const g = glyph ?? (variant === "error" ? "⚠️" : "✨");
  return (
    <div
      className={`sb-state${variant === "error" ? " sb-state--error" : ""}${className ? " " + className : ""}`}
      role={variant === "error" ? "alert" : undefined}
    >
      <div className="sb-state-glyph" aria-hidden="true">{g}</div>
      <p className="sb-state-title">{title}</p>
      {subtitle && <p className="sb-state-sub">{subtitle}</p>}
      {actions && actions.length > 0 && (
        <div className="sb-state-actions">
          {actions.map((a, i) =>
            a.href ? (
              <Link key={i} href={a.href} className={`sb-state-btn${a.ghost ? " sb-state-btn--ghost" : ""}`}>
                {a.label}
              </Link>
            ) : (
              <button
                key={i}
                type="button"
                onClick={a.onClick}
                className={`sb-state-btn${a.ghost ? " sb-state-btn--ghost" : ""}`}
              >
                {a.label}
              </button>
            )
          )}
        </div>
      )}
    </div>
  );
}
