"use client";
//
// HotelFeedbackSummary (v127.1) — public aggregated stay-feedback view.
//
// Renders on /hotels/[id] (Reviews tab) for ALL visitors. Shows the
// crowd-sourced smiley distribution per checkpoint + a few recent
// anonymous snapshots. Privacy: NO names, NO notes, NO video URLs.
//
// Backed by GET /api/hotels/:id/feedback-summary which strips everything
// except the smiley initials. Server caches 60s; client polls only on
// first mount (this is a slow-moving aggregate).
//

import { useEffect, useState } from "react";

const CHECKPOINT_LABELS: Record<string, { label: string; icon: string }> = {
  roomMatch:    { label: "Room matched listing",   icon: "🛏️" },
  staff:        { label: "Staff behavior",          icon: "🤝" },
  hygiene:      { label: "Hygiene & cleanliness",   icon: "🧼" },
  food:         { label: "Food quality",            icon: "🍽️" },
  staffResponse:{ label: "Staff response time",     icon: "⚡" },
};

const SMILEY: Record<string, { icon: string; color: string }> = {
  positive: { icon: "😊", color: "#16a34a" },
  neutral:  { icon: "😐", color: "#a16207" },
  negative: { icon: "😞", color: "#dc2626" },
};

type Summary = {
  totalReviews: number;
  score: number | null;
  percentPositive: number | null;
  checkpoints: Record<string, { positive: number; neutral: number; negative: number; total: number; percentPositive: number | null }>;
  recent: Array<{ submittedAt: string; autoFilled: boolean; snapshot: Record<string, "positive"|"neutral"|"negative"> }>;
};

export default function HotelFeedbackSummary({ hotelId }: { hotelId: string }) {
  const [data, setData] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!hotelId) return;
    let alive = true;
    setLoading(true);
    fetch(`/api/hotels/${encodeURIComponent(hotelId)}/feedback-summary`)
      .then((r) => r.json())
      .then((d) => alive && setData(d))
      .catch(() => alive && setData(null))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [hotelId]);

  if (loading) {
    return (
      <div className="my-6 p-5 rounded-2xl bg-luxury-50 border border-luxury-100 text-sm text-luxury-500">
        Loading guest feedback…
      </div>
    );
  }

  if (!data || data.totalReviews === 0) {
    return (
      <div className="my-6 p-5 rounded-2xl bg-luxury-50 border border-luxury-100 text-center">
        <div className="text-4xl mb-1">🎯</div>
        <div className="font-display text-lg text-luxury-900">No guest feedback yet</div>
        <p className="text-xs text-luxury-500 mt-1">Be among the first to share your experience after checkout.</p>
      </div>
    );
  }

  return (
    <div className="my-6">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div>
          <div className="font-display text-xl text-luxury-900">Recent guest feedback</div>
          <div className="text-xs text-luxury-500 mt-0.5">Based on {data.totalReviews} verified post-checkout {data.totalReviews === 1 ? "review" : "reviews"}</div>
        </div>
        {data.score !== null && (
          <div className="text-center px-4 py-2 rounded-xl bg-linear-to-br from-emerald-50 to-emerald-100 border border-emerald-200">
            <div className="text-2xl font-display text-emerald-900">{data.score}</div>
            <div className="text-[10px] uppercase tracking-wider text-emerald-700 font-semibold">Stay Score</div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-4">
        {Object.entries(CHECKPOINT_LABELS).map(([key, meta]) => {
          const c = data.checkpoints[key];
          if (!c || c.total === 0) return null;
          const pos = c.total ? (c.positive / c.total) * 100 : 0;
          const neu = c.total ? (c.neutral  / c.total) * 100 : 0;
          const neg = c.total ? (c.negative / c.total) * 100 : 0;
          return (
            <div key={key} className="p-3 rounded-xl bg-white border border-luxury-100">
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-lg">{meta.icon}</span>
                  <span className="text-sm font-semibold text-luxury-900 truncate">{meta.label}</span>
                </div>
                <span className="text-xs text-luxury-500 font-mono">{c.percentPositive ?? 0}% 😊</span>
              </div>
              <div className="h-2 rounded-full overflow-hidden bg-luxury-100 flex">
                <div style={{ width: `${pos}%`, background: SMILEY.positive.color }} />
                <div style={{ width: `${neu}%`, background: SMILEY.neutral.color }} />
                <div style={{ width: `${neg}%`, background: SMILEY.negative.color }} />
              </div>
              <div className="flex justify-between text-[10px] mt-1 text-luxury-500 font-mono">
                <span>{c.positive} 😊</span>
                <span>{c.neutral} 😐</span>
                <span>{c.negative} 😞</span>
              </div>
            </div>
          );
        })}
      </div>

      {data.recent.length > 0 && (
        <div>
          <div className="text-xs uppercase tracking-widest text-luxury-500 font-semibold mb-2">Recent stays</div>
          <div className="flex flex-wrap gap-2">
            {data.recent.slice(0, 8).map((r, i) => {
              const negCount = Object.values(r.snapshot).filter((v) => v === "negative").length;
              const posCount = Object.values(r.snapshot).filter((v) => v === "positive").length;
              const tone = negCount === 0 ? "emerald" : negCount >= 2 ? "red" : "amber";
              const date = new Date(r.submittedAt);
              return (
                <div key={i} className={`px-2.5 py-1.5 rounded-lg text-xs flex items-center gap-1.5 ${
                  tone === "emerald" ? "bg-emerald-50 border border-emerald-200 text-emerald-900"
                  : tone === "amber" ? "bg-amber-50 border border-amber-200 text-amber-900"
                  : "bg-red-50 border border-red-200 text-red-900"
                }`} title={`${posCount} positive, ${negCount} negative`}>
                  <span>{negCount === 0 ? "😊" : negCount >= 2 ? "😞" : "😐"}</span>
                  <span>{date.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</span>
                  {r.autoFilled && <span className="text-[9px] uppercase opacity-60">auto</span>}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
