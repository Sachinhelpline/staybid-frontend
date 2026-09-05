// ═══════════════════════════════════════════════════════════════════════════
// N0 — FINAL OUTBOUND VIDEO SAFETY GATE (creator side, lazy, bounded,
// removable). Runs AFTER the compressor has produced the final candidate
// blob and BEFORE Storage upload:
//
//   CLASSIFY → NORMALIZE IF REQUIRED → VALIDATE → ALLOW / FAIL CLOSED
//
// Invariants (Owner Control Room, N0):
//   • a KNOWN-UNSAFE container never reaches public DIRECT playback;
//   • known-unsafe + remux / validator / timeout / load failure ⇒ FAIL CLOSED
//     with a distinct UnsafeVideoContainerError (never an ordinary
//     "compression failed" that the composer would swallow);
//   • Chromium-compressor fMP4 is the ONLY class that is normalized;
//     fragmented ORIGINALS are a separate path and fail closed in N0;
//   • compressor-produced WebM is not published as universal DIRECT video;
//   • mediabunny is loaded ONLY here, lazily, inside a one-shot Worker —
//     this module itself has NO static mediabunny import.
// ═══════════════════════════════════════════════════════════════════════════
import { classifyVideoBlob, classifyVideoBytes, validateNormalizedOutput, type ContainerReport, type VideoContainerClass } from "./video-container";

export const UNSAFE_VIDEO_CONTAINER = "UNSAFE_VIDEO_CONTAINER" as const;

/** Input ceiling for in-browser normalization. The compressor targets
 *  2.5 Mbps video + 128 kbps audio and hard-trims at 60 s (reel) / 90 s
 *  (story) ⇒ a theoretical maximum of ≈ 30 MB; the measured gate proved
 *  1.2 MB and 15 MB inputs at ≈4× transient memory. 40 MiB leaves ≈1.3×
 *  headroom for VBR overshoot while bounding the transient to ≈160 MB. Larger
 *  known-unsafe candidates FAIL CLOSED (they are not the proven class size). */
export const NORMALIZATION_MAX_INPUT_BYTES = 40 * 1024 * 1024;
/** A remux that has not finished in this window is treated as failed. The
 *  gate measured ≤0.2 s for 15 MB on desktop; 45 s covers slow mobile CPUs. */
export const NORMALIZATION_TIMEOUT_MS = 45_000;

export const UNSAFE_VIDEO_CREATOR_MESSAGE =
  "This video couldn't be prepared safely for playback. Please retry with a shorter clip.";
export const UNSUPPORTED_BROWSER_VIDEO_CREATOR_MESSAGE =
  "This browser produced a video format StayBid can't publish safely yet. Please try posting from Chrome or Safari.";

export type OutboundOrigin = "compressor" | "original";
export type OutboundDecision =
  | "ALLOW_SAFE_PROGRESSIVE_MP4"
  | "ALLOW_ORIGINAL_UNCHANGED_SEPARATE_PATH"
  | "NORMALIZED_KNOWN_UNSAFE_FMP4";

export type PacketCheckSummary = { allMatch: boolean; tracks: unknown[] };
export type NormalizeFn = (bytes: Uint8Array, opts: { timeoutMs: number }) => Promise<{ output: Uint8Array; packetCheck: PacketCheckSummary }>;

export type PreparedOutboundVideo = {
  blob: Blob;
  mime: string;
  decision: OutboundDecision;
  classification: VideoContainerClass;
  normalized: boolean;
  bytesIn: number;
  bytesOut: number;
  report: ContainerReport;
};

export class UnsafeVideoContainerError extends Error {
  readonly code = UNSAFE_VIDEO_CONTAINER;
  readonly classification: VideoContainerClass | "UNKNOWN";
  readonly stage: string;
  readonly creatorMessage: string;
  constructor(stage: string, classification: VideoContainerClass | "UNKNOWN", detail: string, creatorMessage = UNSAFE_VIDEO_CREATOR_MESSAGE) {
    super(`${UNSAFE_VIDEO_CONTAINER}:${stage}:${classification}:${detail}`);
    this.name = "UnsafeVideoContainerError";
    this.stage = stage; this.classification = classification; this.creatorMessage = creatorMessage;
  }
}
export function isUnsafeVideoContainerError(e: unknown): e is UnsafeVideoContainerError {
  return !!e && typeof e === "object" && (e as { code?: string }).code === UNSAFE_VIDEO_CONTAINER;
}

function withTimeout<T>(p: Promise<T>, ms: number, onTimeout: () => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => { try { onTimeout(); } catch { /* ignore */ } reject(new Error("normalize_timeout")); }, ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

/** Default normalizer: one-shot dedicated module Worker (mediabunny lives
 *  only inside it), transferable buffers both ways, bounded timeout, always
 *  terminated. Any failure to create/load the Worker is a load failure. */
export const normalizeInWorker: NormalizeFn = (bytes, { timeoutMs }) => {
  if (typeof Worker === "undefined") return Promise.reject(new Error("worker_unavailable"));
  let worker: Worker;
  try {
    worker = new Worker(new URL("./video-normalize.worker.ts", import.meta.url), { type: "module" });
  } catch (e) {
    return Promise.reject(new Error("worker_create_failed:" + (e instanceof Error ? e.message : String(e))));
  }
  const id = Date.now();
  const result = new Promise<{ output: Uint8Array; packetCheck: PacketCheckSummary }>((resolve, reject) => {
    worker.onmessage = (e: MessageEvent) => {
      const d = e.data as { id: number; ok: boolean; output?: ArrayBuffer; packetCheck?: PacketCheckSummary; error?: string };
      if (!d || d.id !== id) return;
      if (d.ok && d.output) resolve({ output: new Uint8Array(d.output), packetCheck: d.packetCheck || { allMatch: false, tracks: [] } });
      else reject(new Error("remux_failed:" + (d.error || "unknown")));
    };
    worker.onerror = (ev) => reject(new Error("worker_error:" + (ev && (ev as ErrorEvent).message ? (ev as ErrorEvent).message : "load")));
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    worker.postMessage({ id, bytes: buf }, [buf]);
  });
  return withTimeout(result, timeoutMs, () => worker.terminate()).finally(() => { try { worker.terminate(); } catch { /* ignore */ } });
};

/**
 * The gate. Never throws anything but UnsafeVideoContainerError: any
 * unexpected internal failure is converted to it, so the composer's ordinary
 * compression fallback can never re-route an unsafe artifact to upload.
 */
export async function prepareOutboundVideo(
  input: { blob: Blob; mime: string; origin: OutboundOrigin },
  deps: { normalize?: NormalizeFn; maxInputBytes?: number; timeoutMs?: number } = {},
): Promise<PreparedOutboundVideo> {
  const normalize = deps.normalize ?? normalizeInWorker;
  const maxInputBytes = deps.maxInputBytes ?? NORMALIZATION_MAX_INPUT_BYTES;
  const timeoutMs = deps.timeoutMs ?? NORMALIZATION_TIMEOUT_MS;
  const { blob, origin } = input;
  const mime = (input.mime || blob.type || "").split(";")[0].trim().toLowerCase();

  let report: ContainerReport;
  try { report = await classifyVideoBlob(blob, mime); }
  catch (e) { throw new UnsafeVideoContainerError("classify", "UNKNOWN", e instanceof Error ? e.message : String(e)); }
  const cls = report.cls;
  const base = { classification: cls, normalized: false, bytesIn: blob.size, bytesOut: blob.size, report };

  switch (cls) {
    case "SAFE_PROGRESSIVE_MP4":
      return { blob, mime: mime || "video/mp4", decision: "ALLOW_SAFE_PROGRESSIVE_MP4", ...base };
    case "NON_MP4_ORIGINAL":
      if (origin === "compressor") {
        // Compressor-produced WebM (or any non-MP4) is NOT proven safe for
        // StayBid's Safari/iOS DIRECT delivery ⇒ FAIL CLOSED in N0.
        throw new UnsafeVideoContainerError("policy", cls, "compressor_non_mp4:" + report.reason, UNSUPPORTED_BROWSER_VIDEO_CREATOR_MESSAGE);
      }
      // Creator-supplied non-MP4 original (e.g. QuickTime .mov, WebM): today's
      // behaviour is preserved UNCHANGED; this is NOT a safety certification.
      return { blob, mime: mime || blob.type || "video/mp4", decision: "ALLOW_ORIGINAL_UNCHANGED_SEPARATE_PATH", ...base };
    case "FRAGMENTED_ORIGINAL_UNVALIDATED":
      throw new UnsafeVideoContainerError("policy", cls, "fragmented_variant_not_proven:" + report.reason);
    case "UNREADABLE_OR_INVALID_MP4":
      throw new UnsafeVideoContainerError("policy", cls, report.reason);
    case "KNOWN_UNSAFE_COMPRESSOR_FMP4":
      break;
  }

  // ── KNOWN_UNSAFE_COMPRESSOR_FMP4: the only normalized class. Bounded.
  if (blob.size > maxInputBytes) throw new UnsafeVideoContainerError("size", cls, `input_bytes:${blob.size}>${maxInputBytes}`);
  let inputBytes: Uint8Array;
  try { inputBytes = new Uint8Array(await blob.arrayBuffer()); }
  catch (e) { throw new UnsafeVideoContainerError("read", cls, e instanceof Error ? e.message : String(e)); }
  let remux: { output: Uint8Array; packetCheck: PacketCheckSummary };
  // The bound is enforced HERE as well as inside the Worker helper, so no
  // normalizer implementation can hang the composer past timeoutMs.
  try { remux = await withTimeout(normalize(inputBytes, { timeoutMs }), timeoutMs, () => { /* normalizer owns its own cleanup */ }); }
  catch (e) { throw new UnsafeVideoContainerError("normalize", cls, e instanceof Error ? e.message : String(e)); }
  if (!remux || !remux.output || remux.output.byteLength === 0) throw new UnsafeVideoContainerError("normalize", cls, "empty_output");
  if (!remux.packetCheck || remux.packetCheck.allMatch !== true) throw new UnsafeVideoContainerError("validate", cls, "payload_or_config_mismatch");
  let outReport: ContainerReport;
  try { outReport = await classifyVideoBytes(remux.output, "video/mp4"); }
  catch (e) { throw new UnsafeVideoContainerError("validate", cls, e instanceof Error ? e.message : String(e)); }
  const v = validateNormalizedOutput(outReport, report, remux.output.byteLength, inputBytes.byteLength);
  if (!v.ok) throw new UnsafeVideoContainerError("validate", cls, v.failures.join(","));
  const outBlob = new Blob([remux.output as BlobPart], { type: "video/mp4" });
  return { blob: outBlob, mime: "video/mp4", decision: "NORMALIZED_KNOWN_UNSAFE_FMP4", classification: cls, normalized: true, bytesIn: blob.size, bytesOut: outBlob.size, report: outReport };
}
