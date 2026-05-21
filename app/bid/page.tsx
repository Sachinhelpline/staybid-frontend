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
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import LuxuryCalendar from "@/components/LuxuryCalendar";
// v122.2 — auto-scroll the next form section into view on every selection
// so the user never has to manually scroll between fields in this 4-step
// wizard. See lib/auto-next-scroll.ts for the helper.
import { scrollToAutoNext } from "@/lib/auto-next-scroll";
// v129 — every customer-facing bid amount snaps to a ₹100 multiple. Same
// helpers power the Negotiate modal slider + partner counter slider so a
// preset / drag / type-in input all land on the same indivisible billing unit.
import { snap100, PRICE_STEP, PRICE_MIN } from "@/lib/price-snap";
// v139 — auto-fires the 4-step reverse-auction tour on first visit.
// Hook waits until [data-autonext="destination"] renders.
import { usePageTour } from "@/lib/tutorial/usePageTour";

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
const ROOM_TYPES = [
  { id: "standard", label: "Standard",  icon: "🛏️",  desc: "Comfortable & cozy"     },
  { id: "deluxe",   label: "Deluxe",    icon: "✨",   desc: "Upgraded amenities"      },
  { id: "suite",    label: "Suite",     icon: "👑",   desc: "Premium experience"      },
  { id: "villa",    label: "Villa",     icon: "🏡",   desc: "Private luxury"          },
];

const BED_TYPES = [
  { id: "king",   label: "King Bed"   },
  { id: "twin",   label: "Twin Beds"  },
  { id: "double", label: "Double Bed" },
  { id: "any",    label: "Any Bed"    },
];

const VIEW_PREFS = ["Mountain", "Forest", "Garden", "Pool", "City", "Any"];

const MEAL_PLANS = [
  { id: "ro", label: "Room Only",   icon: "🏨", desc: "Just the room"            },
  { id: "bb", label: "Breakfast",   icon: "☕", desc: "Morning meal included"    },
  { id: "hb", label: "Half Board",  icon: "🍽️", desc: "Breakfast + dinner"       },
  { id: "fb", label: "Full Board",  icon: "🍱", desc: "All 3 meals included"     },
];

const OCCASIONS = [
  { id: "none",        label: "Regular Stay",  icon: "🏨" },
  { id: "honeymoon",   label: "Honeymoon",     icon: "💑" },
  { id: "anniversary", label: "Anniversary",   icon: "💝" },
  { id: "birthday",    label: "Birthday",      icon: "🎂" },
  { id: "family",      label: "Family Trip",   icon: "👨‍👩‍👧" },
  { id: "business",    label: "Business",      icon: "💼" },
];

/* ── AI Bid Strength Calculator ────────────────────────────────── */
function calcBidStrength(budget: number, cityAvg: number) {
  const r = budget / cityAvg;
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

/* ── v163 — Live auction bid card ───────────────────────────────
   The reverse-auction model the customer expects:
   • A hotel whose floor price ≤ your bid ACCEPTS instantly. The timer
     is the HOLD WINDOW — how long that accepted price is locked for
     you to book (NOT a deadline for the hotel to respond).
   • A hotel whose floor > your bid is still REVIEWING and may counter
     near its floor — no countdown shown for those.
   • Every card is tappable → opens that hotel's page.
   ──────────────────────────────────────────────────────────────── */
const LIVE_WINDOW_MS = 15 * 60 * 1000; // accepted-offer hold window

function LiveBidCard({ bid, launchTs, nowTs, idx, onOpen }: {
  bid: any; launchTs: number; nowTs: number; idx: number; onOpen: (hotelId: string) => void;
}) {
  const status    = String(bid.status || "PENDING").toUpperCase();
  // `bid.accepted` = floor ≤ bid at launch (instant accept). The poll
  // can later flip a reviewing hotel to ACCEPTED / COUNTER / REJECTED.
  const accepted  = !!bid.accepted || status === "ACCEPTED" || status === "CONFIRMED";
  const countered = !accepted && (status === "COUNTER" || status === "COUNTERED");
  const rejected  = !accepted && (status === "REJECTED" || status === "EXPIRED");
  const reviewing = !accepted && !countered && !rejected;

  const elapsed   = Math.max(0, nowTs - launchTs);
  const remaining = Math.max(0, LIVE_WINDOW_MS - elapsed);
  const expired   = accepted && remaining <= 0;
  const mm = Math.floor(remaining / 60000);
  const ss = Math.floor((remaining % 60000) / 1000);
  const holdLeftPct = Math.max(0, Math.min(100, (remaining / LIVE_WINDOW_MS) * 100));

  const cls = expired ? "is-expired"
    : accepted ? "is-accepted"
    : countered ? "is-countered"
    : rejected ? "is-rejected" : "";

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
        <span className="bx-live-card-amt">₹{Number(bid.amount).toLocaleString("en-IN")}<small>/night</small></span>
      </div>

      {expired && (
        <div className="bx-live-stat is-rej">⏳ Hold window ended — tap to rebid</div>
      )}
      {!expired && accepted && (
        <>
          <div className="bx-live-stat is-ok">
            <span className="bx-live-tick">✓</span>
            <span className="bx-live-stat-tx">Accepted your price — tap to book</span>
            <span className="bx-live-timer">held {mm}:{String(ss).padStart(2, "0")}</span>
          </div>
          <div className="bx-live-bar"><span style={{ width: `${holdLeftPct}%` }} /></div>
        </>
      )}
      {countered && (
        <div className="bx-live-stat is-counter">
          ↔ Countered{bid.counterAmount ? ` at ₹${Number(bid.counterAmount).toLocaleString("en-IN")}` : ""} — tap to view
        </div>
      )}
      {rejected && (
        <div className="bx-live-stat is-rej">This hotel passed — others are still in</div>
      )}
      {reviewing && (
        <div className="bx-live-stat is-live">
          <span className="bx-live-dot" />
          <span className="bx-live-stat-tx">
            Reviewing your offer{bid.floorPrice > 0 ? ` — may counter near ₹${Number(bid.floorPrice).toLocaleString("en-IN")}` : ""}
          </span>
        </div>
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
function Counter({ value, onChange, min = 0, max = 10 }: { value: number; onChange: (v: number) => void; min?: number; max?: number }) {
  return (
    <div className="bx-counter-ctrl">
      <button type="button" onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min} className="bx-counter-btn" aria-label="decrement">−</button>
      <span className="bx-counter-val">{value}</span>
      <button type="button" onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max} className="bx-counter-btn" aria-label="increment">+</button>
    </div>
  );
}

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
  // v163 — live auction state shown on the success screen itself.
  const [liveBids, setLiveBids] = useState<any[]>([]);
  const [launchTs, setLaunchTs] = useState(0);
  const [nowTs, setNowTs] = useState(() => Date.now());

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
    checkIn:        "",
    checkOut:       "",
    adults:         2,
    children:       0,
    rooms:          1,
    roomType:       "deluxe",
    bedType:        "king",
    view:           "Any",
    mealPlan:       "bb",
    occasion:       "none",
    // v129 — `specialRequests` removed: free-text field was an anti-bypass
    // surface (phone/email/WhatsApp could slip through). Add-on toggles below
    // are now the only structured channel for stay preferences.
    maxBudget:      "",
    earlyCheckIn:   false,
    lateCheckOut:   false,
    airportTransfer:false,
    petFriendly:    false,
    smokingRoom:    false,
  });

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
  const budgetRaw = parseFloat(form.maxBudget) || 0;
  const budget    = snap100(budgetRaw);
  const bidStr   = city && budget > 0 ? calcBidStrength(budget, city.avg) : null;
  const totalEst = budget > 0 && nights > 0 ? budget * nights * form.rooms : 0;

  // v129 — every preset is a ₹100 multiple (same step as the Negotiate slider
  // and partner counter slider). Lowest indivisible billing unit on the
  // platform is ₹100; presets must land on it cleanly.
  const presets = city ? [
    // v163 — presets map to room CATEGORIES (budget / smart / premium
    // class room), not three bids for one room. "Smart" sits at the
    // city average; Budget steps 1.5× down, Premium 1.5× up. All snap
    // to ₹100 — the platform's indivisible billing unit.
    { label: "Budget",   amount: snap100(city.avg / 1.5),  icon: "💰", desc: "Budget-class room" },
    { label: "Smart",    amount: snap100(city.avg),        icon: "⭐", desc: "Balanced mid-class",  recommended: true },
    { label: "Premium",  amount: snap100(city.avg * 1.5),  icon: "⚡", desc: "Premium-class room" },
  ] : [];

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
    if (step === 1) return !!(form.city && form.checkIn && form.checkOut && nights >= 1);
    if (step === 2) return !!form.roomType;
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
      // v129 — only structured fields go into requirements. Free-text
      // `specialRequests` was removed as an anti-bypass surface.
      const extras = [
        form.earlyCheckIn    ? "Early check-in requested"  : "",
        form.lateCheckOut    ? "Late check-out requested"  : "",
        form.airportTransfer ? "Airport transfer needed"   : "",
        form.petFriendly     ? "Pet-friendly room needed"  : "",
        form.smokingRoom     ? "Smoking room preferred"    : "",
        form.occasion !== "none" ? `Special occasion: ${form.occasion}` : "",
      ].filter(Boolean).join(". ");

      const requirements = [
        `Room: ${form.roomType}, ${form.bedType} bed`,
        `View: ${form.view}`,
        `Meal plan: ${form.mealPlan.toUpperCase()}`,
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
          const room   = rooms[0];
          if (!room) throw new Error(`${hotel.name}: no rooms`);

          const reqRes = await api.createBidRequest({
            hotelId:  hotel.id,
            roomId:   room.id,
            amount:   budget,
            checkIn:  checkInISO,
            checkOut: checkOutISO,
            guests,
            requirements,
          });

          const requestId = reqRes?.request?.id;
          const baseMessage = `Guest's budget: ₹${budget}/night for ${nights} night${nights > 1 ? "s" : ""}${requirements ? ". " + requirements : ""}`;

          // v163 — capture the placed bid + the room's floor price so the
          // live-auction panel can show the real model: a hotel whose
          // floor ≤ your bid ACCEPTS instantly (deal held for the timer
          // window); a hotel whose floor > your bid is still REVIEWING
          // and may counter at its floor.
          let placedBidId = "";
          let placedAmount = budget;
          const floorPrice = Number(room.floorPrice) || 0;
          // Accepted instantly when the bid clears the room's floor.
          let accepted = floorPrice > 0 ? budget >= floorPrice : true;

          try {
            const bidRes = await api.placeBid({
              hotelId:  hotel.id,
              roomId:   room.id,
              amount:   budget,
              requestId,
              message:  baseMessage,
            });
            if (bidRes?.bid?.id) {
              placedBidId = bidRes.bid.id;
              localStorage.setItem(
                `bid_dates_${bidRes.bid.id}`,
                JSON.stringify({ checkIn: form.checkIn, checkOut: form.checkOut })
              );
            }
          } catch (err: any) {
            const msg = (err?.message || "").toLowerCase();
            if (msg.includes("too low") && floorPrice > 0) {
              // Bid was below this hotel's floor → reviewing, not accepted.
              accepted = false;
              const bidRes = await api.placeBid({
                hotelId:  hotel.id,
                roomId:   room.id,
                amount:   floorPrice,
                requestId,
                message:  `Guest's preferred price: ₹${budget}/night. ${baseMessage}. Please counter if possible.`,
              });
              if (bidRes?.bid?.id) {
                placedBidId = bidRes.bid.id;
                placedAmount = floorPrice;
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
            amount: placedAmount,
            floorPrice,
            accepted,
          };
        })
      );

      const launched = results
        .filter((r): r is PromiseFulfilledResult<any> => r.status === "fulfilled")
        .map((r) => r.value);
      const successCount = launched.length;
      if (successCount === 0) {
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
            <strong style={{ color: "var(--cozy-warm-dark)" }}>{success.city}</strong> · ₹{success.budget.toLocaleString("en-IN")}/night —
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
              {reviewingCount > 0 && `${reviewingCount} reviewing`}
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
              />
            ))}
          </div>

          <p className="bx-live-note">
            ✓ Accepted offers are <strong>held 15 minutes</strong> — tap a hotel to lock your booking before the hold ends. Reviewing hotels may still counter.
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
                {/* v163 — compact 3-up grid so every city fits without
                    tall tiles. Demand shows as a small corner dot. */}
                <div className="bx-city-grid">
                  {Object.entries(CITY_DATA).map(([name, info]) => {
                    const isSelected = form.city === name;
                    const isSurge = info.demand === "Very High" || info.demand === "High";
                    return (
                      <button
                        key={name}
                        type="button"
                        onClick={() => { upd("city", name); scrollToAutoNext("dates"); }}
                        className={`bx-city-tile ${isSelected ? "is-selected" : ""}`}
                        title={`${name} · ${info.demand} demand`}
                      >
                        <span className={`bx-city-dot ${isSurge ? "is-surge" : ""}`} />
                        <span className="bx-city-emoji">{info.emoji}</span>
                        <span className="bx-city-name">{name}</span>
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

              {/* Guests & Rooms — 3 counters in ONE row (v163) */}
              <div data-autonext="guests">
                <div className="bx-section-h">
                  <span className="bx-section-h-label">Guests &amp; Rooms</span>
                  <span className="bx-section-h-rule" />
                </div>
                <div className="bx-guest-row">
                  {[
                    { label: "Adults",   key: "adults",   min: 1, max: 10 },
                    { label: "Children", key: "children", min: 0, max: 6  },
                    { label: "Rooms",    key: "rooms",    min: 1, max: 5  },
                  ].map(({ label, key, min, max }) => (
                    <div key={key} className="bx-guest-cell">
                      <p className="bx-guest-cell-label">{label}</p>
                      <Counter value={(form as any)[key]} onChange={(v) => upd(key, v)} min={min} max={max} />
                    </div>
                  ))}
                </div>
              </div>

            </div>
          )}

          {/* ═══════════ STEP 2: YOUR STAY — room + compact preferences ═══ */}
          {step === 2 && (
            <div className="space-y-3 bx-step-pane" data-autonext-form>

              {/* Room Type — 4 compact tiles in ONE row (v163) */}
              <div data-autonext="roomType">
                <div className="bx-section-h">
                  <span className="bx-section-h-label">Room Type</span>
                  <span className="bx-section-h-rule" />
                </div>
                <div className="bx-quad-grid">
                  {ROOM_TYPES.map((rt) => (
                    <button
                      key={rt.id}
                      type="button"
                      onClick={() => upd("roomType", rt.id)}
                      className={`bx-mini-tile ${form.roomType === rt.id ? "is-selected" : ""}`}
                      title={rt.desc}
                    >
                      <span className="bx-mini-tile-icon">{rt.icon}</span>
                      <span className="bx-mini-tile-name">{rt.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Bed preference — compact chips, single row */}
              <div data-autonext="bedType">
                <div className="bx-section-h">
                  <span className="bx-section-h-label">Bed Preference</span>
                  <span className="bx-section-h-rule" />
                </div>
                <div className="bx-chip-scroll">
                  {BED_TYPES.map((bt) => (
                    <button
                      key={bt.id}
                      type="button"
                      onClick={() => { upd("bedType", bt.id); scrollToAutoNext("view"); }}
                      className={`bx-chip bx-chip-sm ${form.bedType === bt.id ? "is-selected" : ""}`}
                    >
                      {bt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* View preference — compact chips, single row */}
              <div data-autonext="view">
                <div className="bx-section-h">
                  <span className="bx-section-h-label">View Preference</span>
                  <span className="bx-section-h-rule" />
                </div>
                <div className="bx-chip-scroll">
                  {VIEW_PREFS.map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => { upd("view", v); scrollToAutoNext("mealPlan"); }}
                      className={`bx-chip bx-chip-sm ${form.view === v ? "is-selected" : ""}`}
                    >
                      {v}
                    </button>
                  ))}
                </div>
              </div>

              {/* Meal Plan — 4 compact tiles in ONE row (v163) */}
              <div data-autonext="mealPlan">
                <div className="bx-section-h">
                  <span className="bx-section-h-label">Meal Plan</span>
                  <span className="bx-section-h-rule" />
                </div>
                <div className="bx-quad-grid">
                  {MEAL_PLANS.map((mp) => (
                    <button
                      key={mp.id}
                      type="button"
                      onClick={() => { upd("mealPlan", mp.id); scrollToAutoNext("occasion"); }}
                      className={`bx-mini-tile ${form.mealPlan === mp.id ? "is-selected" : ""}`}
                    >
                      <span className="bx-mini-tile-icon">{mp.icon}</span>
                      <span className="bx-mini-tile-name">{mp.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Occasion — compact chips, single scrollable row (v163) */}
              <div data-autonext="occasion">
                <div className="bx-section-h">
                  <span className="bx-section-h-label">Trip Purpose / Occasion</span>
                  <span className="bx-section-h-rule" />
                </div>
                <div className="bx-chip-scroll">
                  {OCCASIONS.map((oc) => (
                    <button
                      key={oc.id}
                      type="button"
                      onClick={() => { upd("occasion", oc.id); scrollToAutoNext("addons"); }}
                      className={`bx-chip bx-chip-ico ${form.occasion === oc.id ? "is-selected" : ""}`}
                    >
                      <span className="bx-chip-ico-e">{oc.icon}</span>{oc.label}
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
                <div className="bx-chip-scroll">
                  {[
                    { key: "earlyCheckIn",    icon: "🌅", label: "Early Check-in" },
                    { key: "lateCheckOut",    icon: "🌇", label: "Late Check-out" },
                    { key: "airportTransfer", icon: "🚗", label: "Airport Transfer" },
                    { key: "petFriendly",     icon: "🐾", label: "Pet-Friendly" },
                    { key: "smokingRoom",     icon: "🚬", label: "Smoking Room" },
                  ].map(({ key, icon, label }) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => upd(key, !(form as any)[key])}
                      className={`bx-chip bx-chip-ico ${(form as any)[key] ? "is-selected" : ""}`}
                    >
                      <span className="bx-chip-ico-e">{icon}</span>{label}
                    </button>
                  ))}
                </div>
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
                      Based on {form.city} avg. ₹{city.avg.toLocaleString("en-IN")}/night
                    </p>
                    <div className="bx-preset-row">
                      {presets.map((p) => (
                        <button
                          key={p.label}
                          type="button"
                          onClick={() => { upd("maxBudget", String(p.amount)); scrollToAutoNext("budget-input"); }}
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

              {/* Budget Input — slot-machine style */}
              <div data-autonext="budget-input">
                <div className="bx-section-h">
                  <span className="bx-section-h-label">
                    Your Max Budget <span className="bx-section-h-required">*</span> · per room / night
                  </span>
                  <span className="bx-section-h-rule" />
                </div>
                <div className="bx-budget-wrap">
                  <div className="bx-budget-eyebrow">Name your nightly rate</div>
                  <div className="bx-budget-row">
                    <span className="bx-budget-cur">₹</span>
                    <input
                      type="number"
                      value={form.maxBudget}
                      onChange={(e) => upd("maxBudget", e.target.value)}
                      onBlur={(e) => {
                        // v129 — snap any typed amount to a ₹100 multiple on
                        // blur so the value the user sees matches what gets
                        // submitted. Live snap during typing would block them
                        // mid-edit.
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
                  <div className="bx-budget-suffix">per room / per night · steps of ₹{PRICE_STEP}</div>
                  {city && budget > 0 && (
                    <div className={`bx-budget-vs ${budget >= city.avg ? "is-up" : "is-down"}`}>
                      {budget >= city.avg
                        ? `+₹${(budget - city.avg).toLocaleString("en-IN")} above ${form.city} average`
                        : `−₹${(city.avg - budget).toLocaleString("en-IN")} below ${form.city} average`}
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
                    <div className="bx-cost-row">
                      <span>₹{budget.toLocaleString("en-IN")} × {nights} {nights === 1 ? "night" : "nights"}</span>
                      <span className="v">₹{(budget * nights).toLocaleString("en-IN")}</span>
                    </div>
                    {form.rooms > 1 && (
                      <div className="bx-cost-row">
                        <span>× {form.rooms} rooms</span>
                        <span className="v">₹{(budget * nights * form.rooms).toLocaleString("en-IN")}</span>
                      </div>
                    )}
                    <div className="bx-cost-divider" />
                    <div className="bx-cost-row">
                      <span style={{ fontSize: "0.7rem" }}>Taxes ~12%</span>
                      <span className="v" style={{ fontWeight: 500, fontSize: "0.74rem" }}>≈ ₹{Math.round(totalEst * 0.12).toLocaleString("en-IN")}</span>
                    </div>
                    <div className="bx-cost-total">
                      <span className="bx-cost-total-l">Total Estimate</span>
                      <span className="bx-cost-total-r">₹{Math.round(totalEst * 1.12).toLocaleString("en-IN")}</span>
                    </div>
                    <p style={{ fontSize: "0.62rem", color: "var(--text-muted)", textAlign: "center", marginTop: 8 }}>
                      Final price confirmed by hotel at acceptance
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
                    { label: "Room Type",    value: ROOM_TYPES.find(r => r.id === form.roomType)?.label || form.roomType },
                    { label: "Bed",          value: BED_TYPES.find(b => b.id === form.bedType)?.label || form.bedType },
                    { label: "View",         value: form.view },
                    { label: "Meal Plan",    value: MEAL_PLANS.find(m => m.id === form.mealPlan)?.label || form.mealPlan },
                    ...(form.occasion !== "none" ? [{ label: "Occasion", value: OCCASIONS.find(o => o.id === form.occasion)?.label || form.occasion }] : []),
                  ].map(({ label, value }) => (
                    <div key={label}>
                      <div className="bx-review-item-label">{label}</div>
                      <div className="bx-review-item-v">{value}</div>
                    </div>
                  ))}
                </div>

                {(form.earlyCheckIn || form.lateCheckOut || form.airportTransfer || form.petFriendly || form.smokingRoom) && (
                  <>
                    <div className="bx-cost-divider" style={{ margin: "14px 0" }} />
                    <div>
                      <div className="bx-review-item-label" style={{ marginBottom: 6 }}>Add-ons</div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {form.earlyCheckIn    && <span className="bx-chip is-selected" style={{ cursor: "default" }}>🌅 Early check-in</span>}
                        {form.lateCheckOut    && <span className="bx-chip is-selected" style={{ cursor: "default" }}>🌇 Late check-out</span>}
                        {form.airportTransfer && <span className="bx-chip is-selected" style={{ cursor: "default" }}>🚗 Airport transfer</span>}
                        {form.petFriendly     && <span className="bx-chip is-selected" style={{ cursor: "default" }}>🐾 Pet-friendly</span>}
                        {form.smokingRoom     && <span className="bx-chip is-selected" style={{ cursor: "default" }}>🚬 Smoking room</span>}
                      </div>
                    </div>
                  </>
                )}

                {/* v129 — Special Requests review row removed alongside the
                    textarea on Step 2. See the comment in the addons section. */}

                <div className="bx-cost-divider" style={{ margin: "14px 0" }} />

                <div className="bx-review-budget">
                  <div>
                    <div className="bx-review-budget-l-l">Your Max Budget</div>
                    <div className="bx-review-budget-l-v">₹{(parseInt(form.maxBudget) || 0).toLocaleString("en-IN")}</div>
                    <div className="bx-review-budget-l-s">per room / night</div>
                  </div>
                  {totalEst > 0 && (
                    <div className="bx-review-budget-r">
                      <div className="bx-review-budget-r-l">Est. Total</div>
                      <div className="bx-review-budget-r-v">₹{Math.round(totalEst * 1.12).toLocaleString("en-IN")}</div>
                      <div className="bx-review-budget-l-s" style={{ textAlign: "right" }}>incl. taxes</div>
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
    </div>
  );
}
