"use client";
// ════════════════════════════════════════════════════════════════════════
// v124 — Place-Bid editorial redesign ("Auction Pit").
//
// Mirrors the v123 hotel-page editorial mosaic style + adds gambling-style
// flair appropriate for a reverse auction:
//   - Live "Recent wins" ticker pulled from real ACCEPTED bids
//   - Vegas-style SVG probability dial (replaces flat % bar)
//   - Hot-streak / momentum pill scoped to the picked city
//   - Animated stats ribbon ("tonight's auctions", "hotels listening", "avg
//     accept time") all read from real bids + bid_requests tables
//   - Premium shimmer step bar
//   - Cinematic Step 4 review screen with probability hero
//   - Casino "winners' circle" success screen
//
// Submit handler + every CTA rule remains BYTE-IDENTICAL to v122/v123. The
// reverse-auction backend flow (createBidRequest → placeBid → catch
// floor-fallback → store dates) is preserved completely. Only the surrounding
// UI shifted.
// ════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import LuxuryCalendar from "@/components/LuxuryCalendar";
// v201 — shared premium guest-count picker. Animated figure icons morph
// with the value (1=👤, 2=👫, 3-4=👨‍👩‍👧, 5+=group) + directional value-roll.
// Replaces the inline <Counter> previously declared in this file.
import PremiumGuestPicker, { type GuestKind } from "@/components/PremiumGuestPicker";
// One-active-bid-per-(customer × city) conflict UI. /bid broadcasts to many
// hotels in the same city, so 409 fires per-hotel-call; we surface the FIRST
// conflict and let the customer update the existing bid budget instead.
import ActiveBidConflictSheet, { type BidConflict } from "@/components/ActiveBidConflictSheet";
// v122.2 — auto-scroll the next form section into view on every selection
// so the user never has to manually scroll between fields in this 4-step
// wizard. See lib/auto-next-scroll.ts for the helper.
import { scrollToAutoNext } from "@/lib/auto-next-scroll";
// v129 — every customer-facing bid amount snaps to a ₹100 multiple. Same
// helpers power the Negotiate modal slider + partner counter slider so a
// preset / drag / type-in input all land on the same indivisible billing unit.
import { snap100, PRICE_STEP, PRICE_MIN } from "@/lib/price-snap";
// v164 — the same demand engine the hotel page / partner panel use.
// Drives the auction "live price" reference so the bid result is
// always BELOW StayBid's own dynamic rate (and therefore below every
// competitor — that is the platform's lowest-price promise).
import { calculateDynamicPrice } from "@/lib/ai-pricing";
// v139 — auto-fires the 4-step reverse-auction tour on first visit.
// Hook waits until [data-autonext="destination"] renders.
import { usePageTour } from "@/lib/tutorial/usePageTour";
// v170 — shared platform catalog. The id the customer picks here is the
// same id the hotel stores (property_type / meal_plans / addon_services
// / rooms.type) — so a pick and an offer always line up.
import {
  PROPERTY_TYPES, PROPERTY_TYPE_MAP,
  ROOM_CATEGORIES, ROOM_CATEGORY_MAP, ROOM_CATEGORY_MULT,
  MEAL_PLANS as CAT_MEAL_PLANS, MEAL_PLAN_MAP,
  ADDON_SERVICES, ADDON_SERVICE_MAP,
} from "@/lib/catalog";

// v181 — Curated customer-facing pick-lists for /bid. Catalog in
// lib/catalog.ts stays the full hotel-side set (partner panel +
// onboarding still declare from the wide list). Here we present only
// the customer-facing categories Sachin curated, with refined icons.
// IDs match lib/catalog.ts so filter + DB matching stays intact.

// Property types — 11 customer-facing picks (incl. "any" pseudo).
// Icons curated for premium feel (no homely 🏚️ for Bungalow etc).
// v186 — Phase 4B: "Any" pseudo-option dropped per Sachin's rule —
// customer MUST pick at least 3 specific property types so the
// auction targets a curated spread, not a fire-everywhere broadcast.
const BID_PROPERTY_PICK: { id: string; label: string; icon: string }[] = [
  { id: "hotel",       label: "Hotel",        icon: "🛎" },
  { id: "resort",      label: "Resort",       icon: "🌴" },
  { id: "villa",       label: "Villa",        icon: "🏡" },
  { id: "cottage",     label: "Cottage",      icon: "🛖" },
  { id: "guest_house", label: "Guest House",  icon: "🏠" },
  { id: "homestay",    label: "Homestay",     icon: "🏘" },
  { id: "camp",        label: "Camp / Glamping", icon: "⛺" },
  { id: "bungalow",    label: "Bungalow",     icon: "🏯" },
  { id: "hostel",      label: "Hostel",       icon: "🎒" },
  { id: "treehouse",   label: "Treehouse",    icon: "🌳" },
];

// Room categories the customer can bid for — 7 curated picks with
// refined icons mirroring the property silhouette. Partner-only
// "custom" name excluded here.
const BID_ROOM_PICK: { id: string; label: string; icon: string }[] = [
  { id: "standard",     label: "Standard",        icon: "🛏" },
  { id: "super_deluxe", label: "Super Deluxe",    icon: "✨" },
  { id: "family",       label: "Family Room",     icon: "👨‍👩‍👧" },
  { id: "suite",        label: "Suite",           icon: "👑" },
  { id: "cottage",      label: "Cottage",         icon: "🛖" },
  { id: "villa",        label: "Private Villa",   icon: "🏡" },
  { id: "tent",         label: "Luxury Tent",     icon: "⛺" },
];
// Legacy alias — still consumed by the room-category multiplier
// lookup and the filter pipeline elsewhere in this file.
const BID_ROOM_CATEGORIES = BID_ROOM_PICK.map((p) => ({ id: p.id, label: p.label }));

// Add-on services — curated subset, dropped: doctor_on_call,
// candlelight_dinner, room_decoration, spa_session, trekking_guide,
// honeymoon_package (per Sachin).
const BID_ADDON_PICK = ADDON_SERVICES.filter((a) => ![
  "doctor_on_call", "candlelight_dinner", "room_decoration",
  "spa_session", "trekking_guide", "honeymoon_package",
].includes(a.id));
// Emoji per meal plan id — display only.
const MEAL_EMOJI: Record<string, string> = {
  room_only: "🏨", breakfast: "☕", half_board: "🍽️", full_board: "🍱", all_inclusive: "🎉",
};

/* ── AI City Intelligence ──────────────────────────────────────── */
const CITY_DATA: Record<string, { emoji: string; avg: number; demand: "Very High" | "High" | "Medium" | "Low"; demandColor: string; tip: string; state: string; tags: string[] }> = {
  Mussoorie:  { emoji: "🏔️", avg: 3200, demand: "High",      demandColor: "text-orange-600 bg-orange-50 border-orange-200", tip: "Weekend & holiday peak — bid early for best rates!",  state: "Uttarakhand",       tags: ["Hill Station", "Honeymoon", "Nature"] },
  Dhanaulti:  { emoji: "🌲", avg: 2800, demand: "Medium",    demandColor: "text-amber-600  bg-amber-50  border-amber-200",  tip: "Weekdays offer up to 25% better deals here.",         state: "Uttarakhand",       tags: ["Forest", "Peaceful", "Couples"] },
  Rishikesh:  { emoji: "🕉️", avg: 2400, demand: "High",      demandColor: "text-orange-600 bg-orange-50 border-orange-200", tip: "Yoga retreat season — adventure packages popular.",   state: "Uttarakhand",       tags: ["Adventure", "Spiritual", "Yoga"] },
  Shimla:     { emoji: "❄️", avg: 3500, demand: "Very High", demandColor: "text-red-600    bg-red-50    border-red-200",    tip: "Peak hill-station demand — book ahead for savings.",  state: "Himachal Pradesh",  tags: ["Snow", "Heritage", "Family"] },
  Manali:     { emoji: "🏂", avg: 3800, demand: "Very High", demandColor: "text-red-600    bg-red-50    border-red-200",    tip: "Adventure season — premium pricing, bid smart.",      state: "Himachal Pradesh",  tags: ["Skiing", "Adventure", "Honeymoon"] },
  Dehradun:   { emoji: "🌿", avg: 2200, demand: "Low",       demandColor: "text-emerald-600 bg-emerald-50 border-emerald-200", tip: "Low season — great deals & immediate accepts!",    state: "Uttarakhand",       tags: ["Gateway", "Business", "Budget"] },
};

/* ── Room & Experience Options ─────────────────────────────────── */
// v170 — room categories now come from lib/catalog (BID_ROOM_CATEGORIES).

// v186 — Phase 4B: bed + view get matching icons so they look at home
// in the box-less bx-pick-grid alongside property + room.
const BED_TYPES = [
  { id: "king",   label: "King Bed",   icon: "👑" },
  { id: "twin",   label: "Twin Beds",  icon: "🛏" },
  { id: "double", label: "Double Bed", icon: "🛌" },
  { id: "any",    label: "Any Bed",    icon: "✦"  },
];

const VIEW_PREFS_PICK = [
  { id: "Mountain", label: "Mountain", icon: "⛰" },
  { id: "Forest",   label: "Forest",   icon: "🌲" },
  { id: "Garden",   label: "Garden",   icon: "🌷" },
  { id: "Pool",     label: "Pool",     icon: "🏊" },
  { id: "City",     label: "City",     icon: "🏙" },
  { id: "Any",      label: "Any",      icon: "✦"  },
];

// v170 — meal plans come from lib/catalog (CAT_MEAL_PLANS).

const OCCASIONS = [
  { id: "none",        label: "Regular Stay",  icon: "🏨" },
  { id: "honeymoon",   label: "Honeymoon",     icon: "💑" },
  { id: "anniversary", label: "Anniversary",   icon: "💝" },
  { id: "birthday",    label: "Birthday",      icon: "🎂" },
  { id: "family",      label: "Family Trip",   icon: "👨‍👩‍👧" },
  { id: "business",    label: "Business",      icon: "💼" },
];

/* ── AI Bid Strength Calculator ────────────────────────────────── */
// v180 — Real acceptance probability driven by the platform's dynamic
// price engine (lib/ai-pricing.ts) + the room category multiplier from
// the catalog. Previously this used only a flat per-city average — which
// ignored season, day-of-week, holidays, monsoon, and the customer's
// room-tier selection, producing the same probability for a deluxe in
// June vs a suite in December. Now:
//   expectedMarket = livePrice(cityAvg, checkIn, city) × roomCategoryMult
//   r = customerBudget / expectedMarket
// Same tier buckets, but the comparator is honest.
function calcBidStrength(
  budget: number,
  cityAvg: number,
  city: string,
  checkInISO: string,
  roomCategoryIds: string[],
) {
  // Live market price for THIS check-in + THIS city, snapped through the
  // engine's full demand chain (season × DoW × event × lead × city ×
  // micro × school × monsoon × long-weekend).
  let livePrice = cityAvg;
  try {
    if (checkInISO) {
      const r = calculateDynamicPrice(cityAvg, checkInISO, city);
      if (r && Number.isFinite(r.price) && r.price > 0) livePrice = r.price;
    }
  } catch { /* engine guards w/ ratio fallback; keep cityAvg */ }

  // Room category multiplier — AVERAGE of selected categories so the
  // probability stays in sync with the AI Smart Presets (which also use
  // the average — see line ~501 below). MAX would over-inflate the
  // expected market price when a customer ticks "Standard + Suite",
  // making the Premium preset look like a Long Shot even at ₹2,700
  // ABOVE the city average — exactly the v181.1 bug Sachin caught.
  let roomMult = 1.0;
  if (roomCategoryIds.length) {
    let sum = 0;
    for (const id of roomCategoryIds) sum += (ROOM_CATEGORY_MULT[id] || 1);
    roomMult = sum / roomCategoryIds.length;
  }
  const expectedMarket = Math.max(1, livePrice * roomMult);
  const r = budget / expectedMarket;

  if (r >= 1.00) return { pct: 96, label: "Instant Accept", color: "#7F9269", tier: "Instant Win",      bar: "bg-emerald-500", tip: "Hotels will compete aggressively. Auto-confirms instantly.",         responseTime: "Auto-confirms instantly" };
  if (r >= 0.90) return { pct: 78, label: "Very Strong",    color: "#9DAD8F", tier: "Very Strong",      bar: "bg-emerald-400", tip: "Excellent bid — most 4★+ hotels will accept.",                       responseTime: "Confirms in ~30 min"    };
  if (r >= 0.80) return { pct: 60, label: "Strong",         color: "#C9A66B", tier: "Strong",           bar: "bg-gold-500",    tip: "Good chance — 3–5 hotels likely to respond with a counter or yes.",  responseTime: "Response in ~1 hr"      };
  if (r >= 0.70) return { pct: 42, label: "Moderate",       color: "#D4AF7F", tier: "Moderate",         bar: "bg-amber-500",   tip: "Some hotels may counter with a slightly higher rate.",               responseTime: "Response in 2–3 hrs"    };
  if (r >= 0.60) return { pct: 25, label: "Low",            color: "#D49583", tier: "Long Shot",        bar: "bg-orange-500",  tip: "Hotels may counter — be ready to negotiate. Try +₹200/night?",       responseTime: "Response in 4–6 hrs"    };
  return              { pct: 10,  label: "Very Low",        color: "#A85B4E", tier: "Very Long Shot",   bar: "bg-red-500",     tip: "Consider increasing the budget for better responses.",               responseTime: "Unlikely to receive bids" };
}

function numNights(ci: string, co: string) {
  if (!ci || !co) return 0;
  return Math.max(0, Math.round((new Date(co).getTime() - new Date(ci).getTime()) / 86400000));
}

/* ── CountUp hook — Vegas-style number reveal ──────────────────── */
function useCountUp(target: number, duration = 800) {
  const [val, setVal] = useState(0);
  const prev = useRef(0);
  useEffect(() => {
    if (!Number.isFinite(target) || target < 0) { setVal(0); return; }
    const start = performance.now();
    const from = prev.current;
    let raf = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / duration);
      const e = 1 - Math.pow(1 - k, 3);
      setVal(Math.round(from + (target - from) * e));
      if (k < 1) raf = requestAnimationFrame(tick);
      else prev.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return val;
}

/* ── Count-up component — Vegas reveal for the success screen ──── */
function WinCount({ value }: { value: number }) {
  const v = useCountUp(value, 1100);
  return <>{v}</>;
}

/* ── v162 — celebration confetti pieces (deterministic) ─────────── */
const CONFETTI_COLORS = ["#C9A66B", "#D9BE82", "#D49583", "#9DAD8F", "#E7CFA0", "#B18943"];
const CONFETTI = Array.from({ length: 24 }, (_, i) => ({
  left:  (i * 4.37 + (i % 4) * 6) % 100,
  color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
  delay: (i % 8) * 0.21,
  dur:   2.6 + (i % 5) * 0.55,
  w:     i % 3 === 0 ? 7 : 9,
  h:     i % 3 === 0 ? 7 : 15,
  round: i % 3 === 0,
}));

/* ── v164 — Live auction bid card ───────────────────────────────
   • dealPrice (`bid.amount`) is the auction result — always BELOW the
     hotel's own live rate, so below every competitor. Card shows the
     saving vs the market (MRP) rate.
   • An ACCEPTED card's timer is the HOLD WINDOW — how long that price
     is locked for the customer to book.
   • A non-accepted hotel COUNTERED at its floor (customer's ceiling was
     below the floor) — still a real deal vs market, just not the
     customer's number.
   • Every card is tappable → opens that hotel's page.
   ──────────────────────────────────────────────────────────────── */
const LIVE_WINDOW_MS = 15 * 60 * 1000; // accepted-offer hold window

function LiveBidCard({ bid, launchTs, nowTs, idx, onOpen, onGrab }: {
  bid: any; launchTs: number; nowTs: number; idx: number;
  onOpen: (hotelId: string) => void;
  // v183 — Phase 2 B6: explicit "Pay Now & Grab" route. Parent owns the
  // routing logic (/my-bids#bid-<id>) so the LiveBidCard stays generic.
  onGrab?: (bidId: string) => void;
}) {
  const status    = String(bid.status || "PENDING").toUpperCase();
  const accepted  = !!bid.accepted || status === "ACCEPTED" || status === "CONFIRMED";
  const rejected  = !accepted && (status === "REJECTED" || status === "EXPIRED");
  const countered = !accepted && !rejected; // any non-accepted = floor counter

  const amount    = Number(bid.amount) || 0;
  const mrp       = Number(bid.mrp) || 0;
  const saved     = mrp > amount ? mrp - amount : 0;
  const savedPct  = mrp > 0 ? Math.round((saved / mrp) * 100) : 0;

  const elapsed   = Math.max(0, nowTs - launchTs);
  const remaining = Math.max(0, LIVE_WINDOW_MS - elapsed);
  const expired   = accepted && remaining <= 0;
  const mm = Math.floor(remaining / 60000);
  const ss = Math.floor((remaining % 60000) / 1000);
  const holdLeftPct = Math.max(0, Math.min(100, (remaining / LIVE_WINDOW_MS) * 100));

  const cls = expired ? "is-expired"
    : accepted ? "is-accepted"
    : rejected ? "is-rejected"
    : "is-countered";

  return (
    <div
      className={`bx-live-card is-clickable ${cls}`}
      style={{ animationDelay: `${0.1 + idx * 0.07}s` }}
      onClick={() => onOpen(bid.hotelId)}
      role="button"
      title={`Open ${bid.hotelName}`}
    >
      <div className="bx-live-card-top">
        <span className="bx-live-card-hotel">{bid.hotelName}</span>
        <span className="bx-live-card-amt">
          ₹{amount.toLocaleString("en-IN")}<small> per room / night</small>
        </span>
      </div>

      {/* Saving vs market — proof it beats every other site */}
      {!rejected && saved > 0 && (
        <div className="bx-live-save">
          <span className="bx-live-save-strike">₹{mrp.toLocaleString("en-IN")}</span>
          <span className="bx-live-save-tag">₹{saved.toLocaleString("en-IN")} ({savedPct}%) below market</span>
        </div>
      )}

      {expired && (
        <div className="bx-live-stat is-rej">⏳ Hold window ended — tap to rebid</div>
      )}
      {!expired && accepted && (
        <>
          <div className="bx-live-stat is-ok">
            <span className="bx-live-tick">✓</span>
            <span className="bx-live-stat-tx">Accepted at your price — pay to grab</span>
            <span className="bx-live-timer">held {mm}:{String(ss).padStart(2, "0")}</span>
          </div>
          <div className="bx-live-bar"><span style={{ width: `${holdLeftPct}%` }} /></div>
          {/* v183 — Phase 2 B6: explicit Pay Now & Grab CTA. Stops the
              card click so customer goes straight to /my-bids pay flow
              instead of the hotel page.
              v185 — Phase 4A bug-fix: liveBids items carry `bidId` not
              `id` (success.bids shape from placeBid). Fall back to
              bidId so the button actually renders for accepted rows. */}
          {onGrab && (bid.id || bid.bidId) && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onGrab(String(bid.id || bid.bidId)); }}
              className="bx-live-grab-btn"
              aria-label={`Pay ₹${amount.toLocaleString("en-IN")} per night and grab this booking`}
            >
              💰 Pay Now &amp; Grab — ₹{amount.toLocaleString("en-IN")} →
            </button>
          )}
        </>
      )}
      {!expired && countered && (
        <div className="bx-live-stat is-counter">
          ↔ Hotel's best price — couldn't hit your budget, but still below market · tap to view
        </div>
      )}
      {rejected && (
        <div className="bx-live-stat is-rej">This hotel passed — others are still in</div>
      )}
    </div>
  );
}

/* ── Editorial step bar ────────────────────────────────────────── */
// v163 — 3 steps: where&when, stay details, price+review+launch.
const STEPS = ["Where & When", "Your Stay", "Your Price"];

function StepBar({ step }: { step: number }) {
  return (
    <div className="bx-stepbar">
      {STEPS.map((label, i) => {
        const idx = i + 1;
        const done = idx < step;
        const active = idx === step;
        return (
          <div key={label} className={`bx-step ${done ? "is-done" : ""} ${active ? "is-active" : ""}`}>
            <div className="bx-step-rule" />
            <div className="bx-step-label">
              <span className="bx-step-num">0{idx}</span>
              <span>{label}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ── Counter (compact, editorial) ──────────────────────────────── */
// v201 — local Counter() removed. The Guests & Rooms row now renders three
// <PremiumGuestPicker> tiles directly (see the loop in the Step 1 form). The
// legacy `.bx-counter-*` styles remain in globals.css for any third-party
// callers; nothing in this file references them anymore.

/* ── Probability Dial (SVG, Vegas-style) ───────────────────────── */
function ProbabilityDial({ pct, color, instant }: { pct: number; color: string; instant: boolean }) {
  const safe = Math.max(0, Math.min(100, pct));
  const animated = useCountUp(safe);
  const r = 58;
  const c = 2 * Math.PI * r;
  const offset = c - (c * animated) / 100;
  return (
    <div className={`bx-dial-ring ${instant ? "is-instant" : ""}`}>
      <svg className="bx-dial-svg" viewBox="0 0 132 132">
        <circle className="bx-dial-track" cx="66" cy="66" r={r} />
        <circle
          className="bx-dial-fill"
          cx="66"
          cy="66"
          r={r}
          stroke={color}
          strokeDasharray={c}
          strokeDashoffset={offset}
        />
      </svg>
      <div className="bx-dial-center">
        <div className="bx-dial-pct">
          {animated}<span className="pct-sym">%</span>
        </div>
        <div className="bx-dial-label">Acceptance</div>
      </div>
    </div>
  );
}

/* ── Insights type ─────────────────────────────────────────────── */
type Insights = {
  tonightAuctions: number;
  acceptedToday: number;
  hotelsListening: number;
  cityHotStreak: number;
  avgAcceptMins: number;
  recentWins: Array<{ id: string; initial: string; amount: number; hotelName: string; city: string; when: string }>;
  city: string | null;
};

/* ══════════════════════════════════════════════════════════════════
   Main Component
══════════════════════════════════════════════════════════════════ */
export default function BidPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState<any>(null);
  const [animating, setAnimating] = useState(false);
  // 409 sheet — populated when any per-hotel placeBid hits the
  // one-active-bid-per-city rail.
  const [bidConflict, setBidConflict] = useState<null | { conflict: BidConflict; desiredAmount: number; floorPrice?: number; maxBudget?: number }>(null);
  // v163 — live auction state shown on the success screen itself.
  const [liveBids, setLiveBids] = useState<any[]>([]);
  const [launchTs, setLaunchTs] = useState(0);
  const [nowTs, setNowTs] = useState(() => Date.now());
  // v164 — hotel-class the auction targets. Set when the customer taps a
  // Budget / Smart / Premium preset; "" → derived from budget vs city avg.
  // Premium customers only see premium-class hotels (no low-grade clutter).
  const [tierPick, setTierPick] = useState<"" | "budget" | "smart" | "premium">("");

  // v139 — Tutorial Layer 2 — reverse-auction page tour. 4 steps walk
  // through city → dates → budget → submit. Uses existing
  // [data-autonext="..."] selectors from the bx-section flow.
  usePageTour("bid", "bid");

  // v140.1 — /bid is step-gated (city/dates at step=1, room type at
  // step=2, budget at step=3, submit at step=4). The tour selectors
  // for budget + submit don't exist in the DOM at page step=1. Listen
  // for sb:tour-prep events from usePageTour and bump the page state
  // so the next selector renders before driver.js spotlights it.
  // sb:tour-end resets the page back to step=1 so the user can
  // actually fill the form after the tour.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onPrep = (e: Event) => {
      const detail = (e as CustomEvent).detail || {};
      if (detail.key !== "bid") return;
      const toIdx = detail.toIndex as number;
      // v163 — 3-step page. Tour indices 0-1 (city/dates) live on page
      // step 1; presets / budget / submit live on page step 3.
      const targetPageStep = toIdx <= 1 ? 1 : 3;
      setStep((prev) => (prev !== targetPageStep ? targetPageStep : prev));
    };
    const onEnd = (e: Event) => {
      const detail = (e as CustomEvent).detail || {};
      if (detail.key !== "bid") return;
      // Reset to start of the actual bid flow.
      setStep(1);
    };
    window.addEventListener("sb:tour-prep", onPrep);
    window.addEventListener("sb:tour-end", onEnd);
    return () => {
      window.removeEventListener("sb:tour-prep", onPrep);
      window.removeEventListener("sb:tour-end", onEnd);
    };
  }, []);

  const [form, setForm] = useState({
    city:           "",
    propertyTypes:  [] as string[],  // v170 — multi-select; [] = Any
    checkIn:        "",
    checkOut:       "",
    adults:         2,
    children:       0,
    rooms:          1,
    roomTypes:      ["deluxe"] as string[], // v170 — multi-select room categories
    bedType:        "king",
    view:           "Any",
    mealPlan:       "breakfast",      // v170 — catalog meal-plan id
    occasion:       "none",
    // v129 — `specialRequests` removed: free-text field was an anti-bypass
    // surface (phone/email/WhatsApp could slip through). Add-on toggles below
    // are now the only structured channel for stay preferences.
    maxBudget:      "",
    addons:         [] as string[],  // v170 — catalog addon-service ids
  });

  // v170 — toggle a value in/out of one of the array fields.
  const toggleArr = (key: "propertyTypes" | "roomTypes" | "addons", val: string) =>
    setForm((f) => {
      const arr = f[key];
      return { ...f, [key]: arr.includes(val) ? arr.filter((x) => x !== val) : [...arr, val] };
    });

  // v187 — Phase 5: smart auto-scroll for multi-select sections. Fires
  // ONLY when adding (not removing) a pick takes the count from below
  // the section's min threshold to exactly the threshold — i.e. the
  // moment the rule is first satisfied. Property: 3, Room: 2. Until
  // then customer stays on the section (no premature scroll).
  const toggleProperty = (id: string) => {
    const wasSelected = form.propertyTypes.includes(id);
    toggleArr("propertyTypes", id);
    if (!wasSelected && form.propertyTypes.length + 1 >= 3) {
      // crossed up to the 3 threshold — release to next section
      setTimeout(() => scrollToAutoNext("dates"), 80);
    }
  };
  const toggleRoom = (id: string) => {
    const wasSelected = form.roomTypes.includes(id);
    toggleArr("roomTypes", id);
    if (!wasSelected && form.roomTypes.length + 1 >= 2) {
      setTimeout(() => scrollToAutoNext("bedType"), 80);
    }
  };

  const upd = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));

  // Luxury calendar
  const [calCfg, setCalCfg] = useState<{
    open: boolean;
    mode: "checkIn" | "checkOut";
  }>({ open: false, mode: "checkIn" });

  const city     = CITY_DATA[form.city];
  const nights   = numNights(form.checkIn, form.checkOut);
  // v129 — `budget` is the snapped (₹100-multiple) view of the typed input.
  // The probability dial, total estimate, and the bid amount sent to backend
  // all read this value so a half-typed "₹3,355" never leaks past the UI.
  // v172 — the customer now enters a TOTAL trip budget (all rooms × all
  // nights). `budget` (per room / per night) is DERIVED — the reverse
  // auction still competes on a nightly room rate.
  const nightsRooms = Math.max(1, nights) * Math.max(1, form.rooms);
  const totalBudget = snap100(parseFloat(form.maxBudget) || 0);
  const budget      = totalBudget > 0 ? snap100(totalBudget / nightsRooms) : 0;
  // v180 — feed the dynamic-price engine + room category into the dial.
  const bidStr   = city && budget > 0
    ? calcBidStrength(budget, city.avg, form.city, form.checkIn, form.roomTypes || [])
    : null;
  const totalEst = budget > 0 && nights > 0 ? budget * nights * form.rooms : 0;

  // v170 — room-category price multiplier (avg of the picked categories).
  const roomMult = form.roomTypes.length
    ? form.roomTypes.reduce((s, id) => s + (ROOM_CATEGORY_MULT[id] || 1), 0) / form.roomTypes.length
    : 1.0;

  // v164 — effective hotel class (drives the auction's star targeting).
  const tier: "budget" | "smart" | "premium" =
    tierPick ||
    (city && budget > 0
      ? (budget <= city.avg * 0.8 ? "budget" : budget >= city.avg * 1.25 ? "premium" : "smart")
      : "smart");
  const TIER_LABEL = { budget: "budget-class", smart: "mid-class", premium: "premium-class" }[tier];

  // v181.2 — Presets now anchored to the SAME expected market the
  // probability dial uses (livePrice from calculateDynamicPrice × the
  // AVERAGE roomMult). Without this the Premium preset showed 10%
  // ("Very Long Shot") even when ₹2,700 above the static city avg
  // — the dial was reading season-surged live price but presets were
  // reading static city.avg.
  //
  //   Budget  = expectedMarket × 0.70   → ratio 0.70 → 42% "Moderate"
  //   Smart   = expectedMarket × 1.00   → ratio 1.00 → 96% "Instant"
  //   Premium = expectedMarket × 1.30   → ratio ≥1.0 → 96% "Instant"
  //
  // (Smart stays Recommended — it's the cheapest preset that still
  // auto-confirms with the engine's live market read.)
  let presetLivePrice = city?.avg || 0;
  if (city) {
    try {
      if (form.checkIn) {
        const r = calculateDynamicPrice(city.avg, form.checkIn, form.city);
        if (r && Number.isFinite(r.price) && r.price > 0) presetLivePrice = r.price;
      }
    } catch { /* fall back to city.avg */ }
  }
  const presetExpected = presetLivePrice * roomMult; // per-room per-night
  const presets: {
    label: string; tier: "budget" | "smart" | "premium";
    amount: number; icon: string; desc: string; recommended?: boolean;
  }[] = city ? [
    { label: "Budget",   tier: "budget",  amount: snap100(presetExpected * 0.70 * nightsRooms), icon: "💰", desc: "Budget bidder" },
    { label: "Smart",    tier: "smart",   amount: snap100(presetExpected * 1.00 * nightsRooms), icon: "⭐", desc: "Balanced bid",  recommended: true },
    { label: "Premium",  tier: "premium", amount: snap100(presetExpected * 1.30 * nightsRooms), icon: "⚡", desc: "Premium bidder" },
  ] : [];

  // v172 — meal cost (per night, all guests) scaled to the property class.
  const MEAL_TIER_FACTOR = { budget: 0.85, smart: 1.0, premium: 1.5 }[tier];
  const guestsCount = form.adults + form.children;
  const mealCostNight = Math.round(
    (MEAL_PLAN_MAP[form.mealPlan]?.perGuestNight || 0) * Math.max(1, guestsCount) * MEAL_TIER_FACTOR / 10
  ) * 10;

  /* ── v124 Live insights — real data, refreshed on city change + 30s polling ── */
  const [insights, setInsights] = useState<Insights | null>(null);
  useEffect(() => {
    let cancelled = false;
    let timer: any = null;
    const fetchInsights = async () => {
      try {
        const q = form.city ? `?city=${encodeURIComponent(form.city)}` : "";
        const res = await fetch(`/api/bids/insights${q}`);
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setInsights(data);
      } catch { /* silently ignore — non-critical */ }
    };
    fetchInsights();
    timer = setInterval(fetchInsights, 30000); // 30s refresh — same cadence as admin dashboard
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [form.city]);

  /* ── CountUp values for the hero live pills (v163) ── */
  const liveAuctions  = useCountUp(insights?.tonightAuctions || 0);
  const liveHotels    = useCountUp(insights?.hotelsListening || 0);

  /* ── v163 Live auction on the success screen ──────────────────── */
  // When a bid launches we keep the customer on the SAME screen and
  // surface every placed bid live, with a countdown + status that
  // updates by polling /api/bids/my — no jump to a different page.
  useEffect(() => {
    if (!success?.bids?.length) return;
    setLaunchTs(Date.now());
    setNowTs(Date.now());
    setLiveBids(success.bids.map((b: any) => ({ ...b, status: "PENDING" })));
  }, [success]);

  // 1-second tick drives the per-card countdown.
  useEffect(() => {
    if (!success) return;
    const t = setInterval(() => setNowTs(Date.now()), 1000);
    return () => clearInterval(t);
  }, [success]);

  // Poll real bid status every 15s so accepts/counters show live.
  useEffect(() => {
    if (!success?.bids?.length) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const res: any = await api.getMyBids();
        const all: any[] = res?.bids || res || [];
        if (cancelled) return;
        setLiveBids((prev) =>
          prev.map((lb) => {
            const m = all.find((x: any) => x.id === lb.bidId);
            if (!m) return lb;
            return { ...lb, status: m.status || lb.status, counterAmount: m.counterAmount ?? lb.counterAmount };
          })
        );
      } catch { /* non-critical */ }
    };
    const t = setInterval(poll, 15000);
    poll();
    return () => { cancelled = true; clearInterval(t); };
  }, [success]);

  const canNext = (): boolean => {
    // v163 — 3-step page. Step 3 is the final step (launch lives inside).
    // v186 — Phase 4B: step 1 now requires at least 3 property types so
    // the auction has variety. Sachin: "any 3 types of property select
    // karni padegi" — customer must pick a minimum spread, no Any.
    if (step === 1) return !!(form.city && form.checkIn && form.checkOut && nights >= 1 && form.propertyTypes.length >= 3);
    // v187 — Phase 5: step 2 requires ≥ 2 room types (Sachin's rule).
    if (step === 2) return form.roomTypes.length >= 2;
    return budget > 0;
  };

  const goStep = (next: number) => {
    setAnimating(true);
    setTimeout(() => {
      setStep(next);
      setAnimating(false);
      // v122.2 — scroll the page back to the top of the StepBar.
      requestAnimationFrame(() => {
        window.scrollTo({ top: 0, behavior: "smooth" });
      });
    }, 180);
  };

  // ══════════════════════════════════════════════════════════════════
  // SUBMIT HANDLER — BYTE-IDENTICAL to v122/v123. Do NOT modify the
  // reverse-auction flow. Only the surrounding UI shifted in v124.
  // ══════════════════════════════════════════════════════════════════
  const submit = async () => {
    if (!user) return router.push("/auth");
    setLoading(true);
    try {
      // v170 — structured requirements built from the catalog selections.
      const addonLabels = form.addons
        .map((id) => {
          const a = ADDON_SERVICE_MAP[id];
          return a ? `${a.label}${a.charge === "paid" ? " (paid)" : ""}` : "";
        })
        .filter(Boolean);
      const extras = [
        ...addonLabels,
        form.occasion !== "none" ? `Occasion: ${form.occasion}` : "",
      ].filter(Boolean).join(". ");

      const roomLabels = form.roomTypes.map((id) => ROOM_CATEGORY_MAP[id]?.label || id).join(" / ");
      const requirements = [
        form.propertyTypes.length
          ? `Property: ${form.propertyTypes.map((id) => PROPERTY_TYPE_MAP[id]?.label || id).join(" / ")}`
          : "",
        `Room: ${roomLabels || "Any"}, ${form.bedType} bed`,
        `View: ${form.view}`,
        `Meal plan: ${MEAL_PLAN_MAP[form.mealPlan]?.label || form.mealPlan}`,
        extras,
      ].filter(Boolean).join(" | ") || undefined;

      // 1. Find hotels matching the selected city (case-insensitive, partial match)
      const hotelsResp = await api.getHotels({ city: form.city });
      const allHotels = hotelsResp.hotels || [];
      const cityLower = form.city.toLowerCase();
      let matching = allHotels.filter((h: any) => {
        const hc = (h.city || "").toLowerCase();
        return hc === cityLower || hc.includes(cityLower) || cityLower.includes(hc);
      });
      // Fallback: if server-side filter returned nothing useful, use whatever the server gave us
      if (matching.length === 0 && allHotels.length > 0) matching = allHotels.slice(0, 3);

      // v170 — property-type categorization (HARD filter, multi-select).
      // The bid only goes to hotels whose type the customer picked — no
      // "asked for a villa, sees a guest house" clash. Empty → clear
      // message, never a wrong-category hotel.
      if (form.propertyTypes.length) {
        const pf = matching.filter((h: any) =>
          form.propertyTypes.includes(h.property_type || "hotel")
        );
        if (pf.length === 0) {
          const want = form.propertyTypes.map((id) => PROPERTY_TYPE_MAP[id]?.label || id).join(" / ");
          throw new Error(
            `No ${want} in ${form.city} right now. Try a different property type or city.`
          );
        }
        matching = pf;
      }

      // v170 — meal-plan categorization (HARD filter). If the customer
      // wants meals, only hotels that actually offer that plan compete —
      // no "wants breakfast, hotel doesn't serve food" clash. Room Only
      // needs no kitchen, so it is never filtered.
      if (form.mealPlan && form.mealPlan !== "room_only") {
        const mf = matching.filter((h: any) =>
          Array.isArray(h.meal_plans) && h.meal_plans.includes(form.mealPlan)
        );
        if (mf.length === 0) {
          throw new Error(
            `No hotels in ${form.city} offer ${MEAL_PLAN_MAP[form.mealPlan]?.label || form.mealPlan} right now. Pick another meal plan.`
          );
        }
        matching = mf;
      }

      // v164 — hotel-class filter: a premium customer competes only among
      // premium hotels; a budget customer isn't shown 5★ luxury. Soft — if
      // the band leaves fewer than 2 hotels, fall back to all so the
      // customer is never stuck with an empty auction.
      const classFiltered = matching.filter((h: any) => {
        const s = Number(h.starRating) || 3;
        if (tier === "premium") return s >= 4;
        if (tier === "budget")  return s <= 4;
        return true; // smart — flexible middle, every class
      });
      if (classFiltered.length >= 2) matching = classFiltered;

      if (matching.length === 0) {
        throw new Error(`No hotels available in ${form.city} right now. Try Mussoorie, Dhanaulti, or Rishikesh.`);
      }

      const checkInISO  = new Date(form.checkIn).toISOString();
      const checkOutISO = new Date(form.checkOut).toISOString();
      const guests      = form.adults + form.children;

      // 2. For each matching hotel, create a bid request AND a bid row so it
      //    shows up in /my-bids. If the user's budget is below the room's floor
      //    price, place the bid at floor price and record the user's desired
      //    amount in the message so the hotel can counter.
      //
      // v130 — DELIBERATELY NO schedule-accept here. The /bid page is a
      // reverse-auction BROADCAST: the customer sends the same bid to every
      // matching hotel and waits to see who accepts / counters / rejects.
      // Auto-accepting on tier here would short-circuit the competition —
      // the first hotel to time out would auto-win even if a better counter
      // from a different hotel was about to land. The simple Bid button on
      // /hotels/[id] (1:1 to one hotel) DOES use schedule-accept; this
      // multi-hotel path stays manual review by design.
      const results = await Promise.allSettled(
        matching.map(async (hotel: any) => {
          const detail = await api.getHotel(hotel.id);
          const rooms  = detail.rooms || detail.hotel?.rooms || [];
          // v170 — prefer a room matching ANY chosen room category
          // (letters-only compare so "super_deluxe" ≈ "Super Deluxe Room").
          // Falls back to the cheapest room so the hotel still competes.
          const norm = (s: string) => String(s || "").toLowerCase().replace(/[^a-z]/g, "");
          const room =
            rooms.find((r: any) =>
              form.roomTypes.some((rt) => {
                const n = norm(rt);
                return n && (norm(r.type).includes(n) || norm(r.name).includes(n));
              })
            ) || rooms[0];
          if (!room) throw new Error(`${hotel.name}: no rooms`);

          // ── v166 auction pricing — sourced from the pricing spine ───
          // floor      = hotel's negotiation floor (won't go below)
          // livePrice  = StayBid's own dynamic rate for this room/date.
          //              v166: read from the unified spine (room_date_price
          //              → competitor-undercut + per-date vacancy baked
          //              in). Falls back to the local demand engine if the
          //              spine is unreachable, so the auction never breaks.
          // dealPrice  = the auction result — ALWAYS ≥8% under livePrice,
          //              never below floor, never above the customer's
          //              ceiling. Since livePrice already sits below every
          //              OTA, a deal under it is the lowest price anywhere.
          const roomFloor = Number(room.floorPrice) || 0;
          let floor = roomFloor;
          let livePrice = 0;
          try {
            const sp = await fetch("/api/pricing/spine", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ roomIds: [room.id], date: form.checkIn }),
            }).then((r) => r.json());
            const p = sp?.prices?.[room.id];
            if (p && Number(p.livePrice) > 0) {
              livePrice = Number(p.livePrice);
              if (Number(p.bidFloor) > 0) floor = Number(p.bidFloor);
            }
          } catch { /* spine unreachable — fall back below */ }
          if (livePrice <= 0) {
            const dyn = calculateDynamicPrice(roomFloor || 1000, checkInISO, form.city);
            livePrice = Math.max(roomFloor, dyn.price);
          }
          const mrp = Number(room.mrp) || Math.round(livePrice * 1.6);
          const maxDeal = snap100(livePrice * 0.92);
          const accepted = floor > 0 ? budget >= floor : true;
          const dealPrice = accepted
            ? snap100(Math.min(Math.max(Math.min(budget, maxDeal), floor), maxDeal))
            : Math.max(floor, snap100(floor)); // ceiling < floor → hotel counters at its floor

          const reqRes = await api.createBidRequest({
            hotelId:  hotel.id,
            roomId:   room.id,
            amount:   dealPrice,
            checkIn:  checkInISO,
            checkOut: checkOutISO,
            guests,
            requirements,
          });

          const requestId = reqRes?.request?.id;
          const baseMessage = `Guest bid ₹${dealPrice}/night for ${nights} night${nights > 1 ? "s" : ""} (max ₹${budget})${requirements ? ". " + requirements : ""}`;

          // dealPrice is always ≥ floor, so it clears the backend floor
          // check. The catch is a pure safety net for stale floor data.
          // Reverse-auction broadcast → flow:"place" (1h timer).
          let placedBidId = "";
          try {
            const bidRes = await api.placeBid({
              hotelId:  hotel.id,
              roomId:   room.id,
              amount:   dealPrice,
              requestId,
              message:  baseMessage,
              flow:     "place",
            });
            if (bidRes?.bid?.id) {
              placedBidId = bidRes.bid.id;
              localStorage.setItem(
                `bid_dates_${bidRes.bid.id}`,
                JSON.stringify({ checkIn: form.checkIn, checkOut: form.checkOut })
              );
            }
          } catch (err: any) {
            // 409 = one-active-bid-per-city. Bubble up with the conflict
            // payload so the outer catch can show the sheet exactly once
            // (every per-hotel placeBid in the same city would 409 — no
            // value stacking sheets per hotel).
            if (err instanceof ApiError && err.status === 409 && err.body?.conflict) {
              throw Object.assign(new Error("CONFLICT"), { __conflict: err.body.conflict });
            }
            const msg = (err?.message || "").toLowerCase();
            if (msg.includes("too low") && floor > 0) {
              const bidRes = await api.placeBid({
                hotelId:  hotel.id,
                roomId:   room.id,
                amount:   floor,
                requestId,
                message:  baseMessage,
                flow:     "place",
              });
              if (bidRes?.bid?.id) {
                placedBidId = bidRes.bid.id;
                localStorage.setItem(
                  `bid_dates_${bidRes.bid.id}`,
                  JSON.stringify({ checkIn: form.checkIn, checkOut: form.checkOut })
                );
              }
            } else {
              throw err;
            }
          }

          return {
            hotelId: hotel.id,
            hotelName: hotel.name || "Hotel",
            bidId: placedBidId,
            amount: dealPrice,
            floorPrice: floor,
            livePrice,
            mrp,
            accepted,
          };
        })
      );

      const launched = results
        .filter((r): r is PromiseFulfilledResult<any> => r.status === "fulfilled")
        .map((r) => r.value);
      const successCount = launched.length;
      if (successCount === 0) {
        // Surface the city-conflict sheet if every per-hotel placeBid hit 409
        // — same customer + same city = same active bid for all.
        const conflictReject: any = results.find(
          (r): r is PromiseRejectedResult => r.status === "rejected" && (r as any).reason?.__conflict
        );
        if (conflictReject) {
          setBidConflict({
            conflict: conflictReject.reason.__conflict,
            desiredAmount: budget,
            maxBudget: budget * 2,
          });
          return;
        }
        const firstErr: any = results.find(r => r.status === "rejected");
        throw new Error(firstErr?.reason?.message || "Could not submit your bid. Please try again.");
      }

      setSuccess({
        city: form.city,
        checkIn: form.checkIn,
        checkOut: form.checkOut,
        nights,
        budget,
        rooms: form.rooms,
        totalEst,
        hotelsNotified: successCount,
        bids: launched,
      });
    } catch (e: any) {
      alert(e.message || "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  /* ─────────────── Success Screen (winners' circle) ─────────────── */
  if (success) {
    // v163 — a bid counts as accepted if it cleared the hotel's floor
    // at launch (instant) OR the poll later flipped it to ACCEPTED.
    const isAccepted = (b: any) =>
      !!b.accepted || ["ACCEPTED", "CONFIRMED"].includes(String(b.status).toUpperCase());
    const acceptedCount  = liveBids.filter(isAccepted).length;
    const reviewingCount = liveBids.length - acceptedCount;
    // Accepted hotels float to the top of the live list.
    const sortedBids = [...liveBids].sort(
      (a, b) => (isAccepted(b) ? 1 : 0) - (isAccepted(a) ? 1 : 0)
    );
    return (
    <div className="bx-shell bx-win-shell min-h-screen flex justify-center px-4 py-6">
      {/* v162 — celebration confetti rain */}
      <div className="bx-confetti" aria-hidden="true">
        {CONFETTI.map((c, i) => (
          <span
            key={i}
            className="bx-confetti-piece"
            style={{
              left: `${c.left}%`,
              background: c.color,
              width: c.w, height: c.h,
              borderRadius: c.round ? "50%" : "1.5px",
              animationDelay: `${c.delay}s`,
              animationDuration: `${c.dur}s`,
            }}
          />
        ))}
      </div>

      <div className="bx-page-wrap-success w-full">
        <div className="bx-win-card bx-win-pop">
          {/* Burst badge — radiating rings + popping medal */}
          <div className="bx-win-burst">
            <span className="bx-win-burst-ring" />
            <span className="bx-win-burst-ring is-two" />
            <div className="bx-win-badge">🎉</div>
          </div>

          <p className="bx-hero-eyebrow bx-win-seq" style={{ justifyContent: "center", animationDelay: "0.15s" }}>
            <span className="bx-hero-eyebrow-dot" />
            Bid Request Launched
          </p>
          <h1 className="bx-hero-title bx-win-seq" style={{ fontSize: "clamp(1.5rem, 5vw, 2rem)", margin: "8px 0 4px", animationDelay: "0.22s" }}>
            Hotels Are <em>Competing</em>!
          </h1>

          {/* Big animated hotel count */}
          <div className="bx-win-bignum bx-win-seq" style={{ animationDelay: "0.3s" }}>
            <span className="bx-win-bignum-v"><WinCount value={success.hotelsNotified} /></span>
            <span className="bx-win-bignum-l">
              {success.hotelsNotified === 1 ? "hotel is" : "hotels are"} bidding for your stay
            </span>
          </div>

          <p className="bx-hero-sub bx-win-seq" style={{ margin: "0 auto 12px", maxWidth: "36ch", animationDelay: "0.38s" }}>
            {success.nights} {success.nights === 1 ? "night" : "nights"} in{" "}
            <strong style={{ color: "var(--cozy-warm-dark)" }}>{success.city}</strong> · ₹{success.budget.toLocaleString("en-IN")} per room / night —
            watch the auction unfold live below.
          </p>

          <div className="bx-review-grid bx-win-seq" style={{ marginBottom: 0, animationDelay: "0.46s", gridTemplateColumns: "repeat(3, 1fr)" }}>
            <div>
              <div className="bx-review-item-label">Check-in</div>
              <div className="bx-review-item-v">{new Date(success.checkIn).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</div>
            </div>
            <div>
              <div className="bx-review-item-label">Check-out</div>
              <div className="bx-review-item-v">{new Date(success.checkOut).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</div>
            </div>
            <div>
              <div className="bx-review-item-label">Nights</div>
              <div className="bx-review-item-v">{success.nights}</div>
            </div>
          </div>
        </div>

        {/* v163 — LIVE auction panel: every placed bid streams in HERE,
            on the same screen, with a live countdown + status. */}
        <div className="bx-live-panel bx-win-seq" style={{ animationDelay: "0.56s" }}>
          <div className="bx-live-head">
            <span className="bx-live-head-l">
              <span className="bx-live-dot" />
              Live Auction
            </span>
            <span className="bx-live-head-r">
              {acceptedCount > 0 && <b className="bx-live-head-ok">{acceptedCount} accepted</b>}
              {acceptedCount > 0 && reviewingCount > 0 && " · "}
              {reviewingCount > 0 && `${reviewingCount} counter`}
            </span>
          </div>

          <div className="bx-live-list">
            {sortedBids.map((b, i) => (
              <LiveBidCard
                key={b.bidId || i}
                bid={b}
                idx={i}
                launchTs={launchTs}
                nowTs={nowTs}
                onOpen={(hid) => router.push(hid ? `/hotels/${hid}` : "/my-bids")}
                // v194 — auto-open BookingReview on /my-bids landing. Was
                // `#bid-<id>` which dumped the user on the list and required
                // a second tap to open the Pay/Hold/Pay-at-Hotel modal. The
                // `?payNow=<id>` query param fires handlePayNow as soon as
                // the bids list hydrates.
                onGrab={(bid) => router.push(`/my-bids?payNow=${bid}`)}
              />
            ))}
          </div>

          <p className="bx-live-note">
            ✓ Every price here is <strong>below the market rate</strong> — lowest anywhere, guaranteed. Accepted offers are <strong>held 15 minutes</strong>; tap a hotel to lock your booking.
          </p>

          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 4 }}>
            <button onClick={() => router.push("/my-bids")} className="bx-launch-btn" style={{ padding: "14px 18px", fontSize: "1.05rem" }}>
              Track All Bids
            </button>
            <button onClick={() => router.push("/hotels")} className="bx-nav-back" style={{ width: "100%", flex: "0 0 auto" }}>
              Browse Hotels
            </button>
          </div>
        </div>
      </div>
    </div>
    );
  }

  /* ─────────────── Main Form ─────────────── */
  return (
    <div className="bx-shell min-h-screen pb-24">
      <div className="bx-page-wrap mx-auto px-4 pt-4">

        {/* v163 — Step 1: compact split hero. Title + the two live pills
            (auctions live / hotels listening) sit on the LEFT; the
            explainer passage sits on the RIGHT. Toolbar (back button +
            "Auction Pit" crumb) removed per request. Steps 2-3: slim bar. */}
        {step === 1 ? (
          <div className="bx-hero bx-hero-split bx-rise">
            <div className="bx-hero-left">
              <span className="bx-hero-eyebrow">
                <span className="bx-hero-eyebrow-dot" />
                Reverse Auction · Live
              </span>
              <h1 className="bx-hero-title">
                Name Your <em>Price</em>
              </h1>
              {insights && (insights.tonightAuctions > 0 || insights.hotelsListening > 0) && (
                <div className="bx-hero-pills">
                  {/* v163 — both live stats merged into ONE compact pill
                      so they sit on a single line next to the title. */}
                  <span className="bx-stat-pill bx-stat-pill-live bx-hero-livepill">
                    {insights.tonightAuctions > 0 && (
                      <span className="bx-hero-livepill-seg">
                        <b>{liveAuctions}</b> live{form.city ? ` in ${form.city}` : ""}
                      </span>
                    )}
                    {insights.tonightAuctions > 0 && insights.hotelsListening > 0 && (
                      <span className="bx-hero-livepill-sep">·</span>
                    )}
                    {insights.hotelsListening > 0 && (
                      <span className="bx-hero-livepill-seg">
                        🏨 <b>{liveHotels}</b> listening
                      </span>
                    )}
                  </span>
                </div>
              )}
            </div>
            <p className="bx-hero-sub bx-hero-sub-right">
              Set what you want to pay. Hotels in {form.city || "your destination"} compete for your booking — the best offer wins your night.
            </p>
          </div>
        ) : (
          <div className="bx-slim-hero bx-rise">
            <div className="bx-slim-hero-text">
              <span className="bx-slim-hero-eyebrow">
                <span className="bx-hero-eyebrow-dot" />
                Name Your Price
              </span>
              {form.city && <span className="bx-slim-hero-city">{form.city}</span>}
            </div>
            {insights && insights.tonightAuctions > 0 && (
              <span className="bx-slim-hero-pill">
                <span className="bx-slim-hero-pulse" />
                {liveAuctions} live
              </span>
            )}
          </div>
        )}

        <StepBar step={step} />

        <div className={`transition-all duration-200 ${animating ? "opacity-0 translate-y-2" : "opacity-100 translate-y-0"}`}>

          {/* ═══════════ STEP 1: WHERE & WHEN ═══════════ */}
          {step === 1 && (
            <div className="space-y-3 bx-step-pane" data-autonext-form>

              {/* Destination */}
              <div data-autonext="destination">
                <div className="bx-section-h">
                  <span className="bx-section-h-label">
                    Destination <span className="bx-section-h-required">*</span>
                  </span>
                  <span className="bx-section-h-rule" />
                </div>
                {/* v186 — Phase 4B: destination now in the same shared
                    box-less premium grid as property / room / occasion.
                    Surge dot kept as a corner accent (very-high demand
                    cities). 3 cols mobile → 4/5/6/7 desktop. */}
                <div className="bx-pick-grid size-prominent">
                  {Object.entries(CITY_DATA).map(([name, info]) => {
                    const isSelected = form.city === name;
                    const isSurge = info.demand === "Very High" || info.demand === "High";
                    return (
                      <button
                        key={name}
                        type="button"
                        onClick={() => { upd("city", name); scrollToAutoNext("dates"); }}
                        className={`bx-pick-tile ${isSelected ? "is-selected" : ""}`}
                        title={`${name} · ${info.demand} demand`}
                      >
                        <span className="bx-pick-icon">{info.emoji}</span>
                        <span className="bx-pick-label">{name}</span>
                        {isSurge && <span className="bx-pick-tag" style={{ color: "#C77B43" }}>🔥</span>}
                      </button>
                    );
                  })}
                </div>

                {city && (
                  <div className="bx-insight">
                    <span className="bx-insight-icon">🤖</span>
                    <div>
                      <div className="bx-insight-title">AI Insight</div>
                      <div className="bx-insight-body">{city.tip}</div>
                      <div className="bx-insight-meta">
                        Avg. ₹{city.avg.toLocaleString("en-IN")}/night · {insights?.hotelsListening ?? "—"} hotels listening
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Property Type — v170 categorized bidding. "" = Any. */}
              <div data-autonext="propertyType">
                <div className="bx-section-h">
                  <span className="bx-section-h-label">Property Type</span>
                  <span className="bx-section-h-rule" />
                  {/* v186 — live counter: pick at least 3 to proceed. */}
                  <span
                    className="bx-section-h-count"
                    style={{
                      fontSize: "0.66rem", fontWeight: 800, letterSpacing: "0.06em",
                      padding: "3px 9px", borderRadius: 999, whiteSpace: "nowrap",
                      background: form.propertyTypes.length >= 3
                        ? "rgba(127,146,105,0.18)"
                        : "rgba(201,123,67,0.18)",
                      color: form.propertyTypes.length >= 3 ? "#5a6e44" : "#a85b26",
                      border: `1px solid ${form.propertyTypes.length >= 3 ? "rgba(127,146,105,0.45)" : "rgba(201,123,67,0.45)"}`,
                    }}
                  >
                    {form.propertyTypes.length}/3 picked
                  </span>
                </div>
                {/* v181 — curated 10-pick grid w/ premium icon tiles.
                    v186 — Any pseudo-option removed (Sachin's rule:
                    must select at least 3 types). Grid is 3 cols
                    mobile → 4/5/6/7 desktop. */}
                <div className="bx-pick-grid">
                  {BID_PROPERTY_PICK.map((pt) => {
                    const isSelected = form.propertyTypes.includes(pt.id);
                    return (
                      <button
                        key={pt.id}
                        type="button"
                        onClick={() => toggleProperty(pt.id)}
                        className={`bx-pick-tile ${isSelected ? "is-selected" : ""}`}
                      >
                        <span className="bx-pick-icon">{pt.icon}</span>
                        <span className="bx-pick-label">{pt.label}</span>
                      </button>
                    );
                  })}
                </div>
                <p className="bx-budget-suffix" style={{ marginTop: 6 }}>
                  {form.propertyTypes.length >= 3
                    ? `Bid goes only to: ${form.propertyTypes.map((id) => PROPERTY_TYPE_MAP[id]?.label || id).join(", ")} — no other type.`
                    : `Pick at least 3 property types to broaden the auction (currently ${form.propertyTypes.length} selected).`}
                </p>
              </div>

              {/* Dates */}
              <div data-autonext="dates">
                <div className="bx-section-h">
                  <span className="bx-section-h-label">
                    Dates <span className="bx-section-h-required">*</span>
                  </span>
                  <span className="bx-section-h-rule" />
                </div>
                <div className="bx-card">
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setCalCfg({ open: true, mode: "checkIn" })}
                      className={`bx-date-btn ${form.checkIn ? "is-set" : ""}`}
                    >
                      <div>
                        <div className="bx-date-btn-eyebrow">Check-in</div>
                        <div className={`bx-date-btn-v ${form.checkIn ? "" : "is-empty"}`}>
                          {form.checkIn
                            ? new Date(form.checkIn).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })
                            : "Pick date"}
                        </div>
                      </div>
                      <span className="bx-date-btn-icon">📅</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setCalCfg({ open: true, mode: "checkOut" })}
                      className={`bx-date-btn ${form.checkOut ? "is-set" : ""}`}
                    >
                      <div>
                        <div className="bx-date-btn-eyebrow">Check-out</div>
                        <div className={`bx-date-btn-v ${form.checkOut ? "" : "is-empty"}`}>
                          {form.checkOut
                            ? new Date(form.checkOut).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })
                            : "Pick date"}
                        </div>
                      </div>
                      <span className="bx-date-btn-icon">📅</span>
                    </button>
                  </div>
                  {nights > 0 && (
                    <div style={{ textAlign: "center" }}>
                      <span className="bx-nights-pill">
                        {nights} {nights === 1 ? "night" : "nights"}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Guests & Rooms — 3 premium counters in ONE row (v201) */}
              <div data-autonext="guests">
                <div className="bx-section-h">
                  <span className="bx-section-h-label">Guests &amp; Rooms</span>
                  <span className="bx-section-h-rule" />
                </div>
                <div className="bx-guest-row">
                  {[
                    { label: "Adults",   key: "adults",   min: 1, max: 10, kind: "adults"   as GuestKind, sub: "12+ yrs"        },
                    { label: "Children", key: "children", min: 0, max: 6,  kind: "children" as GuestKind, sub: "5-12 yrs"       },
                    { label: "Rooms",    key: "rooms",    min: 1, max: 5,  kind: "rooms"    as GuestKind, sub: "1 unit / family"},
                  ].map(({ label, key, min, max, kind, sub }) => (
                    <PremiumGuestPicker
                      key={key}
                      kind={kind}
                      label={label}
                      sublabel={sub}
                      value={(form as any)[key]}
                      onChange={(v) => upd(key, v)}
                      min={min}
                      max={max}
                    />
                  ))}
                </div>
              </div>

            </div>
          )}

          {/* ═══════════ STEP 2: YOUR STAY — room + compact preferences ═══ */}
          {step === 2 && (
            <div className="space-y-3 bx-step-pane" data-autonext-form>

              {/* Room Type — v170 multi-select catalog categories */}
              <div data-autonext="roomType">
                <div className="bx-section-h">
                  <span className="bx-section-h-label">Room Type</span>
                  <span className="bx-section-h-rule" />
                  {/* v187 — live counter: pick at least 2 to proceed. */}
                  <span
                    style={{
                      fontSize: "0.66rem", fontWeight: 800, letterSpacing: "0.06em",
                      padding: "3px 9px", borderRadius: 999, whiteSpace: "nowrap",
                      background: form.roomTypes.length >= 2
                        ? "rgba(127,146,105,0.18)"
                        : "rgba(201,123,67,0.18)",
                      color: form.roomTypes.length >= 2 ? "#5a6e44" : "#a85b26",
                      border: `1px solid ${form.roomTypes.length >= 2 ? "rgba(127,146,105,0.45)" : "rgba(201,123,67,0.45)"}`,
                    }}
                  >
                    {form.roomTypes.length}/2 picked
                  </span>
                </div>
                {/* v181 — curated 7-pick room grid w/ premium icon
                    tiles + same responsive auto-fit grid as property. */}
                <div className="bx-pick-grid">
                  {BID_ROOM_PICK.map((rc) => (
                    <button
                      key={rc.id}
                      type="button"
                      onClick={() => toggleRoom(rc.id)}
                      className={`bx-pick-tile ${form.roomTypes.includes(rc.id) ? "is-selected" : ""}`}
                    >
                      <span className="bx-pick-icon">{rc.icon}</span>
                      <span className="bx-pick-label">{rc.label}</span>
                    </button>
                  ))}
                </div>
                <p className="bx-budget-suffix" style={{ marginTop: 6 }}>
                  {form.roomTypes.length >= 2
                    ? `Bid spans: ${form.roomTypes.map((id) => ROOM_CATEGORY_MAP[id]?.label || id).join(", ")} — upgraded categories cost more.`
                    : `Pick at least 2 room categories (currently ${form.roomTypes.length} selected) — upgraded categories cost more.`}
                </p>
              </div>

              {/* Bed preference — compact chips, single row */}
              <div data-autonext="bedType">
                <div className="bx-section-h">
                  <span className="bx-section-h-label">Bed Preference</span>
                  <span className="bx-section-h-rule" />
                </div>
                {/* v186 — Phase 4B: bed picker now in the shared
                    box-less premium grid (was horizontal scroll chips). */}
                <div className="bx-pick-grid size-compact">
                  {BED_TYPES.map((bt) => (
                    <button
                      key={bt.id}
                      type="button"
                      onClick={() => { upd("bedType", bt.id); scrollToAutoNext("view"); }}
                      className={`bx-pick-tile ${form.bedType === bt.id ? "is-selected" : ""}`}
                    >
                      <span className="bx-pick-icon">{bt.icon}</span>
                      <span className="bx-pick-label">{bt.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* View preference — v186 same premium grid as bed/property */}
              <div data-autonext="view">
                <div className="bx-section-h">
                  <span className="bx-section-h-label">View Preference</span>
                  <span className="bx-section-h-rule" />
                </div>
                <div className="bx-pick-grid size-compact">
                  {VIEW_PREFS_PICK.map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => { upd("view", v.id); scrollToAutoNext("mealPlan"); }}
                      className={`bx-pick-tile ${form.view === v.id ? "is-selected" : ""}`}
                    >
                      <span className="bx-pick-icon">{v.icon}</span>
                      <span className="bx-pick-label">{v.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Meal Plan — v170 catalog plans with transparent cost */}
              <div data-autonext="mealPlan">
                <div className="bx-section-h">
                  <span className="bx-section-h-label">Meal Plan</span>
                  <span className="bx-section-h-rule" />
                </div>
                {/* v186 — Phase 4B: meal plans in the shared box-less
                    grid (was 4-up tile grid). */}
                <div className="bx-pick-grid size-compact">
                  {CAT_MEAL_PLANS.map((mp) => (
                    <button
                      key={mp.id}
                      type="button"
                      onClick={() => { upd("mealPlan", mp.id); scrollToAutoNext("occasion"); }}
                      className={`bx-pick-tile ${form.mealPlan === mp.id ? "is-selected" : ""}`}
                      title={mp.desc}
                    >
                      <span className="bx-pick-icon">{MEAL_EMOJI[mp.id] || "🍽️"}</span>
                      <span className="bx-pick-label">{mp.label}</span>
                    </button>
                  ))}
                </div>
                <p className="bx-budget-suffix" style={{ marginTop: 6 }}>
                  Meal cost is folded into your total estimate (scaled to the property class). No per-plan price shown — the hotel confirms the final rate.
                </p>
              </div>

              {/* Occasion — compact chips, single scrollable row (v163) */}
              <div data-autonext="occasion">
                <div className="bx-section-h">
                  <span className="bx-section-h-label">Trip Purpose / Occasion</span>
                  <span className="bx-section-h-rule" />
                </div>
                {/* v181 — occasion now in the same premium pick grid.
                    Mobile lands as a 2-col block (per Sachin's spec) and
                    spreads to 3/4/6 on tablet/laptop/desktop via the
                    shared bx-pick-grid responsive rules. */}
                <div className="bx-pick-grid size-compact">
                  {OCCASIONS.map((oc) => (
                    <button
                      key={oc.id}
                      type="button"
                      onClick={() => { upd("occasion", oc.id); scrollToAutoNext("addons"); }}
                      className={`bx-pick-tile ${form.occasion === oc.id ? "is-selected" : ""}`}
                    >
                      <span className="bx-pick-icon">{oc.icon}</span>
                      <span className="bx-pick-label">{oc.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Add-ons — compact toggle chips, single scrollable row (v163) */}
              <div data-autonext="addons">
                <div className="bx-section-h">
                  <span className="bx-section-h-label">Add-ons &amp; Preferences</span>
                  <span className="bx-section-h-rule" />
                </div>
                {/* v181 — curated add-on subset (10 items) in the
                    shared premium pick grid. Paid add-ons carry a small
                    💳 corner badge so the customer sees the cost flag
                    before tapping. */}
                <div className="bx-pick-grid size-compact">
                  {BID_ADDON_PICK.map((ad) => (
                    <button
                      key={ad.id}
                      type="button"
                      onClick={() => toggleArr("addons", ad.id)}
                      className={`bx-pick-tile ${form.addons.includes(ad.id) ? "is-selected" : ""}`}
                      title={ad.note}
                    >
                      <span className="bx-pick-icon">{ad.emoji}</span>
                      <span className="bx-pick-label">{ad.label}</span>
                      {ad.charge === "paid" && <span className="bx-pick-tag">💳</span>}
                    </button>
                  ))}
                </div>
                <p className="bx-budget-suffix" style={{ marginTop: 6 }}>
                  💳 = paid service, billed by the hotel as per actuals. Others are on request, subject to availability.
                </p>
                {/* v129 — free-text "Additional requests" textarea removed
                    (anti-bypass). Structured toggles only. */}
              </div>

            </div>
          )}

          {/* ═══════════ STEP 3: YOUR PRICE — budget + review + launch ═══ */}
          {step === 3 && (
            <div className="space-y-3 bx-step-pane" data-autonext-form>

              {/* AI Presets */}
              {city && (
                <div data-autonext="presets">
                  <div className="bx-section-h">
                    <span className="bx-section-h-label">🤖 AI Smart Presets</span>
                    <span className="bx-section-h-rule" />
                  </div>
                  <div className="bx-card is-accented">
                    <p className="bx-insight-meta" style={{ marginTop: 0, marginBottom: 12 }}>
                      Total budget for {form.rooms} room{form.rooms > 1 ? "s" : ""} × {Math.max(1, nights)} night{nights !== 1 ? "s" : ""} · auction targets{" "}
                      <strong style={{ color: "var(--cozy-cocoa)" }}>{TIER_LABEL} hotels</strong>
                    </p>
                    <div className="bx-preset-row">
                      {presets.map((p) => (
                        <button
                          key={p.label}
                          type="button"
                          onClick={() => { upd("maxBudget", String(p.amount)); setTierPick(p.tier); scrollToAutoNext("budget-input"); }}
                          className={`bx-preset ${parseInt(form.maxBudget) === p.amount ? "is-selected" : ""} ${p.recommended ? "is-recommended" : ""}`}
                        >
                          {p.recommended && <span className="bx-preset-tag">Recommended</span>}
                          <span className="bx-preset-icon">{p.icon}</span>
                          <div className="bx-preset-label">{p.label}</div>
                          <div className="bx-preset-amount">₹{p.amount.toLocaleString("en-IN")}</div>
                          <div className="bx-preset-desc">{p.desc}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Budget Input — v172: total trip budget (not per night) */}
              <div data-autonext="budget-input">
                <div className="bx-section-h">
                  <span className="bx-section-h-label">
                    Your Total Trip Budget <span className="bx-section-h-required">*</span>
                  </span>
                  <span className="bx-section-h-rule" />
                </div>
                <div className="bx-budget-wrap">
                  <div className="bx-budget-eyebrow">
                    Total for {form.rooms} room{form.rooms > 1 ? "s" : ""} × {Math.max(1, nights)} night{nights !== 1 ? "s" : ""}
                  </div>
                  <div className="bx-budget-row">
                    <span className="bx-budget-cur">₹</span>
                    <input
                      type="number"
                      value={form.maxBudget}
                      onChange={(e) => upd("maxBudget", e.target.value)}
                      onBlur={(e) => {
                        // Snap any typed amount to a ₹100 multiple on blur.
                        const v = parseFloat(e.target.value) || 0;
                        if (v > 0) upd("maxBudget", String(Math.max(PRICE_MIN, snap100(v))));
                      }}
                      placeholder="0"
                      min={PRICE_MIN}
                      step={PRICE_STEP}
                      className="bx-budget-input"
                      inputMode="numeric"
                    />
                  </div>
                  <div className="bx-budget-suffix">whole trip · auto-rounds to ₹{PRICE_STEP}</div>
                  {city && budget > 0 && (
                    <div className={`bx-budget-vs ${budget >= city.avg ? "is-up" : "is-down"}`}>
                      ≈ ₹{budget.toLocaleString("en-IN")} / room / night ·{" "}
                      {budget >= city.avg
                        ? `₹${(budget - city.avg).toLocaleString("en-IN")} above ${form.city} avg`
                        : `₹${(city.avg - budget).toLocaleString("en-IN")} below ${form.city} avg`}
                    </div>
                  )}
                </div>
              </div>

              {/* Probability Dial */}
              {bidStr && (
                <div>
                  <div className="bx-section-h">
                    <span className="bx-section-h-label">AI Acceptance Probability</span>
                    <span className="bx-section-h-rule" />
                  </div>
                  <div className="bx-card">
                    <div className="bx-dial-wrap">
                      <ProbabilityDial
                        pct={bidStr.pct}
                        color={bidStr.color}
                        instant={bidStr.pct >= 90}
                      />
                      <div className="bx-dial-side">
                        <p className="bx-dial-tier" style={{ color: bidStr.color }}>{bidStr.tier}</p>
                        <p className="bx-dial-tip">{bidStr.tip}</p>
                        <span className="bx-dial-eta">
                          <span className="bx-dial-eta-dot" />
                          {bidStr.responseTime}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Cost Breakdown */}
              {budget > 0 && nights > 0 && (
                <div>
                  <div className="bx-section-h">
                    <span className="bx-section-h-label">Estimated Cost Breakdown</span>
                    <span className="bx-section-h-rule" />
                  </div>
                  <div className="bx-card">
                    {/* v172 — bifurcation: total budget → per room/night,
                        + meals, + taxes = grand total. */}
                    <div className="bx-cost-row">
                      <span>Your total trip budget</span>
                      <span className="v">₹{totalBudget.toLocaleString("en-IN")}</span>
                    </div>
                    <div className="bx-cost-row">
                      <span style={{ fontSize: "0.7rem" }}>↳ Per room / per night · {form.rooms} room{form.rooms > 1 ? "s" : ""} × {nights}n</span>
                      <span className="v" style={{ fontSize: "0.74rem" }}>₹{budget.toLocaleString("en-IN")}</span>
                    </div>
                    {mealCostNight > 0 && (
                      <div className="bx-cost-row">
                        <span>+ {MEAL_PLAN_MAP[form.mealPlan]?.label || "Meals"} · {guestsCount} guest{guestsCount > 1 ? "s" : ""} × {nights}n</span>
                        <span className="v">₹{(mealCostNight * nights).toLocaleString("en-IN")}</span>
                      </div>
                    )}
                    <div className="bx-cost-divider" />
                    <div className="bx-cost-row">
                      <span style={{ fontSize: "0.7rem" }}>Taxes ~12%</span>
                      <span className="v" style={{ fontWeight: 500, fontSize: "0.74rem" }}>≈ ₹{Math.round((totalEst + mealCostNight * nights) * 0.12).toLocaleString("en-IN")}</span>
                    </div>
                    <div className="bx-cost-total">
                      <span className="bx-cost-total-l">Grand Total Estimate</span>
                      <span className="bx-cost-total-r">₹{Math.round((totalEst + mealCostNight * nights) * 1.12).toLocaleString("en-IN")}</span>
                    </div>
                    <p style={{ fontSize: "0.62rem", color: "var(--text-muted)", textAlign: "center", marginTop: 8 }}>
                      {form.addons.some((id) => ADDON_SERVICE_MAP[id]?.charge === "paid")
                        ? "Paid add-ons billed separately by the hotel · final price confirmed at acceptance"
                        : "Final price confirmed by hotel at acceptance"}
                    </p>
                  </div>
                </div>
              )}

              {/* v162 — Trip summary card. The old full-screen "AI
                  confidence" hero is gone — the probability dial above
                  already carries the confidence read. */}
              <div className="bx-card bx-review-card">
                <div className="bx-section-h" style={{ margin: "0 0 12px" }}>
                  <span className="bx-section-h-label">Booking Summary</span>
                  <span className="bx-section-h-rule" />
                </div>

                <div className="bx-review-grid">
                  {[
                    { label: "Destination",  value: `${CITY_DATA[form.city]?.emoji || ""} ${form.city}` },
                    { label: "Property",     value: form.propertyTypes.length ? form.propertyTypes.map((id) => PROPERTY_TYPE_MAP[id]?.label || id).join(", ") : "Any type" },
                    { label: "Duration",     value: `${nights} ${nights === 1 ? "night" : "nights"}` },
                    { label: "Check-in",     value: form.checkIn ? new Date(form.checkIn).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "—" },
                    { label: "Check-out",    value: form.checkOut ? new Date(form.checkOut).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "—" },
                    { label: "Guests",       value: `${form.adults} adults${form.children > 0 ? ` + ${form.children}` : ""}` },
                    { label: "Rooms",        value: `${form.rooms} room${form.rooms > 1 ? "s" : ""}` },
                  ].map(({ label, value }) => (
                    <div key={label}>
                      <div className="bx-review-item-label">{label}</div>
                      <div className="bx-review-item-v">{value}</div>
                    </div>
                  ))}
                </div>

                <div className="bx-cost-divider" style={{ margin: "14px 0" }} />

                <div className="bx-review-grid">
                  {[
                    { label: "Room Type",    value: form.roomTypes.map((id) => ROOM_CATEGORY_MAP[id]?.label || id).join(", ") || "Any" },
                    { label: "Bed",          value: BED_TYPES.find(b => b.id === form.bedType)?.label || form.bedType },
                    { label: "View",         value: form.view },
                    { label: "Meal Plan",    value: `${MEAL_PLAN_MAP[form.mealPlan]?.label || form.mealPlan}${mealCostNight > 0 ? ` (+₹${mealCostNight}/night)` : ""}` },
                    ...(form.occasion !== "none" ? [{ label: "Occasion", value: OCCASIONS.find(o => o.id === form.occasion)?.label || form.occasion }] : []),
                  ].map(({ label, value }) => (
                    <div key={label}>
                      <div className="bx-review-item-label">{label}</div>
                      <div className="bx-review-item-v">{value}</div>
                    </div>
                  ))}
                </div>

                {form.addons.length > 0 && (
                  <>
                    <div className="bx-cost-divider" style={{ margin: "14px 0" }} />
                    <div>
                      <div className="bx-review-item-label" style={{ marginBottom: 6 }}>Add-ons &amp; Services</div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {form.addons.map((id) => {
                          const a = ADDON_SERVICE_MAP[id];
                          if (!a) return null;
                          return (
                            <span key={id} className="bx-chip is-selected" style={{ cursor: "default" }}>
                              {a.emoji} {a.label}{a.charge === "paid" ? " 💳" : ""}
                            </span>
                          );
                        })}
                      </div>
                      <p className="bx-budget-suffix" style={{ marginTop: 8 }}>
                        💳 paid services are billed by the hotel as per actuals.
                      </p>
                    </div>
                  </>
                )}

                {/* v129 — Special Requests review row removed alongside the
                    textarea on Step 2. See the comment in the addons section. */}

                <div className="bx-cost-divider" style={{ margin: "14px 0" }} />

                <div className="bx-review-budget">
                  <div>
                    <div className="bx-review-budget-l-l">Total Trip Budget</div>
                    <div className="bx-review-budget-l-v">₹{totalBudget.toLocaleString("en-IN")}</div>
                    <div className="bx-review-budget-l-s">≈ ₹{budget.toLocaleString("en-IN")} / room / night</div>
                  </div>
                  {totalEst > 0 && (
                    <div className="bx-review-budget-r">
                      <div className="bx-review-budget-r-l">Grand Total</div>
                      <div className="bx-review-budget-r-v">₹{Math.round((totalEst + mealCostNight * nights) * 1.12).toLocaleString("en-IN")}</div>
                      <div className="bx-review-budget-l-s" style={{ textAlign: "right" }}>incl. meals + taxes</div>
                    </div>
                  )}
                </div>
              </div>

              {/* Launch button — gambling "all-in" feel */}
              <button onClick={submit} disabled={loading} className="bx-launch-btn">
                {loading ? (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 10, justifyContent: "center" }}>
                    <span style={{
                      width: 16, height: 16,
                      border: "2px solid rgba(43,29,5,0.35)",
                      borderTopColor: "rgba(43,29,5,0.95)",
                      borderRadius: "50%",
                      display: "inline-block",
                      animation: "spin 0.8s linear infinite",
                    }} />
                    Launching Bid…
                  </span>
                ) : (
                  "🚀 Launch Bid Request"
                )}
              </button>

              <p style={{ textAlign: "center", fontSize: "0.7rem", color: "var(--text-muted)", letterSpacing: "0.02em", marginTop: 4 }}>
                Hotels respond within 2–4 hours · No payment required now
              </p>
            </div>
          )}
        </div>

        {/* Navigation */}
        <div className="bx-nav-row">
          {step > 1 && (
            <button onClick={() => goStep(step - 1)} className="bx-nav-back">
              ← Back
            </button>
          )}
          {step < 3 && (
            <button onClick={() => canNext() && goStep(step + 1)} disabled={!canNext()} className="bx-nav-cont">
              {step === 1 ? "Stay details →" : "Set your price →"}
            </button>
          )}
        </div>

        <p style={{ textAlign: "center", fontSize: "0.7rem", color: "var(--text-muted)", marginTop: 14, letterSpacing: "0.02em" }}>
          Step {step} of {STEPS.length} · {STEPS[step - 1]}
        </p>
      </div>

      {/* Luxury Calendar — no specific hotel yet, so we show DEMAND levels. */}
      <LuxuryCalendar
        open={calCfg.open}
        mode={calCfg.mode}
        checkIn={form.checkIn}
        checkOut={form.checkOut}
        rooms={[]}
        city={form.city || "Mussoorie"}
        pricingMode="demand"
        headerBanner={
          form.city ? (
            <>
              📊 Showing <strong>demand in {form.city}</strong>. Typical {city?.demand?.toLowerCase() || "moderate"} demand here — average <strong>₹{(city?.avg || 3000).toLocaleString()}/night</strong> across hotels.
              <span className="lux-cal-banner-sub">
                Pick dates with lower demand for higher acceptance — your bid wins more often.
              </span>
            </>
          ) : (
            <>
              📊 <strong>Pick a city first</strong> to see demand for these dates.
              <span className="lux-cal-banner-sub">
                Demand colors show how likely hotels are to accept your bid on each date.
              </span>
            </>
          )
        }
        onClose={() => setCalCfg(c => ({ ...c, open: false }))}
        onApply={({ checkIn: ci, checkOut: co }) => {
          upd("checkIn", ci);
          upd("checkOut", co);
          if (ci && co) scrollToAutoNext("guests");
        }}
      />

      <style jsx global>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>

      {/* 409 — one-active-bid-per-city. Closes by tap-outside or Cancel,
          updates the existing bid budget in place when the slider is used. */}
      {bidConflict && (
        <ActiveBidConflictSheet
          conflict={bidConflict.conflict}
          flow="place"
          desiredAmount={bidConflict.desiredAmount}
          floorPrice={bidConflict.floorPrice}
          maxBudget={bidConflict.maxBudget}
          onClose={() => setBidConflict(null)}
          onUpdated={() => router.push("/my-bids")}
        />
      )}
    </div>
  );
}
