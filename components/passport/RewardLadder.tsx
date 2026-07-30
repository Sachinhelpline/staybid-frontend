"use client";
// RewardLadder — stamp-count unlockables (3→voucher, 7→breakfast, 11→upgrade,
// 20→free night) as tappable 3D reward coins. Each row shows a live medal +
// progress; tapping opens the detail sheet where the reward is claimed (mints a
// real redemption_code shown in My Codes).
import { useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import type { RewardState } from "@/lib/passport/engine";
import { PassportMedal, MEDAL_GOLD, MEDAL_LOCKED } from "./PassportMedal";
import { PassportDetailSheet, type DetailItem } from "./PassportDetailSheet";

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
  const [openKey, setOpenKey] = useState<string | null>(null);

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

  const buildDetail = (r: RewardState): DetailItem => {
    const claimed = r.claimed || justClaimed?.key === r.key;
    const code = justClaimed?.key === r.key ? justClaimed.code : r.claimedCode;
    const pct = Math.min(100, (stampCount / r.stamps) * 100);
    return {
      glyph: r.emoji,
      title: r.title,
      blurb: r.sub,
      m: r.unlocked ? MEDAL_GOLD : MEDAL_LOCKED,
      locked: !r.unlocked,
      earned: r.unlocked,
      ribbon: `${r.stamps} ★`,
      progress: !r.unlocked ? pct : null,
      progressLabel: `${stampCount} / ${r.stamps} stamps`,
      status: claimed
        ? { text: "Claimed", tone: "good" }
        : r.unlocked
          ? { text: "Ready to claim", tone: "soft" }
          : { text: `${r.remaining} more stamp${r.remaining === 1 ? "" : "s"}`, tone: "lock" },
      meta: [
        { label: "Unlock at", value: `${r.stamps} stamps` },
        ...(claimed && code ? [{ label: "Your code", value: code }] : []),
      ],
      footer: claimed ? (
        <Link
          href="/passport?tab=codes"
          className="block w-full text-center py-3 rounded-2xl font-bold text-sm"
          style={{ background: "#e6f0e6", color: "#4a6f4a" }}
        >
          ✓ Claimed · View in Codes
        </Link>
      ) : r.unlocked ? (
        <>
          {error && (
            <p className="text-xs text-center mb-2 font-medium" style={{ color: "#a85b4e" }}>
              {error}
            </p>
          )}
          <button
            onClick={() => claim(r.key)}
            disabled={busyKey === r.key}
            className="block w-full text-center py-3 rounded-2xl font-bold text-sm text-white relative overflow-hidden sb-shimmer"
            style={{ background: "linear-gradient(135deg,#748da6,#a9b9c8,#8198ae)" }}
          >
            <span className="relative" style={{ zIndex: 2 }}>
              {busyKey === r.key ? "Claiming…" : "🎁 Claim reward"}
            </span>
          </button>
        </>
      ) : (
        <div
          className="text-center py-3 rounded-2xl font-semibold text-sm"
          style={{ background: "var(--bg-page)", border: "1px solid var(--border-soft)", color: "var(--text-muted)" }}
        >
          🔒 {r.remaining} more stamp{r.remaining === 1 ? "" : "s"} to unlock
        </div>
      ),
    };
  };

  const openReward = openKey ? rewards.find((r) => r.key === openKey) : null;

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-display text-lg font-semibold" style={{ color: "var(--text-base)" }}>
          🎁 Stamp Rewards
        </h3>
        <span className="text-xs font-semibold tabular-nums" style={{ color: "var(--text-muted)" }}>
          {stampCount} stamps
        </span>
      </div>

      <div className="space-y-2.5">
        {rewards.map((r) => {
          const claimed = r.claimed || justClaimed?.key === r.key;
          const pct = Math.min(100, (stampCount / r.stamps) * 100);
          return (
            <button
              key={r.key}
              onClick={() => setOpenKey(r.key)}
              className="w-full rounded-[22px] p-3 flex items-center gap-3 text-left sb-card-lift"
              style={{
                background: r.unlocked ? "color-mix(in srgb, var(--accent) 10%, var(--bg-card))" : "var(--bg-card)",
                border: r.unlocked ? "1px solid rgba(201,166,107,0.4)" : "1px solid var(--border-soft)",
              }}
            >
              <PassportMedal
                glyph={r.emoji}
                size={52}
                m={MEDAL_GOLD}
                locked={!r.unlocked}
                progress={!r.unlocked ? pct : null}
                pulse={r.unlocked && !claimed}
                ariaLabel={r.title}
                ribbon={`${r.stamps}★`}
              />

              <div className="flex-1 min-w-0">
                {/* both rows now flip with the theme (unlocked = gold-tinted card,
                    locked = --bg-card) → all copy uses theme-aware tokens. */}
                <p className="font-bold text-sm leading-tight" style={{ color: "var(--text-base)" }}>
                  {r.title}
                </p>
                <p className="text-[0.66rem] mt-0.5" style={{ color: "var(--text-muted)" }}>
                  {r.sub}
                </p>
                {!r.unlocked ? (
                  <p className="text-[0.6rem] mt-1 font-semibold tabular-nums" style={{ color: "var(--accent)" }}>
                    {r.remaining} more stamp{r.remaining === 1 ? "" : "s"} to unlock
                  </p>
                ) : claimed ? (
                  <p className="text-[0.62rem] mt-1 font-bold" style={{ color: "#7F9269" }}>
                    ✓ Claimed
                  </p>
                ) : (
                  <p className="text-[0.62rem] mt-1 font-bold" style={{ color: "var(--accent)" }}>
                    Ready to claim — tap to open
                  </p>
                )}
              </div>

              <span
                className="shrink-0 text-[0.66rem] font-bold px-2.5 py-1.5 rounded-xl"
                style={
                  claimed
                    ? { background: "#e6f0e6", color: "#4a6f4a" }
                    : r.unlocked
                      ? { background: "linear-gradient(135deg,#748da6,#a9b9c8,#8198ae)", color: "#fff" }
                      : { background: "var(--bg-pill)", color: "var(--text-muted)" }
                }
              >
                {claimed ? "✓" : r.unlocked ? "Open" : "🔒"}
              </span>
            </button>
          );
        })}
      </div>

      <PassportDetailSheet item={openReward ? buildDetail(openReward) : null} onClose={() => setOpenKey(null)} />
    </div>
  );
}
