// ─────────────────────────────────────────────────────────────────────────
// StayBid Live AI — LIVE-AI-02A — bounded PCM playback (generation-scoped).
//
// Owns the decode → queue → play → flush → teardown lifecycle for the gateway's
// TTS answer stream (headerless PCM16, 24 kHz, mono, little-endian). The actual
// sound is delegated to an injected AudioSink (a real Web-Audio sink in the
// browser; a deterministic fake in tests) so ALL sequencing / bounds / generation
// / flush logic is production code the tests execute WITHOUT a real AudioContext.
//
// Rules (frozen): chunks are strictly monotonic from seq 0; a gap or conflicting
// duplicate ABORTS the audio; a stale generation is ignored; queued + total bytes
// are bounded; flush/teardown stop + clear immediately; autoplay failure keeps text
// state and exposes tap-to-resume; NO recording, NO persistence, NO stale playback.
// ─────────────────────────────────────────────────────────────────────────
import { FIXED_PCM_FORMAT, MAX_AUDIO_CHUNK_BYTES, type PcmFormat } from "./protocol";

export const MAX_QUEUED_PCM_BYTES = 512 * 1024;
// 90 s answer ceiling at 24 kHz · 16-bit · mono = 90 · 24000 · 2 = 4,320,000 bytes.
export const MAX_ANSWER_PCM_BYTES = 90 * 24000 * 2;

export type AudioSinkState = "suspended" | "running" | "closed";
/** The minimal audio backend the playback controller drives. */
export interface AudioSink {
  /** Resume/unlock playback (only legal after a user gesture). Resolves false when
   *  the browser blocks autoplay (the controller then exposes tap-to-resume). */
  resume(): Promise<boolean>;
  /** Schedule decoded PCM samples for playback (never records). */
  enqueue(samples: Int16Array): void;
  /** Stop all scheduled sources and drop everything queued. */
  stopAndClear(): void;
  /** Close/suspend the backend and release resources. */
  close(): void;
  state(): AudioSinkState;
}

export type ChunkOutcome = "played" | "stale" | "unknown" | "aborted" | "blocked";

interface Stream {
  audioId: string;
  generation: number;
  nextSeq: number;
  totalBytes: number;
  ended: boolean;
  aborted: boolean;
}

export interface AudioPlaybackDeps {
  sink: AudioSink;
  format?: PcmFormat;
}

export interface AudioPlayback {
  /** Begin a new answer stream. Supersedes any prior stream (flushes it). */
  onStart(input: { audioId: string; generation: number }, currentGeneration: number): boolean;
  /** Enqueue one PCM chunk (base64). Returns the outcome. */
  onChunk(input: { audioId: string; generation: number; seq: number; bytes: string }, currentGeneration: number): ChunkOutcome;
  /** Mark the stream complete (finalSeq must equal the count received). */
  onEnd(input: { audioId: string; generation: number; finalSeq: number }, currentGeneration: number): boolean;
  /** Stop + clear immediately (barge-in / route change / reset / end). */
  flush(): void;
  /** Full teardown — stop sources, clear queues, close the sink. */
  teardown(): void;
  /** Resume after a blocked autoplay (call on a user gesture). */
  resume(): Promise<boolean>;
  needsResume(): boolean;
  isActive(): boolean;
  queuedBytes(): number;
  state(): AudioSinkState;
}

/** Portable base64 → bytes (browser atob / Node Buffer), else null on bad input. */
export function decodeBase64(b64: string): Uint8Array | null {
  try {
    if (typeof atob === "function") {
      const bin = atob(b64);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    }
    // Node fallback (tests).
    const B = (globalThis as unknown as { Buffer?: { from: (s: string, e: string) => Uint8Array } }).Buffer;
    if (B) return Uint8Array.from(B.from(b64, "base64"));
    return null;
  } catch {
    return null;
  }
}
/** PCM16 LE bytes → Int16Array (little-endian), or null when byte length is odd. */
export function pcm16le(bytes: Uint8Array): Int16Array | null {
  if (bytes.length % 2 !== 0) return null;
  const out = new Int16Array(bytes.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = (bytes[i * 2] | (bytes[i * 2 + 1] << 8)) << 16 >> 16;
  return out;
}

export function createAudioPlayback(deps: AudioPlaybackDeps): AudioPlayback {
  const sink = deps.sink;
  const format: PcmFormat = deps.format || FIXED_PCM_FORMAT;
  let stream: Stream | null = null;
  // REV-15 — `queued` counts ONLY the bytes BUFFERED while the sink is suspended
  // (backpressure that must be bounded). Bytes handed to a running sink are treated
  // as scheduled/consumed and NEVER accumulate here, so the queued counter is not an
  // unintended cumulative ceiling; it decrements as the buffer drains on resume.
  let queued = 0;
  let blocked = false;
  // REV-03 — chunks that arrive while the sink is suspended are BUFFERED (bounded)
  // and replayed on resume, never silently discarded, and the stream integrity /
  // sequence state is preserved so playback resumes cleanly on a user gesture.
  const pending: Int16Array[] = [];

  function resetBuffer() { pending.length = 0; queued = 0; }
  function abort() {
    if (stream) stream.aborted = true;
    resetBuffer();
    try { sink.stopAndClear(); } catch { /* sink must never throw into the loop */ }
  }
  function drainPending(): boolean {
    // flush the buffered-while-suspended samples into a now-running sink, in order.
    while (pending.length > 0) {
      const s = pending.shift() as Int16Array;
      try { sink.enqueue(s); } catch { abort(); return false; }
    }
    queued = 0;
    return true;
  }

  return {
    onStart(input, currentGeneration) {
      if (input.generation !== currentGeneration) return false; // stale
      // A new stream supersedes any prior one.
      if (stream && !stream.ended && !stream.aborted) abort();
      stream = { audioId: input.audioId, generation: input.generation, nextSeq: 0, totalBytes: 0, ended: false, aborted: false };
      resetBuffer();
      blocked = false;
      return true;
    },
    onChunk(input, currentGeneration): ChunkOutcome {
      if (input.generation !== currentGeneration) return "stale";
      if (!stream || stream.audioId !== input.audioId) return "unknown";
      if (stream.aborted || stream.ended) return "aborted";
      // strict monotonic sequence — a gap or a conflicting/earlier duplicate aborts.
      if (input.seq !== stream.nextSeq) { abort(); return "aborted"; }
      const raw = decodeBase64(input.bytes);
      if (!raw || raw.length === 0 || raw.length > MAX_AUDIO_CHUNK_BYTES) { abort(); return "aborted"; }
      const samples = pcm16le(raw);
      if (!samples) { abort(); return "aborted"; }
      // per-answer total bound (always applies).
      if (stream.totalBytes + raw.length > MAX_ANSWER_PCM_BYTES) { abort(); return "aborted"; }
      stream.nextSeq += 1;
      stream.totalBytes += raw.length;
      if (sink.state() !== "running") {
        // suspended: BUFFER (bounded) and wait for tap-to-resume; never discard.
        if (queued + raw.length > MAX_QUEUED_PCM_BYTES) { abort(); return "aborted"; }
        pending.push(samples);
        queued += raw.length;
        blocked = true;
        return "blocked";
      }
      // running: if a prior blocked backlog exists, drain it first (order preserved).
      if (pending.length > 0 && !drainPending()) return "aborted";
      blocked = false;
      try { sink.enqueue(samples); } catch { abort(); return "aborted"; }
      return "played";
    },
    onEnd(input, currentGeneration) {
      if (input.generation !== currentGeneration) return false;
      if (!stream || stream.audioId !== input.audioId || stream.aborted) return false;
      if (input.finalSeq !== stream.nextSeq) { abort(); return false; }
      stream.ended = true;
      return true;
    },
    flush() { abort(); stream = null; blocked = false; },
    teardown() {
      abort();
      stream = null;
      blocked = false;
      try { sink.close(); } catch { /* no-op */ }
    },
    async resume() {
      let ok = false;
      try { ok = await sink.resume(); } catch { ok = false; }
      if (ok && sink.state() === "running") {
        // REV-03 — a successful user-gesture resume replays the buffered backlog for
        // the CURRENT stream (a superseded/aborted stream's buffer was already
        // cleared, so stale audio never plays).
        drainPending();
        blocked = false;
      }
      // R1-NEW-02 — a resume FAILURE does NOT synthesize a resume-required state; the
      // public `needsResume` is derived from whether real buffered audio is actually
      // waiting (see below), so a pre-audio gesture failure never shows "tap to hear".
      return ok && sink.state() === "running";
    },
    // R1-NEW-02 / R4 — resume is required whenever a CURRENT, non-ABORTED stream still has
    // real buffered (suspended) audio waiting AND the sink is not running. `audio.end`
    // means "no more chunks are coming", NOT "discard the audio already buffered": an
    // ENDED stream with un-drained buffered chunks is STILL resumable until the buffer
    // drains successfully (pending emptied) or the stream is intentionally aborted
    // (flush/reset/kill clears the buffer + nulls the stream). No stream / no buffer /
    // drained / aborted / after reset-kill → false. A bare resume-failure with nothing
    // buffered can never make this true.
    needsResume: () => {
      let running = false;
      try { running = sink.state() === "running"; } catch { running = false; }
      return !!stream && !stream.aborted && pending.length > 0 && !running;
    },
    isActive: () => !!stream && !stream.aborted && !stream.ended,
    queuedBytes: () => queued,
    state: () => sink.state(),
  };
}

/**
 * A real Web-Audio sink (browser only). Created lazily and ONLY after a user
 * gesture. Returns null when the Web Audio API is unavailable (SSR / tests) so the
 * controller stays dormant. Never records; teardown closes the context.
 */
export function createWebAudioSink(): AudioSink | null {
  type ACtor = new () => {
    state: AudioSinkState;
    sampleRate: number;
    currentTime: number;
    destination: unknown;
    resume: () => Promise<void>;
    close: () => Promise<void>;
    createBuffer: (ch: number, len: number, rate: number) => { getChannelData: (c: number) => Float32Array };
    createBufferSource: () => { buffer: unknown; connect: (d: unknown) => void; start: (t: number) => void; stop: () => void };
  };
  const w = globalThis as unknown as { AudioContext?: ACtor; webkitAudioContext?: ACtor };
  const Ctor = w.AudioContext || w.webkitAudioContext;
  if (!Ctor) return null;
  let ctx: InstanceType<ACtor> | null = null;
  let playHead = 0;
  const sources: Array<{ stop: () => void }> = [];
  const ensure = () => {
    if (!ctx) { ctx = new Ctor(); playHead = 0; }
    return ctx;
  };
  return {
    async resume() {
      const c = ensure();
      try { await c.resume(); } catch { return false; }
      return c.state === "running";
    },
    enqueue(samples) {
      const c = ensure();
      if (c.state !== "running") return;
      const buf = c.createBuffer(1, samples.length, 24000);
      const ch = buf.getChannelData(0);
      for (let i = 0; i < samples.length; i++) ch[i] = Math.max(-1, Math.min(1, samples[i] / 32768));
      const src = c.createBufferSource();
      src.buffer = buf;
      src.connect(c.destination);
      const at = Math.max(c.currentTime, playHead);
      src.start(at);
      playHead = at + samples.length / 24000;
      sources.push(src);
    },
    stopAndClear() {
      for (const s of sources.splice(0)) { try { s.stop(); } catch { /* already stopped */ } }
      if (ctx) playHead = ctx.currentTime;
    },
    close() {
      for (const s of sources.splice(0)) { try { s.stop(); } catch { /* no-op */ } }
      if (ctx) { try { ctx.close(); } catch { /* no-op */ } ctx = null; }
    },
    state() { return ctx ? ctx.state : "suspended"; },
  };
}
