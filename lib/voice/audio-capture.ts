// ─────────────────────────────────────────────────────────────────────────
// StayBid Voice AI — VOICE-AI-SB-02 — browser-only, injectable audio capture.
//
// Wraps getUserMedia + MediaRecorder behind a small, INJECTABLE surface so the
// state machine + tests can exercise it with fakes — there is NO real provider
// and NO real device access in SB-02 tests.
//
// LIFECYCLE-IDENTITY INVALIDATION (REREV-01): every start() creates ONE attempt
// object. stop()/cancel()/dispose() flip `attempt.active=false` and settle it
// IMMEDIATELY. If getUserMedia() resolves AFTER invalidation, the just-granted
// tracks are stopped and NO MediaRecorder is ever created / no success is
// resolved. cancel() settles CANCELLED *before* calling recorder.stop(), so a
// synchronous onstop can never win the race and report success; a later async
// onstop is inert (idempotent settle guard). Exactly one attempt exists at a
// time — a second start() while one is pending/active returns null (busy).
//
// RECORDER-STARTED SIGNAL (REREV-02): start() takes an optional onStarted hook
// invoked ONLY after recorder.start() actually succeeds AND the attempt is still
// live — the panel uses this to enter LISTENING (never merely because a Promise
// was returned).
//
// Guarantees: single MediaStream + single MediaRecorder; a single audio track
// (video never requested); MIME negotiated via isTypeSupported() (WebM never
// assumed); MAX_RECORDING_MS cutoff; MAX_UPLOAD_BYTES fail-closed ceiling;
// tracks/blobs released on every terminal path; raw audio in memory only — NO
// localStorage / IndexedDB / DB / network. No browser global read at load.
//
// Pure module surface: no React, no next/*, no @/lib imports.
// ─────────────────────────────────────────────────────────────────────────

export const MAX_RECORDING_MS = 20_000;
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024; // 4 MB future-upload ceiling

/** Candidate MIME types, negotiated in order against isTypeSupported(). */
export const MIME_CANDIDATES: readonly string[] = Object.freeze([
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/mp4",
  "audio/aac",
]);

// ---- injectable environment (defaults to the real browser globals) ----------
export interface MediaRecorderLike {
  start: (timeslice?: number) => void;
  stop: () => void;
  ondataavailable: ((ev: { data: BlobLike }) => void) | null;
  onstop: (() => void) | null;
  onerror: ((ev: unknown) => void) | null;
  state: string;
}
export interface BlobLike {
  size: number;
  type: string;
}
export interface MediaTrackLike {
  stop: () => void;
}
export interface MediaStreamLike {
  getTracks: () => MediaTrackLike[];
  getAudioTracks?: () => MediaTrackLike[];
}
export interface AudioCaptureEnv {
  getUserMedia?: (constraints: unknown) => Promise<MediaStreamLike>;
  MediaRecorderCtor?: {
    new (stream: MediaStreamLike, options?: { mimeType?: string }): MediaRecorderLike;
    isTypeSupported?: (type: string) => boolean;
  };
  BlobCtor?: { new (parts: unknown[], options?: { type?: string }): BlobLike };
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
}

export interface FeatureSupport {
  mediaDevices: boolean;
  getUserMedia: boolean;
  mediaRecorder: boolean;
  isTypeSupported: boolean;
}

function resolveEnv(injected?: AudioCaptureEnv): AudioCaptureEnv {
  if (injected) return injected;
  // Lazy — only read globals when actually invoked in a browser.
  const g: any = typeof globalThis !== "undefined" ? globalThis : {};
  const nav: any = g.navigator;
  return {
    getUserMedia:
      nav && nav.mediaDevices && typeof nav.mediaDevices.getUserMedia === "function"
        ? (c: unknown) => nav.mediaDevices.getUserMedia(c)
        : undefined,
    MediaRecorderCtor: typeof g.MediaRecorder === "function" ? g.MediaRecorder : undefined,
    BlobCtor: typeof g.Blob === "function" ? g.Blob : undefined,
    setTimeout: typeof g.setTimeout === "function" ? g.setTimeout.bind(g) : undefined,
    clearTimeout: typeof g.clearTimeout === "function" ? g.clearTimeout.bind(g) : undefined,
  };
}

/** Runtime feature detection — never throws, never assumes support. */
export function detectSupport(injected?: AudioCaptureEnv): FeatureSupport {
  const env = resolveEnv(injected);
  const rec = env.MediaRecorderCtor;
  return {
    mediaDevices: typeof env.getUserMedia === "function",
    getUserMedia: typeof env.getUserMedia === "function",
    mediaRecorder: typeof rec === "function",
    isTypeSupported: !!rec && typeof rec.isTypeSupported === "function",
  };
}

/** Negotiate the first supported MIME type, or "" when none is confirmed. */
export function negotiateMimeType(injected?: AudioCaptureEnv): string {
  const env = resolveEnv(injected);
  const rec = env.MediaRecorderCtor;
  if (!rec || typeof rec.isTypeSupported !== "function") return "";
  for (const type of MIME_CANDIDATES) {
    try {
      if (rec.isTypeSupported(type)) return type;
    } catch {
      /* ignore a throwing isTypeSupported */
    }
  }
  return "";
}

export type CaptureFailure =
  | "unsupported"
  | "permission_denied"
  | "no_audio_track"
  | "recorder_error"
  | "too_large"
  | "cancelled";

export interface CaptureResult {
  ok: boolean;
  mimeType: string;
  bytes: number;
  failure?: CaptureFailure;
}

export interface CaptureHooks {
  /** Invoked ONLY after recorder.start() succeeds and the attempt is still live. */
  onStarted?: () => void;
}

interface Attempt {
  active: boolean;
  settled: boolean;
  stream: MediaStreamLike | null;
  recorder: MediaRecorderLike | null;
  timer: unknown;
  bytes: number;
  finish: (res: CaptureResult) => void;
}

/**
 * Single-attempt audio capture. One instance owns at most one live stream +
 * recorder at a time; start() while active is refused (returns null) so a
 * repeated Start can never spawn a parallel acquisition/recorder.
 */
export function createAudioCapture(injected?: AudioCaptureEnv) {
  const env = resolveEnv(injected);
  let current: Attempt | null = null;
  let disposed = false;

  function stopTracks(stream: MediaStreamLike | null) {
    if (stream && stream.getTracks) {
      for (const t of stream.getTracks()) {
        try {
          t.stop();
        } catch {
          /* no-op */
        }
      }
    }
  }

  return {
    isActive: () => !!current && current.active,

    /**
     * Acquire mic + start recording. Resolves a CaptureResult when recording
     * finishes (stop/cutoff) or fails. Returns null immediately if already
     * active or disposed (no parallel attempt is ever created).
     */
    start(hooks?: CaptureHooks): Promise<CaptureResult> | null {
      if (disposed || current) return null;
      const support = detectSupport(env);
      if (!support.getUserMedia || !support.mediaRecorder || !env.MediaRecorderCtor) {
        return Promise.resolve({ ok: false, mimeType: "", bytes: 0, failure: "unsupported" });
      }
      const mimeType = negotiateMimeType(env);

      let resolveOuter!: (res: CaptureResult) => void;
      const p = new Promise<CaptureResult>((res) => (resolveOuter = res));

      const attempt: Attempt = {
        active: true,
        settled: false,
        stream: null,
        recorder: null,
        timer: null,
        bytes: 0,
        finish: () => {},
      };
      attempt.finish = (res: CaptureResult) => {
        if (attempt.settled) return; // idempotent — a late onstop is inert
        attempt.settled = true;
        attempt.active = false;
        if (attempt.timer != null && env.clearTimeout) {
          try {
            env.clearTimeout(attempt.timer);
          } catch {
            /* no-op */
          }
        }
        attempt.timer = null;
        stopTracks(attempt.stream);
        attempt.stream = null;
        attempt.recorder = null;
        if (current === attempt) current = null;
        resolveOuter(res);
      };
      current = attempt;

      Promise.resolve()
        .then(() => env.getUserMedia!({ audio: true, video: false }))
        .then((s) => {
          // Late resolution after invalidation (stop/cancel/dispose): stop the
          // just-granted tracks IMMEDIATELY (finish() is a no-op once settled, so
          // it cannot stop them for us), create NO recorder, resolve NOT-success.
          if (!attempt.active || disposed) {
            stopTracks(s);
            attempt.stream = null;
            attempt.finish({ ok: false, mimeType, bytes: 0, failure: "cancelled" });
            return;
          }
          attempt.stream = s;
          const audioTracks = s.getAudioTracks ? s.getAudioTracks() : s.getTracks();
          if (!audioTracks || audioTracks.length === 0) {
            attempt.finish({ ok: false, mimeType, bytes: 0, failure: "no_audio_track" });
            return;
          }
          let rec: MediaRecorderLike;
          try {
            rec = new env.MediaRecorderCtor!(s, mimeType ? { mimeType } : undefined);
          } catch {
            attempt.finish({ ok: false, mimeType, bytes: 0, failure: "recorder_error" });
            return;
          }
          attempt.recorder = rec;
          rec.ondataavailable = (ev) => {
            if (!attempt.active) return;
            const data = ev && ev.data;
            if (data && typeof data.size === "number") {
              attempt.bytes += data.size;
              if (attempt.bytes > MAX_UPLOAD_BYTES) {
                // Fail closed FIRST (never keep/upload), then stop the recorder.
                attempt.finish({ ok: false, mimeType, bytes: attempt.bytes, failure: "too_large" });
                try {
                  if (rec.state !== "inactive") rec.stop();
                } catch {
                  /* no-op */
                }
              }
            }
          };
          rec.onerror = () => {
            if (attempt.active) attempt.finish({ ok: false, mimeType, bytes: attempt.bytes, failure: "recorder_error" });
          };
          rec.onstop = () => {
            // Only the live attempt may resolve success; a post-cancel onstop is inert.
            if (attempt.active) attempt.finish({ ok: true, mimeType, bytes: attempt.bytes });
          };
          try {
            rec.start();
          } catch {
            attempt.finish({ ok: false, mimeType, bytes: 0, failure: "recorder_error" });
            return;
          }
          // Invalidated during the synchronous start()? Tear down, no success.
          if (!attempt.active || disposed) {
            try {
              if (rec.state !== "inactive") rec.stop();
            } catch {
              /* no-op */
            }
            attempt.finish({ ok: false, mimeType, bytes: attempt.bytes, failure: "cancelled" });
            return;
          }
          // Recorder truly started — signal LISTENING now (never before).
          if (hooks && typeof hooks.onStarted === "function") {
            try {
              hooks.onStarted();
            } catch {
              /* no-op */
            }
          }
          if (env.setTimeout) {
            attempt.timer = env.setTimeout(() => {
              try {
                if (attempt.recorder && attempt.recorder.state !== "inactive") attempt.recorder.stop();
              } catch {
                /* no-op */
              }
            }, MAX_RECORDING_MS);
          }
        })
        .catch(() => attempt.finish({ ok: false, mimeType, bytes: 0, failure: "permission_denied" }));

      return p;
    },

    /** Stop the active recording. Recording → normal completion via onstop;
     *  a still-pending acquisition → cancelled (nothing was recorded). */
    stop() {
      const a = current;
      if (!a) return;
      if (a.recorder && a.active) {
        try {
          if (a.recorder.state !== "inactive") a.recorder.stop();
          else a.finish({ ok: true, mimeType: "", bytes: a.bytes });
        } catch {
          a.finish({ ok: false, mimeType: "", bytes: a.bytes, failure: "recorder_error" });
        }
      } else {
        a.finish({ ok: false, mimeType: "", bytes: a.bytes, failure: "cancelled" });
      }
    },

    /** Cancel + discard now. Settles CANCELLED BEFORE stopping the recorder so a
     *  synchronous onstop cannot report success. The active recorder reference is
     *  captured BEFORE finish() clears attempt state, so the physical recorder is
     *  always stopped exactly once (SB02-R1 Blocker A). Idempotent. */
    cancel() {
      const a = current;
      if (!a) return;
      const rec = a.recorder; // capture BEFORE finish() nulls it
      a.active = false;
      a.finish({ ok: false, mimeType: "", bytes: a.bytes, failure: "cancelled" });
      if (rec) {
        try {
          if (rec.state !== "inactive") rec.stop();
        } catch {
          /* no-op */
        }
      }
    },

    /** Permanent teardown (unmount/navigation). Invalidates pending acquisition
     *  AND active recording — the active recorder is captured before finish()
     *  clears it and stopped exactly once. Idempotent. */
    dispose() {
      disposed = true;
      const a = current;
      if (a) {
        const rec = a.recorder; // capture BEFORE finish() nulls it
        a.active = false;
        a.finish({ ok: false, mimeType: "", bytes: a.bytes, failure: "cancelled" });
        if (rec) {
          try {
            if (rec.state !== "inactive") rec.stop();
          } catch {
            /* no-op */
          }
        }
      }
    },
  };
}

export type AudioCapture = ReturnType<typeof createAudioCapture>;
