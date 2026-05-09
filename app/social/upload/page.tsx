"use client";
// /social/upload — minimal upload flow that ships a post to /api/social/posts.
// Uses the existing CreateFlow Composer for media + caption + audio +
// location. On Post: writes the resulting blob to social_posts via the
// new API route, then routes back to /social/feed.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CreateFlow } from "@/components/discover/CreateFlow";

export default function SocialUploadPage() {
  const router = useRouter();
  const [me, setMe] = useState<any | null>(null);
  const [postedToast, setPostedToast] = useState<string | null>(null);

  useEffect(() => {
    const tok = typeof window !== "undefined" ? localStorage.getItem("sb_token") : null;
    if (!tok) { router.replace("/auth"); return; }
    fetch("/api/social/profiles/me", { headers: { Authorization: `Bearer ${tok}` } })
      .then((r) => r.json())
      .then((d) => { if (d?.profile) setMe(d.profile); })
      .catch(() => {});
  }, [router]);

  return (
    <div className="min-h-[100dvh] bg-black text-white relative">
      <header className="px-4 pt-4 pb-3 flex items-center justify-between border-b border-white/8">
        <button onClick={() => router.back()} className="text-white/85 text-sm">‹ Back</button>
        <p className="font-bold text-base">Create</p>
        <div style={{ width: 60 }} />
      </header>

      <div className="px-6 py-12 text-center">
        <p className="text-5xl mb-3">🎬 📷 📖</p>
        <p className="text-base font-semibold mb-1.5">Tap the + button to start</p>
        <p className="text-white/55 text-[0.84rem] max-w-sm mx-auto">
          Pick a Reel / Photo / Story type, choose your media, attach a soundtrack and location, then post to your profile.
        </p>
        {me && (
          <p className="mt-6 text-[0.74rem] text-white/55">
            Posting as <span className="text-gold-300 font-semibold">@{me.username}</span>
          </p>
        )}
      </div>

      {/* The CreateFlow component renders its own floating + FAB and handles
          the entire pick → caption → audio → location → post flow. We hook
          its onPosted callback to also write to social_posts. */}
      <CreateFlow
        onPosted={async (p) => {
          const tok = localStorage.getItem("sb_token");
          if (!tok) return;
          try {
            await fetch("/api/social/posts", {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` },
              body: JSON.stringify({
                mediaType: p.kind.toUpperCase(),
                mediaUrl:  p.mediaUrl,
                thumbnailUrl: p.posterUrl || null,
                caption:   p.caption || "",
                soundTrack: p.audio?.name || null,
                soundUrl:   p.audio?.url || null,
                locationName: p.location?.name || null,
                locationLat:  p.location?.lat,
                locationLng:  p.location?.lng,
              }),
            });
            setPostedToast("✓ Posted to your social profile");
            setTimeout(() => router.push("/social/feed"), 800);
          } catch {}
        }}
      />

      {postedToast && (
        <div
          className="fixed top-16 left-1/2 -translate-x-1/2 z-[100] px-4 py-2 rounded-full text-white text-[0.78rem] font-semibold"
          style={{
            background: "rgba(20,16,30,0.85)",
            border: "1px solid rgba(255,255,255,0.18)",
            backdropFilter: "blur(14px)",
            WebkitBackdropFilter: "blur(14px)",
          }}
        >
          {postedToast}
        </div>
      )}
    </div>
  );
}
