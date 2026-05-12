"use client";
// ═══════════════════════════════════════════════════════════════════════════
// FlashDealStories — Instagram-style "story rail" of LIVE flash deals.
//
//   • Top of /discover: horizontal-scrollable rail of glowing avatars, one
//     per hotel with an active flash deal. Auto-pulled from /api/flash/near.
//   • Tap an avatar → fullscreen StoryViewer that auto-advances every 6s,
//     shows hero image + price + discount + live countdown + units left + a
//     glowing "Book Now" CTA wired into the existing flash-deal booking URL
//     (?dealId=…&dealPrice=…&directBook=true).
//
// Why this exists:
//   The reels feed previously dedicated its "story" surface to user-uploaded
//   24h posts only. That tray was empty for most users. Replacing it with
//   auto-generated flash-deal stories means every visitor sees real, urgent,
//   conversion-ready inventory at the top of the feed without the hotel
//   having to lift a finger.
// ═══════════════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useRef, useState } from "react";

export type FlashDealStory = {
  id:           string;
  hotelId:      string;
  hotelName:    string;
  hotelImage:   string;
  city:         string;
  roomId:       string;
  roomType:     string;
  dealPrice:    number;
  floorPrice:   number;
  discount:     number;
  validUntil:   string;
  unitsFree:    number;
  unitsTotal:   number;
  maxBookings:  number;
  bookingCount: number;
  upgrades:     any[];
  /**
   * Custom audio URL set by the hotel owner / content creator who generated
   * this deal. When present, plays in place of the default peaceful track.
   * Sourced from either: (a) `flash_deals.audioUrl` in Supabase (backend
   * field — admin/partner uploads land here), or (b) a local blob URL
   * cached in `localStorage.sb_fdeal_audio_{dealId}` set via the inline
   * "🎵 Add audio" picker on the story viewer.
   */
  audioUrl?:    string;
};

// ─── Peaceful default tracks ───────────────────────────────────────────────
// Used when a deal has no custom audio attached. Chosen for slow / cinematic
// / lofi vibes that don't fight the brand chrome. Picked by hashStr(hotelId)
// % length so the same hotel always pairs with the same default track —
// the user starts to recognize their favourite hotel by its sound, just
// like Instagram reels.
const PEACEFUL_TRACKS = [
  { id: "peace_1", name: "Piano Reflect", url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-6.mp3"  },
  { id: "peace_2", name: "Open Sky",      url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-12.mp3" },
  { id: "peace_3", name: "Wide Horizon",  url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-15.mp3" },
  { id: "peace_4", name: "Slow Pulse",    url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-13.mp3" },
];
function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
function defaultTrackFor(hotelId: string) {
  return PEACEFUL_TRACKS[hashStr(hotelId || "x") % PEACEFUL_TRACKS.length];
}
function readCustomAudio(dealId: string): string | null {
  if (typeof window === "undefined") return null;
  try { return localStorage.getItem(`sb_fdeal_audio_${dealId}`); } catch { return null; }
}
function writeCustomAudio(dealId: string, url: string) {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(`sb_fdeal_audio_${dealId}`, url); } catch {}
}
function clearCustomAudio(dealId: string) {
  if (typeof window === "undefined") return;
  try { localStorage.removeItem(`sb_fdeal_audio_${dealId}`); } catch {}
}

// ─── Permission gate: who can attach custom audio? ─────────────────────────
// v84 tightened: was "any logged-in partner OR admin can edit any deal's
// audio". Now requires actual ownership:
//   • Admins → can edit any deal (full permission)
//   • Hotel partners → only the deal's owner. We read `sb_partner_user`
//     from localStorage and compare `partner.hotel.id` with the deal's
//     `hotelId`. Mismatch → button hidden (partner can't edit someone
//     else's hotel's deal audio).
//   • Customers → never (would spam the public surface).
function canAttachAudio(hotelId?: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    // Admin sees the button on EVERY deal.
    if (localStorage.getItem("sb_admin_token")) return true;
    // Partner sees the button only on THEIR hotel's deals.
    const tok = localStorage.getItem("sb_partner_token");
    if (!tok || !hotelId) return false;
    const raw = localStorage.getItem("sb_partner_user");
    if (!raw) return false;
    const u = JSON.parse(raw);
    const ownedId = u?.hotel?.id || u?.hotelId || u?.hotel_id;
    return !!ownedId && String(ownedId) === String(hotelId);
  } catch { return false; }
}

// ─── Track which deals the current user has seen ───────────────────────────
// Pushed onto every viewer open. Sent to /api/flash/near so the backend can
// de-prioritize already-seen deals — the rail then shows fresh inventory
// at the top, matching Instagram's "haven't seen this yet" feel.
const VIEWED_KEY = "sb_flash_viewed_v1";
export function markFlashDealViewed(dealId: string) {
  if (typeof window === "undefined" || !dealId) return;
  try {
    const raw = localStorage.getItem(VIEWED_KEY);
    const arr: string[] = raw ? JSON.parse(raw) : [];
    if (arr.includes(dealId)) return;
    arr.unshift(dealId);
    // Keep last 60. Older deals naturally age out via validUntil anyway.
    localStorage.setItem(VIEWED_KEY, JSON.stringify(arr.slice(0, 60)));
  } catch {}
}
function readViewedIds(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(VIEWED_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch { return []; }
}

// ─── Helpers ────────────────────────────────────────────────────────────────
function fmtINR(n: number) { return `₹${Math.round(n).toLocaleString("en-IN")}`; }

type Countdown =
  | { mode: "hms"; h: string; m: string; s: string; expired: false }
  | { mode: "long"; days: number; hours: number; expired: false }
  | { mode: "expired"; expired: true };

function countdown(validUntil: string): Countdown {
  const ms = new Date(validUntil).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return { mode: "expired", expired: true };
  const totalSec = Math.floor(ms / 1000);
  const totalHours = Math.floor(totalSec / 3600);
  // Over a day → IG-style "5d 12h" instead of capping at 99:XX:XX. Keeps the
  // viewer readable for week-long deals.
  if (totalHours >= 24) {
    return { mode: "long", days: Math.floor(totalHours / 24), hours: totalHours % 24, expired: false };
  }
  const h = totalHours;
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return { mode: "hms", h: pad(h), m: pad(m), s: pad(s), expired: false };
}

// Normalize a /api/flash/near payload row into the rail's compact shape.
export function normalizeFlashDeal(d: any): FlashDealStory | null {
  if (!d || !d.hotelId || !d.aiPrice) return null;
  // audioUrl precedence: backend column (admin/partner upload) → camelCase →
  // snake_case → none. The viewer falls back to a peaceful default and
  // checks localStorage for an in-session custom upload at render time.
  const audioUrl = d.audioUrl || d.audio_url || d.raw?.audioUrl || d.raw?.audio_url || "";
  return {
    id:           String(d.id),
    hotelId:      String(d.hotelId),
    hotelName:    d.hotel?.name || "Hotel",
    hotelImage:   (d.hotel?.images?.[0]) || (d.room?.images?.[0]) || "",
    city:         d.hotel?.city || d.city || "",
    roomId:       String(d.roomId || d.room?.id || ""),
    roomType:     d.room?.type || d.room?.name || "Room",
    dealPrice:    Number(d.aiPrice) || 0,
    floorPrice:   Number(d.floorPrice) || 0,
    discount:     Number(d.discount) || 0,
    validUntil:   d.validUntil || "",
    unitsFree:    Number(d.unitsFree ?? 1),
    unitsTotal:   Number(d.unitsTotal ?? 1),
    maxBookings:  Number(d.maxBookings ?? 5),
    bookingCount: Number(d.bookingCount ?? 0),
    upgrades:     Array.isArray(d.upgrades) ? d.upgrades : [],
    audioUrl:     audioUrl || undefined,
  };
}

// ═══ Rail ═══════════════════════════════════════════════════════════════════
export function FlashDealStoryRail({
  deals,
  onOpen,
}: {
  deals: FlashDealStory[];
  onOpen: (idx: number) => void;
}) {
  if (!deals.length) return null;
  return (
    <>
      <div className="fdeal-rail-wrap pointer-events-auto">
        <div className="fdeal-rail-header">
          <span className="fdeal-rail-title">Flash Deals</span>
          {/* v89 — Brand wordmark restored on `/` home but inside the rail
              header on the RIGHT (Flash Deals title is on the left).
              No more overlap with the page-level brand (which we now
              hide on `/`). Same Cormorant italic + cocoa+champagne. */}
          <span className="fdeal-rail-brand" aria-label="StayBid">
            stay<span className="fdeal-rail-brand-dot">·</span>bid
          </span>
        </div>
        <div className="fdeal-rail-scroll" role="list">
          {deals.map((d, i) => (
            <button
              key={d.id}
              role="listitem"
              type="button"
              className="fdeal-rail-item"
              onClick={() => onOpen(i)}
              aria-label={`Open flash deal at ${d.hotelName}`}
            >
              <span className="fdeal-rail-ring">
                <span className="fdeal-rail-avatar">
                  {d.hotelImage
                    ? <img src={d.hotelImage} alt="" loading="lazy" decoding="async" />
                    : <span className="fdeal-rail-initials">{(d.hotelName || "H").slice(0, 1).toUpperCase()}</span>}
                </span>
              </span>
              <span className="fdeal-rail-name">{d.hotelName}</span>
            </button>
          ))}
        </div>
      </div>

      <style jsx global>{`
        @keyframes fdealRingSpin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
        @keyframes fdealRailSlideIn {
          from { transform: translateY(-12px); opacity: 0; }
          to   { transform: translateY(0);    opacity: 1; }
        }

        /* Premium cream band — sits in its OWN section above the reels.
           No transparency, no overlap with the video feed below: visually
           a clean horizontal lane the way Instagram's home-feed stories
           rail reads. Soft champagne + warm parchment. */
        .fdeal-rail-wrap {
          position: relative;        /* part of the flex column, not floating */
          z-index: 38;
          padding: 10px 12px 12px;
          background:
            linear-gradient(180deg, #fff9ec 0%, #f9efd6 100%);
          border-bottom: 1px solid rgba(184, 134, 11, 0.18);
          box-shadow: 0 2px 14px rgba(184, 134, 11, 0.10);
          animation: fdealRailSlideIn 0.5s cubic-bezier(.32,1.2,.36,1) both;
        }
        .fdeal-rail-header {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          padding: 0 4px 8px;
        }
        .fdeal-rail-title {
          font-family: "Cormorant Garamond", "Georgia", serif;
          font-style: italic;
          font-weight: 600;
          font-size: 1.05rem;
          letter-spacing: 0.005em;
          color: #6e4a08;
        }
        /* v89 — Brand wordmark on the right of the rail header. Same
           Cormorant italic as the "Flash Deals" title — they read as a
           premium cozy pair. */
        .fdeal-rail-brand {
          font-family: "Cormorant Garamond", "Georgia", serif;
          font-style: italic;
          font-weight: 600;
          font-size: 0.95rem;
          line-height: 1;
          color: var(--cozy-cocoa, #4A3820);
          letter-spacing: 0.01em;
          user-select: none;
        }
        .fdeal-rail-brand-dot {
          color: var(--cozy-champagne, #C9A66B);
          margin: 0 1px;
        }
        .fdeal-rail-sub {
          font-size: 0.62rem;
          font-weight: 600;
          color: rgba(110, 74, 8, 0.65);
          letter-spacing: 0.05em;
          text-transform: uppercase;
        }

        .fdeal-rail-scroll {
          display: flex;
          gap: 12px;
          overflow-x: auto;
          overflow-y: hidden;
          padding: 2px 4px 4px;
          scrollbar-width: none;
          -ms-overflow-style: none;
          -webkit-overflow-scrolling: touch;
          scroll-snap-type: x proximity;
        }
        .fdeal-rail-scroll::-webkit-scrollbar { display: none; }

        .fdeal-rail-item {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 5px;
          width: 64px;
          flex: 0 0 auto;
          scroll-snap-align: start;
          background: none;
          border: none;
          padding: 0;
          color: #4a3208;
          cursor: pointer;
          transition: transform 0.18s cubic-bezier(.32,1.2,.36,1);
        }
        .fdeal-rail-item:active { transform: scale(0.92); }

        /* Soft champagne ring — premium, no aggressive color, very subtle
           rotation. No discount badge per design ask: the percentage lives
           inside the viewer only, not on the front page. */
        .fdeal-rail-ring {
          position: relative;
          width: 60px;
          height: 60px;
          border-radius: 999px;
          padding: 2px;
          background: conic-gradient(from 0deg,
            #c9911a 0deg,
            #f0d060 90deg,
            #fff4cc 180deg,
            #f0d060 270deg,
            #c9911a 360deg);
          animation: fdealRingSpin 12s linear infinite;
          box-shadow:
            0 2px 8px rgba(184, 134, 11, 0.25),
            inset 0 0 0 1px rgba(255, 255, 255, 0.6);
        }
        .fdeal-rail-avatar {
          display: block;
          width: 100%;
          height: 100%;
          border-radius: 999px;
          overflow: hidden;
          background: #fff9ec;
          border: 2px solid #fff9ec;
          /* counter-rotate the inner so the image stays upright while the ring spins */
          animation: fdealRingSpin 12s linear infinite reverse;
        }
        .fdeal-rail-avatar img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }
        .fdeal-rail-initials {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 100%;
          height: 100%;
          font-size: 1.1rem;
          font-weight: 700;
          color: #6e4a08;
        }
        .fdeal-rail-name {
          font-size: 0.62rem;
          font-weight: 500;
          color: rgba(74, 50, 8, 0.85);
          max-width: 64px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
      `}</style>
    </>
  );
}

// ═══ Viewer ═════════════════════════════════════════════════════════════════
export function FlashDealStoryViewer({
  open,
  deals,
  startIdx,
  onClose,
  onBook,
  onTrackEvent,
}: {
  open: boolean;
  deals: FlashDealStory[];
  startIdx: number;
  onClose: () => void;
  onBook: (d: FlashDealStory) => void;
  onTrackEvent?: (name: string, payload: any) => void;
}) {
  const [idx, setIdx] = useState(startIdx);
  const [progress, setProgress] = useState(0);
  const [paused, setPaused] = useState(false);
  const [tick, setTick] = useState(0); // forces countdown re-render every second
  // Bumps every time the user uploads a new track for the current deal so
  // the audio element re-reads localStorage and starts playing the new mp3.
  const [audioBump, setAudioBump] = useState(0);
  // Inline soft toast for upload feedback ("🎵 Audio attached", etc.)
  const [miniToast, setMiniToast] = useState<string | null>(null);
  const startedAt = useRef<number>(0);
  const accumulated = useRef<number>(0);
  const rafRef = useRef<number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const STORY_MS = 6000;

  const deal = deals[idx];

  // Resolve the audio source for the current deal in this priority:
  //   1. Local custom upload (this browser session, partner/admin only)
  //   2. Backend-attached audio (deal.audioUrl)
  //   3. Default peaceful track picked deterministically by hotel hash
  const audioSrc: string = (() => {
    if (!deal) return "";
    const local = readCustomAudio(deal.id);
    if (local) return local;
    if (deal.audioUrl) return deal.audioUrl;
    return defaultTrackFor(deal.hotelId).url;
  })();
  const isCustomAudio = !!(deal && (readCustomAudio(deal.id) || deal.audioUrl));
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _audioBumpRead = audioBump; // re-evaluate audioSrc when bumped

  const canEditAudio = canAttachAudio(deal?.hotelId);

  // Mark every deal viewed once it shows up — feeds the personalization
  // signal back into the API on the next /api/flash/near call.
  useEffect(() => {
    if (!open || !deal) return;
    markFlashDealViewed(deal.id);
  }, [open, idx, deal]);

  // While the viewer is open we toggle a body class. Global CSS uses it
  // to hide every other piece of chrome (rail filter chip, brand label,
  // bottom dock, back chip) so the viewer reads as truly fullscreen — no
  // more "Compare overlapping the deal" feedback.
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (open) document.body.classList.add("fdeal-viewer-open");
    else      document.body.classList.remove("fdeal-viewer-open");
    return () => { document.body.classList.remove("fdeal-viewer-open"); };
  }, [open]);

  // Auto-dismiss the mini-toast
  useEffect(() => {
    if (!miniToast) return;
    const t = setTimeout(() => setMiniToast(null), 1800);
    return () => clearTimeout(t);
  }, [miniToast]);

  // Sync starting index whenever the viewer opens or the rail's tap changes
  // the starting deal. Without this, opening after the first time would keep
  // the previous idx and start mid-rail.
  useEffect(() => {
    if (!open) return;
    setIdx(startIdx);
    setProgress(0);
    accumulated.current = 0;
    startedAt.current = performance.now();
    setPaused(false);
    onTrackEvent?.("flash_story_open", { hotelId: deals[startIdx]?.hotelId });
  }, [open, startIdx]); // eslint-disable-line react-hooks/exhaustive-deps

  // Live countdown re-render — 1s tick. Cheap; only one timer regardless of
  // deal count.
  useEffect(() => {
    if (!open) return;
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [open]);

  // ─── Audio playback ──────────────────────────────────────────────────
  // Plays the resolved audioSrc when the viewer is open + not paused. Each
  // story advance reseats the audio from 0 so the user hears the start of
  // the track per slide. Cross-origin SoundHelix mp3s play fine through a
  // raw <audio> element — note we do NOT route through Web Audio (would
  // silence cross-origin in many browsers, same bug documented in
  // InstagramHotelFeed audio handling).
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    if (!open) { try { a.pause(); a.currentTime = 0; } catch {} return; }
    if (paused) { try { a.pause(); } catch {} return; }
    try {
      a.muted = false;
      a.volume = 0.55; // soft default — viewer is foreground, no need to blast
      const p = a.play();
      if (p && typeof p.then === "function") p.catch(() => {});
    } catch {}
    return () => { try { a.pause(); } catch {} };
  }, [open, idx, paused, audioSrc]);

  // Stop & reset on slide advance — guarantees no audio overlap if play()
  // raced an advance.
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    try { a.currentTime = 0; } catch {}
  }, [idx]);

  // ─── Custom audio upload (gated to hotel partner / admin) ────────────
  const onPickAudio = () => {
    if (!canEditAudio || !deal) return;
    fileInputRef.current?.click();
  };
  const onAudioFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!deal) return;
    const f = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (!f) return;
    if (!/^audio\//.test(f.type)) {
      setMiniToast("Please pick an audio file (mp3, wav, m4a…)");
      return;
    }
    if (f.size > 8 * 1024 * 1024) {
      setMiniToast("Audio too large — keep under 8 MB");
      return;
    }
    const url = URL.createObjectURL(f);
    writeCustomAudio(deal.id, url);
    setAudioBump((n) => n + 1);
    setMiniToast("🎵 Audio attached to this deal");
  };
  const onRemoveAudio = () => {
    if (!deal) return;
    clearCustomAudio(deal.id);
    setAudioBump((n) => n + 1);
    setMiniToast("Custom audio removed");
  };

  // Progress bar driver
  useEffect(() => {
    if (!open || !deal) return;
    if (paused) return;
    startedAt.current = performance.now();
    const step = () => {
      const elapsed = accumulated.current + (performance.now() - startedAt.current);
      const p = Math.min(100, (elapsed / STORY_MS) * 100);
      setProgress(p);
      if (p >= 100) {
        if (idx < deals.length - 1) {
          setIdx(idx + 1);
          accumulated.current = 0;
          setProgress(0);
        } else {
          onClose();
        }
        return;
      }
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [open, idx, paused, deals.length, onClose]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open || !deal) return null;

  const pause = () => {
    if (paused) return;
    accumulated.current = accumulated.current + (performance.now() - startedAt.current);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    setPaused(true);
  };
  const resume = () => {
    if (!paused) return;
    startedAt.current = performance.now();
    setPaused(false);
  };
  const goPrev = () => {
    if (idx > 0) {
      setIdx(idx - 1);
      accumulated.current = 0;
      setProgress(0);
    }
  };
  const goNext = () => {
    if (idx < deals.length - 1) {
      setIdx(idx + 1);
      accumulated.current = 0;
      setProgress(0);
    } else {
      onClose();
    }
  };

  const cd = countdown(deal.validUntil);
  // Optional "sold X / Y" — only show if both maxBookings + bookingCount are meaningful
  const showSlots = deal.maxBookings > 0;
  const slotsLeft = Math.max(0, deal.maxBookings - deal.bookingCount);
  const savePerNight = Math.max(0, deal.floorPrice - deal.dealPrice);

  return (
    <div className="fdeal-viewer-root" onClick={onClose}>
      <div
        className="fdeal-viewer-card"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Progress bars at top */}
        <div className="fdeal-viewer-progress">
          {deals.map((_, i) => (
            <div key={i} className="fdeal-viewer-progress-track">
              <div
                className="fdeal-viewer-progress-fill"
                style={{
                  width: i < idx ? "100%" : i === idx ? `${progress}%` : "0%",
                  transition: i === idx && !paused ? "width 0.05s linear" : "none",
                }}
              />
            </div>
          ))}
        </div>

        {/* Header: live pill + audio button (partner/admin only) + ✕ */}
        <div className="fdeal-viewer-header">
          <div className="fdeal-viewer-live">
            <span className="fdeal-viewer-live-dot" />
            FLASH DEAL · LIVE
          </div>
          <div className="fdeal-viewer-header-actions">
            {canEditAudio && (
              <button
                type="button"
                onClick={onPickAudio}
                className="fdeal-viewer-audio-btn"
                aria-label="Attach custom audio to this deal"
                title="Attach audio (hotel owner / creator)"
              >🎵</button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="fdeal-viewer-close"
              aria-label="Close flash deal story"
            >✕</button>
          </div>
        </div>

        {/* Hidden file input — opened by the 🎵 button. accept="audio/*"
            triggers the device's audio picker on iOS / Android. */}
        {canEditAudio && (
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*"
            onChange={onAudioFile}
            style={{ display: "none" }}
          />
        )}

        {/* Hidden looping audio. loop=true so a short story-length isn't
            cut by a long track ending; preload=auto so it starts fast on
            slide advance. */}
        {audioSrc && (
          <audio
            key={audioSrc}
            ref={audioRef}
            src={audioSrc}
            loop
            preload="auto"
            // crossOrigin intentionally omitted — leaving it off keeps
            // playback working for SoundHelix + most third-party hosts.
          />
        )}

        {/* Mini toast — bottom-center, auto-dismisses */}
        {miniToast && (
          <div className="fdeal-viewer-mini-toast" role="status" aria-live="polite">
            {miniToast}
          </div>
        )}

        {/* Background hero image with Ken-Burns zoom */}
        <div className="fdeal-viewer-bg">
          {deal.hotelImage ? (
            <img src={deal.hotelImage} alt={deal.hotelName} className="fdeal-viewer-bg-img" />
          ) : (
            <div className="fdeal-viewer-bg-fallback">{(deal.hotelName || "H").slice(0, 1).toUpperCase()}</div>
          )}
          <div className="fdeal-viewer-bg-shade" />
        </div>

        {/* Discount stamp */}
        <div className="fdeal-viewer-stamp">
          <span className="fdeal-viewer-stamp-pct">-{deal.discount}%</span>
          <span className="fdeal-viewer-stamp-label">OFF</span>
        </div>

        {/* Hotel title + city */}
        <div className="fdeal-viewer-title-wrap">
          <h2 className="fdeal-viewer-title">{deal.hotelName}</h2>
          {deal.city && <p className="fdeal-viewer-city">📍 {deal.city} · {deal.roomType}</p>}
        </div>

        {/* Audio chip — shows what's playing. Tappable ✕ to remove a
            custom upload (partner/admin only). */}
        {audioSrc && (
          <div className="fdeal-viewer-audio-chip">
            <span className="fdeal-viewer-audio-icon">🎵</span>
            <span className="fdeal-viewer-audio-chip-name">
              {isCustomAudio ? "Custom audio" : `${defaultTrackFor(deal.hotelId).name} · ambient`}
            </span>
            {canEditAudio && isCustomAudio && (
              <button
                type="button"
                className="fdeal-viewer-audio-chip-rm"
                onClick={onRemoveAudio}
                aria-label="Remove custom audio"
              >✕</button>
            )}
          </div>
        )}

        {/* Bottom content: price + countdown + slots + CTA */}
        <div className="fdeal-viewer-bottom">
          {/* Countdown — switches between HH:MM:SS for <24h deals and
              "Xd Yh" for week-long deals (was capped at 99h before). */}
          {!cd.expired && (
            <div className="fdeal-viewer-countdown">
              <span className="fdeal-viewer-countdown-label">DEAL ENDS IN</span>
              {cd.mode === "long" ? (
                <span className="fdeal-viewer-countdown-time">
                  <span className="fdeal-viewer-countdown-cell">{cd.days}d</span>
                  <span className="fdeal-viewer-countdown-cell">{cd.hours}h</span>
                </span>
              ) : (
                <span className="fdeal-viewer-countdown-time">
                  <span className="fdeal-viewer-countdown-cell">{cd.h}</span>
                  <span className="fdeal-viewer-countdown-colon">:</span>
                  <span className="fdeal-viewer-countdown-cell">{cd.m}</span>
                  <span className="fdeal-viewer-countdown-colon">:</span>
                  <span className="fdeal-viewer-countdown-cell">{cd.s}</span>
                </span>
              )}
            </div>
          )}

          {/* Slots left */}
          {showSlots && slotsLeft > 0 && slotsLeft <= 5 && (
            <div className="fdeal-viewer-slots">
              🔥 Only <strong>{slotsLeft}</strong> {slotsLeft === 1 ? "room" : "rooms"} left at this price
            </div>
          )}

          {/* Price row */}
          <div className="fdeal-viewer-price-row">
            <div className="fdeal-viewer-price-left">
              {deal.floorPrice > deal.dealPrice && (
                <span className="fdeal-viewer-price-strike">{fmtINR(deal.floorPrice)}</span>
              )}
              <span className="fdeal-viewer-price-deal">{fmtINR(deal.dealPrice)}</span>
              <span className="fdeal-viewer-price-per">/night</span>
            </div>
            {savePerNight > 0 && (
              <span className="fdeal-viewer-save">
                Save {fmtINR(savePerNight)}
              </span>
            )}
          </div>

          {/* Book Now CTA */}
          <button
            type="button"
            className="fdeal-viewer-cta"
            onClick={() => {
              onTrackEvent?.("flash_story_book", { hotelId: deal.hotelId, dealId: deal.id });
              onBook(deal);
            }}
          >
            <span className="fdeal-viewer-cta-text">⚡ Book Now</span>
            <span className="fdeal-viewer-cta-sub">Instant confirm · 24×7 support</span>
          </button>

          {/* Secondary CTA — opens the full hotel page (gallery, reviews,
              amenities, room picker) without booking. Same destination as
              the View Hotel link inside /flash-deals page so the two
              surfaces stay consistent. */}
          <button
            type="button"
            className="fdeal-viewer-cta-secondary"
            onClick={() => {
              onTrackEvent?.("flash_story_view_hotel", { hotelId: deal.hotelId });
              onClose();
              if (typeof window !== "undefined") {
                window.location.href = `/hotels/${deal.hotelId}`;
              }
            }}
          >
            View hotel details →
          </button>
        </div>

        {/* Tap zones: left 30% = prev, right 30% = next, middle = pause */}
        <button
          type="button"
          aria-label="Previous deal"
          className="fdeal-viewer-tap-prev"
          onPointerDown={pause}
          onPointerUp={() => { resume(); goPrev(); }}
          onPointerLeave={resume}
          onPointerCancel={resume}
        />
        <button
          type="button"
          aria-label="Next deal"
          className="fdeal-viewer-tap-next"
          onPointerDown={pause}
          onPointerUp={() => { resume(); goNext(); }}
          onPointerLeave={resume}
          onPointerCancel={resume}
        />
      </div>

      <style jsx global>{`
        /* When the flash-deal viewer is open, hide every other piece of
           surrounding chrome so the viewer reads as truly fullscreen.
           Belt-and-braces in case the z-index lottery doesn't go our way
           in some browser. */
        body.fdeal-viewer-open .ig-filter-chip,
        body.fdeal-viewer-open .ig-bottom-dock,
        body.fdeal-viewer-open .sb-back-chip,
        body.fdeal-viewer-open .reel-brand-chrome {
          display: none !important;
        }

        @keyframes fdealViewerIn {
          from { opacity: 0; transform: scale(0.96); }
          to   { opacity: 1; transform: scale(1); }
        }
        @keyframes fdealViewerKenBurns {
          0%   { transform: scale(1.08) translate(0,0); }
          50%  { transform: scale(1.20) translate(-1.5%,-1%); }
          100% { transform: scale(1.08) translate(0,0); }
        }
        @keyframes fdealViewerStampSpin {
          0%   { transform: rotate(-12deg) scale(1);    box-shadow: 0 10px 32px rgba(184,134,11,0.45), 0 0 0 0 rgba(255,215,107,0.55), inset 0 2px 0 rgba(255,255,255,0.55), inset 0 -3px 6px rgba(110,74,8,0.35); }
          40%  { transform: rotate(-10deg) scale(1.10); box-shadow: 0 14px 38px rgba(184,134,11,0.65), 0 0 0 14px rgba(255,215,107,0),     inset 0 2px 0 rgba(255,255,255,0.55), inset 0 -3px 6px rgba(110,74,8,0.35); }
          70%  { transform: rotate(-14deg) scale(1.05); box-shadow: 0 14px 38px rgba(184,134,11,0.65), 0 0 0 22px rgba(255,215,107,0),     inset 0 2px 0 rgba(255,255,255,0.55), inset 0 -3px 6px rgba(110,74,8,0.35); }
          100% { transform: rotate(-12deg) scale(1);    box-shadow: 0 10px 32px rgba(184,134,11,0.45), 0 0 0 0 rgba(255,215,107,0.55), inset 0 2px 0 rgba(255,255,255,0.55), inset 0 -3px 6px rgba(110,74,8,0.35); }
        }
        @keyframes fdealViewerStampGlow {
          0%, 100% { filter: drop-shadow(0 0 8px rgba(255,215,107,0.45)); }
          50%      { filter: drop-shadow(0 0 18px rgba(255,215,107,0.85)); }
        }
        @keyframes fdealViewerStampShine {
          0%   { background-position: -120% 0; }
          100% { background-position: 220% 0; }
        }
        @keyframes fdealViewerCtaShimmer {
          0%   { background-position: -200% 0; }
          100% { background-position: 220% 0; }
        }
        @keyframes fdealViewerLiveDot {
          0%,100% { opacity: 1; transform: scale(1); }
          50%     { opacity: 0.35; transform: scale(1.35); }
        }

        .fdeal-viewer-root {
          position: fixed;
          inset: 0;
          z-index: 97;
          background: rgba(0,0,0,0.92);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 0;
          animation: fdealViewerIn 0.28s cubic-bezier(.32,1.2,.36,1) both;
        }
        .fdeal-viewer-card {
          position: relative;
          width: 100%;
          height: 100%;
          max-width: 480px;
          margin: 0 auto;
          overflow: hidden;
          background: #000;
        }

        .fdeal-viewer-progress {
          position: absolute;
          top: 10px;
          left: 12px;
          right: 12px;
          z-index: 30;
          display: flex;
          gap: 3px;
        }
        .fdeal-viewer-progress-track {
          flex: 1;
          height: 2.5px;
          border-radius: 999px;
          overflow: hidden;
          background: rgba(255,255,255,0.30);
        }
        .fdeal-viewer-progress-fill {
          height: 100%;
          background: #fff;
        }

        .fdeal-viewer-header {
          position: absolute;
          top: 22px;
          left: 12px;
          right: 12px;
          z-index: 30;
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        .fdeal-viewer-live {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 5px 10px;
          border-radius: 999px;
          background: linear-gradient(135deg, rgba(255,69,141,0.35), rgba(255,71,87,0.35));
          border: 1px solid rgba(255,255,255,0.25);
          color: #fff;
          font-size: 0.58rem;
          font-weight: 800;
          letter-spacing: 0.14em;
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
        }
        .fdeal-viewer-live-dot {
          width: 7px; height: 7px;
          border-radius: 999px;
          background: #fff;
          box-shadow: 0 0 8px rgba(255,255,255,0.9);
          animation: fdealViewerLiveDot 1.4s ease-in-out infinite;
        }
        .fdeal-viewer-close {
          width: 34px; height: 34px;
          border-radius: 999px;
          background: rgba(0,0,0,0.45);
          border: 1px solid rgba(255,255,255,0.22);
          color: #fff;
          font-size: 1.05rem;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
        }
        .fdeal-viewer-header-actions {
          display: inline-flex;
          align-items: center;
          gap: 8px;
        }
        .fdeal-viewer-audio-btn {
          width: 34px; height: 34px;
          border-radius: 999px;
          background: linear-gradient(135deg, rgba(255,215,107,0.32), rgba(240,180,41,0.18));
          border: 1px solid rgba(255,215,107,0.55);
          color: #ffd76b;
          font-size: 1rem;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
          box-shadow: 0 4px 12px rgba(240,180,41,0.3);
          transition: transform 0.18s cubic-bezier(.32,1.2,.36,1);
        }
        .fdeal-viewer-audio-btn:active { transform: scale(0.92); }
        .fdeal-viewer-mini-toast {
          position: absolute;
          bottom: 220px;
          left: 50%;
          transform: translateX(-50%);
          z-index: 35;
          padding: 8px 14px;
          border-radius: 999px;
          background: rgba(0,0,0,0.78);
          border: 1px solid rgba(255,255,255,0.22);
          color: #fff;
          font-size: 0.74rem;
          font-weight: 600;
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
          animation: fdealViewerIn 0.25s cubic-bezier(.32,1.2,.36,1) both;
        }
        .fdeal-viewer-audio-chip {
          position: absolute;
          left: 16px;
          top: 162px;
          z-index: 22;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          max-width: calc(100% - 32px);
          padding: 5px 9px 5px 7px;
          border-radius: 999px;
          background: rgba(0,0,0,0.4);
          border: 1px solid rgba(255,255,255,0.18);
          color: rgba(255,255,255,0.92);
          font-size: 0.62rem;
          font-weight: 600;
          letter-spacing: 0.02em;
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
        }
        .fdeal-viewer-audio-chip .fdeal-viewer-audio-icon {
          font-size: 0.78rem;
        }
        .fdeal-viewer-audio-chip-name {
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 180px;
        }
        .fdeal-viewer-audio-chip-rm {
          background: none;
          border: none;
          color: rgba(255,255,255,0.7);
          font-size: 0.78rem;
          margin-left: 2px;
          padding: 0 4px;
          cursor: pointer;
        }
        .fdeal-viewer-audio-chip-rm:hover { color: #fff; }

        .fdeal-viewer-bg {
          position: absolute;
          inset: 0;
          z-index: 1;
          background: #000;
          overflow: hidden;
        }
        .fdeal-viewer-bg-img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          animation: fdealViewerKenBurns 16s ease-in-out infinite;
        }
        .fdeal-viewer-bg-fallback {
          width: 100%;
          height: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 6rem;
          font-weight: 800;
          color: rgba(255,215,107,0.45);
          background: linear-gradient(135deg, #0a0a1a, #1a0a1a);
        }
        .fdeal-viewer-bg-shade {
          position: absolute;
          inset: 0;
          background:
            linear-gradient(to bottom, rgba(0,0,0,0.45) 0%, rgba(0,0,0,0) 28%, rgba(0,0,0,0) 50%, rgba(0,0,0,0.78) 100%);
          pointer-events: none;
        }

        /* Premium 3D gold stamp (v84) — replaces the v75-v83 pink/red
           candy look. Polished champagne metal feel: warm conic-gradient
           background with an inset highlight on top + inset shadow on
           bottom gives a real curvature illusion. The shine sweep adds
           a slow specular reflection. Live pulse ring is gold instead
           of pink. */
        .fdeal-viewer-stamp {
          position: absolute;
          top: 78px;
          right: 18px;
          z-index: 22;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          width: 96px;
          height: 96px;
          border-radius: 999px;
          background:
            radial-gradient(circle at 32% 28%, rgba(255,255,255,0.55) 0%, rgba(255,255,255,0) 35%),
            conic-gradient(from 210deg,
              #f0d060 0deg,
              #c9911a 90deg,
              #6e4a08 180deg,
              #c9911a 270deg,
              #f0d060 360deg);
          color: #2c1d04;
          border: 3px solid #fff9ec;
          box-shadow:
            0 10px 32px rgba(184,134,11,0.45),
            0 0 0 0 rgba(255,215,107,0.55),
            inset 0 2px 0 rgba(255,255,255,0.55),
            inset 0 -3px 6px rgba(110,74,8,0.35);
          animation:
            fdealViewerStampSpin 1.8s ease-in-out infinite,
            fdealViewerStampGlow 2.4s ease-in-out infinite;
          font-family: "Cormorant Garamond", "Georgia", serif;
          overflow: hidden;
        }
        /* Specular shine sweep — premium polish layer over the metal. */
        .fdeal-viewer-stamp::after {
          content: "";
          position: absolute;
          inset: 0;
          border-radius: inherit;
          background: linear-gradient(115deg, transparent 0%, transparent 35%, rgba(255,255,255,0.45) 50%, transparent 65%, transparent 100%);
          background-size: 220% 100%;
          background-position: -120% 0;
          animation: fdealViewerStampShine 3.5s linear infinite;
          pointer-events: none;
        }
        .fdeal-viewer-stamp-pct {
          font-size: 1.6rem;
          font-style: italic;
          font-weight: 700;
          line-height: 1;
          color: #2c1d04;
          text-shadow: 0 1px 0 rgba(255,255,255,0.45);
          z-index: 1;
        }
        .fdeal-viewer-stamp-label {
          font-size: 0.62rem;
          font-weight: 800;
          letter-spacing: 0.22em;
          margin-top: 4px;
          color: #4a3208;
          z-index: 1;
        }

        .fdeal-viewer-title-wrap {
          position: absolute;
          left: 16px;
          right: 120px;
          top: 78px;
          z-index: 22;
        }
        .fdeal-viewer-title {
          color: #fff;
          font-size: 1.55rem;
          font-weight: 800;
          line-height: 1.05;
          letter-spacing: -0.01em;
          margin: 0;
          text-shadow: 0 2px 8px rgba(0,0,0,0.65);
        }
        .fdeal-viewer-city {
          color: rgba(255,255,255,0.85);
          font-size: 0.78rem;
          font-weight: 500;
          margin: 4px 0 0;
          text-shadow: 0 1px 4px rgba(0,0,0,0.6);
        }

        .fdeal-viewer-bottom {
          position: absolute;
          left: 14px;
          right: 14px;
          bottom: calc(env(safe-area-inset-bottom, 0px) + 22px);
          z-index: 22;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .fdeal-viewer-countdown {
          background: rgba(0,0,0,0.5);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          border: 1px solid rgba(255,255,255,0.16);
          border-radius: 14px;
          padding: 10px 14px;
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        .fdeal-viewer-countdown-label {
          color: rgba(255,215,107,0.95);
          font-size: 0.6rem;
          font-weight: 800;
          letter-spacing: 0.16em;
        }
        .fdeal-viewer-countdown-time {
          display: inline-flex;
          align-items: center;
          gap: 2px;
          font-family: ui-monospace, "SF Mono", Menlo, monospace;
        }
        .fdeal-viewer-countdown-cell {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-width: 26px;
          padding: 3px 5px;
          border-radius: 6px;
          background: linear-gradient(180deg, rgba(255,255,255,0.18), rgba(255,255,255,0.05));
          border: 1px solid rgba(255,255,255,0.18);
          color: #fff;
          font-size: 0.85rem;
          font-weight: 700;
        }
        .fdeal-viewer-countdown-colon {
          color: rgba(255,255,255,0.7);
          font-weight: 700;
        }

        .fdeal-viewer-slots {
          background: linear-gradient(135deg, rgba(255,71,87,0.25), rgba(255,69,141,0.18));
          border: 1px solid rgba(255,71,87,0.45);
          border-radius: 12px;
          padding: 8px 12px;
          color: #ffd9dd;
          font-size: 0.74rem;
          font-weight: 600;
          text-align: center;
        }
        .fdeal-viewer-slots strong {
          color: #fff;
          font-weight: 800;
        }

        .fdeal-viewer-price-row {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: 10px;
          padding: 4px 4px 0;
        }
        .fdeal-viewer-price-left {
          display: inline-flex;
          align-items: baseline;
          gap: 8px;
          flex-wrap: wrap;
        }
        .fdeal-viewer-price-strike {
          color: rgba(255,255,255,0.55);
          font-size: 0.85rem;
          text-decoration: line-through;
          text-decoration-color: rgba(255,69,141,0.7);
          font-weight: 600;
        }
        .fdeal-viewer-price-deal {
          color: #fff;
          font-size: 1.75rem;
          font-weight: 900;
          letter-spacing: -0.02em;
          text-shadow: 0 2px 10px rgba(0,0,0,0.6);
        }
        .fdeal-viewer-price-per {
          color: rgba(255,255,255,0.72);
          font-size: 0.78rem;
          font-weight: 500;
        }
        .fdeal-viewer-save {
          color: #2ECC71;
          font-size: 0.74rem;
          font-weight: 800;
          padding: 4px 10px;
          border-radius: 999px;
          background: rgba(46,204,113,0.15);
          border: 1px solid rgba(46,204,113,0.45);
          letter-spacing: 0.02em;
        }

        .fdeal-viewer-cta {
          position: relative;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 2px;
          padding: 14px 18px;
          border-radius: 18px;
          border: none;
          cursor: pointer;
          background:
            linear-gradient(110deg, transparent 0%, rgba(255,255,255,0.32) 50%, transparent 100%),
            linear-gradient(135deg, #f0b429 0%, #ffd76b 50%, #f0b429 100%);
          background-size: 220% 100%, 100% 100%;
          background-position: -200% 0, 0 0;
          color: #0a0a14;
          font-weight: 800;
          box-shadow:
            0 12px 30px rgba(240,180,41,0.45),
            inset 0 1px 0 rgba(255,255,255,0.55),
            inset 0 -2px 0 rgba(0,0,0,0.15);
          animation: fdealViewerCtaShimmer 2.6s linear infinite;
          transition: transform 0.18s cubic-bezier(.32,1.2,.36,1);
        }
        .fdeal-viewer-cta:active { transform: scale(0.97); }
        .fdeal-viewer-cta-text {
          font-size: 1.05rem;
          letter-spacing: 0.02em;
        }
        .fdeal-viewer-cta-sub {
          font-size: 0.64rem;
          font-weight: 700;
          color: rgba(10,10,20,0.7);
          letter-spacing: 0.04em;
        }
        .fdeal-viewer-cta-secondary {
          display: block;
          width: 100%;
          padding: 10px 14px;
          margin-top: 6px;
          border-radius: 14px;
          background: rgba(255,255,255,0.10);
          border: 1px solid rgba(255,255,255,0.22);
          color: rgba(255,255,255,0.92);
          font-size: 0.78rem;
          font-weight: 600;
          letter-spacing: 0.02em;
          cursor: pointer;
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
          transition: transform 0.14s cubic-bezier(.32,1.2,.36,1), background 0.18s ease;
        }
        .fdeal-viewer-cta-secondary:active { transform: scale(0.97); }
        .fdeal-viewer-cta-secondary:hover { background: rgba(255,255,255,0.18); }

        .fdeal-viewer-tap-prev,
        .fdeal-viewer-tap-next {
          position: absolute;
          top: 60px;
          bottom: 220px;
          width: 30%;
          z-index: 15;
          background: transparent;
          border: none;
          cursor: pointer;
        }
        .fdeal-viewer-tap-prev { left: 0; }
        .fdeal-viewer-tap-next { right: 0; }
      `}</style>
    </div>
  );
}

// ─── Convenience hook: fetch live flash deals + filter by current city ─────
export function useFlashDealStories(city: string) {
  const [deals, setDeals] = useState<FlashDealStory[]>([]);
  const [loading, setLoading] = useState(true);
  const reqIdRef = useRef(0);

  useEffect(() => {
    const myId = ++reqIdRef.current;
    setLoading(true);
    // Send viewed deal ids so the API can push already-seen deals to the
    // bottom of their discount band — feed stays fresh on repeat visits.
    const viewed = readViewedIds();
    const qp = new URLSearchParams();
    if (city && city !== "all") qp.set("city", city);
    if (viewed.length) qp.set("viewed", viewed.slice(0, 30).join(","));
    const url = "/api/flash/near" + (qp.toString() ? `?${qp.toString()}` : "");
    fetch(url, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        // Stale-response guard — drop if a newer fetch already ran.
        if (myId !== reqIdRef.current) return;
        const raw = Array.isArray(d?.deals) ? d.deals : [];
        const normalized: FlashDealStory[] = (raw as any[])
          .map((d) => normalizeFlashDeal(d))
          .filter((x: FlashDealStory | null): x is FlashDealStory => x !== null)
          // Hide expired deals from the rail (the API already filters most,
          // but the validUntil can pass between fetch and render).
          .filter((d) => !countdown(d.validUntil).expired)
          // Cap at 18 — rail is horizontal-scroll but the user shouldn't have
          // to scroll forever; the highest-discount deals are surfaced first
          // by the API.
          .slice(0, 18);
        setDeals(normalized);
      })
      .catch(() => { if (myId === reqIdRef.current) setDeals([]); })
      .finally(() => { if (myId === reqIdRef.current) setLoading(false); });
  }, [city]);

  return { deals, loading };
}
