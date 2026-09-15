// ─────────────────────────────────────────────────────────────────────────
// StayBid Live AI — LIVE-AI-02A — provider-neutral async transport contract.
//
// The CLOSED transport surface between the conversation controller and whatever
// carries frames (nothing, in the dormant default). The PRODUCTION default is the
// NULL transport: FAIL-CLOSED, NO microphone, NO fetch, NO WebSocket, NO WebRTC,
// NO provider — every method is inert and getConnectionState() is "disconnected".
//
// The gateway-backed transport (lib/live-ai/gateway-client.ts) implements the SAME
// interface and only ever activates when all four dormancy gates + valid config are
// present AND the user has explicitly requested microphone/provider mode. The
// controller never sends an executable url/route/selector — the frame schemas
// (protocol.ts) have no field for any of those, and both ends re-validate.
//
// PURE module: no I/O, no React, no next/*. createNullTransport() does nothing.
// ─────────────────────────────────────────────────────────────────────────
import type {
  PublishedContext,
  ContextPublishFrame,
  ActionReceiptFrame,
  ActionAcceptedFrame,
  ServerFrame,
  InterruptReason,
  LiveAiLanguage,
} from "./protocol";

export type ConnectionState = "disconnected" | "connecting" | "connected" | "error" | "offline";

export type TransportStartResult =
  | { ok: true }
  | {
      ok: false;
      code:
        | "disabled"
        | "unsupported"
        | "permission_denied"
        | "broker_unavailable"
        | "gateway_unavailable"
        | "invalid_response"
        // R3-03 — the SINGLE-START OWNER primitive: a start() while the transport already
        // owns a session (any non-disconnected state) is REFUSED with this code and never
        // disturbs the current owner (no supersede, no clobber). The caller must reach the
        // DISCONNECTED state (end/reset) before starting again.
        | "already_active";
    };

/** Events the transport emits to the controller: connection changes + validated
 *  gateway frames (never a raw provider event — gateway-client re-validates first). */
export type TransportEvent =
  | { type: "connection"; state: ConnectionState }
  | { type: "frame"; frame: ServerFrame };

export interface TransportStartInput {
  sessionId: string;
  turnId: string;
  generation: number;
  mode: "text" | "microphone";
  context: PublishedContext;
}

export interface LiveAiTransport {
  readonly kind: "null" | "gateway";
  start(input: TransportStartInput): Promise<TransportStartResult>;
  submitText(input: {
    sessionId: string;
    turnId: string;
    generation: number;
    text: string;
    languageHint?: LiveAiLanguage;
  }): boolean;
  publishContext(input: ContextPublishFrame): boolean;
  /** R3-05 — announce an accepted proposal (binds the browser-minted actionId to the
   *  gateway's pending proposal) BEFORE the receipt; the gateway records it so a later
   *  receipt must carry the exact accepted actionId. */
  submitActionAccepted(input: ActionAcceptedFrame): boolean;
  submitActionReceipt(input: ActionReceiptFrame): boolean;
  /** R2-08 — the browser APPROVES an emitted answer plan (binding it to planId +
   *  authorityRef + textHash + turn + generation). This is the ONLY signal that lets
   *  the gateway begin TTS; without it no speech is ever synthesized. */
  submitApproval(input: {
    sessionId: string;
    turnId: string;
    generation: number;
    planId: string;
    authorityRef: string;
    textHash: string;
  }): boolean;
  interrupt(input: { sessionId: string; turnId: string; generation: number; reason: InterruptReason }): void;
  reset(input: { sessionId: string; generation: number }): void;
  end(input: { sessionId: string; generation: number; reason: "user" | "timeout" | "unmount" }): void;
  subscribe(listener: (event: TransportEvent) => void): () => void;
  getConnectionState(): ConnectionState;
}

/**
 * The PRODUCTION default transport: permanently disconnected, does no network /
 * mic / WebRTC / provider work. Live AI therefore stays fully dormant end-to-end
 * unless a gateway transport is explicitly constructed AND every gate is on.
 */
export function createNullTransport(): LiveAiTransport {
  return Object.freeze({
    kind: "null" as const,
    start: async (): Promise<TransportStartResult> => ({ ok: false, code: "disabled" as const }),
    submitText: () => false,
    publishContext: () => false,
    submitActionAccepted: () => false,
    submitActionReceipt: () => false,
    submitApproval: () => false,
    interrupt: () => {},
    reset: () => {},
    end: () => {},
    subscribe: (_listener: (event: TransportEvent) => void) => () => {},
    getConnectionState: (): ConnectionState => "disconnected",
  });
}
