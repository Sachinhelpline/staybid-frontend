// ─────────────────────────────────────────────────────────────────────────
// StayBid Voice AI — VOICE-AI-SB-04 — browser gateway control client.
//
// The browser's ONLY link to the Railway Voice gateway's typed control channel.
// It:
//   • POSTs the WebRTC SDP offer to the SAME-ORIGIN /api/voice/session broker
//     (never a caller URL — the fetch path is a fixed relative string);
//   • opens ONE control WebSocket to the gateway, carrying the short-lived
//     control token in the WebSocket SUBPROTOCOL (Sec-WebSocket-Protocol),
//     NEVER a query string (no credential in a URL);
//   • validates EVERY inbound frame (byte-size + validateServerControl) before
//     it is surfaced — an oversized / malformed / unknown frame is dropped;
//   • sends only encodeClientControl-validated cancel/reset/close frames;
//   • enforces a single control connection and full teardown.
//
// Provider media (audio) does NOT ride this channel — it is a native WebRTC peer
// connection (the native WebRTC media client). This client carries only bounded,
// provider-neutral StayBid control. Injectable fetch + WebSocket ctor for tests;
// no React, no next/*, no provider import.
// ─────────────────────────────────────────────────────────────────────────
import {
  type VoiceClientControl,
  type VoiceServerControl,
  MAX_CONTROL_FRAME_BYTES,
  validateServerControl,
  encodeClientControl,
} from "./transport-contracts";
import { type BrokerClientResponse } from "./provider";

const BROKER_PATH = "/api/voice/session";

export type GatewayFetch = (
  path: string,
  init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

/** Minimal WebSocket surface (the browser global, or a fake in tests). */
export interface WebSocketLike {
  send: (data: string) => void;
  close: (code?: number, reason?: string) => void;
  onopen: ((ev?: unknown) => void) | null;
  onclose: ((ev?: unknown) => void) | null;
  onerror: ((ev?: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  /** The negotiated subprotocol after open (the browser WebSocket sets this). */
  protocol?: string;
}

/** R3 (SB04-R2-REREV-09): bound how long we wait for the control socket to open. */
const CONTROL_OPEN_TIMEOUT_MS = 6_000;
export type WebSocketCtor = (url: string, protocols?: string | string[]) => WebSocketLike;

export interface GatewayClientEnv {
  fetchImpl: GatewayFetch;
  WebSocketCtor: WebSocketCtor;
  /**
   * Absolute wss:// base for the gateway control socket. Optional: if empty, the
   * base is taken from the broker response's `controlWsBase` (server-derived).
   * Either way it MUST resolve to a wss:// origin or start() fails closed.
   */
  gatewayControlBase?: string;
}

export interface GatewayClientHooks {
  onServerControl: (msg: VoiceServerControl) => void;
  onOpen?: () => void;
  onClose?: (code?: number) => void;
  onError?: (reason: string) => void;
}

export type StartResult =
  | { ok: true; broker: BrokerClientResponse }
  | {
      ok: false;
      code: "broker_failed" | "malformed_broker_response" | "already_open" | "config_error";
    };

/** Measure a frame's UTF-8 byte length without allocating (fail-closed guard). */
function utf8ByteLength(s: string): number {
  let bytes = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) bytes += 1;
    else if (c < 0x800) bytes += 2;
    else if (c >= 0xd800 && c <= 0xdbff) {
      bytes += 4;
      i++;
    } else bytes += 3;
  }
  return bytes;
}

function isWssBase(v: string): boolean {
  try {
    const u = new URL(v);
    return u.protocol === "wss:" && !!u.hostname && !u.username && !u.password;
  } catch {
    return false;
  }
}

export function createGatewayClient(env: GatewayClientEnv, hooks: GatewayClientHooks) {
  let ws: WebSocketLike | null = null;
  let sessionId: string | null = null;
  let closed = false;
  // R2 (SB04-R1-REREV-07): abort an in-flight broker fetch on dispose/close so a
  // Stop during the network exchange really cancels the request (not just the
  // post-await socket open).
  let startAbort: AbortController | null = null;

  function teardown(code?: number) {
    const sock = ws;
    ws = null;
    if (sock) {
      sock.onopen = null;
      sock.onclose = null;
      sock.onerror = null;
      sock.onmessage = null;
      try {
        sock.close(code);
      } catch {
        /* no-op */
      }
    }
  }

  function sendControl(msg: VoiceClientControl): boolean {
    if (!ws) return false;
    const encoded = encodeClientControl(msg);
    if (!encoded) return false;
    try {
      ws.send(encoded);
      return true;
    } catch {
      return false;
    }
  }

  return {
    isOpen: () => !!ws && !closed,
    currentSessionId: () => sessionId,

    /**
     * Exchange the SDP offer via the same-origin broker, then open the single
     * control socket. The control token rides the WebSocket subprotocol, never a
     * query string. Returns the bounded broker response (answer SDP, etc).
     */
    async start(sdpOffer: string, visibleHotelIds?: string[]): Promise<StartResult> {
      if (ws) return { ok: false, code: "already_open" };
      if (closed) return { ok: false, code: "broker_failed" };
      startAbort = typeof AbortController !== "undefined" ? new AbortController() : null;
      // R3 (REREV-10): forward the bounded ordered visible-hotel-id list (shape-only;
      // the gateway server-verifies each). Never a URL/path/instruction.
      const ids = Array.isArray(visibleHotelIds)
        ? visibleHotelIds.filter((v) => typeof v === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(v)).slice(0, 24)
        : [];
      let res;
      try {
        res = await env.fetchImpl(BROKER_PATH, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(ids.length ? { sdp: sdpOffer, visibleHotelIds: ids } : { sdp: sdpOffer }),
          signal: startAbort?.signal,
        });
      } catch {
        // Aborted (dispose/close during the exchange) or network failure → closed.
        return { ok: false, code: "broker_failed" };
      }
      if (closed) return { ok: false, code: "broker_failed" };
      if (!res || !res.ok) return { ok: false, code: "broker_failed" };
      let body: unknown;
      try {
        body = await res.json();
      } catch {
        return { ok: false, code: "malformed_broker_response" };
      }
      const b = body as Partial<BrokerClientResponse> | null;
      if (
        !b ||
        typeof b.sessionId !== "string" ||
        typeof b.answerSdp !== "string" ||
        typeof b.controlToken !== "string" ||
        typeof b.controlPath !== "string"
      ) {
        return { ok: false, code: "malformed_broker_response" };
      }
      // SB04-SRC-REV-07: if disposed/closed during the broker await, do NOT open a
      // late control socket.
      if (closed) return { ok: false, code: "broker_failed" };
      // Resolve the wss base: explicit env base wins; otherwise the server-derived
      // controlWsBase from the broker response. Must be a valid wss origin.
      const candidateBase =
        env.gatewayControlBase && isWssBase(env.gatewayControlBase)
          ? env.gatewayControlBase
          : typeof b.controlWsBase === "string" && isWssBase(b.controlWsBase)
            ? b.controlWsBase
            : null;
      if (!candidateBase) return { ok: false, code: "config_error" };
      sessionId = b.sessionId;
      const base = candidateBase.replace(/\/+$/, "");
      const url = `${base}${b.controlPath}`;
      // Token in the SUBPROTOCOL — never in the URL/query.
      const subprotocol = `staybid-voice.${b.controlToken}`;
      let sock: WebSocketLike;
      try {
        sock = env.WebSocketCtor(url, subprotocol);
      } catch {
        return { ok: false, code: "broker_failed" };
      }
      ws = sock;
      // R3 (REREV-09): the control socket is NOT ready just because it was
      // constructed. AWAIT its OPEN within a bounded timeout and require the
      // negotiated subprotocol to carry our token. On error/close/timeout/wrong
      // protocol BEFORE open, dispose and fail — the browser must never enter
      // LISTENING without an authoritative, open control channel.
      const opened = await new Promise<boolean>((resolve) => {
        let settled = false;
        const finish = (v: boolean) => {
          if (settled) return;
          settled = true;
          resolve(v);
        };
        const openTimer = setTimeout(() => finish(false), CONTROL_OPEN_TIMEOUT_MS);
        sock.onopen = () => {
          clearTimeout(openTimer);
          if (closed) return finish(false);
          // The negotiated subprotocol (when the platform reports it) must match.
          const proto = typeof sock.protocol === "string" ? sock.protocol : "";
          if (proto && proto !== subprotocol) return finish(false);
          finish(true);
        };
        sock.onerror = () => {
          clearTimeout(openTimer);
          finish(false);
        };
        sock.onclose = () => {
          clearTimeout(openTimer);
          finish(false);
        };
      });
      if (!opened || closed) {
        teardown(1011);
        return { ok: false, code: "config_error" };
      }
      // Now wired for the live session — swap in the durable handlers + surface open.
      sock.onclose = (ev: any) => {
        const code = ev && typeof ev.code === "number" ? ev.code : undefined;
        if (ws === sock) ws = null;
        hooks.onClose?.(code);
      };
      sock.onerror = () => hooks.onError?.("socket_error");
      if (!closed) hooks.onOpen?.();
      sock.onmessage = (ev) => {
        const data = ev && ev.data;
        if (typeof data !== "string") return; // never accept binary control frames
        if (utf8ByteLength(data) > MAX_CONTROL_FRAME_BYTES) return; // oversized → drop
        let parsed: unknown;
        try {
          parsed = JSON.parse(data);
        } catch {
          return; // malformed → drop
        }
        const msg = validateServerControl(parsed);
        if (!msg) return; // unknown/invalid → drop (fail closed)
        hooks.onServerControl(msg);
      };
      return { ok: true, broker: b as BrokerClientResponse };
    },

    cancelTurn(turnId: number): boolean {
      return sendControl({ t: "cancel_turn", turnId });
    },
    resetSession(): boolean {
      return sendControl({ t: "reset_session" });
    },
    closeSession(): boolean {
      const sent = sendControl({ t: "close_session" });
      teardown(1000);
      return sent;
    },

    /** Permanent teardown (unmount/navigation). Idempotent. */
    dispose() {
      closed = true;
      try {
        startAbort?.abort();
      } catch {
        /* no-op */
      }
      startAbort = null;
      teardown(1000);
      sessionId = null;
    },
  };
}

export type GatewayClient = ReturnType<typeof createGatewayClient>;
