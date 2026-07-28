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
import HotelScoreBadge from "@/components/hotel/HotelScoreBadge";

type Item = { hotel: any };

// v491 — deterministic per-hotel "views" for the now-playing panel (mirrors the
// reel's own pseudo social-proof stat; the center overlay is hidden on the
// desktop-home window, so this is now the single place that number is shown).
function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
function pseudoViews(id: string): number {
  return 14000 + (hashStr(`${id || "x"}::views`) % (580000 - 14000));
}
function fmtCount(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "K";
  return String(n);
}

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

// v492 — scroll the reel feed one frame up (-1 = previous) or down (+1 = next),
// used by the visible ↑/↓ "browse reels" control in the now-playing panel.
function scrollFeedByDir(dir: number) {
  const feed = document.querySelector<HTMLElement>(".ig-feed");
  if (!feed) return;
  feed.scrollBy({ top: dir * feed.clientHeight, behavior: "smooth" });
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

  // v491 — now-playing cover: track broken cover images so a video reel with no
  // (or a broken) poster shows the cream initial-letter fallback, never a black box.
  const [coverBroken, setCoverBroken] = useState<Record<string, boolean>>({});

  // v491 — scroll-aware flash-rail arrows: show ‹ only when scrolled right, › only
  // when there is more to the right (both when scrollable, mirroring the drag).
  const [railNav, setRailNav] = useState<{ left: boolean; right: boolean }>({ left: false, right: true });

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

  // v491 — watch the flash-rail scroll position so both ‹ › arrows reflect what
  // is actually draggable (left appears once scrolled; right hides at the end).
  useEffect(() => {
    if (!railOn) return;
    let s: HTMLElement | null = null;
    const update = () => {
      if (!s) return;
      const left = s.scrollLeft > 4;
      const right = s.scrollLeft < s.scrollWidth - s.clientWidth - 4;
      setRailNav((p) => (p.left === left && p.right === right ? p : { left, right }));
    };
    // The scroll container is rendered by FlashDealStoryRail inside .reel-stage-rail.
    const attach = () => {
      s = document.querySelector<HTMLElement>(".reel-stage-rail .fdeal-rail-scroll");
      if (!s) return false;
      update();
      s.addEventListener("scroll", update, { passive: true });
      return true;
    };
    let raf = 0;
    if (!attach()) raf = requestAnimationFrame(() => attach());
    window.addEventListener("resize", update);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      s?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [railOn, flashDeals.length]);

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
          deals only). A separate fixed box; its width matches the window.
          The ‹ › buttons scroll the avatar strip so it's obvious there are more
          deals than the ones on screen (a horizontal drag/scroll list). */}
      {railOn && (
        <div className="reel-stage-rail">
          <FlashDealStoryRail deals={flashDeals} onOpen={(i) => setFlashIdx(i)} />
          <button
            type="button"
            className="reel-rail-nav reel-rail-nav-left"
            aria-label="Previous flash deals"
            style={{ opacity: railNav.left ? 1 : 0.32, pointerEvents: railNav.left ? "auto" : "none" }}
            onClick={() => {
              const s = document.querySelector<HTMLElement>(".reel-stage-rail .fdeal-rail-scroll");
              s?.scrollBy({ left: -320, behavior: "smooth" });
            }}
          >‹</button>
          <button
            type="button"
            className="reel-rail-nav reel-rail-nav-right"
            aria-label="More flash deals"
            style={{ opacity: railNav.right ? 1 : 0.32, pointerEvents: railNav.right ? "auto" : "none" }}
            onClick={() => {
              const s = document.querySelector<HTMLElement>(".reel-stage-rail .fdeal-rail-scroll");
              s?.scrollBy({ left: 320, behavior: "smooth" });
            }}
          >›</button>
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
        <div className="reel-np-cover" aria-hidden>
          {imgOf(h) && !coverBroken[imgOf(h)] ? (
            <img
              className="reel-np-cover-img"
              src={imgOf(h)}
              alt=""
              loading="lazy"
              decoding="async"
              onError={() => setCoverBroken((b) => ({ ...b, [imgOf(h)]: true }))}
            />
          ) : (
            <span className="reel-np-cover-fallback">{(h.name || "S").slice(0, 1).toUpperCase()}</span>
          )}
          <span className="reel-np-cover-kicker">Now playing</span>
          <span className="reel-np-cover-shade" />
        </div>
        <div className="reel-side-body">
          <h3 className="reel-side-title">{h.name || "Stay"}</h3>
          <div className="reel-side-meta">
            {rating > 0 && <span className="reel-side-stars">{"★".repeat(Math.min(5, rating))}</span>}
            {place && <span className="reel-side-place">{place}</span>}
          </div>
          {/* v491 — rank + views moved here from the reel overlay (single source). */}
          <div className="reel-side-stat">
            {hotelId && <HotelScoreBadge hotelId={hotelId} variant="compact" />}
            <span className="reel-side-views">▶ {fmtCount(pseudoViews(hotelId || h.name || "x"))} views</span>
          </div>
          {/* v492 — visible, clickable "browse reels" control (the how-does-the-
              next-reel-come affordance, no longer buried at the panel bottom). */}
          <div className="reel-nav">
            <button type="button" className="reel-nav-btn" onClick={() => scrollFeedByDir(-1)} aria-label="Previous reel" title="Previous reel">↑</button>
            <span className="reel-nav-label">Browse reels</span>
            <button type="button" className="reel-nav-btn" onClick={() => scrollFeedByDir(1)} aria-label="Next reel" title="Next reel">↓</button>
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
