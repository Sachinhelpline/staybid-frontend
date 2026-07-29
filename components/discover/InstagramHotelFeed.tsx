"use client";
// ═══════════════════════════════════════════════════════════════════════════
// Instagram-style Hotel Feed (v21 — videos + live actions + 3D animations)
// ───────────────────────────────────────────────────────────────────────────
//   • Each hotel plays its OWN dummy looping video as the reel background
//     (Ken-Burns hotel photo serves as poster while the video buffers).
//   • Like button → spawns 8–14 hearts that fly up to the top of the screen
//     (Instagram-style "love bomb"). Same on double-tap.
//   • Comment, Share, More — all live actionable:
//       Comment → slide-up drawer with sample comments + working input
//       Share   → navigator.share or copy-to-clipboard, with a toast
//       More    → bottom sheet menu (Report, Copy link, Mute audio, …)
//   • Follow button: 3D embossed gold pill with sheen sweep + press depress
//     and a sparkle burst on click.
//   • Book Now / Bid: equal-width 3D translucent glass buttons (gold + violet
//     tints), shimmer sweep, depress on press.
//   • Mute toggle (top-right corner of each card).
// ═══════════════════════════════════════════════════════════════════════════
import { useEffect, useRef, useState, useCallback, useMemo, memo } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { useNetworkTier } from "@/lib/use-network-tier";
import { useSoundStore } from "@/lib/sound-store";
import { useFollow } from "@/lib/follow-store";
import { usePosts } from "@/lib/posts-store";
import { applyGain, resumeAudio } from "@/lib/audio-amplifier";
import { CreateFlow, AudioPicker, ProfilePhotoEditor, type AudioTrack, filterCssFor as filterCssForId, type ComposerTierContext } from "@/components/discover/CreateFlow";
import { LocationGlobeModal } from "@/components/LocationGlobePicker";
// Phase 4 tier-system gate — PUBLIC users with no upload eligibility
// are routed to UpgradeChoiceSheet on FAB tap, instead of the default
// CreateSheet. See onFabClick handler below.
import UpgradeChoiceSheet, { type TierContext } from "@/components/tier/UpgradeChoiceSheet";
import type { MyTierResponse } from "@/lib/tier/types";
import { api } from "@/lib/api";
import { uploadSocialMedia } from "@/lib/social/storage-upload";
import { sanitizeText as sanitizeComment } from "@/lib/sanitize-text";
import { getComments, addComment, useCommentCount, type SbComment } from "@/lib/comment-store";
import { useTheme } from "@/lib/theme-store";
import { markNotInterested, getNotInterested } from "@/lib/track";
import HotelScoreBadge from "@/components/hotel/HotelScoreBadge";
import { sbImage, SB_IMG_CARD, SB_IMG_THUMB, SB_IMG_AVATAR, SB_IMG_HERO } from "@/lib/sb-image";
import {
  FlashDealStoryRail,
  FlashDealStoryViewer,
  useFlashDealStories,
  type FlashDealStory,
} from "@/components/discover/FlashDealStories";
// v130 — flash-deal Book Now URL carries a ₹100-snapped price into the
// hotel page so the receiving Flash Book modal paints a value that
// already obeys the platform rule. Defensive: the hotel page re-snaps too.
import { snap100 } from "@/lib/price-snap";

// v442 — clean inline-SVG icon set for the reel action rail (replaces the
// cross-platform-inconsistent emoji glyphs 🔊🤍💬↗📑⋯). A plain module-scope
// component (NOT an IIFE inside the feed's return) so it never affects the
// styled-jsx block count. Inherits currentColor from .ig-icon (white on video).
function RailIcon({ name, filled }: { name: string; filled?: boolean }) {
  const p: any = {
    width: 25, height: 25, viewBox: "0 0 24 24",
    fill: filled ? "currentColor" : "none",
    stroke: "currentColor", strokeWidth: 1.9,
    strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true,
  };
  switch (name) {
    case "soundOn":  return (<svg {...p} fill="none"><path d="M5 9v6h3.5L14 19V5L8.5 9H5Z" /><path d="M17 8.5a5 5 0 0 1 0 7M19.5 6a8.5 8.5 0 0 1 0 12" /></svg>);
    case "soundOff": return (<svg {...p} fill="none"><path d="M5 9v6h3.5L14 19V5L8.5 9H5Z" /><path d="m17 9.5 4 5M21 9.5l-4 5" /></svg>);
    case "heart":    return (<svg {...p}><path d="M12 20.3s-6.8-4.4-6.8-9.5A4.1 4.1 0 0 1 12 7.2a4.1 4.1 0 0 1 6.8 3.6c0 5.1-6.8 9.5-6.8 9.5Z" /></svg>);
    case "comment":  return (<svg {...p} fill="none"><path d="M20 11.4a7.4 7.4 0 0 1-10.8 6.6L4.5 19.3l1.3-4.6A7.4 7.4 0 1 1 20 11.4Z" /></svg>);
    case "share":    return (<svg {...p} fill="none"><path d="M21.5 3 10.6 13.9" /><path d="M21.5 3 14.6 22l-3.9-8.1L2.5 10 21.5 3Z" /></svg>);
    case "bookmark": return (<svg {...p}><path d="M6.5 4h11v16l-5.5-3.6L6.5 20V4Z" /></svg>);
    case "more":     return (<svg {...p} fill="currentColor" stroke="none"><circle cx="5" cy="12" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="19" cy="12" r="1.7" /></svg>);
    default:         return null;
  }
}

type Item = { hotel: any; score?: number; reasons?: string[]; exploration?: boolean };

type Props = {
  items: Item[];
  onIndexChange?: (idx: number) => void;
  onLoadMore?: () => void;
  onTrackEvent?: (name: string, payload: any) => void;
  /** Whether to render the flash-deal stories rail at the top. /
      (home) defaults to true so users see live inventory; /discover
      and /reels pass false because those routes are reel-only by user
      design (v84). */
  showFlashDealRail?: boolean;
  /** v572 — land the feed on ONE specific reel instead of the top.
      For a community post the Item's `hotel.id` IS the post id (see
      socialPostToItem in app/discover/page.tsx), so this is the same key
      `onPickReel` already navigates by. Applied once, on the first render
      that actually has items; after that the user owns the scroll. */
  startId?: string | null;
};

// Dummy hotel reel videos — stable Google CDN test videos, looping. Replace
// with hotel.videoUrl whenever the backend ships real reels per hotel.
const DUMMY_HOTEL_VIDEOS = [
  "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
  "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4",
  "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4",
  "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4",
  "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4",
  "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyrides.mp4",
  "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerMeltdowns.mp4",
  "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/Sintel.mp4",
  "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4",
  "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/SubaruOutbackOnStreetAndDirt.mp4",
];

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
// ── v94 attribution params builder ─────────────────────────────────────
// Reel-feed Book/Bid CTAs carry `src` + (when from a real user post) the
// uploader's user_id/handle/type + the social_posts.id of the reel. The
// hotel detail page reads these params, persists them in localStorage so
// the attribution survives the Razorpay round-trip, then writes the final
// record to /api/attribution/record once the bid is in.
//
// Source classification:
//   • Real user post (Supabase social_posts row) → creator OR hotel-feed
//     depending on the uploader's user_type. PUBLIC accounts also map to
//     `creator` so the booking is trackable (they earn 0% but the panel
//     surfaces the attribution).
//   • Synthetic discover items → no params (defaults to `direct` on the
//     hotel page, because the creator pool is mock data — we don't pay
//     commission to a synthetic handle).
export function buildAttrSuffix(h: any): string {
  const isReal = !!h?._userPost && !!h?._publicAuthor?.user_id;
  if (!isReal) return "";
  const author = h._publicAuthor;
  const isHotelAccount = (author.user_type || "").toUpperCase() === "HOTEL";
  const src = isHotelAccount ? "hotel-feed" : "creator";
  const params = new URLSearchParams();
  params.set("src", src);
  if (author.user_id)   params.set("cid", String(author.user_id));
  if (author.username)  params.set("via", String(author.username));
  if (author.user_type) params.set("ctype", String(author.user_type));
  if (h.id)             params.set("vid", String(h.id));
  return "&" + params.toString();
}

function videoForHotel(h: any): string {
  const v = h?.videoUrl;
  // Accept both remote http(s) URLs and local blob: URLs (user uploads).
  if (typeof v === "string" && (v.startsWith("http") || v.startsWith("blob:"))) return v;
  // User photo/story post with no video — return empty so the <video>
  // errors out and the photo fallback (h.images[0]) renders instead.
  if (h?._userPost) return "";
  return DUMMY_HOTEL_VIDEOS[hashStr(h?.id || h?.name || "x") % DUMMY_HOTEL_VIDEOS.length];
}
function pseudoStat(seed: string, salt: string, min: number, max: number) {
  const h = hashStr(`${seed}::${salt}`);
  return min + (h % (max - min));
}
function fmtCount(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "K";
  return String(n);
}
function hashtagsFor(h: any): string[] {
  const base: string[] = [];
  if (h.city) base.push(h.city.replace(/\s+/g, ""));
  if (h.state) base.push(h.state.replace(/\s+/g, ""));
  base.push("StayBid");
  base.push("LuxuryStay");
  if (h.starRating >= 5) base.push("FiveStar");
  if ((h.amenities || []).some((a: string) => /pool/i.test(a))) base.push("Poolside");
  if ((h.amenities || []).some((a: string) => /spa/i.test(a))) base.push("Spa");
  return base.slice(0, 5);
}

// ─── Synthesized content creators per hotel (until backend ships real ones) ─
// Each creator carries a `sourceType` so the feed can filter by who posted
// the reel: the hotel itself, a content creator/influencer, or a regular
// customer (public traveller).
export type SourceType = "all" | "hotel" | "creator" | "public";
type Creator = {
  handle: string;
  name: string;
  verified: boolean;
  bio: string;
  avatarHue: number;
  sourceType: Exclude<SourceType, "all">;
};
const CREATOR_POOL: Creator[] = [
  // ── Hotels (official accounts) ──
  { handle: "the.staybid",     name: "StayBid Official",         verified: true,  bio: "India's first reverse-auction hotel platform. Bid your stay.",      avatarHue: 45,  sourceType: "hotel" },
  { handle: "hotelhopper",     name: "Hotel Hopper",             verified: true,  bio: "Luxury stays decoded. Honest reviews. No paid posts.",                avatarHue: 30,  sourceType: "hotel" },
  { handle: "indiastays",      name: "India Stays",              verified: true,  bio: "🇮🇳 Real rooms. Real prices. Real reels.",                            avatarHue: 0,   sourceType: "hotel" },
  // ── Creators (verified influencers) ──
  { handle: "wanderlust.in",   name: "Riya • Wanderlust India",  verified: true,  bio: "Travel storyteller • 60+ cities across India 🌏 • DM for collabs", avatarHue: 320, sourceType: "creator" },
  { handle: "luxe.escape",     name: "Luxe Escape",              verified: true,  bio: "Curating India's finest boutique hotels • TripAdvisor Top Reviewer", avatarHue: 280, sourceType: "creator" },
  { handle: "trail.diaries",   name: "Trail Diaries",            verified: false, bio: "Mountains, monasteries, and magic ☁️🗻",                              avatarHue: 200, sourceType: "creator" },
  { handle: "mountain.muse",   name: "Mountain Muse",            verified: false, bio: "Slow travel · sustainable stays · Himalayan home",                  avatarHue: 150, sourceType: "creator" },
  { handle: "voyager.vivek",   name: "Vivek • Voyager",          verified: false, bio: "Solo trips · budget bids · pin-drop guides",                        avatarHue: 100, sourceType: "creator" },
  // ── Public (real customer travellers) ──
  { handle: "priya_traveller", name: "Priya M. · #travelfam",    verified: false, bio: "Just a happy guest. Posting honest stays from real bookings.",      avatarHue: 340, sourceType: "public" },
  { handle: "rahul_solo",      name: "Rahul Bhatt",              verified: false, bio: "Solo travel @ 26 · ₹1500/night challenge · DM for itineraries",     avatarHue: 220, sourceType: "public" },
  { handle: "nikita.rk",       name: "Nikita Rastogi",           verified: false, bio: "Foodie + hotel hopper · Honest reviews after every stay",          avatarHue: 60,  sourceType: "public" },
  { handle: "amit.b.travel",   name: "Amit B.",                  verified: false, bio: "Family man, weekend escapes only. Real photos, real stays.",       avatarHue: 180, sourceType: "public" },
];
function creatorFor(h: any): Creator {
  return CREATOR_POOL[hashStr(h?.id || h?.name || "x") % CREATOR_POOL.length];
}
function sourceFor(h: any): Exclude<SourceType, "all"> {
  return creatorFor(h).sourceType;
}

const SOURCE_LABEL: Record<SourceType, string> = {
  all:     "All sources",
  hotel:   "Hotels",
  creator: "Creators",
  public:  "Public",
};
const SOURCE_ICON: Record<SourceType, string> = {
  all:     "🌐",
  hotel:   "🏨",
  creator: "✨",
  public:  "👤",
};

const FALLBACK_CITIES = ["Mussoorie", "Dhanaulti", "Rishikesh", "Shimla", "Manali", "Dehradun", "Nainital", "Goa", "Jaipur"];

// ─── Profile-highlight themes → live filter actions ─────────────────────
// Each highlight in the profile sheet ("Mountains", "Beaches", etc.) maps
// to a filter the main feed will apply when tapped.
type Highlight = {
  key: string;
  label: string;
  emoji: string;
  cities?: string[];      // OR'd against hotel.city
  amenityRe?: RegExp;     // matched on hotel.amenities
  starsAtLeast?: number;  // hotel.starRating filter
};
const HIGHLIGHTS: Highlight[] = [
  { key: "mountains", emoji: "🌄", label: "Mountains", cities: ["Mussoorie","Dhanaulti","Rishikesh","Shimla","Manali","Nainital","Dehradun","Dharamshala","Kasol","Auli"] },
  { key: "beaches",   emoji: "🏖", label: "Beaches",   cities: ["Goa","Pondicherry","Varkala","Gokarna","Diu","Mahabalipuram","Puri"] },
  { key: "foodie",    emoji: "🍜", label: "Foodie",    amenityRe: /(restaurant|kitchen|bar|cafe|food|in[-\s]?house\s*dining)/i },
  { key: "suites",    emoji: "🛏",  label: "Suites",   starsAtLeast: 5 },
  { key: "toppicks",  emoji: "✨", label: "Top picks" },
  { key: "solo",      emoji: "🎒", label: "Solo" },
];

function applyHighlight(items: any[], hl: Highlight): any[] {
  return items.filter((it) => {
    const h = it.hotel;
    if (hl.cities && hl.cities.length) {
      const match = hl.cities.some((c) => (h.city || "").toLowerCase().includes(c.toLowerCase()));
      if (!match) return false;
    }
    if (hl.amenityRe) {
      const a = (h.amenities || []).join(" ");
      if (!hl.amenityRe.test(a)) return false;
    }
    if (hl.starsAtLeast && (h.starRating || 0) < hl.starsAtLeast) return false;
    return true;
  });
}

// ─── Self tier banner — surfaces the user's account state on their own
// profile sheet. PUBLIC sees the upgrade CTAs; PENDING/CREATOR/HOTEL see
// their respective dashboards. Lives in this file because the profile
// sheet is the only consumer.
function SelfTierBanner({
  tier, stats, onClose,
}: {
  tier: "PUBLIC" | "PENDING_CREATOR" | "CREATOR" | "HOTEL" | "BLOCKED" | "UNKNOWN";
  stats: { earnings?: number; bookings?: number; followers?: number } | null;
  onClose: () => void;
}) {
  if (tier === "PUBLIC") {
    return (
      <div
        className="mt-2 px-3 py-2.5 rounded-xl"
        style={{
          background: "linear-gradient(135deg, rgba(255,69,141,0.10), rgba(185,100,255,0.06))",
          border: "1px solid rgba(255,69,141,0.32)",
        }}
      >
        <p className="text-white text-[0.78rem] font-semibold mb-1.5">✨ Want to earn from StayBid?</p>
        <p className="text-white/65 text-[0.66rem] leading-snug mb-2">
          Upgrade to a Creator (12% commission on bookings) or list your Hotel. Admin reviews KYC within 24 h.
        </p>
        <Link
          href="/upgrade"
          onClick={() => onClose()}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[0.72rem] font-bold text-black"
          style={{
            background: "linear-gradient(135deg,#ffd76b,#f0b429)",
            boxShadow: "0 3px 10px rgba(240,180,41,0.4), inset 0 1px 0 rgba(255,255,255,0.5)",
            border: "1px solid rgba(255,255,255,0.45)",
          }}
        >
          Explore upgrade options →
        </Link>
      </div>
    );
  }
  if (tier === "PENDING_CREATOR") {
    return (
      <div
        className="mt-2 px-3 py-2.5 rounded-xl"
        style={{
          background: "linear-gradient(135deg, rgba(240,180,41,0.10), rgba(255,69,141,0.06))",
          border: "1px solid rgba(240,180,41,0.45)",
        }}
      >
        <p className="text-white text-[0.78rem] font-semibold mb-1">⏳ Creator application under review</p>
        <p className="text-white/65 text-[0.66rem] leading-snug">
          Most KYC reviews finish within 24 hours. You can keep posting reels meanwhile — once approved
          your creator badge + commissions activate automatically.
        </p>
      </div>
    );
  }
  if (tier === "CREATOR") {
    return (
      <div
        className="mt-2 px-3 py-2.5 rounded-xl"
        style={{
          background: "linear-gradient(135deg, rgba(46,204,113,0.10), rgba(91,141,255,0.06))",
          border: "1px solid rgba(46,204,113,0.45)",
        }}
      >
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <p className="text-white text-[0.78rem] font-semibold">✨ Active Creator</p>
          <Link
            href="/influencer/dashboard"
            onClick={() => onClose()}
            className="text-emerald-300 text-[0.66rem] font-bold hover:underline"
          >
            Open Creator Dashboard →
          </Link>
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          <SelfStat label="Earned"    value={stats?.earnings != null ? `₹${(stats.earnings || 0).toLocaleString("en-IN")}` : "—"} />
          <SelfStat label="Bookings"  value={stats?.bookings != null ? String(stats.bookings) : "—"} />
          <SelfStat label="Followers" value={stats?.followers != null ? (stats.followers >= 1000 ? `${(stats.followers / 1000).toFixed(1)}K` : String(stats.followers)) : "—"} />
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Link href="/influencer/referrals" onClick={() => onClose()}
            className="px-2.5 py-1 rounded-full text-[0.64rem] font-bold"
            style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.18)", color: "rgba(255,255,255,0.92)" }}
          >🔗 Referrals</Link>
          <Link href="/influencer/earnings" onClick={() => onClose()}
            className="px-2.5 py-1 rounded-full text-[0.64rem] font-bold"
            style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.18)", color: "rgba(255,255,255,0.92)" }}
          >💸 Earnings</Link>
        </div>
      </div>
    );
  }
  if (tier === "HOTEL") {
    return (
      <div
        className="mt-2 px-3 py-2.5 rounded-xl flex items-center gap-2"
        style={{
          background: "linear-gradient(135deg, rgba(46,204,113,0.10), rgba(91,141,255,0.06))",
          border: "1px solid rgba(46,204,113,0.45)",
        }}
      >
        <span className="text-base">🏨</span>
        <p className="flex-1 text-white text-[0.78rem] font-semibold">Active Hotel partner</p>
        <a
          href="/partner"
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => onClose()}
          className="text-emerald-300 text-[0.66rem] font-bold hover:underline"
        >
          Open dashboard ↗
        </a>
      </div>
    );
  }
  if (tier === "BLOCKED") {
    return (
      <div
        className="mt-2 px-3 py-2.5 rounded-xl"
        style={{
          background: "rgba(239,68,68,0.10)",
          border: "1px solid rgba(239,68,68,0.45)",
        }}
      >
        <p className="text-red-300 text-[0.78rem] font-semibold mb-0.5">🚫 Account blocked</p>
        <p className="text-red-200/85 text-[0.66rem] leading-snug">
          Trust &amp; safety has paused this account. Reach out via support to appeal.
        </p>
      </div>
    );
  }
  return null;
}

function SelfStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-center px-1.5 py-1 rounded-lg" style={{ background: "rgba(0,0,0,0.30)", border: "1px solid rgba(255,255,255,0.08)" }}>
      <p className="text-white font-bold text-[0.78rem] leading-none">{value}</p>
      <p className="text-white/55 text-[0.56rem] mt-0.5 uppercase tracking-wider">{label}</p>
    </div>
  );
}

// ─── Hotel-as-entity helper — lets the same profile sheet render hotels ──
function entityFromHotel(h: any): Creator & { _isSelf?: boolean } {
  // For public user posts, prefer the author's real handle/name over the
  // auto-slug from the post title — so "Riya Sharma's reel" shows
  // "@riya_sharma" in the chip, not "your_post".
  const author = h._publicAuthor;
  const handle = author?.username
    ? String(author.username).toLowerCase().replace(/[^a-z0-9._-]/g, "").slice(0, 24)
    : ((h.name || "hotel").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 24) || "hotel");
  return {
    handle,
    name: author?.display_name || h.name || "Hotel",
    verified: author?.is_verified ?? (!!h.trustBadge || (h.starRating || 0) >= 4),
    bio: author?.bio || `${h.starRating ? "★".repeat(Math.min(5, h.starRating)) + " · " : ""}${h.city || ""}${h.state ? ", " + h.state : ""}\n${h.description || "Verified property on StayBid · live reverse-auction · book at your price."}`,
    avatarHue: hashStr(h.id || h.name || "x") % 360,
    sourceType: author?.user_type === "CREATOR" ? "creator" : author?.user_type === "PUBLIC" ? "public" : "hotel",
    // _isSelf only when the post is YOURS — separates "user post"
    // (anyone's upload, _userPost=true) from "your post" specifically.
    _isSelf: !!h._isSelf,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Anti-bypass communication guard — see top-of-file import.
// Same sanitizer is used by booking-flow chat post-booking (Phase 7).
// ─────────────────────────────────────────────────────────────────────────

// v401 — the reel comment thread (seed pool + user comments + count) now lives
// in lib/comment-store.ts so the card count always equals the drawer content.

// ─────────────────────────────────────────────────────────────────────────
// Floating hearts animator (used by both single-tap like and double-tap)
// ─────────────────────────────────────────────────────────────────────────
type Heart = { id: number; x: number; y: number; dx: number; rot: number; size: number; emoji: string; dur: number };
const HEART_EMOJIS = ["❤️", "💖", "💘", "💝", "♥️", "🤍", "💗"];

function spawnHearts(originX: number, originY: number, count = 12): Heart[] {
  const arr: Heart[] = [];
  for (let i = 0; i < count; i++) {
    arr.push({
      id: Date.now() + Math.random(),
      x: originX,
      y: originY,
      dx: (Math.random() - 0.5) * 220,
      rot: (Math.random() - 0.5) * 50,
      size: 28 + Math.random() * 38,
      emoji: HEART_EMOJIS[Math.floor(Math.random() * HEART_EMOJIS.length)],
      // Slower, gentler float — pop slowly like the like button itself
      dur: 2400 + Math.random() * 1800,
    });
  }
  return arr;
}

// ─────────────────────────────────────────────────────────────────────────
// Comment Drawer
// ─────────────────────────────────────────────────────────────────────────
function CommentDrawer({
  open, onClose, hotelName, postId, onMaskedToast,
}: {
  open: boolean;
  onClose: () => void;
  hotelName: string;
  /** The reel/post id — the comment thread is keyed to this so the count on the
      card equals what's rendered here. */
  postId: string;
  onMaskedToast?: (msg: string) => void;
}) {
  const { theme } = useTheme();
  const dark = theme === "dark";
  // Theme palette — the sheet follows the app's light/dark appearance mode.
  const c = dark
    ? {
        sheet: "linear-gradient(180deg,#15101e 0%,#0a0612 100%)",
        border: "rgba(255,255,255,0.12)", headBorder: "rgba(255,255,255,0.08)",
        title: "#ffffff", text: "rgba(255,255,255,0.92)", name: "#ffffff",
        sub: "rgba(255,255,255,0.45)", grip: "rgba(255,255,255,0.30)",
        inputBg: "rgba(255,255,255,0.10)", inputBorder: "rgba(255,255,255,0.20)", inputText: "#ffffff",
        bannerText: "rgba(255,255,255,0.85)", bannerSub: "rgba(255,255,255,0.55)",
        closeBg: "rgba(255,255,255,0.10)", closeText: "#ffffff",
      }
    : {
        sheet: "linear-gradient(180deg,#ffffff 0%,#faf5ea 100%)",
        border: "rgba(74,50,8,0.16)", headBorder: "rgba(74,50,8,0.10)",
        title: "#2c1d04", text: "rgba(44,29,4,0.92)", name: "#2c1d04",
        sub: "rgba(74,50,8,0.55)", grip: "rgba(74,50,8,0.25)",
        inputBg: "rgba(74,50,8,0.06)", inputBorder: "rgba(74,50,8,0.20)", inputText: "#2c1d04",
        bannerText: "rgba(44,29,4,0.88)", bannerSub: "rgba(74,50,8,0.6)",
        closeBg: "rgba(74,50,8,0.08)", closeText: "#4a3208",
      };

  const [comments, setComments] = useState<SbComment[]>([]);
  const [input, setInput] = useState("");
  const [liked, setLiked] = useState<Record<number, boolean>>({});

  // Load this post's thread whenever the drawer opens (real store, keyed by id).
  useEffect(() => {
    if (open && postId) setComments(getComments(postId));
  }, [open, postId]);

  // Hide the bottom nav dock while commenting (the standard modal class) so the
  // comment input is never covered by it — this is why "there was no way to
  // comment": the input sat BEHIND the dock.
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (open) document.body.classList.add("sb-modal-open");
    else document.body.classList.remove("sb-modal-open");
    return () => { document.body.classList.remove("sb-modal-open"); };
  }, [open]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-80 flex items-end" onClick={onClose}>
      <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)" }} />
      <div
        className="relative w-full ig-drawer-up"
        onClick={(e) => e.stopPropagation()}
        style={{
          height: "72vh",
          background: c.sheet,
          borderTopLeftRadius: 24, borderTopRightRadius: 24,
          borderTop: `1px solid ${c.border}`,
          boxShadow: "0 -20px 60px rgba(0,0,0,0.4)",
          display: "flex", flexDirection: "column",
        }}
      >
        <div className="flex justify-center pt-2.5 pb-1.5"><div className="w-10 h-[3px] rounded-full" style={{ background: c.grip }} /></div>
        <div className="flex items-center justify-between px-5 pb-3" style={{ borderBottom: `1px solid ${c.headBorder}` }}>
          <p className="font-semibold text-sm" style={{ color: c.title }}>
            Comments <span style={{ color: c.sub }}>· {comments.length}</span>
          </p>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onClose(); }}
            onTouchEnd={(e) => { e.stopPropagation(); onClose(); }}
            className="ig-close-btn"
            style={{ background: c.closeBg, color: c.closeText }}
            aria-label="Close"
          >✕</button>
        </div>

        {/* ⚠️ Public-comments-only notice. Tells users that personal contact
            info is auto-masked so the platform stays the booking channel. */}
        <div
          className="mx-5 mt-3 mb-1 px-3 py-2 rounded-xl flex items-start gap-2"
          style={{
            background: "linear-gradient(135deg, rgba(240,180,41,0.16), rgba(255,69,141,0.08))",
            border: "1px solid rgba(240,180,41,0.35)",
          }}
        >
          <span className="text-base leading-none mt-0.5">🛡️</span>
          <p className="text-[0.66rem] leading-snug" style={{ color: c.bannerText }}>
            Public comments only. Phone, email, WhatsApp, social handles & off-platform links are auto-masked.
            <span style={{ color: c.bannerSub }}> Booked guests can chat with their property from </span>
            <span className="text-gold-300 font-semibold">My Bookings</span>
            <span style={{ color: c.bannerSub }}>.</span>
          </p>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-4" style={{ WebkitOverflowScrolling: "touch" }}>
          {comments.map((cm, i) => (
            <div
              key={`${cm.user}-${i}-${cm.text.slice(0,8)}`}
              className="ig-comment-row flex items-start gap-2.5"
              style={{ animationDelay: `${Math.min(i * 40, 500)}ms` }}
            >
              <div className="w-8 h-8 rounded-full shrink-0 flex items-center justify-center text-[0.7rem] font-bold text-black"
                style={{ background: `conic-gradient(from ${(i*47)%360}deg, #f0b429, #ff458d, #b964ff, #f0b429)` }}>
                <span className="w-[26px] h-[26px] rounded-full flex items-center justify-center"
                  style={{ background: "linear-gradient(135deg,#ffd76b,#f0b429)" }}>
                  {cm.user.slice(0, 1).toUpperCase()}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[0.78rem] leading-snug" style={{ color: c.text }}>
                  <span className="font-semibold" style={{ color: c.name }}>{cm.user}</span>{" "}
                  <span>{cm.text}</span>
                </p>
                <div className="flex items-center gap-3 mt-0.5 text-[0.62rem]" style={{ color: c.sub }}>
                  <span>{cm.time}</span>
                  <span>{cm.likes + (liked[i] ? 1 : 0)} likes</span>
                  {/* Reply intentionally removed — private replies between
                      hotels/creators/customers would create a DM channel
                      that bypasses the booking flow. */}
                </div>
              </div>
              <button
                type="button"
                className="text-[0.7rem] mt-1"
                style={{ color: liked[i] ? "#ff4d6d" : c.sub }}
                onClick={(e) => { e.stopPropagation(); setLiked((m) => ({ ...m, [i]: !m[i] })); }}
                aria-label="Like comment"
              >{liked[i] ? "❤️" : "🤍"}</button>
            </div>
          ))}
          {comments.length === 0 && <p className="text-sm text-center pt-8" style={{ color: c.sub }}>Be the first to comment on {hotelName}</p>}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const text = input.trim();
            if (!text) return;
            // Persist via the real store (which sanitizes + fires the count event).
            const { blocked } = addComment(postId, text);
            if (blocked) {
              onMaskedToast?.("🛡️ Personal contact info hidden — keep bookings on StayBid");
              // Trigger admin review of the attempt (fire-and-forget; the block
              // already happened above regardless of this call succeeding).
              try {
                const tok = typeof window !== "undefined" ? localStorage.getItem("sb_token") : null;
                fetch("/api/social/comment-flag", {
                  method: "POST",
                  headers: { "Content-Type": "application/json", ...(tok ? { Authorization: `Bearer ${tok}` } : {}) },
                  body: JSON.stringify({ hotelId: postId, hotelName, rawText: text, surface: "reel_comment" }),
                }).catch(() => {});
              } catch {}
            }
            setComments(getComments(postId));
            setInput("");
          }}
          className="flex items-center gap-2 px-4 py-3"
          style={{ borderTop: `1px solid ${c.headBorder}`, paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 12px)" }}
        >
          <div className="w-9 h-9 rounded-full shrink-0 flex items-center justify-center text-xs font-bold text-black"
            style={{ background: "linear-gradient(135deg,#ffd76b,#f0b429)" }}>You</div>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={`Public comment on ${hotelName}… (no contacts)`}
            className="ig-comment-input flex-1 rounded-full px-4 py-2 text-[0.82rem] outline-hidden transition-colors"
            style={{
              color: c.inputText,
              caretColor: "#f0b429",
              background: c.inputBg,
              border: `1px solid ${c.inputBorder}`,
              fontWeight: 500,
            }}
            autoComplete="off"
            maxLength={500}
          />
          <button type="submit" disabled={!input.trim()} className="text-gold-300 font-bold text-[0.82rem] px-2 disabled:opacity-30">
            Post
          </button>
        </form>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// More Menu
// ─────────────────────────────────────────────────────────────────────────
function MoreMenu({
  open, onClose, hotelHref, isUserPost, onShare, onCopy, onToggleMute, muted, gain, onCycleGain, onEditPost, onDeletePost,
  hotelName, authorHandle, onReport, onNotInterested,
}: {
  open: boolean; onClose: () => void;
  /** Resolved /hotels/<realHotelId> link, or null when the reel has no
   *  hotel attached. v160 — the parent computes this from the tagged
   *  hotel id; it must NEVER be the social_posts row id (that always
   *  404s on /hotels/[id]). */
  hotelHref: string | null;
  isUserPost?: boolean;
  onShare: () => void; onCopy: () => void; onToggleMute: () => void; muted: boolean;
  gain: number; onCycleGain: () => void;
  onEditPost?: () => void;
  onDeletePost?: () => void;
  hotelName?: string;
  authorHandle?: string;
  /** v402 — Report + Not-interested are now REAL (were dead buttons). */
  onReport?: (reason: string) => void;
  onNotInterested?: () => void;
}) {
  const { theme } = useTheme();
  const dark = theme === "dark";
  // The sheet follows the app appearance mode (was hardcoded dark).
  const c = dark
    ? { sheet: "linear-gradient(180deg,#2A2417 0%,#1F1A0F 100%)", topBorder: "rgba(217,190,130,0.22)", grip: "rgba(217,190,130,0.4)", head: "#C9A66B", rowBorder: "rgba(217,190,130,0.16)", rowBg: "linear-gradient(135deg, rgba(217,190,130,0.10), rgba(217,190,130,0.03))", label: "#FAF5EB", chevron: "rgba(217,190,130,0.45)", overlay: "rgba(15,12,8,0.62)" }
    : { sheet: "linear-gradient(180deg,#ffffff 0%,#faf5ea 100%)", topBorder: "rgba(139,105,20,0.20)", grip: "rgba(139,105,20,0.30)", head: "#8B6914", rowBorder: "rgba(139,105,20,0.16)", rowBg: "linear-gradient(135deg, rgba(139,105,20,0.07), rgba(139,105,20,0.02))", label: "#2c1d04", chevron: "rgba(139,105,20,0.4)", overlay: "rgba(15,12,8,0.55)" };

  const [view, setView] = useState<"menu" | "report">("menu");

  // Hide the bottom nav dock while the sheet is open (the standard modal class)
  // so the last row is never covered by it — this is why "Not interested" was
  // cut off behind the dock. Also reset to the menu view on each open.
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (open) { document.body.classList.add("sb-modal-open"); setView("menu"); }
    else document.body.classList.remove("sb-modal-open");
    return () => { document.body.classList.remove("sb-modal-open"); };
  }, [open]);

  if (!open) return null;

  const REPORT_REASONS: { key: string; icon: string; label: string }[] = [
    { key: "spam",          icon: "📢", label: "Spam or scam" },
    { key: "inappropriate", icon: "⚠️", label: "Inappropriate or offensive" },
    { key: "misleading",    icon: "🎭", label: "Misleading or fake listing" },
    { key: "offplatform",   icon: "🔗", label: "Sharing contact / off-platform" },
    { key: "other",         icon: "•••", label: "Something else" },
  ];

  // For user-uploaded posts the menu pivots to author actions (Edit + Delete).
  // For everyone else: Open hotel page (if tagged) + Report + Not interested.
  const items = isUserPost
    ? [
        { icon: "✏️",  label: "Edit post",   onClick: onEditPost },
        { icon: "🗑",  label: "Delete post", onClick: onDeletePost, danger: true },
      ]
    : [
        ...(hotelHref ? [{ icon: "🏨", label: "Open hotel page", href: hotelHref }] : []),
        { icon: "🚩",  label: "Report this reel", danger: true, onClick: () => setView("report"), keepOpen: true },
        { icon: "🚫",  label: "Not interested",   onClick: () => onNotInterested?.() },
      ];

  const rowInner = (icon: string, label: string, danger?: boolean, chevron = true) => (
    <div
      className="ig-more-row flex items-center gap-3.5 px-3.5 py-3 rounded-2xl"
      style={{ background: c.rowBg, border: danger ? "1px solid rgba(224,107,90,0.28)" : `1px solid ${c.rowBorder}` }}
    >
      <span
        className="w-10 h-10 rounded-xl flex items-center justify-center text-lg shrink-0"
        style={{ background: danger ? "linear-gradient(135deg,#E0937A,#C46A4E)" : "linear-gradient(135deg,#E7CFA0,#C9A66B 60%,#8B6914)", boxShadow: "0 3px 10px rgba(15,12,8,0.3), inset 0 1px 0 rgba(255,255,255,0.35)" }}
      >{icon}</span>
      <span className="text-[0.92rem] font-semibold" style={{ color: danger ? (dark ? "#E8A89C" : "#B4472E") : c.label }}>{label}</span>
      {chevron && <span className="ml-auto text-lg" style={{ color: c.chevron }}>›</span>}
    </div>
  );

  return (
    <div className="fixed inset-0 z-80 flex items-end sm:items-center sm:justify-center" onClick={onClose}>
      <div className="absolute inset-0" style={{ background: c.overlay, backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)" }} />
      <div
        className="relative w-full sm:max-w-md ig-drawer-up"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: c.sheet,
          borderTopLeftRadius: 26, borderTopRightRadius: 26,
          borderTop: `1px solid ${c.topBorder}`,
          boxShadow: "0 -24px 70px rgba(15,12,8,0.5)",
          paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 16px)",
        }}
      >
        <div className="flex justify-center pt-2.5 pb-1"><div className="w-10 h-[3px] rounded-full" style={{ background: c.grip }} /></div>

        {view === "menu" ? (
          <>
            <div className="px-5 pb-1">
              <p className="text-[0.6rem] font-bold tracking-[0.18em] uppercase" style={{ color: c.head }}>Options</p>
            </div>
            <div className="px-3 pb-1 pt-1 space-y-1.5">
              {items.map((it: any, i) => {
                if (it.href) return <Link key={i} href={it.href} onClick={onClose}>{rowInner(it.icon, it.label, it.danger)}</Link>;
                return (
                  <button
                    key={i}
                    onClick={() => { it.onClick?.(); if (!it.keepOpen) onClose(); }}
                    className="w-full text-left"
                  >
                    {rowInner(it.icon, it.label, it.danger)}
                  </button>
                );
              })}
            </div>
          </>
        ) : (
          <>
            <div className="px-5 pb-1 flex items-center gap-2">
              <button type="button" onClick={() => setView("menu")} className="text-lg" style={{ color: c.head }} aria-label="Back">‹</button>
              <p className="text-[0.6rem] font-bold tracking-[0.18em] uppercase" style={{ color: c.head }}>
                Why report {hotelName ? `“${hotelName}”` : "this reel"}?
              </p>
            </div>
            <div className="px-3 pb-1 pt-1 space-y-1.5">
              {REPORT_REASONS.map((r) => (
                <button
                  key={r.key}
                  onClick={() => { onReport?.(r.key); onClose(); }}
                  className="w-full text-left"
                >
                  {rowInner(r.icon, r.label, false)}
                </button>
              ))}
              <p className="px-3.5 pt-1 text-[0.66rem]" style={{ color: c.chevron }}>
                Your report is anonymous. Our team reviews every report.
              </p>
            </div>
          </>
        )}

        <style jsx global>{`
          .ig-more-row {
            transition: transform 0.14s cubic-bezier(.32,1.2,.36,1), background 0.18s ease, border-color 0.18s ease;
          }
          .ig-more-row:active { transform: scale(0.98); }
        `}</style>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Creator Profile Sheet — slide-up Instagram-style profile view
// ─────────────────────────────────────────────────────────────────────────
function CreatorProfileSheet({
  open, onClose, creator, hotels, onPickReel, onApplyHighlight,
}: {
  open: boolean;
  onClose: () => void;
  creator: Creator | null;
  hotels: any[];
  onPickReel?: (hotelId: string) => void;
  onApplyHighlight?: (hl: Highlight) => void;
}) {
  const [tab, setTab] = useState<"reels" | "tagged" | "followers" | "following">("reels");
  const [followerQuery, setFollowerQuery] = useState("");
  const [editProfileOpen, setEditProfileOpen] = useState(false);
  // Self-only: filter the personal reels grid to a single tagged highlight
  const [selectedHighlight, setSelectedHighlight] = useState<string | null>(null);
  // Self-only: account-tier check (PUBLIC / PENDING_CREATOR / CREATOR / HOTEL).
  // Lightweight one-shot — calls api.getMyInfluencer() the first time the
  // user opens their own profile, caches the result for the lifetime of
  // this sheet instance.
  const [accountTier, setAccountTier] = useState<"UNKNOWN" | "PUBLIC" | "PENDING_CREATOR" | "CREATOR" | "HOTEL" | "BLOCKED">("UNKNOWN");
  const [accountStats, setAccountStats] = useState<{ earnings?: number; bookings?: number; followers?: number } | null>(null);
  const { isFollowing, toggleFollow, followerCount, followingCount, follows, searchFollowers, myAvatarUrl, myDisplayName, myBio, myLocation, myWebsite, myCustomHighlights } = useFollow();

  // Reset to default tab whenever a new profile is opened
  useEffect(() => {
    if (open) { setTab("reels"); setFollowerQuery(""); setSelectedHighlight(null); }
  }, [open, creator?.handle]);

  // Probe account tier for self profile only — don't waste an API hit on
  // every profile sheet open.
  useEffect(() => {
    if (!open) return;
    if (!(creator as any)?._isSelf) return;
    if (accountTier !== "UNKNOWN") return;
    let cancelled = false;
    (async () => {
      type TierLite = "PUBLIC" | "PENDING_CREATOR" | "CREATOR" | "HOTEL" | "BLOCKED";
      let detected: TierLite = "PUBLIC";
      let stats: { earnings?: number; bookings?: number; followers?: number } | null = null;
      try {
        const inf = await api.getMyInfluencer();
        if (inf?.registered && inf?.influencer) {
          const status = String(inf.influencer.status || "").toUpperCase();
          if (status === "BLOCKED") detected = "BLOCKED";
          else if (status === "PENDING") detected = "PENDING_CREATOR";
          else detected = "CREATOR";
          stats = {
            earnings: Number(inf.influencer.total_earnings) || 0,
            followers: Number(inf.influencer.total_followers) || 0,
          };
          // Best-effort booking count
          try {
            const s = await api.getInfluencerStats?.(inf.influencer.id);
            if (s?.derived?.totalBookings != null) stats!.bookings = Number(s.derived.totalBookings);
          } catch {}
        }
      } catch {}
      // Hotel partner check (fallback)
      if (detected === "PUBLIC") {
        try {
          const tok = typeof window !== "undefined" ? localStorage.getItem("sb_partner_token") : null;
          if (tok) {
            const r = await fetch("/api/partner/hotel", { headers: { Authorization: `Bearer ${tok}` } });
            if (r.ok) {
              const data = await r.json();
              if (data?.hotel) detected = "HOTEL";
            }
          }
        } catch {}
      }
      if (!cancelled) {
        setAccountTier(detected);
        setAccountStats(stats);
      }
    })();
    return () => { cancelled = true; };
  }, [open, (creator as any)?._isSelf, accountTier]);

  if (!open || !creator) return null;

  const followed = isFollowing(creator.handle);
  // Reels created by this entity. For hotels we synth: all reels for this hotel id;
  // for creators we use creatorFor(h). De-duplicated by id so the grid never
  // shows the same post twice (was happening when PostsStore got accidental
  // duplicates from rapid re-uploads — the screenshot the user flagged).
  const myReelsRaw =
    creator.sourceType === "hotel" && /^[a-z0-9_]+$/.test(creator.handle)
      ? hotels.filter((h) => entityFromHotel(h).handle === creator.handle)
      : hotels.filter((h) => creatorFor(h).handle === creator.handle);
  const seenReelIds = new Set<string>();
  let myReels = myReelsRaw.filter((h: any) => {
    const id = String(h?.id || "");
    if (!id || seenReelIds.has(id)) return false;
    seenReelIds.add(id);
    return true;
  });
  // Self profile: a user-picked highlight bucket filters the grid down to
  // posts tagged with that highlight key (Instagram-style story highlights).
  if ((creator as any)._isSelf && selectedHighlight) {
    myReels = myReels.filter((h: any) => h._userPostHighlight?.key === selectedHighlight);
  }
  myReels = myReels.slice(0, 36);
  const tagged = hotels.filter((h) => !myReels.includes(h)).slice(0, 9);

  // Live followers from the global store (synthesized base + any users who
  // tapped Follow at runtime — including the current user themselves).
  const followersList = searchFollowers(creator.handle, followerQuery);
  // "Following" tab shows handles the CURRENT USER follows, not the creator's
  // following list (we don't have that for synthesized entities). This makes
  // the user's own follow graph searchable from any profile sheet they open.
  const followingList = follows
    .map((h) => `@${h}`)
    .filter((s) => !followerQuery || s.toLowerCase().includes(followerQuery.toLowerCase()));

  const followers = followerCount(creator.handle);
  const followingTotal = followingCount();
  const likesTotal = pseudoStat(creator.handle, "likes", 84_000, 4_200_000);
  const reelsCount = Math.max(myReels.length, pseudoStat(creator.handle, "reels", 12, 320));

  return (
    <div className="fixed inset-0 z-85 flex items-end" onClick={onClose}>
      <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.65)", backdropFilter: "blur(6px)" }} />
      <div
        className="relative w-full ig-drawer-up"
        onClick={(e) => e.stopPropagation()}
        style={{
          height: "92vh",
          background: "linear-gradient(180deg,#0e0a18 0%,#05030c 100%)",
          borderTopLeftRadius: 28, borderTopRightRadius: 28,
          borderTop: "1px solid rgba(255,255,255,0.12)",
          boxShadow: "0 -20px 60px rgba(0,0,0,0.7)",
          display: "flex", flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <div className="flex justify-center pt-2.5 pb-1.5"><div className="w-10 h-[3px] rounded-full bg-white/30" /></div>
        <div className="flex items-center justify-between px-5 pb-2">
          <div className="flex items-center gap-1.5">
            <span className="text-white font-semibold text-[0.92rem]">@{creator.handle}</span>
            {creator.verified && <span className="ig-verified">✓</span>}
          </div>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onClose(); }}
            onTouchEnd={(e) => { e.stopPropagation(); onClose(); }}
            className="ig-close-btn"
            aria-label="Close"
          >✕</button>
        </div>

        <div className="overflow-y-auto px-5 pb-6 flex-1" style={{ WebkitOverflowScrolling: "touch" }}>
          {/* Header: avatar + 3 stats. Tapping the avatar on YOUR profile
              opens the profile editor directly (no menu) — that's the
              "round circle redirects to edit profile" behavior the user
              asked for. */}
          <div className="flex items-center gap-5 pt-2 pb-3">
            <button
              type="button"
              onClick={(creator as any)._isSelf ? () => setEditProfileOpen(true) : undefined}
              className="w-[88px] h-[88px] rounded-full p-[3px] shrink-0 active:scale-95 transition-transform"
              style={{
                background: `conic-gradient(from ${creator.avatarHue}deg, #f0b429, #ff458d, #b964ff, #f0b429)`,
                animation: "igRingPulse 2.6s ease-in-out infinite",
                cursor: (creator as any)._isSelf ? "pointer" : "default",
              }}
              aria-label={(creator as any)._isSelf ? "Edit profile" : "Profile picture"}
            >
              <div
                className="w-full h-full rounded-full flex items-center justify-center text-[2rem] font-bold overflow-hidden"
                style={{
                  background: `linear-gradient(135deg, hsl(${creator.avatarHue},70%,60%), hsl(${(creator.avatarHue+60)%360},70%,40%))`,
                  border: "2px solid #000",
                  color: "#fff",
                  textShadow: "0 2px 6px rgba(0,0,0,0.5)",
                }}
              >
                {(creator as any)._isSelf && myAvatarUrl ? (
                  <img src={myAvatarUrl} alt="" decoding="async" loading="lazy" className="w-full h-full object-cover" />
                ) : (creator as any)._isSelf && myDisplayName && myDisplayName !== "You" ? (
                  myDisplayName.slice(0, 1).toUpperCase()
                ) : (
                  creator.name.slice(0, 1).toUpperCase()
                )}
              </div>
              {/* v112.2 — small "✏️ Edit" pill removed. The full "Edit
                  profile" CTA below already does this, and the avatar
                  itself is tappable (opens the editor). The pill was
                  redundant + crowded the Reels count number. */}
            </button>
            <div className="flex-1 grid grid-cols-3 gap-3 text-center">
              <button onClick={() => setTab("reels")} className="text-center">
                <p className="text-white font-bold text-[1.05rem] leading-none">{fmtCount(reelsCount)}</p>
                <p className="text-white/55 text-[0.66rem] mt-1">Reels</p>
              </button>
              <button onClick={() => setTab("followers")} className="text-center">
                <p className="text-white font-bold text-[1.05rem] leading-none">{fmtCount(followers)}</p>
                <p className="text-white/55 text-[0.66rem] mt-1">Followers</p>
              </button>
              <button onClick={() => setTab("following")} className="text-center">
                <p className="text-white font-bold text-[1.05rem] leading-none">{fmtCount(followingTotal)}</p>
                <p className="text-white/55 text-[0.66rem] mt-1">Following</p>
              </button>
            </div>
          </div>

          {/* Name + bio. Self profile pulls from FollowStore (myBio, myLocation,
              myWebsite). Other profiles use the synthesized creator.bio. Bio
              text is sanitized in either case — anti-bypass guard.
              v112.2 — public-facing badges next to the display name so
              viewers can see at a glance that this is a verified creator
              or hotel partner, without exposing the private stats panel
              (which stays self-only via SelfTierBanner). */}
          <p className="text-white font-semibold text-[0.92rem] leading-tight">
            {(creator as any)._isSelf && myDisplayName && myDisplayName !== "You" ? myDisplayName : creator.name}
            {(creator as any).sourceType === "hotel" && (
              <span title="Hotel partner" className="ml-1.5" style={{ color: "#5b8dff", fontWeight: 800 }} aria-label="Hotel partner">🏨</span>
            )}
            {(creator as any).sourceType === "creator" && (
              <span title="Creator" className="ml-1.5" style={{ color: "#f0d060", fontWeight: 800 }} aria-label="Creator">✦</span>
            )}
            {(creator as any).verified && (
              <span title="Verified" className="ml-1" style={{ color: "#5b8dff", fontWeight: 800 }} aria-label="Verified">✓</span>
            )}
          </p>
          <p className="text-white/75 text-[0.78rem] mt-1 leading-snug whitespace-pre-line">
            {sanitizeComment((creator as any)._isSelf ? (myBio || "Tap “Edit profile” to add a bio about your travels.") : creator.bio).clean}
          </p>
          {(creator as any)._isSelf && myLocation && (
            <p className="text-white/70 text-[0.72rem] mt-1">📍 {sanitizeComment(myLocation).clean}</p>
          )}
          {(creator as any)._isSelf && myWebsite && /^https?:\/\//i.test(myWebsite) && (
            <a
              href={myWebsite}
              target="_blank"
              rel="noopener noreferrer"
              className="block text-[0.74rem] mt-1 truncate"
              style={{ color: "#5b8dff" }}
              onClick={(e) => e.stopPropagation()}
            >
              🔗 {myWebsite}
            </a>
          )}
          <p className="text-gold-300 text-[0.74rem] mt-1">❤️ {fmtCount(likesTotal)} likes earned · {reelsCount} reels published</p>

          {/* Account-tier banner — shown ONLY on self profile so the user
              always knows what kind of account they have + what unlocks
              if they upgrade. Public users see two upgrade paths;
              creators / hotel partners see their dashboard link. */}
          {(creator as any)._isSelf && accountTier !== "UNKNOWN" && (
            <SelfTierBanner
              tier={accountTier}
              stats={accountStats}
              onClose={onClose}
            />
          )}

          {/* CTAs — Message removed (anti-bypass v25). Follow → Edit
              profile when this is the user's own pseudo-entity, since
              following yourself is meaningless. */}
          <div className="mt-3 flex items-center gap-2">
            {(creator as any)._isSelf ? (
              <button
                onClick={() => setEditProfileOpen(true)}
                className="ig-follow-3d ig-follow-3d-on"
                style={{ flex: 2, padding: "11px 16px", fontSize: "0.86rem" }}
              >
                <span className="ig-follow-label">✏️ Edit profile</span>
              </button>
            ) : (
              <button
                onClick={() => toggleFollow(creator.handle)}
                className={`ig-follow-3d ${followed ? "ig-follow-3d-on" : ""}`}
                style={{ flex: 2, padding: "11px 16px", fontSize: "0.86rem" }}
              >
                <span className="ig-follow-label">{followed ? "✓ Following" : "+ Follow"}</span>
              </button>
            )}
            <button
              className="ig-cta-3d"
              style={{ flex: 1, padding: "11px 14px", fontSize: "0.78rem", color: "#fff" }}
              aria-label="Share creator profile"
            >
              <span className="ig-cta-icon">↗</span>
              <span className="ig-cta-text">Share</span>
            </button>
          </div>

          {/* Anti-bypass notice on creator profile */}
          <div
            className="mt-2 px-3 py-1.5 rounded-lg flex items-start gap-2"
            style={{
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.10)",
            }}
          >
            <span className="text-[0.78rem] leading-none mt-0.5">🛡️</span>
            <p className="text-white/60 text-[0.62rem] leading-snug">
              Direct messages aren't available. After your booking is confirmed, chat with the property from My Bookings.
            </p>
          </div>

          {/* Highlights row.
              On self profile: tap → filter the personal reel grid to posts
              tagged with this highlight (Instagram story-highlight UX).
              On other profiles: tap → apply a theme filter to the main feed.
              Custom highlights (from FollowStore) appear after the built-ins. */}
          {(() => {
            const isSelf = !!(creator as any)._isSelf;
            const allHighlights: (Highlight & { custom?: boolean })[] = [
              ...HIGHLIGHTS,
              ...(isSelf ? myCustomHighlights.map((h) => ({ key: h.key, label: h.label, emoji: h.emoji, custom: true })) : []),
            ];
            return (
              <div className="mt-4 flex gap-3 overflow-x-auto no-scrollbar pb-1">
                {/* "All reels" reset chip — self only, when a highlight is active */}
                {isSelf && selectedHighlight && (
                  <button
                    type="button"
                    onClick={() => setSelectedHighlight(null)}
                    className="flex flex-col items-center shrink-0 active:scale-95 transition-transform"
                  >
                    <div className="w-[60px] h-[60px] rounded-full p-[2px]"
                      style={{ background: "linear-gradient(135deg, rgba(255,255,255,0.45), rgba(255,255,255,0.18))" }}>
                      <div className="w-full h-full rounded-full flex items-center justify-center text-xl"
                        style={{ background: "#0a0612", border: "2px solid #000" }}>
                        ↺
                      </div>
                    </div>
                    <span className="text-white/80 text-[0.62rem] mt-1.5 font-semibold max-w-[68px] truncate">All reels</span>
                  </button>
                )}
                {allHighlights.map((hl, i) => {
                  const active = isSelf && selectedHighlight === hl.key;
                  return (
                    <button
                      key={hl.key}
                      onClick={() => {
                        if (isSelf) {
                          // Toggle highlight filter for the personal grid
                          setSelectedHighlight((cur) => cur === hl.key ? null : hl.key);
                        } else {
                          onApplyHighlight?.(hl as Highlight);
                          onClose();
                        }
                      }}
                      className="flex flex-col items-center shrink-0 active:scale-95 transition-transform"
                    >
                      <div className="w-[60px] h-[60px] rounded-full p-[2px]"
                        style={{
                          background: active
                            ? "conic-gradient(from 0deg, #ffd76b, #ff458d, #b964ff, #ffd76b)"
                            : "linear-gradient(135deg, rgba(240,180,41,0.85), rgba(255,69,141,0.65))",
                        }}
                      >
                        <div className="w-full h-full rounded-full flex items-center justify-center text-xl"
                          style={{
                            background: `linear-gradient(135deg, hsl(${(creator.avatarHue + i*40)%360},60%,30%), #0a0612)`,
                            border: "2px solid #000",
                          }}
                        >
                          {hl.emoji}
                        </div>
                      </div>
                      <span className={`text-[0.62rem] mt-1.5 font-semibold max-w-[68px] truncate ${active ? "text-gold-300" : "text-white/80"}`}>
                        {hl.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            );
          })()}

          {/* Tabs */}
          <div className="mt-5 grid grid-cols-4 border-t border-white/10">
            {(["reels", "tagged", "followers", "following"] as const).map((t) => {
              const labelMap: Record<typeof t, string> = {
                reels: "▶ REELS",
                tagged: "🏨 TAGGED",
                followers: "👥 FOLLOWERS",
                following: "➕ FOLLOWING",
              };
              return (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className="py-3 text-[0.62rem] font-bold tracking-wide transition-colors relative"
                  style={{ color: tab === t ? "#fff" : "rgba(255,255,255,0.4)" }}
                >
                  {labelMap[t]}
                  {tab === t && (
                    <span className="absolute left-3 right-3 bottom-0 h-[2px]"
                      style={{ background: "linear-gradient(90deg,#ffd76b,#ff458d,#b964ff)" }} />
                  )}
                </button>
              );
            })}
          </div>

          {/* Tab content */}
          {(tab === "reels" || tab === "tagged") && (
            <div className="grid grid-cols-3 gap-[2px] mt-1">
              {(tab === "reels" ? myReels : tagged).map((h, i) => (
                <button
                  key={h.id || i}
                  type="button"
                  onClick={() => {
                    // Play this exact reel in the feed (don't jump to hotel page)
                    onPickReel?.(h.id);
                    onClose();
                  }}
                  className="ig-reel-tile relative aspect-9/14 overflow-hidden bg-black/40 active:scale-95 transition-transform"
                >
                  {/* Profile grid always renders an <img> — for user video
                      posts that's the captured first-frame poster (data
                      URL JPEG), so it works regardless of codec support
                      and without spinning up a <video> element per tile.
                      A small ▶ overlay marks reels visually. */}
                  {h.images?.[0] ? (
                    <img
                      src={sbImage(h.images[0], SB_IMG_THUMB)}
                      alt={h.name}
                      loading="lazy"
                      decoding="async"
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        // v131.5 — swap to Picsum fallback (always loads) on 404
                        const img = e.currentTarget as HTMLImageElement;
                        if (!img.dataset.fallbackTried) {
                          img.dataset.fallbackTried = "1";
                          img.src = `https://picsum.photos/seed/sb-grid-${h.id || "x"}/400/600`;
                        } else {
                          img.style.display = "none";
                        }
                      }}
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-2xl opacity-50"
                      style={{ background: h._userPost ? "linear-gradient(135deg,#3a1f5c,#0a0816)" : undefined }}>
                      {h._userPost ? (h._userPostKind === "photo" ? "📷" : h._userPostKind === "story" ? "📖" : "🎬") : "🏨"}
                    </div>
                  )}
                  {/* Kind badge — Reel ▶ / Photo 📷 / Story 📖 — so each
                      post type is instantly distinguishable in the grid.
                      Photo tiles also get a subtle inset border so they
                      pop against the (more common) reel tiles. */}
                  <div
                    className="absolute top-1 right-1 px-1.5 py-0.5 rounded-full flex items-center gap-1"
                    style={{
                      background: h._userPost && h._userPostKind === "photo"
                        ? "rgba(255,255,255,0.20)"
                        : h._userPost && h._userPostKind === "story"
                        ? "linear-gradient(135deg, rgba(255,69,141,0.45), rgba(185,100,255,0.30))"
                        : "rgba(0,0,0,0.45)",
                      border: "1px solid rgba(255,255,255,0.22)",
                      backdropFilter: "blur(8px)",
                      WebkitBackdropFilter: "blur(8px)",
                    }}
                  >
                    <span className="text-[0.62rem] leading-none">
                      {h._userPost && h._userPostKind === "photo" ? "📷" :
                       h._userPost && h._userPostKind === "story" ? "📖" : "▶"}
                    </span>
                    <span className="text-white text-[0.56rem] font-bold leading-none" style={{ textShadow: "0 1px 3px rgba(0,0,0,0.8)" }}>
                      {fmtCount(pseudoStat(h.id || h.name, "tile_views", 1200, 480000))}
                    </span>
                  </div>
                  {/* Story-style rainbow ring overlay so stories stand
                      out even at a glance. */}
                  {h._userPost && h._userPostKind === "story" && (
                    <div
                      className="pointer-events-none absolute inset-0"
                      style={{
                        boxShadow: "inset 0 0 0 2px transparent",
                        backgroundImage: "linear-gradient(135deg, rgba(255,69,141,0.20), rgba(185,100,255,0.20), rgba(91,141,255,0.20))",
                        mixBlendMode: "overlay",
                      }}
                    />
                  )}
                  {/* "YOU" tile pill removed from the personal grid per
                      user feedback — it's redundant on your own profile.
                      The badge still appears on the main feed cards
                      (where many other people's reels are mixed in) so
                      it remains useful there. */}
                  <div className="absolute bottom-1 left-1 right-1 text-white text-[0.58rem] truncate font-semibold"
                    style={{ textShadow: "0 1px 3px rgba(0,0,0,0.85)" }}>
                    {h.name}
                  </div>
                </button>
              ))}
              {(tab === "reels" ? myReels : tagged).length === 0 && (
                <div className="col-span-3 py-12 text-center text-white/45 text-sm">
                  No {tab === "reels" ? "reels" : "tagged hotels"} yet.
                </div>
              )}
            </div>
          )}

          {(tab === "followers" || tab === "following") && (
            <div className="mt-3">
              <div className="relative mb-3">
                <input
                  value={followerQuery}
                  onChange={(e) => setFollowerQuery(e.target.value)}
                  placeholder={tab === "followers" ? "Search followers…" : "Search who you follow…"}
                  className="ig-comment-input w-full rounded-full px-4 py-2 text-[0.82rem] outline-hidden"
                  style={{
                    color: "#ffffff",
                    caretColor: "#ffd76b",
                    background: "rgba(255,255,255,0.10)",
                    border: "1px solid rgba(255,255,255,0.20)",
                    fontWeight: 500,
                  }}
                  autoComplete="off"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 text-base pointer-events-none">🔍</span>
              </div>
              <div className="space-y-2 max-h-[40vh] overflow-y-auto pr-1">
                {(tab === "followers" ? followersList : followingList).map((entry, i) => {
                  // entry shape: "Display Name|@handle"
                  const [dn, hndl] = entry.includes("|") ? entry.split("|") : [entry, entry];
                  const cleanHandle = hndl.replace(/^@/, "");
                  const youFollow = isFollowing(cleanHandle);
                  const isYou = cleanHandle === "you (you)";
                  return (
                    <div key={`${entry}-${i}`} className="ig-comment-row flex items-center gap-3 px-1 py-2"
                      style={{ animationDelay: `${Math.min(i * 22, 300)}ms` }}>
                      <div
                        className="w-9 h-9 rounded-full flex items-center justify-center text-[0.72rem] font-bold text-white shrink-0"
                        style={{
                          background: `conic-gradient(from ${(hashStr(entry) % 360)}deg, #f0b429, #ff458d, #b964ff, #f0b429)`,
                        }}
                      >
                        <span className="w-[30px] h-[30px] rounded-full flex items-center justify-center"
                          style={{ background: `linear-gradient(135deg, hsl(${hashStr(entry) % 360},65%,55%), #0a0612)`, border: "1.5px solid #000" }}>
                          {dn.slice(0, 1).toUpperCase()}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-white text-[0.82rem] font-semibold truncate">{dn}{isYou && <span className="text-gold-300 ml-1">· you</span>}</p>
                        <p className="text-white/50 text-[0.66rem] truncate">{hndl}</p>
                      </div>
                      {!isYou && (
                        <button
                          onClick={() => toggleFollow(cleanHandle)}
                          className={`px-3 py-1 rounded-full text-[0.66rem] font-bold transition-colors ${youFollow ? "text-white" : "text-black"}`}
                          style={{
                            background: youFollow ? "rgba(255,255,255,0.10)" : "linear-gradient(135deg,#ffd76b,#f0b429)",
                            border: youFollow ? "1px solid rgba(255,255,255,0.25)" : "1px solid rgba(255,255,255,0.45)",
                            boxShadow: youFollow ? "none" : "0 2px 6px rgba(240,180,41,0.4), inset 0 1px 0 rgba(255,255,255,0.5)",
                          }}
                        >
                          {youFollow ? "Following" : "Follow"}
                        </button>
                      )}
                    </div>
                  );
                })}
                {(tab === "followers" ? followersList : followingList).length === 0 && (
                  <p className="py-10 text-center text-white/45 text-sm">
                    {tab === "followers"
                      ? (followerQuery ? "No matching followers." : "No followers yet.")
                      : (followerQuery ? "No matches." : "You're not following anyone yet. Tap Follow on any reel or profile.")}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Mounted at sheet level so its z-index sits above this overlay */}
      <ProfilePhotoEditor open={editProfileOpen} onClose={() => setEditProfileOpen(false)} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Filter Sheet — pick which user-type's reels to watch + which city
// ─────────────────────────────────────────────────────────────────────────
function FilterSheet({
  open, onClose,
  source, city, onChange,
  cityOptions, sourceCounts,
}: {
  open: boolean;
  onClose: () => void;
  source: SourceType;
  city: string; // "all" | city name
  onChange: (next: { source: SourceType; city: string }) => void;
  cityOptions: string[];
  sourceCounts: Record<SourceType, number>;
}) {
  const [globeOpen, setGlobeOpen] = useState(false);
  if (!open) return null;
  const sources: SourceType[] = ["all", "hotel", "creator", "public"];
  const cities = ["all", ...cityOptions];
  return (
    <div className="fixed inset-0 z-88 flex items-end" onClick={onClose}>
      <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.65)", backdropFilter: "blur(6px)" }} />
      <div
        className="relative w-full ig-drawer-up"
        onClick={(e) => e.stopPropagation()}
        style={{
          maxHeight: "78vh",
          background: "linear-gradient(180deg,#15101e 0%,#0a0612 100%)",
          borderTopLeftRadius: 24, borderTopRightRadius: 24,
          borderTop: "1px solid rgba(255,255,255,0.12)",
          boxShadow: "0 -20px 60px rgba(0,0,0,0.7)",
          paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 16px)",
        }}
      >
        <div className="flex justify-center pt-2.5 pb-1.5"><div className="w-10 h-[3px] rounded-full bg-white/30" /></div>
        <div className="flex items-center justify-between px-5 pb-2">
          <p className="text-white font-semibold text-[0.92rem]">Filter reels</p>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onClose(); }}
            onTouchEnd={(e) => { e.stopPropagation(); onClose(); }}
            className="ig-close-btn"
            aria-label="Close"
          >✕</button>
        </div>

        {/* ── Source: Hotels / Creators / Public / All ── */}
        <div className="px-5 pt-2 pb-3">
          <p className="text-white/55 text-[0.6rem] uppercase tracking-widest mb-2">Whose reels</p>
          <div className="grid grid-cols-2 gap-2">
            {sources.map((s) => {
              const active = s === source;
              return (
                <button
                  key={s}
                  onClick={() => onChange({ source: s, city })}
                  className="ig-filter-pill flex items-center gap-2 px-3 py-2.5 rounded-xl text-left transition-all"
                  style={{
                    background: active
                      ? "linear-gradient(135deg, rgba(240,180,41,0.30), rgba(255,69,141,0.18))"
                      : "rgba(255,255,255,0.05)",
                    border: active ? "1px solid rgba(240,180,41,0.65)" : "1px solid rgba(255,255,255,0.10)",
                    boxShadow: active ? "0 4px 14px rgba(240,180,41,0.25), inset 0 1px 0 rgba(255,255,255,0.18)" : "none",
                  }}
                >
                  <span className="text-lg">{SOURCE_ICON[s]}</span>
                  <span className="flex-1">
                    <span className={`block text-[0.86rem] font-bold ${active ? "text-white" : "text-white/85"}`}>
                      {SOURCE_LABEL[s]}
                    </span>
                    <span className="block text-[0.62rem] text-white/55">
                      {sourceCounts[s]} {sourceCounts[s] === 1 ? "reel" : "reels"}
                    </span>
                  </span>
                  {active && <span className="text-gold-300">✓</span>}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Location ── */}
        <div className="px-5 pt-1 pb-2 border-t border-white/8">
          <p className="text-white/55 text-[0.6rem] uppercase tracking-widest mb-2 mt-3">📍 Location</p>

          {/* Premium animated globe launcher — opens the shared LocationGlobeModal.
              Picking a city writes `sb_city` + fires `sb:city-change`, which the
              parent feed listens to and updates `filterCity` automatically. */}
          <button
            onClick={() => setGlobeOpen(true)}
            className="w-full flex items-center gap-3 mb-2 px-3 py-3 rounded-2xl text-left transition-all"
            style={{
              background: "linear-gradient(135deg, rgba(240,180,41,0.16), rgba(255,69,141,0.10))",
              border: "1px solid rgba(240,180,41,0.4)",
              boxShadow: "0 4px 14px rgba(240,180,41,0.18), inset 0 1px 0 rgba(255,255,255,0.18)",
            }}
          >
            {/* Mini-globe icon — same spinning vibe as the modal */}
            <span
              style={{
                position: "relative",
                width: 36, height: 36, flexShrink: 0,
                borderRadius: "50%",
                background: "conic-gradient(from 0deg, #1c3a5c, #2a5a8a, #1c3a5c, #2c4a72, #1c3a5c, #244268, #1c3a5c)",
                boxShadow: "inset -3px -3px 8px rgba(0,0,0,0.5), inset 2px 2px 6px rgba(240,180,41,0.2), 0 0 14px rgba(240,180,41,0.3)",
                overflow: "hidden",
                animation: "igGlobeMiniSpin 8s linear infinite",
              }}
            >
              <span
                style={{
                  position: "absolute", inset: 0,
                  background:
                    "radial-gradient(ellipse 30% 18% at 30% 35%, rgba(46,204,113,0.6), transparent 70%)," +
                    "radial-gradient(ellipse 18% 22% at 65% 60%, rgba(46,204,113,0.5), transparent 70%)",
                }}
              />
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span className="block text-white text-[0.88rem] font-bold leading-tight">
                {city === "all" ? "Anywhere in India" : city}
              </span>
              <span className="block text-white/55 text-[0.66rem]">
                Tap to open the live globe · auto-detect or search
              </span>
            </span>
            <span style={{ color: "rgba(240,180,41,0.85)", fontSize: "1rem", fontWeight: 700 }}>›</span>
          </button>
          <style jsx global>{`
            @keyframes igGlobeMiniSpin {
              0% { transform: rotate(0deg); }
              100% { transform: rotate(360deg); }
            }
          `}</style>

          {/* Quick-pick pills for the cities present in the feed */}
          <div
            className="flex flex-wrap gap-1.5 overflow-y-auto pr-1"
            style={{ maxHeight: "26vh" }}
          >
            {cities.map((c) => {
              const active = c === city;
              return (
                <button
                  key={c}
                  onClick={() => onChange({ source, city: c })}
                  className="px-3 py-1.5 rounded-full text-[0.74rem] font-bold transition-all"
                  style={{
                    background: active
                      ? "linear-gradient(135deg, #ffd76b, #f0b429)"
                      : "rgba(255,255,255,0.06)",
                    color: active ? "#1a1208" : "rgba(255,255,255,0.85)",
                    border: active ? "1px solid rgba(255,255,255,0.45)" : "1px solid rgba(255,255,255,0.12)",
                    boxShadow: active ? "0 3px 10px rgba(240,180,41,0.4), inset 0 1px 0 rgba(255,255,255,0.5)" : "none",
                  }}
                >
                  {c === "all" ? "🌐 All India" : `📍 ${c}`}
                </button>
              );
            })}
          </div>
        </div>

        {globeOpen && (
          <LocationGlobeModal
            activeCity={city === "all" ? "" : city}
            onClose={() => setGlobeOpen(false)}
          />
        )}

        <div className="px-5 pt-3 flex gap-2">
          <button
            onClick={() => onChange({ source: "all", city: "all" })}
            className="flex-1 py-3 rounded-xl text-white/85 text-[0.82rem] font-semibold"
            style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.15)" }}
          >
            Reset
          </button>
          <button
            onClick={onClose}
            className="ig-cta-3d ig-cta-book"
            style={{ flex: 2, padding: "12px", fontSize: "0.86rem" }}
          >
            <span className="ig-cta-icon">▶</span>
            <span className="ig-cta-text">Show reels</span>
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Edit-post sheet — slide-up drawer for changing caption + tags on an
// already-posted user reel/photo/story. Media itself is NOT editable
// (user can Delete + Re-create for that). Save calls addPost with the
// same id which the PostsStore dedupes → replaces in place.
// ─────────────────────────────────────────────────────────────────────────
function EditPostSheet({
  post, onClose, onSave, sanitize,
}: {
  post: any;
  onClose: () => void;
  onSave: (updated: any) => void;
  sanitize?: (s: string) => { clean: string; blocked: boolean };
}) {
  const [caption, setCaption] = useState<string>(post.caption || "");
  const [tags, setTags] = useState<string[]>(Array.isArray(post.tags) ? post.tags : []);
  const TAG_PRESETS = ["TravelDiaries","LuxuryStay","BudgetTrip","Foodie","Mountains","Beaches","Solo","Couple","Family","WeekendGetaway","StayBidLife","VerifiedStay"];
  const EMOJI_BAR = ["❤️","🔥","✨","😍","🥳","🌄","🛏","🍴","📍","🌟"];
  const toggleTag = (t: string) => setTags((p) => p.includes(t) ? p.filter((x) => x !== t) : [...p, t]);
  const insertEmoji = (e: string) => setCaption((c) => c + e);

  const save = () => {
    const cleanCaption = sanitize ? sanitize(caption).clean : caption;
    onSave({ ...post, caption: cleanCaption, tags });
  };

  return (
    <div className="fixed inset-0 z-88 flex items-end" onClick={onClose}>
      <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(6px)" }} />
      <div
        className="relative w-full ig-drawer-up"
        onClick={(e) => e.stopPropagation()}
        style={{
          maxHeight: "82vh",
          background: "linear-gradient(180deg,#15101e 0%,#0a0612 100%)",
          borderTopLeftRadius: 24, borderTopRightRadius: 24,
          borderTop: "1px solid rgba(255,255,255,0.12)",
          boxShadow: "0 -20px 60px rgba(0,0,0,0.7)",
          paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 14px)",
          display: "flex", flexDirection: "column",
        }}
      >
        <div className="flex justify-center pt-2.5 pb-1.5"><div className="w-10 h-[3px] rounded-full bg-white/30" /></div>
        <div className="flex items-center justify-between px-5 pb-3 border-b border-white/8">
          <button onClick={onClose} className="text-white/85 text-[0.84rem]">Cancel</button>
          <p className="text-white font-semibold text-[0.92rem]">
            Edit {post.kind === "photo" ? "photo" : post.kind === "story" ? "story" : "reel"}
          </p>
          <button onClick={save} className="text-gold-300 font-bold text-[0.84rem]">Save</button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {post.posterUrl && (
            <div className="w-full max-w-[200px] mx-auto rounded-xl overflow-hidden" style={{ aspectRatio: "9/14" }}>
              <img src={post.posterUrl} alt="" decoding="async" loading="lazy" className="w-full h-full object-cover" />
            </div>
          )}

          <div>
            <p className="text-white/55 text-[0.6rem] uppercase tracking-widest mb-1.5">Caption</p>
            <textarea
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              rows={3}
              maxLength={500}
              placeholder="Write a caption…"
              className="w-full rounded-xl px-3 py-2 text-[0.82rem] outline-hidden resize-none"
              style={{
                color: "#fff",
                caretColor: "#ffd76b",
                background: "rgba(255,255,255,0.10)",
                border: "1px solid rgba(255,255,255,0.20)",
                minHeight: 70,
                fontWeight: 500,
              }}
            />
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {EMOJI_BAR.map((e) => (
                <button key={e} type="button" onClick={() => insertEmoji(e)}
                  className="px-2 py-1 rounded-full text-base"
                  style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.10)" }}>
                  {e}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-white/55 text-[0.6rem] uppercase tracking-widest mb-1.5">Tags</p>
            <div className="flex flex-wrap gap-1.5">
              {TAG_PRESETS.map((t) => {
                const active = tags.includes(t);
                return (
                  <button key={t} type="button" onClick={() => toggleTag(t)}
                    className="px-3 py-1 rounded-full text-[0.7rem] font-bold transition-all"
                    style={{
                      background: active ? "linear-gradient(135deg,#ffd76b,#f0b429)" : "rgba(255,255,255,0.05)",
                      color: active ? "#1a1208" : "rgba(255,255,255,0.85)",
                      border: active ? "1px solid rgba(255,255,255,0.45)" : "1px solid rgba(255,255,255,0.10)",
                    }}>#{t}</button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Toast
// ─────────────────────────────────────────────────────────────────────────
function Toast({ msg }: { msg: string | null }) {
  if (!msg) return null;
  return (
    <div className="fixed top-16 left-1/2 -translate-x-1/2 z-90 ig-toast">
      <div
        className="px-4 py-2 rounded-full text-white text-[0.78rem] font-semibold"
        style={{
          background: "rgba(20,16,30,0.85)",
          backdropFilter: "blur(14px)",
          WebkitBackdropFilter: "blur(14px)",
          border: "1px solid rgba(255,255,255,0.18)",
          boxShadow: "0 8px 24px rgba(0,0,0,0.45)",
        }}
      >
        {msg}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// HotelCard — one Reels card per hotel
// ─────────────────────────────────────────────────────────────────────────
const HotelCard = memo(function HotelCard({
  item, active, adjacent, muted, hasInteracted, onMuteToggle,
  onTrackEvent, onBook, onNegotiate, onShare, onOpenComments, onOpenMore, onCopyLink, onOpenEntity, onWatchEntity,
  hasOwnStories, onOpenStories, initialSaved,
}: {
  item: Item;
  active: boolean;
  /** True when this card is one slot above or below the active card.
      Non-active, non-adjacent cards downgrade <video preload> from "auto"
      → "metadata" so we don't fetch 8 reels of MP4 data on initial load.
      Big perf win on slower networks. */
  adjacent: boolean;
  muted: boolean;
  hasInteracted: boolean;                  // gate the "Tap to unmute" coach mark
  onMuteToggle: () => void;
  onTrackEvent?: (n: string, p: any) => void;
  onBook: (h: any) => void;
  onNegotiate: (h: any) => void;
  onShare: (h: any) => void;
  onOpenComments: (h: any) => void;
  onOpenMore: (h: any) => void;
  onCopyLink: (h: any) => void;
  onOpenEntity: (e: Creator) => void;     // open profile sheet for any entity
  onWatchEntity: (e: Creator) => void;    // filter feed to that entity's reels
  /** True when the current user has any active (non-expired) stories. Lights
      up the story ring on the user's own avatar + makes the avatar tap open
      the StoryViewer instead of the popover menu. */
  hasOwnStories?: boolean;
  onOpenStories?: () => void;
  /** True when the parent's hydrated savedSet contains this item — drives
      the bookmark-icon initial state so previously-saved reels show
      bookmarked on re-mount. */
  initialSaved?: boolean;
}) {
  const h = item.hotel;
  const router = useRouter();
  const images: string[] = (h.images || []).filter(Boolean);
  const videoSrc = videoForHotel(h);
  const creator = creatorFor(h);
  const hotelEntity = entityFromHotel(h);
  // v243 — on home `/` the brand lives in the Flash Deals rail (no over-video
  // wordmark), so the profile chip can sit tight to the top; on /discover the
  // `.reel-brand-chrome` wordmark IS over the video, so the chip keeps its 38px
  // clearance. (Fixes the big gap between the flash rail and the @handle.)
  const isHome = usePathname() === "/";
  const chipTop = `calc(env(safe-area-inset-top, 0px) + ${isHome ? 12 : 38}px)`;
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [photoIdx, setPhotoIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const [liked, setLiked] = useState(false);
  const [saved, setSaved] = useState(!!initialSaved);
  const [hearts, setHearts] = useState<Heart[]>([]);
  const [showCaption, setShowCaption] = useState(false);
  const [followSparkle, setFollowSparkle] = useState(0);
  // Tap-on-avatar popover (Instagram-style "View Profile / Watch Reels")
  const [avatarMenu, setAvatarMenu] = useState<null | { kind: "hotel" | "creator" }>(null);
  const lastTapRef = useRef<{ t: number; x: number; y: number } | null>(null);
  const cardRef = useRef<HTMLElement | null>(null);

  // v465 — Desktop-only cinematic ambient backdrop. When THIS card is the
  // active reel on a wide screen (>=1024px), publish its cover image to a CSS
  // custom property that app/desktop.css paints (blurred, low-opacity colour
  // wash) into the empty gutters flanking the centred phone frame — turning the
  // "floating frame in a white void" into a Spotify-now-playing-style ambience.
  // No-op on mobile (the whole reel is fullscreen there); reads only, never
  // touches the reel data / dedup / fullscreen paths.
  const ambientCover = images[0] || (item as any)?.posterUrl || (item as any)?._poster || "";
  useEffect(() => {
    if (!active || !ambientCover) return;
    if (typeof window === "undefined" || window.innerWidth < 1024) return;
    document.documentElement.style.setProperty("--reel-ambient-img", `url("${ambientCover}")`);
  }, [active, ambientCover]);

  // GLOBAL follow state — shared across cards, profile sheets, sub-chips
  const { isFollowing, toggleFollow, followerCount, myAvatarUrl, myDisplayName } = useFollow();
  const followed = isFollowing(hotelEntity.handle);

  // v107 — network tier drives <video preload>. On India 3G we drop
  // EVERY card (active included) to preload="metadata" so the first
  // poster image paints immediately instead of waiting on MP4 bytes.
  // On slow-2g / saveData we go further: preload="none" so the user
  // sees the Ken-Burns poster and only spins up the video on tap.
  const netTier = useNetworkTier();
  const videoPreload: "auto" | "metadata" | "none" =
    netTier === "slow"
      ? "none"
      : netTier === "mid"
        ? (active ? "metadata" : "none")
        : (active ? "auto" : (adjacent ? "metadata" : "none"));
  const followersLive = followerCount(hotelEntity.handle);

  // GLOBAL gain (volume booster) — read here so the gain node updates when
  // the user moves the slider in the right rail.
  const { gain } = useSoundStore();
  // Per-card audio override (custom soundtrack picked from the audio strip
  // — or, for user-posted reels, the audio attached at upload time).
  // v114 — seed customAudio from `_userPostAudio` so a creator's custom
  // soundtrack overrides the video's original audio in the feed exactly
  // like Instagram.
  // v116 — also REACT to changes in `_userPostAudio` via a useEffect so
  // the audio swap propagates after PostsStore.updatePost() patches the
  // local entry's audio.url from blob: to the public Storage URL (right
  // after the upload completes). Without this, the uploader's own card
  // kept playing the original video audio + the dead blob URL.
  const initialPostAudio = (h as any)?._userPostAudio;
  const [customAudio, setCustomAudio] = useState<AudioTrack | null>(
    initialPostAudio && initialPostAudio.url
      ? { id: "post-audio", name: initialPostAudio.name || "Custom audio", artist: "", url: initialPostAudio.url }
      : null
  );
  useEffect(() => {
    const a = (h as any)?._userPostAudio;
    if (a && a.url) {
      // Only re-seed if the URL actually changed (otherwise we'd thrash
      // playback on every render).
      if (!customAudio || customAudio.url !== a.url) {
        setCustomAudio({ id: "post-audio", name: a.name || "Custom audio", artist: "", url: a.url });
      }
    } else if (customAudio?.id === "post-audio") {
      // Post audio was cleared.
      setCustomAudio(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [(h as any)?._userPostAudio?.url]);
  const [audioPickerOpen, setAudioPickerOpen] = useState(false);
  const audioElRef = useRef<HTMLAudioElement | null>(null);

  const initialLikes = pseudoStat(h.id || "x", "likes", 1240, 28400);
  const baseViews = pseudoStat(h.id || "x", "views", 14000, 580000);
  // v401 — real comment count from the per-post store (seed + user comments).
  // Always equals what opens in the drawer — no more "542 shown / 6 inside".
  const comments = useCommentCount(h.id || "x");
  const [likeCount, setLikeCount] = useState(initialLikes);
  const [viewCount, setViewCount] = useState(baseViews);

  // ─── Force-pause signals (v82) ─────────────────────────────────────
  // Declared HERE (before the audio + video effects) so both can reference
  // forcePaused in their dep arrays. Pauses whenever:
  //   • document.visibilityState === "hidden"  (phone lock, tab switch, app minimise)
  //   • body.fdeal-viewer-open is set           (flash-deal viewer overlay open)
  //   • body.sb-composer-open is set           (v114 — Create modal open;
  //     prevents background reel audio from distracting the creator while
  //     they upload a new video)
  const [forcePaused, setForcePaused] = useState(false);
  useEffect(() => {
    if (typeof document === "undefined") return;
    const compute = () => {
      const hidden = document.visibilityState === "hidden";
      const viewerOpen = document.body.classList.contains("fdeal-viewer-open");
      const composerOpen = document.body.classList.contains("sb-composer-open");
      setForcePaused(hidden || viewerOpen || composerOpen);
    };
    compute();
    document.addEventListener("visibilitychange", compute);
    window.addEventListener("pagehide", compute);
    window.addEventListener("blur", compute);
    window.addEventListener("focus", compute);
    const mo = new MutationObserver(compute);
    mo.observe(document.body, { attributes: true, attributeFilter: ["class"] });
    return () => {
      document.removeEventListener("visibilitychange", compute);
      window.removeEventListener("pagehide", compute);
      window.removeEventListener("blur-sm", compute);
      window.removeEventListener("focus", compute);
      mo.disconnect();
    };
  }, []);

  // ═══ DEDICATED audio sync — runs independently of the video useEffect.
  // Bug previously: picking custom audio on reel A then scrolling to reel B
  // didn't stop A's audio because pause was tangled inside a multi-condition
  // video effect that early-returned on certain refs being null. Now the
  // audio element has its OWN tightly-scoped lifecycle: mounted only when
  // customAudio is set, played only when active && !paused, paused HARD
  // every other moment + on cleanup. ═══
  useEffect(() => {
    const a = audioElRef.current;
    if (!a) return;
    if (active && customAudio && !paused && !forcePaused) {
      try {
        a.muted = false;
        a.volume = 1;
        // ⚠️ DO NOT call applyGain on this audio element.
        // applyGain → createMediaElementSource → Web Audio graph. The moment
        // ANY cross-origin media without a CORS-clean response (most public
        // MP3 hosts, including SoundHelix) is connected to Web Audio, the
        // browser silences the output for security. That was the actual
        // root cause of "I picked audio, no sound plays" — the picked
        // track WAS playing, just routed through Web Audio and silenced.
        // Native volume (capped at 1.0) is plenty loud and ALWAYS audible.
        const p = a.play();
        if (p && typeof p.then === "function") p.catch(() => {});
      } catch {}
    } else {
      try { a.pause(); a.currentTime = 0; } catch {}
    }
    // Cleanup runs on every dep change AND unmount — ensures the audio
    // never leaks across reels.
    return () => {
      const el = audioElRef.current;
      if (el) { try { el.pause(); el.currentTime = 0; } catch {} }
    };
    // forcePaused (visibility / viewer overlay) must trigger re-eval too
  }, [active, customAudio, paused, forcePaused]);

  // Video play/pause sync with active state. Four signals:
  //   1. video.muted   — controls the native track on the <video>
  //   2. Web-Audio gain — boosts louder than 1.0 when user has bumped the
  //      volume slider (lib/audio-amplifier).
  //   3. customAudio   — when the user picks a soundtrack from the audio
  //      strip, we mute the video and play <audio src={customAudio.url}>
  //      in sync.
  //   4. forcePaused  — system signal (tab hidden / app minimise / flash-
  //      deal viewer overlay open). Beats all other state so we never
  //      leak audio.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const useCustom = !!customAudio;
    // When custom audio is in use, mute the video (so two tracks don't
    // double up). Otherwise honour the global mute state.
    v.muted = useCustom ? true : muted;
    v.volume = 1;

    if (active && !paused && !forcePaused) {
      resumeAudio();
      const p = v.play();
      if (p && typeof p.then === "function") p.catch(() => {});
    } else {
      v.pause();
      if (!active) {
        try { v.currentTime = 0; } catch {}
        if (paused) setPaused(false);
      }
    }
  }, [active, paused, muted, customAudio, forcePaused]);

  // Slow Ken-Burns photo cycle as a fallback (only if no video src or video errors).
  // Initialize as TRUE when there's no video source (user photo/story uploads)
  // so the photo renders immediately without waiting for an onError event.
  const [videoBroken, setVideoBroken] = useState(!videoSrc);
  // Track WHY the video couldn't play — codec? network? — so the fallback
  // surface can tell the user something actionable instead of a vague
  // "preview unavailable".
  const [videoErrorMsg, setVideoErrorMsg] = useState<string>("");
  useEffect(() => {
    if (!active || images.length < 2 || !videoBroken) return;
    const id = setInterval(() => setPhotoIdx((i) => (i + 1) % images.length), 3800);
    return () => clearInterval(id);
  }, [active, images.length, videoBroken]);

  // Live view counter
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setViewCount((v) => v + Math.floor(Math.random() * 4) + 1), 2200);
    return () => clearInterval(id);
  }, [active]);

  const triggerLike = useCallback((x?: number, y?: number) => {
    setLiked((prev) => {
      if (!prev) setLikeCount((c) => c + 1);
      else setLikeCount((c) => Math.max(0, c - 1));
      return !prev;
    });
    const rect = cardRef.current?.getBoundingClientRect();
    const baseX = x != null && rect ? x - rect.left : (rect ? rect.width - 60 : 300);
    const baseY = y != null && rect ? y - rect.top  : (rect ? rect.height - 220 : 600);
    const burst = spawnHearts(baseX, baseY, 12);
    setHearts((h) => [...h, ...burst]);
    const maxDur = Math.max(...burst.map((b) => b.dur));
    setTimeout(() => {
      setHearts((h) => h.filter((p) => !burst.find((b) => b.id === p.id)));
    }, maxDur + 50);
    onTrackEvent?.("ig_like", { hotelId: h.id });
  }, [h.id, onTrackEvent]);

  const handleDoubleTap = useCallback((e: React.TouchEvent | React.MouseEvent) => {
    const now = Date.now();
    let x = 0, y = 0;
    const anyE = e as any;
    if (anyE.changedTouches?.length || anyE.touches?.length) {
      const t = (anyE.changedTouches && anyE.changedTouches[0]) || (anyE.touches && anyE.touches[0]);
      x = t?.clientX || 0; y = t?.clientY || 0;
    } else {
      x = (e as React.MouseEvent).clientX;
      y = (e as React.MouseEvent).clientY;
    }
    const last = lastTapRef.current;
    if (last && now - last.t < 320 && Math.abs(x - last.x) < 40 && Math.abs(y - last.y) < 40) {
      // Double-tap = always like (never unlike, IG behavior)
      if (!liked) {
        setLiked(true); setLikeCount((c) => c + 1);
      }
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const burst = spawnHearts(x - rect.left, y - rect.top, 14);
      setHearts((h) => [...h, ...burst]);
      const maxDur = Math.max(...burst.map((b) => b.dur));
      setTimeout(() => setHearts((h) => h.filter((p) => !burst.find((b) => b.id === p.id))), maxDur + 50);
      lastTapRef.current = null;
      onTrackEvent?.("ig_double_tap_like", { hotelId: h.id });
    } else {
      lastTapRef.current = { t: now, x, y };
    }
  }, [liked, h.id, onTrackEvent]);

  const handleFollowClick = useCallback(() => {
    toggleFollow(hotelEntity.handle);
    setFollowSparkle((n) => n + 1);
    onTrackEvent?.("ig_follow", { hotelId: h.id, handle: hotelEntity.handle });
  }, [h.id, hotelEntity.handle, toggleFollow, onTrackEvent]);

  const activeImg = images[photoIdx] || images[0];
  const initials = (h.name || "?").split(" ").slice(0, 2).map((s: string) => s[0]).join("").toUpperCase();
  const tags = hashtagsFor(h);
  // Sanitize the hotel-supplied description — anti-bypass: a hotel could
  // otherwise sneak a phone number / WhatsApp link into its public bio to
  // pull customers off-platform.
  const rawDescription = h.description || `Welcome to ${h.name} — a curated escape in ${h.city || "the hills"}. Real-time bidding. Verified luxury. Book at your price.`;
  const description = sanitizeComment(rawDescription).clean;

  return (
    <section
      ref={cardRef as any}
      className="ig-card relative w-full snap-start snap-always overflow-hidden bg-black"
      onTouchEnd={handleDoubleTap}
      onDoubleClick={handleDoubleTap}
    >
      {/* Reel video (with photo poster as fallback / first paint).
          NOTE: webkit-playsinline must be passed via spread because React's
          camelCase prop is `playsInline`; the WebKit-prefixed variant is
          required by older iOS Safari (≤ iOS 9.3) and some embedded WebViews. */}
      {!videoBroken && (
        <video
          ref={videoRef}
          // Use <source> for the user-post case so we can hint the codec
          // (helps Chromium pick the right decoder when the file is iOS
          // HEVC). For the dummy CDN clips we keep the simple src=.
          {...(h._userPost ? {} : { src: videoSrc })}
          poster={sbImage(activeImg, SB_IMG_HERO)}
          loop
          autoPlay
          muted={muted}
          playsInline
          // Perf: only the active card eagerly fetches the full video. The
          // two adjacent cards fetch only metadata so the user gets an
          // instant-play feel when they swipe. Off-screen cards skip the
          // network entirely — preventing N parallel MP4 downloads on cold
          // start of the feed. v107 — `videoPreload` adapts further on
          // 3G / 2G / Save-Data to "metadata" or "none" universally.
          preload={videoPreload}
          {...({ "webkit-playsinline": "true", "x-webkit-airplay": "allow" } as any)}
          className="absolute inset-0 w-full h-full"
          style={{
            width: "100%", height: "100%", objectFit: "cover",
            // v114 — replay the IG-style filter the creator picked in the
            // composer. `_userPostFilter` is the preset id; map it to a CSS
            // filter string here. For non-user-post cards this is "none".
            filter: filterCssForId((h as any)._userPostFilter),
          }}
          onError={(e) => {
            const v = e.currentTarget as HTMLVideoElement;
            const code = v?.error?.code;
            const mime = h._userPostMime || "";
            // 4 = MEDIA_ERR_SRC_NOT_SUPPORTED — codec/format isn't decodable
            // 3 = MEDIA_ERR_DECODE — file is corrupt or partially supported
            // 2 = MEDIA_ERR_NETWORK — fetch failed
            // 1 = MEDIA_ERR_ABORTED — user / browser cancelled
            const msg =
              code === 4 ? `Your browser can't play ${mime || "this format"}. Try uploading an MP4 (H.264 / AAC).` :
              code === 3 ? `Could not decode the video — file may be corrupt. Re-record or convert to MP4.` :
              code === 2 ? `Network failed while loading the video. Try again on Wi-Fi.` :
              `Video failed to play${mime ? ` (${mime})` : ""}.`;
            setVideoErrorMsg(msg);
            setVideoBroken(true);
          }}
          onClick={(e) => {
            // Tap on video:
            //   - if currently muted globally → UNMUTE inside the user
            //     gesture so the browser autoplay policy allows audio.
            //     We mutate v.muted/v.volume and call v.play() DIRECTLY
            //     here (not via state→useEffect) because some browsers
            //     drop the gesture context across React's render cycle.
            //   - else → toggle play/pause
            e.stopPropagation();
            const v = videoRef.current; if (!v) return;
            if (muted) {
              try {
                v.muted = false;
                v.volume = 1;
                const p = v.play();
                if (p && typeof p.then === "function") p.catch(() => {});
              } catch {}
              onMuteToggle();
              return;
            }
            if (v.paused) { v.play().catch(()=>{}); setPaused(false); }
            else          { v.pause(); setPaused(true); }
          }}
        >
          {/* For user posts, drop the codec hint as a <source> child so
              Chromium picks the right decoder. The <video src=…> path is
              skipped via the spread above. */}
          {h._userPost && videoSrc ? (
            <source src={videoSrc} type={h._userPostMime || "video/mp4"} />
          ) : null}
        </video>
      )}
      {videoBroken && (activeImg ? (
        <img
          key={`${h.id}-${photoIdx}`}
          src={activeImg}
          alt={h.name}
          draggable={false}
          decoding="async"
          loading={active ? "eager" : "lazy"}
          className="ig-kb absolute inset-0 w-full h-full object-cover"
          style={{ filter: filterCssForId((h as any)._userPostFilter) }}
        />
      ) : h._userPost ? (
        // User post whose media couldn't be played. Show a coloured
        // gradient + kind badge + the SPECIFIC reason (codec name etc.)
        // so the user can act on it instead of staring at a black square.
        <div
          className="absolute inset-0 flex flex-col items-center justify-center px-8 text-center"
          style={{
            background: "linear-gradient(135deg,#2A2013 0%,#1A130A 55%,#0d0a05 100%)",
          }}
        >
          <span className="text-6xl mb-3 opacity-90">
            {h._userPostKind === "photo" ? "📷" : h._userPostKind === "story" ? "📖" : "🎬"}
          </span>
          <p className="text-white font-semibold text-base mb-1">Your {h._userPostKind || "post"}</p>
          {h.description && (
            <p className="text-white/70 text-[0.78rem] leading-snug max-w-xs line-clamp-3 mb-3">
              {h.description}
            </p>
          )}
          <p className="text-amber-300/90 text-[0.7rem] leading-snug max-w-xs">
            {videoErrorMsg || "Media preview unavailable · reupload to refresh"}
          </p>
          {h._userPostMime && (
            <p className="text-white/35 text-[0.58rem] mt-1.5 font-mono">{h._userPostMime}</p>
          )}
        </div>
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-7xl opacity-40"
          style={{ background: "linear-gradient(135deg,#2A2013,#1A130A)" }}>🏨</div>
      ))}

      {/* Pause overlay icon when video paused */}
      {paused && !videoBroken && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20">
          <div className="ig-pause-badge">▶</div>
        </div>
      )}

      {/* "🔇 Tap to unmute" coach mark — only on the FIRST reel the user
          ever views, until they interact with sound for the first time.
          Auto-dismisses on tap (which also unmutes via the user gesture). */}
      {active && muted && !hasInteracted && !videoBroken && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            const v = videoRef.current;
            if (v) {
              try {
                v.muted = false;
                v.volume = 1;
                const p = v.play();
                if (p && typeof p.then === "function") p.catch(() => {});
              } catch {}
            }
            onMuteToggle();
          }}
          className="ig-tap-unmute"
          aria-label="Tap to unmute"
        >
          <span className="ig-tap-unmute-icon">🔇</span>
          <span className="ig-tap-unmute-label">Tap to unmute</span>
        </button>
      )}

      {/* Top + bottom dark gradients */}
      <div className="absolute inset-x-0 top-0 h-40 bg-linear-to-b from-black/70 via-black/30 to-transparent pointer-events-none" />
      <div className="absolute inset-x-0 bottom-0 h-96 bg-linear-to-t from-black/90 via-black/45 to-transparent pointer-events-none" />

      {/* Top-LEFT: hotel profile chip. v88 — pushed down to `top: 38` so
          the brand wordmark restored on /discover + / sits ABOVE the chip
          and never collides with the @handle row. Combined with the
          safe-area-inset-top (v87) the chip clears every device's notch +
          the brand wordmark on the same surface. */}
      <div
        className="ig-profile-chip absolute left-3 right-3 z-30 flex items-center gap-2.5"
        style={{ top: chipTop }}
      >
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            // Self with active stories → open the StoryViewer directly
            // (Instagram-style "tap the story ring-3 to view"). Else fall
            // back to the existing avatar popover menu.
            if (h._isSelf && hasOwnStories && onOpenStories) {
              onOpenStories();
              onTrackEvent?.("ig_open_stories_from_avatar", { hotelId: h.id });
              return;
            }
            setAvatarMenu({ kind: "hotel" });
          }}
          className={`ig-avatar relative shrink-0${h._isSelf && hasOwnStories ? " has-story" : ""}`}
          aria-label={h._isSelf && hasOwnStories ? "View your story" : `${h.name} profile options`}
        >
          <span className="ig-avatar-inner">
            {/* For YOUR posts, prefer the user's chosen profile photo —
                otherwise fall back to the post's poster/image, otherwise
                show display-name initials. */}
            {h._isSelf && myAvatarUrl ? (
              <img src={myAvatarUrl} alt="" decoding="async" loading={active ? "eager" : "lazy"} className="w-full h-full object-cover rounded-full" />
            ) : h.images?.[0] ? (
              <img src={sbImage(h.images[0], SB_IMG_AVATAR)} alt={h.name} decoding="async" loading={active ? "eager" : "lazy"} className="w-full h-full object-cover rounded-full" />
            ) : (
              <span className="text-[0.78rem] font-bold text-black">
                {h._isSelf ? (myDisplayName || "Y").slice(0, 1).toUpperCase() : initials}
              </span>
            )}
          </span>
        </button>
        <div className="flex-1 min-w-0">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOpenEntity(hotelEntity);
              onTrackEvent?.("ig_open_hotel_profile", { hotelId: h.id });
            }}
            className="flex items-center gap-1.5 leading-none active:scale-95 transition-transform"
            aria-label={`Open ${h.name} profile`}
          >
            <span className="text-white font-semibold text-[0.92rem] truncate" style={{ textShadow: "0 1px 4px rgba(0,0,0,0.7)" }}>
              {h._isSelf
                ? (myDisplayName && myDisplayName !== "You"
                    ? myDisplayName
                    : "Your post")
                : (h.name || "Hotel").toLowerCase().replace(/\s+/g, "_").slice(0, 22)}
            </span>
            {!h._isSelf && <span className="ig-verified" title="Verified hotel">✓</span>}
          </button>
          <div className="mt-0.5 flex items-center gap-1.5 text-[0.62rem] text-white/75" style={{ textShadow: "0 1px 3px rgba(0,0,0,0.7)" }}>
            <span>📍 {h.city || "—"}</span>
            <span className="opacity-50">·</span>
            <span>{fmtCount(followersLive)} followers</span>
          </div>
          {/* Creator subline — only shown for CREATOR or PUBLIC reels.
              For HOTEL-source reels, the hotel itself IS the author —
              showing a second @creator chip below would be both
              redundant AND misleading (e.g. a Mussoorie hotel reel
              showing "@indiastays" below it implied a different
              poster, which the user explicitly flagged as wrong).
              User-uploaded posts also skip this — `_userPost` reels
              already show "YOU" in the bottom strip. */}
          {creator.sourceType !== "hotel" && !h._userPost && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onOpenEntity(creator); onTrackEvent?.("ig_open_creator", { handle: creator.handle }); }}
              className="mt-1.5 inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded-full transition-transform active:scale-95"
              style={{
                background: "rgba(0,0,0,0.45)",
                border: "1px solid rgba(255,255,255,0.15)",
                backdropFilter: "blur(8px)",
                WebkitBackdropFilter: "blur(8px)",
              }}
            >
              <span
                className="w-4 h-4 rounded-full flex items-center justify-center text-[0.58rem] font-bold text-white"
                style={{ background: `conic-gradient(from ${creator.avatarHue}deg, #f0b429, #ff458d, #b964ff, #f0b429)` }}
              >
                <span className="w-[12px] h-[12px] rounded-full flex items-center justify-center"
                  style={{ background: `linear-gradient(135deg, hsl(${creator.avatarHue},70%,55%), hsl(${(creator.avatarHue+60)%360},70%,40%))`, fontSize: "0.5rem" }}>
                  {creator.name.slice(0, 1).toUpperCase()}
                </span>
              </span>
              <span className="text-white/90 text-[0.6rem] font-semibold">
                {creator.sourceType === "creator" ? "✦ Posted by " : "By "}@{creator.handle}
              </span>
              {creator.verified && <span className="ig-verified" style={{ width: 10, height: 10, fontSize: 7 }}>✓</span>}
            </button>
          )}
        </div>
        {h._isSelf ? (
          // Following yourself makes no sense — replace the Follow button
          // on YOUR OWN reels with a small "You ✦" badge. Other users'
          // public posts (also _userPost=true) keep the normal Follow
          // button so you can follow them.
          <span
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-[0.7rem] font-bold shrink-0"
            style={{
              background: "linear-gradient(135deg, rgba(240,180,41,0.22), rgba(201,166,107,0.14))",
              border: "1px solid rgba(217,190,130,0.42)",
              color: "#fff",
              backdropFilter: "blur(8px)",
              WebkitBackdropFilter: "blur(8px)",
            }}
          >
            ✦ You
          </span>
        ) : (
          <button
            onClick={(e) => { e.stopPropagation(); handleFollowClick(); }}
            className={`ig-follow-3d ${followed ? "ig-follow-3d-on" : ""}`}
          >
            <span className="ig-follow-label">{followed ? "Following" : "Follow"}</span>
            {followSparkle > 0 && (
              <span key={followSparkle} className="ig-follow-sparkle" aria-hidden>
                {Array.from({ length: 6 }).map((_, i) => (
                  <span key={i} className={`ig-spark s${i}`}>✦</span>
                ))}
              </span>
            )}
          </button>
        )}
      </div>

      {/* Right action rail (Instagram Reels style). v89 — reverted the
          v87 +64px shift. The rail items are small (~40px each) and even
          at bottom:200 the lowest item sits well above the BottomDock
          (~y=440 on a 640px viewport vs dock at y=583). The v87 +64 was
          pushing the rail TOO HIGH, where the topmost button (mute)
          ended up colliding with the in-card profile chip's Follow pill
          on the same right edge (user SS1 feedback: "You ke upar sound
          button overlap"). 200px now leaves clean visual space between
          the chip (top) and the rail (mid-right). */}
      <div
        className="absolute right-2 z-30 flex flex-col items-center gap-2.5"
        style={{ bottom: "calc(200px + env(safe-area-inset-bottom, 0px))" }}
      >
        {/* Mute toggle (top of rail to avoid top-corner overlap).
            Mutates the video directly inside the click handler so the
            browser autoplay policy treats this as a real user gesture
            for unmuting — state-only flips were sometimes ignored on
            iOS Safari + Android Chrome. */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            const v = videoRef.current;
            if (v && muted) {
              try {
                v.muted = false;
                v.volume = 1;
                const p = v.play();
                if (p && typeof p.then === "function") p.catch(() => {});
              } catch {}
            } else if (v && !muted) {
              try { v.muted = true; } catch {}
            }
            onMuteToggle();
          }}
          className="ig-rail-btn"
          aria-label={muted ? "Unmute" : "Mute"}
        >
          <span className="ig-icon">{muted ? <RailIcon name="soundOff" /> : <RailIcon name="soundOn" />}</span>
          {/* Volume booster label removed in v82 — was showing "1.8×"
              even when nobody used the booster, just adds noise. Now
              shows simple On/Off state. */}
          <span className="ig-rail-count">{muted ? "Off" : "On"}</span>
        </button>
        <button
          aria-label="Like"
          onClick={(e) => {
            e.stopPropagation();
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
            triggerLike(r.left + r.width / 2, r.top + r.height / 2);
          }}
          className="ig-rail-btn"
        >
          <span className={`ig-icon ${liked ? "ig-liked ig-icon-liked" : ""}`}><RailIcon name="heart" filled={liked} /></span>
          <span className="ig-rail-count">{fmtCount(likeCount)}</span>
        </button>
        <button
          aria-label="Comments"
          onClick={(e) => { e.stopPropagation(); onOpenComments(h); onTrackEvent?.("ig_comment_open", { hotelId: h.id }); }}
          className="ig-rail-btn"
        >
          <span className="ig-icon"><RailIcon name="comment" /></span>
          <span className="ig-rail-count">{fmtCount(comments)}</span>
        </button>
        <button
          aria-label="Share"
          onClick={(e) => { e.stopPropagation(); onShare(h); }}
          className="ig-rail-btn"
        >
          <span className="ig-icon"><RailIcon name="share" /></span>
          <span className="ig-rail-count">Share</span>
        </button>
        <button
          aria-label="Save"
          onClick={(e) => {
            e.stopPropagation();
            // v84 bulletproof save: ALWAYS persist a rich snapshot to
            // localStorage under `sb_local_saves`. Backend POST is best-
            // effort. /saved page reads from BOTH so saves survive even
            // when the user is anon OR the API is down OR the backend
            // user_saves row doesn't make it.
            const willSave = !saved;
            setSaved(willSave);   // optimistic
            onTrackEvent?.("ig_save", { hotelId: h.id, save: willSave });
            const targetType = h._userPost ? "video" : "hotel";
            const targetId = String(h.id);
            // Local-first
            try {
              const raw = localStorage.getItem("sb_local_saves");
              const arr: any[] = raw ? JSON.parse(raw) : [];
              const key = `${targetType}:${targetId}`;
              const next = arr.filter((s: any) => `${s.target_type}:${s.target_id}` !== key);
              if (willSave) {
                // Snapshot in the shape SaveCard expects (s.target.*) so
                // /saved renders correctly without any extra plumbing.
                const target: any =
                  targetType === "video"
                    ? {
                        id: targetId,
                        title: h.name || "Reel",
                        s3_url: h.videoUrl || "",
                        thumbnail_url: (Array.isArray(h.images) && h.images[0]) || "",
                        views_count: h.viewCount || 0,
                      }
                    : {
                        id: targetId,
                        name: h.name || "",
                        city: h.city || "",
                        star_rating: h.starRating || 0,
                        images: Array.isArray(h.images) ? h.images : [],
                      };
                next.unshift({
                  id: `local-${Date.now()}`,
                  target_type: targetType,
                  target_id: targetId,
                  saved_at: new Date().toISOString(),
                  target,
                });
              }
              localStorage.setItem("sb_local_saves", JSON.stringify(next.slice(0, 200)));
            } catch {}
            // Best-effort backend
            const tok = (typeof window !== "undefined") ? localStorage.getItem("sb_token") || "" : "";
            if (!tok) return;
            const method = willSave ? "POST" : "DELETE";
            fetch("/api/discover/save", {
              method,
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` },
              body: JSON.stringify({ targetType, targetId }),
            }).catch(() => {
              // Local already persisted — don't revert UI
            });
          }}
          className="ig-rail-btn"
        >
          <span className={`ig-icon ${saved ? "ig-icon-saved" : ""}`}><RailIcon name="bookmark" filled={saved} /></span>
          <span className="ig-rail-count">{saved ? "Saved" : "Save"}</span>
        </button>
        <button
          aria-label="More"
          onClick={(e) => { e.stopPropagation(); onOpenMore(h); }}
          className="ig-rail-btn"
        >
          <span className="ig-icon"><RailIcon name="more" /></span>
          <span className="ig-rail-count">More</span>
        </button>

        {/* v89 — Rotating audio disc REMOVED per user feedback ("kya kaam hai
            isska, remove karo"). It was purely decorative; the audio still
            plays via the <audio> + <video> elements regardless. */}
      </div>

      {/* BOTTOM-LEFT: caption + price + equal CTAs. v87 — pushed above the
          BottomDock (64px + safe-area) so Book Now / Bid buttons are no
          longer clipped behind the dock. Was the root cause of screenshot 1's
          "buttons neeche ho gaye" — they were never gone, the dock was sitting
          on top of them. */}
      <div
        className="ig-reel-caption absolute left-3 right-20 z-30"
        style={{ bottom: "calc(20px + 64px + env(safe-area-inset-bottom, 0px))" }}
      >
        <div className="flex items-center gap-2 mb-2 flex-wrap">
          {h._userPost && (
            <span
              className="ig-pill"
              style={{
                /* v88 — cozy champagne+cocoa instead of magenta/purple */
                background: "linear-gradient(135deg, rgba(217,190,130,0.30), rgba(110,84,48,0.25))",
                border: "1px solid rgba(217,190,130,0.55)",
                color: "var(--cozy-cream-50)",
              }}
            >
              ✨ YOUR {String(h._userPostKind || "POST").toUpperCase()}
            </span>
          )}
          {h.starRating > 0 && <span className="ig-pill ig-pill-gold">{"★".repeat(Math.min(h.starRating, 5))}</span>}
          {h.avgRating > 0 && <span className="ig-pill">★ {Number(h.avgRating).toFixed(1)}</span>}
          {!h._userPost && <span className="ig-pill ig-pill-live"><span className="ig-dot" /> LIVE BIDDING</span>}
          <span className="ig-pill">{fmtCount(viewCount)} views</span>

          {/* v128.6 — Score badge lives INSIDE the pills row so it
              shares flex-wrap with the other chips. Saves vertical
              space on the desktop reel-frame where every row matters. */}
          {!h._userPost && h.id ? (
            <span className="ig-score-chip" onClick={(e) => e.stopPropagation()}>
              <HotelScoreBadge
                hotelId={String(h.id)}
                hotelName={h.name}
                variant="compact"
              />
            </span>
          ) : null}
          {h._userPostTaggedHotel?.id ? (
            <span className="ig-score-chip" onClick={(e) => e.stopPropagation()}>
              <HotelScoreBadge
                hotelId={String(h._userPostTaggedHotel.id)}
                hotelName={h._userPostTaggedHotel.name}
                variant="compact"
              />
            </span>
          ) : null}
        </div>

        {/* v416 — editorial serif hotel name (Cormorant, loaded in globals.css)
            brings the Flash Deals design language to the home reel card. */}
        <h3 className="text-white leading-tight mb-1" style={{ fontFamily: "var(--font-display, 'Cormorant Garamond'), Georgia, serif", fontSize: "1.34rem", fontWeight: 600, letterSpacing: "0.005em", textShadow: "0 2px 8px rgba(0,0,0,0.85)" }}>
          {h.name}
        </h3>

        <p
          className="text-white/90 text-[0.78rem] leading-snug mb-1.5"
          style={{
            textShadow: "0 1px 3px rgba(0,0,0,0.75)",
            display: "-webkit-box",
            WebkitLineClamp: showCaption ? 99 : 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
          onClick={(e) => { e.stopPropagation(); setShowCaption((s) => !s); }}
        >
          {description}{" "}
          {tags.map((t) => (
            <Link key={t} href={`/tag/${encodeURIComponent(t.toLowerCase())}`} className="text-gold-300 font-semibold mr-1" onClick={(e) => e.stopPropagation()}>
              #{t}
            </Link>
          ))}
        </p>

        {!showCaption && (description.length > 100 || tags.length > 0) && (
          <button onClick={(e) => { e.stopPropagation(); setShowCaption(true); }} className="text-white/55 text-[0.7rem] mb-1.5">
            ... more
          </button>
        )}

        {/* v89 — Visible audio strip REMOVED per user feedback ("iska kya
            kaam hai, hata do — sirf yahan se na ki function hi remove").
            The audio picker IS still functional: any hotel/admin can still
            open it via the right-rail More menu (Volume booster section).
            The default <audio> playback is unaffected — only the bottom
            caption text + tap-to-change chip is gone, decluttering the
            content row. */}

        {/* Tagged-hotel pill — user posts that have tagged a real hotel
            surface a clickable "🏨 At {Hotel}" link. Tapping it routes
            to /hotels/[id] so any viewer can explore + book directly.
            Shown on BOTH your own and other users' public posts. */}
        {h._userPostTaggedHotel?.id && (
          <Link
            href={`/hotels/${h._userPostTaggedHotel.id}`}
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-full mb-2"
            style={{
              background: "linear-gradient(135deg, rgba(240,180,41,0.22), rgba(201,166,107,0.13))",
              border: "1px solid rgba(240,180,41,0.55)",
              backdropFilter: "blur(8px)",
              WebkitBackdropFilter: "blur(8px)",
            }}
          >
            <span
              className="w-5 h-5 rounded-md overflow-hidden flex items-center justify-center text-[0.66rem]"
              style={{ background: "linear-gradient(135deg,#2A2013,#1A130A)" }}
            >
              {h._userPostTaggedHotel.image ? (
                <img src={h._userPostTaggedHotel.image} alt="" decoding="async" loading="lazy" className="w-full h-full object-cover" />
              ) : (
                "🏨"
              )}
            </span>
            <span className="text-white text-[0.7rem] font-semibold truncate max-w-[180px]">
              At {h._userPostTaggedHotel.name}
            </span>
            <span className="text-gold-300 text-[0.66rem] font-bold">Explore ›</span>
          </Link>
        )}

        {/* Price + EQUAL 3D translucent CTAs.
            For user-uploaded posts WITHOUT a tagged hotel, there's nothing
            to book — replace the row with a status badge (and a Delete
            button via the More menu).
            User posts WITH a tagged hotel get Book/Bid that route to
            that hotel. */}
        {h._isSelf && !h._userPostTaggedHotel?.id ? (() => {
          // Status badge ONLY on YOUR uploads — tells you whether the
          // public Supabase upload finished (other devices can see it)
          // or is still pending. Other users' public posts don't need
          // this badge — for them the post is already public and the
          // Book/Bid row is more useful.
          const url0 = h.videoUrl || h.images?.[0] || "";
          const isPublic = typeof url0 === "string" && url0.startsWith("http");
          return (
            <div className="mt-3 flex items-center gap-2 flex-wrap">
              <span className="text-white/85 text-[0.7rem] flex items-center gap-1.5">
                <span style={{
                  width: 8, height: 8, borderRadius: 9999,
                  background: isPublic ? "#2ecc71" : "#f59e0b",
                  boxShadow: isPublic
                    ? "0 0 8px rgba(46,204,113,0.7)"
                    : "0 0 8px rgba(245,158,11,0.7)",
                  animation: isPublic ? undefined : "pulseGlow 1.6s ease-in-out infinite",
                }} />
                {isPublic
                  ? "Live in the Reels feed · everyone can see this"
                  : "Uploading to the public feed… visible everywhere once done"}
              </span>
            </div>
          );
        })() : (!h._userPost || h._userPostTaggedHotel?.id) ? (
          <div className="mt-3 flex items-end gap-2">
            <div className="flex flex-col leading-none mr-1 shrink-0">
              <span className="text-white/55 text-[0.55rem] uppercase tracking-widest">From</span>
              <span className="text-white font-bold text-[1.2rem] tabular-nums">
                {(() => {
                  // v398 — show the real "starting from" (flash deal / cheapest
                  // room) price on EVERY reel, tagged or not. The discover feed
                  // hydrates a tagged reel's hotel with its starting price, so
                  // prefer the number whenever we have one; fall back to
                  // "View rates ›" only when no price is known at all.
                  const startPrice = h.minPrice || h.rooms?.[0]?.floorPrice || 0;
                  return startPrice > 0 ? (
                    <>
                      ₹{startPrice.toLocaleString()}
                      <span className="text-white/55 text-[0.7rem] font-normal ml-1">/n</span>
                    </>
                  ) : (
                    <span className="text-[0.92rem]">View rates ›</span>
                  );
                })()}
              </span>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (h._userPostTaggedHotel?.id) {
                  router.push(`/hotels/${h._userPostTaggedHotel.id}?intent=book${buildAttrSuffix(h)}#availability-picker`);
                  onTrackEvent?.("ig_tagged_hotel_book", { hotelId: h._userPostTaggedHotel.id });
                } else {
                  onBook(h);
                }
              }}
              className="ig-cta-3d ig-cta-book"
            >
              <span className="ig-cta-icon">⚡</span>
              <span className="ig-cta-text">Book Now</span>
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (h._userPostTaggedHotel?.id) {
                  router.push(`/hotels/${h._userPostTaggedHotel.id}?intent=negotiate${buildAttrSuffix(h)}#availability-picker`);
                  onTrackEvent?.("ig_tagged_hotel_bid", { hotelId: h._userPostTaggedHotel.id });
                } else {
                  onNegotiate(h);
                }
              }}
              className="ig-cta-3d ig-cta-bid"
            >
              <span className="ig-cta-icon">🏷️</span>
              <span className="ig-cta-text">Bid Now</span>
            </button>
          </div>
        ) : null}
      </div>

      {/* Custom soundtrack audio element — ALWAYS MOUNTED.
          Earlier we mounted this conditionally on `customAudio &&`. That
          looked correct but broke iOS Safari + some Android Chrome:
          the user gesture (tap "Use") propagates through React's commit
          BEFORE the element exists, so by the time the audio element
          mounts and we call play(), the gesture-allow window is gone.
          Solution: keep a permanent <audio> element on the card. When
          customAudio is null, src="" → no playback. When user picks a
          track, src updates → autoPlay + onCanPlay both fire. The
          gesture-allow chain stays intact because the element existed
          BEFORE the user's interaction. */}
      <audio
        ref={audioElRef}
        src={customAudio?.url || ""}
        loop
        preload="auto"
        autoPlay={!!customAudio}
        onLoadedData={() => {
          const a = audioElRef.current;
          if (!a || !customAudio) return;
          if (active && !paused) {
            try {
              a.muted = false;
              a.volume = 1;
              const p = a.play();
              if (p && typeof p.then === "function") p.catch(() => {});
            } catch {}
          }
        }}
        onCanPlay={() => {
          const a = audioElRef.current;
          if (!a || !customAudio) return;
          if (active && !paused) {
            try {
              a.muted = false;
              a.volume = 1;
              const p = a.play();
              if (p && typeof p.then === "function") p.catch(() => {});
            } catch {}
          }
        }}
        onError={(e) => {
          // Some files (uncommon WAV sample rates, weird MP3 tags) won't
          // decode in this browser. Surface a clear message so the user
          // knows to try a different file rather than think the feature
          // is broken.
          const a = e.currentTarget as HTMLAudioElement;
          const code = a?.error?.code;
          if (customAudio) {
            const reason =
              code === 4 ? "Browser can't decode this audio format. Try MP3 or M4A." :
              code === 3 ? "Audio file may be corrupt. Re-export and retry." :
              code === 2 ? "Couldn't fetch the audio. Check your connection." :
              "Audio failed to play.";
            onTrackEvent?.("ig_audio_error", { hotelId: h.id, code, reason });
            // Fall back: clear the custom audio so the video resumes its
            // own track instead of leaving the user with silence.
            setCustomAudio(null);
          }
        }}
      />

      {/* Per-card audio picker (replaces the soundtrack on this single reel) */}
      <AudioPicker
        open={audioPickerOpen}
        onClose={() => setAudioPickerOpen(false)}
        current={customAudio}
        onPick={(t) => {
          // Picking a track is an explicit "I want sound" gesture.
          // The audio element is ALWAYS mounted now, so we can poke its
          // src directly INSIDE the user-gesture tick — that's what gets
          // iOS Safari / Android Chrome to honour the playback. State
          // catches up after re-render.
          setCustomAudio(t);
          if (muted) onMuteToggle();
          const a = audioElRef.current;
          if (a) {
            try {
              if (t) {
                a.src = t.url;
                a.muted = false;
                a.volume = 1;
                a.load();
                const p = a.play();
                if (p && typeof p.then === "function") p.catch(() => {});
              } else {
                a.pause();
                a.removeAttribute("src");
                a.load();
              }
            } catch {}
          }
        }}
        allowOriginal
      />

      {/* Avatar popover — Instagram-style options menu when user taps the
          profile photo. Two actions: View Profile (opens profile sheet)
          and Watch Reels (filters main feed to this entity's reels). */}
      {avatarMenu && (
        <>
          <div
            className="absolute inset-0 z-40"
            style={{ background: "rgba(0,0,0,0.35)", backdropFilter: "blur(2px)" }}
            onClick={(e) => { e.stopPropagation(); setAvatarMenu(null); }}
          />
          <div
            className="absolute z-50 ig-avatar-menu"
            style={{ top: "118px", left: "12px" }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => {
                onOpenEntity(avatarMenu.kind === "hotel" ? hotelEntity : creator);
                setAvatarMenu(null);
              }}
              className="ig-avatar-menu-btn"
            >
              <span className="text-base">👤</span>
              <span>View Profile</span>
            </button>
            <button
              onClick={() => {
                onWatchEntity(avatarMenu.kind === "hotel" ? hotelEntity : creator);
                setAvatarMenu(null);
              }}
              className="ig-avatar-menu-btn"
            >
              <span className="text-base">📺</span>
              <span>Watch Reels</span>
            </button>
            <button
              onClick={() => setAvatarMenu(null)}
              className="ig-avatar-menu-btn ig-avatar-menu-cancel"
            >
              <span>Cancel</span>
            </button>
          </div>
        </>
      )}

      {/* Floating like-burst hearts */}
      {hearts.map((b) => (
        <span
          key={b.id}
          className="ig-heart pointer-events-none"
          style={{
            left: b.x, top: b.y,
            fontSize: b.size,
            ["--dx" as any]: `${b.dx}px`,
            ["--rot" as any]: `${b.rot}deg`,
            ["--dur" as any]: `${b.dur}ms`,
          }}
        >
          {b.emoji}
        </span>
      ))}
    </section>
  );
});

// ─────────────────────────────────────────────────────────────────────────
// Story Viewer — Instagram-style fullscreen with progress bars at the top.
// Each image story plays for 5 s; videos play to natural duration. Tap left
// = previous, tap right = next, tap & hold = pause. Closes on the last
// story's end OR on ✕ tap. Stories that have already expired (storyExpiresAt
// in the past) are filtered out by the caller.
// ─────────────────────────────────────────────────────────────────────────
function StoryViewer({
  open, stories, ownerName, ownerAvatar, onClose,
}: {
  open: boolean;
  stories: any[];                       // UserPost[] with kind === "story"
  ownerName: string;
  ownerAvatar: string;
  onClose: () => void;
}) {
  const [idx, setIdx] = useState(0);
  const [progress, setProgress] = useState(0);   // 0–100 of current story
  const [paused, setPaused] = useState(false);
  const startedAt = useRef<number>(0);
  const accumulated = useRef<number>(0);
  const rafRef = useRef<number | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const story = stories[idx];
  const isVideo = story && (story.kind === "story") && (story.mediaMime || "").startsWith("video/");
  const STORY_MS = 5000; // image duration

  useEffect(() => {
    if (!open) return;
    setIdx(0);
    setProgress(0);
    accumulated.current = 0;
    startedAt.current = performance.now();
    setPaused(false);
  }, [open, stories.length]);

  // Auto-advance for image stories. Video stories rely on onEnded.
  useEffect(() => {
    if (!open || !story) return;
    if (isVideo) return;
    if (paused) return;
    startedAt.current = performance.now();
    const tick = () => {
      const elapsed = accumulated.current + (performance.now() - startedAt.current);
      const p = Math.min(100, (elapsed / STORY_MS) * 100);
      setProgress(p);
      if (p >= 100) {
        if (idx < stories.length - 1) {
          setIdx(idx + 1);
          accumulated.current = 0;
          setProgress(0);
        } else {
          onClose();
        }
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [open, idx, isVideo, paused, story, stories.length, onClose]);

  // Pause / resume bookkeeping
  const pause = () => {
    if (paused) return;
    accumulated.current = accumulated.current + (performance.now() - startedAt.current);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (videoRef.current) { try { videoRef.current.pause(); } catch {} }
    setPaused(true);
  };
  const resume = () => {
    if (!paused) return;
    startedAt.current = performance.now();
    if (videoRef.current) { try { videoRef.current.play(); } catch {} }
    setPaused(false);
  };

  if (!open || stories.length === 0 || !story) return null;
  const goPrev = () => {
    if (idx > 0) {
      setIdx(idx - 1);
      accumulated.current = 0;
      setProgress(0);
    }
  };
  const goNext = () => {
    if (idx < stories.length - 1) {
      setIdx(idx + 1);
      accumulated.current = 0;
      setProgress(0);
    } else {
      onClose();
    }
  };

  const captionRaw = String(story.caption || "");
  const captionClean = sanitizeComment(captionRaw).clean;

  return (
    <div className="fixed inset-0 z-96 bg-black flex items-center justify-center" onClick={onClose}>
      <div
        className="relative w-full h-full max-w-md mx-auto overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Progress bars at top */}
        <div className="absolute top-2 left-3 right-3 z-30 flex gap-1">
          {stories.map((_, i) => (
            <div key={i} className="flex-1 h-[2.5px] rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.30)" }}>
              <div
                style={{
                  height: "100%",
                  width: i < idx ? "100%" : i === idx ? `${progress}%` : "0%",
                  background: "#fff",
                  transition: i === idx && !paused ? "width 0.05s linear" : "none",
                }}
              />
            </div>
          ))}
        </div>

        {/* Header: avatar + name + ✕ */}
        <div className="absolute top-7 left-3 right-3 z-30 flex items-center gap-2.5">
          <span
            className="w-9 h-9 rounded-full overflow-hidden flex items-center justify-center text-[0.86rem] font-bold shrink-0"
            style={{
              background: ownerAvatar ? "transparent" : "linear-gradient(135deg,#ff458d,#b964ff)",
              border: "1.5px solid rgba(255,255,255,0.55)",
            }}
          >
            {ownerAvatar ? <img src={ownerAvatar} alt="" decoding="async" loading="lazy" className="w-full h-full object-cover" /> : (ownerName || "Y").slice(0, 1).toUpperCase()}
          </span>
          <span className="flex-1 min-w-0">
            <span className="block text-white text-[0.84rem] font-semibold truncate">
              {ownerName && ownerName !== "You" ? ownerName : "Your story"}
            </span>
            <span className="block text-white/65 text-[0.62rem]">
              {(() => {
                const ageMs = Date.now() - (story.createdAt || Date.now());
                const ageH = Math.floor(ageMs / 3_600_000);
                if (ageH >= 1) return `${ageH}h ago`;
                const ageM = Math.max(0, Math.floor(ageMs / 60_000));
                return `${ageM}m ago`;
              })()}
            </span>
          </span>
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-full flex items-center justify-center"
            style={{
              background: "rgba(255,255,255,0.10)",
              border: "1px solid rgba(255,255,255,0.22)",
              color: "#fff",
              fontSize: "1.1rem",
            }}
            aria-label="Close story"
          >✕</button>
        </div>

        {/* Media */}
        <div className="absolute inset-0">
          {isVideo ? (
            <video
              ref={videoRef}
              src={story.mediaUrl || ""}
              className="w-full h-full object-contain bg-black"
              autoPlay
              playsInline
              muted={false}
              onEnded={goNext}
              onError={goNext}
            />
          ) : (
            <img
              src={story.posterUrl || story.mediaUrl || ""}
              alt=""
              className="w-full h-full object-contain bg-black"
            />
          )}
        </div>

        {/* Caption (sanitized) */}
        {captionClean && (
          <div
            className="absolute left-4 right-4 z-30 text-center"
            style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 24px)" }}
          >
            <p
              className="text-white text-[0.86rem] leading-snug font-medium px-3 py-2 inline-block rounded-2xl"
              style={{
                background: "rgba(0,0,0,0.45)",
                border: "1px solid rgba(255,255,255,0.18)",
                backdropFilter: "blur(6px)",
                WebkitBackdropFilter: "blur(6px)",
                textShadow: "0 1px 3px rgba(0,0,0,0.7)",
              }}
            >
              {captionClean}
            </p>
          </div>
        )}

        {/* Tap zones: left = prev, right = next, hold = pause */}
        <button
          type="button"
          aria-label="Previous story"
          className="absolute top-0 bottom-0 left-0 z-20"
          style={{ width: "30%" }}
          onPointerDown={pause}
          onPointerUp={() => { resume(); goPrev(); }}
          onPointerLeave={resume}
        />
        <button
          type="button"
          aria-label="Next story"
          className="absolute top-0 bottom-0 right-0 z-20"
          style={{ width: "30%" }}
          onPointerDown={pause}
          onPointerUp={() => { resume(); goNext(); }}
          onPointerLeave={resume}
        />
        <button
          type="button"
          aria-label="Pause story"
          className="absolute top-0 bottom-0 left-[30%] right-[30%] z-10"
          onPointerDown={pause}
          onPointerUp={resume}
          onPointerLeave={resume}
        />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Feed
// ─────────────────────────────────────────────────────────────────────────
export default function InstagramHotelFeed({ items: propItems, onIndexChange, onLoadMore, onTrackEvent, showFlashDealRail = true, startId = null }: Props) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  // v132.9 — Keyboard shortcuts help overlay (desktop only). Toggled
  // by the `?` key or the `?` chip in the corner of the reel feed.
  const [helpOpen, setHelpOpen] = useState(false);

  // ─── Phase 4 tier-system Create-flow gate ─────────────────────────
  // Reads /api/me/tier to decide whether a + FAB tap opens the upgrade-
  // choice sheet (PUBLIC user with no eligibility) or the default
  // CreateSheet. Tier snapshot is fetched lazily — first FAB tap pays
  // the cost. Once we have a snapshot, it's reused for the session.
  const [tierSnapshot, setTierSnapshot] = useState<MyTierResponse | null>(null);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [tierContext, setTierContext] = useState<ComposerTierContext | undefined>(undefined);
  // Controlled-composer mode: when the user picks a tier path inside
  // UpgradeChoiceSheet, we set this to "reel" (or kind from picker) so
  // the Composer opens directly, skipping the CreateSheet chooser. We
  // pass open + kind down via the new controlled props on <CreateFlow>.
  const [pickedComposerOpen, setPickedComposerOpen] = useState(false);

  // ── Saved-set hydration ─────────────────────────────────────────────
  // Fetch the user's existing saves once on mount so the bookmark icon on
  // each reel reflects PRIOR state (was always defaulting to "not saved",
  // making the save flow feel like nothing persisted). Stored as a Set
  // of `${type}:${id}` strings for O(1) lookup. Passed to HotelCard via
  // prop.
  const [savedSet, setSavedSet] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    if (typeof window === "undefined") return;
    // Hydrate from LOCAL first — bulletproof, works even if user is anon
    // or the backend is asleep.
    const localKeys = new Set<string>();
    try {
      const raw = localStorage.getItem("sb_local_saves");
      const arr: any[] = raw ? JSON.parse(raw) : [];
      arr.forEach((s) => {
        if (s.target_type && s.target_id) localKeys.add(`${s.target_type}:${s.target_id}`);
      });
    } catch {}
    setSavedSet(new Set(localKeys));
    // Then merge with backend (logged-in users only). v107 — defer to the
    // idle window so it never competes with the first-card paint on cold
    // start. The local-first set above already gave the user a correct
    // bookmark state instantly; this is just the refresh.
    const tok = localStorage.getItem("sb_token") || "";
    if (!tok) return;
    const w: any = window;
    const runRefresh = () => {
      fetch("/api/discover/saves/enriched", {
        headers: { Authorization: `Bearer ${tok}` },
        cache: "no-store",
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (!d?.saves) return;
          const next = new Set<string>(localKeys);
          d.saves.forEach((s: any) => {
            if (s.target_type && s.target_id) next.add(`${s.target_type}:${s.target_id}`);
          });
          setSavedSet(next);
        })
        .catch(() => {});
    };
    if (typeof w.requestIdleCallback === "function") w.requestIdleCallback(runRefresh, { timeout: 2500 });
    else setTimeout(runRefresh, 600);
  }, []);

  // ── User-uploaded posts injected at the top of the feed ─────────────────
  // Pulled live from PostsStore so a brand-new upload appears immediately.
  // Photos & stories don't have a video track — we surface them as cards
  // whose hotel.images[] is the uploaded image; the existing Ken-Burns
  // fallback inside HotelCard handles them when videoBroken triggers.
  const { posts: rawUserPosts, removePost, addPost } = usePosts();
  const { myDisplayName: ownerName, myAvatarUrl: ownerAvatar } = useFollow();
  const [editPostId, setEditPostId] = useState<string | null>(null);

  // ── Story expiry sweep ──
  // Stories live for 24h unless `keepAsPost` is on. We filter them out
  // here on every render so the feed + story rail always reflect the
  // current state without needing a background timer.
  const now = Date.now();
  const userPosts = rawUserPosts.filter((p: any) => {
    if (p.kind !== "story") return true;
    if (p.keepAsPost) return true;          // saved as post → keep forever
    if (!p.storyExpiresAt) return true;     // no expiry set → grandfathered
    return p.storyExpiresAt > now;
  });

  // Active stories — used to render the story ring around the user's avatar
  // and feed the StoryViewer on tap.
  const activeStories = userPosts.filter((p: any) => p.kind === "story");
  const [storyOpen, setStoryOpen] = useState(false);
  const [flashStoryIdx, setFlashStoryIdx] = useState<number | null>(null);

  // v91 — Stable per-session seed so the merge order is consistent within
  // one app session (no jitter mid-scroll) but different between sessions.
  // Using a ref-like effect-once would re-shuffle on every render — bad.
  const sessionSeed = useMemo(() => Math.random(), []);

  // v397 — Guarantee EVERY reel connects to a bookable hotel + shows Book Now /
  // Make Offer. Any user/community post that tagged NO hotel (legacy/edge, and
  // now the owner's own untagged uploads too) gets a fallback real hotel from
  // the feed's hotel pool (city-matched when possible, else a stable pick).
  // This includes self-uploads — the owner sees the CTAs on their own reels
  // exactly like every viewer does. Pure: only fallback items are cloned.
  const fillReelFallbackHotels = (list: Item[]): Item[] => {
    const pool = list.filter((it) => {
      const h = it.hotel as any;
      return h && !h._userPost && h.id && !String(h.id).startsWith("post-");
    });
    if (!pool.length) return list;
    const hash = (s: string) => { let x = 0; for (let i = 0; i < s.length; i++) x = (x * 31 + s.charCodeAt(i)) | 0; return Math.abs(x); };
    return list.map((it) => {
      const h = it.hotel as any;
      if (h?._userPost && !h._userPostTaggedHotel?.id) {
        const city = String(h.city || "").toLowerCase();
        const match = city ? pool.find((p) => String((p.hotel as any).city || "").toLowerCase() === city) : null;
        const pick = (match || pool[hash(String(h.id || "")) % pool.length]).hotel as any;
        // v398 — also carry the picked hotel's starting price + rooms so the
        // reel card shows "From ₹X /n" instead of "View rates ›".
        const pickMin = pick.minPrice ?? (pick.rooms?.length ? Math.min(...pick.rooms.map((r: any) => r.floorPrice || 99999)) : null);
        return { ...it, hotel: { ...h, _userPostTaggedHotel: { id: pick.id, name: pick.name, city: pick.city }, _taggedHotelId: pick.id, _fallbackTag: true, minPrice: (pickMin && pickMin !== 99999) ? pickMin : h.minPrice, rooms: (h.rooms?.length ? h.rooms : (pick.rooms || [])) } };
      }
      return it;
    });
  };

  const items: Item[] = (() => {
    // Stories that are NOT also saved-as-post should NOT appear in the
    // main feed — they live on the story ring and the StoryViewer only.
    const visibleInFeed = userPosts.filter((p: any) => {
      if (p.kind !== "story") return true;
      return !!p.keepAsPost;
    });
    const userItems: Item[] = visibleInFeed.map((p) => {
      const isVideo = p.kind === "reel" || (p.mediaMime || "").startsWith("video/");
      return {
        hotel: {
          id: p.id,                           // post-* id
          name: ownerName && ownerName !== "You" ? ownerName : "Your post",
          // If the user attached a location, surface it as `city` so the
          // existing top-chip + filter-by-city logic Just Works™ for
          // user posts. Falls back to "You" when no location was picked.
          city: (p.location?.name?.split(",")[0] || "You").trim(),
          state: "",
          starRating: 0,
          avgRating: 0,
          rooms: [],
          flashDeals: [],
          minPrice: null,
          amenities: [],
          description: p.caption || "",
          // For reels: feed video plays the user's clip (videoForHotel honours
          // h.videoUrl when present). For photos/stories: no videoUrl, so
          // the <video> errors out and the image fallback shows.
          videoUrl: isVideo ? p.mediaUrl : undefined,
          // For VIDEO posts: the captured poster (first-frame JPEG data-URL)
          // populates images[] so the <video poster=…> attribute and the
          // image fallback both render the real preview instead of a
          // black square. Photos use the photo itself.
          images: isVideo
            ? (p.posterUrl ? [p.posterUrl] : [])
            : [p.mediaUrl],
          posterUrl: p.posterUrl || "",
          // Mark so the card can show a "Your post" pill and skip nav links
          // that would point to a non-existent /hotels/<post-id>.
          _userPost: true,
          // ALL posts in PostsStore belong to the current user — flagging
          // them as `_isSelf` makes the card swap the Follow button for a
          // "✦ You" badge (you can't follow yourself) and the profile
          // sheet show "✦ This is your profile" instead.
          _isSelf: true,
          _userPostKind: p.kind,
          _userPostAudio: p.audio,
          _userPostTags: p.tags,
          // MIME type forwarded so the video element can hint codec via
          // <source type=…> and the fallback can tell the user *why*
          // their format failed (HEVC / MOV are the usual culprits).
          _userPostMime: p.mediaMime || "",
          _userPostLocation: p.location || null,
          // Tagged hotel — viewers tap "Explore hotel" / Book / Bid on
          // user posts to land straight on the hotel's page.
          _userPostTaggedHotel: p.taggedHotel || null,
          // v160 — same id, flattened for MoreMenu "Open hotel page".
          _taggedHotelId: p.taggedHotel?.id || null,
          // Highlight bucket — surfaced on the profile-sheet highlight
          // grid so the user can browse their own reels by theme.
          _userPostHighlight: (p as any).highlight || null,
          // v114 — Chosen IG-style filter (e.g. "warm", "noir"). Applied
          // as CSS filter on the active card so viewers see the exact
          // look the creator picked in the composer.
          _userPostFilter: (p as any).filter || null,
        },
        score: 999,
        reasons: ["Your upload"],
      } as Item;
    });

    // v91 — Two-part fix:
    //   1) DEDUPE: when the Composer posts publicly, the same content
    //      lands in BOTH PostsStore (local-first) and Supabase
    //      social_posts (returned in propItems with _isSelf=true). Strip
    //      _isSelf items from propItems whose content fingerprint matches
    //      any local user post, so the user never sees their own reel
    //      twice.
    //   2) SHUFFLE: rather than always prepending userItems (which made
    //      the most-recent upload always the FIRST card on app open),
    //      interleave them into propItems at deterministic-per-session
    //      positions. Same session → same order; next session → fresh
    //      mix because sessionSeed is re-rolled on remount.
    //
    // v131.8 — primary dedup is now exact-match on `client_post_id` /
    // local post id (both share the same `post-<ts>-<rand>` token).
    // Caption fingerprint kept as a fallback for legacy posts that
    // pre-date the clientPostId era.
    //
    // ⚠️ LOAD-BEARING. If you remove the localIds Set or the cpid
    // exact-match check below, duplicate reels reappear on home /
    // /discover / /reels (the same upload renders twice — once from
    // PostsStore, once from /api/social/feed). The exact match is
    // bulletproof against any caption/tag display drift.
    const localIds = new Set(userItems.map((u) => String((u.hotel as any).id || "")));
    const fpUser = new Set(
      userItems.map((u) =>
        `${(u.hotel as any)._userPostKind}|${String(u.hotel.description).slice(0, 60)}`
      )
    );
    const dedupedProp = propItems.filter((p) => {
      if (!(p.hotel as any)?._isSelf) return true;
      // Primary: exact match on client_post_id forwarded from the server
      const cpid = String((p.hotel as any)?._clientPostId || "");
      if (cpid && localIds.has(cpid)) return false;
      // Fallback: caption fingerprint (handles legacy posts without clientPostId)
      const fp = `${(p.hotel as any)?._userPostKind || "reel"}|${String(p.hotel.description).slice(0, 60)}`;
      return !fpUser.has(fp);
    });

    if (userItems.length === 0) return fillReelFallbackHotels(dedupedProp);
    if (dedupedProp.length === 0) return fillReelFallbackHotels(userItems);

    // Interleave: place each userItem at a deterministic offset based on
    // sessionSeed so order is stable within a session but different
    // across sessions. Multiple userItems get spread across the propItems
    // rather than clumping at the top.
    const result: Item[] = [...dedupedProp];
    userItems.forEach((u, i) => {
      // Spread positions across the prop list, biased away from index 0
      // so the user's own reel never auto-opens first.
      const offset = Math.floor((sessionSeed * 997 + i * 313) % result.length);
      const insertAt = Math.max(1, Math.min(result.length, offset));
      result.splice(insertAt, 0, u);
    });
    return fillReelFallbackHotels(result);
  })();
  // ── GLOBAL mute / gain state — same source for every reel + the rail button.
  const { isMuted, hasInteracted, toggleMute, gain, setGain } = useSoundStore();
  const muted = isMuted;
  const cycleGain = useCallback(() => {
    const steps = [1.0, 1.5, 1.8, 2.2, 2.6, 3.0];
    const i = steps.findIndex((s) => Math.abs(s - gain) < 0.05);
    setGain(steps[(i + 1) % steps.length] ?? 1.8);
  }, [gain, setGain]);
  const [commentsOpen, setCommentsOpen] = useState<{ open: boolean; name: string; id: string }>({ open: false, name: "", id: "" });
  const [moreOpen, setMoreOpen] = useState<{ open: boolean; id: string }>({ open: false, id: "" });
  // v400 — resolved "starting from" price (cheapest room floor) per TAGGED
  // hotel id. A tagged reel item only carries {id,name,city} for its hotel (no
  // price) — this is especially true for self-uploaded reels rendered from the
  // local PostsStore, which never pass through the discover feed's price map.
  // We fetch the missing prices once from /api/hotels/starting-prices and
  // hydrate each card so it shows "From ₹X /n" instead of "View rates ›".
  const [taggedPrices, setTaggedPrices] = useState<Record<string, number>>({});
  // v402 — "Not interested" suppressions (seeded from persisted feed signals).
  // A suppressed reel is filtered out of the feed immediately + on every future
  // load; the id also rides along in getSignals() to the discover ranker.
  const [notInterested, setNotInterested] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    setNotInterested(new Set(getNotInterested()));
    const on = (e: any) => setNotInterested((prev) => {
      if (!e?.detail?.id) return prev;
      const n = new Set(prev); n.add(String(e.detail.id)); return n;
    });
    if (typeof window !== "undefined") {
      window.addEventListener("sb:not-interested", on);
      return () => window.removeEventListener("sb:not-interested", on);
    }
  }, []);
  const [creatorOpen, setCreatorOpen] = useState<Creator | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // ── Filter state (source: hotel/creator/public/all + city + entity-handle + highlight) ──
  const [filterSource, setFilterSource] = useState<SourceType>("all");
  const [filterCity, setFilterCity]     = useState<string>("all");
  const [filterOpen, setFilterOpen]     = useState(false);
  // entity handle filter — set by "Watch Reels" from a profile/avatar menu.
  const [filterEntity, setFilterEntity] = useState<string | null>(null);
  // active highlight filter (Mountains, Beaches, etc.) from the profile sheet.
  const [filterHighlight, setFilterHighlight] = useState<Highlight | null>(null);
  // Hydrate from localStorage + default city to user's chosen nav city
  useEffect(() => {
    try {
      const fs = localStorage.getItem("sb_reel_filter_source") as SourceType | null;
      if (fs && ["all", "hotel", "creator", "public"].includes(fs)) setFilterSource(fs);
      const fc = localStorage.getItem("sb_reel_filter_city");
      if (fc) setFilterCity(fc);
      else {
        const navCity = localStorage.getItem("sb_city");
        if (navCity) setFilterCity(navCity);
      }
    } catch {}
    // The premium globe picker (Navbar.tsx) writes `sb_city` and fires
    // `sb:city-change`. Mirror that into the reel filter so the feed
    // re-filters live without a remount.
    const apply = () => {
      try {
        const navCity = localStorage.getItem("sb_city") || "";
        setFilterCity(navCity || "all");
        localStorage.setItem("sb_reel_filter_city", navCity || "all");
      } catch {}
    };
    window.addEventListener("sb:city-change", apply);
    return () => window.removeEventListener("sb:city-change", apply);
  }, []);
  const persistFilter = useCallback((src: SourceType, c: string) => {
    setFilterSource(src);
    setFilterCity(c);
    try {
      localStorage.setItem("sb_reel_filter_source", src);
      localStorage.setItem("sb_reel_filter_city", c);
      // ALSO write the system-wide `sb_city` key + fire `sb:city-change` so
      // every other surface (/hotels, /flash-deals, /me, flash-deal rail
      // hook) re-pulls with the new location. Was missing — the reel
      // filter sheet used to ONLY change the reel feed, leaving the rest
      // of the app on the old city. v81 wires the trigger.
      if (c && c !== "all") localStorage.setItem("sb_city", c);
      else                  localStorage.removeItem("sb_city");
      window.dispatchEvent(new Event("sb:city-change"));
    } catch {}
    onTrackEvent?.("ig_filter_change", { source: src, city: c });
  }, [onTrackEvent]);

  // City list — distinct cities present in the feed (so we never offer a city
  // the user can't actually filter to).
  const cityOptions = (() => {
    const seen = new Set<string>();
    items.forEach((it) => { if (it.hotel?.city) seen.add(String(it.hotel.city)); });
    const list = Array.from(seen).sort();
    return list.length > 0 ? list : FALLBACK_CITIES;
  })();

  // Counts per source — surfaced in the filter sheet
  const sourceCounts: Record<SourceType, number> = (() => {
    const c: Record<SourceType, number> = { all: items.length, hotel: 0, creator: 0, public: 0 };
    items.forEach((it) => { c[sourceFor(it.hotel)]++; });
    return c;
  })();

  // ─── Flash-deal stories rail ──────────────────────────────────────────
  // Daily auto-generated hotel flash deals surfaced as IG-style stories at
  // the top of the reel feed. Tap an avatar → fullscreen viewer with a
  // Book Now CTA that routes into the existing direct-book URL on the
  // hotel detail page. City-aware via the existing `filterCity` state
  // (kept in sync with `sb_city` + `sb:city-change`).
  const { deals: flashDeals } = useFlashDealStories(filterCity);

  // Apply filter — also drop anything the user marked "Not interested" (by the
  // reel id OR its tagged hotel id) so a suppressed reel disappears immediately
  // and never returns (v402).
  let filteredItems = items.filter((it) => {
    const h: any = it.hotel;
    if (notInterested.size && (notInterested.has(String(h?.id)) || (h?._taggedHotelId && notInterested.has(String(h._taggedHotelId))))) return false;
    const okSrc = filterSource === "all" || sourceFor(it.hotel) === filterSource;
    const okCity = filterCity === "all" || (it.hotel?.city && it.hotel.city === filterCity);
    return okSrc && okCity;
  });
  if (filterEntity) {
    filteredItems = filteredItems.filter((it) => {
      return creatorFor(it.hotel).handle === filterEntity || entityFromHotel(it.hotel).handle === filterEntity;
    });
  }
  if (filterHighlight) {
    filteredItems = applyHighlight(filteredItems, filterHighlight);
  }

  // v400 — resolve the "starting from" price for every TAGGED reel that arrived
  // without one. A self-uploaded reel (PostsStore) carries only {id,name,city}
  // for its tagged hotel; a feed post's tagged hotel may also be absent from the
  // discover payload. Collect the missing tagged-hotel ids, fetch their cheapest
  // room floor once, and cache it in `taggedPrices` so the card shows a price.
  const missingPriceIds = (() => {
    const ids = new Set<string>();
    items.forEach((it) => {
      const hh: any = it.hotel;
      const tid = hh?._userPostTaggedHotel?.id;
      if (!tid) return;
      const hasPrice =
        Number(hh?.minPrice) > 0 || Number(hh?.rooms?.[0]?.floorPrice) > 0;
      if (!hasPrice && taggedPrices[String(tid)] === undefined) ids.add(String(tid));
    });
    return Array.from(ids).sort();
  })();
  const missingPriceKey = missingPriceIds.join(",");
  useEffect(() => {
    if (!missingPriceKey) return;
    const wanted = missingPriceKey.split(",").filter(Boolean);
    if (!wanted.length) return;
    let cancelled = false;
    fetch(`/api/hotels/starting-prices?ids=${encodeURIComponent(wanted.join(","))}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || !d?.prices) return;
        // Merge; also stamp a 0 for ids that returned nothing so we never
        // re-fetch a hotel that genuinely has no room price (keeps the honest
        // "View rates ›" fallback without a request loop).
        setTaggedPrices((prev) => {
          const next = { ...prev };
          wanted.forEach((id) => {
            next[id] = Number(d.prices[id]) > 0 ? Number(d.prices[id]) : 0;
          });
          return next;
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [missingPriceKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // When filter CHANGES, reset scroll to top.
  // v572 — skip the mount run. The feed already starts at 0, so on mount this
  // only ever fired a smooth scroll-to-0 animation into empty space — and that
  // animation kept running over the top of the `?start=` deep-link jump below,
  // which is why the deep link silently landed on card 1.
  const filterMounted = useRef(false);
  useEffect(() => {
    if (!filterMounted.current) { filterMounted.current = true; return; }
    const root = containerRef.current;
    if (!root) return;
    root.scrollTo({ top: 0, behavior: "smooth" });
    setActiveIdx(0);
  }, [filterSource, filterCity, filterEntity, filterHighlight]);

  // Scroll to a specific hotel's reel when picked from a profile grid.
  const scrollToHotel = useCallback((hotelId: string) => {
    // Make sure the hotel survives current filters; if not, clear them.
    const visibleNow = filteredItems.findIndex((it) => it.hotel.id === hotelId);
    if (visibleNow < 0) {
      setFilterSource("all"); setFilterCity("all");
      setFilterEntity(null); setFilterHighlight(null);
    }
    // Defer scroll to next tick so the (possibly) new filteredItems renders.
    setTimeout(() => {
      const root = containerRef.current;
      if (!root) return;
      const cards = root.querySelectorAll<HTMLElement>(".ig-card");
      let targetIdx = -1;
      const useItems = visibleNow >= 0 ? filteredItems : items;
      for (let i = 0; i < useItems.length; i++) {
        if (useItems[i].hotel.id === hotelId) { targetIdx = i; break; }
      }
      if (targetIdx >= 0 && cards[targetIdx]) {
        cards[targetIdx].scrollIntoView({ behavior: "smooth", block: "start" });
        setActiveIdx(targetIdx);
      }
    }, 60);
  }, [filteredItems, items]);

  // v572 — one-time "swipe up" teaching hint (rendered near the bottom of this
  // file). A full-bleed video with no visible chrome does not tell a first-time
  // viewer that there is a next one, and the home page's reel rail now sends
  // people straight in here.
  // `landedIdx` is the card the viewer STARTED on: 0 normally, or the deep
  // link's target when they arrived from the home reel rail. Everything below
  // measures movement from there, so the programmatic landing scroll doesn't
  // count as "they already know how to swipe" and eat the hint on the exact
  // journey that needs it most.
  const landedIdx = useRef(0);
  const [swipeHint, setSwipeHint] = useState(false);
  const markSwipeSeen = useCallback(() => {
    setSwipeHint(false);
    try { localStorage.setItem("sb_reel_swipe_hint", "1"); } catch {}
  }, []);
  useEffect(() => {
    try { if (localStorage.getItem("sb_reel_swipe_hint") === "1") return; } catch { return; }
    setSwipeHint(true);
    // Listen on window (capture) rather than on containerRef: scroll does not
    // bubble, but a capture listener on an ancestor still sees it, and this
    // cannot miss the ref not being populated yet. Armed AFTER the deep-link
    // jump has settled, for the same reason as landedIdx.
    const opts = { passive: true } as AddEventListenerOptions;
    let arm: ReturnType<typeof setTimeout> | null = setTimeout(() => {
      arm = null;
      window.addEventListener("touchmove", markSwipeSeen, opts);
      window.addEventListener("wheel", markSwipeSeen, opts);
      window.addEventListener("scroll", markSwipeSeen, { ...opts, capture: true });
    }, 700);
    const t = setTimeout(markSwipeSeen, 8000);
    return () => {
      if (arm) clearTimeout(arm);
      clearTimeout(t);
      window.removeEventListener("touchmove", markSwipeSeen);
      window.removeEventListener("wheel", markSwipeSeen);
      window.removeEventListener("scroll", markSwipeSeen, true);
    };
  }, [markSwipeSeen]);
  // Also retire it the moment they actually move off the card they landed on.
  useEffect(() => {
    if (activeIdx !== landedIdx.current) markSwipeSeen();
  }, [activeIdx, markSwipeSeen]);

  // v572 — `?start=<postId>` deep link. The Stage home's reel rail links here
  // instead of opening a second, feature-poor player of its own, so the reel
  // you tapped is the reel that plays — with like, comment, share, save and
  // follow all present, and Back returning you to the page you came from.
  // For a community post the Item's `hotel.id` IS the post id (see
  // socialPostToItem in app/discover/page.tsx), the same key `onPickReel`
  // already navigates by. Fires ONCE — `jumped` stops the effect yanking the
  // feed out from under someone who has already started scrolling.
  const jumped = useRef(false);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  useEffect(() => {
    if (jumped.current || !startId || !items.length) return;
    if (items.findIndex((it) => String(it.hotel.id) === String(startId)) < 0) return;
    jumped.current = true;
    // Deliberately no cleanup on this timer. `items` is rebuilt on every
    // render, so the effect re-runs constantly — a per-run cleanup cancelled
    // the pending timer before it could fire, and an unmount-only cleanup was
    // cancelled by StrictMode's dev remount. The callback is fully guarded, so
    // a stray timer after unmount does nothing.
    setTimeout(() => {
      const root = containerRef.current;
      if (!root) return;
      // Resolve the index at SCROLL time, not at schedule time: the feed is
      // still streaming in during these first frames and the target's position
      // shifts as items arrive.
      const idx = itemsRef.current.findIndex((it) => String(it.hotel.id) === String(startId));
      const el = idx >= 0 ? root.querySelectorAll<HTMLElement>(".ig-card")[idx] : null;
      if (!el) return;
      // BOTH of the feed's scroll behaviours have to be suspended for a jump.
      // `.ig-feed` sets `scroll-behavior: smooth`, so assigning scrollTop only
      // STARTS an animation (it reads back 0 and lands a second later, where
      // anything else can interrupt it); and the cards set `scroll-snap-stop:
      // always`, which Chrome applies to programmatic scrolls too, holding the
      // scroll at the next snap point. Together they meant a jump of more than
      // a card or two silently never arrived. Suspended, restored immediately.
      const go = () => {
        const snap = root.style.scrollSnapType;
        const beh = root.style.scrollBehavior;
        root.style.scrollSnapType = "none";
        root.style.scrollBehavior = "auto";
        root.scrollTop += el.getBoundingClientRect().top - root.getBoundingClientRect().top;
        root.style.scrollSnapType = snap;
        root.style.scrollBehavior = beh;
      };
      go();
      setActiveIdx(idx);
      landedIdx.current = idx;
      // Card height is 100% of --reel-vh, which useReelFullscreen writes from
      // visualViewport AFTER mount; re-assert once that has landed so the jump
      // isn't computed against a stale height.
      setTimeout(go, 260);
    }, 160);
  }, [startId, items]);

  const handleWatchEntity = useCallback((entity: Creator) => {
    setFilterEntity(entity.handle);
    setFilterHighlight(null);
    setFilterCity("all");
    setFilterSource("all");
    onTrackEvent?.("ig_watch_entity_reels", { handle: entity.handle });
  }, [onTrackEvent]);

  const handleApplyHighlight = useCallback((hl: Highlight) => {
    setFilterHighlight(hl);
    setFilterEntity(null);
    setFilterCity("all");
    setFilterSource("all");
    onTrackEvent?.("ig_apply_highlight", { key: hl.key });
  }, [onTrackEvent]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2200);
  }, []);

  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    const cards = root.querySelectorAll<HTMLElement>(".ig-card");
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting && e.intersectionRatio > 0.6)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible) {
          const idx = Array.from(cards).indexOf(visible.target as HTMLElement);
          if (idx >= 0 && idx !== activeIdx) {
            setActiveIdx(idx);
            onIndexChange?.(idx);
            if (idx >= filteredItems.length - 3) onLoadMore?.();
          }
        }
      },
      { root, threshold: [0.6, 0.85] }
    );
    cards.forEach((c) => io.observe(c));
    return () => io.disconnect();
  }, [filteredItems.length, activeIdx, onIndexChange, onLoadMore]);

  // v132.7 — Desktop keyboard navigation on the reel feed.
  // ArrowDown / j / PageDown   → next reel
  // ArrowUp   / k / PageUp     → previous reel
  // m                          → toggle global mute
  // Home / End                 → first / last reel
  //
  // Mobile (<1024px) skipped entirely — touch users don't need it and
  // some Android keyboards intercept ArrowDown for autosuggest.
  // Also skipped while an input/textarea/select is focused, while any
  // .fixed.inset-0 modal is open (chat drawer, profile sheet, etc.),
  // or when the user is mid-edit on a comment/caption.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Bail on mobile / tablet — keyboard shortcuts are a desktop affordance.
      if (typeof window === "undefined" || !window.matchMedia("(min-width: 1024px)").matches) return;
      // Bail on form-field focus.
      const t = document.activeElement;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || (t as HTMLElement).isContentEditable)) return;
      // Bail when a modal/drawer is on screen — the user is in another flow.
      if (document.querySelector(".fixed.inset-0:not([aria-hidden=\"true\"])")) return;

      const root = containerRef.current;
      if (!root) return;
      const cards = root.querySelectorAll<HTMLElement>(".ig-card");
      const total = cards.length;
      if (total === 0) return;

      const goTo = (idx: number) => {
        const safe = Math.max(0, Math.min(total - 1, idx));
        const target = cards[safe];
        if (target) {
          target.scrollIntoView({ behavior: "smooth", block: "start" });
          setActiveIdx(safe);
          onTrackEvent?.("ig_keyboard_nav", { key: e.key, idx: safe });
        }
      };

      switch (e.key) {
        case "ArrowDown":
        case "PageDown":
        case "j":
          e.preventDefault();
          goTo(activeIdx + 1);
          break;
        case "ArrowUp":
        case "PageUp":
        case "k":
          e.preventDefault();
          goTo(activeIdx - 1);
          break;
        case "Home":
          e.preventDefault();
          goTo(0);
          break;
        case "End":
          e.preventDefault();
          goTo(total - 1);
          break;
        case "m":
        case "M":
          e.preventDefault();
          toggleMute();
          onTrackEvent?.("ig_keyboard_mute", { muted: !isMuted });
          break;
        case "?":
          e.preventDefault();
          setHelpOpen((s) => !s);
          onTrackEvent?.("ig_keyboard_help_open", {});
          break;
        case "Escape":
          if (helpOpen) {
            e.preventDefault();
            setHelpOpen(false);
          }
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeIdx, isMuted, toggleMute, onTrackEvent, helpOpen]);

  const handleBook = useCallback((h: any) => {
    onTrackEvent?.("ig_click_book", { hotelId: h.id });
    router.push(`/hotels/${h.id}?intent=book${buildAttrSuffix(h)}#availability-picker`);
  }, [router, onTrackEvent]);
  const handleNegotiate = useCallback((h: any) => {
    onTrackEvent?.("ig_click_bid", { hotelId: h.id });
    router.push(`/hotels/${h.id}?intent=negotiate${buildAttrSuffix(h)}#availability-picker`);
  }, [router, onTrackEvent]);
  const handleShare = useCallback(async (h: any) => {
    onTrackEvent?.("ig_share", { hotelId: h.id });
    const url = `${window.location.origin}/hotels/${h.id}`;
    const data = { title: h.name, text: `${h.name} on StayBid — from ₹${(h.minPrice || 0).toLocaleString()}/night`, url };
    if (typeof navigator !== "undefined" && (navigator as any).share) {
      try { await (navigator as any).share(data); showToast("Shared ✓"); return; } catch {}
    }
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      try { await navigator.clipboard.writeText(url); showToast("Link copied ✓"); return; } catch {}
    }
    showToast("Sharing not supported");
  }, [onTrackEvent, showToast]);
  const handleCopyLink = useCallback(async (h: any) => {
    const url = `${window.location.origin}/hotels/${h.id}`;
    try { await navigator.clipboard.writeText(url); showToast("Link copied ✓"); }
    catch { showToast("Copy failed"); }
  }, [showToast]);

  // v244 — the reel-filter chip as a reusable node. On home (showFlashDealRail)
  // it's rendered INSIDE the Flash Deals rail header (no overlap/flip); on
  // /discover + /reels it floats top-right as before.
  const filterChipNode = (
    <button
      onClick={() => setFilterOpen(true)}
      className={`ig-filter-chip${showFlashDealRail ? " ig-filter-chip--rail" : ""}`}
      aria-label="Open reel filters"
    >
      <span style={{ fontSize: "0.78rem", lineHeight: 1 }}>{SOURCE_ICON[filterSource]}</span>
      <span style={{ fontSize: "0.58rem", fontWeight: 700, letterSpacing: "0.02em" }}>
        {filterSource === "all" ? "All" : SOURCE_LABEL[filterSource]}
      </span>
      <span style={{ opacity: 0.5 }}>·</span>
      <span style={{ fontSize: "0.58rem", fontWeight: 600, maxWidth: "70px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        📍{filterCity === "all" ? "India" : filterCity}
      </span>
      <span style={{ opacity: 0.6, fontSize: "0.55rem" }}>▾</span>
    </button>
  );

  return (
    <>
      <style jsx global>{`
        @keyframes igKenBurns {
          0%   { transform: scale(1.04) translate(0, 0); }
          50%  { transform: scale(1.18) translate(-2%, -1.8%); }
          100% { transform: scale(1.04) translate(0, 0); }
        }
        @keyframes igFade { from { opacity: 0; } to { opacity: 1; } }
        @keyframes igHeartFly {
          0%   { transform: translate(-50%, -50%) scale(0.4) rotate(var(--rot,0deg)); opacity: 0; }
          12%  { transform: translate(-50%, -50%) scale(1.1) rotate(var(--rot,0deg)); opacity: 0.9; }
          25%  { transform: translate(-50%, calc(-50% - 14px)) scale(1.3) rotate(var(--rot,0deg)); opacity: 1; }
          55%  { transform: translate(calc(-50% + var(--dx,0)*0.5), calc(-50% - 35vh)) scale(1.05) rotate(calc(var(--rot,0deg) * 1.2)); opacity: 0.95; }
          80%  { transform: translate(calc(-50% + var(--dx,0)), calc(-50% - 65vh)) scale(0.8) rotate(calc(var(--rot,0deg) * 1.5)); opacity: 0.6; }
          100% { transform: translate(calc(-50% + var(--dx,0) * 1.4), calc(-50% - 95vh)) scale(0.35) rotate(calc(var(--rot,0deg) * 1.8)); opacity: 0; }
        }
        @keyframes igCommentIn {
          from { transform: translateY(14px); opacity: 0; }
          to   { transform: translateY(0);    opacity: 1; }
        }
        .ig-comment-row {
          animation: igCommentIn 0.45s cubic-bezier(0.2,0.9,0.3,1) both;
          will-change: transform, opacity;
        }
        .ig-comment-input::placeholder {
          color: rgba(255,255,255,0.55);
          font-weight: 400;
        }
        .ig-comment-input:focus {
          background: rgba(255,255,255,0.16) !important;
          border-color: rgba(240,180,41,0.65) !important;
          box-shadow: 0 0 0 3px rgba(240,180,41,0.18);
        }
        @keyframes igDiscSpin { from { transform: rotate(0); } to { transform: rotate(360deg); } }
        @keyframes igRingPulse {
          0%,100% { box-shadow: 0 0 0 0 rgba(240,180,41,0.8), 0 0 0 0 rgba(255,69,141,0.6); }
          50%     { box-shadow: 0 0 0 4px rgba(240,180,41,0.0), 0 0 0 8px rgba(255,69,141,0.0); }
        }
        @keyframes igAudioMarquee {
          0%   { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        @keyframes igLiveDot {
          0%,100% { opacity: 1; transform: scale(1); }
          50%     { opacity: 0.3; transform: scale(1.3); }
        }
        @keyframes igLikePop {
          0%   { transform: scale(1); }
          40%  { transform: scale(1.45) rotate(-8deg); }
          100% { transform: scale(1); }
        }
        @keyframes igSheen {
          0%   { background-position: -120% 0; }
          100% { background-position: 220% 0; }
        }
        @keyframes igDrawerUp {
          from { transform: translateY(100%); }
          to   { transform: translateY(0); }
        }
        @keyframes igToastIn {
          0%   { transform: translate(-50%, -10px); opacity: 0; }
          15%  { transform: translate(-50%, 0);     opacity: 1; }
          85%  { transform: translate(-50%, 0);     opacity: 1; }
          100% { transform: translate(-50%, -8px);  opacity: 0; }
        }
        @keyframes igSparkOut {
          0%   { transform: translate(0,0) scale(0.4); opacity: 1; }
          100% { transform: translate(var(--sx,0), var(--sy,0)) scale(1.1); opacity: 0; }
        }
        @keyframes igPauseFade {
          0%   { transform: scale(0.6); opacity: 0; }
          30%  { transform: scale(1.1); opacity: 1; }
          100% { transform: scale(1);   opacity: 0.85; }
        }

        html, body { overscroll-behavior: none; }

        /* ig-shell — flex column wrapper that holds the rail on top and
           the reel feed below. Replaces the old absolute-floating rail
           that overlaid the first card. Now each surface gets its OWN
           lane in the layout — no overlap, IG-home-feed style. */
        .ig-shell {
          position: absolute;
          inset: 0;
          display: flex;
          flex-direction: column;
          background: #000;
        }
        .ig-feed {
          flex: 1 1 auto;
          min-height: 0;          /* allow flex item to shrink below content height */
          width: 100%;
          overflow-y: auto;
          overflow-x: hidden;
          scroll-snap-type: y mandatory;
          scroll-behavior: smooth;
          -webkit-overflow-scrolling: touch;
          overscroll-behavior: contain;
          background: #000;
          scrollbar-width: none;
          -ms-overflow-style: none;
        }
        .ig-feed::-webkit-scrollbar { display: none; width: 0; height: 0; }
        .ig-card {
          /* Card now fills the FEED area (viewport - rail height), not the
             whole viewport. Combined with the flex shell above, this is
             what visually separates the rail from the reels. */
          height: 100%;
          min-height: 100%;
          scroll-snap-align: start;
          scroll-snap-stop: always;
          /* Perf: each card paints into its own layer + isolates layout
             work from neighbours. Cuts main-thread scroll cost on long
             feeds — browser can skip painting cards entirely outside the
             viewport. */
          contain: layout paint style;
          content-visibility: auto;
          contain-intrinsic-size: 100%;
        }
        /* v93 — windowed-list placeholder. Out-of-window slots still occupy
           the full viewport so swipe geometry + IntersectionObserver math is
           identical to a real card, but they cost ~zero to render. */
        .ig-card-skel {
          background: #000;
          width: 100%;
        }

        /* Filter chip — slim, TOP-RIGHT (was top-left in v75-v80 where it
           visually clashed with the rail header). Brand chrome sits center
           at z-40; chip at z-41 right-edge avoids overlap entirely. */
        .ig-filter-chip {
          position: fixed;
          top: calc(env(safe-area-inset-top, 0px) + 6px);  /* v87: clear notch */
          right: 10px;
          left: auto;
          z-index: 41;
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 4px 8px;
          max-width: 42vw;
          border-radius: 9999px;
          color: var(--cozy-cream-50, #FFFCF6);
          /* v88 — cozy cocoa+champagne instead of magenta/purple */
          background: linear-gradient(135deg, rgba(74,56,32,0.55), rgba(31,26,15,0.40));
          border: 1px solid rgba(217,190,130,0.30);
          backdrop-filter: blur(14px) saturate(1.4);
          -webkit-backdrop-filter: blur(14px) saturate(1.4);
          box-shadow: 0 3px 10px rgba(31,26,15,0.32), inset 0 1px 0 rgba(217,190,130,0.18);
          transition: transform 0.12s ease;
          font-size: 0.6rem;
          line-height: 1.05;
        }
        .ig-filter-chip > * { font-size: 0.58rem !important; }
        .ig-filter-chip:active { transform: scale(0.94); }
        /* v244 — on the home route the chip is now rendered INSIDE the Flash
           Deals rail header (not floating over it). Make it a normal in-flow
           element so it sits cleanly at the rail's right edge — no position:
           fixed, no overlap, no load-flip. Opaque cream-on-cocoa glass reads as
           a deliberate control on the warm rail. */
        .ig-filter-chip--rail {
          position: static;
          top: auto; right: auto; left: auto;
          padding: 5px 10px;
          max-width: 52vw;
          background: linear-gradient(135deg, rgba(74,56,32,0.92), rgba(31,26,15,0.86));
          border: 1px solid rgba(217,190,130,0.4);
          box-shadow: 0 4px 14px rgba(31,26,15,0.4), inset 0 1px 0 rgba(217,190,130,0.22);
        }

        /* Avatar tap-popover (Instagram-style) */
        @keyframes igMenuIn {
          from { transform: translateY(-6px) scale(0.96); opacity: 0; }
          to   { transform: translateY(0)    scale(1);    opacity: 1; }
        }
        .ig-avatar-menu {
          min-width: 200px;
          padding: 6px;
          border-radius: 16px;
          background: linear-gradient(180deg, rgba(20,16,30,0.94) 0%, rgba(8,5,16,0.94) 100%);
          border: 1px solid rgba(255,255,255,0.14);
          backdrop-filter: blur(18px) saturate(1.4);
          -webkit-backdrop-filter: blur(18px) saturate(1.4);
          box-shadow: 0 16px 40px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.08);
          animation: igMenuIn 0.18s ease-out both;
        }
        .ig-avatar-menu-btn {
          display: flex; align-items: center; gap: 10px;
          width: 100%;
          padding: 10px 14px;
          border-radius: 10px;
          color: #fff;
          font-size: 0.84rem;
          font-weight: 600;
          background: transparent;
          transition: background 0.12s ease;
          text-align: left;
        }
        .ig-avatar-menu-btn:active { background: rgba(255,255,255,0.10); }
        .ig-avatar-menu-cancel {
          color: rgba(255,255,255,0.55);
          font-weight: 500;
          justify-content: center;
          margin-top: 2px;
        }

        /* Tappable audio strip */
        .ig-audio-strip-btn { transition: transform 0.12s ease; cursor: pointer; }
        .ig-audio-strip-btn:active { transform: scale(0.97); }

        /* + Create FAB */
        /* v89 — Cozy champagne FAB. Was bright magenta+purple+blue,
           clashed with the cozy palette. Now a soft champagne gradient
           with a subtle warm glow — premium minimal. v89 also bumps
           bottom from 130 → 180px so the rail's "You" Follow pill (at
           ~rail-top) no longer collides with the FAB on tall screens. */
        @keyframes igFabPulse {
          0%,100% { box-shadow: 0 8px 22px rgba(201,166,107,0.45), 0 0 0 0 rgba(201,166,107,0.40); }
          50%     { box-shadow: 0 8px 22px rgba(201,166,107,0.45), 0 0 0 14px rgba(201,166,107,0); }
        }
        /* v572 — the create entry: a 48px disc plus a caption, so it can't be
           mistaken for another icon in the action rail directly above it.
           Sits in the one free pocket of the screen: right of the Book/Bid
           CTA row, below the rail's last button, above the BottomDock. */
        .ig-create-fab {
          position: fixed;
          right: 8px;
          bottom: calc(env(safe-area-inset-bottom, 0px) + 118px);
          z-index: 42;
          display: flex; flex-direction: column; align-items: center; gap: 3px;
          color: var(--cozy-warm-dark, #1F1A0F);
          transition: transform 0.15s ease;
        }
        .ig-create-fab-disc {
          position: relative;
          width: 48px; height: 48px;
          border-radius: 9999px;
          display: flex; align-items: center; justify-content: center;
          background: linear-gradient(135deg, #FFE9AD 0%, #F2C650 45%, #D69A1E 100%);
          border: 2px solid rgba(255, 246, 226, 0.75);
          font-weight: 900;
          animation: igFabPulse 2.4s ease-in-out infinite;
        }
        .ig-create-fab:active { transform: scale(0.92); }
        .ig-create-fab-plus {
          font-size: 1.55rem;
          line-height: 1;
          text-shadow: 0 1px 2px rgba(255, 246, 226, 0.55);
          margin-top: -1px;
        }
        .ig-create-fab-label {
          font-size: 0.6rem;
          font-weight: 800;
          letter-spacing: 0.06em;
          color: #fff;
          text-shadow: 0 1px 4px rgba(0, 0, 0, 0.75);
          line-height: 1;
        }
        .ig-create-fab-glow {
          position: absolute;
          inset: -4px;
          border-radius: 9999px;
          pointer-events: none;
          background: radial-gradient(circle, rgba(201,166,107,0.32) 0%, transparent 70%);
        }

        /* Drawer close button — explicit z-index + relative position so it
           sits above the content's stopPropagation guard, and a generous
           hit target so taps land on touchscreens. */
        .ig-close-btn {
          position: relative;
          z-index: 5;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 36px;
          height: 36px;
          border-radius: 9999px;
          color: rgba(255,255,255,0.85);
          font-size: 1.15rem;
          background: rgba(255,255,255,0.06);
          border: 1px solid rgba(255,255,255,0.12);
          pointer-events: auto;
          transition: background 0.12s ease, transform 0.12s ease;
        }
        .ig-close-btn:hover { background: rgba(255,255,255,0.12); }
        .ig-close-btn:active { transform: scale(0.92); background: rgba(255,255,255,0.18); }

        /* Tap-to-unmute coach mark — top-center, only on first reel */
        @keyframes igUnmuteBob {
          0%,100% { transform: translate(-50%, 0) scale(1); }
          50%     { transform: translate(-50%, -3px) scale(1.03); }
        }
        @keyframes igUnmutePulse {
          0%,100% { box-shadow: 0 6px 22px rgba(0,0,0,0.45), 0 0 0 0 rgba(255,255,255,0.35); }
          50%     { box-shadow: 0 6px 22px rgba(0,0,0,0.45), 0 0 0 12px rgba(255,255,255,0); }
        }
        .ig-tap-unmute {
          position: absolute;
          left: 50%;
          /* Rail now lives in its own band above the card, so the hint
             returns to a natural near-top position (chip is at 14px,
             unmute sits below at 64px). */
          top: calc(env(safe-area-inset-top, 0px) + 64px);
          transform: translate(-50%, 0);
          z-index: 39;
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 9px 16px;
          border-radius: 9999px;
          background: rgba(20,16,30,0.85);
          border: 1px solid rgba(255,255,255,0.28);
          color: #fff;
          font-size: 0.78rem;
          font-weight: 700;
          letter-spacing: 0.02em;
          backdrop-filter: blur(14px) saturate(1.4);
          -webkit-backdrop-filter: blur(14px) saturate(1.4);
          animation:
            igUnmuteBob 1.8s ease-in-out infinite,
            igUnmutePulse 1.8s ease-in-out infinite;
        }
        .ig-tap-unmute:active { transform: translate(-50%, 1px) scale(0.97); }
        .ig-tap-unmute-icon { font-size: 1rem; line-height: 1; }
        .ig-tap-unmute-label { line-height: 1; }

        /* CreateSheet card buttons */
        .ig-create-card-btn {
          display: flex; align-items: center; gap: 10px;
          padding: 10px 12px;
          border-radius: 14px;
          color: #fff;
          background: rgba(255,255,255,0.04);
          border: 1px solid rgba(255,255,255,0.10);
          text-align: left;
          transition: transform 0.12s ease;
        }
        .ig-create-card-btn:active { transform: scale(0.97); }

        /* First-load tap-to-unmute hint */
        @keyframes igUnmuteBob {
          0%,100% { transform: translateY(0); }
          50%     { transform: translateY(-6px); }
        }
        @keyframes igUnmuteGlow {
          0%,100% { box-shadow: 0 0 0 0 rgba(255,215,107,0.55), 0 8px 24px rgba(0,0,0,0.55); }
          50%     { box-shadow: 0 0 0 14px rgba(255,215,107,0.0), 0 8px 24px rgba(0,0,0,0.55); }
        }
        .ig-unmute-hint {
          position: fixed;
          left: 50%;
          top: 50%;
          transform: translate(-50%, -50%);
          z-index: 70;
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 12px 18px;
          border-radius: 9999px;
          background: rgba(20,16,30,0.78);
          border: 1px solid rgba(255,215,107,0.45);
          color: #fff;
          font-size: 0.86rem;
          font-weight: 700;
          letter-spacing: 0.02em;
          backdrop-filter: blur(14px);
          -webkit-backdrop-filter: blur(14px);
          animation: igUnmuteBob 2.2s ease-in-out infinite, igUnmuteGlow 2.2s ease-in-out infinite;
          cursor: pointer;
        }
        .ig-unmute-hint .ig-unmute-icon {
          font-size: 1.3rem; line-height: 1;
          filter: drop-shadow(0 1px 3px rgba(0,0,0,0.5));
        }

        .ig-kb {
          animation: igFade 0.45s ease-out, igKenBurns 11s ease-in-out infinite;
          will-change: transform, opacity;
        }

        .ig-mute-btn {
          width: 36px; height: 36px; border-radius: 9999px;
          display: flex; align-items: center; justify-content: center;
          font-size: 0.95rem;
          background: rgba(0,0,0,0.5);
          border: 1px solid rgba(255,255,255,0.18);
          color: #fff;
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
          transition: transform 0.12s ease;
        }
        .ig-mute-btn:active { transform: scale(0.9); }

        .ig-pause-badge {
          width: 84px; height: 84px; border-radius: 9999px;
          display: flex; align-items: center; justify-content: center;
          font-size: 2.2rem; color: #fff;
          background: rgba(0,0,0,0.45);
          border: 1.5px solid rgba(255,255,255,0.4);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          animation: igPauseFade 0.4s ease-out forwards;
          box-shadow: 0 8px 32px rgba(0,0,0,0.55);
        }

        /* v243 — premium profile chip: a glassy champagne-tinted floating pill
           behind avatar + handle + Follow (all devices). The avatar ring +
           follow button were already premium; this gives the row a cohesive
           floating-bar backing instead of bare text on the video. */
        .ig-profile-chip {
          padding: 5px 8px 5px 5px;
          border-radius: 999px;
          background: linear-gradient(135deg, rgba(31,26,15,0.44), rgba(31,26,15,0.22));
          backdrop-filter: blur(14px) saturate(1.3);
          -webkit-backdrop-filter: blur(14px) saturate(1.3);
          border: 1px solid rgba(217,190,130,0.24);
          box-shadow: 0 4px 16px rgba(15,12,8,0.30), inset 0 1px 0 rgba(255,255,255,0.10);
          width: -moz-max-content;
          width: max-content;
          max-width: calc(100% - 6px);
        }

        /* v89 — Avatar ring: cozy champagne conic instead of rainbow magenta/purple */
        .ig-avatar {
          width: 42px; height: 42px; display: inline-block;
          padding: 2px; border-radius: 9999px;
          background: conic-gradient(from 220deg, #C9A66B, #D9BE82, #6E5430, #C9A66B);
          animation: igRingPulse 2.6s ease-in-out infinite;
        }
        /* Active-story ring — slightly thicker + still cozy. */
        .ig-avatar.has-story {
          padding: 3px;
          background: conic-gradient(from 0deg, #C9A66B, #D9BE82, #6E5430, #C9A66B, #D9BE82, #C9A66B);
          animation: igStoryRingSpin 3.6s linear infinite;
          box-shadow: 0 0 0 1.5px var(--cozy-warm-dark, #1F1A0F) inset, 0 0 12px rgba(201,166,107,0.40);
        }
        .ig-avatar-inner {
          display: flex; align-items: center; justify-content: center;
          width: 100%; height: 100%; border-radius: 9999px;
          background: linear-gradient(135deg, #D9BE82, #C9A66B);
          border: 2px solid var(--cozy-warm-dark, #1F1A0F); overflow: hidden;
        }
        @keyframes igStoryRingSpin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        .ig-verified {
          display: inline-flex; align-items: center; justify-content: center;
          width: 14px; height: 14px; border-radius: 9999px;
          background: linear-gradient(135deg,#3ea0ff,#1a78d6);
          color: #fff; font-size: 9px; font-weight: 900;
          box-shadow: 0 1px 3px rgba(0,0,0,0.5);
        }

        /* ─── Cozy Follow button (v89) — desaturated champagne ─────────── */
        .ig-follow-3d {
          position: relative; isolation: isolate;
          padding: 6px 16px; border-radius: 11px;
          font-size: 0.74rem; font-weight: 800;
          letter-spacing: 0.02em;
          color: var(--cozy-warm-dark, #1F1A0F);
          background: linear-gradient(180deg, #E7CFA0 0%, #D9BE82 40%, #C9A66B 75%, #9C7E48 100%);
          border: 1px solid rgba(255, 246, 226, 0.45);
          text-shadow: 0 1px 0 rgba(255, 246, 226, 0.45);
          box-shadow:
            0 0 14px rgba(201, 166, 107, 0.40),
            0 8px 16px -3px rgba(110, 84, 48, 0.55),
            0 3px 6px -1px rgba(31, 26, 15, 0.4),
            inset 0 1.5px 0 rgba(255, 246, 226, 0.55),
            inset 0 -2px 0 rgba(110, 84, 48, 0.45),
            inset 0 0 0 1px rgba(255, 246, 226, 0.18);
          transition: transform 0.15s cubic-bezier(0.2,0.9,0.3,1), box-shadow 0.15s ease;
          overflow: hidden;
        }
        .ig-follow-3d::before {
          content: ""; position: absolute; inset: 0; pointer-events: none;
          background: linear-gradient(110deg, transparent 35%, rgba(255,255,255,0.6) 50%, transparent 65%);
          background-size: 220% 100%;
          animation: igSheen 3.2s ease-in-out infinite;
          mix-blend-mode: overlay;
        }
        .ig-follow-3d:active {
          transform: translateY(2px) scale(0.96);
          box-shadow:
            0 1px 3px rgba(160,110,8,0.6),
            inset 0 -1px 0 rgba(0,0,0,0.18),
            inset 0 2px 6px rgba(0,0,0,0.35),
            inset 0 0 0 1px rgba(255,255,255,0.18);
        }
        .ig-follow-3d-on {
          color: #fff;
          background: linear-gradient(180deg, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0.04) 100%);
          border: 1px solid rgba(255,255,255,0.35);
          text-shadow: 0 1px 2px rgba(0,0,0,0.5);
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
          box-shadow:
            0 4px 10px -2px rgba(0,0,0,0.45),
            inset 0 1px 0 rgba(255,255,255,0.25),
            inset 0 -1px 0 rgba(0,0,0,0.25);
        }
        .ig-follow-label { position: relative; z-index: 1; }
        .ig-follow-sparkle {
          position: absolute; inset: 0; pointer-events: none;
          display: flex; align-items: center; justify-content: center;
        }
        .ig-spark {
          position: absolute; color: #fff8c5;
          font-size: 0.85rem;
          filter: drop-shadow(0 0 4px rgba(255,215,90,0.8));
          animation: igSparkOut 0.7s ease-out forwards;
        }
        .ig-spark.s0 { --sx:  22px; --sy: -18px; }
        .ig-spark.s1 { --sx: -25px; --sy: -14px; }
        .ig-spark.s2 { --sx:  18px; --sy:  20px; }
        .ig-spark.s3 { --sx: -20px; --sy:  18px; }
        .ig-spark.s4 { --sx:  30px; --sy:   2px; }
        .ig-spark.s5 { --sx: -32px; --sy:   4px; }

        /* ─── Right rail (Instagram-style borderless icons) ─────────────
           Icons sit directly on the video — no pills, no borders, no
           background. Just a soft drop-shadow-sm under each glyph for
           legibility. Compact like Instagram Reels. */
        /* v245 — premium glass action rail. Each icon sits in a frosted
           champagne-tinted disc with depth + a subtle border, instead of a
           bare emoji on the video (the "old feel"). Modern IG/TikTok look,
           cozy palette. The label below is small + clean. */
        .ig-rail-btn {
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          gap: 4px;
          color: #fff;
          font-size: 0.56rem; font-weight: 700;
          transition: transform 0.14s cubic-bezier(.32,1.2,.36,1);
          background: transparent;
          border: 0;
          padding: 0;
          min-width: 44px;
          box-shadow: none;
        }
        .ig-rail-btn:active { transform: scale(0.86); }
        /* v442 — SVG rail icons: fixed size + white with a soft drop-shadow so
           they read on any video, replacing the old emoji glyphs. */
        .ig-icon svg { width: 25px; height: 25px; filter: drop-shadow(0 1px 2px rgba(0,0,0,0.45)); }
        .ig-icon-liked { color: #ff4d6d; }   /* filled heart when liked */
        .ig-icon-saved { color: var(--cozy-gold-2, #E7CFA0); }  /* filled bookmark when saved */
        .ig-icon {
          font-size: 1.18rem; line-height: 1;
          width: 42px; height: 42px;
          display: inline-flex; align-items: center; justify-content: center;
          border-radius: 9999px;
          background: linear-gradient(135deg, rgba(31,26,15,0.46), rgba(31,26,15,0.24));
          border: 1px solid rgba(217,190,130,0.28);
          backdrop-filter: blur(12px) saturate(1.3);
          -webkit-backdrop-filter: blur(12px) saturate(1.3);
          box-shadow: 0 4px 14px rgba(15,12,8,0.32), inset 0 1px 0 rgba(255,255,255,0.14);
          transition: background 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease;
        }
        .ig-rail-btn:hover .ig-icon {
          border-color: rgba(217,190,130,0.5);
          box-shadow: 0 5px 18px rgba(15,12,8,0.4), inset 0 1px 0 rgba(255,255,255,0.2);
        }
        .ig-liked { animation: igLikePop 0.4s ease-out; }
        .ig-rail-count {
          font-size: 0.6rem; font-weight: 700; letter-spacing: 0.02em;
          text-shadow: 0 1px 3px rgba(0,0,0,0.85);
          font-variant-numeric: tabular-nums;
        }

        .ig-disc {
          width: 36px; height: 36px; border-radius: 9999px;
          background: linear-gradient(135deg,#2A2013,#1A130A);
          border: 2px solid rgba(255,255,255,0.7);
          overflow: hidden;
          animation: igDiscSpin 6s linear infinite;
          box-shadow: 0 2px 8px rgba(0,0,0,0.6), inset 0 0 0 4px rgba(0,0,0,0.5);
          display: flex; align-items: center; justify-content: center;
        }

        /* ─── Pills ───────────────────────────────────────────────────────── */
        .ig-pill {
          display: inline-flex; align-items: center; gap: 4px;
          padding: 2px 8px; border-radius: 9999px;
          font-size: 0.58rem; font-weight: 700; letter-spacing: 0.04em;
          /* v444 — cocoa-frosted champagne base (matches the action-rail discs);
             raises contrast over bright video vs the old translucent white. */
          background: linear-gradient(135deg, rgba(31,26,15,0.46), rgba(31,26,15,0.28));
          border: 1px solid rgba(217,190,130,0.30);
          color: #fff;
          backdrop-filter: blur(10px) saturate(1.2);
          -webkit-backdrop-filter: blur(10px) saturate(1.2);
          text-shadow: 0 1px 2px rgba(0,0,0,0.55);
          font-variant-numeric: tabular-nums;
        }
        .ig-pill-gold {
          background: linear-gradient(135deg, rgba(240,180,41,0.35), rgba(240,180,41,0.10));
          border: 1px solid rgba(240,180,41,0.55);
          color: #ffd76b;
        }
        .ig-pill-live {
          background: rgba(255, 69, 89, 0.20);
          border: 1px solid rgba(255, 69, 89, 0.55);
          color: #ffadb6;
        }
        /* v128.6 — wrapper for the score badge that sits inside the
           pills flex row. Lets the compact pill keep its own internal
           styling while flowing naturally with surrounding ig-pill chips. */
        .ig-score-chip {
          display: inline-flex;
          align-items: center;
          line-height: 1;
        }
        .ig-dot {
          width: 6px; height: 6px; border-radius: 9999px;
          background: #ff4559;
          animation: igLiveDot 1.2s ease-in-out infinite;
          box-shadow: 0 0 8px rgba(255,69,89,0.8);
        }

        .ig-audio-strip {
          display: flex; align-items: center; gap: 8px;
          padding: 5px 9px; border-radius: 9999px;
          background: rgba(0,0,0,0.45);
          border: 1px solid rgba(255,255,255,0.12);
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
          max-width: 78%;
          overflow: hidden;
        }
        .ig-audio-icon { font-size: 0.78rem; }
        .ig-audio-text {
          font-size: 0.66rem; color: rgba(255,255,255,0.92);
          white-space: nowrap;
          animation: igAudioMarquee 18s linear infinite;
          display: inline-block;
        }

        /* ─── 3D translucent equal CTAs ──────────────────────────────────── */
        .ig-cta-3d {
          flex: 1 1 0;
          min-width: 0;
          position: relative; isolation: isolate;
          display: inline-flex; align-items: center; justify-content: center; gap: 6px;
          padding: 11px 12px;
          border-radius: 14px;
          font-size: 0.82rem; font-weight: 800;
          letter-spacing: 0.02em;
          background: linear-gradient(180deg, rgba(255,255,255,0.20) 0%, rgba(255,255,255,0.06) 100%);
          backdrop-filter: blur(18px) saturate(1.5);
          -webkit-backdrop-filter: blur(18px) saturate(1.5);
          border: 1px solid rgba(255,255,255,0.32);
          box-shadow:
            0 10px 24px -5px rgba(0,0,0,0.55),
            0 3px 8px rgba(0,0,0,0.3),
            inset 0 1.5px 0 rgba(255,255,255,0.45),
            inset 0 -1px 0 rgba(0,0,0,0.30),
            inset 0 0 0 1px rgba(255,255,255,0.06);
          transition: transform 0.12s cubic-bezier(0.2,0.9,0.3,1), box-shadow 0.12s ease;
          overflow: hidden;
        }
        .ig-cta-3d::before {
          content: ""; position: absolute; inset: 0; pointer-events: none;
          background: linear-gradient(110deg, transparent 35%, rgba(255,255,255,0.45) 50%, transparent 65%);
          background-size: 220% 100%;
          animation: igSheen 4s ease-in-out infinite;
          mix-blend-mode: overlay;
        }
        .ig-cta-3d:active {
          transform: translateY(2px) scale(0.97);
          box-shadow:
            0 2px 6px rgba(0,0,0,0.45),
            inset 0 -1px 0 rgba(0,0,0,0.18),
            inset 0 2px 5px rgba(0,0,0,0.35);
        }
        .ig-cta-icon { font-size: 0.95rem; line-height: 1; filter: drop-shadow(0 1px 2px rgba(0,0,0,0.5)); }
        .ig-cta-text { white-space: nowrap; }

        .ig-cta-book {
          color: #2a1a05;
          background:
            radial-gradient(120% 120% at 30% 0%, rgba(255,231,140,0.55), rgba(255,231,140,0) 45%),
            linear-gradient(180deg, rgba(255,215,107,0.85) 0%, rgba(240,180,41,0.55) 60%, rgba(180,118,8,0.55) 100%);
          border: 1px solid rgba(255,231,140,0.55);
          text-shadow: 0 1px 0 rgba(255,255,255,0.4);
          box-shadow:
            0 0 20px rgba(240,180,41,0.45),
            0 10px 24px -5px rgba(160,110,8,0.55),
            0 3px 8px rgba(0,0,0,0.35),
            inset 0 1.5px 0 rgba(255,255,255,0.7),
            inset 0 -1px 0 rgba(110,70,5,0.5);
        }
        /* v88 — Bid CTA softened from harsh purple/magenta to cozy
           champagne-on-cocoa. Same 3D depth, premium minimal palette. */
        .ig-cta-bid {
          color: #FFF6E2;
          background:
            radial-gradient(120% 120% at 30% 0%, rgba(217,190,130,0.42), rgba(217,190,130,0) 45%),
            linear-gradient(180deg, rgba(110,84,48,0.55) 0%, rgba(74,56,32,0.50) 60%, rgba(31,26,15,0.60) 100%);
          border: 1px solid rgba(217,190,130,0.55);
          text-shadow: 0 1px 4px rgba(0,0,0,0.55);
          box-shadow:
            0 0 18px rgba(201,166,107,0.28),
            0 10px 24px -5px rgba(31,26,15,0.55),
            0 3px 8px rgba(0,0,0,0.40),
            inset 0 1.5px 0 rgba(255,246,226,0.25),
            inset 0 -1px 0 rgba(20,16,8,0.45);
        }

        /* ─── Hearts (love bomb on like/double-tap) ──────────────────────── */
        .ig-heart {
          position: absolute;
          z-index: 50;
          pointer-events: none;
          filter: drop-shadow(0 4px 10px rgba(255,77,109,0.55));
          animation: igHeartFly var(--dur,1500ms) cubic-bezier(0.22,0.85,0.3,1) forwards;
          will-change: transform, opacity;
          transform: translate(-50%,-50%) scale(0.6);
        }

        /* ─── Drawers + toast ─────────────────────────────────────────────── */
        .ig-drawer-up { animation: igDrawerUp 0.32s cubic-bezier(0.3,1,0.3,1) both; }
        .ig-toast { animation: igToastIn 2.2s ease forwards; }
      `}</style>

      {/* ── Filter chip — on /discover + /reels it floats top-right. On home
          it's rendered inside the Flash Deals rail header instead (see the
          rail's filterChip prop below), so here we only render the floating
          version when the rail is NOT shown. ── */}
      {!showFlashDealRail && filterChipNode}

      {/* Active entity/highlight badge with clear (×). Sits beneath the
          filter chip when a profile-driven filter is in effect. */}
      {(filterEntity || filterHighlight) && (
        <div
          className="fixed z-41 flex items-center gap-1.5 px-2.5 py-1 rounded-full"
          style={{
            top: "44px",
            left: "12px",
            background: "linear-gradient(135deg, rgba(240,180,41,0.30), rgba(255,69,141,0.18))",
            border: "1px solid rgba(240,180,41,0.45)",
            color: "#ffd76b",
            fontSize: "0.6rem",
            fontWeight: 700,
            backdropFilter: "blur(10px)",
            WebkitBackdropFilter: "blur(10px)",
            boxShadow: "0 3px 10px rgba(0,0,0,0.35)",
          }}
        >
          {filterEntity && <span>📺 @{filterEntity}</span>}
          {filterHighlight && <span>{filterHighlight.emoji} {filterHighlight.label}</span>}
          <button
            onClick={() => { setFilterEntity(null); setFilterHighlight(null); }}
            className="ml-1 text-white/80 text-[0.7rem] leading-none"
            aria-label="Clear filter"
          >
            ×
          </button>
        </div>
      )}

      {/* MAIN SHELL — flex column so the flash-deal rail sits in its OWN
          band at the top (premium cream surface) and the reel feed gets
          the REMAINING viewport height below. No more overlay: cards no
          longer bleed under the rail. Mirrors Instagram's home-feed
          stories-rail-on-top pattern. */}
      <div className="ig-shell">
        {showFlashDealRail && (
          <FlashDealStoryRail
            deals={flashDeals}
            filterChip={filterChipNode}
            onOpen={(i) => {
              setFlashStoryIdx(i);
              onTrackEvent?.("flash_rail_tap", { idx: i, hotelId: flashDeals[i]?.hotelId });
            }}
          />
        )}

        <div ref={containerRef} className="ig-feed">
        {/*
          ── v93 card-windowing — render the heavy HotelCard ONLY for the
          slots near the active index (default ±4). Out-of-window slots
          still occupy their full viewport height + scroll-snap-align so
          IntersectionObserver positions, swipe geometry, and total scroll
          length are identical to before — but a tiny placeholder costs
          ~zero React work + zero <video> element instead of ~10 useStates
          + a media element. Drops initial mount cost from 30 cards down
          to ~9, which is the single biggest perceived-latency win on
          mid-tier Android.
        */}
        {filteredItems.map((it, i) => {
          const distance = Math.abs(i - activeIdx);
          if (distance > 4) {
            return <section key={it.hotel.id || i} className="ig-card ig-card-skel" aria-hidden />;
          }
          // v400 — hydrate a tagged reel with its resolved starting price so the
          // card renders "From ₹X /n". Only when the item has no price of its
          // own and we resolved a positive one for its tagged hotel.
          const _h: any = it.hotel;
          const _tid = _h?._userPostTaggedHotel?.id;
          const _resolved = _tid ? taggedPrices[String(_tid)] : undefined;
          const _needsPrice =
            !(Number(_h?.minPrice) > 0) && !(Number(_h?.rooms?.[0]?.floorPrice) > 0);
          const cardItem =
            _tid && _needsPrice && Number(_resolved) > 0
              ? { ...it, hotel: { ..._h, minPrice: Number(_resolved) } }
              : it;
          return (
            <HotelCard
              key={it.hotel.id || i}
              item={cardItem}
              active={i === activeIdx}
              adjacent={distance === 1}
              muted={muted}
              hasInteracted={hasInteracted}
              onMuteToggle={toggleMute}
              onTrackEvent={onTrackEvent}
              onBook={handleBook}
              onNegotiate={handleNegotiate}
              onShare={handleShare}
              onCopyLink={handleCopyLink}
              onOpenComments={(h) => setCommentsOpen({ open: true, name: h.name, id: String(h.id || "x") })}
              onOpenMore={(h) => setMoreOpen({ open: true, id: h.id })}
              onOpenEntity={(e) => setCreatorOpen(e)}
              onWatchEntity={handleWatchEntity}
              hasOwnStories={activeStories.length > 0}
              onOpenStories={() => setStoryOpen(true)}
              initialSaved={savedSet.has(`${it.hotel._userPost ? "video" : "hotel"}:${it.hotel.id}`)}
            />
          );
        })}
        {filteredItems.length === 0 && (
          <section className="ig-card flex items-center justify-center text-center text-white/70 px-6">
            <div>
              <p className="text-6xl mb-3">🔍</p>
              <p className="text-white font-semibold mb-1.5">No reels match this filter</p>
              <p className="text-white/55 text-[0.78rem] mb-4">
                Try switching to a different source or location.
              </p>
              <button
                onClick={() => persistFilter("all", "all")}
                className="ig-cta-3d ig-cta-book inline-flex"
                style={{ padding: "10px 18px", fontSize: "0.82rem" }}
              >
                <span className="ig-cta-icon">↻</span>
                <span className="ig-cta-text">Reset filter</span>
              </button>
            </div>
          </section>
        )}
        </div>
      </div>

      <FilterSheet
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        source={filterSource}
        city={filterCity}
        onChange={({ source, city }) => persistFilter(source, city)}
        cityOptions={cityOptions}
        sourceCounts={sourceCounts}
      />

      <CommentDrawer
        open={commentsOpen.open}
        onClose={() => setCommentsOpen({ open: false, name: "", id: "" })}
        hotelName={commentsOpen.name}
        postId={commentsOpen.id}
        onMaskedToast={showToast}
      />
      <MoreMenu
        open={moreOpen.open}
        onClose={() => setMoreOpen({ open: false, id: "" })}
        hotelHref={(() => {
          // v160 — resolve a REAL hotel link. For a real hotel-feed card
          // hotel.id is a genuine hotel id. For a user-post reel hotel.id
          // is the social_posts row id, so we use the tagged hotel id
          // instead (null when the reel tagged no hotel → row hidden).
          const h = items.find((x) => x.hotel.id === moreOpen.id)?.hotel as any;
          if (!h) return null;
          if (h._userPost) {
            return h._taggedHotelId ? `/hotels/${h._taggedHotelId}` : null;
          }
          return `/hotels/${h.id}`;
        })()}
        isUserPost={(() => {
          // Owner-gate: Edit / Delete only appear for the post AUTHOR.
          // Earlier (v79 and prior) this just checked `_userPost`, which
          // was true for ANY user post — even someone else's public reel
          // — so the moderation actions leaked across users. Gate via
          // `_isSelf` too.
          const h = items.find((x) => x.hotel.id === moreOpen.id)?.hotel as any;
          return !!(h?._userPost && h?._isSelf);
        })()}
        onEditPost={() => {
          const it = items.find((x) => x.hotel.id === moreOpen.id);
          if (it) setEditPostId(moreOpen.id);
        }}
        onDeletePost={() => {
          const id = moreOpen.id;
          if (!id) return;
          if (typeof window !== "undefined" && !window.confirm("Delete this post? This cannot be undone.")) return;
          removePost(id);
          showToast("🗑 Post deleted");
          onTrackEvent?.("ig_delete_post", { id });
        }}
        muted={muted}
        gain={gain}
        onCycleGain={cycleGain}
        onToggleMute={toggleMute}
        onShare={() => {
          const it = items.find((x) => x.hotel.id === moreOpen.id);
          if (it) handleShare(it.hotel);
        }}
        onCopy={() => {
          const it = items.find((x) => x.hotel.id === moreOpen.id);
          if (it) handleCopyLink(it.hotel);
        }}
        hotelName={(() => {
          const h = items.find((x) => x.hotel.id === moreOpen.id)?.hotel as any;
          return h?._userPostTaggedHotel?.name || h?.name || "";
        })()}
        authorHandle={(() => {
          const h = items.find((x) => x.hotel.id === moreOpen.id)?.hotel as any;
          return h ? (creatorFor(h).handle || entityFromHotel(h).handle || "") : "";
        })()}
        onReport={(reason) => {
          const h = items.find((x) => x.hotel.id === moreOpen.id)?.hotel as any;
          const postId = moreOpen.id;
          const hotelId = h?._userPost ? (h?._taggedHotelId || null) : (h?.id || null);
          try {
            const tok = typeof window !== "undefined" ? localStorage.getItem("sb_token") : null;
            fetch("/api/social/report", {
              method: "POST",
              headers: { "Content-Type": "application/json", ...(tok ? { Authorization: `Bearer ${tok}` } : {}) },
              body: JSON.stringify({
                postId, hotelId,
                hotelName: h?._userPostTaggedHotel?.name || h?.name || null,
                authorHandle: h ? (creatorFor(h).handle || "") : null,
                reason, surface: "reel",
              }),
            }).catch(() => {});
          } catch {}
          showToast("🚩 Reported — our team will review this reel");
          onTrackEvent?.("ig_report_reel", { id: postId, reason });
        }}
        onNotInterested={() => {
          const h = items.find((x) => x.hotel.id === moreOpen.id)?.hotel as any;
          const id = moreOpen.id;
          // Suppress the reel id AND its tagged hotel so similar content drops too.
          markNotInterested(String(id));
          if (h?._taggedHotelId) markNotInterested(String(h._taggedHotelId));
          showToast("👍 Got it — you'll see less like this");
          onTrackEvent?.("ig_not_interested", { id });
        }}
      />

      {/* + Plus button (Create flow) — Instagram-style, available on every
          reel screen so user can post from anywhere.
          Phase 4 tier-system: onFabClick intercepts the tap. PUBLIC users
          with canUpload=false see UpgradeChoiceSheet instead of CreateSheet.
          tierContext + controlled-composer props let UpgradeChoiceSheet
          hand back into the Composer directly with booking metadata. */}
      <CreateFlow
        sanitize={sanitizeComment}
        onFabClick={async () => {
          try {
            // Cache the tier snapshot for the session — fetch only when
            // we don't already have one. Saves a roundtrip on subsequent
            // FAB taps within the same page view.
            let snap = tierSnapshot;
            if (!snap) {
              snap = (await api.getMyTier()) as MyTierResponse;
              setTierSnapshot(snap);
            }
            // If user can upload (non-PUBLIC OR PUBLIC with eligible
            // bookings/location verification), let CreateFlow open the
            // default CreateSheet as today. tierContext stays undefined
            // → /api/social/posts route used as before.
            if (snap?.canUpload) {
              setTierContext(undefined);
              return; // void → default-open behavior
            }
            // Otherwise, intercept: show UpgradeChoiceSheet.
            setUpgradeOpen(true);
            return false;
          } catch {
            // If tier probe fails, fail open (don't block uploads on
            // network errors — better UX than a stuck FAB).
            return;
          }
        }}
        tierContext={tierContext}
        composerOpen={pickedComposerOpen || undefined}
        composerKind={pickedComposerOpen ? "reel" : undefined}
        onComposerClose={() => {
          setPickedComposerOpen(false);
          setTierContext(undefined);
        }}
        onPosted={(p) => {
          // v121.2 — ROOT CAUSE FIX for the "one upload → two server rows"
          // duplicate bug the user just diagnosed.
          //
          // History: this onPosted callback used to run a FULL second
          // upload pipeline (uploadSocialMedia + POST /api/social/posts)
          // after the Composer fired. That was correct in v97-v109 when
          // CreateFlow.Composer was a local-only persistence layer. But
          // starting v110-v111 the Composer's own runUpload() started
          // doing the Storage push + the social_posts insert itself,
          // making this callback REDUNDANT. Nobody removed it.
          //
          // Worse: this duplicate POST never carried `clientPostId`, so
          // server-side idempotency (which dedups by client_post_id)
          // couldn't catch it. Every upload silently created TWO rows —
          // one from runUpload (with clientPostId, dedup-protected) and
          // one from THIS callback (without clientPostId, free dupe).
          //
          // Verified live by the user 2026-05-15:
          //   row #1: 01:26:08 AM, client_post_id="post-1778788555406-yu01cx"
          //   row #2: 01:26:14 AM, client_post_id=NULL ← this code path
          //
          // Now: just fire the side-effects (toast + scroll + tracking).
          // The Composer already committed the durable row + the durable
          // PostsStore entry via runUpload's v120.1 contract.
          showToast(`✓ Posted to your profile`);
          onTrackEvent?.("ig_create_post", { kind: p.kind, hasAudio: !!p.audio, tagsCount: p.tags.length });
          // Scroll the feed to the top so the freshly-uploaded reel
          // (already in PostsStore via Composer.runUpload's addPost) is
          // visible immediately.
          setTimeout(() => {
            const root = containerRef.current;
            if (!root) return;
            root.scrollTo({ top: 0, behavior: "smooth" });
            setActiveIdx(0);
          }, 100);
        }}
      />
      {/* Phase 4 — Tier-system upgrade-choice sheet. Mounted alongside
          CreateFlow; UpgradeChoiceSheet handles its own portaling +
          backdrop, so visual stacking is independent. */}
      <UpgradeChoiceSheet
        open={upgradeOpen}
        tier={tierSnapshot}
        onClose={() => setUpgradeOpen(false)}
        onPickedContext={(ctx: TierContext) => {
          // Translate the picker output into the Composer's tier-context
          // shape (both shapes happen to be identical right now, but the
          // explicit map keeps the boundary clean if either evolves).
          if (ctx.kind === "verified_guest") {
            setTierContext({
              kind: "verified_guest",
              hotelId: ctx.hotelId,
              bookingId: ctx.bookingId,
            });
          } else {
            setTierContext({
              kind: "community_contributor",
              hotelId: ctx.hotelId,
              locationVerificationId: ctx.locationVerificationId,
            });
          }
          setUpgradeOpen(false);
          // Skip the CreateSheet chooser — open Composer directly. Reel
          // is the default kind; the user can switch inside the Composer
          // if their first instinct was Photo or Story.
          setPickedComposerOpen(true);
        }}
      />
      {/* ── Inline Edit-post sheet — caption + tags only. Media replace
            is intentionally NOT supported; user can Delete + Re-create
            for new media. PostsStore.addPost dedupes by id so saving
            here replaces the post in-place, preserving posterUrl +
            mediaUrl + audio. ── */}
      {editPostId && (() => {
        const existing = userPosts.find((p) => p.id === editPostId);
        if (!existing) return null;
        return (
          <EditPostSheet
            post={existing}
            sanitize={sanitizeComment}
            onClose={() => setEditPostId(null)}
            onSave={(updated) => {
              addPost(updated);
              showToast("✓ Post updated");
              setEditPostId(null);
              onTrackEvent?.("ig_edit_post", { id: updated.id });
            }}
          />
        );
      })()}

      <CreatorProfileSheet
        open={!!creatorOpen}
        onClose={() => setCreatorOpen(null)}
        creator={creatorOpen}
        hotels={items.map((it) => it.hotel)}
        onPickReel={scrollToHotel}
        onApplyHighlight={handleApplyHighlight}
      />

      {/* v572 — the feed-level "Tap to unmute" coach mark is GONE. The active
          card renders its own (.ig-tap-unmute, same `muted && !hasInteracted`
          condition), so both were on screen at once, saying the same sentence
          twice. The card's version is the one that survives: it unmutes THAT
          card's <video> inside the click's user gesture, which is what the
          autoplay policy actually requires. */}

      {/* v572 — one-time swipe affordance. A full-bleed video with no visible
          chrome does not tell a first-time viewer that there is a next one, and
          the reel rail on the home page now sends people straight in here. Shown
          once per device, on the first card only, and it disappears the moment
          they scroll — the point is to teach the gesture, not to sit on top of
          the content. Styles live in globals.css: this file is at its
          styled-jsx block ceiling (see the note at the bottom of the file). */}
      {swipeHint && items.length > 1 && (
        <div className="ig-swipe-hint" aria-hidden>
          <span className="ig-swipe-hint-chev">⌃</span>
          <span>Swipe up for the next reel</span>
        </div>
      )}

      <Toast msg={toast} />

      {/* Story viewer — fed by activeStories (24h-filtered above). */}
      <StoryViewer
        open={storyOpen}
        stories={activeStories}
        ownerName={ownerName}
        ownerAvatar={ownerAvatar}
        onClose={() => setStoryOpen(false)}
      />

      {/* Flash-deal story viewer — same lifecycle pattern as StoryViewer
          but pulls from auto-generated /api/flash/near + opens with the
          existing direct-book URL on tap of "Book Now". */}
      <FlashDealStoryViewer
        open={flashStoryIdx !== null}
        deals={flashDeals}
        startIdx={flashStoryIdx ?? 0}
        onClose={() => setFlashStoryIdx(null)}
        onTrackEvent={onTrackEvent}
        onBook={(d: FlashDealStory) => {
          // v130 — snap the dealPrice query param so the hotel page reads a
          // ₹100-multiple straight from the URL. Mirrors the snap in the
          // /flash-deals card Grab Now path so both surfaces are byte-equal.
          const url =
            `/hotels/${d.hotelId}` +
            `?dealId=${encodeURIComponent(d.id)}` +
            `&dealPrice=${encodeURIComponent(String(snap100(d.dealPrice)))}` +
            `&roomId=${encodeURIComponent(d.roomId)}` +
            `&discount=${encodeURIComponent(String(d.discount))}` +
            `&directBook=true`;
          setFlashStoryIdx(null);
          router.push(url);
        }}
      />

      {/* v132.9 — Desktop keyboard-shortcuts help overlay + tiny `?` chip.
          Chip is bottom-left, hidden on mobile via `.sb-help-chip` CSS
          rules in desktop.css §24. Overlay opens via the chip OR via the
          `?` key handled in the keyboard effect above.
          Uses inline `position:fixed` instead of Tailwind `.fixed.inset-0`
          classes so the keyboard handler's modal-check selector doesn't
          confuse it with a real modal (which would otherwise block the
          Escape-to-close shortcut).  ─────────────────────────────────── */}
      <button
        type="button"
        className="sb-help-chip"
        onClick={() => setHelpOpen(true)}
        aria-label="Show keyboard shortcuts"
        title="Keyboard shortcuts (?)"
      >
        ?
      </button>
      {helpOpen && (
        <div
          className="sb-help-overlay"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 200,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(2, 4, 12, 0.78)",
            backdropFilter: "blur(8px) saturate(140%)",
            WebkitBackdropFilter: "blur(8px) saturate(140%)",
            animation: "sbHelpFadeIn 0.22s ease both",
          }}
          onClick={() => setHelpOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: "440px",
              width: "calc(100% - 32px)",
              maxHeight: "82vh",
              overflowY: "auto",
              background: "var(--bg-elevated, #1a1424)",
              border: "1px solid var(--border-strong, rgba(201, 145, 26, 0.30))",
              borderRadius: "22px",
              padding: "24px 26px",
              boxShadow: "0 30px 80px -10px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.04)",
              color: "var(--text-base, #fff)",
              fontFamily: "inherit",
              animation: "sbHelpScaleIn 0.24s cubic-bezier(0.3, 1, 0.32, 1) both",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
              <div>
                <p style={{ fontSize: "0.6rem", fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--accent, #C9A66B)", marginBottom: "2px" }}>
                  Reel feed
                </p>
                <h3 style={{ fontSize: "1.15rem", fontWeight: 600, letterSpacing: "-0.01em" }}>
                  Keyboard shortcuts
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setHelpOpen(false)}
                aria-label="Close"
                style={{
                  width: "32px",
                  height: "32px",
                  borderRadius: "50%",
                  background: "rgba(255,255,255,0.06)",
                  border: "1px solid rgba(255,255,255,0.12)",
                  color: "rgba(255,255,255,0.8)",
                  fontSize: "1.05rem",
                  cursor: "pointer",
                  lineHeight: 1,
                }}
              >
                ✕
              </button>
            </div>

            <div style={{ display: "grid", gap: "10px" }}>
              {[
                { keys: ["↓", "j", "PgDn"], label: "Next reel" },
                { keys: ["↑", "k", "PgUp"], label: "Previous reel" },
                { keys: ["Home"], label: "Jump to top" },
                { keys: ["End"], label: "Jump to end" },
                { keys: ["m"], label: "Toggle mute" },
                { keys: ["?"], label: "Toggle this help" },
                { keys: ["Esc"], label: "Close any open overlay" },
              ].map((row) => (
                <div
                  key={row.label}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "9px 12px",
                    borderRadius: "10px",
                    background: "rgba(255,255,255,0.04)",
                    border: "1px solid rgba(255,255,255,0.06)",
                  }}
                >
                  <span style={{ fontSize: "0.86rem", color: "var(--text-soft, rgba(255,255,255,0.85))" }}>
                    {row.label}
                  </span>
                  <span style={{ display: "flex", gap: "6px" }}>
                    {row.keys.map((k) => (
                      <kbd
                        key={k}
                        style={{
                          padding: "3px 8px",
                          minWidth: "28px",
                          textAlign: "center",
                          background: "rgba(255,255,255,0.08)",
                          border: "1px solid rgba(255,255,255,0.18)",
                          borderRadius: "6px",
                          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                          fontSize: "0.72rem",
                          color: "var(--text-base, #fff)",
                          boxShadow: "inset 0 -1px 0 rgba(0,0,0,0.2)",
                        }}
                      >
                        {k}
                      </kbd>
                    ))}
                  </span>
                </div>
              ))}
            </div>

            <p style={{ marginTop: "16px", fontSize: "0.72rem", color: "var(--text-muted, rgba(255,255,255,0.5))", textAlign: "center", letterSpacing: "0.02em" }}>
              Shortcuts work on desktop only · disabled while typing
            </p>
          </div>
          {/* v132.9.1 — @keyframes sbHelpFadeIn + sbHelpScaleIn moved to
              app/desktop.css to avoid the SWC styled-jsx visitor.rs:597
              panic. CLAUDE.md "Never add a SECOND <style jsx> block to
              InstagramHotelFeed.tsx" — this file already has two existing
              <style jsx global> blocks (lines 1353 + 3407) inside the
              HotelCard + InstagramHotelFeed components. Adding a third
              triggers the documented Rust panic during Vercel's SWC
              compile pass. tsc --noEmit doesn't catch it (it's an SWC
              transform issue, not a TS one). */}
        </div>
      )}
    </>
  );
}
