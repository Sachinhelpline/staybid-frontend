"use client";
/*
 * v636 — HotelTrustStrip (Treatment A, owner-picked): ONE compact strip
 * that replaces the v133 live activity pill + the v123 HotelStatsRibbon on
 * /hotels/[id]. Cells: Rating · Rooms left · vs-OTA saving, plus a quiet
 * live-activity caption. Content-aware like the old ribbon — a cell with
 * no data simply doesn't render.
 *
 * v637 — the Score cell was REMOVED after the owner's device review: the
 * compact badge overflowed its cell ("91/100" spilling past the pill). The
 * scorecard medal block is back in its ORIGINAL v128.1 form and position
 * directly below this strip (see page.tsx) — do not re-embed the badge
 * here. Presentation only: no data source invented, no logic touched.
 */

type Props = {
  avgRating?: number;
  totalReviews?: number;
  roomsAvailable?: number;
  otaSavingsPct?: number;
  liveViewing?: number;
  liveBookedToday?: number;
};

export default function HotelTrustStrip({
  avgRating,
  totalReviews,
  roomsAvailable,
  otaSavingsPct,
  liveViewing,
  liveBookedToday,
}: Props) {
  const rating = Number(avgRating) || 0;
  const reviews = Number(totalReviews) || 0;
  const rooms = Number(roomsAvailable) || 0;
  const savings = Number(otaSavingsPct) || 0;
  const viewing = Number(liveViewing) || 0;
  const booked = Number(liveBookedToday) || 0;

  return (
    <div className="hx-trust-strip hx-reveal" role="group" aria-label="Hotel trust summary">
      <div className="hx-ts-cells">
        {rating > 0 ? (
          <div className="hx-ts-cell">
            <b>★ {rating.toFixed(1)}</b>
            <span>{reviews > 0 ? `${reviews} reviews` : "Rating"}</span>
          </div>
        ) : null}
        {rooms > 0 ? (
          <div className="hx-ts-cell">
            <b>{rooms}</b>
            <span>{rooms === 1 ? "Room left" : "Rooms left"}</span>
          </div>
        ) : null}
        {savings > 0 ? (
          <div className="hx-ts-cell">
            <b>{Math.round(savings)}%</b>
            <span>vs OTA</span>
          </div>
        ) : null}
      </div>
      {viewing > 0 || booked > 0 ? (
        <p className="hx-ts-live" title="Live activity right now">
          <span className="hx-ts-live-dot" aria-hidden />
          {viewing > 0 ? <>{viewing} looking now</> : null}
          {viewing > 0 && booked > 0 ? <span className="hx-ts-live-sep" aria-hidden /> : null}
          {booked > 0 ? <>{booked} booked today</> : null}
        </p>
      ) : null}
    </div>
  );
}
