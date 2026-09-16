// ─────────────────────────────────────────────────────────────────────────
// StayBid Live AI — INTELLIGENCE-CONTRACT-01 — the PURE, BOUNDED, DORMANT
// agent-loop state machine (Customer V1).
//
// This machine is EVENT-DRIVEN and DETERMINISTIC: it performs ZERO network,
// provider, DB, Supabase, timer, or environment access. It only VALIDATES
// controller events and EMITS frozen effect directives; the controller (a
// future wiring phase — NOT this packet) performs any real model call or
// capability execution and feeds trusted observations back in. On DEFAULT
// construction every injected port is an unavailable / no-op FAIL-CLOSED
// stub, so a default-constructed loop terminates honestly (MODEL_UNAVAILABLE)
// without ever requesting anything.
//
// AUTHORITY INVARIANTS (LOCKED):
//   • MODEL = INTELLIGENCE, never AUTHORITY. The model can never mint or
//     override any controller-owned identity — the LOOP mints correlation via
//     the injected controller-owned minter and validates everything inbound.
//   • The model NEVER supplies a trusted result. Only a CONTROLLER-submitted
//     observation envelope carrying the exact accepted R5B receipt correlation
//     (validateActionReceipt), bound to the exact dispatch + source authority,
//     resolves a capability step (REV-02). The result state is DERIVED from
//     the R5B outcome/status — never a bare model/controller field.
//   • accepted / acted ≠ VERIFIED. PENDING_VERIFICATION never completes a
//     step; only a trusted VERIFIED (with typed evidence) grounds success.
//   • REV-01: a terminal RESPOND fact claim completes ONLY when its
//     `groundedInStep` names a CAPABILITY step that VERIFIED-with-evidence in
//     THIS plan. NO_OP / non-success never grounds a fact; an ungrounded fact
//     terminates UNGROUNDED_RESPONSE (nothing narrated).
//   • REV-05: ANY authoritative advancement forces a MANDATORY rebind +
//     replan before ANY further step — the terminal response included; the
//     old plan (and its evidence ledger) is discarded.
//   • REV-04: one monotonic controller-time authority; an absolute turn
//     deadline (now >= turnStart+30000); a pure expire(nowMs) primitive that
//     terminates an idle wait with no provider/capability event; and ONE
//     bounded model fallback (counted inside the 3-call budget).
//   • REV-03: MODEL_REQUEST carries the canonical bounded
//     IntelligenceInputSnapshot (16 KiB enforced — never truncated).
//   • Hard budgets are HARD; every event boundary re-checks identity/staleness.
//   • ESCALATE_TO_HUMAN is a SUGGESTION only — no side-effect authority.
// ─────────────────────────────────────────────────────────────────────────

import {
  IC01_LIMITS,
  INTELLIGENCE_CONTRACT_VERSION,
  MODEL_TIERS,
  DISABLED_MODEL_TIERS,
  MEMORY_ORIGINS,
  validateTrustedBinding,
  validateUserTurn,
  validatePlanCandidate,
  validateObservation,
  deriveResultState,
  isTerminalResultState,
  buildIntelligenceInputSnapshot,
  contextCoherentWithBinding,
} from "./live-ai-intelligence-contract";
import type {
  TrustedBinding,
  PlanCandidate,
  PlanStep,
  ObservationEnvelope,
  TerminationReason,
  ModelTier,
  ResultState,
  IntelligenceInputSnapshot,
  ConversationTurnProjection,
} from "./live-ai-intelligence-contract";
import { getCapability, capabilityAdvancesContext } from "./live-ai-capability-registry";
import { boundedText, isId, validatePublishedContext, terminalReceiptCommitment, validateActionAccepted, UNACCEPTED_ACTION_ID } from "./live-ai-schemas";
import type { ResultAuthorityShape } from "./live-ai-schemas";
// LIVE-AI-IC02 — the PURE producer-side grounded-answer compiler. The loop RETAINS one immutable
// provenance record at the exact VERIFIED-promotion transition (P1-01), and INVOKES the compiler at
// the accepted terminal producer point (P1-02). Both are read-only pure calls that grant NO new
// authority — the compiler performs zero network/DB/provider/DOM/route access.
import { buildVerifiedEvidenceRecord, compileAnswer } from "./live-ai-answer-compiler";
import type { IC02VerifiedEvidenceRecord, CompiledAnswerEnvelope } from "./live-ai-answer-compiler";

// ── injected ports (ALL fail-closed / no-op by default) ──────────────────
export interface AgentLoopDeps {
  readonly modelAvailable: () => boolean;
  readonly routeTier: (input: { pageId: string; intentHint: string | null }) => string | null;
  readonly mintId: (kind: string, seq: number) => string;
  readonly telemetry: (event: { readonly kind: string; readonly reason?: string }) => void;
}
export function createDefaultAgentLoopDeps(): AgentLoopDeps {
  return Object.freeze({
    modelAvailable: () => false,                       // DORMANT by default
    routeTier: () => null,                             // fail closed
    mintId: (kind: string, seq: number) => `ic01-${kind}-${seq}`,
    telemetry: () => { /* no-op */ },
  });
}

// ── effects (frozen directives returned to the controller) ───────────────
export type LoopEffect =
  | { readonly kind: "MODEL_REQUEST"; readonly modelRequestId: string; readonly tier: ModelTier; readonly purpose: "plan" | "repair" | "replan" | "fallback"; readonly providerCeilingMs: number; readonly maxInputBytes: number; readonly deadlineMs: number; readonly input: IntelligenceInputSnapshot }
  | { readonly kind: "CAPABILITY_DISPATCH"; readonly dispatchId: string; readonly planId: string; readonly stepIndex: number; readonly capabilityId: string; readonly args: Record<string, unknown>; readonly binding: TrustedBinding; readonly deadlineMs: number }
  | { readonly kind: "REBIND_REQUIRED"; readonly planId: string; readonly stepIndex: number; readonly deadlineMs: number }
  | { readonly kind: "TERMINAL"; readonly reason: TerminationReason; readonly terminalStep: PlanStep | null; readonly envelope?: CompiledAnswerEnvelope }
  | { readonly kind: "INERT"; readonly why: string }
  | { readonly kind: "REJECTED"; readonly why: string };

type Phase = "IDLE" | "AWAIT_MODEL" | "AWAIT_OBSERVATION" | "AWAIT_REBIND" | "TERMINAL";

interface ConversationEntry { role: "user" | "assistant"; text: string; }
interface VerifiedStep { receiptId: string; capabilityId: string; commitment: string; evidence: unknown; evidenceKind: string; }
// REV-02 (CORRECTION-01) — the exact accepted-R5B execution correlation tuple bound to a
// pending dispatch via the acknowledgement transition, BEFORE a terminal may promote.
interface ExecutionCorrelation { receiptId: string; proposalId: string; providerTurnId: string; actionId: string; executionNonce: string; }

export interface AgentLoopStatus {
  readonly phase: Phase;
  readonly contractVersion: string;
  readonly modelCalls: number;
  readonly repairCalls: number;
  readonly fallbackCalls: number;
  readonly capabilityDispatches: number;
  readonly clarificationsIssued: number;
  readonly consecutiveClarificationTurns: number;
  readonly withinTurnFailures: number;
  readonly planId: string | null;
  readonly currentStepIndex: number | null;
  readonly pendingDispatchId: string | null;
  readonly pendingModelRequestId: string | null;
  readonly terminationReason: TerminationReason | null;
  readonly conversationTurns: number;
  readonly evidenceHandles: number;
  readonly verifiedEvidenceRecords: number; // LIVE-AI-IC02 (P1-01) — count of retained provenance records this plan
  readonly deadlineMs: number | null;
  readonly lastMonotonicMs: number | null;
}

const PREF_KEYS = Object.freeze(["city", "budget", "language"] as const);

export interface AgentLoop {
  beginTurn(input: unknown): LoopEffect;
  submitModelPlan(input: unknown): LoopEffect;
  reportModelFailure(input: unknown): LoopEffect;
  acknowledgeDispatch(input: unknown): LoopEffect;
  submitObservation(input: unknown): LoopEffect;
  rebind(input: unknown): LoopEffect;
  interrupt(input: unknown): LoopEffect;
  expire(nowMs: unknown): LoopEffect;
  noteUserPreference(input: unknown): { readonly ok: boolean };
  verifiedEvidence(): readonly IC02VerifiedEvidenceRecord[]; // LIVE-AI-IC02 (P1-01) — read-only provenance snapshot
  status(): AgentLoopStatus;
}

export function createAgentLoop(overrides?: Partial<AgentLoopDeps>): AgentLoop {
  const base = createDefaultAgentLoopDeps();
  const deps: AgentLoopDeps = Object.freeze({
    modelAvailable: overrides && typeof overrides.modelAvailable === "function" ? overrides.modelAvailable : base.modelAvailable,
    routeTier: overrides && typeof overrides.routeTier === "function" ? overrides.routeTier : base.routeTier,
    mintId: overrides && typeof overrides.mintId === "function" ? overrides.mintId : base.mintId,
    telemetry: overrides && typeof overrides.telemetry === "function" ? overrides.telemetry : base.telemetry,
  });

  // ── machine state (all bounded) ────────────────────────────────────────
  let phase: Phase = "IDLE";
  let binding: TrustedBinding | null = null;
  let turnStartMs: number | null = null;
  let lastMonotonicMs: number | null = null;         // REV-04 — one monotonic time authority
  let turnUserText = "";
  let turnLanguage: "hi" | "hinglish" | "en" = "en";
  let publishedContext: Record<string, unknown> | null = null;
  let plan: PlanCandidate | null = null;
  let planId: string | null = null;
  let currentStepIndex: number | null = null;
  let pendingDispatchId: string | null = null;
  let pendingDispatchCapability: string | null = null;
  let pendingDispatchAuthorityRef: string | null = null;   // REV-02 — the source authority the dispatch ran under
  let pendingDispatchExecution: ExecutionCorrelation | null = null; // REV-02 (CORRECTION-01) — the acknowledged R5B execution tuple
  let expectedRebindAuthority: ResultAuthorityShape | null = null;  // IC01-CLOSE-05 — the post-result authority a fresh rebind MUST reflect
  let pendingModelRequestId: string | null = null;
  let modelCalls = 0;
  let repairCalls = 0;
  let fallbackCalls = 0;
  let capabilityDispatches = 0;
  let clarificationsIssued = 0;
  let consecutiveClarificationTurns = 0;
  let withinTurnFailures = 0;
  let lastResultState: ResultState | null = null;
  let terminationReason: TerminationReason | null = null;
  let seq = 0;
  const conversation: ConversationEntry[] = [];
  const evidenceRefs: string[] = [];                        // ≤ MAX_EVIDENCE_HANDLES verified receipt ids
  const verifiedSteps: Map<number, VerifiedStep> = new Map(); // REV-01 — step → its verified evidence
  // LIVE-AI-IC02 (P1-01) — the atomically-retained, IMMUTABLE VERIFIED-evidence
  // provenance records for THIS plan (one per verified step). Shares the SAME
  // per-plan lifecycle as verifiedSteps; a pure producer-side side-ledger that is
  // NEVER read by the IC01 grounding/decision path (a future consumer / 03B reads it).
  const verifiedEvidenceRecords: IC02VerifiedEvidenceRecord[] = [];
  const resolvedObservations: Map<string, string> = new Map();
  const resolvedSteps: Set<number> = new Set();
  const sessionPrefs: Map<string, string> = new Map();

  function emitTelemetry(kind: string, reason?: string): void {
    try { deps.telemetry(reason === undefined ? { kind } : { kind, reason }); } catch { /* hostile sink never breaks the machine */ }
  }
  function frozen<T extends LoopEffect>(e: T): T { return Object.freeze(e); }
  function inert(why: string): LoopEffect { return frozen({ kind: "INERT", why }); }
  function rejected(why: string): LoopEffect { return frozen({ kind: "REJECTED", why }); }
  function terminal(reason: TerminationReason, terminalStep: PlanStep | null = null, envelope?: CompiledAnswerEnvelope): LoopEffect {
    phase = "TERMINAL";
    terminationReason = reason;
    pendingDispatchId = null; pendingDispatchCapability = null; pendingDispatchAuthorityRef = null; pendingDispatchExecution = null; expectedRebindAuthority = null; pendingModelRequestId = null;
    emitTelemetry("turn_terminal", reason);
    // LIVE-AI-IC02 (P1-02) — carry the accepted CompiledAnswerEnvelope on the typed terminal producer
    // boundary when one was produced (a JSON-undefined `envelope` is dropped by serialization).
    return frozen({ kind: "TERMINAL", reason, terminalStep, envelope });
  }
  function mint(kind: string): string | null {
    try { seq += 1; const id = deps.mintId(kind, seq); return isId(id) ? id : null; } catch { return null; }
  }
  function validNow(v: unknown): v is number { return typeof v === "number" && Number.isFinite(v) && v >= 0; }
  function deadlineAbs(): number { return (turnStartMs === null ? 0 : turnStartMs) + IC01_LIMITS.TURN_DEADLINE_MS; }
  function isExpired(nowMs: number): boolean { return turnStartMs !== null && nowMs >= deadlineAbs(); } // REV-04 — >=, not >
  function remainingDeadlineMs(nowMs: number): number { const r = deadlineAbs() - nowMs; return r > 0 ? r : 0; }
  /** REV-04 — advance the monotonic clock. Returns false on a BACKWARD reading
   *  (the caller then fails closed; a backward clock never extends/revives). */
  function advanceMonotonic(nowMs: number): boolean {
    if (lastMonotonicMs !== null && nowMs < lastMonotonicMs) return false;
    lastMonotonicMs = lastMonotonicMs === null ? nowMs : Math.max(lastMonotonicMs, nowMs);
    return true;
  }
  function trimConversation(): void {
    while (conversation.length > IC01_LIMITS.MAX_CONVERSATION_TURNS) conversation.shift();
    let chars = conversation.reduce((n, e) => n + e.text.length, 0);
    while (chars > IC01_LIMITS.MAX_CONVERSATION_CHARS && conversation.length > 1) {
      const dropped = conversation.shift();
      chars -= dropped ? dropped.text.length : 0;
    }
    if (conversation.length === 1 && conversation[0].text.length > IC01_LIMITS.MAX_CONVERSATION_CHARS) conversation.length = 0;
  }
  function conversationProjection(): ConversationTurnProjection[] {
    return conversation.map((e) => ({ role: e.role, text: e.text }));
  }
  function prefsProjection(): { city?: string; budget?: string; language?: "hi" | "hinglish" | "en" } {
    const p: { city?: string; budget?: string; language?: "hi" | "hinglish" | "en" } = {};
    const c = sessionPrefs.get("city"); if (c !== undefined) p.city = c;
    const b = sessionPrefs.get("budget"); if (b !== undefined) p.budget = b;
    const l = sessionPrefs.get("language"); if (l === "hi" || l === "hinglish" || l === "en") p.language = l;
    return p;
  }
  function modelBudgetLeft(): boolean { return modelCalls < IC01_LIMITS.MAX_MODEL_CALLS_PER_TURN; }

  // REV-03 — build + validate the canonical model input for a MODEL_REQUEST.
  function buildInput(): IntelligenceInputSnapshot | null {
    if (!binding) return null;
    return buildIntelligenceInputSnapshot({
      binding,
      userText: turnUserText,
      language: turnLanguage,
      role: binding.role,
      context: publishedContext,
      selectedPositions: [],
      evidenceRefs: evidenceRefs.slice(),
      conversation: conversationProjection(),
      preferences: prefsProjection(),
      failureState: { consecutiveFailures: withinTurnFailures, lastResultState, clarificationTurns: consecutiveClarificationTurns },
    });
  }

  function requestModel(purpose: "plan" | "repair" | "replan" | "fallback", nowMs: number): LoopEffect {
    if (pendingModelRequestId !== null) return terminal("INTERNAL_ERROR");
    if (!modelBudgetLeft()) return terminal("BUDGET_EXHAUSTED");
    if (isExpired(nowMs)) return terminal("DEADLINE_EXCEEDED");
    let tier: string | null = null;
    try { tier = deps.routeTier({ pageId: binding ? binding.pageId : "", intentHint: null }); } catch { tier = null; }
    if (typeof tier !== "string" || !(MODEL_TIERS as readonly string[]).includes(tier)) return terminal("MODEL_UNAVAILABLE");
    if ((DISABLED_MODEL_TIERS as readonly string[]).includes(tier)) return terminal("MODEL_UNAVAILABLE"); // no LEVEL_3/4, no escalation
    // REV-03 — canonical input; over 16 KiB fails closed (never truncated).
    const input = buildInput();
    if (!input) return terminal("MODEL_INPUT_OVERFLOW");
    const id = mint("model");
    if (!id) return terminal("INTERNAL_ERROR");
    modelCalls += 1;
    if (purpose === "repair") repairCalls += 1;
    if (purpose === "fallback") fallbackCalls += 1;
    pendingModelRequestId = id;
    phase = "AWAIT_MODEL";
    const ceiling = Math.min(IC01_LIMITS.PROVIDER_CALL_CEILING_MS, remainingDeadlineMs(nowMs));
    emitTelemetry("model_request", purpose);
    return frozen({ kind: "MODEL_REQUEST", modelRequestId: id, tier: tier as ModelTier, purpose, providerCeilingMs: ceiling, maxInputBytes: IC01_LIMITS.MAX_MODEL_INPUT_BYTES, deadlineMs: deadlineAbs(), input });
  }

  // LIVE-AI-IC02 (P1-02) — the accepted TERMINAL PRODUCER seam. Build the IC02 compile request from ONLY
  // trusted / controller-owned state and invoke the PURE compiler. The answer identity is minted here via
  // the controller-owned minter (the model NEVER supplies it). Returns the accepted CompiledAnswerEnvelope,
  // or null when compilation is rejected — the caller then FAILS CLOSED (never legacy factual narration,
  // never a RESPOND→CLARIFY/ESCALATE transform). No browser/TTS/provider enforcement lives here (03B/03C).
  function compileTerminal(step: PlanStep): CompiledAnswerEnvelope | null {
    if (!binding || planId === null) return null;
    const answerId = mint("answer");
    if (!answerId) return null;
    const result = compileAnswer({
      contractVersion: INTELLIGENCE_CONTRACT_VERSION,
      controllerOwnedAnswerId: answerId,
      controllerOwnedPlanId: planId,
      trustedCurrentBinding: binding,
      acceptedIC01TerminalDescriptor: step,
      verifiedEvidenceRecords: verifiedEvidenceRecords.slice(),
      requestedLanguage: (step as { language?: unknown }).language,
    });
    return result.disposition === "IC02_ACCEPTED" ? result.envelope : null;
  }

  function dispatchStep(nowMs: number): LoopEffect {
    if (!plan || planId === null || currentStepIndex === null || !binding) return terminal("INTERNAL_ERROR");
    if (isExpired(nowMs)) return terminal("DEADLINE_EXCEEDED");
    const step = plan.steps[currentStepIndex];
    if (!step) return terminal("INTERNAL_ERROR");
    if (step.kind !== "CAPABILITY") {
      if (step.kind === "CLARIFY") {
        if (clarificationsIssued >= IC01_LIMITS.MAX_CLARIFICATIONS_PER_TURN) return terminal("HONEST_FAILURE");
        // LIVE-AI-IC02 (P1-02) — the visible question is produced by the compiler (COMPILED_CLARIFICATION);
        // the surfaced text is the accepted envelope's canonicalText (never a legacy renderer). A compile
        // rejection FAILS CLOSED (HONEST_FAILURE) — nothing narrated. CLARIFY stays CLARIFY.
        const env = compileTerminal(step);
        if (!env) return terminal("HONEST_FAILURE");
        clarificationsIssued += 1;
        consecutiveClarificationTurns += 1;
        conversation.push({ role: "assistant", text: env.canonicalText }); trimConversation();
        if (consecutiveClarificationTurns > IC01_LIMITS.MAX_CONSECUTIVE_CLARIFICATION_TURNS) return terminal("ESCALATION_SUGGESTED", step, env);
        return terminal("CLARIFICATION_ISSUED", step, env);
      }
      consecutiveClarificationTurns = 0;
      if (step.kind === "ESCALATE_TO_HUMAN") {
        // LIVE-AI-IC02 (P1-02) — the visible suggestion is produced by the compiler
        // (COMPILED_HUMAN_ESCALATION); the surfaced text is the accepted envelope's canonicalText. A
        // compile rejection FAILS CLOSED. ESCALATE stays ESCALATE — a SUGGESTION only, no side-effect authority.
        const env = compileTerminal(step);
        if (!env) return terminal("HONEST_FAILURE");
        conversation.push({ role: "assistant", text: env.canonicalText }); trimConversation();
        return terminal("ESCALATION_SUGGESTED", step, env);
      }
      // RESPOND — LIVE-AI-IC02 (P1-02) terminal producer seam. Preserve the accepted IC01 advice-position
      // visibility grounding (IC01-FINAL-CLOSE-01-01: a referenced position MUST OCCUR in the ACTUAL current
      // published visible set — sparse-safe, membership not 1..length — and the compiler has no published
      // context) BEFORE compiling. Then produce the answer through the compiler: fact grounding is enforced
      // by the compiler against the retained VERIFIED provenance (missing / wrong-kind provenance ⇒ reject).
      // A compile rejection FAILS CLOSED as UNGROUNDED_RESPONSE (nothing narrated); RESPOND stays RESPOND and
      // the surfaced text is the accepted envelope's canonicalText (never a legacy factual renderer).
      const visiblePositions = currentVisiblePositions();
      for (const claim of step.claims) {
        if (claim.kind === "advice") {
          for (const p of claim.positions) if (!visiblePositions.has(p)) return terminal("UNGROUNDED_RESPONSE", step);
        }
      }
      const env = compileTerminal(step);
      if (!env) return terminal("UNGROUNDED_RESPONSE", step);
      conversation.push({ role: "assistant", text: env.canonicalText }); trimConversation();
      return terminal("COMPLETED", step, env);
    }
    // CAPABILITY step — HARD gates.
    if (pendingDispatchId !== null) return terminal("INTERNAL_ERROR");
    if (capabilityDispatches >= IC01_LIMITS.MAX_CAPABILITY_STEPS) return terminal("BUDGET_EXHAUSTED");
    const desc = getCapability(step.capabilityId);
    if (!desc) return terminal("HONEST_FAILURE");
    if (desc.requiredPageId !== binding.pageId) return terminal("HONEST_FAILURE");
    if (!desc.allowedRoles.includes(binding.role)) return terminal("HONEST_FAILURE");
    const id = mint("dispatch");
    if (!id) return terminal("INTERNAL_ERROR");
    capabilityDispatches += 1;
    pendingDispatchId = id;
    pendingDispatchCapability = step.capabilityId;
    pendingDispatchAuthorityRef = binding.authorityRef;      // REV-02 — bind the source authority
    pendingDispatchExecution = null;                         // REV-02 (CORRECTION-01) — not yet acknowledged
    phase = "AWAIT_OBSERVATION";
    emitTelemetry("capability_dispatch", step.capabilityId);
    return frozen({ kind: "CAPABILITY_DISPATCH", dispatchId: id, planId, stepIndex: currentStepIndex, capabilityId: step.capabilityId, args: step.args, binding, deadlineMs: deadlineAbs() });
  }

  function authorityDiffers(ra: ResultAuthorityShape | null, b: TrustedBinding): boolean {
    if (!ra) return false;
    return ra.routeEpoch !== b.routeEpoch || ra.contextRevision !== b.contextRevision ||
      ra.contextDigest !== b.contextDigest || ra.authorityRef !== b.authorityRef || ra.generation !== b.generation;
  }

  // IC01-CLOSE-05 — does the replacement binding GENUINELY advance past the current one? An identical
  // (no-op) rebind to the current authority is refused — a stale rebind can never re-authorize the same
  // context. turnId is invariant across a rebind (same turn), so the advance is measured on the
  // authority-bearing fields.
  function bindingAdvances(next: TrustedBinding, cur: TrustedBinding): boolean {
    return next.authorityRef !== cur.authorityRef || next.routeEpoch !== cur.routeEpoch ||
      next.contextRevision !== cur.contextRevision || next.contextDigest !== cur.contextDigest || next.generation !== cur.generation;
  }
  // IC01-CLOSE-05 — the replacement binding EXACTLY corresponds to the post-result authority that
  // triggered the rebind (every authority field, same turn). A fabricated/arbitrary newer binding is
  // refused when a concrete advanced authority was produced.
  function bindingMatchesAuthority(b: TrustedBinding, ra: ResultAuthorityShape): boolean {
    return b.authorityRef === ra.authorityRef && b.generation === ra.generation && b.routeEpoch === ra.routeEpoch &&
      b.contextRevision === ra.contextRevision && b.contextDigest === ra.contextDigest && b.turnId === ra.turnId;
  }

  // IC01-FINAL-CLOSE-01-01 — the ACTUAL current visible POSITION SET from the (validated) published
  // context; an EMPTY set when there is no hotels-list context. A terminal advice position may reference
  // ONLY a position that actually OCCURS in this set — NEVER a 1..length ordinal, because the published
  // positions may be SPARSE (e.g. [1,5]: 5 is valid, 2 and 3 are not). Positions are used VERBATIM: no
  // renumber, no reorder, no index-derived ordinal. Each visibleHotels entry was already validated by the
  // ACCEPTED validatePublishedContext (position = a distinct integer 1..MAX_VISIBLE_HOTELS); the defensive
  // guard here keeps the reader total. The context is stable through a RESPOND turn (any authoritative
  // advancement forces REBIND (REV-05) before the terminal), so this never reads a stale set.
  function currentVisiblePositions(): Set<number> {
    const out = new Set<number>();
    const ctx = publishedContext;
    if (!ctx || ctx.pageId !== "hotels") return out;
    const vh = (ctx as { visibleHotels?: unknown }).visibleHotels;
    if (!Array.isArray(vh)) return out;
    for (const h of vh) {
      const pos = (h && typeof h === "object") ? (h as { position?: unknown }).position : undefined;
      if (typeof pos === "number" && Number.isInteger(pos) && pos >= 1) out.add(pos);
    }
    return out;
  }

  // ── events ─────────────────────────────────────────────────────────────
  function beginTurn(input: unknown): LoopEffect {
    try {
      if (phase !== "IDLE" && phase !== "TERMINAL") return rejected("turn_already_active");
      if (!input || typeof input !== "object") return rejected("invalid_input");
      const raw = input as Record<string, unknown>;
      if (!validNow(raw.nowMs)) return rejected("invalid_now");
      const b = validateTrustedBinding(raw.binding);
      if (!b) return rejected("invalid_binding");
      const t = validateUserTurn(raw.userTurn);
      if (!t) return rejected("invalid_user_turn");
      if (t.role !== b.role) return rejected("role_mismatch");
      if (binding && b.sessionId !== binding.sessionId) return rejected("session_mismatch");
      if (binding && b.turnId === binding.turnId) return rejected("turn_id_reused");
      // optional published context — validated with the ACCEPTED validator (reuse, never fork).
      let ctx: Record<string, unknown> | null = null;
      if (raw.context !== undefined && raw.context !== null) {
        ctx = validatePublishedContext(raw.context);
        if (!ctx) return rejected("invalid_context");
        // IC01-CLOSE-04 — a supplied context MUST be coherent with the trusted binding (page + role +
        // the accepted canonical digest); an incoherent binding/context pair is refused up front.
        if (!contextCoherentWithBinding(b, ctx)) return rejected("incoherent_context");
      }
      // reset PER-TURN state; SESSION-scope state (conversation, clarification streak, prefs) survives.
      phase = "IDLE";
      plan = null; planId = null; currentStepIndex = null;
      pendingDispatchId = null; pendingDispatchCapability = null; pendingDispatchAuthorityRef = null; pendingDispatchExecution = null; expectedRebindAuthority = null; pendingModelRequestId = null;
      modelCalls = 0; repairCalls = 0; fallbackCalls = 0; capabilityDispatches = 0;
      clarificationsIssued = 0; withinTurnFailures = 0; terminationReason = null; lastResultState = null;
      resolvedObservations.clear(); resolvedSteps.clear(); verifiedSteps.clear(); evidenceRefs.length = 0;
      verifiedEvidenceRecords.length = 0; // LIVE-AI-IC02 (P1-01) — per-turn reset (mirrors verifiedSteps)
      binding = b;
      publishedContext = ctx;
      turnUserText = t.text;
      turnLanguage = t.language;
      turnStartMs = raw.nowMs as number;
      lastMonotonicMs = raw.nowMs as number;                 // REV-04 — anchor the monotonic clock
      conversation.push({ role: "user", text: t.text }); trimConversation();
      let available = false;
      try { available = deps.modelAvailable() === true; } catch { available = false; }
      if (!available) return terminal("MODEL_UNAVAILABLE"); // DORMANT default path — zero requests
      return requestModel("plan", raw.nowMs as number);
    } catch { return terminal("INTERNAL_ERROR"); }
  }

  function submitModelPlan(input: unknown): LoopEffect {
    try {
      if (phase === "TERMINAL") return inert("terminal");
      if (phase !== "AWAIT_MODEL") return rejected("no_pending_model_call");
      if (!input || typeof input !== "object") return rejected("invalid_input");
      const raw = input as Record<string, unknown>;
      if (!validNow(raw.nowMs)) return rejected("invalid_now");
      if (raw.modelRequestId !== pendingModelRequestId) return inert("stale_model_response");
      if (!advanceMonotonic(raw.nowMs as number)) return terminal("NON_MONOTONIC_TIME");
      pendingModelRequestId = null;
      if (isExpired(raw.nowMs as number)) return terminal("DEADLINE_EXCEEDED");
      const candidate = validatePlanCandidate(raw.plan);
      if (!candidate) {
        if (repairCalls < IC01_LIMITS.MAX_MODEL_REPAIR_CALLS && modelBudgetLeft()) return requestModel("repair", raw.nowMs as number);
        return terminal("MODEL_MALFORMED");
      }
      if (!binding) return terminal("INTERNAL_ERROR");
      for (const step of candidate.steps) {
        if (step.kind !== "CAPABILITY") continue;
        const desc = getCapability(step.capabilityId);
        if (!desc || desc.requiredPageId !== binding.pageId || !desc.allowedRoles.includes(binding.role)) {
          if (repairCalls < IC01_LIMITS.MAX_MODEL_REPAIR_CALLS && modelBudgetLeft()) return requestModel("repair", raw.nowMs as number);
          return terminal("MODEL_MALFORMED");
        }
      }
      const id = mint("plan");
      if (!id) return terminal("INTERNAL_ERROR");
      plan = candidate;
      planId = id;
      currentStepIndex = 0;
      resolvedSteps.clear();
      verifiedSteps.clear();                 // a fresh plan grounds only its OWN verified steps
      verifiedEvidenceRecords.length = 0;    // LIVE-AI-IC02 (P1-01) — a fresh plan retains only its OWN provenance
      return dispatchStep(raw.nowMs as number);
    } catch { return terminal("INTERNAL_ERROR"); }
  }

  function reportModelFailure(input: unknown): LoopEffect {
    try {
      if (phase === "TERMINAL") return inert("terminal");
      if (phase !== "AWAIT_MODEL") return rejected("no_pending_model_call");
      if (!input || typeof input !== "object") return rejected("invalid_input");
      const raw = input as Record<string, unknown>;
      if (!validNow(raw.nowMs)) return rejected("invalid_now");
      if (raw.modelRequestId !== pendingModelRequestId) return inert("stale_model_response");
      if (!advanceMonotonic(raw.nowMs as number)) return terminal("NON_MONOTONIC_TIME");
      pendingModelRequestId = null;
      // REV-04 — the absolute deadline governs: a failure at/after the deadline
      // terminates DEADLINE_EXCEEDED (the fallback obeys the same deadline).
      if (isExpired(raw.nowMs as number)) return terminal("DEADLINE_EXCEEDED");
      // REV-04 — the architecture's ONE bounded fallback transition: at most one
      // fallback attempt, counted inside the model-call budget, obeying the same
      // absolute deadline, no tier escalation, no parallel fanout.
      if (fallbackCalls < IC01_LIMITS.MAX_MODEL_FALLBACK_CALLS && modelBudgetLeft() && !isExpired(raw.nowMs as number)) {
        return requestModel("fallback", raw.nowMs as number);
      }
      if (raw.cause === "timeout") return terminal("MODEL_TIMEOUT");
      return terminal("MODEL_UNAVAILABLE");
    } catch { return terminal("INTERNAL_ERROR"); }
  }

  function submitObservation(input: unknown): LoopEffect {
    try {
      if (phase === "TERMINAL") return inert("terminal");
      if (!input || typeof input !== "object") return rejected("invalid_input");
      const raw = input as Record<string, unknown>;
      if (!validNow(raw.nowMs)) return rejected("invalid_now");
      const obs: ObservationEnvelope | null = validateObservation(raw.observation);
      if (!obs) return rejected("invalid_observation");
      // duplicate / conflicting replay FIRST (even with no pending dispatch).
      const fingerprint = JSON.stringify(obs);
      const prior = resolvedObservations.get(obs.observationId);
      if (prior !== undefined) {
        if (prior === fingerprint) return inert("duplicate_observation");
        return terminal("CONFLICTING_OBSERVATION");
      }
      if (phase !== "AWAIT_OBSERVATION" || pendingDispatchId === null || !binding || planId === null || currentStepIndex === null) return inert("no_pending_dispatch");
      // OWNERSHIP + the event-boundary staleness recheck.
      if (obs.dispatchId !== pendingDispatchId) return inert("foreign_dispatch");
      if (obs.sessionId !== binding.sessionId) return inert("foreign_session");
      if (obs.turnId !== binding.turnId) return inert("stale_turn");
      if (obs.generation !== binding.generation) return inert("stale_generation");
      if (obs.planId !== planId) return inert("stale_plan");
      if (obs.stepIndex !== currentStepIndex) return inert("stale_step");
      if (obs.capabilityId !== pendingDispatchCapability) return inert("capability_mismatch");
      // REV-02 — the receipt + source authority MUST belong to THIS exact dispatch.
      if (obs.receipt.authorityRef !== pendingDispatchAuthorityRef) return inert("authority_mismatch");
      const sa = obs.sourceAuthority;
      if (sa.authorityRef !== pendingDispatchAuthorityRef || sa.turnId !== binding.turnId || sa.generation !== binding.generation ||
          sa.routeEpoch !== binding.routeEpoch || sa.contextRevision !== binding.contextRevision || sa.contextDigest !== binding.contextDigest) {
        return inert("source_authority_mismatch");
      }
      if (resolvedSteps.has(obs.stepIndex)) return inert("late_result");
      if (!advanceMonotonic(raw.nowMs as number)) return terminal("NON_MONOTONIC_TIME");
      if (isExpired(raw.nowMs as number)) return terminal("DEADLINE_EXCEEDED");
      // REV-02 — DERIVE the result state from the validated R5B outcome/status.
      const state = deriveResultState(obs.receipt);
      lastResultState = state;
      // SECURITY-CRITICAL: accepted/acted ≠ VERIFIED — never completes a step.
      if (!isTerminalResultState(state)) { emitTelemetry("observation_pending", obs.capabilityId); return inert("pending_verification_acknowledged"); }
      // IC01-CLOSE-02/03 — the gateway terminal-ACK commitment MUST prove the R5B gateway accepted THIS
      // terminal's lifecycle (a fabricated-but-schema-valid receipt has no matching commitment), AND the
      // acceptance lifecycle (pre-accept vs post-accept) must be coherent. The commitment is compared,
      // never substituted by a locally recomputed acceptance — the loop recomputes terminalReceiptCommitment
      // over the held receipt in the CORRECT form and requires it to equal the gateway's ackCommitment.
      const r = obs.receipt as Record<string, unknown>;
      const ex = pendingDispatchExecution;
      if (ex) {
        // POST-ACCEPT — IC01 acknowledged the dispatch (action.accepted bound the execution tuple). EVERY
        // terminal (VERIFIED / REJECTED / STALE / NO_OP / UNKNOWN / FAILED / INTERRUPTED) MUST carry the
        // EXACT accepted execution tuple, and the gateway ACK commitment MUST equal the commitment over the
        // REAL (accepted-actionId) receipt. A swapped/foreign receipt fails the tuple; a
        // fabricated/gateway-unaccepted receipt fails the commitment.
        if (r.receiptId !== ex.receiptId || r.proposalId !== ex.proposalId || r.providerTurnId !== ex.providerTurnId || r.actionId !== ex.actionId || r.executionNonce !== ex.executionNonce) return inert("execution_correlation_mismatch");
        if (obs.ackCommitment !== terminalReceiptCommitment(obs.receipt)) return inert("ack_commitment_mismatch");
      } else {
        // PRE-ACCEPT — IC01 never acknowledged the dispatch (no action.accepted). The R5B gateway can still
        // terminalize a browser refusal BEFORE acceptance (R5B-REV-08), but ONLY as a NEGATIVE terminal — a
        // VERIFIED (or any success) before acceptance is impossible (nothing was executed). The gateway's
        // ACK commitment folds the never-bound actionId to the UNACCEPTED sentinel; IC01 requires the ACK
        // commitment to equal the commitment over that exact pre-accept audit form, correlating proposal /
        // receipt / providerTurn / nonce / source WITHOUT inventing an accepted execution tuple.
        if (state === "VERIFIED") return inert("verified_before_accept");
        const preAuditReceipt = { ...r, actionId: UNACCEPTED_ACTION_ID };
        if (obs.ackCommitment !== terminalReceiptCommitment(preAuditReceipt)) return inert("ack_commitment_mismatch");
      }
      // terminal — resolve the step.
      resolvedObservations.set(obs.observationId, fingerprint);
      resolvedSteps.add(obs.stepIndex);
      pendingDispatchId = null; pendingDispatchCapability = null; pendingDispatchAuthorityRef = null; pendingDispatchExecution = null;
      emitTelemetry("observation_terminal", state);
      if (state === "INTERRUPTED") return terminal("INTERRUPTED");

      if (state === "VERIFIED") {
        // LIVE-AI-IC02 (P1-01) — a SINGLE synchronous accepted VERIFIED promotion transition. EVERY
        // accepted lifecycle precondition is evaluated FIRST; the COMPLETE immutable IC02 provenance record
        // is PRE-BUILT before ANY evidence promotion; and the IC01 verified-step / evidence reference AND
        // the IC02 record are committed TOGETHER only after all preconditions pass. If the required IC02
        // provenance cannot be constructed/admitted, we FAIL CLOSED here — an IC01-only successful evidence
        // promotion must never occur while the IC02-required provenance is absent. Provenance is captured
        // from the ALREADY-VALIDATED trusted values and is NEVER reconstructed from mutable state later.
        const receiptId = obs.receipt.receiptId as string;
        const evidence = (obs.receipt as Record<string, unknown>).evidence;
        const evidenceKind = evidence && typeof evidence === "object" && typeof (evidence as { kind?: unknown }).kind === "string" ? (evidence as { kind: string }).kind : "";
        const commitment = terminalReceiptCommitment(obs.receipt);
        // REV-05 — ANY authoritative advancement invalidates ALL remaining old steps.
        const raDiffers = authorityDiffers(obs.resultAuthority, binding);
        // IC01-CLOSE-05 RESIDUAL B — an advancing VERIFIED (APPLY/OPEN/SHOW ⇒ capabilityAdvancesContext=true)
        // whose result authority did NOT advance is an inconsistent result/lifecycle → FAIL CLOSED *before*
        // any evidence promotion (nothing enters the IC01/IC02 ledgers for this inconsistent step).
        const advancingCapUnmoved = capabilityAdvancesContext(obs.capabilityId) && !raDiffers;
        if (advancingCapUnmoved) return terminal("HONEST_FAILURE");
        // PRE-BUILD + validate the COMPLETE IC02 provenance record (deep-copied + deeply frozen). The
        // builder requires a valid non-null result authority + admissible evidence for the capability;
        // a record that cannot be admitted means this VERIFIED promotion cannot complete → FAIL CLOSED.
        const ic02Record = buildVerifiedEvidenceRecord({
          verifiedStepIndex: obs.stepIndex,
          receiptId,
          capabilityId: obs.capabilityId,
          evidenceKind,
          evidence,
          receiptCommitment: commitment,
          sourceAuthority: obs.sourceAuthority,
          resultAuthority: obs.resultAuthority,
          binding,
        });
        if (!ic02Record) return terminal("HONEST_FAILURE"); // no IC01-only success while IC02 provenance is absent
        // ATOMIC accepted promotion — commit the IC01 verified-step + evidence reference AND the IC02
        // provenance record together, now that every precondition has passed.
        verifiedSteps.set(obs.stepIndex, { receiptId, capabilityId: obs.capabilityId, commitment, evidence, evidenceKind });
        if (evidenceRefs.length < IC01_LIMITS.MAX_EVIDENCE_HANDLES && !evidenceRefs.includes(receiptId)) evidenceRefs.push(receiptId);
        if (verifiedEvidenceRecords.length < IC01_LIMITS.MAX_EVIDENCE_HANDLES && !verifiedEvidenceRecords.some((r) => r.verifiedStepIndex === obs.stepIndex)) verifiedEvidenceRecords.push(ic02Record);
        // A genuine authority advance forces the trusted rebind gate, bound to the EXACT fresh result
        // authority — never a null target. A non-advancing verified step continues (REV-05 preserved).
        if (raDiffers) { expectedRebindAuthority = obs.resultAuthority; phase = "AWAIT_REBIND"; return frozen({ kind: "REBIND_REQUIRED", planId, stepIndex: obs.stepIndex, deadlineMs: deadlineAbs() }); }
        currentStepIndex = obs.stepIndex + 1;
        if (!plan || currentStepIndex >= plan.steps.length) return terminal("INTERNAL_ERROR");
        return dispatchStep(raw.nowMs as number);
      }

      if (state === "NO_OP") {
        // truthful "nothing changed": no evidence recorded (can never ground a fact).
        const advanced = authorityDiffers(obs.resultAuthority, binding);
        // IC01-CLOSE-05 — an ADVANCED result authority forces the trusted rebind gate (bind the fresh
        // authority) before any further work; the old authority never continues under it.
        if (advanced) { expectedRebindAuthority = obs.resultAuthority; phase = "AWAIT_REBIND"; return frozen({ kind: "REBIND_REQUIRED", planId, stepIndex: obs.stepIndex, deadlineMs: deadlineAbs() }); }
        currentStepIndex = obs.stepIndex + 1;
        if (!plan || currentStepIndex >= plan.steps.length) return terminal("INTERNAL_ERROR");
        return dispatchStep(raw.nowMs as number);
      }

      if (state === "STALE") {
        withinTurnFailures += 1;
        if (withinTurnFailures > IC01_LIMITS.MAX_CONSECUTIVE_FAILURES) return terminal("CONSECUTIVE_FAILURES");
        // IC01-CLOSE-05 — pin the advanced authority when the stale result carries one; otherwise the
        // rebind still requires a genuinely advancing, coherently-validated fresh binding.
        expectedRebindAuthority = authorityDiffers(obs.resultAuthority, binding) ? obs.resultAuthority : null;
        phase = "AWAIT_REBIND";
        return frozen({ kind: "REBIND_REQUIRED", planId, stepIndex: obs.stepIndex, deadlineMs: deadlineAbs() });
      }

      // REJECTED / UNKNOWN / FAILED — truthful non-success. NO automatic capability
      // retry (budget 0); the only path forward is a fresh replan, else honest failure.
      withinTurnFailures += 1;
      if (withinTurnFailures > IC01_LIMITS.MAX_CONSECUTIVE_FAILURES) return terminal("CONSECUTIVE_FAILURES");
      // IC01-CLOSE-05 — a negative terminal that carries an ADVANCED result authority (e.g. a
      // stale_entity rejection observed under a moved context) must NOT replan under the OLD
      // binding/context: it goes through the trusted rebind gate (fresh correlated authority + coherent
      // fresh context) first, exactly like a positive advancement.
      if (authorityDiffers(obs.resultAuthority, binding)) {
        expectedRebindAuthority = obs.resultAuthority;
        phase = "AWAIT_REBIND";
        return frozen({ kind: "REBIND_REQUIRED", planId, stepIndex: obs.stepIndex, deadlineMs: deadlineAbs() });
      }
      if (modelBudgetLeft()) return requestModel("replan", raw.nowMs as number);
      return terminal("HONEST_FAILURE");
    } catch { return terminal("INTERNAL_ERROR"); }
  }

  // REV-02 (CORRECTION-01) — a PURE trusted controller acknowledgement transition. The
  // accepted-R5B lifecycle mints the execution correlation (proposalId / providerTurnId /
  // actionId / executionNonce + the echoed receiptId) at the action.accepted stage — AFTER
  // dispatch, BEFORE the terminal receipt. The controller binds the pending IC01 dispatch
  // to that EXACT accepted-R5B execution tuple here (validated by the accepted
  // validateActionAccepted — no fabricated ids). A later VERIFIED terminal can promote ONLY
  // if its receipt's execution ids equal this bound tuple.
  function acknowledgeDispatch(input: unknown): LoopEffect {
    try {
      if (phase === "TERMINAL") return inert("terminal");
      if (phase !== "AWAIT_OBSERVATION" || pendingDispatchId === null || !binding) return rejected("no_pending_dispatch");
      if (!input || typeof input !== "object") return rejected("invalid_input");
      const raw = input as Record<string, unknown>;
      if (!validNow(raw.nowMs)) return rejected("invalid_now");
      if (!advanceMonotonic(raw.nowMs as number)) return terminal("NON_MONOTONIC_TIME");
      if (isExpired(raw.nowMs as number)) return terminal("DEADLINE_EXCEEDED");
      if (raw.dispatchId !== pendingDispatchId) return inert("foreign_dispatch");
      const accepted = validateActionAccepted(raw.accepted);
      if (!accepted) return rejected("invalid_acknowledgement");
      if (accepted.operation !== pendingDispatchCapability) return inert("capability_mismatch");
      if (accepted.authorityRef !== pendingDispatchAuthorityRef) return inert("authority_mismatch");
      const tuple: ExecutionCorrelation = {
        receiptId: accepted.receiptId as string, proposalId: accepted.proposalId as string,
        providerTurnId: accepted.providerTurnId as string, actionId: accepted.actionId as string,
        executionNonce: accepted.executionNonce as string,
      };
      if (pendingDispatchExecution) {
        const ex = pendingDispatchExecution;
        const same = ex.receiptId === tuple.receiptId && ex.proposalId === tuple.proposalId && ex.providerTurnId === tuple.providerTurnId && ex.actionId === tuple.actionId && ex.executionNonce === tuple.executionNonce;
        if (same) return inert("already_acknowledged");
        return terminal("CONFLICTING_OBSERVATION"); // a second, DIFFERENT execution binding for one dispatch
      }
      pendingDispatchExecution = tuple;
      emitTelemetry("dispatch_acknowledged", pendingDispatchCapability || undefined);
      return inert("dispatch_acknowledged");
    } catch { return terminal("INTERNAL_ERROR"); }
  }

  function rebind(input: unknown): LoopEffect {
    try {
      if (phase === "TERMINAL") return inert("terminal");
      if (phase !== "AWAIT_REBIND") return rejected("rebind_not_required");
      if (!input || typeof input !== "object") return rejected("invalid_input");
      const raw = input as Record<string, unknown>;
      if (!validNow(raw.nowMs)) return rejected("invalid_now");
      const b = validateTrustedBinding(raw.binding);
      if (!b) return rejected("invalid_binding");
      if (!binding) return terminal("INTERNAL_ERROR");
      if (b.sessionId !== binding.sessionId) return rejected("session_mismatch");
      if (b.turnId !== binding.turnId) return rejected("turn_mismatch");
      if (b.generation < binding.generation) return rejected("generation_regression");
      // IC01-CLOSE-05 — the replacement MUST genuinely ADVANCE: a rebind to the EXACT old (unchanged)
      // binding is refused (a stale rebind can never re-authorize the same context).
      if (!bindingAdvances(b, binding)) return rejected("rebind_no_advance");
      // IC01-CLOSE-05 — when the advancement produced a concrete post-result authority, the replacement
      // MUST correspond to it EXACTLY — a fabricated/arbitrary newer binding is refused.
      if (expectedRebindAuthority !== null && !bindingMatchesAuthority(b, expectedRebindAuthority)) return rejected("rebind_authority_mismatch");
      // IC01-CLOSE-05 RESIDUAL A — a rebind must NOT re-authorize on the OLD context by omission. When the
      // turn HAD a published context (publishedContext !== null) a successful rebind REQUIRES an explicit
      // fresh validated context: an omitted/null context can never re-authorize by coincidentally matching
      // the moved binding (the old published context is never silently retained across an advancement). Only
      // a turn that legitimately had NO published context (publishedContext === null) may rebind with no
      // context — that legitimate null-context turn is preserved.
      let ctx: Record<string, unknown> | null;
      if (raw.context !== undefined && raw.context !== null) {
        ctx = validatePublishedContext(raw.context);
        if (!ctx) return rejected("invalid_context");
      } else {
        if (publishedContext !== null) return rejected("fresh_context_required");
        ctx = null;
      }
      // IC01-CLOSE-05 — the (explicit fresh) replacement context MUST be coherent with the NEW binding
      // (page + role + the accepted canonical digest). "new authority + mismatched context" can never
      // validate. On success publishedContext is replaced by this explicit fresh context (below).
      if (!contextCoherentWithBinding(b, ctx)) return rejected("stale_or_incoherent_context");
      if (!advanceMonotonic(raw.nowMs as number)) return terminal("NON_MONOTONIC_TIME");
      binding = b;
      publishedContext = ctx;
      expectedRebindAuthority = null;   // consumed by this rebind
      if (isExpired(raw.nowMs as number)) return terminal("DEADLINE_EXCEEDED");
      // REV-05 — the OLD plan (incl. its terminal) and its evidence ledger are STALE.
      plan = null; planId = null; currentStepIndex = null;
      resolvedSteps.clear(); verifiedSteps.clear(); evidenceRefs.length = 0;
      verifiedEvidenceRecords.length = 0;   // LIVE-AI-IC02 (P1-01) — REV-05: an advancement discards the old provenance too
      if (!modelBudgetLeft()) return terminal("BUDGET_EXHAUSTED");
      return requestModel("replan", raw.nowMs as number);
    } catch { return terminal("INTERNAL_ERROR"); }
  }

  function interrupt(input: unknown): LoopEffect {
    try {
      if (phase === "TERMINAL") return inert("terminal");
      if (phase === "IDLE") return rejected("no_active_turn");
      if (!input || typeof input !== "object") return rejected("invalid_input");
      const raw = input as Record<string, unknown>;
      if (!validNow(raw.nowMs)) return rejected("invalid_now");
      if (raw.reason !== "barge_in" && raw.reason !== "route_change" && raw.reason !== "context_change" && raw.reason !== "user_cancel") return rejected("invalid_reason");
      return terminal("INTERRUPTED");
    } catch { return terminal("INTERNAL_ERROR"); }
  }

  // REV-04 — a pure deterministic expiry primitive: the future host can expire an
  // idle AWAIT_MODEL / AWAIT_OBSERVATION / AWAIT_REBIND with NO provider/capability
  // event. A backward clock fails closed; only now >= the absolute deadline expires.
  function expire(nowMs: unknown): LoopEffect {
    try {
      if (phase === "TERMINAL") return inert("terminal");
      if (phase === "IDLE") return rejected("no_active_turn");
      if (!validNow(nowMs)) return rejected("invalid_now");
      if (!advanceMonotonic(nowMs as number)) return terminal("NON_MONOTONIC_TIME");
      if (isExpired(nowMs as number)) return terminal("DEADLINE_EXCEEDED");
      return inert("deadline_not_reached");
    } catch { return terminal("INTERNAL_ERROR"); }
  }

  function noteUserPreference(input: unknown): { readonly ok: boolean } {
    try {
      if (!input || typeof input !== "object") return Object.freeze({ ok: false });
      const raw = input as Record<string, unknown>;
      if (typeof raw.origin !== "string" || !(MEMORY_ORIGINS as readonly string[]).includes(raw.origin)) return Object.freeze({ ok: false });
      if (raw.origin !== "USER_STATED") return Object.freeze({ ok: false });
      if (typeof raw.key !== "string" || !(PREF_KEYS as readonly string[]).includes(raw.key)) return Object.freeze({ ok: false });
      const value = boundedText(raw.value, IC01_LIMITS.MAX_PREF_VALUE_BYTES);
      if (value === null) return Object.freeze({ ok: false });
      if (raw.key === "language" && value !== "hi" && value !== "hinglish" && value !== "en") return Object.freeze({ ok: false });
      sessionPrefs.set(raw.key, value);
      return Object.freeze({ ok: true });
    } catch { return Object.freeze({ ok: false }); }
  }

  // LIVE-AI-IC02 (P1-01) — a FROZEN snapshot of the retained per-plan provenance
  // records. Each record is already deeply immutable; the array copy prevents any
  // external mutation of the machine's internal ledger. A pure producer-side read
  // for a future consumer / LIVE-AI-03B; it is NEVER consulted by the IC01 path.
  function verifiedEvidence(): readonly IC02VerifiedEvidenceRecord[] {
    return Object.freeze(verifiedEvidenceRecords.slice());
  }

  function status(): AgentLoopStatus {
    return Object.freeze({
      phase, contractVersion: INTELLIGENCE_CONTRACT_VERSION,
      modelCalls, repairCalls, fallbackCalls, capabilityDispatches,
      clarificationsIssued, consecutiveClarificationTurns, withinTurnFailures,
      planId, currentStepIndex, pendingDispatchId, pendingModelRequestId, terminationReason,
      conversationTurns: conversation.length, evidenceHandles: evidenceRefs.length,
      verifiedEvidenceRecords: verifiedEvidenceRecords.length,
      deadlineMs: turnStartMs === null ? null : deadlineAbs(), lastMonotonicMs,
    });
  }

  return Object.freeze({
    beginTurn, submitModelPlan, reportModelFailure, acknowledgeDispatch, submitObservation,
    rebind, interrupt, expire, noteUserPreference, verifiedEvidence, status,
  });
}
