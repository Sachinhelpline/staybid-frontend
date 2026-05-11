"use client";
// ── Booking Review modal ───────────────────────────────────────────────
// Sits between "user picks bid/accept/book" and the actual Razorpay
// payment. Shows complete trip details + lets customer:
//   • Update (re-open the original modal to change dates/guests/amount)
//   • Pay Full ₹X & Book — instant confirm
//   • 🔒 Hold for 24h · ₹Y — lock the price, balance settles later
//
// Used by: Book Now, Flash Deal, Negotiate (above-floor), Counter-Accept,
// and My Bids "Pay Now". The component is intentionally dumb — parent
// owns the actions and passes them as callbacks.

import { useEffect, useState } from "react";
import { computeHoldAmount, type HoldTier } from "@/lib/hold-amount";

export type RateLine = { label: string; value: string; subtle?: boolean };

export type BookingReviewProps = {
  open: boolean;
  onClose: () => void;
  // Trip details
  hotelName: string;
  hotelCity?: string;
  roomType?: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  adults: number;
  children?: number;
  kids?: number;
  // Pricing
  rateLines: RateLine[];      // detailed breakdown
  totalAmount: number;        // full amount due
  flowLabel?: string;         // "Book Now" / "Flash Deal" / "Bid Accepted" — shown as a context chip
  // Actions
  onUpdate?: () => void;      // optional — if present, "Update" chip is shown
  onPayFull: () => void | Promise<void>;
  onHold?: (holdAmount: number) => void | Promise<void>; // omit to disable hold
  onPayAtHotel?: (holdAmount: number) => void | Promise<void>; // optional second hold variant
  // Hotel config (per-hotel toggles — fallback to defaults)
  holdEnabled?: boolean;
  payAtHotelEnabled?: boolean;
  // Per-hotel custom hold tiers (from /api/hotel-hold-config). When omitted,
  // platform defaults from DEFAULT_HOLD_TIERS apply.
  holdTiers?: HoldTier[];
};

export default function BookingReview(p: BookingReviewProps) {
  const [busy, setBusy] = useState<"" | "pay" | "hold" | "payhotel">("");

  // Block body scroll while open
  useEffect(() => {
    if (!p.open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [p.open]);

  if (!p.open) return null;

  const holdAmount = computeHoldAmount(p.totalAmount, p.holdTiers);
  const balanceDue = p.totalAmount - holdAmount;
  const fmt = (n: number) => `₹${n.toLocaleString("en-IN")}`;
  const fmtDate = (s: string) =>
    new Date(s).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });

  const run = async (kind: "pay" | "hold" | "payhotel", fn: () => any) => {
    if (busy) return;
    setBusy(kind);
    try { await fn(); } finally { setBusy(""); }
  };

  return (
    <div
      className="fixed inset-0 z-[55] flex items-end sm:items-center justify-center backdrop-blur-md"
      style={{ background: "rgba(2,4,12,0.78)" }}
      onClick={p.onClose}
    >
      <div
        className="w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl overflow-hidden relative"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "linear-gradient(180deg,#fff 0%,#fafaf7 100%)",
          boxShadow: "0 30px 80px -10px rgba(0,0,0,0.4), 0 0 0 1px rgba(240,180,41,0.12)",
          maxHeight: "94vh",
        }}
      >
        <style>{`
          @keyframes brShine { 0%{background-position:-200% 0} 100%{background-position:200% 0} }
          @keyframes brSweep { 0%{transform:translateX(-120%)} 100%{transform:translateX(220%)} }
          @keyframes brPulse { 0%,100%{transform:scale(1);opacity:.9} 50%{transform:scale(1.06);opacity:1} }
          @keyframes brFadeUp{ from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }
          .br-gold-text{background:linear-gradient(90deg,#b8871a,#f0b429,#c9911a,#f0b429,#b8871a);background-size:220% auto;-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;animation:brShine 6s linear infinite}
          .br-cta-pay{position:relative;overflow:hidden}
          .br-cta-pay::after{content:"";position:absolute;inset:0;background:linear-gradient(110deg,transparent 30%,rgba(255,255,255,.55) 50%,transparent 70%);transform:translateX(-120%);animation:brSweep 2.6s ease-in-out infinite}
          .br-section{animation:brFadeUp .35s ease both}
        `}</style>

        {/* HEADER */}
        <div className="relative px-5 py-4 flex items-center justify-between border-b"
          style={{ borderColor: "rgba(240,180,41,0.25)", background: "linear-gradient(135deg,#0c0a14 0%,#1a1424 50%,#0c0a14 100%)" }}>
          <div className="flex items-center gap-2.5">
            {p.flowLabel && (
              <span className="text-[0.55rem] font-bold tracking-[0.18em] uppercase px-2 py-0.5 rounded-full"
                style={{ background: "rgba(240,180,41,0.15)", color: "#f0b429", border: "1px solid rgba(240,180,41,0.35)" }}>
                {p.flowLabel}
              </span>
            )}
            <div>
              <p className="text-[0.62rem] font-bold text-white/70 uppercase tracking-[0.18em]">Review Your Booking</p>
              <p className="text-white font-semibold text-base leading-tight truncate max-w-[200px]">{p.hotelName}</p>
            </div>
          </div>
          <button onClick={p.onClose} className="text-white/50 hover:text-white text-xl w-8 h-8 rounded-full hover:bg-white/5 transition">✕</button>
        </div>

        {/* SCROLLABLE BODY */}
        <div className="overflow-y-auto p-5 space-y-4" style={{ maxHeight: "calc(94vh - 64px - 96px)" }}>

          {/* Hotel + room summary */}
          <div className="br-section flex items-start gap-3 p-3 rounded-2xl border border-luxury-100 bg-luxury-50">
            <div className="w-12 h-12 rounded-xl flex items-center justify-center text-lg shrink-0"
              style={{ background: "linear-gradient(135deg,#f0b429,#b8871a)", color: "#fff" }}>🏨</div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-luxury-900 leading-snug truncate">{p.hotelName}</p>
              {(p.hotelCity || p.roomType) && (
                <p className="text-[0.7rem] text-luxury-500 truncate">
                  {p.roomType}{p.hotelCity ? ` · ${p.hotelCity}` : ""}
                </p>
              )}
            </div>
            {p.onUpdate && (
              <button onClick={p.onUpdate}
                className="text-[0.65rem] font-bold tracking-wide uppercase text-gold-600 hover:text-gold-700 px-2.5 py-1 rounded-full border border-gold-200 hover:border-gold-400 transition">
                ✎ Update
              </button>
            )}
          </div>

          {/* Dates */}
          <div className="br-section grid grid-cols-2 gap-2.5">
            <div className="rounded-2xl p-3 border border-luxury-100 bg-white">
              <p className="text-[0.55rem] font-bold text-luxury-400 uppercase tracking-[0.2em] mb-1">Check-in</p>
              <p className="font-semibold text-luxury-900 text-sm">{fmtDate(p.checkIn)}</p>
              <p className="text-[0.6rem] text-luxury-400 mt-0.5">From 12:00 PM</p>
            </div>
            <div className="rounded-2xl p-3 border border-luxury-100 bg-white">
              <p className="text-[0.55rem] font-bold text-luxury-400 uppercase tracking-[0.2em] mb-1">Check-out</p>
              <p className="font-semibold text-luxury-900 text-sm">{fmtDate(p.checkOut)}</p>
              <p className="text-[0.6rem] text-luxury-400 mt-0.5">By 11:00 AM</p>
            </div>
          </div>

          {/* Guests + nights */}
          <div className="br-section flex items-center justify-between rounded-2xl px-3 py-2.5 border border-luxury-100 bg-white">
            <p className="text-xs text-luxury-700">
              👥 {p.adults} adult{p.adults > 1 ? "s" : ""}
              {p.children ? ` · ${p.children} child${p.children > 1 ? "ren" : ""}` : ""}
              {p.kids ? ` · ${p.kids} kid${p.kids > 1 ? "s" : ""}` : ""}
              {` · ${p.nights} night${p.nights > 1 ? "s" : ""}`}
            </p>
            <span className="text-[0.55rem] font-bold uppercase tracking-wider text-emerald-600 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">✓ Confirmed</span>
          </div>

          {/* Rate breakdown */}
          <div className="br-section rounded-2xl p-4 border-2 border-gold-200 bg-gradient-to-br from-gold-50 to-amber-50">
            <p className="text-[0.6rem] font-bold text-gold-600 uppercase tracking-[0.2em] mb-2.5">Rate Breakdown</p>
            <div className="space-y-1.5 text-sm">
              {p.rateLines.map((line, i) => (
                <div key={i} className={`flex justify-between ${line.subtle ? "text-luxury-500 text-[0.78rem]" : "text-luxury-700"}`}>
                  <span>{line.label}</span>
                  <span className={line.subtle ? "" : "font-semibold"}>{line.value}</span>
                </div>
              ))}
              <div className="border-t border-gold-300 pt-2 mt-2 flex justify-between items-end">
                <span className="font-bold text-luxury-900">Total</span>
                <div className="text-right">
                  <p className="text-[2rem] leading-none font-extrabold br-gold-text">{fmt(p.totalAmount)}</p>
                  {p.nights > 1 && (
                    <p className="text-[0.6rem] text-luxury-500 mt-0.5">{fmt(Math.round(p.totalAmount / p.nights))}/night avg</p>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Hold info card */}
          {(p.holdEnabled !== false && p.onHold) && (
            <div className="br-section rounded-2xl p-4 border"
              style={{ background: "linear-gradient(135deg,rgba(16,185,129,0.06),rgba(240,180,41,0.04))", borderColor: "rgba(16,185,129,0.25)" }}>
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-full bg-emerald-50 border border-emerald-200 flex items-center justify-center text-lg shrink-0"
                  style={{ animation: "brPulse 2.5s ease-in-out infinite" }}>🔒</div>
                <div className="flex-1">
                  <p className="text-sm font-bold text-emerald-700">Not ready? Hold this rate for 24 hours</p>
                  <p className="text-[0.7rem] text-emerald-600 mt-0.5 leading-relaxed">
                    Pay just <span className="font-extrabold">{fmt(holdAmount)}</span> now to lock {fmt(p.totalAmount)} —
                    pay the balance <span className="font-extrabold">{fmt(balanceDue)}</span> within 24h
                    {p.payAtHotelEnabled ? " (or settle at the hotel desk)" : ""}.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* STICKY CTA FOOTER */}
        <div className="border-t border-luxury-100 bg-white/95 backdrop-blur-sm p-4 space-y-2.5"
          style={{ boxShadow: "0 -8px 24px -8px rgba(0,0,0,0.12)" }}>

          <button onClick={() => run("pay", p.onPayFull)}
            disabled={!!busy}
            className="br-cta-pay w-full py-3.5 rounded-2xl font-extrabold text-base tracking-wide disabled:opacity-40 transition-transform active:scale-[0.99]"
            style={{
              background: "linear-gradient(135deg,#b8871a 0%,#f0b429 48%,#fbd26a 60%,#c9911a 100%)",
              color: "#1a1205",
              boxShadow: "0 8px 24px rgba(240,180,41,0.4), 0 0 0 1px rgba(255,255,255,0.15) inset",
            }}>
            {busy === "pay" ? "⏳ Opening Razorpay…" : `✨ Pay Full ${fmt(p.totalAmount)} & Confirm`}
          </button>

          {(p.holdEnabled !== false && p.onHold) && (
            <button onClick={() => run("hold", () => p.onHold!(holdAmount))}
              disabled={!!busy}
              className="w-full py-3 rounded-2xl font-bold text-sm tracking-wide border-2 disabled:opacity-40 transition-all active:scale-[0.99]"
              style={{
                background: "linear-gradient(135deg,#ecfdf5,#fff)",
                borderColor: "rgba(16,185,129,0.45)",
                color: "#065f46",
              }}>
              {busy === "hold" ? "⏳ Opening Razorpay…" : `🔒 Hold for 24h · Pay just ${fmt(holdAmount)}`}
            </button>
          )}

          {(p.payAtHotelEnabled && p.onPayAtHotel) && (
            <button onClick={() => run("payhotel", () => p.onPayAtHotel!(holdAmount))}
              disabled={!!busy}
              className="w-full py-2.5 rounded-2xl font-semibold text-xs tracking-wide border disabled:opacity-40 transition-all active:scale-[0.99] text-luxury-700 border-luxury-200 hover:border-luxury-400 bg-luxury-50">
              {busy === "payhotel" ? "⏳ Opening…" : `🏨 Pay ${fmt(holdAmount)} now · Settle balance at hotel`}
            </button>
          )}

          <p className="text-[0.6rem] text-center text-luxury-400 leading-relaxed">
            Secure payment via Razorpay · Refundable if hotel cancels · Earn {Math.floor(p.totalAmount / 100) * 5} StayPoints
          </p>
        </div>
      </div>
    </div>
  );
}
