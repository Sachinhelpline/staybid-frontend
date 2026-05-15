"use client";
import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { openRazorpayCheckout } from "@/lib/razorpay";
import { resolveBidDisplayAmount, extractCustomerBidFromMessage } from "@/lib/paid-amount";
import BookingReview, { type BookingReviewProps } from "@/components/BookingReview";
import { saveHoldState, holdExpiresAt } from "@/lib/hold-amount";
import AcceptedBidTimer from "@/components/AcceptedBidTimer";
import AutoAcceptCountdown from "@/components/AutoAcceptCountdown";
import { notify } from "@/lib/notifications";
import { isSeen, markSeen } from "@/lib/notifications";
import { clearWindow as clearAcceptWindow, hydrateAcceptanceWindowsFromServer } from "@/lib/auto-cancel";

const STATUS_META: Record<string, { label: string; dot: string; chip: string; glow: string }> = {
  PENDING:  { label: "Pending",   dot: "bg-amber-400",   chip: "text-amber-300 border-amber-400/40 bg-amber-500/10",   glow: "shadow-[0_0_18px_rgba(245,158,11,0.25)]" },
  COUNTER:  { label: "Countered", dot: "bg-orange-400",  chip: "text-orange-300 border-orange-400/40 bg-orange-500/10", glow: "shadow-[0_0_18px_rgba(249,115,22,0.25)]" },
  ACCEPTED: { label: "Accepted",  dot: "bg-emerald-400", chip: "text-emerald-300 border-emerald-400/40 bg-emerald-500/10", glow: "shadow-[0_0_24px_rgba(52,211,153,0.35)]" },
  REJECTED: { label: "Rejected",  dot: "bg-red-400",     chip: "text-red-300 border-red-400/40 bg-red-500/10",         glow: "shadow-[0_0_18px_rgba(239,68,68,0.25)]" },
};

const isPaid = (b: any) => typeof b?.message === "string" && b.message.includes("Razorpay:");

function nightsBetween(a?: string, b?: string): number {
  if (!a || !b) return 1;
  const ms = new Date(b).getTime() - new Date(a).getTime();
  return Math.max(1, Math.ceil(ms / 86400000));
}

function fmtDate(s?: string) {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

export default function MyBidsPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [bids, setBids] = useState<any[]>([]);
  const [units, setUnits] = useState<Record<string, { unitId: string; unitNumber: string }>>({});
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState("");
  const [filter, setFilter] = useState<"ALL"|"PENDING"|"COUNTER"|"ACCEPTED"|"REJECTED">("ALL");
  const [celebrateId, setCelebrateId] = useState<string>("");
  const [confettiBurst, setConfettiBurst] = useState(0);
  const [review, setReview] = useState<null | (Omit<BookingReviewProps,"open"|"onClose">)>(null);
  // Phase 6: auto-accept info per bid — fetched from Supabase side-channel
  // since Railway's /api/bids/my doesn't include the new columns.
  const [autoAcceptInfo, setAutoAcceptInfo] = useState<Record<string, { auto_accept_at: string | null; bidder_tier: string | null }>>({});

  // Celebration sound — synthesized with WebAudio so it ships without any asset file.
  const playCelebrateSound = () => {
    try {
      const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!AC) return;
      const ctx = new AC();
      const notes = [ [523.25, 0],   [659.25, 0.12], [783.99, 0.24], [1046.5, 0.36] ]; // C5 E5 G5 C6
      notes.forEach(([freq, t]) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(freq, ctx.currentTime + t);
        gain.gain.setValueAtTime(0, ctx.currentTime + t);
        gain.gain.linearRampToValueAtTime(0.22, ctx.currentTime + t + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.45);
        osc.connect(gain).connect(ctx.destination);
        osc.start(ctx.currentTime + t);
        osc.stop(ctx.currentTime + t + 0.5);
      });
      setTimeout(() => ctx.close().catch(() => {}), 1500);
    } catch { /* ignore */ }
  };

  const triggerCelebration = (bidId: string) => {
    setCelebrateId(bidId);
    setConfettiBurst((n) => n + 1);
    playCelebrateSound();
    setTimeout(() => setCelebrateId(""), 5000);
  };

  // Resolve checkIn/checkOut from the bid record. Backend stores dates on
  // BidRequest, NOT on Bid — so b.checkIn is usually undefined; pull from
  // b.request, b.bidRequest (camelCase variants), and finally the
  // localStorage `bid_dates_{bidId}` fallback the booking flow writes.
  const resolveDates = (b: any) => {
    let stored: any = null;
    try {
      stored = JSON.parse(localStorage.getItem(`bid_dates_${b.id}`) || "null");
    } catch {}
    return {
      checkIn:  b.checkIn  || b.request?.checkIn  || b.bidRequest?.checkIn  || b.Request?.checkIn  || stored?.checkIn  || null,
      checkOut: b.checkOut || b.request?.checkOut || b.bidRequest?.checkOut || b.Request?.checkOut || stored?.checkOut || null,
    };
  };

  const fetchBids = (silent = false) => {
    if (!silent) setLoading(true);
    api.getMyBids()
      .then(async (d) => {
        // Normalize: every bid gets checkIn/checkOut from the fallback chain
        const list = (d.bids || []).map((b: any) => {
          const { checkIn, checkOut } = resolveDates(b);
          return { ...b, checkIn, checkOut };
        });
        // Fetch unit assignments for these bid IDs (shows allocated room #)
        try {
          const token = localStorage.getItem("sb_token");
          const ids = list.map((b: any) => b.id).filter(Boolean);
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

        // Phase 6: fetch auto_accept_at + bidder_tier for PENDING bids
        try {
          const token = localStorage.getItem("sb_token");
          const pendingIds = list.filter((b: any) => b.status === "PENDING").map((b: any) => b.id);
          if (pendingIds.length) {
            const r = await fetch(`/api/bids/auto-accept-info?ids=${encodeURIComponent(pendingIds.join(","))}`, {
              headers: { Authorization: `Bearer ${token}` },
            });
            const j = await r.json();
            if (j?.info) setAutoAcceptInfo(j.info);
          }
        } catch {}
        setBids((prev) => {
          // v74 fix: don't spam 14 toasts on first load. Show ONE summary
          // toast covering all unpaid ACCEPTED/COUNTER bids. NotificationToast
          // only stacks 4 — silently dropping the rest while still marking
          // them isSeen() caused "ek dekha baki gayab" bug.
          const prevMap = new Map(prev.map((b: any) => [b.id, b.status]));
          const isFirstLoad = prev.length === 0;

          // ── FIRST-LOAD: aggregated summary ─────────────────────────
          if (isFirstLoad) {
            const unpaidAccepted = list.filter((b: any) => b.status === "ACCEPTED" && !isPaid(b));
            const counters = list.filter((b: any) => b.status === "COUNTER");
            const summaryId = `summary-${unpaidAccepted.length}-${counters.length}-${list.length}`;

            if (unpaidAccepted.length >= 2 && !isSeen(summaryId)) {
              markSeen(summaryId);
              notify({
                id: summaryId,
                kind: "bid_accepted",
                title: `💰 ${unpaidAccepted.length} unpaid accepted bids`,
                body: `Pay now to lock these bookings before they auto-cancel after 15 min each.`,
                actions: [{ label: "View All", href: "/my-bids", primary: true }],
                duration: 10000,
              });
            } else if (unpaidAccepted.length === 1) {
              const b = unpaidAccepted[0];
              const notifId = `bid-${b.id}-ACCEPTED`;
              if (!isSeen(notifId)) {
                markSeen(notifId);
                notify({
                  id: notifId,
                  kind: "bid_accepted",
                  title: "💰 Unpaid accepted bid",
                  body: `${b.hotel?.name || "The hotel"} accepted your bid — pay now to confirm booking.`,
                  actions: [
                    { label: "Pay Now", href: "#", onClick: () => handlePayNow(b), primary: true },
                    { label: "View", href: "/my-bids" },
                  ],
                });
              }
            }

            if (counters.length >= 2) {
              const cSummary = `counter-summary-${counters.length}`;
              if (!isSeen(cSummary)) {
                markSeen(cSummary);
                notify({
                  id: cSummary,
                  kind: "bid_countered",
                  title: `🤝 ${counters.length} counter offers pending`,
                  body: `Hotels have countered — review and decide.`,
                  actions: [{ label: "Review", href: "/my-bids", primary: true }],
                  duration: 10000,
                });
              }
            } else if (counters.length === 1) {
              const b = counters[0];
              const notifId = `bid-${b.id}-COUNTER`;
              if (!isSeen(notifId)) {
                markSeen(notifId);
                notify({
                  id: notifId,
                  kind: "bid_countered",
                  title: "🤝 Counter offer pending",
                  body: `New offer: ₹${(b.counterAmount || 0).toLocaleString()}/night. Review and accept or decline.`,
                  actions: [{ label: "Review", href: "/my-bids", primary: true }],
                });
              }
            }
          }

          // ── REAL-TIME TRANSITIONS during polling ───────────────────
          // These still fire individually since transitions are rare
          // (usually max 1-2 at a time during a 15-second poll).
          for (const b of list) {
            const was = prevMap.get(b.id);
            if (!was || was === b.status) continue; // skip if no transition
            const notifId = `bid-${b.id}-${b.status}`;
            if (b.status === "ACCEPTED" && !isPaid(b)) {
              triggerCelebration(b.id);
              if (!isSeen(notifId)) {
                markSeen(notifId);
                notify({
                  id: notifId,
                  kind: "bid_accepted",
                  title: "🎉 Bid accepted!",
                  body: `${b.hotel?.name || "The hotel"} accepted your bid. Pay within 15 min to lock the booking.`,
                  actions: [
                    { label: "Pay Now", href: "#", onClick: () => handlePayNow(b), primary: true },
                    { label: "View", href: "/my-bids" },
                  ],
                });
              }
            } else if (b.status === "COUNTER") {
              if (!isSeen(notifId)) {
                markSeen(notifId);
                notify({
                  id: notifId,
                  kind: "bid_countered",
                  title: "🤝 Hotel countered your bid",
                  body: `New offer: ₹${(b.counterAmount || 0).toLocaleString()}/night. Review and accept or decline.`,
                  actions: [{ label: "Review", href: "/my-bids", primary: true }],
                });
              }
            } else if (b.status === "REJECTED") {
              if (!isSeen(notifId)) {
                markSeen(notifId);
                notify({
                  id: notifId,
                  kind: "bid_rejected",
                  title: "Bid declined",
                  body: `${b.hotel?.name || "The hotel"} couldn't accept your bid. Try another offer or hotel.`,
                });
              }
            }
          }
          return list;
        });
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.push("/auth"); return; }
    // Phase 5: hydrate cross-device acceptance windows once on mount.
    hydrateAcceptanceWindowsFromServer().catch(() => {});
    fetchBids();
    const t = setInterval(() => fetchBids(true), 15_000);
    return () => clearInterval(t);
  }, [user, authLoading, router]);

  // Counter accept routes through BookingReview so customer can pick
  // Pay-Full / Hold / Pay-At-Hotel before charging.
  const handleCounterAccept = (b: any) => {
    const counterAmt = Number(b.counterAmount || b.amount || 0);
    const nights = nightsBetween(b.checkIn, b.checkOut);
    const total = counterAmt * nights;
    if (!total) { alert("Invalid amount"); return; }
    const rateLines = [
      { label: `₹${counterAmt.toLocaleString()} × ${nights} night${nights>1?"s":""}`, value: `₹${total.toLocaleString()}` },
      { label: "Hotel countered at this rate", value: "Accepted", subtle: true },
    ];
    setReview({
      hotelName: b.hotel?.name || "Hotel",
      hotelCity: b.hotel?.city,
      roomType: b.room?.type,
      checkIn: b.checkIn || "", checkOut: b.checkOut || "", nights,
      adults: b.request?.guests || 2,
      rateLines, totalAmount: total,
      flowLabel: "🤝 Accept Counter",
      onUpdate: () => setReview(null),
      onPayFull: () => executeCounterAccept(b, "full", 0, { nights, total }),
      onHold:    (h) => executeCounterAccept(b, "hold", h, { nights, total }),
      onPayAtHotel: (h) => executeCounterAccept(b, "payhotel", h, { nights, total }),
      holdEnabled: true,
      payAtHotelEnabled: true,
    });
  };

  const executeCounterAccept = async (
    b: any,
    mode: "full" | "hold" | "payhotel",
    holdAmount: number,
    ctx: { nights: number; total: number }
  ) => {
    const bidId = b.id;
    const counterAmt = Number(b.counterAmount || b.amount || 0);
    setActionLoading(bidId);
    try {
      const { nights, total } = ctx;
      const charge = mode === "full" ? total : holdAmount;
      const payResult = await openRazorpayCheckout({
        amount: charge,
        hotelName: b.hotel?.name || "StayBid Booking",
        description: mode === "full"
          ? `Counter accept — ${nights} night${nights > 1 ? "s" : ""}`
          : `🔒 Hold counter · Lock ₹${total.toLocaleString()} for 24h`,
        userName: user?.name || "",
        userPhone: user?.phone || "",
      });
      const token = localStorage.getItem("sb_token");
      const res = await fetch(`/api/bids/${bidId}/counter-accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not accept counter offer");

      if (mode !== "full") {
        saveHoldState({
          bidId,
          hotelId: b.hotelId || b.hotel?.id, hotelName: b.hotel?.name || "Hotel",
          roomType: b.room?.type,
          holdAmount, balanceDue: total - holdAmount, totalAmount: total,
          holdPaymentId: payResult.razorpay_payment_id,
          expiresAt: holdExpiresAt().toISOString(), createdAt: new Date().toISOString(),
          status: "active", flow: "counter-accept",
          checkIn: b.checkIn, checkOut: b.checkOut,
          payAtHotel: mode === "payhotel",
        });
      }

      try {
        await fetch("/api/bid/paid", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            bidId, hotelId: b.hotelId || b.hotel?.id, roomId: b.roomId || b.room?.id,
            customerId: user?.id,
            paidTotal: charge, paidPerNight: counterAmt, nights,
            flow: mode === "full" ? "counter-accept" : `counter-accept-${mode}`,
            razorpayPaymentId: payResult.razorpay_payment_id,
          }),
        });
      } catch {}

      setReview(null);
      triggerCelebration(bidId);
      fetchBids(true);
    } catch (e: any) {
      if (e?.message === "__CANCELLED__") { return; }
      alert(e?.message || "Couldn't confirm the counter offer. Please try again.");
    } finally {
      setActionLoading("");
    }
  };

  const handleCounterReject = async (bidId: string) => {
    setActionLoading(bidId);
    try {
      const token = localStorage.getItem("sb_token");
      const res = await fetch(`/api/bids/${bidId}/counter-reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not decline");
      fetchBids(true);
    } catch (e: any) {
      alert(e?.message || "Couldn't decline the counter. Please try again.");
    } finally {
      setActionLoading("");
    }
  };

  // Pay-Now opens BookingReview first; charges happen in executePayNow.
  const handlePayNow = (b: any) => {
    const customerBid = extractCustomerBidFromMessage(b.message);
    const perNight = Number(
      b.counterAmount
        ?? (b.status === "ACCEPTED" ? (customerBid ?? b.amount) : (customerBid ?? b.amount))
        ?? 0
    );
    const nights = nightsBetween(b.checkIn, b.checkOut);
    const total = perNight * nights;
    if (!total) { alert("Invalid amount"); return; }
    const rateLines = [
      { label: `₹${perNight.toLocaleString()} × ${nights} night${nights>1?"s":""}`, value: `₹${total.toLocaleString()}` },
      { label: "Bid accepted by hotel", value: "Confirm to lock", subtle: true },
    ];
    setReview({
      hotelName: b.hotel?.name || "Hotel",
      hotelCity: b.hotel?.city,
      roomType: b.room?.type,
      checkIn: b.checkIn || "", checkOut: b.checkOut || "", nights,
      adults: b.request?.guests || 2,
      rateLines, totalAmount: total,
      flowLabel: "🎉 Accepted Bid",
      onUpdate: () => setReview(null),
      onPayFull: () => executePayNow(b, "full", 0, { nights, total, perNight }),
      onHold:    (h) => executePayNow(b, "hold", h, { nights, total, perNight }),
      onPayAtHotel: (h) => executePayNow(b, "payhotel", h, { nights, total, perNight }),
      holdEnabled: true,
      payAtHotelEnabled: true,
    });
  };

  const executePayNow = async (
    b: any,
    mode: "full" | "hold" | "payhotel",
    holdAmount: number,
    ctx: { nights: number; total: number; perNight: number }
  ) => {
    setActionLoading(b.id);
    try {
      const { nights, total, perNight } = ctx;
      const charge = mode === "full" ? total : holdAmount;
      const result = await openRazorpayCheckout({
        amount: charge,
        hotelName: b.hotel?.name || "StayBid Booking",
        description: mode === "full"
          ? `Confirmation payment — ${nights} night${nights > 1 ? "s" : ""}`
          : `🔒 Hold accepted bid · Lock ₹${total.toLocaleString()} for 24h`,
        userName: user?.name || "",
        userPhone: user?.phone || "",
      });

      const token = localStorage.getItem("sb_token");
      const res = await fetch(`/api/bids/${b.id}/pay`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ razorpay_payment_id: result.razorpay_payment_id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not confirm payment");

      if (mode !== "full") {
        saveHoldState({
          bidId: b.id,
          hotelId: b.hotelId || b.hotel?.id, hotelName: b.hotel?.name || "Hotel",
          roomType: b.room?.type,
          holdAmount, balanceDue: total - holdAmount, totalAmount: total,
          holdPaymentId: result.razorpay_payment_id,
          expiresAt: holdExpiresAt().toISOString(), createdAt: new Date().toISOString(),
          status: "active", flow: "pay-now",
          checkIn: b.checkIn, checkOut: b.checkOut,
          payAtHotel: mode === "payhotel",
        });
      }

      try {
        await fetch("/api/bid/paid", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            bidId: b.id, hotelId: b.hotelId || b.hotel?.id, roomId: b.roomId || b.room?.id,
            customerId: user?.id,
            paidTotal: charge, paidPerNight: perNight, nights,
            flow: mode === "full" ? "pay-now" : `pay-now-${mode}`,
            razorpayPaymentId: result.razorpay_payment_id,
          }),
        });
      } catch {}

      setReview(null);
      triggerCelebration(b.id);
      setTimeout(() => router.push("/bookings"), 1800);
    } catch (e: any) {
      if (e?.message === "__CANCELLED__") { /* user closed modal */ }
      else alert(e.message || "Payment failed");
    } finally {
      setActionLoading("");
    }
  };

  const filters = ["ALL", "PENDING", "COUNTER", "ACCEPTED", "REJECTED"] as const;
  const filtered = filter === "ALL" ? bids : bids.filter((b) => b.status === filter);

  const pendingCount  = useMemo(() => bids.filter((b) => b.status === "PENDING").length,  [bids]);
  const counterCount  = useMemo(() => bids.filter((b) => b.status === "COUNTER").length,  [bids]);
  const acceptedCount = useMemo(() => bids.filter((b) => b.status === "ACCEPTED").length, [bids]);
  const unpaidAccepted = useMemo(() => bids.filter((b) => b.status === "ACCEPTED" && !isPaid(b)).length, [bids]);

  return (
    <div className="min-h-screen text-white relative overflow-hidden"
      style={{
        background: "radial-gradient(1200px 600px at 20% -10%, rgba(201,145,26,0.18), transparent 60%), radial-gradient(900px 500px at 100% 10%, rgba(240,180,41,0.10), transparent 60%), linear-gradient(180deg,#05060a 0%, #0b0a10 50%, #05060a 100%)",
      }}
    >
      <style>{`
        @keyframes shine { 0% { background-position:-200% 0; } 100% { background-position:200% 0; } }
        @keyframes floaty { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-4px)} }
        @keyframes fadeUp { from{opacity:0;transform:translateY(14px)} to{opacity:1;transform:translateY(0)} }
        @keyframes pulseGlow { 0%,100%{box-shadow:0 0 0 0 rgba(240,180,41,0.55)} 50%{box-shadow:0 0 0 14px rgba(240,180,41,0)} }
        @keyframes celebPop { 0%{transform:scale(0.6);opacity:0} 40%{transform:scale(1.05);opacity:1} 100%{transform:scale(1);opacity:1} }
        @keyframes confettiFall { to { transform: translateY(110vh) rotate(720deg); opacity: 0; } }
        @keyframes goldSweep { 0% { transform: translateX(-120%); } 100% { transform: translateX(220%); } }
        .gold-text { background: linear-gradient(90deg,#f4d06f,#f0b429,#c9911a,#f0b429,#f4d06f); background-size:200% auto; -webkit-background-clip:text; background-clip:text; -webkit-text-fill-color:transparent; animation: shine 6s linear infinite; }
        .gold-btn { position:relative; overflow:hidden; background:linear-gradient(135deg,#b8871a 0%,#f0b429 48%,#fbd26a 60%,#c9911a 100%); color:#1a1205; font-weight:800; letter-spacing:.04em; }
        .gold-btn::after { content:""; position:absolute; inset:0; background:linear-gradient(110deg,transparent 30%, rgba(255,255,255,0.55) 50%, transparent 70%); transform:translateX(-120%); animation: goldSweep 2.6s ease-in-out infinite; }
        .glass-card { background:linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.015)); border:1px solid rgba(240,180,41,0.18); backdrop-filter: blur(14px); }
        .gold-border-anim { position:relative; }
        .gold-border-anim::before { content:""; position:absolute; inset:-1px; border-radius:inherit; padding:1px; background:linear-gradient(120deg,rgba(240,180,41,0.7),rgba(255,255,255,0.05) 30%, rgba(240,180,41,0.7) 60%, rgba(255,255,255,0.05) 85%); background-size:200% 200%; animation: shine 7s linear infinite; -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); -webkit-mask-composite: xor; mask-composite: exclude; pointer-events:none; }
        .confetti-piece { position:absolute; top:-10px; width:8px; height:14px; border-radius:2px; animation: confettiFall linear forwards; }
      `}</style>

      {/* Confetti burst */}
      {confettiBurst > 0 && (
        <div key={confettiBurst} className="pointer-events-none fixed inset-0 z-40 overflow-hidden">
          {Array.from({ length: 60 }).map((_, i) => {
            const left = Math.random() * 100;
            const dur  = 2.2 + Math.random() * 2.4;
            const del  = Math.random() * 0.6;
            const hue  = [ "#f0b429", "#f4d06f", "#c9911a", "#fffaeb", "#fde68a" ][i % 5];
            return (
              <span key={i} className="confetti-piece"
                style={{ left: `${left}%`, background: hue, animationDuration: `${dur}s`, animationDelay: `${del}s`, transform: `rotate(${Math.random()*360}deg)` }} />
            );
          })}
        </div>
      )}

      <div className="max-w-2xl mx-auto px-5 py-10 relative z-10">
        {/* Header */}
        <div className="text-center mb-8" style={{ animation: "fadeUp 0.5s ease both" }}>
          <p className="text-[0.62rem] tracking-[0.35em] text-gold-400/80 font-semibold uppercase mb-2">Luxury Account</p>
          <h1 className="font-display text-5xl font-light mb-1 gold-text">MY BIDS</h1>
          <p className="text-white/50 text-sm">Track all your bids in one place</p>
        </div>

        {/* Summary chips */}
        {bids.length > 0 && (
          <div className="grid grid-cols-3 gap-3 mb-6">
            {[
              { label: "Pending",  value: pendingCount,  color: "text-amber-300" },
              { label: "Countered",value: counterCount,  color: "text-orange-300" },
              { label: "Accepted", value: acceptedCount, color: "text-emerald-300" },
            ].map((s, i) => (
              <div key={s.label}
                className="glass-card gold-border-anim rounded-2xl p-4 text-center"
                style={{ animation: `fadeUp 0.5s ease ${i*0.08}s both` }}
              >
                <p className={`text-3xl font-bold ${s.color}`} style={{ animation: "floaty 3s ease-in-out infinite" }}>{s.value}</p>
                <p className="text-[0.62rem] text-white/50 mt-0.5 tracking-[0.2em] uppercase">{s.label}</p>
              </div>
            ))}
          </div>
        )}

        {/* Pay-now banner */}
        {unpaidAccepted > 0 && (
          <div className="glass-card gold-border-anim rounded-2xl p-4 mb-6 flex items-center gap-3"
            style={{ animation: "fadeUp 0.5s ease both" }}>
            <div className="w-10 h-10 rounded-full bg-emerald-500/20 border border-emerald-400/40 flex items-center justify-center text-lg"
              style={{ animation: "pulseGlow 2s infinite" }}>🎉</div>
            <div className="flex-1">
              <p className="text-sm font-semibold text-emerald-200">{unpaidAccepted} bid{unpaidAccepted>1?"s":""} accepted — Pay now to confirm</p>
              <p className="text-xs text-white/50">Your luxury stay is one tap away</p>
            </div>
          </div>
        )}

        {/* Filters */}
        {bids.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-6">
            {filters.map((f) => {
              const active = filter === f;
              const count = f === "ALL" ? bids.length : bids.filter(b => b.status === f).length;
              return (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-4 py-1.5 rounded-full text-xs font-semibold tracking-wide transition-all duration-200 border ${
                    active
                      ? "gold-btn border-transparent shadow-[0_8px_24px_rgba(240,180,41,0.35)]"
                      : "bg-white/5 border-white/10 text-white/60 hover:border-gold-400/40 hover:text-white"
                  }`}
                >
                  {f === "ALL" ? `All (${count})` : `${f.charAt(0) + f.slice(1).toLowerCase()} (${count})`}
                </button>
              );
            })}
          </div>
        )}

        {/* Loading */}
        {loading && bids.length === 0 && (
          <div className="space-y-4">
            {[1,2,3].map(i => <div key={i} className="h-40 rounded-3xl glass-card" style={{ animation: "pulseGlow 2s infinite" }} />)}
          </div>
        )}

        {/* Empty */}
        {!loading && bids.length === 0 && (
          <div className="text-center py-20">
            <div className="w-20 h-20 rounded-full glass-card gold-border-anim flex items-center justify-center mx-auto mb-5 text-3xl"
              style={{ animation: "floaty 3s ease-in-out infinite" }}>👑</div>
            <p className="text-lg font-semibold text-white mb-1">No bids placed yet</p>
            <p className="text-sm text-white/40 mb-6">Browse hotels and place your first bid.</p>
            <Link href="/hotels" className="gold-btn px-6 py-3 rounded-2xl text-sm inline-block">
              Browse Luxury Hotels
            </Link>
          </div>
        )}

        {/* Cards */}
        <div className="space-y-4">
          {filtered.map((b: any, idx: number) => {
            const meta  = STATUS_META[b.status] || STATUS_META.PENDING;
            const paid  = isPaid(b);
            // BUG-FIX: below-floor bids are stored at floor in bid.amount (backend
            // rejects below-floor). The customer's actual bid intent lives in the
            // message ("Guest's preferred price: ₹X/night"). resolveBidDisplayAmount
            // recovers it so My Bids shows what the customer ACTUALLY bid, not floor.
            const customerBid = extractCustomerBidFromMessage(b.message);
            const yourBid = customerBid ?? Number(b.amount || 0);
            // Active price = what the customer would pay if they accept now.
            //   COUNTER: hotel's counter
            //   ACCEPTED: hotel accepted at customer's bid (use customerBid if below-floor, else bid.amount)
            //   else: customer's bid
            const confirmAmt = b.status === "COUNTER"
              ? (b.counterAmount || b.amount)
              : (b.status === "ACCEPTED" ? (customerBid ?? b.amount) : yourBid);
            const nights = nightsBetween(b.checkIn, b.checkOut);
            const total = Number(confirmAmt) * nights;
            const isCelebrating = celebrateId === b.id;
            const floorAmt = Number(b.amount || 0); // what backend recorded (floor if below-floor)
            const wasBelowFloor = customerBid != null && customerBid < floorAmt;

            return (
              <div key={b.id}
                className={`relative glass-card gold-border-anim rounded-3xl p-5 ${meta.glow}`}
                style={{ animation: `fadeUp 0.45s ease ${idx*0.05}s both` }}
              >
                {/* Celebration overlay */}
                {isCelebrating && (
                  <div className="absolute inset-0 rounded-3xl flex items-center justify-center z-20 pointer-events-none"
                    style={{ background: "radial-gradient(circle at 50% 50%, rgba(52,211,153,0.22), rgba(0,0,0,0.6) 70%)", animation: "celebPop 0.6s ease both" }}>
                    <div className="text-center">
                      <div className="text-5xl mb-2" style={{ animation: "floaty 1.5s ease-in-out infinite" }}>🎉</div>
                      <p className="font-display text-3xl gold-text">Bid Accepted!</p>
                      <p className="text-white/70 text-xs tracking-[0.3em] uppercase mt-1">Pay to confirm</p>
                    </div>
                  </div>
                )}

                {/* Header row */}
                <div className="flex items-start justify-between mb-3">
                  <div className="min-w-0">
                    <Link href={`/hotels/${b.hotelId}`}
                      className="font-semibold text-white hover:text-gold-400 transition-colors text-[1.05rem] leading-snug block truncate">
                      {b.hotel?.name || "Hotel"}
                    </Link>
                    <p className="text-xs text-white/50 mt-0.5">
                      {b.hotel?.city ? `${b.hotel.city}${b.hotel.state ? ", " + b.hotel.state : ""}` : (b.room?.type || "Room")}
                    </p>
                    {units[b.id]?.unitNumber && (
                      <p className="text-[0.7rem] mt-1.5 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border border-gold-400/40 bg-gold-500/10 text-gold-300 font-semibold tracking-wide">
                        🔑 Room #{units[b.id].unitNumber}
                      </p>
                    )}
                  </div>
                  <span className={`text-[0.65rem] font-bold px-3 py-1 rounded-full border shrink-0 inline-flex items-center gap-1.5 ${meta.chip}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} style={{ animation: "pulseGlow 1.8s infinite" }}/>
                    {meta.label}{paid ? " · Paid" : ""}
                  </span>
                </div>

                {/* Details */}
                <div className="grid grid-cols-3 gap-3 mb-3">
                  <div>
                    <p className="text-[0.6rem] text-white/40 uppercase tracking-[0.2em] mb-1">Your Bid</p>
                    <p className="text-sm font-bold gold-text">₹{yourBid.toLocaleString("en-IN")}</p>
                    <p className="text-[0.6rem] text-white/40">/night</p>
                    {wasBelowFloor && (
                      <p className="text-[0.55rem] text-white/35 mt-0.5">below min · pending review</p>
                    )}
                  </div>
                  <div>
                    <p className="text-[0.6rem] text-white/40 uppercase tracking-[0.2em] mb-1">Check-in</p>
                    <p className="text-sm text-white/80">{fmtDate(b.checkIn)}</p>
                  </div>
                  <div>
                    <p className="text-[0.6rem] text-white/40 uppercase tracking-[0.2em] mb-1">Check-out</p>
                    <p className="text-sm text-white/80">{fmtDate(b.checkOut)}</p>
                  </div>
                </div>

                {/* Auto-accept countdown (PENDING above-floor bids) */}
                {b.status === "PENDING" && autoAcceptInfo[b.id]?.auto_accept_at && (
                  <AutoAcceptCountdown
                    bidId={b.id}
                    autoAcceptAt={autoAcceptInfo[b.id].auto_accept_at!}
                    bidderTier={autoAcceptInfo[b.id].bidder_tier}
                    onAccepted={() => fetchBids(true)}
                  />
                )}

                {/* Counter */}
                {b.status === "COUNTER" && (
                  <div className="mt-3 p-4 rounded-2xl border border-orange-400/30 bg-orange-500/10">
                    <p className="text-sm text-orange-100 mb-3">
                      Hotel countered at <span className="text-xl font-bold text-orange-200">₹{b.counterAmount}</span>/night
                    </p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleCounterAccept(b)}
                        disabled={actionLoading === b.id}
                        className="flex-1 py-2.5 gold-btn rounded-xl text-sm disabled:opacity-40"
                      >
                        {actionLoading === b.id ? "…" : `Accept ₹${b.counterAmount}`}
                      </button>
                      <button
                        onClick={() => handleCounterReject(b.id)}
                        disabled={actionLoading === b.id}
                        className="flex-1 py-2.5 bg-red-500/15 text-red-300 text-sm font-semibold rounded-xl hover:bg-red-500/25 border border-red-400/30 transition disabled:opacity-40"
                      >
                        Decline
                      </button>
                    </div>
                  </div>
                )}

                {/* Accepted: Pay Now gate */}
                {b.status === "ACCEPTED" && !paid && (
                  <div className="mt-3 p-4 rounded-2xl border border-emerald-400/30 bg-gradient-to-br from-emerald-500/10 to-gold-500/5">
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-xl">🎊</span>
                      <div className="flex-1">
                        <p className="text-sm font-semibold text-emerald-200">Accepted at ₹{confirmAmt}/night</p>
                        <p className="text-[0.7rem] text-white/60">Total ₹{total.toLocaleString("en-IN")} · {nights} night{nights>1?"s":""}</p>
                      </div>
                    </div>
                    {/* Auto-cancel countdown — 15 min window after accept,
                        5-min warning popup, expiry banner. */}
                    <AcceptedBidTimer
                      bidId={b.id}
                      hotelId={b.hotelId || b.hotel?.id}
                      acceptedAt={b.acceptedAt || b.updatedAt || b.createdAt}
                      onPayNow={() => handlePayNow(b)}
                      onExpired={() => { clearAcceptWindow(b.id); fetchBids(true); }}
                    />
                    <button
                      onClick={() => handlePayNow(b)}
                      disabled={actionLoading === b.id}
                      className="w-full py-3.5 gold-btn rounded-xl text-sm disabled:opacity-40 mt-3"
                      style={{ animation: "pulseGlow 2s infinite" }}
                    >
                      {actionLoading === b.id ? "Opening Payment…" : `Pay ₹${total.toLocaleString("en-IN")} & Confirm Booking →`}
                    </button>
                    <p className="text-[0.65rem] text-white/40 text-center mt-2 tracking-wide">
                      Secure payment via Razorpay · Instant confirmation
                    </p>
                  </div>
                )}

                {/* Accepted + paid */}
                {b.status === "ACCEPTED" && paid && (
                  <div className="mt-3 p-3 rounded-xl border border-emerald-400/30 bg-emerald-500/10 flex items-center justify-between">
                    <p className="text-sm text-emerald-200 font-medium">✓ Booked at ₹{confirmAmt}/night</p>
                    <Link href="/bookings" className="text-xs text-gold-400 font-semibold">View Booking →</Link>
                  </div>
                )}

                {/* Footer */}
                <div className="mt-4 pt-3 border-t border-white/10 flex items-center justify-between">
                  <p className="text-[0.65rem] text-white/40 tracking-wide">
                    {b.createdAt
                      ? `Bid on ${new Date(b.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}`
                      : ""}
                  </p>
                  <Link href={`/hotels/${b.hotelId}`} className="text-xs text-gold-400 hover:text-gold-300 transition-colors font-medium tracking-wide">
                    View Hotel →
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Booking Review modal (Phase 2) — sits between accept-counter / pay-now and Razorpay */}
      {review && <BookingReview {...review} open onClose={() => setReview(null)} />}
    </div>
  );
}
