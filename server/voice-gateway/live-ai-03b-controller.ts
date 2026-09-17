// ─────────────────────────────────────────────────────────────────────────
// StayBid Live AI — LIVE-AI-03B — provider-conformance + staging-text CONTROLLER.
//
// The controller drives the FROZEN agent-loop's IC01 effects for a TEXT turn, performs the
// real provider call on MODEL_REQUEST (under the MANDATORY budget-before-call ordering §8),
// routes CAPABILITY_DISPATCH through the released 03A execution admission (NEVER authorizing
// the browser action itself), and on a TERMINAL turn emits ONLY the compiled-answer frame
// (answer.compiled) carrying the loop's IC02 CompiledAnswerEnvelope. It is fail-closed:
// no budget / refused budget / unavailable budget / reservation-persistence failure / kill
// / deadline ⇒ ZERO provider invocations, and a provider success NEVER directly completes a
// turn — a valid candidate reaches ONLY submitModelPlan; IC01 remains authoritative.
//
// PROVIDER-REPLACEABLE: the provider is an injected seam (ProviderCallAdmissionV1 /
// ProviderOutcomeV1). DORMANT by default (no api key / no store ⇒ no real call).
// No voice / STT / TTS / audio is ever touched here. MODEL != AUTHORITY.
// ─────────────────────────────────────────────────────────────────────────

import type { AgentLoop, LoopEffect } from "./live-ai-agent-loop";
import type { BudgetCore, ReasoningUsageV1 } from "./live-ai-budget-authority";
import type { ExecutionSafety, AdmitOutcome, AcceptOutcome, TerminalOutcome, ExecutionAdmission, Ic01LoopPort } from "./live-ai-execution-safety";
import { validateActionReceipt, terminalReceiptCommitment } from "./live-ai-schemas";

/** P1-01 — the EXACT budget surface the controller uses (the §8 ordered provider-spend
 *  facility). The full DPBEL `BudgetCore` and the gateway's `LiveAiBudgetCoreSeam` (extended
 *  with the reasoning03b trio) both satisfy this narrower port, so the controller can be wired
 *  from the gateway bootstrap without widening its dependency to the whole budget core. */
export interface Budget03bPort {
  quoteReasoning03bWorstCaseMicros(): bigint | null;
  prepareProviderLease(req: {
    gatewaySessionId: string; subjectDigest: string; projectId: string; acquisitionKey: string;
    maxControlStalenessMs: number; leaseTtlMs: number;
    amounts: { moneyMicros: bigint; providerCalls: bigint; executionAdmissions: bigint };
  }): Promise<{ ok: boolean; reason?: string }>;
  reserveReasoning03b(gatewaySessionId: string, providerTurnId: string): string | null;
  persistProviderReservation(gatewaySessionId: string, providerTurnId: string): Promise<boolean>;
  settleUsage(gatewaySessionId: string, providerTurnId: string, usage: ReasoningUsageV1 | null): void;
  persistProviderSettlement(gatewaySessionId: string, providerTurnId: string): Promise<boolean>;
  reconcileSession(gatewaySessionId: string, opts?: { crash?: boolean }): Promise<void>;
  revokeSessionDurable(gatewaySessionId: string, reason: string): Promise<void>;
}
/** The full DPBEL core is assignable to the narrower port (compile-time proof). */
export type _Budget03bPortSatisfiedByCore = BudgetCore extends Budget03bPort ? true : never;
import type { TrustedBinding } from "./live-ai-intelligence-contract";
import { IC01_LIMITS } from "./live-ai-intelligence-contract";
import {
  buildProviderCallAdmissionV1, runReasoning03bProviderCall,
  type ProviderCallAdmissionV1, type ProviderOutcomeV1, type ProviderUsageV1, type Responses03bFetchLike,
} from "./openai-responses";

export const LIVE_AI_03B_CONTROLLER_VERSION = "staybid-03b-controller.v1" as const;

/** P1-06 (ROOT CAUSE) — a bounded, single-turn 03B-owned loop bridge/PROXY around the SAME real IC01
 *  AgentLoop. It is the `Ic01LoopPort` handed to `createExecutionSafety`, so when the RELEASED 03A
 *  performs its IC01 hand-off INTERNALLY (acknowledgeDispatch on acceptAction, submitObservation on
 *  deliverTerminal), the call is delegated to the real loop AND the EXACT returned LoopEffect is
 *  captured in a single slot. The controller then consumes that captured effect to continue the SAME
 *  retained turn — it NEVER calls loop.acknowledgeDispatch/submitObservation itself. The capture slot
 *  is single-consumption (cleared on take) and bounded (one at a time); a consumer that expects an
 *  effect but finds none, or one whose kind disagrees with 03A's reported loopEffectKind, fails closed. */
export interface LoopEffectCapture {
  readonly port: Ic01LoopPort;
  /** consume + clear the last captured effect (null if 03A took an early path that never touched the loop). */
  take(): LoopEffect | null;
  /** discard any uncaptured effect (turn teardown / superseded). */
  clear(): void;
}
export function createLoopEffectCaptureProxy(realLoop: AgentLoop): LoopEffectCapture {
  let captured: LoopEffect | null = null;
  const port: Ic01LoopPort = {
    // AgentLoopStatus carries every field Ic01LoopPort.status reads (phase/planId/currentStepIndex/
    // pendingDispatchId) but no index signature — cast to the port's structural return (read-only pass-through).
    status: () => realLoop.status() as unknown as ReturnType<Ic01LoopPort["status"]>,
    acknowledgeDispatch: (input: unknown) => { const eff = realLoop.acknowledgeDispatch(input); captured = eff; return eff; },
    submitObservation: (input: unknown) => { const eff = realLoop.submitObservation(input); captured = eff; return eff; },
  };
  return {
    port,
    take(): LoopEffect | null { const e = captured; captured = null; return e; },
    clear(): void { captured = null; },
  };
}

/** The compiled-answer frame the controller emits (structurally the protocol answer.compiled). */
export interface CompiledAnswerFrameOut {
  readonly t: "answer.compiled";
  readonly sessionId: string;
  readonly turnId: string;
  readonly generation: number;
  readonly authorityRef: string;
  readonly envelope: unknown; // the loop's CompiledAnswerEnvelope (validated on the client)
}

export type TurnOutcomeState =
  | "TERMINAL_COMPILED"       // a compiled answer was emitted
  | "TERMINAL_FAILURE"        // terminal without an accepted envelope → closed non-factual failure
  | "AWAITING_CAPABILITY"     // a capability was admitted via 03A; awaiting the browser round-trip
  | "REBIND_REQUIRED"
  | "INERT"
  | "REJECTED"
  | "PROVIDER_UNAVAILABLE"
  | "BUDGET_UNAVAILABLE"
  | "KILLED"
  | "DEADLINE_EXCEEDED"
  | "STAGING_DISABLED"
  | "ERROR";

export interface TurnOutcome {
  readonly state: TurnOutcomeState;
  readonly reason?: string;
  readonly compiledEmitted: boolean;
  readonly providerCalls: number;   // real provider invocations performed this turn
}

export interface TextTurnRequest {
  readonly gatewaySessionId: string;
  readonly subjectDigest: string;
  readonly projectId: string;
  readonly binding: TrustedBinding;
  readonly userText: string;
  readonly language: "hi" | "hinglish" | "en";
  readonly role: "anonymous" | "customer";
  readonly context?: unknown;
}

export interface Controller03bDeps {
  readonly loop: AgentLoop;                 // a FRESH agent loop for this turn
  readonly budgetCore: Budget03bPort;       // the §8 provider-spend facility (dormant ⇒ fail closed)
  readonly execution: ExecutionSafety | null; // legacy 03A admission seam (used ONLY when makeExecution is absent)
  /** P1-06 (ROOT CAUSE) — the RELEASED-03A factory. The controller builds a same-loop capture proxy
   *  around `loop` and calls this to obtain an `ExecutionSafety` BOUND to that proxy via
   *  `createExecutionSafety`, so 03A owns admit()→acceptAction()→deliverTerminal() and performs the IC01
   *  hand-off internally against the very loop this controller drives. When present it supersedes
   *  `execution`; the capability lifecycle then runs end-to-end through 03A (never a direct loop call). */
  readonly makeExecution?: (loopPort: Ic01LoopPort) => ExecutionSafety;
  readonly responsesFetch: Responses03bFetchLike | null; // provider fetch seam (null ⇒ unavailable)
  readonly apiKey: string | null;           // provider credential (null ⇒ dormant, no real call)
  readonly emit: (frame: CompiledAnswerFrameOut) => void; // gateway→client emitter
  readonly now: () => number;               // wall-clock ms (NON-lifecycle only; never anchors an IC01/03A deadline)
  readonly monotonicNowMs: () => number;    // monotonic ms — legacy fallback for turnClock
  /** P1-07 (ROOT CAUSE) — the ONE injected monotonic clock for the ENTIRE active 03B IC01+03A
   *  lifecycle. Every IC01 nowMs (beginTurn/submitModelPlan/reportModelFailure/acknowledgeDispatch/
   *  submitObservation/interrupt), the 03A ExecutionClock, the provider remaining-deadline, and every
   *  kill/deadline comparison read from THIS SAME clock, so a deadline is only ever compared against a
   *  timestamp in its own monotonic domain — never Date.now() vs performance.now(). Production default =
   *  a Node non-decreasing monotonic performance clock; tests inject a deterministic monotonic clock.
   *  Absent ⇒ falls back to `monotonicNowMs` (which must then itself be the single monotonic source). */
  readonly turnClock?: () => number;
  readonly isKilled: () => boolean;         // kill switch (kill / interrupt)
  readonly stagingEnabled: boolean;         // the 03B staging gate + subject allowlist result
  readonly leaseTtlMs: number;              // DPBEL lease ttl for the provider envelope
  readonly maxControlStalenessMs: number;   // DPBEL control staleness bound
  readonly mintId: (kind: string) => string;
  /** OPTIONAL: a per-turn abort signal factory (kill/deadline abort of the provider fetch). */
  readonly makeAbortSignal?: () => AbortSignal | undefined;
  /** P1-06 — OPTIONAL: fired when a capability is admitted through 03A and the turn suspends
   *  AWAITING_CAPABILITY, so the gateway can emit the browser proposal frame for the RETAINED
   *  lifecycle. The controller itself authorizes nothing here; 03A owns the admission. */
  readonly onCapabilityAdmitted?: (admission: unknown, dispatch: unknown) => void;
  /** P1-03 — a CONTROLLER-OWNED bounded provider-call ceiling for this turn. NEVER
   *  browser/model/user controlled. Omitted ⇒ the accepted IC01 bounded model-attempt
   *  ceiling (MAX_MODEL_CALLS_PER_TURN). An explicitly configured FIRST-PROBE mode passes 1
   *  so the turn admits AT MOST ONE authenticated provider call; a later IC01 MODEL_REQUEST
   *  after the ceiling is consumed makes NO reservation and NO provider call (it fails safely
   *  through accepted IC01 semantics). Clamped to [1, MAX_MODEL_CALLS_PER_TURN]. */
  readonly maxProviderCalls?: number;
}

const MAX_MODEL_CALLS = IC01_LIMITS.MAX_MODEL_CALLS_PER_TURN; // 3 (repair + fallback counted within)

/** Create a 03B text-turn controller. `beginTextTurn` drives one turn to a terminal/awaiting
 *  state; the capability round-trip (03A → browser → observation) is resumed by the caller. */
export function create03bController(deps: Controller03bDeps) {
  let providerCalls = 0;
  let leasePrepared = false;
  const acquisitionKey = `acq_03b_${deps.mintId("turn")}`;
  // P1-03 — the CONTROLLER-OWNED per-turn provider-call ceiling. Derived ONLY from the
  // injected config (never from the browser/model/user/plan), clamped to the accepted IC01
  // bound so it can never EXCEED the frozen model-attempt ceiling — it can only tighten it
  // (e.g. the first-probe one-call mode = 1). Non-integer/absent ⇒ the IC01 default.
  const requestedCeiling = typeof deps.maxProviderCalls === "number" && Number.isFinite(deps.maxProviderCalls)
    ? Math.trunc(deps.maxProviderCalls) : MAX_MODEL_CALLS;
  const providerCallCeiling = Math.max(1, Math.min(requestedCeiling, MAX_MODEL_CALLS));

  // P1-07 (ROOT CAUSE) — THE single monotonic clock for the whole IC01+03A lifecycle. Bound ONCE at
  // construction so every timestamp in this turn (IC01 nowMs, 03A ExecutionClock, provider deadline,
  // kill/deadline comparisons, turnDeadlineMs) comes from the SAME monotonic domain. deps.now() (epoch
  // wall-clock) is NEVER used to anchor or compare any deadline.
  const monoNow: () => number = deps.turnClock ? deps.turnClock : deps.monotonicNowMs;

  // P1-06 (ROOT CAUSE) — build the same-loop capture proxy ONCE and bind the RELEASED 03A to it, so the
  // capability lifecycle runs end-to-end through 03A (admit→acceptAction→deliverTerminal) and 03A performs
  // the IC01 hand-off internally against THIS controller's real loop. Fallback: a pre-built `execution`
  // NOT bound to the proxy — usable only for admit; the resume path fails closed (it cannot capture the
  // exact IC01 effect 03A produced, so it must never guess one).
  const capture: LoopEffectCapture | null = deps.makeExecution ? createLoopEffectCaptureProxy(deps.loop) : null;
  const execution: ExecutionSafety | null = deps.makeExecution && capture ? deps.makeExecution(capture.port) : deps.execution;
  const executionBoundToLoop = !!(deps.makeExecution && capture);
  // P1-06 (g) — the bounded active-capability record (≤1 per controller). Set at admit; cleared on a
  // resolved terminal / rejected / interrupt / teardown / supersession. No hanging-promise dependency.
  let activeAdmission: ExecutionAdmission | null = null;
  function clearActiveCapability(): void { activeAdmission = null; if (capture) capture.clear(); }

  function killedOrExpired(deadlineMs: number): "KILLED" | "DEADLINE_EXCEEDED" | null {
    if (deps.isKilled()) return "KILLED";
    if (monoNow() >= deadlineMs) return "DEADLINE_EXCEEDED";
    return null;
  }

  async function ensureProviderLease(req: TextTurnRequest): Promise<{ ok: true } | { ok: false; reason: string }> {
    if (leasePrepared) return { ok: true };
    // §8.5/§8.6 — the maximum financial exposure for up to MAX_MODEL_CALLS reasoning calls.
    const worst = deps.budgetCore.quoteReasoning03bWorstCaseMicros();
    if (worst === null) return { ok: false, reason: "no_reasoning_rate" };
    // P1-03 — the lease reserves exactly the CONTROLLER-OWNED ceiling of calls (≤ IC01 max),
    // so a first-probe (ceiling 1) exposes at most one call's worth of authority.
    const moneyMicros = worst * BigInt(providerCallCeiling);
    const res = await deps.budgetCore.prepareProviderLease({
      gatewaySessionId: req.gatewaySessionId, subjectDigest: req.subjectDigest, projectId: req.projectId,
      acquisitionKey, maxControlStalenessMs: deps.maxControlStalenessMs, leaseTtlMs: deps.leaseTtlMs,
      amounts: { moneyMicros, providerCalls: BigInt(providerCallCeiling), executionAdmissions: BigInt(0) },
    });
    if (!res.ok) return { ok: false, reason: res.reason || "prepare_failed" };
    leasePrepared = true;
    return { ok: true };
  }

  /** §8 — the MANDATORY budget-before-provider-call sequence for a single MODEL_REQUEST. */
  async function handleModelRequest(req: TextTurnRequest, eff: Extract<LoopEffect, { kind: "MODEL_REQUEST" }>): Promise<LoopEffect> {
    const nowMs = monoNow();
    // §8.8 (early) — kill / deadline recheck BEFORE any authority.
    const dead0 = killedOrExpired(eff.deadlineMs);
    if (dead0) return deps.loop.reportModelFailure({ nowMs, modelRequestId: eff.modelRequestId, cause: dead0 === "DEADLINE_EXCEEDED" ? "timeout" : "killed" });
    // P1-03 — the CONTROLLER-OWNED provider-call ceiling. Checked BEFORE any reservation or
    // admission, so once the ceiling is consumed a later IC01 MODEL_REQUEST makes NO second
    // reservation and NO second authenticated request — it fails safely through IC01 semantics.
    if (providerCalls >= providerCallCeiling) return deps.loop.reportModelFailure({ nowMs, modelRequestId: eff.modelRequestId, cause: "unavailable" });
    // §8.1 — provider path must be configured (dormant ⇒ unavailable, NEVER a real call).
    if (!deps.apiKey || !deps.responsesFetch) return deps.loop.reportModelFailure({ nowMs, modelRequestId: eff.modelRequestId, cause: "unavailable" });
    // §8.5/8.6 — obtain PROVIDER_SPEND authority (envelope) THEN reserve the worst case.
    const lease = await ensureProviderLease(req);
    if (!lease.ok) return deps.loop.reportModelFailure({ nowMs, modelRequestId: eff.modelRequestId, cause: "unavailable" });
    const providerTurnId = deps.mintId("provturn");
    const reservationId = deps.budgetCore.reserveReasoning03b(req.gatewaySessionId, providerTurnId);
    if (!reservationId) return deps.loop.reportModelFailure({ nowMs, modelRequestId: eff.modelRequestId, cause: "unavailable" });
    // §8.4 — the immutable, digested provider admission (created AFTER reservation, BEFORE the call).
    const deadlineMs = Math.max(1, Math.min(eff.providerCeilingMs, eff.deadlineMs - monoNow()));
    const admission: ProviderCallAdmissionV1 | null = buildProviderCallAdmissionV1({ inputSnapshot: eff.input, deadlineMs });
    if (!admission) { deps.budgetCore.settleUsage(req.gatewaySessionId, providerTurnId, null); await persistSettle(req, providerTurnId); return deps.loop.reportModelFailure({ nowMs, modelRequestId: eff.modelRequestId, cause: "unavailable" }); }
    // §8.7 — durably persist the provider child BEFORE the call; a failure ⇒ NO provider invocation.
    const persisted = await deps.budgetCore.persistProviderReservation(req.gatewaySessionId, providerTurnId);
    if (!persisted) { deps.budgetCore.settleUsage(req.gatewaySessionId, providerTurnId, null); await persistSettle(req, providerTurnId); return deps.loop.reportModelFailure({ nowMs, modelRequestId: eff.modelRequestId, cause: "unavailable" }); }
    // §8.8 — kill / deadline / lease rechecked immediately BEFORE the call.
    const dead1 = killedOrExpired(eff.deadlineMs);
    if (dead1) { deps.budgetCore.settleUsage(req.gatewaySessionId, providerTurnId, null); await persistSettle(req, providerTurnId); return deps.loop.reportModelFailure({ nowMs: monoNow(), modelRequestId: eff.modelRequestId, cause: dead1 === "DEADLINE_EXCEEDED" ? "timeout" : "killed" }); }
    // §8.9 — ONLY NOW invoke the provider seam.
    providerCalls += 1;
    let outcome: ProviderOutcomeV1;
    try {
      outcome = await runReasoning03bProviderCall(admission, { apiKey: deps.apiKey, inputSnapshot: eff.input, fetchImpl: deps.responsesFetch, signal: deps.makeAbortSignal ? deps.makeAbortSignal() : undefined });
    } catch { outcome = { kind: "FAILED" }; }
    // §8.10/8.11 — normalize + local settlement.
    const usage: ProviderUsageV1 | null = outcome.kind === "COMPLETED_VALID" ? outcome.usage : null;
    deps.budgetCore.settleUsage(req.gatewaySessionId, providerTurnId, usage);
    // §8.12 — durable settlement/revocation persistence; if unresolved the lease is fail-closed.
    const settleOk = await persistSettle(req, providerTurnId);
    const settleNow = monoNow();
    if (!settleOk) return deps.loop.reportModelFailure({ nowMs: settleNow, modelRequestId: eff.modelRequestId, cause: "unavailable" });
    // §8.13 — ONLY a COMPLETED_VALID candidate reaches submitModelPlan; any other outcome is a failure.
    if (outcome.kind === "COMPLETED_VALID") {
      return deps.loop.submitModelPlan({ nowMs: settleNow, modelRequestId: eff.modelRequestId, plan: outcome.candidate });
    }
    const cause = outcome.kind === "TIMEOUT" ? "timeout" : outcome.kind === "ABORTED" ? "aborted" : "unavailable";
    return deps.loop.reportModelFailure({ nowMs: settleNow, modelRequestId: eff.modelRequestId, cause });
  }

  async function persistSettle(req: TextTurnRequest, providerTurnId: string): Promise<boolean> {
    try { return await deps.budgetCore.persistProviderSettlement(req.gatewaySessionId, providerTurnId); } catch { return false; }
  }

  function emitCompiled(req: TextTurnRequest, eff: Extract<LoopEffect, { kind: "TERMINAL" }>): boolean {
    if (!eff.envelope) return false;
    const env = eff.envelope as { binding?: { turnId?: unknown; generation?: unknown } };
    const turnId = typeof env.binding?.turnId === "string" ? env.binding.turnId : req.binding.turnId;
    const generation = typeof env.binding?.generation === "number" ? env.binding.generation : req.binding.generation;
    deps.emit({
      t: "answer.compiled", sessionId: req.binding.sessionId, turnId, generation,
      authorityRef: req.binding.authorityRef, envelope: eff.envelope,
    });
    return true;
  }

  /** Route a CAPABILITY_DISPATCH strictly through the released 03A execution admission.
   *  03B NEVER authorizes the browser action; 03A owns the single-slot lifecycle. */
  function admitCapability(eff: Extract<LoopEffect, { kind: "CAPABILITY_DISPATCH" }>): AdmitOutcome | { ok: false; reason: "execution_unavailable" } {
    if (!execution) return { ok: false, reason: "execution_unavailable" };
    const outcome = execution.admit({
      dispatch: eff, proposalId: deps.mintId("proposal"), providerTurnId: deps.mintId("provturn"),
      receiptId: deps.mintId("receipt"), executionNonce: deps.mintId("nonce"), turnDeadlineMs: eff.deadlineMs,
    });
    // P1-06 (g) — record the SINGLE admitted lifecycle so the retained resume path can build the exact 03A
    // terminal envelope (sourceAuthority from admission.source ONLY) and correlate acceptAction/deliverTerminal.
    if (outcome.ok) { activeAdmission = outcome.admission; if (capture) capture.clear(); }
    return outcome;
  }

  async function drive(req: TextTurnRequest, first: LoopEffect): Promise<TurnOutcome> {
    let eff = first;
    // bounded: at most MAX_MODEL_CALLS model requests + a small dispatch budget (IC01 caps steps).
    for (let guard = 0; guard < 32; guard++) {
      if (deps.isKilled()) { clearActiveCapability(); return { state: "KILLED", compiledEmitted: false, providerCalls }; }
      switch (eff.kind) {
        case "MODEL_REQUEST": {
          eff = await handleModelRequest(req, eff);
          continue;
        }
        case "CAPABILITY_DISPATCH": {
          const ad = admitCapability(eff);
          if (!ad.ok) { clearActiveCapability(); return { state: "TERMINAL_FAILURE", reason: (ad as { reason?: string }).reason || "execution_refused", compiledEmitted: false, providerCalls }; }
          // P1-06 — surface the 03A admission so the gateway can emit the browser proposal frame for
          // the RETAINED lifecycle. 03A owns the admission; 03B authorizes nothing here.
          if (deps.onCapabilityAdmitted) { try { deps.onCapabilityAdmitted((ad as { admission?: unknown }).admission, eff); } catch { /* hostile sink never breaks the turn */ } }
          // The browser round-trip (action.accepted → terminal receipt → observation) is delivered
          // out-of-band and resumed via resumeWithObservation(...) on the SAME retained controller.
          return { state: "AWAITING_CAPABILITY", compiledEmitted: false, providerCalls };
        }
        case "REBIND_REQUIRED":
          clearActiveCapability();
          return { state: "REBIND_REQUIRED", compiledEmitted: false, providerCalls };
        case "TERMINAL": {
          clearActiveCapability();
          const emitted = emitCompiled(req, eff);
          return { state: emitted ? "TERMINAL_COMPILED" : "TERMINAL_FAILURE", reason: eff.reason, compiledEmitted: emitted, providerCalls };
        }
        case "INERT":
          clearActiveCapability();
          return { state: "INERT", reason: eff.why, compiledEmitted: false, providerCalls };
        case "REJECTED":
          clearActiveCapability();
          return { state: "REJECTED", reason: eff.why, compiledEmitted: false, providerCalls };
        default:
          clearActiveCapability();
          return { state: "ERROR", compiledEmitted: false, providerCalls };
      }
    }
    clearActiveCapability();
    return { state: "ERROR", reason: "effect_guard_exhausted", compiledEmitted: false, providerCalls };
  }

  return {
    version: LIVE_AI_03B_CONTROLLER_VERSION,
    /** Begin + drive one 03B text turn. Fail-closed on the staging gate / kill / budget. */
    async beginTextTurn(req: TextTurnRequest): Promise<TurnOutcome> {
      if (!deps.stagingEnabled) return { state: "STAGING_DISABLED", compiledEmitted: false, providerCalls };
      if (deps.isKilled()) return { state: "KILLED", compiledEmitted: false, providerCalls };
      const nowMs = monoNow();
      const first = deps.loop.beginTurn({
        nowMs, binding: req.binding,
        userTurn: { text: req.userText, language: req.language, role: req.role },
        context: req.context,
      });
      return drive(req, first);
    },
    /** P1-06 (b) — Stage 2. The browser's action.accepted for the RETAINED capability lifecycle. Routes
     *  acceptance through the RELEASED 03A ONLY (`ExecutionSafety.acceptAction`), which acknowledges the
     *  dispatch on the SAME loop INTERNALLY; the controller NEVER calls loop.acknowledgeDispatch itself.
     *  On success the turn STAYS awaiting the terminal receipt (the ack effect is INERT, never driven). */
    async acceptCapability(req: TextTurnRequest, accepted: unknown): Promise<TurnOutcome> {
      void req;
      if (deps.isKilled()) { clearActiveCapability(); return { state: "KILLED", compiledEmitted: false, providerCalls }; }
      if (!execution || !executionBoundToLoop || !capture || !activeAdmission) {
        clearActiveCapability();
        return { state: "TERMINAL_FAILURE", reason: "execution_unavailable", compiledEmitted: false, providerCalls };
      }
      let acc: AcceptOutcome;
      try { acc = execution.acceptAction({ accepted }); } catch { acc = { ok: false, reason: "EXECUTION_CAPABILITY_FAILURE" }; }
      if (!acc.ok) { clearActiveCapability(); return { state: "REJECTED", reason: acc.reason, compiledEmitted: false, providerCalls }; }
      // 03A acknowledged the dispatch on the real loop internally; the captured ack effect (INERT
      // dispatch_acknowledged) is NOT drive-able. A duplicate acceptance takes an early 03A path that never
      // touches the loop (no capture) — legitimate. When a loop call DID occur, its kind must agree with 03A.
      const ackEff = capture.take();
      if (ackEff && ackEff.kind !== acc.loopEffectKind) {
        clearActiveCapability();
        return { state: "ERROR", reason: "loop_effect_disagreement", compiledEmitted: false, providerCalls };
      }
      // Retain the SAME controller/ExecutionSafety/admission/turn — do NOT finish/reconcile/clear.
      return { state: "AWAITING_CAPABILITY", compiledEmitted: false, providerCalls };
    },
    /** P1-06 (c/d) — Stage 3. The browser's terminal action.receipt for the RETAINED lifecycle. Builds the
     *  EXACT 03A terminal envelope (sourceAuthority from admission.source ONLY; resultAuthority = validated
     *  receipt.resultAuthority || null; ackCommitment = gateway-computed terminalReceiptCommitment) and calls
     *  `ExecutionSafety.deliverTerminal`, which submits the observation on the SAME loop INTERNALLY (the
     *  controller NEVER calls loop.submitObservation). It then CONSUMES the exact captured IC01 effect: a
     *  post-accept PENDING (acted) keeps the execution ALIVE (AWAITING_TERMINAL, retained); a resolved
     *  IC01_HANDOFF/PRE_ACCEPT_TERMINAL continues the exact resulting IC01 effect in the SAME turn. */
    async resumeWithObservation(req: TextTurnRequest, receipt: unknown): Promise<TurnOutcome> {
      if (deps.isKilled()) { clearActiveCapability(); return { state: "KILLED", compiledEmitted: false, providerCalls }; }
      if (!execution || !executionBoundToLoop || !capture || !activeAdmission) {
        clearActiveCapability();
        return { state: "TERMINAL_FAILURE", reason: "execution_unavailable", compiledEmitted: false, providerCalls };
      }
      const vr = validateActionReceipt(receipt);
      if (!vr) { clearActiveCapability(); return { state: "REJECTED", reason: "EXECUTION_RESULT_MALFORMED", compiledEmitted: false, providerCalls }; }
      const src = activeAdmission.source;
      const sourceAuthority = {
        turnId: src.turnId, generation: src.generation, routeEpoch: src.routeEpoch,
        contextRevision: src.contextRevision, authorityRef: src.authorityRef, contextDigest: src.contextDigest,
      };
      const resultAuthority = (vr as { resultAuthority?: unknown }).resultAuthority ?? null;
      const ackCommitment = terminalReceiptCommitment(vr as Record<string, unknown>);
      const terminal = { receipt: vr, sourceAuthority, resultAuthority, ackCommitment };
      let term: TerminalOutcome;
      try { term = execution.deliverTerminal({ terminal }); } catch { term = { ok: false, reason: "EXECUTION_CAPABILITY_FAILURE" }; }
      if (!term.ok) { clearActiveCapability(); return { state: "TERMINAL_FAILURE", reason: term.reason, compiledEmitted: false, providerCalls }; }
      const termEff = capture.take();
      if (!termEff || termEff.kind !== term.loopEffectKind) {
        clearActiveCapability();
        return { state: "ERROR", reason: "loop_effect_disagreement", compiledEmitted: false, providerCalls };
      }
      if (term.lifecycleState === "AWAITING_TERMINAL") {
        // post-accept PENDING (acted) — retain the SAME execution/admission; do NOT drive or reconcile.
        return { state: "AWAITING_CAPABILITY", compiledEmitted: false, providerCalls };
      }
      // resolved terminal — the execution slot is cleared by 03A; continue the exact IC01 effect.
      clearActiveCapability();
      return drive(req, termEff);
    },
    /** Interrupt/kill the turn — revoke local + durable authority; NO further provider/browser. */
    async interrupt(req: TextTurnRequest, reason: string): Promise<void> {
      clearActiveCapability();
      try { deps.loop.interrupt({ nowMs: monoNow(), reason }); } catch { /* no-op */ }
      try { if (execution) execution.interrupt(reason); } catch { /* no-op */ }
      try { await deps.budgetCore.revokeSessionDurable(req.gatewaySessionId, `03b_${reason}`); } catch { /* no-op */ }
    },
    /** Reconcile the provider envelope at turn end (release unused reservation, clean teardown). */
    async finish(req: TextTurnRequest, crash: boolean): Promise<void> {
      try { await deps.budgetCore.reconcileSession(req.gatewaySessionId, { crash }); } catch { /* best-effort */ }
    },
    providerCallCount(): number { return providerCalls; },
  };
}
export type Controller03b = ReturnType<typeof create03bController>;
