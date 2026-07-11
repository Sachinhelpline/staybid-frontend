// v317 — Channel Manager Phase 3: the adapter interface (ARI foundation).
//
// Every OTA connection resolves to ONE adapter. iCal is the first fully-working
// adapter (availability-only, pull-based from the OTA side). Certified API
// connectors (Booking.com Connectivity, InGo-MMT, Agoda YCS, Expedia…) land as
// additional adapters in Phase 6 — each implements this same interface, so the
// console + sync code never special-case a channel.
//
// Availability, Rates, Inventory = "ARI". iCal carries availability only; API
// adapters carry the full ARI once certified.

export type ChannelMode = "ical" | "api" | "manual";

export interface AdapterCtx {
  ota: string;
  mode: ChannelMode;
  hotelId: string;
  /** Credentials from channel_connections (api mode). */
  apiKey?: string | null;
  apiSecret?: string | null;
  propertyId?: string | null;
  endpointUrl?: string | null;
}

export interface TestResult {
  ok: boolean;
  /** honest, human-readable — shown verbatim in the console */
  message: string;
  /** "live" = data actually flows · "configured" = creds saved, connector
   *  not yet certified · "error" = something's wrong */
  state: "live" | "configured" | "error";
}

/** One room-date ARI cell to push (API adapters). */
export interface AriCell {
  roomRef: string;
  ratePlanRef?: string;
  date: string;      // YYYY-MM-DD
  price?: number;    // marked-up channel price
  available?: number;
  minStay?: number;
  stopSell?: boolean;
}

export interface PushResult {
  ok: boolean;
  pushed: number;
  message: string;
}

export interface PulledReservation {
  externalRef: string;
  roomRef?: string;
  checkIn: string;
  checkOut: string;
  guestName?: string;
  status: "new" | "modified" | "cancelled";
}

export interface PullResult {
  ok: boolean;
  reservations: PulledReservation[];
  message: string;
}

export interface ChannelAdapter {
  readonly ota: string;
  readonly mode: ChannelMode;
  /** Availability only (iCal) vs full Availability+Rates+Inventory (API). */
  readonly capabilities: { availability: boolean; rates: boolean; inventory: boolean; reservations: boolean };
  /** Validate the connection is reachable/credentialed. Always implemented. */
  testConnection(ctx: AdapterCtx): Promise<TestResult>;
  /** Push ARI to the OTA (API adapters). iCal is pull-based → not supported. */
  pushAri?(ctx: AdapterCtx, cells: AriCell[]): Promise<PushResult>;
  /** Pull reservations from the OTA (API adapters). iCal delivers bookings via
   *  the calendar sync engine, not here. */
  pullReservations?(ctx: AdapterCtx): Promise<PullResult>;
}
