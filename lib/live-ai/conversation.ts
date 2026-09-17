// ─────────────────────────────────────────────────────────────────────────
// StayBid Live AI — LIVE-AI-02A — conversation controller.
//
// The browser brain that ties the (authoritative, pure) runtime to the transport
// and PCM playback. It owns the bounded state machine, the monotonic GENERATION
// (every async effect captures a generation; a mismatch is inert), context
// publish/ACK, provider-proposal → browser-stamped envelope → execute → receipt,
// evidence-bound deterministic answer rendering, bounded memory, and barge-in /
// route-change teardown. It performs NO direct HTTP/provider call (it only drives
// the injected transport) and INVENTS NO operation (the provider proposes only a
// closed operation, re-validated + envelope-stamped by the runtime).
//
// Fully dependency-injected so tests drive real behavior through fakes.
// ─────────────────────────────────────────────────────────────────────────
import type { LiveAiRuntime, OperationEnvelope, ExecutionResult } from "./runtime";
import type { LiveAiTransport, TransportEvent, TransportStartResult } from "./transport";
import type { AudioPlayback } from "./audio-playback";
import {
  canonicalDigest,
  contextDigest,
  decideReplay,
  validatePublishedContext,
  renderPlanSpokenText,
  approvedTextHash,
  evidenceSupportsPlan,
  trustedEvidenceAuthority,
  terminalReceiptCommitment,
  type EvidenceReceiptRef,
  type ServerFrame,
  type ClientFrame,
  type ContextPublishFrame,
  type ActionReceiptFrame,
  type ActionReceipt,
  type ReceiptOutcome,
  type ReceiptEvidence,
  type ResultAuthority,
  type ProviderProposal,
  type AnswerPlan,
  type CompiledAnswerEnvelope,
  type PublishedContext,
  type InterruptReason,
  type LiveAiLanguage,
} from "./protocol";
import type { LiveAiStatus } from "./runtime";
import type { LiveAiOperationName } from "./contracts";
// LIVE-AI-03B — the browser-safe compiled-answer verifier (IC02 parity). ONLY verified
// canonicalText may render; raw provider output / legacy answer.plan never becomes a 03B answer.
import { verifyCompiledAnswer, type ConsumerBinding } from "./compiled-answer-consumer";

export type ConversationState =
  | "DISCONNECTED" | "CONNECTING" | "IDLE" | "LISTENING" | "TRANSCRIBING"
  | "THINKING" | "ACTING" | "SPEAKING" | "INTERRUPTING" | "ERROR" | "OFFLINE";

// Terminal teardown (DISCONNECTED via end()/session.ended, OFFLINE via
// session.killed) must be reachable from EVERY non-terminal state — a
// session/idle timeout or a kill mid-turn (THINKING/ACTING/SPEAKING/…) must
// always be able to reflect the teardown, so both terminal targets are legal
// exits from each active state (the flow guards still forbid illegal FORWARD
// transitions like IDLE→SPEAKING).
const TRANSITIONS: Readonly<Record<ConversationState, readonly ConversationState[]>> = Object.freeze({
  DISCONNECTED: ["CONNECTING"],
  CONNECTING: ["IDLE", "ERROR", "OFFLINE", "DISCONNECTED"],
  IDLE: ["LISTENING", "THINKING", "INTERRUPTING", "ERROR", "OFFLINE", "DISCONNECTED"],
  LISTENING: ["TRANSCRIBING", "INTERRUPTING", "ERROR", "OFFLINE", "DISCONNECTED"],
  TRANSCRIBING: ["THINKING", "IDLE", "INTERRUPTING", "ERROR", "OFFLINE", "DISCONNECTED"],
  THINKING: ["ACTING", "SPEAKING", "IDLE", "INTERRUPTING", "ERROR", "OFFLINE", "DISCONNECTED"],
  ACTING: ["THINKING", "SPEAKING", "IDLE", "INTERRUPTING", "ERROR", "OFFLINE", "DISCONNECTED"],
  SPEAKING: ["IDLE", "INTERRUPTING", "ERROR", "OFFLINE", "DISCONNECTED"],
  INTERRUPTING: ["IDLE", "LISTENING", "DISCONNECTED", "ERROR", "OFFLINE"],
  ERROR: ["CONNECTING", "DISCONNECTED", "OFFLINE"],
  OFFLINE: ["CONNECTING", "DISCONNECTED"],
});
export function canTransition(from: ConversationState, to: ConversationState): boolean {
  if (from === to) return true;
  return (TRANSITIONS[from] as readonly string[]).includes(to);
}

export interface ConversationLimits {
  maxMemoryTurns: number;
  maxMemoryChars: number;
  sessionMs: number;
  idleMs: number;
}
export const DEFAULT_CONVERSATION_LIMITS: Readonly<ConversationLimits> = Object.freeze({
  maxMemoryTurns: 8,
  maxMemoryChars: 4_000,
  sessionMs: 10 * 60_000,
  idleMs: 60_000,
});

export type ConversationEvent =
  | { type: "state"; state: ConversationState }
  | { type: "transcript"; text: string; final: boolean }
  | { type: "answer"; text: string }
  | { type: "error"; code: string }
  | { type: "reset" };

export interface ConversationDeps {
  runtime: LiveAiRuntime;
  transport: LiveAiTransport;
  audio: AudioPlayback;
  now?: () => number;
  onEvent?: (e: ConversationEvent) => void;
  limits?: Partial<ConversationLimits>;
}

interface MemoryTurn { role: "user" | "assistant"; text: string; at: number }
interface PendingAction {
  actionId: string;
  /** R5B — the GATEWAY-minted receipt identity for this proposal; EVERY receipt for it (acted /
   *  verified / unknown) echoes this exact id. The browser never mints its own. */
  receiptId: string;
  /** R4-05 — the gateway-issued execution commitment this action was authorized under;
   *  every (async) verified/unknown receipt for it echoes this exact nonce. */
  executionNonce: string;
  proposalId: string;
  providerTurnId: string;
  authorityRef: string;
  operation: LiveAiOperationName;
  turnId: string;
  generation: number;
  /** OPEN → expected detail hotel id; SHOW → expected section (for context-ACK verify). */
  expectHotelId?: string;
  /** OPEN → the SOURCE ordinal it resolved from (bound into the destination navigation evidence). */
  expectPosition?: number;
  expectSection?: "rooms" | "about";
}

const IMMEDIATE_VERIFY = new Set<LiveAiOperationName>(["READ_CURRENT_RESULTS", "COMPARE_VISIBLE_HOTELS", "READ_CURRENT_HOTEL_FACTS"]);
const STALE_STATUSES = new Set<LiveAiStatus>(["stale_route", "stale_turn", "stale_context"]);
// R5B — map a runtime LiveAiStatus (+ outcome) to the CLOSED receipt STATUS vocabulary the wire
// requires. verified → "verified"; acted → "execution_acknowledged"; a negative outcome keeps its
// closed reason token (most runtime statuses already ARE closed tokens; the few internal ones map
// to the nearest closed token). No arbitrary bounded token ever reaches the wire.
const CLOSED_STATUS_MAP: Record<string, string> = {
  ok: "execution_acknowledged", deduped: "no_op", disabled: "no_op", not_activated: "no_op",
  no_registration: "no_op", invalid_envelope: "invalid_operation", schema_mismatch: "invalid_operation",
  session_mismatch: "invalid_operation", stale_turn: "stale_turn", invalid_operation: "invalid_operation",
  wrong_page: "wrong_page", authority_disabled: "authority_disabled", stale_route: "stale_route",
  stale_context: "stale_context", missing_ordinal: "missing_ordinal", unsupported_filter: "unsupported_filter",
  not_ready: "not_ready", hotel_id_mismatch: "hotel_id_mismatch",
};
function toClosedStatus(outcome: ReceiptOutcome, status: LiveAiStatus): string {
  if (outcome === "verified") return "verified";
  if (outcome === "acted") return "execution_acknowledged";
  const m = CLOSED_STATUS_MAP[status as string];
  if (m) return m;
  if (outcome === "unknown") return "result_unavailable";
  if (outcome === "stale") return "stale_context";
  return "no_op";
}
// R2-09 — a pending OPEN that the destination detail context never confirms EXPIRES to
// a single `unknown` receipt after this bound (one-transition; the navigation is
// treated as unconfirmed rather than pending forever or falsely verified).
export const OPEN_VERIFY_DEADLINE_MS = 30_000;

let __cseq = 0;
function cuid(prefix: string, now: () => number): string {
  __cseq += 1;
  return `${prefix}.${now().toString(36)}.${__cseq.toString(36)}`;
}

export interface Conversation {
  getState(): ConversationState;
  getGeneration(): number;
  getMemory(): ReadonlyArray<MemoryTurn>;
  getLastAnswer(): string;
  /** Explicit user-gesture start of a provider/microphone turn. NEVER auto-called;
   *  activates the runtime session + starts the transport with the current context. */
  start(mode: "text" | "microphone"): Promise<TransportStartResult>;
  /** Publish the current bounded context and (best-effort) await the ACK. */
  publishContext(): boolean;
  /** Begin + submit a text turn. */
  submitText(text: string, languageHint?: LiveAiLanguage): boolean;
  /** Barge-in: interrupt whatever is happening and (in mic mode) prepare to listen. */
  bargeIn(): void;
  /** A supported route change: new generation, interrupt, flush, re-publish. */
  onRouteChange(): void;
  /** REV-09 — an authoritative context update (same-route change / new detail page):
   *  re-publish + drive reconciliation + detail-context verification (no timer wait). */
  notifyContext(): void;
  reset(): void;
  end(reason: "user" | "timeout" | "unmount"): void;
  /** Reconcile async UI verifications (call on snapshot ticks). */
  tick(): void;
  /** REV-03 — resume blocked audio playback on a user gesture (the sink can only be
   *  unlocked by a gesture). Safe no-op when nothing is blocked / no audio yet. */
  resumeAudio(): void;
  audioNeedsResume(): boolean;
  dispose(): void;
}

export function createConversation(deps: ConversationDeps): Conversation {
  const { runtime, transport, audio } = deps;
  const now = deps.now || (() => Date.now());
  const limits: ConversationLimits = { ...DEFAULT_CONVERSATION_LIMITS, ...(deps.limits || {}) };

  let state: ConversationState = "DISCONNECTED";
  let generation = 0;
  const memory: MemoryTurn[] = [];
  let lastAnswer = "";
  // context ACK bound to a tuple; cleared whenever the tuple changes.
  let ackAuthorityRef: string | null = null;
  let ackTuple: string | null = null; // `${turnId}|${routeEpoch}|${contextRevision}`
  // R5B-REV-01 — the FULL result authority of the CURRENT context ack (the authority a result observed
  // NOW would carry). Attached to every acted/verified receipt so the gateway can INDEPENDENTLY validate
  // it. Set on context.ack; cleared with ackAuthorityRef whenever the tuple/authority changes.
  let ackResultAuthority: ResultAuthority | null = null;
  const publishDigests = new Map<string, string>(); // tuple → context digest
  const textDigests = new Map<string, string>();     // turnId → text digest
  const receiptDigests = new Map<string, string>();  // receiptKey → digest
  // REV-08 — a SEMANTIC verified-receipt map (receiptId → the operation + bounded
  // evidence WE emitted as verified), so an answer plan's evidence citation resolves
  // to an actual verified action, not merely "some id we've seen".
  // R3-08 — each verified receipt is bound to the executable authority it was verified
  // under, so a later turn (different authorityRef) can never cite it for a fact plan.
  // R4-08 — the COMPLETE correlated verified receipt kept for factual support (proposal +
  // verified outcome + authority + exact bounded evidence), so an answer plan is validated
  // field-by-field against it, never on generic receipt presence.
  const verifiedReceipts = new Map<string, { proposalId: string; operation: LiveAiOperationName; outcome: ReceiptOutcome; evidence?: ReceiptEvidence; authorityRef: string }>();
  // R5B — a verified receipt is NOT promoted into the trusted `verifiedReceipts` map until the
  // gateway's action.receipt.ack (closed + verified) for its exact receiptId arrives + correlates.
  // Until then the browser holds it here (unpromoted) so it can never support an answer plan before
  // the gateway has accepted the terminal verified lifecycle update.
  // R5B-REV-06 — each held verified receipt also stores the CANONICAL TERMINAL-RECEIPT COMMITMENT the
  // browser computed for the receipt it SENT; it is promoted only when the gateway's ACK commitment matches.
  const pendingVerifiedEvidence = new Map<string, { proposalId: string; operation: LiveAiOperationName; evidence?: ReceiptEvidence; authorityRef: string; commitment: string }>();
  const MAX_PENDING_VERIFIED = 64;
  // REV-07 — proposal execution dedup: proposalId → { digest, receipt } so an
  // identical retry REPLAYS the stored receipt (no re-execution) and a same-id
  // different-content proposal is a conflict (no execution). Bounded FIFO.
  const proposalDedup = new Map<string, { digest: string; receipt: ActionReceipt }>();
  const MAX_PROPOSAL_DEDUP = 64;
  const pendingByAction = new Map<string, PendingAction>();
  // REV-09 — OPEN_VISIBLE_HOTEL verifications SURVIVE a route change (the destination
  // detail context is what confirms them), so they are tracked separately from the
  // generation-scoped catalogue/section reconciliations that a route change clears.
  // R2-09/R3-09 — each open carries a hard `deadlineAt` AND the `sourceRouteEpoch` it
  // was issued under. It resolves EXACTLY ONCE: the FIRST authoritative route transition
  // after the OPEN consumes it — matches the expected destination → verified; anything
  // else → unknown — and a later manual visit to the expected hotel can NEVER verify it.
  // The deadline is only a backstop when no route transition ever happens.
  const pendingOpens = new Map<string, { actionId: string; receiptId: string; executionNonce: string; proposalId: string; providerTurnId: string; authorityRef: string; expectHotelId: string; expectPosition: number; deadlineAt: number; sourceRouteEpoch: number }>();
  const MAX_PENDING_OPENS = 16;
  // R2-08 — the ONLY plan whose audio the browser will accept: the plan it explicitly
  // APPROVED (sent answer.approve for) this turn. Audio for any other/superseded plan
  // is dropped, and the browser never approves a plan it can't voice (evidence-bound).
  let approvedPlanId: string | null = null;
  let startedAt = 0;
  let lastActivityAt = 0;

  function setState(next: ConversationState) {
    if (!canTransition(state, next)) return; // illegal transition is inert
    if (next === state) return;
    state = next;
    emit({ type: "state", state });
  }
  function emit(e: ConversationEvent) {
    if (deps.onEvent) { try { deps.onEvent(e); } catch { /* never break the loop */ } }
  }
  function touch() { lastActivityAt = now(); }
  function pushMemory(role: "user" | "assistant", text: string) {
    const t = (text || "").slice(0, 400);
    if (!t) return;
    memory.push({ role, text: t, at: now() });
    while (memory.length > limits.maxMemoryTurns) memory.shift();
    // char budget: drop oldest whole turns until within budget (never split a turn).
    let chars = memory.reduce((a, m) => a + m.text.length, 0);
    while (chars > limits.maxMemoryChars && memory.length > 1) {
      const dropped = memory.shift();
      chars -= dropped ? dropped.text.length : 0;
    }
  }
  function tupleKey(turnId: string, generation: number, routeEpoch: number, contextRevision: string): string {
    // REV-06 — the generation is part of the executable-authority tuple, so an ACK
    // for an older generation can never authorize a proposal after a barge-in /
    // route change bumped it.
    return `${turnId}|${generation}|${routeEpoch}|${contextRevision}`;
  }

  // ── context publish ───────────────────────────────────────────────────────
  function buildContextFrame(): ContextPublishFrame | null {
    const turnId = runtime.getCurrentTurnId();
    if (!turnId) return null;
    const ctx = runtime.publishedContext();
    if (!ctx) return null;
    const validated = validatePublishedContext(ctx as unknown);
    if (!validated) return null;
    const routeEpoch = runtime.getRouteEpoch();
    const contextRevision = deriveRevision(validated);
    return {
      t: "context.publish",
      sessionId: runtime.sessionId,
      turnId,
      generation,
      routeEpoch,
      contextRevision,
      context: validated,
    };
  }
  function deriveRevision(ctx: PublishedContext): string {
    // REV-06 — a FULL-content, fixed-length digest of the published context. Unlike
    // a truncated prefix (which collides when two large contexts share a long common
    // prefix and differ only late — e.g. two 24-hotel lists differing at hotel 24),
    // this folds the ENTIRE canonical context, so any late difference changes the
    // revision and no stale authority survives.
    return contextDigest(ctx);
  }
  function doPublish(): boolean {
    const frame = buildContextFrame();
    if (!frame) return false;
    const key = tupleKey(frame.turnId, frame.generation, frame.routeEpoch, frame.contextRevision);
    const digest = canonicalDigest(frame.context);
    const decision = decideReplay(publishDigests, key, digest);
    if (decision === "conflict") return false; // same tuple, different content → never overwrite
    if (decision === "fresh") publishDigests.set(key, digest);
    // a fresh tuple invalidates any older ACK until this one is acknowledged.
    if (ackTuple !== key) { ackAuthorityRef = null; ackTuple = null; ackResultAuthority = null; }
    return transport.publishContext(frame);
  }

  // ── inbound frame dispatch ─────────────────────────────────────────────────
  function onFrame(frame: ServerFrame) {
    switch (frame.t) {
      case "connection.ready":
        if (frame.sessionId !== runtime.sessionId) return;
        setState("IDLE");
        doPublish();
        return;
      case "context.ack": {
        if (frame.sessionId !== runtime.sessionId) return;
        if (frame.generation !== generation) return; // REV-06 — stale generation ACK
        if (frame.turnId !== runtime.getCurrentTurnId()) return; // stale turn
        if (frame.routeEpoch !== runtime.getRouteEpoch()) return; // stale route
        const key = tupleKey(frame.turnId, frame.generation, frame.routeEpoch, frame.contextRevision);
        // only accept an ACK for a tuple we actually published.
        if (!publishDigests.has(key)) return;
        ackAuthorityRef = frame.authorityRef;
        ackTuple = key;
        // R5B-REV-01 — capture the FULL result authority of this context (contextRevision IS the context
        // digest by construction). Every subsequent acted/verified receipt observed under this context
        // carries it, and the gateway re-derives the same authorityRef over the tuple.
        ackResultAuthority = { turnId: frame.turnId, generation: frame.generation, routeEpoch: frame.routeEpoch, contextRevision: frame.contextRevision, authorityRef: frame.authorityRef, contextDigest: frame.contextRevision };
        // OPEN/SHOW async verification: a fresh acknowledged context that reflects the
        // expected detail hotel / section confirms a prior UI action.
        verifyDetailContext(frame.contextRevision, frame.routeEpoch);
        return;
      }
      case "transcript.partial":
        if (isStale(frame.turnId, frame.generation)) return;
        setState("TRANSCRIBING");
        emit({ type: "transcript", text: frame.text, final: false });
        touch();
        return;
      case "transcript.final":
        if (isStale(frame.turnId, frame.generation)) return;
        pushMemory("user", frame.text);
        emit({ type: "transcript", text: frame.text, final: true });
        setState("THINKING");
        touch();
        return;
      case "turn.state":
        if (isStale(frame.turnId, frame.generation)) return;
        reflectTurnState(frame.state);
        return;
      case "action.proposal":
        if (isStale(frame.turnId, frame.generation)) return;
        handleProposal(frame.authorityRef, frame.executionNonce, frame.receiptId, frame.proposal);
        return;
      case "action.receipt.ack":
        if (isStale(frame.turnId, frame.generation)) return;
        handleReceiptAck(frame.receiptId, frame.proposalId, frame.outcome, frame.closed, frame.commitment);
        return;
      case "answer.plan":
        if (isStale(frame.turnId, frame.generation)) return;
        handleAnswerPlan(frame.authorityRef, frame.plan);
        return;
      case "answer.compiled":
        if (isStale(frame.turnId, frame.generation)) return;
        handleCompiledAnswer(frame.authorityRef, frame.envelope);
        return;
      case "audio.start":
        if (isStale(frame.turnId, frame.generation)) return;
        // R2-08 — accept audio ONLY for the plan the browser explicitly APPROVED this
        // turn. Audio for an unapproved / superseded plan (a buggy or hostile gateway,
        // or a late earlier-turn stream) is dropped — it never reaches the sink.
        if (frame.planId !== approvedPlanId) return;
        if (audio.onStart({ audioId: frame.audioId, generation }, generation)) setState("SPEAKING");
        return;
      case "audio.chunk":
        if (isStale(frame.turnId, frame.generation)) return;
        audio.onChunk({ audioId: frame.audioId, generation, seq: frame.seq, bytes: frame.bytes }, generation);
        return;
      case "audio.end":
        if (isStale(frame.turnId, frame.generation)) return;
        audio.onEnd({ audioId: frame.audioId, generation, finalSeq: frame.finalSeq }, generation);
        setState("IDLE");
        return;
      case "turn.error":
        if (isStale(frame.turnId, frame.generation)) return;
        emit({ type: "error", code: frame.code });
        // A "stale" turn error is a SUPERSEDED turn, not a session failure — the session
        // stays live for the current turn; just flush the stale turn's audio and idle.
        if (frame.code === "stale") { audio.flush(); setState("IDLE"); return; }
        // R4-04 — a NON-STALE (terminal) turn error TEARS DOWN transport/media ownership
        // BEFORE reflecting ERROR, mirroring session.killed/ended: bump the generation
        // (in-flight async effects inert), drop the approved-plan gate, TEAR DOWN audio
        // (abort playback), and END the transport (disposeTransport aborts the broker
        // fetch, closes the socket, and closes the owned mic session — stop tracks + pc/dc
        // + transcript authority). A failed turn never leaves a hot mic or a live socket.
        newGeneration();
        approvedPlanId = null;
        audio.teardown();
        try { transport.end({ sessionId: runtime.sessionId, generation, reason: "unmount" }); } catch { /* no-op */ }
        setState("ERROR");
        return;
      case "session.killed":
        if (frame.sessionId !== runtime.sessionId) return;
        // R3-04 — a server-initiated kill is a COMPLETE teardown: bump the generation so
        // every in-flight async effect is inert, tear down audio, drop the approved-plan
        // audio gate, AND release the transport's owned resources (control socket + mic
        // media + any in-flight broker fetch) — never leave a killed session's mic open.
        newGeneration();
        approvedPlanId = null;
        audio.teardown();
        try { transport.end({ sessionId: runtime.sessionId, generation, reason: "unmount" }); } catch { /* no-op */ }
        setState("OFFLINE");
        return;
      case "session.ended":
        if (frame.sessionId !== runtime.sessionId) return;
        // R3-04 — a server-initiated end likewise releases the transport's owned
        // resources (idempotent with our own end()), inert-ing late effects.
        newGeneration();
        approvedPlanId = null;
        audio.teardown();
        try { transport.end({ sessionId: runtime.sessionId, generation, reason: "unmount" }); } catch { /* no-op */ }
        setState("DISCONNECTED");
        return;
      default:
        return;
    }
  }

  function isStale(turnId: string, gen: number): boolean {
    return gen !== generation || turnId !== runtime.getCurrentTurnId();
  }
  function reflectTurnState(s: "listening" | "transcribing" | "thinking" | "acting" | "speaking" | "idle") {
    const map: Record<string, ConversationState> = {
      listening: "LISTENING", transcribing: "TRANSCRIBING", thinking: "THINKING", acting: "ACTING", speaking: "SPEAKING", idle: "IDLE",
    };
    setState(map[s]);
  }

  // ── proposal execution ─────────────────────────────────────────────────────
  function handleProposal(authorityRef: string, executionNonce: string, receiptId: string, proposal: ProviderProposal) {
    // A proposal is executable ONLY when the current tuple is acknowledged AND the
    // proposal's authorityRef matches THAT ack. The runtime re-checks route/context.
    if (!ackAuthorityRef || authorityRef !== ackAuthorityRef) {
      submitRejection(proposal, authorityRef, executionNonce, receiptId, "stale_context");
      return;
    }
    // REV-07 — dedup BEFORE any envelope creation / execution, so a duplicate
    // proposal can NEVER run the UI_LOCAL side effect twice. An identical retry
    // (same proposalId + same canonical operation) REPLAYS the original receipt with
    // no execution; a same-id different-content proposal is a conflict (no execution).
    const opDigest = canonicalDigest(proposal.operation);
    const prior = proposalDedup.get(proposal.proposalId);
    if (prior) {
      if (prior.digest === opDigest) { submitReceipt(prior.receipt); return; }
      submitRejection(proposal, authorityRef, executionNonce, receiptId, "invalid_operation");
      return;
    }
    setState("ACTING");
    const turnId = runtime.getCurrentTurnId();
    if (!turnId) { submitRejection(proposal, authorityRef, executionNonce, receiptId, "stale_turn"); return; }
    const env: OperationEnvelope | null = runtime.makeEnvelope(proposal.operation, turnId);
    if (!env) { submitRejection(proposal, authorityRef, executionNonce, receiptId, "invalid_operation"); return; }
    // R3-05/R4-05/R5B — ANNOUNCE the accepted action: bind the browser-minted actionId TO THE
    // GATEWAY-ISSUED executionNonce + ECHO the GATEWAY-minted receiptId, under the CURRENT authority
    // + full tuple, BEFORE executing or receipting. A later receipt must carry the exact actionId,
    // executionNonce AND receiptId (the browser can never mint a replacement receipt identity).
    transport.submitActionAccepted({ t: "action.accepted", sessionId: runtime.sessionId, turnId, generation, accepted: { receiptId, proposalId: proposal.proposalId, providerTurnId: proposal.providerTurnId, actionId: env.actionId, executionNonce, operation: proposal.operation.op, authorityRef } });
    const result: ExecutionResult = runtime.execute(env);
    const outcome = classifyOutcome(result);
    const receipt = buildReceipt({
      proposal, authorityRef, receiptId, actionId: env.actionId, executionNonce, operation: result.operation || proposal.operation.op,
      outcome, status: toClosedStatus(outcome, result.status), evidence: outcome === "verified" ? evidenceFor(result, proposal) : undefined,
    });
    if (receipt) {
      // remember the receipt for an identical-retry replay (bounded FIFO).
      proposalDedup.set(proposal.proposalId, { digest: opDigest, receipt });
      while (proposalDedup.size > MAX_PROPOSAL_DEDUP) { const k = proposalDedup.keys().next().value as string | undefined; if (k === undefined) break; proposalDedup.delete(k); }
      submitReceipt(receipt);
      if (result.ok && !IMMEDIATE_VERIFY.has(proposal.operation.op) && result.status !== "deduped") {
        // async-verify op ("acted"): remember for a later verified receipt (echoing this receiptId).
        rememberPending(proposal, authorityRef, receiptId, env.actionId, executionNonce, result);
      }
    }
    setState(result.status === "not_ready" ? "IDLE" : "THINKING");
    touch();
  }
  // R5B — the gateway acknowledged a receipt lifecycle update. A terminal VERIFIED receipt is only
  // now promoted into the trusted evidence map (the ACK proves gateway lifecycle acceptance — the
  // browser never trusts its own verified receipt for an answer plan before the correlated ACK).
  function handleReceiptAck(receiptId: string, proposalId: string, outcome: ReceiptOutcome, closed: boolean, commitment: string) {
    if (!closed || outcome !== "verified") return;
    const held = pendingVerifiedEvidence.get(receiptId);
    if (!held || held.proposalId !== proposalId) return;                 // uncorrelated ack
    // R5B-REV-06 — promote ONLY when the ACK carries the EXACT canonical terminal-receipt commitment the
    // browser computed for the receipt it sent. A copied / fabricated / wrong-content ACK-shaped frame
    // (wrong or absent commitment) never promotes held terminal-verified evidence.
    if (held.commitment !== commitment) return;
    verifiedReceipts.set(receiptId, { proposalId: held.proposalId, operation: held.operation, outcome: "verified", evidence: held.evidence, authorityRef: held.authorityRef });
    pendingVerifiedEvidence.delete(receiptId);
  }
  function classifyOutcome(result: ExecutionResult): ReceiptOutcome {
    if (!result.ok) return STALE_STATUSES.has(result.status) ? "stale" : "rejected";
    if (result.status === "deduped") return "acted";
    return IMMEDIATE_VERIFY.has(result.operation as LiveAiOperationName) ? "verified" : "acted";
  }
  // R5B — bounded evidence upgrades: results prove the EXACT ORDERED on-screen ids (not count only);
  // comparison proves positions + resolved ids + factors + bounded winner values; detail is tri-state.
  function evidenceFor(result: ExecutionResult, proposal: ProviderProposal): ReceiptEvidence | undefined {
    if (result.operation === "READ_CURRENT_RESULTS" && result.results) {
      return { kind: "results", count: result.results.length, orderedIds: result.results.map((r) => r.id) };
    }
    if (result.operation === "COMPARE_VISIBLE_HOTELS" && result.comparison) {
      const op = proposal.operation;
      const factors = op.op === "COMPARE_VISIBLE_HOTELS" ? (op.factors.slice() as ("price" | "rating" | "parking" | "breakfast")[]) : [];
      return {
        kind: "comparison",
        positions: result.comparison.rows.map((r) => r.position),
        hotelIds: result.comparison.rows.map((r) => r.id),
        factors,
        cheapestPosition: result.comparison.cheapestPosition,
        topRatedPosition: result.comparison.topRatedPosition,
      };
    }
    if (result.operation === "READ_CURRENT_HOTEL_FACTS" && result.facts) return { kind: "detail", hotelId: result.facts.hotelId, breakfast: result.facts.breakfast, parking: result.facts.parking };
    return undefined;
  }
  function rememberPending(proposal: ProviderProposal, authorityRef: string, receiptId: string, actionId: string, executionNonce: string, result: ExecutionResult) {
    const p: PendingAction = {
      actionId, receiptId, executionNonce, proposalId: proposal.proposalId, providerTurnId: proposal.providerTurnId, authorityRef,
      operation: proposal.operation.op, turnId: runtime.getCurrentTurnId() || "-", generation,
    };
    if (proposal.operation.op === "OPEN_VISIBLE_HOTEL" && result.resolvedHotelId) {
      p.expectHotelId = result.resolvedHotelId;
      p.expectPosition = proposal.operation.position;
      // REV-09 — an OPEN is verified by the DESTINATION detail context, which arrives
      // AFTER a route change; track it separately so it survives route invalidation.
      // R2-09 — stamp a hard deadline so it resolves once (verified or expired→unknown).
      pendingOpens.set(actionId, { actionId, receiptId, executionNonce, proposalId: proposal.proposalId, providerTurnId: proposal.providerTurnId, authorityRef, expectHotelId: result.resolvedHotelId, expectPosition: proposal.operation.position, deadlineAt: now() + OPEN_VERIFY_DEADLINE_MS, sourceRouteEpoch: runtime.getRouteEpoch() });
      while (pendingOpens.size > MAX_PENDING_OPENS) { const k = pendingOpens.keys().next().value as string | undefined; if (k === undefined) break; pendingOpens.delete(k); }
    }
    if (proposal.operation.op === "SHOW_HOTEL_SECTION") p.expectSection = proposal.operation.section;
    pendingByAction.set(actionId, p);
  }
  function buildReceipt(input: {
    proposal: ProviderProposal; authorityRef: string; receiptId: string; actionId: string; executionNonce: string;
    operation: LiveAiOperationName; outcome: ReceiptOutcome; status: string; evidence?: ReceiptEvidence;
  }): ActionReceipt | null {
    // R5B — the receiptId is the GATEWAY-minted identity echoed from action.proposal; the browser
    // never mints its own. The `status` is already a CLOSED-vocabulary token.
    const receiptId = input.receiptId;
    const receipt: ActionReceipt = {
      receiptId,
      proposalId: input.proposal.proposalId,
      providerTurnId: input.proposal.providerTurnId,
      actionId: input.actionId,
      executionNonce: input.executionNonce,
      authorityRef: input.authorityRef,
      operation: input.operation,
      outcome: input.outcome,
      status: input.status,
    };
    // R5B-REV-01 — attach the CURRENT full result authority (the authority the acted/verified result was
    // observed under). It is DISTINCT from the source `authorityRef`; the gateway independently
    // re-derives + validates it. A pre-ack rejection (no current ack) carries none.
    if (ackResultAuthority) receipt.resultAuthority = ackResultAuthority;
    if (input.evidence) receipt.evidence = input.evidence;
    // R5B — a verified receipt's evidence is HELD unpromoted until the gateway's action.receipt.ack
    // (closed + verified + matching COMMITMENT) for this receiptId arrives; only then does it become
    // trusted answer-plan evidence. It is bound to the executable authority so a stale-authority plan can
    // never cite it. R5B-REV-06 — the commitment is over the EXACT receipt we send (incl. resultAuthority).
    if (input.outcome === "verified") {
      const commitment = terminalReceiptCommitment(receipt);
      // R5B-REV-04 — the TRUSTED evidence is held under the OP-SPECIFIC authority: a source-bound
      // READ/COMPARE/FACTS keeps the exact SOURCE authority (== its result authority); an ADVANCEABLE
      // APPLY/OPEN/SHOW is held under the CURRENT RESULT authority (ackResultAuthority) so a legitimately
      // advanced verified receipt does not go stale and can still support the follow-up plan under the
      // advanced authority. An advanceable op with no current result authority yields NO trusted evidence
      // (not held) — the wire receipt + its commitment are unchanged; only the local authority binding is.
      const evAuth = trustedEvidenceAuthority(input.operation, input.authorityRef, ackResultAuthority);
      if (evAuth !== null) {
        pendingVerifiedEvidence.set(receiptId, { proposalId: input.proposal.proposalId, operation: input.operation, evidence: input.evidence, authorityRef: evAuth, commitment });
        while (pendingVerifiedEvidence.size > MAX_PENDING_VERIFIED) { const k = pendingVerifiedEvidence.keys().next().value as string | undefined; if (k === undefined) break; pendingVerifiedEvidence.delete(k); }
      }
    }
    return receipt;
  }
  function submitReceipt(receipt: ActionReceipt) {
    const turnId = runtime.getCurrentTurnId();
    if (!turnId) return;
    const frame: ActionReceiptFrame = { t: "action.receipt", sessionId: runtime.sessionId, turnId, generation, receipt };
    const key = `${receipt.proposalId}:${receipt.outcome}`;
    const digest = canonicalDigest(receipt);
    if (decideReplay(receiptDigests, key, digest) === "conflict") return;
    receiptDigests.set(key, digest);
    transport.submitActionReceipt(frame);
  }
  function submitRejection(proposal: ProviderProposal, authorityRef: string, executionNonce: string, receiptId: string, status: LiveAiStatus) {
    const outcome: ReceiptOutcome = STALE_STATUSES.has(status) ? "stale" : "rejected";
    const receipt = buildReceipt({ proposal, authorityRef, receiptId, actionId: cuid("act", now), executionNonce, operation: proposal.operation.op, outcome, status: toClosedStatus(outcome, status) });
    if (receipt) submitReceipt(receipt);
  }

  // ── async UI verification (reconcile + detail-context) ─────────────────────
  function tickReconcile() {
    // R5B-REV-01/02 — do NOT reconcile an APPLY to verified until the CURRENT context is acknowledged
    // (so the verified receipt can carry a valid FULL result authority the gateway will accept). Without
    // an ack there is no result authority; reconciling would consume the pending refinement for nothing.
    if (!ackResultAuthority) return;
    const turn = runtime.reconcile();
    if (!turn || turn.phase !== "verified" || !turn.correlated) return;
    const c = turn.correlated;
    const p = pendingByAction.get(c.actionId);
    if (!p) return;
    // only emit a verified follow-up when the originating turn/generation still holds.
    if (p.generation !== generation || p.turnId !== runtime.getCurrentTurnId()) { pendingByAction.delete(c.actionId); return; }
    // R5B — the applied refinement's verified evidence is the EXACT ordered on-screen result ids.
    const ids = currentResultIds();
    emitVerified(p, { kind: "results", count: ids.length, orderedIds: ids });
    pendingByAction.delete(c.actionId);
  }
  function verifyDetailContext(_contextRevision: string, _routeEpoch: number) {
    const ctx = runtime.publishedContext();
    // (a) generation-scoped SHOW_HOTEL_SECTION verifications (same route) — need a
    //     concrete published context; a null context simply has nothing to confirm yet.
    if (ctx) {
      for (const [actionId, p] of Array.from(pendingByAction.entries())) {
        if (p.generation !== generation) { pendingByAction.delete(actionId); continue; }
        if (p.operation === "SHOW_HOTEL_SECTION" && p.expectSection) {
          // R5B — the section evidence binds the exact validated detail HOTEL IDENTITY; R5B-REV-01/03 —
          // only verify once the section-changed context is ACKed (so a valid result authority exists);
          // otherwise leave it pending for the next ack (never verify without result authority).
          if (ctx.pageId === "hotel-detail" && ctx.validated && ctx.section === p.expectSection && typeof ctx.currentHotelId === "string" && ackResultAuthority) {
            emitVerified(p, { kind: "ui_state", section: p.expectSection, hotelId: ctx.currentHotelId });
            pendingByAction.delete(actionId);
          }
        }
      }
    }
    // (b) R3-09 / R4-09 — the FIRST authoritative route transition after the OPEN CONSUMES it:
    //   • no transition yet (routeEpoch unchanged) → leave it pending;
    //   • transitioned + on the EXPECTED hotel detail, still loading → wait for validation;
    //   • transitioned + EXPECTED hotel detail, validated → VERIFIED (once);
    //   • transitioned + ANY OTHER destination (wrong hotel / non-detail / NO readable
    //     destination context yet — ctx null) → UNKNOWN (once).
    // This loop runs EVEN WITH A NULL ctx: a route that advanced the epoch but produced no
    // confirmable destination is a non-expected destination, so the OPEN is consumed as
    // unknown NOW — never left pending for a later manual visit to the expected hotel to
    // falsely verify (a false-negative "unknown" is the safe outcome; a false-positive is not).
    const curEpoch = runtime.getRouteEpoch();
    for (const [actionId, e] of Array.from(pendingOpens.entries())) {
      if (curEpoch <= e.sourceRouteEpoch) continue; // no route transition after the OPEN yet
      const onExpected = !!ctx && ctx.pageId === "hotel-detail" && ctx.currentHotelId === e.expectHotelId;
      if (onExpected && ctx!.validated) {
        // R5B-REV-01/03 — the FIRST authoritative destination must be the internally-resolved source
        // hotel, verified against the STORED source resolution + a FULL result authority. Only verify once
        // the destination detail context is ACKed (so the result authority exists); otherwise leave the
        // OPEN pending for that ack. A wrong first destination (the else branch) still terminalizes now.
        if (!ackResultAuthority) continue;
        // R5B — OPEN can NEVER verify evidence-free: always carry bounded destination evidence (the
        // validated destination's tri-state facts, which name the exact destination hotel).
        emitVerifiedOpen(e, { kind: "detail", hotelId: e.expectHotelId, breakfast: ctx!.breakfast ?? "unknown", parking: ctx!.parking ?? "unknown" });
        pendingOpens.delete(actionId);
      } else if (onExpected && !ctx!.validated) {
        // the expected destination is still loading — wait (bounded by the deadline).
        continue;
      } else {
        // the first transition landed somewhere other than the expected hotel (or no
        // readable destination yet) → treated as UNCONFIRMED, consumed ONCE, never verifiable.
        emitUnknownOpen(e, "stale_entity");
        pendingOpens.delete(actionId);
      }
    }
  }
  function emitVerifiedOpen(e: { actionId: string; receiptId: string; executionNonce: string; proposalId: string; providerTurnId: string; authorityRef: string; expectHotelId: string }, evidence: ReceiptEvidence) {
    const receipt = buildReceipt({
      proposal: { proposalId: e.proposalId, providerTurnId: e.providerTurnId, operation: { op: "OPEN_VISIBLE_HOTEL" } as unknown as ProviderProposal["operation"] },
      authorityRef: e.authorityRef, receiptId: e.receiptId, actionId: e.actionId, executionNonce: e.executionNonce, operation: "OPEN_VISIBLE_HOTEL", outcome: "verified", status: "verified", evidence,
    });
    if (receipt) submitReceipt(receipt);
  }
  /** R2-09/R5B — a pending OPEN whose destination context never confirmed it: resolve it ONCE to an
   *  `unknown` terminal receipt (the navigation is unconfirmed, never falsely verified) with a closed
   *  status reason, and drop it. The entry is deleted so it can never later also verify. */
  function emitUnknownOpen(e: { actionId: string; receiptId: string; executionNonce: string; proposalId: string; providerTurnId: string; authorityRef: string; expectHotelId: string }, status: string) {
    const receipt = buildReceipt({
      proposal: { proposalId: e.proposalId, providerTurnId: e.providerTurnId, operation: { op: "OPEN_VISIBLE_HOTEL" } as unknown as ProviderProposal["operation"] },
      authorityRef: e.authorityRef, receiptId: e.receiptId, actionId: e.actionId, executionNonce: e.executionNonce, operation: "OPEN_VISIBLE_HOTEL", outcome: "unknown", status,
    });
    if (receipt) submitReceipt(receipt);
  }
  function sweepPendingOpens() {
    const t = now();
    for (const [actionId, e] of Array.from(pendingOpens.entries())) {
      if (t > e.deadlineAt) { pendingOpens.delete(actionId); emitUnknownOpen(e, "verification_timeout"); }
    }
  }
  function emitVerified(p: PendingAction, evidence?: ReceiptEvidence) {
    const receipt = buildReceipt({
      proposal: { proposalId: p.proposalId, providerTurnId: p.providerTurnId, operation: { op: p.operation } as unknown as ProviderProposal["operation"] },
      authorityRef: p.authorityRef, receiptId: p.receiptId, actionId: p.actionId, executionNonce: p.executionNonce, operation: p.operation, outcome: "verified", status: "verified", evidence,
    });
    if (receipt) submitReceipt(receipt);
  }
  // R5B — the CURRENT on-screen hotel ids in exact position order (the ordered-result evidence).
  function currentResultIds(): string[] {
    const ctx = runtime.publishedContext();
    if (!ctx || ctx.pageId !== "hotels") return [];
    return ctx.visibleHotels.slice().sort((a, b) => a.position - b.position).map((h) => h.id);
  }

  // ── answer plan → deterministic bounded render (evidence-bound) ────────────
  function handleAnswerPlan(authorityRef: string, plan: AnswerPlan) {
    // REV-08 — the plan is bound to the CURRENT ack: its authorityRef MUST match the
    // live executable authority, AND for evidence-requiring kinds it must cite a
    // NON-EMPTY set of receipts that ALL resolve to receipts WE emitted as verified.
    // Any of these failing downgrades the render to "no verified answer" — a
    // fabricated / unverified fact (empty evidence, an unknown id, a stale authority)
    // is NEVER voiced.
    const authOk = !!ackAuthorityRef && authorityRef === ackAuthorityRef;
    // R3-08 — SEMANTIC evidence binding (identical rule to the gateway): every cited
    // receipt must be verified UNDER THE CURRENT AUTHORITY (a stale-turn receipt cannot
    // support a current fact), carry compatible read-evidence, and every referenced
    // hotel must be on-screen in the current context. Any failure downgrades to the
    // "no verified answer" text and is NEVER approved / voiced.
    const ctxHotels = new Set<string>();
    const posToId = new Map<number, string>();
    const pctx = runtime.publishedContext() as { visibleHotels?: { id?: unknown; position?: unknown }[]; currentHotelId?: unknown } | null;
    if (pctx && Array.isArray(pctx.visibleHotels)) for (const h of pctx.visibleHotels) {
      if (h && typeof h.id === "string") { ctxHotels.add(h.id); if (typeof h.position === "number") posToId.set(h.position, h.id); }
    }
    if (pctx && typeof pctx.currentHotelId === "string") ctxHotels.add(pctx.currentHotelId);
    const evidenceOk = authOk && evidenceSupportsPlan(plan, {
      getReceipt: (id) => verifiedReceipts.get(id) as EvidenceReceiptRef | undefined,
      currentAuthorityRef: ackAuthorityRef,
      contextHotelIds: ctxHotels,
      positionToHotelId: (p) => posToId.get(p) ?? null, // R4-08 — comparison position → on-screen hotel id
    });
    const text = renderAnswerPlan(plan, evidenceOk);
    lastAnswer = text;
    pushMemory("assistant", text);
    emit({ type: "answer", text });
    // R2-08 — APPROVAL BEFORE TTS. The browser has now VALIDATED the plan (schema +
    // evidence). Only when it is willing to voice this plan (evidenceOk) does it send
    // an answer.approve BOUND to planId + authorityRef + textHash + turn + generation —
    // the gateway begins TTS ONLY on that approval. If evidenceOk is false the plan is
    // shown as the downgraded "no verified answer" text but is NEVER approved, so it is
    // never voiced. We do NOT auto-expect audio; audio.start is separately gated on the
    // approved planId. authorityRef is the CURRENT executable authority (== ackAuthorityRef).
    if (evidenceOk && ackAuthorityRef) {
      const turnId = runtime.getCurrentTurnId();
      // R3-08 — approve the EXACT deterministic spoken text: the hash is SHA-256 over
      // the same UTF-8 bytes the gateway will voice (one shared algorithm, no separator
      // divergence). The gateway matches this against its own approvedTextHash(plan).
      const textHash = approvedTextHash(plan);
      if (turnId && transport.submitApproval({ sessionId: runtime.sessionId, turnId, generation, planId: plan.planId, authorityRef: ackAuthorityRef, textHash })) {
        approvedPlanId = plan.planId; // ONLY this plan's audio will be accepted
      }
    }
    // Audio (if any) arrives as audio.* frames; state moves to SPEAKING then IDLE.
    touch();
  }

  // ── LIVE-AI-03B — compiled answer → browser-verified deterministic render ───
  // The compiled IC02 envelope is the ONLY rendered 03B answer path (legacy answer.plan is
  // NOT accepted here). ONLY the byte-verified canonicalText enters visible UI: the envelope
  // must pass full IC02 integrity (versions, semanticHash, deterministic rerender, textHash,
  // producer invariants) AND be bound to the CURRENT authority/turn (stale/foreign → dropped).
  // Raw provider output can never reach the UI — nothing here trusts a supplied hash or text.
  // P1-05 — the CURRENT trusted browser binding, built ENTIRELY from already-authoritative
  // runtime + context-ACK state (never from the envelope). All nine accepted binding fields;
  // contextRevision and contextDigest are both the full-content digest of the CURRENT validated
  // published context (this protocol's revision === digest), so a late context change rejects.
  function currentTrustedBinding(): ConsumerBinding | null {
    const turnId = runtime.getCurrentTurnId();
    if (!ackAuthorityRef || !turnId) return null;
    const ctx = runtime.publishedContext();
    const validated = ctx ? validatePublishedContext(ctx as unknown) : null;
    if (!validated) return null;
    const rev = deriveRevision(validated);
    return {
      sessionId: runtime.sessionId,
      turnId,
      generation,
      pageId: validated.pageId,
      role: validated.role,
      routeEpoch: runtime.getRouteEpoch(),
      contextRevision: rev,
      authorityRef: ackAuthorityRef,
      contextDigest: rev,
    };
  }
  function handleCompiledAnswer(authorityRef: string, envelope: CompiledAnswerEnvelope) {
    // P1-05 — construct the full CURRENT trusted binding and verify the envelope against it with the
    // COMPLETE-binding consumer (verifyCompiledAnswer). Every binding-field mismatch rejects; there is
    // NO parallel weaker manual comparison. Only the returned verified canonicalText may render.
    const cur = currentTrustedBinding();
    if (!cur) return;                                  // no coherent current authority → reject
    if (authorityRef !== cur.authorityRef) return;     // the frame's authorityRef must be current too
    const verified = verifyCompiledAnswer(envelope, cur);
    if (!verified.ok) return;                          // stale/foreign binding OR unverified envelope → never render
    const text = verified.canonicalText;
    lastAnswer = text;
    pushMemory("assistant", text);
    emit({ type: "answer", text });
    touch();
  }

  // ── public methods ─────────────────────────────────────────────────────────
  const unsub = transport.subscribe((e: TransportEvent) => {
    if (e.type === "connection") {
      if (e.state === "connecting") setState("CONNECTING");
      else if (e.state === "error") setState("ERROR");
      else if (e.state === "offline") setState("OFFLINE");
      else if (e.state === "disconnected") setState("DISCONNECTED");
      // "connected" waits for connection.ready before IDLE.
    } else {
      onFrame(e.frame);
    }
  });

  function newGeneration(): number {
    generation += 1;
    return generation;
  }

  const conversation: Conversation = {
    getState: () => state,
    getGeneration: () => generation,
    getMemory: () => memory.slice(),
    getLastAnswer: () => lastAnswer,
    async start(mode): Promise<TransportStartResult> {
      if (startedAt === 0) startedAt = now();
      runtime.activate();
      const turnId = runtime.getCurrentTurnId();
      const ctx = runtime.publishedContext();
      const validated = ctx ? validatePublishedContext(ctx as unknown) : null;
      if (!turnId || !validated) return { ok: false, code: "unsupported" };
      setState("CONNECTING");
      const res = await transport.start({ sessionId: runtime.sessionId, turnId, generation, mode, context: validated });
      if (!res.ok) setState("ERROR");
      touch();
      return res;
    },
    publishContext: () => doPublish(),
    submitText(text, languageHint) {
      if (startedAt === 0) startedAt = now();
      const turnId = runtime.beginTurn(text);
      // dedup identical text on the same turn; a different text on the same turn is a conflict.
      const digest = canonicalDigest({ text });
      const decision = decideReplay(textDigests, turnId, digest);
      if (decision === "conflict") return false;
      if (decision === "fresh") textDigests.set(turnId, digest);
      // R2-08 — a NEW turn SUPERSEDES: drop any prior approved plan + flush any playing
      // audio, so a late earlier-turn audio.start can never be accepted (the gateway
      // also aborts + clears its pending plan on turn.text).
      approvedPlanId = null;
      audio.flush();
      pushMemory("user", text);
      doPublish();
      const ok = transport.submitText({ sessionId: runtime.sessionId, turnId, generation, text, languageHint });
      if (ok) setState("THINKING");
      touch();
      return ok;
    },
    bargeIn() {
      // Increment generation so every in-flight async effect becomes inert, flush
      // audio, abort the current turn upstream, and drop pending explanations.
      const g = newGeneration();
      audio.flush();
      // REV-06 — a barge-in REVOKES the old executable authority BEFORE anything else,
      // so a stale proposal/answer racing the interrupt can no longer execute.
      ackAuthorityRef = null; ackTuple = null; ackResultAuthority = null;
      approvedPlanId = null; // R2-08 — no stale plan's audio may play after a barge-in
      const turnId = runtime.getCurrentTurnId();
      if (turnId) transport.interrupt({ sessionId: runtime.sessionId, turnId, generation: g, reason: "barge_in" });
      pendingByAction.clear();
      setState("INTERRUPTING");
    },
    onRouteChange() {
      // The PROVIDER owns the route epoch and has already called
      // runtime.invalidateRoute() + re-registered the new page before notifying us.
      // Here we bump the conversation GENERATION (every in-flight async effect goes
      // inert), interrupt the prior turn upstream, flush playback, drop pending
      // explanations, invalidate the old context ACK, and re-publish the new bounded
      // context — a fresh ACK must arrive before any new proposal can execute.
      const g = newGeneration();
      audio.flush();
      const prevTurn = runtime.getCurrentTurnId();
      if (prevTurn) transport.interrupt({ sessionId: runtime.sessionId, turnId: prevTurn, generation: g, reason: "route_change" });
      ackAuthorityRef = null; ackTuple = null; ackResultAuthority = null;
      approvedPlanId = null; // R2-08 — the prior turn's approved plan cannot cross a route
      pendingByAction.clear();
      // NOTE: pendingOpens is intentionally NOT cleared — an OPEN's verification is
      // exactly the destination detail context that this route change delivers (REV-09).
      setState("INTERRUPTING");
      doPublish();
      // R4-09 — the provider has ALREADY advanced the route epoch (runtime.invalidateRoute)
      // before calling us, so reconcile any pending OPEN against THIS first authoritative
      // transition SYNCHRONOUSLY here, using the new destination's snapshot. A wrong first
      // destination consumes the OPEN as UNKNOWN immediately — it does not wait for the next
      // context.ack / notify (which may never come if the user stays on the wrong page),
      // so a later manual visit to the expected hotel can never falsely verify it.
      verifyDetailContext("", runtime.getRouteEpoch());
      setState("IDLE");
    },
    notifyContext() {
      // REV-09 — reconcile on an authoritative context update: re-publish the bounded
      // context and drive catalogue reconciliation + detail-context verification, so
      // accepted actions advance to authoritative verification without a timer.
      doPublish();
      tickReconcile();
      verifyDetailContext("", runtime.getRouteEpoch());
    },
    reset() {
      // R4-04 — a reset is a FULL teardown, not a soft session.reset frame. The prior
      // implementation sent `session.reset` and only FLUSHED audio, leaving the mic + the
      // control socket + any in-flight broker fetch LIVE (a hot mic with no live turn).
      // Now: bump the generation (every in-flight async effect goes inert), TEAR DOWN audio
      // (abort playback, not merely flush), and END the transport — `transport.end` →
      // disposeTransport aborts the broker fetch, closes the socket, and closes the owned
      // media session (stop mic tracks + close pc/dc + clear transcript authority via
      // media.close()). Then clear ALL executable/dedup authority and go to DISCONNECTED.
      // (The `session.reset` wire frame remains a SEPARATE transport capability, no longer
      // coupled to this hard teardown.)
      const g = newGeneration();
      audio.teardown();
      approvedPlanId = null; // R2-08 — a reset clears any approved-plan audio gate
      try { transport.end({ sessionId: runtime.sessionId, generation: g, reason: "user" }); } catch { /* no-op */ }
      ackAuthorityRef = null; ackTuple = null; ackResultAuthority = null;
      pendingByAction.clear();
      pendingOpens.clear();
      proposalDedup.clear();
      verifiedReceipts.clear();
      textDigests.clear(); publishDigests.clear(); receiptDigests.clear();
      lastAnswer = "";
      emit({ type: "reset" });
      setState("DISCONNECTED");
    },
    end(reason) {
      const g = newGeneration();
      audio.teardown();
      approvedPlanId = null; // R2-08 — teardown clears the approved-plan audio gate
      transport.end({ sessionId: runtime.sessionId, generation: g, reason });
      setState("DISCONNECTED");
    },
    tick() {
      // session + idle bounds (fail-closed teardown).
      const t = now();
      if (startedAt > 0 && t - startedAt > limits.sessionMs) { conversation.end("timeout"); return; }
      if (lastActivityAt > 0 && t - lastActivityAt > limits.idleMs && state !== "DISCONNECTED") { conversation.end("timeout"); return; }
      tickReconcile();
      sweepPendingOpens(); // R2-09 — expire un-confirmed OPEN verifications → unknown
    },
    resumeAudio() { try { void audio.resume(); } catch { /* no-op */ } },
    audioNeedsResume() { try { return audio.needsResume(); } catch { return false; } },
    dispose() {
      // R2-04 — a full dispose (unmount): stop listening, tear down audio, AND close
      // the transport (control socket + owned media + any in-flight broker fetch), so
      // an unmount leaves NOTHING live. Bump the generation first so any late frame is
      // inert. approvedPlanId cleared so no stale audio could ever be accepted.
      const g = newGeneration();
      try { unsub(); } catch { /* no-op */ }
      approvedPlanId = null;
      audio.teardown();
      try { transport.end({ sessionId: runtime.sessionId, generation: g, reason: "unmount" }); } catch { /* no-op */ }
    },
  };

  // Route the initial connection state.
  if (transport.getConnectionState() === "connecting") setState("CONNECTING");
  return conversation;
}

// ── deterministic renderer (bounded; NO provider prose) ──────────────────────
// R3-08 — for an evidence-satisfied plan the ON-SCREEN text is EXACTLY the canonical
// spoken text (renderPlanSpokenText — the same bytes the browser approves + the gateway
// voices), so what is shown is what is (approved and) spoken. A plan that fails the
// evidence check renders the bounded "no verified answer" downgrade and is never voiced.
export function renderAnswerPlan(plan: AnswerPlan, evidenceOk: boolean): string {
  const L = plan.language;
  if (!evidenceOk && plan.kind !== "clarification" && plan.kind !== "unknown") {
    return t(L, "I don't have a verified answer for that yet.", "Iske liye abhi verified jankari nahi hai.", "मेरे पास इसका सत्यापित उत्तर अभी नहीं है।");
  }
  return renderPlanSpokenText(plan);
}
function t(lang: LiveAiLanguage, en: string, hinglish: string, hi: string): string {
  const s = lang === "en" ? en : lang === "hinglish" ? hinglish : hi;
  return s.slice(0, 400);
}

// re-exports for the provider / tests
export type { ClientFrame, InterruptReason } from "./protocol";
