// ═══════════════════════════════════════════════════════════════════════════
// Client-side video compressor — IG-level quality cap before upload.
// ───────────────────────────────────────────────────────────────────────────
// Why this matters: phones shoot 4K 60fps clips at 50-100 MB / minute. Even
// on 5G that takes 60-90s to push to Supabase Storage — past v115's 90s
// watchdog, so uploads fail. IG / TikTok all transcode client-side first to
// ~720p ~2.5 Mbps so the upload is < 10 MB and finishes in 10-20s.
//
// Implementation: render every frame of the source video into a <canvas> at
// the target resolution, capture the canvas stream + the source's audio
// track via captureStream(), and pipe both through MediaRecorder. The
// result is a re-encoded WebM (or H.264 MP4 where the browser supports
// "video/mp4;codecs=h264") at our target bitrate.
//
// Browser support (verified):
//   Chrome / Android Chrome / Edge — works (VP9 + H.264 + Opus)
//   Firefox                        — works (VP8 / VP9)
//   Safari (macOS)                 — works (H.264, since 14.1)
//   iOS Safari                     — captureStream() not implemented
//                                    → fallback: ship source file as-is
//
// Hard size cap (50 MB) applies even when compression isn't supported, so
// the upload still has a sane upper bound.
// ═══════════════════════════════════════════════════════════════════════════
"use client";

const TARGET_MAX_DIM      = 1080;     // longest side, px
const TARGET_BITRATE      = 2_500_000; // 2.5 Mbps — matches IG reels
const TARGET_AUDIO_BITS   = 128_000;   // 128 kbps AAC/Opus
const HARD_FILE_CAP_BYTES = 50 * 1024 * 1024;   // 50 MB

export type CompressionResult = {
  /** Compressed Blob (or the original Blob if compression was skipped). */
  blob: Blob;
  /** MIME of the output (e.g. "video/webm;codecs=vp9,opus" or "video/mp4"). */
  mime: string;
  /** True if we actually re-encoded; false if we shipped the source as-is. */
  compressed: boolean;
  /** Reason compression was skipped (only set when compressed === false). */
  skippedReason?: string;
  /** Original / final byte counts for telemetry / UI. */
  originalBytes: number;
  finalBytes:    number;
};

/** Pick the best output mime the running browser actually supports. */
function pickOutputMime(): string {
  const candidates = [
    // H.264 MP4 lands directly playable on every platform without a transmux.
    "video/mp4;codecs=h264,aac",
    "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    "video/mp4",
    // VP9 WebM is the next-best: Chrome / Firefox / Android Chrome all
    // re-encode fast and the feed's <video> tags decode it cleanly.
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];
  for (const c of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(c)) {
      return c;
    }
  }
  return "";
}

/**
 * Compress a video Blob to IG-level quality (≤1080p longest side, ≤2.5 Mbps).
 * Returns the source as-is when the browser can't run the compression
 * pipeline (older iOS Safari, certain in-app webviews, etc.).
 */
export async function compressVideo(
  file: File | Blob,
  onProgress?: (pct: number) => void,
): Promise<CompressionResult> {
  const originalBytes = file.size;

  // Hard cap: refuse anything > 50 MB. The compression pipeline itself is
  // memory-hungry on mid-tier Android — 50 MB of source video can already
  // OOM the tab. Surface a clear error instead of crashing.
  if (originalBytes > HARD_FILE_CAP_BYTES) {
    throw new Error(
      `Video is ${(originalBytes / 1024 / 1024).toFixed(1)} MB — please trim it under 50 MB. Tip: shoot a shorter clip or use your phone's built-in trimmer.`
    );
  }

  // Probe browser capabilities. captureStream is the linchpin — without
  // it, we can't read frames + audio off a <video> into MediaRecorder.
  const probeVideo = document.createElement("video") as any;
  const hasCaptureStream = typeof probeVideo.captureStream === "function" || typeof probeVideo.mozCaptureStream === "function";
  const outMime = pickOutputMime();
  if (!hasCaptureStream || !outMime) {
    return {
      blob: file, mime: (file as File).type || "video/mp4", compressed: false,
      skippedReason: !hasCaptureStream
        ? "Browser doesn't support captureStream() — uploading original."
        : "Browser doesn't support any compression codec — uploading original.",
      originalBytes, finalBytes: originalBytes,
    };
  }

  const srcUrl = URL.createObjectURL(file);
  try {
    // Stage 1: load the video, learn duration + native resolution.
    const v = document.createElement("video");
    v.preload = "auto";
    v.muted = true;
    v.playsInline = true;
    (v as any).webkitPlaysInline = true;
    v.src = srcUrl;
    await new Promise<void>((res, rej) => {
      let settled = false;
      v.onloadedmetadata = () => { if (!settled) { settled = true; res(); } };
      v.onerror = () => { if (!settled) { settled = true; rej(new Error("Couldn't decode this video — try MP4 / H.264 or use your phone's gallery to export.")); } };
      setTimeout(() => { if (!settled) { settled = true; rej(new Error("Video metadata never loaded — file may be corrupt.")); } }, 8000);
    });
    const srcW = v.videoWidth, srcH = v.videoHeight, dur = v.duration;
    if (!srcW || !srcH || !dur || !isFinite(dur)) {
      throw new Error("Couldn't read this video's dimensions or duration.");
    }

    // Stage 2: pick target dims that fit inside TARGET_MAX_DIM while keeping
    // the source aspect ratio. If the source is already <= target, skip
    // compression entirely — re-encoding a 720p clip down adds nothing.
    const longestSrc = Math.max(srcW, srcH);
    if (longestSrc <= TARGET_MAX_DIM && originalBytes < 12 * 1024 * 1024) {
      return {
        blob: file, mime: (file as File).type || "video/mp4", compressed: false,
        skippedReason: "Already small + low-res — uploading original.",
        originalBytes, finalBytes: originalBytes,
      };
    }
    const scale = Math.min(1, TARGET_MAX_DIM / longestSrc);
    // Snap to even numbers — H.264 / VP9 want chroma subsampling alignment.
    const tgtW = Math.max(2, Math.round(srcW * scale / 2) * 2);
    const tgtH = Math.max(2, Math.round(srcH * scale / 2) * 2);

    // Stage 3: build the canvas + draw loop.
    const canvas = document.createElement("canvas");
    canvas.width = tgtW; canvas.height = tgtH;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Couldn't open a 2D canvas for compression.");

    // Stage 4: capture canvas stream + audio track (if present).
    const canvasStream: MediaStream = (canvas as any).captureStream(30);
    let audioTracks: MediaStreamTrack[] = [];
    try {
      const srcStream: MediaStream = (v as any).captureStream ? (v as any).captureStream() : (v as any).mozCaptureStream();
      audioTracks = srcStream.getAudioTracks();
      for (const t of audioTracks) canvasStream.addTrack(t);
    } catch { /* no audio is fine — the post may use a custom soundtrack anyway */ }

    // Stage 5: MediaRecorder. Lower video bitrate dramatically vs source —
    // IG/Reels targets ~2.5 Mbps for 1080p which is plenty for hotel reels.
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
    rec.start(250); // emit chunks every 250ms — smoother memory use

    // Stage 6: play the video and pump each frame into the canvas. Use
    // requestVideoFrameCallback when available (Chrome / Edge) — it fires
    // per actual decoded frame so the timing matches the source exactly.
    // Older browsers (Firefox / Safari) fall back to requestAnimationFrame.
    await v.play();
    const drawFrame = () => {
      try { ctx.drawImage(v, 0, 0, tgtW, tgtH); } catch {}
      if (onProgress && dur) onProgress(Math.min(100, (v.currentTime / dur) * 100));
    };
    const rvfc = (v as any).requestVideoFrameCallback;
    let stopped = false;
    if (typeof rvfc === "function") {
      const tick = () => { if (stopped) return; drawFrame(); (v as any).requestVideoFrameCallback(tick); };
      (v as any).requestVideoFrameCallback(tick);
    } else {
      const raf = () => { if (stopped) return; drawFrame(); requestAnimationFrame(raf); };
      requestAnimationFrame(raf);
    }

    await new Promise<void>((res) => {
      v.onended = () => res();
      // Watchdog: never exceed 1.5x source duration. If something hangs,
      // we still get whatever was already recorded out.
      setTimeout(() => { try { v.pause(); } catch {} ; res(); }, Math.max(15000, dur * 1500));
    });
    stopped = true;
    rec.stop();
    for (const t of audioTracks) { try { t.stop(); } catch {} }

    const blob = await stopPromise;

    // Sanity check: if the "compressed" output is somehow LARGER than the
    // source, ship the source — re-encoding a low-bitrate clip can balloon it.
    if (blob.size >= originalBytes) {
      return {
        blob: file, mime: (file as File).type || "video/mp4", compressed: false,
        skippedReason: "Compression result was larger than source — kept original.",
        originalBytes, finalBytes: originalBytes,
      };
    }

    return {
      blob,
      mime: outMime.split(";")[0] || "video/webm",
      compressed: true,
      originalBytes,
      finalBytes: blob.size,
    };
  } finally {
    try { URL.revokeObjectURL(srcUrl); } catch {}
  }
}
