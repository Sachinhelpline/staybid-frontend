"use client";
/*
 * v123 — Animated trust + stats ribbon under the hero mosaic.
 *
 * Renders 4–6 pill chips with live indicators + count-up numbers. Each
 * pill is content-aware: only shows if the underlying data exists.
 * Includes: rating, rooms-available-now, lowest price, OTA savings %,
 * verified, optional flash-deal-active.
 */
import { useEffect, useRef, useState } from "react";

function useCountUp(target: number, duration = 900) {
  const [val, setVal] = useState(0);
  const startedRef = useRef(false);

  useEffect(() => {
    if (!Number.isFinite(target) || target <= 0) {
      setVal(0);
      return;
    }
    // restart on target change
    startedRef.current = true;
    const start = performance.now();
    const from = 0;
    let raf = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / duration);
      const e = 1 - Math.pow(1 - k, 3); // ease-out cubic
      setVal(Math.round(from + (target - from) * e));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);

  return val;
}

type Props = {
  avgRating?: number;
  totalReviews?: number;
  starRating?: number;
  roomsAvailable?: number;
  totalRooms?: number;
  lowestPrice?: number;
  otaSavingsPct?: number;
  trustBadge?: boolean;
  flashDealActive?: boolean;
};

export default function HotelStatsRibbon({
  avgRating,
  totalReviews,
  starRating,
  roomsAvailable,
  totalRooms,
  lowestPrice,
  otaSavingsPct,
  trustBadge,
  flashDealActive,
}: Props) {
  const reviewsCount = useCountUp(totalReviews || 0);
  const roomsLive = useCountUp(roomsAvailable || 0);
  const lowest = useCountUp(lowestPrice || 0, 1100);
  const savings = useCountUp(Math.round(otaSavingsPct || 0));

  return (
    <div className="hx-stats-ribbon hx-reveal">
      {avgRating && avgRating > 0 ? (
        <span className="hx-stat-pill">
          <span className="hx-stat-pill-icon" style={{ color: "#C9A66B" }}>★</span>
          <span className="hx-stat-pill-value" style={{ fontSize: "0.95rem" }}>
            {avgRating.toFixed(1)}
          </span>
          {totalReviews ? (
            <span className="hx-stat-pill-label">
              {reviewsCount} review{reviewsCount === 1 ? "" : "s"}
            </span>
          ) : null}
        </span>
      ) : null}

      {starRating ? (
        <span className="hx-stat-pill">
          <span style={{ color: "#C9A66B", letterSpacing: "0.18em", fontWeight: 700 }}>
            {"★".repeat(Math.min(5, Math.max(1, starRating)))}
          </span>
          <span className="hx-stat-pill-label">{starRating}-star hotel</span>
        </span>
      ) : null}

      {trustBadge ? (
        <span className="hx-stat-pill hx-stat-pill-accent">
          <span className="hx-stat-pill-icon">🛡</span>
          <span className="hx-stat-pill-value">Verified by StayBid</span>
        </span>
      ) : null}

      {Number.isFinite(roomsAvailable) && roomsAvailable! >= 0 ? (
        <span className="hx-stat-pill hx-stat-pill-live">
          <span className="hx-stat-pill-value">{roomsLive}</span>
          <span className="hx-stat-pill-label">
            of {totalRooms || roomsAvailable} rooms vacant
          </span>
        </span>
      ) : null}

      {lowestPrice && lowestPrice > 0 ? (
        <span className="hx-stat-pill hx-stat-pill-accent">
          <span className="hx-stat-pill-label" style={{ fontSize: "0.62rem" }}>
            FROM
          </span>
          <span className="hx-stat-pill-value" style={{ fontSize: "0.98rem" }}>
            ₹{lowest.toLocaleString()}
          </span>
          <span className="hx-stat-pill-label">/ night</span>
        </span>
      ) : null}

      {otaSavingsPct && otaSavingsPct > 0 ? (
        <span className="hx-stat-pill">
          <span className="hx-stat-pill-icon">💰</span>
          <span className="hx-stat-pill-value" style={{ color: "#7F9269" }}>
            {savings}% cheaper
          </span>
          <span className="hx-stat-pill-label">than OTAs</span>
        </span>
      ) : null}

      {flashDealActive ? (
        <span className="hx-stat-pill" style={{ borderColor: "rgba(212, 149, 131, 0.45)", background: "rgba(212, 149, 131, 0.10)" }}>
          <span className="hx-stat-pill-icon">⚡</span>
          <span className="hx-stat-pill-value" style={{ color: "#A85B4E" }}>
            Flash deal active
          </span>
        </span>
      ) : null}
    </div>
  );
}
