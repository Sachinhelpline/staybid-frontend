// ─────────────────────────────────────────────────────────────────────────
// StayBid Voice AI — VOICE-AI-SB-04 — native WebRTC client (browser media).
//
// The native WebRTC media client (provider-neutral). It wraps the NATIVE
// RTCPeerConnection + getUserMedia (both INJECTABLE for tests — SB-04 makes no
// real device / provider connection) to:
//   • require an explicit start() call (the panel invokes it from a user gesture);
//   • hold exactly ONE peer connection + ONE mic stream per session;
//   • create ONE data channel used for DISPLAY-ONLY provider text — a data-channel
//     message can surface a bounded transcript line but can NEVER execute a
//     StayBid action (action authority is the gateway control socket alone);
//   • tear everything down on cancel/reset/dispose (tracks stopped, pc closed).
//
// LIFECYCLE-IDENTITY INVALIDATION (mirrors SB-02 audio-capture): a start() creates
// one attempt; cancel/dispose flips it inactive and a late getUserMedia resolution
// stops the just-granted tracks and creates no peer connection. No audio is ever
// persisted (no localStorage / IndexedDB / Cache / network beyond the RTC media).
//
// No React, no next/*, no provider SDK — native WebRTC only.
// ─────────────────────────────────────────────────────────────────────────

export const MAX_DC_TRANSCRIPT_LEN = 400;

export interface RtcTrackLike {
  stop: () => void;
}
export interface RtcMediaStreamLike {
  getTracks: () => RtcTrackLike[];
  getAudioTracks?: () => RtcTrackLike[];
}
export interface RtcDataChannelLike {
  label: string;
  readyState?: string;
  send?: (data: string) => void;
  close: () => void;
  onopen: ((ev?: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev?: unknown) => void) | null;
}
export interface RtcSessionDescLike {
  type: string;
  sdp?: string;
}
export interface RtcPeerConnectionLike {
  createDataChannel: (label: string) => RtcDataChannelLike;
  addTrack: (track: RtcTrackLike, stream: RtcMediaStreamLike) => void;
  createOffer: () => Promise<RtcSessionDescLike>;
  setLocalDescription: (desc: RtcSessionDescLike) => Promise<void>;
  setRemoteDescription: (desc: RtcSessionDescLike) => Promise<void>;
  close: () => void;
  ontrack: ((ev: { streams?: RtcMediaStreamLike[]; track?: RtcTrackLike }) => void) | null;
  onconnectionstatechange: ((ev?: unknown) => void) | null;
  connectionState?: string;
}

export interface WebrtcEnv {
  getUserMedia?: (constraints: unknown) => Promise<RtcMediaStreamLike>;
  RTCPeerConnectionCtor?: new (config?: unknown) => RtcPeerConnectionLike;
  /** Optional ICE config; never a provider credential. */
  rtcConfig?: unknown;
}

export interface WebrtcHooks {
  /** A bounded transcript line for DISPLAY only — never an action. */
  onTranscript?: (line: { role: "user" | "assistant"; text: string }) => void;
  onRemoteAudio?: (stream: RtcMediaStreamLike) => void;
  onConnectionState?: (state: string) => void;
}

export type WebrtcStart =
  | { ok: true; offerSdp: string }
  | { ok: false; failure: "unsupported" | "permission_denied" | "no_audio_track" | "pc_error" | "cancelled" };

interface WebrtcAttempt {
  active: boolean;
  stream: RtcMediaStreamLike | null;
  pc: RtcPeerConnectionLike | null;
  dc: RtcDataChannelLike | null;
}

function resolveEnv(injected?: WebrtcEnv): WebrtcEnv {
  if (injected) return injected;
  const g: any = typeof globalThis !== "undefined" ? globalThis : {};
  const nav: any = g.navigator;
  return {
    getUserMedia:
      nav && nav.mediaDevices && typeof nav.mediaDevices.getUserMedia === "function"
        ? (c: unknown) => nav.mediaDevices.getUserMedia(c)
        : undefined,
    RTCPeerConnectionCtor: typeof g.RTCPeerConnection === "function" ? g.RTCPeerConnection : undefined,
  };
}

/** Parse a provider data-channel event to a DISPLAY-ONLY transcript line, or null. */
export function parseDisplayTranscript(raw: unknown): { role: "user" | "assistant"; text: string } | null {
  let obj: unknown = raw;
  if (typeof raw === "string") {
    if (raw.length > 8 * 1024) return null;
    try {
      obj = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!obj || typeof obj !== "object") return null;
  const e = obj as Record<string, unknown>;
  // Accept ONLY an explicit transcript-shaped event; everything else is ignored
  // for display AND can never execute an action (there is no action path here).
  if (e.type !== "transcript" && e.type !== "response.audio_transcript.done") return null;
  const role = e.role === "assistant" || e.role === "user" ? e.role : "assistant";
  const textRaw = typeof e.text === "string" ? e.text : typeof e.transcript === "string" ? e.transcript : null;
  if (textRaw === null) return null;
  const text = textRaw.slice(0, MAX_DC_TRANSCRIPT_LEN);
  if (!text.trim()) return null;
  return { role, text };
}

export function createWebrtcSession(injected?: WebrtcEnv) {
  const env = resolveEnv(injected);
  let current: WebrtcAttempt | null = null;
  let disposed = false;
  // Monotonic attempt generation (SB04-SRC-REV-07): every async stage captures the
  // generation before its await and re-checks after; cancel/dispose bump it so a
  // late resolution can never open a socket, keep a track, or enter LISTENING.
  let generation = 0;

  function stopTracks(stream: RtcMediaStreamLike | null) {
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

  function teardown(a: WebrtcAttempt | null) {
    if (!a) return;
    a.active = false;
    if (a.dc) {
      try {
        a.dc.close();
      } catch {
        /* no-op */
      }
    }
    stopTracks(a.stream);
    if (a.pc) {
      try {
        a.pc.close();
      } catch {
        /* no-op */
      }
    }
    a.stream = null;
    a.pc = null;
    a.dc = null;
    if (current === a) current = null;
  }

  return {
    isActive: () => !!current && current.active,

    /**
     * Acquire the mic, build ONE peer connection + display data channel, and
     * return the local SDP offer. Must be called from a user gesture (the panel
     * enforces this). Returns null immediately if already active or disposed.
     */
    async start(hooks?: WebrtcHooks): Promise<WebrtcStart | null> {
      if (disposed || current) return null;
      if (!env.getUserMedia || !env.RTCPeerConnectionCtor) {
        return { ok: false, failure: "unsupported" };
      }
      const myGen = ++generation;
      const invalid = () => !attempt.active || disposed || myGen !== generation;
      const attempt: WebrtcAttempt = { active: true, stream: null, pc: null, dc: null };
      current = attempt;

      let stream: RtcMediaStreamLike;
      try {
        stream = await env.getUserMedia({ audio: true, video: false });
      } catch {
        teardown(attempt);
        return { ok: false, failure: "permission_denied" };
      }
      // Invalidated during acquisition → stop tracks, no peer connection.
      if (invalid()) {
        stopTracks(stream);
        if (current === attempt) current = null;
        return { ok: false, failure: "cancelled" };
      }
      attempt.stream = stream;
      const audioTracks = stream.getAudioTracks ? stream.getAudioTracks() : stream.getTracks();
      if (!audioTracks || audioTracks.length === 0) {
        teardown(attempt);
        return { ok: false, failure: "no_audio_track" };
      }

      let pc: RtcPeerConnectionLike;
      try {
        pc = new env.RTCPeerConnectionCtor(env.rtcConfig);
      } catch {
        teardown(attempt);
        return { ok: false, failure: "pc_error" };
      }
      attempt.pc = pc;
      pc.ontrack = (ev) => {
        if (!attempt.active) return;
        const s = ev && ev.streams && ev.streams[0];
        if (s) hooks?.onRemoteAudio?.(s);
      };
      pc.onconnectionstatechange = () => {
        if (attempt.active) hooks?.onConnectionState?.(pc.connectionState || "unknown");
      };

      // ONE display-only data channel — provider text for display, never actions.
      let dc: RtcDataChannelLike;
      try {
        dc = pc.createDataChannel("oai-events");
      } catch {
        teardown(attempt);
        return { ok: false, failure: "pc_error" };
      }
      attempt.dc = dc;
      dc.onmessage = (ev) => {
        if (!attempt.active) return;
        const line = parseDisplayTranscript(ev && ev.data);
        // A data-channel message can ONLY ever surface a bounded transcript for
        // display. It NEVER executes a StayBid action — there is no action path.
        if (line) hooks?.onTranscript?.(line);
      };

      try {
        pc.addTrack(audioTracks[0], stream);
      } catch {
        teardown(attempt);
        return { ok: false, failure: "pc_error" };
      }

      let offer: RtcSessionDescLike;
      try {
        offer = await pc.createOffer();
        if (invalid()) {
          teardown(attempt);
          return { ok: false, failure: "cancelled" };
        }
        await pc.setLocalDescription(offer);
      } catch {
        teardown(attempt);
        return { ok: false, failure: "pc_error" };
      }
      if (invalid()) {
        teardown(attempt);
        return { ok: false, failure: "cancelled" };
      }
      const sdp = typeof offer.sdp === "string" ? offer.sdp : "";
      if (!sdp) {
        teardown(attempt);
        return { ok: false, failure: "pc_error" };
      }
      return { ok: true, offerSdp: sdp };
    },

    /** Apply the provider answer SDP. Ownership is re-checked BEFORE and AFTER the
     *  await — a late answer for a cancelled/superseded attempt returns false and
     *  never mutates the connection (SB04-SRC-REV-07). */
    async acceptAnswer(answerSdp: string): Promise<boolean> {
      const a = current;
      const myGen = generation;
      if (!a || !a.active || !a.pc || disposed) return false;
      if (typeof answerSdp !== "string" || !answerSdp) return false;
      try {
        await a.pc.setRemoteDescription({ type: "answer", sdp: answerSdp });
      } catch {
        return false;
      }
      // Ownership changed during the await ⇒ discard (no LISTENING on a stale attempt).
      if (current !== a || !a.active || disposed || myGen !== generation) return false;
      return true;
    },

    /** Stop + discard the media session now. Idempotent. */
    cancel() {
      generation += 1;
      teardown(current);
    },
    /** Permanent teardown (unmount/navigation). Idempotent. */
    dispose() {
      disposed = true;
      generation += 1;
      teardown(current);
    },
  };
}

export type WebrtcSession = ReturnType<typeof createWebrtcSession>;
