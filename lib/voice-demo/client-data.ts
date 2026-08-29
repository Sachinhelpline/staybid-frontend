// ─────────────────────────────────────────────────────────────────────────
// StayBid AI — PRESENTATION-DEMO-01 — client read-only data layer.
//
// The ONLY network the demo performs: two GETs to the EXISTING read-only StayBid
// hotel routes, then SB-01 normalization (data minimization). No writes, no auth
// token, no arbitrary URL — the paths are fixed and the inputs are gated by the
// SB-01 validators (canonicalCity / isValidHotelId) before they reach the URL.
// ─────────────────────────────────────────────────────────────────────────
import { canonicalCity, isValidHotelId, MAX_SEARCH_RESULTS } from "@/lib/voice/contracts";
import { normalizeHotelList, normalizeHotelDetails } from "@/lib/voice/normalize";
import type { DemoDeps } from "./controller";

export const demoDeps: DemoDeps = {
  async searchHotels(city, query) {
    const params = new URLSearchParams();
    // gate the city through the SB-01 validator; an invalid city is dropped.
    const c = city == null ? null : canonicalCity(city);
    if (c) params.set("city", c);
    const q = typeof query === "string" ? query.slice(0, 60) : "";
    if (q) params.set("q", q);
    try {
      const r = await fetch(`/api/hotels?${params.toString()}`, { cache: "no-store" });
      if (!r.ok) return [];
      const j = await r.json();
      return normalizeHotelList(j?.hotels, MAX_SEARCH_RESULTS);
    } catch {
      return [];
    }
  },
  async getHotelDetails(id) {
    if (!isValidHotelId(id)) return null;
    try {
      const r = await fetch(`/api/hotels/${encodeURIComponent(id)}`, { cache: "no-store" });
      if (!r.ok) return null;
      const j = await r.json();
      return normalizeHotelDetails(j?.hotel);
    } catch {
      return null;
    }
  },
};
