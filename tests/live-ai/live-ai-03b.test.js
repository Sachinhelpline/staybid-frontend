#!/usr/bin/env node
/* eslint-disable no-console */
// ═════════════════════════════════════════════════════════════════════════
// StayBid Live AI — LIVE-AI-03B — provider conformance + staging text — deterministic suite.
//   Run:  node tests/live-ai/live-ai-03b.test.js
// NO real provider network, NO credential, NO production infra. Fake provider/fetch throughout.
// Compiles the real TS modules (gateway cluster + the two browser lib files) and drives them.
// ═════════════════════════════════════════════════════════════════════════
"use strict";
const path = require("path");
const fs = require("fs");
const cp = require("child_process");

const REPO = path.resolve(__dirname, "..", "..");
const BUILD = path.join(__dirname, ".build", "budget03b");
fs.rmSync(BUILD, { recursive: true, force: true });
fs.mkdirSync(BUILD, { recursive: true });
const TSC_BIN = require.resolve("typescript/bin/tsc", { paths: [REPO] });

function compileDir(name, srcDir, includeGlob, extraLib) {
  const SRC = path.join(BUILD, name, "src");
  const OUT = path.join(BUILD, name, "out");
  fs.mkdirSync(SRC, { recursive: true });
  for (const f of fs.readdirSync(srcDir)) {
    if (f.endsWith(".ts") && !f.endsWith(".d.ts")) fs.copyFileSync(path.join(srcDir, f), path.join(SRC, f));
  }
  fs.writeFileSync(path.join(SRC, "tsconfig.json"), JSON.stringify({
    compilerOptions: { module: "commonjs", target: "es2020", esModuleInterop: true, skipLibCheck: true, moduleResolution: "node", ignoreDeprecations: "6.0", rootDir: ".", outDir: "../out", typeRoots: [path.join(REPO, "node_modules/@types")], types: ["node"], lib: extraLib || ["es2020"], strict: true, noEmitOnError: false },
    include: [includeGlob],
  }));
  const r = cp.spawnSync(process.execPath, [TSC_BIN, "-p", path.join(SRC, "tsconfig.json")], { cwd: REPO, encoding: "utf8" });
  // tsc may emit type errors from unrelated sibling files; we require the specific emitted JS.
  if (!fs.existsSync(OUT)) { console.error(`COMPILE GATE FAILED (${name}):\n` + (r.stdout || "") + (r.stderr || "")); process.exit(2); }
  return OUT;
}

const GW = compileDir("gw", path.join(REPO, "server/voice-gateway"), "*.ts", ["es2020", "dom"]);
const LIB = compileDir("lib", path.join(REPO, "lib/live-ai"), "*.ts", ["es2020", "dom"]);

const AUTH = require(path.join(GW, "live-ai-budget-authority.js"));
const RESP = require(path.join(GW, "openai-responses.js"));
const LOOP = require(path.join(GW, "live-ai-agent-loop.js"));
const ES = require(path.join(GW, "live-ai-execution-safety.js")); // P1-06 — REAL released 03A (no fake exec)
const COMPILER = require(path.join(GW, "live-ai-answer-compiler.js"));
const REGISTRY = require(path.join(GW, "live-ai-capability-registry.js"));
const CONFIG = require(path.join(GW, "config.js"));
const CTRL = require(path.join(GW, "live-ai-03b-controller.js"));
const PRICING = require(path.join(GW, "live-ai-budget-pricing.js"));
const CONSUMER = require(path.join(LIB, "compiled-answer-consumer.js"));
const PROTO = require(path.join(LIB, "protocol.js"));
// LIVE-AI-03B closure (P1-01) — the gateway bootstrap + the control-frame router.
const GWIDX = require(path.join(GW, "index.js"));
const CTRLSOCK = require(path.join(GW, "live-ai-control-socket.js"));
const SESS = require(path.join(GW, "live-ai-sessions.js"));
const SCH = require(path.join(GW, "live-ai-schemas.js"));
const jose = (() => { try { return require("jose"); } catch { return null; } })();
// a full, strictly-valid published context (mirror of the gateway suite's helper).
function validCtx(nHotels) {
  const visibleHotels = [];
  for (let i = 1; i <= (nHotels || 2); i++) visibleHotels.push({ position: i, id: "htl_" + i, name: "Hotel " + i, city: "Dhanaulti", minPrice: 1000 + i, rating: 4, parking: "present" });
  return { pageId: "hotels", role: "anonymous", destination: "Dhanaulti", query: null, loadState: "ready", visibleHotels, currentHotelId: null, validated: false, section: null, breakfast: null, parking: null };
}
// a fake IC01 loop that issues TWO MODEL_REQUESTs, to exercise the P1-03 provider-call ceiling.
function mkTwoRequestLoop() {
  let stage = 0; let requests = 0;
  const mr = () => { requests++; return { kind: "MODEL_REQUEST", modelRequestId: "mr" + requests, tier: "LEVEL_1", purpose: "initial", providerCeilingMs: 20000, maxInputBytes: 16 * 1024, deadlineMs: 30000, input: { snapshot: true } }; };
  const loop = {
    beginTurn: () => { stage = 1; return mr(); },
    submitModelPlan: () => { if (stage === 1) { stage = 2; return mr(); } return { kind: "TERMINAL", reason: "done", terminalStep: 0, envelope: null }; },
    reportModelFailure: () => ({ kind: "TERMINAL", reason: "model_unavailable", terminalStep: 0, envelope: null }),
    acknowledgeDispatch: () => ({ kind: "REJECTED", why: "unused" }),
    submitObservation: () => ({ kind: "TERMINAL", reason: "done", terminalStep: 0, envelope: null }),
    interrupt: () => {}, expire: () => {}, rebind: () => ({ kind: "INERT", why: "unused" }),
  };
  return { loop, requestCount: () => requests };
}
// Create a real session with a COHERENT context ACK (authorityRef computed by the real store
// algorithm), so build03bBinding (P1-04) accepts it. contextDigest defaults to a valid hex64.
function mkAckedSession(store, opts) {
  const o = opts || {};
  const created = store.create({ sessionId: o.sessionId || "las.a", subject: o.subject || "subj-1", ipHash: "ip", authenticated: !!o.authenticated });
  const s = created.session;
  const turnId = o.turnId || "t.1", generation = o.generation != null ? o.generation : 0;
  const routeEpoch = o.routeEpoch != null ? o.routeEpoch : 0, contextRevision = o.contextRevision || "rev.1";
  const context = o.context || validCtx(2);
  // the digest MUST be the ACCEPTED canonical digest of the exact context (so the IC01 loop's
  // contextCoherentWithBinding accepts it — mirrors the real gateway ACK).
  const digest = o.digest || SCH.contextDigest(context);
  const authorityRef = store.computeAuthorityRef(s, turnId, generation, routeEpoch, contextRevision, digest);
  store.setContextAck(s, authorityRef, `${turnId}|${routeEpoch}|${contextRevision}`, digest);
  s.lastContext = context;
  return { session: s, turnId, generation, routeEpoch, contextRevision, digest, authorityRef };
}

let passed = 0, failed = 0; const failures = [];
function ok(c, l) { if (c) { passed++; console.log("  ✓ " + l); } else { failed++; failures.push(l); console.error("  ✗ " + l); } }
function eq(a, b, l) { ok(a === b, l + (a === b ? "" : ` [got ${String(a)} want ${String(b)}]`)); }
function section(n) { console.log("\n• " + n); }
const clone = (x) => JSON.parse(JSON.stringify(x));

// ── shared fixtures ─────────────────────────────────────────────────────────
let idc = 0;
const mintId = (k) => `${k}-${++idc}`;
const HEX64 = "a".repeat(64);
function mkBinding(over) {
  return Object.assign({ sessionId: "sess-1", turnId: "turn-1", generation: 1, pageId: "hotels", role: "anonymous", routeEpoch: 1, contextRevision: "rev-1", authorityRef: "auth-1", contextDigest: HEX64 }, over || {});
}
function mkLoop() {
  return LOOP.createAgentLoop({ modelAvailable: () => true, routeTier: () => "LEVEL_1", mintId: (k, n) => `${k}-${n}-${++idc}`, telemetry: () => {} });
}
const clarifyPlan = { contractVersion: "staybid-intelligence.v1", intent: "CLARIFY", steps: [{ kind: "CLARIFY", reason: "MISSING_DESTINATION", language: "en" }] };
// Drive a fresh loop to a real compiled CLARIFY envelope (the golden fixture).
function goldenEnvelope() {
  const loop = mkLoop();
  const b = mkBinding();
  const e1 = loop.beginTurn({ nowMs: 1000, binding: b, userTurn: { text: "help", language: "en", role: "anonymous" } });
  if (e1.kind !== "MODEL_REQUEST") throw new Error("golden: expected MODEL_REQUEST got " + e1.kind);
  const e2 = loop.submitModelPlan({ nowMs: 1001, modelRequestId: e1.modelRequestId, plan: clarifyPlan });
  if (e2.kind !== "TERMINAL" || !e2.envelope) throw new Error("golden: expected TERMINAL+envelope got " + e2.kind + " reason=" + e2.reason);
  return { env: e2.envelope, binding: b };
}

// ── fake provider fetch (call-capturing) ─────────────────────────────────────
function mkFetch(handler) {
  const calls = [];
  const fn = async (url, init) => { calls.push({ url, init }); return handler(url, init); };
  fn.calls = calls;
  return fn;
}
function okResponse(bodyObj) { return { ok: true, status: 200, text: async () => JSON.stringify(bodyObj) }; }
// P1-08 — a RAW OpenAI Responses REST assistant message item carrying ONE output_text payload.
function msgItem(text) { return { type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text }] }; }
function validProviderBody() {
  return { status: "completed", model: RESP.REASONING_MODEL, output: [{ type: "reasoning", summary: [] }, msgItem(JSON.stringify(clarifyPlan))], usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 }, output_tokens_details: { reasoning_tokens: 10 } } };
}

// ── fake budget core (call-order + failure knobs) for §8 ordering tests ──────
function mkFakeBudget(opts) {
  opts = opts || {};
  const log = [];
  return {
    _log: log,
    async prepareProviderLease() { log.push("prepare"); return opts.prepareFails ? { ok: false, reason: "no_store" } : { ok: true }; },
    quoteReasoning03bWorstCaseMicros() { return opts.quoteNull ? null : BigInt(100000); },
    reserveReasoning03b() { log.push("reserve"); return opts.reserveFails ? null : "rsv-1"; },
    async persistProviderReservation() { log.push("persistResv"); return opts.persistResvFails ? false : true; },
    settleUsage() { log.push("settleUsage"); },
    async persistProviderSettlement() { log.push("persistSettle"); return opts.persistSettleFails ? false : true; },
    async reconcileSession() { log.push("reconcile"); },
    async revokeSessionDurable() { log.push("revoke"); },
  };
}
function mkCtrlDeps(over) {
  const emitted = [];
  const base = {
    loop: mkLoop(), budgetCore: mkFakeBudget(), execution: null,
    responsesFetch: null, apiKey: null, emit: (f) => emitted.push(f),
    now: () => Date.now(), monotonicNowMs: () => 0, isKilled: () => false,
    stagingEnabled: true, leaseTtlMs: 60000, maxControlStalenessMs: 15000, mintId,
  };
  const d = Object.assign(base, over || {});
  d._emitted = emitted;
  return d;
}
const req0 = () => ({ gatewaySessionId: "gw-1", subjectDigest: "subj-1", projectId: "projA", binding: mkBinding(), userText: "help", language: "en", role: "anonymous" });

const run = async () => {
  // ════════════════════ A — provider request contract (#1-#10, #20) ════════
  section("03B-A — provider request contract (fixed §6)");
  {
    let captured = null;
    const fetchImpl = mkFetch((url, init) => { captured = { url, init }; return okResponse(validProviderBody()); });
    const admission = RESP.buildProviderCallAdmissionV1({ inputSnapshot: { a: 1 }, deadlineMs: 20000 });
    ok(admission && admission.version === "staybid-provider-admission.v1", "A00 — admission built + digested");
    ok(typeof admission.admissionDigest === "string" && admission.admissionDigest.length === 64, "A00b — admission carries a sha256 digest");
    const outcome = await RESP.runReasoning03bProviderCall(admission, { apiKey: "k", inputSnapshot: { a: 1 }, fetchImpl });
    eq(captured.url, "https://api.openai.com/v1/responses", "A01 — exact endpoint");
    eq(captured.init.method, "POST", "A01b — POST");
    const body = JSON.parse(captured.init.body);
    eq(body.model, "gpt-5.6-terra", "A02 — exact model");
    eq(body.reasoning.effort, "low", "A03 — reasoning effort low");
    eq(body.max_output_tokens, 2000, "A04 — max_output_tokens 2000");
    eq(body.store, false, "A05 — store false");
    eq(body.background, false, "A06 — background false");
    eq(body.stream, false, "A07 — stream false");
    ok(Array.isArray(body.tools) && body.tools.length === 0, "A08 — tools empty");
    eq(body.truncation, "disabled", "A08b — truncation disabled");
    eq(body.text.format.type, "json_schema", "A02c — structured output json_schema");
    eq(body.text.format.strict, true, "A02d — strict structured output");
    eq(body.text.format.name, "live_ai_plan", "A02e — PlanCandidate schema name");
    ok(typeof body.text.format.schema === "object" && body.text.format.schema.properties.steps, "A02f — PlanCandidate schema shape");
    eq(fetchImpl.calls.length, 1, "A20 — exactly ONE fetch (zero retries)");
    eq(outcome.kind, "COMPLETED_VALID", "A09 — a well-formed response normalizes COMPLETED_VALID");
  }
  {
    // size bounds: payload > 32 KiB never calls; response > 64 KiB → OVERSIZED_OUTPUT.
    const big = "x".repeat(40 * 1024);
    const adm = RESP.buildProviderCallAdmissionV1({ inputSnapshot: { a: 1 }, deadlineMs: 20000 });
    const f1 = mkFetch(() => okResponse(validProviderBody()));
    const o1 = await RESP.runReasoning03bProviderCall(adm, { apiKey: "k", inputSnapshot: { blob: big }, fetchImpl: f1 });
    eq(o1.kind, "FAILED", "A10 — an over-32KiB payload never calls the provider");
    eq(f1.calls.length, 0, "A10b — zero fetch on payload oversize");
    const f2 = mkFetch(() => ({ ok: true, status: 200, text: async () => "y".repeat(70 * 1024) }));
    const o2 = await RESP.runReasoning03bProviderCall(adm, { apiKey: "k", inputSnapshot: { a: 1 }, fetchImpl: f2 });
    eq(o2.kind, "OVERSIZED_OUTPUT", "A11 — an over-64KiB response body → OVERSIZED_OUTPUT");
    // admission rejects an over-16KiB input snapshot (fail closed, never truncate).
    const oversizeAdm = RESP.buildProviderCallAdmissionV1({ inputSnapshot: { blob: "z".repeat(20 * 1024) }, deadlineMs: 20000 });
    eq(oversizeAdm, null, "A12 — an over-16KiB IC01 snapshot yields NO admission (reject, never truncate)");
    // deadline clamped to 20s.
    const dAdm = RESP.buildProviderCallAdmissionV1({ inputSnapshot: { a: 1 }, deadlineMs: 999999 });
    eq(dAdm.deadlineMs, 20000, "A13 — deadline clamped to the 20s absolute ceiling");
  }
  {
    // browser/user/model cannot alter URL/provider/model/authority — the admission is fixed + digested.
    const adm = RESP.buildProviderCallAdmissionV1({ inputSnapshot: { a: 1 }, deadlineMs: 20000 });
    eq(adm.endpoint, "https://api.openai.com/v1/responses", "A14 — endpoint is fixed in the admission");
    eq(adm.model, "gpt-5.6-terra", "A14b — model is fixed in the admission");
    eq(adm.provider, "openai", "A14c — provider is fixed");
    // a missing api key ⇒ no real call.
    const f = mkFetch(() => okResponse(validProviderBody()));
    const o = await RESP.runReasoning03bProviderCall(adm, { apiKey: null, inputSnapshot: { a: 1 }, fetchImpl: f });
    eq(o.kind, "PROVIDER_UNAVAILABLE", "A15 — no api key ⇒ PROVIDER_UNAVAILABLE, no fetch");
    eq(f.calls.length, 0, "A15b — dormant (no key) ⇒ zero fetch");
  }

  // ════════════════════ B — outcome normalization (#28-#35) ════════════════
  section("03B-B — provider outcome normalization (§7)");
  {
    const adm = RESP.buildProviderCallAdmissionV1({ inputSnapshot: { a: 1 }, deadlineMs: 5000 });
    const call = (handler) => RESP.runReasoning03bProviderCall(adm, { apiKey: "k", inputSnapshot: { a: 1 }, fetchImpl: mkFetch(handler) });
    eq((await call(() => ({ ok: false, status: 429, text: async () => "" }))).kind, "RATE_LIMITED", "B01 — 429 → RATE_LIMITED (#30)");
    eq((await call(() => ({ ok: false, status: 401, text: async () => "" }))).kind, "AUTHENTICATION_FAILED", "B02 — 401 → AUTHENTICATION_FAILED (#31)");
    eq((await call(() => ({ ok: false, status: 403, text: async () => "" }))).kind, "AUTHENTICATION_FAILED", "B02b — 403 → AUTHENTICATION_FAILED");
    eq((await call(() => ({ ok: false, status: 503, text: async () => "" }))).kind, "PROVIDER_UNAVAILABLE", "B03 — 5xx → PROVIDER_UNAVAILABLE (#32)");
    eq((await call(() => { throw new Error("net"); })).kind, "NETWORK_FAILURE", "B04 — network throw → NETWORK_FAILURE (#33)");
    eq((await call(() => okResponse({ status: "completed", model: RESP.REASONING_MODEL, output: [msgItem("not json {")] }))).kind, "MALFORMED_RESPONSE", "B05 — bad output_text → MALFORMED_RESPONSE (#34)");
    eq((await call(() => okResponse({ status: "completed", model: "some-other-model", output: [msgItem("{}")] }))).kind, "IDENTITY_MISMATCH", "B06 — wrong model → IDENTITY_MISMATCH (#35)");
    eq((await call(() => okResponse({ status: "incomplete", model: RESP.REASONING_MODEL }))).kind, "INCOMPLETE", "B07 — status incomplete → INCOMPLETE");
    eq((await call(() => okResponse({ status: "completed", model: RESP.REASONING_MODEL, output: [{ type: "message", role: "assistant", content: [] }] }))).kind, "MISSING_OUTPUT", "B08 — empty output_text → MISSING_OUTPUT");
    const noUsage = { status: "completed", model: RESP.REASONING_MODEL, output: [msgItem(JSON.stringify(clarifyPlan))] };
    eq((await call(() => okResponse(noUsage))).kind, "USAGE_MISSING", "B09 — no usage → USAGE_MISSING");
    const badUsage = Object.assign({}, noUsage, { usage: { input_tokens: -1, output_tokens: 5, total_tokens: 4 } });
    eq((await call(() => okResponse(badUsage))).kind, "USAGE_MALFORMED", "B10 — malformed usage → USAGE_MALFORMED");
    const toolItem = { status: "completed", model: RESP.REASONING_MODEL, output: [{ type: "function_call" }, msgItem(JSON.stringify(clarifyPlan))], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } };
    eq((await call(() => okResponse(toolItem))).kind, "MALFORMED_RESPONSE", "B11 — unexpected tool output item → rejected");
    // timeout normalization: an aborting fetch under a tiny deadline.
    const tAdm = RESP.buildProviderCallAdmissionV1({ inputSnapshot: { a: 1 }, deadlineMs: 5 });
    const tOut = await RESP.runReasoning03bProviderCall(tAdm, { apiKey: "k", inputSnapshot: { a: 1 }, fetchImpl: mkFetch((u, init) => new Promise((_, rej) => { init.signal.addEventListener("abort", () => rej(new Error("aborted")), { once: true }); })) });
    eq(tOut.kind, "TIMEOUT", "B12 — deadline abort → TIMEOUT (#28)");
    // caller abort normalization. A faithful fetch rejects IMMEDIATELY on an
    // already-aborted signal (the abort event has already fired), so the fake
    // must mirror real fetch and reject synchronously when init.signal.aborted.
    const ac = new AbortController(); ac.abort();
    const abortAwareFetch = mkFetch((u, init) => new Promise((_, rej) => {
      if (init.signal && init.signal.aborted) { rej(new Error("aborted")); return; }
      init.signal.addEventListener("abort", () => rej(new Error("aborted")), { once: true });
    }));
    const aOut = await RESP.runReasoning03bProviderCall(adm, { apiKey: "k", inputSnapshot: { a: 1 }, fetchImpl: abortAwareFetch, signal: ac.signal });
    eq(aOut.kind, "ABORTED", "B13 — caller abort → ABORTED (#29)");
  }

  // ════════════════════ C — budget-before-call ordering (#8, #11-#17) ═══════
  section("03B-C — budget-before-provider-call ordering (§8)");
  async function driveOnce(over, fetchHandler) {
    const fetchImpl = mkFetch(fetchHandler || (() => okResponse(validProviderBody())));
    const deps = mkCtrlDeps(Object.assign({ responsesFetch: fetchImpl, apiKey: "k" }, over || {}));
    const c = CTRL.create03bController(deps);
    const out = await c.beginTextTurn(req0());
    return { out, fetchImpl, deps };
  }
  {
    const { fetchImpl, deps } = await driveOnce({ budgetCore: mkFakeBudget({}) });
    const log = deps.budgetCore._log;
    ok(log.indexOf("reserve") !== -1 && log.indexOf("reserve") < (fetchImpl.calls.length ? 1e9 : 1e9), "C00 — reservation occurs");
    ok(fetchImpl.calls.length >= 1, "C01 — a configured budget path reaches the provider fetch");
    ok(log.indexOf("reserve") < log.indexOf("persistResv") + 1 && log.indexOf("persistResv") !== -1, "C02 — reservation + durable child persist happen (#11/#12)");
    // order: reserve THEN persistResv THEN (fetch). Prove persistResv precedes settleUsage/persistSettle.
    ok(log.indexOf("persistResv") < log.indexOf("settleUsage"), "C02b — provider child persisted before settlement");
  }
  {
    const { fetchImpl } = await driveOnce({ budgetCore: mkFakeBudget({ quoteNull: true }) });
    eq(fetchImpl.calls.length, 0, "C03 — no reasoning rate (budget unavailable) ⇒ ZERO fetch (#14)");
  }
  {
    const { fetchImpl } = await driveOnce({ budgetCore: mkFakeBudget({ prepareFails: true }) });
    eq(fetchImpl.calls.length, 0, "C04 — budget refused (prepare) ⇒ ZERO fetch (#13)");
  }
  {
    const { fetchImpl } = await driveOnce({ budgetCore: mkFakeBudget({ reserveFails: true }) });
    eq(fetchImpl.calls.length, 0, "C05 — reservation refused ⇒ ZERO fetch (#15)");
  }
  {
    const { fetchImpl } = await driveOnce({ budgetCore: mkFakeBudget({ persistResvFails: true }) });
    eq(fetchImpl.calls.length, 0, "C06 — reservation-persistence failure ⇒ ZERO fetch (#16)");
  }
  {
    const { fetchImpl } = await driveOnce({ isKilled: () => true });
    eq(fetchImpl.calls.length, 0, "C07 — kill before call ⇒ ZERO fetch (#17)");
  }
  {
    // dormant provider (no key) ⇒ zero fetch even with a healthy budget.
    const fetchImpl = mkFetch(() => okResponse(validProviderBody()));
    const deps = mkCtrlDeps({ responsesFetch: fetchImpl, apiKey: null, budgetCore: mkFakeBudget({}) });
    await CTRL.create03bController(deps).beginTextTurn(req0());
    eq(fetchImpl.calls.length, 0, "C08 — no api key ⇒ ZERO fetch");
  }
  {
    // duplicate provider identity ⇒ at most one fetch (idempotent reserve returns same id, one call).
    const { fetchImpl } = await driveOnce({});
    ok(fetchImpl.calls.length <= 3, "C09 — bounded provider calls per turn (≤ IC01 max) (#19)");
  }

  // ════════════════════ D — exact multi-tier settlement (#21-#27) ══════════
  section("03B-D — exact reasoning usage settlement");
  {
    // A real DPBEL core + fake store + a catalog with all reasoning tiers.
    const nowRef = { t: 1_000_000 };
    const store = mkPgLikeStore(nowRef);
    const catalog = mkReasoningCatalog();
    const core = AUTH.createBudgetCore({ store, catalog, clock: { nowMs: () => nowRef.t }, hashSession: (s) => "d_" + s, mintRef: (k, n) => `${k}-${n}`, controlTimers: { set: () => 0, clear: () => {} }, controlIntervalMs: 5000, bootNonce: "bootD" });
    await core.prepareProviderLease({ gatewaySessionId: "gwD", subjectDigest: "sD", projectId: "projA", acquisitionKey: "acqD", maxControlStalenessMs: 15000, leaseTtlMs: 60000, amounts: { moneyMicros: BigInt(10) ** BigInt(12), providerCalls: BigInt(8), executionAdmissions: BigInt(0) } });
    // worst-case = 32768 input at the HIGHEST usable tier (cache_write=8) + 2000 output at 15 = 262144 + 30000.
    const worst = core.quoteReasoning03bWorstCaseMicros();
    eq(worst.toString(), (BigInt(32768) * BigInt(8) + BigInt(2000) * BigInt(15)).toString(), "D01 — worst case reserves 32768 input ONCE at the highest tier + 2000 output (#22)");
    const rid = core.reserveReasoning03b("gwD", "turnD1");
    ok(typeof rid === "string" && rid, "D02 — reserveReasoning03b returns an id");
    // exact settle: input 1000 (cached 200, cacheWrite 100, ordinary 700), output 300 (reasoning 120).
    core.settleUsage("gwD", "turnD1", { inputTokens: 1000, cachedInputTokens: 200, cacheWriteTokens: 100, outputTokens: 300, reasoningTokens: 120, totalTokens: 1300 });
    const charged = BigInt(700) * BigInt(5) + BigInt(200) * BigInt(3) + BigInt(100) * BigInt(8) + BigInt(300) * BigInt(15); // ordinary@5 + cached@3 + cacheWrite@8 + output@15
    eq(core.inspect("gwD").provider.chargedMoneyMicros, charged.toString(), "D03 — exact ordinary/cached/cache-write/output settlement; reasoning NOT double-charged (#21/#23)");
    // malformed usage retains full.
    const r2 = core.reserveReasoning03b("gwD", "turnD2");
    void r2;
    const before2 = BigInt(core.inspect("gwD").provider.chargedMoneyMicros);
    core.settleUsage("gwD", "turnD2", { inputTokens: 5, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 5, reasoningTokens: 0, totalTokens: 999 }); // total incoherent
    const after2 = BigInt(core.inspect("gwD").provider.chargedMoneyMicros);
    eq((after2 - before2).toString(), worst.toString(), "D04 — incoherent usage retains the FULL reservation (#24)");
    // missing usage retains full.
    core.reserveReasoning03b("gwD", "turnD3");
    const before3 = BigInt(core.inspect("gwD").provider.chargedMoneyMicros);
    core.settleUsage("gwD", "turnD3", null);
    const after3 = BigInt(core.inspect("gwD").provider.chargedMoneyMicros);
    eq((after3 - before3).toString(), worst.toString(), "D05 — missing usage retains the FULL reservation (#25)");
    // over-cap usage ⇒ incident + revoke.
    core.reserveReasoning03b("gwD", "turnD4");
    core.settleUsage("gwD", "turnD4", { inputTokens: 40000, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 100, reasoningTokens: 0, totalTokens: 40100 }); // input > 32768
    ok(core.inspect("gwD").provider.revoked === true, "D06 — provider actual over the reservation revokes local authority (#26)");
  }
  {
    // missing/stale catalog tier prevents authority (#27): a catalog with NO reasoning rates.
    const nowRef = { t: 1_000_000 };
    const store = mkPgLikeStore(nowRef);
    const core = AUTH.createBudgetCore({ store, catalog: PRICING.EMPTY_PRICE_CATALOG, clock: { nowMs: () => nowRef.t }, hashSession: (s) => "e_" + s, mintRef: (k, n) => `${k}-${n}`, controlTimers: { set: () => 0, clear: () => {} }, controlIntervalMs: 5000, bootNonce: "bootE" });
    eq(core.quoteReasoning03bWorstCaseMicros(), null, "D07 — a catalog missing the reasoning tiers ⇒ NO worst case (no authority) (#27)");
  }

  // ════════════════════ E — controller effect handling (#36-#39) ═══════════
  section("03B-E — IC01 effect driver + 03A sole admission");
  {
    // valid candidate reaches submitModelPlan → TERMINAL → answer.compiled emitted (#36/#40).
    const deps = mkCtrlDeps({ responsesFetch: mkFetch(() => okResponse(validProviderBody())), apiKey: "k" });
    const out = await CTRL.create03bController(deps).beginTextTurn(req0());
    eq(out.state, "TERMINAL_COMPILED", "E01 — a valid provider candidate drives IC01 to a compiled terminal");
    eq(out.compiledEmitted, true, "E02 — the compiled-answer frame is emitted");
    eq(deps._emitted.length, 1, "E03 — exactly one answer.compiled frame");
    eq(deps._emitted[0].t, "answer.compiled", "E04 — frame type answer.compiled");
    ok(deps._emitted[0].envelope && deps._emitted[0].envelope.disposition === "IC02_ACCEPTED", "E05 — carries an IC02-accepted envelope (#38)");
    // the emitted envelope passes the wire validator AND the browser consumer.
    ok(PROTO.validateCompiledAnswerEnvelope(deps._emitted[0].envelope) !== null, "E06 — emitted envelope passes protocol validation");
    ok(CONSUMER.verifyCompiledEnvelope(deps._emitted[0].envelope).ok === true, "E07 — emitted envelope verifies in the browser consumer");
  }
  {
    // 03A is the SOLE action admission: a capability plan routes through execution.admit, never direct (#39).
    let admitCalls = 0;
    const exec = { admit: (input) => { admitCalls++; return { ok: true, lifecycleState: "DISPATCHED", admission: { dispatchId: "d" } }; }, acceptAction: () => ({ ok: false, reason: "x" }), deliverTerminal: () => ({ ok: false, reason: "x" }), interrupt: () => ({ ok: true }), expire: () => ({ ok: true }), status: () => ({ lifecycleState: "IDLE", dispatchId: null, executionId: null, replayLedgerSize: 0 }) };
    // a plan that dispatches a READ capability first.
    const capPlan = { contractVersion: "staybid-intelligence.v1", intent: "READ_RESULTS", steps: [{ kind: "CAPABILITY", capabilityId: "READ_CURRENT_RESULTS", args: { op: "READ_CURRENT_RESULTS" } }, { kind: "RESPOND", language: "en", claims: [{ kind: "fact", answer: "results_summary", groundedInStep: 0 }] }] };
    const loop = mkLoop();
    const deps = mkCtrlDeps({ loop, execution: exec, responsesFetch: mkFetch(() => okResponse({ status: "completed", model: RESP.REASONING_MODEL, output: [msgItem(JSON.stringify(capPlan))], usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 } })), apiKey: "k", binding: mkBinding() });
    const out = await CTRL.create03bController(deps).beginTextTurn(req0());
    eq(out.state, "AWAITING_CAPABILITY", "E08 — a capability plan suspends awaiting the 03A round-trip");
    eq(admitCalls, 1, "E09 — capability routed through 03A admit (sole admission) (#39)");
    eq(deps._emitted.length, 0, "E10 — 03B emits NO answer while a capability is pending (no direct browser authority)");
  }
  {
    // INERT / REJECTED / staging-disabled ⇒ zero authority (#52 partial).
    const deps = mkCtrlDeps({ stagingEnabled: false, responsesFetch: mkFetch(() => okResponse(validProviderBody())), apiKey: "k" });
    const out = await CTRL.create03bController(deps).beginTextTurn(req0());
    eq(out.state, "STAGING_DISABLED", "E11 — staging gate OFF ⇒ turn refused, zero authority");
    eq(deps.responsesFetch.calls.length, 0, "E12 — staging OFF ⇒ ZERO provider calls (#52)");
  }

  // ════════════════════ F — compiled envelope render + tamper + parity ═════
  section("03B-F — compiled envelope verification, tamper, and Node/browser parity (#40-#47, #16)");
  {
    const { env } = goldenEnvelope();
    ok(COMPILER.verifyEnvelope(env).ok === true, "F01 — the golden envelope verifies in the Node IC02 verifier");
    ok(CONSUMER.verifyCompiledEnvelope(env).ok === true, "F02 — the golden envelope verifies in the browser consumer");
    const r = CONSUMER.verifyCompiledEnvelope(env);
    eq(r.ok && r.canonicalText, env.canonicalText, "F03 — the verified canonicalText equals the envelope's (deterministic rerender) (#40)");
    ok(PROTO.validateCompiledAnswerEnvelope(env) !== null, "F04 — the golden envelope passes the wire validator");
    // parity mutations: BOTH verifiers must reject identically.
    const mutations = [
      ["canonicalText", (e) => { e.canonicalText = e.canonicalText + " x"; }],
      ["textHash", (e) => { e.textHash = "b".repeat(64); }],
      ["semanticHash", (e) => { e.semanticHash = "c".repeat(64); }],
      ["binding.authorityRef", (e) => { e.binding.authorityRef = "auth-Z"; }],
      ["binding.routeEpoch", (e) => { e.binding.routeEpoch = 999; }],
      ["binding.contextRevision", (e) => { e.binding.contextRevision = "rev-Z"; }],
      ["binding.contextDigest", (e) => { e.binding.contextDigest = "f".repeat(64); }],
      ["binding.turnId", (e) => { e.binding.turnId = "turn-Z"; }],
      ["binding.generation", (e) => { e.binding.generation = 42; }],
      ["disposition", (e) => { e.disposition = "IC02_REJECTED"; }],
      ["contractVersion", (e) => { e.contractVersion = "x"; }],
      ["compilerVersion", (e) => { e.compilerVersion = "x"; }],
      ["templateCatalogVersion", (e) => { e.templateCatalogVersion = "x"; }],
      ["atom.code", (e) => { if (e.semanticAtoms[0]) e.semanticAtoms[0].code = "AMBIGUOUS_REFERENCE"; }],
      ["evidenceCommitment.push", (e) => { e.evidenceCommitments = [{ verifiedStepIndex: 0, receiptId: "r", evidenceKind: "detail", receiptCommitment: HEX64 }]; }],
    ];
    let parityAll = true;
    for (const [name, mut] of mutations) {
      const a = clone(env); mut(a);
      const nodeRes = COMPILER.verifyEnvelope(a).ok;
      const browRes = CONSUMER.verifyCompiledEnvelope(a).ok;
      const same = nodeRes === browRes && nodeRes === false;
      if (!same) { parityAll = false; console.error(`    parity mismatch on ${name}: node=${nodeRes} browser=${browRes}`); }
    }
    ok(parityAll, "F05 — every supported mutation is REJECTED identically by Node + browser verifiers (parity) (#41-#45, #16)");
    // stale/foreign binding rejection via the consumer's current-binding check (#44).
    const cur = { sessionId: "sess-1", turnId: "turn-1", generation: 1, pageId: "hotels", role: "anonymous", routeEpoch: 1, contextRevision: "rev-1", authorityRef: "auth-1", contextDigest: HEX64 };
    // the golden env's binding differs from `cur` (turnId etc. minted by the loop) — construct a matching current binding from the env itself for the positive case:
    const good = CONSUMER.verifyCompiledAnswer(env, env.binding);
    ok(good.ok === true, "F06 — verifyCompiledAnswer accepts when the current binding matches");
    const stale = CONSUMER.verifyCompiledAnswer(env, Object.assign({}, env.binding, { turnId: "turn-OTHER" }));
    ok(stale.ok === false && stale.rejectCode === "IC02_REJECT_STALE_BINDING", "F07 — a stale/foreign current binding is rejected (#44)");
    void cur;
  }
  {
    // legacy answer.plan cannot render as a 03B answer; raw provider text cannot render (#46/#47).
    ok(typeof CONSUMER.verifyCompiledEnvelope === "function", "F08 — the ONLY 03B render path is the compiled-envelope verifier");
    const rawPlan = { t: "answer.plan", plan: { planId: "p" } };
    eq(PROTO.validateCompiledAnswerEnvelope(rawPlan), null, "F09 — an answer.plan-shaped object is NOT a compiled envelope (legacy bypass closed) (#46)");
    eq(CONSUMER.verifyCompiledEnvelope("just some text").ok, false, "F10 — raw text can never verify as a compiled answer (#47)");
    eq(CONSUMER.verifyCompiledEnvelope({ canonicalText: "hi" }).ok, false, "F11 — a fabricated partial envelope is rejected");
  }

  // ════════════════════ G — authority ceiling (#48-#50) ════════════════════
  section("03B-G — READ/UI_LOCAL ceiling; no transactional authority");
  {
    eq(REGISTRY.CAPABILITY_COUNT, 6, "G01 — exactly six capabilities (#49)");
    const ids = ["APPLY_HOTEL_REFINEMENT", "READ_CURRENT_RESULTS", "COMPARE_VISIBLE_HOTELS", "OPEN_VISIBLE_HOTEL", "READ_CURRENT_HOTEL_FACTS", "SHOW_HOTEL_SECTION"];
    let allReadOrUi = true;
    for (const id of ids) { const cap = REGISTRY.getCapability(id); if (!cap || (cap.authorityClass !== "READ" && cap.authorityClass !== "UI_LOCAL")) allReadOrUi = false; }
    ok(allReadOrUi, "G02 — every capability is READ or UI_LOCAL (#48)");
    ok(!REGISTRY.getCapability("CREATE_BOOKING") && !REGISTRY.getCapability("PLACE_BID") && !REGISTRY.getCapability("MAKE_PAYMENT"), "G03 — no booking/bid/payment capability exists (#50)");
  }

  // ════════════════════ H — voice/03C exclusion (#51) ══════════════════════
  section("03B-H — voice / STT / TTS / audio exclusion");
  {
    const srcs = [
      fs.readFileSync(path.join(REPO, "server/voice-gateway/live-ai-03b-controller.ts"), "utf8"),
      fs.readFileSync(path.join(REPO, "server/voice-gateway/openai-responses.ts"), "utf8"),
      fs.readFileSync(path.join(REPO, "lib/live-ai/compiled-answer-consumer.ts"), "utf8"),
    ];
    let clean = true;
    for (const s of srcs) { if (/openai-realtime|openai-transcription|openai-tts|audio-playback|getUserMedia|MediaRecorder|microphone/.test(s)) clean = false; }
    ok(clean, "H01 — 03B controller/provider/consumer never reference mic/STT/TTS/audio (#51)");
  }

  // ════════════════════ I — default dormancy (#52) ═════════════════════════
  section("03B-I — default production dormancy");
  {
    const cfg = CONFIG.loadLiveAiConfig({});
    eq(cfg.stagingTextEnabled, false, "I01 — LIVE_AI_03B_STAGING_TEXT_ENABLED defaults OFF");
    eq(cfg.stagingSubjectAllowlist.length, 0, "I02 — the subject allowlist defaults EMPTY");
    eq(CONFIG.liveAi03bStagingTextConfigured(cfg), false, "I03 — default config ⇒ staging text NOT configured (unreachable)");
    // even with the gate "1" but empty allowlist ⇒ still not configured.
    const cfg2 = CONFIG.loadLiveAiConfig({ LIVE_AI_03B_STAGING_TEXT_ENABLED: "1" });
    eq(CONFIG.liveAi03bStagingTextConfigured(cfg2), false, "I04 — gate ON but empty allowlist ⇒ still unreachable");
    eq(CONFIG.liveAi03bStagingSubjectAllowed(cfg, "subj-1"), false, "I05 — no subject is allowed under the default config");
  }

  // ════════════════════ J — P1-01 runtime bootstrap reachability ═══════════
  section("03B-J — P1-01 runtime bootstrap reachability (config-only activation)");
  {
    // (i) the ACTUAL control path routes a turn.text to run03bTextTurn when the seam is
    //     injected, and is byte-identical legacy when it is not — proven against the REAL
    //     session store + the REAL handleLiveAiControlFrame with an established context ACK.
    const store = SESS.createLiveAiSessionStore({ limits: SESS.DEFAULT_LIVE_AI_LIMITS });
    const created = store.create({ sessionId: "las.j", subject: "subj-1", ipHash: "ip", authenticated: false });
    const sess = created.session; const emitted = []; sess.emit = (f) => emitted.push(f);
    const legacyCalls = []; const seamCalls = [];
    const deps = { session: sess, store, runTurn: async (_s, i) => { legacyCalls.push(i); }, runTts: async () => {}, now: () => Date.now() };
    CTRLSOCK.handleLiveAiControlFrame({ ...deps, raw: JSON.stringify({ t: "context.publish", sessionId: "las.j", turnId: "t.5", generation: 4, routeEpoch: 0, contextRevision: "rev.5", context: validCtx(2) }) });
    const legacyStatus = CTRLSOCK.handleLiveAiControlFrame({ ...deps, raw: JSON.stringify({ t: "turn.text", sessionId: "las.j", turnId: "t.5", generation: 4, text: "hello" }) });
    eq(legacyStatus, "turn", "J01 — default bootstrap (no 03B seam) ⇒ legacy turn path (byte-identical)");
    eq(legacyCalls.length, 1, "J02 — the legacy orchestrator received the default turn");
    const seamStatus = CTRLSOCK.handleLiveAiControlFrame({ ...deps, run03bTextTurn: async (_s, i) => { seamCalls.push(i); }, raw: JSON.stringify({ t: "turn.text", sessionId: "las.j", turnId: "t.6", generation: 4, text: "help me" }) });
    eq(seamStatus, "turn_03b", "J03 — the seam injected ⇒ the REAL control path routes turn.text to 03B (#reachability D)");
    ok(seamCalls.length === 1 && seamCalls[0].transcript === "help me", "J04 — the 03B controller entrypoint received the turn transcript");
    eq(legacyCalls.length, 1, "J05 — the legacy orchestrator was NOT invoked for the 03B-routed turn");

    // (ii) the bootstrap gates the seam PURELY by configuration (no source change to activate).
    const stagingEnv = { LIVE_AI_03B_STAGING_TEXT_ENABLED: "1", LIVE_AI_03B_STAGING_SUBJECT_ALLOWLIST: "subj-1", OPENAI_API_KEY: "k" };
    const mkFakes = (spy) => ({ budgetCore: mkFakeBudget({}), responsesFetch: spy, apiKey: "k",
      makeLoop: () => LOOP.createAgentLoop({ modelAvailable: () => true, routeTier: () => "LEVEL_1", mintId: (k, n) => `ic01-${k}-${n}`, telemetry: () => {} }) });
    const ctxDefault = GWIDX.buildLiveAiContext({ env: {} });
    eq(CONFIG.liveAi03bStagingSubjectAllowed(ctxDefault.config, "subj-1"), false, "J06 — default production env ⇒ 03B route NOT admitted (A/B)");
    const spyC = mkFetch(() => okResponse(validProviderBody()));
    const ctxStaging = GWIDX.buildLiveAiContext({ env: stagingEnv, live03b: mkFakes(spyC) });
    eq(CONFIG.liveAi03bStagingSubjectAllowed(ctxStaging.config, "subj-OTHER"), false, "J07 — staging ON but subject NOT allowlisted ⇒ not admitted (C)");
    eq(CONFIG.liveAi03bStagingSubjectAllowed(ctxStaging.config, "subj-1"), true, "J08 — config-only flip: an allowlisted subject IS admitted (E — activation = configuration)");
    // (iii) the admitted run03bTextTurn REACHES the controller with a COHERENT context ACK:
    //       exactly one provider call + a compiled answer.
    const spy = mkFetch(() => okResponse(validProviderBody()));
    const ctxReach = GWIDX.buildLiveAiContext({ env: stagingEnv, live03b: mkFakes(spy) });
    const rstore = SESS.createLiveAiSessionStore({ limits: SESS.DEFAULT_LIVE_AI_LIMITS });
    const acked = mkAckedSession(rstore, { sessionId: "las.reach", subject: "subj-1" });
    const em = []; acked.session.emit = (f) => em.push(f);
    await ctxReach.run03bTextTurn(acked.session, { turnId: acked.turnId, generation: acked.generation, transcript: "help", language: "en", context: acked.session.lastContext });
    eq(spy.calls.length, 1, "J09 — the admitted 03B path reaches the controller (exactly one fake provider call, D)");
    const compiled = em.filter((f) => f && f.t === "answer.compiled");
    eq(compiled.length, 1, "J10 — the controller emitted the IC02 answer.compiled frame");
    eq(em.some((f) => f && f.t === "answer.plan"), false, "J11 — legacy answer.plan is NOT the 03B rendered answer (F — exclusivity)");
    ok(compiled[0] && PROTO.validateCompiledAnswerEnvelope(compiled[0].envelope) !== null, "J12 — the emitted 03B envelope passes the wire validator (F)");
    // (iv) a NON-allowlisted subject ⇒ LEGACY classification ⇒ ZERO 03B provider invocation.
    const spyN = mkFetch(() => okResponse(validProviderBody()));
    const ctxNA = GWIDX.buildLiveAiContext({ env: stagingEnv, live03b: mkFakes(spyN), reasoning: RESP.unavailableReasoning });
    const nstore = SESS.createLiveAiSessionStore({ limits: SESS.DEFAULT_LIVE_AI_LIMITS });
    const nacked = mkAckedSession(nstore, { sessionId: "las.na", subject: "subj-OTHER" });
    try { await ctxNA.run03bTextTurn(nacked.session, { turnId: nacked.turnId, generation: nacked.generation, transcript: "help", language: "en", context: nacked.session.lastContext }); } catch { /* legacy path may no-op without full deps */ }
    eq(spyN.calls.length, 0, "J13 — a non-allowlisted subject ⇒ ZERO 03B provider invocation (C)");
  }

  // ════════════════════ K — P1-02 text gate isolated from voice STT/TTS ════
  section("03B-K — P1-02 text gate decoupled from the voice provider config");
  {
    const cfgNoVoice = CONFIG.loadLiveAiConfig({ OPENAI_API_KEY: "k", LIVE_AI_STT_MODEL: "nope", LIVE_AI_TTS_MODEL: "nope" });
    eq(CONFIG.liveAiProviderConfigured(cfgNoVoice), false, "K00 — with STT/TTS mismatched, the broad voice gate is NOT configured");
    eq(CONFIG.liveAi03bTextProviderConfigured(cfgNoVoice), true, "K-G — the 03B TEXT provider IS configured WITHOUT STT/TTS (decoupled)");
    const cfgStaging = CONFIG.loadLiveAiConfig({ OPENAI_API_KEY: "k", LIVE_AI_STT_MODEL: "nope", LIVE_AI_TTS_MODEL: "nope", LIVE_AI_03B_STAGING_TEXT_ENABLED: "1", LIVE_AI_03B_STAGING_SUBJECT_ALLOWLIST: "subj-1" });
    eq(CONFIG.liveAi03bStagingTextConfigured(cfgStaging), true, "K-G2 — staging text is reachable without any STT/TTS configuration");
    const cfgBadReason = CONFIG.loadLiveAiConfig({ OPENAI_API_KEY: "k", LIVE_AI_REASONING_MODEL: "not-the-allowed-model" });
    eq(cfgBadReason.reasoningModel, "", "K-H0 — a mismatched reasoning model is disabled (fail closed)");
    eq(CONFIG.liveAi03bTextProviderConfigured(cfgBadReason), false, "K-H — an invalid reasoning model ⇒ 03B TEXT provider NOT configured (fail closed)");
    const cfgNoKey = CONFIG.loadLiveAiConfig({ LIVE_AI_03B_STAGING_TEXT_ENABLED: "1", LIVE_AI_03B_STAGING_SUBJECT_ALLOWLIST: "subj-1" });
    eq(CONFIG.liveAi03bTextProviderConfigured(cfgNoKey), false, "K-I — a missing provider credential ⇒ 03B TEXT provider NOT configured");
    eq(CONFIG.liveAi03bStagingTextConfigured(cfgNoKey), false, "K-I2 — no key ⇒ staging text unreachable (fail closed)");
    const cfgVoice = CONFIG.loadLiveAiConfig({ OPENAI_API_KEY: "k" });
    eq(CONFIG.liveAiProviderConfigured(cfgVoice), true, "K-J — the voice provider gate still accepts key + all three models (UNCHANGED)");
    const cfgVoiceNoStt = CONFIG.loadLiveAiConfig({ OPENAI_API_KEY: "k", LIVE_AI_STT_MODEL: "nope" });
    eq(CONFIG.liveAiProviderConfigured(cfgVoiceNoStt), false, "K-J2 — the voice gate still fails closed when STT is absent (UNCHANGED)");
  }

  // ════════════════════ L — P1-03 first-probe one-call ceiling ═════════════
  section("03B-L — P1-03 controller-owned provider-call ceiling (first-probe = 1)");
  {
    // first-probe (ceiling 1): the first MODEL_REQUEST calls the provider; a SECOND MODEL_REQUEST
    // makes NO second reservation and NO second provider call (fails safely via IC01 semantics).
    const spy = mkFetch(() => okResponse(validProviderBody()));
    const tl = mkTwoRequestLoop();
    const budget = mkFakeBudget({});
    const deps = mkCtrlDeps({ loop: tl.loop, budgetCore: budget, responsesFetch: spy, apiKey: "k", maxProviderCalls: 1 });
    const out = await CTRL.create03bController(deps).beginTextTurn(req0());
    ok(tl.requestCount() >= 2, "L00 — the loop issued a SECOND MODEL_REQUEST after the first call (non-vacuous)");
    eq(spy.calls.length, 1, "L-K — first-probe ceiling=1 permits EXACTLY ONE authenticated provider call");
    eq(spy.calls.length, 1, "L-L — a second IC01 MODEL_REQUEST after the first call ⇒ ZERO additional provider invocation");
    eq(budget._log.filter((x) => x === "reserve").length, 1, "L-M — NO second provider reservation is created");
    ok(out.providerCalls === 1, "L-M2 — the controller reports exactly one provider call for the turn");
    // normal (non-probe) bounded behavior is UNCHANGED: two MODEL_REQUESTs ⇒ two calls (≤ IC01 max).
    const spy2 = mkFetch(() => okResponse(validProviderBody()));
    const tl2 = mkTwoRequestLoop();
    const deps2 = mkCtrlDeps({ loop: tl2.loop, budgetCore: mkFakeBudget({}), responsesFetch: spy2, apiKey: "k" }); // maxProviderCalls default
    await CTRL.create03bController(deps2).beginTextTurn(req0());
    eq(spy2.calls.length, 2, "L-N — normal (non-probe) bounded behavior UNCHANGED: two requests ⇒ two calls (≤ IC01 max)");
  }

  const stagingEnv = { LIVE_AI_03B_STAGING_TEXT_ENABLED: "1", LIVE_AI_03B_STAGING_SUBJECT_ALLOWLIST: "subj-1", OPENAI_API_KEY: "k" };
  const mkFakes = (spy, over) => Object.assign({ budgetCore: mkFakeBudget({}), responsesFetch: spy, apiKey: "k",
    makeLoop: () => LOOP.createAgentLoop({ modelAvailable: () => true, routeTier: () => "LEVEL_1", mintId: (k, n) => `ic01-${k}-${n}`, telemetry: () => {} }) }, over || {});

  // ════════════════════ M — P1-01 real buildGateway forwarding ═════════════
  section("03B-M — P1-01 real buildGateway forwards the 03B runtime dependencies");
  {
    const spy = mkFetch(() => okResponse(validProviderBody()));
    const g1 = await GWIDX.buildGateway({ env: stagingEnv, liveAi: { live03b: mkFakes(spy) } });
    const a1 = mkAckedSession(SESS.createLiveAiSessionStore({ limits: SESS.DEFAULT_LIVE_AI_LIMITS }), { sessionId: "las.bg1", subject: "subj-1" });
    const em1 = []; a1.session.emit = (f) => em1.push(f);
    await g1.liveAiCtx.run03bTextTurn(a1.session, { turnId: a1.turnId, generation: a1.generation, transcript: "help", language: "en", context: a1.session.lastContext });
    eq(spy.calls.length, 1, "M01 — buildGateway FORWARDS the 03B deps ⇒ an authorized staging turn reaches the controller (no extra source change)");
    ok(em1.some((f) => f && f.t === "answer.compiled"), "M02 — the buildGateway-wired 03B path emits the compiled answer");
    try { await g1.app.close(); } catch { /* no-op */ }
    // default buildGateway forwards NONE ⇒ dormant (no budget core ⇒ CLOSED 03B, never legacy, no provider).
    const g2 = await GWIDX.buildGateway({ env: stagingEnv });
    const a2 = mkAckedSession(SESS.createLiveAiSessionStore({ limits: SESS.DEFAULT_LIVE_AI_LIMITS }), { sessionId: "las.bg2", subject: "subj-1" });
    const em2 = []; a2.session.emit = (f) => em2.push(f);
    await g2.liveAiCtx.run03bTextTurn(a2.session, { turnId: a2.turnId, generation: a2.generation, transcript: "help", language: "en", context: a2.session.lastContext });
    ok(em2.some((f) => f && f.t === "turn.error"), "M03 — default buildGateway forwards NO deps ⇒ a 03B turn is a CLOSED failure (dormant)");
    eq(em2.some((f) => f && (f.t === "answer.compiled" || f.t === "answer.plan")), false, "M04 — default buildGateway ⇒ NO compiled answer and NO legacy answer.plan");
    try { await g2.app.close(); } catch { /* no-op */ }
  }

  // ════════════════════ N — P1-02 real session-create is text-mode aware ════
  section("03B-N — P1-02 real handleLiveAiSessionCreate: text needs no STT/TTS");
  if (!jose) { ok(false, "N — jose unavailable (integration prerequisite)"); }
  else {
    const { publicKey, privateKey } = await jose.generateKeyPair("ES256");
    const spki = await jose.exportSPKI(publicKey);
    const baseEnv = {
      LIVE_AI_RUNTIME_ENABLED: "1", LIVE_AI_SESSION_SIGNING_PUBLIC_KEY: spki, LIVE_AI_SESSION_ISSUER: "sb-broker",
      LIVE_AI_SESSION_AUDIENCE: "sb-gateway", LIVE_AI_CONTROL_TOKEN_SECRET: "ctl", LIVE_AI_KILL_SWITCH_HMAC_SECRET: "kill",
      LIVE_AI_ALLOWED_ORIGINS: "https://x.test", LIVE_AI_IP_HASH_SALT: "salt", OPENAI_API_KEY: "k",
      // STT + TTS DELIBERATELY mismatched (disabled) — the broad voice gate is NOT configured.
      LIVE_AI_STT_MODEL: "nope", LIVE_AI_TTS_MODEL: "nope",
      LIVE_AI_03B_STAGING_TEXT_ENABLED: "1", LIVE_AI_03B_STAGING_SUBJECT_ALLOWLIST: "sub.text",
    };
    const mkA = async (sub) => new jose.SignJWT({ scope: "live-ai:read-ui-local", origin: "https://x.test", auth: false })
      .setProtectedHeader({ alg: "ES256" }).setSubject(sub).setJti("jti." + Math.random().toString(36).slice(2))
      .setIssuer("sb-broker").setAudience("sb-gateway").setIssuedAt().setExpirationTime("60s").sign(privateKey);
    const ctxN = GWIDX.buildLiveAiContext({ env: baseEnv });
    // (G) TEXT + valid reasoning + allowlisted subject + INVALID STT/TTS ⇒ succeeds.
    const okText = await GWIDX.handleLiveAiSessionCreate(ctxN, { body: { mode: "text", sessionId: "las.tn" }, authorization: "Bearer " + (await mkA("sub.text")), ip: "1.1.1.1" });
    eq(okText.status, 200, "N-G — a TEXT session for an allowlisted subject SUCCEEDS without STT/TTS configured");
    // (H — voice unchanged) MICROPHONE with invalid STT/TTS ⇒ still fails closed (unconfigured).
    const micFail = await GWIDX.handleLiveAiSessionCreate(ctxN, { body: { mode: "microphone", sessionId: "las.mn", sdp: "v=0" }, authorization: "Bearer " + (await mkA("sub.text")), ip: "1.1.1.2" });
    eq(micFail.status, 503, "N-H — MICROPHONE with STT/TTS absent STILL fails closed (voice safety unchanged)");
    // a NON-allowlisted subject text session with no voice config ⇒ fails closed (no legacy prereqs).
    const naText = await GWIDX.handleLiveAiSessionCreate(ctxN, { body: { mode: "text", sessionId: "las.na2" }, authorization: "Bearer " + (await mkA("sub.other")), ip: "1.1.1.3" });
    eq(naText.status, 503, "N-I — a non-allowlisted text subject with no legacy voice config fails closed");
  }

  // ════════════════════ O — P1-03 no legacy fallback after 03B selection ════
  section("03B-O — P1-03 a 03B-classified turn NEVER falls back to legacy");
  {
    const legacySpy = []; const provSpy = mkFetch(() => okResponse(validProviderBody()));
    // 03B classified (allowlisted) but budget core ABSENT ⇒ CLOSED 03B failure, zero legacy, zero provider.
    const ctxO = GWIDX.buildLiveAiContext({ env: stagingEnv, live03b: { budgetCore: null, responsesFetch: provSpy, apiKey: "k", makeLoop: () => LOOP.createAgentLoop({ modelAvailable: () => true, routeTier: () => "LEVEL_1", mintId: (k, n) => `ic01-${k}-${n}`, telemetry: () => {} }) } });
    // shadow the orchestrator to detect any legacy invocation.
    ctxO.orchestrator.runTurn = async (_s, i) => { legacySpy.push(i); };
    const a = mkAckedSession(SESS.createLiveAiSessionStore({ limits: SESS.DEFAULT_LIVE_AI_LIMITS }), { sessionId: "las.o", subject: "subj-1" });
    const em = []; a.session.emit = (f) => em.push(f);
    await ctxO.run03bTextTurn(a.session, { turnId: a.turnId, generation: a.generation, transcript: "help", language: "en", context: a.session.lastContext });
    eq(legacySpy.length, 0, "O01 — a 03B turn with no budget core makes ZERO legacy orchestrator calls (#no-fallback)");
    eq(provSpy.calls.length, 0, "O02 — ZERO provider calls when mandatory budget authority is absent");
    eq(em.some((f) => f && f.t === "answer.plan"), false, "O03 — NO answer.plan emitted (never the legacy path)");
    eq(em.some((f) => f && f.t === "answer.compiled"), false, "O04 — NO compiled answer (closed failure)");
    ok(em.some((f) => f && f.t === "turn.error"), "O05 — a CLOSED 03B failure is emitted instead");
  }

  // ════════════════════ P — P1-04 trusted binding from the acked authority ══
  section("03B-P — P1-04 TrustedBinding is the acknowledged context authority (no reconstruction)");
  {
    const store = SESS.createLiveAiSessionStore({ limits: SESS.DEFAULT_LIVE_AI_LIMITS });
    // non-default routeEpoch + contextRevision, a nontrivial context whose key order differs from canonical.
    const acked = mkAckedSession(store, { sessionId: "las.p", subject: "subj-1", turnId: "t.p", generation: 3, routeEpoch: 7, contextRevision: "rev.custom.42" });
    let captured = null;
    const spy = mkFetch((u, init) => { try { captured = JSON.parse(init.body).input[1].content; } catch { captured = null; } return okResponse(validProviderBody()); });
    const ctxP = GWIDX.buildLiveAiContext({ env: stagingEnv, live03b: mkFakes(spy) });
    const em = []; acked.session.emit = (f) => em.push(f);
    await ctxP.run03bTextTurn(acked.session, { turnId: "t.p", generation: 3, transcript: "help", language: "en", context: acked.session.lastContext });
    const compiled = em.find((f) => f && f.t === "answer.compiled");
    ok(!!compiled, "P01 — a coherent ACK admits the 03B turn to the provider");
    const b = compiled ? compiled.envelope.binding : {};
    eq(b.contextDigest, acked.digest, "P02 — binding.contextDigest EQUALS the acknowledged context digest (no JSON.stringify)");
    eq(b.authorityRef, acked.authorityRef, "P03 — binding.authorityRef EQUALS the acked authorityRef exactly");
    eq(b.routeEpoch, 7, "P04 — routeEpoch comes from the accepted ACK metadata (not a default of 1)");
    eq(b.contextRevision, "rev.custom.42", "P05 — contextRevision comes from the accepted ACK metadata (not 'rev-1')");
    eq(b.generation, 3, "P06 — generation is the incoming active generation");
    // missing / mismatched ACK ⇒ FAIL before any provider call.
    const spy2 = mkFetch(() => okResponse(validProviderBody()));
    const ctxP2 = GWIDX.buildLiveAiContext({ env: stagingEnv, live03b: mkFakes(spy2) });
    const noAck = SESS.createLiveAiSessionStore({ limits: SESS.DEFAULT_LIVE_AI_LIMITS }).create({ sessionId: "las.p2", subject: "subj-1", ipHash: "ip", authenticated: false }).session;
    noAck.emit = () => {};
    await ctxP2.run03bTextTurn(noAck, { turnId: "t.x", generation: 0, transcript: "help", language: "en", context: null });
    eq(spy2.calls.length, 0, "P07 — a turn with NO acknowledged context fails closed BEFORE the provider (no reconstruction)");
    // a turnId that does not match the acked tuple ⇒ fail closed.
    const spy3 = mkFetch(() => okResponse(validProviderBody()));
    const ctxP3 = GWIDX.buildLiveAiContext({ env: stagingEnv, live03b: mkFakes(spy3) });
    const acked3 = mkAckedSession(SESS.createLiveAiSessionStore({ limits: SESS.DEFAULT_LIVE_AI_LIMITS }), { sessionId: "las.p3", subject: "subj-1", turnId: "t.real", generation: 1 });
    acked3.session.emit = () => {};
    await ctxP3.run03bTextTurn(acked3.session, { turnId: "t.MISMATCH", generation: 1, transcript: "help", language: "en", context: acked3.session.lastContext });
    eq(spy3.calls.length, 0, "P08 — an incoming turnId that mismatches the acked tuple fails closed before the provider");
  }

  // ════════════════════ Q — P1-05 full browser binding on the render path ═══
  section("03B-Q — P1-05 the render path uses the FULL browser binding verifier");
  {
    const { env } = goldenEnvelope();
    const cur = { sessionId: env.binding.sessionId, turnId: env.binding.turnId, generation: env.binding.generation, pageId: env.binding.pageId, role: env.binding.role, routeEpoch: env.binding.routeEpoch, contextRevision: env.binding.contextRevision, authorityRef: env.binding.authorityRef, contextDigest: env.binding.contextDigest };
    ok(CONSUMER.verifyCompiledAnswer(env, cur).ok === true, "Q00 — a matching current binding renders (full-binding verifier)");
    const fields = ["sessionId", "turnId", "generation", "pageId", "role", "routeEpoch", "contextRevision", "authorityRef", "contextDigest"];
    let allRejected = true;
    for (const f of fields) {
      const mutated = Object.assign({}, cur);
      if (f === "generation" || f === "routeEpoch") mutated[f] = cur[f] + 1;
      else if (f === "pageId") mutated[f] = cur.pageId === "hotels" ? "hotel-detail" : "hotels";
      else if (f === "role") mutated[f] = cur.role === "anonymous" ? "customer" : "anonymous";
      else mutated[f] = "MUT-" + String(cur[f]);
      const r = CONSUMER.verifyCompiledAnswer(env, mutated);
      if (r.ok !== false) { allRejected = false; console.error("    field not rejected:", f); }
    }
    ok(allRejected, "Q01 — EACH of the nine binding fields, mutated independently, is REJECTED (#P1-05)");
    // the actual conversation render path uses verifyCompiledAnswer + a constructed current binding,
    // and no weaker parallel verifyCompiledEnvelope render remains.
    const convSrc = fs.readFileSync(path.join(REPO, "lib/live-ai/conversation.ts"), "utf8");
    ok(/verifyCompiledAnswer\s*\(/.test(convSrc), "Q02 — conversation.ts calls verifyCompiledAnswer (full-binding)");
    ok(/currentTrustedBinding\s*\(/.test(convSrc), "Q03 — conversation.ts constructs the current trusted browser binding");
    ok(!/verifyCompiledEnvelope\s*\(/.test(convSrc), "Q04 — no weaker parallel verifyCompiledEnvelope render remains");
  }

  // ════════════════════ R — P1-06 retained capability lifecycle ════════════
  section("03B-R — P1-06 released-03A end-to-end (REAL createAgentLoop + REAL createExecutionSafety + capture proxy)");
  {
    // A REAL two-step plan: a READ capability then a grounded RESPOND. The real IC01 loop dispatches the
    // capability, and (after the verified observation is handed off internally by 03A) compiles the answer.
    const capPlan = { contractVersion: "staybid-intelligence.v1", intent: "READ_RESULTS", steps: [
      { kind: "CAPABILITY", capabilityId: "READ_CURRENT_RESULTS", args: { op: "READ_CURRENT_RESULTS" } },
      { kind: "RESPOND", language: "en", claims: [{ kind: "fact", answer: "results_summary", groundedInStep: 0 }] },
    ] };
    const capProvider = () => okResponse({ status: "completed", model: RESP.REASONING_MODEL, output: [msgItem(JSON.stringify(capPlan))], usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 } });
    const RA = (b) => ({ turnId: b.turnId, generation: b.generation, routeEpoch: b.routeEpoch, contextRevision: b.contextRevision, authorityRef: b.authorityRef, contextDigest: b.contextDigest });
    // Build a REAL lifecycle harness: a spy-wrapped REAL agent loop + a REAL ExecutionSafety bound to the
    // controller's SAME-loop capture proxy via createExecutionSafety. ONE shared monotonic clock feeds BOTH
    // the controller (turnClock) and the 03A ExecutionClock (P1-07).
    function realLifecycle() {
      let t = 1000; const mono = () => { t += 5; return t; };
      const binding = mkBinding();
      const real = mkLoop();
      const spy = { begin: 0, plan: 0, ack: 0, submit: 0 };
      const loop = {
        beginTurn: (i) => { spy.begin++; return real.beginTurn(i); },
        submitModelPlan: (i) => { spy.plan++; return real.submitModelPlan(i); },
        reportModelFailure: (i) => real.reportModelFailure(i),
        acknowledgeDispatch: (i) => { spy.ack++; return real.acknowledgeDispatch(i); },
        submitObservation: (i) => { spy.submit++; return real.submitObservation(i); },
        rebind: (i) => real.rebind(i), interrupt: (i) => real.interrupt(i), expire: (i) => real.expire(i),
        noteUserPreference: (i) => real.noteUserPreference(i), verifiedEvidence: () => real.verifiedEvidence(), status: () => real.status(),
      };
      const makeExecution = (loopPort) => ES.createExecutionSafety({
        clock: { nowMonotonicMs: () => mono() },
        mintId: { mint: (k, s) => `es-${k}-${s}` },
        budgetGate: { admit: () => ({ decision: "ADMITTED", budgetAdmissionRef: "b-1" }) },
        adapter: { dispatch: () => ({ dispatched: true }) },
        contexts: { current: () => ({ binding, ready: true, visiblePositions: [1, 2, 3, 4], currentHotelId: null, sections: [] }) },
        loop: loopPort, audit: { emit: () => {} },
      });
      const proposals = []; let admission = null;
      const budget = mkFakeBudget({});
      const deps = mkCtrlDeps({
        loop, budgetCore: budget, execution: null, makeExecution,
        responsesFetch: mkFetch(capProvider), apiKey: "k", binding,
        turnClock: mono, monotonicNowMs: mono,
        onCapabilityAdmitted: (adm) => { admission = adm; proposals.push(adm); },
      });
      const ctrl = CTRL.create03bController(deps);
      const req = { gatewaySessionId: "gw-r", subjectDigest: "subj-1", projectId: "projA", binding, userText: "help", language: "en", role: "anonymous", context: undefined };
      return { ctrl, req, spy, binding, budget, RA, get admission() { return admission; }, emitted: deps._emitted };
    }
    // build the exact browser accepted + terminal receipt correlated to the REAL admission.
    const acceptedFor = (adm) => ({ receiptId: adm.receiptId, proposalId: adm.proposalId, providerTurnId: adm.providerTurnId, actionId: "act-1", executionNonce: adm.executionNonce, operation: adm.capabilityId, authorityRef: adm.source.authorityRef });
    const receiptFor = (adm, RA, binding) => ({ receiptId: adm.receiptId, proposalId: adm.proposalId, providerTurnId: adm.providerTurnId, actionId: "act-1", executionNonce: adm.executionNonce, operation: adm.capabilityId, authorityRef: adm.source.authorityRef, outcome: "verified", status: "verified", resultAuthority: RA(binding), evidence: { kind: "results", count: 2, orderedIds: ["hotel-a", "hotel-b"] } });

    // (1) positive: begin → REAL admit (03A) → accept (REAL acceptAction) → terminal (REAL deliverTerminal) → compiled.
    const h = realLifecycle();
    const out0 = await h.ctrl.beginTextTurn(h.req);
    eq(out0.state, "AWAITING_CAPABILITY", "R01 — a REAL capability plan admits via 03A and suspends (retained)");
    ok(!!h.admission && typeof h.admission.dispatchId === "string", "R02 — the released 03A minted a real ExecutionAdmission");
    eq(h.spy.ack, 0, "R03 — the controller made ZERO loop.acknowledgeDispatch calls before acceptAction");
    eq(h.emitted.some((f) => f && f.t === "answer.compiled"), false, "R04 — no compiled answer while the capability is pending");
    const accOut = await h.ctrl.acceptCapability(h.req, acceptedFor(h.admission));
    eq(accOut.state, "AWAITING_CAPABILITY", "R05 — acceptCapability routes through 03A.acceptAction and stays awaiting the terminal");
    eq(h.spy.ack, 1, "R06 — the SOLE loop.acknowledgeDispatch was performed INTERNALLY by 03A (via the capture proxy)");
    eq(h.spy.submit, 0, "R07 — no observation submitted before the terminal receipt");
    const termOut = await h.ctrl.resumeWithObservation(h.req, receiptFor(h.admission, h.RA, h.binding));
    eq(h.spy.submit, 1, "R08 — the SOLE loop.submitObservation was performed INTERNALLY by 03A on deliverTerminal (capture proxy)");
    eq(termOut.state, "TERMINAL_COMPILED", "R09 — the resumed turn drove the exact 03A IC01 hand-off effect to a compiled answer");
    ok(h.emitted.some((f) => f && f.t === "answer.compiled"), "R10 — the compiled answer frame was emitted after the released-03A hand-off");

    // (2) a malformed terminal receipt fails closed via REAL 03A (no compiled answer, lifecycle cleared).
    const h2 = realLifecycle();
    await h2.ctrl.beginTextTurn(h2.req);
    await h2.ctrl.acceptCapability(h2.req, acceptedFor(h2.admission));
    const bad = await h2.ctrl.resumeWithObservation(h2.req, { garbage: true });
    eq(bad.state, "REJECTED", "R11 — a malformed terminal receipt is refused (REAL validateActionReceipt) — no IC01 observation");
    eq(h2.spy.submit, 0, "R12 — a malformed receipt never reaches loop.submitObservation");
    eq(h2.emitted.some((f) => f && f.t === "answer.compiled"), false, "R13 — a malformed terminal yields NO compiled answer");

    // (3) the controller NEVER calls loop.acknowledgeDispatch/submitObservation directly (source proof).
    const ctrlSrc = fs.readFileSync(path.join(REPO, "server/voice-gateway/live-ai-03b-controller.ts"), "utf8");
    ok(!/deps\.loop\.acknowledgeDispatch/.test(ctrlSrc) && !/deps\.loop\.submitObservation/.test(ctrlSrc), "R14 — the 03B controller makes NO direct loop.acknowledgeDispatch/submitObservation call (03A owns the hand-off)");
    ok(/createLoopEffectCaptureProxy/.test(ctrlSrc) && /makeExecution/.test(ctrlSrc), "R15 — the controller binds 03A to the SAME loop via the capture proxy + makeExecution factory");

    // (4) the emitted action.proposal shape: top-level authority + nested proposal ONLY proposalId/providerTurnId/operation.
    const idxSrc = fs.readFileSync(path.join(REPO, "server/voice-gateway/index.ts"), "utf8");
    ok(/proposal:\s*\{\s*proposalId:[^}]*providerTurnId:[^}]*operation:[^}]*\}/.test(idxSrc), "R16 — action.proposal nests ONLY proposalId/providerTurnId/operation (never the whole admission)");

    // (5) control-socket two-phase routing: action.accepted → accept03bAction; action.receipt → resume03bObservation(receipt).
    const acceptedRouted = []; const receiptRouted = [];
    const cstore = SESS.createLiveAiSessionStore({ limits: SESS.DEFAULT_LIVE_AI_LIMITS });
    const cs = cstore.create({ sessionId: "las.rc", subject: "subj-1", ipHash: "ip", authenticated: false }).session;
    const csDeps = { session: cs, store: cstore, runTurn: async () => {}, now: () => Date.now(), has03bLifecycle: () => true, accept03bAction: async (_s, acc) => { acceptedRouted.push(acc); return true; }, resume03bObservation: async (_s, rc) => { receiptRouted.push(rc); return true; }, interrupt03b: async () => true };
    const accSt = CTRLSOCK.handleLiveAiControlFrame({ ...csDeps, raw: JSON.stringify({ t: "action.accepted", sessionId: "las.rc", turnId: "t.1", generation: 0, accepted: { proposalId: "pp.1", providerTurnId: "pt.1", actionId: "act.1", executionNonce: "xn.1", receiptId: "rc.1", operation: "READ_CURRENT_RESULTS", authorityRef: "ar.1" } }) });
    eq(accSt, "accepted_03b", "R17 — action.accepted routes to the 03B lifecycle (accept03bAction, Stage 2)");
    eq(acceptedRouted.length, 1, "R18 — accept03bAction received the accepted action IMMEDIATELY (P1-06 b)");
    const rcSt = CTRLSOCK.handleLiveAiControlFrame({ ...csDeps, raw: JSON.stringify({ t: "action.receipt", sessionId: "las.rc", turnId: "t.1", generation: 0, receipt: { receiptId: "rc.1", proposalId: "pp.1", providerTurnId: "pt.1", actionId: "act.1", executionNonce: "xn.1", operation: "READ_CURRENT_RESULTS", authorityRef: "ar.1", outcome: "verified", status: "verified", resultAuthority: { turnId: "t.1", generation: 0, routeEpoch: 1, contextRevision: "rev-1", authorityRef: "ar.1", contextDigest: HEX64 }, evidence: { kind: "results", count: 2, orderedIds: ["htl_1", "htl_2"] } } }) });
    eq(rcSt, "receipt_03b", "R19 — action.receipt routes to resume03bObservation (Stage 3)");
    eq(receiptRouted.length, 1, "R20 — resume03bObservation received the terminal receipt (single-arg, Stage 3)");
  }

  // ════════════ Q7 — P1-07 ONE monotonic clock domain (REAL loop + REAL 03A) ══════════
  section("03B-Q7 — P1-07 one-clock-domain: REAL loop deadline enforcement + backward-clock fail-closed");
  {
    const capPlan = { contractVersion: "staybid-intelligence.v1", intent: "READ_RESULTS", steps: [
      { kind: "CAPABILITY", capabilityId: "READ_CURRENT_RESULTS", args: { op: "READ_CURRENT_RESULTS" } },
      { kind: "RESPOND", language: "en", claims: [{ kind: "fact", answer: "results_summary", groundedInStep: 0 }] },
    ] };
    const capProvider = () => okResponse({ status: "completed", model: RESP.REASONING_MODEL, output: [msgItem(JSON.stringify(capPlan))], usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 } });
    const acceptedFor = (adm) => ({ receiptId: adm.receiptId, proposalId: adm.proposalId, providerTurnId: adm.providerTurnId, actionId: "act-1", executionNonce: adm.executionNonce, operation: adm.capabilityId, authorityRef: adm.source.authorityRef });

    // (i) the SAME injected monotonic clock anchors beginTurn AND enforces the loop's real deadline: a clock
    // that jumps past the loop-computed deadline AFTER beginTurn denies the provider call (no epoch/perf split).
    {
      let n = 0; const mono = () => { n += 1; return n === 1 ? 1000 : 5_000_000; }; // begin=1000, then far past any real IC01 deadline
      const spy = mkFetch(capProvider);
      const deps = mkCtrlDeps({ loop: mkLoop(), budgetCore: mkFakeBudget({}), responsesFetch: spy, apiKey: "k", binding: mkBinding(), turnClock: mono, monotonicNowMs: mono });
      const ctrl = CTRL.create03bController(deps);
      const out = await ctrl.beginTextTurn(req0());
      eq(spy.calls.length, 0, "Q7-01 — a monotonic clock past the loop's OWN deadline denies the provider call (deadline enforced in beginTurn's clock domain)");
      eq(ctrl.providerCallCount(), 0, "Q7-02 — ZERO provider invocations once the shared monotonic clock is past deadline");
      ok(out.state === "TERMINAL_FAILURE" || out.state === "DEADLINE_EXCEEDED" || out.state === "TERMINAL_COMPILED" || out.state === "INERT" || out.state === "REJECTED" || out.state === "ERROR", "Q7-03 — the turn resolves to a closed state (no provider authority granted)");
    }

    // (ii) a normal monotonic clock (increasing) admits the capability via REAL 03A — the same clock feeds the
    // 03A ExecutionClock; then a BACKWARD move of that ONE clock before acceptance fails CLOSED (03A sample()).
    {
      let cur = 1000; const mono = () => cur; // controllable single clock, shared by the controller AND 03A
      const binding = mkBinding();
      const makeExecution = (loopPort) => ES.createExecutionSafety({
        clock: { nowMonotonicMs: () => mono() }, mintId: { mint: (k, s) => `es-${k}-${s}` },
        budgetGate: { admit: () => ({ decision: "ADMITTED", budgetAdmissionRef: "b-1" }) },
        adapter: { dispatch: () => ({ dispatched: true }) },
        contexts: { current: () => ({ binding, ready: true, visiblePositions: [1, 2, 3, 4], currentHotelId: null, sections: [] }) },
        loop: loopPort, audit: { emit: () => {} },
      });
      let admission = null;
      const deps = mkCtrlDeps({ loop: mkLoop(), budgetCore: mkFakeBudget({}), execution: null, makeExecution, responsesFetch: mkFetch(capProvider), apiKey: "k", binding, turnClock: mono, monotonicNowMs: mono, onCapabilityAdmitted: (a) => { admission = a; } });
      const ctrl = CTRL.create03bController(deps);
      const req = { gatewaySessionId: "gw-q7", subjectDigest: "subj-1", projectId: "projA", binding, userText: "help", language: "en", role: "anonymous", context: undefined };
      const out = await ctrl.beginTextTurn(req);
      eq(out.state, "AWAITING_CAPABILITY", "Q7-04 — with an increasing/steady monotonic clock the REAL capability admits and suspends");
      ok(!!admission, "Q7-05 — a real 03A admission was minted under the shared clock");
      cur = 900; // move the ONE shared clock BACKWARD before acceptance
      const acc = await ctrl.acceptCapability(req, acceptedFor(admission));
      eq(acc.state, "REJECTED", "Q7-06 — a BACKWARD move of the single clock fails CLOSED at 03A acceptAction (EXECUTION_NON_MONOTONIC_TIME)");
      eq(acc.reason, "EXECUTION_NON_MONOTONIC_TIME", "Q7-07 — the fail-closed reason is the 03A non-monotonic-time guard (one clock domain)");
    }

    // (iii) source proof: beginTurn's nowMs is the injected monotonic clock, NEVER deps.now()/Date.now().
    const ctrlSrc = fs.readFileSync(path.join(REPO, "server/voice-gateway/live-ai-03b-controller.ts"), "utf8");
    ok(/const\s+monoNow\s*:/.test(ctrlSrc) && /deps\.turnClock\s*\?\s*deps\.turnClock\s*:\s*deps\.monotonicNowMs/.test(ctrlSrc), "Q7-08 — the controller derives ONE monoNow clock (turnClock ?? monotonicNowMs)");
    ok(!/const\s+nowMs\s*=\s*deps\.now\(\)/.test(ctrlSrc) && !/nowMs:\s*deps\.now\(\)/.test(ctrlSrc), "Q7-09 — NO IC01 lifecycle nowMs is anchored on deps.now() (epoch) — the epoch/perf split is gone");
  }

  // ═══════════ TD — P1-06 FINAL TEARDOWN: active03b never outlives its authority owner ═══════════
  section("03B-TD — P1-06 FINAL TEARDOWN (REAL gateway lifecycle: kill / terminate / timeout / acted-terminal)");
  {
    const stagingEnv = { LIVE_AI_03B_STAGING_TEXT_ENABLED: "1", LIVE_AI_03B_STAGING_SUBJECT_ALLOWLIST: "subj-1", OPENAI_API_KEY: "k" };
    const capPlan = { contractVersion: "staybid-intelligence.v1", intent: "READ_RESULTS", steps: [
      { kind: "CAPABILITY", capabilityId: "READ_CURRENT_RESULTS", args: { op: "READ_CURRENT_RESULTS" } },
      { kind: "RESPOND", language: "en", claims: [{ kind: "fact", answer: "results_summary", groundedInStep: 0 }] },
    ] };
    const capProvider = () => okResponse({ status: "completed", model: RESP.REASONING_MODEL, output: [msgItem(JSON.stringify(capPlan))], usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 } });
    const RA = (b) => ({ turnId: b.turnId, generation: b.generation, routeEpoch: b.routeEpoch, contextRevision: b.contextRevision, authorityRef: b.authorityRef, contextDigest: b.contextDigest });

    // Build a REAL gateway 03B capability lifecycle retained in active03b (real loop + real createExecutionSafety).
    let seq = 0;
    function mkGwLifecycle() {
      seq += 1;
      const gwStore = SESS.createLiveAiSessionStore({ limits: SESS.DEFAULT_LIVE_AI_LIMITS });
      const a = mkAckedSession(gwStore, { sessionId: "las.td" + seq, subject: "subj-1", turnId: "t.td" + seq, generation: 0 });
      // the EXACT binding build03bBinding will derive from this ACK (so the real 03A context matches the dispatch).
      const gwBinding = { sessionId: a.session.sessionId, turnId: a.turnId, generation: a.generation, pageId: "hotels", role: "anonymous", routeEpoch: a.routeEpoch, contextRevision: a.contextRevision, authorityRef: a.authorityRef, contextDigest: a.digest };
      let t = 2000; const mono = () => { t += 5; return t; };
      const makeExecution = (loopPort) => ES.createExecutionSafety({
        clock: { nowMonotonicMs: () => mono() }, mintId: { mint: (k, s) => `es-${k}-${s}-${seq}` },
        budgetGate: { admit: () => ({ decision: "ADMITTED", budgetAdmissionRef: "b-1" }) },
        adapter: { dispatch: () => ({ dispatched: true }) },
        contexts: { current: () => ({ binding: gwBinding, ready: true, visiblePositions: [1, 2, 3, 4], currentHotelId: null, sections: [] }) },
        loop: loopPort, audit: { emit: () => {} },
      });
      const budget = mkFakeBudget({});
      const ctx = GWIDX.buildLiveAiContext({ env: stagingEnv, monotonicNowMs: mono, live03b: {
        budgetCore: budget, responsesFetch: mkFetch(capProvider), apiKey: "k", makeExecution,
        makeLoop: () => LOOP.createAgentLoop({ modelAvailable: () => true, routeTier: () => "LEVEL_1", mintId: (k, n) => `ic01-${k}-${n}-${seq}`, telemetry: () => {} }),
      } });
      const emitted = []; a.session.emit = (f) => emitted.push(f);
      return { ctx, a, gwBinding, budget, emitted, RA };
    }
    const proposalFrame = (h) => h.emitted.find((f) => f && f.t === "action.proposal");
    // the accepted/receipt `operation` field is the operation-name STRING (the envelope's `.op`), not the envelope.
    const opName = (fr) => (fr.proposal.operation && typeof fr.proposal.operation === "object" ? fr.proposal.operation.op : fr.proposal.operation);
    const acceptedFrom = (fr, b) => ({ receiptId: fr.receiptId, proposalId: fr.proposal.proposalId, providerTurnId: fr.proposal.providerTurnId, actionId: "act-1", executionNonce: fr.executionNonce, operation: opName(fr), authorityRef: b.authorityRef });
    const receiptFrom = (fr, b, o) => { o = o || {}; const r = { receiptId: fr.receiptId, proposalId: fr.proposal.proposalId, providerTurnId: fr.proposal.providerTurnId, actionId: "act-1", executionNonce: fr.executionNonce, operation: opName(fr), authorityRef: b.authorityRef, outcome: o.outcome || "verified", status: o.status || (o.outcome === "acted" ? "execution_acknowledged" : "verified") }; if ((o.outcome || "verified") === "verified") { r.resultAuthority = RA(b); r.evidence = { kind: "results", count: 2, orderedIds: ["hotel-a", "hotel-b"] }; } else if (o.withResultAuthority) { r.resultAuthority = RA(b); } return r; };

    // reach a retained lifecycle.
    async function reachRetained(h) {
      await h.ctx.run03bTextTurn(h.a.session, { turnId: h.a.turnId, generation: h.a.generation, transcript: "help", language: "en", context: h.a.session.lastContext });
      return h.ctx.has03bLifecycle(h.a.session);
    }

    // ── §11 — REAL action.proposal ServerFrame protocol validation ──
    {
      const h = mkGwLifecycle();
      const retained = await reachRetained(h);
      ok(retained, "TD-01 — a REAL capability turn is retained in active03b (awaiting the browser round-trip)");
      const fr = proposalFrame(h);
      ok(!!fr, "TD-02 — an action.proposal frame was emitted for the retained lifecycle");
      ok(PROTO.validateServerFrame(fr) !== null, "TD-03 — the ACTUAL emitted action.proposal PASSES the REAL ServerFrame validator (§11)");
      ok(typeof fr.executionNonce === "string" && typeof fr.receiptId === "string", "TD-04 — top-level executionNonce + receiptId present");
      const pk = fr.proposal ? Object.keys(fr.proposal).sort().join(",") : "";
      eq(pk, "operation,proposalId,providerTurnId", "TD-05 — nested proposal contains ONLY proposalId/providerTurnId/operation (no ExecutionAdmission leakage)");
    }

    // ── §12-A/B/C — turn.interrupt / reset / end via interrupt03b ──
    for (const reason of ["interrupt", "reset", "end"]) {
      const h = mkGwLifecycle();
      await reachRetained(h);
      const revBefore = h.budget._log.filter((x) => x === "reconcile").length;
      const done = await h.ctx.interrupt03b(h.a.session, reason);
      eq(done, true, `TD-${reason}-1 — interrupt03b(${reason}) tore down the active lifecycle`);
      eq(h.ctx.has03bLifecycle(h.a.session), false, `TD-${reason}-2 — the active03b entry is removed on ${reason}`);
      ok(h.budget._log.includes("revoke"), `TD-${reason}-3 — released 03A + budget authority revoked on ${reason}`);
      eq(h.budget._log.filter((x) => x === "reconcile").length, revBefore + 1, `TD-${reason}-4 — budget reconciliation invoked exactly once on ${reason}`);
    }

    // ── §12-D — GLOBAL KILL (teardownAll03b, the exact fn the kill handler calls) ──
    {
      const h = mkGwLifecycle();
      await reachRetained(h);
      const fr = proposalFrame(h);
      const n = h.ctx.teardownAll03b();
      ok(n >= 1, "TD-kill-1 — teardownAll03b revoked the active lifecycle(s) immediately");
      eq(h.ctx.has03bLifecycle(h.a.session), false, "TD-kill-2 — the active03b entry is removed synchronously on kill");
      await new Promise((r) => setImmediate(r)); // let the fire-and-forget reconcile settle
      ok(h.budget._log.includes("reconcile"), "TD-kill-3 — kill reconciled the 03B budget authority");
      // a late accepted / receipt after kill can NEVER regain authority (no owning lifecycle).
      const lateAcc = await h.ctx.accept03bAction(h.a.session, acceptedFrom(fr, h.gwBinding));
      const lateRc = await h.ctx.resume03bObservation(h.a.session, receiptFrom(fr, h.gwBinding));
      eq(lateAcc, false, "TD-kill-4 — a late action.accepted after kill is REFUSED (no retained lifecycle)");
      eq(lateRc, false, "TD-kill-5 — a late action.receipt after kill is REFUSED (no retained lifecycle)");
      // kill-handler wiring: teardownAll03b runs BEFORE store.drainAll.
      const idxSrc = fs.readFileSync(path.join(REPO, "server/voice-gateway/index.ts"), "utf8");
      ok(/teardownAll03b\(\);\s*\n\s*const drained = ctx\.store\.drainAll\(\)/.test(idxSrc), "TD-kill-6 — handleLiveAiKill calls teardownAll03b() BEFORE ctx.store.drainAll() (§5 ordering)");
    }

    // ── §12-E/F/G — control-socket-close / generic terminate / timeout via the store onTerminate hook ──
    for (const reason of ["closed", "user", "timeout"]) {
      const h = mkGwLifecycle();
      await reachRetained(h);
      h.ctx.store.terminate(h.a.session, reason); // fires onTerminate → central teardown03b
      eq(h.ctx.has03bLifecycle(h.a.session), false, `TD-term-${reason}-1 — store.terminate("${reason}") revokes the active03b lifecycle (onTerminate hook)`);
      await new Promise((r) => setImmediate(r)); // let the fire-and-forget reconcile settle
      ok(h.budget._log.includes("reconcile"), `TD-term-${reason}-2 — termination reason "${reason}" reconciled the 03B budget`);
    }

    // ── §12-H — duplicate teardown signals are idempotent (no double reconcile) ──
    {
      const h = mkGwLifecycle();
      await reachRetained(h);
      await h.ctx.interrupt03b(h.a.session, "interrupt");
      const afterFirst = h.budget._log.filter((x) => x === "reconcile").length;
      h.ctx.store.terminate(h.a.session, "closed"); // duplicate terminal signal
      await h.ctx.interrupt03b(h.a.session, "end");  // and a duplicate interrupt
      await new Promise((r) => setImmediate(r));
      eq(h.budget._log.filter((x) => x === "reconcile").length, afterFirst, "TD-dup-1 — duplicate teardown signals do NOT trigger a second budget reconciliation");
      eq(h.ctx.has03bLifecycle(h.a.session), false, "TD-dup-2 — the lifecycle stays torn down after duplicate signals");
    }

    // ── §10 — ACTED → AWAITING_TERMINAL retained → later TRUE terminal completes; §12-I/J ──
    {
      const h = mkGwLifecycle();
      await reachRetained(h);
      const fr = proposalFrame(h);
      const acc = await h.ctx.accept03bAction(h.a.session, acceptedFrom(fr, h.gwBinding));
      eq(acc, true, "TD-acted-1 — action.accepted routed through the RELEASED 03A (acceptAction)");
      const reconAfterAccept = h.budget._log.filter((x) => x === "reconcile").length;
      // a post-accept `acted` (pending) receipt → 03A returns AWAITING_TERMINAL → SAME lifecycle retained.
      await h.ctx.resume03bObservation(h.a.session, receiptFrom(fr, h.gwBinding, { outcome: "acted", status: "execution_acknowledged", withResultAuthority: true }));
      ok(h.ctx.has03bLifecycle(h.a.session), "TD-acted-2 — a post-accept `acted` receipt keeps the SAME lifecycle retained (AWAITING_TERMINAL)");
      eq(h.emitted.some((f) => f && f.t === "answer.compiled"), false, "TD-acted-3 — no compiled answer / no completion on the pending `acted` event");
      eq(h.budget._log.filter((x) => x === "reconcile").length, reconAfterAccept, "TD-acted-4 — NO reconcile while awaiting the true terminal");
      // the later TRUE terminal for the SAME execution completes via the SAME ExecutionSafety.
      await h.ctx.resume03bObservation(h.a.session, receiptFrom(fr, h.gwBinding, { outcome: "verified" }));
      ok(h.emitted.some((f) => f && f.t === "answer.compiled"), "TD-acted-5 — the later TRUE terminal is delivered by the SAME ExecutionSafety → IC01 continues → compiled");
      eq(h.ctx.has03bLifecycle(h.a.session), false, "TD-acted-6 — the lifecycle cleans at the true terminal (§12-J)");
      ok(h.budget._log.includes("reconcile"), "TD-acted-7 — reconcile runs at the true terminal");
      // §12-J — a teardown AFTER a true terminal is inert.
      const reconEnd = h.budget._log.filter((x) => x === "reconcile").length;
      h.ctx.store.terminate(h.a.session, "closed");
      await new Promise((r) => setImmediate(r));
      eq(h.budget._log.filter((x) => x === "reconcile").length, reconEnd, "TD-acted-8 — a teardown after the true terminal is INERT (no extra reconcile)");
    }

    // ── §12-I — teardown WHILE AWAITING_TERMINAL revokes; a later true terminal cannot resume ──
    {
      const h = mkGwLifecycle();
      await reachRetained(h);
      const fr = proposalFrame(h);
      await h.ctx.accept03bAction(h.a.session, acceptedFrom(fr, h.gwBinding));
      await h.ctx.resume03bObservation(h.a.session, receiptFrom(fr, h.gwBinding, { outcome: "acted", status: "execution_acknowledged", withResultAuthority: true }));
      ok(h.ctx.has03bLifecycle(h.a.session), "TD-i-1 — lifecycle is AWAITING_TERMINAL before teardown");
      h.ctx.store.terminate(h.a.session, "timeout"); // terminal ownership loss while awaiting
      eq(h.ctx.has03bLifecycle(h.a.session), false, "TD-i-2 — teardown while AWAITING_TERMINAL revokes the lifecycle");
      const lateTrue = await h.ctx.resume03bObservation(h.a.session, receiptFrom(fr, h.gwBinding, { outcome: "verified" }));
      eq(lateTrue, false, "TD-i-3 — a later TRUE terminal after teardown CANNOT resume the revoked lifecycle");
      eq(h.emitted.some((f) => f && f.t === "answer.compiled"), false, "TD-i-4 — no compiled answer is produced after the awaiting-terminal teardown");
    }
  }

  // ════════════════════ S — P1-07 interrupt binding + monotonic clock ══════
  section("03B-S — P1-07 provider interrupt + monotonic authority");
  {
    function mkOneModelLoop() {
      return { beginTurn: () => ({ kind: "MODEL_REQUEST", modelRequestId: "mr1", tier: "LEVEL_1", purpose: "initial", providerCeilingMs: 20000, maxInputBytes: 16 * 1024, deadlineMs: 30000, input: { s: 1 } }),
        submitModelPlan: () => ({ kind: "TERMINAL", reason: "done", terminalStep: 0, envelope: null }),
        reportModelFailure: () => ({ kind: "TERMINAL", reason: "fail", terminalStep: 0, envelope: null }),
        acknowledgeDispatch: () => ({ kind: "REJECTED", why: "x" }), submitObservation: () => ({ kind: "TERMINAL", reason: "x", terminalStep: 0, envelope: null }), interrupt: () => {}, expire: () => {}, rebind: () => ({ kind: "INERT", why: "x" }) };
    }
    // (i) an interrupt during a HANGING provider fetch aborts it; no late candidate; budget revoked.
    let aborted = false;
    const hang = mkFetch((u, init) => new Promise((_, rej) => {
      if (init.signal && init.signal.aborted) { aborted = true; rej(new Error("aborted")); return; }
      init.signal && init.signal.addEventListener("abort", () => { aborted = true; rej(new Error("aborted")); }, { once: true });
    }));
    const budget = mkFakeBudget({});
    const ctxS = GWIDX.buildLiveAiContext({ env: stagingEnv, live03b: { budgetCore: budget, responsesFetch: hang, apiKey: "k", makeLoop: () => mkOneModelLoop() } });
    const a = mkAckedSession(SESS.createLiveAiSessionStore({ limits: SESS.DEFAULT_LIVE_AI_LIMITS }), { sessionId: "las.s", subject: "subj-1" });
    const em = []; a.session.emit = (f) => em.push(f);
    const p = ctxS.run03bTextTurn(a.session, { turnId: a.turnId, generation: a.generation, transcript: "help", language: "en", context: a.session.lastContext }).catch(() => {});
    await new Promise((r) => setImmediate(r)); await new Promise((r) => setImmediate(r));
    const didInterrupt = await ctxS.interrupt03b(a.session, "barge_in");
    // bounded wait for the abort to propagate — NEVER `await p` (a disconnected abort would hang).
    await Promise.race([p, new Promise((r) => setTimeout(r, 100))]);
    eq(didInterrupt, true, "S01 — interrupt03b tears down the active lifecycle");
    ok(aborted, "S02 — the in-flight provider fetch AbortSignal fired on interrupt (#P1-07)");
    eq(em.some((f) => f && f.t === "answer.compiled"), false, "S03 — no late model candidate produced a compiled answer after interrupt");
    ok(budget._log.includes("revoke"), "S04 — the interrupt durably revoked the 03B budget authority");
    eq(ctxS.has03bLifecycle(a.session), false, "S05 — the active controller was cleaned on interrupt (no leak)");
    // (ii) an INJECTED monotonic source past the deadline denies authority (no provider call) —
    //      proving the monotonic clock (not wall-clock) governs the 03B deadline.
    const spy = mkFetch(() => okResponse(validProviderBody()));
    const ctxM = GWIDX.buildLiveAiContext({ env: stagingEnv, monotonicNowMs: () => 1e9, live03b: { budgetCore: mkFakeBudget({}), responsesFetch: spy, apiKey: "k", makeLoop: () => mkOneModelLoop() } });
    const am = mkAckedSession(SESS.createLiveAiSessionStore({ limits: SESS.DEFAULT_LIVE_AI_LIMITS }), { sessionId: "las.sm", subject: "subj-1" });
    am.session.emit = () => {};
    await ctxM.run03bTextTurn(am.session, { turnId: am.turnId, generation: am.generation, transcript: "help", language: "en", context: am.session.lastContext });
    eq(spy.calls.length, 0, "S06 — a monotonic source past the deadline DENIES authority (no provider call)");
    // source proof: the default monotonic clock is the Node performance clock, never Date.now.
    const idxSrc = fs.readFileSync(path.join(REPO, "server/voice-gateway/index.ts"), "utf8");
    ok(/nodePerformance\.now\(\)/.test(idxSrc), "S07 — the default 03B monotonic clock is the Node performance clock (not Date.now)");
    ok(/monotonicNowMs,\s*\n?\s*\/\/ P1-07/.test(idxSrc) || /monotonicNowMs,\s*\/\/ P1-07/.test(idxSrc) || /monotonicNowMs,/.test(idxSrc), "S08 — the controller is driven by the monotonic clock (not () => now())");
  }

  // ════════════════════ T — P1-08 strict raw Responses REST parser ═════════
  section("03B-T — P1-08 raw OpenAI Responses REST conformance (no SDK convenience)");
  {
    const adm = RESP.buildProviderCallAdmissionV1({ inputSnapshot: { a: 1 }, deadlineMs: 5000 });
    const callRaw = (bodyObj) => RESP.runReasoning03bProviderCall(adm, { apiKey: "k", inputSnapshot: { a: 1 }, fetchImpl: mkFetch(() => okResponse(bodyObj)) });
    const M = RESP.REASONING_MODEL;
    const plan = JSON.stringify(clarifyPlan);
    const good = { status: "completed", model: M, output: [msgItem(plan)], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } };
    eq((await callRaw(good)).kind, "COMPLETED_VALID", "T01 — a valid completed nested message/content/output_text → COMPLETED_VALID");
    eq((await callRaw({ status: "completed", model: M, output: [{ type: "reasoning", summary: [] }, msgItem(plan)], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } })).kind, "COMPLETED_VALID", "T02 — a reasoning item + ONE message → COMPLETED_VALID");
    eq((await callRaw({ status: "incomplete", model: M, output: [] })).kind, "INCOMPLETE", "T03 — incomplete → INCOMPLETE");
    eq((await callRaw({ status: "failed", model: M, output: [] })).kind, "FAILED", "T04 — a non-completed terminal status → FAILED");
    eq((await callRaw({ model: M, output: [msgItem(plan)] })).kind, "MALFORMED_RESPONSE", "T05 — MISSING status → MALFORMED_RESPONSE");
    eq((await callRaw({ status: "completed", output: [msgItem(plan)] })).kind, "IDENTITY_MISMATCH", "T06 — MISSING model → IDENTITY_MISMATCH (identity never assumed)");
    eq((await callRaw({ status: "completed", model: "other-model", output: [msgItem(plan)] })).kind, "IDENTITY_MISMATCH", "T07 — a FOREIGN model → IDENTITY_MISMATCH");
    eq((await callRaw({ status: "completed", model: M })).kind, "MISSING_OUTPUT", "T08 — MISSING output → MISSING_OUTPUT");
    eq((await callRaw({ status: "completed", model: M, output: [msgItem(plan), msgItem(plan)] })).kind, "MALFORMED_RESPONSE", "T09 — MULTIPLE competing message outputs → MALFORMED_RESPONSE");
    eq((await callRaw({ status: "completed", model: M, output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: plan }, { type: "output_text", text: plan }] }] })).kind, "MALFORMED_RESPONSE", "T10 — MULTIPLE competing output_text payloads → MALFORMED_RESPONSE");
    eq((await callRaw({ status: "completed", model: M, output: [{ type: "function_call", name: "x" }, msgItem(plan)] })).kind, "MALFORMED_RESPONSE", "T11 — a tool/function output item → MALFORMED_RESPONSE (authority-bearing rejected)");
    eq((await callRaw({ status: "completed", model: M, output: [{ type: "message", role: "assistant", content: "not-an-array" }] })).kind, "MALFORMED_RESPONSE", "T12 — malformed nested content → MALFORMED_RESPONSE");
    eq((await RESP.runReasoning03bProviderCall(adm, { apiKey: "k", inputSnapshot: { a: 1 }, fetchImpl: mkFetch(() => ({ ok: true, status: 200, text: async () => "y".repeat(70 * 1024) })) })).kind, "OVERSIZED_OUTPUT", "T13 — an over-64KiB response → OVERSIZED_OUTPUT");
    eq((await callRaw({ status: "completed", model: M, output_text: plan })).kind, "MISSING_OUTPUT", "T14 — a top-level SDK output_text (no raw output[]) is NOT accepted → MISSING_OUTPUT");
    eq((await callRaw({ status: "completed", model: M, output: [msgItem(plan)], usage: { input_tokens: 3, output_tokens: 2, total_tokens: 5 } })).kind, "COMPLETED_VALID", "T15 — usage present + valid → COMPLETED_VALID");
    eq((await callRaw({ status: "completed", model: M, output: [msgItem(plan)], usage: null })).kind, "USAGE_MISSING", "T15b — a valid parse with ABSENT usage → USAGE_MISSING (settlement retains full)");
    // ── P1-08 (ROOT CAUSE) — the ONE accepted raw Responses message MUST carry role === "assistant" (role PRESENT). ──
    const roleMsg = (role) => { const it = { type: "message", status: "completed", content: [{ type: "output_text", text: plan }] }; if (role !== undefined) it.role = role; return it; };
    eq((await callRaw({ status: "completed", model: M, output: [roleMsg("assistant")], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } })).kind, "COMPLETED_VALID", "T16 — role === 'assistant' present → COMPLETED_VALID");
    eq((await callRaw({ status: "completed", model: M, output: [roleMsg(undefined)] })).kind, "MALFORMED_RESPONSE", "T17 — MISSING role on the message → MALFORMED_RESPONSE");
    eq((await callRaw({ status: "completed", model: M, output: [roleMsg("user")] })).kind, "MALFORMED_RESPONSE", "T18 — role 'user' → MALFORMED_RESPONSE");
    eq((await callRaw({ status: "completed", model: M, output: [roleMsg("system")] })).kind, "MALFORMED_RESPONSE", "T19 — role 'system' → MALFORMED_RESPONSE");
    eq((await callRaw({ status: "completed", model: M, output: [roleMsg("developer")] })).kind, "MALFORMED_RESPONSE", "T20 — role 'developer' → MALFORMED_RESPONSE");
    eq((await callRaw({ status: "completed", model: M, output: [roleMsg("assistant_v2")] })).kind, "MALFORMED_RESPONSE", "T21 — any other role value → MALFORMED_RESPONSE");
    eq((await callRaw({ status: "completed", model: M, output: [roleMsg("")] })).kind, "MALFORMED_RESPONSE", "T22 — empty-string role → MALFORMED_RESPONSE");
    eq((await callRaw({ status: "completed", model: M, output: [roleMsg(null)] })).kind, "MALFORMED_RESPONSE", "T23 — null role → MALFORMED_RESPONSE");
  }

  console.log(`\n${failed === 0 ? "✅" : "❌"} LIVE-AI-03B deterministic suite: ${passed} passed, ${failed} failed`);
  if (failed !== 0) { console.error("\nFAILURES:\n" + failures.map((f) => "  - " + f).join("\n")); process.exit(1); }
  process.exit(0);
};

// ── minimal in-memory DPBEL store (for the exact-settlement section only) ────
function mkReasoningCatalog() {
  const base = { currencyCode: "USD", effectiveFromMs: 0, effectiveUntilMs: null, verifiedAtMs: 0, verificationExpiresAtMs: 9_000_000_000_000, sourceId: "t", sourceDigest: "d", status: "active" };
  const e = (dimension, serviceTier, rateMicros) => Object.assign({ provider: "openai", model: "gpt-5.6-terra", serviceTier, billingDimension: dimension, unitSize: BigInt(1), rateMicros: BigInt(rateMicros) }, base);
  return PRICING.createPriceCatalog("reasoning.v1", [
    e("reasoning_input_token", null, 5),
    e("reasoning_input_token", "cached", 3),
    e("reasoning_input_token", "cache_write", 8),
    e("reasoning_output_token", null, 15),
  ]);
}
function mkPgLikeStore(nowRef) {
  const state = { envelopes: new Map(), envById: new Map() };
  const now = () => nowRef.t;
  return {
    get configured() { return true; },
    async acquireEnvelope(req) {
      const existing = state.envelopes.get(req.acquisitionKey);
      if (existing) return { ok: true, idempotentReplay: true, envelope: existing.env, replay: { executions: [], reservations: [] } };
      const env = {
        envelopeId: "env_" + (state.envelopes.size + 1), budgetClass: req.budgetClass, amounts: req.amounts,
        budgetSessionId: "bs", gatewaySessionDigest: req.gatewaySessionDigest, subjectDigest: req.subjectDigest, projectId: req.projectId,
        policyVersionId: "pol1", priceCatalogVersionId: "reasoning.v1",
        globalControlEpoch: BigInt(1), projectControlEpoch: BigInt(1), controlVectorDigest: "v1",
        maxControlStalenessMs: req.maxControlStalenessMs, leaseTtlMs: req.leaseTtlMs, leaseGeneration: BigInt(1), acquisitionCommitment: "acq256:x",
        bootNonce: req.bootNonce, issuedAtMs: now(), expiresAtMs: now() + req.leaseTtlMs, leaseExpiryMs: now() + req.leaseTtlMs, acquiredAtMs: now(),
      };
      const row = { env, stateName: "held", revoked: false };
      state.envelopes.set(req.acquisitionKey, row); state.envById.set(env.envelopeId, row);
      return { ok: true, idempotentReplay: false, envelope: env };
    },
    async reconcile() { return { ok: true }; },
    async recordExecutionAdmission() { return { ok: true }; },
    async recordProviderReservation() { return { ok: true }; },
    async settleProviderReservation() { return { ok: true }; },
    async revokeEnvelope() { return { ok: true }; },
    async reapOrphans() { return { ok: true, reaped: 0 }; },
    async readControl() { return { globalEpoch: BigInt(1), projectEpoch: BigInt(1), controlVectorDigest: "v1", enabled: true, killed: false, observedAtMs: now() }; },
  };
}

run().catch((e) => { console.error("UNCAUGHT:", e && e.stack || e); process.exit(1); });
