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
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { track, getSignals, initTracking, markViewed } from "@/lib/track";
import { useReelFullscreen } from "@/lib/useReelFullscreen";

// Heavy ~2300-line component — dynamic-import keeps the initial bundle small
// so cold-start render of the topbar + loading spinner is faster.
const InstagramHotelFeed = dynamic(() => import("@/components/discover/InstagramHotelFeed"), {
  ssr: false,
  loading: () => null, // page already shows its own loading spinner
});

type Item = { hotel: any; score: number; reasons: string[]; exploration?: boolean };

export default function DiscoverPage() {
  const [items, setItems]       = useState<Item[]>([]);
  const [loading, setLoading]   = useState(true);
  const [hotelIdx, setHotelIdx] = useState(0);
  const dwellStart = useRef<number>(Date.now());

  // Decode the current user's id once — used to flag posts as `_isSelf`
  // when the social_posts row was authored by them.
  const myUserId = (() => {
    if (typeof window === "undefined") return "";
    try {
      const t = localStorage.getItem("sb_token") || "";
      if (!t) return "";
      const p = JSON.parse(atob(t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
      return p.id || p.user_id || p.sub || "";
    } catch { return ""; }
  })();

  // Convert a social_posts row (joined with author + hotel) into the
  // Item shape the InstagramHotelFeed already understands. Public posts
  // — anyone's reels / photos / stories — are merged into the SAME
  // /discover feed so users explore everything in one place.
  const socialPostToItem = (post: any): Item => {
    const a = post.author;
    const isVideo = post.media_type === "REEL" || post.media_type === "STORY";
    const isSelf = !!a?.user_id && a.user_id === myUserId;
    return {
      hotel: {
        id:           post.id,
        name:         a?.display_name || `@${a?.username || "user"}`,
        city:         post.location_name || post.hotel?.city || "",
        state:        post.hotel?.state || "",
        starRating:   post.hotel?.starRating || post.hotel?.star_rating || 0,
        avgRating:    post.hotel?.avgRating || 0,
        rooms:        post.hotel?.rooms || [],
        flashDeals:   [],
        minPrice:     post.hotel?.minPrice ?? null,
        amenities:    post.hotel?.amenities || [],
        description:  post.caption || "",
        videoUrl:     isVideo ? post.media_url : undefined,
        images:       isVideo ? (post.thumbnail_url ? [post.thumbnail_url] : []) : [post.media_url],
        _userPost:    true,
        _isSelf:      isSelf,
        _publicAuthor: a,                          // {username, display_name, user_type, ...}
        _userPostKind: String(post.media_type || "reel").toLowerCase(),
        _userPostMime: "",
        _userPostLocation: post.location_name
          ? { name: post.location_name, lat: post.location_lat, lng: post.location_lng }
          : null,
      } as any,
      score: 0,
      reasons: [a?.user_type === "HOTEL" ? "Verified hotel" : a?.user_type === "CREATOR" ? "Creator" : "Member"],
    };
  };

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

    // ── Pull public posts (everyone's reels) from /api/social/feed.
    // These are the user-uploaded reels / photos / stories that show up
    // alongside hotels in the SAME unified feed at /discover.
    let publicItems: Item[] = [];
    try {
      const sr = await fetch("/api/social/feed?limit=30", { cache: "no-store" });
      if (sr.ok) {
        const sd = await sr.json();
        if (Array.isArray(sd?.posts)) publicItems = sd.posts.map(socialPostToItem);
      }
    } catch {}

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
          // Public user/creator/hotel posts go FIRST — newest content
          // floats to the top so the feed feels alive.
          setItems([...publicItems, ...d.items]);
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
      setItems([...publicItems, ...mapped]);
    } catch {
      setItems(publicItems);  // even if hotels fetch failed, show public posts
    } finally {
      setLoading(false);
    }
  }, [myUserId]);

  useEffect(() => {
    initTracking();
    track("app_open", { meta: { mode: "discover_reels" } });
    loadFeed();
  }, [loadFeed]);

  // Bulletproof reel-page fullscreen: visualViewport-driven height +
  // body class lock + best-effort requestFullscreen on first touch.
  // Replaces the older 100dvh-only approach that was flaky on Android.
  useReelFullscreen();

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

  // Prefetch the Compare destination (/hotels) so the cross-mode swap
  // feels instant — Link prefetches happen on hover/touch by default but
  // the floating chip is the primary path, so warm it up immediately.
  const router = useRouter();
  useEffect(() => {
    try { router.prefetch("/hotels"); } catch {}
  }, [router]);

  return (
    <div
      className="fixed inset-0 bg-black overflow-hidden select-none"
      // Belt-and-braces: even if the body class lock is somehow stripped
      // by a third-party script, this inline fixed-inset-0 + visualViewport
      // height keeps the reel feed pinned to the full visible viewport.
      style={{ WebkitUserSelect: "none", height: "var(--reel-vh, 100dvh)", width: "100vw" }}
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

      {/* Compare floating chip — TOP-RIGHT, slim. Mirror size to the
          filter chip on the left so the top row reads as a balanced trio
          (filter · brand · compare). */}
      <Link
        href="/hotels"
        className="absolute z-40 flex items-center gap-1 px-2 py-1 rounded-full text-[0.58rem] font-bold transition-transform active:scale-95"
        style={{
          right: "10px",
          top: "8px",
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
