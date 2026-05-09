"use client";
// /social/feed — paginated vertical reel feed across all user types.
// Loads posts from /api/social/feed and renders one ReelCard per post.
import { useEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";
import { ReelCard } from "@/components/social/ReelCard";

type Post = any;

export default function SocialFeedPage() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [muted, setMuted] = useState(true);
  const [activeIdx, setActiveIdx] = useState(0);
  const [follows, setFollows] = useState<Record<string, boolean>>({});
  const [likes, setLikes] = useState<Record<string, boolean>>({});
  const [saves, setSaves] = useState<Record<string, boolean>>({});
  const [me, setMe] = useState<any | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Resolve viewer profile (lazy auto-create if needed)
  useEffect(() => {
    const tok = typeof window !== "undefined" ? localStorage.getItem("sb_token") : null;
    if (!tok) return;
    fetch("/api/social/profiles/me", { headers: { Authorization: `Bearer ${tok}` } })
      .then((r) => r.json())
      .then((d) => { if (d?.profile) setMe(d.profile); })
      .catch(() => {});
  }, []);

  const loadMore = useCallback(async () => {
    if (loading || !hasMore) return;
    setLoading(true);
    const params = new URLSearchParams();
    if (cursor) params.set("cursor", cursor);
    params.set("limit", "12");
    try {
      const r = await fetch(`/api/social/feed?${params}`, { cache: "no-store" });
      const d = await r.json();
      if (Array.isArray(d?.posts) && d.posts.length) {
        setPosts((prev) => [...prev, ...d.posts]);
        setCursor(d.nextCursor || null);
        if (!d.nextCursor) setHasMore(false);
      } else {
        setHasMore(false);
      }
    } catch { setHasMore(false); }
    finally { setLoading(false); }
  }, [cursor, hasMore, loading]);

  useEffect(() => { loadMore(); }, []);  // initial load

  // IntersectionObserver — track active card + paginate near end
  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    const cards = root.querySelectorAll<HTMLElement>("section[data-reel-card]");
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting && e.intersectionRatio > 0.6)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible) {
          const idx = Array.from(cards).indexOf(visible.target as HTMLElement);
          if (idx >= 0 && idx !== activeIdx) {
            setActiveIdx(idx);
            if (idx >= posts.length - 3 && hasMore) loadMore();
          }
        }
      },
      { root, threshold: [0.6, 0.85] }
    );
    cards.forEach((c) => io.observe(c));
    return () => io.disconnect();
  }, [posts.length, activeIdx, hasMore, loadMore]);

  const onToggleFollow = async (post: Post) => {
    const targetUserId = post.author?.user_id;
    if (!targetUserId) return;
    const tok = localStorage.getItem("sb_token");
    if (!tok) { window.location.href = "/auth"; return; }
    const next = !follows[targetUserId];
    setFollows((f) => ({ ...f, [targetUserId]: next }));
    await fetch(`/api/social/profiles/follow/${encodeURIComponent(targetUserId)}`, {
      method: next ? "POST" : "DELETE",
      headers: { Authorization: `Bearer ${tok}` },
    }).catch(() => {});
  };

  return (
    <div className="fixed inset-0 bg-black overflow-hidden">
      {/* Top branding */}
      <div className="absolute top-0 left-0 right-0 z-40 flex items-center justify-between px-4 pt-3 pb-2 bg-gradient-to-b from-black/55 to-transparent pointer-events-none">
        <Link
          href="/social/upload"
          className="pointer-events-auto px-3 py-1.5 rounded-full text-[0.7rem] font-bold"
          style={{ background: "linear-gradient(135deg,#ff458d,#b964ff)", color: "#fff", boxShadow: "0 4px 12px rgba(255,69,141,0.45)" }}
        >+ Create</Link>
        <span
          className="pointer-events-auto text-[0.6rem] font-bold tracking-widest uppercase"
          style={{ background: "linear-gradient(135deg,#ff458d,#b964ff)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}
        >StayBid · Social</span>
        {me ? (
          <Link
            href={`/social/profile/${me.username}`}
            className="pointer-events-auto w-8 h-8 rounded-full flex items-center justify-center text-[0.7rem] font-bold text-black"
            style={{ background: "linear-gradient(135deg,#ffd76b,#f0b429)", border: "1.5px solid rgba(255,255,255,0.5)" }}
          >
            {me.avatar_url ? <img src={me.avatar_url} alt="" className="w-full h-full object-cover rounded-full" /> : (me.display_name || "U")[0]}
          </Link>
        ) : (
          <Link href="/auth" className="pointer-events-auto text-white/85 text-[0.7rem] font-bold">Login</Link>
        )}
      </div>

      <div
        ref={containerRef}
        className="h-[100dvh] overflow-y-auto overflow-x-hidden"
        style={{ scrollSnapType: "y mandatory", scrollBehavior: "smooth", scrollbarWidth: "none" } as any}
      >
        {posts.map((post, i) => (
          <div key={post.id} data-reel-card>
            <ReelCard
              post={post}
              active={i === activeIdx}
              viewerProfileId={me?.id || null}
              isFollowing={!!(post.author?.user_id && follows[post.author.user_id])}
              isLiked={!!likes[post.id]}
              isSaved={!!saves[post.id]}
              muted={muted}
              onToggleMute={() => setMuted((m) => !m)}
              onToggleFollow={() => onToggleFollow(post)}
              onToggleLike={() => setLikes((l) => ({ ...l, [post.id]: !l[post.id] }))}
              onComment={() => {}}
              onShare={async () => {
                const url = `${window.location.origin}/social/profile/${post.author?.username}`;
                if ((navigator as any).share) (navigator as any).share({ url }).catch(() => {});
                else navigator.clipboard?.writeText(url).catch(() => {});
              }}
              onSave={() => setSaves((s) => ({ ...s, [post.id]: !s[post.id] }))}
              onMore={() => {}}
            />
          </div>
        ))}
        {!loading && posts.length === 0 && (
          <div className="h-[100dvh] flex flex-col items-center justify-center text-center text-white/70 px-8">
            <p className="text-6xl mb-3">🎬</p>
            <p className="text-base font-semibold mb-2">No posts yet</p>
            <p className="text-sm text-white/55 mb-4">Be the first — tap + Create to upload a reel.</p>
            <Link href="/social/upload" className="px-4 py-2 rounded-full bg-gold-400 text-black font-bold text-sm">+ Create your first reel</Link>
          </div>
        )}
      </div>
    </div>
  );
}
