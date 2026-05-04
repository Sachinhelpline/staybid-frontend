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
import { useEffect, useRef, useState, useCallback, memo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSoundStore } from "@/lib/sound-store";
import { useFollow } from "@/lib/follow-store";

type Item = { hotel: any; score?: number; reasons?: string[]; exploration?: boolean };

type Props = {
  items: Item[];
  onIndexChange?: (idx: number) => void;
  onLoadMore?: () => void;
  onTrackEvent?: (name: string, payload: any) => void;
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
function videoForHotel(h: any): string {
  if (h?.videoUrl && /^https?:\/\//.test(h.videoUrl)) return h.videoUrl;
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

// ─── Hotel-as-entity helper — lets the same profile sheet render hotels ──
function entityFromHotel(h: any): Creator {
  return {
    handle: (h.name || "hotel").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 24) || "hotel",
    name: h.name || "Hotel",
    verified: !!h.trustBadge || (h.starRating || 0) >= 4,
    bio: `${h.starRating ? "★".repeat(Math.min(5, h.starRating)) + " · " : ""}${h.city || ""}${h.state ? ", " + h.state : ""}\n${h.description || "Verified property on StayBid · live reverse-auction · book at your price."}`,
    avatarHue: hashStr(h.id || h.name || "x") % 360,
    sourceType: "hotel",
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Anti-bypass communication guard
// ───────────────────────────────────────────────────────────────────────
// Rule: hotels, creators and customers MUST NOT use the public comment
// stream as a private messaging back-channel. If they could exchange phone
// numbers, emails, WhatsApp/Telegram/Instagram handles or off-platform
// links, off-platform bookings would happen and StayBid's reverse-auction
// commission would be bypassed.
// Every public comment posted in the reel feed is run through this
// sanitizer. Matched personal-contact substrings are replaced with `•••••`
// and the user is shown a warning toast. The masked comment still posts so
// genuine sentiment ("looks lovely!") survives, but the contact channel is
// dead.
//
// ⚠️ This is the public layer ONLY. After a booking is CONFIRMED, the user
// can chat with that specific property through the booking page (separate
// feature, /bookings → already gated to booking owner ↔ booked hotel).
// ─────────────────────────────────────────────────────────────────────────
const CONTACT_PATTERNS: RegExp[] = [
  // Phone — international and Indian formats (8–14 digits with separators)
  /\+?\d[\d\s\-().]{7,16}\d/g,
  // Email
  /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/gi,
  // URLs
  /(https?:\/\/|www\.)\S+/gi,
  // Bare domains (.com, .in, etc.)
  /\b[a-z0-9-]+\.(com|in|co\.in|net|org|io|me|app|xyz|live|shop)(\/\S*)?\b/gi,
  // WhatsApp / Telegram / Signal / Skype / Zoom — any reference is a flag
  /\b(whats[\s.]?app|wa\.?me|telegram|t\.?me|signal|skype|google\s*meet|zoom\s*meeting)\b/gi,
  // "DM me", "call me", "ping me", "reach out", "drop your number"
  /\b(d\.?m\.?\s*(me|@)?|inbox\s*me|message\s*me|call\s*me|ping\s*me|reach\s*out\s*to\s*me|drop\s*(your\s*)?(number|contact|whatsapp))\b/gi,
  // Social handles outside @hotel/creator chips: "insta: x", "fb: y"
  /\b(insta(gram)?|fb|facebook|snap(chat)?|twitter|x\.com)\s*[:\-@]\s*\S+/gi,
  // "Off-platform", "outside the app", "directly with hotel"
  /\b(off[-\s]?platform|outside\s*(the\s*)?(app|platform)|book\s*direct(ly)?|side\s*deal)\b/gi,
];

function sanitizeComment(text: string): { clean: string; blocked: boolean } {
  let clean = text;
  let blocked = false;
  for (const p of CONTACT_PATTERNS) {
    if (p.test(clean)) blocked = true;
    clean = clean.replace(p, "•••••");
  }
  return { clean, blocked };
}

const SAMPLE_COMMENTS = [
  { user: "priya_m", text: "Looks like a dream 😍 saving for our anniversary trip", time: "2h", likes: 14 },
  { user: "rohan.k", text: "Booked through StayBid, saved ₹4,200 vs MakeMyTrip — same suite", time: "5h", likes: 32 },
  { user: "wanderlust.in", text: "That sunrise shot 🌄🔥", time: "8h", likes: 9 },
  { user: "aisha_s", text: "Service was unreal. Manager remembered our names from check-in.", time: "1d", likes: 21 },
  { user: "vikrambhola", text: "Pool is even better in person.", time: "1d", likes: 6 },
  { user: "meeradc", text: "Quiet, clean, mountains right outside the bathroom window. Magical.", time: "2d", likes: 18 },
];

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
  open, onClose, hotelName, onMaskedToast,
}: {
  open: boolean;
  onClose: () => void;
  hotelName: string;
  onMaskedToast?: (msg: string) => void;
}) {
  // Sample comments are run through the same sanitizer to stay consistent
  // with the live rule (defense-in-depth).
  const seedComments = SAMPLE_COMMENTS.map((c) => ({ ...c, text: sanitizeComment(c.text).clean }));
  const [comments, setComments] = useState(seedComments);
  const [input, setInput] = useState("");
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[80] flex items-end" onClick={onClose}>
      <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)" }} />
      <div
        className="relative w-full ig-drawer-up"
        onClick={(e) => e.stopPropagation()}
        style={{
          height: "72vh",
          background: "linear-gradient(180deg,#15101e 0%,#0a0612 100%)",
          borderTopLeftRadius: 24, borderTopRightRadius: 24,
          borderTop: "1px solid rgba(255,255,255,0.12)",
          boxShadow: "0 -20px 60px rgba(0,0,0,0.7)",
          display: "flex", flexDirection: "column",
        }}
      >
        <div className="flex justify-center pt-2.5 pb-1.5"><div className="w-10 h-[3px] rounded-full bg-white/30" /></div>
        <div className="flex items-center justify-between px-5 pb-3 border-b border-white/8">
          <p className="text-white font-semibold text-sm">Comments</p>
          <button onClick={onClose} className="text-white/55 text-xl">✕</button>
        </div>

        {/* ⚠️ Public-comments-only notice. Tells users that personal contact
            info is auto-masked so the platform stays the booking channel. */}
        <div
          className="mx-5 mt-3 mb-1 px-3 py-2 rounded-xl flex items-start gap-2"
          style={{
            background: "linear-gradient(135deg, rgba(240,180,41,0.14), rgba(255,69,141,0.08))",
            border: "1px solid rgba(240,180,41,0.30)",
          }}
        >
          <span className="text-base leading-none mt-0.5">🛡️</span>
          <p className="text-white/85 text-[0.66rem] leading-snug">
            Public comments only. Phone, email, WhatsApp, social handles & off-platform links are auto-masked.
            <span className="text-white/55"> Booked guests can chat with their property from </span>
            <span className="text-gold-300 font-semibold">My Bookings</span>
            <span className="text-white/55">.</span>
          </p>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-4" style={{ WebkitOverflowScrolling: "touch" }}>
          {comments.map((c, i) => (
            <div
              key={`${c.user}-${i}-${c.text.slice(0,8)}`}
              className="ig-comment-row flex items-start gap-2.5"
              style={{ animationDelay: `${Math.min(i * 60, 600)}ms` }}
            >
              <div className="w-8 h-8 rounded-full shrink-0 flex items-center justify-center text-[0.7rem] font-bold text-black"
                style={{ background: `conic-gradient(from ${(i*47)%360}deg, #f0b429, #ff458d, #b964ff, #f0b429)` }}>
                <span className="w-[26px] h-[26px] rounded-full flex items-center justify-center"
                  style={{ background: "linear-gradient(135deg,#ffd76b,#f0b429)" }}>
                  {c.user.slice(0, 1).toUpperCase()}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-white text-[0.78rem] leading-snug">
                  <span className="font-semibold">{c.user}</span>{" "}
                  <span className="text-white/85">{c.text}</span>
                </p>
                <div className="flex items-center gap-3 mt-0.5 text-white/45 text-[0.62rem]">
                  <span>{c.time}</span>
                  <span>{c.likes} likes</span>
                  {/* Reply intentionally removed — private replies between
                      hotels/creators/customers would create a DM channel
                      that bypasses the booking flow. */}
                </div>
              </div>
              <button className="text-white/40 text-[0.7rem] mt-1" aria-label="Like comment">🤍</button>
            </div>
          ))}
          {comments.length === 0 && <p className="text-white/45 text-sm text-center pt-8">Be the first to comment on {hotelName}</p>}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const text = input.trim();
            if (!text) return;
            const { clean, blocked } = sanitizeComment(text);
            if (blocked) {
              onMaskedToast?.("🛡️ Personal contact info hidden — keep bookings on StayBid");
            }
            setComments((c) => [{ user: "you", text: clean, time: "now", likes: 0 }, ...c]);
            setInput("");
          }}
          className="flex items-center gap-2 px-4 py-3 border-t border-white/8"
          style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 12px)" }}
        >
          <div className="w-9 h-9 rounded-full shrink-0 flex items-center justify-center text-xs font-bold text-black"
            style={{ background: "linear-gradient(135deg,#ffd76b,#f0b429)" }}>You</div>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={`Public comment on ${hotelName}… (no contacts)`}
            className="ig-comment-input flex-1 rounded-full px-4 py-2 text-[0.82rem] outline-none transition-colors"
            style={{
              color: "#ffffff",
              caretColor: "#ffd76b",
              background: "rgba(255,255,255,0.10)",
              border: "1px solid rgba(255,255,255,0.20)",
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
  open, onClose, hotelId, onShare, onCopy, onToggleMute, muted,
}: {
  open: boolean; onClose: () => void; hotelId: string;
  onShare: () => void; onCopy: () => void; onToggleMute: () => void; muted: boolean;
}) {
  if (!open) return null;
  const items = [
    { icon: "📋", label: "Copy link", onClick: onCopy },
    { icon: "↗", label: "Share to…", onClick: onShare },
    { icon: muted ? "🔊" : "🔇", label: muted ? "Unmute audio" : "Mute audio", onClick: onToggleMute },
    { icon: "🏨", label: "Open hotel page", href: `/hotels/${hotelId}` },
    { icon: "🚩", label: "Report this reel", danger: true },
    { icon: "🚫", label: "Not interested" },
  ];
  return (
    <div className="fixed inset-0 z-[80] flex items-end" onClick={onClose}>
      <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)" }} />
      <div
        className="relative w-full ig-drawer-up"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "linear-gradient(180deg,#15101e 0%,#0a0612 100%)",
          borderTopLeftRadius: 24, borderTopRightRadius: 24,
          borderTop: "1px solid rgba(255,255,255,0.12)",
          boxShadow: "0 -20px 60px rgba(0,0,0,0.7)",
          paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 12px)",
        }}
      >
        <div className="flex justify-center pt-2.5 pb-1.5"><div className="w-10 h-[3px] rounded-full bg-white/30" /></div>
        <div className="px-2 pb-1">
          {items.map((it: any, i) => {
            const inner = (
              <div className="flex items-center gap-3 px-4 py-3.5 rounded-xl active:bg-white/8 transition-colors">
                <span className="text-xl">{it.icon}</span>
                <span className={`text-[0.88rem] ${it.danger ? "text-red-400" : "text-white"} font-medium`}>{it.label}</span>
              </div>
            );
            if (it.href) {
              return <Link key={i} href={it.href} onClick={onClose}>{inner}</Link>;
            }
            return (
              <button key={i} onClick={() => { it.onClick?.(); onClose(); }} className="w-full text-left">
                {inner}
              </button>
            );
          })}
        </div>
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
  const { isFollowing, toggleFollow, followerCount, followingCount, follows, searchFollowers } = useFollow();

  // Reset to default tab whenever a new profile is opened
  useEffect(() => {
    if (open) { setTab("reels"); setFollowerQuery(""); }
  }, [open, creator?.handle]);

  if (!open || !creator) return null;

  const followed = isFollowing(creator.handle);
  // Reels created by this entity. For hotels we synth: all reels for this hotel id;
  // for creators we use creatorFor(h).
  const myReels =
    creator.sourceType === "hotel" && /^[a-z0-9_]+$/.test(creator.handle)
      ? hotels.filter((h) => entityFromHotel(h).handle === creator.handle).slice(0, 18)
      : hotels.filter((h) => creatorFor(h).handle === creator.handle).slice(0, 18);
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
    <div className="fixed inset-0 z-[85] flex items-end" onClick={onClose}>
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
          <button onClick={onClose} className="text-white/55 text-xl">✕</button>
        </div>

        <div className="overflow-y-auto px-5 pb-6 flex-1" style={{ WebkitOverflowScrolling: "touch" }}>
          {/* Header: avatar + 3 stats */}
          <div className="flex items-center gap-5 pt-2 pb-3">
            <div
              className="w-[88px] h-[88px] rounded-full p-[3px] shrink-0"
              style={{
                background: `conic-gradient(from ${creator.avatarHue}deg, #f0b429, #ff458d, #b964ff, #f0b429)`,
                animation: "igRingPulse 2.6s ease-in-out infinite",
              }}
            >
              <div
                className="w-full h-full rounded-full flex items-center justify-center text-[2rem] font-bold"
                style={{
                  background: `linear-gradient(135deg, hsl(${creator.avatarHue},70%,60%), hsl(${(creator.avatarHue+60)%360},70%,40%))`,
                  border: "2px solid #000",
                  color: "#fff",
                  textShadow: "0 2px 6px rgba(0,0,0,0.5)",
                }}
              >
                {creator.name.slice(0, 1).toUpperCase()}
              </div>
            </div>
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

          {/* Name + bio (bio passes through the same sanitizer that scrubs
              comments — creators must not use the bio as a contact billboard) */}
          <p className="text-white font-semibold text-[0.92rem] leading-tight">{creator.name}</p>
          <p className="text-white/75 text-[0.78rem] mt-1 leading-snug whitespace-pre-line">
            {sanitizeComment(creator.bio).clean}
          </p>
          <p className="text-gold-300 text-[0.74rem] mt-1">❤️ {fmtCount(likesTotal)} likes earned · {reelsCount} reels published</p>

          {/* CTAs — Message removed: customers ↔ creators / hotel owners can
              not have a private DM channel before a confirmed booking, or
              off-platform booking would bypass StayBid commission. */}
          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={() => toggleFollow(creator.handle)}
              className={`ig-follow-3d ${followed ? "ig-follow-3d-on" : ""}`}
              style={{ flex: 2, padding: "11px 16px", fontSize: "0.86rem" }}
            >
              <span className="ig-follow-label">{followed ? "✓ Following" : "+ Follow"}</span>
            </button>
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

          {/* Highlights row — LIVE: tap applies a theme filter to the feed */}
          <div className="mt-4 flex gap-3 overflow-x-auto no-scrollbar pb-1">
            {HIGHLIGHTS.map((hl, i) => (
              <button
                key={hl.key}
                onClick={() => { onApplyHighlight?.(hl); onClose(); }}
                className="flex flex-col items-center shrink-0 active:scale-95 transition-transform"
              >
                <div className="w-[60px] h-[60px] rounded-full p-[2px]"
                  style={{ background: "linear-gradient(135deg, rgba(240,180,41,0.85), rgba(255,69,141,0.65))" }}>
                  <div className="w-full h-full rounded-full flex items-center justify-center text-xl"
                    style={{ background: `linear-gradient(135deg, hsl(${(creator.avatarHue + i*40)%360},60%,30%), #0a0612)`, border: "2px solid #000" }}>
                    {hl.emoji}
                  </div>
                </div>
                <span className="text-white/80 text-[0.62rem] mt-1.5 font-semibold max-w-[68px] truncate">{hl.label}</span>
              </button>
            ))}
          </div>

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
                  className="ig-reel-tile relative aspect-[9/14] overflow-hidden bg-black/40 active:scale-95 transition-transform"
                >
                  {h.images?.[0] ? (
                    <img src={h.images[0]} alt={h.name} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-2xl opacity-50">🏨</div>
                  )}
                  <div className="absolute top-1 right-1 text-white text-[0.6rem] flex items-center gap-1">
                    <span>▶</span>
                    <span className="font-bold" style={{ textShadow: "0 1px 3px rgba(0,0,0,0.8)" }}>
                      {fmtCount(pseudoStat(h.id || h.name, "tile_views", 1200, 480000))}
                    </span>
                  </div>
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
                  className="ig-comment-input w-full rounded-full px-4 py-2 text-[0.82rem] outline-none"
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
  if (!open) return null;
  const sources: SourceType[] = ["all", "hotel", "creator", "public"];
  const cities = ["all", ...cityOptions];
  return (
    <div className="fixed inset-0 z-[88] flex items-end" onClick={onClose}>
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
          <button onClick={onClose} className="text-white/55 text-xl">✕</button>
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
          <div
            className="flex flex-wrap gap-1.5 overflow-y-auto pr-1"
            style={{ maxHeight: "32vh" }}
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
// Toast
// ─────────────────────────────────────────────────────────────────────────
function Toast({ msg }: { msg: string | null }) {
  if (!msg) return null;
  return (
    <div className="fixed top-16 left-1/2 -translate-x-1/2 z-[90] ig-toast">
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
  item, active, muted, onMuteToggle,
  onTrackEvent, onBook, onNegotiate, onShare, onOpenComments, onOpenMore, onCopyLink, onOpenEntity, onWatchEntity,
}: {
  item: Item;
  active: boolean;
  muted: boolean;
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
}) {
  const h = item.hotel;
  const images: string[] = (h.images || []).filter(Boolean);
  const videoSrc = videoForHotel(h);
  const creator = creatorFor(h);
  const hotelEntity = entityFromHotel(h);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [photoIdx, setPhotoIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const [liked, setLiked] = useState(false);
  const [saved, setSaved] = useState(false);
  const [hearts, setHearts] = useState<Heart[]>([]);
  const [showCaption, setShowCaption] = useState(false);
  const [followSparkle, setFollowSparkle] = useState(0);
  // Tap-on-avatar popover (Instagram-style "View Profile / Watch Reels")
  const [avatarMenu, setAvatarMenu] = useState<null | { kind: "hotel" | "creator" }>(null);
  const lastTapRef = useRef<{ t: number; x: number; y: number } | null>(null);
  const cardRef = useRef<HTMLElement | null>(null);

  // GLOBAL follow state — shared across cards, profile sheets, sub-chips
  const { isFollowing, toggleFollow, followerCount } = useFollow();
  const followed = isFollowing(hotelEntity.handle);
  const followersLive = followerCount(hotelEntity.handle);

  const initialLikes = pseudoStat(h.id || "x", "likes", 1240, 28400);
  const baseViews = pseudoStat(h.id || "x", "views", 14000, 580000);
  const comments = pseudoStat(h.id || "x", "comments", 38, 920);
  const [likeCount, setLikeCount] = useState(initialLikes);
  const [viewCount, setViewCount] = useState(baseViews);

  // Video play/pause sync with active state + ensure audio plays after unmute.
  // When a card scrolls out of view we reset currentTime so the next visit
  // restarts the reel (TikTok / Instagram behavior).
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = muted;
    if (!muted) v.volume = 1;
    if (active && !paused) {
      const p = v.play();
      if (p && typeof p.then === "function") p.catch(() => {});
    } else {
      v.pause();
      if (!active) {
        try { v.currentTime = 0; } catch {}
        if (paused) setPaused(false);
      }
    }
  }, [active, paused, muted]);

  // Slow Ken-Burns photo cycle as a fallback (only if no video src or video errors)
  const [videoBroken, setVideoBroken] = useState(false);
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
      style={{ height: "100dvh" }}
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
          src={videoSrc}
          poster={activeImg}
          loop
          autoPlay
          muted={muted}
          playsInline
          preload="auto"
          {...({ "webkit-playsinline": "true", "x-webkit-airplay": "allow" } as any)}
          className="absolute inset-0 w-full h-full"
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
          onError={() => setVideoBroken(true)}
          onClick={(e) => {
            // Tap on video:
            //   - if currently muted globally → UNMUTE (user gesture required)
            //   - else → toggle play/pause
            e.stopPropagation();
            const v = videoRef.current; if (!v) return;
            if (muted) { onMuteToggle(); return; }
            if (v.paused) { v.play().catch(()=>{}); setPaused(false); }
            else          { v.pause(); setPaused(true); }
          }}
        />
      )}
      {videoBroken && (activeImg ? (
        <img
          key={`${h.id}-${photoIdx}`}
          src={activeImg}
          alt={h.name}
          draggable={false}
          className="ig-kb absolute inset-0 w-full h-full object-cover"
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-7xl opacity-40"
          style={{ background: "linear-gradient(135deg,#1a1530,#0d1a2e)" }}>🏨</div>
      ))}

      {/* Pause overlay icon when video paused */}
      {paused && !videoBroken && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20">
          <div className="ig-pause-badge">▶</div>
        </div>
      )}

      {/* Top + bottom dark gradients */}
      <div className="absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-black/70 via-black/30 to-transparent pointer-events-none" />
      <div className="absolute inset-x-0 bottom-0 h-80 bg-gradient-to-t from-black/85 via-black/35 to-transparent pointer-events-none" />

      {/* Top-LEFT: hotel profile chip (pushed below brand chrome to avoid overlap).
          Avatar tap → popover (View Profile / Watch Reels).
          Name tap   → opens hotel profile sheet directly. */}
      <div className="absolute left-3 right-3 z-30 flex items-start gap-2.5" style={{ top: "60px" }}>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setAvatarMenu({ kind: "hotel" }); }}
          className="ig-avatar relative shrink-0"
          aria-label={`${h.name} profile options`}
        >
          <span className="ig-avatar-inner">
            {h.images?.[0] ? (
              <img src={h.images[0]} alt={h.name} className="w-full h-full object-cover rounded-full" />
            ) : (
              <span className="text-[0.78rem] font-bold text-black">{initials}</span>
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
              {(h.name || "Hotel").toLowerCase().replace(/\s+/g, "_").slice(0, 22)}
            </span>
            <span className="ig-verified" title="Verified hotel">✓</span>
          </button>
          <div className="mt-0.5 flex items-center gap-1.5 text-[0.62rem] text-white/75" style={{ textShadow: "0 1px 3px rgba(0,0,0,0.7)" }}>
            <span>📍 {h.city || "—"}</span>
            <span className="opacity-50">·</span>
            <span>{fmtCount(followersLive)} followers</span>
          </div>
          {/* Creator subline — who made this reel (taps open creator profile) */}
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
            <span className="text-white/90 text-[0.6rem] font-semibold">@{creator.handle}</span>
            {creator.verified && <span className="ig-verified" style={{ width: 10, height: 10, fontSize: 7 }}>✓</span>}
          </button>
        </div>
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
      </div>

      {/* Right action rail (Instagram Reels style) */}
      <div className="absolute right-2.5 z-30 flex flex-col items-center gap-4" style={{ bottom: "180px" }}>
        {/* Mute toggle (top of rail to avoid top-corner overlap) */}
        <button
          onClick={(e) => { e.stopPropagation(); onMuteToggle(); }}
          className="ig-rail-btn"
          aria-label={muted ? "Unmute" : "Mute"}
        >
          <span className="ig-icon">{muted ? "🔇" : "🔊"}</span>
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
          <span className={`ig-icon ${liked ? "ig-liked" : ""}`}>{liked ? "❤️" : "🤍"}</span>
          <span className="ig-rail-count">{fmtCount(likeCount)}</span>
        </button>
        <button
          aria-label="Comments"
          onClick={(e) => { e.stopPropagation(); onOpenComments(h); onTrackEvent?.("ig_comment_open", { hotelId: h.id }); }}
          className="ig-rail-btn"
        >
          <span className="ig-icon">💬</span>
          <span className="ig-rail-count">{fmtCount(comments)}</span>
        </button>
        <button
          aria-label="Share"
          onClick={(e) => { e.stopPropagation(); onShare(h); }}
          className="ig-rail-btn"
        >
          <span className="ig-icon">↗</span>
          <span className="ig-rail-count">Share</span>
        </button>
        <button
          aria-label="Save"
          onClick={(e) => { e.stopPropagation(); setSaved((s) => !s); onTrackEvent?.("ig_save", { hotelId: h.id, save: !saved }); }}
          className="ig-rail-btn"
        >
          <span className="ig-icon">{saved ? "🔖" : "📑"}</span>
          <span className="ig-rail-count">{saved ? "Saved" : "Save"}</span>
        </button>
        <button
          aria-label="More"
          onClick={(e) => { e.stopPropagation(); onOpenMore(h); }}
          className="ig-rail-btn"
        >
          <span className="ig-icon">⋯</span>
          <span className="ig-rail-count">More</span>
        </button>

        {/* Audio disc (rotating) */}
        <div className="ig-disc">
          {h.images?.[0] ? <img src={h.images[0]} alt="" className="w-full h-full object-cover rounded-full" /> : <span className="text-[0.7rem]">🎵</span>}
        </div>
      </div>

      {/* BOTTOM-LEFT: caption + price + equal CTAs */}
      <div className="absolute left-3 right-20 z-30" style={{ bottom: "20px" }}>
        <div className="flex items-center gap-2 mb-2 flex-wrap">
          {h.starRating > 0 && <span className="ig-pill ig-pill-gold">{"★".repeat(Math.min(h.starRating, 5))}</span>}
          {h.avgRating > 0 && <span className="ig-pill">★ {Number(h.avgRating).toFixed(1)}</span>}
          <span className="ig-pill ig-pill-live"><span className="ig-dot" /> LIVE BIDDING</span>
          <span className="ig-pill">{fmtCount(viewCount)} views</span>
        </div>

        <h3 className="text-white font-semibold text-[1.05rem] leading-tight mb-1" style={{ textShadow: "0 2px 6px rgba(0,0,0,0.8)" }}>
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

        <div className="ig-audio-strip">
          <span className="ig-audio-icon">🎵</span>
          <span className="ig-audio-text">
            Original audio · {h.name} · StayBid Live · Real-time room availability
          </span>
        </div>

        {/* Price + EQUAL 3D translucent CTAs */}
        <div className="mt-3 flex items-end gap-2">
          <div className="flex flex-col leading-none mr-1 shrink-0">
            <span className="text-white/55 text-[0.55rem] uppercase tracking-widest">From</span>
            <span className="text-white font-bold text-[1.1rem]">
              ₹{(h.minPrice || h.rooms?.[0]?.floorPrice || 0).toLocaleString()}
              <span className="text-white/55 text-[0.7rem] font-normal ml-1">/n</span>
            </span>
          </div>
          <button onClick={(e) => { e.stopPropagation(); onBook(h); }} className="ig-cta-3d ig-cta-book">
            <span className="ig-cta-icon">⚡</span>
            <span className="ig-cta-text">Book Now</span>
          </button>
          <button onClick={(e) => { e.stopPropagation(); onNegotiate(h); }} className="ig-cta-3d ig-cta-bid">
            <span className="ig-cta-icon">💬</span>
            <span className="ig-cta-text">Bid</span>
          </button>
        </div>
      </div>

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
// Feed
// ─────────────────────────────────────────────────────────────────────────
export default function InstagramHotelFeed({ items, onIndexChange, onLoadMore, onTrackEvent }: Props) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  // ── GLOBAL mute state — same source for every reel + the rail button.
  const { isMuted, hasInteracted, toggleMute } = useSoundStore();
  const muted = isMuted;
  const [commentsOpen, setCommentsOpen] = useState<{ open: boolean; name: string }>({ open: false, name: "" });
  const [moreOpen, setMoreOpen] = useState<{ open: boolean; id: string }>({ open: false, id: "" });
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
  }, []);
  const persistFilter = useCallback((src: SourceType, c: string) => {
    setFilterSource(src);
    setFilterCity(c);
    try {
      localStorage.setItem("sb_reel_filter_source", src);
      localStorage.setItem("sb_reel_filter_city", c);
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

  // Apply filter
  let filteredItems = items.filter((it) => {
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

  // When filter changes, reset scroll to top
  useEffect(() => {
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

  const handleBook = useCallback((h: any) => {
    onTrackEvent?.("ig_click_book", { hotelId: h.id });
    router.push(`/hotels/${h.id}?intent=book#availability-picker`);
  }, [router, onTrackEvent]);
  const handleNegotiate = useCallback((h: any) => {
    onTrackEvent?.("ig_click_bid", { hotelId: h.id });
    router.push(`/hotels/${h.id}?intent=negotiate#availability-picker`);
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
        .ig-feed {
          height: 100dvh;
          width: 100vw;
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
        .ig-card { scroll-snap-align: start; scroll-snap-stop: always; }

        /* Filter chip (top-left of reel feed) */
        .ig-filter-chip {
          position: fixed;
          top: 10px;
          left: 12px;
          z-index: 41;
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 6px 11px;
          border-radius: 9999px;
          color: #fff;
          background: linear-gradient(135deg, rgba(255,69,141,0.30), rgba(185,100,255,0.18));
          border: 1px solid rgba(255,255,255,0.25);
          backdrop-filter: blur(14px) saturate(1.4);
          -webkit-backdrop-filter: blur(14px) saturate(1.4);
          box-shadow: 0 4px 12px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.20);
          transition: transform 0.12s ease;
        }
        .ig-filter-chip:active { transform: scale(0.94); }

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

        .ig-avatar {
          width: 42px; height: 42px; display: inline-block;
          padding: 2px; border-radius: 9999px;
          background: conic-gradient(from 220deg, #f0b429, #ff458d, #b964ff, #f0b429);
          animation: igRingPulse 2.6s ease-in-out infinite;
        }
        .ig-avatar-inner {
          display: flex; align-items: center; justify-content: center;
          width: 100%; height: 100%; border-radius: 9999px;
          background: linear-gradient(135deg,#ffd76b,#f0b429);
          border: 2px solid #000; overflow: hidden;
        }
        .ig-verified {
          display: inline-flex; align-items: center; justify-content: center;
          width: 14px; height: 14px; border-radius: 9999px;
          background: linear-gradient(135deg,#3ea0ff,#1a78d6);
          color: #fff; font-size: 9px; font-weight: 900;
          box-shadow: 0 1px 3px rgba(0,0,0,0.5);
        }

        /* ─── 3D Follow button ────────────────────────────────────────────── */
        .ig-follow-3d {
          position: relative; isolation: isolate;
          padding: 6px 16px; border-radius: 11px;
          font-size: 0.74rem; font-weight: 800;
          letter-spacing: 0.02em;
          color: #1a1208;
          background: linear-gradient(180deg,#ffe28a 0%,#f0b429 35%,#d99a16 70%,#a26b08 100%);
          border: 1px solid rgba(255,255,255,0.55);
          text-shadow: 0 1px 0 rgba(255,255,255,0.45);
          box-shadow:
            0 0 14px rgba(240,180,41,0.45),
            0 8px 16px -3px rgba(160,110,8,0.55),
            0 3px 6px -1px rgba(0,0,0,0.4),
            inset 0 1.5px 0 rgba(255,255,255,0.75),
            inset 0 -2px 0 rgba(110,70,5,0.55),
            inset 0 0 0 1px rgba(255,255,255,0.18);
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

        /* ─── Right rail ──────────────────────────────────────────────────── */
        .ig-rail-btn {
          display: flex; flex-direction: column; align-items: center;
          gap: 3px; color: #fff; font-size: 0.62rem; font-weight: 700;
          text-shadow: 0 1px 3px rgba(0,0,0,0.7);
          transition: transform 0.12s ease;
        }
        .ig-rail-btn:active { transform: scale(0.86); }
        .ig-icon {
          font-size: 1.7rem; line-height: 1;
          filter: drop-shadow(0 2px 4px rgba(0,0,0,0.6));
        }
        .ig-liked { animation: igLikePop 0.4s ease-out; }
        .ig-rail-count { font-size: 0.6rem; font-weight: 700; letter-spacing: 0.02em; }

        .ig-disc {
          width: 36px; height: 36px; border-radius: 9999px;
          background: linear-gradient(135deg,#1a1530,#0d1a2e);
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
          background: rgba(255,255,255,0.14);
          border: 1px solid rgba(255,255,255,0.22);
          color: #fff;
          backdrop-filter: blur(6px);
          -webkit-backdrop-filter: blur(6px);
          text-shadow: 0 1px 2px rgba(0,0,0,0.5);
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
        .ig-cta-bid {
          color: #f3e6ff;
          background:
            radial-gradient(120% 120% at 30% 0%, rgba(199,140,255,0.45), rgba(199,140,255,0) 45%),
            linear-gradient(180deg, rgba(155,109,255,0.40) 0%, rgba(94,52,184,0.35) 60%, rgba(40,16,95,0.45) 100%);
          border: 1px solid rgba(199,140,255,0.55);
          text-shadow: 0 1px 4px rgba(0,0,0,0.6);
          box-shadow:
            0 0 18px rgba(155,109,255,0.35),
            0 10px 24px -5px rgba(60,28,140,0.55),
            0 3px 8px rgba(0,0,0,0.4),
            inset 0 1.5px 0 rgba(255,255,255,0.30),
            inset 0 -1px 0 rgba(20,8,55,0.45);
        }

        /* ─── Hearts (love bomb on like/double-tap) ──────────────────────── */
        .ig-heart {
          position: absolute;
          z-index: 50;
          pointer-events: none;
          filter: drop-shadow(0 4px 10px rgba(255,69,141,0.55));
          animation: igHeartFly var(--dur,1500ms) cubic-bezier(0.22,0.85,0.3,1) forwards;
          will-change: transform, opacity;
          transform: translate(-50%,-50%) scale(0.6);
        }

        /* ─── Drawers + toast ─────────────────────────────────────────────── */
        .ig-drawer-up { animation: igDrawerUp 0.32s cubic-bezier(0.3,1,0.3,1) both; }
        .ig-toast { animation: igToastIn 2.2s ease forwards; }
      `}</style>

      {/* ── Filter chip — top-LEFT, shows current filter; tap to open sheet ── */}
      <button
        onClick={() => setFilterOpen(true)}
        className="ig-filter-chip"
        aria-label="Open reel filters"
      >
        <span className="text-base leading-none">{SOURCE_ICON[filterSource]}</span>
        <span className="text-[0.66rem] font-bold tracking-wide">
          {SOURCE_LABEL[filterSource]}
        </span>
        <span className="opacity-50">·</span>
        <span className="text-[0.66rem] font-semibold">
          📍 {filterCity === "all" ? "All India" : filterCity}
        </span>
        <span className="opacity-60">▾</span>
      </button>

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

      <div ref={containerRef} className="ig-feed">
        {filteredItems.map((it, i) => (
          <HotelCard
            key={it.hotel.id || i}
            item={it}
            active={i === activeIdx}
            muted={muted}
            onMuteToggle={toggleMute}
            onTrackEvent={onTrackEvent}
            onBook={handleBook}
            onNegotiate={handleNegotiate}
            onShare={handleShare}
            onCopyLink={handleCopyLink}
            onOpenComments={(h) => setCommentsOpen({ open: true, name: h.name })}
            onOpenMore={(h) => setMoreOpen({ open: true, id: h.id })}
            onOpenEntity={(e) => setCreatorOpen(e)}
            onWatchEntity={handleWatchEntity}
          />
        ))}
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
        onClose={() => setCommentsOpen({ open: false, name: "" })}
        hotelName={commentsOpen.name}
        onMaskedToast={showToast}
      />
      <MoreMenu
        open={moreOpen.open}
        onClose={() => setMoreOpen({ open: false, id: "" })}
        hotelId={moreOpen.id}
        muted={muted}
        onToggleMute={toggleMute}
        onShare={() => {
          const it = items.find((x) => x.hotel.id === moreOpen.id);
          if (it) handleShare(it.hotel);
        }}
        onCopy={() => {
          const it = items.find((x) => x.hotel.id === moreOpen.id);
          if (it) handleCopyLink(it.hotel);
        }}
      />
      <CreatorProfileSheet
        open={!!creatorOpen}
        onClose={() => setCreatorOpen(null)}
        creator={creatorOpen}
        hotels={items.map((it) => it.hotel)}
        onPickReel={scrollToHotel}
        onApplyHighlight={handleApplyHighlight}
      />

      {/* First-load: prompt user to tap & unmute. Once they've ever toggled
          mute (hasInteracted=true) we never show this again. Tapping it
          immediately unmutes (which is the user gesture browsers require). */}
      {muted && !hasInteracted && items.length > 0 && (
        <button
          className="ig-unmute-hint"
          onClick={() => { toggleMute(); onTrackEvent?.("ig_first_unmute", {}); }}
          aria-label="Tap to unmute reels"
        >
          <span className="ig-unmute-icon">🔇</span>
          <span>Tap to unmute</span>
        </button>
      )}

      <Toast msg={toast} />
    </>
  );
}
