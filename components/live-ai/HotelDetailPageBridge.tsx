"use client";
// ─────────────────────────────────────────────────────────────────────────
// StayBid Live AI — LIVE-AI-01A — /hotels/[id] page bridge (thin adapter).
//
// A THIN adapter over the PURE production builder buildHotelDetailSnapshot (in
// lib/live-ai/contracts.ts) — the same function the tests exercise (REV-12). It
// exposes ONLY validated, data-minimized detail context: the runtime refuses
// facts + SHOW_HOTEL_SECTION unless loadState==="ready" AND route id == loaded
// id (REV-10), and no stale/other hotel is ever projected as current. The
// `routeId` is passed as the registration routeKey so a /hotels/id1 → /hotels/
// id2 transition re-registers the correct detail authority (REV-04).
//
// The only UI_LOCAL command it executes is SHOW_HOTEL_SECTION over the existing
// rooms|about tab. NO booking/bid/payment/write handler. Renders NOTHING.
// No-op when the feature is disabled.
// ─────────────────────────────────────────────────────────────────────────
import { useRef } from "react";
import { buildHotelDetailSnapshot, type HotelDetailContext } from "@/lib/live-ai/contracts";
import type { ResolvedCommand } from "@/lib/live-ai/runtime";
import { useLiveAiPageRegistration, useLiveAi } from "./LiveAiProvider";

export interface HotelDetailPageBridgeProps {
  routeId: string;
  hotel: any | null;
  loading: boolean;
  loadErr: boolean;
  /** current inline tab; only rooms|about are Live-AI sections. */
  tab: string;
  setTab: (t: string) => void;
}

export default function HotelDetailPageBridge(props: HotelDetailPageBridgeProps) {
  const { enabled } = useLiveAi();
  const p = useRef(props);
  p.current = props;

  const getSnapshot = (): HotelDetailContext =>
    buildHotelDetailSnapshot({
      routeId: p.current.routeId,
      hotel: p.current.hotel,
      loading: p.current.loading,
      loadErr: p.current.loadErr,
      tab: p.current.tab,
      role: "anonymous",
    });

  const execute = (cmd: ResolvedCommand): void => {
    if (cmd.kind === "show_section") p.current.setTab(cmd.section);
    // apply_refinement / open_hotel are hotels-list commands; never here.
  };

  // routeKey = the specific hotel id → a dynamic-segment change re-registers.
  useLiveAiPageRegistration("hotel-detail", `/hotels/${props.routeId}`, getSnapshot, execute);

  if (!enabled) return null;
  return null;
}
