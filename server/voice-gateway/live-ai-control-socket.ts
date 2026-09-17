// ─────────────────────────────────────────────────────────────────────────
// StayBid Live AI — LIVE-AI-02A — authenticated closed control socket (isolated).
//
// The Live-AI control WebSocket protocol. The control token travels ONLY in the
// WS SUBPROTOCOL (never a query string), is HMAC-verified + bound to the gateway
// session id, and there is NO old-control-frame compatibility. Inbound frames are
// strictly validated (live-ai-schemas) before any effect; context.publish mints
// the per-tuple authorityRef + returns context.ack; turn.text drives the isolated
// orchestrator; action.receipt records only a verified receipt id; interrupt/reset
// abort the in-flight turn; end terminates. No secret/token/transcript is logged.
// ─────────────────────────────────────────────────────────────────────────
import { verifyControlTokenWithSecret } from "./auth";
import { validateInboundFrame, validateActionReceipt, validateActionAccepted, evidenceMatchesOperation, evidenceMatchesProposalSemantics, trustedEvidenceAuthority, contextDigest, terminalReceiptCommitment, UNACCEPTED_ACTION_ID, MAX_FRAME_BYTES } from "./live-ai-schemas";
import { type LiveAiSession, type LiveAiSessionStore, type Emit, type ResultAuthorityTuple, type ServerCaptureLedger } from "./live-ai-sessions";

export interface GatewaySocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

/** A bounded JSON emitter for gateway→client frames. */
export function makeLiveAiEmit(socket: GatewaySocket): Emit {
  return (frame: Record<string, unknown>) => {
    let text: string;
    try { text = JSON.stringify(frame); } catch { return; }
    if (typeof text !== "string" || text.length > MAX_FRAME_BYTES) return;
    try { socket.send(text); } catch { /* a dead socket must never throw into the loop */ }
  };
}

// LIVE-AI-03B (P1-06) — the browser's action.accepted for a 03B-owned lifecycle, held until its
// terminal action.receipt so both reach controller.resumeWithObservation together. Per-session,
// GC'd with the session; never used for legacy-owned turns.
const accepted03bBySession = new WeakMap<LiveAiSession, unknown>();

const SUBPROTO_TOKEN_RE = /^sbt\.(.+)$/;
function extractControlToken(subprotocol: unknown): string | null {
  if (typeof subprotocol !== "string" || !subprotocol) return null;
  for (const raw of subprotocol.split(",")) {
    const m = SUBPROTO_TOKEN_RE.exec(raw.trim());
    if (m) return m[1];
  }
  return null;
}

export type ControlOpenResult =
  | { ok: true; session: LiveAiSession }
  | { ok: false; code: string; closeCode: number };

/** Authorize a Live-AI control-socket open: token from subprotocol only, bound to
 *  the gateway session id, verified HMAC + freshness; the session must be live. */
export function authorizeLiveAiControlOpen(input: {
  subprotocol: unknown;
  gatewaySessionId: string;
  controlTokenSecret: string | null;
  controlTokenMaxAgeMs: number;
  store: LiveAiSessionStore;
  now?: () => number;
}): ControlOpenResult {
  const token = extractControlToken(input.subprotocol);
  if (!token) return { ok: false, code: "control_token_missing", closeCode: 4401 };
  const verified = verifyControlTokenWithSecret(token, input.gatewaySessionId, input.controlTokenSecret, input.controlTokenMaxAgeMs, input.now);
  if (!verified.ok) return { ok: false, code: verified.code, closeCode: 4401 };
  const session = input.store.get(input.gatewaySessionId);
  if (!session || session.terminated) return { ok: false, code: "session_gone", closeCode: 4404 };
  return { ok: true, session };
}

export interface ControlFrameDeps {
  session: LiveAiSession;
  store: LiveAiSessionStore;
  runTurn: (session: LiveAiSession, input: { turnId: string; generation: number; transcript: string; language: "hi" | "hinglish" | "en"; context: unknown; phase?: "initial" | "followup" }) => Promise<void>;
  /** R2-08 — voice an APPROVED plan (the ONLY entry point into TTS). */
  runTts?: (session: LiveAiSession, plan: { planId: string; turnId: string; generation: number; ttsText: string; language: "hi" | "hinglish" | "en"; authorityRef: string }) => Promise<void>;
  /** LIVE-AI-03B — the OPTIONAL staging-text route. When present (staging gate ON + subject
   *  allowlisted), a turn.text is driven through the 03B controller (IC01 → provider/03A →
   *  IC02 compiled envelope), NOT the legacy orchestrator. Absent by default (production
   *  dormancy) ⇒ the legacy runTurn path is byte-identical. */
  run03bTextTurn?: (session: LiveAiSession, input: { turnId: string; generation: number; transcript: string; language: "hi" | "hinglish" | "en"; context: unknown }) => Promise<void>;
  /** LIVE-AI-03B (P1-06) — route a RETAINED, capability-suspended 03B turn's acceptance (Stage 2) +
   *  terminal receipt (Stage 3) through the RELEASED 03A on the SAME controller. Present only alongside
   *  run03bTextTurn. `accept03bAction` fires acceptAction on action.accepted; `resume03bObservation`
   *  fires deliverTerminal on the terminal action.receipt. */
  has03bLifecycle?: (session: LiveAiSession) => boolean;
  accept03bAction?: (session: LiveAiSession, accepted: unknown) => Promise<boolean>;
  resume03bObservation?: (session: LiveAiSession, receipt: unknown) => Promise<boolean>;
  /** LIVE-AI-03B (P1-07) — interrupt + tear down the active 03B lifecycle (abort provider, revoke). */
  interrupt03b?: (session: LiveAiSession, reason: string) => Promise<boolean>;
  /** R5C — the independent server capture ledger. An interruption / reset FINALIZES the
   *  session's active capture segment (charging the actual server-measured elapsed);
   *  session.end finalizes via store.terminate → the store's onTerminate hook. */
  captureLedger?: ServerCaptureLedger;
  now?: () => number;
}

/** Handle one inbound control frame. Returns a bounded status word (for tests). */
export function handleLiveAiControlFrame(deps: ControlFrameDeps & { raw: unknown }): string {
  const { session, store } = deps;
  if (session.terminated) return "terminated";
  const text = typeof deps.raw === "string" ? deps.raw : Buffer.isBuffer(deps.raw) ? deps.raw.toString("utf8") : "";
  if (!text || text.length > MAX_FRAME_BYTES) return "oversize";
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return "unparsable"; }
  const frame = validateInboundFrame(parsed);
  if (!frame) return "invalid";
  if (frame.sessionId !== session.sessionId) return "session_mismatch";
  store.touch(session);

  switch (frame.t) {
    case "context.publish": {
      const routeEpoch = frame.payload.routeEpoch as number;
      const contextRevision = frame.payload.contextRevision as string;
      const context = frame.payload.context; // already strictly validated in live-ai-schemas
      // REV-06 — a FULL-content canonical digest of the (validated) context, so two
      // contexts that differ ANYWHERE produce different authority, and a same-tuple
      // republish with different content is a detectable conflict.
      const digest = contextDigest(context);
      const tuple = `${frame.turnId}|${routeEpoch}|${contextRevision}`;
      if (session.ackTuple === tuple && session.ackContextDigest !== null && session.ackContextDigest !== digest) {
        // same tuple key, DIFFERENT content → conflict: revoke the prior executable
        // ACK (never keep stale authority), do NOT re-ack.
        store.revokeContextAck(session);
        return "conflict";
      }
      // R2-06 — the GENERATION is part of the server's executable-authority tuple.
      const authorityRef = store.computeAuthorityRef(session, frame.turnId as string, frame.generation, routeEpoch, contextRevision, digest);
      session.lastContext = context;
      store.setContextAck(session, authorityRef, tuple, digest);
      session.emit?.({ t: "context.ack", sessionId: session.sessionId, turnId: frame.turnId, generation: frame.generation, routeEpoch, contextRevision, authorityRef });
      return "ack";
    }
    case "turn.text": {
      const language = (frame.payload.languageHint as "hi" | "hinglish" | "en") || "en";
      // R3-13 — authoritative CUMULATIVE captured-speech ceiling: charge the transcript
      // bytes against the hard per-session cap BEFORE consuming a provider turn, so a
      // turn that would breach the ceiling is refused (fail closed) and burns no turn.
      const speechBytes = Buffer.byteLength(frame.payload.text as string, "utf8");
      if (!store.consumeSpeechBytes(session, speechBytes)) {
        session.emit?.({ t: "turn.error", sessionId: session.sessionId, turnId: frame.turnId, generation: frame.generation, code: "budget_exceeded" });
        return "speech_ceiling";
      }
      // R2-13 — hard per-session provider-turn ceiling (refuse, never uncontrolled).
      if (!store.consumeProviderTurn(session)) {
        session.emit?.({ t: "turn.error", sessionId: session.sessionId, turnId: frame.turnId, generation: frame.generation, code: "budget_exceeded" });
        return "turn_ceiling";
      }
      // R2-08 — a NEW turn supersedes: abort the in-flight provider work + drop any
      // pending plan/turn so a late earlier turn can never overwrite current state.
      try { session.abort.abort(); } catch { /* no-op */ }
      session.abort = new AbortController();
      store.clearPendingPlan(session);
      session.pendingTurn = null;
      // LIVE-AI-03B — when the staging-text seam is injected (gate ON + subject allowlisted),
      // route through the 03B controller instead of the legacy orchestrator (§23). Dormant by
      // default: with no seam this is exactly the pre-existing legacy path.
      if (deps.run03bTextTurn) {
        void deps.run03bTextTurn(session, { turnId: frame.turnId as string, generation: frame.generation, transcript: frame.payload.text as string, language, context: session.lastContext });
        return "turn_03b";
      }
      void deps.runTurn(session, { turnId: frame.turnId as string, generation: frame.generation, transcript: frame.payload.text as string, language, context: session.lastContext, phase: "initial" });
      return "turn";
    }
    case "action.accepted": {
      // LIVE-AI-03B (P1-06, Stage 2) — a 03B-owned capability lifecycle owns this acceptance: validate it
      // and route it IMMEDIATELY through the RELEASED 03A (ExecutionSafety.acceptAction) on the retained
      // controller. 03A acknowledges the dispatch on the SAME loop internally; the turn stays awaiting the
      // terminal receipt. (Also mirror it into the per-session slot for teardown symmetry.)
      if (deps.has03bLifecycle?.(session)) {
        const acc03b = validateActionAccepted(frame.payload.accepted);
        if (!acc03b) return "accepted_invalid";
        accepted03bBySession.set(session, acc03b);
        if (deps.accept03bAction) void deps.accept03bAction(session, acc03b);
        return "accepted_03b";
      }
      // R3-05 — the browser announces it accepted a proposal + minted the actionId.
      // Validate the announcement strictly, then BIND the actionId to the pending
      // proposal under the CURRENT authority + full tuple (proposalId + providerTurnId +
      // operation + authorityRef + turn + generation). A later receipt must carry this
      // exact actionId; a mismatching / stale / forged announcement is refused.
      const accepted = validateActionAccepted(frame.payload.accepted);
      if (!accepted) return "accepted_invalid";
      const bound = store.acceptProposalAction(session, {
        receiptId: accepted.receiptId as string,           // R5B — the browser echoes the gateway receipt identity
        proposalId: accepted.proposalId as string,
        providerTurnId: accepted.providerTurnId as string,
        actionId: accepted.actionId as string,
        executionNonce: accepted.executionNonce as string, // R4-05 — the gateway commitment
        operation: accepted.operation as string,
        authorityRef: accepted.authorityRef as string,
        turnId: frame.turnId as string,
        generation: frame.generation,
      });
      return bound ? "accepted" : "accepted_uncorrelated";
    }
    case "action.receipt": {
      // LIVE-AI-03B (P1-06) — a 03B-owned capability lifecycle owns this terminal observation: route
      // the (held accepted + this receipt) to the SAME retained controller via resumeWithObservation.
      // It NEVER enters the legacy proposal/receipt lifecycle (no double authority owner).
      if (deps.has03bLifecycle?.(session) && deps.resume03bObservation) {
        const receipt03b = validateActionReceipt(frame.payload.receipt);
        if (!receipt03b) return "receipt_invalid";
        accepted03bBySession.delete(session);            // acceptance already routed through 03A at action.accepted (Stage 2)
        void deps.resume03bObservation(session, receipt03b);
        return "receipt_03b";
      }
      // R5B — the FULL receipt lifecycle. A receipt is correlated on every identity field
      // (proposalId + the GATEWAY-minted receiptId + providerTurnId + executionNonce + operation +
      // source authority + the EXACT bound actionId); a `verified` outcome additionally requires
      // OPERATION-SPECIFIC + SEMANTIC evidence BEFORE any state transition. The lifecycle store
      // advances the state machine (accepted → awaiting_verification → terminal) and enforces replay
      // (exact-duplicate idempotent / conflict reject / negative-terminal consumes). The gateway then
      // emits action.receipt.ack (acceptance of the lifecycle update — NOT execution/verification).
      const receipt = validateActionReceipt(frame.payload.receipt);
      if (!receipt) return "receipt_invalid";
      const outcome = receipt.outcome as string;
      if (outcome === "verified") {
        // R3-05 — the evidence KIND must match the operation (OPEN now REQUIRES navigation/detail);
        // a semantically-incoherent verification is rejected before any lifecycle transition.
        if (!evidenceMatchesOperation(receipt.operation as string, receipt.evidence as { kind?: unknown } | undefined)) return "receipt_evidence_mismatch";
        // R4-05B/R5B — beyond the kind, the evidence must reflect the INTENDED SEMANTIC RESULT of the
        // exact registered proposal (right hotel / section / EXACT compared set + ids / ORDERED result
        // ids) under the CURRENT context. Evidence from the wrong entity/state/order is rejected.
        const pend = session.proposals.get(receipt.proposalId as string);
        // R5B-REV-02/03 — pass the proposal's STORED source-resolved hotel id (frozen at registration) so the
        // OPEN/SHOW semantic check binds the destination/result hotel to the trusted source identity, never to
        // a browser-supplied id or a destination context that (honestly) publishes visibleHotels: [].
        if (!evidenceMatchesProposalSemantics(receipt.operation as string, pend ? pend.operationSpec : null, receipt.evidence as { kind?: unknown } | undefined, session.lastContext, pend ? pend.sourceResolvedHotelId : null)) return "receipt_evidence_mismatch";
      }
      // R5B-REV-07 — a PRE-ACCEPT proposal (registered but NEVER accepted, so acceptedActionId is null)
      // carries a browser-generated actionId that was never bound. It must NOT appear in the terminal audit
      // / commitment: normalize the actionId to the UNACCEPTED sentinel for the digest + ACK commitment, so
      // the pre-accept terminal deterministically commits to the "no accepted action id" shape (two different
      // fabricated actionIds fold to the SAME commitment) and no later browser actionId can revive it. This
      // is derived from acceptedActionId === null, which is stable across replays (a pre-accept terminal
      // never binds an actionId). After acceptance the real bound actionId is committed unchanged.
      const proposalForAudit = session.proposals.get(receipt.proposalId as string);
      const preAcceptAudit = !!proposalForAudit && proposalForAudit.acceptedActionId === null;
      const auditReceipt = preAcceptAudit ? { ...receipt, actionId: UNACCEPTED_ACTION_ID } : receipt;
      // R5B — a canonical digest of the receipt distinguishes an EXACT-duplicate replay (idempotent)
      // from a CONFLICTING replay (reject). R5B-REV-06 — the CANONICAL TERMINAL-RECEIPT COMMITMENT the
      // gateway returns in the ACK (a SHA-256 over the full receipt identity + authority + result fields).
      const digest = contextDigest(auditReceipt);
      const commitment = terminalReceiptCommitment(auditReceipt);
      const life = store.applyReceiptLifecycle(session, {
        receiptId: receipt.receiptId as string,
        proposalId: receipt.proposalId as string,
        providerTurnId: receipt.providerTurnId as string,
        operation: receipt.operation as string,
        authorityRef: receipt.authorityRef as string,
        actionId: receipt.actionId as string,
        executionNonce: receipt.executionNonce as string,
        outcome,
        digest,
        // R5B-REV-01 — the FULL result authority the browser acknowledged the result under (independent
        // of the source authority); the store INDEPENDENTLY re-derives + validates it before advancing.
        resultAuthority: (receipt.resultAuthority as unknown as ResultAuthorityTuple | undefined) ?? null,
      });
      if (life.kind === "invalid") return "receipt_uncorrelated";
      if (life.kind === "conflict") return "receipt_conflict";           // conflicting terminal/acted replay → reject
      const isAdvance = life.kind === "advanced" || life.kind === "advanced_idempotent";
      const ackOutcome = isAdvance ? "acted" : life.outcome;
      const closed = !isAdvance;
      // R5B — record the trusted verified receipt ONLY on a FIRST verified terminal transition
      // (never on an idempotent replay, and NEVER on a negative terminal — acted != verified).
      if (life.kind === "terminal" && life.outcome === "verified") {
        // R5B-REV-04 — the trusted evidence is recorded under the OP-SPECIFIC authority: a source-bound
        // READ/COMPARE/FACTS keeps the exact source authority; an ADVANCEABLE APPLY/OPEN/SHOW is recorded
        // under the gateway-validated RESULT authority (life.proposal.resultAuthority, bound in the store),
        // so a legitimately-advanced verified receipt does not go stale and CAN support the follow-up plan.
        const evAuth = trustedEvidenceAuthority(receipt.operation as string, receipt.authorityRef as string, life.proposal.resultAuthority);
        if (evAuth !== null) {
          store.recordVerifiedReceipt(session, { receiptId: receipt.receiptId as string, proposalId: receipt.proposalId as string, operation: receipt.operation as string, outcome: "verified", evidence: receipt.evidence as import("./live-ai-sessions").VerifiedReceipt["evidence"], authorityRef: evAuth });
        }
        // REV-08 — a correlated verified receipt triggers the FOLLOW-UP EXPLAIN pass exactly once.
        // R5B-THIRD-REV-01 — the follow-up must run under the gateway-VALIDATED RESULT authority's
        // turn/generation, NOT the pending SOURCE turn/generation. For an advanceable op whose context
        // legitimately advanced (OPEN across an authorized route_change; APPLY/SHOW across a re-ack), the
        // destination result generation is CURRENT for the browser; emitting the follow-up under the stale
        // source generation makes the browser's isStale discard the AnswerPlan. We take turnId + generation
        // ONLY from the receipt's gateway-validated resultAuthority (never a client-selected value), and
        // retain the bounded transcript/language/provider correlation from the pending source turn. For a
        // source-bound op the result authority equals the source authority, so this is a no-op there.
        const pending = store.takePendingTurn(session, receipt.providerTurnId as string);
        if (pending) {
          const ra = life.proposal.resultAuthority;
          const followTurnId = ra ? ra.turnId : pending.turnId;
          const followGeneration = ra ? ra.generation : pending.generation;
          void deps.runTurn(session, { turnId: followTurnId, generation: followGeneration, transcript: pending.transcript, language: pending.language, context: session.lastContext, phase: "followup" });
        }
      }
      // R5B — ACK AFTER accepting the lifecycle update (an idempotent replay / duplicate acted is ACKed
      // WITHOUT re-execution / re-record / a second follow-up). The ACK carries the terminal-receipt
      // commitment; the browser promotes held terminal-verified evidence only on an exact commitment match.
      session.emit?.({ t: "action.receipt.ack", sessionId: session.sessionId, turnId: frame.turnId, generation: frame.generation, receiptId: receipt.receiptId, proposalId: receipt.proposalId, outcome: ackOutcome, closed, commitment });
      if (life.kind === "idempotent" || life.kind === "advanced_idempotent") return "receipt_idempotent";
      return "receipt";
    }
    case "answer.approve": {
      // R2-08 — the browser APPROVED an emitted plan: only now may TTS start. The
      // approval must match the pending plan on planId + authorityRef + textHash +
      // turn + generation, under the CURRENT authority (one-use).
      const approved = store.takeApprovedPlan(session, {
        planId: frame.payload.planId as string,
        authorityRef: frame.payload.authorityRef as string,
        textHash: frame.payload.textHash as string,
        turnId: frame.turnId as string,
        generation: frame.generation,
      });
      if (!approved) return "approve_rejected";
      if (deps.runTts) {
        void deps.runTts(session, { planId: approved.planId, turnId: approved.turnId, generation: approved.generation, ttsText: approved.ttsText, language: approved.language, authorityRef: approved.authorityRef });
      }
      return "approved";
    }
    case "turn.interrupt": {
      // REV-13/barge-in — abort the in-flight provider turn (the orchestrator passes
      // this signal into the adapter call) and drop any plan awaiting approval (stale
      // speech can never be voiced).
      try { session.abort.abort(); } catch { /* no-op */ }
      session.abort = new AbortController(); // reset for the next turn
      // LIVE-AI-03B (P1-07) — tear down any active 03B lifecycle (abort provider fetch, revoke authority).
      void deps.interrupt03b?.(session, (frame.payload.reason as string) || "interrupt");
      // R5B-REV-04 — an AUTHORIZED OPEN route transition (a `route_change` interrupt) must NOT clear the
      // OPEN's pending follow-up turn — the terminal verified OPEN explanation depends on it arriving after
      // the navigation. Preserve the pending turn ONLY when the reason is route_change AND the pending turn
      // is the EXACT follow-up for a live (accepted / awaiting_verification) OPEN proposal. Any other
      // interrupt (barge_in / user_cancel / context_change), or a route_change with no such live OPEN,
      // clears it as before (an arbitrary turn is NEVER preserved across a route change).
      const preserveOpenFollowup = frame.payload.reason === "route_change" && store.pendingTurnBoundToLiveOpen(session);
      if (!preserveOpenFollowup) session.pendingTurn = null;
      store.clearPendingPlan(session);
      // R5C2 (§11) — a CAPTURE-CLOSING interrupt (barge_in / user_cancel / context_change)
      // FINALIZES the server capture segment (charges the actual server-measured elapsed; a
      // duplicate interrupt after finalization is inert). A `route_change` is an AUTHORIZED
      // navigation where the SAME server capture segment legitimately CONTINUES under its
      // EXISTING deadline — mirroring the browser, whose existing lease + capture also continue
      // across a route_change. The provider turn is aborted + the R5B follow-up reconciled
      // above, but the segment is NEITHER finalized NOR reopened, the server per-segment timer
      // is neither reset nor extended, and the cumulative is unchanged. MUT-R5C2-05 anchor.
      if (frame.payload.reason !== "route_change") {
        try { deps.captureLedger?.finalizeSegment(session.subject, session.gatewaySessionId, "partial"); } catch { /* no-op */ }
      }
      return "interrupt";
    }
    case "session.reset": {
      try { session.abort.abort(); } catch { /* no-op */ }
      session.abort = new AbortController();
      void deps.interrupt03b?.(session, "reset"); // LIVE-AI-03B (P1-07)
      accepted03bBySession.delete(session);
      session.ackAuthorityRef = null;
      session.ackTuple = null;
      session.ackContextDigest = null;
      session.lastContext = null;
      session.pendingTurn = null;
      store.clearPendingPlan(session);
      session.verifiedReceipts.clear();
      // R5C — a reset FINALIZES the server capture segment (charges the actual elapsed);
      // a closed segment can never reopen (a later terminal is inert).
      try { deps.captureLedger?.finalizeSegment(session.subject, session.gatewaySessionId, "partial"); } catch { /* no-op */ }
      return "reset";
    }
    case "session.end": {
      void deps.interrupt03b?.(session, "end"); // LIVE-AI-03B (P1-07) — terminate active 03B authority
      accepted03bBySession.delete(session);
      store.terminate(session, "user");
      return "end";
    }
    default:
      return "ignored";
  }
}
