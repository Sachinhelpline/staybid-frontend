"use client";
// v392 — "Top destinations this month" strip (customer surface).
//
// Renders the current month's demand-cycle performers as tappable city chips.
// The 12-month demand cycle is a DISPLAY overlay — every city is bookable all
// year; this strip just highlights where demand peaks this month. Only cities
// that actually have inventory (present in lib/cities.ts) are shown, so a chip
// never leads to an empty result.

import { currentMonthDemand, demandTier } from "@/lib/circle/demand-cycle";
import { cityMeta, CITY_ICON } from "@/lib/cities";

export default function DemandCycleStrip({
  activeCity,
  onPick,
}: {
  activeCity?: string;
  onPick: (city: string) => void;
}) {
  const row = currentMonthDemand();

  // Primaries first, then secondaries; keep only cities that have inventory.
  const seen = new Set<string>();
  const chips = [...row.primary, ...row.secondary]
    .map((c) => cityMeta(c))
    .filter((m): m is NonNullable<ReturnType<typeof cityMeta>> => {
      if (!m) return false;
      const k = m.key.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

  if (chips.length === 0) return null;

  return (
    <section className="dcs-wrap" aria-label={`Top destinations in ${row.long}`}>
      <div className="dcs-head">
        <span className="dcs-eyebrow">🗓 {row.long} · In season now</span>
        <span className="dcs-sub">Peak demand this month — every city stays bookable all year</span>
      </div>
      <div className="dcs-chips">
        {chips.map((m) => {
          const tier = demandTier(m.key, row.month);
          const active = (activeCity || "").toLowerCase() === m.key.toLowerCase();
          return (
            <button
              key={m.key}
              type="button"
              onClick={() => onPick(m.key)}
              className={`dcs-chip ${tier === "primary" ? "dcs-chip-p" : "dcs-chip-s"} ${active ? "dcs-chip-on" : ""}`}
              aria-pressed={active}
              title={`${m.hubLabel || m.name}${tier === "primary" ? " · peak" : " · rising"}`}
            >
              <span aria-hidden="true">{CITY_ICON[m.key] || "📍"}</span>
              <span>{m.name}</span>
              {tier === "primary" && <span className="dcs-flame" aria-hidden="true">🔥</span>}
            </button>
          );
        })}
      </div>
      <style jsx>{`
        .dcs-wrap { max-width: 1120px; margin: 8px auto 0; padding: 10px 16px 2px; }
        .dcs-head { display: flex; flex-direction: column; gap: 2px; margin-bottom: 8px; }
        .dcs-eyebrow { font-size: 0.82rem; font-weight: 700; letter-spacing: .01em; color: var(--sb-fg, #1a1a1a); }
        .dcs-sub { font-size: 0.72rem; color: rgba(120,110,95,0.9); }
        .dcs-chips { display: flex; gap: 8px; overflow-x: auto; padding-bottom: 6px; -webkit-overflow-scrolling: touch; scrollbar-width: none; }
        .dcs-chips::-webkit-scrollbar { display: none; }
        .dcs-chip {
          flex: 0 0 auto; display: inline-flex; align-items: center; gap: 6px;
          padding: 8px 14px; border-radius: 999px; font-size: 0.82rem; font-weight: 600;
          border: 1px solid rgba(180,150,90,0.35); background: rgba(255,252,245,0.9);
          color: #4a3820; cursor: pointer; transition: transform .12s ease, box-shadow .12s ease;
          white-space: nowrap;
        }
        .dcs-chip:hover { transform: translateY(-1px); box-shadow: 0 4px 14px rgba(180,150,90,0.18); }
        .dcs-chip-p { background: linear-gradient(135deg, #fff6e2, #ffe9bf); border-color: rgba(200,150,50,0.5); }
        .dcs-chip-on { outline: 2px solid rgba(200,150,50,0.85); outline-offset: 1px; }
        .dcs-flame { font-size: 0.72rem; }
        @media (prefers-color-scheme: dark) {
          .dcs-eyebrow { color: #f1e6d2; }
          .dcs-chip { background: rgba(40,34,26,0.85); color: #f1e2c6; border-color: rgba(180,150,90,0.4); }
          .dcs-chip-p { background: linear-gradient(135deg, #3a2f1c, #4a3a1f); }
        }
      `}</style>
    </section>
  );
}
