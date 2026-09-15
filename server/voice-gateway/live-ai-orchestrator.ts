// ─────────────────────────────────────────────────────────────────────────
// StayBid Live AI — LIVE-AI-02A — turn orchestrator (isolated).
//
// The fixed sequence (R2-08): UNDERSTAND → optional PROPOSE → browser EXECUTE →
// authoritative RECONCILE → VERIFIED receipt (server-correlated to the emitted
// proposal, R2-05) → FOLLOW-UP evidence-bound plan → BROWSER VALIDATES + APPROVES
// (answer.approve bound to planId + authorityRef + textHash + turn + generation) →
// ONLY THEN server TTS → playback. TTS is therefore NEVER produced before browser
// approval; an interrupt / context change / new turn invalidates the pending plan
// and any un-approved speech is unvoiceable.
//
// It imports ONLY the closed live-ai-schemas + the injected reasoning/TTS seams — no
// createToolExecutor, no old sideband, no searchHotels/getHotelDetails/getFlashDeals/
// compareHotels, no PREPARE_BID_DRAFT, no VoiceUiAction, no generic adapter. Every
// gateway-owned id (providerTurnId/proposalId/planId/audioId) is minted here; every
// emitted proposal is REGISTERED in the session store (hard per-session ceiling, no
// eviction — R2-07) so receipts must consume the exact proposal. Provider calls carry
// the session abort signal + a per-call deadline (REV-13) and pass through the
// injected BUDGET AUTHORITY (reserve → call → settle; no authority ⇒ the adapters
// were never constructed — the production provider path fails closed, R2-13).
// ─────────────────────────────────────────────────────────────────────────
import { randomBytes } from "node:crypto";
import { validateModelOperation, validateModelAnswer, renderPlanSpokenText, approvedTextHash, evidenceSupportsPlan, resolveSourceHotelId } from "./live-ai-schemas";
import { type ReasoningAdapter, MAX_REASONING_INPUT_TOKENS, MAX_REASONING_OUTPUT_TOKENS } from "./openai-responses";
import { type TtsAdapter, TTS_SAMPLE_RATE, MAX_TTS_TEXT_CHARS } from "./openai-tts";
import { type LiveAiSession, type LiveAiSessionStore, type BudgetAuthority } from "./live-ai-sessions";

export interface OrchestratorDeps {
  reasoning: ReasoningAdapter;
  tts: TtsAdapter;
  /** the session store — proposal registration/ceilings + pending-plan state. */
  store?: LiveAiSessionStore;
  /** R2-13 — the atomic budget authority; absent ⇒ provider calls are refused. */
  budget?: BudgetAuthority | null;
  now?: () => number;
  genId?: (prefix: string) => string;
  /** REV-13 — per-provider-call deadline (ms). Default 20s. */
  deadlineMs?: number;
  /** injected timers so a deadline is testable without real wall-clock. */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
}

export interface TurnInput {
  turnId: string;
  generation: number;
  transcript: string;
  language: "hi" | "hinglish" | "en";
  context: unknown;
  /** "initial" = a fresh user turn (may propose an action); "followup" = a post-
   *  verified-receipt EXPLAIN pass (answer only, evidence-bound). Default "initial". */
  phase?: "initial" | "followup";
}

const EVIDENCE_REQUIRING = new Set(["page_facts", "comparison", "advice", "action_status"]);
// R2-13/R3-13/R4-13 — CONSERVATIVE per-call cost CEILINGS reserved BEFORE a provider call,
// in each provider's native billing unit, and a HARD UPPER BOUND on the units one call can
// be charged (reserve→call→settle). Reasoning is reserved as a DOCUMENTED token mapping =
// a bounded INPUT allowance + the request's hard `max_output_tokens` ceiling, so the
// reservation is ≥ the maximum tokens the Responses request can be charged (actual =
// `usage.total_tokens`). TTS is reserved as the synthesized-character ceiling (actual =
// characters voiced, ≤ MAX_TTS_TEXT_CHARS). If a provider ever reports actual > reservation,
// settle conservatively (retain the full reservation) — never silently under-account.
export const RESERVE_REASONING_UNITS = MAX_REASONING_INPUT_TOKENS + MAX_REASONING_OUTPUT_TOKENS;
export const RESERVE_TTS_UNITS = MAX_TTS_TEXT_CHARS;

export function createLiveAiOrchestrator(deps: OrchestratorDeps) {
  const genId = deps.genId || ((prefix: string) => `${prefix}.${randomBytes(8).toString("hex")}`);
  const deadlineMs = deps.deadlineMs && deps.deadlineMs > 0 ? deps.deadlineMs : 20_000;
  const setTimer = deps.setTimer || ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer || ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>));

  /** Race a provider call against a per-call deadline; a timeout resolves to a
   *  sentinel (never rejects) so the caller can emit a bounded turn.error. */
  async function withDeadline<T>(p: Promise<T>): Promise<T | { __timedOut: true }> {
    let handle: unknown;
    const timeout = new Promise<{ __timedOut: true }>((resolve) => { handle = setTimer(() => resolve({ __timedOut: true }), deadlineMs); });
    try { return await Promise.race([p, timeout]); }
    finally { try { clearTimer(handle); } catch { /* no-op */ } }
  }

  /** R2-13 — reserve conservatively; null reservation ⇒ the call is REFUSED. A
   *  missing budget authority refuses every provider call (fail closed). */
  function reserve(session: LiveAiSession, units: number): string | null {
    if (!deps.budget) return null;
    try { return deps.budget.reserve(session.gatewaySessionId, units); } catch { return null; }
  }
  function settle(reservationId: string | null, actual: number | null, reservedUnits: number) {
    if (!deps.budget || reservationId === null) return;
    // R4-13 — the reservation is a HARD upper bound. A provider-reported actual that somehow
    // EXCEEDS it is a safety failure: retain the FULL conservative reservation (settle null),
    // never silently under-account. Absent/malformed usage already retains via null upstream.
    const safe = actual !== null && actual > reservedUnits ? null : actual;
    try { deps.budget.settle(reservationId, safe); } catch { /* conservative retention */ }
  }

  /** R3-08 — SEMANTIC evidence binding: a plan is only voiceable when its cited
   *  receipts are verified UNDER THE CURRENT AUTHORITY (an old-turn receipt cannot
   *  support a current factual plan), carry read-evidence of the RIGHT type, and every
   *  referenced hotel is on-screen in the current context. Mirrors the client rule. */
  function evidenceSatisfied(session: LiveAiSession, ans: Record<string, unknown>): boolean {
    const ctxHotels = new Set<string>();
    const posToId = new Map<number, string>();
    const lc = session.lastContext as { visibleHotels?: { id?: unknown; position?: unknown }[]; currentHotelId?: unknown } | null;
    if (lc && Array.isArray(lc.visibleHotels)) for (const h of lc.visibleHotels) {
      if (typeof h?.id === "string") { ctxHotels.add(h.id); if (typeof h.position === "number") posToId.set(h.position, h.id); }
    }
    if (lc && typeof lc.currentHotelId === "string") ctxHotels.add(lc.currentHotelId);
    return evidenceSupportsPlan(ans, {
      getReceipt: (id) => session.verifiedReceipts.get(id),
      currentAuthorityRef: session.ackAuthorityRef,
      contextHotelIds: ctxHotels,
      positionToHotelId: (p) => posToId.get(p) ?? null, // R4-08 — comparison position → on-screen hotel id
    });
  }

  async function runTurn(session: LiveAiSession, input: TurnInput): Promise<void> {
    if (session.terminated) return;
    const signal = session.abort.signal; // captured at turn start
    const alive = () => !session.terminated && !signal.aborted;
    const b = { sessionId: session.sessionId, turnId: input.turnId, generation: input.generation };
    const emit = (frame: Record<string, unknown>) => {
      if (!alive() || !session.emit) return;
      try { session.emit(frame); } catch { /* emit must never throw into the turn */ }
    };
    const phase = input.phase || "initial";

    const authorityRef = session.ackAuthorityRef;
    if (!authorityRef) { emit({ t: "turn.error", ...b, code: "stale" }); return; }
    emit({ t: "turn.state", ...b, state: "thinking" });
    if (!deps.reasoning.available) { emit({ t: "turn.error", ...b, code: "provider_unavailable" }); return; }
    // R2-13 — atomic reservation BEFORE the reasoning call; refused ⇒ budget_exceeded.
    const rres = reserve(session, RESERVE_REASONING_UNITS);
    if (rres === null) { emit({ t: "turn.error", ...b, code: "budget_exceeded" }); return; }

    let raced;
    try {
      raced = await withDeadline(deps.reasoning.reason({
        transcript: input.transcript, context: input.context,
        verifiedReceiptIds: Array.from(session.verifiedReceipts.keys()),
        signal, deadlineMs,
      }));
    } catch {
      settle(rres, null, RESERVE_REASONING_UNITS); // conservative retention on failure
      emit({ t: "turn.error", ...b, code: "provider_error" });
      return;
    }
    // R3-13 — settle the reservation EXACTLY ONCE with the ACTUAL provider usage
    // (`usage`, in tokens) when a usable result returned; retain the conservative
    // reservation (settle null) on timeout / not-usable / absent-or-malformed usage.
    const timedOut = !!(raced && (raced as { __timedOut?: true }).__timedOut);
    const rr = (!timedOut ? raced : null) as { ok?: boolean; usage?: unknown; candidate?: { proposal?: unknown; answer?: unknown } } | null;
    const reasoningActual = rr && rr.ok === true && typeof rr.usage === "number" && Number.isFinite(rr.usage) && rr.usage >= 0 ? rr.usage : null;
    settle(rres, reasoningActual, RESERVE_REASONING_UNITS);
    if (!alive()) return;
    if (timedOut) { emit({ t: "turn.error", ...b, code: "timeout" }); return; }
    const result = raced as { ok: boolean; candidate?: { proposal?: unknown; answer?: unknown } };
    if (!result || result.ok !== true) { emit({ t: "turn.error", ...b, code: "provider_error" }); return; }

    const providerTurnId = genId("pt");
    const candidate = result.candidate || {};

    // ── INITIAL phase: an action proposal DEFERS the answer until its verified
    //    receipt arrives (ACT → VERIFY → EXPLAIN). We emit ONLY the proposal now.
    if (phase === "initial" && candidate.proposal !== undefined) {
      const op = validateModelOperation(candidate.proposal);
      if (!op) { emit({ t: "turn.error", ...b, code: "invalid_output" }); return; }
      const proposalId = genId("pp");
      // R4-05 — mint the GATEWAY-OWNED execution commitment (cryptographically random,
      // bounded): gateway metadata, NEVER model/provider data. It is committed to the
      // proposal registry (with the full operation spec for R4-05B semantic binding)
      // BEFORE the action.proposal frame is emitted, so the browser binds its actionId to
      // it and every later accept/receipt must echo it EXACTLY (a copied/replayed/absent
      // nonce fails; the model can neither see nor alter it).
      const executionNonce = genId("xn");
      // R5B — mint the GATEWAY-OWNED authoritative receipt identity for THIS proposal (one proposal =
      // one immutable receipt lifecycle identity). Like the nonce it is gateway metadata, NEVER model
      // data; it is committed to the registry BEFORE the frame is emitted, delivered as trusted
      // action.proposal metadata, and the browser must ECHO it on accept + every receipt.
      const receiptId = genId("rc");
      // R5B-REV-02/03 — resolve the IMMUTABLE source hotel identity NOW, from the trusted source context
      // this turn ran under (OPEN's ordinal → the source LIST hotel id; SHOW's source DETAIL currentHotelId),
      // and freeze it on the proposal. The destination/result context can NOT re-resolve it at verification
      // time (an honest detail destination publishes visibleHotels: []), and the browser/model never supplies
      // the authoritative identity.
      const sourceResolvedHotelId = resolveSourceHotelId((op as { op: string }).op, op as Record<string, unknown>, input.context);
      // R2-05/R2-07 — REGISTER the proposal (hard ceiling; no eviction). A receipt
      // must later consume THIS exact record to count as verified.
      const registered = deps.store
        ? deps.store.registerProposal(session, { proposalId, providerTurnId, operation: (op as { op: string }).op, operationSpec: op as Record<string, unknown>, executionNonce, receiptId, turnId: input.turnId, generation: input.generation, authorityRef, sourceResolvedHotelId })
        : false;
      if (!registered) { emit({ t: "turn.error", ...b, code: "budget_exceeded" }); return; }
      emit({ t: "turn.state", ...b, state: "acting" });
      // R4-05/R5B — the executionNonce + gateway-minted receiptId ride on the FRAME as gateway
      // metadata, SEPARATE from the provider proposal (which stays exactly {proposalId, providerTurnId, operation}).
      emit({ t: "action.proposal", ...b, authorityRef, executionNonce, receiptId, proposal: { proposalId, providerTurnId, operation: op } });
      // Record the pending turn; the control socket triggers the follow-up EXPLAIN
      // pass when the browser's VERIFIED receipt for THIS providerTurnId arrives.
      session.pendingTurn = {
        turnId: input.turnId, generation: input.generation, transcript: input.transcript,
        language: input.language, providerTurnId, authorityRef,
      };
      return; // NO answer / NO TTS in the pre-action pass
    }

    // ── ANSWER path (a followup EXPLAIN pass, or an initial turn with no action):
    //    the answer is evidence-bound; an unverified fact is downgraded, never voiced.
    if (candidate.answer === undefined) { emit({ t: "turn.error", ...b, code: "invalid_output" }); return; }
    const ansValid = validateModelAnswer(candidate.answer);
    if (!ansValid) { emit({ t: "turn.error", ...b, code: "invalid_output" }); return; }

    let plan: Record<string, unknown>;
    const planId = genId("pl");
    if (evidenceSatisfied(session, ansValid)) {
      plan = { planId, providerTurnId, ...ansValid };
    } else {
      // REV-08 — the cited evidence does not resolve to a verified receipt: DOWNGRADE
      // to a bounded "insufficient evidence" plan; never voice the unverified claim.
      plan = { planId, providerTurnId, kind: "unknown", language: input.language, evidenceReceiptIds: [], reason: "insufficient_evidence" };
    }
    emit({ t: "answer.plan", ...b, authorityRef, plan });

    // R2-08 — TTS is NOT produced here. Register the plan as awaiting the BROWSER's
    // approval; the control socket invokes runTts ONLY when a matching
    // answer.approve (planId + authorityRef + textHash + turn + generation) arrives.
    if (deps.store) {
      // R3-08 — the pending plan carries the EXACT deterministic spoken text and the
      // SHA-256 of that exact UTF-8 text. The browser hashes the byte-identical text and
      // must echo this hash; runTts then voices `ttsText` unchanged (no recomposition).
      const ttsText = renderPlanSpokenText(plan);
      deps.store.setPendingPlan(session, {
        planId, providerTurnId, turnId: input.turnId, generation: input.generation, authorityRef,
        expectedTextHash: approvedTextHash(plan),
        ttsText,
        language: input.language,
      });
    }
    if (alive()) emit({ t: "turn.state", ...b, state: "idle" });
  }

  /** R2-08 — voice an APPROVED plan. The ONLY entry point into TTS; invoked by the
   *  control socket after a fully-matching answer.approve consumed the pending plan. */
  async function runTts(session: LiveAiSession, plan: { planId: string; turnId: string; generation: number; ttsText: string; language: "hi" | "hinglish" | "en"; authorityRef: string }): Promise<void> {
    if (session.terminated) return;
    const signal = session.abort.signal;
    const alive = () => !session.terminated && !signal.aborted;
    const b = { sessionId: session.sessionId, turnId: plan.turnId, generation: plan.generation };
    const emit = (frame: Record<string, unknown>) => {
      if (!alive() || !session.emit) return;
      try { session.emit(frame); } catch { /* no-op */ }
    };
    // the approved authority must STILL be current (a context/route change since
    // approval invalidates the speech).
    if (session.ackAuthorityRef !== plan.authorityRef) return;
    if (!deps.tts.available || !plan.ttsText) return;
    const rres = reserve(session, RESERVE_TTS_UNITS);
    if (rres === null) { emit({ t: "turn.error", ...b, code: "budget_exceeded" }); return; }
    let ttsRaced;
    try { ttsRaced = await withDeadline(deps.tts.synthesize({ text: plan.ttsText, language: plan.language, signal, deadlineMs })); }
    catch { ttsRaced = null; }
    // R3-13 — settle TTS with the ACTUAL synthesized usage (characters voiced) when the
    // call succeeded; retain the conservative reservation (settle null) on
    // timeout / failure / absent-or-malformed usage.
    const tRes = ttsRaced && !(ttsRaced as { __timedOut?: true }).__timedOut ? (ttsRaced as { ok?: boolean; usage?: unknown; chunks?: unknown }) : null;
    const ttsActual = tRes && tRes.ok === true && typeof tRes.usage === "number" && Number.isFinite(tRes.usage) && tRes.usage >= 0 ? tRes.usage : null;
    settle(rres, ttsActual, RESERVE_TTS_UNITS);
    if (!alive() || !ttsRaced || (ttsRaced as { __timedOut?: true }).__timedOut) return;
    // stale-authority re-check AFTER the provider call — already-generated audio for
    // a superseded turn is never emitted.
    if (session.ackAuthorityRef !== plan.authorityRef) return;
    const tts = ttsRaced as { ok: boolean; chunks: { seq: number; bytes: string }[] };
    if (!tts || tts.ok !== true || tts.chunks.length === 0) return;
    const audioId = genId("au");
    emit({ t: "audio.start", ...b, planId: plan.planId, audioId, format: { encoding: "pcm16", sampleRate: TTS_SAMPLE_RATE, channels: 1 } });
    for (const c of tts.chunks) { if (!alive() || session.ackAuthorityRef !== plan.authorityRef) return; emit({ t: "audio.chunk", ...b, audioId, seq: c.seq, bytes: c.bytes }); }
    emit({ t: "audio.end", ...b, audioId, finalSeq: tts.chunks.length });
    emit({ t: "turn.state", ...b, state: "idle" });
  }

  return { runTurn, runTts };
}

/** Deterministic, bounded TTS text from a VALIDATED plan (never model prose). */
export function renderPlanText(plan: Record<string, unknown>): string {
  const kind = plan.kind;
  let s = "";
  if (kind === "clarification") s = "I need one detail to help.";
  else if (kind === "page_facts") s = "Here are the details for the selected stays.";
  else if (kind === "comparison") s = "Comparing the selected stays.";
  else if (kind === "action_status") s = "Done.";
  else if (kind === "advice") s = "Here is what stands out in the current results.";
  else s = "I don't have that information.";
  return s.slice(0, 400);
}
