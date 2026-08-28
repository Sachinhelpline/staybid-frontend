// ─────────────────────────────────────────────────────────────────────────
// StayBid Voice AI — VOICE-AI-SB-04 — fixed four-tool adapter + trust pipeline.
//
// The ONLY place the gateway reaches the EXISTING StayBid public read API. There
// are EXACTLY four read tools; each maps to a FIXED HTTP method (GET) + a FIXED
// path family built ONLY from STAYBID_PUBLIC_BASE_URL + already-validated input.
// The provider can NEVER supply a url / host / protocol / method / header / auth /
// query name. Guards: SSRF (request origin MUST equal the configured base origin;
// redirects fail closed); a BYTE-bounded STREAMED response read (content-length
// pre-check + incremental cap — never an unbounded res.text()); hotel-allowlist
// enforcement; and BOUNDED normalized result DATA returned to the provider
// (SB04-SRC-REV-09) — only the minimum useful public catalogue fields, with bounded
// record/field counts, field lengths, and total serialized bytes. Property free
// text is UNTRUSTED DATA carried in the structured result channel ONLY — never
// appended to instructions/tool schema/policy. Provider output is untrusted at
// every stage. No business logic (ranking/pricing) is duplicated.
// ─────────────────────────────────────────────────────────────────────────
import { type GatewayConfig } from "./config";
import {
  type ProviderToolCall,
  type UiAction,
  canonicalCity,
  boundedQuery,
  isValidHotelId,
} from "./schemas";
import { type SessionStore, type VoiceGatewaySession } from "./sessions";
import { MAX_COMPARE_HOTELS as MAX_COMPARE } from "./schemas";

const MAX_RESPONSE_BYTES = 256 * 1024;
/** Hard ceiling on the serialized tool-result DATA handed back to the provider. */
const MAX_TOOL_DATA_BYTES = 8 * 1024;
const MAX_NAME_LEN = 80;
const MAX_CITY_OUT_LEN = 60;
const MAX_AMENITIES_OUT = 6;
const MAX_ROOMTYPES_OUT = 6;

export interface FetchResponseLike {
  ok: boolean;
  status: number;
  text: () => Promise<string>;
  headers?: { get: (name: string) => string | null };
  body?: { getReader: () => { read: () => Promise<{ done: boolean; value?: Uint8Array }>; cancel?: () => Promise<void> } } | null;
}
export type FetchLike = (
  url: string,
  init: { method: string; signal?: AbortSignal; redirect?: string; headers?: Record<string, string> },
) => Promise<FetchResponseLike>;

export interface ToolExecutorDeps {
  config: GatewayConfig;
  fetchImpl: FetchLike;
  now?: () => number;
}

export type ToolRunResult =
  | { ok: true; tool: string; count: number; normalizedResult: "ok" | "empty"; data: unknown }
  | {
      ok: false;
      tool: string;
      reason:
        | "not_allowlisted"
        | "hotel_id_not_allowlisted"
        | "malformed_input"
        | "request_failed"
        | "timeout"
        | "too_large"
        | "ssrf_blocked"
        | "compare_empty"
        | "cancelled";
    };

function enc(v: string): string {
  return encodeURIComponent(v);
}
function str(v: unknown, max: number): string {
  return typeof v === "string" ? v.slice(0, max) : "";
}
function numOrNull(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v.trim()) ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

/** Build a same-origin URL against the fixed base; reject any origin escape. */
function buildFixedUrl(base: string, fixedPath: string): string | null {
  let baseUrl: URL;
  try {
    baseUrl = new URL(base);
  } catch {
    return null;
  }
  let full: URL;
  try {
    full = new URL(fixedPath, `${baseUrl.protocol}//${baseUrl.host}`);
  } catch {
    return null;
  }
  if (full.protocol !== baseUrl.protocol || full.host !== baseUrl.host) return null;
  if (!full.pathname.startsWith("/api/")) return null;
  return full.toString();
}

/** BYTE-bounded read: content-length pre-check, then incremental streamed cap. */
async function readBounded(res: FetchResponseLike): Promise<string | null> {
  const cl = res.headers?.get("content-length");
  if (cl && Number(cl) > MAX_RESPONSE_BYTES) return null; // reject before reading
  const reader = res.body?.getReader?.();
  if (reader) {
    const chunks: Uint8Array[] = [];
    let total = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > MAX_RESPONSE_BYTES) {
          try {
            await reader.cancel?.();
          } catch {
            /* no-op */
          }
          return null; // over the byte cap → stop + fail closed
        }
        chunks.push(value);
      }
    }
    return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8");
  }
  // Fallback (test fakes without a stream body): read then BYTE-length gate.
  const text = await res.text();
  if (typeof text !== "string" || Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) return null;
  return text;
}

/** Cap the total serialized bytes of a result payload (drop list tail if needed). */
function capDataBytes<T>(list: T[]): T[] {
  let out = list;
  while (out.length > 0 && Buffer.byteLength(JSON.stringify(out), "utf8") > MAX_TOOL_DATA_BYTES) {
    out = out.slice(0, out.length - 1);
  }
  return out;
}

interface NormHotelRow {
  id: string;
  name: string;
  city: string;
  starRating: number | null;
  minPrice: number | null;
  avgRating?: number | null;
}
function normHotelRow(raw: unknown): NormHotelRow | null {
  if (!raw || typeof raw !== "object") return null;
  const h = raw as Record<string, unknown>;
  if (!isValidHotelId(h.id)) return null;
  let minPrice: number | null = null;
  if (Array.isArray(h.rooms)) {
    for (const r of h.rooms) {
      const f = numOrNull((r as { floorPrice?: unknown })?.floorPrice);
      if (f != null && f > 0 && (minPrice == null || f < minPrice)) minPrice = f;
    }
  }
  return {
    id: h.id,
    name: str(h.name, MAX_NAME_LEN),
    city: str(h.city, MAX_CITY_OUT_LEN),
    starRating: numOrNull(h.starRating),
    minPrice,
  };
}

export function createToolExecutor(deps: ToolExecutorDeps) {
  const timeoutMs = deps.config.limits.toolTimeoutMs;
  const maxSearch = deps.config.limits.maxSearchResults;

  async function get(url: string, extSignal?: AbortSignal): Promise<{ ok: true; json: unknown } | "timeout" | "too_large" | "failed" | "aborted"> {
    // R3 (REREV-04): if the owning turn was already cancelled, do NO network at all.
    if (extSignal?.aborted) return "aborted";
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    // Propagate the turn's cancellation into this request's controller.
    const onExtAbort = () => {
      try {
        controller.abort();
      } catch {
        /* no-op */
      }
    };
    if (extSignal) extSignal.addEventListener("abort", onExtAbort, { once: true });
    try {
      const res = await deps.fetchImpl(url, { method: "GET", signal: controller.signal, redirect: "error" });
      if (!res || !res.ok) return "failed";
      const text = await readBounded(res);
      if (text === null) return "too_large";
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        return "failed";
      }
      return { ok: true, json };
    } catch (e: unknown) {
      const name = e && typeof e === "object" ? (e as { name?: string }).name : "";
      // R3 (REREV-04): an external (turn-cancel) abort is distinct from a timeout.
      if (extSignal?.aborted) return "aborted";
      if (name === "AbortError") return "timeout";
      return "failed";
    } finally {
      clearTimeout(timer);
      if (extSignal) extSignal.removeEventListener("abort", onExtAbort);
    }
  }

  const nowFn = deps.now || (() => Date.now());

  return {
    /**
     * R3 (SB04-R2-REREV-10): SERVER-VERIFY a bounded ordered list of client-supplied
     * candidate hotel ids using the SAME fixed getHotelDetails read (fixed GET, fixed
     * path, SSRF/redirect-guarded, byte-capped, cancellable). Bounded concurrency + an
     * overall deadline avoid unbounded 24-request latency. Returns ONLY server-verified
     * candidates, each carrying its ORIGINAL 1-based ordinal slot (failed slots are
     * dropped — never fail open). This is NOT a provider-exposed tool.
     */
    async verifyVisibleContext(
      ids: string[],
      signal?: AbortSignal,
      overallDeadlineMs = 8_000,
    ): Promise<Array<{ ordinal: number; id: string; name: string; city: string; starRating: number | null; minPrice: number | null }>> {
      const base = deps.config.publicBaseUrl;
      if (!base || !Array.isArray(ids) || ids.length === 0) return [];
      const bounded = ids.slice(0, 24).filter(isValidHotelId);
      const slots: Array<{ ordinal: number; id: string; name: string; city: string; starRating: number | null; minPrice: number | null } | null> = new Array(bounded.length).fill(null);
      const deadline = nowFn() + Math.max(1, overallDeadlineMs);
      let idx = 0;
      const worker = async () => {
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const my = idx++;
          if (my >= bounded.length) return;
          if (signal?.aborted || nowFn() > deadline) return;
          const id = bounded[my];
          const url = buildFixedUrl(base, `/api/hotels/${enc(id)}`);
          if (!url) continue;
          const r = await get(url, signal);
          if (r === "aborted") return;
          if (typeof r === "string") continue; // timeout/too_large/failed → drop slot
          const hotel = r.json && typeof r.json === "object" ? (r.json as { hotel?: unknown }).hotel ?? r.json : null;
          const h = hotel && typeof hotel === "object" ? (hotel as Record<string, unknown>) : null;
          if (!h || h.id !== id) continue; // server did not confirm this exact id
          const n = normHotelRow(h);
          if (n) slots[my] = { ordinal: my + 1, id: n.id, name: n.name, city: n.city, starRating: n.starRating, minPrice: n.minPrice };
        }
      };
      const CONCURRENCY = 4;
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, bounded.length) }, () => worker()));
      return slots.filter((s): s is { ordinal: number; id: string; name: string; city: string; starRating: number | null; minPrice: number | null } => s !== null);
    },

    async run(store: SessionStore, session: VoiceGatewaySession, call: ProviderToolCall, signal?: AbortSignal): Promise<ToolRunResult> {
      const base = deps.config.publicBaseUrl;
      if (!base) return { ok: false, tool: call.tool, reason: "request_failed" };
      // R3 (REREV-04): a turn cancelled before the tool even starts does no work.
      if (signal?.aborted) return { ok: false, tool: call.tool, reason: "cancelled" };

      // compareHotels — every id must be allowlisted; R2 (REREV-08B) returns BOUNDED
      // normalized comparable DATA (≤3 rows, public catalogue fields only — id/name/
      // city/starRating/minPrice/avgRating), never just the ids and never a private
      // field. Each row is fetched through the SAME SSRF-guarded fixed GET.
      if (call.tool === "compareHotels") {
        const rawIds = Array.isArray(call.input.hotelIds) ? (call.input.hotelIds as unknown[]) : [];
        if (rawIds.length === 0) return { ok: false, tool: call.tool, reason: "compare_empty" };
        const ids: string[] = [];
        for (const id of rawIds) {
          if (!isValidHotelId(id)) return { ok: false, tool: call.tool, reason: "malformed_input" };
          if (!store.hasHotelId(session, id)) return { ok: false, tool: call.tool, reason: "hotel_id_not_allowlisted" };
          if (!ids.includes(id)) ids.push(id);
          if (ids.length >= MAX_COMPARE) break;
        }
        const rows: NormHotelRow[] = [];
        for (const id of ids) {
          const url = buildFixedUrl(base, `/api/hotels/${enc(id)}`);
          if (!url) return { ok: false, tool: call.tool, reason: "ssrf_blocked" };
          const r = await get(url, signal);
          if (r === "aborted") return { ok: false, tool: call.tool, reason: "cancelled" };
          if (r === "timeout") return { ok: false, tool: call.tool, reason: "timeout" };
          if (r === "too_large") return { ok: false, tool: call.tool, reason: "too_large" };
          if (r === "failed") return { ok: false, tool: call.tool, reason: "request_failed" };
          const hotel = r.json && typeof r.json === "object" ? (r.json as { hotel?: unknown }).hotel ?? r.json : null;
          const h = hotel && typeof hotel === "object" ? (hotel as Record<string, unknown>) : null;
          if (!h || h.id !== id) return { ok: false, tool: call.tool, reason: "request_failed" };
          const n = normHotelRow(h);
          if (n) rows.push({ ...n, avgRating: numOrNull(h.avgRating) } as NormHotelRow);
        }
        const data = { hotels: capDataBytes(rows) };
        return { ok: true, tool: call.tool, count: rows.length, normalizedResult: rows.length ? "ok" : "empty", data };
      }

      // Build the FIXED path.
      let fixedPath: string | null = null;
      if (call.tool === "searchHotels") {
        const city = call.input.city == null ? null : canonicalCity(call.input.city);
        const q = call.input.q == null ? null : boundedQuery(call.input.q);
        if (call.input.city != null && city === null) return { ok: false, tool: call.tool, reason: "malformed_input" };
        if (call.input.q != null && q === null) return { ok: false, tool: call.tool, reason: "malformed_input" };
        const params = [city ? `city=${enc(city)}` : "", q ? `q=${enc(q)}` : ""].filter(Boolean);
        fixedPath = `/api/hotels${params.length ? `?${params.join("&")}` : ""}`;
      } else if (call.tool === "getHotelDetails") {
        const id = call.input.id;
        if (!isValidHotelId(id)) return { ok: false, tool: call.tool, reason: "malformed_input" };
        if (!store.hasHotelId(session, id)) return { ok: false, tool: call.tool, reason: "hotel_id_not_allowlisted" };
        fixedPath = `/api/hotels/${enc(id)}`;
      } else if (call.tool === "getFlashDeals") {
        const city = call.input.city == null ? null : canonicalCity(call.input.city);
        if (call.input.city != null && city === null) return { ok: false, tool: call.tool, reason: "malformed_input" };
        const params = [city ? `city=${enc(city)}` : "", "viewed="].filter(Boolean);
        fixedPath = `/api/flash/near?${params.join("&")}`;
      }
      if (!fixedPath) return { ok: false, tool: call.tool, reason: "not_allowlisted" };

      const url = buildFixedUrl(base, fixedPath);
      if (!url) return { ok: false, tool: call.tool, reason: "ssrf_blocked" };

      const result = await get(url, signal);
      if (result === "aborted") return { ok: false, tool: call.tool, reason: "cancelled" };
      if (result === "timeout") return { ok: false, tool: call.tool, reason: "timeout" };
      if (result === "too_large") return { ok: false, tool: call.tool, reason: "too_large" };
      if (result === "failed") return { ok: false, tool: call.tool, reason: "request_failed" };

      // Normalize + allowlist seeding + BOUNDED result data.
      if (call.tool === "searchHotels") {
        const arr = result.json && typeof result.json === "object" && Array.isArray((result.json as { hotels?: unknown }).hotels)
          ? ((result.json as { hotels: unknown[] }).hotels)
          : [];
        const rows: NormHotelRow[] = [];
        for (const item of arr) {
          const n = normHotelRow(item);
          if (n) rows.push(n);
          if (rows.length >= maxSearch) break;
        }
        store.allowHotelIds(session, rows.map((r) => r.id));
        const data = { hotels: capDataBytes(rows) };
        return { ok: true, tool: call.tool, count: rows.length, normalizedResult: rows.length ? "ok" : "empty", data };
      }
      if (call.tool === "getHotelDetails") {
        const hotel = result.json && typeof result.json === "object" ? (result.json as { hotel?: unknown }).hotel ?? result.json : null;
        const h = hotel && typeof hotel === "object" ? (hotel as Record<string, unknown>) : null;
        if (!h || !isValidHotelId(h.id) || h.id !== call.input.id) return { ok: false, tool: call.tool, reason: "request_failed" };
        const base = normHotelRow(h);
        if (!base) return { ok: false, tool: call.tool, reason: "request_failed" };
        const amenities = Array.isArray(h.amenities)
          ? (h.amenities.filter((a): a is string => typeof a === "string").slice(0, MAX_AMENITIES_OUT).map((a) => str(a, 40)))
          : [];
        const roomTypes = Array.isArray(h.rooms)
          ? (h.rooms.slice(0, MAX_ROOMTYPES_OUT).map((r) => ({ name: str((r as { name?: unknown })?.name, 60), floorPrice: numOrNull((r as { floorPrice?: unknown })?.floorPrice) })).filter((r) => r.name))
          : [];
        const data = { hotel: { ...base, avgRating: numOrNull(h.avgRating), amenities, roomTypes } };
        return { ok: true, tool: call.tool, count: 1, normalizedResult: "ok", data };
      }
      // getFlashDeals
      const deals = result.json && typeof result.json === "object" && Array.isArray((result.json as { deals?: unknown }).deals)
        ? ((result.json as { deals: unknown[] }).deals)
        : [];
      const rows: Array<{ id: string; hotelId: string | null; hotelName: string; city: string; price: number | null; wasPrice: number | null }> = [];
      for (const d of deals) {
        const row = d as Record<string, unknown>;
        if (!isValidHotelId(row.id)) continue;
        rows.push({
          id: row.id as string,
          hotelId: isValidHotelId(row.hotelId) ? (row.hotelId as string) : null,
          hotelName: str(row.hotelName ?? row.name, MAX_NAME_LEN),
          city: str(row.city, MAX_CITY_OUT_LEN),
          price: numOrNull(row.aiPrice),
          wasPrice: numOrNull(row.marketRate),
        });
        if (rows.length >= maxSearch) break;
      }
      store.allowHotelIds(session, rows.map((r) => r.hotelId).filter((x): x is string => !!x));
      return { ok: true, tool: call.tool, count: rows.length, normalizedResult: rows.length ? "ok" : "empty", data: { deals: capDataBytes(rows) } };
    },
  };
}

export type ToolExecutor = ReturnType<typeof createToolExecutor>;

// ---- UI-action authorization (allowlist enforcement before forwarding) -------
export type UiAuthResult = { ok: true; action: UiAction } | { ok: false; reason: "hotel_id_not_allowlisted" };

export function authorizeUiAction(
  store: SessionStore,
  session: VoiceGatewaySession,
  action: UiAction,
): UiAuthResult {
  switch (action.type) {
    case "OPEN_HOTEL":
      if (!store.hasHotelId(session, action.hotelId)) return { ok: false, reason: "hotel_id_not_allowlisted" };
      return { ok: true, action };
    case "SHOW_COMPARISON":
      if (action.hotelIds.some((id) => !store.hasHotelId(session, id))) {
        return { ok: false, reason: "hotel_id_not_allowlisted" };
      }
      return { ok: true, action };
    case "PREPARE_BID_DRAFT":
      if (!store.hasHotelId(session, action.hotelId)) return { ok: false, reason: "hotel_id_not_allowlisted" };
      return { ok: true, action };
    default:
      return { ok: true, action };
  }
}
