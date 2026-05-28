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
import { redirectToSignIn, consumeMatchingIntent } from "@/lib/auth-intent";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import LuxuryCalendar from "@/components/LuxuryCalendar";
// v201 — shared premium guest-count picker. Animated figure icons morph
// with the value (1=👤, 2=👫, 3-4=👨‍👩‍👧, 5+=group) + directional value-roll.
// Replaces the inline <Counter> previously declared in this file.
import PremiumGuestPicker, { type GuestKind } from "@/components/PremiumGuestPicker";
// v202 — mobile/tablet Card Stack flow for Step 1. Desktop (>= 1024px)
// keeps the existing inline scrollable list of sub-sections. On mobile
// + tablet, Step 1 collapses into a Tinder/Wallet-style card stack
// v203 — mobile/tablet renders <BidGameZone> for a cinematic
// PlayStation-style game-zone (boot screen → connected stage with
// parallax + GSAP choreography + Web Audio cues + haptics). Desktop
// keeps the legacy inline flow. v202 BidCardStack is preserved as the
// graceful fallback if the game zone ever needs to be killed (single
// import swap restores the older UX).
import BidCardStack, { useIsMobileTablet, type BidCard } from "@/components/BidCardStack";
import BidGameZone from "@/components/BidGameZone";
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
  ROOM_CATEGORY_CAPACITY, minRoomsForGuests,
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
const BID_PROPERTY_PICK: { id: string; label: string; icon: string; photo: string }[] = [
  // v202.2 — `photo` field added. Each URL is a Unsplash photo themed
  // to the property type. The destination + property-type tiles now
  // render photo-only (no emoji bubble inside) per Sachin's v202.1
  // feedback. `icon` stays as a fallback when photo URL 404s — the
  // gold tile + label survives gracefully.
  { id: "hotel",       label: "Hotel",            icon: "🛎",  photo: "https://images.unsplash.com/photo-1566073771259-6a8506099945?w=240&q=70&auto=format&fit=crop" },
  { id: "resort",      label: "Resort",           icon: "🌴",  photo: "https://images.unsplash.com/photo-1582719508461-905c673771fd?w=240&q=70&auto=format&fit=crop" },
  { id: "villa",       label: "Villa",            icon: "🏡",  photo: "https://images.unsplash.com/photo-1613490493576-7fde63acd811?w=240&q=70&auto=format&fit=crop" },
  { id: "cottage",     label: "Cottage",          icon: "🛖",  photo: "https://images.unsplash.com/photo-1452784444945-3f422708fe5e?w=240&q=70&auto=format&fit=crop" },
  { id: "guest_house", label: "Guest House",      icon: "🏠",  photo: "https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=240&q=70&auto=format&fit=crop" },
  { id: "homestay",    label: "Homestay",         icon: "🏘",  photo: "https://images.unsplash.com/photo-1505691938895-1758d7feb511?w=240&q=70&auto=format&fit=crop" },
  { id: "camp",        label: "Camp / Glamping",  icon: "⛺",  photo: "https://images.unsplash.com/photo-1504280390367-361c6d9f38f4?w=240&q=70&auto=format&fit=crop" },
  { id: "bungalow",    label: "Bungalow",         icon: "🏯",  photo: "https://images.unsplash.com/photo-1568605114967-8130f3a36994?w=240&q=70&auto=format&fit=crop" },
  { id: "hostel",      label: "Hostel",           icon: "🎒",  photo: "https://images.unsplash.com/photo-1555854877-bab0e564b8d5?w=240&q=70&auto=format&fit=crop" },
  { id: "treehouse",   label: "Treehouse",        icon: "🌳",  photo: "https://images.unsplash.com/photo-1488462237308-ecaa28b729d7?w=240&q=70&auto=format&fit=crop" },
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
// v202.1 — `photo` field added. Each URL is a Unsplash hi-res landscape
// keyed to the city's natural character (mountain / forest / river /
// snow). The destination card uses it as a circular orb background;
// the emoji stays as a fallback if the URL 404s. Per CLAUDE.md v131.5
// rule: ONLY curl-verified Unsplash IDs on customer surfaces — these
// are tested-good photo IDs from the public landscape collection.
const CITY_DATA: Record<string, { emoji: string; photo: string; avg: number; demand: "Very High" | "High" | "Medium" | "Low"; demandColor: string; tip: string; state: string; tags: string[] }> = {
  Mussoorie:  { emoji: "🏔️", photo: "https://images.unsplash.com/photo-1469474968028-56623f02e42e?w=240&q=72&auto=format&fit=crop", avg: 3200, demand: "High",      demandColor: "text-orange-600 bg-orange-50 border-orange-200", tip: "Weekend & holiday peak — bid early for best rates!",  state: "Uttarakhand",       tags: ["Hill Station", "Honeymoon", "Nature"] },
  Dhanaulti:  { emoji: "🌲", photo: "https://images.unsplash.com/photo-1448375240586-882707db888b?w=240&q=72&auto=format&fit=crop", avg: 2800, demand: "Medium",    demandColor: "text-amber-600  bg-amber-50  border-amber-200",  tip: "Weekdays offer up to 25% better deals here.",         state: "Uttarakhand",       tags: ["Forest", "Peaceful", "Couples"] },
  Rishikesh:  { emoji: "🕉️", photo: "https://images.unsplash.com/photo-1545071677-eea2dbb59f57?w=240&q=72&auto=format&fit=crop", avg: 2400, demand: "High",      demandColor: "text-orange-600 bg-orange-50 border-orange-200", tip: "Yoga retreat season — adventure packages popular.",   state: "Uttarakhand",       tags: ["Adventure", "Spiritual", "Yoga"] },
  Shimla:     { emoji: "❄️", photo: "https://images.unsplash.com/photo-1551582045-6ec9c11d8697?w=240&q=72&auto=format&fit=crop", avg: 3500, demand: "Very High", demandColor: "text-red-600    bg-red-50    border-red-200",    tip: "Peak hill-station demand — book ahead for savings.",  state: "Himachal Pradesh",  tags: ["Snow", "Heritage", "Family"] },
  Manali:     { emoji: "🏂", photo: "https://images.unsplash.com/photo-1605649487212-47bdab064df7?w=240&q=72&auto=format&fit=crop", avg: 3800, demand: "Very High", demandColor: "text-red-600    bg-red-50    border-red-200",    tip: "Adventure season — premium pricing, bid smart.",      state: "Himachal Pradesh",  tags: ["Skiing", "Adventure", "Honeymoon"] },
  Dehradun:   { emoji: "🌿", photo: "https://images.unsplash.com/photo-1503631015414-3527d1e4506f?w=240&q=72&auto=format&fit=crop", avg: 2200, demand: "Low",       demandColor: "text-emerald-600 bg-emerald-50 border-emerald-200", tip: "Low season — great deals & immediate accepts!",    state: "Uttarakhand",       tags: ["Gateway", "Business", "Budget"] },
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
// v208 — SS4/SS5: dropped "Your Stay" step from /bid. The filter/
// preference UI (room type, bed pref, meal plan, view, occasion,
// add-ons) is preserved as a backup at
// `docs/_backups/bid-page-v207-with-your-stay.tsx.bak`. Those features
// will land on the hotel page as a separate modification surface — see
// PR description / commit message.
// Effective flow: 01 Where & When (BidGameZone milestones) →
// 02 Your Price (presets + budget + Launch). Form fields that were set
// in Your Stay (roomTypes, view, mealPlan, occasion, addons) keep
// their initial defaults from form state, so backend submit + price
// calc still work.
const STEPS = ["Where & When", "Your Price"];

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

/* ──────────────────────────────────────────────────────────────────
   v203.2 — gaming-zone character morph for the guests/rooms counters.
   Each count value maps to an emoji string. `key={n}` on the rendering
   element causes React to remount on change → CSS keyframe @bgzCounterPop
   fires from below with a bouncy scale-in. Bigger numbers stack more
   humans / bigger buildings so the UI tells the same story as the number.
────────────────────────────────────────────────────────────────── */
function emojiForCount(kind: "adults" | "children" | "rooms", n: number): string {
  if (n <= 0) return "·";
  if (kind === "adults") {
    if (n === 1) return "🧍";
    if (n === 2) return "👫";
    if (n === 3) return "👨‍👩‍👦";
    if (n === 4) return "👨‍👩‍👧‍👦";
    if (n <= 6) return "👨‍👩‍👧‍👦🧍"; // 5–6 small group
    if (n <= 10) return "👨‍👩‍👧‍👦👨‍👩‍👧"; // 7–10 family + extended
    return "🧑‍🤝‍🧑👨‍👩‍👧‍👦"; // 11+ group event
  }
  if (kind === "children") {
    if (n === 1) return "🧒";
    if (n === 2) return "🧒🧒";
    if (n === 3) return "🧒🧒🧒";
    return "🧒🧒🧒🧒";
  }
  // rooms — building grows from bed to full hotel takeover
  if (n === 1) return "🛏️";
  if (n === 2) return "🏠";
  if (n === 3) return "🏡";
  if (n === 4) return "🏘️";
  if (n <= 6) return "🏨";
  if (n <= 8) return "🏨🏠";
  return "🏨🏨"; // 9–10 floor takeover
}

/* ──────────────────────────────────────────────────────────────────
   DateAutoOpener (v202.2) — opens the LuxuryCalendar exactly once
   on mount when the Dates card slides into view with no check-in
   set. `useRef` guards against repeat fires across re-renders and
   the 80ms RAF defer lets the card-swap animation finish first so
   the calendar doesn't fight the slide-in for paint priority.
────────────────────────────────────────────────────────────────── */
function DateAutoOpener({ shouldOpen, onOpen }: { shouldOpen: boolean; onOpen: () => void }) {
  const firedRef = useRef(false);
  useEffect(() => {
    if (firedRef.current) return;
    if (!shouldOpen) return;
    firedRef.current = true;
    const t = setTimeout(onOpen, 80);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

/* ══════════════════════════════════════════════════════════════════
   Main Component
══════════════════════════════════════════════════════════════════ */
// v241.14 — Session-storage persistence for the bid wizard. Pre-v241.14
// when a customer launched a bid → Review Bid sheet opened → they tapped a
// hotel link to inspect it → back → /bid component remounted with default
// state (step=1, success=null, form reset). Customer was dumped at Step 1
// and lost ALL their in-flight context.
//
// Now we persist {step, success, form} to sessionStorage with a 30-min TTL.
// On remount we restore so the customer lands back exactly where they
// left off — including the Review Bid sheet auto-opening over the form.
// Cleared on Pay handoff (router.replace to /my-bids) or after 30 min.
const SB_BID_SESSION_KEY = "sb_bid_session_v1";
const SB_BID_SESSION_TTL_MS = 30 * 60 * 1000;

type BidSessionSnapshot = {
  step: number;
  success: any;
  form: any;
  savedAt: number;
};

function readBidSession(): BidSessionSnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(SB_BID_SESSION_KEY);
    if (!raw) return null;
    const snap = JSON.parse(raw) as BidSessionSnapshot;
    if (!snap || typeof snap !== "object") return null;
    if (Date.now() - Number(snap.savedAt || 0) > SB_BID_SESSION_TTL_MS) {
      sessionStorage.removeItem(SB_BID_SESSION_KEY);
      return null;
    }
    return snap;
  } catch {
    return null;
  }
}

function writeBidSession(snap: Omit<BidSessionSnapshot, "savedAt">) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(SB_BID_SESSION_KEY, JSON.stringify({ ...snap, savedAt: Date.now() }));
  } catch {}
}

function clearBidSession() {
  if (typeof window === "undefined") return;
  try { sessionStorage.removeItem(SB_BID_SESSION_KEY); } catch {}
}

export default function BidPage() {
  const router = useRouter();
  const { user } = useAuth();
  // v241.14 — Hydrate step + success from sessionStorage on FIRST render
  // (not via useEffect) so the customer doesn't see a Step 1 flash before
  // the restoration kicks in. Lazy initializer reads sessionStorage once.
  const [step, setStep] = useState<number>(() => {
    const snap = readBidSession();
    return (snap && typeof snap.step === "number" && snap.step >= 1) ? snap.step : 1;
  });
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState<any>(() => {
    const snap = readBidSession();
    return snap?.success ?? null;
  });
  const [animating, setAnimating] = useState(false);
  /* v220 — explicit interaction flag for the Guests milestone. Defaults
     for adults/rooms are non-zero (2A · 1R), so the previous
     `isComplete` returned true on page load and the climber's
     completedCount silently skipped past the Guests disc straight to
     Set Price (user report SS3). Forcing the user to tap +/- at least
     once makes Step 4 a real stop, even when they keep the defaults. */
  const [guestsTouched, setGuestsTouched] = useState(false);

  /* v241 — Auto-fit toggle. Default ON. When ON, form.rooms auto-bumps
     to ceil(guests/avgCap) whenever guests/categories change and the
     current rooms count is below the minimum. When OFF, customer can
     mismatch freely — partner inbox surfaces capacityMismatch flag
     and decides counter-vs-decline. Persists per-device. */
  const [autoFit, setAutoFit] = useState(true);
  // Hydrate from localStorage on mount only (avoid SSR hydration drift).
  useEffect(() => {
    try {
      const v = localStorage.getItem("sb_autofit");
      if (v === "0") setAutoFit(false);
    } catch {}
  }, []);
  const setAutoFitPersist = (v: boolean) => {
    setAutoFit(v);
    try { localStorage.setItem("sb_autofit", v ? "1" : "0"); } catch {}
  };
  // v223 — surface submit failures INSIDE the Review modal instead of a
  // blocking alert() that pre-v223 vanished without showing what broke
  // ("baar baar launch bid karte raho same notification aata rahega kuch
  // nhi dikhta"). Reset when user retries from the error UI.
  const [submitError, setSubmitError] = useState<string | null>(null);
  // 409 sheet — populated when any per-hotel placeBid hits the
  // one-active-bid-per-city rail.
  const [bidConflict, setBidConflict] = useState<null | { conflict: BidConflict; desiredAmount: number; floorPrice?: number; maxBudget?: number }>(null);
  // v230 — separates ActiveBidConflictSheet visibility from bidConflict
  // state. Sheet dismissal flips this to false; bidConflict persists so
  // the Step 6 conflict-aware card keeps rendering with hotel name + amount
  // + "View Active Bid →" CTA. Pre-v230 the sheet's onClose nulled the
  // conflict entirely and Step 6 fell back to the generic "Try Again" card.
  const [conflictSheetOpen, setConflictSheetOpen] = useState(false);
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
      // v208 — 2-step page (was 3). Tour indices 0-1 (city/dates) live
      // on page step 1; presets / budget / submit live on page step 2.
      const targetPageStep = toIdx <= 1 ? 1 : 2;
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

  // v241.14 — Hydrate form lazily from sessionStorage too. Customer's
  // city/dates/guests/budget all preserved across the
  // /bid → /hotels/[id] → back roundtrip.
  type BidFormState = {
    city: string;
    propertyTypes: string[];
    checkIn: string;
    checkOut: string;
    adults: number;
    children: number;
    rooms: number;
    roomTypes: string[];
    bedType: string;
    view: string;
    mealPlan: string;
    occasion: string;
    maxBudget: string;
    addons: string[];
  };
  const [form, setForm] = useState<BidFormState>(() => {
    const defaults: BidFormState = {
      city:           "",
      propertyTypes:  [],
      checkIn:        "",
      checkOut:       "",
      adults:         2,
      children:       0,
      rooms:          1,
      roomTypes:      ["deluxe"],
      bedType:        "king",
      view:           "Any",
      mealPlan:       "breakfast",
      occasion:       "none",
      maxBudget:      "",
      addons:         [],
    };
    const snap = readBidSession();
    return snap?.form ? { ...defaults, ...snap.form } : defaults;
  });

  // v241.14 — Persist {step, success, form} on every change so the
  // customer's in-flight wizard state survives the /hotels/[id]
  // round-trip. Throttled to once per state-change tick via React's
  // built-in batching. Persistence is cleared on Pay handoff
  // (router.replace to /my-bids) so the next launch starts fresh.
  useEffect(() => {
    writeBidSession({ step, success, form });
  }, [step, success, form]);

  // v170 — toggle a value in/out of one of the array fields.
  const toggleArr = (key: "propertyTypes" | "roomTypes" | "addons", val: string) =>
    setForm((f) => {
      const arr = f[key];
      return { ...f, [key]: arr.includes(val) ? arr.filter((x) => x !== val) : [...arr, val] };
    });

  // v187 — Phase 5: smart auto-scroll for multi-select sections. Fires
  // ONLY when adding (not removing) a pick takes the count from below
  // the section's min threshold to exactly the threshold.
  // v227 — Property threshold relaxed from 3 → 1. Sachin's report: in
  // some cities the user could only pick 1-2 types that actually exist,
  // and the "must pick 3" wall blocked them. One pick is enough to
  // continue; zero picks = "Any type" (broadest auction).
  const toggleProperty = (id: string) => {
    const wasSelected = form.propertyTypes.includes(id);
    toggleArr("propertyTypes", id);
    if (!wasSelected && form.propertyTypes.length + 1 >= 1) {
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

  // v202 — mobile/tablet flag drives the Card Stack render path for
  // Step 1 sub-sections. Desktop (>= 1024px) reads the existing inline
  // sub-sections; mobile/tablet swap into <BidCardStack>. SSR-safe —
  // returns false on first render so the server-rendered markup
  // matches the desktop path.
  const isMobile = useIsMobileTablet();

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

  // v241 — Auto-fit hook. Compute min rooms needed for the current
  // guest count + selected categories. When autoFit is ON and form.rooms
  // is below the minimum, silently bump it. When OFF, render a soft
  // warning chip below the rooms counter so customer sees the mismatch.
  // Capped at 10 (the Counter's max). Re-evaluates on every form
  // change.
  const totalGuests  = form.adults + form.children;
  const minRooms     = minRoomsForGuests(totalGuests, form.roomTypes || []);
  const cappedMinRooms = Math.min(10, minRooms);
  const roomsShortBy = Math.max(0, cappedMinRooms - form.rooms);
  // v241.14 — Symmetric auto-fit. Previously this effect only INCREASED
  // rooms when guests grew (`cappedMinRooms > form.rooms`), never
  // decreased on the way down. Customer reported: "guest add karne par
  // room add hote hain, kam karne par kam nahi hote — mismatch". With
  // autoFit ON the rooms count should track the guest-derived minimum
  // both directions (1-10 bounded). If the customer wants to over-book
  // rooms beyond the minimum, they toggle autoFit OFF.
  useEffect(() => {
    if (!autoFit) return;
    const target = Math.max(1, Math.min(10, cappedMinRooms));
    setForm((f) => (f.rooms === target ? f : { ...f, rooms: target }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFit, cappedMinRooms]);
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

  /* v224 — pre-warm the hot Next.js routes that submit() calls so when
     the user finally taps Launch Bid on Step 5, the lambdas are warm
     and the dataset is in sb-cache (60s TTL). This is the single
     biggest reason Sachin saw "kuch nhi hota" on v220-v222: a cold
     lambda + cold Supabase round-trip could take 3-8s, and the user
     never saw any progress. Now hotels are pre-fetched on mount, then
     re-fetched on city change. Fire-and-forget — no error handling,
     no UI effect, just a wakeup ping. */
  useEffect(() => {
    if (typeof window === "undefined") return;
    // Wake the /api/hotels lambda + warm sb-cache for the picked city.
    /* v225 — fix malformed URL when city is empty (`/api/hotels&limit=5`).
       Build query string properly with URLSearchParams. */
    const q = new URLSearchParams({ limit: "5" });
    if (form.city) q.set("city", form.city);
    fetch(`/api/hotels?${q.toString()}`).catch(() => {});
  }, [form.city]);

  /* ── v203.3 — Property types available in the picked city ─────────
     Per Sachin's SS3 feedback: when a city is selected, only show
     property types that ACTUALLY exist in that city. A "treehouse" tile
     in Dehradun (where no treehouse hotel is listed) is dead weight
     that confuses the user and lets them pick a type that will throw
     "No matches" at submit time.

     null = no city yet OR fetch failed → show all types (safe fallback).
     Set<string> = the canonical hotel.property_type values found in the
     city's hotel list.

     Also strips any picks no longer available after a city change so
     the user can't carry a stale selection forward. */
  const [availablePropertyTypes, setAvailablePropertyTypes] = useState<Set<string> | null>(null);
  useEffect(() => {
    if (!form.city) {
      setAvailablePropertyTypes(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const resp: any = await api.getHotels({ city: form.city });
        if (cancelled) return;
        const list: any[] = resp?.hotels || resp || [];
        const cityLower = form.city.toLowerCase();
        const cityHotels = list.filter(
          (h: any) => (h.city || "").toLowerCase() === cityLower
        );
        if (cityHotels.length === 0) {
          // City has no hotels — fall back to showing all so user can
          // still pick something instead of seeing an empty grid.
          setAvailablePropertyTypes(null);
          return;
        }
        const types = new Set<string>(
          cityHotels.map((h: any) => h.property_type || "hotel")
        );
        setAvailablePropertyTypes(types);
        // Strip stale picks that no longer match the new city.
        setForm((f) => {
          if (!f.propertyTypes.length) return f;
          const kept = f.propertyTypes.filter((id) => types.has(id));
          if (kept.length === f.propertyTypes.length) return f;
          return { ...f, propertyTypes: kept };
        });
      } catch {
        if (!cancelled) setAvailablePropertyTypes(null);
      }
    })();
    return () => { cancelled = true; };
  }, [form.city]);

  // v203.3 — Helper applied at every BID_PROPERTY_PICK render site so
  // the filter logic lives in ONE place. Falls back to the full list
  // when no city is picked OR the city has no derivable types.
  const visiblePropertyTypes = availablePropertyTypes
    ? BID_PROPERTY_PICK.filter((pt) => availablePropertyTypes.has(pt.id))
    : BID_PROPERTY_PICK;

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

  /* v222 — per-route theme-color match so the OS status bar blends
     into the climber's dark mountain backdrop. layout.tsx sets the
     global theme-color to `#07060e` (very dark cool blue) which is
     the right color for the reel feed. /bid's climber bg starts at
     `#14110b` (very dark warm brown) — close but the seam is visible
     to a sharp eye, especially when the photo's sky has warm dawn
     tones at the top (user report SS1/SS2: "upar se screen cut ho
     gyi"). Update meta theme-color on mount, restore on unmount. */
  useEffect(() => {
    if (typeof document === "undefined") return;
    const meta = document.querySelector('meta[name="theme-color"]');
    const prev = meta?.getAttribute("content") || "#07060e";
    if (meta) meta.setAttribute("content", "#14110b");
    return () => {
      if (meta) meta.setAttribute("content", prev);
    };
  }, []);

  /* v220 — bridge the Set Price modal close + Review Bid modal open
     after submit() succeeds. Pre-v220 the Set Price sheet stayed open
     after Launch Bid tap (price card has autoAdvance: false) and the
     user had to dismiss it manually then tap Step 6, by which time
     they assumed the bid never launched (user reports SS1 + SS2).
     The window event is consumed by ClimberMilestoneMap which swaps
     sheetIdx 4 (Price) → 5 (Review) atomically, so the live bid
     panel appears the instant `success` populates. */
  useEffect(() => {
    if (!success || typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent("sb:cmm-open-sheet", { detail: { idx: 5 } }));
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
    // v208 — SS4/SS5: 2-step page. Step 2 IS the final step (launch
    // lives inside). Step 1 unchanged (city/dates/property types).
    // The old step===2 "≥2 room types" rule is gone with Your Stay.
    // v227 — property minimum dropped 3 → 0. Zero picks = "Any type"
    // and the bid lands across every property type in the city. The
    // submit() property-type filter is now SOFT (falls back to all
    // matching hotels if no city hotel offers the picked types), so
    // there's no need to gate the Continue button on a minimum count.
    if (step === 1) return !!(form.city && form.checkIn && form.checkOut && nights >= 1);
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
    // v226 — surface the auth gate in the Review modal BEFORE redirecting.
    // Pre-v226 a logged-out user tapping Launch Bid silently navigated to
    // /auth with no breadcrumb — the Review modal was left on the hourglass
    // ("Launch your bid first") branch with no error card, no spinner.
    // Setting submitError first means even if router.push races, the modal
    // shows a real reason on its way out.
    if (!user) {
      // v241.3 — save the entire /bid form to the pending-intent layer
      // so after sign-in the user lands back here AND the form is
      // restored verbatim. action="bid_launch" tells the mount effect
      // to auto-fire submit() once the user is signed in.
      setSubmitError("Please sign in to launch your bid. Redirecting…");
      redirectToSignIn(router, {
        route: "/bid",
        action: "bid_launch",
        payload: { form },
      });
      return;
    }
    setLoading(true);
    setSubmitError(null);
    /* v224 — track WHICH step of the submit pipeline died so the v223
       error card can tell the user something useful instead of a
       generic "Could not reach hotels". Sachin's v222 report was that
       the modal showed nothing — alert() was firing but dismissing
       without notice. v223 surfaces the bare message; v224 prefixes
       it with the step name. */
    let submitStep = "starting up";
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
      submitStep = `finding hotels in ${form.city}`;
      const hotelsResp = await api.getHotels({ city: form.city });
      const allHotels = hotelsResp.hotels || [];
      const cityLower = form.city.toLowerCase();
      let matching = allHotels.filter((h: any) => {
        const hc = (h.city || "").toLowerCase();
        return hc === cityLower || hc.includes(cityLower) || cityLower.includes(hc);
      });
      // Fallback: if server-side filter returned nothing useful, use whatever the server gave us
      if (matching.length === 0 && allHotels.length > 0) matching = allHotels.slice(0, 3);

      // v227 — property-type filter softened from HARD to SOFT.
      // Sachin's report: in Dhanaulti picking 3 types like
      // (villa, cottage, homestay) used to throw because Dhanaulti
      // hotels are all `resort` / `lodge` / `camp` / `hotel`. The
      // customer's bid never launched — same UX as a one-bid-one-city
      // conflict. The original v170 HARD filter explicitly said
      // "no wrong-category hotel ever". v227 keeps that intent when
      // matches exist, but falls back to ALL city hotels when zero
      // match so the auction launches. Customer's preference is still
      // recorded in `requirements` so the hotel sees what was asked.
      if (form.propertyTypes.length) {
        const pf = matching.filter((h: any) =>
          form.propertyTypes.includes(h.property_type || "hotel")
        );
        if (pf.length > 0) matching = pf;
        // else: leave `matching` as-is (every city hotel competes).
      }

      // v227 — meal-plan filter softened from HARD to SOFT for the
      // same reason. Customer's meal preference still flows through
      // `requirements` so hotels see it; this just stops a blank
      // meal-plan column on a few hotels from killing the auction.
      if (form.mealPlan && form.mealPlan !== "room_only") {
        const mf = matching.filter((h: any) =>
          Array.isArray(h.meal_plans) && h.meal_plans.includes(form.mealPlan)
        );
        if (mf.length > 0) matching = mf;
        // else: every city hotel competes — fall through to the
        // existing v164 hotel-class soft filter below.
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
      submitStep = `broadcasting your bid to ${matching.length} hotel${matching.length === 1 ? "" : "s"}`;
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
            // v240 — Stamp source at request-creation so /my-bids can
            // server-authoritatively bucket this row under "Place Bid"
            // via b.request.source === 'place'. Replaces the v234
            // message-regex detection that broke whenever message
            // changed shape.
            source: "place",
            // v241 — Carry the customer's room-count through to
            // bid_requests.numRoomsRequested so /my-bids charge math
            // can multiply correctly + partner inbox shows the ask.
            numRooms: form.rooms,
          });

          const requestId = reqRes?.request?.id;
          const roomsLabel = form.rooms > 1 ? ` × ${form.rooms} rooms` : "";
          const baseMessage = `Guest bid ₹${dealPrice}/night for ${nights} night${nights > 1 ? "s" : ""}${roomsLabel} (max ₹${budget})${requirements ? ". " + requirements : ""}`;

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
              // v241 — per-bid numRooms + guests for server-side
              // capacityMismatch resolution against hotel-specific
              // room.capacity. Inventory check (numRooms > quantity)
              // would 409 here just like the existing one-bid-per-hotel
              // conflict; bubbled to the outer catch.
              numRooms: form.rooms,
              guests,
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
                numRooms: form.rooms,
                guests,
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
          // v230 — explicitly open the sheet on first conflict firing.
          // Dismissing the sheet doesn't null bidConflict anymore, so the
          // Step 6 conflict-aware card with hotel name + amount + View
          // Active Bid CTA keeps rendering.
          setConflictSheetOpen(true);
          // v226 — also surface a reason in the Review modal as belt-and-
          // braces. Pre-v226 the conflict sheet opened on top but the
          // underlying Review modal stayed on the hourglass branch (no
          // success, no submitError). If the user dismissed the sheet, the
          // hourglass made it look like nothing happened.
          setSubmitError(
            "You already have an active bid in this city. Tap below to update or cancel.",
          );
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
      /* v224 — prefix the error with the step so user sees WHAT broke
         instead of "Could not reach hotels". Also log to console so
         dev tools / Sachin's debug session has the full stack. */
      const rawMsg = e?.message || "Network glitch";
      const friendly = `Stuck while ${submitStep}: ${rawMsg}`;
      // eslint-disable-next-line no-console
      console.error("[/bid submit failed]", { step: submitStep, error: e });
      setSubmitError(friendly);
    } finally {
      setLoading(false);
    }
  };

  /* v241.3 — Resume Launch Bid after sign-in.
     Pre-v241.3 a logged-out user tapping Launch Bid lost their entire
     form (city/dates/guests/rooms/budget) when redirected to /auth.
     Now redirectToSignIn() captures `{form}` in the pending intent;
     this effect detects the matching intent on mount, hydrates the
     form, and auto-fires submit() so the customer just sees "Launching
     your bid…" without retyping anything. */
  useEffect(() => {
    if (!user) return;
    const intent = consumeMatchingIntent("bid_launch");
    if (!intent?.payload?.form) return;
    try {
      setForm(intent.payload.form);
      // Defer submit one tick so React commits the restored form
      // first, otherwise submit() would read stale state.
      setTimeout(() => { submit(); }, 50);
    } catch { /* corrupt payload — skip silently */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  /* ─────────────── Success Screen (winners' circle) ─────────────── */
  /* v210 — Success overlay on the SAME climbing page (mobile).
     Sachin's ask: "launch bid hone ke baad jo page show hota hai isho
     bhi ek ish page par tag karo koi next page nhi". Pre-v210 this was
     a full-screen early-return that replaced the climbing map, so
     pressing back returned to the boot screen (BidGameZone remounted).
     v210 fix: on mobile we KEEP rendering the page below (climbing map
     stays mounted, all 5 milestones DONE, climber at peak), and overlay
     the celebration + live auction as a fixed-position portal.
     v223 — desktop full-page takeover disabled. User's v222 report was
     "destop par launch bid karte ho review show ho jata hai next page
     na ki wahi same page par show ho". Desktop now falls through to the
     same single-page climber flow as mobile — milestone 6 (Review Bid
     & Visit) auto-opens via the sb:cmm-open-sheet event from submit().
     Block kept with `&& false` mirror of v217 idiom in case we ever
     need to revert. */
  if (success && !isMobile && false) {
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
                onGrab={(bid) => { clearBidSession(); router.replace(`/my-bids?payNow=${bid}#bid-${bid}`); }}
              />
            ))}
          </div>

          <p className="bx-live-note">
            ✓ Every price here is <strong>below the market rate</strong> — lowest anywhere, guaranteed. Accepted offers are <strong>held 15 minutes</strong>; tap a hotel to lock your booking.
          </p>

          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 4 }}>
            <button onClick={() => { clearBidSession(); router.push("/my-bids"); }} className="bx-launch-btn" style={{ padding: "14px 18px", fontSize: "1.05rem" }}>
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

  /* ─────────────── v202 BidCardStack — Step 1 mobile cards ───────────
     Built per render so closures over `form` / `nights` / `city` stay
     fresh. The cards reuse the existing `bx-*` Tailwind+CSS surface
     classes (orbs, date buttons, guest-row) so visually nothing
     regresses — only the LAYOUT (one card at a time + breadcrumb
     chips + sticky CTA) is new. Property type uses the SAME 3-pick
     validation as the desktop path. */
  const step1Cards: BidCard[] = [
    {
      key: "destination",
      icon: "🌍",
      title: "Where do you want to stay?",
      hint: "Pick a city to see hotels listening tonight",
      isComplete: () => !!form.city,
      summary: () => `📍 ${form.city}`,
      autoAdvance: true,
      autoAdvanceDelayMs: 380,
      render: () => (
        <>
          {/* v203.2 — borderless circular city AVATARS (gaming-zone
              feel), not bordered photo boxes. Selected avatar gets a
              champagne conic-gradient halo + sparkle; "Hot" cities get
              a pulsing red dot top-right. Float ambient via parent
              .bgz-city-grid's stagger animation. */}
          <div className="bgz-city-grid">
            {Object.entries(CITY_DATA).map(([name, info]) => {
              const isSelected = form.city === name;
              const isSurge = info.demand === "Very High" || info.demand === "High";
              return (
                <button
                  key={name}
                  type="button"
                  onClick={() => upd("city", name)}
                  className={`bgz-city-avatar ${isSelected ? "is-selected" : ""}`}
                  title={`${name} · ${info.demand} demand`}
                >
                  <span className="bgz-city-halo" aria-hidden="true" />
                  <span className="bgz-city-disc">
                    <img
                      src={info.photo}
                      alt={name}
                      className="bgz-city-img"
                      loading="lazy"
                      onError={(e) => {
                        const t = e.currentTarget as HTMLImageElement;
                        if (t.dataset.fallback) return;
                        t.dataset.fallback = "1";
                        t.src = `https://picsum.photos/seed/${encodeURIComponent(name)}/240/240`;
                      }}
                    />
                  </span>
                  {isSurge && (
                    <span className="bgz-city-hot" aria-hidden="true">
                      <span className="bgz-city-hot-pulse" />
                    </span>
                  )}
                  <span className="bgz-city-label">{name}</span>
                </button>
              );
            })}
          </div>
          {city && (
            <div className="bx-insight" style={{ marginTop: 12 }}>
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
        </>
      ),
    },
    {
      key: "propertyType",
      icon: "🏨",
      title: "What kind of property?",
      hint: "Pick any types (optional) — leave blank for all types",
      // v227 — property is now optional. Zero picks = "Any type"; one
      // or more picks acts as a SOFT preference (submit() falls back
      // to all city hotels if none match).
      isComplete: () => true,
      summary: () => form.propertyTypes.length ? `${form.propertyTypes.length} types` : "Any type",
      autoAdvance: false,
      autoAdvanceDelayMs: 760,
      render: () => (
        <>
          {/* v203.2 — 3D metallic icon discs for each property type
              (gaming-category selection feel, not CAPTCHA photos). Each
              disc has a radial highlight, a rotating sheen overlay
              (mix-blend-mode screen for metallic shimmer), gold rim on
              selection, and a soft drop shadow. Emoji is large + centered. */}
          <div className="bgz-prop-grid">
            {visiblePropertyTypes.map((pt) => {
              const isSelected = form.propertyTypes.includes(pt.id);
              return (
                <button
                  key={pt.id}
                  type="button"
                  onClick={() => toggleProperty(pt.id)}
                  className={`bgz-prop-tile ${isSelected ? "is-selected" : ""}`}
                  title={pt.label}
                >
                  <span className="bgz-prop-disc" aria-hidden="true">
                    <span className="bgz-prop-glyph">{pt.icon}</span>
                    <span className="bgz-prop-sheen" />
                  </span>
                  <span className="bgz-prop-label">{pt.label}</span>
                  {isSelected && <span className="bgz-prop-check" aria-hidden="true">✓</span>}
                </button>
              );
            })}
          </div>
          <p className="bgz-prop-tally">
            {form.propertyTypes.length > 0
              ? `✓ Bid prefers ${form.propertyTypes.length} ${form.propertyTypes.length === 1 ? "type" : "types"} (falls back to all if none match)`
              : `Any type · bid will reach every property in ${form.city || "this city"}`}
          </p>
        </>
      ),
    },
    {
      key: "dates",
      icon: "📅",
      title: "When are you travelling?",
      hint: "Pick check-in and check-out dates",
      isComplete: () => !!(form.checkIn && form.checkOut && nights >= 1),
      summary: () => {
        if (!form.checkIn || !form.checkOut) return "Dates";
        const ci = new Date(form.checkIn).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
        const co = new Date(form.checkOut).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
        return `${ci} → ${co} · ${nights}n`;
      },
      autoAdvance: true,
      autoAdvanceDelayMs: 540, // wait for calendar sheet to close cleanly
      render: (ctx) => (
        <div className="bx-card">
          {/* v203 — auto-open calendar ONLY on FORWARD arrival to the
              Dates card. `firstReach` is the BidGameZone-supplied flag
              that's true the first time the user lands on this card.
              When the user swipes BACK from a later card, firstReach is
              false → no re-open → no fight with back navigation. The
              legacy BidCardStack doesn't pass `firstReach` (undefined)
              so we treat undefined as "first reach" to preserve old
              behaviour on desktop / older renderers. */}
          <DateAutoOpener
            shouldOpen={!form.checkIn && (ctx as { firstReach?: boolean }).firstReach !== false}
            onOpen={() => setCalCfg({ open: true, mode: "checkIn" })}
          />
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
            <div style={{ textAlign: "center", marginTop: 12 }}>
              <span className="bx-nights-pill">
                {nights} {nights === 1 ? "night" : "nights"}
              </span>
            </div>
          )}
        </div>
      ),
    },
    {
      key: "guests",
      icon: "👥",
      title: "Who's coming?",
      hint: "Adults, children + how many rooms",
      /* v220 — require an explicit user interaction (any +/- tap). Without
         this, defaults (2A · 1R) made this card auto-complete and the
         climber camera teleported past Step 4 straight to Set Price. */
      isComplete: () => form.adults >= 1 && form.rooms >= 1 && guestsTouched,
      summary: () => `${form.adults}A${form.children ? ` + ${form.children}C` : ""} · ${form.rooms}R`,
      render: () => (
        // v203.2 — gaming-zone character morph counters. Each row shows
        // a big animated emoji that JUMPS up from below every time the
        // count changes (via React `key` remount + @keyframes
        // bgzCounterPop). The emoji reflects the count: 1 guest = solo
        // person, 2 = couple, 3+ = family. Rooms grow from bed → house
        // → villa → multiple buildings → resort hotel.
        <div className="bgz-counter-stack">
          {([
            // v241 — rooms cap 5 → 10 + adults cap 10 → 15 for group
            // bookings. "11+ rooms? Talk to concierge →" CTA below
            // routes to WhatsApp for genuinely large group needs that
            // need bespoke pricing.
            { label: "Adults",   key: "adults"   as const, min: 1, max: 15, sub: "12+ yrs" },
            { label: "Children", key: "children" as const, min: 0, max: 6,  sub: "5-12 yrs" },
            { label: "Rooms",    key: "rooms"    as const, min: 1, max: 10, sub: "1 per family" },
          ]).map(({ label, key, min, max, sub }) => {
            const n = (form as any)[key] as number;
            return (
              <div className="bgz-counter-row" key={key}>
                <button
                  type="button"
                  className="bgz-counter-btn"
                  onClick={() => { upd(key, Math.max(min, n - 1)); setGuestsTouched(true); }}
                  disabled={n <= min}
                  aria-label={`Decrease ${label}`}
                >−</button>
                <div className="bgz-counter-stage">
                  <div className="bgz-counter-emoji" key={n}>{emojiForCount(key, n)}</div>
                  <div className="bgz-counter-meta">
                    <span className="bgz-counter-n" key={`n-${n}`}>{n}</span>
                    <span className="bgz-counter-label">{label}</span>
                    <span className="bgz-counter-sub">{sub}</span>
                  </div>
                </div>
                <button
                  type="button"
                  className="bgz-counter-btn"
                  onClick={() => { upd(key, Math.min(max, n + 1)); setGuestsTouched(true); }}
                  disabled={n >= max}
                  aria-label={`Increase ${label}`}
                >＋</button>
              </div>
            );
          })}
          {/* v241 — Auto-fit assistant. ON (default): silently bumps
              rooms when guests outnumber capacity × rooms (effect
              above). OFF: shows the warning so the customer knows
              their config will likely be declined / counter-with-more-
              rooms by hotels. The chip also surfaces when 11+ rooms
              are needed — over the regular flow's cap. */}
          <div style={{
            display: "flex", flexDirection: "column", gap: 8,
            marginTop: 12, padding: "10px 12px",
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(201,166,107,0.22)",
            borderRadius: 10,
          }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "0.78rem", color: "var(--text-soft, rgba(255,255,255,0.78))", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={autoFit}
                onChange={(e) => setAutoFitPersist(e.target.checked)}
                style={{ width: 16, height: 16, accentColor: "#C9A66B" }}
              />
              <span>Auto-fit rooms to guests</span>
              <span style={{ marginLeft: "auto", fontSize: "0.65rem", color: "var(--cozy-champagne, #C9A66B)" }}>
                {autoFit ? "ON" : "OFF"}
              </span>
            </label>
            {autoFit && cappedMinRooms > 1 && form.rooms === cappedMinRooms && totalGuests > 2 && (
              <p style={{ fontSize: "0.7rem", color: "var(--text-muted, rgba(255,255,255,0.55))", margin: 0, lineHeight: 1.4 }}>
                ✨ Auto-set to {form.rooms} rooms for {totalGuests} guests
              </p>
            )}
            {!autoFit && roomsShortBy > 0 && (
              <p style={{ fontSize: "0.7rem", color: "#D49583", margin: 0, lineHeight: 1.4 }}>
                ⚠️ {totalGuests} guests in {form.rooms} room{form.rooms > 1 ? "s" : ""} — most hotels will decline. Recommended: {cappedMinRooms} rooms.
              </p>
            )}
            {minRooms > 10 && (
              <a
                href={`https://wa.me/918881555188?text=${encodeURIComponent(`Hi, I need ${minRooms}+ rooms for ${totalGuests} guests. Please help me plan a group booking.`)}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: "inline-flex", alignItems: "center", gap: 6,
                  fontSize: "0.7rem", color: "var(--cozy-champagne, #C9A66B)",
                  textDecoration: "underline",
                }}
              >
                🏨 Need {minRooms}+ rooms? Talk to concierge →
              </a>
            )}
          </div>
        </div>
      ),
    },
    /* ─────────── v209 — 5th milestone: Your Price ───────────
       Folds the old Step 2 (Your Price) into the climbing map so the
       customer never leaves the same page. AI Smart Presets above,
       Total Trip Budget input below. Done state shows the picked
       amount. When this 5th milestone completes, the PEAK unlocks —
       tapping it fires submit() directly (no goStep(2)). */
    {
      key: "price",
      icon: "💰",
      title: "Set your price",
      hint: "Pick a preset or type your total trip budget",
      isComplete: () => budget > 0,
      summary: () => (budget > 0 ? `₹${budget.toLocaleString("en-IN")}` : "—"),
      autoAdvance: false, // manual Done — let the user adjust freely
      /* v216 — Set Price's CTA fires submit() directly (kept from v211).
         After submit succeeds, parent state advances and milestone 6
         "Review Bid & Visit" auto-opens to host the live-auction panel,
         then milestone 7 "Pay & Grab" hosts the payment gateway. This
         keeps the customer on the same climber surface from city pick
         all the way to the booking grab — no page jumps. */
      /* v220 — visible loading state on the CTA. Pre-v220 the button
         label stayed "🚀 Launch Bid" through the async submit() round-
         trip with no spinner, so users tapped, saw nothing change, and
         dismissed the sheet thinking it didn't fire (SS1). Cards array
         is rebuilt every render so the closure over `loading` stays
         fresh and the label flips in real time. */
      doneLabel: loading ? "⏳ Launching…" : "🚀 Launch Bid",
      onDoneClick: () => {
        if (loading) return;
        /* v222 — open the Review Bid sheet IMMEDIATELY (don't wait for
           submit to complete). Railway free-tier cold-start can take
           20-30s — keeping the user stuck on a "Launching…" button
           that long made them give up (v221 user report: "fir se wahi
           hold rahta hai kuch nhi badalta"). Now they see the live-
           auction panel right away with a spinner that fills in as
           hotels respond. submit() runs in the background; when
           success populates, the existing useEffect[success] is a
           no-op (already on idx=5), and the live bid list takes over
           from the spinner.
           v223 — clear any stale submitError so the Review modal opens
           on the spinner state, not on a leftover error card. */
        setSubmitError(null);
        void submit();
        if (typeof window !== "undefined") {
          setTimeout(() => {
            window.dispatchEvent(new CustomEvent("sb:cmm-open-sheet", { detail: { idx: 5 } }));
          }, 80);
        }
      },
      render: () => (
        <div className="bx-card" style={{ background: "transparent", border: "none", padding: 0 }}>
          {city && presets.length > 0 && (
            <>
              <div className="bx-section-h" style={{ margin: "0 0 8px" }}>
                <span className="bx-section-h-label">🤖 AI Smart Presets</span>
                <span className="bx-section-h-rule" />
              </div>
              <div className="bx-preset-row" style={{ marginBottom: 14 }}>
                {presets.map((p) => (
                  <button
                    key={p.label}
                    type="button"
                    onClick={() => {
                      upd("maxBudget", String(p.amount));
                      setTierPick(p.tier);
                    }}
                    className={`bx-preset ${
                      parseInt(form.maxBudget) === p.amount ? "is-selected" : ""
                    } ${p.recommended ? "is-recommended" : ""}`}
                  >
                    {p.recommended && <span className="bx-preset-tag">Recommended</span>}
                    <span className="bx-preset-icon">{p.icon}</span>
                    <div className="bx-preset-label">{p.label}</div>
                    <div className="bx-preset-amount">
                      ₹{p.amount.toLocaleString("en-IN")}
                    </div>
                    <div className="bx-preset-desc">{p.desc}</div>
                  </button>
                ))}
              </div>
            </>
          )}

          <div className="bx-section-h" style={{ margin: "0 0 8px" }}>
            <span className="bx-section-h-label">
              Your Total Trip Budget <span className="bx-section-h-required">*</span>
            </span>
            <span className="bx-section-h-rule" />
          </div>
          <div className="bx-budget-wrap">
            <div className="bx-budget-eyebrow">
              Total for {form.rooms} room{form.rooms > 1 ? "s" : ""} × {Math.max(1, nights)} night
              {nights !== 1 ? "s" : ""}
            </div>
            <div className="bx-budget-row">
              <span className="bx-budget-cur">₹</span>
              <input
                type="number"
                value={form.maxBudget}
                onChange={(e) => upd("maxBudget", e.target.value)}
                onBlur={(e) => {
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
            <div className="bx-budget-suffix">
              whole trip · auto-rounds to ₹{PRICE_STEP}
            </div>
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
      ),
    },
    /* ─────────── v217 — 6th milestone: Review Bid & Visit ───────────
       Auto-completes when `success` is set (submit succeeded). User can
       tap the disc to see the live auction panel — hotels stream in
       with view-hotel + pay CTAs. Lives ON the same climber page; no
       jump to /my-bids. */
    {
      key: "review",
      icon: "🔍",
      title: "Review Bid & Visit",
      hint: "Tap 🚀 Launch Bid in Step 5 first",
      isComplete: () => success !== null,
      summary: () => success ? `${success.hotelsNotified} hotels bidding` : "—",
      autoAdvance: false,
      doneLabel: "Continue to Pay ›",
      render: () => {
        if (!success) {
          /* v223 — error branch FIRST so a failed submit surfaces in the
             same modal instead of vanishing silently. User's v222 report
             was "spinner aata hai phir kuch nhi" — submit() catch was
             alert()-ing but on mobile the alert can dismiss without the
             user noticing, and the modal was stuck on the spinner. Now
             a failure flips to an error card with the actual reason +
             a Try Again button that calls submit() inline. */
          if (submitError && !loading) {
            // v228 — when the failure was a city-conflict 409, show a
            // conflict-specific card with "View Active Bid →" CTA instead
            // of the generic "Couldn't reach hotels · Try Again". Sachin's
            // feedback: "already launch bid ka message show hona chahiye
            // na ush bid ko view karne ke liye". Old card kept verbatim
            // for every other failure mode (network, auth, hotel filter
            // mismatch, etc.) so non-conflict errors still surface fully.
            if (bidConflict) {
              const c = bidConflict.conflict;
              const currentAmt = Number(c.counterAmount || c.amount || 0);
              return (
                <div style={{ padding: "24px 16px", textAlign: "center", color: "var(--cozy-cocoa)" }}>
                  <div style={{ fontSize: "2.4rem", marginBottom: 8 }}>🎯</div>
                  <div style={{ fontWeight: 700, fontSize: "1.05rem", marginBottom: 6 }}>
                    You already have an active bid in {c.city || form.city}
                  </div>
                  <div style={{
                    fontSize: "0.86rem",
                    color: "var(--cozy-cocoa-soft)",
                    lineHeight: 1.5,
                    marginBottom: 14,
                  }}>
                    One bid per city — your {c.hotelName ? `${c.hotelName} ` : ""}bid at <strong style={{ color: "#c9911a" }}>₹{currentAmt.toLocaleString("en-IN")}/night</strong> is still live. View it to update the budget or cancel before launching a new one.
                  </div>
                  <button
                    type="button"
                    onClick={() => router.push(`/my-bids#bid-${c.bidId}`)}
                    style={{
                      padding: "11px 26px",
                      borderRadius: 999,
                      fontWeight: 700,
                      fontSize: "0.92rem",
                      background: "linear-gradient(135deg,#b8871a,#f0b429 55%,#c9911a)",
                      color: "var(--cozy-warm-dark)",
                      border: "1px solid rgba(110,84,48,0.35)",
                      boxShadow: "0 3px 10px rgba(110,84,48,0.18)",
                      cursor: "pointer",
                    }}
                  >
                    👀 View Active Bid →
                  </button>
                </div>
              );
            }
            return (
              <div style={{ padding: "24px 16px", textAlign: "center", color: "var(--cozy-cocoa)" }}>
                <div style={{ fontSize: "2.4rem", marginBottom: 8 }}>⚠️</div>
                <div style={{ fontWeight: 700, fontSize: "1.05rem", marginBottom: 6 }}>
                  Couldn't reach hotels
                </div>
                <div style={{
                  fontSize: "0.86rem",
                  color: "var(--cozy-cocoa-soft)",
                  lineHeight: 1.5,
                  marginBottom: 14,
                  wordBreak: "break-word",
                }}>
                  {submitError}
                </div>
                <button
                  type="button"
                  onClick={() => { void submit(); }}
                  style={{
                    padding: "10px 22px",
                    borderRadius: 999,
                    fontWeight: 700,
                    fontSize: "0.92rem",
                    background: "linear-gradient(180deg,#fbe6b5,#e6c382)",
                    color: "var(--cozy-warm-dark)",
                    border: "1px solid rgba(110,84,48,0.35)",
                    boxShadow: "0 3px 10px rgba(110,84,48,0.18)",
                    cursor: "pointer",
                  }}
                >
                  🔄 Try Again
                </button>
              </div>
            );
          }
          /* v222 — split empty state into two modes:
             - loading=true: bid is launching RIGHT NOW (user tapped
               Launch Bid; submit() is in flight). Show animated spinner
               + "Reaching hotels…" copy so they know the system is
               working, not stuck.
             - loading=false: user hasn't tapped Launch Bid yet (came
               here directly somehow). Show the classic guidance. */
          if (loading) {
            return (
              <div style={{ padding: "28px 16px", textAlign: "center", color: "var(--cozy-cocoa)" }}>
                <div
                  className="bx-launch-spinner"
                  style={{ margin: "0 auto 14px" }}
                />
                <div style={{ fontWeight: 700, fontSize: "1.05rem", marginBottom: 6 }}>
                  Reaching {form.city || "hotels"}…
                </div>
                <div style={{ fontSize: "0.86rem", color: "var(--cozy-cocoa-soft)", lineHeight: 1.5 }}>
                  Notifying every matching hotel in your destination.
                  This usually takes 5-30 seconds.
                </div>
              </div>
            );
          }
          return (
            <div style={{ padding: "28px 16px", textAlign: "center", color: "var(--cozy-cocoa)" }}>
              <div style={{ fontSize: "2.4rem", marginBottom: 8 }}>⏳</div>
              <div style={{ fontWeight: 700, fontSize: "1rem", marginBottom: 6 }}>
                Launch your bid first
              </div>
              <div style={{ fontSize: "0.86rem", color: "var(--cozy-cocoa-soft)" }}>
                Go back to Step 5 and tap 🚀 Launch Bid. Hotels will start responding live here.
              </div>
            </div>
          );
        }
        const isAccepted = (b: any) =>
          !!b.accepted || ["ACCEPTED", "CONFIRMED"].includes(String(b.status).toUpperCase());
        const acceptedCount  = liveBids.filter(isAccepted).length;
        const reviewingCount = liveBids.length - acceptedCount;
        const sortedBids = [...liveBids].sort(
          (a, b) => (isAccepted(b) ? 1 : 0) - (isAccepted(a) ? 1 : 0)
        );
        return (
          <div style={{ padding: "4px 0" }}>
            <div className="bx-live-head" style={{ marginBottom: 10 }}>
              <span className="bx-live-head-l">
                <span className="bx-live-dot sb-pulse-dot" />
                Live hotel responses
              </span>
              <span className="bx-live-head-r">
                {acceptedCount > 0 && <b className="bx-live-head-ok">{acceptedCount} accepted</b>}
                {acceptedCount > 0 && reviewingCount > 0 && " · "}
                {reviewingCount > 0 && `${reviewingCount} reviewing`}
              </span>
            </div>
            <div className="bx-live-list sb-stagger">
              {sortedBids.map((b, i) => (
                <LiveBidCard
                  key={b.bidId || i}
                  bid={b}
                  idx={i}
                  launchTs={launchTs}
                  nowTs={nowTs}
                  onOpen={(hid) => router.push(hid ? `/hotels/${hid}` : "/my-bids")}
                  onGrab={(bid) => { clearBidSession(); router.replace(`/my-bids?payNow=${bid}#bid-${bid}`); }}
                />
              ))}
            </div>
            <p className="bx-live-note" style={{ marginTop: 12 }}>
              ✓ Every price here is <strong>below market rate</strong>. Tap a hotel name to visit the property, or use 💳 Pay & Grab to lock the booking.
            </p>
          </div>
        );
      },
    },
    /* ─────────── v217 — 7th milestone: Pay & Grab the Deal ───────────
       Final milestone — payment gateway on the same page. Shows accepted
       bids with single-tap pay buttons, plus a fallback "Open My Bids"
       CTA. Reverts to a graceful "Waiting for an accepted bid" panel
       until at least one hotel accepts. */
    {
      key: "pay",
      icon: "💳",
      title: "Pay & Grab the Deal",
      hint: "Wait for an accepted bid first",
      isComplete: () => false, // terminal — never auto-completes
      summary: () => {
        const acceptedNow = liveBids.filter((b: any) =>
          !!b.accepted || ["ACCEPTED", "CONFIRMED"].includes(String(b.status).toUpperCase())
        ).length;
        return acceptedNow > 0 ? `${acceptedNow} ready to pay` : "—";
      },
      autoAdvance: false,
      doneLabel: "Open My Bids ›",
      onDoneClick: () => { router.push("/my-bids"); },
      render: () => {
        const isAccepted = (b: any) =>
          !!b.accepted || ["ACCEPTED", "CONFIRMED"].includes(String(b.status).toUpperCase());
        const acceptedBids = liveBids.filter(isAccepted);
        if (acceptedBids.length === 0) {
          return (
            <div style={{ padding: "28px 16px", textAlign: "center", color: "var(--cozy-cocoa)" }}>
              <div style={{ fontSize: "2.4rem", marginBottom: 8 }}>⏳</div>
              <div style={{ fontWeight: 700, fontSize: "1rem", marginBottom: 6 }}>
                Waiting for an accepted bid
              </div>
              <div style={{ fontSize: "0.86rem", color: "var(--cozy-cocoa-soft)", marginBottom: 4 }}>
                Once any hotel accepts your bid, you can pay & grab the deal right here on this page.
              </div>
            </div>
          );
        }
        return (
          <div style={{ padding: "4px 0" }}>
            <div className="bx-live-head" style={{ marginBottom: 10 }}>
              <span className="bx-live-head-l">
                <span className="bx-live-dot sb-pulse-dot" />
                💳 Pay & confirm booking
              </span>
              <span className="bx-live-head-r">
                <b className="bx-live-head-ok">{acceptedBids.length} ready</b>
              </span>
            </div>
            <div className="bx-live-list sb-stagger">
              {acceptedBids.map((b, i) => (
                <LiveBidCard
                  key={b.bidId || i}
                  bid={b}
                  idx={i}
                  launchTs={launchTs}
                  nowTs={nowTs}
                  onOpen={(hid) => router.push(hid ? `/hotels/${hid}` : "/my-bids")}
                  onGrab={(bid) => { clearBidSession(); router.replace(`/my-bids?payNow=${bid}#bid-${bid}`); }}
                />
              ))}
            </div>
            <p className="bx-live-note" style={{ marginTop: 12 }}>
              ✓ Accepted offers are <strong>held 15 minutes</strong>. Tap Pay & Grab to confirm at the displayed price.
            </p>
          </div>
        );
      },
    },
  ];

  /* ─────────────── Main Form ─────────────── */
  return (
    <div className="bx-shell min-h-screen pb-24">
      {/* v221 — Desktop-only back chip. On mobile the OS back gesture
          (Android edge-swipe / iOS swipe) covers this; we hide DialerNav
          on /bid so that gesture isn't intercepted (v221 fix). On
          desktop there's no gesture so a visible ← back chip ships.
          CSS auto-hides below 1024px via `.bx-desktop-back` media query. */}
      <button
        type="button"
        className="bx-desktop-back"
        onClick={() => {
          if (typeof window !== "undefined" && window.history.length > 1) {
            router.back();
          } else {
            router.push("/");
          }
        }}
        aria-label="Go back"
      >
        <span className="bx-desktop-back-arrow" aria-hidden="true">←</span>
        <span>Back</span>
      </button>

      {/* v236 — Revert v235's "Step 1 owns full viewport". Sachin's
          feedback after v235: "full screen ka mtlb yeh nhi tha ki jab
          baar bhi remove ho jaye ur na hi koi nav baar hai na hi koi
          scroll karne ke liye scroller ya gesture button. Maine pahle
          bhi kaha tha ki koi alteration nhi ek simple solution
          chahiye". Restore the centered wrapper + slim hero + StepBar
          chrome so customers always see Where they are + How to go
          back. The climber size constraint on .bgz-stage.cmm-stage is
          also restored in globals.css. */}
      <div className="bx-page-wrap mx-auto px-4 pt-4">

        {/* v237 — Hide slim hero + StepBar on Step 1. The customer Navbar
            (sticky top-0 z-1100 per v237) IS visible above the climber
            now, so navigation chrome is satisfied via Navbar alone. The
            slim hero + StepBar were duplicating navigation and stealing
            pixels from the mountain backdrop. Steps 2-3 retain them for
            the legacy form fallback path. Sachin: "full screen ka matlb
            yeh bhi tha ki nav baar bhi rakhna" — Navbar = nav, page
            chrome = excess on Step 1. */}
        {step !== 1 && (
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

        {step !== 1 && <StepBar step={step} />}

        <div className={`transition-all duration-200 ${animating ? "opacity-0 translate-y-2" : "opacity-100 translate-y-0"}`}>

          {/* ═══════════ STEP 1: WHERE & WHEN ═══════════
              v202 — mobile/tablet swaps the inline list of 4 sub-
              sections for a Card Stack (one card on top, peeks
              behind, breadcrumb chips at top, sticky CTA). Desktop
              keeps the existing scrollable layout intact. */}
          {step === 1 && (
            /* v217 — Climber UX now renders on EVERY device. Mobile gets
               full-bleed; tablet + desktop get a centered portrait
               aspect-ratio column (constrained via `.cmm-stage` CSS at
               min-width 1024px). The legacy desktop sectional form is
               kept below as a fallback for the isMobile=false escape
               hatch — but the default for every viewport is the
               climber. Sachin's spec: "ek hi flow main chalne chahiye
               na ki different different pages par". */
            (true ? (
              <BidGameZone
                cards={step1Cards}
                onAllComplete={() => { /* v217 — peak hidden when 7 cards */ }}
                finalCtaLabel="🚀 Launch Bid"
              />
            ) : (
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
                  {/* v227 — optional preference. No "must pick 3" wall;
                      zero picks lands on every property type. */}
                  <span
                    className="bx-section-h-count"
                    style={{
                      fontSize: "0.66rem", fontWeight: 800, letterSpacing: "0.06em",
                      padding: "3px 9px", borderRadius: 999, whiteSpace: "nowrap",
                      background: "rgba(127,146,105,0.18)",
                      color: "#5a6e44",
                      border: "1px solid rgba(127,146,105,0.45)",
                    }}
                  >
                    {form.propertyTypes.length ? `${form.propertyTypes.length} picked` : "Any type"}
                  </span>
                </div>
                {/* v181 — curated 10-pick grid w/ premium icon tiles.
                    v186 — Any pseudo-option removed (Sachin's rule:
                    must select at least 3 types). Grid is 3 cols
                    mobile → 4/5/6/7 desktop. */}
                <div className="bx-pick-grid">
                  {visiblePropertyTypes.map((pt) => {
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
                  {form.propertyTypes.length > 0
                    ? `Bid prefers: ${form.propertyTypes.map((id) => PROPERTY_TYPE_MAP[id]?.label || id).join(", ")} — falls back to every type if none match in ${form.city || "this city"}.`
                    : `Any type · bid reaches every property in ${form.city || "this city"}. Pick specific types to narrow.`}
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
                    // v241 — same cap raises as the gaming counter
                    // above; group of up to 15 guests across up to 10
                    // rooms covered by the regular flow.
                    { label: "Adults",   key: "adults",   min: 1, max: 15, kind: "adults"   as GuestKind, sub: "12+ yrs"        },
                    { label: "Children", key: "children", min: 0, max: 6,  kind: "children" as GuestKind, sub: "5-12 yrs"       },
                    { label: "Rooms",    key: "rooms",    min: 1, max: 10, kind: "rooms"    as GuestKind, sub: "1 unit / family"},
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
                {/* v241 — Auto-fit assistant on desktop (mirror of the
                    mobile panel inside BidGameZone). Same state +
                    persisted toggle so flipping ON/OFF on one device
                    flips both surfaces. */}
                <div style={{
                  display: "flex", flexDirection: "column", gap: 6,
                  marginTop: 10, padding: "8px 12px",
                  background: "var(--accent-soft, rgba(201,166,107,0.08))",
                  border: "1px solid rgba(201,166,107,0.20)",
                  borderRadius: 10,
                }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "0.78rem", color: "var(--text-soft)", cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={autoFit}
                      onChange={(e) => setAutoFitPersist(e.target.checked)}
                      style={{ width: 16, height: 16, accentColor: "#C9A66B" }}
                    />
                    <span>Auto-fit rooms to guests</span>
                    <span style={{ marginLeft: "auto", fontSize: "0.65rem", color: "var(--cozy-champagne, #C9A66B)" }}>
                      {autoFit ? "ON" : "OFF"}
                    </span>
                  </label>
                  {autoFit && cappedMinRooms > 1 && form.rooms === cappedMinRooms && totalGuests > 2 && (
                    <p style={{ fontSize: "0.7rem", color: "var(--text-muted)", margin: 0, lineHeight: 1.4 }}>
                      ✨ Auto-set to {form.rooms} rooms for {totalGuests} guests
                    </p>
                  )}
                  {!autoFit && roomsShortBy > 0 && (
                    <p style={{ fontSize: "0.7rem", color: "#A85B4E", margin: 0, lineHeight: 1.4 }}>
                      ⚠️ {totalGuests} guests in {form.rooms} room{form.rooms > 1 ? "s" : ""} — most hotels will decline. Recommended: {cappedMinRooms} rooms.
                    </p>
                  )}
                  {minRooms > 10 && (
                    <a
                      href={`https://wa.me/918881555188?text=${encodeURIComponent(`Hi, I need ${minRooms}+ rooms for ${totalGuests} guests. Please help me plan a group booking.`)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        fontSize: "0.7rem", color: "var(--cozy-champagne, #C9A66B)",
                        textDecoration: "underline",
                      }}
                    >
                      🏨 Need {minRooms}+ rooms? Talk to concierge →
                    </a>
                  )}
                </div>
              </div>

            </div>
            ))
          )}

          {/* ═══════════ STEP 2: YOUR PRICE — budget + review + launch ═══
              v208 — renumbered from old STEP 3 (Your Stay was step 2,
              now deleted; Your Price moved up). Internal `step` state
              values are now 1 and 2 — no other `step === 3` exists. */}
          {step === 2 && (
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

        {/* Navigation — v202.1: hidden on mobile during Step 1 because
            BidCardStack ships its own sticky CTA rail. Showing both
            left a "Next → / Stay details →" double-CTA bug visible
            in screenshot 3 of Sachin's v202 feedback. Desktop sees
            the row as before; mobile Step 2/3 also see it (only the
            card-stack screen suppresses it). */}
        {!(isMobile && step === 1) && (
        <div className="bx-nav-row">
          {step > 1 && (
            <button onClick={() => goStep(step - 1)} className="bx-nav-back">
              ← Back
            </button>
          )}
          {/* v208 — 2-step page. Forward button only renders on step 1
              (going to Your Price). Step 2 has its own Launch button
              inside the form. */}
          {step < 2 && (
            <button onClick={() => canNext() && goStep(step + 1)} disabled={!canNext()} className="bx-nav-cont">
              Set your price →
            </button>
          )}
        </div>
        )}

        {/* v240.1 — Desktop-only bottom step indicator. On mobile Step 1
            the BidGameZone climber portals to document.body (escape the
            /bid page's transform-trap, see v203.1) — leaving this <p> as
            the ONLY visible element inside .bx-page-wrap. Result: the
            indicator floated at the top of the viewport like a header
            pill near the camera notch, which Sachin reported as
            unwanted: "yeh mobile ke liye lagane ke liye nhi bola tha
            sirf desktop ya laptop ke liye tha". Tailwind `hidden lg:block`
            keeps it visible only on ≥1024px (desktop / laptop). Pure
            CSS — no JS state, no SSR flicker. Inner pages (Step 2) keep
            it hidden on mobile too, matching the original intent. */}
        <p className="hidden lg:block" style={{ textAlign: "center", fontSize: "0.7rem", color: "var(--text-muted)", marginTop: 14, letterSpacing: "0.02em" }}>
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
      {bidConflict && conflictSheetOpen && (
        <ActiveBidConflictSheet
          conflict={bidConflict.conflict}
          flow="place"
          desiredAmount={bidConflict.desiredAmount}
          floorPrice={bidConflict.floorPrice}
          maxBudget={bidConflict.maxBudget}
          // v230 — onClose closes ONLY the sheet, NOT bidConflict. This way
          // the Step 6 conflict-aware card (with "View Active Bid →" CTA +
          // hotel name + amount) stays rendered even after the user dismisses
          // the sheet. Pre-v230 the sheet's onClose nulled bidConflict →
          // Step 6 fell back to the generic "Try Again" card and the user
          // had no way to see which hotel was conflicting.
          onClose={() => setConflictSheetOpen(false)}
          onUpdated={(bid?: any) => {
            // v229 — Cancel sheet path returns { status: "CANCELLED" }: clear
            // the entire conflict state so user can re-launch. Budget-update
            // path returns the updated bid → push to /my-bids.
            if (bid?.status === "CANCELLED") {
              setBidConflict(null);
              setConflictSheetOpen(false);
              return;
            }
            router.push("/my-bids");
          }}
        />
      )}

      {/* v210 — Mobile success overlay. Renders ON TOP of the climbing
          map (climber at peak, all 5 milestones done) instead of
          replacing the page. No back-button regression because the
          climbing page never unmounts. */}
      {/* v225 — RE-ENABLED for both mobile AND desktop. Sachin's report
          "ab laptop pe bhi bid launch hona bad ho gaya": v217 had
          disabled the mobile overlay assuming milestone 6 (Review Bid
          & Visit) inside the climber would be enough confirmation.
          v223 then disabled the desktop full-page takeover too. Net
          result: success state had NO VISIBLE confirmation on EITHER
          surface. Users tapped Launch Bid, success populated silently,
          climber stayed open at Step 5 (or auto-jumped to Step 6 with
          a small panel buried inside the sheet) — looked broken. This
          overlay is the missing celebratory confirmation: confetti +
          burst badge + live auction panel + Pay buttons rendered
          fullscreen over the climber. Climber stays mounted underneath
          (no back-button regression, no "next page" feel — Sachin's
          previous complaint about desktop was that the FULL-PAGE
          takeover replaced the climber; an OVERLAY does not). */}
      {success && (() => {
        const isAccepted = (b: any) =>
          !!b.accepted || ["ACCEPTED", "CONFIRMED"].includes(String(b.status).toUpperCase());
        const acceptedCount  = liveBids.filter(isAccepted).length;
        const reviewingCount = liveBids.length - acceptedCount;
        const sortedBids = [...liveBids].sort(
          (a, b) => (isAccepted(b) ? 1 : 0) - (isAccepted(a) ? 1 : 0)
        );
        return (
          <div className="bx-success-overlay">
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
            <div className="bx-success-overlay-scroll">
              <div className="bx-win-card bx-win-pop sb-card-lift">
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

              <div className="bx-live-panel bx-win-seq sb-card-lift" style={{ animationDelay: "0.56s" }}>
                <div className="bx-live-head">
                  <span className="bx-live-head-l">
                    <span className="bx-live-dot sb-pulse-dot" />
                    💳 Pay & Confirm Booking
                  </span>
                  <span className="bx-live-head-r">
                    {acceptedCount > 0 && <b className="bx-live-head-ok">{acceptedCount} accepted</b>}
                    {acceptedCount > 0 && reviewingCount > 0 && " · "}
                    {reviewingCount > 0 && `${reviewingCount} counter`}
                  </span>
                </div>
                <div className="bx-live-list sb-stagger">
                  {sortedBids.map((b, i) => (
                    <LiveBidCard
                      key={b.bidId || i}
                      bid={b}
                      idx={i}
                      launchTs={launchTs}
                      nowTs={nowTs}
                      onOpen={(hid) => router.push(hid ? `/hotels/${hid}` : "/my-bids")}
                      onGrab={(bid) => { clearBidSession(); router.replace(`/my-bids?payNow=${bid}#bid-${bid}`); }}
                    />
                  ))}
                </div>
                <p className="bx-live-note">
                  ✓ Every price here is <strong>below the market rate</strong>. Accepted offers are <strong>held 15 minutes</strong>; tap a hotel to lock your booking.
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 4 }}>
                  <button onClick={() => router.push("/my-bids")} className="bx-launch-btn sb-shimmer" style={{ padding: "14px 18px", fontSize: "1.05rem", position: "relative" }}>
                    <span style={{ position: "relative", zIndex: 2 }}>Track All Bids</span>
                  </button>
                  <button onClick={() => router.push("/hotels")} className="bx-nav-back" style={{ width: "100%", flex: "0 0 auto" }}>
                    Browse Hotels
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
