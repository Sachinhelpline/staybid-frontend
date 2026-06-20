"use client";
// RewardLadder — stamp-count unlockables (3→voucher, 7→breakfast, 11→upgrade,
// 20→free night). Claiming mints a real redemption_code (shows up in My Codes).
import { useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import type { RewardState } from "@/lib/passport/engine";

export function RewardLadder({
  rewards,
  stampCount,
  onClaimed,
}: {
  rewards: RewardState[];
  stampCount: number;
  onClaimed?: () => void;
}) {
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [justClaimed, setJustClaimed] = useState<{ key: string; code: string } | null>(null);

  const claim = async (key: string) => {
    setBusyKey(key);
    setError("");
    try {
      const res = await api.claimPassportReward(key);
      if (res?.ok && res?.code) {
        setJustClaimed({ key, code: res.code });
        onClaimed?.();
      } else {
        setError(res?.error || "Couldn't claim — try again.");
      }
    } catch {
      setError("Couldn't claim — try again.");
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-display text-lg font-semibold" style={{ color: "var(--text-base)" }}>
          🎁 Stamp Rewards
        </h3>
        <span className="text-xs font-semibold" style={{ color: "var(--text-muted)" }}>
          {stampCount} stamps
        </span>
      </div>

      {error && (
        <div className="mb-3 rounded-xl px-3 py-2 text-xs font-medium" style={{ background: "#fde8e4", color: "#a85b4e" }}>
          {error}
        </div>
      )}

      <div className="space-y-2.5">
        {rewards.map((r) => {
          const claimed = r.claimed || justClaimed?.key === r.key;
          const code = justClaimed?.key === r.key ? justClaimed.code : r.claimedCode;
          return (
            <div
              key={r.key}
              className="rounded-2xl p-3.5 flex items-center gap-3 sb-card-lift"
              style={{
                background: r.unlocked ? "linear-gradient(160deg,#fffdf8,#fbf3e2)" : "var(--bg-card)",
                border: r.unlocked ? "1px solid rgba(201,166,107,0.4)" : "1px solid var(--border-soft)",
                opacity: r.unlocked ? 1 : 0.7,
              }}
            >
              <div
                className="w-12 h-12 rounded-2xl flex items-center justify-center text-2xl shrink-0"
                style={{ background: r.unlocked ? "linear-gradient(135deg,#E7CFA0,#C9A66B)" : "var(--bg-pill)" }}
              >
                {r.unlocked ? r.emoji : "🔒"}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <p className="font-bold text-sm leading-tight" style={{ color: "var(--text-base)" }}>
                    {r.title}
                  </p>
                  <span
                    className="text-[0.55rem] font-bold px-1.5 py-0.5 rounded-full shrink-0"
                    style={{ background: "rgba(201,166,107,0.2)", color: "#8B6914" }}
                  >
                    {r.stamps}★
                  </span>
                </div>
                <p className="text-[0.66rem] mt-0.5" style={{ color: "var(--text-muted)" }}>
                  {r.sub}
                </p>
                {!r.unlocked && (
                  <p className="text-[0.6rem] mt-0.5 font-semibold" style={{ color: "#8B6914" }}>
                    {r.remaining} more stamp{r.remaining === 1 ? "" : "s"} to unlock
                  </p>
                )}
                {claimed && code && (
                  <p className="text-[0.62rem] mt-0.5 font-mono font-bold" style={{ color: "#7F9269" }}>
                    Code: {code}
                  </p>
                )}
              </div>

              {/* CTA */}
              {claimed ? (
                <Link
                  href="/passport?tab=codes"
                  className="shrink-0 text-[0.66rem] font-bold px-3 py-2 rounded-xl"
                  style={{ background: "#e6f0e6", color: "#4a6f4a" }}
                >
                  ✓ Claimed
                </Link>
              ) : r.unlocked ? (
                <button
                  onClick={() => claim(r.key)}
                  disabled={busyKey === r.key}
                  className="shrink-0 text-[0.7rem] font-bold px-3.5 py-2 rounded-xl text-white relative overflow-hidden sb-shimmer"
                  style={{ background: "linear-gradient(135deg,#b8871a,#f0b429,#c9911a)" }}
                >
                  <span className="relative" style={{ zIndex: 2 }}>
                    {busyKey === r.key ? "…" : "Claim"}
                  </span>
                </button>
              ) : (
                <span className="shrink-0 text-lg" style={{ color: "rgba(201,166,107,0.5)" }}>
                  🔒
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
