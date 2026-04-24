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

          {/* ── Search Destination (below hero) ── */}
          <div className="lux-glass lux-border rounded-2xl p-4 max-w-2xl">
            <p className="text-[0.65rem] font-bold text-gold-400 tracking-widest uppercase mb-2">Search Destination</p>
            <div className="flex gap-2">
              <div className="flex-1 relative">
                <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none opacity-50 text-white"
                  fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
                </svg>
                <input value={searchInput} onChange={e => setSearchInput(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && router.push(`/hotels${searchInput ? `?city=${encodeURIComponent(searchInput)}` : selectedCity ? `?city=${encodeURIComponent(selectedCity)}` : ""}`)}
                  placeholder={selectedCity ? `Search in ${selectedCity}…` : "Search destination…"}
                  className="w-full pl-10 pr-4 py-3 rounded-xl text-white bg-white/10 placeholder:text-white/40 focus:outline-none focus:ring-1 focus:ring-gold-400/50 border border-white/10 text-sm backdrop-blur-sm transition-all" />
              </div>
              <Link href={`/hotels${searchInput ? `?city=${encodeURIComponent(searchInput)}` : selectedCity ? `?city=${encodeURIComponent(selectedCity)}` : ""}`}
                className="lux-btn px-6 py-3 rounded-xl text-sm whitespace-nowrap">
                Search
              </Link>
            </div>
            <div className="flex items-center gap-1 flex-wrap mt-3">
              {["All", ...CITIES].map(c => (
                <button key={c}
                  onClick={() => { setSelectedCity(c === "All" ? "" : c); try { localStorage.setItem("sb_city", c === "All" ? "" : c); window.dispatchEvent(new Event("sb:city-change")); } catch {} }}
                  className={`px-2.5 py-1 rounded-md text-[0.7rem] font-medium transition-all ${(c === "All" && !selectedCity) || c === selectedCity ? "bg-gold-500 text-white shadow-gold" : "text-white/50 hover:text-white/80 hover:bg-white/10"}`}>
                  {c}
                </button>
              ))}
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

      {/* ═══ STATS ═══ */}
      <section className="py-14 bg-white border-y border-luxury-100">
        <div className="max-w-4xl mx-auto px-5">
          <p className="text-center text-xs font-bold text-luxury-400 uppercase tracking-[0.22em] mb-10">StayBid by the Numbers</p>
          <div className="grid grid-cols-3 gap-6 text-center">
            {[
              { value: hotelCounter, suffix: "+", label: "Hotels Listed",    sub: "Verified properties across India", icon: "🏨" },
              { value: cityCounter,  suffix: "+", label: "Cities Covered",   sub: "Mountain & hill stations", icon: "🗺️" },
              { value: savingCounter,suffix: "%", label: "Average Savings",  sub: "vs. other OTA platforms", icon: "💰" },
            ].map(s => (
              <div key={s.label} className="group p-6 rounded-3xl border border-luxury-100 hover:border-gold-200 hover:shadow-luxury transition-all duration-300 hover:-translate-y-0.5">
                <div className="text-3xl mb-3">{s.icon}</div>
                <p className="font-display font-semibold text-luxury-900 mb-1" style={{ fontSize: "2.5rem" }}>
                  {s.value}{s.suffix}
                </p>
                <p className="text-sm font-semibold text-luxury-800 mb-1">{s.label}</p>
                <p className="text-xs text-luxury-400 leading-relaxed">{s.sub}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ HOW IT WORKS ═══ */}
      <section className="max-w-7xl mx-auto px-5 py-20 md:py-28 bg-white">
        <div className="text-center mb-14">
          <p className="text-gold-500 text-[0.68rem] font-semibold tracking-[0.22em] uppercase mb-3">Simple Process</p>
          <h2 className="font-display font-light text-luxury-900" style={{ fontSize: "clamp(1.8rem,4vw,2.6rem)" }}>How StayBid Works</h2>
          <div className="gold-line w-20 mx-auto mt-4" />
        </div>
        <div className="grid md:grid-cols-3 gap-6">
          {[
            { num: "01", title: "Search & Browse", desc: "Discover premium hotels in your destination. Review rooms, amenities, and verified guest ratings." },
            { num: "02", title: "Name Your Price", desc: "Submit a bid with your budget. Hotels see your offer and compete to win your booking." },
            { num: "03", title: "Book & Save", desc: "Accept the best counter-offer and confirm instantly. Save up to 40% off published rates." },
          ].map(s => (
            <div key={s.num} className="group relative p-7 rounded-3xl bg-white border border-luxury-100 hover:border-gold-200 hover:shadow-luxury-lg transition-all duration-300 overflow-hidden hover:-translate-y-1">
              <span className="absolute top-4 right-5 font-display text-7xl font-bold text-luxury-100 group-hover:text-gold-100 transition-colors leading-none select-none">{s.num}</span>
              <h3 className="font-semibold text-luxury-900 text-[1rem] mb-2 relative">{s.title}</h3>
              <p className="text-luxury-500 text-sm leading-relaxed relative">{s.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ═══ FOOTER ═══ */}
      <footer className="border-t border-luxury-200 py-10 bg-white">
        <div className="max-w-7xl mx-auto px-5 flex flex-col md:flex-row items-center justify-between gap-4">
          <Link href="/" className="flex items-center gap-2.5 select-none">
            <div className="w-8 h-8 rounded-lg lux-btn flex items-center justify-center text-white font-bold text-xs">S</div>
            <span className="font-display text-xl text-luxury-800 tracking-wide">StayBid</span>
          </Link>
          <p className="text-sm text-luxury-400">© 2026 StayBid. Crafted with care in India.</p>
          <div className="flex items-center gap-5 text-sm text-luxury-400">
            {[{ href: "/hotels", label: "Hotels" }, { href: "/flash-deals", label: "Deals" }, { href: "/bid", label: "Place Bid" }].map(l => (
              <Link key={l.href} href={l.href} className="hover:text-luxury-700 transition-colors">{l.label}</Link>
            ))}
          </div>
        </div>
      </footer>
    </div>
  );
}
