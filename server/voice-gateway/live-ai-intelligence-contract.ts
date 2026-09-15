// ─────────────────────────────────────────────────────────────────────────
// StayBid Live AI — INTELLIGENCE-CONTRACT-01 — the canonical CLOSED
// intelligence contract `staybid-intelligence.v1`.
//
// PURE + DORMANT + PROVIDER-NEUTRAL. This module performs ZERO network,
// provider, DB, Supabase, or environment access; it defines the closed
// vocabularies, hard limits, and STRICT TOTAL validators (reject — never
// normalize) for the bounded agent turn. It imports ONLY the accepted
// sibling schema module (live-ai-schemas) and reuses its accepted
// primitives + the accepted R5B receipt/authority validators; it NEVER
// forks a looser copy of any accepted rule.
//
// AUTHORITY MODEL (LOCKED): the MODEL is INTELLIGENCE, never AUTHORITY.
// The model can NEVER mint or override controller-owned identities
// (sessionId / turnId / generation / pageId / role / routeEpoch /
// contextRevision / authorityRef / contextDigest / planId / stepId /
// dispatchId / proposalId / receiptId / observationId / nonce). Every
// validator here enforces that by EXACT-KEY strict records: an extra,
// unknown, hostile, accessor, symbol, inherited, or proxy-trapped field
// fails the WHOLE value closed.
//
// REMEDIATION-01 (REV-01..05) — the five accepted Work findings:
//   REV-01  A terminal RESPOND is a STRUCTURED response plan: a FACT claim
//           must be grounded in a prior CAPABILITY step that verified with
//           trusted evidence THIS turn (`groundedInStep`); the model can
//           never mint a trusted evidence handle, and free-form prewritten
//           text can never assert a fact/completion. accepted/acted/NO_OP/
//           UNKNOWN/FAILED/REJECTED/STALE never ground a fact.
//   REV-02  A trusted observation carries + the loop REQUIRES the exact
//           accepted R5B receipt correlation (validateActionReceipt) bound
//           to the exact controller dispatch, plus source/result authority.
//           The result state is DERIVED from the R5B outcome/status — the
//           model/controller never supplies a bare `resultState`.
//   REV-03  MODEL_REQUEST carries a strict, immutable, provider-neutral,
//           16-KiB-bounded IntelligenceInputSnapshot built ONLY from
//           trusted controller context + verified evidence refs.
//   REV-04  (loop) one monotonic time authority + absolute >= deadline +
//           expire(nowMs) + one bounded fallback.
//   REV-05  (loop) any authoritative advancement invalidates ALL remaining
//           old steps — the terminal response included.
// ─────────────────────────────────────────────────────────────────────────

import {
  strictRecord,
  isId,
  isEpoch,
  boundedText,
  isContextRevision,
  isLanguage,
  validateModelOperation,
  validatePublishedContext,
  validateActionReceipt,
  validateResultAuthority,
  evidenceMatchesOperation,
  contextDigest,
  MAX_TEXT_TURN_BYTES,
  MAX_VISIBLE_HOTELS,
  MAX_SELECTED_HOTELS,
  MAX_EVIDENCE_RECEIPTS,
  MAX_FRAME_BYTES,
} from "./live-ai-schemas";
import type { LiveAiLanguage, OperationName, ResultAuthorityShape } from "./live-ai-schemas";

// ── contract identity ────────────────────────────────────────────────────
export const INTELLIGENCE_CONTRACT_VERSION = "staybid-intelligence.v1";

// ── closed vocabularies (Customer V1 — additions require a new packet) ───
export const INTELLIGENCE_INTENTS = Object.freeze([
  "REFINE_RESULTS",
  "READ_RESULTS",
  "COMPARE_RESULTS",
  "OPEN_VISIBLE_HOTEL",
  "READ_HOTEL_FACTS",
  "SHOW_HOTEL_SECTION",
  "ADVISE_VISIBLE_HOTELS",
  "CLARIFY",
  "UNSUPPORTED",
] as const);
export type IntelligenceIntent = (typeof INTELLIGENCE_INTENTS)[number];

export const CLARIFY_REASONS = Object.freeze([
  "MISSING_DESTINATION",
  "MISSING_SELECTION",
  "AMBIGUOUS_REFERENCE",
  "NO_SUPPORTED_CONTEXT",
  "TRANSACTIONAL_NOT_ENABLED",
  "OUT_OF_SCOPE",
] as const);
export type ClarifyReason = (typeof CLARIFY_REASONS)[number];

// REMEDIATION-01 FINAL (IC01-CLOSE-01) — the CLOSED escalation-reason vocabulary. ESCALATE_TO_HUMAN
// is a SUGGESTION only (no side-effect authority); the model picks a bounded reason and StayBid
// DETERMINISTICALLY renders a safe "a StayBid person can help" sentence (renderEscalation). There is
// deliberately NO reason that asserts a booking / payment / refund / bid / message COMPLETION — a
// factual completion can never be smuggled through an escalation any more than through a fact / advice.
export const ESCALATION_REASONS = Object.freeze([
  "TRANSACTIONAL_REQUEST",     // the ask needs a real transaction the assistant cannot perform here
  "REPEATED_MISUNDERSTANDING", // could not understand the request after clarifying
  "COMPLAINT_OR_DISPUTE",      // a complaint / dispute is better handled by a person
  "OUT_OF_SCOPE_REQUEST",      // beyond what the assistant handles on this surface
] as const);
export type EscalationReason = (typeof ESCALATION_REASONS)[number];

export const PLAN_STEP_KINDS = Object.freeze([
  "CAPABILITY",
  "RESPOND",
  "CLARIFY",
  "ESCALATE_TO_HUMAN",
] as const);
export type PlanStepKind = (typeof PLAN_STEP_KINDS)[number];
// The three TERMINAL step kinds — a valid plan carries EXACTLY ONE, LAST.
export const TERMINAL_STEP_KINDS = Object.freeze(["RESPOND", "CLARIFY", "ESCALATE_TO_HUMAN"] as const);

// A response CLAIM class. A `fact` asserts something true about the world /
// the result of an action and MUST be grounded in trusted verified evidence
// (a prior CAPABILITY step that verified this turn). `advice` is presentation /
// suggestion intent — never a factual/completion assertion — and carries NO
// evidence reference.
export const RESPONSE_CLAIM_KINDS = Object.freeze(["fact", "advice"] as const);
export type ResponseClaimKind = (typeof RESPONSE_CLAIM_KINDS)[number];

// REMEDIATION-01 CORRECTION-01 (REV-01 residual) — a FACT is NOT free-form model
// text. It is a CLOSED semantic answer descriptor whose human text is DERIVED
// deterministically from trusted verified evidence (renderFactAnswer), never a
// sentence the model invented. The closed set covers EXACTLY the evidence the six
// Customer-V1 capabilities produce — so a fact can NEVER assert an action/result/
// state that no capability authorizes (no booking / payment / refund / bid /
// message answer exists). Free-form factual narration stays DEFERRED until a real
// claim-to-evidence compiler exists; the model may still emit bounded ADVICE text
// (clearly non-factual, and it can never claim an action/result/state as true).
export const FACT_ANSWER_KINDS = Object.freeze([
  "results_summary",     // grounded in a results receipt (READ_CURRENT_RESULTS / APPLY_HOTEL_REFINEMENT)
  "comparison_summary",  // grounded in a comparison receipt (COMPARE_VISIBLE_HOTELS)
  "hotel_facts",         // grounded in a detail receipt (READ_CURRENT_HOTEL_FACTS)
  "section_shown",       // grounded in a ui_state receipt (SHOW_HOTEL_SECTION)
  "hotel_opened",        // grounded in a navigation receipt (OPEN_VISIBLE_HOTEL)
] as const);
export type FactAnswerKind = (typeof FACT_ANSWER_KINDS)[number];
// The trusted EVIDENCE kind each closed answer must be derived from. A fact whose
// grounded step did not produce this exact evidence kind can never be rendered.
export const FACT_ANSWER_EVIDENCE: Readonly<Record<FactAnswerKind, string>> = Object.freeze({
  results_summary: "results",
  comparison_summary: "comparison",
  hotel_facts: "detail",
  section_shown: "ui_state",
  hotel_opened: "navigation",
});

// REMEDIATION-01 CORRECTION-02 (RESIDUAL A) — an ADVICE claim is NOT free-form model text.
// It is a CLOSED advisory descriptor: the model picks a bounded NORMATIVE intent (a suggestion)
// and MAY reference CURRENT visible positions; StayBid deterministically compiles the visible
// sentence (renderAdvice). Recommendation stays normative but can NEVER assert a factual
// completion — there is deliberately NO advisory intent for a booking / payment / refund / bid /
// message result, so a factual completion assertion can never masquerade as "advice".
export const ADVICE_INTENTS = Object.freeze([
  "consider_visible_options",   // suggest the shown options are worth a look
  "compare_before_choosing",    // suggest comparing before deciding
  "refine_for_better_match",    // suggest refining the search
  "ask_if_more_detail_needed",  // offer to show more detail on request
] as const);
export type AdviceIntent = (typeof ADVICE_INTENTS)[number];

// Result states for a dispatched capability observation. PENDING_VERIFICATION
// is the ONLY non-terminal state ("acted"/"accepted" class) — it NEVER
// completes a step. accepted/acted ≠ VERIFIED is SECURITY-CRITICAL.
export const RESULT_STATES = Object.freeze([
  "PENDING_VERIFICATION",
  "VERIFIED",
  "REJECTED",
  "STALE",
  "NO_OP",
  "UNKNOWN",
  "FAILED",
  "INTERRUPTED",
] as const);
export type ResultState = (typeof RESULT_STATES)[number];
export const TERMINAL_RESULT_STATES = Object.freeze([
  "VERIFIED", "REJECTED", "STALE", "NO_OP", "UNKNOWN", "FAILED", "INTERRUPTED",
] as const);
export function isTerminalResultState(v: unknown): boolean {
  return typeof v === "string" && (TERMINAL_RESULT_STATES as readonly string[]).includes(v);
}
// REV-01 — the ONLY result state that grounds a factual/completion claim.
// VERIFIED-with-evidence is success; accepted/acted/NO_OP/UNKNOWN/FAILED/
// REJECTED/STALE are NON-success and can never ground a fact.
export function isGroundingResultState(v: unknown): boolean { return v === "VERIFIED"; }

export const RETRY_DISPOSITIONS = Object.freeze([
  "NEVER",
  "SAFE_SAME_AUTHORITY",
  "USER_REQUIRED",
] as const);
export type RetryDisposition = (typeof RETRY_DISPOSITIONS)[number];

// Trusted memory origins (Customer V1): model inference is NEVER a trusted origin.
export const MEMORY_ORIGINS = Object.freeze([
  "USER_STATED",
  "CURRENT_CONTEXT",
  "VERIFIED_RECEIPT",
  "SYSTEM_POLICY",
] as const);
export type MemoryOrigin = (typeof MEMORY_ORIGINS)[number];

// Provider-neutral model tiers (interfaces only; 3/4 DISABLED in Customer V1;
// the model NEVER self-selects a tier or provider — routing is injected).
export const MODEL_TIERS = Object.freeze([
  "LEVEL_0", "LEVEL_1", "LEVEL_2", "LEVEL_3", "LEVEL_4", "REALTIME",
] as const);
export type ModelTier = (typeof MODEL_TIERS)[number];
export const DISABLED_MODEL_TIERS = Object.freeze(["LEVEL_3", "LEVEL_4"] as const);

// Closed turn-termination vocabulary (agent-loop terminal reasons).
export const TERMINATION_REASONS = Object.freeze([
  "COMPLETED",
  "CLARIFICATION_ISSUED",
  "ESCALATION_SUGGESTED",
  "HONEST_FAILURE",
  "MODEL_UNAVAILABLE",
  "MODEL_MALFORMED",
  "MODEL_TIMEOUT",
  "BUDGET_EXHAUSTED",
  "DEADLINE_EXCEEDED",
  "NON_MONOTONIC_TIME",     // REV-04 — a backward clock never extends/revives authority
  "MODEL_INPUT_OVERFLOW",   // REV-03 — canonical model input over 16 KiB (never truncated)
  "UNGROUNDED_RESPONSE",    // REV-01 — a fact claim with no verified-evidence grounding
  "INTERRUPTED",
  "SESSION_INVALID",
  "STALE_AUTHORITY",
  "CONFLICTING_OBSERVATION",
  "CONSECUTIVE_FAILURES",
  "WORKING_STATE_OVERFLOW",
  "INTERNAL_ERROR",
] as const);
export type TerminationReason = (typeof TERMINATION_REASONS)[number];

// ── hard limits (Customer V1 — HARD counts, never advisory) ──────────────
export const IC01_LIMITS = Object.freeze({
  MAX_PLAN_STEPS: 4,
  MAX_CAPABILITY_STEPS: 3,
  MAX_MODEL_CALLS_PER_TURN: 3,          // repair + fallback calls COUNT inside this
  MAX_MODEL_REPAIR_CALLS: 1,
  MAX_MODEL_FALLBACK_CALLS: 1,          // REV-04 — at most ONE provider/model fallback
  MAX_CONCURRENT_CAPABILITY: 1,
  MAX_CONCURRENT_MODEL: 1,
  MAX_CLARIFICATIONS_PER_TURN: 1,
  MAX_CONSECUTIVE_CLARIFICATION_TURNS: 2,
  MAX_AUTOMATIC_CAPABILITY_RETRIES: 0,
  MAX_CONSECUTIVE_FAILURES: 2,
  MAX_RESPONSE_CLAIMS: 8,               // REV-01 — bounded claim count per RESPOND
  TURN_DEADLINE_MS: 30_000,             // REV-04 — absolute; expiry at now >= turnStart+30000
  // Provider call ceiling: ≤ remaining turn deadline AND ≤ the EXISTING 20s
  // Voice ceiling — this packet never raises any accepted Voice ceiling.
  PROVIDER_CALL_CEILING_MS: 20_000,
  MAX_USER_TEXT_BYTES: MAX_TEXT_TURN_BYTES,       // 2000 (accepted bound reused)
  MAX_VISIBLE_ENTITIES: MAX_VISIBLE_HOTELS,       // 24
  MAX_SELECTED_ENTITIES: MAX_SELECTED_HOTELS,     // 4
  MAX_EVIDENCE_HANDLES: MAX_EVIDENCE_RECEIPTS,    // 8
  MAX_CONVERSATION_TURNS: 8,
  MAX_CONVERSATION_CHARS: 4_000,
  MAX_MODEL_INPUT_BYTES: 16 * 1024,               // REV-03 — ENFORCED, never truncated
  MAX_EVIDENCE_BYTES: 8 * 1024,
  MAX_WORKING_STATE_BYTES: MAX_FRAME_BYTES,       // 32 KiB (accepted bound reused)
  MAX_RESPONSE_TEXT_BYTES: 4_000,
  MAX_CLARIFY_TEXT_BYTES: 1_000,
  MAX_PREF_VALUE_BYTES: 200,
} as const);

// ── byte-bound helpers (total; never throw out) ──────────────────────────
export function utf8ByteLength(s: unknown): number | null {
  if (typeof s !== "string") return null;
  try { return Buffer.byteLength(s, "utf8"); } catch { return null; }
}
/** JSON-serialized byte size of a value, or null when it cannot be measured
 *  (circular / bigint / hostile toJSON throw / non-serializable). TOTAL. */
export function measureJsonBytes(x: unknown): number | null {
  try {
    const s = JSON.stringify(x);
    if (typeof s !== "string") return null;
    return Buffer.byteLength(s, "utf8");
  } catch {
    return null;
  }
}

const HEX64_RE = /^[0-9a-f]{64}$/;
function isHex64(v: unknown): v is string { return typeof v === "string" && HEX64_RE.test(v); }
function isPageId(v: unknown): v is "hotels" | "hotel-detail" { return v === "hotels" || v === "hotel-detail"; }
function isRole(v: unknown): v is "anonymous" | "customer" { return v === "anonymous" || v === "customer"; }
function inClosed(list: readonly string[], v: unknown): boolean { return typeof v === "string" && list.includes(v); }
function isControlFree(s: string): boolean {
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); if (c < 0x20 || c === 0x7f) return false; }
  return true;
}

// ── trusted binding (CONTROLLER-OWNED identities — the model can never
//    mint or override any of these; they arrive ONLY from the controller) ─
export interface TrustedBinding {
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
export function validateTrustedBinding(x: unknown): TrustedBinding | null {
  try {
    const a = strictRecord(x, [
      "sessionId", "turnId", "generation", "pageId", "role",
      "routeEpoch", "contextRevision", "authorityRef", "contextDigest",
    ]);
    if (!a) return null;
    if (!isId(a.sessionId) || !isId(a.turnId) || !isId(a.authorityRef)) return null;
    if (!isEpoch(a.generation) || !isEpoch(a.routeEpoch)) return null;
    if (!isPageId(a.pageId) || !isRole(a.role)) return null;
    if (!isContextRevision(a.contextRevision)) return null;
    if (!isHex64(a.contextDigest)) return null;
    return Object.freeze({
      sessionId: a.sessionId as string,
      turnId: a.turnId as string,
      generation: a.generation as number,
      pageId: a.pageId as "hotels" | "hotel-detail",
      role: a.role as "anonymous" | "customer",
      routeEpoch: a.routeEpoch as number,
      contextRevision: a.contextRevision as string,
      authorityRef: a.authorityRef as string,
      contextDigest: a.contextDigest as string,
    });
  } catch { return null; }
}

// ── user turn (bounded text; closed language + role) ─────────────────────
export interface UserTurn {
  readonly text: string;
  readonly language: LiveAiLanguage;
  readonly role: "anonymous" | "customer";
}
export function validateUserTurn(x: unknown): UserTurn | null {
  try {
    const a = strictRecord(x, ["text", "language", "role"]);
    if (!a) return null;
    const text = boundedText(a.text, IC01_LIMITS.MAX_USER_TEXT_BYTES);
    if (text === null) return null;
    if (!isLanguage(a.language)) return null;
    if (!isRole(a.role)) return null;
    return Object.freeze({ text, language: a.language, role: a.role as "anonymous" | "customer" });
  } catch { return null; }
}

// ── REV-03 — canonical, immutable, provider-neutral IntelligenceInputSnapshot ─
// The controller builds this from ONLY trusted, already-validated pieces and
// hands it (or an immutable reference) to MODEL_REQUEST. It carries NO raw DB
// object, token, secret, cookie, DOM/HTML, arbitrary URL, raw audio, unbounded
// transcript, private data, or model-generated fact. Every field is bounded.
export interface ConversationTurnProjection { readonly role: "user" | "assistant"; readonly text: string; }
export interface EphemeralPreferences { readonly city?: string; readonly budget?: string; readonly language?: LiveAiLanguage; }
export interface FailureStateProjection {
  readonly consecutiveFailures: number;
  readonly lastResultState: ResultState | null;
  readonly clarificationTurns: number;
}
export interface IntelligenceInputSnapshot {
  readonly contractVersion: typeof INTELLIGENCE_CONTRACT_VERSION;
  readonly binding: TrustedBinding;
  readonly userText: string;
  readonly language: LiveAiLanguage;
  readonly role: "anonymous" | "customer";
  // the accepted, bounded published context (≤24 visible hotels in authoritative
  // order + refinement/detail projection); null when the controller published none.
  readonly context: Record<string, unknown> | null;
  readonly selectedPositions: readonly number[];           // ≤4
  readonly evidenceRefs: readonly string[];                // ≤8 verified-step receipt ids
  readonly conversation: readonly ConversationTurnProjection[]; // ≤8 turns / ≤4000 chars
  readonly preferences: EphemeralPreferences;
  readonly failureState: FailureStateProjection;
}

// IC01-CLOSE-04 — the ONE coherence oracle: a published context is coherent with the trusted binding
// ONLY when its page + role equal the binding's AND the binding's contextDigest is the ACCEPTED canonical
// digest of that exact context (contextDigest — never a weaker parallel derivation). A null context has
// nothing to bind (a binding may legitimately stand alone with no published entity list). Total + pure;
// a hostile digest throw fails closed to `false`. This is reused by the snapshot builder, beginTurn and
// rebind so binding↔context coherence is enforced identically everywhere.
export function contextCoherentWithBinding(binding: TrustedBinding, context: Record<string, unknown> | null): boolean {
  try {
    if (context === null) return true;
    if (context.pageId !== binding.pageId) return false;
    if (context.role !== binding.role) return false;
    if (contextDigest(context) !== binding.contextDigest) return false;
    return true;
  } catch { return false; }
}

/** Build the canonical snapshot from trusted, already-validated inputs. Pure and
 *  controller-created. Returns null if any bound is violated OR the serialized
 *  snapshot exceeds MAX_MODEL_INPUT_BYTES (REV-03 — reject, never truncate). */
export function buildIntelligenceInputSnapshot(parts: {
  binding: TrustedBinding;
  userText: string;
  language: LiveAiLanguage;
  role: "anonymous" | "customer";
  context?: unknown;
  selectedPositions?: readonly number[];
  evidenceRefs?: readonly string[];
  conversation?: readonly ConversationTurnProjection[];
  preferences?: EphemeralPreferences;
  failureState: FailureStateProjection;
}): IntelligenceInputSnapshot | null {
  try {
    const b = validateTrustedBinding(parts.binding);
    if (!b) return null;
    if (typeof parts.userText !== "string" || boundedText(parts.userText, IC01_LIMITS.MAX_USER_TEXT_BYTES) === null) return null;
    if (!isLanguage(parts.language) || !isRole(parts.role)) return null;
    // IC01-CLOSE-04 RESIDUAL A — the snapshot's top-level role is not merely A valid role, it must be
    // THE binding's role. The trusted binding is the single authority; a snapshot that declares a
    // different role than the binding it is built from is incoherent and is REJECTED, never normalized.
    // (The context role is separately reconciled against the binding by contextCoherentWithBinding
    // below, so binding.role === snapshot.role === context.role all agree.)
    if (parts.role !== b.role) return null;
    // context: null OR a value the ACCEPTED validator accepts (reuse, never fork)
    let context: Record<string, unknown> | null = null;
    if (parts.context !== undefined && parts.context !== null) {
      context = validatePublishedContext(parts.context);
      if (!context) return null;
    }
    // IC01-CLOSE-04 — the context MUST be coherent with the trusted binding (page + role + the ACCEPTED
    // canonical digest). Binding, role, page and digest are ONE coherent trusted-context object, never
    // independently validated: a customer/hotels binding with an anonymous/hotel-detail context, or a
    // digest that does not describe the supplied context, is rejected.
    if (context !== null && !contextCoherentWithBinding(b, context)) return null;
    // IC01-CLOSE-04 RESIDUAL B — a selection may reference ONLY a position that ACTUALLY OCCURS in the
    // published visible list, not merely a 1..count ordinal. The allowed set is built from the REAL
    // current `visibleHotels[].position` values (each already validated by validatePublishedContext as a
    // distinct integer 1..24); a selected position that does not occur as a real current position is
    // REJECTED — visible positions [1,5] ⇒ 1 and 5 are selectable, 2 and 3 are not. The published
    // positions are used VERBATIM (never reordered/renumbered to 1..length). With no hotels-list context
    // the allowed set is empty, so there is nothing to select.
    const visiblePositions = new Set<number>();
    if (context && context.pageId === "hotels" && Array.isArray((context as { visibleHotels?: unknown }).visibleHotels)) {
      for (const h of (context as { visibleHotels: unknown[] }).visibleHotels) {
        const pos = (h && typeof h === "object") ? (h as { position?: unknown }).position : undefined;
        if (typeof pos === "number" && Number.isInteger(pos) && pos >= 1 && pos <= IC01_LIMITS.MAX_VISIBLE_ENTITIES) visiblePositions.add(pos);
      }
    }
    // selected positions ≤4, distinct ints 1..24, AND must OCCUR as a real current visible position
    const sel: number[] = [];
    const selSeen = new Set<number>();
    const rawSel = parts.selectedPositions ?? [];
    if (!Array.isArray(rawSel) || rawSel.length > IC01_LIMITS.MAX_SELECTED_ENTITIES) return null;
    for (const p of rawSel) {
      if (typeof p !== "number" || !Number.isInteger(p) || p < 1 || p > IC01_LIMITS.MAX_VISIBLE_ENTITIES || selSeen.has(p)) return null;
      if (!visiblePositions.has(p)) return null;   // IC01-CLOSE-04 RESIDUAL B — must reference an ACTUALLY-visible position
      selSeen.add(p); sel.push(p);
    }
    // evidence refs ≤8, valid ids, distinct
    const ev: string[] = [];
    const evSeen = new Set<string>();
    const rawEv = parts.evidenceRefs ?? [];
    if (!Array.isArray(rawEv) || rawEv.length > IC01_LIMITS.MAX_EVIDENCE_HANDLES) return null;
    for (const r of rawEv) { if (!isId(r) || evSeen.has(r)) return null; evSeen.add(r); ev.push(r); }
    // conversation ≤8 turns / ≤4000 chars total
    const conv: ConversationTurnProjection[] = [];
    const rawConv = parts.conversation ?? [];
    if (!Array.isArray(rawConv) || rawConv.length > IC01_LIMITS.MAX_CONVERSATION_TURNS) return null;
    let chars = 0;
    for (const t of rawConv) {
      if (!t || (t.role !== "user" && t.role !== "assistant")) return null;
      if (typeof t.text !== "string" || !isControlFree(t.text)) return null;
      chars += t.text.length;
      // IC01-CLOSE-04 — DEEP-copy + FREEZE each nested conversation entry: the snapshot is one deeply
      // immutable object, so a validated entry can never be mutated after the fact (the input array is
      // never aliased into the frozen output).
      conv.push(Object.freeze({ role: t.role, text: t.text }));
    }
    if (chars > IC01_LIMITS.MAX_CONVERSATION_CHARS) return null;
    // preferences: ONLY the closed keys (reject an unknown key — never normalize),
    // each bounded + control-free. No arbitrary/private field can enter model input.
    const prefsIn = strictRecord(parts.preferences ?? {}, ["city", "budget", "language"]) as { city?: string; budget?: string; language?: LiveAiLanguage } | null;
    if (!prefsIn) return null;
    const prefs: { city?: string; budget?: string; language?: LiveAiLanguage } = {};
    if (prefsIn.city !== undefined) { if (typeof prefsIn.city !== "string" || (utf8ByteLength(prefsIn.city) ?? Infinity) > IC01_LIMITS.MAX_PREF_VALUE_BYTES || !isControlFree(prefsIn.city)) return null; prefs.city = prefsIn.city; }
    if (prefsIn.budget !== undefined) { if (typeof prefsIn.budget !== "string" || (utf8ByteLength(prefsIn.budget) ?? Infinity) > IC01_LIMITS.MAX_PREF_VALUE_BYTES || !isControlFree(prefsIn.budget)) return null; prefs.budget = prefsIn.budget; }
    if (prefsIn.language !== undefined) { if (!isLanguage(prefsIn.language)) return null; prefs.language = prefsIn.language; }
    // failure state — closed
    const fs = parts.failureState;
    if (!fs || typeof fs.consecutiveFailures !== "number" || !Number.isInteger(fs.consecutiveFailures) || fs.consecutiveFailures < 0) return null;
    if (fs.lastResultState !== null && !inClosed(RESULT_STATES, fs.lastResultState)) return null;
    if (typeof fs.clarificationTurns !== "number" || !Number.isInteger(fs.clarificationTurns) || fs.clarificationTurns < 0) return null;
    const snap: IntelligenceInputSnapshot = Object.freeze({
      contractVersion: INTELLIGENCE_CONTRACT_VERSION,
      binding: b,
      userText: parts.userText,
      language: parts.language,
      role: parts.role,
      context,
      selectedPositions: Object.freeze(sel),
      evidenceRefs: Object.freeze(ev),
      conversation: Object.freeze(conv),
      preferences: Object.freeze(prefs),
      failureState: Object.freeze({ consecutiveFailures: fs.consecutiveFailures, lastResultState: fs.lastResultState, clarificationTurns: fs.clarificationTurns }),
    });
    // REV-03 — ENFORCE the 16 KiB model-input bound. NEVER truncate: reject.
    const bytes = measureJsonBytes(snap);
    if (bytes === null || bytes > IC01_LIMITS.MAX_MODEL_INPUT_BYTES) return null;
    return snap;
  } catch { return null; }
}

/** Strict total validator for a canonical snapshot (used when one arrives over a
 *  boundary rather than being built in-process). Enforces the SAME bounds + the
 *  16 KiB limit. Reject — never normalize. */
export function validateIntelligenceInputSnapshot(x: unknown): IntelligenceInputSnapshot | null {
  try {
    const a = strictRecord(x, [
      "contractVersion", "binding", "userText", "language", "role", "context",
      "selectedPositions", "evidenceRefs", "conversation", "preferences", "failureState",
    ]);
    if (!a) return null;
    if (a.contractVersion !== INTELLIGENCE_CONTRACT_VERSION) return null;
    return buildIntelligenceInputSnapshot({
      binding: a.binding as TrustedBinding,
      userText: a.userText as string,
      language: a.language as LiveAiLanguage,
      role: a.role as "anonymous" | "customer",
      context: a.context,
      selectedPositions: a.selectedPositions as readonly number[],
      evidenceRefs: a.evidenceRefs as readonly string[],
      conversation: a.conversation as readonly ConversationTurnProjection[],
      preferences: a.preferences as EphemeralPreferences,
      failureState: a.failureState as FailureStateProjection,
    });
  } catch { return null; }
}

// ── plan candidate (the MODEL'S proposal — strictly validated; the model
//    supplies NO identities of any kind: exact keys reject planId / stepId /
//    proposalId / receiptId / nonce / authorityRef / any correlation id) ──
export interface PlanCapabilityStep {
  readonly kind: "CAPABILITY";
  readonly capabilityId: OperationName;
  readonly args: Record<string, unknown>; // the FROZEN canonical accepted operation
}
// REV-01 (CORRECTION-01) — a FACT claim is a CLOSED answer descriptor: the model
// chooses WHICH closed answer + WHICH earlier CAPABILITY step grounds it, and NOTHING
// ELSE (no free-form text). The factual text is compiled from the trusted evidence by
// renderFactAnswer. An ADVICE claim is bounded non-factual presentation text only.
export interface FactResponseClaim {
  readonly kind: "fact";
  readonly answer: FactAnswerKind;
  readonly groundedInStep: number; // 0-based index of an EARLIER CAPABILITY step
}
export interface AdviceResponseClaim {
  readonly kind: "advice";
  readonly advice: AdviceIntent;             // RESIDUAL A (CORRECTION-02) — a CLOSED normative intent
  readonly positions: readonly number[];     // CURRENT visible 1-based positions (may be empty)
}
export type ResponseClaim = FactResponseClaim | AdviceResponseClaim;
export interface PlanRespondStep {
  readonly kind: "RESPOND";
  readonly language: LiveAiLanguage;
  readonly claims: readonly ResponseClaim[];
}
export interface PlanClarifyStep {
  readonly kind: "CLARIFY";
  readonly reason: ClarifyReason;   // IC01-CLOSE-01 — a CLOSED reason (NO free-form model text)
  readonly language: LiveAiLanguage;
}
export interface PlanEscalateStep {
  readonly kind: "ESCALATE_TO_HUMAN";
  readonly escalation: EscalationReason;   // IC01-CLOSE-01 — a CLOSED reason (NO free-form model text)
  readonly language: LiveAiLanguage;
}
export type PlanStep = PlanCapabilityStep | PlanRespondStep | PlanClarifyStep | PlanEscalateStep;
export interface PlanCandidate {
  readonly contractVersion: typeof INTELLIGENCE_CONTRACT_VERSION;
  readonly intent: IntelligenceIntent;
  readonly steps: readonly PlanStep[];
}

function validateResponseClaim(x: unknown): ResponseClaim | null {
  const kindDesc = x && typeof x === "object" ? Object.getOwnPropertyDescriptor(x, "kind") : undefined;
  if (!kindDesc || !("value" in kindDesc)) return null;
  const kind = kindDesc.value;
  if (kind === "fact") {
    // REV-01 (CORRECTION-01) — a fact carries a CLOSED answer descriptor + a grounded
    // step ONLY. There is NO free-form `text` key: an arbitrary model sentence (e.g.
    // "booking and payment succeeded") can never be a factual claim, and no answer kind
    // exists for booking/payment/refund/bid/message.
    const a = strictRecord(x, ["kind", "answer", "groundedInStep"]);
    if (!a) return null;
    if (!inClosed(FACT_ANSWER_KINDS, a.answer)) return null;
    if (typeof a.groundedInStep !== "number" || !Number.isInteger(a.groundedInStep) || a.groundedInStep < 0 || a.groundedInStep >= IC01_LIMITS.MAX_PLAN_STEPS) return null;
    return Object.freeze({ kind: "fact" as const, answer: a.answer as FactAnswerKind, groundedInStep: a.groundedInStep });
  }
  if (kind === "advice") {
    // RESIDUAL A (CORRECTION-02) — a CLOSED advisory descriptor: a bounded normative intent +
    // optional CURRENT visible positions. NO free-form `text` key — an arbitrary model sentence
    // (e.g. "your booking and payment succeeded") can never be an advice claim, and no advice
    // intent exists for a booking/payment/refund/bid/message completion.
    const a = strictRecord(x, ["kind", "advice", "positions"]);
    if (!a) return null;
    if (!inClosed(ADVICE_INTENTS, a.advice)) return null;
    const positions = validateVisiblePositions(a.positions);
    if (positions === null) return null;
    return Object.freeze({ kind: "advice" as const, advice: a.advice as AdviceIntent, positions: Object.freeze(positions) });
  }
  return null;
}

// RESIDUAL A (CORRECTION-02) — validate a CLOSED set of CURRENT visible 1-based positions: a plain
// array of DISTINCT integers in [1, MAX_VISIBLE_ENTITIES], count ≤ MAX_SELECTED_ENTITIES (the
// existing selected-entity bound; may be empty). STATIC bound only; the agent-loop additionally
// checks each ≤ the CURRENT visible count at RESPOND time. Reject (never repair) a hole / accessor /
// non-integer / duplicate / out-of-bound / hostile array.
function validateVisiblePositions(x: unknown): number[] | null {
  if (!Array.isArray(x) || Object.getPrototypeOf(x) !== Array.prototype) return null;
  const lenDesc = Object.getOwnPropertyDescriptor(x, "length");
  if (!lenDesc || !("value" in lenDesc) || typeof lenDesc.get === "function" || typeof lenDesc.set === "function") return null;
  if (typeof lenDesc.value !== "number" || !Number.isInteger(lenDesc.value)) return null;
  if (x.length > IC01_LIMITS.MAX_SELECTED_ENTITIES) return null;
  for (const k of Reflect.ownKeys(x)) {
    if (k === "length") continue;
    if (typeof k === "symbol") return null;
    const n = Number(k);
    if (!(String(n) === k && Number.isInteger(n) && n >= 0 && n < x.length)) return null;
  }
  const out: number[] = [];
  const seen = new Set<number>();
  for (let i = 0; i < x.length; i++) {
    const d = Object.getOwnPropertyDescriptor(x, i);
    if (!d || typeof d.get === "function" || !("value" in d)) return null;
    const p = d.value;
    if (typeof p !== "number" || !Number.isInteger(p) || p < 1 || p > IC01_LIMITS.MAX_VISIBLE_ENTITIES) return null;
    if (seen.has(p)) return null;
    seen.add(p); out.push(p);
  }
  return out;
}

// REV-01 (CORRECTION-01) — DETERMINISTIC, evidence-derived rendering of a closed fact
// answer. The human text is compiled ENTIRELY from the trusted verified evidence (never
// a model string). Returns null when the evidence kind does not match the answer kind
// (fail closed — a fact cannot be rendered from mismatched or absent evidence). Pure.
export function renderFactAnswer(answer: unknown, evidence: unknown, language: unknown): string | null {
  try {
    if (!inClosed(FACT_ANSWER_KINDS, answer)) return null;
    const ev = evidence && typeof evidence === "object" && !Array.isArray(evidence) ? (evidence as Record<string, unknown>) : null;
    if (!ev || typeof ev.kind !== "string") return null;
    if (ev.kind !== FACT_ANSWER_EVIDENCE[answer as FactAnswerKind]) return null; // answer↔evidence kind must match
    const lang = isLanguage(language) ? language : "en";
    let text: string | null = null;
    switch (answer) {
      case "results_summary": {
        const c = typeof ev.count === "number" && Number.isInteger(ev.count) ? ev.count : (Array.isArray(ev.orderedIds) ? ev.orderedIds.length : null);
        if (c === null) return null;
        text = lang === "hi" ? `स्क्रीन पर ${c} स्टे हैं।` : lang === "hinglish" ? `Screen par ${c} stays hain.` : `${c} matching stays are shown.`;
        break;
      }
      case "comparison_summary": {
        const n = Array.isArray(ev.positions) ? ev.positions.length : null;
        if (n === null) return null;
        text = lang === "hi" ? `${n} स्टे की तुलना की गई।` : lang === "hinglish" ? `${n} stays compare kiye.` : `Compared ${n} stays on screen.`;
        break;
      }
      case "hotel_facts": {
        if (typeof ev.breakfast !== "string" || typeof ev.parking !== "string") return null;
        text = lang === "hi" ? `नाश्ता: ${ev.breakfast}; पार्किंग: ${ev.parking}.` : lang === "hinglish" ? `Breakfast: ${ev.breakfast}; parking: ${ev.parking}.` : `Breakfast: ${ev.breakfast}; parking: ${ev.parking}.`;
        break;
      }
      case "section_shown": {
        if (typeof ev.section !== "string") return null;
        text = lang === "hi" ? `${ev.section} सेक्शन दिखाया गया।` : lang === "hinglish" ? `${ev.section} section dikhaya.` : `Showing the ${ev.section} section.`;
        break;
      }
      case "hotel_opened": {
        const p = typeof ev.position === "number" && Number.isInteger(ev.position) ? ev.position : null;
        if (p === null) return null;
        text = lang === "hi" ? `स्थान ${p} पर स्टे खोला गया।` : lang === "hinglish" ? `Position ${p} ka stay khola.` : `Opened the stay at position ${p}.`;
        break;
      }
      default: return null;
    }
    if (text === null) return null;
    // the derived text is bounded by construction; enforce the bound defensively.
    return boundedText(text, IC01_LIMITS.MAX_RESPONSE_TEXT_BYTES);
  } catch { return null; }
}

// RESIDUAL A (CORRECTION-02) — DETERMINISTIC rendering of a CLOSED advisory intent. The human text
// is compiled ENTIRELY from the closed intent + the (already validated) CURRENT visible positions —
// never a model string. Pure; returns a bounded localized sentence, or null (fail closed) for a
// non-closed intent. Positions are woven in only when present. Advice is NORMATIVE (a suggestion)
// and can NEVER be a factual completion.
export function renderAdvice(advice: unknown, positions: unknown, language: unknown): string | null {
  try {
    if (!inClosed(ADVICE_INTENTS, advice)) return null;
    const lang = isLanguage(language) ? language : "en";
    const ps = Array.isArray(positions) ? positions.filter((p) => typeof p === "number" && Number.isInteger(p) && p >= 1) : [];
    const list = ps.join(", ");
    const at = ps.length
      ? (lang === "hi" ? ` (स्थान ${list})` : lang === "hinglish" ? ` (position ${list})` : ` (positions ${list})`)
      : "";
    let text: string | null = null;
    switch (advice) {
      case "consider_visible_options":
        text = lang === "hi" ? `आप दिखाए गए विकल्पों पर विचार कर सकते हैं${at}।` : lang === "hinglish" ? `Aap shown options consider kar sakte hain${at}.` : `You could consider the options shown${at}.`;
        break;
      case "compare_before_choosing":
        text = lang === "hi" ? `चुनने से पहले इनकी तुलना करना ठीक रहेगा${at}।` : lang === "hinglish" ? `Choose karne se pehle inhe compare karna theek rahega${at}.` : `You may want to compare these before choosing${at}.`;
        break;
      case "refine_for_better_match":
        text = lang === "hi" ? `बेहतर मेल के लिए आप खोज को और परिष्कृत कर सकते हैं।` : lang === "hinglish" ? `Behtar match ke liye aap search aur refine kar sakte hain.` : `You could refine the search for a closer match.`;
        break;
      case "ask_if_more_detail_needed":
        text = lang === "hi" ? `किसी भी विकल्प का अधिक विवरण चाहिए तो मैं दिखा सकता हूँ${at}।` : lang === "hinglish" ? `Kisi bhi option ka zyada detail chahiye to main dikha sakta hoon${at}.` : `I can show more detail on any of these if you'd like${at}.`;
        break;
      default: return null;
    }
    if (text === null) return null;
    return boundedText(text, IC01_LIMITS.MAX_RESPONSE_TEXT_BYTES);
  } catch { return null; }
}

// IC01-CLOSE-01 — DETERMINISTIC rendering of a CLOSED clarify reason. The visible question is compiled
// ENTIRELY from the closed reason (never a model string). Pure; returns a bounded localized question, or
// null (fail closed) for a non-closed reason. A clarification only ASKS — it never asserts any action /
// result / state as done, so a factual completion can never be smuggled through the CLARIFY terminal.
export function renderClarify(reason: unknown, language: unknown): string | null {
  try {
    if (!inClosed(CLARIFY_REASONS, reason)) return null;
    const lang = isLanguage(language) ? language : "en";
    let text: string | null = null;
    switch (reason) {
      case "MISSING_DESTINATION":
        text = lang === "hi" ? "कौन-सा शहर देख रहे हैं?" : lang === "hinglish" ? "Kaunsa city dekh rahe hain?" : "Which city are you looking at?";
        break;
      case "MISSING_SELECTION":
        text = lang === "hi" ? "किन स्टे को देखूँ?" : lang === "hinglish" ? "Kaunse stays dekhun?" : "Which stays should I look at?";
        break;
      case "AMBIGUOUS_REFERENCE":
        text = lang === "hi" ? "आपका मतलब किससे है?" : lang === "hinglish" ? "Aapka matlab kis se hai?" : "Which one do you mean?";
        break;
      case "NO_SUPPORTED_CONTEXT":
        text = lang === "hi" ? "क्या आप पहले होटल पेज खोल सकते हैं?" : lang === "hinglish" ? "Kya aap pehle hotels page khol sakte hain?" : "Could you open a hotels page first?";
        break;
      case "TRANSACTIONAL_NOT_ENABLED":
        text = lang === "hi" ? "मैं यहाँ वह काम नहीं कर सकता — क्या मैं ब्राउज़ या तुलना में मदद करूँ?" : lang === "hinglish" ? "Main yahan wo kaam nahi kar sakta — kya browse ya compare mein help karun?" : "I can't do that action here — would you like help browsing or comparing?";
        break;
      case "OUT_OF_SCOPE":
        text = lang === "hi" ? "क्या आप इसे होटल खोज या तुलना के रूप में बता सकते हैं?" : lang === "hinglish" ? "Kya aap ise hotel search ya compare ke roop mein bata sakte hain?" : "Could you rephrase that as a hotel search or comparison?";
        break;
      default: return null;
    }
    if (text === null) return null;
    return boundedText(text, IC01_LIMITS.MAX_CLARIFY_TEXT_BYTES);
  } catch { return null; }
}

// IC01-CLOSE-01 — DETERMINISTIC rendering of a CLOSED escalation reason. ESCALATE is a SUGGESTION only:
// the sentence merely suggests a StayBid person can help. It NEVER asserts that a booking / payment /
// refund / bid / message succeeded, completed, or was confirmed — no reason maps to such a claim, and
// the text is compiled ENTIRELY from the closed reason (never a model string). Pure; returns a bounded
// localized suggestion, or null (fail closed) for a non-closed reason.
export function renderEscalation(escalation: unknown, language: unknown): string | null {
  try {
    if (!inClosed(ESCALATION_REASONS, escalation)) return null;
    const lang = isLanguage(language) ? language : "en";
    let text: string | null = null;
    switch (escalation) {
      case "TRANSACTIONAL_REQUEST":
        text = lang === "hi" ? "इसके लिए StayBid टीम का सदस्य आपकी मदद कर सकता है; मैं यहाँ यह नहीं कर सकता।" : lang === "hinglish" ? "Iske liye StayBid team ka member aapki help kar sakta hai; main yahan yeh nahi kar sakta." : "A StayBid team member can help you with that; I can't do it here.";
        break;
      case "REPEATED_MISUNDERSTANDING":
        text = lang === "hi" ? "मुझे समझने में कठिनाई हो रही है — StayBid टीम का सदस्य मदद कर सकता है।" : lang === "hinglish" ? "Mujhe samajhne mein dikkat ho rahi hai — StayBid team ka member help kar sakta hai." : "I'm having trouble understanding — a StayBid team member may be able to help.";
        break;
      case "COMPLAINT_OR_DISPUTE":
        text = lang === "hi" ? "ऐसी शिकायत के लिए StayBid टीम का सदस्य आपकी मदद कर सकता है।" : lang === "hinglish" ? "Aisi complaint ke liye StayBid team ka member aapki help kar sakta hai." : "For a complaint like this, a StayBid team member can help you.";
        break;
      case "OUT_OF_SCOPE_REQUEST":
        text = lang === "hi" ? "यह मेरी सीमा से बाहर है — StayBid टीम का सदस्य मदद कर सकता है।" : lang === "hinglish" ? "Yeh meri limit se bahar hai — StayBid team ka member help kar sakta hai." : "That's outside what I can help with here — a StayBid team member may be able to.";
        break;
      default: return null;
    }
    if (text === null) return null;
    return boundedText(text, IC01_LIMITS.MAX_CLARIFY_TEXT_BYTES);
  } catch { return null; }
}

function validatePlanStep(x: unknown, indexInPlan: number, kinds: readonly string[]): PlanStep | null {
  const kindDesc = x && typeof x === "object" ? Object.getOwnPropertyDescriptor(x, "kind") : undefined;
  if (!kindDesc || !("value" in kindDesc)) return null;
  const kind = kindDesc.value;
  if (typeof kind !== "string") return null;
  if (kind === "CAPABILITY") {
    const a = strictRecord(x, ["kind", "capabilityId", "args"]);
    if (!a) return null;
    if (typeof a.capabilityId !== "string") return null;
    // Argument authority DELEGATES to the ONE accepted R5A validator — never a
    // looser fork. The args object must BE the closed operation (args.op is the
    // discriminant) and its op must equal the declared capabilityId.
    const op = validateModelOperation(a.args);
    if (!op || op.op !== a.capabilityId) return null;
    return Object.freeze({ kind: "CAPABILITY" as const, capabilityId: a.capabilityId as OperationName, args: op });
  }
  if (kind === "RESPOND") {
    const a = strictRecord(x, ["kind", "language", "claims"]);
    if (!a) return null;
    if (!isLanguage(a.language)) return null;
    if (!Array.isArray(a.claims) || Object.getPrototypeOf(a.claims) !== Array.prototype) return null;
    if (a.claims.length < 1 || a.claims.length > IC01_LIMITS.MAX_RESPONSE_CLAIMS) return null;
    // reject a stray own key / accessor / hole on the claims array
    const cd = Object.getOwnPropertyDescriptor(a.claims, "length");
    if (!cd || !("value" in cd) || typeof cd.get === "function") return null;
    for (const k of Reflect.ownKeys(a.claims)) {
      if (k === "length") continue;
      if (typeof k === "symbol") return null;
      const n = Number(k);
      if (!(String(n) === k && Number.isInteger(n) && n >= 0 && n < a.claims.length)) return null;
    }
    const claims: ResponseClaim[] = [];
    for (let i = 0; i < a.claims.length; i++) {
      const d = Object.getOwnPropertyDescriptor(a.claims, i);
      if (!d || typeof d.get === "function" || !("value" in d)) return null;
      const claim = validateResponseClaim(d.value);
      if (!claim) return null;
      // REV-01 STATIC grounding shape: a fact must reference a CAPABILITY step
      // that occurs EARLIER than this RESPOND step in the plan. (The loop adds
      // the runtime check that the step actually verified with evidence.)
      if (claim.kind === "fact") {
        const g = claim.groundedInStep as number;
        if (g >= indexInPlan) return null;               // must be earlier
        if (kinds[g] !== "CAPABILITY") return null;      // must be a capability step
      }
      claims.push(claim);
    }
    return Object.freeze({ kind: "RESPOND" as const, language: a.language, claims: Object.freeze(claims) });
  }
  if (kind === "CLARIFY") {
    // IC01-CLOSE-01 — a CLARIFY carries a CLOSED reason ONLY. There is NO free-form `text` key: an
    // arbitrary model sentence (e.g. "Your booking and payment succeeded. Which city?") can never be
    // a clarification. The visible question is DERIVED deterministically from the reason (renderClarify).
    const a = strictRecord(x, ["kind", "reason", "language"]);
    if (!a) return null;
    if (!inClosed(CLARIFY_REASONS, a.reason)) return null;
    if (!isLanguage(a.language)) return null;
    return Object.freeze({ kind: "CLARIFY" as const, reason: a.reason as ClarifyReason, language: a.language });
  }
  if (kind === "ESCALATE_TO_HUMAN") {
    // IC01-CLOSE-01 — a SUGGESTION only: a CLOSED escalation reason, NO free-form `text` key. An
    // arbitrary model sentence (e.g. "Your refund completed. Contact a human.") can never be an
    // escalation, and no reason asserts a booking/payment/refund/bid/message completion. The safe
    // "a StayBid person can help" sentence is DERIVED deterministically (renderEscalation).
    const a = strictRecord(x, ["kind", "escalation", "language"]);
    if (!a) return null;
    if (!inClosed(ESCALATION_REASONS, a.escalation)) return null;
    if (!isLanguage(a.language)) return null;
    return Object.freeze({ kind: "ESCALATE_TO_HUMAN" as const, escalation: a.escalation as EscalationReason, language: a.language });
  }
  return null;
}

/** STRICT total plan-candidate validator. Structure rules (all HARD):
 *  1..MAX_PLAN_STEPS steps; ≤ MAX_CAPABILITY_STEPS CAPABILITY steps; STRICTLY
 *  LINEAR (a plain ordered list — no DAG / recursion / nesting / conditions);
 *  EXACTLY ONE terminal step (RESPOND | CLARIFY | ESCALATE_TO_HUMAN) and it is
 *  the LAST step; every non-last step is CAPABILITY. Intent coherence: CLARIFY
 *  intent ⇒ the single step is CLARIFY; UNSUPPORTED intent ⇒ no CAPABILITY
 *  step. The model supplies NO plan/step/proposal/receipt/nonce/authority
 *  identity anywhere (exact keys). Reject — never repair. */
export function validatePlanCandidate(x: unknown): PlanCandidate | null {
  try {
    const a = strictRecord(x, ["contractVersion", "intent", "steps"]);
    if (!a) return null;
    if (a.contractVersion !== INTELLIGENCE_CONTRACT_VERSION) return null;
    if (!inClosed(INTELLIGENCE_INTENTS, a.intent)) return null;
    const raw = a.steps;
    if (!Array.isArray(raw)) return null;
    if (Object.getPrototypeOf(raw) !== Array.prototype) return null;
    const lenDesc = Object.getOwnPropertyDescriptor(raw, "length");
    if (!lenDesc || !("value" in lenDesc) || typeof lenDesc.get === "function" || typeof lenDesc.set === "function") return null;
    const len = lenDesc.value;
    if (typeof len !== "number" || !Number.isInteger(len)) return null;
    if (len < 1 || len > IC01_LIMITS.MAX_PLAN_STEPS) return null;
    for (const k of Reflect.ownKeys(raw)) {
      if (k === "length") continue;
      if (typeof k === "symbol") return null;
      const n = Number(k);
      if (!(String(n) === k && Number.isInteger(n) && n >= 0 && n < len)) return null;
    }
    // First pass: capture each step's KIND (a plain primitive read) so the
    // RESPOND grounding-shape check can see the kinds of EARLIER steps.
    const kinds: string[] = [];
    for (let i = 0; i < len; i++) {
      const d = Object.getOwnPropertyDescriptor(raw, i);
      if (!d || typeof d.get === "function" || typeof d.set === "function" || !("value" in d)) return null;
      const kd = d.value && typeof d.value === "object" ? Object.getOwnPropertyDescriptor(d.value, "kind") : undefined;
      const kv = kd && "value" in kd ? kd.value : undefined;
      kinds.push(typeof kv === "string" ? kv : "");
    }
    const steps: PlanStep[] = [];
    for (let i = 0; i < len; i++) {
      const d = Object.getOwnPropertyDescriptor(raw, i);
      if (!d || !("value" in d)) return null;
      const step = validatePlanStep(d.value, i, kinds);
      if (!step) return null;
      steps.push(step);
    }
    let capabilityCount = 0;
    let terminalCount = 0;
    for (let i = 0; i < steps.length; i++) {
      const k = steps[i].kind;
      if (k === "CAPABILITY") {
        capabilityCount++;
        if (i === steps.length - 1) return null;            // last step must be terminal
      } else {
        terminalCount++;
        if (i !== steps.length - 1) return null;            // a terminal step anywhere but last
      }
    }
    if (terminalCount !== 1) return null;                    // exactly one terminal step
    if (capabilityCount > IC01_LIMITS.MAX_CAPABILITY_STEPS) return null;
    if (a.intent === "CLARIFY" && !(steps.length === 1 && steps[0].kind === "CLARIFY")) return null;
    if (a.intent === "UNSUPPORTED" && capabilityCount !== 0) return null;
    return Object.freeze({
      contractVersion: INTELLIGENCE_CONTRACT_VERSION,
      intent: a.intent as IntelligenceIntent,
      steps: Object.freeze(steps),
    });
  } catch { return null; }
}

// ── REV-02 — trusted observation envelope (CONTROLLER-SUBMITTED ONLY) ─────
// The model NEVER supplies a trusted result. The envelope carries the exact
// accepted R5B receipt (validated with the accepted validateActionReceipt),
// the controller dispatch id, and the source/result authority. There is NO
// bare `resultState` and NO opaque evidence string — the loop DERIVES the
// result state from the R5B outcome/status and grounds evidence via the typed
// R5B ReceiptEvidence. A fabricated/mismatched correlation fails closed.
export interface ObservationEnvelope {
  readonly observationId: string;
  readonly dispatchId: string;                 // MUST equal the loop's pending dispatch id
  readonly sessionId: string;
  readonly turnId: string;
  readonly generation: number;
  readonly planId: string;
  readonly stepIndex: number;
  readonly capabilityId: OperationName;
  readonly receipt: Record<string, unknown>;   // validated via validateActionReceipt (R5B)
  readonly sourceAuthority: ResultAuthorityShape;
  readonly resultAuthority: ResultAuthorityShape | null;
  // IC01-CLOSE-02 — the R5B gateway's terminal-ACK commitment (the SHA-256 the gateway returned in
  // action.receipt.ack, terminalReceiptCommitment). The loop compares it against the commitment it
  // recomputes over the held receipt (in the correct pre-/post-accept form): a fabricated but
  // schema-valid receipt the gateway never accepted has NO matching commitment and can never promote.
  readonly ackCommitment: string;
}
const CAPABILITY_IDS_FOR_OBS = Object.freeze([
  "APPLY_HOTEL_REFINEMENT", "READ_CURRENT_RESULTS", "COMPARE_VISIBLE_HOTELS",
  "OPEN_VISIBLE_HOTEL", "READ_CURRENT_HOTEL_FACTS", "SHOW_HOTEL_SECTION",
] as const);
// IC01-CLOSE-02 — deep field equality for two full result authorities. There is ONE canonical result
// authority per observation; the top-level and the receipt's own must be equal (never diverge).
function resultAuthorityEqual(a: ResultAuthorityShape, b: ResultAuthorityShape): boolean {
  return a.turnId === b.turnId && a.generation === b.generation && a.routeEpoch === b.routeEpoch &&
    a.contextRevision === b.contextRevision && a.authorityRef === b.authorityRef && a.contextDigest === b.contextDigest;
}
export function validateObservation(x: unknown): ObservationEnvelope | null {
  try {
    const a = strictRecord(x, [
      "observationId", "dispatchId", "sessionId", "turnId", "generation", "planId",
      "stepIndex", "capabilityId", "receipt", "sourceAuthority", "resultAuthority", "ackCommitment",
    ]);
    if (!a) return null;
    if (!isId(a.observationId) || !isId(a.dispatchId) || !isId(a.sessionId) || !isId(a.turnId) || !isId(a.planId)) return null;
    if (!isEpoch(a.generation)) return null;
    if (typeof a.stepIndex !== "number" || !Number.isInteger(a.stepIndex) || a.stepIndex < 0 || a.stepIndex >= IC01_LIMITS.MAX_PLAN_STEPS) return null;
    if (!inClosed(CAPABILITY_IDS_FOR_OBS, a.capabilityId)) return null;
    // IC01-CLOSE-02 — the R5B gateway terminal-ACK commitment (a SHA-256 hex). The loop compares this
    // against the commitment it recomputes over the held receipt (correct pre-/post-accept form).
    if (!isHex64(a.ackCommitment)) return null;
    // REV-02 — the exact accepted R5B receipt (correlation + outcome/status + typed evidence).
    const receipt = validateActionReceipt(a.receipt);
    if (!receipt) return null;
    if (receipt.operation !== a.capabilityId) return null;   // receipt must be for THIS capability
    // source authority is REQUIRED; result authority present on acted/verified.
    const sourceAuthority = validateResultAuthority(a.sourceAuthority);
    if (!sourceAuthority) return null;
    let resultAuthority: ResultAuthorityShape | null = null;
    if (a.resultAuthority !== null) {
      resultAuthority = validateResultAuthority(a.resultAuthority);
      if (!resultAuthority) return null;
    }
    // A verified receipt MUST carry typed evidence matching the operation.
    if (receipt.outcome === "verified" && !evidenceMatchesOperation(receipt.operation as string, receipt.evidence as { kind?: unknown } | null)) return null;
    // IC01-CLOSE-02 — a VERIFIED receipt MUST carry a gateway-validated result authority (a verified
    // result with no authority is refused; the R5B store requires one to promote to terminal(verified)).
    if (receipt.outcome === "verified" && !receipt.resultAuthority) return null;
    // IC01-CLOSE-02 — ONE canonical result authority: the top-level MUST deep-equal the receipt's own
    // (or both be absent). The value that controls advancement is exactly the value bound into the
    // gateway commitment — the two can no longer disagree while both validate.
    const rRA = (receipt.resultAuthority as ResultAuthorityShape | undefined) ?? null;
    if (rRA === null) { if (resultAuthority !== null) return null; }
    else { if (!resultAuthority || !resultAuthorityEqual(resultAuthority, rRA)) return null; }
    return Object.freeze({
      observationId: a.observationId as string,
      dispatchId: a.dispatchId as string,
      sessionId: a.sessionId as string,
      turnId: a.turnId as string,
      generation: a.generation as number,
      planId: a.planId as string,
      stepIndex: a.stepIndex as number,
      capabilityId: a.capabilityId as OperationName,
      receipt,
      sourceAuthority,
      resultAuthority,
      ackCommitment: a.ackCommitment as string,
    });
  } catch { return null; }
}

// REV-02 — DERIVE the IC01 result state from the validated R5B (outcome, status).
// The controller/model NEVER supplies a bare result state. accepted/acted maps
// to the NON-terminal PENDING_VERIFICATION (accepted ≠ verified). A verified
// outcome (whose typed evidence already matched the operation) is the only
// grounding success.
export function deriveResultState(receipt: Record<string, unknown>): ResultState {
  const outcome = receipt.outcome;
  const status = receipt.status;
  if (outcome === "verified") return "VERIFIED";
  if (outcome === "acted") return "PENDING_VERIFICATION";
  if (outcome === "stale") return "STALE";
  if (outcome === "unknown") return status === "interrupted" ? "INTERRUPTED" : "UNKNOWN";
  // rejected
  if (status === "no_op") return "NO_OP";
  if (status === "interrupted") return "INTERRUPTED";
  return "REJECTED";
}
