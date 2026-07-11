// v317 — Channel Manager Phase 3: adapter registry.
//
// getAdapter(ota, mode) resolves the ONE adapter for a connection. Every OTA,
// in any mode, implements the same ChannelAdapter interface — so the console,
// the test-connection route, and future push/pull code never special-case a
// channel. iCal is the fully-working adapter today; API channels return an
// honest "configured · awaiting connector" until Phase 6 certifies them.
//
import type { ChannelAdapter, ChannelMode } from "./types";
import { icalAdapter } from "./ical";
import { apiStubAdapter, manualAdapter } from "./api-stub";
import { bookingAdapter } from "./booking-adapter";

export * from "./types";

// v320 — Phase 6 groundwork: OTAs with a concrete (scaffolded) API adapter get
// it; every other channel keeps the honest api-stub. The Booking.com adapter is
// inert in production (no creds / no BOOKING_COM_LIVE flag → identical to the
// stub), so wiring it in is a zero-behaviour-change fill-in for later.
function apiAdapterFor(ota: string): ChannelAdapter {
  switch (String(ota || "").toLowerCase()) {
    case "booking":
      return bookingAdapter(ota);
    default:
      return apiStubAdapter(ota);
  }
}

export function getAdapter(ota: string, mode: ChannelMode): ChannelAdapter {
  switch (mode) {
    case "ical":
      return icalAdapter(ota);
    case "manual":
      return manualAdapter(ota);
    case "api":
    default:
      return apiAdapterFor(ota);
  }
}
