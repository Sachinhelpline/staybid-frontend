// ═══════════════════════════════════════════════════════════════════════════
// Client-side multi-video merger — IG-style "attach multiple clips" flow.
// ───────────────────────────────────────────────────────────────────────────
// Why client-side: server-side ffmpeg means double-upload (raw clips up,
// merged video down, edited version back up) which on India 3G is brutal.
// The same MediaRecorder + canvas + captureStream pipeline that
// lib/social/video-compress.ts already runs in production handles
// concatenation natively — we just keep the canvas + recorder alive
// across multiple <video> sources.
//
// Architecture:
//   ┌──────────┐
//   │ <canvas> │──captureStream(30)──┐
//   └────▲─────┘                     │
//        │ ctx.drawImage             ├──► MediaRecorder ──► chunks ──► Blob
//        │                           │
//   ┌────┴───────┐  ┌─────────────┐  │
//   │ <video> #1 │─►│             │  │
//   │ <video> #2 │─►│  AudioCtx   │──┘ (audio track from destination)
//   │ <video> #3 │─►│ destination │
//   └────────────┘  └─────────────┘
//
//   Videos play one at a time. When #1 ends, we swap to #2 — canvas keeps
//   drawing, MediaRecorder keeps recording, audio destination keeps
//   producing a continuous track. The recorder NEVER sees a track
//   add/remove mid-session, which is the whole reason the naive approach
//   ("addTrack each clip's audio") fails: MediaRecorder freezes the track
//   set at start() and adding tracks later is a no-op.
//
// Browser support (verified vs the compress pipeline):
//   Chrome / Android Chrome / Edge — works (VP9 + Opus, or H.264 + AAC)
//   Firefox                        — works (VP8/9 via WebM)
//   Safari (macOS 14.1+)           — works (H.264 captureStream)
//   iOS Safari                     — captureStream not implemented
//                                    → caller surfaces "merge unsupported,
//                                       attach one clip at a time"
//
// Hard caps (defense against OOM on mid-tier Android):
//   - Max 10 clips per merge
//   - Per-clip max 50 MB (same as compress)
//   - Total merged duration ≤ 5 minutes
// ═══════════════════════════════════════════════════════════════════════════
"use client";

const TARGET_MAX_DIM     = 1080;       // longest side of merged output
const TARGET_FPS         = 30;
const TARGET_BITRATE     = 2_500_000;  // 2.5 Mbps — matches IG reels
const TARGET_AUDIO_BITS  = 128_000;
const MAX_CLIPS          = 10;
const MAX_PER_CLIP_BYTES = 50 * 1024 * 1024;
const MAX_TOTAL_DURATION = 300;        // seconds — 5 minutes

export type MergeProgressPhase = "probe" | "encode" | "finalize";

export type MergeProgress = {
  phase: MergeProgressPhase;
  /** 0-100 overall percentage across all phases. */
  overall: number;
  /** When phase==="encode": which clip is currently being drawn (0-indexed). */
  clipIndex?: number;
  /** When phase==="encode": total clip count. */
  clipCount?: number;
};

export type MergeResult = {
  blob: Blob;
  mime: string;
  /** Width / height of the merged canvas — useful for poster extraction. */
  width: number;
  height: number;
  /** Total duration in seconds. */
  duration: number;
  totalBytes: number;
};

export class MergeUnsupportedError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "MergeUnsupportedError";
  }
}

/** Returns true when the running browser supports the merge pipeline. */
export function isMergeSupported(): boolean {
  if (typeof window === "undefined") return false;
  const probe = document.createElement("video") as any;
  const hasCaptureStream =
    typeof probe.captureStream === "function" || typeof probe.mozCaptureStream === "function";
  const hasMR = typeof MediaRecorder !== "undefined";
  const hasAC = typeof (window as any).AudioContext === "function" || typeof (window as any).webkitAudioContext === "function";
  const canvasOK = typeof (document.createElement("canvas") as any).captureStream === "function";
  return !!(hasCaptureStream && hasMR && hasAC && canvasOK);
}

function pickOutputMime(): string {
  const candidates = [
    "video/mp4;codecs=h264,aac",
    "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    "video/mp4",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];
  for (const c of candidates) {
    if (
      typeof MediaRecorder !== "undefined" &&
      MediaRecorder.isTypeSupported &&
      MediaRecorder.isTypeSupported(c)
    ) {
      return c;
    }
  }
  return "";
}

type ProbedClip = {
  blob: Blob;
  url: string;       // object URL (caller must NOT pre-revoke; we revoke at the end)
  width: number;
  height: number;
  duration: number;
};

async function probeClip(blob: Blob): Promise<ProbedClip> {
  const url = URL.createObjectURL(blob);
  const v = document.createElement("video");
  v.preload = "metadata";
  v.muted = true;
  v.playsInline = true;
  (v as any).webkitPlaysInline = true;
  v.src = url;
  try {
    await new Promise<void>((res, rej) => {
      let settled = false;
      v.onloadedmetadata = () => { if (!settled) { settled = true; res(); } };
      v.onerror = () => {
        if (!settled) {
          settled = true;
          rej(new Error("Couldn't decode one of the clips — try MP4 / H.264."));
        }
      };
      setTimeout(() => {
        if (!settled) { settled = true; rej(new Error("Clip metadata never loaded — file may be corrupt.")); }
      }, 8000);
    });
    const w = v.videoWidth, h = v.videoHeight, d = v.duration;
    if (!w || !h || !d || !isFinite(d)) {
      throw new Error("Couldn't read a clip's dimensions or duration.");
    }
    return { blob, url, width: w, height: h, duration: d };
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }
}

/**
 * Compute a single output frame size that fits every clip's aspect ratio
 * without distortion. Strategy: pick the FIRST clip's orientation as the
 * canonical target (portrait if first is portrait, landscape if first is
 * landscape), then cap longest side at TARGET_MAX_DIM. Every clip is drawn
 * inside this frame with letterboxing if its aspect differs.
 *
 * Rationale: matches IG's behavior of "first clip sets the frame" — the
 * creator's first attached clip defines the look and subsequent clips
 * adapt. Prevents mid-merge dimension flips that would corrupt the encode.
 */
function pickOutputSize(clips: ProbedClip[]): { w: number; h: number } {
  const first = clips[0];
  const longest = Math.max(first.width, first.height);
  const scale = Math.min(1, TARGET_MAX_DIM / longest);
  // Snap to even — H.264 / VP9 chroma alignment.
  const w = Math.max(2, Math.round(first.width * scale / 2) * 2);
  const h = Math.max(2, Math.round(first.height * scale / 2) * 2);
  return { w, h };
}

/**
 * Draw one frame of `v` into `ctx` letterboxed inside (canvasW × canvasH).
 * Source is fit (object-fit: contain) so no clip is cropped without consent.
 */
function drawLetterboxed(
  ctx: CanvasRenderingContext2D,
  v: HTMLVideoElement,
  canvasW: number,
  canvasH: number,
) {
  const sW = v.videoWidth || canvasW;
  const sH = v.videoHeight || canvasH;
  const sAspect = sW / sH;
  const cAspect = canvasW / canvasH;
  let dW: number, dH: number, dx: number, dy: number;
  if (sAspect > cAspect) {
    // Source is wider — fit width, letterbox top/bottom.
    dW = canvasW;
    dH = Math.round(canvasW / sAspect);
    dx = 0;
    dy = Math.round((canvasH - dH) / 2);
  } else {
    // Source is taller — fit height, letterbox left/right.
    dH = canvasH;
    dW = Math.round(canvasH * sAspect);
    dy = 0;
    dx = Math.round((canvasW - dW) / 2);
  }
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, canvasW, canvasH);
  try { ctx.drawImage(v, dx, dy, dW, dH); } catch { /* skip frame */ }
}

/**
 * Merge an ordered list of video Blobs / Files into a single Blob.
 *
 * @throws MergeUnsupportedError when the browser lacks captureStream/MediaRecorder
 * @throws Error                 for any per-clip / encoding failure
 */
export async function mergeVideos(
  files: Array<File | Blob>,
  onProgress?: (p: MergeProgress) => void,
): Promise<MergeResult> {
  if (!files || files.length === 0) {
    throw new Error("No clips to merge.");
  }
  if (files.length === 1) {
    // Single clip: just normalize the shape so callers can treat the
    // result identically. No re-encode — caller's compress step still runs.
    const blob = files[0] instanceof Blob ? files[0] : (files[0] as File);
    const probed = await probeClip(blob);
    try {
      return {
        blob, mime: (blob as any).type || "video/mp4",
        width: probed.width, height: probed.height,
        duration: probed.duration, totalBytes: blob.size,
      };
    } finally {
      URL.revokeObjectURL(probed.url);
    }
  }
  if (files.length > MAX_CLIPS) {
    throw new Error(`Too many clips — maximum is ${MAX_CLIPS}. Remove a few and try again.`);
  }
  for (const f of files) {
    if ((f as any).size > MAX_PER_CLIP_BYTES) {
      const mb = ((f as any).size / 1024 / 1024).toFixed(1);
      throw new Error(`One clip is ${mb} MB — keep each clip under 50 MB.`);
    }
  }
  if (!isMergeSupported()) {
    throw new MergeUnsupportedError(
      "Your browser can't merge multiple clips. Open in Chrome or Firefox, or upload clips one at a time."
    );
  }
  const outMime = pickOutputMime();
  if (!outMime) {
    throw new MergeUnsupportedError("Your browser doesn't support any video encoding codec for merging.");
  }

  // ── Phase 1: probe every clip (durations, dims). ────────────────────────
  onProgress?.({ phase: "probe", overall: 1 });
  const clips: ProbedClip[] = [];
  try {
    for (let i = 0; i < files.length; i++) {
      const p = await probeClip(files[i]);
      clips.push(p);
      onProgress?.({ phase: "probe", overall: Math.round(1 + (i + 1) / files.length * 4) });
    }
    const totalDuration = clips.reduce((s, c) => s + c.duration, 0);
    if (totalDuration > MAX_TOTAL_DURATION) {
      throw new Error(
        `Merged video would be ${totalDuration.toFixed(1)}s — keep total under ${MAX_TOTAL_DURATION}s (${(MAX_TOTAL_DURATION / 60).toFixed(0)} min).`
      );
    }

    // ── Phase 2: build canvas + audio routing + MediaRecorder. ────────────
    const { w: canvasW, h: canvasH } = pickOutputSize(clips);
    const canvas = document.createElement("canvas");
    canvas.width = canvasW;
    canvas.height = canvasH;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Couldn't open a 2D canvas for merging.");

    const canvasStream: MediaStream = (canvas as any).captureStream(TARGET_FPS);

    // AudioContext — single destination for the entire merge so the audio
    // track stays continuous across clip swaps. MediaElementSource nodes
    // are connected lazily per-clip and disconnected on clip-end so memory
    // doesn't grow with clip count.
    const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
    const audioCtx: AudioContext = new AC();
    const dest = audioCtx.createMediaStreamDestination();
    for (const t of dest.stream.getAudioTracks()) canvasStream.addTrack(t);

    const rec = new MediaRecorder(canvasStream, {
      mimeType: outMime,
      videoBitsPerSecond: TARGET_BITRATE,
      audioBitsPerSecond: TARGET_AUDIO_BITS,
    });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunks.push(e.data); };
    const stopPromise = new Promise<Blob>((res) => {
      rec.onstop = () => res(new Blob(chunks, { type: outMime.split(";")[0] || "video/mp4" }));
    });
    rec.start(250); // 250ms chunks — smoother memory profile

    // ── Phase 3: play each clip sequentially, drawing into the canvas. ────
    let elapsedDuration = 0;
    for (let i = 0; i < clips.length; i++) {
      const clip = clips[i];
      // Each clip gets its own <video> element. We can't reuse one because
      // re-assigning .src while another play() is in flight on the SAME
      // element causes Safari to emit a NotSupportedError. Disposable
      // video elements per clip are cheap (no DOM mount).
      const v = document.createElement("video");
      v.preload = "auto";
      v.muted = false; // we route audio via Web Audio; element itself stays silent because it's not in the DOM
      v.playsInline = true;
      (v as any).webkitPlaysInline = true;
      v.crossOrigin = "anonymous";
      v.src = clip.url;

      await new Promise<void>((res, rej) => {
        let settled = false;
        const ok = () => { if (!settled) { settled = true; res(); } };
        const fail = (err: any) => { if (!settled) { settled = true; rej(err); } };
        v.oncanplay = ok;
        v.onloadeddata = ok;
        v.onerror = () => fail(new Error(`Clip ${i + 1} couldn't be decoded.`));
        setTimeout(() => fail(new Error(`Clip ${i + 1} took too long to load.`)), 12000);
      });

      // Route this clip's audio into the shared destination. createMediaElementSource
      // can only be called ONCE per element — we create a fresh element per clip
      // above so this is safe.
      let srcNode: MediaElementAudioSourceNode | null = null;
      try {
        srcNode = audioCtx.createMediaElementSource(v);
        srcNode.connect(dest);
      } catch {
        // Some clips (CORS-tainted, or no audio track) can't be wired. The
        // video frame still draws fine; we just skip audio for this clip.
      }

      // Play + draw loop. Resolved when the clip's `ended` fires OR the
      // watchdog trips.
      const drawFrame = () => { drawLetterboxed(ctx, v, canvasW, canvasH); };
      let stopDrawing = false;
      const rvfc = (v as any).requestVideoFrameCallback;
      if (typeof rvfc === "function") {
        const tick = () => {
          if (stopDrawing) return;
          drawFrame();
          try { (v as any).requestVideoFrameCallback(tick); } catch {}
        };
        try { (v as any).requestVideoFrameCallback(tick); } catch {}
      } else {
        const raf = () => {
          if (stopDrawing) return;
          drawFrame();
          requestAnimationFrame(raf);
        };
        requestAnimationFrame(raf);
      }

      const baseElapsed = elapsedDuration;
      const clipProgressTick = () => {
        const dur = clip.duration || 0;
        const t = v.currentTime || 0;
        const totalElapsed = baseElapsed + Math.min(t, dur);
        const overall = 5 + Math.min(90, (totalElapsed / totalDuration) * 90);
        onProgress?.({
          phase: "encode",
          overall: Math.round(overall),
          clipIndex: i,
          clipCount: clips.length,
        });
      };
      const progressIv = setInterval(clipProgressTick, 200);

      try {
        await v.play();
      } catch (err) {
        // Autoplay rejection mid-merge is rare (we never paused), but if
        // it happens we surface a clear error.
        clearInterval(progressIv);
        stopDrawing = true;
        if (srcNode) try { srcNode.disconnect(); } catch {}
        throw new Error(`Clip ${i + 1} refused to play. Try reattaching it.`);
      }

      await new Promise<void>((res) => {
        let done = false;
        const finish = () => { if (!done) { done = true; res(); } };
        v.onended = finish;
        // Watchdog: never exceed 1.5× clip duration. Caps runaway clips.
        setTimeout(finish, Math.max(15_000, clip.duration * 1500));
      });

      clearInterval(progressIv);
      stopDrawing = true;
      try { v.pause(); } catch {}
      if (srcNode) { try { srcNode.disconnect(); } catch {} }
      // <video> elements drop from GC once we lose the reference here.
      elapsedDuration += clip.duration;
    }

    // ── Phase 4: finalize. ─────────────────────────────────────────────────
    onProgress?.({ phase: "finalize", overall: 96 });
    rec.stop();
    const blob = await stopPromise;
    try { audioCtx.close(); } catch {}

    onProgress?.({ phase: "finalize", overall: 100 });
    return {
      blob,
      mime: outMime.split(";")[0] || "video/mp4",
      width: canvasW,
      height: canvasH,
      duration: elapsedDuration,
      totalBytes: blob.size,
    };
  } finally {
    for (const c of clips) {
      try { URL.revokeObjectURL(c.url); } catch {}
    }
  }
}

/**
 * Extract a poster JPEG (data URL) from a video Blob at the given timestamp
 * (default: 0.05s — just past frame 0 so codecs that emit a black initial
 * frame still give a usable thumb).
 *
 * Mirrors the helper inside CreateFlow's extractVideoThumbnail() — exposed
 * here so the merger can capture its OWN first frame immediately after
 * merging, so the post never falls back to a black poster.
 */
export async function extractMergedPoster(blob: Blob, at = 0.05): Promise<string> {
  const url = URL.createObjectURL(blob);
  try {
    const v = document.createElement("video");
    v.preload = "auto";
    v.muted = true;
    v.playsInline = true;
    (v as any).webkitPlaysInline = true;
    v.src = url;
    await new Promise<void>((res, rej) => {
      let settled = false;
      v.onloadedmetadata = () => {
        if (settled) return;
        try { v.currentTime = Math.min(at, (v.duration || 1) * 0.1); } catch {}
      };
      v.onseeked = () => { if (!settled) { settled = true; res(); } };
      v.onerror = () => { if (!settled) { settled = true; rej(new Error("poster decode failed")); } };
      setTimeout(() => { if (!settled) { settled = true; res(); } }, 5000);
    });
    const canvas = document.createElement("canvas");
    const w = v.videoWidth || 720;
    const h = v.videoHeight || 1280;
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d");
    ctx.drawImage(v, 0, 0, w, h);
    return canvas.toDataURL("image/jpeg", 0.82);
  } finally {
    try { URL.revokeObjectURL(url); } catch {}
  }
}
