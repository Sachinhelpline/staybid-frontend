// ─────────────────────────────────────────────────────────────────────────
// StayBid Voice AI — VOICE-AI-SB-01 — STATIC capability registry.
//
// This is the allowlist. A capability can ONLY reach an existing StayBid read
// API through a descriptor declared here. The model / caller NEVER supplies:
//   • an HTTP method  (every descriptor is hard-coded GET)
//   • an API base URL (paths are same-origin, relative, built from validated
//     inputs only — no host, no scheme, no "//")
//   • a raw path      (the builder emits a fixed path template)
//
// Explicitly ABSENT (and asserted absent by tests/voice/voice-ai.test.js):
//   • /api/availability, /api/availability/units, /api/pricing/spine
//   • any bid / booking / payment / wallet / mutation path
//
// Pure module: no I/O, no React, no next/*, no @/lib imports.
// ─────────────────────────────────────────────────────────────────────────
import {
  type CapabilityName,
  canonicalCity,
  boundedQuery,
  isValidHotelId,
} from "./contracts";

export interface BuiltRequest {
  /** Same-origin, relative path beginning with "/api/". Never absolute. */
  path: string;
}

export interface CapabilityDescriptor {
  name: CapabilityName;
  /** HARD-CODED. There is no setter and no caller override. */
  readonly method: "GET";
  /** Does this capability touch the network at all? compareHotels does NOT. */
  readonly network: boolean;
  /**
   * Build the same-origin request path from ALREADY-VALIDATED, canonical input.
   * Returns null if the (defensive re-)validation fails — fail closed.
   * compareHotels has no builder (network === false).
   */
  build?: (input: Record<string, unknown>) => BuiltRequest | null;
}

function enc(v: string): string {
  return encodeURIComponent(v);
}

// The four — and ONLY four — active read capabilities.
const REGISTRY: Record<CapabilityName, CapabilityDescriptor> = {
  searchHotels: {
    name: "searchHotels",
    method: "GET",
    network: true,
    build: (input) => {
      const city = input.city == null ? null : canonicalCity(input.city);
      const q = input.q == null ? null : boundedQuery(input.q);
      if (input.city != null && city === null) return null;
      if (input.q != null && q === null) return null;
      const params: string[] = [];
      if (city) params.push(`city=${enc(city)}`);
      if (q) params.push(`q=${enc(q)}`);
      return { path: `/api/hotels${params.length ? `?${params.join("&")}` : ""}` };
    },
  },
  getHotelDetails: {
    name: "getHotelDetails",
    method: "GET",
    network: true,
    build: (input) => {
      // The id MUST pass format validation here AND be allowlisted by the
      // policy gate before this builder is ever called (defense in depth).
      if (!isValidHotelId(input.id)) return null;
      return { path: `/api/hotels/${enc(input.id)}` };
    },
  },
  getFlashDeals: {
    name: "getFlashDeals",
    method: "GET",
    network: true,
    build: (input) => {
      const city = input.city == null ? null : canonicalCity(input.city);
      if (input.city != null && city === null) return null;
      // `viewed` is a static empty seed — Voice never forwards a raw list.
      const params = [city ? `city=${enc(city)}` : "", "viewed="].filter(Boolean);
      return { path: `/api/flash/near?${params.join("&")}` };
    },
  },
  compareHotels: {
    name: "compareHotels",
    method: "GET",
    network: false, // PURE local composition — makes NO fetch.
  },
};

// REV-04: freeze EACH descriptor (not just the outer registry) so the
// method/network/build security properties cannot be replaced at runtime through
// the exported registry or getDescriptor. Object.freeze on every descriptor makes
// its own properties non-writable/non-configurable; the outer object is frozen too.
for (const key of Object.keys(REGISTRY) as CapabilityName[]) {
  Object.freeze(REGISTRY[key]);
}

export const CAPABILITY_REGISTRY: Readonly<Record<CapabilityName, Readonly<CapabilityDescriptor>>> =
  Object.freeze(REGISTRY);

export function isAllowedCapability(name: unknown): name is CapabilityName {
  return typeof name === "string" && Object.prototype.hasOwnProperty.call(REGISTRY, name);
}

export function getDescriptor(name: CapabilityName): Readonly<CapabilityDescriptor> {
  return REGISTRY[name];
}
