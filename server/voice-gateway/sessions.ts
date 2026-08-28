// ─────────────────────────────────────────────────────────────────────────
// StayBid Voice AI — VOICE-AI-SB-04 — in-memory session store + runtime binding.
//
// Each session is ONE authoritative runtime binding (SB04-SRC-REV-03): it holds
// the provider realtime/media termination handle, the private sideband, the
// current browser control emitter + close handle, the active turn, and the live
// timers. Cryptographically-random ids; ONE active session per subject; per
// subject / IP-hash / global concurrency; a bounded hotel allowlist; tool + cost
// counters; a cancellation flag — all MEMORY-ONLY (no DB, no Redis).
//
// REAL enforcement (SB04-SRC-REV-05): active timers terminate the session on the
// 10-minute lifetime cap, the 60-second idle cap, the 30-second single-utterance
// cap, the 5-minute cumulative-speech cap, and the 12-second turn-completion cap.
// terminate() (SB04-SRC-REV-06) closes the provider, the sideband, the control
// socket, clears every timer, and emits a final bounded frame — a kill/drain or
// expiry really ends every resource, and later events become inert.
//
// Single-process, in-memory ⇒ the Strong-Beta ONE-active-replica constraint
// (documented). A restart drops every session + all counters. No secret/PII is
// stored (pseudonymous subject; salted IP hash). Timers are unref'd so they never
// keep the process alive; tests inject a fake clock + fake timers.
// ─────────────────────────────────────────────────────────────────────────
import { randomBytes } from "node:crypto";
import { type GatewayLimits } from "./config";
import type { ServerControlFrame } from "./sideband";

const MAX_ALLOWLIST = 64;

export type RuntimeEmit = (frame: ServerControlFrame) => void;

export interface TimerFacility {
  set: (fn: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
}

function defaultTimers(): TimerFacility {
  return {
    set: (fn, ms) => {
      const h = setTimeout(fn, ms) as unknown as { unref?: () => void };
      if (h && typeof h.unref === "function") h.unref();
      return h;
    },
    clear: (h) => {
      if (h) clearTimeout(h as ReturnType<typeof setTimeout>);
    },
  };
}

export interface ProviderRefs {
  /** Opaque provider session handle — never a key. Closed on teardown. */
  close?: () => void;
  /** Cancel the current provider turn (barge-in / cancel). */
  cancelTurn?: () => void;
}

export type TerminateReason = "session_max" | "idle_timeout" | "utterance_max" | "speech_max" | "kill" | "closed";

export interface VoiceGatewaySession {
  sessionId: string;
  subject: string;
  ipHash: string;
  authenticated: boolean;
  createdAt: number;
  expiresAt: number;
  lastActivityAt: number;
  turnId: number;
  turnActive: boolean;
  cancelled: boolean;
  controlBound: boolean;
  terminated: boolean;
  allowlist: Set<string>;
  toolCallsThisTurn: number;
  toolCallsThisSession: number;
  costCents: number;
  cumulativeSpeechMs: number;
  utteranceStartAt: number | null;
  provider: ProviderRefs | null;
  emit: RuntimeEmit | null;
  controlClose: (() => void) | null;
  // R3 (SB04-R2-REREV-04): the ONE cancellation token for the active turn's in-flight
  // work — tool fetches (incl. compareHotels children) subscribe to its signal, and a
  // turn cancel / timeout / termination aborts it so a late fetch resolves to nothing.
  turnAbort: AbortController | null;
  timers: { session: unknown; idle: unknown; turn: unknown; utterance: unknown; control: unknown };
}

export type CreateDecision =
  | { ok: true; session: VoiceGatewaySession }
  | { ok: false; reason: "subject_concurrency" | "ip_concurrency" | "global_concurrency" };

export interface SessionStoreDeps {
  limits: GatewayLimits;
  now?: () => number;
  timers?: TimerFacility;
}

function newSessionId(): string {
  return `vses_${randomBytes(18).toString("hex")}`;
}

export function createSessionStore(deps: SessionStoreDeps) {
  const now = deps.now || (() => Date.now());
  const timers = deps.timers || defaultTimers();
  const L = deps.limits;
  const byId = new Map<string, VoiceGatewaySession>();

  function countBy(pred: (s: VoiceGatewaySession) => boolean): number {
    let n = 0;
    byId.forEach((s) => {
      if (pred(s)) n += 1;
    });
    return n;
  }

  function clearTimers(s: VoiceGatewaySession) {
    timers.clear(s.timers.session);
    timers.clear(s.timers.idle);
    timers.clear(s.timers.turn);
    timers.clear(s.timers.utterance);
    timers.clear(s.timers.control);
    s.timers = { session: null, idle: null, turn: null, utterance: null, control: null };
  }

  /** Authoritatively terminate ALL resources for a session. Idempotent. */
  function terminate(session: VoiceGatewaySession | null, reason: TerminateReason): boolean {
    if (!session || session.terminated) return false;
    session.terminated = true;
    session.cancelled = true;
    clearTimers(session);
    // R3 (REREV-04): abort any in-flight turn work (tool fetches) on termination.
    try {
      session.turnAbort?.abort();
    } catch {
      /* no-op */
    }
    session.turnAbort = null;
    // A final bounded frame to the browser (best effort; never throws).
    try {
      if (session.emit) session.emit({ t: "error", code: "session_ended", turnId: session.turnId });
    } catch {
      /* no-op */
    }
    try {
      session.provider?.close?.();
    } catch {
      /* no-op */
    }
    try {
      session.controlClose?.();
    } catch {
      /* no-op */
    }
    session.emit = null;
    session.controlClose = null;
    byId.delete(session.sessionId);
    return true;
  }

  function armIdle(s: VoiceGatewaySession) {
    timers.clear(s.timers.idle);
    s.timers.idle = timers.set(() => terminate(s, "idle_timeout"), L.idleTimeoutMs);
  }

  function prune() {
    const t = now();
    const dead: VoiceGatewaySession[] = [];
    byId.forEach((s) => {
      if (t >= s.expiresAt || t - s.lastActivityAt >= L.idleTimeoutMs) dead.push(s);
    });
    dead.forEach((s) => terminate(s, t >= s.expiresAt ? "session_max" : "idle_timeout"));
  }

  return {
    size: () => byId.size,

    create(input: { subject: string; ipHash: string; authenticated: boolean }): CreateDecision {
      prune();
      const t = now();
      if (countBy((s) => s.subject === input.subject) >= L.activeSessionsPerSubject) {
        return { ok: false, reason: "subject_concurrency" };
      }
      if (countBy((s) => s.ipHash === input.ipHash) >= L.activeSessionsPerIp) {
        return { ok: false, reason: "ip_concurrency" };
      }
      if (byId.size >= L.globalActiveSessions) {
        return { ok: false, reason: "global_concurrency" };
      }
      const session: VoiceGatewaySession = {
        sessionId: newSessionId(),
        subject: input.subject,
        ipHash: input.ipHash,
        authenticated: input.authenticated,
        createdAt: t,
        expiresAt: t + L.maxSessionMs,
        lastActivityAt: t,
        turnId: 0,
        turnActive: false,
        cancelled: false,
        controlBound: false,
        terminated: false,
        allowlist: new Set<string>(),
        toolCallsThisTurn: 0,
        toolCallsThisSession: 0,
        costCents: 0,
        cumulativeSpeechMs: 0,
        utteranceStartAt: null,
        provider: null,
        emit: null,
        controlClose: null,
        turnAbort: null,
        timers: { session: null, idle: null, turn: null, utterance: null, control: null },
      };
      byId.set(session.sessionId, session);
      // Arm the hard session-lifetime cap + the idle cap immediately.
      session.timers.session = timers.set(() => terminate(session, "session_max"), L.maxSessionMs);
      armIdle(session);
      return { ok: true, session };
    },

    get(sessionId: unknown): VoiceGatewaySession | null {
      if (typeof sessionId !== "string") return null;
      const s = byId.get(sessionId);
      if (!s) return null;
      if (now() >= s.expiresAt) {
        terminate(s, "session_max");
        return null;
      }
      return s;
    },

    /** Record meaningful Voice activity — resets the idle timer. */
    touch(s: VoiceGatewaySession) {
      s.lastActivityAt = now();
      if (!s.terminated) armIdle(s);
    },

    /** Attach the runtime emitter + control-close handle (control-socket open). */
    bindRuntime(s: VoiceGatewaySession, emit: RuntimeEmit, controlClose: () => void) {
      // R2 (REREV-02): a terminated session accepts no new runtime binding; close
      // the incoming control handle immediately so nothing dangles.
      if (s.terminated) {
        try {
          controlClose();
        } catch {
          /* no-op */
        }
        return;
      }
      s.emit = emit;
      s.controlClose = controlClose;
      // R3 (REREV-09): the browser control channel attached — cancel the deadline.
      timers.clear(s.timers.control);
      s.timers.control = null;
    },
    /** R3 (REREV-09): arm a bounded deadline for the browser control socket to
     *  attach. If it does not (the browser could not open the authoritative control
     *  channel), the session is terminated — which hangs up the provider call and
     *  clears every timer, so no provider call is left alive without control. */
    armControlDeadline(s: VoiceGatewaySession, ms: number) {
      if (s.terminated || s.emit) return; // already bound or dead
      timers.clear(s.timers.control);
      s.timers.control = timers.set(() => {
        if (!s.terminated && !s.emit) terminate(s, "closed");
      }, ms);
    },
    /** Attach the provider termination handle (session create). */
    bindProvider(s: VoiceGatewaySession, provider: ProviderRefs) {
      // R2 (REREV-02): never bind a provider onto a dead session — tear it down.
      if (s.terminated) {
        try {
          provider.close?.();
        } catch {
          /* no-op */
        }
        return;
      }
      s.provider = provider;
    },

    bindControl(s: VoiceGatewaySession): boolean {
      if (s.controlBound) return false;
      s.controlBound = true;
      return true;
    },

    beginTurn(s: VoiceGatewaySession): number {
      // R2 (SB04-R1-REREV-02): a terminated session is PERMANENTLY inert — never
      // begin a turn, re-arm a timer, or bump the turn counter on a dead session.
      if (s.terminated) return s.turnId;
      // R3 (REREV-04): a fresh turn gets a fresh cancellation token; abort the prior.
      try {
        s.turnAbort?.abort();
      } catch {
        /* no-op */
      }
      s.turnAbort = typeof AbortController !== "undefined" ? new AbortController() : null;
      s.turnId += 1;
      s.turnActive = true;
      s.toolCallsThisTurn = 0;
      s.cancelled = false;
      s.utteranceStartAt = null;
      this.touch(s);
      // Arm the per-turn completion timer — a turn that never completes is ACTIVELY
      // cancelled: provider response.cancel + abort in-flight tool work (REREV-04).
      timers.clear(s.timers.turn);
      const my = s.turnId;
      s.timers.turn = timers.set(() => {
        if (s.turnId === my && !s.terminated) {
          s.cancelled = true;
          try {
            s.provider?.cancelTurn?.();
          } catch {
            /* no-op */
          }
          try {
            s.turnAbort?.abort();
          } catch {
            /* no-op */
          }
          try {
            if (s.emit) s.emit({ t: "error", code: "turn_timeout", turnId: my });
          } catch {
            /* no-op */
          }
        }
      }, L.turnCompletionTimeoutMs);
      return s.turnId;
    },
    completeTurn(s: VoiceGatewaySession, turnId: number) {
      if (s.terminated) return;
      if (turnId === s.turnId) {
        s.turnActive = false;
        timers.clear(s.timers.turn);
        timers.clear(s.timers.utterance);
        s.utteranceStartAt = null;
      }
      this.touch(s);
    },
    cancelTurn(s: VoiceGatewaySession, turnId: number) {
      if (s.terminated) return;
      if (turnId === s.turnId) {
        s.cancelled = true;
        s.turnActive = false;
        timers.clear(s.timers.turn);
        timers.clear(s.timers.utterance);
        s.utteranceStartAt = null;
        // R3 (REREV-04): a cancel actively stops provider work + aborts tool fetches.
        try {
          s.provider?.cancelTurn?.();
        } catch {
          /* no-op */
        }
        try {
          s.turnAbort?.abort();
        } catch {
          /* no-op */
        }
      }
      this.touch(s);
    },
    /** Ensure a turn is active before processing an event; begins one if not
     *  (multi-turn: a completed turn is superseded by a fresh monotonic turn). */
    ensureTurn(s: VoiceGatewaySession): number {
      // R2 (SB04-R1-REREV-02): NEVER reanimate a terminated session. Return the
      // frozen turnId so the sideband sees the event as stale (cancelled) and
      // discards it — no turn begins, no timer re-arms.
      if (s.terminated) return s.turnId;
      if (!s.turnActive) return this.beginTurn(s);
      return s.turnId;
    },

    /** Begin measuring a single utterance — the ≤20s single-utterance cap is a HARD
     *  safety boundary (R4 SB04-R3-REREV-04). `response.cancel` cancels a response
     *  but does NOT provably stop incoming WebRTC user audio, so at the ceiling the
     *  WHOLE voice session is TERMINATED: terminate() performs the supported
     *  provider call hangup (via provider.close → sideband hangup), aborts tool
     *  work, clears every timer, seals the session (a later response.created /
     *  tool / result is permanently inert), and closes the browser control channel
     *  with the bounded terminal frame. */
    startUtterance(s: VoiceGatewaySession) {
      if (s.terminated) return;
      s.utteranceStartAt = now();
      timers.clear(s.timers.utterance);
      const my = s.turnId;
      s.timers.utterance = timers.set(() => {
        if (s.turnId === my && !s.terminated) {
          // Best-effort immediate response cancel, then the authoritative hard stop.
          try {
            s.provider?.cancelTurn?.();
          } catch {
            /* no-op */
          }
          terminate(s, "utterance_max");
        }
      }, L.maxUtteranceMs);
      this.touch(s);
    },
    /** Finish an utterance — accrue cumulative speech; enforce the 5-minute cap. */
    endUtterance(s: VoiceGatewaySession): boolean {
      if (s.terminated) return false;
      if (s.utteranceStartAt != null) {
        s.cumulativeSpeechMs += Math.max(0, now() - s.utteranceStartAt);
        s.utteranceStartAt = null;
        timers.clear(s.timers.utterance);
      }
      if (s.cumulativeSpeechMs > L.maxSpeechMsPerSession) {
        terminate(s, "speech_max");
        return false;
      }
      return true;
    },

    allowHotelIds(s: VoiceGatewaySession, ids: string[]) {
      if (s.terminated) return;
      for (const id of ids) {
        if (s.allowlist.size >= MAX_ALLOWLIST) break;
        s.allowlist.add(id);
      }
    },
    hasHotelId(s: VoiceGatewaySession, id: string): boolean {
      return s.allowlist.has(id);
    },

    canRunTool(s: VoiceGatewaySession): boolean {
      if (s.terminated) return false;
      return s.toolCallsThisTurn < L.toolCallsPerTurn && s.toolCallsThisSession < L.toolCallsPerSession;
    },
    recordToolCall(s: VoiceGatewaySession) {
      if (s.terminated) return;
      s.toolCallsThisTurn += 1;
      s.toolCallsThisSession += 1;
      this.touch(s);
    },

    addCost(s: VoiceGatewaySession, cents: number) {
      if (s.terminated) return;
      if (Number.isFinite(cents) && cents > 0) s.costCents += cents;
    },
    /** Reconcile a reservation downward when real usage < reserved (never below 0). */
    refundCost(s: VoiceGatewaySession, cents: number) {
      if (Number.isFinite(cents) && cents > 0) s.costCents = Math.max(0, s.costCents - cents);
    },

    /** Close ONE session + all its resources. */
    close(sessionId: string) {
      terminate(byId.get(sessionId) || null, "closed");
    },
    terminate,
    prune,

    /** Kill-switch drain: terminate every active session + its resources. */
    drainAll(): number {
      const all = Array.from(byId.values());
      let n = 0;
      all.forEach((s) => {
        if (terminate(s, "kill")) n += 1;
      });
      return n;
    },
  };
}

export type SessionStore = ReturnType<typeof createSessionStore>;
