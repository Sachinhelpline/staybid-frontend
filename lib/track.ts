// Lightweight client-side event tracker for the Discovery mode.
//
// Design:
//   • Append events to an in-memory buffer.
//   • Flush every 5s OR when buffer hits 10, whichever first.
//   • Use navigator.sendBeacon on visibilitychange=hidden so analytics never
//     miss the last few events before the user backgrounds the tab.
//   • Mirrors engagement signals into localStorage under `sb_disco_signals`
//     so the /api/discover/feed ranker can use them on the next request
//     without needing a server-side warehouse.
//
// This module is client-only. Safe to import from "use client" components.

type EventType =
  | "app_open" | "hotel_view" | "swipe_next" | "swipe_prev"
  | "swipe_detail" | "dwell" | "click_book" | "click_bid"
  | "booking_success" | "mode_toggle" | "exit_discovery";

type Evt = {
  type: EventType;
  hotelId?: string;
  roomId?: string;
  meta?: Record<string, any>;
  ts?: string;
};

type DiscoSignals = {
  viewedIds: string[];
  likedIds: string[];
  skippedIds: string[];
  cities: string[];
  priceBand?: [number, number];
  preferAmenities: string[];
};

const BUF_KEY = "sb_track_buf_v1";
const SIG_KEY = "sb_disco_signals";
const SESSION_KEY = "sb_session_id";

function sessionId(): string {
  if (typeof window === "undefined") return "server";
  let id = sessionStorage.getItem(SESSION_KEY);
  if (!id) {
    id = `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    sessionStorage.setItem(SESSION_KEY, id);
  }
  return id;
}

function loadBuf(): any[] {
  if (typeof window === "undefined") return [];
  try { return JSON.parse(localStorage.getItem(BUF_KEY) || "[]"); } catch { return []; }
}
function saveBuf(arr: any[]) {
  try { localStorage.setItem(BUF_KEY, JSON.stringify(arr.slice(-50))); } catch {}
}

function token(): string | null {
  return typeof window !== "undefined" ? localStorage.getItem("sb_token") : null;
}

async function flush(useBeacon = false) {
  if (typeof window === "undefined") return;
  const buf = loadBuf();
  if (buf.length === 0) return;
  const body = JSON.stringify({ events: buf });
  const url = "/api/events/track";
  saveBuf([]);
  try {
    if (useBeacon && "sendBeacon" in navigator) {
      navigator.sendBeacon(url, new Blob([body], { type: "application/json" }));
    } else {
      const tok = token();
      await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(tok ? { Authorization: `Bearer ${tok}` } : {}),
        },
        body,
        keepalive: true,
      });
    }
  } catch {
    // Put them back; try again next flush
    const cur = loadBuf();
    saveBuf([...buf, ...cur]);
  }
}

let flushTimer: any = null;
function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => { flushTimer = null; flush(); }, 5000);
}

/** Record an event. Updates session signals so ranking uses it next feed. */
export function track(type: EventType, data: Partial<Evt> = {}) {
  if (typeof window === "undefined") return;
  const evt = {
    type,
    sessionId: sessionId(),
    hotelId: data.hotelId,
    roomId: data.roomId,
    meta: data.meta,
    ts: new Date().toISOString(),
  };
  const buf = loadBuf();
  buf.push(evt);
  saveBuf(buf);

  updateSignalsFromEvent(type, data);

  if (buf.length >= 10) flush();
  else scheduleFlush();
}

function loadSignals(): DiscoSignals {
  if (typeof window === "undefined") return { viewedIds: [], likedIds: [], skippedIds: [], cities: [], preferAmenities: [] };
  try {
    const raw = JSON.parse(localStorage.getItem(SIG_KEY) || "{}");
    return {
      viewedIds:  raw.viewedIds  || [],
      likedIds:   raw.likedIds   || [],
      skippedIds: raw.skippedIds || [],
      cities:     raw.cities     || [],
      priceBand:  raw.priceBand,
      preferAmenities: raw.preferAmenities || [],
    };
  } catch { return { viewedIds: [], likedIds: [], skippedIds: [], cities: [], preferAmenities: [] }; }
}
function saveSignals(s: DiscoSignals) {
  try { localStorage.setItem(SIG_KEY, JSON.stringify(s)); } catch {}
}

/** Public — read current signals (used by /app/discover when requesting feed). */
export function getSignals(): DiscoSignals { return loadSignals(); }

/** Explicit mutators so callers can attach rich context (city, price). */
export function markViewed(hotelId: string, city?: string, minPrice?: number, amenities?: string[]) {
  const s = loadSignals();
  if (!s.viewedIds.includes(hotelId)) s.viewedIds = [hotelId, ...s.viewedIds].slice(0, 200);
  if (city && !s.cities.includes(city)) s.cities = [city, ...s.cities].slice(0, 10);
  if (minPrice) s.priceBand = s.priceBand ? [Math.min(s.priceBand[0], minPrice * 0.7), Math.max(s.priceBand[1], minPrice * 1.4)] : [minPrice * 0.7, minPrice * 1.4];
  (amenities || []).forEach(a => { if (!s.preferAmenities.includes(a)) s.preferAmenities.push(a); });
  s.preferAmenities = s.preferAmenities.slice(0, 20);
  saveSignals(s);
}

export function markLiked(hotelId: string)   { const s = loadSignals(); if (!s.likedIds.includes(hotelId))   s.likedIds   = [hotelId, ...s.likedIds].slice(0, 100);   saveSignals(s); }
export function markSkipped(hotelId: string) { const s = loadSignals(); if (!s.skippedIds.includes(hotelId)) s.skippedIds = [hotelId, ...s.skippedIds].slice(0, 100); saveSignals(s); }

function updateSignalsFromEvent(type: EventType, data: Partial<Evt>) {
  if (!data.hotelId) return;
  if (type === "hotel_view") markViewed(data.hotelId, data.meta?.city, data.meta?.minPrice, data.meta?.amenities);
  else if (type === "click_bid" || type === "click_book" || type === "booking_success") markLiked(data.hotelId);
  else if (type === "swipe_next" && (data.meta?.dwellMs ?? 9999) < 1500) markSkipped(data.hotelId);
}

/** Wire global flush handlers (call once from a layout component). */
export function initTracking() {
  if (typeof window === "undefined") return;
  window.addEventListener("visibilitychange", () => { if (document.hidden) flush(true); });
  window.addEventListener("beforeunload", () => flush(true));
}
