// Client-side helpers for booking-source attribution (v94).
//
// The flow:
//   1. Reel feed Book/Bid CTAs route to /hotels/[id]?src=creator&cid=...&via=...&vid=...
//   2. Hotel page parses those params on mount and calls setAttribution(hotelId, attr)
//      which writes localStorage so a refresh / Razorpay round-trip preserves it.
//   3. After every successful bid creation, the hotel page calls recordAttribution(bidId, ...)
//      which POSTs to /api/attribution/record.
//
// The localStorage key is scoped per hotel so multiple parallel tabs / hotels
// don't trample each other. A 24h TTL guards against stale state.

export type AttributionSource = "direct" | "creator" | "hotel-feed" | "flash" | "unknown";

export type Attribution = {
  source: AttributionSource;
  creatorUserId?: string;   // users.id of the uploading creator
  creatorHandle?: string;   // @username for display
  creatorType?: string;     // CREATOR | HOTEL | PUBLIC
  videoId?: string;         // social_posts.id of the reel
  capturedAt: number;       // ms epoch
};

const TTL_MS = 24 * 60 * 60 * 1000;
const KEY = (hotelId: string) => `sb_attribution_${hotelId}`;

export function setAttribution(hotelId: string, attr: Omit<Attribution, "capturedAt">) {
  if (typeof window === "undefined" || !hotelId) return;
  try {
    const row: Attribution = { ...attr, capturedAt: Date.now() };
    localStorage.setItem(KEY(hotelId), JSON.stringify(row));
  } catch {}
}

export function getAttribution(hotelId: string): Attribution | null {
  if (typeof window === "undefined" || !hotelId) return null;
  try {
    const raw = localStorage.getItem(KEY(hotelId));
    if (!raw) return null;
    const row: Attribution = JSON.parse(raw);
    if (Date.now() - (row.capturedAt || 0) > TTL_MS) {
      localStorage.removeItem(KEY(hotelId));
      return null;
    }
    return row;
  } catch { return null; }
}

export function clearAttribution(hotelId: string) {
  if (typeof window === "undefined") return;
  try { localStorage.removeItem(KEY(hotelId)); } catch {}
}

// Parse URL search params into an Attribution shape.
// Reads `src`, `cid`, `via`, `vid`, `ctype`.
export function attributionFromParams(sp: URLSearchParams | null): Attribution | null {
  if (!sp) return null;
  const src = (sp.get("src") || "").toLowerCase() as AttributionSource;
  if (!src) return null;
  return {
    source: ["direct", "creator", "hotel-feed", "flash", "unknown"].includes(src) ? src : "unknown",
    creatorUserId: sp.get("cid") || undefined,
    creatorHandle: sp.get("via") || undefined,
    creatorType: sp.get("ctype") || undefined,
    videoId: sp.get("vid") || undefined,
    capturedAt: Date.now(),
  };
}

// Mirrors a completed bid to the server. Fire-and-forget — booking already
// succeeded, this is just bookkeeping for the partner / creator / admin
// surfaces. Never throws.
export async function recordAttribution(payload: {
  bidId: string;
  hotelId: string;
  customerId?: string;
  paidTotal?: number;
  flow?: string;
  dealId?: string | null;
  attribution: Attribution | null;
}) {
  if (typeof window === "undefined") return;
  try {
    await fetch("/api/attribution/record", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bidId: payload.bidId,
        hotelId: payload.hotelId,
        customerId: payload.customerId || null,
        paidTotal: payload.paidTotal ?? null,
        flow: payload.flow || "bid",
        dealId: payload.dealId || null,
        source: payload.attribution?.source || "direct",
        creatorUserId: payload.attribution?.creatorUserId || null,
        creatorHandle: payload.attribution?.creatorHandle || null,
        creatorType: payload.attribution?.creatorType || null,
        videoId: payload.attribution?.videoId || null,
      }),
      keepalive: true,
    });
  } catch { /* silent — best-effort */ }
}

// Display helpers for badges / labels across panels.
export const SOURCE_LABEL: Record<AttributionSource, string> = {
  direct:        "Direct",
  creator:       "Creator",
  "hotel-feed":  "Hotel reel",
  flash:         "Flash deal",
  unknown:       "Unknown",
};

export const SOURCE_ICON: Record<AttributionSource, string> = {
  direct:        "🔗",
  creator:       "✨",
  "hotel-feed":  "🏨",
  flash:         "⚡",
  unknown:       "•",
};

export const SOURCE_COLOR: Record<AttributionSource, string> = {
  direct:        "#3D9CF5",
  creator:       "#A855F7",
  "hotel-feed":  "#D4AF37",
  flash:         "#FF4757",
  unknown:       "#8A8FA8",
};
