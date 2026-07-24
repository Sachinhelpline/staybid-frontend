"use client";
// BadgeGrid — every achievement as a tappable 3D medal. Earned badges shine in
// gold with a live sheen; locked ones dim with a lock chip + progress ring.
// Tapping any badge opens the PassportDetailSheet (big 3D flip-in + blurb +
// progress). Mirrors the API's badge catalog shape.
import { useState } from "react";
import { PassportMedal, MEDAL_GOLD, MEDAL_LOCKED } from "./PassportMedal";
import { PassportDetailSheet, type DetailItem } from "./PassportDetailSheet";

type BadgeView = {
  key: string;
  label: string;
  emoji: string;
  blurb: string;
  earned: boolean;
  have: number;
  need: number;
  hint: string;
};

export function BadgeGrid({ badges }: { badges: BadgeView[] }) {
  const earned = badges.filter((b) => b.earned).length;
  const [open, setOpen] = useState<DetailItem | null>(null);

  const toDetail = (b: BadgeView): DetailItem => {
    const pct = b.need > 1 ? Math.min(100, (b.have / b.need) * 100) : b.earned ? 100 : 0;
    return {
      glyph: b.emoji,
      title: b.label,
      blurb: b.earned ? b.blurb : b.hint,
      m: b.earned ? MEDAL_GOLD : MEDAL_LOCKED,
      locked: !b.earned,
      earned: b.earned,
      progress: b.earned ? null : b.need > 1 ? pct : null,
      progressLabel: b.need > 1 ? `${b.have} / ${b.need}` : undefined,
      status: b.earned
        ? { text: "Unlocked", tone: "good" }
        : { text: "Locked", tone: "lock" },
      meta: b.earned
        ? undefined
        : b.need > 1
          ? [{ label: "Progress", value: `${b.have} of ${b.need}` }]
          : undefined,
    };
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-display text-lg font-semibold" style={{ color: "var(--text-base)" }}>
          🏅 Achievements
        </h3>
        <span className="text-xs font-semibold tabular-nums" style={{ color: "var(--text-muted)" }}>
          {earned} / {badges.length} unlocked
        </span>
      </div>

      <div className="grid grid-cols-3 gap-3 sb-stagger">
        {badges.map((b) => {
          const pct = b.need > 1 ? Math.min(100, (b.have / b.need) * 100) : null;
          return (
            <button
              key={b.key}
              onClick={() => setOpen(toDetail(b))}
              className="flex flex-col items-center gap-1.5 rounded-[22px] py-3 px-1.5 sb-card-lift"
              style={{
                background: b.earned
                  ? "color-mix(in srgb, var(--accent) 10%, var(--bg-card))"
                  : "var(--bg-card)",
                border: b.earned
                  ? "1px solid rgba(201,166,107,0.4)"
                  : "1px solid var(--border-soft)",
              }}
            >
              <PassportMedal
                glyph={b.emoji}
                size={58}
                m={MEDAL_GOLD}
                locked={!b.earned}
                progress={!b.earned && pct != null ? pct : null}
                pulse={b.earned}
                ariaLabel={b.label}
              />
              <p
                className="text-[0.64rem] font-bold leading-tight text-center"
                /* both surfaces now flip with the theme → single token label */
                style={{ color: "var(--text-base)" }}
              >
                {b.label}
              </p>
              {!b.earned && b.need > 1 && (
                <p className="text-[0.55rem] font-semibold tabular-nums" style={{ color: "var(--accent)" }}>
                  {b.have}/{b.need}
                </p>
              )}
            </button>
          );
        })}
      </div>

      <PassportDetailSheet item={open} onClose={() => setOpen(null)} />
    </div>
  );
}
