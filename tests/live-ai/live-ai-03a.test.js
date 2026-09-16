#!/usr/bin/env node
/* eslint-disable no-console */
// ─────────────────────────────────────────────────────────────────────────
// StayBid Live AI — LIVE-AI-03A — PROVIDER-NEUTRAL EXECUTION-SAFETY test suite.
// CONSOLIDATED-REMEDIATION-01 (P1-01 … P1-06).
//
//   Run:  node tests/live-ai/live-ai-03a.test.js
//
// Compiles the CLOSED 6-file server/voice-gateway dependency set with the local
// tsc and drives the REAL compiled production modules through the REAL IC01 loop.
// The two-stage R5B lifecycle is exercised THROUGH the production 03A API
// (admit → acceptAction → deliverTerminal). Deterministic fakes ONLY at the
// injected ports (monotonic clock, id minter, budget gate, current context,
// execution adapter). NO network, NO provider, NO DB.
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
  "live-ai-execution-safety.ts",
];
const BUILD = path.join(__dirname, ".build", "s03a");
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
if (compile.status !== 0) { console.error("COMPILE GATE FAILED (03a):\n" + (compile.stdout || "") + (compile.stderr || "")); process.exit(2); }
console.log("• Local tsc compile (03a, strict): exit 0, clean");

const SCH = require(path.join(OUT, "gw/live-ai-schemas.js"));
const AL = require(path.join(OUT, "gw/live-ai-agent-loop.js"));
const ES = require(path.join(OUT, "gw/live-ai-execution-safety.js"));

let pass = 0, fail = 0; const failures = [];
function ok(c, l) { if (c) pass += 1; else { fail += 1; failures.push(l); console.error("  ✗ " + l); } }
function eq(a, b, l) { ok(a === b, `${l} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`); }
function section(n) { console.log("\n• " + n); }
const probes = [];
function probe(name, condition) { probes.push({ name, ok: !!condition }); ok(!!condition, "PROBE " + name); }

// ── fixtures ────────────────────────────────────────────────────────────────
const H64 = "a".repeat(64);
const B = Object.freeze({ sessionId: "s1", turnId: "t1", generation: 1, pageId: "hotels", role: "customer", routeEpoch: 1, contextRevision: "rev-1", authorityRef: "auth-1", contextDigest: H64 });
const BD = Object.freeze(Object.assign({}, B, { pageId: "hotel-detail" }));
const RA = (b, o) => Object.assign({ turnId: b.turnId, generation: b.generation, routeEpoch: b.routeEpoch, contextRevision: b.contextRevision, authorityRef: b.authorityRef, contextDigest: b.contextDigest }, o || {});
const RA_ADV = Object.freeze({ turnId: "t1", generation: 1, routeEpoch: 2, contextRevision: "rev-adv", authorityRef: "auth-adv", contextDigest: "c".repeat(64) });
const EV = {
  results: () => ({ kind: "results", count: 2, orderedIds: ["hotel-a", "hotel-b"] }),
  comparison: () => ({ kind: "comparison", positions: [1, 2], hotelIds: ["hotel-a", "hotel-b"], factors: ["price"], cheapestPosition: 1, topRatedPosition: 2 }),
  detail: () => ({ kind: "detail", hotelId: "hotel-a", breakfast: "present", parking: "absent" }),
  ui_state: () => ({ kind: "ui_state", section: "rooms", hotelId: "hotel-a" }),
  navigation: () => ({ kind: "navigation", hotelId: "hotel-a", position: 1 }),
};

const fakeDeps = () => ({ modelAvailable: () => true, routeTier: () => "LEVEL_1", telemetry: () => {} });
const icTurn = () => ({ text: "show me hotels", language: "en", role: "customer" });
const icPlan = (steps) => ({ contractVersion: "staybid-intelligence.v1", intent: "READ_RESULTS", steps });
const capStep = (id, args) => ({ kind: "CAPABILITY", capabilityId: id, args });
const respondFact = (step, answer) => ({ kind: "RESPOND", language: "en", claims: [{ kind: "fact", answer, groundedInStep: step }] });
function dispatchFor(cap, opArgs, binding, answer) {
  const loop = AL.createAgentLoop(fakeDeps());
  const e1 = loop.beginTurn({ binding: Object.assign({}, binding || B), userTurn: icTurn(), nowMs: 0 });
  const plan = icPlan([capStep(cap, opArgs), respondFact(0, answer || "results_summary")]);
  const e2 = loop.submitModelPlan({ modelRequestId: e1.modelRequestId, plan, nowMs: 10 });
  return { loop, dispatch: e2 };
}

// ── context fixtures (COMPLETE current trusted binding) ──────────────────────
const hotelsCtx = (b) => ({ binding: b || B, ready: true, visiblePositions: [1, 2, 3, 4], currentHotelId: null, sections: [] });
const detailCtx = (b) => ({ binding: b || BD, ready: true, visiblePositions: [], currentHotelId: "hotel-a", sections: ["rooms", "about"] });

// ── deterministic port fakes ─────────────────────────────────────────────────
const ADMITTED = () => ({ decision: "ADMITTED", budgetAdmissionRef: "budget-1" });
function mkClock(start) { let t = start == null ? 20 : start; return { nowMonotonicMs: () => t++ }; }
function mkScriptClock(vals) { let i = 0; return { nowMonotonicMs: () => vals[Math.min(i++, vals.length - 1)] }; }
function mkAdapter(opts) { opts = opts || {}; const calls = { n: 0, last: null }; return { calls, dispatch(req) { calls.n += 1; calls.last = req; if (opts.dormant) return null; if (opts.mut) opts.mut(req); return { dispatched: true }; } }; }

function setup(cap, opArgs, o) {
  o = o || {};
  const binding = o.binding || B;
  const answer = o.answer || "results_summary";
  const { loop, dispatch } = dispatchFor(cap, opArgs, binding, answer);
  const budgetCalls = [];
  const adapter = o.adapter !== undefined ? o.adapter : mkAdapter();
  const es = ES.createExecutionSafety({
    clock: o.clock || mkClock(20),
    mintId: { mint: (k, s) => `${k}-${s}` },
    budgetGate: o.budget === null ? null : { admit: (i) => { budgetCalls.push(i); return (o.budget ? o.budget(i) : ADMITTED()); } },
    adapter,
    contexts: { current: () => (o.ctx === undefined ? hotelsCtx(binding) : o.ctx) },
    loop: o.loop || loop,
    audit: o.audit || { emit: () => {} },
  });
  return { loop, dispatch, es, budgetCalls, adapter };
}
function proposal(dispatch, over) {
  return Object.assign({ dispatch, proposalId: "pr-1", providerTurnId: "pt-1", receiptId: "rc-1", executionNonce: "nc-1", turnDeadlineMs: 30000 }, over || {});
}
function acceptedTuple(adm, o) {
  o = o || {};
  return { receiptId: adm.receiptId, proposalId: adm.proposalId, providerTurnId: adm.providerTurnId, actionId: o.actionId || "act-1", executionNonce: adm.executionNonce, operation: o.operationOverride || adm.capabilityId, authorityRef: o.authorityOverride || adm.source.authorityRef };
}
function terminalEvent(adm, evKind, ra, o) {
  o = o || {};
  const actionId = o.actionId || "act-1";
  const base = { receiptId: adm.receiptId, proposalId: adm.proposalId, providerTurnId: adm.providerTurnId, actionId, executionNonce: adm.executionNonce, operation: o.operationOverride || adm.capabilityId, authorityRef: o.authorityOverride || adm.source.authorityRef };
  const outcome = o.outcome || "verified";
  const status = o.status || (outcome === "verified" ? "verified" : (outcome === "acted" ? "execution_acknowledged" : "invalid_operation"));
  const receipt = Object.assign({}, base, { outcome, status });
  if (outcome === "verified") { receipt.resultAuthority = ra; receipt.evidence = EV[evKind](); }
  else if (o.withResultAuthority) receipt.resultAuthority = ra;
  const ackReceipt = o.preAccept ? Object.assign({}, receipt, { actionId: SCH.UNACCEPTED_ACTION_ID }) : receipt;
  const ackCommitment = o.badAck ? SCH.sha256Hex("forged") : SCH.terminalReceiptCommitment(ackReceipt);
  const terminal = { receipt, sourceAuthority: o.sourceAuthority || RA(B), resultAuthority: (outcome === "verified" || o.withResultAuthority) ? ra : null, ackCommitment };
  if (o.mut) o.mut(terminal, receipt);
  return terminal;
}
// spy loop wrapping the real loop (counts submitObservation etc.)
function spyLoop(real) {
  const c = { status: 0, ack: 0, submit: 0 };
  return { spy: c, status: () => { c.status++; return real.status(); }, acknowledgeDispatch: (i) => { c.ack++; return real.acknowledgeDispatch(i); }, submitObservation: (i) => { c.submit++; return real.submitObservation(i); } };
}
// happy full run through the two-stage API for a READ
function happyRead(o) {
  o = o || {};
  const s = setup("READ_CURRENT_RESULTS", { op: "READ_CURRENT_RESULTS" }, o);
  const a = s.es.admit(proposal(s.dispatch));
  if (!a.ok) return Object.assign({ stage: "admit", out: a }, s);
  const acc = s.es.acceptAction({ accepted: acceptedTuple(a.admission) });
  if (!acc.ok) return Object.assign({ stage: "accept", out: acc, admission: a.admission }, s);
  const term = s.es.deliverTerminal({ terminal: terminalEvent(a.admission, "results", RA(B)) });
  return Object.assign({ stage: "terminal", out: term, admission: a.admission }, s);
}
// P1-03 — admit → accept → deliver a post-accept PENDING (acted) event. The execution MUST stay alive
// (AWAITING_TERMINAL); a later TRUE terminal for the SAME execution is delivered by the caller.
function admitAcceptPending(o) {
  o = o || {};
  const s = setup("READ_CURRENT_RESULTS", { op: "READ_CURRENT_RESULTS" }, o);
  const a = s.es.admit(proposal(s.dispatch));
  s.es.acceptAction({ accepted: acceptedTuple(a.admission) });
  const pending = s.es.deliverTerminal({ terminal: terminalEvent(a.admission, "results", RA(B), { outcome: "acted", status: "execution_acknowledged", withResultAuthority: true }) });
  return Object.assign({ admission: a.admission, pending }, s);
}
// P1-05 — drive >EXECUTION_REPLAY_LEDGER_MAX UNIQUE legitimate current-pending dispatch lifecycles through
// ONE SAME execution-safety instance (a controllable fake IC01 loop at the injected port). Proves the SAME
// controller's replay ledger genuinely fills, caps, and evicts — and that eviction never revives stale authority.
function runReplayBound() {
  const MAX = ES.EXECUTION_REPLAY_LEDGER_MAX; // 64
  const N = MAX + 6;                          // 70 unique lifecycles through ONE controller
  let pendingId = null;
  const fakeLoop = {
    status: () => ({ phase: "AWAIT_OBSERVATION", planId: "PLN", currentStepIndex: 0, pendingDispatchId: pendingId }),
    acknowledgeDispatch: () => ({ kind: "INERT", why: "dispatch_acknowledged" }),
    submitObservation: () => ({ kind: "INERT", why: "pending_verification_acknowledged" }),
  };
  const budgetCalls = [];
  const adapter = mkAdapter();
  const es = ES.createExecutionSafety({
    clock: mkClock(1000), mintId: { mint: (k, x) => `${k}-${x}` },
    budgetGate: { admit: (i) => { budgetCalls.push(i); return ADMITTED(); } },
    adapter, contexts: { current: () => hotelsCtx() }, loop: fakeLoop, audit: { emit: () => {} },
  });
  const dispFor = (id) => ({ kind: "CAPABILITY_DISPATCH", dispatchId: id, planId: "PLN", stepIndex: 0, capabilityId: "READ_CURRENT_RESULTS", args: { op: "READ_CURRENT_RESULTS" }, binding: B, deadlineMs: 30000 });
  let maxObserved = 0, growthOk = true, everExceeded = false;
  for (let i = 1; i <= N; i++) {
    const id = "d-" + i; pendingId = id;
    const a = es.admit(proposal(dispFor(id)));
    if (!a.ok) { growthOk = false; break; }
    const sz = es.status().replayLedgerSize;
    if (sz > maxObserved) maxObserved = sz;
    if (sz > MAX) everExceeded = true;
    if (sz !== Math.min(i, MAX)) growthOk = false;
    es.interrupt("barge_in"); // release the slot without consuming the (fake) loop dispatch
  }
  const finalSize = es.status().replayLedgerSize;
  // an OLD entry (d-1) has been EVICTED: re-admitting it as the CURRENT pending SUCCEEDS (a non-evicted
  // entry would be EXECUTION_DISPATCH_REPLAY). This genuinely proves eviction on this same instance.
  pendingId = "d-1";
  const readmit = es.admit(proposal(dispFor("d-1")));
  es.interrupt("barge_in");
  // eviction does NOT revive stale authority: an evicted OLD dispatch (d-2) that is NOT the current pending
  // is refused with ZERO budget/adapter side effects even though it is no longer replay-blocked.
  pendingId = "d-current";
  const b0 = budgetCalls.length, x0 = adapter.calls.n;
  const stale = es.admit(proposal(dispFor("d-2")));
  const staleBudgetDelta = budgetCalls.length - b0, staleAdapterDelta = adapter.calls.n - x0;
  // a CURRENT valid pending dispatch is still admissible after eviction.
  pendingId = "d-fresh";
  const fresh = es.admit(proposal(dispFor("d-fresh")));
  return { MAX, N, maxObserved, everExceeded, growthOk, finalSize, readmitOk: !!readmit.ok, staleReason: stale.reason, staleBudgetDelta, staleAdapterDelta, freshOk: !!fresh.ok };
}

// ═══════════════════════════ P1-06 — capability metadata ════════════════════
section("03A-A — P1-06 exact capability execution metadata");
{
  const reads = ["READ_CURRENT_RESULTS", "COMPARE_VISIBLE_HOTELS", "READ_CURRENT_HOTEL_FACTS"];
  const uilocal = ["APPLY_HOTEL_REFINEMENT", "SHOW_HOTEL_SECTION", "OPEN_VISIBLE_HOTEL"];
  let readsOk = true, uiOk = true, retryZero = true;
  for (const c of reads) { const m = ES.getExecutionMetadata(c); if (!m || m.authorityClass !== "READ" || m.idempotencyPolicy !== "IDEMPOTENT_READ") readsOk = false; if (m && m.automaticRetryCeiling !== 0) retryZero = false; }
  for (const c of uilocal) { const m = ES.getExecutionMetadata(c); if (!m || m.authorityClass !== "UI_LOCAL" || m.idempotencyPolicy !== "SINGLE_ATTEMPT") uiOk = false; if (m && m.automaticRetryCeiling !== 0) retryZero = false; }
  ok(readsOk, "03A-A01 — the 3 READ capabilities are IDEMPOTENT_READ");
  ok(uiOk, "03A-A02 — the 3 UI_LOCAL capabilities are SINGLE_ATTEMPT");
  ok(retryZero, "03A-A03 — automatic retry ceiling is ZERO for every capability");
  const open = ES.getExecutionMetadata("OPEN_VISIBLE_HOTEL");
  ok(open.resultSchemas.indexOf("navigation") !== -1 && open.resultSchemas.indexOf("detail") !== -1, "03A-A04 — OPEN accepts BOTH navigation and detail result schemas");
  eq(ES.getExecutionMetadata("READ_CURRENT_RESULTS").resultSchemas.length, 1, "03A-A05 — a READ has a single result schema");
  eq(ES.getExecutionMetadata("NOPE"), null, "03A-A06 — unknown capability has no metadata (fail closed)");
  eq(ES.getExecutionMetadata("__proto__"), null, "03A-A07 — hostile key resolves to null");
  let allNone = true; for (const c of reads.concat(uilocal)) if (ES.getExecutionMetadata(c).confirmationClass !== "NONE") allNone = false;
  ok(allNone, "03A-A08 — confirmation NONE for all six");
}

// ═══════════════════════════ happy two-stage path ══════════════════════════
section("03A-B — the real two-stage lifecycle admits, accepts, and hands off (P1-03)");
{
  const events = [];
  const s = setup("READ_CURRENT_RESULTS", { op: "READ_CURRENT_RESULTS" }, { audit: { emit: (e) => events.push(e.event) } });
  const a = s.es.admit(proposal(s.dispatch));
  ok(a.ok && a.lifecycleState === "DISPATCHED", "03A-B01 — admit → DISPATCHED");
  eq(s.es.status().lifecycleState, "DISPATCHED", "03A-B02 — status reflects DISPATCHED");
  eq(s.adapter.calls.n, 1, "03A-B03 — the adapter was triggered exactly once at admit");
  const acc = s.es.acceptAction({ accepted: acceptedTuple(a.admission) });
  ok(acc.ok && acc.lifecycleState === "ACCEPTED", "03A-B04 — acceptAction → ACCEPTED (independent event)");
  const term = s.es.deliverTerminal({ terminal: terminalEvent(a.admission, "results", RA(B)) });
  ok(term.ok && term.lifecycleState === "IC01_HANDOFF", "03A-B05 — deliverTerminal → IC01_HANDOFF (independent event)");
  eq(term.loopEffectKind, "TERMINAL", "03A-B06 — IC01 completed the step");
  ok(term.verificationHandoff === true, "03A-B07 — reached IC01 result derivation");
  ok(events.indexOf("execution_admission_allowed") !== -1 && events.indexOf("execution_dispatched") !== -1 && events.indexOf("execution_acknowledged") !== -1 && events.indexOf("execution_verification_handoff") !== -1, "03A-B08 — ordered bounded audit trail");
  eq(s.loop.verifiedEvidence().length, 1, "03A-B09 — exactly one IC01 VERIFIED → IC02 provenance");
}

// ═══════════════════════════ P1-01 — commitment / budget / ids ══════════════
section("03A-C — P1-01 request commitment, execution ids, budget correlation");
{
  // budget receives the ACTUAL executionId + FINAL full-SHA-256 requestDigest
  {
    const s = setup("READ_CURRENT_RESULTS", { op: "READ_CURRENT_RESULTS" });
    const a = s.es.admit(proposal(s.dispatch));
    ok(a.ok, "03A-C01 — admit ok");
    eq(s.budgetCalls.length, 1, "03A-C02 — budget gate consulted once");
    const bi = s.budgetCalls[0];
    eq(bi.executionId, a.admission.executionId, "03A-C03 — budget received the ACTUAL executionId (never empty)");
    ok(bi.executionId && bi.executionId.length > 0, "03A-C04 — executionId is non-empty");
    eq(bi.requestDigest, a.admission.requestDigest, "03A-C05 — budget received the FINAL requestDigest");
    ok(/^[0-9a-f]{64}$/.test(a.admission.requestDigest), "03A-C06 — requestDigest is a full SHA-256 (64 hex)");
    ok(/^[0-9a-f]{64}$/.test(a.admission.normalizedArgsDigest), "03A-C07 — normalizedArgsDigest is a full SHA-256");
    eq(a.admission.budgetAdmissionRef, "budget-1", "03A-C08 — the returned budget grant is bound to the admission");
    eq(a.admission.attemptNumber, 1, "03A-C09 — attemptNumber is exactly 1");
  }
  // changing an authority field changes the commitment
  {
    const base = setup("READ_CURRENT_RESULTS", { op: "READ_CURRENT_RESULTS" });
    const a0 = base.es.admit(proposal(base.dispatch));
    const v1 = setup("READ_CURRENT_RESULTS", { op: "READ_CURRENT_RESULTS" });
    const a1 = v1.es.admit(proposal(v1.dispatch, { executionNonce: "nc-DIFF" }));
    const v2 = setup("READ_CURRENT_RESULTS", { op: "READ_CURRENT_RESULTS" });
    const a2 = v2.es.admit(proposal(v2.dispatch, { turnDeadlineMs: 25000 }));
    ok(a0.admission.requestDigest !== a1.admission.requestDigest, "03A-C10 — changing executionNonce changes the commitment");
    ok(a0.admission.requestDigest !== a2.admission.requestDigest, "03A-C11 — changing the deadline changes the commitment");
  }
  // extra key / accessor / symbol on proposal + dispatch fail closed
  {
    const s = setup("READ_CURRENT_RESULTS", { op: "READ_CURRENT_RESULTS" });
    eq(s.es.admit(Object.assign(proposal(s.dispatch), { evil: 1 })).reason, "EXECUTION_INVALID_REQUEST", "03A-C12 — an extra proposal key fails closed");
  }
  {
    const s = setup("READ_CURRENT_RESULTS", { op: "READ_CURRENT_RESULTS" });
    const badDispatch = Object.assign({}, s.dispatch); Object.defineProperty(badDispatch, "capabilityId", { get() { return "READ_CURRENT_RESULTS"; }, enumerable: true });
    eq(s.es.admit(proposal(badDispatch)).reason, "EXECUTION_INVALID_REQUEST", "03A-C13 — an accessor on the dispatch fails closed");
  }
  {
    const s = setup("READ_CURRENT_RESULTS", { op: "READ_CURRENT_RESULTS" });
    const p = proposal(s.dispatch); p[Symbol("x")] = 1;
    eq(s.es.admit(p).reason, "EXECUTION_INVALID_REQUEST", "03A-C14 — a symbol key on the proposal fails closed");
  }
  // mutation-after-validation cannot alter admitted authority
  {
    const s = setup("READ_CURRENT_RESULTS", { op: "READ_CURRENT_RESULTS" });
    const mutableBinding = Object.assign({}, B);
    const disp = Object.assign({}, s.dispatch, { binding: mutableBinding });
    const a = s.es.admit(proposal(disp));
    mutableBinding.authorityRef = "auth-evil";
    eq(a.admission.source.authorityRef, "auth-1", "03A-C15 — post-admit input mutation cannot alter admitted authority");
  }
  // refused budget ids cannot authorize a later execution (new executionId minted)
  {
    const s = setup("READ_CURRENT_RESULTS", { op: "READ_CURRENT_RESULTS" }, { budget: (() => { let n = 0; return () => (n++ === 0 ? { decision: "REFUSED" } : ADMITTED()); })() });
    const r1 = s.es.admit(proposal(s.dispatch));
    eq(r1.reason, "EXECUTION_BUDGET_REFUSED", "03A-C16 — first admit budget-refused");
    const r2 = s.es.admit(proposal(s.dispatch));
    ok(r2.ok && r2.admission.executionId !== "exec-1", "03A-C17 — a refused execution's id is never reused (fresh executionId)");
  }
  // budget refusal invokes the adapter zero times
  {
    const s = setup("READ_CURRENT_RESULTS", { op: "READ_CURRENT_RESULTS" }, { budget: () => ({ decision: "REFUSED" }) });
    s.es.admit(proposal(s.dispatch));
    eq(s.adapter.calls.n, 0, "03A-C18 — budget refusal triggered the adapter ZERO times");
  }
}

// ═══════════════════════════ P1-02 — complete trusted binding ═══════════════
section("03A-D — P1-02 complete current trusted binding compared field-by-field");
{
  const fields = ["sessionId", "turnId", "generation", "pageId", "role", "routeEpoch", "contextRevision", "authorityRef", "contextDigest"];
  for (const f of fields) {
    const s = setup("READ_CURRENT_RESULTS", { op: "READ_CURRENT_RESULTS" });
    // mutate ONE field of the CURRENT context binding away from the dispatch binding
    const badBinding = Object.assign({}, B);
    if (f === "generation" || f === "routeEpoch") badBinding[f] = B[f] + 5;
    else if (f === "pageId") badBinding[f] = "hotel-detail";
    else if (f === "role") badBinding[f] = "anonymous";
    else if (f === "contextDigest") badBinding[f] = "b".repeat(64);
    else badBinding[f] = B[f] + "-x";
    const es = ES.createExecutionSafety({
      clock: mkClock(20), mintId: { mint: (k, x) => `${k}-${x}` },
      budgetGate: { admit: () => { budgetHit = true; return ADMITTED(); } },
      adapter: s.adapter, contexts: { current: () => ({ binding: badBinding, ready: true, visiblePositions: [1, 2, 3, 4], currentHotelId: null, sections: [] }) },
      loop: s.loop, audit: { emit: () => {} },
    });
    var budgetHit = false;
    const r = es.admit(proposal(s.dispatch));
    ok(!r.ok && (r.reason === "EXECUTION_STALE_BINDING" || r.reason === "EXECUTION_STALE_ROUTE" || r.reason === "EXECUTION_WRONG_PAGE" || r.reason === "EXECUTION_UNAUTHORIZED"), `03A-D:${f} — a current-binding ${f} mismatch fails closed (got ${r.reason})`);
    ok(budgetHit === false, `03A-D:${f} — budget calls = 0 on a ${f} mismatch`);
    eq(s.adapter.calls.n, 0, `03A-D:${f} — adapter calls = 0 on a ${f} mismatch`);
  }
  // same routeEpoch + same contextRevision but a CHANGED contextDigest ⇒ rejection
  {
    const s = setup("READ_CURRENT_RESULTS", { op: "READ_CURRENT_RESULTS" });
    const badBinding = Object.assign({}, B, { contextDigest: "d".repeat(64) }); // same route/revision, changed digest
    const es = ES.createExecutionSafety({
      clock: mkClock(20), mintId: { mint: (k, x) => `${k}-${x}` }, budgetGate: { admit: ADMITTED },
      adapter: s.adapter, contexts: { current: () => ({ binding: badBinding, ready: true, visiblePositions: [1, 2, 3, 4], currentHotelId: null, sections: [] }) },
      loop: s.loop, audit: { emit: () => {} },
    });
    eq(es.admit(proposal(s.dispatch)).reason, "EXECUTION_STALE_BINDING", "03A-D10 — same route/revision but a changed contextDigest is rejected");
  }
}

// ═══════════════════════════ P1-05 — pending dispatch / monotonic / replay ══
section("03A-E — P1-05 current-pending-dispatch proof, one monotonic clock, bounded replay");
{
  // a stale/foreign dispatch (not the loop's current pending) never runs budget/adapter
  {
    const s = setup("READ_CURRENT_RESULTS", { op: "READ_CURRENT_RESULTS" });
    const foreign = Object.assign({}, s.dispatch, { dispatchId: "not-pending" });
    const r = s.es.admit(proposal(foreign));
    eq(r.reason, "EXECUTION_NO_PENDING_DISPATCH", "03A-E01 — a foreign dispatchId is not the current pending dispatch");
    eq(s.budgetCalls.length, 0, "03A-E02 — budget calls = 0 for a stale dispatch");
    eq(s.adapter.calls.n, 0, "03A-E03 — adapter calls = 0 for a stale dispatch");
  }
  { const s = setup("READ_CURRENT_RESULTS", { op: "READ_CURRENT_RESULTS" }); eq(s.es.admit(proposal(Object.assign({}, s.dispatch, { planId: "other-plan" }))).reason, "EXECUTION_NO_PENDING_DISPATCH", "03A-E04 — wrong plan rejects"); }
  { const s = setup("READ_CURRENT_RESULTS", { op: "READ_CURRENT_RESULTS" }); eq(s.es.admit(proposal(Object.assign({}, s.dispatch, { stepIndex: 1 }))).reason, "EXECUTION_NO_PENDING_DISPATCH", "03A-E05 — wrong step rejects"); }
  // a fresh loop with no pending dispatch rejects
  {
    const loop = AL.createAgentLoop(fakeDeps());
    const { dispatch } = dispatchFor("READ_CURRENT_RESULTS", { op: "READ_CURRENT_RESULTS" });
    const es = ES.createExecutionSafety({ clock: mkClock(20), mintId: { mint: (k, s) => `${k}-${s}` }, budgetGate: { admit: ADMITTED }, adapter: mkAdapter(), contexts: { current: () => hotelsCtx() }, loop, audit: { emit: () => {} } });
    eq(es.admit(proposal(dispatch)).reason, "EXECUTION_NO_PENDING_DISPATCH", "03A-E06 — no pending IC01 dispatch rejects");
  }
  // exact duplicate dispatch never re-admits (replay)
  {
    const h = happyRead();
    ok(h.out.ok, "03A-E07 — first full run ok");
    const r = h.es.admit(proposal(h.dispatch));
    eq(r.reason, "EXECUTION_DISPATCH_REPLAY", "03A-E08 — exact duplicate dispatch → replay");
  }
  // backward clock before acceptance rejects
  {
    const s = setup("READ_CURRENT_RESULTS", { op: "READ_CURRENT_RESULTS" }, { clock: mkScriptClock([20, 5]) });
    const a = s.es.admit(proposal(s.dispatch));
    ok(a.ok, "03A-E09 — admit ok (sample 20)");
    eq(s.es.acceptAction({ accepted: acceptedTuple(a.admission) }).reason, "EXECUTION_NON_MONOTONIC_TIME", "03A-E10 — a backward clock before acceptance fails closed");
  }
  // backward clock before terminal rejects
  {
    const s = setup("READ_CURRENT_RESULTS", { op: "READ_CURRENT_RESULTS" }, { clock: mkScriptClock([20, 21, 5]) });
    const a = s.es.admit(proposal(s.dispatch));
    s.es.acceptAction({ accepted: acceptedTuple(a.admission) });
    eq(s.es.deliverTerminal({ terminal: terminalEvent(a.admission, "results", RA(B)) }).reason, "EXECUTION_NON_MONOTONIC_TIME", "03A-E11 — a backward clock before terminal fails closed");
  }
  // backward clock before a fresh admission rejects (controller already advanced)
  {
    const s = setup("READ_CURRENT_RESULTS", { op: "READ_CURRENT_RESULTS" }, { clock: mkScriptClock([20, 5]), budget: () => ({ decision: "REFUSED" }) });
    s.es.admit(proposal(s.dispatch)); // sampled 20 (budget refused, no reservation)
    eq(s.es.admit(proposal(s.dispatch)).reason, "EXECUTION_NON_MONOTONIC_TIME", "03A-E12 — a backward clock before a later admission fails closed");
  }
  // replay ledger stays bounded
  {
    const s = setup("READ_CURRENT_RESULTS", { op: "READ_CURRENT_RESULTS" });
    happyRead(); // one consumed
    ok(s.es.status().replayLedgerSize <= ES.EXECUTION_REPLAY_LEDGER_MAX, "03A-E13 — replay ledger never exceeds the bound");
  }
}

// ═══════════════════════════ P1-03 — lifecycle ordering / acceptance ════════
section("03A-F — P1-03 independent acceptance + terminal ordering through 03A");
{
  // exact duplicate acceptance is inert (no second grant)
  {
    const s = setup("READ_CURRENT_RESULTS", { op: "READ_CURRENT_RESULTS" });
    const a = s.es.admit(proposal(s.dispatch));
    ok(s.es.acceptAction({ accepted: acceptedTuple(a.admission) }).ok, "03A-F01 — first acceptance ok");
    const dup = s.es.acceptAction({ accepted: acceptedTuple(a.admission) });
    ok(dup.ok && dup.loopEffectKind === "INERT", "03A-F02 — exact duplicate acceptance is inert");
  }
  // a second DIFFERENT acceptance fails closed
  {
    const s = setup("READ_CURRENT_RESULTS", { op: "READ_CURRENT_RESULTS" });
    const a = s.es.admit(proposal(s.dispatch));
    s.es.acceptAction({ accepted: acceptedTuple(a.admission) });
    eq(s.es.acceptAction({ accepted: acceptedTuple(a.admission, { actionId: "act-2" }) }).reason, "EXECUTION_LIFECYCLE_INVALID", "03A-F03 — a second different acceptance fails closed");
  }
  // an accepted tuple with a foreign operation/authority fails closed (adapter cannot escalate via 03B input)
  {
    const s = setup("READ_CURRENT_RESULTS", { op: "READ_CURRENT_RESULTS" });
    const a = s.es.admit(proposal(s.dispatch));
    eq(s.es.acceptAction({ accepted: acceptedTuple(a.admission, { operationOverride: "OPEN_VISIBLE_HOTEL" }) }).reason, "EXECUTION_CAPABILITY_FAILURE", "03A-F04 — a foreign operation in the accepted tuple fails closed");
    const s2 = setup("READ_CURRENT_RESULTS", { op: "READ_CURRENT_RESULTS" });
    const a2 = s2.es.admit(proposal(s2.dispatch));
    eq(s2.es.acceptAction({ accepted: acceptedTuple(a2.admission, { authorityOverride: "auth-evil" }) }).reason, "EXECUTION_CAPABILITY_FAILURE", "03A-F05 — a foreign authority in the accepted tuple fails closed");
  }
  // terminal BEFORE acceptance: a valid negative terminal is handed off; verified/acted before accept fail
  {
    const s = setup("READ_CURRENT_RESULTS", { op: "READ_CURRENT_RESULTS" });
    const a = s.es.admit(proposal(s.dispatch));
    const t = s.es.deliverTerminal({ terminal: terminalEvent(a.admission, "results", RA(B), { preAccept: true, outcome: "rejected", status: "invalid_operation" }) });
    ok(t.ok && t.lifecycleState === "PRE_ACCEPT_TERMINAL", "03A-F06 — a pre-accept negative terminal is handed off");
  }
  { const s = setup("READ_CURRENT_RESULTS", { op: "READ_CURRENT_RESULTS" }); const a = s.es.admit(proposal(s.dispatch)); eq(s.es.deliverTerminal({ terminal: terminalEvent(a.admission, "results", RA(B), { preAccept: true, outcome: "verified", status: "verified" }) }).reason, "EXECUTION_VERIFICATION_REQUIRED", "03A-F07 — VERIFIED before acceptance fails closed"); }
  { const s = setup("READ_CURRENT_RESULTS", { op: "READ_CURRENT_RESULTS" }); const a = s.es.admit(proposal(s.dispatch)); eq(s.es.deliverTerminal({ terminal: terminalEvent(a.admission, "results", RA(B), { preAccept: true, outcome: "acted", status: "execution_acknowledged", withResultAuthority: true }) }).reason, "EXECUTION_LIFECYCLE_INVALID", "03A-F08 — acted (pending) before acceptance is not a terminal"); }
  // acted AFTER acceptance is a PENDING (non-terminal) event (P1-03): the execution stays ALIVE
  // (AWAITING_TERMINAL), the slot is NOT cleared, and NO terminal-completion is emitted.
  {
    const events = [];
    const s = setup("READ_CURRENT_RESULTS", { op: "READ_CURRENT_RESULTS" }, { audit: { emit: (e) => events.push(e.event) } });
    const a = s.es.admit(proposal(s.dispatch));
    s.es.acceptAction({ accepted: acceptedTuple(a.admission) });
    const t = s.es.deliverTerminal({ terminal: terminalEvent(a.admission, "results", RA(B), { outcome: "acted", status: "execution_acknowledged", withResultAuthority: true }) });
    ok(t.ok && t.lifecycleState === "AWAITING_TERMINAL", "03A-F09 — a post-accept acted event is PENDING (AWAITING_TERMINAL, not terminalized)");
    ok(t.verificationHandoff === false, "03A-F09b — a pending event is NOT a verification handoff");
    eq(s.es.status().lifecycleState, "AWAITING_TERMINAL", "03A-F09c — the execution stays alive (active slot not cleared)");
    eq(s.loop.verifiedEvidence().length, 0, "03A-F10 — an acted (pending) event creates NO IC02 provenance");
    ok(events.indexOf("execution_verification_handoff") === -1, "03A-F10b — NO terminal-completion audit for a pending event");
  }
  // terminal after interrupt / after expiry
  {
    const s = setup("READ_CURRENT_RESULTS", { op: "READ_CURRENT_RESULTS" });
    const a = s.es.admit(proposal(s.dispatch));
    s.es.interrupt("barge_in");
    eq(s.es.deliverTerminal({ terminal: terminalEvent(a.admission, "results", RA(B)) }).reason, "EXECUTION_INTERRUPTED", "03A-F11 — a terminal after interrupt is a revoked late result");
  }
  {
    const s = setup("READ_CURRENT_RESULTS", { op: "READ_CURRENT_RESULTS" }, { clock: mkScriptClock([20, 30001]) });
    const a = s.es.admit(proposal(s.dispatch));
    ok(s.es.expire().ok, "03A-F12 — expire() revokes at/after the deadline");
    eq(s.es.deliverTerminal({ terminal: terminalEvent(a.admission, "results", RA(B)) }).reason, "EXECUTION_DEADLINE_EXCEEDED", "03A-F13 — a terminal after expiry is a revoked late result");
  }
}

// ═══════════════════════════ P1-04 — authority before IC01 handoff ══════════
section("03A-G — P1-04 source/result authority validated before submitObservation");
{
  const srcFields = ["turnId", "generation", "routeEpoch", "contextRevision", "authorityRef", "contextDigest"];
  for (const f of srcFields) {
    const real = dispatchFor("READ_CURRENT_RESULTS", { op: "READ_CURRENT_RESULTS" });
    const sp = spyLoop(real.loop);
    const es = ES.createExecutionSafety({ clock: mkClock(20), mintId: { mint: (k, s) => `${k}-${s}` }, budgetGate: { admit: ADMITTED }, adapter: mkAdapter(), contexts: { current: () => hotelsCtx() }, loop: sp, audit: { emit: () => {} } });
    const a = es.admit(proposal(real.dispatch));
    es.acceptAction({ accepted: acceptedTuple(a.admission) });
    const badSource = RA(B); if (f === "generation" || f === "routeEpoch") badSource[f] = B[f] + 3; else if (f === "contextDigest") badSource[f] = "e".repeat(64); else badSource[f] = B[f] + "-x";
    const r = es.deliverTerminal({ terminal: terminalEvent(a.admission, "results", RA(B), { sourceAuthority: badSource }) });
    ok(!r.ok, `03A-G:${f} — a terminal sourceAuthority ${f} mismatch is refused`);
    eq(sp.spy.submit, 0, `03A-G:${f} — submitObservation NOT called on a sourceAuthority ${f} mismatch`);
  }
  // top-level vs receipt-committed resultAuthority mismatch => submitObservation 0
  {
    const real = dispatchFor("READ_CURRENT_RESULTS", { op: "READ_CURRENT_RESULTS" });
    const sp = spyLoop(real.loop);
    const es = ES.createExecutionSafety({ clock: mkClock(20), mintId: { mint: (k, s) => `${k}-${s}` }, budgetGate: { admit: ADMITTED }, adapter: mkAdapter(), contexts: { current: () => hotelsCtx() }, loop: sp, audit: { emit: () => {} } });
    const a = es.admit(proposal(real.dispatch));
    es.acceptAction({ accepted: acceptedTuple(a.admission) });
    // receipt carries RA(B); top-level carries a DIFFERENT authority
    const r = es.deliverTerminal({ terminal: terminalEvent(a.admission, "results", RA(B), { mut: (t) => { t.resultAuthority = RA_ADV; } }) });
    ok(!r.ok, "03A-G07 — top-level vs receipt resultAuthority mismatch refused");
    eq(sp.spy.submit, 0, "03A-G08 — submitObservation NOT called on a resultAuthority mismatch");
  }
  // presence mismatch (top-level null, receipt present)
  {
    const real = dispatchFor("READ_CURRENT_RESULTS", { op: "READ_CURRENT_RESULTS" });
    const sp = spyLoop(real.loop);
    const es = ES.createExecutionSafety({ clock: mkClock(20), mintId: { mint: (k, s) => `${k}-${s}` }, budgetGate: { admit: ADMITTED }, adapter: mkAdapter(), contexts: { current: () => hotelsCtx() }, loop: sp, audit: { emit: () => {} } });
    const a = es.admit(proposal(real.dispatch));
    es.acceptAction({ accepted: acceptedTuple(a.admission) });
    const r = es.deliverTerminal({ terminal: terminalEvent(a.admission, "results", RA(B), { mut: (t) => { t.resultAuthority = null; } }) });
    ok(!r.ok, "03A-G09 — a null/presence resultAuthority mismatch refused");
    eq(sp.spy.submit, 0, "03A-G10 — submitObservation NOT called on a presence mismatch");
  }
  // fully correlated => exactly one submitObservation
  {
    const real = dispatchFor("READ_CURRENT_RESULTS", { op: "READ_CURRENT_RESULTS" });
    const sp = spyLoop(real.loop);
    const es = ES.createExecutionSafety({ clock: mkClock(20), mintId: { mint: (k, s) => `${k}-${s}` }, budgetGate: { admit: ADMITTED }, adapter: mkAdapter(), contexts: { current: () => hotelsCtx() }, loop: sp, audit: { emit: () => {} } });
    const a = es.admit(proposal(real.dispatch));
    es.acceptAction({ accepted: acceptedTuple(a.admission) });
    const r = es.deliverTerminal({ terminal: terminalEvent(a.admission, "results", RA(B)) });
    ok(r.ok, "03A-G11 — a fully correlated terminal is handed off");
    eq(sp.spy.submit, 1, "03A-G12 — exactly one submitObservation on a correlated terminal");
  }
  // a foreign IC01 result is NOT reported as a successful handoff
  {
    const DID = "d-fk", PL = "p-fk";
    const fakeLoop = { status: () => ({ phase: "AWAIT_OBSERVATION", planId: PL, currentStepIndex: 0, pendingDispatchId: DID }), acknowledgeDispatch: () => ({ kind: "INERT", why: "dispatch_acknowledged" }), submitObservation: () => ({ kind: "INERT", why: "foreign_dispatch" }) };
    const disp = { kind: "CAPABILITY_DISPATCH", dispatchId: DID, planId: PL, stepIndex: 0, capabilityId: "READ_CURRENT_RESULTS", args: { op: "READ_CURRENT_RESULTS" }, binding: B, deadlineMs: 30000 };
    const es = ES.createExecutionSafety({ clock: mkClock(20), mintId: { mint: (k, s) => `${k}-${s}` }, budgetGate: { admit: ADMITTED }, adapter: mkAdapter(), contexts: { current: () => hotelsCtx() }, loop: fakeLoop, audit: { emit: () => {} } });
    const a = es.admit(proposal(disp));
    es.acceptAction({ accepted: acceptedTuple(a.admission) });
    const r = es.deliverTerminal({ terminal: terminalEvent(a.admission, "results", RA(B)) });
    ok(!r.ok && r.reason === "EXECUTION_RESULT_MALFORMED", "03A-G13 — a foreign IC01 result is NOT a successful verification handoff");
  }
  // malformed terminal / result-schema mismatch / gateway-ACK
  { const h = happyRead(); ok(h.out.ok, "03A-G14 — happy handoff baseline ok"); }
  {
    const s = setup("READ_CURRENT_RESULTS", { op: "READ_CURRENT_RESULTS" });
    const a = s.es.admit(proposal(s.dispatch)); s.es.acceptAction({ accepted: acceptedTuple(a.admission) });
    eq(s.es.deliverTerminal({ terminal: terminalEvent(a.admission, "detail", RA(B)) }).reason, "EXECUTION_RESULT_MALFORMED", "03A-G15 — a result-schema (evidence-kind) mismatch is refused");
  }
  {
    const s = setup("READ_CURRENT_RESULTS", { op: "READ_CURRENT_RESULTS" });
    const a = s.es.admit(proposal(s.dispatch)); s.es.acceptAction({ accepted: acceptedTuple(a.admission) });
    eq(s.es.deliverTerminal({ terminal: terminalEvent(a.admission, "results", RA(B), { badAck: true }) }).reason, "EXECUTION_RESULT_MALFORMED", "03A-G16 — an incorrect gateway ACK is refused");
  }
  {
    const s = setup("READ_CURRENT_RESULTS", { op: "READ_CURRENT_RESULTS" });
    const a = s.es.admit(proposal(s.dispatch)); s.es.acceptAction({ accepted: acceptedTuple(a.admission) });
    eq(s.es.deliverTerminal({ terminal: terminalEvent(a.admission, "results", RA(B), { mut: (t) => { delete t.ackCommitment; } }) }).reason, "EXECUTION_RESULT_MALFORMED", "03A-G17 — an absent gateway ACK is refused");
  }
}

// ═══════════════════════════ context-changing rebind + preserved invariants ═
section("03A-H — advancing rebind path + preserved accepted invariants");
{
  // OPEN advances the route → IC01 REBIND_REQUIRED after the verified handoff
  {
    const s = setup("OPEN_VISIBLE_HOTEL", { op: "OPEN_VISIBLE_HOTEL", position: 1 }, { answer: "hotel_opened" });
    const a = s.es.admit(proposal(s.dispatch));
    s.es.acceptAction({ accepted: acceptedTuple(a.admission) });
    const t = s.es.deliverTerminal({ terminal: terminalEvent(a.admission, "navigation", RA_ADV) });
    ok(t.ok && t.loopEffectKind === "REBIND_REQUIRED", "03A-H01 — an advancing OPEN drives the IC01 rebind path");
  }
  // detail capability happy path (COMPLETE binding on the detail page)
  {
    const s = setup("READ_CURRENT_HOTEL_FACTS", { op: "READ_CURRENT_HOTEL_FACTS" }, { binding: BD, answer: "hotel_facts", ctx: detailCtx() });
    const a = s.es.admit(proposal(s.dispatch));
    ok(a.ok, "03A-H02 — a detail-page capability admits under its complete detail binding");
    s.es.acceptAction({ accepted: acceptedTuple(a.admission) });
    ok(s.es.deliverTerminal({ terminal: terminalEvent(a.admission, "detail", RA(BD)) }).ok, "03A-H03 — detail READ hands off");
  }
  // concurrency 1: a second admit while ADMITTED/ACCEPTED fails BUSY
  {
    const s = setup("READ_CURRENT_RESULTS", { op: "READ_CURRENT_RESULTS" });
    s.es.admit(proposal(s.dispatch)); // slot now DISPATCHED
    const s2 = dispatchFor("READ_CURRENT_RESULTS", { op: "READ_CURRENT_RESULTS" });
    // feed a DIFFERENT dispatch id while busy — but 03A is bound to the first loop; use the same es with a distinct dispatch
    const busy = s.es.admit(proposal(Object.assign({}, s.dispatch, { dispatchId: "d-busy" })));
    ok(!busy.ok, "03A-H04 — a second concurrent admission is refused (either BUSY or not-pending)");
  }
  // dormant default adapter → zero execution
  {
    const s = setup("READ_CURRENT_RESULTS", { op: "READ_CURRENT_RESULTS" }, { adapter: mkAdapter({ dormant: true }) });
    eq(s.es.admit(proposal(s.dispatch)).reason, "EXECUTION_TRANSPORT_FAILURE", "03A-H05 — a dormant adapter yields zero execution");
    eq(s.loop.status().phase, "AWAIT_OBSERVATION", "03A-H06 — a dormant adapter never hands anything to IC01");
  }
  // absent budget port → fail closed, adapter zero
  {
    const s = setup("READ_CURRENT_RESULTS", { op: "READ_CURRENT_RESULTS" }, { budget: null });
    eq(s.es.admit(proposal(s.dispatch)).reason, "EXECUTION_BUDGET_REFUSED", "03A-H07 — an absent budget port fails closed");
    eq(s.adapter.calls.n, 0, "03A-H08 — absent budget invoked the adapter zero times");
  }
  // unknown capability / invalid args / wrong role / wrong page
  { const s = setup("READ_CURRENT_RESULTS", { op: "READ_CURRENT_RESULTS" }); eq(s.es.admit(proposal(Object.assign({}, s.dispatch, { capabilityId: "TAKE_MONEY" }))).reason, "EXECUTION_UNKNOWN_CAPABILITY", "03A-H09 — unknown capability rejects"); }
  { const s = setup("OPEN_VISIBLE_HOTEL", { op: "OPEN_VISIBLE_HOTEL", position: 1 }, { answer: "hotel_opened" }); eq(s.es.admit(proposal(Object.assign({}, s.dispatch, { args: { op: "OPEN_VISIBLE_HOTEL", position: 999 } }))).reason, "EXECUTION_INVALID_ARGS", "03A-H10 — non-canonical args reject"); }
  // adapter receives a deeply-frozen immutable admission (cannot mutate args)
  {
    let frozenAdm = false, frozenArgs = false;
    const adapter = { calls: { n: 0 }, dispatch(req) { this.calls.n++; frozenAdm = Object.isFrozen(req.admission); frozenArgs = Object.isFrozen(req.admission.normalizedArgs); try { req.admission.normalizedArgs.op = "X"; } catch (_) {} return { dispatched: true }; } };
    const s = setup("READ_CURRENT_RESULTS", { op: "READ_CURRENT_RESULTS" }, { adapter });
    s.es.admit(proposal(s.dispatch));
    ok(frozenAdm && frozenArgs, "03A-H11 — the adapter receives a deeply-frozen immutable admission + args");
  }
}

// ═══════════════════════════ P1-03 RESIDUAL — pending → later terminal ══════
section("03A-L — P1-03 residual: post-accept PENDING keeps the execution alive; a later TRUE terminal completes it");
{
  // [A/B/C/D] admit → accept → post-accept acted(PENDING) → stays awaiting terminal, nothing terminalized
  {
    const s = admitAcceptPending();
    ok(s.pending.ok && s.pending.lifecycleState === "AWAITING_TERMINAL", "03A-L01 — [C/D] a post-accept acted event → AWAITING_TERMINAL (NOT terminalized)");
    eq(s.es.status().lifecycleState, "AWAITING_TERMINAL", "03A-L02 — [D] the active execution is NOT cleared by the pending event");
    eq(s.es.status().dispatchId, s.admission.dispatchId, "03A-L03 — [D] the SAME execution identity is retained");
    eq(s.loop.verifiedEvidence().length, 0, "03A-L04 — [D] no IC02 provenance from the pending event");
    // [E] a later correctly-correlated VERIFIED terminal for the SAME execution completes it
    const term = s.es.deliverTerminal({ terminal: terminalEvent(s.admission, "results", RA(B)) });
    ok(term.ok && term.lifecycleState === "IC01_HANDOFF", "03A-L05 — [E] a later VERIFIED terminal completes the SAME execution");
    eq(term.loopEffectKind, "TERMINAL", "03A-L06 — [E] IC01 consumed the VERIFIED result exactly once");
    ok(term.verificationHandoff === true, "03A-L07 — [E] verification handoff reached on the true terminal");
    eq(s.loop.verifiedEvidence().length, 1, "03A-L08 — [E] IC02 provenance appears ONLY through IC01 VERIFIED");
    eq(s.es.status().lifecycleState, "IDLE", "03A-L09 — [E] the execution slot clears after the true terminal");
  }
  // [F] pending → later valid NON-SUCCESS terminal → correct completion, no provenance
  {
    const s = admitAcceptPending();
    const term = s.es.deliverTerminal({ terminal: terminalEvent(s.admission, "results", RA(B), { outcome: "rejected", status: "invalid_operation" }) });
    ok(term.ok && term.lifecycleState === "IC01_HANDOFF", "03A-L10 — [F] a later non-success terminal completes the execution");
    eq(s.loop.verifiedEvidence().length, 0, "03A-L11 — [F] a non-success terminal creates NO IC02 provenance");
    eq(s.es.status().lifecycleState, "IDLE", "03A-L12 — [F] the slot clears after the non-success terminal");
  }
  // [G] pending → interrupt → a later terminal cannot regain authority
  {
    const s = admitAcceptPending();
    ok(s.es.interrupt("barge_in").ok, "03A-L13 — [G] interrupt revokes the awaiting-terminal execution");
    const late = s.es.deliverTerminal({ terminal: terminalEvent(s.admission, "results", RA(B)) });
    eq(late.reason, "EXECUTION_INTERRUPTED", "03A-L14 — [G] a later terminal after interrupt cannot regain authority");
    eq(s.loop.verifiedEvidence().length, 0, "03A-L15 — [G] no IC02 provenance from a revoked late result");
  }
  // [H] pending → expiry → a later terminal cannot regain authority
  {
    const s = admitAcceptPending({ clock: mkScriptClock([20, 21, 22, 30001]) });
    ok(s.pending.ok && s.pending.lifecycleState === "AWAITING_TERMINAL", "03A-L16 — [H] pending recorded before expiry");
    ok(s.es.expire().ok, "03A-L17 — [H] expiry revokes the awaiting-terminal execution");
    const late = s.es.deliverTerminal({ terminal: terminalEvent(s.admission, "results", RA(B)) });
    eq(late.reason, "EXECUTION_DEADLINE_EXCEEDED", "03A-L18 — [H] a later terminal after expiry cannot regain authority");
    eq(s.loop.verifiedEvidence().length, 0, "03A-L19 — [H] no IC02 provenance from an expired late result");
  }
  // [I] while awaiting terminal, a second capability admission remains refused (concurrency = 1)
  {
    const s = admitAcceptPending();
    const busy = s.es.admit(proposal(Object.assign({}, s.dispatch, { dispatchId: "d-busy" })));
    ok(!busy.ok, "03A-L20 — [I] a second admission while awaiting terminal is refused (concurrency 1)");
    eq(s.es.status().lifecycleState, "AWAITING_TERMINAL", "03A-L21 — [I] the refused second admission never disturbs the live execution");
  }
  // [J] an exact duplicate pending receipt stays safe/inert and never clears the active execution
  {
    const s = admitAcceptPending();
    const dup = s.es.deliverTerminal({ terminal: terminalEvent(s.admission, "results", RA(B), { outcome: "acted", status: "execution_acknowledged", withResultAuthority: true }) });
    ok(dup.ok && dup.lifecycleState === "AWAITING_TERMINAL", "03A-L22 — [J] a duplicate pending receipt stays inert/safe (AWAITING_TERMINAL)");
    eq(s.es.status().lifecycleState, "AWAITING_TERMINAL", "03A-L23 — [J] a duplicate pending never clears the active execution");
    eq(s.loop.verifiedEvidence().length, 0, "03A-L24 — [J] a duplicate pending creates NO provenance");
    const term = s.es.deliverTerminal({ terminal: terminalEvent(s.admission, "results", RA(B)) });
    ok(term.ok && term.lifecycleState === "IC01_HANDOFF", "03A-L25 — [J] a true terminal still completes after duplicate pendings");
    eq(s.loop.verifiedEvidence().length, 1, "03A-L26 — [J] the true terminal yields exactly one provenance");
  }
}

// ═══════════════════════════ P1-05 RESIDUAL — same-instance replay bound ════
section("03A-M — P1-05 residual: NON-VACUOUS same-instance replay-ledger fill / cap / eviction");
{
  const r = runReplayBound();
  ok(r.growthOk, "03A-M01 — the ledger grows on THIS controller and caps at the bound (never stays zero)");
  eq(r.finalSize, r.MAX, "03A-M02 — replayLedgerSize == EXECUTION_REPLAY_LEDGER_MAX after > MAX unique entries");
  eq(r.maxObserved, r.MAX, "03A-M03 — the ledger GENUINELY reached its cap (max observed == MAX, not zero)");
  ok(r.everExceeded === false, "03A-M04 — replayLedgerSize NEVER exceeds the bound");
  ok(r.readmitOk, "03A-M05 — an evicted OLD dispatch is admittable again as the current pending (proves eviction)");
  eq(r.staleReason, "EXECUTION_NO_PENDING_DISPATCH", "03A-M06 — an evicted, non-current dispatch is refused (stale authority NOT revived)");
  eq(r.staleBudgetDelta, 0, "03A-M07 — budget calls = 0 for the evicted stale dispatch (current-pending proof authoritative after eviction)");
  eq(r.staleAdapterDelta, 0, "03A-M08 — adapter calls = 0 for the evicted stale dispatch");
  ok(r.freshOk, "03A-M09 — a fresh current-pending dispatch still admits after eviction");
}

// ═══════════════════════════ named closure probes ══════════════════════════
section("03A-K — named closure probes (P1-01 … P1-06)");
{
  probe("P1-01_full_sha256_request_commitment", (() => { const s = setup("READ_CURRENT_RESULTS", { op: "READ_CURRENT_RESULTS" }); const a = s.es.admit(proposal(s.dispatch)); return /^[0-9a-f]{64}$/.test(a.admission.requestDigest) && s.budgetCalls[0].executionId === a.admission.executionId && s.budgetCalls[0].requestDigest === a.admission.requestDigest; })());
  probe("P1-02_complete_binding_digest_enforced", (() => { const s = setup("READ_CURRENT_RESULTS", { op: "READ_CURRENT_RESULTS" }); const bad = Object.assign({}, B, { contextDigest: "f".repeat(64) }); const es = ES.createExecutionSafety({ clock: mkClock(20), mintId: { mint: (k, x) => `${k}-${x}` }, budgetGate: { admit: ADMITTED }, adapter: mkAdapter(), contexts: { current: () => ({ binding: bad, ready: true, visiblePositions: [1, 2], currentHotelId: null, sections: [] }) }, loop: s.loop, audit: { emit: () => {} } }); return es.admit(proposal(s.dispatch)).reason === "EXECUTION_STALE_BINDING"; })());
  probe("P1-03_two_stage_lifecycle", (() => { const h = happyRead(); return h.out.ok && h.out.lifecycleState === "IC01_HANDOFF"; })());
  probe("P1-04_authority_before_handoff", (() => { const real = dispatchFor("READ_CURRENT_RESULTS", { op: "READ_CURRENT_RESULTS" }); const sp = spyLoop(real.loop); const es = ES.createExecutionSafety({ clock: mkClock(20), mintId: { mint: (k, s) => `${k}-${s}` }, budgetGate: { admit: ADMITTED }, adapter: mkAdapter(), contexts: { current: () => hotelsCtx() }, loop: sp, audit: { emit: () => {} } }); const a = es.admit(proposal(real.dispatch)); es.acceptAction({ accepted: acceptedTuple(a.admission) }); es.deliverTerminal({ terminal: terminalEvent(a.admission, "results", RA(B), { sourceAuthority: RA(B, { authorityRef: "auth-x" }) }) }); return sp.spy.submit === 0; })());
  probe("P1-05_pending_dispatch_proof", (() => { const s = setup("READ_CURRENT_RESULTS", { op: "READ_CURRENT_RESULTS" }); const r = s.es.admit(proposal(Object.assign({}, s.dispatch, { dispatchId: "nope" }))); return r.reason === "EXECUTION_NO_PENDING_DISPATCH" && s.budgetCalls.length === 0 && s.adapter.calls.n === 0; })());
  probe("P1-05_one_monotonic_clock", (() => { const s = setup("READ_CURRENT_RESULTS", { op: "READ_CURRENT_RESULTS" }, { clock: mkScriptClock([20, 5]) }); const a = s.es.admit(proposal(s.dispatch)); return s.es.acceptAction({ accepted: acceptedTuple(a.admission) }).reason === "EXECUTION_NON_MONOTONIC_TIME"; })());
  probe("P1-06_metadata_idempotency_and_open_schema", (() => { const r = ES.getExecutionMetadata("READ_CURRENT_RESULTS"); const u = ES.getExecutionMetadata("APPLY_HOTEL_REFINEMENT"); const o = ES.getExecutionMetadata("OPEN_VISIBLE_HOTEL"); return r.idempotencyPolicy === "IDEMPOTENT_READ" && r.automaticRetryCeiling === 0 && u.idempotencyPolicy === "SINGLE_ATTEMPT" && o.resultSchemas.indexOf("navigation") !== -1 && o.resultSchemas.indexOf("detail") !== -1; })());
  probe("dormant_adapter_zero_execution", (() => { const s = setup("READ_CURRENT_RESULTS", { op: "READ_CURRENT_RESULTS" }, { adapter: mkAdapter({ dormant: true }) }); return s.es.admit(proposal(s.dispatch)).reason === "EXECUTION_TRANSPORT_FAILURE"; })());
  probe("only_ic01_verified_reaches_ic02", (() => { const h = happyRead(); return h.loop.verifiedEvidence().length === 1; })());
  probe("replay_never_readmits", (() => { const h = happyRead(); return h.es.admit(proposal(h.dispatch)).reason === "EXECUTION_DISPATCH_REPLAY"; })());
  // P1-03 residual — a post-accept PENDING event keeps the execution alive; a later TRUE terminal completes it.
  probe("P1-03_pending_not_terminal", (() => { const s = admitAcceptPending(); return s.pending.ok && s.pending.lifecycleState === "AWAITING_TERMINAL" && s.pending.verificationHandoff === false && s.es.status().lifecycleState === "AWAITING_TERMINAL" && s.loop.verifiedEvidence().length === 0; })());
  probe("P1-03_pending_then_terminal_completes", (() => { const s = admitAcceptPending(); const t = s.es.deliverTerminal({ terminal: terminalEvent(s.admission, "results", RA(B)) }); return t.ok && t.lifecycleState === "IC01_HANDOFF" && s.loop.verifiedEvidence().length === 1 && s.es.status().lifecycleState === "IDLE"; })());
  probe("P1-03_pending_revocation_no_late_authority", (() => { const s = admitAcceptPending(); s.es.interrupt("barge_in"); const late = s.es.deliverTerminal({ terminal: terminalEvent(s.admission, "results", RA(B)) }); return late.reason === "EXECUTION_INTERRUPTED" && s.loop.verifiedEvidence().length === 0; })());
  // P1-05 residual — the SAME controller's replay ledger genuinely fills, caps, evicts, and never revives stale authority.
  probe("P1-05_same_instance_replay_bound", (() => { const r = runReplayBound(); return r.growthOk && r.finalSize === r.MAX && r.maxObserved === r.MAX && r.everExceeded === false && r.readmitOk && r.staleReason === "EXECUTION_NO_PENDING_DISPATCH" && r.staleBudgetDelta === 0 && r.staleAdapterDelta === 0 && r.freshOk; })());
}

console.log("\n── CLOSURE PROBES ──");
probes.forEach((p) => console.log(`  ${p.ok ? "✓" : "✗"} ${p.name}`));

console.log(`\n${fail === 0 ? "✅" : "❌"} 03A execution-safety suite: ${pass} passed, ${fail} failed`);
if (fail !== 0) { console.error("\nFAILURES:\n" + failures.map((f) => "  - " + f).join("\n")); process.exit(1); }
process.exit(0);
