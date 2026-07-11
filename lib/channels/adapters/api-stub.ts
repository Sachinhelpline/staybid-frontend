// v317 — Channel Manager Phase 3: API + manual adapters (honest placeholders).
//
// Certified OTA connectivity APIs (Booking.com Connectivity, InGo-MMT, Agoda
// YCS, Expedia EQC, Airbnb) each require a business partnership + certification
// (weeks–months, gates on sign-ups not code). Until a real connector ships in
// Phase 6, the API adapter's job is HONESTY: it validates that credentials are
// saved and reports "configured · awaiting connector" — it NEVER claims a live
// green connection it can't back up.
//
import type { AdapterCtx, ChannelAdapter, TestResult } from "./types";

const OTA_LABEL: Record<string, string> = {
  booking: "Booking.com",
  mmt: "MakeMyTrip",
  goibibo: "Goibibo",
  agoda: "Agoda",
  expedia: "Expedia",
  airbnb: "Airbnb",
  tripadvisor: "Tripadvisor",
  hostelworld: "Hostelworld",
  vrbo: "Vrbo",
  other: "this channel",
};

function labelFor(ota: string): string {
  return OTA_LABEL[String(ota || "").toLowerCase()] || "this channel";
}

/** API-mode adapter — credentials saved, certified connector is future scope. */
export function apiStubAdapter(ota: string): ChannelAdapter {
  const name = labelFor(ota);
  return {
    ota,
    mode: "api",
    capabilities: { availability: true, rates: true, inventory: true, reservations: true },

    async testConnection(ctx: AdapterCtx): Promise<TestResult> {
      const hasCreds = Boolean((ctx.apiKey && ctx.apiKey.trim()) || (ctx.propertyId && ctx.propertyId.trim()));
      if (!hasCreds) {
        return {
          ok: false,
          state: "error",
          message: `Add your ${name} API key / property ID to configure this channel.`,
        };
      }
      return {
        ok: true,
        state: "configured",
        message: `${name} credentials saved. The certified ${name} connector activates in a future release — until then, use an iCal feed for live availability sync.`,
      };
    },

    async pushAri(): Promise<{ ok: false; pushed: number; message: string }> {
      return {
        ok: false,
        pushed: 0,
        message: `The ${name} rates/availability push is not certified yet. Update rates in the ${name} extranet for now.`,
      };
    },

    async pullReservations(): Promise<{ ok: false; reservations: []; message: string }> {
      return {
        ok: false,
        reservations: [],
        message: `The ${name} reservations API is not certified yet. Import an iCal feed to receive ${name} bookings as room blocks.`,
      };
    },
  };
}

/** Manual-mode adapter — no connector at all; tracked as a task-list channel. */
export function manualAdapter(ota: string): ChannelAdapter {
  const name = labelFor(ota);
  return {
    ota,
    mode: "manual",
    capabilities: { availability: false, rates: false, inventory: false, reservations: false },

    async testConnection(): Promise<TestResult> {
      return {
        ok: true,
        state: "configured",
        message: `${name} is set to manual mode — update rates and availability directly in the ${name} extranet.`,
      };
    },
  };
}
