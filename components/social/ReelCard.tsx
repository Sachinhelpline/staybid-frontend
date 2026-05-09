"use client";
// ═══════════════════════════════════════════════════════════════════════════
// ReelCard — full Instagram-level reel card for the StayBid social feed.
// Composes the smaller pieces (ProfileBadge, HotelIdentityStrip,
// ActionButtons, SoundTracker, BookingCTABar). Self-contained: pass a
// `post` (joined with author + hotel) and the necessary callbacks.
// ═══════════════════════════════════════════════════════════════════════════
import { useEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ProfileBadge } from "@/components/social/ProfileBadge";
import { HotelIdentityStrip } from "@/components/social/HotelIdentityStrip";
import { ActionButtons } from "@/components/social/ActionButtons";
import { SoundTracker } from "@/components/social/SoundTracker";
import { BookingCTABar } from "@/components/social/BookingCTABar";

type UserType = "PUBLIC" | "CREATOR" | "HOTEL";

type Author = {
  id: string;
  user_id: string;
  username: string;
  display_name: string;
  user_type: UserType;
  avatar_url?: string | null;
  follower_count: number;
};

type Post = {
  id: string;
  author_id: string;
  hotel_id?: string | null;
  media_type: "PHOTO" | "REEL" | "STORY";
  media_url: string;
  thumbnail_url?: string | null;
  caption?: string | null;
  sound_track?: string | null;
  sound_url?: string | null;
  sound_owner_id?: string | null;
  view_count: number;
  like_count: number;
  comment_count: number;
  created_at: string;
  author?: Author | null;
  hotel?: any | null;
};

type Props = {
  post: Post;
  active: boolean;
  viewerProfileId?: string | null;
  isFollowing: boolean;
  isSaved?: boolean;
  isLiked?: boolean;
  muted: boolean;
  onToggleMute: () => void;
  onToggleFollow: () => void;
  onToggleLike: (x: number, y: number) => void;
  onComment: () => void;
  onShare: () => void;
  onSave: () => void;
  onMore: () => void;
  onChangeSound?: () => void;
  onReviews?: () => void;
};

export function ReelCard({
  post, active, viewerProfileId, isFollowing, isSaved, isLiked,
  muted, onToggleMute, onToggleFollow, onToggleLike, onComment, onShare, onSave, onMore,
  onChangeSound, onReviews,
}: Props) {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const lastTapRef = useRef<{ t: number; x: number; y: number } | null>(null);
  const [paused, setPaused] = useState(false);
  const [showCaptionFull, setShowCaptionFull] = useState(false);

  const isVideo = post.media_type === "REEL" || post.media_type === "STORY";
  const a = post.author;
  const canChangeSound = !!viewerProfileId && (!post.sound_owner_id || post.sound_owner_id === viewerProfileId);

  // Active-state video sync
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !isVideo) return;
    v.muted = muted;
    v.volume = 1;
    if (active && !paused) {
      const p = v.play();
      if (p && typeof p.then === "function") p.catch(() => {});
    } else {
      v.pause();
      if (!active) try { v.currentTime = 0; } catch {}
    }
  }, [active, paused, muted, isVideo]);

  // Custom soundtrack (when post has a sound_url and user wants it)
  useEffect(() => {
    const ae = audioRef.current;
    if (!ae) return;
    if (active && post.sound_url && !paused) {
      ae.muted = muted;
      ae.volume = 1;
      const p = ae.play();
      if (p && typeof p.then === "function") p.catch(() => {});
    } else {
      try { ae.pause(); ae.currentTime = 0; } catch {}
    }
    return () => { try { ae.pause(); } catch {} };
  }, [active, paused, muted, post.sound_url]);

  const handleDoubleTap = useCallback((e: React.TouchEvent | React.MouseEvent) => {
    const now = Date.now();
    const anyE = e as any;
    const t = (anyE.changedTouches && anyE.changedTouches[0]) || (anyE.touches && anyE.touches[0]) || anyE;
    const x = t?.clientX || 0;
    const y = t?.clientY || 0;
    const last = lastTapRef.current;
    if (last && now - last.t < 320 && Math.abs(x - last.x) < 40 && Math.abs(y - last.y) < 40) {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      onToggleLike(x - rect.left, y - rect.top);
      lastTapRef.current = null;
    } else {
      lastTapRef.current = { t: now, x, y };
    }
  }, [onToggleLike]);

  // Hotel-tagged price
  const fromPrice: number | null =
    post.hotel?.minPrice ?? post.hotel?.rooms?.[0]?.floorPrice ?? null;

  return (
    <section
      className="relative w-full snap-start snap-always overflow-hidden bg-black"
      style={{ height: "100dvh" }}
      onTouchEnd={handleDoubleTap}
      onDoubleClick={handleDoubleTap}
    >
      {/* Media */}
      {isVideo ? (
        <video
          ref={videoRef}
          src={post.media_url}
          poster={post.thumbnail_url || undefined}
          loop autoPlay playsInline preload="auto"
          muted={muted}
          {...({ "webkit-playsinline": "true" } as any)}
          className="absolute inset-0 w-full h-full"
          style={{ objectFit: "cover" }}
          onClick={(e) => {
            e.stopPropagation();
            const v = videoRef.current; if (!v) return;
            if (muted) { try { v.muted = false; v.volume = 1; v.play().catch(()=>{}); } catch {}; onToggleMute(); return; }
            if (v.paused) { v.play().catch(()=>{}); setPaused(false); } else { v.pause(); setPaused(true); }
          }}
        />
      ) : (
        <img src={post.media_url} alt="" className="absolute inset-0 w-full h-full object-cover" />
      )}

      {/* Custom soundtrack audio (separate from video track when set) */}
      {post.sound_url && <audio ref={audioRef} src={post.sound_url} loop preload="auto" />}

      {/* Top + bottom gradients for legibility */}
      <div className="absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-black/70 to-transparent pointer-events-none" />
      <div className="absolute inset-x-0 bottom-0 h-[55%] bg-gradient-to-t from-black/85 via-black/40 to-transparent pointer-events-none" />

      {/* TOP: @username + 📍 location  ·  Follow */}
      <div className="absolute top-3 left-3 right-3 z-30 flex items-center gap-2">
        <Link
          href={a ? `/social/profile/${a.username}` : "#"}
          className="flex items-center gap-2 flex-1 min-w-0"
          onClick={(e) => e.stopPropagation()}
        >
          <div
            className="w-8 h-8 rounded-full overflow-hidden shrink-0 flex items-center justify-center text-[0.7rem] font-bold text-black"
            style={{ background: "linear-gradient(135deg,#ffd76b,#f0b429)", border: "1.5px solid rgba(255,255,255,0.6)" }}
          >
            {a?.avatar_url ? <img src={a.avatar_url} alt="" className="w-full h-full object-cover" /> : (a?.display_name || "?")[0]}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1 leading-none">
              <span className="text-white font-semibold text-[0.82rem] truncate" style={{ textShadow: "0 1px 3px rgba(0,0,0,0.7)" }}>
                @{a?.username || "user"}
              </span>
              {a && <ProfileBadge userType={a.user_type} size="xs" showLabel={false} />}
            </div>
            {post.hotel?.city && (
              <div className="mt-0.5 text-[0.6rem] text-white/75 leading-none truncate" style={{ textShadow: "0 1px 3px rgba(0,0,0,0.7)" }}>
                📍 {post.hotel.city}{post.hotel.state ? `, ${post.hotel.state}` : ""}
              </div>
            )}
          </div>
        </Link>
        <button
          onClick={(e) => { e.stopPropagation(); onToggleFollow(); }}
          className="px-3 py-1.5 rounded-full text-[0.7rem] font-bold shrink-0"
          style={isFollowing ? {
            background: "rgba(255,255,255,0.10)", color: "#fff",
            border: "1px solid rgba(255,255,255,0.30)",
          } : {
            background: "linear-gradient(135deg,#ffd76b,#f0b429)", color: "#1a1208",
            border: "1px solid rgba(255,255,255,0.45)",
            boxShadow: "0 3px 8px rgba(240,180,41,0.4)",
          }}
        >
          {isFollowing ? "Following" : "Follow"}
        </button>
      </div>

      {/* RIGHT RAIL */}
      <div className="absolute right-2 z-30 flex flex-col items-center gap-3" style={{ bottom: "calc(40% + 16px)" }}>
        <button onClick={(e) => { e.stopPropagation(); const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); onToggleLike(r.left, r.top); }} className="flex flex-col items-center gap-0.5 text-white">
          <span className="text-[1.45rem] leading-none" style={{ filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.6))" }}>{isLiked ? "❤️" : "🤍"}</span>
          <span className="text-[0.58rem] font-bold" style={{ textShadow: "0 1px 3px rgba(0,0,0,0.7)" }}>{post.like_count || 0}</span>
        </button>
        <button onClick={(e) => { e.stopPropagation(); onComment(); }} className="flex flex-col items-center gap-0.5 text-white">
          <span className="text-[1.45rem] leading-none" style={{ filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.6))" }}>💬</span>
          <span className="text-[0.58rem] font-bold" style={{ textShadow: "0 1px 3px rgba(0,0,0,0.7)" }}>{post.comment_count || 0}</span>
        </button>
        <button onClick={(e) => { e.stopPropagation(); onShare(); }} className="flex flex-col items-center gap-0.5 text-white">
          <span className="text-[1.45rem] leading-none" style={{ filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.6))" }}>📤</span>
          <span className="text-[0.58rem] font-bold" style={{ textShadow: "0 1px 3px rgba(0,0,0,0.7)" }}>Share</span>
        </button>
        <button onClick={(e) => { e.stopPropagation(); onSave(); }} className="flex flex-col items-center gap-0.5 text-white">
          <span className="text-[1.45rem] leading-none" style={{ filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.6))" }}>{isSaved ? "🔖" : "📑"}</span>
          <span className="text-[0.58rem] font-bold" style={{ textShadow: "0 1px 3px rgba(0,0,0,0.7)" }}>{isSaved ? "Saved" : "Save"}</span>
        </button>
        <button onClick={(e) => { e.stopPropagation(); onMore(); }} className="flex flex-col items-center gap-0.5 text-white">
          <span className="text-[1.45rem] leading-none" style={{ filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.6))" }}>⋮</span>
        </button>
      </div>

      {/* BOTTOM STACK — hotel strip · action buttons · caption · sound · CTA bar */}
      <div className="absolute left-2 right-2 z-30" style={{ bottom: "16px" }}>
        <div className="space-y-1.5">
          {post.hotel && <HotelIdentityStrip hotel={post.hotel} />}

          {post.hotel && (
            <ActionButtons
              reviewCount={post.hotel.totalReviews}
              viewCount={post.view_count || 0}
              rating={post.hotel.avgRating}
              onReviews={onReviews}
              onLiveBid={() => router.push(`/hotels/${post.hotel.id}?intent=negotiate#availability-picker`)}
            />
          )}

          {post.caption && (
            <p
              className="text-white/95 text-[0.78rem] leading-snug px-1 py-1"
              style={{
                textShadow: "0 1px 3px rgba(0,0,0,0.85)",
                display: "-webkit-box",
                WebkitLineClamp: showCaptionFull ? 99 : 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
              onClick={(e) => { e.stopPropagation(); setShowCaptionFull((s) => !s); }}
            >
              {post.caption}
            </p>
          )}

          <SoundTracker
            trackName={post.sound_track || "Original Audio"}
            authorHandle={a?.username || ""}
            muted={muted}
            onToggleMute={onToggleMute}
            canChange={canChangeSound}
            onChange={onChangeSound}
          />

          {post.hotel && (
            <BookingCTABar
              fromPrice={fromPrice}
              saved={isSaved}
              onSave={onSave}
              onBookNow={() => router.push(`/hotels/${post.hotel.id}?intent=book#availability-picker`)}
              onBid={() => router.push(`/hotels/${post.hotel.id}?intent=negotiate#availability-picker`)}
            />
          )}
        </div>
      </div>
    </section>
  );
}
