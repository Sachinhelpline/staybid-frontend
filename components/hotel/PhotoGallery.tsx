"use client";
// ═══════════════════════════════════════════════════════════════════════════
// components/hotel/PhotoGallery.tsx — v507
//
// Airbnb-style full-screen photo gallery for the hotel detail page. Replaces
// the old single-image lightbox. Two modes:
//   • GRID (default on open) — every photo in a responsive masonry grid, the
//     "Show all photos" experience. Optional tabs: All · Rooms (per-room photos
//     grouped by room, when rooms carry their own images).
//   • ZOOM — tap any photo → full-bleed viewer with ‹ › + thumbnail strip +
//     counter + keyboard (← → Esc).
//
// Category filtering by space-type (Bedroom / Bathroom / Exterior …) is Phase B
// (needs per-photo tags in the DB) — this Phase A ships the grid + Rooms tab
// from data that already exists (hotels.images + rooms.images).
//
// Self-contained: owns its mode/index/keyboard. The parent only toggles `open`.
// ═══════════════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useState } from "react";

type RoomLike = { name?: string; type?: string; images?: string[] };

type Props = {
  open: boolean;
  onClose: () => void;
  hotelName: string;
  images?: string[];
  rooms?: RoomLike[];
  initialIndex?: number;
};

const PLACEHOLDER = "https://images.unsplash.com/photo-1564501049412-61c2a3083791?w=800&q=80";

export default function PhotoGallery({ open, onClose, hotelName, images, rooms, initialIndex = 0 }: Props) {
  const allImages = useMemo(
    () => (Array.isArray(images) ? images.filter(Boolean) : []),
    [images]
  );

  // Per-room photo groups (only rooms that actually carry images).
  const roomGroups = useMemo(() => {
    const groups = (Array.isArray(rooms) ? rooms : [])
      .map((r) => ({
        title: r.name || r.type || "Room",
        imgs: (Array.isArray(r.images) ? r.images.filter(Boolean) : []),
      }))
      .filter((g) => g.imgs.length > 0);
    return groups;
  }, [rooms]);

  const hasRooms = roomGroups.length > 0;

  const [tab, setTab] = useState<"all" | "rooms">("all");
  const [zoom, setZoom] = useState(false);
  // The zoom viewer works over the CURRENTLY visible flat photo set.
  const [flatSet, setFlatSet] = useState<string[]>(allImages);
  const [idx, setIdx] = useState(initialIndex);

  // Reset when (re)opened.
  useEffect(() => {
    if (open) {
      setTab("all");
      setZoom(false);
      setFlatSet(allImages);
      setIdx(Math.min(Math.max(0, initialIndex), Math.max(0, allImages.length - 1)));
    }
  }, [open, allImages, initialIndex]);

  // Keyboard: Esc closes (zoom → grid → gallery), arrows page in zoom.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (zoom) setZoom(false);
        else onClose();
      } else if (zoom && e.key === "ArrowLeft") {
        e.preventDefault();
        setIdx((i) => Math.max(0, i - 1));
      } else if (zoom && e.key === "ArrowRight") {
        e.preventDefault();
        setIdx((i) => Math.min(flatSet.length - 1, i + 1));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, zoom, flatSet.length, onClose]);

  if (!open) return null;

  const openZoom = (set: string[], i: number) => {
    setFlatSet(set.length ? set : allImages);
    setIdx(i);
    setZoom(true);
  };

  const onImgErr = (e: any) => { e.currentTarget.src = PLACEHOLDER; };
  const total = allImages.length;

  return (
    <div className="pg-root" role="dialog" aria-modal="true" aria-label={`${hotelName} photos`}>
      {/* ── Sticky header ── */}
      <header className="pg-head">
        <button type="button" className="pg-head-btn" onClick={() => (zoom ? setZoom(false) : onClose())} aria-label={zoom ? "Back to all photos" : "Close gallery"}>
          {zoom ? "‹ All photos" : "✕ Close"}
        </button>
        <div className="pg-head-title">
          <span className="pg-head-name">{hotelName}</span>
          <span className="pg-head-count">{total} photo{total === 1 ? "" : "s"}</span>
        </div>
        {hasRooms && !zoom ? (
          <div className="pg-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={tab === "all"} className={`pg-tab${tab === "all" ? " is-on" : ""}`} onClick={() => setTab("all")}>All</button>
            <button type="button" role="tab" aria-selected={tab === "rooms"} className={`pg-tab${tab === "rooms" ? " is-on" : ""}`} onClick={() => setTab("rooms")}>Rooms</button>
          </div>
        ) : <span className="pg-head-spacer" />}
      </header>

      {/* ── ZOOM viewer ── */}
      {zoom ? (
        <div className="pg-zoom" onClick={() => setZoom(false)}>
          <div className="pg-zoom-stage" onClick={(e) => e.stopPropagation()}>
            <img src={flatSet[idx] || PLACEHOLDER} alt={`${hotelName} — photo ${idx + 1}`} className="pg-zoom-img" onError={onImgErr} />
            {idx > 0 && (
              <button type="button" className="pg-zoom-nav pg-zoom-prev" onClick={() => setIdx((i) => Math.max(0, i - 1))} aria-label="Previous photo">‹</button>
            )}
            {idx < flatSet.length - 1 && (
              <button type="button" className="pg-zoom-nav pg-zoom-next" onClick={() => setIdx((i) => Math.min(flatSet.length - 1, i + 1))} aria-label="Next photo">›</button>
            )}
          </div>
          <p className="pg-zoom-count">{idx + 1} / {flatSet.length}<span className="pg-zoom-hint"> · ← → navigate · Esc back</span></p>
          <div className="pg-zoom-strip" onClick={(e) => e.stopPropagation()}>
            {flatSet.map((im, i) => (
              <button key={i} type="button" className={`pg-strip-thumb${i === idx ? " is-on" : ""}`} onClick={() => setIdx(i)}>
                <img src={im} alt="" onError={onImgErr} />
              </button>
            ))}
          </div>
        </div>
      ) : (
        /* ── GRID ── */
        <div className="pg-scroll">
          {tab === "all" || !hasRooms ? (
            <div className="pg-grid">
              {allImages.map((im, i) => (
                <button key={i} type="button" className={`pg-cell${i === 0 ? " pg-cell-hero" : ""}`} onClick={() => openZoom(allImages, i)}>
                  <img src={im} alt={`${hotelName} — photo ${i + 1}`} loading="lazy" onError={onImgErr} />
                </button>
              ))}
              {allImages.length === 0 && <p className="pg-empty">No photos yet.</p>}
            </div>
          ) : (
            <div className="pg-rooms">
              {roomGroups.map((g, gi) => (
                <section key={gi} className="pg-room">
                  <h3 className="pg-room-title">{g.title}</h3>
                  <div className="pg-grid">
                    {g.imgs.map((im, i) => (
                      <button key={i} type="button" className="pg-cell" onClick={() => openZoom(g.imgs, i)}>
                        <img src={im} alt={`${g.title} — photo ${i + 1}`} loading="lazy" onError={onImgErr} />
                      </button>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>
      )}

      <style jsx>{`
        .pg-root {
          position: fixed; inset: 0; z-index: 90;
          background: #0b0a08;
          display: flex; flex-direction: column;
          animation: pgFade 0.2s ease both;
        }
        @keyframes pgFade { from { opacity: 0; } to { opacity: 1; } }
        .pg-head {
          flex-shrink: 0;
          display: flex; align-items: center; justify-content: space-between; gap: 12px;
          padding: 12px 16px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.08);
          background: rgba(11, 10, 8, 0.9);
          -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px);
        }
        .pg-head-btn {
          flex-shrink: 0;
          font-size: 0.82rem; font-weight: 700; color: #efe6d2;
          background: rgba(255, 255, 255, 0.08); border: 1px solid rgba(255, 255, 255, 0.14);
          padding: 8px 14px; border-radius: 999px; cursor: pointer;
          transition: background 0.16s ease;
        }
        .pg-head-btn:hover { background: rgba(255, 255, 255, 0.16); }
        .pg-head-title { text-align: center; min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 1px; }
        .pg-head-name { font-size: 0.9rem; font-weight: 700; color: #fbf5ea; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .pg-head-count { font-size: 0.68rem; color: rgba(242, 236, 221, 0.55); }
        .pg-head-spacer { width: 92px; flex-shrink: 0; }
        .pg-tabs { display: flex; gap: 4px; flex-shrink: 0; background: rgba(255, 255, 255, 0.06); padding: 3px; border-radius: 999px; }
        .pg-tab {
          font-size: 0.76rem; font-weight: 700; color: rgba(242, 236, 221, 0.7);
          padding: 6px 14px; border-radius: 999px; border: none; background: transparent; cursor: pointer;
          transition: background 0.16s ease, color 0.16s ease;
        }
        .pg-tab.is-on { background: #efe6d2; color: #2a2115; }

        .pg-scroll { flex: 1; overflow-y: auto; padding: 18px 16px 60px; }
        .pg-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 10px;
          max-width: 1100px; margin: 0 auto;
        }
        @media (min-width: 900px) { .pg-grid { grid-template-columns: repeat(3, 1fr); gap: 12px; } }
        .pg-cell {
          position: relative; padding: 0; border: none; cursor: pointer;
          border-radius: 14px; overflow: hidden; background: #1a1610;
          aspect-ratio: 4 / 3;
          transition: transform 0.18s ease, box-shadow 0.2s ease;
        }
        .pg-cell:hover { transform: translateY(-2px); box-shadow: 0 12px 30px -12px rgba(0, 0, 0, 0.6); }
        .pg-cell img { width: 100%; height: 100%; object-fit: cover; display: block; }
        /* First photo spans 2 cols as a hero, Airbnb-style. */
        @media (min-width: 900px) { .pg-cell-hero { grid-column: span 2; grid-row: span 2; aspect-ratio: 16 / 11; } }
        .pg-empty { color: rgba(242, 236, 221, 0.6); text-align: center; padding: 40px; }

        .pg-rooms { max-width: 1100px; margin: 0 auto; display: flex; flex-direction: column; gap: 28px; }
        .pg-room-title {
          font-family: var(--font-display, "Cormorant Garamond"), serif;
          font-size: 1.25rem; font-weight: 700; color: #fbf5ea; margin: 0 0 12px;
        }

        .pg-zoom { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 16px; min-height: 0; }
        .pg-zoom-stage { position: relative; max-width: 1000px; width: 100%; flex: 1; display: flex; align-items: center; justify-content: center; min-height: 0; }
        .pg-zoom-img { max-height: 76vh; max-width: 100%; object-fit: contain; border-radius: 12px; }
        .pg-zoom-nav {
          position: absolute; top: 50%; transform: translateY(-50%);
          width: 44px; height: 44px; border-radius: 999px;
          background: rgba(0, 0, 0, 0.55); color: #fff; border: 1px solid rgba(255, 255, 255, 0.16);
          font-size: 1.5rem; line-height: 1; cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          transition: background 0.16s ease;
        }
        .pg-zoom-nav:hover { background: rgba(0, 0, 0, 0.8); }
        .pg-zoom-prev { left: 10px; }
        .pg-zoom-next { right: 10px; }
        .pg-zoom-count { color: rgba(242, 236, 221, 0.55); font-size: 0.82rem; margin: 12px 0 10px; }
        .pg-zoom-hint { color: rgba(242, 236, 221, 0.3); font-size: 0.72rem; }
        @media (max-width: 640px) { .pg-zoom-hint { display: none; } }
        .pg-zoom-strip { display: flex; gap: 8px; overflow-x: auto; max-width: 100%; padding-bottom: 6px; scrollbar-width: none; }
        .pg-zoom-strip::-webkit-scrollbar { display: none; }
        .pg-strip-thumb {
          flex-shrink: 0; width: 64px; height: 46px; border-radius: 10px; overflow: hidden; cursor: pointer;
          border: 2px solid transparent; opacity: 0.55; padding: 0; background: #1a1610;
          transition: opacity 0.16s ease, border-color 0.16s ease, transform 0.16s ease;
        }
        .pg-strip-thumb.is-on { opacity: 1; border-color: #f0c24a; transform: scale(1.05); }
        .pg-strip-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
      `}</style>
    </div>
  );
}
