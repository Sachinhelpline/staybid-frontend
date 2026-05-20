"use client";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
// Phase 4 tier-system — Inspiration nudge embedded in the booking-confirmed
// success modal. Self-dismissing per (user, hotel) via localStorage.
import InspirationBanner from "@/components/tier/InspirationBanner";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { openRazorpayCheckout } from "@/lib/razorpay";
import { calculateDynamicPrice, getRoomImage, DEMAND_STYLE, type DynamicPriceResult } from "@/lib/ai-pricing";
import { io } from "socket.io-client";
import LuxuryCalendar from "@/components/LuxuryCalendar";
import BookingReview, { type BookingReviewProps, type AppliedRedemption } from "@/components/BookingReview";
import ModalCloseButton from "@/components/ModalCloseButton";
import HotelHero from "@/components/hotel/HotelHero";
import HotelStatsRibbon from "@/components/hotel/HotelStatsRibbon";
import HotelScoreBadge from "@/components/hotel/HotelScoreBadge";
import HotelFeedbackSummary from "@/components/HotelFeedbackSummary";
import BackToTopButton from "@/components/BackToTopButton";
// v139 — per-page tutorial spotlight tour (5 steps: photos → picker →
// score badge → Book Now → Negotiate). Hook handles skip logic + waits
// until the first selector (.hx-room-media) renders.
import { usePageTour } from "@/lib/tutorial/usePageTour";
// v143 — imperative tour trigger for the Negotiate modal + Booking
// Review modal that open after a CTA tap.
import { useTutorial } from "@/lib/tutorial/tutorial-store";
import { computeHoldAmount, holdExpiresAt, saveHoldState } from "@/lib/hold-amount";
import { computeBidderScore, type BidderScore } from "@/lib/bidder-score";
import { notify } from "@/lib/notifications";
import {
  attributionFromParams,
  setAttribution,
  getAttribution,
  recordAttribution,
  type Attribution,
} from "@/lib/attribution";
// v129 — every bid/counter/flash price is a ₹100 multiple. See lib/price-snap.ts.
import { snap100, floor100, ceil100, snapClamp100, PRICE_STEP, PRICE_MIN } from "@/lib/price-snap";
// v130 — Hybrid AI Autopilot. resolveAutoAcceptMs adjusts the tier-based
// schedule by the hotel's autopilot_mode (auto / hybrid / manual). Hot
// path: never blocks on a missing column — falls back to 'auto'.
import { getAutopilotMode, resolveAutoAcceptMs } from "@/lib/autopilot";

const RAILWAY = "https://staybid-live-production.up.railway.app";
// Browser calls go through Vercel proxy so Jio/ISP blocks on Railway don't apply
const API = typeof window === "undefined" ? RAILWAY : "/api/proxy";
const today = new Date().toISOString().split("T")[0];
const tomorrow = new Date(Date.now() + 86400000).toISOString().split("T")[0];

function bidProb(amount: number, floor: number) {
  const r = amount / floor;
  // v130 — customer-facing copy never says "AI" / "auto" / "system" so the
  // experience reads as "the hotel confirmed your bid". The autopilot
  // scheduler is purely operational; the customer only sees a Hotel-first
  // story. (Pricing chrome elsewhere on the page can still say "AI Smart
  // Pricing" since live demand-based rates are industry standard.)
  if (r >= 1.00) return { p: 95, label: "👑 Priority Booking", badge: "Max Cashback Points", color: "text-emerald-600", bg: "bg-emerald-50", track: "#10b981", tip: "Highest priority — the hotel will confirm right away.", responseTime: "Confirms right away" };
  if (r >= 0.95) return { p: Math.round(70+(r-0.95)/0.05*24), label: "⭐ Strong Offer",    badge: "Bonus Points Eligible", color: "text-yellow-600", bg: "bg-yellow-50",  track: "#ca8a04", tip: "Very strong offer — hotel will likely respond within the hour.", responseTime: "~1 hr" };
  if (r >= 0.90) return { p: Math.round(45+(r-0.90)/0.05*24), label: "✨ Good Standing",   badge: "Standard Points",       color: "text-amber-600",  bg: "bg-amber-50",   track: "#d97706", tip: "Good offer — hotel typically responds in 2–3 hours.", responseTime: "2–3 hrs" };
  if (r >= 0.85) return { p: Math.round(25+(r-0.85)/0.05*19), label: "Moderate",           badge: "",                      color: "text-orange-500", bg: "bg-orange-50",  track: "#f97316", tip: "Hotel may counter with a higher price. Try raising slightly.", responseTime: "3–6 hrs" };
  if (r >= 0.78) return { p: Math.round(10+(r-0.78)/0.07*14), label: "Low Chance",         badge: "",                      color: "text-orange-600", bg: "bg-orange-100", track: "#ea580c", tip: "Risky bid — hotel likely to reject or counter high.", responseTime: "May reject" };
  return {         p: Math.max(2, Math.round(r/0.78*9)),       label: "Very Low",           badge: "",                      color: "text-red-500",    bg: "bg-red-50",     track: "#ef4444", tip: "Too low — hotel will almost certainly decline this bid.", responseTime: "Will reject" };
}

const sampleReviews = [
  { id:"s1", rating:5, comment:"Breathtaking views and impeccable service. Staff went above and beyond to make our anniversary special.", createdAt:"2026-03-15", guestName:"Priya S." },
  { id:"s2", rating:4, comment:"Lovely property with excellent amenities. The mountain air and peaceful surroundings made it a perfect getaway.", createdAt:"2026-02-28", guestName:"Rahul M." },
  { id:"s3", rating:5, comment:"Worth every rupee! Negotiated a great price through StayBid and the experience exceeded all expectations.", createdAt:"2026-01-10", guestName:"Anita K." },
];

/* v159.11 — Room photo swipe carousel. Replaces the static <img> +
   thumbnail-tap-to-swap pattern with a horizontal scroll-snap container
   showing ALL room photos full-bleed.
   v159.12 — Cleaned up: removed the 4-thumbnail strip + "N / total"
   counter per Sachin's "sirf scroll kaafi hai" feedback. Just swipe.
   Added mouse-drag support so laptop users can grab + drag like an
   iPhone touch swipe. */
function RoomSwipeMedia({
  roomId,
  roomName,
  images,
  activeIdx,
  onActiveIdxChange,
}: {
  roomId: string;
  roomName: string;
  images: string[];
  activeIdx: number;
  onActiveIdxChange: (idx: number) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const pausedUntilRef = useRef(0);

  // Sync activeIdx when user swipes by reading scrollLeft / clientWidth.
  // Throttled via rAF so rapid scrolls don't dispatch many state updates.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || images.length <= 1) return;
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const w = el.clientWidth || 1;
        const idx = Math.round(el.scrollLeft / w);
        const clamped = Math.max(0, Math.min(images.length - 1, idx));
        if (clamped !== activeIdx) onActiveIdxChange(clamped);
      });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [activeIdx, images.length, onActiveIdxChange]);

  // v159.13 — Auto-scroll. Cycle 1 slide every 5.5 s; pause for 8 s
  // after any user touchstart/pointerdown/wheel; resume after. Loops
  // back to first slide. Matches HotelHero auto-scroll behavior but
  // with a slightly slower cadence so room photos breathe.
  useEffect(() => {
    if (images.length <= 1) return;
    const el = scrollRef.current;
    if (!el) return;
    const onUserPoke = () => { pausedUntilRef.current = Date.now() + 8000; };
    el.addEventListener("touchstart", onUserPoke, { passive: true });
    el.addEventListener("pointerdown", onUserPoke);
    el.addEventListener("wheel", onUserPoke, { passive: true });
    const tick = window.setInterval(() => {
      if (!el) return;
      if (Date.now() < pausedUntilRef.current) return;
      const w = el.clientWidth || 1;
      const maxScroll = el.scrollWidth - w;
      let nextLeft = el.scrollLeft + w;
      if (nextLeft > maxScroll - 6) nextLeft = 0;
      el.scrollTo({ left: nextLeft, behavior: "smooth" });
    }, 5500);
    return () => {
      window.clearInterval(tick);
      el.removeEventListener("touchstart", onUserPoke);
      el.removeEventListener("pointerdown", onUserPoke);
      el.removeEventListener("wheel", onUserPoke);
    };
  }, [images.length]);

  // v159.12 — Mouse drag-to-scroll for desktop. Native scroll-snap-x
  // works for trackpad swipe + wheel, but doesn't accept a click+drag
  // gesture from a mouse. This handler captures the pointer, translates
  // dx into scrollLeft live, then on release lets the snap engine pull
  // the closest slide into view. Touch pointers (pointerType === touch)
  // are skipped so the native iOS / Android swipe stays untouched.
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== "mouse" || images.length <= 1) return;
    const el = scrollRef.current;
    if (!el) return;
    el.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startScroll = el.scrollLeft;
    el.style.scrollBehavior = "auto"; // disable smooth during drag
    el.style.cursor = "grabbing";
    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      el.scrollLeft = startScroll - dx;
    };
    const onUp = () => {
      el.style.scrollBehavior = "smooth";
      el.style.cursor = "";
      try { el.releasePointerCapture(e.pointerId); } catch {}
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onUp);
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onUp);
  };

  return (
    <>
      <div
        className="hx-room-swipe"
        ref={scrollRef}
        role="region"
        aria-label={`${roomName} photos`}
        onPointerDown={onPointerDown}
      >
        {images.map((img, idx) => (
          <div key={idx} className="hx-room-swipe-slide" aria-label={`Photo ${idx + 1} of ${images.length}`}>
            <img
              src={img}
              alt={`${roomName} — view ${idx + 1}`}
              className="hx-room-swipe-img hx-room-media-img"
              loading={idx === 0 ? "eager" : "lazy"}
              draggable={false}
              onError={(e: any) => {
                if (!e.target.dataset.fallbackTried) {
                  e.target.dataset.fallbackTried = "1";
                  e.target.src = `https://picsum.photos/seed/sb-fallback-${roomId}-${idx}/800/600`;
                }
              }}
            />
          </div>
        ))}
      </div>
      <div className="hx-room-media-grad" />
      {/* v159.13 — Desktop ‹›  arrows so mouse users don't have to
          rely on drag-to-pan (CSS hides at hover:none / mobile). */}
      {images.length > 1 && (
        <>
          <button
            type="button"
            className="hx-room-arrow hx-room-arrow-prev"
            aria-label="Previous photo"
            onClick={(e) => {
              e.preventDefault(); e.stopPropagation();
              const el = scrollRef.current; if (!el) return;
              const w = el.clientWidth || 1;
              let nx = el.scrollLeft - w;
              if (nx < -2) nx = el.scrollWidth - w;
              el.scrollTo({ left: nx, behavior: "smooth" });
              pausedUntilRef.current = Date.now() + 8000;
            }}
          >‹</button>
          <button
            type="button"
            className="hx-room-arrow hx-room-arrow-next"
            aria-label="Next photo"
            onClick={(e) => {
              e.preventDefault(); e.stopPropagation();
              const el = scrollRef.current; if (!el) return;
              const w = el.clientWidth || 1;
              const maxScroll = el.scrollWidth - w;
              let nx = el.scrollLeft + w;
              if (nx > maxScroll - 2) nx = 0;
              el.scrollTo({ left: nx, behavior: "smooth" });
              pausedUntilRef.current = Date.now() + 8000;
            }}
          >›</button>
        </>
      )}
    </>
  );
}

export default function HotelDetail() {
  const { id } = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, tokenType, login: authLogin } = useAuth();
  // v143 — modal tour triggers
  const { triggerTour } = useTutorial();

  const [hotel, setHotel]     = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // v139 — Tutorial Layer 2. Slightly longer delay (1400ms) because
  // hotel detail data loads from /api/hotels/[id] async — rooms +
  // photos + score badge all need to be in the DOM before the tour
  // can spotlight them. usePageTour polls for the first selector for
  // ~1.5s on top of the delay so this is a generous floor.
  usePageTour("hotel", "hotel", { delayMs: 1400 });

  // Flash deal URL params — the IMMUTABLE headline deal. dealRoomId is
  // the cheapest room (headline); dealPrice is its locked flash price.
  const dealId       = searchParams.get("dealId");
  const dealPrice    = searchParams.get("dealPrice");
  const dealRoomId   = searchParams.get("roomId");
  const dealDiscount = searchParams.get("discount");
  const directBook   = searchParams.get("directBook") === "true";
  // v159.16 — Flash-deal mode. When a customer arrives via a flash deal,
  // EVERY available room becomes bookable at the flash rate: the headline
  // room at dealPrice, every other room at dealPrice + the raw floor-price
  // gap (the "upgrade difference"). `flashSel` records which room+price
  // the flash booking modal currently targets — defaults to the headline.
  const flashMode = !!(dealId && dealPrice && dealRoomId);
  const [flashSel, setFlashSel] = useState<{ roomId: string; price: number } | null>(null);

  // Normal bid state
  const [bidRoom, setBidRoom]           = useState<any>(null);
  const [bidAmount, setBidAmount]       = useState("");
  const [bidMsg, setBidMsg]             = useState("");
  const [checkIn, setCheckIn]           = useState("");
  const [checkOut, setCheckOut]         = useState("");
  const [bidLoading, setBidLoading]     = useState(false);
  const [bidSuccess, setBidSuccess]     = useState(false);
  const [myBids, setMyBids]             = useState<any[]>([]);
  const [actionLoading, setActionLoading] = useState("");

  // Per-room active image index for the 4-photo gallery on each room card.
  // Key = room.id, value = index 0-3. Lifted to parent so each room's
  // selection persists while user scrolls the page.
  const [roomImgIdx, setRoomImgIdx] = useState<Record<string, number>>({});

  // Tabs
  const [tab, setTab] = useState("rooms");

  // Book Now state
  const [bnRoom, setBnRoom]       = useState<any>(null);
  const [bnIn, setBnIn]           = useState(today);
  const [bnOut, setBnOut]         = useState(tomorrow);
  const [bnAdults, setBnAdults]   = useState(2);
  const [bnChildren, setBnChildren] = useState(0);
  const [bnLoading, setBnLoading] = useState(false);
  const [bnSuccess, setBnSuccess] = useState(false);

  // Negotiate state
  const [negRoom, setNegRoom]     = useState<any>(null);
  const [negAmt, setNegAmt]       = useState(0);
  const [negIn, setNegIn]         = useState(today);
  const [negOut, setNegOut]       = useState(tomorrow);
  const [negLoading, setNegLoading] = useState(false);
  const [negSuccess, setNegSuccess] = useState(false);
  const [negAuto, setNegAuto]     = useState(false);

  // Booking Review modal — sits between user-confirm and Razorpay
  // payment. Used by Book Now, Flash Deal, Negotiate-above-floor. The
  // review screen shows complete trip details + lets user choose
  // Pay-Full / Hold-for-24h / Pay-Hold-Now-Settle-At-Hotel.
  const [review, setReview] = useState<null | (Omit<BookingReviewProps,"open"|"onClose">)>(null);

  // v159 — Recently viewed tracker. Push current hotel id to front of
  // `sb_recent_viewed_hotels` localStorage (max 12). Read by /hotels rails.
  useEffect(() => {
    if (typeof window === "undefined" || !id) return;
    try {
      const raw = localStorage.getItem("sb_recent_viewed_hotels");
      const prev: string[] = raw ? JSON.parse(raw) : [];
      const next = [String(id), ...prev.filter((x) => String(x) !== String(id))].slice(0, 12);
      localStorage.setItem("sb_recent_viewed_hotels", JSON.stringify(next));
    } catch {}
  }, [id]);

  // v124.2 — Hide the floating "Check availability" mobile pill when ANY
  // in-page primary CTA is visible. Real-device feedback: pill sat ON TOP
  // of the in-page "Book Now / Negotiate" row when scrolled to the bottom.
  // The pill is REDUNDANT once the user can already see the primary CTAs.
  const [inPageCtaVisible, setInPageCtaVisible] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !("IntersectionObserver" in window)) return;
    const timer = setTimeout(() => {
      const ctas = document.querySelectorAll(".hx-cta-primary");
      if (!ctas.length) return;
      const visibleSet = new Set<Element>();
      const obs = new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            if (e.isIntersecting) visibleSet.add(e.target);
            else visibleSet.delete(e.target);
          }
          setInPageCtaVisible(visibleSet.size > 0);
        },
        { threshold: 0.4, rootMargin: "0px 0px -90px 0px" }
      );
      ctas.forEach((el) => obs.observe(el));
      (window as any).__hxCtaObs = obs;
    }, 200);
    return () => {
      clearTimeout(timer);
      const obs = (window as any).__hxCtaObs;
      if (obs) { obs.disconnect(); delete (window as any).__hxCtaObs; }
    };
  }, [hotel?.id, hotel?.rooms?.length]);

  // Customer's bidder tier — derived from past bid history.
  // v124.2 — unified body class so BottomDock + DialerNav + BackChip
  // all hide cleanly while ANY of the inline modals on this page are
  // open. The BookingReview / LuxuryCalendar / LocationGlobe components
  // already toggle .sb-modal-open themselves; this effect covers the
  // remaining inline modals (Book Now / Negotiate / Flash Book / picker /
  // gallery). Drives the
  // confidence chip shown in the Negotiate modal + informs backend on
  // expected auto-accept latency (premium = instant, lowball = manual).
  const [bidderScore, setBidderScore] = useState<BidderScore | null>(null);

  // Per-hotel hold-config (Phase 4) — drives whether the Hold / Pay-at-hotel
  // buttons render on the Booking Review screen. Fetched once when the
  // hotel loads; falls back to platform defaults if the API is offline.
  const [holdConfig, setHoldConfig] = useState<{
    hold_enabled: boolean;
    pay_at_hotel_enabled: boolean;
    tier_overrides: { upTo: number; amount: number }[] | null;
    acceptance_window_min: number;
  } | null>(null);
  useEffect(() => {
    if (!id) return;
    fetch(`/api/hotel-hold-config?hotelId=${encodeURIComponent(String(id))}`)
      .then((r) => r.json())
      .then((d) => { if (d?.resolved) setHoldConfig(d.resolved); })
      .catch(() => {});
  }, [id]);

  // Inline phone verify (for Google/social login users who have Firebase token)
  const [verifyOpen, setVerifyOpen]         = useState(false);
  const [verifyPhone, setVerifyPhone]       = useState("");
  const [verifyOtpVal, setVerifyOtpVal]     = useState("");
  const [verifyStep, setVerifyStep]         = useState<"phone" | "otp">("phone");
  const [verifyLoading, setVerifyLoading]   = useState(false);
  const [verifyError, setVerifyError]       = useState("");
  const pendingAction = useRef<(() => void) | null>(null);

  // Flash deal booking state
  const [flashBookOpen, setFlashBookOpen]     = useState(false);
  const [flashCheckOut, setFlashCheckOut]     = useState(tomorrow);
  const [flashAdults, setFlashAdults]         = useState(2);
  const [flashChildren, setFlashChildren]     = useState(0);
  const [bookLoading, setBookLoading]         = useState(false);
  const [flashBookSuccess, setFlashBookSuccess] = useState(false);
  // Multi-room / multi-night extension for flash deals. Default 1 room × 1 night (deal's original scope).
  const [flashRoomQty, setFlashRoomQty]       = useState(1);
  // Live availability check state: { unitsFree, unitsTotal, feasible, loading, error }
  const [flashAvail, setFlashAvail]           = useState<{ unitsFree: number; unitsTotal: number; feasible: boolean; loading: boolean; error?: string } | null>(null);

  // AI live pricing state — keyed by roomId, recalculates every 60s
  const [roomPrices, setRoomPrices] = useState<Record<string, DynamicPriceResult>>({});
  const [priceFlash, setPriceFlash] = useState<Record<string, boolean>>({});

  // Global availability selector (above room cards — single source of truth)
  const [globalCheckIn, setGlobalCheckIn]       = useState("");
  const [globalCheckOut, setGlobalCheckOut]     = useState("");
  // Luxury calendar modal — single instance, configured per-opener
  const [calCfg, setCalCfg] = useState<{
    open: boolean;
    mode: "checkIn" | "checkOut";
    checkIn: string;
    checkOut: string;
    minCheckIn?: string;  // if set, prevents picking checkIn before this date (e.g. "today" for flash deals)
    rooms?: Array<{ floorPrice?: number | null }>;  // override which rooms drive the per-day price overlay
    pricingMode?: "hotel" | "demand" | "none";
    headerBanner?: React.ReactNode;
    onApply: (r: { checkIn: string; checkOut: string }) => void;
  }>({ open: false, mode: "checkIn", checkIn: "", checkOut: "", onApply: () => {} });

  const openCalendar = (cfg: Omit<typeof calCfg, "open">) => setCalCfg({ ...cfg, open: true });
  const closeCalendar = () => setCalCfg(c => ({ ...c, open: false }));
  const [globalAdults, setGlobalAdults]         = useState(2);
  const [globalChildren, setGlobalChildren]     = useState(0); // 5-12 yrs ₹200/night
  const [globalKids, setGlobalKids]             = useState(0); // <5 yrs FREE
  const globalTotalGuests = globalAdults + globalChildren + globalKids;

  // v159.8 — Hydrate from URL params passed by the /hotels SearchSheet
  // (or directly bookmarked). One-time on mount; subsequent picker edits
  // on this page override these. URL params are the SOURCE of truth on
  // first paint so the picker arrives pre-filled with the search state.
  useEffect(() => {
    const sp = searchParams;
    const ci = sp.get("checkIn");
    const co = sp.get("checkOut");
    const ad = sp.get("adults");
    const ch = sp.get("children");
    const kd = sp.get("kids");
    if (ci) setGlobalCheckIn(ci);
    if (co) setGlobalCheckOut(co);
    if (ad) setGlobalAdults(Math.max(1, Math.min(8, Number(ad) || 2)));
    if (ch) setGlobalChildren(Math.max(0, Math.min(6, Number(ch) || 0)));
    if (kd) setGlobalKids(Math.max(0, Math.min(6, Number(kd) || 0)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const globalNights = (globalCheckIn && globalCheckOut)
    ? Math.max(1, Math.ceil((new Date(globalCheckOut).getTime() - new Date(globalCheckIn).getTime()) / 86400000))
    : 0;
  const datesSelected = !!(globalCheckIn && globalCheckOut);

  // Floating picker modal — opens when user taps Book Now/Negotiate without dates selected.
  // Stores { intent: 'book'|'negotiate', room: any } to auto-resume once dates are picked.
  const [pickerModal, setPickerModal] = useState<{ intent: "book" | "negotiate"; room: any } | null>(null);

  // Gallery state
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [galleryIdx, setGalleryIdx] = useState(0);

  // v132.6 — Keyboard arrows + Escape for the photo lightbox.
  // Desktop users expect arrow-key navigation in any gallery (YouTube,
  // Instagram, Airbnb, Booking.com all do this). On mobile this listener
  // is harmless — there's no keyboard. The handler reads `hotel.images`
  // at fire-time so it's always in sync with the latest image set; the
  // `Math.max(5, base.length)` mirrors the same total computed inside
  // the lightbox JSX.
  useEffect(() => {
    if (!galleryOpen) return;
    const onKey = (e: KeyboardEvent) => {
      const base = Array.isArray(hotel?.images) ? hotel.images : [];
      const total = Math.max(5, base.length);
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        setGalleryIdx((i) => Math.max(0, i - 1));
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        setGalleryIdx((i) => Math.min(total - 1, i + 1));
      } else if (e.key === "Escape") {
        e.preventDefault();
        setGalleryOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [galleryOpen, hotel?.images]);

  // v124.2 — toggle sb-modal-open whenever an inline modal is open so the
  // BottomDock / DialerNav / BackChip auto-hide. Decoupled from the
  // BookingReview / LuxuryCalendar / LocationGlobe components which each
  // own their own toggle for safety.
  useEffect(() => {
    const anyOpen = !!(bnRoom || negRoom || flashBookOpen || pickerModal || galleryOpen);
    if (anyOpen) {
      document.body.classList.add("sb-modal-open");
      return () => document.body.classList.remove("sb-modal-open");
    }
  }, [bnRoom, negRoom, flashBookOpen, pickerModal, galleryOpen]);

  // v133 — IntersectionObserver scroll-reveal for far-below-fold sections.
  // Above-fold sections keep using `.hx-reveal` (mount-time stagger). Sections
  // marked `.hx-reveal-io` start hidden and animate when scrolled into view.
  // Re-runs on hotel or tab change so newly-mounted sections get observed.
  // Respects prefers-reduced-motion.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      document.querySelectorAll<HTMLElement>(".hx-reveal-io").forEach((el) =>
        el.classList.add("is-visible"),
      );
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add("is-visible");
            io.unobserve(e.target);
          }
        }
      },
      { threshold: 0.15, rootMargin: "0px 0px -10% 0px" },
    );
    const raf = requestAnimationFrame(() => {
      document
        .querySelectorAll<HTMLElement>(".hx-reveal-io:not(.is-visible)")
        .forEach((el) => io.observe(el));
    });
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
    };
  }, [hotel?.id, tab]);

  const selectedCheckIn = globalCheckIn || bnIn || negIn || today;

  useEffect(() => {
    if (!id) return;
    api.getHotel(id as string)
      .then((d) => {
        setHotel(d.hotel);
        if (dealRoomId && d.hotel?.rooms) {
          const room = d.hotel.rooms.find((r: any) => r.id === dealRoomId);
          if (room) setFlashAdults(room.capacity || 2);
        }
        if (directBook && dealId) setFlashBookOpen(true);
        // ── Deep-link from /discover Negotiate CTA: auto-open the picker
        // pre-targeting the cheapest room with intent=negotiate. Once user
        // picks dates, the picker auto-resumes into the Negotiate modal.
        const intent = searchParams.get("intent");
        if (intent === "negotiate" && d.hotel?.rooms?.length) {
          const cheapest = d.hotel.rooms.reduce((acc: any, r: any) =>
            (!acc || (r.floorPrice || 99999) < (acc.floorPrice || 99999)) ? r : acc, null);
          if (cheapest) setPickerModal({ intent: "negotiate", room: cheapest });
        } else if (intent === "book" && d.hotel?.rooms?.length) {
          const cheapest = d.hotel.rooms.reduce((acc: any, r: any) =>
            (!acc || (r.floorPrice || 99999) < (acc.floorPrice || 99999)) ? r : acc, null);
          if (cheapest) setPickerModal({ intent: "book", room: cheapest });
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  const fetchMyBids = () => {
    if (!user) return;
    api.getMyBids?.()
      .then((d) => {
        const all = d.bids || [];
        const hotelBids = all.filter((b: any) => b.hotelId === id);
        setMyBids(hotelBids);
        // Bidder score is computed from ALL bids across hotels — full history
        try { setBidderScore(computeBidderScore(all)); } catch {}
      })
      .catch(() => {});
  };

  useEffect(() => { fetchMyBids(); }, [user, id]);

  // ── v94 booking-source attribution ──────────────────────────────────────
  // Capture src/cid/via/vid/ctype from the URL on first mount and persist
  // them in localStorage so the attribution survives the Razorpay round-
  // trip. After every successful bid placement we POST to
  // /api/attribution/record which writes bid_attributions + (when the
  // creator is a registered active influencer) influencer_commissions.
  //
  // v96 — additionally honour the `sb_ref` cookie/localStorage set by
  // /r/[code] (referral link clicks). When a customer reaches a hotel
  // page via a referral link (Instagram bio, WhatsApp DM, etc.) without
  // explicit URL params, we resolve the code → fetch the creator's
  // user_id + handle → build the same `creator` attribution payload.
  // This is what turns a tracked CLICK into an attributed BOOKING.
  const [attribution, setAttributionState] = useState<Attribution | null>(null);
  const [referralCode, setReferralCode] = useState<string | null>(null);
  useEffect(() => {
    if (!id) return;
    const fromUrl = attributionFromParams(searchParams);
    if (fromUrl) {
      setAttribution(id as string, fromUrl);
      setAttributionState(fromUrl);
    } else {
      // Fall back to any stored attribution for this hotel (e.g. user came
      // from a reel, then refreshed the hotel page) — still counts.
      const stored = getAttribution(id as string);
      if (stored) setAttributionState(stored);
    }
    // Flash-deal direct-book wins source classification when no creator
    // attribution is present (a deal coming from /flash-deals or the
    // home-page rail isn't a creator-driven booking).
    if (!fromUrl && dealId) {
      const flashAttr: Attribution = { source: "flash", capturedAt: Date.now() };
      setAttribution(id as string, flashAttr);
      setAttributionState(flashAttr);
    }

    // v96 — read the referral cookie / localStorage and resolve it.
    // The /r/[code] handler sets BOTH a cookie (30d) and a localStorage
    // entry — we check both so cleared cookies / cleared storage still
    // produce attribution as long as one survives.
    if (!fromUrl && !dealId && typeof window !== "undefined") {
      const fromLS = (() => { try { return localStorage.getItem("sb_ref") || ""; } catch { return ""; } })();
      const fromCookie = (() => {
        const m = (document.cookie || "").match(/(?:^|;\s*)sb_ref=([^;]+)/);
        return m ? decodeURIComponent(m[1]) : "";
      })();
      const code = (fromLS || fromCookie || "").trim();
      if (code) {
        setReferralCode(code);
        fetch(`/api/referrals/resolve/${encodeURIComponent(code)}`)
          .then((r) => r.json())
          .then((j) => {
            if (!j?.code || !j?.creator) return;
            const refAttr: Attribution = {
              source: "creator",
              creatorUserId: j.creator.userId || undefined,
              creatorHandle: j.creator.handle || undefined,
              creatorType: "CREATOR",
              videoId: undefined,
              capturedAt: Date.now(),
            };
            setAttribution(id as string, refAttr);
            setAttributionState(refAttr);
          })
          .catch(() => {});
      }
    }
  }, [id, searchParams, dealId]);

  // v96 — fire the existing `/api/referrals/attribute` endpoint after every
  // createBidRequest so the legacy `bid_requests.influencer_id` column also
  // gets set (some downstream reports / Phase-D triggers depend on it).
  // Idempotent: the endpoint no-ops when the request is already attributed.
  const attributeReferral = useCallback(async (requestId: string | undefined) => {
    if (!requestId || !referralCode) return;
    try {
      const token = localStorage.getItem("sb_token");
      await fetch("/api/referrals/attribute", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ requestId, code: referralCode }),
      });
    } catch { /* best-effort */ }
  }, [referralCode]);

  // ── Real-time availability (blocked dates across all sources) ─────────────
  const [blockedByRoom, setBlockedByRoom] = useState<Record<string, Set<string>>>({});
  useEffect(() => {
    if (!id) return;
    const to = new Date(Date.now() + 180 * 86400000).toISOString().slice(0,10);
    fetch(`/api/availability?hotelId=${id}&from=${today}&to=${to}`)
      .then(r => r.json())
      .then(d => {
        const map: Record<string, Set<string>> = {};
        Object.entries(d.rooms || {}).forEach(([rid, dates]: any) => {
          map[rid] = new Set(dates as string[]);
        });
        setBlockedByRoom(map);
      })
      .catch(() => {});
  }, [id]);

  // ── Per-UNIT availability (room-number level) for the selected window ────
  // Powers the "Room #101 ✓ vacant · Room #102 ✗ occupied" grid shown in each
  // room card and exposes a live unitsFree count so UI never oversells.
  const [unitAvail, setUnitAvail] = useState<Record<string, any>>({});
  useEffect(() => {
    if (!id || !globalCheckIn || !globalCheckOut) return;
    let cancelled = false;
    const q = new URLSearchParams({ hotelId: id as string, from: globalCheckIn, to: globalCheckOut });
    fetch(`/api/availability/units?${q.toString()}`)
      .then(r => r.json())
      .then(j => { if (!cancelled) setUnitAvail(j.rooms || {}); })
      .catch(() => {});
    // Refresh every 30s so the grid stays live as other customers book
    const t = setInterval(() => {
      fetch(`/api/availability/units?${q.toString()}`)
        .then(r => r.json())
        .then(j => { if (!cancelled) setUnitAvail(j.rooms || {}); })
        .catch(() => {});
    }, 30000);
    return () => { cancelled = true; clearInterval(t); };
  }, [id, globalCheckIn, globalCheckOut]);

  // Check if selected date range overlaps blocks for any room
  function dateRangeBlocked(checkIn: string, checkOut: string, roomId?: string): boolean {
    if (!checkIn || !checkOut) return false;
    const check = (rid: string) => {
      const set = blockedByRoom[rid]; if (!set) return false;
      for (let d = new Date(checkIn); d < new Date(checkOut); d.setDate(d.getDate()+1)) {
        if (set.has(d.toISOString().slice(0,10))) return true;
      }
      return false;
    };
    if (roomId) return check(roomId);
    // Any room blocked = not a hard fail, just info
    return Object.keys(blockedByRoom).some(check);
  }

  useEffect(() => {
    if (!user) return;
    const socket = io(RAILWAY);
    socket.emit("join:customer", user.id);
    socket.on("bid:counter", (bid: any) => {
      if (bid.hotelId === id)
        setMyBids((prev) => prev.map((b) => b.id === bid.id ? { ...b, ...bid } : b));
    });
    return () => { socket.disconnect(); };
  }, [user, id]);

  // ── AI live pricing: recalculate every 60s ──────────────────────────────────
  useEffect(() => {
    if (!hotel?.rooms?.length) return;
    const recalculate = () => {
      const checkInForCalc = selectedCheckIn || today;
      const next: Record<string, DynamicPriceResult> = {};
      for (const r of hotel.rooms) {
        next[r.id] = calculateDynamicPrice(r.floorPrice || 1000, checkInForCalc, hotel.city || "Mussoorie");
      }
      setRoomPrices((prev) => {
        // Flash animation on price change
        const changed: Record<string, boolean> = {};
        for (const [id, val] of Object.entries(next)) {
          if (prev[id] && prev[id].price !== val.price) changed[id] = true;
        }
        if (Object.keys(changed).length > 0) {
          setPriceFlash(changed);
          setTimeout(() => setPriceFlash({}), 1200);
        }
        return next;
      });
    };
    recalculate();
    const timer = setInterval(recalculate, 60_000);
    return () => clearInterval(timer);
  }, [hotel, selectedCheckIn]);

  // ── v123.1 — Scroll-reveal moved to pure CSS (animation auto-plays
  // on mount via .hx-reveal). No JS observer needed — content is
  // visible by default and just animates in. Removes GPU pressure from
  // 13+ will-change layers + eliminates the flash-of-invisible-content
  // bug that v123 had when the IntersectionObserver didn't fire.

  // ── Flash deal calculations ────────────────────────
  // v159.16 — fbRoomId / fbPrice resolve the flash booking target:
  // `flashSel` when the user tapped a specific room (headline OR an
  // upgrade), else the URL headline. The modal + handleFlashBook read
  // these instead of the raw URL params so upgrades book correctly.
  const fbRoomId       = flashSel?.roomId || dealRoomId;
  const fbPrice        = flashSel ? flashSel.price : parseFloat(dealPrice || "0");
  const flashRoom      = hotel?.rooms?.find((r: any) => r.id === fbRoomId);
  const baseCapacity   = flashRoom?.capacity || 2;
  const flashNights    = Math.max(1, Math.ceil(
    (new Date(flashCheckOut).getTime() - new Date(today).getTime()) / 86400000
  ));
  const extraAdults        = Math.max(0, flashAdults - baseCapacity);
  const extraAdultRate     = 500;
  const childRate          = 200;
  const flashBaseTotal     = fbPrice * flashNights * flashRoomQty;
  const flashExtraTotal    = extraAdults * extraAdultRate * flashNights;
  const flashChildTotal    = flashChildren * childRate * flashNights;
  const flashGrandTotal    = flashBaseTotal + flashExtraTotal + flashChildTotal;
  // Flash deals originally cover 1 room × 1 night (today→tomorrow). Any additional
  // rooms or extra nights constitute an "upgrade" that needs availability approval.
  const flashIsUpgrade     = flashRoomQty > 1 || flashNights > 1;

  // ── Flash deal booking ─────────────────────────────
  // ── Detect Firebase RS256 token by reading the JWT header ──────────────────
  const isFirebaseToken = () => {
    try {
      const tok = localStorage.getItem("sb_token") || "";
      const b64 = tok.split(".")[0].replace(/-/g, "+").replace(/_/g, "/");
      const header = JSON.parse(atob(b64));
      return header.alg === "RS256";
    } catch { return false; }
  };

  // ── Open inline phone verify and queue an action to run after verify ───────
  const openVerifyAndRetry = (action: () => void) => {
    pendingAction.current = action;
    setVerifyOpen(true);
    setVerifyStep("phone");
    setVerifyPhone("");
    setVerifyOtpVal("");
    setVerifyError("");
  };

  // ── Inline phone verify helpers ────────────────────────────────────────────
  const withBackendAuth = (action: () => void) => {
    if (!user) return router.push("/auth");
    // Detect Firebase token by algorithm — works for old sessions too
    if (tokenType === "firebase" || isFirebaseToken()) {
      openVerifyAndRetry(action);
      return;
    }
    action();
  };

  const sendVerifyOtp = async () => {
    if (verifyPhone.length < 10) return setVerifyError("Please enter a 10-digit number.");
    setVerifyLoading(true);
    setVerifyError("");
    try {
      await api.sendOtp(`+91${verifyPhone}`);
      setVerifyStep("otp");
    } catch (e: any) {
      setVerifyError(e.message || "Failed to send OTP. Please try again.");
    } finally {
      setVerifyLoading(false);
    }
  };

  const confirmVerifyOtp = async () => {
    if (verifyOtpVal.length < 4) return setVerifyError("Please enter your OTP.");
    setVerifyLoading(true);
    setVerifyError("");
    try {
      const data = await api.verifyOtp(`+91${verifyPhone}`, verifyOtpVal);
      authLogin(data.token || data.accessToken, {
        ...data.user,
        name: user?.name || data.user?.name,
        email: user?.email || data.user?.email,
      }, "backend");
      setVerifyOpen(false);
      // Run the original action after a tick so new token is stored
      setTimeout(() => {
        if (pendingAction.current) {
          pendingAction.current();
          pendingAction.current = null;
        }
      }, 100);
    } catch (e: any) {
      setVerifyError(e.message || "Incorrect OTP. Please try again.");
    } finally {
      setVerifyLoading(false);
    }
  };

  const jwtRedirect = (msg: string) => {
    const m = (msg || "").toLowerCase();
    return m.includes("algorithm") || m.includes("jwt") || m.includes("invalid token") || m.includes("unauthorized") || m.includes("401") || m.includes("forbidden") || m.includes("session");
  };

  const sendBookingEmail = async (details: {
    bookingId: string; hotelName: string; roomType: string;
    checkIn: string; checkOut: string; guests: number; nights: number;
    amount: number; paymentId?: string; city?: string;
  }) => {
    const email = user?.email;
    if (!email) return;
    try {
      await fetch("/api/email/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: email, bookingDetails: details }),
      });
    } catch { /* email failure should not block booking flow */ }
  };

  // Flash deal booking — routes through BookingReview first.
  const handleFlashBook = () => {
    if (!user) return router.push("/auth");
    const dealAmt = fbPrice;
    const rateLines = [
      { label: `₹${dealAmt.toLocaleString()} × ${flashNights} night${flashNights>1?"s":""}${flashRoomQty>1?` × ${flashRoomQty} rooms`:""}`, value: `₹${flashBaseTotal.toLocaleString()}` },
      ...(flashExtraTotal>0 ? [{ label: `${extraAdults} extra adult${extraAdults>1?"s":""} × ₹${extraAdultRate} × ${flashNights}n`, value: `₹${flashExtraTotal.toLocaleString()}` }] : []),
      ...(flashChildTotal>0 ? [{ label: `${flashChildren} child${flashChildren>1?"ren":""} × ₹${childRate} × ${flashNights}n`, value: `₹${flashChildTotal.toLocaleString()}` }] : []),
      { label: `🔥 Flash deal · ${dealDiscount || 0}% off`, value: "Locked", subtle: true },
    ];
    setReview({
      hotelName: hotel.name,
      hotelCity: hotel.city,
      roomType: flashRoom?.name || flashRoom?.type || "Flash Deal Room",
      checkIn: today, checkOut: flashCheckOut, nights: flashNights,
      adults: flashAdults, children: flashChildren, kids: 0,
      rateLines, totalAmount: flashGrandTotal,
      flowLabel: "🔥 Flash Deal",
      onUpdate: () => setReview(null),
      onPayFull: (final, applied) => executeFlashBook("full", 0, final, applied),
      onHold:    (h, final, applied) => executeFlashBook("hold", h, final, applied),
      onPayAtHotel: (h, final, applied) => executeFlashBook("payhotel", h, final, applied),
      holdEnabled: holdConfig?.hold_enabled ?? true,
      payAtHotelEnabled: holdConfig?.pay_at_hotel_enabled ?? true,
      holdTiers: holdConfig?.tier_overrides || undefined,
    });
  };

  const executeFlashBook = async (
    mode: "full"|"hold"|"payhotel",
    holdAmount: number,
    finalAmount: number = flashGrandTotal,
    applied: AppliedRedemption = {},
  ) => {
    setBookLoading(true);
    try {
      // v124 — Razorpay charges the post-redemption amount. If finalAmount===0
      // (full wallet+coupon coverage), skip Razorpay entirely.
      const charge = mode === "full" ? finalAmount : holdAmount;
      let payResult: any = { razorpay_payment_id: "wallet_only" };
      if (charge > 0) payResult = await openRazorpayCheckout({
        amount: charge,
        hotelName: hotel.name,
        description: mode === "full"
          ? `Flash Deal — ${flashRoom?.name || "Room"} — ${flashNights} night${flashNights > 1 ? "s" : ""}`
          : `🔒 Hold flash deal · Lock ₹${flashGrandTotal.toLocaleString()} for 24h`,
        userName: user!.name || user!.phone || "",
        userPhone: user!.phone,
        userEmail: user!.email,
      });

      // Step 2: Confirm booking in backend
      const dealAmt  = fbPrice;
      const floorAmt = flashRoom?.floorPrice || dealAmt;

      const reqRes = await api.createBidRequest?.({
        hotelId: hotel.id, roomId: fbRoomId,
        amount: floorAmt,
        checkIn: today, checkOut: flashCheckOut,
        guests: flashAdults + flashChildren,
      });
      // v96 — referral attribution (legacy bid_requests.influencer_id column)
      attributeReferral(reqRes?.request?.id);

      // BUG-FIX 1: always embed actual paid total in the bid message as a
      // structured `paid:X` token. The fallback `placeBid` writes floorPrice
      // as bid.amount (because backend rejects below-floor without dealId),
      // which is what the hotel was seeing as ₹1899 even though the customer
      // paid ₹20. Both customer + partner views now parse this token first,
      // then fall back to bid.amount only if it's missing.
      // For Hold mode, paid = holdAmount; balance is settled later.
      const paidTotal = mode === "full" ? flashGrandTotal : charge;
      const paidPerNight = dealAmt;
      const holdTag = mode === "full" ? "" : ` | hold:${charge} | total:${flashGrandTotal}${mode === "payhotel" ? " | pay-at-hotel" : ""}`;
      const baseMsg = `Flash Deal | ${flashNights} nights | ${flashAdults} adults${flashChildren ? ` | ${flashChildren} children` : ""}${holdTag}`;
      const paidTokens = `paid:${paidTotal} | rate:${paidPerNight} | Razorpay: ${payResult.razorpay_payment_id}`;

      let bidRes: any;
      try {
        bidRes = await api.placeBid({
          hotelId: hotel.id, roomId: fbRoomId!,
          amount: dealAmt,
          message: `${baseMsg} | ${paidTokens}`,
          requestId: reqRes?.request?.id,
          dealId: dealId,
        });
      } catch {
        bidRes = await api.placeBid({
          hotelId: hotel.id, roomId: fbRoomId!,
          amount: floorAmt,
          message: `${baseMsg} | ${paidTokens}`,
          requestId: reqRes?.request?.id,
          dealId: dealId,
        });
      }

      try { await api.acceptBid(bidRes.bid.id); } catch {}
      // v124 — apply coupon / wallet credit to the bid (idempotent server-side)
      if (applied?.couponCode || applied?.walletCreditAppliedInr) {
        try {
          await api.applyRedemption({
            bidId: bidRes.bid.id,
            couponCode: applied.couponCode,
            walletCreditInr: applied.walletCreditAppliedInr,
          });
        } catch {}
      }
      localStorage.setItem(`bid_dates_${bidRes.bid.id}`, JSON.stringify({ checkIn: today, checkOut: flashCheckOut }));
      localStorage.setItem(`deal_price_${bidRes.bid.id}`, String(dealAmt));
      localStorage.setItem(`paid_amount_${bidRes.bid.id}`, String(paidTotal));

      // Hold state (only when not paying full upfront)
      if (mode !== "full") {
        saveHoldState({
          bidId: bidRes.bid.id,
          hotelId: hotel.id, hotelName: hotel.name, roomType: flashRoom?.name || flashRoom?.type,
          holdAmount: charge, balanceDue: flashGrandTotal - charge, totalAmount: flashGrandTotal,
          holdPaymentId: payResult.razorpay_payment_id,
          expiresAt: holdExpiresAt().toISOString(), createdAt: new Date().toISOString(),
          status: "active", flow: "flash",
          checkIn: today, checkOut: flashCheckOut,
          payAtHotel: mode === "payhotel",
        });
      }

      // BULLETPROOF: record paid amount server-side so partner panel + every
      // surface reads the truth (bid.amount may have been corrupted to floor).
      try {
        await fetch("/api/bid/paid", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            bidId: bidRes.bid.id, hotelId: hotel.id, roomId: fbRoomId,
            customerId: user!.id,
            paidTotal, paidPerNight: paidPerNight, nights: flashNights,
            flow: mode === "full" ? "flash" : `flash-${mode}`, dealId,
            razorpayPaymentId: payResult.razorpay_payment_id,
          }),
        });
      } catch {}

      // v94 — record booking-source attribution. Flash bookings default to
      // `flash` source unless the customer originally came from a creator
      // reel (preserves creator credit even when the user pivots into a deal).
      recordAttribution({
        bidId: bidRes.bid.id,
        hotelId: hotel.id,
        customerId: user!.id,
        paidTotal,
        flow: mode === "full" ? "flash" : `flash-${mode}`,
        dealId,
        attribution: attribution && attribution.source !== "direct"
          ? attribution
          : { source: "flash", capturedAt: Date.now() },
      });

      // Step 2.5: If customer extended qty (>1 room) or nights (>1), post upgrade request.
      // The endpoint auto-approves when units are free, else creates a pending block that
      // shows up in the hotel owner's dashboard for approval.
      if (flashIsUpgrade) {
        try {
          const token = localStorage.getItem("sb_token");
          // qty - 1 because the primary booking (above) already reserves 1 room
          const extraQty = Math.max(0, flashRoomQty - 1);
          if (extraQty > 0 || flashNights > 1) {
            await fetch("/api/flash-deals/upgrade", {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
              body: JSON.stringify({
                hotelId: hotel.id,
                roomId: fbRoomId,
                fromDate: today,
                toDate: flashCheckOut,
                qty: extraQty > 0 ? extraQty : 1,
                pricePerNight: dealAmt,
                guestName: user!.name || user!.phone,
                guestPhone: user!.phone,
                note: `Flash deal booking #${bidRes.bid.id.slice(0, 8)} · ${flashRoomQty} room(s) × ${flashNights} night(s)${mode !== "full" ? ` · HOLD (${mode})` : ""}`,
                razorpayPaymentId: payResult.razorpay_payment_id,
              }),
            });
          }
        } catch { /* upgrade record is best-effort; primary booking already succeeded */ }
      }

      // Step 3: Send confirmation email (only for full pay — hold flows email on balance settle)
      if (mode === "full") {
        await sendBookingEmail({
          bookingId: bidRes.bid.id,
          hotelName: hotel.name,
          roomType: flashRoom?.name || flashRoom?.type || "Room",
          checkIn: today,
          checkOut: flashCheckOut,
          guests: flashAdults + flashChildren,
          nights: flashNights,
          amount: flashGrandTotal,
          paymentId: payResult.razorpay_payment_id,
          city: hotel.city,
        });
      }

      setReview(null);
      setFlashBookOpen(false);
      setFlashBookSuccess(true);
    } catch (e: any) {
      if (e.message === "__CANCELLED__") { /* user dismissed Razorpay */ return; }
      if (jwtRedirect(e.message) || isFirebaseToken()) {
        setFlashBookOpen(false); setReview(null);
        openVerifyAndRetry(() => handleFlashBook());
      } else {
        alert(e.message || "Booking failed. Please try again.");
      }
    } finally {
      setBookLoading(false);
    }
  };

  // ── Normal bid ─────────────────────────────────────
  const handleBid = async () => {
    if (!user) return router.push("/auth");
    if (!bidAmount || !bidRoom || !checkIn || !checkOut) return alert("Please fill all fields");
    setBidLoading(true);
    try {
      const reqRes = await api.createBidRequest?.({
        hotelId: hotel.id, roomId: bidRoom.id,
        amount: parseFloat(bidAmount),
        checkIn, checkOut, guests: bidRoom.capacity || 2,
      });
      attributeReferral(reqRes?.request?.id);
      const bidRes = await api.placeBid({
        hotelId: hotel.id, roomId: bidRoom.id,
        amount: parseFloat(bidAmount),
        message: bidMsg || undefined,
        requestId: reqRes?.request?.id,
      });
      // v94 — record source for legacy/simple bid flow
      if (bidRes?.bid?.id) {
        recordAttribution({
          bidId: bidRes.bid.id,
          hotelId: hotel.id,
          customerId: user!.id,
          paidTotal: 0,
          flow: "bid",
          attribution: attribution || { source: "direct", capturedAt: Date.now() },
        });

        // v130 — Hybrid AI Autopilot. Tier-based auto-accept on the
        // simple Bid path too. Below-floor amounts have ratio < 1, but
        // schedule-accept just sets auto_accept_at; the bid still flips
        // at the timer. LOWBALL tier returns Infinity → no schedule.
        // Use `apMode` (NOT `mode`) to avoid shadowing the executeNegotiate
        // mode pattern that lives elsewhere in this file.
        try {
          const tier = bidderScore?.tier || "NEW";
          const baseMs = bidderScore?.autoAcceptMs ?? 480_000;
          const apMode = await getAutopilotMode(hotel.id);
          const autoAcceptMs = resolveAutoAcceptMs(tier, baseMs, apMode);
          if (Number.isFinite(autoAcceptMs)) {
            const token = localStorage.getItem("sb_token");
            await fetch(`/api/bids/${bidRes.bid.id}/schedule-accept`, {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
              body: JSON.stringify({ tier, autoAcceptMs, autopilotMode: apMode }),
            });
          }
        } catch {}
      }
      setBidSuccess(true);
      setBidRoom(null);
      fetchMyBids();
    } catch (e: any) {
      if (e?.message === "__CANCELLED__") return;
      alert(e?.message || "Couldn't place your bid. Please try again.");
    }
    finally { setBidLoading(false); }
  };

  const openBookNow = (r: any) => {
    if (!globalCheckIn || !globalCheckOut) {
      setPickerModal({ intent: "book", room: r });
      return;
    }
    setBnRoom(r);
    setBnAdults(globalAdults);
    setBnChildren(globalChildren);
    setBnIn(globalCheckIn);
    setBnOut(globalCheckOut);
    setBnSuccess(false);
  };
  const openNegotiate = (r: any) => {
    if (!globalCheckIn || !globalCheckOut) {
      setPickerModal({ intent: "negotiate", room: r });
      return;
    }
    setNegRoom(r);
    // v129 — initial bid lands at 88% of floor, snapped to a ₹100 multiple.
    setNegAmt(snap100(r.floorPrice * 0.88));
    setNegIn(globalCheckIn);
    setNegOut(globalCheckOut);
    setNegSuccess(false);
    // v143 — Fire the negotiate modal tour ~500ms after open so the
    // SVG ring + slider have rendered. Skip-logic in triggerTour
    // handles disabled / seen / already-active states gracefully.
    triggerTour("negotiate", { delayMs: 500 });
  };

  // Continue button in the floating picker modal explicitly resumes the user's intent.
  // (We intentionally do NOT auto-fire on date change — the customer needs a moment to
  // adjust adults/children/kids after picking dates before the booking modal takes over.)
  // Live availability check for flash deal extensions (runs whenever qty/nights change)
  useEffect(() => {
    if (!flashBookOpen || !fbRoomId || !hotel?.id || !flashIsUpgrade) { setFlashAvail(null); return; }
    let cancelled = false;
    setFlashAvail((prev) => ({ unitsFree: 0, unitsTotal: 0, feasible: false, loading: true, ...(prev || {}) }));
    const q = new URLSearchParams({ hotelId: hotel.id, roomId: fbRoomId, fromDate: today, toDate: flashCheckOut, qty: String(flashRoomQty) });
    fetch(`/api/flash-deals/upgrade?${q.toString()}`)
      .then((r) => r.json())
      .then((j) => { if (!cancelled) setFlashAvail({ unitsFree: j.unitsFree || 0, unitsTotal: j.unitsTotal || 0, feasible: !!j.feasible, loading: false }); })
      .catch((e) => { if (!cancelled) setFlashAvail({ unitsFree: 0, unitsTotal: 0, feasible: false, loading: false, error: e?.message }); });
    return () => { cancelled = true; };
  }, [flashBookOpen, fbRoomId, hotel?.id, flashRoomQty, flashCheckOut, today, flashIsUpgrade]);

  const resumePickerIntent = () => {
    if (!pickerModal) return;
    if (!globalCheckIn || !globalCheckOut) return;
    const { intent, room } = pickerModal;
    setPickerModal(null);
    setTimeout(() => {
      if (intent === "book") openBookNow(room);
      else openNegotiate(room);
    }, 140);
  };

  // Book Now — opens BookingReview first; actual Razorpay charge happens
  // in executeBookNow(mode) once user picks Pay-Full / Hold / Pay-At-Hotel.
  const handleBookNow = () => {
    if (!user) return router.push("/auth");
    if (!bnIn || !bnOut || !bnRoom) return alert("Select dates");
    const nights  = Math.max(1, Math.ceil((new Date(bnOut).getTime()-new Date(bnIn).getTime())/86400000));
    const extra   = Math.max(0, bnAdults-(bnRoom.capacity||2));
    const baseTot = bnRoom.floorPrice*nights;
    const extraT  = extra*500*nights;
    const childT  = bnChildren*200*nights;
    const total   = baseTot + extraT + childT;
    const rateLines = [
      { label: `₹${bnRoom.floorPrice.toLocaleString()} × ${nights} night${nights>1?"s":""}`, value: `₹${baseTot.toLocaleString()}` },
      ...(extra>0      ? [{ label: `${extra} extra adult${extra>1?"s":""} × ₹500 × ${nights}n`,    value: `₹${extraT.toLocaleString()}` }] : []),
      ...(bnChildren>0 ? [{ label: `${bnChildren} child${bnChildren>1?"ren":""} × ₹200 × ${nights}n`, value: `₹${childT.toLocaleString()}` }] : []),
      ...(globalKids>0 ? [{ label: `${globalKids} kid${globalKids>1?"s":""} (under 5)`, value: "FREE", subtle: true }] : []),
    ];
    setReview({
      hotelName: hotel.name,
      hotelCity: hotel.city,
      roomType: bnRoom.name || bnRoom.type,
      checkIn: bnIn, checkOut: bnOut, nights,
      adults: bnAdults, children: bnChildren, kids: globalKids,
      rateLines, totalAmount: total,
      flowLabel: "Book Now",
      onUpdate: () => { setReview(null); },   // keeps Book Now modal open underneath
      onPayFull: (final, applied) => executeBookNow("full", 0, { nights, total }, final, applied),
      onHold:    (h, final, applied) => executeBookNow("hold", h, { nights, total }, final, applied),
      onPayAtHotel: (h, final, applied) => executeBookNow("payhotel", h, { nights, total }, final, applied),
      holdEnabled: holdConfig?.hold_enabled ?? true,
      payAtHotelEnabled: holdConfig?.pay_at_hotel_enabled ?? true,
      holdTiers: holdConfig?.tier_overrides || undefined,
    });
  };

  const executeBookNow = async (
    mode: "full" | "hold" | "payhotel",
    holdAmount: number,
    ctx: { nights: number; total: number },
    finalAmount?: number,
    applied: AppliedRedemption = {},
  ) => {
    setBnLoading(true);
    try {
      const { nights, total } = ctx;
      const effectiveTotal = finalAmount ?? total;
      const charge = mode === "full" ? effectiveTotal : holdAmount;
      // v124 — skip Razorpay if redemption fully covered the booking
      let payResult: any = { razorpay_payment_id: "wallet_only" };
      if (charge > 0) payResult = await openRazorpayCheckout({
        amount: charge,
        hotelName: hotel.name,
        description: mode === "full"
          ? `Book Now — ${bnRoom.name || bnRoom.type} — ${nights} night${nights > 1 ? "s" : ""}`
          : `Hold ${nights}n at ${hotel.name} · Lock ₹${total.toLocaleString()}`,
        userName: user!.name || user!.phone || "",
        userPhone: user!.phone,
        userEmail: user!.email,
      });

      // Step 2: Confirm booking in backend
      const reqRes = await api.createBidRequest?.({ hotelId: hotel.id, roomId: bnRoom.id, amount: bnRoom.floorPrice, checkIn: bnIn, checkOut: bnOut, guests: bnAdults+bnChildren });
      attributeReferral(reqRes?.request?.id);
      const bidRes = await api.placeBid({ hotelId: hotel.id, roomId: bnRoom.id, amount: bnRoom.floorPrice, requestId: reqRes?.request?.id });
      try { await api.acceptBid(bidRes.bid.id); } catch {}
      // v124 — apply redemption to bid
      if (applied?.couponCode || applied?.walletCreditAppliedInr) {
        try {
          await api.applyRedemption({
            bidId: bidRes.bid.id,
            couponCode: applied.couponCode,
            walletCreditInr: applied.walletCreditAppliedInr,
          });
        } catch {}
      }
      localStorage.setItem(`bid_dates_${bidRes.bid.id}`, JSON.stringify({ checkIn: bnIn, checkOut: bnOut }));

      // Hold state — recorded only when not paying full upfront
      if (mode !== "full") {
        saveHoldState({
          bidId: bidRes.bid.id,
          hotelId: hotel.id, hotelName: hotel.name, roomType: bnRoom.name || bnRoom.type,
          holdAmount, balanceDue: total - holdAmount, totalAmount: total,
          holdPaymentId: payResult.razorpay_payment_id,
          expiresAt: holdExpiresAt().toISOString(), createdAt: new Date().toISOString(),
          status: "active", flow: "book-now",
          checkIn: bnIn, checkOut: bnOut,
          payAtHotel: mode === "payhotel",
        });
      }

      // BULLETPROOF paid-amount record (Book Now)
      try {
        await fetch("/api/bid/paid", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            bidId: bidRes.bid.id, hotelId: hotel.id, roomId: bnRoom.id,
            customerId: user!.id,
            paidTotal: charge, paidPerNight: charge / nights, nights,
            flow: mode === "full" ? "book-now" : `book-now-${mode}`,
            razorpayPaymentId: payResult.razorpay_payment_id,
          }),
        });
      } catch {}

      // v94 — record booking-source attribution
      recordAttribution({
        bidId: bidRes.bid.id,
        hotelId: hotel.id,
        customerId: user!.id,
        paidTotal: charge,
        flow: mode === "full" ? "book-now" : `book-now-${mode}`,
        attribution: attribution || { source: "direct", capturedAt: Date.now() },
      });

      // Step 3: Send confirmation email (full-pay only — hold flows email at balance settle)
      if (mode === "full") {
        await sendBookingEmail({
          bookingId: bidRes.bid.id,
          hotelName: hotel.name,
          roomType: bnRoom.name || bnRoom.type,
          checkIn: bnIn, checkOut: bnOut,
          guests: bnAdults + bnChildren, nights,
          amount: total,
          paymentId: payResult.razorpay_payment_id,
          city: hotel.city,
        });
      }
      setReview(null);
      setBnSuccess(true);
    } catch(e:any) {
      if (e.message === "__CANCELLED__") { return; }
      if (jwtRedirect(e.message) || isFirebaseToken()) {
        setBnRoom(null); setReview(null);
        openVerifyAndRetry(() => openBookNow(bnRoom));
      } else { alert(e.message || "Booking failed. Please try again."); }
    }
    finally { setBnLoading(false); }
  };

  const handleNegotiate = async () => {
    if (!user) return router.push("/auth");
    if (!negIn || !negOut) return alert("Select dates");
    const isAboveFloor = negAmt >= negRoom.floorPrice;
    const nights = Math.max(1, Math.ceil((new Date(negOut).getTime()-new Date(negIn).getTime())/86400000));
    const total = negAmt * nights;

    // Above-floor (instant-confirm) bids route through BookingReview so the
    // customer can choose Pay-Full / Hold / Pay-At-Hotel before charging.
    if (isAboveFloor) {
      const rateLines = [
        { label: `₹${negAmt.toLocaleString()} × ${nights} night${nights>1?"s":""}`, value: `₹${total.toLocaleString()}` },
        { label: "⚡ Instant confirm bid", value: "Hotel confirms", subtle: true },
      ];
      setReview({
        hotelName: hotel.name,
        hotelCity: hotel.city,
        roomType: negRoom.name || negRoom.type,
        checkIn: negIn, checkOut: negOut, nights,
        adults: globalAdults, children: globalChildren, kids: globalKids,
        rateLines, totalAmount: total,
        flowLabel: "⚡ Instant Bid",
        onUpdate: () => setReview(null),
        onPayFull: (final, applied) => executeNegotiate("full", 0, { nights, total }, final, applied),
        onHold:    (h, final, applied) => executeNegotiate("hold", h, { nights, total }, final, applied),
        onPayAtHotel: (h, final, applied) => executeNegotiate("payhotel", h, { nights, total }, final, applied),
        holdEnabled: holdConfig?.hold_enabled ?? true,
        payAtHotelEnabled: holdConfig?.pay_at_hotel_enabled ?? true,
        holdTiers: holdConfig?.tier_overrides || undefined,
      });
      return;
    }

    // Below-floor: no payment yet, bid is forwarded to hotel for counter/accept.
    setNegLoading(true);
    try {
      const submitAmt = negRoom.floorPrice;
      const message = `Guest's preferred price: ₹${negAmt}/night. Please counter if possible.`;
      const reqRes = await api.createBidRequest?.({ hotelId: hotel.id, roomId: negRoom.id, amount: submitAmt, checkIn: negIn, checkOut: negOut, guests: globalTotalGuests || negRoom.capacity || 2 });
      attributeReferral(reqRes?.request?.id);
      const bidRes = await api.placeBid({ hotelId: hotel.id, roomId: negRoom.id, amount: submitAmt, message, requestId: reqRes?.request?.id });
      localStorage.setItem(`bid_dates_${bidRes.bid.id}`, JSON.stringify({ checkIn: negIn, checkOut: negOut }));

      // Record customer intent (no payment for below-floor)
      try {
        await fetch("/api/bid/paid", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            bidId: bidRes.bid.id, hotelId: hotel.id, roomId: negRoom.id,
            customerId: user.id,
            paidTotal: total, paidPerNight: negAmt, nights,
            flow: "negotiate-below-floor",
          }),
        });
      } catch {}
      // v94 — below-floor bid (no payment yet, but the source channel is
      // captured anyway so the partner panel still sees where this lead
      // came from).
      recordAttribution({
        bidId: bidRes.bid.id,
        hotelId: hotel.id,
        customerId: user.id,
        paidTotal: 0,
        flow: "negotiate-below-floor",
        attribution: attribution || { source: "direct", capturedAt: Date.now() },
      });
      setNegAuto(false);
      setNegSuccess(true);
      fetchMyBids();
    } catch(e:any) {
      if (e.message === "__CANCELLED__") { return; }
      if (jwtRedirect(e.message) || isFirebaseToken()) {
        setNegRoom(null);
        openVerifyAndRetry(() => openNegotiate(negRoom));
      } else { alert(e.message || "Bid failed. Please try again."); }
    }
    finally { setNegLoading(false); }
  };

  const executeNegotiate = async (
    mode: "full" | "hold" | "payhotel",
    holdAmount: number,
    ctx: { nights: number; total: number },
    finalAmount?: number,
    applied: AppliedRedemption = {},
  ) => {
    setNegLoading(true);
    try {
      const { nights, total } = ctx;
      const effectiveTotal = finalAmount ?? total;
      const charge = mode === "full" ? effectiveTotal : holdAmount;
      // v124 — skip Razorpay if redemption fully covered the booking
      let payResult: any = { razorpay_payment_id: "wallet_only" };
      if (charge > 0) payResult = await openRazorpayCheckout({
        amount: charge,
        hotelName: hotel.name,
        description: mode === "full"
          ? `Bid — ${negRoom.name || negRoom.type} — ${nights} night${nights > 1 ? "s" : ""}`
          : `🔒 Hold bid · Lock ₹${total.toLocaleString()} for 24h`,
        userName: user!.name || user!.phone || "",
        userPhone: user!.phone,
        userEmail: user!.email,
      });
      const paymentId = payResult.razorpay_payment_id;
      const message = `Paid via Razorpay: ${paymentId} | paid:${charge} | rate:${negAmt}${mode !== "full" ? ` | hold:${charge} | total:${total}${mode === "payhotel" ? " | pay-at-hotel" : ""}` : ""}`;
      const reqRes = await api.createBidRequest?.({ hotelId: hotel.id, roomId: negRoom.id, amount: negAmt, checkIn: negIn, checkOut: negOut, guests: globalTotalGuests || negRoom.capacity || 2 });
      attributeReferral(reqRes?.request?.id);
      const bidRes = await api.placeBid({ hotelId: hotel.id, roomId: negRoom.id, amount: negAmt, message, requestId: reqRes?.request?.id });
      // v124 — apply redemption to bid
      if (applied?.couponCode || applied?.walletCreditAppliedInr) {
        try {
          await api.applyRedemption({
            bidId: bidRes.bid.id,
            couponCode: applied.couponCode,
            walletCreditInr: applied.walletCreditAppliedInr,
          });
        } catch {}
      }
      localStorage.setItem(`bid_dates_${bidRes.bid.id}`, JSON.stringify({ checkIn: negIn, checkOut: negOut }));

      if (mode !== "full") {
        saveHoldState({
          bidId: bidRes.bid.id,
          hotelId: hotel.id, hotelName: hotel.name, roomType: negRoom.name || negRoom.type,
          holdAmount, balanceDue: total - holdAmount, totalAmount: total,
          holdPaymentId: paymentId,
          expiresAt: holdExpiresAt().toISOString(), createdAt: new Date().toISOString(),
          status: "active", flow: "negotiate",
          checkIn: negIn, checkOut: negOut,
          payAtHotel: mode === "payhotel",
        });
      }

      try {
        await fetch("/api/bid/paid", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            bidId: bidRes.bid.id, hotelId: hotel.id, roomId: negRoom.id,
            customerId: user!.id,
            paidTotal: charge, paidPerNight: negAmt, nights,
            flow: mode === "full" ? "negotiate" : `negotiate-${mode}`,
            razorpayPaymentId: paymentId,
          }),
        });
      } catch {}

      // v94 — record booking-source attribution
      recordAttribution({
        bidId: bidRes.bid.id,
        hotelId: hotel.id,
        customerId: user!.id,
        paidTotal: charge,
        flow: mode === "full" ? "negotiate" : `negotiate-${mode}`,
        attribution: attribution || { source: "direct", capturedAt: Date.now() },
      });

      // v70 + v130 — tier-based auto-accept on EVERY above-floor unpaid bid,
      // adjusted by the hotel's Autopilot mode. lib/bidder-score.ts maps
      // tier -> autoAcceptMs (PREMIUM 30s … LOWBALL Infinity). lib/autopilot
      // then clamps based on mode (auto/hybrid/manual) — Infinity = manual.
      // NOTE: local var is `apMode` (NOT `mode`) — the outer executeNegotiate
      // already has a `mode: "full"|"hold"|"payhotel"` parameter that the
      // rest of this function compares against. Shadowing breaks every
      // mode === "full" check elsewhere in the closure.
      const tier = bidderScore?.tier || "NEW";
      const baseMs = bidderScore?.autoAcceptMs ?? 480_000; // default NORMAL ~8 min
      const apMode = await getAutopilotMode(hotel.id);
      const autoAcceptMs = resolveAutoAcceptMs(tier, baseMs, apMode);
      try {
        const token = localStorage.getItem("sb_token");
        await fetch(`/api/bids/${bidRes.bid.id}/schedule-accept`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ tier, autoAcceptMs, autopilotMode: apMode }),
        });
      } catch {}
      // UI: only show the "instant" success copy when the mode + tier
      // actually produce a sub-minute confirm. Anything else lands as
      // "Bid Submitted — the hotel will confirm in ~X".
      const isPremiumInstant = tier === "PREMIUM" && Number.isFinite(autoAcceptMs) && autoAcceptMs <= 60_000;
      setNegAuto(isPremiumInstant);

      // Confirmation email only fires after actual acceptance (cron/trigger).
      // For now we skip email at submission — the trigger-accept endpoint or
      // cron picks it up. If we already auto-accepted instantly (PREMIUM <30s),
      // the email-on-trigger can be added in Phase 7.
      setReview(null);
      setNegSuccess(true);
      fetchMyBids();
    } catch(e:any) {
      if (e.message === "__CANCELLED__") { return; }
      if (jwtRedirect(e.message) || isFirebaseToken()) {
        setNegRoom(null); setReview(null);
        openVerifyAndRetry(() => openNegotiate(negRoom));
      } else { alert(e.message || "Bid failed. Please try again."); }
    }
    finally { setNegLoading(false); }
  };

  const handleCounterAccept = async (bid: any) => {
    const bidId = bid.id;
    const counterAmt = bid.counterAmount || bid.amount;
    // Open BookingReview so customer can pick Pay-Full / Hold / Pay-At-Hotel
    const stored = JSON.parse(localStorage.getItem(`bid_dates_${bidId}`) || "null");
    const nights = stored?.checkIn && stored?.checkOut
      ? Math.max(1, Math.ceil((new Date(stored.checkOut).getTime()-new Date(stored.checkIn).getTime())/86400000))
      : 1;
    const total = counterAmt * nights;
    const rateLines = [
      { label: `₹${counterAmt.toLocaleString()} × ${nights} night${nights>1?"s":""}`, value: `₹${total.toLocaleString()}` },
      { label: "Hotel countered at this rate", value: "Accepted", subtle: true },
    ];
    setReview({
      hotelName: hotel.name,
      hotelCity: hotel.city,
      roomType: bid.room?.type || "Room",
      checkIn: stored?.checkIn || today,
      checkOut: stored?.checkOut || tomorrow,
      nights,
      adults: bid.request?.guests || 2,
      rateLines, totalAmount: total,
      flowLabel: "🤝 Accept Counter",
      onUpdate: () => setReview(null),
      onPayFull: (final, applied) => executeCounterAccept(bid, "full", 0, { nights, total }, final, applied),
      onHold:    (h, final, applied) => executeCounterAccept(bid, "hold", h, { nights, total }, final, applied),
      onPayAtHotel: (h, final, applied) => executeCounterAccept(bid, "payhotel", h, { nights, total }, final, applied),
      holdEnabled: holdConfig?.hold_enabled ?? true,
      payAtHotelEnabled: holdConfig?.pay_at_hotel_enabled ?? true,
      holdTiers: holdConfig?.tier_overrides || undefined,
    });
  };

  const executeCounterAccept = async (
    bid: any,
    mode: "full" | "hold" | "payhotel",
    holdAmount: number,
    ctx: { nights: number; total: number },
    finalAmount?: number,
    applied: AppliedRedemption = {},
  ) => {
    const bidId = bid.id;
    const counterAmt = bid.counterAmount || bid.amount;
    setActionLoading(bidId);
    try {
      const { nights, total } = ctx;
      const effectiveTotal = finalAmount ?? total;
      const charge = mode === "full" ? effectiveTotal : holdAmount;
      const stored = JSON.parse(localStorage.getItem(`bid_dates_${bidId}`) || "null");

      // v124 — skip Razorpay if redemption fully covered the booking
      let payResult: any = { razorpay_payment_id: "wallet_only" };
      if (charge > 0) payResult = await openRazorpayCheckout({
        amount: charge,
        hotelName: hotel.name,
        description: mode === "full"
          ? `Counter Offer Accept — ${bid.room?.type || "Room"} — ${nights} night${nights > 1 ? "s" : ""}`
          : `🔒 Hold counter offer · Lock ₹${total.toLocaleString()} for 24h`,
        userName: user?.name || user?.phone || "",
        userPhone: user?.phone,
        userEmail: user?.email,
      });

      const token = localStorage.getItem("sb_token");
      const res = await fetch(`${API}/api/bids/${bidId}/counter-accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      if (mode !== "full") {
        saveHoldState({
          bidId,
          hotelId: hotel.id, hotelName: hotel.name, roomType: bid.room?.type,
          holdAmount, balanceDue: total - holdAmount, totalAmount: total,
          holdPaymentId: payResult.razorpay_payment_id,
          expiresAt: holdExpiresAt().toISOString(), createdAt: new Date().toISOString(),
          status: "active", flow: "counter-accept",
          checkIn: stored?.checkIn, checkOut: stored?.checkOut,
          payAtHotel: mode === "payhotel",
        });
      }

      // v124 — apply redemption to bid (counter-accept path)
      if (applied?.couponCode || applied?.walletCreditAppliedInr) {
        try {
          await api.applyRedemption({
            bidId,
            couponCode: applied.couponCode,
            walletCreditInr: applied.walletCreditAppliedInr,
          });
        } catch {}
      }

      try {
        await fetch("/api/bid/paid", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            bidId, hotelId: hotel.id, roomId: bid.roomId || bid.room?.id,
            customerId: user?.id,
            paidTotal: charge, paidPerNight: counterAmt, nights,
            flow: mode === "full" ? "counter-accept" : `counter-accept-${mode}`,
            razorpayPaymentId: payResult.razorpay_payment_id,
          }),
        });
      } catch {}

      if (mode === "full") {
        await sendBookingEmail({
          bookingId: bidId,
          hotelName: hotel.name,
          roomType: bid.room?.type || "Room",
          checkIn: stored?.checkIn || "",
          checkOut: stored?.checkOut || "",
          guests: bid.request?.guests || 2,
          nights, amount: total,
          paymentId: payResult.razorpay_payment_id,
          city: hotel.city,
        });
      }
      setReview(null);
      alert(mode === "full" ? "Booking confirmed! 🎉" : `🔒 Price locked for 24h! Balance ₹${(total-holdAmount).toLocaleString()} due ${mode==="payhotel"?"at hotel":"online"}.`);
      fetchMyBids();
    } catch (e: any) {
      if (e?.message === "__CANCELLED__") { return; }
      if (jwtRedirect(e?.message) || isFirebaseToken()) {
        setReview(null);
        openVerifyAndRetry(() => handleCounterAccept(bid));
        return;
      }
      alert(e?.message || "Couldn't confirm the counter offer. Please try again.");
    }
    finally { setActionLoading(""); }
  };

  const handleCounterReject = async (bidId: string) => {
    setActionLoading(bidId);
    try {
      const token = localStorage.getItem("sb_token");
      const res = await fetch(`${API}/api/bids/${bidId}/counter-reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      fetchMyBids();
    } catch (e: any) {
      alert(e?.message || "Couldn't reject the counter offer. Please try again.");
    }
    finally { setActionLoading(""); }
  };

  const statusStyle = (s: string) => {
    switch (s) {
      case "PENDING":  return { bg: "bg-amber-50",   text: "text-amber-700",   border: "border-amber-200",   label: "Pending"  };
      case "COUNTER":  return { bg: "bg-orange-50",  text: "text-orange-700",  border: "border-orange-200",  label: "Counter"  };
      case "ACCEPTED": return { bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200", label: "Accepted" };
      case "REJECTED": return { bg: "bg-red-50",     text: "text-red-600",     border: "border-red-200",     label: "Rejected" };
      default:         return { bg: "bg-luxury-50",  text: "text-luxury-600",  border: "border-luxury-100",  label: s };
    }
  };

  // v133 — Deterministic "live activity" stats for the hero ticker pill.
  // Same hotel always shows same numbers (stable per page open + per session);
  // different hotels show different values. Anchored to hotel.id so it never
  // shifts during a session. NOT a real-time counter — the actual
  // viewers-now / bookings-today numbers would require server tracking that
  // isn't wired today. This is the "premium luxury ticker" affordance that
  // makes the page feel inhabited without faking data points the backend
  // can't validate.
  const liveStats = useMemo(() => {
    const idStr = String(hotel?.id || "");
    const seed = idStr.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
    return {
      viewing: (seed % 18) + 4,        // 4..21 looking
      bookedToday: ((seed * 7) % 7) + 1, // 1..7 booked today
    };
  }, [hotel?.id]);

  if (loading) return (
    <div className="max-w-4xl mx-auto px-5 py-10 space-y-5">
      <div className="h-72 shimmer rounded-3xl" />
      <div className="h-8 w-2/3 shimmer rounded-full" />
      <div className="h-4 w-1/3 shimmer rounded-full" />
    </div>
  );

  if (!hotel) return (
    <div className="text-center py-28 text-luxury-400">
      <div className="w-16 h-16 rounded-full bg-luxury-100 flex items-center justify-center mx-auto mb-4">
        <span className="text-2xl">🏨</span>
      </div>
      <p className="text-lg font-semibold text-luxury-700 mb-1">Hotel not found</p>
      <Link href="/hotels" className="text-sm text-gold-500 hover:text-gold-600 transition-colors">← Back to hotels</Link>
    </div>
  );

  // ── v123 — UI helpers for the redesigned page ──
  const lowestRoomPrice = hotel?.rooms?.length
    ? Math.min(...hotel.rooms.map((r: any) => r.floorPrice || 99999))
    : 0;
  const lowestForRibbon = lowestRoomPrice < 99999 ? lowestRoomPrice : 0;
  const roomsAvail = hotel?.rooms?.length || 0;
  const otaSavingsBest = lowestForRibbon > 0
    ? Math.round((1 - lowestForRibbon / (lowestForRibbon * 1.22)) * 100)
    : 0;

  return (
    <div className="hx-shell">
      <div className="max-w-7xl mx-auto px-4 sm:px-5 lg:px-7 py-5 sm:py-7 lg:py-9">

        {/* ── Toolbar — Back chip + crumb ── */}
        <div className="hx-toolbar">
          <button
            type="button"
            onClick={() => router.back()}
            className="hx-toolbar-back"
            aria-label="Go back"
          >
            ‹
          </button>
          <span className="hx-toolbar-crumb">
            {hotel.city ? `Stays in ${hotel.city}` : "Stays"} <span style={{ margin: "0 4px" }}>·</span> {hotel.name}
          </span>
        </div>

        {/* ── Flash Deal Banner (sticky so it follows the customer while
            they browse) — premium glass-on-cream redesign ── */}
        {dealId && dealPrice && (
          <div
            className="hx-reveal"
            style={{
              position: "sticky", top: "12px", zIndex: 30,
              marginBottom: "20px",
              padding: "14px 18px",
              borderRadius: "20px",
              background: "linear-gradient(135deg, rgba(217, 190, 130, 0.20), rgba(212, 149, 131, 0.14))",
              backdropFilter: "blur(14px)",
              border: "1px solid rgba(201, 166, 107, 0.45)",
              boxShadow: "0 18px 40px -16px rgba(201, 166, 107, 0.42)",
              display: "flex", flexDirection: "row", alignItems: "center",
              flexWrap: "wrap", justifyContent: "space-between", gap: "12px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "11px" }}>
              <span style={{
                width: "10px", height: "10px", borderRadius: "50%",
                background: "var(--cozy-rose)",
                boxShadow: "0 0 0 4px rgba(212, 149, 131, 0.25)",
                animation: "hx-pulse-soft 1.4s ease-in-out infinite",
                flexShrink: 0,
              }} />
              <div>
                <p style={{
                  fontSize: "0.6rem", fontWeight: 800, color: "var(--cozy-rose)",
                  textTransform: "uppercase", letterSpacing: "0.16em", margin: 0,
                }}>⚡ Flash Deal Active</p>
                <p style={{ fontSize: "0.85rem", color: "var(--text-soft)", margin: "2px 0 0" }}>
                  {flashRoom?.name || "Room"} at{" "}
                  <span style={{ fontWeight: 800, color: "var(--cozy-warm-dark)", fontSize: "1.05rem" }}>₹{dealPrice}</span>
                  <span style={{ color: "var(--text-muted)" }}>/night</span>
                  {dealDiscount && (
                    <span style={{
                      marginLeft: "8px",
                      padding: "2px 9px",
                      background: "linear-gradient(135deg, var(--cozy-champagne-light), var(--cozy-champagne))",
                      color: "#2b1d05",
                      fontSize: "0.65rem",
                      fontWeight: 800,
                      borderRadius: "999px",
                    }}>{dealDiscount}% OFF</span>
                  )}
                </p>
              </div>
            </div>
            <button
              onClick={() => withBackendAuth(() => {
                // v159.16 — banner always books the HEADLINE deal room.
                setFlashSel(null);
                setFlashBookOpen(true);
              })}
              className="hx-cta hx-cta-primary"
              style={{ flex: "0 0 auto", padding: "11px 22px" }}
            >
              Book This Flash Deal
            </button>
          </div>
        )}

        {/* ── v123 EDITORIAL HERO ── */}
        <HotelHero
          name={hotel.name}
          city={hotel.city}
          state={hotel.state}
          starRating={hotel.starRating}
          avgRating={hotel.avgRating}
          totalReviews={hotel.totalReviews}
          trustBadge={!!hotel.trustBadge}
          images={hotel.images}
          onOpenGallery={(i) => { setGalleryIdx(i); setGalleryOpen(true); }}
        />

        {/* ── v133 — Live activity ticker pill ── */}
        <div className="hx-live-pill-row hx-reveal">
          <span className="hx-live-ticker" title="Live activity right now">
            <span className="hx-live-ticker-dot" aria-hidden="true" />
            <span>
              <span className="hx-live-ticker-em">{liveStats.viewing}</span>
              {" "}looking now
            </span>
            <span className="hx-live-ticker-sep" aria-hidden="true" />
            <span>
              <span className="hx-live-ticker-em">{liveStats.bookedToday}</span>
              {" "}booked today
            </span>
          </span>
        </div>

        {/* ── v123 ANIMATED STATS RIBBON ── */}
        <HotelStatsRibbon
          avgRating={hotel.avgRating}
          totalReviews={hotel.totalReviews}
          starRating={hotel.starRating}
          roomsAvailable={roomsAvail}
          totalRooms={roomsAvail}
          lowestPrice={lowestForRibbon}
          otaSavingsPct={otaSavingsBest}
          trustBadge={!!hotel.trustBadge}
          flashDealActive={!!(dealId && dealPrice)}
        />

        {/* ── v128.1 PERFORMANCE SCORECARD — 3D award medal w/ rank ribbon.
            v159.9 — Tightened from marginTop:14 → 8 + gap 16 → 12 +
            sub-text leading shrunk so the block hugs the stats ribbon
            above + the description below. Halves the air around it. */}
        <div
          className="hx-reveal"
          style={{
            marginTop: 8,
            display: "flex",
            justifyContent: "flex-start",
            flexWrap: "wrap",
            gap: 12,
            alignItems: "center",
          }}
        >
          <HotelScoreBadge
            hotelId={String(id)}
            hotelName={hotel?.name}
            variant="hero"
          />
          <div
            style={{
              flex: "1 1 200px",
              minWidth: 0,
              color: "var(--text-soft, #4a3820)",
              fontSize: "0.74rem",
              lineHeight: 1.35,
            }}
          >
            <div
              style={{
                fontFamily: "var(--font-display, 'Cormorant Garamond'), serif",
                fontStyle: "italic",
                fontSize: "0.96rem",
                color: "var(--text-base, #1f1a0f)",
                fontWeight: 600,
              }}
            >
              StayBid Performance Scorecard
            </div>
            <div style={{ marginTop: 2 }}>
              Live score · 10 checkpoints · city rank. Tap medal for breakdown.
            </div>
          </div>
        </div>

        {/* ── Two-column page grid (sticky rail on desktop ≥1100px). v159.9
            — marginTop 22 → 10 so the About section follows the medal
            block tightly instead of leaving a chunk of dead space. */}
        <div className="hx-page-grid" style={{ marginTop: "10px" }}>
          <div>

        {/* ── Description — v159.9 tight section rhythm. */}
        {hotel.description && (
          <div className="hx-reveal" style={{ marginTop: "2px" }}>
            <div className="hx-section-h">
              <span className="hx-section-h-label">About</span>
              <span className="hx-section-h-rule" />
            </div>
            <p style={{
              color: "var(--text-soft)",
              fontSize: "0.96rem",
              lineHeight: 1.68,
              margin: 0,
              maxWidth: "720px",
            }}>
              {hotel.description}
            </p>
          </div>
        )}

        {/* ── Amenities ── */}
        {hotel.amenities?.length > 0 && (
          <div className="hx-reveal">
            <div className="hx-section-h">
              <span className="hx-section-h-label">Amenities</span>
              <span className="hx-section-h-rule" />
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
              {hotel.amenities.map((a: string) => (
                <span key={a} className="hx-amenity-chip" style={{ fontSize: "0.78rem", padding: "7px 14px" }}>{a}</span>
              ))}
            </div>
          </div>
        )}

        {/* ── Premium Tabs (v128.3 — +Guest Feedback) ── */}
        <div className="hx-tabs hx-reveal">
          {(["rooms","reviews","feedback","about"] as const).map(t => {
            // "reviews" + "feedback" navigate to dedicated full pages so
            // customers get the deep premium experience. The other two
            // tabs stay inline on the detail page.
            const isPageLink = t === "reviews" || t === "feedback";
            const label =
              t === "rooms"
                ? "Rooms & Pricing"
                : t === "reviews"
                  ? `Guest Reviews${hotel.totalReviews ? ` (${hotel.totalReviews})` : ""}`
                  : t === "feedback"
                    ? "Guest Feedback"
                    : "About this stay";
            return (
              <button
                key={t}
                type="button"
                onClick={() => {
                  if (isPageLink) {
                    const here = typeof window !== "undefined" ? window.location.pathname : `/hotels/${id}`;
                    const path = t === "reviews" ? "reviews" : "feedback";
                    const qs = new URLSearchParams({
                      return: here,
                      hotel: hotel?.name || "",
                    });
                    router.push(`/hotels/${encodeURIComponent(String(id))}/${path}?${qs.toString()}`);
                  } else {
                    setTab(t);
                  }
                }}
                className={`hx-tab ${tab === t && !isPageLink ? "is-active" : ""}`}
              >
                {label}
                {isPageLink ? <span aria-hidden style={{ marginLeft: 6, opacity: 0.55 }}>↗</span> : null}
              </button>
            );
          })}
        </div>

        {/* ── REVIEWS TAB ── */}
        {tab === "reviews" && (
          <div className="mb-10">
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-semibold text-luxury-900 text-base tracking-tight">Guest Reviews</h2>
              {hotel.avgRating > 0 && (
                <span className="px-3 py-1 bg-gold-100 text-gold-600 text-sm font-semibold rounded-full border border-gold-200">
                  {hotel.avgRating.toFixed(1)} / 5
                </span>
              )}
            </div>

            {/* v127.1 — Aggregated post-checkout smiley feedback. Only the
                 smiley initials persist long-term per data-lifecycle rule. */}
            <HotelFeedbackSummary hotelId={hotel.id} />
            <div className="space-y-4">
              {(hotel.reviews?.length > 0 ? hotel.reviews : sampleReviews).map((r: any) => {
                const stars = Math.min(5, Math.max(1, r.rating || 5));
                return (
                  <div key={r.id} className="card-luxury p-5">
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <p className="font-semibold text-luxury-900">{r.guestName || ("Guest " + String(r.id || "").slice(0,4).toUpperCase())}</p>
                        <p className="text-xs text-luxury-400 mt-0.5">
                          {new Date(r.createdAt).toLocaleDateString("en-IN", { day:"numeric", month:"long", year:"numeric" })}
                        </p>
                      </div>
                      <div className="flex gap-0.5">
                        {Array.from({ length: 5 }).map((_, i) => (
                          <span key={i} className={`text-base ${i < stars ? "text-gold-400" : "text-luxury-200"}`}>★</span>
                        ))}
                      </div>
                    </div>
                    <p className="text-luxury-600 text-sm leading-relaxed">"{r.comment}"</p>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── ABOUT TAB ── */}
        {tab === "about" && (
          <div className="mb-10 space-y-5">

            {/* Description */}
            {hotel.description && (
              <div className="card-luxury p-5">
                <p className="text-xs font-bold text-luxury-400 uppercase tracking-widest mb-3">About This Property</p>
                <p className="text-luxury-600 leading-relaxed text-sm">{hotel.description}</p>
              </div>
            )}

            {/* Location — preferred area, exact after booking */}
            <div className="card-luxury p-5">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-bold text-luxury-400 uppercase tracking-widest">📍 Location</p>
                <span className="text-[0.6rem] font-semibold px-2 py-0.5 bg-amber-50 border border-amber-200 text-amber-700 rounded-full">Exact address after booking</span>
              </div>
              <p className="text-luxury-800 font-semibold text-base">{hotel.city}{hotel.state ? `, ${hotel.state}` : ""}</p>
              <p className="text-xs text-luxury-400 mt-1 mb-4">Located in the heart of {hotel.city} — popular area with easy access to local attractions</p>
              <div className="rounded-2xl overflow-hidden bg-luxury-100 h-36 relative mb-3 flex items-center justify-center border border-luxury-200">
                <div className="absolute inset-0 bg-gradient-to-br from-blue-50 to-green-50 opacity-60" />
                <div className="relative text-center">
                  <div className="w-10 h-10 rounded-full bg-red-500 flex items-center justify-center mx-auto mb-2 shadow-lg">
                    <span className="text-white text-lg">📍</span>
                  </div>
                  <p className="text-xs font-semibold text-luxury-700">{hotel.city} Area</p>
                  <p className="text-[0.6rem] text-luxury-400">Exact pin shared post-booking</p>
                </div>
              </div>
              <a
                href={`https://maps.google.com/?q=${encodeURIComponent(hotel.city + (hotel.state ? ", " + hotel.state : ""))}`}
                target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-2 text-sm font-semibold text-white bg-blue-500 hover:bg-blue-600 px-4 py-2 rounded-xl transition-colors"
              >
                🗺 View Area on Maps
              </a>
            </div>

            {/* Check-in / Check-out Policy */}
            <div className="card-luxury p-5">
              <p className="text-xs font-bold text-luxury-400 uppercase tracking-widest mb-4">🕐 Check-in & Check-out</p>
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-emerald-50 rounded-2xl p-4 text-center border border-emerald-100">
                  <p className="text-2xl font-bold text-emerald-700">12:00</p>
                  <p className="text-xs font-semibold text-emerald-600 mt-1">PM Check-in</p>
                  <p className="text-[0.6rem] text-emerald-500 mt-0.5">Early check-in on request</p>
                </div>
                <div className="bg-blue-50 rounded-2xl p-4 text-center border border-blue-100">
                  <p className="text-2xl font-bold text-blue-700">11:00</p>
                  <p className="text-xs font-semibold text-blue-600 mt-1">AM Check-out</p>
                  <p className="text-[0.6rem] text-blue-500 mt-0.5">Late check-out on request</p>
                </div>
              </div>
            </div>

            {/* Amenities */}
            {hotel.amenities?.length > 0 && (
              <div className="card-luxury p-5">
                <p className="text-xs font-bold text-luxury-400 uppercase tracking-widest mb-4">✨ Amenities & Facilities</p>
                <div className="grid grid-cols-2 gap-2">
                  {hotel.amenities.map((a: string) => (
                    <div key={a} className="flex items-center gap-2 text-sm text-luxury-700">
                      <span className="w-1.5 h-1.5 rounded-full bg-gold-400 shrink-0" />
                      {a}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Hotel Policies */}
            <div className="card-luxury p-5">
              <p className="text-xs font-bold text-luxury-400 uppercase tracking-widest mb-4">📋 Hotel Policies</p>
              <div className="space-y-3">
                {[
                  { icon: "🚭", label: "Smoking", value: "Non-smoking property" },
                  { icon: "🐾", label: "Pets",    value: "Pets not allowed" },
                  { icon: "👫", label: "Couples", value: "Couples welcome" },
                  { icon: "💳", label: "Payment", value: "UPI, Cards, Cash accepted" },
                  { icon: "🪪", label: "ID Proof", value: "Govt. ID mandatory at check-in" },
                ].map(p => (
                  <div key={p.label} className="flex items-center gap-3">
                    <span className="text-lg w-7 shrink-0">{p.icon}</span>
                    <div>
                      <span className="text-xs text-luxury-400 font-semibold">{p.label}: </span>
                      <span className="text-sm text-luxury-700">{p.value}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Cancellation Policy */}
            <div className="card-luxury p-5">
              <p className="text-xs font-bold text-luxury-400 uppercase tracking-widest mb-4">🔄 Cancellation Policy</p>
              <div className="space-y-3">
                <div className="flex items-start gap-3 p-3 bg-emerald-50 rounded-xl border border-emerald-100">
                  <span className="text-emerald-500 font-bold text-sm mt-0.5">✓</span>
                  <div>
                    <p className="text-sm font-semibold text-emerald-800">Free cancellation</p>
                    <p className="text-xs text-emerald-600">Cancel up to 24 hours before check-in for a full refund</p>
                  </div>
                </div>
                <div className="flex items-start gap-3 p-3 bg-amber-50 rounded-xl border border-amber-100">
                  <span className="text-amber-500 font-bold text-sm mt-0.5">!</span>
                  <div>
                    <p className="text-sm font-semibold text-amber-800">Late cancellation</p>
                    <p className="text-xs text-amber-600">Cancellations within 24 hours charged 1 night's stay</p>
                  </div>
                </div>
              </div>
            </div>

            {/* StayBid vs OTA comparison strip */}
            <div className="card-luxury p-5">
              <p className="text-xs font-bold text-luxury-400 uppercase tracking-widest mb-4">🏆 Why Book on StayBid?</p>
              <div className="space-y-3">
                {[
                  { platform: "MakeMyTrip",  pct: "up to 13% higher",  icon: "🔴" },
                  { platform: "Booking.com", pct: "up to 16% higher",  icon: "🔵" },
                  { platform: "Goibibo",     pct: "up to 10% higher",  icon: "🟢" },
                  { platform: "Agoda",       pct: "up to 14% higher",  icon: "🟠" },
                ].map(o => (
                  <div key={o.platform} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span>{o.icon}</span>
                      <span className="text-sm text-luxury-600">{o.platform}</span>
                    </div>
                    <span className="text-xs font-semibold text-red-500 bg-red-50 px-2 py-0.5 rounded-full">{o.pct}</span>
                  </div>
                ))}
                <div className="flex items-center justify-between pt-2 border-t border-luxury-100 mt-2">
                  <div className="flex items-center gap-2">
                    <span>🏆</span>
                    <span className="text-sm font-bold text-gold-600">StayBid</span>
                  </div>
                  <span className="text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">Best Price Guaranteed</span>
                </div>
              </div>
            </div>

          </div>
        )}

        {tab === "rooms" && <>

        {/* ── My Bids ── */}
        {myBids.length > 0 && (
          <div className="mb-10 hx-reveal">
            <div className="hx-section-h">
              <span className="hx-section-h-label">Your offers on this stay</span>
              <span className="hx-section-h-rule" />
            </div>
            <div className="space-y-3">
              {myBids.map((b: any) => {
                const st = statusStyle(b.status);
                return (
                  <div key={b.id} className="card-luxury p-5">
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <p className="font-semibold text-luxury-900">{b.room?.type || "Room"}</p>
                        <p className="text-sm text-luxury-400 mt-0.5">Your bid: <span className="font-semibold text-luxury-700">₹{b.amount}</span></p>
                      </div>
                      <span className={`px-3 py-1 rounded-full text-xs font-bold border ${st.bg} ${st.text} ${st.border}`}>{st.label}</span>
                    </div>
                    {b.status === "COUNTER" && (
                      <div className="mt-4 p-4 bg-orange-50 rounded-2xl border border-orange-200">
                        <p className="text-sm font-medium text-orange-800 mb-3">
                          Hotel countered at <span className="text-xl font-bold text-orange-700">₹{b.counterAmount}</span>
                        </p>
                        <div className="flex gap-2">
                          <button onClick={() => handleCounterAccept(b)} disabled={actionLoading === b.id}
                            className="flex-1 py-2.5 btn-luxury rounded-xl text-sm disabled:opacity-40">
                            {actionLoading === b.id ? "…" : `Accept ₹${b.counterAmount}`}
                          </button>
                          <button onClick={() => handleCounterReject(b.id)} disabled={actionLoading === b.id}
                            className="flex-1 py-2.5 bg-red-50 text-red-600 text-sm font-semibold rounded-xl hover:bg-red-100 transition border border-red-200 disabled:opacity-40">
                            Decline
                          </button>
                        </div>
                      </div>
                    )}
                    {b.status === "ACCEPTED" && (
                      <p className="mt-3 text-sm text-emerald-600 font-medium">✓ Booking confirmed at ₹{b.counterAmount || b.amount}</p>
                    )}
                    {b.status === "REJECTED" && (
                      <p className="mt-3 text-sm text-red-500">Bid was not accepted</p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── v123 Availability Picker — premium glass-on-cream ── */}
        <div id="availability-picker" className="hx-availability hx-reveal" style={{ marginBottom: "24px" }}>
          <div className="hx-availability-head">
            <span className="hx-availability-badge">🔍</span>
            <div>
              <h3 className="hx-availability-title">Check availability &amp; get your best price</h3>
              <p className="hx-availability-sub">
                <span className="hx-availability-sub-dot" />
                AI live engine · real-time rates
              </p>
            </div>
          </div>

          {/* Dates row — opens LuxuryCalendar with per-day live pricing */}
          <div className="grid grid-cols-2 gap-3 mb-3 relative z-[2]">
            <button
              type="button"
              onClick={() => openCalendar({
                mode: "checkIn",
                checkIn: globalCheckIn,
                checkOut: globalCheckOut,
                onApply: ({ checkIn: ci, checkOut: co }) => { setGlobalCheckIn(ci); setGlobalCheckOut(co); },
              })}
              className="picker-tile block text-left"
            >
              <p className="text-[0.6rem] font-bold text-luxury-500 uppercase tracking-widest mb-1">📅 Check-in</p>
              <span className={`block text-sm font-semibold ${globalCheckIn ? "text-luxury-900" : "text-luxury-400"}`}>
                {globalCheckIn
                  ? new Date(globalCheckIn).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })
                  : "Add date"}
              </span>
            </button>
            <button
              type="button"
              onClick={() => openCalendar({
                mode: "checkOut",
                checkIn: globalCheckIn,
                checkOut: globalCheckOut,
                onApply: ({ checkIn: ci, checkOut: co }) => { setGlobalCheckIn(ci); setGlobalCheckOut(co); },
              })}
              className="picker-tile block text-left"
            >
              <p className="text-[0.6rem] font-bold text-luxury-500 uppercase tracking-widest mb-1">📅 Check-out</p>
              <span className={`block text-sm font-semibold ${globalCheckOut ? "text-luxury-900" : "text-luxury-400"}`}>
                {globalCheckOut
                  ? new Date(globalCheckOut).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })
                  : "Add date"}
              </span>
            </button>
          </div>

          {/* Guests row */}
          <div className="grid grid-cols-3 gap-3 mb-4 relative z-[2]">
            <div className="picker-tile">
              <p className="text-[0.58rem] font-bold text-luxury-500 uppercase tracking-widest mb-2">👤 Adults</p>
              <div className="flex items-center justify-between">
                <button type="button" onClick={() => setGlobalAdults(Math.max(1, globalAdults - 1))} className="picker-step">−</button>
                <span className="font-black text-luxury-900 text-lg">{globalAdults}</span>
                <button type="button" onClick={() => setGlobalAdults(Math.min(8, globalAdults + 1))} className="picker-step">+</button>
              </div>
              <p className="text-[0.55rem] text-luxury-400 text-center mt-1">12+ yrs</p>
            </div>
            <div className="picker-tile">
              <p className="text-[0.58rem] font-bold text-luxury-500 uppercase tracking-widest mb-2">👦 Children</p>
              <div className="flex items-center justify-between">
                <button type="button" onClick={() => setGlobalChildren(Math.max(0, globalChildren - 1))} className="picker-step">−</button>
                <span className="font-black text-luxury-900 text-lg">{globalChildren}</span>
                <button type="button" onClick={() => setGlobalChildren(Math.min(6, globalChildren + 1))} className="picker-step">+</button>
              </div>
              <p className="text-[0.55rem] text-amber-600 text-center mt-1 font-semibold">5–12 · +₹200</p>
            </div>
            <div className="picker-tile">
              <p className="text-[0.58rem] font-bold text-luxury-500 uppercase tracking-widest mb-2">🧒 Kids</p>
              <div className="flex items-center justify-between">
                <button type="button" onClick={() => setGlobalKids(Math.max(0, globalKids - 1))} className="picker-step">−</button>
                <span className="font-black text-luxury-900 text-lg">{globalKids}</span>
                <button type="button" onClick={() => setGlobalKids(Math.min(6, globalKids + 1))} className="picker-step">+</button>
              </div>
              <p className="text-[0.55rem] text-emerald-600 text-center mt-1 font-semibold">&lt;5 yrs · FREE</p>
            </div>
          </div>

          {/* Availability warning when dates overlap blocks */}
          {datesSelected && dateRangeBlocked(globalCheckIn, globalCheckOut) && (
            <div className="mb-3 p-3 bg-amber-50 border border-amber-300 rounded-2xl flex items-start gap-2">
              <span className="text-amber-600 text-base">⚠️</span>
              <div className="text-xs text-amber-800">
                <p className="font-bold">Limited availability on these dates</p>
                <p className="text-amber-700 mt-0.5">Some rooms may be booked. Other rooms shown below are still available — scroll down to pick.</p>
              </div>
            </div>
          )}

          {/* Summary strip */}
          {datesSelected ? (
            <div className="flex flex-wrap items-center gap-2 p-3 bg-emerald-50 border border-emerald-200 rounded-2xl">
              <span className="text-emerald-600 text-sm font-bold">✓</span>
              <span className="text-xs font-semibold text-emerald-800">
                {new Date(globalCheckIn).toLocaleDateString("en-IN",{day:"numeric",month:"short"})} →{" "}
                {new Date(globalCheckOut).toLocaleDateString("en-IN",{day:"numeric",month:"short"})}
                {" · "}{globalNights} night{globalNights > 1 ? "s" : ""}
              </span>
              <span className="text-xs text-emerald-700">·</span>
              <span className="text-xs font-semibold text-emerald-800">
                {globalAdults} adult{globalAdults > 1 ? "s" : ""}
                {globalChildren > 0 ? ` · ${globalChildren} child${globalChildren > 1 ? "ren" : ""}` : ""}
                {globalKids > 0 ? ` · ${globalKids} kid${globalKids > 1 ? "s" : ""} (free)` : ""}
              </span>
              {globalChildren > 0 && (
                <span className="ml-auto text-[0.65rem] text-amber-700 font-semibold bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
                  +₹{globalChildren * 200}/night for children
                </span>
              )}
              <span className="w-full text-[0.6rem] text-emerald-600 font-medium mt-0.5">↓ Live prices updated below</span>
            </div>
          ) : (
            <div className="p-3 bg-gold-50 border border-gold-200 rounded-2xl text-center">
              <p className="text-xs font-bold text-gold-700">← Select check-in & check-out dates to see live prices</p>
              <p className="text-[0.6rem] text-gold-500 mt-0.5">AI engine calculates the best rate for your exact travel dates</p>
            </div>
          )}
        </div>

        {/* ── Available Rooms — v123 premium · v133 IO scroll-reveal ── */}
        <div className="hx-reveal-io" style={{ marginTop: "8px" }}>
          <div className="hx-section-h">
            <span className="hx-section-h-label">Available Rooms</span>
            <span className="hx-section-h-rule" />
            <span style={{
              display: "inline-flex", alignItems: "center", gap: "5px",
              fontSize: "0.58rem", fontWeight: 800,
              letterSpacing: "0.16em", textTransform: "uppercase",
              color: "var(--cozy-cocoa-soft)", flexShrink: 0,
            }}>
              <span style={{
                width: "6px", height: "6px", borderRadius: "50%",
                background: "var(--cozy-sage)",
                animation: "hx-pulse-soft 1.6s ease-in-out infinite",
              }} />
              AI Live Pricing
            </span>
          </div>
        </div>
        {hotel.rooms?.length === 0 && (
          <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", padding: "28px 0", textAlign: "center" }}>
            No rooms available right now.
          </p>
        )}

        {(() => {
          // v159.16 — Flash-deal upgrade pricing. The headline room is the
          // cheapest; every other room is an "upgrade" priced at the locked
          // deal price + the raw floor-price gap. Computed here once so each
          // room card can show its own flash price.
          const dealRoomFloor = flashMode
            ? (hotel.rooms?.find((x: any) => x.id === dealRoomId)?.floorPrice || 0)
            : 0;
          return (
        <div style={{ display: "flex", flexDirection: "column", gap: "22px", marginBottom: "40px" }}>
          {hotel.rooms?.map((r: any) => {
            const isHeadlineRoom = dealRoomId === r.id;
            // A room is available unless explicitly flagged otherwise.
            const roomAvailable = r.isAvailable !== false
              && (r.quantity == null || Number(r.quantity) > 0);
            // Per-room flash price: headline → dealPrice, upgrade → dealPrice
            // + max(0, floor gap). Only meaningful in flashMode.
            const roomFlashPrice = flashMode
              ? (isHeadlineRoom
                  ? Math.round(parseFloat(dealPrice || "0"))
                  : Math.round(parseFloat(dealPrice || "0") + Math.max(0, (r.floorPrice || 0) - dealRoomFloor)))
              : 0;
            const flashUpgradeDiff = Math.max(0, roomFlashPrice - Math.round(parseFloat(dealPrice || "0")));
            // Render the flash pricing block for EVERY available room when
            // a flash deal brought the customer here.
            const isFlashRoom = flashMode && roomAvailable;
            const aiPrice = roomPrices[r.id];
            const ds = aiPrice ? DEMAND_STYLE[aiPrice.demandLevel] : null;
            const livePrice = aiPrice?.price || r.floorPrice;
            const isFlashing = priceFlash[r.id];
            const roomImg = getRoomImage(r.name || r.type || "", r.images);
            // OTA prices are always higher than StayBid (realistic market markup)
            // StayBid saves customer 15-28% vs OTA platforms
            const otaBase = Math.round(livePrice * 1.22);
            const otas = [
              { name: "MakeMyTrip",  price: Math.round(otaBase * 1.07), icon: "🔴" },
              { name: "Booking.com", price: Math.round(otaBase * 1.10), icon: "🔵" },
              { name: "Goibibo",     price: Math.round(otaBase * 1.03), icon: "🟢" },
              { name: "Agoda",       price: Math.round(otaBase * 1.06), icon: "🟠" },
            ];
            const bestOTA  = Math.min(...otas.map(o => o.price));
            const otaSaving = bestOTA - livePrice;
            // Amenity icons mapping
            const AMENITY_ICON: Record<string, string> = {
              "wifi": "📶", "wi-fi": "📶", "ac": "❄️", "air conditioning": "❄️", "air-conditioning": "❄️",
              "tv": "📺", "television": "📺", "parking": "🚗", "hot water": "🚿", "geyser": "🚿",
              "breakfast": "🍳", "room service": "🛎️", "mini bar": "🍷", "minibar": "🍷",
              "pool": "🏊", "swimming pool": "🏊", "gym": "💪", "fitness": "💪",
              "spa": "💆", "mountain view": "⛰️", "valley view": "⛰️", "sea view": "🌊",
              "balcony": "🪟", "terrace": "🌿", "kitchenette": "🍽️", "safe": "🔒",
              "king bed": "🛏️", "twin bed": "🛏️", "double bed": "🛏️", "sofa": "🛋️",
              "jacuzzi": "🛁", "bathtub": "🛁", "shower": "🚿", "fireplace": "🔥",
            };
            const getAmenityIcon = (name: string) => {
              const key = name.toLowerCase().trim();
              return AMENITY_ICON[key] || AMENITY_ICON[Object.keys(AMENITY_ICON).find(k => key.includes(k)) || ""] || "✓";
            };
            // Default amenities by room type if DB has none
            const defaultAmenities = r.type?.toLowerCase().includes("suite")
              ? ["AC", "TV", "Mini Bar", "Jacuzzi", "Room Service", "Mountain View"]
              : r.type?.toLowerCase().includes("deluxe")
              ? ["AC", "TV", "Hot Water", "Balcony", "Room Service", "WiFi"]
              : ["AC", "TV", "Hot Water", "WiFi", "Parking"];
            const roomAmenities: string[] = r.amenities?.length > 0 ? r.amenities : defaultAmenities;

            return (
              <div key={r.id}
                className={`hx-room-card hx-reveal ${isFlashRoom ? "is-flash" : ""} ${bidRoom?.id === r.id ? "is-selected" : ""}`}
              >
                <div className="hx-room-body">

                {/* ── Room Image gallery — v159.11 swipe carousel (was static
                    image + thumbnail-tap-to-swap). All photos visible
                    one-per-viewport, snap-x scroll, counter overlay,
                    thumbnails still work as quick-jump shortcuts. ── */}
                <div className="hx-room-media">
                  {(() => {
                    const roomImages: string[] = Array.isArray(r.images) && r.images.length > 0
                      ? r.images
                      : [roomImg];
                    const activeIdx = roomImgIdx[r.id] ?? 0;
                    const safeIdx = Math.min(activeIdx, roomImages.length - 1);
                    return (
                      <RoomSwipeMedia
                        roomId={String(r.id)}
                        roomName={r.name || r.type || "Room"}
                        images={roomImages}
                        activeIdx={safeIdx}
                        onActiveIdxChange={(idx) => setRoomImgIdx((prev) => ({ ...prev, [r.id]: idx }))}
                      />
                    );
                  })()}

                  {/* Top badges row */}
                  <div className="hx-room-media-top">
                    {isFlashRoom && (
                      <span className="hx-badge-flash">
                        <span className="hx-badge-flash-dot" />
                        FLASH DEAL
                      </span>
                    )}
                    {!isFlashRoom && ds && (
                      <span className={`hx-badge-demand ${aiPrice!.demandLevel === "Surge" ? "is-surge" : ""}`}>
                        <span className="hx-badge-demand-dot" />
                        {aiPrice!.demandLevel} Demand
                      </span>
                    )}
                    <span className="hx-badge-live">
                      <span className="hx-badge-live-dot" />
                      Live Price
                    </span>
                  </div>

                  {/* Room name overlay at bottom */}
                  <div className="hx-room-media-name">
                    <h3>{r.name || r.type}</h3>
                    <p>{r.type} · up to {r.capacity} guests</p>
                  </div>
                </div>

                {/* ── Card Body ── */}
                <div className="hx-room-content-wrap">
                <div className="hx-room-content">
                  {/* Amenities chips with icons */}
                  <div className="hx-amenity-row">
                    {roomAmenities.slice(0, 6).map((a: string) => (
                      <span key={a} className="hx-amenity-chip">
                        <span style={{ fontSize: "0.78rem" }}>{getAmenityIcon(a)}</span>
                        {a}
                      </span>
                    ))}
                    {roomAmenities.length > 6 && (
                      <span className="hx-amenity-chip" style={{ color: "var(--text-muted)" }}>
                        +{roomAmenities.length - 6} more
                      </span>
                    )}
                  </div>

                  {isFlashRoom ? (
                    /* ── FLASH ROOM PRICING ──
                       v159.16 — Headline room: locked deal price. Every
                       other room: an upgrade priced at deal + floor gap,
                       shown as "Deal ₹X + Upgrade ₹Y = ₹total". */
                    <div>
                      <div className="hx-price-block is-flash">
                        <div className="hx-price-row">
                          <div>
                            <p className="hx-price-label">
                              {isHeadlineRoom ? "⚡ Flash Deal Price" : "⚡ Flash Deal · Upgrade"}
                            </p>
                            <div style={{ display: "flex", alignItems: "baseline", gap: "8px" }}>
                              <span className="hx-price-strike">₹{r.floorPrice.toLocaleString()}</span>
                              <span className="hx-price-amount flash">₹{roomFlashPrice.toLocaleString()}</span>
                            </div>
                            <p className="hx-price-sub">
                              /night · {Math.max(0, Math.round((1 - roomFlashPrice / (r.floorPrice || roomFlashPrice)) * 100))}% off
                            </p>
                            {!isHeadlineRoom && flashUpgradeDiff > 0 && (
                              <p className="hx-price-sub" style={{ marginTop: "3px", color: "var(--cozy-cocoa-soft)" }}>
                                Deal ₹{Math.round(parseFloat(dealPrice || "0")).toLocaleString()}
                                {" + "}Upgrade ₹{flashUpgradeDiff.toLocaleString()}
                                {" = "}<strong style={{ color: "var(--cozy-warm-dark)" }}>₹{roomFlashPrice.toLocaleString()}</strong>
                              </p>
                            )}
                          </div>
                          {aiPrice && (
                            <div className="hx-price-mini">
                              <p style={{ marginBottom: "2px" }}>Market Rate</p>
                              <p className="v">₹{aiPrice.price.toLocaleString()}</p>
                              <p style={{ color: "var(--cozy-sage)", fontWeight: 700, marginTop: "2px" }}>
                                {Math.max(0, Math.round((1 - roomFlashPrice / aiPrice.price) * 100))}% below market
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="hx-cta-row">
                        <button
                          onClick={() => withBackendAuth(() => {
                            setFlashSel({ roomId: r.id, price: roomFlashPrice });
                            setFlashBookOpen(true);
                          })}
                          className="hx-cta hx-cta-primary"
                        >
                          {isHeadlineRoom ? "⚡ Book This Flash Deal" : "⚡ Upgrade & Book"}
                        </button>
                      </div>
                    </div>
                  ) : (
                    /* ── REGULAR ROOM PRICING ── */
                    <div>
                      {!datesSelected ? (
                        /* ── No dates selected — teaser ── */
                        <div>
                          <div className="hx-teaser">
                            <p className="hx-teaser-title">📅 Select dates to see live price</p>
                            <p className="hx-teaser-sub">AI pricing engine calculates the best rate for your travel dates</p>
                            <span className="hx-teaser-from">
                              <span className="hx-teaser-from-dot" />
                              From ₹{(r.floorPrice || 0).toLocaleString()}/night
                            </span>
                          </div>
                          <div className="hx-cta-row">
                            <button
                              onClick={() => withBackendAuth(() => openBookNow(r))}
                              className="hx-cta hx-cta-primary"
                            >
                              Book Now →
                            </button>
                            <button
                              onClick={() => withBackendAuth(() => openNegotiate(r))}
                              className="hx-cta hx-cta-secondary"
                            >
                              🤝 Negotiate
                            </button>
                          </div>
                        </div>
                      ) : (
                        /* ── Dates selected — show full pricing ── */
                        <>
                          {/* Nights + guest summary + total cost */}
                          {(() => {
                            const extraA = Math.max(0, globalAdults - (r.capacity || 2));
                            const extraCharge = extraA * 500 * globalNights + globalChildren * 200 * globalNights;
                            const nightTotal = livePrice * globalNights + extraCharge;
                            return (
                              <div className="mb-3 space-y-1.5">
                                <div className="flex flex-wrap gap-1.5">
                                  <span className="text-[0.65rem] font-bold px-3 py-1 bg-luxury-100 text-luxury-600 rounded-full border border-luxury-200">
                                    📅 {new Date(globalCheckIn).toLocaleDateString("en-IN",{day:"numeric",month:"short"})} → {new Date(globalCheckOut).toLocaleDateString("en-IN",{day:"numeric",month:"short"})} · {globalNights} night{globalNights > 1 ? "s" : ""}
                                  </span>
                                  <span className="text-[0.65rem] font-bold px-3 py-1 bg-luxury-100 text-luxury-600 rounded-full border border-luxury-200">
                                    👥 {globalAdults} adults{globalChildren > 0 ? ` · ${globalChildren} children` : ""}{globalKids > 0 ? ` · ${globalKids} kids` : ""}
                                  </span>
                                </div>
                                <div className="flex items-center justify-between px-3 py-2 bg-luxury-50 rounded-xl border border-luxury-100">
                                  <span className="text-xs text-luxury-500">
                                    ₹{livePrice.toLocaleString()} × {globalNights}n{extraA > 0 ? ` + ₹${extraA * 500}×${globalNights}n extra` : ""}{globalChildren > 0 ? ` + ₹${globalChildren * 200}×${globalNights}n child` : ""}
                                  </span>
                                  <span className="text-sm font-bold text-luxury-900">₹{nightTotal.toLocaleString()}</span>
                                </div>
                              </div>
                            );
                          })()}

                          {/* ── Per-unit availability grid (room numbers) ── */}
                          {(() => {
                            const ua = unitAvail[r.id];
                            if (!ua || !ua.units || ua.units.length === 0) return null;
                            return (
                              <div className="mb-4 rounded-2xl border border-luxury-100 bg-gradient-to-br from-white to-luxury-50 p-3.5">
                                <div className="flex items-center justify-between mb-2">
                                  <div className="flex items-center gap-1.5">
                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                    <p className="text-[0.6rem] font-bold text-luxury-500 uppercase tracking-widest">
                                      Live · {ua.unitsFree} of {ua.unitsTotal} rooms vacant
                                    </p>
                                  </div>
                                  <span className={`text-[0.55rem] font-bold px-2 py-0.5 rounded-full ${
                                    ua.unitsFree === 0 ? "bg-red-50 text-red-600 border border-red-200" :
                                    ua.unitsFree <= 2 ? "bg-amber-50 text-amber-700 border border-amber-200" :
                                    "bg-emerald-50 text-emerald-700 border border-emerald-200"
                                  }`}>
                                    {ua.unitsFree === 0 ? "SOLD OUT" : ua.unitsFree <= 2 ? "Filling fast" : "Available"}
                                  </span>
                                </div>
                                <div className="flex flex-wrap gap-1.5">
                                  {ua.units.map((u: any) => (
                                    <span key={u.unitId}
                                      title={u.status === "occupied"
                                        ? `Occupied ${u.occupiedBy?.fromDate} → ${u.occupiedBy?.toDate}`
                                        : "Vacant for your dates"}
                                      className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[0.65rem] font-bold border transition-all ${
                                        u.status === "vacant"
                                          ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                          : "bg-red-50 text-red-600 border-red-200 line-through opacity-80"
                                      }`}>
                                      {u.status === "vacant" ? "✓" : "✗"} #{u.unitNumber}
                                    </span>
                                  ))}
                                </div>
                                {ua.unitsUnassigned > 0 && (
                                  <p className="text-[0.55rem] text-luxury-400 mt-2">
                                    +{ua.unitsUnassigned} reserved (awaiting room assignment)
                                  </p>
                                )}
                              </div>
                            );
                          })()}

                          {/* Live price + demand signal — v123 premium */}
                          <div className={`hx-price-block ${isFlashing ? "is-flash" : ""}`}>
                            <div className="hx-price-row">
                              <div>
                                <p className="hx-price-label">StayBid Live Price</p>
                                <p className={`hx-price-amount ${isFlashing ? "hx-price-flash" : ""}`}>
                                  ₹{livePrice.toLocaleString()}
                                </p>
                                <p className="hx-price-sub">
                                  /night
                                  {aiPrice && aiPrice.priceChangePct !== 0 && (
                                    <span style={{
                                      marginLeft: "8px",
                                      fontWeight: 700,
                                      color: aiPrice.priceChangePct > 0 ? "var(--cozy-rose)" : "var(--cozy-sage)",
                                    }}>
                                      {aiPrice.priceChangePct > 0 ? "▲" : "▼"} {Math.abs(aiPrice.priceChangePct)}% vs base
                                    </span>
                                  )}
                                </p>
                              </div>
                              {aiPrice && ds && (
                                <div className="hx-price-mini">
                                  <p style={{ marginBottom: "3px" }}>Demand</p>
                                  <p className="v" style={{ fontSize: "0.95rem" }}>{aiPrice.demandLevel}</p>
                                  <div style={{
                                    marginTop: "6px",
                                    height: "4px",
                                    width: "90px",
                                    background: "var(--cozy-cream-200)",
                                    borderRadius: "999px",
                                    overflow: "hidden",
                                  }}>
                                    <div style={{
                                      width: `${aiPrice.demandScore}%`,
                                      height: "100%",
                                      background: "linear-gradient(90deg, var(--cozy-champagne-light), var(--cozy-champagne))",
                                      borderRadius: "999px",
                                      transition: "width 0.7s ease",
                                    }} />
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Trend chip */}
                          {aiPrice && (
                            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "10px" }}>
                              <span style={{
                                fontSize: "0.65rem",
                                fontWeight: 700,
                                padding: "5px 11px",
                                borderRadius: "999px",
                                background: aiPrice.trend === "rising" ? "rgba(212, 149, 131, 0.16)" :
                                            aiPrice.trend === "falling" ? "rgba(157, 173, 143, 0.18)" :
                                            "var(--bg-pill)",
                                color: aiPrice.trend === "rising" ? "var(--cozy-rose)" :
                                       aiPrice.trend === "falling" ? "#5e7349" :
                                       "var(--cozy-cocoa)",
                                border: `1px solid ${
                                  aiPrice.trend === "rising" ? "rgba(212, 149, 131, 0.3)" :
                                  aiPrice.trend === "falling" ? "rgba(157, 173, 143, 0.35)" :
                                  "var(--border-soft)"
                                }`,
                              }}>
                                {aiPrice.trend === "rising" ? "📈 Price rising — book now" : aiPrice.trend === "falling" ? "📉 Price dropping" : "⟷ Stable price"}
                              </span>
                              {aiPrice.factors.slice(0, 2).map((f) => (
                                <span key={f} style={{
                                  fontSize: "0.65rem",
                                  fontWeight: 600,
                                  padding: "5px 11px",
                                  borderRadius: "999px",
                                  background: "var(--accent-soft)",
                                  color: "var(--cozy-cocoa)",
                                  border: "1px solid rgba(201, 166, 107, 0.3)",
                                }}>
                                  {f}
                                </span>
                              ))}
                            </div>
                          )}

                          {/* OTA comparison — v123 premium · v133 animated bars
                              (bars scale from 0 → ratio when scrolled into view) */}
                          {(() => {
                            const maxPrice = Math.max(livePrice, ...otas.map(o => o.price));
                            const fillFor = (p: number) => maxPrice > 0 ? p / maxPrice : 1;
                            return (
                              <div className="hx-ota hx-reveal-io">
                                <p className="hx-ota-h">Live market comparison</p>
                                {otas.map(o => (
                                  <div key={o.name} className="hx-ota-row">
                                    <span className="name"><span>{o.icon}</span>{o.name}</span>
                                    <span className="hx-ota-bar-wrap" aria-hidden="true">
                                      <span
                                        className="hx-ota-bar"
                                        style={{ ["--bar-fill" as any]: fillFor(o.price) }}
                                      />
                                    </span>
                                    <span className="price">₹{o.price.toLocaleString()}</span>
                                  </div>
                                ))}
                                <div className="hx-ota-winner">
                                  <span className="hx-ota-winner-l">🏆 StayBid Price</span>
                                  <span className="hx-ota-bar-wrap" aria-hidden="true">
                                    <span
                                      className="hx-ota-bar is-stayBid"
                                      style={{ ["--bar-fill" as any]: fillFor(livePrice) }}
                                    />
                                  </span>
                                  <span className="hx-ota-winner-r">₹{livePrice.toLocaleString()}</span>
                                </div>
                                {otaSaving > 0 && (
                                  <p className="hx-ota-savings">
                                    ✓ Save ₹{otaSaving.toLocaleString()} vs best OTA ({Math.round(otaSaving/bestOTA*100)}% cheaper)
                                  </p>
                                )}
                              </div>
                            );
                          })()}

                          <div className="hx-cta-row">
                            <button
                              onClick={() => withBackendAuth(() => openBookNow(r))}
                              className="hx-cta hx-cta-primary"
                            >
                              Book Now →
                            </button>
                            <button
                              onClick={() => withBackendAuth(() => openNegotiate(r))}
                              className="hx-cta hx-cta-secondary"
                            >
                              🤝 Negotiate
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>{/* /hx-room-content */}
                </div>{/* /hx-room-content-wrap */}
                </div>{/* /hx-room-body */}
              </div>
            );
          })}
        </div>
          );
        })()}

        </> /* end rooms tab */}

          </div>{/* /column main */}

          {/* ── v123 Sticky desktop booking summary (≥1100px only) ── */}
          <aside className="hx-sticky-rail" aria-label="Best rate summary">
            <div className="hx-sticky-card hx-reveal">
              <span className="hx-sticky-rate-l">Best rate from</span>
              <div className="hx-sticky-rate-v">
                ₹{(lowestForRibbon || 0).toLocaleString()}
              </div>
              <p className="hx-sticky-rate-s">
                /night before taxes · {roomsAvail} room{roomsAvail === 1 ? "" : "s"} available
              </p>

              <div style={{
                display: "flex", alignItems: "center", gap: "8px",
                margin: "16px 0 14px",
                padding: "10px 12px",
                background: "var(--accent-soft)",
                border: "1px solid rgba(201, 166, 107, 0.3)",
                borderRadius: "12px",
              }}>
                <span style={{ fontSize: "1rem" }}>💡</span>
                <p style={{ fontSize: "0.74rem", color: "var(--cozy-cocoa)", margin: 0, lineHeight: 1.45 }}>
                  Set dates &amp; negotiate to unlock the lowest price for your exact stay.
                </p>
              </div>

              <button
                type="button"
                onClick={() => {
                  const el = document.getElementById("availability-picker");
                  el?.scrollIntoView({ behavior: "smooth", block: "center" });
                }}
                className="hx-cta hx-cta-primary"
                style={{ width: "100%", marginBottom: "8px" }}
              >
                Check availability →
              </button>

              {hotel.rooms?.length > 0 && (() => {
                const cheapest = hotel.rooms.reduce((acc: any, r: any) =>
                  (!acc || (r.floorPrice || 99999) < (acc.floorPrice || 99999)) ? r : acc, null);
                if (!cheapest) return null;
                return (
                  <button
                    type="button"
                    onClick={() => withBackendAuth(() => openNegotiate(cheapest))}
                    className="hx-cta hx-cta-secondary"
                    style={{ width: "100%" }}
                  >
                    🤝 Negotiate Price
                  </button>
                );
              })()}

              <div style={{
                marginTop: "16px", paddingTop: "14px",
                borderTop: "1px solid var(--border-soft)",
                display: "flex", flexDirection: "column", gap: "8px",
              }}>
                {[
                  { i: "🛡", t: "Verified by StayBid" },
                  { i: "💰", t: "Best-price guarantee" },
                  { i: "🔄", t: "Free cancellation 24h prior" },
                ].map(({ i, t }) => (
                  <div key={t} style={{
                    display: "flex", alignItems: "center", gap: "10px",
                    fontSize: "0.78rem", color: "var(--text-soft)",
                  }}>
                    <span style={{ fontSize: "0.95rem" }}>{i}</span>
                    {t}
                  </div>
                ))}
              </div>
            </div>
          </aside>
        </div>{/* /hx-page-grid */}

      </div>{/* /max-w-6xl */}

      {/* ══════════════════════════════════════════
          PHOTO GALLERY LIGHTBOX
      ══════════════════════════════════════════ */}
      {galleryOpen && (() => {
        const PLACEHOLDERS = [
          "https://images.unsplash.com/photo-1564501049412-61c2a3083791?w=800&q=80",
          "https://images.unsplash.com/photo-1520250497591-112f2f40a3f4?w=800&q=80",
          "https://images.unsplash.com/photo-1571896349842-33c89424de2d?w=800&q=80",
          "https://images.unsplash.com/photo-1566073771259-6a8506099945?w=800&q=80",
          "https://images.unsplash.com/photo-1445019980597-93fa8acb246c?w=800&q=80",
          "https://images.unsplash.com/photo-1540555700478-4be289fbecef?w=800&q=80",
        ];
        const base = Array.isArray(hotel.images) ? hotel.images : [];
        const allImgs = [...base, ...PLACEHOLDERS].slice(0, Math.max(5, base.length));
        return (
          <div className="fixed inset-0 z-[70] bg-black/95 flex items-center justify-center"
            onClick={() => setGalleryOpen(false)}>
            <div className="relative w-full max-w-4xl mx-4" onClick={e => e.stopPropagation()}>
              <ModalCloseButton onClose={() => setGalleryOpen(false)} tone="dark" className="absolute -top-12 right-0 z-10" />

              <div className="relative rounded-2xl overflow-hidden bg-black/50 max-h-[70vh] flex items-center justify-center">
                <img
                  src={allImgs[galleryIdx] || PLACEHOLDERS[0]}
                  alt={`${hotel.name} — Photo ${galleryIdx + 1}`}
                  className="max-h-[70vh] max-w-full object-contain"
                  onError={(e: any) => { e.target.src = PLACEHOLDERS[galleryIdx % PLACEHOLDERS.length]; }}
                />
                {galleryIdx > 0 && (
                  <button onClick={() => setGalleryIdx(galleryIdx - 1)}
                    className="absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/60 text-white flex items-center justify-center text-xl hover:bg-black/80 transition-all">‹</button>
                )}
                {galleryIdx < allImgs.length - 1 && (
                  <button onClick={() => setGalleryIdx(galleryIdx + 1)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/60 text-white flex items-center justify-center text-xl hover:bg-black/80 transition-all">›</button>
                )}
              </div>

              <p className="text-center text-white/50 text-sm mt-3">
                {galleryIdx + 1} / {allImgs.length}
                {/* v132.6 — desktop-only keyboard shortcut hint */}
                <span className="hidden lg:inline text-white/30 ml-3 text-xs tracking-wide">
                  · ← → navigate · Esc to close
                </span>
              </p>

              <div className="flex gap-2 mt-3 overflow-x-auto pb-2">
                {allImgs.map((img: string, i: number) => (
                  <button key={i} onClick={() => setGalleryIdx(i)}
                    className={`flex-shrink-0 w-16 h-12 rounded-xl overflow-hidden border-2 transition-all ${i === galleryIdx ? "border-gold-400 scale-105" : "border-transparent opacity-60 hover:opacity-100"}`}>
                    <img src={img} alt="" className="w-full h-full object-cover"
                      onError={(e: any) => { e.target.src = PLACEHOLDERS[i % PLACEHOLDERS.length]; }} />
                  </button>
                ))}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ══════════════════════════════════════════
          INLINE PHONE VERIFY (Google/Social users)
      ══════════════════════════════════════════ */}
      {verifyOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm"
          onClick={() => setVerifyOpen(false)}>
          <div className="bg-white w-full max-w-sm mx-4 rounded-3xl shadow-luxury-lg p-7"
            onClick={(e) => e.stopPropagation()}>
            <div className="text-center mb-6">
              <div className="w-14 h-14 rounded-full bg-gold-50 border-2 border-gold-200 flex items-center justify-center mx-auto mb-4">
                <span className="text-2xl">📱</span>
              </div>
              <h3 className="font-display font-light text-luxury-900 text-2xl mb-1">One Quick Step</h3>
              <p className="text-sm text-luxury-500 leading-relaxed">
                Verify your phone number to place bids and bookings.<br />
                <span className="text-luxury-400 text-xs">One-time only — takes 30 seconds.</span>
              </p>
            </div>

            {verifyStep === "phone" ? (
              <>
                <label className="text-xs font-bold text-luxury-500 uppercase tracking-wider block mb-2">Your Mobile Number</label>
                <div className="flex gap-2 mb-4">
                  <span className="px-3 py-3 bg-luxury-50 border border-luxury-200 rounded-xl text-sm font-medium text-luxury-600 flex-shrink-0">+91</span>
                  <input
                    type="tel"
                    value={verifyPhone}
                    onChange={(e) => setVerifyPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
                    placeholder="10-digit number"
                    className="input-luxury text-sm flex-1"
                    maxLength={10}
                    inputMode="numeric"
                    autoFocus
                  />
                </div>
                <button onClick={sendVerifyOtp} disabled={verifyLoading || verifyPhone.length < 10}
                  className="btn-luxury w-full py-3.5 rounded-2xl text-sm font-semibold disabled:opacity-40">
                  {verifyLoading ? "Sending OTP…" : "Send OTP"}
                </button>
              </>
            ) : (
              <>
                <p className="text-xs text-luxury-400 text-center mb-4">OTP sent to +91 {verifyPhone}</p>
                <label className="text-xs font-bold text-luxury-500 uppercase tracking-wider block mb-2">Enter OTP</label>
                <input
                  type="text"
                  value={verifyOtpVal}
                  onChange={(e) => setVerifyOtpVal(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="• • • • • •"
                  className="input-luxury text-center text-2xl tracking-[0.5em] font-bold mb-4"
                  maxLength={6}
                  inputMode="numeric"
                  autoFocus
                />
                <button onClick={confirmVerifyOtp} disabled={verifyLoading || verifyOtpVal.length < 4}
                  className="btn-luxury w-full py-3.5 rounded-2xl text-sm font-semibold disabled:opacity-40 mb-2">
                  {verifyLoading ? "Verifying…" : "Verify & Continue"}
                </button>
                <button onClick={() => { setVerifyStep("phone"); setVerifyOtpVal(""); setVerifyError(""); }}
                  className="w-full py-2 text-xs text-luxury-400 hover:text-luxury-700 transition-colors">
                  Change number
                </button>
              </>
            )}

            {verifyError && (
              <div className="mt-3 px-4 py-3 bg-red-50 border border-red-200 rounded-xl flex items-start gap-2">
                <span className="text-red-400 mt-0.5 shrink-0">⚠</span>
                <p className="text-sm text-red-600">{verifyError}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════
          FLASH DEAL BOOKING MODAL
      ══════════════════════════════════════════ */}
      {flashBookOpen && dealPrice && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setFlashBookOpen(false)}>
          <div className="bg-white w-full sm:max-w-lg rounded-t-3xl sm:rounded-3xl shadow-luxury-lg overflow-hidden"
            onClick={(e) => e.stopPropagation()}>
            {/* Gold header */}
            <div className="bg-gradient-to-r from-gold-600 to-gold-400 px-6 py-4 flex items-center justify-between">
              <div>
                <p className="text-xs font-bold text-white/70 uppercase tracking-widest">⚡ Flash Deal Booking</p>
                <p className="text-white font-semibold text-lg">{flashRoom?.name || "Room"}</p>
                <p className="text-white/70 text-sm">{hotel.name}</p>
              </div>
              <ModalCloseButton onClose={() => setFlashBookOpen(false)} tone="dark" />
            </div>

            <div className="p-6 overflow-y-auto max-h-[70vh]">

              {/* Dates */}
              <div className="grid grid-cols-2 gap-3 mb-5">
                <div>
                  <label className="text-xs font-bold text-luxury-500 uppercase tracking-wider block mb-1.5">Check-in (Today)</label>
                  <div className="input-luxury text-sm bg-luxury-50 text-luxury-400 cursor-not-allowed flex items-center gap-2">
                    🔒 {new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                  </div>
                </div>
                <div>
                  <label className="text-xs font-bold text-luxury-500 uppercase tracking-wider block mb-1.5">Check-out</label>
                  <button
                    type="button"
                    onClick={() => {
                      const dp = fbPrice;
                      const disc = parseFloat(dealDiscount || "0");
                      const roomFloor = flashRoom?.floorPrice || 0;
                      openCalendar({
                        mode: "checkOut",
                        checkIn: today,
                        checkOut: flashCheckOut,
                        minCheckIn: today,
                        rooms: flashRoom ? [flashRoom] : (hotel?.rooms || []),
                        pricingMode: "hotel",
                        headerBanner: (
                          <>
                            🔥 <strong>Flash deal valid today only</strong> at <span className="lux-cal-banner-hi">₹{dp.toLocaleString()}/night</span>
                            {disc > 0 && <> ({disc}% off)</>}.
                            <span className="lux-cal-banner-sub">
                              Extending the stay? Future nights are billed at the regular rate shown on each date.
                            </span>
                          </>
                        ),
                        onApply: ({ checkOut: co }) => { if (co) setFlashCheckOut(co); },
                      });
                    }}
                    className="input-luxury text-sm w-full text-left flex items-center justify-between"
                  >
                    <span className={flashCheckOut ? "text-luxury-900 font-semibold" : "text-luxury-400"}>
                      {flashCheckOut
                        ? new Date(flashCheckOut).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })
                        : "Pick date"}
                    </span>
                    <span className="text-gold-500 text-base">📅</span>
                  </button>
                </div>
              </div>

              {/* Guests */}
              <div className="mb-5">
                <label className="text-xs font-bold text-luxury-500 uppercase tracking-wider block mb-3">Guests</label>
                <div className="space-y-3">
                  {/* Adults */}
                  <div className="flex items-center justify-between p-3 bg-luxury-50 rounded-2xl">
                    <div>
                      <p className="text-sm font-semibold text-luxury-900">Adults</p>
                      <p className="text-xs text-luxury-400">
                        {baseCapacity} included · Extra ₹{extraAdultRate}/night each
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <button onClick={() => setFlashAdults(Math.max(1, flashAdults - 1))}
                        className="w-8 h-8 rounded-full border border-luxury-200 flex items-center justify-center text-luxury-600 hover:border-gold-400 hover:text-gold-600 transition font-bold text-lg">
                        −
                      </button>
                      <span className="w-6 text-center font-bold text-luxury-900">{flashAdults}</span>
                      <button onClick={() => setFlashAdults(Math.min(8, flashAdults + 1))}
                        className="w-8 h-8 rounded-full border border-luxury-200 flex items-center justify-center text-luxury-600 hover:border-gold-400 hover:text-gold-600 transition font-bold text-lg">
                        +
                      </button>
                    </div>
                  </div>

                  {/* Children */}
                  <div className="flex items-center justify-between p-3 bg-luxury-50 rounded-2xl">
                    <div>
                      <p className="text-sm font-semibold text-luxury-900">Children <span className="text-luxury-400 font-normal">(5–12 yrs)</span></p>
                      <p className="text-xs text-luxury-400">₹{childRate}/night each · Under 5 free</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <button onClick={() => setFlashChildren(Math.max(0, flashChildren - 1))}
                        className="w-8 h-8 rounded-full border border-luxury-200 flex items-center justify-center text-luxury-600 hover:border-gold-400 hover:text-gold-600 transition font-bold text-lg">
                        −
                      </button>
                      <span className="w-6 text-center font-bold text-luxury-900">{flashChildren}</span>
                      <button onClick={() => setFlashChildren(Math.min(6, flashChildren + 1))}
                        className="w-8 h-8 rounded-full border border-luxury-200 flex items-center justify-center text-luxury-600 hover:border-gold-400 hover:text-gold-600 transition font-bold text-lg">
                        +
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Number of rooms — extension */}
              <div className="mb-5">
                <label className="text-xs font-bold text-luxury-500 uppercase tracking-wider block mb-2">Rooms needed</label>
                <div className="flex items-center justify-between p-3 picker-tile">
                  <div>
                    <p className="text-sm font-semibold text-luxury-900">Room quantity</p>
                    <p className="text-[0.65rem] text-luxury-400">Deal covers 1 · extras checked live against availability</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <button type="button" onClick={() => setFlashRoomQty(Math.max(1, flashRoomQty - 1))} className="picker-step">−</button>
                    <span className="w-6 text-center font-black text-luxury-900 text-lg">{flashRoomQty}</span>
                    <button type="button" onClick={() => setFlashRoomQty(Math.min(10, flashRoomQty + 1))} className="picker-step">+</button>
                  </div>
                </div>

                {/* Live availability banner — only when extending (qty>1 or nights>1) */}
                {flashIsUpgrade && (
                  <div className="mt-2">
                    {flashAvail?.loading ? (
                      <div className="p-2.5 bg-luxury-50 border border-luxury-200 rounded-xl text-xs text-luxury-500 flex items-center gap-2">
                        <span className="w-3 h-3 border-2 border-luxury-300 border-t-luxury-500 rounded-full animate-spin" />
                        AI checking room availability for these dates…
                      </div>
                    ) : flashAvail?.feasible ? (
                      <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-700 flex items-center gap-2">
                        <span>✅</span>
                        <span><b>{flashAvail.unitsFree}</b> of {flashAvail.unitsTotal} rooms free · Auto-approved at flash price</span>
                      </div>
                    ) : flashAvail ? (
                      <div className="p-2.5 bg-amber-50 border border-amber-300 rounded-xl text-xs text-amber-800">
                        <p className="font-semibold">⚠️ Only {flashAvail.unitsFree} of {flashAvail.unitsTotal} rooms free on these dates</p>
                        <p className="text-amber-700 mt-0.5">You can still book — hotel gets notified &amp; reviews your request. Dates auto-block on their side if approved.</p>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>

              {/* Rate Breakdown */}
              <div className="bg-gold-50 border border-gold-200 rounded-2xl p-4 mb-5">
                <p className="text-xs font-bold text-gold-600 uppercase tracking-widest mb-3">Rate Breakdown</p>
                <div className="space-y-1.5 text-sm">
                  <div className="flex justify-between text-luxury-700">
                    <span>₹{fbPrice.toLocaleString()} × {flashNights} night{flashNights > 1 ? "s" : ""}{flashRoomQty > 1 ? ` × ${flashRoomQty} rooms` : ""}</span>
                    <span className="font-semibold">₹{flashBaseTotal.toLocaleString()}</span>
                  </div>
                  {extraAdults > 0 && (
                    <div className="flex justify-between text-luxury-700">
                      <span>{extraAdults} extra adult{extraAdults > 1 ? "s" : ""} × ₹{extraAdultRate} × {flashNights}n</span>
                      <span className="font-semibold">₹{flashExtraTotal.toLocaleString()}</span>
                    </div>
                  )}
                  {flashChildren > 0 && (
                    <div className="flex justify-between text-luxury-700">
                      <span>{flashChildren} child{flashChildren > 1 ? "ren" : ""} × ₹{childRate} × {flashNights}n</span>
                      <span className="font-semibold">₹{flashChildTotal.toLocaleString()}</span>
                    </div>
                  )}
                  <div className="border-t border-gold-200 pt-2 mt-2 flex justify-between">
                    <span className="font-bold text-luxury-900">Total ({flashNights} night{flashNights > 1 ? "s" : ""})</span>
                    <span className="font-bold text-xl text-luxury-900">₹{flashGrandTotal.toLocaleString()}</span>
                  </div>
                  {dealDiscount && (
                    <p className="text-xs text-gold-600 font-medium text-right">{dealDiscount}% savings vs regular price</p>
                  )}
                </div>
              </div>

              <div className="space-y-2.5">
                <button
                  onClick={handleFlashBook}
                  disabled={bookLoading}
                  className="btn-3d btn-3d-gold btn-3d-lg w-full"
                >
                  {bookLoading ? "Confirming…" : `⚡ Confirm Booking · ₹${flashGrandTotal.toLocaleString()}`}
                </button>
                <button
                  onClick={() => {
                    // Close the flash modal but PRESERVE deal context so the
                    // sticky flash-deal banner + Book CTA stays visible. We
                    // only drop `directBook` so the modal doesn't auto-reopen
                    // — the customer can browse photos/rooms and then click
                    // the banner's "Book This Flash Deal" CTA right here.
                    setFlashBookOpen(false);
                    const qs = new URLSearchParams();
                    if (dealId)       qs.set("dealId",    dealId);
                    if (dealPrice)    qs.set("dealPrice", dealPrice);
                    if (dealRoomId)   qs.set("roomId",    dealRoomId);
                    if (dealDiscount) qs.set("discount",  dealDiscount);
                    router.replace(`/hotels/${hotel.id}?${qs.toString()}`);
                  }}
                  disabled={bookLoading}
                  className="btn-3d btn-3d-white w-full"
                >
                  🏨 View Hotel Details First
                </button>
                <p className="text-center text-[0.65rem] text-luxury-400 tracking-wide">
                  Explore photos, amenities &amp; reviews before booking
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══ BOOK NOW MODAL ══ */}
      {bnRoom && !bnSuccess && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setBnRoom(null)}>
          <div className="bg-white w-full sm:max-w-lg rounded-t-3xl sm:rounded-3xl shadow-luxury-lg overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="bg-gradient-to-r from-luxury-900 to-luxury-800 px-6 py-4 flex items-center justify-between">
              <div>
                <p className="text-xs font-bold text-white/60 uppercase tracking-widest">Instant Booking</p>
                <p className="text-white font-semibold text-lg">{bnRoom.name||bnRoom.type}</p>
                <p className="text-white/60 text-sm">{hotel.name}</p>
              </div>
              <ModalCloseButton onClose={() => setBnRoom(null)} tone="dark" />
            </div>
            <div className="p-6 space-y-4 overflow-y-auto max-h-[70vh]">

              {/* Booking summary — read-only from global picker */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-luxury-50 rounded-2xl p-4 border border-luxury-100">
                  <p className="text-[0.6rem] font-bold text-luxury-400 uppercase tracking-widest mb-1.5">Check-in</p>
                  <p className="font-semibold text-luxury-900 text-sm">{new Date(bnIn).toLocaleDateString("en-IN",{weekday:"short",day:"numeric",month:"short",year:"numeric"})}</p>
                </div>
                <div className="bg-luxury-50 rounded-2xl p-4 border border-luxury-100">
                  <p className="text-[0.6rem] font-bold text-luxury-400 uppercase tracking-widest mb-1.5">Check-out</p>
                  <p className="font-semibold text-luxury-900 text-sm">{new Date(bnOut).toLocaleDateString("en-IN",{weekday:"short",day:"numeric",month:"short",year:"numeric"})}</p>
                </div>
              </div>

              {/* Guest summary */}
              <div className="bg-luxury-50 rounded-2xl p-4 border border-luxury-100 flex items-center justify-between">
                <div>
                  <p className="text-[0.6rem] font-bold text-luxury-400 uppercase tracking-widest mb-1">Guests</p>
                  <p className="text-sm font-semibold text-luxury-900">
                    {globalAdults} adult{globalAdults>1?"s":""}
                    {globalChildren>0?` · ${globalChildren} child${globalChildren>1?"ren":""}`:""}{globalKids>0?` · ${globalKids} kid${globalKids>1?"s":""} (free)`:""}
                  </p>
                </div>
                <span className="text-[0.6rem] text-luxury-400 bg-white border border-luxury-200 px-2.5 py-1 rounded-full">from Availability</span>
              </div>

              {/* Rate breakdown */}
              {(() => {
                const nights = Math.max(1, Math.ceil((new Date(bnOut).getTime()-new Date(bnIn).getTime())/86400000));
                const extra = Math.max(0, bnAdults-(bnRoom.capacity||2));
                const total = bnRoom.floorPrice*nights + extra*500*nights + bnChildren*200*nights;
                return (
                  <div className="bg-gold-50 border border-gold-200 rounded-2xl p-4">
                    <p className="text-xs font-bold text-gold-600 uppercase tracking-widest mb-3">Rate Breakdown</p>
                    <div className="space-y-1.5 text-sm">
                      <div className="flex justify-between text-luxury-700"><span>₹{bnRoom.floorPrice.toLocaleString()} × {nights} night{nights>1?"s":""}</span><span className="font-semibold">₹{(bnRoom.floorPrice*nights).toLocaleString()}</span></div>
                      {extra > 0 && <div className="flex justify-between text-luxury-700"><span>{extra} extra adult{extra>1?"s":""} × ₹500 × {nights}n</span><span className="font-semibold">₹{(extra*500*nights).toLocaleString()}</span></div>}
                      {bnChildren > 0 && <div className="flex justify-between text-luxury-700"><span>{bnChildren} child{bnChildren>1?"ren":""} × ₹200 × {nights}n</span><span className="font-semibold">₹{(bnChildren*200*nights).toLocaleString()}</span></div>}
                      {globalKids > 0 && <div className="flex justify-between text-luxury-700"><span>{globalKids} kid{globalKids>1?"s":""} (under 5)</span><span className="font-semibold text-emerald-600">FREE</span></div>}
                      <div className="border-t border-gold-200 pt-2 mt-2 flex justify-between font-bold text-luxury-900"><span>Total</span><span className="text-xl">₹{total.toLocaleString()}</span></div>
                    </div>
                  </div>
                );
              })()}
              <button onClick={handleBookNow} disabled={bnLoading} className="btn-3d btn-3d-gold btn-3d-lg w-full">
                {bnLoading ? "Confirming…" : "✨ Confirm Booking"}
              </button>
            </div>
          </div>
        </div>
      )}
      {bnSuccess && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setBnRoom(null)}>
          <div className="bg-white max-w-sm w-full mx-4 rounded-3xl shadow-luxury-lg p-8 text-center" onClick={e => e.stopPropagation()}>
            <div className="w-16 h-16 rounded-full bg-gold-100 flex items-center justify-center mx-auto mb-5"><span className="text-3xl">🎉</span></div>
            <h3 className="font-display font-light text-luxury-900 text-2xl mb-2">Booking Confirmed!</h3>
            <p className="text-luxury-400 text-sm mb-6">Your booking at <span className="font-semibold text-luxury-700">{hotel.name}</span> is confirmed.</p>
            {/* Phase 4 tier-system — Inspiration banner inside the success
                modal. Dismiss state is keyed off the hotel id so the same
                user doesn't see the same nudge twice for the same trip. */}
            <InspirationBanner
              variant="modal"
              hotelId={hotel.id}
              hotelName={hotel.name}
              bookingId={hotel.id}
            />
            <div className="flex gap-3 mt-4">
              <button onClick={() => setBnRoom(null)} className="flex-1 py-3 rounded-2xl border border-luxury-200 text-luxury-600 text-sm">Close</button>
              <Link href="/bookings" className="flex-1 py-3 rounded-2xl btn-luxury text-sm text-center">My Bookings</Link>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════
          NEGOTIATE MODAL — Premium Live Bidding (v65)
          Casino-grade gambling feel: animated probability ring,
          slot-machine number, glowing rainbow slider, AI ticker,
          demand sparkline. All inline CSS, zero external deps.
      ══════════════════════════════════════════ */}
      {negRoom && !negSuccess && (() => {
        const floor   = negRoom.floorPrice;
        // v129 — slider bounds + bid amount are always ₹100 multiples so every
        // step on the drag bar lands on the same indivisible billing unit the
        // platform uses end-to-end (Save Big chip, Smart chip, Instant chip,
        // hotel counter slider, /bid presets — all share PRICE_STEP).
        const min     = Math.max(PRICE_MIN, floor100(floor * 0.65));
        const max     = ceil100(floor * 1.05);
        const prob    = bidProb(negAmt, floor);
        const nights  = (negIn && negOut && negIn < negOut)
          ? Math.max(1, Math.ceil((new Date(negOut).getTime()-new Date(negIn).getTime())/86400000))
          : 1;
        const totalBid = negAmt * nights;
        const isBelow  = negAmt < floor;
        const isInstant = negAmt >= floor;
        const stayPoints = Math.floor(totalBid / 100) * 5;
        // Stable per-hotel/room seed for synthesized "recent accepted prices".
        // v159.14 — sparkBars removed (was only used by the now-hidden 14-day
        // chart). recentAvg stays — feeds the AI ticker rotation below.
        const seed = (negRoom.id || hotel.id || "x").split("").reduce((s:number,c:string)=>s+c.charCodeAt(0),0);
        const recentAvg = Math.round(floor * (0.85 + ((seed % 13) / 100)));
        const viewersNow = 3 + (seed % 9);
        // Rotating AI tips — CSS animates the rotation
        const aiTips = [
          `🔥 Last accepted at ₹${recentAvg.toLocaleString()} · 2h ago`,
          `👀 ${viewersNow} guests viewing this room right now`,
          `📈 Demand up · weekend surge active`,
          `⭐ Bid above ₹${Math.round(floor*0.9).toLocaleString()} → 70%+ acceptance`,
        ];
        // Circle math for probability ring (r=46, stroke 8, viewBox 120)
        const R = 46, C = 2 * Math.PI * R;
        const dash = (prob.p / 100) * C;
        return (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center backdrop-blur-md"
            style={{ background:"rgba(2,4,12,0.78)" }}
            onClick={() => setNegRoom(null)}>
            <div className="w-full sm:max-w-lg rounded-t-3xl sm:rounded-3xl overflow-hidden relative"
              onClick={e => e.stopPropagation()}
              style={{
                background:"linear-gradient(180deg,#07060d 0%,#0d0a18 50%,#07060d 100%)",
                boxShadow:"0 30px 80px -10px rgba(240,180,41,0.18), 0 0 0 1px rgba(240,180,41,0.12)",
                maxHeight:"92vh",
              }}>

              <style>{`
                @keyframes negShine    { 0%{background-position:-220% 0} 100%{background-position:220% 0} }
                @keyframes negPulseDot { 0%,100%{opacity:.55;transform:scale(1)} 50%{opacity:1;transform:scale(1.25)} }
                @keyframes negSpinHalo { 0%{transform:rotate(0)} 100%{transform:rotate(360deg)} }
                @keyframes negParticle { 0%{transform:translateY(0) translateX(0);opacity:0} 10%{opacity:.45} 90%{opacity:.35} 100%{transform:translateY(-200px) translateX(var(--dx,0px));opacity:0} }
                @keyframes negDigitIn  { 0%{transform:translateY(40%) scale(.85);opacity:0;filter:blur(6px)} 60%{filter:blur(0)} 100%{transform:translateY(0) scale(1);opacity:1;filter:blur(0)} }
                @keyframes negTicker   { 0%,22%{transform:translateY(0);opacity:1} 25%,30%{opacity:0} 33%,55%{transform:translateY(-100%);opacity:1} 58%,63%{opacity:0} 66%,88%{transform:translateY(-200%);opacity:1} 91%,96%{opacity:0} 100%{transform:translateY(-300%);opacity:1} }
                @keyframes negSparkRise{ 0%{transform:scaleY(.15);opacity:.3} 100%{transform:scaleY(1);opacity:1} }
                @keyframes negSweep    { 0%{transform:translateX(-120%)} 100%{transform:translateX(220%)} }
                @keyframes negRingPulse{ 0%,100%{filter:drop-shadow(0 0 4px var(--ring))} 50%{filter:drop-shadow(0 0 14px var(--ring))} }
                @keyframes negThumbGlow{ 0%,100%{box-shadow:0 0 0 0 var(--sc-glow,rgba(240,180,41,.6))} 50%{box-shadow:0 0 0 10px transparent} }
                .neg-gold-text{background:linear-gradient(90deg,#f4d06f,#f0b429,#c9911a,#f0b429,#f4d06f);background-size:220% auto;-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;animation:negShine 6s linear infinite}
                .neg-particles{position:absolute;inset:0;pointer-events:none;overflow:hidden}
                .neg-particles span{position:absolute;bottom:-6px;width:3px;height:3px;border-radius:50%;background:rgba(240,180,41,.55);animation:negParticle linear infinite}
                /* Glowing rainbow slider */
                .neg-slider2{appearance:none;-webkit-appearance:none;width:100%;height:10px;border-radius:999px;outline:none;background:linear-gradient(90deg,#ef4444 0%,#f97316 28%,#eab308 52%,#22c55e 80%,#10b981 100%);box-shadow:0 0 0 1px rgba(255,255,255,0.08) inset, 0 2px 24px -4px rgba(240,180,41,.25)}
                .neg-slider2::-webkit-slider-thumb{appearance:none;-webkit-appearance:none;width:26px;height:26px;border-radius:50%;background:radial-gradient(circle at 30% 30%,#fff,#f0b429 60%,#b8871a);border:2px solid #fff;cursor:pointer;box-shadow:0 0 0 4px rgba(240,180,41,.18), 0 6px 22px rgba(240,180,41,.55);transition:transform .1s}
                .neg-slider2::-webkit-slider-thumb:hover{transform:scale(1.1)}
                .neg-slider2::-moz-range-thumb{width:26px;height:26px;border-radius:50%;background:radial-gradient(circle at 30% 30%,#fff,#f0b429 60%,#b8871a);border:2px solid #fff;cursor:pointer;box-shadow:0 0 0 4px rgba(240,180,41,.18), 0 6px 22px rgba(240,180,41,.55)}
                .neg-chip{position:relative;overflow:hidden;transition:transform .15s ease, box-shadow .2s ease}
                .neg-chip::after{content:"";position:absolute;inset:0;background:linear-gradient(110deg,transparent 35%,rgba(255,255,255,.4) 50%,transparent 65%);transform:translateX(-120%)}
                .neg-chip.active::after{animation:negSweep 2.4s ease-in-out infinite}
                .neg-chip:hover{transform:translateY(-1px)}
                .neg-cta-shimmer{position:relative;overflow:hidden}
                .neg-cta-shimmer::after{content:"";position:absolute;inset:0;background:linear-gradient(110deg,transparent 30%,rgba(255,255,255,.55) 50%,transparent 70%);transform:translateX(-120%);animation:negSweep 2.6s ease-in-out infinite}
                .neg-spark{transform-origin:bottom;animation:negSparkRise .7s ease both}
                .neg-ticker-wrap{height:1.1em;line-height:1.1em;overflow:hidden;position:relative}
                .neg-ticker{animation:negTicker 12s ease-in-out infinite}
              `}</style>

              {/* HEADER — dark gold with live pulse */}
              <div className="relative px-6 py-4 flex items-center justify-between"
                style={{ background:"linear-gradient(135deg,#0c0a14 0%,#1a1424 50%,#0c0a14 100%)", borderBottom:"1px solid rgba(240,180,41,0.18)" }}>
                <div className="flex items-center gap-3">
                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[0.55rem] font-bold tracking-[0.18em] uppercase"
                    style={{ background:"rgba(239,68,68,0.15)", color:"#fca5a5", border:"1px solid rgba(239,68,68,0.35)" }}>
                    <span className="w-1.5 h-1.5 rounded-full bg-red-400" style={{ animation:"negPulseDot 1.2s infinite" }} />
                    LIVE
                  </span>
                  <div>
                    <p className="text-[0.62rem] font-bold text-gold-400/80 uppercase tracking-[0.22em]">⚡ AI Bidding Arena</p>
                    <p className="text-white font-semibold text-base leading-tight">{negRoom.name||negRoom.type}</p>
                  </div>
                </div>
                <ModalCloseButton onClose={() => setNegRoom(null)} tone="dark" />
              </div>

              {/* BODY */}
              <div className="relative p-5 space-y-4 overflow-y-auto" style={{ maxHeight:"calc(92vh - 70px)" }}>
                {/* Floating particles (only above floor → green vibe) */}
                {isInstant && (
                  <div className="neg-particles">
                    {Array.from({length:14}).map((_,i)=>(
                      <span key={i} style={{ left:`${(i*7+5)%95}%`, animationDuration:`${4+(i%5)}s`, animationDelay:`${(i*0.4)%4}s`, ["--dx" as any]: `${((i%3)-1)*20}px` }} />
                    ))}
                  </div>
                )}

                {/* Dates + Guests */}
                <div className="grid grid-cols-2 gap-2.5">
                  <div className="rounded-2xl p-3 border" style={{ background:"rgba(255,255,255,0.03)", borderColor:"rgba(240,180,41,0.12)" }}>
                    <p className="text-[0.55rem] font-bold uppercase tracking-[0.2em] mb-1" style={{ color:"rgba(255,255,255,0.4)" }}>Check-in</p>
                    <p className="font-semibold text-white text-sm">{new Date(negIn).toLocaleDateString("en-IN",{weekday:"short",day:"numeric",month:"short"})}</p>
                  </div>
                  <div className="rounded-2xl p-3 border" style={{ background:"rgba(255,255,255,0.03)", borderColor:"rgba(240,180,41,0.12)" }}>
                    <p className="text-[0.55rem] font-bold uppercase tracking-[0.2em] mb-1" style={{ color:"rgba(255,255,255,0.4)" }}>Check-out</p>
                    <p className="font-semibold text-white text-sm">{new Date(negOut).toLocaleDateString("en-IN",{weekday:"short",day:"numeric",month:"short"})}</p>
                  </div>
                </div>
                <div className="flex items-center justify-between rounded-2xl px-3 py-2 border" style={{ background:"rgba(255,255,255,0.03)", borderColor:"rgba(240,180,41,0.12)" }}>
                  <p className="text-xs text-white/70">
                    👥 {globalAdults} adult{globalAdults>1?"s":""}
                    {globalChildren>0?` · ${globalChildren} child`:""}
                    {globalKids>0?` · ${globalKids} kid`:""}
                    {` · ${nights} night${nights>1?"s":""}`}
                  </p>
                  <span className="text-[0.55rem] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full text-gold-400/90 border border-gold-400/25">Locked</span>
                </div>

                {/* v159.14 — Bidder-tier banner removed from customer view.
                    The underlying classification (PREMIUM / STRONG / SMART /
                    CAUTIOUS / LOWBALL) still computes via lib/bidder-score.ts
                    and feeds `autoAcceptMs` scheduling (lines 1128/1512), but
                    the red "Lowball Pattern · HOTEL REVIEW ONLY" badge is no
                    longer rendered — Sachin: this signal is AI-internal,
                    not customer-facing. */}

                {/* MAIN ARENA: Probability ring + Slot-machine number */}
                <div className="relative rounded-3xl p-5 overflow-hidden"
                  style={{
                    background:"radial-gradient(circle at 50% 0%, rgba(240,180,41,0.12), transparent 60%), linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.01))",
                    border:"1px solid rgba(240,180,41,0.22)",
                    boxShadow:`0 0 40px -10px ${prob.track}55`,
                  }}>

                  <div className="flex items-center justify-between mb-3">
                    <p className="text-[0.6rem] font-bold uppercase tracking-[0.25em] neg-gold-text">AI Smart Pricing</p>
                    <span className="text-[0.6rem] font-semibold px-2 py-0.5 rounded-full"
                      style={{ background:`${prob.track}1f`, color:prob.track, border:`1px solid ${prob.track}55` }}>
                      ⏱ {prob.responseTime}
                    </span>
                  </div>

                  <div className="flex items-center justify-center gap-5">
                    {/* SVG Probability Ring */}
                    <div data-tour="neg-prob" className="relative" style={{ width:120, height:120 }}>
                      <svg width={120} height={120} viewBox="0 0 120 120" style={{ animation:"negRingPulse 2.4s ease-in-out infinite", ["--ring" as any]: prob.track }}>
                        <defs>
                          <linearGradient id="negRingG" x1="0%" y1="0%" x2="100%" y2="100%">
                            <stop offset="0%" stopColor={prob.track} stopOpacity="0.9" />
                            <stop offset="100%" stopColor="#f0b429" stopOpacity="0.95" />
                          </linearGradient>
                        </defs>
                        <circle cx="60" cy="60" r={R} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="8" />
                        <circle cx="60" cy="60" r={R} fill="none"
                          stroke="url(#negRingG)" strokeWidth="8" strokeLinecap="round"
                          strokeDasharray={`${dash} ${C-dash}`}
                          transform="rotate(-90 60 60)"
                          style={{ transition:"stroke-dasharray 0.55s cubic-bezier(.32,1.2,.36,1)" }} />
                      </svg>
                      <div className="absolute inset-0 flex flex-col items-center justify-center">
                        <p key={prob.p} className="text-2xl font-extrabold text-white" style={{ animation:"negDigitIn .35s ease both" }}>{prob.p}%</p>
                        <p className="text-[0.55rem] text-white/50 uppercase tracking-widest mt-0.5">match</p>
                      </div>
                    </div>

                    {/* Slot-machine number */}
                    <div className="flex-1 text-center">
                      <p className="text-[0.55rem] uppercase tracking-[0.25em] text-white/40 mb-1">Your Bid · /night</p>
                      <p key={negAmt} className="text-[2.4rem] font-extrabold leading-none neg-gold-text" style={{ animation:"negDigitIn .35s ease both" }}>
                        ₹{negAmt.toLocaleString()}
                      </p>
                      <p className="text-xs text-white/50 mt-1">
                        ₹<span className="font-semibold text-white/80">{totalBid.toLocaleString()}</span> for {nights}n
                      </p>
                      <p className="mt-2 text-[0.62rem] font-bold tracking-wider uppercase" style={{ color: prob.track }}>
                        {prob.label}
                      </p>
                    </div>
                  </div>

                  {/* Slider */}
                  <div data-tour="neg-slider" className="mt-5">
                    <input type="range" min={min} max={max} step={PRICE_STEP} value={negAmt}
                      onChange={e => setNegAmt(snapClamp100(Number(e.target.value), min, max))}
                      className="neg-slider2"
                      style={{ ["--sc-glow" as any]: `${prob.track}99` }} />
                    <div className="flex justify-between mt-1.5 text-[0.62rem] text-white/40 font-mono">
                      <span>₹{min.toLocaleString()}</span>
                      <span>· min</span>
                      <span>₹{max.toLocaleString()}</span>
                    </div>
                  </div>

                  {/* AI Ticker (rotates 4 tips) */}
                  <div data-tour="neg-info" className="mt-4 px-3 py-2 rounded-xl border"
                    style={{ background:"rgba(0,0,0,0.35)", borderColor:"rgba(240,180,41,0.18)" }}>
                    <div className="flex items-center gap-2">
                      <span className="text-[0.55rem] font-bold tracking-widest uppercase neg-gold-text shrink-0">🤖 Live AI</span>
                      <div className="neg-ticker-wrap flex-1 text-[0.7rem] text-white/80">
                        <div className="neg-ticker">
                          {aiTips.concat(aiTips[0]).map((t,i)=>(
                            <div key={i} className="truncate">{t}</div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Quick chips */}
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { label: "💰 Save Big",   pct: 0.82, sub: "Hotel reviews" },
                    { label: "⭐ Smart",      pct: 0.90, sub: "Recommended"   },
                    { label: "⚡ Instant",    pct: 1.00, sub: "Auto-confirms" },
                  ].map(s => {
                    // v129 — every quick-pick is a ₹100 multiple. The slider's
                    // step is also 100, so a chip-tap always lands on a stop
                    // the slider can re-select cleanly.
                    const amt = snapClamp100(floor * s.pct, min, max);
                    const active = negAmt === amt;
                    return (
                      <button key={s.label} onClick={() => setNegAmt(amt)}
                        className={`neg-chip rounded-2xl p-2.5 text-center ${active?"active":""}`}
                        style={{
                          background: active ? "linear-gradient(135deg,#b8871a,#f0b429,#c9911a)" : "rgba(255,255,255,0.04)",
                          border: `1px solid ${active?"rgba(240,180,41,.6)":"rgba(255,255,255,.08)"}`,
                          boxShadow: active ? "0 6px 22px rgba(240,180,41,.35)" : "none",
                        }}>
                        <p className={`text-[0.62rem] font-bold leading-tight ${active?"text-luxury-900":"text-white/90"}`}>{s.label}</p>
                        <p className={`text-sm font-extrabold mt-0.5 ${active?"text-luxury-900":"text-white"}`}>₹{amt.toLocaleString()}</p>
                        <p className={`text-[0.5rem] mt-0.5 ${active?"text-luxury-800":"text-white/40"}`}>{s.sub}</p>
                      </button>
                    );
                  })}
                </div>

                {/* v159.14 — Recent Accepts sparkline removed from customer
                    view. The 14-day bar chart + avg accepted price + the
                    "Too low — hotel will almost certainly decline" tip were
                    all AI-internal signals leaking to the customer. The data
                    (recentAvg, sparkBars, prob.tip) still computes — feeds
                    the LIVE AI ticker rotation above + the AI smart-pricing
                    quick-chips below — but the visual chart is gone. */}

                {/* StayPoints teaser */}
                <div className="flex items-center gap-3 rounded-2xl px-4 py-2.5"
                  style={{ background:"linear-gradient(90deg,rgba(240,180,41,0.12),rgba(240,180,41,0.04))", border:"1px solid rgba(240,180,41,0.22)" }}>
                  <span className="text-lg">💎</span>
                  <div className="flex-1">
                    <p className="text-[0.7rem] font-semibold text-gold-300">Win this bid → earn <span className="font-extrabold">{stayPoints}</span> StayPoints</p>
                    <p className="text-[0.55rem] text-white/40">Redeemable as ₹{stayPoints} cashback on future stays</p>
                  </div>
                </div>

                {/* Below-floor notice */}
                {isBelow && (
                  <div className="rounded-xl p-3 border"
                    style={{ background:"rgba(245,158,11,0.08)", borderColor:"rgba(245,158,11,0.3)" }}>
                    <p className="text-[0.7rem] text-amber-200 leading-relaxed">
                      💡 Your ₹{negAmt.toLocaleString()} is below the hotel's minimum.
                      We'll forward your preferred price — hotel may counter or accept on your terms.
                      <span className="text-white/40"> No charge unless accepted.</span>
                    </p>
                  </div>
                )}

                {/* Submit */}
                <button data-tour="neg-submit" onClick={handleNegotiate} disabled={negLoading || !negIn || !negOut || negIn >= negOut}
                  className="neg-cta-shimmer w-full py-4 rounded-2xl font-extrabold text-base tracking-wide disabled:opacity-40 transition-transform active:scale-[0.99]"
                  style={{
                    background: isInstant
                      ? "linear-gradient(135deg,#10b981 0%,#f0b429 50%,#10b981 100%)"
                      : "linear-gradient(135deg,#b8871a 0%,#f0b429 48%,#fbd26a 60%,#c9911a 100%)",
                    color: "#0c0a14",
                    boxShadow: isInstant
                      ? "0 12px 32px rgba(16,185,129,0.4), 0 0 0 1px rgba(255,255,255,0.15) inset"
                      : "0 12px 32px rgba(240,180,41,0.4), 0 0 0 1px rgba(255,255,255,0.15) inset",
                  }}>
                  {negLoading
                    ? "⏳ Placing your bid…"
                    : isInstant
                      ? `⚡ Instant Confirm · ₹${totalBid.toLocaleString()}`
                      : `🎯 Place Bid · ₹${negAmt.toLocaleString()}/night`}
                </button>
                <p className="text-[0.6rem] text-center text-white/30 -mt-1">
                  {isInstant ? "Paid via Razorpay · 100% refundable if hotel rejects" : "No payment now · Hotel will counter or accept"}
                </p>
              </div>
            </div>
          </div>
        );
      })()}
      {negSuccess && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setNegRoom(null)}>
          <div className="bg-white max-w-sm w-full mx-4 rounded-3xl shadow-luxury-lg p-8 text-center" onClick={e => e.stopPropagation()}>
            <div className="w-16 h-16 rounded-full bg-gold-100 flex items-center justify-center mx-auto mb-5"><span className="text-3xl">{negAuto ? "🎉" : "✅"}</span></div>
            <h3 className="font-display font-light text-luxury-900 text-2xl mb-2">{negAuto ? "Booking Confirmed!" : "Bid Submitted!"}</h3>
            <p className="text-luxury-400 text-sm mb-6">{negAuto ? "The hotel confirmed your bid. Check My Bookings." : "The hotel will review your offer and respond soon. You'll be notified."}</p>
            <div className="flex gap-3">
              <button onClick={() => setNegRoom(null)} className="flex-1 py-3 rounded-2xl border border-luxury-200 text-luxury-600 text-sm">Close</button>
              <Link href={negAuto ? "/bookings" : "/my-bids"} className="flex-1 py-3 rounded-2xl btn-luxury text-sm text-center">{negAuto ? "My Bookings" : "My Bids"}</Link>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════
          FLASH BOOKING SUCCESS
      ══════════════════════════════════════════ */}
      {flashBookSuccess && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setFlashBookSuccess(false)}>
          <div className="bg-white max-w-sm w-full mx-4 rounded-3xl shadow-luxury-lg p-8 text-center"
            onClick={(e) => e.stopPropagation()}>
            <div className="w-16 h-16 rounded-full bg-gold-100 flex items-center justify-center mx-auto mb-5">
              <span className="text-3xl">🎉</span>
            </div>
            <h3 className="font-display font-light text-luxury-900 text-2xl mb-2">Booking Confirmed!</h3>
            <p className="text-luxury-400 text-sm leading-relaxed mb-2">
              Your flash deal booking at <span className="font-semibold text-luxury-700">{hotel.name}</span> is confirmed.
            </p>
            <p className="text-gold-600 font-bold text-lg mb-6">₹{flashGrandTotal.toLocaleString()} · {flashNights} night{flashNights > 1 ? "s" : ""}</p>
            <div className="flex gap-3">
              <button onClick={() => setFlashBookSuccess(false)}
                className="flex-1 py-3 rounded-2xl border border-luxury-200 text-luxury-600 text-sm font-medium">
                Close
              </button>
              <Link href="/bookings" className="flex-1 py-3 rounded-2xl btn-luxury text-sm text-center">
                My Bookings
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════
          NORMAL BID MODAL
      ══════════════════════════════════════════ */}
      {bidRoom && !bidSuccess && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={() => setBidRoom(null)}>
          <div className="bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl shadow-luxury-lg p-6"
            onClick={(e) => e.stopPropagation()}>
            <div className="w-12 h-1 bg-gradient-to-r from-gold-500 to-gold-300 rounded-full mx-auto mb-6" />
            <h3 className="font-display font-light text-luxury-900 text-2xl mb-1">Place Your Bid</h3>
            <p className="text-sm text-luxury-400 mb-6">
              {bidRoom.name || bidRoom.type} at <span className="text-luxury-700 font-medium">{hotel.name}</span>
            </p>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div>
                <label className="text-xs font-semibold text-luxury-500 uppercase tracking-wider block mb-1.5">Check-in</label>
                <button
                  type="button"
                  onClick={() => openCalendar({
                    mode: "checkIn",
                    checkIn, checkOut,
                    onApply: ({ checkIn: ci, checkOut: co }) => { setCheckIn(ci); setCheckOut(co); },
                  })}
                  className="input-luxury text-sm w-full text-left flex items-center justify-between"
                >
                  <span className={checkIn ? "text-luxury-900 font-semibold" : "text-luxury-400"}>
                    {checkIn
                      ? new Date(checkIn).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })
                      : "Pick date"}
                  </span>
                  <span className="text-gold-500 text-base">📅</span>
                </button>
              </div>
              <div>
                <label className="text-xs font-semibold text-luxury-500 uppercase tracking-wider block mb-1.5">Check-out</label>
                <button
                  type="button"
                  onClick={() => openCalendar({
                    mode: "checkOut",
                    checkIn, checkOut,
                    onApply: ({ checkIn: ci, checkOut: co }) => { setCheckIn(ci); setCheckOut(co); },
                  })}
                  className="input-luxury text-sm w-full text-left flex items-center justify-between"
                >
                  <span className={checkOut ? "text-luxury-900 font-semibold" : "text-luxury-400"}>
                    {checkOut
                      ? new Date(checkOut).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })
                      : "Pick date"}
                  </span>
                  <span className="text-gold-500 text-base">📅</span>
                </button>
              </div>
            </div>
            <div className="mb-4">
              <label className="text-xs font-semibold text-luxury-500 uppercase tracking-wider block mb-1.5">Your Bid Amount (₹)</label>
              <input type="number" value={bidAmount} onChange={(e) => setBidAmount(e.target.value)}
                placeholder={`Floor ₹${bidRoom.floorPrice} — MRP ₹${bidRoom.mrp}`}
                className="input-luxury text-lg font-bold" />
              {bidAmount && parseFloat(bidAmount) < bidRoom.floorPrice && (
                <p className="text-xs text-red-500 mt-1.5">Minimum bid is ₹{bidRoom.floorPrice}</p>
              )}
            </div>
            <div className="mb-6">
              <label className="text-xs font-semibold text-luxury-500 uppercase tracking-wider block mb-1.5">Message (optional)</label>
              <textarea value={bidMsg} onChange={(e) => setBidMsg(e.target.value)}
                placeholder="e.g. Anniversary trip, need the best deal…"
                className="input-luxury text-sm resize-none" rows={2} />
            </div>
            <div className="flex gap-3">
              <button onClick={() => setBidRoom(null)}
                className="flex-1 py-3 rounded-2xl border border-luxury-200 text-luxury-600 font-medium hover:bg-luxury-50 transition text-sm">
                Cancel
              </button>
              <button onClick={handleBid}
                disabled={bidLoading || !bidAmount || !checkIn || !checkOut || parseFloat(bidAmount) < bidRoom.floorPrice}
                className="flex-1 py-3 rounded-2xl btn-luxury disabled:opacity-40 text-sm">
                {bidLoading ? "Submitting…" : "Submit Bid"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── v123.1 — Mobile-only sticky Check Availability pill.
          Hidden when sticky desktop rail is shown (≥1100px), hidden
          while the calendar / booking modals are open. Uses the SAME
          existing flow as the desktop rail's button — scrolls to the
          existing #availability-picker, OR if dates already set, opens
          BookNow on the cheapest room (matches openBookNow handler).
          NO CTA RULE CHANGE — purely a discoverability surface. */}
      {/* v125.2 — also hide during success modals (Bid Submitted / Booking
          Confirmed / Bid Placed) so the floating CTA pill doesn't peek
          through and tempt a second tap. Some success flows clear their
          *Room state on submit (bidSuccess / bnSuccess), so without these
          guards the floating CTA would re-appear behind the celebration. */}
      {hotel && !inPageCtaVisible && !calCfg.open && !flashBookOpen && !bnRoom && !negRoom && !pickerModal && !review && !bidSuccess && !bnSuccess && !negSuccess && !flashBookSuccess && (
        <div className="hx-mobile-cta-wrap" aria-hidden={false}>
          <button
            type="button"
            className="hx-mobile-cta-pill"
            onClick={() => {
              if (datesSelected && hotel.rooms?.length) {
                // Dates already picked — go straight to Book Now on cheapest room
                const cheapest = hotel.rooms.reduce((acc: any, r: any) =>
                  (!acc || (r.floorPrice || 99999) < (acc.floorPrice || 99999)) ? r : acc, null);
                if (cheapest) {
                  withBackendAuth(() => openBookNow(cheapest));
                  return;
                }
              }
              // Otherwise just scroll to the availability picker
              const el = document.getElementById("availability-picker");
              el?.scrollIntoView({ behavior: "smooth", block: "center" });
            }}
            aria-label={datesSelected ? "Book Now" : "Check availability"}
          >
            <span className="pulse" />
            {datesSelected
              ? `Book Now · ₹${(lowestForRibbon || 0).toLocaleString()}/night`
              : "Check availability →"}
          </button>
        </div>
      )}

      {/* ══════════════════════════════════════════
          BOOKING REVIEW (Phase 2) — sits between user confirm and Razorpay.
          Lets customer Pay-Full / Hold for 24h / Pay-Hold + Settle-At-Hotel.
      ══════════════════════════════════════════ */}
      {review && (
        <BookingReview {...review} open onClose={() => setReview(null)} />
      )}

      {/* ── Floating picker modal — opens when user taps Book Now/Negotiate without dates ── */}
      {pickerModal && (
        <div
          className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm modal-backdrop p-0 sm:p-4"
          onClick={() => setPickerModal(null)}
        >
          <div
            className="picker-hitech picker-popin w-full sm:max-w-md max-h-[92vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-5">
              <div className="flex items-start justify-between gap-3 mb-4 relative z-[2]">
                <div className="flex items-center gap-2.5">
                  <span className="w-10 h-10 rounded-full bg-gradient-to-br from-gold-400 to-amber-600 text-white flex items-center justify-center text-base shadow-gold"
                        style={{ animation: "lux-floaty 3s ease-in-out infinite" }}>🔍</span>
                  <div>
                    <h3 className="font-bold text-luxury-900 text-[1rem] tracking-tight leading-tight">
                      {pickerModal.intent === "book" ? "Pick dates to Book Now" : "Pick dates to Negotiate"}
                    </h3>
                    <p className="text-[0.62rem] text-luxury-500 tracking-widest uppercase font-semibold flex items-center gap-1 mt-0.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> {pickerModal.room?.name || pickerModal.room?.type || "Room"}
                    </p>
                  </div>
                </div>
                <ModalCloseButton onClose={() => setPickerModal(null)} tone="light" />
              </div>

              {/* Dates */}
              <div className="grid grid-cols-2 gap-3 mb-3 relative z-[2]">
                <button
                  type="button"
                  onClick={() => openCalendar({
                    mode: "checkIn",
                    checkIn: globalCheckIn, checkOut: globalCheckOut,
                    onApply: ({ checkIn: ci, checkOut: co }) => { setGlobalCheckIn(ci); setGlobalCheckOut(co); },
                  })}
                  className="picker-tile block text-left"
                >
                  <p className="text-[0.6rem] font-bold text-luxury-500 uppercase tracking-widest mb-1">📅 Check-in</p>
                  <span className={`block text-sm font-semibold ${globalCheckIn ? "text-luxury-900" : "text-luxury-400"}`}>
                    {globalCheckIn
                      ? new Date(globalCheckIn).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })
                      : "Add date"}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => openCalendar({
                    mode: "checkOut",
                    checkIn: globalCheckIn, checkOut: globalCheckOut,
                    onApply: ({ checkIn: ci, checkOut: co }) => { setGlobalCheckIn(ci); setGlobalCheckOut(co); },
                  })}
                  className="picker-tile block text-left"
                >
                  <p className="text-[0.6rem] font-bold text-luxury-500 uppercase tracking-widest mb-1">📅 Check-out</p>
                  <span className={`block text-sm font-semibold ${globalCheckOut ? "text-luxury-900" : "text-luxury-400"}`}>
                    {globalCheckOut
                      ? new Date(globalCheckOut).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })
                      : "Add date"}
                  </span>
                </button>
              </div>

              {/* Guests */}
              <div className="grid grid-cols-3 gap-3 mb-4 relative z-[2]">
                <div className="picker-tile">
                  <p className="text-[0.58rem] font-bold text-luxury-500 uppercase tracking-widest mb-2">👤 Adults</p>
                  <div className="flex items-center justify-between">
                    <button type="button" onClick={() => setGlobalAdults(Math.max(1, globalAdults - 1))} className="picker-step">−</button>
                    <span className="font-black text-luxury-900 text-lg">{globalAdults}</span>
                    <button type="button" onClick={() => setGlobalAdults(Math.min(8, globalAdults + 1))} className="picker-step">+</button>
                  </div>
                </div>
                <div className="picker-tile">
                  <p className="text-[0.58rem] font-bold text-luxury-500 uppercase tracking-widest mb-2">👦 Children</p>
                  <div className="flex items-center justify-between">
                    <button type="button" onClick={() => setGlobalChildren(Math.max(0, globalChildren - 1))} className="picker-step">−</button>
                    <span className="font-black text-luxury-900 text-lg">{globalChildren}</span>
                    <button type="button" onClick={() => setGlobalChildren(Math.min(6, globalChildren + 1))} className="picker-step">+</button>
                  </div>
                </div>
                <div className="picker-tile">
                  <p className="text-[0.58rem] font-bold text-luxury-500 uppercase tracking-widest mb-2">🧒 Kids</p>
                  <div className="flex items-center justify-between">
                    <button type="button" onClick={() => setGlobalKids(Math.max(0, globalKids - 1))} className="picker-step">−</button>
                    <span className="font-black text-luxury-900 text-lg">{globalKids}</span>
                    <button type="button" onClick={() => setGlobalKids(Math.min(6, globalKids + 1))} className="picker-step">+</button>
                  </div>
                </div>
              </div>

              <div className="relative z-[2]">
                <button
                  disabled={!globalCheckIn || !globalCheckOut}
                  onClick={resumePickerIntent}
                  className="btn-3d btn-3d-gold w-full"
                >
                  {(!globalCheckIn || !globalCheckOut)
                    ? "Pick dates above ↑"
                    : pickerModal.intent === "book" ? "Continue to Book Now →" : "Continue to Negotiate →"}
                </button>
                <p className="text-center text-[0.6rem] text-luxury-500 mt-2 tracking-wide">
                  AI engine finds the best rate for your exact dates
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Luxury Calendar (per-day live pricing) — shared by every date trigger on this page ── */}
      <LuxuryCalendar
        open={calCfg.open}
        mode={calCfg.mode}
        checkIn={calCfg.checkIn}
        checkOut={calCfg.checkOut}
        minCheckIn={calCfg.minCheckIn}
        rooms={calCfg.rooms ?? hotel?.rooms ?? []}
        pricingMode={calCfg.pricingMode}
        headerBanner={calCfg.headerBanner}
        city={hotel?.city || "Mussoorie"}
        onClose={closeCalendar}
        onApply={(r) => calCfg.onApply(r)}
      />

      {bidSuccess && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={() => setBidSuccess(false)}>
          <div className="bg-white max-w-sm w-full mx-4 rounded-3xl shadow-luxury-lg p-8 text-center"
            onClick={(e) => e.stopPropagation()}>
            <div className="w-16 h-16 rounded-full bg-gold-100 flex items-center justify-center mx-auto mb-5">
              <span className="text-3xl">🎉</span>
            </div>
            <h3 className="font-display font-light text-luxury-900 text-2xl mb-2">Bid Placed!</h3>
            <p className="text-luxury-400 text-sm leading-relaxed mb-6">
              The hotel will review your offer and respond soon.
            </p>
            <button onClick={() => setBidSuccess(false)} className="btn-luxury w-full py-3 rounded-2xl text-sm">Done</button>
          </div>
        </div>
      )}

      {/* v132.9 — Floating back-to-top button (desktop only, surfaces
          after 600px scroll, hides while modals are open) */}
      <BackToTopButton />
    </div>
  );
}

