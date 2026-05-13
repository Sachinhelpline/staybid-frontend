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
import { useRouter, usePathname } from "next/navigation";
import { track, getSignals, initTracking, markViewed } from "@/lib/track";
import { useReelFullscreen } from "@/lib/useReelFullscreen";
// v107 — switched from `next/dynamic` to a static import. The dynamic
// version was adding a real JS-chunk waterfall on cold start: page.js
// finished → THEN browser started fetching the feed chunk → THEN render.
// On mid-tier Android over 3G that's ~250–400 ms of nothing. Static
// import merges the feed into the route chunk so paint and feed mount
// race the network for the data, not for the JS. The component is
// gated by `items.length > 0` below so SSR boundary is unaffected.
import InstagramHotelFeed from "@/components/discover/InstagramHotelFeed";

// idle() — schedule work for after first paint without blocking it.
// requestIdleCallback isn't on Safari; the 1-tick timeout fallback is
// good enough for "after first paint" semantics on every browser we ship.
const idle = (cb: () => void) => {
  if (typeof window === "undefined") return;
  const w: any = window;
  if (typeof w.requestIdleCallback === "function") w.requestIdleCallback(cb, { timeout: 1500 });
  else setTimeout(cb, 50);
};

type Item = { hotel: any; score: number; reasons: string[]; exploration?: boolean };

export default function DiscoverPage() {
  const [items, setItems]       = useState<Item[]>([]);
  const [loading, setLoading]   = useState(true);
  const [hotelIdx, setHotelIdx] = useState(0);
  const pathname = usePathname() || "/";
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

    // Helper: Fisher-Yates shuffle so siblings reorder per request.
    const shuffle = <T,>(arr: T[]): T[] => {
      const a = arr.slice();
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    };

    // ── Fire both feeds in PARALLEL (was sequential; that doubled cold-
    //    start wait by ~300 ms because social/feed had to finish before
    //    discover/feed even started). Promise.all lets the browser open
    //    both connections simultaneously and use the slower of the two as
    //    the total wait.
    const socialPromise = fetch("/api/social/feed?limit=30").then(
      (r) => (r.ok ? r.json() : null),
      () => null,
    );
    const discoverPromise = fetch("/api/discover/feed", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(tok ? { Authorization: `Bearer ${tok}` } : {}) },
      body: JSON.stringify({ limit: 30, signals: safeSig }),
    }).then(
      (r) => (r.ok ? r.json() : null),
      () => null,
    );
    const [sd, d] = await Promise.all([socialPromise, discoverPromise]);

    let publicItems: Item[] = [];
    if (sd && Array.isArray(sd?.posts)) publicItems = sd.posts.map(socialPostToItem);

    // Primary: ranked discover feed
    try {
      if (d) {
        if (Array.isArray(d?.items) && d.items.length > 0) {
          // Public posts shuffled per session (was always newest-first → same
          // reel showed on every refresh). Ranked discover items keep their
          // server-side scoring + jitter from /api/discover/feed.
          // Then we interleave + pick a random START so the first card the
          // user sees is different on every open — Instagram-style "fresh
          // feed".
          const shuffledPublic = shuffle(publicItems);
          const merged = [...shuffledPublic, ...d.items];
          const startAt = merged.length > 5 ? Math.floor(Math.random() * Math.min(merged.length - 3, 8)) : 0;
          const rotated = startAt > 0 ? [...merged.slice(startAt), ...merged.slice(0, startAt)] : merged;
          setItems(rotated);
          setLoading(false);
          return;
        }
      }
    } catch {}

    // Fallback: plain hotels list mapped into Item shape — bulletproof against
    // cold backend / stale SW / network hiccup. Pulls active flash deals so
    // /discover and /hotels never disagree on the displayed "starting from"
    // price. Flash-deals fallback now respects `sb_city` so the home page
    // surfaces only the right inventory when the user has picked a location.
    const city = typeof window !== "undefined" ? (localStorage.getItem("sb_city") || "") : "";
    const flashUrl = "/api/flash/near" + (city && city !== "all" ? `?city=${encodeURIComponent(city)}` : "");
    try {
      const [r2, fr] = await Promise.all([
        fetch("/api/hotels?limit=30",   { cache: "no-store" }),
        fetch(flashUrl,                 { cache: "no-store" }).catch(() => null),
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
      // Same per-session rotation as the primary path.
      const shuffledPublic = shuffle(publicItems);
      const shuffledMapped = shuffle(mapped);
      const merged = [...shuffledPublic, ...shuffledMapped];
      const startAt = merged.length > 5 ? Math.floor(Math.random() * Math.min(merged.length - 3, 8)) : 0;
      const rotated = startAt > 0 ? [...merged.slice(startAt), ...merged.slice(0, startAt)] : merged;
      setItems(rotated);
    } catch {
      setItems(shuffle(publicItems));  // even if hotels fetch failed, show public posts
    } finally {
      setLoading(false);
    }
  }, [myUserId]);

  useEffect(() => {
    // v107 — fetch the feed FIRST. Tracking + analytics are nice-to-have
    // and would otherwise compete with the only thing the user cares
    // about (seeing the first card). Defer them to the idle window.
    loadFeed();
    idle(() => {
      initTracking();
      track("app_open", { meta: { mode: "discover_reels" } });
    });
    // Re-pull when the user picks a new location anywhere — globe picker
    // in the rail filter sheet OR the navbar globe both fire this event.
    const onCity = () => loadFeed();
    if (typeof window !== "undefined") {
      window.addEventListener("sb:city-change", onCity);
      return () => window.removeEventListener("sb:city-change", onCity);
    }
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
  // v107: deferred to idle so it never competes with the home-feed paint.
  const router = useRouter();
  useEffect(() => {
    idle(() => { try { router.prefetch("/hotels"); } catch {} });
  }, [router]);

  return (
    <div
      className="fixed inset-0 bg-black overflow-hidden select-none"
      // Belt-and-braces: even if the body class lock is somehow stripped
      // by a third-party script, this inline fixed-inset-0 + visualViewport
      // height keeps the reel feed pinned to the full visible viewport.
      style={{ WebkitUserSelect: "none", height: "var(--reel-vh, 100dvh)", width: "100vw" }}
    >
      {/* v88 — Premium cozy brand wordmark, restored after v87 removal.
          • Position: top-LEFT (clears the filter chip at top-RIGHT)
          • Style: Cormorant Garamond italic — matches the rest of the
            cozy luxury system (Flash Deals rail title, /me drawer)
          • Color: cocoa on `/` (sits over the cream Flash Deals rail —
            needs dark text for contrast). Cream on `/discover` (sits
            over dark video — needs light text + shadow).
          • Profile chip below now starts at top:38 (was 14) so the
            brand never collides with the @handle row (screenshot 2 was
            the v85 overlap; this design solves it without dropping the
            brand entirely). */}
      {/* v89 — Brand wordmark only on /discover (over dark video). On `/`
          home the Flash Deals rail's own italic "Flash Deals" header already
          serves as the cozy brand presence — having both at top-left was
          colliding. Single source of brand on each surface. */}
      {pathname !== "/" && (
        <div
          className="reel-brand-chrome absolute left-0 right-0 z-40 flex items-center justify-start px-4 pointer-events-none"
          style={{ top: "calc(env(safe-area-inset-top, 0px) + 8px)" }}
        >
          <span
            className="pointer-events-auto select-none"
            style={{
              fontFamily: '"Cormorant Garamond", "Georgia", serif',
              fontStyle: "italic",
              fontWeight: 600,
              fontSize: "0.95rem",
              letterSpacing: "0.01em",
              lineHeight: 1,
              color: "var(--cozy-cream-100)",
              textShadow: "0 1px 6px rgba(0, 0, 0, 0.45)",
            }}
            aria-label="StayBid"
          >
            stay<span style={{ color: "var(--cozy-champagne-light)" }}>·</span>bid
          </span>
        </div>
      )}

      {/* Compare chip retired in v80 — /hotels is now in the BottomDock,
          and the chip was overlapping the flash-deal viewer on every tap. */}

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

      {/* Reels feed — rail visibility splits by route:
          • /          (home) → flash-deal rail visible (entry point that
                                showcases inventory the user might miss)
          • /discover  (Reels tab) → reel-only, no rail (matches IG Reels
                                pattern where the dedicated Reels surface
                                doesn't show stories) */}
      {items.length > 0 && (
        <div className="absolute inset-0 z-10">
          <InstagramHotelFeed
            items={items as any}
            onIndexChange={setHotelIdx}
            onLoadMore={loadFeed}
            onTrackEvent={(name, payload) => track(name as any, payload)}
            showFlashDealRail={pathname === "/"}
          />
        </div>
      )}
    </div>
  );
}
