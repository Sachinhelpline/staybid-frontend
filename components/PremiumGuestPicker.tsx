"use client";

/* ═══════════════════════════════════════════════════════════════════
   PremiumGuestPicker (v201)

   Single-counter premium component used across every customer surface
   that asks for a guest / room count. Replaces the old inline +/- UIs:

   - app/bid/page.tsx                       (adults / children / rooms)
   - app/hotels/[id]/page.tsx global picker (adults / children / kids)
   - app/hotels/[id]/page.tsx flash modal   (adults / children)

   The icon morphs with the count (1 = 👤, 2 = 👫, 3-4 = 👨‍👩‍👧, 5+ = group)
   and the value pops with a directional roll on every change.

   API kept tiny on purpose: each call wires ONE counter (single kind +
   single value + single onChange). The host surface stacks 2-3 of these
   in a flex/grid row as it sees fit — no internal layout opinions.

   Styling lives in app/globals.css under the `.pgp-*` namespace because
   adding a styled-jsx block here would hit the SWC visitor.rs:597
   panic documented across v120 / v132.9.1 — globals only.
═════════════════════════════════════════════════════════════════════ */

import { useEffect, useRef, useState } from "react";

export type GuestKind = "adults" | "children" | "kids" | "rooms";

interface Props {
  kind: GuestKind;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  label: string;
  /** Optional small caption under the counter ("12+ yrs", "+₹200", "FREE"). */
  sublabel?: string;
  /** Tints the sublabel — `amber` for paid extras, `emerald` for free perks. */
  sublabelTone?: "default" | "amber" | "emerald";
  /** Extra class on the outer wrapper for surface-specific tweaks. */
  className?: string;
}

const iconFor = (kind: GuestKind, n: number): string => {
  if (kind === "adults") {
    if (n <= 1) return "👤";
    if (n === 2) return "👫";
    if (n <= 4) return "👨‍👩‍👧";
    return "👨‍👩‍👧‍👦";
  }
  if (kind === "children") {
    if (n <= 1) return "👶";
    if (n === 2) return "👶";
    return "👨‍👩‍👧";
  }
  if (kind === "kids") {
    if (n <= 1) return "🧒";
    if (n === 2) return "🧒";
    return "👨‍👩‍👧";
  }
  // rooms
  if (n <= 1) return "🚪";
  if (n === 2) return "🚪";
  return "🏨";
};

const TONE_CLASS: Record<NonNullable<Props["sublabelTone"]>, string> = {
  default: "",
  amber: "pgp-sub-amber",
  emerald: "pgp-sub-emerald",
};

export default function PremiumGuestPicker({
  kind,
  value,
  onChange,
  min = 0,
  max = 10,
  label,
  sublabel,
  sublabelTone = "default",
  className,
}: Props) {
  // Track last-direction so the value-roll animates the right way.
  const prevRef = useRef(value);
  const [dir, setDir] = useState<"up" | "down" | null>(null);
  useEffect(() => {
    if (value > prevRef.current) setDir("up");
    else if (value < prevRef.current) setDir("down");
    prevRef.current = value;
  }, [value]);

  const canDec = value > min;
  const canInc = value < max;

  return (
    <div className={`pgp ${className || ""}`.trim()}>
      <div className="pgp-head">
        <span className="pgp-icon" key={`icon-${kind}-${value}`} aria-hidden="true">
          {iconFor(kind, value)}
        </span>
        <span className="pgp-label">{label}</span>
      </div>
      <div className="pgp-ctrl">
        <button
          type="button"
          aria-label={`Decrease ${label.toLowerCase()}`}
          className="pgp-btn"
          disabled={!canDec}
          onClick={() => { if (canDec) onChange(value - 1); }}
        >
          −
        </button>
        <span
          className="pgp-val"
          key={`val-${value}`}
          data-dir={dir ?? ""}
          aria-live="polite"
        >
          {value}
        </span>
        <button
          type="button"
          aria-label={`Increase ${label.toLowerCase()}`}
          className="pgp-btn"
          disabled={!canInc}
          onClick={() => { if (canInc) onChange(value + 1); }}
        >
          +
        </button>
      </div>
      {sublabel ? <div className={`pgp-sub ${TONE_CLASS[sublabelTone]}`.trim()}>{sublabel}</div> : null}
    </div>
  );
}
