"use client";
// v466 — Desktop reel Phase 2: the two side panels that flank the centred
// phone frame on wide screens, so the reel/home feed uses the desktop canvas
// instead of floating in empty gutters (TikTok/YouTube-web pattern).
//
//   • RIGHT  — "Now playing": the ACTIVE reel's hotel card (cover, name,
//               rating, city, from-price) + View & Book / Make-an-offer CTAs.
//   • LEFT   — "Up next": a queue of the following reels (thumb + name + price).
//
// Fully driven by DiscoverPage's existing `items` + active index — NO edits to
// the load-bearing InstagramHotelFeed, no new store, no data/dedup touch. The
// panels are `position: fixed` and ENTIRELY hidden below the wide breakpoints
// via app/desktop.css (right ≥1200px, left ≥1440px), so mobile/tablet render
// nothing. CTAs are plain deep-links into the existing hotel page.

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

type Item = { hotel: any };

// Scroll the reel feed's snap container to a given reel index (used by the
// up-next queue and the ↑/↓ keyboard handler). The feed renders every card in
// order, so the Nth `.ig-card` maps 1:1 to items[N].
function scrollFeedToIndex(i: number) {
  const feed = document.querySelector<HTMLElement>(".ig-feed");
  if (!feed) return;
  const cards = feed.querySelectorAll<HTMLElement>(".ig-card");
  const el = cards[i];
  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  else feed.scrollTo({ top: feed.clientHeight * i, behavior: "smooth" });
}

const inr = (n: number) => "₹" + Number(n || 0).toLocaleString("en-IN");
const priceOf = (h: any): number => Number(h?.minPrice || h?.rooms?.[0]?.floorPrice || 0);
const imgOf = (h: any): string => (Array.isArray(h?.images) ? h.images.filter(Boolean) : [])[0] || "";

export default function DesktopReelPanels({ items, activeIndex }: { items: Item[]; activeIndex: number }) {
  // Render nothing during SSR / first paint to avoid a hydration flash; the
  // CSS media queries do the real desktop gating.
  const [ready, setReady] = useState(false);
  useEffect(() => { setReady(true); }, []);

  // v467 (Phase 3) — desktop keyboard navigation between reels: ↑/↓ + PageUp/
  // Down scroll the feed's snap container by one frame, mirroring mobile swipe.
  // Ignored while typing in a field; harmless on mobile (no arrow keys).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      const feed = document.querySelector<HTMLElement>(".ig-feed");
      if (!feed) return;
      if (e.key === "ArrowDown" || e.key === "PageDown") {
        e.preventDefault(); feed.scrollBy({ top: feed.clientHeight, behavior: "smooth" });
      } else if (e.key === "ArrowUp" || e.key === "PageUp") {
        e.preventDefault(); feed.scrollBy({ top: -feed.clientHeight, behavior: "smooth" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!ready || !items?.length) return null;

  const idx = Math.max(0, Math.min(Number(activeIndex) || 0, items.length - 1));
  const h = items[idx]?.hotel;
  if (!h) return null;

  const price = priceOf(h);
  const rating = Math.round(Number(h.starRating || 0));
  const hotelId = h.id || h._taggedHotelId || "";
  const place = [h.city, h.state].filter(Boolean).join(", ");

  const upNext: Item[] = [];
  for (let k = 1; k <= 5 && items[idx + k]; k++) upNext.push(items[idx + k]);

  return (
    <>
      {/* RIGHT — now-playing context + booking actions. No cover image here:
          the reel itself is the visual in the centre; a duplicate cover only
          went black on image-less reels. This is a clean info card. */}
      <aside className="reel-side reel-side-right" aria-label="Current stay">
        <div className="reel-side-body">
          <div className="reel-side-kicker">Now playing</div>
          <h3 className="reel-side-title">{h.name || "Stay"}</h3>
          <div className="reel-side-meta">
            {rating > 0 && <span className="reel-side-stars">{"★".repeat(Math.min(5, rating))}</span>}
            {place && <span className="reel-side-place">{place}</span>}
          </div>
          {price > 0 && (
            <div className="reel-side-price">
              <span>From</span> <b className="tabular-nums">{inr(price)}</b> <em>/night</em>
            </div>
          )}
          {hotelId && (
            <div className="reel-side-cta">
              <Link href={`/hotels/${hotelId}`} className="reel-side-btn primary">View &amp; Book</Link>
              <Link href={`/hotels/${hotelId}#negotiate`} className="reel-side-btn ghost">Make an offer</Link>
            </div>
          )}
          {h.description && <p className="reel-side-desc">{String(h.description).slice(0, 180)}</p>}
          <div className="reel-side-hint">↑ ↓ to browse reels</div>
        </div>
      </aside>

      {/* LEFT — up-next queue */}
      {upNext.length > 0 && (
        <aside className="reel-side reel-side-left" aria-label="Up next">
          <div className="reel-side-kicker">Up next</div>
          <div className="reel-queue">
            {upNext.map((it, i) => {
              const uh = it.hotel || {};
              const up = priceOf(uh);
              const targetIdx = idx + 1 + i; // this item's real position in the feed
              return (
                <button
                  key={targetIdx}
                  type="button"
                  className="reel-queue-item"
                  onClick={() => scrollFeedToIndex(targetIdx)}
                  title={`Play ${uh.name || "this reel"}`}
                >
                  <span className="reel-queue-thumb" style={{ backgroundImage: `url("${imgOf(uh)}")` }} aria-hidden />
                  <span className="reel-queue-info">
                    <span className="reel-queue-name">{uh.name || "Stay"}</span>
                    <span className="reel-queue-sub">
                      {uh.city || ""}{up > 0 ? `${uh.city ? " · " : ""}${inr(up)}/n` : ""}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </aside>
      )}
    </>
  );
}
