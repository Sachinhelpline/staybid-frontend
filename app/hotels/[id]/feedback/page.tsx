"use client";
/*
 * v128.3 — Public Guest Stay Feedback full page.
 *
 * Companion to /hotels/[id]/reviews. Renders the smiley-grid feedback
 * collected via the StayFeedbackCard (post-checkout). Per user spec:
 *   "yeh hmare platform ka sab se trustable point hai" — designed as
 *   the platform's most-trusted public surface.
 *
 * URL: /hotels/[id]/feedback?return=<encoded>&hotel=<name>&from=scorecard
 *
 * Features:
 *   - Sticky header: ← Back + hotel name + "Guest Stay Feedback"
 *   - Hero stats: % positive + per-checkpoint breakdown (5 cells)
 *   - Filter chips: All / All positive / Has negative / Auto-marked
 *   - Anonymous per-guest cards with 5-cell smiley grid
 *   - Back-button reopens scorecard modal if user came from there
 */
import { useEffect, useMemo, useState, useCallback, Suspense } from "react";
import { useRouter, useSearchParams, useParams } from "next/navigation";

type Sentiment = "positive" | "neutral" | "negative";

type StayFeedback = {
  id: string;
  guestTag: string;
  autoFilled: boolean;
  snapshot: Record<string, Sentiment>;
  createdAt: string;
};

type Payload = {
  stayFeedback: StayFeedback[];
  stats: {
    stayFeedbackCount: number;
    stayFeedbackPctPositive: number | null;
    stayFeedbackNegativeCount: number;
  };
};

type FilterKey = "all" | "allPositive" | "hasNegative" | "autoMarked";

const SMILEY_LABELS: Record<string, { label: string; emoji: string }> = {
  roomMatch: { label: "Room matches video", emoji: "🛏️" },
  staff: { label: "Staff behavior", emoji: "🤝" },
  hygiene: { label: "Hygiene & cleanliness", emoji: "🧼" },
  food: { label: "Food quality", emoji: "🍽️" },
  staffResponse: { label: "Staff response", emoji: "⚡" },
};
const SMILEY_KEYS = ["roomMatch", "staff", "hygiene", "food", "staffResponse"] as const;

function smileyTone(v: Sentiment | undefined): string {
  if (v === "positive") return "#7F9269";
  if (v === "neutral") return "#b4c1cf";
  if (v === "negative") return "#D49583";
  return "#5f7c98";
}
function smileyEmoji(v: Sentiment | undefined): string {
  if (v === "positive") return "😊";
  if (v === "neutral") return "😐";
  if (v === "negative") return "😞";
  return "·";
}
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

function FeedbackPageInner() {
  const params = useParams();
  const router = useRouter();
  const sp = useSearchParams();
  const hotelId = String(params?.id || "");
  const returnUrl = sp.get("return") || `/hotels/${hotelId}`;
  const fromScorecard = sp.get("from") === "scorecard";
  const hotelName = sp.get("hotel") || "";

  const [payload, setPayload] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterKey>("all");

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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleBack();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleBack]);

  const rows = payload?.stayFeedback || [];
  const stats = payload?.stats;

  // Per-checkpoint aggregated % positive (so the hero shows the
  // 5-cell breakdown without rebuilding it client-side from raw rows).
  const checkpointBreakdown = useMemo(() => {
    const acc: Record<string, { positive: number; neutral: number; negative: number; total: number }> = {};
    for (const k of SMILEY_KEYS) {
      acc[k] = { positive: 0, neutral: 0, negative: 0, total: 0 };
    }
    for (const r of rows) {
      for (const k of SMILEY_KEYS) {
        const v = r.snapshot[k];
        if (!v) continue;
        acc[k][v]++;
        acc[k].total++;
      }
    }
    return acc;
  }, [rows]);

  const filtered = useMemo(() => {
    if (filter === "all") return rows;
    if (filter === "autoMarked") return rows.filter((r) => r.autoFilled);
    if (filter === "allPositive") {
      return rows.filter((r) =>
        Object.values(r.snapshot).every((v) => v === "positive"),
      );
    }
    if (filter === "hasNegative") {
      return rows.filter((r) =>
        Object.values(r.snapshot).some((v) => v === "negative"),
      );
    }
    return rows;
  }, [rows, filter]);

  return (
    <div className="fb-shell">
      <header className="fb-header">
        <button
          type="button"
          className="fb-back"
          onClick={handleBack}
          aria-label="Back"
          title="Back"
        >
          ←
        </button>
        <div className="fb-header-text">
          <div className="fb-header-title">
            <span aria-hidden>😊</span> Guest Stay Feedback
          </div>
          <div className="fb-header-sub">
            {hotelName || "This hotel"} · Per-checkpoint smiley grid
          </div>
        </div>
        <button
          type="button"
          className="fb-close"
          onClick={handleBack}
          aria-label="Close"
        >
          ✕
        </button>
      </header>

      <div className="fb-body">
        {loading && !payload ? (
          <div className="fb-empty">
            <span className="fb-empty-emoji">⏳</span>
            Loading guest feedback…
          </div>
        ) : rows.length === 0 ? (
          <div className="fb-empty">
            <span className="fb-empty-emoji">💭</span>
            <div className="fb-empty-title">No stay feedback yet</div>
            <div className="fb-empty-body">
              Smiley checkpoints unlock after each guest's checkout.<br />
              5 simple checkpoints · 3 smileys each · earns 100 StayPoints.
            </div>
          </div>
        ) : (
          <>
            {/* Hero stats */}
            <div className="fb-hero">
              <div className="fb-hero-top">
                <div className="fb-hero-num">
                  {stats?.stayFeedbackPctPositive ?? 0}
                  <span className="fb-hero-num-sub">% positive</span>
                </div>
                <div className="fb-hero-meta">
                  {stats?.stayFeedbackCount || 0} guest{(stats?.stayFeedbackCount || 0) === 1 ? "" : "s"} surveyed
                  {(stats?.stayFeedbackNegativeCount || 0) > 0
                    ? ` · ${stats?.stayFeedbackNegativeCount} negative checkpoint${
                        stats?.stayFeedbackNegativeCount === 1 ? "" : "s"
                      }`
                    : ""}
                </div>
              </div>

              {/* Per-checkpoint mini-grid */}
              <div className="fb-checkpoint-row">
                {SMILEY_KEYS.map((k) => {
                  const b = checkpointBreakdown[k];
                  const pct = b.total ? Math.round((b.positive / b.total) * 100) : null;
                  const tone =
                    pct == null
                      ? "#5f7c98"
                      : pct >= 80
                        ? "#7F9269"
                        : pct >= 50
                          ? "#b4c1cf"
                          : "#D49583";
                  return (
                    <div
                      key={k}
                      className="fb-checkpoint-cell"
                      style={{ ["--fb-tone" as any]: tone }}
                    >
                      <div className="fb-checkpoint-emoji">{SMILEY_LABELS[k].emoji}</div>
                      <div className="fb-checkpoint-pct">
                        {pct == null ? "—" : `${pct}%`}
                      </div>
                      <div className="fb-checkpoint-lbl">{SMILEY_LABELS[k].label.split(" ")[0]}</div>
                      <div className="fb-checkpoint-count">
                        {b.total} {b.total === 1 ? "guest" : "guests"}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Filter chips */}
            <div className="fb-filters" role="tablist">
              {([
                { k: "all", l: `All (${rows.length})` },
                { k: "allPositive", l: `All positive (${rows.filter((r) => Object.values(r.snapshot).every((v) => v === "positive")).length})` },
                { k: "hasNegative", l: `Has negative (${rows.filter((r) => Object.values(r.snapshot).some((v) => v === "negative")).length})` },
                { k: "autoMarked", l: `Auto-marked (${rows.filter((r) => r.autoFilled).length})` },
              ] as { k: FilterKey; l: string }[]).map((f) => (
                <button
                  key={f.k}
                  type="button"
                  role="tab"
                  aria-selected={filter === f.k}
                  className={`fb-chip${filter === f.k ? " fb-chip-active" : ""}`}
                  onClick={() => setFilter(f.k)}
                >
                  {f.l}
                </button>
              ))}
            </div>

            {/* Guest cards */}
            {filtered.length === 0 ? (
              <div className="fb-list-empty">
                No feedback matches this filter.
              </div>
            ) : (
              <div className="fb-list">
                {filtered.map((r) => (
                  <article className="fb-card" key={r.id}>
                    <header className="fb-card-head">
                      <span className="fb-guest" aria-label={`Guest ${r.guestTag}`}>
                        🙂 {r.guestTag}
                      </span>
                      <time className="fb-card-date" dateTime={r.createdAt}>
                        {formatRelativeDate(r.createdAt)}
                      </time>
                      {r.autoFilled ? (
                        <span className="fb-auto-pill">Auto-marked positive</span>
                      ) : null}
                    </header>
                    <div className="fb-card-grid">
                      {SMILEY_KEYS.map((k) => {
                        const v = r.snapshot[k];
                        const tone = smileyTone(v);
                        return (
                          <div
                            key={k}
                            className="fb-cell"
                            style={{ ["--fb-tone" as any]: tone }}
                            title={`${SMILEY_LABELS[k].label}: ${v || "no rating"}`}
                          >
                            <span className="fb-cell-emoji">{smileyEmoji(v)}</span>
                            <span className="fb-cell-lbl">
                              {SMILEY_LABELS[k].label.split(" ")[0]}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <style jsx>{`
        .fb-shell {
          min-height: 100dvh;
          background: linear-gradient(180deg,
            color-mix(in oklab, #7F9269 6%, var(--bg-page, #f4f6f8)) 0%,
            var(--bg-page, #f4f6f8) 30%);
          color: var(--text-base, #1f1a0f);
          padding-bottom: calc(80px + env(safe-area-inset-bottom, 0px));
          font-family: var(--font-body, "DM Sans"), system-ui, sans-serif;
        }
        .fb-header {
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
        .fb-back, .fb-close {
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
        .fb-back:hover, .fb-close:hover {
          background: var(--accent-soft, rgba(106,133,160,0.18));
        }
        .fb-back:active, .fb-close:active { transform: scale(0.94); }
        .fb-header-text { flex: 1 1 auto; min-width: 0; }
        .fb-header-title {
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
        .fb-header-sub {
          font-size: 0.72rem;
          letter-spacing: 0.04em;
          color: var(--cozy-cocoa-soft, #6e5430);
          margin-top: 2px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .fb-body {
          max-width: 820px;
          margin: 0 auto;
          padding: 18px 14px 0;
        }

        /* Hero */
        .fb-hero {
          padding: 18px;
          background: linear-gradient(150deg, rgba(127,146,105,0.12) 0%, var(--bg-card, #f4f6f8) 80%);
          border: 1px solid rgba(127, 146, 105, 0.28);
          border-radius: 18px;
          margin-bottom: 16px;
          box-shadow:
            0 4px 14px -6px rgba(31, 26, 15, 0.12),
            inset 0 1px 0 rgba(255, 255, 255, 0.55);
        }
        .fb-hero-top {
          margin-bottom: 14px;
        }
        .fb-hero-num {
          font-family: var(--font-display, "Cormorant Garamond"), serif;
          font-style: italic;
          font-weight: 700;
          font-size: 2.6rem;
          line-height: 1;
          color: var(--text-base, #1f1a0f);
          letter-spacing: -0.02em;
        }
        .fb-hero-num-sub {
          font-size: 0.95rem;
          opacity: 0.5;
          margin-left: 6px;
          font-style: normal;
          letter-spacing: 0.04em;
        }
        .fb-hero-meta {
          font-size: 0.82rem;
          color: var(--cozy-cocoa-soft, #6e5430);
          margin-top: 4px;
          font-weight: 600;
        }
        .fb-checkpoint-row {
          display: grid;
          grid-template-columns: repeat(5, 1fr);
          gap: 8px;
        }
        @media (max-width: 480px) {
          .fb-checkpoint-row { gap: 4px; }
        }
        .fb-checkpoint-cell {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 3px;
          padding: 10px 6px;
          background: color-mix(in oklab, var(--fb-tone, #5f7c98) 12%, var(--bg-elevated, #fcfcfd));
          border: 1px solid color-mix(in oklab, var(--fb-tone, #5f7c98) 38%, transparent);
          border-radius: 12px;
          text-align: center;
        }
        .fb-checkpoint-emoji {
          font-size: 1.4rem;
          line-height: 1;
        }
        .fb-checkpoint-pct {
          font-family: var(--font-display, "Cormorant Garamond"), serif;
          font-style: italic;
          font-weight: 700;
          font-size: 1.15rem;
          line-height: 1;
          color: var(--text-base, #1f1a0f);
        }
        .fb-checkpoint-lbl {
          font-size: 0.58rem;
          letter-spacing: 0.04em;
          color: var(--cozy-cocoa, #4a3820);
          font-weight: 700;
          line-height: 1.15;
        }
        .fb-checkpoint-count {
          font-size: 0.55rem;
          color: var(--cozy-cocoa-soft, #6e5430);
          letter-spacing: 0.04em;
        }
        @media (max-width: 480px) {
          .fb-checkpoint-cell { padding: 7px 3px; }
          .fb-checkpoint-emoji { font-size: 1.1rem; }
          .fb-checkpoint-pct { font-size: 0.95rem; }
          .fb-checkpoint-lbl { font-size: 0.52rem; }
          .fb-checkpoint-count { font-size: 0.5rem; }
        }

        /* Filters */
        .fb-filters {
          display: flex;
          gap: 8px;
          flex-wrap: nowrap;
          overflow-x: auto;
          -webkit-overflow-scrolling: touch;
          padding-bottom: 4px;
          margin-bottom: 14px;
          scrollbar-width: none;
        }
        .fb-filters::-webkit-scrollbar { display: none; }
        .fb-chip {
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
          transition: background 0.2s, border-color 0.2s;
          font-family: inherit;
          white-space: nowrap;
        }
        .fb-chip:hover { background: rgba(106, 133, 160, 0.10); }
        .fb-chip-active {
          background: var(--cozy-warm-dark, #1F1A0F);
          color: var(--cozy-cream-50, #fcfcfd);
          border-color: var(--cozy-warm-dark, #1F1A0F);
        }

        /* Cards */
        .fb-list {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .fb-card {
          padding: 14px 16px;
          background: var(--bg-elevated, #fcfcfd);
          border: 1px solid rgba(106, 133, 160, 0.22);
          border-radius: 14px;
          box-shadow: 0 2px 8px -4px rgba(31, 26, 15, 0.10);
        }
        .fb-card-head {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 10px;
          flex-wrap: wrap;
        }
        .fb-guest {
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
        .fb-card-date {
          font-size: 0.7rem;
          color: var(--cozy-cocoa-soft, #6e5430);
          letter-spacing: 0.03em;
        }
        .fb-auto-pill {
          padding: 3px 9px;
          background: rgba(176, 192, 209, 0.30);
          color: var(--cozy-cocoa, #4a3820);
          font-size: 0.58rem;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          font-weight: 700;
          border-radius: 999px;
          margin-left: auto;
        }
        .fb-card-grid {
          display: grid;
          grid-template-columns: repeat(5, 1fr);
          gap: 6px;
        }
        @media (max-width: 480px) {
          .fb-card-grid { gap: 4px; }
        }
        .fb-cell {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 3px;
          padding: 9px 4px;
          border-radius: 10px;
          border: 1px solid color-mix(in oklab, var(--fb-tone, #5f7c98) 36%, transparent);
          background: color-mix(in oklab, var(--fb-tone, #5f7c98) 12%, var(--bg-card, #f4f6f8));
        }
        .fb-cell-emoji {
          font-size: 1.2rem;
          line-height: 1;
        }
        .fb-cell-lbl {
          font-size: 0.54rem;
          font-weight: 600;
          color: var(--text-soft, #4a3820);
          letter-spacing: 0.03em;
          text-align: center;
          line-height: 1.1;
        }
        @media (max-width: 480px) {
          .fb-cell { padding: 6px 2px; }
          .fb-cell-emoji { font-size: 1rem; }
          .fb-cell-lbl { font-size: 0.48rem; }
        }
        .fb-list-empty {
          padding: 30px 16px;
          text-align: center;
          color: var(--cozy-cocoa-soft, #6e5430);
          font-size: 0.88rem;
        }

        .fb-empty {
          padding: 50px 24px;
          text-align: center;
          color: var(--text-soft, #4a3820);
          line-height: 1.55;
        }
        .fb-empty-emoji {
          font-size: 2.2rem;
          display: block;
          margin-bottom: 8px;
        }
        .fb-empty-title {
          font-family: var(--font-display, "Cormorant Garamond"), serif;
          font-style: italic;
          font-size: 1.35rem;
          color: var(--text-base, #1f1a0f);
          margin-bottom: 6px;
        }
        .fb-empty-body {
          font-size: 0.88rem;
          color: var(--cozy-cocoa-soft, #6e5430);
        }

        @media (prefers-reduced-motion: reduce) {
          .fb-back, .fb-close, .fb-chip { transition: none; }
        }
      `}</style>
    </div>
  );
}

export default function HotelFeedbackPage() {
  return (
    <Suspense fallback={null}>
      <FeedbackPageInner />
    </Suspense>
  );
}
