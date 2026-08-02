"use client";
/*
 * v636 — HotelTrustStrip (Treatment A, owner-picked): ONE compact 4-cell
 * strip that replaces THREE stacked bands on /hotels/[id] — the v133 live
 * activity pill, the v123 HotelStatsRibbon, and the v128.1 scorecard medal
 * block. Cells: Rating · StayBid Score · Rooms left · vs-OTA saving, plus a
 * quiet live-activity caption. Content-aware like the old ribbon — a cell
 * with no data simply doesn't render.
 *
 * The Score cell embeds HotelScoreBadge variant="compact" UNCHANGED — it
 * owns its own fetch + tap-for-breakdown modal, so the medal block's
 * behaviour survives the merge (nothing re-implemented, nothing lost).
 * Presentation only: no data source invented, no logic touched.
 */
import HotelScoreBadge from "@/components/hotel/HotelScoreBadge";

type Props = {
  hotelId: string;
  hotelName?: string;
  avgRating?: number;
  totalReviews?: number;
  roomsAvailable?: number;
  otaSavingsPct?: number;
  liveViewing?: number;
  liveBookedToday?: number;
};

export default function HotelTrustStrip({
  hotelId,
  hotelName,
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
        <div className="hx-ts-cell hx-ts-cell-score">
          <HotelScoreBadge hotelId={hotelId} hotelName={hotelName} variant="compact" />
        </div>
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
