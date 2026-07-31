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
  compositeImageWithOverlays,
  type Overlay,
  TEXT_STYLES,
  TEXT_COLORS,
  getTextStyle,
} from "@/lib/social/composite";
import { notify } from "@/lib/notifications";

// v119 — Mention suggestion shape (mirrors what /api/social/users/search
// returns). Lives at module scope so the dropdown + the type-checker
// share one source of truth.
type MentionSuggestion = {
  userId: string;
  handle: string;
  displayName: string;
  avatarUrl?: string | null;
  verified?: boolean;
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
// v572 — it was a bare 36px gold circle sitting directly under the reel's
// right-hand action rail (Like / Comment / Share / Save / More), which are
// also 44px gold-ish glyphs. Read as a sixth rail icon, so people stopped
// finding it once `/` was no longer the reel feed and the composer had to be
// discovered here. Now: bigger, and captioned — the only labelled round
// control on the surface, which is what makes it read as its own thing.
export function CreateFAB({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-label="Create new post"
      className="ig-create-fab"
    >
      <span className="ig-create-fab-disc">
        <span className="ig-create-fab-plus">＋</span>
        <span className="ig-create-fab-glow" aria-hidden />
      </span>
      <span className="ig-create-fab-label" aria-hidden>Create</span>
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
    { kind: "reel",  emoji: "🎬", title: "Reel",  sub: "Up to 60s vertical video · audio, tags & emojis", gradient: "linear-gradient(135deg,#c8d2dc,#5f7c98 55%,#3f5369)" },
    { kind: "photo", emoji: "📷", title: "Photo", sub: "Single image post · caption · tag a hotel",        gradient: "linear-gradient(135deg,#dbe2e8,#b4c1cf 55%,#7089a3)" },
    { kind: "story", emoji: "📖", title: "Story", sub: "24h disappearing photo or video · audio overlay",  gradient: "linear-gradient(135deg,#D9C19A,#8ba0b5 55%,#6E5430)" },
  ];
  const sheet = (
    <div className="fixed inset-0 z-90 flex items-end sm:items-center sm:justify-center sb-cmodal" onClick={onClose}>
      <div className="absolute inset-0" style={{ background: "rgba(15,12,8,0.62)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)" }} />
      <div
        className="relative w-full sm:max-w-md ig-drawer-up"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "linear-gradient(180deg,#2A2417 0%,#1F1A0F 100%)",
          borderTopLeftRadius: 26, borderTopRightRadius: 26,
          borderBottomLeftRadius: 0, borderBottomRightRadius: 0,
          borderTop: "1px solid rgba(176, 192, 209,0.22)",
          boxShadow: "0 -24px 70px rgba(15,12,8,0.7)",
          paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 20px)",
        }}
      >
        <div className="flex justify-center pt-2.5 pb-1.5"><div className="w-10 h-[3px] rounded-full" style={{ background: "rgba(176, 192, 209,0.4)" }} /></div>
        <div className="flex items-center justify-between px-5 pb-1">
          <div>
            <p className="text-[0.6rem] font-bold tracking-[0.18em] uppercase" style={{ color: "#5f7c98" }}>Share your stay</p>
            <p className="font-semibold text-[1.15rem]" style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontStyle: "italic", color: "#f4f6f8" }}>Create</p>
          </div>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onClose(); }}
            onTouchEnd={(e) => { e.stopPropagation(); onClose(); }}
            style={{
              position: "relative", zIndex: 5,
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              width: 36, height: 36, borderRadius: 9999,
              background: "rgba(176, 192, 209,0.10)",
              border: "1px solid rgba(176, 192, 209,0.22)",
              color: "rgba(176, 192, 209,0.85)", fontSize: "1.15rem",
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
              className="cf-create-card w-full flex items-center gap-3.5 p-3.5 rounded-2xl text-left"
            >
              <div
                className="w-12 h-12 rounded-2xl flex items-center justify-center text-2xl shrink-0"
                style={{ background: c.gradient, boxShadow: "0 4px 14px rgba(15,12,8,0.45), inset 0 1px 0 rgba(255,255,255,0.4)" }}
              >
                {c.emoji}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-[0.96rem]" style={{ color: "#f4f6f8" }}>{c.title}</p>
                <p className="text-[0.68rem] mt-0.5" style={{ color: "rgba(176, 192, 209,0.62)" }}>{c.sub}</p>
              </div>
              <span className="text-xl" style={{ color: "rgba(176, 192, 209,0.55)" }}>›</span>
            </button>
          ))}
        </div>
        <style jsx>{`
          .cf-create-card {
            background: linear-gradient(135deg, rgba(176, 192, 209,0.10), rgba(176, 192, 209,0.03));
            border: 1px solid rgba(176, 192, 209,0.16);
            transition: transform 0.14s cubic-bezier(.32,1.2,.36,1), border-color 0.18s ease, background 0.18s ease;
          }
          .cf-create-card:hover {
            border-color: rgba(176, 192, 209,0.42);
            background: linear-gradient(135deg, rgba(176, 192, 209,0.16), rgba(176, 192, 209,0.06));
          }
          .cf-create-card:active { transform: scale(0.98); }
        `}</style>
      </div>
    </div>
  );

  // v546 — portal the chooser to <body>, exactly like the Composer below.
  // On DESKTOP the whole reel controller renders inside .reel-page-root — a
  // position:fixed, overflow:hidden 424px "phone frame" whose inner swipe
  // container uses transforms — which becomes the containing block for any
  // fixed descendant, trapping + clipping this sheet inside that narrow frame
  // (the bug: "create window opens inside the reel feed on desktop"). Rendering
  // it as a direct child of <body> escapes the frame so `fixed inset-0` +
  // .sb-cmodal centering cover the FULL viewport. SSR returns inline (this only
  // ever opens on a client click, so no hydration mismatch).
  if (typeof document === "undefined") return sheet;
  return createPortal(sheet, document.body);
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
    <div className="fixed inset-0 z-93 flex items-end sb-cmodal" onClick={onClose}>
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
            className="w-full rounded-full px-4 py-2.5 text-[0.86rem] outline-hidden"
            style={{
              color: "#fff", caretColor: "#d0d9e1",
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
            <p className="text-[0.6rem] uppercase tracking-widest mb-1.5" style={{ color: "var(--text-muted)" }}>Popular</p>
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
    <div className="fixed inset-0 z-93 flex items-end sb-cmodal" onClick={onClose}>
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
            className="w-full rounded-full px-4 py-2.5 text-[0.86rem] outline-hidden"
            style={{
              color: "#fff", caretColor: "#d0d9e1",
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
    <div className="fixed inset-0 z-94 flex items-end sb-cmodal" onClick={onClose}>
      <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(6px)" }} />
      <div
        className="relative w-full ig-drawer-up sb-ppe"
        onClick={(e) => e.stopPropagation()}
        style={{
          height: "94vh",
          /* v608 — theme-aware sheet (was always-dark purple #15101e → too dark
             in light mode). Light = cozy cream, dark = soft slate night. */
          background: "linear-gradient(180deg, var(--bg-card) 0%, var(--bg-page) 100%)",
          borderTopLeftRadius: 24, borderTopRightRadius: 24,
          borderTop: "1px solid var(--border-soft)",
          boxShadow: "0 -20px 60px rgba(0,0,0,0.4)",
          paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 18px)",
          display: "flex", flexDirection: "column",
        }}
      >
        <div className="flex justify-center pt-2.5 pb-1.5"><div className="w-10 h-[3px] rounded-full" style={{ background: "var(--border-strong)" }} /></div>
        <div className="flex items-center justify-between px-5 pb-2">
          <p className="font-semibold text-[0.92rem]" style={{ color: "var(--text-base)" }}>✏️ Edit profile</p>
          <button
            type="button"
            className="ppe-close"
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
                background: "conic-gradient(from 0deg, #a9b9c8, #6f8aa6, #42566d, #a9b9c8)",
              }}
            >
              <div
                className="w-full h-full rounded-full flex items-center justify-center text-[2.4rem] font-bold overflow-hidden"
                style={{
                  background: "linear-gradient(135deg, #6f8aa6, #42566d)",
                  border: "2px solid var(--bg-card)",
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
                style={{ background: "radial-gradient(88% 64% at 32% 4%,rgba(255,255,255,0.5),transparent 58%),linear-gradient(160deg,#e6edf3 0%,#c9d4df 52%,#a4b5c6 100%)", border: "1px solid rgba(255,255,255,0.45)" }}
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
            <p className="text-[0.6rem] uppercase tracking-widest mb-1.5" style={{ color: "var(--text-muted)" }}>Display name</p>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              maxLength={32}
              className="w-full rounded-xl px-3 py-2 text-[0.86rem] outline-hidden"
              style={{
                color: "var(--text-base)", caretColor: "var(--accent)",
                background: "color-mix(in srgb, var(--accent) 8%, var(--bg-card))",
                border: "1px solid var(--border-strong)",
              }}
            />
          </div>

          {/* Bio */}
          <div className="pb-3">
            <p className="text-[0.6rem] uppercase tracking-widest mb-1.5" style={{ color: "var(--text-muted)" }}>Bio</p>
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="Travel storyteller · Mumbai · Always bidding for the best room"
              rows={3}
              maxLength={280}
              className="w-full rounded-xl px-3 py-2 text-[0.84rem] outline-hidden resize-none"
              style={{
                color: "var(--text-base)", caretColor: "var(--accent)",
                background: "color-mix(in srgb, var(--accent) 8%, var(--bg-card))",
                border: "1px solid var(--border-strong)",
                minHeight: 70,
              }}
            />
            <p className="text-[0.6rem] mt-1" style={{ color: "var(--text-muted)" }}>
              🛡️ Phone numbers, emails and off-platform links are auto-scrubbed when shown.
            </p>
          </div>

          {/* Location */}
          <div className="pb-3">
            <p className="text-[0.6rem] uppercase tracking-widest mb-1.5" style={{ color: "var(--text-muted)" }}>Location</p>
            <input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="📍 Mumbai, India"
              maxLength={80}
              className="w-full rounded-xl px-3 py-2 text-[0.84rem] outline-hidden"
              style={{
                color: "var(--text-base)", caretColor: "var(--accent)",
                background: "color-mix(in srgb, var(--accent) 8%, var(--bg-card))",
                border: "1px solid var(--border-strong)",
              }}
            />
          </div>

          {/* Website */}
          <div className="pb-3">
            <p className="text-[0.6rem] uppercase tracking-widest mb-1.5" style={{ color: "var(--text-muted)" }}>Website</p>
            <input
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              placeholder="https://yourblog.com"
              maxLength={120}
              className="w-full rounded-xl px-3 py-2 text-[0.84rem] outline-hidden"
              style={{
                color: "var(--text-base)", caretColor: "var(--accent)",
                background: "color-mix(in srgb, var(--accent) 8%, var(--bg-card))",
                border: "1px solid var(--border-strong)",
              }}
            />
          </div>

          {/* Custom highlights manager */}
          <div className="pb-3">
            <p className="text-[0.6rem] uppercase tracking-widest mb-1.5" style={{ color: "var(--text-muted)" }}>My highlights</p>
            <p className="text-[0.66rem] mb-2" style={{ color: "var(--text-muted)" }}>
              Built-in highlights (Mountains, Beaches, Foodie, Suites, Top picks, Solo) are always shown. Add custom ones below — they appear on your profile alongside the built-ins.
            </p>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {myCustomHighlights.map((h) => (
                <span key={h.key}
                  className="inline-flex items-center gap-1 pl-2 pr-1 py-1 rounded-full text-[0.74rem] font-semibold"
                  style={{ background: "var(--accent-soft)", border: "1px solid var(--border-soft)", color: "var(--text-base)" }}
                >
                  <span>{h.emoji}</span>
                  <span>{h.label}</span>
                  <button
                    type="button"
                    onClick={() => removeCustomHighlight(h.key)}
                    className="ml-1 w-5 h-5 rounded-full flex items-center justify-center text-[0.7rem]"
                    style={{ background: "rgba(106,133,160,0.22)", color: "var(--accent)" }}
                    aria-label={`Remove ${h.label}`}
                  >✕</button>
                </span>
              ))}
              {myCustomHighlights.length === 0 && (
                <span className="text-[0.7rem]" style={{ color: "var(--text-muted)" }}>No custom highlights yet.</span>
              )}
            </div>
            <div className="flex gap-2 items-stretch">
              <input
                value={hlEmoji}
                onChange={(e) => setHlEmoji(e.target.value.slice(0, 4) || "✨")}
                maxLength={4}
                className="w-14 rounded-xl px-2 py-2 text-[0.86rem] outline-hidden text-center"
                style={{
                  color: "#fff", caretColor: "#d0d9e1",
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
                className="flex-1 rounded-xl px-3 py-2 text-[0.84rem] outline-hidden"
                style={{
                  color: "#fff", caretColor: "#d0d9e1",
                  background: "rgba(255,255,255,0.10)",
                  border: "1px solid rgba(255,255,255,0.20)",
                }}
              />
              <button
                type="button"
                onClick={addHighlight}
                disabled={!hlLabel.trim()}
                className="px-3 rounded-xl text-[0.78rem] font-bold text-black disabled:opacity-40"
                style={{ background: "radial-gradient(88% 64% at 32% 4%,rgba(255,255,255,0.5),transparent 58%),linear-gradient(160deg,#e6edf3 0%,#c9d4df 52%,#a4b5c6 100%)", border: "1px solid rgba(255,255,255,0.45)" }}
              >
                + Add
              </button>
            </div>
          </div>
        </div>

        <div className="px-5 pt-1">
          <button
            onClick={save}
            className="w-full rounded-2xl font-bold flex items-center justify-center gap-2"
            style={{
              padding: "12px", fontSize: "0.86rem", color: "#ffffff",
              background: "radial-gradient(88% 64% at 32% 4%,rgba(240,247,253,0.24),transparent 58%),linear-gradient(160deg,#a0b2c6 0%,#6f8aa6 50%,#42566d 100%)",
              textShadow: "0 1px 1px rgba(20,30,44,0.35)",
              boxShadow: "0 8px 22px -8px rgba(45,62,82,0.55), inset 0 1px 0 rgba(255,255,255,0.4)",
            }}
          >
            <span>✓</span>
            <span>Save profile</span>
          </button>
        </div>

        <p className="px-5 pt-2 text-[0.58rem] text-center" style={{ color: "var(--text-muted)" }}>
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
    <div className="fixed inset-0 z-93 flex items-end sb-cmodal" onClick={onClose}>
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
              style={{ background: "linear-gradient(135deg, rgba(140, 160, 182,0.14), rgba(255,69,141,0.10))", border: "1px solid rgba(140, 160, 182,0.45)" }}
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
                    ? "linear-gradient(135deg, rgba(140, 160, 182,0.18), rgba(255,69,141,0.12))"
                    : "rgba(255,255,255,0.05)",
                  border: active ? "1px solid rgba(140, 160, 182,0.55)" : "1px solid rgba(255,255,255,0.10)",
                  boxShadow: active ? "0 4px 14px rgba(140, 160, 182,0.20)" : "none",
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
              style={{ background: "radial-gradient(88% 64% at 32% 4%,rgba(255,255,255,0.5),transparent 58%),linear-gradient(160deg,#e6edf3 0%,#c9d4df 52%,#a4b5c6 100%)", border: "1px solid rgba(255,255,255,0.45)" }}
            >
              + New highlight
            </button>
          ) : (
            <div className="flex gap-2 items-stretch">
              <input
                value={hlEmoji}
                onChange={(e) => setHlEmoji(e.target.value.slice(0, 4) || "✨")}
                maxLength={4}
                className="w-14 rounded-xl px-2 py-2 text-[0.86rem] outline-hidden text-center"
                style={{
                  color: "#fff", caretColor: "#d0d9e1",
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
                className="flex-1 rounded-xl px-3 py-2 text-[0.84rem] outline-hidden"
                style={{
                  color: "#fff", caretColor: "#d0d9e1",
                  background: "rgba(255,255,255,0.10)",
                  border: "1px solid rgba(255,255,255,0.20)",
                }}
              />
              <button
                onClick={create}
                disabled={!hlLabel.trim()}
                className="px-3 rounded-xl text-[0.78rem] font-bold text-black disabled:opacity-40"
                style={{ background: "radial-gradient(88% 64% at 32% 4%,rgba(255,255,255,0.5),transparent 58%),linear-gradient(160deg,#e6edf3 0%,#c9d4df 52%,#a4b5c6 100%)", border: "1px solid rgba(255,255,255,0.45)" }}
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
    <div className="fixed inset-0 z-92 flex items-end sb-cmodal" onClick={onClose}>
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
            className="ig-comment-input w-full rounded-full px-4 py-2 text-[0.82rem] outline-hidden"
            style={{ color: "#fff", caretColor: "#d0d9e1", background: "rgba(255,255,255,0.10)", border: "1px solid rgba(255,255,255,0.20)" }}
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
                  background: active ? "radial-gradient(88% 64% at 32% 4%,rgba(255,255,255,0.5),transparent 58%),linear-gradient(160deg,#e6edf3 0%,#c9d4df 52%,#a4b5c6 100%)" : "rgba(255,255,255,0.06)",
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
                background: "linear-gradient(135deg, rgba(140, 160, 182,0.14), rgba(255,69,141,0.10))",
                border: "1px solid rgba(140, 160, 182,0.32)",
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
                  background: "radial-gradient(88% 64% at 32% 4%,rgba(255,255,255,0.5),transparent 58%),linear-gradient(160deg,#e6edf3 0%,#c9d4df 52%,#a4b5c6 100%)",
                  boxShadow: "0 6px 18px rgba(140, 160, 182,0.45), inset 0 1px 0 rgba(255,255,255,0.5)",
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
                  background: active ? "rgba(140, 160, 182,0.14)" : "rgba(255,255,255,0.03)",
                  border: `1px solid ${active ? "rgba(140, 160, 182,0.45)" : "rgba(255,255,255,0.08)"}`,
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
                  style={{ background: "radial-gradient(88% 64% at 32% 4%,rgba(255,255,255,0.5),transparent 58%),linear-gradient(160deg,#e6edf3 0%,#c9d4df 52%,#a4b5c6 100%)", border: "1px solid rgba(255,255,255,0.45)", boxShadow: "0 2px 6px rgba(140, 160, 182,0.45)" }}
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
// ─── v119 Overlay emoji picker ─────────────────────────────────────────
// Lightweight bottom sheet listing the 64 most-popular emojis. Picking
// one adds it as a fresh centred overlay (then the user can drag / pinch
// it). Native emoji rendering — no images, no extra bundle weight.
const OVERLAY_EMOJI_LIST: string[] = [
  "❤️","🔥","✨","🌟","💫","🌈","☀️","🌙","🏖️","🏔️",
  "🏨","🏰","🛏️","🍷","🍾","🥂","🍔","🍕","🍣","🥐",
  "🍩","☕","🍹","🌴","🌊","🌅","🌄","🌃","🌆","🎉",
  "🎊","🎁","🪩","🎵","📸","🎬","🌹","🌷","🌸","🦋",
  "🐬","🐠","🐢","🦜","🐕","🐈","✈️","🚗","🚤","⛵",
  "🚁","🚀","🗺️","🧳","🏝️","⛰️","🏞️","🏛️","🌋","🏯",
  "💎","👑","💰","🤩",
];

export function OverlayEmojiPicker({
  open, onClose, onPick,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (emoji: string) => void;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-1100 flex items-end sb-cmodal"
      onClick={onClose}
      style={{ isolation: "isolate" }}
    >
      <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.6)" }} />
      <div
        className="relative w-full ig-drawer-up"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "linear-gradient(180deg,#15101e,#0a0612)",
          borderTop: "1px solid rgba(255,255,255,0.12)",
          borderRadius: "20px 20px 0 0",
          padding: "16px 12px calc(env(safe-area-inset-bottom, 0px) + 16px)",
          maxHeight: "60dvh",
          overflowY: "auto",
        }}
      >
        <div className="flex items-center justify-between px-2 mb-3">
          <p className="text-white font-semibold text-[0.92rem]">Add an emoji</p>
          <button onClick={onClose} className="text-white/65 text-[0.84rem]">Cancel</button>
        </div>
        <div className="grid grid-cols-8 gap-1">
          {OVERLAY_EMOJI_LIST.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => onPick(e)}
              className="rounded-lg active:scale-95 transition-transform"
              style={{
                fontSize: "1.5rem",
                padding: "6px 0",
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.08)",
              }}
            >{e}</button>
          ))}
        </div>
      </div>
    </div>
  );
}

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
  // v120 — IG-style continuous timeline. 16 thumbs sit in a single row;
  // a gold marker glides over them as the user drags. Tap a thumb to
  // snap. Tap "Set cover" to commit.
  const TIMELINE_THUMBS = 16;
  const [duration, setDuration] = useState(0);
  const [scrub, setScrub] = useState(0);
  const [thumbs, setThumbs] = useState<{ t: number; src: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const urlRef   = useRef<string>("");
  const timelineRef = useRef<HTMLDivElement | null>(null);

  // Build a single object URL for the source video for live scrubbing.
  useEffect(() => {
    if (!open || !file) return;
    const u = URL.createObjectURL(file);
    urlRef.current = u;
    return () => { try { URL.revokeObjectURL(u); } catch {} };
  }, [open, file]);

  // Pre-extract a strip of evenly-spaced thumbnails so the user has a
  // continuous timeline view (matches IG / TikTok cover selection).
  useEffect(() => {
    if (!open || !file) return;
    let cancelled = false;
    (async () => {
      // Probe duration first.
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
      // v120 — 16-thumb timeline. Skip a hair off both ends to dodge
      // black opening / closing frames common in phone footage.
      const inner = dur * 0.92;
      const offset = (dur - inner) / 2;
      const slots = Array.from({ length: TIMELINE_THUMBS }, (_, i) =>
        offset + (inner * (i + 0.5)) / TIMELINE_THUMBS
      );
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

  // v120 — pointer-driven timeline scrub. Reads clientX vs the strip's
  // bounding rect to compute the new time. Works on touch + mouse.
  const onTimelinePointer = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!duration) return;
    const el = timelineRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - r.left) / Math.max(1, r.width)));
    const t = ratio * duration;
    setScrub(t);
    const v = videoRef.current;
    if (v) { try { v.currentTime = t; } catch {} }
  };

  if (!open) return null;
  const markerPct = duration > 0 ? Math.max(0, Math.min(100, (scrub / duration) * 100)) : 0;
  return (
    <div className="fixed inset-0 z-97 flex items-end" onClick={onClose}>
      <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.82)", backdropFilter: "blur(10px)" }} />
      <div
        className="relative w-full"
        onClick={(e) => e.stopPropagation()}
        style={{
          height: "100dvh",
          maxHeight: "100dvh",
          background: "linear-gradient(180deg,#15101e 0%,#0a0612 100%)",
          borderTop: "1px solid rgba(255,255,255,0.14)",
          display: "flex", flexDirection: "column",
          paddingTop: "env(safe-area-inset-top, 0px)",
          paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 14px)",
        }}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-white/10 shrink-0">
          <button onClick={onClose} className="text-white/85 text-[0.84rem] py-1 px-2 -mx-2">Cancel</button>
          <p className="text-white font-semibold text-[0.92rem]">🖼 Cover frame</p>
          <button
            onClick={pickAtScrub}
            disabled={busy}
            className="font-bold text-[0.84rem] py-1 px-2 -mx-2"
            style={{ color: busy ? "rgba(176, 192, 209,0.35)" : "#d0d9e1" }}
          >
            {busy ? "Saving…" : "Set cover"}
          </button>
        </div>

        {/* Big live preview. Fills the available vertical space minus the
            bottom timeline. 9:16 letterboxed inside a centered frame so
            the cover frame is shown at the same aspect viewers see. */}
        <div className="flex-1 relative flex items-center justify-center px-4 py-4" style={{ minHeight: 0 }}>
          <div
            className="relative bg-black rounded-2xl overflow-hidden"
            style={{ aspectRatio: "9/16", height: "100%", maxHeight: "100%", maxWidth: "100%" }}
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
            {/* Top-left chip: live time + total duration */}
            <span
              className="absolute top-2 left-2 px-2.5 py-1 rounded-full text-[0.66rem] font-bold tracking-wide"
              style={{
                background: "rgba(0,0,0,0.55)",
                color: "#d0d9e1",
                border: "1px solid rgba(176, 192, 209,0.35)",
                backdropFilter: "blur(8px)",
              }}
            >
              {scrub.toFixed(1)}s / {duration ? duration.toFixed(1) : "…"}s
            </span>
            {/* Top-right chip: drag-to-scrub hint, fades after 1.6s */}
            <span
              className="absolute top-2 right-2 px-2 py-0.5 rounded-full text-[0.58rem] font-medium tracking-wide pointer-events-none"
              style={{
                background: "rgba(0,0,0,0.45)",
                backdropFilter: "blur(6px)",
                color: "rgba(255,255,255,0.78)",
                border: "1px solid rgba(255,255,255,0.18)",
              }}
            >
              drag strip below ›
            </span>
          </div>
        </div>

        {/* v120 — Continuous timeline strip. Thumbnails fill the row; a
            gold marker reflects the current scrub position. Drag or
            tap anywhere on the strip to pick. */}
        <div className="shrink-0 px-3 pb-3">
          <div
            ref={timelineRef}
            className="relative rounded-xl overflow-hidden"
            style={{
              height: 56,
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.10)",
              touchAction: "none",
              cursor: "grab",
            }}
            onPointerDown={(e) => {
              (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
              onTimelinePointer(e);
            }}
            onPointerMove={(e) => {
              if (e.buttons === 0 && e.pointerType !== "touch") return;
              onTimelinePointer(e);
            }}
          >
            {thumbs.length === 0 ? (
              <div className="absolute inset-0 flex items-center justify-center text-white/50 text-[0.72rem]">
                Extracting frames…
              </div>
            ) : (
              <div className="flex h-full">
                {thumbs.map((th, i) => (
                  <img
                    key={i}
                    src={th.src}
                    alt=""
                    className="h-full object-cover"
                    style={{ flex: "1 1 0", minWidth: 0, pointerEvents: "none" }}
                    draggable={false}
                  />
                ))}
              </div>
            )}
            {/* Marker — gold vertical bar with a top handle dot. */}
            {duration > 0 && (
              <>
                <div
                  className="absolute top-0 bottom-0 pointer-events-none"
                  style={{
                    left: `${markerPct}%`,
                    transform: "translateX(-50%)",
                    width: 3,
                    background: "linear-gradient(180deg,#dce3e9,#a9b9c8)",
                    boxShadow: "0 0 0 1px rgba(0,0,0,0.55), 0 0 12px rgba(140, 160, 182,0.65)",
                  }}
                />
                <div
                  className="absolute pointer-events-none"
                  style={{
                    left: `${markerPct}%`,
                    top: -4,
                    transform: "translateX(-50%)",
                    width: 14,
                    height: 14,
                    borderRadius: 999,
                    background: "#d0d9e1",
                    border: "2px solid #0a0612",
                    boxShadow: "0 2px 6px rgba(0,0,0,0.55), 0 0 10px rgba(140, 160, 182,0.6)",
                  }}
                />
              </>
            )}
          </div>
          <p className="text-center text-white/55 text-[0.62rem] mt-2">
            This frame shows in your feed + profile grid until viewers tap play.
          </p>
        </div>
      </div>

      <style jsx global>{`
        .hide-scroll::-webkit-scrollbar { display: none; }
        .hide-scroll { scrollbar-width: none; }
        /* v609 — theme-aware Edit-profile sheet. Only simple element/class
           selectors here (Stylis in styled-jsx drops a whole global block on
           an attribute selector like [class*=…] — that was the v608 bug that
           made every field invisible in light mode). Labels/close/handle are
           themed inline instead. */
        .sb-ppe input, .sb-ppe textarea {
          color: var(--text-base) !important;
          background: color-mix(in srgb, var(--accent) 7%, var(--bg-card)) !important;
          border: 1px solid var(--border-strong) !important;
          caret-color: var(--accent) !important;
        }
        .sb-ppe input::placeholder, .sb-ppe textarea::placeholder {
          color: var(--text-muted) !important; opacity: 0.85;
        }
        .sb-ppe .ppe-close {
          background: var(--accent-soft) !important;
          border-color: var(--border-soft) !important;
          color: var(--text-base) !important;
        }
      `}</style>
    </div>
  );
}

// ─── Composer (the multi-step compose modal) ─────────────────────────────
// Tier-system Phase 4 additive: a `tierContext` prop pipes through to
// runUpload, which routes the final POST to /api/social/posts/verified-guest
// or /api/social/posts/community when set. When undefined (the existing
// path), the POST still targets /api/social/posts exactly as before.
export type ComposerTierContext =
  | { kind: "verified_guest"; hotelId: string; bookingId: string }
  | {
      kind: "community_contributor";
      hotelId: string;
      locationVerificationId: string;
    };

export function Composer({
  open, kind, onClose, onPosted, sanitize, tierContext,
}: {
  open: boolean;
  kind: ContentKind;
  onClose: () => void;
  onPosted: (post: UserPost) => void;
  /** Phase 4 tier-system routing context. Undefined = legacy behavior. */
  tierContext?: ComposerTierContext;
  /**
   * Caption sanitizer hook — caller supplies the same anti-bypass guard
   * used elsewhere so phone/email/social-handle leaks are scrubbed before
   * posting. Returns the masked caption + whether anything was blocked.
   */
  sanitize?: (s: string) => { clean: string; blocked: boolean };
}) {
  const [step, setStep] = useState<"pick" | "edit">("pick");
  // v120 — within "edit" we now have two screens: fullscreen media compose
  // (filters / overlays / cover-frame / audio) → details (caption / tags /
  // location / hotel / highlight). Matches IG/TikTok's two-step Post flow.
  const [subStep, setSubStep] = useState<"compose" | "details">("compose");
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
  // v118 — IG-style swipe-to-change-filter. Pointer-driven horizontal
  // swipe on the preview frame cycles through FILTER_PRESETS. Right→left
  // = next, left→right = previous. Vertical drag (page scroll) is
  // explicitly NOT hijacked — we only commit a swipe when |Δx| > |Δy| AND
  // |Δx| > THRESHOLD. After a successful swap the chosen filter's label
  // floats over the preview for ~700ms so the user gets confirmation
  // without having to look at the filter strip.
  const [swipeHintLabel, setSwipeHintLabel] = useState<string>("");
  const swipeHintTimerRef = useRef<number | null>(null);
  const swipeStartRef = useRef<{ x: number; y: number; t: number; id: number } | null>(null);
  const swipeMovedRef = useRef<boolean>(false); // true once movement clearly looked horizontal — blocks Cover-frame tap-through

  // v119 — Free-position overlays (text + emoji). Stored in normalised
  // 0-1 coords relative to the preview frame so they map cleanly to
  // whatever the output canvas dimensions end up being (photo: native
  // res ≤1440px longest side; video: ≤1080px). Drag/scale/rotate
  // happens via pointer events on individual overlay DOM nodes; the
  // composite step at Post-time burns them into the final blob.
  const [overlays, setOverlays] = useState<Overlay[]>([]);
  const [selectedOverlayId, setSelectedOverlayId] = useState<string>("");
  const [overlayEditingId, setOverlayEditingId] = useState<string>(""); // currently typing into THIS text overlay
  const [overlayPickerOpen, setOverlayPickerOpen] = useState<"emoji" | null>(null);
  // Tracks the active drag/scale gesture per pointer so multitouch pinch
  // is bulletproof (two simultaneous pointers = pinch; one = drag).
  const overlayPointersRef = useRef<Map<number, { x: number; y: number; overlayId: string }>>(new Map());
  const overlayGestureRef = useRef<{
    overlayId: string;
    mode: "drag" | "pinch";
    startX: number;
    startY: number;
    startOverlayX: number;
    startOverlayY: number;
    pinchStartDist?: number;
    pinchStartScale?: number;
    pinchStartAngle?: number;
    pinchStartRot?: number;
  } | null>(null);
  // Preview frame ref — needed to map pointer client coords back into
  // 0-1 normalised overlay coords.
  const previewFrameRef = useRef<HTMLDivElement | null>(null);

  // v119 — @mention suggestion dropdown. The state is split into:
  //   • `mentionActive`     : true while user is mid-mention (typed `@`
  //                           and hasn't typed a space/newline yet)
  //   • `mentionQuery`      : the chars AFTER the `@` (live debounced)
  //   • `mentionAnchorPos`  : caret offset of the `@` itself, so insertion
  //                           can replace `@<query>` with `@<handle> `
  //   • `mentionSuggestions`: latest top-8 result array
  const [mentionActive, setMentionActive] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionAnchorPos, setMentionAnchorPos] = useState(0);
  const [mentionSuggestions, setMentionSuggestions] = useState<MentionSuggestion[]>([]);
  const mentionSearchAbortRef = useRef<AbortController | null>(null);
  const captionRef = useRef<HTMLTextAreaElement | null>(null);
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
  const fileRef = useRef<HTMLInputElement | null>(null);
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
  // v120.1 — `updatePost` no longer needed here. runUpload returns the
  // server metadata directly, and post()/retry() addPost a freshly-built
  // entry that already has the durable id + Storage URLs.
  const { addPost } = usePosts();

  // Reset when reopened
  // v120 — IG-style filter bottom-sheet. The composer no longer ships a
  // permanent filter STRIP under the preview; swipe + the floating name
  // label already convey "filter changes on swipe". The sheet opens
  // on-demand from the right-rail ✨ button when the user wants to pick
  // a specific filter rather than swiping through.
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);

  useEffect(() => {
    if (open) {
      setStep("pick");
      setSubStep("compose");
      setFilterSheetOpen(false);
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
      // v119 — overlay + mention state. Always start clean so each new
      // composer session is a blank canvas.
      setOverlays([]);
      setSelectedOverlayId("");
      setOverlayEditingId("");
      setOverlayPickerOpen(null);
      setMentionActive(false);
      setMentionQuery("");
      setMentionSuggestions([]);
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

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
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
    setStep("edit");
  };

  const toggleTag = (t: string) => {
    setTags((prev) => prev.includes(t) ? prev.filter((p) => p !== t) : [...prev, t]);
  };

  const insertEmoji = (e: string) => setCaption((c) => c + e);

  // v114 — pulled out so the Retry button can re-run the same upload with
  // the SAME tempId (clientPostId stays stable -> server idempotency holds,
  // so multiple "Retry" taps will never duplicate posts on social_posts).
  //
  // v120.1 — returns server-side metadata (serverId, durable Storage URLs,
  // uploaded soundUrl) so the caller can commit the FINAL post entry to
  // PostsStore with correct cross-session-stable values. The previous
  // contract (returning only {ok, error}) forced the caller to addPost
  // the original blob-URL-based userPost — leaving PostsStore with dead
  // blob URLs for media + audio AND a tempId that didn't match the remote
  // social_posts row id. That mismatch caused:
  //   1. /me to show local + remote as TWO grid tiles (id-only dedup)
  //   2. The feed to play the dead audio blob URL → "silent" audio
  //   3. The feed to show the ORIGINAL video (no overlays) instead of
  //      the compressed/overlay-burned blob the server actually stored
  type RunUploadOk = {
    ok: true;
    serverId: string;          // social_posts row id (durable across sessions)
    serverMedia: string;       // public Storage URL of the FINAL (compressed/overlay-burned) media
    serverPoster: string;      // public Storage URL of the poster JPEG
    serverSoundUrl: string;    // public Storage URL of the attached audio (empty when none)
  };
  type RunUploadFail = { ok: false; error: string };
  const runUpload = useCallback(async (tempId: string, post: UserPost): Promise<RunUploadOk | RunUploadFail> => {
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
      const isVideoPost = mediaType === "REEL" || mediaType === "STORY" || (post.mediaMime || "").startsWith("video/");
      // v119 — overlay composite. Photos get a synchronous canvas
      // re-render with overlays burned in; videos route their overlays
      // through compressVideo's per-frame draw. Either way, the result
      // blob is what we upload, and the user's selections live INSIDE
      // the media (no client-side overlay needed at playback time).
      const overlaysSnapshot = overlays.slice();

      if (!isVideoPost && overlaysSnapshot.length > 0) {
        try {
          setCompressing(true);
          setCompressionProgress(0);
          const srcBlob = await fetch(post.mediaUrl).then((r) => r.blob());
          const result = await compositeImageWithOverlays(srcBlob, overlaysSnapshot);
          const newUrl = URL.createObjectURL(result.blob);
          uploadBlobUrl = newUrl;
          uploadMime    = result.mime;
          setCompressedInfo({ before: srcBlob.size, after: result.blob.size });
          setCompressionProgress(100);
        } catch (e: any) {
          setCompressing(false);
          return { ok: false, error: e?.message || "Couldn't draw overlays onto your photo. Tap Retry." };
        } finally {
          setCompressing(false);
        }
      }

      if (isVideoPost) {
        try {
          setCompressing(true);
          setCompressionProgress(0);
          const srcBlob = await fetch(post.mediaUrl).then((r) => r.blob());
          // v119 — pass overlays to compressVideo so they're burned into
          // every frame. compressVideo forces re-encode when overlays are
          // present (small-source-skip is disabled in that branch).
          // v120 — IG-style hard duration cap: 60s for reels, 90s for
          // stories. The compressor auto-trims past this so a long phone
          // clip lands as the first 60/90s instead of failing the upload.
          const maxDurationS = post.kind === "story" ? 90 : 60;
          const result = await compressVideo(
            srcBlob,
            (pct) => setCompressionProgress(Math.round(pct)),
            overlaysSnapshot.length > 0 ? overlaysSnapshot : undefined,
            { maxDurationS },
          );
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
        posterDataUrl: post.posterUrl?.startsWith("data:") ? post.posterUrl : undefined,
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

      // Tier-system Phase 4 additive: route the POST based on tierContext.
      // When undefined (overwhelming majority of uploads), behavior is byte-
      // identical to pre-Phase-4 — POST hits /api/social/posts as it always has.
      // When set, POST hits the verified-guest or community endpoint with
      // booking_id / locationVerificationId already validated by Phase 2.
      // Hotel id is forced from tierContext (overrides post.taggedHotel) so
      // a user can't decouple their content from the booking they verified.
      let postEndpoint = "/api/social/posts";
      const extraBody: Record<string, any> = {};
      if (tierContext?.kind === "verified_guest") {
        postEndpoint = "/api/social/posts/verified-guest";
        extraBody.hotelId = tierContext.hotelId;
        extraBody.bookingId = tierContext.bookingId;
      } else if (tierContext?.kind === "community_contributor") {
        postEndpoint = "/api/social/posts/community";
        extraBody.hotelId = tierContext.hotelId;
        extraBody.locationVerificationId = tierContext.locationVerificationId;
      }

      const r = await fetch(postEndpoint, {
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
          hotelId:       extraBody.hotelId || post.taggedHotel?.id || undefined,
          locationName:  post.location?.name  || undefined,
          locationLat:   typeof post.location?.lat === "number" ? post.location.lat : undefined,
          locationLng:   typeof post.location?.lng === "number" ? post.location.lng : undefined,
          highlightKey:  post.highlight?.key || undefined,
          filter:        post.filter || undefined,
          ...extraBody,
        }),
      });
      setUploadProgress(98);
      if (!r.ok) return { ok: false, error: `Server returned ${r.status}. Tap Retry.` };
      const json = await r.json().catch(() => null);
      const serverId = json?.post?.id ? String(json.post.id) : "";
      const serverMedia = json?.post?.media_url || uploaded.mediaUrl;
      const serverPoster = json?.post?.thumbnail_url || uploaded.thumbnailUrl || post.posterUrl || "";
      const serverSoundUrl = (soundUrl && post.audio) ? soundUrl : "";
      setUploadProgress(100);
      // v120.1 — return durable server values. The caller (post() / retry())
      // is responsible for committing to PostsStore with these, so the
      // local entry's id matches the remote row + the media/audio URLs
      // are public Storage URLs (not blobs) from the first render. The
      // legacy updatePost(tempId, ...) call here was a no-op anyway —
      // v118's "addPost only after success" contract means the local
      // entry doesn't exist yet at this point.
      return { ok: true, serverId, serverMedia, serverPoster, serverSoundUrl };
    } catch (err: any) {
      const msg = err?.message?.includes("Storage upload failed")
        ? "Couldn't upload media (network / file format)."
        : (err?.message || "Upload failed.");
      return { ok: false, error: msg };
    }
    // v119 — `overlays` in deps so the callback captures the latest set
    // every time the user adds/drags/resizes. Recreating the callback is
    // cheap; we only INVOKE it once per Post click via post()/retry().
    // v120.1 — `updatePost` no longer used inside runUpload (the caller
    // commits the final entry via addPost). Removed from deps.
    // Phase 4 tier-system: tierContext drives the POST endpoint + extra
    // body fields. Must be in deps so a freshly-passed context is used.
  }, [overlays, tierContext]);

  // Holds the most recently attempted post payload so the Retry button can
  // re-run runUpload without losing the user's selections.
  const lastAttemptRef = useRef<{ tempId: string; post: UserPost } | null>(null);

  const retry = useCallback(async () => {
    if (!lastAttemptRef.current) return;
    setLastError("");
    setRetryCount((c) => c + 1);
    setPosting(true);
    setUploadProgress(0);
    const { tempId, post } = lastAttemptRef.current;
    const result = await runUpload(tempId, post);
    setPosting(false);
    if (result.ok) {
      // v120.1 — commit with SERVER metadata so PostsStore has durable
      // values (matching remote row id, public Storage URLs for media +
      // audio). See runUpload's type doc for the trio-of-bugs this fixes.
      const finalPost: UserPost = {
        ...post,
        id: result.serverId || post.id,
        mediaUrl: result.serverMedia || post.mediaUrl,
        posterUrl: result.serverPoster || post.posterUrl,
        audio: result.serverSoundUrl && post.audio
          ? { name: post.audio.name, url: result.serverSoundUrl }
          : post.audio,
      };
      try {
        addPost({ ...finalPost, uploadStatus: "uploaded" } as StoreUserPost);
      } catch {}
      notify({ kind: "success", title: "Shared to your profile", body: "Your post is safe across devices and re-logins." });
      onPosted(finalPost);
      onClose();
    } else {
      setLastError(result.error || "Upload failed. Tap Retry.");
    }
  }, [runUpload, onPosted, onClose, addPost]);

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
    // v118 — DO NOT commit to PostsStore yet. The previous behaviour added
    // the entry optimistically before upload, which left a zombie row in
    // localStorage if the upload failed OR the user closed the composer
    // mid-flow. The user's "You" tab + grid then showed media that didn't
    // exist anywhere on the server. Now we only commit on success. The
    // retry path still has the full post payload in lastAttemptRef so the
    // user keeps their caption + filter + tags intact across retries.
    lastAttemptRef.current = { tempId, post: userPost };

    // v114 — await the upload. On success: commit to PostsStore + close +
    // success toast. On failure: KEEP the modal open and surface a retry
    // banner. The tempId is stable across retries so the server-side
    // `client_post_id` deduplication still holds.
    runUpload(tempId, userPost).then((result) => {
      setPosting(false);
      if (result.ok) {
        // v120.1 — commit with SERVER metadata so PostsStore matches the
        // remote social_posts row (id + media + audio + poster all stable
        // across sessions). The previous code committed the original
        // userPost which kept tempId + dead blob URLs → 3 cascading bugs:
        //   1. /me showed 1 local + 1 remote = 2 grid copies per upload
        //   2. Feed played dead blob audio.url → "silent" custom audio
        //   3. Feed loaded ORIGINAL video (no overlays) instead of the
        //      compressed-with-overlays blob the server actually stored
        const finalPost: UserPost = {
          ...userPost,
          id: result.serverId || userPost.id,
          mediaUrl: result.serverMedia || userPost.mediaUrl,
          posterUrl: result.serverPoster || userPost.posterUrl,
          audio: result.serverSoundUrl && userPost.audio
            ? { name: userPost.audio.name, url: result.serverSoundUrl }
            : userPost.audio,
        };
        try {
          addPost({ ...finalPost, uploadStatus: "uploaded" } as StoreUserPost);
        } catch {}
        notify({ kind: "success", title: "Shared to your profile", body: "Your post is safe across devices and re-logins." });
        onPosted(finalPost);
        onClose();
      } else {
        setLastError(result.error || "Upload failed. Tap Retry.");
      }
    });
  };

  const captionPreview = (() => {
    if (!sanitize || !caption) return null;
    const { blocked } = sanitize(caption);
    return blocked;
  })();

  // v120 — Precompute the currently-selected text overlay so the compose
  // stage's context toolbar can render via a plain `{cond && <jsx/>}` form.
  // We deliberately avoid an IIFE inside JSX (styled-jsx's SWC visitor
  // panics at visitor.rs:597 on certain IIFE-returning-JSX patterns).
  const selectedTextOverlay: Overlay | null = (() => {
    if (!selectedOverlayId) return null;
    const found = overlays.find((o) => o.id === selectedOverlayId) || null;
    return found && found.kind === "text" ? found : null;
  })();

  // v118 — IG-style swipe handlers. Reads pointerdown/move/up off the
  // preview wrapper. Why pointer events (not touch+mouse separately): one
  // event family works for finger / pen / mouse / trackpad and avoids the
  // dual-listener double-fire bug that "touchstart + click" used to have
  // on Android. We deliberately do NOT preventDefault inside down/move so
  // vertical scrolling of the page is preserved. Only on `up`, if we
  // detected a clearly horizontal swipe past the threshold, do we cycle.
  const SWIPE_DX_MIN = 50;          // px — minimum horizontal travel to commit a swap
  const SWIPE_RATIO  = 1.5;         // |dx| must be > SWIPE_RATIO * |dy| (so vertical scroll never triggers a filter swap)
  const SWIPE_MAX_MS = 600;         // ms — slower drags are treated as scrolling, not swiping
  const cycleFilterBy = useCallback((delta: number) => {
    const list = FILTER_PRESETS;
    if (!list.length) return;
    const cur = list.findIndex((f) => f.id === filter);
    const idx = cur >= 0 ? cur : 0;
    let next = (idx + delta) % list.length;
    if (next < 0) next += list.length;
    const chosen = list[next];
    setFilter(chosen.id);
    setSwipeHintLabel(chosen.label);
    if (swipeHintTimerRef.current) window.clearTimeout(swipeHintTimerRef.current);
    swipeHintTimerRef.current = window.setTimeout(() => setSwipeHintLabel(""), 900);
  }, [filter]);
  const onPreviewPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // Ignore right-click / middle-click on desktop — only primary buttons swipe.
    if (e.pointerType === "mouse" && e.button !== 0) return;
    swipeStartRef.current = { x: e.clientX, y: e.clientY, t: Date.now(), id: e.pointerId };
    swipeMovedRef.current = false;
  };
  const onPreviewPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const s = swipeStartRef.current;
    if (!s || s.id !== e.pointerId) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    // Once we've seen clearly horizontal travel, mark moved so the
    // pointer-up handler knows this gesture was a swipe (and the inner
    // chrome buttons — Cover frame, Cover/Fit, etc. — also know to
    // suppress their click via the same flag below).
    if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * SWIPE_RATIO) {
      swipeMovedRef.current = true;
    }
  };
  const onPreviewPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const s = swipeStartRef.current;
    swipeStartRef.current = null;
    if (!s || s.id !== e.pointerId) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    const dt = Date.now() - s.t;
    if (dt > SWIPE_MAX_MS) return;
    if (Math.abs(dx) < SWIPE_DX_MIN) return;
    if (Math.abs(dx) < Math.abs(dy) * SWIPE_RATIO) return;
    // Right→left swipe (negative dx) = next filter, left→right = previous.
    // Matches the IG convention where "swiping the next photo in" reveals
    // a new edit state on the right edge.
    cycleFilterBy(dx < 0 ? +1 : -1);
  };

  // Clean up the hint timer on unmount so we never call setState after close.
  useEffect(() => () => {
    if (swipeHintTimerRef.current) window.clearTimeout(swipeHintTimerRef.current);
  }, []);

  // ─── v119 Overlay helpers ────────────────────────────────────────────
  const addOverlay = (partial: Partial<Overlay> & Pick<Overlay, "kind" | "text">) => {
    const id = `ov-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const next: Overlay = {
      id,
      kind: partial.kind,
      text: partial.text,
      x: partial.x ?? 0.5,
      y: partial.y ?? 0.5,
      scale: partial.scale ?? 1,
      rotation: partial.rotation ?? 0,
      color: partial.color ?? "#FFFFFF",
      bgFill: partial.bgFill ?? null,
      // v120 — text overlays default to the "classic" preset.
      styleId: partial.styleId ?? (partial.kind === "text" ? "classic" : undefined),
    };
    setOverlays((prev) => [...prev, next]);
    setSelectedOverlayId(id);
    if (next.kind === "text") setOverlayEditingId(id);
  };

  const updateOverlay = (id: string, patch: Partial<Overlay>) => {
    setOverlays((prev) => prev.map((o) => (o.id === id ? { ...o, ...patch } : o)));
  };

  const removeOverlay = (id: string) => {
    setOverlays((prev) => prev.filter((o) => o.id !== id));
    if (selectedOverlayId === id) setSelectedOverlayId("");
    if (overlayEditingId === id) setOverlayEditingId("");
  };

  // Pointer math — converts client coords into normalised 0-1 coords
  // inside the preview frame's content box. Bulletproof against the
  // preview wrapper having borders / padding because we read the live
  // bounding rect rather than trusting CSS values.
  const clientToNorm = (clientX: number, clientY: number) => {
    const el = previewFrameRef.current;
    if (!el) return { x: 0.5, y: 0.5 };
    const r = el.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (clientX - r.left) / Math.max(1, r.width))),
      y: Math.min(1, Math.max(0, (clientY - r.top)  / Math.max(1, r.height))),
    };
  };

  // Pinch helpers — distance + angle between two pointers.
  const twoPointerMetrics = () => {
    const pts = Array.from(overlayPointersRef.current.values());
    if (pts.length < 2) return null;
    const [a, b] = pts;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    return { dist: Math.hypot(dx, dy), angle: Math.atan2(dy, dx) * 180 / Math.PI };
  };

  const onOverlayPointerDown = (id: string) => (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();          // do not propagate to the preview's swipe-filter handler
    e.preventDefault();
    setSelectedOverlayId(id);
    overlayPointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY, overlayId: id });
    try { (e.currentTarget as Element).setPointerCapture(e.pointerId); } catch {}
    if (overlayPointersRef.current.size === 1) {
      const ov = overlays.find((o) => o.id === id);
      overlayGestureRef.current = {
        overlayId: id,
        mode: "drag",
        startX: e.clientX,
        startY: e.clientY,
        startOverlayX: ov?.x ?? 0.5,
        startOverlayY: ov?.y ?? 0.5,
      };
    } else if (overlayPointersRef.current.size === 2) {
      const ov = overlays.find((o) => o.id === id);
      const m = twoPointerMetrics();
      if (ov && m) {
        overlayGestureRef.current = {
          overlayId: id,
          mode: "pinch",
          startX: e.clientX,
          startY: e.clientY,
          startOverlayX: ov.x,
          startOverlayY: ov.y,
          pinchStartDist: m.dist,
          pinchStartScale: ov.scale,
          pinchStartAngle: m.angle,
          pinchStartRot: ov.rotation,
        };
      }
    }
  };

  const onOverlayPointerMove = (id: string) => (e: React.PointerEvent<HTMLDivElement>) => {
    if (!overlayPointersRef.current.has(e.pointerId)) return;
    e.stopPropagation();
    overlayPointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY, overlayId: id });
    const g = overlayGestureRef.current;
    if (!g) return;
    if (g.mode === "drag" && overlayPointersRef.current.size === 1) {
      const cur = clientToNorm(e.clientX, e.clientY);
      const start = clientToNorm(g.startX, g.startY);
      const dx = cur.x - start.x;
      const dy = cur.y - start.y;
      updateOverlay(g.overlayId, {
        x: Math.min(1, Math.max(0, g.startOverlayX + dx)),
        y: Math.min(1, Math.max(0, g.startOverlayY + dy)),
      });
    } else if (g.mode === "pinch") {
      const m = twoPointerMetrics();
      if (!m || !g.pinchStartDist || g.pinchStartScale == null || g.pinchStartAngle == null || g.pinchStartRot == null) return;
      const factor = m.dist / g.pinchStartDist;
      const nextScale = Math.min(3, Math.max(0.3, g.pinchStartScale * factor));
      const nextRot   = g.pinchStartRot + (m.angle - g.pinchStartAngle);
      updateOverlay(g.overlayId, { scale: nextScale, rotation: nextRot });
    }
  };

  const onOverlayPointerUp = () => (e: React.PointerEvent<HTMLDivElement>) => {
    overlayPointersRef.current.delete(e.pointerId);
    if (overlayPointersRef.current.size === 0) {
      overlayGestureRef.current = null;
    } else if (overlayPointersRef.current.size === 1) {
      // Downgrading from pinch → drag: re-anchor the lone remaining pointer
      // as the new drag start so the overlay doesn't jump.
      const lone = Array.from(overlayPointersRef.current.values())[0];
      const ov = overlays.find((o) => o.id === lone.overlayId);
      if (ov) {
        overlayGestureRef.current = {
          overlayId: ov.id,
          mode: "drag",
          startX: lone.x,
          startY: lone.y,
          startOverlayX: ov.x,
          startOverlayY: ov.y,
        };
      }
    }
  };

  // ─── v119 Mention search ────────────────────────────────────────────
  // Debounced fetch of /api/social/users/search whenever the active
  // mention query changes. Aborts in-flight requests so we never race
  // (older queries returning after newer ones).
  useEffect(() => {
    if (!mentionActive || mentionQuery.length === 0) {
      setMentionSuggestions([]);
      return;
    }
    if (mentionSearchAbortRef.current) {
      try { mentionSearchAbortRef.current.abort(); } catch {}
    }
    const ac = new AbortController();
    mentionSearchAbortRef.current = ac;
    const id = window.setTimeout(async () => {
      try {
        const r = await fetch(`/api/social/users/search?q=${encodeURIComponent(mentionQuery)}&limit=8`, {
          signal: ac.signal,
        });
        if (!r.ok) return;
        const json = await r.json().catch(() => null);
        const list = Array.isArray(json?.users) ? json.users as MentionSuggestion[] : [];
        if (!ac.signal.aborted) setMentionSuggestions(list);
      } catch { /* abort or network — leave the prior list */ }
    }, 180);
    return () => {
      window.clearTimeout(id);
      try { ac.abort(); } catch {}
    };
  }, [mentionActive, mentionQuery]);

  /** Inserts an @handle into the caption at the mention anchor and closes the dropdown. */
  const pickMention = (s: MentionSuggestion) => {
    const before = caption.slice(0, mentionAnchorPos);
    const after  = caption.slice(mentionAnchorPos + 1 + mentionQuery.length);
    const inserted = `@${s.handle} `;
    const next = before + inserted + after;
    setCaption(next);
    setMentionActive(false);
    setMentionQuery("");
    setMentionSuggestions([]);
    // Move caret to right after the inserted handle.
    window.setTimeout(() => {
      const el = captionRef.current;
      if (!el) return;
      const pos = before.length + inserted.length;
      try { el.focus(); el.setSelectionRange(pos, pos); } catch {}
    }, 0);
  };

  /** Caption onChange — runs the existing sanitize warn + maintains mention state. */
  const onCaptionChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setCaption(val);
    if (sanitize && !warnedSanitize) {
      const { blocked } = sanitize(val);
      if (blocked) setWarnedSanitize(true);
    }
    // Mention detection: look back from the caret for the most recent `@`
    // not followed by a space/newline. That's the mention being typed.
    const caret = e.target.selectionStart ?? val.length;
    const before = val.slice(0, caret);
    const atIdx  = before.lastIndexOf("@");
    if (atIdx < 0) {
      setMentionActive(false); setMentionQuery(""); return;
    }
    // The character right before `@` must be start-of-string, whitespace,
    // newline, or punctuation — otherwise it's an email-style `@` inside
    // a word, not a mention.
    const prevChar = before[atIdx - 1] ?? "\n";
    if (!/[\s\n.,!?;:(]/.test(prevChar) && atIdx !== 0) {
      setMentionActive(false); setMentionQuery(""); return;
    }
    const q = before.slice(atIdx + 1);
    if (/[\s\n]/.test(q)) {
      setMentionActive(false); setMentionQuery(""); return;
    }
    if (q.length > 30) {
      setMentionActive(false); setMentionQuery(""); return;
    }
    setMentionActive(true);
    setMentionAnchorPos(atIdx);
    setMentionQuery(q);
  };

  // Target aspect ratios per kind — matches IG. Reel/Story = 9:16, Photo = 4:5.
  const targetAspect = kind === "photo" ? "4/5" : "9/16";
  const targetLabel  = kind === "photo" ? "4:5 portrait" : "9:16 vertical";

  // v114 — early-return AFTER all hooks have run. See the hook-order note
  // up above for why this can't sit at the top of the component anymore.
  if (!open) return null;

  // v113 — portal to <body> so the composer escapes any ancestor stacking
  // context. InstagramHotelFeed wraps everything in an `absolute z-10`
  // surface; without the portal, this fixed z-91 sheet gets clamped to
  // z-10 in the root stacking order and the z-60 BottomDock renders ON
  // TOP of the composer (the actual cause of "Post button hidden").
  const sheet = (
    // v114 — z bumped 91 → 1000 + explicit isolation so the composer ALWAYS
    // wins over BottomDock (z 60), Navbar (z 50), ServerStatus banner (z 70),
    // and any future fixed surface. Combined with the portal-to-body fix
    // (v113), nothing can ever render on top again.
    <div
      className="fixed inset-0 z-1000 flex items-end sb-cmodal"
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
          /* v118 — swipe-driven filter feedback */
          @keyframes sbFilterPulse {
            0%   { opacity: 0;   transform: scale(0.86); }
            18%  { opacity: 1;   transform: scale(1.0); }
            60%  { opacity: 1;   transform: scale(1.0); }
            100% { opacity: 0;   transform: scale(0.94); }
          }
          @keyframes sbSwipeHintBob {
            0%, 100% { transform: translate(-50%, 0); opacity: 0.72; }
            50%      { transform: translate(-50%, -3px); opacity: 0.95; }
          }
          /* v120 — right-rail floating toolbar buttons (Aa, 😀, ✨, 🖼, Fit). */
          .sb-rail-btn {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            width: 48px;
            min-height: 48px;
            padding: 6px 4px;
            border-radius: 14px;
            background: rgba(0,0,0,0.55);
            backdrop-filter: blur(8px);
            color: #fff;
            border: 1px solid rgba(255,255,255,0.20);
            box-shadow: 0 4px 12px rgba(0,0,0,0.45);
            transition: transform 0.12s ease;
          }
          .sb-rail-btn:active { transform: scale(0.93); }
          .sb-rail-lbl {
            font-size: 0.5rem;
            font-weight: 700;
            letter-spacing: 0.04em;
            color: rgba(255,255,255,0.78);
            margin-top: 2px;
            text-transform: uppercase;
          }
        `}</style>
        <audio ref={audioPreviewRef} src={audio?.url || ""} loop />

        {/* Sticky header — Cancel · Title · Next/Post. v120 splits the
            edit flow into two screens (compose → details). Header chrome
            adapts: Back returns one step at a time; the right-side action
            is "Next" on compose, "Post" on details. */}
        <div
          className="flex items-center justify-between px-5 py-3 border-b border-white/10 shrink-0"
          style={{ background: "linear-gradient(180deg, rgba(21,16,30,0.96), rgba(21,16,30,0.86))", backdropFilter: "blur(10px)" }}
        >
          <button
            onClick={() => {
              if (step === "edit" && subStep === "details") { setSubStep("compose"); return; }
              if (step === "edit") { setStep("pick"); return; }
              onClose();
            }}
            className="text-white/85 text-[0.84rem] py-1 px-2 -mx-2"
          >
            {step === "edit" ? "‹ Back" : "Cancel"}
          </button>
          <p className="text-white font-semibold text-[0.92rem]">
            {step === "pick"
              ? `New ${kind === "reel" ? "Reel" : kind === "photo" ? "Photo" : "Story"}`
              : subStep === "compose" ? "Edit" : "Details"}
          </p>
          {step === "edit" && subStep === "compose" ? (
            <button
              onClick={() => setSubStep("details")}
              disabled={!mediaFile}
              className="font-bold text-[0.84rem] py-1 px-2 -mx-2"
              style={{ color: !mediaFile ? "rgba(176, 192, 209,0.35)" : "#d0d9e1" }}
            >
              Next ›
            </button>
          ) : (
            <button
              onClick={post}
              disabled={!mediaFile || posting || step !== "edit" || (!tierContext && !taggedHotel)}
              className="font-bold text-[0.84rem] py-1 px-2 -mx-2"
              style={{
                color: !mediaFile || posting || step !== "edit" || (!tierContext && !taggedHotel) ? "rgba(176, 192, 209,0.35)" : "#d0d9e1",
              }}
            >
              {posting ? "Posting…" : "Post"}
            </button>
          )}
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
                  const f = e.dataTransfer.files?.[0];
                  if (!f) return;
                  // Simulate the change event so we re-use onFile's logic.
                  const dt = new DataTransfer(); dt.items.add(f);
                  if (fileRef.current) {
                    fileRef.current.files = dt.files;
                    onFile({ target: fileRef.current } as any);
                  }
                }}
                className="w-full aspect-4/5 rounded-2xl flex flex-col items-center justify-center gap-3 cursor-pointer active:scale-[0.98] transition-transform"
                style={{
                  background: "linear-gradient(135deg, rgba(255,69,141,0.18), rgba(185,100,255,0.10))",
                  border: "1.5px dashed rgba(255,255,255,0.25)",
                }}
              >
                <span className="text-5xl">{kind === "reel" ? "🎬" : kind === "photo" ? "📷" : "📖"}</span>
                <p className="text-white font-semibold text-[0.92rem]">
                  Tap to choose {kind === "photo" ? "a photo" : kind === "story" ? "a photo or video" : "a video"}
                </p>
                <p className="text-white/55 text-[0.66rem] px-6">
                  From your camera roll or files. Drag-and-drop also works on desktop.
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

            <input ref={fileRef}   type="file" accept={accept} onChange={onFile} className="hidden" />
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

        {/* v120 — Step 2 rewritten: two screens controlled by subStep.
            • compose → FULLSCREEN 9:16 stage with right-rail tools, swipe
              filters, free-position overlays, and a context toolbar that
              appears when a text overlay is selected.
            • details → standard scroll body with caption/audio/tags/etc
              plus a small thumbnail recap of the chosen media.
           Header chrome routes Back ⇄ Next ⇄ Post between screens. */}
        {step === "edit" && mediaFile && subStep === "compose" && (
          <div className="flex-1 flex flex-col overflow-hidden relative" style={{ background: "#000" }}>

            {/* FULLSCREEN STAGE. Outer div fills all available vertical
                space between header + (eventual) bottom toolbar; the inner
                aspect-locked frame letterboxes inside it.
                NOTE: previewFrameRef stays on the aspect-locked inner frame
                so overlay coords + swipe math stay normalised to the visible
                media rectangle (not the surrounding letterbox). */}
            <div
              className="flex-1 relative flex items-center justify-center"
              style={{ overflow: "hidden", minHeight: 0 }}
            >
              <div
                ref={previewFrameRef}
                className="relative bg-black"
                style={{
                  // Fill available height; width derived from aspectRatio.
                  // On a 9:16 phone this leaves no horizontal letterbox.
                  // On a wider device we get side-bars rather than crop.
                  height: "100%",
                  maxHeight: "100%",
                  maxWidth: "100%",
                  aspectRatio: targetAspect,
                  borderRadius: 14,
                  overflow: "hidden",
                  // v118 — pan-y so the OS keeps vertical scroll; horizontal
                  // swipe is ours.
                  touchAction: "pan-y",
                }}
                onPointerDown={onPreviewPointerDown}
                onPointerMove={onPreviewPointerMove}
                onPointerUp={onPreviewPointerUp}
                onPointerCancel={() => { swipeStartRef.current = null; }}
                onClick={(e) => {
                  // Tap on empty stage → deselect overlay (matches IG).
                  // Skip if the tap landed on an overlay (it stops propagation).
                  if (selectedOverlayId) setSelectedOverlayId("");
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

                {/* v118 — Floating filter label after a swipe-driven swap. */}
                {swipeHintLabel && (
                  <div
                    className="absolute inset-0 flex items-center justify-center pointer-events-none"
                    style={{ animation: "sbFilterPulse 900ms ease-out forwards" }}
                  >
                    <span
                      className="px-4 py-2 rounded-full text-[0.92rem] font-bold tracking-wide"
                      style={{
                        background: "rgba(0,0,0,0.55)",
                        backdropFilter: "blur(10px)",
                        color: "#d0d9e1",
                        border: "1px solid rgba(176, 192, 209,0.45)",
                        boxShadow: "0 6px 18px rgba(0,0,0,0.55)",
                      }}
                    >
                      ✨ {swipeHintLabel}
                    </span>
                  </div>
                )}

                {/* v120 — first-time gesture hint. Stays subtle and only
                    when no filter has been picked yet (matches v118). */}
                {filter === "none" && !swipeHintLabel && overlays.length === 0 && (
                  <span
                    className="absolute bottom-3 left-1/2 -translate-x-1/2 px-2.5 py-1 rounded-full text-[0.58rem] font-medium tracking-wide pointer-events-none"
                    style={{
                      background: "rgba(0,0,0,0.42)",
                      backdropFilter: "blur(6px)",
                      color: "rgba(255,255,255,0.72)",
                      border: "1px solid rgba(255,255,255,0.18)",
                      animation: "sbSwipeHintBob 2200ms ease-in-out infinite",
                    }}
                  >
                    ‹ swipe to change filter ›
                  </span>
                )}

                {/* Aspect-ratio hint chip — top-left of the stage. */}
                <span
                  className="absolute top-2 left-2 px-2 py-0.5 rounded-full text-[0.58rem] font-bold tracking-wider"
                  style={{
                    background: "rgba(0,0,0,0.45)",
                    backdropFilter: "blur(8px)",
                    color: "rgba(176, 192, 209,0.95)",
                    border: "1px solid rgba(176, 192, 209,0.35)",
                  }}
                >
                  {targetLabel.split(" ")[0].toUpperCase()}
                </span>

                {/* v120 — duration cap badge. Calls out the 60s/90s auto-trim
                    so the user isn't surprised when a long clip lands cut.
                    Only visible for videos. */}
                {isVideo && (
                  <span
                    className="absolute top-2 left-[78px] px-2 py-0.5 rounded-full text-[0.56rem] font-semibold tracking-wide"
                    style={{
                      background: "rgba(0,0,0,0.45)",
                      backdropFilter: "blur(8px)",
                      color: "rgba(255,255,255,0.78)",
                      border: "1px solid rgba(255,255,255,0.18)",
                    }}
                  >
                    ≤ {kind === "story" ? 90 : 60}s
                  </span>
                )}

                {/* v119 — overlay layer (text + emoji) */}
                {overlays.map((o) => {
                  const isSel = selectedOverlayId === o.id;
                  const previewBase = o.kind === "emoji" ? 36 : 22;
                  const fontPx = previewBase * o.scale;
                  // v120 — text overlays adopt the chosen styleId for
                  // family/weight/tracking/glow/uppercase. Mirrors the
                  // composite pipeline so what you see is what gets baked in.
                  const ts = o.kind === "text" ? getTextStyle(o.styleId) : null;
                  const textGlow = ts?.glow
                    ? `0 0 ${Math.round(8 * o.scale)}px ${o.color || "#d0d9e1"}, 0 0 ${Math.round(16 * o.scale)}px ${o.color || "#d0d9e1"}`
                    : o.bgFill ? "none" : "0 1px 4px rgba(0,0,0,0.55)";
                  return (
                    <div
                      key={o.id}
                      onPointerDown={onOverlayPointerDown(o.id)}
                      onPointerMove={onOverlayPointerMove(o.id)}
                      onPointerUp={onOverlayPointerUp()}
                      onPointerCancel={onOverlayPointerUp()}
                      style={{
                        position: "absolute",
                        left: `${o.x * 100}%`,
                        top:  `${o.y * 100}%`,
                        transform: `translate(-50%, -50%) rotate(${o.rotation}deg)`,
                        cursor: "grab",
                        userSelect: "none",
                        touchAction: "none",
                        outline: isSel ? "2px dashed rgba(176, 192, 209,0.95)" : "none",
                        outlineOffset: "4px",
                        zIndex: isSel ? 5 : 1,
                      }}
                    >
                      {o.kind === "text" ? (
                        overlayEditingId === o.id ? (
                          <input
                            autoFocus
                            value={o.text}
                            onChange={(e) => updateOverlay(o.id, { text: e.target.value.slice(0, 200) })}
                            onBlur={() => setOverlayEditingId("")}
                            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); setOverlayEditingId(""); } }}
                            placeholder="Tap to type"
                            style={{
                              background: o.bgFill || "rgba(0,0,0,0.20)",
                              color: o.color || "#fff",
                              fontWeight: ts?.fontWeight ?? 700,
                              fontFamily: ts?.fontFamily,
                              letterSpacing: `${(ts?.letterSpacing || 0) * 0.6}px`,
                              textTransform: ts?.uppercase ? "uppercase" : "none",
                              fontSize: fontPx,
                              padding: "4px 8px",
                              borderRadius: 6,
                              border: "1px solid rgba(255,255,255,0.35)",
                              outline: "none",
                              minWidth: 80,
                              textAlign: "center",
                            }}
                          />
                        ) : (
                          <span
                            onDoubleClick={() => setOverlayEditingId(o.id)}
                            style={{
                              background: o.bgFill || "transparent",
                              color: o.color || "#fff",
                              fontWeight: ts?.fontWeight ?? 700,
                              fontFamily: ts?.fontFamily,
                              letterSpacing: `${(ts?.letterSpacing || 0) * 0.6}px`,
                              textTransform: ts?.uppercase ? "uppercase" : "none",
                              fontSize: fontPx,
                              padding: o.bgFill ? "4px 10px" : "0",
                              borderRadius: 6,
                              textShadow: textGlow,
                              display: "inline-block",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {o.text || "Tap to edit"}
                          </span>
                        )
                      ) : (
                        <span style={{ fontSize: fontPx, lineHeight: 1, fontFamily: '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"' }}>
                          {o.text}
                        </span>
                      )}
                      {isSel && (
                        <button
                          type="button"
                          onPointerDown={(e) => { e.stopPropagation(); }}
                          onClick={(e) => { e.stopPropagation(); removeOverlay(o.id); }}
                          aria-label="Remove overlay"
                          style={{
                            position: "absolute",
                            top: -10, right: -10,
                            width: 22, height: 22,
                            borderRadius: 999,
                            background: "rgba(255,69,89,0.95)",
                            color: "#fff",
                            fontSize: 13,
                            fontWeight: 800,
                            border: "2px solid #0a0612",
                            boxShadow: "0 2px 6px rgba(0,0,0,0.6)",
                            display: "flex", alignItems: "center", justifyContent: "center",
                            lineHeight: 0,
                          }}
                        >×</button>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* RIGHT RAIL — vertical floating toolbar over the stage.
                  IG keeps actions to the right of the video; we do the same.
                  Buttons: Aa Text · 😀 Emoji · ✨ Filters (opens sheet) ·
                  🖼 Cover frame (videos only) · ◼/▢ Fit toggle.
                  pointerEvents auto so taps register; the column doesn't
                  hijack swipes on the stage because it doesn't span the
                  full width. */}
              <div
                className="absolute right-2 top-1/2 flex flex-col gap-2 items-center"
                style={{ transform: "translateY(-50%)", zIndex: 8, pointerEvents: "auto" }}
              >
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); addOverlay({ kind: "text", text: "" }); }}
                  aria-label="Add text"
                  className="sb-rail-btn"
                ><span className="text-base font-extrabold">Aa</span><span className="sb-rail-lbl">Text</span></button>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setOverlayPickerOpen("emoji"); }}
                  aria-label="Add emoji"
                  className="sb-rail-btn"
                ><span className="text-base">😀</span><span className="sb-rail-lbl">Emoji</span></button>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setFilterSheetOpen(true); }}
                  aria-label="Choose filter"
                  className="sb-rail-btn"
                ><span className="text-base">✨</span><span className="sb-rail-lbl">Filter</span></button>
                {isVideo && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setCoverPickerOpen(true); }}
                    aria-label="Choose cover frame"
                    className="sb-rail-btn"
                  ><span className="text-base">🖼</span><span className="sb-rail-lbl">Cover</span></button>
                )}
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setPreviewFit((f) => f === "cover" ? "contain" : "cover"); }}
                  aria-label={previewFit === "cover" ? "Show full frame" : "Crop to frame"}
                  className="sb-rail-btn"
                ><span className="text-base">{previewFit === "cover" ? "◼" : "▢"}</span><span className="sb-rail-lbl">{previewFit === "cover" ? "Crop" : "Fit"}</span></button>
              </div>

              {/* BOTTOM CONTEXT TOOLBAR — appears ONLY when a text overlay
                  is selected. Surface for styling: style chips, color dots,
                  size slider, background toggle. Anchored above the bottom
                  edge of the stage. */}
              {selectedTextOverlay && (
                  <div
                    className="absolute left-0 right-0 px-3 pointer-events-none"
                    style={{ bottom: 8, zIndex: 9 }}
                  >
                    <div
                      className="rounded-2xl px-3 py-2.5 space-y-2 pointer-events-auto"
                      style={{
                        background: "rgba(13,9,25,0.78)",
                        backdropFilter: "blur(14px)",
                        border: "1px solid rgba(176, 192, 209,0.28)",
                        boxShadow: "0 10px 24px rgba(0,0,0,0.55)",
                      }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {/* Style chips */}
                      <div className="flex gap-1.5 overflow-x-auto hide-scroll">
                        {TEXT_STYLES.map((s) => {
                          const active = (selectedTextOverlay.styleId || "classic") === s.id;
                          return (
                            <button
                              key={s.id}
                              type="button"
                              onClick={() => updateOverlay(selectedTextOverlay.id, { styleId: s.id })}
                              className="shrink-0 px-2.5 py-1 rounded-full text-[0.66rem] font-bold transition-all"
                              style={{
                                background: active ? "radial-gradient(88% 64% at 32% 4%,rgba(255,255,255,0.5),transparent 58%),linear-gradient(160deg,#e6edf3 0%,#c9d4df 52%,#a4b5c6 100%)" : "rgba(255,255,255,0.08)",
                                color: active ? "#1a1208" : "rgba(255,255,255,0.85)",
                                border: active ? "1px solid rgba(255,255,255,0.45)" : "1px solid rgba(255,255,255,0.16)",
                                fontFamily: s.fontFamily,
                                letterSpacing: `${s.letterSpacing * 0.5}px`,
                                textTransform: s.uppercase ? "uppercase" : "none",
                              }}
                            >
                              {s.label}
                            </button>
                          );
                        })}
                      </div>
                      {/* Color dots */}
                      <div className="flex gap-1.5 overflow-x-auto hide-scroll items-center">
                        {TEXT_COLORS.map((c) => {
                          const active = (selectedTextOverlay.color || "#FFFFFF").toUpperCase() === c.toUpperCase();
                          return (
                            <button
                              key={c}
                              type="button"
                              onClick={() => updateOverlay(selectedTextOverlay.id, { color: c })}
                              aria-label={`Color ${c}`}
                              className="shrink-0 rounded-full"
                              style={{
                                width: 24, height: 24,
                                background: c,
                                border: active ? "2px solid #d0d9e1" : "2px solid rgba(255,255,255,0.22)",
                                boxShadow: active ? "0 0 0 2px rgba(176, 192, 209,0.35)" : "none",
                              }}
                            />
                          );
                        })}
                      </div>
                      {/* Size slider + BG toggle */}
                      <div className="flex items-center gap-3">
                        <span className="text-white/55 text-[0.6rem]">Size</span>
                        <input
                          type="range"
                          min={0.5}
                          max={3}
                          step={0.05}
                          value={selectedTextOverlay.scale}
                          onChange={(e) => updateOverlay(selectedTextOverlay.id, { scale: Number(e.target.value) })}
                          style={{ flex: 1, accentColor: "#d0d9e1" }}
                        />
                        <button
                          type="button"
                          onClick={() => {
                            const cur = selectedTextOverlay;
                            const next = cur.bgFill === null || cur.bgFill === undefined
                              ? "rgba(0,0,0,0.55)"
                              : cur.bgFill.indexOf("0,0,0") !== -1
                                ? "rgba(255,255,255,0.92)"
                                : null;
                            const nextColor = next && next.indexOf("255,255,255") !== -1 ? "#1a1530" : (cur.color === "#1a1530" ? "#FFFFFF" : cur.color);
                            updateOverlay(cur.id, { bgFill: next, color: nextColor });
                          }}
                          className="shrink-0 px-2.5 py-1 rounded-full text-[0.62rem] font-bold"
                          style={{
                            background: selectedTextOverlay.bgFill ? "rgba(255,255,255,0.92)" : "rgba(255,255,255,0.08)",
                            color: selectedTextOverlay.bgFill ? "#1a1530" : "rgba(255,255,255,0.85)",
                            border: "1px solid rgba(255,255,255,0.22)",
                          }}
                          aria-label="Toggle text background"
                        >▣ BG</button>
                      </div>
                    </div>
                  </div>
              )}
            </div>

            {/* Format warning surface — kept compact + below the stage. */}
            {formatWarning && (
              <p
                className="text-amber-300 text-[0.66rem] leading-snug px-3 mx-3 mb-2 rounded-md"
                style={{
                  background: "rgba(245,158,11,0.10)",
                  border: "1px solid rgba(245,158,11,0.35)",
                  padding: "6px 8px",
                }}
              >
                ⚠️ {formatWarning}
              </p>
            )}

            {/* v120 — Filter bottom sheet (replaces the always-visible strip).
                Opens on demand from the right-rail ✨ button. Tap a thumbnail
                to apply + close. Swipe gesture on the stage still works for
                quick A↔B switches. */}
            {filterSheetOpen && (
              <div
                className="absolute inset-0 flex items-end"
                style={{ zIndex: 30 }}
                onClick={() => setFilterSheetOpen(false)}
              >
                <div
                  className="absolute inset-0"
                  style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(4px)" }}
                />
                <div
                  onClick={(e) => e.stopPropagation()}
                  className="relative w-full"
                  style={{
                    background: "linear-gradient(180deg,#15101e 0%,#0a0612 100%)",
                    borderTopLeftRadius: 22, borderTopRightRadius: 22,
                    borderTop: "1px solid rgba(255,255,255,0.14)",
                    padding: "10px 14px 16px",
                    paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 14px)",
                    animation: "composerIn 0.22s cubic-bezier(0.22, 1, 0.36, 1) both",
                  }}
                >
                  <div className="flex justify-center pt-1 pb-2">
                    <div className="w-10 h-[3px] rounded-full bg-white/30" />
                  </div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-white font-semibold text-[0.86rem]">✨ Filters</p>
                    <button onClick={() => setFilterSheetOpen(false)} className="text-white/70 text-[0.78rem] font-medium">Done</button>
                  </div>
                  <div className="flex gap-2 overflow-x-auto hide-scroll pb-1">
                    {FILTER_PRESETS.map((f) => {
                      const active = filter === f.id || (filter === null && f.id === "none");
                      return (
                        <button
                          key={f.id}
                          type="button"
                          onClick={() => {
                            setFilter(f.id);
                            setSwipeHintLabel(f.label);
                            if (swipeHintTimerRef.current) window.clearTimeout(swipeHintTimerRef.current);
                            swipeHintTimerRef.current = window.setTimeout(() => setSwipeHintLabel(""), 900);
                          }}
                          className="shrink-0 flex flex-col items-center gap-1"
                          aria-pressed={active}
                        >
                          <span
                            className="w-14 h-20 rounded-lg overflow-hidden block"
                            style={{
                              border: active ? "2px solid #d0d9e1" : "2px solid rgba(255,255,255,0.18)",
                              boxShadow: active ? "0 0 0 1px rgba(0,0,0,0.4), 0 4px 14px rgba(140, 160, 182,0.45)" : "none",
                              transition: "all 0.18s ease",
                            }}
                          >
                            <img
                              src={(isVideo ? (posterUrl || "") : mediaUrl) || mediaUrl}
                              alt=""
                              className="w-full h-full object-cover"
                              style={{ filter: f.css }}
                            />
                          </span>
                          <span className="text-[0.6rem] font-semibold" style={{ color: active ? "#d0d9e1" : "rgba(255,255,255,0.65)" }}>
                            {f.label}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

          </div>
        )}

        {/* v120 — Details screen: caption / audio / location / hotel /
            highlight / tags / progress / Post. Reached via the header
            "Next ›" button on the compose screen. */}
        {step === "edit" && mediaFile && subStep === "details" && (
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Small recap thumbnail so the user always sees what they're
                about to post. Tapping it returns to the compose screen
                for any last-minute edits. */}
            <button
              type="button"
              onClick={() => setSubStep("compose")}
              className="flex items-center gap-3 px-4 py-3 border-b border-white/10 active:bg-white/5"
              style={{ background: "rgba(255,255,255,0.02)" }}
            >
              <span
                className="rounded-lg overflow-hidden shrink-0 bg-black"
                style={{
                  width: 48,
                  height: kind === "photo" ? 60 : 64,
                  aspectRatio: targetAspect,
                  border: "1px solid rgba(255,255,255,0.10)",
                }}
              >
                <img
                  src={(isVideo ? (posterUrl || "") : mediaUrl) || mediaUrl}
                  alt=""
                  className="w-full h-full object-cover"
                  style={{ filter: filterCssFor(filter) }}
                />
              </span>
              <span className="flex-1 min-w-0 text-left">
                <span className="block text-white text-[0.78rem] font-semibold truncate">
                  {kind === "reel" ? "Reel" : kind === "photo" ? "Photo" : "Story"} · {targetLabel.split(" ")[0]}
                  {filter !== "none" && (
                    <span className="ml-1 text-amber-300 font-medium">· {FILTER_PRESETS.find(f => f.id === filter)?.label || filter}</span>
                  )}
                  {overlays.length > 0 && (
                    <span className="ml-1 text-white/60 font-medium">· {overlays.length} overlay{overlays.length !== 1 ? "s" : ""}</span>
                  )}
                </span>
                <span className="block text-white/55 text-[0.62rem] truncate">Tap to keep editing</span>
              </span>
              <span className="text-white/45 text-base">›</span>
            </button>

            {/* Scrollable details body. Bottom padding reserves space for
                the home-indicator + safe-area so the "Post to your profile"
                button never sits behind the OS gesture bar. */}
            <div
              className="flex-1 overflow-y-auto px-4 pt-3 space-y-3"
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
                      ? "linear-gradient(135deg, rgba(140, 160, 182,0.14), rgba(255,69,141,0.10))"
                      : "rgba(255,255,255,0.04)",
                    border: highlight
                      ? "1px solid rgba(140, 160, 182,0.45)"
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
                        ? "Live for 24h on your story ring-3 AND saved to your profile reels"
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
                    ? "linear-gradient(135deg, rgba(140, 160, 182,0.14), rgba(255,69,141,0.10))"
                    : "rgba(255,255,255,0.04)",
                  border: taggedHotel
                    ? "1px solid rgba(140, 160, 182,0.45)"
                    : (!tierContext
                        ? "1px solid rgba(140, 160, 182,0.40)"
                        : "1px solid rgba(255,255,255,0.10)"),
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
                    {taggedHotel
                      ? taggedHotel.name
                      : (!tierContext ? "Tag a hotel · Required" : "Tag a hotel")}
                  </span>
                  <span className="block text-white/55 text-[0.62rem] truncate">
                    {taggedHotel
                      ? (taggedHotel.city ? `📍 ${taggedHotel.city} · viewers can book or bid from this reel` : "viewers can book or bid from this reel")
                      : (!tierContext
                          ? "Required — every post must link to a StayBid hotel so viewers can book or bid"
                          : "Tag a StayBid hotel so viewers can book or bid right from your reel")}
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
              <div className="relative">
                <p className="text-[0.6rem] uppercase tracking-widest mb-1.5" style={{ color: "var(--text-muted)" }}>
                  Caption
                  <span className="ml-2 normal-case tracking-normal text-white/45 font-normal">
                    · type <span className="text-amber-300 font-semibold">@</span> to mention someone
                  </span>
                </p>
                <textarea
                  ref={captionRef}
                  value={caption}
                  onChange={onCaptionChange}
                  onKeyUp={onCaptionChange as any}
                  onClick={onCaptionChange as any}
                  rows={3}
                  maxLength={500}
                  placeholder="Write a caption… use @ to tag people"
                  className="ig-comment-input w-full rounded-xl px-3 py-2 text-[0.82rem] outline-hidden resize-none"
                  style={{
                    color: "#fff",
                    caretColor: "#d0d9e1",
                    background: "rgba(255,255,255,0.10)",
                    border: "1px solid rgba(255,255,255,0.20)",
                    minHeight: 70,
                  }}
                />
                {/* v119 — @mention suggestion dropdown. Floats just under
                    the textarea while mentionActive is true. Stays empty
                    state (loading dots) if the search hasn't returned yet
                    so the user sees that something IS happening. */}
                {mentionActive && (
                  <div
                    className="absolute left-0 right-0 rounded-xl overflow-hidden"
                    style={{
                      // Positioned BELOW the textarea so it doesn't cover
                      // the caret while typing. ~76px clears the textarea
                      // (24 label + 70 textarea body — close enough that
                      // the user's eye stays on screen).
                      top: 88,
                      background: "rgba(13, 9, 25, 0.96)",
                      backdropFilter: "blur(14px)",
                      border: "1px solid rgba(176, 192, 209,0.30)",
                      boxShadow: "0 12px 30px rgba(0,0,0,0.55)",
                      maxHeight: 240,
                      overflowY: "auto",
                      zIndex: 20,
                    }}
                  >
                    {mentionSuggestions.length === 0 && (
                      <p className="px-3 py-2 text-white/55 text-[0.72rem]">
                        {mentionQuery.length === 0 ? "Start typing a username…" : "No matches yet — keep typing"}
                      </p>
                    )}
                    {mentionSuggestions.map((s) => (
                      <button
                        type="button"
                        key={s.userId}
                        onClick={() => pickMention(s)}
                        className="w-full flex items-center gap-2.5 px-3 py-2 text-left active:bg-white/10"
                        style={{ background: "transparent", color: "#fff" }}
                      >
                        <span
                          className="w-7 h-7 rounded-full overflow-hidden shrink-0 flex items-center justify-center"
                          style={{
                            background: "linear-gradient(135deg,#3a2a1a,#0d1a2e)",
                            color: "#d0d9e1",
                            fontSize: "0.78rem",
                            fontWeight: 800,
                          }}
                        >
                          {s.avatarUrl
                            ? <img src={s.avatarUrl} alt="" className="w-full h-full object-cover" />
                            : (s.displayName?.[0] || s.handle?.[0] || "?").toUpperCase()}
                        </span>
                        <span className="flex-1 min-w-0">
                          <span className="block text-[0.82rem] font-semibold truncate">
                            @{s.handle}
                            {s.verified && <span className="ml-1 text-sky-300">✓</span>}
                          </span>
                          <span className="block text-white/55 text-[0.66rem] truncate">
                            {s.displayName}
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                )}
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
                <p className="text-[0.6rem] uppercase tracking-widest mb-1.5" style={{ color: "var(--text-muted)" }}>Tags</p>
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
                          background: active ? "radial-gradient(88% 64% at 32% 4%,rgba(255,255,255,0.5),transparent 58%),linear-gradient(160deg,#e6edf3 0%,#c9d4df 52%,#a4b5c6 100%)" : "rgba(255,255,255,0.05)",
                          color: active ? "#1a1208" : "rgba(255,255,255,0.85)",
                          border: active ? "1px solid rgba(255,255,255,0.45)" : "1px solid rgba(255,255,255,0.10)",
                          boxShadow: active ? "0 2px 6px rgba(140, 160, 182,0.45), inset 0 1px 0 rgba(255,255,255,0.5)" : "none",
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
                  upload…") so the user knows we're not stuck at 0% upload. */}
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
                  {/* v118 — copy reflects the new contract: nothing is saved
                      anywhere until the upload succeeds. Retry to publish OR
                      discard. No more "Keep local" zombie path. */}
                  <p className="text-red-200/60 text-[0.66rem] mb-2">
                    Nothing has been posted yet{retryCount > 0 ? ` (attempt ${retryCount + 1})` : ""} — tap Retry to publish, or discard to start over.
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
                      onClick={() => {
                        // v118 — Discard: clean slate. lastAttemptRef holds
                        // an in-memory copy of the unsubmitted post; tossing
                        // it + closing the modal removes the only place it
                        // lived. Nothing in PostsStore to clean up because
                        // we never committed in the first place.
                        setLastError("");
                        lastAttemptRef.current = null;
                        postedRef.current = false;
                        onClose();
                      }}
                      className="rounded-lg py-2 px-3 text-[0.74rem] font-semibold"
                      style={{ background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.85)", border: "1px solid rgba(255,255,255,0.18)" }}
                    >
                      Discard
                    </button>
                  </div>
                </div>
              )}

              {/* Confirm post (extra safety) */}
              <button
                onClick={post}
                disabled={posting || !!lastError || (!tierContext && !taggedHotel)}
                className="ig-cta-3d ig-cta-book w-full"
                style={{ padding: "12px", fontSize: "0.86rem" }}
              >
                <span className="ig-cta-icon">⚡</span>
                <span className="ig-cta-text">{posting ? "Posting…" : lastError ? "Tap Retry above" : (!tierContext && !taggedHotel) ? "Tag a hotel to post" : `Post to your profile`}</span>
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
      {/* v119 — Overlay emoji picker. Picking an emoji adds it as a fresh
          centered overlay; the user can drag/pinch from there. */}
      <OverlayEmojiPicker
        open={overlayPickerOpen === "emoji"}
        onClose={() => setOverlayPickerOpen(null)}
        onPick={(emoji) => {
          addOverlay({ kind: "emoji", text: emoji });
          setOverlayPickerOpen(null);
        }}
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
// Phase 4 tier-system additive props (both optional — legacy callers
// unaffected):
//   - onFabClick: lets the parent intercept the + button tap. Return
//     false (sync or async) to suppress the default CreateSheet open.
//     Used by InstagramHotelFeed to route PUBLIC users with no upload
//     eligibility into UpgradeChoiceSheet instead.
//   - tierContext: forwarded to Composer.runUpload, switches the POST
//     endpoint to /api/social/posts/verified-guest or /community when
//     set. When undefined (default), legacy /api/social/posts is used.
//   - composerOpen / onComposerClose: optional controlled mode for
//     parents that need to open the composer programmatically (skipping
//     the FAB + CreateSheet chooser) AFTER the user picks a tier path.
export function CreateFlow({
  onPosted, sanitize,
  onFabClick, tierContext,
  composerOpen, composerKind, onComposerClose,
}: {
  onPosted?: (post: UserPost) => void;
  sanitize?: (s: string) => { clean: string; blocked: boolean };
  onFabClick?: () => boolean | void | Promise<boolean | void>;
  tierContext?: ComposerTierContext;
  composerOpen?: boolean;
  composerKind?: ContentKind;
  onComposerClose?: () => void;
}) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [composer, setComposer] = useState<{ open: boolean; kind: ContentKind }>({ open: false, kind: "reel" });

  const handleFabClick = async () => {
    if (onFabClick) {
      const result = await onFabClick();
      // Convention: return false ONLY to suppress the default open.
      // void (no return) keeps default-open behavior — matches "fire and
      // forget" callers that don't want to gate.
      if (result === false) return;
    }
    setSheetOpen(true);
  };

  // v541 — desktop dead-space entry point. On desktop the in-frame "+" FAB is
  // pinned inside the 424px overflow:hidden phone frame (easy to miss), so a
  // gutter/dead-space "Create post" button (rendered by DesktopReelPanels)
  // fires this window event to open the SAME flow through the SAME tier gate.
  // Keep it in a ref so the listener always calls the latest handler.
  const handleFabClickRef = useRef(handleFabClick);
  handleFabClickRef.current = handleFabClick;
  useEffect(() => {
    const onOpen = () => { void handleFabClickRef.current(); };
    window.addEventListener("sb:open-create", onOpen as EventListener);
    return () => window.removeEventListener("sb:open-create", onOpen as EventListener);
  }, []);

  // Resolve effective composer state — controlled (parent-driven) wins.
  const compOpen = composerOpen ?? composer.open;
  const compKind = composerKind ?? composer.kind;
  const closeComposer = () => {
    setComposer({ open: false, kind: "reel" });
    onComposerClose?.();
  };

  return (
    <>
      <CreateFAB onClick={handleFabClick} />
      <CreateSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        onPick={(kind) => { setSheetOpen(false); setComposer({ open: true, kind }); }}
      />
      <Composer
        open={compOpen}
        kind={compKind}
        onClose={closeComposer}
        onPosted={(p) => { closeComposer(); onPosted?.(p); }}
        sanitize={sanitize}
        tierContext={tierContext}
      />
    </>
  );
}
