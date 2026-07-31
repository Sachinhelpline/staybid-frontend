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
import { parseDbTime } from "@/lib/bid-expiry";

type Props = {
  bidId: string;
  hotelId?: string;             // for backend persistence + per-hotel windows
  acceptedAt?: string | Date;   // ISO or Date — backend bid.acceptedAt (if available)
  expiresAt?: string | Date;    // v241.26 — bid.expiresAt, the canonical window-close (preferred)
  windowMin?: number;           // per-hotel override (from hotel_hold_config)
  onPayNow: () => void;
  onExpired?: () => void;
};

export default function AcceptedBidTimer({ bidId, hotelId, acceptedAt, expiresAt, windowMin, onPayNow, onExpired }: Props) {
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

  // On mount: derive the countdown window from the BID's real acceptedAt.
  //
  // v231 — Removed the v74 "reset on stale" branch entirely. It was the
  // root cause of the "timer always restarts on refresh" bug:
  //   • Old v74 behaviour: if (now - acceptedAt) > 15 min → wipe local,
  //     POST a fresh acceptance window to the backend, render a fresh
  //     countdown from now(). On every page refresh of an 8-day-old
  //     accepted bid the customer saw "14:30 remaining" — forever.
  //   • The v74 fix was meant to recover from a buggy localStorage seed,
  //     but it overshot: a bid that's genuinely past its 15-min window
  //     should EXPIRE, not silently get a brand new window.
  //
  // New rule: the bid's actual acceptedAt (server timestamp, passed in
  // via prop) is the source of truth. We compute expiresAt from it and
  // let the existing isExpired/shouldWarn helpers do their job. If the
  // bid is past its window the timer renders the "expired" state and
  // /my-bids' filterActiveBids hides the row entirely on next render.
  useEffect(() => {
    // v241.26 — PREFER the bid's stamped expiresAt. The
    // trg_stamp_accepted_expiry DB trigger now writes expiresAt =
    // acceptTime + per-hotel window on EVERY accept path, so it's the
    // canonical "window closes at" and exactly what isBidPayWindowOpen /
    // isBidExpired read. Driving the countdown off it keeps the timer in
    // lockstep with the Pay-CTA gate + the stale-row filter (kills the N4
    // divergence where the timer said "expired" while the CTA stayed open,
    // or vice-versa). acceptedAt (if passed) only anchors the ring's full
    // baseline; otherwise we back-derive it from expiresAt − window.
    if (expiresAt) {
      // v241.26 — parse via parseDbTime: bid.expiresAt is a tz-less Postgres
      // timestamp; new Date() would read it as local (5.5h off on IST) and
      // the timer would show "expired" the instant the bid is accepted.
      const expMs = parseDbTime(expiresAt);
      if (!Number.isNaN(expMs)) {
        const accCand = parseDbTime(acceptedAt);
        const accMs = !Number.isNaN(accCand) ? accCand : expMs - effectiveWindow * 60_000;
        const computed: AcceptedBidWindow = {
          bidId,
          acceptedAt: new Date(accMs).toISOString(),
          expiresAt:  new Date(expMs).toISOString(),
        };
        saveWindow(computed);
        setW(computed);
        return;
      }
    }
    if (acceptedAt) {
      const accMs = parseDbTime(acceptedAt);
      if (!Number.isNaN(accMs)) {
        const computed: AcceptedBidWindow = {
          bidId,
          acceptedAt: new Date(accMs).toISOString(),
          expiresAt:  new Date(accMs + effectiveWindow * 60_000).toISOString(),
        };
        // Overwrite any stale local seed with the real timestamp.
        saveWindow(computed);
        setW(computed);
        return;
      }
    }
    // No acceptedAt prop AND no local row → seed from now(). Only path
    // where we still mirror to the backend, so a brand-new accept (e.g.
    // hotel just accepted while user has /my-bids open) gets persisted.
    const existing = readWindow(bidId);
    if (existing) {
      setW(existing);
      return;
    }
    const seeded = startAcceptanceWindow(bidId, new Date(), effectiveWindow, { hotelId });
    setW(seeded);
  }, [bidId, acceptedAt, expiresAt, effectiveWindow, hotelId]);

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
    // v241.22 — theme-aware amber/cocoa palette. Pre-fix used
    // text-white/80 + text-white/50 + text-white/60 which was invisible
    // on every light-theme customer surface (/hotels/[id], /my-bids).
    // Now uses warm amber tones that contrast on both light cream and
    // dark cocoa backgrounds.
    return (
      <div className="mt-3 p-3 rounded-2xl border" style={{
        background: "linear-gradient(135deg, rgba(245,158,11,0.10), rgba(217,119,6,0.06))",
        borderColor: "rgba(180,83,9,0.35)"
      }}>
        <p className="text-xs font-bold" style={{ color: "#7c2d12" }}>⏰ Acceptance window expired</p>
        <p className="text-[0.65rem] mt-0.5" style={{ color: "#9a3412" }}>
          This bid auto-cancelled after {effectiveWindow} minutes without payment.
        </p>
        <button onClick={() => { clearWindow(bidId); onExpired?.(); }}
          className="text-[0.65rem] font-semibold underline mt-1.5" style={{ color: "#7c2d12" }}>
          Dismiss
        </button>
      </div>
    );
  }

  const countdown = formatCountdown(w);
  const ringColor = warning ? "#f97316" : "#52708c";

  return (
    <div className="mt-3 p-3 rounded-2xl border" style={{
      background: warning
        ? "linear-gradient(135deg,rgba(245,158,11,0.15),rgba(217,119,6,0.08))"
        : "linear-gradient(135deg,rgba(106,133,160,0.14),rgba(140,160,182,0.07))",
      borderColor: warning ? "rgba(245,158,11,0.45)" : "rgba(106,133,160,0.42)",
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
          <p className="text-xs font-bold" style={{ color: warning ? "#b5c2d0" : "#4f6d8a" }}>
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
              ? "linear-gradient(135deg,#a9b9c8,#f97316)"
              : "radial-gradient(88% 64% at 32% 4%,rgba(240,247,253,0.24),transparent 58%),linear-gradient(160deg,#a0b2c6 0%,#6f8aa6 50%,#42566d 100%)",
            color: warning ? "#1c1208" : "#ffffff",
            textShadow: warning ? "none" : "0 1px 1px rgba(20,30,44,0.35)",
            boxShadow: warning ? "0 6px 18px rgba(249,115,22,0.4)" : "0 6px 16px -6px rgba(45,62,82,0.5), inset 0 1px 0 rgba(255,255,255,0.4)",
          }}>
          Pay Now
        </button>
      </div>
    </div>
  );
}
