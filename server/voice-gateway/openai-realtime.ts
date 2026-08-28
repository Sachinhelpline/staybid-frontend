// ─────────────────────────────────────────────────────────────────────────
// StayBid Voice AI — VOICE-AI-SB-04 — OpenAI Realtime adapter boundary.
//
// The provider-specific seam. It keeps OpenAI Realtime details behind a small,
// INJECTABLE transport so provider event objects never leak into the gateway's
// policy code. SB-04 makes NO real, billable, authenticated OpenAI call: the
// DEFAULT transport is `unavailableRealtimeTransport` (fails closed); tests inject
// a fake transport + a fake sideband connection.
//
// The model / endpoint / key come ONLY from server config — a caller can never
// override model, endpoint, instructions, tools, or temperature. Provider errors
// are NORMALIZED to bounded codes; the API key, provider URL, headers, and any
// stack are NEVER returned or logged.
// ─────────────────────────────────────────────────────────────────────────
import { type GatewayConfig, providerConfigured } from "./config";
import { type ProviderEvent, validateProviderEvent } from "./schemas";

export type RealtimeErrorCode =
  | "provider_unavailable"
  | "provider_timeout"
  | "provider_rejected"
  | "provider_rate_limited"
  | "malformed_answer";

export type RealtimeSessionResult =
  | { ok: true; answerSdp: string; providerSessionId: string; sideband: SidebandConnection }
  | { ok: false; code: RealtimeErrorCode };

/** The private server-side sideband — the AUTHORITATIVE provider tool surface. */
export interface SidebandConnection {
  /** Register a validated-provider-event listener (tool calls / answers). */
  onEvent: (cb: (ev: ProviderEvent) => void) => void;
  /** Register a speech-boundary listener (provider VAD) for utterance limits. R5
   *  (SB04-R4-REREV-02): "stop" is the end-of-speech signal ONLY (it stops the
   *  utterance-duration timer) — it NEVER reserves cost or requests a response. R6
   *  (SB04-R5-REREV-01): every VAD boundary carries the provider `item_id` (the id of
   *  the user-message item that will be created on commit; the SAME id spans
   *  speech_started → speech_stopped → input_audio_buffer.committed for one utterance)
   *  so per-item ownership can never cross utterances. */
  onSpeech?: (cb: (phase: "start" | "stop", itemId: string) => void) => void;
  /** R5 (SB04-R4-REREV-02): register the AUTHORITATIVE commit-boundary listener. The
   *  provider's `input_audio_buffer.committed` (the documented server-VAD commit; see
   *  https://platform.openai.com/docs/api-reference/realtime-server-events/input_audio_buffer/committed,
   *  accessed 2026-08-28) fires this with the committed user-message `item_id`. This is
   *  the ONE place per committed utterance where the gateway reserves cost and (only on
   *  a successful reservation) requests exactly one response. `item_id` is the
   *  idempotency key — a duplicate/late commit for the same id must be a no-op. */
  onCommit?: (cb: (itemId: string) => void) => void;
  /** R4 (SB04-R3-REREV-02): register a FATAL lifecycle listener — fired once when
   *  the sideband dies unexpectedly AFTER readiness (ws error/close, provider fatal
   *  error). An intentional local close()/hangup never fires it. R6
   *  (SB04-R5-REREV-02) adds `response_timeout`: a sent `response.create` produced no
   *  `response.created` within the bounded ACK deadline — fatal, so no late event can
   *  bind to future work. */
  onFatal?: (cb: (reason: "socket_error" | "socket_closed" | "provider_error" | "response_timeout") => void) => void;
  /** Send bounded, normalized tool RESULTS back to the provider. */
  sendToolResult: (payload: { callId: string; ok: boolean; count?: number; reason?: string; data?: unknown }) => void;
  /** R4 (SB04-R3-REREV-03): trigger provider inference (`response.create`) — the
   *  GATEWAY calls this only AFTER a successful cost reservation. With
   *  `turn_detection.create_response:false` the provider never starts a response
   *  on its own, so no reservation ⇒ no inference. Returns false when the send
   *  could not be performed. R6 (SB04-R5-REREV-02): the caller passes a
   *  server-generated non-secret `requestId` that is set on
   *  `response.create.response.metadata.request_id` (echoed back at response.created)
   *  AND arms a bounded response.created ACK deadline — if no response.created binds
   *  in time the WHOLE provider session is terminated (a late response.created can
   *  therefore never attach to future work). Only ONE request may be outstanding. */
  requestResponse?: (requestId?: string) => boolean;
  /** R7 (SB04-R6-REREV-02): the scheduler calls this EXACTLY when it has AUTHORITATIVELY bound the
   *  single outstanding `response.created` to its reservation — and ONLY then is the response.created
   *  ACK deadline (armed by `requestResponse`) cleared. The raw provider `response.created` no longer
   *  clears the deadline itself, so an unrequested / mismatched / unbindable `response.created` leaves
   *  the deadline armed and it still fires the fail-closed timeout. (An immediate fail-closed
   *  termination clears the deadline via `close()` instead.) */
  notifyResponseBound?: () => void;
  /** R4 (SB04-R3-REREV-10): push a STRUCTURED, server-verified ordinal→id
   *  visible-context mapping and AWAIT the provider's documented acknowledgement
   *  (`conversation.item.created` echoing our client-supplied item id) within a
   *  bounded timeout. Resolves true ONLY on a matching ack; send-throw / close /
   *  provider error / timeout ⇒ false (never a silent success). */
  sendContext?: (items: Array<{ ordinal: number; id: string }>, ackTimeoutMs?: number) => Promise<boolean>;
  /** Cancel the current provider turn. */
  cancelTurn: () => void;
  close: () => void;
}

/** The injected transport a real provider packet implements. */
export interface RealtimeTransport {
  isAvailable(config: GatewayConfig): boolean;
  createSession(input: {
    offerSdp: string;
    model: string;
    baseUrl: string;
    connectTimeoutMs: number;
  }): Promise<
    | { ok: true; answerSdp: string; providerSessionId: string; sideband: SidebandConnection }
    | { ok: false; code: RealtimeErrorCode }
  >;
}

/** DEFAULT transport — never available; never fakes an answer. SB-04 ships this. */
export const unavailableRealtimeTransport: RealtimeTransport = Object.freeze({
  isAvailable(): boolean {
    return false;
  },
  async createSession(): Promise<{ ok: false; code: RealtimeErrorCode }> {
    return { ok: false, code: "provider_unavailable" };
  },
});

/** A no-op sideband (used by fakes / when no provider is connected). */
export function createInertSideband(): SidebandConnection {
  return {
    onEvent() {
      /* no events */
    },
    sendToolResult() {
      /* no-op */
    },
    cancelTurn() {
      /* no-op */
    },
    close() {
      /* no-op */
    },
  };
}

/**
 * Re-validate ANY raw provider event through the closed schema before it reaches
 * gateway policy code — an OpenAI event object is never trusted as-is.
 */
export function normalizeProviderEvent(raw: unknown): ProviderEvent | null {
  return validateProviderEvent(raw);
}

export interface OpenAiRealtimeDeps {
  config: GatewayConfig;
  transport?: RealtimeTransport;
}

export function createOpenAiRealtime(deps: OpenAiRealtimeDeps) {
  const transport = deps.transport || unavailableRealtimeTransport;
  const config = deps.config;

  return {
    id: "openai",
    isAvailable(): boolean {
      return providerConfigured(config) && transport.isAvailable(config);
    },

    /** Create a provider realtime session from the browser SDP offer. Fixed model
     *  + endpoint from config; the caller overrides nothing. Fails closed. */
    async createSession(offerSdp: string): Promise<RealtimeSessionResult> {
      if (!providerConfigured(config) || !transport.isAvailable(config)) {
        return { ok: false, code: "provider_unavailable" };
      }
      let res;
      try {
        res = await transport.createSession({
          offerSdp,
          model: config.openaiModel,
          baseUrl: config.openaiBaseUrl,
          connectTimeoutMs: config.limits.providerConnectTimeoutMs,
        });
      } catch {
        // Never surface a provider stack / URL / key.
        return { ok: false, code: "provider_unavailable" };
      }
      if (!res.ok) return { ok: false, code: res.code };
      if (typeof res.answerSdp !== "string" || !/^v=0/m.test(res.answerSdp)) {
        return { ok: false, code: "malformed_answer" };
      }
      return {
        ok: true,
        answerSdp: res.answerSdp,
        providerSessionId: res.providerSessionId,
        sideband: res.sideband,
      };
    },
  };
}

export type OpenAiRealtime = ReturnType<typeof createOpenAiRealtime>;

// ═══════════════════════════════════════════════════════════════════════════
// REAL (dormant) OpenAI Realtime transport — VOICE-AI-SB-04 R1 (SB04-SRC-REV-01).
//
// The genuine source adapter a configured deployment would use. It:
//   • POSTs the browser SDP offer to the FIXED OpenAI Realtime calls endpoint
//     (verified current contract: POST {baseUrl}/calls, Content-Type
//     application/sdp, Authorization: Bearer <server API key>, returns answer SDP),
//     with a bounded connect timeout and redirect:"error";
//   • opens a PRIVATE server-side sideband WebSocket (the approved `ws` dep) with
//     the server API key — never a browser secret — and translates raw provider
//     events into the CLOSED gateway schema before any policy code sees them;
//   • exposes a termination handle that closes the sideband + best-effort deletes
//     the provider call.
//
// It is INJECTABLE (fetch + WebSocket ctor) so tests drive it with fakes and NO
// real, billable, authenticated OpenAI request is ever made in this packet. The
// key/model/endpoint come ONLY from server config; the caller overrides nothing.
// No key/token/transcript/raw-event is ever logged.
// ═══════════════════════════════════════════════════════════════════════════

/** Minimal server-side WebSocket surface (the `ws` WebSocket, or a fake). */
export interface ServerWsLike {
  send: (data: string) => void;
  close: (code?: number) => void;
  on: (event: string, cb: (arg?: unknown) => void) => void;
}
export type ServerWsCtor = (url: string, opts: { headers: Record<string, string> }) => ServerWsLike;

export interface RealtimeFetchResponse {
  ok: boolean;
  status: number;
  text: () => Promise<string>;
  headers: { get: (name: string) => string | null };
  // R3 (REREV-08B): a streamed body so the provider answer SDP is read INCREMENTALLY
  // with a byte cap (never an unbounded res.text()). Test fakes may omit it, in which
  // case the bounded reader falls back to a byte-gated text() read.
  body?: { getReader: () => { read: () => Promise<{ done: boolean; value?: Uint8Array }>; cancel?: () => Promise<void> } } | null;
}
export type RealtimeFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal; redirect?: string },
) => Promise<RealtimeFetchResponse>;

/** Max bytes for the provider answer SDP (bounded streamed read, REREV-08B). */
const MAX_ANSWER_SDP_BYTES = 16 * 1024;
/** Bounded readiness timeout for the mandatory session.update ACK (REREV-01). */
const SESSION_READY_TIMEOUT_MS = 5_000;
/** Bounded timeout for the provider hangup (REREV-02). */
const HANGUP_TIMEOUT_MS = 3_000;
/** R6 (SB04-R5-REREV-02): bounded ACK deadline for a sent `response.create` — if no
 *  `response.created` binds within it the whole provider session is terminated, so a
 *  late response.created can never attach to a later request. A code constant, NOT an
 *  env var (the packet forbids adding env for this). */
const RESPONSE_CREATED_ACK_MS = 10_000;

/**
 * R3 (REREV-08B): read a fetch response body bounded by BYTES — content-length
 * precheck, then an incremental streamed read that aborts once the cap is crossed.
 * Falls back to a byte-gated text() for fakes without a stream. Returns null over cap.
 */
async function readBoundedAnswer(res: RealtimeFetchResponse, maxBytes: number, signal?: AbortSignal): Promise<string | null> {
  const cl = res.headers.get("content-length");
  if (cl && Number(cl) > maxBytes) return null;
  const reader = res.body?.getReader?.();
  if (reader) {
    // R4 (SB04-R3-REREV-06): the create-call deadline covers the BODY read. When the
    // deadline aborts, cancel the reader EXPLICITLY (never rely on native fetch tearing
    // it down) so a stalled body leaves no dangling read.
    let abortCancelled = false;
    const onAbort = () => {
      abortCancelled = true;
      try {
        void reader.cancel?.();
      } catch {
        /* no-op */
      }
    };
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }
    try {
      const chunks: Uint8Array[] = [];
      let total = 0;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        if (signal?.aborted || abortCancelled) return null;
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          total += value.byteLength;
          if (total > maxBytes) {
            try {
              await reader.cancel?.();
            } catch {
              /* no-op */
            }
            return null;
          }
          chunks.push(value);
        }
      }
      return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8");
    } finally {
      if (signal) signal.removeEventListener("abort", onAbort);
    }
  }
  const text = await res.text();
  if (typeof text !== "string" || Buffer.byteLength(text, "utf8") > maxBytes) return null;
  return text;
}

/**
 * R3 (REREV-01): build the CURRENT official multipart/form-data create-call body —
 * an `sdp` part (application/sdp) + a `session` part (application/json carrying the
 * fixed session type/model/tools). Returns the body string + the exact content-type
 * (with boundary). The caller supplies NO url/model/tool override — all fixed here.
 */
export function buildCreateCallMultipart(offerSdp: string, model: string): { contentType: string; body: string } {
  const boundary = `----staybidvoice${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  const session = JSON.stringify({
    type: "realtime",
    model,
    tools: FIXED_TOOL_DEFINITIONS,
    tool_choice: "auto",
    // R4 (REREV-03): the provider must NEVER auto-create a response — inference is
    // triggered only by the gateway's reservation-gated `response.create`.
    audio: { input: { turn_detection: FIXED_TURN_DETECTION } },
  });
  const CRLF = "\r\n";
  const body =
    `--${boundary}${CRLF}` +
    `Content-Disposition: form-data; name="sdp"${CRLF}` +
    `Content-Type: application/sdp${CRLF}${CRLF}` +
    `${offerSdp}${CRLF}` +
    `--${boundary}${CRLF}` +
    `Content-Disposition: form-data; name="session"${CRLF}` +
    `Content-Type: application/json${CRLF}${CRLF}` +
    `${session}${CRLF}` +
    `--${boundary}--${CRLF}`;
  return { contentType: `multipart/form-data; boundary=${boundary}`, body };
}

export interface RealtimeTransportDeps {
  /** Server-only OpenAI API key — NEVER a browser secret. */
  apiKey: string;
  fetchImpl: RealtimeFetch;
  WebSocketCtor: ServerWsCtor;
  now?: () => number;
  /** R6 (SB04-R5-REREV-02): the response.created ACK deadline (ms). Defaults to the
   *  fixed RESPONSE_CREATED_ACK_MS; injectable ONLY so tests can exercise the timeout
   *  fast — it is NOT an env var and production always uses the default. */
  responseAckMs?: number;
}

/**
 * Translate ONE raw OpenAI Realtime event into the closed gateway ProviderEvent,
 * or null. Only the minimal, safe mappings are recognized; everything else is
 * ignored (fail closed). The raw object is NEVER trusted beyond this projection.
 */
export function translateOpenAiEvent(raw: unknown): ProviderEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const e = raw as Record<string, unknown>;
  const type = typeof e.type === "string" ? e.type : "";
  const rid = typeof e.response_id === "string" ? e.response_id : undefined;

  // R2 (REREV-04): a response START — establishes the StayBid turn that owns it.
  // R6 (SB04-R5-REREV-02): carry the ECHOED non-secret `request_id` from
  // response.metadata (documented — response metadata is returned on the response
  // lifecycle events) so the serialized scheduler can bind exactly its one outstanding
  // request. A missing/other metadata is caught by the scheduler (fail closed).
  if (type === "response.created") {
    const resp = e.response as { id?: unknown; metadata?: unknown } | undefined;
    const responseId = resp && typeof resp.id === "string" ? resp.id : "";
    const meta = (resp && resp.metadata && typeof resp.metadata === "object" ? resp.metadata : {}) as Record<string, unknown>;
    const requestId = typeof meta.request_id === "string" ? meta.request_id : undefined;
    return validateProviderEvent({ kind: "response_begin", responseId, requestId });
  }
  // R2/R3/R6 (REREV-03 / R5-REREV-02): response.done is ALWAYS a lifecycle-TERMINAL
  // event so the serialized slot can free itself even when usage is missing/malformed.
  // Usage is attached ONLY when trustworthy; an absent/malformed usage keeps the
  // conservative reservation charged (the schema drops the usage sub-object) while the
  // response still becomes terminal/sealed.
  if (type === "response.done") {
    const resp = (e.response || {}) as { id?: unknown; usage?: unknown };
    const responseId = typeof resp.id === "string" ? resp.id : rid;
    const base: Record<string, unknown> = { kind: "response_done", responseId };
    if (resp.usage && typeof resp.usage === "object") {
      const u = resp.usage as Record<string, unknown>;
      const inDet = (u.input_token_details || {}) as Record<string, unknown>;
      const outDet = (u.output_token_details || {}) as Record<string, unknown>;
      const cachedDet = (inDet.cached_tokens_details || {}) as Record<string, unknown>;
      const num = (x: unknown): number | undefined => {
        const n = typeof x === "number" ? x : typeof x === "string" ? Number(x) : NaN;
        return Number.isFinite(n) && n >= 0 ? Math.floor(n) : undefined;
      };
      const fullInText = num(inDet.text_tokens);
      const fullInAudio = num(inDet.audio_tokens);
      const cachedInText = num(cachedDet.text_tokens);
      const cachedInAudio = num(cachedDet.audio_tokens);
      const nonCachedText = fullInText === undefined ? undefined : Math.max(0, fullInText - (cachedInText ?? 0));
      const nonCachedAudio = fullInAudio === undefined ? undefined : Math.max(0, fullInAudio - (cachedInAudio ?? 0));
      base.inputTextTokens = nonCachedText;
      base.cachedInputTextTokens = cachedInText;
      base.outputTextTokens = num(outDet.text_tokens);
      base.inputAudioTokens = nonCachedAudio;
      base.cachedInputAudioTokens = cachedInAudio;
      base.outputAudioTokens = num(outDet.audio_tokens);
    }
    return validateProviderEvent(base);
  }
  // R2 (REREV-01): a completed input-audio transcription → display-only transcript.
  if (type === "conversation.item.input_audio_transcription.completed" && typeof e.transcript === "string") {
    return validateProviderEvent({ kind: "transcript", role: "user", text: e.transcript, responseId: rid });
  }
  // A tool/function call → tool_call (the four read tools only; schema re-checks).
  if (type === "response.function_call_arguments.done") {
    const name = typeof e.name === "string" ? e.name : "";
    const callId = typeof e.call_id === "string" ? e.call_id : typeof e.item_id === "string" ? e.item_id : "";
    let input: unknown = {};
    if (typeof e.arguments === "string") {
      try {
        input = JSON.parse(e.arguments);
      } catch {
        return null;
      }
    }
    return validateProviderEvent({ kind: "tool_call", callId, tool: name, input, responseId: rid });
  }
  // R3 (REREV-01): the CURRENT authoritative assistant OUTPUT transcript event is
  // `response.output_audio_transcript.done` (carries `transcript`). Map it to the
  // display answer. `response.output_text.done` is kept as a secondary fallback for
  // a text-only response.
  if (type === "response.output_audio_transcript.done" && typeof e.transcript === "string") {
    return validateProviderEvent({ kind: "answer", text: e.transcript, responseId: rid });
  }
  if (type === "response.output_text.done" && typeof e.text === "string") {
    return validateProviderEvent({ kind: "answer", text: e.text, responseId: rid });
  }
  // R4 (SB04-R3-REREV-11): the invented `staybid.ui_action` provider event is
  // REMOVED. UI navigation proposals now arrive ONLY through the DOCUMENTED
  // function-call path of an EXISTING tool (getHotelDetails with the closed
  // optional `presentationIntent:"OPEN"` enum) — see the sideband's tool_call
  // handling. No made-up provider event type exists.
  return null;
}

// The FIXED four read-tool definitions the gateway sends via `session.update`. The
// provider can propose ONLY these; there is no fifth business tool. Definitions are
// intentionally minimal (name + bounded params) — no url/method/header field.
// R4 (SB04-R3-REREV-11): getHotelDetails carries a CLOSED optional navigation-intent
// enum (`presentationIntent: "OPEN"`), so an "open the second one" intent flows
// through the DOCUMENTED function-call path of an EXISTING tool — the fixed trusted
// read still runs first, the gateway then proposes typed OPEN_HOTEL, and the frozen
// SB-01 browser dispatcher revalidates. Still exactly four tools; no write surface.
export const FIXED_TOOL_DEFINITIONS = Object.freeze([
  { type: "function", name: "searchHotels", description: "Search the visible hotel catalogue.", parameters: { type: "object", properties: { city: { type: "string" }, q: { type: "string" } }, additionalProperties: false } },
  { type: "function", name: "getHotelDetails", description: "Get details for one allowlisted hotel. Set presentationIntent to OPEN to also open that hotel's page for the user.", parameters: { type: "object", properties: { id: { type: "string" }, presentationIntent: { type: "string", enum: ["OPEN"] } }, required: ["id"], additionalProperties: false } },
  { type: "function", name: "getFlashDeals", description: "Get current flash deals, optionally by city.", parameters: { type: "object", properties: { city: { type: "string" } }, additionalProperties: false } },
  { type: "function", name: "compareHotels", description: "Compare allowlisted hotels.", parameters: { type: "object", properties: { hotelIds: { type: "array", items: { type: "string" }, maxItems: 3 } }, required: ["hotelIds"], additionalProperties: false } },
]);

// ═══ R4 (SB04-R3-REREV-01): EFFECTIVE session.updated validation ═══════════════
// The official `session.updated` event echoes the FULL EFFECTIVE configuration.
// Readiness must PROVE the provider session really carries our contract — a bare
// {"type":"session.updated"} is NOT readiness. This validator canonicalizes and
// semantically compares the effective config against the fixed contract:
//   • session.type === "realtime";
//   • session.model === expected model WHEN the event exposes a model;
//   • tool_choice === "auto";
//   • EXACTLY the four approved tools — exact names, type "function", exact
//     parameter property sets (name + type + enum + items.type + maxItems), exact
//     required arrays, additionalProperties === false; no missing/extra/renamed
//     tool, no loosened schema;
//   • when a turn_detection object is exposed (session.turn_detection or
//     session.audio.input.turn_detection), create_response MUST be false — the
//     R4-03 reservation gate depends on the provider never auto-starting a
//     response.
function canonProps(props: unknown): string | null {
  if (!props || typeof props !== "object" || Array.isArray(props)) return null;
  const out: Record<string, unknown> = {};
  const keys = Object.keys(props as Record<string, unknown>).sort();
  for (const k of keys) {
    const p = (props as Record<string, unknown>)[k];
    if (!p || typeof p !== "object") return null;
    const pd = p as Record<string, unknown>;
    const c: Record<string, unknown> = { type: pd.type };
    if (Array.isArray(pd.enum)) c.enum = [...(pd.enum as unknown[])].sort();
    if (pd.items && typeof pd.items === "object") c.items = { type: (pd.items as Record<string, unknown>).type };
    if (pd.maxItems !== undefined) c.maxItems = pd.maxItems;
    out[k] = c;
  }
  return JSON.stringify(out);
}
function canonTool(t: unknown): string | null {
  if (!t || typeof t !== "object") return null;
  const tool = t as Record<string, unknown>;
  if (tool.type !== "function" || typeof tool.name !== "string") return null;
  const params = tool.parameters as Record<string, unknown> | undefined;
  if (!params || typeof params !== "object") return null;
  if (params.type !== "object") return null;
  if (params.additionalProperties !== false) return null; // loosened policy ⇒ invalid
  const props = canonProps(params.properties);
  if (props === null) return null;
  const required = Array.isArray(params.required) ? [...(params.required as unknown[])].sort() : [];
  return JSON.stringify({ name: tool.name, props, required });
}
export function validateEffectiveSession(sessionObj: unknown, expectedModel: string): boolean {
  if (!sessionObj || typeof sessionObj !== "object") return false;
  const s = sessionObj as Record<string, unknown>;
  if (s.type !== "realtime") return false;
  if (s.model !== undefined && s.model !== expectedModel) return false;
  if (s.tool_choice !== "auto") return false;
  const tools = s.tools;
  if (!Array.isArray(tools) || tools.length !== FIXED_TOOL_DEFINITIONS.length) return false;
  const expected = FIXED_TOOL_DEFINITIONS.map((t) => canonTool(t));
  const got = tools.map((t) => canonTool(t));
  if (got.some((g) => g === null)) return false;
  const expSorted = [...expected].sort();
  const gotSorted = [...(got as string[])].sort();
  if (expSorted.length !== gotSorted.length || expSorted.some((e2, i) => e2 !== gotSorted[i])) return false;
  // R5 (SB04-R4-REREV-01): PROVE the COMPLETE manual server-VAD contract on the
  // returned effective session — do NOT merely accept "create_response is not true".
  // Per current official OpenAI Realtime docs (accessed 2026-08-28,
  // https://developers.openai.com/api/docs/guides/realtime-vad), the effective
  // turn_detection lives at the DOCUMENTED location audio.input.turn_detection and,
  // for the manual (no auto-response) server-VAD mode StayBid configures, must carry
  //   type === "server_vad", create_response === false, interrupt_response === false.
  // A missing audio / audio.input / turn_detection, a null turn_detection, a wrong
  // type (e.g. semantic_vad), or create_response/interrupt_response absent-or-true
  // all FAIL readiness closed. Only the documented location is accepted (no silent
  // alternative-location or invented-compatibility acceptance).
  const audio = s.audio;
  if (!audio || typeof audio !== "object") return false;
  const audioIn = (audio as Record<string, unknown>).input;
  if (!audioIn || typeof audioIn !== "object") return false;
  const td = (audioIn as Record<string, unknown>).turn_detection;
  if (!td || typeof td !== "object") return false; // missing/null turn_detection ⇒ reject
  const tdo = td as Record<string, unknown>;
  if (tdo.type !== "server_vad") return false;
  if (tdo.create_response !== false) return false; // absent or true ⇒ reject
  if (tdo.interrupt_response !== false) return false; // absent or true ⇒ reject
  return true;
}

// The FIXED turn-detection config (R4-03): VAD events stay ON, but the provider
// NEVER auto-creates a response — the gateway triggers `response.create` only
// after a successful cost reservation. Sent at create AND via session.update.
export const FIXED_TURN_DETECTION = Object.freeze({
  type: "server_vad",
  create_response: false,
  interrupt_response: false,
});

/**
 * R3 (REREV-02): end an active Realtime call with the CURRENT SUPPORTED hangup
 * operation — POST /v1/realtime/calls/{call_id}/hangup (Bearer server key), bounded
 * by a timeout. Never blocks indefinitely, never fabricates success, never logs the
 * key/URL/headers. A failed hangup does NOT reanimate local state (the caller has
 * already torn everything down); the returned boolean is advisory only.
 */
export async function hangupProviderCall(
  fetchImpl: RealtimeFetch,
  baseUrl: string,
  apiKey: string,
  callId: string,
): Promise<boolean> {
  if (!callId) return false;
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), HANGUP_TIMEOUT_MS);
  try {
    const res = await fetchImpl(`${baseUrl}/calls/${encodeURIComponent(callId)}/hangup`, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}` },
      body: "",
      signal: controller.signal,
      redirect: "error",
    });
    // A 2xx, or a documented "already ended" (404/409/410), is a safe terminal state.
    return res.ok || res.status === 404 || res.status === 409 || res.status === 410;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

/** Build the real transport. Available only when the server API key is present. */
export function createOpenAiRealtimeTransport(deps: RealtimeTransportDeps): RealtimeTransport {
  return {
    isAvailable(config: GatewayConfig): boolean {
      return providerConfigured(config) && Boolean(deps.apiKey);
    },
    async createSession(input): Promise<
      | { ok: true; answerSdp: string; providerSessionId: string; sideband: SidebandConnection }
      | { ok: false; code: RealtimeErrorCode }
    > {
      const connectMs = Number.isFinite(input.connectTimeoutMs) && input.connectTimeoutMs > 0 ? input.connectTimeoutMs : 5_000;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), connectMs);
      let res: RealtimeFetchResponse;
      try {
        // R3 (REREV-01): CURRENT official create-call contract — POST /v1/realtime/calls
        // with multipart/form-data (sdp + session JSON incl. type/model/tools). The
        // model + tools live in the fixed `session` part; the caller overrides nothing.
        const multipart = buildCreateCallMultipart(input.offerSdp, input.model);
        res = await deps.fetchImpl(`${input.baseUrl}/calls`, {
          method: "POST",
          headers: {
            "content-type": multipart.contentType,
            authorization: `Bearer ${deps.apiKey}`,
          },
          body: multipart.body,
          signal: controller.signal,
          // REREV-07: never follow a redirect carrying the bearer key to another origin.
          redirect: "error",
        });
      } catch (err: unknown) {
        clearTimeout(timer);
        const name = err && typeof err === "object" ? (err as { name?: string }).name : "";
        return { ok: false, code: name === "AbortError" ? "provider_timeout" : "provider_unavailable" };
      }
      // R4 (SB04-R3-REREV-06): the create-call deadline is NOT cleared at headers —
      // it stays armed THROUGH the body read, so a stalled answer body cannot hang
      // forever. The abort controller cancels the body reader on timeout.
      if (res.status === 429) {
        clearTimeout(timer);
        return { ok: false, code: "provider_rate_limited" };
      }
      if (!res.ok) {
        clearTimeout(timer);
        return { ok: false, code: "provider_rejected" };
      }
      // R2 (REREV-01): the REAL provider call id comes from the Location HEADER —
      // extracted BEFORE the body read so a body-stall cleanup can still hang up
      // the partially-created call. NO synthetic fallback.
      const location = res.headers.get("location") || "";
      const providerSessionId =
        /\/calls\/([A-Za-z0-9_.:-]+)/.exec(location)?.[1] ||
        (/^[A-Za-z0-9_.:-]+$/.test(location.trim()) ? location.trim() : "");
      // Bounded body read RACED against the still-armed lifecycle deadline: the
      // deadline fires → controller.abort() → the reader race resolves null.
      let answerSdp: string | null = null;
      let bodyTimedOut = false;
      try {
        answerSdp = await new Promise<string | null>((resolve) => {
          let settled = false;
          const settle = (v: string | null) => {
            if (settled) return;
            settled = true;
            resolve(v);
          };
          const onAbort = () => {
            bodyTimedOut = true;
            settle(null);
          };
          controller.signal.addEventListener("abort", onAbort, { once: true });
          readBoundedAnswer(res, MAX_ANSWER_SDP_BYTES, controller.signal)
            .then((v) => settle(v))
            .catch(() => settle(null));
        });
      } catch {
        answerSdp = null;
      } finally {
        clearTimeout(timer);
      }
      if (typeof answerSdp !== "string" || !/^v=0/m.test(answerSdp)) {
        // A stalled/oversized/malformed body: clean up the partial provider call
        // when its id is known (supported hangup), then fail closed — no sideband,
        // no browser success.
        if (providerSessionId) {
          try {
            void hangupProviderCall(deps.fetchImpl, input.baseUrl, deps.apiKey, providerSessionId);
          } catch {
            /* no-op */
          }
        }
        return { ok: false, code: bodyTimedOut ? "provider_timeout" : "malformed_answer" };
      }
      if (!providerSessionId) return { ok: false, code: "malformed_answer" };

      // Private server-side sideband — the authoritative tool surface — bound to the
      // REAL call id: wss://<api-origin>/v1/realtime?call_id=<callId> (Bearer server key).
      let listener: ((ev: ProviderEvent) => void) | null = null;
      let speechListener: ((phase: "start" | "stop", itemId: string) => void) | null = null;
      let commitListener: ((itemId: string) => void) | null = null;
      let ws: ServerWsLike | null = null;
      // R6 (SB04-R5-REREV-02): the response.created ACK deadline for the single
      // outstanding `response.create`. Armed by requestResponse(), cleared on the
      // matching response.created (or on close/termination), and on timeout fires the
      // fatal path so a late response.created can never bind to future work.
      let respCreateTimer: ReturnType<typeof setTimeout> | null = null;
      const clearRespCreateTimer = () => {
        if (respCreateTimer) {
          clearTimeout(respCreateTimer);
          respCreateTimer = null;
        }
      };
      const wsBase = input.baseUrl.replace(/^http/, "ws");
      const sidebandUrl = `${wsBase}?call_id=${encodeURIComponent(providerSessionId)}`;

      // R3 (REREV-01): the readiness gate. Provider readiness is NOT "socket open" —
      // the FIXED four-tool `session.update` must be sent AND explicitly acknowledged
      // by the current official `session.updated` event within a bounded timeout. The
      // whole session FAILS CLOSED on: ctor throw, error event, close-before-ready,
      // send throw, a provider `error` event, or ack timeout.
      let ready = false; // becomes true only after a VALIDATED session.updated
      // R4 (REREV-02): post-ready fatal lifecycle. An UNEXPECTED ws error/close or a
      // provider fatal error AFTER readiness fires the fatal listener exactly once;
      // an intentional local close()/hangup never does (no recursive termination).
      type FatalReason = "socket_error" | "socket_closed" | "provider_error" | "response_timeout";
      let fatalListener: ((reason: FatalReason) => void) | null = null;
      let intentionalClose = false;
      let fatalFired = false; // a fatal has occurred (terminal — first one wins)
      let fatalDelivered = false; // the ONE delivery has happened
      // R5 (SB04-R4-REREV-03): LATCH the fatal reason. A fatal that occurs AFTER
      // readiness but BEFORE the gateway registered onFatal must NEVER be lost — it is
      // retained here and delivered immediately (exactly once) when onFatal(cb) binds.
      let pendingFatalReason: FatalReason | null = null;
      const deliverFatal = (reason: FatalReason) => {
        if (fatalDelivered) return; // exactly one delivery ever
        fatalDelivered = true;
        try {
          fatalListener?.(reason);
        } catch {
          /* a throwing consumer callback can never re-enable or duplicate delivery */
        }
      };
      const fireFatal = (reason: FatalReason) => {
        if (!ready || intentionalClose || fatalFired) return; // first fatal wins; never after an intentional close
        fatalFired = true;
        clearRespCreateTimer(); // R6: no orphan ACK timer survives a fatal
        if (fatalListener) deliverFatal(reason);
        else pendingFatalReason = reason; // latch until onFatal binds
      };
      // R4 (REREV-10): pending ordinal-context ack (client-supplied item id).
      let pendingCtxAck: { id: string; resolve: (ok: boolean) => void } | null = null;
      let settleReady: ((v: { ok: true } | { ok: false; code: RealtimeErrorCode }) => void) | null = null;
      const readyResult = await new Promise<{ ok: true } | { ok: false; code: RealtimeErrorCode }>((resolve) => {
        let settled = false;
        const done = (v: { ok: true } | { ok: false; code: RealtimeErrorCode }) => {
          if (settled) return;
          settled = true;
          resolve(v);
        };
        settleReady = done;
        const readyTimer = setTimeout(() => done({ ok: false, code: "provider_timeout" }), Math.min(connectMs, SESSION_READY_TIMEOUT_MS));
        if (readyTimer && typeof (readyTimer as { unref?: () => void }).unref === "function") {
          (readyTimer as { unref?: () => void }).unref!();
        }
        const clearReady = () => clearTimeout(readyTimer);
        try {
          ws = deps.WebSocketCtor(sidebandUrl, {
            headers: { authorization: `Bearer ${deps.apiKey}`, "openai-beta": "realtime=v1" },
          });
        } catch {
          clearReady();
          done({ ok: false, code: "provider_unavailable" });
          return;
        }
        ws.on("open", () => {
          try {
            // Install the FIXED four tools + manual-response turn detection on the
            // authoritative session, then await the VALIDATED effective ack.
            ws!.send(
              JSON.stringify({
                type: "session.update",
                session: {
                  type: "realtime",
                  tools: FIXED_TOOL_DEFINITIONS,
                  tool_choice: "auto",
                  audio: { input: { turn_detection: FIXED_TURN_DETECTION } },
                },
              }),
            );
          } catch {
            clearReady();
            done({ ok: false, code: "provider_unavailable" }); // send threw ⇒ fail closed
          }
        });
        ws.on("error", () => {
          if (!ready) {
            clearReady();
            done({ ok: false, code: "provider_unavailable" });
            return;
          }
          // R4 (REREV-02): a post-ready socket error is FATAL to the live session.
          try {
            pendingCtxAck?.resolve(false);
          } catch {
            /* no-op */
          }
          pendingCtxAck = null;
          fireFatal("socket_error");
        });
        ws.on("close", () => {
          if (!ready) {
            clearReady();
            done({ ok: false, code: "provider_unavailable" });
            return;
          }
          // R4 (REREV-02): an UNEXPECTED post-ready close is FATAL; an intentional
          // local close()/hangup is not a second failure.
          try {
            pendingCtxAck?.resolve(false);
          } catch {
            /* no-op */
          }
          pendingCtxAck = null;
          fireFatal("socket_closed");
        });
        // The single message handler — runs during the ack gate AND the live session.
        ws.on("message", (data?: unknown) => {
          const text = typeof data === "string" ? data : data && typeof (data as { toString?: unknown }).toString === "function" ? String(data) : "";
          if (!text || Buffer.byteLength(text, "utf8") > 64 * 1024) return; // bounded ingest (UTF-8 bytes)
          let parsed: unknown;
          try {
            parsed = JSON.parse(text);
          } catch {
            return;
          }
          const t = (parsed as { type?: unknown })?.type;
          // Readiness ACK — R4 (SB04-R3-REREV-01): a bare session.updated is NOT
          // readiness. The event's EFFECTIVE session object must semantically prove
          // the contract (type/model/tool_choice/EXACT four tool schemas/manual
          // response mode). An invalid effective config FAILS the session closed.
          if (!ready && t === "session.updated") {
            const eff = (parsed as { session?: unknown }).session;
            if (!validateEffectiveSession(eff, input.model)) {
              clearReady();
              done({ ok: false, code: "provider_rejected" });
              return;
            }
            ready = true;
            clearReady();
            done({ ok: true });
            return;
          }
          // A provider error during the ack window fails the session closed.
          if (!ready && t === "error") {
            clearReady();
            done({ ok: false, code: "provider_rejected" });
            return;
          }
          // R4 (REREV-02): a post-ready provider FATAL error terminates the session.
          if (ready && t === "error") {
            try {
              pendingCtxAck?.resolve(false);
            } catch {
              /* no-op */
            }
            pendingCtxAck = null;
            fireFatal("provider_error");
            return;
          }
          // R4 (REREV-10): the documented ack for conversation.item.create — the
          // server echoes the item (with our client-supplied id).
          if (t === "conversation.item.created" && pendingCtxAck) {
            const item = (parsed as { item?: { id?: unknown } }).item;
            if (item && item.id === pendingCtxAck.id) {
              const p = pendingCtxAck;
              pendingCtxAck = null;
              p.resolve(true);
            }
            return;
          }
          // R5/R6 (SB04-R4-REREV-02 / R5-REREV-01): speech boundaries and the COMMIT
          // boundary are DISTINCT and every VAD event carries the provider `item_id`
          // (the same id spans speech_started → speech_stopped → committed for one
          // utterance). speech_started/speech_stopped only drive the utterance-duration
          // timer; input_audio_buffer.committed is the authoritative once-per-utterance
          // boundary and the ONLY trigger for reserve→response. A malformed/absent item
          // id is passed through verbatim ("" when absent) — the gateway validates it
          // strictly and fails closed on a missing/malformed id.
          const vadItemId = typeof (parsed as { item_id?: unknown }).item_id === "string" ? ((parsed as { item_id?: string }).item_id as string) : "";
          if (t === "input_audio_buffer.speech_started" && speechListener) speechListener("start", vadItemId);
          else if (t === "input_audio_buffer.speech_stopped" && speechListener) speechListener("stop", vadItemId);
          else if (t === "input_audio_buffer.committed" && commitListener) commitListener(vadItemId);
          // R7 (SB04-R6-REREV-02): a raw `response.created` NO LONGER clears the ACK deadline here.
          // The deadline is cleared ONLY once the serialized scheduler AUTHORITATIVELY binds this
          // response.created to its one outstanding reservation and calls `notifyResponseBound()`
          // (below). An unrequested / mismatched / unbindable response.created therefore leaves the
          // deadline armed so it still fires the fail-closed timeout.
          const ev = translateOpenAiEvent(parsed);
          if (ev && listener) listener(ev);
        });
      });
      const wsRef = ws as ServerWsLike | null;
      if (!readyResult.ok) {
        try {
          wsRef?.close(1011);
        } catch {
          /* no-op */
        }
        // Best-effort hang up the partially-created provider call (no dangling call).
        try {
          void hangupProviderCall(deps.fetchImpl, input.baseUrl, deps.apiKey, providerSessionId);
        } catch {
          /* no-op */
        }
        return { ok: false, code: readyResult.code };
      }
      void settleReady; // referenced for lifetime clarity
      const sideband: SidebandConnection = {
        onEvent(cb) {
          listener = cb;
        },
        onSpeech(cb) {
          speechListener = cb;
        },
        onCommit(cb) {
          commitListener = cb;
        },
        onFatal(cb) {
          fatalListener = cb;
          // R5 (SB04-R4-REREV-03): deliver a fatal that already latched before this
          // registration — immediately, exactly once.
          if (pendingFatalReason !== null && !fatalDelivered) {
            const r = pendingFatalReason;
            pendingFatalReason = null;
            deliverFatal(r);
          }
        },
        sendToolResult(payload) {
          try {
            // Bounded serialized result data (the executor already caps its bytes).
            let dataStr = "";
            try {
              // REREV-06: bound by UTF-8 BYTES (the executor already caps upstream).
              const s = payload.data !== undefined ? JSON.stringify(payload.data) : "";
              dataStr = Buffer.byteLength(s, "utf8") <= 8 * 1024 ? s : "";
            } catch {
              dataStr = "";
            }
            ws?.send(
              JSON.stringify({
                type: "conversation.item.create",
                item: {
                  type: "function_call_output",
                  call_id: payload.callId,
                  output: JSON.stringify({ ok: payload.ok, count: payload.count, reason: payload.reason, data: dataStr }),
                },
              }),
            );
            // R4 (REREV-03): NO automatic `response.create` here — a function-call
            // continuation is inference and must be reservation-gated: the gateway
            // calls requestResponse() only after a successful reservation.
          } catch {
            /* no-op */
          }
        },
        requestResponse(requestId?: string) {
          // R4 (REREV-03): the ONLY place inference is triggered. The provider session
          // runs with create_response:false, so without this call (i.e. without a
          // successful reservation) no response work ever starts.
          // R6 (SB04-R5-REREV-02): set the server-generated non-secret request id on
          // response.metadata.request_id (echoed at response.created for defense-in-depth
          // ownership) AND arm the response.created ACK deadline. A send throw returns
          // false WITHOUT arming a timer (the scheduler fails the session closed).
          try {
            const payload: { type: string; response?: { metadata: { request_id: string } } } = { type: "response.create" };
            if (typeof requestId === "string" && requestId) payload.response = { metadata: { request_id: requestId } };
            ws?.send(JSON.stringify(payload));
            // Arm exactly one ACK deadline (a prior one is cleared first — serialized).
            clearRespCreateTimer();
            respCreateTimer = setTimeout(() => {
              respCreateTimer = null;
              // No response.created bound in time → terminate the whole session.
              fireFatal("response_timeout");
            }, deps.responseAckMs && deps.responseAckMs > 0 ? deps.responseAckMs : RESPONSE_CREATED_ACK_MS);
            if (typeof (respCreateTimer as { unref?: () => void }).unref === "function") {
              (respCreateTimer as { unref?: () => void }).unref!();
            }
            return true;
          } catch {
            clearRespCreateTimer();
            return false;
          }
        },
        notifyResponseBound() {
          // R7 (SB04-R6-REREV-02): the scheduler authoritatively bound the single outstanding
          // response.created → clear its ACK deadline (serialized: exactly one can be outstanding).
          clearRespCreateTimer();
        },
        sendContext(items, ackTimeoutMs = 4_000) {
          // R4 (REREV-10): STRUCTURED context with an AWAITED documented ack —
          // conversation.item.create carrying OUR item id, acknowledged by the
          // server's conversation.item.created echoing that id. Any failure (send
          // throw, no socket, timeout, socket death) resolves FALSE — never a
          // silent ordinal-capable success.
          return new Promise<boolean>((resolve) => {
            let settled = false;
            const settle = (ok: boolean) => {
              if (settled) return;
              settled = true;
              resolve(ok);
            };
            try {
              const safe = (Array.isArray(items) ? items : [])
                .slice(0, 24)
                .filter((it) => it && Number.isFinite(it.ordinal) && /^[A-Za-z0-9_-]{1,64}$/.test(String(it.id)))
                .map((it) => ({ ordinal: Math.floor(it.ordinal), id: String(it.id) }));
              if (!safe.length || !ws) return settle(false);
              const payload = JSON.stringify({ visibleHotels: safe });
              if (Buffer.byteLength(payload, "utf8") > 8 * 1024) return settle(false);
              const itemId = `ctxitem_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
              const ackTimer = setTimeout(() => {
                if (pendingCtxAck && pendingCtxAck.id === itemId) pendingCtxAck = null;
                settle(false);
              }, Math.max(250, ackTimeoutMs));
              if (typeof (ackTimer as { unref?: () => void }).unref === "function") {
                (ackTimer as { unref?: () => void }).unref!();
              }
              pendingCtxAck = {
                id: itemId,
                resolve: (ok: boolean) => {
                  clearTimeout(ackTimer);
                  settle(ok);
                },
              };
              ws.send(
                JSON.stringify({
                  type: "conversation.item.create",
                  item: { id: itemId, type: "message", role: "system", content: [{ type: "input_text", text: payload }] },
                }),
              );
            } catch {
              pendingCtxAck = null;
              settle(false);
            }
          });
        },
        cancelTurn() {
          try {
            ws?.send(JSON.stringify({ type: "response.cancel" }));
          } catch {
            /* no-op */
          }
        },
        close() {
          // Intentional local termination — never re-fires the fatal path (REREV-02).
          intentionalClose = true;
          clearRespCreateTimer(); // R6: no orphan ACK timer survives an intentional close
          try {
            pendingCtxAck?.resolve(false);
          } catch {
            /* no-op */
          }
          pendingCtxAck = null;
          try {
            ws?.close(1000);
          } catch {
            /* no-op */
          }
          // R3 (REREV-02): terminate the provider call via the SUPPORTED hangup
          // (bounded; never blocks the caller; never logs; failure never reanimates).
          try {
            void hangupProviderCall(deps.fetchImpl, input.baseUrl, deps.apiKey, providerSessionId);
          } catch {
            /* no-op */
          }
        },
      };
      return { ok: true, answerSdp, providerSessionId, sideband };
    },
  };
}
