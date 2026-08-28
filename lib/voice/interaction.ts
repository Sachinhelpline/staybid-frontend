// ─────────────────────────────────────────────────────────────────────────
// StayBid Voice AI — VOICE-AI-SB-02 — interaction bridge (untrusted → SB-01).
//
// This is the ONLY place a (future) provider transport reaches the frozen SB-01
// capability layer. It NEVER weakens SB-01:
//   • the transport is INJECTED — SB-02 ships NO real provider; the default
//     transport returns a provider_unavailable error (it never fakes output);
//   • every transport response is re-validated (validateTransportResponse);
//   • a capability proposal is re-checked by evaluatePolicy() + run through the
//     SB-01 read adapters (fixed method/path, allowlisted ids, bounded output);
//   • a UI-action proposal is re-validated by the SB-01 dispatcher (OPEN_HOTEL
//     allowlist recheck, PREPARE_BID_DRAFT local-only, no write path);
//   • a monotonic sessionGeneration + the SB-01 per-turn stale check reject a
//     result that resolved after reset/cancel/supersede — BEFORE any UI update;
//   • an action loop is hard-capped (MAX_ACTIONS_PER_TURN) so a malformed
//     transport can never spin capabilities forever.
//
// There is NO url/method/proxy/Supabase/Railway/RPC path here. No React,
// no next/*, no provider import — the only effect is the injected transport +
// the SB-01 adapters' injected fetch.
// ─────────────────────────────────────────────────────────────────────────
import { type VoiceSession, type VoiceTurn } from "./session";
import { evaluatePolicy } from "./policy";
import { searchHotels, getHotelDetails, getFlashDeals, compareHotels, type FetchLike } from "./adapters";
import { type DispatchOutcome } from "./actions";
import { type VoiceUiAction } from "./contracts";
import {
  type VoiceTransportRequest,
  type VoiceLanguageHint,
  type VoiceErrorCode,
  type VoiceHistoryTurn,
  buildTransportRequest,
  validateTransportResponse,
  boundHistory,
  MAX_ACTIONS_PER_TURN,
} from "./transport-contracts";

/** A bounded tool result handed back to the transport for its next step. */
export interface ToolRun {
  capability: string;
  ok: boolean;
  reason?: string;
  count?: number;
}

/** The transport a provider packet will implement. SB-02 ships only fakes/null. */
export interface VoiceTransport {
  respond(req: VoiceTransportRequest, toolRuns: ToolRun[]): Promise<unknown>;
}

/** Default transport — NEVER fakes a provider answer; always fails closed. */
export const nullTransport: VoiceTransport = {
  async respond() {
    return { kind: "error", code: "provider_unavailable" as VoiceErrorCode };
  },
};

export type InteractionOutcome =
  | { ok: true; kind: "answer" | "clarify"; text: string; toolRuns: ToolRun[] }
  | { ok: true; kind: "ui_action"; action: VoiceUiAction; dispatch: DispatchOutcome; toolRuns: ToolRun[] }
  | { ok: false; kind: "error"; code: VoiceErrorCode; detail?: string; toolRuns: ToolRun[] };

export interface InteractionDeps {
  session: VoiceSession;
  /** The SB-01 dispatcher (validates + routes a VoiceUiAction). */
  dispatch: (candidate: unknown) => DispatchOutcome;
  /** Injected transport (default: nullTransport — no provider in SB-02). */
  transport?: VoiceTransport;
  /** Injected fetch for the SB-01 read adapters (default: same-origin global). */
  fetchImpl?: FetchLike;
}

export interface SubmitInput {
  transcript: string;
  languageHint?: VoiceLanguageHint;
  visibleHotelIds?: string[];
  history?: VoiceHistoryTurn[];
}

export function createVoiceInteraction(deps: InteractionDeps) {
  const transport = deps.transport || nullTransport;
  let generation = 0;
  let currentTurn: VoiceTurn | null = null;
  // Single-flight submission ownership (SB02-R1-NEW-02): each submit claims a
  // distinct id; only that owner may release the active slot, so a stale/late
  // submission can never clear a newer one, and a second concurrent submit is
  // gated (returns "busy") — no overlapping turns.
  let submissionSeq = 0;
  let activeSubmission = 0; // 0 = no active submission

  async function runCapability(
    capability: string,
    input: Record<string, unknown>,
    turn: VoiceTurn,
  ): Promise<{ run: ToolRun }> {
    // Re-check the static policy gate for EVERY proposed capability.
    const decision = evaluatePolicy({ capability, input }, deps.session);
    if (!decision.ok) return { run: { capability: String(capability), ok: false, reason: decision.reason } };

    const ctx = { session: deps.session, turn, fetchImpl: deps.fetchImpl };
    if (capability === "searchHotels") {
      const r = await searchHotels(ctx, { city: (input.city as string) ?? null, q: (input.q as string) ?? null });
      return { run: { capability, ok: r.ok, reason: r.ok ? undefined : r.reason, count: r.ok ? r.data.length : 0 } };
    }
    if (capability === "getHotelDetails") {
      const r = await getHotelDetails(ctx, { id: String(input.id) });
      return { run: { capability, ok: r.ok, reason: r.ok ? undefined : r.reason, count: r.ok ? 1 : 0 } };
    }
    if (capability === "getFlashDeals") {
      const r = await getFlashDeals(ctx, { city: (input.city as string) ?? null });
      return { run: { capability, ok: r.ok, reason: r.ok ? undefined : r.reason, count: r.ok ? r.data.length : 0 } };
    }
    if (capability === "compareHotels") {
      const r = compareHotels(deps.session, (input.hotelIds as unknown[]) || []);
      return { run: { capability, ok: r.ok, reason: r.ok ? undefined : r.reason, count: r.ok ? r.data.hotels.length : 0 } };
    }
    return { run: { capability: String(capability), ok: false, reason: "capability_not_allowlisted" } };
  }

  return {
    currentGeneration: () => generation,

    /** True while a submission owns the active slot (single-flight). */
    isBusy: () => activeSubmission !== 0,

    /** Reset: bump generation + reset the SB-01 session (invalidates in-flight
     *  turn AND clears the hotel allowlist / trusted map) + release the active
     *  submission slot so a fresh submission can start. */
    reset() {
      generation += 1;
      if (currentTurn) currentTurn.cancel();
      currentTurn = null;
      activeSubmission = 0;
      deps.session.reset();
    },

    /** Cancel: invalidate the CURRENT interaction turn immediately (bumps the
     *  generation + aborts the in-flight turn) WITHOUT wiping the session
     *  allowlist, and RELEASE the active submission slot so a new submission can
     *  begin. Any in-flight submit that resolves after this becomes stale before
     *  any dispatch / UI mutation, and its owner-scoped finally cannot clear the
     *  newer submission's slot. Idempotent. */
    cancel() {
      generation += 1;
      if (currentTurn) currentTurn.cancel();
      currentTurn = null;
      activeSubmission = 0;
    },

    /**
     * Run one interaction turn. Fails closed on every ambiguity. A result that
     * resolves after reset/cancel/supersede is rejected as stale before any UI
     * mutation.
     */
    async submit(input: SubmitInput): Promise<InteractionOutcome> {
      const toolRuns: ToolRun[] = [];
      // Single-flight gate: refuse a second concurrent submission (no overlap,
      // no second transport call) — the caller stays on the first turn.
      if (activeSubmission !== 0) return { ok: false, kind: "error", code: "busy", toolRuns };
      const mySubmission = ++submissionSeq;
      activeSubmission = mySubmission;
      const myGeneration = generation;
      try {
        return await runSubmit(input, toolRuns, myGeneration);
      } finally {
        // ONLY the owner releases the slot — a stale submission whose slot was
        // already taken over (cancel→new submit) must never clear the newer one.
        if (activeSubmission === mySubmission) activeSubmission = 0;
      }
    },
  };

  async function runSubmit(
    input: SubmitInput,
    toolRuns: ToolRun[],
    myGeneration: number,
  ): Promise<InteractionOutcome> {
    {

      // REREV-06: BUILD + VALIDATE the request FIRST. A turnId is required for
      // the request, so begin the turn, but perform ZERO allowlist mutation
      // until the request is proven valid.
      const turn = deps.session.beginTurn();
      currentTurn = turn;
      const stale = () => turn.isStale() || turn.signal.aborted || generation !== myGeneration;

      const req = buildTransportRequest({
        transcript: input.transcript,
        languageHint: input.languageHint,
        history: boundHistory(input.history),
        visibleHotelIds: input.visibleHotelIds,
        sessionGeneration: myGeneration,
        turnId: turn.turnId,
      });
      // Invalid/empty request → fail closed with NO allowlist mutation.
      if (!req) return { ok: false, kind: "error", code: "empty_transcript", toolRuns };

      // Seed the allowlist ONLY from the validated/de-duplicated/≤24 ids the
      // request produced — never from the raw caller input.
      deps.session.allowHotelIds(req.visibleHotelIds);

      let steps = 0;
      // Bounded reason→act loop. Each iteration asks the transport, executes at
      // most one capability, and feeds the bounded result back.
      while (steps <= MAX_ACTIONS_PER_TURN) {
        let raw: unknown;
        try {
          raw = await transport.respond(req, toolRuns);
        } catch {
          return { ok: false, kind: "error", code: "model_failed", toolRuns };
        }
        if (stale()) return { ok: false, kind: "error", code: "stale_result", toolRuns };

        const resp = validateTransportResponse(raw);
        if (!resp) return { ok: false, kind: "error", code: "malformed_response", toolRuns };

        if (resp.kind === "answer" || resp.kind === "clarify") {
          return { ok: true, kind: resp.kind, text: resp.text, toolRuns };
        }
        if (resp.kind === "error") {
          return { ok: false, kind: "error", code: resp.code, toolRuns };
        }
        if (resp.kind === "ui_action") {
          // Route through the SB-01 dispatcher (re-validates + allowlist recheck).
          const dispatch = deps.dispatch(resp.action);
          // REREV-04: a REJECTED dispatch is a bounded FAILURE — never overall
          // success. The SB-01 rejection reason is authoritative; the UI must
          // not show an "Applied" success for a policy-rejected action.
          if (!dispatch.ok) {
            return { ok: false, kind: "error", code: "action_rejected", detail: dispatch.reason, toolRuns };
          }
          return { ok: true, kind: "ui_action", action: resp.action, dispatch, toolRuns };
        }
        // resp.kind === "capability": enforce the loop cap, then execute + continue.
        if (steps >= MAX_ACTIONS_PER_TURN) {
          return { ok: false, kind: "error", code: "too_many_actions", toolRuns };
        }
        steps += 1;
        const { run } = await runCapability(resp.capability, resp.input, turn);
        if (stale()) return { ok: false, kind: "error", code: "stale_result", toolRuns };
        toolRuns.push(run);
        // Loop back to the transport with the accumulated tool results.
      }
      return { ok: false, kind: "error", code: "too_many_actions", toolRuns };
    }
  }
}

export type VoiceInteraction = ReturnType<typeof createVoiceInteraction>;

// ═══════════════════════════════════════════════════════════════════════════
// VOICE-AI-SB-04 — gateway-driven turn router.
//
// SB-04 moves the authoritative reason→act loop to the Railway gateway sideband;
// the browser receives only bounded, validated VoiceServerControl frames over the
// control socket. This router applies those frames to the /hotels UI THROUGH the
// SB-01 dispatcher, while PRESERVING the SB-02 turn-ownership + stale-rejection
// guarantees:
//   • each spoken turn is an SB-01 session turn (monotonic id + generation);
//   • a `ui_action` frame is re-validated by the SB-01 dispatcher AND dropped
//     unless it belongs to the CURRENT (non-stale) turn/generation — a provider
//     result that resolves after cancel/reset can never mutate the UI;
//   • cancel()/reset() bump the generation so every later frame is stale.
//
// The router NEVER trusts a frame as authority: the dispatcher's allowlist +
// closed-union re-validation is the gate, exactly as in SB-02.
// ═══════════════════════════════════════════════════════════════════════════
import { type VoiceServerControl, type VoiceServerStatus } from "./transport-contracts";

export interface GatewayRouterDeps {
  session: VoiceSession;
  dispatch: (candidate: unknown) => DispatchOutcome;
  hooks?: {
    onStatus?: (status: VoiceServerStatus, turnId: number) => void;
    onTranscript?: (line: { role: "user" | "assistant"; text: string }, turnId: number) => void;
    onResult?: (r: { kind: "answer" | "clarify"; text: string }, turnId: number) => void;
    onAction?: (outcome: DispatchOutcome, turnId: number) => void;
    onTurnComplete?: (turnId: number) => void;
    onError?: (code: VoiceErrorCode, turnId: number) => void;
  };
}

export type GatewayFrameOutcome =
  | { handled: true; kind: VoiceServerControl["t"]; dispatch?: DispatchOutcome }
  | { handled: false; reason: "stale" | "no_active_turn" };

export function createGatewayTurnRouter(deps: GatewayRouterDeps) {
  // The GATEWAY assigns authoritative monotonic turn ids; the browser only TRACKS
  // them. A frame is fresh iff its turnId is the current-or-newer turn AND that
  // turn has not been cancelled/reset. cancel()/reset() raise a `cancelledThrough`
  // watermark so every frame for the cancelled turn (and older) is stale — a
  // provider result that resolves after cancel can never mutate the UI.
  let generation = 0;
  let currentTurnId = -1;
  let cancelledThrough = -1;
  let started = false; // a spoken turn has begun (guards ui_action before any turn)

  function fresh(turnId: number): boolean {
    if (turnId <= cancelledThrough) return false; // cancelled/reset turn (or older)
    if (currentTurnId >= 0 && turnId < currentTurnId) return false; // a superseded older turn
    return true;
  }
  function advance(turnId: number) {
    if (turnId > currentTurnId) currentTurnId = turnId;
    started = true;
  }

  return {
    currentGeneration: () => generation,
    activeTurnId: () => currentTurnId,

    /** Mark the intent to speak. The gateway still owns turn numbering; this only
     *  arms the router so a ui_action arriving before any turn is refused. */
    beginTurn(): number {
      started = true;
      return currentTurnId;
    },

    /** Apply ONE validated server-control frame. Every turn-scoped state mutation
     *  (status/transcript/result/ui_action) is dropped when stale; a ui_action is
     *  re-validated by the SB-01 dispatcher AND ownership-checked BEFORE dispatch. */
    handleServerControl(msg: VoiceServerControl): GatewayFrameOutcome {
      switch (msg.t) {
        case "status":
          if (!fresh(msg.turnId)) return { handled: false, reason: "stale" };
          advance(msg.turnId);
          deps.hooks?.onStatus?.(msg.status, msg.turnId);
          return { handled: true, kind: "status" };
        case "transcript":
          if (!fresh(msg.turnId)) return { handled: false, reason: "stale" };
          advance(msg.turnId);
          deps.hooks?.onTranscript?.({ role: msg.role, text: msg.text }, msg.turnId);
          return { handled: true, kind: "transcript" };
        case "result":
          if (!fresh(msg.turnId)) return { handled: false, reason: "stale" };
          advance(msg.turnId);
          deps.hooks?.onResult?.({ kind: msg.kind, text: msg.text }, msg.turnId);
          return { handled: true, kind: "result" };
        case "ui_action": {
          if (!started) return { handled: false, reason: "no_active_turn" };
          if (!fresh(msg.turnId)) return { handled: false, reason: "stale" };
          advance(msg.turnId);
          // The SB-01 dispatcher re-validates the action + rechecks the allowlist.
          const dispatch = deps.dispatch(msg.action);
          deps.hooks?.onAction?.(dispatch, msg.turnId);
          return { handled: true, kind: "ui_action", dispatch };
        }
        case "turn_complete":
          // R3 (SB04-R2-REREV-05): a STALE turn_complete must NOT invoke the hook. A
          // fresh turn_complete surfaces once and then PERMANENTLY SEALS its turn id
          // (terminal watermark) — a later frame for the same turn can never become
          // fresh again.
          if (!fresh(msg.turnId)) return { handled: false, reason: "stale" };
          advance(msg.turnId);
          deps.hooks?.onTurnComplete?.(msg.turnId);
          cancelledThrough = Math.max(cancelledThrough, msg.turnId); // seal
          return { handled: true, kind: "turn_complete" };
        case "error":
          // R3 (REREV-05): a SESSION-terminal error (session_ended) always surfaces —
          // it invalidates the whole session, not one turn. A TURN-scoped error
          // (turn_timeout/cost_limit/action_rejected/…) must be FRESH to surface; a
          // stale turn's error is dropped.
          if (msg.code === "session_ended") {
            cancelledThrough = Math.max(cancelledThrough, currentTurnId);
            deps.hooks?.onError?.(msg.code, msg.turnId);
            return { handled: true, kind: "error" };
          }
          if (!fresh(msg.turnId)) return { handled: false, reason: "stale" };
          advance(msg.turnId);
          deps.hooks?.onError?.(msg.code, msg.turnId);
          cancelledThrough = Math.max(cancelledThrough, msg.turnId); // an errored turn is terminal
          return { handled: true, kind: "error" };
        default:
          return { handled: false, reason: "stale" };
      }
    },

    /** Cancel the current turn — every frame for it (and older) becomes stale. */
    cancel() {
      generation += 1;
      cancelledThrough = Math.max(cancelledThrough, currentTurnId);
      started = false;
    },

    /** Reset — cancel + clear the SB-01 session allowlist/turn. */
    reset() {
      generation += 1;
      cancelledThrough = Math.max(cancelledThrough, currentTurnId);
      started = false;
      deps.session.reset();
    },
  };
}

export type GatewayTurnRouter = ReturnType<typeof createGatewayTurnRouter>;

// ─── R3 (SB04-R2-REREV-09/11): the component attempt-ownership state machine ──
// The EXACT ownership logic VoicePanel's realtime path runs — extracted here so a
// plain Node test can drive the same code the component uses (no React test dep).
// One attempt is current at a time; `begin()` supersedes every older attempt, and
// each async stage re-checks `isCurrent()` before mutating UI or tearing down a
// NEWER attempt's resources. `invalidate()` (Stop/unmount/teardown) makes every
// outstanding attempt stale without starting a new one.
export function createAttemptOwner() {
  let generation = 0;
  return {
    /** Start a NEW attempt: supersedes all prior attempts; returns its handle. */
    begin() {
      generation += 1;
      const my = generation;
      return {
        id: my,
        /** True while THIS attempt is still the current one. */
        isCurrent: () => generation === my,
        /** True when a newer attempt / an invalidate has superseded this one. */
        superseded: () => generation !== my,
      };
    },
    /** Invalidate every outstanding attempt (Stop / teardown / unmount). */
    invalidate() {
      generation += 1;
    },
    current: () => generation,
  };
}
export type AttemptOwner = ReturnType<typeof createAttemptOwner>;
