"use client";
// HowItGrows — the 4-step explainer, now a row of tappable 3D tiles (each with
// a reflective mini-medal). Tapping a step opens the detail sheet with the full
// explanation. Replaces the old flat, non-clickable grid.
import { useState } from "react";
import { PassportMedal, MEDAL_GOLD, MEDAL_CHAMPAGNE } from "./PassportMedal";
import { PassportDetailSheet, type DetailItem } from "./PassportDetailSheet";

const STEPS: { key: string; glyph: string; t: string; s: string; blurb: string; n: number }[] = [
  { key: "stay", glyph: "🛏️", t: "Stay", s: "Book & complete a stay", n: 1,
    blurb: "Book any StayBid hotel and complete your stay. Every confirmed stay is the seed of a new stamp." },
  { key: "collect", glyph: "🛂", t: "Collect", s: "A stamp lands automatically", n: 2,
    blurb: "The moment your stay is confirmed, a region-tinted stamp lands in your passport — no action needed." },
  { key: "climb", glyph: "⛰️", t: "Climb", s: "Earn XP → rank up", n: 3,
    blurb: "Each stamp earns XP (+150, +60 for a new city). XP lifts you through Explorer → Founder's Circle." },
  { key: "unlock", glyph: "🎁", t: "Unlock", s: "Claim stamp rewards", n: 4,
    blurb: "Hit 3 / 7 / 11 / 20 stamps to unlock real rewards — a voucher, free breakfast, an upgrade, a free night." },
];

export function HowItGrows() {
  const [open, setOpen] = useState<DetailItem | null>(null);

  return (
    <div
      className="rounded-3xl p-5"
      style={{ background: "var(--bg-card)", border: "1px solid var(--border-soft)" }}
    >
      <h3 className="font-display text-lg font-semibold mb-3" style={{ color: "var(--text-base)" }}>
        How your passport grows
      </h3>
      <div className="grid grid-cols-2 gap-2.5 sb-stagger">
        {STEPS.map((x) => (
          <button
            key={x.key}
            onClick={() =>
              setOpen({
                glyph: x.glyph,
                title: `${x.n}. ${x.t}`,
                blurb: x.blurb,
                m: MEDAL_GOLD,
                earned: true,
                ribbon: `Step ${x.n}`,
                status: { text: "How it works", tone: "soft" },
              })
            }
            className="rounded-[22px] p-3 flex items-center gap-3 text-left sb-card-lift"
            style={{
              background: "color-mix(in srgb, var(--accent) 10%, var(--bg-card))",
              border: "1px solid rgba(201,166,107,0.32)",
              boxShadow: "0 6px 16px -10px rgba(201,166,107,0.5)",
            }}
          >
            <PassportMedal glyph={x.glyph} size={42} m={MEDAL_CHAMPAGNE} pulse ariaLabel={x.t} />
            <div className="min-w-0">
              <p className="font-bold text-sm leading-tight" style={{ color: "var(--text-base)" }}>
                {x.t}
              </p>
              <p className="text-[0.62rem] mt-0.5 leading-snug" style={{ color: "var(--text-muted)" }}>
                {x.s}
              </p>
            </div>
          </button>
        ))}
      </div>

      <PassportDetailSheet item={open} onClose={() => setOpen(null)} />
    </div>
  );
}
