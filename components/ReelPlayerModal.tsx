"use client";
// ═══════════════════════════════════════════════════════════════════════════
// ReelPlayerModal — a tiny fullscreen IG-Reels-style video player. Used on
// /me (tap a grid thumbnail) and /saved (tap a saved reel card) so the
// reel actually plays in-place instead of dumping the user on /reels (the
// Creator Hub feed) where their personal post doesn't even live.
//
// Robust to:
//   • Dead blob: URLs (after a hard reload, PostsStore blobs expire). The
//     <video> onError handler shows the poster + a friendly message instead
//     of a broken player.
//   • Cross-origin video (SoundHelix, Google CDN test clips) — no crossOrigin
//     attr so the browser doesn't slap CORS-taint silence on us.
//   • Keyboard escape, click-outside, ✕ button — all close the modal.
//   • Animated mount/unmount via opacity + scale.
// ═══════════════════════════════════════════════════════════════════════════
import { useEffect, useRef, useState } from "react";

export type ReelMedia = {
  src:       string;   // video URL OR image URL (we sniff with the mime/ext)
  poster?:   string;   // thumbnail to show before play / on error
  caption?:  string;   // sanitized text overlay
  title?:    string;   // owner name / hotel name for the header
};

export function ReelPlayerModal({
  open,
  media,
  onClose,
}: {
  open:    boolean;
  media:   ReelMedia | null;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [errored, setErrored] = useState(false);

  // Reset error state every time a new media object is passed in.
  useEffect(() => {
    if (!open) return;
    setErrored(false);
  }, [open, media?.src]);

  // ESC to close
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Auto-play when modal opens (muted to satisfy autoplay policy; user
  // can tap the video to unmute).
  useEffect(() => {
    if (!open) return;
    const v = videoRef.current;
    if (!v) return;
    try {
      v.muted = true;
      v.currentTime = 0;
      const p = v.play();
      if (p && typeof p.then === "function") p.catch(() => {});
    } catch {}
  }, [open, media?.src]);

  if (!open || !media) return null;

  const isVideoExt = /\.(mp4|webm|mov|m4v)(\?|$)/i.test(media.src) ||
                     media.src.startsWith("blob:") ||
                     media.src.includes("video");

  return (
    <div className="reel-modal-root" onClick={onClose} role="dialog" aria-modal="true">
      <div className="reel-modal-card" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          onClick={onClose}
          className="reel-modal-close"
          aria-label="Close"
        >✕</button>

        {media.title && <div className="reel-modal-title">{media.title}</div>}

        <div className="reel-modal-stage">
          {(errored || !isVideoExt) ? (
            // Fallback: show poster image. Common for hard-reloaded blob:
            // URLs (PostsStore loses the underlying File on hard reload).
            <div className="reel-modal-fallback">
              {media.poster
                ? <img src={media.poster} alt={media.caption || ""} className="reel-modal-poster" />
                : <span className="reel-modal-fallback-icon">📷</span>}
              {!isVideoExt && (
                <p className="reel-modal-msg">Photo post</p>
              )}
              {isVideoExt && errored && (
                <p className="reel-modal-msg">Video unavailable — preview only</p>
              )}
            </div>
          ) : (
            <video
              ref={videoRef}
              src={media.src}
              poster={media.poster || undefined}
              className="reel-modal-video"
              autoPlay
              loop
              playsInline
              muted
              controls
              onError={() => setErrored(true)}
              onClick={(e) => {
                // Tap-to-unmute inside user gesture
                e.stopPropagation();
                const v = videoRef.current;
                if (!v) return;
                try {
                  v.muted = !v.muted;
                  if (!v.paused) return;
                  const p = v.play();
                  if (p && typeof p.then === "function") p.catch(() => {});
                } catch {}
              }}
            />
          )}
        </div>

        {media.caption && (
          <p className="reel-modal-caption">{media.caption}</p>
        )}
      </div>

      <style jsx global>{`
        @keyframes reelModalIn {
          from { opacity: 0; transform: scale(0.96); }
          to   { opacity: 1; transform: scale(1); }
        }
        .reel-modal-root {
          position: fixed;
          inset: 0;
          z-index: 95;
          background: rgba(0, 0, 0, 0.9);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 12px;
          animation: reelModalIn 0.22s cubic-bezier(.32,1.2,.36,1) both;
          backdrop-filter: blur(6px);
          -webkit-backdrop-filter: blur(6px);
        }
        .reel-modal-card {
          position: relative;
          width: 100%;
          max-width: 420px;
          height: 100%;
          max-height: 80vh;
          background: #07060e;
          border-radius: 18px;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          box-shadow: 0 24px 56px rgba(0, 0, 0, 0.55);
        }
        .reel-modal-close {
          position: absolute;
          top: 10px;
          right: 10px;
          z-index: 5;
          width: 34px;
          height: 34px;
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.92);
          color: #2c1d04;
          border: none;
          font-size: 1rem;
          font-weight: 800;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
        }
        .reel-modal-title {
          padding: 12px 50px 8px 14px;
          color: rgba(255, 255, 255, 0.92);
          font-size: 0.82rem;
          font-weight: 700;
          letter-spacing: 0.02em;
          background: linear-gradient(180deg, rgba(0,0,0,0.55), rgba(0,0,0,0));
          position: absolute;
          top: 0; left: 0; right: 0;
          z-index: 4;
          pointer-events: none;
        }
        .reel-modal-stage {
          flex: 1 1 auto;
          min-height: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #000;
          position: relative;
        }
        .reel-modal-video {
          width: 100%;
          height: 100%;
          object-fit: contain;
          background: #000;
        }
        .reel-modal-fallback {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 10px;
          width: 100%;
          height: 100%;
          padding: 16px;
        }
        .reel-modal-poster {
          max-width: 100%;
          max-height: 100%;
          object-fit: contain;
        }
        .reel-modal-fallback-icon {
          font-size: 3rem;
          opacity: 0.5;
        }
        .reel-modal-msg {
          color: rgba(255, 255, 255, 0.75);
          font-size: 0.78rem;
          font-weight: 600;
          margin: 0;
          padding: 6px 14px;
          border-radius: 999px;
          background: rgba(0, 0, 0, 0.5);
          border: 1px solid rgba(255, 255, 255, 0.18);
          position: absolute;
          bottom: 14px;
          left: 50%;
          transform: translateX(-50%);
        }
        .reel-modal-caption {
          padding: 10px 14px calc(env(safe-area-inset-bottom, 0px) + 12px);
          color: rgba(255, 255, 255, 0.92);
          font-size: 0.82rem;
          line-height: 1.35;
          background: linear-gradient(0deg, rgba(0,0,0,0.65), rgba(0,0,0,0));
          position: absolute;
          left: 0; right: 0; bottom: 0;
          z-index: 3;
          pointer-events: none;
        }
      `}</style>
    </div>
  );
}
