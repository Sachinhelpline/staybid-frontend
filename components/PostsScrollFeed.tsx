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
//   • "owner"  — used by /me/posts. Header chip = no Follow button.
//                Footer = view count overlay + "View insights" hint, no
//                bookmark-saved badge.
//   • "viewer" — used by /saved/posts. Header chip = Follow button shown,
//                no view-insights line, bookmark always rendered filled
//                (since the user got here from /saved).
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
  /** View count shown only when mode="owner". */
  viewCount?: number;
  likeCount?: number;
  commentCount?: number;
  /** Optional deep-link to a hotel page, when the post is tagged to one. */
  hotelId?: string;
};

type Mode = "owner" | "viewer";

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
  // Track per-card mute state so a tap-to-unmute on one doesn't unmute all.
  const [unmuted, setUnmuted] = useState<Record<string, boolean>>({});

  // Scroll the starting post into view on first render.
  useEffect(() => {
    if (!startId) return;
    // Wait a tick for the cards to lay out before scrolling.
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
  // ≥ 55% on-screen as the active one. Pauses the others.
  useEffect(() => {
    const cards = wrapRef.current?.querySelectorAll<HTMLElement>("[data-pf-card]");
    if (!cards || cards.length === 0) return;
    const io = new IntersectionObserver(
      (entries) => {
        // Pick the most-intersecting card.
        let best: { id: string; ratio: number } | null = null;
        entries.forEach((e) => {
          if (!e.isIntersecting) return;
          const id = (e.target as HTMLElement).dataset.pfId || "";
          if (!id) return;
          if (!best || e.intersectionRatio > best.ratio) {
            best = { id, ratio: e.intersectionRatio };
          }
        });
        if (best) setActiveId(best.id);
      },
      { threshold: [0.25, 0.55, 0.75] }
    );
    cards.forEach((c) => io.observe(c));
    return () => io.disconnect();
  }, [posts]);

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
        <span className="pf-spacer" />
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
              onToggleMute={() =>
                setUnmuted((m) => ({ ...m, [p.id]: !m[p.id] }))
              }
            />
          ))
        )}
      </div>

      <style jsx global>{`
        .pf-root {
          min-height: 100dvh;
          background: #fff;
          color: #0c0a04;
          padding-bottom: 84px; /* clear the bottom dock */
        }
        .pf-top {
          position: sticky;
          top: 0;
          z-index: 30;
          display: flex;
          align-items: center;
          gap: 16px;
          padding: 14px 16px;
          background: rgba(255, 255, 255, 0.96);
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
          border-bottom: 1px solid rgba(0, 0, 0, 0.08);
        }
        .pf-back {
          width: 32px;
          height: 32px;
          border: none;
          background: transparent;
          color: #0c0a04;
          font-size: 1.4rem;
          font-weight: 600;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }
        .pf-back:active { opacity: 0.55; }
        .pf-title {
          flex: 1;
          font-size: 1.04rem;
          font-weight: 700;
          letter-spacing: -0.01em;
          color: #0c0a04;
        }
        .pf-spacer { width: 32px; }

        .pf-list { display: block; }
        .pf-empty {
          text-align: center;
          padding: 96px 32px;
          color: rgba(12, 10, 4, 0.55);
        }
        .pf-empty-icon { font-size: 3rem; display: block; margin-bottom: 10px; }
        .pf-empty-title { font-size: 0.95rem; font-weight: 700; }
      `}</style>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// PostCard — one row of the scroll feed. Mirrors the screenshots:
//   ┌────────────────────────────────────────────────┐
//   │ ◯avatar  display_name           [Follow]  ⋯    │  header
//   │           🎵 audio line                        │
//   ├────────────────────────────────────────────────┤
//   │                                                │
//   │              (video / image)                   │  media (9:16)
//   │                                                │
//   │     [👁 453 · View insights — owner only]      │
//   ├────────────────────────────────────────────────┤
//   │  ♡ N    💬 N    ↻        ▷          🔖         │  actions
//   └────────────────────────────────────────────────┘
// ─────────────────────────────────────────────────────────────────────────
function PostCard({
  post, mode, isActive, muted, onToggleMute,
}: {
  post: FeedPost;
  mode: Mode;
  isActive: boolean;
  muted: boolean;
  onToggleMute: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

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

  const initials = (post.ownerName || "?").trim().slice(0, 1).toUpperCase();
  const handle = post.ownerHandle ? `@${post.ownerHandle.replace(/^@/, "")}` : "";

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
              onClick={onToggleMute}
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
          />
        ) : (
          <div className="pf-blank">📷</div>
        )}
      </div>

      {/* Owner-only view-count line, sitting under the media like IG */}
      {mode === "owner" && (
        <div className="pf-owner-row">
          <span className="pf-insights">
            👁 {fmtViewCount(post.viewCount || 0)} · View insights
          </span>
          <button type="button" className="pf-boost">Boost post</button>
        </div>
      )}

      {/* Actions row */}
      <div className="pf-actions">
        <button type="button" className="pf-act" aria-label="Like">
          <span className="pf-act-glyph">♡</span>
          {(post.likeCount || 0) > 0 && (
            <span className="pf-act-count">{fmtViewCount(post.likeCount || 0)}</span>
          )}
        </button>
        <button type="button" className="pf-act" aria-label="Comment">
          <span className="pf-act-glyph">💬</span>
          {(post.commentCount || 0) > 0 && (
            <span className="pf-act-count">{fmtViewCount(post.commentCount || 0)}</span>
          )}
        </button>
        <button type="button" className="pf-act" aria-label="Reshare">
          <span className="pf-act-glyph">↻</span>
        </button>
        <button type="button" className="pf-act" aria-label="Share">
          <span className="pf-act-glyph">▷</span>
        </button>
        <span className="pf-actions-spacer" />
        <button type="button" className="pf-act pf-act-bookmark" aria-label="Bookmark">
          <span className="pf-act-glyph">{mode === "viewer" ? "🔖" : "🔖"}</span>
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
        .pf-card {
          background: #fff;
          border-bottom: 1px solid rgba(0, 0, 0, 0.06);
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
          background: #f3eee1;
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
          color: #6e4a08;
        }
        .pf-head-text { flex: 1; min-width: 0; }
        .pf-name {
          font-size: 0.92rem;
          font-weight: 700;
          margin: 0;
          color: #0c0a04;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .pf-audio {
          font-size: 0.78rem;
          color: rgba(12, 10, 4, 0.78);
          margin: 1px 0 0;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .pf-follow {
          padding: 6px 16px;
          border-radius: 8px;
          border: 1.5px solid rgba(0, 0, 0, 0.85);
          background: transparent;
          color: #0c0a04;
          font-size: 0.82rem;
          font-weight: 700;
          cursor: pointer;
        }
        .pf-follow:active { opacity: 0.6; }
        .pf-more {
          background: transparent;
          border: none;
          color: #0c0a04;
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
          background: #1a1b20;
          overflow: hidden;
        }
        .pf-video, .pf-image {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }
        .pf-image { background: #0c0a04; }
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
          background: rgba(0, 0, 0, 0.55);
          border: none;
          color: #fff;
          font-size: 0.85rem;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }
        .pf-owner-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          padding: 10px 14px 0;
        }
        .pf-insights {
          font-size: 0.85rem;
          font-weight: 600;
          color: #0c0a04;
        }
        .pf-boost {
          padding: 7px 16px;
          border-radius: 7px;
          border: none;
          background: #3D9CF5;
          color: #fff;
          font-size: 0.85rem;
          font-weight: 700;
          cursor: pointer;
        }
        .pf-boost:active { opacity: 0.8; }
        .pf-actions {
          display: flex;
          align-items: center;
          gap: 16px;
          padding: 10px 14px 4px;
        }
        .pf-act {
          background: transparent;
          border: none;
          color: #0c0a04;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          gap: 5px;
          padding: 4px 0;
          font-family: inherit;
        }
        .pf-act:active { opacity: 0.55; }
        .pf-act-glyph {
          font-size: 1.5rem;
          line-height: 1;
        }
        .pf-act-count {
          font-size: 0.92rem;
          font-weight: 600;
        }
        .pf-actions-spacer { flex: 1; }
        .pf-caption {
          padding: 6px 14px 0;
          font-size: 0.88rem;
          line-height: 1.35;
          color: #0c0a04;
        }
        .pf-caption strong { font-weight: 700; margin-right: 4px; }
        .pf-hotel-cta {
          display: inline-block;
          margin: 8px 14px 0;
          padding: 7px 12px;
          border-radius: 999px;
          background: rgba(184, 134, 11, 0.10);
          color: #6e4a08;
          font-size: 0.78rem;
          font-weight: 700;
          text-decoration: none;
        }
      `}</style>
    </article>
  );
}

function fmtViewCount(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "K";
  return String(n);
}
