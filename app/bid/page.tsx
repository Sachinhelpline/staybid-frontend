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

import { useState, useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import LuxuryCalendar from "@/components/LuxuryCalendar";
// v122.2 — auto-scroll the next form section into view on every selection
// so the user never has to manually scroll between fields in this 4-step
// wizard. See lib/auto-next-scroll.ts for the helper.
import { scrollToAutoNext } from "@/lib/auto-next-scroll";

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

/* ── Editorial step bar ────────────────────────────────────────── */
const STEPS = ["Where & When", "Your Stay", "Smart Budget", "Review & Launch"];

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
    specialRequests:"",
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
  const budget   = parseFloat(form.maxBudget) || 0;
  const bidStr   = city && budget > 0 ? calcBidStrength(budget, city.avg) : null;
  const totalEst = budget > 0 && nights > 0 ? budget * nights * form.rooms : 0;

  const presets = city ? [
    { label: "Budget",   pct: 70,  amount: Math.round(city.avg * 0.70 / 50) * 50,  icon: "💰", desc: "Best saving, lower chance" },
    { label: "Smart",    pct: 88,  amount: Math.round(city.avg * 0.88 / 50) * 50,  icon: "⭐", desc: "Optimal balance",  recommended: true },
    { label: "Premium",  pct: 105, amount: Math.round(city.avg * 1.05 / 50) * 50,  icon: "⚡", desc: "Instant confirm" },
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

  /* ── Recent-wins ticker rotation ── */
  const [tickerIdx, setTickerIdx] = useState(0);
  useEffect(() => {
    const wins = insights?.recentWins || [];
    if (wins.length < 2) return;
    const t = setInterval(() => setTickerIdx((i) => (i + 1) % wins.length), 4500);
    return () => clearInterval(t);
  }, [insights?.recentWins?.length]);

  const currentWin = useMemo(() => {
    const wins = insights?.recentWins || [];
    if (!wins.length) return null;
    return wins[tickerIdx % wins.length];
  }, [insights?.recentWins, tickerIdx]);

  /* ── CountUp values for stats ribbon ── */
  const liveAuctions  = useCountUp(insights?.tonightAuctions || 0);
  const liveAccepted  = useCountUp(insights?.acceptedToday || 0);
  const liveHotels    = useCountUp(insights?.hotelsListening || 0);
  const liveStreak    = useCountUp(insights?.cityHotStreak || 0);

  const canNext = (): boolean => {
    if (step === 1) return !!(form.city && form.checkIn && form.checkOut && nights >= 1);
    if (step === 2) return !!form.roomType;
    if (step === 3) return budget > 0;
    return true;
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
      const extras = [
        form.earlyCheckIn    ? "Early check-in requested"  : "",
        form.lateCheckOut    ? "Late check-out requested"  : "",
        form.airportTransfer ? "Airport transfer needed"   : "",
        form.petFriendly     ? "Pet-friendly room needed"  : "",
        form.smokingRoom     ? "Smoking room preferred"    : "",
        form.occasion !== "none" ? `Special occasion: ${form.occasion}` : "",
        form.specialRequests,
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

          try {
            const bidRes = await api.placeBid({
              hotelId:  hotel.id,
              roomId:   room.id,
              amount:   budget,
              requestId,
              message:  baseMessage,
            });
            if (bidRes?.bid?.id) {
              localStorage.setItem(
                `bid_dates_${bidRes.bid.id}`,
                JSON.stringify({ checkIn: form.checkIn, checkOut: form.checkOut })
              );
            }
          } catch (err: any) {
            const msg = (err?.message || "").toLowerCase();
            const floor = Number(room.floorPrice) || 0;
            if (msg.includes("too low") && floor > 0) {
              const bidRes = await api.placeBid({
                hotelId:  hotel.id,
                roomId:   room.id,
                amount:   floor,
                requestId,
                message:  `Guest's preferred price: ₹${budget}/night. ${baseMessage}. Please counter if possible.`,
              });
              if (bidRes?.bid?.id) {
                localStorage.setItem(
                  `bid_dates_${bidRes.bid.id}`,
                  JSON.stringify({ checkIn: form.checkIn, checkOut: form.checkOut })
                );
              }
            } else {
              throw err;
            }
          }

          return reqRes;
        })
      );

      const successCount = results.filter(r => r.status === "fulfilled").length;
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
      });
    } catch (e: any) {
      alert(e.message || "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  /* ─────────────── Success Screen (winners' circle) ─────────────── */
  if (success) return (
    <div className="bx-shell min-h-screen flex items-center justify-center px-4 py-6">
      <div className="max-w-md w-full">
        <div className="bx-win-card">
          <div className="bx-win-badge">🎯</div>
          <p className="bx-hero-eyebrow" style={{ justifyContent: "center" }}>
            <span className="bx-hero-eyebrow-dot" />
            Bid Request Launched
          </p>
          <h1 className="bx-hero-title" style={{ fontSize: "clamp(1.5rem, 5vw, 2rem)", margin: "8px 0 6px" }}>
            Hotels Are <em>Competing</em>!
          </h1>
          <p className="bx-hero-sub" style={{ margin: "0 auto 16px", maxWidth: "32ch" }}>
            Bid for <strong style={{ color: "var(--cozy-warm-dark)" }}>{success.nights} {success.nights === 1 ? "night" : "nights"} in {success.city}</strong> sent to{" "}
            <strong style={{ color: "var(--cozy-champagne)" }}>{success.hotelsNotified} {success.hotelsNotified === 1 ? "hotel" : "hotels"}</strong>.
          </p>

          <div className="bx-review-grid" style={{ marginBottom: 12 }}>
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
            <div>
              <div className="bx-review-item-label">Budget/n</div>
              <div className="bx-review-item-v">₹{success.budget.toLocaleString("en-IN")}</div>
            </div>
            <div>
              <div className="bx-review-item-label">Rooms</div>
              <div className="bx-review-item-v">{success.rooms}</div>
            </div>
            <div>
              <div className="bx-review-item-label">Est. Total</div>
              <div className="bx-review-item-v">₹{Math.round(success.totalEst * 1.12).toLocaleString("en-IN")}</div>
            </div>
          </div>

          <div className="bx-cost-total" style={{ marginTop: 0, marginBottom: 14 }}>
            <span className="bx-cost-total-l">⏱ Hotels respond in</span>
            <span className="bx-cost-total-r">2–4 hrs</span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <button onClick={() => router.push("/my-bids")} className="bx-launch-btn" style={{ padding: "14px 18px", fontSize: "1.05rem" }}>
              Track My Bids
            </button>
            <button onClick={() => router.push("/hotels")} className="bx-nav-back" style={{ width: "100%", flex: "0 0 auto" }}>
              Browse Hotels
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  /* ─────────────── Main Form ─────────────── */
  return (
    <div className="bx-shell min-h-screen pb-24">
      <div className="max-w-xl mx-auto px-4 pt-4">

        {/* Toolbar */}
        <div className="bx-toolbar">
          <button type="button" onClick={() => router.back()} className="bx-toolbar-back" aria-label="Back">
            ‹
          </button>
          <span className="bx-toolbar-crumb">
            Auction Pit{form.city ? ` · ${form.city}` : ""}
          </span>
        </div>

        {/* Editorial hero */}
        <div className="bx-hero">
          <span className="bx-hero-eyebrow">
            <span className="bx-hero-eyebrow-dot" />
            Reverse Auction · Live
          </span>
          <h1 className="bx-hero-title">
            Name Your <em>Price</em>
          </h1>
          <p className="bx-hero-sub">
            Set what you want to pay. Hotels in {form.city || "your destination"} compete for your booking — the best offer wins your night.
          </p>

          {/* Live stats ribbon */}
          {insights && (
            <div className="bx-stats-ribbon">
              {insights.tonightAuctions > 0 && (
                <span className="bx-stat-pill bx-stat-pill-live">
                  <span className="bx-stat-pill-value">{liveAuctions}</span>
                  <span className="bx-stat-pill-label">auctions live{form.city ? ` in ${form.city}` : " tonight"}</span>
                </span>
              )}
              {insights.hotelsListening > 0 && (
                <span className="bx-stat-pill">
                  <span className="bx-stat-pill-icon">🏨</span>
                  <span className="bx-stat-pill-value">{liveHotels}</span>
                  <span className="bx-stat-pill-label">hotels listening</span>
                </span>
              )}
              {insights.cityHotStreak >= 1 && (
                <span className="bx-stat-pill bx-stat-pill-hot">
                  <span className="bx-stat-pill-icon">🔥</span>
                  <span className="bx-stat-pill-value">{liveStreak}</span>
                  <span className="bx-stat-pill-label">accepted in last hour</span>
                </span>
              )}
              {insights.acceptedToday > 0 && (
                <span className="bx-stat-pill bx-stat-pill-accent">
                  <span className="bx-stat-pill-icon">✓</span>
                  <span className="bx-stat-pill-value">{liveAccepted}</span>
                  <span className="bx-stat-pill-label">wins today</span>
                </span>
              )}
              {insights.avgAcceptMins > 0 && (
                <span className="bx-stat-pill">
                  <span className="bx-stat-pill-icon">⏱</span>
                  <span className="bx-stat-pill-value">{insights.avgAcceptMins} min</span>
                  <span className="bx-stat-pill-label">avg accept</span>
                </span>
              )}
            </div>
          )}

          {/* Live wins ticker */}
          {currentWin && (
            <div className="bx-ticker" key={`tick-${currentWin.id}`}>
              <span className="bx-ticker-tag">
                <span className="bx-ticker-tag-dot" />
                Live wins
              </span>
              <div className="bx-ticker-feed">
                <div className="bx-ticker-row" key={currentWin.id}>
                  <span className="who">{currentWin.initial}</span>
                  <span>won</span>
                  <span className="amt">₹{currentWin.amount.toLocaleString("en-IN")}/n</span>
                  <span>in {currentWin.city || currentWin.hotelName}</span>
                  <span className="at">· {currentWin.when}</span>
                </div>
              </div>
              <div className="bx-ticker-dotrow">
                {(insights?.recentWins || []).slice(0, 5).map((_, i) => (
                  <span key={i} className={`bx-ticker-dot ${i === tickerIdx % (insights?.recentWins.length || 1) ? "is-active" : ""}`} />
                ))}
              </div>
            </div>
          )}
        </div>

        <StepBar step={step} />

        <div className={`transition-all duration-200 ${animating ? "opacity-0 translate-y-2" : "opacity-100 translate-y-0"}`}>

          {/* ═══════════ STEP 1: WHERE & WHEN ═══════════ */}
          {step === 1 && (
            <div className="space-y-3" data-autonext-form>

              {/* Destination */}
              <div data-autonext="destination">
                <div className="bx-section-h">
                  <span className="bx-section-h-label">
                    Destination <span className="bx-section-h-required">*</span>
                  </span>
                  <span className="bx-section-h-rule" />
                </div>
                <div className="grid grid-cols-2 gap-2.5">
                  {Object.entries(CITY_DATA).map(([name, info]) => {
                    const isSelected = form.city === name;
                    const isSurge = info.demand === "Very High" || info.demand === "High";
                    return (
                      <button
                        key={name}
                        type="button"
                        onClick={() => { upd("city", name); scrollToAutoNext("dates"); }}
                        className={`bx-tile ${isSelected ? "is-selected" : ""}`}
                      >
                        <span className={`bx-tile-demand ${isSurge ? "is-surge" : ""}`}>
                          <span className="dot" />
                          {info.demand === "Very High" ? "Hot" : info.demand}
                        </span>
                        <span className="bx-tile-icon">{info.emoji}</span>
                        <p className="bx-tile-name">{name}</p>
                        <p className="bx-tile-sub">{info.state}</p>
                        <div className="bx-tile-tags">
                          {info.tags.slice(0, 2).map(t => (
                            <span key={t} className="bx-tile-tag">{t}</span>
                          ))}
                        </div>
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

              {/* Guests */}
              <div data-autonext="guests">
                <div className="bx-section-h">
                  <span className="bx-section-h-label">Guests &amp; Rooms</span>
                  <span className="bx-section-h-rule" />
                </div>
                <div className="bx-card">
                  {[
                    { label: "Adults",     key: "adults",   sub: "Ages 18+",     min: 1, max: 10 },
                    { label: "Children",   key: "children", sub: "Ages 2–17",    min: 0, max: 6  },
                    { label: "Rooms",      key: "rooms",    sub: "Rooms needed", min: 1, max: 5  },
                  ].map(({ label, key, sub, min, max }) => (
                    <div key={key} className="bx-counter-row">
                      <div>
                        <p className="bx-counter-label">{label}</p>
                        <p className="bx-counter-sub">{sub}</p>
                      </div>
                      <Counter value={(form as any)[key]} onChange={(v) => upd(key, v)} min={min} max={max} />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ═══════════ STEP 2: YOUR STAY ═══════════ */}
          {step === 2 && (
            <div className="space-y-3" data-autonext-form>

              {/* Room type */}
              <div data-autonext="roomType">
                <div className="bx-section-h">
                  <span className="bx-section-h-label">Room Type</span>
                  <span className="bx-section-h-rule" />
                </div>
                <div className="grid grid-cols-2 gap-2.5">
                  {ROOM_TYPES.map((rt) => (
                    <button
                      key={rt.id}
                      type="button"
                      onClick={() => { upd("roomType", rt.id); scrollToAutoNext("bedType"); }}
                      className={`bx-tile ${form.roomType === rt.id ? "is-selected" : ""}`}
                    >
                      <span className="bx-tile-icon">{rt.icon}</span>
                      <p className="bx-tile-name">{rt.label}</p>
                      <p className="bx-tile-sub">{rt.desc}</p>
                    </button>
                  ))}
                </div>
              </div>

              {/* Bed type */}
              <div data-autonext="bedType">
                <div className="bx-section-h">
                  <span className="bx-section-h-label">Bed Preference</span>
                  <span className="bx-section-h-rule" />
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {BED_TYPES.map((bt) => (
                    <button
                      key={bt.id}
                      type="button"
                      onClick={() => { upd("bedType", bt.id); scrollToAutoNext("view"); }}
                      className={`bx-chip ${form.bedType === bt.id ? "is-selected" : ""}`}
                    >
                      {bt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* View */}
              <div data-autonext="view">
                <div className="bx-section-h">
                  <span className="bx-section-h-label">View Preference</span>
                  <span className="bx-section-h-rule" />
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {VIEW_PREFS.map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => { upd("view", v); scrollToAutoNext("mealPlan"); }}
                      className={`bx-chip ${form.view === v ? "is-selected" : ""}`}
                    >
                      {v}
                    </button>
                  ))}
                </div>
              </div>

              {/* Meal */}
              <div data-autonext="mealPlan">
                <div className="bx-section-h">
                  <span className="bx-section-h-label">Meal Plan</span>
                  <span className="bx-section-h-rule" />
                </div>
                <div className="grid grid-cols-2 gap-2.5">
                  {MEAL_PLANS.map((mp) => (
                    <button
                      key={mp.id}
                      type="button"
                      onClick={() => { upd("mealPlan", mp.id); scrollToAutoNext("occasion"); }}
                      className={`bx-tile ${form.mealPlan === mp.id ? "is-selected" : ""}`}
                    >
                      <span className="bx-tile-icon">{mp.icon}</span>
                      <p className="bx-tile-name">{mp.label}</p>
                      <p className="bx-tile-sub">{mp.desc}</p>
                    </button>
                  ))}
                </div>
              </div>

              {/* Occasion */}
              <div data-autonext="occasion">
                <div className="bx-section-h">
                  <span className="bx-section-h-label">Trip Purpose / Occasion</span>
                  <span className="bx-section-h-rule" />
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {OCCASIONS.map((oc) => (
                    <button
                      key={oc.id}
                      type="button"
                      onClick={() => { upd("occasion", oc.id); scrollToAutoNext("addons"); }}
                      className={`bx-tile ${form.occasion === oc.id ? "is-selected" : ""}`}
                      style={{ textAlign: "center", padding: 11 }}
                    >
                      <span className="bx-tile-icon" style={{ fontSize: "1.2rem", margin: "0 auto 3px" }}>{oc.icon}</span>
                      <p className="bx-tile-name" style={{ fontSize: "0.68rem", textAlign: "center" }}>{oc.label}</p>
                    </button>
                  ))}
                </div>
              </div>

              {/* Add-ons */}
              <div data-autonext="addons">
                <div className="bx-section-h">
                  <span className="bx-section-h-label">Add-ons &amp; Preferences</span>
                  <span className="bx-section-h-rule" />
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {[
                    { key: "earlyCheckIn",    icon: "🌅", label: "Early Check-in",      sub: "Before 12 PM if available" },
                    { key: "lateCheckOut",    icon: "🌇", label: "Late Check-out",       sub: "After 12 PM if available"  },
                    { key: "airportTransfer", icon: "🚗", label: "Airport Transfer",     sub: "Pick-up & drop service"    },
                    { key: "petFriendly",     icon: "🐾", label: "Pet-Friendly Room",    sub: "Pets are coming along"     },
                    { key: "smokingRoom",     icon: "🚬", label: "Smoking Room",         sub: "If available"              },
                  ].map(({ key, icon, label, sub }) => (
                    <label key={key} className={`bx-addon-row ${(form as any)[key] ? "is-on" : ""}`}>
                      <span className="bx-addon-icon">{icon}</span>
                      <div className="bx-addon-body">
                        <div className="bx-addon-label">{label}</div>
                        <div className="bx-addon-sub">{sub}</div>
                      </div>
                      <input
                        type="checkbox"
                        checked={(form as any)[key]}
                        onChange={(e) => upd(key, e.target.checked)}
                        className="bx-addon-check"
                      />
                    </label>
                  ))}
                </div>

                <div style={{ marginTop: 14 }}>
                  <div className="bx-section-h" style={{ margin: "0 0 8px" }}>
                    <span className="bx-section-h-label">Additional requests</span>
                    <span className="bx-section-h-rule" />
                  </div>
                  <textarea
                    value={form.specialRequests}
                    onChange={(e) => upd("specialRequests", e.target.value)}
                    placeholder="Mountain view, quiet floor, extra pillows, wheelchair access…"
                    rows={3}
                    style={{
                      width: "100%",
                      padding: "12px 14px",
                      background: "var(--bg-card)",
                      border: "1.5px solid var(--border-soft)",
                      borderRadius: 14,
                      color: "var(--text-base)",
                      fontSize: "0.85rem",
                      resize: "vertical",
                      fontFamily: "inherit",
                      outline: "none",
                    }}
                  />
                </div>
              </div>
            </div>
          )}

          {/* ═══════════ STEP 3: SMART BUDGET ═══════════ */}
          {step === 3 && (
            <div className="space-y-3" data-autonext-form>

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
                      placeholder="0"
                      min="500"
                      className="bx-budget-input"
                      inputMode="numeric"
                    />
                  </div>
                  <div className="bx-budget-suffix">per room / per night</div>
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
            </div>
          )}

          {/* ═══════════ STEP 4: REVIEW & LAUNCH ═══════════ */}
          {step === 4 && (
            <div className="space-y-3" data-autonext-form>
              {/* Cinematic probability hero */}
              {bidStr && (
                <div className="bx-review-hero">
                  <div className="bx-review-eyebrow">
                    <span className="bx-hero-eyebrow-dot" style={{ background: bidStr.color }} />
                    AI confidence
                  </div>
                  <div className="bx-review-pct">
                    {bidStr.pct}<span style={{ fontSize: "1.4rem", color: "var(--cozy-champagne-light)" }}>%</span>
                  </div>
                  <p className="bx-review-tier" style={{ color: bidStr.color }}>{bidStr.tier}</p>
                  <p className="bx-review-tip">{bidStr.tip}</p>
                </div>
              )}

              {/* Trip summary card */}
              <div className="bx-card">
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

                {form.specialRequests && (
                  <>
                    <div className="bx-cost-divider" style={{ margin: "14px 0" }} />
                    <div>
                      <div className="bx-review-item-label" style={{ marginBottom: 4 }}>Special Requests</div>
                      <p style={{ fontSize: "0.78rem", color: "var(--text-soft)", lineHeight: 1.45 }}>{form.specialRequests}</p>
                    </div>
                  </>
                )}

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
          {step < 4 && (
            <button onClick={() => canNext() && goStep(step + 1)} disabled={!canNext()} className="bx-nav-cont">
              Continue →
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
