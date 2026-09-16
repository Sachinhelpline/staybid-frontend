// ─────────────────────────────────────────────────────────────────────────
// StayBid Live AI — LIVE-AI-IC02 — the GROUNDED ANSWER COMPILER.
//
// PURE + DETERMINISTIC + PROVIDER-NEUTRAL + DORMANT. This module performs ZERO
// network, provider, DB, Supabase, timer, or environment access. It is a
// PRODUCER-SIDE boundary that converts an accepted IC01 terminal descriptor
// (RESPOND | CLARIFY | ESCALATE_TO_HUMAN) plus atomically-retained VERIFIED
// evidence provenance into ONE canonical, self-verifiable CompiledAnswerEnvelope
// — or fails closed with an IC02-namespaced reject code.
//
// AUTHORITY MODEL (LOCKED — inherited from IC01, never widened here):
//   • MODEL = INTELLIGENCE, never AUTHORITY. The compiler derives factual
//     language ONLY from trusted VERIFIED evidence — never from model prose.
//   • Authority ceiling stays exactly READ + UI_LOCAL. This module grants NO
//     new operational authority (no booking/bid/payment/DOM/route/HTTP/SQL).
//   • IC01 model-visible terminal kinds (RESPOND/CLARIFY/ESCALATE_TO_HUMAN),
//     intents, result states, and claim vocabulary are UNCHANGED. IC02 keeps a
//     SEPARATE internal vocabulary (CompiledOutcome / CompilationDisposition /
//     semantic atoms / IC02_REJECT_* codes).
//   • Fail closed on any missing provenance / stale binding / authority mismatch
//     / wrong evidence mapping / unsupported descriptor / missing locale / size
//     overflow / nondeterministic rerender / commitment mismatch / exception.
//
// SCOPE BOUNDARY (LIVE-AI-IC02, P1-04): IC02 owns ONLY producer-side compiler
// guarantees + a PURE envelope verifier. It does NOT prove the current browser
// or the current TTS runtime uses this verifier — LIVE-AI-03B owns browser /
// controller runtime enforcement; LIVE-AI-03C owns real TTS runtime enforcement.
//
// This module IMPORTS (reads) the accepted sibling modules and REUSES their
// exact primitives + closed vocabularies — it NEVER forks a looser rule and
// NEVER mutates any accepted contract.
// ─────────────────────────────────────────────────────────────────────────

import {
  strictRecord,
  isId,
  isHotelId,
  isLanguage,
  sha256Hex,
  canonicalString,
  validateResultAuthority,
  evidenceMatchesOperation,
  MAX_VISIBLE_HOTELS,
  MAX_SELECTED_HOTELS,
  MAX_EVIDENCE_RECEIPTS,
  MAX_FRAME_BYTES,
} from "./live-ai-schemas";
import type { LiveAiLanguage, OperationName, ResultAuthorityShape } from "./live-ai-schemas";
import {
  INTELLIGENCE_CONTRACT_VERSION,
  IC01_LIMITS,
  FACT_ANSWER_KINDS,
  FACT_ANSWER_EVIDENCE,
  ADVICE_INTENTS,
  CLARIFY_REASONS,
  ESCALATION_REASONS,
  measureJsonBytes,
  validateTrustedBinding,
} from "./live-ai-intelligence-contract";
import type {
  TrustedBinding,
  FactAnswerKind,
  AdviceIntent,
  ClarifyReason,
  EscalationReason,
} from "./live-ai-intelligence-contract";
import { getCapability } from "./live-ai-capability-registry";
import type { CapabilityEvidenceType } from "./live-ai-capability-registry";

// ── IC02 identity (versioned so an envelope + record are self-describing) ──
export const IC02_COMPILER_VERSION = "staybid-answer-compiler.v1";
export const IC02_TEMPLATE_CATALOG_VERSION = "staybid-answer-templates.v1";

// ── IC02 INTERNAL vocabulary (kept SEPARATE from IC01 terminal kinds) ──────
export const IC02_COMPILED_OUTCOMES = Object.freeze([
  "COMPILED_RESPONSE",
  "COMPILED_CLARIFICATION",
  "COMPILED_HUMAN_ESCALATION",
] as const);
export type CompiledOutcome = (typeof IC02_COMPILED_OUTCOMES)[number];

export const IC02_COMPILATION_DISPOSITIONS = Object.freeze(["IC02_ACCEPTED", "IC02_REJECTED"] as const);
export type CompilationDisposition = (typeof IC02_COMPILATION_DISPOSITIONS)[number];

// The semantic atom kinds ADMITTED in IC02 v1.
export const IC02_SEMANTIC_ATOM_KINDS = Object.freeze([
  "IC02_FACT_ATOM",
  "IC02_DERIVATION_ATOM",
  "IC02_ADVICE_ATOM",
  "IC02_UNCERTAINTY_ATOM",
  "IC02_GLUE_ATOM",
] as const);
export type Ic02AtomKind = (typeof IC02_SEMANTIC_ATOM_KINDS)[number];

// P1-03 / P1-02 — atom kinds DEFINED for the closed vocabulary but NOT admitted
// (never emitted) in IC02 v1. A typed monetary preference match is a future,
// separately-accepted contract; there is no request input that can select it.
export const IC02_UNADMITTED_ATOM_KINDS = Object.freeze(["IC02_PREFERENCE_MATCH_ATOM"] as const);

// Compiler-owned derivation names (P1-02). They are NEVER model-selectable and
// are emitted ONLY when an IC01 descriptor's EXACT evidence semantics already
// support them. In IC02 v1 the derivation gate emits NONE (see computeDerivations).
export const IC02_DERIVATION_KINDS = Object.freeze([
  "LOWER_PRICE",
  "HIGHER_RATING",
  "REQUIRED_FACILITY_PRESENT",
] as const);
export type Ic02DerivationKind = (typeof IC02_DERIVATION_KINDS)[number];

export const IC02_TEMPLATE_LANGUAGES = Object.freeze(["en", "hi", "hinglish"] as const);

// IC02-namespaced reject codes (SEPARATE from IC01 termination reasons).
export const IC02_REJECT_CODES = Object.freeze([
  "IC02_REJECT_MALFORMED_REQUEST",
  "IC02_REJECT_CONTRACT_VERSION",
  "IC02_REJECT_IDENTITY_INVALID",
  "IC02_REJECT_BINDING_INVALID",
  "IC02_REJECT_LANGUAGE_UNSUPPORTED",
  "IC02_REJECT_TERMINAL_DESCRIPTOR_INVALID",
  "IC02_REJECT_TERMINAL_KIND_UNSUPPORTED",
  "IC02_REJECT_EVIDENCE_RECORD_INVALID",
  "IC02_REJECT_EVIDENCE_RECORD_OVERFLOW",
  "IC02_REJECT_CONFLICTING_EVIDENCE",
  "IC02_REJECT_REQUEST_OVERFLOW",
  "IC02_REJECT_MISSING_PROVENANCE",
  "IC02_REJECT_EVIDENCE_KIND_MISMATCH",
  "IC02_REJECT_STALE_BINDING",
  "IC02_REJECT_AUTHORITY_MISMATCH",
  "IC02_REJECT_ENTITY_BINDING",
  "IC02_REJECT_UNSUPPORTED_MAPPING",
  "IC02_REJECT_ADVICE_INVALID",
  "IC02_REJECT_LOCALE_COVERAGE",
  "IC02_REJECT_RENDER_FAILED",
  "IC02_REJECT_NONDETERMINISTIC",
  "IC02_REJECT_OUTPUT_OVERFLOW",
  "IC02_REJECT_SEMANTIC_HASH",
  "IC02_REJECT_TEXT_HASH",
  "IC02_REJECT_ENVELOPE_MALFORMED",
  "IC02_REJECT_ENVELOPE_UNACCEPTED",
  "IC02_REJECT_COMPILER_EXCEPTION",
] as const);
export type Ic02RejectCode = (typeof IC02_REJECT_CODES)[number];

// ── inherited bounds (never widened) ───────────────────────────────────────
// P1-03 — the accepted IC02 compile-request ceiling is 16 KiB. Reuse the inherited
// 16 KiB model-input bound (never the 32 KiB working-state bound). Reject, never truncate.
const IC02_MAX_COMPILE_REQUEST_BYTES = IC01_LIMITS.MAX_MODEL_INPUT_BYTES;  // 16 KiB — accepted request ceiling
// The compiled-output/envelope working-state bound is a SEPARATE concern (32 KiB) and never
// redefines the compile-request INPUT ceiling above.
const IC02_MAX_ENVELOPE_BYTES = MAX_FRAME_BYTES;          // 32 KiB — inherited working-state bound (output only)
const IC02_MAX_CANONICAL_TEXT_BYTES = IC01_LIMITS.MAX_RESPONSE_TEXT_BYTES; // 4000
const IC02_MAX_RESPONSE_CLAIMS = IC01_LIMITS.MAX_RESPONSE_CLAIMS;          // 8
const IC02_MAX_EVIDENCE_RECORDS = MAX_EVIDENCE_RECEIPTS;                   // 8

const HEX64_RE = /^[0-9a-f]{64}$/;
const FACILITY_STATES = Object.freeze(["present", "absent", "unknown"] as const);
const COMPARISON_FACTORS = Object.freeze(["price", "rating", "parking", "breakfast"] as const);
const EVIDENCE_KINDS = Object.freeze(["results", "comparison", "detail", "ui_state", "navigation"] as const);

// ── retained VERIFIED-evidence provenance record (P1-01) ───────────────────
// One IMMUTABLE record per verified step, captured atomically at the EXISTING
// IC01 VERIFIED-promotion transition. Every field is a deep-copied, deeply-frozen
// value of the ALREADY-VALIDATED trusted source (never a reconstruction).
export interface IC02VerifiedEvidenceRecord {
  readonly verifiedStepIndex: number;
  readonly receiptId: string;
  readonly capabilityId: OperationName;
  readonly evidenceKind: CapabilityEvidenceType;
  readonly evidence: Readonly<Record<string, unknown>>;
  readonly receiptCommitment: string;
  readonly sourceAuthority: ResultAuthorityShape;
  // P1-01 — a VERIFIED provenance record ALWAYS carries a validated result authority (never null).
  readonly resultAuthority: ResultAuthorityShape;
  readonly binding: TrustedBinding;
}
const RECORD_KEYS: readonly string[] = Object.freeze([
  "verifiedStepIndex", "receiptId", "capabilityId", "evidenceKind", "evidence",
  "receiptCommitment", "sourceAuthority", "resultAuthority", "binding",
]);

// ── compile request (P1-04 producer input; bounded, immutable, fail-closed) ─
export interface IC02CompileRequest {
  readonly contractVersion: typeof INTELLIGENCE_CONTRACT_VERSION;
  readonly controllerOwnedAnswerId: string;
  readonly controllerOwnedPlanId: string;
  readonly trustedCurrentBinding: TrustedBinding;
  readonly acceptedIC01TerminalDescriptor: Ic02TerminalDescriptor;
  readonly verifiedEvidenceRecords: readonly IC02VerifiedEvidenceRecord[];
  readonly requestedLanguage: LiveAiLanguage;
}

// ── the accepted IC01 terminal descriptor (structurally re-validated here) ──
export interface Ic02FactClaim { readonly kind: "fact"; readonly answer: FactAnswerKind; readonly groundedInStep: number; }
export interface Ic02AdviceClaim { readonly kind: "advice"; readonly advice: AdviceIntent; readonly positions: readonly number[]; }
export type Ic02ResponseClaim = Ic02FactClaim | Ic02AdviceClaim;
export type Ic02TerminalDescriptor =
  | { readonly kind: "RESPOND"; readonly language: LiveAiLanguage; readonly claims: readonly Ic02ResponseClaim[] }
  | { readonly kind: "CLARIFY"; readonly reason: ClarifyReason; readonly language: LiveAiLanguage }
  | { readonly kind: "ESCALATE_TO_HUMAN"; readonly escalation: EscalationReason; readonly language: LiveAiLanguage };

// ── semantic atoms + evidence commitments ──────────────────────────────────
export interface Ic02FactAtom { readonly kind: "IC02_FACT_ATOM"; readonly answer: FactAnswerKind; readonly evidenceKind: CapabilityEvidenceType; readonly verifiedStepIndex: number; readonly receiptId: string; readonly value: Readonly<Record<string, unknown>>; }
export interface Ic02DerivationAtom { readonly kind: "IC02_DERIVATION_ATOM"; readonly derivation: Ic02DerivationKind; readonly verifiedStepIndex: number; readonly value: Readonly<Record<string, unknown>>; }
export interface Ic02AdviceAtom { readonly kind: "IC02_ADVICE_ATOM"; readonly advice: AdviceIntent; readonly positions: readonly number[]; }
export interface Ic02UncertaintyAtom { readonly kind: "IC02_UNCERTAINTY_ATOM"; readonly topic: string; readonly verifiedStepIndex: number; }
export interface Ic02GlueAtom { readonly kind: "IC02_GLUE_ATOM"; readonly role: "clarification" | "escalation"; readonly code: string; }
export type Ic02SemanticAtom = Ic02FactAtom | Ic02DerivationAtom | Ic02AdviceAtom | Ic02UncertaintyAtom | Ic02GlueAtom;

export interface Ic02EvidenceCommitment {
  readonly verifiedStepIndex: number;
  readonly receiptId: string;
  readonly evidenceKind: CapabilityEvidenceType;
  readonly receiptCommitment: string;
}

// ── the canonical output envelope ──────────────────────────────────────────
export interface CompiledAnswerEnvelope {
  readonly contractVersion: typeof INTELLIGENCE_CONTRACT_VERSION;
  readonly compilerVersion: typeof IC02_COMPILER_VERSION;
  readonly templateCatalogVersion: typeof IC02_TEMPLATE_CATALOG_VERSION;
  readonly answerId: string;
  readonly planId: string;
  readonly binding: TrustedBinding;
  readonly compiledOutcome: CompiledOutcome;
  readonly disposition: "IC02_ACCEPTED";
  readonly language: LiveAiLanguage;
  readonly semanticAtoms: readonly Ic02SemanticAtom[];
  readonly evidenceCommitments: readonly Ic02EvidenceCommitment[];
  readonly canonicalText: string;
  readonly semanticHash: string;
  readonly textHash: string;
}

export type Ic02CompilationResult =
  | { readonly disposition: "IC02_ACCEPTED"; readonly envelope: CompiledAnswerEnvelope }
  | { readonly disposition: "IC02_REJECTED"; readonly rejectCode: Ic02RejectCode };

export type Ic02EnvelopeVerification =
  | { readonly ok: true; readonly envelope: CompiledAnswerEnvelope }
  | { readonly ok: false; readonly rejectCode: Ic02RejectCode };

// ═══════════════════════════ pure helpers ═════════════════════════════════
function deepFreeze<T>(o: T): T {
  if (o && typeof o === "object" && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const k of Object.keys(o as Record<string, unknown>)) deepFreeze((o as Record<string, unknown>)[k]);
  }
  return o;
}
function isIntIn(v: unknown, lo: number, hi: number): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi;
}
function isStepIndex(v: unknown): v is number {
  return isIntIn(v, 0, IC01_LIMITS.MAX_PLAN_STEPS - 1);
}
function isHex64(v: unknown): v is string { return typeof v === "string" && HEX64_RE.test(v); }

/** Strict ordinary-array snapshot to a fresh inert array of own DATA values, or
 *  null. Rejects a non-Array / subclass / accessor length / accessor or hole
 *  index / symbol or stray key / over-bound length / hostile trap. Never invokes
 *  a caller-owned method. (Structural mirror of the accepted schema pattern.) */
function strictArray(x: unknown, max: number): unknown[] | null {
  try {
    if (!Array.isArray(x) || Object.getPrototypeOf(x) !== Array.prototype) return null;
    const lenDesc = Object.getOwnPropertyDescriptor(x, "length");
    if (!lenDesc || typeof lenDesc.get === "function" || typeof lenDesc.set === "function" || !("value" in lenDesc)) return null;
    const len = lenDesc.value;
    if (typeof len !== "number" || !Number.isInteger(len) || len < 0 || len > max) return null;
    for (const k of Reflect.ownKeys(x)) {
      if (k === "length") continue;
      if (typeof k === "symbol") return null;
      const n = Number(k);
      if (!(String(n) === k && Number.isInteger(n) && n >= 0 && n < len)) return null;
    }
    const out: unknown[] = [];
    for (let i = 0; i < len; i++) {
      const d = Object.getOwnPropertyDescriptor(x, i);
      if (!d || typeof d.get === "function" || typeof d.set === "function" || !("value" in d)) return null;
      out.push(d.value);
    }
    return out;
  } catch { return null; }
}

function bindingEqual(a: TrustedBinding, b: TrustedBinding): boolean {
  return a.sessionId === b.sessionId && a.turnId === b.turnId && a.generation === b.generation &&
    a.pageId === b.pageId && a.role === b.role && a.routeEpoch === b.routeEpoch &&
    a.contextRevision === b.contextRevision && a.authorityRef === b.authorityRef && a.contextDigest === b.contextDigest;
}
// A result/source authority is coherent with the trusted binding when its 6
// authority-bearing fields equal the binding's (the fields both structures share).
function authorityMatchesBinding(ra: ResultAuthorityShape, b: TrustedBinding): boolean {
  return ra.turnId === b.turnId && ra.generation === b.generation && ra.routeEpoch === b.routeEpoch &&
    ra.contextRevision === b.contextRevision && ra.authorityRef === b.authorityRef && ra.contextDigest === b.contextDigest;
}

// ── strict evidence re-validation (structural mirror of the R5B evidence shape;
//    returns a FRESH deeply-frozen own-data copy = deep copy + immutability) ──
function validateIc02Evidence(kind: CapabilityEvidenceType, x: unknown): Record<string, unknown> | null {
  try {
    if (kind === "results") {
      const a = strictRecord(x, ["kind", "count", "orderedIds"]);
      if (!a || a.kind !== "results" || !isIntIn(a.count, 0, MAX_VISIBLE_HOTELS)) return null;
      const ids = strictArray(a.orderedIds, MAX_VISIBLE_HOTELS);
      if (!ids || ids.length !== a.count) return null;
      const seen = new Set<string>(); const out: string[] = [];
      for (const id of ids) { if (!isHotelId(id) || seen.has(id as string)) return null; seen.add(id as string); out.push(id as string); }
      return deepFreeze({ kind: "results", count: a.count as number, orderedIds: out });
    }
    if (kind === "comparison") {
      const a = strictRecord(x, ["kind", "positions", "hotelIds", "factors", "cheapestPosition", "topRatedPosition"]);
      if (!a || a.kind !== "comparison") return null;
      const pos = strictArray(a.positions, MAX_SELECTED_HOTELS);
      if (!pos || pos.length < 2 || pos.length > MAX_SELECTED_HOTELS) return null;
      for (const p of pos) if (!isIntIn(p, 1, MAX_VISIBLE_HOTELS)) return null;
      const ids = strictArray(a.hotelIds, MAX_SELECTED_HOTELS);
      if (!ids || ids.length !== pos.length) return null;
      const seenIds = new Set<string>(); const outIds: string[] = [];
      for (const id of ids) { if (!isHotelId(id) || seenIds.has(id as string)) return null; seenIds.add(id as string); outIds.push(id as string); }
      const facs = strictArray(a.factors, COMPARISON_FACTORS.length);
      if (!facs || facs.length < 1) return null;
      const seenF = new Set<string>(); const outF: string[] = [];
      for (const f of facs) { if (typeof f !== "string" || !(COMPARISON_FACTORS as readonly string[]).includes(f) || seenF.has(f)) return null; seenF.add(f); outF.push(f); }
      if (!(a.cheapestPosition === null || isIntIn(a.cheapestPosition, 1, MAX_VISIBLE_HOTELS))) return null;
      if (!(a.topRatedPosition === null || isIntIn(a.topRatedPosition, 1, MAX_VISIBLE_HOTELS))) return null;
      return deepFreeze({ kind: "comparison", positions: pos as number[], hotelIds: outIds, factors: outF, cheapestPosition: a.cheapestPosition as number | null, topRatedPosition: a.topRatedPosition as number | null });
    }
    if (kind === "detail") {
      const a = strictRecord(x, ["kind", "hotelId", "breakfast", "parking"]);
      if (!a || a.kind !== "detail" || !isHotelId(a.hotelId)) return null;
      if (!(FACILITY_STATES as readonly string[]).includes(a.breakfast as string)) return null;
      if (!(FACILITY_STATES as readonly string[]).includes(a.parking as string)) return null;
      return deepFreeze({ kind: "detail", hotelId: a.hotelId as string, breakfast: a.breakfast as string, parking: a.parking as string });
    }
    if (kind === "ui_state") {
      const a = strictRecord(x, ["kind", "section", "hotelId"]);
      if (!a || a.kind !== "ui_state" || (a.section !== "rooms" && a.section !== "about") || !isHotelId(a.hotelId)) return null;
      return deepFreeze({ kind: "ui_state", section: a.section as string, hotelId: a.hotelId as string });
    }
    if (kind === "navigation") {
      const a = strictRecord(x, ["kind", "hotelId", "position"]);
      if (!a || a.kind !== "navigation" || !isHotelId(a.hotelId) || !isIntIn(a.position, 1, MAX_VISIBLE_HOTELS)) return null;
      return deepFreeze({ kind: "navigation", hotelId: a.hotelId as string, position: a.position as number });
    }
    return null;
  } catch { return null; }
}

// ── P1-01 — build/validate ONE complete immutable verified-evidence record ──
// TOTAL + fail-closed. Never admits a PARTIAL record; a missing/hostile field →
// null (the whole record is inadmissible). Deep-copies + deeply-freezes every
// nested trusted value; the capability↔evidenceKind binding is re-enforced.
export function buildVerifiedEvidenceRecord(input: unknown): IC02VerifiedEvidenceRecord | null {
  try {
    const a = strictRecord(input, RECORD_KEYS);
    if (!a) return null;
    if (!isStepIndex(a.verifiedStepIndex)) return null;
    if (!isId(a.receiptId)) return null;
    if (typeof a.capabilityId !== "string") return null;
    const cap = getCapability(a.capabilityId);
    if (!cap) return null;
    // P1-01 — record the ACTUAL verified evidence kind, and require it be ADMISSIBLE for this
    // capability per the ACCEPTED authority (evidenceMatchesOperation — e.g. OPEN may verify with
    // navigation OR detail). validateIc02Evidence additionally requires evidence.kind === evidenceKind.
    if (typeof a.evidenceKind !== "string" || !(EVIDENCE_KINDS as readonly string[]).includes(a.evidenceKind)) return null;
    const evidence = validateIc02Evidence(a.evidenceKind as CapabilityEvidenceType, a.evidence);
    if (!evidence) return null;
    if (!evidenceMatchesOperation(cap.capabilityId, evidence as { kind?: unknown })) return null;
    if (!isHex64(a.receiptCommitment)) return null;
    const sourceAuthority = validateResultAuthority(a.sourceAuthority);
    if (!sourceAuthority) return null;
    // P1-01 — a VERIFIED provenance record REQUIRES a validated NON-NULL result authority (the accepted
    // IC01 VERIFIED lifecycle always carries one). A null/absent result authority is inadmissible.
    if (a.resultAuthority === null) return null;
    const resultAuthority = validateResultAuthority(a.resultAuthority);
    if (!resultAuthority) return null;
    const binding = validateTrustedBinding(a.binding);
    if (!binding) return null;
    const record: IC02VerifiedEvidenceRecord = {
      verifiedStepIndex: a.verifiedStepIndex as number,
      receiptId: a.receiptId as string,
      capabilityId: cap.capabilityId,
      evidenceKind: a.evidenceKind as CapabilityEvidenceType,
      evidence,
      receiptCommitment: a.receiptCommitment as string,
      sourceAuthority,
      resultAuthority,
      binding,
    };
    return deepFreeze(record);
  } catch { return null; }
}
// A record arriving over a boundary (into a compile request) is re-validated by
// the SAME strict, deep-copying builder — there is ONE record admission rule.
export const validateVerifiedEvidenceRecord = buildVerifiedEvidenceRecord;

// ── strict terminal-descriptor re-validation (reuse IC01 closed vocabularies) ──
export function validateIc02TerminalDescriptor(x: unknown): Ic02TerminalDescriptor | null {
  try {
    const kindDesc = x && typeof x === "object" ? Object.getOwnPropertyDescriptor(x, "kind") : undefined;
    if (!kindDesc || !("value" in kindDesc)) return null;
    const kind = kindDesc.value;
    if (kind === "RESPOND") {
      const a = strictRecord(x, ["kind", "language", "claims"]);
      if (!a || !isLanguage(a.language)) return null;
      const raw = strictArray(a.claims, IC02_MAX_RESPONSE_CLAIMS);
      if (!raw || raw.length < 1) return null;
      const claims: Ic02ResponseClaim[] = [];
      for (const c of raw) {
        const claim = validateResponseClaim(c);
        if (!claim) return null;
        claims.push(claim);
      }
      return deepFreeze({ kind: "RESPOND", language: a.language as LiveAiLanguage, claims });
    }
    if (kind === "CLARIFY") {
      const a = strictRecord(x, ["kind", "reason", "language"]);
      if (!a || !isLanguage(a.language)) return null;
      if (typeof a.reason !== "string" || !(CLARIFY_REASONS as readonly string[]).includes(a.reason)) return null;
      return deepFreeze({ kind: "CLARIFY", reason: a.reason as ClarifyReason, language: a.language as LiveAiLanguage });
    }
    if (kind === "ESCALATE_TO_HUMAN") {
      const a = strictRecord(x, ["kind", "escalation", "language"]);
      if (!a || !isLanguage(a.language)) return null;
      if (typeof a.escalation !== "string" || !(ESCALATION_REASONS as readonly string[]).includes(a.escalation)) return null;
      return deepFreeze({ kind: "ESCALATE_TO_HUMAN", escalation: a.escalation as EscalationReason, language: a.language as LiveAiLanguage });
    }
    return null;
  } catch { return null; }
}
function validateResponseClaim(x: unknown): Ic02ResponseClaim | null {
  const kindDesc = x && typeof x === "object" ? Object.getOwnPropertyDescriptor(x, "kind") : undefined;
  if (!kindDesc || !("value" in kindDesc)) return null;
  const kind = kindDesc.value;
  if (kind === "fact") {
    const a = strictRecord(x, ["kind", "answer", "groundedInStep"]);
    if (!a) return null;
    if (typeof a.answer !== "string" || !(FACT_ANSWER_KINDS as readonly string[]).includes(a.answer)) return null;
    if (!isStepIndex(a.groundedInStep)) return null;
    return deepFreeze({ kind: "fact", answer: a.answer as FactAnswerKind, groundedInStep: a.groundedInStep as number });
  }
  if (kind === "advice") {
    const a = strictRecord(x, ["kind", "advice", "positions"]);
    if (!a) return null;
    if (typeof a.advice !== "string" || !(ADVICE_INTENTS as readonly string[]).includes(a.advice)) return null;
    const posRaw = strictArray(a.positions, MAX_SELECTED_HOTELS);
    if (!posRaw) return null;
    const seen = new Set<number>(); const positions: number[] = [];
    for (const p of posRaw) { if (!isIntIn(p, 1, MAX_VISIBLE_HOTELS) || seen.has(p)) return null; seen.add(p); positions.push(p); }
    return deepFreeze({ kind: "advice", advice: a.advice as AdviceIntent, positions });
  }
  return null;
}

// ═══════════════════════ DETERMINISTIC template catalog ════════════════════
// Every atom renders from its OWN semantic value in EXACTLY the requested
// language — never falling back to another language (P1-02 / §12). Numbers,
// sections, positions and facility states are woven VERBATIM so a factual value
// never drifts across a locale. renderAtom returns null ONLY when the requested
// language is not in the catalog (→ fail-closed locale coverage) or a required
// value cannot be extracted (→ render failure) — never another language's text.
type Lang = LiveAiLanguage;
function tri(lang: Lang, en: string, hinglish: string, hi: string): string | null {
  if (lang === "en") return en;
  if (lang === "hinglish") return hinglish;
  if (lang === "hi") return hi;
  return null; // an unsupported language never silently falls back
}
function facilityLabel(topic: string, lang: Lang): string | null {
  if (topic === "breakfast") return tri(lang, "Breakfast", "Breakfast", "नाश्ता");
  if (topic === "parking") return tri(lang, "Parking", "Parking", "पार्किंग");
  return null;
}
function facilityClause(topic: string, state: string, lang: Lang): string | null {
  const label = facilityLabel(topic, lang);
  if (label === null) return null;
  if (state === "present") return tri(lang, `${label} is available`, `${label} available hai`, `${label} उपलब्ध है`);
  if (state === "absent") return tri(lang, `${label} is not available`, `${label} available nahi hai`, `${label} उपलब्ध नहीं है`);
  return null; // "unknown" is never rendered as a fact clause (it becomes an uncertainty atom)
}

export function ic02RenderAtom(atom: Ic02SemanticAtom, lang: Lang): string | null {
  try {
    if (!(IC02_TEMPLATE_LANGUAGES as readonly string[]).includes(lang)) return null; // locale coverage
    switch (atom.kind) {
      case "IC02_FACT_ATOM": {
        const v = atom.value;
        switch (atom.answer) {
          case "results_summary": {
            const c = v.count;
            if (!isIntIn(c, 0, MAX_VISIBLE_HOTELS)) return null;
            return tri(lang, `${c} matching stays are shown.`, `Screen par ${c} stays dikhaye gaye hain.`, `स्क्रीन पर ${c} स्टे दिखाए गए हैं।`);
          }
          case "comparison_summary": {
            const n = v.comparedCount;
            if (!isIntIn(n, 2, MAX_SELECTED_HOTELS)) return null;
            return tri(lang, `Compared ${n} stays on screen.`, `${n} stays compare kiye gaye.`, `${n} स्टे की तुलना की गई।`);
          }
          case "hotel_facts": {
            const clauses: string[] = [];
            for (const topic of ["breakfast", "parking"]) {
              const st = v[topic];
              if (st === "present" || st === "absent") {
                const cl = facilityClause(topic, st, lang);
                if (cl === null) return null;
                clauses.push(cl);
              }
            }
            if (clauses.length === 0) return null; // a hotel_facts FACT atom is only emitted with ≥1 known facility
            return clauses.join("; ") + ".";
          }
          case "section_shown": {
            const s = v.section;
            if (s !== "rooms" && s !== "about") return null;
            return tri(lang, `Showing the ${s} section.`, `${s} section dikhaya ja raha hai.`, `${s} सेक्शन दिखाया जा रहा है।`);
          }
          case "hotel_opened": {
            const p = v.position;
            if (!isIntIn(p, 1, MAX_VISIBLE_HOTELS)) return null;
            return tri(lang, `Opened the stay at position ${p}.`, `Position ${p} ka stay khola gaya.`, `स्थान ${p} पर स्टे खोला गया।`);
          }
          default: return null;
        }
      }
      case "IC02_UNCERTAINTY_ATOM": {
        const label = facilityLabel(atom.topic, lang);
        if (label === null) return null;
        return tri(lang, `${label} availability is not specified.`, `${label} availability specified nahi hai.`, `${label} की जानकारी उपलब्ध नहीं है।`);
      }
      case "IC02_ADVICE_ATOM": {
        const ps = atom.positions.filter((p) => isIntIn(p, 1, MAX_VISIBLE_HOTELS));
        const list = ps.join(", ");
        const at = ps.length
          ? (tri(lang, ` (positions ${list})`, ` (position ${list})`, ` (स्थान ${list})`) as string)
          : "";
        switch (atom.advice) {
          case "consider_visible_options":
            return tri(lang, `You could consider the options shown${at}.`, `Aap shown options consider kar sakte hain${at}.`, `आप दिखाए गए विकल्पों पर विचार कर सकते हैं${at}।`);
          case "compare_before_choosing":
            return tri(lang, `You may want to compare these before choosing${at}.`, `Choose karne se pehle inhe compare karna theek rahega${at}.`, `चुनने से पहले इनकी तुलना करना ठीक रहेगा${at}।`);
          case "refine_for_better_match":
            return tri(lang, `You could refine the search for a closer match.`, `Behtar match ke liye aap search aur refine kar sakte hain.`, `बेहतर मेल के लिए आप खोज को और परिष्कृत कर सकते हैं।`);
          case "ask_if_more_detail_needed":
            return tri(lang, `I can show more detail on any of these if you'd like${at}.`, `Kisi bhi option ka zyada detail chahiye to main dikha sakta hoon${at}.`, `किसी भी विकल्प का अधिक विवरण चाहिए तो मैं दिखा सकता हूँ${at}।`);
          default: return null;
        }
      }
      case "IC02_GLUE_ATOM": {
        if (atom.role === "clarification") return renderClarifyReason(atom.code, lang);
        if (atom.role === "escalation") return renderEscalationReason(atom.code, lang);
        return null;
      }
      case "IC02_DERIVATION_ATOM":
        // No derivation is emitted in IC02 v1 (see computeDerivations). The render
        // path exists for completeness but is unreachable through compileAnswer.
        return null;
      default:
        return null;
    }
  } catch { return null; }
}
function renderClarifyReason(reason: string, lang: Lang): string | null {
  switch (reason) {
    case "MISSING_DESTINATION": return tri(lang, "Which city are you looking at?", "Kaunsa city dekh rahe hain?", "कौन-सा शहर देख रहे हैं?");
    case "MISSING_SELECTION": return tri(lang, "Which stays should I look at?", "Kaunse stays dekhun?", "किन स्टे को देखूँ?");
    case "AMBIGUOUS_REFERENCE": return tri(lang, "Which one do you mean?", "Aapka matlab kis se hai?", "आपका मतलब किससे है?");
    case "NO_SUPPORTED_CONTEXT": return tri(lang, "Could you open a hotels page first?", "Kya aap pehle hotels page khol sakte hain?", "क्या आप पहले होटल पेज खोल सकते हैं?");
    case "TRANSACTIONAL_NOT_ENABLED": return tri(lang, "I can't do that action here — would you like help browsing or comparing?", "Main yahan wo kaam nahi kar sakta — kya browse ya compare mein help karun?", "मैं यहाँ वह काम नहीं कर सकता — क्या मैं ब्राउज़ या तुलना में मदद करूँ?");
    case "OUT_OF_SCOPE": return tri(lang, "Could you rephrase that as a hotel search or comparison?", "Kya aap ise hotel search ya compare ke roop mein bata sakte hain?", "क्या आप इसे होटल खोज या तुलना के रूप में बता सकते हैं?");
    default: return null;
  }
}
function renderEscalationReason(reason: string, lang: Lang): string | null {
  switch (reason) {
    case "TRANSACTIONAL_REQUEST": return tri(lang, "A StayBid team member can help you with that; I can't do it here.", "Iske liye StayBid team ka member aapki help kar sakta hai; main yahan yeh nahi kar sakta.", "इसके लिए StayBid टीम का सदस्य आपकी मदद कर सकता है; मैं यहाँ यह नहीं कर सकता।");
    case "REPEATED_MISUNDERSTANDING": return tri(lang, "I'm having trouble understanding — a StayBid team member may be able to help.", "Mujhe samajhne mein dikkat ho rahi hai — StayBid team ka member help kar sakta hai.", "मुझे समझने में कठिनाई हो रही है — StayBid टीम का सदस्य मदद कर सकता है।");
    case "COMPLAINT_OR_DISPUTE": return tri(lang, "For a complaint like this, a StayBid team member can help you.", "Aisi complaint ke liye StayBid team ka member aapki help kar sakta hai.", "ऐसी शिकायत के लिए StayBid टीम का सदस्य आपकी मदद कर सकता है।");
    case "OUT_OF_SCOPE_REQUEST": return tri(lang, "That's outside what I can help with here — a StayBid team member may be able to.", "Yeh meri limit se bahar hai — StayBid team ka member help kar sakta hai.", "यह मेरी सीमा से बाहर है — StayBid टीम का सदस्य मदद कर सकता है।");
    default: return null;
  }
}

/** True when the template catalog covers all three languages for every atom
 *  kind exercised by IC02 v1 — used to prove locale coverage completeness. */
export function ic02LocaleCoverageComplete(): boolean {
  return (IC02_TEMPLATE_LANGUAGES as readonly string[]).length === 3 &&
    (IC02_TEMPLATE_LANGUAGES as readonly string[]).includes("en") &&
    (IC02_TEMPLATE_LANGUAGES as readonly string[]).includes("hi") &&
    (IC02_TEMPLATE_LANGUAGES as readonly string[]).includes("hinglish");
}

// ── P1-02 — compiler-owned derivation gate. NEVER model-selectable. Emits a
//    derivation ONLY when an IC01 descriptor's EXACT evidence semantics already
//    support it. In IC02 v1 NO fact-answer descriptor authorizes a compiler-added
//    derivation beyond the directly-supported fact (results/comparison assert a
//    COUNT only; hotel_facts already asserts its tri-state directly; section /
//    position are single values). LOWER_PRICE / HIGHER_RATING (comparison winners)
//    and REQUIRED_FACILITY_PRESENT would exceed the exact descriptor semantic, so
//    they are NOT emitted — fail closed, retain only the directly-supported fact. ──
export function ic02ComputeDerivations(_answer: FactAnswerKind, _evidence: Readonly<Record<string, unknown>>, _stepIndex: number): Ic02DerivationAtom[] {
  return [];
}

// ── semantic-hash preimage (LANGUAGE-INDEPENDENT so identical semantics share
//    one commitment; the rendered text is committed separately by textHash) ──
function semanticPreimage(parts: {
  answerId: string; planId: string; binding: TrustedBinding; compiledOutcome: CompiledOutcome;
  disposition: "IC02_ACCEPTED"; atoms: readonly Ic02SemanticAtom[]; commitments: readonly Ic02EvidenceCommitment[];
}): unknown {
  return {
    kind: "ic02.semantic",
    contractVersion: INTELLIGENCE_CONTRACT_VERSION,
    compilerVersion: IC02_COMPILER_VERSION,
    templateCatalogVersion: IC02_TEMPLATE_CATALOG_VERSION,
    answerId: parts.answerId,
    planId: parts.planId,
    binding: {
      sessionId: parts.binding.sessionId, turnId: parts.binding.turnId, generation: parts.binding.generation,
      pageId: parts.binding.pageId, role: parts.binding.role, routeEpoch: parts.binding.routeEpoch,
      contextRevision: parts.binding.contextRevision, authorityRef: parts.binding.authorityRef, contextDigest: parts.binding.contextDigest,
    },
    compiledOutcome: parts.compiledOutcome,
    disposition: parts.disposition,
    atoms: parts.atoms,
    evidenceCommitments: parts.commitments,
  };
}
function ic02SemanticHash(parts: Parameters<typeof semanticPreimage>[0]): string {
  return sha256Hex(canonicalString(semanticPreimage(parts)));
}
function ic02TextHash(text: string): string { return sha256Hex(text); }

// Pure helper (test/consumer utility): recompute BOTH commitments over an envelope's own fields —
// exactly as a forger would, to prove the verifier's producer-invariants (P1-04) reject an impossible
// envelope EVEN with correctly-recomputed hashes. Hashes are integrity, never authority.
export function ic02RecomputeEnvelopeHashes(env: CompiledAnswerEnvelope): { readonly semanticHash: string; readonly textHash: string } {
  return {
    semanticHash: ic02SemanticHash({
      answerId: env.answerId, planId: env.planId, binding: env.binding,
      compiledOutcome: env.compiledOutcome, disposition: "IC02_ACCEPTED",
      atoms: env.semanticAtoms, commitments: env.evidenceCommitments,
    }),
    textHash: ic02TextHash(env.canonicalText),
  };
}

// Render an ordered atom list into ONE canonical string (each atom in exactly
// `lang`; empty renders filtered; non-empty joined by a single space). Returns
// null with the reason (locale/render) on the first atom that cannot render.
function renderAtoms(atoms: readonly Ic02SemanticAtom[], lang: Lang): { text: string } | { err: Ic02RejectCode } {
  const parts: string[] = [];
  for (const atom of atoms) {
    const t = ic02RenderAtom(atom, lang);
    if (t === null) {
      // A supported requested language means the failure is a value/render failure;
      // an unsupported language would already have been rejected upstream.
      return { err: (IC02_TEMPLATE_LANGUAGES as readonly string[]).includes(lang) ? "IC02_REJECT_RENDER_FAILED" : "IC02_REJECT_LOCALE_COVERAGE" };
    }
    if (t.length > 0) parts.push(t);
  }
  return { text: parts.join(" ") };
}

// ═══════════════════════════ compile request validation ════════════════════
type RequestValidation =
  | { ok: true; req: IC02CompileRequest }
  | { ok: false; rejectCode: Ic02RejectCode };
export function validateCompileRequest(x: unknown): RequestValidation {
  try {
    // P1-03 — enforce the 16 KiB serialized compile-request ceiling on the RAW input FIRST, before any
    // per-field work. Reject, NEVER truncate. A non-serializable request is malformed.
    const rawBytes = measureJsonBytes(x);
    if (rawBytes === null) return { ok: false, rejectCode: "IC02_REJECT_MALFORMED_REQUEST" };
    if (rawBytes > IC02_MAX_COMPILE_REQUEST_BYTES) return { ok: false, rejectCode: "IC02_REJECT_REQUEST_OVERFLOW" };
    const a = strictRecord(x, [
      "contractVersion", "controllerOwnedAnswerId", "controllerOwnedPlanId",
      "trustedCurrentBinding", "acceptedIC01TerminalDescriptor", "verifiedEvidenceRecords", "requestedLanguage",
    ]);
    if (!a) return { ok: false, rejectCode: "IC02_REJECT_MALFORMED_REQUEST" };
    if (a.contractVersion !== INTELLIGENCE_CONTRACT_VERSION) return { ok: false, rejectCode: "IC02_REJECT_CONTRACT_VERSION" };
    if (!isId(a.controllerOwnedAnswerId) || !isId(a.controllerOwnedPlanId)) return { ok: false, rejectCode: "IC02_REJECT_IDENTITY_INVALID" };
    const binding = validateTrustedBinding(a.trustedCurrentBinding);
    if (!binding) return { ok: false, rejectCode: "IC02_REJECT_BINDING_INVALID" };
    if (!isLanguage(a.requestedLanguage)) return { ok: false, rejectCode: "IC02_REJECT_LANGUAGE_UNSUPPORTED" };
    if (!(IC02_TEMPLATE_LANGUAGES as readonly string[]).includes(a.requestedLanguage as string)) return { ok: false, rejectCode: "IC02_REJECT_LOCALE_COVERAGE" };
    const descriptor = validateIc02TerminalDescriptor(a.acceptedIC01TerminalDescriptor);
    if (!descriptor) return { ok: false, rejectCode: "IC02_REJECT_TERMINAL_DESCRIPTOR_INVALID" };
    const rawRecords = strictArray(a.verifiedEvidenceRecords, IC02_MAX_EVIDENCE_RECORDS + 1);
    if (!rawRecords) return { ok: false, rejectCode: "IC02_REJECT_EVIDENCE_RECORD_INVALID" };
    if (rawRecords.length > IC02_MAX_EVIDENCE_RECORDS) return { ok: false, rejectCode: "IC02_REJECT_EVIDENCE_RECORD_OVERFLOW" };
    const records: IC02VerifiedEvidenceRecord[] = [];
    const seenStep = new Set<number>();
    for (const r of rawRecords) {
      const rec = validateVerifiedEvidenceRecord(r);
      if (!rec) return { ok: false, rejectCode: "IC02_REJECT_EVIDENCE_RECORD_INVALID" };
      if (seenStep.has(rec.verifiedStepIndex)) return { ok: false, rejectCode: "IC02_REJECT_CONFLICTING_EVIDENCE" }; // one record per verified step
      seenStep.add(rec.verifiedStepIndex);
      records.push(rec);
    }
    const req: IC02CompileRequest = deepFreeze({
      contractVersion: INTELLIGENCE_CONTRACT_VERSION,
      controllerOwnedAnswerId: a.controllerOwnedAnswerId as string,
      controllerOwnedPlanId: a.controllerOwnedPlanId as string,
      trustedCurrentBinding: binding,
      acceptedIC01TerminalDescriptor: descriptor,
      verifiedEvidenceRecords: records,
      requestedLanguage: a.requestedLanguage as LiveAiLanguage,
    });
    // Inherited serialized-size bound — reject, NEVER truncate.
    const bytes = measureJsonBytes(req);
    if (bytes === null || bytes > IC02_MAX_COMPILE_REQUEST_BYTES) return { ok: false, rejectCode: "IC02_REJECT_REQUEST_OVERFLOW" };
    return { ok: true, req };
  } catch { return { ok: false, rejectCode: "IC02_REJECT_COMPILER_EXCEPTION" }; }
}

// ═══════════════════════════ the compiler ══════════════════════════════════
function reject(code: Ic02RejectCode): Ic02CompilationResult { return { disposition: "IC02_REJECTED", rejectCode: code }; }

export function compileAnswer(x: unknown): Ic02CompilationResult {
  try {
    const v = validateCompileRequest(x);
    if (!v.ok) return reject(v.rejectCode);
    const req = v.req;
    const binding = req.trustedCurrentBinding;
    const lang = req.requestedLanguage;

    // Every retained record MUST reflect the CURRENT binding + authority (no
    // mutation between verification and compilation; no stale/foreign authority).
    const byStep = new Map<number, IC02VerifiedEvidenceRecord>();
    for (const rec of req.verifiedEvidenceRecords) {
      if (!bindingEqual(rec.binding, binding)) return reject("IC02_REJECT_STALE_BINDING");
      if (!authorityMatchesBinding(rec.sourceAuthority, binding)) return reject("IC02_REJECT_AUTHORITY_MISMATCH");
      if (!authorityMatchesBinding(rec.resultAuthority, binding)) return reject("IC02_REJECT_AUTHORITY_MISMATCH");
      byStep.set(rec.verifiedStepIndex, rec);
    }

    const descriptor = req.acceptedIC01TerminalDescriptor;
    let compiledOutcome: CompiledOutcome;
    const atoms: Ic02SemanticAtom[] = [];
    const commitments: Ic02EvidenceCommitment[] = [];
    const commitmentSteps = new Set<number>();
    const addCommitment = (rec: IC02VerifiedEvidenceRecord): void => {
      if (commitmentSteps.has(rec.verifiedStepIndex)) return;
      commitmentSteps.add(rec.verifiedStepIndex);
      commitments.push({ verifiedStepIndex: rec.verifiedStepIndex, receiptId: rec.receiptId, evidenceKind: rec.evidenceKind, receiptCommitment: rec.receiptCommitment });
    };

    if (descriptor.kind === "CLARIFY") {
      compiledOutcome = "COMPILED_CLARIFICATION";
      atoms.push({ kind: "IC02_GLUE_ATOM", role: "clarification", code: descriptor.reason });
    } else if (descriptor.kind === "ESCALATE_TO_HUMAN") {
      compiledOutcome = "COMPILED_HUMAN_ESCALATION";
      atoms.push({ kind: "IC02_GLUE_ATOM", role: "escalation", code: descriptor.escalation });
    } else {
      // RESPOND — map each claim to permitted atoms ONLY (fail closed on any gap).
      compiledOutcome = "COMPILED_RESPONSE";
      for (const claim of descriptor.claims) {
        if (claim.kind === "advice") {
          atoms.push({ kind: "IC02_ADVICE_ATOM", advice: claim.advice, positions: claim.positions.slice() });
          continue;
        }
        // fact — REQUIRES verified provenance grounded in the named step.
        const rec = byStep.get(claim.groundedInStep);
        if (!rec) return reject("IC02_REJECT_MISSING_PROVENANCE");
        const requiredKind = FACT_ANSWER_EVIDENCE[claim.answer];
        if (rec.evidenceKind !== requiredKind) return reject("IC02_REJECT_EVIDENCE_KIND_MISMATCH");
        const factAtoms = buildFactAtoms(claim.answer, rec);
        if (!factAtoms) return reject("IC02_REJECT_ENTITY_BINDING");
        for (const fa of factAtoms) atoms.push(fa);
        for (const d of ic02ComputeDerivations(claim.answer, rec.evidence, rec.verifiedStepIndex)) atoms.push(d);
        addCommitment(rec);
      }
      if (atoms.length === 0) return reject("IC02_REJECT_UNSUPPORTED_MAPPING");
    }

    // Sort evidence commitments deterministically by step index.
    commitments.sort((p, q) => p.verifiedStepIndex - q.verifiedStepIndex);

    // Render the canonical text (deterministically, in the requested language only).
    const rendered = renderAtoms(atoms, lang);
    if ("err" in rendered) return reject(rendered.err);
    const canonicalText = rendered.text;
    if (canonicalText.length === 0) return reject("IC02_REJECT_RENDER_FAILED");
    if (Buffer.byteLength(canonicalText, "utf8") > IC02_MAX_CANONICAL_TEXT_BYTES) return reject("IC02_REJECT_OUTPUT_OVERFLOW");

    const frozenAtoms = deepFreeze(atoms.slice()) as readonly Ic02SemanticAtom[];
    const frozenCommitments = deepFreeze(commitments.slice()) as readonly Ic02EvidenceCommitment[];
    // P1-04 — self-check: the compiler's OWN output must satisfy the same closed producer invariants
    // the verifier enforces (so accepted envelopes always verify).
    const selfCheck = validateProducerInvariants(compiledOutcome, frozenAtoms, frozenCommitments);
    if (selfCheck) return reject(selfCheck);
    const semanticHash = ic02SemanticHash({
      answerId: req.controllerOwnedAnswerId, planId: req.controllerOwnedPlanId, binding,
      compiledOutcome, disposition: "IC02_ACCEPTED", atoms: frozenAtoms, commitments: frozenCommitments,
    });
    const textHash = ic02TextHash(canonicalText);

    // Determinism self-check — re-render + re-hash; any divergence fails closed.
    const rerender = renderAtoms(frozenAtoms, lang);
    if ("err" in rerender || rerender.text !== canonicalText) return reject("IC02_REJECT_NONDETERMINISTIC");

    const envelope: CompiledAnswerEnvelope = deepFreeze({
      contractVersion: INTELLIGENCE_CONTRACT_VERSION,
      compilerVersion: IC02_COMPILER_VERSION,
      templateCatalogVersion: IC02_TEMPLATE_CATALOG_VERSION,
      answerId: req.controllerOwnedAnswerId,
      planId: req.controllerOwnedPlanId,
      binding,
      compiledOutcome,
      disposition: "IC02_ACCEPTED",
      language: lang,
      semanticAtoms: frozenAtoms,
      evidenceCommitments: frozenCommitments,
      canonicalText,
      semanticHash,
      textHash,
    });
    const outBytes = measureJsonBytes(envelope);
    if (outBytes === null || outBytes > IC02_MAX_ENVELOPE_BYTES) return reject("IC02_REJECT_OUTPUT_OVERFLOW");
    return { disposition: "IC02_ACCEPTED", envelope };
  } catch { return reject("IC02_REJECT_COMPILER_EXCEPTION"); }
}

// Build the fact atoms for one grounded fact claim. hotel_facts decomposes into
// a FACT atom for the KNOWN facilities (≥1) plus an UNCERTAINTY atom per unknown
// facility — an "unknown" facility is NEVER fabricated as present/absent. Returns
// null (→ entity-binding reject) if a required evidence value is missing.
function buildFactAtoms(answer: FactAnswerKind, rec: IC02VerifiedEvidenceRecord): Ic02SemanticAtom[] | null {
  const ev = rec.evidence;
  const step = rec.verifiedStepIndex;
  switch (answer) {
    case "results_summary": {
      const count = ev.count;
      if (!isIntIn(count, 0, MAX_VISIBLE_HOTELS)) return null;
      return [{ kind: "IC02_FACT_ATOM", answer, evidenceKind: rec.evidenceKind, verifiedStepIndex: step, receiptId: rec.receiptId, value: { count } }];
    }
    case "comparison_summary": {
      const pos = ev.positions;
      if (!Array.isArray(pos) || pos.length < 2) return null;
      return [{ kind: "IC02_FACT_ATOM", answer, evidenceKind: rec.evidenceKind, verifiedStepIndex: step, receiptId: rec.receiptId, value: { comparedCount: pos.length } }];
    }
    case "hotel_facts": {
      const breakfast = ev.breakfast; const parking = ev.parking;
      if (typeof breakfast !== "string" || typeof parking !== "string") return null;
      const out: Ic02SemanticAtom[] = [];
      const known: Record<string, unknown> = {};
      let knownCount = 0;
      for (const topic of ["breakfast", "parking"] as const) {
        const st = topic === "breakfast" ? breakfast : parking;
        if (st === "present" || st === "absent") { known[topic] = st; knownCount += 1; }
      }
      if (knownCount > 0) out.push({ kind: "IC02_FACT_ATOM", answer, evidenceKind: rec.evidenceKind, verifiedStepIndex: step, receiptId: rec.receiptId, value: known });
      if (breakfast === "unknown") out.push({ kind: "IC02_UNCERTAINTY_ATOM", topic: "breakfast", verifiedStepIndex: step });
      if (parking === "unknown") out.push({ kind: "IC02_UNCERTAINTY_ATOM", topic: "parking", verifiedStepIndex: step });
      if (out.length === 0) return null;
      return out;
    }
    case "section_shown": {
      const section = ev.section;
      if (section !== "rooms" && section !== "about") return null;
      return [{ kind: "IC02_FACT_ATOM", answer, evidenceKind: rec.evidenceKind, verifiedStepIndex: step, receiptId: rec.receiptId, value: { section } }];
    }
    case "hotel_opened": {
      const position = ev.position;
      if (!isIntIn(position, 1, MAX_VISIBLE_HOTELS)) return null;
      return [{ kind: "IC02_FACT_ATOM", answer, evidenceKind: rec.evidenceKind, verifiedStepIndex: step, receiptId: rec.receiptId, value: { position } }];
    }
    default:
      return null;
  }
}

// ── P1-04 — CLOSED PRODUCER cross-field invariants ─────────────────────────
// Prove an envelope is one the IC02 v1 compiler could ACTUALLY produce — not merely
// shape-valid + internally rehashed. A fabricated/impossible cross-field structure is
// rejected regardless of a correctly-recomputed hash (hashes are NOT authority). Returns
// a reject code, or null when the outcome/atoms/commitments form a producible v1 envelope.
export function validateProducerInvariants(
  outcome: CompiledOutcome,
  atoms: readonly Ic02SemanticAtom[],
  commitments: readonly Ic02EvidenceCommitment[],
): Ic02RejectCode | null {
  // The IC02 v1 compiler emits NO derivation atom (see ic02ComputeDerivations); a fabricated one
  // is not a v1 artifact even with a valid shape + correct hashes.
  if (atoms.some((a) => a.kind === "IC02_DERIVATION_ATOM")) return "IC02_REJECT_UNSUPPORTED_MAPPING";
  // The preference-match atom is never admitted (shape validation already rejects it; belt-and-braces).
  if (atoms.some((a) => (a as { kind?: unknown }).kind === "IC02_PREFERENCE_MATCH_ATOM")) return "IC02_REJECT_UNSUPPORTED_MAPPING";

  if (outcome === "COMPILED_CLARIFICATION" || outcome === "COMPILED_HUMAN_ESCALATION") {
    // EXACTLY one glue atom of the matching role; NO factual/advice atoms; NO evidence commitments.
    if (commitments.length !== 0) return "IC02_REJECT_UNSUPPORTED_MAPPING";
    if (atoms.length !== 1) return "IC02_REJECT_UNSUPPORTED_MAPPING";
    const only = atoms[0];
    if (only.kind !== "IC02_GLUE_ATOM") return "IC02_REJECT_UNSUPPORTED_MAPPING";
    const role = outcome === "COMPILED_CLARIFICATION" ? "clarification" : "escalation";
    if (only.role !== role) return "IC02_REJECT_UNSUPPORTED_MAPPING";
    return null;
  }

  // COMPILED_RESPONSE — never carries a clarification/escalation glue atom.
  if (atoms.some((a) => a.kind === "IC02_GLUE_ATOM")) return "IC02_REJECT_UNSUPPORTED_MAPPING";
  const byStep = new Map<number, Ic02EvidenceCommitment>();
  for (const c of commitments) byStep.set(c.verifiedStepIndex, c); // (shape validation already forbade duplicate steps)
  const referenced = new Set<number>();
  // Per-step accumulators (plain step-keyed records; no Set/Map iteration) that prove the
  // fact/uncertainty structure is one the hotel_facts producer (buildFactAtoms) can emit:
  // a facility is EITHER a KNOWN fact value (present/absent) OR flagged UNKNOWN, never both.
  const knownFacilitiesByStep: Record<number, string[]> = {};
  const uncertainTopicsByStep: Record<number, string[]> = {};
  for (const atom of atoms) {
    if (atom.kind === "IC02_FACT_ATOM") {
      // every FACT atom's evidence-kind must be EXACTLY the kind its answer requires,
      // and must be backed by a matching commitment (present · exact receipt · exact kind).
      if (atom.evidenceKind !== FACT_ANSWER_EVIDENCE[atom.answer]) return "IC02_REJECT_EVIDENCE_KIND_MISMATCH";
      const c = byStep.get(atom.verifiedStepIndex);
      if (!c) return "IC02_REJECT_MISSING_PROVENANCE";
      if (c.receiptId !== atom.receiptId) return "IC02_REJECT_ENTITY_BINDING";
      if (c.evidenceKind !== atom.evidenceKind) return "IC02_REJECT_EVIDENCE_KIND_MISMATCH";
      referenced.add(atom.verifiedStepIndex);
      // record the KNOWN hotel_facts facilities on this step (for the contradiction pass).
      if (atom.answer === "hotel_facts") {
        const arr = knownFacilitiesByStep[atom.verifiedStepIndex] || (knownFacilitiesByStep[atom.verifiedStepIndex] = []);
        const keys = Object.keys(atom.value);
        for (let i = 0; i < keys.length; i++) arr.push(keys[i]);
      }
    } else if (atom.kind === "IC02_UNCERTAINTY_ATOM") {
      // an UNCERTAINTY atom is producible ONLY from a hotel_facts claim, whose evidence is
      // DETAIL — so its commitment must exist AND be a DETAIL commitment on the same step
      // (a results/comparison/ui_state/navigation-backed "uncertainty" is not a v1 artifact).
      const c = byStep.get(atom.verifiedStepIndex);
      if (!c) return "IC02_REJECT_MISSING_PROVENANCE";
      if (c.evidenceKind !== "detail") return "IC02_REJECT_EVIDENCE_KIND_MISMATCH";
      // the producer emits at most ONE uncertainty atom per facility per step.
      const arr = uncertainTopicsByStep[atom.verifiedStepIndex] || (uncertainTopicsByStep[atom.verifiedStepIndex] = []);
      if (arr.indexOf(atom.topic) !== -1) return "IC02_REJECT_CONFLICTING_EVIDENCE";
      arr.push(atom.topic);
      referenced.add(atom.verifiedStepIndex);
    }
    // advice atoms carry NO evidence commitment (fine).
  }
  // fact/uncertainty contradiction: a facility cannot be BOTH a KNOWN value AND flagged
  // UNKNOWN on the same verified step (the producer decides each facility exactly once).
  const uncertainSteps = Object.keys(uncertainTopicsByStep);
  for (let i = 0; i < uncertainSteps.length; i++) {
    const step = Number(uncertainSteps[i]);
    const topics = uncertainTopicsByStep[step];
    const known = knownFacilitiesByStep[step] || [];
    for (let k = 0; k < topics.length; k++) if (known.indexOf(topics[k]) !== -1) return "IC02_REJECT_CONFLICTING_EVIDENCE";
  }
  // FACILITY-STATE COMPLETENESS: buildFactAtoms always receives BOTH breakfast + parking from
  // DETAIL evidence and emits, per facility, exactly one state — KNOWN (present/absent) or
  // UNKNOWN (one uncertainty atom). So on EVERY step carrying hotel_facts semantics, the union of
  // KNOWN facility keys ∪ UNCERTAINTY topics MUST cover BOTH breakfast AND parking. A facility
  // missing from the semantic representation (correctly rehashed, valid DETAIL commitment) is not
  // a producible v1 artifact → fail closed. (The contradiction rule above still forbids double-state.)
  const factsSteps = Object.keys(knownFacilitiesByStep).concat(Object.keys(uncertainTopicsByStep));
  const factsStepSeen: Record<number, boolean> = {};
  for (let i = 0; i < factsSteps.length; i++) {
    const step = Number(factsSteps[i]);
    if (factsStepSeen[step]) continue;
    factsStepSeen[step] = true;
    const known = knownFacilitiesByStep[step] || [];
    const uncertain = uncertainTopicsByStep[step] || [];
    for (const facility of ["breakfast", "parking"] as const) {
      if (known.indexOf(facility) === -1 && uncertain.indexOf(facility) === -1) return "IC02_REJECT_UNSUPPORTED_MAPPING";
    }
  }
  // no ORPHAN/extra commitment — every commitment must back a FACT/UNCERTAINTY atom.
  for (const c of commitments) if (!referenced.has(c.verifiedStepIndex)) return "IC02_REJECT_CONFLICTING_EVIDENCE";
  return null;
}

// P1-04 — a FACT atom's value must EXACTLY match the shape its answer produces. Shape
// validation already snapshotted value to a strictRecord of the allowed key UNION, which
// still admits an empty value, a cross-answer field (e.g. results_summary carrying
// {section}), or an out-of-range/"unknown" value. Here we enforce the per-answer EXACT
// key set + value domain the v1 producer (buildFactAtoms) emits — mirrored by the renderer
// domains — so a forged atom that rehashes correctly but is not producible fails closed.
function validateFactValue(answer: FactAnswerKind, value: Readonly<Record<string, unknown>>): boolean {
  const keys = Object.keys(value);
  switch (answer) {
    case "results_summary":
      return keys.length === 1 && keys[0] === "count" && isIntIn(value.count, 0, MAX_VISIBLE_HOTELS);
    case "comparison_summary":
      return keys.length === 1 && keys[0] === "comparedCount" && isIntIn(value.comparedCount, 2, MAX_SELECTED_HOTELS);
    case "hotel_facts": {
      // ≥1 and ≤2 keys, each EXACTLY breakfast/parking, each EXACTLY present/absent
      // ("unknown" is never a KNOWN fact value — it becomes an uncertainty atom instead).
      if (keys.length < 1 || keys.length > 2) return false;
      for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        if (k !== "breakfast" && k !== "parking") return false;
        const v = value[k];
        if (v !== "present" && v !== "absent") return false;
      }
      return true;
    }
    case "section_shown":
      return keys.length === 1 && keys[0] === "section" && (value.section === "rooms" || value.section === "about");
    case "hotel_opened":
      return keys.length === 1 && keys[0] === "position" && isIntIn(value.position, 1, MAX_VISIBLE_HOTELS);
    default:
      return false;
  }
}

// ═══════════════════════════ the PURE envelope verifier ════════════════════
// Detects tampering in canonicalText, textHash, semanticHash, binding, answer/
// plan identity, evidence commitments, acceptance disposition, version data, a
// nondeterministic rerender, AND impossible cross-field producer structures — by
// re-deriving everything from the atoms + the language-independent semantic fields.
// PURE; NEVER trusts a supplied hash.
export function verifyEnvelope(x: unknown): Ic02EnvelopeVerification {
  try {
    const parsed = validateEnvelopeShape(x);
    if (!parsed.ok) return { ok: false, rejectCode: parsed.rejectCode };
    const env = parsed.env;

    // P1-04 — enforce the CLOSED producer invariants BEFORE (and independent of) the hash checks, so a
    // fabricated cross-field-invalid envelope with correctly-recomputed hashes is still rejected.
    const invariant = validateProducerInvariants(env.compiledOutcome, env.semanticAtoms, env.evidenceCommitments);
    if (invariant) return { ok: false, rejectCode: invariant };

    const semanticHash = ic02SemanticHash({
      answerId: env.answerId, planId: env.planId, binding: env.binding,
      compiledOutcome: env.compiledOutcome, disposition: "IC02_ACCEPTED",
      atoms: env.semanticAtoms, commitments: env.evidenceCommitments,
    });
    if (semanticHash !== env.semanticHash) return { ok: false, rejectCode: "IC02_REJECT_SEMANTIC_HASH" };

    const rerender = renderAtoms(env.semanticAtoms, env.language);
    if ("err" in rerender) return { ok: false, rejectCode: rerender.err };
    if (rerender.text !== env.canonicalText) return { ok: false, rejectCode: "IC02_REJECT_NONDETERMINISTIC" };

    if (ic02TextHash(env.canonicalText) !== env.textHash) return { ok: false, rejectCode: "IC02_REJECT_TEXT_HASH" };

    return { ok: true, envelope: env };
  } catch { return { ok: false, rejectCode: "IC02_REJECT_COMPILER_EXCEPTION" }; }
}

type EnvelopeShape = { ok: true; env: CompiledAnswerEnvelope } | { ok: false; rejectCode: Ic02RejectCode };
function validateEnvelopeShape(x: unknown): EnvelopeShape {
  const a = strictRecord(x, [
    "contractVersion", "compilerVersion", "templateCatalogVersion", "answerId", "planId",
    "binding", "compiledOutcome", "disposition", "language", "semanticAtoms",
    "evidenceCommitments", "canonicalText", "semanticHash", "textHash",
  ]);
  if (!a) return { ok: false, rejectCode: "IC02_REJECT_ENVELOPE_MALFORMED" };
  if (a.contractVersion !== INTELLIGENCE_CONTRACT_VERSION) return { ok: false, rejectCode: "IC02_REJECT_ENVELOPE_UNACCEPTED" };
  if (a.compilerVersion !== IC02_COMPILER_VERSION) return { ok: false, rejectCode: "IC02_REJECT_ENVELOPE_UNACCEPTED" };
  if (a.templateCatalogVersion !== IC02_TEMPLATE_CATALOG_VERSION) return { ok: false, rejectCode: "IC02_REJECT_ENVELOPE_UNACCEPTED" };
  if (a.disposition !== "IC02_ACCEPTED") return { ok: false, rejectCode: "IC02_REJECT_ENVELOPE_UNACCEPTED" };
  if (!isId(a.answerId) || !isId(a.planId)) return { ok: false, rejectCode: "IC02_REJECT_IDENTITY_INVALID" };
  const binding = validateTrustedBinding(a.binding);
  if (!binding) return { ok: false, rejectCode: "IC02_REJECT_BINDING_INVALID" };
  if (typeof a.compiledOutcome !== "string" || !(IC02_COMPILED_OUTCOMES as readonly string[]).includes(a.compiledOutcome)) return { ok: false, rejectCode: "IC02_REJECT_ENVELOPE_MALFORMED" };
  if (!isLanguage(a.language) || !(IC02_TEMPLATE_LANGUAGES as readonly string[]).includes(a.language as string)) return { ok: false, rejectCode: "IC02_REJECT_LOCALE_COVERAGE" };
  const atoms = validateSemanticAtoms(a.semanticAtoms);
  if (!atoms) return { ok: false, rejectCode: "IC02_REJECT_ENVELOPE_MALFORMED" };
  const commitments = validateEvidenceCommitments(a.evidenceCommitments);
  if (!commitments) return { ok: false, rejectCode: "IC02_REJECT_ENVELOPE_MALFORMED" };
  if (typeof a.canonicalText !== "string" || a.canonicalText.length === 0 || Buffer.byteLength(a.canonicalText, "utf8") > IC02_MAX_CANONICAL_TEXT_BYTES) return { ok: false, rejectCode: "IC02_REJECT_ENVELOPE_MALFORMED" };
  if (!isHex64(a.semanticHash) || !isHex64(a.textHash)) return { ok: false, rejectCode: "IC02_REJECT_ENVELOPE_MALFORMED" };
  const env: CompiledAnswerEnvelope = deepFreeze({
    contractVersion: INTELLIGENCE_CONTRACT_VERSION,
    compilerVersion: IC02_COMPILER_VERSION,
    templateCatalogVersion: IC02_TEMPLATE_CATALOG_VERSION,
    answerId: a.answerId as string,
    planId: a.planId as string,
    binding,
    compiledOutcome: a.compiledOutcome as CompiledOutcome,
    disposition: "IC02_ACCEPTED",
    language: a.language as LiveAiLanguage,
    semanticAtoms: atoms,
    evidenceCommitments: commitments,
    canonicalText: a.canonicalText as string,
    semanticHash: a.semanticHash as string,
    textHash: a.textHash as string,
  });
  return { ok: true, env };
}
function validateSemanticAtoms(x: unknown): Ic02SemanticAtom[] | null {
  const raw = strictArray(x, IC02_MAX_RESPONSE_CLAIMS * 3 + 4);
  if (!raw || raw.length < 1) return null;
  const out: Ic02SemanticAtom[] = [];
  for (const r of raw) { const atom = validateSemanticAtom(r); if (!atom) return null; out.push(atom); }
  return out;
}
function validateSemanticAtom(x: unknown): Ic02SemanticAtom | null {
  const kindDesc = x && typeof x === "object" ? Object.getOwnPropertyDescriptor(x, "kind") : undefined;
  if (!kindDesc || !("value" in kindDesc)) return null;
  const kind = kindDesc.value;
  if (kind === "IC02_FACT_ATOM") {
    const a = strictRecord(x, ["kind", "answer", "evidenceKind", "verifiedStepIndex", "receiptId", "value"]);
    if (!a) return null;
    if (typeof a.answer !== "string" || !(FACT_ANSWER_KINDS as readonly string[]).includes(a.answer)) return null;
    if (typeof a.evidenceKind !== "string" || a.evidenceKind !== FACT_ANSWER_EVIDENCE[a.answer as FactAnswerKind]) return null;
    if (!isStepIndex(a.verifiedStepIndex) || !isId(a.receiptId)) return null;
    const value = strictRecord(a.value, ["count", "comparedCount", "breakfast", "parking", "section", "position"]);
    if (!value) return null;
    // P1-04 — the value must EXACTLY match the per-answer shape the v1 producer emits
    // (exact key set + domain); an empty/cross-answer/out-of-range/"unknown" value fails closed.
    if (!validateFactValue(a.answer as FactAnswerKind, value)) return null;
    return deepFreeze({ kind: "IC02_FACT_ATOM", answer: a.answer as FactAnswerKind, evidenceKind: a.evidenceKind as CapabilityEvidenceType, verifiedStepIndex: a.verifiedStepIndex as number, receiptId: a.receiptId as string, value }) as Ic02FactAtom;
  }
  if (kind === "IC02_UNCERTAINTY_ATOM") {
    const a = strictRecord(x, ["kind", "topic", "verifiedStepIndex"]);
    if (!a || (a.topic !== "breakfast" && a.topic !== "parking") || !isStepIndex(a.verifiedStepIndex)) return null;
    return deepFreeze({ kind: "IC02_UNCERTAINTY_ATOM", topic: a.topic as string, verifiedStepIndex: a.verifiedStepIndex as number }) as Ic02UncertaintyAtom;
  }
  if (kind === "IC02_ADVICE_ATOM") {
    const a = strictRecord(x, ["kind", "advice", "positions"]);
    if (!a || typeof a.advice !== "string" || !(ADVICE_INTENTS as readonly string[]).includes(a.advice)) return null;
    const posRaw = strictArray(a.positions, MAX_SELECTED_HOTELS);
    if (!posRaw) return null;
    const seen = new Set<number>(); const positions: number[] = [];
    for (const p of posRaw) { if (!isIntIn(p, 1, MAX_VISIBLE_HOTELS) || seen.has(p)) return null; seen.add(p); positions.push(p); }
    return deepFreeze({ kind: "IC02_ADVICE_ATOM", advice: a.advice as AdviceIntent, positions }) as Ic02AdviceAtom;
  }
  if (kind === "IC02_GLUE_ATOM") {
    const a = strictRecord(x, ["kind", "role", "code"]);
    if (!a) return null;
    if (a.role === "clarification") { if (typeof a.code !== "string" || !(CLARIFY_REASONS as readonly string[]).includes(a.code)) return null; }
    else if (a.role === "escalation") { if (typeof a.code !== "string" || !(ESCALATION_REASONS as readonly string[]).includes(a.code)) return null; }
    else return null;
    return deepFreeze({ kind: "IC02_GLUE_ATOM", role: a.role as "clarification" | "escalation", code: a.code as string }) as Ic02GlueAtom;
  }
  // IC02_DERIVATION_ATOM is not emitted in v1; an envelope carrying one is not a
  // v1 artifact. IC02_PREFERENCE_MATCH_ATOM is never admitted. Both fail closed.
  return null;
}
function validateEvidenceCommitments(x: unknown): Ic02EvidenceCommitment[] | null {
  const raw = strictArray(x, IC02_MAX_EVIDENCE_RECORDS);
  if (!raw) return null;
  const out: Ic02EvidenceCommitment[] = [];
  const seen = new Set<number>();
  for (const r of raw) {
    const a = strictRecord(r, ["verifiedStepIndex", "receiptId", "evidenceKind", "receiptCommitment"]);
    if (!a || !isStepIndex(a.verifiedStepIndex) || !isId(a.receiptId)) return null;
    if (typeof a.evidenceKind !== "string" || !["results", "comparison", "detail", "ui_state", "navigation"].includes(a.evidenceKind)) return null;
    if (!isHex64(a.receiptCommitment)) return null;
    if (seen.has(a.verifiedStepIndex as number)) return null;
    seen.add(a.verifiedStepIndex as number);
    out.push(deepFreeze({ verifiedStepIndex: a.verifiedStepIndex as number, receiptId: a.receiptId as string, evidenceKind: a.evidenceKind as CapabilityEvidenceType, receiptCommitment: a.receiptCommitment as string }));
  }
  return out;
}
