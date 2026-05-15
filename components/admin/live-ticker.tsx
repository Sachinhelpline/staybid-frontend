"use client";
// Shared live-data ticker used across /admin/{dashboard, bookings, analytics}.
// Two complementary surfaces:
//   <LivePill />        — pulse + "LIVE · refreshed Xs ago" badge
//   <LiveCountdown />   — counts down from a future ISO timestamp (auto-accept
//                         windows, hold expiry, etc.). MM:SS format, red <60s.

import { useEffect, useRef, useState } from "react";

export function LivePill({
  lastRefreshAt,
  refreshNow,
  size = "sm",
  label = "LIVE",
}: {
  lastRefreshAt: number;             // ms timestamp of latest data refresh
  refreshNow?: () => void;           // manual refresh CTA
  size?: "sm" | "md";
  label?: string;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const secs = Math.max(0, Math.floor((now - (lastRefreshAt || now)) / 1000));
  const dim = size === "md" ? { dot: 9, font: 11, pad: "5px 11px" } : { dot: 7, font: 10, pad: "3px 9px" };
  return (
    <button
      onClick={refreshNow}
      disabled={!refreshNow}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        padding: dim.pad,
        borderRadius: 999,
        background: "rgba(46,204,113,0.12)",
        color: "#2ECC71",
        border: "1px solid rgba(46,204,113,0.32)",
        fontWeight: 700,
        fontSize: dim.font,
        letterSpacing: "0.08em",
        cursor: refreshNow ? "pointer" : "default",
        fontFamily: "DM Sans, sans-serif",
      }}
      title={refreshNow ? "Click to force refresh" : undefined}
    >
      <span
        style={{
          width: dim.dot,
          height: dim.dot,
          borderRadius: 999,
          background: "#2ECC71",
          animation: "lt-pulse 1.6s ease-in-out infinite",
        }}
      />
      <span>{label}</span>
      <span style={{ color: "#8A8FA8", fontWeight: 600 }}>
        · {secs < 5 ? "just now" : secs < 60 ? `${secs}s ago` : `${Math.floor(secs / 60)}m ago`}
      </span>
      <style>{`@keyframes lt-pulse { 0%,100% { opacity: 1 } 50% { opacity: 0.35 } }`}</style>
    </button>
  );
}

export function LiveCountdown({
  endsAt,
  label,
  size = "sm",
  onZero,
}: {
  endsAt: string | number | Date;
  label?: string;
  size?: "sm" | "md";
  onZero?: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  const endMs = typeof endsAt === "string" ? new Date(endsAt).getTime() : endsAt instanceof Date ? endsAt.getTime() : endsAt;
  const firedRef = useRef(false);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (!firedRef.current && endMs - now <= 0 && onZero) {
      firedRef.current = true;
      onZero();
    }
  }, [now, endMs, onZero]);

  const ms = Math.max(0, endMs - now);
  const totalSec = Math.floor(ms / 1000);
  const expired = totalSec === 0;
  const d = Math.floor(totalSec / 86400);
  const h = Math.floor((totalSec % 86400) / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;

  let display: string;
  if (d > 0) display = `${d}d ${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  else if (h > 0) display = `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  else display = `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;

  const color = expired ? "#8A8FA8" : totalSec < 60 ? "#FF4757" : totalSec < 300 ? "#F0D060" : "#2ECC71";
  const dim = size === "md" ? { font: 12, pad: "4px 9px" } : { font: 10.5, pad: "2px 7px" };

  return (
    <span style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 5,
      padding: dim.pad,
      borderRadius: 999,
      background: `${color}1F`,
      color,
      border: `1px solid ${color}52`,
      fontWeight: 700,
      fontSize: dim.font,
      fontFamily: "ui-monospace, monospace",
      letterSpacing: "0.04em",
    }} title={`Ends ${new Date(endMs).toLocaleString("en-IN")}`}>
      {label && <span style={{ fontFamily: "DM Sans, sans-serif", textTransform: "uppercase", letterSpacing: "0.08em" }}>{label}</span>}
      {expired ? "ENDED" : display}
    </span>
  );
}

// Auto-poll hook — re-fetches every `intervalMs` while the tab is visible.
// Pauses when the tab is hidden to save bandwidth.
export function useAutoPoll(fn: () => any, intervalMs = 10_000) {
  const [lastAt, setLastAt] = useState<number>(() => Date.now());
  const fnRef = useRef(fn);
  useEffect(() => { fnRef.current = fn; }, [fn]);
  useEffect(() => {
    let timer: any;
    function tick() {
      if (document.hidden) return;
      Promise.resolve(fnRef.current?.())
        .catch(() => {})
        .finally(() => setLastAt(Date.now()));
    }
    timer = setInterval(tick, intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return { lastAt, refresh: () => { Promise.resolve(fnRef.current?.()).catch(() => {}).finally(() => setLastAt(Date.now())); } };
}
