"use client";
// Three equal-size action buttons for hotel-tagged reels:
//   ⭐ Reviews   ·   🔴 Live Bid   ·   👁 Views
// Equal width / height / font-size — flex-1 each in a 3-col strip.
type Props = {
  reviewCount?: number;
  viewCount: number;
  rating?: number;
  onReviews?: () => void;
  onLiveBid?: () => void;
  onViews?: () => void;
};

function fmt(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "K";
  return String(n);
}

export function ActionButtons({ reviewCount, viewCount, rating, onReviews, onLiveBid, onViews }: Props) {
  const cells: Array<{ icon: string; label: string; sub: string; onClick?: () => void; tone: "neutral" | "live" | "neutral2" }> = [
    {
      icon: "⭐",
      label: rating ? rating.toFixed(1) : "Reviews",
      sub:   reviewCount && reviewCount > 0 ? `${fmt(reviewCount)} reviews` : "Reviews",
      onClick: onReviews,
      tone: "neutral",
    },
    {
      icon: "🔴",
      label: "Live Bid",
      sub:   "Start bidding",
      onClick: onLiveBid,
      tone: "live",
    },
    {
      icon: "👁",
      label: fmt(viewCount || 0),
      sub:   "Views",
      onClick: onViews,
      tone: "neutral2",
    },
  ];

  return (
    <div className="grid grid-cols-3 gap-1.5">
      {cells.map((c) => (
        <button
          key={c.icon}
          onClick={(e) => { e.stopPropagation(); c.onClick?.(); }}
          className="flex flex-col items-center justify-center gap-0.5 rounded-xl py-2 px-1 active:scale-95 transition-transform"
          style={{
            background: c.tone === "live"
              ? "linear-gradient(135deg, rgba(255,59,48,0.30), rgba(255,59,48,0.10))"
              : "rgba(255,255,255,0.08)",
            border: c.tone === "live"
              ? "1px solid rgba(255,59,48,0.55)"
              : "1px solid rgba(255,255,255,0.14)",
            backdropFilter: "blur(10px)",
            WebkitBackdropFilter: "blur(10px)",
            color: "#fff",
            minHeight: 50,
          }}
        >
          <span className="text-base leading-none">{c.icon}</span>
          <span className="text-[0.7rem] font-bold leading-none">{c.label}</span>
          <span className="text-[0.55rem] text-white/65 leading-none">{c.sub}</span>
        </button>
      ))}
    </div>
  );
}
