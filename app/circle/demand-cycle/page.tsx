"use client";

// v392 — StayBid Circle · 12-Month Travel Demand Cycle.
//
// The investor-portfolio poster as a real, interactive surface: the demand
// centre rotates city-to-city each month, but every hub city stays bookable
// (and investable) all 12 months. Pure display over the demand-cycle module +
// the live circle_properties catalog. Money framing is COMPLIANT — no
// "guaranteed / 100% net profit / returns" (LOCKED, CLAUDE.md).

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  DEMAND_CYCLE, currentMonthDemand, demandTier,
  PORTFOLIO_PROMISE, PORTFOLIO_HIGHLIGHTS,
} from "@/lib/circle/demand-cycle";
import { cityMeta, cityHubLabel, CITY_ICON } from "@/lib/cities";
import { CIRCLE_INCOME_DISCLOSURE } from "@/lib/circle/disclosure";

type Prop = { id: string; city: string; title: string; monthlyRate: number; roiMin: number; roiMax: number };

export default function CircleDemandCyclePage() {
  const router = useRouter();
  const [selected, setSelected] = useState<number>(currentMonthDemand().month);
  const [propByCity, setPropByCity] = useState<Record<string, Prop>>({});

  useEffect(() => {
    let alive = true;
    fetch("/api/circle/properties")
      .then((r) => r.json())
      .then((j) => {
        if (!alive) return;
        const map: Record<string, Prop> = {};
        (Array.isArray(j?.properties) ? j.properties : []).forEach((p: any) => {
          const k = String(p.city || "").trim().toLowerCase();
          if (k && !map[k]) map[k] = { id: p.id, city: p.city, title: p.title, monthlyRate: p.monthlyRate, roiMin: p.roiMin, roiMax: p.roiMax };
        });
        setPropByCity(map);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const row = useMemo(() => DEMAND_CYCLE[selected], [selected]);

  // Build the month's city cards — primaries first, dedup, keep known cities.
  const cards = useMemo(() => {
    const seen = new Set<string>();
    return [...row.primary, ...row.secondary]
      .map((c) => cityMeta(c))
      .filter((m): m is NonNullable<ReturnType<typeof cityMeta>> => {
        if (!m) return false;
        const k = m.key.toLowerCase();
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .map((m) => ({
        meta: m,
        tier: demandTier(m.key, row.month),
        prop: propByCity[m.key.toLowerCase()] || null,
        note: row.notes?.[m.key] || "",
      }));
  }, [row, propByCity]);

  return (
    <div className="dcp">
      {/* Hero */}
      <header className="dcp-hero">
        <span className="dcp-badge">12-Month Travel Demand Cycle</span>
        <h1 className="dcp-title">{PORTFOLIO_PROMISE.headline}</h1>
        <p className="dcp-sub">{PORTFOLIO_PROMISE.subhead}</p>
        <div className="dcp-highlights">
          {PORTFOLIO_HIGHLIGHTS.map((h) => (
            <div key={h.label} className="dcp-hl">
              <span className="dcp-hl-v">{h.value}</span>
              <span className="dcp-hl-l">{h.label}</span>
            </div>
          ))}
        </div>
      </header>

      {/* Month wheel */}
      <div className="dcp-months" role="tablist" aria-label="Select a month">
        {DEMAND_CYCLE.map((m) => (
          <button
            key={m.month}
            role="tab"
            aria-selected={m.month === selected}
            className={`dcp-month ${m.month === selected ? "dcp-month-on" : ""}`}
            onClick={() => setSelected(m.month)}
          >
            {m.short}
          </button>
        ))}
      </div>

      {/* Selected month */}
      <section className="dcp-panel">
        <div className="dcp-panel-head">
          <h2 className="dcp-panel-title">{row.long} · {row.season}</h2>
          <span className="dcp-panel-sub">In-season destinations this month</span>
        </div>

        <div className="dcp-cards">
          {cards.map(({ meta, tier, prop, note }) => (
            <button
              key={meta.key}
              className={`dcp-card ${tier === "primary" ? "dcp-card-p" : "dcp-card-s"}`}
              onClick={() => router.push(prop ? `/circle/${prop.id}` : `/circle/discover`)}
              title={prop ? `Invest in ${prop.title}` : `Browse ${meta.name}`}
            >
              <div className="dcp-card-top">
                <span className="dcp-card-ic" aria-hidden="true">{CITY_ICON[meta.key] || "📍"}</span>
                <span className={`dcp-tier ${tier === "primary" ? "dcp-tier-p" : "dcp-tier-s"}`}>
                  {tier === "primary" ? "🔥 Peak" : "Rising"}
                </span>
              </div>
              <div className="dcp-card-name">{cityHubLabel(meta.key)}</div>
              <div className="dcp-card-region">{meta.region}{note ? ` · ${note}` : ""}</div>
              {prop ? (
                <div className="dcp-card-roi">
                  Expected ROI {prop.roiMin}–{prop.roiMax}%
                  <span className="dcp-card-cta">Invest →</span>
                </div>
              ) : (
                <div className="dcp-card-roi dcp-card-soon">Browse properties →</div>
              )}
            </button>
          ))}
        </div>

        {row.secondary.some((c) => !cityMeta(c)) && (
          <p className="dcp-more">
            Also strong this month: {row.secondary.filter((c) => !cityMeta(c)).join(" · ")} — additional markets in the plan.
          </p>
        )}
      </section>

      {/* Why it works (compliant) */}
      <section className="dcp-why">
        <h3 className="dcp-why-h">Why a multi-destination portfolio</h3>
        <ul className="dcp-why-list">
          {PORTFOLIO_PROMISE.points.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      </section>

      <div className="dcp-cta-row">
        <Link href="/circle/discover" className="dcp-cta">Browse all properties</Link>
        <Link href="/circle" className="dcp-cta dcp-cta-ghost">Back to Circle</Link>
      </div>

      {/* Compliance */}
      <p className="dcp-disc">{PORTFOLIO_PROMISE.disclaimer}</p>
      <p className="dcp-disc">{CIRCLE_INCOME_DISCLOSURE}</p>

      <style jsx>{`
        .dcp { max-width: 1120px; margin: 0 auto; padding: 20px 16px 60px; color: #dee4ea; }
        .dcp-hero { text-align: center; padding: 24px 12px 8px; }
        .dcp-badge { display: inline-block; font-size: 0.72rem; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: #cad4dd; border: 1px solid rgba(176, 192, 209,0.4); border-radius: 999px; padding: 4px 12px; }
        .dcp-title { font-size: clamp(1.6rem, 5vw, 2.4rem); font-weight: 800; margin: 12px 0 6px; color: #e7ebf0; }
        .dcp-sub { max-width: 640px; margin: 0 auto; font-size: 0.92rem; color: rgba(176, 192, 209,0.82); }
        .dcp-highlights { display: flex; flex-wrap: wrap; justify-content: center; gap: 10px; margin-top: 18px; }
        .dcp-hl { display: flex; flex-direction: column; align-items: center; min-width: 84px; padding: 10px 14px; border-radius: 14px; background: rgba(51,37,26,0.7); border: 1px solid rgba(176, 192, 209,0.22); }
        .dcp-hl-v { font-size: 1.3rem; font-weight: 800; color: #cad4dd; }
        .dcp-hl-l { font-size: 0.66rem; text-transform: uppercase; letter-spacing: .04em; color: rgba(176, 192, 209,0.7); }
        .dcp-months { display: flex; gap: 6px; overflow-x: auto; padding: 18px 2px 8px; scrollbar-width: none; }
        .dcp-months::-webkit-scrollbar { display: none; }
        .dcp-month { flex: 0 0 auto; padding: 8px 14px; border-radius: 999px; font-weight: 700; font-size: 0.82rem; background: rgba(51,37,26,0.7); color: rgba(176, 192, 209,0.8); border: 1px solid rgba(176, 192, 209,0.2); cursor: pointer; }
        .dcp-month-on { background: linear-gradient(135deg, #d5dce4, #cad4dd); color: #2a1c0c; border-color: #cad4dd; }
        .dcp-panel { margin-top: 8px; }
        .dcp-panel-head { display: flex; flex-direction: column; gap: 2px; margin-bottom: 12px; }
        .dcp-panel-title { font-size: 1.2rem; font-weight: 800; color: #e7ebf0; }
        .dcp-panel-sub { font-size: 0.78rem; color: rgba(176, 192, 209,0.66); }
        .dcp-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 12px; }
        .dcp-card { text-align: left; padding: 14px; border-radius: 16px; background: linear-gradient(160deg, #1f1710, #33251a); border: 1px solid rgba(176, 192, 209,0.22); cursor: pointer; transition: transform .12s ease, box-shadow .12s ease; }
        .dcp-card:hover { transform: translateY(-2px); box-shadow: 0 8px 24px rgba(0,0,0,0.35); }
        .dcp-card-p { border-color: rgba(176, 192, 209,0.55); }
        .dcp-card-top { display: flex; justify-content: space-between; align-items: center; }
        .dcp-card-ic { font-size: 1.4rem; }
        .dcp-tier { font-size: 0.64rem; font-weight: 800; padding: 3px 8px; border-radius: 999px; text-transform: uppercase; letter-spacing: .04em; }
        .dcp-tier-p { background: rgba(176, 192, 209,0.22); color: #cad4dd; }
        .dcp-tier-s { background: rgba(176, 192, 209,0.12); color: rgba(176, 192, 209,0.75); }
        .dcp-card-name { font-size: 1.02rem; font-weight: 800; margin-top: 10px; color: #e7ebf0; }
        .dcp-card-region { font-size: 0.72rem; color: rgba(176, 192, 209,0.62); margin-top: 2px; }
        .dcp-card-roi { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 12px; font-size: 0.78rem; font-weight: 700; color: #d5dce4; }
        .dcp-card-cta { color: #cad4dd; }
        .dcp-card-soon { color: rgba(176, 192, 209,0.7); font-weight: 600; }
        .dcp-more { margin-top: 12px; font-size: 0.76rem; color: rgba(176, 192, 209,0.62); }
        .dcp-why { margin-top: 28px; padding: 18px; border-radius: 16px; background: rgba(51,37,26,0.6); border: 1px solid rgba(176, 192, 209,0.18); }
        .dcp-why-h { font-size: 1rem; font-weight: 800; color: #e7ebf0; margin-bottom: 8px; }
        .dcp-why-list { list-style: none; padding: 0; margin: 0; display: grid; gap: 6px; }
        .dcp-why-list li { position: relative; padding-left: 20px; font-size: 0.84rem; color: rgba(176, 192, 209,0.85); }
        .dcp-why-list li::before { content: "✓"; position: absolute; left: 0; color: #cad4dd; font-weight: 800; }
        .dcp-cta-row { display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; margin-top: 24px; }
        .dcp-cta { padding: 12px 22px; border-radius: 999px; font-weight: 800; text-decoration: none; background: linear-gradient(135deg, #d5dce4, #cad4dd); color: #2a1c0c; }
        .dcp-cta-ghost { background: transparent; color: #cad4dd; border: 1px solid rgba(176, 192, 209,0.5); }
        .dcp-disc { max-width: 720px; margin: 18px auto 0; text-align: center; font-size: 0.68rem; line-height: 1.5; color: rgba(176, 192, 209,0.55); }
      `}</style>
    </div>
  );
}
