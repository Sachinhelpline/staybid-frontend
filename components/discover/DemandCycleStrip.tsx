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
      {/* v513 — slim single-line trending row (sits below the search bar,
          Airbnb-style) so the seasonal note never pushes the content down.
          The "In season now / peak demand" copy is compressed to one label. */}
      <div className="dcs-chips">
        <span className="dcs-eyebrow" title={`Peak demand this month — every city stays bookable all year`}>
          🔥 Trending in {row.long}
        </span>
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
        /* v514 — drives off the APP theme (data-theme) via CSS variables, NOT
           @media(prefers-color-scheme) which keyed off the OS and made the label
           invisible when OS=dark but app=light. Legible in both modes now. */
        .dcs-wrap { max-width: 1120px; margin: 4px auto 0; padding: 4px 16px 2px; }
        .dcs-eyebrow {
          flex: 0 0 auto; display: inline-flex; align-items: center;
          font-size: 0.8rem; font-weight: 800; letter-spacing: .01em;
          color: var(--text-base); white-space: nowrap; margin-right: 2px;
        }
        .dcs-chips { display: flex; align-items: center; gap: 8px; overflow-x: auto; padding-bottom: 6px; -webkit-overflow-scrolling: touch; scrollbar-width: none; }
        .dcs-chips::-webkit-scrollbar { display: none; }
        .dcs-chip {
          flex: 0 0 auto; display: inline-flex; align-items: center; gap: 6px;
          padding: 8px 14px; border-radius: 999px; font-size: 0.82rem; font-weight: 700;
          border: 1px solid var(--border-soft); background: var(--bg-card);
          color: var(--text-base); cursor: pointer;
          transition: transform .12s ease, box-shadow .12s ease, border-color .12s ease;
          white-space: nowrap;
          /* v514 — subtle reflective top highlight (premium sheen) */
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.45), 0 1px 2px rgba(31,26,15,0.06);
        }
        .dcs-chip:hover { transform: translateY(-1px); box-shadow: inset 0 1px 0 rgba(255,255,255,0.6), 0 6px 16px rgba(180,150,90,0.22); border-color: var(--accent); }
        .dcs-chip-p {
          background: color-mix(in srgb, var(--accent) 16%, var(--bg-card));
          border-color: color-mix(in srgb, var(--accent) 45%, var(--border-soft));
        }
        .dcs-chip-on { outline: 2px solid var(--accent); outline-offset: 1px; }
        .dcs-flame { font-size: 0.72rem; }
        :global([data-theme="dark"]) .dcs-chip { box-shadow: inset 0 1px 0 rgba(255,255,255,0.10), 0 1px 2px rgba(0,0,0,0.3); }
        :global([data-theme="dark"]) .dcs-chip:hover { box-shadow: inset 0 1px 0 rgba(255,255,255,0.16), 0 6px 16px rgba(0,0,0,0.4); }
      `}</style>
    </section>
  );
}
