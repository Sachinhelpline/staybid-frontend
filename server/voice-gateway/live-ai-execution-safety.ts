// ─────────────────────────────────────────────────────────────────────────
// StayBid Live AI — LIVE-AI-03A — the PROVIDER-NEUTRAL EXECUTION-SAFETY
// boundary (Customer V1). CONSOLIDATED-REMEDIATION-01 (P1-01 … P1-06).
//
// This module sits BETWEEN the controller's accepted IC01 `CAPABILITY_DISPATCH`
// effect and any provider/browser execution adapter. It is DETERMINISTIC,
// BOUNDED (one admitted execution per active slot), FAIL-CLOSED, PROVIDER-NEUTRAL
// and NETWORK / DB / ENV / SECRET FREE.
//
// It implements the FROZEN two-stage R5B lifecycle as DISTINCT controller-drivable
// boundaries — admit() → acceptAction() → deliverTerminal() — so the browser
// acceptance + terminal events arrive INDEPENDENTLY (03B delivers them later); the
// provider-neutral adapter only TRIGGERS execution and never owns the acceptance
// lifecycle. 03A NEVER derives an authoritative ResultState and NEVER creates IC02
// provenance — it produces only a VALIDATED lifecycle HAND-OFF to the accepted IC01
// loop (acknowledgeDispatch → submitObservation); IC01 alone derives the ResultState,
// promotes VERIFIED, and (atomically) creates IC02 provenance.
//
// AUTHORITY MODEL (unchanged, LOCKED): MODEL = INTELLIGENCE · CAPABILITY · ROLE =
// AUTHORITY · CONFIRMATION = HUMAN AUTHORIZATION · AUDIT = ACCOUNTABILITY. Ceiling =
// READ + UI_LOCAL, EXACTLY six capabilities, confirmation NONE, concurrency 1, zero
// automatic capability retry. 03A adds no capability / transactional authority.
// ─────────────────────────────────────────────────────────────────────────

import {
  getCapability,
  validateCapabilityArgs,
} from "./live-ai-capability-registry";
import type {
  CapabilityDescriptor,
  CapabilityAuthorityClass,
  CapabilityContextEffect,
  CapabilityEvidenceType,
} from "./live-ai-capability-registry";
import {
  isId,
  validateActionAccepted,
  validateActionReceipt,
  validateResultAuthority,
  terminalReceiptCommitment,
  evidenceMatchesOperation,
  canonicalString,
  sha256Hex,
  UNACCEPTED_ACTION_ID,
} from "./live-ai-schemas";
import type { ResultAuthorityShape } from "./live-ai-schemas";
import { INTELLIGENCE_CONTRACT_VERSION, validateTrustedBinding } from "./live-ai-intelligence-contract";
import type { TrustedBinding } from "./live-ai-intelligence-contract";

// ═══════════════════════════ constants ═════════════════════════════════════
export const EXECUTION_SAFETY_VERSION = "staybid-execution-safety.v1" as const;
export const EXECUTION_POLICY_VERSION = "staybid-execution-policy.v1" as const;
export const EXECUTION_CONCURRENCY_LIMIT = 1 as const;
export const EXECUTION_ATTEMPT_CEILING = 1 as const;
/** Bounded replay ledger — a turn's dispatches never exceed the plan-step ceiling;
 *  the ledger is capped so it can never grow unbounded. */
export const EXECUTION_REPLAY_LEDGER_MAX = 64 as const;
const HEX64_RE = /^[0-9a-f]{64}$/;

// ═══════════════════════════ closed error model ════════════════════════════
export const EXECUTION_REASONS = Object.freeze([
  "EXECUTION_INVALID_REQUEST",
  "EXECUTION_UNKNOWN_CAPABILITY",
  "EXECUTION_INVALID_ARGS",
  "EXECUTION_UNAUTHORIZED",
  "EXECUTION_WRONG_PAGE",
  "EXECUTION_ENTITY_NOT_ALLOWED",
  "EXECUTION_STALE_BINDING",
  "EXECUTION_STALE_ROUTE",
  "EXECUTION_STALE_CONTEXT",
  "EXECUTION_NO_PENDING_DISPATCH",
  "EXECUTION_CONFIRMATION_REQUIRED",
  "EXECUTION_CONFIRMATION_MISMATCH",
  "EXECUTION_CONFIRMATION_EXPIRED",
  "EXECUTION_DEADLINE_EXCEEDED",
  "EXECUTION_NON_MONOTONIC_TIME",
  "EXECUTION_BUDGET_REFUSED",
  "EXECUTION_BUSY",
  "EXECUTION_DISPATCH_REPLAY",
  "EXECUTION_LIFECYCLE_INVALID",
  "EXECUTION_INTERRUPTED",
  "EXECUTION_TRANSPORT_FAILURE",
  "EXECUTION_CAPABILITY_FAILURE",
  "EXECUTION_RESULT_MALFORMED",
  "EXECUTION_VERIFICATION_REQUIRED",
] as const);
export type ExecutionReason = (typeof EXECUTION_REASONS)[number];

// ═══════════════════════════ lifecycle states ══════════════════════════════
export const EXECUTION_LIFECYCLE_STATES = Object.freeze([
  "IDLE",
  "ADMITTED",
  "DISPATCHED",
  "ACCEPTED",
  "AWAITING_TERMINAL",
  "PRE_ACCEPT_TERMINAL",
  "TERMINAL_VALIDATED",
  "IC01_HANDOFF",
  "TERMINAL_REJECTED",
  "INTERRUPTED",
  "EXPIRED",
  "REPLAYED_CONFLICTING",
  "LATE_RESULT",
] as const);
export type ExecutionLifecycleState = (typeof EXECUTION_LIFECYCLE_STATES)[number];

// ═══════════════════════════ audit vocabulary ══════════════════════════════
export const EXECUTION_AUDIT_EVENTS = Object.freeze([
  "execution_proposed",
  "execution_admission_allowed",
  "execution_admission_refused",
  "execution_dispatched",
  "execution_acknowledged",
  "execution_result_received",
  "execution_verification_handoff",
  "execution_terminal_rejected",
  "execution_interrupted",
  "execution_expired",
  "execution_late_result",
  "execution_replay_refused",
] as const);
export type ExecutionAuditEvent = (typeof EXECUTION_AUDIT_EVENTS)[number];

// ═══════════════════════════ registry metadata (03A augmentation) ══════════
// Deterministic execution metadata DERIVED (purely) from the accepted six-capability
// registry. Adds NO capability, widens NO role/authority, keeps confirmation NONE,
// and keeps automatic retry ZERO for every capability. Idempotency policy is
// SEPARATE from retry: IDEMPOTENT_READ describes a safe re-READ, it is NEVER an
// automatic-retry authorization. No runtime registration API.
export type ExecutionClassification = "READ_ONLY" | "UI_LOCAL_STATE";
export type ExecutionDeadlinePolicy = "TURN_DEADLINE";
export type ExecutionIdempotencyPolicy = "IDEMPOTENT_READ" | "SINGLE_ATTEMPT";
export type ExecutionCurrentEntityPolicy =
  | "CURRENT_RESULTS"
  | "CURRENT_VISIBLE_SET"
  | "SINGLE_CURRENT_VISIBLE"
  | "CURRENT_HOTELS_PAGE"
  | "CURRENT_DETAIL_HOTEL"
  | "CURRENT_DETAIL_SECTION";

export interface ExecutionCapabilityMetadata {
  readonly capabilityId: string;
  readonly classification: ExecutionClassification;
  /** The evidence kind(s) IC01 accepts as this capability's result schema. OPEN
   *  explicitly permits BOTH navigation AND detail; every other capability is single. */
  readonly resultSchemas: readonly CapabilityEvidenceType[];
  readonly resultSchemaId: CapabilityEvidenceType; // the primary/declared schema
  readonly currentEntityPolicy: ExecutionCurrentEntityPolicy;
  readonly deadlinePolicy: ExecutionDeadlinePolicy;
  readonly idempotencyPolicy: ExecutionIdempotencyPolicy;
  /** ALWAYS 0 — there is NO automatic capability retry (idempotency ≠ retry). */
  readonly automaticRetryCeiling: 0;
  readonly confirmationClass: "NONE";
  readonly requiredPageId: "hotels" | "hotel-detail";
  readonly authorityClass: CapabilityAuthorityClass;
  readonly contextEffect: CapabilityContextEffect;
}

const CURRENT_ENTITY_POLICY: Readonly<Record<string, ExecutionCurrentEntityPolicy>> = Object.freeze({
  READ_CURRENT_RESULTS: "CURRENT_RESULTS",
  COMPARE_VISIBLE_HOTELS: "CURRENT_VISIBLE_SET",
  OPEN_VISIBLE_HOTEL: "SINGLE_CURRENT_VISIBLE",
  APPLY_HOTEL_REFINEMENT: "CURRENT_HOTELS_PAGE",
  READ_CURRENT_HOTEL_FACTS: "CURRENT_DETAIL_HOTEL",
  SHOW_HOTEL_SECTION: "CURRENT_DETAIL_SECTION",
});
// OPEN accepts navigation OR detail as its result schema (mirrors evidenceMatchesOperation).
const RESULT_SCHEMAS: Readonly<Record<string, readonly CapabilityEvidenceType[]>> = Object.freeze({
  READ_CURRENT_RESULTS: Object.freeze(["results"]) as readonly CapabilityEvidenceType[],
  COMPARE_VISIBLE_HOTELS: Object.freeze(["comparison"]) as readonly CapabilityEvidenceType[],
  READ_CURRENT_HOTEL_FACTS: Object.freeze(["detail"]) as readonly CapabilityEvidenceType[],
  APPLY_HOTEL_REFINEMENT: Object.freeze(["results"]) as readonly CapabilityEvidenceType[],
  SHOW_HOTEL_SECTION: Object.freeze(["ui_state"]) as readonly CapabilityEvidenceType[],
  OPEN_VISIBLE_HOTEL: Object.freeze(["navigation", "detail"]) as readonly CapabilityEvidenceType[],
});

/** Deterministic execution metadata for a capability id, or null (unknown ⇒ fail
 *  closed). PURE: derived from the frozen registry descriptor. READ ⇒ IDEMPOTENT_READ,
 *  UI_LOCAL ⇒ SINGLE_ATTEMPT; automatic retry ceiling is ZERO for all. */
export function getExecutionMetadata(capabilityId: unknown): ExecutionCapabilityMetadata | null {
  const d: CapabilityDescriptor | null = getCapability(capabilityId);
  if (!d) return null;
  const policy = CURRENT_ENTITY_POLICY[d.capabilityId];
  const schemas = RESULT_SCHEMAS[d.capabilityId];
  if (!policy || !schemas) return null;
  return Object.freeze({
    capabilityId: d.capabilityId,
    classification: d.authorityClass === "READ" ? "READ_ONLY" : "UI_LOCAL_STATE",
    resultSchemas: schemas,
    resultSchemaId: d.evidenceType,
    currentEntityPolicy: policy,
    deadlinePolicy: "TURN_DEADLINE",
    idempotencyPolicy: d.authorityClass === "READ" ? "IDEMPOTENT_READ" : "SINGLE_ATTEMPT",
    automaticRetryCeiling: 0,
    confirmationClass: "NONE",
    requiredPageId: d.requiredPageId,
    authorityClass: d.authorityClass,
    contextEffect: d.contextEffect,
  });
}

// ═══════════════════════════ injected ports (fail-closed defaults) ═════════
export interface ExecutionClock { nowMonotonicMs(): number; }
export interface ExecutionIdMinter { mint(kind: string, seq: number): string; }

export type BudgetDecision = "ADMITTED" | "REFUSED" | "UNAVAILABLE";
export interface ExecutionBudgetInput {
  readonly dispatchId: string;
  readonly executionId: string;             // the ACTUAL minted execution id (never "")
  readonly capabilityId: string;
  readonly authorityClass: CapabilityAuthorityClass;
  readonly requestDigest: string;           // the FINAL full canonical SHA-256 commitment
  readonly issuedAtMonotonicMs: number;
  readonly deadlineMonotonicMs: number;
}
export interface ExecutionBudgetOutcome { readonly decision: BudgetDecision; readonly budgetAdmissionRef?: string; }
export interface ExecutionBudgetGate { admit(input: ExecutionBudgetInput): ExecutionBudgetOutcome; }

/** The CURRENT trusted screen context the controller publishes — it carries a
 *  COMPLETE controller-owned TrustedBinding PLUS the validated bounded page/entity
 *  projection. 03A compares EVERY binding field (incl. contextDigest) exactly against
 *  the pending dispatch binding before any authority activation. */
export interface ExecutionScreenContext {
  readonly binding: TrustedBinding;                 // complete current trusted binding
  readonly ready: boolean;
  readonly visiblePositions: readonly number[];     // belongs to THIS validated context
  readonly currentHotelId: string | null;
  readonly sections: readonly ("rooms" | "about")[];
}
export interface ExecutionCurrentContexts { current(): ExecutionScreenContext | null; }

export interface ExecutionAdapterRequest { readonly admission: ExecutionAdmission; }
/** The provider-neutral EXECUTION adapter. It only TRIGGERS execution — it does NOT
 *  own the browser acceptance/terminal lifecycle (those arrive via acceptAction /
 *  deliverTerminal). DEFAULT = dormant (returns null / dispatched:false ⇒ zero
 *  execution). It may not select another capability, mutate the (frozen) admission,
 *  mint authority, construct routes/URLs/tools/HTTP/SQL/RPC, or touch DB/DOM. */
export interface ExecutionDispatchAck { readonly dispatched: boolean; }
export interface ExecutionAbortSignal { readonly aborted: boolean; readonly reason: string | null; }
export interface ExecutionAdapter { dispatch(request: ExecutionAdapterRequest, abort: ExecutionAbortSignal): ExecutionDispatchAck | null; }

export interface Ic01LoopPort {
  status(): { readonly phase: string; readonly planId: string | null; readonly currentStepIndex: number | null; readonly pendingDispatchId: string | null;[k: string]: unknown };
  acknowledgeDispatch(input: unknown): { readonly kind: string; readonly why?: string;[k: string]: unknown };
  submitObservation(input: unknown): { readonly kind: string; readonly why?: string;[k: string]: unknown };
}

export interface ExecutionAuditRecord {
  readonly event: ExecutionAuditEvent;
  readonly capabilityId?: string;
  readonly dispatchId?: string;
  readonly executionId?: string;
  readonly reason?: ExecutionReason;
  readonly requestDigest?: string;
  readonly lifecycleState?: ExecutionLifecycleState;
}
export interface ExecutionAudit { emit(record: ExecutionAuditRecord): void; }

export interface ExecutionSafetyDeps {
  readonly clock: ExecutionClock;
  readonly mintId: ExecutionIdMinter;
  readonly budgetGate: ExecutionBudgetGate | null;
  readonly adapter: ExecutionAdapter | null;
  readonly contexts: ExecutionCurrentContexts;
  readonly loop: Ic01LoopPort;
  readonly audit: ExecutionAudit;
}

export function createDefaultExecutionSafetyDeps(loop: Ic01LoopPort): ExecutionSafetyDeps {
  return Object.freeze({
    clock: Object.freeze({ nowMonotonicMs: () => 0 }),
    mintId: Object.freeze({ mint: (kind: string, seq: number) => `exec-${kind}-${seq}` }),
    budgetGate: null,                                  // absent ⇒ UNAVAILABLE ⇒ fail closed
    adapter: null,                                     // DORMANT ⇒ zero execution
    contexts: Object.freeze({ current: () => null }),  // fail closed
    loop,
    audit: Object.freeze({ emit: () => { /* no-op */ } }),
  });
}

// ═══════════════════════════ admitted execution identity ═══════════════════
export interface ExecutionSourceBinding {
  readonly sessionId: string;
  readonly turnId: string;
  readonly generation: number;
  readonly pageId: "hotels" | "hotel-detail";
  readonly role: "anonymous" | "customer";
  readonly routeEpoch: number;
  readonly contextRevision: string;
  readonly authorityRef: string;
  readonly contextDigest: string;
}
export interface ExecutionAdmission {
  readonly contractVersion: typeof INTELLIGENCE_CONTRACT_VERSION;
  readonly policyVersion: typeof EXECUTION_POLICY_VERSION;
  readonly dispatchId: string;
  readonly executionId: string;
  readonly attemptId: string;
  readonly attemptNumber: 1;
  readonly proposalId: string;
  readonly providerTurnId: string;
  readonly receiptId: string;
  readonly executionNonce: string;
  readonly planId: string;
  readonly stepIndex: number;
  readonly capabilityId: string;
  readonly normalizedArgs: Readonly<Record<string, unknown>>;
  readonly normalizedArgsDigest: string;   // full canonical SHA-256
  readonly requestDigest: string;          // full canonical SHA-256 over all frozen authority fields
  readonly source: ExecutionSourceBinding;
  readonly issuedAtMonotonicMs: number;
  readonly deadlineMonotonicMs: number;
  readonly budgetAdmissionRef: string;
  readonly authorityClass: CapabilityAuthorityClass;
  readonly evidenceKind: CapabilityEvidenceType;
}

// ═══════════════════════════ proposal / outcomes ═══════════════════════════
export interface ExecutionProposalInput {
  readonly dispatch: unknown;
  readonly proposalId: unknown;
  readonly providerTurnId: unknown;
  readonly receiptId: unknown;
  readonly executionNonce: unknown;
  readonly turnDeadlineMs: unknown;   // controller/turn-owned absolute monotonic deadline bound
}
export type AdmitOutcome =
  | { readonly ok: true; readonly lifecycleState: "DISPATCHED"; readonly admission: ExecutionAdmission }
  | { readonly ok: false; readonly reason: ExecutionReason };
export type AcceptOutcome =
  | { readonly ok: true; readonly lifecycleState: "ACCEPTED"; readonly loopEffectKind: string }
  | { readonly ok: false; readonly reason: ExecutionReason };
export type TerminalOutcome =
  // A TRUE terminal event resolves the execution (IC01_HANDOFF / PRE_ACCEPT_TERMINAL). A post-accept
  // PENDING (acted) event is NOT terminal (P1-03): it keeps the SAME execution alive in AWAITING_TERMINAL
  // and a later TRUE terminal for the same execution is still deliverable.
  | { readonly ok: true; readonly lifecycleState: "IC01_HANDOFF" | "PRE_ACCEPT_TERMINAL" | "AWAITING_TERMINAL"; readonly loopEffectKind: string; readonly verificationHandoff: boolean }
  | { readonly ok: false; readonly reason: ExecutionReason };

// ── strict snapshot: reject accessor descriptors / symbol keys / extra keys ─
function strictSnapshot(x: unknown, allowed: readonly string[]): Record<string, unknown> | null {
  try {
    if (!x || typeof x !== "object" || Array.isArray(x)) return null;
    const keys = Reflect.ownKeys(x);
    const out: Record<string, unknown> = Object.create(null);
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      if (typeof k === "symbol") return null;                 // no symbol authority keys
      if (allowed.indexOf(k) === -1) return null;             // no extra authority-bearing keys
      const desc = Object.getOwnPropertyDescriptor(x, k);
      if (!desc || typeof desc.get === "function" || typeof desc.set === "function" || !("value" in desc)) return null; // no accessors
      out[k] = desc.value;
    }
    return out;
  } catch { return null; }
}

const DISPATCH_KEYS = Object.freeze(["kind", "dispatchId", "planId", "stepIndex", "capabilityId", "args", "binding", "deadlineMs"]);
const PROPOSAL_KEYS = Object.freeze(["dispatch", "proposalId", "providerTurnId", "receiptId", "executionNonce", "turnDeadlineMs"]);

interface ParsedDispatch {
  readonly dispatchId: string;
  readonly planId: string;
  readonly stepIndex: number;
  readonly capabilityId: string;
  readonly rawArgs: unknown;
  readonly binding: TrustedBinding;
  readonly deadlineMs: number;
}
function parseDispatch(x: unknown): ParsedDispatch | null {
  const d = strictSnapshot(x, DISPATCH_KEYS);
  if (!d) return null;
  if (d.kind !== "CAPABILITY_DISPATCH") return null;
  if (!isId(d.dispatchId) || !isId(d.planId)) return null;
  if (typeof d.stepIndex !== "number" || !Number.isInteger(d.stepIndex) || d.stepIndex < 0) return null;
  if (typeof d.capabilityId !== "string") return null;
  if (typeof d.deadlineMs !== "number" || !Number.isFinite(d.deadlineMs)) return null;
  const binding = validateTrustedBinding(d.binding);
  if (!binding) return null;
  return Object.freeze({
    dispatchId: d.dispatchId as string,
    planId: d.planId as string,
    stepIndex: d.stepIndex as number,
    capabilityId: d.capabilityId as string,
    rawArgs: d.args,
    binding,
    deadlineMs: d.deadlineMs as number,
  });
}

function bindingFieldsEqual(a: TrustedBinding, b: TrustedBinding): boolean {
  return a.sessionId === b.sessionId && a.turnId === b.turnId && a.generation === b.generation &&
    a.pageId === b.pageId && a.role === b.role && a.routeEpoch === b.routeEpoch &&
    a.contextRevision === b.contextRevision && a.authorityRef === b.authorityRef && a.contextDigest === b.contextDigest;
}
function resultAuthorityEqual(a: ResultAuthorityShape, b: ResultAuthorityShape): boolean {
  return a.turnId === b.turnId && a.generation === b.generation && a.routeEpoch === b.routeEpoch &&
    a.contextRevision === b.contextRevision && a.authorityRef === b.authorityRef && a.contextDigest === b.contextDigest;
}

// ═══════════════════════════ current-entity policy ═════════════════════════
function entityAllowed(meta: ExecutionCapabilityMetadata, args: Record<string, unknown>, ctx: ExecutionScreenContext): boolean {
  switch (meta.currentEntityPolicy) {
    case "CURRENT_RESULTS":
    case "CURRENT_HOTELS_PAGE":
      return ctx.binding.pageId === "hotels";
    case "CURRENT_VISIBLE_SET": {
      const positions = args.positions;
      if (!Array.isArray(positions) || positions.length < 2) return false;
      for (let i = 0; i < positions.length; i++) if (ctx.visiblePositions.indexOf(positions[i] as number) === -1) return false;
      return ctx.binding.pageId === "hotels";
    }
    case "SINGLE_CURRENT_VISIBLE": {
      const position = args.position;
      if (typeof position !== "number" || !Number.isInteger(position)) return false;
      let count = 0;
      for (let i = 0; i < ctx.visiblePositions.length; i++) if (ctx.visiblePositions[i] === position) count += 1;
      return ctx.binding.pageId === "hotels" && count === 1;
    }
    case "CURRENT_DETAIL_HOTEL":
      return ctx.binding.pageId === "hotel-detail" && typeof ctx.currentHotelId === "string" && ctx.currentHotelId.length > 0;
    case "CURRENT_DETAIL_SECTION": {
      if (ctx.binding.pageId !== "hotel-detail") return false;
      if (!(typeof ctx.currentHotelId === "string" && ctx.currentHotelId.length > 0)) return false;
      const section = args.section;
      if (section !== "rooms" && section !== "about") return false;
      return ctx.sections.indexOf(section) !== -1;
    }
    default:
      return false;
  }
}

// ═══════════════════════════ the execution-safety machine ══════════════════
interface Slot {
  admission: ExecutionAdmission;
  state: ExecutionLifecycleState;
  acceptedActionId: string | null;
}
export interface ExecutionSafety {
  /** Stage 1 — admit + reserve the single slot + trigger the provider-neutral adapter.
   *  Runs EVERY admission gate BEFORE any budget or adapter work. */
  admit(input: ExecutionProposalInput): AdmitOutcome;
  /** Stage 2 — an independently-delivered browser action.accepted event. */
  acceptAction(input: unknown): AcceptOutcome;
  /** Stage 3 — an independently-delivered terminal execution event (pre- or post-accept). */
  deliverTerminal(input: unknown): TerminalOutcome;
  /** Revoke the active execution (interrupt / barge-in / user cancel / unrelated route). */
  interrupt(reason?: string): { readonly ok: boolean };
  /** Deadline-driven revocation (uses the ONE monotonic clock). */
  expire(): { readonly ok: boolean };
  status(): { readonly lifecycleState: ExecutionLifecycleState; readonly dispatchId: string | null; readonly executionId: string | null; readonly replayLedgerSize: number };
}

export function createExecutionSafety(deps: ExecutionSafetyDeps): ExecutionSafety {
  const audit = deps.audit;
  let slot: Slot | null = null;
  let seq = 0;
  let lastMonotonic: number | null = null; // ONE monotonic time authority
  const consumed: Record<string, true> = Object.create(null);
  const consumedOrder: string[] = [];

  function emit(event: ExecutionAuditEvent, extra?: Partial<ExecutionAuditRecord>): void {
    try { audit.emit(Object.freeze({ event, ...(extra || {}) })); } catch { /* audit never affects control */ }
  }
  function refuse(reason: ExecutionReason, capabilityId?: string, dispatchId?: string): { ok: false; reason: ExecutionReason } {
    emit("execution_admission_refused", { reason, capabilityId, dispatchId });
    return { ok: false, reason };
  }
  // ONE monotonic sample per public transition. A backward sample fails closed.
  function sample(): number | null {
    let now: number;
    try { now = deps.clock.nowMonotonicMs(); } catch { return null; }
    if (typeof now !== "number" || !Number.isFinite(now) || now < 0) return null;
    if (lastMonotonic !== null && now < lastMonotonic) return null; // backward ⇒ fail closed
    lastMonotonic = lastMonotonic === null ? now : Math.max(lastMonotonic, now);
    return now;
  }
  function recordConsumed(dispatchId: string): void {
    if (consumed[dispatchId]) return;
    consumed[dispatchId] = true;
    consumedOrder.push(dispatchId);
    if (consumedOrder.length > EXECUTION_REPLAY_LEDGER_MAX) { const drop = consumedOrder.shift(); if (drop) delete consumed[drop]; }
  }
  function clearSlot(): void { slot = null; }

  // ── Stage 1 ──────────────────────────────────────────────────────────────
  function admit(input: ExecutionProposalInput): AdmitOutcome {
    try {
      const p = strictSnapshot(input, PROPOSAL_KEYS);
      if (!p) return refuse("EXECUTION_INVALID_REQUEST");
      const d = parseDispatch(p.dispatch);
      if (!d) return refuse("EXECUTION_INVALID_REQUEST");
      const meta = getExecutionMetadata(d.capabilityId);
      if (!meta) return refuse("EXECUTION_UNKNOWN_CAPABILITY", undefined, d.dispatchId);
      const normalizedArgs = validateCapabilityArgs(d.capabilityId, d.rawArgs);
      if (!normalizedArgs) return refuse("EXECUTION_INVALID_ARGS", d.capabilityId, d.dispatchId);
      emit("execution_proposed", { capabilityId: d.capabilityId, dispatchId: d.dispatchId });

      if (!isId(p.proposalId) || !isId(p.providerTurnId) || !isId(p.receiptId) || !isId(p.executionNonce)) return refuse("EXECUTION_INVALID_REQUEST", d.capabilityId, d.dispatchId);
      if (typeof p.turnDeadlineMs !== "number" || !Number.isFinite(p.turnDeadlineMs)) return refuse("EXECUTION_INVALID_REQUEST", d.capabilityId, d.dispatchId);

      // ONE monotonic time authority (not a caller-supplied nowMs).
      const now = sample();
      if (now === null) return refuse("EXECUTION_NON_MONOTONIC_TIME", d.capabilityId, d.dispatchId);

      // role / authority class
      const cap = getCapability(d.capabilityId)!;
      if (cap.allowedRoles.indexOf(d.binding.role) === -1) return refuse("EXECUTION_UNAUTHORIZED", d.capabilityId, d.dispatchId);
      if (cap.authorityClass !== "READ" && cap.authorityClass !== "UI_LOCAL") return refuse("EXECUTION_UNAUTHORIZED", d.capabilityId, d.dispatchId);
      if (d.binding.pageId !== meta.requiredPageId) return refuse("EXECUTION_WRONG_PAGE", d.capabilityId, d.dispatchId);
      if (cap.confirmationClass !== "NONE") return refuse("EXECUTION_CONFIRMATION_REQUIRED", d.capabilityId, d.dispatchId);

      // COMPLETE current trusted binding — compare EVERY field exactly (incl. contextDigest).
      const ctx = deps.contexts.current();
      if (!ctx || typeof ctx !== "object") return refuse("EXECUTION_STALE_CONTEXT", d.capabilityId, d.dispatchId);
      const ctxBinding = validateTrustedBinding(ctx.binding);
      if (!ctxBinding) return refuse("EXECUTION_STALE_CONTEXT", d.capabilityId, d.dispatchId);
      if (ctxBinding.routeEpoch !== d.binding.routeEpoch) return refuse("EXECUTION_STALE_ROUTE", d.capabilityId, d.dispatchId);
      if (!bindingFieldsEqual(ctxBinding, d.binding)) return refuse("EXECUTION_STALE_BINDING", d.capabilityId, d.dispatchId);
      if (ctx.ready !== true) return refuse("EXECUTION_STALE_CONTEXT", d.capabilityId, d.dispatchId);
      if (!entityAllowed(meta, normalizedArgs, ctx)) return refuse("EXECUTION_ENTITY_NOT_ALLOWED", d.capabilityId, d.dispatchId);

      // positive remaining monotonic deadline (min of turn deadline + dispatch ceiling)
      const deadlineMonotonicMs = Math.min(p.turnDeadlineMs as number, d.deadlineMs);
      if (!(deadlineMonotonicMs > now)) return refuse("EXECUTION_DEADLINE_EXCEEDED", d.capabilityId, d.dispatchId);

      // replay / idempotency (bounded) — a consumed dispatch is replay regardless of the loop phase.
      if (consumed[d.dispatchId]) { emit("execution_replay_refused", { capabilityId: d.capabilityId, dispatchId: d.dispatchId }); return { ok: false, reason: "EXECUTION_DISPATCH_REPLAY" }; }

      // CURRENT pending IC01 dispatch proof (a stale prior dispatch object never runs budget/adapter).
      let ls: { phase: string; planId: string | null; currentStepIndex: number | null; pendingDispatchId: string | null };
      try { ls = deps.loop.status(); } catch { return refuse("EXECUTION_NO_PENDING_DISPATCH", d.capabilityId, d.dispatchId); }
      if (!ls || ls.phase !== "AWAIT_OBSERVATION" || ls.pendingDispatchId !== d.dispatchId || ls.planId !== d.planId || ls.currentStepIndex !== d.stepIndex) {
        return refuse("EXECUTION_NO_PENDING_DISPATCH", d.capabilityId, d.dispatchId);
      }

      // concurrency lock (V1 = 1) — an ACTIVE slot blocks a second admission.
      if (slot && (slot.state === "ADMITTED" || slot.state === "DISPATCHED" || slot.state === "ACCEPTED" || slot.state === "AWAITING_TERMINAL")) {
        return refuse("EXECUTION_BUSY", d.capabilityId, d.dispatchId);
      }

      // mint controller-owned execution identity BEFORE budget (one-use — a refused budget
      // never reuses these ids because each admit call mints fresh ids and reserves nothing).
      seq += 1;
      const executionId = deps.mintId.mint("exec", seq);
      const attemptId = deps.mintId.mint("attempt", seq);
      if (!isId(executionId) || !isId(attemptId)) return refuse("EXECUTION_INVALID_REQUEST", d.capabilityId, d.dispatchId);

      // FULL canonical SHA-256 commitments (collision-resistant) over all frozen authority fields.
      const normalizedArgsDigest = sha256Hex(canonicalString(normalizedArgs));
      const source: ExecutionSourceBinding = Object.freeze({
        sessionId: d.binding.sessionId, turnId: d.binding.turnId, generation: d.binding.generation,
        pageId: d.binding.pageId, role: d.binding.role, routeEpoch: d.binding.routeEpoch,
        contextRevision: d.binding.contextRevision, authorityRef: d.binding.authorityRef, contextDigest: d.binding.contextDigest,
      });
      const requestDigest = sha256Hex(canonicalString({
        contractVersion: INTELLIGENCE_CONTRACT_VERSION,
        policyVersion: EXECUTION_POLICY_VERSION,
        dispatchId: d.dispatchId, executionId, attemptId, attemptNumber: 1,
        proposalId: p.proposalId, providerTurnId: p.providerTurnId, receiptId: p.receiptId, executionNonce: p.executionNonce,
        planId: d.planId, stepIndex: d.stepIndex, capabilityId: d.capabilityId,
        normalizedArgs, normalizedArgsDigest,
        source, issuedAtMonotonicMs: now, deadlineMonotonicMs,
      }));

      // budget admission — receives the ACTUAL executionId + FINAL requestDigest; fail closed on
      // absent / UNAVAILABLE / REFUSED / error; ADMITTED must return a controller-trusted ref.
      if (!deps.budgetGate) return refuse("EXECUTION_BUDGET_REFUSED", d.capabilityId, d.dispatchId);
      let budgetOut: ExecutionBudgetOutcome;
      try {
        budgetOut = deps.budgetGate.admit(Object.freeze({
          dispatchId: d.dispatchId, executionId, capabilityId: d.capabilityId,
          authorityClass: cap.authorityClass, requestDigest, issuedAtMonotonicMs: now, deadlineMonotonicMs,
        }));
      } catch { return refuse("EXECUTION_BUDGET_REFUSED", d.capabilityId, d.dispatchId); }
      if (!budgetOut || budgetOut.decision !== "ADMITTED" || !isId(budgetOut.budgetAdmissionRef)) return refuse("EXECUTION_BUDGET_REFUSED", d.capabilityId, d.dispatchId);

      const admission: ExecutionAdmission = Object.freeze({
        contractVersion: INTELLIGENCE_CONTRACT_VERSION,
        policyVersion: EXECUTION_POLICY_VERSION,
        dispatchId: d.dispatchId, executionId, attemptId, attemptNumber: 1,
        proposalId: p.proposalId as string, providerTurnId: p.providerTurnId as string,
        receiptId: p.receiptId as string, executionNonce: p.executionNonce as string,
        planId: d.planId, stepIndex: d.stepIndex, capabilityId: d.capabilityId,
        normalizedArgs, normalizedArgsDigest, requestDigest, source,
        issuedAtMonotonicMs: now, deadlineMonotonicMs,
        budgetAdmissionRef: budgetOut.budgetAdmissionRef as string,
        authorityClass: cap.authorityClass, evidenceKind: meta.resultSchemaId,
      });
      // ATOMIC reservation + replay stamp BEFORE any adapter exposure.
      slot = { admission, state: "ADMITTED", acceptedActionId: null };
      recordConsumed(d.dispatchId);
      emit("execution_admission_allowed", { capabilityId: d.capabilityId, dispatchId: d.dispatchId, executionId, requestDigest, lifecycleState: "ADMITTED" });

      // trigger the provider-neutral adapter (dormant default ⇒ zero execution).
      if (!deps.adapter) { clearSlot(); return refuse("EXECUTION_TRANSPORT_FAILURE", d.capabilityId, d.dispatchId); }
      const abort: ExecutionAbortSignal = Object.freeze({ aborted: false, reason: null });
      let ack: ExecutionDispatchAck | null;
      try { ack = deps.adapter.dispatch(Object.freeze({ admission }), abort); }
      catch { clearSlot(); return refuse("EXECUTION_TRANSPORT_FAILURE", d.capabilityId, d.dispatchId); }
      if (!ack || ack.dispatched !== true) { clearSlot(); return refuse("EXECUTION_TRANSPORT_FAILURE", d.capabilityId, d.dispatchId); }
      slot.state = "DISPATCHED";
      emit("execution_dispatched", { capabilityId: d.capabilityId, dispatchId: d.dispatchId, executionId, lifecycleState: "DISPATCHED" });
      return { ok: true, lifecycleState: "DISPATCHED", admission };
    } catch { clearSlot(); return refuse("EXECUTION_CAPABILITY_FAILURE"); }
  }

  // ── Stage 2 ──────────────────────────────────────────────────────────────
  function acceptAction(input: unknown): AcceptOutcome {
    try {
      if (!slot) return { ok: false, reason: "EXECUTION_LIFECYCLE_INVALID" };
      const s = slot;
      if (s.state === "INTERRUPTED") return { ok: false, reason: "EXECUTION_INTERRUPTED" };
      if (s.state === "EXPIRED") return { ok: false, reason: "EXECUTION_DEADLINE_EXCEEDED" };
      if (s.state !== "DISPATCHED" && s.state !== "ACCEPTED") return { ok: false, reason: "EXECUTION_LIFECYCLE_INVALID" };
      const raw = strictSnapshot(input, ["accepted"]);
      if (!raw) return { ok: false, reason: "EXECUTION_RESULT_MALFORMED" };
      const accepted = validateActionAccepted(raw.accepted);
      if (!accepted) return { ok: false, reason: "EXECUTION_RESULT_MALFORMED" };
      // exact correlation — actionId is the ONLY new (browser-owned) id.
      if (accepted.receiptId !== s.admission.receiptId || accepted.proposalId !== s.admission.proposalId ||
          accepted.providerTurnId !== s.admission.providerTurnId || accepted.executionNonce !== s.admission.executionNonce ||
          accepted.operation !== s.admission.capabilityId || accepted.authorityRef !== s.admission.source.authorityRef) {
        return { ok: false, reason: "EXECUTION_CAPABILITY_FAILURE" };
      }
      // exact-duplicate acceptance is inert (no second execution / authority grant).
      if (s.state === "ACCEPTED") {
        if (s.acceptedActionId === (accepted.actionId as string)) return { ok: true, lifecycleState: "ACCEPTED", loopEffectKind: "INERT" };
        return { ok: false, reason: "EXECUTION_LIFECYCLE_INVALID" }; // a different second acceptance
      }
      const now = sample();
      if (now === null) return { ok: false, reason: "EXECUTION_NON_MONOTONIC_TIME" };
      if (!(s.admission.deadlineMonotonicMs > now)) { s.state = "EXPIRED"; emit("execution_expired", { dispatchId: s.admission.dispatchId }); return { ok: false, reason: "EXECUTION_DEADLINE_EXCEEDED" }; }
      const eff = deps.loop.acknowledgeDispatch({
        dispatchId: s.admission.dispatchId,
        accepted: {
          receiptId: accepted.receiptId, proposalId: accepted.proposalId, providerTurnId: accepted.providerTurnId,
          actionId: accepted.actionId, executionNonce: accepted.executionNonce, operation: accepted.operation, authorityRef: accepted.authorityRef,
        },
        nowMs: now,
      });
      // ONLY the exact accepted/duplicate acknowledgement advances the lifecycle.
      if (eff.kind !== "INERT" || (eff.why !== "dispatch_acknowledged" && eff.why !== "already_acknowledged")) {
        return { ok: false, reason: "EXECUTION_CAPABILITY_FAILURE" };
      }
      s.state = "ACCEPTED";
      s.acceptedActionId = accepted.actionId as string;
      emit("execution_acknowledged", { dispatchId: s.admission.dispatchId, executionId: s.admission.executionId, lifecycleState: "ACCEPTED" });
      return { ok: true, lifecycleState: "ACCEPTED", loopEffectKind: eff.kind };
    } catch { return { ok: false, reason: "EXECUTION_CAPABILITY_FAILURE" }; }
  }

  // ── Stage 3 ──────────────────────────────────────────────────────────────
  function deliverTerminal(input: unknown): TerminalOutcome {
    try {
      if (!slot) return { ok: false, reason: "EXECUTION_LIFECYCLE_INVALID" };
      const s = slot;
      if (s.state === "INTERRUPTED") { emit("execution_late_result", { dispatchId: s.admission.dispatchId }); return { ok: false, reason: "EXECUTION_INTERRUPTED" }; }
      if (s.state === "EXPIRED") { emit("execution_late_result", { dispatchId: s.admission.dispatchId }); return { ok: false, reason: "EXECUTION_DEADLINE_EXCEEDED" }; }
      // AWAITING_TERMINAL is a post-accept, NON-terminal state reached by a prior PENDING (acted) event
      // (P1-03): a later TRUE terminal for the SAME execution is delivered from here.
      if (s.state !== "DISPATCHED" && s.state !== "ACCEPTED" && s.state !== "AWAITING_TERMINAL") return { ok: false, reason: "EXECUTION_LIFECYCLE_INVALID" };
      const postAccept = s.state === "ACCEPTED" || s.state === "AWAITING_TERMINAL";
      const raw = strictSnapshot(input, ["terminal"]);
      if (!raw) return { ok: false, reason: "EXECUTION_RESULT_MALFORMED" };
      const t = strictSnapshot(raw.terminal, ["receipt", "sourceAuthority", "resultAuthority", "ackCommitment"]);
      if (!t) return { ok: false, reason: "EXECUTION_RESULT_MALFORMED" };
      const receipt = validateActionReceipt(t.receipt);
      if (!receipt) return { ok: false, reason: "EXECUTION_RESULT_MALFORMED" };
      if (receipt.operation !== s.admission.capabilityId) return { ok: false, reason: "EXECUTION_RESULT_MALFORMED" };
      const sourceAuthority = validateResultAuthority(t.sourceAuthority);
      if (!sourceAuthority) return { ok: false, reason: "EXECUTION_RESULT_MALFORMED" };
      let resultAuthority: ResultAuthorityShape | null = null;
      if (t.resultAuthority !== undefined && t.resultAuthority !== null) {
        resultAuthority = validateResultAuthority(t.resultAuthority);
        if (!resultAuthority) return { ok: false, reason: "EXECUTION_RESULT_MALFORMED" };
      }
      const ackCommitment = t.ackCommitment;
      if (typeof ackCommitment !== "string" || !HEX64_RE.test(ackCommitment)) return { ok: false, reason: "EXECUTION_RESULT_MALFORMED" };

      // sourceAuthority MUST equal the admitted source binding on all shared authority fields.
      const src = s.admission.source;
      if (sourceAuthority.turnId !== src.turnId || sourceAuthority.generation !== src.generation ||
          sourceAuthority.routeEpoch !== src.routeEpoch || sourceAuthority.contextRevision !== src.contextRevision ||
          sourceAuthority.authorityRef !== src.authorityRef || sourceAuthority.contextDigest !== src.contextDigest) {
        return { ok: false, reason: "EXECUTION_RESULT_MALFORMED" };
      }
      // top-level vs receipt-committed resultAuthority MUST be coherent (both absent, or equal).
      const rRA = (receipt.resultAuthority as ResultAuthorityShape | undefined) ?? null;
      if (rRA === null) { if (resultAuthority !== null) return { ok: false, reason: "EXECUTION_RESULT_MALFORMED" }; }
      else { if (!resultAuthority || !resultAuthorityEqual(resultAuthority, rRA)) return { ok: false, reason: "EXECUTION_RESULT_MALFORMED" }; }

      const receiptOutcome = receipt.outcome as string;
      if (postAccept) {
        if (receipt.receiptId !== s.admission.receiptId || receipt.proposalId !== s.admission.proposalId ||
            receipt.providerTurnId !== s.admission.providerTurnId || receipt.actionId !== s.acceptedActionId ||
            receipt.executionNonce !== s.admission.executionNonce || receipt.authorityRef !== src.authorityRef) {
          return { ok: false, reason: "EXECUTION_CAPABILITY_FAILURE" };
        }
        if (ackCommitment !== terminalReceiptCommitment(receipt)) return { ok: false, reason: "EXECUTION_RESULT_MALFORMED" };
        if (receiptOutcome === "verified") {
          if (!evidenceMatchesOperation(receipt.operation as string, receipt.evidence as { kind?: unknown } | null)) return { ok: false, reason: "EXECUTION_RESULT_MALFORMED" };
          if (!receipt.resultAuthority) return { ok: false, reason: "EXECUTION_VERIFICATION_REQUIRED" };
        }
      } else {
        // PRE-ACCEPT — negative-only. VERIFIED / acted (pending) before acceptance is impossible.
        if (receiptOutcome === "verified") return { ok: false, reason: "EXECUTION_VERIFICATION_REQUIRED" };
        if (receiptOutcome === "acted") return { ok: false, reason: "EXECUTION_LIFECYCLE_INVALID" }; // pending is not a terminal
        if (receipt.receiptId !== s.admission.receiptId || receipt.proposalId !== s.admission.proposalId ||
            receipt.providerTurnId !== s.admission.providerTurnId || receipt.executionNonce !== s.admission.executionNonce ||
            receipt.authorityRef !== src.authorityRef) {
          return { ok: false, reason: "EXECUTION_CAPABILITY_FAILURE" };
        }
        const preAudit = { ...receipt, actionId: UNACCEPTED_ACTION_ID };
        if (ackCommitment !== terminalReceiptCommitment(preAudit)) return { ok: false, reason: "EXECUTION_RESULT_MALFORMED" };
      }
      // ── P1-03 — a post-accept PENDING (acted) event is NOT terminal ──
      // A post-accept `acted` receipt derives to PENDING_VERIFICATION (accepted/acted ≠ VERIFIED). It is
      // validated (correlation + gateway ACK, above) and handed to the accepted IC01 loop, which acknowledges
      // it WITHOUT resolving the step (INERT pending_verification_acknowledged) — the loop stays awaiting the
      // SAME dispatch's TRUE terminal. 03A therefore keeps the SAME execution ALIVE: it does NOT mark the
      // lifecycle terminal-validated / completed, does NOT clear the active slot, does NOT consume the
      // execution identity, does NOT emit terminal-completion audit semantics, and does NOT free the
      // concurrency slot. A later correctly-correlated TRUE terminal is delivered from AWAITING_TERMINAL.
      // 03A creates NO ResultState authority here — the pending vs terminal distinction is read purely from
      // the R5B receipt outcome. (Pre-accept `acted` was already refused above as a non-terminal.)
      if (postAccept && receiptOutcome === "acted") {
        const nowP = sample();
        if (nowP === null) return { ok: false, reason: "EXECUTION_NON_MONOTONIC_TIME" };
        if (!(s.admission.deadlineMonotonicMs > nowP)) { s.state = "EXPIRED"; emit("execution_expired", { dispatchId: s.admission.dispatchId, lifecycleState: "EXPIRED" }); return { ok: false, reason: "EXECUTION_DEADLINE_EXCEEDED" }; }
        seq += 1;
        const pObsId = deps.mintId.mint("obs", seq);
        if (!isId(pObsId)) return { ok: false, reason: "EXECUTION_INVALID_REQUEST" };
        const pObs = {
          observationId: pObsId,
          dispatchId: s.admission.dispatchId,
          sessionId: s.admission.source.sessionId,
          turnId: s.admission.source.turnId,
          generation: s.admission.source.generation,
          planId: s.admission.planId,
          stepIndex: s.admission.stepIndex,
          capabilityId: s.admission.capabilityId,
          receipt,
          sourceAuthority,
          resultAuthority,
          ackCommitment,
        };
        const pEff = deps.loop.submitObservation({ observation: pObs, nowMs: nowP });
        // A PENDING event MUST be acknowledged by IC01 as a non-terminal pending (or a duplicate of one);
        // any other IC01 effect is an inconsistent pending event → fail closed WITHOUT clearing the still-live
        // execution (a bad pending delivery never revokes a legitimate awaiting-terminal execution).
        const pendingAck = pEff.kind === "INERT" && (pEff.why === "pending_verification_acknowledged" || pEff.why === "duplicate_observation");
        if (!pendingAck) return { ok: false, reason: "EXECUTION_RESULT_MALFORMED" };
        s.state = "AWAITING_TERMINAL";
        // NOT a terminal-completion audit event (that is execution_verification_handoff, never emitted here).
        emit("execution_result_received", { dispatchId: s.admission.dispatchId, executionId: s.admission.executionId, lifecycleState: "AWAITING_TERMINAL" });
        return { ok: true, lifecycleState: "AWAITING_TERMINAL", loopEffectKind: pEff.kind, verificationHandoff: false };
      }

      s.state = "TERMINAL_VALIDATED";
      emit("execution_result_received", { dispatchId: s.admission.dispatchId, executionId: s.admission.executionId, lifecycleState: "TERMINAL_VALIDATED" });

      // ── IC01 HAND-OFF ──
      const now = sample();
      if (now === null) return { ok: false, reason: "EXECUTION_NON_MONOTONIC_TIME" };
      if (!(s.admission.deadlineMonotonicMs > now)) { s.state = "EXPIRED"; emit("execution_expired", { dispatchId: s.admission.dispatchId }); return { ok: false, reason: "EXECUTION_DEADLINE_EXCEEDED" }; }
      seq += 1;
      const observationId = deps.mintId.mint("obs", seq);
      if (!isId(observationId)) return { ok: false, reason: "EXECUTION_INVALID_REQUEST" };
      const observation = {
        observationId,
        dispatchId: s.admission.dispatchId,
        sessionId: s.admission.source.sessionId,
        turnId: s.admission.source.turnId,
        generation: s.admission.source.generation,
        planId: s.admission.planId,
        stepIndex: s.admission.stepIndex,
        capabilityId: s.admission.capabilityId,
        receipt,
        sourceAuthority,
        resultAuthority,
        ackCommitment,
      };
      const eff = deps.loop.submitObservation({ observation, nowMs: now });
      // Only an IC01 transition that ACCEPTED the handoff counts as a successful verification handoff.
      const acceptedHandoff =
        eff.kind === "REBIND_REQUIRED" || eff.kind === "CAPABILITY_DISPATCH" ||
        eff.kind === "TERMINAL" || eff.kind === "MODEL_REQUEST" ||
        (eff.kind === "INERT" && (eff.why === "pending_verification_acknowledged" || eff.why === "duplicate_observation"));
      if (!acceptedHandoff) {
        s.state = "TERMINAL_REJECTED";
        emit("execution_terminal_rejected", { dispatchId: s.admission.dispatchId, lifecycleState: "TERMINAL_REJECTED" });
        clearSlot();
        return { ok: false, reason: "EXECUTION_RESULT_MALFORMED" };
      }
      s.state = postAccept ? "IC01_HANDOFF" : "PRE_ACCEPT_TERMINAL";
      const finalState = s.state;
      emit("execution_verification_handoff", { dispatchId: s.admission.dispatchId, executionId: s.admission.executionId, lifecycleState: finalState });
      clearSlot();
      const verificationHandoff = eff.kind === "TERMINAL" || eff.kind === "REBIND_REQUIRED" || eff.kind === "CAPABILITY_DISPATCH";
      return { ok: true, lifecycleState: finalState, loopEffectKind: eff.kind, verificationHandoff };
    } catch { return { ok: false, reason: "EXECUTION_CAPABILITY_FAILURE" }; }
  }

  function interrupt(_reason?: string): { readonly ok: boolean } {
    if (slot && (slot.state === "ADMITTED" || slot.state === "DISPATCHED" || slot.state === "ACCEPTED" || slot.state === "AWAITING_TERMINAL")) {
      slot.state = "INTERRUPTED";
      emit("execution_interrupted", { dispatchId: slot.admission.dispatchId, lifecycleState: "INTERRUPTED" });
      return { ok: true };
    }
    return { ok: false };
  }
  function expire(): { readonly ok: boolean } {
    if (!slot) return { ok: false };
    if (slot.state !== "ADMITTED" && slot.state !== "DISPATCHED" && slot.state !== "ACCEPTED" && slot.state !== "AWAITING_TERMINAL") return { ok: false };
    let now: number;
    try { now = deps.clock.nowMonotonicMs(); } catch { return { ok: false }; }
    // a backward sample never revives; only a real at/after-deadline sample expires.
    if (typeof now === "number" && Number.isFinite(now) && now >= slot.admission.deadlineMonotonicMs) {
      if (lastMonotonic === null || now >= lastMonotonic) lastMonotonic = now;
      slot.state = "EXPIRED";
      emit("execution_expired", { dispatchId: slot.admission.dispatchId, lifecycleState: "EXPIRED" });
      return { ok: true };
    }
    return { ok: false };
  }
  function status(): { readonly lifecycleState: ExecutionLifecycleState; readonly dispatchId: string | null; readonly executionId: string | null; readonly replayLedgerSize: number } {
    return Object.freeze({
      lifecycleState: slot ? slot.state : "IDLE",
      dispatchId: slot ? slot.admission.dispatchId : null,
      executionId: slot ? slot.admission.executionId : null,
      replayLedgerSize: consumedOrder.length,
    });
  }

  return Object.freeze({ admit, acceptAction, deliverTerminal, interrupt, expire, status });
}
