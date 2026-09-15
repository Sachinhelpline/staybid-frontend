// ─────────────────────────────────────────────────────────────────────────
// StayBid Live AI — LIVE-AI-02A — TTS adapter (dormant, fake-seam).
//
// A FIXED text-to-speech seam producing headerless PCM16 @ 24 kHz mono chunks.
// DEFAULT is UNAVAILABLE / fail-closed and touches no network. A real adapter is
// built ONLY over an INJECTED call and ONLY for the single allowed TTS model. It
// yields bounded, sequence-numbered base64 PCM chunks; the browser enforces the
// same bounds again. It voices ONLY the deterministic text the orchestrator hands
// it (derived from a validated AnswerPlan + verified evidence) — never model prose.
// ─────────────────────────────────────────────────────────────────────────

export const TTS_MODEL = "gpt-4o-mini-tts" as const;
export const TTS_SAMPLE_RATE = 24000;
export const MAX_TTS_CHUNK_BYTES = 12 * 1024;
export const MAX_TTS_TOTAL_BYTES = 90 * 24000 * 2; // 90 s ceiling
// R3-13 — HARD answer-speech (synthesis) ceiling: the deterministic plan text voiced
// per turn is bounded, so a runaway/over-long synthesis fails closed rather than billing
// an unbounded call. Also the conservative budget reservation unit (characters — the
// provider's TTS billing unit) so the settled ACTUAL (characters voiced) is ≤ reservation.
export const MAX_TTS_TEXT_CHARS = 2000;

export interface TtsChunk { seq: number; bytes: string } // base64 PCM16 LE
export type TtsResult =
  // R3-13 — `usage` is the ACTUAL synthesized cost surfaced for budget settlement, in
  // characters voiced (the provider's TTS billing unit — always measurable from the
  // deterministic input text; a seam-supplied finite ≥0 figure overrides).
  | { ok: true; chunks: TtsChunk[]; usage?: number }
  | { ok: false; reason: string };

/** R3-13 — a finite, non-negative usage figure, else undefined (retain conservative). */
function cleanUsage(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined;
}

export interface TtsInput {
  /** the bounded deterministic text to voice (already rendered, not model prose). */
  text: string;
  language: "hi" | "hinglish" | "en";
  /** REV-13 — an AbortSignal a REAL provider call MUST honor; ignored by the seam. */
  signal?: AbortSignal;
  /** REV-13 — a per-call deadline (ms) a real adapter SHOULD apply. */
  deadlineMs?: number;
}
export interface TtsAdapter {
  readonly available: boolean;
  readonly model: string;
  synthesize(input: TtsInput): Promise<TtsResult>;
}
export type TtsCall = (input: TtsInput) => Promise<TtsResult>;

export const unavailableTts: TtsAdapter = Object.freeze({
  available: false,
  model: TTS_MODEL,
  async synthesize(): Promise<TtsResult> {
    return { ok: false, reason: "tts_unavailable" };
  },
});

const B64 = /^[A-Za-z0-9+/]*={0,2}$/;
function chunkOk(c: unknown): c is TtsChunk {
  if (!c || typeof c !== "object") return false;
  const cc = c as Record<string, unknown>;
  if (typeof cc.seq !== "number" || !Number.isInteger(cc.seq) || cc.seq < 0) return false;
  if (typeof cc.bytes !== "string" || cc.bytes.length % 4 !== 0 || !B64.test(cc.bytes)) return false;
  const pad = cc.bytes.endsWith("==") ? 2 : cc.bytes.endsWith("=") ? 1 : 0;
  const decoded = (cc.bytes.length / 4) * 3 - pad;
  return decoded >= 0 && decoded <= MAX_TTS_CHUNK_BYTES;
}

// ── PROVIDER-CAPABLE default seam (dormant until configured) ──────────────────
// Built ONLY when a server-only OPENAI_API_KEY + the exact model are present; NEVER
// invoked in local tests (fakes injected). Fixed endpoint + model; the returned PCM
// is re-chunked + re-bounded by createTtsAdapter and again by the browser.
const OPENAI_SPEECH_URL = "https://api.openai.com/v1/audio/speech";

/** The injectable fetch seam for the TTS default call (tests supply a fake; production
 *  uses the real fetch). Exposes only the response fields the seam reads. */
export type TtsFetchLike = (url: string, init: Record<string, unknown>) => Promise<{ ok: boolean; headers?: { get(name: string): string | null } | null; body?: unknown; arrayBuffer(): Promise<ArrayBuffer> }>;

/** R4-NEW-01 — read a response body into a Buffer, HARD-bounded to `max` bytes. When a
 *  readable stream is present it reads incrementally and returns null the moment the
 *  cumulative size exceeds `max` (never buffers an unbounded response, cancels the
 *  reader). Otherwise a single arrayBuffer read + a length check (the injected test fake)
 *  is equally bounded — over-cap ⇒ null. */
async function readBounded(res: { body?: unknown; arrayBuffer(): Promise<ArrayBuffer> }, max: number): Promise<Buffer | null> {
  const body = res.body as { getReader?: () => { read(): Promise<{ done: boolean; value?: Uint8Array }>; cancel(): Promise<void> } } | undefined | null;
  if (body && typeof body.getReader === "function") {
    const reader = body.getReader();
    const parts: Buffer[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value && value.length) {
        total += value.length;
        if (total > max) { try { await reader.cancel(); } catch { /* no-op */ } return null; }
        parts.push(Buffer.from(value));
      }
    }
    return Buffer.concat(parts);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  return buf.length > max ? null : buf;
}

export function createDefaultTtsCall(apiKey: string | null, fetchImpl?: TtsFetchLike): TtsCall | null {
  if (!apiKey) return null;
  const doFetch: TtsFetchLike = fetchImpl || ((url, init) => fetch(url, init as RequestInit) as unknown as ReturnType<TtsFetchLike>);
  return async (input: TtsInput): Promise<TtsResult> => {
    const ctrl = new AbortController();
    const onAbort = () => ctrl.abort();
    if (input.signal) { if (input.signal.aborted) ctrl.abort(); else input.signal.addEventListener("abort", onAbort, { once: true }); }
    const timer = setTimeout(() => ctrl.abort(), input.deadlineMs && input.deadlineMs > 0 ? input.deadlineMs : 20_000);
    try {
      const res = await doFetch(OPENAI_SPEECH_URL, {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ model: TTS_MODEL, voice: "alloy", input: input.text, response_format: "pcm" }),
        signal: ctrl.signal,
      });
      if (!res.ok) return { ok: false, reason: "tts_error" };
      // R4-NEW-01 — REJECT an over-limit response instead of silently truncating it. A
      // declared Content-Length over the ceiling is refused BEFORE the body is read; if
      // the header is absent/lying, a bounded incremental read aborts the moment the
      // cumulative bytes exceed the cap. Truncated PCM is NEVER returned as a successful
      // complete utterance (the old `off < MAX_TTS_TOTAL_BYTES` loop guard did exactly that).
      const clRaw = res.headers ? res.headers.get("content-length") : null;
      const cl = clRaw !== null && clRaw !== undefined && clRaw !== "" ? Number(clRaw) : NaN;
      if (Number.isFinite(cl) && cl > MAX_TTS_TOTAL_BYTES) return { ok: false, reason: "tts_too_long" };
      const bounded = await readBounded(res, MAX_TTS_TOTAL_BYTES);
      if (bounded === null) return { ok: false, reason: "tts_too_long" }; // exceeded the cap mid-read
      const buf = bounded;
      const chunks: TtsChunk[] = [];
      let seq = 0;
      for (let off = 0; off < buf.length; off += MAX_TTS_CHUNK_BYTES) {
        chunks.push({ seq: seq++, bytes: buf.subarray(off, Math.min(off + MAX_TTS_CHUNK_BYTES, buf.length)).toString("base64") });
      }
      return { ok: true, chunks };
    } catch {
      return { ok: false, reason: "tts_error" };
    } finally {
      clearTimeout(timer);
      if (input.signal) input.signal.removeEventListener("abort", onAbort);
    }
  };
}

export function createTtsAdapter(deps: { model?: string; call: TtsCall }): TtsAdapter {
  if ((deps.model || TTS_MODEL) !== TTS_MODEL || typeof deps.call !== "function") return unavailableTts;
  return Object.freeze({
    available: true,
    model: TTS_MODEL,
    async synthesize(input: TtsInput): Promise<TtsResult> {
      try {
        // R3-13 — HARD answer-speech ceiling BEFORE the provider call: only deterministic,
        // bounded text is ever voiced; an empty or over-long text fails closed (never an
        // unbounded synthesis). `input.text.length` is then the measurable billing unit.
        if (typeof input.text !== "string" || input.text.length === 0) return { ok: false, reason: "tts_invalid" };
        if (input.text.length > MAX_TTS_TEXT_CHARS) return { ok: false, reason: "tts_too_long" };
        const r = await deps.call(input);
        if (!r || r.ok !== true) return { ok: false, reason: r ? r.reason : "tts_error" };
        if (!Array.isArray(r.chunks)) return { ok: false, reason: "tts_invalid" };
        let total = 0;
        let expectedSeq = 0;
        for (const c of r.chunks) {
          if (!chunkOk(c) || c.seq !== expectedSeq) return { ok: false, reason: "tts_invalid" };
          const pad = c.bytes.endsWith("==") ? 2 : c.bytes.endsWith("=") ? 1 : 0;
          total += (c.bytes.length / 4) * 3 - pad;
          if (total > MAX_TTS_TOTAL_BYTES) return { ok: false, reason: "tts_too_long" };
          expectedSeq += 1;
        }
        // R3-13 — surface the ACTUAL measurable usage for settlement: characters voiced
        // (the provider's TTS billing unit, always known from the deterministic input,
        // bounded ≤ MAX_TTS_TEXT_CHARS above); a seam-supplied finite ≥0 usage overrides.
        const usage = cleanUsage((r as { usage?: unknown }).usage) ?? input.text.length;
        return { ok: true, chunks: r.chunks.map((c) => ({ seq: c.seq, bytes: c.bytes })), usage };
      } catch {
        return { ok: false, reason: "tts_error" };
      }
    },
  });
}
