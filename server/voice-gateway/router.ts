// ─────────────────────────────────────────────────────────────────────────
// StayBid Voice AI — VOICE-AI-SB-05-01 (R1) — DORMANT adaptive-router FOUNDATION.
//
// A server-owned, hybrid-DETERMINISTIC routing/policy layer that decides which
// reasoning tier should answer a logical turn:
//   TIER 0  DETERMINISTIC      — local draft / refusal boundary (writes/txn)
//   TIER 1  MINI               — the ordinary answer path
//   TIER 1  CLARIFY_WITH_MINI  — Mini asks one clarifying question
//   TIER 2  FULL_ADVICE        — advice-ONLY escalation (bounded, vetoed)
//   terminal REFUSE_OR_FALLBACK
//
// ARCHITECTURE INVARIANT — MODEL != AUTHORITY. This module is routing/policy
// STATE only. Tier 2 gains NO tools, NO HTTP, NO DB, NO UI actions, NO write /
// transactional authority. It composes WITH the frozen SB-04 executor/turn/cost
// protections — it never re-implements or weakens them.
//
// DORMANT: this file performs NO provider request, opens NO socket, reads NO
// key, and calls NO network. Every external-model behaviour is an INJECTED
// interface (see reasoning-adapter.ts); the default adapter is fail-closed.
//
// R1 remediation (SB05-01-SRC-REV-01..10):
//   01 explicit ACTIVE-turn ownership — turnId 0 / guessed / invalid ids are
//      never authoritative; an escalation is impossible before beginTurn().
//   02 lifecycle GENERATION/epoch — terminate() invalidates the active turn,
//      bumps the generation, and marks retained in-flight records terminal
//      BEFORE clearing storage; every async boundary re-checks ownership.
//   03 a GENUINE bounded timeout (FULL_ADVICE_TIMEOUT_MS) via an injected
//      timer; a never-settling adapter settles once, terminal, inert-late.
//   04 a duplicate escalation id is AUTHORITY-inert (never FULL_ADVICE/advice).
//   05 bounded escalation-id bytes + per-session record cap (no unbounded map;
//      no eviction that revives replay).
//   06 authoritative cost via the injected gate (snapshot()+tryReserve()); a
//      caller-supplied spend is never trusted; malformed money fails closed.
//   07 an unavailable adapter reserves 0 / counts 0 / debts 0 / invokes 0.
//   08 a closed, case-insensitive URL/scheme/host/ip/method/SQL/tool detector.
//   09 telemetry closed value-domains + a keyed HMAC escalation-id hash.
//   10 (tests) real adversarial effect-level coverage of all of the above.
// ─────────────────────────────────────────────────────────────────────────
import { createHash, createHmac } from "node:crypto";
import type { FullAdviceAdapter } from "./reasoning-adapter";

// ── tier / decision / reason vocabulary ──────────────────────────────────────
export type RouterTier = "TIER0" | "TIER1" | "TIER2" | "TERMINAL";

export type RouterDecision =
  | "DETERMINISTIC"
  | "MINI"
  | "CLARIFY_WITH_MINI"
  | "FULL_ADVICE"
  | "REFUSE_OR_FALLBACK";
export const ROUTER_DECISIONS: ReadonlyArray<RouterDecision> = Object.freeze([
  "DETERMINISTIC",
  "MINI",
  "CLARIFY_WITH_MINI",
  "FULL_ADVICE",
  "REFUSE_OR_FALLBACK",
]);
export const ROUTER_TIERS: ReadonlyArray<RouterTier> = Object.freeze(["TIER0", "TIER1", "TIER2", "TERMINAL"]);

/** Every reason a routing/escalation decision can carry (closed set). */
export type RouterReasonCode =
  // ordinary / clarify / transactional
  | "ordinary"
  | "missing_info"
  | "ambiguous"
  | "transactional_write"
  // escalation candidate reasons
  | "complex_comparison"
  | "repeated_correction"
  | "repeated_misunderstanding"
  | "failed_intent_resolution"
  | "tool_validation_rejections"
  // vetoes / fallbacks (escalation eligibility overridden)
  | "veto_headroom"
  | "veto_soft_stop"
  | "veto_turn_cap"
  | "veto_session_cap"
  | "veto_consecutive_full"
  // turn / lifecycle guards
  | "no_active_turn"
  | "invalid_turn_id"
  | "session_terminated"
  // escalation-ownership outcomes
  | "escalation_duplicate_inert"
  | "escalation_conflict"
  | "escalation_stale"
  | "escalation_cancelled"
  | "escalation_id_invalid"
  | "record_bound_exhausted"
  | "adapter_unavailable"
  | "adapter_failed"
  | "adapter_timeout"
  | "timer_unavailable"
  | "timer_error"
  | "advice_invalid"
  | "cost_unavailable"
  | "reservation_denied";
export const ROUTER_REASON_CODES: ReadonlyArray<RouterReasonCode> = Object.freeze([
  "ordinary",
  "missing_info",
  "ambiguous",
  "transactional_write",
  "complex_comparison",
  "repeated_correction",
  "repeated_misunderstanding",
  "failed_intent_resolution",
  "tool_validation_rejections",
  "veto_headroom",
  "veto_soft_stop",
  "veto_turn_cap",
  "veto_session_cap",
  "veto_consecutive_full",
  "no_active_turn",
  "invalid_turn_id",
  "session_terminated",
  "escalation_duplicate_inert",
  "escalation_conflict",
  "escalation_stale",
  "escalation_cancelled",
  "escalation_id_invalid",
  "record_bound_exhausted",
  "adapter_unavailable",
  "adapter_failed",
  "adapter_timeout",
  "timer_unavailable",
  "timer_error",
  "advice_invalid",
  "cost_unavailable",
  "reservation_denied",
]);

/** The signals the deterministic router evaluates for ONE logical turn. */
export interface RouterSignal {
  kind: "search" | "compare" | "transactional" | "clarify_needed" | "advice_request" | "other";
  /** utterance length is a WEAK signal — never sufficient for FULL_ADVICE alone. */
  utteranceBytes: number;
  language: "en" | "hi" | "hinglish" | "other";
  /** language choice / switch is NEVER sufficient for FULL_ADVICE alone. */
  languageSwitched: boolean;
  /** a model claiming "this is hard" is NEVER sufficient alone. */
  modelSelfReport: boolean;
  missingRequiredInfo: boolean;
  ambiguousDestination: boolean;
  /** transactional/write request (bid/booking/payment) — deterministic boundary. */
  transactionalWrite: boolean;
  // proven-complexity inputs
  hotelCount: number;
  materialConstraintCount: number;
  explicitTradeoffNeed: boolean;
  // correction / failure inputs
  correctionCount: number;
  consecutiveClarifyRejects: number;
  relatedFailureCount: number;
  toolValidationRejectsThisTurn: number;
}
export const LANGUAGE_BUCKETS: ReadonlyArray<RouterSignal["language"]> = Object.freeze(["en", "hi", "hinglish", "other"]);

// ── escalation limits + cost definitions (SB-05-01 SOFT/ROUTING controls) ─────
// These are ADDITIONAL soft controls layered on top of — and never replacing —
// the frozen SB-04 HARD caps (125¢/session, 2500¢/day, 25000¢/month, enforced
// in rate-limit.ts). This module only READS the hard ceiling; it never alters it.
export const ROUTER_POLICY_VERSION = "sb05-01-router-foundation-r1";

export const MAX_FULL_ESCALATIONS_PER_TURN = 1;
export const MAX_FULL_ESCALATIONS_PER_SESSION = 2;
export const MAX_CONSECUTIVE_FULL_TURNS = 1;
/** Below this remaining HARD-session headroom (¢), a Tier-2 escalation is vetoed. */
export const TIER2_MIN_REMAINING_HARD_HEADROOM_CENTS = 15;
/** At/above this session spend (¢), escalation softly stops (Mini still answers). */
export const SOFT_SESSION_STOP_CENTS = 50;

// Conservative reservation definitions (¢) — representable BEFORE billable work.
export const MINI_RESPONSE_CENTS = 2;
export const READ_TOOL_CENTS = 1;
export const TIER2_ADVICE_CENTS = 5;
/** Accounting FOUNDATION ONLY — transcription is NOT wired/activated in SB-05-01. */
export const INPUT_TRANSCRIPTION_RESERVE_CENTS = 3;

// R1-03 genuine bounded Tier-2 advice timeout.
export const FULL_ADVICE_TIMEOUT_MS = 2500;
// R1-05 bounded escalation-id + per-session replay/ownership records.
export const MAX_ESCALATION_ID_BYTES = 128;
export const MAX_ESCALATION_RECORDS_PER_SESSION = 32;
const ESCALATION_ID_RE = /^[A-Za-z0-9_.:-]{1,128}$/;
// R1-09 keyed telemetry hash — minimum injected-key strength.
export const MIN_HMAC_KEY_BYTES = 32;
// sane monetary bounds (¢) for the authoritative cost snapshot.
const MAX_SANE_CENTS = 10_000_000;

// ── injected dependencies ────────────────────────────────────────────────────
/**
 * The AUTHORITATIVE cost gate (R1-06). Cost state ORIGINATES here — the router
 * never trusts a caller-supplied spend. `snapshot()` returns the current spend +
 * hard ceiling; `tryReserve(cents)` is an atomic check-and-reserve whose contract
 * is: reserve iff it does not breach the hard cap, returning whether it reserved.
 * A later SB-04 ledger composition supplies a real implementation; SB-05-01 ships
 * only the interface + injected fakes.
 */
export interface CostSnapshot {
  sessionSpentCents: number;
  hardSessionCeilingCents: number;
}
export interface RouterCostGate {
  snapshot(): CostSnapshot;
  /** Atomic check-and-reserve. Returns true iff `cents` was reserved. */
  tryReserve(cents: number): boolean;
}

/** An injected, cancellable deadline (R1-03). Default = setTimeout/clearTimeout. */
export interface RouterTimer {
  promise: Promise<void>;
  cancel(): void;
}
export type TimerFactory = (ms: number) => RouterTimer;

function realTimer(ms: number): RouterTimer {
  let handle: ReturnType<typeof setTimeout>;
  const promise = new Promise<void>((res) => {
    handle = setTimeout(res, ms);
  });
  return { promise, cancel: () => clearTimeout(handle) };
}

export interface RouterDeps {
  now: () => number;
  costGate: RouterCostGate;
  /** Injected advice provider — default MUST be fail-closed (see reasoning-adapter). */
  adapter: FullAdviceAdapter;
  /** HMAC key for the pseudonymous escalation-id telemetry hash (≥32 UTF-8 bytes). */
  escalationHmacKey: string;
  /** Injected deadline factory (default: setTimeout). */
  timer?: TimerFactory;
}

// ── deterministic classification (pure) ──────────────────────────────────────
export interface Classification {
  decision: RouterDecision;
  reasonCode: RouterReasonCode;
  tier: RouterTier;
  /** true only when a Tier-2 escalation is CANDIDATE-eligible (pre-veto). */
  escalationEligible: boolean;
}

const tierFor = (d: RouterDecision): RouterTier => {
  switch (d) {
    case "DETERMINISTIC":
      return "TIER0";
    case "MINI":
    case "CLARIFY_WITH_MINI":
      return "TIER1";
    case "FULL_ADVICE":
      return "TIER2";
    case "REFUSE_OR_FALLBACK":
      return "TERMINAL";
  }
};

/**
 * Pure deterministic classifier. Order matters:
 *   1. a transactional/write request never escalates (deterministic boundary);
 *   2. missing info / ambiguity → clarify FIRST (never escalate for missing data);
 *   3. a PROVEN complexity/correction/failure trigger → Tier-2 CANDIDATE;
 *   4. otherwise → Mini.
 * Length, language, language-switch, and model self-report are IGNORED as
 * escalation triggers by construction (they never appear in the eligibility set).
 */
export function classify(signal: RouterSignal): Classification {
  const mk = (decision: RouterDecision, reasonCode: RouterReasonCode, escalationEligible = false): Classification => ({
    decision,
    reasonCode,
    tier: tierFor(decision),
    escalationEligible,
  });

  if (signal.transactionalWrite || signal.kind === "transactional") {
    return mk("DETERMINISTIC", "transactional_write");
  }
  if (signal.missingRequiredInfo) return mk("CLARIFY_WITH_MINI", "missing_info");
  if (signal.ambiguousDestination) return mk("CLARIFY_WITH_MINI", "ambiguous");

  const provenComplexCompare =
    signal.hotelCount >= 3 && signal.materialConstraintCount >= 3 && signal.explicitTradeoffNeed === true;
  if (provenComplexCompare) return mk("FULL_ADVICE", "complex_comparison", true);
  if (signal.correctionCount >= 2) return mk("FULL_ADVICE", "repeated_correction", true);
  if (signal.consecutiveClarifyRejects >= 2) return mk("FULL_ADVICE", "repeated_misunderstanding", true);
  if (signal.relatedFailureCount >= 2) return mk("FULL_ADVICE", "failed_intent_resolution", true);
  if (signal.toolValidationRejectsThisTurn >= 2) return mk("FULL_ADVICE", "tool_validation_rejections", true);

  return mk("MINI", "ordinary");
}

// ── authoritative cost read + veto layer (pure) ──────────────────────────────
export interface ValidatedCost {
  ok: boolean;
  sessionSpentCents: number;
  hardSessionCeilingCents: number;
}
function saneCents(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && Number.isInteger(n) && n >= 0 && n <= MAX_SANE_CENTS;
}
/** Read + runtime-validate the authoritative cost snapshot. Malformed ⇒ fail closed. */
export function readCost(gate: RouterCostGate): ValidatedCost {
  let snap: CostSnapshot;
  try {
    snap = gate.snapshot();
  } catch {
    return { ok: false, sessionSpentCents: 0, hardSessionCeilingCents: 0 };
  }
  if (!snap || typeof snap !== "object") return { ok: false, sessionSpentCents: 0, hardSessionCeilingCents: 0 };
  const spent = snap.sessionSpentCents;
  const ceil = snap.hardSessionCeilingCents;
  if (!saneCents(spent)) return { ok: false, sessionSpentCents: 0, hardSessionCeilingCents: 0 };
  if (!saneCents(ceil) || ceil <= 0) return { ok: false, sessionSpentCents: 0, hardSessionCeilingCents: 0 };
  return { ok: true, sessionSpentCents: spent, hardSessionCeilingCents: ceil };
}

export interface VetoInputs {
  sessionSpentCents: number;
  hardSessionCeilingCents: number;
  escalationsThisTurn: number;
  escalationsThisSession: number;
  consecutiveFullTurns: number;
}
export type VetoResult = { vetoed: false } | { vetoed: true; reasonCode: RouterReasonCode };

/** True when the remaining HARD-session headroom is below the Tier-2 minimum. */
export function headroomVetoes(sessionSpentCents: number, hardSessionCeilingCents: number): boolean {
  return hardSessionCeilingCents - sessionSpentCents < TIER2_MIN_REMAINING_HARD_HEADROOM_CENTS;
}

/** Rule 13: a veto ALWAYS overrides escalation eligibility. Order = strongest first. */
export function evaluateVeto(v: VetoInputs): VetoResult {
  if (headroomVetoes(v.sessionSpentCents, v.hardSessionCeilingCents)) return { vetoed: true, reasonCode: "veto_headroom" };
  if (v.sessionSpentCents >= SOFT_SESSION_STOP_CENTS) return { vetoed: true, reasonCode: "veto_soft_stop" };
  if (v.escalationsThisTurn >= MAX_FULL_ESCALATIONS_PER_TURN) return { vetoed: true, reasonCode: "veto_turn_cap" };
  if (v.escalationsThisSession >= MAX_FULL_ESCALATIONS_PER_SESSION)
    return { vetoed: true, reasonCode: "veto_session_cap" };
  if (v.consecutiveFullTurns >= MAX_CONSECUTIVE_FULL_TURNS)
    return { vetoed: true, reasonCode: "veto_consecutive_full" };
  return { vetoed: false };
}

// ── closed / bounded RouterContext validator ──────────────────────────────────
export const CONTEXT_BOUNDS = Object.freeze({
  maxUtteranceBytes: 2000,
  maxRecentTextBytes: 6000,
  maxRecentTurns: 4,
  maxVisibleHotelIds: 10,
  maxHotelFacts: 3,
  maxHotelIdLen: 64,
});
const HOTEL_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const CONTEXT_ALLOWED_KEYS = Object.freeze(["currentUtterance", "recentText", "recentTurns", "visibleHotelIds", "hotelFacts"]);
const HOTEL_FACT_ALLOWED_KEYS = Object.freeze(["id", "priceBucket", "ratingBucket", "distanceBucket", "amenityCount"]);

export interface HotelFact {
  id: string;
  priceBucket?: number;
  ratingBucket?: number;
  distanceBucket?: number;
  amenityCount?: number;
}
export interface RouterContext {
  currentUtterance: string;
  recentText: string;
  recentTurns: string[];
  visibleHotelIds: string[];
  hotelFacts: HotelFact[];
}
export type ContextValidation = { ok: true; value: RouterContext } | { ok: false; reason: string };

function bytes(s: string): number {
  return Buffer.byteLength(s, "utf8");
}
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function onlyAllowedKeys(obj: Record<string, unknown>, allowed: ReadonlyArray<string>): boolean {
  for (const k of Object.keys(obj)) if (!allowed.includes(k)) return false;
  return true;
}
function boundedInt(v: unknown, min: number, max: number): boolean {
  return typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
}

/** Validate an UNTRUSTED RouterContext into a closed, bounded value. */
export function validateRouterContext(input: unknown): ContextValidation {
  if (!isPlainObject(input)) return { ok: false, reason: "context_not_object" };
  if (!onlyAllowedKeys(input, CONTEXT_ALLOWED_KEYS)) return { ok: false, reason: "context_unknown_field" };

  const cu = input.currentUtterance;
  if (typeof cu !== "string") return { ok: false, reason: "utterance_type" };
  if (bytes(cu) > CONTEXT_BOUNDS.maxUtteranceBytes) return { ok: false, reason: "utterance_oversize" };

  const rt = input.recentText ?? "";
  if (typeof rt !== "string") return { ok: false, reason: "recent_text_type" };
  if (bytes(rt) > CONTEXT_BOUNDS.maxRecentTextBytes) return { ok: false, reason: "recent_text_oversize" };

  const turnsRaw = input.recentTurns ?? [];
  if (!Array.isArray(turnsRaw)) return { ok: false, reason: "recent_turns_type" };
  if (turnsRaw.length > CONTEXT_BOUNDS.maxRecentTurns) return { ok: false, reason: "recent_turns_overcount" };
  let turnsBytes = 0;
  for (const t of turnsRaw) {
    if (typeof t !== "string") return { ok: false, reason: "recent_turn_type" };
    turnsBytes += bytes(t);
  }
  if (turnsBytes > CONTEXT_BOUNDS.maxRecentTextBytes) return { ok: false, reason: "recent_turns_oversize" };

  const idsRaw = input.visibleHotelIds ?? [];
  if (!Array.isArray(idsRaw)) return { ok: false, reason: "hotel_ids_type" };
  if (idsRaw.length > CONTEXT_BOUNDS.maxVisibleHotelIds) return { ok: false, reason: "hotel_ids_overcount" };
  const ids: string[] = [];
  for (const id of idsRaw) {
    if (typeof id !== "string" || !HOTEL_ID_RE.test(id)) return { ok: false, reason: "hotel_id_malformed" };
    ids.push(id);
  }
  const idSet = new Set(ids);

  const factsRaw = input.hotelFacts ?? [];
  if (!Array.isArray(factsRaw)) return { ok: false, reason: "hotel_facts_type" };
  if (factsRaw.length > CONTEXT_BOUNDS.maxHotelFacts) return { ok: false, reason: "hotel_facts_overcount" };
  const facts: HotelFact[] = [];
  for (const f of factsRaw) {
    if (!isPlainObject(f)) return { ok: false, reason: "hotel_fact_type" };
    if (!onlyAllowedKeys(f, HOTEL_FACT_ALLOWED_KEYS)) return { ok: false, reason: "hotel_fact_unknown_field" };
    if (typeof f.id !== "string" || !idSet.has(f.id)) return { ok: false, reason: "hotel_fact_foreign_id" };
    const fact: HotelFact = { id: f.id };
    for (const [k, mn, mx] of [
      ["priceBucket", 0, 20],
      ["ratingBucket", 0, 5],
      ["distanceBucket", 0, 20],
      ["amenityCount", 0, 50],
    ] as const) {
      if (f[k] !== undefined) {
        if (!boundedInt(f[k], mn, mx)) return { ok: false, reason: `hotel_fact_${k}_bounds` };
        (fact as unknown as Record<string, unknown>)[k] = f[k];
      }
    }
    facts.push(fact);
  }

  return {
    ok: true,
    value: {
      currentUtterance: cu,
      recentText: rt,
      recentTurns: turnsRaw as string[],
      visibleHotelIds: ids,
      hotelFacts: facts,
    },
  };
}

// ── closed ReasoningAdvice validator (DATA only — executes nothing) ───────────
export const ADVICE_STATUSES = Object.freeze(["advise", "clarify", "unable"] as const);
export type AdviceStatus = (typeof ADVICE_STATUSES)[number];
export const COMPARISON_FACTORS = Object.freeze([
  "price",
  "location",
  "rating",
  "amenities",
  "distance",
  "cancellation",
  "meal_plan",
  "capacity",
] as const);
export type ComparisonFactor = (typeof COMPARISON_FACTORS)[number];
// ARCH-01: a CLOSED clarification-need enum replaces the old free-text clarification
// question. There is NO "other"/fallback string — a missing datum is named by type.
export const CLARIFICATION_NEEDS = Object.freeze([
  "destination",
  "date_range",
  "guest_count",
  "budget",
  "required_amenity",
  "comparison_priority",
  "hotel_selection",
] as const);
export type ClarificationNeed = (typeof CLARIFICATION_NEEDS)[number];
// ARCH-01: a CLOSED per-signal assessment enum replaces free-text explanation prose.
export const EXPLANATION_ASSESSMENTS = Object.freeze([
  "advantage",
  "tradeoff",
  "neutral",
  "insufficient_data",
] as const);
export type ExplanationAssessment = (typeof EXPLANATION_ASSESSMENTS)[number];
export const ADVICE_BOUNDS = Object.freeze({
  maxSelectedHotelIds: 3,
  maxComparisonFactors: 8,
  maxExplanationSignals: 8,
  maxHotelIdBytes: 64,
});
const ADVICE_ALLOWED_KEYS = Object.freeze(["status", "selectedHotelIds", "comparisonFactors", "clarificationNeed", "explanationSignals"]);
const SIGNAL_ALLOWED_KEYS = Object.freeze(["hotelId", "comparisonFactor", "assessment"]);

// ARCH-01: Tier-2 / FULL_ADVICE now returns CLOSED TYPED SEMANTIC DATA ONLY. There is
// NO free-text field anywhere in ReasoningAdvice — every string is an exact enum member
// or an allowlisted hotel id. An arbitrary executable-looking string (SQL / URL / host /
// HTTP / tool name / markup) is STRUCTURALLY UNREPRESENTABLE: it can only appear where a
// closed enum or the current hotel allowlist rejects it. This removes the entire
// free-text-classification problem (there is nothing to classify). MODEL != AUTHORITY:
// this is inert DATA — it grants no tool / HTTP / network / SQL / DB / booking / bid /
// payment / refund / wallet / message / UI / routing authority, and no field can carry
// a URL, route, HTTP method, SQL, tool command, or display prose.
export interface ExplanationSignal {
  hotelId: string;
  comparisonFactor: ComparisonFactor;
  assessment: ExplanationAssessment;
}
export interface ReasoningAdvice {
  status: AdviceStatus;
  selectedHotelIds: string[];
  comparisonFactors: ComparisonFactor[];
  clarificationNeed?: ClarificationNeed;
  explanationSignals: ExplanationSignal[];
}
export type AdviceValidation = { ok: true; value: ReasoningAdvice } | { ok: false; reason: string };

// Hotel-ID shape: a bounded CUID-safe ASCII token, <=64 bytes. The AUTHORITATIVE gate is
// membership in the server-established allowlist (`allowedHotelIds`); this is a bounded
// structural sanity check so a non-string / oversized / malformed id fails closed BEFORE
// the allowlist check. ASCII-only charset ⇒ byte length == char length; the explicit
// byte check documents the ≤64-byte contract.
function isValidHotelIdShape(id: unknown): id is string {
  return typeof id === "string" && HOTEL_ID_RE.test(id) && Buffer.byteLength(id, "utf8") <= ADVICE_BOUNDS.maxHotelIdBytes;
}

// ARCH-01 — the entire free-text advice-classification layer is REMOVED. There is no
// longer any authoritative Tier-2 prose to classify, so the URL/host detector, the
// HTTP-syntax detector, the SQL detector, the tool-command detector, the markup/control
// detector, and the aggregate `looksUnsafeText` classifier are all GONE (no replacement
// classifier, no regex, no NLP, no dependency). Safety is now STRUCTURAL: a malicious
// string is unrepresentable because every advice string is an exact enum member or an
// allowlisted hotel id. The validator below constructs a fresh, closed, typed object and
// never forwards the untrusted provider object.

/** Validate UNTRUSTED (possibly fake-adapter) advice into a closed, typed value. */
export function validateReasoningAdvice(input: unknown, allowedHotelIds: ReadonlyArray<string>): AdviceValidation {
  if (!isPlainObject(input)) return { ok: false, reason: "advice_not_object" };
  if (!onlyAllowedKeys(input, ADVICE_ALLOWED_KEYS)) return { ok: false, reason: "advice_unknown_field" };

  // status — required, exact enum.
  const status = input.status;
  if (typeof status !== "string" || !(ADVICE_STATUSES as ReadonlyArray<string>).includes(status))
    return { ok: false, reason: "advice_status_invalid" };

  const allow = new Set(allowedHotelIds);

  // selectedHotelIds — required array; <=3; unique; valid shape; allowlisted. Missing
  // (undefined) fails closed — arrays are NEVER silently defaulted.
  const selRaw = input.selectedHotelIds;
  if (!Array.isArray(selRaw)) return { ok: false, reason: "selected_missing_or_type" };
  if (selRaw.length > ADVICE_BOUNDS.maxSelectedHotelIds) return { ok: false, reason: "selected_overcount" };
  const selectedSet = new Set<string>();
  const selectedHotelIds: string[] = [];
  for (const id of selRaw) {
    if (!isValidHotelIdShape(id)) return { ok: false, reason: "selected_id_shape" };
    if (!allow.has(id)) return { ok: false, reason: "selected_foreign_id" };
    if (selectedSet.has(id)) return { ok: false, reason: "selected_duplicate" };
    selectedSet.add(id);
    selectedHotelIds.push(id);
  }

  // comparisonFactors — required array; <=8; unique; exact enum.
  const facRaw = input.comparisonFactors;
  if (!Array.isArray(facRaw)) return { ok: false, reason: "factors_missing_or_type" };
  if (facRaw.length > ADVICE_BOUNDS.maxComparisonFactors) return { ok: false, reason: "factors_overcount" };
  const factorSet = new Set<string>();
  const comparisonFactors: ComparisonFactor[] = [];
  for (const f of facRaw) {
    if (typeof f !== "string" || !(COMPARISON_FACTORS as ReadonlyArray<string>).includes(f))
      return { ok: false, reason: "factor_invalid" };
    if (factorSet.has(f)) return { ok: false, reason: "factor_duplicate" };
    factorSet.add(f);
    comparisonFactors.push(f as ComparisonFactor);
  }

  // clarificationNeed — OPTIONAL; exact enum when present (no free text, no fallback).
  let clarificationNeed: ClarificationNeed | undefined;
  if (input.clarificationNeed !== undefined) {
    const c = input.clarificationNeed;
    if (typeof c !== "string" || !(CLARIFICATION_NEEDS as ReadonlyArray<string>).includes(c))
      return { ok: false, reason: "clarification_need_invalid" };
    clarificationNeed = c as ClarificationNeed;
  }

  // explanationSignals — required array; <=8; each a typed object referencing a SELECTED
  // hotel and a ROOT comparison factor; the (hotelId, comparisonFactor) pair is unique.
  const sigRaw = input.explanationSignals;
  if (!Array.isArray(sigRaw)) return { ok: false, reason: "signals_missing_or_type" };
  if (sigRaw.length > ADVICE_BOUNDS.maxExplanationSignals) return { ok: false, reason: "signals_overcount" };
  const pairSet = new Set<string>();
  const explanationSignals: ExplanationSignal[] = [];
  for (const sig of sigRaw) {
    if (!isPlainObject(sig)) return { ok: false, reason: "signal_not_object" };
    if (!onlyAllowedKeys(sig, SIGNAL_ALLOWED_KEYS)) return { ok: false, reason: "signal_unknown_field" };
    const hotelId = sig.hotelId;
    const comparisonFactor = sig.comparisonFactor;
    const assessment = sig.assessment;
    if (!isValidHotelIdShape(hotelId)) return { ok: false, reason: "signal_hotel_shape" };
    if (!allow.has(hotelId)) return { ok: false, reason: "signal_hotel_foreign" };
    if (!selectedSet.has(hotelId)) return { ok: false, reason: "signal_hotel_not_selected" };
    if (typeof comparisonFactor !== "string" || !(COMPARISON_FACTORS as ReadonlyArray<string>).includes(comparisonFactor))
      return { ok: false, reason: "signal_factor_invalid" };
    if (!factorSet.has(comparisonFactor)) return { ok: false, reason: "signal_factor_not_in_root" };
    if (typeof assessment !== "string" || !(EXPLANATION_ASSESSMENTS as ReadonlyArray<string>).includes(assessment))
      return { ok: false, reason: "signal_assessment_invalid" };
    const pairKey = hotelId + " " + comparisonFactor;
    if (pairSet.has(pairKey)) return { ok: false, reason: "signal_duplicate_pair" };
    pairSet.add(pairKey);
    explanationSignals.push({
      hotelId,
      comparisonFactor: comparisonFactor as ComparisonFactor,
      assessment: assessment as ExplanationAssessment,
    });
  }

  // status consistency — no contradictory normalized advice.
  if (status === "advise") {
    if (clarificationNeed !== undefined) return { ok: false, reason: "advise_clarification_present" };
    if (selectedHotelIds.length < 1) return { ok: false, reason: "advise_no_selected" };
    if (comparisonFactors.length < 1) return { ok: false, reason: "advise_no_factors" };
    if (explanationSignals.length < 1) return { ok: false, reason: "advise_no_signals" };
  } else if (status === "clarify") {
    if (clarificationNeed === undefined) return { ok: false, reason: "clarify_need_required" };
    if (explanationSignals.length > 0) return { ok: false, reason: "clarify_signals_present" };
  } else {
    // status === "unable"
    if (clarificationNeed !== undefined) return { ok: false, reason: "unable_clarification_present" };
    if (selectedHotelIds.length > 0) return { ok: false, reason: "unable_selected_present" };
    if (comparisonFactors.length > 0) return { ok: false, reason: "unable_factors_present" };
    if (explanationSignals.length > 0) return { ok: false, reason: "unable_signals_present" };
  }

  // Fresh normalized object — never the untrusted provider object.
  const value: ReasoningAdvice = { status: status as AdviceStatus, selectedHotelIds, comparisonFactors, explanationSignals };
  if (clarificationNeed !== undefined) value.clarificationNeed = clarificationNeed;
  return { ok: true, value };
}

// ── redacted router telemetry (closed value-domain projection) ────────────────
export const COST_BUCKETS = Object.freeze(["high", "mid", "low", "vetoed"]);
export interface RouterTelemetryEvent {
  router_decision?: string;
  router_tier?: string;
  escalation_reason_code?: string;
  escalation_id_hash?: string;
  mini_attempted?: boolean;
  full_attempted?: boolean;
  full_validated?: boolean;
  fallback_reason?: string;
  language_bucket?: string;
  estimated_cost_bucket?: string;
  reserved_cost_cents?: number;
  actual_cost_cents?: number;
  routing_latency_bucket?: string;
  full_latency_bucket?: string;
  tool_count?: number;
  correction_count?: number;
  prior_failure_count?: number;
  remaining_cost_bucket?: string;
  stale_count?: number;
  duplicate_count?: number;
}
const LATENCY_BUCKETS = Object.freeze(["fast", "mid", "slow", "timeout"]);
type FieldRule =
  | { kind: "enum"; domain: ReadonlyArray<string> }
  | { kind: "bool" }
  | { kind: "uint"; max: number };
const TELEMETRY_FIELD_RULES: Readonly<Record<keyof RouterTelemetryEvent, FieldRule>> = Object.freeze({
  router_decision: { kind: "enum", domain: ROUTER_DECISIONS },
  router_tier: { kind: "enum", domain: ROUTER_TIERS },
  escalation_reason_code: { kind: "enum", domain: ROUTER_REASON_CODES },
  escalation_id_hash: { kind: "enum", domain: [] }, // special-cased (24-hex) below
  mini_attempted: { kind: "bool" },
  full_attempted: { kind: "bool" },
  full_validated: { kind: "bool" },
  fallback_reason: { kind: "enum", domain: ROUTER_REASON_CODES },
  language_bucket: { kind: "enum", domain: LANGUAGE_BUCKETS },
  estimated_cost_bucket: { kind: "enum", domain: COST_BUCKETS },
  reserved_cost_cents: { kind: "uint", max: MAX_SANE_CENTS },
  actual_cost_cents: { kind: "uint", max: MAX_SANE_CENTS },
  routing_latency_bucket: { kind: "enum", domain: LATENCY_BUCKETS },
  full_latency_bucket: { kind: "enum", domain: LATENCY_BUCKETS },
  tool_count: { kind: "uint", max: 1000 },
  correction_count: { kind: "uint", max: 1000 },
  prior_failure_count: { kind: "uint", max: 1000 },
  remaining_cost_bucket: { kind: "enum", domain: COST_BUCKETS },
  stale_count: { kind: "uint", max: 1_000_000 },
  duplicate_count: { kind: "uint", max: 1_000_000 },
});
const HASH_RE = /^[0-9a-f]{24}$/;

/** True iff the injected HMAC key meets the minimum strength. */
export function isValidHmacKey(key: unknown): key is string {
  return typeof key === "string" && Buffer.byteLength(key, "utf8") >= MIN_HMAC_KEY_BYTES;
}
/**
 * Pseudonymous, non-reversible, KEYED escalation identifier for telemetry
 * (R1-09). Fails CLOSED on a weak/empty key (throws) — the raw id is never
 * emitted, and the key is never logged.
 */
export function hmacEscalationId(escalationId: string, key: string): string {
  if (!isValidHmacKey(key)) throw new Error("router_hmac_key_invalid");
  return createHmac("sha256", key).update(String(escalationId)).digest("hex").slice(0, 24);
}

/**
 * Project a router telemetry event to ONLY the allowlisted keys, each validated
 * against a CLOSED value-domain (R1-09). Unknown keys are dropped; a value that
 * violates its field's domain is dropped (never emitted). A raw transcript /
 * token / IP / provider string placed under an allowlisted string key cannot
 * survive, because every string field is a closed enum (or the 24-hex hash).
 */
export function projectRouterTelemetry(ev: RouterTelemetryEvent): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(TELEMETRY_FIELD_RULES) as Array<keyof RouterTelemetryEvent>) {
    const v = (ev as unknown as Record<string, unknown>)[key as string];
    if (v == null) continue;
    if (key === "escalation_id_hash") {
      if (typeof v === "string" && HASH_RE.test(v)) out[key] = v;
      continue;
    }
    const rule = TELEMETRY_FIELD_RULES[key];
    if (rule.kind === "bool") {
      if (typeof v === "boolean") out[key] = v;
    } else if (rule.kind === "uint") {
      if (typeof v === "number" && Number.isFinite(v) && Number.isInteger(v) && v >= 0 && v <= rule.max) out[key] = v;
    } else {
      if (typeof v === "string" && rule.domain.includes(v)) out[key] = v;
    }
  }
  return out;
}

// ── per-session router (owns all mutable state; no module singleton) ──────────
type EscalationState = "reserved" | "resolved_advise" | "resolved_fallback" | "cancelled";
interface EscalationRecord {
  escalationId: string;
  routerTurnId: number;
  generation: number;
  signature: string;
  state: EscalationState;
  decision: RouterDecision;
  reasonCode: RouterReasonCode;
  /** exactly-one terminal settlement guard. */
  settled: boolean;
}

export interface EscalationOutcome {
  decision: RouterDecision;
  reasonCode: RouterReasonCode;
  tier: RouterTier;
  escalationId: string;
  routerTurnId: number;
  adapterInvoked: boolean;
  advice?: ReasoningAdvice;
  duplicate?: boolean;
  reservedCents?: number;
}

/** Deterministic signature of a signal so a replay with a different intent conflicts. */
export function signalSignature(signal: RouterSignal): string {
  const norm = {
    k: signal.kind,
    hc: signal.hotelCount,
    mc: signal.materialConstraintCount,
    to: signal.explicitTradeoffNeed,
    cc: signal.correctionCount,
    cr: signal.consecutiveClarifyRejects,
    rf: signal.relatedFailureCount,
    tr: signal.toolValidationRejectsThisTurn,
    tx: signal.transactionalWrite,
    mi: signal.missingRequiredInfo,
    am: signal.ambiguousDestination,
  };
  return createHash("sha256").update(JSON.stringify(norm)).digest("hex").slice(0, 32);
}

function validEscalationId(id: unknown): id is string {
  // ESCALATION_ID_RE plus an explicit "no disallowed char ANYWHERE" guard — the
  // latter closes the JS `$`-matches-before-a-trailing-\n quirk so an id with a
  // trailing newline/control char can never slip through.
  return (
    typeof id === "string" &&
    id.length > 0 &&
    Buffer.byteLength(id, "utf8") <= MAX_ESCALATION_ID_BYTES &&
    ESCALATION_ID_RE.test(id) &&
    !/[^A-Za-z0-9_.:-]/.test(id)
  );
}

export function createRouterSession(deps: RouterDeps) {
  if (!isValidHmacKey(deps.escalationHmacKey)) throw new Error("router_hmac_key_invalid");
  const timerFactory: TimerFactory = deps.timer || realTimer;

  // lifecycle ownership
  let generation = 1;
  let currentTurnId = 0;
  let hasActiveTurn = false;
  let terminated = false;

  // escalation counters
  let escalationsThisSession = 0;
  let escalationsThisTurn = 0;
  let consecutiveFullTurns = 0;
  let turnBecameFull = false;
  let duplicateCount = 0;
  let staleCount = 0;

  const escalations = new Map<string, EscalationRecord>();
  let lastTrace: string[] = [];

  function beginTurn(): number {
    if (terminated) throw new Error("router_session_terminated");
    consecutiveFullTurns = turnBecameFull ? consecutiveFullTurns : 0;
    currentTurnId += 1;
    hasActiveTurn = true;
    escalationsThisTurn = 0;
    turnBecameFull = false;
    return currentTurnId;
  }

  /** Settle a record's terminal state exactly once. Returns true iff this call settled it. */
  function settle(rec: EscalationRecord, state: EscalationState, decision: RouterDecision): boolean {
    if (rec.settled) return false;
    rec.settled = true;
    rec.state = state;
    rec.decision = decision;
    return true;
  }

  function activeTurnValid(routerTurnId: unknown): boolean {
    return (
      !terminated &&
      hasActiveTurn &&
      typeof routerTurnId === "number" &&
      Number.isInteger(routerTurnId) &&
      routerTurnId > 0 &&
      routerTurnId === currentTurnId
    );
  }

  function route(signal: RouterSignal): Classification & { vetoed: boolean } {
    const c = classify(signal);
    if (!c.escalationEligible) return { ...c, vetoed: false };
    const cost = readCost(deps.costGate);
    if (!cost.ok) return { decision: "MINI", reasonCode: "cost_unavailable", tier: "TIER1", escalationEligible: false, vetoed: true };
    const veto = evaluateVeto({
      sessionSpentCents: cost.sessionSpentCents,
      hardSessionCeilingCents: cost.hardSessionCeilingCents,
      escalationsThisTurn,
      escalationsThisSession,
      consecutiveFullTurns,
    });
    if (veto.vetoed) return { decision: "MINI", reasonCode: veto.reasonCode, tier: "TIER1", escalationEligible: false, vetoed: true };
    return { ...c, vetoed: false };
  }

  async function proposeEscalation(params: {
    routerTurnId: number;
    escalationId: string;
    signal: RouterSignal;
    context: unknown;
  }): Promise<EscalationOutcome> {
    lastTrace = [];
    const { routerTurnId, escalationId, signal, context } = params;

    const mk = (decision: RouterDecision, reasonCode: RouterReasonCode, extra: Partial<EscalationOutcome> = {}): EscalationOutcome => ({
      decision,
      reasonCode,
      tier: tierFor(decision),
      escalationId: typeof escalationId === "string" ? escalationId : "",
      routerTurnId: typeof routerTurnId === "number" ? routerTurnId : -1,
      adapterInvoked: false,
      ...extra,
    });

    // R1-01/02: lifecycle + active-turn ownership BEFORE anything is consumed.
    if (terminated) return mk("REFUSE_OR_FALLBACK", "session_terminated");
    if (!hasActiveTurn) return mk("REFUSE_OR_FALLBACK", "no_active_turn");
    if (typeof routerTurnId !== "number" || !Number.isInteger(routerTurnId) || routerTurnId <= 0)
      return mk("REFUSE_OR_FALLBACK", "invalid_turn_id");
    if (!activeTurnValid(routerTurnId)) {
      staleCount += 1;
      return mk("REFUSE_OR_FALLBACK", "escalation_stale");
    }

    // R1-05: escalation-id shape/byte bound BEFORE any state is touched.
    if (!validEscalationId(escalationId)) return mk("REFUSE_OR_FALLBACK", "escalation_id_invalid");

    const capturedGen = generation;
    const sig = signalSignature(signal);

    // R1-04: duplicate → AUTHORITY-inert (never FULL_ADVICE/advice); conflict → fail-safe.
    const prior = escalations.get(escalationId);
    if (prior) {
      if (prior.signature === sig && prior.routerTurnId === routerTurnId) {
        duplicateCount += 1;
        return mk("REFUSE_OR_FALLBACK", "escalation_duplicate_inert", { duplicate: true });
      }
      return mk("REFUSE_OR_FALLBACK", "escalation_conflict");
    }

    // R1-05: a NEW unique id when the fixed record bound is saturated fails closed
    // (never evict an existing tombstone — that would revive replay protection gaps).
    if (escalations.size >= MAX_ESCALATION_RECORDS_PER_SESSION) return mk("REFUSE_OR_FALLBACK", "record_bound_exhausted");

    // deterministic eligibility (never trust the caller's word).
    const c = classify(signal);
    if (!c.escalationEligible) return mk(c.decision, c.reasonCode);

    // R1-06: authoritative cost snapshot + veto (nothing consumed on a veto).
    const cost = readCost(deps.costGate);
    if (!cost.ok) return mk("MINI", "cost_unavailable");
    const veto = evaluateVeto({
      sessionSpentCents: cost.sessionSpentCents,
      hardSessionCeilingCents: cost.hardSessionCeilingCents,
      escalationsThisTurn,
      escalationsThisSession,
      consecutiveFullTurns,
    });
    if (veto.vetoed) return mk("MINI", veto.reasonCode);

    // closed context BEFORE any billable work / registration.
    const ctx = validateRouterContext(context);
    if (!ctx.ok) return mk("REFUSE_OR_FALLBACK", "advice_invalid");

    // ── R1: authoritative accept-once registration FIRST.
    lastTrace.push("register");
    const record: EscalationRecord = {
      escalationId,
      routerTurnId,
      generation: capturedGen,
      signature: sig,
      state: "reserved",
      decision: "FULL_ADVICE",
      reasonCode: c.reasonCode,
      settled: false,
    };
    escalations.set(escalationId, record);

    // R1-07: a KNOWN-unavailable adapter reserves 0 / counts 0 / debts 0 / invokes 0.
    if (!deps.adapter.available) {
      settle(record, "resolved_fallback", "REFUSE_OR_FALLBACK");
      return mk("REFUSE_OR_FALLBACK", "adapter_unavailable", { reservedCents: 0 });
    }

    // atomic reservation (R1-06 / R2 R1-REV-02) BEFORE count/debt/adapter.
    // Exception-safe: a throwing gate fails CLOSED; the result MUST be strictly
    // `true` — a truthy non-true value (1, "yes", {}) never authorizes.
    let reserved = false;
    try {
      reserved = deps.costGate.tryReserve(TIER2_ADVICE_CENTS) === true;
    } catch {
      reserved = false;
    }
    if (!reserved) {
      settle(record, "resolved_fallback", "REFUSE_OR_FALLBACK");
      return mk("REFUSE_OR_FALLBACK", "reservation_denied", { reservedCents: 0 });
    }
    lastTrace.push("reserve");

    lastTrace.push("count");
    escalationsThisTurn += 1;
    escalationsThisSession += 1;
    if (!turnBecameFull) {
      turnBecameFull = true;
      consecutiveFullTurns += 1;
    }
    lastTrace.push("debt");

    // ── R1-03 / R2 (R1-REV-01): adapter raced against a GENUINE bounded timeout,
    // with the timer factory/promise/cancel treated as UNTRUSTED. A factory throw,
    // a malformed timer object, or a rejecting timer promise fails CLOSED, terminally,
    // exactly once; cancel is always wrapped so a throwing cancel cannot break settlement.
    let timer: RouterTimer | null = null;
    try {
      timer = timerFactory(FULL_ADVICE_TIMEOUT_MS);
    } catch {
      timer = null;
    }
    if (!timer || typeof timer.promise?.then !== "function" || typeof timer.cancel !== "function") {
      settle(record, "resolved_fallback", "REFUSE_OR_FALLBACK");
      return mk("REFUSE_OR_FALLBACK", "timer_unavailable", { adapterInvoked: false, reservedCents: TIER2_ADVICE_CENTS });
    }
    const safeCancel = (t: RouterTimer): void => {
      try {
        t.cancel();
      } catch {
        /* a throwing cancel must never affect settlement */
      }
    };

    lastTrace.push("adapter");
    let raced:
      | { type: "adapter"; advice: unknown }
      | { type: "adapter_err" }
      | { type: "timeout" }
      | { type: "timer_error" };
    try {
      raced = await Promise.race([
        deps.adapter
          .getAdvice(ctx.value)
          .then((r) => (r && r.ok === true ? ({ type: "adapter", advice: r.advice } as const) : ({ type: "adapter_err" } as const)))
          .catch(() => ({ type: "adapter_err" } as const)),
        timer.promise.then(() => ({ type: "timeout" } as const)).catch(() => ({ type: "timer_error" } as const)),
      ]);
    } catch {
      raced = { type: "timer_error" };
    }

    // ── post-async ownership re-check (R1-02): a terminate/cancel/new-turn/gen
    //    change makes ANY late completion inert. Exactly one terminal settlement.
    if (record.settled) {
      // already settled by cancel/terminate — return its inert terminal form.
      safeCancel(timer);
      const reason: RouterReasonCode = record.reasonCode === "escalation_cancelled" ? "escalation_cancelled" : "session_terminated";
      return mk("REFUSE_OR_FALLBACK", reason, { adapterInvoked: true, reservedCents: TIER2_ADVICE_CENTS });
    }
    if (terminated || record.generation !== generation) {
      safeCancel(timer);
      settle(record, "resolved_fallback", "REFUSE_OR_FALLBACK");
      return mk("REFUSE_OR_FALLBACK", "session_terminated", { adapterInvoked: true, reservedCents: TIER2_ADVICE_CENTS });
    }
    if (record.state === "cancelled") {
      safeCancel(timer);
      settle(record, "resolved_fallback", "REFUSE_OR_FALLBACK");
      return mk("REFUSE_OR_FALLBACK", "escalation_cancelled", { adapterInvoked: true, reservedCents: TIER2_ADVICE_CENTS });
    }
    if (routerTurnId !== currentTurnId) {
      safeCancel(timer);
      staleCount += 1;
      settle(record, "resolved_fallback", "REFUSE_OR_FALLBACK");
      return mk("REFUSE_OR_FALLBACK", "escalation_stale", { adapterInvoked: true, reservedCents: TIER2_ADVICE_CENTS });
    }

    if (raced.type === "timeout") {
      settle(record, "resolved_fallback", "REFUSE_OR_FALLBACK");
      return mk("REFUSE_OR_FALLBACK", "adapter_timeout", { adapterInvoked: true, reservedCents: TIER2_ADVICE_CENTS });
    }
    if (raced.type === "timer_error") {
      settle(record, "resolved_fallback", "REFUSE_OR_FALLBACK");
      return mk("REFUSE_OR_FALLBACK", "timer_error", { adapterInvoked: true, reservedCents: TIER2_ADVICE_CENTS });
    }
    safeCancel(timer);
    if (raced.type === "adapter_err") {
      settle(record, "resolved_fallback", "REFUSE_OR_FALLBACK");
      return mk("REFUSE_OR_FALLBACK", "adapter_failed", { adapterInvoked: true, reservedCents: TIER2_ADVICE_CENTS });
    }

    const validated = validateReasoningAdvice(raced.advice, ctx.value.visibleHotelIds);
    if (!validated.ok) {
      settle(record, "resolved_fallback", "REFUSE_OR_FALLBACK");
      return mk("REFUSE_OR_FALLBACK", "advice_invalid", { adapterInvoked: true, reservedCents: TIER2_ADVICE_CENTS });
    }

    settle(record, "resolved_advise", "FULL_ADVICE");
    return mk("FULL_ADVICE", c.reasonCode, { adapterInvoked: true, advice: validated.value, reservedCents: TIER2_ADVICE_CENTS });
  }

  /** Cancel an in-flight/owned escalation (idempotent; terminal thereafter). */
  function cancelEscalation(escalationId: string): boolean {
    const rec = escalations.get(escalationId);
    if (!rec) return false;
    if (!rec.settled && rec.state === "reserved") {
      rec.state = "cancelled";
      rec.reasonCode = "escalation_cancelled";
      return true;
    }
    return false;
  }

  function terminate(): void {
    terminated = true;
    hasActiveTurn = false;
    generation += 1; // invalidate every in-flight generation capture
    // mark retained in-flight records terminal BEFORE clearing storage (a closure
    // holding an old record still observes it is no longer authoritative).
    escalations.forEach((rec) => {
      if (!rec.settled) {
        rec.settled = true;
        rec.state = "resolved_fallback";
        rec.decision = "REFUSE_OR_FALLBACK";
        rec.reasonCode = "session_terminated";
      }
    });
    escalations.clear();
    lastTrace = [];
  }

  function snapshot() {
    return {
      generation,
      currentTurnId,
      hasActiveTurn,
      escalationsThisTurn,
      escalationsThisSession,
      consecutiveFullTurns,
      duplicateCount,
      staleCount,
      escalationRecords: escalations.size,
      terminated,
    };
  }

  function telemetryFor(outcome: EscalationOutcome, signal: RouterSignal): Record<string, unknown> {
    const cost = readCost(deps.costGate);
    const remaining = cost.ok ? cost.hardSessionCeilingCents - cost.sessionSpentCents : 0;
    const remBucket =
      !cost.ok || remaining < TIER2_MIN_REMAINING_HARD_HEADROOM_CENTS ? "vetoed" : remaining >= 75 ? "high" : remaining >= 25 ? "mid" : "low";
    let hash: string | undefined;
    try {
      hash = hmacEscalationId(outcome.escalationId, deps.escalationHmacKey);
    } catch {
      hash = undefined; // fail closed — no hash rather than a raw id
    }
    return projectRouterTelemetry({
      router_decision: outcome.decision,
      router_tier: outcome.tier,
      escalation_reason_code: outcome.reasonCode,
      escalation_id_hash: hash,
      mini_attempted: outcome.decision === "MINI" || outcome.decision === "CLARIFY_WITH_MINI",
      full_attempted: outcome.adapterInvoked || outcome.decision === "FULL_ADVICE",
      full_validated: outcome.decision === "FULL_ADVICE" && !!outcome.advice,
      fallback_reason: outcome.decision === "REFUSE_OR_FALLBACK" ? outcome.reasonCode : undefined,
      language_bucket: signal.language,
      reserved_cost_cents: outcome.reservedCents,
      tool_count: signal.toolValidationRejectsThisTurn,
      correction_count: signal.correctionCount,
      prior_failure_count: signal.relatedFailureCount,
      remaining_cost_bucket: remBucket,
      stale_count: staleCount,
      duplicate_count: duplicateCount,
    });
  }

  return {
    beginTurn,
    route,
    proposeEscalation,
    cancelEscalation,
    terminate,
    snapshot,
    telemetryFor,
    lastEscalationTrace: () => lastTrace.slice(),
  };
}

export type RouterSession = ReturnType<typeof createRouterSession>;
