"use client";
// ── Accepted-bid auto-cancel countdown banner ────────────────────────
// Shows a live MM:SS countdown on accepted-but-not-paid bids. At 5 min
// remaining, fires a sticky warning notification. At 0, marks expired
// and shows a red banner.

import { useEffect, useState } from "react";
import {
  type AcceptedBidWindow,
  readWindow, saveWindow, clearWindow, markWarned, markCancelled,
  formatCountdown, timeLeftMs, isExpired, shouldWarn,
  ACCEPTANCE_WINDOW_MIN, WARNING_THRESHOLD_MIN, startAcceptanceWindow,
} from "@/lib/auto-cancel";
import { notify } from "@/lib/notifications";

type Props = {
  bidId: string;
  hotelId?: string;             // for backend persistence + per-hotel windows
  acceptedAt?: string | Date;   // ISO or Date — backend bid.acceptedAt (if available)
  windowMin?: number;           // per-hotel override (from hotel_hold_config)
  onPayNow: () => void;
  onExpired?: () => void;
};

export default function AcceptedBidTimer({ bidId, hotelId, acceptedAt, windowMin, onPayNow, onExpired }: Props) {
  const [w, setW] = useState<AcceptedBidWindow | null>(null);
  const [tick, setTick] = useState(0);
  const [hotelWindow, setHotelWindow] = useState<number | undefined>(undefined);
  // Self-fetch the hotel's per-hotel window if not passed in explicitly.
  // One-shot per (hotelId) — cached for 2 min via the API route header.
  useEffect(() => {
    if (windowMin || !hotelId) return;
    fetch(`/api/hotel-hold-config?hotelId=${encodeURIComponent(hotelId)}`)
      .then((r) => r.json())
      .then((d) => {
        const min = d?.resolved?.acceptance_window_min;
        if (typeof min === "number" && min > 0) setHotelWindow(min);
      })
      .catch(() => {});
  }, [hotelId, windowMin]);
  const effectiveWindow = Math.max(1, windowMin || hotelWindow || ACCEPTANCE_WINDOW_MIN);

  // On mount: ensure we have a window. If localStorage has none + we got
  // an acceptedAt prop, seed it now. (Bids that were ACCEPTED before this
  // build will still be tracked as long as a single visit triggers seeding.)
  useEffect(() => {
    const existing = readWindow(bidId);
    if (existing) {
      setW(existing);
      return;
    }
    const acc = acceptedAt ? new Date(acceptedAt) : new Date();
    const seeded = startAcceptanceWindow(bidId, acc, effectiveWindow, { hotelId });
    setW(seeded);
  }, [bidId, acceptedAt, effectiveWindow, hotelId]);

  // Tick every 1s for countdown + 5-min warning trigger
  useEffect(() => {
    if (!w) return;
    if (isExpired(w)) return;
    const t = setInterval(() => {
      setTick((n) => n + 1);
      const cur = readWindow(bidId);
      if (!cur) return;
      // Trigger warning popup once at 5-min threshold
      if (shouldWarn(cur)) {
        markWarned(bidId);
        notify({
          kind: "bid_expiring_soon",
          title: "⏱ Only 5 minutes left!",
          body: `Confirm payment soon or your accepted bid will auto-cancel.`,
          actions: [
            { label: "Pay Now", onClick: onPayNow, primary: true },
            { label: "View bid", href: "/my-bids" },
          ],
        });
      }
      // Auto-mark as expired
      if (isExpired(cur) && !cur.cancelledAt) {
        markCancelled(bidId);
        notify({
          kind: "bid_auto_cancelled",
          title: "⏰ Bid auto-cancelled",
          body: `Your accepted bid expired after ${ACCEPTANCE_WINDOW_MIN} minutes without payment.`,
        });
        onExpired?.();
      }
    }, 1000);
    return () => clearInterval(t);
  }, [w, bidId, onPayNow, onExpired]);

  if (!w) return null;
  // Re-suppress unused warning around tick
  void tick;

  const expired = isExpired(w);
  const ms = timeLeftMs(w);
  const pct = Math.max(0, Math.min(100, (ms / (effectiveWindow * 60_000)) * 100));
  const warning = ms <= WARNING_THRESHOLD_MIN * 60_000 && !expired;

  if (expired || w.cancelledAt) {
    return (
      <div className="mt-3 p-3 rounded-2xl border" style={{ background: "rgba(75,85,99,0.12)", borderColor: "rgba(209,213,219,0.25)" }}>
        <p className="text-xs font-bold text-white/80">⏰ Acceptance window expired</p>
        <p className="text-[0.65rem] text-white/50 mt-0.5">This bid auto-cancelled after {effectiveWindow} minutes without payment.</p>
        <button onClick={() => { clearWindow(bidId); onExpired?.(); }}
          className="text-[0.65rem] font-semibold underline text-white/60 mt-1.5">Dismiss</button>
      </div>
    );
  }

  const countdown = formatCountdown(w);
  const ringColor = warning ? "#f97316" : "#10b981";

  return (
    <div className="mt-3 p-3 rounded-2xl border" style={{
      background: warning
        ? "linear-gradient(135deg,rgba(245,158,11,0.15),rgba(217,119,6,0.08))"
        : "linear-gradient(135deg,rgba(16,185,129,0.12),rgba(52,211,153,0.06))",
      borderColor: warning ? "rgba(245,158,11,0.45)" : "rgba(16,185,129,0.4)",
    }}>
      <div className="flex items-center gap-3">
        {/* Mini progress ring */}
        <div className="relative shrink-0" style={{ width: 44, height: 44 }}>
          <svg width={44} height={44} viewBox="0 0 44 44">
            <circle cx="22" cy="22" r="18" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="3.5" />
            <circle cx="22" cy="22" r="18" fill="none" stroke={ringColor} strokeWidth="3.5" strokeLinecap="round"
              strokeDasharray={`${(pct / 100) * 113} 113`}
              transform="rotate(-90 22 22)"
              style={{ transition: "stroke-dasharray 0.5s ease, stroke 0.3s ease" }} />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center text-[0.62rem] font-mono font-bold"
            style={{ color: ringColor }}>{countdown}</div>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-bold" style={{ color: warning ? "#fbbf24" : "#10b981" }}>
            {warning ? "⏱ Only 5 minutes left!" : "🎉 Hotel accepted · Pay to confirm"}
          </p>
          <p className="text-[0.62rem] text-white/60 mt-0.5 leading-snug">
            {warning
              ? "Confirm payment now or this bid will auto-cancel."
              : `You have ${countdown} to pay before this bid auto-cancels.`}
          </p>
        </div>
        <button onClick={onPayNow}
          className="text-[0.65rem] font-bold tracking-wide px-3 py-1.5 rounded-full shrink-0 transition-transform active:scale-[0.96]"
          style={{
            background: warning
              ? "linear-gradient(135deg,#f0b429,#f97316)"
              : "linear-gradient(135deg,#10b981,#34d399)",
            color: warning ? "#1c1208" : "#022c22",
            boxShadow: warning ? "0 6px 18px rgba(249,115,22,0.4)" : "0 6px 18px rgba(16,185,129,0.35)",
          }}>
          Pay Now
        </button>
      </div>
    </div>
  );
}
