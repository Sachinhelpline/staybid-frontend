"use client";
// /social/profile/[username] — adaptive profile page. Same layout for
// all three user types; ProfileHeader + ContentGrid pick up the type
// from the profile record and render the right badge / metadata.
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ProfileHeader } from "@/components/social/ProfileHeader";
import { ContentGrid } from "@/components/social/ContentGrid";

export default function SocialProfilePage() {
  const params = useParams();
  const username = String(params?.username || "").replace(/^@/, "");
  const [profile, setProfile] = useState<any | null>(null);
  const [posts, setPosts] = useState<any[]>([]);
  const [hotel, setHotel] = useState<any | null>(null);
  const [isFollowing, setIsFollowing] = useState(false);
  const [me, setMe] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"reels" | "photos" | "stories">("reels");

  useEffect(() => {
    const tok = typeof window !== "undefined" ? localStorage.getItem("sb_token") : null;
    const headers = tok ? { Authorization: `Bearer ${tok}` } : undefined;
    Promise.all([
      fetch(`/api/social/profiles/${encodeURIComponent(username)}`, { headers, cache: "no-store" }).then((r) => r.json()),
      tok ? fetch("/api/social/profiles/me", { headers }).then((r) => r.json()) : Promise.resolve(null),
    ]).then(([profRes, meRes]) => {
      if (profRes?.profile) {
        setProfile(profRes.profile);
        setHotel(profRes.hotel || null);
        setIsFollowing(!!profRes.isFollowing);
      }
      if (meRes?.profile) setMe(meRes.profile);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [username]);

  // Load this profile's posts
  useEffect(() => {
    if (!profile) return;
    const url = profile.user_type === "HOTEL" && profile.hotel_id
      ? `/api/social/feed/hotel/${encodeURIComponent(profile.hotel_id)}`
      : profile.user_type === "CREATOR" && profile.creator_id
      ? `/api/social/feed/creator/${encodeURIComponent(profile.creator_id)}`
      : `/api/social/feed?limit=50`;
    fetch(url, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        const list = Array.isArray(d?.posts) ? d.posts : [];
        // For PUBLIC profiles, filter to this author's posts
        const own = profile.user_type === "PUBLIC"
          ? list.filter((p: any) => p.author_id === profile.id)
          : list;
        setPosts(own);
      }).catch(() => {});
  }, [profile]);

  const toggleFollow = async () => {
    if (!profile) return;
    const tok = localStorage.getItem("sb_token");
    if (!tok) { window.location.href = "/auth"; return; }
    const next = !isFollowing;
    setIsFollowing(next);
    await fetch(`/api/social/profiles/follow/${encodeURIComponent(profile.user_id)}`, {
      method: next ? "POST" : "DELETE",
      headers: { Authorization: `Bearer ${tok}` },
    }).catch(() => setIsFollowing(!next));
  };

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center text-white/50">Loading…</div>
    );
  }
  if (!profile) {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center text-center text-white/70 px-8">
        <p className="text-6xl mb-3">🤷</p>
        <p className="text-base font-semibold mb-2">Profile not found</p>
        <Link href="/social/feed" className="text-gold-300 underline text-sm">Back to feed</Link>
      </div>
    );
  }

  const filteredByTab = posts.filter((p) =>
    tab === "reels" ? p.media_type === "REEL" :
    tab === "photos" ? p.media_type === "PHOTO" :
    p.media_type === "STORY"
  );

  return (
    <div className="min-h-dvh bg-black text-white overflow-x-hidden">
      <ProfileHeader
        profile={profile}
        postCount={posts.length}
        isFollowing={isFollowing}
        isOwnProfile={!!me && me.id === profile.id}
        onToggleFollow={toggleFollow}
      />

      {/* Hotel-specific extras shown only for HOTEL profiles */}
      {profile.user_type === "HOTEL" && hotel && (
        <div className="px-4 pb-3 flex items-center gap-3 text-[0.74rem] text-white/75">
          {hotel.starRating > 0 && <span>⭐ {"★".repeat(hotel.starRating)}</span>}
          {hotel.city && <span>📍 {hotel.city}{hotel.state ? `, ${hotel.state}` : ""}</span>}
          <Link href={`/hotels/${hotel.id}`} className="ml-auto text-gold-300 font-semibold">
            View hotel →
          </Link>
        </div>
      )}

      {/* Tabs: Reels / Photos / Stories */}
      <div className="grid grid-cols-3 border-t border-white/10">
        {(["reels", "photos", "stories"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="py-3 text-[0.72rem] font-bold tracking-wide uppercase relative"
            style={{ color: tab === t ? "#fff" : "rgba(255,255,255,0.62)" }}
          >
            {t === "reels" ? "▶ Reels" : t === "photos" ? "📷 Photos" : "📖 Stories"}
            {tab === t && (
              <span className="absolute left-1/4 right-1/4 bottom-0 h-[2px]"
                style={{ background: "linear-gradient(90deg,#d0d9e1,#ff458d,#b964ff)" }} />
            )}
          </button>
        ))}
      </div>

      <ContentGrid posts={filteredByTab} />
    </div>
  );
}
