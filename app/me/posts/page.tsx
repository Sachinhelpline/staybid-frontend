"use client";
// /me/posts — IG-style "Posts" view (v86)
// ═══════════════════════════════════════════════════════════════════════════
// /me/posts — Instagram-style "Posts" view for the current user.
//
// Reached by tapping any tile on the /me profile grid. Mirrors the IG profile
// → Posts pattern (header chrome = "← Posts", scrollable feed of the user's
// own posts, auto-plays the most visible card, scrolls to the tapped post
// on mount). Replaces the v85 ReelPlayerModal.
//
// Data sources (same as /me):
//   • PostsStore (in-memory + localStorage) — instant-after-upload
//   • /api/social/feed?author=<myUserId> — Supabase social_posts
//   • /api/influencer/my-videos — hotel_videos (legacy creator path)
// ═══════════════════════════════════════════════════════════════════════════
import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { useFollow } from "@/lib/follow-store";
import { usePosts } from "@/lib/posts-store";
import { sanitizeText } from "@/lib/sanitize-text";
import { PostsScrollFeed, type FeedPost } from "@/components/PostsScrollFeed";

function MePostsInner() {
  const sp = useSearchParams();
  const startId = sp?.get("start") || "";
  const { user } = useAuth();
  const { myDisplayName, myAvatarUrl } = useFollow();
  // v111 — destructure removePost so the local entry vanishes when the
  // owner deletes the post from the kebab menu in PostsScrollFeed.
  const { posts, removePost } = usePosts();
  const [remotePosts, setRemotePosts] = useState<any[]>([]);

  // Decode the user's id from the JWT — same logic as /me.
  const myUserId = useMemo(() => {
    if (typeof window === "undefined") return "";
    try {
      const t = localStorage.getItem("sb_token") || "";
      if (!t) return "";
      const p = JSON.parse(atob(t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
      return p.id || p.user_id || p.sub || "";
    } catch { return ""; }
  }, []);

  useEffect(() => {
    if (!myUserId) return;
    const tok = typeof window !== "undefined" ? (localStorage.getItem("sb_token") || "") : "";
    Promise.all([
      // v110 — same fix as /me page: pass authorUser (auth user id) so the
      // route resolves to the social_profiles.id internally. Passing the
      // bare auth id to `?author=` previously matched no rows on the
      // social_posts table (author_id holds the profile id), which is why
      // /me/posts showed "Nothing to show yet" even when the user had
      // uploads on the server.
      fetch(`/api/social/feed?authorUser=${encodeURIComponent(myUserId)}&limit=60`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
      tok
        ? fetch("/api/influencer/my-videos", {
            headers: { Authorization: `Bearer ${tok}` },
            cache: "no-store",
          })
            .then((r) => (r.ok ? r.json() : null))
            .catch(() => null)
        : Promise.resolve(null),
    ]).then(([social, videos]) => {
      const out: any[] = [];
      if (social?.posts) out.push(...social.posts);
      if (videos?.videos) {
        videos.videos.forEach((v: any) => {
          out.push({
            id: v.id,
            media_type: "REEL",
            media_url: v.s3_url || v.url || "",
            thumbnail_url: v.thumbnail_url || "",
            caption: v.title || v.caption || "",
            created_at: v.created_at,
          });
        });
      }
      setRemotePosts(out);
    });
  }, [myUserId]);

  // Same merge logic as /me but flatten into the FeedPost shape.
  const feedPosts: FeedPost[] = useMemo(() => {
    const handle = (user as any)?.phone
      ? String((user as any).phone).replace(/^\+91/, "")
      : "you";
    const ownerName = myDisplayName || handle;
    const ownerHandle = handle;
    const ownerAvatar = myAvatarUrl || "";

    const merged: any[] = [];
    const seen = new Set<string>();
    posts.forEach((p) => {
      const id = String(p.id);
      if (!seen.has(id)) { seen.add(id); merged.push({ src: "local", post: p }); }
    });
    remotePosts.forEach((rp) => {
      const id = String(rp.id);
      if (seen.has(id)) return;
      seen.add(id);
      merged.push({ src: "remote", post: rp });
    });

    return merged
      .filter((row) => {
        // Exclude expired stories (matches /me visible filter for the Posts tab).
        if (row.src === "local") {
          const p = row.post;
          return p.kind !== "story" || p.keepAsPost;
        }
        return true;
      })
      .map((row): FeedPost => {
        if (row.src === "local") {
          const p = row.post;
          const isVideo = p.kind === "reel" || /^video\//i.test(p.mediaMime || "");
          return {
            id: String(p.id),
            kind: isVideo ? "video" : "image",
            src: p.mediaUrl || "",
            poster: p.posterUrl || "",
            caption: sanitizeText(p.caption || "").clean,
            ownerName,
            ownerHandle,
            ownerAvatar,
            audioLine: p.audio?.name ? p.audio.name : "Original audio",
            likeCount: 0,
            commentCount: 0,
            hotelId: p.taggedHotel?.id || undefined,
            // v112.2 — surface local edit-post fields so the Edit sheet
            // pre-fills them correctly.
            locationName:    p.location?.name || undefined,
            hideLikes:       !!p.hideLikes,
            disableComments: !!p.disableComments,
            highlightKey:    p.highlight?.key || undefined,
          };
        }
        const rp = row.post;
        const kind = String(rp.media_type || "").toLowerCase();
        const isVideo = kind === "reel" || kind === "video";
        return {
          id: String(rp.id),
          kind: isVideo ? "video" : "image",
          src: rp.media_url || "",
          poster: rp.thumbnail_url || "",
          caption: sanitizeText(rp.caption || "").clean,
          ownerName,
          ownerHandle,
          ownerAvatar,
          audioLine: "Original audio",
          likeCount: Number(rp.likes_count || 0),
          commentCount: Number(rp.comments_count || 0),
          hotelId:         rp.hotel_id || undefined,
          // v112.2 — surface server-side edit-post fields.
          locationName:    rp.location_name || undefined,
          hideLikes:       !!rp.hide_likes,
          disableComments: !!rp.disable_comments,
          highlightKey:    rp.highlight_key || undefined,
        };
      });
  }, [posts, remotePosts, myDisplayName, myAvatarUrl, user]);

  return (
    <PostsScrollFeed
      posts={feedPosts}
      startId={startId}
      headerTitle="Posts"
      mode="owner"
      // v111 — owner controls. Delete removes from BOTH local PostsStore
      // AND the remotePosts state so the card vanishes instantly. Server
      // already soft-deletes via /api/social/posts/[id] DELETE.
      onPostDeleted={(id) => {
        try { removePost(id); } catch {}
        setRemotePosts((prev) => prev.filter((rp) => String(rp.id) !== String(id)));
      }}
      onPostEdited={(id, patch) => {
        if (typeof patch.caption === "string") {
          setRemotePosts((prev) => prev.map((rp) =>
            String(rp.id) === String(id) ? { ...rp, caption: patch.caption } : rp));
        }
      }}
    />
  );
}

export default function MePostsPage() {
  return (
    <Suspense fallback={<div style={{ padding: 40, textAlign: "center" }}>Loading…</div>}>
      <MePostsInner />
    </Suspense>
  );
}
