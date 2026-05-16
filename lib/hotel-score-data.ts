// ── Hotel Score data loader (server-only) ─────────────────────────────
// Fetches every signal needed by computeHotelScore() in parallel from
// Supabase REST. Called by /api/hotels/:id/scorecard + the cron sweep.
//
// Why a separate module: the same data shape is needed for both lazy
// recompute (customer page open) and bulk recompute (cron). Centralising
// keeps the field-name handling + side-load logic in one place.

import { SB_URL, SB_H } from "@/lib/sb";
import { sbCached } from "@/lib/sb-cache";
import type { HotelScoreInputs } from "@/lib/hotel-score";

async function sb(path: string): Promise<any[]> {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    headers: SB_H,
    cache: "no-store",
  });
  if (!r.ok) return [];
  return r.json().catch(() => []);
}

export async function loadHotelScoreInputs(
  hotelId: string,
): Promise<HotelScoreInputs> {
  // 1. Pull every bid for this hotel (caps at 1000; older bids matter less).
  const bidsP = sb(
    `bids?hotelId=eq.${encodeURIComponent(hotelId)}` +
      `&select=id,status,createdAt,updatedAt,counterAmount,customerId,requestId` +
      `&order=createdAt.desc&limit=1000`,
  );

  // 2. Pull complaints + stay_feedback for this hotel.
  const complaintsP = sb(
    `complaints?hotelId=eq.${encodeURIComponent(hotelId)}` +
      `&select=id,status,feedbackType,feedback,feedbackAutoFilled,createdAt,resolvedAt,priority` +
      `&order=createdAt.desc&limit=500`,
  );

  // 3. Verification subsystem.
  const vpReqsP = sb(
    `vp_requests?hotel_id=eq.${encodeURIComponent(hotelId)}` +
      `&select=id,status,created_at,hotel_video_id,due_by` +
      `&order=created_at.desc&limit=300`,
  );
  const vpVidsP = sb(
    `vp_videos?hotel_id=eq.${encodeURIComponent(hotelId)}` +
      `&select=id,status,created_at` +
      `&order=created_at.desc&limit=300`,
  );

  // v128.2 — Customer star reviews from feedback_tracking. Only
  // submitted=true rows have a real rating; drafts/empty rows skipped.
  const reviewsP = sb(
    `feedback_tracking?hotel_id=eq.${encodeURIComponent(hotelId)}` +
      `&submitted=eq.true` +
      `&rating=not.is.null` +
      `&select=id,booking_id,rating,comments,submitted,created_at,timestamp` +
      `&order=created_at.desc&limit=500`,
  );

  const [bids, complaints, vpRequests, vpVideos, reviewsRaw] = await Promise.all([
    bidsP,
    complaintsP,
    vpReqsP,
    vpVidsP,
    reviewsP,
  ]);

  // Normalise reviews — created_at fallback to timestamp.
  const reviews = (reviewsRaw as any[]).map((r) => ({
    id: r.id,
    booking_id: r.booking_id,
    rating: r.rating,
    comments: r.comments,
    submitted: r.submitted,
    created_at: r.created_at || r.timestamp,
  }));

  // 4. Side-load bid_requests for ACCEPTED bids → derive bookingsWithDates.
  const acceptedBids = bids.filter((b: any) =>
    ["ACCEPTED", "CHECKED_IN", "CHECKED_OUT", "CONFIRMED"].includes(b.status),
  );
  const reqIds = Array.from(
    new Set(acceptedBids.map((b: any) => b.requestId).filter(Boolean)),
  );
  let reqs: any[] = [];
  if (reqIds.length) {
    reqs = await sb(
      `bid_requests?id=in.(${reqIds.map((id) => encodeURIComponent(id)).join(",")})` +
        `&select=id,checkIn,checkOut`,
    );
  }
  const reqById: Record<string, any> = Object.fromEntries(
    reqs.map((r: any) => [r.id, r]),
  );

  const bookingsWithDates = acceptedBids.map((b: any) => {
    const r = reqById[b.requestId] || {};
    return {
      bidId: b.id,
      status: b.status,
      checkIn: r.checkIn,
      checkOut: r.checkOut,
      checkedInAt: undefined,
      checkedOutAt: undefined,
    };
  });

  // 5. Booking messages for room-ready heuristic.
  let bookingMessages: any[] = [];
  if (acceptedBids.length) {
    const bidIds = acceptedBids.map((b: any) => b.id);
    bookingMessages = await sb(
      `booking_messages?bid_id=in.(${bidIds
        .map((id: string) => encodeURIComponent(id))
        .join(",")})` +
        `&select=body,sender,created_at,bid_id` +
        `&order=created_at.desc&limit=500`,
    );
  }

  return {
    hotelId,
    bids: bids as any,
    bookingMessages,
    bookingsWithDates,
    vpRequests: vpRequests as any,
    vpVideos: vpVideos as any,
    complaints: complaints as any,
    reviews,
  };
}

// Cached version — used by the customer-facing scorecard route to avoid
// hammering Supabase on every detail-page open under heavy load. The
// cache is invalidated by the cron sweep + the admin recompute trigger.
export async function loadHotelScoreInputsCached(
  hotelId: string,
  ttlMs = 60_000,
): Promise<HotelScoreInputs> {
  return sbCached(
    `hotel-score-inputs:${hotelId}`,
    () => loadHotelScoreInputs(hotelId),
    ttlMs,
  );
}
