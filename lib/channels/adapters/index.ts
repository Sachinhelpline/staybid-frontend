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

export * from "./types";

export function getAdapter(ota: string, mode: ChannelMode): ChannelAdapter {
  switch (mode) {
    case "ical":
      return icalAdapter(ota);
    case "manual":
      return manualAdapter(ota);
    case "api":
    default:
      return apiStubAdapter(ota);
  }
}
