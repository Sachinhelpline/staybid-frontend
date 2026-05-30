"use client";
// Trust & Reviews — the destination for the /me drawer's "Trust & Reviews"
// entry. Previously that link dropped users on /hotels (the booking browse),
// which felt like "it just opens a hotel page". This is a reviews-first
// surface: every stay scored on real guest experience, each row linking
// straight into that hotel's guest-review page (/hotels/[id]/reviews).
import { useState, useEffect } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import HotelScoreBadge from "@/components/hotel/HotelScoreBadge";

export default function TrustReviewsPage() {
  const [hotels, setHotels] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  useEffect(() => {
    api.getHotels({ limit: "60" })
      .then((res: any) => {
        const list = (res.hotels || []).slice();
        // Best-reviewed first. starRating is the stable proxy we always have on
        // the list payload; each row's HotelScoreBadge self-fetches the live
        // Stay Score + city rank.
        list.sort((a: any, b: any) => (b.starRating || 0) - (a.starRating || 0));
        setHotels(list);
      })
      .catch((e: any) => setErr(e?.message || "Could not load stays right now."))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="min-h-screen pb-24" style={{ background: "var(--bg-page)" }}>
      <div className="max-w-3xl mx-auto px-5 py-8 sm:py-12">
        {/* Header */}
        <header className="sb-fade-in mb-5">
          <p className="text-xs uppercase tracking-widest font-bold mb-1 inline-flex items-center gap-1.5" style={{ color: "var(--accent)" }}>
            <span className="sb-pulse-dot" /> Your Account
          </p>
          <h1 className="font-display text-3xl sm:text-4xl" style={{ color: "var(--text-base)" }}>Trust &amp; Reviews</h1>
          <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
            Every stay is scored on real guest experience — verification videos, on-time check-in, and post-stay feedback. Tap any stay to read its guest reviews.
          </p>
        </header>

        {/* Explainer chips */}
        <div className="grid grid-cols-3 gap-2.5 mb-6 sb-stagger">
          {[
            { icon: "✅", t: "Verified stays", s: "Video-checked rooms" },
            { icon: "🏆", t: "Stay Score", s: "0–100 + city rank" },
            { icon: "⭐", t: "Guest reviews", s: "Real · post-checkout" },
          ].map((c) => (
            <div key={c.t} className="card-luxury sb-card-lift p-3 text-center rounded-2xl">
              <div className="text-xl mb-1">{c.icon}</div>
              <div className="text-xs font-bold leading-tight" style={{ color: "var(--text-base)" }}>{c.t}</div>
              <div className="text-[0.6rem] mt-0.5 leading-tight" style={{ color: "var(--text-muted)" }}>{c.s}</div>
            </div>
          ))}
        </div>

        {/* List */}
        {loading ? (
          <div className="space-y-3">
            {[0, 1, 2, 3].map((i) => <div key={i} className="card-luxury p-4 rounded-2xl shimmer" style={{ height: 84 }} />)}
          </div>
        ) : err ? (
          <div className="text-center py-14 text-sm" style={{ color: "var(--text-muted)" }}>{err}</div>
        ) : hotels.length === 0 ? (
          <div className="text-center py-14 text-sm" style={{ color: "var(--text-muted)" }}>No stays to show yet.</div>
        ) : (
          <div className="space-y-3 sb-stagger">
            {hotels.map((h) => (
              <Link
                key={h.id}
                href={`/hotels/${h.id}/reviews`}
                className="card-luxury sb-card-lift p-4 rounded-2xl flex items-center gap-3"
              >
                <div className="flex-1 min-w-0">
                  <p className="font-semibold truncate" style={{ color: "var(--text-base)" }}>{h.name}</p>
                  <p className="text-xs truncate" style={{ color: "var(--text-muted)" }}>
                    {[h.city, h.state].filter(Boolean).join(", ")}
                  </p>
                  <span className="text-xs font-semibold mt-1 inline-block" style={{ color: "var(--accent)" }}>Read guest reviews →</span>
                </div>
                <div className="shrink-0">
                  <HotelScoreBadge hotelId={h.id} hotelName={h.name} variant="compact" />
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
