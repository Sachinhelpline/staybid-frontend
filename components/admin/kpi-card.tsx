"use client";
// v100 — Premium KPI card with optional sparkline + CountUp + pulse-on-change.
//
// Backwards compatible with every existing call-site: title, value, sub,
// color, icon, trend all preserved. New props are opt-in:
//   sparkline?: number[]    7–30 point mini-series
//   sparkColor?: string     defaults to `color`
//   live?: boolean          pulses the gold accent stripe when value changes
//   format?: (n) => string  custom number formatter
//   onClick?: () => void    makes the card tappable

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

interface KpiCardProps {
  title: string;
  value: string | number;
  sub?: string;
  color?: string;
  icon?: ReactNode;
  trend?: number;
  sparkline?: number[];
  sparkColor?: string;
  live?: boolean;
  format?: (n: number) => string;
  onClick?: () => void;
}

export default function KpiCard({
  title,
  value,
  sub,
  color = "#9fb1c2",
  icon,
  trend,
  sparkline,
  sparkColor,
  live = false,
  format,
  onClick,
}: KpiCardProps) {
  const numericValue = typeof value === "number" ? value : parseNumeric(value);
  const isNumeric = !Number.isNaN(numericValue);
  const displayed = useCountUp(isNumeric ? numericValue : 0, format, !isNumeric);
  const [pulse, setPulse] = useState(false);
  const prev = useRef<number | string>(value);

  // Pulse the accent stripe whenever the underlying value changes
  useEffect(() => {
    if (prev.current === value) return;
    prev.current = value;
    if (!live) return;
    setPulse(true);
    const t = setTimeout(() => setPulse(false), 900);
    return () => clearTimeout(t);
  }, [value, live]);

  const finalSparkColor = sparkColor || color;

  return (
    <div
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : -1}
      style={{
        background: "#151820",
        border: "1px solid rgba(255,255,255,0.07)",
        borderRadius: 14,
        padding: "18px 22px",
        display: "flex",
        flexDirection: "column",
        gap: 6,
        position: "relative",
        overflow: "hidden",
        cursor: onClick ? "pointer" : "default",
        transition: "transform 0.18s, box-shadow 0.18s, border-color 0.18s",
      }}
      onMouseEnter={(e) => {
        if (onClick) {
          e.currentTarget.style.transform = "translateY(-2px)";
          e.currentTarget.style.borderColor = color + "55";
          e.currentTarget.style.boxShadow = `0 12px 28px ${color}22`;
        }
      }}
      onMouseLeave={(e) => {
        if (onClick) {
          e.currentTarget.style.transform = "translateY(0)";
          e.currentTarget.style.borderColor = "rgba(255,255,255,0.07)";
          e.currentTarget.style.boxShadow = "none";
        }
      }}
    >
      {/* Accent stripe — pulses on value change when live=true */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 3,
          background: `linear-gradient(90deg, ${color}, transparent)`,
          opacity: pulse ? 1 : 0.85,
          filter: pulse ? `drop-shadow(0 0 8px ${color})` : "none",
          transition: "opacity 0.3s, filter 0.3s",
        }}
      />
      {pulse && (
        <span
          style={{
            position: "absolute",
            top: 8,
            right: 12,
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: color,
            boxShadow: `0 0 8px ${color}`,
            animation: "kpi-pulse 0.9s ease-out",
          }}
        />
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
        <span
          style={{
            fontSize: 11,
            color: "#8A8FA8",
            fontFamily: "DM Sans, sans-serif",
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
          }}
        >
          {title}
        </span>
        {icon && (
          <span
            style={{
              width: 34,
              height: 34,
              background: color + "18",
              borderRadius: 10,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 17,
              color,
              flexShrink: 0,
            }}
          >
            {icon}
          </span>
        )}
      </div>

      <div
        style={{
          fontSize: 28,
          fontWeight: 700,
          color: "#E8EAF0",
          fontFamily: "Syne, sans-serif",
          lineHeight: 1.1,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {isNumeric ? displayed : value}
      </div>

      {(sub || trend !== undefined) && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 18 }}>
          {trend !== undefined && (
            <span
              style={{
                fontSize: 12,
                color: trend >= 0 ? "#2ECC71" : "#FF4757",
                fontWeight: 600,
              }}
            >
              {trend >= 0 ? "▲" : "▼"} {Math.abs(trend)}%
            </span>
          )}
          {sub && (
            <span style={{ fontSize: 11, color: "#8A8FA8", fontFamily: "DM Sans, sans-serif" }}>
              {sub}
            </span>
          )}
        </div>
      )}

      {/* Optional sparkline */}
      {sparkline && sparkline.length > 1 && (
        <div style={{ marginTop: 4, height: 30 }}>
          <Sparkline data={sparkline} color={finalSparkColor} />
        </div>
      )}

      <style jsx>{`
        @keyframes kpi-pulse {
          0%   { transform: scale(0.5); opacity: 1; }
          70%  { transform: scale(2.5); opacity: 0; }
          100% { transform: scale(2.5); opacity: 0; }
        }
      `}</style>
    </div>
  );
}

// ── CountUp ─────────────────────────────────────────────────────────────
// Animates an integer/float from its previous render value to the next.
// Disabled (returns the value as-is) when `disabled` is true — used to
// pass through string values without forcing them through numeric parsing.
function useCountUp(target: number, formatter?: (n: number) => string, disabled = false): string {
  const [val, setVal] = useState(target);
  const fromRef = useRef(target);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (disabled) return;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    const from = fromRef.current;
    const to = target;
    if (from === to) { setVal(to); return; }
    const start = performance.now();
    const dur = 700;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / dur);
      // ease-out cubic
      const eased = 1 - Math.pow(1 - p, 3);
      setVal(from + (to - from) * eased);
      if (p < 1) rafRef.current = requestAnimationFrame(tick);
      else fromRef.current = to;
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [target, disabled]);

  return useMemo(() => {
    if (disabled) return String(target);
    if (formatter) return formatter(val);
    // Default: integer values render without decimals, decimals get 2 places
    return Math.abs(val % 1) > 0.001
      ? val.toFixed(2)
      : Math.round(val).toLocaleString("en-IN");
  }, [val, formatter, disabled, target]);
}

// Extract numeric prefix/value from formatted strings like "₹1,23,456" or "82.4"
function parseNumeric(v: any): number {
  if (typeof v === "number") return v;
  if (typeof v !== "string") return NaN;
  const cleaned = v.replace(/[^\d.\-]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : NaN;
}

// ── Sparkline SVG ───────────────────────────────────────────────────────
// Tiny inline area-chart. No external dependencies — keeps the KPI card
// bundle small and works without recharts. The path is auto-smoothed
// with simple Catmull-Rom-to-Bezier conversion for visual polish.
function Sparkline({ data, color }: { data: number[]; color: string }) {
  const W = 100;
  const H = 30;
  const PAD = 1;

  const { path, area, points, last, prev } = useMemo(() => {
    if (data.length < 2) return { path: "", area: "", points: [] as any[], last: 0, prev: 0 };
    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;
    const pts = data.map((v, i) => ({
      x: PAD + (i / (data.length - 1)) * (W - PAD * 2),
      y: PAD + (1 - (v - min) / range) * (H - PAD * 2),
    }));

    // Catmull-Rom -> cubic Bezier for smoothing
    let d = `M${pts[0].x},${pts[0].y}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[Math.min(pts.length - 1, i + 2)];
      const c1x = p1.x + (p2.x - p0.x) / 6;
      const c1y = p1.y + (p2.y - p0.y) / 6;
      const c2x = p2.x - (p3.x - p1.x) / 6;
      const c2y = p2.y - (p3.y - p1.y) / 6;
      d += ` C${c1x},${c1y} ${c2x},${c2y} ${p2.x},${p2.y}`;
    }

    const areaPath = d + ` L${pts[pts.length - 1].x},${H} L${pts[0].x},${H} Z`;
    return {
      path: d,
      area: areaPath,
      points: pts,
      last: data[data.length - 1],
      prev: data[data.length - 2],
    };
  }, [data]);

  if (!path) return null;
  const gradientId = `spark-grad-${color.replace(/[^a-z0-9]/gi, "")}`;
  const lastPt = points[points.length - 1];
  const rising = last >= prev;

  return (
    <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ display: "block" }}>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"  stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradientId})`} />
      <path d={path} fill="none" stroke={color} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
      {lastPt && (
        <>
          <circle cx={lastPt.x} cy={lastPt.y} r={2.6} fill={color} />
          <circle cx={lastPt.x} cy={lastPt.y} r={4.5} fill={color} opacity={0.25}>
            <animate attributeName="r" values="3;7;3" dur="2s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.35;0;0.35" dur="2s" repeatCount="indefinite" />
          </circle>
        </>
      )}
      {/* Trend tick — invisible, just for SR / debugging */}
      <title>{rising ? `Up: ${prev} → ${last}` : `Down: ${prev} → ${last}`}</title>
    </svg>
  );
}
