"use client";
// ═══════════════════════════════════════════════════════════════════════════
// TrustRing — premium animated AI trust-score dial.
//
// One shared component for all three verification surfaces (customer /
// partner / admin). Tone-aware so it reads correctly on cozy-cream light
// surfaces AND on the dark-luxury admin canvas.
//
//   <TrustRing score={88} size={104} />            // light (default)
//   <TrustRing score={42} size={72} tone="dark" /> // admin dark canvas
//
// Animates the arc fill on mount + counts the number up. Respects
// prefers-reduced-motion (renders final state with no motion).
// ═══════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import { CountUp } from "@/components/CountUp";

type Tone = "light" | "dark";

function bandFor(score: number): { color: string; glow: string; label: string } {
  if (score >= 80) return { color: "#7F9269", glow: "rgba(127,146,105,0.45)", label: "Trusted" };
  if (score >= 50) return { color: "#5f7c98", glow: "rgba(106,133,160,0.45)", label: "Review" };
  return { color: "#D49583", glow: "rgba(212,149,131,0.45)", label: "Flagged" };
}

export default function TrustRing({
  score,
  size = 104,
  tone = "light",
  caption,
  animate = true,
}: {
  score: number;
  size?: number;
  tone?: Tone;
  caption?: string;
  animate?: boolean;
}) {
  const s = Math.max(0, Math.min(100, Math.round(score)));
  const band = bandFor(s);
  const stroke = Math.max(6, Math.round(size * 0.085));
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const target = circ * (1 - s / 100);

  const [offset, setOffset] = useState(animate ? circ : target);
  useEffect(() => {
    if (!animate) { setOffset(target); return; }
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) { setOffset(target); return; }
    const id = requestAnimationFrame(() => setOffset(target));
    return () => cancelAnimationFrame(id);
  }, [target, animate]);

  const track = tone === "dark" ? "rgba(255,255,255,0.09)" : "rgba(31,26,15,0.08)";
  const numColor = tone === "dark" ? "#E8EAF0" : "var(--cozy-warm-dark, #1F1A0F)";
  const denColor = tone === "dark" ? "#8A8FA8" : "var(--cozy-cocoa-soft, #6E5430)";

  return (
    <div style={{ width: size, textAlign: "center", flexShrink: 0 }}>
      <div style={{ position: "relative", width: size, height: size, margin: "0 auto" }}>
        <svg width={size} height={size} style={{ transform: "rotate(-90deg)", filter: `drop-shadow(0 0 8px ${band.glow})` }}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={band.color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circ}
            strokeDashoffset={offset}
            style={{ transition: animate ? "stroke-dashoffset 1.1s cubic-bezier(.32,1,.36,1)" : "none" }}
          />
        </svg>
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            lineHeight: 1,
          }}
        >
          <div style={{ fontSize: size * 0.3, fontWeight: 700, color: numColor, fontVariantNumeric: "tabular-nums" }}>
            <CountUp value={s} duration={animate ? 1000 : 0} />
          </div>
          <div style={{ fontSize: size * 0.11, color: denColor, marginTop: 1, letterSpacing: "0.04em" }}>/ 100</div>
        </div>
      </div>
      {(caption || band.label) && (
        <div
          style={{
            marginTop: 8,
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "3px 10px",
            borderRadius: 999,
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            color: band.color,
            background: tone === "dark" ? `${band.color}1f` : `${band.color}22`,
            border: `1px solid ${band.color}55`,
          }}
        >
          <span style={{ width: 6, height: 6, borderRadius: 999, background: band.color, boxShadow: `0 0 6px ${band.glow}` }} />
          {caption || band.label}
        </div>
      )}
    </div>
  );
}
