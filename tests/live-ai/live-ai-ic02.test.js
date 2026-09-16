#!/usr/bin/env node
/* eslint-disable no-console */
// ─────────────────────────────────────────────────────────────────────────
// StayBid Live AI — LIVE-AI-IC02 — GROUNDED ANSWER COMPILER test suite.
//
//   Run:  node tests/live-ai/live-ai-ic02.test.js
//
// Compiles the CLOSED 5-file server/voice-gateway dependency set with the
// LOCKFILE-INSTALLED local tsc (NO npx) — live-ai-schemas / -intelligence-contract
// / -capability-registry / -answer-compiler (NEW) / -agent-loop (P1-01 edit) — and
// drives the REAL compiled production modules. Covers, per the IC02 packet:
//   • P1-01 atomic VERIFIED-evidence provenance (retained at the loop's exact
//     VERIFIED-promotion transition; complete/immutable/deep-copied; one per step)
//   • P1-02 vocabulary separation (IC01 terminal kinds unchanged; IC02 internal
//     vocabulary separate; derivations never model-selectable)
//   • P1-03 NO numeric budget matching (no preference input; no preference atom)
//   • P1-04 producer CompiledAnswerEnvelope + PURE tamper-detecting verifier
//   • deterministic English / Hindi / Hinglish rendering from equivalent atoms
//   • fail-closed rejects (IC02 namespace)
//   • named MUTATION / NON-VACUITY probes
// NO network, NO provider, NO DB. Deterministic.
// ─────────────────────────────────────────────────────────────────────────
const path = require("path");
const fs = require("fs");
const cp = require("child_process");

const REPO = path.resolve(__dirname, "..", "..");
const FILES = [
  "live-ai-schemas.ts",
  "live-ai-intelligence-contract.ts",
  "live-ai-capability-registry.ts",
  "live-ai-answer-compiler.ts",
  "live-ai-agent-loop.ts",
];

// ── compile the closed set with the local tsc (strict, noEmitOnError) ────────
const BUILD = path.join(__dirname, ".build", "ic02");
const SRC = path.join(BUILD, "src");
const OUT = path.join(BUILD, "out");
fs.rmSync(BUILD, { recursive: true, force: true });
fs.mkdirSync(path.join(SRC, "gw"), { recursive: true });
for (const f of FILES) fs.copyFileSync(path.join(REPO, "server/voice-gateway", f), path.join(SRC, "gw", f));
fs.writeFileSync(path.join(SRC, "tsconfig.json"), JSON.stringify({
  compilerOptions: {
    module: "commonjs", target: "es2020", esModuleInterop: true, skipLibCheck: true,
    moduleResolution: "node", ignoreDeprecations: "6.0", rootDir: ".", outDir: "../out",
    typeRoots: [path.join(REPO, "node_modules/@types")], types: ["node"],
    lib: ["es2020"], strict: true, noEmitOnError: true, resolveJsonModule: true,
  },
  include: ["gw/**/*.ts"],
}));
let TSC_BIN;
try { TSC_BIN = require.resolve("typescript/bin/tsc", { paths: [REPO] }); }
catch (_) { console.error("COMPILE GATE FAILED — local tsc not installed (run npm ci)."); process.exit(2); }
const compile = cp.spawnSync(process.execPath, [TSC_BIN, "-p", path.join(SRC, "tsconfig.json")], { cwd: REPO, encoding: "utf8" });
if (compile.status !== 0) { console.error("COMPILE GATE FAILED (ic02):\n" + (compile.stdout || "") + (compile.stderr || "")); process.exit(2); }
console.log("• Local tsc compile (ic02, strict): exit 0, clean");

const SCH = require(path.join(OUT, "gw/live-ai-schemas.js"));
const IC = require(path.join(OUT, "gw/live-ai-intelligence-contract.js"));
const REG = require(path.join(OUT, "gw/live-ai-capability-registry.js"));
const CMP = require(path.join(OUT, "gw/live-ai-answer-compiler.js"));
const AL = require(path.join(OUT, "gw/live-ai-agent-loop.js"));

let pass = 0, fail = 0; const failures = [];
function ok(c, l) { if (c) pass += 1; else { fail += 1; failures.push(l); console.error("  ✗ " + l); } }
function eq(a, b, l) { ok(a === b, `${l} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`); }
function jeq(a, b, l) { ok(JSON.stringify(a) === JSON.stringify(b), `${l} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`); }
function section(n) { console.log("\n• " + n); }
const probes = [];
function probe(name, condition) { probes.push({ name, ok: !!condition }); ok(!!condition, "PROBE " + name); }
const clone = (o) => JSON.parse(JSON.stringify(o));

// ── fixtures ────────────────────────────────────────────────────────────────
const H64 = "a".repeat(64);
const HID = "hotel-a", HID2 = "hotel-b";
const B = Object.freeze({ sessionId: "s1", turnId: "t1", generation: 1, pageId: "hotels", role: "customer", routeEpoch: 1, contextRevision: "rev-1", authorityRef: "auth-1", contextDigest: H64 });
const RA = (b, o) => Object.assign({ turnId: b.turnId, generation: b.generation, routeEpoch: b.routeEpoch, contextRevision: b.contextRevision, authorityRef: b.authorityRef, contextDigest: b.contextDigest }, o || {});
const COMMIT = SCH.sha256Hex("commit-fixture");

const EV = {
  results: () => ({ kind: "results", count: 2, orderedIds: [HID, HID2] }),
  comparison: () => ({ kind: "comparison", positions: [1, 2], hotelIds: [HID, HID2], factors: ["price"], cheapestPosition: 1, topRatedPosition: 2 }),
  detail: (bf, pk) => ({ kind: "detail", hotelId: HID, breakfast: bf || "present", parking: pk || "absent" }),
  ui_state: () => ({ kind: "ui_state", section: "rooms", hotelId: HID }),
  navigation: () => ({ kind: "navigation", hotelId: HID, position: 1 }),
};
const CAP_FOR = { results: "READ_CURRENT_RESULTS", comparison: "COMPARE_VISIBLE_HOTELS", detail: "READ_CURRENT_HOTEL_FACTS", ui_state: "SHOW_HOTEL_SECTION", navigation: "OPEN_VISIBLE_HOTEL" };
const EVTYPE_FOR = { APPLY_HOTEL_REFINEMENT: "results", READ_CURRENT_RESULTS: "results", COMPARE_VISIBLE_HOTELS: "comparison", READ_CURRENT_HOTEL_FACTS: "detail", SHOW_HOTEL_SECTION: "ui_state", OPEN_VISIBLE_HOTEL: "navigation" };
const ANSWER_FOR = { results: "results_summary", comparison: "comparison_summary", detail: "hotel_facts", ui_state: "section_shown", navigation: "hotel_opened" };

// a valid IC02 verified-evidence record INPUT (raw fields the loop passes in)
function mkRecord(o) {
  o = o || {};
  const kind = o.evidenceKind || "results";
  return {
    verifiedStepIndex: o.verifiedStepIndex == null ? 0 : o.verifiedStepIndex,
    receiptId: o.receiptId || "rc.1",
    capabilityId: o.capabilityId || CAP_FOR[kind],
    evidenceKind: kind,
    evidence: o.evidence || EV[kind](),
    receiptCommitment: o.receiptCommitment || COMMIT,
    sourceAuthority: o.sourceAuthority || RA(B),
    resultAuthority: o.resultAuthority === undefined ? RA(B) : o.resultAuthority,
    binding: o.binding || clone(B),
  };
}
// terminal descriptors (shared by the compiler AND the IC01 plan validator)
const respondFact = (step, answer) => ({ kind: "RESPOND", language: "en", claims: [{ kind: "fact", answer: answer || "results_summary", groundedInStep: step }] });
const respondAdvice = (advice, positions) => ({ kind: "RESPOND", language: "en", claims: [{ kind: "advice", advice: advice || "consider_visible_options", positions: positions || [] }] });
const clarifyD = (r) => ({ kind: "CLARIFY", reason: r || "MISSING_DESTINATION", language: "en" });
const escalD = (e) => ({ kind: "ESCALATE_TO_HUMAN", escalation: e || "TRANSACTIONAL_REQUEST", language: "en" });

function mkReq(o) {
  o = o || {};
  return {
    contractVersion: "staybid-intelligence.v1",
    controllerOwnedAnswerId: o.answerId || "ans-1",
    controllerOwnedPlanId: o.planId || "plan-1",
    trustedCurrentBinding: o.binding || clone(B),
    acceptedIC01TerminalDescriptor: o.descriptor || respondFact(0, "results_summary"),
    verifiedEvidenceRecords: o.records || [mkRecord({ verifiedStepIndex: 0, evidenceKind: "results" })],
    requestedLanguage: o.language || "en",
  };
}
function compileOk(o) {
  const r = CMP.compileAnswer(mkReq(o));
  ok(r.disposition === "IC02_ACCEPTED", "compileAnswer accepted for a valid request");
  return r;
}

// ── agent-loop drivers (shared by the remediation sections) ──
const icBinding = (o) => Object.assign(clone(B), o || {});
const icTurn = () => ({ text: "show me hotels", language: "en", role: "customer" });
const icPlan = (steps, intent) => ({ contractVersion: "staybid-intelligence.v1", intent: intent || "READ_RESULTS", steps });
const capStep = (id, args) => ({ kind: "CAPABILITY", capabilityId: id, args });
const fakeDeps = () => ({ modelAvailable: () => true, routeTier: () => "LEVEL_1", telemetry: () => {} });
let loopSeq = 0;
const raSame = (b) => ({ turnId: b.turnId, generation: b.generation, routeEpoch: b.routeEpoch, contextRevision: b.contextRevision, authorityRef: b.authorityRef, contextDigest: b.contextDigest });
const raAdvanced = (b) => ({ turnId: b.turnId, generation: b.generation, routeEpoch: b.routeEpoch + 1, contextRevision: "rev-adv", authorityRef: "auth-adv", contextDigest: "c".repeat(64) });
const ADVANCING = ["APPLY_HOTEL_REFINEMENT", "OPEN_VISIBLE_HOTEL", "SHOW_HOTEL_SECTION"];
function loopObs(dispatch, opts) {
  opts = opts || {};
  const cap = dispatch.capabilityId; loopSeq += 1;
  const outcome = opts.outcome || "verified";
  const status = opts.status || (outcome === "verified" ? "verified" : "no_op");
  const receipt = { receiptId: "rc." + loopSeq, proposalId: "pr." + loopSeq, providerTurnId: "pt." + loopSeq, actionId: "ac." + loopSeq, executionNonce: "nc." + loopSeq, authorityRef: dispatch.binding.authorityRef, operation: cap, outcome, status };
  let ra = null;
  if (outcome === "verified") {
    if (opts.resultAuthority === "same") ra = raSame(dispatch.binding);
    else if (opts.resultAuthority === "advance") ra = raAdvanced(dispatch.binding);
    else ra = ADVANCING.includes(cap) ? raAdvanced(dispatch.binding) : raSame(dispatch.binding);
    receipt.evidence = EV[EVTYPE_FOR[cap]]();
    receipt.resultAuthority = ra;
  }
  const ackCommitment = SCH.terminalReceiptCommitment(receipt);
  return { observationId: "ob." + (++loopSeq), dispatchId: dispatch.dispatchId, sessionId: dispatch.binding.sessionId, turnId: dispatch.binding.turnId, generation: dispatch.binding.generation, planId: dispatch.planId, stepIndex: dispatch.stepIndex, capabilityId: cap, receipt, sourceAuthority: raSame(dispatch.binding), resultAuthority: ra, ackCommitment };
}
const acceptedFrom = (o) => ({ receiptId: o.receipt.receiptId, proposalId: o.receipt.proposalId, providerTurnId: o.receipt.providerTurnId, actionId: o.receipt.actionId, executionNonce: o.receipt.executionNonce, operation: o.receipt.operation, authorityRef: o.receipt.authorityRef });
function loopVerify(loop, dispatch, opts, nAck, nObs) { const o = loopObs(dispatch, opts); loop.acknowledgeDispatch({ dispatchId: dispatch.dispatchId, accepted: acceptedFrom(o), nowMs: nAck }); return { e: loop.submitObservation({ observation: o, nowMs: nObs }), o }; }
// recompute BOTH hashes correctly over a (possibly forged) envelope, then verify — proving hashes are not authority
function forgeVerify(envMut) { const good = compileOk({}).envelope; const f = clone(good); envMut(f); const h = CMP.ic02RecomputeEnvelopeHashes(f); f.semanticHash = h.semanticHash; f.textHash = h.textHash; return CMP.verifyEnvelope(f); }
const FACT_ATOM = (o) => Object.assign({ kind: "IC02_FACT_ATOM", answer: "results_summary", evidenceKind: "results", verifiedStepIndex: 0, receiptId: "rc.1", value: { count: 2 } }, o || {});

// ═════════════════════════════ 1. IDENTITY / VOCABULARY (P1-02) ═════════════
section("IC02-A — identity + IC01 vocabulary UNCHANGED + IC02 internal vocabulary SEPARATE");
eq(CMP.IC02_COMPILER_VERSION, "staybid-answer-compiler.v1", "IC02-A01 — compiler version constant");
eq(CMP.IC02_TEMPLATE_CATALOG_VERSION, "staybid-answer-templates.v1", "IC02-A02 — template-catalog version constant");
eq(IC.INTELLIGENCE_CONTRACT_VERSION, "staybid-intelligence.v1", "IC02-A03 — inherited IC01 contract version");
// IC01 terminal kinds / vocabularies UNCHANGED
eq(IC.PLAN_STEP_KINDS.length, 4, "IC02-A04 — IC01 still has exactly 4 plan step kinds");
jeq(Array.from(IC.TERMINAL_STEP_KINDS), ["RESPOND", "CLARIFY", "ESCALATE_TO_HUMAN"], "IC02-A05 — IC01 terminal kinds unchanged");
eq(IC.FACT_ANSWER_KINDS.length, 5, "IC02-A06 — IC01 still has 5 fact answer kinds");
eq(IC.ADVICE_INTENTS.length, 4, "IC02-A07 — IC01 still has 4 advice intents");
eq(IC.RESULT_STATES.length, 8, "IC02-A08 — IC01 still has 8 result states");
// IC02 internal vocabulary present + separate
jeq(Array.from(CMP.IC02_COMPILED_OUTCOMES), ["COMPILED_RESPONSE", "COMPILED_CLARIFICATION", "COMPILED_HUMAN_ESCALATION"], "IC02-A09 — 3 compiled outcomes");
jeq(Array.from(CMP.IC02_COMPILATION_DISPOSITIONS), ["IC02_ACCEPTED", "IC02_REJECTED"], "IC02-A10 — 2 dispositions");
ok(CMP.IC02_SEMANTIC_ATOM_KINDS.includes("IC02_FACT_ATOM") && CMP.IC02_SEMANTIC_ATOM_KINDS.includes("IC02_ADVICE_ATOM") && CMP.IC02_SEMANTIC_ATOM_KINDS.includes("IC02_GLUE_ATOM") && CMP.IC02_SEMANTIC_ATOM_KINDS.includes("IC02_UNCERTAINTY_ATOM") && CMP.IC02_SEMANTIC_ATOM_KINDS.includes("IC02_DERIVATION_ATOM"), "IC02-A11 — 5 admitted semantic atom kinds");
ok(!CMP.IC02_SEMANTIC_ATOM_KINDS.includes("IC02_PREFERENCE_MATCH_ATOM"), "IC02-A12 — IC02_PREFERENCE_MATCH_ATOM is NOT an admitted atom (P1-03)");
ok(CMP.IC02_UNADMITTED_ATOM_KINDS.includes("IC02_PREFERENCE_MATCH_ATOM"), "IC02-A12b — preference-match atom is in the UNADMITTED set");
// no IC02 outcome/disposition collides with an IC01 terminal kind
Array.from(CMP.IC02_COMPILED_OUTCOMES).concat(Array.from(CMP.IC02_COMPILATION_DISPOSITIONS)).forEach((v) =>
  ok(!IC.PLAN_STEP_KINDS.includes(v) && !IC.INTELLIGENCE_INTENTS.includes(v), `IC02-A13 — IC02 token '${v}' is not an IC01 plan-step/intent`));
// reject codes are IC02-namespaced
ok(CMP.IC02_REJECT_CODES.every((c) => c.indexOf("IC02_REJECT_") === 0), "IC02-A14 — every reject code uses the IC02_REJECT_ namespace");
ok(!CMP.IC02_REJECT_CODES.some((c) => IC.TERMINATION_REASONS.includes(c)), "IC02-A15 — no reject code collides with an IC01 termination reason");
// an IC02 internal outcome can NEVER be accepted as an IC01 plan step or an IC02 descriptor
eq(IC.validatePlanCandidate({ contractVersion: "staybid-intelligence.v1", intent: "READ_RESULTS", steps: [{ kind: "COMPILED_RESPONSE", language: "en", claims: [] }] }), null, "IC02-A16 — 'COMPILED_RESPONSE' is not a valid IC01 plan step");
eq(CMP.validateIc02TerminalDescriptor({ kind: "COMPILED_RESPONSE", language: "en", claims: [] }), null, "IC02-A17 — 'COMPILED_RESPONSE' is not a valid IC02 terminal descriptor");

// ═════════════════════════════ 2. PROVENANCE (P1-01, pure builder) ══════════
section("IC02-B — VERIFIED-evidence provenance record: complete / immutable / deep-copied / fail-closed");
{
  const rec = CMP.buildVerifiedEvidenceRecord(mkRecord({ verifiedStepIndex: 1, evidenceKind: "detail", evidence: EV.detail("present", "absent") }));
  ok(rec !== null, "IC02-B01 — a complete record builds");
  eq(rec.verifiedStepIndex, 1, "IC02-B02 — verifiedStepIndex retained");
  eq(rec.capabilityId, "READ_CURRENT_HOTEL_FACTS", "IC02-B03 — capabilityId retained");
  eq(rec.evidenceKind, "detail", "IC02-B04 — evidenceKind retained");
  eq(rec.evidence.breakfast, "present", "IC02-B05 — evidence value retained exactly");
  eq(rec.receiptCommitment, COMMIT, "IC02-B06 — receiptCommitment retained");
  eq(rec.sourceAuthority.authorityRef, "auth-1", "IC02-B07 — source authority retained");
  eq(rec.binding.sessionId, "s1", "IC02-B08 — verification-time binding retained");
  ok(Object.isFrozen(rec) && Object.isFrozen(rec.evidence) && Object.isFrozen(rec.binding) && Object.isFrozen(rec.sourceAuthority), "IC02-B09 — the whole record is deeply frozen");
  // capability↔evidenceKind binding is re-enforced
  eq(CMP.buildVerifiedEvidenceRecord(mkRecord({ capabilityId: "READ_CURRENT_RESULTS", evidenceKind: "detail", evidence: EV.detail() })), null, "IC02-B10 — capabilityId/evidenceKind mismatch is inadmissible");
  eq(CMP.buildVerifiedEvidenceRecord(mkRecord({ evidenceKind: "results", evidence: EV.comparison() })), null, "IC02-B11 — evidence not matching its declared kind is inadmissible");
}
// PARTIAL provenance impossible — every field is required
section("IC02-B (cont) — partial provenance is IMPOSSIBLE (each missing field → inadmissible)");
["verifiedStepIndex", "receiptId", "capabilityId", "evidenceKind", "evidence", "receiptCommitment", "sourceAuthority", "resultAuthority", "binding"].forEach((k) => {
  const bad = mkRecord({});
  delete bad[k];
  // resultAuthority may legitimately be null but NOT absent (exact keys)
  eq(CMP.buildVerifiedEvidenceRecord(bad), null, `IC02-B12 — a record missing '${k}' is inadmissible (no partial record)`);
});
eq(CMP.buildVerifiedEvidenceRecord({ receiptId: "rc.1" }), null, "IC02-B13 — a receiptId ALONE cannot recreate a trusted record");
eq(CMP.buildVerifiedEvidenceRecord(Object.assign(mkRecord({}), { extra: "x" })), null, "IC02-B14 — an extra key fails the whole record closed");
{ const { proxy, revoke } = Proxy.revocable({}, {}); revoke(); eq(CMP.buildVerifiedEvidenceRecord(proxy), null, "IC02-B15 — a revoked Proxy fails closed"); }
// DEEP COPY — mutating the input after building never mutates the record
{
  const input = mkRecord({ evidenceKind: "results" });
  const rec = CMP.buildVerifiedEvidenceRecord(input);
  input.evidence.count = 999;               // mutate the ORIGINAL input evidence
  input.evidence.orderedIds.push("x");
  eq(rec.evidence.count, 2, "IC02-B16 — record evidence is a DEEP COPY (input mutation has no effect)");
  eq(rec.evidence.orderedIds.length, 2, "IC02-B16b — record evidence arrays are deep-copied");
  let threw = false; try { rec.evidence.count = 5; } catch (_) { threw = true; }
  ok(threw || rec.evidence.count === 2, "IC02-B17 — a frozen record cannot be mutated after the fact");
}
// overflow — count bound on records inside a compile request
{
  const many = []; for (let i = 0; i < 9; i++) many.push(mkRecord({ verifiedStepIndex: i % 4, receiptId: "rc." + i }));
  eq(CMP.compileAnswer(mkReq({ records: many })).rejectCode, "IC02_REJECT_EVIDENCE_RECORD_OVERFLOW", "IC02-B18 — >8 evidence records fails closed (count overflow)");
  // headroom proof: a valid, fully-populated request stays well within the serialized-size bound (no truncation needed)
  const bytes = IC.measureJsonBytes(mkReq({ records: [mkRecord({ verifiedStepIndex: 0, evidenceKind: "results" })] }));
  ok(bytes !== null && bytes < IC.IC01_LIMITS.MAX_MODEL_INPUT_BYTES, "IC02-B19 — a valid compile request stays within the 16 KiB serialized ceiling (no truncation)");
}
// conflicting evidence — two records for the SAME verified step
eq(CMP.compileAnswer(mkReq({ records: [mkRecord({ verifiedStepIndex: 0 }), mkRecord({ verifiedStepIndex: 0, receiptId: "rc.2" })] })).rejectCode, "IC02_REJECT_CONFLICTING_EVIDENCE", "IC02-B20 — two records for the same step fail closed (one per verified step)");

// ═════ 3. LOOP RETENTION (P1-01) — captured at the exact VERIFIED promotion ══
section("IC02-C — agent loop retains provenance AT the VERIFIED-promotion transition (one per step)");
{
  const icBinding = () => clone(B);
  const icTurn = () => ({ text: "show me hotels", language: "en", role: "customer" });
  const icPlan = (steps, intent) => ({ contractVersion: "staybid-intelligence.v1", intent: intent || "READ_RESULTS", steps });
  const capStep = (id, args) => ({ kind: "CAPABILITY", capabilityId: id, args });
  const fakeDeps = () => ({ modelAvailable: () => true, routeTier: () => "LEVEL_1", telemetry: () => {} });
  let seq = 0;
  const raFrom = (b) => ({ turnId: b.turnId, generation: b.generation, routeEpoch: b.routeEpoch, contextRevision: b.contextRevision, authorityRef: b.authorityRef, contextDigest: b.contextDigest });
  function obsFor(dispatch) {
    const cap = dispatch.capabilityId; seq += 1;
    const receipt = { receiptId: "rc." + seq, proposalId: "pr." + seq, providerTurnId: "pt." + seq, actionId: "ac." + seq, executionNonce: "nc." + seq, authorityRef: dispatch.binding.authorityRef, operation: cap, outcome: "verified", status: "verified", evidence: EV[EVTYPE_FOR[cap]](), resultAuthority: raFrom(dispatch.binding) };
    const ackCommitment = SCH.terminalReceiptCommitment(receipt);
    return { observationId: "ob." + (++seq), dispatchId: dispatch.dispatchId, sessionId: dispatch.binding.sessionId, turnId: dispatch.binding.turnId, generation: dispatch.binding.generation, planId: dispatch.planId, stepIndex: dispatch.stepIndex, capabilityId: cap, receipt, sourceAuthority: raFrom(dispatch.binding), resultAuthority: raFrom(dispatch.binding), ackCommitment };
  }
  const acceptedFrom = (o) => ({ receiptId: o.receipt.receiptId, proposalId: o.receipt.proposalId, providerTurnId: o.receipt.providerTurnId, actionId: o.receipt.actionId, executionNonce: o.receipt.executionNonce, operation: o.receipt.operation, authorityRef: o.receipt.authorityRef });
  function verifyStep(loop, dispatch, nAck, nObs) { const o = obsFor(dispatch); loop.acknowledgeDispatch({ dispatchId: dispatch.dispatchId, accepted: acceptedFrom(o), nowMs: nAck }); return { e: loop.submitObservation({ observation: o, nowMs: nObs }), o }; }

  // (a) single non-advancing READ → verified → retained record equals the source
  {
    const loop = AL.createAgentLoop(fakeDeps());
    const e1 = loop.beginTurn({ binding: icBinding(), userTurn: icTurn(), nowMs: 0 });
    const e2 = loop.submitModelPlan({ modelRequestId: e1.modelRequestId, plan: icPlan([capStep("READ_CURRENT_RESULTS", { op: "READ_CURRENT_RESULTS" }), respondFact(0, "results_summary")]), nowMs: 10 });
    eq(e2.kind, "CAPABILITY_DISPATCH", "IC02-C01 — first capability dispatched");
    const { e: e3, o } = verifyStep(loop, e2, 20, 30);
    eq(e3.reason, "COMPLETED", "IC02-C02 — the turn completes on the VERIFIED observation");
    const recs = loop.verifiedEvidence();
    eq(recs.length, 1, "IC02-C03 — exactly ONE provenance record retained at the VERIFIED promotion");
    eq(loop.status().verifiedEvidenceRecords, 1, "IC02-C04 — status mirrors the retained count");
    eq(recs[0].receiptId, o.receipt.receiptId, "IC02-C05 — retained receiptId equals the trusted source value");
    eq(recs[0].capabilityId, "READ_CURRENT_RESULTS", "IC02-C06 — retained capabilityId equals the source");
    eq(recs[0].evidenceKind, "results", "IC02-C07 — retained evidenceKind equals the source");
    eq(recs[0].evidence.count, 2, "IC02-C08 — retained evidence value equals the source");
    eq(recs[0].receiptCommitment, SCH.terminalReceiptCommitment(o.receipt), "IC02-C09 — retained commitment equals the terminal receipt commitment");
    eq(recs[0].sourceAuthority.authorityRef, B.authorityRef, "IC02-C10 — retained source authority equals the verification-time authority");
    eq(recs[0].binding.turnId, B.turnId, "IC02-C11 — retained binding equals the verification-time binding");
    ok(Object.isFrozen(recs) && Object.isFrozen(recs[0]) && Object.isFrozen(recs[0].evidence), "IC02-C12 — the exposed snapshot is deeply immutable");
    // later mutable controller state cannot repair/replace the retained provenance
    const snapAgain = loop.verifiedEvidence();
    ok(snapAgain !== recs, "IC02-C13 — each read returns a fresh snapshot (internal ledger never handed out by reference)");
    let threw = false; try { snapAgain.push({}); } catch (_) { threw = true; }
    ok(threw || loop.verifiedEvidence().length === 1, "IC02-C14 — the snapshot array cannot be mutated to add provenance");
  }
  // (b) TWO non-advancing capability steps → exactly one record PER verified step
  {
    const loop = AL.createAgentLoop(fakeDeps());
    const e1 = loop.beginTurn({ binding: icBinding(), userTurn: icTurn(), nowMs: 0 });
    const e2 = loop.submitModelPlan({ modelRequestId: e1.modelRequestId, plan: icPlan([
      capStep("READ_CURRENT_RESULTS", { op: "READ_CURRENT_RESULTS" }),
      capStep("COMPARE_VISIBLE_HOTELS", { op: "COMPARE_VISIBLE_HOTELS", positions: [1, 2], factors: ["price"] }),
      respondAdvice(),
    ]), nowMs: 10 });
    const { e: e3 } = verifyStep(loop, e2, 20, 30);
    eq(e3.kind, "CAPABILITY_DISPATCH", "IC02-C15 — second capability dispatched after step 0 verified");
    const { e: e4 } = verifyStep(loop, e3, 40, 50);
    eq(e4.reason, "COMPLETED", "IC02-C16 — plan completes after both steps verify");
    const recs = loop.verifiedEvidence();
    eq(recs.length, 2, "IC02-C17 — exactly two provenance records (one per verified step)");
    jeq(recs.map((r) => r.verifiedStepIndex), [0, 1], "IC02-C18 — records are keyed to their verified step indices");
    jeq(recs.map((r) => r.evidenceKind), ["results", "comparison"], "IC02-C19 — each record carries its own evidence kind");
  }
  // (c) a fresh turn resets the retained provenance
  {
    const loop = AL.createAgentLoop(fakeDeps());
    const e1 = loop.beginTurn({ binding: icBinding(), userTurn: icTurn(), nowMs: 0 });
    const e2 = loop.submitModelPlan({ modelRequestId: e1.modelRequestId, plan: icPlan([capStep("READ_CURRENT_RESULTS", { op: "READ_CURRENT_RESULTS" }), respondAdvice()]), nowMs: 10 });
    verifyStep(loop, e2, 20, 30);
    eq(loop.verifiedEvidence().length, 1, "IC02-C20 — retained after first turn");
    const e5 = loop.beginTurn({ binding: Object.assign(clone(B), { turnId: "t2" }), userTurn: icTurn(), nowMs: 100 });
    ok(e5.kind === "MODEL_REQUEST", "IC02-C21a — a fresh (new-turnId) turn begins");
    eq(loop.verifiedEvidence().length, 0, "IC02-C21 — a fresh turn discards prior provenance (per-plan lifecycle)");
  }
}

// ═════════════════════════════ 4. CLAIM / EVIDENCE MAPPING (§11) ════════════
section("IC02-D — deterministic claim→atom mapping; fact requires matching verified provenance");
{
  // each fact answer maps to its verified evidence kind
  const map = { results_summary: "results", comparison_summary: "comparison", hotel_facts: "detail", section_shown: "ui_state", hotel_opened: "navigation" };
  Object.keys(map).forEach((answer) => {
    const kind = map[answer];
    const r = compileOk({ descriptor: respondFact(0, answer), records: [mkRecord({ verifiedStepIndex: 0, evidenceKind: kind, evidence: EV[kind]() })] });
    const factAtoms = r.envelope.semanticAtoms.filter((a) => a.kind === "IC02_FACT_ATOM");
    ok(factAtoms.length >= 1 && factAtoms[0].answer === answer && factAtoms[0].evidenceKind === kind, `IC02-D01 — ${answer} maps to a fact atom grounded in '${kind}' evidence`);
    // every atom kind is an ADMITTED kind
    ok(r.envelope.semanticAtoms.every((a) => CMP.IC02_SEMANTIC_ATOM_KINDS.includes(a.kind)), `IC02-D02 — ${answer} emits only admitted atom kinds`);
  });
  // MISSING provenance — a fact with no matching record
  eq(CMP.compileAnswer(mkReq({ descriptor: respondFact(0, "results_summary"), records: [] })).rejectCode, "IC02_REJECT_MISSING_PROVENANCE", "IC02-D03 — a fact with NO verified record fails closed (missing provenance)");
  // wrong capability/evidence mapping
  eq(CMP.compileAnswer(mkReq({ descriptor: respondFact(0, "results_summary"), records: [mkRecord({ verifiedStepIndex: 0, evidenceKind: "detail", evidence: EV.detail() })] })).rejectCode, "IC02_REJECT_EVIDENCE_KIND_MISMATCH", "IC02-D04 — a fact grounded in the WRONG evidence kind fails closed");
  // advice maps to advice atom with an existing intent
  {
    const r = compileOk({ descriptor: respondAdvice("compare_before_choosing", [1, 3]), records: [] });
    const adv = r.envelope.semanticAtoms.filter((a) => a.kind === "IC02_ADVICE_ATOM");
    ok(adv.length === 1 && adv[0].advice === "compare_before_choosing", "IC02-D05 — advice maps to an IC02_ADVICE_ATOM with a closed intent");
    ok(IC.ADVICE_INTENTS.includes(adv[0].advice), "IC02-D06 — the advice intent is an existing IC01 advice intent");
  }
  // CLARIFY / ESCALATE map to their outcomes (a glue atom carrying the closed reason)
  {
    const rc = compileOk({ descriptor: clarifyD("MISSING_DESTINATION"), records: [] });
    eq(rc.envelope.compiledOutcome, "COMPILED_CLARIFICATION", "IC02-D07 — CLARIFY → COMPILED_CLARIFICATION");
    const re = compileOk({ descriptor: escalD("TRANSACTIONAL_REQUEST"), records: [] });
    eq(re.envelope.compiledOutcome, "COMPILED_HUMAN_ESCALATION", "IC02-D08 — ESCALATE_TO_HUMAN → COMPILED_HUMAN_ESCALATION");
  }
  // unsupported / malformed descriptor fails closed (never invents a clarification/escalation)
  const badDesc = CMP.compileAnswer(mkReq({ descriptor: { kind: "RESPOND", language: "en", claims: [{ kind: "fact", answer: "nope", groundedInStep: 0 }] } }));
  eq(badDesc.disposition, "IC02_REJECTED", "IC02-D09 — an unmapped fact answer fails closed");
  ok(!("envelope" in badDesc), "IC02-D10 — a rejected compile returns NO envelope (never invents a clarify/escalate)");
  eq(badDesc.rejectCode, "IC02_REJECT_TERMINAL_DESCRIPTOR_INVALID", "IC02-D11 — an unmapped descriptor is rejected at validation");
}

// ═════════════════════════════ 5. BUDGET / PREFERENCE DEFERRAL (P1-03) ══════
section("IC02-E — NO numeric budget matching; no preference input; no preference atom");
// the request has NO preference/budget field — a budget key is rejected (strict keys)
eq(CMP.compileAnswer(Object.assign(mkReq({}), { budget: "5000" })).rejectCode, "IC02_REJECT_MALFORMED_REQUEST", "IC02-E01 — a stray budget field on the request fails closed");
eq(CMP.compileAnswer(Object.assign(mkReq({}), { preference: { budget: "₹5000" } })).rejectCode, "IC02_REJECT_MALFORMED_REQUEST", "IC02-E02 — a monetary-looking preference field is inadmissible (never parsed)");
// no admitted atom is a preference/budget atom
ok(!CMP.IC02_SEMANTIC_ATOM_KINDS.some((k) => /PREFERENCE|BUDGET/i.test(k)), "IC02-E03 — no admitted atom kind is a preference/budget atom");
// WITHIN_STATED_BUDGET does not exist anywhere in IC02's closed vocabularies
const ic02Vocab = [].concat(Array.from(CMP.IC02_SEMANTIC_ATOM_KINDS), Array.from(CMP.IC02_COMPILED_OUTCOMES), Array.from(CMP.IC02_DERIVATION_KINDS), Array.from(CMP.IC02_REJECT_CODES));
ok(!ic02Vocab.some((v) => /WITHIN_STATED_BUDGET|CURRENCY|INR/i.test(v)), "IC02-E04 — no WITHIN_STATED_BUDGET / currency / INR concept in IC02 v1");
// a validated envelope carrying a preference-match atom is rejected by the verifier
{
  const good = compileOk({}).envelope;
  const tampered = clone(good);
  tampered.semanticAtoms.push({ kind: "IC02_PREFERENCE_MATCH_ATOM", value: {} });
  const v = CMP.verifyEnvelope(tampered);
  ok(!v.ok, "IC02-E05 — an envelope carrying a preference-match atom fails verification (never admitted)");
}
// ordinary count/results facts still render (the only 'price-ish' fact IC01 supports is the results count)
{
  const r = compileOk({ descriptor: respondFact(0, "results_summary"), records: [mkRecord({ verifiedStepIndex: 0, evidenceKind: "results", evidence: { kind: "results", count: 3, orderedIds: ["h1", "h2", "h3"] } })] });
  ok(/3/.test(r.envelope.canonicalText), "IC02-E06 — an ordinary results-count fact still renders its verified value");
}

// ═════════════════════════════ 6. PRODUCER / VERIFIER (P1-04) ═══════════════
section("IC02-F — CompiledAnswerEnvelope + PURE tamper-detecting verifier");
{
  const env = compileOk({ descriptor: respondFact(0, "results_summary") }).envelope;
  ok(CMP.verifyEnvelope(env).ok === true, "IC02-F01 — a valid envelope passes the verifier");
  ok(Object.isFrozen(env) && Object.isFrozen(env.binding) && Object.isFrozen(env.semanticAtoms), "IC02-F02 — the envelope is deeply frozen");
  eq(env.disposition, "IC02_ACCEPTED", "IC02-F03 — an accepted envelope carries IC02_ACCEPTED");
  ok(SCH.sha256Hex(env.canonicalText) === env.textHash, "IC02-F04 — textHash is the SHA-256 of canonicalText (no provider)");
  const tamper = (mut, wantCode, label) => { const c = clone(env); mut(c); const v = CMP.verifyEnvelope(c); ok(!v.ok && v.rejectCode === wantCode, `${label} (got ${JSON.stringify(v)})`); };
  tamper((c) => { c.canonicalText = c.canonicalText + " EXTRA"; }, "IC02_REJECT_NONDETERMINISTIC", "IC02-F05 — modified canonicalText fails (rerender mismatch)");
  tamper((c) => { c.textHash = SCH.sha256Hex("forged"); }, "IC02_REJECT_TEXT_HASH", "IC02-F06 — modified textHash fails");
  tamper((c) => { c.semanticHash = SCH.sha256Hex("forged"); }, "IC02_REJECT_SEMANTIC_HASH", "IC02-F07 — modified semanticHash fails");
  tamper((c) => { c.binding.authorityRef = "auth-evil"; }, "IC02_REJECT_SEMANTIC_HASH", "IC02-F08 — modified binding fails (semantic-hash covers the binding)");
  tamper((c) => { c.answerId = "ans-evil"; }, "IC02_REJECT_SEMANTIC_HASH", "IC02-F09 — modified answer identity fails");
  tamper((c) => { c.planId = "plan-evil"; }, "IC02_REJECT_SEMANTIC_HASH", "IC02-F10 — modified plan identity fails");
  tamper((c) => { if (c.evidenceCommitments[0]) c.evidenceCommitments[0].receiptCommitment = SCH.sha256Hex("forged"); }, "IC02_REJECT_SEMANTIC_HASH", "IC02-F11 — modified evidence commitment fails");
  tamper((c) => { c.disposition = "IC02_REJECTED"; }, "IC02_REJECT_ENVELOPE_UNACCEPTED", "IC02-F12 — modified acceptance disposition fails");
  tamper((c) => { c.compilerVersion = "staybid-answer-compiler.v0"; }, "IC02_REJECT_ENVELOPE_UNACCEPTED", "IC02-F13 — an unaccepted (wrong-version) envelope fails");
  // a SHAPE-VALID fact value tamper (a different in-range count) breaks the semantic hash
  tamper((c) => { const fa = c.semanticAtoms.find((a) => a.kind === "IC02_FACT_ATOM"); if (fa) fa.value.count = 5; }, "IC02_REJECT_SEMANTIC_HASH", "IC02-F14 — a tampered (in-range) fact value fails (semantic-hash covers the atoms)");
  // an OUT-OF-RANGE fact value is not a producible atom → rejected at shape (P1-04 residual), before the hash
  tamper((c) => { const fa = c.semanticAtoms.find((a) => a.kind === "IC02_FACT_ATOM"); if (fa) fa.value.count = 999; }, "IC02_REJECT_ENVELOPE_MALFORMED", "IC02-F14b — an out-of-range fact value fails closed as malformed (not producible)");
  // oversized output (canonicalText beyond the bound) fails at verify
  tamper((c) => { c.canonicalText = "x".repeat(4001); c.textHash = SCH.sha256Hex(c.canonicalText); }, "IC02_REJECT_ENVELOPE_MALFORMED", "IC02-F15 — an over-bound canonicalText fails closed");
  // a wholly fabricated envelope cannot pass
  ok(!CMP.verifyEnvelope({ hello: "world" }).ok, "IC02-F16 — a fabricated non-envelope fails closed");
}

// ═════════════════════════════ 7. MULTILINGUAL (§12) ════════════════════════
section("IC02-G — English / Hindi / Hinglish render from EQUIVALENT semantic atoms");
{
  const base = { descriptor: respondFact(0, "results_summary"), records: [mkRecord({ verifiedStepIndex: 0, evidenceKind: "results", evidence: { kind: "results", count: 4, orderedIds: ["h1", "h2", "h3", "h4"] } })] };
  const en = compileOk(Object.assign({}, base, { language: "en" })).envelope;
  const hi = compileOk(Object.assign({}, base, { language: "hi" })).envelope;
  const hg = compileOk(Object.assign({}, base, { language: "hinglish" })).envelope;
  // same semantics ⇒ identical language-independent semantic commitment + atoms
  eq(en.semanticHash, hi.semanticHash, "IC02-G01 — semantic commitment is EQUIVALENT across en/hi (language-independent)");
  eq(en.semanticHash, hg.semanticHash, "IC02-G02 — semantic commitment is EQUIVALENT across en/hinglish");
  jeq(en.semanticAtoms, hi.semanticAtoms, "IC02-G03 — the semantic atoms are identical across languages");
  // rendered text differs by language but the factual value never drifts
  ok(en.canonicalText !== hi.canonicalText && en.canonicalText !== hg.canonicalText, "IC02-G04 — canonical TEXT differs by language");
  ok(en.textHash !== hi.textHash, "IC02-G05 — text hash differs by language");
  ok(/4/.test(en.canonicalText) && /4/.test(hi.canonicalText) && /4/.test(hg.canonicalText), "IC02-G06 — the verified value (4) appears verbatim in every language (no drift)");
  [en, hi, hg].forEach((e, i) => ok(CMP.verifyEnvelope(e).ok, `IC02-G07 — the ${["en", "hi", "hinglish"][i]} envelope self-verifies`));
  ok(CMP.ic02LocaleCoverageComplete(), "IC02-G08 — the template catalog covers all three languages");
  // fail-closed locale: the renderer NEVER falls back to another language
  eq(CMP.ic02RenderAtom({ kind: "IC02_FACT_ATOM", answer: "results_summary", evidenceKind: "results", verifiedStepIndex: 0, receiptId: "r", value: { count: 2 } }, "fr"), null, "IC02-G09 — an unsupported language returns null (never falls back to another language)");
}
// unknown remains unknown — a detail fact with an unknown facility is NEVER fabricated
{
  const rUnknownParking = compileOk({ descriptor: respondFact(0, "hotel_facts"), records: [mkRecord({ verifiedStepIndex: 0, evidenceKind: "detail", evidence: EV.detail("present", "unknown") })] }).envelope;
  const atoms = rUnknownParking.semanticAtoms;
  ok(atoms.some((a) => a.kind === "IC02_UNCERTAINTY_ATOM" && a.topic === "parking"), "IC02-G10 — an unknown parking becomes an UNCERTAINTY atom");
  ok(atoms.some((a) => a.kind === "IC02_FACT_ATOM" && a.value.breakfast === "present" && !("parking" in a.value)), "IC02-G11 — the fact atom carries only the KNOWN facility (breakfast), never a fabricated parking");
  ok(/not specified/i.test(rUnknownParking.canonicalText) && !/parking is available|parking is not available/i.test(rUnknownParking.canonicalText), "IC02-G12 — unknown parking renders 'not specified' (never coerced to available/not available)");
  // both unknown → only uncertainty atoms, no fabricated facts
  const rBoth = compileOk({ descriptor: respondFact(0, "hotel_facts"), records: [mkRecord({ verifiedStepIndex: 0, evidenceKind: "detail", evidence: EV.detail("unknown", "unknown") })] }).envelope;
  ok(rBoth.semanticAtoms.filter((a) => a.kind === "IC02_UNCERTAINTY_ATOM").length === 2 && rBoth.semanticAtoms.every((a) => a.kind !== "IC02_FACT_ATOM"), "IC02-G13 — both facilities unknown → two uncertainty atoms, zero fact atoms (no fabrication)");
}

// ═════════════════════════════ 8. FAIL-CLOSED matrix (§14) ══════════════════
section("IC02-H — fail-closed reject matrix");
eq(CMP.compileAnswer(42).rejectCode, "IC02_REJECT_MALFORMED_REQUEST", "IC02-H01 — a non-object request fails closed");
eq(CMP.compileAnswer(Object.assign(mkReq({}), { strayKey: "x" })).rejectCode, "IC02_REJECT_MALFORMED_REQUEST", "IC02-H01b — a request with an extra key fails closed (strict keys)");
eq(CMP.compileAnswer(Object.assign(mkReq({}), { contractVersion: "v9" })).rejectCode, "IC02_REJECT_CONTRACT_VERSION", "IC02-H02 — a wrong contract version fails closed");
eq(CMP.compileAnswer(mkReq({ answerId: "bad id!!" })).rejectCode, "IC02_REJECT_IDENTITY_INVALID", "IC02-H03 — an invalid controller identity fails closed");
eq(CMP.compileAnswer(Object.assign(mkReq({}), { trustedCurrentBinding: Object.assign(clone(B), { pageId: "checkout" }) })).rejectCode, "IC02_REJECT_BINDING_INVALID", "IC02-H04 — an invalid binding fails closed");
eq(CMP.compileAnswer(mkReq({ language: "fr" })).rejectCode, "IC02_REJECT_LANGUAGE_UNSUPPORTED", "IC02-H05 — an unsupported language fails closed");
eq(CMP.compileAnswer(mkReq({ records: [mkRecord({ verifiedStepIndex: 0, sourceAuthority: RA(B, { authorityRef: "auth-evil" }) })] })).rejectCode, "IC02_REJECT_AUTHORITY_MISMATCH", "IC02-H06 — a source-authority substitution fails closed");
eq(CMP.compileAnswer(mkReq({ records: [mkRecord({ verifiedStepIndex: 0, resultAuthority: RA(B, { routeEpoch: 9 }) })] })).rejectCode, "IC02_REJECT_AUTHORITY_MISMATCH", "IC02-H07 — a result-authority substitution fails closed");
eq(CMP.compileAnswer(mkReq({ records: [mkRecord({ verifiedStepIndex: 0, binding: Object.assign(clone(B), { authorityRef: "auth-stale" }) })] })).rejectCode, "IC02_REJECT_STALE_BINDING", "IC02-H08 — a stale record binding fails closed");
eq(CMP.compileAnswer(mkReq({ descriptor: { kind: "NOPE" } })).rejectCode, "IC02_REJECT_TERMINAL_DESCRIPTOR_INVALID", "IC02-H09 — an unknown terminal kind fails closed");
eq(CMP.compileAnswer(mkReq({ records: [mkRecord({ verifiedStepIndex: 0, receiptId: "bad id!!" })] })).rejectCode, "IC02_REJECT_EVIDENCE_RECORD_INVALID", "IC02-H10 — an invalid record fails closed");

// ═════════════════════════════ R1. P1-01 — provenance promotion / admission ══
section("IC02-R1 — P1-01: non-null result authority required; pre-consistency; atomic promotion; lifecycle");
// (a) a VERIFIED provenance record REQUIRES a non-null result authority
eq(CMP.buildVerifiedEvidenceRecord(mkRecord({ verifiedStepIndex: 0, resultAuthority: null })), null, "IC02-R1a — a record with null resultAuthority is inadmissible");
eq(CMP.compileAnswer(mkReq({ records: [mkRecord({ verifiedStepIndex: 0, resultAuthority: null })] })).rejectCode, "IC02_REJECT_EVIDENCE_RECORD_INVALID", "IC02-R1b — a compile request carrying a null-authority record fails closed");
ok(CMP.buildVerifiedEvidenceRecord(mkRecord({ verifiedStepIndex: 0 })) !== null, "IC02-R1c — a complete record WITH a non-null result authority still admits (non-vacuous)");
// (b) LOOP: a context-advancing VERIFIED whose authority did NOT advance NEVER exposes IC02 provenance
{
  const loop = AL.createAgentLoop(fakeDeps());
  const e1 = loop.beginTurn({ binding: icBinding(), userTurn: icTurn(), nowMs: 0 });
  const e2 = loop.submitModelPlan({ modelRequestId: e1.modelRequestId, plan: icPlan([capStep("APPLY_HOTEL_REFINEMENT", { op: "APPLY_HOTEL_REFINEMENT", maxPrice: 5000 }), respondAdvice()], "REFINE_RESULTS"), nowMs: 10 });
  const { e: r } = loopVerify(loop, e2, { resultAuthority: "same" }, 18, 20); // advancing cap, unmoved authority
  eq(r.reason, "HONEST_FAILURE", "IC02-R1d — an advancing VERIFIED with unmoved authority FAILS CLOSED (consistency BEFORE promotion)");
  eq(loop.verifiedEvidence().length, 0, "IC02-R1e — NO IC02 provenance exposed for the inconsistent advancing VERIFIED");
  eq(loop.status().evidenceHandles, 0, "IC02-R1f — NO IC01 evidence handle promoted either (nothing committed)");
}
// (c) LOOP: a genuinely advancing VERIFIED retains provenance ATOMICALLY (IC01 handle + IC02 record together), then rebind clears it
{
  const loop = AL.createAgentLoop(fakeDeps());
  const e1 = loop.beginTurn({ binding: icBinding(), userTurn: icTurn(), nowMs: 0 });
  const e2 = loop.submitModelPlan({ modelRequestId: e1.modelRequestId, plan: icPlan([capStep("APPLY_HOTEL_REFINEMENT", { op: "APPLY_HOTEL_REFINEMENT", maxPrice: 5000 }), respondAdvice()], "REFINE_RESULTS"), nowMs: 10 });
  const { e: r } = loopVerify(loop, e2, { resultAuthority: "advance" }, 18, 20);
  eq(r.kind, "REBIND_REQUIRED", "IC02-R1g — an advancing VERIFIED with advanced authority enters the rebind gate");
  eq(loop.verifiedEvidence().length, 1, "IC02-R1h — provenance retained atomically at the promotion");
  eq(loop.status().evidenceHandles, loop.verifiedEvidence().length, "IC02-R1i — IC01 handle count EQUALS IC02 record count (committed together — never IC01-only)");
  const rb = loop.rebind({ binding: icBinding({ routeEpoch: 2, contextRevision: "rev-adv", authorityRef: "auth-adv", contextDigest: "c".repeat(64) }), nowMs: 30 });
  eq(rb.kind, "MODEL_REQUEST", "IC02-R1j — the exact advanced rebind succeeds");
  eq(loop.verifiedEvidence().length, 0, "IC02-R1k — REV-05: rebind discards the stale provenance");
}
// (d) LOOP: a plain non-advancing VERIFIED commits IC01 + IC02 together (atomicity, positive path)
{
  const loop = AL.createAgentLoop(fakeDeps());
  const e1 = loop.beginTurn({ binding: icBinding(), userTurn: icTurn(), nowMs: 0 });
  const e2 = loop.submitModelPlan({ modelRequestId: e1.modelRequestId, plan: icPlan([capStep("READ_CURRENT_RESULTS", { op: "READ_CURRENT_RESULTS" }), respondAdvice()]), nowMs: 10 });
  const { e: r } = loopVerify(loop, e2, {}, 18, 20);
  eq(r.reason, "COMPLETED", "IC02-R1l — a valid non-advancing VERIFIED still promotes + completes");
  eq(loop.status().evidenceHandles, 1, "IC02-R1m — one IC01 handle");
  eq(loop.verifiedEvidence().length, 1, "IC02-R1m — one IC02 record (atomic with the IC01 handle)");
}

// ═════════════════════════════ R2. P1-02 — terminal PRODUCER seam ════════════
section("IC02-R2 — P1-02: the agent-loop terminal producer invokes the compiler (no legacy narration bypass)");
// (a) RESPOND terminal produces a valid, self-verifying CompiledAnswerEnvelope
{
  const loop = AL.createAgentLoop(fakeDeps());
  const e1 = loop.beginTurn({ binding: icBinding(), userTurn: icTurn(), nowMs: 0 });
  const e2 = loop.submitModelPlan({ modelRequestId: e1.modelRequestId, plan: icPlan([capStep("READ_CURRENT_RESULTS", { op: "READ_CURRENT_RESULTS" }), respondFact(0, "results_summary")]), nowMs: 10 });
  const { e: r } = loopVerify(loop, e2, {}, 18, 20);
  eq(r.reason, "COMPLETED", "IC02-R2a — a grounded RESPOND completes");
  ok(r.envelope && r.envelope.compiledOutcome === "COMPILED_RESPONSE", "IC02-R2b — the terminal carries a COMPILED_RESPONSE envelope (typed producer boundary)");
  ok(CMP.verifyEnvelope(r.envelope).ok === true, "IC02-R2c — the terminal envelope passes the pure verifier");
  ok(r.envelope.answerId && IC.INTELLIGENCE_CONTRACT_VERSION === r.envelope.contractVersion, "IC02-R2d — the envelope carries a controller-owned answerId + the contract version");
}
// (b) CLARIFY → COMPILED_CLARIFICATION envelope; text EQUALS the accepted deterministic render (inheritance-safe)
{
  const loop = AL.createAgentLoop(fakeDeps());
  const e1 = loop.beginTurn({ binding: icBinding(), userTurn: icTurn(), nowMs: 0 });
  const e2 = loop.submitModelPlan({ modelRequestId: e1.modelRequestId, plan: icPlan([clarifyD("MISSING_DESTINATION")], "CLARIFY"), nowMs: 10 });
  eq(e2.reason, "CLARIFICATION_ISSUED", "IC02-R2e — CLARIFY still issues a clarification (IC01 semantics preserved)");
  ok(e2.envelope && e2.envelope.compiledOutcome === "COMPILED_CLARIFICATION" && CMP.verifyEnvelope(e2.envelope).ok, "IC02-R2f — CLARIFY carries a verifying COMPILED_CLARIFICATION envelope");
  eq(e2.envelope.canonicalText, IC.renderClarify("MISSING_DESTINATION", "en"), "IC02-R2g — the compiled clarification text EQUALS the deterministic render (no divergence)");
}
// (c) ESCALATE → COMPILED_HUMAN_ESCALATION envelope; text EQUALS the deterministic render
{
  const loop = AL.createAgentLoop(fakeDeps());
  const e1 = loop.beginTurn({ binding: icBinding(), userTurn: icTurn(), nowMs: 0 });
  const e2 = loop.submitModelPlan({ modelRequestId: e1.modelRequestId, plan: icPlan([escalD("TRANSACTIONAL_REQUEST")], "UNSUPPORTED"), nowMs: 10 });
  eq(e2.reason, "ESCALATION_SUGGESTED", "IC02-R2h — ESCALATE still suggests a human (IC01 semantics preserved)");
  ok(e2.envelope && e2.envelope.compiledOutcome === "COMPILED_HUMAN_ESCALATION" && CMP.verifyEnvelope(e2.envelope).ok, "IC02-R2i — ESCALATE carries a verifying COMPILED_HUMAN_ESCALATION envelope");
  eq(e2.envelope.canonicalText, IC.renderEscalation("TRANSACTIONAL_REQUEST", "en"), "IC02-R2j — the compiled escalation text EQUALS the deterministic render");
}
// (d) terminal compile rejection FAILS CLOSED (no envelope, no legacy factual narration, RESPOND stays RESPOND)
{
  const loop = AL.createAgentLoop(fakeDeps());
  const e1 = loop.beginTurn({ binding: icBinding(), userTurn: icTurn(), nowMs: 0 });
  const e2 = loop.submitModelPlan({ modelRequestId: e1.modelRequestId, plan: icPlan([capStep("READ_CURRENT_RESULTS", { op: "READ_CURRENT_RESULTS" }), respondFact(0, "results_summary")]), nowMs: 10 });
  const { e: r } = loopVerify(loop, e2, { outcome: "rejected", status: "no_op" }, 18, 20); // NO_OP → no verified provenance
  eq(r.reason, "UNGROUNDED_RESPONSE", "IC02-R2k — a fact with no verified provenance FAILS CLOSED (compiler rejection → UNGROUNDED_RESPONSE)");
  ok(!r.envelope, "IC02-R2l — a rejected terminal carries NO envelope (no legacy narration, RESPOND not transformed)");
  eq(loop.verifiedEvidence().length, 0, "IC02-R2m — no provenance was retained for the NO_OP step");
}
// (e) the surfaced conversation text comes from the envelope canonicalText (not a separate legacy render)
{
  const loop = AL.createAgentLoop(fakeDeps());
  const e1 = loop.beginTurn({ binding: icBinding(), userTurn: icTurn(), nowMs: 0 });
  const e2 = loop.submitModelPlan({ modelRequestId: e1.modelRequestId, plan: icPlan([capStep("READ_CURRENT_RESULTS", { op: "READ_CURRENT_RESULTS" }), respondFact(0, "results_summary")]), nowMs: 10 });
  const { e: r } = loopVerify(loop, e2, {}, 18, 20);
  const e3 = loop.beginTurn({ binding: icBinding({ turnId: "t2" }), userTurn: icTurn(), nowMs: 100 });
  const lastAssistant = e3.input.conversation.filter((c) => c.role === "assistant").slice(-1)[0];
  eq(lastAssistant.text, r.envelope.canonicalText, "IC02-R2n — the surfaced assistant text IS the compiled envelope canonicalText");
}

// ═════════════════════════════ R3. P1-03 — 16 KiB request ceiling ════════════
section("IC02-R3 — P1-03: exact 16 KiB serialized compile-request ceiling (reject, never truncate)");
ok(IC.IC01_LIMITS.MAX_MODEL_INPUT_BYTES === 16 * 1024, "IC02-R3a — the reused ceiling constant is exactly 16 KiB");
compileOk({}); // a valid request below the ceiling passes (non-vacuous)
{
  // a request in the 16–32 KiB band MUST fail (would have passed under the old 32 KiB assumption)
  const over16 = Object.assign(mkReq({}), { pad: "x".repeat(18 * 1024) });
  ok(IC.measureJsonBytes(over16) > 16 * 1024 && IC.measureJsonBytes(over16) < 32 * 1024, "IC02-R3b — the padded request is between 16 and 32 KiB");
  const r = CMP.compileAnswer(over16);
  eq(r.rejectCode, "IC02_REJECT_REQUEST_OVERFLOW", "IC02-R3c — a >16 KiB request fails closed (regression: not allowed up to 32 KiB)");
  ok(!("envelope" in r) && r.disposition === "IC02_REJECTED", "IC02-R3d — the over-ceiling request is REJECTED with no envelope (never truncated)");
}
{
  const way = Object.assign(mkReq({}), { pad: "y".repeat(40 * 1024) });
  eq(CMP.compileAnswer(way).rejectCode, "IC02_REJECT_REQUEST_OVERFLOW", "IC02-R3e — a far-over request also fails closed on size");
}

// ═════════════════════════════ R4. P1-04 — verifier cross-field invariants ════
section("IC02-R4 — P1-04: pure verifier enforces CLOSED producer invariants (hashes are NOT authority)");
// baseline: a genuine envelope satisfies the invariants
ok(CMP.validateProducerInvariants("COMPILED_RESPONSE", compileOk({}).envelope.semanticAtoms, compileOk({}).envelope.evidenceCommitments) === null, "IC02-R4a — a genuine RESPONSE envelope satisfies the producer invariants");
// every forgery below recomputes BOTH hashes correctly and STILL fails verification
// clarification + factual atom
ok(!forgeCompiledVerify(clarifyD("MISSING_DESTINATION"), (f) => { f.semanticAtoms.push(FACT_ATOM()); }).ok, "IC02-R4c — COMPILED_CLARIFICATION carrying a factual atom is rejected (rehashed)");
// escalation + factual atom
ok(!forgeCompiledVerify(escalD("TRANSACTIONAL_REQUEST"), (f) => { f.semanticAtoms.push(FACT_ATOM()); }).ok, "IC02-R4d — COMPILED_HUMAN_ESCALATION carrying a factual atom is rejected (rehashed)");
// factual RESPONSE with NO commitment
{ const v = forgeFactVerify((f) => { f.evidenceCommitments = []; }); ok(!v.ok && v.rejectCode === "IC02_REJECT_MISSING_PROVENANCE", "IC02-R4e — a factual RESPONSE with no commitment fails (missing provenance)"); }
// atom RECEIPT mismatch vs commitment
{ const v = forgeFactVerify((f) => { f.semanticAtoms.find((a) => a.kind === "IC02_FACT_ATOM").receiptId = "rc.evil"; }); ok(!v.ok && v.rejectCode === "IC02_REJECT_ENTITY_BINDING", "IC02-R4f — a fact atom receiptId mismatch vs commitment fails (entity binding)"); }
// atom STEP mismatch vs commitment
{ const v = forgeFactVerify((f) => { f.semanticAtoms.find((a) => a.kind === "IC02_FACT_ATOM").verifiedStepIndex = 2; }); ok(!v.ok && v.rejectCode === "IC02_REJECT_MISSING_PROVENANCE", "IC02-R4g — a fact atom step mismatch vs commitment fails (no commitment for that step)"); }
// atom EVIDENCE-KIND mismatch vs commitment (mutate the commitment's kind)
{ const v = forgeFactVerify((f) => { f.evidenceCommitments[0].evidenceKind = "detail"; }); ok(!v.ok && v.rejectCode === "IC02_REJECT_EVIDENCE_KIND_MISMATCH", "IC02-R4h — a fact atom evidence-kind mismatch vs commitment fails"); }
// clarification GLUE under COMPILED_RESPONSE
{ const v = forgeFactVerify((f) => { f.semanticAtoms.push({ kind: "IC02_GLUE_ATOM", role: "clarification", code: "MISSING_DESTINATION" }); }); ok(!v.ok && v.rejectCode === "IC02_REJECT_UNSUPPORTED_MAPPING", "IC02-R4i — a clarification glue atom under COMPILED_RESPONSE fails"); }
// ORPHAN / extra commitment
{ const v = forgeFactVerify((f) => { f.evidenceCommitments.push({ verifiedStepIndex: 3, receiptId: "rc.orphan", evidenceKind: "results", receiptCommitment: SCH.sha256Hex("orphan") }); }); ok(!v.ok && v.rejectCode === "IC02_REJECT_CONFLICTING_EVIDENCE", "IC02-R4j — an orphan/extra commitment fails"); }
// fabricated DERIVATION atom (compiler v1 cannot emit)
ok(!forgeFactVerify((f) => { f.semanticAtoms.push({ kind: "IC02_DERIVATION_ATOM", derivation: "LOWER_PRICE", verifiedStepIndex: 0, value: {} }); }).ok, "IC02-R4k — a fabricated derivation atom is rejected (v1 compiler cannot emit it)");

// ════════════ R5. P1-04 RESIDUAL — producible uncertainty ↔ DETAIL binding, topic dedup,
//              fact/uncertainty contradiction, and EXACT per-answer fact-value shapes ══════
section("IC02-R5 — P1-04 residual: the verifier admits only structures the v1 producer can emit");
// baseline: genuine hotel_facts envelopes (one-known-one-unknown / both-unknown / both-known) self-verify
{
  const oneUnknown = compileOk({ descriptor: respondFact(0, "hotel_facts"), records: [mkRecord({ verifiedStepIndex: 0, evidenceKind: "detail", evidence: EV.detail("present", "unknown") })] }).envelope;
  const bothUnknown = compileOk({ descriptor: respondFact(0, "hotel_facts"), records: [mkRecord({ verifiedStepIndex: 0, evidenceKind: "detail", evidence: EV.detail("unknown", "unknown") })] }).envelope;
  const bothKnown = compileOk({ descriptor: respondFact(0, "hotel_facts"), records: [mkRecord({ verifiedStepIndex: 0, evidenceKind: "detail", evidence: EV.detail("present", "absent") })] }).envelope;
  ok(CMP.verifyEnvelope(oneUnknown).ok && CMP.verifyEnvelope(bothUnknown).ok && CMP.verifyEnvelope(bothKnown).ok, "IC02-R5a — genuine hotel_facts envelopes (mixed / both-unknown / both-known) all self-verify");
  ok(CMP.validateProducerInvariants("COMPILED_RESPONSE", oneUnknown.semanticAtoms, oneUnknown.evidenceCommitments) === null, "IC02-R5b — a genuine mixed hotel_facts envelope satisfies the producer invariants");
}
// (1) an UNCERTAINTY atom backed by a RESULTS commitment (the packet's exact example) is rejected
{ const v = forgeUnknownVerify((f) => { f.evidenceCommitments[0].evidenceKind = "results"; }); ok(!v.ok && v.rejectCode === "IC02_REJECT_EVIDENCE_KIND_MISMATCH", "IC02-R5c — an uncertainty atom backed by a RESULTS commitment fails (must be DETAIL)"); }
// (2) an UNCERTAINTY atom backed by a NAVIGATION commitment is rejected (generalized non-detail)
{ const v = forgeUnknownVerify((f) => { f.evidenceCommitments[0].evidenceKind = "navigation"; }); ok(!v.ok && v.rejectCode === "IC02_REJECT_EVIDENCE_KIND_MISMATCH", "IC02-R5d — an uncertainty atom backed by a non-DETAIL commitment fails"); }
// (3) a DUPLICATE uncertainty topic on the same step is rejected
{ const v = forgeUnknownVerify((f) => { f.semanticAtoms.push({ kind: "IC02_UNCERTAINTY_ATOM", topic: "breakfast", verifiedStepIndex: 0 }); }); ok(!v.ok && v.rejectCode === "IC02_REJECT_CONFLICTING_EVIDENCE", "IC02-R5e — a duplicate uncertainty topic on the same step fails"); }
// (4) an UNCERTAINTY atom on a step with NO commitment is rejected (impossible: uncertainty has no provenance)
{ const v = forgeUnknownVerify((f) => { f.semanticAtoms.find((a) => a.kind === "IC02_UNCERTAINTY_ATOM").verifiedStepIndex = 3; }); ok(!v.ok && v.rejectCode === "IC02_REJECT_MISSING_PROVENANCE", "IC02-R5f — an uncertainty atom on a commitment-less step fails (missing provenance)"); }
// (5) a KNOWN fact value of "unknown" (unknown-as-known) is rejected as not producible (shape)
{ const v = forgeFactDetailVerify((f) => { f.semanticAtoms.find((a) => a.kind === "IC02_FACT_ATOM").value = { breakfast: "unknown" }; }); ok(!v.ok && v.rejectCode === "IC02_REJECT_ENVELOPE_MALFORMED", "IC02-R5g — a KNOWN fact value of 'unknown' fails closed (never a producible known value)"); }
// (6) the SAME facility both KNOWN and flagged UNKNOWN on one step is a contradiction
{ const v = forgeFactDetailVerify((f) => { f.semanticAtoms.push({ kind: "IC02_UNCERTAINTY_ATOM", topic: "breakfast", verifiedStepIndex: 0 }); }); ok(!v.ok && v.rejectCode === "IC02_REJECT_CONFLICTING_EVIDENCE", "IC02-R5h — a facility both KNOWN and flagged UNKNOWN on the same step fails (contradiction)"); }
// (7) EACH fact answer polluted with a cross-answer field is rejected (exact per-answer value shape)
{
  const pollute = [
    ["results_summary", "results", EV.results(), { section: "rooms" }],
    ["comparison_summary", "comparison", EV.comparison(), { count: 2 }],
    ["hotel_facts", "detail", EV.detail("present", "absent"), { count: 2 }],
    ["section_shown", "ui_state", EV.ui_state(), { count: 2 }],
    ["hotel_opened", "navigation", EV.navigation(), { section: "rooms" }],
  ];
  pollute.forEach(([answer, kind, ev, extra]) => {
    const good = compileOk({ descriptor: respondFact(0, answer), records: [mkRecord({ verifiedStepIndex: 0, evidenceKind: kind, evidence: ev })] }).envelope;
    const f = clone(good); Object.assign(f.semanticAtoms.find((a) => a.kind === "IC02_FACT_ATOM").value, extra);
    const h = CMP.ic02RecomputeEnvelopeHashes(f); f.semanticHash = h.semanticHash; f.textHash = h.textHash;
    const v = CMP.verifyEnvelope(f);
    ok(!v.ok && v.rejectCode === "IC02_REJECT_ENVELOPE_MALFORMED", `IC02-R5i — a ${answer} fact value polluted with a cross-answer field fails closed`);
  });
}

// ════════════ R6. P1-04 RESIDUAL — hotel_facts FACILITY-STATE COMPLETENESS ═══════════════════
//  Every hotel_facts step must account for BOTH breakfast AND parking (each exactly one state:
//  KNOWN present/absent OR one UNCERTAINTY atom). An incomplete semantic representation, even with
//  a valid DETAIL commitment and both hashes recomputed, is not producible → fail closed.
section("IC02-R6 — P1-04 residual: hotel_facts facility-state completeness (both facilities represented)");
{
  const forgeFacts = (bf, pk, mut) => {
    const good = compileOk({ descriptor: respondFact(0, "hotel_facts"), records: [mkRecord({ verifiedStepIndex: 0, evidenceKind: "detail", evidence: EV.detail(bf, pk) })] }).envelope;
    const f = clone(good); mut(f);
    const h = CMP.ic02RecomputeEnvelopeHashes(f); f.semanticHash = h.semanticHash; f.textHash = h.textHash;
    return CMP.verifyEnvelope(f);
  };
  const dropUncertainty = (topic) => (f) => { f.semanticAtoms = f.semanticAtoms.filter((a) => !(a.kind === "IC02_UNCERTAINTY_ATOM" && a.topic === topic)); };
  // POSITIVE — all four genuine producer combinations still verify
  ok(forgeFacts("present", "absent", () => {}).ok, "IC02-R6a — BOTH KNOWN (breakfast present, parking absent) verifies");
  ok(forgeFacts("present", "unknown", () => {}).ok, "IC02-R6b — breakfast KNOWN / parking UNKNOWN verifies");
  ok(forgeFacts("unknown", "present", () => {}).ok, "IC02-R6c — breakfast UNKNOWN / parking KNOWN verifies");
  ok(forgeFacts("unknown", "unknown", () => {}).ok, "IC02-R6d — BOTH UNKNOWN verifies");
  // TEST A — breakfast KNOWN / parking UNKNOWN, remove the parking uncertainty (keep DETAIL commitment)
  { const v = forgeFacts("present", "unknown", dropUncertainty("parking")); ok(!v.ok && v.rejectCode === "IC02_REJECT_UNSUPPORTED_MAPPING", "IC02-R6e — TEST A: parking neither KNOWN nor UNKNOWN fails closed (incomplete facilities)"); }
  // TEST B — BOTH UNKNOWN, remove ONE uncertainty (keep DETAIL commitment)
  { const v = forgeFacts("unknown", "unknown", dropUncertainty("parking")); ok(!v.ok && v.rejectCode === "IC02_REJECT_UNSUPPORTED_MAPPING", "IC02-R6f — TEST B: one facility missing from a both-unknown step fails closed"); }
  // TEST C — breakfast UNKNOWN / parking KNOWN, remove the breakfast uncertainty
  { const v = forgeFacts("unknown", "present", dropUncertainty("breakfast")); ok(!v.ok && v.rejectCode === "IC02_REJECT_UNSUPPORTED_MAPPING", "IC02-R6g — TEST C: breakfast neither KNOWN nor UNKNOWN fails closed (incomplete facilities)"); }
  // negative-control: dropping the whole FACT atom AND leaving only one uncertainty is still incomplete
  { const v = forgeFacts("present", "unknown", (f) => { f.semanticAtoms = f.semanticAtoms.filter((a) => a.kind !== "IC02_FACT_ATOM"); }); ok(!v.ok && v.rejectCode === "IC02_REJECT_UNSUPPORTED_MAPPING", "IC02-R6h — removing the KNOWN fact atom leaves breakfast unrepresented → fails closed"); }
}

function forgeUnknownVerify(mut) {
  const good = compileOk({ descriptor: respondFact(0, "hotel_facts"), records: [mkRecord({ verifiedStepIndex: 0, evidenceKind: "detail", evidence: EV.detail("unknown", "unknown") })] }).envelope;
  const f = clone(good); mut(f);
  const h = CMP.ic02RecomputeEnvelopeHashes(f); f.semanticHash = h.semanticHash; f.textHash = h.textHash;
  return CMP.verifyEnvelope(f);
}
function forgeFactDetailVerify(mut) {
  const good = compileOk({ descriptor: respondFact(0, "hotel_facts"), records: [mkRecord({ verifiedStepIndex: 0, evidenceKind: "detail", evidence: EV.detail("present", "unknown") })] }).envelope;
  const f = clone(good); mut(f);
  const h = CMP.ic02RecomputeEnvelopeHashes(f); f.semanticHash = h.semanticHash; f.textHash = h.textHash;
  return CMP.verifyEnvelope(f);
}

function forgeFactVerify(mut) {
  const good = compileOk({ descriptor: respondFact(0, "results_summary"), records: [mkRecord({ verifiedStepIndex: 0, evidenceKind: "results" })] }).envelope;
  const f = clone(good); mut(f);
  const h = CMP.ic02RecomputeEnvelopeHashes(f); f.semanticHash = h.semanticHash; f.textHash = h.textHash;
  return CMP.verifyEnvelope(f);
}
function forgeCompiledVerify(descriptor, mut) {
  const good = compileOk({ descriptor, records: [] }).envelope;
  const f = clone(good); mut(f);
  const h = CMP.ic02RecomputeEnvelopeHashes(f); f.semanticHash = h.semanticHash; f.textHash = h.textHash;
  return CMP.verifyEnvelope(f);
}

// ═════════════════════════════ 9. MUTATION / NON-VACUITY (§16) ══════════════
section("IC02-I — named MUTATION / NON-VACUITY probes (each protection is live + non-vacuous)");
// honest baseline compiles + verifies (proves the probes are not vacuously rejecting everything)
{
  const good = compileOk({ descriptor: respondFact(0, "results_summary") });
  probe("baseline_valid_compiles_and_verifies", good.disposition === "IC02_ACCEPTED" && CMP.verifyEnvelope(good.envelope).ok === true);
}
// 1 — verification/provenance bypass
probe("provenance_bypass_rejected", CMP.compileAnswer(mkReq({ descriptor: respondFact(0, "results_summary"), records: [] })).rejectCode === "IC02_REJECT_MISSING_PROVENANCE");
// 2 — staleness bypass
probe("staleness_bypass_rejected", CMP.compileAnswer(mkReq({ records: [mkRecord({ verifiedStepIndex: 0, binding: Object.assign(clone(B), { contextRevision: "rev-moved" }) })] })).rejectCode === "IC02_REJECT_STALE_BINDING");
// 3 — authority comparison removal
probe("authority_mismatch_rejected", CMP.compileAnswer(mkReq({ records: [mkRecord({ verifiedStepIndex: 0, sourceAuthority: RA(B, { contextDigest: "b".repeat(64) }) })] })).rejectCode === "IC02_REJECT_AUTHORITY_MISMATCH");
// 4 — entity/field binding removal (wrong evidence kind for the answer)
probe("entity_binding_mismatch_rejected", CMP.compileAnswer(mkReq({ descriptor: respondFact(0, "hotel_opened"), records: [mkRecord({ verifiedStepIndex: 0, evidenceKind: "results", evidence: EV.results() })] })).rejectCode === "IC02_REJECT_EVIDENCE_KIND_MISMATCH");
// 5 — unknown→false coercion
{
  const e = CMP.compileAnswer(mkReq({ descriptor: respondFact(0, "hotel_facts"), records: [mkRecord({ verifiedStepIndex: 0, evidenceKind: "detail", evidence: EV.detail("unknown", "present") })] })).envelope;
  probe("unknown_not_coerced_to_false", /not specified/i.test(e.canonicalText) && !/breakfast is not available|breakfast is available/i.test(e.canonicalText));
}
// 6 — post-validation value substitution (deep-copy immutability)
{
  const input = mkRecord({ evidenceKind: "results" });
  const rec = CMP.buildVerifiedEvidenceRecord(input);
  input.evidence.count = 999;
  probe("post_validation_substitution_blocked", rec.evidence.count === 2 && Object.isFrozen(rec.evidence));
}
// 7 — hash/text substitution (verifier)
{
  const env = compileOk({}).envelope;
  const c1 = clone(env); c1.semanticHash = SCH.sha256Hex("x");
  const c2 = clone(env); c2.textHash = SCH.sha256Hex("y");
  probe("hash_substitution_rejected", !CMP.verifyEnvelope(c1).ok && !CMP.verifyEnvelope(c2).ok);
}
// 8 — budget-string numeric promotion
probe("budget_string_never_promoted", CMP.compileAnswer(Object.assign(mkReq({}), { requestedBudget: "5000" })).rejectCode === "IC02_REJECT_MALFORMED_REQUEST");
// 9 — model-selectable derivation (comparison winners are NOT promoted to a derivation atom)
{
  const derivs = CMP.ic02ComputeDerivations("comparison_summary", EV.comparison(), 0);
  const e = compileOk({ descriptor: respondFact(0, "comparison_summary"), records: [mkRecord({ verifiedStepIndex: 0, evidenceKind: "comparison", evidence: EV.comparison() })] }).envelope;
  probe("derivations_not_model_selectable_and_none_emitted", Array.isArray(derivs) && derivs.length === 0 && e.semanticAtoms.every((a) => a.kind !== "IC02_DERIVATION_ATOM"));
}
// 10 — pure-verifier bypass (a fabricated-but-plausible envelope cannot pass)
{
  const env = compileOk({}).envelope;
  const forged = clone(env); forged.canonicalText = "You have a great booking!"; // keep hashes → rerender mismatch
  probe("pure_verifier_bypass_rejected", !CMP.verifyEnvelope(forged).ok && !CMP.verifyEnvelope({ disposition: "IC02_ACCEPTED" }).ok);
}
// 11 — P1-01: null result-authority admission
probe("null_result_authority_admission_rejected", CMP.buildVerifiedEvidenceRecord(mkRecord({ verifiedStepIndex: 0, resultAuthority: null })) === null);
// 12 — P1-01: pre-consistency provenance exposure (advancing-unmoved never enters the ledger)
{
  const loop = AL.createAgentLoop(fakeDeps());
  const e1 = loop.beginTurn({ binding: icBinding(), userTurn: icTurn(), nowMs: 0 });
  const e2 = loop.submitModelPlan({ modelRequestId: e1.modelRequestId, plan: icPlan([capStep("APPLY_HOTEL_REFINEMENT", { op: "APPLY_HOTEL_REFINEMENT", maxPrice: 5000 }), respondAdvice()], "REFINE_RESULTS"), nowMs: 10 });
  const { e: r } = loopVerify(loop, e2, { resultAuthority: "same" }, 18, 20);
  probe("pre_consistency_provenance_not_exposed", r.reason === "HONEST_FAILURE" && loop.verifiedEvidence().length === 0 && loop.status().evidenceHandles === 0);
}
// 13 — P1-01: atomic promotion (IC01 handle count == IC02 record count after a valid VERIFIED)
{
  const loop = AL.createAgentLoop(fakeDeps());
  const e1 = loop.beginTurn({ binding: icBinding(), userTurn: icTurn(), nowMs: 0 });
  const e2 = loop.submitModelPlan({ modelRequestId: e1.modelRequestId, plan: icPlan([capStep("READ_CURRENT_RESULTS", { op: "READ_CURRENT_RESULTS" }), respondAdvice()]), nowMs: 10 });
  loopVerify(loop, e2, {}, 18, 20);
  probe("atomic_promotion_ic01_equals_ic02", loop.status().evidenceHandles === 1 && loop.verifiedEvidence().length === 1);
}
// 14 — P1-02: terminal compiler bypass (a COMPLETED RESPOND MUST carry a verifying envelope)
{
  const loop = AL.createAgentLoop(fakeDeps());
  const e1 = loop.beginTurn({ binding: icBinding(), userTurn: icTurn(), nowMs: 0 });
  const e2 = loop.submitModelPlan({ modelRequestId: e1.modelRequestId, plan: icPlan([capStep("READ_CURRENT_RESULTS", { op: "READ_CURRENT_RESULTS" }), respondFact(0, "results_summary")]), nowMs: 10 });
  const { e: r } = loopVerify(loop, e2, {}, 18, 20);
  probe("terminal_never_bypasses_compiler", r.reason === "COMPLETED" && !!r.envelope && CMP.verifyEnvelope(r.envelope).ok === true);
}
// 15 — P1-03: 16 KiB request-limit regression (a 16–32 KiB request MUST fail)
probe("request_16kb_ceiling_enforced", CMP.compileAnswer(Object.assign(mkReq({}), { pad: "x".repeat(18 * 1024) })).rejectCode === "IC02_REJECT_REQUEST_OVERFLOW");
// 16 — P1-04: outcome/atom mismatch (clarification carrying a fact atom, rehashed)
probe("outcome_atom_mismatch_rejected", !forgeCompiledVerify(clarifyD("MISSING_DESTINATION"), (f) => { f.semanticAtoms.push(FACT_ATOM()); }).ok);
// 17 — P1-04: fact-without-commitment (rehashed)
probe("fact_without_commitment_rejected", forgeFactVerify((f) => { f.evidenceCommitments = []; }).rejectCode === "IC02_REJECT_MISSING_PROVENANCE");
// 18 — P1-04: rehashed cross-field forgery + verifier cross-field bypass (both hashes recomputed correctly)
probe("rehashed_cross_field_forgery_rejected", forgeFactVerify((f) => { f.semanticAtoms.find((a) => a.kind === "IC02_FACT_ATOM").receiptId = "rc.evil"; }).rejectCode === "IC02_REJECT_ENTITY_BINDING");
// 19 — P1-04 residual: an uncertainty atom must be backed by a DETAIL commitment (rehashed)
probe("uncertainty_requires_detail_commitment", forgeUnknownVerify((f) => { f.evidenceCommitments[0].evidenceKind = "results"; }).rejectCode === "IC02_REJECT_EVIDENCE_KIND_MISMATCH");
// 20 — P1-04 residual: a duplicate uncertainty topic on a step is rejected (rehashed)
probe("uncertainty_topic_dedup_enforced", forgeUnknownVerify((f) => { f.semanticAtoms.push({ kind: "IC02_UNCERTAINTY_ATOM", topic: "breakfast", verifiedStepIndex: 0 }); }).rejectCode === "IC02_REJECT_CONFLICTING_EVIDENCE");
// 21 — P1-04 residual: a facility both KNOWN and flagged UNKNOWN on one step is a contradiction (rehashed)
probe("fact_uncertainty_contradiction_rejected", forgeFactDetailVerify((f) => { f.semanticAtoms.push({ kind: "IC02_UNCERTAINTY_ATOM", topic: "breakfast", verifiedStepIndex: 0 }); }).rejectCode === "IC02_REJECT_CONFLICTING_EVIDENCE");
// 22 — P1-04 residual: an "unknown" KNOWN fact value is not producible (exact per-answer value shape)
probe("fact_value_exact_shape_enforced", forgeFactDetailVerify((f) => { f.semanticAtoms.find((a) => a.kind === "IC02_FACT_ATOM").value = { breakfast: "unknown" }; }).rejectCode === "IC02_REJECT_ENVELOPE_MALFORMED");
// 23 — P1-04 residual: a hotel_facts step must represent BOTH facilities (completeness), else fail closed
probe("hotel_facts_facility_completeness_enforced", forgeFactDetailVerify((f) => { f.semanticAtoms = f.semanticAtoms.filter((a) => !(a.kind === "IC02_UNCERTAINTY_ATOM" && a.topic === "parking")); }).rejectCode === "IC02_REJECT_UNSUPPORTED_MAPPING");

console.log("\n── MUTATION / NON-VACUITY RESULTS ──");
probes.forEach((p) => console.log(`  ${p.ok ? "✓" : "✗"} ${p.name}`));

// ═════════════════════════════ summary ═════════════════════════════════════
console.log(`\n${fail === 0 ? "✅" : "❌"} IC02 compiler suite: ${pass} passed, ${fail} failed`);
if (fail !== 0) { console.error("\nFAILURES:\n" + failures.map((f) => "  - " + f).join("\n")); process.exit(1); }
process.exit(0);
