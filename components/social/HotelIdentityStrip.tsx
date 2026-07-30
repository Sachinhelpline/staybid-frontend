"use client";
// Bottom-of-reel hotel identity strip — only renders when the post has
// a tagged hotel (hotel_id set). Layout follows the spec exactly:
// avatar + hotel name + verified pill + star rating + city.
import Link from "next/link";
import { ProfileBadge } from "@/components/social/ProfileBadge";

type HotelLike = {
  id: string;
  name: string;
  city?: string | null;
  state?: string | null;
  starRating?: number;
  star_rating?: number;
  avgRating?: number;
  totalReviews?: number;
  images?: string[];
};

export function HotelIdentityStrip({ hotel }: { hotel: HotelLike | null }) {
  if (!hotel) return null;
  const stars = hotel.starRating || hotel.star_rating || 0;
  const rating = hotel.avgRating;
  const total = hotel.totalReviews || 0;
  const initials = (hotel.name || "?").split(" ").slice(0, 2).map((s) => s[0]).join("").toUpperCase();

  return (
    <Link
      href={`/hotels/${hotel.id}`}
      className="flex items-center gap-2.5 px-3 py-2 rounded-2xl"
      style={{
        background: "rgba(0,0,0,0.55)",
        border: "1px solid rgba(255,255,255,0.12)",
        backdropFilter: "blur(14px) saturate(1.3)",
        WebkitBackdropFilter: "blur(14px) saturate(1.3)",
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        className="w-9 h-9 rounded-full overflow-hidden shrink-0 flex items-center justify-center text-[0.78rem] font-bold text-black"
        style={{ background: "linear-gradient(160deg,#e6edf3 0%,#c9d4df 52%,#a4b5c6 100%)", border: "1.5px solid rgba(255,255,255,0.5)" }}
      >
        {hotel.images?.[0] ? <img src={hotel.images[0]} alt={hotel.name} className="w-full h-full object-cover" /> : initials}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 leading-none">
          <span className="text-white font-bold text-[0.78rem] uppercase tracking-wide truncate">{hotel.name}</span>
          <ProfileBadge userType="HOTEL" size="xs" showLabel={false} />
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 text-[0.6rem] text-white/75 leading-none">
          {stars > 0 && <span className="text-gold-300">{"★".repeat(Math.min(5, stars))}</span>}
          {typeof rating === "number" && rating > 0 && (
            <>
              <span className="opacity-50">·</span>
              <span className="font-semibold text-white/90">{rating.toFixed(1)}</span>
              {total > 0 && <span className="text-white/50">({total} reviews)</span>}
            </>
          )}
        </div>
        {hotel.city && (
          <div className="mt-0.5 text-[0.6rem] text-white/70 leading-none truncate">
            📍 {hotel.city}{hotel.state ? `, ${hotel.state}` : ""}
          </div>
        )}
      </div>
    </Link>
  );
}
