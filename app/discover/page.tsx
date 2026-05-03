"use client";
// ═══════════════════════════════════════════════════════════════════════════
// Discovery — Reels-only mode (Luxury removed May 2026, see git history if
// it ever needs to come back).
// Renders the Instagram-style hotel feed full-screen. The legacy luxury
// Ken-Burns + bottom-sheet UI was removed from this file; the component lives
// at components/discover/InstagramHotelFeed.tsx.
// ═══════════════════════════════════════════════════════════════════════════
import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { track, getSignals, initTracking, markViewed } from "@/lib/track";
import InstagramHotelFeed from "@/components/discover/InstagramHotelFeed";

type Item = { hotel: any; score: number; reasons: string[]; exploration?: boolean };

export default function DiscoverPage() {
  const [items, setItems]       = useState<Item[]>([]);
  const [loading, setLoading]   = useState(true);
  const [hotelIdx, setHotelIdx] = useState(0);
  const dwellStart = useRef<number>(Date.now());

  const loadFeed = useCallback(async () => {
    setLoading(true);
    // Sanitize signals — priceBand can become [Infinity,Infinity] after
    // viewing a hotel with no rooms; some mobile WebViews choke on the
    // resulting JSON. Strip non-finite values defensively.
    const rawSig = getSignals();
    const safeSig: any = { ...rawSig };
    if (Array.isArray(rawSig.priceBand)) {
      const [a, b] = rawSig.priceBand;
      if (!Number.isFinite(a) || !Number.isFinite(b)) delete safeSig.priceBand;
    }
    const tok = typeof window !== "undefined" ? localStorage.getItem("sb_token") : null;

    // Primary: ranked discover feed
    try {
      const r = await fetch("/api/discover/feed", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(tok ? { Authorization: `Bearer ${tok}` } : {}) },
        body: JSON.stringify({ limit: 30, signals: safeSig }),
        cache: "no-store",
      });
      if (r.ok) {
        const d = await r.json();
        if (Array.isArray(d?.items) && d.items.length > 0) {
          setItems(d.items);
          setLoading(false);
          return;
        }
      }
    } catch {}

    // Fallback: plain hotels list mapped into Item shape — bulletproof against
    // cold backend / stale SW / network hiccup. Pulls active flash deals so
    // /discover and /hotels never disagree on the displayed "starting from"
    // price.
    try {
      const [r2, fr] = await Promise.all([
        fetch("/api/hotels?limit=30",   { cache: "no-store" }),
        fetch("/api/flash/near",        { cache: "no-store" }).catch(() => null),
      ]);
      const d2 = await r2.json();
      const fd = fr ? await fr.json().catch(() => ({})) : {};
      const dealsByHotel: Record<string, any[]> = {};
      for (const d of (fd?.deals || [])) (dealsByHotel[d.hotelId] ||= []).push(d);

      const hotels = Array.isArray(d2?.hotels) ? d2.hotels : [];
      const mapped: Item[] = hotels.map((h: any) => {
        const flashMin = (dealsByHotel[h.id] || []).length
          ? Math.min(...dealsByHotel[h.id].map((d: any) => d.aiPrice ?? d.dealPrice ?? Infinity))
          : Infinity;
        const roomMin = h.rooms?.length
          ? Math.min(...h.rooms.map((r: any) => r.floorPrice || 99999))
          : Infinity;
        const minPrice = Math.min(flashMin, roomMin);
        return {
          hotel: {
            ...h,
            minPrice: minPrice === Infinity ? null : minPrice,
            flashDeals: dealsByHotel[h.id] || [],
          },
          score: 0, reasons: [],
        };
      });
      setItems(mapped);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    initTracking();
    track("app_open", { meta: { mode: "discover_reels" } });
    loadFeed();
  }, [loadFeed]);

  // Record hotel_view + markViewed when active card changes
  useEffect(() => {
    const it = items[hotelIdx];
    if (!it) return;
    dwellStart.current = Date.now();
    const h = it.hotel;
    const minPrice = h.minPrice ?? (h.rooms?.length ? Math.min(...h.rooms.map((r: any) => r.floorPrice || 99999)) : undefined);
    track("hotel_view", { hotelId: h.id, meta: { city: h.city, minPrice, amenities: h.amenities || [] } });
    markViewed(h.id, h.city, minPrice, h.amenities || []);
  }, [hotelIdx, items]);

  // Try to hide mobile browser chrome (URL bar + share/menu) on first touch.
  // Fullscreen API only works after a user gesture; iOS Safari ignores it for
  // non-video elements, but Android Chrome/Firefox honour it. Best-effort.
  const fullscreenAsked = useRef(false);
  const tryFullscreen = useCallback(() => {
    if (fullscreenAsked.current) return;
    fullscreenAsked.current = true;
    try {
      const el: any = document.documentElement;
      const req = el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen || el.msRequestFullscreen;
      if (req) req.call(el).catch(() => {});
    } catch {}
  }, []);

  return (
    <div
      className="fixed inset-0 bg-black overflow-hidden select-none"
      style={{ WebkitUserSelect: "none" }}
      onTouchStartCapture={tryFullscreen}
      onClickCapture={tryFullscreen}
    >
      {/* Top branding chrome (Reels-only). Compare moved to bottom-right
          floating button so it doesn't overlap the hotel profile chip. */}
      <div className="absolute top-0 left-0 right-0 z-40 flex items-center justify-center px-4 pt-3 pb-3 bg-gradient-to-b from-black/55 to-transparent pointer-events-none">
        <div className="pointer-events-auto flex items-center gap-1.5">
          <span className="text-[0.58rem] font-bold tracking-[0.3em] uppercase text-white/70">StayBid</span>
          <span className="text-white/30 text-xs">·</span>
          <span
            className="text-[0.58rem] font-bold tracking-widest uppercase"
            style={{ background: "linear-gradient(135deg,#ff458d,#b964ff)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}
          >
            Reels
          </span>
        </div>
      </div>

      {/* Compare floating chip — TOP-RIGHT corner. Sits above the right
          action rail (which starts at bottom:180px) and clear of the hotel
          profile chip (which is at top:60px on the LEFT side). */}
      <Link
        href="/hotels"
        className="absolute z-40 flex items-center gap-1 px-2.5 py-1.5 rounded-full text-[0.62rem] font-bold transition-transform active:scale-95"
        style={{
          right: "12px",
          top: "10px",
          background: "linear-gradient(135deg, rgba(240,180,41,0.28), rgba(240,180,41,0.08))",
          border: "1px solid rgba(240,180,41,0.5)",
          color: "#ffd76b",
          backdropFilter: "blur(14px) saturate(1.4)",
          WebkitBackdropFilter: "blur(14px) saturate(1.4)",
          boxShadow: "0 4px 12px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.22)",
        }}
        aria-label="Switch to hotel comparison view"
      >
        <span>☰</span>
        <span>Compare</span>
      </Link>

      {/* Loading + empty states */}
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

      {/* Reels feed */}
      {items.length > 0 && (
        <div className="absolute inset-0 z-10">
          <InstagramHotelFeed
            items={items as any}
            onIndexChange={setHotelIdx}
            onLoadMore={loadFeed}
            onTrackEvent={(name, payload) => track(name as any, payload)}
          />
        </div>
      )}
    </div>
  );
}
