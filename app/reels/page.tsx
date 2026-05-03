"use client";
// ══════════════════════════════════════════════════════════════════════
// /reels — Instagram-for-hotels vertical swipe feed
// • Full-screen scroll-snap video cards, one per viewport
// • Auto-play the visible reel; pause all others
// • Right-side action rail: like / comment / share / save / book
// • Bottom overlay: hotel name, creator chip, caption
// • Comment drawer slides up from bottom
// • "Book This Stay" CTA opens hotel page
// ══════════════════════════════════════════════════════════════════════
import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

type Video = {
  id: string;
  s3_url: string;
  thumbnail_url?: string;
  title?: string;
  likes_count: number;
  comments_count: number;
  views_count: number;
  hotel_id: string;
  hotel?: { id: string; name: string; city: string; star_rating?: number; images?: string[] };
  uploaded_by?: string;
};

type Comment = { id: string; user_id: string; body: string; created_at: string };

const SB_TOKEN = () =>
  typeof window !== "undefined" ? localStorage.getItem("sb_token") || "" : "";
const AUTH_H = () => ({ Authorization: `Bearer ${SB_TOKEN()}`, "Content-Type": "application/json" });

function starStr(n?: number) {
  return n ? "★".repeat(Math.min(5, n)) : "";
}

// ── Single reel card ──────────────────────────────────────────────────
function ReelCard({
  video,
  isActive,
  onLike,
  onComment,
  onShare,
}: {
  video: Video;
  isActive: boolean;
  onLike: (v: Video) => void;
  onComment: (v: Video) => void;
  onShare: (v: Video) => void;
}) {
  const vidRef   = useRef<HTMLVideoElement>(null);
  const [muted, setMuted]     = useState(true);
  const [liked, setLiked]     = useState(false);
  const [likes, setLikes]     = useState(video.likes_count || 0);
  const [playing, setPlaying] = useState(false);
  const [saved, setSaved]     = useState(false);

  // Auto-play / pause based on visibility
  useEffect(() => {
    const el = vidRef.current;
    if (!el) return;
    if (isActive) {
      el.play().then(() => setPlaying(true)).catch(() => {});
    } else {
      el.pause();
      el.currentTime = 0;
      setPlaying(false);
    }
  }, [isActive]);

  // Check if user liked this video
  useEffect(() => {
    if (!SB_TOKEN()) return;
    fetch(`/api/videos/like/${video.id}`, { headers: { Authorization: `Bearer ${SB_TOKEN()}` } })
      .then(r => r.json())
      .then(d => setLiked(!!d.liked))
      .catch(() => {});
  }, [video.id]);

  async function toggleLike() {
    const prev = liked;
    setLiked(!prev);
    setLikes(l => prev ? Math.max(0, l - 1) : l + 1);
    try {
      await fetch(`/api/videos/like/${video.id}`, { method: "POST", headers: AUTH_H() });
    } catch {
      setLiked(prev);
      setLikes(l => prev ? l + 1 : Math.max(0, l - 1));
    }
  }

  async function toggleSave() {
    const prev = saved;
    setSaved(!prev);
    try {
      await fetch("/api/discover/save", {
        method: prev ? "DELETE" : "POST",
        headers: AUTH_H(),
        body: JSON.stringify({ targetType: "video", targetId: video.id }),
      });
    } catch {
      setSaved(prev);
    }
  }

  const hotel = video.hotel;
  const thumb = video.thumbnail_url || hotel?.images?.[0] || "";

  return (
    <div className="relative w-full flex-shrink-0" style={{ height: "100dvh", scrollSnapAlign: "start" }}>
      {/* Video */}
      <video
        ref={vidRef}
        src={video.s3_url}
        poster={thumb || undefined}
        muted={muted}
        loop
        playsInline
        preload="metadata"
        className="absolute inset-0 w-full h-full object-cover"
        onClick={() => setMuted(m => !m)}
        style={{ background: "#000" }}
      />

      {/* Dark gradient overlays */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/20 pointer-events-none" />

      {/* Top bar */}
      <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-4 pt-4 z-10">
        <Link href="/" className="text-white/80 text-sm font-bold tracking-widest" style={{ fontFamily: "monospace" }}>
          stay<span style={{ color: "#f0b429" }}>bid</span>
        </Link>
        <button
          onClick={() => setMuted(m => !m)}
          className="w-9 h-9 rounded-full bg-black/40 flex items-center justify-center text-lg backdrop-blur-sm">
          {muted ? "🔇" : "🔊"}
        </button>
      </div>

      {/* Right action rail */}
      <div className="absolute right-3 bottom-32 flex flex-col items-center gap-5 z-10">
        {/* Like */}
        <ActionBtn
          icon={liked ? "❤️" : "🤍"}
          label={fmtNum(likes)}
          onTap={toggleLike}
          active={liked}
        />
        {/* Comment */}
        <ActionBtn
          icon="💬"
          label={fmtNum(video.comments_count)}
          onTap={() => onComment(video)}
        />
        {/* Share */}
        <ActionBtn
          icon="↗️"
          label="Share"
          onTap={() => onShare(video)}
        />
        {/* Save */}
        <ActionBtn
          icon={saved ? "🔖" : "🏷️"}
          label="Save"
          onTap={toggleSave}
          active={saved}
        />
      </div>

      {/* Bottom overlay */}
      <div className="absolute bottom-0 left-0 right-16 px-4 pb-6 z-10">
        {/* Creator */}
        {video.uploaded_by && (
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-gold-400 to-gold-600 flex items-center justify-center text-white text-xs font-bold">
              ✨
            </div>
            <span className="text-white text-sm font-semibold">Creator</span>
          </div>
        )}

        {/* Title / caption */}
        <p className="text-white text-sm font-medium leading-snug mb-2 line-clamp-2">
          {video.title || (hotel ? `${hotel.name} · ${hotel.city}` : "Hotel Reel")}
        </p>

        {/* Hotel chip */}
        {hotel && (
          <Link
            href={`/hotels/${hotel.id}`}
            className="inline-flex items-center gap-1.5 bg-white/15 backdrop-blur-sm rounded-full px-3 py-1 text-white text-xs font-semibold border border-white/20">
            🏨 {hotel.name}
            {hotel.star_rating ? <span className="text-gold-300 text-[0.6rem]">{starStr(hotel.star_rating)}</span> : null}
          </Link>
        )}

        {/* Book CTA */}
        {hotel && (
          <Link
            href={`/hotels/${hotel.id}`}
            className="mt-3 flex items-center justify-center gap-2 w-full py-2.5 rounded-2xl font-bold text-sm text-white"
            style={{ background: "linear-gradient(135deg,#c9911a,#f0b429)" }}>
            🛎️ Book This Stay
          </Link>
        )}
      </div>

      {/* Play indicator (brief) */}
      {!playing && isActive && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-16 h-16 rounded-full bg-black/40 flex items-center justify-center text-4xl">▶</div>
        </div>
      )}
    </div>
  );
}

function ActionBtn({
  icon, label, onTap, active = false,
}: {
  icon: string; label: string | number; onTap: () => void; active?: boolean;
}) {
  const [pop, setPop] = useState(false);
  function tap() {
    setPop(true);
    setTimeout(() => setPop(false), 300);
    onTap();
  }
  return (
    <button
      onClick={tap}
      className="flex flex-col items-center gap-0.5"
      style={{ transform: pop ? "scale(1.35)" : "scale(1)", transition: "transform 0.15s" }}>
      <span className="text-2xl drop-shadow-lg">{icon}</span>
      <span className="text-white text-[0.6rem] font-semibold drop-shadow">{label}</span>
    </button>
  );
}

function fmtNum(n: number) {
  if (n >= 1000) return (n / 1000).toFixed(1) + "k";
  return String(n || 0);
}

// ── Comment drawer ────────────────────────────────────────────────────
function CommentDrawer({
  video,
  onClose,
}: { video: Video | null; onClose: () => void }) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [draft, setDraft]       = useState("");
  const [sending, setSending]   = useState(false);

  useEffect(() => {
    if (!video) return;
    setComments([]);
    fetch(`/api/videos/comments/${video.id}`)
      .then(r => r.json())
      .then(d => setComments(d.comments || []))
      .catch(() => {});
  }, [video?.id]);

  async function send() {
    if (!draft.trim() || !video) return;
    setSending(true);
    try {
      const res = await fetch(`/api/videos/comments/${video.id}`, {
        method: "POST",
        headers: AUTH_H(),
        body: JSON.stringify({ body: draft }),
      });
      const d = await res.json();
      if (d.comment) {
        setComments(c => [...c, d.comment]);
        setDraft("");
      }
    } catch {}
    setSending(false);
  }

  if (!video) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col justify-end"
      onClick={onClose}
      style={{ background: "rgba(0,0,0,0.5)" }}>
      <div
        className="bg-white rounded-t-3xl flex flex-col"
        style={{ maxHeight: "70dvh" }}
        onClick={e => e.stopPropagation()}>
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-gray-300" />
        </div>
        <div className="flex items-center justify-between px-5 pb-3">
          <h3 className="font-bold text-luxury-900">Comments ({fmtNum(comments.length)})</h3>
          <button onClick={onClose} className="text-luxury-500 text-xl">×</button>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto px-5 pb-2 space-y-3">
          {comments.length === 0 && (
            <p className="text-center text-luxury-500 text-sm py-8">No comments yet. Be the first!</p>
          )}
          {comments.map(c => (
            <div key={c.id} className="flex gap-2">
              <div className="w-7 h-7 rounded-full bg-luxury-100 flex items-center justify-center text-xs font-bold text-luxury-600 flex-shrink-0">
                {c.user_id.slice(0, 2).toUpperCase()}
              </div>
              <div>
                <p className="text-xs font-semibold text-luxury-700">{c.user_id.slice(0, 8)}…</p>
                <p className="text-sm text-luxury-800">{c.body}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Input */}
        <div className="border-t border-luxury-100 px-4 py-3 flex items-center gap-3">
          <input
            className="flex-1 border border-luxury-200 rounded-full px-4 py-2 text-sm focus:outline-none focus:border-gold-400"
            placeholder="Add a comment…"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") send(); }}
          />
          <button
            onClick={send}
            disabled={sending || !draft.trim()}
            className="px-4 py-2 rounded-full text-sm font-bold text-white disabled:opacity-40"
            style={{ background: "linear-gradient(135deg,#c9911a,#f0b429)" }}>
            {sending ? "…" : "Post"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Share sheet ───────────────────────────────────────────────────────
function ShareSheet({ video, onClose }: { video: Video | null; onClose: () => void }) {
  if (!video) return null;
  const v = video; // captured non-null local for closure narrowing
  const url  = `${typeof window !== "undefined" ? window.location.origin : "https://staybids.in"}/hotels/${v.hotel_id}`;
  const text = v.title || `Check out this hotel on StayBid! ${url}`;
  async function share(platform: string) {
    if (platform === "copy") {
      await navigator.clipboard.writeText(url).catch(() => {});
      alert("Link copied!");
      onClose();
      return;
    }
    if (platform === "native" && navigator.share) {
      await navigator.share({ title: v.title || "StayBid Reel", url }).catch(() => {});
      onClose();
      return;
    }
    const encodedText = encodeURIComponent(text);
    const encodedUrl  = encodeURIComponent(url);
    const links: Record<string, string> = {
      whatsapp:  `https://wa.me/?text=${encodedText}`,
      instagram: url,
      twitter:   `https://twitter.com/intent/tweet?text=${encodedText}`,
    };
    window.open(links[platform] || url, "_blank");
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end" onClick={onClose} style={{ background: "rgba(0,0,0,0.5)" }}>
      <div className="bg-white rounded-t-3xl p-6 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-luxury-900">Share</h3>
          <button onClick={onClose} className="text-luxury-500 text-xl">×</button>
        </div>
        <div className="grid grid-cols-4 gap-3">
          {[
            { id: "native",    emoji: "📤", label: "Share" },
            { id: "whatsapp",  emoji: "💬", label: "WhatsApp" },
            { id: "twitter",   emoji: "🐦", label: "Twitter" },
            { id: "copy",      emoji: "🔗", label: "Copy link" },
          ].map(s => (
            <button key={s.id} onClick={() => share(s.id)} className="flex flex-col items-center gap-1">
              <div className="w-14 h-14 rounded-2xl bg-luxury-50 border border-luxury-200 flex items-center justify-center text-2xl">
                {s.emoji}
              </div>
              <span className="text-[0.65rem] font-semibold text-luxury-600">{s.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Empty state ───────────────────────────────────────────────────────
function EmptyFeed() {
  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center bg-black text-white text-center px-8">
      <div className="text-6xl mb-4">🎬</div>
      <h2 className="font-bold text-xl mb-2">No reels yet</h2>
      <p className="text-white/60 text-sm mb-6">
        Be the first creator to upload a hotel reel and get discovered by thousands of travellers.
      </p>
      <Link
        href="/influencer/upload"
        className="px-8 py-3 rounded-full font-bold text-black"
        style={{ background: "linear-gradient(135deg,#c9911a,#f0b429)" }}>
        Upload Your First Reel
      </Link>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────
export default function ReelsPage() {
  const [videos, setVideos]           = useState<Video[]>([]);
  const [loading, setLoading]         = useState(true);
  const [activeIdx, setActiveIdx]     = useState(0);
  const [commentVideo, setCommentVideo] = useState<Video | null>(null);
  const [shareVideo, setShareVideo]   = useState<Video | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/videos/feed?limit=20")
      .then(r => r.json())
      .then(d => setVideos(d.videos || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Track which reel is visible via IntersectionObserver
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            const idx = Number((entry.target as HTMLElement).dataset.index);
            setActiveIdx(idx);
          }
        });
      },
      { threshold: 0.6 }
    );

    const cards = container.querySelectorAll("[data-index]");
    cards.forEach(c => observer.observe(c));
    return () => observer.disconnect();
  }, [videos]);

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black flex items-center justify-center">
        <div className="text-center text-white">
          <div className="text-5xl mb-3 animate-bounce">🎬</div>
          <p className="text-white/60 text-sm">Loading reels…</p>
        </div>
      </div>
    );
  }

  if (!loading && videos.length === 0) return <EmptyFeed />;

  return (
    <div className="fixed inset-0 bg-black overflow-hidden">
      {/* Scroll container */}
      <div
        ref={containerRef}
        className="h-full overflow-y-scroll"
        style={{ scrollSnapType: "y mandatory", scrollBehavior: "smooth", WebkitOverflowScrolling: "touch" }}>
        {videos.map((v, i) => (
          <div key={v.id} data-index={i} style={{ height: "100dvh" }}>
            <ReelCard
              video={v}
              isActive={i === activeIdx}
              onLike={(vid) => {
                setVideos(vs => vs.map(x => x.id === vid.id ? { ...x } : x));
              }}
              onComment={setCommentVideo}
              onShare={setShareVideo}
            />
          </div>
        ))}
      </div>

      {/* Progress dots */}
      {videos.length > 1 && (
        <div className="fixed right-1.5 top-1/2 -translate-y-1/2 flex flex-col gap-1 z-10">
          {videos.slice(0, 10).map((_, i) => (
            <div
              key={i}
              className="rounded-full transition-all"
              style={{
                width:  i === activeIdx ? 6 : 3,
                height: i === activeIdx ? 16 : 6,
                background: i === activeIdx ? "#f0b429" : "rgba(255,255,255,0.4)",
              }}
            />
          ))}
        </div>
      )}

      {/* Comment drawer */}
      {commentVideo && (
        <CommentDrawer video={commentVideo} onClose={() => setCommentVideo(null)} />
      )}

      {/* Share sheet */}
      {shareVideo && (
        <ShareSheet video={shareVideo} onClose={() => setShareVideo(null)} />
      )}
    </div>
  );
}
