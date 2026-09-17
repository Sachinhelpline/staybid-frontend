// ─────────────────────────────────────────────────────────────────────────
// StayBid Live AI — LIVE-AI-03B — BROWSER-SAFE compiled-answer consumer / verifier.
//
// The browser cannot depend on the Node IC02 compiler (node:crypto / Buffer). This module
// is a PURE, browser-safe RE-IMPLEMENTATION of the IC02 `verifyEnvelope` consumer path,
// byte-for-byte compatible with the Node verifier (proven by shared golden-fixture PARITY
// tests). It verifies an ALREADY-PRODUCED CompiledAnswerEnvelope and, additionally, that it
// is bound to the CURRENT trusted binding (the stale/foreign-binding check the pure Node
// verifier leaves to its caller). ONLY the verified canonicalText may enter visible UI.
//
// It re-derives EVERYTHING from the atoms + language-independent semantic fields and NEVER
// trusts a supplied hash. Rejects: altered text/hashes, stale/foreign binding, unsupported
// versions, unaccepted disposition, impossible producer structures, missing/legacy envelope.
// NO provenance is reconstructed from mutable browser state. MODEL != AUTHORITY.
// ─────────────────────────────────────────────────────────────────────────

// ══════════════════════════ pinned versions + closed vocab ═════════════════
export const IC02_CONTRACT_VERSION = "staybid-intelligence.v1";
export const IC02_COMPILER_VERSION = "staybid-answer-compiler.v1";
export const IC02_TEMPLATE_CATALOG_VERSION = "staybid-answer-templates.v1";
export const IC02_TEMPLATE_LANGUAGES = ["en", "hi", "hinglish"] as const;
export const IC02_COMPILED_OUTCOMES = ["COMPILED_RESPONSE", "COMPILED_CLARIFICATION", "COMPILED_HUMAN_ESCALATION"] as const;
const FACT_ANSWER_KINDS = ["results_summary", "comparison_summary", "hotel_facts", "section_shown", "hotel_opened"] as const;
const FACT_ANSWER_EVIDENCE: Record<string, string> = Object.freeze({
  results_summary: "results", comparison_summary: "comparison", hotel_facts: "detail", section_shown: "ui_state", hotel_opened: "navigation",
});
const ADVICE_INTENTS = ["consider_visible_options", "compare_before_choosing", "refine_for_better_match", "ask_if_more_detail_needed"] as const;
const CLARIFY_REASONS = ["MISSING_DESTINATION", "MISSING_SELECTION", "AMBIGUOUS_REFERENCE", "NO_SUPPORTED_CONTEXT", "TRANSACTIONAL_NOT_ENABLED", "OUT_OF_SCOPE"] as const;
const ESCALATION_REASONS = ["TRANSACTIONAL_REQUEST", "REPEATED_MISUNDERSTANDING", "COMPLAINT_OR_DISPUTE", "OUT_OF_SCOPE_REQUEST"] as const;
const EVIDENCE_KINDS = ["results", "comparison", "detail", "ui_state", "navigation"] as const;
const MAX_VISIBLE_HOTELS = 24;
const MAX_SELECTED_HOTELS = 4;
const MAX_EVIDENCE_RECORDS = 8;
const MAX_RESPONSE_CLAIMS = 8;
const MAX_CANONICAL_TEXT_BYTES = 4000;
const HEX64_RE = /^[0-9a-f]{64}$/;
const ID_RE = /^[A-Za-z0-9._:-]+$/;

export type Ic02RejectCode =
  | "IC02_REJECT_ENVELOPE_MALFORMED" | "IC02_REJECT_ENVELOPE_UNACCEPTED" | "IC02_REJECT_IDENTITY_INVALID"
  | "IC02_REJECT_BINDING_INVALID" | "IC02_REJECT_LOCALE_COVERAGE" | "IC02_REJECT_SEMANTIC_HASH"
  | "IC02_REJECT_TEXT_HASH" | "IC02_REJECT_NONDETERMINISTIC" | "IC02_REJECT_RENDER_FAILED"
  | "IC02_REJECT_UNSUPPORTED_MAPPING" | "IC02_REJECT_EVIDENCE_KIND_MISMATCH" | "IC02_REJECT_MISSING_PROVENANCE"
  | "IC02_REJECT_ENTITY_BINDING" | "IC02_REJECT_CONFLICTING_EVIDENCE" | "IC02_REJECT_COMPILER_EXCEPTION"
  | "IC02_REJECT_STALE_BINDING";

export interface ConsumerBinding {
  readonly sessionId: string; readonly turnId: string; readonly generation: number;
  readonly pageId: "hotels" | "hotel-detail"; readonly role: "anonymous" | "customer";
  readonly routeEpoch: number; readonly contextRevision: string; readonly authorityRef: string; readonly contextDigest: string;
}
export type CompiledAnswerVerification =
  | { readonly ok: true; readonly canonicalText: string }
  | { readonly ok: false; readonly rejectCode: Ic02RejectCode };

// ══════════════════════════ pure-JS SHA-256 (sync, browser-safe) ═══════════
// A standard SHA-256 over the UTF-8 bytes of the input, returning a lowercase hex digest —
// byte-identical to Node `createHash("sha256").update(input,"utf8").digest("hex")`.
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
function utf8Bytes(str: string): Uint8Array {
  if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(str);
  // conservative fallback
  const bin = unescape(encodeURIComponent(str));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i) & 0xff;
  return out;
}
export function utf8ByteLength(str: string): number { return utf8Bytes(str).length; }
export function sha256Hex(input: string): string {
  const msg = utf8Bytes(input);
  const l = msg.length;
  const bitLen = l * 8;
  const withOne = l + 1;
  const total = withOne + ((56 - (withOne % 64) + 64) % 64) + 8;
  const buf = new Uint8Array(total);
  buf.set(msg);
  buf[l] = 0x80;
  // 64-bit big-endian length (high 32 bits are 0 for our sizes)
  const hi = Math.floor(bitLen / 0x100000000);
  const lo = bitLen >>> 0;
  buf[total - 8] = (hi >>> 24) & 0xff; buf[total - 7] = (hi >>> 16) & 0xff; buf[total - 6] = (hi >>> 8) & 0xff; buf[total - 5] = hi & 0xff;
  buf[total - 4] = (lo >>> 24) & 0xff; buf[total - 3] = (lo >>> 16) & 0xff; buf[total - 2] = (lo >>> 8) & 0xff; buf[total - 1] = lo & 0xff;
  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a, h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = (buf[off + i * 4] << 24) | (buf[off + i * 4 + 1] << 16) | (buf[off + i * 4 + 2] << 8) | (buf[off + i * 4 + 3]);
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i] + w[i]) | 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0;
  }
  const toHex = (n: number) => (n >>> 0).toString(16).padStart(8, "0");
  return toHex(h0) + toHex(h1) + toHex(h2) + toHex(h3) + toHex(h4) + toHex(h5) + toHex(h6) + toHex(h7);
}

// ══════════════════════════ canonicalString (mirror of live-ai-schemas) ════
export function canonicalString(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "number" || typeof v === "boolean" || typeof v === "string") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canonicalString).join(",") + "]";
  if (typeof v === "object") {
    const ks = Object.keys(v as Record<string, unknown>).sort();
    return "{" + ks.map((k) => JSON.stringify(k) + ":" + canonicalString((v as Record<string, unknown>)[k])).join(",") + "}";
  }
  return "null";
}

// ══════════════════════════ primitive validators ══════════════════════════
function isId(v: unknown): v is string { return typeof v === "string" && v.length >= 1 && v.length <= 128 && ID_RE.test(v); }
function isHex64(v: unknown): boolean { return typeof v === "string" && HEX64_RE.test(v); }
function isIntIn(v: unknown, lo: number, hi: number): v is number { return typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi; }
function isStepIndex(v: unknown): v is number { return isIntIn(v, 0, 63); }
function isLanguage(v: unknown): boolean { return v === "en" || v === "hi" || v === "hinglish"; }
function isContextRevision(v: unknown): v is string {
  if (typeof v !== "string" || v.length < 1 || v.length > 512) return false;
  for (let i = 0; i < v.length; i++) { const c = v.charCodeAt(i); if (c < 0x20 || c === 0x7f) return false; }
  return true;
}
function strictRecord(x: unknown, allowed: readonly string[]): Record<string, unknown> | null {
  if (!x || typeof x !== "object" || Array.isArray(x)) return null;
  const keys = Object.keys(x as Record<string, unknown>);
  if (keys.length !== allowed.length) return null;
  for (const k of allowed) if (!Object.prototype.hasOwnProperty.call(x, k)) return null;
  return x as Record<string, unknown>;
}
function strictArray(x: unknown, maxLen: number): unknown[] | null {
  if (!Array.isArray(x) || x.length > maxLen) return null;
  return x;
}

// ══════════════════════════ binding ════════════════════════════════════════
function validateBinding(x: unknown): ConsumerBinding | null {
  const a = strictRecord(x, ["sessionId", "turnId", "generation", "pageId", "role", "routeEpoch", "contextRevision", "authorityRef", "contextDigest"]);
  if (!a) return null;
  if (!isId(a.sessionId) || !isId(a.turnId) || !isId(a.authorityRef)) return null;
  if (!isIntIn(a.generation, 0, 2 ** 31 - 1) || !isIntIn(a.routeEpoch, 0, 2 ** 31 - 1)) return null;
  if (a.pageId !== "hotels" && a.pageId !== "hotel-detail") return null;
  if (a.role !== "anonymous" && a.role !== "customer") return null;
  if (!isContextRevision(a.contextRevision)) return null;
  if (!isHex64(a.contextDigest)) return null;
  return Object.freeze({
    sessionId: a.sessionId as string, turnId: a.turnId as string, generation: a.generation as number,
    pageId: a.pageId as "hotels" | "hotel-detail", role: a.role as "anonymous" | "customer",
    routeEpoch: a.routeEpoch as number, contextRevision: a.contextRevision as string,
    authorityRef: a.authorityRef as string, contextDigest: a.contextDigest as string,
  });
}
export function bindingEqual(a: ConsumerBinding, b: ConsumerBinding): boolean {
  return a.sessionId === b.sessionId && a.turnId === b.turnId && a.generation === b.generation &&
    a.pageId === b.pageId && a.role === b.role && a.routeEpoch === b.routeEpoch &&
    a.contextRevision === b.contextRevision && a.authorityRef === b.authorityRef && a.contextDigest === b.contextDigest;
}

// ══════════════════════════ semantic atoms + commitments (mirror) ══════════
type Atom = Record<string, unknown>;
function validateFactValue(answer: string, value: Record<string, unknown>): boolean {
  const keys = Object.keys(value);
  switch (answer) {
    case "results_summary": return keys.length === 1 && keys[0] === "count" && isIntIn(value.count, 0, MAX_VISIBLE_HOTELS);
    case "comparison_summary": return keys.length === 1 && keys[0] === "comparedCount" && isIntIn(value.comparedCount, 2, MAX_SELECTED_HOTELS);
    case "hotel_facts": {
      if (keys.length < 1 || keys.length > 2) return false;
      for (let i = 0; i < keys.length; i++) { const k = keys[i]; if (k !== "breakfast" && k !== "parking") return false; const v = value[k]; if (v !== "present" && v !== "absent") return false; }
      return true;
    }
    case "section_shown": return keys.length === 1 && keys[0] === "section" && (value.section === "rooms" || value.section === "about");
    case "hotel_opened": return keys.length === 1 && keys[0] === "position" && isIntIn(value.position, 1, MAX_VISIBLE_HOTELS);
    default: return false;
  }
}
function validateAtom(x: unknown): Atom | null {
  const kindDesc = x && typeof x === "object" ? Object.getOwnPropertyDescriptor(x, "kind") : undefined;
  if (!kindDesc || !("value" in kindDesc)) return null;
  const kind = kindDesc.value;
  if (kind === "IC02_FACT_ATOM") {
    const a = strictRecord(x, ["kind", "answer", "evidenceKind", "verifiedStepIndex", "receiptId", "value"]);
    if (!a) return null;
    if (typeof a.answer !== "string" || !(FACT_ANSWER_KINDS as readonly string[]).includes(a.answer)) return null;
    if (typeof a.evidenceKind !== "string" || a.evidenceKind !== FACT_ANSWER_EVIDENCE[a.answer as string]) return null;
    if (!isStepIndex(a.verifiedStepIndex) || !isId(a.receiptId)) return null;
    const value = strictRecord(a.value, ["count", "comparedCount", "breakfast", "parking", "section", "position"]);
    // Note: value's strict key set in the Node validator is the SUPERSET; validateFactValue then
    // enforces the exact per-answer subset. Mirror: value must be an object, then per-answer check.
    const vObj = (a.value && typeof a.value === "object" && !Array.isArray(a.value)) ? a.value as Record<string, unknown> : null;
    if (!vObj) return null;
    if (!validateFactValue(a.answer as string, vObj)) return null;
    void value;
    return { kind: "IC02_FACT_ATOM", answer: a.answer, evidenceKind: a.evidenceKind, verifiedStepIndex: a.verifiedStepIndex, receiptId: a.receiptId, value: vObj };
  }
  if (kind === "IC02_UNCERTAINTY_ATOM") {
    const a = strictRecord(x, ["kind", "topic", "verifiedStepIndex"]);
    if (!a || (a.topic !== "breakfast" && a.topic !== "parking") || !isStepIndex(a.verifiedStepIndex)) return null;
    return { kind: "IC02_UNCERTAINTY_ATOM", topic: a.topic, verifiedStepIndex: a.verifiedStepIndex };
  }
  if (kind === "IC02_ADVICE_ATOM") {
    const a = strictRecord(x, ["kind", "advice", "positions"]);
    if (!a || typeof a.advice !== "string" || !(ADVICE_INTENTS as readonly string[]).includes(a.advice)) return null;
    const posRaw = strictArray(a.positions, MAX_SELECTED_HOTELS);
    if (!posRaw) return null;
    const seen = new Set<number>(); const positions: number[] = [];
    for (const p of posRaw) { if (!isIntIn(p, 1, MAX_VISIBLE_HOTELS) || seen.has(p)) return null; seen.add(p); positions.push(p); }
    return { kind: "IC02_ADVICE_ATOM", advice: a.advice, positions };
  }
  if (kind === "IC02_GLUE_ATOM") {
    const a = strictRecord(x, ["kind", "role", "code"]);
    if (!a) return null;
    if (a.role === "clarification") { if (typeof a.code !== "string" || !(CLARIFY_REASONS as readonly string[]).includes(a.code)) return null; }
    else if (a.role === "escalation") { if (typeof a.code !== "string" || !(ESCALATION_REASONS as readonly string[]).includes(a.code)) return null; }
    else return null;
    return { kind: "IC02_GLUE_ATOM", role: a.role, code: a.code };
  }
  return null; // DERIVATION / PREFERENCE / unknown → fail closed
}
function validateAtoms(x: unknown): Atom[] | null {
  const raw = strictArray(x, MAX_RESPONSE_CLAIMS * 3 + 4);
  if (!raw || raw.length < 1) return null;
  const out: Atom[] = [];
  for (const r of raw) { const atom = validateAtom(r); if (!atom) return null; out.push(atom); }
  return out;
}
interface Commitment { verifiedStepIndex: number; receiptId: string; evidenceKind: string; receiptCommitment: string; }
function validateCommitments(x: unknown): Commitment[] | null {
  const raw = strictArray(x, MAX_EVIDENCE_RECORDS);
  if (!raw) return null;
  const out: Commitment[] = []; const seen = new Set<number>();
  for (const r of raw) {
    const a = strictRecord(r, ["verifiedStepIndex", "receiptId", "evidenceKind", "receiptCommitment"]);
    if (!a || !isStepIndex(a.verifiedStepIndex) || !isId(a.receiptId)) return null;
    if (typeof a.evidenceKind !== "string" || !(EVIDENCE_KINDS as readonly string[]).includes(a.evidenceKind)) return null;
    if (!isHex64(a.receiptCommitment)) return null;
    if (seen.has(a.verifiedStepIndex as number)) return null;
    seen.add(a.verifiedStepIndex as number);
    out.push({ verifiedStepIndex: a.verifiedStepIndex as number, receiptId: a.receiptId as string, evidenceKind: a.evidenceKind as string, receiptCommitment: a.receiptCommitment as string });
  }
  return out;
}

// ══════════════════════════ producer invariants (mirror) ══════════════════
function validateProducerInvariants(outcome: string, atoms: readonly Atom[], commitments: readonly Commitment[]): Ic02RejectCode | null {
  if (atoms.some((a) => a.kind === "IC02_DERIVATION_ATOM")) return "IC02_REJECT_UNSUPPORTED_MAPPING";
  if (atoms.some((a) => (a as { kind?: unknown }).kind === "IC02_PREFERENCE_MATCH_ATOM")) return "IC02_REJECT_UNSUPPORTED_MAPPING";
  if (outcome === "COMPILED_CLARIFICATION" || outcome === "COMPILED_HUMAN_ESCALATION") {
    if (commitments.length !== 0) return "IC02_REJECT_UNSUPPORTED_MAPPING";
    if (atoms.length !== 1) return "IC02_REJECT_UNSUPPORTED_MAPPING";
    const only = atoms[0];
    if (only.kind !== "IC02_GLUE_ATOM") return "IC02_REJECT_UNSUPPORTED_MAPPING";
    const role = outcome === "COMPILED_CLARIFICATION" ? "clarification" : "escalation";
    if (only.role !== role) return "IC02_REJECT_UNSUPPORTED_MAPPING";
    return null;
  }
  if (atoms.some((a) => a.kind === "IC02_GLUE_ATOM")) return "IC02_REJECT_UNSUPPORTED_MAPPING";
  const byStep = new Map<number, Commitment>();
  for (const c of commitments) byStep.set(c.verifiedStepIndex, c);
  const referenced = new Set<number>();
  const knownFacilitiesByStep: Record<number, string[]> = {};
  const uncertainTopicsByStep: Record<number, string[]> = {};
  for (const atom of atoms) {
    if (atom.kind === "IC02_FACT_ATOM") {
      if (atom.evidenceKind !== FACT_ANSWER_EVIDENCE[atom.answer as string]) return "IC02_REJECT_EVIDENCE_KIND_MISMATCH";
      const c = byStep.get(atom.verifiedStepIndex as number);
      if (!c) return "IC02_REJECT_MISSING_PROVENANCE";
      if (c.receiptId !== atom.receiptId) return "IC02_REJECT_ENTITY_BINDING";
      if (c.evidenceKind !== atom.evidenceKind) return "IC02_REJECT_EVIDENCE_KIND_MISMATCH";
      referenced.add(atom.verifiedStepIndex as number);
      if (atom.answer === "hotel_facts") {
        const step = atom.verifiedStepIndex as number;
        const arr = knownFacilitiesByStep[step] || (knownFacilitiesByStep[step] = []);
        const keys = Object.keys(atom.value as Record<string, unknown>);
        for (let i = 0; i < keys.length; i++) arr.push(keys[i]);
      }
    } else if (atom.kind === "IC02_UNCERTAINTY_ATOM") {
      const c = byStep.get(atom.verifiedStepIndex as number);
      if (!c) return "IC02_REJECT_MISSING_PROVENANCE";
      if (c.evidenceKind !== "detail") return "IC02_REJECT_EVIDENCE_KIND_MISMATCH";
      const step = atom.verifiedStepIndex as number;
      const arr = uncertainTopicsByStep[step] || (uncertainTopicsByStep[step] = []);
      if (arr.indexOf(atom.topic as string) !== -1) return "IC02_REJECT_CONFLICTING_EVIDENCE";
      arr.push(atom.topic as string);
      referenced.add(step);
    }
  }
  const uncertainSteps = Object.keys(uncertainTopicsByStep);
  for (let i = 0; i < uncertainSteps.length; i++) {
    const step = Number(uncertainSteps[i]);
    const topics = uncertainTopicsByStep[step];
    const known = knownFacilitiesByStep[step] || [];
    for (let k = 0; k < topics.length; k++) if (known.indexOf(topics[k]) !== -1) return "IC02_REJECT_CONFLICTING_EVIDENCE";
  }
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
  for (const c of commitments) if (!referenced.has(c.verifiedStepIndex)) return "IC02_REJECT_CONFLICTING_EVIDENCE";
  return null;
}

// ══════════════════════════ deterministic rerender (mirror) ════════════════
type Lang = "en" | "hi" | "hinglish";
function tri(lang: Lang, en: string, hinglish: string, hi: string): string | null {
  if (lang === "en") return en; if (lang === "hinglish") return hinglish; if (lang === "hi") return hi; return null;
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
  return null;
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
function renderAtom(atom: Atom, lang: Lang): string | null {
  try {
    if (!(IC02_TEMPLATE_LANGUAGES as readonly string[]).includes(lang)) return null;
    switch (atom.kind) {
      case "IC02_FACT_ATOM": {
        const v = atom.value as Record<string, unknown>;
        switch (atom.answer) {
          case "results_summary": { const c = v.count; if (!isIntIn(c, 0, MAX_VISIBLE_HOTELS)) return null; return tri(lang, `${c} matching stays are shown.`, `Screen par ${c} stays dikhaye gaye hain.`, `स्क्रीन पर ${c} स्टे दिखाए गए हैं।`); }
          case "comparison_summary": { const n = v.comparedCount; if (!isIntIn(n, 2, MAX_SELECTED_HOTELS)) return null; return tri(lang, `Compared ${n} stays on screen.`, `${n} stays compare kiye gaye.`, `${n} स्टे की तुलना की गई।`); }
          case "hotel_facts": {
            const clauses: string[] = [];
            for (const topic of ["breakfast", "parking"]) {
              const st = v[topic];
              if (st === "present" || st === "absent") { const cl = facilityClause(topic, st as string, lang); if (cl === null) return null; clauses.push(cl); }
            }
            if (clauses.length === 0) return null;
            return clauses.join("; ") + ".";
          }
          case "section_shown": { const s = v.section; if (s !== "rooms" && s !== "about") return null; return tri(lang, `Showing the ${s} section.`, `${s} section dikhaya ja raha hai.`, `${s} सेक्शन दिखाया जा रहा है।`); }
          case "hotel_opened": { const p = v.position; if (!isIntIn(p, 1, MAX_VISIBLE_HOTELS)) return null; return tri(lang, `Opened the stay at position ${p}.`, `Position ${p} ka stay khola gaya.`, `स्थान ${p} पर स्टे खोला गया।`); }
          default: return null;
        }
      }
      case "IC02_UNCERTAINTY_ATOM": {
        const label = facilityLabel(atom.topic as string, lang);
        if (label === null) return null;
        return tri(lang, `${label} availability is not specified.`, `${label} availability specified nahi hai.`, `${label} की जानकारी उपलब्ध नहीं है।`);
      }
      case "IC02_ADVICE_ATOM": {
        const ps = (atom.positions as number[]).filter((p) => isIntIn(p, 1, MAX_VISIBLE_HOTELS));
        const list = ps.join(", ");
        const at = ps.length ? (tri(lang, ` (positions ${list})`, ` (position ${list})`, ` (स्थान ${list})`) as string) : "";
        switch (atom.advice) {
          case "consider_visible_options": return tri(lang, `You could consider the options shown${at}.`, `Aap shown options consider kar sakte hain${at}.`, `आप दिखाए गए विकल्पों पर विचार कर सकते हैं${at}।`);
          case "compare_before_choosing": return tri(lang, `You may want to compare these before choosing${at}.`, `Choose karne se pehle inhe compare karna theek rahega${at}.`, `चुनने से पहले इनकी तुलना करना ठीक रहेगा${at}।`);
          case "refine_for_better_match": return tri(lang, `You could refine the search for a closer match.`, `Behtar match ke liye aap search aur refine kar sakte hain.`, `बेहतर मेल के लिए आप खोज को और परिष्कृत कर सकते हैं।`);
          case "ask_if_more_detail_needed": return tri(lang, `I can show more detail on any of these if you'd like${at}.`, `Kisi bhi option ka zyada detail chahiye to main dikha sakta hoon${at}.`, `किसी भी विकल्प का अधिक विवरण चाहिए तो मैं दिखा सकता हूँ${at}।`);
          default: return null;
        }
      }
      case "IC02_GLUE_ATOM": {
        if (atom.role === "clarification") return renderClarifyReason(atom.code as string, lang);
        if (atom.role === "escalation") return renderEscalationReason(atom.code as string, lang);
        return null;
      }
      default: return null;
    }
  } catch { return null; }
}
function renderAtoms(atoms: readonly Atom[], lang: Lang): { text: string } | { err: Ic02RejectCode } {
  const parts: string[] = [];
  for (const atom of atoms) {
    const t = renderAtom(atom, lang);
    if (t === null) return { err: (IC02_TEMPLATE_LANGUAGES as readonly string[]).includes(lang) ? "IC02_REJECT_RENDER_FAILED" : "IC02_REJECT_LOCALE_COVERAGE" };
    if (t.length > 0) parts.push(t);
  }
  return { text: parts.join(" ") };
}

// ══════════════════════════ hashes (mirror) ════════════════════════════════
function semanticPreimage(parts: { answerId: string; planId: string; binding: ConsumerBinding; compiledOutcome: string; atoms: readonly Atom[]; commitments: readonly Commitment[] }): unknown {
  return {
    kind: "ic02.semantic",
    contractVersion: IC02_CONTRACT_VERSION, compilerVersion: IC02_COMPILER_VERSION, templateCatalogVersion: IC02_TEMPLATE_CATALOG_VERSION,
    answerId: parts.answerId, planId: parts.planId,
    binding: {
      sessionId: parts.binding.sessionId, turnId: parts.binding.turnId, generation: parts.binding.generation,
      pageId: parts.binding.pageId, role: parts.binding.role, routeEpoch: parts.binding.routeEpoch,
      contextRevision: parts.binding.contextRevision, authorityRef: parts.binding.authorityRef, contextDigest: parts.binding.contextDigest,
    },
    compiledOutcome: parts.compiledOutcome, disposition: "IC02_ACCEPTED",
    atoms: parts.atoms, evidenceCommitments: parts.commitments,
  };
}
function ic02SemanticHash(parts: Parameters<typeof semanticPreimage>[0]): string { return sha256Hex(canonicalString(semanticPreimage(parts))); }
function ic02TextHash(text: string): string { return sha256Hex(text); }

// ══════════════════════════ the pure envelope verifier ═════════════════════
type Shape = { ok: true; env: {
  answerId: string; planId: string; binding: ConsumerBinding; compiledOutcome: string; language: Lang;
  atoms: Atom[]; commitments: Commitment[]; canonicalText: string; semanticHash: string; textHash: string;
} } | { ok: false; rejectCode: Ic02RejectCode };
function validateEnvelopeShape(x: unknown): Shape {
  const a = strictRecord(x, ["contractVersion", "compilerVersion", "templateCatalogVersion", "answerId", "planId", "binding", "compiledOutcome", "disposition", "language", "semanticAtoms", "evidenceCommitments", "canonicalText", "semanticHash", "textHash"]);
  if (!a) return { ok: false, rejectCode: "IC02_REJECT_ENVELOPE_MALFORMED" };
  if (a.contractVersion !== IC02_CONTRACT_VERSION) return { ok: false, rejectCode: "IC02_REJECT_ENVELOPE_UNACCEPTED" };
  if (a.compilerVersion !== IC02_COMPILER_VERSION) return { ok: false, rejectCode: "IC02_REJECT_ENVELOPE_UNACCEPTED" };
  if (a.templateCatalogVersion !== IC02_TEMPLATE_CATALOG_VERSION) return { ok: false, rejectCode: "IC02_REJECT_ENVELOPE_UNACCEPTED" };
  if (a.disposition !== "IC02_ACCEPTED") return { ok: false, rejectCode: "IC02_REJECT_ENVELOPE_UNACCEPTED" };
  if (!isId(a.answerId) || !isId(a.planId)) return { ok: false, rejectCode: "IC02_REJECT_IDENTITY_INVALID" };
  const binding = validateBinding(a.binding);
  if (!binding) return { ok: false, rejectCode: "IC02_REJECT_BINDING_INVALID" };
  if (typeof a.compiledOutcome !== "string" || !(IC02_COMPILED_OUTCOMES as readonly string[]).includes(a.compiledOutcome)) return { ok: false, rejectCode: "IC02_REJECT_ENVELOPE_MALFORMED" };
  if (!isLanguage(a.language) || !(IC02_TEMPLATE_LANGUAGES as readonly string[]).includes(a.language as string)) return { ok: false, rejectCode: "IC02_REJECT_LOCALE_COVERAGE" };
  const atoms = validateAtoms(a.semanticAtoms);
  if (!atoms) return { ok: false, rejectCode: "IC02_REJECT_ENVELOPE_MALFORMED" };
  const commitments = validateCommitments(a.evidenceCommitments);
  if (!commitments) return { ok: false, rejectCode: "IC02_REJECT_ENVELOPE_MALFORMED" };
  if (typeof a.canonicalText !== "string" || a.canonicalText.length === 0 || utf8ByteLength(a.canonicalText) > MAX_CANONICAL_TEXT_BYTES) return { ok: false, rejectCode: "IC02_REJECT_ENVELOPE_MALFORMED" };
  if (!isHex64(a.semanticHash) || !isHex64(a.textHash)) return { ok: false, rejectCode: "IC02_REJECT_ENVELOPE_MALFORMED" };
  return { ok: true, env: { answerId: a.answerId as string, planId: a.planId as string, binding, compiledOutcome: a.compiledOutcome as string, language: a.language as Lang, atoms, commitments, canonicalText: a.canonicalText as string, semanticHash: a.semanticHash as string, textHash: a.textHash as string } };
}

/** The pure IC02 envelope verifier (no current-binding comparison) — parity twin of the
 *  Node verifyEnvelope. Detects tampering + impossible producer structures + hash drift. */
export function verifyCompiledEnvelope(x: unknown): CompiledAnswerVerification {
  try {
    const parsed = validateEnvelopeShape(x);
    if (!parsed.ok) return { ok: false, rejectCode: parsed.rejectCode };
    const env = parsed.env;
    const invariant = validateProducerInvariants(env.compiledOutcome, env.atoms, env.commitments);
    if (invariant) return { ok: false, rejectCode: invariant };
    const semanticHash = ic02SemanticHash({ answerId: env.answerId, planId: env.planId, binding: env.binding, compiledOutcome: env.compiledOutcome, atoms: env.atoms, commitments: env.commitments });
    if (semanticHash !== env.semanticHash) return { ok: false, rejectCode: "IC02_REJECT_SEMANTIC_HASH" };
    const rerender = renderAtoms(env.atoms, env.language);
    if ("err" in rerender) return { ok: false, rejectCode: rerender.err };
    if (rerender.text !== env.canonicalText) return { ok: false, rejectCode: "IC02_REJECT_NONDETERMINISTIC" };
    if (ic02TextHash(env.canonicalText) !== env.textHash) return { ok: false, rejectCode: "IC02_REJECT_TEXT_HASH" };
    return { ok: true, canonicalText: env.canonicalText };
  } catch { return { ok: false, rejectCode: "IC02_REJECT_COMPILER_EXCEPTION" }; }
}

/** The BROWSER consumer authority path: pure IC02 verification PLUS a stale/foreign-binding
 *  check against the CURRENT trusted binding. ONLY the returned canonicalText may render. */
export function verifyCompiledAnswer(x: unknown, trustedCurrentBinding: ConsumerBinding | null): CompiledAnswerVerification {
  const base = verifyCompiledEnvelope(x);
  if (!base.ok) return base;
  if (trustedCurrentBinding) {
    // re-derive the binding from the (already shape-validated) envelope for the equality test.
    const shape = validateEnvelopeShape(x);
    if (!shape.ok) return { ok: false, rejectCode: shape.rejectCode };
    if (!bindingEqual(shape.env.binding, trustedCurrentBinding)) return { ok: false, rejectCode: "IC02_REJECT_STALE_BINDING" };
  }
  return base;
}
