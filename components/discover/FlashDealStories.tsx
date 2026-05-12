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
// Hotel owners (sb_partner_token) and admins (sb_admin_token) can upload a
// custom mp3 from their device. Regular customers cannot — keeps the public
// surface clean from spam audio.
function canAttachAudio(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return !!(localStorage.getItem("sb_partner_token") || localStorage.getItem("sb_admin_token"));
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

function countdown(validUntil: string): { h: string; m: string; s: string; expired: boolean } {
  const ms = new Date(validUntil).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return { h: "00", m: "00", s: "00", expired: true };
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return { h: pad(Math.min(h, 99)), m: pad(m), s: pad(s), expired: false };
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
          <span className="fdeal-rail-live">
            <span className="fdeal-rail-live-dot" />
            FLASH DEALS
          </span>
          <span className="fdeal-rail-sub">{deals.length} live · today only</span>
        </div>
        <div className="fdeal-rail-scroll" role="list">
          {deals.map((d, i) => (
            <button
              key={d.id}
              role="listitem"
              type="button"
              className="fdeal-rail-item"
              onClick={() => onOpen(i)}
              aria-label={`Open flash deal at ${d.hotelName}: ${d.discount}% off, from ${fmtINR(d.dealPrice)} per night`}
            >
              <span className="fdeal-rail-ring">
                <span className="fdeal-rail-avatar">
                  {d.hotelImage
                    ? <img src={d.hotelImage} alt="" loading="lazy" decoding="async" />
                    : <span className="fdeal-rail-initials">{(d.hotelName || "H").slice(0, 1).toUpperCase()}</span>}
                </span>
                <span className="fdeal-rail-badge">-{d.discount}%</span>
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
        @keyframes fdealLiveDot {
          0%,100% { opacity: 1; transform: scale(1); }
          50%     { opacity: 0.35; transform: scale(1.35); }
        }
        @keyframes fdealBadgePulse {
          0%,100% { box-shadow: 0 0 0 0 rgba(255,69,141,0.0), 0 4px 10px rgba(0,0,0,0.45); }
          50%     { box-shadow: 0 0 0 6px rgba(255,69,141,0.18), 0 4px 12px rgba(255,69,141,0.55); }
        }
        @keyframes fdealRailSlideIn {
          from { transform: translateY(-12px); opacity: 0; }
          to   { transform: translateY(0);    opacity: 1; }
        }

        .fdeal-rail-wrap {
          position: absolute;
          top: 32px;
          left: 0;
          right: 0;
          z-index: 38;
          padding: 8px 10px 6px;
          background: linear-gradient(to bottom, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.18) 70%, rgba(0,0,0,0) 100%);
          backdrop-filter: blur(2px);
          -webkit-backdrop-filter: blur(2px);
          animation: fdealRailSlideIn 0.5s cubic-bezier(.32,1.2,.36,1) both;
        }
        .fdeal-rail-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 4px 6px;
        }
        .fdeal-rail-live {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          font-size: 0.58rem;
          font-weight: 800;
          letter-spacing: 0.16em;
          color: #ffd76b;
          text-shadow: 0 1px 3px rgba(0,0,0,0.6);
        }
        .fdeal-rail-live-dot {
          width: 6px; height: 6px;
          border-radius: 999px;
          background: #ff4757;
          box-shadow: 0 0 8px rgba(255,71,87,0.85);
          animation: fdealLiveDot 1.4s ease-in-out infinite;
        }
        .fdeal-rail-sub {
          font-size: 0.56rem;
          font-weight: 600;
          color: rgba(255,255,255,0.72);
          letter-spacing: 0.04em;
          text-shadow: 0 1px 3px rgba(0,0,0,0.65);
        }

        .fdeal-rail-scroll {
          display: flex;
          gap: 11px;
          overflow-x: auto;
          overflow-y: hidden;
          padding: 2px 4px 6px;
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
          gap: 4px;
          width: 64px;
          flex: 0 0 auto;
          scroll-snap-align: start;
          background: none;
          border: none;
          padding: 0;
          color: #fff;
          cursor: pointer;
          transition: transform 0.18s cubic-bezier(.32,1.2,.36,1);
        }
        .fdeal-rail-item:active { transform: scale(0.92); }

        .fdeal-rail-ring {
          position: relative;
          width: 60px;
          height: 60px;
          border-radius: 999px;
          padding: 2.5px;
          background: conic-gradient(from 0deg, #ffd76b, #ff458d, #b964ff, #ff6b3d, #ffd76b);
          animation: fdealRingSpin 6s linear infinite;
          box-shadow: 0 4px 14px rgba(255,69,141,0.35);
        }
        .fdeal-rail-avatar {
          display: block;
          width: 100%;
          height: 100%;
          border-radius: 999px;
          overflow: hidden;
          background: #1a1a1a;
          border: 2px solid #07060e;
          /* counter-rotate the inner so the image stays upright while the ring spins */
          animation: fdealRingSpin 6s linear infinite reverse;
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
          color: #ffd76b;
        }
        .fdeal-rail-badge {
          position: absolute;
          bottom: -3px;
          right: -4px;
          font-size: 0.54rem;
          font-weight: 800;
          color: #fff;
          background: linear-gradient(135deg, #ff4757, #ff458d);
          padding: 2px 5px;
          border-radius: 999px;
          border: 1.5px solid #07060e;
          letter-spacing: 0.02em;
          animation: fdealBadgePulse 2.2s ease-in-out infinite;
        }
        .fdeal-rail-name {
          font-size: 0.6rem;
          font-weight: 600;
          color: rgba(255,255,255,0.92);
          text-shadow: 0 1px 3px rgba(0,0,0,0.7);
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

  const canEditAudio = canAttachAudio();

  // Mark every deal viewed once it shows up — feeds the personalization
  // signal back into the API on the next /api/flash/near call.
  useEffect(() => {
    if (!open || !deal) return;
    markFlashDealViewed(deal.id);
  }, [open, idx, deal]);

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
          {/* Countdown */}
          {!cd.expired && (
            <div className="fdeal-viewer-countdown">
              <span className="fdeal-viewer-countdown-label">DEAL ENDS IN</span>
              <span className="fdeal-viewer-countdown-time">
                <span className="fdeal-viewer-countdown-cell">{cd.h}</span>
                <span className="fdeal-viewer-countdown-colon">:</span>
                <span className="fdeal-viewer-countdown-cell">{cd.m}</span>
                <span className="fdeal-viewer-countdown-colon">:</span>
                <span className="fdeal-viewer-countdown-cell">{cd.s}</span>
              </span>
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
          0%   { transform: rotate(-12deg) scale(1); }
          50%  { transform: rotate(-12deg) scale(1.05); }
          100% { transform: rotate(-12deg) scale(1); }
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

        .fdeal-viewer-stamp {
          position: absolute;
          top: 78px;
          right: 18px;
          z-index: 22;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          width: 88px;
          height: 88px;
          border-radius: 999px;
          background: linear-gradient(135deg, #ff4757, #ff458d);
          color: #fff;
          border: 3px solid rgba(255,255,255,0.92);
          box-shadow: 0 8px 26px rgba(255,69,141,0.55);
          animation: fdealViewerStampSpin 3s ease-in-out infinite;
          font-family: ui-monospace, "SF Mono", Menlo, monospace;
        }
        .fdeal-viewer-stamp-pct {
          font-size: 1.3rem;
          font-weight: 900;
          line-height: 1;
        }
        .fdeal-viewer-stamp-label {
          font-size: 0.6rem;
          font-weight: 800;
          letter-spacing: 0.18em;
          margin-top: 2px;
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
        const normalized = raw
          .map(normalizeFlashDeal)
          .filter((x): x is FlashDealStory => !!x)
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
