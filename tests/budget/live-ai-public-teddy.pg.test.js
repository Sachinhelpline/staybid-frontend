#!/usr/bin/env node
/* eslint-disable no-console */
// ═════════════════════════════════════════════════════════════════════════
// StayBid Live AI — REAL TEDDY — the PUBLIC composition against the REAL durable PgBudgetStore.
//
//   Run:  node tests/budget/live-ai-public-teddy.pg.test.js
//
// Spins up the SAME throwaway, socket-only Postgres cluster harness as live-ai-budget-01.pg.test.js,
// applies the UNAPPLIED BUDGET-01 migration artifact, and drives the NEW public composition
// (server/voice-gateway/live-ai-public-main.ts → the RELEASED BudgetCore) through the REAL
// createPgBudgetStore adapter: per-turn execution keys on one session, TRANSCRIPTION/TTS provider leases
// priced from the catalog, anonymous-subject refusal, the durable subject-day ceiling, restart (new boot
// nonce) anti-replay, kill switch, and two replicas at a shared ceiling. TEST-ONLY synthetic rates — never
// real prices. NO provider, NO network, NO Production (the dsn-guard refuses any non-throwaway DSN).
//
// RELEASE GATE: if the Postgres binaries are unavailable, the harness exits NON-ZERO (unproven).
// ═════════════════════════════════════════════════════════════════════════
"use strict";
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

let Client, Pool;
try { ({ Client, Pool } = require("pg")); }
catch (_) { console.error("[public-teddy-pg] `pg` is not installed. Run `npm ci`."); process.exit(2); }

const harness = require("../concurrency/.pg-harness");
const { assertTestDsn } = require("../concurrency/dsn-guard");
const OG = require("../live-ai/offline-gateway/offline-gateway");

const REPO = path.resolve(__dirname, "..", "..");
const MIG = path.join(REPO, "migrations", "2026-09-16-live-ai-budget-01-dpbel-foundation.sql");
const compiled = OG.compileSources(path.join(__dirname, ".build", "public-teddy-pg"));
const STORE = require(path.join(compiled.GW, "live-ai-budget-store.js"));
const PRICING = require(path.join(compiled.GW, "live-ai-budget-pricing.js"));
const PUB = require(path.join(compiled.GW, "live-ai-public-main.js"));
const STG = require(path.join(compiled.GW, "live-ai-staging-main.js"));

let passed = 0, failed = 0; const failures = [];
function ok(c, l) { if (c) { passed++; console.log("  ✓ " + l); } else { failed++; failures.push(l); console.error("  ✗ " + l); } }
const poolAdapter = (pool) => ({ connect: () => pool.connect() });
const PROJECT = "live-ai-03b";
const CATALOG_ID = "pubteddy.test.v1";
const pubSubject = (n) => "pub1." + crypto.createHash("sha256").update("pg-customer-" + n).digest("hex");
const sid = () => "las_" + crypto.randomBytes(8).toString("hex");

function catalog() {
  // TEST-ONLY synthetic rates (never real prices).
  const base = { currencyCode: "USD", effectiveFromMs: 0, effectiveUntilMs: null, verifiedAtMs: 0, verificationExpiresAtMs: 9_000_000_000_000, sourceId: "pg-test", sourceDigest: "d", status: "active", unitSize: 1n };
  return PRICING.createPriceCatalog(CATALOG_ID, [
    Object.assign({ provider: "openai", model: "gpt-live-transcribe", serviceTier: null, billingDimension: "realtime_audio_second", rateMicros: 100n }, base),
    // CHANGED FIXTURE (TEMPORARY tts-1 FALLBACK): the bound TTS model is tts-1, billed per input character.
    Object.assign({ provider: "openai", model: "tts-1", serviceTier: null, billingDimension: "tts_input_character", rateMicros: 20n }, base),
  ]);
}
async function setPolicy(client, id, c) {
  await client.query(`UPDATE budget_policy_versions SET status='superseded' WHERE project_id=$1 AND status='active'`, [PROJECT]);
  await client.query(
    `INSERT INTO budget_policy_versions (id, project_id, status, session_money_ceiling_micros, session_provider_calls, session_execution_admissions, subject_day_money_ceiling_micros, project_day_money_ceiling_micros, project_month_money_ceiling_micros, global_day_money_ceiling_micros, policy_digest)
       VALUES ($1,$2,'active',$3,$4,$5,$6,$7,$8,$9,$10)`,
    [id, PROJECT, c.sessionMoney, c.sessionCalls, c.sessionExec, c.subjectDay, c.projDay, c.projMonth, c.globalDay, "pd_" + id]);
}
const BIG = 10n ** 12n;
const roomy = { sessionMoney: BIG, sessionCalls: 1000n, sessionExec: 1000n, subjectDay: BIG, projDay: BIG, projMonth: BIG, globalDay: BIG };
async function envelopeCount(client, where, args) {
  const r = await client.query(`SELECT count(*)::int AS n FROM budget_envelopes ${where || ""}`, args || []);
  return r.rows[0].n;
}
function compose(store, bootNonce, ttsRule) {
  return PUB.buildPublicLiveAi({ store, controlIntervalMs: 5000, bootNonce, catalog: catalog(), ttsReservationRule: ttsRule === undefined ? { dimension: "tts_input_character", units: 4096n } : ttsRule,   /* CHANGED FIXTURE: tts-1 char rule */ controlTimers: { set: () => 0, clear: () => {} } });
}

(async () => {
  const dsn = await harness.start();
  assertTestDsn(dsn);
  const admin = new Client({ connectionString: dsn });
  await admin.connect();
  await admin.query(fs.readFileSync(MIG, "utf8"));
  await admin.query(`INSERT INTO budget_control_epochs (scope_type, scope_key_digest, control_epoch, enabled, killed, record_digest)
       VALUES ('global','global',1,TRUE,FALSE,'g1'), ('project',$1,1,TRUE,FALSE,'p1')
     ON CONFLICT (scope_type, scope_key_digest) DO UPDATE SET enabled=EXCLUDED.enabled, killed=EXCLUDED.killed`, [PROJECT]);
  await admin.query(`INSERT INTO budget_price_catalog_versions (id, status, catalog_digest) VALUES ($1,'active','cd-pubteddy') ON CONFLICT (id) DO NOTHING`, [CATALOG_ID]);
  await setPolicy(admin, "pol-roomy", roomy);
  ok(true, "PT01 — the BUDGET-01 migration artifact applied to the throwaway cluster; control + catalog + policy seeded for the 03B project");

  const pool = new Pool({ connectionString: dsn, max: 8 });
  const store = STORE.createPgBudgetStore({ pool: poolAdapter(pool), nowMs: () => Date.now() });
  const A = compose(store, "boot-A");

  // ── G-RATE: per-turn execution admissions on ONE session (the staging per-session key cannot do this) ──
  const s1 = sid(), u1 = pubSubject(1);
  const t1 = await A.live03b.prepareExecution({ gatewaySessionId: s1, subject: u1, turnId: "turn_1" });
  ok(t1.ok, `PT02 — turn 1: the per-turn execution-admission lease is acquired on the REAL store (${t1.reason || "ok"})`);
  await A.budgetCore.reconcileSession(s1);
  const t2 = await A.live03b.prepareExecution({ gatewaySessionId: s1, subject: u1, turnId: "turn_2" });
  ok(t2.ok, `PT03 — turn 2 on the SAME session acquires its OWN lease (distinct per-turn key) (${t2.reason || "ok"})`);
  await A.budgetCore.reconcileSession(s1);
  const rows = await admin.query(`SELECT acquisition_key, budget_class FROM budget_envelopes WHERE subject_digest=$1 ORDER BY acquisition_key`, [u1]);
  ok(rows.rows.length === 2 && rows.rows.every((r) => /^pub-exec\.[0-9a-f]{64}$/.test(r.acquisition_key) && r.budget_class === "EXECUTION_ADMISSION"), "PT04 — two DISTINCT durable pub-exec.<sha256> EXECUTION_ADMISSION envelopes exist for the two turns");
  const replay = await A.live03b.prepareExecution({ gatewaySessionId: s1, subject: u1, turnId: "turn_1" });
  ok(!replay.ok && replay.reason === "envelope_terminal", `PT05 — replaying turn 1's key after its reconcile ⇒ envelope_terminal (no re-admission) (${replay.reason})`);
  // contrast: the RELEASED staging composition keys per SESSION ⇒ its second turn is refused by the real store
  const S = STG.buildStagingLiveAi({ store, controlIntervalMs: 5000, bootNonce: "boot-A", catalog: catalog(), controlTimers: { set: () => 0, clear: () => {} } });
  const s2 = sid(), u2 = "stg1." + "e".repeat(64);
  const st1 = await S.live03b.prepareExecution({ gatewaySessionId: s2, subject: u2 });
  await S.budgetCore.reconcileSession(s2);
  const st2 = await S.live03b.prepareExecution({ gatewaySessionId: s2, subject: u2 });
  ok(st1.ok && !st2.ok, `PT06 — (contrast, UNCHANGED staging) the per-SESSION key refuses a second turn on the real store (${st2.reason}) — why the public route keys per TURN`);

  // ── G-MIC / G-TTS: provider-spend leases priced from the catalog ──
  const s3 = sid(), u3 = pubSubject(3);
  const tr = await A.live03b.prepareProviderSpend({ gatewaySessionId: s3, subject: u3, providerSpendClass: "TRANSCRIPTION", scopeKey: s3 });
  ok(tr.ok, `PT07 — TRANSCRIPTION lease acquired (${tr.reason || "ok"})`);
  const trRow = await admin.query(`SELECT money_held_micros AS money_micros, provider_calls_held AS provider_calls FROM budget_envelopes WHERE subject_digest=$1 AND budget_class='PROVIDER_SPEND'`, [u3]);
  ok(trRow.rows.length === 1 && String(trRow.rows[0].money_micros) === "18000" && String(trRow.rows[0].provider_calls) === "1", "PT08 — the durable envelope holds EXACTLY the 180 s × catalog-rate worst case (18000 µ$) and ONE provider call");
  await A.budgetCore.reconcileSession(s3);
  const tt = await A.live03b.prepareProviderSpend({ gatewaySessionId: s3, subject: u3, providerSpendClass: "TTS", scopeKey: "plan_1" });
  ok(tt.ok, `PT09 — after the transcription lease is reconciled, the SAME session's TTS lease is acquired (${tt.reason || "ok"})`);
  const ttRow = await admin.query(`SELECT money_held_micros AS money_micros FROM budget_envelopes WHERE subject_digest=$1 AND budget_class='PROVIDER_SPEND' ORDER BY acquired_at_ms DESC, acquired_at DESC LIMIT 1`, [u3]);
  ok(ttRow.rows.length === 1 && String(ttRow.rows[0].money_micros) === String(4096n * 20n), "PT10 — the TTS envelope holds owner-rule units × catalog rate (4096 chars × 20 = 81920 µ$; fixture-derived value, was 500 × 20)");
  await A.budgetCore.reconcileSession(s3);
  const noRule = compose(store, "boot-A", null);
  const n0 = await envelopeCount(admin);
  const nr = await noRule.live03b.prepareProviderSpend({ gatewaySessionId: sid(), subject: pubSubject(4), providerSpendClass: "TTS", scopeKey: "plan_x" });
  ok(!nr.ok && nr.reason === "no_tts_rate_or_rule" && (await envelopeCount(admin)) === n0, "PT11 — no owner TTS rule ⇒ refused BEFORE the store (zero envelopes written)");

  // ── G-PUBLIC defence in depth: anonymous / malformed subjects never lease ──
  const n1 = await envelopeCount(admin);
  const anon = await A.live03b.prepareProviderSpend({ gatewaySessionId: sid(), subject: "px." + "a".repeat(32), providerSpendClass: "TRANSCRIPTION", scopeKey: "x" });
  const anonExec = await A.live03b.prepareExecution({ gatewaySessionId: sid(), subject: "px." + "a".repeat(32), turnId: "t" });
  const bad = await A.live03b.prepareProviderSpend({ gatewaySessionId: sid(), subject: "pub1.NOTHEX", providerSpendClass: "TRANSCRIPTION", scopeKey: "x" });
  ok(!anon.ok && !anonExec.ok && !bad.ok && (await envelopeCount(admin)) === n1, "PT12 — anonymous px.* / malformed subjects are refused by the composition (zero envelopes written)");

  // ── durable per-subject day ceiling ──
  await setPolicy(admin, "pol-subjday", Object.assign({}, roomy, { subjectDay: 25000n }));
  const u5 = pubSubject(5);
  const c1 = await A.live03b.prepareProviderSpend({ gatewaySessionId: sid(), subject: u5, providerSpendClass: "TRANSCRIPTION", scopeKey: "a" });
  const c2 = await A.live03b.prepareProviderSpend({ gatewaySessionId: sid(), subject: u5, providerSpendClass: "TRANSCRIPTION", scopeKey: "b" });
  ok(c1.ok && !c2.ok && c2.reason === "ceiling_exceeded", `PT13 — the durable per-customer DAY ceiling (25000 µ$) admits one 18000 µ$ session and refuses the next (${c2.reason})`);
  const c3 = await A.live03b.prepareProviderSpend({ gatewaySessionId: sid(), subject: pubSubject(6), providerSpendClass: "TRANSCRIPTION", scopeKey: "c" });
  ok(c3.ok, "PT14 — a DIFFERENT customer is unaffected by another customer's day ceiling");
  await setPolicy(admin, "pol-roomy-2", roomy);

  // ── restart: a new process (new boot nonce) cannot replay an earlier boot's live envelope ──
  const s7 = sid(), u7 = pubSubject(7);
  const b1 = await A.live03b.prepareProviderSpend({ gatewaySessionId: s7, subject: u7, providerSpendClass: "TTS", scopeKey: "plan_r" });
  const B = compose(store, "boot-B");
  const b2 = await B.live03b.prepareProviderSpend({ gatewaySessionId: s7, subject: u7, providerSpendClass: "TTS", scopeKey: "plan_r" });
  ok(b1.ok && !b2.ok && b2.reason === "envelope_previous_boot", `PT15 — after a RESTART (boot-B) the previous boot's envelope cannot be replayed (${b2.reason})`);

  // ── two replicas at a shared global-day ceiling: no overspend ──
  await setPolicy(admin, "pol-global", Object.assign({}, roomy, { globalDay: 1n }));
  const gNow = await admin.query(`SELECT COALESCE(SUM(held+charged),0)::text AS t FROM budget_scope_counters WHERE scope_key_digest='global' AND accounting_dimension='money_micros' AND period_kind='day'`);
  const used = BigInt(gNow.rows[0].t);
  await setPolicy(admin, "pol-global-2", Object.assign({}, roomy, { globalDay: used + 27000n }));
  const R1 = compose(STORE.createPgBudgetStore({ pool: poolAdapter(pool), nowMs: () => Date.now() }), "boot-R1");
  const R2 = compose(STORE.createPgBudgetStore({ pool: poolAdapter(pool), nowMs: () => Date.now() }), "boot-R2");
  const [g1, g2] = await Promise.all([
    R1.live03b.prepareProviderSpend({ gatewaySessionId: sid(), subject: pubSubject(8), providerSpendClass: "TRANSCRIPTION", scopeKey: "g1" }),
    R2.live03b.prepareProviderSpend({ gatewaySessionId: sid(), subject: pubSubject(9), providerSpendClass: "TRANSCRIPTION", scopeKey: "g2" }),
  ]);
  ok([g1, g2].filter((r) => r.ok).length === 1, `PT16 — two replicas racing at the shared GLOBAL day ceiling: exactly ONE wins (no overspend) [${g1.ok}/${g2.ok}]`);
  await setPolicy(admin, "pol-roomy-3", roomy);

  // ── kill switch (DB CUT) ──
  await admin.query(`UPDATE budget_control_epochs SET killed=TRUE WHERE scope_type='global'`);
  const K = compose(store, "boot-K");
  const k1 = await K.live03b.prepareExecution({ gatewaySessionId: sid(), subject: pubSubject(10), turnId: "t" });
  const k2 = await K.live03b.prepareProviderSpend({ gatewaySessionId: sid(), subject: pubSubject(10), providerSpendClass: "TRANSCRIPTION", scopeKey: "k" });
  ok(!k1.ok && !k2.ok, `PT17 — a killed global control refuses NEW execution and provider leases (${k1.reason} / ${k2.reason})`);
  await admin.query(`UPDATE budget_control_epochs SET killed=FALSE WHERE scope_type='global'`);
  console.log("    (HONEST LIMIT: PT17 proves NEW-lease refusal after a DB CUT. It does NOT prove the P7 strict \"no physical send by an already-leased old process\" contract — see the P7 dossier.)");

  try { A.budgetCore.stop && A.budgetCore.stop(); } catch { /* no-op */ }
  await pool.end(); await admin.end(); await harness.stop();
  console.log(`\n  REAL TEDDY public composition × PgBudgetStore: ${passed} passed, ${failed} failed`);
  if (failed) { console.log("FAILURES:\n - " + failures.join("\n - ")); process.exit(1); }
  process.exit(0);
})().catch(async (e) => { console.error("UNCAUGHT:", e && e.stack ? e.stack : e); try { await harness.stop(); } catch { /* no-op */ } process.exit(1); });
