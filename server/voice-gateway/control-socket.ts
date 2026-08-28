// ─────────────────────────────────────────────────────────────────────────
// StayBid Voice AI — VOICE-AI-SB-04 — browser↔gateway control socket.
//
// Carries ONLY typed, provider-neutral StayBid control. Auth = the short-lived
// control token in the WebSocket SUBPROTOCOL (Sec-WebSocket-Protocol) — NEVER a
// query string. Guarantees:
//   • the token is verified (HMAC, bound to sessionId+subject, ≤10 min) BEFORE the
//     socket is used; a forged / reused-for-another-session / expired token closes
//     the socket;
//   • ONE control connection per session (a second is refused);
//   • every inbound frame is byte-size-bounded + validateClientControl'd; an
//     unknown / malformed / oversized frame is dropped safely;
//   • only cancel_turn / reset_session / close_session are accepted from the
//     browser — it can never inject a capability or a raw url/tool.
//
// Testable pure helpers (parse / authorize / handle-frame) drive a fake socket;
// the Fastify wiring in index.ts is a thin adapter over them.
// ─────────────────────────────────────────────────────────────────────────
import { type GatewayConfig } from "./config";
import { verifyControlToken } from "./auth";
import { validateClientControl } from "./schemas";
import { type SessionStore, type VoiceGatewaySession } from "./sessions";
import { type ServerControlFrame } from "./sideband";

export const CONTROL_SUBPROTOCOL_PREFIX = "staybid-voice.";
const MAX_CONTROL_FRAME_BYTES = 8 * 1024;

export interface GatewaySocket {
  send: (data: string) => void;
  close: (code?: number, reason?: string) => void;
}

function utf8Len(s: string): number {
  return Buffer.byteLength(s, "utf8");
}

/** Extract the control token from the negotiated subprotocol(s), or null. */
export function parseControlSubprotocol(sub: string | string[] | undefined): string | null {
  const list = Array.isArray(sub) ? sub : typeof sub === "string" ? sub.split(",") : [];
  for (const rawEntry of list) {
    const entry = rawEntry.trim();
    if (entry.startsWith(CONTROL_SUBPROTOCOL_PREFIX)) {
      const token = entry.slice(CONTROL_SUBPROTOCOL_PREFIX.length);
      if (token && token.length <= 4096) return token;
    }
  }
  return null;
}

export type ControlOpenResult =
  | { ok: true; session: VoiceGatewaySession }
  | { ok: false; closeCode: number; code: "no_token" | "bad_token" | "no_session" | "already_bound" | "subject_mismatch" };

export interface ControlOpenDeps {
  subprotocol: string | string[] | undefined;
  sessionId: string;
  config: GatewayConfig;
  store: SessionStore;
  now?: () => number;
}

/** Authorize a control-socket open. Fails CLOSED with a specific close code. */
export function authorizeControlOpen(deps: ControlOpenDeps): ControlOpenResult {
  const now = deps.now || (() => Date.now());
  const token = parseControlSubprotocol(deps.subprotocol);
  if (!token) return { ok: false, closeCode: 4400, code: "no_token" };
  const verified = verifyControlToken(token, deps.sessionId, deps.config, now);
  if (!verified.ok) return { ok: false, closeCode: 4401, code: "bad_token" };
  const session = deps.store.get(deps.sessionId);
  if (!session) return { ok: false, closeCode: 4404, code: "no_session" };
  if (session.subject !== verified.subject) return { ok: false, closeCode: 4401, code: "subject_mismatch" };
  if (!deps.store.bindControl(session)) return { ok: false, closeCode: 4409, code: "already_bound" };
  return { ok: true, session };
}

export type FrameOutcome =
  | { action: "cancel"; turnId: number }
  | { action: "reset" }
  | { action: "close" }
  | { action: "drop"; reason: "oversized" | "malformed" | "unknown" };

export interface FrameDeps {
  raw: unknown;
  session: VoiceGatewaySession;
  store: SessionStore;
  socket: GatewaySocket;
  /** The session's provider refs (cancel/close). Defaults to session.provider. */
  provider?: { cancelTurn?: () => void; close?: () => void } | null;
  emit?: (frame: ServerControlFrame) => void;
}

/** Handle ONE inbound client control frame. Fails closed on anything unexpected.
 *  cancel_turn/reset reach the ACTUAL current provider sideband + clear the turn
 *  timers; close_session authoritatively terminates every session resource. */
export function handleControlFrame(deps: FrameDeps): FrameOutcome {
  const { raw, session, store, socket } = deps;
  const provider = deps.provider !== undefined ? deps.provider : session.provider;
  if (typeof raw !== "string") return { action: "drop", reason: "malformed" };
  if (utf8Len(raw) > MAX_CONTROL_FRAME_BYTES) return { action: "drop", reason: "oversized" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { action: "drop", reason: "malformed" };
  }
  const msg = validateClientControl(parsed);
  if (!msg) return { action: "drop", reason: "unknown" };

  switch (msg.t) {
    case "cancel_turn":
      store.cancelTurn(session, msg.turnId);
      try {
        provider?.cancelTurn?.();
      } catch {
        /* no-op */
      }
      deps.emit?.({ t: "status", status: "cancelled", turnId: msg.turnId });
      return { action: "cancel", turnId: msg.turnId };
    case "reset_session":
      session.allowlist.clear();
      store.cancelTurn(session, session.turnId);
      try {
        provider?.cancelTurn?.();
      } catch {
        /* no-op */
      }
      deps.emit?.({ t: "status", status: "idle", turnId: session.turnId });
      return { action: "reset" };
    case "close_session":
      // Authoritative termination — provider, sideband, timers, and this socket.
      store.close(session.sessionId);
      try {
        socket.close(1000);
      } catch {
        /* no-op */
      }
      return { action: "close" };
    default:
      return { action: "drop", reason: "unknown" };
  }
}

/** A size-guarded emit: never sends an oversized control frame to the browser. */
export function makeSocketEmit(socket: GatewaySocket): (frame: ServerControlFrame) => void {
  return (frame) => {
    let s: string;
    try {
      s = JSON.stringify(frame);
    } catch {
      return;
    }
    if (utf8Len(s) > MAX_CONTROL_FRAME_BYTES) return;
    try {
      socket.send(s);
    } catch {
      /* no-op */
    }
  };
}
