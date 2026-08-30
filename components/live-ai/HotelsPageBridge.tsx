"use client";
// ─────────────────────────────────────────────────────────────────────────
// StayBid Live AI — LIVE-AI-01A — /hotels page bridge (thin adapter).
//
// A THIN adapter over the PURE production builder buildHotelsSnapshot (in
// lib/live-ai/contracts.ts) — the same function the tests exercise, so the
// authority-relevant snapshot logic is genuinely covered (REV-12). It:
//   • gathers the page's authoritative props (including the request-bound
//     resolved receipt: resolvedCity/resolvedQuery/resolvedStatus — REV-02) and
//     the selectable amenity vocabulary amenityOpts (REV-08);
//   • hands the runtime a getSnapshot() that returns the bounded, synchronously
//     fingerprinted snapshot (REV-05/06/07/11);
//   • applies runtime-RESOLVED UI_LOCAL commands over the page's OWN setters.
//
// It never duplicates displayHotels or adds AI result UI. Renders NOTHING.
// No-op when the feature is disabled.
// ─────────────────────────────────────────────────────────────────────────
import {
  buildHotelsSnapshot,
  isValidHotelId,
  PARKING_NEEDLES,
  type HotelsListContext,
  type HotelSort,
} from "@/lib/live-ai/contracts";
import type { ResolvedCommand } from "@/lib/live-ai/runtime";
import { useRef } from "react";
import { useLiveAiPageRegistration, useLiveAi } from "./LiveAiProvider";

interface RouterShim {
  push: (url: string) => void;
}

export interface HotelsPageBridgeProps {
  displayHotels: any[];
  city: string;
  query: string;
  checkIn: string;
  checkOut: string;
  guests: number;
  maxPrice: number | null;
  sort: HotelSort;
  stars: number[];
  /** currently-applied amenity filters (page amenitySel). */
  amenities: string[];
  /** selectable amenity vocabulary (page amenityOpts) — REV-08. */
  amenityOpts: string[];
  loading: boolean;
  error: string;
  /** destination the CURRENT displayHotels correspond to (page resolved state). */
  resolvedCity: string;
  resolvedQuery: string;
  /** status of the winning request that produced displayHotels. */
  resolvedStatus: "ready" | "error";
  searchUrlParams: string;
  setCity: (v: string) => void;
  setSearch: (v: string) => void;
  setPriceMax: (v: number | null) => void;
  setSortBy: (v: HotelSort) => void;
  setSelectedStars: (v: Set<number>) => void;
  setAmenitySel: (updater: (prev: Set<string>) => Set<string>) => void;
  router: RouterShim;
}

function titleCaseCity(canonical: string): string {
  return canonical.replace(/\b([a-z])/g, (m) => m.toUpperCase());
}

export default function HotelsPageBridge(props: HotelsPageBridgeProps) {
  const { enabled } = useLiveAi();

  // Latest props via ref so getSnapshot/execute always read fresh values.
  const p = useRef(props);
  p.current = props;

  const getSnapshot = (): HotelsListContext => {
    const cur = p.current;
    return buildHotelsSnapshot({
      displayHotels: cur.displayHotels,
      city: cur.city,
      query: cur.query,
      checkIn: cur.checkIn,
      checkOut: cur.checkOut,
      guests: cur.guests,
      maxPrice: cur.maxPrice,
      sort: cur.sort,
      stars: cur.stars,
      appliedAmenities: cur.amenities,
      amenityOpts: cur.amenityOpts,
      loading: cur.loading,
      error: cur.error,
      resolvedCity: cur.resolvedCity,
      resolvedQuery: cur.resolvedQuery,
      resolvedStatus: cur.resolvedStatus,
      role: "anonymous",
    });
  };

  const execute = (cmd: ResolvedCommand): void => {
    const cur = p.current;
    if (cmd.kind === "apply_refinement") {
      if ("destination" in cmd) {
        const dest = cmd.destination;
        if (dest == null || dest === "") {
          cur.setCity("");
          try { window.localStorage.removeItem("sb_city"); } catch {}
        } else {
          const display = titleCaseCity(dest);
          cur.setCity(display);
          try { window.localStorage.setItem("sb_city", display); } catch {}
        }
      }
      if ("query" in cmd) cur.setSearch(cmd.query ?? "");
      if ("maxPrice" in cmd) cur.setPriceMax(cmd.maxPrice ?? null);
      if ("sort" in cmd && cmd.sort) cur.setSortBy(cmd.sort);
      if ("stars" in cmd && cmd.stars) cur.setSelectedStars(new Set(cmd.stars));
      if ("parking" in cmd && cmd.parking !== undefined) {
        const label = cmd.parkingAmenity || null;
        cur.setAmenitySel((prev) => {
          const next = new Set(prev);
          Array.from(next).forEach((a) => {
            if (PARKING_NEEDLES.some((n) => String(a).toLowerCase().includes(n))) next.delete(a);
          });
          if (cmd.parking && label) next.add(label);
          return next;
        });
      }
      return;
    }
    if (cmd.kind === "open_hotel") {
      if (!isValidHotelId(cmd.hotelId)) return;
      const suffix = cur.searchUrlParams || "";
      cur.router.push(`/hotels/${encodeURIComponent(cmd.hotelId)}${suffix}`);
      return;
    }
    // show_section is a hotel-detail command; never dispatched here.
  };

  useLiveAiPageRegistration("hotels", "/hotels", getSnapshot, execute);

  if (!enabled) return null;
  return null;
}
