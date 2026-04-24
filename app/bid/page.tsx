"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";

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
  if (r >= 1.00) return { pct: 96, label: "Instant Accept", color: "#10b981", bar: "bg-emerald-500", tip: "Hotels will compete aggressively for your booking!", responseTime: "Auto-confirms instantly" };
  if (r >= 0.90) return { pct: 78, label: "Very Strong",    color: "#059669", bar: "bg-emerald-400", tip: "Excellent bid — most 4★+ hotels will accept.",       responseTime: "Confirms in ~30 min"    };
  if (r >= 0.80) return { pct: 60, label: "Strong",         color: "#c9911a", bar: "bg-gold-500",    tip: "Good chance — 3–5 hotels likely to respond.",        responseTime: "Response in ~1 hr"      };
  if (r >= 0.70) return { pct: 42, label: "Moderate",       color: "#d97706", bar: "bg-amber-500",   tip: "Some hotels may counter with a slightly higher rate.", responseTime: "Response in 2–3 hrs"   };
  if (r >= 0.60) return { pct: 25, label: "Low",            color: "#ea580c", bar: "bg-orange-500",  tip: "Hotels may counter — be ready to negotiate.",        responseTime: "Response in 4–6 hrs"    };
  return              { pct: 10,  label: "Very Low",        color: "#dc2626", bar: "bg-red-500",     tip: "Consider increasing budget for better responses.",    responseTime: "Unlikely to receive bids" };
}

function numNights(ci: string, co: string) {
  if (!ci || !co) return 0;
  return Math.max(0, Math.round((new Date(co).getTime() - new Date(ci).getTime()) / 86400000));
}

/* ── Step Indicator ────────────────────────────────────────────── */
const STEPS = ["Where & When", "Your Stay", "Smart Budget", "Review & Launch"];

function StepBar({ step }: { step: number }) {
  return (
    <div className="flex items-center justify-between mb-10 px-1">
      {STEPS.map((label, i) => {
        const idx = i + 1;
        const done = idx < step;
        const active = idx === step;
        return (
          <div key={label} className="flex-1 flex flex-col items-center relative">
            {i < STEPS.length - 1 && (
              <div className={`absolute top-3.5 left-1/2 w-full h-0.5 transition-all duration-500 ${done ? "bg-gold-400" : "bg-white/10"}`} />
            )}
            <div className={`w-7 h-7 rounded-full flex items-center justify-center z-10 text-xs font-bold transition-all duration-300 ${
              done   ? "bg-gold-500 text-white" :
              active ? "bg-luxury-900 text-white ring-2 ring-offset-2 ring-luxury-900" :
                       "bg-white/10 text-white/50"
            }`}>
              {done ? "✓" : idx}
            </div>
            <p className={`text-[0.6rem] font-semibold tracking-wide mt-1.5 hidden sm:block ${active ? "text-white" : done ? "text-gold-500" : "text-white/40"}`}>
              {label}
            </p>
          </div>
        );
      })}
    </div>
  );
}

/* ── Counter Button ────────────────────────────────────────────── */
function Counter({ value, onChange, min = 0, max = 10 }: { value: number; onChange: (v: number) => void; min?: number; max?: number }) {
  return (
    <div className="flex items-center gap-3">
      <button onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min}
        className="w-8 h-8 rounded-full border border-white/15 flex items-center justify-center text-white/70 hover:border-gold-400 hover:text-gold-600 disabled:opacity-30 disabled:cursor-not-allowed transition text-lg font-light">−</button>
      <span className="w-6 text-center font-bold text-white text-lg">{value}</span>
      <button onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max}
        className="w-8 h-8 rounded-full border border-white/15 flex items-center justify-center text-white/70 hover:border-gold-400 hover:text-gold-600 disabled:opacity-30 transition text-lg font-light">+</button>
    </div>
  );
}

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

  const city     = CITY_DATA[form.city];
  const nights   = numNights(form.checkIn, form.checkOut);
  const budget   = parseFloat(form.maxBudget) || 0;
  const bidStr   = city && budget > 0 ? calcBidStrength(budget, city.avg) : null;
  const totalEst = budget > 0 && nights > 0 ? budget * nights * form.rooms : 0;
  const today    = new Date().toISOString().split("T")[0];

  const presets = city ? [
    { label: "Budget",   pct: 70,  amount: Math.round(city.avg * 0.70 / 50) * 50,  icon: "💰", desc: "Best saving, lower chance" },
    { label: "Smart",    pct: 88,  amount: Math.round(city.avg * 0.88 / 50) * 50,  icon: "⭐", desc: "Optimal balance",  recommended: true },
    { label: "Premium",  pct: 105, amount: Math.round(city.avg * 1.05 / 50) * 50,  icon: "⚡", desc: "Instant confirm" },
  ] : [];

  const canNext = (): boolean => {
    if (step === 1) return !!(form.city && form.checkIn && form.checkOut && nights >= 1);
    if (step === 2) return !!form.roomType;
    if (step === 3) return budget > 0;
    return true;
  };

  const goStep = (next: number) => {
    setAnimating(true);
    setTimeout(() => { setStep(next); setAnimating(false); }, 180);
  };

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

  /* ── Success Screen ── */
  if (success) return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: "linear-gradient(160deg, #faf9f6 0%, #f0ebe0 100%)" }}>
      <div className="max-w-md w-full">
        <div className="bg-white rounded-3xl border border-white/10 shadow-2xl p-8 text-center">
          <div className="w-20 h-20 rounded-full mx-auto mb-5 flex items-center justify-center" style={{ background: "linear-gradient(135deg, #c9911a, #f0b429)" }}>
            <span className="text-3xl">🎯</span>
          </div>
          <p className="text-gold-500 text-[0.65rem] font-semibold tracking-[0.2em] uppercase mb-2">Bid Request Launched</p>
          <h1 className="font-display font-light text-white text-3xl mb-3">Hotels Are Competing!</h1>
          <p className="text-white/50 text-sm leading-relaxed mb-6">
            Your bid for <strong className="text-white/80">{success.nights} nights in {success.city}</strong> has been sent to <strong className="text-gold-600">{success.hotelsNotified || "all matching"} {success.hotelsNotified === 1 ? "hotel" : "hotels"}</strong>. You'll be notified the moment they respond.
          </p>

          {/* Mini summary */}
          <div className="bg-white/5 rounded-2xl p-4 mb-6 grid grid-cols-3 gap-3 text-left">
            <div>
              <p className="text-[0.58rem] text-white/40 uppercase tracking-wider mb-0.5">Check-in</p>
              <p className="text-xs font-bold text-white/90">{new Date(success.checkIn).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</p>
            </div>
            <div>
              <p className="text-[0.58rem] text-white/40 uppercase tracking-wider mb-0.5">Nights</p>
              <p className="text-xs font-bold text-white/90">{success.nights}</p>
            </div>
            <div>
              <p className="text-[0.58rem] text-white/40 uppercase tracking-wider mb-0.5">Budget/night</p>
              <p className="text-xs font-bold text-white/90">₹{success.budget}</p>
            </div>
          </div>

          {/* Est. total */}
          {success.totalEst > 0 && (
            <div className="bg-gold-50 border border-gold-200 rounded-2xl p-3 mb-6">
              <p className="text-xs text-white/60 mb-0.5">Estimated total (incl. rooms)</p>
              <p className="text-xl font-bold text-gold-700">₹{success.totalEst.toLocaleString("en-IN")}</p>
              <p className="text-[0.6rem] text-white/50">+ taxes · final price confirmed by hotel</p>
            </div>
          )}

          <div className="space-y-2">
            <button onClick={() => router.push("/my-bids")} className="lux-btn w-full py-3.5 rounded-2xl text-sm">
              Track My Bids
            </button>
            <button onClick={() => router.push("/hotels")} className="w-full py-3 text-sm text-white/60 hover:text-white/90 transition">
              Browse Hotels
            </button>
          </div>
        </div>

        <p className="text-center text-xs text-white/40 mt-5 tracking-wide">
          Average hotel response time: <span className="text-white/60 font-medium">2–4 hours</span>
        </p>
      </div>
    </div>
  );

  /* ── Main Form ── */
  return (
    <div className="min-h-screen pb-16 lux-bg">
      <div className="max-w-xl mx-auto px-4 pt-10">

        {/* Header */}
        <div className="mb-8">
          <p className="text-gold-500 text-[0.68rem] font-semibold tracking-[0.2em] uppercase mb-2">AI Smart Booking</p>
          <h1 className="font-display font-light text-white mb-2" style={{ fontSize: "clamp(1.8rem, 4vw, 2.4rem)" }}>
            Name Your Price
          </h1>
          <p className="text-white/50 text-sm leading-relaxed">
            Tell us what you want. Our AI finds the best hotel match and launches a reverse auction — hotels compete for your booking.
          </p>
        </div>

        <StepBar step={step} />

        <div className={`transition-all duration-200 ${animating ? "opacity-0 translate-y-2" : "opacity-100 translate-y-0"}`}>

          {/* ═══════════ STEP 1: WHERE & WHEN ═══════════ */}
          {step === 1 && (
            <div className="space-y-6">
              {/* Destination */}
              <div className="lux-glass lux-border rounded-3xl p-6">
                <label className="text-[0.65rem] font-bold text-white/50 uppercase tracking-[0.18em] block mb-4">
                  Destination <span className="text-gold-500">*</span>
                </label>
                <div className="grid grid-cols-2 gap-2.5">
                  {Object.entries(CITY_DATA).map(([name, info]) => (
                    <button key={name} onClick={() => upd("city", name)}
                      className={`relative p-3.5 rounded-2xl border text-left transition-all duration-200 ${
                        form.city === name
                          ? "border-gold-400 bg-gold-50 shadow-gold"
                          : "border-white/10 bg-white/5 hover:border-gold-200 hover:bg-gold-50/30"
                      }`}>
                      <div className="flex items-start justify-between mb-1.5">
                        <span className="text-xl">{info.emoji}</span>
                        <span className={`text-[0.52rem] font-bold px-1.5 py-0.5 rounded-full border ${info.demandColor}`}>
                          {info.demand}
                        </span>
                      </div>
                      <p className="font-semibold text-sm text-white">{name}</p>
                      <p className="text-[0.6rem] text-white/50 mt-0.5">{info.state}</p>
                      <div className="flex gap-1 mt-1.5 flex-wrap">
                        {info.tags.slice(0, 2).map(t => (
                          <span key={t} className="text-[0.5rem] bg-white/10 text-white/60 px-1.5 py-0.5 rounded-full">{t}</span>
                        ))}
                      </div>
                    </button>
                  ))}
                </div>

                {/* AI city tip */}
                {city && (
                  <div className="mt-4 flex items-start gap-2.5 bg-amber-50 border border-amber-200 rounded-2xl p-3.5">
                    <span className="text-amber-500 text-sm mt-0.5">🤖</span>
                    <div>
                      <p className="text-[0.65rem] font-bold text-amber-700 uppercase tracking-wide mb-0.5">AI Insight</p>
                      <p className="text-xs text-amber-700">{city.tip}</p>
                      <p className="text-[0.6rem] text-amber-500 mt-1">Avg. hotel price: ₹{city.avg.toLocaleString("en-IN")}/night</p>
                    </div>
                  </div>
                )}
              </div>

              {/* Dates */}
              <div className="lux-glass lux-border rounded-3xl p-6">
                <label className="text-[0.65rem] font-bold text-white/50 uppercase tracking-[0.18em] block mb-4">
                  Dates <span className="text-gold-500">*</span>
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-xs text-white/60 font-medium mb-1.5">Check-in</p>
                    <input type="date" value={form.checkIn} min={today}
                      onChange={(e) => { upd("checkIn", e.target.value); if (form.checkOut && e.target.value >= form.checkOut) upd("checkOut", ""); }}
                      className="input-luxury text-sm w-full" />
                  </div>
                  <div>
                    <p className="text-xs text-white/60 font-medium mb-1.5">Check-out</p>
                    <input type="date" value={form.checkOut} min={form.checkIn || today}
                      onChange={(e) => upd("checkOut", e.target.value)}
                      className="input-luxury text-sm w-full" />
                  </div>
                </div>
                {nights > 0 && (
                  <div className="mt-3 flex items-center gap-2">
                    <div className="h-px flex-1 bg-white/10" />
                    <span className="text-xs font-bold text-gold-600 bg-gold-50 border border-gold-200 px-3 py-1 rounded-full">
                      {nights} {nights === 1 ? "night" : "nights"}
                    </span>
                    <div className="h-px flex-1 bg-white/10" />
                  </div>
                )}
              </div>

              {/* Guests */}
              <div className="lux-glass lux-border rounded-3xl p-6">
                <label className="text-[0.65rem] font-bold text-white/50 uppercase tracking-[0.18em] block mb-4">Guests & Rooms</label>
                <div className="space-y-4">
                  {[
                    { label: "Adults",     key: "adults",   sub: "Ages 18+",  min: 1, max: 10 },
                    { label: "Children",   key: "children", sub: "Ages 2–17", min: 0, max: 6  },
                    { label: "Rooms",      key: "rooms",    sub: "Rooms needed", min: 1, max: 5 },
                  ].map(({ label, key, sub, min, max }) => (
                    <div key={key} className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-semibold text-white/90">{label}</p>
                        <p className="text-xs text-white/50">{sub}</p>
                      </div>
                      <Counter value={(form as any)[key]} onChange={(v) => upd(key, v)} min={min} max={max} />
                    </div>
                  ))}
                </div>
                <div className="mt-4 pt-3 border-t border-white/10">
                  <p className="text-xs text-white/50 text-center">
                    Total guests: <span className="font-bold text-white/80">{form.adults + form.children}</span>
                    {form.rooms > 1 && <> · <span className="font-bold text-white/80">{form.rooms} rooms</span></>}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* ═══════════ STEP 2: YOUR STAY ═══════════ */}
          {step === 2 && (
            <div className="space-y-6">
              {/* Room type */}
              <div className="lux-glass lux-border rounded-3xl p-6">
                <label className="text-[0.65rem] font-bold text-white/50 uppercase tracking-[0.18em] block mb-4">Room Type</label>
                <div className="grid grid-cols-2 gap-2.5">
                  {ROOM_TYPES.map((rt) => (
                    <button key={rt.id} onClick={() => upd("roomType", rt.id)}
                      className={`p-4 rounded-2xl border text-left transition-all duration-200 ${
                        form.roomType === rt.id
                          ? "border-gold-400 bg-gold-50 shadow-gold"
                          : "border-white/10 hover:border-gold-200 hover:bg-gold-50/30"
                      }`}>
                      <span className="text-2xl block mb-2">{rt.icon}</span>
                      <p className="font-bold text-sm text-white">{rt.label}</p>
                      <p className="text-[0.6rem] text-white/50 mt-0.5">{rt.desc}</p>
                    </button>
                  ))}
                </div>
              </div>

              {/* Bed type */}
              <div className="lux-glass lux-border rounded-3xl p-6">
                <label className="text-[0.65rem] font-bold text-white/50 uppercase tracking-[0.18em] block mb-4">Bed Preference</label>
                <div className="flex flex-wrap gap-2">
                  {BED_TYPES.map((bt) => (
                    <button key={bt.id} onClick={() => upd("bedType", bt.id)}
                      className={`px-4 py-2 rounded-xl text-sm font-medium transition-all duration-200 ${
                        form.bedType === bt.id
                          ? "lux-btn shadow-gold"
                          : "bg-white/5 border border-white/15 text-white/70 hover:border-gold-300"
                      }`}>
                      {bt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* View preference */}
              <div className="lux-glass lux-border rounded-3xl p-6">
                <label className="text-[0.65rem] font-bold text-white/50 uppercase tracking-[0.18em] block mb-4">View Preference</label>
                <div className="flex flex-wrap gap-2">
                  {VIEW_PREFS.map((v) => (
                    <button key={v} onClick={() => upd("view", v)}
                      className={`px-4 py-2 rounded-xl text-sm font-medium transition-all duration-200 ${
                        form.view === v
                          ? "lux-btn shadow-gold"
                          : "bg-white/5 border border-white/15 text-white/70 hover:border-gold-300"
                      }`}>
                      {v}
                    </button>
                  ))}
                </div>
              </div>

              {/* Meal plan */}
              <div className="lux-glass lux-border rounded-3xl p-6">
                <label className="text-[0.65rem] font-bold text-white/50 uppercase tracking-[0.18em] block mb-4">Meal Plan</label>
                <div className="grid grid-cols-2 gap-2.5">
                  {MEAL_PLANS.map((mp) => (
                    <button key={mp.id} onClick={() => upd("mealPlan", mp.id)}
                      className={`p-3.5 rounded-2xl border text-left transition-all duration-200 ${
                        form.mealPlan === mp.id
                          ? "border-gold-400 bg-gold-50 shadow-gold"
                          : "border-white/10 hover:border-gold-200 hover:bg-gold-50/30"
                      }`}>
                      <span className="text-xl block mb-1.5">{mp.icon}</span>
                      <p className="font-bold text-xs text-white">{mp.label}</p>
                      <p className="text-[0.57rem] text-white/50 mt-0.5">{mp.desc}</p>
                    </button>
                  ))}
                </div>
              </div>

              {/* Special occasion */}
              <div className="lux-glass lux-border rounded-3xl p-6">
                <label className="text-[0.65rem] font-bold text-white/50 uppercase tracking-[0.18em] block mb-4">Trip Purpose / Occasion</label>
                <div className="grid grid-cols-3 gap-2">
                  {OCCASIONS.map((oc) => (
                    <button key={oc.id} onClick={() => upd("occasion", oc.id)}
                      className={`p-3 rounded-2xl border text-center transition-all duration-200 ${
                        form.occasion === oc.id
                          ? "border-gold-400 bg-gold-50 shadow-gold"
                          : "border-white/10 hover:border-gold-200 hover:bg-gold-50/30"
                      }`}>
                      <span className="text-xl block mb-1">{oc.icon}</span>
                      <p className="text-[0.58rem] font-bold text-white/80 leading-tight">{oc.label}</p>
                    </button>
                  ))}
                </div>
              </div>

              {/* Add-ons */}
              <div className="lux-glass lux-border rounded-3xl p-6">
                <label className="text-[0.65rem] font-bold text-white/50 uppercase tracking-[0.18em] block mb-4">Add-ons & Preferences</label>
                <div className="space-y-2.5">
                  {[
                    { key: "earlyCheckIn",    icon: "🌅", label: "Early Check-in",          sub: "Before 12 PM if available" },
                    { key: "lateCheckOut",    icon: "🌇", label: "Late Check-out",           sub: "After 12 PM if available"  },
                    { key: "airportTransfer", icon: "🚗", label: "Airport Transfer",          sub: "Pick-up & drop service"    },
                    { key: "petFriendly",     icon: "🐾", label: "Pet-Friendly Room",        sub: "Pets are coming along"     },
                    { key: "smokingRoom",     icon: "🚬", label: "Smoking Room",             sub: "If available"              },
                  ].map(({ key, icon, label, sub }) => (
                    <label key={key} className={`flex items-center gap-3 p-3 rounded-2xl border cursor-pointer transition-all duration-200 ${
                      (form as any)[key] ? "border-gold-300 bg-gold-50" : "border-white/10 hover:border-gold-200"
                    }`}>
                      <span className="text-lg">{icon}</span>
                      <div className="flex-1">
                        <p className="text-sm font-semibold text-white/90">{label}</p>
                        <p className="text-[0.6rem] text-white/50">{sub}</p>
                      </div>
                      <input type="checkbox" checked={(form as any)[key]} onChange={(e) => upd(key, e.target.checked)}
                        className="w-4 h-4 accent-amber-500 rounded" />
                    </label>
                  ))}
                </div>

                {/* Special requests */}
                <div className="mt-4">
                  <p className="text-xs font-semibold text-white/60 mb-2">Additional Requests</p>
                  <textarea value={form.specialRequests} onChange={(e) => upd("specialRequests", e.target.value)}
                    placeholder="Mountain view, quiet floor, extra pillows, wheelchair access…"
                    className="input-luxury text-sm resize-none w-full" rows={3} />
                </div>
              </div>
            </div>
          )}

          {/* ═══════════ STEP 3: SMART BUDGET ═══════════ */}
          {step === 3 && (
            <div className="space-y-6">
              {/* AI Smart Presets */}
              {city && (
                <div className="lux-glass lux-border rounded-3xl p-6">
                  <div className="flex items-center gap-2 mb-4">
                    <span className="text-lg">🤖</span>
                    <div>
                      <p className="text-[0.65rem] font-bold text-white/50 uppercase tracking-[0.18em]">AI Smart Presets</p>
                      <p className="text-xs text-white/60">Based on {form.city} avg. ₹{city.avg.toLocaleString("en-IN")}/night</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2.5">
                    {presets.map((p) => (
                      <button key={p.label} onClick={() => upd("maxBudget", String(p.amount))}
                        className={`relative p-3.5 rounded-2xl border text-center transition-all duration-200 ${
                          parseInt(form.maxBudget) === p.amount
                            ? "border-gold-400 bg-gold-50 shadow-gold"
                            : "border-white/10 hover:border-gold-200 hover:bg-gold-50/30"
                        }`}>
                        {p.recommended && (
                          <span className="absolute -top-2 left-1/2 -translate-x-1/2 text-[0.5rem] font-bold bg-gold-500 text-white px-2 py-0.5 rounded-full uppercase tracking-wide">
                            Recommended
                          </span>
                        )}
                        <span className="text-xl block mb-1.5">{p.icon}</span>
                        <p className="font-bold text-xs text-white">{p.label}</p>
                        <p className="text-gold-600 font-bold text-sm mt-0.5">₹{p.amount.toLocaleString("en-IN")}</p>
                        <p className="text-[0.55rem] text-white/50 mt-0.5">{p.desc}</p>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Budget input */}
              <div className="lux-glass lux-border rounded-3xl p-6">
                <label className="text-[0.65rem] font-bold text-white/50 uppercase tracking-[0.18em] block mb-4">
                  Your Max Budget <span className="text-gold-500">*</span> <span className="text-white/40 font-normal normal-case tracking-normal text-[0.65rem]">per room / night</span>
                </label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-xl font-bold text-white/50">₹</span>
                  <input type="number" value={form.maxBudget} onChange={(e) => upd("maxBudget", e.target.value)}
                    placeholder="0" min="500"
                    className="input-luxury text-2xl font-bold pl-10 w-full" />
                </div>
                {city && budget > 0 && (
                  <p className="text-xs text-white/50 mt-2 text-center">
                    {budget < city.avg
                      ? `₹${(city.avg - budget).toLocaleString("en-IN")} below city average`
                      : `₹${(budget - city.avg).toLocaleString("en-IN")} above city average`}
                  </p>
                )}
              </div>

              {/* AI Strength Meter */}
              {bidStr && (
                <div className="lux-glass lux-border rounded-3xl p-6">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <p className="text-[0.65rem] font-bold text-white/50 uppercase tracking-[0.18em]">AI Bid Strength</p>
                      <p className="text-xl font-bold mt-0.5" style={{ color: bidStr.color }}>{bidStr.label}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-3xl font-bold" style={{ color: bidStr.color }}>{bidStr.pct}%</p>
                      <p className="text-[0.6rem] text-white/50">acceptance chance</p>
                    </div>
                  </div>

                  {/* Bar */}
                  <div className="h-3 bg-white/10 rounded-full overflow-hidden mb-3">
                    <div className={`h-full ${bidStr.bar} rounded-full transition-all duration-700`} style={{ width: `${bidStr.pct}%` }} />
                  </div>

                  <p className="text-xs text-white/70 bg-white/5 rounded-xl p-3 mb-3">{bidStr.tip}</p>
                  <div className="flex items-center gap-1.5 text-xs text-white/50">
                    <span>⏱</span>
                    <span>{bidStr.responseTime}</span>
                  </div>
                </div>
              )}

              {/* Cost Breakdown */}
              {budget > 0 && nights > 0 && (
                <div className="lux-glass lux-border rounded-3xl p-6">
                  <p className="text-[0.65rem] font-bold text-white/50 uppercase tracking-[0.18em] mb-4">Estimated Cost Breakdown</p>
                  <div className="space-y-2.5">
                    {[
                      { label: `₹${budget.toLocaleString("en-IN")} × ${nights} nights`, value: (budget * nights).toLocaleString("en-IN") },
                      ...(form.rooms > 1 ? [{ label: `× ${form.rooms} rooms`, value: (budget * nights * form.rooms).toLocaleString("en-IN") }] : []),
                    ].map(({ label, value }) => (
                      <div key={label} className="flex items-center justify-between text-sm">
                        <span className="text-white/60">{label}</span>
                        <span className="font-semibold text-white/90">₹{value}</span>
                      </div>
                    ))}
                    <div className="h-px bg-white/10" />
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-white/50">Taxes ~12%</span>
                      <span className="text-xs text-white/60">₹{Math.round(totalEst * 0.12).toLocaleString("en-IN")} est.</span>
                    </div>
                    <div className="flex items-center justify-between bg-gold-50 border border-gold-200 rounded-xl p-3">
                      <span className="text-sm font-bold text-white/90">Total Estimate</span>
                      <span className="text-lg font-bold text-gold-700">₹{Math.round(totalEst * 1.12).toLocaleString("en-IN")}</span>
                    </div>
                  </div>
                  <p className="text-[0.6rem] text-white/40 mt-2 text-center">Final price confirmed by hotel at acceptance</p>
                </div>
              )}
            </div>
          )}

          {/* ═══════════ STEP 4: REVIEW & LAUNCH ═══════════ */}
          {step === 4 && (
            <div className="space-y-5">
              {/* AI Confidence Banner */}
              {bidStr && (
                <div className={`rounded-3xl border p-5 text-center ${
                  bidStr.pct >= 60
                    ? "bg-emerald-50 border-emerald-200"
                    : bidStr.pct >= 40
                    ? "bg-amber-50 border-amber-200"
                    : "bg-red-50 border-red-200"
                }`}>
                  <p className="text-2xl font-bold mb-0.5" style={{ color: bidStr.color }}>{bidStr.pct}% Acceptance Probability</p>
                  <p className="text-xs" style={{ color: bidStr.color }}>{bidStr.tip}</p>
                </div>
              )}

              <div className="lux-glass lux-border rounded-3xl p-6 space-y-4">
                <p className="text-[0.65rem] font-bold text-white/50 uppercase tracking-[0.18em]">Booking Summary</p>
                <div className="divider-gold" />

                {/* Trip */}
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: "Destination",  value: `${CITY_DATA[form.city]?.emoji} ${form.city}` },
                    { label: "Duration",     value: `${nights} nights` },
                    { label: "Check-in",     value: form.checkIn ? new Date(form.checkIn).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—" },
                    { label: "Check-out",    value: form.checkOut ? new Date(form.checkOut).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—" },
                    { label: "Guests",       value: `${form.adults} adults${form.children > 0 ? ` + ${form.children} children` : ""}` },
                    { label: "Rooms",        value: `${form.rooms} room${form.rooms > 1 ? "s" : ""}` },
                  ].map(({ label, value }) => (
                    <div key={label}>
                      <p className="text-[0.58rem] text-white/40 uppercase tracking-wider mb-0.5">{label}</p>
                      <p className="text-sm font-semibold text-white/90">{value}</p>
                    </div>
                  ))}
                </div>

                <div className="divider-gold" />

                {/* Room prefs */}
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: "Room Type",    value: ROOM_TYPES.find(r => r.id === form.roomType)?.label || form.roomType },
                    { label: "Bed",          value: BED_TYPES.find(b => b.id === form.bedType)?.label || form.bedType },
                    { label: "View",         value: form.view },
                    { label: "Meal Plan",    value: MEAL_PLANS.find(m => m.id === form.mealPlan)?.label || form.mealPlan },
                    ...(form.occasion !== "none" ? [{ label: "Occasion", value: OCCASIONS.find(o => o.id === form.occasion)?.label || form.occasion }] : []),
                  ].map(({ label, value }) => (
                    <div key={label}>
                      <p className="text-[0.58rem] text-white/40 uppercase tracking-wider mb-0.5">{label}</p>
                      <p className="text-sm font-semibold text-white/90">{value}</p>
                    </div>
                  ))}
                </div>

                {/* Add-ons */}
                {(form.earlyCheckIn || form.lateCheckOut || form.airportTransfer || form.petFriendly || form.smokingRoom) && (
                  <>
                    <div className="divider-gold" />
                    <div>
                      <p className="text-[0.58rem] text-white/40 uppercase tracking-wider mb-2">Add-ons Requested</p>
                      <div className="flex flex-wrap gap-1.5">
                        {form.earlyCheckIn    && <span className="text-xs bg-gold-50 border border-gold-200 text-gold-700 px-2 py-0.5 rounded-full">🌅 Early check-in</span>}
                        {form.lateCheckOut    && <span className="text-xs bg-gold-50 border border-gold-200 text-gold-700 px-2 py-0.5 rounded-full">🌇 Late check-out</span>}
                        {form.airportTransfer && <span className="text-xs bg-gold-50 border border-gold-200 text-gold-700 px-2 py-0.5 rounded-full">🚗 Airport transfer</span>}
                        {form.petFriendly     && <span className="text-xs bg-gold-50 border border-gold-200 text-gold-700 px-2 py-0.5 rounded-full">🐾 Pet-friendly</span>}
                        {form.smokingRoom     && <span className="text-xs bg-gold-50 border border-gold-200 text-gold-700 px-2 py-0.5 rounded-full">🚬 Smoking room</span>}
                      </div>
                    </div>
                  </>
                )}

                {form.specialRequests && (
                  <>
                    <div className="divider-gold" />
                    <div>
                      <p className="text-[0.58rem] text-white/40 uppercase tracking-wider mb-1">Special Requests</p>
                      <p className="text-xs text-white/70">{form.specialRequests}</p>
                    </div>
                  </>
                )}

                <div className="divider-gold" />

                {/* Budget */}
                <div className="flex items-center justify-between bg-white/5 rounded-2xl p-4">
                  <div>
                    <p className="text-[0.6rem] text-white/50 uppercase tracking-wider mb-0.5">Your Max Budget</p>
                    <p className="text-2xl font-bold text-white">₹{parseInt(form.maxBudget).toLocaleString("en-IN")}</p>
                    <p className="text-[0.6rem] text-white/50">per room / night</p>
                  </div>
                  {totalEst > 0 && (
                    <div className="text-right">
                      <p className="text-[0.6rem] text-white/50 uppercase tracking-wider mb-0.5">Est. Total</p>
                      <p className="text-xl font-bold text-gold-600">₹{Math.round(totalEst * 1.12).toLocaleString("en-IN")}</p>
                      <p className="text-[0.6rem] text-white/50">incl. taxes</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Submit */}
              <button onClick={submit} disabled={loading}
                className="btn-3d btn-3d-gold btn-3d-lg w-full">
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Launching Bid…
                  </span>
                ) : (
                  "🚀 Launch Bid Request"
                )}
              </button>

              <p className="text-center text-xs text-white/40 tracking-wide">
                Hotels respond within 2–4 hours · No payment required now
              </p>
            </div>
          )}
        </div>

        {/* Navigation */}
        <div className="flex items-center gap-3 mt-8">
          {step > 1 && (
            <button onClick={() => goStep(step - 1)}
              className="btn-3d btn-3d-dark flex-1 text-sm">
              ← Back
            </button>
          )}
          {step < 4 && (
            <button onClick={() => canNext() && goStep(step + 1)} disabled={!canNext()}
              className="btn-3d btn-3d-gold flex-1 text-sm">
              Continue →
            </button>
          )}
        </div>

        <p className="text-center text-xs text-white/40 mt-4 tracking-wide">
          Step {step} of {STEPS.length} · {STEPS[step - 1]}
        </p>
      </div>
    </div>
  );
}
