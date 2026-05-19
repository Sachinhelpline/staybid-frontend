"use client";
/*
 * v123 — Editorial mosaic hero gallery for /hotels/[id].
 *
 * On desktop renders a 5-up mosaic (1 big hero + 4 mosaic tiles with
 * varied aspect ratios) inside a single 21:11 box. On mobile renders a
 * 4:3 hero + a horizontal scroll strip of varied-aspect mini tiles.
 *
 * Tap any tile to open the full lightbox at that index.
 */
import { useMemo, useRef, useState, useEffect } from "react";

type Props = {
  name: string;
  city?: string;
  state?: string;
  starRating?: number;
  avgRating?: number;
  totalReviews?: number;
  trustBadge?: boolean;
  images?: string[];
  onOpenGallery: (index: number) => void;
};

const PLACEHOLDERS = [
  "https://images.unsplash.com/photo-1564501049412-61c2a3083791?w=1200&q=80",
  "https://images.unsplash.com/photo-1520250497591-112f2f40a3f4?w=900&q=80",
  "https://images.unsplash.com/photo-1571896349842-33c89424de2d?w=900&q=80",
  "https://images.unsplash.com/photo-1566073771259-6a8506099945?w=900&q=80",
  "https://images.unsplash.com/photo-1445019980597-93fa8acb246c?w=900&q=80",
  "https://images.unsplash.com/photo-1540555700478-4be289fbecef?w=900&q=80",
];

export default function HotelHero({
  name,
  city,
  state,
  starRating,
  avgRating,
  totalReviews,
  trustBadge,
  images,
  onOpenGallery,
}: Props) {
  const all = useMemo(() => {
    const base = Array.isArray(images) ? images.filter(Boolean) : [];
    const merged = [...base, ...PLACEHOLDERS];
    return merged.slice(0, Math.max(5, base.length));
  }, [images]);

  const hero = all[0] || PLACEHOLDERS[0];
  const t1 = all[1] || PLACEHOLDERS[1];
  const t2 = all[2] || PLACEHOLDERS[2];
  const t3 = all[3] || PLACEHOLDERS[3];
  const t4 = all[4] || PLACEHOLDERS[4];
  const more = all.length - 5;

  const onErr = (i: number) => (e: any) => {
    e.target.src = PLACEHOLDERS[i % PLACEHOLDERS.length];
  };

  // v159.9 — Live photo counter for the mobile swipe carousel. Read the
  // scrollLeft + clientWidth on every scroll tick to figure out which
  // slide is centered, then update the "N / total" overlay.
  const swipeRef = useRef<HTMLDivElement>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  useEffect(() => {
    const el = swipeRef.current;
    if (!el) return;
    const update = () => {
      const w = el.clientWidth || 1;
      const idx = Math.round(el.scrollLeft / w);
      setActiveIdx(Math.max(0, Math.min(all.length - 1, idx)));
    };
    el.addEventListener("scroll", update, { passive: true });
    return () => el.removeEventListener("scroll", update);
  }, [all.length]);

  return (
    <div className="hx-reveal">
      {/* v159.9 — Mobile-only full-bleed swipe carousel. Shows EVERY hotel
          photo as a snap slide. Counter overlay tracks the active index
          live. Tap any slide → opens the full lightbox at that index.
          Hidden on tablet+ where the mosaic below takes over. */}
      <div className="hx-hero-swipe-wrap">
        <div className="hx-hero-swipe" ref={swipeRef} role="region" aria-label={`${name} photo carousel`}>
          {all.map((src, i) => (
            <button
              key={i}
              type="button"
              className="hx-hero-swipe-slide"
              onClick={() => onOpenGallery(i)}
              aria-label={`View photo ${i + 1} of ${all.length}`}
            >
              <img
                src={src}
                alt={`${name} — view ${i + 1}`}
                className="hx-hero-swipe-img"
                onError={onErr(i)}
                loading={i === 0 ? "eager" : "lazy"}
                fetchPriority={i === 0 ? ("high" as any) : undefined}
              />
            </button>
          ))}
        </div>
        {trustBadge && (
          <span className="hx-hero-swipe-pill">✓ Verified Stay</span>
        )}
        <span className="hx-hero-swipe-counter" aria-live="polite">
          {activeIdx + 1} / {all.length}
        </span>
        <div className="hx-hero-swipe-dots" aria-hidden="true">
          {all.slice(0, Math.min(8, all.length)).map((_, i) => (
            <span
              key={i}
              className={`hx-hero-swipe-dot ${i === activeIdx ? "hx-hero-swipe-dot-active" : ""}`}
            />
          ))}
        </div>
      </div>

      <div className="hx-mosaic" role="region" aria-label={`${name} photo gallery`}>
        {/* HERO — content-aware: 4:3 on mobile, fills 2 rows on desktop */}
        <div
          className="hx-mosaic-tile hx-mosaic-tile-hero"
          onClick={() => onOpenGallery(0)}
          role="button"
          tabIndex={0}
        >
          <img
            src={hero}
            alt={`${name} — primary view`}
            className="hx-mosaic-img"
            onError={onErr(0)}
            loading="eager"
            fetchPriority="high"
          />

          {/* Hero verified pill */}
          {trustBadge && (
            <span className="hx-hero-pill">✓ Verified Stay</span>
          )}

          {/* Bottom-left name overlay */}
          <div className="hx-hero-overlay">
            <h1 className="hx-hero-name">{name}</h1>
            <div className="hx-hero-meta">
              {city ? (
                <span>
                  📍 {city}{state ? `, ${state}` : ""}
                </span>
              ) : null}
              {starRating ? (
                <>
                  <span className="hx-hero-meta-dot" />
                  <span style={{ letterSpacing: "0.18em" }}>
                    {"★".repeat(Math.min(5, Math.max(1, starRating)))}
                  </span>
                </>
              ) : null}
              {avgRating && avgRating > 0 ? (
                <>
                  <span className="hx-hero-meta-dot" />
                  <span>
                    ★ {avgRating.toFixed(1)}
                    {totalReviews ? ` · ${totalReviews} reviews` : ""}
                  </span>
                </>
              ) : null}
            </div>
          </div>

          {/* View-all-photos button */}
          <button
            type="button"
            className="hx-photos-btn"
            onClick={(e) => {
              e.stopPropagation();
              onOpenGallery(0);
            }}
            aria-label={`View all ${all.length} photos`}
          >
            📷 View all {all.length} photos
          </button>
        </div>

        {/* SIDE TILES — content-aware aspect ratios per tile (desktop) */}
        <div
          className="hx-mosaic-tile hx-mosaic-tile-side hx-mosaic-tile-side-1"
          onClick={() => onOpenGallery(1)}
          role="button"
          tabIndex={0}
        >
          <img src={t1} alt="" className="hx-mosaic-img" onError={onErr(1)} loading="lazy" />
        </div>
        <div
          className="hx-mosaic-tile hx-mosaic-tile-side hx-mosaic-tile-side-2"
          onClick={() => onOpenGallery(2)}
          role="button"
          tabIndex={0}
        >
          <img src={t2} alt="" className="hx-mosaic-img" onError={onErr(2)} loading="lazy" />
        </div>
        <div
          className="hx-mosaic-tile hx-mosaic-tile-side hx-mosaic-tile-side-3"
          onClick={() => onOpenGallery(3)}
          role="button"
          tabIndex={0}
        >
          <img src={t3} alt="" className="hx-mosaic-img" onError={onErr(3)} loading="lazy" />
        </div>
        <div
          className="hx-mosaic-tile hx-mosaic-tile-side hx-mosaic-tile-side-4"
          onClick={() => onOpenGallery(4)}
          role="button"
          tabIndex={0}
        >
          <img src={t4} alt="" className="hx-mosaic-img" onError={onErr(4)} loading="lazy" />
          {more > 0 && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                background: "rgba(31, 26, 15, 0.55)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#fff",
                fontWeight: 800,
                fontSize: "0.95rem",
                letterSpacing: "0.02em",
                zIndex: 2,
              }}
            >
              +{more} more
            </div>
          )}
        </div>
      </div>

      {/* Mobile-only strip — content-aware aspects (4:3 / 1:1 / 3:4 / 4:3 / more) */}
      <div className="hx-mosaic-strip-mobile" aria-hidden={false}>
        <button
          type="button"
          className="hx-mosaic-strip-tile hx-mosaic-strip-tile-1"
          onClick={() => onOpenGallery(1)}
          aria-label="Photo 2"
        >
          <img src={t1} alt="" className="hx-mosaic-strip-img" onError={onErr(1)} loading="lazy" />
        </button>
        <button
          type="button"
          className="hx-mosaic-strip-tile hx-mosaic-strip-tile-2"
          onClick={() => onOpenGallery(2)}
          aria-label="Photo 3"
        >
          <img src={t2} alt="" className="hx-mosaic-strip-img" onError={onErr(2)} loading="lazy" />
        </button>
        <button
          type="button"
          className="hx-mosaic-strip-tile hx-mosaic-strip-tile-3"
          onClick={() => onOpenGallery(3)}
          aria-label="Photo 4"
        >
          <img src={t3} alt="" className="hx-mosaic-strip-img" onError={onErr(3)} loading="lazy" />
        </button>
        <button
          type="button"
          className="hx-mosaic-strip-tile hx-mosaic-strip-tile-4"
          onClick={() => onOpenGallery(4)}
          aria-label="Photo 5"
        >
          <img src={t4} alt="" className="hx-mosaic-strip-img" onError={onErr(4)} loading="lazy" />
        </button>
        {more > 0 && (
          <button
            type="button"
            className="hx-mosaic-strip-tile hx-mosaic-strip-tile-more"
            onClick={() => onOpenGallery(5)}
            aria-label={`View ${more} more photos`}
          >
            <span>+{more}</span>
            <span>more</span>
          </button>
        )}
      </div>
    </div>
  );
}
