"use client";
// ═══════════════════════════════════════════════════════════════════════════
// /saved/posts — Instagram-style "All Posts" view for the user's saved reels.
//
// Reached by tapping any video card on the /saved grid. Mirrors the IG profile
// → All Posts pattern (header chrome = "← All Posts", scrollable feed of
// saved reels, auto-plays the most visible card, scrolls to the tapped post
// on mount). Replaces the v85 ReelPlayerModal.
//
// Data: same merge as /saved (local `sb_local_saves` first, then enriched
// remote /api/discover/saves/enriched), filtered to `target_type === "video"`.
// ═══════════════════════════════════════════════════════════════════════════
import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { sanitizeText } from "@/lib/sanitize-text";
import { PostsScrollFeed, type FeedPost } from "@/components/PostsScrollFeed";

function SavedPostsInner() {
  const sp = useSearchParams();
  const startId = sp?.get("start") || "";
  const { user, loading: authLoading } = useAuth();
  const [saves, setSaves] = useState<any[]>([]);

  useEffect(() => {
    if (authLoading) return;
    // Local-first hydration — same approach /saved uses.
    let localSaves: any[] = [];
    try {
      const raw = typeof window !== "undefined"
        ? localStorage.getItem("sb_local_saves") : null;
      if (raw) localSaves = JSON.parse(raw) || [];
    } catch {}
    localSaves = localSaves.filter((s) => s.target_type === "video");

    if (!user) {
      setSaves(localSaves);
      return;
    }
    const tok = typeof window !== "undefined"
      ? (localStorage.getItem("sb_token") || "") : "";
    fetch("/api/discover/saves/enriched?type=video", {
      headers: { Authorization: `Bearer ${tok}` },
    })
      .then((r) => r.json())
      .then((d) => {
        const remote = d.saves || [];
        const keyOf = (s: any) => `${s.target_type}:${s.target_id}`;
        const seen = new Set<string>();
        const merged: any[] = [];
        localSaves.forEach((s) => {
          const k = keyOf(s);
          if (!seen.has(k)) { seen.add(k); merged.push(s); }
        });
        remote.forEach((s: any) => {
          const k = keyOf(s);
          if (!seen.has(k)) { seen.add(k); merged.push(s); }
        });
        setSaves(merged);
      })
      .catch(() => setSaves(localSaves));
  }, [user, authLoading]);

  // Normalize each save into a FeedPost. The startId param matches
  // target_id on the save row (the underlying video id), which is what
  // /saved passes when navigating in.
  const feedPosts: FeedPost[] = useMemo(() => {
    return saves
      .map((s): FeedPost | null => {
        const t = s.target;
        if (!t) return null;
        const owner = t.uploader_name || t.creator_name || t.hotel_name || "Creator";
        const handle = t.uploader_handle || t.creator_handle || t.hotel_handle || "";
        return {
          id: String(s.target_id),
          kind: "video",
          src: t.s3_url || t.media_url || t.url || "",
          poster: t.thumbnail_url || t.poster_url || "",
          caption: sanitizeText(t.caption || t.title || "").clean,
          ownerName: owner,
          ownerHandle: handle ? String(handle).replace(/^@/, "") : "",
          ownerAvatar: t.uploader_avatar_url || t.creator_avatar_url || "",
          // v121 — surface the soundtrack so saved reels play audio + render
          // the chosen filter + show the actual hotel name (not "View hotel").
          audioLine: t.sound_track || t.audio_name || (t.sound_url ? "Custom audio" : "Original audio"),
          audioUrl:  t.sound_url   || undefined,
          likeCount: Number(t.likes_count || 0),
          commentCount: Number(t.comments_count || 0),
          hotelId:   t.hotel_id   || undefined,
          hotelName: t.hotel_name || t.hotel?.name || undefined,
          locationName: t.location_name || undefined,
          filterPreset: t.filter || null,
        };
      })
      .filter((p): p is FeedPost => !!p && !!p.src);
  }, [saves]);

  return (
    <PostsScrollFeed
      posts={feedPosts}
      startId={startId}
      headerTitle="All Posts"
      mode="viewer"
    />
  );
}

export default function SavedPostsPage() {
  return (
    <Suspense fallback={<div style={{ padding: 40, textAlign: "center" }}>Loading…</div>}>
      <SavedPostsInner />
    </Suspense>
  );
}
