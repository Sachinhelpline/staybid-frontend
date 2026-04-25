"use client";
// ═══════════════════════════════════════════════════════════════════════════
// Discovery — FULL-DISPLAY reels mode.
// Layout:
//   • Hero zone (top ~62% of screen): Ken-Burns cross-fade slideshow
//       – vertical swipe here → next/prev hotel
//       – horizontal swipe anywhere → next/prev detail slide
//   • Scrollable bottom sheet (~38% default, drag up to ~92%):
//       – tabs: Overview / Amenities / Rooms / Reviews
//       – content scrolls natively (user drags up to read more)
//       – drag handle at top, grabbable
//   • Top-left chip: ☰ Compare (returns to /hotels)
//   • Bottom FAB: ⬆ swipe up / tap → action drawer (Book / Bid / Open full)
//
// Fullscreen: navbar is hidden on this route (Navbar component checks /discover).
// ═══════════════════════════════════════════════════════════════════════════
import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { track, getSignals, initTracking, markViewed } from "@/lib/track";

type Item = { hotel: any; score: number; reasons: string[]; exploration?: boolean };
const SLIDES = ["Overview", "Amenities", "Rooms", "Reviews"] as const;
type SlideKey = typeof SLIDES[number];

const FAKE_REVIEWS = [
  { name: "Priya M.", rating: 5, text: "Absolutely breathtaking. The view from our suite at sunrise was unreal — we woke up inside a painting." },
  { name: "Rohan K.", rating: 5, text: "Service was on another level. Staff remembered our names from check-in. Felt like family." },
  { name: "Aisha S.", rating: 4, text: "Food was Michelin-worthy. The chef actually came to our table to walk us through the menu." },
  { name: "Vikram B.",rating: 5, text: "Booked through StayBid and saved ₹4,200. Same room, better experience than the OTA listings." },
  { name: "Meera D.", rating: 4, text: "Quiet, clean, and the bathroom had a full-height window facing the mountains. Magical." },
  { name: "Arjun P.", rating: 5, text: "Best anniversary ever. They set up a private dinner on the terrace without us even asking." },
];

export default function DiscoverPage() {
  const router = useRouter();
  const [items, setItems]       = useState<Item[]>([]);
  const [hotelIdx, setHotelIdx] = useState(0);
  const [slideIdx, setSlideIdx] = useState(0);
  const [photoIdx, setPhotoIdx] = useState(0);
  const [loading, setLoading]   = useState(true);
  const [showHint, setShowHint] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  // Default to "peek" so the hotel photo dominates; user drags up to read more.
  const [sheetState, setSheetState] = useState<"peek" | "mid" | "full">("peek");
  const [actionOpen, setActionOpen] = useState(false);
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
    // ── True first-visit onboarding ─────────────────────────────────────
    // Show the full overlay only on the user's FIRST ever visit to /discover
    // (or after they explicitly clear it). Subsequent visits get nothing.
    try {
      const seen = localStorage.getItem("sb_disco_onboarded_v1");
      if (!seen) {
        setShowOnboarding(true);
        setShowHint(true);
      }
    } catch {}
  }, [loadFeed]);

  const dismissOnboarding = useCallback(() => {
    setShowOnboarding(false);
    try { localStorage.setItem("sb_disco_onboarded_v1", "1"); } catch {}
    // Keep mini hint for ~5s after they tap "Got it" so the muscle memory locks in
    const t = setTimeout(() => setShowHint(false), 5000);
    return () => clearTimeout(t);
  }, []);

  const current = items[hotelIdx];

  // Reset on hotel change
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

  // Ken-Burns slideshow auto-cycle
  useEffect(() => {
    if (!current) return;
    const imgs = (current.hotel.images || []).filter(Boolean);
    if (imgs.length < 2) return;
    const id = setInterval(() => setPhotoIdx((i) => (i + 1) % imgs.length), 4500);
    return () => clearInterval(id);
  }, [current]);

  // ── Prefetch next 2 hotels: hero+thumb images AND warm /hotels/[id] page ──
  // Customer often taps "Full Details" — having the route prefetched + the
  // image in cache makes the transition feel instant.
  const prefetched = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (typeof window === "undefined") return;
    [1, 2].forEach((offset) => {
      const next = items[hotelIdx + offset]?.hotel;
      if (!next || prefetched.current.has(next.id)) return;
      prefetched.current.add(next.id);

      // 1) Warm hero + first thumbnail
      (next.images || []).slice(0, 2).forEach((src: string) => {
        if (src) { const i = new Image(); i.src = src; }
      });
      // 2) Prefetch the full hotel page route so client nav is instant
      try { router.prefetch(`/hotels/${next.id}`); } catch {}
      // 3) Warm room/availability data into the browser HTTP cache (low-prio)
      try {
        fetch(`/api/availability/units?hotelId=${encodeURIComponent(next.id)}`, {
          method: "GET",
          priority: "low" as any,
          keepalive: true,
        }).catch(() => {});
      } catch {}
    });
  }, [hotelIdx, items, router]);

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
  }, []);
  const prevSlide = useCallback(() => setSlideIdx((i) => Math.max(0, i - 1)), []);

  // Keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown")  nextHotel();
      if (e.key === "ArrowUp")    prevHotel();
      if (e.key === "ArrowRight") nextSlide();
      if (e.key === "ArrowLeft")  prevSlide();
      if (e.key === "Escape")     { setActionOpen(false); setSheetState("mid"); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [nextHotel, prevHotel, nextSlide, prevSlide]);

  // ── HERO zone touch: vertical = hotel nav, horizontal = slide nav ──
  const heroTouch = useRef<{ x: number; y: number; t: number } | null>(null);
  const onHeroTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    heroTouch.current = { x: t.clientX, y: t.clientY, t: Date.now() };
  };
  const onHeroTouchEnd = (e: React.TouchEvent) => {
    if (!heroTouch.current) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - heroTouch.current.x;
    const dy = t.clientY - heroTouch.current.y;
    const dt = Date.now() - heroTouch.current.t;
    heroTouch.current = null;
    if (dt > 700) return;
    const ax = Math.abs(dx), ay = Math.abs(dy);
    if (Math.max(ax, ay) < 45) return;
    if (ay > ax) { dy < 0 ? nextHotel() : prevHotel(); }
    else          { dx < 0 ? nextSlide() : prevSlide(); }
  };

  // ── Bottom sheet drag ──
  const sheetTouch = useRef<{ y: number; state: "peek" | "mid" | "full" } | null>(null);
  const onSheetHandleStart = (e: React.TouchEvent) => {
    sheetTouch.current = { y: e.touches[0].clientY, state: sheetState };
  };
  const onSheetHandleEnd = (e: React.TouchEvent) => {
    if (!sheetTouch.current) return;
    const dy = e.changedTouches[0].clientY - sheetTouch.current.y;
    const s = sheetTouch.current.state;
    sheetTouch.current = null;
    if (dy < -40)        setSheetState(s === "peek" ? "mid" : "full");
    else if (dy > 40)    setSheetState(s === "full" ? "mid" : "peek");
  };

  // ── Horizontal swipe inside sheet content (for slide nav) ──
  const sheetHTouch = useRef<{ x: number; y: number } | null>(null);
  const onSheetTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    sheetHTouch.current = { x: t.clientX, y: t.clientY };
  };
  const onSheetTouchEnd = (e: React.TouchEvent) => {
    if (!sheetHTouch.current) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - sheetHTouch.current.x;
    const dy = t.clientY - sheetHTouch.current.y;
    sheetHTouch.current = null;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.4) {
      dx < 0 ? nextSlide() : prevSlide();
    }
  };

  const h = current?.hotel;
  const images: string[] = (h?.images || []).filter(Boolean);
  const activeImg = images[photoIdx] || images[0];

  // Sheet heights — peek shows just the tab strip + a sliver of content
  // (photo stays full-screen behind the translucent glass at all times).
  const sheetHeights: Record<typeof sheetState, string> = {
    peek: "30vh",
    mid:  "55vh",
    full: "92vh",
  };

  const slideKey: SlideKey = SLIDES[slideIdx];

  return (
    <div
      className="fixed inset-0 bg-black overflow-hidden select-none"
      style={{ WebkitUserSelect: "none" }}
    >
      <style>{`
        @keyframes kenBurns {
          0%   { transform: scale(1.02) translate(0,0); }
          50%  { transform: scale(1.14) translate(-2%,-1.5%); }
          100% { transform: scale(1.02) translate(0,0); }
        }
        @keyframes heroFade { from { opacity: 0; } to { opacity: 1; } }
        @keyframes slideIn { from { opacity: 0; transform: translateX(14px); } to { opacity: 1; transform: translateX(0); } }
        @keyframes sheetUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
        @keyframes hintPulse { 0%,100% { opacity: .55; transform: translateY(0);} 50% { opacity: 1; transform: translateY(-4px);} }
        .kb-img { animation: heroFade 0.7s ease-out, kenBurns 10s ease-in-out infinite; will-change: transform, opacity; }
        .slide-in { animation: slideIn 0.3s ease-out both; }
        .sheet-up { animation: sheetUp 0.3s cubic-bezier(0.3,1,0.3,1) both; }
        .hint-bob { animation: hintPulse 1.8s ease-in-out infinite; }
        .glass { backdrop-filter: blur(14px) saturate(1.4); -webkit-backdrop-filter: blur(14px) saturate(1.4); }
        .sheet-scroll::-webkit-scrollbar { width: 3px; }
        .sheet-scroll::-webkit-scrollbar-thumb { background: rgba(240,180,41,0.3); border-radius: 3px; }
      `}</style>

      {/* ── Top chrome: ONE toggle (Compare) mirroring navbar chip language ── */}
      <div className="absolute top-0 left-0 right-0 z-40 flex items-center justify-between px-4 pt-3 pb-6 bg-gradient-to-b from-black/60 to-transparent pointer-events-none">
        <Link
          href="/hotels?from=discover"
          onClick={() => track("mode_toggle", { meta: { to: "list" } })}
          className="pointer-events-auto glass flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-[0.72rem] font-semibold transition-transform active:scale-95"
          style={{
            background: "linear-gradient(135deg, rgba(240,180,41,0.22), rgba(240,180,41,0.05))",
            border: "1px solid rgba(240,180,41,0.45)",
            color: "#f0b429",
            boxShadow: "0 2px 8px rgba(201,145,26,0.2), inset 0 1px 0 rgba(255,255,255,0.22)",
          }}
        >
          <span>☰</span>
          <span>Compare</span>
        </Link>
        <div className="pointer-events-auto flex items-center gap-1.5">
          <span className="text-[0.58rem] font-bold tracking-[0.3em] uppercase text-white/70">StayBid</span>
          <span className="text-white/30 text-xs">·</span>
          <span className="text-[0.58rem] font-bold tracking-widest uppercase text-gold-300">Explore</span>
        </div>
      </div>

      {loading && items.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-10 h-10 border-2 border-gold-400 border-t-transparent rounded-full animate-spin" />
        </div>
      )}
      {!loading && items.length === 0 && (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6">
          <span className="text-5xl mb-3">🏔️</span>
          <p className="text-white font-semibold mb-3">No hotels yet</p>
          <Link href="/hotels" className="px-4 py-2 rounded-full bg-gold-400 text-black font-semibold text-sm">Go to Compare</Link>
        </div>
      )}

      {h && (
        <div key={h.id} className="absolute inset-0">
          {/* ── HERO zone (swipe surface for hotel + slide nav) ── */}
          <div
            className="absolute inset-0"
            style={{ touchAction: "none" }}
            onTouchStart={onHeroTouchStart}
            onTouchEnd={onHeroTouchEnd}
          >
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
            <div className="absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-black/60 to-transparent" />
            <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-black/80 to-transparent" />
          </div>

          {/* ── Photo progress pips (stories style) ── */}
          {images.length > 1 && (
            <div className="absolute top-[52px] left-4 right-4 z-20 flex gap-1 pointer-events-none">
              {images.slice(0, 6).map((_, i) => (
                <div key={i} className="flex-1 h-[2px] bg-white/25 rounded-full overflow-hidden">
                  <div className={`h-full bg-white transition-all duration-300 ${i < photoIdx ? "w-full" : i === photoIdx ? "w-full" : "w-0"}`} />
                </div>
              ))}
            </div>
          )}

          {/* ── Hotel pip rail (vertical) ── */}
          <div className="absolute top-24 right-2 flex flex-col gap-1 z-20 pointer-events-none">
            {items.slice(0, 8).map((_, i) => (
              <span key={i} className={`w-[3px] h-3 rounded-full ${i === hotelIdx ? "bg-gold-400" : "bg-white/25"}`} />
            ))}
          </div>

          {/* ── Big hotel name overlay on hero (above sheet) ── */}
          <div
            className="absolute left-5 right-5 z-20 pointer-events-none"
            style={{ bottom: `calc(${sheetHeights[sheetState]} + 14px)`, transition: "bottom 0.3s cubic-bezier(0.3,1,0.3,1)" }}
          >
            <div className="flex items-center gap-1.5 mb-1 flex-wrap">
              {h.trustBadge && <span className="text-[0.5rem] font-bold px-1.5 py-0.5 rounded-full bg-gold-500/95 text-black">✓</span>}
              {current.exploration && <span className="text-[0.5rem] font-bold px-1.5 py-0.5 rounded-full bg-purple-500/90 text-white">✨ NEW</span>}
              {h.starRating && <span className="text-[0.62rem] text-gold-300 font-bold">{"★".repeat(h.starRating)}</span>}
              {h.avgRating > 0 && <span className="text-[0.6rem] font-bold text-white glass bg-white/10 px-1.5 py-0.5 rounded-full">★ {h.avgRating.toFixed(1)}</span>}
            </div>
            <h2 className="font-display font-light text-white text-[1.8rem] leading-tight drop-shadow-lg">{h.name}</h2>
            <p className="text-white/75 text-[0.72rem] drop-shadow">📍 {h.city}{h.state ? `, ${h.state}` : ""}</p>
            {showHint && hotelIdx === 0 && (
              <div className="mt-2 flex items-center gap-3 text-white/60 text-[0.58rem]">
                <span className="hint-bob">↑ Swipe for next</span>
                <span className="hint-bob">→ Swipe for details</span>
              </div>
            )}
          </div>

          {/* ── Swipe-up action FAB (bottom center, always visible) ── */}
          <button
            onClick={() => setActionOpen(true)}
            className="absolute left-1/2 -translate-x-1/2 z-40 pointer-events-auto glass flex items-center gap-1.5 px-4 py-2 rounded-full text-[0.72rem] font-semibold transition-transform active:scale-95"
            style={{
              bottom: `calc(${sheetHeights[sheetState]} - 22px)`,
              transition: "bottom 0.3s cubic-bezier(0.3,1,0.3,1)",
              background: "linear-gradient(135deg, rgba(240,180,41,0.92), rgba(201,145,26,0.88))",
              color: "#0a0f23",
              boxShadow: "0 8px 24px -4px rgba(240,180,41,0.6), inset 0 1px 0 rgba(255,255,255,0.3)",
              border: "1px solid rgba(255,255,255,0.25)",
            }}
          >
            <span>⬆</span>
            <span>Book · Bid</span>
          </button>

          {/* ════════════════════════════════════════════════════════ */}
          {/* ── BOTTOM SHEET (scrollable, draggable) ── */}
          {/* ════════════════════════════════════════════════════════ */}
          <div
            className="absolute bottom-0 left-0 right-0 z-30 sheet-up"
            style={{
              height: sheetHeights[sheetState],
              transition: "height 0.3s cubic-bezier(0.3,1,0.3,1), background 0.3s ease",
              // Truly translucent glass — hotel photo stays visible behind.
              // Slightly more opacity in the "full" state for readability.
              background:
                sheetState === "full"
                  ? "linear-gradient(180deg, rgba(8,6,14,0.55) 0%, rgba(8,6,14,0.78) 30%, rgba(8,6,14,0.85) 100%)"
                  : "linear-gradient(180deg, rgba(8,6,14,0.20) 0%, rgba(8,6,14,0.45) 60%, rgba(8,6,14,0.62) 100%)",
              backdropFilter: "blur(28px) saturate(1.5)",
              WebkitBackdropFilter: "blur(28px) saturate(1.5)",
              borderTopLeftRadius: "28px",
              borderTopRightRadius: "28px",
              borderTop: "1px solid rgba(240,180,41,0.30)",
              boxShadow: "0 -20px 50px rgba(0,0,0,0.45)",
            }}
          >
            {/* Drag handle */}
            <div
              className="pt-2 pb-1 flex justify-center cursor-grab active:cursor-grabbing"
              onTouchStart={onSheetHandleStart}
              onTouchEnd={onSheetHandleEnd}
              onClick={() => setSheetState((s) => s === "peek" ? "mid" : s === "mid" ? "full" : "peek")}
              style={{ touchAction: "none" }}
            >
              <div className="w-12 h-1 rounded-full bg-white/30" />
            </div>

            {/* Tab row */}
            <div
              className="px-4 flex items-center gap-1 overflow-x-auto no-scrollbar"
              onTouchStart={onSheetTouchStart}
              onTouchEnd={onSheetTouchEnd}
            >
              {SLIDES.map((s, i) => (
                <button
                  key={s}
                  onClick={() => setSlideIdx(i)}
                  className={`px-3 py-1.5 rounded-full text-[0.68rem] font-semibold whitespace-nowrap transition-all ${
                    i === slideIdx
                      ? "bg-gold-400 text-black"
                      : "bg-white/8 text-white/70 border border-white/15"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>

            {/* Scrollable slide content — native vertical scroll */}
            <div
              className="sheet-scroll overflow-y-auto overflow-x-hidden slide-in"
              key={slideKey}
              style={{
                height: `calc(${sheetHeights[sheetState]} - 80px)`,
                paddingBottom: "32px",
                touchAction: "pan-y",
                WebkitOverflowScrolling: "touch",
              }}
              onTouchStart={onSheetTouchStart}
              onTouchEnd={onSheetTouchEnd}
            >
              <div className="px-5 pt-4">
                {slideKey === "Overview" && (
                  <div className="space-y-4">
                    <div className="flex items-end gap-3">
                      <div>
                        <p className="text-white/50 text-[0.55rem] uppercase tracking-widest">Starting</p>
                        <p className="text-white font-bold text-2xl leading-none">
                          ₹{(h.minPrice || 0).toLocaleString()}
                          <span className="text-white/50 text-[0.7rem] font-normal ml-1">/night</span>
                        </p>
                      </div>
                      {current.reasons?.length > 0 && (
                        <div className="flex flex-wrap gap-1 flex-1 justify-end">
                          {current.reasons.slice(0, 2).map((r, i) => (
                            <span key={i} className="text-[0.56rem] font-semibold px-2 py-0.5 rounded-full bg-gold-400/15 text-gold-300 border border-gold-400/25">{r}</span>
                          ))}
                        </div>
                      )}
                    </div>
                    {h.description && (
                      <p className="text-white/70 text-[0.82rem] leading-relaxed">{h.description}</p>
                    )}
                    <div className="grid grid-cols-3 gap-2">
                      {(h.amenities || []).slice(0, 6).map((a: string) => (
                        <div key={a} className="rounded-xl bg-white/5 border border-white/10 px-2 py-2 text-center">
                          <p className="text-white/80 text-[0.68rem] font-medium truncate">{a}</p>
                        </div>
                      ))}
                    </div>
                    <div className="pt-2 border-t border-white/10">
                      <p className="text-white/50 text-[0.58rem] uppercase tracking-widest mb-2">Why this hotel</p>
                      <ul className="space-y-1.5">
                        {[
                          "Real-time availability — live room vacancy",
                          "Price protection — lowest vs all OTAs",
                          "Verified stays — every review is real",
                          "Instant bid acceptance — auto-confirmed in seconds",
                        ].map((r) => (
                          <li key={r} className="text-white/75 text-[0.78rem] flex items-start gap-2">
                            <span className="text-gold-400 mt-0.5">✦</span>
                            <span>{r}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}

                {slideKey === "Amenities" && (
                  <div>
                    <p className="text-white/50 text-[0.58rem] uppercase tracking-widest mb-3">All amenities</p>
                    <div className="grid grid-cols-2 gap-2">
                      {(h.amenities?.length ? h.amenities : ["WiFi","AC","Hot Water","Parking","Room Service","24/7 Reception"]).map((a: string) => (
                        <div key={a} className="flex items-center gap-2 rounded-xl bg-white/5 border border-white/10 px-3 py-2.5">
                          <span className="text-gold-400 text-sm">✓</span>
                          <span className="text-white/85 text-[0.78rem]">{a}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {slideKey === "Rooms" && (
                  <div>
                    <p className="text-white/50 text-[0.58rem] uppercase tracking-widest mb-3">Room categories</p>
                    <div className="space-y-2.5">
                      {(h.rooms || []).map((r: any) => (
                        <div key={r.id} className="rounded-2xl bg-white/5 border border-white/10 p-3">
                          <div className="flex items-center justify-between gap-3 mb-1.5">
                            <div>
                              <p className="text-white font-semibold text-[0.9rem] leading-tight">{r.name || r.type}</p>
                              <p className="text-white/50 text-[0.66rem]">Up to {r.capacity || 2} guests</p>
                            </div>
                            <div className="text-right shrink-0">
                              {r.mrp && r.mrp > r.floorPrice && (
                                <p className="text-white/40 text-[0.62rem] line-through">₹{r.mrp.toLocaleString()}</p>
                              )}
                              <p className="text-gold-300 font-bold text-[0.95rem] leading-none">₹{(r.floorPrice || 0).toLocaleString()}</p>
                              <p className="text-white/40 text-[0.58rem]">per night</p>
                            </div>
                          </div>
                          {r.description && <p className="text-white/60 text-[0.72rem] leading-relaxed mb-1.5">{r.description}</p>}
                          {r.amenities?.length > 0 && (
                            <div className="flex flex-wrap gap-1">
                              {r.amenities.slice(0, 5).map((a: string) => (
                                <span key={a} className="text-[0.56rem] px-1.5 py-0.5 rounded-full bg-white/8 border border-white/10 text-white/70">{a}</span>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                      {(!h.rooms || h.rooms.length === 0) && (
                        <p className="text-white/50 text-sm">Room data loads on the full hotel page.</p>
                      )}
                    </div>
                  </div>
                )}

                {slideKey === "Reviews" && (
                  <div>
                    <div className="flex items-center gap-3 mb-3">
                      <span className="text-gold-300 text-2xl font-bold">★ {(h.avgRating || 4.7).toFixed(1)}</span>
                      <p className="text-white/60 text-[0.68rem]">Based on {h.totalReviews || FAKE_REVIEWS.length * 40} verified stays</p>
                    </div>
                    <div className="space-y-2.5">
                      {FAKE_REVIEWS.map((rv, i) => (
                        <div key={i} className="rounded-2xl bg-white/5 border border-white/10 p-3">
                          <div className="flex items-center justify-between mb-1.5">
                            <div className="flex items-center gap-2">
                              <div className="w-7 h-7 rounded-full flex items-center justify-center text-black text-[0.65rem] font-bold"
                                style={{ background: "linear-gradient(135deg,#f0b429,#c9911a)" }}>
                                {rv.name.slice(0, 1)}
                              </div>
                              <div>
                                <p className="text-white text-[0.72rem] font-semibold leading-none">{rv.name}</p>
                                <p className="text-white/40 text-[0.56rem] mt-0.5">Verified stay</p>
                              </div>
                            </div>
                            <span className="text-gold-300 text-[0.66rem]">{"★".repeat(rv.rating)}</span>
                          </div>
                          <p className="text-white/75 text-[0.78rem] leading-relaxed">"{rv.text}"</p>
                        </div>
                      ))}
                      <p className="text-center text-white/40 text-[0.65rem] py-2">— End of reviews —</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ════════════════════════════════════════════════════════ */}
          {/* ── ACTION DRAWER (swipe up popup, mobile-nav style) ── */}
          {/* ════════════════════════════════════════════════════════ */}
          {actionOpen && (
            <>
              <div className="absolute inset-0 z-50 bg-black/70 backdrop-blur-sm" onClick={() => setActionOpen(false)} />
              <div
                className="absolute bottom-0 left-0 right-0 z-50 sheet-up"
                style={{
                  background: "linear-gradient(180deg,#12101c,#0a0812)",
                  borderTopLeftRadius: "28px",
                  borderTopRightRadius: "28px",
                  borderTop: "1px solid rgba(240,180,41,0.35)",
                  boxShadow: "0 -20px 60px rgba(0,0,0,0.7)",
                }}
              >
                <div className="flex justify-center pt-3 pb-1">
                  <div className="w-12 h-1 rounded-full bg-white/30" />
                </div>
                <div className="px-5 py-4">
                  <p className="text-white font-semibold text-sm leading-tight">{h.name}</p>
                  <p className="text-white/50 text-[0.68rem]">📍 {h.city} · ₹{(h.minPrice || 0).toLocaleString()}/night</p>
                </div>

                <div className="px-4 pb-4 grid grid-cols-2 gap-2.5">
                  <button
                    onClick={() => {
                      track("click_book", { hotelId: h.id });
                      setActionOpen(false);
                      router.push(`/hotels/${h.id}?intent=book#availability-picker`);
                    }}
                    className="flex flex-col items-center gap-1 py-4 rounded-2xl text-black font-bold active:scale-95 transition-transform"
                    style={{
                      background: "linear-gradient(135deg,#f0b429,#c9911a)",
                      boxShadow: "0 8px 20px -4px rgba(240,180,41,0.5), inset 0 1px 0 rgba(255,255,255,0.3)",
                    }}
                  >
                    <span className="text-xl">⚡</span>
                    <span className="text-[0.82rem]">Book Now</span>
                  </button>

                  <button
                    onClick={() => {
                      track("click_bid", { hotelId: h.id, meta: { intent: "negotiate" } });
                      setActionOpen(false);
                      // Open the hotel page focused on the availability picker;
                      // ?intent=negotiate makes the page auto-open the Negotiate
                      // modal once dates are selected.
                      router.push(`/hotels/${h.id}?intent=negotiate#availability-picker`);
                    }}
                    className="flex flex-col items-center gap-1 py-4 rounded-2xl text-white font-bold active:scale-95 transition-transform"
                    style={{
                      background: "linear-gradient(135deg, rgba(240,180,41,0.18), rgba(240,180,41,0.06))",
                      border: "1px solid rgba(240,180,41,0.45)",
                      color: "#f0b429",
                    }}
                  >
                    <span className="text-xl">💬</span>
                    <span className="text-[0.82rem]">Negotiate</span>
                  </button>

                  <button
                    onClick={() => {
                      track("swipe_detail", { hotelId: h.id, meta: { to: "full" } });
                      setActionOpen(false);
                      router.push(`/hotels/${h.id}`);
                    }}
                    className="flex flex-col items-center gap-1 py-4 rounded-2xl text-white/85 font-semibold active:scale-95 transition-transform border border-white/15"
                    style={{ background: "rgba(255,255,255,0.04)" }}
                  >
                    <span className="text-xl">🏨</span>
                    <span className="text-[0.78rem]">Full Details</span>
                  </button>

                  <button
                    onClick={() => {
                      setActionOpen(false);
                      if (typeof navigator !== "undefined" && (navigator as any).share) {
                        (navigator as any).share({
                          title: h.name,
                          text: `Check out ${h.name} on StayBid — from ₹${(h.minPrice || 0).toLocaleString()}/night`,
                          url: `${window.location.origin}/hotels/${h.id}`,
                        }).catch(() => {});
                      }
                    }}
                    className="flex flex-col items-center gap-1 py-4 rounded-2xl text-white/85 font-semibold active:scale-95 transition-transform border border-white/15"
                    style={{ background: "rgba(255,255,255,0.04)" }}
                  >
                    <span className="text-xl">↗</span>
                    <span className="text-[0.78rem]">Share</span>
                  </button>
                </div>

                <div style={{ height: "env(safe-area-inset-bottom, 6px)" }} />
              </div>
            </>
          )}
        </div>
      )}

      {/* ════════════════════════════════════════════════════════ */}
      {/* ── FIRST-VISIT ONBOARDING OVERLAY (shown ONCE, ever) ── */}
      {/* ════════════════════════════════════════════════════════ */}
      {showOnboarding && (
        <div
          className="absolute inset-0 z-[60] flex items-end justify-center"
          style={{ background: "rgba(4,2,10,0.78)", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)" }}
          onClick={dismissOnboarding}
        >
          <div
            className="w-full max-w-md mx-4 mb-8 rounded-3xl p-6 sheet-up"
            style={{
              background: "linear-gradient(180deg,#1a1530,#0a0816)",
              border: "1px solid rgba(240,180,41,0.45)",
              boxShadow: "0 -10px 40px rgba(240,180,41,0.18), 0 20px 60px rgba(0,0,0,0.7)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 mb-4">
              <span className="text-2xl">✨</span>
              <h3 className="font-display font-light text-white text-xl">Welcome to Discovery</h3>
            </div>
            <p className="text-white/70 text-[0.82rem] mb-5 leading-relaxed">
              A reels-style way to find your next stay. Three gestures, that's it:
            </p>
            <div className="space-y-3 mb-5">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full flex items-center justify-center text-lg shrink-0"
                  style={{ background: "rgba(240,180,41,0.18)", border: "1px solid rgba(240,180,41,0.45)" }}>↑</div>
                <div>
                  <p className="text-white text-[0.85rem] font-semibold leading-tight">Swipe up</p>
                  <p className="text-white/55 text-[0.7rem]">Next hotel</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full flex items-center justify-center text-lg shrink-0"
                  style={{ background: "rgba(240,180,41,0.18)", border: "1px solid rgba(240,180,41,0.45)" }}>→</div>
                <div>
                  <p className="text-white text-[0.85rem] font-semibold leading-tight">Swipe right</p>
                  <p className="text-white/55 text-[0.7rem]">Amenities · Rooms · Reviews</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full flex items-center justify-center text-lg shrink-0"
                  style={{ background: "rgba(240,180,41,0.18)", border: "1px solid rgba(240,180,41,0.45)" }}>⬆</div>
                <div>
                  <p className="text-white text-[0.85rem] font-semibold leading-tight">Tap the gold pill</p>
                  <p className="text-white/55 text-[0.7rem]">Book · Bid · Open full hotel</p>
                </div>
              </div>
            </div>
            <button
              onClick={dismissOnboarding}
              className="w-full py-3 rounded-2xl text-black font-bold text-sm active:scale-[0.98] transition-transform"
              style={{
                background: "linear-gradient(135deg,#f0b429,#c9911a)",
                boxShadow: "0 8px 20px -4px rgba(240,180,41,0.5), inset 0 1px 0 rgba(255,255,255,0.3)",
              }}
            >
              Got it — start exploring
            </button>
            <p className="text-center text-white/35 text-[0.6rem] mt-3">Tap anywhere to dismiss</p>
          </div>
        </div>
      )}
    </div>
  );
}
