"use client";
import { useState, useEffect, useMemo, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { openRazorpayCheckout } from "@/lib/razorpay";
import { resolveBidDisplayAmount, extractCustomerBidFromMessage } from "@/lib/paid-amount";
import BookingReview, { type BookingReviewProps } from "@/components/BookingReview";
import { saveHoldState, holdExpiresAt } from "@/lib/hold-amount";
import AcceptedBidTimer from "@/components/AcceptedBidTimer";
import AutoAcceptCountdown from "@/components/AutoAcceptCountdown";
// v199 — UpdateBudgetInline extracted to a shared component so the
// hotel page's "Your offers" PENDING/COUNTER cards can mount the same
// slider. Previously defined locally in this file (~80 lines below).
import UpdateBudgetInline from "@/components/UpdateBudgetInline";
import { notify } from "@/lib/notifications";
import { isSeen, markSeen } from "@/lib/notifications";
import { clearWindow as clearAcceptWindow, hydrateAcceptanceWindowsFromServer } from "@/lib/auto-cancel";
import { CountUp } from "@/components/CountUp";
// v129 — counter amounts snap to ₹100 multiples (same source of truth as the
// Negotiate slider + partner counter slider). Hotels can ONLY bundle perks
// from the structured COUNTER_ADDONS catalog — `parseAddons` pulls those
// back from the message field as chip pills.
import { snap100 } from "@/lib/price-snap";
import { parseAddons } from "@/lib/counter-addons";
// v141 — Phase-5 my-bids tour. 4 steps: card → status → actions →
// auto-accept countdown.
import { usePageTour } from "@/lib/tutorial/usePageTour";

// v174 — cozy-theme status palette. Mid-tone colours that read on both the
// cream (light) and walnut (dark) surfaces — no per-theme branching needed.
const STATUS_META: Record<string, { label: string; color: string; soft: string }> = {
  PENDING:   { label: "Pending",   color: "#C9A66B", soft: "rgba(201,166,107,0.14)" },
  COUNTER:   { label: "Countered", color: "#C77B43", soft: "rgba(199,123,67,0.14)" },
  ACCEPTED:  { label: "Accepted",  color: "#7F9269", soft: "rgba(127,146,105,0.18)" },
  REJECTED:  { label: "Declined",  color: "#C77E6D", soft: "rgba(199,126,109,0.14)" },
  // v229 — customer-initiated cancel via /api/bids/:id/cancel
  CANCELLED: { label: "Cancelled", color: "#8A8FA8", soft: "rgba(138,143,168,0.14)" },
  EXPIRED:   { label: "Expired",   color: "#8A8FA8", soft: "rgba(138,143,168,0.14)" },
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

// ── PENDING / COUNTER countdown banner ────────────────────────────────
// Per-flow expiry: 1h for /bid (reverse auction), 3h for Negotiate. The
// row's expiresAt already reflects the right window because the place +
// budget-update endpoints set it server-side. Once it hits 0 the cron
// sweeps the bid to EXPIRED — until then we show a live HH:MM:SS chip.
function PendingBidCountdown({ expiresAt, flow }: { expiresAt?: string; flow: "place" | "negotiate" }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!expiresAt) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [expiresAt]);
  if (!expiresAt) return null;
  const ms = new Date(expiresAt).getTime() - now;
  const expired = ms <= 0;
  const total = Math.max(0, ms);
  const h = Math.floor(total / 3600_000);
  const m = Math.floor((total % 3600_000) / 60_000);
  const s = Math.floor((total % 60_000) / 1000);
  const label = expired
    ? "Bid expired"
    : (h > 0
        ? `${h}h ${String(m).padStart(2,"0")}m ${String(s).padStart(2,"0")}s left`
        : `${m}m ${String(s).padStart(2,"0")}s left`);
  const tone = expired ? "#c0392b" : (ms < 5 * 60_000 ? "#C77B43" : "#7F9269");
  return (
    <div
      className="mt-3 rounded-xl px-3 py-2 flex items-center gap-2"
      style={{ background: `${tone}14`, border: `1px solid ${tone}44` }}
    >
      <span style={{ fontSize: 16 }}>⏱</span>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold" style={{ color: tone }}>{label}</p>
        <p className="text-[0.62rem]" style={{ color: "var(--text-muted)" }}>
          {flow === "place" ? "Auction window — hotels reply within 1h" : "Negotiate window — hotel replies within 3h"}
        </p>
      </div>
    </div>
  );
}

// v199 — UpdateBudgetInline was previously defined here. Extracted to
// components/UpdateBudgetInline.tsx so the hotel detail page's "Your
// offers" surface mounts the same control. No behavior change.

// v194 — split: inner component reads useSearchParams; the default export
// wraps in <Suspense> so Next 14 static prerender doesn't bail out
// (https://nextjs.org/docs/messages/missing-suspense-with-csr-bailout).
function MyBidsPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, loading: authLoading } = useAuth();
  const [bids, setBids] = useState<any[]>([]);
  // v194 — guard so the `?payNow=<id>` deep-link from /bid success screen
  // only fires the BookingReview modal once per landing (re-renders /
  // polling refresh must not re-open it).
  const payNowFiredRef = useRef<string | null>(null);
  // v141 — Phase 5 — my-bids tour. delayMs:1500 so async bids list
  // renders at least one .glass-card before fire.
  usePageTour("mybids", "mybids", { delayMs: 1500 });
  const [units, setUnits] = useState<Record<string, { unitId: string; unitNumber: string }>>({});
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState("");
  const [filter, setFilter] = useState<"ALL"|"PENDING"|"COUNTER"|"ACCEPTED"|"REJECTED">("ALL");
  // v174 — bidding is two distinct flows. BID = reverse-auction "Place Bid"
  // rows; FLASH = flash-deal rows (carry b.dealId OR a `deal_price_{id}`
  // localStorage marker the flash booking flow writes). Toggle swaps the view.
  // v180 — two real sections: PLACE BID (reverse-auction from /bid) vs
  // NEGOTIATE (single-hotel bid from /hotels/[id]).
  const [section, setSection] = useState<"PLACE"|"NEGOTIATE">("NEGOTIATE");
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
          // v180 — bidding has TWO flows:
          //   • PLACE BID (reverse-auction from /bid page) → broadcasts
          //     to many hotels, message pattern: "Guest bid ₹X/night for N
          //     nights (max ₹Y)..." (see app/bid/page.tsx line 708)
          //   • NEGOTIATE (single-hotel from /hotels/[id]) → message
          //     pattern: "Guest's preferred price:..." or Razorpay /
          //     Flash-Deal / Book Now (paid) tokens.
          // Flash-deal rows fall under NEGOTIATE (they're hotel-specific)
          // — paid flash bookings are already filtered out by isPaid + the
          // booking listing. The kept `_isFlash` marker is informational
          // only (used for the "⚡ Flash Deal" pill on cards).
          const msg = String(b.message || "");
          // v234 — broaden Place Bid detection. Was message-regex-only; now
          // ALSO trusts the server's `flow` field when present (place vs
          // negotiate is stamped at /api/bids/place time on Railway). The
          // regex stays as a fallback for legacy rows that pre-date the
          // flow column being echoed back in /api/bids/my. Sachin: "bid
          // launch ho rahi hai lakin my bid section place bid abhi bhi
          // data show nhi kar raha" — if Railway stops echoing the exact
          // message string (or strips it for length), the regex misses
          // and the row falls into Negotiate. Server-authoritative flow
          // catches that case.
          // v240 — Server-authoritative bucketing.
          //   • Primary: b.request.source (stamped at /api/bids/request
          //     time, schema-enforced enum). New bids from v240 onward
          //     carry this; /api/bids/my spreads the request row so the
          //     field is always present.
          //   • Legacy fallback (rows created before v240's migration):
          //     b.flow / b._flow if Railway echoes it, then the v234
          //     message regex. Once all legacy rows age out (≤72h via
          //     v193 cron), these fallbacks become dead code but stay
          //     in place defensively — pure-additive, no risk.
          const requestSource = String(b?.request?.source || "").toLowerCase();
          const flow = String(b.flow || b._flow || "").toLowerCase();
          const isPlaceBid =
            requestSource === "place" ||
            flow === "place" ||
            /\bGuest bid\b/i.test(msg) ||
            /max ₹/i.test(msg);
          let isFlash = !!(b.dealId || b.deal_id);
          if (!isFlash) {
            try { isFlash = !!localStorage.getItem(`deal_price_${b.id}`); } catch {}
          }
          return { ...b, checkIn, checkOut, _isPlaceBid: isPlaceBid, _isFlash: isFlash };
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
    // v129 — every nightly rate the customer sees in the review modal is
    // already snapped, so what they see matches what gets charged. The
    // partner panel snaps before submitting too — defensive snap here in
    // case a legacy COUNTER row from before v129 had an odd amount.
    const counterAmt = snap100(b.counterAmount || b.amount || 0);
    const nights = nightsBetween(b.checkIn, b.checkOut);
    // v241 — multi-room charge fix. amount is per-room-per-night;
    // total = perNight × nights × numRooms. Fallback chain catches
    // pre-v241 rows (numRooms missing on bid + request → 1).
    const numRooms = Math.max(1, Number(b.numRooms || b.request?.numRoomsRequested || 1));
    const total = counterAmt * nights * numRooms;
    if (!total) { alert("Invalid amount"); return; }
    const roomsLabel = numRooms > 1 ? ` × ${numRooms} room${numRooms > 1 ? "s" : ""}` : "";
    const rateLines = [
      { label: `₹${counterAmt.toLocaleString()} × ${nights} night${nights>1?"s":""}${roomsLabel}`, value: `₹${total.toLocaleString()}` },
      { label: "Hotel countered at this rate", value: "Accepted", subtle: true },
    ];
    setReview({
      hotelName: b.hotel?.name || "Hotel",
      hotelCity: b.hotel?.city,
      roomType: b.room?.type,
      checkIn: b.checkIn || "", checkOut: b.checkOut || "", nights,
      adults: b.request?.guests || 2,
      numRooms,
      capacityMismatch: !!b.capacityMismatch,
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
    // v129 — same snap as handleCounterAccept; charge amount derives from it.
    const counterAmt = snap100(b.counterAmount || b.amount || 0);
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

  // v229 — Customer cancels own PENDING/COUNTER bid. Releases (customer ×
  // city) lock instantly. Optimistic: drop the row from local list while
  // the request flies; revert on error.
  const handleCancelBid = async (bidId: string) => {
    if (!confirm("Cancel this bid? You can launch a fresh one in this city right after.")) return;
    setActionLoading(bidId);
    const prev = bids;
    setBids((cur) => cur.map((b) => (b.id === bidId ? { ...b, status: "CANCELLED" } : b)));
    try {
      await api.cancelBid(bidId);
      // Refresh from server so the row drops out of PENDING/COUNTER filters
      fetchBids(true);
    } catch (e: any) {
      setBids(prev); // rollback
      alert(e?.message || "Couldn't cancel the bid. Please try again.");
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
    // v241 — multi-room charge fix.
    const numRooms = Math.max(1, Number(b.numRooms || b.request?.numRoomsRequested || 1));
    const total = perNight * nights * numRooms;
    if (!total) { alert("Invalid amount"); return; }
    const roomsLabel = numRooms > 1 ? ` × ${numRooms} room${numRooms > 1 ? "s" : ""}` : "";
    const rateLines = [
      { label: `₹${perNight.toLocaleString()} × ${nights} night${nights>1?"s":""}${roomsLabel}`, value: `₹${total.toLocaleString()}` },
      { label: "Bid accepted by hotel", value: "Confirm to lock", subtle: true },
    ];
    setReview({
      hotelName: b.hotel?.name || "Hotel",
      hotelCity: b.hotel?.city,
      roomType: b.room?.type,
      checkIn: b.checkIn || "", checkOut: b.checkOut || "", nights,
      adults: b.request?.guests || 2,
      numRooms,
      capacityMismatch: !!b.capacityMismatch,
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

  // v230 — hide washed-out rows from the customer's view. EXPIRED + CANCELLED
  // bids stay in the DB for audit but don't show up in /my-bids — they
  // were already terminal + non-actionable, and after the v229 cleanup the
  // list was choked with 116+ EXPIRED rows that the customer can't act on.
  // Re-introducing a dedicated "Archive" filter would let users see them
  // again if needed (deferred).
  const HIDE_TERMINAL = new Set(["EXPIRED", "CANCELLED"]);

  // v234 — Stale-bid filter (replaces v233's ACCEPTED-only surgical cut).
  //
  //   v232 had used the full `filterActiveBids` from lib/bid-expiry.ts, but
  //   that helper's hard IST-midnight cutoff hid FRESH PENDING bids when
  //   the customer crossed midnight (Sachin: "bid launch ke baad place bid
  //   section empty"). v233 over-corrected by only filtering ACCEPTED-unpaid
  //   past 15 min — leaving 32-day-old PENDING bids in the Negotiate tab
  //   forever (Sachin: "sab kuch clean karne ke baad bhi ek bid pending
  //   reh gyi hai"). v234 lands the middle ground.
  //
  // Rules per status (NO IST-midnight cutoff — that was the v232 trap):
  //   • PENDING (Place / reverse-auction) → 1h via b.expiresAt or message
  //   • PENDING (Negotiate / single-hotel) → 3h likewise
  //   • PENDING with auto_accept_at → expires 15 min after scheduled accept
  //   • PENDING hard cap → 6h (matches v193 server cron mark_stale_pending_bids)
  //   • COUNTER → 60 min after the hotel posted (matches lib/bid-expiry)
  //   • REJECTED → 30 min after decline
  //   • ACCEPTED + paid → never (real booking)
  //   • ACCEPTED + unpaid → 15 min after acceptedAt (v233 contract preserved)
  //   • CHECKED_IN / CHECKED_OUT → never (in-flight / completed stay)
  //
  // Defensive 30-min grace for FRESH bids: any row whose createdAt is in
  // the last 30 minutes is NEVER hidden, regardless of status math. This
  // is the v233-fresh-pending guarantee — a /bid auction that fires at
  // 23:55 IST + lands the user on /my-bids at 00:01 IST will ALWAYS show
  // the new card, even if some other timestamp got skewed. Stops the
  // "Place Bid empty after launch" feedback cycle from recurring.
  const FRESH_GRACE_MS = 30 * 60 * 1000;
  const MIN = 60_000;
  const HOUR = 60 * MIN;
  const liveBids = useMemo(() => bids.filter((b) => {
    const now = Date.now();
    const paid = isPaid(b);
    const status = String(b?.status || "").toUpperCase();

    // Confirmed bookings + in-flight stays never drop off this view.
    if (status === "ACCEPTED" && paid) return true;
    if (status === "CONFIRMED" && paid) return true;
    if (status === "CHECKED_IN" || status === "CHECKED_OUT") return true;

    // Fresh-bid grace: any row created in the last 30 min stays visible.
    // Guards against clock skew and the v232 "fresh place bid disappears
    // after IST midnight" regression by NOT depending on a wall-clock
    // calendar cutoff.
    const created = b?.createdAt ? new Date(b.createdAt).getTime() : 0;
    if (created && now - created < FRESH_GRACE_MS) return true;

    // Per-status windows.
    if (status === "REJECTED") {
      const decided = b?.updatedAt ? new Date(b.updatedAt).getTime() : created;
      return now <= decided + 30 * MIN;
    }
    if (status === "ACCEPTED" && !paid) {
      const acc = b?.acceptedAt ? new Date(b.acceptedAt).getTime()
                : b?.updatedAt  ? new Date(b.updatedAt).getTime()
                : created;
      return now <= acc + 15 * MIN;
    }
    if (status === "COUNTER") {
      const countered = b?.updatedAt ? new Date(b.updatedAt).getTime() : created;
      return now <= countered + 60 * MIN;
    }
    if (status === "PENDING") {
      // Above-floor scheduled (Phase 6 auto-accept lifecycle): 15-min
      // grace past the scheduled accept moment.
      if (b?.auto_accept_at) {
        const t = new Date(b.auto_accept_at).getTime();
        if (!Number.isNaN(t)) return now <= t + 15 * MIN;
      }
      // Backend-stamped expiry (server is authoritative).
      if (b?.expiresAt) {
        const t = new Date(b.expiresAt).getTime();
        if (!Number.isNaN(t)) return now <= t;
      }
      // Legacy rows w/o expiresAt — derive per-flow window from the
      // detected flow (b._isPlaceBid was just stamped above in fetchBids).
      // Cap absolutely at 6h regardless (matches v193 server cron).
      if (!created) return true;
      const age = now - created;
      const isPlaceFlow = !!b?._isPlaceBid;
      const flowCap = isPlaceFlow ? 1 * HOUR : 3 * HOUR;
      return age <= Math.min(flowCap, 6 * HOUR);
    }

    // Unknown / transitional statuses → keep visible (UI surfaces what
    // little it can, customer can decide). Server cleanup catches them.
    return true;
  }), [bids]);

  // v180 — split by flow first, then by status filter.
  // v230 — Place Bid / Negotiate tab counts ALSO exclude HIDE_TERMINAL so
  // the customer doesn't see "Place Bid 72" when 65 of those 72 are EXPIRED
  // rows hidden from view. Pre-v230 the tab count diverged from the actual
  // rendered row count, which was confusing.
  const placeBidCount  = useMemo(() => liveBids.filter((b) =>  b._isPlaceBid && !HIDE_TERMINAL.has(String(b.status || "").toUpperCase())).length, [liveBids]);
  const negotiateCount = useMemo(() => liveBids.filter((b) => !b._isPlaceBid && !HIDE_TERMINAL.has(String(b.status || "").toUpperCase())).length, [liveBids]);
  const sectionBids = useMemo(
    () => liveBids.filter((b) => (
      (section === "PLACE" ? b._isPlaceBid : !b._isPlaceBid) &&
      !HIDE_TERMINAL.has(String(b.status || "").toUpperCase())
    )),
    [liveBids, section]
  );
  const filtered = filter === "ALL" ? sectionBids : sectionBids.filter((b) => b.status === filter);

  const pendingCount  = useMemo(() => sectionBids.filter((b) => b.status === "PENDING").length,  [sectionBids]);
  const counterCount  = useMemo(() => sectionBids.filter((b) => b.status === "COUNTER").length,  [sectionBids]);
  const acceptedCount = useMemo(() => sectionBids.filter((b) => b.status === "ACCEPTED").length, [sectionBids]);
  const unpaidAccepted = useMemo(() => sectionBids.filter((b) => b.status === "ACCEPTED" && !isPaid(b)).length, [sectionBids]);

  const sectionEmpty = section === "PLACE"
    ? { icon: "🎯", title: "No place-bid offers yet", sub: "Name your price on /bid and hotels compete — your bids land here.", cta: "Place a Bid", href: "/bid" }
    : { icon: "🏨", title: "No negotiate bids yet", sub: "Negotiate with a hotel directly — your single-hotel bids land here.", cta: "Browse Hotels", href: "/hotels" };

  // v194 — auto-open BookingReview when the user lands here from the /bid
  // success screen's "Pay Now & Grab" CTA. Param: `?payNow=<bidId>`. Fires
  // once per landing (payNowFiredRef gate) so the 15 s polling refresh
  // can't re-open the modal. Also flips to the PLACE section if the bid
  // is a place-bid so the underlying card is visible when the modal closes.
  //
  // v230 — Relaxed status guard: was ACCEPTED-only; now also fires for
  // PENDING/COUNTER bids landing from `/bid` auction flow. The customer
  // tapping "Pay Now & Grab" on a still-PENDING bid wants to LOCK IT IN
  // at their bid price (Razorpay charges → /api/bids/<id>/pay flips bid
  // to ACCEPTED + creates booking). Same code path as accepted-unpaid pay.
  useEffect(() => {
    const wantBidId = searchParams?.get("payNow");
    if (!wantBidId) return;
    if (payNowFiredRef.current === wantBidId) return;
    if (!bids || bids.length === 0) return;
    const b = bids.find((row: any) => String(row?.id) === String(wantBidId));
    if (!b) return;
    // Open BookingReview for any actionable status. ACCEPTED-unpaid OR
    // PENDING/COUNTER both qualify; only skip already-paid (booking
    // already locked) or terminal (REJECTED/EXPIRED/CANCELLED) rows.
    const actionable =
      (b.status === "ACCEPTED" && !isPaid(b)) ||
      b.status === "PENDING" ||
      b.status === "COUNTER";
    if (actionable) {
      if (b._isPlaceBid && section !== "PLACE") setSection("PLACE");
      payNowFiredRef.current = String(wantBidId);
      handlePayNow(b);
    } else {
      payNowFiredRef.current = String(wantBidId);
    }
    // Clean the URL param so a refresh doesn't re-fire.
    try { router.replace("/my-bids", { scroll: false }); } catch {}
  }, [searchParams, bids, section, router]);

  return (
    // v174 — cozy theme. `.lux-bg` paints the page in var(--bg-page); every
    // surface below uses theme tokens directly (no reliance on auto-fix).
    <div className="lux-bg min-h-screen relative overflow-hidden">
      <style>{`
        @keyframes shine { 0% { background-position:-200% 0; } 100% { background-position:200% 0; } }
        @keyframes floaty { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-4px)} }
        @keyframes fadeUp { from{opacity:0;transform:translateY(14px)} to{opacity:1;transform:translateY(0)} }
        @keyframes pulseGlow { 0%,100%{box-shadow:0 0 0 0 rgba(201,166,107,0.5)} 50%{box-shadow:0 0 0 12px rgba(201,166,107,0)} }
        @keyframes celebPop { 0%{transform:scale(0.6);opacity:0} 40%{transform:scale(1.05);opacity:1} 100%{transform:scale(1);opacity:1} }
        @keyframes confettiFall { to { transform: translateY(110vh) rotate(720deg); opacity: 0; } }
        @keyframes goldSweep { 0% { transform: translateX(-120%); } 100% { transform: translateX(220%); } }
        .gold-text { background: linear-gradient(90deg,#d9a93e,#c9911a,#b8871a,#c9911a,#d9a93e); background-size:200% auto; -webkit-background-clip:text; background-clip:text; -webkit-text-fill-color:transparent; animation: shine 6s linear infinite; }
        .gold-btn { position:relative; overflow:hidden; background:linear-gradient(135deg,#b8871a 0%,#f0b429 48%,#fbd26a 60%,#c9911a 100%); color:#1a1205; font-weight:800; letter-spacing:.03em; }
        .gold-btn::after { content:""; position:absolute; inset:0; background:linear-gradient(110deg,transparent 30%, rgba(255,255,255,0.55) 50%, transparent 70%); transform:translateX(-120%); animation: goldSweep 2.8s ease-in-out infinite; }
        .mb-card { background: var(--bg-card); border:1px solid var(--border-soft); box-shadow: var(--shadow-card); transition: transform .2s ease, box-shadow .2s ease; }
        .mb-card:hover { transform: translateY(-3px); box-shadow: var(--shadow-soft); }
        .mb-seg { background: var(--bg-pill); border:1px solid var(--border-soft); border-radius:999px; padding:4px; display:flex; gap:4px; }
        .mb-seg button { flex:1; border-radius:999px; padding:10px 12px; font-weight:700; font-size:.82rem; color: var(--text-soft); transition: all .2s ease; display:flex; align-items:center; justify-content:center; gap:6px; }
        .mb-seg button.on { background: linear-gradient(135deg,#b8871a,#f0b429 55%,#c9911a); color:#1a1205; box-shadow:0 4px 16px rgba(201,145,26,0.32); }
        .confetti-piece { position:absolute; top:-10px; width:8px; height:14px; border-radius:2px; animation: confettiFall linear forwards; }
      `}</style>

      {/* Confetti burst */}
      {confettiBurst > 0 && (
        <div key={confettiBurst} className="pointer-events-none fixed inset-0 z-40 overflow-hidden">
          {Array.from({ length: 60 }).map((_, i) => {
            const left = Math.random() * 100;
            const dur  = 2.2 + Math.random() * 2.4;
            const del  = Math.random() * 0.6;
            const hue  = [ "#f0b429", "#d9a93e", "#c9911a", "#7F9269", "#C9A66B" ][i % 5];
            return (
              <span key={i} className="confetti-piece"
                style={{ left: `${left}%`, background: hue, animationDuration: `${dur}s`, animationDelay: `${del}s`, transform: `rotate(${Math.random()*360}deg)` }} />
            );
          })}
        </div>
      )}

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-7 sm:py-10 relative z-10">
        {/* Header */}
        <div className="text-center mb-6" style={{ animation: "fadeUp 0.5s ease both" }}>
          <p className="text-[0.6rem] tracking-[0.34em] font-semibold uppercase mb-1.5" style={{ color: "var(--text-muted)" }}>Your Account</p>
          <h1 className="font-display text-4xl sm:text-5xl font-light mb-1 gold-text">My Bids</h1>
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>Place Bid &amp; Negotiate — your live offers across both flows</p>
        </div>

        {/* Section toggle — Place Bid ⇄ Negotiate (v180) */}
        {bids.length > 0 && (
          <div className="mb-seg max-w-md mx-auto mb-5" style={{ animation: "fadeUp 0.5s ease both" }}>
            <button className={section === "NEGOTIATE" ? "on" : ""}
              onClick={() => { setSection("NEGOTIATE"); setFilter("ALL"); }}>
              🏨 Negotiate <span className="opacity-70">({negotiateCount})</span>
            </button>
            <button className={section === "PLACE" ? "on" : ""}
              onClick={() => { setSection("PLACE"); setFilter("ALL"); }}>
              🎯 Place Bid <span className="opacity-70">({placeBidCount})</span>
            </button>
          </div>
        )}

        {/* Summary chips */}
        {sectionBids.length > 0 && (
          <div className="grid grid-cols-3 gap-2.5 sm:gap-3 mb-5 max-w-2xl mx-auto">
            {[
              { label: "Pending",  value: pendingCount,  color: STATUS_META.PENDING.color },
              { label: "Countered",value: counterCount,  color: STATUS_META.COUNTER.color },
              { label: "Accepted", value: acceptedCount, color: STATUS_META.ACCEPTED.color },
            ].map((s, i) => (
              <div key={s.label} className="mb-card rounded-2xl py-3.5 px-2 text-center"
                style={{ animation: `fadeUp 0.5s ease ${i*0.08}s both` }}>
                <p className="text-2xl sm:text-3xl font-bold" style={{ color: s.color }}>
                  <CountUp value={s.value} duration={900} />
                </p>
                <p className="text-[0.58rem] mt-0.5 tracking-[0.18em] uppercase" style={{ color: "var(--text-muted)" }}>{s.label}</p>
              </div>
            ))}
          </div>
        )}

        {/* Pay-now banner */}
        {unpaidAccepted > 0 && (
          <div className="mb-card rounded-2xl p-3.5 mb-5 flex items-center gap-3 max-w-2xl mx-auto"
            style={{ animation: "fadeUp 0.5s ease both", borderColor: "rgba(127,146,105,0.4)" }}>
            <div className="w-10 h-10 rounded-full flex items-center justify-center text-lg shrink-0"
              style={{ background: STATUS_META.ACCEPTED.soft, animation: "pulseGlow 2s infinite" }}>🎉</div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold" style={{ color: "var(--text-base)" }}>
                {unpaidAccepted} bid{unpaidAccepted>1?"s":""} accepted — pay now to confirm
              </p>
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>Your stay is one tap away</p>
            </div>
          </div>
        )}

        {/* Status filters */}
        {sectionBids.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-5 justify-center">
            {filters.map((f) => {
              const active = filter === f;
              const count = f === "ALL" ? sectionBids.length : sectionBids.filter(b => b.status === f).length;
              return (
                <button key={f} onClick={() => setFilter(f)}
                  className={`px-3.5 py-1.5 rounded-full text-xs font-semibold tracking-wide transition-all duration-200 ${active ? "gold-btn" : ""}`}
                  style={active ? undefined : { background: "var(--bg-pill)", border: "1px solid var(--border-soft)", color: "var(--text-soft)" }}
                >
                  {f === "ALL" ? `All (${count})` : `${f.charAt(0) + f.slice(1).toLowerCase()} (${count})`}
                </button>
              );
            })}
          </div>
        )}

        {/* Loading */}
        {loading && bids.length === 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 items-start">
            {[1,2,3].map(i => <div key={i} className="h-36 rounded-2xl mb-card" style={{ animation: "pulseGlow 2s infinite" }} />)}
          </div>
        )}

        {/* Empty — whole page (no bids at all) */}
        {!loading && bids.length === 0 && (
          <div className="text-center py-16">
            <div className="w-20 h-20 rounded-full mb-card flex items-center justify-center mx-auto mb-5 text-3xl"
              style={{ animation: "floaty 3s ease-in-out infinite" }}>👑</div>
            <p className="text-lg font-semibold mb-1" style={{ color: "var(--text-base)" }}>No bids placed yet</p>
            <p className="text-sm mb-6" style={{ color: "var(--text-muted)" }}>Browse hotels and place your first bid.</p>
            <Link href="/hotels" className="gold-btn px-6 py-3 rounded-2xl text-sm inline-block">Browse Hotels</Link>
          </div>
        )}

        {/* Empty — this section only */}
        {!loading && bids.length > 0 && sectionBids.length === 0 && (
          <div className="text-center py-14">
            <div className="w-16 h-16 rounded-full mb-card flex items-center justify-center mx-auto mb-4 text-2xl"
              style={{ animation: "floaty 3s ease-in-out infinite" }}>{sectionEmpty.icon}</div>
            <p className="text-base font-semibold mb-1" style={{ color: "var(--text-base)" }}>{sectionEmpty.title}</p>
            <p className="text-sm mb-5" style={{ color: "var(--text-muted)" }}>{sectionEmpty.sub}</p>
            <Link href={sectionEmpty.href} className="gold-btn px-5 py-2.5 rounded-2xl text-sm inline-block">{sectionEmpty.cta}</Link>
          </div>
        )}

        {/* Cards — responsive grid: 1col mobile · 2col tablet · 3col desktop.
            items-start lets each card shrink to its own content height. */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 items-start">
          {filtered.map((b: any, idx: number) => {
            const meta  = STATUS_META[b.status] || STATUS_META.PENDING;
            const paid  = isPaid(b);
            // BUG-FIX: below-floor bids are stored at floor in bid.amount (backend
            // rejects below-floor). The customer's actual bid intent lives in the
            // message ("Guest's preferred price: ₹X/night").
            const customerBid = extractCustomerBidFromMessage(b.message);
            const yourBid = customerBid ?? Number(b.amount || 0);
            const confirmAmt = b.status === "COUNTER"
              ? (b.counterAmount || b.amount)
              : (b.status === "ACCEPTED" ? (customerBid ?? b.amount) : yourBid);
            const nights = nightsBetween(b.checkIn, b.checkOut);
            // v241 — multi-room display. Card surface total also
            // multiplies by numRooms so customer sees the full
            // chargeable amount, not the per-room slice.
            const numRoomsCard = Math.max(1, Number(b.numRooms || b.request?.numRoomsRequested || 1));
            const total = Number(confirmAmt) * nights * numRoomsCard;
            const isCelebrating = celebrateId === b.id;
            const floorAmt = Number(b.amount || 0);
            const wasBelowFloor = customerBid != null && customerBid < floorAmt;

            return (
              <div key={b.id} className="relative mb-card rounded-2xl p-4"
                style={{ animation: `fadeUp 0.45s ease ${idx*0.05}s both` }}>
                {/* Celebration overlay */}
                {isCelebrating && (
                  <div className="absolute inset-0 rounded-2xl flex items-center justify-center z-20 pointer-events-none"
                    style={{ background: `radial-gradient(circle at 50% 50%, ${STATUS_META.ACCEPTED.soft}, var(--bg-card) 78%)`, animation: "celebPop 0.6s ease both" }}>
                    <div className="text-center">
                      <div className="text-4xl mb-1.5" style={{ animation: "floaty 1.5s ease-in-out infinite" }}>🎉</div>
                      <p className="font-display text-2xl gold-text">Bid Accepted!</p>
                      <p className="text-[0.62rem] tracking-[0.28em] uppercase mt-1" style={{ color: "var(--text-soft)" }}>Pay to confirm</p>
                    </div>
                  </div>
                )}

                {/* Header row */}
                <div className="flex items-start justify-between gap-2 mb-2.5">
                  <div className="min-w-0">
                    <Link href={`/hotels/${b.hotelId}`}
                      className="font-semibold text-[1rem] leading-snug block truncate hover:underline"
                      style={{ color: "var(--text-base)" }}>
                      {b.hotel?.name || "Hotel"}
                    </Link>
                    <p className="text-xs mt-0.5 truncate" style={{ color: "var(--text-muted)" }}>
                      {b.hotel?.city ? `${b.hotel.city}${b.hotel.state ? ", " + b.hotel.state : ""}` : (b.room?.type || "Room")}
                    </p>
                    <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                      <span className="text-[0.6rem] inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-semibold"
                        style={{ background: "var(--bg-pill)", border: "1px solid var(--border-soft)", color: "var(--text-soft)" }}>
                        {b._isPlaceBid ? "🎯 Place Bid" : "🏨 Negotiate"}
                      </span>
                      {b._isFlash && (
                        <span className="text-[0.6rem] inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-semibold"
                          style={{ background: "rgba(201,145,26,0.14)", border: "1px solid rgba(201,145,26,0.36)", color: "#c9911a" }}>
                          ⚡ Flash
                        </span>
                      )}
                      {units[b.id]?.unitNumber && (
                        <span className="text-[0.6rem] inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-semibold"
                          style={{ background: "rgba(201,145,26,0.12)", border: "1px solid rgba(201,145,26,0.34)", color: "#c9911a" }}>
                          🔑 Room #{units[b.id].unitNumber}
                        </span>
                      )}
                    </div>
                  </div>
                  <span className="text-[0.62rem] font-bold px-2.5 py-1 rounded-full shrink-0 inline-flex items-center gap-1.5"
                    style={{ color: meta.color, background: meta.soft, border: `1px solid ${meta.color}55` }}>
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: meta.color }} />
                    {meta.label}{paid ? " · Paid" : ""}
                  </span>
                </div>

                {/* Details */}
                <div className="grid grid-cols-3 gap-2 mb-3 rounded-xl p-2.5"
                  style={{ background: "var(--bg-pill)" }}>
                  <div>
                    <p className="text-[0.56rem] uppercase tracking-[0.16em] mb-0.5" style={{ color: "var(--text-muted)" }}>Your Bid</p>
                    <p className="text-sm font-bold" style={{ color: "#c9911a" }}>₹{yourBid.toLocaleString("en-IN")}</p>
                    <p className="text-[0.56rem]" style={{ color: "var(--text-muted)" }}>/night</p>
                    {wasBelowFloor && (
                      <p className="text-[0.52rem] mt-0.5" style={{ color: "var(--text-muted)" }}>below min · pending review</p>
                    )}
                  </div>
                  <div>
                    <p className="text-[0.56rem] uppercase tracking-[0.16em] mb-0.5" style={{ color: "var(--text-muted)" }}>Check-in</p>
                    <p className="text-sm font-medium" style={{ color: "var(--text-base)" }}>{fmtDate(b.checkIn)}</p>
                  </div>
                  <div>
                    <p className="text-[0.56rem] uppercase tracking-[0.16em] mb-0.5" style={{ color: "var(--text-muted)" }}>Check-out</p>
                    <p className="text-sm font-medium" style={{ color: "var(--text-base)" }}>{fmtDate(b.checkOut)}</p>
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

                {/* PENDING / COUNTER per-flow countdown + Update Budget + Cancel.
                    The countdown is 1h for /bid (b._isPlaceBid), 3h for Negotiate.
                    Budget update PATCHes the bid and refreshes the list.
                    v229 — Cancel CTA flips status to CANCELLED via the new
                    Railway endpoint; releases the (customer × city) lock so
                    the user can immediately launch a fresh bid without
                    waiting for the cron sweep. */}
                {(b.status === "PENDING" || b.status === "COUNTER") && (
                  <>
                    <PendingBidCountdown
                      expiresAt={b.expiresAt}
                      flow={b._isPlaceBid ? "place" : "negotiate"}
                    />
                    <UpdateBudgetInline
                      bid={b}
                      flow={b._isPlaceBid ? "place" : "negotiate"}
                      floor={Number(b.room?.floorPrice || 0)}
                      onUpdated={() => fetchBids(true)}
                    />
                    <div className="mt-2 flex justify-end">
                      <button
                        onClick={() => handleCancelBid(b.id)}
                        disabled={actionLoading === b.id}
                        className="text-[0.7rem] font-semibold underline-offset-2 hover:underline disabled:opacity-40 transition"
                        style={{ color: STATUS_META.CANCELLED.color }}
                      >
                        {actionLoading === b.id ? "Cancelling…" : "✕ Cancel bid"}
                      </button>
                    </div>
                  </>
                )}

                {/* Counter — v129 snaps the displayed counter to ₹100 and
                    parses the partner's structured amenity selection into
                    chip pills (anti-bypass: parseAddons drops free-text). */}
                {b.status === "COUNTER" && (() => {
                  const counterSnapped = snap100(b.counterAmount || 0);
                  const addons = parseAddons(b.hotelMessage || b.message || "");
                  const c = STATUS_META.COUNTER.color;
                  return (
                    <div className="mt-3 p-3.5 rounded-xl"
                      style={{ background: STATUS_META.COUNTER.soft, border: `1px solid ${c}44` }}>
                      <p className="text-sm mb-2.5" style={{ color: "var(--text-base)" }}>
                        Hotel countered at <span className="text-lg font-bold" style={{ color: c }}>₹{counterSnapped.toLocaleString("en-IN")}</span>/night
                      </p>
                      {addons.length > 0 && (
                        <div className="mb-2.5">
                          <p className="text-[0.58rem] font-bold uppercase tracking-widest mb-1.5" style={{ color: c }}>
                            🎁 Complimentary included
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {addons.map((a) => (
                              <span key={a.id} title={a.desc}
                                className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[0.62rem] font-semibold"
                                style={{ background: `${c}22`, border: `1px solid ${c}40`, color: "var(--text-base)" }}>
                                <span>{a.icon}</span><span>{a.label}</span>
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      <div className="flex gap-2">
                        <button onClick={() => handleCounterAccept(b)} disabled={actionLoading === b.id}
                          className="flex-1 py-2.5 gold-btn rounded-xl text-sm disabled:opacity-40">
                          {actionLoading === b.id ? "…" : `Accept ₹${counterSnapped.toLocaleString("en-IN")}`}
                        </button>
                        <button onClick={() => handleCounterReject(b.id)} disabled={actionLoading === b.id}
                          className="flex-1 py-2.5 text-sm font-semibold rounded-xl transition disabled:opacity-40"
                          style={{ background: STATUS_META.REJECTED.soft, color: STATUS_META.REJECTED.color, border: `1px solid ${STATUS_META.REJECTED.color}44` }}>
                          Decline
                        </button>
                      </div>
                    </div>
                  );
                })()}

                {/* Accepted: Pay Now gate */}
                {b.status === "ACCEPTED" && !paid && (
                  <div className="mt-3 p-3.5 rounded-xl"
                    style={{ background: STATUS_META.ACCEPTED.soft, border: `1px solid ${STATUS_META.ACCEPTED.color}44` }}>
                    <div className="flex items-center gap-2 mb-2.5">
                      <span className="text-lg">🎊</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold" style={{ color: "var(--text-base)" }}>Accepted at ₹{confirmAmt}/night</p>
                        <p className="text-[0.68rem]" style={{ color: "var(--text-soft)" }}>Total ₹{total.toLocaleString("en-IN")} · {nights} night{nights>1?"s":""}</p>
                      </div>
                    </div>
                    <AcceptedBidTimer
                      bidId={b.id}
                      hotelId={b.hotelId || b.hotel?.id}
                      acceptedAt={b.acceptedAt || b.updatedAt || b.createdAt}
                      onPayNow={() => handlePayNow(b)}
                      onExpired={() => { clearAcceptWindow(b.id); fetchBids(true); }}
                    />
                    <button onClick={() => handlePayNow(b)} disabled={actionLoading === b.id}
                      className="w-full py-3.5 gold-btn rounded-xl text-base font-bold disabled:opacity-40 mt-3"
                      style={{ animation: "pulseGlow 2s infinite", letterSpacing: "0.02em" }}>
                      {actionLoading === b.id ? "Opening Payment…" : `💰 Pay Now & Grab — ₹${total.toLocaleString("en-IN")} →`}
                    </button>
                    <p className="text-[0.62rem] text-center mt-2 tracking-wide" style={{ color: "var(--text-muted)" }}>
                      Secure payment via Razorpay · Instant confirmation
                    </p>
                  </div>
                )}

                {/* Accepted + paid */}
                {b.status === "ACCEPTED" && paid && (
                  <div className="mt-3 p-3 rounded-xl flex items-center justify-between gap-2"
                    style={{ background: STATUS_META.ACCEPTED.soft, border: `1px solid ${STATUS_META.ACCEPTED.color}44` }}>
                    <p className="text-sm font-medium" style={{ color: STATUS_META.ACCEPTED.color }}>✓ Booked at ₹{confirmAmt}/night</p>
                    <Link href="/bookings" className="text-xs font-semibold shrink-0" style={{ color: "#c9911a" }}>View Booking →</Link>
                  </div>
                )}

                {/* Footer */}
                <div className="mt-3.5 pt-2.5 flex items-center justify-between gap-2"
                  style={{ borderTop: "1px solid var(--border-soft)" }}>
                  <p className="text-[0.62rem] tracking-wide truncate" style={{ color: "var(--text-muted)" }}>
                    {b.createdAt
                      ? `Bid on ${new Date(b.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}`
                      : ""}
                  </p>
                  <Link href={`/hotels/${b.hotelId}`} className="text-xs font-medium tracking-wide shrink-0"
                    style={{ color: "#c9911a" }}>
                    View Hotel →
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Booking Review modal — sits between accept-counter / pay-now and Razorpay */}
      {review && <BookingReview {...review} open onClose={() => setReview(null)} />}
    </div>
  );
}

export default function MyBidsPage() {
  return (
    <Suspense fallback={<div style={{ padding: 40, textAlign: "center" }}>Loading…</div>}>
      <MyBidsPageInner />
    </Suspense>
  );
}
