"use client";
import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";

const CITIES = ["Mussoorie", "Dhanaulti", "Rishikesh", "Shimla", "Manali", "Dehradun"];

// Animated counter hook
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
  const [locLoading, setLocLoading]     = useState(false);
  const [showCityPicker, setShowCityPicker] = useState(false);

  const hotelCounter  = useCounter(hotelCount || 200);
  const cityCounter   = useCounter(15);
  const savingCounter = useCounter(35);

  // Fetch deals + hotels when city changes
  useEffect(() => {
    api.getFlashDeals(selectedCity || undefined)
      .then((d) => setDeals(d.deals?.slice(0, 4) || [])).catch(() => {});
    api.getHotels(selectedCity ? { city: selectedCity } : {})
      .then((d) => { setHotels(d.hotels?.slice(0, 4) || []); setHotelCount(d.total || 200); })
      .catch(() => {});
  }, [selectedCity]);

  // Live countdown tick
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Auto-detect location
  const detectLocation = () => {
    if (!navigator.geolocation) return;
    setLocLoading(true);
    navigator.geolocation.getCurrentPosition(async (pos) => {
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/reverse?lat=${pos.coords.latitude}&lon=${pos.coords.longitude}&format=json`
        );
        const data = await res.json();
        const detected = data.address?.city || data.address?.town || data.address?.village || data.address?.state_district || "";
        const match = CITIES.find(c => detected.toLowerCase().includes(c.toLowerCase()));
        if (match) setSelectedCity(match);
        else setShowCityPicker(true);
      } catch { setShowCityPicker(true); }
      finally { setLocLoading(false); }
    }, () => { setLocLoading(false); setShowCityPicker(true); });
  };

  return (
    <div className="bg-luxury-50 overflow-x-hidden">

      {/* ═══ HERO ═══ */}
      <section className="relative overflow-hidden"
        style={{ background: "linear-gradient(135deg, #0a0812 0%, #130f24 45%, #0a1020 100%)" }}>

        {/* Ambient orbs */}
        <div className="absolute -top-40 -right-40 w-[600px] h-[600px] rounded-full pointer-events-none animate-pulse"
          style={{ background: "radial-gradient(circle, rgba(240,180,41,0.07) 0%, transparent 70%)", animationDuration:"4s" }} />
        <div className="absolute -bottom-60 -left-32 w-[500px] h-[500px] rounded-full pointer-events-none animate-pulse"
          style={{ background: "radial-gradient(circle, rgba(201,145,26,0.06) 0%, transparent 70%)", animationDuration:"6s" }} />

        {/* Floating dots */}
        <div className="absolute top-24 left-[15%] w-1 h-1 bg-gold-400 rounded-full opacity-40 animate-bounce" style={{ animationDuration:"3s" }} />
        <div className="absolute top-40 right-[20%] w-1.5 h-1.5 bg-gold-300 rounded-full opacity-30 animate-bounce" style={{ animationDuration:"4.5s", animationDelay:"1s" }} />

        <div className="relative max-w-7xl mx-auto px-5 pt-16 pb-20 w-full">

          {/* ── Location bar ── */}
          <div className="flex items-center gap-2 mb-6 flex-wrap">
            <button onClick={detectLocation} disabled={locLoading}
              className="flex items-center gap-1.5 bg-white/10 backdrop-blur-sm border border-white/15 hover:border-gold-400/50 px-3 py-1.5 rounded-lg text-xs text-white/80 transition-all disabled:opacity-50">
              {locLoading
                ? <span className="w-2.5 h-2.5 border border-gold-400 border-t-transparent rounded-full animate-spin" />
                : <span>🎯</span>}
              {locLoading ? "Detecting…" : selectedCity ? `📍 ${selectedCity}` : "Detect Location"}
            </button>
            <div className="flex items-center gap-1 flex-wrap">
              {["All",...CITIES].map(c => (
                <button key={c}
                  onClick={() => setSelectedCity(c === "All" ? "" : c)}
                  className={`px-2.5 py-1 rounded-md text-[0.7rem] font-medium transition-all ${(c==="All"&&!selectedCity)||c===selectedCity ? "bg-gold-500 text-white" : "text-white/50 hover:text-white/80 hover:bg-white/10"}`}>
                  {c}
                </button>
              ))}
            </div>
          </div>

          {/* Eyebrow */}
          <div className="flex items-center gap-3 mb-5">
            <div className="h-px w-8 bg-gradient-to-r from-transparent to-gold-500 opacity-70" />
            <span className="text-gold-400 text-[0.65rem] font-semibold tracking-[0.22em] uppercase">India&apos;s First Reverse-Auction Hotel Platform</span>
            <div className="h-px w-8 bg-gradient-to-l from-transparent to-gold-500 opacity-70" />
          </div>

          {/* Headline */}
          <h1 className="font-display font-light text-white leading-[1.06] mb-5"
              style={{ fontSize: "clamp(2.4rem, 6vw, 4.5rem)" }}>
            Name Your Price.<br />
            <span className="text-gold-gradient font-semibold italic">Hotels Compete.</span>
          </h1>

          <p className="text-white/50 max-w-md mb-8 leading-relaxed font-light text-sm">
            Bid on premium mountain stays at prices you choose. Off-season deals you won&apos;t find anywhere else.
          </p>

          {/* Search bar — compact */}
          <div className="flex gap-2 max-w-xl">
            <div className="flex-1 relative">
              <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none opacity-40"
                style={{ color:"#fff" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
              </svg>
              <input value={searchInput} onChange={e => setSearchInput(e.target.value)}
                onKeyDown={e => e.key==="Enter" && router.push(`/hotels${searchInput ? `?city=${encodeURIComponent(searchInput)}` : selectedCity ? `?city=${encodeURIComponent(selectedCity)}` : ""}`)}
                placeholder={selectedCity ? `Search in ${selectedCity}…` : "Search destination…"}
                className="w-full pl-10 pr-4 py-3 rounded-xl text-white bg-white/10 placeholder:text-white/35 focus:outline-none focus:ring-1 focus:ring-gold-400/50 border border-white/10 text-sm backdrop-blur-sm transition-all" />
            </div>
            <Link href={`/hotels${searchInput ? `?city=${encodeURIComponent(searchInput)}` : selectedCity ? `?city=${encodeURIComponent(selectedCity)}` : ""}`}
              className="btn-luxury px-6 py-3 rounded-xl text-sm whitespace-nowrap shadow-gold">
              Search
            </Link>
          </div>

        </div>

        {/* Bottom fade */}
        <div className="absolute bottom-0 left-0 right-0 h-16 pointer-events-none"
          style={{ background: "linear-gradient(to bottom, transparent, #0a0812)" }} />
      </section>

      {/* ═══ FLASH DEALS — Infinite Marquee ═══ */}
      <section style={{ background:"linear-gradient(180deg,#0a0812 0%,#0f0d1e 70%,#13101f 100%)" }} className="pb-16 pt-3">
        <style>{`
          @keyframes marquee { 0%{transform:translateX(0)} 100%{transform:translateX(-50%)} }
          .marquee-track { animation: marquee 28s linear infinite; }
          .marquee-track:hover { animation-play-state: paused; }
        `}</style>

        {/* Header */}
        <div className="max-w-7xl mx-auto px-5 flex items-center justify-between mb-6">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
              <span className="text-red-400 text-[0.62rem] font-bold tracking-[0.22em] uppercase">Live Now</span>
              {selectedCity && <span className="text-gold-400 text-[0.62rem] font-bold tracking-widest">· {selectedCity}</span>}
            </div>
            <h2 className="font-display font-light text-white" style={{ fontSize:"clamp(1.5rem,2.8vw,2rem)" }}>
              ⚡ Same Day Flash Deals
            </h2>
          </div>
          <Link href={`/flash-deals${selectedCity?`?city=${selectedCity}`:""}`}
            className="text-xs font-semibold text-gold-400 hover:text-gold-300 border border-gold-500/30 px-3 py-1.5 rounded-lg hover:border-gold-400/60 transition-all shrink-0">
            View All →
          </Link>
        </div>

        {/* Marquee carousel */}
        <div className="overflow-hidden w-full">
          {deals.length === 0 ? (
            <div className="flex gap-4 px-5">
              {[1,2,3,4,5].map(i => (
                <div key={i} className="rounded-2xl overflow-hidden bg-white/5 border border-white/10 shrink-0 w-56">
                  <div className="h-36 bg-white/10 animate-pulse" />
                  <div className="p-3 space-y-2">
                    <div className="h-2.5 bg-white/10 animate-pulse rounded-full w-2/3" />
                    <div className="h-4 bg-white/10 animate-pulse rounded-full w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="marquee-track flex gap-4 w-max px-5">
              {[...deals, ...deals, ...deals, ...deals].map((d: any, idx: number) => {
                const expires = new Date(d.validUntil);
                const diffMs  = Math.max(0, expires.getTime() - now);
                const hrs  = Math.floor(diffMs / 3600000);
                const mins = Math.floor((diffMs % 3600000) / 60000);
                const secs = Math.floor((diffMs % 60000) / 1000);
                const isUrgent = hrs < 2;
                const dealUrl  = `/hotels/${d.hotelId}?dealId=${d.id}&dealPrice=${d.aiPrice}&roomId=${d.roomId}&discount=${d.discount}&directBook=true`;
                const img = d.hotel?.images?.[0] || d.room?.images?.[0];

                return (
                  <div key={`${d.id}-${idx}`}
                    className="group relative rounded-2xl overflow-hidden border border-white/10 hover:border-gold-400/60 transition-all duration-300 cursor-pointer shrink-0 w-56"
                    style={{ background:"rgba(255,255,255,0.05)" }}
                    onClick={() => router.push(dealUrl)}>

                    {/* Image */}
                    <div className="relative h-36 overflow-hidden">
                      {img ? (
                        <img src={img} alt={d.hotel?.name} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center" style={{ background:"linear-gradient(135deg,#1a1530,#0d1a2e)" }}>
                          <span className="text-4xl opacity-20">🏨</span>
                        </div>
                      )}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />

                      {/* Same Day + city badge */}
                      <div className="absolute top-2 left-2 flex items-center gap-1 bg-black/70 backdrop-blur-sm border border-red-500/40 px-1.5 py-0.5 rounded-full">
                        <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse shrink-0" />
                        <span className="text-[0.55rem] font-bold text-red-400 uppercase">Today · {d.city}</span>
                      </div>

                      {/* Discount */}
                      <span className="absolute top-2 right-2 bg-gold-500 text-white text-[0.58rem] font-bold px-1.5 py-0.5 rounded-full">{d.discount}% OFF</span>

                      {/* Countdown over image bottom */}
                      <div className={`absolute bottom-2 left-2 flex items-center gap-1 ${isUrgent?"text-red-400":"text-white/70"}`}>
                        {isUrgent && <span className="w-1 h-1 bg-red-500 rounded-full animate-pulse" />}
                        <span className="text-[0.6rem] font-mono font-semibold bg-black/50 backdrop-blur-sm px-1.5 py-0.5 rounded">
                          {String(hrs).padStart(2,"0")}:{String(mins).padStart(2,"0")}:{String(secs).padStart(2,"0")}
                        </span>
                      </div>
                    </div>

                    {/* Body */}
                    <div className="p-3">
                      <h3 className="font-semibold text-white text-xs leading-snug mb-0.5 group-hover:text-gold-300 transition-colors line-clamp-1">{d.hotel?.name||"Hotel"}</h3>
                      <p className="text-white/40 text-[0.6rem] mb-2">{d.room?.type||"Room"}</p>

                      {/* Progress bar */}
                      <div className="h-0.5 bg-white/10 rounded-full overflow-hidden mb-2">
                        <div className="h-full bg-gradient-to-r from-gold-500 to-gold-300 rounded-full"
                          style={{ width:`${Math.min(100,(d.bookingCount/d.maxBookings)*100)}%` }} />
                      </div>

                      <div className="flex items-end justify-between">
                        <div>
                          <p className="text-white/25 text-[0.55rem] line-through">₹{d.floorPrice}</p>
                          <p className="text-white font-bold text-base">₹{d.aiPrice}<span className="text-white/30 text-[0.55rem] font-normal">/night</span></p>
                        </div>
                        <div onClick={e => e.stopPropagation()}>
                          <Link href={dealUrl} className="btn-luxury px-2.5 py-1 rounded-lg text-[0.65rem] font-bold">Book</Link>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* ═══ HOTELS IN SELECTED LOCATION ═══ */}
      <section className="py-14" style={{ background:"linear-gradient(180deg,#13101f 0%,#f4f2ec 8%)" }}>
        <div className="max-w-7xl mx-auto px-5">
          <div className="flex items-end justify-between mb-7">
            <div>
              <p className="text-gold-500 text-[0.65rem] font-semibold tracking-[0.22em] uppercase mb-1">
                {selectedCity ? `Hotels in ${selectedCity}` : "Featured Hotels"}
              </p>
              <h2 className="font-display font-light text-luxury-900" style={{ fontSize:"clamp(1.6rem,3vw,2.2rem)" }}>
                {selectedCity ? `Stay in ${selectedCity}` : "Top Stays Right Now"}
              </h2>
            </div>
            <Link href={`/hotels${selectedCity ? `?city=${selectedCity}` : ""}`}
              className="text-sm font-medium text-gold-500 hover:text-gold-600 flex items-center gap-1 transition-colors">
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
                  className="group card-luxury overflow-hidden hover:-translate-y-1 transition-all duration-300 block">
                  <div className="relative h-40 overflow-hidden bg-luxury-100">
                    {h.images?.[0] ? (
                      <img src={h.images[0]} alt={h.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center"><span className="text-4xl opacity-15">🏨</span></div>
                    )}
                    {h.trustBadge && (
                      <span className="absolute top-2 left-2 text-[0.6rem] font-bold px-2 py-0.5 bg-gold-500 text-white rounded-full">✓ Verified</span>
                    )}
                  </div>
                  <div className="p-4">
                    <h3 className="font-semibold text-luxury-900 text-sm leading-snug mb-0.5 group-hover:text-gold-600 transition-colors line-clamp-1">{h.name}</h3>
                    <p className="text-luxury-400 text-xs mb-2">📍 {h.city}</p>
                    {h.avgRating > 0 && (
                      <div className="flex items-center gap-1 mb-2">
                        <span className="text-gold-400 text-xs">★</span>
                        <span className="text-xs font-semibold text-luxury-700">{h.avgRating.toFixed(1)}</span>
                      </div>
                    )}
                    <p className="text-xs text-luxury-400">From <span className="font-bold text-luxury-800">₹{h.rooms?.[0]?.floorPrice || "—"}</span>/night</p>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ═══ ANIMATED STATS ═══ */}
      <section className="py-14 bg-white border-y border-luxury-100">
        <div className="max-w-4xl mx-auto px-5">
          <p className="text-center text-xs font-bold text-luxury-400 uppercase tracking-[0.22em] mb-10">StayBid by the Numbers</p>
          <div className="grid grid-cols-3 gap-6 text-center">
            {[
              { value: hotelCounter, suffix:"+", label:"Hotels Listed",    sub:"Verified properties across India", icon:"🏨" },
              { value: cityCounter,  suffix:"+", label:"Cities Covered",   sub:"Mountain & hill stations", icon:"🗺️" },
              { value: savingCounter,suffix:"%",  label:"Average Savings",  sub:"vs. other OTA platforms", icon:"💰" },
            ].map(s => (
              <div key={s.label} className="group p-6 rounded-3xl border border-luxury-100 hover:border-gold-200 hover:shadow-luxury transition-all duration-300 hover:-translate-y-0.5">
                <div className="text-3xl mb-3">{s.icon}</div>
                <p className="font-display font-semibold text-luxury-900 mb-1" style={{ fontSize:"2.5rem" }}>
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
      <section className="max-w-7xl mx-auto px-5 py-20 md:py-28">
        <div className="text-center mb-14">
          <p className="text-gold-500 text-[0.68rem] font-semibold tracking-[0.22em] uppercase mb-3">Simple Process</p>
          <h2 className="font-display font-light text-luxury-900" style={{ fontSize:"clamp(1.8rem,4vw,2.6rem)" }}>How StayBid Works</h2>
          <div className="gold-line w-20 mx-auto mt-4" />
        </div>
        <div className="grid md:grid-cols-3 gap-6">
          {[
            { num:"01", title:"Search & Browse", desc:"Discover premium hotels in your destination. Review rooms, amenities, and verified guest ratings.",
              icon:<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" /></svg> },
            { num:"02", title:"Name Your Price", desc:"Submit a bid with your budget. Hotels see your offer and compete to win your booking.",
              icon:<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg> },
            { num:"03", title:"Book & Save", desc:"Accept the best counter-offer and confirm instantly. Save up to 40% off published rates.",
              icon:<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg> },
          ].map(s => (
            <div key={s.num} className="group relative p-7 rounded-3xl bg-white border border-luxury-100 hover:border-gold-200 hover:shadow-luxury-lg transition-all duration-300 overflow-hidden hover:-translate-y-1">
              <span className="absolute top-4 right-5 font-display text-7xl font-bold text-luxury-100 group-hover:text-gold-100 transition-colors leading-none select-none">{s.num}</span>
              <div className="relative w-10 h-10 rounded-xl bg-gold-100 text-gold-500 flex items-center justify-center mb-5 group-hover:bg-gold-500 group-hover:text-white transition-all duration-300">{s.icon}</div>
              <h3 className="font-semibold text-luxury-900 text-[1rem] mb-2">{s.title}</h3>
              <p className="text-luxury-500 text-sm leading-relaxed">{s.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ═══ TRUST STRIP ═══ */}
      <section className="border-t border-luxury-100 py-10 bg-white">
        <div className="max-w-7xl mx-auto px-5">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
            {[
              { icon:"🔒", title:"Secure Payments", sub:"Razorpay encrypted" },
              { icon:"✅", title:"Verified Hotels",  sub:"Hand-picked stays" },
              { icon:"💬", title:"Live Bidding",     sub:"Real-time counters" },
              { icon:"🏔️", title:"Mountain Getaways",sub:"Curated destinations" },
            ].map(t => (
              <div key={t.title} className="flex flex-col items-center gap-1.5">
                <span className="text-2xl">{t.icon}</span>
                <p className="text-sm font-semibold text-luxury-800">{t.title}</p>
                <p className="text-xs text-luxury-400">{t.sub}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ FOOTER ═══ */}
      <footer className="border-t border-luxury-200 py-10 bg-white">
        <div className="max-w-7xl mx-auto px-5 flex flex-col md:flex-row items-center justify-between gap-4">
          <Link href="/" className="flex items-center gap-2.5 select-none">
            <div className="w-8 h-8 rounded-lg btn-luxury flex items-center justify-center text-white font-bold text-xs">S</div>
            <span className="font-display text-xl text-luxury-800 tracking-wide">StayBid</span>
          </Link>
          <p className="text-sm text-luxury-400">© 2026 StayBid. Crafted with care in India.</p>
          <div className="flex items-center gap-5 text-sm text-luxury-400">
            {[{href:"/hotels",label:"Hotels"},{href:"/flash-deals",label:"Deals"},{href:"/bid",label:"Place Bid"}].map(l => (
              <Link key={l.href} href={l.href} className="hover:text-luxury-700 transition-colors">{l.label}</Link>
            ))}
          </div>
        </div>
      </footer>
    </div>
  );
}
