// ─────────────────────────────────────────────────────────────────────────
// StayBid Live AI — LIVE-AI-02A — bounded Live-AI session store (isolated).
//
// A dedicated, self-contained session lifecycle for the Live-AI path. It shares
// NO old-tool allowlist, holds NO persistent transcript/audio, and owns:
//   • bounded concurrency (per subject / per ip / global);
//   • generation + abort ownership (a terminated session is inert);
//   • session-max + idle timers (fail-closed teardown);
//   • the late-bound control emitter + control-close handle;
//   • the per-tuple context ACK (authorityRef) + the set of receipt ids the browser
//     reported as verified this session (for evidence-bound answers).
//
// No secret/token/transcript is ever logged or retained.
// ─────────────────────────────────────────────────────────────────────────
import { randomBytes, createHash } from "node:crypto";

export interface LiveAiLimits {
  maxSessionMs: number;
  idleMs: number;
  activePerSubject: number;
  activePerIp: number;
  globalActive: number;
  controlAttachMs: number;
  /** R2-07 — hard per-session proposal/action ceiling. Proposal tombstones are NEVER
   *  evicted before session end, so an old proposal can never replay after "cache
   *  eviction" — there is no eviction; past the ceiling further proposals are refused. */
  maxProposalsPerSession: number;
  /** R2-13 — hard per-session provider-turn ceiling. */
  maxProviderTurns: number;
  /** R3-13 — hard per-session CUMULATIVE captured-speech ceiling (bytes of transcript
   *  submitted across all turns). Once cumulative transcript exceeds this, further
   *  turn.text is refused (fail closed) — the authoritative server-side speech cap. */
  maxSessionSpeechBytes: number;
}
export const DEFAULT_LIVE_AI_LIMITS: Readonly<LiveAiLimits> = Object.freeze({
  maxSessionMs: 10 * 60_000,
  idleMs: 60_000,
  activePerSubject: 1,
  activePerIp: 2,
  globalActive: 25,
  controlAttachMs: 15_000,
  maxProposalsPerSession: 32,
  maxProviderTurns: 16,
  maxSessionSpeechBytes: 64_000,
});

/**
 * R2-13 — the ATOMIC budget authority a REAL provider call requires. Reserve a
 * conservative cost BEFORE the call; settle (or retain the conservative reservation)
 * after. No DB/distributed store is authorized in this packet, so there is NO default
 * production implementation — `null` means the provider path FAILS CLOSED for
 * activation (see index.ts: real adapters are constructed only when a budget
 * authority exists). Deterministic tests inject a bounded in-memory authority.
 * Deployment-wide (multi-replica) budget authority is a mandatory SEPARATE future
 * activation packet.
 */
export interface BudgetAuthority {
  /** Atomically reserve `estimate` units against session+daily+monthly ceilings.
   *  Returns a reservation id, or null when any ceiling would be exceeded. */
  reserve(sessionKey: string, estimate: number): string | null;
  /** Settle a reservation with the actual usage (≤ reservation keeps the difference;
   *  unknown/malformed usage settles AT the conservative reservation). */
  settle(reservationId: string, actualOrNull: number | null): void;
}

export interface TimerFacility {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}
const defaultTimers: TimerFacility = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export type Emit = (frame: Record<string, unknown>) => void;

/** REV-08/R3-08 — semantic verified-receipt record (NOT just an id): the operation the
 *  browser confirmed + the bounded evidence + the EXECUTABLE AUTHORITY under which it
 *  was verified, so an answer plan's evidence citation resolves to an ACTUAL verified
 *  action AND a stale-turn receipt can never support a current factual plan. */
export interface VerifiedReceipt {
  /** R4-08 — the COMPLETE bounded correlated verified receipt: the proposal it verifies, the
   *  verified outcome, the executable authority it was verified under, and its EXACT bounded
   *  evidence (ordered result ids / comparison positions + resolved ids + factors + WINNER positions /
   *  detail TRI-STATE facts / ui section) — so an answer plan is validated field-by-field (R5B-REV-05),
   *  never on generic receipt presence. */
  proposalId: string;
  operation: string;
  outcome: string;
  evidence?: { kind: string; hotelId?: string; positions?: number[]; count?: number; section?: string; orderedIds?: string[]; hotelIds?: string[]; factors?: string[]; cheapestPosition?: number | null; topRatedPosition?: number | null; breakfast?: string; parking?: string };
  authorityRef: string;
}

/** R5B-REV-01 — the FULL result authority the ACTED/VERIFIED result was observed under (independent of
 *  the source authority). The gateway re-derives the authorityRef over the tuple and checks it equals the
 *  session's CURRENT context ack, so a wrong/copied/delayed/cross-session/cross-proposal result authority
 *  fails independently of the (immutable) source authority. */
export interface ResultAuthorityTuple {
  turnId: string;
  generation: number;
  routeEpoch: number;
  contextRevision: string;
  authorityRef: string;
  contextDigest: string;
}

/** REV-08 — a turn awaiting the browser's verified receipt before its evidence-bound
 *  answer/TTS may be produced (the ACT → VERIFY → EXPLAIN correlation). Bounded. */
export interface PendingTurn {
  turnId: string;
  generation: number;
  transcript: string;
  language: "hi" | "hinglish" | "en";
  providerTurnId: string;
  authorityRef: string;
}

// R5B — the CLOSED lifecycle states + terminal outcomes (byte-mirror of the vocabulary in
// live-ai-schemas.ts). `acted` is the ONLY non-terminal receipt outcome; a negative terminal
// permanently consumes the proposal authority for the session.
export type ProposalState = "pending" | "accepted" | "awaiting_verification" | "terminal";
export type ProposalTerminalOutcome = "verified" | "rejected" | "stale" | "unknown";
const R5B_TERMINAL_OUTCOMES: ReadonlySet<string> = new Set(["verified", "rejected", "stale", "unknown"]);

// R5B-REV-01 — the OPERATION-SPECIFIC source/result-authority partition. The advanced-result concession is
// NOT a generic rule: a SOURCE-BOUND read/compare/detail operation may ONLY verify against EXACTLY the
// immutable source authority it was proposed under (no routeEpoch / contextRevision / generation / entity /
// list advancement), so a proposal accepted under source context A can never verify against an unrelated
// advanced context B. ONLY the three UI-local mutating operations may advance to a SEPARATELY-validated
// bounded result authority. Every operation is classified here or fails closed (never advances).
const SOURCE_BOUND_OPS: ReadonlySet<string> = new Set(["READ_CURRENT_RESULTS", "COMPARE_VISIBLE_HOTELS", "READ_CURRENT_HOTEL_FACTS"]);
const ADVANCEABLE_OPS: ReadonlySet<string> = new Set(["APPLY_HOTEL_REFINEMENT", "OPEN_VISIBLE_HOTEL", "SHOW_HOTEL_SECTION"]);

/** R2-05/R5B — the gateway's OWN record of a proposal it emitted. A receipt is accepted ONLY
 *  when it correlates to a live proposal on EVERY field (incl. the gateway-minted receiptId).
 *  Lifecycle (R5B section 9): pending → accepted → awaiting_verification → terminal. `terminal`
 *  is irreversible; the record is a permanent tombstone (NEVER evicted before session end). */
export interface PendingProposal {
  proposalId: string;
  providerTurnId: string;
  operation: string;
  /** R4-05B — the FULL validated operation spec (op + its parameters: position / positions /
   *  section), retained so the gateway can bind a verified receipt to the INTENDED semantic
   *  result (the right hotel / section / compared set), not merely the evidence kind. */
  operationSpec: Record<string, unknown> | null;
  turnId: string;
  generation: number;
  /** R5B — the immutable COMPLETE SOURCE authority bound when the proposal was registered
   *  (the sha256 over the full tuple incl. contextRevision + generation). */
  authorityRef: string;
  /** R4-05 — the GATEWAY-owned execution commitment (executionNonce) minted for THIS proposal
   *  when the gateway emitted the action.proposal frame. The browser echoes it on accept + on
   *  every receipt; acceptance/consumption require an EXACT match. The model never sees/sets it. */
  executionNonce: string;
  /** R5B — the GATEWAY-minted authoritative receipt identity for THIS proposal (one proposal =
   *  one immutable receipt lifecycle identity). Emitted as trusted action.proposal metadata; the
   *  browser echoes it on accept + every receipt and can NEVER mint its own. */
  receiptId: string;
  /** R3-05 — the browser-minted actionId bound via action.accepted (null until the
   *  browser announces acceptance). Every lifecycle receipt MUST carry this exact actionId. */
  acceptedActionId: string | null;
  state: ProposalState;
  /** R5B — the terminal outcome once state === "terminal" (else null); irreversible. */
  terminalOutcome: ProposalTerminalOutcome | null;
  /** R5B — the canonical digest of the terminal receipt, so an EXACT-duplicate terminal replay is
   *  idempotent while a CONFLICTING terminal replay (same proposal, different content) is rejected. */
  terminalDigest: string | null;
  /** R5B-REV-01 — the INDEPENDENT FULL result authority (turnId + generation + routeEpoch +
   *  contextRevision + authorityRef + contextDigest), bound when a result is first observed. Kept
   *  SEPARATE from `authorityRef` (immutable source authority) so a legitimately-advanced result
   *  (APPLY/OPEN/SHOW) is validated on its own authority, never against the stale source. */
  resultAuthority: ResultAuthorityTuple | null;
  /** R5B-REV-07 — the canonical digest of the FIRST valid `acted` receipt, so a duplicate acted is
   *  idempotent (no lifecycle mutation, no resultAuthority overwrite) while a CONFLICTING second acted is
   *  rejected (the original acted state + result authority are preserved). */
  actedDigest: string | null;
  /** R5B-REV-02/03 — the IMMUTABLE source hotel identity resolved when the proposal was REGISTERED (while
   *  the source context was authoritative): OPEN's target ordinal → the trusted hotel id from the source
   *  LIST; SHOW's source DETAIL currentHotelId; null for every other operation (and if the source context
   *  could not resolve one). The terminal OPEN/SHOW semantic check binds the destination/result hotel to
   *  THIS stored id — the destination context (an honest detail page publishes visibleHotels: []) and the
   *  browser/model can never supply the authoritative identity. */
  sourceResolvedHotelId: string | null;
}

// R5B — the outcome of applying one receipt lifecycle update to a proposal.
export type LifecycleResult =
  | { kind: "invalid" }                                                     // uncorrelated / receipt-before-accept / forged / bad result authority
  | { kind: "advanced"; proposal: PendingProposal }                         // first acted → awaiting_verification (non-terminal; binds result authority)
  | { kind: "advanced_idempotent"; proposal: PendingProposal }              // R5B-REV-07 — exact-duplicate acted (no mutation, no re-execution)
  | { kind: "terminal"; proposal: PendingProposal; outcome: ProposalTerminalOutcome } // first terminal transition (incl. pre-accept terminalization)
  | { kind: "idempotent"; proposal: PendingProposal; outcome: ProposalTerminalOutcome } // exact-duplicate terminal replay
  | { kind: "conflict" };                                                   // conflicting terminal/acted replay → reject

/** R2-08 — an answer plan awaiting the BROWSER's approval before TTS may start. */
export interface PendingPlan {
  planId: string;
  providerTurnId: string;
  turnId: string;
  generation: number;
  authorityRef: string;
  /** the exact approval hash the browser must echo (approvalHash of the plan key). */
  expectedTextHash: string;
  /** the deterministic text to voice once approved. */
  ttsText: string;
  language: "hi" | "hinglish" | "en";
}

export interface LiveAiSession {
  sessionId: string;       // browser-owned protocol id
  gatewaySessionId: string; // gateway resource id
  subject: string;
  ipHash: string;
  authenticated: boolean;
  terminated: boolean;
  emit: Emit | null;
  closeControl: (() => void) | null;
  ackAuthorityRef: string | null;
  ackTuple: string | null;
  /** REV-06 — the digest of the currently-acked context tuple, so a later publish
   *  with the SAME tuple key but DIFFERENT content is detected as a conflict and
   *  revokes the prior executable ACK instead of silently keeping it. */
  ackContextDigest: string | null;
  /** the last bounded, data-minimized published context (working state only — NOT a
   *  raw hotel object / transcript / audio; cleared on reset/terminate). */
  lastContext: unknown;
  verifiedReceipts: Map<string, VerifiedReceipt>;
  /** REV-08 — the turn deferred until its verified receipt arrives (or null). */
  pendingTurn: PendingTurn | null;
  /** R2-05 — every proposal this session ever emitted (pending or consumed tombstone);
   *  bounded by the HARD maxProposalsPerSession ceiling, NEVER evicted (R2-07). */
  proposals: Map<string, PendingProposal>;
  /** R5B (non-blocking dup-registration guard) — every gateway-minted receiptId ever registered this
   *  session. A second registration reusing a live proposalId OR receiptId is REFUSED (no silent
   *  overwrite of a proposal's immutable receipt identity). */
  usedReceiptIds: Set<string>;
  /** R2-08 — the plan awaiting browser approval before TTS (or null). */
  pendingPlan: PendingPlan | null;
  /** R2-01 — exactly-one control attachment: false until the FIRST authenticated
   *  attach claims it; a second attach is rejected while a socket is live, and the
   *  one-use claim also refuses token replay after the socket closed. */
  controlClaimed: boolean;
  controlLive: boolean;
  /** R2-13 — provider turns consumed (hard ceiling maxProviderTurns). */
  providerTurns: number;
  /** R3-13 — CUMULATIVE captured-speech bytes submitted across the session (transcript
   *  bytes over all turn.text). Monotonic; enforced against maxSessionSpeechBytes. */
  speechBytes: number;
  abort: AbortController;
  _timers: unknown[];
  _control: unknown | null;
}

export type CreateResult = { ok: true; session: LiveAiSession } | { ok: false; reason: string };

export interface LiveAiStoreDeps {
  limits: LiveAiLimits;
  now?: () => number;
  timers?: TimerFacility;
  genId?: (n: number) => string;
  /** R5C — invoked exactly once when a session terminates (any reason: idle / session-max /
   *  kill / drain / control-close / user end / capture-expiry). The server capture ledger
   *  finalizes the session's active capture segment here, so EVERY termination path
   *  finalizes (charging the actual elapsed) with no dangling active segment. */
  onTerminate?: (session: LiveAiSession) => void;
}

export function createLiveAiSessionStore(deps: LiveAiStoreDeps) {
  const limits = deps.limits;
  const now = deps.now || (() => Date.now());
  const timers = deps.timers || defaultTimers;
  const genId = deps.genId || ((n: number) => randomBytes(n).toString("hex"));
  const sessions = new Map<string, LiveAiSession>();
  const bySubject = new Map<string, number>();
  const byIp = new Map<string, number>();

  function inc(map: Map<string, number>, key: string) { map.set(key, (map.get(key) || 0) + 1); }
  function dec(map: Map<string, number>, key: string) {
    const v = (map.get(key) || 0) - 1;
    if (v <= 0) map.delete(key); else map.set(key, v);
  }
  function clearTimers(s: LiveAiSession) {
    for (const h of s._timers.splice(0)) { try { timers.clear(h); } catch { /* no-op */ } }
  }
  function armTimers(s: LiveAiSession) {
    s._timers.push(timers.set(() => terminate(s, "timeout"), limits.maxSessionMs)); // [0] hard session max
    s._timers.push(timers.set(() => terminate(s, "timeout"), limits.idleMs));       // [1] idle (refreshed via touch)
    // [2] REV-13 control-attach timeout — if the authenticated control socket never
    // binds within controlAttachMs, tear the reserved session down (no orphan hold).
    s._timers.push(timers.set(() => terminate(s, "timeout"), limits.controlAttachMs));
  }
  function touch(s: LiveAiSession) {
    // refresh idle timer only (index 1); keep the hard session-max timer.
    if (s.terminated) return;
    if (s._timers[1] !== undefined) { try { timers.clear(s._timers[1]); } catch { /* no-op */ } }
    s._timers[1] = timers.set(() => terminate(s, "timeout"), limits.idleMs);
  }

  function create(input: { sessionId: string; subject: string; ipHash: string; authenticated: boolean }): CreateResult {
    if (sessions.size >= limits.globalActive) return { ok: false, reason: "global_capacity" };
    if ((bySubject.get(input.subject) || 0) >= limits.activePerSubject) return { ok: false, reason: "subject_capacity" };
    if ((byIp.get(input.ipHash) || 0) >= limits.activePerIp) return { ok: false, reason: "ip_capacity" };
    const gatewaySessionId = "gw." + genId(12);
    const session: LiveAiSession = {
      sessionId: input.sessionId,
      gatewaySessionId,
      subject: input.subject,
      ipHash: input.ipHash,
      authenticated: input.authenticated,
      terminated: false,
      emit: null,
      closeControl: null,
      ackAuthorityRef: null,
      ackTuple: null,
      ackContextDigest: null,
      lastContext: null,
      verifiedReceipts: new Map<string, VerifiedReceipt>(),
      pendingTurn: null,
      proposals: new Map<string, PendingProposal>(),
      usedReceiptIds: new Set<string>(),
      pendingPlan: null,
      controlClaimed: false,
      controlLive: false,
      providerTurns: 0,
      speechBytes: 0,
      abort: new AbortController(),
      _timers: [],
      _control: null,
    };
    sessions.set(gatewaySessionId, session);
    inc(bySubject, input.subject);
    inc(byIp, input.ipHash);
    armTimers(session);
    return { ok: true, session };
  }

  /** R2-01 — atomically CLAIM the session's single control attachment. EXACTLY ONE
   *  active authenticated control socket may exist: the first successful bind claims
   *  the one-use attachment; a second concurrent attach is REJECTED (never silently
   *  replacing live callbacks), and the claim also refuses token replay after the
   *  first socket closed. A terminated session can never (re)attach.
   *  Returns true when the attachment was claimed; false ⇒ the caller must close
   *  the new socket. */
  function bindRuntime(session: LiveAiSession, emit: Emit, closeControl: () => void): boolean {
    if (session.terminated) { try { closeControl(); } catch { /* no-op */ } return false; }
    if (session.controlClaimed) { try { closeControl(); } catch { /* no-op */ } return false; }
    session.controlClaimed = true;   // one-use — never reset (replay after close fails)
    session.controlLive = true;
    session.emit = emit;
    session.closeControl = closeControl;
    // REV-13 — the control socket attached in time: cancel the control-attach timeout.
    if (session._timers[2] !== undefined) { try { timers.clear(session._timers[2]); } catch { /* no-op */ } session._timers[2] = undefined; }
    touch(session);
    return true;
  }
  /** R2-01 — the (single) control socket disconnected. */
  function controlDetached(session: LiveAiSession) {
    session.controlLive = false;
    session.emit = null;
  }

  // ── R2-05/R2-07/R5B — the proposal registry (hard ceiling, no eviction, tombstones) ──
  /** Register an emitted proposal (state "pending"). Refused past the HARD per-session ceiling.
   *  The gateway-minted receiptId + executionNonce are supplied by the orchestrator. */
  function registerProposal(session: LiveAiSession, p: Omit<PendingProposal, "state" | "acceptedActionId" | "terminalOutcome" | "terminalDigest" | "resultAuthority" | "actedDigest">): boolean {
    if (session.terminated) return false;
    if (session.proposals.size >= limits.maxProposalsPerSession) return false; // R2-07 ceiling
    // R5B (non-blocking) — REFUSE a duplicate proposalId OR receiptId within the live session; never
    // silently overwrite an existing proposal / its immutable receipt identity.
    if (session.proposals.has(p.proposalId)) return false;
    if (session.usedReceiptIds.has(p.receiptId)) return false;
    session.proposals.set(p.proposalId, { ...p, acceptedActionId: null, state: "pending", terminalOutcome: null, terminalDigest: null, resultAuthority: null, actedDigest: null });
    session.usedReceiptIds.add(p.receiptId);
    return true;
  }
  /** R3-05/R5B — BIND the browser-minted actionId to a PENDING proposal (pending → accepted). Every
   *  correlated field must match the registered proposal, the GATEWAY-minted receiptId (echoed by
   *  the browser — it may never mint its own), the execution commitment, AND the CURRENT executable
   *  authority; the actionId is bound ONCE (immutable) — a re-accept with a DIFFERENT actionId is
   *  refused, the SAME actionId is idempotent success. A later receipt must carry this exact actionId. */
  function acceptProposalAction(session: LiveAiSession, r: { receiptId: string; proposalId: string; providerTurnId: string; actionId: string; executionNonce: string; operation: string; authorityRef: string; turnId: string; generation: number }): boolean {
    const p = session.proposals.get(r.proposalId);
    if (!p) return false;                                                 // unknown
    if (p.receiptId !== r.receiptId) return false;                       // R5B — wrong / self-minted receipt identity
    if (p.providerTurnId !== r.providerTurnId) return false;             // wrong provider turn
    // R4-05 — the GATEWAY-issued execution commitment must be echoed EXACTLY.
    if (p.executionNonce !== r.executionNonce) return false;             // wrong / copied / absent commitment
    if (p.operation !== r.operation) return false;                       // wrong operation
    if (p.authorityRef !== r.authorityRef) return false;                 // wrong authority
    if (session.ackAuthorityRef !== p.authorityRef) return false;        // authority no longer current
    if (p.turnId !== r.turnId || p.generation !== r.generation) return false; // wrong turn / generation
    if (p.acceptedActionId !== null) return p.acceptedActionId === r.actionId && p.state !== "terminal"; // immutable once bound; a terminal proposal never re-accepts
    if (p.state !== "pending") return false;                             // only a fresh proposal may be accepted
    p.acceptedActionId = r.actionId;
    p.state = "accepted";                                                // R5B — pending → accepted
    return true;
  }
  /** R5B — apply ONE receipt lifecycle update. The receipt is correlated on EVERY identity field
   *  (proposalId + gateway receiptId + providerTurnId + executionNonce + operation + source
   *  authority + the exact bound actionId); a receipt BEFORE acceptance, a forged/copied field, or
   *  a self-minted receiptId is `invalid`. Then the state machine (section 9):
   *    accepted + acted                → awaiting_verification (non-terminal; binds result authority)
   *    accepted|awaiting + verified    → terminal(verified)         (caller pre-checks evidence)
   *    accepted|awaiting + rejected/stale/unknown → terminal(that)  (negative consumes authority)
   *    stale source authority          → terminal(stale)            (a stale proposal never verifies)
   *    terminal + exact-duplicate      → idempotent (no re-execution)
   *    terminal + conflicting          → conflict (reject)
   *  `digest` is the caller's canonical digest of the receipt (for exact-duplicate vs conflict).
   *  `resultTurnId`/`resultGeneration` are the OUTER receipt-frame result-observation correlation. */
  /** R5B-REV-01 — INDEPENDENTLY re-derive + validate the FULL result authority BEFORE any lifecycle
   *  advancement. The tuple must (a) be internally consistent — the gateway recomputes the authorityRef
   *  over turnId + generation + routeEpoch + contextRevision + contextDigest and it must equal the claimed
   *  authorityRef (a copied/fabricated authorityRef with a mismatched tuple fails); (b) equal the session's
   *  CURRENT context ack (the result was observed under the current context — a delayed/stale result
   *  authority, another proposal's result, or another session's result fails, since each session+context
   *  yields a distinct authorityRef); (c) carry the current context digest. Kept SEPARATE from the source
   *  authority — a legitimately-advanced result (APPLY/OPEN/SHOW) is validated on its OWN authority. */
  function validateResultAuthority(session: LiveAiSession, ra: ResultAuthorityTuple | null): boolean {
    if (!ra) return false;
    const expected = computeAuthorityRef(session, ra.turnId, ra.generation, ra.routeEpoch, ra.contextRevision, ra.contextDigest);
    if (expected !== ra.authorityRef) return false;                       // (a) internally consistent
    if (session.ackAuthorityRef === null || ra.authorityRef !== session.ackAuthorityRef) return false; // (b) current context
    if (session.ackContextDigest !== ra.contextDigest) return false;      // (c) current context digest
    return true;
  }
  /** R5B-REV-01 — the OPERATION-SPECIFIC result-authority gate. A result authority is only acceptable if it is
   *  first internally-consistent + current (validateResultAuthority) AND the operation is allowed the authority
   *  it presents: a SOURCE-BOUND operation (READ_CURRENT_RESULTS / COMPARE_VISIBLE_HOTELS /
   *  READ_CURRENT_HOTEL_FACTS) requires the result authority to be EXACTLY the immutable source authority the
   *  proposal was registered under (`ra.authorityRef === p.authorityRef`) — so once the context advances past the
   *  source, that operation can NEVER verify (neither against the stale source, nor against the advanced context).
   *  ONLY the three advanceable UI-local operations (APPLY/OPEN/SHOW) may verify against a bounded, separately
   *  validated ADVANCED result authority. There is NO generic "current result authority is valid" rule — an
   *  unclassified operation fails closed. */
  function resultAuthorityOk(session: LiveAiSession, p: PendingProposal, ra: ResultAuthorityTuple | null): boolean {
    if (!ra) return false;
    if (!validateResultAuthority(session, ra)) return false;              // internally-consistent + current (always)
    if (SOURCE_BOUND_OPS.has(p.operation)) return ra.authorityRef === p.authorityRef; // source-bound: result == source, no advancement
    if (ADVANCEABLE_OPS.has(p.operation)) return true;                    // advanceable: a bounded advanced result is permitted
    return false;                                                         // unknown operation → never advance (fail closed)
  }
  function applyReceiptLifecycle(session: LiveAiSession, r: { receiptId: string; proposalId: string; providerTurnId: string; operation: string; authorityRef: string; actionId: string; executionNonce: string; outcome: string; digest: string; resultAuthority: ResultAuthorityTuple | null }): LifecycleResult {
    const p = session.proposals.get(r.proposalId);
    if (!p) return { kind: "invalid" };                                   // unknown proposal
    if (p.receiptId !== r.receiptId) return { kind: "invalid" };          // R5B — receipt identity must be the gateway's
    if (p.providerTurnId !== r.providerTurnId) return { kind: "invalid" };
    if (p.executionNonce !== r.executionNonce) return { kind: "invalid" };
    if (p.operation !== r.operation) return { kind: "invalid" };
    if (p.authorityRef !== r.authorityRef) return { kind: "invalid" };    // R5B — SOURCE authority binding (immutable; NOT weakened)
    const isTerminal = R5B_TERMINAL_OUTCOMES.has(r.outcome);
    const isNegativeTerminal = isTerminal && r.outcome !== "verified";

    // TERMINAL already — replay handling (section 18): exact duplicate idempotent, conflict reject.
    if (p.state === "terminal") {
      if (!isTerminal) return { kind: "invalid" };                        // an `acted` replay against a terminal is invalid
      if (p.terminalOutcome === (r.outcome as ProposalTerminalOutcome) && p.terminalDigest === r.digest) return { kind: "idempotent", proposal: p, outcome: p.terminalOutcome };
      return { kind: "conflict" };                                        // different outcome or content → reject
    }

    // R5B-REV-08 — PRE-ACCEPT (state "pending", no bound actionId): a browser refusal BEFORE acceptance,
    // correlated on every identity field, terminalizes the proposal (gateway-owned, no fabricated
    // actionId). An acted/verified receipt before acceptance is invalid (nothing was executed).
    if (p.state === "pending") {
      if (isNegativeTerminal) {
        p.state = "terminal"; p.terminalOutcome = r.outcome as ProposalTerminalOutcome; p.terminalDigest = r.digest;
        return { kind: "terminal", proposal: p, outcome: p.terminalOutcome };
      }
      return { kind: "invalid" };                                         // receipt (acted/verified) before acceptance
    }

    // state is "accepted" or "awaiting_verification" — the EXACT bound actionId is required.
    if (p.acceptedActionId === null || p.acceptedActionId !== r.actionId) return { kind: "invalid" };

    if (r.outcome === "acted") {
      // R5B-REV-07 — a SECOND acted (already awaiting_verification): EXACT duplicate is idempotent (no
      // mutation, no resultAuthority overwrite, no second execution); a CONFLICTING acted rejects, and the
      // original acted state + result authority are PRESERVED.
      if (p.state === "awaiting_verification") {
        if (p.actedDigest === r.digest) return { kind: "advanced_idempotent", proposal: p };
        return { kind: "conflict" };
      }
      // FIRST acted binds the first result-observation authority — R5B-REV-01 op-specific: a source-bound
      // read/compare/detail requires result == source; only APPLY/OPEN/SHOW may bind an advanced authority.
      if (!resultAuthorityOk(session, p, r.resultAuthority)) return { kind: "invalid" };
      p.state = "awaiting_verification";
      p.actedDigest = r.digest;
      p.resultAuthority = r.resultAuthority;
      return { kind: "advanced", proposal: p };
    }

    if (r.outcome === "verified") {
      // R5B-REV-01 — the FULL result authority MUST be independently valid & current AND op-specifically
      // authorized BEFORE the verified terminal: a source-bound READ/COMPARE/FACTS may verify ONLY against its
      // exact source authority (so a proposal accepted under context A can never verify against advanced context
      // B), while only APPLY/OPEN/SHOW may verify against a separately-validated advanced authority. A
      // wrong/copied/delayed/cross-session/cross-proposal/advanced-for-a-source-bound-op authority rejects (the
      // immutable source-authority checks above are NOT weakened to let it through).
      if (!resultAuthorityOk(session, p, r.resultAuthority)) return { kind: "invalid" };
      p.state = "terminal"; p.terminalOutcome = "verified"; p.terminalDigest = r.digest; p.resultAuthority = r.resultAuthority;
      return { kind: "terminal", proposal: p, outcome: "verified" };
    }

    // negative terminal (rejected / stale / unknown) from accepted / awaiting_verification.
    if (isNegativeTerminal) {
      p.state = "terminal"; p.terminalOutcome = r.outcome as ProposalTerminalOutcome; p.terminalDigest = r.digest;
      // R5B-REV-01 — a negative terminal only records a result authority the operation is actually allowed to
      // present (op-specific); it is never consumed as verified evidence, but the op-specific gate is kept
      // consistent so a source-bound op never stores an advanced authority.
      if (r.resultAuthority && resultAuthorityOk(session, p, r.resultAuthority)) p.resultAuthority = r.resultAuthority;
      return { kind: "terminal", proposal: p, outcome: p.terminalOutcome };
    }
    return { kind: "invalid" };
  }

  // ── R2-08 — the plan awaiting browser approval before TTS ─────────────────────
  function setPendingPlan(session: LiveAiSession, plan: PendingPlan) { if (!session.terminated) session.pendingPlan = plan; }
  /** Take the pending plan ONLY when the approval matches EVERY binding field. */
  function takeApprovedPlan(session: LiveAiSession, a: { planId: string; authorityRef: string; textHash: string; turnId: string; generation: number }): PendingPlan | null {
    const p = session.pendingPlan;
    if (!p) return null;
    if (p.planId !== a.planId || p.authorityRef !== a.authorityRef) return null;
    if (p.expectedTextHash !== a.textHash) return null;
    if (p.turnId !== a.turnId || p.generation !== a.generation) return null;
    if (session.ackAuthorityRef !== p.authorityRef) return null;         // stale authority
    session.pendingPlan = null;                                          // one-use
    return p;
  }
  function clearPendingPlan(session: LiveAiSession) { session.pendingPlan = null; }

  /** R2-13 — consume one provider turn against the hard ceiling; false ⇒ refused. */
  function consumeProviderTurn(session: LiveAiSession): boolean {
    if (session.terminated) return false;
    if (session.providerTurns >= limits.maxProviderTurns) return false;
    session.providerTurns += 1;
    return true;
  }

  /** R3-13 — charge `bytes` of captured speech against the hard cumulative ceiling.
   *  Returns false (and does NOT increment) when the byte count is invalid OR the
   *  cumulative total WOULD exceed maxSessionSpeechBytes — the authoritative server-side
   *  speech cap: a turn.text that would breach the ceiling is refused (fail closed),
   *  and the counter never advances past the cap. */
  function consumeSpeechBytes(session: LiveAiSession, bytes: number): boolean {
    if (session.terminated) return false;
    if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes < 0) return false;
    if (session.speechBytes + bytes > limits.maxSessionSpeechBytes) return false;
    session.speechBytes += bytes;
    return true;
  }

  function setContextAck(session: LiveAiSession, authorityRef: string, tuple: string, contextDigest: string) {
    if (session.terminated) return;
    const prior = session.ackAuthorityRef;
    session.ackAuthorityRef = authorityRef;
    session.ackTuple = tuple;
    session.ackContextDigest = contextDigest;
    // R5B-REV-08 — a context ADVANCE (a NEW authorityRef) leaves any still-PENDING (never-accepted)
    // proposal bound to a now-stale source authority permanently un-acceptable (accept requires
    // source == current). Terminalize those pre-accept as stale (gateway-owned; no fabricated actionId)
    // so they never remain executable-pending. ACCEPTED / awaiting_verification proposals are a
    // legitimate mid-lifecycle advance (APPLY/OPEN/SHOW) and are NOT touched here.
    if (prior !== authorityRef) {
      Array.from(session.proposals.values()).forEach((p) => {
        if (p.state === "pending" && p.authorityRef !== authorityRef) { p.state = "terminal"; p.terminalOutcome = "stale"; p.terminalDigest = null; }
      });
    }
    touch(session);
  }
  /** REV-06/R5B — a new context publish on the SAME tuple key but with DIFFERENT content is a
   *  conflict: revoke the prior executable ACK (never keep stale authority) AND terminalize every
   *  still-live (non-terminal) proposal bound to the now-revoked authority as terminal(stale), so a
   *  pre-execution incompatible context change means those proposals can NEVER later verify. */
  function revokeContextAck(session: LiveAiSession) {
    const revoked = session.ackAuthorityRef;
    session.ackAuthorityRef = null;
    session.ackTuple = null;
    session.ackContextDigest = null;
    session.pendingTurn = null;
    session.pendingPlan = null; // R2-08 — a context conflict also invalidates any un-approved plan
    if (revoked !== null) {
      Array.from(session.proposals.values()).forEach((p) => {
        if (p.state !== "terminal" && p.authorityRef === revoked) { p.state = "terminal"; p.terminalOutcome = "stale"; p.terminalDigest = null; }
      });
    }
  }
  function recordVerifiedReceipt(session: LiveAiSession, receipt: { receiptId: string; proposalId: string; operation: string; outcome: string; evidence?: VerifiedReceipt["evidence"]; authorityRef: string }) {
    if (session.terminated) return;
    // R3-08/R4-08 — store the COMPLETE correlated verified receipt (proposal + verified outcome
    // + executable authority + exact bounded evidence), so a later turn (different authorityRef)
    // cannot cite it, and an answer plan resolves field-by-field to an ACTUAL verified action.
    if (session.verifiedReceipts.size < 256) session.verifiedReceipts.set(receipt.receiptId, { proposalId: receipt.proposalId, operation: receipt.operation, outcome: receipt.outcome, evidence: receipt.evidence, authorityRef: receipt.authorityRef });
    touch(session);
  }
  /** R5B-REV-04 — is the session's pending follow-up turn the EXACT follow-up for a live (accepted /
   *  awaiting_verification, non-terminal) OPEN proposal? Used to decide whether an AUTHORIZED OPEN route
   *  transition (a `route_change` interrupt) may preserve the pending turn — the terminal verified OPEN
   *  explanation depends on it. A generic interrupt, or a route change with no such live OPEN, must NOT
   *  preserve an arbitrary turn. Bounded, read-only. */
  function pendingTurnBoundToLiveOpen(session: LiveAiSession): boolean {
    const pt = session.pendingTurn;
    if (!pt) return false;
    let bound = false;
    Array.from(session.proposals.values()).forEach((p) => {
      if (bound) return;
      if (p.operation === "OPEN_VISIBLE_HOTEL" && p.providerTurnId === pt.providerTurnId && (p.state === "accepted" || p.state === "awaiting_verification")) bound = true;
    });
    return bound;
  }
  function setPendingTurn(session: LiveAiSession, pending: PendingTurn) { if (!session.terminated) session.pendingTurn = pending; }
  /** Take the pending turn ONLY when its providerTurnId correlates the verified receipt. */
  function takePendingTurn(session: LiveAiSession, providerTurnId: string): PendingTurn | null {
    const p = session.pendingTurn;
    if (p && p.providerTurnId === providerTurnId) { session.pendingTurn = null; return p; }
    return null;
  }

  function terminate(session: LiveAiSession, reason: "user" | "timeout" | "unmount" | "closed") {
    if (session.terminated) return;
    session.terminated = true;
    // R5C — finalize the session's server capture segment on EVERY termination path
    // (before the rest of teardown), so no reason can leave a dangling active segment.
    try { deps.onTerminate?.(session); } catch { /* a hook must never break teardown */ }
    session.lastContext = null;
    session.pendingTurn = null;
    session.pendingPlan = null;
    session.controlLive = false;
    clearTimers(session);
    try { session.abort.abort(); } catch { /* no-op */ }
    try { session.emit?.({ t: "session.ended", sessionId: session.sessionId, reason }); } catch { /* no-op */ }
    try { session.closeControl?.(); } catch { /* no-op */ }
    dec(bySubject, session.subject);
    dec(byIp, session.ipHash);
    sessions.delete(session.gatewaySessionId);
  }
  function get(gatewaySessionId: string): LiveAiSession | null { return sessions.get(gatewaySessionId) || null; }
  function drainAll(): number {
    const all = Array.from(sessions.values());
    for (const s of all) {
      if (s.terminated) continue;
      try { s.emit?.({ t: "session.killed", sessionId: s.sessionId, code: "runtime_killed" }); } catch { /* no-op */ }
      terminate(s, "closed");
    }
    return all.length;
  }

  /** R2-06 — the SERVER-computed SHA-256 authorityRef over the COMPLETE tuple:
   *  gatewaySessionId · sessionId · turnId · GENERATION · routeEpoch ·
   *  contextRevision · contextDigest. Generation is part of the executable authority,
   *  and the server never trusts a caller-selected hash — it recomputes its own. */
  function computeAuthorityRef(session: LiveAiSession, turnId: string, generation: number, routeEpoch: number, contextRevision: string, contextDigest: string): string {
    const h = createHash("sha256");
    // Field separator is a NUL written as a TEXTUAL escape (\u0000), NEVER a
    // literal control byte in source — a literal NUL made Git classify this .ts
    // as binary and degraded line/blame/security review (REV-14). Runtime value
    // is one non-printable separator that cannot occur inside any joined field.
    h.update([session.gatewaySessionId, session.sessionId, turnId, String(generation), String(routeEpoch), contextRevision, contextDigest].join("\u0000"));
    return "ar." + h.digest("hex").slice(0, 40);
  }

  return {
    create, bindRuntime, controlDetached, setContextAck, revokeContextAck, recordVerifiedReceipt,
    setPendingTurn, takePendingTurn, pendingTurnBoundToLiveOpen,
    registerProposal, acceptProposalAction, applyReceiptLifecycle,
    setPendingPlan, takeApprovedPlan, clearPendingPlan,
    consumeProviderTurn, consumeSpeechBytes,
    terminate, get, drainAll, touch, computeAuthorityRef,
    size: () => sessions.size,
  };
}
export type LiveAiSessionStore = ReturnType<typeof createLiveAiSessionStore>;

// ─────────────────────────────────────────────────────────────────────────
// R5C — INDEPENDENT SERVER-SIDE CAPTURE LEDGER (process-local, no durable DB).
//
// A second, INDEPENDENT capture-duration enforcer that NEVER trusts any browser-
// reported duration: it measures elapsed with its OWN injected server clock (separate
// from the browser's monotonic clock — independent authorities). Identity = the trusted
// authenticated SUBJECT + the scoped browser (gateway) session. Accounting begins ONLY
// on a successful microphone negotiation (text mode opens NO segment). Per subject:
//   • exactly ONE active segment at a time;
//   • each admitted segment ≤ MAX_SEGMENT_MS;
//   • cumulative capture ≤ MAX_CUMULATIVE_MS, accrued ACROSS reconnects/replacements
//     under the SAME subject (a reconnect or a replacement can NEVER reset it);
//   • another subject can never reuse / overwrite / finalize this subject's segment;
//   • interruption / reset / end / termination FINALIZES the active segment (charging the
//     ACTUAL server-measured elapsed); a duplicate / reordered terminal is INERT; a closed
//     segment can never reopen;
//   • a segment reaching its admitted ceiling force-finalizes (charges admitted) and calls
//     onSegmentExpired (the wiring terminates the session);
//   • bounded tombstone retention: finalized per-subject usage is retained (so a reconnect
//     cannot reset cumulative) but pruned under a capacity bound — NEVER evicting a subject
//     with a LIVE active segment (never evict live authority to admit new);
//   • capacity exhaustion FAILS CLOSED (a new subject is refused rather than evicting a
//     live one).
// No secret / token / transcript is ever stored or logged.
// ─────────────────────────────────────────────────────────────────────────
export const SERVER_MAX_SEGMENT_MS = 20_000;
export const SERVER_MAX_CUMULATIVE_MS = 180_000;
export const SERVER_MAX_SUBJECTS = 4096;
export const SERVER_TOMBSTONE_RETENTION_MS = 30 * 60_000;

export interface ServerCaptureSnapshot {
  usedMs: number;
  remainingMs: number;
  active: boolean;
  broken: boolean;
  segmentCount: number;
  admittedMs: number;
}
export type ServerBeginResult =
  | { ok: true; admittedMs: number }
  | { ok: false; reason: "broken" | "busy" | "exhausted" | "clock" | "capacity" };

interface ServerSubjectLedger {
  usedMs: number;
  broken: boolean;
  lastSeen: number;
  segmentSeq: number;
  active: { id: number; sessionKey: string; admittedMs: number; startedAt: number; timer: unknown } | null;
}

export function createServerCaptureLedger(deps: {
  now: () => number;
  timers?: TimerFacility;
  maxSegmentMs?: number;
  maxCumulativeMs?: number;
  maxSubjects?: number;
  tombstoneRetentionMs?: number;
  /** invoked when a segment reaches its admitted ceiling (the 20s server cap); the wiring
   *  terminates the session. The segment is already charged + closed. */
  onSegmentExpired?: (subject: string, sessionKey: string) => void;
}) {
  const now = deps.now;
  const timers = deps.timers || defaultTimers;
  const MAX_SEG = deps.maxSegmentMs && deps.maxSegmentMs > 0 ? deps.maxSegmentMs : SERVER_MAX_SEGMENT_MS;
  const MAX_CUM = deps.maxCumulativeMs && deps.maxCumulativeMs > 0 ? deps.maxCumulativeMs : SERVER_MAX_CUMULATIVE_MS;
  const MAX_SUBJECTS = deps.maxSubjects && deps.maxSubjects > 0 ? deps.maxSubjects : SERVER_MAX_SUBJECTS;
  const RETENTION = deps.tombstoneRetentionMs && deps.tombstoneRetentionMs > 0 ? deps.tombstoneRetentionMs : SERVER_TOMBSTONE_RETENTION_MS;
  const bySubject = new Map<string, ServerSubjectLedger>();

  function readClock(): number | null { let t: number; try { t = now(); } catch { return null; } return typeof t === "number" && Number.isFinite(t) ? t : null; }
  function remaining(e: ServerSubjectLedger): number { const r = MAX_CUM - e.usedMs; return r > 0 ? r : 0; }
  function clearTimer(e: ServerSubjectLedger) { if (e.active && e.active.timer !== undefined && e.active.timer !== null) { try { timers.clear(e.active.timer); } catch { /* no-op */ } } }
  function charge(e: ServerSubjectLedger, seg: { admittedMs: number; startedAt: number }, kind: "partial" | "expired"): number {
    let elapsed: number;
    if (kind === "expired") { elapsed = seg.admittedMs; }
    else {
      const t = readClock();
      if (t === null || t < seg.startedAt) { e.broken = true; elapsed = seg.admittedMs; }
      else { const d = t - seg.startedAt; elapsed = d < seg.admittedMs ? d : seg.admittedMs; }
    }
    if (!(elapsed >= 0)) { e.broken = true; elapsed = seg.admittedMs; }
    e.usedMs += elapsed;
    if (e.usedMs > MAX_CUM) e.usedMs = MAX_CUM;
    return elapsed;
  }
  // R5C — bounded tombstone retention: when at capacity and a NEW subject needs a slot,
  // prune the oldest INACTIVE (no live segment) subject whose lastSeen is beyond the
  // retention window. A subject with a live active segment is NEVER pruned (never evict
  // live authority). Returns whether a slot is now available.
  function pruneForCapacity(t: number): boolean {
    if (bySubject.size < MAX_SUBJECTS) return true;
    let victimKey: string | null = null;
    let victimSeen = Infinity;
    Array.from(bySubject.entries()).forEach(([k, e]) => {
      if (e.active) return;                                   // never evict a live segment
      if (t - e.lastSeen < RETENTION) return;                 // still within retention
      if (e.lastSeen < victimSeen) { victimSeen = e.lastSeen; victimKey = k; }
    });
    if (victimKey !== null) { bySubject.delete(victimKey); return true; }
    return false;                                             // capacity exhausted, fail closed
  }

  return {
    /** Begin a capture segment on a successful mic negotiation. Fails CLOSED on a broken
     *  latch, an existing live segment (busy — never evicted), an exhausted cumulative
     *  allowance, a bad clock, or capacity exhaustion. */
    beginSegment(subject: string, sessionKey: string): ServerBeginResult {
      if (typeof subject !== "string" || !subject || typeof sessionKey !== "string" || !sessionKey) return { ok: false, reason: "capacity" };
      const t = readClock();
      if (t === null) return { ok: false, reason: "clock" };
      let e = bySubject.get(subject);
      if (!e) {
        if (!pruneForCapacity(t)) return { ok: false, reason: "capacity" };
        e = { usedMs: 0, broken: false, lastSeen: t, segmentSeq: 0, active: null };
        bySubject.set(subject, e);
      }
      if (e.broken) return { ok: false, reason: "broken" };
      if (e.active) return { ok: false, reason: "busy" };       // never evict live authority
      const rem = remaining(e);
      if (rem <= 0) return { ok: false, reason: "exhausted" };
      const admittedMs = rem < MAX_SEG ? rem : MAX_SEG;
      const id = ++e.segmentSeq;
      const timer = timers.set(() => {
        const cur = bySubject.get(subject);
        if (!cur || !cur.active || cur.active.id !== id) return;
        const seg = cur.active; cur.active = null; cur.lastSeen = readClock() ?? cur.lastSeen;
        charge(cur, seg, "expired");
        try { deps.onSegmentExpired?.(subject, sessionKey); } catch { /* never throw into the timer */ }
      }, admittedMs);
      e.active = { id, sessionKey, admittedMs, startedAt: t, timer };
      e.lastSeen = t;
      return { ok: true, admittedMs };
    },
    /** Finalize the subject's active segment (interruption / reset / end / termination).
     *  Inert unless the ACTIVE segment belongs to THIS exact (subject, sessionKey) — a
     *  stale session's terminal, another subject's frame, a duplicate/reordered terminal,
     *  or a closed segment all charge NOTHING (return 0). */
    finalizeSegment(subject: string, sessionKey: string, kind: "partial" | "expired"): number {
      const e = bySubject.get(subject);
      if (!e || !e.active) return 0;
      if (e.active.sessionKey !== sessionKey) return 0;         // another session under the subject can't finalize this
      clearTimer(e);
      const seg = e.active; e.active = null;
      const charged = charge(e, seg, kind);
      e.lastSeen = readClock() ?? e.lastSeen;
      return charged;
    },
    snapshot(subject: string): ServerCaptureSnapshot {
      const e = bySubject.get(subject);
      if (!e) return { usedMs: 0, remainingMs: MAX_CUM, active: false, broken: false, segmentCount: 0, admittedMs: 0 };
      return { usedMs: e.usedMs, remainingMs: remaining(e), active: e.active !== null, broken: e.broken, segmentCount: e.segmentSeq, admittedMs: e.active ? e.active.admittedMs : 0 };
    },
    size: () => bySubject.size,
  };
}
export type ServerCaptureLedger = ReturnType<typeof createServerCaptureLedger>;
