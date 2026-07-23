"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { redirectToSignIn } from "@/lib/auth-intent";
import Link from "next/link";
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
// Phase 4 tier-system — "Share your trip" nudge shown to users who have
// at least one booking. Self-dismisses on tap, persistence via localStorage.
import InspirationBanner from "@/components/tier/InspirationBanner";
// v141 — Phase-5 bookings tour. 3 steps: booking card → StayPoints →
// chat with hotel.
import { usePageTour } from "@/lib/tutorial/usePageTour";

// v174 — cozy-theme status palette. Mid-tone colours that read on both
// the cream (light) and walnut (dark) surfaces — no per-theme branching.
const STATUS_META: Record<string, { color: string; soft: string; label: string }> = {
  PENDING:     { color: "#C9A66B", soft: "rgba(201,166,107,0.15)", label: "Pending"     },
  CONFIRMED:   { color: "#7F9269", soft: "rgba(127,146,105,0.17)", label: "Confirmed"   },
  ACCEPTED:    { color: "#7F9269", soft: "rgba(127,146,105,0.17)", label: "Confirmed"   },
  CHECKED_IN:  { color: "#5E83A8", soft: "rgba(94,131,168,0.16)",  label: "Checked In"  },
  CHECKED_OUT: { color: "#9A8B6F", soft: "rgba(154,139,111,0.17)", label: "Checked Out" },
  CANCELLED:   { color: "#C77E6D", soft: "rgba(199,126,109,0.14)", label: "Cancelled"   },
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
      <div className="mb-4 rounded-2xl p-4 border"
        style={{ background: "rgba(201,145,26,0.10)", borderColor: "rgba(201,145,26,0.42)" }}>
        <div className="flex items-start gap-3">
          <span className="text-xl">🏨</span>
          <div className="flex-1">
            <p className="text-sm font-bold" style={{ color: "var(--text-base)" }}>Pay at Hotel · Balance ₹{state.balanceDue.toLocaleString()}</p>
            <p className="text-[0.7rem] leading-relaxed mt-0.5" style={{ color: "var(--text-soft)" }}>
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
      <div className="mb-4 rounded-2xl p-4 border"
        style={{ background: STATUS_META.CANCELLED.soft, borderColor: `${STATUS_META.CANCELLED.color}55` }}>
        <p className="text-sm font-bold" style={{ color: STATUS_META.CANCELLED.color }}>⏰ Hold expired</p>
        <p className="text-[0.7rem] mt-0.5" style={{ color: "var(--text-soft)" }}>
          Your ₹{state.holdAmount.toLocaleString()} hold for ₹{state.totalAmount.toLocaleString()} has expired.
          Contact the hotel to re-confirm at current rates.
        </p>
        <button onClick={() => { removeHoldState(state.bidId); onPaid(); }}
          className="mt-2 text-[0.7rem] font-semibold underline" style={{ color: STATUS_META.CANCELLED.color }}>Dismiss</button>
      </div>
    );
  }

  return (
    <div className="mb-4 rounded-2xl p-4 border-2"
      style={{ background: STATUS_META.CONFIRMED.soft, borderColor: `${STATUS_META.CONFIRMED.color}66` }}>
      <div className="flex items-start gap-3 mb-3">
        <span className="text-2xl">🔒</span>
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-0.5 flex-wrap">
            <p className="text-sm font-bold" style={{ color: STATUS_META.CONFIRMED.color }}>Price locked — pay balance to confirm</p>
            <span className="text-[0.55rem] font-bold tracking-wider uppercase px-2 py-0.5 rounded-full"
              style={{ background: STATUS_META.CONFIRMED.color, color: "#fff" }}>{countdown}</span>
          </div>
          <p className="text-[0.7rem] leading-relaxed" style={{ color: "var(--text-soft)" }}>
            You've paid <span className="font-bold">₹{state.holdAmount.toLocaleString()}</span>.
            Balance <span className="font-bold" style={{ color: "var(--text-base)" }}>₹{state.balanceDue.toLocaleString()}</span> due before lock expires.
          </p>
        </div>
      </div>
      <button onClick={payBalance} disabled={paying}
        className="w-full py-3 rounded-xl font-bold text-sm tracking-wide disabled:opacity-40 transition-transform active:scale-[0.99]"
        style={{
          background: "linear-gradient(135deg,#6f8159 0%,#8aa06f 50%,#6f8159 100%)",
          color: "#fff",
          boxShadow: "0 6px 18px rgba(127,146,105,0.4)",
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
          style={{ width: b.w, height: `${b.h}%`, background: "var(--text-base)" }}
          className="rounded-[1px] shrink-0 opacity-80"
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
      <div className="mb-4 rounded-2xl p-3 flex items-center gap-3"
        style={{ background: STATUS_META.CONFIRMED.soft, border: `1px solid ${STATUS_META.CONFIRMED.color}44` }}>
        <span className="text-lg">✅</span>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-bold" style={{ color: STATUS_META.CONFIRMED.color }}>Thanks for your feedback</p>
          <p className="text-[0.65rem]" style={{ color: "var(--text-soft)" }}>
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
        className="w-full mb-4 rounded-2xl p-4 transition text-left sb-card-lift"
        style={{ background: "rgba(201,145,26,0.10)", border: "1px solid rgba(201,145,26,0.32)" }}
      >
        <div className="flex items-center gap-3">
          <span className="text-2xl">⭐</span>
          <div className="flex-1">
            <p className="text-sm font-bold" style={{ color: "var(--text-base)" }}>Rate your stay at {hotelName}</p>
            <p className="text-[0.7rem]" style={{ color: "var(--text-soft)" }}>
              Share feedback and earn <strong>+100 StayPoints</strong> on top of your {stayPoints} cashback points
            </p>
          </div>
          <span className="text-sm font-bold" style={{ color: "#c9911a" }}>Rate →</span>
        </div>
      </button>

      {open && (
        <div
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-1000 bg-black/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full sm:max-w-md sm:rounded-3xl rounded-t-3xl max-h-[92vh] overflow-y-auto"
            style={{ background: "var(--bg-card)" }}
          >
            <div className="px-5 py-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-display text-xl" style={{ color: "var(--text-base)" }}>How was {hotelName}?</div>
                  <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>Your feedback helps thousands of travellers</p>
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
                      style={{ color: lit ? "#f0b429" : "var(--border-strong)" }}
                      aria-label={`${n} star${n > 1 ? "s" : ""}`}
                    >
                      ★
                    </button>
                  );
                })}
              </div>
              <p className="text-center text-xs -mt-3 mb-4" style={{ color: "var(--text-muted)" }}>
                {rating === 5 ? "Loved it" : rating === 4 ? "Great" : rating === 3 ? "It was okay" : rating === 2 ? "Below expectations" : "Disappointing"}
              </p>

              <label className="text-[10px] font-bold uppercase tracking-wider mb-2 block" style={{ color: "var(--text-muted)" }}>
                Comments <span className="font-normal lowercase">(optional)</span>
              </label>
              <textarea
                value={comments}
                onChange={(e) => setComments(e.target.value.slice(0, 1000))}
                rows={4}
                placeholder="What stood out? What could be better?"
                className="w-full resize-none rounded-xl px-3 py-2.5 text-sm outline-hidden"
                style={{ background: "var(--bg-input)", border: "1px solid var(--border-soft)", color: "var(--text-base)" }}
                maxLength={1000}
              />
              <div className="text-[10px] mt-1 text-right" style={{ color: "var(--text-muted)" }}>{comments.length}/1000</div>

              {err && (
                <div className="rounded-xl px-3 py-2 text-sm mt-3"
                  style={{ background: STATUS_META.CANCELLED.soft, border: `1px solid ${STATUS_META.CANCELLED.color}44`, color: STATUS_META.CANCELLED.color }}>{err}</div>
              )}

              <div className="flex gap-2 mt-4">
                <button
                  onClick={() => setOpen(false)}
                  disabled={submitting}
                  className="flex-1 px-4 py-2.5 rounded-xl font-semibold text-sm transition disabled:opacity-50"
                  style={{ background: "var(--bg-pill)", border: "1px solid var(--border-soft)", color: "var(--text-soft)" }}
                >
                  Later
                </button>
                <button
                  onClick={submit}
                  disabled={submitting}
                  className="flex-2 bk-gold-btn text-sm py-2.5 rounded-xl disabled:opacity-60"
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
  const st = STATUS_META[b.status] || { color: "#9A8B6F", soft: "rgba(154,139,111,0.16)", label: b.status };

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

  // Reusable cozy "info row" for the expanded section
  const InfoRow = ({ icon, children }: { icon: string; children: React.ReactNode }) => (
    <div className="flex items-start gap-3">
      <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 text-base"
        style={{ background: "rgba(201,145,26,0.10)", border: "1px solid rgba(201,145,26,0.28)" }}>{icon}</div>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
  const Lbl = ({ children }: { children: React.ReactNode }) => (
    <p className="text-[0.6rem] uppercase tracking-widest mb-1" style={{ color: "var(--text-muted)" }}>{children}</p>
  );

  return (
    <div className="bk-card rounded-2xl overflow-hidden">
      <div className="h-[3px]" style={{ background: "linear-gradient(90deg,#c9911a,#f0d27a,#c9911a)" }} />

      <div className="p-4 sm:p-5">
        {/* Hotel name + status */}
        <div className="flex items-start justify-between gap-3 mb-1">
          <div className="flex-1 min-w-0">
            <h3 className="font-display font-semibold text-[1.3rem] leading-tight" style={{ color: "var(--text-base)", letterSpacing: "0.005em" }}>{hotel.name || "Hotel"}</h3>
            {stars && <p className="text-xs tracking-widest mt-0.5" style={{ color: "#c9911a" }}>{"★".repeat(Math.min(5, stars))}</p>}
          </div>
          <span className="flex items-center gap-1.5 text-[0.68rem] font-bold px-3 py-1 rounded-full shrink-0"
            style={{ color: st.color, background: st.soft, border: `1px solid ${st.color}55` }}>
            <span className={`w-1.5 h-1.5 rounded-full ${isConfirmed ? "animate-pulse" : ""}`} style={{ background: st.color }} />
            {st.label}
          </span>
        </div>
        <p className="text-sm mb-4" style={{ color: "var(--text-muted)" }}>
          {room.type || "Room"}{city ? ` · ${city}` : ""}{b.guests ? ` · ${b.guests} guest${b.guests !== 1 ? "s" : ""}` : ""}
        </p>

        {/* Allocated room number */}
        {unitNumber ? (
          <div className="mb-4 inline-flex items-center gap-2 px-3 py-1.5 rounded-full font-bold text-xs tracking-wide"
            style={{ background: "rgba(201,145,26,0.12)", border: "1px solid rgba(201,145,26,0.36)", color: "#c9911a" }}>
            🔑 Room #{unitNumber} Allocated
          </div>
        ) : isConfirmed && (
          <div className="mb-4 inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-[0.7rem]"
            style={{ background: "var(--bg-pill)", border: "1px solid var(--border-soft)", color: "var(--text-soft)" }}>
            🔑 Room number will be allocated at check-in
          </div>
        )}

        {/* Hold banner — pay balance / pay-at-hotel banner / expired warning */}
        <HoldBanner bidId={b.id} onPaid={onRefresh} />

        {/* Barcode + Booking ID */}
        <div className="rounded-2xl px-4 pt-3 pb-3 mb-4"
          style={{ background: "var(--bg-pill)", border: "1px solid var(--border-soft)" }}>
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-[0.58rem] uppercase tracking-widest mb-1" style={{ color: "var(--text-muted)" }}>Booking ID</p>
              <p className="font-mono font-bold text-base tracking-[0.15em]" style={{ color: "var(--text-base)" }}>#{bookingId}</p>
              <p className="text-[0.58rem] uppercase tracking-widest mt-1" style={{ color: "var(--text-muted)" }}>{b.paymentMode || "BID BOOKING"}</p>
            </div>
            <div className="flex-1 flex justify-end">
              <Barcode id={b.id || bookingId} />
            </div>
          </div>
        </div>

        {/* StayPoints banner */}
        {isCompleted ? (
          <div className="flex items-center gap-3 rounded-xl px-4 py-2.5 mb-4"
            style={{ background: "rgba(201,145,26,0.10)", border: "1px solid rgba(201,145,26,0.30)" }}>
            <span className="text-lg">🎁</span>
            <div>
              <p className="text-xs font-bold" style={{ color: "#c9911a" }}>+{stayPoints} StayPoints Credited!</p>
              <p className="text-[0.65rem]" style={{ color: "var(--text-soft)" }}>Added to your wallet as cashback</p>
            </div>
          </div>
        ) : isConfirmed ? (
          <div className="flex items-center gap-3 rounded-xl px-4 py-2.5 mb-4"
            style={{ background: STATUS_META.PENDING.soft, border: `1px solid ${STATUS_META.PENDING.color}40` }}>
            <span className="text-lg">⭐</span>
            <div>
              <p className="text-xs font-bold" style={{ color: "var(--text-base)" }}>Earn {stayPoints} StayPoints on checkout</p>
              <p className="text-[0.65rem]" style={{ color: "var(--text-soft)" }}>Redeemable as cashback on future stays</p>
            </div>
          </div>
        ) : null}

        {/* Dates */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          {[
            { lbl: "Check-in",  d: checkIn,  note: "From 12:00 PM" },
            { lbl: "Check-out", d: checkOut, note: "By 11:00 AM"   },
          ].map((x) => (
            <div key={x.lbl} className="rounded-xl p-3"
              style={{ background: "var(--bg-pill)", border: "1px solid var(--border-soft)" }}>
              <p className="text-[0.58rem] uppercase tracking-widest mb-1" style={{ color: "var(--text-muted)" }}>{x.lbl}</p>
              {fmtDate(x.d)
                ? <p className="text-sm font-semibold leading-snug" style={{ color: "var(--text-base)" }}>{fmtDate(x.d)}</p>
                : <p className="text-xs italic" style={{ color: "var(--text-muted)" }}>Confirm with hotel</p>}
              <p className="text-[0.62rem] mt-0.5" style={{ color: "var(--text-muted)" }}>{x.note}</p>
            </div>
          ))}
        </div>

        {/* Amount */}
        <div className="flex items-center justify-between mb-4 px-1">
          <div>
            <p className="text-[0.58rem] uppercase tracking-widest mb-0.5" style={{ color: "var(--text-muted)" }}>{nights} Night{nights !== 1 ? "s" : ""}</p>
            <p className="text-2xl font-bold tabular-nums" style={{ color: "var(--text-base)" }}>₹{displayAmount.toLocaleString()}</p>
            {nights > 1 && <p className="text-xs tabular-nums" style={{ color: "var(--text-muted)" }}>₹{Math.round(displayAmount / nights).toLocaleString()}/night</p>}
          </div>
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center"
            style={{ background: "linear-gradient(135deg,#c9911a,#9c7414)", boxShadow: "0 6px 18px rgba(201,145,26,0.34)" }}>
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
            className="mt-2 inline-flex items-center justify-center w-full px-4 py-2.5 rounded-xl text-sm font-semibold transition"
            style={{ background: "rgba(201,145,26,0.12)", border: "1px solid rgba(201,145,26,0.32)", color: "#c9911a" }}
          >
            😊 Rate hotel video &amp; service · earn 100 StayPoints →
          </a>
        )}

        {/* v105 — Report-an-issue link with proper spacing + visual separator. */}
        {(isConfirmed || isCompleted) && (
          <div className="mt-3 pt-3 flex items-center gap-2" style={{ borderTop: "1px solid var(--border-soft)" }}>
            <a
              href={`/complaints?bookingId=${encodeURIComponent(b.id)}&hotelId=${encodeURIComponent(hotel.id || "")}`}
              className="text-[0.75rem] font-semibold transition-colors inline-flex items-center gap-1.5"
              style={{ color: STATUS_META.CANCELLED.color }}
            >
              <span>🚩</span>
              <span>Report an issue with this booking</span>
            </a>
          </div>
        )}

        {/* Expand toggle */}
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center justify-between text-xs transition-colors pt-3"
          style={{ borderTop: "1px solid var(--border-soft)", color: "var(--text-muted)" }}
        >
          <span className="font-medium uppercase tracking-widest">{expanded ? "Hide Details" : "View Hotel Details"}</span>
          <span className={`transition-transform duration-200 text-[10px] ${expanded ? "rotate-180" : ""}`}>▼</span>
        </button>

        {/* Expanded details */}
        {expanded && (
          <div className="mt-4 space-y-4 pt-4" style={{ borderTop: "1px solid var(--border-soft)" }}>

            {/* Location with Maps button */}
            {(address || city) && (
              <InfoRow icon="📍">
                <Lbl>Location</Lbl>
                <p className="text-sm font-medium mb-2" style={{ color: "var(--text-base)" }}>{[address, city].filter(Boolean).join(", ")}</p>
                <a href={`https://maps.google.com/?q=${mapsQuery}`} target="_blank" rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-white bg-blue-500 hover:bg-blue-600 px-3 py-1.5 rounded-lg transition-colors">
                  🗺 Get Directions
                </a>
              </InfoRow>
            )}

            {/* Phone with Call + WhatsApp */}
            {phone && (
              <InfoRow icon="📞">
                <Lbl>Hotel Contact</Lbl>
                <p className="text-sm font-semibold mb-2" style={{ color: "var(--text-base)" }}>{phone}</p>
                <div className="flex gap-2 flex-wrap">
                  <a href={`tel:${phone}`}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-white bg-emerald-500 hover:bg-emerald-600 px-3 py-1.5 rounded-lg transition-colors">
                    📱 Call Now
                  </a>
                  <a href={`https://wa.me/${whatsappNum}?text=Hi, I have a booking #${bookingId} at ${hotel.name || "your hotel"}`}
                    target="_blank" rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-white bg-[#25D366] hover:bg-[#20b958] px-3 py-1.5 rounded-lg transition-colors">
                    💬 WhatsApp
                  </a>
                </div>
              </InfoRow>
            )}

            {/* Email */}
            {email && (
              <InfoRow icon="✉️">
                <Lbl>Email</Lbl>
                <a href={`mailto:${email}`} className="text-sm font-semibold hover:underline" style={{ color: "#c9911a" }}>{email}</a>
              </InfoRow>
            )}

            {/* Room */}
            {room.type && (
              <InfoRow icon="🛏">
                <Lbl>Room</Lbl>
                <p className="text-sm font-medium" style={{ color: "var(--text-base)" }}>{room.type}{room.capacity ? ` · Up to ${room.capacity} guests` : ""}</p>
              </InfoRow>
            )}

            {/* Booked on */}
            <InfoRow icon="🗓">
              <Lbl>Booked On</Lbl>
              <p className="text-sm font-medium" style={{ color: "var(--text-base)" }}>
                {new Date(b.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}
              </p>
            </InfoRow>

            {/* StayPoints redemption info */}
            <div className="rounded-xl p-4"
              style={{ background: "rgba(201,145,26,0.10)", border: "1px solid rgba(201,145,26,0.28)" }}>
              <p className="text-xs font-bold mb-1" style={{ color: "#c9911a" }}>⭐ StayPoints Program</p>
              <p className="text-[0.7rem] leading-relaxed" style={{ color: "var(--text-soft)" }}>
                Earn <strong>{stayPoints} points</strong> (₹{stayPoints} value) on completing this stay.
                Points are credited to your wallet after check-out and can be redeemed on future bookings.
              </p>
            </div>

            {(!phone && !address) && (
              <div className="rounded-xl px-4 py-3 text-xs"
                style={{ background: STATUS_META.PENDING.soft, border: `1px solid ${STATUS_META.PENDING.color}40`, color: "var(--text-soft)" }}>
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
  // v141 — Phase 5 — bookings tour. delayMs:1400 so /api/bookings/my
  // populates at least one .card before fire.
  usePageTour("bookings", "bookings", { delayMs: 1400 });

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      // v241.3 — return to /bookings after sign-in instead of /.
      redirectToSignIn(router, { route: "/bookings", action: "view_bookings" });
      return;
    }

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

  // Shared cozy styles for this page.
  const styleBlock = (
    <style>{`
      @keyframes bkFadeUp { from{opacity:0;transform:translateY(14px)} to{opacity:1;transform:translateY(0)} }
      .bk-card { background: var(--bg-card); border:1px solid var(--border-soft); border-radius:22px; box-shadow: var(--shadow-card); transition: transform .2s ease, box-shadow .2s ease; }
      .bk-card:hover { transform: translateY(-3px); box-shadow: var(--shadow-soft); }
      .bk-gold-btn { position:relative; overflow:hidden; background:linear-gradient(135deg,#b8871a 0%,#f0b429 48%,#fbd26a 60%,#c9911a 100%); color:#1a1205; font-weight:800; letter-spacing:.03em; }
    `}</style>
  );

  if (authLoading || loading) return (
    <div className="lux-bg min-h-screen">
      {styleBlock}
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-10 grid grid-cols-1 xl:grid-cols-2 gap-5">
        {[1, 2, 3, 4].map((i) => <div key={i} className="h-64 shimmer rounded-2xl" />)}
      </div>
    </div>
  );

  const totalPoints = bookings
    .filter(b => b.status === "CHECKED_OUT")
    .reduce((sum, b) => sum + Math.floor((b.totalAmount || 0) / 100) * 5, 0);

  const upcoming  = bookings.filter(b => b.status === "ACCEPTED" || b.status === "CONFIRMED" || b.status === "CHECKED_IN" || b.status === "PENDING").length;

  return (
    <div className="lux-bg min-h-screen">
      {styleBlock}
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 sm:py-12">

        {/* Hero */}
        <div className="mb-6" style={{ animation: "bkFadeUp 0.5s ease both" }}>
          <p className="text-[0.66rem] font-semibold tracking-[0.22em] uppercase mb-1.5" style={{ color: "var(--text-muted)" }}>Your Account</p>
          <h1 className="font-display font-light" style={{ fontSize: "clamp(1.9rem, 4vw, 2.6rem)", color: "var(--text-base)" }}>
            My Bookings
          </h1>
          {bookings.length > 0 && (
            <div className="flex items-center gap-2.5 mt-3 flex-wrap">
              <span className="text-xs font-semibold px-3 py-1 rounded-full"
                style={{ background: "var(--bg-pill)", border: "1px solid var(--border-soft)", color: "var(--text-soft)" }}>
                🎫 <CountUp value={bookings.length} duration={700} /> total
              </span>
              {upcoming > 0 && (
                <span className="text-xs font-semibold px-3 py-1 rounded-full"
                  style={{ background: STATUS_META.CONFIRMED.soft, border: `1px solid ${STATUS_META.CONFIRMED.color}44`, color: STATUS_META.CONFIRMED.color }}>
                  🗓 <CountUp value={upcoming} duration={700} /> upcoming
                </span>
              )}
              {totalPoints > 0 && (
                <span className="text-xs font-semibold px-3 py-1 rounded-full"
                  style={{ background: "rgba(201,145,26,0.12)", border: "1px solid rgba(201,145,26,0.32)", color: "#c9911a" }}>
                  ⭐ <CountUp value={totalPoints} duration={900} /> StayPoints earned
                </span>
              )}
            </div>
          )}
        </div>

        {/* Phase 4 tier-system — Inspiration banner. */}
        {bookings.length > 0 && (
          <InspirationBanner
            variant="card"
            bookingId={bookings[0]?.id}
            hotelId={bookings[0]?.hotelId}
            hotelName={bookings[0]?.hotel?.name}
          />
        )}

        {bookings.length === 0 && (
          <div className="text-center py-20">
            <div className="w-20 h-20 rounded-full bk-card flex items-center justify-center mx-auto mb-5">
              <span className="text-3xl">📋</span>
            </div>
            <p className="text-lg font-semibold mb-1" style={{ color: "var(--text-base)" }}>No bookings yet</p>
            <p className="text-sm mb-6" style={{ color: "var(--text-muted)" }}>Start by placing a bid or booking a flash deal.</p>
            <Link href="/hotels" className="bk-gold-btn px-6 py-3 rounded-2xl text-sm inline-block">Browse Hotels</Link>
          </div>
        )}

        {/* Responsive grid: 1 col mobile/tablet · 2 col desktop. */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 sm:gap-5 items-start">
          {bookings.map((b, i) => (
            <div key={b.id} style={{ animation: `bkFadeUp 0.45s ease ${Math.min(i, 6) * 0.06}s both` }}>
              <BookingCard
                b={b}
                unitNumber={units[b.id]?.unitNumber}
                onRefresh={() => {/* hold state read from localStorage; refresh forces re-render via state pun */}}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
