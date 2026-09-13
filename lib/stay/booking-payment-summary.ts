// STAY-LIFECYCLE-OPS-01 — booking VALUE vs payment RECEIVED (pure, display-only).
//
// A booking's value (rate × nights × rooms) is NOT revenue received. Revenue /
// amount paid comes only from RECORDED payment data — the server-recorded
// bid_paid_amounts row the partner read model already side-loads (paidTotal /
// razorpayPaymentId) or the Razorpay marker on the bid message. Nothing is ever
// fabricated from the bid amount. NOTE: these recorded markers are a DISPLAY
// signal (the SEC-00B contract documents they are client-writable); they are
// never a security authority and are labelled as "recorded", never "verified".
export type PaymentState = "recorded_online" | "not_recorded";

export type BookingPaymentSummary = {
  /** rate × nights × rooms — what the stay is worth, NOT money received */
  bookingValue: number;
  /** amount actually RECORDED as paid online, or null when none is on file */
  paidRecorded: number | null;
  paymentState: PaymentState;
  /** short human label for the payment row */
  paymentLabel: string;
};

const ONLINE_MARKER = /Razorpay:|razorpay_payment_id/;

export function bookingPaymentSummary(input: {
  ratePerNight: number;
  nights: number;
  rooms: number;
  paidTotal?: number | null;
  razorpayPaymentId?: string | null;
  message?: string | null;
}): BookingPaymentSummary {
  const rate = Number(input.ratePerNight) || 0;
  const nights = Math.max(1, Number(input.nights) || 1);
  const rooms = Math.max(1, Number(input.rooms) || 1);
  const bookingValue = rate * nights * rooms;
  const pt = Number(input.paidTotal);
  const paidRecorded = Number.isFinite(pt) && pt > 0 ? pt : null;
  const marker = !!(input.razorpayPaymentId && String(input.razorpayPaymentId).trim()) || ONLINE_MARKER.test(String(input.message || ""));
  const paymentState: PaymentState = paidRecorded != null || marker ? "recorded_online" : "not_recorded";
  const paymentLabel =
    paymentState === "not_recorded"
      ? "No online payment recorded · collect at hotel / pending"
      : paidRecorded != null
        ? "Online payment recorded"
        : "Online payment recorded · amount not on file";
  return { bookingValue, paidRecorded, paymentState, paymentLabel };
}
