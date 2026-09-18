#!/usr/bin/env node
/* eslint-disable no-console */
// ═════════════════════════════════════════════════════════════════════════
// StayBid Live AI — LIVE-AI-03B (consolidated staging) — STAGING RUNTIME / BUDGET
// COMPOSITION BINDING — deterministic hermetic suite (+ REVIEW-REMEDIATION P1-01…P1-04).
//   Run:  node tests/live-ai/live-ai-03b-staging-runtime.test.js
// NO network, NO real DB, NO provider request, NO secret VALUE. Compiles the REAL
// gateway TS cluster and drives the composition with a RELEASED dormant BudgetStore, an
// in-memory fake BudgetStore (execution-lease path), and a loopback SQL pool stub
// (catalog loader) — never a real Postgres pool.
//
// Proves:
//  • the composition binds ONLY budgetCore (legacy budget NULL) and OMITS the 03B provider
//    override (apiKey/responsesFetch undefined, NOT null) so the accepted env-derived seam
//    stays capable of later activation (P1-01);
//  • loadStagingPriceCatalog reads the authoritative active catalog snapshot read-only, its
//    version == the store's selected priceCatalogVersionId, and it fails closed on
//    zero/ambiguous/error (P1-02);
//  • prepareExecution reserves EXACTLY ONE execution admission for an authenticated session,
//    admits once then refuses, fails closed without preparation, and makes ZERO provider
//    calls (P1-03);
//  • the bootstrap preflight fails closed unless the BUDGET binding matches the accepted
//    03B constants exactly (P1-04).
// ═════════════════════════════════════════════════════════════════════════
"use strict";
const path = require("path");
const fs = require("fs");
const cp = require("child_process");
const crypto = require("crypto");

const REPO = path.resolve(__dirname, "..", "..");
const BUILD = path.join(__dirname, ".build", "staging-runtime");
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
  if (!fs.existsSync(OUT)) { console.error(`COMPILE GATE FAILED (${name}):\n` + (r.stdout || "") + (r.stderr || "")); process.exit(2); }
  return OUT;
}

const GW = compileDir("gw", path.join(REPO, "server/voice-gateway"), "*.ts", ["es2020", "dom"]);
const STAGING = require(path.join(GW, "live-ai-staging-main.js"));
const STORE = require(path.join(GW, "live-ai-budget-store.js"));
const P = require(path.join(GW, "live-ai-budget-pricing.js"));
const CONFIG = require(path.join(GW, "config.js"));

let passed = 0, failed = 0; const failures = [];
function ok(c, l) { if (c) { passed++; console.log("  ✓ " + l); } else { failed++; failures.push(l); console.error("  ✗ " + l); } }
function eq(a, b, l) { ok(a === b, l + (a === b ? "" : ` [got ${String(a)} want ${String(b)}]`)); }
function section(n) { console.log("\n• " + n); }

// ── deterministic ports + an in-memory BudgetStore (trimmed from the accepted BUDGET-01 fake) ──
const noTimers = { set: () => 0, clear: () => {} };
function mkClock(start) { const s = { t: start == null ? 1_000_000 : start }; return { clock: { nowMs: () => s.t }, adv: (d) => { s.t += d; }, state: s }; }
function mkFakeStore(opts) {
  opts = opts || {};
  const calls = { acquire: 0, recordExec: 0, recordProv: 0, readControl: 0 };
  const catVer = opts.catalogVersionId === undefined ? "cat1" : opts.catalogVersionId;
  const state = {
    configured: opts.configured !== false,
    control: { globalEpoch: 1n, projectEpoch: 1n, enabled: true, killed: false, vector: "v1" },
    policy: { session_money_ceiling_micros: 10n ** 12n, session_provider_calls: 1000n, session_execution_admissions: 1000n, subject_day: 10n ** 12n, project_day: 10n ** 12n, project_month: 10n ** 12n, global_day: 10n ** 12n },
    counters: new Map(), sessions: new Map(), envelopes: new Map(), envById: new Map(), execChildren: new Map(), provChildren: new Map(),
  };
  const now = () => (opts.nowRef ? opts.nowRef.t : 1_000_000);
  const ck = (dig, dim) => dig + "|" + dim;
  const commit = (req) => STORE.canonicalAcquisitionCommitment({
    budgetClass: req.budgetClass, gatewaySessionDigest: req.gatewaySessionDigest, subjectDigest: req.subjectDigest,
    projectId: req.projectId, acquisitionKey: req.acquisitionKey, moneyMicros: req.amounts.moneyMicros.toString(),
    providerCalls: req.amounts.providerCalls.toString(), executionAdmissions: req.amounts.executionAdmissions.toString(),
  });
  return {
    get configured() { return state.configured; },
    _calls: calls, _state: state,
    async acquireEnvelope(req) {
      calls.acquire++;
      if (!state.configured) return { ok: false, reason: "no_store" };
      if (typeof req.bootNonce !== "string" || !req.bootNonce) return { ok: false, reason: "invalid_request" };
      const commitment = commit(req);
      const existing = state.envelopes.get(req.acquisitionKey);
      if (existing) {
        if (existing.commitment !== commitment) return { ok: false, reason: "acquisition_conflict" };
        if (existing.env.bootNonce !== req.bootNonce) return { ok: false, reason: "envelope_previous_boot" };
        return { ok: true, idempotentReplay: true, envelope: existing.env, replay: { executions: [], reservations: [] } };
      }
      if (state.control.killed) return { ok: false, reason: "control_killed" };
      if (!state.control.enabled) return { ok: false, reason: "control_disabled" };
      const need = req.amounts;
      const checks = req.budgetClass === "EXECUTION_ADMISSION"
        ? [[ck(req.gatewaySessionDigest, "exec"), need.executionAdmissions, state.policy.session_execution_admissions]]
        : [[ck(req.gatewaySessionDigest, "money"), need.moneyMicros, state.policy.session_money_ceiling_micros]];
      for (const [key, requested, ceiling] of checks) {
        const c = state.counters.get(key) || { held: 0n };
        if ((c.held || 0n) + requested > ceiling) return { ok: false, reason: "ceiling_exceeded" };
      }
      for (const [key, requested] of checks) { const c = state.counters.get(key) || { held: 0n }; c.held = (c.held || 0n) + requested; state.counters.set(key, c); }
      const envelopeId = "env_" + (state.envelopes.size + 1);
      const env = {
        envelopeId, budgetClass: req.budgetClass, amounts: req.amounts, budgetSessionId: "bs_" + req.gatewaySessionDigest,
        gatewaySessionDigest: req.gatewaySessionDigest, subjectDigest: req.subjectDigest, projectId: req.projectId,
        policyVersionId: "pol1", priceCatalogVersionId: catVer, globalControlEpoch: 1n, projectControlEpoch: 1n, controlVectorDigest: "v1",
        maxControlStalenessMs: req.maxControlStalenessMs, leaseTtlMs: req.leaseTtlMs, leaseGeneration: 1n, acquisitionCommitment: commitment,
        bootNonce: req.bootNonce, issuedAtMs: now(), expiresAtMs: now() + req.leaseTtlMs, leaseExpiryMs: now() + req.leaseTtlMs, acquiredAtMs: now(),
      };
      state.envelopes.set(req.acquisitionKey, { commitment, env });
      state.envById.set(envelopeId, { env });
      return { ok: true, idempotentReplay: false, envelope: env };
    },
    async reconcile() { return { ok: true }; },
    async recordExecutionAdmission(req) { calls.recordExec++; state.execChildren.set(req.executionId, req); return { ok: true }; },
    async recordProviderReservation(req) { calls.recordProv++; state.provChildren.set(req.reservationRef, req); return { ok: true }; },
    async settleProviderReservation() { return { ok: true }; },
    async revokeEnvelope() { return { ok: true }; },
    async reapOrphans() { return { ok: true, reaped: 0 }; },
    async readControl() { calls.readControl++; const c = state.control; return { globalEpoch: c.globalEpoch, projectEpoch: c.projectEpoch, controlVectorDigest: c.vector, enabled: c.enabled, killed: c.killed, observedAtMs: now() }; },
  };
}

// ── an Ic01 loop port (construction of ExecutionSafety must not call it) ──
function mkLoop() {
  return {
    beginTurn: () => ({ kind: "TERMINAL", reason: "done", terminalStep: 0, envelope: null }),
    submitModelPlan: () => ({ kind: "TERMINAL", reason: "done", terminalStep: 0, envelope: null }),
    reportModelFailure: () => ({ kind: "TERMINAL", reason: "model_unavailable", terminalStep: 0, envelope: null }),
    acknowledgeDispatch: () => ({ kind: "REJECTED", why: "unused" }),
    submitObservation: () => ({ kind: "TERMINAL", reason: "done", terminalStep: 0, envelope: null }),
    interrupt: () => {}, expire: () => {}, rebind: () => ({ kind: "INERT", why: "unused" }),
  };
}
// realistic TrustedBinding shapes (the accepted contract carries pageId + the digest/authority fields).
function mkBinding(pageId) {
  return Object.freeze({ sessionId: "las.x", turnId: "t.1", generation: 0, pageId, role: "anonymous", routeEpoch: 0, contextRevision: "rev.1", authorityRef: "ar.1", contextDigest: "d".repeat(64) });
}
const BINDING = mkBinding("hotels");
const DETAIL_BINDING = mkBinding("hotel-detail");
function validPublishedCtx() {
  return { pageId: "hotels", loadState: "ready", validated: true, currentHotelId: null, visibleHotels: [{ position: 1 }, { position: 2 }, { position: 3 }] };
}

// ── a loopback SQL pool stub for the catalog loader (no network, no real pg) ──
function mkCatalogPool(spec) {
  return {
    connect: async () => {
      if (spec.connectThrows) throw new Error("connect fail");
      return {
        query: async (text, params) => {
          if (spec.queryThrows) throw new Error("query fail");
          if (/budget_price_catalog_versions/.test(text)) return { rows: spec.versions || [] };
          if (/budget_price_catalog_entries/.test(text)) { const vid = params && params[0]; return { rows: (spec.entriesByVersion && spec.entriesByVersion[vid]) || [] }; }
          return { rows: [] };
        },
        release: () => {},
      };
    },
  };
}
function goodEntryRow(over) {
  return Object.assign({
    provider: "openai", model: "gpt-5.6-terra", service_tier: null, billing_dimension: "reasoning_input_token",
    currency_code: "USD", unit_size: "1", rate_micros: "5", effective_from: new Date(0), effective_until: null,
    verified_at: new Date(0), verification_expires_at: new Date(Date.now() + 1e10), source_id: "test", source_digest: "sd", status: "active",
  }, over || {});
}

async function run() {
  // ═══════════════════════ P1-01 — provider override OMITTED (not forced null) ═══════════════════════
  section("buildStagingLiveAi — budgetCore bound, legacy budget NULL, provider seam PRESERVED (P1-01)");
  const store = mkFakeStore({});
  const rt = STAGING.buildStagingLiveAi({ store, controlIntervalMs: 5000, bootNonce: "boot-1", controlTimers: noTimers });
  eq(rt.budget, null, "legacy atomic budget stays NULL (03B text path uses budgetCore only)");
  ok(rt.budgetCore && typeof rt.budgetCore.executionAdmissionGate === "function", "budgetCore is bound (executionAdmissionGate present)");
  ok(typeof rt.budgetCore.prepareExecutionLease === "function", "budgetCore structurally satisfies the 03b port (prepareExecutionLease present)");
  ok(!Object.prototype.hasOwnProperty.call(rt.live03b, "apiKey"), "P1-01 — live03b OMITS apiKey (own property absent)");
  ok(!Object.prototype.hasOwnProperty.call(rt.live03b, "responsesFetch"), "P1-01 — live03b OMITS responsesFetch (own property absent)");
  eq(rt.live03b.apiKey, undefined, "P1-01 — apiKey is undefined (NOT null ⇒ env-derived provider seam not suppressed)");
  eq(rt.live03b.responsesFetch, undefined, "P1-01 — responsesFetch is undefined (NOT null ⇒ real fetch seam not suppressed)");
  ok(typeof rt.live03b.makeExecution === "function", "live03b.makeExecution is a factory function");
  ok(typeof rt.live03b.prepareExecution === "function", "live03b.prepareExecution is a function (P1-03 seam)");
  ok(typeof rt.monotonicNowMs === "function", "monotonicNowMs is a function (the ONE monotonic clock)");
  ok(Object.isFrozen(rt) && Object.isFrozen(rt.live03b), "the runtime bundle + live03b are frozen");

  section("monotonic clock injection");
  let ticks = 0;
  const injected = STAGING.buildStagingLiveAi({ store, controlIntervalMs: 5000, bootNonce: "n", controlTimers: noTimers, monotonicNowMs: () => { ticks++; return 4242; } });
  eq(injected.monotonicNowMs(), 4242, "injected monotonicNowMs is used verbatim");
  ok(ticks === 1, "injected clock invoked exactly once");

  section("makeExecution — session-scoped 03A ExecutionSafety factory");
  const loop = mkLoop();
  const ctx1 = { gatewaySessionId: "gw-sess-1", binding: BINDING, publishedContext: validPublishedCtx(), monotonicNowMs: () => 1000 };
  const ctx2 = { gatewaySessionId: "gw-sess-2", binding: BINDING, publishedContext: validPublishedCtx(), monotonicNowMs: () => 2000 };
  const exec1 = rt.live03b.makeExecution(loop, ctx1);
  const exec2 = rt.live03b.makeExecution(loop, ctx2);
  ok(exec1 && typeof exec1.admit === "function" && typeof exec1.status === "function", "makeExecution(loop, ctx) ⇒ a real ExecutionSafety");
  ok(exec1 !== exec2, "two distinct session contexts ⇒ two distinct execution instances (session-specific)");
  const execNoCtx = rt.live03b.makeExecution(loop);
  ok(execNoCtx && typeof execNoCtx.admit === "function", "makeExecution(loop) with NO sessionCtx ⇒ still a fail-closed ExecutionSafety");

  // ═══════════════════════ P1-06 — screen-projection semantics + §3 binding coherence ═══════════════════════
  section("projectScreenContext — HOTELS readiness (P1-06 A)");
  const hb = BINDING;
  const hotelsReady = STAGING.projectScreenContext(hb, { pageId: "hotels", loadState: "ready", validated: true, visibleHotels: [{ position: 1 }, { position: 2 }, { position: 3 }] });
  ok(hotelsReady && hotelsReady.ready === true, "A1 — hotels + loadState=ready ⇒ ready true");
  eq(STAGING.projectScreenContext(hb, { pageId: "hotels", loadState: "loading", visibleHotels: [] }).ready, false, "A2 — hotels + loadState=loading ⇒ ready false");
  eq(STAGING.projectScreenContext(hb, { pageId: "hotels", loadState: "error", visibleHotels: [] }).ready, false, "A3 — hotels + loadState=error ⇒ ready false");
  eq(STAGING.projectScreenContext(hb, { pageId: "hotels", loadState: "loading", validated: true, visibleHotels: [{ position: 1 }] }).ready, false, "A4 — hotels + loading + validated:true still MUST NOT become ready (validated cannot elevate)");
  eq(hotelsReady.currentHotelId, null, "A5 — hotels projection currentHotelId = null");
  eq(hotelsReady.sections.length, 0, "A6 — hotels projection sections = []");
  ok(hotelsReady.visiblePositions.length === 3 && hotelsReady.visiblePositions[0] === 1 && hotelsReady.visiblePositions[2] === 3, "A7 — visiblePositions come ONLY from the validated visible-hotel snapshot");
  ok(hotelsReady.binding === hb && Object.isFrozen(hotelsReady) && Object.isFrozen(hotelsReady.sections) && Object.isFrozen(hotelsReady.visiblePositions), "hotels projection carries the binding + frozen arrays");

  section("projectScreenContext — HOTEL DETAIL readiness (P1-06 B)");
  const db = DETAIL_BINDING;
  const readyDetail = STAGING.projectScreenContext(db, { pageId: "hotel-detail", loadState: "ready", validated: true, currentHotelId: "htl_42", section: "rooms" });
  ok(readyDetail && readyDetail.ready === true, "B8 — detail + ready + validated + currentHotelId ⇒ ready true");
  eq(readyDetail.currentHotelId, "htl_42", "B9 — ready detail exposes currentHotelId");
  ok(readyDetail.sections.indexOf("rooms") !== -1 && readyDetail.sections.indexOf("about") !== -1 && readyDetail.sections.length === 2, "B10 — ready detail exposes BOTH closed target sections [rooms, about] (entity-gate membership for both)");
  const readyDetailAbout = STAGING.projectScreenContext(db, { pageId: "hotel-detail", loadState: "ready", validated: true, currentHotelId: "htl_42", section: "about" });
  ok(readyDetail.sections.indexOf("about") !== -1, "B11 — current section=rooms still permits 'about' in ctx.sections");
  ok(readyDetailAbout.sections.indexOf("rooms") !== -1, "B12 — current section=about still permits 'rooms' in ctx.sections");
  eq(STAGING.projectScreenContext(db, { pageId: "hotel-detail", loadState: "loading", validated: true, currentHotelId: "htl_42" }).ready, false, "B13 — detail + loading ⇒ ready false");
  eq(STAGING.projectScreenContext(db, { pageId: "hotel-detail", loadState: "error", validated: true, currentHotelId: "htl_42" }).ready, false, "B14 — detail + error ⇒ ready false");
  eq(STAGING.projectScreenContext(db, { pageId: "hotel-detail", loadState: "ready", validated: false, currentHotelId: "htl_42" }).ready, false, "B15 — detail + validated=false ⇒ ready false");
  eq(STAGING.projectScreenContext(db, { pageId: "hotel-detail", loadState: "ready", validated: true, currentHotelId: "" }).ready, false, "B16 — detail without currentHotelId ⇒ ready false");
  const notReadyDetail = STAGING.projectScreenContext(db, { pageId: "hotel-detail", loadState: "loading", validated: true, currentHotelId: "htl_42" });
  ok(notReadyDetail.currentHotelId === null && notReadyDetail.sections.length === 0, "not-ready detail exposes NO executable authority (currentHotelId=null, sections=[])");

  section("projectScreenContext — §3 binding coherence + malformed inputs");
  eq(STAGING.projectScreenContext(db, { pageId: "hotels", loadState: "ready", visibleHotels: [] }), null, "C17 — binding.pageId(hotel-detail) != context.pageId(hotels) ⇒ FAIL CLOSED (null)");
  eq(STAGING.projectScreenContext(hb, { pageId: "hotel-detail", loadState: "ready", validated: true, currentHotelId: "x" }), null, "reverse coherence mismatch ⇒ null");
  eq(STAGING.projectScreenContext(hb, { pageId: "checkout" }), null, "unknown page ⇒ null");
  eq(STAGING.projectScreenContext(hb, null), null, "null published context ⇒ null");
  eq(STAGING.projectScreenContext(hb, [1, 2, 3]), null, "array context ⇒ null");

  // ═══════════════════════ P1-02 — authoritative catalog loading ═══════════════════════
  section("loadStagingPriceCatalog — authoritative active snapshot, read-only, fail-closed (P1-02)");
  const okCat = await STAGING.loadStagingPriceCatalog(mkCatalogPool({
    versions: [{ id: "cat-v9", effective_from: new Date("2026-02-01") }, { id: "cat-v8", effective_from: new Date("2026-01-01") }],
    entriesByVersion: { "cat-v9": [goodEntryRow(), goodEntryRow({ billing_dimension: "reasoning_output_token", rate_micros: "15" })] },
  }));
  ok(okCat.ok === true, "active version present ⇒ ok");
  eq(okCat.ok === true && okCat.catalog.version, "cat-v9", "catalog.version == the LATEST active version id (== store's selected priceCatalogVersionId)");
  eq(okCat.ok === true && okCat.catalog.size, 2, "both well-formed entries loaded");
  const resolved = okCat.ok === true && okCat.catalog.resolve({ provider: "openai", model: "gpt-5.6-terra", dimension: "reasoning_input_token" }, Date.now());
  ok(resolved && resolved.rateMicros === 5n && resolved.unitSize === 1n, "BIGINT columns converted to bigint + entry resolvable");

  const zero = await STAGING.loadStagingPriceCatalog(mkCatalogPool({ versions: [] }));
  ok(zero.ok === false && zero.reason === "no_active_catalog_version", "zero active versions ⇒ fail closed (no_active_catalog_version)");

  const ambiguous = await STAGING.loadStagingPriceCatalog(mkCatalogPool({
    versions: [{ id: "cat-a", effective_from: new Date("2026-03-01") }, { id: "cat-b", effective_from: new Date("2026-03-01") }],
  }));
  ok(ambiguous.ok === false && ambiguous.reason === "ambiguous_active_catalog", "two versions sharing the latest effective_from ⇒ ambiguous ⇒ fail closed");

  const connErr = await STAGING.loadStagingPriceCatalog(mkCatalogPool({ connectThrows: true }));
  ok(connErr.ok === false && connErr.reason === "catalog_load_error", "pool connect failure ⇒ catalog_load_error");
  const qErr = await STAGING.loadStagingPriceCatalog(mkCatalogPool({ queryThrows: true }));
  ok(qErr.ok === false && qErr.reason === "catalog_load_error", "query failure ⇒ catalog_load_error");

  const withBad = await STAGING.loadStagingPriceCatalog(mkCatalogPool({
    versions: [{ id: "cat-v1", effective_from: new Date("2026-01-01") }],
    entriesByVersion: { "cat-v1": [goodEntryRow(), goodEntryRow({ unit_size: "not-a-number" })] },
  }));
  ok(withBad.ok === true && withBad.catalog.version === "cat-v1" && withBad.catalog.size === 1, "a malformed row is dropped by the released validator (version preserved, size=1)");

  // ═══════════════════════ P1-03 — execution-admission lease preparation ═══════════════════════
  section("prepareExecution — EXACTLY ONE admission for an authenticated session, fail-closed (P1-03)");
  const clk = mkClock();
  const leaseStore = mkFakeStore({ nowRef: clk.state });
  const lrt = STAGING.buildStagingLiveAi({ store: leaseStore, controlIntervalMs: 5000, bootNonce: "boot-lease", clock: clk.clock, controlTimers: noTimers });
  const GSID = "gw.lease.1", SUBJ = "stg1." + "a".repeat(64);
  // BEFORE preparation ⇒ the gate has NO authority.
  eq(lrt.budgetCore.executionAdmissionGate(GSID).admit({ executionId: "e0", requestDigest: "d0" }).decision, "UNAVAILABLE", "no prepared lease ⇒ executionAdmissionGate UNAVAILABLE (fail closed)");
  const prep = await lrt.live03b.prepareExecution({ gatewaySessionId: GSID, subject: SUBJ });
  ok(prep.ok === true, "authenticated staging session ⇒ prepareExecution ok");
  const gate = lrt.budgetCore.executionAdmissionGate(GSID);
  eq(gate.admit({ executionId: "e1", requestDigest: "d1" }).decision, "ADMITTED", "first capability ⇒ ADMITTED (one admission authority)");
  eq(gate.admit({ executionId: "e2", requestDigest: "d2" }).decision, "REFUSED", "second distinct capability ⇒ REFUSED (EXACTLY ONE admission reserved)");
  eq(leaseStore._calls.recordProv, 0, "ZERO provider reservations recorded (execution admission consumes no provider money/calls)");
  ok(leaseStore._calls.acquire >= 1, "the execution lease was acquired durably (exactly the staging session authority)");
  // invalid session authority ⇒ fail closed.
  const bad = await lrt.live03b.prepareExecution({ gatewaySessionId: "", subject: SUBJ });
  ok(bad.ok === false, "empty gatewaySessionId ⇒ prepareExecution fails closed");
  // dormant store ⇒ preparation refused ⇒ no authority.
  const dormant = STAGING.buildStagingLiveAi({ store: STORE.createDormantBudgetStore(), controlIntervalMs: 5000, bootNonce: "boot-d", controlTimers: noTimers });
  const dPrep = await dormant.live03b.prepareExecution({ gatewaySessionId: "gw.d", subject: SUBJ });
  ok(dPrep.ok === false, "dormant store ⇒ prepareExecution fails closed (no execution authority)");
  eq(dormant.budgetCore.executionAdmissionGate("gw.d").admit({ executionId: "z", requestDigest: "z" }).decision, "UNAVAILABLE", "dormant ⇒ gate UNAVAILABLE");

  // ═══════════════════════ P1-04 — exact BUDGET-config binding ═══════════════════════
  section("stagingBootstrapPreflight — fail closed unless the accepted 03B constants match EXACTLY (P1-04)");
  const DSN = "postgres://localhost/db";
  const exactBudgetEnv = {
    LIVE_AI_BUDGET_ENABLED: "1", LIVE_AI_BUDGET_STORE_BINDING: "binding-ref", LIVE_AI_BUDGET_PROJECT_ID: "live-ai-03b",
    LIVE_AI_BUDGET_LEASE_TTL_MS: "60000", LIVE_AI_BUDGET_MAX_CONTROL_STALENESS_MS: "15000", LIVE_AI_BUDGET_CONTROL_POLL_MS: "5000",
  };
  eq(STAGING.STAGING_DATABASE_URL_ENV, "LIVE_AI_03B_STAGING_DATABASE_URL", "the staging DSN env NAME is exact");
  let pre = STAGING.stagingBootstrapPreflight({});
  ok(pre.ok === false && pre.reason === "staging_db_url_absent", "no staging DSN ⇒ staging_db_url_absent");
  pre = STAGING.stagingBootstrapPreflight({ LIVE_AI_03B_STAGING_DATABASE_URL: DSN });
  ok(pre.ok === false && pre.reason === "budget_binding_absent", "DSN present but no durable BUDGET binding ⇒ budget_binding_absent");
  // wrong project ⇒ mismatch (the OLD test's proj-staging must no longer pass).
  pre = STAGING.stagingBootstrapPreflight(Object.assign({ LIVE_AI_03B_STAGING_DATABASE_URL: DSN }, exactBudgetEnv, { LIVE_AI_BUDGET_PROJECT_ID: "proj-staging" }));
  ok(pre.ok === false && pre.reason === "budget_config_mismatch", "P1-04 — wrong projectId (proj-staging) ⇒ budget_config_mismatch (no longer valid)");
  // wrong staleness ⇒ mismatch (the OLD test's 30000 must no longer pass).
  pre = STAGING.stagingBootstrapPreflight(Object.assign({ LIVE_AI_03B_STAGING_DATABASE_URL: DSN }, exactBudgetEnv, { LIVE_AI_BUDGET_MAX_CONTROL_STALENESS_MS: "30000", LIVE_AI_BUDGET_CONTROL_POLL_MS: "20000" }));
  ok(pre.ok === false && pre.reason === "budget_config_mismatch", "P1-04 — wrong control staleness (30000) ⇒ budget_config_mismatch");
  // wrong lease TTL ⇒ mismatch.
  pre = STAGING.stagingBootstrapPreflight(Object.assign({ LIVE_AI_03B_STAGING_DATABASE_URL: DSN }, exactBudgetEnv, { LIVE_AI_BUDGET_LEASE_TTL_MS: "120000" }));
  ok(pre.ok === false && pre.reason === "budget_config_mismatch", "P1-04 — wrong lease TTL (120000) ⇒ budget_config_mismatch");
  // exact accepted constants ⇒ ok.
  pre = STAGING.stagingBootstrapPreflight(Object.assign({ LIVE_AI_03B_STAGING_DATABASE_URL: "  " + DSN + "  " }, exactBudgetEnv));
  ok(pre.ok === true, "exact accepted 03B constants (live-ai-03b / 60000 / 15000 / poll 5000) ⇒ preflight ok");
  eq(pre.ok === true && pre.dsn, DSN, "the DSN is trimmed");
  ok(pre.ok === true && pre.budgetConfig.projectId === "live-ai-03b" && CONFIG.budgetDurableConfigured(pre.budgetConfig), "preflight returns the durably-configured accepted binding");

  console.log(`\n${failed === 0 ? "✅" : "❌"} LIVE-AI-03B staging runtime suite: ${passed} passed, ${failed} failed`);
  if (failed !== 0) { console.error("\nFAILURES:\n" + failures.map((f) => "  - " + f).join("\n")); process.exit(1); }
  process.exit(0);
}

run().catch((e) => { console.error("UNCAUGHT:", e && e.stack || e); process.exit(1); });
