"use client";
// ═══════════════════════════════════════════════════════════════════════════
// CountUp — animated number tick from 0 → target.
//
// Used across customer surfaces (points balance, wallet total, bookings
// count, etc.) to give numbers a premium "live" feel instead of just
// rendering a flat value. Runs once on mount unless `key` changes.
//
// Respects `prefers-reduced-motion` — renders the final value immediately
// with no animation.
//
// Usage:
//   <CountUp value={1240} duration={900} />
//   <CountUp value={49} prefix="₹" />
//   <CountUp value={88} suffix="/100" />
// ═══════════════════════════════════════════════════════════════════════════

import { useEffect, useRef, useState } from "react";

type Props = {
  value: number;
  duration?: number;          // ms (default 900)
  prefix?: string;
  suffix?: string;
  decimals?: number;          // default 0
  className?: string;
};

export function CountUp({
  value,
  duration = 900,
  prefix = "",
  suffix = "",
  decimals = 0,
  className,
}: Props) {
  const [display, setDisplay] = useState(0);
  const rafRef = useRef<number | null>(null);
  const startRef = useRef<number | null>(null);

  useEffect(() => {
    // Reduced motion → render final value immediately.
    if (
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    ) {
      setDisplay(value);
      return;
    }

    startRef.current = null;
    const target = value;
    const startVal = 0;
    const t0 = performance.now();
    startRef.current = t0;

    const tick = (now: number) => {
      const elapsed = now - (startRef.current ?? t0);
      const pct = Math.min(1, elapsed / Math.max(1, duration));
      // ease-out cubic — sharp start, decelerates into final value
      const eased = 1 - Math.pow(1 - pct, 3);
      const curr = startVal + (target - startVal) * eased;
      setDisplay(curr);
      if (pct < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        setDisplay(target);
      }
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [value, duration]);

  const formatted =
    decimals > 0 ? display.toFixed(decimals) : Math.round(display).toLocaleString();

  return (
    <span className={className} style={{ fontVariantNumeric: "tabular-nums" }}>
      {prefix}
      {formatted}
      {suffix}
    </span>
  );
}
