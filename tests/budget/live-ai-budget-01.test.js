#!/usr/bin/env node
/* eslint-disable no-console */
// ═════════════════════════════════════════════════════════════════════════
// StayBid Live AI — LIVE-AI-BUDGET-01 — consolidated DETERMINISTIC suite.
//
//   Run:  node tests/budget/live-ai-budget-01.test.js
//
// Compiles the CLOSED 4-module budget set (pricing · control · store · authority)
// with the local tsc and drives the REAL compiled modules. Deterministic fakes ONLY
// at the injected ports (a controllable clock + an in-memory BudgetStore that COUNTS
// calls, so the SYNC facades can be proven to make ZERO store I/O). Hermetic:
// NO network, NO provider, NO real DB. The REAL PostgreSQL adapter's transactional
// semantics are proven separately in tests/budget/live-ai-budget-01.pg.test.js.
// ═════════════════════════════════════════════════════════════════════════
"use strict";
const path = require("path");
const fs = require("fs");
const cp = require("child_process");
const crypto = require("crypto");

const REPO = path.resolve(__dirname, "..", "..");
const FILES = ["live-ai-budget-pricing.ts", "live-ai-budget-control.ts", "live-ai-budget-store.ts", "live-ai-budget-authority.ts"];
const BUILD = path.join(__dirname, ".build", "budget01");
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
if (compile.status !== 0) { console.error("COMPILE GATE FAILED (budget01):\n" + (compile.stdout || "") + (compile.stderr || "")); process.exit(2); }
console.log("• Local tsc compile (budget01, strict): exit 0, clean");

const P = require(path.join(OUT, "gw/live-ai-budget-pricing.js"));
const CTL = require(path.join(OUT, "gw/live-ai-budget-control.js"));
const STOREMOD = require(path.join(OUT, "gw/live-ai-budget-store.js"));
const AUTH = require(path.join(OUT, "gw/live-ai-budget-authority.js"));

let pass = 0, fail = 0; const failures = [];
function ok(c, l) { if (c) pass += 1; else { fail += 1; failures.push(l); console.error("  ✗ " + l); } }
function eq(a, b, l) { ok(a === b, `${l} (got ${String(a)}, want ${String(b)})`); }
function section(n) { console.log("\n• " + n); }
const probes = [];
function probe(name, cond) { probes.push({ name, ok: !!cond }); ok(!!cond, "PROBE " + name); }

// ── deterministic ports ───────────────────────────────────────────────────
function mkClock(start) { const s = { t: start == null ? 1_000_000 : start }; return { clock: { nowMs: () => s.t }, adv: (d) => { s.t += d; }, set: (v) => { s.t = v; }, state: s }; }
const hashSession = (raw) => "d_" + crypto.createHash("sha256").update(String(raw)).digest("hex").slice(0, 24);
const mintRef = (k, n) => `${k}-${n}`;
const noTimers = { set: () => 0, clear: () => {} };
// P0-01 frozen-lifecycle — the trusted per-process boot nonce injected into every store-wired core.
// A single default models ONE boot instance; cross-boot tests inject a DIFFERENT value explicitly.
const BOOT = "boot-instance-A";

// ── an in-memory BudgetStore that COUNTS calls (never touched by sync facades) and
//    faithfully models the REMEDIATION-01 durable contract: immutable issuance pins,
//    replay-state distinction (held/terminal/forfeited/revoked/expired/ownership/identity),
//    durable child idempotency (executions + reservations/settlements) + hydration, an
//    orphan reaper, and a durable envelope revoke. The REAL transactional (SERIALIZABLE)
//    semantics are separately proven against PostgreSQL in the .pg.test.js suite. ──
function mkFakeStore(opts) {
  opts = opts || {};
  const calls = { acquire: 0, reconcile: 0, readControl: 0, recordExec: 0, recordProv: 0, settleProv: 0, revokeEnv: 0, reap: 0, total: 0 };
  const catVer = opts.catalogVersionId === undefined ? "cat1" : opts.catalogVersionId; // null preserved (P1-03 mismatch tests)
  const state = {
    configured: opts.configured !== false,
    control: opts.control || { globalEpoch: 1n, projectEpoch: 1n, enabled: true, killed: false, vector: "v1" },
    policy: opts.policy === undefined ? { session_money_ceiling_micros: 10n ** 12n, session_provider_calls: 1000n, session_execution_admissions: 1000n, subject_day: 10n ** 12n, project_day: 10n ** 12n, project_month: 10n ** 12n, global_day: 10n ** 12n } : opts.policy,
    counters: new Map(),      // durable counters keyed by digest|dim
    sessions: new Map(),      // gatewaySessionDigest → { subject, project }
    envelopes: new Map(),     // acquisitionKey → row
    envById: new Map(),       // envelopeId → row
    reconciled: new Set(),
    execChildren: new Map(),  // executionId → { envelopeId, requestDigest, admissionRef }
    provChildren: new Map(),  // reservationRef → { envelopeId, class, commitment, money, units, state, charged }
  };
  const now = () => (opts.nowRef ? opts.nowRef.t : 0);
  function ck(dig, dim) { return dig + "|" + dim; }
  function commit(req) {
    return STOREMOD.canonicalAcquisitionCommitment({
      budgetClass: req.budgetClass, gatewaySessionDigest: req.gatewaySessionDigest, subjectDigest: req.subjectDigest,
      projectId: req.projectId, acquisitionKey: req.acquisitionKey, moneyMicros: req.amounts.moneyMicros.toString(),
      providerCalls: req.amounts.providerCalls.toString(), executionAdmissions: req.amounts.executionAdmissions.toString(),
    });
  }
  function replayState(envelopeId) {
    const executions = []; const reservations = [];
    state.execChildren.forEach((c) => { if (c.envelopeId === envelopeId) executions.push({ executionId: c.executionId, requestDigest: c.requestDigest, admissionRef: c.admissionRef }); });
    state.provChildren.forEach((c) => { if (c.envelopeId === envelopeId) reservations.push({ reservationRef: c.reservationRef, providerSpendClass: c.class, requestCommitment: c.commitment, moneyMicros: c.money, providerUnits: c.units, state: c.state, chargedMicros: c.charged }); });
    return { executions, reservations };
  }
  function mkEnvelope(req, commitment) {
    const envelopeId = "env_" + (state.envelopes.size + 1);
    return {
      envelopeId, budgetClass: req.budgetClass, amounts: req.amounts, budgetSessionId: "bs_" + req.gatewaySessionDigest,
      gatewaySessionDigest: req.gatewaySessionDigest, subjectDigest: req.subjectDigest, projectId: req.projectId,
      policyVersionId: "pol1", priceCatalogVersionId: catVer,
      globalControlEpoch: state.control.globalEpoch, projectControlEpoch: state.control.projectEpoch, controlVectorDigest: state.control.vector,
      maxControlStalenessMs: req.maxControlStalenessMs, leaseTtlMs: req.leaseTtlMs, leaseGeneration: 1n, acquisitionCommitment: commitment,
      bootNonce: req.bootNonce, // P0-01 frozen-lifecycle — pinned trusted boot/process instance
      issuedAtMs: now(), expiresAtMs: now() + req.leaseTtlMs, leaseExpiryMs: now() + req.leaseTtlMs, acquiredAtMs: now(),
    };
  }
  const store = {
    get configured() { return state.configured; },
    _calls: calls, _state: state,
    async acquireEnvelope(req) {
      calls.acquire++; calls.total++;
      if (!state.configured) return { ok: false, reason: "no_store" };
      if (!state.policy) return { ok: false, reason: "no_policy" };
      // P0-01 frozen-lifecycle — a trusted boot/process-instance identifier is MANDATORY at issuance.
      if (typeof req.bootNonce !== "string" || req.bootNonce.length === 0) return { ok: false, reason: "invalid_request" };
      const commitment = commit(req);
      const existing = state.envelopes.get(req.acquisitionKey);
      if (existing) {
        if (existing.commitment !== commitment) return { ok: false, reason: "acquisition_conflict" };
        if (existing.env.gatewaySessionDigest !== req.gatewaySessionDigest || existing.env.subjectDigest !== req.subjectDigest || existing.env.projectId !== req.projectId) return { ok: false, reason: "ownership_conflict" };
        // §8 — a successful durable revoke refuses replay regardless of boot identity.
        if (existing.revoked) return { ok: false, reason: "envelope_revoked" };
        // P0-01 FROZEN-LIFECYCLE — a replay from a DIFFERENT trusted boot/process instance never
        // reconstructs old local allocation authority (anti-resurrection); it enters the conservative
        // forfeit lifecycle instead. This holds even if a prior durable revoke write never landed.
        if (existing.env.bootNonce !== req.bootNonce) return { ok: false, reason: "envelope_previous_boot" };
        if (existing.stateName === "reconciled") return { ok: false, reason: "envelope_terminal" };
        if (existing.stateName === "forfeited") return { ok: false, reason: "envelope_forfeited" };
        if (existing.env.expiresAtMs <= now()) return { ok: false, reason: "envelope_expired" };
        // §5 — an unresolved OPEN provider child makes the envelope non-replayable (crash ambiguity).
        let hasOpen = false; state.provChildren.forEach((c) => { if (c.envelopeId === existing.env.envelopeId && c.state === "open") hasOpen = true; });
        if (hasOpen) return { ok: false, reason: "envelope_open_child" };
        // §9 — CONTROL REVALIDATION on a SAME-boot replay: never mint authority from a stale pinned
        // control state. A currently killed / disabled / ADVANCED-epoch control refuses the replay.
        if (state.control.killed) return { ok: false, reason: "control_killed" };
        if (!state.control.enabled) return { ok: false, reason: "control_disabled" };
        if (state.control.globalEpoch > existing.env.globalControlEpoch || state.control.projectEpoch > existing.env.projectControlEpoch) return { ok: false, reason: "control_superseded" };
        return { ok: true, idempotentReplay: true, envelope: existing.env, replay: replayState(existing.env.envelopeId) };
      }
      // control gates only apply to a FRESH acquisition
      if (state.control.killed) return { ok: false, reason: "control_killed" };
      if (!state.control.enabled) return { ok: false, reason: "control_disabled" };
      // trusted-ownership: an existing session row is reusable ONLY on exact equality (P0-02)
      const sess = state.sessions.get(req.gatewaySessionDigest);
      if (sess) { if (sess.subject !== req.subjectDigest || sess.project !== req.projectId) return { ok: false, reason: "ownership_conflict" }; }
      // ceiling check (money on session/subject-day/project-day/project-month/global-day; exec on session)
      const need = req.amounts;
      const checks = req.budgetClass === "EXECUTION_ADMISSION"
        ? [[ck(req.gatewaySessionDigest, "exec"), need.executionAdmissions, state.policy.session_execution_admissions]]
        : [
            [ck(req.gatewaySessionDigest, "money"), need.moneyMicros, state.policy.session_money_ceiling_micros],
            [ck(req.gatewaySessionDigest, "calls"), need.providerCalls, state.policy.session_provider_calls],
            [ck("subj:" + req.subjectDigest, "day_money"), need.moneyMicros, state.policy.subject_day],
            [ck("project", "day_money"), need.moneyMicros, state.policy.project_day],
            [ck("project", "month_money"), need.moneyMicros, state.policy.project_month],
            [ck("global", "day_money"), need.moneyMicros, state.policy.global_day],
          ];
      for (const [key, requested, ceiling] of checks) {
        const c = state.counters.get(key) || { held: 0n, charged: 0n, consumed: 0n, released: 0n };
        if (c.held + c.charged + c.consumed + requested > ceiling) return { ok: false, reason: "ceiling_exceeded" };
      }
      for (const [key, requested] of checks) {
        const c = state.counters.get(key) || { held: 0n, charged: 0n, consumed: 0n, released: 0n };
        c.held += requested; state.counters.set(key, c);
      }
      if (!sess) state.sessions.set(req.gatewaySessionDigest, { subject: req.subjectDigest, project: req.projectId });
      const env = mkEnvelope(req, commitment);
      const row = { commitment, env, stateName: "held", revoked: false, keys: checks.map(([k]) => k) };
      state.envelopes.set(req.acquisitionKey, row);
      state.envById.set(env.envelopeId, row);
      return { ok: true, idempotentReplay: false, envelope: env };
    },
    async reconcile(req) {
      calls.reconcile++; calls.total++;
      if (state.reconciled.has(req.reconciliationKey)) return { ok: true };
      state.reconciled.add(req.reconciliationKey);
      const row = state.envById.get(req.envelopeId);
      if (row && row.stateName === "held") row.stateName = req.clean ? "reconciled" : "forfeited";
      return { ok: true };
    },
    async recordExecutionAdmission(req) {
      calls.recordExec++; calls.total++;
      const cur = state.execChildren.get(req.executionId);
      if (cur) return cur.requestDigest === req.requestDigest ? { ok: true } : { ok: false, reason: "conflict" };
      state.execChildren.set(req.executionId, { executionId: req.executionId, envelopeId: req.envelopeId, requestDigest: req.requestDigest, admissionRef: req.admissionRef });
      return { ok: true };
    },
    async recordProviderReservation(req) {
      calls.recordProv++; calls.total++;
      const cur = state.provChildren.get(req.reservationRef);
      if (cur) return cur.commitment === req.requestCommitment ? { ok: true } : { ok: false, reason: "conflict" };
      state.provChildren.set(req.reservationRef, { reservationRef: req.reservationRef, envelopeId: req.envelopeId, class: req.providerSpendClass, commitment: req.requestCommitment, money: req.moneyMicros, units: req.providerUnits, state: "open", charged: 0n });
      return { ok: true };
    },
    async settleProviderReservation(req) {
      calls.settleProv++; calls.total++;
      if (opts.settleFails) return { ok: false, reason: "store_error" }; // simulate a post-settlement persistence failure
      const cur = state.provChildren.get(req.reservationRef);
      if (!cur) return { ok: false, reason: "reservation_not_found" };
      if (cur.state !== "open") return { ok: true };
      cur.state = req.revoked ? "revoked" : "settled"; cur.charged = req.chargedMicros; cur.overCap = req.overCap; cur.excessUnits = req.excessUnits;
      return { ok: true };
    },
    async revokeEnvelope(req) {
      calls.revokeEnv++; calls.total++;
      if (opts.revokeFails) return { ok: false, reason: "store_error" }; // simulate a durable-revoke failure (P0-01 F)
      const row = state.envById.get(req.envelopeId);
      if (row) row.revoked = true;
      return { ok: true };
    },
    async reapOrphans(req) {
      calls.reap++; calls.total++;
      let reaped = 0;
      state.envById.forEach((row) => {
        if (row.stateName === "held" && row.env.expiresAtMs <= req.nowMs && !state.reconciled.has("reap_" + row.env.envelopeId)) {
          row.stateName = "forfeited"; state.reconciled.add("reap_" + row.env.envelopeId); reaped++;
        }
      });
      return { ok: true, reaped };
    },
    async readControl() {
      calls.readControl++; calls.total++;
      const c = state.control;
      return { globalEpoch: c.globalEpoch, projectEpoch: c.projectEpoch, controlVectorDigest: c.vector, enabled: c.enabled, killed: c.killed, observedAtMs: now() };
    },
  };
  return store;
}

// ── a fixture price catalog (explicit test rates — never production) ─────────
function mkCatalog(o) {
  o = o || {};
  const now = 1_000_000;
  const base = { currencyCode: o.currency || "USD", effectiveFromMs: 0, effectiveUntilMs: null, verifiedAtMs: 0, verificationExpiresAtMs: o.expiresAt == null ? now + 10_000_000 : o.expiresAt, sourceId: "test", sourceDigest: "sd", status: o.status || "active", serviceTier: null };
  const entries = [
    Object.assign({ provider: "openai", model: "gpt-5.6-terra", billingDimension: "reasoning_input_token", unitSize: 1n, rateMicros: 5n }, base),
    Object.assign({ provider: "openai", model: "gpt-5.6-terra", billingDimension: "reasoning_output_token", unitSize: 1n, rateMicros: 15n }, base),
    Object.assign({ provider: "openai", model: "gpt-live-transcribe", billingDimension: "realtime_audio_second", unitSize: 1n, rateMicros: 100n }, base),
  ];
  if (o.withTts) entries.push(Object.assign({ provider: "openai", model: "gpt-4o-mini-tts", billingDimension: "tts_output_token", unitSize: 1n, rateMicros: 20n }, base));
  return P.createPriceCatalog(o.version || "test.v1", o.entries || entries);
}
// worst-case: reasoning = 2000*5 + 2000*15 = 40000; transcription = 180*100 = 18000
const WC_REASONING = 40000n, WC_TRANSCRIPTION = 18000n;

function mkCore(o) {
  o = o || {};
  const c = o.clockObj || mkClock();
  const catalog = o.catalog || mkCatalog();
  // the durable store returns the SAME catalog version the lease will pin (P1-03 B).
  const store = o.store === null ? null : (o.store || mkFakeStore({ nowRef: c.state, catalogVersionId: catalog.version }));
  const core = AUTH.createBudgetCore({
    store, catalog, clock: c.clock, hashSession, mintRef, bootNonce: o.bootNonce || BOOT,
    ttsReservationRule: o.ttsRule || null, controlTimers: o.controlTimers || noTimers, controlIntervalMs: o.controlIntervalMs === undefined ? 5000 : o.controlIntervalMs,
  });
  return { core, store, clk: c };
}
async function prepProvider(core, gsid, amounts, over) {
  return core.prepareProviderLease(Object.assign({ gatewaySessionId: gsid, subjectDigest: "subjA", projectId: "projA", acquisitionKey: "acq_" + gsid + "_prov", maxControlStalenessMs: 15000, leaseTtlMs: 60000, amounts }, over || {}));
}
async function prepExec(core, gsid, admissions, over) {
  return core.prepareExecutionLease(Object.assign({ gatewaySessionId: gsid, subjectDigest: "subjA", projectId: "projA", acquisitionKey: "acq_" + gsid + "_exec", maxControlStalenessMs: 15000, leaseTtlMs: 60000, amounts: { moneyMicros: 0n, providerCalls: 0n, executionAdmissions: admissions } }, over || {}));
}
const provAmt = (money, calls) => ({ moneyMicros: money, providerCalls: calls, executionAdmissions: 0n });
function execInput(o) { o = o || {}; return { dispatchId: o.dispatchId || "di", executionId: o.executionId || "ex1", capabilityId: o.capabilityId || "READ_CURRENT_RESULTS", authorityClass: o.authorityClass || "READ", requestDigest: o.requestDigest || "rd1", issuedAtMonotonicMs: o.issuedAtMonotonicMs || 5, deadlineMonotonicMs: o.deadlineMonotonicMs || 30000 }; }
// a manually-driven control timer (captures the scheduled tick so a test can fire it)
function mkManualTimers() { const box = { pending: null }; return { box, timers: { set: (fn) => { box.pending = fn; return {}; }, clear: () => { box.pending = null; } } }; }
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r)); };
// build TWO cores sharing ONE store (+ one clock) — simulates process restart / lease renewal.
// build TWO cores sharing ONE store (+ one clock). By default a AND b share ONE boot nonce, so they
// model the SAME trusted boot instance (lease renewal / a second in-process core handle / P1-01
// cross-restart hydration within the same boot) — same-boot idempotent replay is retained. A
// cross-boot test injects distinct bootNonceA/bootNonceB to prove the anti-resurrection refusal.
function mkPair(o) { o = o || {}; const clk = o.clockObj || mkClock(); const catalog = o.catalog || mkCatalog(); const store = mkFakeStore({ nowRef: clk.state, catalogVersionId: o.catalogVersionId === undefined ? catalog.version : o.catalogVersionId, policy: o.policy }); const mk = (bn) => AUTH.createBudgetCore({ store, catalog, clock: clk.clock, hashSession, mintRef, bootNonce: bn, ttsReservationRule: o.ttsRule || null, controlTimers: noTimers, controlIntervalMs: 5000 }); return { a: mk(o.bootNonceA || o.bootNonce || BOOT), b: mk(o.bootNonceB || o.bootNonce || BOOT), store, clk }; }

const run = async () => {

// ═══════════════════════════ PRICING (pure) ════════════════════════════════
section("BUDGET01-A — integer money / cost formula (pure, no floating point)");
{
  eq(P.USD_MICROS_PER_USD, 1_000_000n, "A01 — 1 USD = 1,000,000 micros");
  const c1 = P.costMicros(2000n, 5n, 1n); ok(c1.ok && c1.micros === 10000n, "A02 — 2000×5/1 = 10000 micros");
  const c2 = P.costMicros(1n, 1n, 1000n); ok(c2.ok && c2.micros === 1n, "A03 — nonzero billable rounds UP (1/1000 → 1)");
  const c3 = P.costMicros(0n, 5n, 1n); ok(c3.ok && c3.micros === 0n, "A04 — zero units → 0 micros");
  const c4 = P.costMicros(1500n, 1n, 1000n); ok(c4.ok && c4.micros === 2n, "A05 — ceil(1500/1000) = 2");
  ok(!P.costMicros(-1n, 5n, 1n).ok, "A06 — negative units invalid");
  ok(!P.costMicros(5n, 5n, 0n).ok, "A07 — zero unitSize invalid");
  ok(!P.costMicros(P.MAX_INT64, 2n, 1n).ok, "A08 — overflow beyond int64 invalid");
  ok(P.parseInt64("42") === 42n && P.parseInt64("1.5") === null && P.parseInt64("-3") === null, "A09 — parseInt64 rejects non-integers/signs");
}

section("BUDGET01-B — versioned price catalog (verification-bounded)");
{
  const cat = mkCatalog();
  const e = cat.resolve({ provider: "openai", model: "gpt-5.6-terra", dimension: "reasoning_input_token" }, 1_000_000);
  ok(e && e.rateMicros === 5n, "B01 — resolves a usable entry");
  eq(P.EMPTY_PRICE_CATALOG.resolve({ provider: "openai", model: "gpt-5.6-terra", dimension: "reasoning_input_token" }, 1_000_000), null, "B02 — EMPTY production catalog resolves nothing");
  const stale = mkCatalog({ expiresAt: 500 });
  eq(stale.resolve({ provider: "openai", model: "gpt-5.6-terra", dimension: "reasoning_input_token" }, 1_000_000), null, "B03 — verification-expired entry is unusable");
  const revoked = mkCatalog({ status: "revoked" });
  eq(revoked.resolve({ provider: "openai", model: "gpt-5.6-terra", dimension: "reasoning_input_token" }, 1_000_000), null, "B04 — revoked entry is unusable");
  eq(cat.resolve({ provider: "openai", model: "gpt-4o-mini-tts", dimension: "tts_output_token" }, 1_000_000), null, "B05 — missing TTS entry resolves nothing (no guess)");
}

// ═══════════════════════════ DORMANCY / FAIL-CLOSED ═════════════════════════
section("BUDGET01-C — default dormancy / fail-closed");
{
  // no store → no lease/authority
  const { core } = mkCore({ store: null });
  const pr = await prepProvider(core, "gw.1", provAmt(100000n, 5n));
  ok(!pr.ok && pr.reason === "no_store", "C01 — no store ⇒ prepare fails (no_store)");
  const auth = core.providerSpendAuthority({ providerSpendClass: "REASONING", gatewaySessionId: "gw.1", providerTurnId: "pt" });
  eq(auth.reserve("gw.1", 4000), null, "C02 — no lease ⇒ provider reserve fails closed");
  const gate = core.executionAdmissionGate("gw.1");
  eq(gate.admit(execInput()).decision, "UNAVAILABLE", "C03 — no lease ⇒ execution admit UNAVAILABLE");
  core.stop();
}
{
  // store present but EMPTY catalog → provider reserve fails closed even with a lease
  const { core } = mkCore({ catalog: P.EMPTY_PRICE_CATALOG });
  await prepProvider(core, "gw.e", provAmt(100000n, 5n));
  const auth = core.providerSpendAuthority({ providerSpendClass: "REASONING", gatewaySessionId: "gw.e", providerTurnId: "pt" });
  eq(auth.reserve("gw.e", 4000), null, "C04 — empty catalog ⇒ provider reserve fails closed (no price)");
  core.stop();
}
{
  // incomplete TTS pricing → no TTS provider spend authority
  const { core } = mkCore({ catalog: mkCatalog({ withTts: false }), ttsRule: null });
  await prepProvider(core, "gw.t", provAmt(100000n, 5n));
  const tts = core.providerSpendAuthority({ providerSpendClass: "TTS", gatewaySessionId: "gw.t", providerTurnId: "pt" });
  eq(tts.reserve("gw.t", 2000), null, "C05 — TTS unavailable without a complete reservation rule (fail closed)");
  core.stop();
}

// ═══════════════════════════ EXECUTION_ADMISSION ═══════════════════════════
section("BUDGET01-D — execution admission (session-scoped; zero provider money)");
{
  const { core, store } = mkCore();
  await prepExec(core, "gw.x", 2n);
  const gate = core.executionAdmissionGate("gw.x");
  store._calls.total = 0; // reset — sync admit must make ZERO store calls
  const a1 = gate.admit(execInput({ executionId: "e1", requestDigest: "rdA" }));
  ok(a1.decision === "ADMITTED" && typeof a1.budgetAdmissionRef === "string" && a1.budgetAdmissionRef.length > 0, "D01 — valid admit returns a bound budgetAdmissionRef");
  eq(store._calls.total, 0, "D02 — the SYNC admit made ZERO store calls");
  const dup = gate.admit(execInput({ executionId: "e1", requestDigest: "rdA" }));
  ok(dup.decision === "ADMITTED" && dup.budgetAdmissionRef === a1.budgetAdmissionRef, "D03 — exact duplicate admit is inert (same ref, no second consumption)");
  const conflict = gate.admit(execInput({ executionId: "e1", requestDigest: "rdDIFF" }));
  eq(conflict.decision, "REFUSED", "D04 — same executionId + different requestDigest ⇒ REFUSED");
  const digestReuse = gate.admit(execInput({ executionId: "e2", requestDigest: "rdA" }));
  eq(digestReuse.decision, "REFUSED", "D05 — requestDigest reused under a different executionId ⇒ REFUSED");
  const a2 = gate.admit(execInput({ executionId: "e3", requestDigest: "rdB" }));
  eq(a2.decision, "ADMITTED", "D06 — a second distinct execution admits (quota 2)");
  const a3 = gate.admit(execInput({ executionId: "e4", requestDigest: "rdC" }));
  eq(a3.decision, "REFUSED", "D07 — exhausted execution quota ⇒ REFUSED");
  // execution consumed ZERO provider money: the provider lease is separate/never touched
  const view = core.inspect("gw.x");
  ok(view.execution && view.execution.consumedAdmissions === "2" && view.execution.freeAdmissions === "0", "D08 — 2 admissions consumed, 0 free");
  ok(view.provider === null, "D09 — execution admission created NO provider (money) lease");
  core.stop();
}

// ═══════════════════════════ PROVIDER_SPEND ═══════════════════════════════
section("BUDGET01-E — provider spend (call-bound; worst-case reserve; conservative settle)");
{
  const { core, store } = mkCore();
  await prepProvider(core, "gw.p", provAmt(100000n, 5n));
  store._calls.total = 0;
  const rAuth = core.providerSpendAuthority({ providerSpendClass: "REASONING", gatewaySessionId: "gw.p", providerTurnId: "pt1" });
  const id1 = rAuth.reserve("gw.p", 4000);
  ok(typeof id1 === "string" && id1, "E01 — reasoning reserve returns an id");
  eq(store._calls.total, 0, "E02 — the SYNC reserve made ZERO store calls");
  const v1 = core.inspect("gw.p").provider;
  eq(v1.openReservedMoneyMicros, WC_REASONING.toString(), "E03 — worst-case reasoning reserve = 40000 micros held open");
  eq(v1.freeMoneyMicros, (100000n - WC_REASONING).toString(), "E04 — free money reduced by the worst case");
  // duplicate reserve on the SAME call-bound facade → same id; different estimate → conflict
  eq(rAuth.reserve("gw.p", 4000), id1, "E05 — exact duplicate reserve ⇒ same id (no second consumption)");
  eq(rAuth.reserve("gw.p", 9999), null, "E06 — a different estimate on the same facade ⇒ conflict (null)");
  // caller cannot change class/model/price: a wrong sessionKey is refused
  eq(rAuth.reserve("gw.OTHER", 4000), null, "E07 — a mismatched sessionKey is refused (call binding enforced)");
  // reasoning settle retains FULL (total_tokens can't be split — no fabricated split)
  rAuth.settle(id1, 1234);
  const v2 = core.inspect("gw.p").provider;
  eq(v2.chargedMoneyMicros, WC_REASONING.toString(), "E08 — reasoning settle retains the FULL reservation (no split)");
  eq(v2.chargedCalls, "1", "E09 — the provider call is charged");
  // duplicate settle inert
  rAuth.settle(id1, 5678);
  eq(core.inspect("gw.p").provider.chargedMoneyMicros, WC_REASONING.toString(), "E10 — duplicate settle is inert");
  core.stop();
}
{
  // transcription: exact settle when a trusted actual ≤ reservation (single dimension)
  const { core } = mkCore();
  await prepProvider(core, "gw.tr", provAmt(100000n, 5n));
  const tAuth = core.providerSpendAuthority({ providerSpendClass: "TRANSCRIPTION", gatewaySessionId: "gw.tr", providerTurnId: "pt" });
  const id = tAuth.reserve("gw.tr", 9000);
  eq(core.inspect("gw.tr").provider.openReservedMoneyMicros, WC_TRANSCRIPTION.toString(), "E11 — transcription worst-case = 18000 micros (180s)");
  tAuth.settle(id, 90); // 90 seconds actual → 90*100 = 9000 charged; 9000 released
  const v = core.inspect("gw.tr").provider;
  eq(v.chargedMoneyMicros, "9000", "E12 — transcription exact settle charges the actual (90s → 9000)");
  eq(v.freeMoneyMicros, (100000n - WC_TRANSCRIPTION + 9000n).toString(), "E13 — the unused reservation is released back to the lease");
  core.stop();
}
{
  // actual ABOVE reservation → safety path: revoke lease + retain full (never under-account)
  const { core } = mkCore();
  await prepProvider(core, "gw.ov", provAmt(100000n, 5n));
  const tAuth = core.providerSpendAuthority({ providerSpendClass: "TRANSCRIPTION", gatewaySessionId: "gw.ov", providerTurnId: "pt" });
  const id = tAuth.reserve("gw.ov", 9000);
  tAuth.settle(id, 999999); // actual seconds > 180 reserved units
  const v = core.inspect("gw.ov").provider;
  eq(v.chargedMoneyMicros, WC_TRANSCRIPTION.toString(), "E14 — actual-over-reservation retains FULL (never under-account)");
  ok(v.revoked === true, "E15 — actual-over-reservation REVOKES the lease (safety path)");
  // a genuinely NEW provider call (a FRESH call-bound facade — the production pattern) is refused on the revoked lease
  const tAuth2 = core.providerSpendAuthority({ providerSpendClass: "TRANSCRIPTION", gatewaySessionId: "gw.ov", providerTurnId: "pt2" });
  eq(tAuth2.reserve("gw.ov", 9000), null, "E16 — a revoked lease refuses a further (fresh) reserve");
  core.stop();
}
{
  // a 03A budgetAdmissionRef cannot authorize provider money (separate leases; reserve takes no ref)
  const { core } = mkCore();
  await prepExec(core, "gw.sep", 5n);
  const gate = core.executionAdmissionGate("gw.sep");
  const adm = gate.admit(execInput());
  ok(adm.decision === "ADMITTED", "E17 — execution admitted");
  const pAuth = core.providerSpendAuthority({ providerSpendClass: "REASONING", gatewaySessionId: "gw.sep", providerTurnId: "pt" });
  // there is NO provider lease for this session (only an execution lease), so reserve fails closed —
  // the admission ref can never be turned into provider money.
  eq(pAuth.reserve("gw.sep", 4000), null, "E18 — a 03A admission ref cannot authorize provider money (no provider lease)");
  core.stop();
}

// ═══════════════════════════ TRUSTED SESSION IDENTITY ══════════════════════
section("BUDGET01-F — gateway-owned session identity (browser id never budget authority)");
{
  const { core } = mkCore();
  const G1 = "gw.G1", BROWSER_A = "browser-session-A", G2 = "gw.G2";
  await prepProvider(core, G1, provAmt(100000n, 5n));
  const authG1 = core.providerSpendAuthority({ providerSpendClass: "REASONING", gatewaySessionId: G1, providerTurnId: "pt" });
  ok(typeof authG1.reserve(G1, 4000) === "string", "F01 — G1 (gatewaySessionId) owns the durable budget session");
  // a browser-owned session id is NOT a budget authority — a facade bound to it has no lease
  const authBrowser = core.providerSpendAuthority({ providerSpendClass: "REASONING", gatewaySessionId: BROWSER_A, providerTurnId: "pt" });
  eq(authBrowser.reserve(BROWSER_A, 4000), null, "F02 — a browser sessionId is NOT a budget session (no lease ⇒ fail closed)");
  // reserving on G1's facade with a browser key can't reach G1's lease
  eq(authG1.reserve(BROWSER_A, 4000), null, "F03 — a browser key cannot reset/consume G1 (session binding enforced)");
  // a NEW gatewaySessionId is a NEW per-session scope (its own lease, own free balance)
  await prepProvider(core, G2, provAmt(50000n, 5n), { acquisitionKey: "acq_G2_prov" });
  const authG2 = core.providerSpendAuthority({ providerSpendClass: "REASONING", gatewaySessionId: G2, providerTurnId: "pt" });
  ok(typeof authG2.reserve(G2, 4000) === "string", "F04 — a new gatewaySessionId (G2) gets a new per-session quota scope");
  ok(core.inspect(G1).provider.freeMoneyMicros !== core.inspect(G2).provider.freeMoneyMicros, "F05 — G1 and G2 leases are independent scopes");
  // the provider facade + execution gate bind to the SAME gateway session authority
  await prepExec(core, G1, 3n, { acquisitionKey: "acq_G1_exec" });
  const gateG1 = core.executionAdmissionGate(G1);
  eq(gateG1.admit(execInput()).decision, "ADMITTED", "F06 — the execution gate binds to the same gateway session (G1) authority");
  core.stop();
}

// ═══════════════════════════ CONTROL / REVOCATION ══════════════════════════
section("BUDGET01-G — control epoch / kill / freshness (fail-closed)");
{
  // pure decision matrix
  const pinned = { globalEpoch: 5n, projectEpoch: 5n, controlVectorDigest: "vX", maxControlStalenessMs: 1000, leaseExpiryMs: 9_999_999 };
  eq(CTL.decideControl(pinned, { globalEpoch: 5n, projectEpoch: 5n, controlVectorDigest: "vX", enabled: true, killed: false, observedAtMs: 1 }).kind, "REFRESH", "G01 — same epoch + enabled ⇒ REFRESH");
  eq(CTL.decideControl(pinned, { globalEpoch: 6n, projectEpoch: 5n, controlVectorDigest: "vY", enabled: true, killed: false, observedAtMs: 1 }).kind, "REVOKE", "G02 — advanced epoch ⇒ REVOKE");
  eq(CTL.decideControl(pinned, { globalEpoch: 5n, projectEpoch: 5n, controlVectorDigest: "vX", enabled: true, killed: true, observedAtMs: 1 }).kind, "REVOKE", "G03 — killed ⇒ REVOKE");
  eq(CTL.decideControl(pinned, { globalEpoch: 5n, projectEpoch: 5n, controlVectorDigest: "vX", enabled: false, killed: false, observedAtMs: 1 }).kind, "REVOKE", "G04 — disabled ⇒ REVOKE");
  eq(CTL.decideControl(pinned, { globalEpoch: 4n, projectEpoch: 5n, controlVectorDigest: "vZ", enabled: true, killed: false, observedAtMs: 1 }).kind, "IGNORE", "G05 — regressing epoch ⇒ IGNORE (never refresh/revive)");
  // the async watcher wiring (revoke-only; outage → no refresh)
  let revoked = null, freshAt = -1;
  const src = { snap: { globalEpoch: 5n, projectEpoch: 5n, controlVectorDigest: "vX", enabled: true, killed: false, observedAtMs: 42 } };
  const w = CTL.createControlWatcher({ source: { read: async () => src.snap }, pinned, intervalMs: 5000, timers: noTimers, onFresh: (t) => { freshAt = t; }, onRevoke: (r) => { revoked = r; } });
  eq((await w.pollOnce()).kind, "REFRESH", "G06 — watcher poll on current control ⇒ REFRESH");
  eq(freshAt, 42, "G07 — watcher refreshed freshness");
  src.snap = null; freshAt = -1;
  eq((await w.pollOnce()).kind, "IGNORE", "G08 — a source outage ⇒ IGNORE (NO refresh — cannot grant indefinite authority)");
  eq(freshAt, -1, "G09 — outage did NOT refresh freshness");
  src.snap = { globalEpoch: 6n, projectEpoch: 5n, controlVectorDigest: "vNew", enabled: true, killed: false, observedAtMs: 50 };
  await w.pollOnce();
  eq(revoked, "epoch_advanced", "G10 — an advanced epoch REVOKES via the watcher");
  w.stop();
}
{
  // post-issuance kill blocks NEW allocations
  const store = mkFakeStore({});
  const { core } = mkCore({ store });
  store._state.control.killed = true;
  const pr = await prepProvider(core, "gw.kill", provAmt(100000n, 5n));
  ok(!pr.ok && pr.reason === "control_killed", "G11 — post-kill: a NEW lease acquisition is refused (control_killed)");
  core.stop();
}
{
  // higher epoch revokes a pinned lease → sync reserve fails closed; kill releases nothing by itself
  const { core } = mkCore();
  await prepProvider(core, "gw.rev", provAmt(100000n, 5n));
  const before = core.inspect("gw.rev").provider;
  core.revokeSession("gw.rev", "control_epoch_advanced");
  const after = core.inspect("gw.rev").provider;
  ok(after.revoked === true, "G12 — revokeSession marks the lease revoked");
  eq(after.chargedMoneyMicros, before.chargedMoneyMicros, "G13 — revocation by itself releases/charges NOTHING (only blocks new work)");
  const auth = core.providerSpendAuthority({ providerSpendClass: "REASONING", gatewaySessionId: "gw.rev", providerTurnId: "pt" });
  eq(auth.reserve("gw.rev", 4000), null, "G14 — a revoked lease refuses new provider reserve");
  core.stop();
}
{
  // stale control heartbeat fails closed (freshness deadline passed)
  const clk = mkClock(1_000_000);
  const { core } = mkCore({ clockObj: clk });
  await prepProvider(core, "gw.stale", provAmt(100000n, 5n), { maxControlStalenessMs: 1000, leaseTtlMs: 60000 });
  const auth = core.providerSpendAuthority({ providerSpendClass: "REASONING", gatewaySessionId: "gw.stale", providerTurnId: "pt" });
  ok(typeof auth.reserve("gw.stale", 4000) === "string", "G15 — fresh lease admits a reserve");
  clk.adv(2000); // exceed maxControlStalenessMs with no watcher refresh
  const auth2 = core.providerSpendAuthority({ providerSpendClass: "REASONING", gatewaySessionId: "gw.stale", providerTurnId: "pt2" });
  eq(auth2.reserve("gw.stale", 4000), null, "G16 — a stale control heartbeat FAILS CLOSED (no sync I/O to refresh)");
  core.stop();
}
{
  // lease expiry fails closed
  const clk = mkClock(1_000_000);
  const { core } = mkCore({ clockObj: clk });
  await prepProvider(core, "gw.exp", provAmt(100000n, 5n), { maxControlStalenessMs: 60000, leaseTtlMs: 5000 });
  clk.adv(6000);
  const auth = core.providerSpendAuthority({ providerSpendClass: "REASONING", gatewaySessionId: "gw.exp", providerTurnId: "pt" });
  eq(auth.reserve("gw.exp", 4000), null, "G17 — an expired lease fails closed");
  core.stop();
}

// ═══════════════════════════ PRICING ROLLOVER / TTS ════════════════════════
section("BUDGET01-H — price catalog rollover pins the lease; TTS with an injected rule");
{
  // a lease pins the catalog SNAPSHOT at prepare — a later core-catalog swap can't re-price it.
  const clk = mkClock();
  const cat1 = mkCatalog({ version: "v1" });
  const store = mkFakeStore({ nowRef: clk.state, catalogVersionId: "v1" });
  const core = AUTH.createBudgetCore({ store, catalog: cat1, clock: clk.clock, hashSession, mintRef, bootNonce: BOOT, controlTimers: noTimers, controlIntervalMs: 5000 });
  await core.prepareProviderLease({ gatewaySessionId: "gw.roll", subjectDigest: "s", projectId: "projA", acquisitionKey: "acq_roll", maxControlStalenessMs: 15000, leaseTtlMs: 60000, amounts: provAmt(100000n, 5n) });
  const auth = core.providerSpendAuthority({ providerSpendClass: "REASONING", gatewaySessionId: "gw.roll", providerTurnId: "pt" });
  const id = auth.reserve("gw.roll", 4000);
  eq(core.inspect("gw.roll").provider.openReservedMoneyMicros, WC_REASONING.toString(), "H01 — priced against the pinned catalog (v1)");
  ok(typeof id === "string", "H02 — reserve under pinned catalog ok");
  core.stop();
}
{
  // TTS becomes available ONLY when a complete reservation rule + a matching catalog entry are injected.
  const { core } = mkCore({ catalog: mkCatalog({ withTts: true }), ttsRule: { dimension: "tts_output_token", units: 1000n, serviceTier: null } });
  await prepProvider(core, "gw.tts", provAmt(100000n, 5n));
  const tts = core.providerSpendAuthority({ providerSpendClass: "TTS", gatewaySessionId: "gw.tts", providerTurnId: "pt" });
  const id = tts.reserve("gw.tts", 2000);
  ok(typeof id === "string", "H03 — TTS reserve works with an injected rule + catalog entry (1000 tokens × 20 = 20000)");
  eq(core.inspect("gw.tts").provider.openReservedMoneyMicros, "20000", "H04 — TTS worst-case = rule.units × rate");
  core.stop();
}

// ═══════════════════════════ RECONCILIATION / FORFEIT ══════════════════════
section("BUDGET01-I — reconciliation (clean) + crash forfeit (no quota restored)");
{
  const { core, store } = mkCore();
  await prepProvider(core, "gw.rc", provAmt(100000n, 5n));
  const auth = core.providerSpendAuthority({ providerSpendClass: "TRANSCRIPTION", gatewaySessionId: "gw.rc", providerTurnId: "pt" });
  const id = auth.reserve("gw.rc", 9000); auth.settle(id, 90); // charged 9000, released rest
  store._calls.reconcile = 0;
  await core.reconcileSession("gw.rc"); // clean
  eq(store._calls.reconcile, 1, "I01 — clean teardown calls store.reconcile exactly once");
  eq(core.inspect("gw.rc").provider, null, "I02 — the lease is cleared after reconcile");
}
{
  // crash forfeits ALL remaining held; a later reserve on a NEW lease is a fresh scope (no restore)
  const { core, store } = mkCore();
  await prepExec(core, "gw.crash", 5n);
  const gate = core.executionAdmissionGate("gw.crash");
  gate.admit(execInput({ executionId: "e1", requestDigest: "r1" }));
  gate.admit(execInput({ executionId: "e2", requestDigest: "r2" }));
  store._calls.reconcile = 0;
  await core.reconcileSession("gw.crash", { crash: true });
  eq(store._calls.reconcile, 1, "I03 — crash teardown reconciles (forfeit) exactly once");
  eq(core.inspect("gw.crash").execution, null, "I04 — the execution lease is gone after crash forfeit (quota not restored)");
}

// ═══════════════════════════ PRIVACY / NO SECRETS ═════════════════════════
section("BUDGET01-J — privacy: no raw content / secret in source or persisted shapes");
{
  const migPath = path.join(__dirname, "../../migrations/2026-09-16-live-ai-budget-01-dpbel-foundation.sql");
  // (a) NO hardcoded SECRET VALUE anywhere in the budget source or migration. (The words
  //     "audio"/"transcript"/"prompt" appear legitimately as billing-dimension identifiers /
  //     class names / comments — those are NOT content and NOT secrets, so they are not scanned.)
  const secretValuePatterns = [/sk-[a-z0-9]{16,}/i, /rzp_(live|test)_[a-z0-9]/i, /bearer\s+[a-z0-9._-]{12,}/i, /postgres(ql)?:\/\/[^\s:]+:[^\s@]+@/i, /password\s*[:=]\s*['"][^'"]+['"]/i, /api[_-]?key\s*[:=]\s*['"][^'"]+['"]/i];
  let clean = true; const hits = [];
  for (const f of FILES.concat([migPath])) {
    const p = f === migPath ? f : path.join(REPO, "server/voice-gateway", f);
    const txt = fs.readFileSync(p, "utf8");
    for (const re of secretValuePatterns) { if (re.test(txt)) { clean = false; hits.push(`${path.basename(p)} :: ${re}`); } }
  }
  ok(clean, "J01 — NO hardcoded secret VALUE (api key / bearer / rzp / DSN password) in budget source or migration" + (clean ? "" : " — " + hits.join(", ")));
  // (b) the DURABLE schema stores ONLY digests/ids/amounts/enums — NO raw-content or credential COLUMNS.
  //     Scan the SQL with comments stripped (comments legitimately say "no credential is created").
  const migRaw = fs.readFileSync(migPath, "utf8");
  const mig = migRaw.split("\n").map((ln) => ln.replace(/--.*$/, "")).join("\n");
  const forbiddenCols = [/\braw_audio\b/i, /\btranscript_text\b/i, /\braw_transcript\b/i, /\bprompt_text\b/i, /\bresponse_text\b/i, /\bmodel_response\b/i, /\bapi_key\b/i, /\baccess_token\b/i, /\bcookie\b/i, /\bauth_header\b/i, /\bpassword\b/i, /\bcredential\b/i, /\bdsn\b/i];
  let noRawCols = true; const colHits = [];
  for (const re of forbiddenCols) { if (re.test(mig)) { noRawCols = false; colHits.push(String(re)); } }
  ok(noRawCols, "J02 — the durable schema has NO raw-content/credential columns" + (noRawCols ? "" : " — " + colHits.join(", ")));
  // the migration seeds NO policy / catalog / control / credential row
  ok(!/\bINSERT\s+INTO\b/i.test(mig), "J03 — the migration performs NO INSERT (no seeded policy/catalog/control/credential)");
}

// ═══════════════════════════ P0-01 — durable envelope replay / resurrection ═
section("BUDGET01-L — P0-01: durable envelope replay never resurrects/extends/replenishes");
{
  // repeated prepare while a LIVE local lease exists ⇒ idempotent no-op, local ledger untouched.
  const { core } = mkCore();
  await prepExec(core, "gw.L1", 2n);
  core.executionAdmissionGate("gw.L1").admit(execInput({ executionId: "e1", requestDigest: "d1" }));
  const before = core.inspect("gw.L1").execution.freeAdmissions;
  const again = await prepExec(core, "gw.L1", 2n);
  ok(again.ok === true, "L01 — a repeated prepare with a live lease is an idempotent no-op (ok)");
  eq(core.inspect("gw.L1").execution.freeAdmissions, before, "L02 — a replay after partial consumption does NOT replenish the local balance");
  core.stop();
}
{
  // a revoked local lease can NEVER be resurrected by a re-prepare.
  const { core } = mkCore();
  await prepProvider(core, "gw.L3", provAmt(100000n, 5n));
  core.revokeSession("gw.L3", "control_epoch_advanced");
  const re = await prepProvider(core, "gw.L3", provAmt(100000n, 5n));
  ok(!re.ok && re.reason === "lease_revoked", "L03 — a revoked local lease refuses a re-prepare (cannot resurrect)");
  core.stop();
}
{
  // replay after CLEAN reconcile ⇒ terminal (a NEW core sharing the durable store).
  const pair = mkPair();
  await prepProvider(pair.a, "gw.L4", provAmt(100000n, 5n), { acquisitionKey: "acqL4" });
  await pair.a.reconcileSession("gw.L4"); // clean → durable 'reconciled'
  const rp = await prepProvider(pair.b, "gw.L4", provAmt(100000n, 5n), { acquisitionKey: "acqL4" });
  ok(!rp.ok && rp.reason === "envelope_terminal", "L04 — replay after clean reconcile ⇒ envelope_terminal (never resurrected)");
  pair.a.stop(); pair.b.stop();
}
{
  // replay after crash FORFEIT ⇒ forfeited.
  const pair = mkPair();
  await prepExec(pair.a, "gw.L5", 3n, { acquisitionKey: "acqL5" });
  await pair.a.reconcileSession("gw.L5", { crash: true }); // forfeit
  const rp = await prepExec(pair.b, "gw.L5", 3n, { acquisitionKey: "acqL5" });
  ok(!rp.ok && rp.reason === "envelope_forfeited", "L05 — replay after crash forfeit ⇒ envelope_forfeited");
  pair.a.stop(); pair.b.stop();
}
{
  // replay after EXPIRY ⇒ expired; a replay can NEVER extend the lease lifetime.
  const pair = mkPair();
  await prepProvider(pair.a, "gw.L6", provAmt(100000n, 5n), { acquisitionKey: "acqL6", maxControlStalenessMs: 5000, leaseTtlMs: 5000 });
  const exp1 = pair.a.inspect("gw.L6").provider.leaseExpiryMs;
  pair.clk.adv(6000); // past expiry
  const rp = await prepProvider(pair.b, "gw.L6", provAmt(100000n, 5n), { acquisitionKey: "acqL6", maxControlStalenessMs: 5000, leaseTtlMs: 5000 });
  ok(!rp.ok && rp.reason === "envelope_expired", "L06 — replay after expiry ⇒ envelope_expired (never resurrected)");
  // before expiry: a replay reconstructs the ORIGINAL expiry, never now+ttl.
  const pair2 = mkPair();
  await prepProvider(pair2.a, "gw.L7", provAmt(100000n, 5n), { acquisitionKey: "acqL7", maxControlStalenessMs: 30000, leaseTtlMs: 60000 });
  const e1 = pair2.a.inspect("gw.L7").provider.leaseExpiryMs;
  pair2.clk.adv(10000);
  const rp2 = await prepProvider(pair2.b, "gw.L7", provAmt(100000n, 5n), { acquisitionKey: "acqL7", maxControlStalenessMs: 30000, leaseTtlMs: 60000 });
  ok(rp2.ok, "L07a — replay before expiry succeeds");
  eq(pair2.b.inspect("gw.L7").provider.leaseExpiryMs, e1, "L07b — the replay reconstructs the ORIGINAL expiry (never extends lifetime)");
  pair.a.stop(); pair.b.stop(); pair2.a.stop(); pair2.b.stop();
}
{
  // same acquisition key + a DIFFERENT canonical commitment (different amounts) ⇒ identity conflict.
  const pair = mkPair();
  await prepProvider(pair.a, "gw.L8", provAmt(100000n, 5n), { acquisitionKey: "acqL8" });
  const rp = await prepProvider(pair.b, "gw.L8", provAmt(200000n, 5n), { acquisitionKey: "acqL8" });
  ok(!rp.ok && rp.reason === "acquisition_conflict", "L08 — same key + different commitment ⇒ acquisition_conflict (identity)");
  pair.a.stop(); pair.b.stop();
}
{
  // replay hydration reconstructs the CHARGED balance — it does not restore released counters.
  const pair = mkPair();
  await prepProvider(pair.a, "gw.L9", provAmt(100000n, 5n), { acquisitionKey: "acqL9" });
  const tAuth = pair.a.providerSpendAuthority({ providerSpendClass: "TRANSCRIPTION", gatewaySessionId: "gw.L9", providerTurnId: "turnL9" });
  const id = tAuth.reserve("gw.L9", 9000); tAuth.settle(id, 90); // charged 9000, released the rest
  await pair.a.persistPending("gw.L9");
  const rp = await prepProvider(pair.b, "gw.L9", provAmt(100000n, 5n), { acquisitionKey: "acqL9" });
  ok(rp.ok, "L09a — replay hydration prepare succeeds");
  const v = pair.b.inspect("gw.L9").provider;
  ok(v.chargedMoneyMicros === "9000" && v.freeMoneyMicros === (100000n - 9000n).toString(), "L09b — hydration reconstructs charged (9000); released quota is NOT restored as fresh authority");
  pair.a.stop(); pair.b.stop();
}

// ═══════════════════════════ P0-02 — session/subject/project + watcher binding ═
section("BUDGET01-M — P0-02: immutable ownership + exact watcher binding");
{
  const pair = mkPair();
  await prepProvider(pair.a, "gw.M2", provAmt(100000n, 5n), { acquisitionKey: "acqM2a", subjectDigest: "subjA", projectId: "projA" });
  // same digest, DIFFERENT subject ⇒ reject
  const diffSubj = await prepProvider(pair.b, "gw.M2", provAmt(100000n, 5n), { acquisitionKey: "acqM2b", subjectDigest: "subjB", projectId: "projA" });
  ok(!diffSubj.ok && diffSubj.reason === "ownership_conflict", "M01 — same session digest + different SUBJECT ⇒ ownership_conflict");
  // same digest, DIFFERENT project ⇒ reject
  const diffProj = await prepProvider(pair.b, "gw.M2", provAmt(100000n, 5n), { acquisitionKey: "acqM2c", subjectDigest: "subjA", projectId: "projZ" });
  ok(!diffProj.ok && diffProj.reason === "ownership_conflict", "M02 — same session digest + different PROJECT ⇒ ownership_conflict");
  pair.a.stop(); pair.b.stop();
}
{
  // valid reuse: same session/subject/project, a new acquisition after teardown.
  const pair = mkPair();
  await prepProvider(pair.a, "gw.M3", provAmt(50000n, 5n), { acquisitionKey: "acqM3a" });
  await pair.a.reconcileSession("gw.M3");
  const reuse = await prepProvider(pair.a, "gw.M3", provAmt(50000n, 5n), { acquisitionKey: "acqM3b" });
  ok(reuse.ok, "M03 — same gateway session + same subject/project ⇒ a fresh acquisition is valid reuse");
  pair.a.stop();
}
{
  // watcher bound to the EXACT lease: an advanced control epoch revokes THIS lease within bound.
  const mt = mkManualTimers();
  const { core, store } = mkCore({ controlTimers: mt.timers });
  await prepProvider(core, "gw.M4", provAmt(100000n, 5n));
  store._state.control.globalEpoch = 2n; // control advances (project-scoped read)
  mt.box.pending(); await flush();
  ok(core.inspect("gw.M4").provider.revoked === true, "M04 — the bound watcher REVOKES its lease on an advanced control epoch");
  core.stop();
}
{
  // a REPLACED lease cannot be refreshed/revoked by an OLD watcher (bound to the old envelopeId).
  const mt = mkManualTimers();
  const { core } = mkCore({ controlTimers: mt.timers });
  await prepProvider(core, "gw.M5", provAmt(100000n, 5n), { acquisitionKey: "acqM5a" });
  const oldFn = mt.box.pending;                                   // capture the OLD watcher tick
  const oldEnvId = core.inspect("gw.M5").provider.envelopeId;
  await core.reconcileSession("gw.M5");                           // teardown → stop old watcher
  await prepProvider(core, "gw.M5", provAmt(100000n, 5n), { acquisitionKey: "acqM5b" }); // NEW lease + NEW watcher
  const newEnvId = core.inspect("gw.M5").provider.envelopeId;
  ok(oldEnvId !== newEnvId, "M05 — a replaced lease has a NEW envelope id");
  if (oldFn) { oldFn(); await flush(); }                          // fire the STALE old-watcher tick
  ok(core.inspect("gw.M5").provider.revoked === false, "M06 — the STALE old watcher cannot refresh/revoke the replaced lease");
  core.stop();
}

// ═══════════════════════════ P1-01 — authoritative child idempotency ═══════
section("BUDGET01-N — P1-01: child idempotency across facade recreation + durable hydration");
{
  const { core } = mkCore();
  await prepExec(core, "gw.N1", 3n);
  const g1 = core.executionAdmissionGate("gw.N1");
  const r1 = g1.admit(execInput({ executionId: "eN", requestDigest: "dN" }));
  const g2 = core.executionAdmissionGate("gw.N1");                // facade RECREATION
  const r2 = g2.admit(execInput({ executionId: "eN", requestDigest: "dN" }));
  ok(r1.decision === "ADMITTED" && r2.budgetAdmissionRef === r1.budgetAdmissionRef, "N01 — same execution across facade recreation ⇒ same ref (no 2nd consumption)");
  await prepProvider(core, "gw.N1p", provAmt(100000n, 5n));
  const p1 = core.providerSpendAuthority({ providerSpendClass: "REASONING", gatewaySessionId: "gw.N1p", providerTurnId: "turnN" });
  const idA = p1.reserve("gw.N1p", 4000);
  const p2 = core.providerSpendAuthority({ providerSpendClass: "REASONING", gatewaySessionId: "gw.N1p", providerTurnId: "turnN" }); // recreation, same turn
  eq(p2.reserve("gw.N1p", 4000), idA, "N02 — same provider call (providerTurnId) across facade recreation ⇒ same id");
  const p3 = core.providerSpendAuthority({ providerSpendClass: "REASONING", gatewaySessionId: "gw.N1p", providerTurnId: "turnN" });
  eq(p3.reserve("gw.N1p", 9999), null, "N03 — same providerTurnId + a different estimate ⇒ conflict (null)");
  core.stop();
}
{
  // durable hydration across a process restart (two cores share the store): duplicate = inert.
  const pair = mkPair();
  await prepProvider(pair.a, "gw.N4", provAmt(100000n, 5n), { acquisitionKey: "acqN4" });
  const a = pair.a.providerSpendAuthority({ providerSpendClass: "REASONING", gatewaySessionId: "gw.N4", providerTurnId: "turnN4" });
  const idN4 = a.reserve("gw.N4", 4000); a.settle(idN4, null); // reasoning settle → retain full (charged 40000)
  await pair.a.persistPending("gw.N4");
  const rp = await prepProvider(pair.b, "gw.N4", provAmt(100000n, 5n), { acquisitionKey: "acqN4" });
  ok(rp.ok, "N04a — restart replay prepare succeeds (hydrated)");
  const freeAfterHydrate = pair.b.inspect("gw.N4").provider.freeMoneyMicros;
  const b = pair.b.providerSpendAuthority({ providerSpendClass: "REASONING", gatewaySessionId: "gw.N4", providerTurnId: "turnN4" });
  const dupId = b.reserve("gw.N4", 4000);                          // same call after restart
  eq(dupId, null, "N04b — a hydrated/terminal provider child NEVER authorizes a 2nd call (reserve ⇒ null)");
  eq(pair.b.inspect("gw.N4").provider.freeMoneyMicros, freeAfterHydrate, "N04c — the hydrated duplicate consumes NO fresh authority");
  pair.a.stop(); pair.b.stop();
}
{
  // crash-ambiguous durable child (an OPEN, never-settled reservation) ⇒ treated CHARGED (no fresh authority).
  const pair = mkPair();
  await prepProvider(pair.a, "gw.N5", provAmt(100000n, 5n), { acquisitionKey: "acqN5" });
  const a = pair.a.providerSpendAuthority({ providerSpendClass: "TRANSCRIPTION", gatewaySessionId: "gw.N5", providerTurnId: "turnN5" });
  a.reserve("gw.N5", 9000);                                        // reserved, NEVER settled (crash)
  await pair.a.persistProviderReservation("gw.N5", "turnN5");      // durable reservation stays 'open'
  const rp = await prepProvider(pair.b, "gw.N5", provAmt(100000n, 5n), { acquisitionKey: "acqN5" });
  ok(!rp.ok && rp.reason === "envelope_open_child", "N05 — an unresolved OPEN durable child ⇒ envelope NON-REPLAYABLE (no fresh provider authority, P0-01 §5)");
  eq(pair.b.inspect("gw.N5").provider, null, "N05b — no lease is created on a refused replay");
  pair.a.stop(); pair.b.stop();
}
{
  // a conflicting durable execution child ⇒ persistPending fails closed (revokes the lease).
  const pair = mkPair();
  const acq = await prepExec(pair.a, "gw.N6", 3n, { acquisitionKey: "acqN6" });
  ok(acq.ok, "N06a — execution lease prepared");
  const envId = pair.a.inspect("gw.N6").execution.envelopeId;
  await pair.store.recordExecutionAdmission({ envelopeId: envId, gatewaySessionDigest: hashSession("gw.N6"), executionId: "eC", requestDigest: "PRIOR", admissionRef: "r0" });
  pair.a.executionAdmissionGate("gw.N6").admit(execInput({ executionId: "eC", requestDigest: "LATER" })); // in-memory ok (different from durable)
  await pair.a.persistPending("gw.N6");                            // durable conflict (PRIOR≠LATER) ⇒ revoke
  ok(pair.a.inspect("gw.N6").execution.revoked === true, "N06b — a durable child conflict fails closed (lease revoked)");
  pair.a.stop(); pair.b.stop();
}

// ═══════════════════════════ P1-02 — provider call binding / coverage ══════
section("BUDGET01-O — P1-02: non-empty trusted provider-call id + transcription via DPBEL");
{
  const { core } = mkCore({ catalog: mkCatalog({ withTts: true }), ttsRule: { dimension: "tts_output_token", units: 1000n, serviceTier: null } });
  await prepProvider(core, "gw.O", provAmt(1000000n, 50n));
  const empty = core.providerSpendAuthority({ providerSpendClass: "REASONING", gatewaySessionId: "gw.O", providerTurnId: "" });
  eq(empty.reserve("gw.O", 4000), null, "O01 — an EMPTY providerTurnId is refused (fail closed)");
  const rr = core.providerSpendAuthority({ providerSpendClass: "REASONING", gatewaySessionId: "gw.O", providerTurnId: "ptR" });
  ok(typeof rr.reserve("gw.O", 4000) === "string", "O02 — reasoning with a bound non-empty providerTurnId reserves");
  const tt = core.providerSpendAuthority({ providerSpendClass: "TTS", gatewaySessionId: "gw.O", providerTurnId: "ptT" });
  ok(typeof tt.reserve("gw.O", 2000) === "string", "O03 — TTS with a bound non-empty providerTurnId reserves");
  const tx = core.providerSpendAuthority({ providerSpendClass: "TRANSCRIPTION", gatewaySessionId: "gw.O", providerTurnId: "ptX" });
  ok(typeof tx.reserve("gw.O", 9000) === "string", "O04 — transcription reserves through the SAME call-bound DPBEL provider facade");
  core.stop();
}
{
  // all three classes fail closed with a store but NO provider lease.
  const { core } = mkCore({ catalog: mkCatalog({ withTts: true }), ttsRule: { dimension: "tts_output_token", units: 1000n, serviceTier: null } });
  for (const cls of ["REASONING", "TRANSCRIPTION", "TTS"]) {
    const a = core.providerSpendAuthority({ providerSpendClass: cls, gatewaySessionId: "gw.noLease", providerTurnId: "pt" });
    eq(a.reserve("gw.noLease", 1000), null, "O05 — " + cls + " fails closed without a DPBEL provider lease");
  }
  core.stop();
  // structural proof (P1-02 D): the realtime mic path routes transcription through the DPBEL
  // TRANSCRIPTION facade (never the legacy budget) when the core is wired.
  const idx = fs.readFileSync(path.join(REPO, "server/voice-gateway/index.ts"), "utf8");
  ok(/ctx\.budgetCore[\s\S]{0,220}providerSpendClass:\s*"TRANSCRIPTION"/.test(idx), "O06 — index.ts realtime mic reserves via the DPBEL TRANSCRIPTION facade (no legacy bypass)");
  const orch = fs.readFileSync(path.join(REPO, "server/voice-gateway/live-ai-orchestrator.ts"), "utf8");
  ok(/const providerTurnId = genId\("pt"\);[\s\S]{0,220}reserve\(session, RESERVE_REASONING_UNITS, "REASONING", providerTurnId\)/.test(orch), "O07 — reasoning mints a providerTurnId BEFORE the reserve and binds it");
}

// ═══════════════════════════ P1-03 — monetary / catalog validation ═════════
section("BUDGET01-P — P1-03: USD-only, catalog-version pin, upward-safe settle, explicit excess");
{
  // non-USD catalog ⇒ provider spend fails closed.
  const { core } = mkCore({ catalog: mkCatalog({ currency: "EUR" }) });
  await prepProvider(core, "gw.P1", provAmt(100000n, 5n));
  const a = core.providerSpendAuthority({ providerSpendClass: "REASONING", gatewaySessionId: "gw.P1", providerTurnId: "pt" });
  eq(a.reserve("gw.P1", 4000), null, "P01 — a non-USD catalog entry is refused (USD-only provider authority)");
  core.stop();
}
{
  // a lease pinned to catalog A cannot spend with a DIFFERENT catalog version.
  const clk = mkClock(); const catalog = mkCatalog({ version: "catA" });
  const store = mkFakeStore({ nowRef: clk.state, catalogVersionId: "catB" }); // durable version ≠ in-memory version
  const core = AUTH.createBudgetCore({ store, catalog, clock: clk.clock, hashSession, mintRef, bootNonce: BOOT, controlTimers: noTimers, controlIntervalMs: 5000 });
  const pr = await prepProvider(core, "gw.P2", provAmt(100000n, 5n));
  ok(!pr.ok && pr.reason === "catalog_version_mismatch", "P02 — a lease whose in-memory catalog version ≠ the envelope's version is refused");
  core.stop();
}
{
  // a null durable catalog version ⇒ provider lease refused (no catalog to pin).
  const clk = mkClock(); const catalog = mkCatalog({ version: "catA" });
  const store = mkFakeStore({ nowRef: clk.state, catalogVersionId: null });
  const core = AUTH.createBudgetCore({ store, catalog, clock: clk.clock, hashSession, mintRef, bootNonce: BOOT, controlTimers: noTimers, controlIntervalMs: 5000 });
  const pr = await prepProvider(core, "gw.P3", provAmt(100000n, 5n));
  ok(!pr.ok && pr.reason === "catalog_version_mismatch", "P03 — a null durable catalog version refuses a provider lease (no pin)");
  core.stop();
}
{
  // a FRACTIONAL actual rounds UPWARD (never Math.trunc downward).
  const { core } = mkCore();
  await prepProvider(core, "gw.P4", provAmt(100000n, 5n));
  const t = core.providerSpendAuthority({ providerSpendClass: "TRANSCRIPTION", gatewaySessionId: "gw.P4", providerTurnId: "pt" });
  const id = t.reserve("gw.P4", 9000); t.settle(id, 90.3); // 90.3s → ceil 91 → 91×100 = 9100 (NOT 9000)
  eq(core.inspect("gw.P4").provider.chargedMoneyMicros, "9100", "P04 — a fractional actual rounds UPWARD (91s → 9100), never downward");
  core.stop();
}
{
  // an UNSAFE actual (NaN / Infinity / negative) retains the FULL reservation (never under-account).
  for (const bad of [NaN, Infinity, -5, Number.MAX_SAFE_INTEGER + 10]) {
    const { core } = mkCore();
    await prepProvider(core, "gw.P5", provAmt(100000n, 5n));
    const t = core.providerSpendAuthority({ providerSpendClass: "TRANSCRIPTION", gatewaySessionId: "gw.P5", providerTurnId: "pt" });
    const id = t.reserve("gw.P5", 9000); t.settle(id, bad);
    eq(core.inspect("gw.P5").provider.chargedMoneyMicros, "18000", "P05 — an unsafe actual (" + String(bad) + ") retains the FULL reservation");
    core.stop();
  }
}
{
  // actual ABOVE reservation ⇒ explicit excess incident + revoke (never under-account, never mint).
  const { core } = mkCore();
  await prepProvider(core, "gw.P6", provAmt(100000n, 5n));
  const t = core.providerSpendAuthority({ providerSpendClass: "TRANSCRIPTION", gatewaySessionId: "gw.P6", providerTurnId: "pt" });
  const id = t.reserve("gw.P6", 9000); t.settle(id, 200); // 200s > 180 reserved
  const v = core.inspect("gw.P6").provider;
  ok(v.chargedMoneyMicros === "18000" && v.revoked === true && v.excessCount === 1, "P06 — actual > reservation ⇒ retain full + REVOKE + explicit excess incident");
  core.stop();
}
{
  // reasoning retains the FULL reservation (no fabricated input/output split).
  const { core } = mkCore();
  await prepProvider(core, "gw.P7", provAmt(100000n, 5n));
  const r = core.providerSpendAuthority({ providerSpendClass: "REASONING", gatewaySessionId: "gw.P7", providerTurnId: "pt" });
  const id = r.reserve("gw.P7", 4000); r.settle(id, 1234);
  eq(core.inspect("gw.P7").provider.chargedMoneyMicros, WC_REASONING.toString(), "P07 — reasoning retains the FULL reservation (no guessed token split)");
  core.stop();
}

// ═══════════════════════════ P1-04 — subject/day + canonical commitment ════
section("BUDGET01-Q — P1-04: subject/day scope + canonical commitment (DB semantics in the PG suite)");
{
  // canonical commitment is collision-resistant / unambiguous (length-prefixed, not delimiter-joined).
  const c1 = STOREMOD.canonicalAcquisitionCommitment({ a: "x", b: "yz" });
  const c2 = STOREMOD.canonicalAcquisitionCommitment({ a: "xy", b: "z" });
  ok(c1 !== c2, "Q01 — canonical commitment is unambiguous (naive concatenation would collide)");
  eq(STOREMOD.canonicalAcquisitionCommitment({ a: "x", b: "yz" }), c1, "Q02 — canonical commitment is deterministic (same fields ⇒ same commitment)");
}
{
  // subject/day ceiling: the SAME subject across DIFFERENT sessions counts together; a different subject is isolated.
  const clk = mkClock(); const catalog = mkCatalog();
  const store = mkFakeStore({ nowRef: clk.state, catalogVersionId: catalog.version, policy: { session_money_ceiling_micros: 10n ** 12n, session_provider_calls: 1000n, session_execution_admissions: 1000n, subject_day: 100000n, project_day: 10n ** 12n, project_month: 10n ** 12n, global_day: 10n ** 12n } });
  const core = AUTH.createBudgetCore({ store, catalog, clock: clk.clock, hashSession, mintRef, bootNonce: BOOT, controlTimers: noTimers, controlIntervalMs: 5000 });
  const one = await prepProvider(core, "gw.Q3a", provAmt(60000n, 5n), { acquisitionKey: "q3a", subjectDigest: "subjSHARED" });
  ok(one.ok, "Q03 — first subject/day acquisition (60000) succeeds under the 100000 ceiling");
  const two = await prepProvider(core, "gw.Q3b", provAmt(60000n, 5n), { acquisitionKey: "q3b", subjectDigest: "subjSHARED" });
  ok(!two.ok && two.reason === "ceiling_exceeded", "Q04 — the SAME subject across a DIFFERENT session counts together (60000+60000 > 100000)");
  const other = await prepProvider(core, "gw.Q3c", provAmt(60000n, 5n), { acquisitionKey: "q3c", subjectDigest: "subjOTHER" });
  ok(other.ok, "Q05 — a DIFFERENT subject is isolated (its own subject/day counter)");
  core.stop();
}

// ═══════════════════════════ P1-05 — crash / revocation lifecycle ══════════
section("BUDGET01-R — P1-05: monotonic clock, no invented defaults, orphan reaper");
{
  // a local clock regression FAILS CLOSED (latched).
  const clk = mkClock(1_000_000);
  const { core } = mkCore({ clockObj: clk });
  await prepProvider(core, "gw.R1", provAmt(100000n, 5n));
  const a = core.providerSpendAuthority({ providerSpendClass: "REASONING", gatewaySessionId: "gw.R1", providerTurnId: "pt1" });
  ok(typeof a.reserve("gw.R1", 4000) === "string", "R01a — a reserve at monotonic time succeeds");
  clk.set(999_000); // clock regresses below the last observed monotonic point
  const a2 = core.providerSpendAuthority({ providerSpendClass: "REASONING", gatewaySessionId: "gw.R1", providerTurnId: "pt2" });
  eq(a2.reserve("gw.R1", 4000), null, "R01b — a local clock regression FAILS CLOSED");
  core.stop();
}
{
  // no invented poll interval — an unsupplied controlIntervalMs ⇒ prepare is UNAVAILABLE.
  const { core } = mkCore({ controlIntervalMs: 0 });
  const pr = await prepProvider(core, "gw.R2", provAmt(100000n, 5n));
  ok(!pr.ok && pr.reason === "no_control_interval", "R02 — an unsupplied control poll interval fails closed (no invented default)");
  core.stop();
  // config: no invented lease/staleness/poll defaults (source proof — config.ts is not compiled here).
  const cfg = fs.readFileSync(path.join(REPO, "server/voice-gateway/config.ts"), "utf8");
  ok(/DEFAULT_BUDGET_BINDING[\s\S]{0,160}leaseTtlMs:\s*0,\s*maxControlStalenessMs:\s*0,\s*controlPollIntervalMs:\s*0/.test(cfg), "R03 — config invents NO production timing defaults (all 0 ⇒ unavailable)");
  ok(!/leaseTtlMs:\s*60_000/.test(cfg) && !/maxControlStalenessMs:\s*15_000/.test(cfg), "R04 — the old invented 60s/15s defaults are removed");
}
{
  // orphan reaper forfeits a held-but-expired envelope WITHOUT the dead process; idempotent.
  const pair = mkPair();
  await prepProvider(pair.a, "gw.R5", provAmt(100000n, 5n), { acquisitionKey: "acqR5", maxControlStalenessMs: 5000, leaseTtlMs: 5000 });
  // (the "process" dies — no reconcileSession) — advance the durable clock past expiry and reap.
  pair.clk.adv(6000);
  const reap1 = await pair.store.reapOrphans({ nowMs: pair.clk.state.t });
  ok(reap1.ok && reap1.reaped >= 1, "R05 — the orphan reaper forfeits a held-but-expired envelope (no dead-process call)");
  const reap2 = await pair.store.reapOrphans({ nowMs: pair.clk.state.t });
  eq(reap2.reaped, 0, "R06 — the reaper is idempotent (a second pass reaps 0)");
  const rp = await prepProvider(pair.b, "gw.R5", provAmt(100000n, 5n), { acquisitionKey: "acqR5", maxControlStalenessMs: 5000, leaseTtlMs: 5000 });
  ok(!rp.ok && rp.reason === "envelope_forfeited", "R07 — a reaped envelope is durably forfeited (a replay never resurrects it)");
  pair.a.stop(); pair.b.stop();
}

// ═══════════════════════════ FINAL RESIDUAL — P0-01 durable revocation ═════
section("BUDGET01-S — P0-01 residual: durable revocation survives process loss");
{
  // explicit revokeSessionDurable → durable envelope revoke → replay refused on a NEW core.
  const pair = mkPair();
  await prepProvider(pair.a, "gw.S1", provAmt(100000n, 5n), { acquisitionKey: "acqS1" });
  await pair.a.revokeSessionDurable("gw.S1", "explicit");
  ok(pair.a.inspect("gw.S1").provider.revoked === true, "S01 — revokeSessionDurable marks the local lease revoked");
  const rp = await prepProvider(pair.b, "gw.S1", provAmt(100000n, 5n), { acquisitionKey: "acqS1" });
  ok(!rp.ok && rp.reason === "envelope_revoked", "S02 — a durably-revoked envelope refuses replay on a new core (process-loss safe)");
  pair.a.stop(); pair.b.stop();
}
{
  // watcher-observed control KILL → durable revoke (manual timer) → replay refused on a new core.
  const clk = mkClock(); const catalog = mkCatalog();
  const store = mkFakeStore({ nowRef: clk.state, catalogVersionId: catalog.version });
  const mt = mkManualTimers();
  const a = AUTH.createBudgetCore({ store, catalog, clock: clk.clock, hashSession, mintRef, bootNonce: BOOT, controlTimers: mt.timers, controlIntervalMs: 5000 });
  const b = AUTH.createBudgetCore({ store, catalog, clock: clk.clock, hashSession, mintRef, bootNonce: BOOT, controlTimers: noTimers, controlIntervalMs: 5000 });
  await a.prepareProviderLease({ gatewaySessionId: "gw.S3", subjectDigest: "s", projectId: "projA", acquisitionKey: "acqS3", maxControlStalenessMs: 15000, leaseTtlMs: 60000, amounts: provAmt(100000n, 5n) });
  store._state.control.killed = true;
  mt.box.pending(); await flush();
  ok(a.inspect("gw.S3").provider.revoked === true, "S03 — a watcher-observed kill revokes the local lease");
  const rp = await b.prepareProviderLease({ gatewaySessionId: "gw.S3", subjectDigest: "s", projectId: "projA", acquisitionKey: "acqS3", maxControlStalenessMs: 15000, leaseTtlMs: 60000, amounts: provAmt(100000n, 5n) });
  ok(!rp.ok && rp.reason === "envelope_revoked", "S04 — a watcher kill DURABLY revokes the envelope (replay refused)");
  a.stop(); b.stop();
}
{
  // over-cap safety revoke → persistPending durably revokes → replay refused on a new core.
  const pair = mkPair();
  await prepProvider(pair.a, "gw.S5", provAmt(100000n, 5n), { acquisitionKey: "acqS5" });
  const t = pair.a.providerSpendAuthority({ providerSpendClass: "TRANSCRIPTION", gatewaySessionId: "gw.S5", providerTurnId: "turnS5" });
  const id = t.reserve("gw.S5", 9000); t.settle(id, 999); // over-cap → local revoke
  ok(pair.a.inspect("gw.S5").provider.revoked === true, "S05 — an over-cap settle revokes the local lease");
  await pair.a.persistPending("gw.S5");
  const rp = await prepProvider(pair.b, "gw.S5", provAmt(100000n, 5n), { acquisitionKey: "acqS5" });
  ok(!rp.ok && rp.reason === "envelope_revoked", "S06 — persistPending durably revokes an over-cap-revoked lease (replay refused)");
  pair.a.stop(); pair.b.stop();
}
{
  const { store } = mkCore();
  const acq = await store.acquireEnvelope({ budgetClass: "PROVIDER_SPEND", gatewaySessionDigest: "dS7", subjectDigest: "s", projectId: "projA", acquisitionKey: "acqS7", amounts: provAmt(1000n, 1n), maxControlStalenessMs: 15000, leaseTtlMs: 60000, bootNonce: BOOT });
  ok((await store.revokeEnvelope({ envelopeId: acq.envelope.envelopeId, reason: "x" })).ok, "S07 — revokeEnvelope succeeds");
  ok((await store.revokeEnvelope({ envelopeId: acq.envelope.envelopeId, reason: "x" })).ok, "S08 — revokeEnvelope is idempotent");
}
{
  // a durable-revoke FAILURE never restores local authority (P0-01 F).
  const clk = mkClock(); const catalog = mkCatalog();
  const store = mkFakeStore({ nowRef: clk.state, catalogVersionId: catalog.version, revokeFails: true });
  const core = AUTH.createBudgetCore({ store, catalog, clock: clk.clock, hashSession, mintRef, bootNonce: BOOT, controlTimers: noTimers, controlIntervalMs: 5000 });
  await core.prepareProviderLease({ gatewaySessionId: "gw.S9", subjectDigest: "s", projectId: "projA", acquisitionKey: "acqS9", maxControlStalenessMs: 15000, leaseTtlMs: 60000, amounts: provAmt(100000n, 5n) });
  await core.revokeSessionDurable("gw.S9", "explicit"); // durable revoke FAILS in the store
  ok(core.inspect("gw.S9").provider.revoked === true, "S09 — on a durable-revoke failure the local lease STAYS revoked");
  eq(core.providerSpendAuthority({ providerSpendClass: "REASONING", gatewaySessionId: "gw.S9", providerTurnId: "pt" }).reserve("gw.S9", 4000), null, "S10 — a durable-revoke failure never restores local authority");
  core.stop();
}

// ═══════════════════════════ P0-02 live-lease fast-path revalidation ════════
section("BUDGET01-T — P0-02 residual: live-lease fast path revalidates immutable identity");
{
  const { core, store } = mkCore();
  await prepProvider(core, "gw.T", provAmt(100000n, 5n), { acquisitionKey: "acqT", subjectDigest: "subjA", projectId: "projA", maxControlStalenessMs: 15000, leaseTtlMs: 60000 });
  const acqCalls = store._calls.acquire;
  ok((await prepProvider(core, "gw.T", provAmt(100000n, 5n), { acquisitionKey: "acqT", subjectDigest: "subjA", projectId: "projA", maxControlStalenessMs: 15000, leaseTtlMs: 60000 })).ok, "T01 — an identical repeated request ⇒ idempotent success");
  eq(store._calls.acquire, acqCalls, "T02 — the idempotent fast path touches the store ZERO times");
  const s = await prepProvider(core, "gw.T", provAmt(100000n, 5n), { acquisitionKey: "acqT", subjectDigest: "subjB", projectId: "projA", maxControlStalenessMs: 15000, leaseTtlMs: 60000 });
  ok(!s.ok && s.reason === "lease_request_mismatch", "T03 — same key + changed SUBJECT ⇒ reject");
  const p = await prepProvider(core, "gw.T", provAmt(100000n, 5n), { acquisitionKey: "acqT", subjectDigest: "subjA", projectId: "projZ", maxControlStalenessMs: 15000, leaseTtlMs: 60000 });
  ok(!p.ok && p.reason === "lease_request_mismatch", "T04 — same key + changed PROJECT ⇒ reject");
  const am = await prepProvider(core, "gw.T", provAmt(200000n, 5n), { acquisitionKey: "acqT", subjectDigest: "subjA", projectId: "projA", maxControlStalenessMs: 15000, leaseTtlMs: 60000 });
  ok(!am.ok && am.reason === "lease_request_mismatch", "T05 — same key + changed AMOUNTS/quota ⇒ reject");
  const tm = await prepProvider(core, "gw.T", provAmt(100000n, 5n), { acquisitionKey: "acqT", subjectDigest: "subjA", projectId: "projA", maxControlStalenessMs: 10000, leaseTtlMs: 60000 });
  ok(!tm.ok && tm.reason === "lease_request_mismatch", "T06 — same key + changed TIMING bound ⇒ reject");
  eq(store._calls.acquire, acqCalls, "T07 — every rejected fast-path revalidation touches the store ZERO times (no mutation)");
  eq(core.inspect("gw.T").provider.freeMoneyMicros, (100000n).toString(), "T08 — the live lease is unchanged by the rejections");
  core.stop();
}

// ═══════════════════════════ P1-01 5A durable persist barrier ══════════════
section("BUDGET01-U — P1-01 5A: durable provider persist barrier before invocation");
{
  const { core } = mkCore();
  await prepProvider(core, "gw.U", provAmt(100000n, 5n));
  const a = core.providerSpendAuthority({ providerSpendClass: "REASONING", gatewaySessionId: "gw.U", providerTurnId: "turnU" });
  ok(typeof a.reserve("gw.U", 4000) === "string", "U01 — reserve ok");
  ok((await core.persistProviderReservation("gw.U", "turnU")) === true, "U02 — persistProviderReservation durably records the child (true)");
  ok((await core.persistProviderReservation("gw.U", "turnU")) === true, "U03 — persistProviderReservation is idempotent");
  core.stop();
}
{
  // a durable provider conflict ⇒ persist barrier FALSE (⇒ NO provider invocation) + lease revoked.
  const clk = mkClock(); const catalog = mkCatalog();
  const store = mkFakeStore({ nowRef: clk.state, catalogVersionId: catalog.version });
  const core = AUTH.createBudgetCore({ store, catalog, clock: clk.clock, hashSession, mintRef, bootNonce: BOOT, controlTimers: noTimers, controlIntervalMs: 5000 });
  await core.prepareProviderLease({ gatewaySessionId: "gw.U2", subjectDigest: "s", projectId: "projA", acquisitionKey: "acqU2", maxControlStalenessMs: 15000, leaseTtlMs: 60000, amounts: provAmt(100000n, 5n) });
  const envId = core.inspect("gw.U2").provider.envelopeId;
  core.providerSpendAuthority({ providerSpendClass: "REASONING", gatewaySessionId: "gw.U2", providerTurnId: "turnU2" }).reserve("gw.U2", 4000);
  await store.recordProviderReservation({ envelopeId: envId, reservationRef: "turnU2", providerSpendClass: "REASONING", requestCommitment: "DIFFERENT", moneyMicros: 1n, providerUnits: 1n });
  ok((await core.persistProviderReservation("gw.U2", "turnU2")) === false, "U04 — a durable provider conflict ⇒ persist barrier FALSE (no provider invocation)");
  ok(core.inspect("gw.U2").provider.revoked === true, "U05 — a durable provider conflict fails closed (lease revoked)");
  core.stop();
}
{
  // structural proof: the production integration actually calls the persist barrier before a provider call.
  const orch = fs.readFileSync(path.join(REPO, "server/voice-gateway/live-ai-orchestrator.ts"), "utf8");
  ok(/await persistProviderChild\(session, providerTurnId\)/.test(orch) && /await persistProviderChild\(session, ttsProviderTurnId\)/.test(orch), "U06 — the orchestrator awaits the persist barrier before reasoning + TTS provider calls");
  const idx = fs.readFileSync(path.join(REPO, "server/voice-gateway/index.ts"), "utf8");
  ok(/await ctx\.budgetCore\.persistProviderReservation\(session\.gatewaySessionId, micProviderTurnId\)/.test(idx), "U07 — index.ts awaits the persist barrier before the realtime transcription negotiation");
}

// ═══════════════════════════ P1-03 orchestrator over-cap unmasking ═════════
section("BUDGET01-V — P1-03 residual: orchestrator passes the true over-cap actual (no masking)");
{
  const { core } = mkCore();
  await prepProvider(core, "gw.V", provAmt(100000n, 5n));
  const t = core.providerSpendAuthority({ providerSpendClass: "TRANSCRIPTION", gatewaySessionId: "gw.V", providerTurnId: "turnV" });
  const id = t.reserve("gw.V", 9000); t.settle(id, 250); // 250 > 180 reserved — a TRUE over-cap actual
  const v = core.inspect("gw.V").provider;
  ok(v.excessCount === 1 && v.revoked === true, "V01 — a true over-cap actual reaches the core → excess incident + revoke");
  core.stop();
  const orch = fs.readFileSync(path.join(REPO, "server/voice-gateway/live-ai-orchestrator.ts"), "utf8");
  ok(/toSettle = \(actual !== null && Number\.isFinite\(actual\) && actual >= 0\) \? actual : null;/.test(orch), "V02 — the DPBEL settle passes the true validated actual (never masks over-cap to null)");
}

// ═══════════════════════════ P1-05 monotonic guard coverage ════════════════
section("BUDGET01-W — P1-05 residual: monotonic guard covers all authority reads");
{
  // regression before the FIRST execution admission.
  const clk = mkClock(1_000_000); const { core } = mkCore({ clockObj: clk });
  await prepExec(core, "gw.W1", 3n);
  clk.set(999_000);
  eq(core.executionAdmissionGate("gw.W1").admit(execInput()).decision, "UNAVAILABLE", "W01 — a clock regression before the first admission fails closed (UNAVAILABLE)");
  core.stop();
}
{
  // regression during a provider reserve; a later-forward clock never resurrects.
  const clk = mkClock(1_000_000); const { core } = mkCore({ clockObj: clk });
  await prepProvider(core, "gw.W2", provAmt(100000n, 5n));
  ok(typeof core.providerSpendAuthority({ providerSpendClass: "REASONING", gatewaySessionId: "gw.W2", providerTurnId: "pt1" }).reserve("gw.W2", 4000) === "string", "W02a — reserve ok at monotonic time");
  clk.set(998_000);
  eq(core.providerSpendAuthority({ providerSpendClass: "REASONING", gatewaySessionId: "gw.W2", providerTurnId: "pt2" }).reserve("gw.W2", 4000), null, "W02b — a regression during a provider reserve fails closed");
  clk.set(2_000_000);
  eq(core.providerSpendAuthority({ providerSpendClass: "REASONING", gatewaySessionId: "gw.W2", providerTurnId: "pt3" }).reserve("gw.W2", 4000), null, "W03 — a later-forward clock never resurrects a regressed lease");
  core.stop();
}
{
  // regression during a watcher freshness refresh (markFresh) latches fail-closed.
  const clk = mkClock(1_000_000); const catalog = mkCatalog();
  const store = mkFakeStore({ nowRef: clk.state, catalogVersionId: catalog.version });
  const mt = mkManualTimers();
  const core = AUTH.createBudgetCore({ store, catalog, clock: clk.clock, hashSession, mintRef, bootNonce: BOOT, controlTimers: mt.timers, controlIntervalMs: 5000 });
  await core.prepareProviderLease({ gatewaySessionId: "gw.W4", subjectDigest: "s", projectId: "projA", acquisitionKey: "acqW4", maxControlStalenessMs: 15000, leaseTtlMs: 60000, amounts: provAmt(100000n, 5n) });
  clk.set(999_000);
  mt.box.pending(); await flush(); // watcher onFresh → markFresh → monotonicNow null → latch + revoke
  ok(core.inspect("gw.W4").provider.revoked === true, "W04 — a regression during a watcher refresh latches fail-closed (lease revoked)");
  core.stop();
}

// ═══════════════════════════ P0-01A watcher awaits durable revoke ══════════
section("BUDGET01-X — P0-01A: watcher REVOKE awaits the durable revoke");
{
  let resolveRevoke; const revokeP = new Promise((r) => { resolveRevoke = r; });
  let revokedReason = null;
  const pinned = { globalEpoch: 5n, projectEpoch: 5n, controlVectorDigest: "vX", maxControlStalenessMs: 1000, leaseExpiryMs: 9_999_999 };
  const w = CTL.createControlWatcher({
    source: { read: async () => ({ globalEpoch: 6n, projectEpoch: 5n, controlVectorDigest: "vNew", enabled: true, killed: false, observedAtMs: 1 }) },
    pinned, intervalMs: 5000, timers: noTimers, onFresh: () => {},
    onRevoke: async (r) => { revokedReason = r; await revokeP; },
  });
  const pollP = w.pollOnce(); let settled = false; pollP.then(() => { settled = true; });
  await flush();
  ok(revokedReason === "epoch_advanced" && settled === false, "X01 — a REVOKE poll stays PENDING while the durable revoke is unresolved (not fire-and-forget)");
  resolveRevoke(); await pollP;
  ok(settled === true, "X02 — the poll completes only once the durable revoke resolves");
  w.stop();
}
{
  let revokedReason = null;
  const pinned = { globalEpoch: 5n, projectEpoch: 5n, controlVectorDigest: "vX", maxControlStalenessMs: 1000, leaseExpiryMs: 9_999_999 };
  const w = CTL.createControlWatcher({
    source: { read: async () => ({ globalEpoch: 6n, projectEpoch: 5n, controlVectorDigest: "vNew", enabled: true, killed: false, observedAtMs: 1 }) },
    pinned, intervalMs: 5000, timers: noTimers, onFresh: () => {},
    onRevoke: async (r) => { revokedReason = r; throw new Error("durable revoke failed"); },
  });
  const d = await w.pollOnce();
  ok(d.kind === "REVOKE" && revokedReason === "epoch_advanced", "X03 — a rejected durable revoke is swallowed; the watcher stays safe (authority never restored)");
  w.stop();
}
{
  const auth = fs.readFileSync(path.join(REPO, "server/voice-gateway/live-ai-budget-authority.ts"), "utf8");
  ok(/onRevoke: \(reason\) => onControlRevoke\(kind, digest, `control_\$\{reason\}`, envelopeId, gen\),/.test(auth), "X04 — the authority watcher onRevoke RETURNS onControlRevoke(...) (awaited, not fire-and-forget void)");
  const ctl = fs.readFileSync(path.join(REPO, "server/voice-gateway/live-ai-budget-control.ts"), "utf8");
  ok(/await deps\.onRevoke\(decision\.reason\)/.test(ctl), "X05 — pollOnce awaits deps.onRevoke on a REVOKE decision");
}

// ═══════════════════════════ P0-01B post-settlement durable barrier ════════
section("BUDGET01-Y — P0-01B: post-settlement durable barrier");
{
  const { core } = mkCore();
  await prepProvider(core, "gw.Y", provAmt(100000n, 5n));
  const t = core.providerSpendAuthority({ providerSpendClass: "TRANSCRIPTION", gatewaySessionId: "gw.Y", providerTurnId: "turnY" });
  const id = t.reserve("gw.Y", 9000); await core.persistProviderReservation("gw.Y", "turnY"); t.settle(id, 90);
  ok((await core.persistProviderSettlement("gw.Y", "turnY")) === true, "Y01 — post-settlement barrier durably flushes a normal settlement (true)");
  core.stop();
}
{
  const { core } = mkCore();
  await prepProvider(core, "gw.Y2", provAmt(100000n, 5n));
  const t = core.providerSpendAuthority({ providerSpendClass: "TRANSCRIPTION", gatewaySessionId: "gw.Y2", providerTurnId: "turnY2" });
  const id = t.reserve("gw.Y2", 9000); await core.persistProviderReservation("gw.Y2", "turnY2"); t.settle(id, 999); // over-cap → local revoke
  ok((await core.persistProviderSettlement("gw.Y2", "turnY2")) === true, "Y02 — post-settlement barrier durably persists an over-cap settlement + revoke");
  ok(core.inspect("gw.Y2").provider.revoked === true, "Y03 — the over-cap lease stays revoked");
  core.stop();
}
{
  const clk = mkClock(); const catalog = mkCatalog();
  const store = mkFakeStore({ nowRef: clk.state, catalogVersionId: catalog.version, settleFails: true });
  const core = AUTH.createBudgetCore({ store, catalog, clock: clk.clock, hashSession, mintRef, bootNonce: BOOT, controlTimers: noTimers, controlIntervalMs: 5000 });
  await core.prepareProviderLease({ gatewaySessionId: "gw.Y3", subjectDigest: "s", projectId: "projA", acquisitionKey: "acqY3", maxControlStalenessMs: 15000, leaseTtlMs: 60000, amounts: provAmt(100000n, 5n) });
  const t = core.providerSpendAuthority({ providerSpendClass: "TRANSCRIPTION", gatewaySessionId: "gw.Y3", providerTurnId: "turnY3" });
  const id = t.reserve("gw.Y3", 9000); await core.persistProviderReservation("gw.Y3", "turnY3"); t.settle(id, 90);
  ok((await core.persistProviderSettlement("gw.Y3", "turnY3")) === false, "Y04 — a post-settlement persistence failure ⇒ false");
  ok(core.inspect("gw.Y3").provider.revoked === true, "Y05 — an unresolved post-settlement persistence leaves the lease fail-closed (revoked)");
  eq(core.providerSpendAuthority({ providerSpendClass: "REASONING", gatewaySessionId: "gw.Y3", providerTurnId: "z" }).reserve("gw.Y3", 4000), null, "Y06 — no fresh provider authority after an unresolved settlement");
  core.stop();
}
{
  // production call-order proof: reserve → persist reservation → provider → settle → persist settlement.
  const orch = fs.readFileSync(path.join(REPO, "server/voice-gateway/live-ai-orchestrator.ts"), "utf8");
  ok((orch.match(/await persistProviderSettlementBarrier\(session, providerTurnId\)/g) || []).length >= 2, "Y07 — the orchestrator awaits the post-settlement barrier on reasoning success + failure paths");
  ok(/await persistProviderSettlementBarrier\(session, ttsProviderTurnId\)/.test(orch), "Y08 — the orchestrator awaits the post-settlement barrier on the TTS path");
  const idx = fs.readFileSync(path.join(REPO, "server/voice-gateway/index.ts"), "utf8");
  ok(/await ctx\.budgetCore\.persistProviderSettlement\(session\.gatewaySessionId, micProviderTurnId\)/.test(idx), "Y09 — index.ts awaits the post-settlement barrier for realtime transcription");
}

// ═══════════════════════════ P0-01 FROZEN-LIFECYCLE — trusted boot-instance binding ═══
section("BUDGET01-Z — P0-01 frozen-lifecycle: boot/instance anti-resurrection + control revalidation");
{
  // Z-A — SAME boot + exact replay remains valid (same-process idempotency retained, §6).
  const pair = mkPair(); // a and b share ONE boot nonce (same trusted boot instance)
  await prepProvider(pair.a, "gw.ZA", provAmt(100000n, 5n), { acquisitionKey: "acqZA" });
  const rp = await prepProvider(pair.b, "gw.ZA", provAmt(100000n, 5n), { acquisitionKey: "acqZA" });
  ok(rp.ok, "Z01 — same-boot exact replay remains valid (§6 idempotency retained)");
  pair.a.stop(); pair.b.stop();
}
{
  // Z-B — NEW boot + old HELD envelope refuses (anti-resurrection, §5).
  const pair = mkPair({ bootNonceA: "boot-A", bootNonceB: "boot-B" });
  await prepProvider(pair.a, "gw.ZB", provAmt(100000n, 5n), { acquisitionKey: "acqZB" }); // held under boot-A
  const rp = await prepProvider(pair.b, "gw.ZB", provAmt(100000n, 5n), { acquisitionKey: "acqZB" });
  ok(!rp.ok && rp.reason === "envelope_previous_boot", "Z02 — a NEW boot refuses replay of an old HELD envelope (envelope_previous_boot)");
  eq(pair.b.inspect("gw.ZB").provider, null, "Z03 — a cross-boot refusal creates NO local lease");
  eq(pair.b.providerSpendAuthority({ providerSpendClass: "REASONING", gatewaySessionId: "gw.ZB", providerTurnId: "p" }).reserve("gw.ZB", 4000), null, "Z04 — a cross-boot refusal grants NO fresh provider authority (J — no provider call)");
  pair.a.stop(); pair.b.stop();
}
{
  // Z-C — WATCHER revoke durable-write FAILURE + process loss → NEW boot refuses replay.
  // The root-cause scenario: local revoke happened, the durable revoke write FAILED (swallowed),
  // then the process is lost. Absent boot binding, the still-HELD durable envelope would be
  // replayable; the boot boundary refuses it instead.
  const clk = mkClock(); const catalog = mkCatalog();
  const store = mkFakeStore({ nowRef: clk.state, catalogVersionId: catalog.version, revokeFails: true });
  const mt = mkManualTimers();
  const a = AUTH.createBudgetCore({ store, catalog, clock: clk.clock, hashSession, mintRef, bootNonce: "boot-A", controlTimers: mt.timers, controlIntervalMs: 5000 });
  await a.prepareProviderLease({ gatewaySessionId: "gw.ZC", subjectDigest: "s", projectId: "projA", acquisitionKey: "acqZC", maxControlStalenessMs: 15000, leaseTtlMs: 60000, amounts: provAmt(100000n, 5n) });
  store._state.control.killed = true; mt.box.pending(); await flush();
  ok(a.inspect("gw.ZC").provider.revoked === true, "Z05 — the watcher-observed kill revokes the local lease");
  ok(store._state.envelopes.get("acqZC").revoked === false, "Z06 — the durable revoke write FAILED (envelope still not durably revoked)");
  // process loss → a fresh process/boot (new nonce), SAME durable store
  const b = AUTH.createBudgetCore({ store, catalog, clock: clk.clock, hashSession, mintRef, bootNonce: "boot-B", controlTimers: noTimers, controlIntervalMs: 5000 });
  const rp = await b.prepareProviderLease({ gatewaySessionId: "gw.ZC", subjectDigest: "s", projectId: "projA", acquisitionKey: "acqZC", maxControlStalenessMs: 15000, leaseTtlMs: 60000, amounts: provAmt(100000n, 5n) });
  ok(!rp.ok && rp.reason === "envelope_previous_boot", "Z07 — a restart under a NEW boot refuses replay EVEN THOUGH the durable revoke write failed (root-cause closed)");
  eq(b.inspect("gw.ZC").provider, null, "Z08 — no fresh allocation authority after the restart");
  a.stop(); b.stop();
}
{
  // Z-D — EXPLICIT revokeSessionDurable durable-write FAILURE + process loss → NEW boot refuses.
  const clk = mkClock(); const catalog = mkCatalog();
  const store = mkFakeStore({ nowRef: clk.state, catalogVersionId: catalog.version, revokeFails: true });
  const a = AUTH.createBudgetCore({ store, catalog, clock: clk.clock, hashSession, mintRef, bootNonce: "boot-A", controlTimers: noTimers, controlIntervalMs: 5000 });
  await a.prepareProviderLease({ gatewaySessionId: "gw.ZD", subjectDigest: "s", projectId: "projA", acquisitionKey: "acqZD", maxControlStalenessMs: 15000, leaseTtlMs: 60000, amounts: provAmt(100000n, 5n) });
  await a.revokeSessionDurable("gw.ZD", "explicit"); // durable revoke FAILS in the store
  ok(a.inspect("gw.ZD").provider.revoked === true, "Z09 — explicit revokeSessionDurable marks the local lease revoked");
  ok(store._state.envelopes.get("acqZD").revoked === false, "Z10 — the explicit durable revoke write FAILED (still not durably revoked)");
  const b = AUTH.createBudgetCore({ store, catalog, clock: clk.clock, hashSession, mintRef, bootNonce: "boot-B", controlTimers: noTimers, controlIntervalMs: 5000 });
  const rp = await b.prepareProviderLease({ gatewaySessionId: "gw.ZD", subjectDigest: "s", projectId: "projA", acquisitionKey: "acqZD", maxControlStalenessMs: 15000, leaseTtlMs: 60000, amounts: provAmt(100000n, 5n) });
  ok(!rp.ok && rp.reason === "envelope_previous_boot", "Z11 — a restart refuses replay after an explicit durable-revoke failure");
  a.stop(); b.stop();
}
{
  // Z-E — a SUCCESSFUL durable revoke still refuses replay regardless of boot identity (§8).
  const pair = mkPair({ bootNonceA: "boot-A", bootNonceB: "boot-B" }); // revoke succeeds (default store)
  await prepProvider(pair.a, "gw.ZE", provAmt(100000n, 5n), { acquisitionKey: "acqZE" });
  await pair.a.revokeSessionDurable("gw.ZE", "explicit"); // durable revoke SUCCEEDS
  const rp = await prepProvider(pair.b, "gw.ZE", provAmt(100000n, 5n), { acquisitionKey: "acqZE" });
  ok(!rp.ok && rp.reason === "envelope_revoked", "Z12 — a SUCCESSFUL durable revoke refuses replay regardless of boot (envelope_revoked, §8)");
  pair.a.stop(); pair.b.stop();
}
{
  // Z-F — a wrong-boot replay cannot HYDRATE a settled provider child into fresh authority.
  const pair = mkPair({ bootNonceA: "boot-A", bootNonceB: "boot-B" });
  await prepProvider(pair.a, "gw.ZF", provAmt(100000n, 5n), { acquisitionKey: "acqZF" });
  const t = pair.a.providerSpendAuthority({ providerSpendClass: "TRANSCRIPTION", gatewaySessionId: "gw.ZF", providerTurnId: "turnZF" });
  const id = t.reserve("gw.ZF", 90); await pair.a.persistProviderReservation("gw.ZF", "turnZF"); t.settle(id, 90); await pair.a.persistProviderSettlement("gw.ZF", "turnZF");
  const rp = await prepProvider(pair.b, "gw.ZF", provAmt(100000n, 5n), { acquisitionKey: "acqZF" });
  ok(!rp.ok && rp.reason === "envelope_previous_boot", "Z13 — a wrong-boot replay of an envelope with a settled child is refused before any hydration");
  eq(pair.b.inspect("gw.ZF").provider, null, "Z14 — no lease is hydrated on a wrong-boot replay (no execution/provider child authority)");
  pair.a.stop(); pair.b.stop();
}
{
  // Z-G/H/I — CONTROL REVALIDATION on a SAME-boot replay (§9): killed / disabled / advanced-epoch.
  const killed = mkPair(); // same boot
  await prepProvider(killed.a, "gw.ZG", provAmt(100000n, 5n), { acquisitionKey: "acqZG" });
  killed.store._state.control.killed = true;
  const rg = await prepProvider(killed.b, "gw.ZG", provAmt(100000n, 5n), { acquisitionKey: "acqZG" });
  ok(!rg.ok && rg.reason === "control_killed", "Z15 — a KILLED control refuses a same-boot replay (never mints from stale pinned control)");
  killed.a.stop(); killed.b.stop();

  const disabled = mkPair();
  await prepProvider(disabled.a, "gw.ZH", provAmt(100000n, 5n), { acquisitionKey: "acqZH" });
  disabled.store._state.control.enabled = false;
  const rh = await prepProvider(disabled.b, "gw.ZH", provAmt(100000n, 5n), { acquisitionKey: "acqZH" });
  ok(!rh.ok && rh.reason === "control_disabled", "Z16 — a DISABLED control refuses a same-boot replay");
  disabled.a.stop(); disabled.b.stop();

  const advanced = mkPair();
  await prepProvider(advanced.a, "gw.ZI", provAmt(100000n, 5n), { acquisitionKey: "acqZI" });
  advanced.store._state.control.globalEpoch = 2n; // advanced beyond the pinned epoch (1n)
  const ri = await prepProvider(advanced.b, "gw.ZI", provAmt(100000n, 5n), { acquisitionKey: "acqZI" });
  ok(!ri.ok && ri.reason === "control_superseded", "Z17 — an ADVANCED control epoch refuses a same-boot replay (control_superseded)");
  advanced.a.stop(); advanced.b.stop();
}
{
  // Z-J — the boot nonce is MANDATORY when a store is wired (no invented default; fail closed).
  const clk = mkClock(); const catalog = mkCatalog();
  const store = mkFakeStore({ nowRef: clk.state, catalogVersionId: catalog.version });
  const core = AUTH.createBudgetCore({ store, catalog, clock: clk.clock, hashSession, mintRef, controlTimers: noTimers, controlIntervalMs: 5000 }); // NO bootNonce
  const rp = await core.prepareProviderLease({ gatewaySessionId: "gw.ZJ", subjectDigest: "s", projectId: "projA", acquisitionKey: "acqZJ", maxControlStalenessMs: 15000, leaseTtlMs: 60000, amounts: provAmt(100000n, 5n) });
  ok(!rp.ok && rp.reason === "no_boot_nonce", "Z18 — a store-wired core with NO boot nonce fails closed (no_boot_nonce)");
  eq(core.inspect("gw.ZJ").provider, null, "Z19 — no lease + no provider/execution authority without a trusted boot nonce (J)");
  // and the store itself rejects an acquire missing the bootNonce (defense in depth)
  const bad = await store.acquireEnvelope({ budgetClass: "PROVIDER_SPEND", gatewaySessionDigest: "d", subjectDigest: "s", projectId: "projA", acquisitionKey: "acqZJ2", amounts: provAmt(1000n, 1n), maxControlStalenessMs: 15000, leaseTtlMs: 60000 });
  ok(!bad.ok && bad.reason === "invalid_request", "Z20 — the store rejects an acquire missing the boot nonce (invalid_request)");
  core.stop();
}

// ═══════════════════════════ named closure probes ══════════════════════════
section("BUDGET01-K — named closure probes");
{
  const { core } = mkCore({ store: null });
  probe("dormant_no_store_no_authority", (await prepProvider(core, "gw.z", provAmt(1n, 1n))).ok === false && core.providerSpendAuthority({ providerSpendClass: "REASONING", gatewaySessionId: "gw.z", providerTurnId: "p" }).reserve("gw.z", 4000) === null);
  core.stop();
  const c2 = mkCore(); await prepProvider(c2.core, "gw.k2", provAmt(100000n, 5n));
  const a2 = c2.core.providerSpendAuthority({ providerSpendClass: "REASONING", gatewaySessionId: "gw.k2", providerTurnId: "p" });
  const before = c2.store._calls.total; const rid = a2.reserve("gw.k2", 4000); a2.settle(rid, 1); const after = c2.store._calls.total;
  probe("sync_facade_zero_store_io", before === after);
  c2.core.stop();
  const c3 = mkCore(); await prepExec(c3.core, "gw.k3", 1n);
  const g3 = c3.core.executionAdmissionGate("gw.k3");
  const r1 = g3.admit(execInput({ executionId: "x", requestDigest: "y" }));
  const r2 = g3.admit(execInput({ executionId: "x", requestDigest: "y" }));
  probe("execution_admission_idempotent_zero_money", r1.decision === "ADMITTED" && r2.budgetAdmissionRef === r1.budgetAdmissionRef && c3.core.inspect("gw.k3").provider === null);
  c3.core.stop();
  probe("integer_money_ceil_upward", (() => { const c = P.costMicros(1n, 1n, 1000n); return c.ok && c.micros === 1n; })());
  probe("empty_catalog_unavailable", P.EMPTY_PRICE_CATALOG.resolve({ provider: "openai", model: "gpt-5.6-terra", dimension: "reasoning_input_token" }, 1_000_000) === null);
}

console.log("\n── CLOSURE PROBES ──");
probes.forEach((p) => console.log(`  ${p.ok ? "✓" : "✗"} ${p.name}`));
console.log(`\n${fail === 0 ? "✅" : "❌"} BUDGET-01 deterministic suite: ${pass} passed, ${fail} failed`);
if (fail !== 0) { console.error("\nFAILURES:\n" + failures.map((f) => "  - " + f).join("\n")); process.exit(1); }
process.exit(0);
};

run().catch((e) => { console.error("UNCAUGHT:", e && e.stack || e); process.exit(1); });
