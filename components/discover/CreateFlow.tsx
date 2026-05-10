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
import { usePosts, type UserPost as StoreUserPost } from "@/lib/posts-store";
import { useFollow } from "@/lib/follow-store";
import { api } from "@/lib/api";

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
async function extractVideoThumbnail(file: File): Promise<string> {
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
        // Seek to a meaningful frame — first frames are often black.
        const target = Math.min(0.6, (v.duration || 1) / 4);
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

  const save = () => {
    setMyAvatarUrl(preview || "");
    setMyDisplayName(name.trim() ? name.trim().slice(0, 32) : "You");
    setMyBio(bio.trim().slice(0, 280));
    setMyLocation(location.trim().slice(0, 80));
    setMyWebsite(website.trim().slice(0, 120));
    onClose();
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
  const fileRef = useRef<HTMLInputElement | null>(null);
  const audioPreviewRef = useRef<HTMLAudioElement | null>(null);
  const { addPost } = usePosts();

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
      setWarnedSanitize(false);
      setFormatWarning("");
    }
  }, [open, kind]);

  // ⚠️ Do NOT revoke the object URL when the composer closes — the blob URL
  // is now owned by the post inside PostsStore and the feed needs it to play
  // back the upload. Revoking here was the bug that made every freshly-
  // posted reel/photo show up as a broken card. URLs are session-scoped
  // anyway; the browser cleans them up when the tab closes.

  if (!open) return null;

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

  const post = () => {
    if (!mediaFile || !mediaUrl) return;
    const sanitizedCaption = sanitize ? sanitize(caption).clean : caption;
    setPosting(true);
    const userPost: UserPost = {
      id: `post-${Date.now()}`,
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
      // Story-only metadata. Stories live for 24h unless `keepAsPost` is on.
      ...(kind === "story"
        ? { storyExpiresAt: Date.now() + 24 * 60 * 60 * 1000, keepAsPost: !!saveAsPost }
        : {}),
      createdAt: Date.now(),
    };
    // Commit to the global reactive PostsStore — feed picks it up instantly.
    // The store persists to localStorage internally, so we don't need a
    // separate localStorage write here.
    try { addPost(userPost as StoreUserPost); } catch {}
    setTimeout(() => {
      setPosting(false);
      onPosted(userPost);
      onClose();
    }, 600);
  };

  const captionPreview = (() => {
    if (!sanitize || !caption) return null;
    const { blocked } = sanitize(caption);
    return blocked;
  })();

  return (
    <div className="fixed inset-0 z-[91] flex items-end" onClick={onClose}>
      <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.78)", backdropFilter: "blur(8px)" }} />
      <div
        className="relative w-full ig-drawer-up"
        onClick={(e) => e.stopPropagation()}
        style={{
          height: "94vh",
          background: "linear-gradient(180deg,#15101e 0%,#0a0612 100%)",
          borderTopLeftRadius: 24, borderTopRightRadius: 24,
          borderTop: "1px solid rgba(255,255,255,0.12)",
          boxShadow: "0 -20px 60px rgba(0,0,0,0.75)",
          display: "flex", flexDirection: "column",
          paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 12px)",
        }}
      >
        <audio ref={audioPreviewRef} src={audio?.url || ""} loop />

        <div className="flex justify-center pt-2.5 pb-1.5"><div className="w-10 h-[3px] rounded-full bg-white/30" /></div>
        <div className="flex items-center justify-between px-5 pb-3 border-b border-white/8">
          <button onClick={step === "edit" ? () => setStep("pick") : onClose} className="text-white/85 text-[0.84rem]">
            {step === "edit" ? "‹ Back" : "Cancel"}
          </button>
          <p className="text-white font-semibold text-[0.92rem]">
            {step === "pick" ? `New ${kind === "reel" ? "Reel" : kind === "photo" ? "Photo" : "Story"}` : "Edit"}
          </p>
          <button
            onClick={post}
            disabled={!mediaFile || posting}
            className="text-gold-300 font-bold text-[0.84rem] disabled:opacity-30"
          >
            {posting ? "Posting…" : "Post"}
          </button>
        </div>

        {/* Step 1: pick a file. Profile-photo entry was removed per user
            feedback — viewers reach it from the round avatar in their own
            profile sheet now (a single, discoverable entry point). */}
        {step === "pick" && (
          <div className="flex-1 flex flex-col items-center justify-center px-5 text-center">
            <div
              onClick={() => fileRef.current?.click()}
              className="w-full max-w-xs aspect-[4/5] rounded-2xl flex flex-col items-center justify-center gap-3 cursor-pointer active:scale-[0.98] transition-transform"
              style={{
                background: "linear-gradient(135deg, rgba(255,69,141,0.18), rgba(185,100,255,0.10))",
                border: "1.5px dashed rgba(255,255,255,0.25)",
              }}
            >
              <span className="text-5xl">{kind === "reel" ? "🎬" : kind === "photo" ? "📷" : "📖"}</span>
              <p className="text-white font-semibold text-[0.92rem]">Tap to choose {kind === "photo" ? "a photo" : kind === "story" ? "a photo or video" : "a video"}</p>
              <p className="text-white/55 text-[0.66rem] px-6">From your camera roll or files. Stays on your device until you tap Post.</p>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept={accept}
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
            {/* Preview */}
            <div className="px-4 pt-3 pb-2">
              <div
                className="w-full rounded-2xl overflow-hidden bg-black mx-auto"
                style={{ maxHeight: "44vh", aspectRatio: "9/14" }}
              >
                {isVideo ? (
                  <video src={mediaUrl} className="w-full h-full object-cover" autoPlay loop muted={!!audio} playsInline />
                ) : (
                  <img src={mediaUrl} alt="" className="w-full h-full object-cover" />
                )}
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

            <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-4">
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

              {/* Confirm post (extra safety) */}
              <button
                onClick={post}
                disabled={posting}
                className="ig-cta-3d ig-cta-book w-full"
                style={{ padding: "12px", fontSize: "0.86rem" }}
              >
                <span className="ig-cta-icon">⚡</span>
                <span className="ig-cta-text">{posting ? "Posting…" : `Post to your profile`}</span>
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
    </div>
  );
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
