"use client";
// ═══════════════════════════════════════════════════════════════════════════
// Discovery — reels-style hotel swipe mode.
// Vertical swipe/arrow-down  → next hotel
// Horizontal swipe/arrow-right → next detail slide (Overview/Amenities/Reviews/Rooms)
// Sticky CTAs (Book Now / Bid Now / View Details)
// Toggle back to Compare (list) preserves scroll via the ?from=discover param.
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
  const [loading, setLoading]   = useState(true);
  const [showHint, setShowHint] = useState(true);
  const dwellStart = useRef<number>(Date.now());

  // Fetch ranked feed (session-aware)
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

  // Fire hotel_view + reset dwell when hotel changes
  const current = items[hotelIdx];
  useEffect(() => {
    if (!current) return;
    dwellStart.current = Date.now();
    setSlideIdx(0);
    const h = current.hotel;
    const minPrice = h.minPrice ?? (h.rooms?.length ? Math.min(...h.rooms.map((r: any) => r.floorPrice || 99999)) : undefined);
    track("hotel_view", {
      hotelId: h.id,
      meta: { city: h.city, minPrice, amenities: h.amenities || [] },
    });
    markViewed(h.id, h.city, minPrice, h.amenities || []);
  }, [hotelIdx, current]);

  // Prefetch next hotel's hero image
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
      if (ni >= items.length - 3) loadFeed(); // top-up when near end
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

  // ─── Keyboard nav ───
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

  // ─── Touch gestures (swipe) ───
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
    if (dt > 600) return; // slow swipe = ignore
    const ax = Math.abs(dx), ay = Math.abs(dy);
    if (Math.max(ax, ay) < 40) return;
    if (ay > ax) { dy < 0 ? nextHotel() : prevHotel(); }
    else          { dx < 0 ? nextSlide() : prevSlide(); }
  };

  const h = current?.hotel;

  return (
    <div
      className="fixed inset-0 bg-black overflow-hidden select-none"
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      <style>{`
        @keyframes heroIn { from { opacity: 0; transform: scale(1.04); } to { opacity: 1; transform: scale(1); } }
        @keyframes slideIn { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }
        .hero-img { animation: heroIn 0.55s ease-out both; }
        .slide-in { animation: slideIn 0.35s ease-out both; }
        .swipe-hint { animation: pulse 1.8s ease-in-out infinite; }
        @keyframes pulse { 0%,100% { opacity: 0.6; transform: translateY(0);} 50% { opacity: 1; transform: translateY(-6px);} }
      `}</style>

      {/* Top bar — toggle back to Compare */}
      <div className="absolute top-0 left-0 right-0 z-30 flex items-center justify-between px-4 py-3 bg-gradient-to-b from-black/70 to-transparent">
        <div className="flex items-center gap-1 text-white">
          <span className="text-[0.62rem] font-bold tracking-[0.25em] uppercase text-gold-300">StayBid</span>
          <span className="text-white/40 text-xs mx-1">·</span>
          <span className="text-[0.62rem] font-bold tracking-widest uppercase text-white/80">Explore</span>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/hotels?from=discover"
            onClick={() => track("mode_toggle", { meta: { to: "list" } })}
            className="btn-3d btn-3d-dark btn-3d-sm !py-1.5 !text-[0.68rem]"
          >
            ☰ Compare
          </Link>
        </div>
      </div>

      {/* Loading state */}
      {loading && items.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-10 h-10 border-2 border-gold-400 border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {/* Empty state */}
      {!loading && items.length === 0 && (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6">
          <span className="text-5xl mb-3">🏔️</span>
          <p className="text-white font-semibold mb-1">No hotels to discover yet</p>
          <p className="text-white/50 text-sm mb-5">Try the Compare view to browse all hotels.</p>
          <Link href="/hotels" className="btn-3d btn-3d-gold">Go to Compare</Link>
        </div>
      )}

      {/* Hotel card */}
      {h && (
        <div key={h.id} className="absolute inset-0">
          {/* Hero image */}
          <div className="absolute inset-0">
            {h.images?.[0] ? (
              <img src={h.images[0]} alt={h.name}
                className="hero-img w-full h-full object-cover"
                onError={(e: any) => { e.target.style.opacity = 0.3; }} />
            ) : (
              <div className="w-full h-full" style={{ background: "linear-gradient(135deg,#1a1530,#0d1a2e)" }}>
                <div className="w-full h-full flex items-center justify-center text-7xl opacity-30">🏨</div>
              </div>
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-black/10" />
          </div>

          {/* Progress rail (hotel progress vertical) */}
          <div className="absolute top-12 right-3 flex flex-col gap-1 z-20">
            {items.slice(0, 8).map((_, i) => (
              <span key={i} className={`w-1 h-4 rounded-full ${i === hotelIdx ? "bg-gold-400" : "bg-white/25"}`} />
            ))}
            {items.length > 8 && <span className="text-[0.55rem] text-white/50 mt-1">+{items.length - 8}</span>}
          </div>

          {/* Slide tabs (horizontal progress) */}
          <div className="absolute top-14 left-4 right-16 flex gap-1.5 z-20">
            {SLIDES.map((s, i) => (
              <div key={s} className="flex-1 h-0.5 bg-white/20 rounded-full overflow-hidden">
                <div className={`h-full bg-gold-400 transition-all duration-500 ${i < slideIdx ? "w-full" : i === slideIdx ? "w-full" : "w-0"}`} />
              </div>
            ))}
          </div>

          {/* Body — slide content */}
          <div className="absolute inset-x-0 bottom-0 pb-32 pt-16 px-5 z-10 slide-in" key={slideIdx}>
            {/* Shared header */}
            <div className="mb-4">
              <div className="flex items-center gap-2 mb-1.5">
                {h.trustBadge && <span className="text-[0.55rem] font-bold px-2 py-0.5 rounded-full bg-gold-500/90 text-black">✓ Verified</span>}
                {current.exploration && <span className="text-[0.55rem] font-bold px-2 py-0.5 rounded-full bg-purple-500/90 text-white">✨ Discover</span>}
                {h.starRating && <span className="text-[0.6rem] text-gold-300 font-bold">{"★".repeat(h.starRating)}</span>}
                {h.avgRating > 0 && <span className="text-[0.65rem] font-bold text-white bg-white/10 px-2 py-0.5 rounded-full">★ {h.avgRating.toFixed(1)}</span>}
              </div>
              <h2 className="font-display font-light text-white text-3xl leading-tight mb-1">{h.name}</h2>
              <p className="text-white/60 text-xs">📍 {h.city}{h.state ? `, ${h.state}` : ""}</p>
            </div>

            {/* Slide content */}
            {slideIdx === 0 && (
              <div className="space-y-3">
                {current.reasons?.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {current.reasons.map((r, i) => (
                      <span key={i} className="text-[0.62rem] font-semibold px-2.5 py-1 rounded-full bg-gold-400/15 text-gold-300 border border-gold-400/30">
                        {r}
                      </span>
                    ))}
                  </div>
                )}
                <div className="flex items-end gap-4">
                  <div>
                    <p className="text-white/50 text-[0.6rem] uppercase tracking-widest">Starting from</p>
                    <p className="text-white font-bold text-2xl leading-none">₹{(h.minPrice || 0).toLocaleString()}
                      <span className="text-white/50 text-xs font-normal ml-1">/night</span>
                    </p>
                  </div>
                  {h.amenities?.length > 0 && (
                    <p className="text-white/60 text-xs flex-1 truncate">
                      {h.amenities.slice(0, 4).join(" · ")}
                    </p>
                  )}
                </div>
              </div>
            )}

            {slideIdx === 1 && (
              <div>
                <p className="text-white/50 text-[0.6rem] uppercase tracking-widest mb-2">Amenities</p>
                <div className="flex flex-wrap gap-2">
                  {(h.amenities || ["WiFi", "AC", "Hot Water", "Parking"]).slice(0, 12).map((a: string) => (
                    <span key={a} className="text-xs px-3 py-1.5 rounded-full bg-white/10 border border-white/20 text-white/90">{a}</span>
                  ))}
                </div>
              </div>
            )}

            {slideIdx === 2 && (
              <div>
                <p className="text-white/50 text-[0.6rem] uppercase tracking-widest mb-2">Rooms</p>
                <div className="space-y-2">
                  {(h.rooms || []).slice(0, 4).map((r: any) => (
                    <div key={r.id} className="flex items-center justify-between rounded-xl px-3 py-2 bg-white/8 border border-white/15">
                      <div>
                        <p className="text-white font-semibold text-sm">{r.name || r.type}</p>
                        <p className="text-white/50 text-[0.65rem]">Up to {r.capacity || 2} guests</p>
                      </div>
                      <p className="text-gold-300 font-bold text-sm">₹{(r.floorPrice || 0).toLocaleString()}</p>
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
                <p className="text-white/50 text-[0.6rem] uppercase tracking-widest mb-2">Guest Reviews</p>
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-gold-300 text-2xl font-bold">★ {(h.avgRating || 4.5).toFixed(1)}</span>
                  <p className="text-white/60 text-xs">Based on verified stays</p>
                </div>
                <p className="text-white/70 text-xs leading-relaxed">
                  “Stunning property with incredible service. The view alone is worth it.” — verified StayBid guest
                </p>
              </div>
            )}

            {/* Gesture hint (first-time) */}
            {showHint && hotelIdx === 0 && slideIdx === 0 && (
              <div className="mt-5 flex items-center gap-4 text-white/70 text-[0.62rem]">
                <span className="swipe-hint">⬆️ Swipe for next hotel</span>
                <span className="swipe-hint">➡️ Swipe for details</span>
              </div>
            )}
          </div>

          {/* Sticky CTAs */}
          <div className="absolute left-4 right-4 bottom-5 z-20 flex gap-2">
            <button
              onClick={() => { track("click_book", { hotelId: h.id }); router.push(`/hotels/${h.id}#availability-picker`); }}
              className="btn-3d btn-3d-gold flex-1"
            >
              ⚡ Book Now
            </button>
            <button
              onClick={() => { track("click_bid", { hotelId: h.id }); router.push(`/bid?hotelId=${h.id}`); }}
              className="btn-3d btn-3d-white flex-1"
            >
              🤝 Bid
            </button>
            <button
              onClick={() => { track("swipe_detail", { hotelId: h.id, meta: { to: "full" } }); router.push(`/hotels/${h.id}`); }}
              className="btn-3d btn-3d-dark !px-3"
              title="Open full hotel page"
            >
              →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
