"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { getHotelArea } from "@/lib/areas";

const CITIES = ["Mussoorie", "Dhanaulti", "Rishikesh", "Shimla", "Manali", "Dehradun"];

function useCounter(target: number, duration = 1500) {
  const [val, setVal] = useState(0);
  const started = useRef(false);
  useEffect(() => {
    if (started.current || target === 0) return;
    started.current = true;
    const steps = 40;
    const inc = target / steps;
    let cur = 0;
    const t = setInterval(() => {
      cur += inc;
      if (cur >= target) { setVal(target); clearInterval(t); }
      else setVal(Math.floor(cur));
    }, duration / steps);
    return () => clearInterval(t);
  }, [target, duration]);
  return val;
}

export default function Home() {
  const router = useRouter();
  const [selectedCity, setSelectedCity] = useState("");
  const [searchInput, setSearchInput]   = useState("");
  const [deals, setDeals]               = useState<any[]>([]);
  const [hotels, setHotels]             = useState<any[]>([]);
  const [hotelCount, setHotelCount]     = useState(0);
  const [now, setNow]                   = useState(Date.now());
  const [activeIdx, setActiveIdx]       = useState(0);

  const hotelCounter  = useCounter(hotelCount || 200);
  const cityCounter   = useCounter(15);
  const savingCounter = useCounter(35);

  // Read city from navbar location (stored in localStorage + custom event)
  useEffect(() => {
    const apply = () => {
      try { const c = localStorage.getItem("sb_city") || ""; setSelectedCity(c); } catch {}
    };
    apply();
    window.addEventListener("sb:city-change", apply);
    return () => window.removeEventListener("sb:city-change", apply);
  }, []);

  useEffect(() => {
    api.getFlashDeals(selectedCity || undefined)
      .then((d) => setDeals((d.deals || []).slice(0, 8))).catch(() => {});
    api.getHotels(selectedCity ? { city: selectedCity } : {})
      .then((d) => { setHotels(d.hotels?.slice(0, 4) || []); setHotelCount(d.total || 200); })
      .catch(() => {});
  }, [selectedCity]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const t = setInterval(() => {
      api.getFlashDeals(selectedCity || undefined)
        .then((d) => setDeals((d.deals || []).slice(0, 8))).catch(() => {});
    }, 30000);
    return () => clearInterval(t);
  }, [selectedCity]);

  // ═══ 3D COVERFLOW AUTO-ADVANCE ═══
  const pauseRef = useRef(false);
  useEffect(() => {
    if (deals.length === 0) return;
    const t = setInterval(() => {
      if (!pauseRef.current) setActiveIdx((i) => (i + 1) % deals.length);
    }, 4000);
    return () => clearInterval(t);
  }, [deals.length]);

  const goNext = useCallback(() => { if (deals.length) setActiveIdx((i) => (i + 1) % deals.length); }, [deals.length]);
  const goPrev = useCallback(() => { if (deals.length) setActiveIdx((i) => (i - 1 + deals.length) % deals.length); }, [deals.length]);

  // Touch swipe
  const touchStart = useRef<number | null>(null);
  const onTouchStart = (e: React.TouchEvent) => { touchStart.current = e.touches[0].clientX; pauseRef.current = true; };
  const onTouchEnd   = (e: React.TouchEvent) => {
    if (touchStart.current == null) return;
    const dx = e.changedTouches[0].clientX - touchStart.current;
    if (dx > 40) goPrev();
    else if (dx < -40) goNext();
    touchStart.current = null;
    setTimeout(() => { pauseRef.current = false; }, 2500);
  };

  return (
    <div className="lux-bg overflow-x-hidden">

      {/* ═══ FLASH DEALS — 3D COVERFLOW (ABOVE HERO) ═══ */}
      <section className="relative pt-6 pb-10 md:pt-10 md:pb-16">
        <div className="max-w-7xl mx-auto px-5 flex items-end justify-between mb-5">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
              <span className="text-red-400 text-[0.62rem] font-bold tracking-[0.22em] uppercase">Live Now</span>
              {selectedCity && <span className="text-gold-400 text-[0.62rem] font-bold tracking-widest">· {selectedCity}</span>}
            </div>
            <h2 className="font-display font-light text-white" style={{ fontSize:"clamp(1.4rem,2.8vw,2rem)" }}>
              <span className="lux-gold-text font-semibold">⚡ Flash Deals</span> — Tap or Swipe
            </h2>
          </div>
          <Link href={`/flash-deals${selectedCity?`?city=${selectedCity}`:""}`}
            className="text-xs font-semibold text-gold-400 hover:text-gold-300 border border-gold-500/30 px-3 py-1.5 rounded-lg hover:border-gold-400/60 transition-all shrink-0">
            View All →
          </Link>
        </div>

        {/* Coverflow stage */}
        <div
          className="relative mx-auto"
          style={{ perspective: "1400px", height: "clamp(320px, 42vw, 420px)" }}
          onMouseEnter={() => { pauseRef.current = true; }}
          onMouseLeave={() => { pauseRef.current = false; }}
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
        >
          {deals.length === 0 ? (
            <div className="flex items-center justify-center h-full">
              <div className="lux-glass lux-border rounded-3xl w-72 h-64 animate-pulse" />
            </div>
          ) : (
            <div className="absolute inset-0 flex items-center justify-center" style={{ transformStyle: "preserve-3d" }}>
              {deals.map((d: any, idx: number) => {
                // shortest signed distance on the circular ring
                const len = deals.length;
                let diff = idx - activeIdx;
                if (diff > len / 2) diff -= len;
                if (diff < -len / 2) diff += len;

                const abs = Math.abs(diff);
                if (abs > 3) return null; // hide far slides

                const isCenter = diff === 0;
                const translateX = diff * 58;         // percent
                const rotateY    = -diff * 22;        // deg
                const translateZ = isCenter ? 0 : -140 - abs * 40;
                const scale      = isCenter ? 1 : Math.max(0.62, 1 - abs * 0.14);
                const opacity    = abs >= 3 ? 0 : abs === 2 ? 0.35 : abs === 1 ? 0.75 : 1;
                const zIndex     = 20 - abs;

                const midnight = new Date(); midnight.setHours(23, 59, 59, 999);
                const diffMs  = Math.max(0, midnight.getTime() - now);
                const hrs  = Math.floor(diffMs / 3600000);
                const mins = Math.floor((diffMs % 3600000) / 60000);
                const secs = Math.floor((diffMs % 60000) / 1000);
                const isUrgent = hrs < 2;
                const totalSlots  = d.maxBookings  || 10;
                const bookedSlots = d.bookingCount || 0;
                const leftSlots   = Math.max(0, totalSlots - bookedSlots);
                const dealUrl  = `/hotels/${d.hotelId}?dealId=${d.id}&dealPrice=${d.aiPrice}&roomId=${d.roomId}&discount=${d.discount}&directBook=true`;
                const img = d.hotel?.images?.[0] || d.room?.images?.[0];

                return (
                  <div
                    key={d.id}
                    onClick={() => { if (!isCenter) setActiveIdx(idx); else router.push(dealUrl); }}
                    className="absolute cursor-pointer select-none"
                    style={{
                      width: "min(72vw, 320px)",
                      transform: `translate3d(${translateX}%, 0, ${translateZ}px) rotateY(${rotateY}deg) scale(${scale})`,
                      transition: "transform 0.7s cubic-bezier(0.25, 1, 0.3, 1), opacity 0.5s ease",
                      opacity,
                      zIndex,
                      transformStyle: "preserve-3d",
                    }}
                  >
                    <div className={`lux-glass lux-border rounded-3xl overflow-hidden ${isCenter ? "lux-pulse shadow-2xl" : ""}`}
                         style={{ boxShadow: isCenter ? "0 30px 80px -10px rgba(240,180,41,0.35), 0 0 0 1px rgba(240,180,41,0.2)" : "0 20px 50px -15px rgba(0,0,0,0.6)" }}>
                      <div className="relative h-48 overflow-hidden">
                        {img ? (
                          <img src={img} alt={d.hotel?.name} className="w-full h-full object-cover" draggable={false} />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center" style={{ background: "linear-gradient(135deg,#1a1530,#0d1a2e)" }}>
                            <span className="text-5xl opacity-20">🏨</span>
                          </div>
                        )}
                        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
                        <div className="absolute top-3 left-3 flex items-center gap-1 bg-black/70 backdrop-blur-sm border border-red-500/40 px-2 py-0.5 rounded-full">
                          <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse shrink-0" />
                          <span className="text-[0.6rem] font-bold text-red-400 uppercase">Today · {(() => { const a = getHotelArea(d.city, d.hotel?.lat, d.hotel?.lng); return a ? `${a}, ${d.city}` : d.city; })()}</span>
                        </div>
                        <span className="absolute top-3 right-3 badge-gold">{d.discount}% OFF</span>
                        <div className={`absolute bottom-3 left-3 flex items-center gap-1 ${isUrgent ? "text-red-400" : "text-white/80"}`}>
                          {isUrgent && <span className="w-1 h-1 bg-red-500 rounded-full animate-pulse" />}
                          <span className="text-[0.65rem] font-mono font-semibold bg-black/60 backdrop-blur-sm px-2 py-0.5 rounded">
                            {String(hrs).padStart(2,"0")}:{String(mins).padStart(2,"0")}:{String(secs).padStart(2,"0")}
                          </span>
                        </div>
                      </div>
                      <div className="p-4">
                        <h3 className="font-semibold text-white text-sm leading-snug mb-0.5 line-clamp-1">{d.hotel?.name || "Hotel"}</h3>
                        <p className="text-white/40 text-[0.65rem] mb-2">{d.room?.type || "Room"}</p>
                        <div className="mb-2">
                          <div className="flex items-center justify-between mb-1">
                            <span className={`text-[0.6rem] font-semibold ${leftSlots <= 2 ? "text-red-400" : leftSlots <= 5 ? "text-amber-400" : "text-white/50"}`}>
                              {bookedSlots}/{totalSlots} booked · <span className={leftSlots <= 2 ? "text-red-400 font-bold" : "text-gold-400 font-bold"}>{leftSlots} left</span>
                            </span>
                          </div>
                          <div className="h-0.5 bg-white/10 rounded-full overflow-hidden">
                            <div className={`h-full rounded-full transition-all duration-700 ${leftSlots <= 2 ? "bg-red-500" : "bg-gradient-to-r from-gold-500 to-gold-300"}`}
                              style={{ width: `${Math.min(100, (bookedSlots / totalSlots) * 100)}%` }} />
                          </div>
                        </div>
                        <div className="flex items-end justify-between">
                          <div>
                            <p className="text-white/30 text-[0.6rem] line-through">₹{d.floorPrice}</p>
                            <p className="text-white font-bold text-lg">₹{d.aiPrice}<span className="text-white/40 text-[0.6rem] font-normal">/night</span></p>
                          </div>
                          <span className="lux-btn px-3 py-1.5 rounded-lg text-[0.7rem] font-bold">Book</span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Nav arrows */}
          {deals.length > 1 && (
            <>
              <button onClick={goPrev}
                className="absolute left-2 md:left-8 top-1/2 -translate-y-1/2 z-30 w-10 h-10 rounded-full lux-glass lux-border flex items-center justify-center text-white hover:text-gold-400 transition-colors">
                ‹
              </button>
              <button onClick={goNext}
                className="absolute right-2 md:right-8 top-1/2 -translate-y-1/2 z-30 w-10 h-10 rounded-full lux-glass lux-border flex items-center justify-center text-white hover:text-gold-400 transition-colors">
                ›
              </button>
            </>
          )}
        </div>

        {/* Dots */}
        {deals.length > 1 && (
          <div className="flex items-center justify-center gap-1.5 mt-5">
            {deals.map((_, i) => (
              <button key={i} onClick={() => setActiveIdx(i)}
                className={`h-1.5 rounded-full transition-all duration-300 ${i === activeIdx ? "w-8 bg-gold-400" : "w-1.5 bg-white/30 hover:bg-white/50"}`} />
            ))}
          </div>
        )}
      </section>

      {/* ═══ HERO — Name Your Price ═══ */}
      <section className="relative overflow-hidden border-t border-white/5">
        <div className="absolute -top-40 -right-40 w-[600px] h-[600px] rounded-full pointer-events-none"
          style={{ background: "radial-gradient(circle, rgba(240,180,41,0.08) 0%, transparent 70%)" }} />
        <div className="absolute -bottom-60 -left-32 w-[500px] h-[500px] rounded-full pointer-events-none"
          style={{ background: "radial-gradient(circle, rgba(201,145,26,0.06) 0%, transparent 70%)" }} />

        <div className="relative max-w-7xl mx-auto px-5 pt-14 pb-10 w-full">
          <div className="flex items-center gap-3 mb-5">
            <div className="h-px w-8 bg-gradient-to-r from-transparent to-gold-500 opacity-70" />
            <span className="text-gold-400 text-[0.65rem] font-semibold tracking-[0.22em] uppercase">India&apos;s First Reverse-Auction Hotel Platform</span>
            <div className="h-px w-8 bg-gradient-to-l from-transparent to-gold-500 opacity-70" />
          </div>
          <h1 className="font-display font-light text-white leading-[1.06] mb-5"
              style={{ fontSize: "clamp(2.4rem, 6vw, 4.5rem)" }}>
            Name Your Price.<br />
            <span className="lux-gold-text font-semibold italic">Hotels Compete.</span>
          </h1>
          <p className="text-white/50 max-w-md mb-8 leading-relaxed font-light text-sm">
            Bid on premium mountain stays at prices you choose. Off-season deals you won&apos;t find anywhere else.
          </p>

          {/* ── Search Destination (compact, half width) ── */}
          <div className="lux-glass lux-border rounded-xl p-2.5 max-w-md">
            <div className="flex gap-1.5">
              <div className="flex-1 relative">
                <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none opacity-50 text-white"
                  fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
                </svg>
                <input value={searchInput} onChange={e => setSearchInput(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && router.push(`/hotels${searchInput ? `?city=${encodeURIComponent(searchInput)}` : selectedCity ? `?city=${encodeURIComponent(selectedCity)}` : ""}`)}
                  placeholder={selectedCity ? `Search in ${selectedCity}…` : "Search destination…"}
                  className="w-full pl-8 pr-2 py-2 rounded-lg text-white bg-white/10 placeholder:text-white/40 focus:outline-none focus:ring-1 focus:ring-gold-400/50 border border-white/10 text-xs backdrop-blur-sm transition-all" />
              </div>
              <Link href={`/hotels${searchInput ? `?city=${encodeURIComponent(searchInput)}` : selectedCity ? `?city=${encodeURIComponent(selectedCity)}` : ""}`}
                className="lux-btn px-4 py-2 rounded-lg text-xs whitespace-nowrap">
                Search
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ═══ HOTELS IN SELECTED LOCATION ═══ */}
      <section className="py-14" style={{ background: "linear-gradient(180deg,#0a0812 0%,#13101f 50%,#f4f2ec 100%)" }}>
        <div className="max-w-7xl mx-auto px-5">
          <div className="flex items-end justify-between mb-7">
            <div>
              <p className="text-gold-400 text-[0.65rem] font-semibold tracking-[0.22em] uppercase mb-1">
                {selectedCity ? `Hotels in ${selectedCity}` : "Featured Hotels"}
              </p>
              <h2 className="font-display font-light text-white" style={{ fontSize: "clamp(1.6rem,3vw,2.2rem)" }}>
                {selectedCity ? `Stay in ${selectedCity}` : "Top Stays Right Now"}
              </h2>
            </div>
            <Link href={`/hotels${selectedCity ? `?city=${selectedCity}` : ""}`}
              className="text-sm font-medium text-gold-400 hover:text-gold-300 flex items-center gap-1 transition-colors">
              View All →
            </Link>
          </div>

          {hotels.length === 0 ? (
            <div className="grid md:grid-cols-4 gap-5">
              {[1,2,3,4].map(i => <div key={i} className="h-48 shimmer rounded-3xl" />)}
            </div>
          ) : (
            <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-5">
              {hotels.map((h: any) => (
                <Link key={h.id} href={`/hotels/${h.id}`}
                  className="group lux-glass lux-border rounded-3xl overflow-hidden hover:-translate-y-1 transition-all duration-300 block">
                  <div className="relative h-40 overflow-hidden bg-white/5">
                    {h.images?.[0] ? (
                      <img src={h.images[0]} alt={h.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center"><span className="text-4xl opacity-15">🏨</span></div>
                    )}
                    {h.trustBadge && (
                      <span className="absolute top-2 left-2 badge-gold">✓ Verified</span>
                    )}
                  </div>
                  <div className="p-4">
                    <h3 className="font-semibold text-white text-sm leading-snug mb-0.5 group-hover:text-gold-300 transition-colors line-clamp-1">{h.name}</h3>
                    <p className="text-white/40 text-xs mb-2">📍 {(() => { const a = getHotelArea(h.city, h.lat, h.lng); return a ? `${a}, ${h.city}` : h.city; })()}</p>
                    {h.avgRating > 0 && (
                      <div className="flex items-center gap-1 mb-2">
                        <span className="text-gold-400 text-xs">★</span>
                        <span className="text-xs font-semibold text-white/80">{h.avgRating.toFixed(1)}</span>
                      </div>
                    )}
                    <p className="text-xs text-white/50">From <span className="font-bold text-white">₹{h.rooms?.[0]?.floorPrice || "—"}</span>/night</p>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ═══ HI-TECH ANIMATED STATS ═══ */}
      <HiTechStats hotelCounter={hotelCounter} cityCounter={cityCounter} savingCounter={savingCounter} />

      {/* ═══ HINDI NARRATED FEATURE EXPLAINERS ═══ */}
      <FeatureExplainers />

      {/* ═══ FOOTER — All nav links live here ═══ */}
      <footer className="lux-bg border-t border-gold-500/20 pt-12 pb-8">
        <div className="max-w-7xl mx-auto px-5">
          <div className="grid md:grid-cols-4 gap-8 mb-10">
            <div>
              <Link href="/" className="flex items-center gap-2.5 select-none mb-3">
                <div className="w-9 h-9 rounded-lg lux-btn flex items-center justify-center text-white font-bold text-sm">S</div>
                <span className="font-display text-xl text-white tracking-wide">StayBid</span>
              </Link>
              <p className="text-white/50 text-xs leading-relaxed">India&apos;s first reverse-auction hotel platform. Naam apni price, hotels karenge compete.</p>
            </div>

            <div>
              <p className="text-[0.65rem] font-bold text-gold-400 tracking-widest uppercase mb-3">Explore</p>
              <ul className="space-y-2">
                {[{ href: "/", label: "🏠 Home" }, { href: "/hotels", label: "🏨 Hotels" }, { href: "/flash-deals", label: "⚡ Flash Deals" }, { href: "/bid", label: "🎯 Place Bid" }].map(l => (
                  <li key={l.href}><Link href={l.href} className="text-sm text-white/60 hover:text-gold-300 transition-colors">{l.label}</Link></li>
                ))}
              </ul>
            </div>

            <div>
              <p className="text-[0.65rem] font-bold text-gold-400 tracking-widest uppercase mb-3">Your Account</p>
              <ul className="space-y-2">
                {[{ href: "/my-bids", label: "📋 My Bids" }, { href: "/bookings", label: "🎫 Bookings" }, { href: "/wallet", label: "💰 Wallet" }, { href: "/hotel-partner", label: "🏢 Partner" }, { href: "/profile", label: "👤 Profile" }].map(l => (
                  <li key={l.href}><Link href={l.href} className="text-sm text-white/60 hover:text-gold-300 transition-colors">{l.label}</Link></li>
                ))}
              </ul>
            </div>

            <div>
              <p className="text-[0.65rem] font-bold text-gold-400 tracking-widest uppercase mb-3">Trust & Support</p>
              <ul className="space-y-2 text-sm text-white/60">
                <li>🔒 Secure Razorpay Payments</li>
                <li>✅ Verified Hotels Only</li>
                <li>💬 24×7 Support</li>
                <li>🏔️ Curated Hill Stays</li>
              </ul>
            </div>
          </div>

          <div className="pt-6 border-t border-white/10 flex flex-col md:flex-row items-center justify-between gap-3">
            <p className="text-xs text-white/40">© 2026 StayBid. Crafted with care in India.</p>
            <p className="text-[0.65rem] text-gold-400/70 tracking-widest uppercase font-semibold">Luxury · Reverse Auction · India</p>
          </div>
        </div>
      </footer>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   HI-TECH ANIMATED STATS
   ═══════════════════════════════════════════════════════════════════ */
function HiTechStats({ hotelCounter, cityCounter, savingCounter }: { hotelCounter: number; cityCounter: number; savingCounter: number }) {
  return (
    <section className="relative py-16 overflow-hidden" style={{ background: "linear-gradient(180deg,#0a0812 0%,#0f0d1e 50%,#0a0812 100%)" }}>
      <style>{`
        @keyframes gridMove { 0% { background-position: 0 0; } 100% { background-position: 40px 40px; } }
        @keyframes ringSpin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
        @keyframes numberGlow { 0%,100% { text-shadow: 0 0 20px rgba(240,180,41,0.4), 0 0 40px rgba(240,180,41,0.2); } 50% { text-shadow: 0 0 30px rgba(240,180,41,0.7), 0 0 60px rgba(240,180,41,0.35); } }
        .hitech-grid { background-image: linear-gradient(rgba(240,180,41,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(240,180,41,0.08) 1px, transparent 1px); background-size: 40px 40px; animation: gridMove 20s linear infinite; }
        .hitech-ring { animation: ringSpin 12s linear infinite; }
        .hitech-number { animation: numberGlow 3s ease-in-out infinite; }
      `}</style>
      <div className="absolute inset-0 hitech-grid opacity-30" />
      <div className="relative max-w-5xl mx-auto px-5">
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-gold-500/40 bg-gold-500/10 mb-3">
            <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" />
            <span className="text-[0.6rem] font-bold text-gold-300 tracking-[0.22em] uppercase">Live Data · Real-Time</span>
          </div>
          <h2 className="font-display font-light text-white" style={{ fontSize: "clamp(1.6rem,3vw,2.2rem)" }}>
            StayBid <span className="lux-gold-text font-semibold">by the Numbers</span>
          </h2>
        </div>

        <div className="grid grid-cols-3 gap-4 md:gap-6">
          {[
            { value: hotelCounter,  suffix: "+", label: "Hotels Listed",  sub: "Verified properties", icon: "🏨" },
            { value: cityCounter,   suffix: "+", label: "Cities Covered", sub: "Hill stations",       icon: "🗺️" },
            { value: savingCounter, suffix: "%", label: "Avg. Savings",   sub: "vs. other OTAs",      icon: "💰" },
          ].map(s => (
            <div key={s.label} className="relative lux-glass lux-border rounded-2xl p-4 md:p-6 text-center overflow-hidden group">
              <div className="absolute top-2 right-2 w-8 h-8 md:w-10 md:h-10 rounded-full border border-gold-400/30 hitech-ring" style={{ borderTopColor: "transparent", borderRightColor: "transparent" }} />
              <div className="relative">
                <div className="text-2xl md:text-3xl mb-2 md:mb-3">{s.icon}</div>
                <p className="font-display font-bold lux-gold-text hitech-number tabular-nums leading-none" style={{ fontSize: "clamp(1.8rem, 5vw, 3rem)" }}>
                  {s.value}{s.suffix}
                </p>
                <p className="text-xs md:text-sm font-bold text-white/90 mt-2 mb-0.5">{s.label}</p>
                <p className="text-[0.6rem] md:text-xs text-white/40">{s.sub}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   HINDI NARRATED FEATURE EXPLAINERS (with speech + animations)
   ═══════════════════════════════════════════════════════════════════ */
type Feature = {
  id: string;
  icon: string;
  title: string;
  hiTitle: string;
  color: string;
  steps: { emoji: string; hi: string; en: string }[];
  cta: { href: string; label: string };
};

const FEATURES: Feature[] = [
  {
    id: "flash",
    icon: "⚡",
    title: "Flash Deals",
    hiTitle: "फ्लैश डील्स",
    color: "#ef4444",
    cta: { href: "/flash-deals", label: "Browse Flash Deals →" },
    steps: [
      { emoji: "⚡", hi: "फ्लैश डील्स सिर्फ आज के लिए होती हैं — बहुत कम दाम पर।",             en: "Flash Deals are same-day only — at massively reduced prices." },
      { emoji: "⏰", hi: "हर डील की टाइमर होती है। रात बारह बजे सब डील्स ख़त्म हो जाती हैं।",   en: "Every deal has a live timer and expires at midnight." },
      { emoji: "🎯", hi: "डील पर क्लिक करें, तारीख़ चुनें, और तुरंत बुक कर लें।",                 en: "Click a deal, pick your dates, and book instantly." },
      { emoji: "💳", hi: "रज़रपे से सुरक्षित पेमेंट करें — बुकिंग तुरंत कन्फर्म हो जाती है।",        en: "Pay securely via Razorpay — your booking confirms in seconds." },
    ],
  },
  {
    id: "hotels",
    icon: "🏨",
    title: "Hotels",
    hiTitle: "होटल्स",
    color: "#c9911a",
    cta: { href: "/hotels", label: "Explore Hotels →" },
    steps: [
      { emoji: "🔍", hi: "होटल्स पेज पर शहर या नाम से सर्च करें।",                                     en: "On the Hotels page, search by city or hotel name." },
      { emoji: "🖼️", hi: "फोटो गैलरी देखें, कमरे के टाइप, एमिनिटीज़ और रिव्यूज़ पढ़ें।",             en: "Browse the photo gallery, rooms, amenities and guest reviews." },
      { emoji: "📅", hi: "चेक-इन, चेक-आउट और गेस्ट्स की संख्या चुनें।",                               en: "Pick check-in, check-out and number of guests." },
      { emoji: "⚖️", hi: "हम दूसरे ओटीए पोर्टल से प्राइस कम्पेयर दिखाते हैं — StayBid हमेशा सस्ता।",      en: "We compare prices with other OTAs — StayBid is always cheaper." },
      { emoji: "✅", hi: "बुक नाउ दबाएँ, पेमेंट करें, और बुकिंग तुरंत कन्फर्म।",                           en: "Hit Book Now, pay, and get instant confirmation." },
    ],
  },
  {
    id: "bid",
    icon: "🎯",
    title: "Place Bid",
    hiTitle: "अपना दाम ख़ुद तय करें",
    color: "#f0b429",
    cta: { href: "/bid", label: "Place Your Bid →" },
    steps: [
      { emoji: "💭", hi: "आप ख़ुद अपना बजट बताएं — जितना देना चाहते हैं उतना।",                        en: "You decide your own budget — bid whatever you can pay." },
      { emoji: "📤", hi: "अपनी बिड सबमिट करें। होटल्स को नोटिफ़िकेशन मिलती है।",                          en: "Submit your bid. Hotels get notified instantly." },
      { emoji: "🤝", hi: "होटल्स आपस में कम्पीट करते हैं — accept, counter या reject करते हैं।",         en: "Hotels compete — they accept, counter-offer or reject." },
      { emoji: "🔔", hi: "My Bids सेक्शन में रीयल-टाइम में अपडेट्स मिलते हैं।",                           en: "Check My Bids for live updates on your offer." },
      { emoji: "💸", hi: "अच्छी ऑफ़र accept करें, पेमेंट करें — चालीस परसेंट तक बचत।",                   en: "Accept the best counter, pay, and save up to 40%." },
    ],
  },
];

function FeatureExplainers() {
  const [active, setActive] = useState(0);
  const [step, setStep]     = useState(-1);
  const [playing, setPlaying] = useState(false);
  const feat = FEATURES[active];
  const timeoutsRef = useRef<number[]>([]);

  const stopAll = useCallback(() => {
    timeoutsRef.current.forEach((t) => clearTimeout(t));
    timeoutsRef.current = [];
    if (typeof window !== "undefined" && window.speechSynthesis) window.speechSynthesis.cancel();
    setPlaying(false);
  }, []);

  useEffect(() => () => stopAll(), [stopAll]);
  useEffect(() => { stopAll(); setStep(-1); }, [active, stopAll]);

  const playStep = (i: number) => {
    if (typeof window === "undefined" || !window.speechSynthesis) return 3500;
    const u = new SpeechSynthesisUtterance(feat.steps[i].hi);
    u.lang = "hi-IN";
    u.rate = 0.95;
    u.pitch = 1.0;
    const voices = window.speechSynthesis.getVoices();
    const hi = voices.find(v => v.lang?.toLowerCase().startsWith("hi"));
    if (hi) u.voice = hi;
    window.speechSynthesis.speak(u);
    // estimate duration based on chars (~70ms per char, min 3s)
    return Math.max(3000, feat.steps[i].hi.length * 80);
  };

  const play = () => {
    stopAll();
    setPlaying(true);
    // warm up voices list
    if (typeof window !== "undefined" && window.speechSynthesis) window.speechSynthesis.getVoices();
    let cumulative = 300;
    feat.steps.forEach((_, i) => {
      const t = window.setTimeout(() => {
        setStep(i);
        const dur = playStep(i);
        if (i === feat.steps.length - 1) {
          const end = window.setTimeout(() => { setPlaying(false); }, dur + 400);
          timeoutsRef.current.push(end);
        }
      }, cumulative);
      timeoutsRef.current.push(t);
      // advance schedule by estimated duration
      cumulative += Math.max(3000, feat.steps[i].hi.length * 80) + 300;
    });
  };

  return (
    <section className="relative py-16 md:py-20 overflow-hidden" style={{ background: "linear-gradient(180deg,#0a0812 0%,#0e0a1c 100%)" }}>
      <style>{`
        @keyframes stepIn { from { opacity: 0; transform: translateX(-20px); } to { opacity: 1; transform: translateX(0); } }
        .step-in { animation: stepIn 0.4s cubic-bezier(0.3,1,0.3,1) both; }
        @keyframes speakWave { 0%,100% { transform: scaleY(0.5); } 50% { transform: scaleY(1); } }
        .wave-bar { animation: speakWave 0.6s ease-in-out infinite; transform-origin: bottom; }
      `}</style>

      <div className="max-w-5xl mx-auto px-5">
        <div className="text-center mb-8">
          <p className="text-gold-400 text-[0.65rem] font-bold tracking-[0.22em] uppercase mb-2">Complete Walkthrough · Hindi Voice</p>
          <h2 className="font-display font-light text-white" style={{ fontSize: "clamp(1.7rem,3.5vw,2.4rem)" }}>
            StayBid <span className="lux-gold-text font-semibold">कैसे काम करता है</span>
          </h2>
          <p className="text-white/50 text-xs md:text-sm mt-2">Play दबाएँ — हिंदी में पूरा समझाएँगे</p>
        </div>

        {/* Feature tabs */}
        <div className="flex items-center justify-center gap-2 md:gap-3 mb-6 flex-wrap">
          {FEATURES.map((f, i) => (
            <button key={f.id} onClick={() => setActive(i)}
              className={`nav3d-chip flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all ${active === i ? "nav3d-chip-active" : "text-white/60"}`}>
              <span className="text-lg">{f.icon}</span>
              <span>{f.title}</span>
            </button>
          ))}
        </div>

        {/* Player card */}
        <div className="lux-glass lux-border rounded-3xl p-5 md:p-8 relative overflow-hidden">
          <div className="absolute -top-20 -right-20 w-64 h-64 rounded-full pointer-events-none"
               style={{ background: `radial-gradient(circle, ${feat.color}22, transparent 70%)` }} />

          <div className="flex items-start justify-between gap-3 mb-5 relative">
            <div>
              <p className="text-[0.6rem] font-bold tracking-[0.22em] uppercase" style={{ color: feat.color }}>Feature {active + 1} of {FEATURES.length}</p>
              <h3 className="font-display text-white text-2xl md:text-3xl mt-1">
                {feat.icon} {feat.title} <span className="text-white/40 text-lg md:text-xl">· {feat.hiTitle}</span>
              </h3>
            </div>
            <button
              onClick={playing ? stopAll : play}
              className="lux-btn flex items-center gap-2 px-4 py-2.5 md:px-5 md:py-3 rounded-full text-xs md:text-sm whitespace-nowrap shrink-0">
              {playing ? (<><span>⏹</span><span>Stop</span></>) : (<><span>▶</span><span>Play in Hindi</span></>)}
            </button>
          </div>

          {/* Sound wave visualizer when playing */}
          {playing && (
            <div className="flex items-end justify-center gap-1 h-6 mb-4">
              {[0.1, 0.25, 0.4, 0.2, 0.35, 0.15].map((d, i) => (
                <span key={i} className="wave-bar w-1 rounded-full" style={{ height: "100%", background: feat.color, animationDelay: `${d}s` }} />
              ))}
            </div>
          )}

          {/* Steps */}
          <div className="space-y-2.5 relative">
            {feat.steps.map((s, i) => {
              const visible = step >= i || !playing;
              const isCurrent = step === i && playing;
              return (
                <div key={i}
                  className={`flex items-start gap-3 md:gap-4 p-3 md:p-4 rounded-2xl border transition-all duration-500 ${isCurrent ? "border-gold-400/70 bg-gold-500/10 scale-[1.02]" : "border-white/10 bg-white/[0.02]"} ${visible ? "step-in opacity-100" : "opacity-30"}`}
                  style={isCurrent ? { boxShadow: `0 0 24px ${feat.color}44` } : undefined}>
                  <div className="w-10 h-10 md:w-12 md:h-12 rounded-xl flex items-center justify-center text-xl md:text-2xl shrink-0"
                       style={{ background: `linear-gradient(135deg, ${feat.color}33, ${feat.color}11)`, border: `1px solid ${feat.color}55` }}>
                    {s.emoji}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-white font-semibold text-sm md:text-base leading-snug">{s.hi}</p>
                    <p className="text-white/40 text-[0.7rem] md:text-xs mt-1 leading-snug">{s.en}</p>
                  </div>
                  <div className="text-[0.65rem] font-bold tabular-nums shrink-0" style={{ color: feat.color }}>
                    {String(i + 1).padStart(2, "0")}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-6 flex items-center justify-between flex-wrap gap-3 relative">
            <p className="text-[0.65rem] text-white/40">🔊 Browser speech synthesis uses your device&apos;s Hindi voice.</p>
            <Link href={feat.cta.href} className="lux-btn px-5 py-2.5 rounded-full text-xs md:text-sm">{feat.cta.label}</Link>
          </div>
        </div>
      </div>
    </section>
  );
}
