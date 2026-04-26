"use client";
import { useEffect, useState } from "react";
import { detectDevice, pickProfile, pickUrlForProfile, DeliveryProfile } from "@/lib/verify/adaptive";

// Uses vp_videos.urls JSONB ({ 360p, 480p, 720p, src }) to pick the best
// variant for the customer's device + network. Falls back to the original
// upload (`src`) if transcoding hasn't finished yet.
export default function AdaptiveVideoPlayer({
  src,
  urls,
  className = "",
}: {
  src: string;
  urls?: Record<string, string>;
  className?: string;
}) {
  const [profile, setProfile] = useState<DeliveryProfile | null>(null);

  useEffect(() => { setProfile(pickProfile(detectDevice())); }, []);

  if (!profile) {
    // SSR / first paint — neutral default
    return <video src={src} controls playsInline className={className} />;
  }
  const chosen = pickUrlForProfile(urls, profile, src);

  return (
    <div className={`relative ${className}`}>
      <video src={chosen} preload={profile.preload} controls playsInline className="w-full h-full rounded-xl bg-black" />
      <div className="absolute top-2 right-2 px-2 py-0.5 rounded-full bg-black/60 text-white text-[10px] font-semibold">
        {profile.label}
      </div>
      {profile.showDataWarning && (
        <div className="absolute bottom-2 left-2 right-2 text-[11px] text-amber-200 bg-amber-900/70 backdrop-blur px-2 py-1 rounded">
          Slow network detected — playing 360p to save data.
        </div>
      )}
    </div>
  );
}
