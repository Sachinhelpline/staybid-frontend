// ── Hotel Performance Score Engine (v128, 2026-05-16) ──────────────────
//
// Computes a 0-100 score per hotel from multiple performance checkpoints,
// each weighted by impact-to-customer. Pure functions only — no Supabase
// calls. The API route in /api/hotels/[id]/scorecard does the data fetch
// and feeds raw rows to `computeHotelScore()`.
//
// Why pure functions: keeps the computation deterministic + makes it
// trivial to unit-test the weighting math + lets the cron sweep call
// the same code path without dragging in the API surface.
//
// CHECKPOINTS (total = 100 pts):
//
//   1. Bid acceptance speed         (15 pts)
//      Avg minutes from bid PENDING → ACCEPTED/COUNTER. Faster = better.
//      <5min → 15 · <15min → 12 · <30min → 9 · <60min → 6 · <3h → 3 · else 0
//
//   2. Bid acceptance rate           (10 pts)
//      % of bids landing in ACCEPTED status (vs REJECTED/EXPIRED).
//      Linear: rate × 10. Floor 0.
//
//   3. Counter-offer conversion      ( 5 pts)
//      % of COUNTER bids that ultimately ACCEPTED. Floor 0.
//
//   4. Room-ready punctuality        ( 5 pts)
//      Avg minutes early (positive) or late (negative) the hotel marked
//      the room ready vs check-in time. Inferred from booking_messages
//      kind=room_ready (heuristic) + partner panel events.
//      Early ≥0 → 5 · 0-30min late → 4 · 30-90min → 2 · else 0
//
//   5. Check-in/out timeliness       ( 5 pts)
//      Based on whether bookings hit CHECKED_IN within 6h of checkIn
//      date, and CHECKED_OUT within 4h of checkOut date.
//
//   6. Verification video health     (10 pts)
//      Hotel uploaded a verification video for its vp_requests?
//      Quality of video upload (vp_videos status=approved)?
//      Avg upload-lag (created_at - vp_request.created_at).
//      Has video (any req) → +5 · approved videos ratio × 5
//
//   7. Stay-feedback smiley avg      (25 pts) ← BIGGEST CHECKPOINT
//      Weighted average of 5 smiley checkpoints across all stay_feedback
//      complaints for this hotel:
//        - roomMatch / staff / hygiene / food / staffResponse
//      positive=100, neutral=50, negative=0 per checkpoint.
//      Final = (avg/100) × 25.
//
//   8. Auto-positive ratio adjuster  (   -)
//      Not a separate checkpoint — feeds into #7. Auto-filled rows
//      count as "soft positive" (75 instead of 100) so hotels can't
//      farm auto-fills.
//
//   9. Complaint rate                (10 pts)
//      (general complaints excluding stay_feedback / total bookings).
//      0% → 10 · 5% → 7 · 10% → 4 · 20% → 1 · 30%+ → 0
//
//  10. Complaint resolution rate     (10 pts)
//      % of complaints with status IN (resolved). With time penalty —
//      resolved within 24h gets full credit, 48h gets 75%, 7d gets 50%.
//
//  11. Booking volume engagement     ( 5 pts)
//      Bookings-volume bonus so a hotel with 1 happy customer doesn't
//      tie with a hotel with 100 happy customers.
//      ≥100 bookings → 5 · ≥50 → 4 · ≥20 → 3 · ≥5 → 2 · else 1 (if any)
//
// Total possible: 100. Score is rounded to 1 decimal place.
//
// NEW hotels with zero data: returns score=null + status="unrated"
// so the badge can render a "New on StayBid" pill instead of "0/100".

// v128.2 — added "starRating" checkpoint (1-5 star reviews from
// feedback_tracking table). User explicitly flagged this as the most
// proven public signal. Reweighted to keep total = 100:
//   staySmiley: 25 → 15 (still big, but no longer dwarfs star rating)
//   counterConversion: 5 → 0 (removed — too noisy + low signal)
//   + starRating: 0 → 15  (NEW — out-of-5 reviews, public + clickable)
//   = 100 ✓
export const CHECKPOINT_WEIGHTS = {
  bidSpeed: 15,
  acceptRate: 10,
  roomReady: 5,
  checkInOut: 5,
  verifVideo: 10,
  staySmiley: 15,
  starRating: 15,  // NEW v128.2
  complaintRate: 10,
  resolution: 10,
  volume: 5,
} as const;

export type CheckpointKey = keyof typeof CHECKPOINT_WEIGHTS;

export type CheckpointResult = {
  key: CheckpointKey;
  label: string;
  emoji: string;
  weight: number;          // max possible points
  earned: number;          // 0..weight
  pct: number;             // 0..100 (earned / weight)
  evidence: string;        // human-readable "Avg 12 min response time"
  sampleSize: number;      // how many rows fed this score
  status: "excellent" | "good" | "fair" | "poor" | "no_data";
};

export type HotelScoreInputs = {
  hotelId: string;
  // bids[] from `bids` table
  bids: Array<{
    id: string;
    status: string;
    createdAt?: string;
    updatedAt?: string;
    acceptedAt?: string;
    counterAmount?: number | null;
  }>;
  // booking-message rows (kind room_ready / check_in / check_out detection is heuristic)
  bookingMessages?: Array<{
    body?: string;
    sender?: string;
    created_at?: string;
    bid_id?: string;
  }>;
  // bid_requests + bid → derive timeliness
  bookingsWithDates?: Array<{
    bidId: string;
    status?: string;
    checkIn?: string;
    checkOut?: string;
    checkedInAt?: string;
    checkedOutAt?: string;
  }>;
  // Verification subsystem rows
  vpRequests?: Array<{
    id: string;
    status?: string;
    created_at?: string;
    hotel_video_id?: string | null;
    due_by?: string;
  }>;
  vpVideos?: Array<{
    id: string;
    status?: string;
    created_at?: string;
  }>;
  // complaints + stay_feedback
  complaints: Array<{
    id: string;
    status?: string;
    feedbackType?: string | null;
    feedback?: Record<string, any> | null;
    feedbackAutoFilled?: boolean;
    createdAt?: string;
    resolvedAt?: string | null;
    priority?: string;
  }>;
  // v128.2 — feedback_tracking rows (1-5 star reviews)
  reviews?: Array<{
    id?: string;
    booking_id?: string | null;
    rating: number;          // 1..5
    comments?: string | null;
    submitted?: boolean;
    created_at?: string;
  }>;
};

export type HotelScorecard = {
  hotelId: string;
  overall: number | null;     // 0..100 or null (unrated)
  status: "unrated" | "developing" | "fair" | "good" | "excellent";
  badge: { emoji: string; label: string; color: string };
  checkpoints: CheckpointResult[];
  totalBookings: number;
  totalStayFeedback: number;
  totalComplaints: number;
  computedAt: string;
};

// ── helpers ────────────────────────────────────────────────────────────

function safeMinutes(a?: string, b?: string): number | null {
  if (!a || !b) return null;
  const ta = new Date(a).getTime();
  const tb = new Date(b).getTime();
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return null;
  return (tb - ta) / 60_000;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function statusFromPct(pct: number, hasData: boolean): CheckpointResult["status"] {
  if (!hasData) return "no_data";
  if (pct >= 85) return "excellent";
  if (pct >= 65) return "good";
  if (pct >= 40) return "fair";
  return "poor";
}

// ── checkpoint computers ──────────────────────────────────────────────

function computeBidSpeed(inputs: HotelScoreInputs): CheckpointResult {
  const weight = CHECKPOINT_WEIGHTS.bidSpeed;
  const acceptedOrCountered = inputs.bids.filter(
    (b) =>
      (b.status === "ACCEPTED" || b.status === "COUNTER") &&
      b.createdAt && b.updatedAt,
  );
  const samples = acceptedOrCountered
    .map((b) => safeMinutes(b.createdAt, b.updatedAt))
    .filter((m): m is number => m !== null && m >= 0);

  if (samples.length === 0) {
    return {
      key: "bidSpeed",
      label: "Bid Response Speed",
      emoji: "⚡",
      weight,
      earned: 0,
      pct: 0,
      evidence: "No bids responded to yet.",
      sampleSize: 0,
      status: "no_data",
    };
  }

  const avgMin = samples.reduce((a, b) => a + b, 0) / samples.length;
  let earned = 0;
  if (avgMin <= 5) earned = 15;
  else if (avgMin <= 15) earned = 12;
  else if (avgMin <= 30) earned = 9;
  else if (avgMin <= 60) earned = 6;
  else if (avgMin <= 180) earned = 3;
  else earned = 0;
  const pct = (earned / weight) * 100;

  const evidence = avgMin < 1
    ? "Responds in under a minute on average."
    : avgMin < 60
    ? `Avg response time: ${Math.round(avgMin)} min.`
    : `Avg response time: ${(avgMin / 60).toFixed(1)} hours.`;

  return {
    key: "bidSpeed",
    label: "Bid Response Speed",
    emoji: "⚡",
    weight,
    earned,
    pct,
    evidence,
    sampleSize: samples.length,
    status: statusFromPct(pct, true),
  };
}

function computeAcceptRate(inputs: HotelScoreInputs): CheckpointResult {
  const weight = CHECKPOINT_WEIGHTS.acceptRate;
  const decided = inputs.bids.filter((b) =>
    ["ACCEPTED", "REJECTED", "EXPIRED", "COUNTER"].includes(b.status),
  );
  if (decided.length === 0) {
    return {
      key: "acceptRate",
      label: "Bid Acceptance Rate",
      emoji: "🤝",
      weight,
      earned: 0,
      pct: 0,
      evidence: "No bids decided yet.",
      sampleSize: 0,
      status: "no_data",
    };
  }
  const accepted = decided.filter((b) => b.status === "ACCEPTED").length;
  const rate = accepted / decided.length;
  const earned = +(rate * weight).toFixed(2);
  return {
    key: "acceptRate",
    label: "Bid Acceptance Rate",
    emoji: "🤝",
    weight,
    earned,
    pct: rate * 100,
    evidence: `${accepted} of ${decided.length} bids accepted (${Math.round(rate * 100)}%).`,
    sampleSize: decided.length,
    status: statusFromPct(rate * 100, true),
  };
}

// v128.2 — Customer star reviews (out of 5) from feedback_tracking.
// This is the public signal customers trust most — explicitly user-asked.
// Scoring: linear (avgRating / 5) × weight. 4.0 avg → 80% of weight.
// Auto-flagged in the modal as a CLICKABLE checkpoint that opens the
// drill-down review list.
function computeStarRating(inputs: HotelScoreInputs): CheckpointResult {
  const weight = CHECKPOINT_WEIGHTS.starRating;
  const reviews = (inputs.reviews || []).filter(
    (r) =>
      r &&
      typeof r.rating === "number" &&
      r.rating >= 1 &&
      r.rating <= 5 &&
      (r.submitted === undefined || r.submitted === true),
  );
  if (reviews.length === 0) {
    return {
      key: "starRating",
      label: "Customer Reviews",
      emoji: "⭐",
      weight,
      earned: weight * 0.6, // baseline credit — no reviews yet
      pct: 60,
      evidence: "Awaiting first customer rating.",
      sampleSize: 0,
      status: "no_data",
    };
  }
  const avg = reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length;
  const ratio = avg / 5;
  const earned = +(ratio * weight).toFixed(2);
  const pct = ratio * 100;
  return {
    key: "starRating",
    label: "Customer Reviews",
    emoji: "⭐",
    weight,
    earned,
    pct,
    evidence: `${reviews.length} review${
      reviews.length === 1 ? "" : "s"
    } · avg ${avg.toFixed(1)} of 5 — tap to read every review.`,
    sampleSize: reviews.length,
    status: statusFromPct(pct, true),
  };
}

function computeRoomReady(inputs: HotelScoreInputs): CheckpointResult {
  const weight = CHECKPOINT_WEIGHTS.roomReady;
  const bookings = inputs.bookingsWithDates || [];
  // Heuristic: scan booking_messages for hotel-sender mentioning
  // "ready" / "room is ready" / "checked you in early" near checkIn time.
  const msgs = inputs.bookingMessages || [];
  const readyMsgs = msgs.filter(
    (m) =>
      m.sender === "hotel" &&
      typeof m.body === "string" &&
      /\b(ready|prepared|check.in early|early check)\b/i.test(m.body),
  );

  if (bookings.length === 0 || msgs.length === 0) {
    return {
      key: "roomReady",
      label: "Room Ready Timeliness",
      emoji: "🛏️",
      weight,
      earned: weight * 0.6,
      pct: 60,
      evidence: "Awaiting room-ready signals.",
      sampleSize: 0,
      status: "no_data",
    };
  }

  // Map each ready msg → matching booking checkIn delta in minutes
  const deltas: number[] = [];
  for (const m of readyMsgs) {
    const b = bookings.find((x) => x.bidId === m.bid_id);
    if (!b?.checkIn) continue;
    const d = safeMinutes(m.created_at, b.checkIn);
    if (d == null) continue;
    deltas.push(d); // positive = msg sent before checkin (early), negative = after
  }
  if (deltas.length === 0) {
    return {
      key: "roomReady",
      label: "Room Ready Timeliness",
      emoji: "🛏️",
      weight,
      earned: weight * 0.55,
      pct: 55,
      evidence: "No matched room-ready events.",
      sampleSize: 0,
      status: "no_data",
    };
  }
  const avg = deltas.reduce((a, b) => a + b, 0) / deltas.length;
  // avg > 0 → ready EARLY by `avg` min (msg sent before checkin)
  // avg < 0 → ready LATE
  let earned = 0;
  if (avg >= 0) earned = 5;
  else if (avg >= -30) earned = 4;
  else if (avg >= -90) earned = 2;
  else earned = 0;
  const evidence = avg >= 0
    ? `Rooms ready ~${Math.round(avg)} min before check-in on average.`
    : `Rooms ~${Math.round(-avg)} min late on average.`;
  const pct = (earned / weight) * 100;
  return {
    key: "roomReady",
    label: "Room Ready Timeliness",
    emoji: "🛏️",
    weight,
    earned,
    pct,
    evidence,
    sampleSize: deltas.length,
    status: statusFromPct(pct, true),
  };
}

function computeCheckInOut(inputs: HotelScoreInputs): CheckpointResult {
  const weight = CHECKPOINT_WEIGHTS.checkInOut;
  const bookings = inputs.bookingsWithDates || [];
  if (bookings.length === 0) {
    return {
      key: "checkInOut",
      label: "Check-in & Check-out",
      emoji: "🗝️",
      weight,
      earned: weight * 0.6,
      pct: 60,
      evidence: "No completed stays yet.",
      sampleSize: 0,
      status: "no_data",
    };
  }
  let onTime = 0;
  let trackable = 0;
  for (const b of bookings) {
    if (!b.checkIn) continue;
    if (b.status === "CHECKED_IN" || b.status === "CHECKED_OUT") {
      trackable++;
      // we don't have explicit checkedInAt timestamp — accept presence as on-time
      // unless we have checkedInAt and it's wildly off
      if (b.checkedInAt && b.checkIn) {
        const drift = safeMinutes(b.checkIn, b.checkedInAt);
        if (drift != null && Math.abs(drift) <= 360) onTime++; // within 6h
      } else {
        onTime++; // status flipped, no further drift data — assume on-time
      }
    }
  }
  if (trackable === 0) {
    return {
      key: "checkInOut",
      label: "Check-in & Check-out",
      emoji: "🗝️",
      weight,
      earned: weight * 0.6,
      pct: 60,
      evidence: "No check-in events tracked yet.",
      sampleSize: 0,
      status: "no_data",
    };
  }
  const rate = onTime / trackable;
  const earned = +(rate * weight).toFixed(2);
  return {
    key: "checkInOut",
    label: "Check-in & Check-out",
    emoji: "🗝️",
    weight,
    earned,
    pct: rate * 100,
    evidence: `${onTime} of ${trackable} check-ins handled on time.`,
    sampleSize: trackable,
    status: statusFromPct(rate * 100, true),
  };
}

function computeVerifVideo(inputs: HotelScoreInputs): CheckpointResult {
  const weight = CHECKPOINT_WEIGHTS.verifVideo;
  const reqs = inputs.vpRequests || [];
  const vids = inputs.vpVideos || [];
  if (reqs.length === 0) {
    return {
      key: "verifVideo",
      label: "Verification Video Health",
      emoji: "🎥",
      weight,
      earned: weight * 0.6,
      pct: 60,
      evidence: "Verification not yet requested.",
      sampleSize: 0,
      status: "no_data",
    };
  }
  const linkedReqs = reqs.filter((r) => !!r.hotel_video_id).length;
  const linkRate = linkedReqs / reqs.length;
  const approvedVids = vids.filter((v) => v.status === "approved").length;
  const approveRate = vids.length > 0 ? approvedVids / vids.length : 0;

  // Half on link rate, half on approval rate.
  const earned = +((linkRate * 5) + (approveRate * 5)).toFixed(2);
  const pct = (earned / weight) * 100;
  return {
    key: "verifVideo",
    label: "Verification Video Health",
    emoji: "🎥",
    weight,
    earned,
    pct,
    evidence: `${linkedReqs} of ${reqs.length} requests fulfilled${
      vids.length > 0 ? `, ${approvedVids}/${vids.length} approved` : ""
    }.`,
    sampleSize: reqs.length,
    status: statusFromPct(pct, true),
  };
}

const SMILEY_KEYS = ["roomMatch", "staff", "hygiene", "food", "staffResponse"] as const;

export function smileyToScore(v: any, autoFilled: boolean): number | null {
  if (v === "positive") return autoFilled ? 75 : 100; // soft-positive on auto
  if (v === "neutral") return 50;
  if (v === "negative") return 0;
  return null;
}

function computeStaySmiley(inputs: HotelScoreInputs): CheckpointResult {
  const weight = CHECKPOINT_WEIGHTS.staySmiley;
  const rows = inputs.complaints.filter(
    (c) =>
      c.feedbackType === "stay_feedback" &&
      c.feedback &&
      typeof c.feedback === "object",
  );
  if (rows.length === 0) {
    return {
      key: "staySmiley",
      label: "Guest Stay Feedback",
      emoji: "😊",
      weight,
      earned: weight * 0.6,
      pct: 60,
      evidence: "No guest feedback collected yet.",
      sampleSize: 0,
      status: "no_data",
    };
  }
  let sum = 0;
  let n = 0;
  let posCount = 0;
  let negCount = 0;
  for (const r of rows) {
    const auto = !!r.feedbackAutoFilled;
    const f = r.feedback || {};
    for (const k of SMILEY_KEYS) {
      const s = smileyToScore(f[k], auto);
      if (s == null) continue;
      sum += s;
      n++;
      if (f[k] === "positive") posCount++;
      else if (f[k] === "negative") negCount++;
    }
  }
  if (n === 0) {
    return {
      key: "staySmiley",
      label: "Guest Stay Feedback",
      emoji: "😊",
      weight,
      earned: weight * 0.6,
      pct: 60,
      evidence: "Feedback rows lacked smiley data.",
      sampleSize: 0,
      status: "no_data",
    };
  }
  const avgScore = sum / n; // 0..100
  const earned = +((avgScore / 100) * weight).toFixed(2);
  return {
    key: "staySmiley",
    label: "Guest Stay Feedback",
    emoji: "😊",
    weight,
    earned,
    pct: avgScore,
    evidence: `${rows.length} guest${rows.length === 1 ? "" : "s"} rated — ${Math.round(
      (posCount / n) * 100,
    )}% positive checkpoints${negCount > 0 ? `, ${negCount} negative` : ""} — tap to view every checkpoint.`,
    sampleSize: rows.length,
    status: statusFromPct(avgScore, true),
  };
}

function computeComplaintRate(inputs: HotelScoreInputs): CheckpointResult {
  const weight = CHECKPOINT_WEIGHTS.complaintRate;
  const totalBookings = (inputs.bookingsWithDates || []).length;
  const generalComplaints = inputs.complaints.filter(
    (c) => c.feedbackType !== "stay_feedback",
  );
  if (totalBookings === 0) {
    return {
      key: "complaintRate",
      label: "Complaint Rate",
      emoji: "🛟",
      weight,
      earned: weight * 0.7,
      pct: 70,
      evidence: "No bookings yet.",
      sampleSize: 0,
      status: "no_data",
    };
  }
  const rate = generalComplaints.length / totalBookings;
  let earned = 0;
  if (rate <= 0.001) earned = 10;
  else if (rate <= 0.05) earned = 8 - (rate / 0.05) * 1; // 7 → 8
  else if (rate <= 0.10) earned = 6 - ((rate - 0.05) / 0.05) * 2; // 4-6
  else if (rate <= 0.20) earned = 3 - ((rate - 0.10) / 0.10) * 2; // 1-3
  else if (rate <= 0.30) earned = 1;
  else earned = 0;
  earned = +earned.toFixed(2);
  const pct = (earned / weight) * 100;
  return {
    key: "complaintRate",
    label: "Complaint Rate",
    emoji: "🛟",
    weight,
    earned,
    pct,
    evidence:
      generalComplaints.length === 0
        ? `Zero complaints across ${totalBookings} bookings.`
        : `${generalComplaints.length} complaint${
            generalComplaints.length === 1 ? "" : "s"
          } across ${totalBookings} bookings (${Math.round(rate * 1000) / 10}%).`,
    sampleSize: totalBookings,
    status: statusFromPct(pct, true),
  };
}

function computeResolution(inputs: HotelScoreInputs): CheckpointResult {
  const weight = CHECKPOINT_WEIGHTS.resolution;
  const generalComplaints = inputs.complaints.filter(
    (c) => c.feedbackType !== "stay_feedback",
  );
  if (generalComplaints.length === 0) {
    return {
      key: "resolution",
      label: "Complaint Resolution",
      emoji: "✅",
      weight,
      earned: weight,
      pct: 100,
      evidence: "No complaints to resolve.",
      sampleSize: 0,
      status: "excellent",
    };
  }
  let weightedSum = 0;
  let resolvedCount = 0;
  for (const c of generalComplaints) {
    const isResolved = c.status === "resolved";
    if (!isResolved) continue;
    resolvedCount++;
    if (!c.createdAt || !c.resolvedAt) {
      weightedSum += 0.5; // resolved but no timestamps — half credit
      continue;
    }
    const hours = (safeMinutes(c.createdAt, c.resolvedAt) || 0) / 60;
    if (hours <= 24) weightedSum += 1.0;
    else if (hours <= 48) weightedSum += 0.75;
    else if (hours <= 168) weightedSum += 0.5;
    else weightedSum += 0.25;
  }
  const effective = weightedSum / generalComplaints.length;
  const earned = +(effective * weight).toFixed(2);
  const pct = effective * 100;
  return {
    key: "resolution",
    label: "Complaint Resolution",
    emoji: "✅",
    weight,
    earned,
    pct,
    evidence: `${resolvedCount} of ${generalComplaints.length} complaints resolved${
      resolvedCount > 0 ? " (time-weighted)" : ""
    }.`,
    sampleSize: generalComplaints.length,
    status: statusFromPct(pct, true),
  };
}

function computeVolume(inputs: HotelScoreInputs): CheckpointResult {
  const weight = CHECKPOINT_WEIGHTS.volume;
  const total = (inputs.bookingsWithDates || []).length;
  let earned = 0;
  if (total >= 100) earned = 5;
  else if (total >= 50) earned = 4;
  else if (total >= 20) earned = 3;
  else if (total >= 5) earned = 2;
  else if (total >= 1) earned = 1;
  const pct = (earned / weight) * 100;
  return {
    key: "volume",
    label: "Booking Volume",
    emoji: "📈",
    weight,
    earned,
    pct,
    evidence:
      total === 0
        ? "No completed bookings yet."
        : `${total} booking${total === 1 ? "" : "s"} fulfilled on StayBid.`,
    sampleSize: total,
    status: statusFromPct(pct, total > 0),
  };
}

// ── orchestrator ──────────────────────────────────────────────────────

export function computeHotelScore(inputs: HotelScoreInputs): HotelScorecard {
  const checkpoints: CheckpointResult[] = [
    computeBidSpeed(inputs),
    computeAcceptRate(inputs),
    computeRoomReady(inputs),
    computeCheckInOut(inputs),
    computeVerifVideo(inputs),
    computeStaySmiley(inputs),
    computeStarRating(inputs),    // v128.2 — replaces counterConversion
    computeComplaintRate(inputs),
    computeResolution(inputs),
    computeVolume(inputs),
  ];

  const totalSamples = checkpoints.reduce((a, c) => a + c.sampleSize, 0);
  // Unrated rule: hotel has had ZERO interaction across every signal.
  if (totalSamples === 0 && (inputs.bookingsWithDates || []).length === 0) {
    return {
      hotelId: inputs.hotelId,
      overall: null,
      status: "unrated",
      badge: { emoji: "✨", label: "New on StayBid", color: "#C9A66B" },
      checkpoints,
      totalBookings: 0,
      totalStayFeedback: 0,
      totalComplaints: 0,
      computedAt: new Date().toISOString(),
    };
  }

  const earned = checkpoints.reduce((a, c) => a + c.earned, 0);
  const overall = +clamp(earned, 0, 100).toFixed(1);
  const badge = badgeForScore(overall);
  const status = statusForScore(overall);

  const totalStayFeedback = inputs.complaints.filter(
    (c) => c.feedbackType === "stay_feedback",
  ).length;
  const totalComplaints = inputs.complaints.filter(
    (c) => c.feedbackType !== "stay_feedback",
  ).length;

  return {
    hotelId: inputs.hotelId,
    overall,
    status,
    badge,
    checkpoints,
    totalBookings: (inputs.bookingsWithDates || []).length,
    totalStayFeedback,
    totalComplaints,
    computedAt: new Date().toISOString(),
  };
}

export function badgeForScore(s: number): { emoji: string; label: string; color: string } {
  if (s >= 90) return { emoji: "👑", label: "Elite", color: "#C9A66B" };
  if (s >= 80) return { emoji: "💎", label: "Exceptional", color: "#7F9269" };
  if (s >= 70) return { emoji: "⭐", label: "Excellent", color: "#7F9269" };
  if (s >= 60) return { emoji: "✨", label: "Good", color: "#D9BE82" };
  if (s >= 45) return { emoji: "○", label: "Developing", color: "#D49583" };
  return { emoji: "△", label: "Needs Care", color: "#D49583" };
}

export function statusForScore(s: number): HotelScorecard["status"] {
  if (s >= 80) return "excellent";
  if (s >= 65) return "good";
  if (s >= 45) return "fair";
  if (s > 0) return "developing";
  return "developing";
}

// ── Market-Fit baseline (v549) ─────────────────────────────────────────
// A property with NO operational data yet (no bids/stays/feedback) used to
// return overall=null → "New · awaiting score", a weak launch impression.
// Instead we compute a deterministic MARKET-FIT score from the property's OWN
// public signals that already exist on day one — guest rating (confidence-
// weighted), review popularity, property class, and listing completeness.
// This is additive: it NEVER touches the operational CHECKPOINT_WEIGHTS above.
// As real bids/stays/feedback accrue, the operational engine takes over
// naturally (the scorecard route uses market-fit ONLY when operational data
// is absent). Deterministic + pure → same inputs, same score, every time.
export type MarketFitInputs = {
  hotelId: string;
  starRating?: number | null;   // property class 1..5
  avgRating?: number | null;    // guest rating 0..5
  totalReviews?: number | null; // review count (popularity/confidence)
  imagesCount?: number | null;
  amenitiesCount?: number | null;
  hasDescription?: boolean;
};

// Weights sum to 100. Guest rating leads (it is the signal guests trust most),
// then popularity (review volume), property class, and listing completeness.
const MF = { guest: 46, popularity: 12, cls: 22, listing: 20 } as const;
const MF_FLOOR = 64; // no live property ever reads below "Good" at launch

function mfGuest(avgRating?: number | null, reviews?: number | null): number {
  const r = clamp(Number(avgRating) || 0, 0, 5);
  const n = Math.max(0, Number(reviews) || 0);
  // Bayesian shrink toward a 4.0 prior (weight 8 reviews) so a 5.0 with 2
  // reviews can't outrank a 4.6 with 120.
  const PRIOR = 4.0, PRIOR_W = 8;
  const bayes = n > 0 ? (r * n + PRIOR * PRIOR_W) / (n + PRIOR_W) : PRIOR;
  return clamp(bayes / 5, 0, 1); // 0..1
}
function mfPopularity(reviews?: number | null): number {
  const n = Math.max(0, Number(reviews) || 0);
  // log-scaled: ~200 reviews → full credit.
  return clamp(Math.log10(n + 1) / Math.log10(200), 0, 1); // 0..1
}
function mfClass(starRating?: number | null): number {
  return clamp((Number(starRating) || 3) / 5, 0, 1); // 0..1 (default 3★)
}
function mfListing(a: MarketFitInputs): number {
  const imgs = Number(a.imagesCount) || 0;
  const amen = Number(a.amenitiesCount) || 0;
  const pts = (imgs >= 3 ? 7 : imgs >= 1 ? 4 : 0)
    + (amen >= 5 ? 5 : amen >= 2 ? 3 : 0)
    + (a.hasDescription ? 3 : 0);
  return clamp(pts / 15, 0, 1); // 0..1
}

/** Deterministic 0-100 market-fit score from a property's intrinsic signals. */
export function computeMarketFitScore(a: MarketFitInputs): number {
  const raw =
    mfGuest(a.avgRating, a.totalReviews) * MF.guest +
    mfPopularity(a.totalReviews) * MF.popularity +
    mfClass(a.starRating) * MF.cls +
    mfListing(a) * MF.listing;
  return +clamp(Math.max(raw, MF_FLOOR), 0, 100).toFixed(1);
}

/** A full HotelScorecard built from the market-fit signals (checkpoints show
 *  the real evidence so the drill-down modal is coherent, not "awaiting"). */
export function buildMarketFitCard(a: MarketFitInputs): HotelScorecard {
  const overall = computeMarketFitScore(a);
  const reviews = Math.max(0, Number(a.totalReviews) || 0);
  const rating = clamp(Number(a.avgRating) || 0, 0, 5);
  const cls = Number(a.starRating) || 0;
  const imgs = Number(a.imagesCount) || 0;
  const amen = Number(a.amenitiesCount) || 0;
  const mk = (
    key: string, label: string, emoji: string, weight: number,
    frac: number, evidence: string, sampleSize: number,
  ): CheckpointResult => {
    const pct = +(clamp(frac, 0, 1) * 100).toFixed(1);
    return {
      key: key as CheckpointKey,
      label, emoji, weight,
      earned: +(clamp(frac, 0, 1) * weight).toFixed(2),
      pct, evidence, sampleSize,
      status: statusFromPct(pct, sampleSize > 0),
    };
  };
  const checkpoints: CheckpointResult[] = [
    mk("mfGuest", "Guest Rating", "⭐", MF.guest, mfGuest(a.avgRating, a.totalReviews),
      reviews > 0
        ? `${rating.toFixed(1)} of 5 across ${reviews} review${reviews === 1 ? "" : "s"}.`
        : "Market-fit estimate — awaiting the first guest rating.",
      reviews),
    mk("mfPopularity", "Guest Demand", "🔥", MF.popularity, mfPopularity(a.totalReviews),
      reviews > 0 ? `${reviews} guest review${reviews === 1 ? "" : "s"} on record.` : "Newly listed.",
      reviews),
    mk("mfClass", "Property Class", "🏛️", MF.cls, mfClass(a.starRating),
      cls ? `${cls}-star property class.` : "Standard property class.", cls ? 1 : 0),
    mk("mfListing", "Listing Quality", "📸", MF.listing, mfListing(a),
      `${imgs} photo${imgs === 1 ? "" : "s"}, ${amen} amenit${amen === 1 ? "y" : "ies"}${a.hasDescription ? ", full description" : ""}.`,
      imgs + amen),
  ];
  return {
    hotelId: a.hotelId,
    overall,
    status: statusForScore(overall),
    badge: badgeForScore(overall),
    checkpoints,
    totalBookings: 0,
    totalStayFeedback: 0,
    totalComplaints: 0,
    computedAt: new Date().toISOString(),
  };
}

// Compute deterministic rank within a city given a precomputed list.
export function rankWithinCity(
  scores: Array<{ hotelId: string; overall: number | null }>,
  hotelId: string,
): { rank: number | null; total: number; percentile: number | null } {
  const rated = scores.filter(
    (s): s is { hotelId: string; overall: number } => s.overall !== null,
  );
  rated.sort((a, b) => b.overall - a.overall);
  const idx = rated.findIndex((s) => s.hotelId === hotelId);
  if (idx === -1) return { rank: null, total: rated.length, percentile: null };
  const rank = idx + 1;
  const percentile = rated.length > 1
    ? +(((rated.length - rank) / (rated.length - 1)) * 100).toFixed(1)
    : 100;
  return { rank, total: rated.length, percentile };
}
