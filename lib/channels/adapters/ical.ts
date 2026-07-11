// v317 — Channel Manager Phase 3: the iCal adapter (availability-only).
//
// iCal is the first fully-working ChannelAdapter. It carries AVAILABILITY
// only — the actual per-room import/export happens in lib/channels/sync.ts
// (import) and app/api/partner/ical/[roomId] (export). This adapter's job is
// the connection-level contract: testConnection validates that a feed URL is a
// real iCal document (used by the "test before you add" flow in the console).
//
import type { AdapterCtx, ChannelAdapter, TestResult } from "./types";
import { isSafeFeedUrl } from "@/lib/channels/sync";

const FETCH_TIMEOUT_MS = 8_000;

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) =>
      setTimeout(() => rej(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)), ms),
    ),
  ]);
}

export function icalAdapter(ota: string): ChannelAdapter {
  return {
    ota,
    mode: "ical",
    capabilities: { availability: true, rates: false, inventory: false, reservations: false },

    async testConnection(ctx: AdapterCtx): Promise<TestResult> {
      const url = String(ctx.endpointUrl || "").trim();

      // No specific feed URL supplied → connection-level status. iCal is live
      // via the per-room feeds managed in the console; nothing to "test" here.
      if (!url) {
        return {
          ok: true,
          state: "live",
          message:
            "iCal sync is active. Availability flows both ways through the per-room feeds you add below — no API key needed.",
        };
      }

      // A feed URL WAS supplied → validate it's a reachable iCal document.
      const safe = isSafeFeedUrl(url);
      if (!safe.ok) {
        return { ok: false, state: "error", message: `Unsafe feed URL: ${safe.reason}` };
      }
      try {
        const r = await withTimeout(
          fetch(url, {
            headers: { "User-Agent": "StayBid-Sync/2.0 (+https://www.staybids.in)" },
            cache: "no-store",
            redirect: "follow",
          }),
          FETCH_TIMEOUT_MS,
          "iCal test fetch",
        );
        if (!r.ok) {
          return { ok: false, state: "error", message: `OTA server returned HTTP ${r.status}` };
        }
        const text = await withTimeout(r.text(), FETCH_TIMEOUT_MS, "iCal body read");
        if (!/BEGIN:VCALENDAR/i.test(text)) {
          return {
            ok: false,
            state: "error",
            message: "That URL did not return an iCal calendar (no BEGIN:VCALENDAR). Check you copied the export/ICS link.",
          };
        }
        const events = (text.match(/BEGIN:VEVENT/gi) || []).length;
        return {
          ok: true,
          state: "live",
          message: `Valid iCal feed — ${events} booking${events === 1 ? "" : "s"} found. Add it below to start importing.`,
        };
      } catch (e: any) {
        return { ok: false, state: "error", message: `Could not reach the feed: ${e?.message || "network error"}` };
      }
    },

    // iCal is pull-based on the OTA side — there is no ARI push and no
    // reservation pull through this adapter (bookings arrive via the calendar
    // sync engine). pushAri / pullReservations intentionally omitted.
  };
}
