"use client";
// /u/[username]/posts — IG-style scroll feed of one user's posts (v110)
// ═══════════════════════════════════════════════════════════════════════════
// Reached by tapping a tile on /u/[username]. Same scroll-feed pattern as
// /me/posts and /saved/posts (PostsScrollFeed), just scoped to a specific
// profile. Pulls real posts from /api/social/feed?author=<profile.id> when
// the username resolves to a real social_profiles row.
// ═══════════════════════════════════════════════════════════════════════════
import { Suspense, useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { sanitizeText } from "@/lib/sanitize-text";
import { PostsScrollFeed, type FeedPost } from "@/components/PostsScrollFeed";

function UserPostsInner() {
  const params = useParams<{ username: string }>();
  const sp     = useSearchParams();
  const startId = sp?.get("start") || "";
  const handle = decodeURIComponent(String(params?.username || "")).replace(/^@/, "").trim();

  const [profile, setProfile] = useState<any>(null);
  const [posts, setPosts]     = useState<any[]>([]);

  useEffect(() => {
    if (!handle) return;
    let cancelled = false;
    fetch(`/api/social/profiles/${encodeURIComponent(handle)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then(async (d) => {
        if (cancelled) return;
        const p = d?.profile;
        if (!p) { setProfile(null); setPosts([]); return; }
        setProfile(p);
        try {
          const pr = await fetch(
            `/api/social/feed?author=${encodeURIComponent(p.id)}&limit=60`,
            { cache: "no-store" }
          );
          if (pr.ok) {
            const pd = await pr.json().catch(() => null);
            if (!cancelled) setPosts(pd?.posts || []);
          }
        } catch { /* non-fatal */ }
      });
    return () => { cancelled = true; };
  }, [handle]);

  const feedPosts: FeedPost[] = useMemo(() => {
    const ownerName  = profile?.display_name || prettyName(handle);
    const ownerAvatar = profile?.avatar_url || "";
    return posts.map((rp): FeedPost => {
      const kind = String(rp.media_type || "").toLowerCase();
      const isVideo = kind === "reel" || kind === "video";
      return {
        id: String(rp.id),
        kind: isVideo ? "video" : "image",
        src: rp.media_url || "",
        poster: rp.thumbnail_url || "",
        caption: sanitizeText(rp.caption || "").clean,
        ownerName,
        ownerHandle: handle,
        ownerAvatar,
        audioLine: "Original audio",
        likeCount:    Number(rp.likes_count    || rp.like_count    || 0),
        commentCount: Number(rp.comments_count || rp.comment_count || 0),
        hotelId: rp.hotel_id || undefined,
      };
    });
  }, [posts, profile, handle]);

  return (
    <PostsScrollFeed
      posts={feedPosts}
      startId={startId}
      headerTitle={prettyName(handle)}
      mode="viewer"
    />
  );
}

export default function UserPostsPage() {
  return (
    <Suspense fallback={<div style={{ padding: 40, textAlign: "center" }}>Loading…</div>}>
      <UserPostsInner />
    </Suspense>
  );
}

function prettyName(h: string): string {
  return (h || "").split(/[._-]+/).filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ") || h;
}
