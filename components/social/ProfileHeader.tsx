"use client";
// Profile page header — cover photo + avatar + display name + badge +
// follow button + 3-stat row.
import { ProfileBadge } from "@/components/social/ProfileBadge";

type Props = {
  profile: {
    username: string;
    display_name: string;
    bio?: string | null;
    avatar_url?: string | null;
    cover_url?: string | null;
    follower_count: number;
    following_count: number;
    is_verified: boolean;
    is_creator: boolean;
    user_type: "PUBLIC" | "CREATOR" | "HOTEL";
  };
  postCount: number;
  isFollowing: boolean;
  isOwnProfile: boolean;
  onToggleFollow: () => void;
  onEditProfile?: () => void;
};

function fmt(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "K";
  return String(n);
}

export function ProfileHeader({ profile, postCount, isFollowing, isOwnProfile, onToggleFollow, onEditProfile }: Props) {
  const initials = (profile.display_name || profile.username).split(" ").slice(0, 2).map((s) => s[0]).join("").toUpperCase();

  return (
    <div className="relative">
      {/* Cover */}
      <div
        className="w-full h-36"
        style={{
          background: profile.cover_url
            ? `url(${profile.cover_url}) center/cover`
            : "linear-gradient(135deg, #1a1530, #0d1a2e 50%, #2a1845)",
        }}
      />

      {/* Avatar + name + actions */}
      <div className="px-4 pt-3 pb-4 -mt-12">
        <div className="flex items-end gap-3 mb-3">
          <div
            className="w-24 h-24 rounded-full overflow-hidden flex items-center justify-center text-2xl font-bold text-black shrink-0"
            style={{
              background: "linear-gradient(135deg,#ffd76b,#f0b429)",
              border: "3px solid #0a0a0a",
              boxShadow: "0 4px 18px rgba(0,0,0,0.6)",
            }}
          >
            {profile.avatar_url ? <img src={profile.avatar_url} alt="" className="w-full h-full object-cover" /> : initials}
          </div>
          <div className="flex-1 grid grid-cols-3 gap-2 text-center">
            <div>
              <p className="text-white font-bold text-base leading-none">{fmt(postCount)}</p>
              <p className="text-white/55 text-[0.6rem] mt-1">Posts</p>
            </div>
            <div>
              <p className="text-white font-bold text-base leading-none">{fmt(profile.follower_count)}</p>
              <p className="text-white/55 text-[0.6rem] mt-1">Followers</p>
            </div>
            <div>
              <p className="text-white font-bold text-base leading-none">{fmt(profile.following_count)}</p>
              <p className="text-white/55 text-[0.6rem] mt-1">Following</p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5 mb-1">
          <span className="text-white font-bold text-[0.95rem]">{profile.display_name}</span>
          <ProfileBadge userType={profile.user_type} size="xs" />
        </div>
        <p className="text-white/55 text-[0.7rem] mb-2">@{profile.username}</p>
        {profile.bio && (
          <p className="text-white/80 text-[0.78rem] leading-snug whitespace-pre-line mb-3">{profile.bio}</p>
        )}

        <div className="flex gap-2">
          {isOwnProfile ? (
            <button
              onClick={onEditProfile}
              className="flex-1 py-2.5 rounded-xl text-[0.82rem] font-bold"
              style={{ background: "rgba(255,255,255,0.10)", color: "#fff", border: "1px solid rgba(255,255,255,0.18)" }}
            >
              Edit Profile
            </button>
          ) : (
            <button
              onClick={onToggleFollow}
              className="flex-1 py-2.5 rounded-xl text-[0.82rem] font-bold"
              style={isFollowing ? {
                background: "rgba(255,255,255,0.10)", color: "#fff", border: "1px solid rgba(255,255,255,0.30)",
              } : {
                background: "linear-gradient(135deg,#ffd76b,#f0b429)", color: "#1a1208",
                border: "1px solid rgba(255,255,255,0.45)",
                boxShadow: "0 4px 12px rgba(240,180,41,0.4)",
              }}
            >
              {isFollowing ? "✓ Following" : "+ Follow"}
            </button>
          )}
          <button
            className="px-4 py-2.5 rounded-xl text-[0.82rem] font-semibold"
            style={{ background: "rgba(255,255,255,0.06)", color: "#fff", border: "1px solid rgba(255,255,255,0.18)" }}
          >
            ↗ Share
          </button>
        </div>
      </div>
    </div>
  );
}
