"use client";
// ── Booking Review modal ───────────────────────────────────────────────
// Sits between "user picks bid/accept/book" and the actual Razorpay
// payment. Shows complete trip details + lets customer:
//   • Update (re-open the original modal to change dates/guests/amount)
//   • Apply a coupon code (v124)
//   • Toggle wallet credit (v124)
//   • Pay Full ₹X & Book — instant confirm
//   • 🔒 Hold for 24h · ₹Y — lock the price, balance settles later
//
// Used by: Book Now, Flash Deal, Negotiate (above-floor), Counter-Accept,
// and My Bids "Pay Now". The component is intentionally dumb — parent
// owns the actions and passes them as callbacks.

import { useEffect, useState } from "react";
import Link from "next/link";
import { computeHoldAmount, type HoldTier } from "@/lib/hold-amount";
import ModalCloseButton from "@/components/ModalCloseButton";
// v143 — auto-fire the bookingReview modal tour on mount. Triggered
// once per user (or per session for anonymous). Selectors target the
// 3 CTAs (br-pay / br-hold / br-payhotel) via data-tour attrs below.
import { useTutorial } from "@/lib/tutorial/tutorial-store";
import {
  getPendingRedemption,
  clearPendingRedemption,
  normalizeCodeInput,
  type PendingRedemption,
} from "@/lib/redemption";
import { api } from "@/lib/api";

export type RateLine = { label: string; value: string; subtle?: boolean };

export type AppliedRedemption = {
  couponCode?: string;
  couponDiscountInr?: number;
  walletCreditAppliedInr?: number;
};

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
  // v241 — multi-room booking. When numRooms > 1, the guest+nights
  // line surfaces "· N rooms" and the per-room-per-night avg uses
  // (total / nights / numRooms). capacityMismatch when true shows a
  // soft info chip so customer knows the hotel may need to confirm
  // extra-bed / rollaway configuration on check-in.
  numRooms?: number;
  capacityMismatch?: boolean;
  // Pricing
  rateLines: RateLine[];      // detailed breakdown
  totalAmount: number;        // full amount due BEFORE redemption
  flowLabel?: string;         // "Book Now" / "Flash Deal" / "Bid Accepted" — shown as a context chip
  // Actions — receive the (possibly-discounted) final amount as 1st arg
  onUpdate?: () => void;      // optional — if present, "Update" chip is shown
  onPayFull: (finalAmount: number, applied: AppliedRedemption) => void | Promise<void>;
  onHold?: (holdAmount: number, finalAmount: number, applied: AppliedRedemption) => void | Promise<void>;
  onPayAtHotel?: (holdAmount: number, finalAmount: number, applied: AppliedRedemption) => void | Promise<void>;
  // Hotel config (per-hotel toggles — fallback to defaults)
  holdEnabled?: boolean;
  payAtHotelEnabled?: boolean;
  holdTiers?: HoldTier[];
  // v124 — when true, render the coupon + wallet-credit row. Defaults true.
  // Pass false on flows where redemption shouldn't apply (e.g. hold-balance
  // settlement modal).
  allowRedemption?: boolean;
  // Pre-fetched wallet credit balance (₹) — saves a round-trip on open
  walletCreditBalance?: number;
};

export default function BookingReview(p: BookingReviewProps) {
  const [busy, setBusy] = useState<"" | "pay" | "hold" | "payhotel">("");
  // v143 — fire the bookingReview tour on first open. delayMs:550 so
  // the sticky CTA footer renders + animates in before spotlight.
  const { triggerTour } = useTutorial();
  useEffect(() => {
    triggerTour("bookingReview", { delayMs: 550 });
    // Only on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // v124 — redemption state
  const [couponInput, setCouponInput] = useState("");
  const [couponDiscount, setCouponDiscount] = useState(0);
  const [couponMsg, setCouponMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [couponBusy, setCouponBusy] = useState(false);
  const [walletCreditBalance, setWalletCreditBalance] = useState(p.walletCreditBalance || 0);
  const [walletCreditOn, setWalletCreditOn] = useState(false);

  // Block body scroll while open + hide BottomDock so its CTAs don't peek
  // through the bottom-sheet on mobile.
  useEffect(() => {
    if (!p.open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.body.classList.add("sb-modal-open");
    return () => {
      document.body.style.overflow = prev;
      document.body.classList.remove("sb-modal-open");
    };
  }, [p.open]);

  // On open, pull any pending coupon queued from /my-codes + fresh wallet
  // credit balance (covers cases where prop wasn't passed).
  useEffect(() => {
    if (!p.open) return;
    if (p.allowRedemption === false) return;

    const pending: PendingRedemption | null = getPendingRedemption();
    if (pending && pending.code) {
      setCouponInput(pending.code);
      // Auto-validate
      validateCoupon(pending.code, true);
    }
    // Fetch wallet credit balance if not provided
    if (!p.walletCreditBalance) {
      api.getMyRedemptionCodes().then((d: any) => {
        const bal = Number(d?.walletCredit?.balance_inr || 0);
        setWalletCreditBalance(bal);
      }).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.open]);

  if (!p.open) return null;

  const baseTotal = p.totalAmount;
  // Wallet credit max applicable = min(balance, remaining-after-coupon)
  const afterCoupon = Math.max(0, baseTotal - couponDiscount);
  const walletCreditApplied = walletCreditOn ? Math.min(walletCreditBalance, afterCoupon) : 0;
  const finalAmount = Math.max(0, afterCoupon - walletCreditApplied);

  const holdAmount = computeHoldAmount(finalAmount, p.holdTiers);
  const balanceDue = finalAmount - holdAmount;
  const fmt = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
  const fmtDate = (s: string) =>
    new Date(s).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });

  async function validateCoupon(rawCode: string, silent = false) {
    const code = normalizeCodeInput(rawCode);
    if (!code) return;
    setCouponBusy(true);
    setCouponMsg(null);
    try {
      const r: any = await api.validateRedemptionCode(code, baseTotal);
      if (r?.ok && r?.willApply?.ok) {
        setCouponDiscount(Number(r.willApply.discountInr || 0));
        setCouponInput(code);
        if (!silent) setCouponMsg({ kind: "ok", text: `Applied: ${fmt(r.willApply.discountInr)} off` });
        else setCouponMsg({ kind: "ok", text: `Coupon ready: ${fmt(r.willApply.discountInr)} off` });
      } else {
        setCouponDiscount(0);
        setCouponMsg({ kind: "err", text: r?.error || r?.willApply?.error || "Invalid code" });
      }
    } catch (e: any) {
      setCouponMsg({ kind: "err", text: e?.message || "Network error" });
    } finally {
      setCouponBusy(false);
    }
  }

  function removeCoupon() {
    setCouponInput("");
    setCouponDiscount(0);
    setCouponMsg(null);
    clearPendingRedemption();
  }

  const appliedPayload: AppliedRedemption = {
    couponCode: couponDiscount > 0 ? couponInput : undefined,
    couponDiscountInr: couponDiscount > 0 ? couponDiscount : undefined,
    walletCreditAppliedInr: walletCreditApplied > 0 ? walletCreditApplied : undefined,
  };

  const run = async (kind: "pay" | "hold" | "payhotel", fn: (final: number, applied: AppliedRedemption) => any) => {
    if (busy) return;
    setBusy(kind);
    try { await fn(finalAmount, appliedPayload); } finally { setBusy(""); }
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center backdrop-blur-md"
      style={{ background: "rgba(2,4,12,0.78)", paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      onClick={p.onClose}
    >
      <div
        className="w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl overflow-hidden relative flex flex-col"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "linear-gradient(180deg,#fff 0%,#fafaf7 100%)",
          boxShadow: "0 30px 80px -10px rgba(0,0,0,0.4), 0 0 0 1px rgba(240,180,41,0.12)",
          // v228 — flex column with capped height. Header + footer are
          // flex-shrink-0 (auto-size to content); body is flex-1 + scrolls.
          // Old fixed `maxHeight: calc(94vh - 64px - 96px)` on body assumed a
          // 96px footer, but the Shimla case renders Pay Full + Hold + Pay-
          // at-Hotel = ~220px footer, so the body extended behind the CTAs
          // and content got cut from the bottom. Flex layout = the body
          // shrinks to whatever space is left after the footer renders.
          maxHeight: "94dvh",
        }}
      >
        <style>{`
          @keyframes brShine { 0%,100%{background-position:0% 50%} 50%{background-position:100% 50%} }
          @keyframes brSweep { 0%{transform:translateX(-120%)} 100%{transform:translateX(220%)} }
          @keyframes brPulse { 0%,100%{transform:scale(1);opacity:.9} 50%{transform:scale(1.06);opacity:1} }
          @keyframes brFadeUp{ from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }
          .br-gold-text{background:linear-gradient(90deg,#b8871a,#f0b429,#c9911a,#f0b429,#b8871a);background-size:220% auto;-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;animation:brShine 6s linear infinite}
          .br-cta-pay{position:relative;overflow:hidden}
          .br-cta-pay::after{content:"";position:absolute;inset:0;background:linear-gradient(110deg,transparent 30%,rgba(255,255,255,.55) 50%,transparent 70%);transform:translateX(-120%);animation:brSweep 2.6s ease-in-out infinite}
          .br-section{animation:brFadeUp .35s ease both}
        `}</style>

        {/* HEADER — v228 flex-shrink-0 so body shrinks, not header */}
        <div className="relative px-5 py-4 flex items-center justify-between border-b shrink-0"
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
          <ModalCloseButton onClose={p.onClose} tone="dark" />
        </div>

        {/* SCROLLABLE BODY — v228 flex-1 + min-h-0 so it shrinks to fit
            whatever vertical space the header + footer don't claim. Removed
            the brittle `maxHeight: calc(94vh - 64px - 96px)` math that
            assumed a 96px footer and broke on the 3-CTA Shimla case. */}
        <div className="overflow-y-auto p-5 space-y-4 flex-1 min-h-0" data-autonext-form>

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

          {/* Guests + nights + rooms (v241) */}
          <div className="br-section flex items-center justify-between rounded-2xl px-3 py-2.5 border border-luxury-100 bg-white">
            <p className="text-xs text-luxury-700">
              👥 {p.adults} adult{p.adults > 1 ? "s" : ""}
              {p.children ? ` · ${p.children} child${p.children > 1 ? "ren" : ""}` : ""}
              {p.kids ? ` · ${p.kids} kid${p.kids > 1 ? "s" : ""}` : ""}
              {` · ${p.nights} night${p.nights > 1 ? "s" : ""}`}
              {p.numRooms && p.numRooms > 1 ? ` · ${p.numRooms} room${p.numRooms > 1 ? "s" : ""}` : ""}
            </p>
            <span className="text-[0.55rem] font-bold uppercase tracking-wider text-emerald-600 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">✓ Confirmed</span>
          </div>
          {/* v241 — capacity-mismatch info chip. Customer has more
              guests than the resolved (rooms × capacity) supports.
              Most hotels accommodate via rollaway / extra bed; some
              don't. Shown as a soft info chip — not blocking. */}
          {p.capacityMismatch && (
            <div className="br-section rounded-2xl px-3 py-2 border border-amber-200 bg-amber-50/50">
              <p className="text-[0.68rem] text-amber-800 leading-snug">
                ℹ️ Your {p.adults + (p.children || 0)}-guest count is above {p.numRooms || 1} room standard capacity. Hotel will confirm extra-bed / rollaway setup on check-in.
              </p>
            </div>
          )}

          {/* v124 — Redemption row */}
          {p.allowRedemption !== false && (
            <div className="br-section rounded-2xl p-3 border-2 border-dashed border-gold-200 bg-gold-50/40 space-y-2.5">
              <div className="flex items-center justify-between">
                <p className="text-[0.6rem] font-bold text-gold-700 uppercase tracking-[0.2em]">🎟️ Coupon · 💰 Wallet</p>
                <Link href="/my-codes" className="text-[0.6rem] font-bold text-gold-600 hover:text-gold-700">My codes →</Link>
              </div>

              {/* Coupon input */}
              {couponDiscount > 0 ? (
                <div className="flex items-center justify-between bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-base">✓</span>
                    <div className="min-w-0">
                      <p className="font-mono text-xs font-bold text-emerald-800 truncate">{couponInput}</p>
                      <p className="text-[0.6rem] text-emerald-700">{fmt(couponDiscount)} off applied</p>
                    </div>
                  </div>
                  <button onClick={removeCoupon} className="text-[0.6rem] font-bold text-red-600 hover:text-red-700 px-2 py-1 rounded-md shrink-0">
                    Remove
                  </button>
                </div>
              ) : (
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    inputMode="text"
                    value={couponInput}
                    onChange={(e) => { setCouponInput(e.target.value.toUpperCase()); setCouponMsg(null); }}
                    placeholder="Enter coupon code"
                    className="flex-1 rounded-xl border border-luxury-200 bg-white px-3 py-2 text-sm font-mono tracking-wider uppercase placeholder:font-sans placeholder:tracking-normal focus:outline-none focus:border-gold-400"
                  />
                  <button
                    onClick={() => validateCoupon(couponInput)}
                    disabled={couponBusy || !couponInput.trim()}
                    className="px-3 py-2 rounded-xl text-xs font-bold text-white disabled:opacity-40"
                    style={{ background: "linear-gradient(135deg,#b8871a,#f0b429,#c9911a)" }}>
                    {couponBusy ? "…" : "Apply"}
                  </button>
                </div>
              )}
              {couponMsg && couponDiscount === 0 && (
                <p className={`text-[0.65rem] font-semibold ${couponMsg.kind === "err" ? "text-red-600" : "text-emerald-700"}`}>
                  {couponMsg.text}
                </p>
              )}

              {/* Wallet credit toggle */}
              {walletCreditBalance > 0 && (
                <button
                  onClick={() => setWalletCreditOn((v) => !v)}
                  className={`w-full flex items-center justify-between rounded-xl px-3 py-2 border-2 transition ${
                    walletCreditOn ? "bg-emerald-50 border-emerald-300" : "bg-white border-luxury-200 hover:border-gold-300"
                  }`}>
                  <div className="flex items-center gap-2">
                    <span className="text-lg">💰</span>
                    <div className="text-left">
                      <p className="text-xs font-bold text-luxury-900">Wallet Credit</p>
                      <p className="text-[0.6rem] text-luxury-500">Available: {fmt(walletCreditBalance)}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    {walletCreditOn ? (
                      <>
                        <p className="text-xs font-bold text-emerald-700">−{fmt(walletCreditApplied)}</p>
                        <p className="text-[0.55rem] uppercase tracking-wider font-bold text-emerald-600">Applied</p>
                      </>
                    ) : (
                      <p className="text-[0.6rem] uppercase tracking-wider font-bold text-gold-600">Apply →</p>
                    )}
                  </div>
                </button>
              )}
              {walletCreditBalance === 0 && couponDiscount === 0 && (
                <Link href="/points/redeem" className="block text-center text-[0.65rem] font-semibold text-gold-600 hover:text-gold-700 underline">
                  No codes yet — redeem with StayPoints
                </Link>
              )}
            </div>
          )}

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
              {couponDiscount > 0 && (
                <div className="flex justify-between text-emerald-700 font-semibold pt-1">
                  <span>Coupon discount</span>
                  <span>−{fmt(couponDiscount)}</span>
                </div>
              )}
              {walletCreditApplied > 0 && (
                <div className="flex justify-between text-emerald-700 font-semibold">
                  <span>Wallet credit</span>
                  <span>−{fmt(walletCreditApplied)}</span>
                </div>
              )}
              <div className="border-t border-gold-300 pt-2 mt-2 flex justify-between items-end">
                <span className="font-bold text-luxury-900">Total</span>
                <div className="text-right">
                  {(couponDiscount > 0 || walletCreditApplied > 0) && (
                    <p className="text-xs line-through text-luxury-400 mb-0.5">{fmt(baseTotal)}</p>
                  )}
                  <p className="text-[2rem] leading-none font-extrabold br-gold-text">{fmt(finalAmount)}</p>
                  {/* v241 — per-room-per-night avg when numRooms > 1
                      so multi-room customers see the comparable rate
                      (not a misleading per-night total/nights). */}
                  {((p.nights > 1) || ((p.numRooms || 1) > 1)) && finalAmount > 0 && (
                    <p className="text-[0.6rem] text-luxury-500 mt-0.5">
                      {fmt(Math.round(finalAmount / Math.max(1, p.nights) / Math.max(1, p.numRooms || 1)))}
                      /room/night avg
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Hold info card */}
          {(p.holdEnabled !== false && p.onHold && finalAmount > 0) && (
            <div className="br-section rounded-2xl p-4 border"
              style={{ background: "linear-gradient(135deg,rgba(16,185,129,0.06),rgba(240,180,41,0.04))", borderColor: "rgba(16,185,129,0.25)" }}>
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-full bg-emerald-50 border border-emerald-200 flex items-center justify-center text-lg shrink-0"
                  style={{ animation: "brPulse 2.5s ease-in-out infinite" }}>🔒</div>
                <div className="flex-1">
                  <p className="text-sm font-bold text-emerald-700">Not ready? Hold this rate for 24 hours</p>
                  <p className="text-[0.7rem] text-emerald-600 mt-0.5 leading-relaxed">
                    Pay just <span className="font-extrabold">{fmt(holdAmount)}</span> now to lock {fmt(finalAmount)} —
                    pay the balance <span className="font-extrabold">{fmt(balanceDue)}</span> within 24h
                    {p.payAtHotelEnabled ? " (or settle at the hotel desk)" : ""}.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* STICKY CTA FOOTER — v228 flex-shrink-0 so it always renders fully
            + safe-area-inset-bottom padding so home-indicator phones don't
            cover the bottom CTA. Padding-bottom keeps the 16px gap on
            devices without a home indicator AND adds env() inset on top. */}
        <div className="border-t border-luxury-100 bg-white/95 backdrop-blur-sm p-4 space-y-2.5 shrink-0"
          style={{
            boxShadow: "0 -8px 24px -8px rgba(0,0,0,0.12)",
            paddingBottom: "calc(16px + env(safe-area-inset-bottom, 0px))",
          }}>

          <button data-tour="br-pay" onClick={() => run("pay", p.onPayFull)}
            disabled={!!busy}
            className="br-cta-pay w-full py-3.5 rounded-2xl font-extrabold text-base tracking-wide disabled:opacity-40 transition-transform active:scale-[0.99]"
            style={{
              background: "linear-gradient(135deg,#b8871a 0%,#f0b429 48%,#fbd26a 60%,#c9911a 100%)",
              color: "#1a1205",
              boxShadow: "0 8px 24px rgba(240,180,41,0.4), 0 0 0 1px rgba(255,255,255,0.15) inset",
            }}>
            {busy === "pay" ? "⏳ Opening Razorpay…" :
             finalAmount === 0 ? `✨ Confirm Booking — FREE`
             : `✨ Pay ${fmt(finalAmount)} & Confirm`}
          </button>

          {(p.holdEnabled !== false && p.onHold && finalAmount > 0) && (
            <button data-tour="br-hold" onClick={() => run("hold", (final, applied) => p.onHold!(holdAmount, final, applied))}
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

          {(p.payAtHotelEnabled && p.onPayAtHotel && finalAmount > 0) && (
            <button data-tour="br-payhotel" onClick={() => run("payhotel", (final, applied) => p.onPayAtHotel!(holdAmount, final, applied))}
              disabled={!!busy}
              className="w-full py-2.5 rounded-2xl font-semibold text-xs tracking-wide border disabled:opacity-40 transition-all active:scale-[0.99] text-luxury-700 border-luxury-200 hover:border-luxury-400 bg-luxury-50">
              {busy === "payhotel" ? "⏳ Opening…" : `🏨 Pay ${fmt(holdAmount)} now · Settle balance at hotel`}
            </button>
          )}

          <p className="text-[0.6rem] text-center text-luxury-400 leading-relaxed">
            Secure payment via Razorpay · Refundable if hotel cancels · Earn {Math.floor(finalAmount / 100) * 5} StayPoints
          </p>
        </div>
      </div>
    </div>
  );
}
