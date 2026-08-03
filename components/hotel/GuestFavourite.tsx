"use client";
// ═══════════════════════════════════════════════════════════════════════════
// components/hotel/GuestFavourite.tsx — v509
//
// Airbnb-style "Guest Favourite" laurel honour, but driven by OUR real data:
// the StayBid hotel scorecard (lib/hotel-score.ts → /api/hotels/[id]/scorecard),
// which already computes `overall` (0..100) and city rank + percentile.
//
// Shown ONLY for genuinely top-tier stays — top ~10% in the city AND a strong
// overall score — so the badge stays exclusive (never a participation trophy).
// The scoring engine is LOCKED; this component only READS + presents it.
// Renders nothing when the hotel doesn't qualify or has no rating yet.
// ═══════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";

type Rank = { rank: number | null; total: number; percentile: number | null };
type Scorecard = { overall: number | null; rank?: Rank };

type Props = {
  hotelId: string;
  city?: string;
  avgRating?: number;
  totalReviews?: number;
  onExplain?: () => void; // optional: open the full scorecard breakdown
};

// Qualification: top ~10% in city AND overall >= 85 (owner decision).
const MIN_PERCENTILE = 90;
const MIN_OVERALL = 85;

export default function GuestFavourite({ hotelId, city, avgRating, totalReviews, onExplain }: Props) {
  const [card, setCard] = useState<Scorecard | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let alive = true;
    if (!hotelId) return;
    (async () => {
      try {
        const r = await fetch(`/api/hotels/${encodeURIComponent(hotelId)}/scorecard`, { cache: "no-store" });
        if (r.ok && alive) setCard(await r.json());
      } catch { /* silent */ }
      finally { if (alive) setDone(true); }
    })();
    return () => { alive = false; };
  }, [hotelId]);

  if (!done || !card) return null;

  const overall = typeof card.overall === "number" ? card.overall : null;
  const pct = card.rank?.percentile ?? null;
  const rank = card.rank?.rank ?? null;
  const total = card.rank?.total ?? 0;

  const qualifies = overall !== null && overall >= MIN_OVERALL && pct !== null && pct >= MIN_PERCENTILE;
  if (!qualifies) return null;

  // Headline number: the guest rating (out of 5) is the most recognisable — fall
  // back to the /10 form of the overall score if there aren't ratings yet.
  const bigNum = avgRating && avgRating > 0 ? avgRating.toFixed(2) : (overall! / 20).toFixed(1);
  const topPct = Math.max(1, Math.round(100 - pct!));
  const line = rank && total
    ? `Ranked #${rank} of ${total} in ${city || "its city"} · top ${topPct}%`
    : `Top ${topPct}% of stays in ${city || "its city"}`;

  return (
    <section className="gf" aria-label="Guest Favourite">
      <div className="gf-inner">
        <span className="gf-laurel gf-laurel-l" aria-hidden>🌿</span>
        <div className="gf-mid">
          <span className="gf-num">{bigNum}</span>
        </div>
        <span className="gf-laurel gf-laurel-r" aria-hidden>🌿</span>
      </div>
      <h3 className="gf-title">Guest Favourite</h3>
      <p className="gf-sub">
        {line}, based on real ratings, reviews &amp; reliability.
        {totalReviews ? <> · {totalReviews} review{totalReviews === 1 ? "" : "s"}</> : null}
      </p>
      {onExplain ? (
        <button type="button" className="gf-how" onClick={onExplain}>How scoring works</button>
      ) : null}

      <style jsx>{`
        /* v645 — borderless 4-layer 3D grammar (same family as .hx-room-card);
           the laurel identity (🌿 + serif number) is untouched. */
        .gf {
          text-align: center;
          margin: 6px auto 30px;
          padding: 26px 20px 22px;
          max-width: 640px;
          border-radius: 24px;
          background:
            radial-gradient(120% 90% at 50% 0%, rgba(106, 133, 160, 0.12), transparent 70%),
            var(--bg-card);
          border: none;
          box-shadow:
            0 24px 42px -22px rgba(31, 26, 15, 0.32),
            0 10px 20px -12px rgba(31, 26, 15, 0.18),
            0 2px 6px -2px rgba(31, 26, 15, 0.12),
            inset 0 1px 0 rgba(255, 255, 255, 0.5);
        }
        :global([data-theme="dark"]) .gf {
          box-shadow:
            0 24px 42px -22px rgba(0, 0, 0, 0.7),
            0 10px 20px -12px rgba(0, 0, 0, 0.48),
            0 2px 6px -2px rgba(0, 0, 0, 0.38),
            inset 0 1px 0 rgba(255, 255, 255, 0.06);
        }
        .gf-inner { display: flex; align-items: center; justify-content: center; gap: 6px; }
        .gf-laurel { font-size: 2.6rem; line-height: 1; filter: saturate(1.1) drop-shadow(0 2px 4px rgba(106, 133, 160,0.35)); }
        .gf-laurel-l { transform: scaleX(-1); }
        .gf-mid { display: flex; align-items: baseline; }
        .gf-num {
          font-family: var(--font-display, "Cormorant Garamond"), serif;
          font-size: 3.4rem; font-weight: 700; line-height: 1;
          color: var(--text-base);
          font-variant-numeric: tabular-nums;
        }
        .gf-title {
          font-size: 1.32rem; font-weight: 800; letter-spacing: 0.01em;
          color: var(--text-base); margin: 10px 0 0;
        }
        .gf-sub {
          font-size: 0.82rem; color: var(--text-muted); line-height: 1.5;
          margin: 6px auto 0; max-width: 460px;
        }
        .gf-how {
          margin-top: 12px; font-size: 0.74rem; font-weight: 700;
          color: var(--text-soft); text-decoration: underline; text-underline-offset: 3px;
          background: none; border: none; cursor: pointer; padding: 4px;
        }
        .gf-how:hover { color: var(--accent); }
      `}</style>
    </section>
  );
}
