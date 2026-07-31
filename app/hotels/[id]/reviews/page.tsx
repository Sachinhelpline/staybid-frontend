"use client";
/*
 * v128.3 — Public Customer Reviews full page.
 *
 * Stand-alone route — replaces the in-modal drill-down. User asked for
 * a "real page" experience: no overlap, no blur, no other hotels visible,
 * full information, clean back-to-where-you-came-from on close.
 *
 * URL: /hotels/[id]/reviews?return=<encoded>&hotel=<name>&from=scorecard
 *
 * Features:
 *   - Sticky top header: ← Back + hotel name + "Customer Reviews"
 *   - Hero stats card: avg /5 + histogram of 5/4/3/2/1 + count
 *   - Filter chips: All / 5★ / 4★ / 3★ / 2★ / 1★ / With comments
 *   - List of anonymized reviews (guestTag + stars + comment + date)
 *   - Back button restores scorecard modal if user came from there
 *     (via sessionStorage flag "sb_scorecard_reopen")
 *
 * Cozy palette + light/dark mode + mobile-safe + bottom-dock-aware.
 */
import { useEffect, useMemo, useState, useCallback, Suspense } from "react";
import { useRouter, useSearchParams, useParams } from "next/navigation";

type StarReview = {
  id: string;
  guestTag: string;
  rating: number;
  comment: string | null;
  createdAt: string;
};
type ReviewsPayload = {
  starReviews: StarReview[];
  legacyAggregate?: { avgRating: number | null; totalReviews: number } | null;
  stats: {
    starCount: number;
    avgStars: number | null;
    starHistogram: number[];
  };
};
type FilterKey = "all" | "5" | "4" | "3" | "2" | "1" | "comments";

function formatRelativeDate(iso: string): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const diff = Date.now() - t;
  const days = Math.floor(diff / 86400_000);
  if (days < 1) return "today";
  if (days < 2) return "yesterday";
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.floor(days / 7)} weeks ago`;
  return new Date(iso).toLocaleDateString();
}

function ReviewsPageInner() {
  const params = useParams();
  const router = useRouter();
  const sp = useSearchParams();
  const hotelId = String(params?.id || "");
  const returnUrl = sp.get("return") || `/hotels/${hotelId}`;
  const fromScorecard = sp.get("from") === "scorecard";
  const hotelName = sp.get("hotel") || "";

  const [payload, setPayload] = useState<ReviewsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterKey>("all");

  // Fetch reviews
  useEffect(() => {
    if (!hotelId) return;
    let cancelled = false;
    setLoading(true);
    fetch(`/api/hotels/${encodeURIComponent(hotelId)}/reviews?limit=200`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled) return;
        setPayload(d || null);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [hotelId]);

  // Restore modal on return if user came from scorecard
  const handleBack = useCallback(() => {
    if (fromScorecard) {
      try {
        sessionStorage.setItem(
          "sb_scorecard_reopen",
          JSON.stringify({ hotelId, at: Date.now() }),
        );
      } catch {}
    }
    router.push(returnUrl);
  }, [fromScorecard, hotelId, returnUrl, router]);

  // Esc closes
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleBack();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleBack]);

  const reviews = payload?.starReviews || [];
  const stats = payload?.stats;
  const legacy = payload?.legacyAggregate;
  const histogramMax = Math.max(1, ...(stats?.starHistogram || [0]));
  const hasLegacy = !!(legacy && (legacy.totalReviews || legacy.avgRating));

  const filtered = useMemo(() => {
    if (filter === "all") return reviews;
    if (filter === "comments") return reviews.filter((r) => r.comment);
    const n = Number(filter);
    return reviews.filter((r) => r.rating === n);
  }, [reviews, filter]);

  return (
    <div className="rev-shell">
      {/* Sticky header */}
      <header className="rev-header">
        <button
          type="button"
          className="rev-back"
          onClick={handleBack}
          aria-label="Back"
          title="Back"
        >
          ←
        </button>
        <div className="rev-header-text">
          <div className="rev-header-title">
            <span aria-hidden>⭐</span> Customer Reviews
          </div>
          <div className="rev-header-sub">
            {hotelName || "This hotel"} · Public 1–5 star reviews
          </div>
        </div>
        <button
          type="button"
          className="rev-close"
          onClick={handleBack}
          aria-label="Close"
        >
          ✕
        </button>
      </header>

      <div className="rev-body">
        {loading && !payload ? (
          <div className="rev-empty">
            <span className="rev-empty-emoji">⏳</span>
            Loading reviews…
          </div>
        ) : reviews.length === 0 ? (
          <>
            {hasLegacy ? (
              <div className="rev-legacy-hero">
                <div className="rev-legacy-tag">⭐ AGGREGATE RATING · prior platforms</div>
                <div className="rev-legacy-row">
                  <div className="rev-legacy-num">
                    {legacy?.avgRating != null ? legacy.avgRating.toFixed(1) : "—"}
                    <span className="rev-legacy-num-sub">/5</span>
                  </div>
                  <div className="rev-legacy-meta">
                    <div className="rev-legacy-stars" aria-hidden>
                      {[1, 2, 3, 4, 5].map((i) => (
                        <span
                          key={i}
                          className={i <= Math.round(legacy?.avgRating || 0) ? "on" : ""}
                        >
                          ★
                        </span>
                      ))}
                    </div>
                    <div className="rev-legacy-count">
                      Based on {legacy?.totalReviews.toLocaleString()} review
                      {legacy?.totalReviews === 1 ? "" : "s"} across travel platforms
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
            <div className="rev-empty">
              <span className="rev-empty-emoji">✨</span>
              <div className="rev-empty-title">
                {hasLegacy
                  ? "No verified StayBid reviews yet"
                  : "No customer reviews yet"}
              </div>
              <div className="rev-empty-body">
                Be the first verified StayBid guest to share your experience.<br />
                Every review credits you 100 StayPoints + helps future guests trust this hotel.
              </div>
            </div>
          </>
        ) : (
          <>
            {/* Legacy aggregate strip (above the verified hero) */}
            {hasLegacy ? (
              <div className="rev-legacy-strip">
                <span className="rev-legacy-strip-tag">⭐ AGGREGATE</span>
                <span className="rev-legacy-strip-num">
                  {legacy?.avgRating?.toFixed(1)}/5
                </span>
                <span className="rev-legacy-strip-meta">
                  from {legacy?.totalReviews.toLocaleString()} prior-platform reviews
                </span>
              </div>
            ) : null}

            {/* Hero stats */}
            {stats?.avgStars != null ? (
              <div className="rev-hero">
                <div className="rev-hero-left">
                  <div className="rev-hero-num">
                    {stats.avgStars.toFixed(1)}
                    <span className="rev-hero-num-sub">/5</span>
                  </div>
                  <div className="rev-hero-stars" aria-hidden>
                    {[1, 2, 3, 4, 5].map((i) => (
                      <span
                        key={i}
                        className={i <= Math.round(stats.avgStars || 0) ? "on" : ""}
                      >
                        ★
                      </span>
                    ))}
                  </div>
                  <div className="rev-hero-count">
                    Based on {stats.starCount} review{stats.starCount === 1 ? "" : "s"}
                  </div>
                </div>
                <div className="rev-hero-bars">
                  {[5, 4, 3, 2, 1].map((star) => {
                    const count = stats.starHistogram[star - 1] || 0;
                    const pct = (count / histogramMax) * 100;
                    return (
                      <button
                        key={star}
                        type="button"
                        className={`rev-bar-row${filter === String(star) ? " rev-bar-active" : ""}`}
                        onClick={() => setFilter(String(star) as FilterKey)}
                        aria-label={`Show only ${star}-star reviews (${count} reviews)`}
                      >
                        <span className="rev-bar-label">{star}★</span>
                        <span className="rev-bar-track">
                          <span
                            className="rev-bar-fill"
                            style={{ width: `${pct}%` }}
                          />
                        </span>
                        <span className="rev-bar-count">{count}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {/* Filter chips */}
            <div className="rev-filters" role="tablist">
              {([
                { k: "all", l: `All (${reviews.length})` },
                { k: "5", l: `5★ (${stats?.starHistogram[4] || 0})` },
                { k: "4", l: `4★ (${stats?.starHistogram[3] || 0})` },
                { k: "3", l: `3★ (${stats?.starHistogram[2] || 0})` },
                { k: "2", l: `2★ (${stats?.starHistogram[1] || 0})` },
                { k: "1", l: `1★ (${stats?.starHistogram[0] || 0})` },
                { k: "comments", l: `With comments (${reviews.filter((r) => r.comment).length})` },
              ] as { k: FilterKey; l: string }[]).map((f) => (
                <button
                  key={f.k}
                  type="button"
                  role="tab"
                  aria-selected={filter === f.k}
                  className={`rev-chip${filter === f.k ? " rev-chip-active" : ""}`}
                  onClick={() => setFilter(f.k)}
                >
                  {f.l}
                </button>
              ))}
            </div>

            {/* Review list */}
            {filtered.length === 0 ? (
              <div className="rev-list-empty">
                No reviews match this filter. Try “All” to see everything.
              </div>
            ) : (
              <div className="rev-list">
                {filtered.map((r) => (
                  <article className="rev-card" key={r.id}>
                    <header className="rev-card-head">
                      <span className="rev-guest" aria-label={`Guest ${r.guestTag}`}>
                        🙂 {r.guestTag}
                      </span>
                      <span
                        className="rev-card-stars"
                        aria-label={`${r.rating} of 5 stars`}
                      >
                        {[1, 2, 3, 4, 5].map((i) => (
                          <span key={i} className={i <= r.rating ? "on" : ""}>
                            ★
                          </span>
                        ))}
                      </span>
                      <time className="rev-card-date" dateTime={r.createdAt}>
                        {formatRelativeDate(r.createdAt)}
                      </time>
                    </header>
                    <div
                      className={`rev-card-body${r.comment ? "" : " rev-card-body-empty"}`}
                    >
                      {r.comment || "Rated without a written review."}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <style jsx>{`
        .rev-shell {
          min-height: 100dvh;
          background: linear-gradient(180deg,
            color-mix(in oklab, var(--cozy-champagne, #5f7c98) 6%, var(--bg-page, #f4f6f8)) 0%,
            var(--bg-page, #f4f6f8) 30%);
          color: var(--text-base, #1f1a0f);
          padding-bottom: calc(80px + env(safe-area-inset-bottom, 0px));
          font-family: var(--font-body, "DM Sans"), system-ui, sans-serif;
        }
        .rev-header {
          position: sticky;
          top: 0;
          z-index: 20;
          display: flex;
          align-items: center;
          gap: 12px;
          padding: calc(env(safe-area-inset-top, 0px) + 12px) 14px 12px;
          background: var(--bg-card, #f4f6f8);
          border-bottom: 1px solid rgba(106, 133, 160, 0.22);
          backdrop-filter: blur(10px) saturate(140%);
          -webkit-backdrop-filter: blur(10px) saturate(140%);
        }
        .rev-back, .rev-close {
          flex-shrink: 0;
          width: 38px;
          height: 38px;
          border-radius: 50%;
          border: 1px solid rgba(106, 133, 160, 0.35);
          /* v499 — theme tokens (was fixed cream/cocoa → a stray light circle
             on the dark shell). Flips with Appearance. */
          background: var(--bg-pill, rgba(176, 192, 209, 0.85));
          color: var(--text-soft, #4a3820);
          font-size: 1rem;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          transition: transform 0.18s, background 0.2s;
        }
        .rev-back:hover, .rev-close:hover {
          background: var(--accent-soft, rgba(106,133,160,0.18));
        }
        .rev-back:active, .rev-close:active { transform: scale(0.94); }
        .rev-header-text { flex: 1 1 auto; min-width: 0; }
        .rev-header-title {
          font-family: var(--font-display, "Cormorant Garamond"), serif;
          font-style: italic;
          font-weight: 600;
          font-size: 1.25rem;
          line-height: 1.15;
          color: var(--text-base, #1f1a0f);
          display: flex;
          align-items: center;
          gap: 7px;
        }
        .rev-header-sub {
          font-size: 0.72rem;
          letter-spacing: 0.04em;
          color: var(--cozy-cocoa-soft, #6e5430);
          margin-top: 2px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .rev-body {
          max-width: 820px;
          margin: 0 auto;
          padding: 18px 14px 0;
        }

        /* Hero stats */
        .rev-hero {
          display: grid;
          grid-template-columns: auto 1fr;
          gap: 22px;
          padding: 18px;
          background: linear-gradient(150deg,
            color-mix(in oklab, var(--cozy-champagne, #5f7c98) 14%, var(--bg-elevated, #fcfcfd)) 0%,
            var(--bg-card, #f4f6f8) 80%);
          border: 1px solid rgba(106, 133, 160, 0.30);
          border-radius: 18px;
          box-shadow:
            0 4px 14px -6px rgba(31, 26, 15, 0.12),
            inset 0 1px 0 rgba(255, 255, 255, 0.55);
          margin-bottom: 16px;
        }
        @media (max-width: 480px) {
          .rev-hero { grid-template-columns: 1fr; gap: 14px; padding: 14px; }
        }
        .rev-hero-left {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .rev-hero-num {
          font-family: var(--font-display, "Cormorant Garamond"), serif;
          font-style: italic;
          font-weight: 700;
          font-size: 3rem;
          line-height: 1;
          color: var(--text-base, #1f1a0f);
          letter-spacing: -0.02em;
        }
        .rev-hero-num-sub {
          font-size: 1.1rem;
          opacity: 0.5;
          margin-left: 2px;
        }
        .rev-hero-stars {
          font-size: 1.1rem;
          color: var(--cozy-champagne, #5f7c98);
          letter-spacing: 0.06em;
        }
        .rev-hero-stars span { opacity: 0.28; }
        .rev-hero-stars span.on { opacity: 1; }
        .rev-hero-count {
          font-size: 0.78rem;
          color: var(--cozy-cocoa-soft, #6e5430);
          font-weight: 600;
        }

        .rev-hero-bars {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .rev-bar-row {
          display: grid;
          grid-template-columns: 32px 1fr 36px;
          gap: 8px;
          align-items: center;
          background: transparent;
          border: 1px solid transparent;
          padding: 4px 6px;
          border-radius: 8px;
          cursor: pointer;
          transition: background 0.2s, border-color 0.2s;
          color: inherit;
          font-family: inherit;
          font-size: 0.78rem;
        }
        .rev-bar-row:hover { background: rgba(106, 133, 160, 0.08); }
        .rev-bar-active {
          background: rgba(106, 133, 160, 0.18);
          border-color: rgba(106, 133, 160, 0.45);
        }
        .rev-bar-label { color: var(--cozy-cocoa, #4a3820); font-weight: 700; }
        .rev-bar-track {
          display: block;
          height: 8px;
          background: rgba(106, 133, 160, 0.18);
          border-radius: 4px;
          overflow: hidden;
        }
        .rev-bar-fill {
          display: block;
          height: 100%;
          background: linear-gradient(90deg, #b4c1cf, #5f7c98);
          border-radius: 4px;
        }
        .rev-bar-count {
          text-align: right;
          color: var(--cozy-cocoa, #4a3820);
          font-weight: 700;
          font-variant-numeric: tabular-nums;
        }

        /* Filter chips */
        .rev-filters {
          display: flex;
          gap: 8px;
          flex-wrap: nowrap;
          overflow-x: auto;
          -webkit-overflow-scrolling: touch;
          padding-bottom: 4px;
          margin-bottom: 14px;
          scrollbar-width: none;
        }
        .rev-filters::-webkit-scrollbar { display: none; }
        .rev-chip {
          flex-shrink: 0;
          padding: 7px 13px;
          border-radius: 999px;
          font-size: 0.72rem;
          font-weight: 700;
          letter-spacing: 0.04em;
          background: var(--bg-elevated, #fcfcfd);
          border: 1px solid rgba(106, 133, 160, 0.30);
          color: var(--cozy-cocoa, #4a3820);
          cursor: pointer;
          transition: background 0.2s, border-color 0.2s, transform 0.15s;
          font-family: inherit;
          white-space: nowrap;
        }
        .rev-chip:hover { background: rgba(106, 133, 160, 0.10); }
        .rev-chip-active {
          background: var(--cozy-warm-dark, #1F1A0F);
          color: var(--cozy-cream-50, #fcfcfd);
          border-color: var(--cozy-warm-dark, #1F1A0F);
        }
        .rev-chip-active:hover {
          background: var(--cozy-warm-soft, #2B2415);
        }

        /* Review cards */
        .rev-list {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .rev-card {
          padding: 14px 16px;
          background: var(--bg-elevated, #fcfcfd);
          border: 1px solid rgba(106, 133, 160, 0.22);
          border-radius: 14px;
          box-shadow: 0 2px 8px -4px rgba(31, 26, 15, 0.10);
        }
        .rev-card-head {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 8px;
          flex-wrap: wrap;
        }
        .rev-guest {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          padding: 4px 10px;
          background: var(--accent-soft, rgba(106,133,160,0.18));
          color: var(--cozy-cocoa, #4a3820);
          font-size: 0.7rem;
          font-weight: 700;
          letter-spacing: 0.08em;
          border-radius: 999px;
        }
        .rev-card-stars {
          font-size: 0.95rem;
          color: var(--cozy-champagne, #5f7c98);
          letter-spacing: 0.05em;
        }
        .rev-card-stars span { opacity: 0.28; }
        .rev-card-stars span.on { opacity: 1; }
        .rev-card-date {
          margin-left: auto;
          font-size: 0.7rem;
          color: var(--cozy-cocoa-soft, #6e5430);
          letter-spacing: 0.03em;
        }
        .rev-card-body {
          font-size: 0.9rem;
          line-height: 1.55;
          color: var(--text-base, #1f1a0f);
          word-break: break-word;
        }
        .rev-card-body-empty {
          font-style: italic;
          color: var(--cozy-cocoa-soft, #6e5430);
          font-size: 0.82rem;
        }
        .rev-list-empty {
          padding: 30px 16px;
          text-align: center;
          color: var(--cozy-cocoa-soft, #6e5430);
          font-size: 0.88rem;
        }

        /* v128.4 — Legacy aggregate (prior-platform reviews) */
        .rev-legacy-hero {
          display: flex;
          flex-direction: column;
          gap: 10px;
          padding: 18px;
          margin-bottom: 18px;
          background: linear-gradient(150deg, rgba(106,133,160,0.16) 0%, var(--bg-elevated, #fcfcfd) 90%);
          border: 1px solid rgba(106, 133, 160, 0.32);
          border-radius: 18px;
          box-shadow:
            0 4px 14px -6px rgba(31, 26, 15, 0.10),
            inset 0 1px 0 rgba(255, 255, 255, 0.55);
        }
        .rev-legacy-tag {
          font-size: 0.62rem;
          font-weight: 800;
          letter-spacing: 0.10em;
          color: var(--cozy-cocoa, #4a3820);
          text-transform: uppercase;
        }
        .rev-legacy-row {
          display: flex;
          align-items: center;
          gap: 16px;
          flex-wrap: wrap;
        }
        .rev-legacy-num {
          font-family: var(--font-display, "Cormorant Garamond"), serif;
          font-style: italic;
          font-weight: 700;
          font-size: 2.6rem;
          line-height: 1;
          color: var(--text-base, #1f1a0f);
          letter-spacing: -0.02em;
        }
        .rev-legacy-num-sub {
          font-size: 1rem;
          opacity: 0.5;
          margin-left: 4px;
        }
        .rev-legacy-meta { display: flex; flex-direction: column; gap: 4px; }
        .rev-legacy-stars {
          font-size: 1rem;
          color: var(--cozy-champagne, #5f7c98);
          letter-spacing: 0.06em;
        }
        .rev-legacy-stars span { opacity: 0.28; }
        .rev-legacy-stars span.on { opacity: 1; }
        .rev-legacy-count {
          font-size: 0.78rem;
          color: var(--cozy-cocoa-soft, #6e5430);
          font-weight: 600;
        }

        .rev-legacy-strip {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 8px 14px;
          margin-bottom: 12px;
          background: rgba(106, 133, 160, 0.10);
          border: 1px solid rgba(106, 133, 160, 0.25);
          border-radius: 999px;
          font-size: 0.76rem;
          color: var(--cozy-cocoa, #4a3820);
          flex-wrap: wrap;
        }
        .rev-legacy-strip-tag {
          font-size: 0.58rem;
          font-weight: 800;
          letter-spacing: 0.10em;
          background: var(--cozy-warm-dark, #1F1A0F);
          color: var(--cozy-cream-50, #fcfcfd);
          padding: 3px 8px;
          border-radius: 999px;
        }
        .rev-legacy-strip-num {
          font-family: var(--font-display, "Cormorant Garamond"), serif;
          font-style: italic;
          font-weight: 700;
          font-size: 1rem;
          color: var(--text-base, #1f1a0f);
        }
        .rev-legacy-strip-meta {
          font-size: 0.72rem;
          color: var(--cozy-cocoa-soft, #6e5430);
        }

        /* Empty / loading */
        .rev-empty {
          padding: 50px 24px;
          text-align: center;
          color: var(--text-soft, #4a3820);
          line-height: 1.55;
        }
        .rev-empty-emoji {
          font-size: 2.2rem;
          display: block;
          margin-bottom: 8px;
        }
        .rev-empty-title {
          font-family: var(--font-display, "Cormorant Garamond"), serif;
          font-style: italic;
          font-size: 1.35rem;
          color: var(--text-base, #1f1a0f);
          margin-bottom: 6px;
        }
        .rev-empty-body {
          font-size: 0.88rem;
          color: var(--cozy-cocoa-soft, #6e5430);
        }

        @media (prefers-reduced-motion: reduce) {
          .rev-bar-row, .rev-chip, .rev-back, .rev-close { transition: none; }
        }
      `}</style>
    </div>
  );
}

export default function HotelReviewsPage() {
  return (
    <Suspense fallback={null}>
      <ReviewsPageInner />
    </Suspense>
  );
}
