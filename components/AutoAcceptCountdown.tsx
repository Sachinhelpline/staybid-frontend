"use client";
// ── Auto-accept countdown chip ────────────────────────────────────────
// Shown on PENDING bids that have an auto_accept_at scheduled. Displays
// a live MM:SS countdown + tier badge. When the timer hits 0, fires
// /api/bids/[id]/trigger-accept to flip the bid to ACCEPTED instantly
// for the user watching the screen (cron handles missed cases).

import { useEffect, useState } from "react";

type Props = {
  bidId: string;
  autoAcceptAt: string;            // ISO
  bidderTier?: string | null;
  onAccepted: () => void;          // called after server confirms flip
};

const TIER_BADGE: Record<string, { label: string; emoji: string; color: string }> = {
  PREMIUM:  { label: "Premium",  emoji: "👑", color: "#10b981" },
  STRONG:   { label: "Strong",   emoji: "⭐", color: "#22c55e" },
  NORMAL:   { label: "Smart",    emoji: "✨", color: "#eab308" },
  CAUTIOUS: { label: "Cautious", emoji: "🎯", color: "#f59e0b" },
  NEW:      { label: "New",      emoji: "🌟", color: "#3b82f6" },
};

export default function AutoAcceptCountdown({ bidId, autoAcceptAt, bidderTier, onAccepted }: Props) {
  const [now, setNow] = useState(Date.now());
  const [firing, setFiring] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const target = new Date(autoAcceptAt).getTime();
  const ms = Math.max(0, target - now);
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const reached = ms <= 0;

  // Fire trigger-accept once when timer hits 0
  useEffect(() => {
    if (!reached || firing) return;
    setFiring(true);
    (async () => {
      try {
        const token = localStorage.getItem("sb_token");
        const r = await fetch(`/api/bids/${bidId}/trigger-accept`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        });
        if (r.ok) onAccepted();
      } catch { /* ignore — cron will pick it up */ }
    })();
  }, [reached, firing, bidId, onAccepted]);

  const tier = bidderTier ? TIER_BADGE[bidderTier] : null;
  const isUrgent = ms < 30_000 && !reached;

  if (reached) {
    return (
      <div className="mt-3 p-2.5 rounded-xl border" style={{
        background: "linear-gradient(135deg,rgba(16,185,129,0.18),rgba(52,211,153,0.08))",
        borderColor: "rgba(16,185,129,0.4)",
      }}>
        <p className="text-[0.72rem] font-bold text-emerald-300 flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          Confirming your bid…
        </p>
      </div>
    );
  }

  return (
    <div className="mt-3 p-2.5 rounded-xl border" style={{
      background: isUrgent
        ? "linear-gradient(135deg,rgba(245,158,11,0.16),rgba(217,119,6,0.08))"
        : "linear-gradient(135deg,rgba(240,180,41,0.10),rgba(184,135,26,0.05))",
      borderColor: isUrgent ? "rgba(245,158,11,0.45)" : "rgba(240,180,41,0.3)",
    }}>
      <div className="flex items-center gap-2">
        <span className="text-base">⏱</span>
        <p className="text-[0.72rem] font-bold flex-1" style={{ color: isUrgent ? "#fbbf24" : "#f0b429" }}>
          Hotel confirms in <span className="font-mono">{m}:{String(s).padStart(2, "0")}</span>
        </p>
        {tier && (
          <span className="text-[0.55rem] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full"
            style={{ background: tier.color + "22", color: tier.color, border: `1px solid ${tier.color}55` }}>
            {tier.emoji} {tier.label}
          </span>
        )}
      </div>
      <p className="text-[0.6rem] text-white/45 mt-1 leading-snug">
        Hotel can still counter or reject before the timer ends.
      </p>
    </div>
  );
}
