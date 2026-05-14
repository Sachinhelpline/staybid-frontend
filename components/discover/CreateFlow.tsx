"use client";
// ═══════════════════════════════════════════════════════════════════════════
// CreateFlow — Instagram-style "+" upload flow on the Reels home.
// Posts are committed to PostsStore (lib/posts-store) which the feed reads
// reactively, so a new upload appears at the top of the feed instantly.
// Three entry types: Reel · Photo · Story. Each runs the same composer:
//   1. Pick media file (input type=file)
//   2. Preview + caption + emoji bar + tags + audio picker
//   3. Post → saved to localStorage `sb_user_posts` + toast confirmation
// Audio picker has 3 sources:
//   • Original (use the media file's own audio)
//   • Library  (8 royalty-free tracks)
//   • Upload   (audio file from device — uses createObjectURL, never leaves
//                 the browser; no backend storage)
// ═══════════════════════════════════════════════════════════════════════════
import { useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { usePosts, type UserPost as StoreUserPost } from "@/lib/posts-store";
import { useFollow } from "@/lib/follow-store";
import { api } from "@/lib/api";
// v110 — durable post persistence. Local PostsStore commit keeps the
// just-posted feel, but we ALSO upload to Supabase Storage + insert a
// social_posts row so the post survives blob death (tab close, hard
// reload, logout, device switch). See post() handler below.
import { uploadSocialMedia, uploadSocialAudio } from "@/lib/social/storage-upload";
import { compressVideo } from "@/lib/social/video-compress";
import {
  mergeVideos,
  isMergeSupported,
  extractMergedPoster,
  MergeUnsupportedError,
  type MergeProgress,
} from "@/lib/social/video-merge";
import { notify } from "@/lib/notifications";

// v117 — additional video clips attached after the primary file. Index 0
// of the merge order is always the primary `mediaFile`; entries here are
// concatenated AFTER it in the order shown. Each carries its own object URL
// so the clip-strip thumbnails render without re-creating blobs on every
// re-render. Caller is responsible for revoking the URLs (we revoke on
// remove + on composer close).
type ClipAttachment = {
  id: string;
  file: File;
  url: string;
};

// ─── Music library — honest, royalty-free, CORS-clean ────────────────────
// Tracks are SoundHelix's free demo set, every URL has been stable for
// years and plays reliably across browsers. Earlier we labelled tracks
// with names like "Royal Sitar" / "Mumbai Nights" / "Festival Drive" to
// fake a Bollywood category — they don't actually contain Indian music
// and the user noticed. Names + categories are now accurate.
//
// Real Bollywood / licensed pop music can't legally ship inside a
// reel-feed app without a music licence (PPL / IPRS / Saregama / etc.).
// The honest path for that content is the "Upload from device" flow —
// the user picks the actual song they own from their phone.
export type AudioCategory = "trending" | "india" | "cinematic" | "lofi" | "energy";

export const AUDIO_LIBRARY: (AudioTrack & { category: AudioCategory })[] = [
  // ── Trending (energetic electronica) ──
  { id: "sh1",  name: "Cascade",         artist: "SoundHelix", emoji: "🎧", category: "trending",  url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3"  },
  { id: "sh2",  name: "Skyline",         artist: "SoundHelix", emoji: "🌆", category: "trending",  url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3"  },
  { id: "sh10", name: "Lift",            artist: "SoundHelix", emoji: "✨", category: "trending",  url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-10.mp3" },
  { id: "sh11", name: "Momentum",        artist: "SoundHelix", emoji: "⚡", category: "trending",  url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-11.mp3" },
  // ── Cinematic ──
  { id: "sh4",  name: "Sunrise",         artist: "SoundHelix", emoji: "🌅", category: "cinematic", url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-4.mp3"  },
  { id: "sh6",  name: "Piano Reflect",   artist: "SoundHelix", emoji: "🎹", category: "cinematic", url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-6.mp3"  },
  { id: "sh15", name: "Wide Horizon",    artist: "SoundHelix", emoji: "🏔", category: "cinematic", url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-15.mp3" },
  { id: "sh12", name: "Open Sky",        artist: "SoundHelix", emoji: "☁️", category: "cinematic", url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-12.mp3" },
  // ── Lo-fi / chill ──
  { id: "sh9",  name: "Night Drive",     artist: "SoundHelix", emoji: "🌙", category: "lofi",      url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-9.mp3"  },
  { id: "sh8",  name: "Paradise",        artist: "SoundHelix", emoji: "🌴", category: "lofi",      url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-8.mp3"  },
  { id: "sh13", name: "Slow Pulse",      artist: "SoundHelix", emoji: "💜", category: "lofi",      url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-13.mp3" },
  // ── Energy / EDM ──
  { id: "sh3",  name: "Drive",           artist: "SoundHelix", emoji: "🏎", category: "energy",    url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3"  },
  { id: "sh5",  name: "Tropical Pulse",  artist: "SoundHelix", emoji: "🏝", category: "energy",    url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-5.mp3"  },
  { id: "sh7",  name: "Crowd Anthem",    artist: "SoundHelix", emoji: "🎤", category: "energy",    url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-7.mp3"  },
  { id: "sh14", name: "Big Room",        artist: "SoundHelix", emoji: "🎛", category: "energy",    url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-14.mp3" },
  { id: "sh16", name: "Pulse Beat",      artist: "SoundHelix", emoji: "🔥", category: "energy",    url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-16.mp3" },
];

export const AUDIO_CATEGORIES: { id: AudioCategory; label: string; emoji: string }[] = [
  { id: "trending",  label: "Trending",      emoji: "🔥" },
  { id: "india",     label: "India / Bolly", emoji: "🪕" },
  { id: "cinematic", label: "Cinematic",     emoji: "🎬" },
  { id: "lofi",      label: "Lo-fi",         emoji: "🌙" },
  { id: "energy",    label: "Energy",        emoji: "⚡" },
];

export type AudioTrack = {
  id: string;
  name: string;
  artist: string;
  url: string;
  emoji?: string;
};

export type ContentKind = "reel" | "photo" | "story";

export type UserPost = {
  id: string;
  kind: ContentKind;
  mediaUrl: string;
  mediaMime: string;
  /** First-frame JPEG data-URL captured at upload time (~30-80 KB).
      Survives blob-URL death; serves as <video poster=…> + grid thumb. */
  posterUrl?: string;
  caption: string;
  tags: string[];
  audio: { name: string; url: string } | null;
  /** Optional location attached at post time. Picked via LocationPicker
      (GPS detect / Nominatim search / popular city chips). */
  location?: Location | null;
  /** Optional tagged StayBid hotel — picked from the HotelPicker. Surfaces
      a "🏨 At {Hotel}" pill in the feed and routes Book/Bid on the post
      to that hotel page. */
  taggedHotel?: TaggedHotel | null;
  /** Optional highlight bucket — built-in (mountains/beaches/foodie/suites/
      toppicks/solo) or user-created custom one. Drives the highlight grid
      filter on the user's profile sheet. */
  highlight?: { key: string; label: string; emoji: string; custom?: boolean } | null;
  /** Story-only — auto-expire timestamp (createdAt + 24h). */
  storyExpiresAt?: number;
  /** Story-only — when on, the story also surfaces in the feed and
      survives past 24h. */
  keepAsPost?: boolean;
  /** v114 — Chosen IG-style CSS filter preset id (e.g. "warm", "noir").
      Applied on the preview AND replayed in the feed via filterCssFor(). */
  filter?: string | null;
  createdAt: number;
};

export type TaggedHotel = { id: string; name: string; city?: string; image?: string };

// Common emoji set used across the composer
const EMOJI_BAR = ["❤️", "🔥", "✨", "😍", "🥳", "🌄", "🛏", "🍴", "📍", "🌟", "🌊", "☀️", "🌙", "🎵", "🙏"];

/**
 * Best-effort first-frame capture from any browser-decodable video.
 * Returns a JPEG data-URL or "" if the codec couldn't decode at all
 * (e.g. iPhone HEVC on Chromium). The data-URL is small (~30–80 KB) so
 * it survives localStorage and works as a poster image even after the
 * blob URL dies on hard reload — that's the "bulletproof" angle.
 *
 * For browsers that decode the file (most MP4 / H.264 videos), this
 * also gives us a meaningful thumbnail BEFORE the user posts, so the
 * profile grid never has to render a video element at all.
 */
async function extractVideoThumbnail(file: File, atSecond?: number): Promise<string> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (v: string) => { if (!settled) { settled = true; resolve(v); } };
    let tempUrl = "";
    try {
      tempUrl = URL.createObjectURL(file);
      const v = document.createElement("video");
      v.preload = "auto";
      v.muted = true;
      v.playsInline = true;
      (v as any).webkitPlaysInline = true;
      v.src = tempUrl;
      v.onloadedmetadata = () => {
        // v114 — pass `atSecond` to scrub to a specific time; otherwise pick
        // a meaningful frame (first 0.6s are usually black on phone shots).
        const dur = v.duration || 1;
        const target = atSecond != null
          ? Math.max(0, Math.min(dur - 0.05, atSecond))
          : Math.min(0.6, dur / 4);
        try { v.currentTime = target; } catch {}
      };
      v.onseeked = () => {
        try {
          const canvas = document.createElement("canvas");
          // Scale down — 720px is plenty for a poster thumbnail.
          const w = v.videoWidth || 720;
          const h = v.videoHeight || 1280;
          const scale = Math.min(1, 720 / Math.max(w, h));
          canvas.width  = Math.max(1, Math.round(w * scale));
          canvas.height = Math.max(1, Math.round(h * scale));
          const ctx = canvas.getContext("2d");
          if (ctx) {
            ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
            const data = canvas.toDataURL("image/jpeg", 0.72);
            finish(data);
          } else {
            finish("");
          }
        } catch { finish(""); }
        finally { try { URL.revokeObjectURL(tempUrl); } catch {} }
      };
      v.onerror = () => {
        try { URL.revokeObjectURL(tempUrl); } catch {}
        finish("");
      };
      // Hard timeout — if metadata never loads we just give up.
      setTimeout(() => {
        try { URL.revokeObjectURL(tempUrl); } catch {}
        finish("");
      }, 4000);
    } catch {
      finish("");
    }
  });
}

const TAG_PRESETS = ["TravelDiaries", "LuxuryStay", "BudgetTrip", "Foodie", "Mountains", "Beaches", "Solo", "Couple", "Family", "WeekendGetaway", "StayBidLife", "VerifiedStay"];

// v114 — IG-style filter presets. CSS-only (no canvas re-encode yet) so it
// works on every device and reflects instantly on the preview. Each post
// persists the chosen `filter` key in PostsStore and on social_posts as
// metadata; the feed renders the matching CSS on the active card so the
// look you previewed is what viewers see.
export const FILTER_PRESETS: { id: string; label: string; css: string }[] = [
  { id: "none",       label: "Original",   css: "none" },
  { id: "warm",       label: "Warm",       css: "saturate(1.15) contrast(1.04) sepia(0.10)" },
  { id: "cool",       label: "Cool",       css: "saturate(1.08) contrast(1.05) hue-rotate(-8deg) brightness(1.02)" },
  { id: "vivid",      label: "Vivid",      css: "saturate(1.45) contrast(1.10)" },
  { id: "vintage",    label: "Vintage",    css: "sepia(0.30) contrast(0.95) saturate(0.90) brightness(1.04)" },
  { id: "mono",       label: "Mono",       css: "grayscale(1) contrast(1.10)" },
  { id: "noir",       label: "Noir",       css: "grayscale(1) contrast(1.35) brightness(0.92)" },
  { id: "dreamy",     label: "Dreamy",     css: "blur(0.4px) saturate(1.15) brightness(1.06)" },
  { id: "cinematic",  label: "Cinematic",  css: "contrast(1.20) saturate(0.92) brightness(0.96)" },
  { id: "honey",      label: "Honey",      css: "saturate(1.20) hue-rotate(-12deg) brightness(1.05) sepia(0.18)" },
  { id: "azure",      label: "Azure",      css: "hue-rotate(12deg) saturate(1.10) brightness(1.04)" },
  { id: "fade",       label: "Fade",       css: "contrast(0.88) saturate(0.85) brightness(1.06)" },
];

export function filterCssFor(filterId?: string | null): string {
  if (!filterId) return "none";
  const f = FILTER_PRESETS.find(x => x.id === filterId);
  return f?.css || "none";
}

// ─── Plus FAB (entry button) ─────────────────────────────────────────────
export function CreateFAB({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-label="Create new post"
      className="ig-create-fab"
    >
      <span className="ig-create-fab-plus">＋</span>
      <span className="ig-create-fab-glow" aria-hidden />
    </button>
  );
}

// ─── Main Create entry sheet (3 cards: Reel / Photo / Story) ─────────────
export function CreateSheet({
  open, onClose, onPick,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (kind: ContentKind) => void;
}) {
  // v115 — flag body so the BottomDock hides while the entry sheet is open.
  // Before v115 the Story card sat behind the dock (visible cut-off in user
  // screenshot). The Composer already does this via `sb-composer-open`; we
  // reuse the same class here so dock hides for BOTH the entry sheet AND
  // the composer. (The composer already lives at a higher z, this is purely
  // to clear the 60px-tall dock at the bottom of the viewport.)
  useEffect(() => {
    if (!open) return;
    document.body.classList.add("sb-composer-open");
    return () => { document.body.classList.remove("sb-composer-open"); };
  }, [open]);

  if (!open) return null;
  const cards: { kind: ContentKind; emoji: string; title: string; sub: string; gradient: string }[] = [
    { kind: "reel",  emoji: "🎬", title: "Reel",  sub: "Up to 60s vertical video · with audio, tags & emojis",  gradient: "linear-gradient(135deg,#ff458d,#b964ff)" },
    { kind: "photo", emoji: "📷", title: "Photo", sub: "Single image post · caption · tag a hotel · emojis",     gradient: "linear-gradient(135deg,#ffd76b,#f0b429)" },
    { kind: "story", emoji: "📖", title: "Story", sub: "24h disappearing photo or video · audio overlay",        gradient: "linear-gradient(135deg,#3ea0ff,#1a78d6)" },
  ];
  return (
    <div className="fixed inset-0 z-[90] flex items-end" onClick={onClose}>
      <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.65)", backdropFilter: "blur(6px)" }} />
      <div
        className="relative w-full ig-drawer-up"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "linear-gradient(180deg,#15101e 0%,#0a0612 100%)",
          borderTopLeftRadius: 24, borderTopRightRadius: 24,
          borderTop: "1px solid rgba(255,255,255,0.12)",
          boxShadow: "0 -20px 60px rgba(0,0,0,0.7)",
          paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 18px)",
        }}
      >
        <div className="flex justify-center pt-2.5 pb-1.5"><div className="w-10 h-[3px] rounded-full bg-white/30" /></div>
        <div className="flex items-center justify-between px-5 pb-2">
          <p className="text-white font-semibold text-[0.92rem]">Create</p>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onClose(); }}
            onTouchEnd={(e) => { e.stopPropagation(); onClose(); }}
            style={{
              position: "relative", zIndex: 5,
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              width: 36, height: 36, borderRadius: 9999,
              background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.12)",
              color: "rgba(255,255,255,0.85)", fontSize: "1.15rem",
              pointerEvents: "auto",
            }}
            aria-label="Close"
          >✕</button>
        </div>
        <div className="px-4 pt-2 space-y-2.5">
          {cards.map((c) => (
            <button
              key={c.kind}
              onClick={() => onPick(c.kind)}
              className="w-full flex items-center gap-3 p-3 rounded-2xl text-left active:scale-[0.98] transition-transform"
              style={{
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.10)",
              }}
            >
              <div
                className="w-12 h-12 rounded-2xl flex items-center justify-center text-2xl shrink-0"
                style={{ background: c.gradient, boxShadow: "0 4px 14px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.35)" }}
              >
                {c.emoji}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-white font-semibold text-[0.92rem]">{c.title}</p>
                <p className="text-white/55 text-[0.66rem] mt-0.5">{c.sub}</p>
              </div>
              <span className="text-white/45 text-xl">›</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Location Picker — modern: GPS detect + Nominatim search + popular ───
// Uses HTML5 Geolocation for "use my current location" and OpenStreetMap
// Nominatim (no API key needed, free) for typeahead search.
//
// IMPORTANT: Nominatim's terms ask for a User-Agent and limit to ~1 req/sec.
// We debounce 350 ms and de-dupe in-flight queries so we stay well under.
export type Location = { name: string; lat?: number; lng?: number };

const POPULAR_CITIES: { name: string; emoji: string }[] = [
  { name: "Mumbai",    emoji: "🌊" }, { name: "New Delhi", emoji: "🏛" },
  { name: "Bangalore", emoji: "💻" }, { name: "Hyderabad", emoji: "🌶" },
  { name: "Chennai",   emoji: "🥥" }, { name: "Kolkata",   emoji: "🌉" },
  { name: "Pune",      emoji: "🎓" }, { name: "Goa",       emoji: "🏖" },
  { name: "Jaipur",    emoji: "🏰" }, { name: "Mussoorie", emoji: "🏔" },
  { name: "Manali",    emoji: "🌲" }, { name: "Rishikesh", emoji: "🛕" },
  { name: "Shimla",    emoji: "❄️" }, { name: "Udaipur",   emoji: "🛶" },
];

export function LocationPicker({
  open, onClose, current, onPick,
}: {
  open: boolean;
  onClose: () => void;
  current: Location | null;
  onPick: (loc: Location | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Array<{ display_name: string; lat: string; lon: string }>>([]);
  const [searching, setSearching] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [error, setError] = useState("");

  // Debounced Nominatim search
  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (q.length < 3) { setResults([]); return; }
    setSearching(true); setError("");
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const r = await fetch(
          `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=8&addressdetails=0`,
          { signal: ctl.signal, headers: { "Accept-Language": "en" } }
        );
        if (r.ok) setResults(await r.json());
        else setError("Search failed — try again");
      } catch (e: any) {
        if (e?.name !== "AbortError") setError("Network error — check connection");
      } finally { setSearching(false); }
    }, 350);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [query, open]);

  const detect = () => {
    if (!("geolocation" in navigator)) { setError("Geolocation not supported by this browser"); return; }
    setDetecting(true); setError("");
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const { latitude: lat, longitude: lng } = pos.coords;
          const r = await fetch(
            `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`,
            { headers: { "Accept-Language": "en" } }
          );
          const data = r.ok ? await r.json() : null;
          const name = data?.display_name?.split(",").slice(0, 2).join(",").trim() || `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
          onPick({ name, lat, lng });
          onClose();
        } catch {
          setError("Couldn't reverse-lookup the location.");
        } finally { setDetecting(false); }
      },
      (err) => {
        setDetecting(false);
        setError(err.code === 1 ? "Location permission denied" : "Couldn't get current location");
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 }
    );
  };

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[93] flex items-end" onClick={onClose}>
      <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(6px)" }} />
      <div
        className="relative w-full ig-drawer-up"
        onClick={(e) => e.stopPropagation()}
        style={{
          height: "84vh",
          background: "linear-gradient(180deg,#15101e 0%,#0a0612 100%)",
          borderTopLeftRadius: 24, borderTopRightRadius: 24,
          borderTop: "1px solid rgba(255,255,255,0.12)",
          boxShadow: "0 -20px 60px rgba(0,0,0,0.7)",
          display: "flex", flexDirection: "column",
        }}
      >
        <div className="flex justify-center pt-2.5 pb-1.5"><div className="w-10 h-[3px] rounded-full bg-white/30" /></div>
        <div className="flex items-center justify-between px-5 pb-2">
          <p className="text-white font-semibold text-[0.92rem]">📍 Add location</p>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onClose(); }}
            style={{
              position: "relative", zIndex: 5,
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              width: 36, height: 36, borderRadius: 9999,
              background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.12)",
              color: "rgba(255,255,255,0.85)", fontSize: "1.15rem",
              pointerEvents: "auto",
            }}
            aria-label="Close"
          >✕</button>
        </div>

        {/* Use my current location */}
        <div className="px-4 pb-2">
          <button
            type="button"
            onClick={detect}
            disabled={detecting}
            className="w-full flex items-center gap-3 px-3 py-3 rounded-xl active:scale-[0.99] transition-transform"
            style={{
              background: "linear-gradient(135deg, rgba(91,141,255,0.20), rgba(185,100,255,0.14))",
              border: "1px solid rgba(255,255,255,0.20)",
              color: "#fff",
            }}
          >
            <span className="text-2xl">{detecting ? "⏳" : "🎯"}</span>
            <span className="flex-1 text-left">
              <span className="block font-semibold text-[0.9rem]">
                {detecting ? "Detecting…" : "Use my current location"}
              </span>
              <span className="block text-white/60 text-[0.66rem]">
                Uses GPS / Wi-Fi positioning. Reverse-geocoded via OpenStreetMap.
              </span>
            </span>
          </button>
        </div>

        {/* Clear / current */}
        {current && (
          <div className="px-4 pb-2">
            <div
              className="flex items-center gap-3 px-3 py-2.5 rounded-xl"
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.10)" }}
            >
              <span className="text-base">📍</span>
              <span className="flex-1 text-white text-[0.84rem] truncate">{current.name}</span>
              <button onClick={() => { onPick(null); onClose(); }} className="text-red-300 text-[0.78rem] font-semibold">Clear</button>
            </div>
          </div>
        )}

        {/* Search */}
        <div className="px-4 pb-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search city, area, hotel, landmark…"
            className="w-full rounded-full px-4 py-2.5 text-[0.86rem] outline-none"
            style={{
              color: "#fff", caretColor: "#ffd76b",
              background: "rgba(255,255,255,0.10)",
              border: "1px solid rgba(255,255,255,0.20)",
            }}
            autoComplete="off"
          />
          {error && <p className="mt-1.5 text-amber-300 text-[0.7rem]">⚠ {error}</p>}
        </div>

        {/* Popular city chips */}
        {!query && (
          <div className="px-4 pb-2">
            <p className="text-white/55 text-[0.6rem] uppercase tracking-widest mb-1.5">Popular</p>
            <div className="flex flex-wrap gap-1.5">
              {POPULAR_CITIES.map((c) => (
                <button
                  key={c.name}
                  onClick={() => { onPick({ name: c.name }); onClose(); }}
                  className="px-3 py-1.5 rounded-full text-[0.74rem] font-semibold"
                  style={{
                    background: "rgba(255,255,255,0.06)",
                    border: "1px solid rgba(255,255,255,0.12)",
                    color: "rgba(255,255,255,0.92)",
                  }}
                >
                  {c.emoji} {c.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Results */}
        <div className="flex-1 overflow-y-auto px-2 pb-4">
          {searching && <p className="text-white/55 text-[0.78rem] text-center py-4">Searching…</p>}
          {!searching && query.trim().length >= 3 && results.length === 0 && !error && (
            <p className="text-white/45 text-[0.78rem] text-center py-6">No matches — try a different name</p>
          )}
          {results.map((r, i) => (
            <button
              key={`${r.lat}-${r.lon}-${i}`}
              onClick={() => {
                onPick({
                  name: r.display_name.split(",").slice(0, 3).join(",").trim(),
                  lat: parseFloat(r.lat),
                  lng: parseFloat(r.lon),
                });
                onClose();
              }}
              className="w-full text-left flex items-start gap-3 px-3 py-2.5 rounded-xl active:bg-white/8 transition-colors"
            >
              <span className="text-base mt-0.5">📍</span>
              <span className="flex-1 text-white/90 text-[0.82rem] leading-snug">{r.display_name}</span>
            </button>
          ))}
        </div>

        <p className="px-4 pb-2 text-white/35 text-[0.58rem] text-center">
          Powered by OpenStreetMap · No data leaves your device until you tap a place
        </p>
      </div>
    </div>
  );
}

// ─── Hotel Picker — search StayBid hotels and tag one to a post ──────────
// Pulls hotels from /api/hotels (Supabase-backed). Debounced search keeps
// load light; once tagged, the picked hotel surfaces in the feed as a
// "🏨 At {Hotel}" pill and the post inherits Book/Bid CTAs to that hotel
// — that's the "viewer can explore the hotel from the reel" UX.
export function HotelPicker({
  open, onClose, current, onPick,
}: {
  open: boolean;
  onClose: () => void;
  current: TaggedHotel | null;
  onPick: (hotel: TaggedHotel | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [hotels, setHotels] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Initial fetch (top hotels) + debounced search on query change
  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    setLoading(true); setError("");
    const t = setTimeout(async () => {
      try {
        const params: Record<string, string> = { limit: "30" };
        if (q.length >= 2) params.search = q;
        const data = await api.getHotels(params);
        const list = Array.isArray(data?.hotels) ? data.hotels : Array.isArray(data) ? data : [];
        setHotels(list);
      } catch (e: any) {
        setError(e?.message || "Couldn't load hotels");
        setHotels([]);
      } finally { setLoading(false); }
    }, q.length >= 2 ? 320 : 0);
    return () => clearTimeout(t);
  }, [open, query]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[93] flex items-end" onClick={onClose}>
      <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(6px)" }} />
      <div
        className="relative w-full ig-drawer-up"
        onClick={(e) => e.stopPropagation()}
        style={{
          height: "84vh",
          background: "linear-gradient(180deg,#15101e 0%,#0a0612 100%)",
          borderTopLeftRadius: 24, borderTopRightRadius: 24,
          borderTop: "1px solid rgba(255,255,255,0.12)",
          boxShadow: "0 -20px 60px rgba(0,0,0,0.7)",
          display: "flex", flexDirection: "column",
        }}
      >
        <div className="flex justify-center pt-2.5 pb-1.5"><div className="w-10 h-[3px] rounded-full bg-white/30" /></div>
        <div className="flex items-center justify-between px-5 pb-2">
          <p className="text-white font-semibold text-[0.92rem]">🏨 Tag a hotel</p>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onClose(); }}
            style={{
              position: "relative", zIndex: 5,
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              width: 36, height: 36, borderRadius: 9999,
              background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.12)",
              color: "rgba(255,255,255,0.85)", fontSize: "1.15rem",
              pointerEvents: "auto",
            }}
            aria-label="Close"
          >✕</button>
        </div>

        {/* Current tag (with Clear) */}
        {current && (
          <div className="px-4 pb-2">
            <div
              className="flex items-center gap-3 px-3 py-2.5 rounded-xl"
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.10)" }}
            >
              <span className="text-base">🏨</span>
              <span className="flex-1 min-w-0">
                <span className="block text-white text-[0.84rem] font-semibold truncate">{current.name}</span>
                {current.city && <span className="block text-white/55 text-[0.62rem] truncate">📍 {current.city}</span>}
              </span>
              <button onClick={() => { onPick(null); onClose(); }} className="text-red-300 text-[0.78rem] font-semibold">Clear</button>
            </div>
          </div>
        )}

        {/* Search */}
        <div className="px-4 pb-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search hotel name or city…"
            className="w-full rounded-full px-4 py-2.5 text-[0.86rem] outline-none"
            style={{
              color: "#fff", caretColor: "#ffd76b",
              background: "rgba(255,255,255,0.10)",
              border: "1px solid rgba(255,255,255,0.20)",
            }}
            autoComplete="off"
          />
          {error && <p className="mt-1.5 text-amber-300 text-[0.7rem]">⚠ {error}</p>}
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto px-2 pb-4">
          {loading && <p className="text-white/55 text-[0.78rem] text-center py-4">Loading hotels…</p>}
          {!loading && hotels.length === 0 && !error && (
            <p className="text-white/45 text-[0.78rem] text-center py-6">
              {query.trim() ? "No matches — try a different name" : "No hotels yet"}
            </p>
          )}
          {hotels.map((h) => {
            const img = (h.images && h.images[0]) || h.image || "";
            return (
              <button
                key={h.id}
                onClick={() => {
                  onPick({
                    id: String(h.id),
                    name: h.name || "Hotel",
                    city: h.city || "",
                    image: img || "",
                  });
                  onClose();
                }}
                className="w-full text-left flex items-center gap-3 px-3 py-2 rounded-xl active:bg-white/8 transition-colors"
              >
                <div
                  className="w-12 h-12 rounded-xl shrink-0 overflow-hidden flex items-center justify-center"
                  style={{ background: "linear-gradient(135deg,#1a1530,#0d1a2e)", border: "1px solid rgba(255,255,255,0.10)" }}
                >
                  {img ? (
                    <img src={img} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-xl">🏨</span>
                  )}
                </div>
                <span className="flex-1 min-w-0">
                  <span className="block text-white text-[0.86rem] font-semibold truncate">{h.name}</span>
                  <span className="block text-white/55 text-[0.66rem] truncate">
                    {h.city ? `📍 ${h.city}` : ""}
                    {h.starRating ? ` · ${"★".repeat(Math.min(5, Number(h.starRating)))}` : ""}
                  </span>
                </span>
                <span className="text-white/40 text-base">›</span>
              </button>
            );
          })}
        </div>

        <p className="px-4 pb-2 text-white/35 text-[0.58rem] text-center">
          Tagging a hotel lets viewers tap straight through to its profile and book or bid.
        </p>
      </div>
    </div>
  );
}

// ─── Profile editor — avatar, display name, bio, location, website + custom
// highlight management. NOTE: phone numbers are intentionally not editable
// here (anti-bypass + the phone is the auth identity, set via OTP, never
// surfaced as profile metadata). Avatar resizes to ≤256 px JPEG (~30 KB)
// so it fits localStorage's 5 MB ceiling.
export function ProfilePhotoEditor({
  open, onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const {
    myAvatarUrl, setMyAvatarUrl,
    myDisplayName, setMyDisplayName,
    myBio, setMyBio,
    myLocation, setMyLocation,
    myWebsite, setMyWebsite,
    myCustomHighlights, addCustomHighlight, removeCustomHighlight,
  } = useFollow();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [preview, setPreview] = useState<string>(myAvatarUrl);
  const [name, setName]       = useState<string>(myDisplayName === "You" ? "" : myDisplayName);
  const [bio, setBio]         = useState<string>(myBio);
  const [location, setLocation] = useState<string>(myLocation);
  const [website, setWebsite] = useState<string>(myWebsite);
  const [error, setError]     = useState("");
  const [hlLabel, setHlLabel] = useState("");
  const [hlEmoji, setHlEmoji] = useState("✨");

  useEffect(() => {
    if (open) {
      setPreview(myAvatarUrl);
      setName(myDisplayName === "You" ? "" : myDisplayName);
      setBio(myBio);
      setLocation(myLocation);
      setWebsite(myWebsite);
      setError("");
      setHlLabel("");
      setHlEmoji("✨");
    }
  }, [open, myAvatarUrl, myDisplayName, myBio, myLocation, myWebsite]);

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Please pick an image file.");
      return;
    }
    setError("");
    try {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        try {
          const max = 256;
          const scale = Math.min(1, max / Math.max(img.width, img.height));
          const w = Math.max(1, Math.round(img.width * scale));
          const h = Math.max(1, Math.round(img.height * scale));
          const canvas = document.createElement("canvas");
          canvas.width = w; canvas.height = h;
          const ctx = canvas.getContext("2d");
          if (!ctx) { setError("Couldn't process image."); return; }
          ctx.drawImage(img, 0, 0, w, h);
          const dataUrl = canvas.toDataURL("image/jpeg", 0.8);
          setPreview(dataUrl);
        } finally {
          try { URL.revokeObjectURL(url); } catch {}
        }
      };
      img.onerror = () => {
        setError("Couldn't load that image.");
        try { URL.revokeObjectURL(url); } catch {}
      };
      img.src = url;
    } catch {
      setError("Something went wrong reading the file.");
    }
  };

  // v110 — server-side persistence. Without this, the user's avatar +
  // display name + bio lived only in localStorage and disappeared after
  // re-login or device-switch. The flow:
  //   1) Apply locally immediately (instant-feel, never blocks the user)
  //   2) Upload avatar JPEG to Supabase Storage (avatars/<userId>/...)
  //   3) PATCH /api/social/profiles/me with the public avatar URL +
  //      display_name + bio (location + website stay local — those
  //      fields don't exist on social_profiles).
  //   4) Swap local avatar to the public URL so future re-logins
  //      hydrate from server and see exactly what was saved.
  // Errors surface as a quiet toast so the user isn't blocked — local
  // edits stay applied.
  const save = () => {
    const finalName    = name.trim() ? name.trim().slice(0, 32) : "You";
    const finalBio     = bio.trim().slice(0, 280);
    const finalAvatar  = preview || "";

    // 1) Apply locally (instant-feel)
    setMyAvatarUrl(finalAvatar);
    setMyDisplayName(finalName);
    setMyBio(finalBio);
    setMyLocation(location.trim().slice(0, 80));
    setMyWebsite(website.trim().slice(0, 120));
    onClose();

    // 2-4) Background server sync — never blocks the close.
    (async () => {
      try {
        const tok = (typeof window !== "undefined" && localStorage.getItem("sb_token")) || "";
        if (!tok) return;
        let userId = "";
        try {
          const payload = JSON.parse(atob(tok.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
          userId = payload.id || payload.user_id || payload.sub || "";
        } catch { /* malformed */ }
        if (!userId) return;

        // If the avatar is a data: URL, upload it as a JPEG blob to Storage
        // so the public URL becomes the durable source-of-truth.
        let avatarPublicUrl = finalAvatar;
        if (finalAvatar.startsWith("data:")) {
          try {
            const avatarBlob = await fetch(finalAvatar).then((r) => r.blob());
            const owner = userId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 32) || "anon";
            const path  = `avatars/${owner}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
            const SB    = "https://uxxhbdqedazpmvbvaosh.supabase.co";
            const SB_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV4eGhiZHFlZGF6cG12YnZhb3NoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxMTIwMDgsImV4cCI6MjA5MDY4ODAwOH0.mBhr1tNlail5u0D_dj3ljA9oRZvZ7_2_0-lt7I6cJ60";
            const upRes = await fetch(`${SB}/storage/v1/object/social-media/${path}`, {
              method: "POST",
              headers: {
                Authorization:  `Bearer ${SB_ANON}`,
                "Content-Type": "image/jpeg",
                "x-upsert":     "true",
              },
              body: avatarBlob,
            });
            if (upRes.ok) {
              avatarPublicUrl = `${SB}/storage/v1/object/public/social-media/${path}`;
              // Swap the local data-URL for the public URL so subsequent
              // re-logins hydrate from server-side and look identical.
              setMyAvatarUrl(avatarPublicUrl);
            }
          } catch { /* upload failed — keep local data-URL */ }
        }

        // PATCH the profile so re-login / cross-device works.
        await fetch("/api/social/profiles/me", {
          method:  "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization:  `Bearer ${tok}`,
          },
          body: JSON.stringify({
            avatar_url:   avatarPublicUrl,
            display_name: finalName,
            bio:          finalBio,
          }),
        });
      } catch { /* non-blocking — local edits already applied */ }
    })();
  };

  const addHighlight = () => {
    const label = hlLabel.trim();
    if (!label) return;
    const key = "custom-" + label.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 32);
    addCustomHighlight({ key, label: label.slice(0, 24), emoji: hlEmoji || "✨", custom: true });
    setHlLabel("");
    setHlEmoji("✨");
  };

  if (!open) return null;
  const initials = (name || myDisplayName || "Y").trim().slice(0, 1).toUpperCase();

  return (
    <div className="fixed inset-0 z-[94] flex items-end" onClick={onClose}>
      <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(6px)" }} />
      <div
        className="relative w-full ig-drawer-up"
        onClick={(e) => e.stopPropagation()}
        style={{
          height: "94vh",
          background: "linear-gradient(180deg,#15101e 0%,#0a0612 100%)",
          borderTopLeftRadius: 24, borderTopRightRadius: 24,
          borderTop: "1px solid rgba(255,255,255,0.12)",
          boxShadow: "0 -20px 60px rgba(0,0,0,0.7)",
          paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 18px)",
          display: "flex", flexDirection: "column",
        }}
      >
        <div className="flex justify-center pt-2.5 pb-1.5"><div className="w-10 h-[3px] rounded-full bg-white/30" /></div>
        <div className="flex items-center justify-between px-5 pb-2">
          <p className="text-white font-semibold text-[0.92rem]">✏️ Edit profile</p>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onClose(); }}
            style={{
              position: "relative", zIndex: 5,
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              width: 36, height: 36, borderRadius: 9999,
              background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.12)",
              color: "rgba(255,255,255,0.85)", fontSize: "1.15rem",
            }}
            aria-label="Close"
          >✕</button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 pb-4">
          {/* Avatar */}
          <div className="pt-2 pb-3 flex flex-col items-center">
            <div
              className="w-[120px] h-[120px] rounded-full p-[3px] shrink-0"
              style={{
                background: "conic-gradient(from 0deg, #f0b429, #ff458d, #b964ff, #f0b429)",
              }}
            >
              <div
                className="w-full h-full rounded-full flex items-center justify-center text-[2.4rem] font-bold overflow-hidden"
                style={{
                  background: "linear-gradient(135deg, #ff458d, #b964ff)",
                  border: "2px solid #000",
                  color: "#fff",
                  textShadow: "0 2px 6px rgba(0,0,0,0.5)",
                }}
              >
                {preview ? (
                  <img src={preview} alt="" className="w-full h-full object-cover" />
                ) : (
                  <span>{initials}</span>
                )}
              </div>
            </div>

            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="px-4 py-2 rounded-full text-[0.78rem] font-bold text-black"
                style={{ background: "linear-gradient(135deg,#ffd76b,#f0b429)", border: "1px solid rgba(255,255,255,0.45)" }}
              >
                📷 {preview ? "Change photo" : "Upload photo"}
              </button>
              {preview && (
                <button
                  type="button"
                  onClick={() => setPreview("")}
                  className="px-3 py-2 rounded-full text-[0.74rem] font-semibold text-red-300"
                  style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.15)" }}
                >
                  Remove
                </button>
              )}
            </div>
            <input ref={fileRef} type="file" accept="image/*" onChange={onFile} className="hidden" />
            {error && <p className="mt-2 text-amber-300 text-[0.72rem]">⚠ {error}</p>}
          </div>

          {/* Display name */}
          <div className="pb-3">
            <p className="text-white/55 text-[0.6rem] uppercase tracking-widest mb-1.5">Display name</p>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              maxLength={32}
              className="w-full rounded-xl px-3 py-2 text-[0.86rem] outline-none"
              style={{
                color: "#fff", caretColor: "#ffd76b",
                background: "rgba(255,255,255,0.10)",
                border: "1px solid rgba(255,255,255,0.20)",
              }}
            />
          </div>

          {/* Bio */}
          <div className="pb-3">
            <p className="text-white/55 text-[0.6rem] uppercase tracking-widest mb-1.5">Bio</p>
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="Travel storyteller · Mumbai · Always bidding for the best room"
              rows={3}
              maxLength={280}
              className="w-full rounded-xl px-3 py-2 text-[0.84rem] outline-none resize-none"
              style={{
                color: "#fff", caretColor: "#ffd76b",
                background: "rgba(255,255,255,0.10)",
                border: "1px solid rgba(255,255,255,0.20)",
                minHeight: 70,
              }}
            />
            <p className="text-white/40 text-[0.6rem] mt-1">
              🛡️ Phone numbers, emails and off-platform links are auto-scrubbed when shown.
            </p>
          </div>

          {/* Location */}
          <div className="pb-3">
            <p className="text-white/55 text-[0.6rem] uppercase tracking-widest mb-1.5">Location</p>
            <input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="📍 Mumbai, India"
              maxLength={80}
              className="w-full rounded-xl px-3 py-2 text-[0.84rem] outline-none"
              style={{
                color: "#fff", caretColor: "#ffd76b",
                background: "rgba(255,255,255,0.10)",
                border: "1px solid rgba(255,255,255,0.20)",
              }}
            />
          </div>

          {/* Website */}
          <div className="pb-3">
            <p className="text-white/55 text-[0.6rem] uppercase tracking-widest mb-1.5">Website</p>
            <input
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              placeholder="https://yourblog.com"
              maxLength={120}
              className="w-full rounded-xl px-3 py-2 text-[0.84rem] outline-none"
              style={{
                color: "#fff", caretColor: "#ffd76b",
                background: "rgba(255,255,255,0.10)",
                border: "1px solid rgba(255,255,255,0.20)",
              }}
            />
          </div>

          {/* Custom highlights manager */}
          <div className="pb-3">
            <p className="text-white/55 text-[0.6rem] uppercase tracking-widest mb-1.5">My highlights</p>
            <p className="text-white/55 text-[0.66rem] mb-2">
              Built-in highlights (Mountains, Beaches, Foodie, Suites, Top picks, Solo) are always shown. Add custom ones below — they appear on your profile alongside the built-ins.
            </p>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {myCustomHighlights.map((h) => (
                <span key={h.key}
                  className="inline-flex items-center gap-1 pl-2 pr-1 py-1 rounded-full text-[0.74rem] font-semibold"
                  style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.18)", color: "rgba(255,255,255,0.92)" }}
                >
                  <span>{h.emoji}</span>
                  <span>{h.label}</span>
                  <button
                    type="button"
                    onClick={() => removeCustomHighlight(h.key)}
                    className="ml-1 w-5 h-5 rounded-full flex items-center justify-center text-[0.7rem]"
                    style={{ background: "rgba(255,69,141,0.20)", color: "#ff8eb6" }}
                    aria-label={`Remove ${h.label}`}
                  >✕</button>
                </span>
              ))}
              {myCustomHighlights.length === 0 && (
                <span className="text-white/40 text-[0.7rem]">No custom highlights yet.</span>
              )}
            </div>
            <div className="flex gap-2 items-stretch">
              <input
                value={hlEmoji}
                onChange={(e) => setHlEmoji(e.target.value.slice(0, 4) || "✨")}
                maxLength={4}
                className="w-14 rounded-xl px-2 py-2 text-[0.86rem] outline-none text-center"
                style={{
                  color: "#fff", caretColor: "#ffd76b",
                  background: "rgba(255,255,255,0.10)",
                  border: "1px solid rgba(255,255,255,0.20)",
                }}
                aria-label="Highlight emoji"
              />
              <input
                value={hlLabel}
                onChange={(e) => setHlLabel(e.target.value)}
                placeholder="Highlight name (e.g. Goa 2026)"
                maxLength={24}
                className="flex-1 rounded-xl px-3 py-2 text-[0.84rem] outline-none"
                style={{
                  color: "#fff", caretColor: "#ffd76b",
                  background: "rgba(255,255,255,0.10)",
                  border: "1px solid rgba(255,255,255,0.20)",
                }}
              />
              <button
                type="button"
                onClick={addHighlight}
                disabled={!hlLabel.trim()}
                className="px-3 rounded-xl text-[0.78rem] font-bold text-black disabled:opacity-40"
                style={{ background: "linear-gradient(135deg,#ffd76b,#f0b429)", border: "1px solid rgba(255,255,255,0.45)" }}
              >
                + Add
              </button>
            </div>
          </div>
        </div>

        <div className="px-5 pt-1">
          <button
            onClick={save}
            className="ig-cta-3d ig-cta-book w-full"
            style={{ padding: "12px", fontSize: "0.86rem" }}
          >
            <span className="ig-cta-icon">✓</span>
            <span className="ig-cta-text">Save profile</span>
          </button>
        </div>

        <p className="px-5 pt-2 text-white/35 text-[0.58rem] text-center">
          Stays on your device · phone number stays hidden by design
        </p>
      </div>
    </div>
  );
}

// ─── Highlight picker — surfaced in the Composer so creators can drop a
// reel into the same buckets that show on their profile (Mountains/
// Beaches/Foodie/Suites/Top picks/Solo) plus any custom ones they've made.
// "+ New highlight" opens an inline create row.
export type HighlightTag = { key: string; label: string; emoji: string; custom?: boolean };

export function HighlightPicker({
  open, onClose, current, onPick,
}: {
  open: boolean;
  onClose: () => void;
  current: HighlightTag | null;
  onPick: (h: HighlightTag | null) => void;
}) {
  const { myCustomHighlights, addCustomHighlight } = useFollow();
  const [creating, setCreating] = useState(false);
  const [hlLabel, setHlLabel] = useState("");
  const [hlEmoji, setHlEmoji] = useState("✨");

  // Mirror the InstagramHotelFeed's HIGHLIGHTS so the user sees the same
  // chips here that they'll see on their profile.
  const builtins: HighlightTag[] = [
    { key: "mountains", label: "Mountains",  emoji: "🌄" },
    { key: "beaches",   label: "Beaches",    emoji: "🏖" },
    { key: "foodie",    label: "Foodie",     emoji: "🍜" },
    { key: "suites",    label: "Suites",     emoji: "🛏" },
    { key: "toppicks",  label: "Top picks",  emoji: "✨" },
    { key: "solo",      label: "Solo",       emoji: "🎒" },
  ];
  const all: HighlightTag[] = [
    ...builtins,
    ...myCustomHighlights.map((h) => ({ key: h.key, label: h.label, emoji: h.emoji, custom: true })),
  ];

  if (!open) return null;
  const create = () => {
    const label = hlLabel.trim();
    if (!label) return;
    const key = "custom-" + label.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 32);
    const h: HighlightTag = { key, label: label.slice(0, 24), emoji: hlEmoji || "✨", custom: true };
    addCustomHighlight(h);
    onPick(h);
    setCreating(false);
    setHlLabel("");
    setHlEmoji("✨");
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[93] flex items-end" onClick={onClose}>
      <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(6px)" }} />
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
          display: "flex", flexDirection: "column",
        }}
      >
        <div className="flex justify-center pt-2.5 pb-1.5"><div className="w-10 h-[3px] rounded-full bg-white/30" /></div>
        <div className="flex items-center justify-between px-5 pb-2">
          <p className="text-white font-semibold text-[0.92rem]">✨ Add to highlight</p>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onClose(); }}
            style={{
              position: "relative", zIndex: 5,
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              width: 36, height: 36, borderRadius: 9999,
              background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.12)",
              color: "rgba(255,255,255,0.85)", fontSize: "1.15rem",
            }}
            aria-label="Close"
          >✕</button>
        </div>

        {/* Current */}
        {current && (
          <div className="px-4 pb-2">
            <div
              className="flex items-center gap-3 px-3 py-2.5 rounded-xl"
              style={{ background: "linear-gradient(135deg, rgba(240,180,41,0.14), rgba(255,69,141,0.10))", border: "1px solid rgba(240,180,41,0.45)" }}
            >
              <span className="text-base">{current.emoji}</span>
              <span className="flex-1 text-white text-[0.84rem] font-semibold truncate">{current.label}</span>
              <button onClick={() => { onPick(null); onClose(); }} className="text-red-300 text-[0.78rem] font-semibold">Clear</button>
            </div>
          </div>
        )}

        {/* Built-in + custom highlight grid */}
        <div className="px-4 pb-2 grid grid-cols-3 gap-2 overflow-y-auto" style={{ maxHeight: "44vh" }}>
          {all.map((h) => {
            const active = current?.key === h.key;
            return (
              <button
                key={h.key}
                onClick={() => { onPick(h); onClose(); }}
                className="flex flex-col items-center justify-center py-3 rounded-2xl transition-transform active:scale-95"
                style={{
                  background: active
                    ? "linear-gradient(135deg, rgba(240,180,41,0.18), rgba(255,69,141,0.12))"
                    : "rgba(255,255,255,0.05)",
                  border: active ? "1px solid rgba(240,180,41,0.55)" : "1px solid rgba(255,255,255,0.10)",
                  boxShadow: active ? "0 4px 14px rgba(240,180,41,0.20)" : "none",
                }}
              >
                <div
                  className="w-12 h-12 rounded-full flex items-center justify-center text-2xl mb-1"
                  style={{ background: "linear-gradient(135deg,#1a1530,#0d1a2e)", border: "2px solid rgba(255,255,255,0.18)" }}
                >
                  {h.emoji}
                </div>
                <span className="text-white/90 text-[0.7rem] font-semibold truncate max-w-[90%]">{h.label}</span>
                {h.custom && <span className="text-white/40 text-[0.55rem] mt-0.5">custom</span>}
              </button>
            );
          })}
        </div>

        {/* Create new */}
        <div className="px-4 pt-2 pb-1 border-t border-white/8">
          {!creating ? (
            <button
              onClick={() => setCreating(true)}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-[0.84rem] font-bold text-black"
              style={{ background: "linear-gradient(135deg,#ffd76b,#f0b429)", border: "1px solid rgba(255,255,255,0.45)" }}
            >
              + New highlight
            </button>
          ) : (
            <div className="flex gap-2 items-stretch">
              <input
                value={hlEmoji}
                onChange={(e) => setHlEmoji(e.target.value.slice(0, 4) || "✨")}
                maxLength={4}
                className="w-14 rounded-xl px-2 py-2 text-[0.86rem] outline-none text-center"
                style={{
                  color: "#fff", caretColor: "#ffd76b",
                  background: "rgba(255,255,255,0.10)",
                  border: "1px solid rgba(255,255,255,0.20)",
                }}
                aria-label="Highlight emoji"
              />
              <input
                value={hlLabel}
                onChange={(e) => setHlLabel(e.target.value)}
                placeholder="Highlight name"
                maxLength={24}
                autoFocus
                className="flex-1 rounded-xl px-3 py-2 text-[0.84rem] outline-none"
                style={{
                  color: "#fff", caretColor: "#ffd76b",
                  background: "rgba(255,255,255,0.10)",
                  border: "1px solid rgba(255,255,255,0.20)",
                }}
              />
              <button
                onClick={create}
                disabled={!hlLabel.trim()}
                className="px-3 rounded-xl text-[0.78rem] font-bold text-black disabled:opacity-40"
                style={{ background: "linear-gradient(135deg,#ffd76b,#f0b429)", border: "1px solid rgba(255,255,255,0.45)" }}
              >
                Create
              </button>
            </div>
          )}
        </div>

        <p className="px-4 pt-2 text-white/35 text-[0.58rem] text-center">
          Reels you tag with a highlight show up on your profile in that bucket.
        </p>
      </div>
    </div>
  );
}

// ─── Audio Picker (Original / Library / Upload) ───────────────────────────
export function AudioPicker({
  open, onClose, current, onPick, allowOriginal = true,
}: {
  open: boolean;
  onClose: () => void;
  current: AudioTrack | null;
  onPick: (track: AudioTrack | null) => void;  // null = original
  allowOriginal?: boolean;
}) {
  const [search, setSearch] = useState("");
  const [previewing, setPreviewing] = useState<string | null>(null);
  const previewRef = useRef<HTMLAudioElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [category, setCategory] = useState<AudioCategory | "all">("all");

  // Stop preview audio whenever the picker closes
  useEffect(() => { if (!open && previewRef.current) previewRef.current.pause(); }, [open]);
  useEffect(() => () => { if (previewRef.current) previewRef.current.pause(); }, []);

  if (!open) return null;
  const list = AUDIO_LIBRARY.filter((t) => {
    if (category !== "all" && t.category !== category) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return t.name.toLowerCase().includes(q) || t.artist.toLowerCase().includes(q);
  });

  const handlePreview = (t: AudioTrack) => {
    if (previewRef.current) {
      previewRef.current.pause();
      previewRef.current.src = t.url;
      previewRef.current.play().catch(() => {});
      setPreviewing(t.id);
    }
  };
  const handleStopPreview = () => {
    if (previewRef.current) previewRef.current.pause();
    setPreviewing(null);
  };

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    onPick({ id: `upload-${Date.now()}`, name: file.name, artist: "Your device", url, emoji: "📥" });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[92] flex items-end" onClick={onClose}>
      <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(6px)" }} />
      <div
        className="relative w-full ig-drawer-up"
        onClick={(e) => e.stopPropagation()}
        style={{
          height: "78vh",
          background: "linear-gradient(180deg,#15101e 0%,#0a0612 100%)",
          borderTopLeftRadius: 24, borderTopRightRadius: 24,
          borderTop: "1px solid rgba(255,255,255,0.12)",
          boxShadow: "0 -20px 60px rgba(0,0,0,0.7)",
          display: "flex", flexDirection: "column",
        }}
      >
        <audio ref={previewRef} onEnded={() => setPreviewing(null)} />

        <div className="flex justify-center pt-2.5 pb-1.5"><div className="w-10 h-[3px] rounded-full bg-white/30" /></div>
        <div className="flex items-center justify-between px-5 pb-2">
          <p className="text-white font-semibold text-[0.92rem]">🎵 Choose audio</p>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onClose(); }}
            onTouchEnd={(e) => { e.stopPropagation(); onClose(); }}
            style={{
              position: "relative", zIndex: 5,
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              width: 36, height: 36, borderRadius: 9999,
              background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.12)",
              color: "rgba(255,255,255,0.85)", fontSize: "1.15rem",
              pointerEvents: "auto",
            }}
            aria-label="Close"
          >✕</button>
        </div>

        <div className="px-5 pb-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search music…"
            className="ig-comment-input w-full rounded-full px-4 py-2 text-[0.82rem] outline-none"
            style={{ color: "#fff", caretColor: "#ffd76b", background: "rgba(255,255,255,0.10)", border: "1px solid rgba(255,255,255,0.20)" }}
          />
        </div>

        {/* Top actions: Original + Upload */}
        <div className="px-4 pb-3 grid grid-cols-2 gap-2">
          {allowOriginal && (
            <button
              onClick={() => { onPick(null); onClose(); }}
              className="ig-create-card-btn"
            >
              <span className="text-xl">🎙</span>
              <span className="flex-1 text-left">
                <span className="block font-semibold text-[0.82rem]">Use original audio</span>
                <span className="block text-white/55 text-[0.62rem]">Whatever the video already has</span>
              </span>
              {current === null && <span className="text-gold-300">✓</span>}
            </button>
          )}
          <button
            onClick={() => fileRef.current?.click()}
            className="ig-create-card-btn"
          >
            <span className="text-xl">📥</span>
            <span className="flex-1 text-left">
              <span className="block font-semibold text-[0.82rem]">Upload from device</span>
              <span className="block text-white/55 text-[0.62rem]">.mp3 / .m4a / .wav from your phone</span>
            </span>
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="audio/*"
            onChange={handleUpload}
            className="hidden"
          />
        </div>

        {/* Category chips — Trending / India / Cinematic / Lo-fi / Energy */}
        <div className="px-4 pb-2 flex gap-1.5 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
          {[{ id: "all" as const, label: "All", emoji: "🎵" }, ...AUDIO_CATEGORIES].map((c) => {
            const active = category === c.id;
            return (
              <button
                key={c.id}
                onClick={() => setCategory(c.id as any)}
                className="px-3 py-1 rounded-full text-[0.7rem] font-bold whitespace-nowrap shrink-0"
                style={{
                  background: active ? "linear-gradient(135deg,#ffd76b,#f0b429)" : "rgba(255,255,255,0.06)",
                  color: active ? "#1a1208" : "rgba(255,255,255,0.85)",
                  border: active ? "1px solid rgba(255,255,255,0.45)" : "1px solid rgba(255,255,255,0.10)",
                }}
              >
                <span>{c.emoji}</span> <span>{c.label}</span>
              </button>
            );
          })}
        </div>

        <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-1.5">
          <p className="text-white/55 text-[0.6rem] uppercase tracking-widest mb-1 mt-1">
            {category === "all" ? "Library" : (AUDIO_CATEGORIES.find((c) => c.id === category)?.label || "Library")}
          </p>
          {/* India / Bolly is licensed music — we can't ship it. Direct
              users to the upload flow instead of pretending we have it. */}
          {category === "india" && (
            <div
              className="my-2 p-4 rounded-2xl"
              style={{
                background: "linear-gradient(135deg, rgba(240,180,41,0.14), rgba(255,69,141,0.10))",
                border: "1px solid rgba(240,180,41,0.32)",
              }}
            >
              <p className="text-2xl mb-1.5">🪕 🎬 🎵</p>
              <p className="text-white font-semibold text-[0.88rem] leading-snug mb-1.5">
                Bollywood music is copyright-protected
              </p>
              <p className="text-white/70 text-[0.74rem] leading-snug mb-3">
                Stock libraries can't carry licensed Hindi / Punjabi / regional songs. Pick a track you already own
                from your phone — it'll be the soundtrack of your reel.
              </p>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-[0.84rem] font-bold text-black"
                style={{
                  background: "linear-gradient(135deg,#ffd76b,#f0b429)",
                  boxShadow: "0 6px 18px rgba(240,180,41,0.45), inset 0 1px 0 rgba(255,255,255,0.5)",
                  border: "1px solid rgba(255,255,255,0.45)",
                }}
              >
                📥 Upload song from device
              </button>
            </div>
          )}
          {list.map((t) => {
            const active = current?.id === t.id;
            const isPreviewing = previewing === t.id;
            return (
              <div
                key={t.id}
                className="flex items-center gap-3 px-2.5 py-2 rounded-xl"
                style={{
                  background: active ? "rgba(240,180,41,0.14)" : "rgba(255,255,255,0.03)",
                  border: `1px solid ${active ? "rgba(240,180,41,0.45)" : "rgba(255,255,255,0.08)"}`,
                }}
              >
                <div className="w-10 h-10 rounded-xl shrink-0 flex items-center justify-center text-xl"
                  style={{ background: "linear-gradient(135deg,#1a1530,#0d1a2e)", border: "1px solid rgba(255,255,255,0.10)" }}>
                  {t.emoji || "🎵"}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white font-semibold text-[0.82rem] truncate">{t.name}</p>
                  <p className="text-white/55 text-[0.62rem] truncate">{t.artist}</p>
                </div>
                <button
                  onClick={() => isPreviewing ? handleStopPreview() : handlePreview(t)}
                  className="px-2.5 py-1.5 rounded-full text-[0.7rem] text-white"
                  style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.18)" }}
                  aria-label={isPreviewing ? "Stop preview" : "Preview"}
                >
                  {isPreviewing ? "⏸" : "▶"}
                </button>
                <button
                  onClick={() => { handleStopPreview(); onPick(t); onClose(); }}
                  className="px-3 py-1.5 rounded-full text-[0.72rem] font-bold text-black"
                  style={{ background: "linear-gradient(135deg,#ffd76b,#f0b429)", border: "1px solid rgba(255,255,255,0.45)", boxShadow: "0 2px 6px rgba(240,180,41,0.45)" }}
                >
                  Use
                </button>
              </div>
            );
          })}
          {list.length === 0 && (
            <p className="py-10 text-center text-white/45 text-sm">No matches.</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Cover-frame picker — pick any frame of the video as the poster ────
// v114 — scrubs the source video with a draggable slider + a row of 6
// pre-extracted thumbnails. The chosen frame is captured to a JPEG data
// URL via extractVideoThumbnail(file, atSecond) and surfaced back to the
// composer via onPick(dataUrl, second). Same canvas pipeline that already
// ran on first file pick — zero new dependencies, works on every browser
// that decodes the source video.
export function CoverFramePicker({
  open, file, onClose, onPick,
}: {
  open: boolean;
  file: File | null;
  onClose: () => void;
  onPick: (dataUrl: string, atSecond: number) => void;
}) {
  const [duration, setDuration] = useState(0);
  const [scrub, setScrub] = useState(0);
  const [thumbs, setThumbs] = useState<{ t: number; src: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const urlRef   = useRef<string>("");

  // Build a single object URL for the source video for live scrubbing.
  useEffect(() => {
    if (!open || !file) return;
    const u = URL.createObjectURL(file);
    urlRef.current = u;
    return () => { try { URL.revokeObjectURL(u); } catch {} };
  }, [open, file]);

  // Pre-extract 6 sample thumbnails so the user has a quick overview.
  useEffect(() => {
    if (!open || !file) return;
    let cancelled = false;
    (async () => {
      // Wait for metadata via a quick probe video first to learn the duration.
      const probe = document.createElement("video");
      probe.preload = "metadata";
      probe.src = urlRef.current;
      probe.muted = true;
      probe.playsInline = true;
      await new Promise<void>((res) => {
        probe.onloadedmetadata = () => res();
        probe.onerror = () => res();
        setTimeout(res, 2500);
      });
      const dur = probe.duration && isFinite(probe.duration) && probe.duration > 0 ? probe.duration : 6;
      if (cancelled) return;
      setDuration(dur);
      setScrub(Math.min(0.6, dur / 4));
      // Extract 6 evenly-spaced frames (skip 0 to dodge black opening frames).
      const slots = Array.from({ length: 6 }, (_, i) => (dur * (i + 1)) / 7);
      const out: { t: number; src: string }[] = [];
      for (const t of slots) {
        if (cancelled) return;
        const src = await extractVideoThumbnail(file, t);
        if (cancelled) return;
        if (src) out.push({ t, src });
      }
      if (!cancelled) setThumbs(out);
    })();
    return () => { cancelled = true; };
  }, [open, file]);

  async function pickAtScrub() {
    if (!file || busy) return;
    setBusy(true);
    try {
      const src = await extractVideoThumbnail(file, scrub);
      if (src) { onPick(src, scrub); onClose(); }
    } finally { setBusy(false); }
  }

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[97] flex items-end" onClick={onClose}>
      <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.78)", backdropFilter: "blur(8px)" }} />
      <div
        className="relative w-full"
        onClick={(e) => e.stopPropagation()}
        style={{
          height: "92dvh",
          maxHeight: "92dvh",
          background: "linear-gradient(180deg,#15101e 0%,#0a0612 100%)",
          borderTopLeftRadius: 22, borderTopRightRadius: 22,
          borderTop: "1px solid rgba(255,255,255,0.14)",
          display: "flex", flexDirection: "column",
          paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 14px)",
        }}
      >
        <div className="flex justify-center pt-2.5 pb-1.5"><div className="w-10 h-[3px] rounded-full bg-white/30" /></div>
        <div className="flex items-center justify-between px-5 pb-3 border-b border-white/8 shrink-0">
          <button onClick={onClose} className="text-white/85 text-[0.84rem]">Cancel</button>
          <p className="text-white font-semibold text-[0.92rem]">🖼 Choose cover frame</p>
          <button onClick={pickAtScrub} disabled={busy} className="text-gold-300 font-bold text-[0.84rem] disabled:opacity-30">
            {busy ? "Saving…" : "Use frame"}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          {/* Live preview at current scrub position */}
          <div
            className="relative w-full rounded-2xl overflow-hidden bg-black mx-auto mb-3"
            style={{ aspectRatio: "9/16", maxHeight: "52dvh" }}
          >
            <video
              ref={videoRef}
              src={urlRef.current}
              className="w-full h-full object-contain"
              muted playsInline
              onLoadedMetadata={(e) => {
                const v = e.currentTarget;
                try { v.currentTime = scrub; } catch {}
              }}
            />
            <span
              className="absolute bottom-2 left-2 px-2 py-0.5 rounded-full text-[0.62rem] font-bold"
              style={{ background: "rgba(0,0,0,0.55)", color: "#ffd76b", border: "1px solid rgba(255,215,107,0.35)", backdropFilter: "blur(6px)" }}
            >
              {scrub.toFixed(1)}s / {duration ? duration.toFixed(1) : "…"}s
            </span>
          </div>

          {/* Time scrubber */}
          {duration > 0 && (
            <input
              type="range"
              min={0}
              max={Math.max(0.01, duration - 0.05)}
              step={0.05}
              value={scrub}
              onChange={(e) => {
                const t = Number(e.target.value);
                setScrub(t);
                const v = videoRef.current;
                if (v) { try { v.currentTime = t; } catch {} }
              }}
              className="w-full"
              style={{ accentColor: "#ffd76b" }}
            />
          )}

          {/* Sample thumbnails */}
          <p className="text-white/55 text-[0.6rem] uppercase tracking-widest mt-4 mb-2">Quick picks</p>
          {thumbs.length === 0 ? (
            <p className="text-white/45 text-[0.74rem]">Extracting frames…</p>
          ) : (
            <div className="flex gap-2 overflow-x-auto -mx-4 px-4 pb-2 hide-scroll">
              {thumbs.map((th, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => { setScrub(th.t); onPick(th.src, th.t); onClose(); }}
                  className="shrink-0 w-16 h-24 rounded-lg overflow-hidden block"
                  style={{ border: "2px solid rgba(255,255,255,0.18)" }}
                  aria-label={`Use frame at ${th.t.toFixed(1)} seconds`}
                >
                  <img src={th.src} alt="" className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <style jsx global>{`
        .hide-scroll::-webkit-scrollbar { display: none; }
        .hide-scroll { scrollbar-width: none; }
      `}</style>
    </div>
  );
}

// ─── Composer (the multi-step compose modal) ─────────────────────────────
export function Composer({
  open, kind, onClose, onPosted, sanitize,
}: {
  open: boolean;
  kind: ContentKind;
  onClose: () => void;
  onPosted: (post: UserPost) => void;
  /**
   * Caption sanitizer hook — caller supplies the same anti-bypass guard
   * used elsewhere so phone/email/social-handle leaks are scrubbed before
   * posting. Returns the masked caption + whether anything was blocked.
   */
  sanitize?: (s: string) => { clean: string; blocked: boolean };
}) {
  const [step, setStep] = useState<"pick" | "edit">("pick");
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [mediaUrl, setMediaUrl] = useState<string>("");
  const [posterUrl, setPosterUrl] = useState<string>("");
  const [formatWarning, setFormatWarning] = useState<string>("");
  const [caption, setCaption] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [audio, setAudio] = useState<AudioTrack | null>(null);
  const [audioOpen, setAudioOpen] = useState(false);
  const [location, setLocation] = useState<Location | null>(null);
  const [locationOpen, setLocationOpen] = useState(false);
  const [taggedHotel, setTaggedHotel] = useState<TaggedHotel | null>(null);
  const [hotelOpen, setHotelOpen] = useState(false);
  const [highlight, setHighlight] = useState<HighlightTag | null>(null);
  const [highlightOpen, setHighlightOpen] = useState(false);
  const [saveAsPost, setSaveAsPost] = useState(false); // story-only toggle
  const [posting, setPosting] = useState(false);
  const [warnedSanitize, setWarnedSanitize] = useState(false);
  // v113 — IG-style cover/fit toggle on the preview. `cover` crops to fill
  // the target frame (default; matches what viewers will see in the feed);
  // `contain` shows the whole frame letter-boxed (useful to verify framing).
  const [previewFit, setPreviewFit] = useState<"cover" | "contain">("cover");
  // v114 — IG-style filter presets. Applied as CSS filter on the preview AND
  // persisted on the post payload so the feed renders the same look.
  const [filter, setFilter] = useState<string>("none");
  // v114 — cover-frame picker. For videos, lets the creator scrub through
  // the timeline and pick ANY frame as the poster (matches IG / TikTok).
  const [coverPickerOpen, setCoverPickerOpen] = useState(false);
  const [coverFrames, setCoverFrames] = useState<{ t: number; dataUrl: string }[]>([]);
  // v114 — upload state for the retry-on-failure flow. Lastest error message
  // surfaces in a banner; "Retry" re-runs the upload pipeline without
  // re-selecting the file. uploadProgress is informational only (Storage
  // upload doesn't expose granular bytes-uploaded events from the
  // fetch path yet — surfacing 30/70/100% milestones is enough UX signal).
  const [retryCount, setRetryCount]     = useState(0);
  const [lastError,  setLastError]      = useState<string>("");
  const [uploadProgress, setUploadProgress] = useState(0);
  // v116 — client-side video compression. `compressionProgress` runs 0-100
  // while the canvas re-encode is in flight; `compressing` separates the
  // "compressing" phase from "uploading" in the banner. `compressedInfo`
  // carries the before / after byte counts so the UI can surface savings
  // ("Compressed 24.3 MB → 6.1 MB").
  const [compressing, setCompressing] = useState(false);
  const [compressionProgress, setCompressionProgress] = useState(0);
  const [compressedInfo, setCompressedInfo] = useState<{ before: number; after: number } | null>(null);
  // v117 — multi-clip merge state. `extraClips` holds every video attached
  // AFTER the primary `mediaFile`. The merge step runs ONCE at upload time
  // (not on every "add clip" tap) so we never re-encode partial joins. The
  // merge progress state powers the same banner as compress does.
  const [extraClips, setExtraClips] = useState<ClipAttachment[]>([]);
  const [merging, setMerging] = useState(false);
  const [mergeProgress, setMergeProgress] = useState<MergeProgress | null>(null);
  const [mergeUnsupportedNote, setMergeUnsupportedNote] = useState<string>("");
  const fileRef = useRef<HTMLInputElement | null>(null);
  // v117 — separate input ref for the "+ Add another clip" picker. Reuses
  // `accept` but is wired to ADD onto extraClips instead of replacing the
  // primary file. Keeping a second ref avoids the "click() while element
  // is mid-render" race that breaks file dialogs on Safari.
  const moreClipsRef = useRef<HTMLInputElement | null>(null);
  // v113 — separate camera-capture input. Same accept but with `capture`
  // attribute so the phone opens the camera straight away.
  const cameraRef = useRef<HTMLInputElement | null>(null);
  const audioPreviewRef = useRef<HTMLAudioElement | null>(null);
  // Guard against synchronous double-fire: setPosting(true) is async, so
  // tapping the header "Post" button + the footer "Post to your profile"
  // (or React Strict Mode replaying effects in dev) could both pass the
  // `disabled={posting}` check before the state actually flushed and
  // commit the same upload twice. The ref flips immediately, before any
  // re-render, so the second call is a no-op.
  const postedRef = useRef(false);
  const { addPost, updatePost } = usePosts();

  // Reset when reopened
  useEffect(() => {
    if (open) {
      setStep("pick");
      setMediaFile(null);
      setMediaUrl("");
      setCaption("");
      setTags([]);
      setAudio(null);
      setLocation(null);
      setLocationOpen(false);
      setTaggedHotel(null);
      setHotelOpen(false);
      setHighlight(null);
      setHighlightOpen(false);
      setSaveAsPost(false);
      setPosting(false);
      postedRef.current = false;
      setWarnedSanitize(false);
      setFormatWarning("");
      setPreviewFit("cover");
      setFilter("none");
      setRetryCount(0);
      setLastError("");
      setUploadProgress(0);
      setCompressing(false);
      setCompressionProgress(0);
      setCompressedInfo(null);
      setCoverFrames([]);
      setCoverPickerOpen(false);
      // v117 — wipe any attached clips and revoke their object URLs so the
      // composer never carries stale blob handles between sessions.
      setExtraClips((prev) => {
        for (const c of prev) { try { URL.revokeObjectURL(c.url); } catch {} }
        return [];
      });
      setMerging(false);
      setMergeProgress(null);
      setMergeUnsupportedNote("");
    }
  }, [open, kind]);

  // v114 — body lock + global "composer-open" class. While the composer is
  // open we:
  //   1. Lock body scroll so the page underneath doesn't bleed touches.
  //   2. Add `sb-composer-open` to <body> — BottomDock hides itself and the
  //      InstagramHotelFeed's per-card `forcePaused` (which already watches
  //      body className via MutationObserver) freezes every <video> + audio
  //      so the creator never has background sound while uploading.
  useEffect(() => {
    if (!open) return;
    document.body.classList.add("sb-composer-open");
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.classList.remove("sb-composer-open");
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  // v116 — sync the audio preview element with the picked track. When the
  // user picks a custom audio in the composer, the video preview is muted
  // via `muted={!!audio}` but NOTHING was playing the new audio — so the
  // user heard silence and assumed audio attach was broken. This effect
  // mounts the audio element + plays it (synced from 0). Stops cleanly
  // when the user clears audio or closes the composer.
  useEffect(() => {
    const a = audioPreviewRef.current;
    if (!a) return;
    if (!open || !audio?.url) {
      try { a.pause(); a.currentTime = 0; } catch {}
      return;
    }
    try {
      a.currentTime = 0;
      a.volume = 1;
      a.muted = false;
      const p = a.play();
      if (p && typeof p.then === "function") p.catch(() => { /* autoplay policy — first gesture re-tries */ });
    } catch {}
    return () => {
      try { a.pause(); a.currentTime = 0; } catch {}
    };
  }, [audio?.url, open]);

  // ⚠️ Do NOT revoke the object URL when the composer closes — the blob URL
  // is now owned by the post inside PostsStore and the feed needs it to play
  // back the upload. Revoking here was the bug that made every freshly-
  // posted reel/photo show up as a broken card. URLs are session-scoped
  // anyway; the browser cleans them up when the tab closes.

  // NOTE: `if (!open) return null;` lives FURTHER DOWN now (just before
  // the JSX return). It used to sit here, but the v114 retry-aware upload
  // adds two useCallbacks + one useRef inside the component body — and
  // calling hooks after a conditional return violates the Rules of Hooks.
  // Moving the early return below the hook block keeps the hook count
  // identical across every render of Composer.

  const accept = kind === "photo" ? "image/*" : kind === "story" ? "image/*,video/*" : "video/*";
  const isVideo = mediaFile?.type.startsWith("video/");
  // v117 — only reel kind supports multi-clip merge. Stories are 24h
  // single-shots and photos can't be merged into video. The picker chip
  // surfaces "Tap to choose multiple" only when relevant.
  const allowMultiClips = kind === "reel";

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = Array.from(e.target.files || []);
    if (fileList.length === 0) return;
    const [file, ...rest] = fileList;
    const url = URL.createObjectURL(file);
    setMediaFile(file);
    setMediaUrl(url);
    setPosterUrl("");
    setFormatWarning("");
    if (file.type.startsWith("video/")) {
      try {
        const probe = document.createElement("video");
        const can = probe.canPlayType(file.type);
        if (can === "") {
          setFormatWarning(
            `Your browser may not be able to play "${file.type || "this format"}". ` +
            "We'll still capture a thumbnail so the post isn't blank, but the reel may not animate. " +
            "Convert to MP4 (H.264 / AAC) for full playback."
          );
        }
      } catch {}
      // Kick off thumbnail extraction in the background — the user can
      // continue editing while the canvas grabs a frame. Posts always
      // ship WITH a poster when one is recoverable.
      extractVideoThumbnail(file).then(setPosterUrl).catch(() => setPosterUrl(""));
    } else if (file.type.startsWith("image/")) {
      // Photos use the source image itself as their own poster.
      setPosterUrl(url);
    }
    // v117 — if the picker returned multiple video files at once, fold the
    // extras into the merge queue. Non-reel kinds ignore extras; photos +
    // stories stay single-shot.
    if (rest.length > 0 && allowMultiClips && file.type.startsWith("video/")) {
      if (!isMergeSupported()) {
        setMergeUnsupportedNote(
          "This browser can't merge clips locally — only the first clip will be posted. Try Chrome / Firefox, or upload each clip as its own reel."
        );
      } else {
        const extras: ClipAttachment[] = rest
          .filter((f) => f.type.startsWith("video/"))
          .map((f) => ({
            id: `clip-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            file: f,
            url: URL.createObjectURL(f),
          }));
        setExtraClips(extras);
      }
    }
    setStep("edit");
  };

  // v117 — append more clips to the merge queue from the "+ Add clip" button
  // in the edit step. Validates the input is video-only (we already enforce
  // accept="video/*" on the input but defensive guard against drag-drop or
  // browsers that ignore accept).
  const onAddClips = (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = Array.from(e.target.files || []);
    if (fileList.length === 0) return;
    if (!isMergeSupported()) {
      setMergeUnsupportedNote(
        "This browser can't merge clips locally. Post each clip as a separate reel, or open in Chrome / Firefox."
      );
      try { (e.target as HTMLInputElement).value = ""; } catch {}
      return;
    }
    const additions: ClipAttachment[] = fileList
      .filter((f) => f.type.startsWith("video/"))
      .map((f) => ({
        id: `clip-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        file: f,
        url: URL.createObjectURL(f),
      }));
    if (additions.length === 0) {
      setMergeUnsupportedNote("Only video files can be added as extra clips.");
    } else {
      setExtraClips((prev) => [...prev, ...additions]);
      setMergeUnsupportedNote("");
    }
    // Clear input so picking the same file twice still fires onChange.
    try { (e.target as HTMLInputElement).value = ""; } catch {}
  };

  const removeExtraClip = (id: string) => {
    setExtraClips((prev) => {
      const next: ClipAttachment[] = [];
      for (const c of prev) {
        if (c.id === id) { try { URL.revokeObjectURL(c.url); } catch {} }
        else next.push(c);
      }
      return next;
    });
  };

  const moveExtraClip = (id: string, dir: -1 | 1) => {
    setExtraClips((prev) => {
      const idx = prev.findIndex((c) => c.id === id);
      if (idx < 0) return prev;
      const next = idx + dir;
      if (next < 0 || next >= prev.length) return prev;
      const copy = prev.slice();
      [copy[idx], copy[next]] = [copy[next], copy[idx]];
      return copy;
    });
  };

  // v117 — promote an extra clip to the primary (first frame of the merged
  // video + driver of preview aspect). Useful when the creator picked
  // clips in the wrong order and wants the second clip to lead.
  const promoteExtraClip = (id: string) => {
    setExtraClips((prev) => {
      const idx = prev.findIndex((c) => c.id === id);
      if (idx < 0 || !mediaFile) return prev;
      const chosen = prev[idx];
      const oldPrimary: ClipAttachment = {
        id: `clip-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        file: mediaFile,
        url: mediaUrl || URL.createObjectURL(mediaFile),
      };
      const newPrimaryUrl = chosen.url;
      // Swap state.
      setMediaFile(chosen.file);
      setMediaUrl(newPrimaryUrl);
      setPosterUrl("");
      if (chosen.file.type.startsWith("video/")) {
        extractVideoThumbnail(chosen.file).then(setPosterUrl).catch(() => setPosterUrl(""));
      }
      const next = prev.slice();
      next.splice(idx, 1, oldPrimary);
      return next;
    });
  };

  const toggleTag = (t: string) => {
    setTags((prev) => prev.includes(t) ? prev.filter((p) => p !== t) : [...prev, t]);
  };

  const insertEmoji = (e: string) => setCaption((c) => c + e);

  // v114 — pulled out so the Retry button can re-run the same upload with
  // the SAME tempId (clientPostId stays stable -> server idempotency holds,
  // so multiple "Retry" taps will never duplicate posts on social_posts).
  // v117 — accepts an optional `clips` argument carrying the primary file
  // + extras in merge order. When provided AND length > 1, the merge step
  // runs BEFORE compression and produces a single blob already at our
  // target bitrate, so compression is skipped on the merged output (no
  // double re-encode).
  const runUpload = useCallback(async (
    tempId: string,
    post: UserPost,
    clips?: File[],
  ): Promise<{ ok: boolean; error?: string }> => {
    let mergedObjectUrl: string | null = null;
    try {
      const tok = (typeof window !== "undefined" && localStorage.getItem("sb_token")) || "";
      if (!tok)    return { ok: false, error: "Not signed in. Saved on this device only." };
      let userId = "";
      try {
        const payload = JSON.parse(atob(tok.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
        userId = payload.id || payload.user_id || payload.sub || "";
      } catch {}
      if (!userId) return { ok: false, error: "Re-sign-in needed. Saved on this device only." };

      setUploadProgress(2);
      const mediaType: "PHOTO" | "REEL" | "STORY" =
        post.kind === "photo" ? "PHOTO" : post.kind === "story" ? "STORY" : "REEL";

      // v116 — client-side compression for videos (reels + stories).
      // Photos skip this branch entirely. The compressed blob replaces
      // the original mediaUrl + mediaMime for the rest of the upload —
      // typically 60-80% smaller, finishes inside the 90s watchdog
      // even on India 3G. Failure falls through to the original file.
      let uploadBlobUrl = post.mediaUrl;
      let uploadMime    = post.mediaMime;
      let posterForUpload = post.posterUrl;
      let skipCompression = false;
      const isVideoPost = mediaType === "REEL" || mediaType === "STORY" || (post.mediaMime || "").startsWith("video/");

      // v117 — merge step. Runs ONLY when the caller supplied 2+ clips AND
      // the post is a video. The merger throws MergeUnsupportedError on
      // browsers without captureStream — surfaced clearly so the user can
      // either switch browser or remove the extras and retry single-clip.
      if (isVideoPost && clips && clips.length > 1) {
        try {
          setMerging(true);
          setMergeProgress({ phase: "probe", overall: 0 });
          const result = await mergeVideos(clips, (p) => setMergeProgress(p));
          mergedObjectUrl  = URL.createObjectURL(result.blob);
          uploadBlobUrl    = mergedObjectUrl;
          uploadMime       = result.mime;
          skipCompression  = true; // merger already encodes at compress targets
          // Refresh the poster from the merged output so the thumbnail
          // matches the first frame of the merged reel, not the first
          // frame of the primary clip in isolation.
          try {
            const merged_poster = await extractMergedPoster(result.blob);
            if (merged_poster && merged_poster.startsWith("data:")) {
              posterForUpload = merged_poster;
            }
          } catch { /* fall through with existing poster */ }
        } catch (e: any) {
          setMerging(false);
          setMergeProgress(null);
          if (e instanceof MergeUnsupportedError) {
            return { ok: false, error: e.message };
          }
          return { ok: false, error: e?.message || "Couldn't merge the clips. Tap Retry, or remove the extras." };
        } finally {
          setMerging(false);
        }
      }

      if (isVideoPost && !skipCompression) {
        try {
          setCompressing(true);
          setCompressionProgress(0);
          const srcBlob = await fetch(uploadBlobUrl).then((r) => r.blob());
          const result = await compressVideo(srcBlob, (pct) => setCompressionProgress(Math.round(pct)));
          if (result.compressed && result.blob !== srcBlob) {
            const newUrl = URL.createObjectURL(result.blob);
            uploadBlobUrl = newUrl;
            uploadMime    = result.mime;
            setCompressedInfo({ before: result.originalBytes, after: result.finalBytes });
          } else {
            setCompressedInfo({ before: result.originalBytes, after: result.finalBytes });
          }
        } catch (e: any) {
          // Hard size errors propagate up so the user knows to trim.
          if (e?.message?.includes("trim it under")) {
            setCompressing(false);
            return { ok: false, error: e.message };
          }
          // Soft errors (codec mismatch etc) — ship the original file.
          // Storage will accept whatever the phone produced.
        } finally {
          setCompressing(false);
        }
      }

      const uploaded = await uploadSocialMedia({
        mediaBlobUrl: uploadBlobUrl,
        mediaMime:    uploadMime,
        kind:         mediaType,
        // v117 — `posterForUpload` is either the original poster captured
        // at file-pick time OR the refreshed first-frame from the merged
        // output. Either way it's a data URL — same shape uploadSocialMedia
        // already expects.
        posterDataUrl: posterForUpload?.startsWith("data:") ? posterForUpload : undefined,
        userId,
        // v115 — real bytes-uploaded progress. Replaces the v114 milestone
        // jumps (15% → 70% → 95%) which sat frozen at 15% the entire time
        // the actual video was streaming up — looked like a hang to users.
        onProgress: (pct) => setUploadProgress(Math.max(2, Math.min(95, Math.round(pct)))),
      });

      // v115 — upload device-attached audio so cross-device playback works.
      // If the picked track is a library URL (https) or the post's own
      // original audio (no audio attached), we ship it as-is. ONLY blob:
      // URLs need to be re-hosted because they're tied to the upload device.
      let soundUrl = post.audio?.url || undefined;
      if (soundUrl && soundUrl.startsWith("blob:")) {
        try {
          // Best-effort MIME probe — blob URLs lose mime metadata.
          const probe = await fetch(soundUrl).then(r => r.blob()).catch(() => null);
          const mime = probe?.type || "audio/mpeg";
          soundUrl = await uploadSocialAudio({ blobUrl: post.audio!.url, mime, userId });
        } catch (e: any) {
          // If audio upload fails, ship the post without audio rather
          // than failing the whole upload. Caption + media still go up.
          soundUrl = undefined;
        }
      }

      const r = await fetch("/api/social/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` },
        body: JSON.stringify({
          clientPostId:  tempId,
          mediaType,
          mediaUrl:      uploaded.mediaUrl,
          thumbnailUrl:  uploaded.thumbnailUrl || undefined,
          caption:       post.caption,
          soundTrack:    post.audio?.name || undefined,
          soundUrl,
          hotelId:       post.taggedHotel?.id || undefined,
          locationName:  post.location?.name  || undefined,
          locationLat:   typeof post.location?.lat === "number" ? post.location.lat : undefined,
          locationLng:   typeof post.location?.lng === "number" ? post.location.lng : undefined,
          highlightKey:  post.highlight?.key || undefined,
          filter:        post.filter || undefined,
        }),
      });
      setUploadProgress(98);
      if (!r.ok) return { ok: false, error: `Server returned ${r.status}. Tap Retry.` };
      const json = await r.json().catch(() => null);
      const serverId = json?.post?.id ? String(json.post.id) : "";
      const serverMedia = json?.post?.media_url || uploaded.mediaUrl;
      const serverPoster = json?.post?.thumbnail_url || uploaded.thumbnailUrl || post.posterUrl || "";
      try {
        updatePost(tempId, {
          id: serverId || tempId,
          mediaUrl: serverMedia,
          posterUrl: serverPoster,
          // v115 — also swap the local entry's audio.url from the
          // device-only blob: URL to the durable public URL so the
          // uploader sees their post play correctly without needing
          // to reload (otherwise their own video keeps playing the
          // original device track until a hard refresh).
          ...(soundUrl && post.audio
            ? { audio: { name: post.audio.name, url: soundUrl } }
            : {}),
        });
      } catch {}
      setUploadProgress(100);
      return { ok: true };
    } catch (err: any) {
      const msg = err?.message?.includes("Storage upload failed")
        ? "Couldn't upload media (network / file format)."
        : (err?.message || "Upload failed.");
      return { ok: false, error: msg };
    } finally {
      // v117 — revoke the temporary merged-blob URL once we're done with it.
      // The compressed/merged blob has already been streamed to Storage and
      // updatePost() points the local feed at the durable public URL above.
      if (mergedObjectUrl) {
        try { URL.revokeObjectURL(mergedObjectUrl); } catch {}
      }
    }
  }, [updatePost]);

  // Holds the most recently attempted post payload so the Retry button can
  // re-run runUpload without losing the user's selections.
  // v117 — also remembers the merge-order clip list so retries replay the
  // same multi-clip merge instead of falling back to single-clip.
  const lastAttemptRef = useRef<{ tempId: string; post: UserPost; clips?: File[] } | null>(null);

  const retry = useCallback(async () => {
    if (!lastAttemptRef.current) return;
    setLastError("");
    setRetryCount((c) => c + 1);
    setPosting(true);
    setUploadProgress(0);
    const { tempId, post, clips } = lastAttemptRef.current;
    const result = await runUpload(tempId, post, clips);
    setPosting(false);
    if (result.ok) {
      notify({ kind: "success", title: "Shared to your profile", body: "Your post is safe across devices and re-logins." });
      onPosted(post);
      onClose();
    } else {
      setLastError(result.error || "Upload failed. Tap Retry.");
    }
  }, [runUpload, onPosted, onClose]);

  const post = () => {
    if (!mediaFile || !mediaUrl) return;
    // Hard double-fire guard — see postedRef declaration for the reasoning.
    if (postedRef.current) return;
    postedRef.current = true;
    const sanitizedCaption = sanitize ? sanitize(caption).clean : caption;
    setLastError("");
    setPosting(true);
    setUploadProgress(0);
    // v111 — `tempId` doubles as the server-side idempotency key
    // (`client_post_id` on social_posts). Even if /api/social/posts is
    // hit 5 times for the same logical post (Strict Mode, retry, SW
    // dupe), the server returns the SAME row each time. Belt-and-
    // braces: postedRef guards client-side double-fire; clientPostId
    // guards anything that gets past it.
    const tempId = `post-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const userPost: UserPost = {
      id: tempId,
      kind,
      mediaUrl,                          // local object URL — survives session
      mediaMime: mediaFile.type,
      // Persist the captured first-frame poster (data-URL JPEG). Survives
      // page reload, gives the feed + profile grid a real preview even
      // when the codec can't be decoded.
      posterUrl,
      caption: sanitizedCaption,
      tags,
      audio: audio ? { name: audio.name, url: audio.url } : null,
      location: location || null,
      taggedHotel: taggedHotel || null,
      // Highlight bucket (built-in or custom). Picked optionally; null = no
      // bucket, post just shows under the main "Reels" tab.
      highlight: highlight || null,
      // v114 — chosen filter preset. null/"none" means original look.
      filter: filter && filter !== "none" ? filter : null,
      // Story-only metadata. Stories live for 24h unless `keepAsPost` is on.
      ...(kind === "story"
        ? { storyExpiresAt: Date.now() + 24 * 60 * 60 * 1000, keepAsPost: !!saveAsPost }
        : {}),
      createdAt: Date.now(),
    };
    // Commit to the global reactive PostsStore — feed picks it up instantly.
    try { addPost(userPost as StoreUserPost); } catch {}
    // v117 — when extras are queued, snapshot the merge order so retries
    // replay the same join. The primary always sits at index 0; extras
    // follow in display order. Caller is the only place that knows the
    // current `extraClips` so the snapshot must happen here, not inside
    // runUpload.
    const mergeClips: File[] | undefined = (allowMultiClips && mediaFile && extraClips.length > 0)
      ? [mediaFile, ...extraClips.map((c) => c.file)]
      : undefined;
    lastAttemptRef.current = { tempId, post: userPost, clips: mergeClips };

    // v114 — await the upload. On success: close + success toast. On
    // failure: KEEP the modal open and surface a retry banner so the
    // creator can Retry without losing their selections or rebuilding
    // tags / filter / cover. The tempId is the same across retries so
    // the server-side `client_post_id` deduplication still holds.
    runUpload(tempId, userPost, mergeClips).then((result) => {
      setPosting(false);
      if (result.ok) {
        notify({ kind: "success", title: "Shared to your profile", body: "Your post is safe across devices and re-logins." });
        onPosted(userPost);
        onClose();
      } else {
        // Allow retry without resetting postedRef so the user can ALSO
        // close + try again from /me with the local copy.
        setLastError(result.error || "Upload failed. Tap Retry.");
      }
    });
  };

  const captionPreview = (() => {
    if (!sanitize || !caption) return null;
    const { blocked } = sanitize(caption);
    return blocked;
  })();

  // Target aspect ratios per kind — matches IG. Reel/Story = 9:16, Photo = 4:5.
  const targetAspect = kind === "photo" ? "4/5" : "9/16";
  const targetLabel  = kind === "photo" ? "4:5 portrait" : "9:16 vertical";

  // v114 — early-return AFTER all hooks have run. See the hook-order note
  // up above for why this can't sit at the top of the component anymore.
  if (!open) return null;

  // v113 — portal to <body> so the composer escapes any ancestor stacking
  // context. InstagramHotelFeed wraps everything in an `absolute z-10`
  // surface; without the portal, this fixed z-[91] sheet gets clamped to
  // z-10 in the root stacking order and the z-60 BottomDock renders ON
  // TOP of the composer (the actual cause of "Post button hidden").
  const sheet = (
    // v114 — z bumped 91 → 1000 + explicit isolation so the composer ALWAYS
    // wins over BottomDock (z 60), Navbar (z 50), ServerStatus banner (z 70),
    // and any future fixed surface. Combined with the portal-to-body fix
    // (v113), nothing can ever render on top again.
    <div
      className="fixed inset-0 z-[1000] flex items-end"
      onClick={onClose}
      style={{ isolation: "isolate" }}
    >
      <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.82)", backdropFilter: "blur(8px)" }} />
      {/*
        v113 — Full-viewport sheet. Was `height: 94vh` which on Android Chrome
        got cut behind the URL bar (vh counts the FULL viewport, not the
        visible one). Now uses `100dvh` (dynamic viewport height — reacts to
        URL-bar collapse) so the sheet ALWAYS fills the visible area and
        nothing hides below the browser chrome.
        Kept `items-end` because the shared `.ig-drawer-up` keyframe slides
        from translateY(100%) up — that animation only looks right when the
        panel is anchored to the bottom of its flex parent.
      */}
      <div
        className="relative w-full composer-sheet overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
        style={{
          // 100dvh = dynamic viewport height (URL-bar aware). Never overflows.
          height: "100dvh",
          maxHeight: "100dvh",
          background: "linear-gradient(180deg,#15101e 0%,#0a0612 100%)",
          borderTop: "1px solid rgba(255,255,255,0.12)",
          boxShadow: "0 -20px 60px rgba(0,0,0,0.75)",
          // Account for status-bar notch at top — the bottom safe-area is
          // baked into the scroll body's paddingBottom further down.
          paddingTop: "env(safe-area-inset-top, 0px)",
        }}
      >
        {/* v113 — replaces the shared `.ig-drawer-up` slide-up animation,
            which assumed the panel was shorter than the viewport (slid in
            from below). With our 100dvh full-fill panel that keyframe just
            pushes the panel offscreen permanently. Inline fade+lift gets
            the same "drawer feeling" without that math glitch. */}
        <style jsx>{`
          .composer-sheet { animation: composerIn 0.28s cubic-bezier(0.22, 1, 0.36, 1) both; }
          @keyframes composerIn {
            from { opacity: 0; transform: translateY(18px); }
            to   { opacity: 1; transform: translateY(0); }
          }
        `}</style>
        <audio ref={audioPreviewRef} src={audio?.url || ""} loop />

        {/* Sticky header — Cancel · Title · Post · always visible regardless
            of scroll position or URL-bar state. */}
        <div
          className="flex items-center justify-between px-5 py-3 border-b border-white/10 shrink-0"
          style={{ background: "linear-gradient(180deg, rgba(21,16,30,0.96), rgba(21,16,30,0.86))", backdropFilter: "blur(10px)" }}
        >
          <button onClick={step === "edit" ? () => setStep("pick") : onClose} className="text-white/85 text-[0.84rem] py-1 px-2 -mx-2">
            {step === "edit" ? "‹ Back" : "Cancel"}
          </button>
          <p className="text-white font-semibold text-[0.92rem]">
            {step === "pick" ? `New ${kind === "reel" ? "Reel" : kind === "photo" ? "Photo" : "Story"}` : "Edit"}
          </p>
          <button
            onClick={post}
            disabled={!mediaFile || posting}
            className="font-bold text-[0.84rem] py-1 px-2 -mx-2"
            style={{
              color: !mediaFile || posting ? "rgba(255,215,107,0.35)" : "#ffd76b",
            }}
          >
            {posting ? "Posting…" : "Post"}
          </button>
        </div>

        {/* Step 1 — pick a file OR open the camera. v113 splits the entry
            into two equal cards so the user has one tap to a fresh shot
            (📷 capture) AND one tap to the gallery, matching IG/TikTok.
            Drag-and-drop is wired on the gallery card for desktop users. */}
        {step === "pick" && (
          <div
            className="flex-1 overflow-y-auto px-5 py-6 flex flex-col items-center text-center"
            style={{ minHeight: 0 }}
          >
            <div className="w-full max-w-sm space-y-3">
              {/* Gallery / file picker — primary card. */}
              <div
                role="button"
                tabIndex={0}
                onClick={() => fileRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                onDrop={(e) => {
                  e.preventDefault(); e.stopPropagation();
                  const files = e.dataTransfer.files;
                  if (!files || files.length === 0) return;
                  // v117 — Drag-drop: preserve all dropped files when reels
                  // mode (multi-clip merge), otherwise pass through the
                  // first only (photo / story stays single-shot).
                  if (fileRef.current) {
                    const dt = new DataTransfer();
                    const max = allowMultiClips ? Math.min(files.length, 10) : 1;
                    for (let i = 0; i < max; i++) {
                      const f = files.item(i);
                      if (f) dt.items.add(f);
                    }
                    fileRef.current.files = dt.files;
                    onFile({ target: fileRef.current } as any);
                  }
                }}
                className="w-full aspect-[4/5] rounded-2xl flex flex-col items-center justify-center gap-3 cursor-pointer active:scale-[0.98] transition-transform"
                style={{
                  background: "linear-gradient(135deg, rgba(255,69,141,0.18), rgba(185,100,255,0.10))",
                  border: "1.5px dashed rgba(255,255,255,0.25)",
                }}
              >
                <span className="text-5xl">{kind === "reel" ? "🎬" : kind === "photo" ? "📷" : "📖"}</span>
                <p className="text-white font-semibold text-[0.92rem]">
                  Tap to choose {kind === "photo" ? "a photo" : kind === "story" ? "a photo or video" : allowMultiClips ? "one or more videos" : "a video"}
                </p>
                <p className="text-white/55 text-[0.66rem] px-6">
                  {allowMultiClips
                    ? "Pick multiple clips — we'll merge them into one reel. Drag-and-drop works on desktop."
                    : "From your camera roll or files. Drag-and-drop also works on desktop."}
                </p>
                <span
                  className="text-[0.62rem] mt-1 px-3 py-1 rounded-full"
                  style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.15)", color: "rgba(255,255,255,0.7)" }}
                >
                  {targetLabel} · best for {kind}
                </span>
              </div>

              {/* Camera capture — opens phone's native camera directly.
                  `capture="environment"` (rear cam) for reels/photos;
                  no capture attribute does nothing on desktop, so on
                  desktop we just hide the chip. */}
              <button
                type="button"
                onClick={() => cameraRef.current?.click()}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl active:scale-[0.98] transition-transform"
                style={{
                  background: "linear-gradient(135deg, rgba(91,141,255,0.18), rgba(46,204,113,0.10))",
                  border: "1px solid rgba(255,255,255,0.18)",
                  color: "#fff",
                }}
              >
                <span className="text-2xl">📸</span>
                <span className="flex-1 text-left">
                  <span className="block font-semibold text-[0.86rem]">Take a fresh shot</span>
                  <span className="block text-white/55 text-[0.62rem]">Opens your camera — perfect for in-the-moment reels</span>
                </span>
                <span className="text-white/45 text-lg">›</span>
              </button>
            </div>

            <input
              ref={fileRef}
              type="file"
              accept={accept}
              multiple={allowMultiClips}
              onChange={onFile}
              className="hidden"
            />
            <input
              ref={cameraRef}
              type="file"
              accept={accept}
              capture="environment"
              onChange={onFile}
              className="hidden"
            />

            <p className="text-white/45 text-[0.66rem] mt-5 max-w-xs">
              🛡️ Captions, tags & bios are auto-scrubbed of phone numbers, emails, and off-platform links to keep bookings on StayBid.
            </p>
          </div>
        )}

        {/* Step 2: edit / caption / audio / tags */}
        {step === "edit" && mediaFile && (
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Preview — v113. Enforces the IG-style frame (9:16 reel/story,
                4:5 photo) so the user sees EXACTLY what viewers will see.
                A "Cover · Fit" pill toggles between the cropped feed view
                and a letter-boxed full-frame view so it's obvious what
                gets cut. */}
            <div className="px-4 pt-3 pb-2 shrink-0">
              <div
                className="relative w-full rounded-2xl overflow-hidden bg-black mx-auto"
                style={{
                  // Cap the preview at ~36dvh so the rest of the form fits
                  // even on a short Android viewport. Tall photos still
                  // letterbox cleanly inside this frame.
                  maxHeight: "36dvh",
                  aspectRatio: targetAspect,
                }}
              >
                {isVideo ? (
                  <video
                    src={mediaUrl}
                    className="w-full h-full"
                    style={{ objectFit: previewFit, filter: filterCssFor(filter) }}
                    autoPlay loop muted={!!audio} playsInline
                  />
                ) : (
                  <img
                    src={mediaUrl}
                    alt=""
                    className="w-full h-full"
                    style={{ objectFit: previewFit, filter: filterCssFor(filter) }}
                  />
                )}

                {/* Cover · Fit toggle pill — bottom-right of the preview. */}
                <button
                  type="button"
                  onClick={() => setPreviewFit((f) => f === "cover" ? "contain" : "cover")}
                  className="absolute bottom-2 right-2 px-2.5 py-1 rounded-full text-[0.62rem] font-bold tracking-wide"
                  style={{
                    background: "rgba(0,0,0,0.55)",
                    backdropFilter: "blur(8px)",
                    color: "#fff",
                    border: "1px solid rgba(255,255,255,0.25)",
                  }}
                  aria-label={previewFit === "cover" ? "Show full frame" : "Crop to frame"}
                >
                  {previewFit === "cover" ? "◼ COVER" : "▢ FIT"}
                </button>

                {/* Aspect-ratio hint chip — top-left. */}
                <span
                  className="absolute top-2 left-2 px-2 py-0.5 rounded-full text-[0.58rem] font-bold tracking-wider"
                  style={{
                    background: "rgba(0,0,0,0.45)",
                    backdropFilter: "blur(8px)",
                    color: "rgba(255,215,107,0.95)",
                    border: "1px solid rgba(255,215,107,0.35)",
                  }}
                >
                  {targetLabel.split(" ")[0].toUpperCase()}
                </span>

                {/* v114 — "Cover frame" button. Only for videos. Opens the
                    scrubber sheet so the creator can pick any frame as the
                    poster (matches IG / TikTok "Choose cover"). */}
                {isVideo && (
                  <button
                    type="button"
                    onClick={() => setCoverPickerOpen(true)}
                    className="absolute top-2 right-2 px-2.5 py-1 rounded-full text-[0.6rem] font-bold tracking-wide"
                    style={{
                      background: "rgba(0,0,0,0.55)",
                      backdropFilter: "blur(8px)",
                      color: "#fff",
                      border: "1px solid rgba(255,255,255,0.25)",
                    }}
                  >
                    🖼 Cover frame
                  </button>
                )}

                {/* v117 — clip-count badge. Shows "1 of N" only when extra
                    clips are queued so single-clip uploads stay clean. */}
                {allowMultiClips && isVideo && extraClips.length > 0 && (
                  <span
                    className="absolute bottom-2 left-2 px-2 py-0.5 rounded-full text-[0.58rem] font-bold tracking-wide"
                    style={{
                      background: "linear-gradient(135deg, rgba(46,204,113,0.85), rgba(91,141,255,0.85))",
                      color: "#fff",
                      border: "1px solid rgba(255,255,255,0.35)",
                      backdropFilter: "blur(6px)",
                    }}
                  >
                    🎬 1 of {extraClips.length + 1} · merged
                  </span>
                )}
              </div>

              {/* v117 — Clip strip. Only shown for reels with a video chosen.
                  Lists the primary clip (slot 0) + every extra in order.
                  Each tile has ⬅ / ➡ reorder + ✕ remove. Last tile is a
                  "+ Add clip" affordance until the 10-clip cap. */}
              {allowMultiClips && isVideo && (
                <div
                  className="-mx-4 mt-2 mb-1 px-4 pb-2 overflow-x-auto flex gap-2 hide-scroll items-stretch"
                  style={{ WebkitOverflowScrolling: "touch" }}
                  aria-label="Clip strip — drag or use the chevrons to reorder"
                >
                  {/* Slot 0 — the primary clip. Cannot be removed (closing
                      the composer or hitting Back undoes the upload). */}
                  <div
                    className="shrink-0 flex flex-col items-center gap-1"
                  >
                    <span
                      className="w-14 h-20 rounded-lg overflow-hidden block relative"
                      style={{
                        border: "2px solid rgba(255,215,107,0.85)",
                        boxShadow: "0 0 0 1px rgba(0,0,0,0.4), 0 4px 12px rgba(240,180,41,0.35)",
                      }}
                    >
                      {posterUrl ? (
                        <img src={posterUrl} alt="primary clip" className="w-full h-full object-cover" />
                      ) : (
                        <video src={mediaUrl} className="w-full h-full object-cover" muted playsInline />
                      )}
                      <span
                        className="absolute top-0.5 left-0.5 text-[0.5rem] font-black px-1 rounded"
                        style={{ background: "rgba(0,0,0,0.62)", color: "#ffd76b" }}
                      >
                        1
                      </span>
                    </span>
                    <span className="text-[0.56rem] font-semibold" style={{ color: "#ffd76b" }}>
                      Primary
                    </span>
                  </div>

                  {/* Extra clips — each gets reorder + remove. Reorder swaps
                      with its neighbour. Promote-to-primary is the leftmost
                      action so an out-of-order primary is a single tap away
                      from being swapped without losing the other clips. */}
                  {extraClips.map((c, i) => (
                    <div key={c.id} className="shrink-0 flex flex-col items-center gap-1">
                      <span
                        className="w-14 h-20 rounded-lg overflow-hidden block relative"
                        style={{
                          border: "2px solid rgba(255,255,255,0.22)",
                          boxShadow: "0 4px 10px rgba(0,0,0,0.45)",
                        }}
                      >
                        <video src={c.url} className="w-full h-full object-cover" muted playsInline />
                        <span
                          className="absolute top-0.5 left-0.5 text-[0.5rem] font-black px-1 rounded"
                          style={{ background: "rgba(0,0,0,0.62)", color: "#fff" }}
                        >
                          {i + 2}
                        </span>
                        <button
                          type="button"
                          onClick={() => removeExtraClip(c.id)}
                          aria-label={`Remove clip ${i + 2}`}
                          className="absolute -top-1 -right-1 w-5 h-5 rounded-full flex items-center justify-center text-[0.68rem] font-bold"
                          style={{
                            background: "rgba(255,69,89,0.95)",
                            color: "#fff",
                            border: "2px solid #0a0612",
                            boxShadow: "0 2px 6px rgba(0,0,0,0.6)",
                          }}
                        >
                          ×
                        </button>
                      </span>
                      <span className="flex items-center gap-0.5">
                        <button
                          type="button"
                          onClick={() => promoteExtraClip(c.id)}
                          aria-label={`Make clip ${i + 2} primary`}
                          className="w-5 h-5 rounded-full flex items-center justify-center text-[0.6rem]"
                          style={{
                            background: "rgba(255,215,107,0.18)",
                            border: "1px solid rgba(255,215,107,0.55)",
                            color: "#ffd76b",
                          }}
                        >
                          ★
                        </button>
                        <button
                          type="button"
                          onClick={() => moveExtraClip(c.id, -1)}
                          disabled={i === 0}
                          aria-label={`Move clip ${i + 2} left`}
                          className="w-5 h-5 rounded-full flex items-center justify-center text-[0.6rem]"
                          style={{
                            background: "rgba(255,255,255,0.06)",
                            border: "1px solid rgba(255,255,255,0.18)",
                            color: i === 0 ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.85)",
                          }}
                        >
                          ‹
                        </button>
                        <button
                          type="button"
                          onClick={() => moveExtraClip(c.id, 1)}
                          disabled={i === extraClips.length - 1}
                          aria-label={`Move clip ${i + 2} right`}
                          className="w-5 h-5 rounded-full flex items-center justify-center text-[0.6rem]"
                          style={{
                            background: "rgba(255,255,255,0.06)",
                            border: "1px solid rgba(255,255,255,0.18)",
                            color: i === extraClips.length - 1 ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.85)",
                          }}
                        >
                          ›
                        </button>
                      </span>
                    </div>
                  ))}

                  {/* Add clip tile — hidden once the 10-clip cap is reached
                      (matches the merge module's MAX_CLIPS guard). */}
                  {extraClips.length < 9 && (
                    <button
                      type="button"
                      onClick={() => moreClipsRef.current?.click()}
                      className="shrink-0 flex flex-col items-center gap-1"
                      aria-label="Add another clip to merge into this reel"
                    >
                      <span
                        className="w-14 h-20 rounded-lg flex items-center justify-center"
                        style={{
                          background: "rgba(255,255,255,0.04)",
                          border: "1.5px dashed rgba(255,215,107,0.55)",
                          color: "#ffd76b",
                          fontSize: "1.4rem",
                        }}
                      >
                        +
                      </span>
                      <span className="text-[0.56rem] font-semibold" style={{ color: "rgba(255,255,255,0.7)" }}>
                        Add clip
                      </span>
                    </button>
                  )}
                  <input
                    ref={moreClipsRef}
                    type="file"
                    accept="video/*"
                    multiple
                    onChange={onAddClips}
                    className="hidden"
                  />
                </div>
              )}

              {/* v117 — Soft warning when the browser can't merge locally.
                  Surfaced as a non-blocking note so the creator can still
                  post the primary clip without the merge step. */}
              {mergeUnsupportedNote && (
                <p
                  className="mt-2 text-amber-300 text-[0.7rem] leading-snug px-2"
                  style={{
                    background: "rgba(245,158,11,0.10)",
                    border: "1px solid rgba(245,158,11,0.35)",
                    borderRadius: 10,
                    padding: "8px 10px",
                  }}
                >
                  ⚠️ {mergeUnsupportedNote}
                </p>
              )}

              {/* v114 — IG-style filter strip. Horizontal scroll of named
                  presets, each shown with the actual media as a tiny live
                  thumbnail so the creator can SEE what each filter does.
                  Selecting one applies CSS filter on the preview AND
                  persists on the post so the feed renders the same look. */}
              <div
                className="-mx-4 mt-2 mb-1 px-4 pb-2 overflow-x-auto flex gap-2 hide-scroll"
                style={{ WebkitOverflowScrolling: "touch" }}
              >
                {FILTER_PRESETS.map((f) => {
                  const active = filter === f.id || (filter === null && f.id === "none");
                  return (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setFilter(f.id)}
                      className="shrink-0 flex flex-col items-center gap-1"
                      aria-pressed={active}
                    >
                      <span
                        className="w-12 h-16 rounded-lg overflow-hidden block"
                        style={{
                          border: active ? "2px solid #ffd76b" : "2px solid rgba(255,255,255,0.18)",
                          boxShadow: active ? "0 0 0 1px rgba(0,0,0,0.4), 0 4px 14px rgba(240,180,41,0.45)" : "none",
                          transition: "all 0.18s ease",
                        }}
                      >
                        {/* Use the poster if we have it (fast); fall back to mediaUrl
                            for photos. Apply the filter so each chip previews live. */}
                        <img
                          src={(isVideo ? (posterUrl || "") : mediaUrl) || mediaUrl}
                          alt=""
                          className="w-full h-full object-cover"
                          style={{ filter: f.css }}
                        />
                      </span>
                      <span className="text-[0.58rem] font-semibold" style={{ color: active ? "#ffd76b" : "rgba(255,255,255,0.65)" }}>
                        {f.label}
                      </span>
                    </button>
                  );
                })}
              </div>
              {/* Format warning surfaces here so the user knows BEFORE
                  posting that the file probably won't play in the feed. */}
              {formatWarning && (
                <p
                  className="mt-2 text-amber-300 text-[0.7rem] leading-snug px-2"
                  style={{
                    background: "rgba(245,158,11,0.10)",
                    border: "1px solid rgba(245,158,11,0.35)",
                    borderRadius: 10,
                    padding: "8px 10px",
                  }}
                >
                  ⚠️ {formatWarning}
                </p>
              )}
            </div>

            {/* v113 — scrollable body. Bottom padding reserves space for the
                home-indicator + safe-area so the "Post to your profile"
                button never sits behind the OS gesture bar. The header
                already covers the top notch via paddingTop on the parent. */}
            <div
              className="flex-1 overflow-y-auto px-4 pt-1 space-y-4"
              style={{
                minHeight: 0,
                paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 24px)",
                WebkitOverflowScrolling: "touch",
              }}
            >
              {/* Audio row */}
              <button
                type="button"
                onClick={() => setAudioOpen(true)}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl"
                style={{
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.10)",
                }}
              >
                <span className="text-xl">{audio?.emoji || "🎵"}</span>
                <span className="flex-1 text-left min-w-0">
                  <span className="block text-white text-[0.82rem] font-semibold truncate">
                    {audio ? audio.name : "Original audio"}
                  </span>
                  <span className="block text-white/55 text-[0.62rem] truncate">
                    {audio ? audio.artist : "Tap to choose music"}
                  </span>
                </span>
                <span className="text-white/45 text-base">›</span>
              </button>

              {/* Location row — opens the modern LocationPicker (GPS + search + popular) */}
              <button
                type="button"
                onClick={() => setLocationOpen(true)}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl"
                style={{
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.10)",
                }}
              >
                <span className="text-xl">📍</span>
                <span className="flex-1 text-left min-w-0">
                  <span className="block text-white text-[0.82rem] font-semibold truncate">
                    {location?.name || "Add location"}
                  </span>
                  <span className="block text-white/55 text-[0.62rem] truncate">
                    {location?.lat
                      ? `${location.lat.toFixed(4)}, ${location.lng?.toFixed(4)}`
                      : "Detect via GPS, search any place, or pick a popular city"}
                  </span>
                </span>
                {location ? (
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => { e.stopPropagation(); setLocation(null); }}
                    className="text-red-300 text-[0.74rem] font-semibold mr-1"
                  >Clear</span>
                ) : null}
                <span className="text-white/45 text-base">›</span>
              </button>

              {/* Highlight bucket — optional. Reels/photos tagged with a
                  highlight show up on the user's profile in the matching
                  bucket (Mountains/Beaches/Foodie/Suites/Top picks/Solo
                  or any custom one they've created). Stories don't get
                  this row — they live in their own 24h surface. */}
              {kind !== "story" && (
                <button
                  type="button"
                  onClick={() => setHighlightOpen(true)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl"
                  style={{
                    background: highlight
                      ? "linear-gradient(135deg, rgba(240,180,41,0.14), rgba(255,69,141,0.10))"
                      : "rgba(255,255,255,0.04)",
                    border: highlight
                      ? "1px solid rgba(240,180,41,0.45)"
                      : "1px solid rgba(255,255,255,0.10)",
                  }}
                >
                  <span
                    className="w-9 h-9 rounded-full shrink-0 flex items-center justify-center text-base"
                    style={{ background: "linear-gradient(135deg,#1a1530,#0d1a2e)", border: "2px solid rgba(255,255,255,0.18)" }}
                  >
                    {highlight?.emoji || "✨"}
                  </span>
                  <span className="flex-1 text-left min-w-0">
                    <span className="block text-white text-[0.82rem] font-semibold truncate">
                      {highlight ? highlight.label : "Add to highlight"}
                    </span>
                    <span className="block text-white/55 text-[0.62rem] truncate">
                      {highlight
                        ? "Shows up on your profile in this bucket"
                        : "Mountains · Beaches · Foodie · Suites · or create your own"}
                    </span>
                  </span>
                  {highlight ? (
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => { e.stopPropagation(); setHighlight(null); }}
                      className="text-red-300 text-[0.74rem] font-semibold mr-1"
                    >Clear</span>
                  ) : null}
                  <span className="text-white/45 text-base">›</span>
                </button>
              )}

              {/* Story-only: Save as post toggle. When ON, the story will
                  also appear in the regular feed AND survive past 24h. */}
              {kind === "story" && (
                <button
                  type="button"
                  onClick={() => setSaveAsPost((v) => !v)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left"
                  style={{
                    background: saveAsPost
                      ? "linear-gradient(135deg, rgba(46,204,113,0.18), rgba(91,141,255,0.10))"
                      : "rgba(255,255,255,0.04)",
                    border: saveAsPost
                      ? "1px solid rgba(46,204,113,0.45)"
                      : "1px solid rgba(255,255,255,0.10)",
                  }}
                >
                  <span className="text-xl">💾</span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-white text-[0.82rem] font-semibold truncate">
                      Also save as a post
                    </span>
                    <span className="block text-white/55 text-[0.62rem] leading-snug">
                      {saveAsPost
                        ? "Live for 24h on your story ring AND saved to your profile reels"
                        : "Story disappears after 24 hours unless you turn this on"}
                    </span>
                  </span>
                  <span
                    className="w-10 h-6 rounded-full relative shrink-0 transition-colors"
                    style={{
                      background: saveAsPost ? "linear-gradient(135deg,#2ecc71,#5b8dff)" : "rgba(255,255,255,0.20)",
                    }}
                  >
                    <span
                      className="absolute top-[2px] w-5 h-5 rounded-full bg-white shadow-md transition-all"
                      style={{ left: saveAsPost ? "18px" : "2px" }}
                    />
                  </span>
                </button>
              )}

              {/* Hotel tag row — viewers tap through to the hotel page from
                  the reel, so public-user reels turn into discovery + a
                  direct booking funnel for that property. */}
              <button
                type="button"
                onClick={() => setHotelOpen(true)}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl"
                style={{
                  background: taggedHotel
                    ? "linear-gradient(135deg, rgba(240,180,41,0.14), rgba(255,69,141,0.10))"
                    : "rgba(255,255,255,0.04)",
                  border: taggedHotel
                    ? "1px solid rgba(240,180,41,0.45)"
                    : "1px solid rgba(255,255,255,0.10)",
                }}
              >
                <span
                  className="w-9 h-9 rounded-lg shrink-0 overflow-hidden flex items-center justify-center text-base"
                  style={{ background: "linear-gradient(135deg,#1a1530,#0d1a2e)", border: "1px solid rgba(255,255,255,0.10)" }}
                >
                  {taggedHotel?.image ? (
                    <img src={taggedHotel.image} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <span>🏨</span>
                  )}
                </span>
                <span className="flex-1 text-left min-w-0">
                  <span className="block text-white text-[0.82rem] font-semibold truncate">
                    {taggedHotel ? taggedHotel.name : "Tag a hotel"}
                  </span>
                  <span className="block text-white/55 text-[0.62rem] truncate">
                    {taggedHotel
                      ? (taggedHotel.city ? `📍 ${taggedHotel.city} · viewers can book or bid from this reel` : "viewers can book or bid from this reel")
                      : "Tag a StayBid hotel so viewers can book or bid right from your reel"}
                  </span>
                </span>
                {taggedHotel ? (
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => { e.stopPropagation(); setTaggedHotel(null); }}
                    className="text-red-300 text-[0.74rem] font-semibold mr-1"
                  >Clear</span>
                ) : null}
                <span className="text-white/45 text-base">›</span>
              </button>

              {/* Caption */}
              <div>
                <p className="text-white/55 text-[0.6rem] uppercase tracking-widest mb-1.5">Caption</p>
                <textarea
                  value={caption}
                  onChange={(e) => {
                    setCaption(e.target.value);
                    if (sanitize && !warnedSanitize) {
                      const { blocked } = sanitize(e.target.value);
                      if (blocked) setWarnedSanitize(true);
                    }
                  }}
                  rows={3}
                  maxLength={500}
                  placeholder="Write a caption…"
                  className="ig-comment-input w-full rounded-xl px-3 py-2 text-[0.82rem] outline-none resize-none"
                  style={{
                    color: "#fff",
                    caretColor: "#ffd76b",
                    background: "rgba(255,255,255,0.10)",
                    border: "1px solid rgba(255,255,255,0.20)",
                    minHeight: 70,
                  }}
                />
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {EMOJI_BAR.map((e) => (
                    <button
                      key={e}
                      type="button"
                      onClick={() => insertEmoji(e)}
                      className="px-2 py-1 rounded-full text-base"
                      style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.10)" }}
                    >
                      {e}
                    </button>
                  ))}
                </div>
                {captionPreview && (
                  <p className="mt-2 text-amber-300 text-[0.68rem]">
                    🛡️ Personal contact info will be hidden when posted.
                  </p>
                )}
              </div>

              {/* Tags */}
              <div>
                <p className="text-white/55 text-[0.6rem] uppercase tracking-widest mb-1.5">Tags</p>
                <div className="flex flex-wrap gap-1.5">
                  {TAG_PRESETS.map((t) => {
                    const active = tags.includes(t);
                    return (
                      <button
                        key={t}
                        type="button"
                        onClick={() => toggleTag(t)}
                        className="px-3 py-1 rounded-full text-[0.7rem] font-bold transition-all"
                        style={{
                          background: active ? "linear-gradient(135deg,#ffd76b,#f0b429)" : "rgba(255,255,255,0.05)",
                          color: active ? "#1a1208" : "rgba(255,255,255,0.85)",
                          border: active ? "1px solid rgba(255,255,255,0.45)" : "1px solid rgba(255,255,255,0.10)",
                          boxShadow: active ? "0 2px 6px rgba(240,180,41,0.45), inset 0 1px 0 rgba(255,255,255,0.5)" : "none",
                        }}
                      >
                        #{t}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* v114 — upload progress + retry banner. Surfaces inline so
                  the creator never closes the modal on an invisible error.
                  Same tempId on retry = server-side idempotency holds.
                  v116 — compression phase shown first ("Optimising for fast
                  upload…") so the user knows we're not stuck at 0% upload.
                  v117 — merge phase precedes compression when multi-clip. */}
              {merging && (
                <div className="rounded-xl px-3 py-2.5" style={{ background: "rgba(185,100,255,0.10)", border: "1px solid rgba(185,100,255,0.30)" }}>
                  <p className="text-fuchsia-200 text-[0.74rem] font-semibold mb-1.5">
                    🎬 Stitching your clips… {mergeProgress?.overall ?? 0}%
                    {mergeProgress?.phase === "encode" && typeof mergeProgress.clipIndex === "number" && typeof mergeProgress.clipCount === "number" && (
                      <span className="text-fuchsia-200/70 font-normal"> · clip {mergeProgress.clipIndex + 1} of {mergeProgress.clipCount}</span>
                    )}
                  </p>
                  <p className="text-fuchsia-200/70 text-[0.6rem] mb-1.5 leading-snug">
                    Joining {extraClips.length + 1} clips into one reel — keep this tab open until it finishes.
                  </p>
                  <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.10)" }}>
                    <div
                      className="h-full transition-all"
                      style={{
                        width: `${mergeProgress?.overall ?? 0}%`,
                        background: "linear-gradient(90deg, #b964ff, #ff458d)",
                      }}
                    />
                  </div>
                </div>
              )}
              {compressing && (
                <div className="rounded-xl px-3 py-2.5" style={{ background: "rgba(91,141,255,0.10)", border: "1px solid rgba(91,141,255,0.30)" }}>
                  <p className="text-sky-200 text-[0.74rem] font-semibold mb-1.5">
                    ✨ Optimising for fast upload… {compressionProgress}%
                  </p>
                  <p className="text-sky-200/70 text-[0.6rem] mb-1.5 leading-snug">
                    Re-encoding your video at IG quality so it uploads in seconds (not minutes) — phone never leaves your hand.
                  </p>
                  <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.10)" }}>
                    <div
                      className="h-full transition-all"
                      style={{
                        width: `${compressionProgress}%`,
                        background: "linear-gradient(90deg, #5b8dff, #b964ff)",
                      }}
                    />
                  </div>
                </div>
              )}
              {!compressing && posting && uploadProgress > 0 && (
                <div className="rounded-xl px-3 py-2.5" style={{ background: "rgba(46,204,113,0.10)", border: "1px solid rgba(46,204,113,0.30)" }}>
                  <p className="text-emerald-200 text-[0.74rem] font-semibold mb-1.5">⏫ Uploading… {uploadProgress}%</p>
                  {compressedInfo && compressedInfo.after < compressedInfo.before && (
                    <p className="text-emerald-200/70 text-[0.6rem] mb-1.5">
                      Compressed {(compressedInfo.before/1024/1024).toFixed(1)} MB → {(compressedInfo.after/1024/1024).toFixed(1)} MB
                      {" "}({Math.round((1 - compressedInfo.after / compressedInfo.before) * 100)}% smaller)
                    </p>
                  )}
                  <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.10)" }}>
                    <div
                      className="h-full transition-all"
                      style={{
                        width: `${uploadProgress}%`,
                        background: "linear-gradient(90deg, #2ecc71, #5b8dff)",
                      }}
                    />
                  </div>
                </div>
              )}
              {lastError && (
                <div className="rounded-xl px-3 py-3" style={{ background: "rgba(248,113,113,0.10)", border: "1px solid rgba(248,113,113,0.35)" }}>
                  <p className="text-red-300 text-[0.78rem] font-semibold mb-1">⚠ {lastError}</p>
                  <p className="text-red-200/60 text-[0.66rem] mb-2">
                    Your post is still saved on this device{retryCount > 0 ? ` (attempt ${retryCount + 1})` : ""}.
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={retry}
                      disabled={posting}
                      className="flex-1 rounded-lg py-2 px-3 text-[0.78rem] font-bold disabled:opacity-40"
                      style={{ background: "linear-gradient(135deg, #ff6b6b, #ee5a52)", color: "#fff", border: "1px solid rgba(255,255,255,0.20)" }}
                    >
                      {posting ? "Retrying…" : "↻ Retry upload"}
                    </button>
                    <button
                      onClick={() => { setLastError(""); onPosted(lastAttemptRef.current?.post as any); onClose(); }}
                      className="rounded-lg py-2 px-3 text-[0.74rem] font-semibold"
                      style={{ background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.85)", border: "1px solid rgba(255,255,255,0.18)" }}
                    >
                      Keep local
                    </button>
                  </div>
                </div>
              )}

              {/* Confirm post (extra safety) */}
              <button
                onClick={post}
                disabled={posting || !!lastError}
                className="ig-cta-3d ig-cta-book w-full"
                style={{ padding: "12px", fontSize: "0.86rem" }}
              >
                <span className="ig-cta-icon">⚡</span>
                <span className="ig-cta-text">{posting ? "Posting…" : lastError ? "Tap Retry above" : `Post to your profile`}</span>
              </button>
            </div>
          </div>
        )}
      </div>

      <AudioPicker
        open={audioOpen}
        onClose={() => setAudioOpen(false)}
        current={audio}
        onPick={(t) => setAudio(t)}
      />
      <LocationPicker
        open={locationOpen}
        onClose={() => setLocationOpen(false)}
        current={location}
        onPick={(loc) => setLocation(loc)}
      />
      <HotelPicker
        open={hotelOpen}
        onClose={() => setHotelOpen(false)}
        current={taggedHotel}
        onPick={(h) => setTaggedHotel(h)}
      />
      <HighlightPicker
        open={highlightOpen}
        onClose={() => setHighlightOpen(false)}
        current={highlight}
        onPick={(h) => setHighlight(h)}
      />
      {/* v114 — cover frame picker. Replaces posterUrl with the chosen
          frame so the profile grid + feed poster show what the creator
          wants, not the auto-extracted 0.6s frame. */}
      <CoverFramePicker
        open={coverPickerOpen}
        file={mediaFile}
        onClose={() => setCoverPickerOpen(false)}
        onPick={(dataUrl) => { setPosterUrl(dataUrl); }}
      />
    </div>
  );

  // Portal to <body> when available. SSR (or initial render before
  // hydration) returns the sheet inline so React doesn't blow up — the
  // portal kicks in on the next client render.
  if (typeof document === "undefined") return sheet;
  return createPortal(sheet, document.body);
}

// ─── Combined controller — hosts FAB + sheets together ───────────────────
export function CreateFlow({
  onPosted, sanitize,
}: {
  onPosted?: (post: UserPost) => void;
  sanitize?: (s: string) => { clean: string; blocked: boolean };
}) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [composer, setComposer] = useState<{ open: boolean; kind: ContentKind }>({ open: false, kind: "reel" });

  return (
    <>
      <CreateFAB onClick={() => setSheetOpen(true)} />
      <CreateSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        onPick={(kind) => { setSheetOpen(false); setComposer({ open: true, kind }); }}
      />
      <Composer
        open={composer.open}
        kind={composer.kind}
        onClose={() => setComposer({ open: false, kind: "reel" })}
        onPosted={(p) => { setComposer({ open: false, kind: "reel" }); onPosted?.(p); }}
        sanitize={sanitize}
      />
    </>
  );
}
