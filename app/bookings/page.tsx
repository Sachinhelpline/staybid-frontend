"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { CountUp } from "@/components/CountUp";
import { resolvePaidAmount, fetchServerPaid } from "@/lib/paid-amount";
import {
  readHoldState, removeHoldState, formatHoldCountdown, isHoldExpired,
  hydrateHoldsFromServer,
  type HoldState,
} from "@/lib/hold-amount";
import { openRazorpayCheckout } from "@/lib/razorpay";
import BookingChat from "@/components/BookingChat";
import ModalCloseButton from "@/components/ModalCloseButton";

const statusStyle: Record<string, { bg: string; text: string; border: string; label: string; dot: string }> = {
  PENDING:    { bg: "bg-amber-50",   text: "text-amber-700",   border: "border-amber-200",   label: "Pending",    dot: "bg-amber-400"   },
  CONFIRMED:  { bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200", label: "Confirmed",  dot: "bg-emerald-400" },
  ACCEPTED:   { bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200", label: "Confirmed",  dot: "bg-emerald-400" },
  CHECKED_IN: { bg: "bg-blue-50",    text: "text-blue-700",    border: "border-blue-200",    label: "Checked In", dot: "bg-blue-400"    },
  CHECKED_OUT:{ bg: "bg-luxury-50",  text: "text-luxury-600",  border: "border-luxury-200",  label: "Checked Out",dot: "bg-luxury-400"  },
  CANCELLED:  { bg: "bg-red-50",     text: "text-red-600",     border: "border-red-200",     label: "Cancelled",  dot: "bg-red-400"     },
};

// ── Hold banner ────────────────────────────────────────────────────────
// Surfaces a 24h countdown + Pay Balance button for held bookings.
function HoldBanner({ bidId, onPaid }: { bidId: string; onPaid: () => void }) {
  const [state, setState] = useState<HoldState | null>(() => readHoldState(bidId));
  const [tick, setTick] = useState(0);
  const [paying, setPaying] = useState(false);

  // 1-second tick to keep the countdown fresh
  useEffect(() => {
    if (!state || state.status !== "active") return;
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [state]);

  // Hide if no hold, completed, or unrelated
  if (!state || state.status !== "active") return null;
  if (state.payAtHotel) {
    // Pay-at-hotel: no countdown, just info banner — balance settled at desk
    return (
      <div className="mb-4 rounded-2xl p-4 border bg-gradient-to-br from-amber-50 to-gold-50"
        style={{ borderColor: "rgba(240,180,41,0.45)" }}>
        <div className="flex items-start gap-3">
          <span className="text-xl">🏨</span>
          <div className="flex-1">
            <p className="text-sm font-bold text-luxury-900">Pay at Hotel · Balance ₹{state.balanceDue.toLocaleString()}</p>
            <p className="text-[0.7rem] text-luxury-600 leading-relaxed mt-0.5">
              You've paid <span className="font-bold">₹{state.holdAmount.toLocaleString()}</span> to lock this booking.
              Settle the remaining <span className="font-bold">₹{state.balanceDue.toLocaleString()}</span> at the hotel desk.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const expired = isHoldExpired(state.expiresAt);
  const countdown = formatHoldCountdown(state.expiresAt);
  // Re-suppress the unused-var warning around tick
  void tick;

  const payBalance = async () => {
    if (paying) return;
    setPaying(true);
    try {
      const result = await openRazorpayCheckout({
        amount: state.balanceDue,
        hotelName: state.hotelName,
        description: `Balance for ${state.hotelName} · ${state.roomType || "Room"}`,
      });
      // Record balance payment server-side (paid amount log)
      try {
        await fetch("/api/bid/paid", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            bidId: state.bidId, hotelId: state.hotelId,
            paidTotal: state.totalAmount, // full total now settled
            flow: "hold-balance",
            razorpayPaymentId: result.razorpay_payment_id,
          }),
        });
      } catch {}
      // Mark hold completed server-side so admin sees it cleared
      try {
        const token = localStorage.getItem("sb_token");
        await fetch(`/api/holds/${state.bidId}/balance`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ balancePaymentId: result.razorpay_payment_id }),
        });
      } catch {}
      // Update local hold state (kept for audit on this device)
      const updated: HoldState = { ...state, balancePaymentId: result.razorpay_payment_id, status: "completed" };
      try { localStorage.setItem("hold_state_" + state.bidId, JSON.stringify(updated)); } catch {}
      setState(updated);
      onPaid();
    } catch (e: any) {
      if (e?.message !== "__CANCELLED__") alert(e.message || "Payment failed");
    } finally {
      setPaying(false);
    }
  };

  if (expired) {
    return (
      <div className="mb-4 rounded-2xl p-4 border bg-red-50 border-red-200">
        <p className="text-sm font-bold text-red-700">⏰ Hold expired</p>
        <p className="text-[0.7rem] text-red-600 mt-0.5">
          Your ₹{state.holdAmount.toLocaleString()} hold for ₹{state.totalAmount.toLocaleString()} has expired.
          Contact the hotel to re-confirm at current rates.
        </p>
        <button onClick={() => { removeHoldState(state.bidId); onPaid(); }}
          className="mt-2 text-[0.7rem] font-semibold text-red-600 underline">Dismiss</button>
      </div>
    );
  }

  return (
    <div className="mb-4 rounded-2xl p-4 border-2 bg-gradient-to-br from-emerald-50 to-gold-50"
      style={{ borderColor: "rgba(16,185,129,0.4)" }}>
      <div className="flex items-start gap-3 mb-3">
        <span className="text-2xl">🔒</span>
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-0.5">
            <p className="text-sm font-bold text-emerald-700">Price locked — pay balance to confirm</p>
            <span className="text-[0.55rem] font-bold tracking-wider uppercase bg-emerald-500 text-white px-2 py-0.5 rounded-full">{countdown}</span>
          </div>
          <p className="text-[0.7rem] text-luxury-600 leading-relaxed">
            You've paid <span className="font-bold">₹{state.holdAmount.toLocaleString()}</span>.
            Balance <span className="font-bold text-luxury-900">₹{state.balanceDue.toLocaleString()}</span> due before lock expires.
          </p>
        </div>
      </div>
      <button onClick={payBalance} disabled={paying}
        className="w-full py-3 rounded-xl font-bold text-sm tracking-wide disabled:opacity-40 transition-transform active:scale-[0.99]"
        style={{
          background: "linear-gradient(135deg,#10b981 0%,#34d399 50%,#10b981 100%)",
          color: "#022c22",
          boxShadow: "0 6px 18px rgba(16,185,129,0.35)",
        }}>
        {paying ? "⏳ Opening Razorpay…" : `✅ Pay Balance ₹${state.balanceDue.toLocaleString()} & Confirm`}
      </button>
    </div>
  );
}

function Barcode({ id }: { id: string }) {
  const seed = (id || "STAYBID").toUpperCase();
  const bars: { w: number; h: number }[] = [];
  for (let i = 0; i < seed.length * 3; i++) {
    const c = seed.charCodeAt(i % seed.length);
    bars.push({ w: (c + i) % 3 === 0 ? 3 : 1, h: 50 + ((c * (i + 1)) % 50) });
  }
  return (
    <div className="flex items-end gap-[1.5px] h-10 overflow-hidden">
      {bars.map((b, i) => (
        <div
          key={i}
          style={{ width: b.w, height: `${b.h}%` }}
          className="bg-luxury-700 rounded-[1px] shrink-0"
        />
      ))}
    </div>
  );
}

// ── Rate-your-stay banner (v98) ────────────────────────────────────────
// Shown on CHECKED_OUT bookings. Calls /api/feedback/submit which already
// existed since Session 5 but had NO customer UI calling it — feedback
// table was permanently empty in prod until v98.
function RateStayBanner({ bidId, hotelName, stayPoints }: { bidId: string; hotelName: string; stayPoints: number }) {
  const [state, setState] = useState<{ submitted: boolean; rating?: number; comments?: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(5);
  const [hover, setHover] = useState(0);
  const [comments, setComments] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.getFeedbackState(bidId)
      .then((d: any) => {
        if (d?.feedback?.submitted) {
          setState({ submitted: true, rating: d.feedback.rating, comments: d.feedback.comments });
        } else {
          setState({ submitted: false });
        }
      })
      .catch(() => setState({ submitted: false }))
      .finally(() => setLoading(false));
  }, [bidId]);

  async function submit() {
    setErr(null);
    if (!rating) { setErr("Please pick a rating."); return; }
    setSubmitting(true);
    try {
      // The feedback table is keyed on booking_id; in this app the same
      // identifier doubles as the bid id for entries that came in via the
      // bid-accept flow (see /api/feedback/submit). Either way, b.id is
      // the canonical key here.
      await api.submitFeedback({ bookingId: bidId, rating, comments: comments.trim() || undefined });
      setState({ submitted: true, rating, comments: comments.trim() });
      setOpen(false);
    } catch (e: any) {
      setErr(e?.message || "Failed to submit");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return null;

  if (state?.submitted) {
    return (
      <div className="mb-4 rounded-2xl p-3 bg-emerald-50 border border-emerald-200 flex items-center gap-3">
        <span className="text-lg">✅</span>
        <div className="flex-1">
          <p className="text-xs font-bold text-emerald-800">Thanks for your feedback</p>
          <p className="text-[0.65rem] text-emerald-700">
            {Array.from({ length: 5 }).map((_, i) => i < (state.rating || 0) ? "★" : "☆").join("")}
            {state.comments ? ` · "${state.comments.slice(0, 60)}${state.comments.length > 60 ? "…" : ""}"` : ""}
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="w-full mb-4 rounded-2xl p-4 bg-gradient-to-br from-gold-50 to-amber-50 border border-gold-200 hover:shadow-gold transition text-left"
      >
        <div className="flex items-center gap-3">
          <span className="text-2xl">⭐</span>
          <div className="flex-1">
            <p className="text-sm font-bold text-luxury-900">Rate your stay at {hotelName}</p>
            <p className="text-[0.7rem] text-luxury-600">
              Share feedback and earn <strong>+100 StayPoints</strong> on top of your {stayPoints} cashback points
            </p>
          </div>
          <span className="text-gold-600 text-sm font-bold">Rate →</span>
        </div>
      </button>

      {open && (
        <div
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-[1000] bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white w-full sm:max-w-md sm:rounded-3xl rounded-t-3xl max-h-[92vh] overflow-y-auto"
          >
            <div className="px-5 py-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-display text-xl text-luxury-900">How was {hotelName}?</div>
                  <p className="text-xs text-luxury-500 mt-0.5">Your feedback helps thousands of travellers</p>
                </div>
                <ModalCloseButton onClose={() => setOpen(false)} tone="light" />
              </div>

              {/* Star rating */}
              <div className="flex justify-center gap-1 my-5">
                {[1, 2, 3, 4, 5].map((n) => {
                  const lit = (hover || rating) >= n;
                  return (
                    <button
                      key={n}
                      type="button"
                      onMouseEnter={() => setHover(n)}
                      onMouseLeave={() => setHover(0)}
                      onClick={() => setRating(n)}
                      className={`text-4xl transition-transform ${lit ? "scale-110" : "scale-100"}`}
                      style={{ color: lit ? "#f0b429" : "#e5e0d0" }}
                      aria-label={`${n} star${n > 1 ? "s" : ""}`}
                    >
                      ★
                    </button>
                  );
                })}
              </div>
              <p className="text-center text-xs text-luxury-500 -mt-3 mb-4">
                {rating === 5 ? "Loved it" : rating === 4 ? "Great" : rating === 3 ? "It was okay" : rating === 2 ? "Below expectations" : "Disappointing"}
              </p>

              <label className="text-[10px] font-bold uppercase tracking-wider text-luxury-500 mb-2 block">
                Comments <span className="text-luxury-400 font-normal lowercase">(optional)</span>
              </label>
              <textarea
                value={comments}
                onChange={(e) => setComments(e.target.value.slice(0, 1000))}
                rows={4}
                placeholder="What stood out? What could be better?"
                className="input-luxury w-full resize-none"
                maxLength={1000}
              />
              <div className="text-[10px] text-luxury-400 mt-1 text-right">{comments.length}/1000</div>

              {err && (
                <div className="rounded-xl bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700 mt-3">{err}</div>
              )}

              <div className="flex gap-2 mt-4">
                <button
                  onClick={() => setOpen(false)}
                  disabled={submitting}
                  className="flex-1 px-4 py-2.5 rounded-xl border border-luxury-200 text-luxury-700 font-semibold text-sm hover:bg-luxury-50 transition disabled:opacity-50"
                >
                  Later
                </button>
                <button
                  onClick={submit}
                  disabled={submitting}
                  className="flex-[2] btn-luxury text-sm py-2.5 disabled:opacity-60"
                >
                  {submitting ? "Submitting…" : "Submit & earn 100 points"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function BookingCard({ b, unitNumber, onRefresh }: { b: any; unitNumber?: string; onRefresh: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const st = statusStyle[b.status] || { bg: "bg-luxury-50", text: "text-luxury-600", border: "border-luxury-100", label: b.status, dot: "bg-luxury-400" };

  const bookingId = b.id?.slice(0, 8).toUpperCase() || "STAYBID1";

  // Try all possible date paths from backend, then localStorage fallback
  const stored = typeof window !== "undefined"
    ? JSON.parse(localStorage.getItem(`bid_dates_${b.id}`) || "null")
    : null;
  const checkInRaw  = b.checkIn  || b.request?.checkIn  || b.bidRequest?.checkIn  || b.Request?.checkIn  || stored?.checkIn;
  const checkOutRaw = b.checkOut || b.request?.checkOut || b.bidRequest?.checkOut || b.Request?.checkOut || stored?.checkOut;

  // BUG-FIX 1: resolvePaidAmount looks at message `paid:X` token first
  // (works for hotel + customer views), then localStorage, then bid.amount.
  // This fixes the "paid ₹20, booking shows ₹1899" mismatch.
  const displayAmount = resolvePaidAmount(b);

  const checkIn  = checkInRaw  ? new Date(checkInRaw)  : null;
  const checkOut = checkOutRaw ? new Date(checkOutRaw) : null;
  const nights   = checkIn && checkOut
    ? Math.max(1, Math.ceil((checkOut.getTime() - checkIn.getTime()) / 86400000))
    : 1;

  const fmtDate = (d: Date | null) => d
    ? d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" })
    : null;

  const hotel   = b.hotel  || {};
  const room    = b.room   || {};
  const phone   = hotel.phone || hotel.contact || hotel.phoneNumber || null;
  const address = hotel.address || hotel.location || null;
  const city    = hotel.city || b.city || null;
  const email   = hotel.email || null;
  const stars   = hotel.starRating || hotel.stars || null;

  const stayPoints = Math.floor(displayAmount / 100) * 5;
  const isCompleted = b.status === "CHECKED_OUT";
  const isConfirmed = b.status === "ACCEPTED" || b.status === "CONFIRMED" || b.status === "CHECKED_IN";

  const mapsQuery = encodeURIComponent([hotel.name, address, city].filter(Boolean).join(", "));
  const whatsappNum = phone?.replace(/\D/g, "");

  return (
    <div className="card-luxury sb-card-lift overflow-hidden">
      <div className="h-[3px] bg-gradient-to-r from-gold-500 via-amber-300 to-gold-500" />

      <div className="p-5">
        {/* Hotel name + status */}
        <div className="flex items-start justify-between gap-3 mb-1">
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-luxury-900 text-[1.1rem] leading-snug">{hotel.name || "Hotel"}</h3>
            {stars && <p className="text-gold-500 text-xs tracking-widest mt-0.5">{"★".repeat(Math.min(5, stars))}</p>}
          </div>
          <span className={`flex items-center gap-1.5 text-xs font-bold px-3 py-1 rounded-full border shrink-0 ${st.bg} ${st.text} ${st.border}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${st.dot} ${isConfirmed ? "animate-pulse" : ""}`} />
            {st.label}
          </span>
        </div>
        <p className="text-sm text-luxury-400 mb-4">
          {room.type || "Room"}{city ? ` · ${city}` : ""}{b.guests ? ` · ${b.guests} guest${b.guests !== 1 ? "s" : ""}` : ""}
        </p>

        {/* Allocated room number */}
        {unitNumber ? (
          <div className="mb-4 inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-gradient-to-r from-gold-50 to-amber-50 border border-gold-300 text-gold-700 font-bold text-xs tracking-wide shadow-sm">
            🔑 Room #{unitNumber} Allocated
          </div>
        ) : isConfirmed && (
          <div className="mb-4 inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-luxury-50 border border-luxury-200 text-luxury-600 text-[0.7rem]">
            🔑 Room number will be allocated at check-in
          </div>
        )}

        {/* Hold banner — pay balance / pay-at-hotel banner / expired warning */}
        <HoldBanner bidId={b.id} onPaid={onRefresh} />

        {/* Barcode + Booking ID */}
        <div className="bg-luxury-50 border border-luxury-100 rounded-2xl px-4 pt-3 pb-3 mb-4">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-[0.6rem] text-luxury-400 uppercase tracking-widest mb-1">Booking ID</p>
              <p className="font-mono font-bold text-luxury-800 text-base tracking-[0.15em]">#{bookingId}</p>
              <p className="text-[0.6rem] text-luxury-400 uppercase tracking-widest mt-1">{b.paymentMode || "BID BOOKING"}</p>
            </div>
            <div className="flex-1 flex justify-end">
              <Barcode id={b.id || bookingId} />
            </div>
          </div>
        </div>

        {/* StayPoints banner */}
        {isCompleted ? (
          <div className="flex items-center gap-3 bg-gold-50 border border-gold-200 rounded-xl px-4 py-2.5 mb-4">
            <span className="text-lg">🎁</span>
            <div>
              <p className="text-xs font-bold text-gold-700">+{stayPoints} StayPoints Credited!</p>
              <p className="text-[0.65rem] text-gold-600">Added to your wallet as cashback</p>
            </div>
          </div>
        ) : isConfirmed ? (
          <div className="flex items-center gap-3 bg-amber-50 border border-amber-100 rounded-xl px-4 py-2.5 mb-4">
            <span className="text-lg">⭐</span>
            <div>
              <p className="text-xs font-bold text-amber-700">Earn {stayPoints} StayPoints on checkout</p>
              <p className="text-[0.65rem] text-amber-600">Redeemable as cashback on future stays</p>
            </div>
          </div>
        ) : null}

        {/* Dates */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="bg-luxury-50 rounded-xl p-3 border border-luxury-100">
            <p className="text-[0.6rem] text-luxury-400 uppercase tracking-widest mb-1">Check-in</p>
            {fmtDate(checkIn)
              ? <p className="text-sm font-semibold text-luxury-800 leading-snug">{fmtDate(checkIn)}</p>
              : <p className="text-xs text-luxury-400 italic">Confirm with hotel</p>}
            <p className="text-[0.65rem] text-luxury-400 mt-0.5">From 12:00 PM</p>
          </div>
          <div className="bg-luxury-50 rounded-xl p-3 border border-luxury-100">
            <p className="text-[0.6rem] text-luxury-400 uppercase tracking-widest mb-1">Check-out</p>
            {fmtDate(checkOut)
              ? <p className="text-sm font-semibold text-luxury-800 leading-snug">{fmtDate(checkOut)}</p>
              : <p className="text-xs text-luxury-400 italic">Confirm with hotel</p>}
            <p className="text-[0.65rem] text-luxury-400 mt-0.5">By 11:00 AM</p>
          </div>
        </div>

        {/* Amount */}
        <div className="flex items-center justify-between mb-4 px-1">
          <div>
            <p className="text-[0.6rem] text-luxury-400 uppercase tracking-widest mb-0.5">{nights} Night{nights !== 1 ? "s" : ""}</p>
            <p className="text-2xl font-bold text-luxury-900">₹{displayAmount.toLocaleString()}</p>
            {nights > 1 && <p className="text-xs text-luxury-400">₹{Math.round(displayAmount / nights).toLocaleString()}/night</p>}
          </div>
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-gold-500 to-amber-600 flex items-center justify-center shadow-gold">
            <span className="text-white font-bold text-lg">{nights}N</span>
          </div>
        </div>

        {/* Phase 7: trip chat — only on confirmed bookings (status ACCEPTED/
            CONFIRMED/CHECKED_IN/CHECKED_OUT). Anti-bypass sanitizer applied
            server-side to every message. */}
        {isConfirmed && (
          <BookingChat
            bidId={b.id}
            mode="customer"
            hotelName={hotel.name || "Hotel"}
          />
        )}

        {/* v98: Rate-your-stay card (post-checkout) */}
        {isCompleted && (
          <RateStayBanner bidId={b.id} hotelName={hotel.name || "this hotel"} stayPoints={stayPoints} />
        )}

        {/* v127.1 — Deep-link to the smiley feedback composer on /verification.
            Customer has 48h post-checkout to submit; after that we auto-mark
            positive + delete the hotel's verification video. */}
        {isCompleted && (
          <a
            href="/verification"
            className="mt-2 inline-flex items-center justify-center w-full px-4 py-2.5 rounded-xl bg-gradient-to-r from-gold-100 to-amber-100 border border-gold-300 text-gold-900 text-sm font-semibold hover:from-gold-200 hover:to-amber-200"
          >
            😊 Rate hotel video & service · earn 100 StayPoints →
          </a>
        )}

        {/* v105 — Report-an-issue link with proper spacing + visual separator.
            Was stacking too tightly under <BookingChat> with -mt-1 negative
            margin, looked like an overlap on Android phones. Now sits on
            its own row with a clear top border + sensible padding. */}
        {(isConfirmed || isCompleted) && (
          <div className="mt-3 pt-3 border-t border-luxury-100 flex items-center gap-2">
            <a
              href={`/complaints?bookingId=${encodeURIComponent(b.id)}&hotelId=${encodeURIComponent(hotel.id || "")}`}
              className="text-[0.75rem] font-semibold text-rose-600/80 hover:text-rose-700 transition-colors inline-flex items-center gap-1.5"
            >
              <span className="text-red-500">🚩</span>
              <span>Report an issue with this booking</span>
            </a>
          </div>
        )}

        {/* Expand toggle */}
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center justify-between text-xs text-luxury-400 hover:text-luxury-700 transition-colors pt-3 border-t border-luxury-100"
        >
          <span className="font-medium uppercase tracking-widest">{expanded ? "Hide Details" : "View Hotel Details"}</span>
          <span className={`transition-transform duration-200 text-[10px] ${expanded ? "rotate-180" : ""}`}>▼</span>
        </button>

        {/* Expanded details */}
        {expanded && (
          <div className="mt-4 space-y-4 border-t border-luxury-100 pt-4">

            {/* Location with Maps button */}
            {(address || city) && (
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-full bg-gold-50 border border-gold-200 flex items-center justify-center shrink-0 text-base">📍</div>
                <div className="flex-1">
                  <p className="text-[0.6rem] text-luxury-400 uppercase tracking-widest mb-1">Location</p>
                  <p className="text-sm text-luxury-800 font-medium mb-2">{[address, city].filter(Boolean).join(", ")}</p>
                  <a
                    href={`https://maps.google.com/?q=${mapsQuery}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-white bg-blue-500 hover:bg-blue-600 px-3 py-1.5 rounded-lg transition-colors"
                  >
                    🗺 Get Directions
                  </a>
                </div>
              </div>
            )}

            {/* Phone with Call + WhatsApp */}
            {phone && (
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-full bg-gold-50 border border-gold-200 flex items-center justify-center shrink-0 text-base">📞</div>
                <div className="flex-1">
                  <p className="text-[0.6rem] text-luxury-400 uppercase tracking-widest mb-1">Hotel Contact</p>
                  <p className="text-sm text-luxury-800 font-semibold mb-2">{phone}</p>
                  <div className="flex gap-2">
                    <a
                      href={`tel:${phone}`}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold text-white bg-emerald-500 hover:bg-emerald-600 px-3 py-1.5 rounded-lg transition-colors"
                    >
                      📱 Call Now
                    </a>
                    <a
                      href={`https://wa.me/${whatsappNum}?text=Hi, I have a booking #${bookingId} at ${hotel.name || "your hotel"}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs font-semibold text-white bg-[#25D366] hover:bg-[#20b958] px-3 py-1.5 rounded-lg transition-colors"
                    >
                      💬 WhatsApp
                    </a>
                  </div>
                </div>
              </div>
            )}

            {/* Email */}
            {email && (
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-full bg-gold-50 border border-gold-200 flex items-center justify-center shrink-0 text-base">✉️</div>
                <div>
                  <p className="text-[0.6rem] text-luxury-400 uppercase tracking-widest mb-1">Email</p>
                  <a href={`mailto:${email}`} className="text-sm text-gold-600 font-semibold hover:underline">{email}</a>
                </div>
              </div>
            )}

            {/* Room */}
            {room.type && (
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-full bg-gold-50 border border-gold-200 flex items-center justify-center shrink-0 text-base">🛏</div>
                <div>
                  <p className="text-[0.6rem] text-luxury-400 uppercase tracking-widest mb-1">Room</p>
                  <p className="text-sm text-luxury-800 font-medium">{room.type}{room.capacity ? ` · Up to ${room.capacity} guests` : ""}</p>
                </div>
              </div>
            )}

            {/* Booked on */}
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-full bg-gold-50 border border-gold-200 flex items-center justify-center shrink-0 text-base">🗓</div>
              <div>
                <p className="text-[0.6rem] text-luxury-400 uppercase tracking-widest mb-1">Booked On</p>
                <p className="text-sm text-luxury-800 font-medium">
                  {new Date(b.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}
                </p>
              </div>
            </div>

            {/* StayPoints redemption info */}
            <div className="bg-gradient-to-r from-gold-50 to-amber-50 border border-gold-200 rounded-xl p-4">
              <p className="text-xs font-bold text-gold-700 mb-1">⭐ StayPoints Program</p>
              <p className="text-[0.7rem] text-gold-600 leading-relaxed">
                Earn <strong>{stayPoints} points</strong> (₹{stayPoints} value) on completing this stay.
                Points are credited to your wallet after check-out and can be redeemed on future bookings.
              </p>
            </div>

            {(!phone && !address) && (
              <div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-3 text-xs text-amber-700">
                Hotel contact details will be shared via SMS/email before check-in.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function BookingsPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [bookings, setBookings] = useState<any[]>([]);
  const [units, setUnits] = useState<Record<string, { unitId: string; unitNumber: string }>>({});
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.push("/auth"); return; }

    // Phase 4: hydrate cross-device holds from /api/holds (fires once on mount,
    // merges into localStorage so HoldBanner renders even on a fresh browser).
    hydrateHoldsFromServer().catch(() => {});

    Promise.all([
      api.getMyBookings().catch(() => ({ bookings: [] })),
      api.getMyBids().catch(() => ({ bids: [] })),
    ]).then(async ([bookData, bidData]) => {
      const fromBookings = (bookData.bookings || []).map((b: any) => ({ ...b, _source: "booking" }));
      const fromBids = (bidData.bids || [])
        .filter((b: any) => b.status === "ACCEPTED" || b.status === "CONFIRMED")
        // Only paid bids show up as bookings. Unpaid accepted bids stay in My Bids
        // with a Pay Now gate until the customer completes payment.
        .filter((b: any) => typeof b.message === "string" && b.message.includes("Razorpay:"))
        .filter((b: any) => {
          // Skip bid if a real booking already exists for same hotel+room (prevents duplicate display)
          return !fromBookings.some(
            (bk: any) =>
              bk.hotelId === (b.hotelId || b.hotel?.id) &&
              bk.roomId  === (b.roomId  || b.room?.id)
          );
        })
        .map((b: any) => ({
          id: b.id,
          status: b.status,
          checkIn:  b.checkIn  || b.request?.checkIn  || b.bidRequest?.checkIn,
          checkOut: b.checkOut || b.request?.checkOut || b.bidRequest?.checkOut,
          guests:   b.request?.guests || b.bidRequest?.guests || b.guests || 2,
          totalAmount: b.amount,
          hotel: b.hotel,
          room:  b.room,
          city:  b.hotel?.city || b.city,
          createdAt: b.createdAt,
          paymentMode: "FLASH DEAL",
          _source: "bid",
          _raw: b,
        }));

      const seen = new Set();
      const merged = [...fromBookings, ...fromBids].filter((b) => {
        if (seen.has(b.id)) return false;
        seen.add(b.id);
        return true;
      });
      merged.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      // BULLETPROOF: bulk-fetch server-recorded paid amounts and merge.
      // bid.amount may have been corrupted to floor; bid_paid_amounts is the
      // authoritative source written at booking time across all flows.
      try {
        const ids = merged.map((x: any) => x.id).filter(Boolean);
        if (ids.length) {
          const j = await fetchServerPaid(ids);
          merged.forEach((b: any) => { if (j[b.id]) b.serverPaid = j[b.id]; });
        }
      } catch {}
      setBookings(merged);

      // Fetch allocated room # for each booking/bid
      try {
        const token = localStorage.getItem("sb_token");
        const ids = merged.map((x: any) => x.id).filter(Boolean);
        if (ids.length) {
          const r = await fetch("/api/my/unit-assignments", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({ bidIds: ids }),
          });
          const j = await r.json();
          if (j?.assignments) setUnits(j.assignments);
        }
      } catch {}
    }).finally(() => setLoading(false));
  }, [user, authLoading, router]);

  if (authLoading || loading) return (
    <div className="max-w-2xl mx-auto px-5 py-12 space-y-4">
      {[1, 2, 3].map((i) => <div key={i} className="h-64 shimmer rounded-3xl" />)}
    </div>
  );

  const totalPoints = bookings
    .filter(b => b.status === "CHECKED_OUT")
    .reduce((sum, b) => sum + Math.floor((b.totalAmount || 0) / 100) * 5, 0);

  return (
    <div className="bg-luxury-50 min-h-screen">
      <div className="max-w-2xl mx-auto px-5 py-12">

        <div className="mb-8 sb-fade-in">
          <p className="text-gold-500 text-[0.68rem] font-semibold tracking-[0.2em] uppercase mb-2">Account</p>
          <h1 className="font-display font-light text-luxury-900" style={{ fontSize: "clamp(1.8rem, 4vw, 2.5rem)" }}>
            My Bookings
          </h1>
          <div className="flex items-center gap-4 mt-2">
            {bookings.length > 0 && (
              <p className="text-sm text-luxury-400">
                <CountUp value={bookings.length} duration={700} /> booking{bookings.length !== 1 ? "s" : ""}
              </p>
            )}
            {totalPoints > 0 && (
              <p className="text-xs font-semibold text-gold-600 bg-gold-50 border border-gold-200 px-3 py-1 rounded-full sb-card-lift">
                ⭐ <CountUp value={totalPoints} duration={900} /> StayPoints earned
              </p>
            )}
          </div>
        </div>

        {bookings.length === 0 && (
          <div className="text-center py-24">
            <div className="w-20 h-20 rounded-full bg-white border border-luxury-100 flex items-center justify-center mx-auto mb-5 shadow-luxury">
              <span className="text-3xl">📋</span>
            </div>
            <p className="text-lg font-semibold text-luxury-800 mb-1">No bookings yet</p>
            <p className="text-sm text-luxury-400 mb-6">Start by placing a bid or booking a flash deal.</p>
          </div>
        )}

        <div className="space-y-5 sb-stagger">
          {bookings.map((b) => (
            <BookingCard
              key={b.id}
              b={b}
              unitNumber={units[b.id]?.unitNumber}
              onRefresh={() => {/* hold state read from localStorage; refresh forces re-render via state pun */}}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
