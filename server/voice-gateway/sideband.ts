// ─────────────────────────────────────────────────────────────────────────
// StayBid Voice AI — VOICE-AI-SB-04 — private server-side sideband control.
//
// The AUTHORITATIVE provider tool-execution surface. The gateway — NOT the browser
// data channel — owns the reason→act loop: it consumes VALIDATED provider events
// (tool call / answer / OPEN_HOTEL), enforces the per-turn tool-call cap, runs the
// fixed four-tool adapter, sends bounded normalized results back to the provider,
// and emits typed gateway→browser control frames. A provider completion that
// arrives AFTER a cancel / turn supersede is DISCARDED before any browser frame.
//
// R6 (SB04-R5-REREV-02): the RESPONSE-REQUEST SCHEDULER. StayBid uses the DEFAULT
// realtime conversation, which writes ONE response at a time — so at most ONE
// authoritative provider response pipeline may be outstanding. Each potential
// inference (a committed user utterance OR a tool continuation) becomes its OWN
// bounded reservation record with an auditable ORIGIN; the serialized slot sends
// exactly one `response.create`, binds exactly one `response.created` (defense-in-
// depth via an echoed non-secret request id) to exactly one reservation, reconciles
// exactly that response's `response.done`, seals it, and only THEN dispatches the
// next eligible work. There is no aggregate pending-reservation number.
// ─────────────────────────────────────────────────────────────────────────
import { type ProviderEvent, type UiAction, type ServerStatus, validateProviderEvent } from "./schemas";
import { type SessionStore, type VoiceGatewaySession } from "./sessions";
import { type ToolExecutor, authorizeUiAction } from "./tool-executor";
import { type SidebandConnection } from "./openai-realtime";
import { type Telemetry } from "./telemetry";
import { type GatewayConfig } from "./config";
import { type RateLimiter, estimateTurnCents, estimateToolCents, costCentsForUsage } from "./rate-limit";

/** Gateway → browser control frame (the wire contract the browser validates). */
export type ServerControlFrame =
  | { t: "status"; status: ServerStatus; turnId: number }
  | { t: "transcript"; role: "user" | "assistant"; text: string; turnId: number }
  | { t: "result"; kind: "answer" | "clarify"; text: string; turnId: number }
  | { t: "ui_action"; action: UiAction; turnId: number }
  | { t: "turn_complete"; turnId: number }
  | { t: "error"; code: string; turnId: number };

export type EmitFrame = (frame: ServerControlFrame) => void;

export type HandleOutcome =
  | { status: "discarded"; reason: "stale" | "stale_after_tool" }
  | { status: "handled"; kind: ProviderEvent["kind"]; detail?: string };

export interface SidebandDeps {
  store: SessionStore;
  executor: ToolExecutor;
  telemetry: Telemetry;
  config: GatewayConfig;
  rateLimiter: RateLimiter;
}

/** R2 (REREV-03/04): per-session-connection reconcile + response-ownership state. */
export interface ReconContext {
  /** responseId → cents RESERVED for that ONE response, reconciled on its response.done. */
  reserved: Map<string, number>;
  /** responseIds that are DONE/SEALED — a later event on one is discarded. */
  sealed: Set<string>;
  /** the current event's provider responseId (if any). */
  rid?: string;
}

// R6 (SB04-R5-REREV-02): the auditable origin of ONE response request. No anonymous
// aggregate — every reservation is owned by exactly one committed utterance or one
// tool continuation.
type RequestOrigin =
  | { kind: "user_commit"; itemId: string }
  | { kind: "tool_continuation"; parentResponseId: string; callId: string };

interface RequestRecord {
  requestId: string;
  origin: RequestOrigin;
  reservationCents: number;
  state: "CREATE_SENT" | "ACTIVE" | "TERMINAL";
  providerResponseId?: string;
}

// The serialized default-conversation response scheduler for ONE session.
interface Scheduler {
  conn: SidebandConnection | null;
  slot: "IDLE" | "PENDING" | "ACTIVE";
  current: RequestRecord | null;
  queue: RequestOrigin[];
  seq: number;
  terminal: boolean;
  reserved: Map<string, number>;
  sealed: Set<string>;
  responseTurn: Map<string, number>;
  // callIds whose tool continuation has already been enqueued/consumed — no duplicate
  // continuation for one call.
  continuedCalls: Set<string>;
  // R7 (SB04-R6-REREV-04): consecutive tool-continuation dispatches since the last user_commit
  // dispatch — the starvation-guard counter (reset to 0 whenever a user_commit dispatches).
  continuationRun: number;
  // R7.1 (SB04-R7-01): CURRENT-TURN TOOL-CONTINUATION DEBT, keyed by callId. Holds ONLY
  // barrier-BLOCKING debts (state PENDING_TOOL / TOOL_READY); a debt is DELETED the instant it
  // reaches CONTINUATION_QUEUED (the continuation is now physically in the queue ahead of user work)
  // or RESOLVED (no continuation owed) — so `debt.size > 0` == an unresolved current-turn continuation
  // that a later user_commit must not leap ahead of.
  debt: Map<string, ContinuationDebt>;
  // R7.2 (SB04-R7.1-REREV-01): AUTHORITATIVE ACCEPT-ONCE registry — callId → the ownership signature
  // of the ONE accepted invocation. Recorded at ACCEPTANCE (after the read-only canRunTool check, but
  // BEFORE any cost reservation / tool-budget consumption / executor invocation / continuation-debt
  // creation / function output / continuation authority). Any later same-callId event is INERT when the
  // signature is identical, or FAILS CLOSED when it conflicts (impossible provider ownership
  // corruption). Bounded by the per-session tool cap; NEVER evicted within the live session (replay-safe).
  acceptedCalls: Map<string, { sig: string; parentResponseId: string; turnId: number }>;
}

// R7.2 (SB04-R7.1-REREV-01): a compact, deterministic OWNERSHIP signature for an accepted tool call —
// parent response id + tool name + bounded validated input (presentationIntent lives inside input). A
// same-callId replay whose signature DIFFERS is a protocol-ownership conflict; an identical signature
// is a benign duplicate. Input is already schema-validated + byte-bounded, so JSON.stringify is safe.
function toolCallSignature(tool: string, input: unknown, parentResponseId: string): string {
  let inputSig: string;
  try {
    inputSig = JSON.stringify(input) ?? "null";
  } catch {
    inputSig = "￿badinput";
  }
  return `${parentResponseId}￿${tool}￿${inputSig}`;
}

// R7.1 (SB04-R7-01): a continuation is OWED the moment a non-terminal provider tool call is accepted
// for an owned response — BEFORE the (possibly slow) tool executor is awaited — because the parent's
// own `response.done` can arrive while the tool is still running. Monotonic states, never moving
// backward; the user-dispatch barrier blocks only while a debt is PENDING_TOOL or TOOL_READY.
type DebtState = "PENDING_TOOL" | "TOOL_READY" | "CONTINUATION_QUEUED" | "RESOLVED";
interface ContinuationDebt {
  callId: string;
  parentResponseId: string;
  turnId: number;
  state: DebtState;
}

// R6: bound the pending-work queue. Exceeding it FAILS CLOSED (never silent eviction,
// which would allow replay). One current + this many queued is ample for the serial
// default conversation within the session lifetime/rate caps.
const MAX_PENDING_WORK = 8;
// R7 (SB04-R6-REREV-04): the starvation ceiling. After this many tool continuations dispatch in a
// row without a user_commit in between, continuation priority is SUSPENDED so a waiting user_commit
// cannot be starved. In practice the per-turn/per-session tool caps already bound continuations far
// below this, so priority effectively always applies — this is an explicit, auditable backstop.
export const MAX_CONSECUTIVE_CONTINUATIONS = 8;

/**
 * R7 (SB04-R6-REREV-04): PURE insertion-position policy for the serialized pending-work queue.
 * The CURRENT turn's tool CONTINUATION is placed AHEAD of any queued `user_commit` work (so an
 * in-progress turn completes its tool→continuation loop before a NEWER utterance is answered) but
 * BEHIND already-queued continuations (continuations stay FIFO among themselves). Once
 * `continuationRun` has reached `maxConsecutive` — a bounded number of continuations dispatched in a
 * row without a `user_commit` — priority is SUSPENDED and the continuation goes to the TAIL, so a
 * waiting `user_commit` can never be starved indefinitely. A `user_commit` always appends at the
 * tail. Exported pure so the ordering is decisively unit-testable without driving the whole loop.
 */
export function pendingInsertIndex(
  queueKinds: ReadonlyArray<"user_commit" | "tool_continuation">,
  originKind: "user_commit" | "tool_continuation",
  continuationRun: number,
  maxConsecutive: number = MAX_CONSECUTIVE_CONTINUATIONS,
): number {
  if (originKind !== "tool_continuation" || continuationRun >= maxConsecutive) return queueKinds.length;
  let i = 0;
  while (i < queueKinds.length && queueKinds[i] === "tool_continuation") i++;
  return i;
}

export function createSideband(deps: SidebandDeps) {
  const model = deps.config.openaiModel;
  const perSessionCeilingCents = Math.round(deps.config.limits.perSessionCostCeilingUsd * 100);
  // R6 (SB04-R5-REREV-02): per-session serialized scheduler (replaces the R5 aggregate
  // pendingReserve number). Lazily created; a session has exactly one provider connection.
  const schedulers = new WeakMap<VoiceGatewaySession, Scheduler>();
  function getScheduler(session: VoiceGatewaySession): Scheduler {
    let s = schedulers.get(session);
    if (!s) {
      s = {
        conn: null,
        slot: "IDLE",
        current: null,
        queue: [],
        seq: 0,
        terminal: false,
        reserved: new Map(),
        sealed: new Set(),
        responseTurn: new Map(),
        continuedCalls: new Set(),
        continuationRun: 0,
        debt: new Map(),
        acceptedCalls: new Map(),
      };
      schedulers.set(session, s);
    }
    return s;
  }

  const sessionEmit = (session: VoiceGatewaySession): EmitFrame => (frame) => {
    try {
      session.emit?.(frame);
    } catch {
      /* no-op */
    }
  };

  /** True if this event no longer belongs to the live, non-cancelled turn. */
  function stale(session: VoiceGatewaySession, turnId: number): boolean {
    return session.terminated || session.cancelled || turnId !== session.turnId;
  }

  /** Conservative cost gate: fail CLOSED (unknown model or ceiling breach). Charges the
   *  session and (optionally) accrues onto a specific response's reservation. */
  function chargeOrFail(
    session: VoiceGatewaySession,
    emit: EmitFrame,
    turnId: number,
    cents: number | null,
    ctx?: ReconContext,
  ): boolean {
    if (cents === null) {
      emit({ t: "error", code: "cost_limit", turnId });
      deps.store.terminate(session, "closed");
      return false;
    }
    const wouldExceed = session.costCents + cents > perSessionCeilingCents;
    if (wouldExceed || !deps.rateLimiter.canSpend(session.costCents, cents)) {
      emit({ t: "error", code: "cost_limit", turnId });
      deps.store.terminate(session, "closed");
      return false;
    }
    deps.store.addCost(session, cents);
    deps.rateLimiter.recordSpend(cents);
    if (ctx?.rid) ctx.reserved.set(ctx.rid, (ctx.reserved.get(ctx.rid) || 0) + cents);
    return true;
  }

  /** R2 (REREV-03): reconcile a response's RESERVED cents to its REAL usage cents. */
  function reconcileUsage(
    session: VoiceGatewaySession,
    emit: EmitFrame,
    turnId: number,
    realCents: number | null,
    ctx?: ReconContext,
  ): boolean {
    if (realCents === null) {
      emit({ t: "error", code: "cost_limit", turnId });
      deps.store.terminate(session, "closed");
      return false;
    }
    const reserved = ctx?.rid ? ctx.reserved.get(ctx.rid) || 0 : 0;
    const delta = realCents - reserved;
    // R7 (SB04-R6-REREV-03): COMPLETE fail-closed usage trust — cost reconciliation may ONLY ever
    // move the charge UP. When trusted real usage EXCEEDS the conservative reservation we charge the
    // difference (ceiling-gated). A usage payload can NEVER refund/reduce below the conservative
    // reservation: a degenerate or under-reporting usage (e.g. a lone `outputTextTokens:0`, which the
    // schema accepts as "one usable field" and coerces the rest to 0) can no longer claw back the
    // reserved cost. (Previously `delta < 0` refunded, which TRUSTED the usage to be complete/credible
    // — the exact thing an untrusted provider event must never be allowed to assert.)
    if (delta > 0) {
      if (!chargeOrFail(session, emit, turnId, delta, ctx)) return false;
      if (ctx?.rid) ctx.reserved.set(ctx.rid, realCents);
    }
    // delta <= 0 → RETAIN the conservative reservation (no refund, no bookkeeping downgrade).
    return true;
  }

  // ── the serialized response-request scheduler ─────────────────────────────
  /** R7.1 (SB04-R7-01): true while any current-turn tool-continuation is still owed but not yet
   *  materialized in the queue (tool running, or just-ready pre-enqueue). A later user_commit must
   *  never dispatch across this barrier; a tool_continuation itself is always allowed to dispatch. */
  function hasBlockingDebt(sch: Scheduler): boolean {
    return sch.debt.size > 0;
  }

  /** R7.1 (SB04-R7-01): resolve (and drop) the current-turn continuation debt for a callId — used on
   *  a failed / throwing / stale tool where NO continuation is owed. Idempotent; keyed by callId so
   *  any invocation can safely resolve a shared debt (duplicate tool calls never wedge it). */
  function resolveDebt(sch: Scheduler, callId: string): void {
    const d = sch.debt.get(callId);
    if (d) {
      d.state = "RESOLVED";
      sch.debt.delete(callId);
    }
  }

  function failClosed(session: VoiceGatewaySession, sch: Scheduler, code: string): void {
    if (!sch.terminal) sch.terminal = true;
    try {
      sessionEmit(session)({ t: "error", code, turnId: session.turnId });
    } catch {
      /* no-op */
    }
    deps.store.terminate(session, "closed");
  }

  /** Dispatch the next eligible work into the ONE serialized response slot. Reserve →
   *  send is ATOMIC: reserve first, store the reservation on THIS request, send exactly
   *  one response.create, only then await response.created. */
  function dispatch(session: VoiceGatewaySession, sch: Scheduler): void {
    if (sch.terminal || session.terminated) return;
    if (sch.slot !== "IDLE" || sch.queue.length === 0 || !sch.conn) return;
    // R7.1 (SB04-R7-01): the CURRENT-TURN CONTINUATION BARRIER. Never dispatch a later user_commit
    // while a current-turn tool-continuation debt is unresolved (tool still running / continuation not
    // yet queued) — otherwise an early response.done(parent) would free the slot and let newer user
    // work leap ahead of the parent's owed continuation. A tool_continuation at the head is always
    // allowed (it is how the debt resolves); priority insertion + the fail-closed cap guarantee a
    // continuation is never queued BEHIND a user_commit, so a user_commit at the head means no
    // continuation is queued and the barrier depends solely on the debt.
    if (sch.queue[0].kind === "user_commit" && hasBlockingDebt(sch)) return;
    const origin = sch.queue.shift() as RequestOrigin;
    // R7 (SB04-R6-REREV-04): track the consecutive tool-continuation run so the priority guard in
    // enqueueWork can suspend continuation-jumps-ahead after a bounded number without a user_commit.
    if (origin.kind === "tool_continuation") sch.continuationRun += 1;
    else sch.continuationRun = 0;
    const emit = sessionEmit(session);
    const cents = estimateTurnCents(model);
    // 1) reserve conservatively (fail closed on unknown model / ceiling breach).
    if (!chargeOrFail(session, emit, session.turnId, cents)) {
      sch.terminal = true; // the cost gate already terminated + emitted
      return;
    }
    // 2) create the unique request record and OCCUPY the slot BEFORE sending.
    const requestId = `rq_${++sch.seq}_${Math.random().toString(36).slice(2, 10)}`;
    const record: RequestRecord = { requestId, origin, reservationCents: cents as number, state: "CREATE_SENT" };
    sch.current = record;
    sch.slot = "PENDING";
    // 3) send exactly one response.create (arms the response.created ACK deadline).
    let sent = false;
    try {
      sent = sch.conn.requestResponse?.(requestId) === true;
    } catch {
      sent = false;
    }
    if (!sent) {
      // R6: a send failure must NOT leave a reusable anonymous reservation. Mark this
      // exact request terminal and FAIL THE SESSION CLOSED; the conservative charge is
      // retained (we cannot prove no billable work occurred).
      record.state = "TERMINAL";
      failClosed(session, sch, "response_create_failed");
    }
  }

  /** Enqueue eligible response work + try to dispatch. Bounded — exceeding the queue
   *  fails closed (never a silent eviction that would enable replay). Returns false
   *  when the session is terminal/failed. */
  function enqueueWork(session: VoiceGatewaySession, sch: Scheduler, origin: RequestOrigin): boolean {
    if (sch.terminal || session.terminated) return false;
    if (sch.queue.length >= MAX_PENDING_WORK) {
      failClosed(session, sch, "response_queue_overflow");
      return false;
    }
    // R7.1 (SB04-R7-01): at the starvation ceiling a CONTINUATION now FAILS CLOSED rather than tailing
    // behind user work. Tailing (the R7 behaviour) would let a newer user_commit interleave INTO an
    // unresolved logical continuation chain — the exact ordering violation R7.1 forbids. A logical turn
    // that legitimately needs a continuation past the ceiling is pathological, so terminating the Voice
    // session is the safe outcome (never dispatch a newer user request into an incomplete turn).
    if (origin.kind === "tool_continuation" && sch.continuationRun >= MAX_CONSECUTIVE_CONTINUATIONS) {
      failClosed(session, sch, "continuation_starvation_cap");
      return false;
    }
    // R7 (SB04-R6-REREV-04): the CURRENT turn's tool CONTINUATION takes priority over LATER user
    // work, with a BOUNDED starvation guard. A tool_continuation is inserted AHEAD of any queued
    // user_commit (so the in-progress turn completes its tool→continuation loop before a newer
    // utterance is answered) but AFTER any continuations already queued (continuations stay FIFO
    // among themselves). Once MAX_CONSECUTIVE_CONTINUATIONS continuations have dispatched in a row
    // without a user_commit, priority is suspended and a further continuation goes to the TAIL, so a
    // waiting user_commit can never be starved. (Previously the queue was plain FIFO, so a
    // continuation enqueued after an earlier-queued user_commit ran only AFTER that later user turn.)
    const idx = pendingInsertIndex(
      sch.queue.map((o) => o.kind),
      origin.kind,
      sch.continuationRun,
    );
    sch.queue.splice(idx, 0, origin);
    dispatch(session, sch);
    return !sch.terminal && !session.terminated;
  }

  /** R6: bind a response.created to the single outstanding request. */
  function bindResponseCreated(session: VoiceGatewaySession, sch: Scheduler, responseId: string, requestId?: string): number | null {
    const cur = sch.current;
    if (sch.terminal || session.terminated) return null; // inert
    // Duplicate response.created for the SAME already-bound response id is idempotent.
    if (cur && cur.providerResponseId === responseId && sch.slot === "ACTIVE") {
      return sch.responseTurn.get(responseId) ?? null;
    }
    // A SECOND, DIFFERENT response.created while the slot already owns an ACTIVE response
    // is protocol-invalid under the default (serial) conversation → FAIL CLOSED.
    if (sch.slot === "ACTIVE") {
      failClosed(session, sch, "concurrent_response");
      return null;
    }
    // A response.created with NO outstanding CREATE_SENT request is REJECTED (dropped):
    // under create_response:false the provider never legitimately creates a response we
    // did not request, and we open no turn / bind no reservation for it.
    if (!cur || sch.slot !== "PENDING" || cur.state !== "CREATE_SENT") return null;
    // R7 (SB04-R6-REREV-01): MANDATORY exact request-id correlation. The serialized scheduler
    // ALWAYS stamps `response.create.response.metadata.request_id` and the provider ALWAYS echoes
    // response metadata on `response.created` (current OpenAI Realtime contract), so a bind with a
    // MISSING or MISMATCHED request id is protocol-invalid and FAILS CLOSED — it can never bind.
    // (Previously a MISSING echo was allowed to bind, so an unrequested/spoofed response.created
    // that omitted the echo could still attach to our one outstanding reservation.)
    if (requestId === undefined || requestId !== cur.requestId) {
      failClosed(session, sch, "response_id_mismatch");
      return null;
    }
    // R7.1 (SB04-R7-01 turn-ownership closure): a NEW user turn must cross a FRESH monotonic turn
    // boundary, while a tool CONTINUATION stays on its parent's SAME logical turn.
    //   • user_commit → beginTurn: bumps turnId, resets toolCallsThisTurn to 0, clears any stale
    //     cancelled flag, and hands the new turn a fresh abort token. This is what a "fully-resolved
    //     old logical turn → next queued user_commit" transition needs — otherwise (a chain that ended
    //     without answer/clarify: failed tool, tool-cap, or terminal cleanup) the prior turn could
    //     still be turnActive, so ensureTurn would REUSE it and let user B inherit stale
    //     ownership/tool budget. The user-dispatch barrier already guarantees B only reaches here after
    //     the preceding continuation chain is fully resolved, so beginTurn never severs live work.
    //   • tool_continuation → ensureTurn: keeps the SAME logical turn as the parent response (a
    //     continuation is NOT new user work), preserving the per-turn tool budget and turn identity.
    const turnId = cur.origin.kind === "user_commit" ? deps.store.beginTurn(session) : deps.store.ensureTurn(session);
    if (session.terminated) return null;
    cur.providerResponseId = responseId;
    cur.state = "ACTIVE";
    sch.slot = "ACTIVE";
    sch.responseTurn.set(responseId, turnId);
    // Bind EXACTLY this request's reservation to EXACTLY this response id.
    sch.reserved.set(responseId, (sch.reserved.get(responseId) || 0) + cur.reservationCents);
    // R7 (SB04-R6-REREV-02): the response.created ACK deadline is cleared ONLY here — AFTER the
    // authoritative bind of the single outstanding response.created to its reservation. The transport
    // no longer clears it on a raw response.created, so an unrequested / mismatched / unbindable
    // response.created leaves the deadline armed and it still fires the fail-closed timeout. (An
    // immediate fail-closed termination above also clears it via provider.close().)
    try {
      sch.conn?.notifyResponseBound?.();
    } catch {
      /* a throwing transport hook can never undo the authoritative bind */
    }
    return turnId;
  }

  /** R6: a response reached its terminal `response.done`. Reconcile exactly its own
   *  reservation (retain when usage is bad), seal it, free the slot, dispatch next. */
  function finishResponse(session: VoiceGatewaySession, sch: Scheduler, responseId: string, realCents: number | null): void {
    const emit = sessionEmit(session);
    const ctx: ReconContext = { reserved: sch.reserved, sealed: sch.sealed, rid: responseId };
    const turnId = sch.responseTurn.get(responseId) ?? session.turnId;
    if (!sch.sealed.has(responseId)) {
      if (realCents !== null) {
        // Valid usage → reconcile exactly this response's reservation.
        reconcileUsage(session, emit, turnId, realCents, ctx);
      }
      // else: missing/malformed usage → RETAIN the conservative reservation (charged),
      // but the response STILL becomes terminal/sealed (lifecycle ≠ usage trust).
      sch.sealed.add(responseId);
    }
    // Free the slot ONLY when this was the active response.
    if (sch.current && sch.current.providerResponseId === responseId) {
      sch.current.state = "TERMINAL";
      sch.current = null;
      sch.slot = "IDLE";
      dispatch(session, sch);
    }
  }

  async function handleProviderEvent(
    session: VoiceGatewaySession,
    conn: SidebandConnection,
    emit: EmitFrame,
    ev: ProviderEvent,
    turnId: number,
    rid?: string,
  ): Promise<HandleOutcome> {
    // R6: the scheduler owns the per-session reservation/seal/ownership maps; derive the
    // reconcile context from it (a direct caller passes only the response id, if any).
    const sch = getScheduler(session);
    const ctx: ReconContext = { reserved: sch.reserved, sealed: sch.sealed, rid };

    // R7 (SB04-R6-REREV-05): a TERMINAL lifecycle signal (response.done / legacy usage) for an
    // OWNED response MUST seal the request and free the serialized slot EVEN when the owning turn was
    // cancelled or superseded (stale). Handling it BEFORE the stale gate is what prevents the
    // scheduler from wedging: otherwise a cancelled-but-owned response.done was discarded, its slot
    // never freed, and no later utterance could ever dispatch. `finishResponse` emits NO browser UI
    // (it only reconciles cost, seals the response, and dispatches the next eligible work), so a
    // cancelled turn produces NO stale transcript/result/turn_complete frame. Ownership is already
    // proven by the caller (an unmapped/unowned response id never reaches here).
    if (ev.kind === "response_done") {
      const real = ev.usage ? costCentsForUsage(model, ev.usage) : null;
      finishResponse(session, sch, ev.responseId, real);
      return { status: "handled", kind: "response_done" };
    }
    // Legacy `usage` event (kept valid) — reconcile + seal + free the slot too (also stale-safe).
    if (ev.kind === "usage") {
      if (ctx.rid) finishResponse(session, sch, ctx.rid, costCentsForUsage(model, ev));
      return { status: "handled", kind: "usage" };
    }

    // Non-terminal, UI-producing / tool-executing events are DISCARDED once the turn is stale —
    // they would emit stale browser UI or run tool work for a cancelled/superseded turn.
    if (stale(session, turnId)) return { status: "discarded", reason: "stale" };

    if (ev.kind === "transcript") {
      emit({ t: "transcript", role: "user", text: ev.text, turnId });
      return { status: "handled", kind: "transcript" };
    }

    if (ev.kind === "response_begin") return { status: "handled", kind: "response_begin" };

    if (ev.kind === "answer" || ev.kind === "clarify") {
      // The response was reserved PRE-INFERENCE and bound to this rid at response.created
      // — do NOT double-reserve. The charge here is only the DEFENSIVE fallback when no
      // pre-reservation exists for this response (should not happen under the scheduler).
      const preReserved = ctx.rid ? (ctx.reserved.get(ctx.rid) || 0) > 0 : false;
      if (!preReserved && !chargeOrFail(session, emit, turnId, estimateTurnCents(model), ctx)) {
        return { status: "handled", kind: ev.kind, detail: "cost_limit" };
      }
      emit({ t: "result", kind: ev.kind, text: ev.text, turnId });
      emit({ t: "turn_complete", turnId });
      deps.store.completeTurn(session, turnId);
      // NOTE: the slot is freed by the response's own response.done (not here) — the
      // provider still emits response.done for this response.
      return { status: "handled", kind: ev.kind };
    }

    if (ev.kind !== "tool_call") return { status: "discarded", reason: "stale" };
    // R7.2 (SB04-R7.1-REREV-01): AUTHORITATIVE ACCEPT-ONCE call_id dedup — the FIRST thing done for a
    // tool_call, BEFORE the read-only canRunTool check, and strictly BEFORE any cost reservation,
    // tool-budget consumption, continuation-debt creation, executor invocation, function output, or
    // continuation authority. Exactly one accepted invocation may ever own a callId for the session.
    const callSig = toolCallSignature(ev.tool, ev.input, ctx.rid ?? "");
    const priorAccepted = sch.acceptedCalls.get(ev.callId);
    if (priorAccepted) {
      // A same-callId REPLAY. An IDENTICAL signature is a benign duplicate → INERT (no cost, no tool
      // budget, no debt mutation, no executor, no output, no continuation, no dispatch, no timer, no
      // UI, no telemetry-as-executed): the ONE accepted invocation retains all authority. A DIFFERENT
      // signature (different parent response / tool / input / intent) is impossible provider-ownership
      // corruption → FAIL CLOSED (never a second execution, never ambiguous ownership).
      if (priorAccepted.sig !== callSig) {
        failClosed(session, sch, "tool_call_id_conflict");
        return { status: "handled", kind: "tool_call", detail: "callid_conflict" };
      }
      return { status: "handled", kind: "tool_call", detail: "duplicate_inert" };
    }
    if (!deps.store.canRunTool(session)) {
      emit({ t: "error", code: "too_many_actions", turnId });
      return { status: "handled", kind: "tool_call", detail: "capped" };
    }
    // R7.2: this is the ONE accepted invocation for this callId → register acceptance NOW (before any
    // cost / tool-budget / executor / debt), so any later same-callId event is inert (or fails closed).
    sch.acceptedCalls.set(ev.callId, { sig: callSig, parentResponseId: ctx.rid ?? "", turnId });
    // Pre-work per-tool RESERVATION (fail closed on ceiling breach) — bound to the rid.
    if (!chargeOrFail(session, emit, turnId, estimateToolCents(model), ctx)) {
      return { status: "handled", kind: "tool_call", detail: "cost_limit" };
    }
    deps.store.recordToolCall(session);
    emit({ t: "status", status: "executing", turnId });
    // R7.1 (SB04-R7-01): register the CURRENT-TURN TOOL-CONTINUATION DEBT for a non-terminal, owned
    // tool call BEFORE awaiting the (possibly slow) executor. This holds the user-dispatch barrier so
    // an early response.done(parent) — which can arrive while the tool is still running — cannot free
    // the slot and let a later user_commit leap ahead of the parent's owed continuation. The
    // turn-TERMINAL getHotelDetails+OPEN path owes NO continuation → no debt; a duplicate callId → no
    // second debt (and continuedCalls prevents a second continuation).
    const terminalToolCall = ev.tool === "getHotelDetails" && ev.input.presentationIntent === "OPEN";
    if (!terminalToolCall && ctx.rid && !sch.debt.has(ev.callId)) {
      sch.debt.set(ev.callId, { callId: ev.callId, parentResponseId: ctx.rid, turnId, state: "PENDING_TOOL" });
    }
    let run: Awaited<ReturnType<typeof deps.executor.run>>;
    try {
      run = await deps.executor.run(deps.store, session, ev, session.turnAbort?.signal);
    } catch {
      // R7.1: a THROWING tool executor must NEVER wedge the continuation barrier. No continuation is
      // owed → resolve the debt and re-evaluate dispatch so a legitimately-waiting user_commit is
      // released; emit no stale UI. Best-effort failure tool result only while the turn is still live.
      resolveDebt(sch, ev.callId);
      if (!stale(session, turnId)) {
        try {
          conn.sendToolResult({ callId: ev.callId, ok: false, reason: "tool_error" });
        } catch {
          /* no-op */
        }
      }
      dispatch(session, sch);
      return { status: "handled", kind: "tool_call", detail: "tool_error" };
    }
    if (stale(session, turnId)) {
      // R7.1: a slow tool that completed AFTER the turn was cancelled/superseded — resolve its debt
      // (no continuation on a stale turn) and re-evaluate dispatch so the scheduler is never wedged.
      // No stale UI is emitted (the response's own R7-05 terminal cleanup already sealed it).
      resolveDebt(sch, ev.callId);
      dispatch(session, sch);
      return { status: "discarded", reason: "stale_after_tool" };
    }
    conn.sendToolResult({
      callId: ev.callId,
      ok: run.ok,
      count: run.ok ? run.count : undefined,
      reason: run.ok ? undefined : run.reason,
      data: run.ok ? run.data : undefined,
    });
    // R4 (SB04-R3-REREV-11): the DOCUMENTED provider path to OPEN_HOTEL. TURN-TERMINAL:
    // no continuation inference (the response's own response.done frees the slot).
    if (ev.tool === "getHotelDetails" && ev.input.presentationIntent === "OPEN") {
      if (run.ok && typeof ev.input.id === "string") {
        const auth = authorizeUiAction(deps.store, session, { type: "OPEN_HOTEL", hotelId: ev.input.id });
        if (auth.ok) {
          emit({ t: "ui_action", action: auth.action, turnId });
        } else {
          emit({ t: "error", code: "action_rejected", turnId });
          deps.telemetry.emit({ event: "action.rejected", sessionId: session.sessionId, turnId, errorCode: auth.reason });
        }
      } else {
        emit({ t: "error", code: "action_rejected", turnId });
      }
      emit({ t: "turn_complete", turnId });
      deps.store.completeTurn(session, turnId);
      deps.telemetry.emit({
        event: "tool.run",
        sessionId: session.sessionId,
        turnId,
        toolName: ev.tool,
        normalizedResult: run.ok ? run.normalizedResult : "error",
        errorCode: run.ok ? undefined : run.reason,
      });
      return { status: "handled", kind: "tool_call", detail: run.ok ? "ok" : run.reason };
    }
    // R6 (SB04-R5-REREV-02) + R7.1 (SB04-R7-01): a function-call CONTINUATION is inference and uses
    // the SAME authoritative response-request pipeline as a committed user turn. On a SUCCESSFUL tool
    // it is ENQUEUED with priority (deduped by callId) and its debt transitions
    // PENDING_TOOL → TOOL_READY → CONTINUATION_QUEUED and is then REMOVED — from here the queue
    // ordering (priority insert), the barrier, and serialization together guarantee it dispatches
    // before any later user_commit and only one response.create is ever outstanding. On a FAILED tool
    // NO continuation is owed → the debt RESOLVES and dispatch is re-evaluated so a waiting user_commit
    // can proceed (the parent's logical turn is complete). Debt transitions are keyed by callId so a
    // duplicate/concurrent same-callId tool call can never wedge or double-resolve it.
    if (run.ok && ctx.rid) {
      if (!sch.continuedCalls.has(ev.callId)) {
        sch.continuedCalls.add(ev.callId);
        const ready = sch.debt.get(ev.callId);
        if (ready) ready.state = "TOOL_READY";
        enqueueWork(session, sch, { kind: "tool_continuation", parentResponseId: ctx.rid, callId: ev.callId });
        const queued = sch.debt.get(ev.callId);
        if (queued) {
          queued.state = "CONTINUATION_QUEUED";
          sch.debt.delete(ev.callId);
        }
      }
    } else {
      // Tool did not succeed (or no owning rid) → no continuation is owed. Resolve the debt and
      // re-evaluate dispatch so a user_commit held by the barrier is released.
      resolveDebt(sch, ev.callId);
      dispatch(session, sch);
    }
    deps.telemetry.emit({
      event: "tool.run",
      sessionId: session.sessionId,
      turnId,
      toolName: ev.tool,
      normalizedResult: run.ok ? run.normalizedResult : "error",
      errorCode: run.ok ? undefined : run.reason,
    });
    return { status: "handled", kind: "tool_call", detail: run.ok ? "ok" : run.reason };
  }

  return {
    handleProviderEvent,

    /** R6 (SB04-R5-REREV-02): the gateway's ONLY entry to start a committed user turn's
     *  response. Enqueues a user_commit response request (auditable origin) and dispatches
     *  it into the serialized slot. Returns false when the session is terminal/failed (the
     *  cost/queue gate has already terminated + emitted). Replaces the R5 reserveResponse
     *  aggregate + a separate requestResponse() call. */
    requestUserResponse(session: VoiceGatewaySession, itemId: string): boolean {
      const sch = getScheduler(session);
      return enqueueWork(session, sch, { kind: "user_commit", itemId });
    },

    /** Wire a live sideband connection's validated events into the loop. */
    attach(session: VoiceGatewaySession, conn: SidebandConnection): void {
      const sch = getScheduler(session);
      sch.conn = conn;

      conn.onEvent((raw) => {
        const ev = validateProviderEvent(raw as unknown);
        if (!ev) return;
        const emit = sessionEmit(session);
        const rid = "responseId" in ev ? ev.responseId : undefined;

        // R6 (SB04-R5-REREV-02): a response.created binds the SINGLE outstanding request.
        if (ev.kind === "response_begin") {
          bindResponseCreated(session, sch, ev.responseId, ev.requestId);
          return;
        }

        // A SEALED response never re-opens/mutates the browser. EXCEPTION: usage /
        // response_done are terminal cost/lifecycle signals that legitimately arrive at
        // seal time and reconcile idempotently.
        if (rid && sch.sealed.has(rid) && ev.kind !== "usage" && ev.kind !== "response_done") return;

        // PROVABLE OWNERSHIP: an event other than response_begin is processed ONLY when
        // its provider responseId is one the scheduler already MAPPED (via response.created).
        // An event with no responseId, or an UNMAPPED one, has no ownership → drop.
        if (!rid || !sch.responseTurn.has(rid)) return;
        const turnId = sch.responseTurn.get(rid) as number;

        void handleProviderEvent(session, conn, emit, ev, turnId, rid);
      });
    },
  };
}

export type Sideband = ReturnType<typeof createSideband>;
