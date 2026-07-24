"use client";
// v466 → v471 — Desktop reel side panels, unified into a "desktop app window".
//
//   • v466: two frosted panels flanking the centred phone frame
//     (RIGHT "Now playing", LEFT "Up next").
//   • v471 (this): on ≥1440px + home the two panels sit inside ONE frosted-glass
//     window with a full-width **Flash Deals stories rail** across the top. The
//     portrait reel frame (.reel-page-root, a separate fixed element) is pushed
//     BELOW the rail, still centred, same 9:16 size. The in-frame flash rail is
//     hidden on desktop (app/desktop.css) so it is never shown twice.
//
// ROBUST layout (v471.1): the glass window + the top rail are just two fixed,
// viewport-centred boxes drawn BEHIND the frame + panels. The panels keep the
// proven v466/v470 fixed positioning (left: 50% ± half-frame ± gap), merely
// shifted DOWN by the rail height and stripped of their own glass (the window
// provides it). No flex "centre slot", no display:contents alignment — the
// frame and panels share the exact same top+height so they always line up.
//
// Fully driven by DiscoverPage's existing `items` + active index — NO edits to
// the load-bearing InstagramHotelFeed, no new store, no data/dedup touch.
// Everything is `position: fixed` and hidden below the wide breakpoints via
// app/desktop.css (window ≥1440px home; right panel alone 1200–1439px; nothing
// below 1024px). Mobile renders + fetches nothing.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { snap100 } from "@/lib/price-snap";
import {
  FlashDealStoryRail,
  FlashDealStoryViewer,
  useFlashDealStories,
  type FlashDealStory,
} from "@/components/discover/FlashDealStories";

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

export default function DesktopReelPanels({
  items,
  activeIndex,
  showRail,
}: {
  items: Item[];
  activeIndex: number;
  /** v471 — true on the home route (`/`). Draws the unified window + the
      full-width Flash Deals rail across the top. On /discover (false) the
      panels stay as the v470 fixed frosted companions (no window). */
  showRail?: boolean;
}) {
  const router = useRouter();

  // Render nothing during SSR / first paint to avoid a hydration flash; the
  // CSS media queries do the real desktop gating.
  const [ready, setReady] = useState(false);
  useEffect(() => { setReady(true); }, []);

  // v475.1 — track up-next thumbnails whose <img> actually failed to load so
  // we swap to a clean initial-letter card (not a dull empty gradient box).
  const [brokenThumb, setBrokenThumb] = useState<Record<string, boolean>>({});

  // v471 — the current city (drives the flash-deal rail, same source the
  // feed's fallback uses). Kept in sync with the globe picker's event.
  const [city, setCity] = useState<string>("");
  useEffect(() => {
    const read = () => { try { setCity(localStorage.getItem("sb_city") || ""); } catch {} };
    read();
    if (typeof window !== "undefined") {
      window.addEventListener("sb:city-change", read);
      return () => window.removeEventListener("sb:city-change", read);
    }
  }, []);

  // v471 — the unified window (with its full-width rail) is a ≥1440px feature.
  // Only fetch flash deals when actually on a wide desktop + the home route, so
  // mobile / narrow viewports make ZERO extra network calls.
  const [wide, setWide] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(min-width: 1440px)");
    const apply = () => setWide(mq.matches);
    apply();
    mq.addEventListener?.("change", apply);
    return () => mq.removeEventListener?.("change", apply);
  }, []);

  // Flash deals for the rail (home only, wide only). Hook is always called.
  const { deals: flashDeals } = useFlashDealStories(city || "all", wide && !!showRail);
  const [flashIdx, setFlashIdx] = useState<number | null>(null);
  const railOn = !!showRail && wide && flashDeals.length > 0;

  // v471 — body flags that switch app/desktop.css into window mode.
  //   • reel-with-rail — home route → draw the glass window (≥1440px).
  //   • reel-has-rail  — home + wide + deals exist → reserve the rail row +
  //     push the frame/panels down. Without deals the window has no rail and
  //     the frame keeps its full height (graceful, no empty top band).
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.body.classList.toggle("reel-with-rail", !!showRail);
    return () => { document.body.classList.remove("reel-with-rail"); };
  }, [showRail]);
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.body.classList.toggle("reel-has-rail", railOn);
    return () => { document.body.classList.remove("reel-has-rail"); };
  }, [railOn]);

  const onBookDeal = useCallback((d: FlashDealStory) => {
    const url =
      `/hotels/${d.hotelId}` +
      `?dealId=${encodeURIComponent(d.id)}` +
      `&dealPrice=${encodeURIComponent(String(snap100(d.dealPrice)))}` +
      `&roomId=${encodeURIComponent(d.roomId)}` +
      `&discount=${encodeURIComponent(String(d.discount))}` +
      `&directBook=true`;
    setFlashIdx(null);
    router.push(url);
  }, [router]);

  // v467 (Phase 3) — desktop keyboard navigation between reels: ↑/↓ + PageUp/
  // Down scroll the feed's snap container by one frame, mirroring mobile swipe.
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

  const amenities: string[] = (Array.isArray(h.amenities) ? h.amenities : [])
    .filter((a: any) => typeof a === "string" && a.trim())
    .slice(0, 5);

  const upNext: Item[] = [];
  for (let k = 1; k <= 8 && items[idx + k]; k++) upNext.push(items[idx + k]);

  return (
    <>
      {/* v471 — the glass window shell (drawn BEHIND the frame + panels).
          Home + ≥1440px only, via app/desktop.css. */}
      <div className="reel-window" aria-hidden />

      {/* Full-width Flash Deals rail across the top of the window (home + wide +
          deals only). A separate fixed box; its width matches the window. */}
      {railOn && (
        <div className="reel-stage-rail">
          <FlashDealStoryRail deals={flashDeals} onOpen={(i) => setFlashIdx(i)} />
        </div>
      )}

      {/* LEFT — up-next queue (fixed, flanking the frame; ≥1440px) */}
      <aside className="reel-side reel-side-left" aria-label="Up next">
        <div className="reel-side-kicker">Up next</div>
        {upNext.length > 0 ? (
          <div className="reel-queue">
            {upNext.map((it, i) => {
              const uh = it.hotel || {};
              const up = priceOf(uh);
              const uplace = [uh.city, uh.state].filter(Boolean).join(", ");
              const targetIdx = idx + 1 + i;
              return (
                <button
                  key={targetIdx}
                  type="button"
                  className="reel-queue-item"
                  onClick={() => scrollFeedToIndex(targetIdx)}
                  title={`Play ${uh.name || "this reel"}`}
                >
                  <span className="reel-queue-thumb" aria-hidden>
                    {imgOf(uh) && !brokenThumb[imgOf(uh)] ? (
                      <img
                        src={imgOf(uh)}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        onError={() => setBrokenThumb((b) => ({ ...b, [imgOf(uh)]: true }))}
                      />
                    ) : (
                      <span className="reel-queue-thumb-fallback">{(uh.name || "S").slice(0, 1).toUpperCase()}</span>
                    )}
                  </span>
                  <span className="reel-queue-info">
                    <span className="reel-queue-name">{uh.name || "Stay"}</span>
                    <span className="reel-queue-sub">{uplace || uh.city || ""}</span>
                  </span>
                  {up > 0 && (
                    <span className="reel-queue-price"><b className="tabular-nums">{inr(up)}</b><em>/n</em></span>
                  )}
                </button>
              );
            })}
          </div>
        ) : (
          <div className="reel-side-empty">You&apos;re all caught up ✨</div>
        )}
      </aside>

      {/* RIGHT — now-playing: a cover image (fills the top) + booking context.
          Cover falls back to a gradient + initial when the reel has no image. */}
      <aside className="reel-side reel-side-right" aria-label="Current stay">
        <div
          className="reel-np-cover"
          style={imgOf(h)
            ? { backgroundImage: `url("${imgOf(h)}"), linear-gradient(135deg, #2a2018, #17110b)` }
            : undefined}
          aria-hidden
        >
          {!imgOf(h) && <span className="reel-np-cover-fallback">{(h.name || "S").slice(0, 1).toUpperCase()}</span>}
          <span className="reel-np-cover-kicker">Now playing</span>
          <span className="reel-np-cover-shade" />
        </div>
        <div className="reel-side-body">
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
          {amenities.length > 0 && (
            <div className="reel-side-amenities">
              {amenities.map((a, i) => (
                <span key={i} className="reel-side-amenity">{a}</span>
              ))}
            </div>
          )}
          {h.description && <p className="reel-side-desc">{String(h.description).slice(0, 220)}</p>}
          {hotelId && (
            <div className="reel-side-cta">
              <Link href={`/hotels/${hotelId}`} className="reel-side-btn primary">View &amp; Book</Link>
              <Link href={`/hotels/${hotelId}#negotiate`} className="reel-side-btn ghost">Make an offer</Link>
            </div>
          )}
          <div className="reel-side-hint">↑ ↓ to browse reels</div>
        </div>
      </aside>

      {/* Flash-deal fullscreen viewer (home rail taps). Separate instance from
          the in-frame one (hidden on desktop) — only this one triggers here. */}
      {showRail && (
        <FlashDealStoryViewer
          open={flashIdx !== null}
          deals={flashDeals}
          startIdx={flashIdx ?? 0}
          onClose={() => setFlashIdx(null)}
          onBook={onBookDeal}
        />
      )}
    </>
  );
}
