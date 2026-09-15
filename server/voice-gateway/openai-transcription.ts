// ─────────────────────────────────────────────────────────────────────────
// StayBid Live AI — LIVE-AI-02A — STT adapter (dormant, fake-seam).
//
// A FIXED speech-to-text seam. The DEFAULT export is UNAVAILABLE / fail-closed and
// touches no network. A real adapter is constructed ONLY with an INJECTED transport
// call (no fetch/URL/API-key lives in this module) and ONLY for the single allowed
// model — any other model disables it. MODEL != AUTHORITY: it returns inert, bounded
// transcript DATA, never an operation, endpoint, or write.
// ─────────────────────────────────────────────────────────────────────────
import { type LiveAiLanguage } from "./live-ai-schemas";

export const STT_MODEL = "gpt-live-transcribe" as const;
export const MAX_TRANSCRIPT_BYTES = 4_000;

export type TranscriptionResult =
  | { ok: true; text: string; language: LiveAiLanguage }
  | { ok: false; reason: string };

export interface TranscriptionInput {
  /** opaque, bounded audio reference (never raw audio persisted here). */
  audioRef?: string;
  /** already-textual turn (text mode) passed straight through, bounded. */
  text?: string;
  languageHint?: LiveAiLanguage;
}
/** REV-03 — WebRTC Realtime SDP negotiation. The browser owns the mic + peer; the
 *  gateway exchanges the bounded SDP offer for the provider's answer (Realtime model)
 *  and relays ONLY the bounded answer back. Fail-closed by default (no answer ⇒ mic
 *  unsupported at the browser). */
export type RealtimeNegotiation =
  | { ok: true; answerSdp: string }
  | { ok: false; reason: string };
export const MAX_SDP_BYTES = 20 * 1024;

export interface TranscriptionAdapter {
  readonly available: boolean;
  readonly model: string;
  transcribe(input: TranscriptionInput): Promise<TranscriptionResult>;
  /** Exchange a bounded SDP offer for the provider's bounded SDP answer. */
  negotiate(offerSdp: string, opts?: { signal?: AbortSignal; deadlineMs?: number }): Promise<RealtimeNegotiation>;
}

/** The injected network seams — the ONLY place a real call could happen. Tests and
 *  the dormant build never provide a real one. */
export type TranscriptionCall = (input: TranscriptionInput) => Promise<TranscriptionResult>;
export type NegotiateCall = (offerSdp: string, opts?: { signal?: AbortSignal; deadlineMs?: number }) => Promise<RealtimeNegotiation>;

export const unavailableTranscription: TranscriptionAdapter = Object.freeze({
  available: false,
  model: STT_MODEL,
  async transcribe(): Promise<TranscriptionResult> {
    return { ok: false, reason: "transcription_unavailable" };
  },
  async negotiate(): Promise<RealtimeNegotiation> {
    return { ok: false, reason: "realtime_unavailable" };
  },
});

function boundedSdp(v: unknown): string | null {
  if (typeof v !== "string" || !v || v.length > MAX_SDP_BYTES) return null;
  // an SDP answer is a text blob beginning with "v=0"; a minimal sanity gate.
  if (!/^v=0/.test(v)) return null;
  return v;
}

/** Build a fixed-model transcription/realtime adapter over injected calls. A model
 *  other than the single allowlisted STT model disables it (fail closed). */
export function createTranscriptionAdapter(deps: { model?: string; call: TranscriptionCall; negotiate?: NegotiateCall }): TranscriptionAdapter {
  if ((deps.model || STT_MODEL) !== STT_MODEL || typeof deps.call !== "function") return unavailableTranscription;
  return Object.freeze({
    available: true,
    model: STT_MODEL,
    async transcribe(input: TranscriptionInput): Promise<TranscriptionResult> {
      try {
        const r = await deps.call(input);
        if (!r || r.ok !== true) return { ok: false, reason: r ? r.reason : "transcription_error" };
        if (typeof r.text !== "string" || Buffer.byteLength(r.text, "utf8") > MAX_TRANSCRIPT_BYTES) return { ok: false, reason: "transcription_invalid" };
        const language: LiveAiLanguage = r.language === "hi" || r.language === "hinglish" || r.language === "en" ? r.language : "en";
        return { ok: true, text: r.text, language };
      } catch {
        return { ok: false, reason: "transcription_error" };
      }
    },
    async negotiate(offerSdp: string, opts?: { signal?: AbortSignal; deadlineMs?: number }): Promise<RealtimeNegotiation> {
      if (typeof deps.negotiate !== "function") return { ok: false, reason: "realtime_unavailable" };
      if (boundedSdp(offerSdp) === null) return { ok: false, reason: "invalid_offer" };
      try {
        const r = await deps.negotiate(offerSdp, opts);
        if (!r || r.ok !== true) return { ok: false, reason: r ? r.reason : "realtime_error" };
        const answer = boundedSdp(r.answerSdp);
        if (answer === null) return { ok: false, reason: "realtime_invalid" };
        return { ok: true, answerSdp: answer };
      } catch {
        return { ok: false, reason: "realtime_error" };
      }
    },
  });
}

// ── PROVIDER-CAPABLE default seams (dormant until configured) ─────────────────
// Real network functions used ONLY when a server-only OPENAI_API_KEY + the exact
// allowlisted model + a budget authority are configured. NEVER constructed without a
// key; NEVER invoked in local tests (fetch is injectable — tests assert the EXACT
// request shape with a fake). Endpoints/models are FIXED — no caller selection.
export const OPENAI_REALTIME_CALLS_URL = "https://api.openai.com/v1/realtime/calls";

/** R2-02 — the documented Realtime TRANSCRIPTION session configuration that
 *  accompanies the SDP offer (unified interface: SDP + session config; transcription
 *  sessions explicitly configure the transcription model — never a bare-SDP call). */
export function buildTranscriptionSessionConfig(): Record<string, unknown> {
  return {
    type: "transcription",
    audio: { input: { transcription: { model: STT_MODEL } } },
  };
}

export type FetchLike = (url: string, init: Record<string, unknown>) => Promise<{ ok: boolean; text(): Promise<string> }>;

async function abortableFetch(fetchImpl: FetchLike, url: string, init: Record<string, unknown>, opts?: { signal?: AbortSignal; deadlineMs?: number }): Promise<{ ok: boolean; text(): Promise<string> }> {
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  if (opts?.signal) { if (opts.signal.aborted) ctrl.abort(); else opts.signal.addEventListener("abort", onAbort, { once: true }); }
  const timer = setTimeout(() => ctrl.abort(), opts?.deadlineMs && opts.deadlineMs > 0 ? opts.deadlineMs : 15_000);
  try { return await fetchImpl(url, { ...init, signal: ctrl.signal }); }
  finally { clearTimeout(timer); if (opts?.signal) opts.signal.removeEventListener("abort", onAbort); }
}

/** Real STT + Realtime seams over the fixed provider — dormant until a key is given.
 *  `fetchImpl` is injectable so tests assert the exact request WITHOUT network. */
export function createDefaultTranscriptionSeam(apiKey: string | null, fetchImpl?: FetchLike): { call: TranscriptionCall; negotiate: NegotiateCall } | null {
  if (!apiKey) return null;
  const doFetch: FetchLike = fetchImpl || ((url, init) => fetch(url, init as RequestInit) as unknown as Promise<{ ok: boolean; text(): Promise<string> }>);
  const call: TranscriptionCall = async (input) => {
    // text mode passes text straight through (no audio to transcribe).
    if (typeof input.text === "string" && input.text) return { ok: true, text: input.text, language: input.languageHint || "en" };
    return { ok: false, reason: "transcription_unavailable" };
  };
  const negotiate: NegotiateCall = async (offerSdp, opts) => {
    try {
      // R2-02 — the documented unified Realtime call-create request: multipart body
      // carrying BOTH the SDP offer AND the explicit transcription-session config
      // (never an under-specified raw-SDP-only request).
      const form = new FormData();
      form.set("sdp", offerSdp);
      form.set("session", JSON.stringify(buildTranscriptionSessionConfig()));
      const res = await abortableFetch(doFetch, OPENAI_REALTIME_CALLS_URL, {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}` },
        body: form,
      }, opts);
      if (!res.ok) return { ok: false, reason: "realtime_error" };
      const answerSdp = await res.text();
      return { ok: true, answerSdp };
    } catch {
      return { ok: false, reason: "realtime_error" };
    }
  };
  return { call, negotiate };
}
