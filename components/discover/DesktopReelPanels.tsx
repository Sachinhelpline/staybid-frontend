"use client";
// v466 → v471 — Desktop reel side panels, now wrapped in a single unified
// "desktop app window" on wide screens.
//
//   • v466: two frosted panels flanking the centred phone frame
//     (RIGHT "Now playing", LEFT "Up next").
//   • v471 (this): on ≥1440px the two panels + a full-width **Flash Deals
//     stories rail** are merged into ONE glass stage — a real desktop app
//     window. The rail spans all three columns at the top; the portrait reel
//     frame floats in the centre slot BELOW the rail (same size, still centred).
//     The in-frame flash rail is hidden on desktop (app/desktop.css) so it is
//     never shown twice.
//
// Fully driven by DiscoverPage's existing `items` + active index — NO edits to
// the load-bearing InstagramHotelFeed, no new store, no data/dedup touch. The
// stage/panels are `position: fixed` and ENTIRELY hidden below the wide
// breakpoints via app/desktop.css (unified window ≥1440px; right panel alone
// 1200–1439px; nothing below 1024px). CTAs are plain deep-links into the
// existing hotel page. The rail reuses the SAME FlashDealStoryRail /
// FlashDealStoryViewer / useFlashDealStories the mobile feed uses.

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
  /** v471 — true on the home route (`/`). Renders the full-width Flash Deals
      rail across the top of the unified window and flips `body.reel-with-rail`
      so app/desktop.css lays out the merged stage. On /discover (false) the
      panels stay as the v470 fixed frosted companions (no window). */
  showRail?: boolean;
}) {
  const router = useRouter();

  // Render nothing during SSR / first paint to avoid a hydration flash; the
  // CSS media queries do the real desktop gating.
  const [ready, setReady] = useState(false);
  useEffect(() => { setReady(true); }, []);

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

  // v471 — toggle the body flag that switches app/desktop.css into unified-
  // window mode. Only on the home route (where the rail lives). Cleaned up on
  // unmount / route change so /discover never inherits the window layout.
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.body.classList.toggle("reel-with-rail", !!showRail);
    return () => { document.body.classList.remove("reel-with-rail"); };
  }, [showRail]);

  // Flash deals for the rail (home only). Hook is always called (rules of
  // hooks); the rail element only renders when showRail is true + deals exist.
  const { deals: flashDeals } = useFlashDealStories(city || "all", wide && !!showRail);
  const [flashIdx, setFlashIdx] = useState<number | null>(null);

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
  for (let k = 1; k <= 6 && items[idx + k]; k++) upNext.push(items[idx + k]);

  return (
    <>
      {/* v471 — the unified stage. On ≥1440px + home it becomes a glass "desktop
          app window" (rail on top spanning all columns, left/right panels as
          static sidebars, a transparent centre slot the portrait frame floats
          into). Below 1440 / on /discover, .reel-stage + .reel-stage-cols are
          `display: contents` so the panels fall back to their v470 fixed
          positioning and the rail row is hidden. */}
      <div className="reel-stage" aria-hidden={false}>
        {showRail && flashDeals.length > 0 && (
          <div className="reel-stage-rail">
            <FlashDealStoryRail
              deals={flashDeals}
              onOpen={(i) => setFlashIdx(i)}
            />
          </div>
        )}

        <div className="reel-stage-cols">
          {/* LEFT — up-next queue */}
          <aside className="reel-side reel-side-left" aria-label="Up next">
            <div className="reel-side-kicker">Up next</div>
            {upNext.length > 0 ? (
              <div className="reel-queue">
                {upNext.map((it, i) => {
                  const uh = it.hotel || {};
                  const up = priceOf(uh);
                  const targetIdx = idx + 1 + i;
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
            ) : (
              <div className="reel-side-empty">You&apos;re all caught up ✨</div>
            )}
          </aside>

          {/* CENTRE — transparent slot the portrait reel frame floats into (the
              frame is .reel-page-root, a separate fixed element positioned to
              sit exactly here by app/desktop.css). */}
          <div className="reel-stage-center" aria-hidden />

          {/* RIGHT — now-playing context + booking actions. No cover image:
              the reel itself is the visual in the centre. Clean info card. */}
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
        </div>
      </div>

      {/* Flash-deal fullscreen viewer (home rail taps). Separate instance from
          the in-frame one (which is hidden on desktop) — only this one can be
          triggered on the desktop window. */}
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
