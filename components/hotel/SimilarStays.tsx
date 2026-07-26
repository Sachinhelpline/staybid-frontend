"use client";
// ═══════════════════════════════════════════════════════════════════════════
// components/hotel/SimilarStays.tsx — v506
//
// "More stays in <city>" — a horizontal, scroll-snapping carousel of SIMILAR
// approved hotels shown at the bottom of a hotel detail page (Airbnb "More
// stays nearby" pattern). Keeps the customer in-funnel: if this property is
// missing something, they can jump straight to a comparable one in the same
// city without going back to browse-all.
//
// Data: reuses the existing `/api/hotels?city=` (approved-only, rooms attached).
//   • Excludes the current hotel.
//   • Ranks: same star-category first, then by rating.
//   • "from ₹X" = the cheapest room floorPrice on that hotel (if any).
// Pure client + read-only. Renders nothing if <2 comparable stays are found, so
// a thin-inventory city never shows an empty rail.
// ═══════════════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { getAffinity, rankCandidates } from "@/lib/hotel-affinity";

type Props = {
  hotelId: string;
  city?: string;
  state?: string;
  starRating?: number;
  /** The property_type of the hotel the customer is currently viewing —
   *  same-type stays are surfaced first ("same style" rule). */
  propertyType?: string;
  /** Current hotel's from-price + rating, so each suggestion can say WHY it's
   *  a good alternative (cheaper / higher rated) vs. this one. */
  currentPrice?: number;
  currentRating?: number;
};

type SimHotel = {
  id: string;
  name: string;
  city?: string;
  state?: string;
  images?: string[];
  avgRating?: number;
  starRating?: number;
  fromPrice?: number;
  propertyType?: string;
  _reason?: string;
};

export default function SimilarStays({ hotelId, city, state, starRating, propertyType, currentPrice, currentRating }: Props) {
  const [hotels, setHotels] = useState<SimHotel[]>([]);
  // v516 — where the shown stays came from, so the heading reads honestly:
  // "in <city>" when the city had enough peers, else "in <state>" / "nearby".
  const [scope, setScope] = useState<"city" | "state">("city");
  const railRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    if (!city) return;

    const mapHotel = (h: any): SimHotel | null => {
      if (!h || !h.id || String(h.id) === String(hotelId)) return null;
      const rooms = Array.isArray(h.rooms) ? h.rooms : [];
      const prices = rooms
        .map((r: any) => Number(r?.floorPrice))
        .filter((n: number) => Number.isFinite(n) && n > 0);
      return {
        id: String(h.id),
        name: h.name,
        city: h.city,
        state: h.state,
        images: Array.isArray(h.images) ? h.images : [],
        avgRating: Number(h.avgRating) || undefined,
        starRating: Number(h.starRating) || undefined,
        fromPrice: prices.length ? Math.min(...prices) : undefined,
        propertyType: h.property_type || undefined,
      };
    };
    const unwrap = (res: any): any[] =>
      Array.isArray(res) ? res : (res?.hotels || res?.data || []);

    (async () => {
      try {
        let mapped: SimHotel[] = unwrap(await api.getHotels({ city }))
          .map(mapHotel)
          .filter((h): h is SimHotel => !!h);
        let usedScope: "city" | "state" = "city";

        // v516 — Fallback so the rail still shows in thin cities (e.g. Goa):
        // if the same city has <2 comparable stays, broaden to the same STATE
        // (which covers nearby cities). Same-city results are still ranked in.
        if (mapped.length < 2 && state) {
          const seen = new Set(mapped.map((h) => h.id).concat(String(hotelId)));
          const stateExtra = unwrap(await api.getHotels({}))
            .map(mapHotel)
            .filter((h): h is SimHotel => !!h)
            .filter(
              (h) =>
                !seen.has(h.id) &&
                String(h.state || "").toLowerCase() === String(state).toLowerCase()
            );
          if (stateExtra.length) {
            mapped = [...mapped, ...stateExtra];
            usedScope = "state";
          }
        }

        // Same-type stays first (the owner's "show the same style they picked"
        // rule), then ranked by the customer's inferred price/quality affinity
        // — captured silently from their click trail across hotel pages.
        const ranked = rankCandidates(
          mapped.map((h) => ({ ...h, avgRating: h.avgRating })),
          { propertyType, currentPrice, currentRating, affinity: getAffinity() }
        );
        const out: SimHotel[] = ranked.map((r: any) => ({ ...r }));
        if (alive) { setHotels(out.slice(0, 12)); setScope(usedScope); }
      } catch {
        /* silent — a recommendations rail must never break the page */
      }
    })();
    return () => { alive = false; };
  }, [hotelId, city, state, propertyType, currentPrice, currentRating]);

  const scrollBy = (dir: 1 | -1) => {
    const el = railRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.min(el.clientWidth * 0.9, 720), behavior: "smooth" });
  };

  // Heading follows the scope: same-city when the city had peers, else the
  // state (covers nearby cities) so "More stays in <X>" is always truthful.
  const headLabel = useMemo(
    () => (scope === "state" ? (state || "nearby") : (city || "this area")),
    [scope, state, city]
  );

  if (hotels.length < 2) return null;

  return (
    <section className="sim-stays hx-reveal" aria-label={`More stays in ${headLabel}`}>
      <div className="sim-head">
        <div>
          <h2 className="sim-title">More stays in {headLabel}</h2>
          <p className="sim-sub">Similar properties you can compare · book or negotiate on StayBid</p>
        </div>
        <div className="sim-nav">
          <button type="button" className="sim-nav-btn" onClick={() => scrollBy(-1)} aria-label="Scroll left">‹</button>
          <button type="button" className="sim-nav-btn" onClick={() => scrollBy(1)} aria-label="Scroll right">›</button>
        </div>
      </div>

      <div className="sim-rail" ref={railRef} role="list">
        {hotels.map((h) => (
          <Link key={h.id} href={`/hotels/${h.id}`} className="sim-card" role="listitem">
            <div className="sim-card-img">
              {h.images && h.images[0]
                ? <img src={h.images[0]} alt={h.name} loading="lazy"
                    onError={(e: any) => { e.currentTarget.style.display = "none"; }} />
                : <span className="sim-card-ph">🏨</span>}
              {h.starRating ? <span className="sim-card-badge">{"★".repeat(Math.min(5, h.starRating))}</span> : null}
              {h._reason ? <span className="sim-card-reason">{h._reason}</span> : null}
            </div>
            <div className="sim-card-body">
              <p className="sim-card-name" title={h.name}>{h.name}</p>
              <p className="sim-card-loc">📍 {h.city}{h.state ? `, ${h.state}` : ""}</p>
              <div className="sim-card-foot">
                {h.fromPrice
                  ? <span className="sim-card-price">from <b>₹{h.fromPrice.toLocaleString("en-IN")}</b><em>/night</em></span>
                  : <span className="sim-card-price sim-card-price--muted">View deal</span>}
                {h.avgRating ? <span className="sim-card-rating">★ {h.avgRating.toFixed(1)}</span> : null}
              </div>
            </div>
          </Link>
        ))}
      </div>

      <style jsx>{`
        .sim-stays { margin: 8px 0 44px; }
        .sim-head {
          display: flex; align-items: flex-end; justify-content: space-between;
          gap: 12px; margin-bottom: 16px;
        }
        .sim-title {
          font-family: var(--font-display, "Cormorant Garamond"), serif;
          font-size: 1.55rem; font-weight: 700; color: var(--text-base); margin: 0; line-height: 1.1;
        }
        .sim-sub { font-size: 0.8rem; color: var(--text-muted); margin: 4px 0 0; }
        .sim-nav { display: flex; gap: 8px; flex-shrink: 0; }
        .sim-nav-btn {
          width: 38px; height: 38px; border-radius: 999px; cursor: pointer;
          font-size: 1.3rem; line-height: 1; font-weight: 700;
          display: inline-flex; align-items: center; justify-content: center;
          background: var(--bg-pill); color: var(--text-base);
          border: 1px solid var(--border-soft);
          transition: transform 0.14s ease, background 0.18s ease, border-color 0.18s ease;
        }
        .sim-nav-btn:hover { border-color: var(--accent); transform: scale(1.06); }
        .sim-nav-btn:active { transform: scale(0.92); }

        .sim-rail {
          display: grid;
          grid-auto-flow: column;
          grid-auto-columns: 78%;
          gap: 14px;
          overflow-x: auto;
          scroll-snap-type: x mandatory;
          scrollbar-width: none;
          padding-bottom: 4px;
          margin: 0 -4px;
          padding-inline: 4px;
        }
        .sim-rail::-webkit-scrollbar { display: none; }
        @media (min-width: 640px) { .sim-rail { grid-auto-columns: 42%; } }
        @media (min-width: 1024px) { .sim-rail { grid-auto-columns: 260px; gap: 18px; } }

        .sim-card {
          scroll-snap-align: start;
          display: flex; flex-direction: column;
          background: var(--bg-card);
          border: 1px solid var(--border-soft);
          /* v508 — match the app's premium rounded cards (room cards use 24px).
             The image sits inside, so the card's overflow:hidden rounds it too. */
          border-radius: 22px;
          overflow: hidden;
          text-decoration: none;
          box-shadow: 0 10px 28px -18px rgba(31, 26, 15, 0.24);
          transition: transform 0.22s ease, box-shadow 0.24s ease, border-color 0.24s ease;
        }
        .sim-card:hover {
          transform: translateY(-3px);
          box-shadow: 0 20px 44px -22px rgba(201, 166, 107, 0.4);
          border-color: rgba(201, 166, 107, 0.45);
        }
        .sim-card-img {
          position: relative; width: 100%; aspect-ratio: 4 / 3;
          background: linear-gradient(135deg, #efe4cf, #ddcbaa);
          display: flex; align-items: center; justify-content: center;
          overflow: hidden;
          /* explicit top rounding so the photo's corners always read as curved */
          border-top-left-radius: 21px;
          border-top-right-radius: 21px;
        }
        .sim-card-img img { width: 100%; height: 100%; object-fit: cover; display: block; }
        .sim-card-reason {
          position: absolute; bottom: 10px; left: 10px;
          font-size: 0.62rem; font-weight: 800; letter-spacing: 0.02em;
          color: #2a1f0c;
          background: linear-gradient(135deg, #f4e3b8, #e9c877);
          padding: 4px 9px; border-radius: 999px;
          box-shadow: 0 4px 12px -4px rgba(0, 0, 0, 0.45);
        }
        .sim-card-ph { font-size: 2rem; opacity: 0.5; }
        .sim-card-badge {
          position: absolute; top: 10px; left: 10px;
          font-size: 0.62rem; letter-spacing: 1px; color: #f0c24a;
          background: rgba(0, 0, 0, 0.42); padding: 3px 8px; border-radius: 999px;
          -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px);
        }
        .sim-card-body { padding: 12px 13px 13px; display: flex; flex-direction: column; gap: 5px; flex: 1; }
        .sim-card-name {
          font-size: 0.92rem; font-weight: 700; color: var(--text-base); margin: 0;
          line-height: 1.25; display: -webkit-box; -webkit-line-clamp: 2;
          -webkit-box-orient: vertical; overflow: hidden;
        }
        .sim-card-loc {
          font-size: 0.74rem; color: var(--text-muted); margin: 0;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .sim-card-foot {
          display: flex; align-items: center; justify-content: space-between;
          gap: 8px; margin-top: auto; padding-top: 6px;
        }
        .sim-card-price { font-size: 0.76rem; color: var(--text-soft); }
        .sim-card-price b { font-size: 0.98rem; color: var(--text-base); font-weight: 800; }
        .sim-card-price em { font-style: normal; font-size: 0.66rem; color: var(--text-muted); margin-left: 1px; }
        .sim-card-price--muted { color: var(--text-muted); font-weight: 600; }
        .sim-card-rating {
          font-size: 0.72rem; font-weight: 700; color: var(--text-base);
          background: var(--bg-pill); border: 1px solid var(--border-soft);
          padding: 2px 8px; border-radius: 999px; flex-shrink: 0;
        }
      `}</style>
    </section>
  );
}
