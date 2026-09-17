#!/usr/bin/env node
/* eslint-disable no-console */
// ═════════════════════════════════════════════════════════════════════════
// StayBid Live AI — LIVE-AI-BUDGET-01 — ISOLATED PostgreSQL integration suite.
//
//   Run:  node tests/budget/live-ai-budget-01.pg.test.js
//
// Spins up a THROWAWAY, socket-only Postgres cluster (the proven concurrency
// harness), applies the UNAPPLIED migration artifact, and drives the REAL
// createPgBudgetStore adapter through its transactional (SERIALIZABLE) semantics:
// atomic envelope acquisition, idempotency, conflict, ceiling enforcement, two
// replicas competing at a shared ceiling (no overspend), policy rollover WITHOUT
// accounting reset, kill/disable, and reconcile/forfeit.
//
// RELEASE GATE: if the Postgres binaries are unavailable, the harness exits
// NON-ZERO (unproven) — a SKIP is never a PASS. It NEVER touches Production
// (the dsn-guard refuses any DSN that is not the throwaway socket).
// ═════════════════════════════════════════════════════════════════════════
"use strict";
const path = require("path");
const fs = require("fs");
const cp = require("child_process");

let Client, Pool;
try { ({ Client, Pool } = require("pg")); }
catch (_) { console.error("[budget-pg] `pg` is not installed. Run `npm ci`."); process.exit(2); }

const harness = require("../concurrency/.pg-harness");
const { assertTestDsn } = require("../concurrency/dsn-guard");

const REPO = path.resolve(__dirname, "..", "..");
const MIG = path.join(REPO, "migrations", "2026-09-16-live-ai-budget-01-dpbel-foundation.sql");

// ── compile the store module set (real adapter) ──────────────────────────────
const FILES = ["live-ai-budget-pricing.ts", "live-ai-budget-control.ts", "live-ai-budget-store.ts", "live-ai-budget-authority.ts"];
const BUILD = path.join(__dirname, ".build", "budget01pg");
const SRC = path.join(BUILD, "src"); const OUT = path.join(BUILD, "out");
fs.rmSync(BUILD, { recursive: true, force: true });
fs.mkdirSync(path.join(SRC, "gw"), { recursive: true });
for (const f of FILES) fs.copyFileSync(path.join(REPO, "server/voice-gateway", f), path.join(SRC, "gw", f));
fs.writeFileSync(path.join(SRC, "tsconfig.json"), JSON.stringify({
  compilerOptions: { module: "commonjs", target: "es2020", esModuleInterop: true, skipLibCheck: true, moduleResolution: "node", ignoreDeprecations: "6.0", rootDir: ".", outDir: "../out", typeRoots: [path.join(REPO, "node_modules/@types")], types: ["node"], lib: ["es2020"], strict: true, noEmitOnError: true },
  include: ["gw/**/*.ts"],
}));
const TSC_BIN = require.resolve("typescript/bin/tsc", { paths: [REPO] });
const compile = cp.spawnSync(process.execPath, [TSC_BIN, "-p", path.join(SRC, "tsconfig.json")], { cwd: REPO, encoding: "utf8" });
if (compile.status !== 0) { console.error("COMPILE GATE FAILED (budget01 pg):\n" + (compile.stdout || "") + (compile.stderr || "")); process.exit(2); }
const STORE = require(path.join(OUT, "gw/live-ai-budget-store.js"));

let passed = 0, failed = 0; const failures = [];
function ok(c, l) { if (c) { passed++; console.log("  ✓ " + l); } else { failed++; failures.push(l); console.error("  ✗ " + l); } }

// a pg.Pool structurally satisfies SqlConnectionPool (connect()→client{query,release}).
function poolAdapter(pool) { return { connect: () => pool.connect() }; }

async function seed(client) {
  await client.query(
    `INSERT INTO budget_control_epochs (scope_type, scope_key_digest, control_epoch, enabled, killed, record_digest)
       VALUES ('global','global',1,TRUE,FALSE,'g1'), ('project','projA',1,TRUE,FALSE,'p1')
     ON CONFLICT (scope_type, scope_key_digest) DO UPDATE SET enabled=EXCLUDED.enabled, killed=EXCLUDED.killed, control_epoch=EXCLUDED.control_epoch`);
  await client.query(
    `INSERT INTO budget_price_catalog_versions (id, status, catalog_digest) VALUES ('cat1','active','cd1')
     ON CONFLICT (id) DO NOTHING`);
}
async function setPolicy(client, id, ceilings, project) {
  const subjectDay = ceilings.subjectDay === undefined ? (10n ** 12n) : ceilings.subjectDay;
  await client.query(`UPDATE budget_policy_versions SET status='superseded' WHERE project_id=$1 AND status='active'`, [project || "projA"]);
  await client.query(
    `INSERT INTO budget_policy_versions (id, project_id, status, session_money_ceiling_micros, session_provider_calls, session_execution_admissions, subject_day_money_ceiling_micros, project_day_money_ceiling_micros, project_month_money_ceiling_micros, global_day_money_ceiling_micros, policy_digest)
       VALUES ($1,$2,'active',$3,$4,$5,$6,$7,$8,$9,$10)`,
    [id, project || "projA", ceilings.sessionMoney, ceilings.sessionCalls, ceilings.sessionExec, subjectDay, ceilings.projDay, ceilings.projMonth, ceilings.globalDay, "pd_" + id]);
}
const prov = (money, calls) => ({ moneyMicros: money, providerCalls: calls, executionAdmissions: 0n });
function req(o) {
  // P0-01 frozen-lifecycle — a trusted boot nonce is mandatory; a single default models ONE boot.
  return Object.assign({ budgetClass: "PROVIDER_SPEND", gatewaySessionDigest: "d1", subjectDigest: "s1", projectId: "projA", acquisitionKey: "k1", amounts: prov(10000n, 1n), maxControlStalenessMs: 15000, leaseTtlMs: 60000, bootNonce: "boot-A" }, o || {});
}
async function counter(client, dig, dim, budgetClass, periodKind) {
  const r = await client.query(
    `SELECT held, charged, consumed, released FROM budget_scope_counters WHERE scope_key_digest=$1 AND accounting_dimension=$2 AND budget_class=$3 AND period_kind=$4 LIMIT 1`,
    [dig, dim, budgetClass, periodKind]);
  return r.rows[0] || { held: "0", charged: "0", consumed: "0", released: "0" };
}

(async () => {
  const dsn = await harness.start();
  assertTestDsn(dsn);
  const admin = new Client({ connectionString: dsn });
  await admin.connect();
  await admin.query(fs.readFileSync(MIG, "utf8")); // apply the UNAPPLIED artifact to the throwaway cluster
  // idempotent re-apply (proves IF NOT EXISTS)
  await admin.query(fs.readFileSync(MIG, "utf8"));
  ok(true, "PG01 — migration applies (and re-applies idempotently) to the throwaway cluster");
  await seed(admin);

  const pool = new Pool({ connectionString: dsn, max: 8 });
  const store = STORE.createPgBudgetStore({ pool: poolAdapter(pool), nowMs: () => Date.now() });

  // ── atomic acquire ──
  await setPolicy(admin, "pol1", { sessionMoney: 1_000_000n, sessionCalls: 100n, sessionExec: 100n, projDay: 1_000_000n, projMonth: 1_000_000n, globalDay: 1_000_000n });
  const a1 = await store.acquireEnvelope(req({ acquisitionKey: "kA", gatewaySessionDigest: "dA", amounts: prov(10000n, 1n) }));
  ok(a1.ok && a1.idempotentReplay === false && a1.envelope.amounts.moneyMicros === 10000n, "PG02 — atomic envelope acquisition returns a held envelope");
  const c1 = await counter(admin, "dA", "money_micros", "PROVIDER_SPEND", "session");
  ok(String(c1.held) === "10000", "PG03 — the session money counter shows 10000 held");

  // ── idempotent acquisition (same key + same request ⇒ same envelope, no double count) ──
  const a1b = await store.acquireEnvelope(req({ acquisitionKey: "kA", gatewaySessionDigest: "dA", amounts: prov(10000n, 1n) }));
  ok(a1b.ok && a1b.idempotentReplay === true && a1b.envelope.envelopeId === a1.envelope.envelopeId, "PG04 — same key + same request ⇒ idempotent replay (same envelope)");
  const c1b = await counter(admin, "dA", "money_micros", "PROVIDER_SPEND", "session");
  ok(String(c1b.held) === "10000", "PG05 — an idempotent replay does NOT double-count held");

  // ── conflicting reuse rejects ──
  const conflict = await store.acquireEnvelope(req({ acquisitionKey: "kA", gatewaySessionDigest: "dA", amounts: prov(20000n, 1n) }));
  ok(!conflict.ok && conflict.reason === "acquisition_conflict", "PG06 — same key + different request ⇒ acquisition_conflict");

  // ── session ceiling enforcement ──
  await setPolicy(admin, "pol2", { sessionMoney: 5000n, sessionCalls: 100n, sessionExec: 100n, projDay: 1_000_000n, projMonth: 1_000_000n, globalDay: 1_000_000n });
  const over = await store.acquireEnvelope(req({ acquisitionKey: "kCeil", gatewaySessionDigest: "dCeil", amounts: prov(6000n, 1n) }));
  ok(!over.ok && over.reason === "ceiling_exceeded", "PG07 — a request over the session money ceiling ⇒ ceiling_exceeded");

  // ── two replicas competing at a SHARED (global-day) ceiling cannot overspend ──
  await setPolicy(admin, "pol3", { sessionMoney: 1_000_000n, sessionCalls: 100n, sessionExec: 100n, projDay: 1_000_000n, projMonth: 1_000_000n, globalDay: 100000n });
  const store2 = STORE.createPgBudgetStore({ pool: poolAdapter(pool), nowMs: () => Date.now() });
  const [r1, r2] = await Promise.all([
    store.acquireEnvelope(req({ acquisitionKey: "kR1", gatewaySessionDigest: "dR1", amounts: prov(60000n, 1n) })),
    store2.acquireEnvelope(req({ acquisitionKey: "kR2", gatewaySessionDigest: "dR2", amounts: prov(60000n, 1n) })),
  ]);
  const wins = [r1, r2].filter((r) => r.ok).length;
  ok(wins === 1, `PG08 — two replicas at the global-day ceiling: exactly ONE wins (no overspend) [got ${wins}]`);
  const gday = await counter(admin, "global", "money_micros", "PROVIDER_SPEND", "day");
  ok(BigInt(gday.held) <= 100000n, "PG09 — the global-day held never exceeds the ceiling");

  // ── policy rollover does NOT reset accounting; a lower rollover ceiling refuses ──
  const beforeRoll = await counter(admin, "dA", "money_micros", "PROVIDER_SPEND", "session");
  await setPolicy(admin, "pol4", { sessionMoney: 12000n, sessionCalls: 100n, sessionExec: 100n, projDay: 1_000_000n, projMonth: 1_000_000n, globalDay: 1_000_000n });
  const afterRoll = await counter(admin, "dA", "money_micros", "PROVIDER_SPEND", "session");
  ok(String(beforeRoll.held) === String(afterRoll.held) && String(afterRoll.held) === "10000", "PG10 — a policy rollover does NOT reset the stable session counter (still 10000 held)");
  // dA already holds 10000; new ceiling 12000 ⇒ only 2000 headroom. A 3000 request refuses; a 2000 succeeds.
  const refuse = await store.acquireEnvelope(req({ acquisitionKey: "kRoll1", gatewaySessionDigest: "dA", amounts: prov(3000n, 1n) }));
  ok(!refuse.ok && refuse.reason === "ceiling_exceeded", "PG11 — a rollover ceiling below existing exposure refuses (true remaining headroom honored)");
  const fit = await store.acquireEnvelope(req({ acquisitionKey: "kRoll2", gatewaySessionDigest: "dA", amounts: prov(2000n, 1n) }));
  ok(fit.ok, "PG12 — a request within the true remaining headroom (2000) succeeds after rollover");

  // ── control kill / disable refuse new allocations ──
  await admin.query(`UPDATE budget_control_epochs SET killed=TRUE WHERE scope_type='global'`);
  const killed = await store.acquireEnvelope(req({ acquisitionKey: "kKill", gatewaySessionDigest: "dKill", amounts: prov(1n, 1n) }));
  ok(!killed.ok && killed.reason === "control_killed", "PG13 — a killed control refuses new acquisition (control_killed)");
  await admin.query(`UPDATE budget_control_epochs SET killed=FALSE, enabled=FALSE WHERE scope_type='global'`);
  const disabled = await store.acquireEnvelope(req({ acquisitionKey: "kDis", gatewaySessionDigest: "dDis", amounts: prov(1n, 1n) }));
  ok(!disabled.ok && disabled.reason === "control_disabled", "PG14 — a disabled control refuses new acquisition (control_disabled)");
  await admin.query(`UPDATE budget_control_epochs SET enabled=TRUE WHERE scope_type='global'`);

  // ── reconcile (clean) moves held → charged/released; idempotent ──
  const rc = await store.reconcile({ envelopeId: a1.envelope.envelopeId, clean: true, reconciliationKey: "rcA", moneyChargedMicros: 4000n, moneyReleasedMicros: 6000n, providerCallsCharged: 1n, providerCallsReleased: 0n, executionAdmissionsConsumed: 0n, executionAdmissionsReleased: 0n });
  ok(rc.ok, "PG15 — clean reconcile succeeds");
  const cRec = await counter(admin, "dA", "money_micros", "PROVIDER_SPEND", "session");
  ok(String(cRec.charged) === "4000" && String(cRec.released) === "6000" && String(cRec.held) === "2000", "PG16 — reconcile moved held→charged/released (charged 4000, released 6000; 2000 from kRoll2 remains held)");
  const rcDup = await store.reconcile({ envelopeId: a1.envelope.envelopeId, clean: true, reconciliationKey: "rcA", moneyChargedMicros: 9999n, moneyReleasedMicros: 0n, providerCallsCharged: 0n, providerCallsReleased: 0n, executionAdmissionsConsumed: 0n, executionAdmissionsReleased: 0n });
  ok(rcDup.ok, "PG17 — a duplicate reconcile (same key) is idempotent");
  const cDup = await counter(admin, "dA", "money_micros", "PROVIDER_SPEND", "session");
  ok(String(cDup.charged) === "4000", "PG18 — the idempotent reconcile did NOT re-apply (charged still 4000)");

  // ── crash forfeit charges ALL remaining held (no quota restored) ──
  const cr = await store.acquireEnvelope(req({ acquisitionKey: "kCrash", gatewaySessionDigest: "dCrash", amounts: prov(7000n, 2n) }));
  ok(cr.ok, "PG19 — acquire an envelope to crash-forfeit");
  await store.reconcile({ envelopeId: cr.envelope.envelopeId, clean: false, reconciliationKey: "rcCrash", moneyChargedMicros: 0n, moneyReleasedMicros: 0n, providerCallsCharged: 0n, providerCallsReleased: 0n, executionAdmissionsConsumed: 0n, executionAdmissionsReleased: 0n });
  const cCrash = await counter(admin, "dCrash", "money_micros", "PROVIDER_SPEND", "session");
  ok(String(cCrash.charged) === "7000" && String(cCrash.held) === "0" && String(cCrash.released) === "0", "PG20 — crash forfeit charges ALL held (7000), releases nothing (no quota restored)");

  // ── a NEW gatewaySessionDigest is a NEW per-session scope (fresh counter) ──
  const fresh = await store.acquireEnvelope(req({ acquisitionKey: "kFresh", gatewaySessionDigest: "dFRESH", amounts: prov(1000n, 1n) }));
  const cFresh = await counter(admin, "dFRESH", "money_micros", "PROVIDER_SPEND", "session");
  ok(fresh.ok && String(cFresh.held) === "1000", "PG21 — a new gatewaySessionDigest gets its own fresh session counter (new scope)");

  // ════════════════════════ REMEDIATION-01 durable semantics ════════════════
  // ── P0-01: an acquisition replay reconstructs the ORIGINAL envelope and never
  //    resurrects a terminal / forfeited / revoked / expired issuance ──
  await setPolicy(admin, "polR", { sessionMoney: 10n ** 12n, sessionCalls: 100n, sessionExec: 100n, projDay: 10n ** 12n, projMonth: 10n ** 12n, globalDay: 10n ** 12n });
  const zA = await store.acquireEnvelope(req({ acquisitionKey: "kZA", gatewaySessionDigest: "dZA", subjectDigest: "sZA", amounts: prov(5000n, 1n) }));
  ok(zA.ok && zA.envelope.leaseGeneration === 1n && /^acq256:/.test(zA.envelope.acquisitionCommitment), "PG22 — a fresh envelope persists its pins (lease generation + canonical acquisition commitment)");
  const zAr = await store.acquireEnvelope(req({ acquisitionKey: "kZA", gatewaySessionDigest: "dZA", subjectDigest: "sZA", amounts: prov(5000n, 1n) }));
  ok(zAr.ok && zAr.idempotentReplay === true && zAr.envelope.expiresAtMs === zA.envelope.expiresAtMs, "PG23 — a replay reconstructs the ORIGINAL expiry (never extends the lease lifetime)");
  await store.reconcile({ envelopeId: zA.envelope.envelopeId, clean: true, reconciliationKey: "rcZA", moneyChargedMicros: 0n, moneyReleasedMicros: 5000n, providerCallsCharged: 0n, providerCallsReleased: 1n, executionAdmissionsConsumed: 0n, executionAdmissionsReleased: 0n });
  const zTerm = await store.acquireEnvelope(req({ acquisitionKey: "kZA", gatewaySessionDigest: "dZA", subjectDigest: "sZA", amounts: prov(5000n, 1n) }));
  ok(!zTerm.ok && zTerm.reason === "envelope_terminal", "PG24 — a replay after clean reconcile ⇒ envelope_terminal");
  const zB = await store.acquireEnvelope(req({ acquisitionKey: "kZB", gatewaySessionDigest: "dZB", subjectDigest: "sZB", amounts: prov(5000n, 1n) }));
  await store.reconcile({ envelopeId: zB.envelope.envelopeId, clean: false, reconciliationKey: "rcZB", moneyChargedMicros: 0n, moneyReleasedMicros: 0n, providerCallsCharged: 0n, providerCallsReleased: 0n, executionAdmissionsConsumed: 0n, executionAdmissionsReleased: 0n });
  const zForf = await store.acquireEnvelope(req({ acquisitionKey: "kZB", gatewaySessionDigest: "dZB", subjectDigest: "sZB", amounts: prov(5000n, 1n) }));
  ok(!zForf.ok && zForf.reason === "envelope_forfeited", "PG25 — a replay after crash forfeit ⇒ envelope_forfeited");
  const zC = await store.acquireEnvelope(req({ acquisitionKey: "kZC", gatewaySessionDigest: "dZC", subjectDigest: "sZC", amounts: prov(5000n, 1n) }));
  await store.revokeEnvelope({ envelopeId: zC.envelope.envelopeId, reason: "control_epoch_advanced" });
  const zRev = await store.acquireEnvelope(req({ acquisitionKey: "kZC", gatewaySessionDigest: "dZC", subjectDigest: "sZC", amounts: prov(5000n, 1n) }));
  ok(!zRev.ok && zRev.reason === "envelope_revoked", "PG26 — a replay after a durable revoke ⇒ envelope_revoked");
  const zD = await store.acquireEnvelope(req({ acquisitionKey: "kZD", gatewaySessionDigest: "dZD", subjectDigest: "sZD", amounts: prov(5000n, 1n) }));
  await admin.query(`UPDATE budget_envelopes SET expires_at_ms=1 WHERE id=$1`, [zD.envelope.envelopeId]);
  const zExp = await store.acquireEnvelope(req({ acquisitionKey: "kZD", gatewaySessionDigest: "dZD", subjectDigest: "sZD", amounts: prov(5000n, 1n) }));
  ok(!zExp.ok && zExp.reason === "envelope_expired", "PG27 — a replay after expiry ⇒ envelope_expired");
  await store.acquireEnvelope(req({ acquisitionKey: "kIC", gatewaySessionDigest: "dIC", subjectDigest: "sIC", amounts: prov(5000n, 1n) }));
  const icf = await store.acquireEnvelope(req({ acquisitionKey: "kIC", gatewaySessionDigest: "dIC", subjectDigest: "sIC", amounts: prov(9999n, 1n) }));
  ok(!icf.ok && icf.reason === "acquisition_conflict", "PG28 — same key + a different canonical commitment ⇒ acquisition_conflict (identity)");

  // ── P0-02: immutable trusted session ownership (gatewaySessionDigest, subject, project) ──
  await setPolicy(admin, "polB", { sessionMoney: 10n ** 12n, sessionCalls: 100n, sessionExec: 100n, projDay: 10n ** 12n, projMonth: 10n ** 12n, globalDay: 10n ** 12n }, "projB");
  await admin.query(`INSERT INTO budget_control_epochs (scope_type, scope_key_digest, control_epoch, enabled, killed, record_digest) VALUES ('project','projB',1,TRUE,FALSE,'pb1') ON CONFLICT DO NOTHING`);
  await store.acquireEnvelope(req({ acquisitionKey: "kOwn1", gatewaySessionDigest: "dOwn", subjectDigest: "subA", projectId: "projA", amounts: prov(1000n, 1n) }));
  const ownSubj = await store.acquireEnvelope(req({ acquisitionKey: "kOwn2", gatewaySessionDigest: "dOwn", subjectDigest: "subB", projectId: "projA", amounts: prov(1000n, 1n) }));
  ok(!ownSubj.ok && ownSubj.reason === "ownership_conflict", "PG29 — reusing a session digest with a different SUBJECT ⇒ ownership_conflict (no silent rebind)");
  const ownProj = await store.acquireEnvelope(req({ acquisitionKey: "kOwn3", gatewaySessionDigest: "dOwn", subjectDigest: "subA", projectId: "projB", amounts: prov(1000n, 1n) }));
  ok(!ownProj.ok && ownProj.reason === "ownership_conflict", "PG30 — reusing a session digest with a different PROJECT ⇒ ownership_conflict");
  await store.acquireEnvelope(req({ acquisitionKey: "kReuseA", gatewaySessionDigest: "dReuse", subjectDigest: "subR", projectId: "projA", amounts: prov(1000n, 1n) }));
  const reuse = await store.acquireEnvelope(req({ acquisitionKey: "kReuseB", gatewaySessionDigest: "dReuse", subjectDigest: "subR", projectId: "projA", amounts: prov(1000n, 1n) }));
  ok(reuse.ok, "PG31 — same session digest + same subject/project ⇒ a fresh acquisition is valid reuse");

  // ── P1-01: durable child idempotency (execution + provider) + hydration source ──
  const ch = await store.acquireEnvelope(req({ acquisitionKey: "kChild", gatewaySessionDigest: "dChild", subjectDigest: "sChild", amounts: prov(50000n, 5n) }));
  const cEnv = ch.envelope.envelopeId;
  ok((await store.recordExecutionAdmission({ envelopeId: cEnv, gatewaySessionDigest: "dChild", executionId: "exX", requestDigest: "dg1", admissionRef: "aref1" })).ok, "PG32 — durable execution admission recorded");
  ok((await store.recordExecutionAdmission({ envelopeId: cEnv, gatewaySessionDigest: "dChild", executionId: "exX", requestDigest: "dg1", admissionRef: "aref1" })).ok, "PG33 — a duplicate execution admission (same digest) is idempotent");
  const eConf = await store.recordExecutionAdmission({ envelopeId: cEnv, gatewaySessionDigest: "dChild", executionId: "exX", requestDigest: "dgDIFF", admissionRef: "aref2" });
  ok(!eConf.ok && eConf.reason === "conflict", "PG34 — a conflicting execution admission (different digest) fails closed");
  ok((await store.recordProviderReservation({ envelopeId: cEnv, reservationRef: "turnX", providerSpendClass: "REASONING", requestCommitment: "c1", moneyMicros: 40000n, providerUnits: 4000n })).ok, "PG35 — durable provider reservation recorded");
  ok((await store.recordProviderReservation({ envelopeId: cEnv, reservationRef: "turnX", providerSpendClass: "REASONING", requestCommitment: "c1", moneyMicros: 40000n, providerUnits: 4000n })).ok, "PG36 — a duplicate provider reservation (same commitment) is idempotent");
  const pConf = await store.recordProviderReservation({ envelopeId: cEnv, reservationRef: "turnX", providerSpendClass: "REASONING", requestCommitment: "cDIFF", moneyMicros: 1n, providerUnits: 1n });
  ok(!pConf.ok && pConf.reason === "conflict", "PG37 — a conflicting provider reservation (different commitment) fails closed");
  // ── P1-03: over-cap excess is durably recorded (revoked + excess) with no under-accounting ──
  ok((await store.settleProviderReservation({ reservationRef: "turnX", chargedMicros: 40000n, releasedMicros: 0n, actualUnits: 5000n, revoked: true, overCap: true, excessUnits: 1000n, incidentReason: "provider_actual_over_reservation" })).ok, "PG38 — settle a provider reservation with an over-cap excess incident");
  const rrow = await admin.query(`SELECT state, over_cap, excess_units FROM budget_provider_reservations WHERE reservation_ref='turnX'`);
  ok(rrow.rows[0].state === "revoked" && rrow.rows[0].over_cap === true && String(rrow.rows[0].excess_units) === "1000", "PG39 — the over-cap incident is durably recorded (revoked + excess units)");
  const einc = await admin.query(`SELECT incident_reason FROM budget_envelopes WHERE id=$1`, [cEnv]);
  ok(einc.rows[0].incident_reason !== null, "PG40 — the envelope carries the excess incident reason (excess never silently dropped)");
  // P1-01 5C — an EXACT-duplicate terminal settlement is inert success; a CONFLICTING one fails closed.
  ok((await store.settleProviderReservation({ reservationRef: "turnX", chargedMicros: 40000n, releasedMicros: 0n, actualUnits: 5000n, revoked: true, overCap: true, excessUnits: 1000n, incidentReason: "provider_actual_over_reservation" })).ok, "PG41 — an EXACT-duplicate terminal settlement is inert success");
  const conflictSettle = await store.settleProviderReservation({ reservationRef: "turnX", chargedMicros: 1n, releasedMicros: 0n, actualUnits: null, revoked: false, overCap: false, excessUnits: null, incidentReason: null });
  ok(!conflictSettle.ok && conflictSettle.reason === "settlement_conflict", "PG41b — a CONFLICTING terminal settlement fails closed (settlement_conflict)");
  const chReplay = await store.acquireEnvelope(req({ acquisitionKey: "kChild", gatewaySessionDigest: "dChild", subjectDigest: "sChild", amounts: prov(50000n, 5n) }));
  ok(chReplay.ok && chReplay.replay && chReplay.replay.executions.length === 1 && chReplay.replay.reservations.length === 1, "PG42 — an idempotent replay returns the durable child state (hydration source)");

  // ── P1-04: SUBJECT/DAY ceiling aggregates across sessions; a different subject is isolated ──
  await setPolicy(admin, "polSubj", { sessionMoney: 10n ** 12n, sessionCalls: 100n, sessionExec: 100n, subjectDay: 100000n, projDay: 10n ** 12n, projMonth: 10n ** 12n, globalDay: 10n ** 12n });
  ok((await store.acquireEnvelope(req({ acquisitionKey: "kSJ1", gatewaySessionDigest: "dSJ1", subjectDigest: "subjSHARED", amounts: prov(60000n, 1n) }))).ok, "PG43 — first subject/day acquisition (60000) succeeds under the 100000 ceiling");
  const sj2 = await store.acquireEnvelope(req({ acquisitionKey: "kSJ2", gatewaySessionDigest: "dSJ2", subjectDigest: "subjSHARED", amounts: prov(60000n, 1n) }));
  ok(!sj2.ok && sj2.reason === "ceiling_exceeded", "PG44 — the SAME subject across a DIFFERENT session counts together (subject/day exceeded)");
  ok((await store.acquireEnvelope(req({ acquisitionKey: "kSJ3", gatewaySessionDigest: "dSJ3", subjectDigest: "subjOTHER", amounts: prov(60000n, 1n) }))).ok, "PG45 — a DIFFERENT subject is isolated (its own subject/day counter)");
  const subjC = await counter(admin, "subjSHARED", "money_micros", "PROVIDER_SPEND", "day");
  ok(String(subjC.held) === "60000", "PG46 — the subject/day counter aggregates the subject's spend (60000 held)");

  // ── P1-04: UTC day boundary regardless of the DB session timezone ──
  await admin.query(`ALTER DATABASE ${harness.DB_NAME} SET timezone TO 'Asia/Kolkata'`);
  const tzPool = new Pool({ connectionString: dsn, max: 2 });
  const tzStore = STORE.createPgBudgetStore({ pool: poolAdapter(tzPool), nowMs: () => Date.now() });
  await setPolicy(admin, "polUTC", { sessionMoney: 10n ** 12n, sessionCalls: 100n, sessionExec: 100n, projDay: 10n ** 12n, projMonth: 10n ** 12n, globalDay: 10n ** 12n }, "projUTC");
  await admin.query(`INSERT INTO budget_control_epochs (scope_type, scope_key_digest, control_epoch, enabled, killed, record_digest) VALUES ('project','projUTC',1,TRUE,FALSE,'pu1') ON CONFLICT DO NOTHING`);
  const utcAcq = await tzStore.acquireEnvelope(req({ acquisitionKey: "kUTC", gatewaySessionDigest: "dUTC", subjectDigest: "sUTC", projectId: "projUTC", amounts: prov(1000n, 1n) }));
  const pd = await admin.query(`SELECT extract(epoch from period_start_utc) AS e FROM budget_scope_counters WHERE scope_type='project' AND scope_key_digest='projUTC' AND period_kind='day' AND accounting_dimension='money_micros'`);
  const expUtc = await admin.query(`SELECT extract(epoch from (date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')) AS e`);
  ok(utcAcq.ok && pd.rows.length === 1 && Number(pd.rows[0].e) === Number(expUtc.rows[0].e), "PG47 — a day boundary is UTC-anchored regardless of the DB session timezone (single UTC counter)");
  await tzPool.end();
  await admin.query(`ALTER DATABASE ${harness.DB_NAME} SET timezone TO 'UTC'`);

  // ── P1-04: future / expired policy + catalog are NOT active ──
  await admin.query(`INSERT INTO budget_control_epochs (scope_type, scope_key_digest, control_epoch, enabled, killed, record_digest) VALUES ('project','projFUT',1,TRUE,FALSE,'pf1'),('project','projEXP',1,TRUE,FALSE,'pe1') ON CONFLICT DO NOTHING`);
  await admin.query(`INSERT INTO budget_policy_versions (id, project_id, status, effective_from, session_money_ceiling_micros, session_provider_calls, session_execution_admissions, subject_day_money_ceiling_micros, project_day_money_ceiling_micros, project_month_money_ceiling_micros, global_day_money_ceiling_micros, policy_digest) VALUES ('polFut','projFUT','active', now() + interval '1 day', 1000000,100,100,1000000000000,1000000000000,1000000000000,1000000000000,'pfd')`);
  const fut = await store.acquireEnvelope(req({ acquisitionKey: "kFut", gatewaySessionDigest: "dFut", subjectDigest: "sFut", projectId: "projFUT", amounts: prov(1000n, 1n) }));
  ok(!fut.ok && fut.reason === "no_policy", "PG48 — a future-effective policy is NOT active (no_policy)");
  await admin.query(`INSERT INTO budget_policy_versions (id, project_id, status, effective_from, effective_until, session_money_ceiling_micros, session_provider_calls, session_execution_admissions, subject_day_money_ceiling_micros, project_day_money_ceiling_micros, project_month_money_ceiling_micros, global_day_money_ceiling_micros, policy_digest) VALUES ('polExp','projEXP','active', now() - interval '2 day', now() - interval '1 day', 1000000,100,100,1000000000000,1000000000000,1000000000000,1000000000000,'ped')`);
  const expd = await store.acquireEnvelope(req({ acquisitionKey: "kExpP", gatewaySessionDigest: "dExpP", subjectDigest: "sExpP", projectId: "projEXP", amounts: prov(1000n, 1n) }));
  ok(!expd.ok && expd.reason === "no_policy", "PG49 — an expired policy is NOT active (no_policy)");
  await admin.query(`UPDATE budget_price_catalog_versions SET status='inactive' WHERE id='cat1'`);
  await admin.query(`INSERT INTO budget_price_catalog_versions (id, status, effective_from, catalog_digest) VALUES ('catFut','active', now() + interval '1 day', 'cf') ON CONFLICT (id) DO NOTHING`);
  const cf = await store.acquireEnvelope(req({ acquisitionKey: "kCatFut", gatewaySessionDigest: "dCatFut", subjectDigest: "sCatFut", amounts: prov(1000n, 1n) }));
  ok(cf.ok && cf.envelope.priceCatalogVersionId === null, "PG50 — a future-effective catalog is NOT active (envelope pins a null catalog version)");
  await admin.query(`UPDATE budget_price_catalog_versions SET status='active' WHERE id='cat1'`);

  // ── P0-01 §5: an unresolved OPEN provider child makes the envelope non-replayable ──
  const opn = await store.acquireEnvelope(req({ acquisitionKey: "kOpen", gatewaySessionDigest: "dOpen", subjectDigest: "sOpen", amounts: prov(5000n, 1n) }));
  await store.recordProviderReservation({ envelopeId: opn.envelope.envelopeId, reservationRef: "turnOpen", providerSpendClass: "REASONING", requestCommitment: "co", moneyMicros: 5000n, providerUnits: 4000n });
  const opnReplay = await store.acquireEnvelope(req({ acquisitionKey: "kOpen", gatewaySessionDigest: "dOpen", subjectDigest: "sOpen", amounts: prov(5000n, 1n) }));
  ok(!opnReplay.ok && opnReplay.reason === "envelope_open_child", "PG55 — an unresolved OPEN provider child ⇒ envelope non-replayable (crash-ambiguity, no fresh authority)");

  // ── P1-01 §6: full settlement-tuple equality — exact duplicate inert, any single changed field conflicts ──
  const tupEnv = await store.acquireEnvelope(req({ acquisitionKey: "kTuple", gatewaySessionDigest: "dTuple", subjectDigest: "sTuple", amounts: prov(50000n, 3n) }));
  await store.recordProviderReservation({ envelopeId: tupEnv.envelope.envelopeId, reservationRef: "turnTuple", providerSpendClass: "TRANSCRIPTION", requestCommitment: "ct", moneyMicros: 18000n, providerUnits: 180n });
  const base = { reservationRef: "turnTuple", chargedMicros: 9000n, releasedMicros: 9000n, actualUnits: 90n, revoked: false, overCap: false, excessUnits: null, incidentReason: null };
  ok((await store.settleProviderReservation(base)).ok, "PG56 — baseline settlement recorded");
  ok((await store.settleProviderReservation({ ...base })).ok, "PG57 — an EXACT-duplicate full-tuple settlement is inert success");
  const chk = async (n, label, override) => { const r = await store.settleProviderReservation({ ...base, ...override }); ok(!r.ok && r.reason === "settlement_conflict", `PG${n} — changed ${label} ⇒ settlement_conflict`); };
  await chk(58, "chargedMicros", { chargedMicros: 9001n });
  await chk(59, "releasedMicros", { releasedMicros: 8999n });
  await chk(60, "actualUnits", { actualUnits: 91n });
  await chk(61, "revoked semantics", { revoked: true });
  await chk(62, "overCap", { overCap: true });
  await chk(63, "excessUnits", { excessUnits: 5n });
  await chk(64, "incidentReason", { incidentReason: "x" });

  // ── P1-01 §7: a terminal reservation with NO settlement row fails closed ──
  const noSet = await store.acquireEnvelope(req({ acquisitionKey: "kNoSet", gatewaySessionDigest: "dNoSet", subjectDigest: "sNoSet", amounts: prov(5000n, 1n) }));
  await store.recordProviderReservation({ envelopeId: noSet.envelope.envelopeId, reservationRef: "turnNoSet", providerSpendClass: "REASONING", requestCommitment: "cn", moneyMicros: 5000n, providerUnits: 4000n });
  await admin.query(`UPDATE budget_provider_reservations SET state='revoked' WHERE reservation_ref='turnNoSet'`); // terminal, NO settlement row
  const noSetR = await store.settleProviderReservation({ reservationRef: "turnNoSet", chargedMicros: 1n, releasedMicros: 0n, actualUnits: null, revoked: false, overCap: false, excessUnits: null, incidentReason: null });
  ok(!noSetR.ok && noSetR.reason === "terminal_conflict", "PG65 — a terminal reservation with NO settlement row fails closed (terminal_conflict)");

  // ── P1-05: the orphan reaper forfeits held-but-expired envelopes (idempotent + concurrency-safe) ──
  const rp1 = await store.acquireEnvelope(req({ acquisitionKey: "kRp1", gatewaySessionDigest: "dRp1", subjectDigest: "sRp1", amounts: prov(3000n, 1n) }));
  await admin.query(`UPDATE budget_envelopes SET expires_at_ms=1 WHERE id=$1`, [rp1.envelope.envelopeId]);
  const reap = await store.reapOrphans({ nowMs: Date.now() });
  ok(reap.ok && reap.reaped >= 1, "PG51 — the orphan reaper forfeits a held-but-expired envelope (no dead-process reconcile call)");
  const rpState = await admin.query(`SELECT state, money_charged_micros FROM budget_envelopes WHERE id=$1`, [rp1.envelope.envelopeId]);
  ok(rpState.rows[0].state === "forfeited" && String(rpState.rows[0].money_charged_micros) === "3000", "PG52 — the reaped envelope is forfeited with ALL held charged (no quota restored)");
  const reapDup = await store.reapOrphans({ nowMs: Date.now() });
  ok(reapDup.reaped === 0, "PG53 — the reaper is idempotent (an already-reaped envelope is not re-forfeited)");
  const rc1 = await store.acquireEnvelope(req({ acquisitionKey: "kRpc1", gatewaySessionDigest: "dRpc1", subjectDigest: "sRpc", amounts: prov(2000n, 1n) }));
  const rc2 = await store.acquireEnvelope(req({ acquisitionKey: "kRpc2", gatewaySessionDigest: "dRpc2", subjectDigest: "sRpc", amounts: prov(2000n, 1n) }));
  await admin.query(`UPDATE budget_envelopes SET expires_at_ms=1 WHERE id IN ($1,$2)`, [rc1.envelope.envelopeId, rc2.envelope.envelopeId]);
  const [ra, rb] = await Promise.all([store.reapOrphans({ nowMs: Date.now() }), store2.reapOrphans({ nowMs: Date.now() })]);
  ok(((ra.reaped || 0) + (rb.reaped || 0)) === 2, `PG54 — two concurrent reapers forfeit each orphan exactly once (no double-charge) [got ${(ra.reaped || 0) + (rb.reaped || 0)}]`);

  // ════════════════════════ P0-01 FROZEN-LIFECYCLE — trusted boot-instance binding ═══
  // ── the boot nonce is MANDATORY at issuance (defense in depth at the store wire) ──
  const noBoot = await store.acquireEnvelope({ budgetClass: "PROVIDER_SPEND", gatewaySessionDigest: "dNB", subjectDigest: "sNB", projectId: "projA", acquisitionKey: "kNB", amounts: prov(1000n, 1n), maxControlStalenessMs: 15000, leaseTtlMs: 60000 });
  ok(!noBoot.ok && noBoot.reason === "invalid_request", "PG66 — an acquire missing the boot nonce fails closed (invalid_request)");

  // ── the boot nonce is PERSISTED on the envelope and reconstructed on replay ──
  const bnA = await store.acquireEnvelope(req({ acquisitionKey: "kBoot", gatewaySessionDigest: "dBoot", subjectDigest: "sBoot", amounts: prov(5000n, 1n), bootNonce: "boot-A" }));
  ok(bnA.ok && bnA.envelope.bootNonce === "boot-A", "PG67 — a fresh envelope pins the trusted boot nonce");
  const persisted = await admin.query(`SELECT boot_nonce FROM budget_envelopes WHERE acquisition_key='kBoot'`);
  ok(persisted.rows[0].boot_nonce === "boot-A", "PG68 — the boot nonce is durably persisted (NOT NULL immutable pin)");
  const bnSame = await store.acquireEnvelope(req({ acquisitionKey: "kBoot", gatewaySessionDigest: "dBoot", subjectDigest: "sBoot", amounts: prov(5000n, 1n), bootNonce: "boot-A" }));
  ok(bnSame.ok && bnSame.idempotentReplay === true, "PG69 — a SAME-boot exact replay remains valid (§6 idempotency retained)");

  // ── a DIFFERENT boot refuses replay of a still-HELD envelope (anti-resurrection, §5/§7) ──
  const bnDiff = await store.acquireEnvelope(req({ acquisitionKey: "kBoot", gatewaySessionDigest: "dBoot", subjectDigest: "sBoot", amounts: prov(5000n, 1n), bootNonce: "boot-B" }));
  ok(!bnDiff.ok && bnDiff.reason === "envelope_previous_boot", "PG70 — a NEW boot refuses replay of a still-HELD envelope (envelope_previous_boot)");
  const stillHeld = await admin.query(`SELECT state, revoked_at FROM budget_envelopes WHERE acquisition_key='kBoot'`);
  ok(stillHeld.rows[0].state === "held" && stillHeld.rows[0].revoked_at === null, "PG71 — the refused envelope is left to the conservative forfeit lifecycle (still held, not resurrected)");

  // ── a SUCCESSFUL durable revoke refuses replay regardless of boot identity (§8) ──
  const bnRev = await store.acquireEnvelope(req({ acquisitionKey: "kBootRev", gatewaySessionDigest: "dBootR", subjectDigest: "sBootR", amounts: prov(5000n, 1n), bootNonce: "boot-A" }));
  await store.revokeEnvelope({ envelopeId: bnRev.envelope.envelopeId, reason: "explicit" });
  const bnRevReplaySame = await store.acquireEnvelope(req({ acquisitionKey: "kBootRev", gatewaySessionDigest: "dBootR", subjectDigest: "sBootR", amounts: prov(5000n, 1n), bootNonce: "boot-A" }));
  ok(!bnRevReplaySame.ok && bnRevReplaySame.reason === "envelope_revoked", "PG72 — a successful durable revoke refuses SAME-boot replay (envelope_revoked, §8)");
  const bnRevReplayDiff = await store.acquireEnvelope(req({ acquisitionKey: "kBootRev", gatewaySessionDigest: "dBootR", subjectDigest: "sBootR", amounts: prov(5000n, 1n), bootNonce: "boot-B" }));
  ok(!bnRevReplayDiff.ok && bnRevReplayDiff.reason === "envelope_revoked", "PG73 — a successful durable revoke refuses NEW-boot replay too (revoked precedes boot check, §8)");

  // ── §9 CONTROL REVALIDATION on a SAME-boot replay: killed / disabled / advanced-epoch refuse ──
  await admin.query(`INSERT INTO budget_control_epochs (scope_type, scope_key_digest, control_epoch, enabled, killed, record_digest) VALUES ('project','projCR',1,TRUE,FALSE,'cr1') ON CONFLICT (scope_type, scope_key_digest) DO UPDATE SET control_epoch=1, enabled=TRUE, killed=FALSE`);
  await admin.query(`UPDATE budget_control_epochs SET control_epoch=1, enabled=TRUE, killed=FALSE WHERE scope_type='global'`);
  await setPolicy(admin, "polCR", { sessionMoney: 10n ** 12n, sessionCalls: 100n, sessionExec: 100n, projDay: 10n ** 12n, projMonth: 10n ** 12n, globalDay: 10n ** 12n }, "projCR");

  const crKill = await store.acquireEnvelope(req({ acquisitionKey: "kCRk", gatewaySessionDigest: "dCRk", subjectDigest: "sCRk", projectId: "projCR", amounts: prov(1000n, 1n), bootNonce: "boot-A" }));
  ok(crKill.ok, "PG74 — control-revalidation fixture acquired under a healthy control");
  await admin.query(`UPDATE budget_control_epochs SET killed=TRUE WHERE scope_type='project' AND scope_key_digest='projCR'`);
  const crKillReplay = await store.acquireEnvelope(req({ acquisitionKey: "kCRk", gatewaySessionDigest: "dCRk", subjectDigest: "sCRk", projectId: "projCR", amounts: prov(1000n, 1n), bootNonce: "boot-A" }));
  ok(!crKillReplay.ok && crKillReplay.reason === "control_killed", "PG75 — a KILLED control refuses a same-boot replay (§9, never mints from stale pinned control)");
  await admin.query(`UPDATE budget_control_epochs SET killed=FALSE WHERE scope_type='project' AND scope_key_digest='projCR'`);

  const crDis = await store.acquireEnvelope(req({ acquisitionKey: "kCRd", gatewaySessionDigest: "dCRd", subjectDigest: "sCRd", projectId: "projCR", amounts: prov(1000n, 1n), bootNonce: "boot-A" }));
  ok(crDis.ok, "PG76 — a second control-revalidation fixture acquired");
  await admin.query(`UPDATE budget_control_epochs SET enabled=FALSE WHERE scope_type='project' AND scope_key_digest='projCR'`);
  const crDisReplay = await store.acquireEnvelope(req({ acquisitionKey: "kCRd", gatewaySessionDigest: "dCRd", subjectDigest: "sCRd", projectId: "projCR", amounts: prov(1000n, 1n), bootNonce: "boot-A" }));
  ok(!crDisReplay.ok && crDisReplay.reason === "control_disabled", "PG77 — a DISABLED control refuses a same-boot replay (§9)");
  await admin.query(`UPDATE budget_control_epochs SET enabled=TRUE WHERE scope_type='project' AND scope_key_digest='projCR'`);

  const crAdv = await store.acquireEnvelope(req({ acquisitionKey: "kCRa", gatewaySessionDigest: "dCRa", subjectDigest: "sCRa", projectId: "projCR", amounts: prov(1000n, 1n), bootNonce: "boot-A" }));
  ok(crAdv.ok, "PG78 — a third control-revalidation fixture acquired at epoch 1");
  await admin.query(`UPDATE budget_control_epochs SET control_epoch=2 WHERE scope_type='project' AND scope_key_digest='projCR'`);
  const crAdvReplay = await store.acquireEnvelope(req({ acquisitionKey: "kCRa", gatewaySessionDigest: "dCRa", subjectDigest: "sCRa", projectId: "projCR", amounts: prov(1000n, 1n), bootNonce: "boot-A" }));
  ok(!crAdvReplay.ok && crAdvReplay.reason === "control_superseded", "PG79 — an ADVANCED control epoch refuses a same-boot replay (control_superseded, §9)");

  await pool.end();
  await admin.end();
  harness.stop();

  console.log(`\n${failed === 0 ? "✅" : "❌"} BUDGET-01 PostgreSQL integration suite: ${passed} passed, ${failed} failed`);
  if (failed !== 0) { console.error("\nFAILURES:\n" + failures.map((f) => "  - " + f).join("\n")); process.exit(1); }
  process.exit(0);
})().catch((e) => { console.error("UNCAUGHT:", e && e.stack || e); try { harness.stop(); } catch {} process.exit(1); });
