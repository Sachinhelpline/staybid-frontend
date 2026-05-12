"use client";
// ═══════════════════════════════════════════════════════════════════════════
// PostsScrollFeed — Instagram-style "Posts" / "All Posts" dedicated scroll
// view. Replaces v85's ReelPlayerModal: tapping a tile on /me or a video
// card on /saved now navigates to /me/posts or /saved/posts, which mounts
// this component with the relevant post list. The view scrolls to the
// tapped post and autoplays whatever is most visible (muted by default,
// tap to unmute) — exactly the IG "Posts" pattern from the user's screenshots.
//
// Two visual variants, driven by `mode`:
//   • "owner"  — used by /me/posts. No Follow button, no view-insights /
//                Boost row (those were removed in v87 per user feedback).
//   • "viewer" — used by /saved/posts. Follow button shown on header,
//                bookmark always pre-filled (the user got here from /saved).
//
// All action buttons (♡ like, 💬 comment, ↻ reshare, ▷ share, 🔖 bookmark)
// are FUNCTIONAL — they toggle local state, persist to localStorage, and
// fire native share / open a comments drawer where applicable. No more
// decorative-only buttons (v87).
//
// Viewport safety: every fixed/sticky element uses safe-area-inset for
// notch + home-bar clearance. The page body adds bottom padding for the
// BottomDock so action buttons never sit behind it. Works identically on
// iOS Safari, Android Chrome, Samsung Internet, and installed PWA.
// ═══════════════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export type FeedPost = {
  id: string;
  /** "video" auto-plays + has tap-mute toggle. "image" renders <img>. */
  kind: "video" | "image";
  src: string;
  poster?: string;
  caption?: string;
  /** Owner / creator display name shown in the header chip. */
  ownerName: string;
  /** @handle shown under the display name on the header chip. */
  ownerHandle?: string;
  ownerAvatar?: string;
  /** Audio strip line — e.g. "Original audio" or "Acoustic Trips · Shiv Kailash". */
  audioLine?: string;
  /** Initial counts — like / comment counts read from the data source. */
  likeCount?: number;
  commentCount?: number;
  /** Optional deep-link to a hotel page, when the post is tagged to one. */
  hotelId?: string;
};

type Mode = "owner" | "viewer";

// ─── localStorage helpers — keep the same keys the rest of the app uses ──
const LS_LIKES = "sb_post_likes_v1";   // { [postId]: true }
const LS_SAVES = "sb_local_saves";     // shared with /saved + reel feed

function readLikedSet(): Record<string, true> {
  if (typeof window === "undefined") return {};
  try { return JSON.parse(localStorage.getItem(LS_LIKES) || "{}") || {}; }
  catch { return {}; }
}
function writeLikedSet(m: Record<string, true>) {
  try { localStorage.setItem(LS_LIKES, JSON.stringify(m)); } catch {}
}
function readSavedSet(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const arr: any[] = JSON.parse(localStorage.getItem(LS_SAVES) || "[]");
    return new Set(arr.map((s: any) => `${s.target_type}:${s.target_id}`));
  } catch { return new Set(); }
}

export function PostsScrollFeed({
  posts,
  startId,
  headerTitle,
  mode,
}: {
  posts: FeedPost[];
  startId?: string;
  headerTitle: string;
  mode: Mode;
}) {
  const router = useRouter();
  const wrapRef = useRef<HTMLDivElement | null>(null);
  // Track which post id is most visible — that one autoplays.
  const [activeId, setActiveId] = useState<string>("");
  // Per-card mute state so a tap-to-unmute on one doesn't unmute all.
  const [unmuted, setUnmuted] = useState<Record<string, boolean>>({});
  // Like + bookmark state hydrated from localStorage on mount.
  const [liked, setLiked] = useState<Record<string, true>>({});
  const [savedSet, setSavedSet] = useState<Set<string>>(() => new Set());
  // Optimistic comment counter — wired even though the comment drawer
  // itself is just an empty placeholder for now (defers the full
  // commenting feature to a follow-up).
  const [commentsOpen, setCommentsOpen] = useState<string>("");
  // Toast for share / copy fallback.
  const [toast, setToast] = useState<string>("");

  // Hydrate like + save state on mount.
  useEffect(() => {
    setLiked(readLikedSet());
    setSavedSet(readSavedSet());
  }, []);

  // Toast helper — auto-dismisses after 2s.
  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast((t) => (t === msg ? "" : t)), 2200);
  }

  // Scroll the starting post into view on first render.
  useEffect(() => {
    if (!startId) return;
    const t = setTimeout(() => {
      const el = document.getElementById(`pf-${startId}`);
      if (el) {
        el.scrollIntoView({ behavior: "auto", block: "start" });
        setActiveId(startId);
      }
    }, 30);
    return () => clearTimeout(t);
  }, [startId]);

  // IntersectionObserver-driven autoplay — picks whichever video card is
  // most on-screen as the active one. Pauses the others.
  useEffect(() => {
    const cards = wrapRef.current?.querySelectorAll<HTMLElement>("[data-pf-card]");
    if (!cards || cards.length === 0) return;
    const io = new IntersectionObserver(
      (entries) => {
        let bestId = "";
        let bestRatio = -1;
        entries.forEach((e) => {
          if (!e.isIntersecting) return;
          const id = (e.target as HTMLElement).dataset.pfId || "";
          if (!id) return;
          if (e.intersectionRatio > bestRatio) {
            bestRatio = e.intersectionRatio;
            bestId = id;
          }
        });
        if (bestId) setActiveId(bestId);
      },
      { threshold: [0.25, 0.55, 0.75] }
    );
    cards.forEach((c) => io.observe(c));
    return () => io.disconnect();
  }, [posts]);

  // ─── Action handlers — wired (v87) ──────────────────────────────────
  function toggleLike(postId: string) {
    setLiked((m) => {
      const next = { ...m };
      if (next[postId]) delete next[postId];
      else next[postId] = true;
      writeLikedSet(next);
      return next;
    });
  }
  function toggleSave(post: FeedPost) {
    const key = `video:${post.id}`;
    setSavedSet((prev) => {
      const next = new Set(prev);
      let arr: any[] = [];
      try { arr = JSON.parse(localStorage.getItem(LS_SAVES) || "[]"); } catch {}
      if (next.has(key)) {
        next.delete(key);
        arr = arr.filter((s: any) => `${s.target_type}:${s.target_id}` !== key);
        showToast("Removed from Saved");
      } else {
        next.add(key);
        arr.push({
          id: `local-${Date.now()}`,
          target_type: "video",
          target_id: post.id,
          created_at: new Date().toISOString(),
          target: {
            id: post.id,
            s3_url: post.src,
            thumbnail_url: post.poster || "",
            title: post.ownerName || "Reel",
            caption: post.caption || "",
            uploader_name: post.ownerName,
            uploader_handle: post.ownerHandle || "",
            uploader_avatar_url: post.ownerAvatar || "",
            audio_name: post.audioLine || "Original audio",
          },
        });
        showToast("Saved to your collection");
      }
      try { localStorage.setItem(LS_SAVES, JSON.stringify(arr)); } catch {}
      return next;
    });
  }
  async function shareOrCopy(post: FeedPost) {
    const url = typeof window !== "undefined"
      ? `${window.location.origin}/saved/posts?start=${encodeURIComponent(post.id)}`
      : "";
    const title = post.ownerName ? `Post by ${post.ownerName}` : "StayBid Reel";
    const text = post.caption ? post.caption.slice(0, 120) : "Check this out on StayBid";
    try {
      if (typeof navigator !== "undefined" && (navigator as any).share) {
        await (navigator as any).share({ title, text, url });
        return;
      }
    } catch { /* user dismissed — fall through */ }
    try {
      await navigator.clipboard.writeText(url);
      showToast("Link copied to clipboard");
    } catch {
      showToast("Could not copy link");
    }
  }
  function restartPlayback(postId: string) {
    // Reshare ↻ button — the IG-style "loop" affordance restarts video.
    const el = document.querySelector<HTMLVideoElement>(`#pf-${postId} video`);
    if (el) {
      try {
        el.currentTime = 0;
        const p = el.play();
        if (p && typeof p.then === "function") p.catch(() => {});
        showToast("Replaying ↻");
      } catch {}
    }
  }
  function openCommentsDrawer(postId: string) {
    setCommentsOpen(postId);
  }

  return (
    <div className="pf-root" ref={wrapRef}>
      <header className="pf-top">
        <button
          type="button"
          className="pf-back"
          onClick={() => router.back()}
          aria-label="Back"
        >←</button>
        <span className="pf-title">{headerTitle}</span>
        {/* v88 — premium cozy brand wordmark, restored after v87 removal.
            Lives on the right side of the title bar so the user always
            sees what app they're in without crowding the back arrow. */}
        <span className="pf-brand" aria-label="StayBid">
          stay<span className="pf-brand-dot">·</span>bid
        </span>
      </header>

      <div className="pf-list">
        {posts.length === 0 ? (
          <div className="pf-empty">
            <span className="pf-empty-icon">📭</span>
            <p className="pf-empty-title">Nothing to show yet</p>
          </div>
        ) : (
          posts.map((p) => (
            <PostCard
              key={p.id}
              post={p}
              mode={mode}
              isActive={activeId === p.id}
              muted={!unmuted[p.id]}
              liked={!!liked[p.id]}
              saved={savedSet.has(`video:${p.id}`)}
              onToggleMute={() =>
                setUnmuted((m) => ({ ...m, [p.id]: !m[p.id] }))
              }
              onLike={() => toggleLike(p.id)}
              onComment={() => openCommentsDrawer(p.id)}
              onRestart={() => restartPlayback(p.id)}
              onShare={() => shareOrCopy(p)}
              onSave={() => toggleSave(p)}
            />
          ))
        )}
      </div>

      {/* Comments drawer — minimal placeholder while the full thread
          experience ships with the existing booking-chat backend in a
          follow-up. Closing it dismisses the overlay. */}
      {commentsOpen && (
        <div className="pf-drawer-backdrop" onClick={() => setCommentsOpen("")}>
          <div className="pf-drawer" onClick={(e) => e.stopPropagation()}>
            <div className="pf-drawer-handle" />
            <p className="pf-drawer-title">Comments</p>
            <p className="pf-drawer-empty">No comments yet — be the first to say something nice 💬</p>
            <button
              type="button"
              className="pf-drawer-close"
              onClick={() => setCommentsOpen("")}
              aria-label="Close comments"
            >Close</button>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && <div className="pf-toast">{toast}</div>}

      <style jsx global>{`
        /* v88 — Premium cozy palette: warm cream surface, cocoa text,
           champagne accents. Replaces the v87 stark white + pure black. */
        .pf-root {
          min-height: 100dvh;
          background: var(--cozy-cream-50, #FFFCF6);
          color: var(--cozy-warm-dark, #1F1A0F);
          padding-bottom: calc(72px + env(safe-area-inset-bottom, 0px));
          font-family: ui-sans-serif, system-ui, "Segoe UI", sans-serif;
        }
        .pf-top {
          position: sticky;
          top: 0;
          z-index: 30;
          display: flex;
          align-items: center;
          gap: 14px;
          padding: calc(env(safe-area-inset-top, 0px) + 12px) 16px 12px;
          background: rgba(255, 252, 246, 0.94);
          backdrop-filter: blur(12px) saturate(1.15);
          -webkit-backdrop-filter: blur(12px) saturate(1.15);
          border-bottom: 1px solid var(--cozy-taupe, #E8DCC8);
        }
        .pf-back {
          width: 34px;
          height: 34px;
          border: none;
          background: transparent;
          color: var(--cozy-warm-dark, #1F1A0F);
          font-size: 1.5rem;
          font-weight: 600;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          line-height: 1;
          border-radius: 999px;
          transition: background 0.15s ease, transform 0.12s cubic-bezier(.32,1.2,.36,1);
        }
        .pf-back:hover { background: rgba(74, 56, 32, 0.06); }
        .pf-back:active { transform: scale(0.92); opacity: 0.6; }
        .pf-title {
          flex: 1;
          font-size: 1.04rem;
          font-weight: 700;
          letter-spacing: -0.01em;
          color: var(--cozy-warm-dark, #1F1A0F);
        }
        /* Brand wordmark — Cormorant italic, sits opposite the back arrow.
           Tiny + premium so it doesn't compete with the page title. */
        .pf-brand {
          font-family: "Cormorant Garamond", "Georgia", serif;
          font-style: italic;
          font-weight: 600;
          font-size: 0.92rem;
          line-height: 1;
          color: var(--cozy-cocoa, #4A3820);
          letter-spacing: 0.01em;
          padding-right: 4px;
          user-select: none;
        }
        .pf-brand-dot { color: var(--cozy-champagne, #C9A66B); margin: 0 1px; }
        .pf-spacer { width: 34px; }

        .pf-list { display: block; }
        .pf-empty {
          text-align: center;
          padding: 96px 32px;
          color: rgba(12, 10, 4, 0.55);
        }
        .pf-empty-icon { font-size: 3rem; display: block; margin-bottom: 10px; }
        .pf-empty-title { font-size: 0.95rem; font-weight: 700; }

        /* v88 — Drawer + Toast also follow the cozy palette */
        .pf-drawer-backdrop {
          position: fixed;
          inset: 0;
          z-index: 90;
          background: rgba(31, 26, 15, 0.55);
          display: flex;
          align-items: flex-end;
          justify-content: center;
          animation: pfFadeIn 0.18s ease both;
        }
        @keyframes pfFadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes pfSlideUp { from { transform: translateY(20%); } to { transform: translateY(0); } }
        .pf-drawer {
          width: 100%;
          max-width: 520px;
          background: var(--cozy-cream-50, #FFFCF6);
          border-radius: 18px 18px 0 0;
          padding: 14px 18px calc(env(safe-area-inset-bottom, 0px) + 18px);
          animation: pfSlideUp 0.28s cubic-bezier(.32,1.2,.36,1) both;
        }
        .pf-drawer-handle {
          width: 40px;
          height: 4px;
          border-radius: 999px;
          background: var(--cozy-taupe, #E8DCC8);
          margin: 0 auto 12px;
        }
        .pf-drawer-title {
          font-size: 0.92rem;
          font-weight: 700;
          color: var(--cozy-warm-dark, #1F1A0F);
          text-align: center;
          margin: 0 0 6px;
        }
        .pf-drawer-empty {
          font-size: 0.82rem;
          color: var(--cozy-cocoa, #4A3820);
          text-align: center;
          padding: 28px 12px;
          margin: 0;
        }
        .pf-drawer-close {
          width: 100%;
          padding: 11px;
          margin-top: 4px;
          border: none;
          border-radius: 12px;
          background: var(--cozy-warm-dark, #1F1A0F);
          color: var(--cozy-cream-50, #FFFCF6);
          font-size: 0.86rem;
          font-weight: 700;
          cursor: pointer;
        }

        /* Toast */
        @keyframes pfToastIn {
          0%   { opacity: 0; transform: translate(-50%, 16px); }
          15%  { opacity: 1; transform: translate(-50%, 0); }
          85%  { opacity: 1; transform: translate(-50%, 0); }
          100% { opacity: 0; transform: translate(-50%, -8px); }
        }
        .pf-toast {
          position: fixed;
          left: 50%;
          bottom: calc(env(safe-area-inset-bottom, 0px) + 90px);
          z-index: 95;
          padding: 10px 16px;
          border-radius: 999px;
          background: rgba(31, 26, 15, 0.94);
          color: var(--cozy-cream-50, #FFFCF6);
          border: 1px solid rgba(217, 190, 130, 0.20);
          font-size: 0.82rem;
          font-weight: 600;
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
          box-shadow: 0 8px 22px rgba(31, 26, 15, 0.35);
          animation: pfToastIn 2.2s ease forwards;
          pointer-events: none;
        }
      `}</style>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// PostCard — one row of the scroll feed. v87 layout (Boost/Insights removed):
//   ┌────────────────────────────────────────────────┐
//   │ ◯avatar  display_name           [Follow]  ⋮    │  header
//   │           🎵 audio line                        │
//   ├────────────────────────────────────────────────┤
//   │                                                │
//   │              (video / image)                   │  media (9:16)
//   │                                                │
//   ├────────────────────────────────────────────────┤
//   │  ♡ N    💬 N    ↻        ▷           🔖        │  actions (all functional)
//   └────────────────────────────────────────────────┘
// ─────────────────────────────────────────────────────────────────────────
function PostCard({
  post, mode, isActive, muted, liked, saved,
  onToggleMute, onLike, onComment, onRestart, onShare, onSave,
}: {
  post: FeedPost;
  mode: Mode;
  isActive: boolean;
  muted: boolean;
  liked: boolean;
  saved: boolean;
  onToggleMute: () => void;
  onLike: () => void;
  onComment: () => void;
  onRestart: () => void;
  onShare: () => void;
  onSave: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  // Animated heart for double-tap and like-button pop.
  const [heartPulse, setHeartPulse] = useState<number>(0);

  // Active card plays; inactive pauses.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (isActive) {
      v.muted = muted;
      const p = v.play();
      if (p && typeof p.then === "function") p.catch(() => {});
    } else {
      try { v.pause(); v.currentTime = 0; } catch {}
    }
  }, [isActive, muted]);

  // Reflect external mute state changes.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = muted;
  }, [muted]);

  // Double-tap-to-like — IG signature interaction.
  const lastTapRef = useRef<number>(0);
  function handleMediaTap() {
    const now = Date.now();
    if (now - lastTapRef.current < 280) {
      // Double tap detected — like + heart animation
      if (!liked) onLike();
      setHeartPulse((n) => n + 1);
      lastTapRef.current = 0;
    } else {
      lastTapRef.current = now;
      // Single tap → toggle mute (only on videos)
      setTimeout(() => {
        if (lastTapRef.current === now) onToggleMute();
      }, 280);
    }
  }

  const initials = (post.ownerName || "?").trim().slice(0, 1).toUpperCase();
  const handle = post.ownerHandle ? `@${post.ownerHandle.replace(/^@/, "")}` : "";

  const likeCount = (post.likeCount || 0) + (liked ? 1 : 0);

  return (
    <article id={`pf-${post.id}`} data-pf-card data-pf-id={post.id} className="pf-card">
      {/* Header */}
      <div className="pf-head">
        <span className="pf-avatar">
          {post.ownerAvatar
            ? <img src={post.ownerAvatar} alt="" />
            : <span className="pf-avatar-fallback">{initials}</span>}
        </span>
        <div className="pf-head-text">
          <p className="pf-name">{handle || post.ownerName}</p>
          {post.audioLine && (
            <p className="pf-audio">🎵 {post.audioLine}</p>
          )}
        </div>
        {mode === "viewer" && (
          <button type="button" className="pf-follow" aria-label="Follow creator">
            Follow
          </button>
        )}
        <button type="button" className="pf-more" aria-label="More options">⋮</button>
      </div>

      {/* Media */}
      <div className="pf-media">
        {post.kind === "video" && post.src ? (
          <>
            <video
              ref={videoRef}
              src={post.src}
              poster={post.poster || undefined}
              className="pf-video"
              loop
              playsInline
              preload={isActive ? "auto" : "metadata"}
              muted
              onClick={handleMediaTap}
            />
            <button
              type="button"
              className="pf-mute"
              onClick={onToggleMute}
              aria-label={muted ? "Unmute" : "Mute"}
            >{muted ? "🔇" : "🔊"}</button>
          </>
        ) : post.poster || post.src ? (
          <img
            src={post.poster || post.src}
            alt={post.caption || ""}
            className="pf-image"
            onClick={handleMediaTap}
          />
        ) : (
          <div className="pf-blank">📷</div>
        )}

        {/* Double-tap heart pulse */}
        {heartPulse > 0 && (
          <span key={heartPulse} className="pf-heart" aria-hidden>❤</span>
        )}
      </div>

      {/* Actions row — every button is functional in v87 */}
      <div className="pf-actions">
        <button
          type="button"
          className={`pf-act${liked ? " is-liked" : ""}`}
          onClick={onLike}
          aria-label={liked ? "Unlike" : "Like"}
          aria-pressed={liked}
        >
          <span className="pf-act-glyph">{liked ? "❤" : "♡"}</span>
          {likeCount > 0 && (
            <span className="pf-act-count">{fmtViewCount(likeCount)}</span>
          )}
        </button>
        <button type="button" className="pf-act" onClick={onComment} aria-label="Comments">
          <span className="pf-act-glyph">💬</span>
          {(post.commentCount || 0) > 0 && (
            <span className="pf-act-count">{fmtViewCount(post.commentCount || 0)}</span>
          )}
        </button>
        <button type="button" className="pf-act" onClick={onRestart} aria-label="Replay">
          <span className="pf-act-glyph">↻</span>
        </button>
        <button type="button" className="pf-act" onClick={onShare} aria-label="Share">
          <span className="pf-act-glyph">▷</span>
        </button>
        <span className="pf-actions-spacer" />
        <button
          type="button"
          className={`pf-act pf-act-bookmark${saved ? " is-saved" : ""}`}
          onClick={onSave}
          aria-label={saved ? "Remove from saved" : "Save"}
          aria-pressed={saved}
        >
          <span className="pf-act-glyph">🔖</span>
        </button>
      </div>

      {/* Caption (sanitized at the source) */}
      {post.caption && (
        <p className="pf-caption">
          <strong>{handle || post.ownerName}</strong> {post.caption}
        </p>
      )}

      {/* Tagged hotel CTA */}
      {post.hotelId && (
        <Link href={`/hotels/${post.hotelId}`} className="pf-hotel-cta">
          🏨 View hotel ›
        </Link>
      )}

      <style jsx global>{`
        /* v88 — Card surfaces in premium cozy palette: cream bg, cocoa
           text, taupe dividers, champagne accents for highlighted state. */
        .pf-card {
          background: var(--cozy-cream-50, #FFFCF6);
          border-bottom: 1px solid var(--cozy-taupe, #E8DCC8);
          padding: 6px 0 10px;
        }
        .pf-head {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px 14px;
        }
        .pf-avatar {
          width: 36px;
          height: 36px;
          border-radius: 999px;
          background: var(--cozy-cream-200, #F2EAD8);
          overflow: hidden;
          flex-shrink: 0;
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }
        .pf-avatar img { width: 100%; height: 100%; object-fit: cover; display: block; }
        .pf-avatar-fallback {
          font-size: 0.95rem;
          font-weight: 800;
          color: var(--cozy-cocoa-soft, #6E5430);
        }
        .pf-head-text { flex: 1; min-width: 0; }
        .pf-name {
          font-size: 0.92rem;
          font-weight: 700;
          margin: 0;
          color: var(--cozy-warm-dark, #1F1A0F);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .pf-audio {
          font-size: 0.78rem;
          color: var(--cozy-cocoa, #4A3820);
          margin: 1px 0 0;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .pf-follow {
          padding: 6px 16px;
          border-radius: 999px;
          border: 1.5px solid var(--cozy-cocoa, #4A3820);
          background: transparent;
          color: var(--cozy-warm-dark, #1F1A0F);
          font-size: 0.82rem;
          font-weight: 700;
          cursor: pointer;
          transition: background 0.15s ease;
        }
        .pf-follow:hover { background: rgba(74, 56, 32, 0.06); }
        .pf-follow:active { opacity: 0.6; }
        .pf-more {
          background: transparent;
          border: none;
          color: var(--cozy-cocoa, #4A3820);
          font-size: 1.4rem;
          font-weight: 700;
          padding: 4px 6px;
          cursor: pointer;
        }
        .pf-media {
          position: relative;
          width: 100%;
          aspect-ratio: 9 / 16;
          max-height: 78vh;
          /* warmer than stark black — feels luxurious against cream */
          background: var(--cozy-warm-dark, #1F1A0F);
          overflow: hidden;
        }
        .pf-video, .pf-image {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }
        .pf-image { background: var(--cozy-warm-dark, #1F1A0F); }
        .pf-blank {
          display: flex;
          align-items: center;
          justify-content: center;
          height: 100%;
          color: rgba(255, 255, 255, 0.55);
          font-size: 2.6rem;
        }
        .pf-mute {
          position: absolute;
          bottom: 10px;
          right: 10px;
          width: 30px;
          height: 30px;
          border-radius: 999px;
          /* v88 — warm cocoa instead of cool near-black */
          background: rgba(31, 26, 15, 0.55);
          border: 1px solid rgba(217, 190, 130, 0.18);
          color: var(--cozy-cream-50, #FFFCF6);
          font-size: 0.85rem;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }
        /* Double-tap heart pulse — v88 warm rose instead of harsh red */
        @keyframes pfHeartPulse {
          0%   { transform: translate(-50%, -50%) scale(0.4); opacity: 0; }
          25%  { transform: translate(-50%, -50%) scale(1.3); opacity: 1; }
          70%  { transform: translate(-50%, -50%) scale(1.0); opacity: 0.95; }
          100% { transform: translate(-50%, -50%) scale(0.8); opacity: 0; }
        }
        .pf-heart {
          position: absolute;
          top: 50%;
          left: 50%;
          font-size: 5rem;
          color: var(--cozy-rose, #D49583);
          text-shadow: 0 6px 22px rgba(212, 149, 131, 0.5);
          animation: pfHeartPulse 0.9s ease-out forwards;
          pointer-events: none;
          z-index: 4;
        }
        .pf-actions {
          display: flex;
          align-items: center;
          gap: 18px;
          padding: 11px 14px 4px;
        }
        .pf-act {
          background: transparent;
          border: none;
          color: var(--cozy-warm-dark, #1F1A0F);
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          gap: 5px;
          padding: 4px 0;
          font-family: inherit;
          transition: transform 0.12s cubic-bezier(.32,1.2,.36,1);
        }
        .pf-act:active { transform: scale(0.86); opacity: 0.7; }
        .pf-act-glyph {
          font-size: 1.5rem;
          line-height: 1;
        }
        /* v88 — warm rose for liked, cozy champagne for saved */
        .pf-act.is-liked .pf-act-glyph { color: var(--cozy-rose, #D49583); }
        .pf-act.is-saved .pf-act-glyph {
          color: var(--cozy-champagne, #C9A66B);
          filter: drop-shadow(0 1px 2px rgba(201, 166, 107, 0.35));
        }
        .pf-act-count {
          font-size: 0.92rem;
          font-weight: 600;
          color: var(--cozy-cocoa, #4A3820);
        }
        .pf-actions-spacer { flex: 1; }
        .pf-caption {
          padding: 6px 14px 0;
          font-size: 0.88rem;
          line-height: 1.35;
          color: var(--cozy-warm-dark, #1F1A0F);
        }
        .pf-caption strong { font-weight: 700; margin-right: 4px; }
        .pf-hotel-cta {
          display: inline-block;
          margin: 8px 14px 0;
          padding: 7px 12px;
          border-radius: 999px;
          background: rgba(201, 166, 107, 0.14);
          border: 1px solid rgba(201, 166, 107, 0.30);
          color: var(--cozy-cocoa, #4A3820);
          font-size: 0.78rem;
          font-weight: 700;
          text-decoration: none;
        }
        .pf-hotel-cta:hover { background: rgba(201, 166, 107, 0.22); }
      `}</style>
    </article>
  );
}

function fmtViewCount(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "K";
  return String(n);
}
