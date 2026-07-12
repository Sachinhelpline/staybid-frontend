// v320 — Channel Manager Phase 6 groundwork: Booking.com Connectivity adapter.
//
// ⚠ SCAFFOLD, NOT A LIVE CONNECTOR. Booking.com's Connectivity APIs require a
// signed Connectivity Partner agreement + certification (machine account,
// XML/JSON credentials, sandbox → production sign-off). None of that exists
// yet, so this adapter is DELIBERATELY inert in production: with no credentials
// OR without the BOOKING_COM_LIVE="1" flag it returns the EXACT same honest
// "configured · awaiting connector" result as api-stub — zero behaviour change
// today. The real request shapes live here as documented, ready-to-fill
// scaffolding so Phase 6 is a fill-in-the-blanks job once certification lands,
// not a from-scratch build.
//
// Booking.com Connectivity surface (for the fill-in later):
//   • ARI push    → OTA_HotelAvailNotifRQ / OTA_HotelRateAmountNotifRQ
//                   (XML, https://supply-xml.booking.com/hotels/xml/*)
//   • Reservations→ OTA_HotelResNotifRQ (pull) / Reservations API v2 (JSON)
//   • Auth        → machine-account username + password (Basic) OR API token
//   Docs: https://connect.booking.com/  (partner-gated)
//
import type {
  AdapterCtx,
  AriCell,
  ChannelAdapter,
  PullResult,
  PushResult,
  TestResult,
} from "./types";

const NAME = "Booking.com";
const FETCH_TIMEOUT_MS = 10_000;
// Default supply endpoint (overridable per-env for sandbox vs production).
const DEFAULT_ENDPOINT = "https://supply-xml.booking.com/hotels/xml";

/** The connector only attempts real network calls when explicitly enabled with
 *  a certified machine account. Absent in production → inert scaffold. */
function liveEnabled(): boolean {
  return String(process.env.BOOKING_COM_LIVE || "") === "1";
}

function endpointFor(ctx: AdapterCtx): string {
  return (
    (ctx.endpointUrl && ctx.endpointUrl.trim()) ||
    process.env.BOOKING_COM_ENDPOINT ||
    DEFAULT_ENDPOINT
  );
}

/** Machine-account / token from the channel_connections row (api mode). */
function creds(ctx: AdapterCtx): { user?: string; secret?: string; propertyId?: string } {
  return {
    user: (ctx.apiKey || "").trim() || undefined,
    secret: (ctx.apiSecret || "").trim() || undefined,
    propertyId: (ctx.propertyId || "").trim() || undefined,
  };
}

function hasCreds(ctx: AdapterCtx): boolean {
  const c = creds(ctx);
  return Boolean(c.user && c.secret && c.propertyId);
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) =>
      setTimeout(() => rej(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)), ms)
    ),
  ]);
}

// ── XML envelope scaffolding (documented shapes — NOT sent until certified) ──

/** OTA_HotelAvailNotifRQ — pushes availability + restrictions for a room/date
 *  range. Rates go via OTA_HotelRateAmountNotifRQ (same envelope family). This
 *  builder returns the exact wire shape so the live push is a drop-in later. */
export function buildAvailNotifXml(propertyId: string, cells: AriCell[]): string {
  const stamp = "{{ISO_TIMESTAMP}}"; // stamped at send time (Date.now unavailable in some ctx)
  const items = cells
    .map((c) => {
      const parts: string[] = [
        `Start="${c.date}"`,
        `End="${c.date}"`,
        `InvTypeCode="${c.roomRef}"`,
      ];
      if (c.ratePlanRef) parts.push(`RatePlanCode="${c.ratePlanRef}"`);
      const status: string[] = [];
      if (c.available != null) status.push(`BookingLimit="${c.available}"`);
      if (c.stopSell != null) status.push(`Status="${c.stopSell ? "Close" : "Open"}"`);
      const restr =
        c.minStay != null
          ? `<LengthsOfStay><LengthOfStay MinMaxMessageType="SetMinLOS" Time="${c.minStay}" /></LengthsOfStay>`
          : "";
      return `<AvailStatusMessage><StatusApplicationControl ${parts.join(" ")} />` +
        (status.length ? `<RestrictionStatus ${status.join(" ")} />` : "") +
        restr +
        `</AvailStatusMessage>`;
    })
    .join("");
  return (
    `<OTA_HotelAvailNotifRQ xmlns="http://www.opentravel.org/OTA/2003/05" TimeStamp="${stamp}" Version="1.0">` +
    `<AvailStatusMessages HotelCode="${propertyId}">${items}</AvailStatusMessages>` +
    `</OTA_HotelAvailNotifRQ>`
  );
}

function basicAuth(user: string, secret: string): string {
  // btoa is available in the Node runtime Vercel uses for route handlers.
  return "Basic " + Buffer.from(`${user}:${secret}`).toString("base64");
}

// ── The adapter ──────────────────────────────────────────────────────────

export function bookingAdapter(ota: string): ChannelAdapter {
  return {
    ota,
    mode: "api",
    capabilities: { availability: true, rates: true, inventory: true, reservations: true },

    async testConnection(ctx: AdapterCtx): Promise<TestResult> {
      if (!hasCreds(ctx)) {
        return {
          ok: false,
          state: "error",
          message: `Add your ${NAME} machine-account username, password and hotel ID to configure this channel.`,
        };
      }
      // Inert scaffold path (production today) — honest, identical to api-stub.
      if (!liveEnabled()) {
        return {
          ok: true,
          state: "configured",
          message: `${NAME} credentials saved. The certified ${NAME} Connectivity connector activates once BOOKING_COM_LIVE is enabled with a partner machine account — until then, use an iCal feed for live availability sync.`,
        };
      }
      // Live path — only runs with an enabled, certified machine account.
      try {
        const c = creds(ctx);
        const res = await withTimeout(
          fetch(endpointFor(ctx), {
            method: "POST",
            headers: {
              "Content-Type": "application/xml",
              Authorization: basicAuth(c.user!, c.secret!),
            },
            // A lightweight OTA_PingRQ-style reachability probe.
            body: `<OTA_PingRQ xmlns="http://www.opentravel.org/OTA/2003/05" Version="1.0"><EchoData>staybid-ping</EchoData></OTA_PingRQ>`,
          }),
          FETCH_TIMEOUT_MS,
          `${NAME} ping`
        );
        if (res.ok) {
          return { ok: true, state: "live", message: `${NAME} Connectivity reachable.` };
        }
        return {
          ok: false,
          state: "error",
          message: `${NAME} Connectivity returned HTTP ${res.status}. Check the machine account + endpoint.`,
        };
      } catch (e: any) {
        return { ok: false, state: "error", message: `${NAME} ping failed: ${e?.message || "unreachable"}` };
      }
    },

    async pushAri(ctx: AdapterCtx, cells: AriCell[]): Promise<PushResult> {
      if (!liveEnabled() || !hasCreds(ctx)) {
        return {
          ok: false,
          pushed: 0,
          message: `The ${NAME} rates/availability push is not certified yet. Update rates in the ${NAME} extranet for now.`,
        };
      }
      // Live push scaffold — the XML shape is production-correct; the send is
      // gated behind certification. Kept here so Phase 6 is fill-in-the-blanks.
      try {
        const c = creds(ctx);
        const xml = buildAvailNotifXml(c.propertyId!, cells).replace("{{ISO_TIMESTAMP}}", new Date().toISOString());
        const res = await withTimeout(
          fetch(endpointFor(ctx), {
            method: "POST",
            headers: { "Content-Type": "application/xml", Authorization: basicAuth(c.user!, c.secret!) },
            body: xml,
          }),
          FETCH_TIMEOUT_MS,
          `${NAME} push`
        );
        return res.ok
          ? { ok: true, pushed: cells.length, message: `Pushed ${cells.length} ARI cells to ${NAME}.` }
          : { ok: false, pushed: 0, message: `${NAME} push returned HTTP ${res.status}.` };
      } catch (e: any) {
        return { ok: false, pushed: 0, message: `${NAME} push failed: ${e?.message || "unreachable"}` };
      }
    },

    async pullReservations(ctx: AdapterCtx): Promise<PullResult> {
      // Reservations pull (OTA_HotelResNotifRQ) requires the certified partner
      // channel. Until then iCal delivers Booking.com stays as room blocks.
      if (!liveEnabled() || !hasCreds(ctx)) {
        return {
          ok: false,
          reservations: [],
          message: `The ${NAME} reservations API is not certified yet. Import an iCal feed to receive ${NAME} bookings as room blocks.`,
        };
      }
      // Live pull scaffold — parse mapping filled in during certification.
      return {
        ok: false,
        reservations: [],
        message: `${NAME} reservations pull is enabled but the response mapping is pending certification sign-off.`,
      };
    },
  };
}
