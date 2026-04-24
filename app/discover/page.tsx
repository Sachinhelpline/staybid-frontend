"use client";
// ═══════════════════════════════════════════════════════════════════════════
// Discovery — true reels UI.
// • Full-screen hero = Ken-Burns cross-fade slideshow of each hotel's own photos
// • Swipe works on the ENTIRE viewport (touchAction none on root)
// • Vertical swipe/ArrowDown/Up → next/prev hotel
// • Horizontal swipe/ArrowRight/Left → next/prev detail slide
// • Minimal translucent pill CTAs (glass, ~half width)
// • Reels-first: fewer chrome, more photo
// ═══════════════════════════════════════════════════════════════════════════
import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { track, getSignals, initTracking, markViewed } from "@/lib/track";

type Item = { hotel: any; score: number; reasons: string[]; exploration?: boolean };

const SLIDES = ["Overview", "Amenities", "Rooms", "Reviews"] as const;

export default function DiscoverPage() {
  const router = useRouter();
  const [items, setItems]       = useState<Item[]>([]);
  const [hotelIdx, setHotelIdx] = useState(0);
  const [slideIdx, setSlideIdx] = useState(0);
  const [photoIdx, setPhotoIdx] = useState(0);
  const [loading, setLoading]   = useState(true);
  const [showHint, setShowHint] = useState(true);
  const dwellStart = useRef<number>(Date.now());

  const loadFeed = useCallback(async () => {
    setLoading(true);
    try {
      const tok = typeof window !== "undefined" ? localStorage.getItem("sb_token") : null;
      const r = await fetch("/api/discover/feed", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(tok ? { Authorization: `Bearer ${tok}` } : {}) },
        body: JSON.stringify({ limit: 30, signals: getSignals() }),
      });
      const d = await r.json();
      setItems(d.items || []);
    } catch { setItems([]); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    initTracking();
    track("app_open", { meta: { mode: "discover" } });
    loadFeed();
    const t = setTimeout(() => setShowHint(false), 4500);
    return () => clearTimeout(t);
  }, [loadFeed]);

  const current = items[hotelIdx];

  // Hotel change: reset photo slideshow + slide, fire analytics
  useEffect(() => {
    if (!current) return;
    dwellStart.current = Date.now();
    setSlideIdx(0);
    setPhotoIdx(0);
    const h = current.hotel;
    const minPrice = h.minPrice ?? (h.rooms?.length ? Math.min(...h.rooms.map((r: any) => r.floorPrice || 99999)) : undefined);
    track("hotel_view", { hotelId: h.id, meta: { city: h.city, minPrice, amenities: h.amenities || [] } });
    markViewed(h.id, h.city, minPrice, h.amenities || []);
  }, [hotelIdx, current]);

  // Auto-advance photo slideshow every 4.5s (Ken Burns effect)
  useEffect(() => {
    if (!current) return;
    const imgs = (current.hotel.images || []).filter(Boolean);
    if (imgs.length < 2) return;
    const id = setInterval(() => setPhotoIdx((i) => (i + 1) % imgs.length), 4500);
    return () => clearInterval(id);
  }, [current]);

  // Prefetch next hotel's hero
  useEffect(() => {
    const next = items[hotelIdx + 1]?.hotel;
    const img = next?.images?.[0];
    if (img && typeof window !== "undefined") { const i = new Image(); i.src = img; }
  }, [hotelIdx, items]);

  // Navigation
  const nextHotel = useCallback(() => {
    const dwellMs = Date.now() - dwellStart.current;
    if (current) track("swipe_next", { hotelId: current.hotel.id, meta: { dwellMs } });
    setHotelIdx((i) => {
      const ni = i + 1;
      if (ni >= items.length - 3) loadFeed();
      return Math.min(ni, items.length - 1);
    });
  }, [current, items.length, loadFeed]);

  const prevHotel = useCallback(() => {
    if (current) track("swipe_prev", { hotelId: current.hotel.id });
    setHotelIdx((i) => Math.max(0, i - 1));
  }, [current]);

  const nextSlide = useCallback(() => {
    setSlideIdx((i) => Math.min(i + 1, SLIDES.length - 1));
    if (current) track("swipe_detail", { hotelId: current.hotel.id, meta: { slide: SLIDES[Math.min(slideIdx + 1, SLIDES.length - 1)] } });
  }, [current, slideIdx]);
  const prevSlide = useCallback(() => setSlideIdx((i) => Math.max(0, i - 1)), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown")  nextHotel();
      if (e.key === "ArrowUp")    prevHotel();
      if (e.key === "ArrowRight") nextSlide();
      if (e.key === "ArrowLeft")  prevSlide();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [nextHotel, prevHotel, nextSlide, prevSlide]);

  // ── Full-screen touch gestures ──
  const touch = useRef<{ x: number; y: number; t: number } | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    touch.current = { x: t.clientX, y: t.clientY, t: Date.now() };
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (!touch.current) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touch.current.x;
    const dy = t.clientY - touch.current.y;
    const dt = Date.now() - touch.current.t;
    touch.current = null;
    if (dt > 700) return;
    const ax = Math.abs(dx), ay = Math.abs(dy);
    if (Math.max(ax, ay) < 45) return;
    if (ay > ax) { dy < 0 ? nextHotel() : prevHotel(); }
    else          { dx < 0 ? nextSlide() : prevSlide(); }
  };

  const h = current?.hotel;
  const images: string[] = (h?.images || []).filter(Boolean);
  const activeImg = images[photoIdx] || images[0];
  const totalPhotos = Math.max(1, images.length);

  return (
    <div
      className="fixed inset-0 bg-black overflow-hidden select-none"
      style={{ touchAction: "none", WebkitUserSelect: "none" }}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      <style>{`
        @keyframes kenBurns {
          0%   { transform: scale(1.02) translate(0,0); }
          50%  { transform: scale(1.12) translate(-1.5%,-1%); }
          100% { transform: scale(1.02) translate(0,0); }
        }
        @keyframes heroFade { from { opacity: 0; } to { opacity: 1; } }
        @keyframes slideIn { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes swipePulse { 0%,100% { opacity: .55; transform: translateY(0);} 50% { opacity: 1; transform: translateY(-5px);} }
        .kb-img { animation: heroFade 0.7s ease-out, kenBurns 9s ease-in-out infinite; will-change: transform, opacity; }
        .slide-in { animation: slideIn 0.35s ease-out both; }
        .swipe-hint { animation: swipePulse 1.8s ease-in-out infinite; }
        .glass-cta {
          backdrop-filter: blur(14px) saturate(1.4);
          -webkit-backdrop-filter: blur(14px) saturate(1.4);
        }
      `}</style>

      {/* ── Minimal top chrome ── */}
      <div className="absolute top-0 left-0 right-0 z-30 flex items-center justify-between px-4 pt-3 pb-6 bg-gradient-to-b from-black/55 to-transparent pointer-events-none">
        <div className="flex items-center gap-1.5 pointer-events-auto">
          <span className="text-[0.6rem] font-bold tracking-[0.3em] uppercase text-gold-300">StayBid</span>
          <span className="text-white/30 text-xs">·</span>
          <span className="text-[0.6rem] font-bold tracking-widest uppercase text-white/70">Explore</span>
        </div>
        <Link
          href="/hotels?from=discover"
          onClick={() => track("mode_toggle", { meta: { to: "list" } })}
          className="pointer-events-auto glass-cta text-[0.62rem] font-semibold text-white/90 px-3 py-1.5 rounded-full bg-white/10 border border-white/20"
        >
          ☰ Compare
        </Link>
      </div>

      {loading && items.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-10 h-10 border-2 border-gold-400 border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {!loading && items.length === 0 && (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6">
          <span className="text-5xl mb-3">🏔️</span>
          <p className="text-white font-semibold mb-1">No hotels to discover yet</p>
          <Link href="/hotels" className="mt-3 px-4 py-2 rounded-full bg-gold-400 text-black font-semibold text-sm">Go to Compare</Link>
        </div>
      )}

      {h && (
        <div key={h.id} className="absolute inset-0">
          {/* ── Hero Ken-Burns slideshow (fills viewport, object-cover ensures mobile-size fit) ── */}
          <div className="absolute inset-0 bg-black">
            {activeImg ? (
              <img
                key={`${h.id}-${photoIdx}`}
                src={activeImg}
                alt={h.name}
                className="kb-img absolute inset-0 w-full h-full object-cover"
                draggable={false}
                onError={(e: any) => { e.target.style.opacity = 0.3; }}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-7xl opacity-30" style={{ background: "linear-gradient(135deg,#1a1530,#0d1a2e)" }}>🏨</div>
            )}
            {/* cinematic gradients top + bottom */}
            <div className="absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-black/65 to-transparent" />
            <div className="absolute inset-x-0 bottom-0 h-[55%] bg-gradient-to-t from-black via-black/55 to-transparent" />
          </div>

          {/* ── Photo progress pips (like stories) ── */}
          {images.length > 1 && (
            <div className="absolute top-[52px] left-4 right-4 z-20 flex gap-1">
              {images.slice(0, 6).map((_, i) => (
                <div key={i} className="flex-1 h-[2px] bg-white/25 rounded-full overflow-hidden">
                  <div className={`h-full bg-white transition-all duration-300 ${i < photoIdx ? "w-full" : i === photoIdx ? "w-full animate-[kbProg_4.5s_linear]" : "w-0"}`} />
                </div>
              ))}
            </div>
          )}

          {/* ── Hotel # pip (vertical, tiny) ── */}
          <div className="absolute top-24 right-2 flex flex-col gap-1 z-20">
            {items.slice(0, 6).map((_, i) => (
              <span key={i} className={`w-[3px] h-3 rounded-full ${i === hotelIdx ? "bg-gold-400" : "bg-white/25"}`} />
            ))}
          </div>

          {/* ── Content (slide bodies) ── */}
          <div className="absolute inset-x-0 bottom-0 z-10 slide-in" key={slideIdx}>
            <div className="px-5 pb-24 pt-6">
              {/* Header */}
              <div className="mb-3">
                <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
                  {h.trustBadge && <span className="text-[0.5rem] font-bold px-1.5 py-0.5 rounded-full bg-gold-500/95 text-black">✓</span>}
                  {current.exploration && <span className="text-[0.5rem] font-bold px-1.5 py-0.5 rounded-full bg-purple-500/90 text-white">✨ NEW</span>}
                  {h.starRating && <span className="text-[0.6rem] text-gold-300 font-bold">{"★".repeat(h.starRating)}</span>}
                  {h.avgRating > 0 && <span className="text-[0.6rem] font-bold text-white glass-cta bg-white/10 px-1.5 py-0.5 rounded-full">★ {h.avgRating.toFixed(1)}</span>}
                </div>
                <h2 className="font-display font-light text-white text-[1.65rem] leading-tight mb-0.5">{h.name}</h2>
                <p className="text-white/60 text-[0.68rem]">📍 {h.city}{h.state ? `, ${h.state}` : ""}</p>
              </div>

              {/* Slide body */}
              {slideIdx === 0 && (
                <div className="space-y-2.5">
                  {current.reasons?.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {current.reasons.slice(0, 2).map((r, i) => (
                        <span key={i} className="text-[0.58rem] font-semibold px-2 py-0.5 rounded-full bg-gold-400/15 text-gold-300 border border-gold-400/25">{r}</span>
                      ))}
                    </div>
                  )}
                  <div className="flex items-end gap-3">
                    <div>
                      <p className="text-white/50 text-[0.55rem] uppercase tracking-widest">Starting</p>
                      <p className="text-white font-bold text-xl leading-none">₹{(h.minPrice || 0).toLocaleString()}<span className="text-white/50 text-[0.65rem] font-normal ml-0.5">/night</span></p>
                    </div>
                    {h.amenities?.length > 0 && (
                      <p className="text-white/55 text-[0.66rem] flex-1 truncate">{h.amenities.slice(0, 3).join(" · ")}</p>
                    )}
                  </div>
                </div>
              )}

              {slideIdx === 1 && (
                <div>
                  <p className="text-white/50 text-[0.55rem] uppercase tracking-widest mb-1.5">Amenities</p>
                  <div className="flex flex-wrap gap-1.5">
                    {(h.amenities || ["WiFi","AC","Hot Water","Parking"]).slice(0, 10).map((a: string) => (
                      <span key={a} className="text-[0.65rem] px-2 py-1 rounded-full glass-cta bg-white/10 border border-white/20 text-white/90">{a}</span>
                    ))}
                  </div>
                </div>
              )}

              {slideIdx === 2 && (
                <div>
                  <p className="text-white/50 text-[0.55rem] uppercase tracking-widest mb-1.5">Rooms</p>
                  <div className="space-y-1.5">
                    {(h.rooms || []).slice(0, 3).map((r: any) => (
                      <div key={r.id} className="flex items-center justify-between rounded-xl px-2.5 py-1.5 glass-cta bg-white/8 border border-white/15">
                        <div>
                          <p className="text-white font-semibold text-[0.78rem] leading-tight">{r.name || r.type}</p>
                          <p className="text-white/50 text-[0.58rem]">Up to {r.capacity || 2} guests</p>
                        </div>
                        <p className="text-gold-300 font-bold text-[0.78rem]">₹{(r.floorPrice || 0).toLocaleString()}</p>
                      </div>
                    ))}
                    {(!h.rooms || h.rooms.length === 0) && (
                      <p className="text-white/50 text-xs">Rooms load on the full hotel page.</p>
                    )}
                  </div>
                </div>
              )}

              {slideIdx === 3 && (
                <div>
                  <p className="text-white/50 text-[0.55rem] uppercase tracking-widest mb-1.5">Reviews</p>
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-gold-300 text-xl font-bold">★ {(h.avgRating || 4.5).toFixed(1)}</span>
                    <p className="text-white/60 text-[0.62rem]">Verified stays</p>
                  </div>
                  <p className="text-white/75 text-[0.72rem] leading-relaxed italic">"Stunning property, incredible service. Worth every rupee."</p>
                </div>
              )}

              {/* Slide dots */}
              <div className="mt-4 flex items-center gap-1">
                {SLIDES.map((_, i) => (
                  <span key={i} className={`h-[3px] rounded-full transition-all ${i === slideIdx ? "w-5 bg-gold-400" : "w-1.5 bg-white/30"}`} />
                ))}
              </div>

              {showHint && hotelIdx === 0 && slideIdx === 0 && (
                <div className="mt-3 flex items-center gap-3 text-white/60 text-[0.58rem]">
                  <span className="swipe-hint">↑ Next hotel</span>
                  <span className="swipe-hint">→ Details</span>
                </div>
              )}
            </div>

            {/* ── Minimal translucent CTA rail (half-width pills) ── */}
            <div className="absolute left-0 right-0 bottom-4 px-5 flex justify-center gap-2 z-20 pointer-events-none">
              <button
                onClick={() => { track("click_book", { hotelId: h.id }); router.push(`/hotels/${h.id}#availability-picker`); }}
                className="pointer-events-auto glass-cta flex items-center gap-1.5 px-4 py-2 rounded-full bg-gold-400/85 text-black font-semibold text-[0.72rem] shadow-lg"
                style={{ boxShadow: "0 8px 24px -6px rgba(240,180,41,0.55)" }}
              >
                ⚡ Book
              </button>
              <button
                onClick={() => { track("click_bid", { hotelId: h.id }); router.push(`/bid?hotelId=${h.id}`); }}
                className="pointer-events-auto glass-cta flex items-center gap-1.5 px-4 py-2 rounded-full bg-white/15 border border-white/25 text-white font-semibold text-[0.72rem]"
              >
                🤝 Bid
              </button>
              <button
                onClick={() => { track("swipe_detail", { hotelId: h.id, meta: { to: "full" } }); router.push(`/hotels/${h.id}`); }}
                className="pointer-events-auto glass-cta flex items-center justify-center w-9 h-9 rounded-full bg-white/10 border border-white/25 text-white text-sm"
                title="Open full hotel page"
              >
                →
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
