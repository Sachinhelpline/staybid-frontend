// ─────────────────────────────────────────────────────────────────────────────
// VIEWER GEO (client-only, v580) — where is the person browsing from?
//
// Feeds lib/browse/affinity.ts with a viewer point. Three rules keep it
// polite + unbreakable:
//   1. NEVER prompts on its own. primeViewerGeo() only reads the cached point
//      or — when the browser says permission is ALREADY granted — refreshes it
//      silently. The permission PROMPT fires only from requestViewerGeo(),
//      which callers wire to an explicit user gesture (the 📍 chip).
//   2. Cached in localStorage (sb_geo_v1, 7-day TTL) so one grant serves every
//      surface without re-firing the Geolocation API each visit. The logout
//      allow-list wipe clears it — a shared device never leaks a location.
//   3. Fail-open everywhere: any error/denial → null, and the affinity engine
//      falls back to its DEFAULT_ORIGIN (Delhi Core).
//
// Emits "sb:geo-change" on every fresh fix so mounted surfaces re-rank live.
// ─────────────────────────────────────────────────────────────────────────────

import type { ViewerPoint } from "@/lib/browse/affinity";

const KEY = "sb_geo_v1";
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Cached viewer point, or null (missing / stale / SSR). Pure read. */
export function readViewerGeo(): ViewerPoint | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "null");
    if (!raw || !Number.isFinite(raw.lat) || !Number.isFinite(raw.lng)) return null;
    if (!Number.isFinite(raw.ts) || Date.now() - raw.ts > TTL_MS) return null;
    return { lat: raw.lat, lng: raw.lng };
  } catch { return null; }
}

function cache(pt: ViewerPoint) {
  try { localStorage.setItem(KEY, JSON.stringify({ ...pt, ts: Date.now() })); } catch {}
  try { window.dispatchEvent(new Event("sb:geo-change")); } catch {}
}

function getPosition(timeoutMs: number): Promise<ViewerPoint | null> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return resolve(null);
    let done = false;
    const finish = (v: ViewerPoint | null) => { if (!done) { done = true; resolve(v); } };
    try {
      navigator.geolocation.getCurrentPosition(
        (pos) => finish({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => finish(null),
        { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 10 * 60 * 1000 },
      );
    } catch { finish(null); }
    // belt-and-braces: some WebViews never fire either callback
    setTimeout(() => finish(null), timeoutMs + 1000);
  });
}

/**
 * Silent path — cached point, else a refresh ONLY when permission is already
 * granted (Permissions API). Never triggers the browser prompt.
 */
export async function primeViewerGeo(): Promise<ViewerPoint | null> {
  const cached = readViewerGeo();
  if (cached) return cached;
  if (typeof navigator === "undefined") return null;
  try {
    const perms: any = (navigator as any).permissions;
    if (!perms?.query) return null;
    const st = await perms.query({ name: "geolocation" as PermissionName });
    if (st?.state !== "granted") return null;
    const pt = await getPosition(6000);
    if (pt) cache(pt);
    return pt;
  } catch { return null; }
}

/**
 * Explicit path — call ONLY from a user gesture (📍 chip tap). May show the
 * browser permission prompt. Resolves null on deny/timeout.
 */
export async function requestViewerGeo(): Promise<ViewerPoint | null> {
  const pt = await getPosition(10_000);
  if (pt) cache(pt);
  return pt;
}
