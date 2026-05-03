"use client";
// ═══════════════════════════════════════════════════════════════════════════
// Instagram-style Hotel Feed (Phase E — switchable UI mode for /discover)
// ───────────────────────────────────────────────────────────────────────────
// Pixel-faithful Instagram Reels layout, but rendered with hotels in place of
// creators. Features:
//   • Vertical scroll-snap full-screen cards (each card = one hotel)
//   • Ken-Burns photo cross-fade as the looping "video"
//   • Top-LEFT: round profile avatar + hotel name + ✓ verified + Follow chip
//   • Right action rail: ❤️ like, 💬 comment, ↗ share, 🔖 save, ⋯ more
//   • Bottom-LEFT: caption with description + 📍 location + #hashtag chips
//   • Audio strip ("🎵 Original audio · StayBid Live")
//   • Double-tap-to-like with floating heart animation
//   • Live count animations (likes/views tick up)
//   • Followers count + verification — pulled from hotel data
//   • Luxury gold accents preserved (gold rings + verified pill)
//
// Data source: same `items[]` the parent /discover page already fetched.
// All booking/share/track callbacks bubble back up to the parent.
// ═══════════════════════════════════════════════════════════════════════════
import { useEffect, useRef, useState, useCallback, memo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type Item = { hotel: any; score?: number; reasons?: string[]; exploration?: boolean };

type Props = {
  items: Item[];
  onIndexChange?: (idx: number) => void;
  onLoadMore?: () => void;
  onTrackEvent?: (name: string, payload: any) => void;
};

// Synthetic but stable per-hotel social numbers (pure fn of hotel.id) so the
// UI feels populated even if the backend hasn't shipped real likes yet.
function pseudoStat(seed: string, salt: string, min: number, max: number) {
  let h = 0;
  const s = `${seed}::${salt}`;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  const r = Math.abs(h) % (max - min);
  return min + r;
}

function fmtCount(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "K";
  return String(n);
}

function hashtagsFor(h: any): string[] {
  const base: string[] = [];
  if (h.city) base.push(h.city.replace(/\s+/g, ""));
  if (h.state) base.push(h.state.replace(/\s+/g, ""));
  base.push("StayBid");
  base.push("LuxuryStay");
  if (h.starRating >= 5) base.push("FiveStar");
  if ((h.amenities || []).some((a: string) => /pool/i.test(a))) base.push("Poolside");
  if ((h.amenities || []).some((a: string) => /spa/i.test(a))) base.push("Spa");
  return base.slice(0, 5);
}

const HotelCard = memo(function HotelCard({
  item,
  active,
  onTrackEvent,
  onBook,
  onNegotiate,
  onShare,
  onOpenFull,
}: {
  item: Item;
  active: boolean;
  onTrackEvent?: (n: string, p: any) => void;
  onBook: (h: any) => void;
  onNegotiate: (h: any) => void;
  onShare: (h: any) => void;
  onOpenFull: (h: any) => void;
}) {
  const h = item.hotel;
  const images: string[] = (h.images || []).filter(Boolean);
  const [photoIdx, setPhotoIdx] = useState(0);
  const [liked, setLiked] = useState(false);
  const [saved, setSaved] = useState(false);
  const [followed, setFollowed] = useState(false);
  const [bursts, setBursts] = useState<{ id: number; x: number; y: number }[]>([]);
  const [showCaption, setShowCaption] = useState(false);
  const lastTapRef = useRef<{ t: number; x: number; y: number } | null>(null);

  const initialLikes = pseudoStat(h.id || "x", "likes", 1240, 28400);
  const followers = pseudoStat(h.id || "x", "followers", 5800, 184000);
  const views = pseudoStat(h.id || "x", "views", 14000, 580000);
  const comments = pseudoStat(h.id || "x", "comments", 38, 920);
  const [likeCount, setLikeCount] = useState(initialLikes);
  const [viewCount, setViewCount] = useState(views);

  // Auto-advance photo only when active (visible)
  useEffect(() => {
    if (!active || images.length < 2) return;
    const id = setInterval(() => setPhotoIdx((i) => (i + 1) % images.length), 3800);
    return () => clearInterval(id);
  }, [active, images.length]);

  // Tick view count up while watched (cosmetic but feels alive)
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setViewCount((v) => v + Math.floor(Math.random() * 4) + 1), 2200);
    return () => clearInterval(id);
  }, [active]);

  const triggerLike = useCallback((x?: number, y?: number) => {
    setLiked((prev) => {
      if (!prev) setLikeCount((c) => c + 1);
      else setLikeCount((c) => Math.max(0, c - 1));
      return !prev;
    });
    if (x != null && y != null) {
      const id = Date.now() + Math.random();
      setBursts((b) => [...b, { id, x, y }]);
      setTimeout(() => setBursts((b) => b.filter((p) => p.id !== id)), 900);
    }
    onTrackEvent?.("ig_like", { hotelId: h.id });
  }, [h.id, onTrackEvent]);

  const handleDoubleTap = useCallback((e: React.TouchEvent | React.MouseEvent) => {
    const now = Date.now();
    let x = 0, y = 0;
    const anyE = e as any;
    if (anyE.changedTouches?.length || anyE.touches?.length) {
      const t = (anyE.changedTouches && anyE.changedTouches[0]) || (anyE.touches && anyE.touches[0]);
      x = t?.clientX || 0; y = t?.clientY || 0;
    } else {
      x = (e as React.MouseEvent).clientX;
      y = (e as React.MouseEvent).clientY;
    }
    const last = lastTapRef.current;
    if (last && now - last.t < 320 && Math.abs(x - last.x) < 40 && Math.abs(y - last.y) < 40) {
      // Double tap → like burst
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      triggerLike(x - rect.left, y - rect.top);
      lastTapRef.current = null;
    } else {
      lastTapRef.current = { t: now, x, y };
    }
  }, [triggerLike]);

  const activeImg = images[photoIdx];
  const initials = (h.name || "?").split(" ").slice(0, 2).map((s: string) => s[0]).join("").toUpperCase();
  const tags = hashtagsFor(h);
  const description = h.description || `Welcome to ${h.name} — a curated escape in ${h.city || "the hills"}. Real-time bidding. Verified luxury. Book at your price.`;

  return (
    <section
      className="ig-card relative w-full snap-start snap-always overflow-hidden bg-black"
      style={{ height: "100dvh" }}
      onTouchEnd={handleDoubleTap}
      onDoubleClick={handleDoubleTap}
    >
      {/* Background photo (Ken-Burns) */}
      {activeImg ? (
        <img
          key={`${h.id}-${photoIdx}`}
          src={activeImg}
          alt={h.name}
          draggable={false}
          className="ig-kb absolute inset-0 w-full h-full object-cover"
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-7xl opacity-40"
          style={{ background: "linear-gradient(135deg,#1a1530,#0d1a2e)" }}>🏨</div>
      )}

      {/* Top + bottom dark gradients for legibility */}
      <div className="absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-black/70 via-black/30 to-transparent pointer-events-none" />
      <div className="absolute inset-x-0 bottom-0 h-72 bg-gradient-to-t from-black/85 via-black/35 to-transparent pointer-events-none" />

      {/* Photo progress pips (Stories style) */}
      {images.length > 1 && (
        <div className="absolute top-3 left-3 right-3 z-30 flex gap-1 pointer-events-none">
          {images.slice(0, 8).map((_, i) => (
            <div key={i} className="flex-1 h-[2.5px] bg-white/25 rounded-full overflow-hidden">
              <div
                className="h-full bg-white transition-[width] ease-linear"
                style={{
                  width: i < photoIdx ? "100%" : i === photoIdx ? "100%" : "0%",
                  transitionDuration: i === photoIdx && active ? "3800ms" : "0ms",
                }}
              />
            </div>
          ))}
        </div>
      )}

      {/* ─── Top-LEFT: profile chip (avatar + name + verified + Follow) ─── */}
      <div className="absolute top-7 left-3 right-20 z-30 flex items-center gap-2.5">
        <Link
          href={`/hotels/${h.id}`}
          className="ig-avatar relative shrink-0"
          aria-label={`Open ${h.name}`}
        >
          <span className="ig-avatar-ring" />
          <span className="ig-avatar-inner">
            {h.images?.[0] ? (
              <img src={h.images[0]} alt={h.name} className="w-full h-full object-cover rounded-full" />
            ) : (
              <span className="text-[0.78rem] font-bold text-black">{initials}</span>
            )}
          </span>
        </Link>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 leading-none">
            <span className="text-white font-semibold text-[0.92rem] truncate" style={{ textShadow: "0 1px 4px rgba(0,0,0,0.7)" }}>
              {(h.name || "Hotel").toLowerCase().replace(/\s+/g, "_").slice(0, 22)}
            </span>
            <span className="ig-verified" title="Verified hotel">✓</span>
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[0.62rem] text-white/75" style={{ textShadow: "0 1px 3px rgba(0,0,0,0.7)" }}>
            <span>📍 {h.city || "—"}</span>
            <span className="opacity-50">·</span>
            <span>{fmtCount(followers)} followers</span>
          </div>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); setFollowed((f) => !f); onTrackEvent?.("ig_follow", { hotelId: h.id, follow: !followed }); }}
          className={`ig-follow ${followed ? "ig-follow-on" : ""}`}
        >
          {followed ? "Following" : "Follow"}
        </button>
      </div>

      {/* ─── RIGHT action rail (Instagram Reels style, vertical) ─── */}
      <div className="absolute right-2.5 z-30 flex flex-col items-center gap-4" style={{ bottom: "150px" }}>
        <button
          aria-label="Like"
          onClick={(e) => { e.stopPropagation(); const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); triggerLike(r.left, r.top); }}
          className="ig-rail-btn"
        >
          <span className={`ig-icon ${liked ? "ig-liked" : ""}`}>{liked ? "❤️" : "🤍"}</span>
          <span className="ig-rail-count">{fmtCount(likeCount)}</span>
        </button>
        <button
          aria-label="Comments"
          onClick={(e) => { e.stopPropagation(); onTrackEvent?.("ig_comment_open", { hotelId: h.id }); onOpenFull(h); }}
          className="ig-rail-btn"
        >
          <span className="ig-icon">💬</span>
          <span className="ig-rail-count">{fmtCount(comments)}</span>
        </button>
        <button
          aria-label="Share"
          onClick={(e) => { e.stopPropagation(); onShare(h); }}
          className="ig-rail-btn"
        >
          <span className="ig-icon">↗</span>
          <span className="ig-rail-count">Share</span>
        </button>
        <button
          aria-label="Save"
          onClick={(e) => { e.stopPropagation(); setSaved((s) => !s); onTrackEvent?.("ig_save", { hotelId: h.id, save: !saved }); }}
          className="ig-rail-btn"
        >
          <span className="ig-icon">{saved ? "🔖" : "📑"}</span>
          <span className="ig-rail-count">{saved ? "Saved" : "Save"}</span>
        </button>
        <Link
          href={`/hotels/${h.id}`}
          onClick={() => onTrackEvent?.("ig_open_full", { hotelId: h.id })}
          className="ig-rail-btn"
          aria-label="Open hotel"
        >
          <span className="ig-icon">⋯</span>
          <span className="ig-rail-count">More</span>
        </Link>

        {/* Audio disc (rotating) */}
        <div className="ig-disc">
          {h.images?.[0] ? <img src={h.images[0]} alt="" className="w-full h-full object-cover rounded-full" /> : <span className="text-[0.7rem]">🎵</span>}
        </div>
      </div>

      {/* ─── BOTTOM-LEFT: caption + meta + price + CTAs ─── */}
      <div className="absolute left-3 right-20 z-30" style={{ bottom: "20px" }}>
        <div className="flex items-center gap-2 mb-2 flex-wrap">
          {h.starRating > 0 && <span className="ig-pill ig-pill-gold">{"★".repeat(Math.min(h.starRating, 5))}</span>}
          {h.avgRating > 0 && <span className="ig-pill">★ {Number(h.avgRating).toFixed(1)}</span>}
          <span className="ig-pill ig-pill-live"><span className="ig-dot" /> LIVE BIDDING</span>
          <span className="ig-pill">{fmtCount(viewCount)} views</span>
        </div>

        <h3 className="text-white font-semibold text-[1.05rem] leading-tight mb-1" style={{ textShadow: "0 2px 6px rgba(0,0,0,0.8)" }}>
          {h.name}
        </h3>

        <p
          className="text-white/90 text-[0.78rem] leading-snug mb-1.5"
          style={{
            textShadow: "0 1px 3px rgba(0,0,0,0.75)",
            display: "-webkit-box",
            WebkitLineClamp: showCaption ? 99 : 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
          onClick={(e) => { e.stopPropagation(); setShowCaption((s) => !s); }}
        >
          {description}{" "}
          {tags.map((t) => (
            <Link key={t} href={`/tag/${encodeURIComponent(t.toLowerCase())}`} className="text-gold-300 font-semibold mr-1" onClick={(e) => e.stopPropagation()}>
              #{t}
            </Link>
          ))}
        </p>

        {!showCaption && (description.length > 100 || tags.length > 0) && (
          <button
            onClick={(e) => { e.stopPropagation(); setShowCaption(true); }}
            className="text-white/55 text-[0.7rem] mb-1.5"
          >
            ... more
          </button>
        )}

        {/* Audio strip — Instagram-style scrolling music line */}
        <div className="ig-audio-strip">
          <span className="ig-audio-icon">🎵</span>
          <span className="ig-audio-text">
            Original audio · {h.name} · StayBid Live · Real-time room availability
          </span>
        </div>

        {/* Price + dual CTAs */}
        <div className="mt-3 flex items-center gap-2">
          <div className="flex flex-col leading-none mr-1">
            <span className="text-white/55 text-[0.55rem] uppercase tracking-widest">From</span>
            <span className="text-white font-bold text-[1.15rem]">
              ₹{(h.minPrice || h.rooms?.[0]?.floorPrice || 0).toLocaleString()}
              <span className="text-white/55 text-[0.7rem] font-normal ml-1">/night</span>
            </span>
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); onBook(h); }}
            className="ig-cta-primary"
          >
            ⚡ Book Now
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onNegotiate(h); }}
            className="ig-cta-secondary"
          >
            💬 Bid
          </button>
        </div>
      </div>

      {/* Floating like-burst hearts on double-tap */}
      {bursts.map((b) => (
        <span
          key={b.id}
          className="ig-burst pointer-events-none"
          style={{ left: b.x - 50, top: b.y - 50 }}
        >
          ❤️
        </span>
      ))}
    </section>
  );
});

export default function InstagramHotelFeed({ items, onIndexChange, onLoadMore, onTrackEvent }: Props) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);

  // Track which card is currently in view via IntersectionObserver
  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    const cards = root.querySelectorAll<HTMLElement>(".ig-card");
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting && e.intersectionRatio > 0.6)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible) {
          const idx = Array.from(cards).indexOf(visible.target as HTMLElement);
          if (idx >= 0 && idx !== activeIdx) {
            setActiveIdx(idx);
            onIndexChange?.(idx);
            if (idx >= items.length - 3) onLoadMore?.();
          }
        }
      },
      { root, threshold: [0.6, 0.85] }
    );
    cards.forEach((c) => io.observe(c));
    return () => io.disconnect();
  }, [items.length, activeIdx, onIndexChange, onLoadMore]);

  const handleBook = useCallback((h: any) => {
    onTrackEvent?.("ig_click_book", { hotelId: h.id });
    router.push(`/hotels/${h.id}?intent=book#availability-picker`);
  }, [router, onTrackEvent]);
  const handleNegotiate = useCallback((h: any) => {
    onTrackEvent?.("ig_click_bid", { hotelId: h.id });
    router.push(`/hotels/${h.id}?intent=negotiate#availability-picker`);
  }, [router, onTrackEvent]);
  const handleShare = useCallback((h: any) => {
    onTrackEvent?.("ig_share", { hotelId: h.id });
    if (typeof navigator !== "undefined" && (navigator as any).share) {
      (navigator as any).share({
        title: h.name,
        text: `${h.name} on StayBid — from ₹${(h.minPrice || 0).toLocaleString()}/night`,
        url: `${window.location.origin}/hotels/${h.id}`,
      }).catch(() => {});
    } else if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(`${window.location.origin}/hotels/${h.id}`).catch(() => {});
    }
  }, [onTrackEvent]);
  const handleOpenFull = useCallback((h: any) => {
    onTrackEvent?.("ig_open_full", { hotelId: h.id });
    router.push(`/hotels/${h.id}`);
  }, [router, onTrackEvent]);

  return (
    <>
      <style jsx global>{`
        @keyframes igKenBurns {
          0%   { transform: scale(1.04) translate(0, 0); }
          50%  { transform: scale(1.18) translate(-2%, -1.8%); }
          100% { transform: scale(1.04) translate(0, 0); }
        }
        @keyframes igFade { from { opacity: 0; } to { opacity: 1; } }
        @keyframes igBurst {
          0%   { transform: scale(0.4); opacity: 0; }
          25%  { transform: scale(1.4); opacity: 1; }
          75%  { transform: scale(1.1); opacity: 0.95; }
          100% { transform: scale(2.2) translateY(-40px); opacity: 0; }
        }
        @keyframes igDiscSpin { from { transform: rotate(0); } to { transform: rotate(360deg); } }
        @keyframes igRingPulse {
          0%,100% { box-shadow: 0 0 0 0 rgba(240,180,41,0.8), 0 0 0 0 rgba(255,69,141,0.6); }
          50%     { box-shadow: 0 0 0 4px rgba(240,180,41,0.0), 0 0 0 8px rgba(255,69,141,0.0); }
        }
        @keyframes igAudioMarquee {
          0%   { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        @keyframes igLiveDot {
          0%,100% { opacity: 1; transform: scale(1); }
          50%     { opacity: 0.3; transform: scale(1.3); }
        }
        @keyframes igLikePop {
          0%   { transform: scale(1); }
          40%  { transform: scale(1.45) rotate(-8deg); }
          100% { transform: scale(1); }
        }

        .ig-feed {
          height: 100dvh;
          overflow-y: auto;
          overflow-x: hidden;
          scroll-snap-type: y mandatory;
          scroll-behavior: smooth;
          -webkit-overflow-scrolling: touch;
          background: #000;
        }
        .ig-feed::-webkit-scrollbar { display: none; }

        .ig-kb {
          animation: igFade 0.45s ease-out, igKenBurns 11s ease-in-out infinite;
          will-change: transform, opacity;
        }

        .ig-avatar {
          width: 42px; height: 42px; display: inline-block;
          padding: 2px; border-radius: 9999px;
          background: conic-gradient(from 220deg, #f0b429, #ff458d, #b964ff, #f0b429);
          animation: igRingPulse 2.6s ease-in-out infinite;
        }
        .ig-avatar-ring { display: none; }
        .ig-avatar-inner {
          display: flex; align-items: center; justify-content: center;
          width: 100%; height: 100%; border-radius: 9999px;
          background: linear-gradient(135deg,#ffd76b,#f0b429);
          border: 2px solid #000; overflow: hidden;
        }
        .ig-verified {
          display: inline-flex; align-items: center; justify-content: center;
          width: 14px; height: 14px; border-radius: 9999px;
          background: linear-gradient(135deg,#3ea0ff,#1a78d6);
          color: #fff; font-size: 9px; font-weight: 900;
          box-shadow: 0 1px 3px rgba(0,0,0,0.5);
        }
        .ig-follow {
          padding: 5px 14px; border-radius: 9px;
          font-size: 0.72rem; font-weight: 700;
          background: linear-gradient(135deg,#f0b429,#c9911a);
          color: #1a1208; border: 1px solid rgba(255,255,255,0.4);
          box-shadow: 0 2px 8px rgba(240,180,41,0.4), inset 0 1px 0 rgba(255,255,255,0.5);
          transition: transform 0.15s ease;
        }
        .ig-follow:active { transform: scale(0.94); }
        .ig-follow-on {
          background: rgba(255,255,255,0.10);
          color: #fff;
          border: 1px solid rgba(255,255,255,0.35);
          box-shadow: none;
          backdrop-filter: blur(8px);
        }

        .ig-rail-btn {
          display: flex; flex-direction: column; align-items: center;
          gap: 3px; color: #fff; font-size: 0.62rem; font-weight: 700;
          text-shadow: 0 1px 3px rgba(0,0,0,0.7);
          transition: transform 0.12s ease;
        }
        .ig-rail-btn:active { transform: scale(0.88); }
        .ig-icon {
          font-size: 1.7rem; line-height: 1;
          filter: drop-shadow(0 2px 4px rgba(0,0,0,0.6));
        }
        .ig-liked { animation: igLikePop 0.4s ease-out; }
        .ig-rail-count { font-size: 0.6rem; font-weight: 700; letter-spacing: 0.02em; }

        .ig-disc {
          width: 36px; height: 36px; border-radius: 9999px;
          background: linear-gradient(135deg,#1a1530,#0d1a2e);
          border: 2px solid rgba(255,255,255,0.7);
          overflow: hidden;
          animation: igDiscSpin 6s linear infinite;
          box-shadow: 0 2px 8px rgba(0,0,0,0.6), inset 0 0 0 4px rgba(0,0,0,0.5);
          display: flex; align-items: center; justify-content: center;
        }

        .ig-pill {
          display: inline-flex; align-items: center; gap: 4px;
          padding: 2px 8px; border-radius: 9999px;
          font-size: 0.58rem; font-weight: 700; letter-spacing: 0.04em;
          background: rgba(255,255,255,0.14);
          border: 1px solid rgba(255,255,255,0.22);
          color: #fff;
          backdrop-filter: blur(6px);
          -webkit-backdrop-filter: blur(6px);
          text-shadow: 0 1px 2px rgba(0,0,0,0.5);
        }
        .ig-pill-gold {
          background: linear-gradient(135deg, rgba(240,180,41,0.35), rgba(240,180,41,0.10));
          border: 1px solid rgba(240,180,41,0.55);
          color: #ffd76b;
        }
        .ig-pill-live {
          background: rgba(255, 69, 89, 0.20);
          border: 1px solid rgba(255, 69, 89, 0.55);
          color: #ffadb6;
        }
        .ig-dot {
          width: 6px; height: 6px; border-radius: 9999px;
          background: #ff4559;
          animation: igLiveDot 1.2s ease-in-out infinite;
          box-shadow: 0 0 8px rgba(255,69,89,0.8);
        }

        .ig-audio-strip {
          display: flex; align-items: center; gap: 8px;
          padding: 5px 9px; border-radius: 9999px;
          background: rgba(0,0,0,0.45);
          border: 1px solid rgba(255,255,255,0.12);
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
          max-width: 78%;
          overflow: hidden;
        }
        .ig-audio-icon { font-size: 0.78rem; }
        .ig-audio-text {
          font-size: 0.66rem; color: rgba(255,255,255,0.92);
          white-space: nowrap;
          animation: igAudioMarquee 18s linear infinite;
          display: inline-block;
        }

        .ig-cta-primary {
          flex: 1;
          padding: 10px 14px;
          border-radius: 12px;
          font-size: 0.78rem; font-weight: 800;
          color: #1a1208;
          background: linear-gradient(135deg,#ffd76b 0%, #f0b429 50%, #c9911a 100%);
          border: 1px solid rgba(255,255,255,0.45);
          box-shadow:
            0 6px 18px -3px rgba(240,180,41,0.55),
            inset 0 1px 0 rgba(255,255,255,0.55),
            inset 0 -1px 0 rgba(110,70,5,0.45);
          transition: transform 0.12s ease;
        }
        .ig-cta-primary:active { transform: scale(0.96); }
        .ig-cta-secondary {
          padding: 10px 14px;
          border-radius: 12px;
          font-size: 0.78rem; font-weight: 700;
          color: #ffd76b;
          background: rgba(255,255,255,0.06);
          border: 1px solid rgba(240,180,41,0.45);
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
          transition: transform 0.12s ease;
        }
        .ig-cta-secondary:active { transform: scale(0.96); }

        .ig-burst {
          position: absolute;
          font-size: 6rem;
          animation: igBurst 0.9s cubic-bezier(0.2,0.9,0.3,1) forwards;
          z-index: 50;
          filter: drop-shadow(0 4px 12px rgba(255,69,141,0.6));
        }
      `}</style>

      <div ref={containerRef} className="ig-feed">
        {items.map((it, i) => (
          <HotelCard
            key={it.hotel.id || i}
            item={it}
            active={i === activeIdx}
            onTrackEvent={onTrackEvent}
            onBook={handleBook}
            onNegotiate={handleNegotiate}
            onShare={handleShare}
            onOpenFull={handleOpenFull}
          />
        ))}
        {items.length === 0 && (
          <section className="ig-card flex items-center justify-center text-center text-white/70">
            <div>
              <p className="text-5xl mb-2">🏔️</p>
              <p className="text-sm">No hotels yet</p>
            </div>
          </section>
        )}
      </div>
    </>
  );
}
