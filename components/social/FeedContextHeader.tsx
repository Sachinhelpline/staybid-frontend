"use client";
// Above-the-reel context header: "whose feed is this".
// Adapts by user_type:
//   HOTEL:   🏨 name · ✓ Verified · ⭐ rating · 📍 city · followers · Open Now
//   CREATOR: ✦ @handle · Creator · followers
//   PUBLIC:  • @handle · Member since YYYY · followers
import Link from "next/link";
import { ProfileBadge } from "@/components/social/ProfileBadge";

type UserType = "PUBLIC" | "CREATOR" | "HOTEL";

type Props = {
  profile: {
    id: string;
    username: string;
    display_name: string;
    user_type: UserType;
    follower_count: number;
    avatar_url?: string | null;
    is_verified: boolean;
    is_creator: boolean;
    created_at?: string;
  };
  hotel?: {
    name: string; city?: string | null; state?: string | null;
    avgRating?: number; starRating?: number;
  } | null;
  isFollowing: boolean;
  onToggleFollow: () => void;
};

function fmt(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "K";
  return String(n);
}

export function FeedContextHeader({ profile, hotel, isFollowing, onToggleFollow }: Props) {
  const initials = (profile.display_name || profile.username || "?").split(" ").slice(0, 2).map((s) => s[0]).join("").toUpperCase();
  const memberYear = profile.created_at ? new Date(profile.created_at).getFullYear() : new Date().getFullYear();

  return (
    <div
      className="flex items-center gap-3 p-3 rounded-2xl"
      style={{
        background: "linear-gradient(180deg, rgba(20,16,30,0.85), rgba(10,8,20,0.85))",
        border: "1px solid rgba(255,255,255,0.10)",
        backdropFilter: "blur(14px)",
        WebkitBackdropFilter: "blur(14px)",
      }}
    >
      <Link href={`/social/profile/${profile.username}`} className="shrink-0">
        <div
          className="w-12 h-12 rounded-full overflow-hidden flex items-center justify-center text-base font-bold text-black"
          style={{ background: "linear-gradient(160deg,#e6edf3 0%,#c9d4df 52%,#a4b5c6 100%)", border: "2px solid rgba(255,255,255,0.5)" }}
        >
          {profile.avatar_url ? <img src={profile.avatar_url} alt="" className="w-full h-full object-cover" /> : initials}
        </div>
      </Link>

      <div className="flex-1 min-w-0">
        {profile.user_type === "HOTEL" ? (
          <>
            <div className="flex items-center gap-1.5">
              <span className="text-white font-bold text-[0.92rem] truncate">🏨 {profile.display_name}</span>
            </div>
            <div className="mt-0.5 flex items-center gap-1.5 text-[0.66rem] text-white/75 flex-wrap">
              <ProfileBadge userType="HOTEL" size="xs" />
              {hotel?.avgRating ? <><span className="opacity-50">·</span><span>⭐ {hotel.avgRating.toFixed(1)}</span></> : null}
              {hotel?.city ? <><span className="opacity-50">·</span><span>📍 {hotel.city}</span></> : null}
            </div>
            <div className="mt-1 text-[0.62rem] text-white/65">
              {fmt(profile.follower_count)} followers · <span className="text-emerald-300">Open Now</span>
            </div>
          </>
        ) : profile.user_type === "CREATOR" ? (
          <>
            <div className="flex items-center gap-1.5">
              <span className="text-white font-bold text-[0.92rem] truncate">@{profile.username}</span>
            </div>
            <div className="mt-0.5 flex items-center gap-1.5 text-[0.66rem] text-white/75">
              <ProfileBadge userType="CREATOR" size="xs" />
              <span className="opacity-50">·</span>
              <span>Travel & Hotels</span>
            </div>
            <div className="mt-1 text-[0.62rem] text-white/65">{fmt(profile.follower_count)} followers</div>
          </>
        ) : (
          <>
            <div className="flex items-center gap-1.5">
              <span className="text-white font-bold text-[0.92rem] truncate">@{profile.username}</span>
            </div>
            <div className="mt-0.5 flex items-center gap-1.5 text-[0.66rem] text-white/75">
              <ProfileBadge userType="PUBLIC" size="xs" />
              <span className="opacity-50">·</span>
              <span>Member since {memberYear}</span>
            </div>
            <div className="mt-1 text-[0.62rem] text-white/65">{fmt(profile.follower_count)} followers</div>
          </>
        )}
      </div>

      <button
        onClick={onToggleFollow}
        className="px-4 py-2 rounded-full text-[0.78rem] font-bold shrink-0"
        style={isFollowing ? {
          background: "rgba(255,255,255,0.10)",
          color: "#fff",
          border: "1px solid rgba(255,255,255,0.30)",
        } : {
          background: "linear-gradient(160deg,#e6edf3 0%,#c9d4df 52%,#a4b5c6 100%)",
          color: "#1a1208",
          border: "1px solid rgba(255,255,255,0.45)",
          boxShadow: "0 3px 10px rgba(140, 160, 182,0.4)",
        }}
      >
        {isFollowing ? "Following" : "Follow"}
      </button>
    </div>
  );
}
